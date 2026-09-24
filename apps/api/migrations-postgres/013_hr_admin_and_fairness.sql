-- Migration 013 — PostgreSQL dialect; see migrations/013_hr_admin_and_fairness.sql.

CREATE TABLE key_result_update (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  key_result_id   TEXT NOT NULL REFERENCES key_result(id),
  employee_id     TEXT NOT NULL REFERENCES employee(id),
  updated_by      TEXT NOT NULL,
  new_value       DOUBLE PRECISION NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_kr_update_employee ON key_result_update(employee_id, created_at);

ALTER TABLE attrition_score ADD COLUMN contest_note TEXT;
ALTER TABLE attrition_score ADD COLUMN contested_at TEXT;
ALTER TABLE attrition_score ADD COLUMN contest_outcome TEXT
  CHECK (contest_outcome IN ('UPHELD','CORRECTED'));
ALTER TABLE attrition_score ADD COLUMN contest_review_note TEXT;
ALTER TABLE attrition_score ADD COLUMN contest_reviewed_at TEXT;

CREATE TABLE bias_audit_report (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  run_on          TEXT NOT NULL,
  scores_on       TEXT,
  flagged         INTEGER NOT NULL DEFAULT 0,
  report          TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_bias_audit_org ON bias_audit_report(organisation_id, run_on DESC);

-- Overlapping approved leave is impossible at the schema level (docs/03-data-model.md).
-- Dates are stored as ISO text (see 001), so the range comes from an IMMUTABLE wrapper --
-- a bare text::date cast is only STABLE and cannot appear in an index expression.
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE FUNCTION pulsehr_leave_range(s TEXT, e TEXT) RETURNS daterange
  LANGUAGE sql IMMUTABLE AS $$ SELECT daterange(s::date, e::date, '[]') $$;
ALTER TABLE leave_request ADD CONSTRAINT leave_no_overlapping_approved
  EXCLUDE USING gist (employee_id WITH =, pulsehr_leave_range(start_date, end_date) WITH &&)
  WHERE (status = 'APPROVED');
