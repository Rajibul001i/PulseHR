-- Migration 012 — explicit key_result display order. PostgreSQL dialect; see
-- migrations/012_key_result_order.sql.

ALTER TABLE key_result ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
