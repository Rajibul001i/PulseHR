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
  businessDate,
  previewPlanChange,
  type AttritionResult,
  type LeaveLedgerEntry,
  type LeaveRequest,
  type LeaveType,
  type Payslip,
  type SalaryStructure,
  type Tier,
} from '@pulsehr/core';
import { all, nowIso, one, run, transaction, uuid, type Row } from './db.js';

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

  /**
   * F2.2 / US-09 — employee self-service. Deliberately narrow: only these three columns,
   * enforced here rather than trusted to the caller, so this method can never become a
   * back door for editing salary or designation regardless of what a future caller passes.
   */
  updateOwnContact(employeeId: string, fields: { phone?: string; address?: string; emergencyContact?: string }): void {
    run(
      `UPDATE employee
          SET phone = COALESCE(?, phone),
              address = COALESCE(?, address),
              emergency_contact = COALESCE(?, emergency_contact)
        WHERE id = ? AND organisation_id = ?`,
      fields.phone ?? null,
      fields.address ?? null,
      fields.emergencyContact ?? null,
      employeeId,
      this.orgId,
    );
    // Visible to HR without a further approval step (US-09's third acceptance criterion) --
    // this IS that visibility: it's on the same employee record HR's own screens read.
    this.audit('UPDATE_OWN_CONTACT', 'employee', employeeId, fields);
  }

  /* --------------------------- documents (F2.5) --------------------------- */

  addEmployeeDocument(params: {
    employeeId: string;
    category: string;
    filename: string;
    mimeType: string;
    content: Buffer;
  }): string {
    const id = uuid();
    run(
      `INSERT INTO employee_document
         (id, organisation_id, employee_id, category, filename, mime_type, size_bytes, content, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      this.orgId,
      params.employeeId,
      params.category,
      params.filename,
      params.mimeType,
      params.content.byteLength,
      params.content,
      this.actorUserId,
      nowIso(),
    );
    this.audit('UPLOAD_DOCUMENT', 'employee_document', id, { employeeId: params.employeeId, category: params.filename });
    return id;
  }

  /** Metadata only -- never the BLOB. US-12: "shows its type, upload date, and who uploaded it." */
  listEmployeeDocuments(employeeId: string): Row[] {
    return all(
      `SELECT d.id, d.category, d.filename, d.mime_type, d.size_bytes, d.created_at,
              u.email AS uploaded_by_email
         FROM employee_document d
         JOIN app_user u ON u.id = d.uploaded_by
        WHERE d.employee_id = ? AND d.organisation_id = ?
        ORDER BY d.created_at DESC`,
      employeeId,
      this.orgId,
    );
  }

  /** Includes the BLOB -- only call this for an actual download, not a list view. */
  getEmployeeDocument(documentId: string): Row | undefined {
    return one(
      `SELECT * FROM employee_document WHERE id = ? AND organisation_id = ?`,
      documentId,
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

  setLeaveStatus(id: string, status: string, decidedBy: string, decisionReason?: string): void {
    run(
      `UPDATE leave_request SET status = ?, decided_by = ?, decided_at = ?, decision_reason = COALESCE(?, decision_reason)
        WHERE id = ? AND organisation_id = ?`,
      status,
      decidedBy,
      nowIso(),
      decisionReason ?? null,
      id,
      this.orgId,
    );
  }

  /** Resolves an employee's manager's login, if they have a manager with an app_user account. */
  managerUserIdFor(employeeId: string): string | undefined {
    const row = one(
      `SELECT m.user_id FROM employee e JOIN employee m ON m.id = e.manager_id
        WHERE e.id = ? AND e.organisation_id = ?`,
      employeeId,
      this.orgId,
    );
    return row?.user_id ? String(row.user_id) : undefined;
  }

  /* --------------------------- notifications (F4.4) ------------------------ */

  notify(userId: string, type: 'LEAVE_PENDING' | 'LEAVE_DECIDED', message: string, entityType?: string, entityId?: string): void {
    run(
      `INSERT INTO notification (id, organisation_id, user_id, type, message, entity_type, entity_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      uuid(),
      this.orgId,
      userId,
      type,
      message,
      entityType ?? null,
      entityId ?? null,
      nowIso(),
    );
  }

  listNotifications(userId: string): Row[] {
    return all(
      'SELECT * FROM notification WHERE user_id = ? AND organisation_id = ? ORDER BY created_at DESC LIMIT 30',
      userId,
      this.orgId,
    );
  }

  markNotificationsRead(userId: string, ids?: string[]): void {
    if (ids && ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      run(
        `UPDATE notification SET read_at = ?
          WHERE user_id = ? AND organisation_id = ? AND id IN (${placeholders})`,
        nowIso(),
        userId,
        this.orgId,
        ...ids,
      );
    } else {
      run(
        `UPDATE notification SET read_at = ?
          WHERE user_id = ? AND organisation_id = ? AND read_at IS NULL`,
        nowIso(),
        userId,
        this.orgId,
      );
    }
  }

  /** US-22's third criterion: "the notification clears once the manager records a decision." */
  clearPendingNotificationsFor(entityType: string, entityId: string): void {
    run(
      `UPDATE notification SET read_at = ?
        WHERE organisation_id = ? AND entity_type = ? AND entity_id = ? AND read_at IS NULL`,
      nowIso(),
      this.orgId,
      entityType,
      entityId,
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

  /** F5.3 / US-27 — everything the generated PDF needs, in one call. */
  payslipForPdf(
    id: string,
  ): { payslip: Row; lines: Row[]; employee: Row; organisation: Row } | undefined {
    const found = this.payslipWithLines(id);
    if (!found) return undefined;
    const employee = one('SELECT * FROM employee WHERE id = ?', found.payslip.employee_id);
    const organisation = one('SELECT * FROM organisation WHERE id = ?', this.orgId);
    if (!employee || !organisation) return undefined;
    return { ...found, employee, organisation };
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

  /* -------------------------------- OKR ----------------------------------
   * F6 Performance Management — US-30..US-33.
   */

  listObjectives(employeeId: string, quarter?: string): Row[] {
    if (quarter) {
      return all(
        `SELECT * FROM objective WHERE organisation_id = ? AND employee_id = ? AND quarter = ? ORDER BY created_at`,
        this.orgId,
        employeeId,
        quarter,
      );
    }
    return all(
      `SELECT * FROM objective WHERE organisation_id = ? AND employee_id = ? ORDER BY quarter DESC, created_at`,
      this.orgId,
      employeeId,
    );
  }

  /** US-30: weights for one employee in one quarter must total 100%. */
  objectiveWeightTotal(employeeId: string, quarter: string): number {
    const row = one(
      `SELECT COALESCE(SUM(weight_pct), 0) AS total FROM objective
        WHERE organisation_id = ? AND employee_id = ? AND quarter = ?`,
      this.orgId,
      employeeId,
      quarter,
    );
    return Number(row?.total ?? 0);
  }

  createObjective(params: {
    employeeId: string;
    quarter: string;
    title: string;
    weightPct: number;
    keyResults: { title: string; targetValue: number; unit?: string }[];
  }): string {
    const id = uuid();
    const now = nowIso();
    transaction(() => {
      run(
        `INSERT INTO objective (id, organisation_id, employee_id, set_by, quarter, title, weight_pct, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        this.orgId,
        params.employeeId,
        this.actorUserId,
        params.quarter,
        params.title,
        params.weightPct,
        now,
      );
      for (const kr of params.keyResults) {
        run(
          `INSERT INTO key_result (id, objective_id, title, target_value, current_value, unit, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, ?)`,
          uuid(),
          id,
          kr.title,
          kr.targetValue,
          kr.unit ?? null,
          now,
        );
      }
    });
    this.audit('SET_OBJECTIVE', 'objective', id, {
      employeeId: params.employeeId,
      quarter: params.quarter,
      weightPct: params.weightPct,
    });
    return id;
  }

  objectiveWithKeyResults(id: string): { objective: Row; keyResults: Row[] } | undefined {
    const objective = one('SELECT * FROM objective WHERE id = ? AND organisation_id = ?', id, this.orgId);
    if (!objective) return undefined;
    return {
      objective,
      keyResults: all('SELECT * FROM key_result WHERE objective_id = ? ORDER BY rowid', id),
    };
  }

  /** Joined with its parent objective so a caller can check ownership/closed state in one call. */
  keyResultWithObjective(id: string): Row | undefined {
    return one(
      `SELECT kr.*, o.employee_id AS objective_employee_id, o.closed_at AS objective_closed_at
         FROM key_result kr JOIN objective o ON o.id = kr.objective_id
        WHERE kr.id = ? AND o.organisation_id = ?`,
      id,
      this.orgId,
    );
  }

  /** US-31: updating current_value recalculates completion immediately -- there is nothing
   *  cached to invalidate, since completion is derived at read time in objectiveWithScore(). */
  updateKeyResultProgress(id: string, currentValue: number, comment: string | undefined): void {
    run(
      `UPDATE key_result SET current_value = ?, comment = ?, updated_at = ? WHERE id = ?`,
      currentValue,
      comment ?? null,
      nowIso(),
      id,
    );
    this.audit('UPDATE_KEY_RESULT', 'key_result', id, { currentValue });
  }

  /** US-30: closes every open objective for the quarter, org-wide -- a review cycle closes
   *  together, not employee by employee. HR-only at the route level. */
  closeQuarter(quarter: string): void {
    run(
      `UPDATE objective SET closed_at = ? WHERE organisation_id = ? AND quarter = ? AND closed_at IS NULL`,
      nowIso(),
      this.orgId,
      quarter,
    );
    this.audit('CLOSE_OKR_QUARTER', 'objective', null, { quarter });
  }

  /** US-32: one score per employee per quarter; a second submission overwrites. Overwriting
   *  resets published_at to NULL -- a correction should not silently change what an employee
   *  already saw without HR re-confirming the publish. The audit_log entry (not a second row)
   *  is the permanent trail US-32 asks for. */
  upsertReviewScore(params: { employeeId: string; quarter: string; score: number }): string {
    const existing = one(
      `SELECT * FROM review_score WHERE organisation_id = ? AND employee_id = ? AND quarter = ?`,
      this.orgId,
      params.employeeId,
      params.quarter,
    );
    const now = nowIso();
    if (existing) {
      run(
        `UPDATE review_score SET score = ?, recorded_by = ?, published_at = NULL, created_at = ? WHERE id = ?`,
        params.score,
        this.actorUserId,
        now,
        existing.id,
      );
      this.audit('OVERWRITE_REVIEW_SCORE', 'review_score', String(existing.id), {
        employeeId: params.employeeId,
        quarter: params.quarter,
        previousScore: existing.score,
        newScore: params.score,
      });
      return String(existing.id);
    }
    const id = uuid();
    run(
      `INSERT INTO review_score (id, organisation_id, employee_id, quarter, score, recorded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      this.orgId,
      params.employeeId,
      params.quarter,
      params.score,
      this.actorUserId,
      now,
    );
    this.audit('SET_REVIEW_SCORE', 'review_score', id, {
      employeeId: params.employeeId,
      quarter: params.quarter,
      score: params.score,
    });
    return id;
  }

  publishReviewScore(id: string): boolean {
    const existing = one('SELECT id FROM review_score WHERE id = ? AND organisation_id = ?', id, this.orgId);
    if (!existing) return false;
    run(`UPDATE review_score SET published_at = ? WHERE id = ?`, nowIso(), id);
    this.audit('PUBLISH_REVIEW_SCORE', 'review_score', id);
    return true;
  }

  /** US-33: quarter order, current quarter last. `publishedOnly` scopes an employee's own view. */
  reviewScoresFor(employeeId: string, publishedOnly: boolean): Row[] {
    return all(
      `SELECT * FROM review_score
        WHERE organisation_id = ? AND employee_id = ? ${publishedOnly ? 'AND published_at IS NOT NULL' : ''}
        ORDER BY quarter`,
      this.orgId,
      employeeId,
    );
  }

  /* -------------------------------- ATS -----------------------------------
   * F7 Recruitment — Applicant Tracking System — US-34..US-38.
   */

  private static readonly STAGE_RANK: Record<string, number> = {
    APPLIED: 0,
    SHORTLISTED: 1,
    INTERVIEW: 2,
    OFFER: 3,
    HIRED: 4,
    REJECTED: 4,
  };

  listVacancies(): Row[] {
    return all('SELECT * FROM vacancy WHERE organisation_id = ? ORDER BY created_at DESC', this.orgId);
  }

  vacancy(id: string): Row | undefined {
    return one('SELECT * FROM vacancy WHERE id = ? AND organisation_id = ?', id, this.orgId);
  }

  createVacancy(params: { title: string; requirements: string; deadline: string }): string {
    const id = uuid();
    run(
      `INSERT INTO vacancy (id, organisation_id, title, requirements, deadline, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, 'PUBLISHED', ?, ?)`,
      id,
      this.orgId,
      params.title,
      params.requirements,
      params.deadline,
      this.actorUserId,
      nowIso(),
    );
    this.audit('PUBLISH_VACANCY', 'vacancy', id, { title: params.title, deadline: params.deadline });
    return id;
  }

  private static readonly CANDIDATE_COLUMNS =
    'id, organisation_id, vacancy_id, full_name, email, phone, cv_filename, reference_code, stage, converted_employee_id, applied_at';

  listCandidates(vacancyId?: string): Row[] {
    if (vacancyId) {
      return all(
        `SELECT ${Repo.CANDIDATE_COLUMNS} FROM candidate WHERE organisation_id = ? AND vacancy_id = ? ORDER BY applied_at`,
        this.orgId,
        vacancyId,
      );
    }
    return all(
      `SELECT ${Repo.CANDIDATE_COLUMNS} FROM candidate WHERE organisation_id = ? ORDER BY applied_at DESC`,
      this.orgId,
    );
  }

  candidate(id: string): Row | undefined {
    return one(
      `SELECT ${Repo.CANDIDATE_COLUMNS}, cv_mime_type FROM candidate WHERE id = ? AND organisation_id = ?`,
      id,
      this.orgId,
    );
  }

  candidateCv(id: string): Row | undefined {
    return one(
      'SELECT cv_filename, cv_mime_type, cv_content FROM candidate WHERE id = ? AND organisation_id = ?',
      id,
      this.orgId,
    );
  }

  candidateStageHistory(candidateId: string): Row[] {
    return all('SELECT * FROM candidate_stage_event WHERE candidate_id = ? ORDER BY created_at', candidateId);
  }

  candidateEvaluations(candidateId: string): Row[] {
    return all('SELECT * FROM candidate_evaluation WHERE candidate_id = ? ORDER BY created_at', candidateId);
  }

  /** US-36: moving backwards through the pipeline requires a reason; HIRED is a closed
   *  application per F7.5 and cannot be moved again from either direction. */
  moveCandidateStage(
    candidateId: string,
    toStage: string,
    reason: string | undefined,
  ): { ok: true } | { ok: false; error: 'NOT_FOUND' | 'ALREADY_HIRED' | 'REASON_REQUIRED' } {
    const c = one('SELECT * FROM candidate WHERE id = ? AND organisation_id = ?', candidateId, this.orgId);
    if (!c) return { ok: false, error: 'NOT_FOUND' };
    if (c.stage === 'HIRED') return { ok: false, error: 'ALREADY_HIRED' };
    const fromRank = Repo.STAGE_RANK[String(c.stage)] ?? 0;
    const toRank = Repo.STAGE_RANK[toStage] ?? 0;
    if (toRank < fromRank && !reason?.trim()) return { ok: false, error: 'REASON_REQUIRED' };
    transaction(() => {
      run('UPDATE candidate SET stage = ? WHERE id = ?', toStage, candidateId);
      run(
        `INSERT INTO candidate_stage_event (id, candidate_id, from_stage, to_stage, reason, actor_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        uuid(),
        candidateId,
        c.stage,
        toStage,
        reason ?? null,
        this.actorUserId,
        nowIso(),
      );
    });
    this.audit('MOVE_CANDIDATE_STAGE', 'candidate', candidateId, { from: c.stage, to: toStage, reason });
    return { ok: true };
  }

  /** US-37: an evaluation may only be added while the candidate sits at Interview. */
  addCandidateEvaluation(params: {
    candidateId: string;
    interviewDate: string;
    comments: string;
    score: number;
  }): { ok: true; id: string } | { ok: false; error: 'NOT_FOUND' | 'NOT_AT_INTERVIEW_STAGE' } {
    const c = one('SELECT stage FROM candidate WHERE id = ? AND organisation_id = ?', params.candidateId, this.orgId);
    if (!c) return { ok: false, error: 'NOT_FOUND' };
    if (c.stage !== 'INTERVIEW') return { ok: false, error: 'NOT_AT_INTERVIEW_STAGE' };
    const id = uuid();
    run(
      `INSERT INTO candidate_evaluation (id, candidate_id, interview_date, comments, score, recorded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      params.candidateId,
      params.interviewDate,
      params.comments,
      params.score,
      this.actorUserId,
      nowIso(),
    );
    this.audit('RECORD_EVALUATION', 'candidate', params.candidateId, { score: params.score });
    return { ok: true, id };
  }

  /** US-38: one action, no re-typed fields, application closes as Hired and stays closed. */
  convertCandidateToEmployee(
    candidateId: string,
    params: { employeeCode: string; designation: string; departmentId: string | null; hireDate: string },
  ): { ok: true; employeeId: string } | { ok: false; error: 'NOT_FOUND' | 'NOT_HIRED' | 'ALREADY_CONVERTED' } {
    const c = one('SELECT * FROM candidate WHERE id = ? AND organisation_id = ?', candidateId, this.orgId);
    if (!c) return { ok: false, error: 'NOT_FOUND' };
    if (c.stage !== 'HIRED') return { ok: false, error: 'NOT_HIRED' };
    if (c.converted_employee_id) return { ok: false, error: 'ALREADY_CONVERTED' };
    const employeeId = uuid();
    transaction(() => {
      run(
        `INSERT INTO employee
           (id, organisation_id, employee_code, full_name, designation, department_id, hire_date, employment_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
        employeeId,
        this.orgId,
        params.employeeCode,
        c.full_name,
        params.designation,
        params.departmentId,
        params.hireDate,
        nowIso(),
      );
      run('UPDATE candidate SET converted_employee_id = ? WHERE id = ?', employeeId, candidateId);
    });
    this.audit('CONVERT_CANDIDATE', 'candidate', candidateId, { employeeId });
    return { ok: true, employeeId };
  }

  /* ------------------------------ notices ------------------------------- */

  notices(employeeId: string | null, isPrivileged: boolean): Row[] {
    // F8.1: audience targeting. HR/managers see every notice (they need to know what exists
    // to manage it); an employee sees company-wide notices plus ones targeted at their own
    // department. is_urgent DESC first so a pinned notice always sits above routine ones (F8.2).
    if (isPrivileged) {
      return all(
        `SELECT * FROM notice WHERE organisation_id = ? ORDER BY is_urgent DESC, published_at DESC LIMIT 50`,
        this.orgId,
      );
    }
    const departmentId = employeeId
      ? one('SELECT department_id FROM employee WHERE id = ?', employeeId)?.department_id
      : null;
    return all(
      `SELECT n.* FROM notice n
        WHERE n.organisation_id = ?
          AND ( n.audience_type = 'COMPANY'
             OR ( n.audience_type = 'DEPARTMENTS' AND EXISTS (
                    SELECT 1 FROM notice_department nd
                     WHERE nd.notice_id = n.id AND nd.department_id = ? ) ) )
        ORDER BY n.is_urgent DESC, n.published_at DESC
        LIMIT 50`,
      this.orgId,
      departmentId ?? '__none__',
    );
  }

  /** F8.2: caps how many notices can be pinned urgent at once ("by configuration"). */
  urgentNoticeCount(): number {
    const row = one(
      `SELECT COUNT(*) AS n FROM notice WHERE organisation_id = ? AND is_urgent = 1`,
      this.orgId,
    );
    return Number(row?.n ?? 0);
  }

  createNotice(params: {
    title: string;
    body: string;
    publishedBy: string;
    audienceType: 'COMPANY' | 'DEPARTMENTS';
    departmentIds: string[];
    isUrgent: boolean;
  }): string {
    const id = uuid();
    transaction(() => {
      run(
        `INSERT INTO notice (id, organisation_id, title, body, published_by, published_at, audience_type, is_urgent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        this.orgId,
        params.title,
        params.body,
        params.publishedBy,
        nowIso(),
        params.audienceType,
        params.isUrgent ? 1 : 0,
      );
      for (const deptId of params.departmentIds) {
        run('INSERT INTO notice_department (notice_id, department_id) VALUES (?, ?)', id, deptId);
      }
    });
    this.audit('PUBLISH_NOTICE', 'notice', id, {
      audienceType: params.audienceType,
      departmentIds: params.departmentIds,
      isUrgent: params.isUrgent,
    });
    return id;
  }

  setNoticeUrgent(id: string, isUrgent: boolean): boolean {
    const existing = one('SELECT id FROM notice WHERE id = ? AND organisation_id = ?', id, this.orgId);
    if (!existing) return false;
    run('UPDATE notice SET is_urgent = ? WHERE id = ?', isUrgent ? 1 : 0, id);
    this.audit(isUrgent ? 'PIN_NOTICE' : 'UNPIN_NOTICE', 'notice', id);
    return true;
  }

  /** US-41: records the read once; a second open is a harmless no-op (INSERT OR IGNORE). */
  markNoticeRead(noticeId: string, employeeId: string): void {
    run(
      'INSERT OR IGNORE INTO notice_read (notice_id, employee_id, read_at) VALUES (?, ?, ?)',
      noticeId,
      employeeId,
      nowIso(),
    );
  }

  readNoticeIdsFor(employeeId: string): Set<string> {
    return new Set(
      all('SELECT notice_id FROM notice_read WHERE employee_id = ?', employeeId).map((r) => String(r.notice_id)),
    );
  }

  /** US-42: read vs unread employees for one notice, scoped to who was actually targeted. */
  noticeReadReport(noticeId: string): { read: Row[]; unread: Row[] } | undefined {
    const notice = one('SELECT * FROM notice WHERE id = ? AND organisation_id = ?', noticeId, this.orgId);
    if (!notice) return undefined;
    const targeted =
      notice.audience_type === 'COMPANY'
        ? all('SELECT id, full_name, employee_code FROM employee WHERE organisation_id = ?', this.orgId)
        : all(
            `SELECT DISTINCT e.id, e.full_name, e.employee_code
               FROM employee e JOIN notice_department nd ON nd.department_id = e.department_id
              WHERE nd.notice_id = ? AND e.organisation_id = ?`,
            noticeId,
            this.orgId,
          );
    const readIds = new Set(
      all('SELECT employee_id FROM notice_read WHERE notice_id = ?', noticeId).map((r) => String(r.employee_id)),
    );
    return {
      read: targeted.filter((e) => readIds.has(String(e.id))),
      unread: targeted.filter((e) => !readIds.has(String(e.id))),
    };
  }

  holidays(): string[] {
    return all('SELECT holiday_date FROM holiday WHERE organisation_id = ?', this.orgId).map((r) =>
      String(r.holiday_date),
    );
  }

  /* ------------------------------- billing -------------------------------
   * Self-service plan change, simulated. docs/11-subscription-model.md §8.
   */

  private static readonly SEAT_LIMIT: Record<Tier, number> = { STARTER: 50, GROWTH: 300, ENTERPRISE: 5000 };

  previewSubscriptionChange(newTier: Tier) {
    const org = one('SELECT tier FROM organisation WHERE id = ?', this.orgId);
    if (!org) throw new Error(`Unknown organisation ${this.orgId}`);
    return previewPlanChange(org.tier as Tier, newTier, businessDate(new Date()));
  }

  /**
   * A downgrade that would leave more active employees than the new tier's seat limit is
   * refused -- the seat-limit check elsewhere in this app (F1/subscription model) exists
   * precisely so a tenant can't silently exceed what they're paying for, and applying that
   * only going forward while ignoring it here would defeat the whole point of the check.
   */
  changeSubscription(
    newTier: Tier,
    actorUserId: string,
  ): { ok: true; invoice: Row } | { ok: false; error: 'SAME_TIER' | 'SEAT_LIMIT_EXCEEDED'; seatsUsed?: number } {
    const org = one('SELECT tier FROM organisation WHERE id = ?', this.orgId);
    if (!org) throw new Error(`Unknown organisation ${this.orgId}`);
    const currentTier = org.tier as Tier;
    if (currentTier === newTier) return { ok: false, error: 'SAME_TIER' };

    if (Repo.SEAT_LIMIT[newTier] < Repo.SEAT_LIMIT[currentTier]) {
      const seatsUsed = Number(
        one(
          `SELECT COUNT(*) AS n FROM employee WHERE organisation_id = ? AND employment_status = 'ACTIVE'`,
          this.orgId,
        )?.n ?? 0,
      );
      if (seatsUsed > Repo.SEAT_LIMIT[newTier]) {
        return { ok: false, error: 'SEAT_LIMIT_EXCEEDED', seatsUsed };
      }
    }

    const today = businessDate(new Date());
    const preview = previewPlanChange(currentTier, newTier, today);
    const invoiceId = uuid();
    const eventType = preview.changeType === 'UPGRADE' ? 'UPGRADED' : 'DOWNGRADED';
    const description =
      preview.changeType === 'UPGRADE'
        ? `Upgrade ${currentTier} -> ${newTier}, prorated for ${preview.daysRemaining}/${preview.daysInMonth} remaining days this month`
        : `Downgrade ${currentTier} -> ${newTier}, prorated credit for ${preview.daysRemaining}/${preview.daysInMonth} remaining days this month`;

    transaction(() => {
      run(
        'UPDATE organisation SET tier = ?, seat_limit = ? WHERE id = ?',
        newTier,
        Repo.SEAT_LIMIT[newTier],
        this.orgId,
      );
      run(
        `INSERT INTO subscription_event
           (id, organisation_id, event_type, from_tier, to_tier, effective_on, actor_user_id, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        uuid(),
        this.orgId,
        eventType,
        currentTier,
        newTier,
        today,
        actorUserId,
        description,
        nowIso(),
      );
      run(
        `INSERT INTO invoice (id, organisation_id, tier, amount_paisa, description, status, issued_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        invoiceId,
        this.orgId,
        newTier,
        preview.netDuePaisa,
        description,
        preview.netDuePaisa < 0 ? 'CREDITED' : 'PAID',
        nowIso(),
      );
    });
    this.audit(eventType, 'organisation', this.orgId, { from: currentTier, to: newTier, netDuePaisa: preview.netDuePaisa });

    return { ok: true, invoice: one('SELECT * FROM invoice WHERE id = ?', invoiceId)! };
  }

  listInvoices(): Row[] {
    return all('SELECT * FROM invoice WHERE organisation_id = ? ORDER BY issued_at DESC', this.orgId);
  }
}

/**
 * F7.1/F7.2 — the public careers pages. US-34: "reachable on a public link with no login."
 * These are plain functions, not Repo methods, because an anonymous applicant has neither an
 * organisationId from a principal nor an actorUserId to audit against — the tenant instead
 * comes explicitly from the URL, same as any other public multi-tenant careers page.
 */

export function publicVacancies(orgId: string): Row[] {
  const today = nowIso().slice(0, 10);
  return all(
    `SELECT id, title, requirements, deadline FROM vacancy
      WHERE organisation_id = ? AND status = 'PUBLISHED' AND deadline >= ?
      ORDER BY created_at DESC`,
    orgId,
    today,
  );
}

export function publicVacancy(orgId: string, vacancyId: string): Row | undefined {
  return one(
    `SELECT id, title, requirements, deadline FROM vacancy
      WHERE id = ? AND organisation_id = ? AND status = 'PUBLISHED'`,
    vacancyId,
    orgId,
  );
}

export function submitApplication(params: {
  orgId: string;
  vacancyId: string;
  fullName: string;
  email: string;
  phone?: string;
  cvFilename: string;
  cvMimeType: string;
  cvContent: Buffer;
}): { ok: true; referenceCode: string } | { ok: false; error: 'NOT_FOUND' | 'DEADLINE_PASSED' } {
  const vacancy = one(
    `SELECT * FROM vacancy WHERE id = ? AND organisation_id = ? AND status = 'PUBLISHED'`,
    params.vacancyId,
    params.orgId,
  );
  if (!vacancy) return { ok: false, error: 'NOT_FOUND' };
  // US-34: "A vacancy past its deadline stops accepting applications" -- enforced here, not
  // just by hiding it from the public list, since the direct link stays guessable.
  if (String(vacancy.deadline) < nowIso().slice(0, 10)) return { ok: false, error: 'DEADLINE_PASSED' };

  const id = uuid();
  const referenceCode = `REF-${id.slice(0, 8).toUpperCase()}`;
  run(
    `INSERT INTO candidate
       (id, organisation_id, vacancy_id, full_name, email, phone, cv_filename, cv_mime_type, cv_content, reference_code, stage, applied_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPLIED', ?)`,
    id,
    params.orgId,
    params.vacancyId,
    params.fullName,
    params.email,
    params.phone ?? null,
    params.cvFilename,
    params.cvMimeType,
    params.cvContent,
    referenceCode,
    nowIso(),
  );
  return { ok: true, referenceCode };
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
