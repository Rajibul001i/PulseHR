# Source Document Review — PulseHR

**Reviewer:** engineering review pass
**Date:** 2 August 2026
**Inputs reviewed:**
- `PulseHR_Proposal_(25-07-2026).docx` — 9 sections, 3 tables
- `PulseHR_Presentation_(01-08-26).pptx` — 35 slides

**Verdict:** the concept is sound and the writing is strong. The engineering is not yet
self-consistent. I found **45 defects**, of which **9 are blocking** — meaning if you build
what is currently written, you will ship something wrong or you will lose marks for
contradicting yourself in front of the instructor.

Defects are grouped by severity. Every one has a concrete fix.

---

## Severity key

| | Meaning |
|---|---|
| **P0** | Blocking. The two documents contradict each other, or the design is wrong and will produce incorrect output. Fix before submission. |
| **P1** | Serious. Unsupportable claim, missing design, or a domain/legal inaccuracy. |
| **P2** | Polish. Numbering, tense, naming, sourcing. |

---

# P0 — Blocking

## P0-1 · The two documents select **different process models**

- Proposal §5.4: *"The engineering team has adopted Pressman and Maxim's **Recommended
  Process Model** as PulseHR's governing process, executed sprint by sprint using Scrum."*
- Deck slide 10: *"**Incremental Model** — Selected."*

These are different models. The proposal explicitly ranks Incremental as
*"Insufficient alone"* (Table 2) — so the deck selects the model the proposal rejects.

**Why it matters:** this is the single question a software-engineering instructor is
guaranteed to ask. Right now the two documents give opposite answers.

**Fix:** see [`01-process-model-decision.md`](01-process-model-decision.md). It contains
drop-in replacement text for proposal §5 and slides 10–12.

---

## P0-2 · The deck contradicts **itself** on the same point

Within the one file:

- Slide 10 rejects Prototyping: *"Built for projects where requirements are fuzzy.
  **Ours aren't** — stakeholder research fixed them early."*
- Slide 28 title: *"The one part **nobody could fully spec up front**."*
- Slide 29: *"…the go/no-go review that follows — **the whole reason this process model
  was chosen over plain incremental delivery**."*

Slide 29 says the model was chosen *over* incremental. Slide 10 says incremental *was*
the choice. Both cannot stand.

**Fix:** slide 10's Prototyping card is a plain rejection (requirements *are* specified —
9 features, 43 functions, 49 user stories with acceptance criteria), and slide 29 drops the
"chosen over incremental" clause entirely. Exact wording in
[`01-process-model-decision.md`](01-process-model-decision.md), which selects a plain
Incremental lifecycle with **no stage gates** — matching the team's own Features & Functions
document and Requirements Model.

---

## P0-3 · The candidate model sets don't match

| Evaluated in Proposal §5.2 | Evaluated in Deck slide 10 |
|---|---|
| Waterfall | Waterfall |
| Prototyping | Prototyping |
| Incremental | Incremental |
| Spiral | Spiral |
| Pure Agile / Scrum | — *(absent)* |
| **Recommended Process Model** ← *proposal's winner* | — *(absent)* |
| — | V-Model |
| — | Concurrent Development |

The proposal's **winning model does not appear in the deck at all**.

**Fix:** unify on one candidate set of six. Recommended set in `01-process-model-decision.md`.

---

## P0-4 · The AI module has **no training data and no label**

- Deck slide 30: *"Each signal weighted by **historical correlation with resignations**."*
- Proposal §3b: *"…efficient statistical methods based on weighted moving averages and
  **logistic regression**."*

A fresh PulseHR install at a new customer has **zero historical resignations**. You cannot
fit a logistic regression with no labels. A 50-person survey and two HR interviews produce
**opinions**, not labelled separation events. The proposal never says where `y` comes from.

This is the largest engineering hole in the document set, and it sits underneath the
feature the entire product is sold on.

**Fix — cold-start, then earn the model:**

1. **v1 ships an expert-weighted scorecard.** Weights elicited from the HR-manager
   interviews, written down, versioned, and fully explainable. This is not a
   embarrassment — it is the honest engineering answer, and it is *auditable*, which
   logistic regression is not.
