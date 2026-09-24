import { describe, expect, it } from 'vitest';
import {
  BIAS_GAP_THRESHOLD,
  runBiasAudit,
  tenureBandOf,
  type AuditSubject,
} from '../src/fairness.js';

const person = (score: number, gender: string | null, department: string | null, tenureMonths = 24): AuditSubject => ({
  score,
  gender,
  department,
  tenureMonths,
});

const dim = (report: ReturnType<typeof runBiasAudit>, d: string) => report.dimensions.find((x) => x.dimension === d)!;

describe('bias audit — spec §9', () => {
  it('bands tenure at 12 and 36 months', () => {
    expect(tenureBandOf(11)).toBe('Under 1 year');
    expect(tenureBandOf(12)).toBe('1 to 3 years');
    expect(tenureBandOf(36)).toBe('1 to 3 years');
    expect(tenureBandOf(37)).toBe('Over 3 years');
  });

  it('does not flag groups whose scores are the same', () => {
    const report = runBiasAudit([
      person(40, 'F', 'Sales'), person(42, 'F', 'Sales'), person(38, 'F', 'Ops'),
      person(41, 'M', 'Ops'), person(39, 'M', 'Ops'), person(40, 'M', 'Sales'),
    ]);
    expect(report.flagged).toBe(false);
    expect(dim(report, 'gender').adjustedGap).toBeLessThanOrEqual(BIAS_GAP_THRESHOLD);
  });

  it('flags a gender gap above the threshold within the same tenure band', () => {
    const report = runBiasAudit([
      person(60, 'F', 'Sales'), person(62, 'F', 'Ops'), person(58, 'F', 'Sales'),
      person(40, 'M', 'Ops'), person(42, 'M', 'Sales'), person(38, 'M', 'Ops'),
    ]);
    expect(dim(report, 'gender').flagged).toBe(true);
    expect(dim(report, 'gender').adjustedGap).toBe(20);
    expect(report.flagged).toBe(true);
  });

  it('does not flag a raw gap that tenure explains', () => {
    // Everyone under a year scores 70, everyone over three years scores 30. Women are
    // mostly new joiners, so the raw gender gap is large — but within each band it is zero.
    const report = runBiasAudit([
      person(70, 'F', 'Sales', 6), person(70, 'F', 'Sales', 8), person(70, 'F', 'Ops', 10), person(30, 'F', 'Ops', 60),
      person(70, 'M', 'Ops', 9), person(30, 'M', 'Ops', 48), person(30, 'M', 'Sales', 50), person(30, 'M', 'Sales', 70),
    ]);
    const gender = dim(report, 'gender');
    expect(gender.rawGap).toBe(20);
    expect(gender.adjustedGap).toBe(0);
    expect(gender.flagged).toBe(false);
  });

  it('reports groups below the minimum size but does not compare them', () => {
    const report = runBiasAudit([
      person(40, 'F', 'Sales'), person(40, 'F', 'Sales'), person(40, 'F', 'Sales'),
      person(90, 'M', 'Legal'), person(90, 'M', 'Legal'),
    ]);
    const legal = dim(report, 'department').groups.find((g) => g.group === 'Legal')!;
    expect(legal.n).toBe(2);
    expect(legal.compared).toBe(false);
    expect(dim(report, 'department').flagged).toBe(false);
  });

  it('never flags the tenure dimension, because tenure is a deliberate feature', () => {
    const report = runBiasAudit([
      person(80, 'F', 'Ops', 6), person(80, 'M', 'Ops', 7), person(80, 'F', 'Ops', 8),
      person(20, 'M', 'Ops', 60), person(20, 'F', 'Ops', 70), person(20, 'M', 'Ops', 80),
    ]);
    expect(dim(report, 'tenure').rawGap).toBe(60);
    expect(dim(report, 'tenure').flagged).toBe(false);
  });

  it('does not treat a missing gender as a group to compare', () => {
    const report = runBiasAudit([
      person(90, null, 'Ops'), person(90, null, 'Ops'), person(90, null, 'Ops'),
      person(30, 'F', 'Ops'), person(30, 'F', 'Ops'), person(30, 'F', 'Ops'),
    ]);
    expect(dim(report, 'gender').flagged).toBe(false);
    expect(report.notes.join(' ')).toMatch(/no date of birth/);
  });

  it('handles an organisation with no scores', () => {
    const report = runBiasAudit([]);
    expect(report.subjects).toBe(0);
    expect(report.flagged).toBe(false);
  });
});
