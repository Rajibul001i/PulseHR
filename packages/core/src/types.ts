import type { DhakaDate } from './dates.js';
import type { Paisa } from './money.js';

export type UUID = string;

export type Role = 'EMPLOYEE' | 'MANAGER' | 'HR_ADMIN';

export type LeaveType = 'EARNED' | 'CASUAL' | 'SICK' | 'FESTIVAL' | 'MATERNITY' | 'LWP';

export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export type EmploymentStatus = 'ACTIVE' | 'RESIGNED' | 'TERMINATED';

/**
 * Salary structure, effective-dated and never overwritten.
 *
 * docs/04-payroll-spec.md §3: payroll for March 2026 must reproduce identically in 2029,
 * which requires the salary AS IT WAS, not as it is.
 */
export interface SalaryStructure {
  id: UUID;
  employeeId: UUID;
  effectiveFrom: DhakaDate;
  basic: Paisa;
  houseRent: Paisa;
  medical: Paisa;
  conveyance: Paisa;
  food: Paisa;
  /** Dearness / ad-hoc allowance. Part of the OT base (§108). */
  dearness: Paisa;
  /** Employee-side provident fund, as a percentage of basic. */
  providentFundPct: number;
}

export interface LeaveEntitlementPolicy {
  /** §117 — one day of earned leave per N days worked. Configurable; default 18. */
  earnedLeaveDaysPerWorkedDays: number;
  /** §117 — carry-forward ceiling for earned leave. Default 40. */
  earnedLeaveCarryForwardCap: number;
  /** §115 — casual leave days per year. Default 10, lapses annually. */
  casualLeaveDaysPerYear: number;
  /** §116 — sick leave days per year at full wages. Default 14. */
  sickLeaveDaysPerYear: number;
  /** §118 — festival holidays per year. Default 11. */
  festivalHolidaysPerYear: number;
}

export const DEFAULT_LEAVE_POLICY: LeaveEntitlementPolicy = {
  earnedLeaveDaysPerWorkedDays: 18,
  earnedLeaveCarryForwardCap: 40,
  casualLeaveDaysPerYear: 10,
  sickLeaveDaysPerYear: 14,
  festivalHolidaysPerYear: 11,
};

export interface OvertimePolicy {
  /** §108 — multiplier on the ordinary rate of BASIC wage. Default 2.0. */
  multiplier: number;
  /** Divisor for the monthly OT base. Default 208 (8h × 26d). */
  standardMonthlyHours: number;
  /** §100 — ordinary daily hours. Default 8. */
  maxOrdinaryDailyHours: number;
  /** §102 — hard weekly ceiling including overtime. Default 60. */
  maxWeeklyHoursIncludingOt: number;
}

export const DEFAULT_OT_POLICY: OvertimePolicy = {
  multiplier: 2.0,
  standardMonthlyHours: 208,
  maxOrdinaryDailyHours: 8,
  maxWeeklyHoursIncludingOt: 60,
};

/** A single append-only movement in the leave ledger. Balance is SUM(delta). */
export interface LeaveLedgerEntry {
  id: UUID;
  organisationId: UUID;
  employeeId: UUID;
  leaveType: LeaveType;
  /** Positive for accrual, negative for consumption. Never zero. */
  delta: number;
  effectiveDate: DhakaDate;
  reason: string;
  /** The leave_request that caused this movement, when applicable. */
  sourceRequestId?: UUID;
  createdBy: UUID;
  createdAt: string;
}

export interface LeaveRequest {
  id: UUID;
  organisationId: UUID;
  employeeId: UUID;
  leaveType: LeaveType;
  startDate: DhakaDate;
  endDate: DhakaDate;
  days: number;
  status: LeaveStatus;
  reason: string;
  decidedBy?: UUID;
  decidedAt?: string;
  createdAt: string;
}

export type PayslipLineSign = 1 | -1;

export interface PayslipLine {
  code: string;
  label: string;
  amount: Paisa;
  sign: PayslipLineSign;
}

/**
 * An issued payslip. Immutable after issue (P0-8, NFR-9).
 * A correction is a new adjustment payslip referencing this one — never an UPDATE.
 */
export interface Payslip {
  organisationId: UUID;
  employeeId: UUID;
  periodYear: number;
  periodMonth: number;
  salaryStructureId: UUID;
  engineVersion: string;
  daysInPeriod: number;
  lwpDays: number;
  payableDays: number;
  otHours: number;
  otHourlyRate: Paisa;
  lines: PayslipLine[];
  gross: Paisa;
  totalDeductions: Paisa;
  netPay: Paisa;
}
