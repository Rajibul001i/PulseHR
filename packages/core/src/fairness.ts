/**
 * Quarterly bias audit for the attrition scorecard — docs/05-attrition-risk-spec.md §9.
 *
 * Score distributions are compared across gender, department and tenure band. A mean-score
 * gap above BIAS_GAP_THRESHOLD points between groups, AFTER controlling for tenure, flags
 * the dimension and requires re-weighting before the next scoring cycle.
 *
 * "Controlling for tenure" is done by residualising: each score is compared with the mean
 * score of its tenure band, and groups are compared on their mean residual. Tenure is itself
 * a weighted feature (tenure milestones), so a department full of 11-month employees scoring
 * high is the model working as designed, not bias. Residuals stay meaningful at the small
 * group sizes a mid-sized company has, where splitting into band x group cells would not.
 *
 * Age band is part of the spec but is not audited: no date of birth is stored (data
 * minimisation), and the report says so rather than silently skipping it.
 */

export const BIAS_GAP_THRESHOLD = 5;
/** Groups smaller than this are reported but not compared: a mean over one or two people is noise. */
export const BIAS_MIN_GROUP_SIZE = 3;

export type TenureBand = 'Under 1 year' | '1 to 3 years' | 'Over 3 years';
export type AuditDimension = 'gender' | 'department' | 'tenure';

export interface AuditSubject {
  score: number;
  gender: string | null;
  department: string | null;
  tenureMonths: number;
}

export interface GroupStat {
  group: string;
  n: number;
  meanScore: number;
  /** Mean of (score − tenure-band mean): the tenure-controlled comparison value. */
  meanResidual: number;
  compared: boolean;
}

export interface DimensionResult {
  dimension: AuditDimension;
  groups: GroupStat[];
  /** Largest gap in raw mean score between compared groups. */
  rawGap: number | null;
  /** Largest gap in mean residual between compared groups (tenure controlled). */
  adjustedGap: number | null;
  flagged: boolean;
}

export interface BiasAuditReport {
  subjects: number;
  threshold: number;
  minGroupSize: number;
  dimensions: DimensionResult[];
  flagged: boolean;
  notes: string[];
}

export function tenureBandOf(tenureMonths: number): TenureBand {
  if (tenureMonths < 12) return 'Under 1 year';
  if (tenureMonths <= 36) return '1 to 3 years';
  return 'Over 3 years';
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

function gap(values: number[]): number | null {
  return values.length < 2 ? null : round1(Math.max(...values) - Math.min(...values));
}

export function runBiasAudit(subjects: AuditSubject[]): BiasAuditReport {
  const notes = [
    'Age band is not audited: no date of birth is stored.',
    'Tenure bands are reported but never flagged: tenure milestones are a deliberate, weighted feature.',
  ];

  const bandMean = new Map<TenureBand, number>();
  for (const band of ['Under 1 year', '1 to 3 years', 'Over 3 years'] as TenureBand[]) {
    const inBand = subjects.filter((s) => tenureBandOf(s.tenureMonths) === band).map((s) => s.score);
    if (inBand.length > 0) bandMean.set(band, mean(inBand));
  }
  const residual = (s: AuditSubject): number => s.score - bandMean.get(tenureBandOf(s.tenureMonths))!;

  const keyOf: Record<AuditDimension, (s: AuditSubject) => string> = {
    gender: (s) => s.gender ?? 'Not recorded',
    department: (s) => s.department ?? 'No department',
    tenure: (s) => tenureBandOf(s.tenureMonths),
  };

  const dimensions = (['gender', 'department', 'tenure'] as AuditDimension[]).map((dimension): DimensionResult => {
    const byGroup = new Map<string, AuditSubject[]>();
    for (const s of subjects) {
      const k = keyOf[dimension](s);
      byGroup.set(k, [...(byGroup.get(k) ?? []), s]);
    }
    const groups: GroupStat[] = [...byGroup.entries()]
      .map(([group, members]) => ({
        group,
        n: members.length,
        meanScore: round1(mean(members.map((m) => m.score))),
        meanResidual: round1(mean(members.map(residual))),
        // "Not recorded" is not a group of people, so it is never compared.
        compared: members.length >= BIAS_MIN_GROUP_SIZE && group !== 'Not recorded',
      }))
      .sort((a, b) => b.meanScore - a.meanScore);

    const compared = groups.filter((g) => g.compared);
    const adjustedGap = dimension === 'tenure' ? null : gap(compared.map((g) => g.meanResidual));
    return {
      dimension,
      groups,
      rawGap: gap(compared.map((g) => g.meanScore)),
      adjustedGap,
      flagged: adjustedGap !== null && adjustedGap > BIAS_GAP_THRESHOLD,
    };
  });

  return {
    subjects: subjects.length,
    threshold: BIAS_GAP_THRESHOLD,
    minGroupSize: BIAS_MIN_GROUP_SIZE,
    dimensions,
    flagged: dimensions.some((d) => d.flagged),
    notes,
  };
}
