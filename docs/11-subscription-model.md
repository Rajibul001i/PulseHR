# Subscription & Entitlement Model

**Resolves:** BUG-16, BUG-17
**Implemented in:** `packages/core/src/subscription.ts`, `apps/api/src/entitlement.ts`,
migration `002_subscription.sql`

---

## 1. The gap

PulseHR is sold in three tiers. Before this work, **no code anywhere referenced a plan.**
The bug hunt confirmed the consequence: a GROWTH tenant read the full Enterprise attrition
module with a `200`.

For a subscription product this is not a missing feature — it is the missing commercial
boundary. Everything else in the system is HR software; this is what makes it a business.

## 2. Design

One pure function, `checkEntitlement(subscription, featureKey, today)`, in `@pulsehr/core`.
The API route guard and the UI's navigation both read from it, so they can never disagree
about what a customer has paid for. Keeping it pure (ADR-008) means trial-expiry edge cases
are unit-testable without a clock.

### Entitlement matrix

| Feature | Starter | Growth | Enterprise |
|---|:--:|:--:|:--:|
| Attendance | ✅ | ✅ | ✅ |
| Leave management | ✅ | ✅ | ✅ |
| Automated payroll | ✅ | ✅ | ✅ |
| Digital noticeboard | ✅ | ✅ | ✅ |
| Performance (OKR) | — | ✅ | ✅ |
| Recruitment (ATS) | — | ✅ | ✅ |
| **Attrition watchlist** (top 5, monthly) | — | ✅ | ✅ |
| **Full attrition intelligence** (nightly, all staff, history, weights) | — | — | ✅ |
| API access | — | — | ✅ |
| Quarterly bias audit | — | — | ✅ |
| Seat limit | 50 | 300 | 5,000 |
| Price/month | BDT 25,000 | BDT 50,000 | BDT 90,000+ |

**Note the split attrition module.** The original deck gated the whole AI capability to
Enterprise. But the AI is the product's entire differentiator, and the stated target market
— *"mid-sized firms running HR on spreadsheets"* — buys Starter and Growth. Gating the
differentiator away from the market that buys leaves a commodity HRIS competing on price.
Growth gets a limited watchlist; Enterprise gets depth. See
[`08-business-model-corrections.md`](08-business-model-corrections.md) §5.

## 3. Plan status

| Status | Behaviour |
|---|---|
| `TRIAL` | Full tier access until `trial_ends_on`; expiry is **exclusive** (a trial ending today still works) |
| `ACTIVE` | Normal |
| `PAST_DUE` | **Core HR stays readable**; paid-tier features suspended |
| `CANCELLED` | Everything blocked |

`PAST_DUE` is deliberate. Locking an HR team out of payroll over a late invoice causes more
damage than it recovers, and it is the customer's finance team — not the HR users — who
control the payment. Degrade, don't detonate.

## 4. HTTP semantics

A gated route returns **402 Payment Required**, not 403.

The distinction matters to the client: `403` means *"you will never have this"*; `402` means
*"your organisation could buy this"* — and only the second should render an upgrade prompt.
The response carries the feature, the current tier, the required tier, and the pitch, so the
UI can build the prompt without hard-coding pricing.

```jsonc
// GET /api/attrition/at-risk  as a GROWTH tenant
// 402
{
  "error": "Full attrition intelligence is included in the Enterprise plan. Nightly scoring for every employee, full history, and configurable weights.",
  "code": "TIER_TOO_LOW",
  "feature": "attrition_full",
  "currentTier": "GROWTH",
  "requiredTier": "ENTERPRISE",
  "upgrade": { "tier": "ENTERPRISE", "pitch": "Nightly scoring for every employee..." }
}
```

## 5. Seats

Warn at **90%**, refuse at **100%**. A per-seat product that only discovers it is over its
limit at renewal has already lost the revenue — and an HR team that cannot onboard a new
joiner because of a silent limit will blame the software, correctly.

## 6. The upgrade funnel

Every refusal writes to `feature_gate_hit` (organisation, user, feature, current tier,
required tier). Without it there is no evidence for **which gate actually drives upgrades**,
and the tier boundaries stay guesswork. With it, pricing becomes a data question.

`subscription_event` is an append-only log of plan changes. Billing disputes deserve the
same auditability as payroll: *"when did we move to Growth, and who authorised it?"*

## 7. Tests

16 unit tests in `packages/core/test/subscription.test.ts`, including:

- a GROWTH tenant refused `attrition_full` but allowed `attrition_watchlist`
- core HR never gated on any tier
- a trial ending **today** still valid; ending yesterday not
- `PAST_DUE` keeps payroll, suspends ATS
- an unknown feature key **refused**, not silently allowed
- seat warning fires at exactly 90%, refusal at exactly 100%, never negative remaining
- upgrade copy asserts on *value* wording and against denial wording

## 8. Not yet built

- Payment gateway integration (bKash / Nagad / card). `plan_status` is currently set by
  seed or admin action, not by a payment webhook.

**Self-service plan change, proration and invoicing shipped 13 August 2026.** HR can now
upgrade or downgrade from Plan & billing; `POST /api/subscription/change` applies it
immediately (`apps/api/src/repo.ts` `changeSubscription`, proration math in
`packages/core/src/billing.ts`, 5 unit tests). Proration is real: the unused portion of the
current plan for the rest of the calendar month is credited, the new plan is charged for the
same days, and an `invoice` row records the net amount (`PAID` for a charge, `CREDITED` for a
downgrade's credit note) alongside the existing `subscription_event` audit trail. A downgrade
that would leave more active employees than the new tier's seat limit is refused before it
applies.

**What's still simulated, not real:** there is no payment gateway, so "payment" always
succeeds — there is nothing to charge against, and nothing here claims otherwise (the UI
doesn't show a card form or any payment step). A production build would insert a real
gateway call between the proration preview and the invoice being marked `PAID`, and would
need a webhook to handle a card being declined — genuinely deferred, unlike everything else
in this section.

Verified: `scripts/bughunt.mjs` BUG-23 (6 assertions — preview, confirm, same-tier refusal,
non-HR role refusal, downgrade credit, invoice history) and a full Playwright pass: upgrade
Growth→Enterprise, confirm the proration preview and invoice, downgrade back to Growth,
confirm the credit note. These are real work, deliberately deferred until now — the
entitlement layer had to exist first, since it's what every other feature checks against.
