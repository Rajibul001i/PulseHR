/**
 * Attrition Risk Engine — v1 expert-weighted scorecard.
 *
 * Implements docs/05-attrition-risk-spec.md. Pure (ADR-008).
 *
 * WHY THIS IS NOT A TRAINED MODEL (P0-4):
 * The source deck says signals are "weighted by historical correlation with resignations"
 * and the proposal names logistic regression. A new PulseHR installation has ZERO
 * historical resignations — there is no label to regress against. A 50-person survey and
 * two HR interviews produce opinions, not labelled separation events.
 *
 * So v1 ships a transparent scorecard with expert-set weights. Not because it is easier:
 * because it is the only correct thing to ship without labels, and because it is
 * AUDITABLE, which a fitted regression is not. The system collects the data that would
 * let it become a learned model, and the promotion criterion is written down NOW
 * (see `MODEL_PROMOTION_CRITERION`) so it cannot be fudged later.
 */

import type { DhakaDate } from './dates.js';

export const SCORING_ENGINE_VERSION = '1.0.0-scorecard';

/** P1-17: the proposal says 1.0, the deck says 0-100. It is 0-100, everywhere. */
export type RiskScore = number;

export type RiskBand = 'LOW' | 'MODERATE' | 'ELEVATED' | 'HIGH';

export type FeatureKey =
  | 'tenure_milestone_proximity'
  | 'unplanned_absence_pattern'
  | 'lateness_trend_z'
  | 'leave_balance_drawdown'
  | 'no_recent_promotion_or_raise'
  | 'manager_change_recent'
  | 'overtime_sustained'
  | 'okr_engagement_drop';

export interface FeatureDefinition {
  key: FeatureKey;
  label: string;
  weight: number;
  /** Shown to HR beside the contribution. Every number must be explainable. */
  rationale: string;
}

/**
 * v1 feature set. Weights sum to 100 — asserted at module load.
 *
 * DELIBERATELY EXCLUDED — `review_score_delta`, the signal deck slide 30 lists first.
 * Proposal §3a states performance reviews are corrupted by "favoritism or bias", and §4b
 * promises to REMOVE that bias. Feeding those same scores into the risk model would
 * launder the bias into an algorithmic output that looks objective. It is admitted only
 * once a bias audit shows review scores are independent of gender and department after
 * controlling for role (spec §9).
 */
export const FEATURES: FeatureDefinition[] = [
  {
    key: 'tenure_milestone_proximity',
    label: 'Approaching a tenure milestone',
    weight: 25,
    rationale: 'Resignation risk spikes near the 12- and 24-month marks. Strongest, least gameable signal.',
  },
  {
    key: 'unplanned_absence_pattern',
    label: 'Unplanned absences adjacent to weekends',
    weight: 20,
    rationale:
      'Single-day unplanned absences next to a weekend — a pattern associated with interviewing. ' +
      'Deliberately NOT raw leave volume, which would penalise illness and caregiving.',
  },
  {
    key: 'lateness_trend_z',
    label: 'Rising lateness vs. department',
    weight: 15,
    rationale: 'Change in lateness, z-scored within department so a shared commute problem does not flag a whole team.',
  },
  {
    key: 'leave_balance_drawdown',
    label: 'Rapid leave balance drawdown',
    weight: 15,
    rationale: 'Consuming accrued leave quickly often precedes an exit.',
  },
  {
    key: 'no_recent_promotion_or_raise',
    label: 'Compensation stagnation',
    weight: 10,
    rationale: 'No salary increase in 24 months. Objective, derived from salary-structure history.',
  },
  {
    key: 'manager_change_recent',
    label: 'Recent manager change',
    weight: 5,
    rationale: 'People leave managers. Objective, derived from org history.',
  },
  {
    key: 'overtime_sustained',
    label: 'Sustained overtime',
    weight: 5,
    rationale: 'Sustained overtime above threshold — a burnout proxy.',
  },
  {
    key: 'okr_engagement_drop',
    label: 'Drop in OKR engagement',
    weight: 5,
    rationale: 'Fall in SELF-SET goal activity — behavioural, and distinct from a manager-assigned rating.',
  },
];

const WEIGHT_TOTAL = FEATURES.reduce((a, f) => a + f.weight, 0);
if (WEIGHT_TOTAL !== 100) {
  throw new Error(`Attrition feature weights must total 100, got ${WEIGHT_TOTAL}`);
}

/**
 * The Go/No-Go gate for Increment 3, written before the spike is built so it cannot be
 * rationalised afterwards. docs/05-attrition-risk-spec.md §8.
 */
export const MODEL_PROMOTION_CRITERION = {
  /** Increment 3 gate: precision@10 must beat the base rate by this multiple. */
  goNoGoPrecisionLiftMultiple: 3,
  /** v2 (fitted regression) unlocks only at 10 events per predictor. */
  minSeparationEventsForRegression: FEATURES.length * 10,
} as const;

export interface AttritionFeatureInput {
  employeeId: string;
  asOf: DhakaDate;

