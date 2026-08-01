/**
 * Payroll engine. Pure — no I/O, no clock, no database (ADR-008).
 *
 * Implements docs/04-payroll-spec.md. The three corrections to the source proposal that
 * live here:
 *   P1-2  overtime is computed on BASIC + DEARNESS, never on gross
 *   P0-9  the period length is real calendar days, derived in Asia/Dhaka
 *   P0-8  the payslip is line-itemised and its totals are asserted before it is returned
 */

import { daysInMonth } from './dates.js';
import { applyRatio, round2, type Paisa } from './money.js';
import {
  DEFAULT_OT_POLICY,
  type OvertimePolicy,
  type Payslip,
  type PayslipLine,
  type SalaryStructure,
} from './types.js';

/** Stamped onto every payslip so a rule change is traceable to the code that made it. */
export const PAYROLL_ENGINE_VERSION = '1.0.0';

export class PayrollError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PayrollError';
  }
}

export interface PayrollInput {
  organisationId: string;
  employeeId: string;
  periodYear: number;
  /** 1–12. */
  periodMonth: number;
  salary: SalaryStructure;
  /** Days of unpaid absence in the period. Drives proration. */
  lwpDays: number;
  /** Approved overtime hours in the period. */
  otHours: number;
  /** Highest hours worked in any single week of the period — checked against §102. */
  maxWeeklyHours?: number;
  /** Fixed recovery of a salary advance or loan. */
  advanceRecovery?: Paisa;
  otPolicy?: OvertimePolicy;
}

/**
 * Gross before proration: the sum of every earning component.
 * docs/04-payroll-spec.md §3.
 */
export function grossOf(s: SalaryStructure): Paisa {
  return s.basic + s.houseRent + s.medical + s.conveyance + s.food + s.dearness;
}

/**
 * Hourly rate used for overtime.
 *
 * P1-2 — THE EXPENSIVE ONE. §108 sets overtime at twice the ordinary rate of BASIC wage
 * (plus dearness where applicable). The proposal's phrase "twice the standard hourly rate"
 * reads as gross ÷ hours, which overpays every overtime hour on every payslip. On a
 * 30,000 basic / 50,000 gross salary that is a 67% overpayment per OT hour.
 */
export function otHourlyRate(s: SalaryStructure, policy: OvertimePolicy = DEFAULT_OT_POLICY): Paisa {
  const otBase = s.basic + s.dearness; // NOT grossOf(s)
  return round2(otBase / policy.standardMonthlyHours);
}

