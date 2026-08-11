-- F8 Digital Noticeboard — closing out US-39's audience targeting (never actually built
-- despite being marked done — see docs/13-sqa-defect-report.md §11), plus US-40 (urgent
-- pinning) and US-41 (read tracking).

ALTER TABLE notice ADD COLUMN audience_type TEXT NOT NULL DEFAULT 'COMPANY'
  CHECK (audience_type IN ('COMPANY','DEPARTMENTS'));
ALTER TABLE notice ADD COLUMN is_urgent INTEGER NOT NULL DEFAULT 0;

CREATE TABLE notice_department (
  notice_id     TEXT NOT NULL REFERENCES notice(id),
  department_id TEXT NOT NULL REFERENCES department(id),
  PRIMARY KEY (notice_id, department_id)
);

-- US-41: "Opening a notice records the employee and the time, once only."
CREATE TABLE notice_read (
  notice_id   TEXT NOT NULL REFERENCES notice(id),
  employee_id TEXT NOT NULL REFERENCES employee(id),
  read_at     TEXT NOT NULL,
  PRIMARY KEY (notice_id, employee_id)
);
