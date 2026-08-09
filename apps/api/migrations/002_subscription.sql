-- Migration 002 — subscription & plan awareness.
--
-- PulseHR is sold as tiered B2B SaaS (Starter / Growth / Enterprise), but nothing in the
-- system knew which plan a tenant was on. Bug hunt SQA-2026-08-10 findings BUG-16/BUG-17:
-- a GROWTH tenant could read the full Enterprise attrition module, and no code anywhere
-- referenced a plan. For a subscription product that is the core of the product, not a
-- detail — so it is built before any further feature work.
--
-- Forward-only (ADR-007).

ALTER TABLE organisation ADD COLUMN plan_status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE organisation ADD COLUMN trial_ends_on TEXT;
ALTER TABLE organisation ADD COLUMN seat_limit INTEGER NOT NULL DEFAULT 50;
ALTER TABLE organisation ADD COLUMN billing_email TEXT;
ALTER TABLE organisation ADD COLUMN renews_on TEXT;

-- BUG-07 / class diagram: Department.officeStartTime. Lateness was hard-coded at 09:00
-- for every department in every tenant.
ALTER TABLE department ADD COLUMN office_start_time TEXT NOT NULL DEFAULT '09:00';

-- An append-only record of plan changes. Billing disputes need the same auditability as
-- payroll: "when did we move to Growth, and who authorised it?"
CREATE TABLE subscription_event (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  event_type      TEXT NOT NULL
                    CHECK (event_type IN ('TRIAL_STARTED','SUBSCRIBED','UPGRADED',
                                          'DOWNGRADED','RENEWED','PAST_DUE','CANCELLED')),
  from_tier       TEXT,
  to_tier         TEXT,
  effective_on    TEXT NOT NULL,
  actor_user_id   TEXT,
  note            TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_sub_event_org ON subscription_event(organisation_id, created_at DESC);

-- Records every time a user hits a feature their plan does not include. This is the
-- upgrade funnel: without it there is no evidence for which gate actually drives revenue.
CREATE TABLE feature_gate_hit (
  id              TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation(id),
  user_id         TEXT,
  feature_key     TEXT NOT NULL,
  current_tier    TEXT NOT NULL,
  required_tier   TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_gate_hit ON feature_gate_hit(organisation_id, feature_key);

UPDATE organisation SET seat_limit = 50   WHERE tier = 'STARTER';
UPDATE organisation SET seat_limit = 300  WHERE tier = 'GROWTH';
UPDATE organisation SET seat_limit = 5000 WHERE tier = 'ENTERPRISE';
