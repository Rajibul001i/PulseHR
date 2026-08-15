/**
 * Turns raw HR data into the attrition feature vector.
 *
 * This is the only place database shape meets the scoring engine. The engine itself stays
 * pure (ADR-008); everything I/O-shaped lives here.
 */

import { addDays, balanceOf, type AttritionFeatureInput, type DhakaDate } from '@pulsehr/core';
import { all, one, type Row } from './db.js';

/** Whole months between two business dates. */
function monthsBetween(from: DhakaDate, to: DhakaDate): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
}

export async function buildFeatures(
  orgId: string,
  employee: Row,
  asOf: DhakaDate,
): Promise<AttritionFeatureInput> {
  const employeeId = String(employee.id);
  const win90 = addDays(asOf, -90);
  const win60 = addDays(asOf, -60);
  const win120 = addDays(asOf, -120);

  // F1 — tenure
  const tenureMonths = monthsBetween(String(employee.hire_date), asOf);

  // F2 — single-day unplanned absences adjacent to a weekend.
  // Deliberately NOT total sick days: that would penalise illness and caregiving (P1-16).
  const absenceRow = await one(
    `SELECT COUNT(*) AS n FROM attendance
      WHERE organisation_id = ? AND employee_id = ? AND work_date BETWEEN ? AND ?
        AND status = 'ABSENT' AND is_unplanned = 1`,
    orgId,
    employeeId,
    win90,
    asOf,
  );
  const unplannedWeekendAdjacentAbsences90d = Number(absenceRow?.n ?? 0);

  // F3 — lateness trend, z-scored within department
  const lateRecent = await one(
    `SELECT AVG(late_minutes) AS avg FROM attendance
      WHERE employee_id = ? AND work_date BETWEEN ? AND ? AND status = 'PRESENT'`,
    employeeId,
    win60,
    asOf,
  );
  const latePrior = await one(
    `SELECT AVG(late_minutes) AS avg FROM attendance
      WHERE employee_id = ? AND work_date BETWEEN ? AND ? AND status = 'PRESENT'`,
    employeeId,
    win120,
    win60,
  );

  const deptRows = await all(
    `SELECT AVG(a.late_minutes) AS avg
       FROM attendance a
       JOIN employee e ON e.id = a.employee_id
      WHERE e.organisation_id = ? AND e.department_id IS NOT DISTINCT FROM ?
        AND a.work_date BETWEEN ? AND ? AND a.status = 'PRESENT'
      GROUP BY a.employee_id`,
    orgId,
    employee.department_id ?? null,
    win60,
    asOf,
  );
  const deptAvgs = deptRows.map((r) => Number(r.avg ?? 0));
  const departmentLatenessStdDev = stdDev(deptAvgs);

  // F4 — leave drawdown over the window
  const ledgerRows = await all(
    `SELECT leave_type, delta, effective_date FROM leave_ledger
      WHERE organisation_id = ? AND employee_id = ?`,
    orgId,
    employeeId,
  );
  const ledger = ledgerRows.map((r) => ({
    leaveType: r.leave_type as never,
    delta: Number(r.delta),
    effectiveDate: String(r.effective_date),
    id: '',
    organisationId: orgId,
    employeeId,
    reason: '',
    createdBy: '',
    createdAt: '',
  }));
  const leaveBalanceAtWindowStart = balanceOf(ledger, 'EARNED', win90);
  const consumedRow = await one(
    `SELECT COALESCE(SUM(-delta), 0) AS n FROM leave_ledger
      WHERE employee_id = ? AND delta < 0 AND effective_date BETWEEN ? AND ?`,
    employeeId,
    win90,
    asOf,
  );
  const leaveDaysConsumed90d = Number(consumedRow?.n ?? 0);

  // F5 — compensation stagnation, from the salary-structure history
  const lastRaise = await one(
    `SELECT MAX(effective_from) AS d FROM salary_structure
      WHERE employee_id = ? AND effective_from <= ?`,
    employeeId,
    asOf,
  );
  const firstStructure = await one(
    `SELECT MIN(effective_from) AS d FROM salary_structure WHERE employee_id = ?`,
    employeeId,
  );
  const monthsSinceLastSalaryIncrease =
    lastRaise?.d && firstStructure?.d && String(lastRaise.d) !== String(firstStructure.d)
      ? monthsBetween(String(lastRaise.d), asOf)
      : null;

  // F6 — recent manager change
  const daysSinceManagerChange = employee.manager_changed_at
    ? Math.max(0, daysBetweenDates(String(employee.manager_changed_at).slice(0, 10), asOf))
    : null;

  // F7 — sustained overtime
  const otRow = await one(
    `SELECT COALESCE(SUM(ot_hours), 0) AS total FROM attendance
      WHERE employee_id = ? AND work_date BETWEEN ? AND ?`,
    employeeId,
    win90,
    asOf,
  );
  const otHoursPerMonthAvg90d = Number(otRow?.total ?? 0) / 3;

  return {
    employeeId,
    asOf,
    tenureMonths,
    unplannedWeekendAdjacentAbsences90d,
    latenessMinutesAvgLast60d: Number(lateRecent?.avg ?? 0),
    latenessMinutesAvgPrior60d: Number(latePrior?.avg ?? 0),
    departmentLatenessStdDev,
    leaveDaysConsumed90d,
    leaveBalanceAtWindowStart,
    monthsSinceLastSalaryIncrease,
    daysSinceManagerChange,
    otHoursPerMonthAvg90d,
    // OKR module is Increment 3; until it lands these are neutral rather than fabricated.
    okrUpdatesThisCycle: 0,
    okrUpdatesPrevCycle: 0,
  };
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function daysBetweenDates(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
  );
}