2. **Log everything from day one:** every nightly score, every feature value, every actual
   separation with a voluntary/involuntary flag.
3. **Define the promotion criterion up front.** Do not fit a model until you have
   ≥ 10 separation events per predictor (the standard events-per-variable rule of thumb).
   With 8 features that is **≥ 80 voluntary separations** — realistically 2–3 years of
   data from a 300-person customer. Say so.

That promotion criterion is the module's acceptance criterion — see ADR-001, which
selects a plain Incremental lifecycle with no stage gates.
Full spec: [`05-attrition-risk-spec.md`](05-attrition-risk-spec.md).

---

## P0-5 · The ERD has **no tenant column** — a multi-tenant SaaS that leaks data

Deck slide 26 shows four entities: `EMPLOYEE`, `ATTENDANCE`, `LEAVE_REQUEST`,
`PAYROLL_LOG`. None carries an organisation/tenant key. But slide 6 sells PulseHR as
tiered **B2B SaaS** with many customer companies on one codebase.

Without `organisation_id` on every table and a scoping rule enforced in one place,
customer A's HR manager will eventually see customer B's salaries. This is the failure
mode that ends a B2B product.

**Fix:** `organisation_id` NOT NULL on every business table, every query scoped through a
single tenant-aware repository layer, Postgres Row-Level Security as defence in depth.
Schema: [`03-data-model.md`](03-data-model.md).

---

## P0-6 · The Node.js justification is **backwards**

Proposal §6.4: *"Node.js's non-blocking, asynchronous, event-driven I/O architecture is
the main reason for choosing it. At the end of the month, an HR system needs to process
many payroll calculations at the same time. Node.js manages these parallel tasks
efficiently, while traditional synchronous servers would slow down under the same heavy
load."*

Month-end payroll is **CPU- and database-bound**, not I/O-concurrency-bound. Node.js runs
JavaScript on a **single thread**. A payroll run over 10,000 employees executed inside the
API process will block the event loop and make the entire application unresponsive for the
duration — the exact opposite of the claim.

This is a load-bearing technical justification in the document and it is wrong. An
instructor who knows Node will catch it.

**Fix — two parts:**

- **Rewrite the justification.** Node's real merits here: one language across frontend and
  backend for a five-person team, the largest package ecosystem, excellent I/O concurrency
  for the *interactive* API (many small dashboard requests), and fast iteration inside an
  8-week window. Say that instead.
- **Fix the design.** Payroll runs and the nightly attrition batch execute in a
  **separate worker process** driven by a job queue, never in the request path. This is
  ADR-004 in [`02-architecture.md`](02-architecture.md), and the prototype implements it.

---

## P0-7 · Leave balance stored as mutable state → will drift, and has a race condition

Proposal §6.5 and slide 25 both treat leave balance as a value that gets *updated*.

Two concurrent approvals of overlapping requests, or one employee submitting two requests
that each individually fit the balance but together do not, will corrupt the balance. The
proposal chose PostgreSQL **specifically for ACID** (§6.4) and then never uses it:
concurrency control is not mentioned once in either document.

**Fix:**

- Balance is **derived, never stored**: an append-only `leave_ledger` of accruals and
  consumptions. `balance = SUM(delta)`. This also gives you the audit trail §4b demands.
- Approval runs in a transaction that takes `SELECT … FOR UPDATE` on the employee's ledger
  rows before re-checking the balance.
- Overlapping-date-range protection via a Postgres exclusion constraint
  (`EXCLUDE USING gist (employee_id WITH =, daterange(start_date, end_date, '[]') WITH &&)`).

The prototype implements all three, and the test suite includes the double-submit case.

---

## P0-8 · Payroll stores only `net_pay` — unauditable

Slide 26: `PAYROLL_LOG(payroll_id, employee_id, period, net_pay, generated_at)`.

Your own headline objective (§4b) is *"a reliable and **fully auditable** data pipeline"*.
A single `net_pay` figure cannot be audited, disputed, or reproduced. When an employee
says "my salary is short this month", you have nothing to show them.

