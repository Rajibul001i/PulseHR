/**
 * Feature-entitlement middleware.
 *
 * Resolves BUG-16 / BUG-17. Entitlement is decided by one pure function in
 * `@pulsehr/core` (`checkEntitlement`), so the API guard and the UI's navigation read
 * from the same matrix and can never disagree about what a customer has paid for.
 *
 * Every refusal is recorded in `feature_gate_hit` — without that there is no evidence for
 * which gate actually drives upgrades, and the pricing tiers become guesswork.
 */

import type { NextFunction, Request, Response } from 'express';
import { businessDate, checkEntitlement, type Subscription } from '@pulsehr/core';
import { nowIso, one, run, uuid } from './db.js';

export async function subscriptionOf(organisationId: string): Promise<Subscription> {
  const row = await one(
    `SELECT tier, plan_status, seat_limit, trial_ends_on,
            (SELECT COUNT(*) FROM employee e
              WHERE e.organisation_id = o.id AND e.employment_status = 'ACTIVE') AS seats_used
       FROM organisation o WHERE o.id = ?`,
    organisationId,
  );
  if (!row) throw new Error(`Unknown organisation ${organisationId}`);
  return {
    tier: row.tier as Subscription['tier'],
    status: row.plan_status as Subscription['status'],
    seatLimit: Number(row.seat_limit),
    seatsUsed: Number(row.seats_used),
    trialEndsOn: row.trial_ends_on ? String(row.trial_ends_on) : null,
  };
}

/**
 * Guard a route behind a plan feature.
 *
 * Returns **402 Payment Required** rather than 403. The distinction matters to the client:
 * 403 means "you will never have this", 402 means "your organisation could buy this" — and
 * only the second should render an upgrade prompt.
 */
export function requireFeature(featureKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    (async () => {
      const p = req.principal!;
      const subscription = await subscriptionOf(p.organisationId);
      const result = checkEntitlement(subscription, featureKey, businessDate(new Date()));

      if (result.allowed) {
        next();
        return;
      }

      await run(
        `INSERT INTO feature_gate_hit (id, organisation_id, user_id, feature_key,
                                       current_tier, required_tier, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        uuid(),
        p.organisationId,
        p.userId,
        featureKey,
        result.currentTier,
        result.requiredTier ?? result.currentTier,
        nowIso(),
      );

      res.status(402).json({
        error: result.message ?? 'This feature is not included in your plan',
        code: result.reason,
        feature: result.feature?.key,
        featureLabel: result.feature?.label,
        currentTier: result.currentTier,
        requiredTier: result.requiredTier,
        upgrade: result.requiredTier
          ? { tier: result.requiredTier, pitch: result.feature?.pitch }
          : undefined,
      });
    })().catch(next);
  };
}
