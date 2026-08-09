/**
 * Loading, empty and gated states.
 *
 * Three things the old UI had none of:
 *   - a skeleton in the SHAPE of the incoming content, so the layout doesn't jump
 *   - an empty state that tells a new tenant what to do next — for a subscription
 *     product the empty state IS the onboarding
 *   - an upgrade prompt that describes the value, not the restriction
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Tier, UpgradeRequired } from '../api';

/** Skeleton rows shaped like the table that is loading. */
export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="card" aria-busy="true" aria-label="Loading">
      <table>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c}>
                  <span className="skeleton" style={{ width: c === 0 ? '70%' : '45%' }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StatSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div className="card" key={i}>
          <span className="skeleton sm" style={{ width: '55%' }} />
          <span className="skeleton lg" style={{ width: '40%', marginTop: 10 }} />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: string;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">
        {icon}
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

const TIER_LABEL: Record<Tier, string> = {
  STARTER: 'Starter',
  GROWTH: 'Growth',
  ENTERPRISE: 'Enterprise',
};

/**
 * Shown when the API returns 402.
 *
 * Leads with what the customer gets. "Full attrition intelligence scores every employee
 * nightly" converts; "Your plan does not include this" does not.
 */
export function UpgradePrompt({ detail }: { detail: UpgradeRequired }) {
  const required = detail.requiredTier ?? detail.upgrade?.tier;
  return (
    <div className="upgrade-card">
      <div className="upgrade-badge">{required ? TIER_LABEL[required] : 'Upgrade'}</div>
      <h2 style={{ marginTop: 12 }}>{detail.featureLabel ?? 'This feature'}</h2>
      <p className="upgrade-pitch">{detail.upgrade?.pitch ?? detail.error}</p>
      <p className="notice">
        Your organisation is on the <strong>{TIER_LABEL[detail.currentTier]}</strong> plan.
      </p>
      <Link to="/plan">
        <button className="primary">See plans</button>
      </Link>
    </div>
  );
}
