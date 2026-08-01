-- PulseHR schema, migration 001.
-- SQLite dialect for the prototype (ADR-009). The canonical PostgreSQL DDL, including
-- the gist exclusion constraint and Row-Level Security, is in docs/03-data-model.md.
--
-- Forward-only. A mistake is corrected by 002, never by editing this file (ADR-007).

-- Every business table carries organisation_id (ADR-003 / P0-5). A multi-tenant SaaS
-- whose ERD has no tenant key leaks customer data on day one.

CREATE TABLE organisation (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  tier          TEXT NOT NULL CHECK (tier IN ('STARTER','GROWTH','ENTERPRISE')),
  -- Bangladesh: Friday+Saturday weekend by default (P0-9).
  weekend_days  TEXT NOT NULL DEFAULT '5,6',
  created_at    TEXT NOT NULL
);

CREATE TABLE department (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  name            TEXT NOT NULL
);
CREATE INDEX idx_department_org ON department(organisation_id);

-- A login is NOT an employee (P1-18). Separate identity from personnel record.
CREATE TABLE app_user (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  email           TEXT NOT NULL,
  password_hash   TEXT NOT NULL,   -- scrypt: salt:derivedKey (ADR-006)
  role            TEXT NOT NULL CHECK (role IN ('EMPLOYEE','MANAGER','HR_ADMIN')),
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  UNIQUE (organisation_id, email)
);

-- Revocable refresh sessions (ADR-006 / P1-19). A stateless JWT cannot be revoked, and an
-- HRIS must be able to cut a terminated employee's access immediately.
CREATE TABLE session (
  id                 TEXT PRIMARY KEY,
  organisation_id    TEXT NOT NULL REFERENCES organisation(id),
  user_id            TEXT NOT NULL REFERENCES app_user(id),
  refresh_token_hash TEXT NOT NULL,   -- stored hashed: a DB leak must not yield live sessions
  expires_at         TEXT NOT NULL,
  revoked_at         TEXT,
  created_at         TEXT NOT NULL
);
CREATE INDEX idx_session_user ON session(user_id);

CREATE TABLE employee (
  id                TEXT PRIMARY KEY,
  organisation_id   TEXT NOT NULL REFERENCES organisation(id),
  user_id           TEXT REFERENCES app_user(id),
  department_id     TEXT REFERENCES department(id),
  manager_id        TEXT REFERENCES employee(id),
  employee_code     TEXT NOT NULL,
  full_name         TEXT NOT NULL,
  designation       TEXT NOT NULL,
  gender            TEXT,             -- used ONLY for the quarterly bias audit (spec §9)
  hire_date         TEXT NOT NULL,
  employment_status TEXT NOT NULL DEFAULT 'ACTIVE'
                      CHECK (employment_status IN ('ACTIVE','RESIGNED','TERMINATED')),
  separation_date   TEXT,
  -- Label for the future v2 model: voluntary vs involuntary matters (spec §3).
  separation_type   TEXT CHECK (separation_type IN ('VOLUNTARY','INVOLUNTARY')),
  -- P1-4: never store a raw National ID. Salted hash + last 4 only.
  nid_hash          TEXT,
  nid_last4         TEXT,
  manager_changed_at TEXT,
  created_at        TEXT NOT NULL,
  UNIQUE (organisation_id, employee_code)
);
CREATE INDEX idx_employee_org ON employee(organisation_id);
CREATE INDEX idx_employee_manager ON employee(manager_id);

-- Effective-dated, never overwritten: March 2026 payroll must reproduce in 2029 (P0-8).
CREATE TABLE salary_structure (
  id                 TEXT PRIMARY KEY,
  organisation_id    TEXT NOT NULL REFERENCES organisation(id),
  employee_id        TEXT NOT NULL REFERENCES employee(id),
  effective_from     TEXT NOT NULL,
  basic              INTEGER NOT NULL,   -- paisa
  house_rent         INTEGER NOT NULL DEFAULT 0,
  medical            INTEGER NOT NULL DEFAULT 0,
  conveyance         INTEGER NOT NULL DEFAULT 0,
  food               INTEGER NOT NULL DEFAULT 0,
  dearness           INTEGER NOT NULL DEFAULT 0,
  provident_fund_pct REAL NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL
);
CREATE INDEX idx_salary_emp ON salary_structure(employee_id, effective_from);

CREATE TABLE attendance (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  employee_id     TEXT NOT NULL REFERENCES employee(id),
  work_date       TEXT NOT NULL,       -- Asia/Dhaka business date (ADR-005)
  check_in        TEXT,                -- UTC instant
  check_out       TEXT,
  late_minutes    INTEGER NOT NULL DEFAULT 0,
  ot_hours        REAL NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'PRESENT'
                    CHECK (status IN ('PRESENT','ABSENT','ON_LEAVE','HOLIDAY','WEEKEND')),
  is_unplanned    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (employee_id, work_date)
);
-- Covering index for the monthly attendance grid — the hot path (P1-23).
CREATE INDEX idx_attendance_grid ON attendance(organisation_id, employee_id, work_date);

