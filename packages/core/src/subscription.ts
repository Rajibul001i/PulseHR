/**
 * Subscription plans and feature entitlement. Pure (ADR-008).
 *
 * PulseHR is sold per tier. Until now nothing in the codebase knew that — the bug hunt
 * (SQA-2026-08-10, BUG-16/BUG-17) found a GROWTH tenant reading the full Enterprise
 * attrition module. For a subscription product, entitlement is not a feature; it is the
 * product's commercial boundary, and it belongs in one place that both the API and the UI
 * read from, so they can never disagree about what a customer has paid for.
 */

export type Tier = 'STARTER' | 'GROWTH' | 'ENTERPRISE';

export type PlanStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';

/** Ordering matters: entitlement is "at least this tier". */
export const TIER_RANK: Record<Tier, number> = {
  STARTER: 1,
  GROWTH: 2,
  ENTERPRISE: 3,
};

export type PlanFeatureKey =
  | 'attendance'
  | 'leave'
  | 'payroll'
  | 'noticeboard'
  | 'okr'
  | 'ats'
  | 'attrition_watchlist'
  | 'attrition_full'
  | 'api_access'
  | 'bias_audit';

export interface PlanFeatureDefinition {
  key: PlanFeatureKey;
  label: string;
  minimumTier: Tier;
  /** Shown in the upgrade prompt — says what they get, not what they lack. */
  pitch: string;
}

/**
 * The entitlement matrix.
 *
 * Note `attrition_watchlist` at GROWTH. The original deck gated the entire AI module to
 * Enterprise — but the AI is the product's whole differentiator, and the stated target
 * market ("mid-sized firms running HR on spreadsheets") buys Starter and Growth. Gating
 * the differentiator away from the market that buys leaves a commodity HRIS competing on
 * price. Growth gets a limited watchlist; Enterprise gets full scoring, history and
 * configurable weights. See docs/08-business-model-corrections.md §5.
 */
export const PLAN_FEATURES: PlanFeatureDefinition[] = [
  { key: 'attendance', label: 'Attendance', minimumTier: 'STARTER', pitch: 'Daily attendance capture and monthly reporting.' },
  { key: 'leave', label: 'Leave management', minimumTier: 'STARTER', pitch: 'Request-to-approval workflow with statutory balances.' },
  { key: 'payroll', label: 'Automated payroll', minimumTier: 'STARTER', pitch: 'Labour Act–compliant payroll with immutable payslips.' },
  { key: 'noticeboard', label: 'Digital noticeboard', minimumTier: 'STARTER', pitch: 'Company-wide announcements with read tracking.' },
  { key: 'okr', label: 'Performance (OKR)', minimumTier: 'GROWTH', pitch: 'Quarterly objectives and key results for every team.' },
  { key: 'ats', label: 'Recruitment (ATS)', minimumTier: 'GROWTH', pitch: 'A Kanban hiring pipeline from application to offer.' },
  { key: 'attrition_watchlist', label: 'Attrition watchlist', minimumTier: 'GROWTH', pitch: 'Your five highest-risk employees, refreshed monthly.' },
  { key: 'attrition_full', label: 'Full attrition intelligence', minimumTier: 'ENTERPRISE', pitch: 'Nightly scoring for every employee, full history, and configurable weights.' },
  { key: 'api_access', label: 'API access', minimumTier: 'ENTERPRISE', pitch: 'Programmatic access for your own integrations.' },
  { key: 'bias_audit', label: 'Quarterly bias audit', minimumTier: 'ENTERPRISE', pitch: 'Scheduled fairness reporting across gender, department and tenure.' },
];

const BY_KEY = new Map(PLAN_FEATURES.map((f) => [f.key, f]));

export interface Subscription {
  tier: Tier;
  status: PlanStatus;
  seatLimit: number;
  seatsUsed: number;
  trialEndsOn?: string | null;
}

