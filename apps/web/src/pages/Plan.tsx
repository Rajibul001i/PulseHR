/**
 * Plan & billing.
 *
 * The screen the product did not have. A customer could not see what tier they were on,
 * what it included, how many seats they had used, or what upgrading would give them.
 *
 * Self-service upgrade/downgrade, proration and invoicing (docs/11-subscription-model.md
 * §8) were deliberately deferred pending a payment gateway this project doesn't have. The
 * proration math and audit trail below are real; "payment" is simulated since there is
 * nothing to charge against.
 */

import { useEffect, useState } from 'react';
import { formatBDT } from '@pulsehr/core';
import { get, post, type PlanFeatureDto, type SubscriptionDto, type Tier } from '../api';
import { fetchSubscription, TIER_LABEL, TIER_ORDER, trialDaysLeft } from '../subscription';
import { StatSkeleton } from '../components/Feedback';
import { useToast } from '../components/Toast';

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

interface ProrationPreview {
  changeType: 'UPGRADE' | 'DOWNGRADE';
  daysRemaining: number;
  daysInMonth: number;
  unusedCreditPaisa: number;
  newChargePaisa: number;
  netDuePaisa: number;
}

interface InvoiceDto {
  id: string;
  tier: Tier;
  amount_paisa: number;
  description: string;
  status: 'PAID' | 'CREDITED';
  issued_at: string;
}

export function Plan() {
  const toast = useToast();
  const [sub, setSub] = useState<SubscriptionDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDto[] | null>(null);

  const [changingTier, setChangingTier] = useState<Tier | null>(null);
  const [preview, setPreview] = useState<ProrationPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function load() {
    try {
      const [s, inv] = await Promise.all([fetchSubscription(), get<InvoiceDto[]>('/subscription/invoices')]);
      setSub(s);
      setInvoices(inv);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function openPreview(tier: Tier) {
    setChangingTier(tier);
    setPreview(null);
    setPreviewLoading(true);
    try {
      setPreview(await get<ProrationPreview>(`/subscription/preview-change?tier=${tier}`));
    } catch (err) {
      toast.error((err as Error).message);
      setChangingTier(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function confirmChange() {
    if (!changingTier) return;
    setConfirming(true);
    try {
      await post('/subscription/change', { tier: changingTier });
      toast.success(`Moved to ${TIER_LABEL[changingTier]}. Invoice issued.`);
      setChangingTier(null);
      setPreview(null);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setConfirming(false);
    }
  }

  if (error) return <p className="error content-in">{error}</p>;
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
        <div className="card content-in" style={{ animationDelay: '0ms' }}>
          <div className="stat-label">Current plan</div>
          <div className="stat-value">{TIER_LABEL[sub.tier]}</div>
          <div className="stat-note">
            {formatBDT(sub.pricePaisa)} / month · {sub.status.toLowerCase().replace('_', ' ')}
          </div>
        </div>

        <div className="card content-in" style={{ animationDelay: '30ms' }}>
          <div className="stat-label">Seats used</div>
          <div className="stat-value">
            {sub.seats.seatsUsed}
            <span style={{ fontSize: 15, color: 'var(--muted)' }}> / {sub.seats.seatLimit}</span>
          </div>
          <div className="bar" style={{ marginTop: 10 }}>
            <i
              style={{
                transform: `scaleX(${seatPct / 100})`,
                background: sub.seats.approachingLimit ? 'var(--elevated)' : 'var(--accent)',
              }}
            />
          </div>
          <div className="stat-note">{sub.seats.remaining} remaining</div>
        </div>
      </div>

      <h2>What each plan includes</h2>
      <div className="grid grid-3">
        {TIER_ORDER.map((tier, i) => {
          const current = tier === sub.tier;
          const cumulative = TIER_ORDER.slice(0, TIER_ORDER.indexOf(tier) + 1).flatMap(byTier);
          const isUpgrade = TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf(sub.tier);
          return (
            <div
              className={`card plan-card content-in ${current ? 'current' : ''}`}
              key={tier}
              style={{ animationDelay: `${i * 30}ms` }}
            >
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
                <button className={isUpgrade ? 'primary' : ''} onClick={() => openPreview(tier)}>
                  {isUpgrade ? 'Upgrade' : 'Downgrade'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {changingTier && (
        <div className="card content-in" style={{ borderColor: 'var(--accent)' }}>
          <h3>
            {preview?.changeType === 'DOWNGRADE' ? 'Confirm downgrade' : 'Confirm upgrade'} to{' '}
            {TIER_LABEL[changingTier]}
          </h3>
          {previewLoading || !preview ? (
            <p className="notice">Calculating proration…</p>
          ) : (
            <>
              <table style={{ marginBottom: 14 }}>
                <tbody>
                  <tr>
                    <td>Days remaining this month</td>
                    <td className="num">
                      {preview.daysRemaining} / {preview.daysInMonth}
                    </td>
                  </tr>
                  <tr>
                    <td>Credit for unused {TIER_LABEL[sub.tier]} time</td>
                    <td className="num">-{formatBDT(preview.unusedCreditPaisa)}</td>
                  </tr>
                  <tr>
                    <td>{TIER_LABEL[changingTier]} charge for the same days</td>
                    <td className="num">{formatBDT(preview.newChargePaisa)}</td>
                  </tr>
                  <tr style={{ fontWeight: 700 }}>
                    <td>{preview.netDuePaisa < 0 ? 'Credit issued today' : 'Due today'}</td>
                    <td className="num">{formatBDT(Math.abs(preview.netDuePaisa))}</td>
                  </tr>
                </tbody>
              </table>
              <p className="notice" style={{ marginBottom: 14 }}>
                From your next full billing cycle, you'll be charged {formatBDT(TIER_PRICE[changingTier])}
                /month at the {TIER_LABEL[changingTier]} rate.
              </p>
              <button className="sm" onClick={() => setChangingTier(null)} disabled={confirming}>
                Cancel
              </button>{' '}
              <button className="primary sm" onClick={confirmChange} disabled={confirming}>
                {confirming ? 'Confirming…' : `Confirm ${preview.changeType === 'DOWNGRADE' ? 'downgrade' : 'upgrade'}`}
              </button>
            </>
          )}
        </div>
      )}

      <h2>Invoices</h2>
      {invoices === null ? (
        <StatSkeleton count={1} />
      ) : invoices.length === 0 ? (
        <p className="notice">No invoices yet — plan changes and renewals will appear here.</p>
      ) : (
        <div className="card table-card">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Status</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td>{new Date(inv.issued_at).toLocaleDateString()}</td>
                  <td className="stat-note">{inv.description}</td>
                  <td>
                    <span className={`badge ${inv.status === 'PAID' ? 'APPROVED' : 'LOW'}`}>{inv.status}</span>
                  </td>
                  <td className="num">
                    {inv.amount_paisa < 0 ? '-' : ''}
                    {formatBDT(Math.abs(inv.amount_paisa))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
