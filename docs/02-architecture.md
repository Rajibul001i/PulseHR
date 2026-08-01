# Architecture & Decision Records

**Resolves:** P0-5, P0-6, P0-9, P1-19, P1-20, P1-21, P1-22, P1-24

---

## 1. System shape

```
┌──────────────────────────────────────────────────────────────────┐
│ TIER 1 · PRESENTATION                                            │
│ React 18 SPA (Vite, TypeScript, Redux Toolkit)                   │
│ Employee · Manager · HR Admin views                              │
└───────────────────────────┬──────────────────────────────────────┘
                            │ HTTPS / JSON  ·  Bearer access token
┌───────────────────────────▼──────────────────────────────────────┐
│ TIER 2 · APPLICATION                                             │
│                                                                  │
│  ┌────────────────────┐        ┌──────────────────────────────┐  │
│  │  API PROCESS       │        │  WORKER PROCESS   (ADR-004)  │  │
│  │  Express + TS      │        │  · payroll runs              │  │
│  │  interactive only  │──job──▶│  · nightly attrition batch   │  │
│  │  p95 < 300 ms      │ queue  │  · never in the request path │  │
│  └─────────┬──────────┘        └──────────────┬───────────────┘  │
│            │                                  │                  │
│            └──────────────┬───────────────────┘                  │
│                           │                                      │
│  ┌────────────────────────▼─────────────────────────────────┐    │
│  │  @pulsehr/core — pure domain logic, zero I/O             │    │
│  │  payroll · leave accrual · attrition scoring · dates     │    │
│  │  100% unit-testable, no database, no network             │    │
│  └────────────────────────┬─────────────────────────────────┘    │
└───────────────────────────┼──────────────────────────────────────┘
                            │ parameterised SQL, tenant-scoped
┌───────────────────────────▼──────────────────────────────────────┐
│ TIER 3 · DATA                                                    │
│ PostgreSQL 15 · 3NF · organisation_id on every table · RLS       │
│ append-only leave_ledger · immutable payslips · audit_log        │
└──────────────────────────────────────────────────────────────────┘
```

The important structural difference from the original blueprint: the **AI engine is not a
tier**. It is a job that runs in the worker process and writes to a table. Drawing it as a
peer of the three tiers (deck slide 24) overstates it architecturally and hides the fact
that it must not run in the request path.

---

## ADR-002 · Layered monolith, not microservices

**Decision.** One deployable API, one deployable worker, one database. Modules are enforced
by directory boundaries and by a domain package that cannot import infrastructure.

**Why.** Five developers, eight weeks. Microservices would add network partitions,
distributed transactions and deployment complexity to a team that needs none of it. Payroll
requires ACID transactions *across* employees, leave and salary structures — precisely the
thing service boundaries make hard.

**Consequence.** If PulseHR later needs to scale, the worker split (ADR-004) is already the
seam along which the first service would be extracted.

---

## ADR-003 · Multi-tenancy by shared schema with a mandatory tenant key

**Resolves P0-5.**

**Decision.** Every business table carries `organisation_id UUID NOT NULL`. All data access
goes through a repository layer that takes the tenant from the authenticated principal and
injects it — application code never writes a `WHERE organisation_id = …` clause by hand.
PostgreSQL **Row-Level Security** is enabled as defence in depth.

**Why not a database per tenant.** 200 customers means 200 migration runs and 200 backup
policies. Not viable for a five-person team.

**Why RLS *as well as* the repository layer.** The repository is the primary control; RLS is
the backstop for the day someone writes a raw query. Two independent controls, because a
cross-tenant leak is the one bug that ends a B2B product.

**Test.** The suite includes a cross-tenant read attempt that must return zero rows — run in
CI on every PR.

---

## ADR-004 · Long-running work executes in a worker process, never in the API

**Resolves P0-6.**

**Decision.** Payroll runs and the nightly attrition batch are **jobs**, enqueued by the API
and executed by a separate process. The API returns `202 Accepted` with a job id; the client
polls for status.

**Why.** Node.js executes JavaScript on a single thread. A payroll run over 10,000 employees
inside the API process blocks the event loop and makes every other request hang. The
proposal's claim that Node's async I/O makes it good at concurrent payroll is exactly
backwards — async I/O helps with *waiting*, not with *computing*.