export function calculatePayslip(input: PayrollInput): Payslip {
  const policy = input.otPolicy ?? DEFAULT_OT_POLICY;
  const { salary, periodYear, periodMonth } = input;

  if (periodMonth < 1 || periodMonth > 12) {
    throw new PayrollError('BAD_PERIOD', `periodMonth must be 1-12, got ${periodMonth}`);
  }

  // P0-9 / spec §5: real calendar days in the month (28-31), never a fixed 30.
  const daysInPeriod = daysInMonth(periodYear, periodMonth);

  if (input.lwpDays < 0 || input.lwpDays > daysInPeriod) {
    throw new PayrollError(
      'BAD_LWP',
      `lwpDays must be 0-${daysInPeriod} for ${periodYear}-${periodMonth}, got ${input.lwpDays}`,
    );
  }
  if (input.otHours < 0) {
    throw new PayrollError('BAD_OT', `otHours cannot be negative, got ${input.otHours}`);
  }

  // §102: reject rather than silently pay beyond the statutory weekly ceiling.
  if (
    input.maxWeeklyHours !== undefined &&
    input.maxWeeklyHours > policy.maxWeeklyHoursIncludingOt
  ) {
    throw new PayrollError(
      'OT_LIMIT_EXCEEDED',
      `Weekly hours ${input.maxWeeklyHours} exceed the statutory ceiling of ` +
        `${policy.maxWeeklyHoursIncludingOt} (Bangladesh Labour Act 2006 §102). ` +
        `Payroll run rejected — correct the attendance record or record the excess as an exception.`,
    );
  }

  const payableDays = daysInPeriod - input.lwpDays;
  const lines: PayslipLine[] = [];

  // --- Earnings, each prorated and rounded at its own line (spec §8) ---
  const earnings: Array<[string, string, Paisa]> = [
    ['BASIC', 'Basic Salary', salary.basic],
    ['HRA', 'House Rent Allowance', salary.houseRent],
    ['MED', 'Medical Allowance', salary.medical],
    ['CONV', 'Conveyance Allowance', salary.conveyance],
    ['FOOD', 'Food Allowance', salary.food],
    ['DA', 'Dearness Allowance', salary.dearness],
  ];

  for (const [code, label, full] of earnings) {
    if (full === 0) continue;
    // Proration applies to EVERY earning component, not to basic alone (spec §5).
    const amount = applyRatio(full, payableDays, daysInPeriod);
    lines.push({ code, label, amount, sign: 1 });
  }

  // --- Overtime: NOT prorated. Hours worked were worked (spec §10, case 3). ---
  const otRate = otHourlyRate(salary, policy);
  if (input.otHours > 0) {
    const otPay = round2(otRate * policy.multiplier * input.otHours);
    lines.push({
      code: 'OT',
      label: `Overtime (${input.otHours}h @ ${policy.multiplier}x basic)`,
      amount: otPay,
      sign: 1,
    });
  }

  // --- Deductions ---
  // Provident fund is levied on the PRORATED basic, not the full basic: an employee on
  // three weeks of LWP has not earned a full month's basic to contribute from.
  if (salary.providentFundPct > 0) {
    const proratedBasic = applyRatio(salary.basic, payableDays, daysInPeriod);
    const pf = round2((proratedBasic * salary.providentFundPct) / 100);
    if (pf > 0) {
      lines.push({
        code: 'PF',
        label: `Provident Fund (${salary.providentFundPct}% of basic)`,
        amount: pf,
        sign: -1,
      });
    }
  }

  if (input.advanceRecovery && input.advanceRecovery > 0) {
    lines.push({
      code: 'ADV',
      label: 'Advance / Loan Recovery',
      amount: input.advanceRecovery,
      sign: -1,
    });
  }

  // NOTE: income tax (TDS) is deliberately out of MVP scope — see docs/04-payroll-spec.md §6.
  // Slabs are effective-dated reference data and a correct calculation needs the investment
  // rebate declaration workflow, which is a module in its own right. Claiming compliance we
  // have not built would be worse than scoping it out on the record.

  const gross = lines.filter((l) => l.sign === 1).reduce((a, l) => a + l.amount, 0);
  const totalDeductions = lines.filter((l) => l.sign === -1).reduce((a, l) => a + l.amount, 0);
  const netPay = gross - totalDeductions;

  const payslip: Payslip = {
    organisationId: input.organisationId,
    employeeId: input.employeeId,
    periodYear,
    periodMonth,
    salaryStructureId: salary.id,
    engineVersion: PAYROLL_ENGINE_VERSION,
    daysInPeriod,
    lwpDays: input.lwpDays,
    payableDays,
    otHours: input.otHours,
    otHourlyRate: otRate,
    lines,
    gross,
    totalDeductions,
    netPay,
  };

  assertPayslipBalances(payslip);
  return payslip;
}

/**
 * P0-8: a payslip that does not add up is never persisted.
 * Called before returning, and again by the repository before the INSERT.
 */
export function assertPayslipBalances(p: Payslip): void {
  const gross = p.lines.filter((l) => l.sign === 1).reduce((a, l) => a + l.amount, 0);
  const deductions = p.lines.filter((l) => l.sign === -1).reduce((a, l) => a + l.amount, 0);

  if (gross !== p.gross) {
    throw new PayrollError('IMBALANCE', `gross ${p.gross} != sum of earning lines ${gross}`);
  }
  if (deductions !== p.totalDeductions) {
    throw new PayrollError(
      'IMBALANCE',
      `totalDeductions ${p.totalDeductions} != sum of deduction lines ${deductions}`,
    );
  }
  if (p.netPay !== gross - deductions) {
    throw new PayrollError('IMBALANCE', `netPay ${p.netPay} != gross - deductions`);
  }
  if (p.payableDays !== p.daysInPeriod - p.lwpDays) {
    throw new PayrollError('IMBALANCE', 'payableDays != daysInPeriod - lwpDays');
  }
}

/**
 * Select the salary structure in force on the period start date.
 * Spec §10, case 14: a mid-month revision does not retroactively change the period.
 */
export function structureInForce(
  structures: SalaryStructure[],
  periodStart: string,
): SalaryStructure {
  const eligible = structures
    .filter((s) => s.effectiveFrom <= periodStart)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  if (eligible.length === 0) {
    throw new PayrollError(
      'NO_SALARY_STRUCTURE',
      `No salary structure effective on or before ${periodStart}`,
    );
  }
  return eligible[0]!;
}
