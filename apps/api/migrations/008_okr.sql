-- F6 Performance Management (OKR) — US-30..US-33.

CREATE TABLE objective (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  employee_id     TEXT NOT NULL REFERENCES employee(id),
  set_by          TEXT NOT NULL REFERENCES app_user(id),
  quarter         TEXT NOT NULL,   -- 'YYYY-Qn'
  title           TEXT NOT NULL,
  weight_pct      INTEGER NOT NULL CHECK (weight_pct > 0 AND weight_pct <= 100),
  -- US-30: "Objectives become read-only once the quarter closes." A quarter is closed
  -- explicitly by HR rather than inferred from today's date, so a late-entered objective for
  -- an already-reviewed quarter is still possible up until HR closes the books on it.
  closed_at       TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_objective_employee ON objective(employee_id, quarter);

CREATE TABLE key_result (
  id            TEXT PRIMARY KEY,
  objective_id  TEXT NOT NULL REFERENCES objective(id),
  title         TEXT NOT NULL,
  target_value  REAL NOT NULL,
  current_value REAL NOT NULL DEFAULT 0,
  unit          TEXT,
  -- US-31: "Progress beyond the target requires a comment before it is accepted."
  comment       TEXT,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_key_result_objective ON key_result(objective_id);

-- US-32: one score per employee per quarter; a second submission overwrites (with an audit
-- entry via the existing audit_log table, not a second row here).
CREATE TABLE review_score (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  employee_id     TEXT NOT NULL REFERENCES employee(id),
  quarter         TEXT NOT NULL,
  score           REAL NOT NULL CHECK (score >= 1 AND score <= 5),
  recorded_by     TEXT NOT NULL REFERENCES app_user(id),
  -- Visible to the employee only once published (US-32). NULL = draft, HR-only.
  published_at    TEXT,
  created_at      TEXT NOT NULL,
  UNIQUE (employee_id, quarter)
);
CREATE INDEX idx_review_score_employee ON review_score(employee_id, quarter);
