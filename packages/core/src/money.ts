/**
 * Money is integer paisa. Never a float.
 *
 * Rationale (docs/04-payroll-spec.md §8): floating point cannot represent 0.1 exactly,
 * so `0.1 + 0.2 !== 0.3`. Accumulating that error across payslip lines produces the
 * one-taka discrepancies that destroy trust in a payroll system.
 */

/** Integer paisa. 100 paisa = 1 BDT. */
export type Paisa = number;

export function taka(amount: number): Paisa {
  return Math.round(amount * 100);
}

export function toTaka(p: Paisa): number {
  return p / 100;
}

/**
 * Half-up rounding to whole paisa.
 *
 * `Math.round` is half-up for positives but half-*down* for negatives
 * (Math.round(-0.5) === -0), which would round deductions the wrong way.
 */
export function round2(p: number): Paisa {
  return p < 0 ? -Math.round(-p) : Math.round(p);
}

/**
 * Apply a ratio, rounding at this line item.
 *
 * docs/04-payroll-spec.md §8: round at each line, then sum. Summing unrounded values
 * and rounding the total gives a different answer, and only the per-line result matches
 * what the employee reads on their payslip.
 */
export function applyRatio(p: Paisa, numerator: number, denominator: number): Paisa {
  if (denominator === 0) throw new Error('applyRatio: denominator is zero');
  return round2((p * numerator) / denominator);
}

export function formatBDT(p: Paisa): string {
  const negative = p < 0;
  const abs = Math.abs(p);
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, '0');
  // Indian/Bangladeshi digit grouping: last 3 digits, then pairs (12,34,567.89)
  const digits = String(whole);
  let grouped: string;
  if (digits.length <= 3) {
    grouped = digits;
  } else {
    const last3 = digits.slice(-3);
    const rest = digits.slice(0, -3);
    grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
  }
  return `${negative ? '-' : ''}BDT ${grouped}.${fraction}`;
}
