-- Migration 003 — make the payslip duplicate guard real.
--
-- BUG-12 (SQA-2026-08-10). Migration 001 declared:
--
--   UNIQUE (employee_id, period_year, period_month, adjusts_payslip_id)
--
-- intending "one ordinary payslip per employee per period". It does not do that. In both
-- SQLite and PostgreSQL, NULLs compare as DISTINCT inside a UNIQUE index, so two ordinary
-- payslips — each with adjusts_payslip_id = NULL — never collide. The constraint reads as
-- if it protects the invariant while protecting nothing.
--
-- Verified with scripts/verify-payslip-uniqueness.mjs: a second payslip for the same
-- employee and period inserted successfully.
--
-- Today only runPayroll() writes payslips and it checks first, so no duplicates exist in
-- practice. That is exactly why this is worth fixing now: the guard is one forgotten
-- `if` away from silently paying an employee twice, and payroll defects are expensive.
--
-- A PARTIAL unique index expresses the rule correctly: uniqueness applies only to rows
-- that are ordinary payslips. Adjustment payslips are deliberately exempt — there may be
-- several corrections against one original.

CREATE UNIQUE INDEX idx_payslip_one_per_period
  ON payslip (employee_id, period_year, period_month)
  WHERE adjusts_payslip_id IS NULL;
