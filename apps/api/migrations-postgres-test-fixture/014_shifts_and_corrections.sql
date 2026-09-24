-- Migration 014 — shifts, shift assignments, and attendance corrections.
-- pg-mem test fixture copy of migrations-postgres/014_shifts_and_corrections.sql.

-- A shift is a daily duty time in Asia/Dhaka. end_time <= start_time means it runs overnight.
CREATE TABLE shift (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  name            TEXT NOT NULL,
  start_time      TEXT NOT NULL,              -- 'HH:MM'
  end_time        TEXT NOT NULL,              -- 'HH:MM'
  break_minutes   INTEGER NOT NULL DEFAULT 60 CHECK (break_minutes >= 0),
  grace_minutes   INTEGER NOT NULL DEFAULT 0 CHECK (grace_minutes >= 0),
  work_days       TEXT,                       -- '0,1,2,3,4'; NULL = the organisation's usual week
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  UNIQUE (organisation_id, name)
);

-- Effective-dated like salary structures: a new assignment takes over from its date, and the
-- old one stays, so any past day's duty time can still be answered.
CREATE TABLE shift_assignment (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  employee_id     TEXT NOT NULL REFERENCES employee(id),
  shift_id        TEXT NOT NULL REFERENCES shift(id),
  effective_from  TEXT NOT NULL,
  assigned_by     TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  UNIQUE (employee_id, effective_from)
);
CREATE INDEX idx_shift_assignment_employee ON shift_assignment(employee_id, effective_from);

-- Every correction to a check-in or check-out, requested by the employee or made directly by
-- a manager or HR. The values before and after are kept, so the record can always be audited.
CREATE TABLE attendance_correction (
  id                 TEXT PRIMARY KEY,
  organisation_id    TEXT NOT NULL REFERENCES organisation(id),
  employee_id        TEXT NOT NULL REFERENCES employee(id),
  work_date          TEXT NOT NULL,
  requested_check_in  TEXT NOT NULL,          -- UTC instant
  requested_check_out TEXT,                   -- UTC instant
  reason             TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  requested_by       TEXT NOT NULL,
  decided_by         TEXT,
  decided_at         TEXT,
  decision_reason    TEXT,
  previous_check_in  TEXT,
  previous_check_out TEXT,
  previous_status    TEXT,
  created_at         TEXT NOT NULL
);
CREATE INDEX idx_correction_org_status ON attendance_correction(organisation_id, status);
CREATE INDEX idx_correction_employee ON attendance_correction(employee_id, work_date);

-- Notifications gain correction and shift types: the constraint swap is stripped from this
-- pg-mem fixture copy only (pg-mem names CHECK constraints differently from PostgreSQL). The
-- real migration is verified against PostgreSQL 16 in CI.
