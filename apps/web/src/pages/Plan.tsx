/**
 * Plan & billing.
 *
 * The screen the product did not have. A customer could not see what tier they were on,
 * what it included, how many seats they had used, or what upgrading would give them.
 */

import { useEffect, useState } from 'react';
import { formatBDT } from '@pulsehr/core';
import { type PlanFeatureDto, type SubscriptionDto, type Tier } from '../api';
import { fetchSubscription, TIER_LABEL, TIER_ORDER, trialDaysLeft } from '../subscription';
import { StatSkeleton } from '../components/Feedback';

const TIER_PRICE: Record<Tier, number> = {
  STARTER: 25_000_00,
  GROWTH: 50_000_00,
  ENTERPRISE: 90_000_00,
};

const TIER_SEATS: Record<Tier, string> = {
  STARTER: 'Up to 50 employees',
  GROWTH: 'Up to 300 employees',
  ENTERPRISE: '300+ employees',
};

export function Plan() {
  const [sub, setSub] = useState<SubscriptionDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSubscription()
      .then(setSub)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!sub) return <StatSkeleton count={3} />;

  const days = trialDaysLeft(sub);
  const seatPct = sub.seats.seatLimit
    ? Math.min(100, Math.round((sub.seats.seatsUsed / sub.seats.seatLimit) * 100))
    : 0;

  const byTier = (tier: Tier): PlanFeatureDto[] =>
    sub.catalogue.filter((f) => f.minimumTier === tier);

  return (
    <>
      <h1>Plan &amp; billing</h1>
      <p className="page-sub">{sub.organisation}</p>

      {sub.status === 'PAST_DUE' && (
        <div className="banner warn">
          <strong>Payment overdue.</strong> Core HR remains available. Paid-tier features are
          suspended until the invoice is settled.
        </div>
      )}
      {sub.status === 'TRIAL' && days !== null && (
        <div className={`banner ${days <= 3 ? 'warn' : ''}`}>
          <strong>{days} day{days === 1 ? '' : 's'} left in your trial.</strong> Choose a plan to
          keep your data and your team's access.
        </div>
      )}
      {sub.seats.approachingLimit && (
        <div className="banner warn">
          <strong>{sub.seats.remaining} seat{sub.seats.remaining === 1 ? '' : 's'} remaining.</strong>{' '}
          You will not be able to onboard new employees once the limit is reached.
        </div>
      )}

      <div className="grid grid-2">
        <div className="card">
          <div className="stat-label">Current plan</div>
          <div className="stat-value">{TIER_LABEL[sub.tier]}</div>
          <div className="stat-note">
            {formatBDT(sub.pricePaisa)} / month · {sub.status.toLowerCase().replace('_', ' ')}
          </div>
        </div>

        <div className="card">
          <div className="stat-label">Seats used</div>
          <div className="stat-value">
            {sub.seats.seatsUsed}
            <span style={{ fontSize: 15, color: 'var(--muted)' }}> / {sub.seats.seatLimit}</span>
          </div>
          <div className="bar" style={{ marginTop: 10 }}>
            <i
              style={{
                width: `${seatPct}%`,
                background: sub.seats.approachingLimit ? 'var(--elevated)' : 'var(--accent)',
              }}
            />
          </div>
          <div className="stat-note">{sub.seats.remaining} remaining</div>
        </div>
      </div>

      <h2>What each plan includes</h2>
      <div className="grid grid-3">
        {TIER_ORDER.map((tier) => {
          const current = tier === sub.tier;
          const cumulative = TIER_ORDER.slice(0, TIER_ORDER.indexOf(tier) + 1).flatMap(byTier);
          return (
            <div className={`card plan-card ${current ? 'current' : ''}`} key={tier}>
              {current && <div className="plan-flag">Current plan</div>}
              <div className="stat-label">{TIER_LABEL[tier]}</div>
              <div className="stat-value" style={{ fontSize: 22 }}>
                {formatBDT(TIER_PRICE[tier])}
                <span style={{ fontSize: 13, color: 'var(--muted)' }}> /mo</span>
              </div>
              <div className="stat-note">{TIER_SEATS[tier]}</div>
              <ul className="plan-features">
                {cumulative.map((f) => (
                  <li key={f.key} title={f.pitch}>
                    <span aria-hidden="true">✓</span> {f.label}
                  </li>
                ))}
              </ul>
              {!current && (
                <button className={TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf(sub.tier) ? 'primary' : ''}>
                  {TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf(sub.tier) ? 'Upgrade' : 'Downgrade'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="notice">
        Plan changes are handled by your account manager in this release. Self-service upgrade
        and payment integration are documented in <code>docs/11-subscription-model.md</code> §8.
      </p>
    </>
  );
}