**Fix:** payslips are **immutable and line-itemised**. Store the salary-structure version
in force, every earning and deduction as its own row, LWP day count, OT hours and the rate
applied, tax basis, and the **engine version string** that produced the number. A payslip
is never updated — corrections are issued as a new adjustment payslip. DDL in
[`03-data-model.md`](03-data-model.md).

---

## P0-9 · Business dates computed without a timezone → corrupts attendance *and* payroll

Neither document mentions timezones. Bangladesh is **UTC+6** with no DST. If the API runs
on Render in a US or EU region and the code calls `new Date()` to get "today", a
**22:30 Dhaka check-in records against the next day**.

That single bug silently corrupts the attendance grid, the late-arrival signal feeding the
attrition model, and LWP day counts in payroll. It is invisible in local testing (your
laptop is already in Asia/Dhaka) and appears only in production.

**Fix:** all timestamps stored as `timestamptz`; the *business date* is always derived by
explicit conversion to `Asia/Dhaka`; a single `businessDate()` helper is the only place
this conversion is allowed. Enforced in the prototype's core package with tests.

**Related, also missing:** the working week. Bangladesh's standard weekend is **Friday**
(plus Saturday in most corporates). Any engine defaulting to Sat/Sun is wrong. Add a
configurable `work_week` and an 11-day statutory `holiday_calendar` per §118.

---

# P1 — Serious

## Legal & domain accuracy

### P1-1 · Earned leave is stated as a flat 21 days — it is an **accrual**

Proposal §3b: *"statutory earned leaves (**21 days per year** for eligible employees)"*.

The Bangladesh Labour Act 2006 **§117** grants annual leave with wages at **one day for
every 18 days worked** for adult workers in shops, commercial and industrial
establishments — roughly 20 days across a full year, and *proportionally less for anyone
who joined mid-year or had unpaid absence*. (The 1-in-15 rate applies to tea plantation
and newspaper workers.)

Hard-coding 21 is wrong. Hard-coding *any* flat number is wrong. It must accrue.

**Also entirely missing from both documents:**

| Entitlement | Act reference | Value |
|---|---|---|
| Casual leave | §115 | 10 days/year, non-carry-forward |
| Sick leave | §116 | 14 days/year on full wages |
| Festival holidays | §118 | 11 days/year |
| Maternity leave | §46 | 16 weeks (8 before + 8 after delivery) |

A payroll engine claiming Labour Act compliance while modelling only "earned and sick" is
incomplete. Full rules and formulas: [`04-payroll-spec.md`](04-payroll-spec.md).

> Verify every figure above against the current consolidated text of the Act and any
> amendments before submission — cite the section numbers in the proposal. I have written
> the engine so these values are **configuration, not code**.

### P1-2 · Overtime base is ambiguous — and the likely reading overpays

Proposal §3b: *"overtime pay rates (at **twice the standard hourly rate**)"*.

§108 sets overtime at **twice the ordinary rate of *basic* wage** (plus dearness/ad-hoc
allowance where applicable) — **not** twice the *gross* hourly rate. If the engine computes
`gross / 208 × 2`, it overpays every overtime hour, on every payslip, forever.

**Fix:** define the OT base explicitly and put it in the spec:
`ot_hourly = (basic + dearness) / standard_monthly_hours`, `ot_pay = ot_hourly × 2 × hours`.
Also encode §100/§102: 8 h/day and 48 h/week ordinary, 60 h/week ceiling.

### P1-3 · "NBR income tax slabs" claimed but never specified

Tax slabs change with **every Finance Act**. Hard-coding them guarantees the system is
wrong within twelve months. Also missing: the investment rebate — a TDS calculation without
it over-deducts from every employee who invests.

**Fix:** tax slabs are **effective-dated reference data**, keyed by fiscal year, loaded from
a table, never compiled into the engine. Scope note: **TDS is out of scope for the 8-week
MVP** — say so explicitly rather than claiming compliance you have not built.

