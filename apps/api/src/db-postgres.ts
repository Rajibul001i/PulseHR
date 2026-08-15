/**
 * PostgreSQL backend (ADR-009 production target) — active whenever `DATABASE_URL` is set.
 * See db.ts for the backend-selection switch and db-sqlite.ts for the prototype counterpart.
 *
 * Design goal: repo.ts's SQL text and every value it sends/reads is IDENTICAL across both
 * backends. That means:
 *
 * - `?` placeholders are mechanically renumbered to `$1, $2, ...` here (toPositional below).
 *   The two queries that used to rely on SQLite-only syntax (`INSERT OR IGNORE`, `x IS ?`)
 *   were rewritten in repo.ts to portable forms (`ON CONFLICT ... DO NOTHING`,
 *   `x IS NOT DISTINCT FROM ?`) that both backends accept unchanged, rather than teaching
 *   this adapter to rewrite SQL text -- one portable query beats two dialect-specific ones.
 * - Money stays INTEGER paisa (migrations-postgres/001_init.sql), not NUMERIC. `pg` returns
 *   NUMERIC as a string (to avoid silent precision loss) -- every call site in this codebase
 *   already treats amounts as JS numbers straight off the row, matching what SQLite always
 *   returned. Following docs/03-data-model.md's "NUMERIC(14,2) taka" note literally would
 *   silently turn every money value into a string at the driver boundary and break arithmetic
 *   throughout @pulsehr/core. INTEGER avoids the whole problem.
 * - Timestamps and UUIDs stay TEXT, not TIMESTAMPTZ/UUID column types, for the same reason:
 *   `pg` returns TIMESTAMPTZ as a JS Date, not the ISO string the app stores and compares
 *   everywhere. Matching SQLite's actual returned shape column-for-column was judged lower
 *   risk than reintroducing type-parsing differences across ~70 call sites this pass already
 *   touches once each.
 */
import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Row } from './db-types.js';

const { Pool } = pg;

// COUNT(*) always returns bigint (OID 20) in Postgres regardless of the counted column's
// type, and `pg` returns bigint as a string by default (values above 2^53 would lose
// precision as a JS number). Every COUNT(*) in this codebase is wrapped in Number(...) at
// the call site already -- parsing bigint as a number here just makes that a no-op instead
// of silently operating on a string. No column in this schema is declared BIGINT itself.
pg.types.setTypeParser(20, (v) => Number(v));

let pool: pg.Pool | null = null;
const txClient = new AsyncLocalStorage<pg.PoolClient>();

function toPositional(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

interface Queryable {
  query(text: string, params: unknown[]): Promise<{ rows: Row[] }>;
}

function connection(): Queryable {
  const client = txClient.getStore();
  if (client) return client;
  if (!pool) throw new Error('Postgres pool not opened. Call openPostgres() first.');
  return pool;
}

export async function openPostgres(connectionString: string, migrationsDir: string): Promise<void> {
  pool = new Pool({ connectionString, max: 10 });
  // Fail fast on a bad connection string / unreachable host, rather than on the first request.
  await pool.query('SELECT 1');
  await migrate(migrationsDir);
}

/** Same tracking table and forward-only semantics as the SQLite runner (ADR-007) -- ported
 *  by hand rather than shared, since BEGIN/COMMIT/ROLLBACK go through a checked-out client
 *  here instead of a single global connection. */
async function migrate(migrationsDir: string): Promise<void> {
  if (!pool) throw new Error('Postgres pool not opened.');
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migration (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const appliedResult = await pool.query<{ name: string }>('SELECT name FROM schema_migration', []);
  const applied = new Set(appliedResult.rows.map((r) => r.name));

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migration (name, applied_at) VALUES ($1, $2)', [
        file,
        new Date().toISOString(),
      ]);
      await client.query('COMMIT');
      console.log(`[migrate] applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
}

export async function pgAll(sql: string, params: unknown[]): Promise<Row[]> {
  const result = await connection().query(toPositional(sql), params);
  return result.rows;
}

export async function pgOne(sql: string, params: unknown[]): Promise<Row | undefined> {
  const result = await connection().query(toPositional(sql), params);
  return result.rows[0];
}

export async function pgRun(sql: string, params: unknown[]): Promise<void> {
  await connection().query(toPositional(sql), params);
}

/** Unparameterised statements only (DDL, bulk `DELETE FROM x` in the seed script's wipe
 *  loop) -- never build a parameterised query with this. No `?` in these statements, so no
 *  placeholder conversion needed either. */
export async function pgExec(sql: string): Promise<void> {
  await connection().query(sql, []);
}

/** Checks out one client for the lifetime of `fn` and pins it to this async context
 *  (AsyncLocalStorage) so every nested all/one/run call inside `fn` -- including calls made
 *  through Repo methods several stack frames down -- reuses the SAME connection, without
 *  threading a client parameter through ~70 methods. This is load-bearing for P0-7: the
 *  leave-approval transaction re-reads the ledger and conditionally writes inside one
 *  transaction specifically so two concurrent approvals can't both pass the balance check
 *  against stale data (docs/13-sqa-defect-report.md). A transaction whose nested reads
 *  silently used a different pooled connection would defeat that guarantee entirely. */
export async function pgTransaction<T>(fn: () => Promise<T>): Promise<T> {
  if (!pool) throw new Error('Postgres pool not opened.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await txClient.run(client, fn);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
