import { describe, expect, it } from 'vitest';
import {
  accrueEarnedLeave,
  annualGrant,
  applyCarryForwardCap,
  balanceOf,
  checkApproval,
  rangesOverlap,
  requestedDays,
} from '../src/leave.js';
import { DEFAULT_LEAVE_POLICY, type LeaveLedgerEntry, type LeaveRequest } from '../src/types.js';

const ledgerEntry = (delta: number, date = '2026-01-01'): LeaveLedgerEntry => ({
  id: `l-${Math.abs(delta)}-${date}-${delta > 0 ? 'p' : 'n'}`,
  organisationId: 'org-1',
  employeeId: 'emp-1',
  leaveType: 'EARNED',
  delta,
  effectiveDate: date,
  reason: 'test',
  createdBy: 'sys',
  createdAt: '2026-01-01T00:00:00Z',
});

describe('earned leave accrual — §117 / P1-1', () => {
  /**
   * The proposal states "21 days per year for eligible employees". That is wrong twice:
   * the rate is 1-in-18 (~20 days across a full year), and it is an ACCRUAL, not a grant.
   */
  it('case 8: exactly 18 days worked accrues exactly 1 day', () => {
    expect(accrueEarnedLeave(18)).toBe(1);
  });

  it('case 9: 17 days worked accrues 0 — floor, not round', () => {
    expect(accrueEarnedLeave(17)).toBe(0);
    expect(accrueEarnedLeave(35)).toBe(1); // not 2
  });

  it('a full working year yields ~20 days, not the 21 the proposal claims', () => {
    expect(accrueEarnedLeave(360)).toBe(20);
    expect(accrueEarnedLeave(360)).not.toBe(21);
  });

  it('a mid-year joiner accrues proportionally, not a flat annual figure', () => {
    // Joined October: ~60 working days by year end
    expect(accrueEarnedLeave(60)).toBe(3);
  });

  it('honours a tenant-configured accrual rate', () => {
    // 1-in-15 applies to tea plantation and newspaper workers
    expect(accrueEarnedLeave(60, { ...DEFAULT_LEAVE_POLICY, earnedLeaveDaysPerWorkedDays: 15 })).toBe(4);
  });

  it('rejects a negative worked-day count', () => {
    expect(() => accrueEarnedLeave(-1)).toThrow(/negative/);
  });
});

describe('carry-forward cap — §117', () => {
  it('caps at 40 days and reports what lapsed', () => {
    expect(applyCarryForwardCap(55)).toEqual({ carried: 40, lapsed: 15 });
  });

  it('carries everything when under the cap', () => {
    expect(applyCarryForwardCap(12)).toEqual({ carried: 12, lapsed: 0 });
  });
});

describe('annual grants — §115, §116, §118', () => {
  it('grants the statutory full-year amounts', () => {
    expect(annualGrant('CASUAL', 12)).toBe(10);
    expect(annualGrant('SICK', 12)).toBe(14);
    expect(annualGrant('FESTIVAL', 12)).toBe(11);
  });

  it('pro-rates for a mid-year joiner', () => {
    expect(annualGrant('CASUAL', 6)).toBe(5);
    expect(annualGrant('SICK', 6)).toBe(7);
  });

  it('grants nothing for earned leave — that accrues instead', () => {
    expect(annualGrant('EARNED', 12)).toBe(0);
  });
});

describe('balance from the ledger — P0-7', () => {
  it('is the sum of deltas, never a stored column', () => {
    const ledger = [ledgerEntry(10, '2026-01-01'), ledgerEntry(-3, '2026-03-01'), ledgerEntry(5, '2026-06-01')];
    expect(balanceOf(ledger, 'EARNED')).toBe(12);
  });

  it('respects an as-of date', () => {
    const ledger = [ledgerEntry(10, '2026-01-01'), ledgerEntry(-3, '2026-03-01'), ledgerEntry(5, '2026-06-01')];
    expect(balanceOf(ledger, 'EARNED', '2026-04-01')).toBe(7);
  });

  it('does not mix leave types', () => {
    const ledger = [ledgerEntry(10), { ...ledgerEntry(99), leaveType: 'SICK' as const }];
    expect(balanceOf(ledger, 'EARNED')).toBe(10);
  });
});

