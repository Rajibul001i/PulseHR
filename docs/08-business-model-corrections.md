# Business Model — Corrected

**Resolves:** P1-6, P1-7, P1-8, P1-9, P1-10, P1-11, P1-12

---

## 1. The arithmetic problems

| # | Where | Problem |
|---|---|---|
| P1-6 | Slide 6 vs 14 | Starter tier **BDT 25,000/mo** against stated hosting of **BDT 20,000–25,000/mo** → gross margin **0% or negative** |
| P1-7 | Slide 13 vs 14 | Hosting quoted as **6,000–12,000** and **20,000–25,000** in the same deck |
| P1-8 | Slide 3 vs 14 | **1–3× annual salary** and **BDT 3–6 lakh** describe different employees |
| P1-9 | Slide 13 | Contingency labelled **~13%**; 80,000 ÷ 9,00,000 = **8.9%** |
| P1-10 | §3b vs slide 13 | *"very little upfront investment"* vs a **BDT 9,00,000** budget |
| P1-11 | Slide 6 | The AI module — the entire differentiator — is gated to the tier the target market isn't in |
| P1-12 | §6.5 | AMC charged **on top of** a SaaS subscription; 99.9% uptime promised on non-HA infrastructure |

## 2. The category error underneath P1-6

Both documents quote hosting as a **per-month cost** and compare it to a **per-customer
price**. In multi-tenant SaaS those are different things. Hosting is a **shared platform
cost amortised across all tenants**; what varies per customer is storage, egress and support
hours.

Quoting them as if each customer carried the full platform bill makes the unit economics
meaningless — it understates margin at scale and hides the real break-even.

## 3. Corrected cost structure

### Platform cost — fixed, shared across all tenants

| Item | Monthly (BDT) | Notes |
|---|---|---|
| Vercel (frontend) | 2,500 | Pro tier |
| Render (API + worker) | 4,000 | Two services, autoscaling |
| AWS RDS PostgreSQL | 6,500 | `db.t4g.small`, single-AZ at MVP |
| Backups, monitoring, logs | 2,000 | |
| Domain, email, TLS | 1,000 | |
| **Platform total** | **16,000** | Serves *all* tenants |

Multi-AZ RDS — required for the 99.9% SLA (§5) — adds roughly **6,500/mo**, taking the
platform to ~22,500.

### Marginal cost per tenant

| Item | Per tenant/month (BDT) |
|---|---|
| Storage + egress | 150–600, scaling with headcount |
| Support labour | 800 (Starter) → 4,000 (Enterprise) |
| **Marginal total** | **~1,000 (Starter) → ~4,600 (Enterprise)** |

## 4. Corrected pricing and margin

| Tier | Price/mo | Headcount | Marginal cost | **Contribution** | **Margin** |
|---|---|---|---|---|---|
| **Starter** | 25,000 | ≤ 50 | ~1,000 | **24,000** | **96%** |
| **Growth** | 50,000 | ≤ 300 | ~2,200 | **47,800** | **96%** |
| **Enterprise** | 90,000+ | 300+ | ~4,600 | **85,400+** | **95%** |

**Break-even:** platform cost 16,000 ÷ 24,000 contribution = **0.67 customers**.

**One Starter customer covers the entire platform.** That is the number the deck should
show — and it is a far stronger slide than the current one, which appears to price the
entry tier at cost.

> The original error came from comparing a per-customer price to a whole-platform cost. Once
> the two are separated, the business model is genuinely good.

## 5. Corrections to specific slides

### Slide 6 — tier structure (fixes P1-11)

Move a **limited** attrition module down into Growth. The AI is the product's entire thesis;
gating it to Enterprise leaves the actual target market — *"mid-sized companies running HR on
spreadsheets"* — buying a commodity HRIS on price.

| Tier | Price | Attrition module |
|---|---|---|
| Starter | 25,000 | ✗ |
| **Growth** | 50,000 | **Top-5 at-risk employees, refreshed monthly** |
| Enterprise | 90,000+ | Full nightly scoring, configurable weights, history, API access |

