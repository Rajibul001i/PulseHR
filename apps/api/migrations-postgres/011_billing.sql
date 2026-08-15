-- Self-service plan change + simulated invoicing. PostgreSQL dialect; see
-- migrations/011_billing.sql.

CREATE TABLE invoice (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  tier            TEXT NOT NULL,
  amount_paisa    INTEGER NOT NULL,
  description     TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('PAID', 'CREDITED')),
  issued_at       TEXT NOT NULL
);
CREATE INDEX idx_invoice_org ON invoice(organisation_id, issued_at DESC);