CREATE TABLE leave_request (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  employee_id     TEXT NOT NULL REFERENCES employee(id),
  leave_type      TEXT NOT NULL
                    CHECK (leave_type IN ('EARNED','CASUAL','SICK','FESTIVAL','MATERNITY','LWP')),
  start_date      TEXT NOT NULL,
  end_date        TEXT NOT NULL,
  days            INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  reason          TEXT NOT NULL DEFAULT '',
  decided_by      TEXT REFERENCES app_user(id),
  decided_at      TEXT,
  created_at      TEXT NOT NULL,
  CHECK (end_date >= start_date)
);
CREATE INDEX idx_leave_emp ON leave_request(employee_id, status);
-- PostgreSQL adds: EXCLUDE USING gist (employee_id WITH =,
--   daterange(start_date, end_date, '[]') WITH &&) WHERE (status = 'APPROVED')
-- SQLite has no exclusion constraints, so the prototype enforces overlap in the
-- transaction instead (ADR-009, docs/04-payroll-spec.md §2).

-- P0-7: balance is DERIVED from this append-only ledger, never stored as a column.
CREATE TABLE leave_ledger (
  id                TEXT PRIMARY KEY,
  organisation_id   TEXT NOT NULL REFERENCES organisation(id),
  employee_id       TEXT NOT NULL REFERENCES employee(id),
  leave_type        TEXT NOT NULL,
  delta             REAL NOT NULL,      -- + accrual, - consumption. Never zero.
  effective_date    TEXT NOT NULL,
  reason            TEXT NOT NULL,
  source_request_id TEXT REFERENCES leave_request(id),
  created_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  CHECK (delta <> 0)
);
CREATE INDEX idx_ledger_balance ON leave_ledger(employee_id, leave_type, effective_date);

-- Immutable after issue (P0-8 / NFR-9). Corrections are a NEW adjustment payslip.
CREATE TABLE payslip (
  id                  TEXT PRIMARY KEY,
  organisation_id     TEXT NOT NULL REFERENCES organisation(id),
  employee_id         TEXT NOT NULL REFERENCES employee(id),
  period_year         INTEGER NOT NULL,
  period_month        INTEGER NOT NULL,
  salary_structure_id TEXT NOT NULL REFERENCES salary_structure(id),
  engine_version      TEXT NOT NULL,
  days_in_period      INTEGER NOT NULL,
  lwp_days            INTEGER NOT NULL,
  payable_days        INTEGER NOT NULL,
  ot_hours            REAL NOT NULL,
  ot_hourly_rate      INTEGER NOT NULL,
  gross               INTEGER NOT NULL,
  total_deductions    INTEGER NOT NULL,
  net_pay             INTEGER NOT NULL,
  adjusts_payslip_id  TEXT REFERENCES payslip(id),
  issued_at           TEXT NOT NULL,
  issued_by           TEXT NOT NULL,
  UNIQUE (employee_id, period_year, period_month, adjusts_payslip_id)
);
CREATE INDEX idx_payslip_period ON payslip(organisation_id, period_year, period_month);

CREATE TABLE payslip_line (
  id         TEXT PRIMARY KEY,
  payslip_id TEXT NOT NULL REFERENCES payslip(id),
  code       TEXT NOT NULL,
  label      TEXT NOT NULL,
  amount     INTEGER NOT NULL,     -- paisa
  sign       INTEGER NOT NULL CHECK (sign IN (1, -1)),
  sort_order INTEGER NOT NULL
);
CREATE INDEX idx_payslip_line ON payslip_line(payslip_id);

-- Enforce immutability at the database level, not by convention (NFR-9).
CREATE TRIGGER payslip_is_immutable
BEFORE UPDATE ON payslip
BEGIN
  SELECT RAISE(ABORT, 'payslip is immutable — issue an adjustment payslip instead');
END;

CREATE TRIGGER payslip_line_is_immutable
BEFORE UPDATE ON payslip_line
BEGIN
  SELECT RAISE(ABORT, 'payslip_line is immutable');
END;

CREATE TABLE attrition_score (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  employee_id     TEXT NOT NULL REFERENCES employee(id),
  scored_on       TEXT NOT NULL,
  score           INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  band            TEXT NOT NULL CHECK (band IN ('LOW','MODERATE','ELEVATED','HIGH')),
  engine_version  TEXT NOT NULL,
  contested       INTEGER NOT NULL DEFAULT 0,   -- spec §9: employees may contest
  created_at      TEXT NOT NULL,
  UNIQUE (employee_id, scored_on)
);
CREATE INDEX idx_score_lookup ON attrition_score(organisation_id, scored_on, score DESC);

-- A bare score is never displayed. Contributions travel with it (spec §9).
CREATE TABLE attrition_contribution (
  id          TEXT PRIMARY KEY,
  score_id    TEXT NOT NULL REFERENCES attrition_score(id),
  feature_key TEXT NOT NULL,
  label       TEXT NOT NULL,
  normalised  REAL NOT NULL,
  weight      REAL NOT NULL,
  points      REAL NOT NULL
);
CREATE INDEX idx_contribution ON attrition_contribution(score_id);

CREATE TABLE notice (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  published_by    TEXT NOT NULL REFERENCES app_user(id),
  published_at    TEXT NOT NULL
);
CREATE INDEX idx_notice_org ON notice(organisation_id, published_at DESC);

-- Every write, and every attrition-score VIEW, is audited (spec §9).
CREATE TABLE audit_log (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  actor_user_id   TEXT,
  action          TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       TEXT,
  detail          TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_audit_org ON audit_log(organisation_id, created_at DESC);

CREATE TABLE holiday (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  holiday_date    TEXT NOT NULL,
  name            TEXT NOT NULL,
  UNIQUE (organisation_id, holiday_date)
);
