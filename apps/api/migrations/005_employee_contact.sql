-- Migration 005 — employee self-service contact fields (F2.2 / US-09).
--
-- "As an Employee, I want to update my own contact details, so that HR always holds my
-- current phone number and address without me filing a paper form."
--
-- Deliberately excludes salary, designation and department -- US-09's own acceptance
-- criteria mark those read-only on this screen; editing them is HR's job (US-08), not
-- self-service, and is not built here (see docs/13-sqa-defect-report.md §9).

ALTER TABLE employee ADD COLUMN phone TEXT;
ALTER TABLE employee ADD COLUMN address TEXT;
ALTER TABLE employee ADD COLUMN emergency_contact TEXT;