### P1-4 · "Regulatory compliance" names no regulation

Proposal §3b claims *"data privacy, cybersecurity, and **regulatory compliance**"*.
Bangladesh has **no enacted comprehensive data-protection statute** — the Personal Data
Protection Ordinance has been in draft and consultation, not in force. Claiming compliance
with an unnamed regulation is an empty claim, and an easy one to be challenged on.

**Fix:** state what you actually do — AES-256 at rest, TLS 1.3 in transit, role-based
access control, audit logging, retention limits — and say you are *designing toward* the
draft PDP Ordinance and GDPR principles so the system is ready when it lands. Name them.

**Additionally:** do not store raw National ID numbers. Store a salted hash plus the last
four digits unless you can document a specific statutory need for the full number. The
proposal currently commits you to holding the most sensitive identifier in the country
for every employee of every customer.

### P1-5 · **No ethical guardrails on the attrition score** — the most serious omission

Neither document contains a single line about:

- whether employees are **told** they are being scored
- whether a manager may use the score in a **termination, promotion or pay** decision
- an **appeal** or correction path
- **who can see** a score (line manager? HR only?)
- **bias auditing** across gender, department, age, or tenure

An HRIS that silently flags employees as "likely to quit" and shows it to their manager
produces two predictable harms: **retaliation** (the flagged employee is quietly sidelined)
and a **self-fulfilling prophecy** (being treated as a flight risk causes the exit).

There is also a direct internal contradiction. Proposal §3a says existing performance
reviews are corrupted by *"favoritism or bias"*, and §4b promises to *"remove human bias…
from performance review scores"*. Slide 30 then feeds **review-score dips** into the risk
model. You would be laundering the bias you set out to eliminate into an algorithmic output
that *looks* objective.

**Fix — a Responsible Use section in the proposal, and enforcement in code:**

- Scores are visible to **HR role only**, never to the line manager, in v1.
- The score is **advisory for retention outreach only**. Using it as an input to
  termination, promotion, appraisal or pay is a documented prohibited use.
- Every score view is written to the **audit log**.
- Employees are **notified** that behavioural analytics run, and can request their own score
  and its contributing factors.
- Every score carries its **feature contributions** — never a bare number.
- Quarterly **bias audit**: score distribution compared across gender, department and tenure
  band; a material gap triggers re-weighting.
- **Drop `review_score_delta` from the v1 feature set** until reviews are demonstrably
  de-biased. It is the one input you have already documented as untrustworthy.

This section will earn you more marks than any other change in this review. It is also the
right thing to do.

## Business model & arithmetic

### P1-6 · The Starter tier is priced at or below cost

Slide 6: Starter = **BDT 25,000/month**. Slide 14 and proposal §3b: hosting =
**BDT 20,000–25,000/month**. Gross margin on your entry tier is therefore **0% to
negative**, before any support labour.

There is also a category error underneath it: in multi-tenant SaaS, hosting is a **shared
platform cost**, not a per-customer cost. Quoting a per-month hosting figure as if each
customer carried it makes the unit economics meaningless in both directions.

**Fix:** separate **platform cost** (fixed, amortised across all tenants) from **marginal
cost per tenant** (storage, egress, support hours). Corrected model with a break-even
table: [`08-business-model-corrections.md`](08-business-model-corrections.md).

### P1-7 · Hosting cost appears **twice in the same deck with different numbers**

- Slide 13 footnote: *"Ongoing hosting after launch (**BDT 6,000–12,000/month**)"*
- Slide 14 Economical: *"Hosting of roughly **BDT 20,000–25,000/month**"*

A 2× discrepancy on the number that determines gross margin, on adjacent slides.

**Fix:** pick one and use it everywhere. The realistic figure for the stated architecture
(Vercel Pro + Render + small RDS instance) is the **lower** band early on, rising with
scale — so use a staged figure, not a single number.

### P1-8 · The turnover-cost figures are **numerically inconsistent with each other**

- Slide 3 / §1: replacement costs **1–3× annual salary**
- Slide 14 / §3b: replacement costs **BDT 3–6 lakh**

