import { describe, expect, it } from 'vitest';
import {
  calculatePayslip,
  grossOf,
  otHourlyRate,
  PayrollError,
  structureInForce,
  type PayrollInput,
} from '../src/payroll.js';
import { formatBDT, taka, toTaka } from '../src/money.js';
import { DEFAULT_OT_POLICY, type SalaryStructure } from '../src/types.js';

/** Basic 30,000 · HRA 15,000 · Medical 2,000 · Conveyance 2,000 · Food 1,000 => gross 50,000 */
const salary: SalaryStructure = {
  id: 'sal-1',
  employeeId: 'emp-1',
  effectiveFrom: '2025-01-01',
  basic: taka(30_000),
  houseRent: taka(15_000),
  medical: taka(2_000),
  conveyance: taka(2_000),
  food: taka(1_000),
  dearness: taka(0),
  providentFundPct: 0,
};

const base: PayrollInput = {
  organisationId: 'org-1',
  employeeId: 'emp-1',
  periodYear: 2026,
  periodMonth: 8, // August — 31 days
  salary,
  lwpDays: 0,
  otHours: 0,
};

describe('gross', () => {
  it('sums every earning component', () => {
    expect(toTaka(grossOf(salary))).toBe(50_000);
  });
});

describe('overtime base — P1-2, the expensive defect', () => {
  /**
   * §108 sets overtime at twice the ordinary rate of BASIC wage. The proposal's phrase
   * "twice the standard hourly rate" reads as gross-based, which overpays every OT hour.
   */
  it('computes the OT rate from basic + dearness, NOT gross', () => {
    const rate = otHourlyRate(salary);
    // 30,000 / 208 = 144.23
    expect(toTaka(rate)).toBeCloseTo(144.23, 2);
  });

  it('demonstrates the overpayment the gross-based reading would cause', () => {
    const hours = 10;
    // Computed from the unrounded rates so the comparison isolates the BASE, not rounding.
    const correctPay = (30_000 / 208) * 2 * hours; // basic-based — correct, §108
    const wrongPay = (50_000 / 208) * 2 * hours; // gross-based — the proposal's wording

    expect(correctPay).toBeCloseTo(2_884.62, 1);
    expect(wrongPay).toBeCloseTo(4_807.69, 1);
    // 67% overpayment on every overtime hour, on every payslip
    expect(wrongPay / correctPay).toBeCloseTo(50_000 / 30_000, 5);
    expect(wrongPay - correctPay).toBeCloseTo(1_923.08, 1);

    // And the engine implements the correct one.
    expect(toTaka(otHourlyRate(salary)) * 2 * hours).toBeCloseTo(correctPay, 0);
  });

  it('includes dearness in the OT base, per §108', () => {
    const withDa = { ...salary, dearness: taka(6_000) };
    // (30,000 + 6,000) / 208 = 173.08
    expect(toTaka(otHourlyRate(withDa))).toBeCloseTo(173.08, 2);
  });
});

describe('payslip — clean month', () => {
  const p = calculatePayslip(base);

  it('pays full gross with no LWP', () => {
    expect(toTaka(p.gross)).toBe(50_000);
    expect(toTaka(p.netPay)).toBe(50_000);
  });

  it('uses the real number of days in August', () => {
    expect(p.daysInPeriod).toBe(31);
    expect(p.payableDays).toBe(31);
  });

  it('stamps the engine version so a rule change is traceable — P0-8', () => {
    expect(p.engineVersion).toBe('1.0.0');
    expect(p.salaryStructureId).toBe('sal-1');
  });

  it('itemises every earning as its own line — P0-8', () => {
    expect(p.lines.map((l) => l.code)).toEqual(['BASIC', 'HRA', 'MED', 'CONV', 'FOOD']);
  });
});