describe('date ranges', () => {
  it('counts inclusively', () => {
    expect(requestedDays('2026-08-10', '2026-08-12')).toBe(3);
    expect(requestedDays('2026-08-10', '2026-08-10')).toBe(1);
  });

  it('rejects an inverted range', () => {
    expect(() => requestedDays('2026-08-12', '2026-08-10')).toThrow(/on or after/);
  });

  it('detects overlap including at the boundary', () => {
    expect(rangesOverlap('2026-08-01', '2026-08-05', '2026-08-05', '2026-08-09')).toBe(true);
    expect(rangesOverlap('2026-08-01', '2026-08-05', '2026-08-06', '2026-08-09')).toBe(false);
  });
});

describe('approval check — P0-7 concurrency', () => {
  const req = (over: Partial<LeaveRequest> = {}): LeaveRequest => ({
    id: 'req-1',
    organisationId: 'org-1',
    employeeId: 'emp-1',
    leaveType: 'EARNED',
    startDate: '2026-08-10',
    endDate: '2026-08-12',
    days: 3,
    status: 'PENDING',
    reason: 'family',
    createdAt: '2026-08-01T00:00:00Z',
    ...over,
  });

  it('approves when the balance covers the request', () => {
    const r = checkApproval(req(), [ledgerEntry(10)], []);
    expect(r.ok).toBe(true);
    expect(r.balanceAfter).toBe(7);
  });

  it('case 1: rejects against a zero balance and leaves it unchanged', () => {
    const r = checkApproval(req(), [], []);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('INSUFFICIENT_BALANCE');
    expect(r.balanceAfter).toBe(0);
  });

  it('allows a request that exactly exhausts the balance', () => {
    const r = checkApproval(req(), [ledgerEntry(3)], []);
    expect(r.ok).toBe(true);
    expect(r.balanceAfter).toBe(0);
  });

  it('case 10: the SECOND of two concurrent requests is rejected — balance never goes negative', () => {
    // Balance is 5. Two 3-day requests each look affordable in isolation.
    const ledger = [ledgerEntry(5)];
    const first = req({ id: 'req-1', startDate: '2026-08-10', endDate: '2026-08-12' });
    const second = req({ id: 'req-2', startDate: '2026-08-20', endDate: '2026-08-22' });

    const a = checkApproval(first, ledger, []);
    expect(a.ok).toBe(true);

    // First approval appends its consumption row; the second re-checks INSIDE the lock.
    const ledgerAfterFirst = [...ledger, { ...ledgerEntry(-3, '2026-08-10'), sourceRequestId: 'req-1' }];
    const b = checkApproval(second, ledgerAfterFirst, [{ ...first, status: 'APPROVED' }]);

    expect(b.ok).toBe(false);
    expect(b.code).toBe('INSUFFICIENT_BALANCE');
    expect(balanceOf(ledgerAfterFirst, 'EARNED')).toBe(2); // never negative
  });

  it('rejects a request overlapping already-approved leave', () => {
    const approved = req({ id: 'req-0', status: 'APPROVED', startDate: '2026-08-11', endDate: '2026-08-15' });
    const r = checkApproval(req(), [ledgerEntry(30)], [approved]);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('OVERLAPPING_LEAVE');
  });

  it('ignores overlaps belonging to a different employee', () => {
    const other = req({ id: 'req-9', employeeId: 'emp-2', status: 'APPROVED' });
    const r = checkApproval(req(), [ledgerEntry(30)], [other]);
    expect(r.ok).toBe(true);
  });

  it('refuses to re-approve a request that is not pending', () => {
    const r = checkApproval(req({ status: 'APPROVED' }), [ledgerEntry(30)], []);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('NOT_PENDING');
  });

  it('does not draw LWP from a balance — it is unpaid and unlimited', () => {
    const r = checkApproval(req({ leaveType: 'LWP' }), [], []);
    expect(r.ok).toBe(true);
  });
});