For these to agree, the target employee's annual salary would be **BDT 1–6 lakh** —
i.e. **BDT 8,000–50,000 per month**. But §3b describes the employee as *"a mid-level
software engineer or project manager"*, who in Dhaka earns far more than that. The two
framings describe different people.

**Fix:** state one basis, show the arithmetic, cite a source. E.g. *"a mid-level engineer
at BDT 80,000/month = BDT 9.6 lakh/year; at a conservative 0.5–1× replacement multiple,
BDT 4.8–9.6 lakh per exit."* Then the number defends itself.

### P1-9 · Contingency is labelled ~13% but is 8.9%

Slide 13: contingency **BDT 80,000** against a **BDT 9,00,000** total, described as
*"~13% buffer"*.

80,000 ÷ 9,00,000 = **8.9%**. Against the pre-contingency base of 8,20,000 it is **9.8%**.
Neither is 13%.

**Fix:** either correct the label to ~9%, or raise contingency to BDT 1,20,000 for a true
~13%. An arithmetic error on the budget slide is the kind of thing that gets noticed.

### P1-10 · Budget contradicts the "very little upfront investment" claim

Proposal §3b: *"Developing PulseHR needs **very little upfront investment**."*
Slide 13: total project budget **BDT 9,00,000**.

Both can be true — 6,00,000 of that is **notional** team effort costed at market rate, not
cash leaving anyone's account — but **neither document says so**, so as written they simply
contradict.

**Fix:** split slide 13 into **Notional cost** (effort at market rate, BDT 6,00,000) and
**Actual cash outlay** (hosting, tooling — realistically under BDT 15,000 during the
academic build on free tiers). This is also a much stronger slide: it shows you understand
the difference between cost and expenditure.

### P1-11 · The AI module is Enterprise-only — you have gated your entire thesis

Slide 6 puts the AI Attrition Risk Module behind the **Enterprise** tier (300+ employees,
custom pricing). But your stated target market is *"mid-sized RMG, IT, and financial-services
companies currently running HR on spreadsheets"* — Starter and Growth. Those customers get
a commodity HRIS and compete with you on price alone.

**Fix:** put a **limited** attrition module in Growth (top-5 at-risk employees, monthly
refresh) and reserve full scoring, configurable weights, history and API access for
Enterprise. You sell the differentiator to the market that actually buys.

### P1-12 · AMC is double-charging, and 99.9% uptime is unsupportable

Proposal §6.5 sells an **Annual Maintenance Contract at 15–20% of development cost**
covering *"99.9% server uptime"*, alongside a monthly SaaS subscription.

Two problems:

1. **AMC is a licence-model artifact.** In SaaS, maintenance and patching are already
   inside the subscription. Charging both is charging twice for the same thing, and
   sophisticated buyers will say so.
2. **99.9% uptime = 43 minutes of downtime per month.** The stated architecture is Render
   plus a *single* AWS RDS instance. No multi-AZ, no failover, no read replica. You cannot
   contract for 99.9% on it. Additionally, *"daily point-in-time recovery snapshots"*
   conflates two different things — daily snapshots give an RPO of up to **24 hours**;
   PITR gives roughly **5 minutes**. Pick one and price it.

**Fix:** drop AMC for SaaS customers (keep it only for on-premise deployments, which are a
different product). Offer **99.5%** on the current architecture, with 99.9% available on an
Enterprise plan that funds Multi-AZ RDS. Enable true PITR and say PITR, or say daily
snapshots and quote a 24-hour RPO.

## Engineering design

### P1-13 · No definition of the target variable

"Attrition risk" is meaningless without a horizon and a scope. Is it voluntary resignation
only, or all separations? Within 30 days, 90, a year?

**Fix:** `P(voluntary separation within 90 days)`. Written into the spec, exposed in the UI
tooltip. Involuntary separations are excluded from the label and from the training set.

### P1-14 · No evaluation metric

*"Reduce voluntary turnover by 15% within a year"* (§4b) is a business outcome, not a model
metric, and it **cannot be measured within the 8-week project**. You will be asked how you
know the model works.

