-- Migration 005 — employee self-service contact fields (F2.2 / US-09). PostgreSQL dialect;
-- see migrations/005_employee_contact.sql.

ALTER TABLE employee ADD COLUMN phone TEXT;
ALTER TABLE employee ADD COLUMN address TEXT;
ALTER TABLE employee ADD COLUMN emergency_contact TEXT;
