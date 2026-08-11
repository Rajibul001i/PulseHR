-- Migration 006 — employee documents (F2.5 / US-12).
--
-- "As an HR Administrator, I want to attach appointment letters, NID copies and
-- certificates to a profile, so that verification documents live with the record instead
-- of in a physical file cabinet."
--
-- Content stored as a BLOB in SQLite rather than on the filesystem: this prototype's
-- deployment (Render free tier) already treats the SQLite file itself as ephemeral,
-- reseeded on every restart (ADR-009), so a separate uploads/ directory would carry the
-- exact same durability caveat while adding a second thing to keep track of. A production
-- build on PostgreSQL would move this to real object storage (S3-compatible) and store a
-- reference here instead of the bytes.

CREATE TABLE employee_document (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  employee_id     TEXT NOT NULL REFERENCES employee(id),
  category        TEXT NOT NULL CHECK (category IN ('APPOINTMENT_LETTER', 'NID_COPY', 'CERTIFICATE', 'OTHER')),
  filename        TEXT NOT NULL,
  mime_type       TEXT NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes      INTEGER NOT NULL,
  content         BLOB NOT NULL,
  uploaded_by     TEXT NOT NULL REFERENCES app_user(id),
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_employee_document_employee ON employee_document(employee_id);
