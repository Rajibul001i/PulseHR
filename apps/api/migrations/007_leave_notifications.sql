-- Migration 007 — in-app leave notifications (F4.4 / US-21, US-22).
--
-- US-21: "notified as soon as my leave request is approved or rejected... [rejection]
-- carrying the stated reason." leave_request.reason is already taken (it's the EMPLOYEE's
-- reason for requesting leave, set at creation) -- decision_reason is the separate,
-- optional reason a manager gives on rejection.
--
-- US-22: "notified when a request enters my queue... clears once I record a decision."
-- notification is a plain per-user inbox; entity_id ties a decision back to the pending
-- notification it should clear.

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
