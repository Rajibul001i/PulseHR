import { describe, expect, it } from 'vitest';
import {
  checkEntitlement,
  checkSeats,
  entitledFeatures,
  PLAN_FEATURES,
  TIER_RANK,
  type Subscription,
} from '../src/subscription.js';

const TODAY = '2026-08-10';

const sub = (over: Partial<Subscription> = {}): Subscription => ({
  tier: 'GROWTH',
  status: 'ACTIVE',
  seatLimit: 300,
  seatsUsed: 120,
  trialEndsOn: null,
  ...over,
});

describe('entitlement matrix', () => {
  it('every feature declares a minimum tier that exists', () => {
    for (const f of PLAN_FEATURES) {
      expect(TIER_RANK[f.minimumTier]).toBeGreaterThan(0);
    }
  });

  it('BUG-17: a GROWTH tenant is refused the full Enterprise attrition module', () => {
    const e = checkEntitlement(sub({ tier: 'GROWTH' }), 'attrition_full', TODAY);
    expect(e.allowed).toBe(false);
    expect(e.reason).toBe('TIER_TOO_LOW');
    expect(e.requiredTier).toBe('ENTERPRISE');
  });

  it('a GROWTH tenant DOES get the limited watchlist', () => {
    // The differentiator must reach the market that actually buys —
    // docs/08-business-model-corrections.md §5.
    expect(checkEntitlement(sub({ tier: 'GROWTH' }), 'attrition_watchlist', TODAY).allowed).toBe(true);
  });

  it('a STARTER tenant gets neither attrition feature', () => {
    expect(checkEntitlement(sub({ tier: 'STARTER' }), 'attrition_watchlist', TODAY).allowed).toBe(false);
    expect(checkEntitlement(sub({ tier: 'STARTER' }), 'attrition_full', TODAY).allowed).toBe(false);
  });

  it('an ENTERPRISE tenant gets everything', () => {
    const keys = entitledFeatures(sub({ tier: 'ENTERPRISE' }), TODAY);
    expect(keys).toHaveLength(PLAN_FEATURES.length);
  });

  it('core HR is available on every tier — payroll is never gated', () => {
    for (const tier of ['STARTER', 'GROWTH', 'ENTERPRISE'] as const) {
      expect(checkEntitlement(sub({ tier }), 'payroll', TODAY).allowed).toBe(true);
      expect(checkEntitlement(sub({ tier }), 'leave', TODAY).allowed).toBe(true);
    }
  });

  it('the upgrade message says what you get, not what you lack', () => {
    const e = checkEntitlement(sub({ tier: 'STARTER' }), 'ats', TODAY);
    expect(e.message).toContain('Growth');
    expect(e.message).toContain('hiring pipeline');
    expect(e.message).not.toMatch(/cannot|denied|not allowed/i);
  });

  it('an unknown feature key is refused rather than silently allowed', () => {
    const e = checkEntitlement(sub(), 'teleportation', TODAY);
    expect(e.allowed).toBe(false);
    expect(e.reason).toBe('UNKNOWN_FEATURE');
  });
});

describe('plan status', () => {
  it('a cancelled plan blocks everything, including core HR', () => {
    expect(checkEntitlement(sub({ status: 'CANCELLED' }), 'payroll', TODAY).allowed).toBe(false);
  });

  it('an expired trial blocks access', () => {
    const e = checkEntitlement(
      sub({ status: 'TRIAL', trialEndsOn: '2026-08-09' }),
      'payroll',
      TODAY,
    );
    expect(e.allowed).toBe(false);
    expect(e.reason).toBe('TRIAL_EXPIRED');
  });

  it('a trial ending today is still valid — expiry is exclusive', () => {
    expect(
      checkEntitlement(sub({ status: 'TRIAL', trialEndsOn: TODAY }), 'payroll', TODAY).allowed,
    ).toBe(true);
  });

  it('PAST_DUE keeps core HR readable but suspends paid-tier features', () => {
    // Locking an HR team out of payroll over a late invoice does more damage than it
    // recovers. Degrade, do not detonate.
    expect(checkEntitlement(sub({ status: 'PAST_DUE' }), 'payroll', TODAY).allowed).toBe(true);
    expect(checkEntitlement(sub({ status: 'PAST_DUE' }), 'ats', TODAY).allowed).toBe(false);
  });
});

describe('seat accounting', () => {
  it('reports remaining seats', () => {
    const s = checkSeats(sub({ seatsUsed: 120, seatLimit: 300 }));
    expect(s.withinLimit).toBe(true);
    expect(s.remaining).toBe(180);
    expect(s.approachingLimit).toBe(false);
  });

  it('warns at 90% before the limit is hit, not after', () => {
    expect(checkSeats(sub({ seatsUsed: 270, seatLimit: 300 })).approachingLimit).toBe(true);
    expect(checkSeats(sub({ seatsUsed: 269, seatLimit: 300 })).approachingLimit).toBe(false);
  });

  it('refuses at exactly the limit', () => {
    const s = checkSeats(sub({ seatsUsed: 300, seatLimit: 300 }));
    expect(s.withinLimit).toBe(false);
    expect(s.remaining).toBe(0);
  });

  it('never reports negative remaining seats when over limit', () => {
    expect(checkSeats(sub({ seatsUsed: 340, seatLimit: 300 })).remaining).toBe(0);
  });
});
