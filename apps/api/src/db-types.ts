/** Shared between db-sqlite.ts and db-postgres.ts so neither backend module imports the
 *  other (both are imported BY db.ts, never import each other). */
export type Row = Record<string, unknown>;
