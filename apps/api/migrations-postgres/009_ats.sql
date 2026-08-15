-- F7 Recruitment — Applicant Tracking System — US-34..US-38. PostgreSQL dialect; see
-- migrations/009_ats.sql.

CREATE TABLE vacancy (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  title           TEXT NOT NULL,
  requirements    TEXT NOT NULL,
  deadline        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('PUBLISHED','CLOSED')),
  created_by      TEXT NOT NULL REFERENCES app_user(id),
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_vacancy_org ON vacancy(organisation_id);

CREATE TABLE candidate (
  id                   TEXT PRIMARY KEY,
  organisation_id      TEXT NOT NULL REFERENCES organisation(id),
  vacancy_id           TEXT NOT NULL REFERENCES vacancy(id),
  full_name            TEXT NOT NULL,
  email                TEXT NOT NULL,
  phone                TEXT,
  cv_filename          TEXT NOT NULL,
  cv_mime_type         TEXT NOT NULL CHECK (cv_mime_type IN ('application/pdf','image/jpeg','image/png')),
  cv_content           BYTEA NOT NULL,
  reference_code       TEXT NOT NULL UNIQUE,
  stage                TEXT NOT NULL DEFAULT 'APPLIED'
                          CHECK (stage IN ('APPLIED','SHORTLISTED','INTERVIEW','OFFER','HIRED','REJECTED')),
  converted_employee_id TEXT REFERENCES employee(id),
  applied_at           TEXT NOT NULL
);
CREATE INDEX idx_candidate_vacancy ON candidate(vacancy_id);
CREATE INDEX idx_candidate_org ON candidate(organisation_id);

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

CREATE TABLE candidate_evaluation (
  id              TEXT PRIMARY KEY,
  candidate_id    TEXT NOT NULL REFERENCES candidate(id),
  interview_date  TEXT NOT NULL,
  comments        TEXT NOT NULL,
  score           DOUBLE PRECISION NOT NULL CHECK (score >= 1 AND score <= 5),
  recorded_by     TEXT NOT NULL REFERENCES app_user(id),
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_evaluation_candidate ON candidate_evaluation(candidate_id);
