/**
 * Nightly attrition scoring batch — 02:00 Asia/Dhaka in production.
 *
 * Runs in the worker, never in the API (ADR-004). Resolves the proposal/deck conflict on
 * cadence: the proposal says "live" and "real-time" (§1, §4a), the deck says "nightly
 * batch" (slides 24, 30). Nightly is correct and is what ships — HR acts on these signals
 * weekly at best, so streaming infrastructure would buy nothing.
 *
 * Run directly:  npm run job:score
 */

import { pathToFileURL } from 'node:url';
import { businessDate, scoreEmployee } from '@pulsehr/core';
import { all, openDb } from '../db.js';
import { buildFeatures } from '../features.js';
import { Repo } from '../repo.js';
import { registerHandler } from './queue.js';

export function scoreOrganisation(organisationId: string, userId: string, asOf?: string) {
  const scoringDate = asOf ?? businessDate(new Date());
  const repo = new Repo(organisationId, userId);

  const employees = all(
    `SELECT * FROM employee WHERE organisation_id = ? AND employment_status = 'ACTIVE'`,
    organisationId,
  );

  let scored = 0;
  const bands = { LOW: 0, MODERATE: 0, ELEVATED: 0, HIGH: 0 };

  for (const employee of employees) {
    const features = buildFeatures(organisationId, employee, scoringDate);
    const result = scoreEmployee(features);
    repo.saveScore(result);
    bands[result.band] += 1;
    scored += 1;
  }

  repo.audit('ATTRITION_BATCH', 'attrition_score', null, { scoringDate, scored, bands });
  return { scoringDate, scored, bands };
}

registerHandler('ATTRITION_SCORING', (payload) =>
  scoreOrganisation(String(payload.organisationId), String(payload.userId)),
);

// CLI entry point — how you demo the nightly batch without waiting until 02:00.
// pathToFileURL, not string concatenation: on Windows a path is `D:\...` and the URL form
// is `file:///D:/...` with three slashes, so naive interpolation never matches.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  openDb();
  const orgs = all('SELECT id, name FROM organisation');
  for (const org of orgs) {
    const summary = scoreOrganisation(String(org.id), 'system');
    console.log(`[attrition] ${org.name}:`, summary);
  }
}