**Fix:** **precision@k** — of the top 10 employees the model flags, how many actually leave
within 90 days. It is the only metric that matters when HR can realistically hold ten
retention conversations a month. Report it against the base rate, and against a trivial
baseline (*"flag everyone at 11–13 months' tenure"*). If you cannot beat that baseline, the
model has no value — and saying so is exactly what the acceptance criterion is for.

### P1-15 · Class imbalance is not addressed

Annual voluntary turnover of 10–15% is a **~3% base rate per 90-day window**. A model that
predicts "nobody leaves" scores **97% accuracy**. If accuracy appears anywhere in your SQA
report, it will be read as not understanding the problem.

**Fix:** never report accuracy. Report precision@k, recall at the operating threshold, and
the base rate alongside.

### P1-16 · Two of the four input signals are perverse

| Signal | Problem |
|---|---|
| *Clusters of short leaves* | Penalises employees who are genuinely ill or caring for family. Systematically disadvantages parents and people with chronic conditions. |
| *Drops in review scores* | Reviews are, by §3a, the artifact most corrupted by favouritism. See **P1-5**. |
| *More late check-ins* | Confounded by commute, traffic, shift changes. Weak but usable if normalised against the employee's own department. |
| *Tenure milestones* | **Strong and defensible.** Keep — it is your best signal. |

**Fix:** v1 feature set drops `review_score_delta`, replaces raw leave-clustering with
**unplanned single-day absences adjacent to a weekend** (a behavioural pattern, not a health
proxy), and normalises lateness within department. Full set in
[`05-attrition-risk-spec.md`](05-attrition-risk-spec.md).

### P1-17 · Score range is 0–1 in the proposal and 0–100 in the deck

Proposal §6.5: *"an employee with a risk score of **1.0**"*. Slide 30: *"**Risk Score
(0–100)**"*.

Trivial to fix, and exactly the kind of mismatch that produces a real threshold-comparison
bug when two people implement against two documents.

**Fix:** **0–100 integer** everywhere. The core package exposes one type and one clamp.

### P1-18 · The ERD is missing ~20 entities the product requires

Four entities are shown. The six advertised modules need roughly twenty-four. Missing:
`organisation`, `department`, `user` *(a login is not an employee)*, `role`, `permission`,
`leave_type`, `leave_ledger`, `salary_structure` *(effective-dated — payroll needs salary
**history**, not a current value)*, `payslip_line`, `okr_objective`, `okr_key_result`,
`review_cycle`, `review_score`, `job_requisition`, `candidate`, `application`,
`application_stage_event`, `notice`, `notice_receipt`, `attrition_score`,
`attrition_feature_contribution`, `audit_log`, `holiday_calendar`, `work_schedule`.

**Fix:** complete ERD and production DDL in [`03-data-model.md`](03-data-model.md).

### P1-19 · JWT with no revocation — cannot cut off a terminated employee

*"Secure JWT-based user authentication"* (§6.2). A stateless JWT **cannot be revoked**
before it expires. For an HRIS this is disqualifying: when an employee is terminated, their
access must stop **immediately**, not in an hour.

**Fix:** short-lived access token (15 min) + server-side **refresh session row** that can be
revoked instantly. Termination revokes all sessions for that user. Implemented in the
prototype.

### P1-20 · No database migration strategy

Four increments, each changing the schema, with no migration tool named anywhere in either
document. This is guaranteed to break the shared demo environment in Increment 3, at the
worst possible moment.

**Fix:** numbered, forward-only SQL migrations checked into the repo from day one,
applied by a runner on boot. The prototype ships this pattern.

### P1-21 · No CI — "mandatory code review" is a policy, not a gate

§6.4 requires code-review approval before merge. Nothing runs the tests. A reviewer
approving code that does not compile is a normal Friday.

**Fix:** GitHub Actions on every PR — typecheck, lint, unit tests, build. Branch protection
requires it green. Provided in the prototype at `.github/workflows/ci.yml`.

### P1-22 · "Under 50ms worldwide" is not a claim the architecture supports

