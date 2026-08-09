import { describe, expect, it } from 'vitest';
import {
  bandOf,
  evaluate,
  FEATURES,
  MODEL_ACCEPTANCE,
  scoreEmployee,
  tenureMilestoneProximity,
  type AttritionFeatureInput,
  type LabelledCase,
} from '../src/attrition.js';

const neutral: AttritionFeatureInput = {
  employeeId: 'emp-1',
  asOf: '2026-08-02',
  tenureMonths: 7,
  unplannedWeekendAdjacentAbsences90d: 0,
  latenessMinutesAvgLast60d: 5,
  latenessMinutesAvgPrior60d: 5,
  departmentLatenessStdDev: 8,
  leaveDaysConsumed90d: 0,
  leaveBalanceAtWindowStart: 12,
  monthsSinceLastSalaryIncrease: 3,
  daysSinceManagerChange: null,
  otHoursPerMonthAvg90d: 0,
  okrUpdatesThisCycle: 8,
  okrUpdatesPrevCycle: 8,
};

describe('feature set integrity', () => {
  it('weights total exactly 100', () => {
    expect(FEATURES.reduce((a, f) => a + f.weight, 0)).toBe(100);
  });

  it('deliberately EXCLUDES review_score_delta — P1-5 bias laundering', () => {
    const keys = FEATURES.map((f) => f.key) as string[];
    expect(keys).not.toContain('review_score_delta');
    expect(keys).not.toContain('performance_review_score');
  });

  it('every feature carries a rationale — a bare number is never displayed', () => {
    for (const f of FEATURES) {
      expect(f.rationale.length).toBeGreaterThan(20);
    }
  });
});