export type EntitlementReason =
  | 'OK'
  | 'TIER_TOO_LOW'
  | 'PLAN_CANCELLED'
  | 'PLAN_PAST_DUE'
  | 'TRIAL_EXPIRED'
  | 'UNKNOWN_FEATURE';

export interface Entitlement {
  allowed: boolean;
  reason: EntitlementReason;
  feature?: PlanFeatureDefinition;
  currentTier: Tier;
  requiredTier?: Tier;
  message?: string;
}

/**
 * The single entitlement decision, used by the API route guard and the UI alike.
 *
 * `today` is injected rather than read from the clock so this stays pure and testable —
 * a trial that expires at midnight is exactly the kind of thing that needs a test.
 */
export function checkEntitlement(
  subscription: Subscription,
  featureKey: string,
  today: string,
): Entitlement {
  const feature = BY_KEY.get(featureKey as PlanFeatureKey);
  const currentTier = subscription.tier;

  if (!feature) {
    return { allowed: false, reason: 'UNKNOWN_FEATURE', currentTier };
  }

  if (subscription.status === 'CANCELLED') {
    return {
      allowed: false,
      reason: 'PLAN_CANCELLED',
      feature,
      currentTier,
      message: 'This subscription has been cancelled. Reactivate to continue.',
    };
  }

  // PAST_DUE keeps read access to what they already have — locking an HR team out of
  // payroll over a late invoice causes more damage than it recovers — but blocks
  // anything above their tier.
  if (subscription.status === 'TRIAL' && subscription.trialEndsOn && today > subscription.trialEndsOn) {
    return {
      allowed: false,
      reason: 'TRIAL_EXPIRED',
      feature,
      currentTier,
      message: `Your trial ended on ${subscription.trialEndsOn}. Choose a plan to continue.`,
    };
  }

  if (TIER_RANK[currentTier] < TIER_RANK[feature.minimumTier]) {
    return {
      allowed: false,
      reason: 'TIER_TOO_LOW',
      feature,
      currentTier,
      requiredTier: feature.minimumTier,
      message: `${feature.label} is included in the ${titleCase(feature.minimumTier)} plan. ${feature.pitch}`,
    };
  }

  if (subscription.status === 'PAST_DUE' && TIER_RANK[feature.minimumTier] > TIER_RANK.STARTER) {
    return {
      allowed: false,
      reason: 'PLAN_PAST_DUE',
      feature,
      currentTier,
      message: 'Payment is overdue. Settle the invoice to restore this feature.',
    };
  }

  return { allowed: true, reason: 'OK', feature, currentTier };
}

/** Every feature key the tenant currently has, for the UI to render nav and gates from. */
export function entitledFeatures(subscription: Subscription, today: string): PlanFeatureKey[] {
  return PLAN_FEATURES.filter((f) => checkEntitlement(subscription, f.key, today).allowed).map((f) => f.key);
}

export interface SeatCheck {
  withinLimit: boolean;
  seatsUsed: number;
  seatLimit: number;
  remaining: number;
  /** True once the tenant is close enough that HR should be warned before they hit it. */
  approachingLimit: boolean;
}

/**
 * Seat accounting.
 *
 * A per-seat product that only discovers it is over its limit at renewal has already lost
 * the revenue. Warn at 90%, refuse at 100%.
 */
export function checkSeats(subscription: Subscription): SeatCheck {
  const { seatsUsed, seatLimit } = subscription;
  const remaining = Math.max(0, seatLimit - seatsUsed);
  return {
    withinLimit: seatsUsed < seatLimit,
    seatsUsed,
    seatLimit,
    remaining,
    approachingLimit: seatLimit > 0 && seatsUsed / seatLimit >= 0.9,
  };
}

/** Monthly list price in paisa. docs/08-business-model-corrections.md §4. */
export const TIER_PRICE_PAISA: Record<Tier, number> = {
  STARTER: 25_000_00,
  GROWTH: 50_000_00,
  ENTERPRISE: 90_000_00,
};

function titleCase(t: Tier): string {
  return t.charAt(0) + t.slice(1).toLowerCase();
}
