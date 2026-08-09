/**
 * Client-side subscription state.
 *
 * The entitlement list is fetched once at sign-in and drives navigation, feature gates and
 * upgrade prompts. It is a MIRROR of the server's decision, never the authority — the API
 * enforces entitlement independently on every request (apps/api/src/entitlement.ts). If the
 * two ever disagree, the server wins and the user sees a 402.
 *
 * Hiding a locked feature entirely would be the easy thing to do here. We deliberately
 * don't: a customer who cannot see a feature never learns it exists and never upgrades.
 * Locked items stay visible, greyed, with a lock. docs/12-ui-modernisation.md §2.1.
 */

import { get, type PlanFeatureKey, type SubscriptionDto, type Tier } from './api';

export const TIER_LABEL: Record<Tier, string> = {
  STARTER: 'Starter',
  GROWTH: 'Growth',
  ENTERPRISE: 'Enterprise',
};

export const TIER_ORDER: Tier[] = ['STARTER', 'GROWTH', 'ENTERPRISE'];

export async function fetchSubscription(): Promise<SubscriptionDto> {
  return get<SubscriptionDto>('/subscription');
}

export function isEntitled(sub: SubscriptionDto | null, feature: PlanFeatureKey): boolean {
  if (!sub) return false;
  return sub.entitlements.includes(feature);
}

/** The tier a locked feature needs, for the upgrade prompt. */
export function requiredTierFor(
  sub: SubscriptionDto | null,
  feature: PlanFeatureKey,
): Tier | null {
  const def = sub?.catalogue.find((f) => f.key === feature);
  return def?.minimumTier ?? null;
}

export function featureLabel(sub: SubscriptionDto | null, feature: PlanFeatureKey): string {
  return sub?.catalogue.find((f) => f.key === feature)?.label ?? feature;
}

export function featurePitch(sub: SubscriptionDto | null, feature: PlanFeatureKey): string {
  return sub?.catalogue.find((f) => f.key === feature)?.pitch ?? '';
}

/** Days left in a trial. Negative once expired; null when not on trial. */
export function trialDaysLeft(sub: SubscriptionDto | null): number | null {
  if (!sub || sub.status !== 'TRIAL' || !sub.trialEndsOn) return null;
  const end = new Date(`${sub.trialEndsOn}T00:00:00Z`).getTime();
  const now = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
  return Math.round((end - now) / 86_400_000);
}
