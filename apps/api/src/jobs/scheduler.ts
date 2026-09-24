/**
 * The nightly schedule (F9.2, F3.3) and the quarterly bias audit (spec §9).
 *
 * At 02:00 Asia/Dhaka each night: mark yesterday's absences, then score every organisation
 * whose plan includes attrition scoring. On the first night of each quarter, also run the
 * bias audit. Work goes through the same job queue as HR's "Run scoring batch" button, so it
 * never runs inside a request (ADR-004).
 *
 * A free host that sleeps when idle can miss 02:00; the next boot's demo start-up
 * (scripts/demo.mjs) scores and marks absences anyway, and a missed night is caught up by
 * the next one because absence marking looks back 14 days.
 *
 * Set PULSEHR_SCHEDULER=off to disable (tests, or a deployment with an external cron).
 */

import { businessDate, dhakaMinutesOfDay, entitledFeatures } from '@pulsehr/core';
import { all } from '../db.js';
import { subscriptionOf } from '../entitlement.js';
import { enqueue } from './queue.js';

const RUN_AT_MINUTES = 2 * 60; // 02:00 Asia/Dhaka

let lastRunOn: string | null = null;

export async function runNightly(today: string): Promise<void> {
  const orgs = await all('SELECT id FROM organisation');
  for (const org of orgs) {
    const organisationId = String(org.id);
    enqueue('MARK_ABSENCES', { organisationId, userId: 'system' });
    const features = entitledFeatures(await subscriptionOf(organisationId), today);
    if (features.includes('attrition_full') || features.includes('attrition_watchlist')) {
      enqueue('ATTRITION_SCORING', { organisationId, userId: 'system' });
    }
    const isQuarterStart = today.endsWith('-01') && ['01', '04', '07', '10'].includes(today.slice(5, 7));
    if (isQuarterStart && features.includes('bias_audit')) {
      enqueue('BIAS_AUDIT', { organisationId, userId: 'system' });
    }
  }
}

export function startScheduler(): void {
  if (process.env.PULSEHR_SCHEDULER === 'off') return;
  const tick = () => {
    const now = new Date();
    const today = businessDate(now);
    if (dhakaMinutesOfDay(now) >= RUN_AT_MINUTES && dhakaMinutesOfDay(now) < RUN_AT_MINUTES + 60 && lastRunOn !== today) {
      lastRunOn = today;
      runNightly(today).catch((err) => console.error('[scheduler]', err));
    }
  };
  setInterval(tick, 60_000).unref();
  console.log('[scheduler] nightly jobs at 02:00 Asia/Dhaka');
}
