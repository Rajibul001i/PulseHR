/**
 * SQLite backend (ADR-009 prototype target) — zero-install, the default when no
 * `DATABASE_URL` is set. See db.ts for the backend-selection switch and db-postgres.ts for
 * the production counterpart; both implement the same async `all/one/run/transaction` shape
 * so repo.ts and everything above it never know which one is active.
 *
 * `node:sqlite` is synchronous end to end -- there is no I/O to await. The `async` here exists
 * only so this backend satisfies the same Promise-returning interface as the Postgres one,
 * not because anything actually yields.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Row } from './db-types.js';

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (!db) throw new Error('SQLite database not opened. Call openSqlite() first.');
  return db;
}

export function openSqlite(path: string, migrationsDir: string): void {
  db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  migrate(db, migrationsDir);
}

/** Forward-only numbered migrations, applied in order (ADR-007). */
function migrate(conn: DatabaseSync, migrationsDir: string): void {
  conn.exec(`CREATE TABLE IF NOT EXISTS schema_migration (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const applied = new Set(
    (conn.prepare('SELECT name FROM schema_migration').all() as Row[]).map((r) => String(r.name)),
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
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

export async function sqliteAll(sql: string, params: unknown[]): Promise<Row[]> {
  return getDb().prepare(sql).all(...(params as never[])) as Row[];
}

export async function sqliteOne(sql: string, params: unknown[]): Promise<Row | undefined> {
  return getDb().prepare(sql).get(...(params as never[])) as Row | undefined;
}

export async function sqliteRun(sql: string, params: unknown[]): Promise<void> {
  getDb().prepare(sql).run(...(params as never[]));
}

/** Unparameterised statements only (DDL, bulk `DELETE FROM x` in the seed script's wipe
 *  loop) -- never build a parameterised query with this. */
export async function sqliteExec(sql: string): Promise<void> {
  getDb().exec(sql);
}

/** Whole database is one connection, so "transaction" just means "hold the write lock while
 *  `fn` runs" -- every nested all/one/run call already goes through that same connection. */
export async function sqliteTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const conn = getDb();
  conn.exec('BEGIN IMMEDIATE');
  try {
    const result = await fn();
    conn.exec('COMMIT');
    return result;
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
}