describe('boundary cases — docs/04-payroll-spec.md §10', () => {
  it('case 2: full-month LWP yields net zero but still issues a payslip', () => {
    const p = calculatePayslip({ ...base, lwpDays: 31 });
    expect(p.payableDays).toBe(0);
    expect(p.gross).toBe(0);
    expect(p.netPay).toBe(0);
    // The component lines are retained at zero rather than omitted: an employee on full
    // LWP should see "Basic Salary 0.00", not a blank payslip. Auditability over tidiness.
    expect(p.lines.map((l) => l.code)).toEqual(['BASIC', 'HRA', 'MED', 'CONV', 'FOOD']);
    expect(p.lines.every((l) => l.amount === 0)).toBe(true);
  });

  it('case 3: LWP and OT in the same month — proration does NOT touch OT pay', () => {
    const p = calculatePayslip({ ...base, lwpDays: 10, otHours: 10 });
    // Earnings prorated 21/31
    const basicLine = p.lines.find((l) => l.code === 'BASIC')!;
    expect(toTaka(basicLine.amount)).toBeCloseTo(30_000 * (21 / 31), 2);

    // OT paid in full: hours worked were worked
    const otLine = p.lines.find((l) => l.code === 'OT')!;
    expect(toTaka(otLine.amount)).toBeCloseTo(2_884.62, 1);
  });

  it('case 4: February divides by 28, not a fixed 30', () => {
    const p = calculatePayslip({ ...base, periodMonth: 2, lwpDays: 4 });
    expect(p.daysInPeriod).toBe(28);
    const basicLine = p.lines.find((l) => l.code === 'BASIC')!;
    expect(toTaka(basicLine.amount)).toBeCloseTo(30_000 * (24 / 28), 2);
    // A fixed-30 divisor would have paid 30,000 * 24/30 = 24,000 — short by 1,714
    expect(toTaka(basicLine.amount)).not.toBeCloseTo(24_000, 0);
  });

  it('case 4b: leap February uses 29 days', () => {
    const p = calculatePayslip({ ...base, periodYear: 2028, periodMonth: 2 });
    expect(p.daysInPeriod).toBe(29);
  });

  it('case 7: overtime beyond the §102 weekly ceiling is REJECTED, not silently paid', () => {
    expect(() => calculatePayslip({ ...base, otHours: 40, maxWeeklyHours: 65 })).toThrow(
      PayrollError,
    );
    try {
      calculatePayslip({ ...base, otHours: 40, maxWeeklyHours: 65 });
    } catch (e) {
      expect((e as PayrollError).code).toBe('OT_LIMIT_EXCEEDED');
      expect((e as Error).message).toContain('§102');
    }
  });

  it('case 7b: exactly at the 60-hour ceiling is allowed', () => {
    expect(() =>
      calculatePayslip({ ...base, otHours: 12, maxWeeklyHours: DEFAULT_OT_POLICY.maxWeeklyHoursIncludingOt }),
    ).not.toThrow();
  });

  it('case 11: stored totals always reconcile against the lines', () => {
    const p = calculatePayslip({ ...base, lwpDays: 3, otHours: 7 });
    const gross = p.lines.filter((l) => l.sign === 1).reduce((a, l) => a + l.amount, 0);
    const ded = p.lines.filter((l) => l.sign === -1).reduce((a, l) => a + l.amount, 0);
    expect(p.gross).toBe(gross);
    expect(p.totalDeductions).toBe(ded);
    expect(p.netPay).toBe(gross - ded);
  });

  it('case 13: rounds at each line then sums, matching the printed payslip', () => {
    // 33.333% proration produces repeating decimals on every component
    const odd: SalaryStructure = { ...salary, basic: taka(10_000.005), houseRent: taka(5_000.005) };
    const p = calculatePayslip({ ...base, salary: odd, periodMonth: 4, lwpDays: 10 }); // 20/30
    for (const line of p.lines) {
      expect(Number.isInteger(line.amount)).toBe(true); // whole paisa, no float dust
    }
    expect(Number.isInteger(p.netPay)).toBe(true);
  });

  it('case 14: uses the salary structure in force at the period START', () => {
    const older: SalaryStructure = { ...salary, id: 'sal-old', effectiveFrom: '2024-01-01', basic: taka(20_000) };
    const newer: SalaryStructure = { ...salary, id: 'sal-new', effectiveFrom: '2026-08-15', basic: taka(40_000) };
    const chosen = structureInForce([older, salary, newer], '2026-08-01');
    expect(chosen.id).toBe('sal-1'); // not sal-new — the 15 Aug revision does not apply
  });

  it('throws when no salary structure covers the period', () => {
    const future: SalaryStructure = { ...salary, effectiveFrom: '2027-01-01' };
    expect(() => structureInForce([future], '2026-08-01')).toThrow(/No salary structure/);
  });
});

describe('deductions', () => {
  it('levies provident fund on prorated basic, not full basic', () => {
    const withPf: SalaryStructure = { ...salary, providentFundPct: 10 };
    const p = calculatePayslip({ ...base, salary: withPf, lwpDays: 10 }); // 21/31 payable
    const pf = p.lines.find((l) => l.code === 'PF')!;
    const proratedBasic = 30_000 * (21 / 31);
    expect(toTaka(pf.amount)).toBeCloseTo(proratedBasic * 0.1, 1);
    expect(pf.sign).toBe(-1);
  });

  it('subtracts advance recovery from net pay', () => {
    const p = calculatePayslip({ ...base, advanceRecovery: taka(5_000) });
    expect(toTaka(p.totalDeductions)).toBe(5_000);
    expect(toTaka(p.netPay)).toBe(45_000);
  });
});

describe('input validation', () => {
  it('rejects LWP days beyond the length of the month', () => {
    expect(() => calculatePayslip({ ...base, lwpDays: 32 })).toThrow(/BAD_LWP|must be 0-31/);
  });

  it('rejects a negative LWP count', () => {
    expect(() => calculatePayslip({ ...base, lwpDays: -1 })).toThrow(PayrollError);
  });

  it('rejects negative overtime', () => {
    expect(() => calculatePayslip({ ...base, otHours: -5 })).toThrow(PayrollError);
  });

  it('rejects an out-of-range month', () => {
    expect(() => calculatePayslip({ ...base, periodMonth: 13 })).toThrow(PayrollError);
    try {
      calculatePayslip({ ...base, periodMonth: 13 });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as PayrollError).code).toBe('BAD_PERIOD');
    }
  });
});

describe('money formatting', () => {
  it('uses Bangladeshi digit grouping', () => {
    expect(formatBDT(taka(1_234_567.89))).toBe('BDT 12,34,567.89');
    expect(formatBDT(taka(50_000))).toBe('BDT 50,000.00');
    expect(formatBDT(taka(999))).toBe('BDT 999.00');
  });

  it('never uses floating point for money', () => {
    expect(taka(0.1) + taka(0.2)).toBe(taka(0.3)); // 10 + 20 === 30, exactly
    expect(0.1 + 0.2).not.toBe(0.3); // the reason we do the above
  });
});
