/**
 * Quarterly bias audit — docs/05-attrition-risk-spec.md §9. Compares the latest scores
 * across gender, department and tenure band (packages/core fairness.ts) and stores a written
 * report. Runs on the first day of each quarter (scheduler.ts), or on demand from HR.
 *
 * Run directly:  npm run job:bias-audit
 */

import { pathToFileURL } from 'node:url';
import { businessDate, runBiasAudit } from '@pulsehr/core';
import { all, openDb } from '../db.js';
import { Repo } from '../repo.js';
import { registerHandler } from './queue.js';

function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
}

export async function auditOrganisation(organisationId: string, userId: string) {
  const repo = new Repo(organisationId, userId);
  const today = businessDate(new Date());
  const rows = await repo.latestScoresForAudit();
  const report = runBiasAudit(
    rows.map((r) => ({
      score: Number(r.score),
      gender: r.gender ? String(r.gender) : null,
      department: r.department_name ? String(r.department_name) : null,
      tenureMonths: monthsBetween(String(r.hire_date), today),
    })),
  );
  const scoresOn = rows.length ? rows.map((r) => String(r.scored_on)).sort().at(-1)! : null;
  const id = await repo.saveBiasAudit(report, report.flagged, scoresOn);
  return { id, flagged: report.flagged, subjects: report.subjects };
}

registerHandler('BIAS_AUDIT', (payload) => auditOrganisation(String(payload.organisationId), String(payload.userId)));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await openDb();
  for (const org of await all('SELECT id, name FROM organisation')) {
    console.log(`[bias-audit] ${org.name}:`, await auditOrganisation(String(org.id), 'system'));
  }
}