**Prototype implementation.** An in-process job runner with the same interface as a real
queue (`enqueue` / `poll` / `complete`), so swapping in BullMQ + Redis for production is a
one-file change. The prototype also exposes `npm run job:score` and `npm run job:payroll`
as CLI entry points — which is how you demonstrate the nightly batch to an instructor
without waiting until midnight.

---

## ADR-005 · Business dates are always derived in `Asia/Dhaka`

**Resolves P0-9.**

**Decision.**
- All timestamps stored as `TIMESTAMPTZ` (UTC on the wire and on disk).
- A **business date** is *never* obtained from `new Date().toISOString().slice(0,10)`.
- Exactly one function performs the conversion: `businessDate(instant): DhakaDate` in
  `@pulsehr/core`. A lint rule forbids `toISOString().slice` elsewhere in the codebase.
- The working week and holiday calendar are **configuration**, defaulting to
  **Friday + Saturday** weekend and the 11 statutory festival holidays (§118).

**Why.** Bangladesh is UTC+6, no DST. A server in a US region computing "today" from UTC
assigns a 22:30 Dhaka check-in to the following day. This silently corrupts the attendance
grid, the lateness signal feeding the attrition model, and LWP day counts in payroll — and
it is invisible when testing on a laptop already set to Dhaka time.

**Test.** `core/test/dates.test.ts` asserts that `2026-08-02T17:30:00Z` (23:30 Dhaka) is
business date **2026-08-02**, and that `2026-08-02T18:30:00Z` (00:30 Dhaka next day) is
**2026-08-03**.

---

## ADR-006 · Short-lived access tokens + revocable refresh sessions

**Resolves P1-19.**

**Decision.**
- Access token: JWT, **HS256, 15-minute expiry**, carries `sub`, `org`, `role`.
- Refresh token: opaque random 256-bit value, **hashed** before storage in a
  `session` table, 7-day expiry, rotated on every use.
- Logout, password change, role change, or employment termination **revokes all sessions**
  for that user immediately.
- Passwords hashed with **scrypt** (Node built-in, memory-hard) — not SHA-256, not plain
  bcrypt-with-low-cost.

**Why.** A stateless JWT cannot be revoked before it expires. For an HRIS this is
disqualifying — when someone is terminated, their access to salary and personnel data must
stop *now*. The 15-minute access window bounds the exposure; the session row provides the
kill switch.

**Also.** Refresh tokens are stored **hashed**, so a database leak does not hand an attacker
live sessions.

---

## ADR-007 · Forward-only numbered SQL migrations from day one

**Resolves P1-20.**

**Decision.** `apps/api/migrations/NNN_name.sql`, applied in order by a runner on boot,
tracked in a `schema_migration` table. No down-migrations — a mistake is corrected by a new
forward migration.

**Why.** Four increments each change the schema. Without migrations, the shared demo
environment breaks in Increment 3, at the worst possible moment. Down-migrations are omitted
deliberately: they are rarely tested, rarely correct, and never used under pressure.

---

## ADR-008 · The domain core is pure

**Decision.** `packages/core` contains payroll calculation, leave accrual, attrition scoring
and date handling as **pure functions**: no database, no network, no clock, no environment.
Time and randomness are injected as parameters.

**Why.** These are the two pieces of logic that must be provably correct (money, and a score
that affects people). Pure functions are exhaustively testable at boundaries without
fixtures, containers, or a database. It is also the only way to make the SQA plan's
white-box testing (proposal §6.5) actually feasible.

**Consequence.** Every payroll rule is unit-testable in milliseconds, which is what lets CI
run the full suite on every PR.

---

## ADR-009 · SQLite for the prototype, PostgreSQL for production

**Decision.** The prototype runs on Node 24's built-in `node:sqlite`. The production target
remains PostgreSQL 15. A thin `Db` interface separates them; the canonical schema is written
in PostgreSQL DDL and mechanically reduced for SQLite.

**Why.** Zero installation for the demo — a grader can `npm install && npm run dev` on any
machine with Node and see a working system. Requiring a Postgres install before anything
runs is a real barrier to a five-minute demo.

**Accepted cost, stated honestly.** SQLite does not provide `EXCLUDE USING gist` (the
overlap constraint of P0-7) or Row-Level Security. The prototype therefore enforces
**overlap checking in the transaction** and **tenant scoping in the repository layer**, and
the PostgreSQL DDL in [`03-data-model.md`](03-data-model.md) adds both database-level
constraints on top. The migration path is documented, not hand-waved.

