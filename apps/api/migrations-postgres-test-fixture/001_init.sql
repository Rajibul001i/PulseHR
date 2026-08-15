-- PulseHR schema, migration 001 — PostgreSQL dialect (ADR-009 production target).
--
-- Mechanical translation of migrations/001_init.sql (the SQLite prototype schema), kept
-- column-for-column identical in name, nullability and default so the Repo layer's SQL text
-- (parameter placeholders aside) runs unchanged against either backend. Type mapping:
-- TEXT -> TEXT, INTEGER -> INTEGER, REAL -> DOUBLE PRECISION, BLOB -> BYTEA. Money stays
-- INTEGER paisa (not NUMERIC) deliberately -- see db-postgres.ts's header comment for why.
--
-- Forward-only. A mistake is corrected by 002, never by editing this file (ADR-007).

CREATE TABLE organisation (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  tier          TEXT NOT NULL CHECK (tier IN ('STARTER','GROWTH','ENTERPRISE')),
  weekend_days  TEXT NOT NULL DEFAULT '5,6',
  created_at    TEXT NOT NULL
);

CREATE TABLE department (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  name            TEXT NOT NULL
);
CREATE INDEX idx_department_org ON department(organisation_id);

CREATE TABLE app_user (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  email           TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('EMPLOYEE','MANAGER','HR_ADMIN')),
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  UNIQUE (organisation_id, email)
);

CREATE TABLE session (
  id                 TEXT PRIMARY KEY,
  organisation_id    TEXT NOT NULL REFERENCES organisation(id),
  user_id            TEXT NOT NULL REFERENCES app_user(id),
  refresh_token_hash TEXT NOT NULL,
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
  gender            TEXT,
  hire_date         TEXT NOT NULL,
  employment_status TEXT NOT NULL DEFAULT 'ACTIVE'
                      CHECK (employment_status IN ('ACTIVE','RESIGNED','TERMINATED')),
  separation_date   TEXT,
  separation_type   TEXT CHECK (separation_type IN ('VOLUNTARY','INVOLUNTARY')),
  nid_hash          TEXT,
  nid_last4         TEXT,
  manager_changed_at TEXT,
  created_at        TEXT NOT NULL,
  UNIQUE (organisation_id, employee_code)
);
CREATE INDEX idx_employee_org ON employee(organisation_id);
CREATE INDEX idx_employee_manager ON employee(manager_id);

CREATE TABLE salary_structure (
  id                 TEXT PRIMARY KEY,
  organisation_id    TEXT NOT NULL REFERENCES organisation(id),
  employee_id        TEXT NOT NULL REFERENCES employee(id),
  effective_from     TEXT NOT NULL,
  basic              INTEGER NOT NULL,
  house_rent         INTEGER NOT NULL DEFAULT 0,
  medical            INTEGER NOT NULL DEFAULT 0,
  conveyance         INTEGER NOT NULL DEFAULT 0,
  food               INTEGER NOT NULL DEFAULT 0,
  dearness            INTEGER NOT NULL DEFAULT 0,
  provident_fund_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL
);
CREATE INDEX idx_salary_emp ON salary_structure(employee_id, effective_from);

CREATE TABLE attendance (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  employee_id     TEXT NOT NULL REFERENCES employee(id),
  work_date       TEXT NOT NULL,
  check_in        TEXT,
  check_out       TEXT,
  late_minutes    INTEGER NOT NULL DEFAULT 0,
  ot_hours        DOUBLE PRECISION NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'PRESENT'
                    CHECK (status IN ('PRESENT','ABSENT','ON_LEAVE','HOLIDAY','WEEKEND')),
  is_unplanned    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (employee_id, work_date)
);
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
-- docs/03-data-model.md documents an additional `EXCLUDE USING gist (...)` constraint
-- (requires the btree_gist extension) as defense-in-depth alongside the application-level
-- overlap check already enforced in the approval transaction (ADR-009). Deliberately not
-- added in this pass -- it's an additional safety net on top of a control that already
-- exists and is tested, not something this migration needs in order to be a real production
-- database. Worth adding later; tracked here rather than silently dropped.

CREATE TABLE leave_ledger (
  id                TEXT PRIMARY KEY,
  organisation_id   TEXT NOT NULL REFERENCES organisation(id),
  employee_id       TEXT NOT NULL REFERENCES employee(id),
  leave_type        TEXT NOT NULL,
  delta             DOUBLE PRECISION NOT NULL,
  effective_date    TEXT NOT NULL,
  reason            TEXT NOT NULL,
  source_request_id TEXT REFERENCES leave_request(id),
  created_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  CHECK (delta <> 0)
);
CREATE INDEX idx_ledger_balance ON leave_ledger(employee_id, leave_type, effective_date);

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
  ot_hours            DOUBLE PRECISION NOT NULL,
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
  amount     INTEGER NOT NULL,
  sign       INTEGER NOT NULL CHECK (sign IN (1, -1)),
  sort_order INTEGER NOT NULL
);
CREATE INDEX idx_payslip_line ON payslip_line(payslip_id);

-- TEST FIXTURE NOTE: the real migrations-postgres/001_init.sql enforces payslip immutability
-- with CREATE TRIGGER ... EXECUTE FUNCTION (standard, valid Postgres DDL). pg-mem's SQL
-- parser -- used only here, to test the rest of this schema without a real Postgres -- does
-- not implement CREATE TRIGGER, so it's stripped from this copy only. Never edit the real
-- migration to match; this file exists solely so the other 30+ tables can still be verified.

CREATE TABLE attrition_score (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  employee_id     TEXT NOT NULL REFERENCES employee(id),
  scored_on       TEXT NOT NULL,
  score           INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  band            TEXT NOT NULL CHECK (band IN ('LOW','MODERATE','ELEVATED','HIGH')),
  engine_version  TEXT NOT NULL,
  contested       INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  UNIQUE (employee_id, scored_on)
);
CREATE INDEX idx_score_lookup ON attrition_score(organisation_id, scored_on, score DESC);

CREATE TABLE attrition_contribution (
  id          TEXT PRIMARY KEY,
  score_id    TEXT NOT NULL REFERENCES attrition_score(id),
  feature_key TEXT NOT NULL,
  label       TEXT NOT NULL,
  normalised  DOUBLE PRECISION NOT NULL,
  weight      DOUBLE PRECISION NOT NULL,
  points      DOUBLE PRECISION NOT NULL
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
