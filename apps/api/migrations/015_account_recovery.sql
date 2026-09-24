-- Migration 015 — self-service password recovery by employee ID, NID and phone OTP.
--
-- The reset link by email (migration 004) needs a mailbox the employee can reach; many
-- factory and field staff don't have one. This flow proves identity in three steps instead:
-- the employee ID, the last 4 digits of the National ID on file, and a one-time code sent
-- by SMS to the phone on file. Only then is a normal reset token (migration 004) issued.
--
-- The recovery token and the OTP are stored HASHED, like sessions and reset tokens. Each
-- step allows 5 wrong tries, a recovery expires after 15 minutes, and an employee can start
-- at most 5 recoveries an hour, so the 4 NID digits cannot be brute-forced.

CREATE TABLE account_recovery (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  user_id         TEXT NOT NULL REFERENCES app_user(id),
  token_hash      TEXT NOT NULL,
  stage           TEXT NOT NULL CHECK (stage IN ('NID','OTP','DONE','LOCKED')),
  nid_attempts    INTEGER NOT NULL DEFAULT 0,
  otp_hash        TEXT,
  otp_expires_at  TEXT,
  otp_attempts    INTEGER NOT NULL DEFAULT 0,
  otp_sends       INTEGER NOT NULL DEFAULT 0,
  otp_sent_at     TEXT,
  expires_at      TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_account_recovery_token ON account_recovery(token_hash);
CREATE INDEX idx_account_recovery_user ON account_recovery(user_id, created_at);
