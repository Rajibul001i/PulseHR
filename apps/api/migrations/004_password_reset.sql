-- Migration 004 — password reset tokens (F1.4 / US-05).
--
-- Closes Increment 1: F1.4 was the one function in that increment not yet delivered
-- (see docs/13-sqa-defect-report.md §4, BUG-04). Same shape as `session` (migration 001)
-- and the same reasoning: store the token HASHED, never plaintext — a DB leak must not
-- hand over the ability to take over every account.

CREATE TABLE password_reset_token (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES app_user(id),
  token_hash  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,  -- US-05: "expires 30 minutes after it is issued"
  used_at     TEXT,           -- US-05: "a link that has been used once cannot be used again"
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_password_reset_user ON password_reset_token(user_id);
