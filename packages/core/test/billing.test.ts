import { describe, expect, it } from 'vitest';
import { previewPlanChange } from '../src/billing.js';

describe('previewPlanChange', () => {
  it('changing on the 1st of the month prorates the full month (no discount for the switch)', () => {
    const p = previewPlanChange('STARTER', 'GROWTH', '2026-08-01');
    expect(p.changeType).toBe('UPGRADE');
    expect(p.daysRemaining).toBe(31);
    expect(p.daysInMonth).toBe(31);
    expect(p.unusedCreditPaisa).toBe(25_000_00);
    expect(p.newChargePaisa).toBe(50_000_00);
    expect(p.netDuePaisa).toBe(25_000_00);
  });

  it('changing on the last day of the month prorates to a single day', () => {
    const p = previewPlanChange('STARTER', 'GROWTH', '2026-08-31');
    expect(p.daysRemaining).toBe(1);
    expect(p.unusedCreditPaisa).toBe(Math.round(25_000_00 / 31));
    expect(p.newChargePaisa).toBe(Math.round(50_000_00 / 31));
    expect(p.netDuePaisa).toBe(p.newChargePaisa - p.unusedCreditPaisa);
  });

  it('a downgrade issues a credit (negative net due), not a charge', () => {
    const p = previewPlanChange('ENTERPRISE', 'STARTER', '2026-08-16');
    expect(p.changeType).toBe('DOWNGRADE');
    expect(p.daysRemaining).toBe(16);
    expect(p.netDuePaisa).toBeLessThan(0);
    expect(p.unusedCreditPaisa).toBeGreaterThan(p.newChargePaisa);
  });

  it('refuses to price a no-op change', () => {
    expect(() => previewPlanChange('GROWTH', 'GROWTH', '2026-08-10')).toThrow();
  });

  it('an upgrade always nets a positive charge, a downgrade always nets a credit or zero', () => {
    for (const day of ['2026-08-01', '2026-08-10', '2026-08-31']) {
      expect(previewPlanChange('STARTER', 'ENTERPRISE', day).netDuePaisa).toBeGreaterThan(0);
      expect(previewPlanChange('ENTERPRISE', 'STARTER', day).netDuePaisa).toBeLessThan(0);
    }
  });
});
