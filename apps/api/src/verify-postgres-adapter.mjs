/**
 * Verifies the PostgreSQL backend (db-postgres.ts) without a real Postgres server, using
 * pg-mem (an in-memory Postgres-compatible engine) in place of the real `pg` package --
 * substituted via node:test's module mocking, so this exercises the actual db.ts/db-
 * postgres.ts/repo.ts code paths, not a reimplementation of them.
 *
 * `npm run verify:postgres` (from apps/api).
 *
 * What this DOES verify: migrations apply, the `?` -> `$1..$n` placeholder conversion, money
 * staying a real JS number (not a string) end to end, ON CONFLICT DO NOTHING, key_result's
 * sort_order column, and that transaction() shares one connection across nested Repo calls
 * (AsyncLocalStorage) -- the property P0-7's leave-approval race guard depends on.
 *
 * What this can NOT verify, because pg-mem's SQL engine doesn't implement it (confirmed via
 * isolated repros against pg-mem directly, not this project's code -- see comments inline):
 * CREATE TRIGGER (migrations-postgres-test-fixture/ strips it from the copy used here only;
 * the real migration is untouched), IS NOT DISTINCT FROM (fails to parse), and ROLLBACK
 * actually reverting a write. All three are standard, valid Postgres behavior verified by
 * code review and/or against node:sqlite; real-Postgres confirmation is a one-time follow-up
 * once the live Render database exists (re-run smoke.mjs's P0-7 check with DATABASE_URL set).
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';

const mem = newDb({ autoCreateForeignKeyIndices: true });
const pgAdapter = mem.adapters.createPg();

mock.module('pg', {
  defaultExport: {
    Pool: pgAdapter.Pool,
    Client: pgAdapter.Client,
    types: { setTypeParser: () => {} },
  },
  namedExports: {
    Pool: pgAdapter.Pool,
    Client: pgAdapter.Client,
    types: { setTypeParser: () => {} },
  },
});

process.env.DATABASE_URL = 'postgres://fake:fake@localhost:5432/fake';
// Points db.ts at the trigger-stripped fixture directory instead of the real
// migrations-postgres/ -- see that directory's note on 001_init.sql for why (pg-mem's SQL
// parser doesn't implement CREATE TRIGGER; the real migration is untouched).
process.env.PULSEHR_PG_MIGRATIONS_DIR = new URL('../migrations-postgres-test-fixture', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const { openDb, all, one, run, transaction } = await import('./db.js');
const { Repo } = await import('./repo.js');

test('postgres adapter: migrations apply and basic CRUD round-trips', async () => {
  await openDb();
  console.log('migrations applied OK');

  await run(
    `INSERT INTO organisation (id, name, tier, weekend_days, created_at) VALUES (?, ?, ?, ?, ?)`,
    'org1', 'Test Org', 'ENTERPRISE', '5,6', new Date().toISOString(),
  );
  const org = await one('SELECT * FROM organisation WHERE id = ?', 'org1');
  assert.equal(org.name, 'Test Org');
  assert.equal(typeof org.id, 'string');
  console.log('basic insert/select OK, org row:', org);

  await run(
    `INSERT INTO department (id, organisation_id, name, office_start_time) VALUES (?, ?, ?, ?)`,
    'dept1', 'org1', 'Engineering', '09:00',
  );
  await run(
    `INSERT INTO app_user (id, organisation_id, email, password_hash, role, is_active, created_at)
     VALUES (?, ?, ?, ?, 'HR_ADMIN', 1, ?)`,
    'user1', 'org1', 'hr@test.com', 'hash', new Date().toISOString(),
  );
  // separation_type is explicitly set (rather than left NULL-by-omission) to route around a
  // confirmed pg-mem bug: it rejects a NULL against `CHECK (col IN (...))` on a nullable
  // column, where real Postgres correctly treats NULL as passing any CHECK (the SQL standard
  // -- CHECK only rejects FALSE, never UNKNOWN). Verified in isolation against a minimal
  // repro table before concluding this is pg-mem's bug, not the migration's. Real Postgres is
  // unaffected; this is a test-harness-only workaround.
  await run(
    `INSERT INTO employee (id, organisation_id, department_id, employee_code, full_name, designation, hire_date, employment_status, separation_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'VOLUNTARY', ?)`,
    'emp1', 'org1', 'dept1', 'EMP-0001', 'Test Employee', 'Engineer', '2024-01-01', new Date().toISOString(),
  );

  const repo = new Repo('org1', 'user1');

  // Money as INTEGER paisa -- must come back as a real JS number, not a string.
  await run(
    `INSERT INTO salary_structure (id, organisation_id, employee_id, effective_from, basic, house_rent, medical, conveyance, food, dearness, provident_fund_pct, created_at)
     VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 10, ?)`,
    'sal1', 'org1', 'emp1', '2024-01-01', 5000000, new Date().toISOString(),
  );
  const structures = await repo.salaryStructures('emp1');
  assert.equal(typeof structures[0].basic, 'number');
  assert.equal(structures[0].basic, 5000000);
  console.log('money round-trips as a real number:', structures[0].basic, typeof structures[0].basic);

  // IS NOT DISTINCT FROM (the portable rewrite of SQLite's `IS ?`) -- NOT exercised here.
  // pg-mem's parser doesn't implement this operator at all (confirmed: it fails to PARSE the
  // query, not just execute it oddly), despite it being standard SQL and valid in every real
  // Postgres version (documented under "Comparison Functions and Operators" since early
  // Postgres releases). Already verified working against node:sqlite earlier this session;
  // real-Postgres verification for this one clause is deferred to the live Render deploy.

  // ON CONFLICT DO NOTHING (the portable rewrite of SQLite's INSERT OR IGNORE).
  await run(
    `INSERT INTO notice (id, organisation_id, title, body, published_by, published_at, audience_type, is_urgent)
     VALUES (?, ?, ?, ?, ?, ?, 'COMPANY', 0)`,
    'notice1', 'org1', 'Test', 'Body', 'user1', new Date().toISOString(),
  );
  await repo.markNoticeRead('notice1', 'emp1');
  await repo.markNoticeRead('notice1', 'emp1'); // second call must be a harmless no-op
  const readIds = await repo.readNoticeIdsFor('emp1');
  assert.equal(readIds.size, 1);
  console.log('ON CONFLICT DO NOTHING: second markNoticeRead was a no-op OK');

  // key_result sort_order (the portable rewrite of SQLite's ORDER BY rowid).
  const objId = await repo.createObjective({
    employeeId: 'emp1', quarter: '2026-Q1', title: 'Ship things', weightPct: 100,
    keyResults: [{ title: 'first', targetValue: 10 }, { title: 'second', targetValue: 20 }, { title: 'third', targetValue: 30 }],
  });
  const withKrs = await repo.objectiveWithKeyResults(objId);
  assert.deepEqual(withKrs.keyResults.map((k) => k.title), ['first', 'second', 'third']);
  console.log('key_result sort_order preserves insertion order OK');

  // Transaction + AsyncLocalStorage connection sharing: a nested `one()` call made INSIDE
  // transaction() must see a write made by a `run()` call earlier in that same transaction,
  // proving both went through the same checked-out client rather than each grabbing a fresh
  // connection from the pool. This is the property P0-7's leave-approval transaction
  // ("re-read the ledger INSIDE the transaction") actually depends on, and it's exercised
  // here for real -- this part of pg-mem's BEGIN support works correctly.
  await transaction(async () => {
    await run(`UPDATE organisation SET name = ? WHERE id = ?`, 'Committed Name', 'org1');
    const midTx = await one('SELECT name FROM organisation WHERE id = ?', 'org1');
    assert.equal(midTx.name, 'Committed Name');
  });
  const afterCommit = await one('SELECT name FROM organisation WHERE id = ?', 'org1');
  assert.equal(afterCommit.name, 'Committed Name');
  console.log('transaction commit + nested-call connection-sharing OK');

  // NOT exercised here: ROLLBACK actually reverting a write on error. Isolated repro (raw
  // pg-mem Pool/Client, zero involvement of this project's code) confirmed pg-mem does not
  // implement ROLLBACK correctly -- a change made and then rolled back is still visible
  // afterwards, even via a fresh connection. pgTransaction() in db-postgres.ts follows the
  // standard node-postgres transaction idiom (BEGIN on a dedicated client / COMMIT on
  // success / ROLLBACK + rethrow on error / always release) -- correct by code review and by
  // the identical guarantee already holding on the SQLite path (smoke.mjs's P0-7 check).
  // Real rollback behavior against Postgres itself should be spot-checked once the live
  // Render database exists, by re-running smoke.mjs's P0-7 concurrent-approval check with
  // DATABASE_URL set.

  console.log('ALL POSTGRES ADAPTER CHECKS PASSED (see source for what pg-mem could not verify)');
});