§6.5: *"deployed on Vercel's global edge CDN, which keeps load times under 50ms worldwide."*

A CDN serves **static assets** quickly. It does nothing for the **API round-trip**, which is
what a data-dense dashboard actually waits on. With the API on Render and users in Dhaka,
expect **80–250 ms per API call** regardless of the CDN. The metric is also undefined — TTFB,
LCP and API p95 are three different numbers.

**Fix:** state a real budget: *"static assets TTFB < 100 ms via CDN; API p95 < 300 ms for
dashboard reads; first contentful paint < 1.5 s on 4G."* Measurable, defensible, and it
shows you know which number matters.

### P1-23 · "Stress test with 10,000 dummy records" is not a stress test

§6.2 Sprint 4. 10,000 rows is a small table; PostgreSQL will not notice it.

The dimension that actually hurts is **attendance rows**: 500 employees × 2 punches ×
250 working days ≈ **250,000 rows per year**, and the monthly attendance grid is the hot
path. Payroll for 500 employees is 500 × 12 payslips × ~8 line items ≈ **48,000 rows/year**.

**Fix:** seed **three years** of attendance for 500 employees (~750k rows), then measure the
monthly grid query, the payroll run, and the nightly scoring batch. State p95 targets. The
prototype's seeder is parameterised for exactly this.

### P1-24 · Missing non-functional requirements

Neither document states a single measurable NFR. No concurrent-user target, no data
retention period, no backup RTO/RPO, no accessibility standard, no browser support matrix,
no localisation decision (Bangla UI? Bangla payslips?), no audit-log retention.

**Fix:** NFR table in [`02-architecture.md`](02-architecture.md).

---

# P2 — Polish

### P2-1 · Roughly a third of the deck's slide numbers are wrong

Footer numbers in slide order:

`1, 2, –, 4, 5, 6, 7, –, 9, 10, 11, 12, 11, 12, 13, 16, –, 16, 19, 20, –, 22, 18, 19, 20, 21, –, 25, 24, –, 28, 32, 33`

- **11, 12, 16, 19 and 20 each appear twice**
- the sequence runs **22 → 18 → 19 → 20 → 21** (backwards)
- it jumps **13 → 16**
- slide 30's footer reads 24 while slide 29's reads 25 (inverted)
- slide 33 is numbered 32, slide 34 numbered 33

**Fix:** these are static text boxes, not real slide-number fields — that is why they drift.
Replace them with a proper slide-number placeholder, or run the renumbering script in
`tools/fix_deck_numbering.py` (provided).

### P2-2 · Proposal §6.2 is written in **past tense for future work**

*"**Gathered** stakeholder requirements…"*, *"We **engineered and tested** the Automated
Payroll Engine…"*, *"The ATS Kanban board **is now fully deployed**."*, *"We **ran** a full
SQA testing cycle…"*

This is a **proposal**, dated 25 July 2026, for work not yet started. It reads as though the
project is finished — and it directly contradicts §6.1 on the facing page, which is
correctly in future tense (*"The team **will visit**…"*).

**Fix:** convert all of §6.2 to future tense. Rewritten section supplied in
[`10-proposal-patches.md`](10-proposal-patches.md).

### P2-3 · A teammate's name is spelled two different ways

- Proposal Table 0 and deck slide 7: **"Md. Muradujjaman"** (ID 2023200010083)
- Proposal Appendix E: **"Md. Munadujjaman"**
- Deck slides 17, 32: **"Munadujjaman"**

It is a person's name on a graded submission. Confirm the correct spelling and make it
consistent in all six places.

### P2-4 · The methodology and the roadmap disagree about the AI prototype

Proposal §5.4 places the AI prototype and Go/No-Go *"early in Sprint 3"*. Proposal §6.2's
Sprint 3 description does not mention the AI prototype at all. Deck slide 16 has it right.

**Fix:** ADR-001 removes the gate entirely. §6.2 is rewritten around four increments in
[`10-proposal-patches.md`](10-proposal-patches.md), which resolves the disagreement.

### P2-5 · The Gantt and the increment table disagree on when AI starts

