-- Self-service plan change + simulated invoicing. docs/11-subscription-model.md §8 flagged
-- proration, self-service change and invoice generation as deliberately deferred; no payment
-- gateway exists for this build, so a change applies immediately and "paid" is simulated,
-- but the proration math (packages/core/src/billing.ts) and the audit trail here are real.

CREATE TABLE invoice (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  tier            TEXT NOT NULL,
  amount_paisa    INTEGER NOT NULL, -- net amount; negative = credit note (a downgrade mid-cycle)
  description     TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('PAID', 'CREDITED')),
  issued_at       TEXT NOT NULL
);
CREATE INDEX idx_invoice_org ON invoice(organisation_id, issued_at DESC);
