-- Migration 006 — employee documents (F2.5 / US-12). PostgreSQL dialect; see
-- migrations/006_employee_documents.sql.
--
-- Content stays stored as bytes in the database (BYTEA) rather than moving to S3-compatible
-- object storage. docs/03-data-model.md's production note floats object storage as a future
-- improvement, not a requirement of "add a real database" -- it would mean a brand-new
-- external service and a second upload code path, which is a materially bigger, separate
-- decision than swapping the storage engine underneath the existing one. Tracked, not done.

CREATE TABLE employee_document (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  employee_id     TEXT NOT NULL REFERENCES employee(id),
  category        TEXT NOT NULL CHECK (category IN ('APPOINTMENT_LETTER', 'NID_COPY', 'CERTIFICATE', 'OTHER')),
  filename        TEXT NOT NULL,
  mime_type       TEXT NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes      INTEGER NOT NULL,
  content         BYTEA NOT NULL,
  uploaded_by     TEXT NOT NULL REFERENCES app_user(id),
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_employee_document_employee ON employee_document(employee_id);