describe('score range — P1-17', () => {
  it('is an integer 0-100, never 0-1', () => {
    const r = scoreEmployee(neutral);
    expect(Number.isInteger(r.score)).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it('a neutral employee scores low', () => {
    const r = scoreEmployee(neutral);
    expect(r.score).toBeLessThan(20);
    expect(r.band).toBe('LOW');
  });

  it('an employee triggering every signal saturates near 100', () => {
    const worst: AttritionFeatureInput = {
      ...neutral,
      tenureMonths: 12,
      unplannedWeekendAdjacentAbsences90d: 6,
      latenessMinutesAvgLast60d: 40,
      latenessMinutesAvgPrior60d: 5,
      departmentLatenessStdDev: 8,
      leaveDaysConsumed90d: 12,
      leaveBalanceAtWindowStart: 12,
      monthsSinceLastSalaryIncrease: 30,
      daysSinceManagerChange: 5,
      otHoursPerMonthAvg90d: 50,
      okrUpdatesThisCycle: 0,
      okrUpdatesPrevCycle: 10,
    };
    const r = scoreEmployee(worst);
    expect(r.score).toBeGreaterThanOrEqual(95);
    expect(r.band).toBe('HIGH');
  });
});

describe('explainability — P0-4 / spec §9', () => {
  it('contributions sum to the score', () => {
    const r = scoreEmployee({ ...neutral, tenureMonths: 12, unplannedWeekendAdjacentAbsences90d: 2 });
    const summed = r.contributions.reduce((a, c) => a + c.normalised * c.weight, 0);
    expect(Math.round(summed)).toBe(r.score);
  });

  it('returns one contribution per feature, sorted by impact', () => {
    const r = scoreEmployee({ ...neutral, tenureMonths: 12 });
    expect(r.contributions).toHaveLength(FEATURES.length);
    for (let i = 1; i < r.contributions.length; i++) {
      expect(r.contributions[i - 1]!.points).toBeGreaterThanOrEqual(r.contributions[i]!.points);
    }
  });

  it('names tenure as the top driver for an employee at 12 months', () => {
    const r = scoreEmployee({ ...neutral, tenureMonths: 12 });
    expect(r.contributions[0]!.key).toBe('tenure_milestone_proximity');
  });

  it('stamps the engine version on every score', () => {
    expect(scoreEmployee(neutral).engineVersion).toBe('1.0.0-scorecard');
  });
});

describe('F1 tenure milestone proximity', () => {
  it('peaks exactly at 12 and 24 months', () => {
    expect(tenureMilestoneProximity(12)).toBeCloseTo(1, 5);
    expect(tenureMilestoneProximity(24)).toBeCloseTo(1, 5);
  });

  it('falls away between milestones', () => {
    expect(tenureMilestoneProximity(18)).toBeLessThan(0.1);
  });

  it('does not flag a new joiner as "approaching 12 months"', () => {
    expect(tenureMilestoneProximity(2)).toBe(0);
    expect(tenureMilestoneProximity(5)).toBe(0);
  });
});

describe('F3 lateness is department-normalised', () => {
  it('ignores improvement', () => {
    const r = scoreEmployee({ ...neutral, latenessMinutesAvgLast60d: 2, latenessMinutesAvgPrior60d: 20 });
    const c = r.contributions.find((x) => x.key === 'lateness_trend_z')!;
    expect(c.normalised).toBe(0);
  });

  it('does not flag a whole team with a shared commute problem', () => {
    // +10 min against a department that already varies by 30 min => weak signal
    const wide = scoreEmployee({
      ...neutral,
      latenessMinutesAvgLast60d: 15,
      latenessMinutesAvgPrior60d: 5,
      departmentLatenessStdDev: 30,
    });
    // Same +10 min in a punctual department => stronger signal
    const tight = scoreEmployee({
      ...neutral,
      latenessMinutesAvgLast60d: 15,
      latenessMinutesAvgPrior60d: 5,
      departmentLatenessStdDev: 3,
    });
    const w = wide.contributions.find((x) => x.key === 'lateness_trend_z')!.normalised;
    const t = tight.contributions.find((x) => x.key === 'lateness_trend_z')!.normalised;
    expect(t).toBeGreaterThan(w);
  });
});

describe('F2 absence pattern does not penalise illness volume', () => {
  it('keys on weekend-adjacent single-day absences, not total sick days', () => {
    const c = scoreEmployee({ ...neutral, unplannedWeekendAdjacentAbsences90d: 4 }).contributions.find(
      (x) => x.key === 'unplanned_absence_pattern',
    )!;
    expect(c.normalised).toBe(1);
    // The input carries no "total sick days" field at all — by design.
    expect(Object.keys(neutral)).not.toContain('sickDaysTaken');
  });
});

describe('bands', () => {
  it('maps score to band at the documented thresholds', () => {
    expect(bandOf(0)).toBe('LOW');
    expect(bandOf(39)).toBe('LOW');
    expect(bandOf(40)).toBe('MODERATE');
    expect(bandOf(59)).toBe('MODERATE');
    expect(bandOf(60)).toBe('ELEVATED');
    expect(bandOf(79)).toBe('ELEVATED');
    expect(bandOf(80)).toBe('HIGH');
    expect(bandOf(100)).toBe('HIGH');
  });
});

describe('evaluation — P1-14 / P1-15', () => {
  /**
   * Synthetic validation set standing in for the 40 interview-derived scenarios of
   * spec §8. 12 positives / 28 negatives => a 30% base rate.
   */
  function buildCases(): LabelledCase[] {
    const cases: LabelledCase[] = [];
    for (let i = 0; i < 12; i++) {
      cases.push({
        employeeId: `leaver-${i}`,
        resignedWithin90d: true,
        features: {
          ...neutral,
          employeeId: `leaver-${i}`,
          tenureMonths: 12 + (i % 2) * 12,
          unplannedWeekendAdjacentAbsences90d: 3 + (i % 2),
          latenessMinutesAvgLast60d: 25,
          latenessMinutesAvgPrior60d: 6,
          leaveDaysConsumed90d: 9,
          monthsSinceLastSalaryIncrease: 26,
          otHoursPerMonthAvg90d: 35,
          okrUpdatesThisCycle: 1,
          okrUpdatesPrevCycle: 9,
        },
      });
    }
    for (let i = 0; i < 28; i++) {
      cases.push({
        employeeId: `stayer-${i}`,
        resignedWithin90d: false,
        features: {
          ...neutral,
          employeeId: `stayer-${i}`,
          tenureMonths: 6 + (i % 5),
          monthsSinceLastSalaryIncrease: 4,
        },
      });
    }
    return cases;
  }

  it('reports precision@k, base rate and lift — never accuracy', () => {
    const r = evaluate(buildCases(), 10);
    expect(r.n).toBe(40);
    expect(r.positives).toBe(12);
    expect(r.baseRate).toBeCloseTo(0.3, 3);
    expect(r.precisionAtK).toBe(1);
    expect(r).not.toHaveProperty('accuracy');
  });

  it('the scorecard meets its acceptance criteria on this set', () => {
    const r = evaluate(buildCases(), 10);
    expect(r.lift).toBeGreaterThanOrEqual(MODEL_ACCEPTANCE.minPrecisionLiftMultiple);
    expect(r.meetsAcceptance).toBe(true);
  });

  it('beats the trivial "flag everyone at 11-13 months" baseline', () => {
    const r = evaluate(buildCases(), 10);
    expect(r.precisionAtK).toBeGreaterThan(r.baselinePrecisionAtK);
  });

  it('a model with no signal FAILS acceptance — the criterion is real', () => {
    // Every case identical => the ranking is arbitrary and precision collapses to base rate.
    const flat: LabelledCase[] = Array.from({ length: 40 }, (_, i) => ({
      employeeId: `e-${i}`,
      resignedWithin90d: i < 12,
      features: { ...neutral, employeeId: `e-${i}` },
    }));
    const r = evaluate(flat, 10);
    expect(r.lift).toBeLessThan(MODEL_ACCEPTANCE.minPrecisionLiftMultiple);
    expect(r.meetsAcceptance).toBe(false);
  });

  it('requires 80 separation events before a fitted regression may replace the scorecard', () => {
    expect(MODEL_ACCEPTANCE.minSeparationEventsForRegression).toBe(80);
  });
});
