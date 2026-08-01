/**
 * Database access + migration runner.
 *
 * ADR-009: SQLite (Node 24 built-in, zero native deps) for the prototype; PostgreSQL for
 * production. Everything goes through parameterised statements — no string-built SQL.
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, '..', 'migrations');

export type Row = Record<string, unknown>;

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!db) throw new Error('Database not opened. Call openDb() first.');
  return db;
}

export function openDb(path = process.env.PULSEHR_DB ?? join(here, '..', 'pulsehr.db')): DatabaseSync {
  db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  migrate(db);
  return db;
}

/** Forward-only numbered migrations, applied in order (ADR-007). */
function migrate(conn: DatabaseSync): void {
  conn.exec(`CREATE TABLE IF NOT EXISTS schema_migration (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const applied = new Set(
    (conn.prepare('SELECT name FROM schema_migration').all() as Row[]).map((r) => String(r.name)),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    conn.exec('BEGIN');
    try {
      conn.exec(sql);
      conn
        .prepare('INSERT INTO schema_migration (name, applied_at) VALUES (?, ?)')
        .run(file, new Date().toISOString());
      conn.exec('COMMIT');
      console.log(`[migrate] applied ${file}`);
    } catch (err) {
      conn.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
}

/** Run `fn` inside a transaction. Rolls back on throw. */
export function transaction<T>(fn: () => T): T {
  const conn = getDb();
  conn.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    conn.exec('COMMIT');
    return result;
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
}

export function all(sql: string, ...params: unknown[]): Row[] {
  return getDb().prepare(sql).all(...(params as never[])) as Row[];
}

export function one(sql: string, ...params: unknown[]): Row | undefined {
  return getDb().prepare(sql).get(...(params as never[])) as Row | undefined;
}

export function run(sql: string, ...params: unknown[]): void {
  getDb().prepare(sql).run(...(params as never[]));
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
