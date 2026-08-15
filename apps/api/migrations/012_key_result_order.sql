-- Migration 012 — explicit key_result display order.
--
-- objectiveWithKeyResults() ordered by SQLite's implicit `rowid` (insertion order) since
-- key_result has no ordering column of its own. rowid has no PostgreSQL equivalent -- it's
-- a SQLite-only implicit column, not something that survives the ADR-009 production
-- migration. An explicit column, the same pattern payslip_line already uses for its own
-- display order, is the portable fix.

ALTER TABLE key_result ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
