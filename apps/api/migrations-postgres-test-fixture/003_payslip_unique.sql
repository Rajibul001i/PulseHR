-- Migration 003 — make the payslip duplicate guard real. PostgreSQL dialect; see
-- migrations/003_payslip_unique.sql for the full BUG-12 writeup. NULLs compare as DISTINCT
-- inside a UNIQUE index in Postgres too, so the same partial-index fix applies unchanged.

CREATE UNIQUE INDEX idx_payslip_one_per_period
  ON payslip (employee_id, period_year, period_month)
  WHERE adjusts_payslip_id IS NULL;
