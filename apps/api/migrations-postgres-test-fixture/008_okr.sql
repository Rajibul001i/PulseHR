-- F6 Performance Management (OKR) — US-30..US-33. PostgreSQL dialect; see migrations/008_okr.sql.

CREATE TABLE objective (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  employee_id     TEXT NOT NULL REFERENCES employee(id),
  set_by          TEXT NOT NULL REFERENCES app_user(id),
  quarter         TEXT NOT NULL,
  title           TEXT NOT NULL,
  weight_pct      INTEGER NOT NULL CHECK (weight_pct > 0 AND weight_pct <= 100),
  closed_at       TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_objective_employee ON objective(employee_id, quarter);

CREATE TABLE key_result (
  id            TEXT PRIMARY KEY,
  objective_id  TEXT NOT NULL REFERENCES objective(id),
  title         TEXT NOT NULL,
  target_value  DOUBLE PRECISION NOT NULL,
  current_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  unit          TEXT,
  comment       TEXT,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_key_result_objective ON key_result(objective_id);

CREATE TABLE review_score (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  employee_id     TEXT NOT NULL REFERENCES employee(id),
  quarter         TEXT NOT NULL,
  score           DOUBLE PRECISION NOT NULL CHECK (score >= 1 AND score <= 5),
  recorded_by     TEXT NOT NULL REFERENCES app_user(id),
  published_at    TEXT,
  created_at      TEXT NOT NULL,
  UNIQUE (employee_id, quarter)
);
CREATE INDEX idx_review_score_employee ON review_score(employee_id, quarter);
