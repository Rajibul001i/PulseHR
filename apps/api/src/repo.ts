/**
 * Tenant-scoped repository layer.
 *
 * ADR-003 / P0-5. Application code NEVER writes `WHERE organisation_id = ?` by hand — the
 * tenant comes from the authenticated principal and is injected here. This is the primary
 * isolation control; PostgreSQL Row-Level Security is the backstop for the day someone
 * writes a raw query anyway.
 *
 * A cross-tenant leak is the one bug that ends a B2B product, so it gets two independent
 * controls and an automated test (NFR-14).
 */

import {
  balanceOf,
  type AttritionResult,
  type LeaveLedgerEntry,
  type LeaveRequest,
  type LeaveType,
  type Payslip,
  type SalaryStructure,
} from '@pulsehr/core';
import { all, nowIso, one, run, uuid, type Row } from './db.js';

export class Repo {
  constructor(
    private readonly orgId: string,
    private readonly actorUserId: string,
  ) {}

  /* ------------------------------- audit -------------------------------- */

  audit(action: string, entityType: string, entityId: string | null, detail?: unknown): void {
    run(
      `INSERT INTO audit_log (id, organisation_id, actor_user_id, action, entity_type, entity_id, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      uuid(),
      this.orgId,
      this.actorUserId,
      action,
      entityType,
      entityId,
      detail === undefined ? null : JSON.stringify(detail),
      nowIso(),
    );
  }

  /* ----------------------------- employees ------------------------------ */

  /** BUG-06 / F2.4 · US-11 — `q` filters name, code, designation and department. */
  listEmployees(q?: string): Row[] {
    if (!q) {
      return all(
        `SELECT e.*, d.name AS department_name
           FROM employee e
           LEFT JOIN department d ON d.id = e.department_id
          WHERE e.organisation_id = ?
          ORDER BY e.full_name`,
        this.orgId,
      );
    }
    const like = `%${q.toLowerCase()}%`;
    return all(
      `SELECT e.*, d.name AS department_name
         FROM employee e
         LEFT JOIN department d ON d.id = e.department_id
        WHERE e.organisation_id = ?
          AND ( LOWER(e.full_name)     LIKE ?
             OR LOWER(e.employee_code) LIKE ?
             OR LOWER(e.designation)   LIKE ?
             OR LOWER(COALESCE(d.name, '')) LIKE ? )
        ORDER BY e.full_name`,
      this.orgId,
      like,
      like,
      like,
      like,
    );
  }

  getEmployee(id: string): Row | undefined {
    return one(
      `SELECT e.*, d.name AS department_name
         FROM employee e
         LEFT JOIN department d ON d.id = e.department_id
        WHERE e.id = ? AND e.organisation_id = ?`,
      id,
      this.orgId,
    );
  }

  /** BUG-07 — office start is per-department (Department.officeStartTime), not a global 09:00. */
  officeStartMinutesFor(employeeId: string): number {
    const row = one(
      `SELECT d.office_start_time AS t
         FROM employee e LEFT JOIN department d ON d.id = e.department_id
        WHERE e.id = ? AND e.organisation_id = ?`,
      employeeId,
      this.orgId,
    );
    const raw = row?.t ? String(row.t) : '09:00';
    const parts = raw.split(':').map(Number);
    return (parts[0] ?? 9) * 60 + (parts[1] ?? 0);
  }

  departments(): Row[] {
    return all(
      `SELECT d.id, d.name,
              d.office_start_time AS officeStartTime,
              (SELECT COUNT(*) FROM employee e WHERE e.department_id = d.id) AS headcount
         FROM department d
        WHERE d.organisation_id = ?
        ORDER BY d.name`,
      this.orgId,
    );
  }

  /** Tenant's subscription plan — drives feature gating (docs/11-subscription-model.md). */
  subscription(): Row | undefined {
    return one(
      `SELECT id, name, tier, plan_status, trial_ends_on, seat_limit,
              (SELECT COUNT(*) FROM employee e
                WHERE e.organisation_id = o.id AND e.employment_status = 'ACTIVE') AS seats_used
         FROM organisation o WHERE o.id = ?`,
      this.orgId,
    );
  }

  directReportsOf(managerEmployeeId: string): Row[] {
    return all(
      `SELECT * FROM employee WHERE manager_id = ? AND organisation_id = ?`,
      managerEmployeeId,
      this.orgId,
    );
  }

  /* ------------------------------ salary -------------------------------- */

  salaryStructures(employeeId: string): SalaryStructure[] {
    return all(
      `SELECT * FROM salary_structure
        WHERE employee_id = ? AND organisation_id = ?
        ORDER BY effective_from`,
      employeeId,
      this.orgId,
    ).map(
      (r): SalaryStructure => ({
        id: String(r.id),
        employeeId: String(r.employee_id),
        effectiveFrom: String(r.effective_from),
        basic: Number(r.basic),
        houseRent: Number(r.house_rent),
        medical: Number(r.medical),
        conveyance: Number(r.conveyance),
        food: Number(r.food),
        dearness: Number(r.dearness),
        providentFundPct: Number(r.provident_fund_pct),
      }),
    );
  }

  /* ----------------------------- attendance ----------------------------- */

  attendanceBetween(employeeId: string, from: string, to: string): Row[] {
    return all(
      `SELECT * FROM attendance
        WHERE organisation_id = ? AND employee_id = ? AND work_date BETWEEN ? AND ?
        ORDER BY work_date`,
      this.orgId,
      employeeId,
      from,
      to,
    );
  }

  /**
   * The monthly grid — the hot path of P1-23.
   *
   * BUG-01 / US-04: a MANAGER must see only their own department. Passing
   * `{ departmentId }` narrows the grid; HR passes nothing and sees the organisation.
   */
  attendanceGrid(from: string, to: string, scope?: { departmentId: string | null }): Row[] {
    if (scope !== undefined) {
      return all(
        `SELECT a.employee_id, e.full_name, a.work_date, a.status, a.late_minutes, a.ot_hours
           FROM attendance a
           JOIN employee e ON e.id = a.employee_id
          WHERE a.organisation_id = ? AND a.work_date BETWEEN ? AND ?
            AND e.department_id IS ?
          ORDER BY e.full_name, a.work_date`,
        this.orgId,
        from,
        to,
        scope.departmentId,
      );
    }
    return all(
      `SELECT a.employee_id, e.full_name, a.work_date, a.status, a.late_minutes, a.ot_hours
         FROM attendance a
         JOIN employee e ON e.id = a.employee_id
        WHERE a.organisation_id = ? AND a.work_date BETWEEN ? AND ?
        ORDER BY e.full_name, a.work_date`,
      this.orgId,
      from,
      to,
    );
  }

  upsertAttendance(employeeId: string, workDate: string, patch: Record<string, unknown>): void {
    const existing = one(
      'SELECT id FROM attendance WHERE employee_id = ? AND work_date = ?',
      employeeId,
      workDate,
    );
    if (existing) {
      run(
        `UPDATE attendance SET check_in = COALESCE(?, check_in), check_out = COALESCE(?, check_out),
                late_minutes = COALESCE(?, late_minutes), ot_hours = COALESCE(?, ot_hours),
                status = COALESCE(?, status)
          WHERE id = ?`,
        patch.check_in ?? null,
        patch.check_out ?? null,
        patch.late_minutes ?? null,
        patch.ot_hours ?? null,
        patch.status ?? null,
        existing.id,
      );
    } else {
      run(
        `INSERT INTO attendance (id, organisation_id, employee_id, work_date, check_in, check_out,
                                 late_minutes, ot_hours, status, is_unplanned)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        uuid(),
        this.orgId,
        employeeId,
        workDate,
        patch.check_in ?? null,
        patch.check_out ?? null,
        patch.late_minutes ?? 0,
        patch.ot_hours ?? 0,
        patch.status ?? 'PRESENT',
        patch.is_unplanned ?? 0,
      );
    }
  }

  /* ------------------------------- leave -------------------------------- */

  ledgerFor(employeeId: string): LeaveLedgerEntry[] {
    return all(
      `SELECT * FROM leave_ledger
        WHERE organisation_id = ? AND employee_id = ?
        ORDER BY effective_date`,
      this.orgId,
      employeeId,
    ).map(
      (r): LeaveLedgerEntry => ({
        id: String(r.id),
        organisationId: String(r.organisation_id),
        employeeId: String(r.employee_id),
        leaveType: r.leave_type as LeaveType,
        delta: Number(r.delta),
        effectiveDate: String(r.effective_date),
        reason: String(r.reason),
        sourceRequestId: r.source_request_id ? String(r.source_request_id) : undefined,
        createdBy: String(r.created_by),
        createdAt: String(r.created_at),
      }),
    );
  }

  /** P0-7: balance is SUM(ledger), computed on read. There is no balance column. */
  balances(employeeId: string): Record<string, number> {
    const ledger = this.ledgerFor(employeeId);
    const types: LeaveType[] = ['EARNED', 'CASUAL', 'SICK', 'FESTIVAL', 'MATERNITY'];
    return Object.fromEntries(types.map((t) => [t, balanceOf(ledger, t)]));
  }

  appendLedger(
    employeeId: string,
    leaveType: LeaveType,
    delta: number,
    effectiveDate: string,
    reason: string,
    sourceRequestId?: string,
  ): void {
    if (delta === 0) throw new Error('Ledger delta cannot be zero');
    run(
      `INSERT INTO leave_ledger (id, organisation_id, employee_id, leave_type, delta,
                                 effective_date, reason, source_request_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      uuid(),
      this.orgId,
      employeeId,
      leaveType,
      delta,
      effectiveDate,
      reason,
      sourceRequestId ?? null,
      this.actorUserId,
      nowIso(),
    );
  }

  leaveRequests(filter: { employeeId?: string; status?: string } = {}): LeaveRequest[] {
    const clauses = ['organisation_id = ?'];
    const params: unknown[] = [this.orgId];
    if (filter.employeeId) {
      clauses.push('employee_id = ?');
      params.push(filter.employeeId);
    }
    if (filter.status) {
      clauses.push('status = ?');
      params.push(filter.status);
    }
    return all(
      `SELECT * FROM leave_request WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`,
      ...params,
    ).map(toLeaveRequest);
  }

  getLeaveRequest(id: string): LeaveRequest | undefined {
    const r = one('SELECT * FROM leave_request WHERE id = ? AND organisation_id = ?', id, this.orgId);
    return r ? toLeaveRequest(r) : undefined;
  }

  approvedLeaveFor(employeeId: string): LeaveRequest[] {
    return all(
      `SELECT * FROM leave_request
        WHERE organisation_id = ? AND employee_id = ? AND status = 'APPROVED'`,
      this.orgId,
      employeeId,
    ).map(toLeaveRequest);
  }

  createLeaveRequest(r: Omit<LeaveRequest, 'id' | 'organisationId' | 'createdAt'>): string {
    const id = uuid();
    run(
      `INSERT INTO leave_request (id, organisation_id, employee_id, leave_type, start_date,
                                  end_date, days, status, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      this.orgId,
      r.employeeId,
      r.leaveType,
      r.startDate,
      r.endDate,
      r.days,
      'PENDING',
      r.reason,
      nowIso(),
    );
    return id;
  }

  setLeaveStatus(id: string, status: string, decidedBy: string): void {
    run(
      `UPDATE leave_request SET status = ?, decided_by = ?, decided_at = ?
        WHERE id = ? AND organisation_id = ?`,
      status,
      decidedBy,
      nowIso(),
      id,
      this.orgId,
    );
  }

  /* ------------------------------ payroll ------------------------------- */

  /** P0-8: lines are written with the payslip, and the totals are asserted first. */
  insertPayslip(p: Payslip, issuedBy: string): string {
    const id = uuid();
    run(
      `INSERT INTO payslip (id, organisation_id, employee_id, period_year, period_month,
                            salary_structure_id, engine_version, days_in_period, lwp_days,
                            payable_days, ot_hours, ot_hourly_rate, gross, total_deductions,
                            net_pay, issued_at, issued_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      this.orgId,
      p.employeeId,
      p.periodYear,
      p.periodMonth,
      p.salaryStructureId,
      p.engineVersion,
      p.daysInPeriod,
      p.lwpDays,
      p.payableDays,
      p.otHours,
      p.otHourlyRate,
      p.gross,
      p.totalDeductions,
      p.netPay,
      nowIso(),
      issuedBy,
    );
    p.lines.forEach((line, i) => {
      run(
        `INSERT INTO payslip_line (id, payslip_id, code, label, amount, sign, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        uuid(),
        id,
        line.code,
        line.label,
        line.amount,
        line.sign,
        i,
      );
    });
    return id;
  }

  payslipsFor(employeeId: string): Row[] {
    return all(
      `SELECT * FROM payslip
        WHERE organisation_id = ? AND employee_id = ?
        ORDER BY period_year DESC, period_month DESC`,
      this.orgId,
      employeeId,
    );
  }

  payslipWithLines(id: string): { payslip: Row; lines: Row[] } | undefined {
    const p = one('SELECT * FROM payslip WHERE id = ? AND organisation_id = ?', id, this.orgId);
    if (!p) return undefined;
    return {
      payslip: p,
      lines: all('SELECT * FROM payslip_line WHERE payslip_id = ? ORDER BY sort_order', id),
    };
  }

  /* ----------------------------- attrition ------------------------------ */

  saveScore(result: AttritionResult): void {
    const existing = one(
      'SELECT id FROM attrition_score WHERE employee_id = ? AND scored_on = ?',
      result.employeeId,
      result.asOf,
    );
    if (existing) {
      run('DELETE FROM attrition_contribution WHERE score_id = ?', existing.id);
      run('DELETE FROM attrition_score WHERE id = ?', existing.id);
    }
    const id = uuid();
    run(
      `INSERT INTO attrition_score (id, organisation_id, employee_id, scored_on, score, band,
                                    engine_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      this.orgId,
      result.employeeId,
      result.asOf,
      result.score,
      result.band,
      result.engineVersion,
      nowIso(),
    );
    for (const c of result.contributions) {
      run(
        `INSERT INTO attrition_contribution (id, score_id, feature_key, label, normalised, weight, points)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        uuid(),
        id,
        c.key,
        c.label,
        c.normalised,
        c.weight,
        c.points,
      );
    }
  }

  /**
   * The at-risk list. HR role only, and every read is audited — spec §9.
   * Authorisation is enforced at the route AND here; this is not a display preference.
   */
  latestScores(limit = 20): Row[] {
    this.audit('VIEW_ATTRITION_SCORES', 'attrition_score', null, { limit });
    return all(
      `SELECT s.*, e.full_name, e.designation, e.hire_date, d.name AS department_name
         FROM attrition_score s
         JOIN employee e ON e.id = s.employee_id
         LEFT JOIN department d ON d.id = e.department_id
        WHERE s.organisation_id = ?
          AND s.scored_on = (SELECT MAX(scored_on) FROM attrition_score WHERE organisation_id = ?)
          AND e.employment_status = 'ACTIVE'
        ORDER BY s.score DESC
        LIMIT ?`,
      this.orgId,
      this.orgId,
      limit,
    );
  }

  scoreWithContributions(scoreId: string): { score: Row; contributions: Row[] } | undefined {
    const s = one('SELECT * FROM attrition_score WHERE id = ? AND organisation_id = ?', scoreId, this.orgId);
    if (!s) return undefined;
    this.audit('VIEW_ATTRITION_SCORE_DETAIL', 'attrition_score', scoreId);
    return {
      score: s,
      contributions: all(
        'SELECT * FROM attrition_contribution WHERE score_id = ? ORDER BY points DESC',
        scoreId,
      ),
    };
  }

  /* ------------------------------ notices ------------------------------- */

  notices(): Row[] {
    return all(
      'SELECT * FROM notice WHERE organisation_id = ? ORDER BY published_at DESC LIMIT 50',
      this.orgId,
    );
  }

  createNotice(title: string, body: string, publishedBy: string): string {
    const id = uuid();
    run(
      'INSERT INTO notice (id, organisation_id, title, body, published_by, published_at) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      this.orgId,
      title,
      body,
      publishedBy,
      nowIso(),
    );
    return id;
  }

  holidays(): string[] {
    return all('SELECT holiday_date FROM holiday WHERE organisation_id = ?', this.orgId).map((r) =>
      String(r.holiday_date),
    );
  }
}

function toLeaveRequest(r: Row): LeaveRequest {
  return {
    id: String(r.id),
    organisationId: String(r.organisation_id),
    employeeId: String(r.employee_id),
    leaveType: r.leave_type as LeaveType,
    startDate: String(r.start_date),
    endDate: String(r.end_date),
    days: Number(r.days),
    status: r.status as LeaveRequest['status'],
    reason: String(r.reason),
    decidedBy: r.decided_by ? String(r.decided_by) : undefined,
    decidedAt: r.decided_at ? String(r.decided_at) : undefined,
    createdAt: String(r.created_at),
  };
}