---

## 2. Non-functional requirements

**Resolves P1-24.** Neither source document states a single measurable NFR. These are
targets, not aspirations — each is testable.

| # | Requirement | Target | How verified |
|---|---|---|---|
| NFR-1 | API latency, dashboard reads | **p95 < 300 ms** at 50 concurrent users | Load test, Increment 4 |
| NFR-2 | Static asset TTFB | **< 100 ms** via CDN | Synthetic monitoring |
| NFR-3 | First contentful paint | **< 1.5 s** on 4G | Lighthouse in CI |
| NFR-4 | Payroll run | **500 employees < 60 s**, in the worker | Benchmark, Increment 3 |
| NFR-5 | Nightly attrition batch | **5,000 employees < 5 min** | Benchmark, Increment 4 |
| NFR-6 | Concurrent users | **200** per tenant without degradation | Load test |
| NFR-7 | Availability | **99.5%** on the MVP architecture (99.9% only with Multi-AZ) | Uptime monitor — see P1-12 |
| NFR-8 | RPO / RTO | **RPO 5 min** (PITR enabled), **RTO 1 h** | Documented restore drill, Increment 4 |
| NFR-9 | Payslip immutability | 0 UPDATEs on `payslip` after issue | DB trigger + test |
| NFR-10 | Audit retention | **7 years** for payroll, **2 years** for access logs | Retention job |
| NFR-11 | Accessibility | **WCAG 2.1 AA** on core flows | axe-core in CI |
| NFR-12 | Browser support | Last 2 versions of Chrome, Edge, Firefox, Safari | Browserslist |
| NFR-13 | Localisation | English UI in MVP; **Bangla payslips deferred** to post-MVP, string externalisation in place from Increment 1 | Code review |
| NFR-14 | Tenant isolation | Cross-tenant read returns **0 rows** | Automated test, every PR |
| NFR-15 | Password storage | scrypt, N=16384 minimum | Code review + test |

> **On NFR-7:** the original documents promise 99.9% (proposal §6.5). That is 43 minutes of
> downtime per month, and it is not achievable on a single Render instance with a single
> RDS instance. 99.5% is honest for the MVP. Say the honest number.

---

## 3. Performance & load model

**Resolves P1-23.** "10,000 dummy records" is not a stress test — Postgres will not notice
it. The dimension that actually hurts is attendance volume:

| Table | Rows for 500 employees | Rows for 5,000 employees |
|---|---|---|
| `employee` | 500 | 5,000 |
| `attendance` (3 years) | **~750,000** | **~7,500,000** |
| `payslip_line` (3 years) | ~144,000 | ~1,440,000 |
| `attrition_score` (nightly, 1 yr) | ~182,000 | ~1,825,000 |

**Hot paths to benchmark:**

1. Monthly attendance grid — 500 employees × 31 days. Needs a covering index on
   `(organisation_id, employee_id, work_date)`.
2. Payroll run — 500 payslips with LWP and OT in one transaction.
3. Nightly scoring — 90-day feature window per employee.
4. HR dashboard — top-20 at-risk employees, joined to employee and department.

`attrition_score` grows fastest and is the obvious candidate for monthly partitioning once a
tenant passes ~2,000 employees. Noted now so it is not a surprise later.

---

## 4. Security posture

| Control | Implementation |
|---|---|
| Transport | TLS 1.3, HSTS |
| At rest | AES-256 (RDS encryption); **column-level** encryption for NID and bank account |
| PII minimisation | NID stored as **salted hash + last 4 digits** (P1-4), never in full |
| AuthN | scrypt passwords; 15-min JWT; revocable refresh sessions (ADR-006) |
| AuthZ | Role-based, enforced at the route layer *and* the repository layer |
| Tenant isolation | Repository injection + PostgreSQL RLS (ADR-003) |
| Injection | Parameterised queries only; no string-built SQL anywhere |
| Audit | Every write and every attrition-score view appended to `audit_log` |
| Secrets | Environment variables, never committed; `.env.example` documents the shape |
| Rate limiting | Login endpoint throttled — 5 attempts per 15 min per account |
| Dependency risk | `npm audit` in CI; Dependabot |

**Attrition-score access is deliberately narrower than the rest of the system:** HR role
only, every view audited. See [`05-attrition-risk-spec.md`](05-attrition-risk-spec.md) §9
for why this is a hard requirement and not a preference.
