-- F7 Recruitment — Applicant Tracking System — US-34..US-38.

CREATE TABLE vacancy (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  title           TEXT NOT NULL,
  requirements    TEXT NOT NULL,
  deadline        TEXT NOT NULL,  -- ISO date; applications close after this date (US-34)
  status          TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('PUBLISHED','CLOSED')),
  created_by      TEXT NOT NULL REFERENCES app_user(id),
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_vacancy_org ON vacancy(organisation_id);

-- US-35: an application needs no account. organisation_id is denormalised from the vacancy
-- so the public, unauthenticated submission route can be tenant-scoped without a join, and
-- so a candidate record still carries its tenant even if the vacancy is later deleted.
CREATE TABLE candidate (
  id                   TEXT PRIMARY KEY,
  organisation_id      TEXT NOT NULL REFERENCES organisation(id),
  vacancy_id           TEXT NOT NULL REFERENCES vacancy(id),
  full_name            TEXT NOT NULL,
  email                TEXT NOT NULL,
  phone                TEXT,
  cv_filename          TEXT NOT NULL,
  cv_mime_type         TEXT NOT NULL CHECK (cv_mime_type IN ('application/pdf','image/jpeg','image/png')),
  cv_content           BLOB NOT NULL,
  reference_code       TEXT NOT NULL UNIQUE,
  stage                TEXT NOT NULL DEFAULT 'APPLIED'
                          CHECK (stage IN ('APPLIED','SHORTLISTED','INTERVIEW','OFFER','HIRED','REJECTED')),
  -- F7.5: once a candidate is converted, the application is closed and immutable (US-38).
  converted_employee_id TEXT REFERENCES employee(id),
  applied_at           TEXT NOT NULL
);
CREATE INDEX idx_candidate_vacancy ON candidate(vacancy_id);
CREATE INDEX idx_candidate_org ON candidate(organisation_id);

-- US-36: "Every stage change is timestamped and attributed... moving backwards requires a
-- reason." An immutable log, not just a status column, so the history is reconstructable.
CREATE TABLE candidate_stage_event (
  id            TEXT PRIMARY KEY,
  candidate_id  TEXT NOT NULL REFERENCES candidate(id),
  from_stage    TEXT,
  to_stage      TEXT NOT NULL,
  reason        TEXT,
  actor_user_id TEXT NOT NULL REFERENCES app_user(id),
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_stage_event_candidate ON candidate_stage_event(candidate_id);

-- US-37: interview date, panel comments and score, only valid for a candidate at Interview.
CREATE TABLE candidate_evaluation (
  id              TEXT PRIMARY KEY,
  candidate_id    TEXT NOT NULL REFERENCES candidate(id),
  interview_date  TEXT NOT NULL,
  comments        TEXT NOT NULL,
  score           REAL NOT NULL CHECK (score >= 1 AND score <= 5),
  recorded_by     TEXT NOT NULL REFERENCES app_user(id),
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_evaluation_candidate ON candidate_evaluation(candidate_id);