This is also a better funnel: Growth customers see the feature work, then upgrade for depth.

### Slide 13 — split notional cost from cash outlay (fixes P1-9, P1-10)

The current slide reads as though BDT 9,00,000 will be spent. It won't. Split it:

**A · Notional project cost** — effort at market rate, for the academic costing exercise

| Category | Basis | BDT |
|---|---|---|
| Human resource | 5 members × 8 weeks | 6,00,000 |
| Hardware | Dev workstations (already owned) | 1,00,000 |
| Third-party security audit & QA tooling | Pen-test, tooling | 70,000 |
| Cloud & licensing | Dev + launch phase | 50,000 |
| Contingency | **~13% of 8,20,000** | **1,07,000** ← was 80,000, mislabelled |
| **Total notional** | | **9,27,000** |

**B · Actual cash outlay during the academic build**

| Item | BDT |
|---|---|
| Hosting (free/dev tiers) | 0 |
| Domain | 1,200 |
| Figma, misc tooling | 3,000 |
| **Total cash** | **~4,200** |

Both numbers are now true, and the slide demonstrates you understand the difference between
**cost** and **expenditure** — which is itself worth marks.

*(If you prefer to keep the 9,00,000 headline, set contingency to 80,000 and label it
**~9%**. Either is fine; the current combination is not.)*

### Slide 3 / 14 — one basis for replacement cost (fixes P1-8)

Replace both figures with a single worked calculation:

> A mid-level engineer in Dhaka at **BDT 80,000/month** earns **BDT 9.6 lakh/year**. At a
> conservative **0.5–1.0× replacement multiple** — recruitment fees, 3–6 months to
> productivity, lost institutional knowledge, team disruption — each voluntary exit costs
> **BDT 4.8–9.6 lakh**.
>
> PulseHR Growth costs **BDT 6 lakh/year**. Preventing **one** such exit pays for the
> platform.

Cite a source for the multiple (SHRM and Gallup both publish usable figures). The current
"1–3×" and "BDT 3–6 lakh" cannot both be true of the same employee.

### Slide 14 / §3b — one hosting figure (fixes P1-7)

Use a **staged** figure, not a single number:

> Platform cost is **~BDT 16,000/month** at launch, rising to **~BDT 45,000/month** at 50
> tenants. Shared across all customers, not billed per customer.

### §6.5 — AMC and uptime (fixes P1-12)

Replace the AMC paragraph with:

> **Support model.** Maintenance, security patching and feature updates are included in the
> SaaS subscription — charging a separate AMC on top would be billing twice for the same
> service. A traditional AMC at 15–20% of build cost applies **only to on-premise
> deployments**, which are a separately priced product.
>
> **Service levels.** The MVP architecture (single Render service, single-AZ RDS) supports a
> **99.5%** availability commitment. **99.9%** — 43 minutes of downtime per month — requires
> Multi-AZ RDS and a standby API region, available on an Enterprise plan that funds the
> additional ~BDT 6,500/month.
>
> **Recovery.** Point-in-time recovery is enabled, giving an **RPO of ~5 minutes** and a
> target **RTO of 1 hour**. *(The current text says "daily point-in-time recovery snapshots",
> which conflates two things: daily snapshots give a 24-hour RPO; PITR gives ~5 minutes.
> Pick one and price it.)*

## 6. Sanity check on the market claim

The proposal targets *"mid-sized companies in Bangladesh"*. At BDT 6 lakh/year for Growth,
the addressable customer must have 100+ employees for the maths to feel proportionate to a
Bangladeshi SME buyer. **Say who the customer is not**: a 20-person firm will not pay
BDT 3 lakh/year for HR software, and pretending otherwise weakens an otherwise credible
business case.

Suggested framing: *"Our beachhead is 100–500 employee IT and financial-services firms in
Dhaka — large enough for turnover to be measurably expensive, small enough to lack an
enterprise HRIS."* That is a defensible segment, and it matches the pricing.
