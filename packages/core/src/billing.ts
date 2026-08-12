/**
 * Self-service plan-change proration.
 *
 * docs/11-subscription-model.md §8 flags proration, self-service plan change and invoicing
 * as deliberately deferred -- no payment gateway exists for this build, so a plan change is
 * applied immediately and "paid" is simulated. The proration MATH here is real, though,
 * matching the standard SaaS model (Stripe et al): credit the unused days on the old plan,
 * charge for the same remaining days on the new plan, net the two.
 *
 * The billing cycle is treated as the current calendar month rather than reconstructed from
 * `organisation.renews_on` -- simpler, and it produces a believable days-remaining figure
 * regardless of how far out a seeded renewal date happens to be.
 */

import { daysInMonth as calendarDaysInMonth } from './dates.js';
import { applyRatio, round2, type Paisa } from './money.js';
import { TIER_PRICE_PAISA, TIER_RANK, type Tier } from './subscription.js';

export interface ProrationPreview {
  changeType: 'UPGRADE' | 'DOWNGRADE';
  daysRemaining: number;
  daysInMonth: number;
  /** Credit for the unused portion of the current plan this month. */
  unusedCreditPaisa: Paisa;
  /** Charge for the new plan over the same remaining days. */
  newChargePaisa: Paisa;
  /** newChargePaisa - unusedCreditPaisa. Positive = charge due now; negative = credit issued. */
  netDuePaisa: Paisa;
}

export function previewPlanChange(currentTier: Tier, newTier: Tier, today: string): ProrationPreview {
  if (currentTier === newTier) {
    throw new Error('previewPlanChange: newTier must differ from currentTier');
  }
  const parts = today.split('-').map(Number);
  const year = parts[0] ?? 0;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  const totalDays = calendarDaysInMonth(year, month);
  const daysRemaining = totalDays - day + 1; // inclusive of today

  const unusedCreditPaisa = applyRatio(TIER_PRICE_PAISA[currentTier], daysRemaining, totalDays);
  const newChargePaisa = applyRatio(TIER_PRICE_PAISA[newTier], daysRemaining, totalDays);
  const netDuePaisa = round2(newChargePaisa - unusedCreditPaisa);

  return {
    changeType: TIER_RANK[newTier] > TIER_RANK[currentTier] ? 'UPGRADE' : 'DOWNGRADE',
    daysRemaining,
    daysInMonth: totalDays,
    unusedCreditPaisa,
    newChargePaisa,
    netDuePaisa,
  };
}
