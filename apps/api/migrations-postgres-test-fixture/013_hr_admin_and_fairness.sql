-- Migration 013 — pg-mem test fixture copy. The leave-overlap exclusion constraint is
-- stripped here only (pg-mem has no btree_gist/EXCLUDE); the real migration keeps it.

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

