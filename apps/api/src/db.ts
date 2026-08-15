/**
 * Database access + backend selection.
 *
 * ADR-009: SQLite (Node 24 built-in, zero native deps) for the prototype; PostgreSQL for
 * production, picked automatically by whether `DATABASE_URL` is set -- no separate feature
 * flag, since the two are mutually exclusive by definition (one process, one database).
 * Everything above this module (repo.ts and up) calls `all/one/run/transaction` and never
 * knows which backend answered -- see db-sqlite.ts and db-postgres.ts for the two
 * implementations, which are held to an identical returned-value shape on purpose (details
 * in db-postgres.ts's header comment). Everything goes through parameterised statements --
 * no string-built SQL.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSqlite, sqliteAll, sqliteExec, sqliteOne, sqliteRun, sqliteTransaction } from './db-sqlite.js';
import { openPostgres, pgAll, pgExec, pgOne, pgRun, pgTransaction } from './db-postgres.js';
import type { Row } from './db-types.js';

export type { Row };

const here = dirname(fileURLToPath(import.meta.url));

let backend: 'sqlite' | 'postgres' | null = null;

export async function openDb(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    backend = 'postgres';
    // Override exists for the pg-mem-backed test harness (verify-postgres-adapter.mjs),
    // which points this at a fixture directory -- never set in a real deployment.
    const migrationsDir = process.env.PULSEHR_PG_MIGRATIONS_DIR ?? join(here, '..', 'migrations-postgres');
    await openPostgres(connectionString, migrationsDir);
    console.log('[db] PostgreSQL backend');
  } else {
    backend = 'sqlite';
    const path = process.env.PULSEHR_DB ?? join(here, '..', 'pulsehr.db');
    openSqlite(path, join(here, '..', 'migrations'));
    console.log(`[db] SQLite backend (${path})`);
  }
}

function requireBackend(): 'sqlite' | 'postgres' {
  if (!backend) throw new Error('Database not opened. Call openDb() first.');
  return backend;
}

export function all(sql: string, ...params: unknown[]): Promise<Row[]> {
  return requireBackend() === 'postgres' ? pgAll(sql, params) : sqliteAll(sql, params);
}

export function one(sql: string, ...params: unknown[]): Promise<Row | undefined> {
  return requireBackend() === 'postgres' ? pgOne(sql, params) : sqliteOne(sql, params);
}

export function run(sql: string, ...params: unknown[]): Promise<void> {
  return requireBackend() === 'postgres' ? pgRun(sql, params) : sqliteRun(sql, params);
}

/** Raw, unparameterised statements only -- the seed script's idempotent wipe loop
 *  (`DELETE FROM ${table}`) is the one legitimate caller. Never build a parameterised query
 *  with this; use `run` instead so values go through proper binding. */
export function exec(sql: string): Promise<void> {
  return requireBackend() === 'postgres' ? pgExec(sql) : sqliteExec(sql);
}

/** Runs `fn` inside a transaction; rolls back on throw. `fn` must route every query through
 *  this module's `all/one/run` (not capture a connection itself) -- see db-postgres.ts's
 *  `pgTransaction` for why that's what makes nested Repo calls share one connection. */
export function transaction<T>(fn: () => Promise<T>): Promise<T> {
  return requireBackend() === 'postgres' ? pgTransaction(fn) : sqliteTransaction(fn);
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
