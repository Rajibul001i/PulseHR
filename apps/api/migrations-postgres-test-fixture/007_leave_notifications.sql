-- Migration 007 — in-app leave notifications (F4.4 / US-21, US-22). PostgreSQL dialect;
-- see migrations/007_leave_notifications.sql.

ALTER TABLE leave_request ADD COLUMN decision_reason TEXT;

CREATE TABLE notification (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  user_id         TEXT NOT NULL REFERENCES app_user(id),
  type            TEXT NOT NULL CHECK (type IN ('LEAVE_PENDING', 'LEAVE_DECIDED')),
  message         TEXT NOT NULL,
  entity_type     TEXT,
  entity_id       TEXT,
  read_at         TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_notification_user ON notification(user_id, read_at);
