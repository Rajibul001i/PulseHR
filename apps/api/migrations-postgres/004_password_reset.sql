-- Migration 004 — password reset tokens (F1.4 / US-05). PostgreSQL dialect; see
-- migrations/004_password_reset.sql.

CREATE TABLE password_reset_token (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES app_user(id),
  token_hash  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_password_reset_user ON password_reset_token(user_id);