Slide 17 shows *AI Risk Engine Development* beginning around W5. Slide 12 point 3 says the
AI engine is *"deliberately the final increment"* (W7–8). Slide 29 says *"Sprint 3 prototype
through Sprint 4 evolution"*.

These reconcile — prototype in Sprint 3, hardening in Sprint 4 — but nowhere is that said.

**Fix:** relabel the Gantt bars *"AI Prototype (spike)"* W5–6 and *"AI Evolution &
Calibration"* W7–8, and add one line to slide 12.

### P2-6 · "15 main screens" is never enumerated

§6.2 Sprint 1 promises *"UI/UX wireframes for all 15 main screens"*. The 15 are never
listed, so the deliverable cannot be checked off.

**Fix:** enumerate them. A screen inventory is in [`06-api-contract.md`](06-api-contract.md)
§7, mapped to the modules.

### P2-7 · Slide 14 green-lights a feasibility study that hasn't happened yet

*"Five dimensions, all green-lit"* — but the research that would establish operational and
economic feasibility (slide 15) is described in **future tense**. A study that reaches its
conclusion before its evidence is an assertion.

**Fix:** mark Operational and Economic as *"provisional — pending field research in
Increment 1"*. Honest, and it shows methodological awareness.

### P2-8 · Same tense problem in §5.4 vs §6.1

§5.4 states the survey and interviews *"replace generic requirements-gathering with real
behavioural data"* — as accomplished fact. §6.1 describes both as future work.

### P2-9 · Six references, zero in-text citations

The bibliography is fine. But no claim in the body is cited at the point it is made — in
particular the Labour Act figures (§3b) and the 1–3× replacement-cost claim (§1), which is
presented as established fact with no source at all.

**Fix:** in-text citations at every factual claim, and a real source for the replacement-cost
figure (SHRM and Gallup both publish usable ones — cite whichever you use).

### P2-10 · The conclusion oversells and appeals to the grader

§7: *"PulseHR is **ready for commercial launch**"* — for a system that has not been built.
And: *"The development team is confident it will receive **top academic recognition from the
course instructor**."*

The second sentence is an appeal to the marker, not an engineering statement, and it reads
poorly.

**Fix:** *"PulseHR is designed for commercial viability beyond the academic scope, with a
clear path from MVP to a deployable B2B product."* Delete the second sentence.

### P2-11 · Slide 10's V-Model and Concurrent Development are unsupported by the proposal

The deck rejects two models the proposal never evaluates. If asked *"why did you reject the
V-Model?"* the proposal has no answer to fall back on.

**Fix:** unify the candidate set (P0-3), then make sure every model in the deck has a
matching paragraph in §5.2.

### P2-12 · Proposal §1 says "eight weeks in four sprints, using a prototype-driven process with Scrum" — which is a **third** process description

Distinct from §5.4's "Recommended Process Model via Scrum" and the deck's "Incremental".
Three documents' worth of process, in two documents.

---

## Summary table

| Severity | Count |
|---|---|
| **P0 — blocking** | 9 |
| **P1 — serious** | 24 |
| **P2 — polish** | 12 |
| **Total** | **45** |

## Recommended order of work

1. **Decide the process model** (P0-1/2/3) — everything else in §5 and slides 9–12 follows
   from it. `01-process-model-decision.md` has the decision and the replacement text.
2. **Fix the AI story** (P0-4, P1-13/14/15/16/17) — cold-start scorecard, target
   definition, precision@k. This is what makes the project genuinely good.
3. **Add the Responsible Use section** (P1-5). Highest marks-per-page in the whole review.
4. **Redraw the ERD** (P0-5, P0-7, P0-8, P1-18) — tenant key, leave ledger, immutable
   payslips.
5. **Fix the payroll domain rules** (P0-9, P1-1, P1-2) — accrual, OT base, Asia/Dhaka.
6. **Correct the numbers** (P1-6 … P1-12) — one hosting figure, honest margins, real uptime.
7. **Polish** (all P2) — an afternoon's work, and it removes every easy criticism.