  /** F1 */
  tenureMonths: number;

  /** F2 — count of single-day unplanned absences adjacent to a weekend, last 90 days. */
  unplannedWeekendAdjacentAbsences90d: number;

  /** F3 — mean daily lateness (minutes) in the last 60 days, and the 60 before that. */
  latenessMinutesAvgLast60d: number;
  latenessMinutesAvgPrior60d: number;
  /** Standard deviation of lateness across the employee's department. */
  departmentLatenessStdDev: number;

  /** F4 */
  leaveDaysConsumed90d: number;
  leaveBalanceAtWindowStart: number;

  /** F5 — null when never revised (uses tenure instead). */
  monthsSinceLastSalaryIncrease: number | null;

  /** F6 — null when the manager has never changed. */
  daysSinceManagerChange: number | null;

  /** F7 — mean overtime hours per month over the last 90 days. */
  otHoursPerMonthAvg90d: number;

  /** F8 */
  okrUpdatesThisCycle: number;
  okrUpdatesPrevCycle: number;
}

export interface FeatureContribution {
  key: FeatureKey;
  label: string;
  /** Normalised 0..1. */
  normalised: number;
  weight: number;
  /** normalised x weight, rounded to 1dp. */
  points: number;
  rationale: string;
}

export interface AttritionResult {
  employeeId: string;
  asOf: DhakaDate;
  score: RiskScore;
  band: RiskBand;
  engineVersion: string;
  /** P0-4 / spec §9: a bare number is never displayed. These travel with it, always. */
  contributions: FeatureContribution[];
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Linear ramp: <= lo maps to 0, >= hi maps to 1. */
const ramp = (value: number, lo: number, hi: number): number =>
  hi === lo ? (value >= hi ? 1 : 0) : clamp01((value - lo) / (hi - lo));

/**
 * F1 — proximity to a tenure milestone.
 * Gaussian bump around 12, 24 and 36 months, sigma = 2 months.
 */
export function tenureMilestoneProximity(tenureMonths: number): number {
  if (tenureMonths < 0) return 0;
  const milestones = [12, 24, 36];
  const sigma = 2;
  let best = 0;
  for (const m of milestones) {
    const d = tenureMonths - m;
    best = Math.max(best, Math.exp(-(d * d) / (2 * sigma * sigma)));
  }
  // Below six months, milestone logic is meaningless — a new joiner is not "approaching 12".
  if (tenureMonths < 6) return 0;
  return clamp01(best);
}

/** F3 — one-sided z-score of the lateness delta, normalised over 0..3 sigma. */
export function latenessTrendZ(input: AttritionFeatureInput): number {
  const delta = input.latenessMinutesAvgLast60d - input.latenessMinutesAvgPrior60d;
  if (delta <= 0) return 0; // improving or unchanged is not a risk signal
  const sd = input.departmentLatenessStdDev;
  if (sd <= 0) return delta > 0 ? 0.5 : 0; // no dispersion to compare against — stay neutral
  return clamp01(delta / sd / 3);
}

/** F4 — fraction of the opening balance consumed in the window. */
export function leaveDrawdown(input: AttritionFeatureInput): number {
  if (input.leaveBalanceAtWindowStart <= 0) return 0;
  const ratio = input.leaveDaysConsumed90d / input.leaveBalanceAtWindowStart;
  return ramp(ratio, 0.2, 0.6);
}

/** F8 — proportional fall in self-set OKR activity. */
export function okrEngagementDrop(input: AttritionFeatureInput): number {
  if (input.okrUpdatesPrevCycle <= 0) return 0;
  const drop = (input.okrUpdatesPrevCycle - input.okrUpdatesThisCycle) / input.okrUpdatesPrevCycle;
  return clamp01(drop);
}

function normalise(key: FeatureKey, input: AttritionFeatureInput): number {
  switch (key) {
    case 'tenure_milestone_proximity':
      return tenureMilestoneProximity(input.tenureMonths);
    case 'unplanned_absence_pattern':
      return ramp(input.unplannedWeekendAdjacentAbsences90d, 0, 4);
    case 'lateness_trend_z':
      return latenessTrendZ(input);
    case 'leave_balance_drawdown':
      return leaveDrawdown(input);
    case 'no_recent_promotion_or_raise': {
      // Never revised: fall back to tenure — 24 months without any increase is the signal.
      const months = input.monthsSinceLastSalaryIncrease ?? input.tenureMonths;
      return ramp(months, 12, 24);
    }
    case 'manager_change_recent': {
      if (input.daysSinceManagerChange === null) return 0;
      // Decays linearly to zero at 180 days.
      return clamp01(1 - input.daysSinceManagerChange / 180);
    }
    case 'overtime_sustained':
      return ramp(input.otHoursPerMonthAvg90d, 10, 40);
    case 'okr_engagement_drop':
      return okrEngagementDrop(input);
  }
}

export function bandOf(score: RiskScore): RiskBand {
  if (score >= 80) return 'HIGH';
  if (score >= 60) return 'ELEVATED';
  if (score >= 40) return 'MODERATE';
  return 'LOW';
}

export function scoreEmployee(input: AttritionFeatureInput): AttritionResult {
  const contributions: FeatureContribution[] = FEATURES.map((f) => {
    const normalised = clamp01(normalise(f.key, input));
    return {
      key: f.key,
      label: f.label,
      normalised: Math.round(normalised * 1000) / 1000,
      weight: f.weight,
      points: Math.round(normalised * f.weight * 10) / 10,
      rationale: f.rationale,
    };
  });

  const raw = contributions.reduce((a, c) => a + c.normalised * c.weight, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  return {
    employeeId: input.employeeId,
    asOf: input.asOf,
    score,
    band: bandOf(score),
    engineVersion: SCORING_ENGINE_VERSION,
    contributions: contributions.sort((a, b) => b.points - a.points),
  };
}

/* ------------------------------------------------------------------------- *
 * Evaluation — P1-14, P1-15
 *
 * NEVER report accuracy. At a ~3% base rate per 90-day window, a model that predicts
 * "nobody leaves" is 97% accurate. Accuracy in an SQA report reads as not understanding
 * the problem.
 * ------------------------------------------------------------------------- */

export interface LabelledCase {
  employeeId: string;
  features: AttritionFeatureInput;
  /** Ground truth: did this employee VOLUNTARILY resign within 90 days? */
  resignedWithin90d: boolean;
}

export interface EvaluationReport {
  n: number;
  positives: number;
  baseRate: number;
  k: number;
  precisionAtK: number;
  recallAtK: number;
  /** Trivial rule: flag everyone at 11-13 months' tenure. Must be beaten to have value. */
  baselinePrecisionAtK: number;
  lift: number;
  passesGoNoGo: boolean;
}

/**
 * Expected hits in the top k under RANDOM tie-breaking.
 *
 * Naively taking `ranked.slice(0, k)` breaks ties by array order, which silently inflates
 * precision@k: a model that assigns every employee an identical score would "rank" them
 * by whatever order they came out of the database and could score a perfect 1.0. That
 * would make the Go/No-Go gate meaningless — a degenerate model would pass it.
 *
 * So items strictly above the cut-off score count in full, and items TIED at the cut-off
 * share the remaining slots proportionally. For a no-signal model this returns exactly
 * the base rate, which is the correct answer.
 */
function expectedHitsAtK(
  ranked: Array<{ positive: boolean; score: number }>,
  k: number,
): number {
  if (k >= ranked.length) return ranked.filter((r) => r.positive).length;

  const cutoff = ranked[k - 1]!.score;
  const above = ranked.filter((r) => r.score > cutoff);
  const tied = ranked.filter((r) => r.score === cutoff);
  const slotsLeft = k - above.length;

  const tiedPositives = tied.filter((r) => r.positive).length;
  const tiedShare = tied.length === 0 ? 0 : (tiedPositives * slotsLeft) / tied.length;

  return above.filter((r) => r.positive).length + tiedShare;
}

/**
 * precision@k — of the k employees ranked highest, how many actually resigned.
 *
 * The only metric that maps to the real operating constraint: an HR team can hold about
 * ten retention conversations a month, so what matters is whether the top ten are right.
 */
export function evaluate(cases: LabelledCase[], k = 10): EvaluationReport {
  const n = cases.length;
  if (n === 0) throw new Error('evaluate: no cases');

  const positives = cases.filter((c) => c.resignedWithin90d).length;
  const baseRate = positives / n;
  const kk = Math.min(k, n);

  const ranked = cases
    .map((c) => ({ positive: c.resignedWithin90d, score: scoreEmployee(c.features).score }))
    .sort((a, b) => b.score - a.score);

  const hits = expectedHitsAtK(ranked, kk);
  const precisionAtK = hits / kk;
  const recallAtK = positives === 0 ? 0 : hits / positives;

  // Baseline: flag everyone at 11-13 months' tenure, ranked by proximity to 12.
  const baselineRanked = cases
    .map((c) => {
      const t = c.features.tenureMonths;
      return {
        positive: c.resignedWithin90d,
        score: t >= 11 && t <= 13 ? 100 - Math.abs(t - 12) : 0,
      };
    })
    .sort((a, b) => b.score - a.score);
  const baselinePrecisionAtK = expectedHitsAtK(baselineRanked, kk) / kk;

  const lift = baseRate === 0 ? 0 : precisionAtK / baseRate;

  return {
    n,
    positives,
    baseRate: Math.round(baseRate * 1000) / 1000,
    k: kk,
    precisionAtK: Math.round(precisionAtK * 1000) / 1000,
    recallAtK: Math.round(recallAtK * 1000) / 1000,
    baselinePrecisionAtK: Math.round(baselinePrecisionAtK * 1000) / 1000,
    lift: Math.round(lift * 100) / 100,
    passesGoNoGo:
      lift >= MODEL_PROMOTION_CRITERION.goNoGoPrecisionLiftMultiple &&
      precisionAtK > baselinePrecisionAtK,
  };
}
