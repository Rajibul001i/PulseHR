# Proposal Patches — Ready-to-Paste Replacement Text

Copy-paste corrections for `PulseHR_Proposal_(25-07-2026).docx`. Process-model text is in
[`01-process-model-decision.md`](01-process-model-decision.md); budget and pricing text is in
[`08-business-model-corrections.md`](08-business-model-corrections.md).

---

## Development plan — convert to future tense (P2-2, P2-4)

The current section is written in the **past tense** for work that has not started:
*"Gathered stakeholder requirements"*, *"We engineered and tested the Automated Payroll
Engine"*, *"The ATS Kanban board is now fully deployed"*, *"We ran a full SQA testing
cycle"*. It reads as though the project is finished, and it contradicts the facing page,
which is correctly in future tense.

Replace the whole section with:

> ### 6.2 Detailed Planning & Increment Roadmap
>
> The PulseHR build is divided into four increments of two weeks each, under the Incremental
> Process Model (§5.4). Every increment ends with working, tested software and a release
> gate. The team will hold 15-minute daily stand-ups to surface blockers early.
>
> **Increment 1 (Weeks 1–2) — Foundation & Design.**
> The team will gather stakeholder requirements through the activities described in §6.1 and
> produce a formal SRS. It will design UI/UX wireframes for the sixteen core screens in
> Figma, define the relational schema and ERD in PostgreSQL, establish forward-only database
> migrations and the CI pipeline, and produce the Use Case and Class diagrams for the first
> academic submission. The increment delivers a walking skeleton — login through to an empty
> dashboard — proving the full stack is wired end to end.
>
> **Increment 2 (Weeks 3–4) — Authentication & Core HR Operations.**
> The team will build the REST API with short-lived JWT access tokens and revocable refresh
> sessions, together with role-based access control enforced at both the route and
> repository layers. It will implement Employee Profile Management, server-validated
> Attendance Tracking with business dates derived in Asia/Dhaka, and Leave Management with a
> multi-level approval workflow backed by an append-only leave ledger. The increment
> delivers a usable HR system.
>
> **Increment 3 (Weeks 5–6) — Advanced Modules.**
> The team will engineer the Automated Payroll Engine, handling leave-without-pay proration
> and overtime at twice the ordinary rate of basic wage per §108, issuing immutable
> line-itemised payslips. It will implement OKR-based Performance Management and the
> Kanban Applicant Tracking System (F5–F8). In parallel, the AI Engineer will complete the
> behavioural signal feeds the Attrition Risk Module depends on — attendance, leave and
> salary history exposed for scoring (F9.1).
>
> **Increment 4 (Weeks 7–8) — AI Attrition Risk, SQA & Deployment.**
> The team will build and calibrate the attrition scoring engine and integrate its
> explainable output into the HR dashboard (F9.1–F9.5). Because this module carries the most
> technical uncertainty, the Incremental Model deliberately places it last: three increments
> of working, tested software are already delivered before it begins. The increment will complete the
> full SQA cycle — unit, integration, system, regression, performance and security testing —
> against a database seeded to realistic volume, followed by performance tuning and
> production deployment.

## Economic feasibility — reconcile with the budget (P1-10)

Insert after the first sentence:

> This distinction matters: the project's **notional cost**, which values five members'
> effort at market rate, is approximately BDT 9,27,000, while the **actual cash outlay**
> during the academic build is under BDT 5,000, because the team uses open-source frameworks
> and free developer hosting tiers. Both figures are reported in §6.2's budget table.

## Legal feasibility — replace the compliance claim (P1-4)

> The system is designed around data privacy and security by default. All personally
> identifiable information is encrypted in transit with TLS 1.3 and at rest with AES-256,
> with column-level encryption for the most sensitive fields. **National ID numbers are
> stored as a salted hash plus the last four digits rather than in full**, since the system
> has no operational need for the complete number.
>
> Bangladesh has no enacted comprehensive data-protection statute at the time of writing;
> the Personal Data Protection Ordinance remains in draft. PulseHR is therefore designed
> against the principles of that draft and of the GDPR — purpose limitation, data
> minimisation, retention limits, subject access and auditable processing — so that
> compliance is a configuration exercise when the law commences.
>
> The payroll and leave modules implement the Bangladesh Labour Act 2006: earned leave
> accruing at one day per eighteen days worked (§117), casual leave of ten days (§115), sick
> leave of fourteen days on full wages (§116), eleven festival holidays (§118), and overtime
> at twice the ordinary rate of basic wage (§108) within the statutory ceiling of sixty hours
> per week (§102). **Every statutory value is held as configuration rather than compiled into
> the engine**, so an amendment to the Act is a settings change, not a code change.

## AI objectives — make them measurable (P1-14)

Replace the "Actionable AI-Driven Insights" bullet:

> **Actionable AI-Driven Insights (Relevant & Measurable):** deliver a colour-coded risk
> dashboard in which every score decomposes into its contributing signals. The module's
> success criterion within the project window is **precision@10 of at least three times the
> base rate** on a held-out validation set, measured against a trivial tenure-based baseline.
> The longer-term business objective — a measurable reduction in voluntary turnover — is
> stated as a post-deployment target, since it cannot be observed within an eight-week build.

