/**
 * Leave accrual and balance. Pure (ADR-008).
 *
 * P0-7 / P1-1. The two corrections that live here:
 *   - Earned leave ACCRUES at 1 day per 18 days worked (§117). It is not a flat 21.
 *   - Balance is derived from an append-only ledger, never stored as a mutable column.
 */

import { inclusiveDayCount, type DhakaDate } from './dates.js';
import {
  DEFAULT_LEAVE_POLICY,
  type LeaveEntitlementPolicy,
  type LeaveLedgerEntry,
  type LeaveRequest,
  type LeaveType,
} from './types.js';

export class LeaveError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'LeaveError';
  }
}

/**
 * Balance = SUM(delta) over the ledger up to `asOf`.
 *
 * P0-7: never a stored column. A mutable balance drifts under concurrent approvals; a
 * ledger cannot. It also satisfies the proposal's own "fully auditable pipeline" objective
 * structurally rather than by policy.
 */
export function balanceOf(
  ledger: LeaveLedgerEntry[],
  leaveType: LeaveType,
  asOf?: DhakaDate,
): number {
  return ledger
    .filter((e) => e.leaveType === leaveType && (asOf === undefined || e.effectiveDate <= asOf))
    .reduce((sum, e) => sum + e.delta, 0);
}

/**
 * §117 — earned leave accrues at one day per N days actually worked.
 *
 * P1-1: the proposal's "21 days per year" is wrong twice over. The rate is 1-in-18
 * (≈20 days across a full year), and more importantly it is an ACCRUAL — someone who
 * joined in October has accrued ~3 days, not 21.
 *
 * `daysActuallyWorked` excludes LWP and unauthorised absence, and includes paid leave and
 * festival holidays, which count as service.
 *
 * Floor, not round: 17 days worked accrues 0, not 1.
 */
export function accrueEarnedLeave(
  daysActuallyWorked: number,
  policy: LeaveEntitlementPolicy = DEFAULT_LEAVE_POLICY,
): number {
  if (daysActuallyWorked < 0) {
    throw new LeaveError('BAD_INPUT', 'daysActuallyWorked cannot be negative');
  }
  return Math.floor(daysActuallyWorked / policy.earnedLeaveDaysPerWorkedDays);
}

/** §117 — carry-forward is capped (default 40 days). The excess lapses. */
export function applyCarryForwardCap(
  closingBalance: number,
  policy: LeaveEntitlementPolicy = DEFAULT_LEAVE_POLICY,
): { carried: number; lapsed: number } {
  const carried = Math.min(closingBalance, policy.earnedLeaveCarryForwardCap);
  return { carried, lapsed: Math.max(0, closingBalance - carried) };
}

/**
 * Annual grants for leave types that are given at year start rather than accrued,
 * pro-rated for anyone who joined mid-year.
 */
export function annualGrant(
  leaveType: LeaveType,
  monthsOfServiceInYear: number,
  policy: LeaveEntitlementPolicy = DEFAULT_LEAVE_POLICY,
): number {
  const months = Math.max(0, Math.min(12, monthsOfServiceInYear));
  switch (leaveType) {
    case 'CASUAL':
      return Math.floor((policy.casualLeaveDaysPerYear * months) / 12);
    case 'SICK':
      return Math.floor((policy.sickLeaveDaysPerYear * months) / 12);
    case 'FESTIVAL':
      return Math.floor((policy.festivalHolidaysPerYear * months) / 12);
    default:
      return 0;
  }
}

export function requestedDays(startDate: DhakaDate, endDate: DhakaDate): number {
  const n = inclusiveDayCount(startDate, endDate);
  if (n <= 0) throw new LeaveError('BAD_RANGE', 'endDate must be on or after startDate');
  return n;
}

/** Two inclusive date ranges overlap. */
export function rangesOverlap(
  aStart: DhakaDate,
  aEnd: DhakaDate,
  bStart: DhakaDate,
  bEnd: DhakaDate,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export interface ApprovalCheck {
  ok: boolean;
  code?: string;
  message?: string;
  balanceBefore: number;
  balanceAfter: number;
}

/**
 * The check that must run INSIDE the approval transaction, after `SELECT ... FOR UPDATE`
 * on the employee's ledger rows.
 *
 * P0-7: two managers approving overlapping requests, or one employee submitting two
 * requests that each individually fit the balance but together do not, will corrupt a
 * mutable balance. Neither source document mentions concurrency control — despite the
 * proposal choosing PostgreSQL specifically for ACID (§6.4) and then never using it.
 */
export function checkApproval(
  request: LeaveRequest,
  ledger: LeaveLedgerEntry[],
  otherApprovedRequests: LeaveRequest[],
): ApprovalCheck {
  const balanceBefore = balanceOf(ledger, request.leaveType);

  if (request.status !== 'PENDING') {
    return {
      ok: false,
      code: 'NOT_PENDING',
      message: `Request is ${request.status}, not PENDING`,
      balanceBefore,
      balanceAfter: balanceBefore,
    };
  }

  const overlap = otherApprovedRequests.find(
    (r) =>
      r.id !== request.id &&
      r.employeeId === request.employeeId &&
      r.status === 'APPROVED' &&
      rangesOverlap(request.startDate, request.endDate, r.startDate, r.endDate),
  );
  if (overlap) {
    return {
      ok: false,
      code: 'OVERLAPPING_LEAVE',
      message: `Overlaps approved leave ${overlap.startDate}..${overlap.endDate}`,
      balanceBefore,
      balanceAfter: balanceBefore,
    };
  }

  // LWP is unpaid and unlimited by definition — it is not drawn from a balance.
  if (request.leaveType === 'LWP') {
    return { ok: true, balanceBefore, balanceAfter: balanceBefore };
  }

  const balanceAfter = balanceBefore - request.days;
  if (balanceAfter < 0) {
    return {
      ok: false,
      code: 'INSUFFICIENT_BALANCE',
      message: `Requested ${request.days} day(s) against a balance of ${balanceBefore}`,
      balanceBefore,
      balanceAfter: balanceBefore,
    };
  }

  return { ok: true, balanceBefore, balanceAfter };
}
