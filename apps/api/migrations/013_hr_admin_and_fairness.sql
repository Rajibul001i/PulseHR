-- Migration 013 — closes gaps found by the report-vs-code review (docs/18-gap-analysis.md).
-- SQLite dialect; see migrations-postgres/013_hr_admin_and_fairness.sql.

-- F9.1 / F8 okr_engagement_drop: every key-result progress update, so the scorecard can
-- compare activity across two windows. key_result.updated_at only kept the latest one.
CREATE TABLE key_result_update (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  key_result_id   TEXT NOT NULL REFERENCES key_result(id),
  employee_id     TEXT NOT NULL REFERENCES employee(id),
  updated_by      TEXT NOT NULL,
  new_value       REAL NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_kr_update_employee ON key_result_update(employee_id, created_at);

-- Spec §9: employees may contest a score; contested scores are flagged and reviewed by HR.
ALTER TABLE attrition_score ADD COLUMN contest_note TEXT;
ALTER TABLE attrition_score ADD COLUMN contested_at TEXT;
ALTER TABLE attrition_score ADD COLUMN contest_outcome TEXT
  CHECK (contest_outcome IN ('UPHELD','CORRECTED'));
ALTER TABLE attrition_score ADD COLUMN contest_review_note TEXT;
ALTER TABLE attrition_score ADD COLUMN contest_reviewed_at TEXT;

-- Spec §9: the quarterly bias audit is a scheduled job with a written report.
CREATE TABLE bias_audit_report (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  run_on          TEXT NOT NULL,
  scores_on       TEXT,
  flagged         INTEGER NOT NULL DEFAULT 0,
  report          TEXT NOT NULL,        -- JSON
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_bias_audit_org ON bias_audit_report(organisation_id, run_on DESC);

-- Overlapping approved leave is impossible at the schema level, not only in the approval
-- transaction. PostgreSQL uses an exclusion constraint; SQLite has none, so two triggers.
CREATE TRIGGER leave_no_overlap_insert
BEFORE INSERT ON leave_request
WHEN NEW.status = 'APPROVED'
BEGIN
  SELECT RAISE(ABORT, 'overlapping approved leave for this employee')
   WHERE EXISTS (SELECT 1 FROM leave_request l
                  WHERE l.employee_id = NEW.employee_id AND l.status = 'APPROVED'
                    AND l.id <> NEW.id
                    AND l.start_date <= NEW.end_date AND NEW.start_date <= l.end_date);
END;

CREATE TRIGGER leave_no_overlap_update
BEFORE UPDATE OF status, start_date, end_date ON leave_request
WHEN NEW.status = 'APPROVED'
BEGIN
  SELECT RAISE(ABORT, 'overlapping approved leave for this employee')
   WHERE EXISTS (SELECT 1 FROM leave_request l
                  WHERE l.employee_id = NEW.employee_id AND l.status = 'APPROVED'
                    AND l.id <> NEW.id
                    AND l.start_date <= NEW.end_date AND NEW.start_date <= l.end_date);
END;