## Technology justification — fix the Node.js reasoning (P0-6)

The current paragraph claims Node's async I/O makes it good at concurrent payroll. It is
backwards: payroll is CPU-bound and Node is single-threaded for JavaScript.

> **Backend — Node.js (v20 LTS) with Express.js.** Node.js was selected for three reasons.
> First, a single language across frontend and backend lets a five-person team move between
> layers without context switching — decisive under an eight-week schedule. Second, the npm
> ecosystem is the largest available, so the team builds HR features rather than
> infrastructure. Third, Node's non-blocking event loop is genuinely well suited to the
> **interactive** API workload: many small, concurrent dashboard requests that spend most of
> their time waiting on the database.
>
> Long-running work is deliberately kept out of that event loop. Because Node executes
> JavaScript on a single thread, a month-end payroll run over thousands of employees — which
> is CPU- and database-bound rather than I/O-bound — would block every other request if
> executed in the API process. **Payroll runs and the nightly attrition scoring batch
> therefore execute in a separate worker process driven by a job queue**, with the API
> returning `202 Accepted` and a job identifier.

## Performance claims — fix the numbers (P1-22)

> **Production deployment architecture.** The React frontend is served from Vercel's global
> edge CDN, giving static-asset time-to-first-byte under 100 ms. The Node.js API runs on
> Render with autoscaling, targeting a p95 under 300 ms for dashboard reads from Dhaka, and
> a first contentful paint under 1.5 s on a 4G connection. PostgreSQL is hosted on AWS RDS
> with point-in-time recovery enabled, giving a recovery point objective of approximately
> five minutes and a target recovery time objective of one hour.

*(The current text's "load times under 50ms worldwide" is not achievable and conflates CDN
asset delivery with API latency — a CDN does nothing for the round-trip a data-dense
dashboard actually waits on.)*

## Load-testing claim — replace it (P1-23)

> Performance testing will seed three years of attendance data for five hundred employees —
> approximately 750,000 attendance rows — and benchmark the four hot paths: the monthly
> attendance grid, a full payroll run, the nightly scoring batch, and the at-risk dashboard
> query, each against the stated p95 targets.

## Conclusion — remove the overclaim (P2-10)

Replace the final paragraph:

> PulseHR is designed for commercial viability beyond its academic scope, with a clear path
> from the eight-week MVP to a deployable B2B SaaS product for Bangladesh's mid-market
> enterprise sector.

Delete: *"The development team is confident it will receive top academic recognition from
the course instructor."* It is an appeal to the marker rather than an engineering statement.

## New section — Responsible Use of Predictive Analytics (P1-5)

**Add this section.** It is the single highest-value addition in the whole review — neither
document contains a word on it.

> ### 6.6 Responsible Use of Predictive Analytics
>
> A system that flags employees as likely to resign creates risks that are ethical rather
> than technical, and the team has designed for them explicitly. Two harms are foreseeable.
> **Retaliation**: a manager who knows a report is flagged may quietly withdraw
> opportunities. **Self-fulfilling prophecy**: an employee treated as a flight risk may
> become one. PulseHR is built so that neither is easy to cause.
>
> Attrition scores are visible to **HR personnel only** and never to the employee's line
> manager. Every view of a score is written to the immutable audit log. Scores are
> **advisory for retention outreach only**; using a score as an input to a termination,
> promotion, appraisal or compensation decision is a prohibited use, stated in the product's
> terms and displayed alongside every score in the interface. No score is ever displayed as
> a bare number — the contributing signals are returned with it, so that any figure can be
> interrogated and challenged.
>
> Employees are notified that behavioural analytics operate, may request their own score and
> its contributing factors, and may contest a score, which flags it for review. Score
> distributions are audited quarterly across gender, department, age band and tenure band; a
> mean gap exceeding five points between groups triggers mandatory re-weighting.
>
> One design decision follows directly from §3a of this proposal. Because existing
> performance-review scores are identified there as the artifact most affected by favouritism
> and bias, **they are deliberately excluded from the risk model's input features**. Including
> them would launder an acknowledged human bias into an algorithmic output that appears
> objective. They may be admitted only once a bias audit demonstrates that review scores are
> statistically independent of gender and department after controlling for role.

## Minor corrections

| Change |
|---|
| Settle the spelling: **Muradujjaman** or **Munadujjaman** — currently both appear, in Table 0 and Appendix E (P2-3) |
| *"live Attrition Risk Score"* → *"an Attrition Risk Score recalculated nightly"* (P0/A6) |
| *"real-time behavioural data"* → *"behavioural data, evaluated nightly"* |
| *"a risk score of 1.0"* → *"a risk score of 100"* (P1-17) |
| *"a prototype-driven process with Scrum"* → the ADR-001 wording (P2-12) |
| Add in-text citations at every factual claim, especially the Labour Act figures and the replacement-cost claim (P2-9) |
