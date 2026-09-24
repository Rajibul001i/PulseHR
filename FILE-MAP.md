# PulseHR — File Map

All paths are relative to the repository root. `node_modules`, build output and the local
SQLite database are git-ignored.

## Quick reference

| I want… | Path |
|---|---|
| The defect review of the proposal and deck | `docs/00-source-document-review.md` |
| The progress log | `docs/WORK-UPDATE.md` |
| The SQA defect report | `docs/13-sqa-defect-report.md` |
| What the report claims vs. what the code does | `docs/18-gap-analysis.md` |
| To run the whole app on one URL | `npm run demo` → http://localhost:4000 |

---

## 1. Documentation — `docs/`

| File | Owner | What it is |
|---|---|---|
| `00-source-document-review.md` | — | **45 defects** found in the proposal and deck, with fixes |
| `01-process-model-decision.md` | Rabbi | ADR-001 — Incremental. Drop-in replacement text |
| `02-architecture.md` | Rabbi | ADR-002…009, NFRs, load model, security posture |
| `03-data-model.md` | Jakariya | ERD, PostgreSQL DDL, indexing, retention |
| `04-payroll-spec.md` | Rabbi | Labour Act rules, formulas, worked examples, boundaries |
| `05-attrition-risk-spec.md` | Rouf | Scorecard design, metrics, acceptance criteria, responsible use |
| `06-api-contract.md` | Rabbi | Endpoints and the screen inventory |
| `07-test-plan.md` | Munadujjaman | Test levels, load model, traceability |
| `08-business-model-corrections.md` | Rabbi | Corrected unit economics and pricing |
| `09-risk-register.md` | Rabbi | Live and closed risks by exposure |
| `10-proposal-patches.md` | — | Ready-to-paste replacement text for the proposal |
| `11-subscription-model.md` | Rabbi | Entitlement matrix, plan status, 402 semantics |
| `12-ui-modernisation.md` | Rayhan | Subscription-aware UI, phased plan |
| `13-sqa-defect-report.md` | **Munadujjaman** | The SQA deliverable: defects found and fixed |
| `14-data-layer.md` | **Jakariya** | Normalisation proof, indexing rationale, `LeaveBalance` → ledger |
| `15-model-card.md` | **Rouf** | Formal model card: use, limits, fairness, evaluation |
| `16-team-and-governance.md` | **Rabbi** | Responsibility matrix, backend rationale, increment sign-off |
| `17-load-test-report.md` | Munadujjaman | 150-user load and stress test, two concurrency defects |
| `18-gap-analysis.md` | — | Report and deck claims checked against the code |
| `WORK-UPDATE.md` | — | Running progress log |

---

## 2. Source code

### Domain core — `packages/core/`

Pure logic: no database, no network, no clock. This is where correctness lives.

```
packages/core/src/money.ts           Integer paisa, never float
packages/core/src/dates.ts           Asia/Dhaka business dates, Fri+Sat weekend
packages/core/src/types.ts           Shared domain types
packages/core/src/payroll.ts         Payroll engine (§108 overtime on basic)
packages/core/src/leave.ts           Accrual (§117 1-per-18) + ledger balance
packages/core/src/attrition.ts       Attrition scorecard + evaluation
packages/core/src/subscription.ts    Entitlement matrix + seat accounting
packages/core/src/billing.ts         Plan-change proration and invoices
packages/core/src/attendance.ts      Absence marking rule (F3.3)
packages/core/src/fairness.ts        Quarterly bias audit (spec §9)
packages/core/src/shift.ts           Shifts: lateness, night shifts, overtime past 8 h
packages/core/src/index.ts           Barrel export
```

**Tests — 130 passing:**
```
packages/core/test/payroll.test.ts        26 tests
packages/core/test/leave.test.ts          25 tests
packages/core/test/attrition.test.ts      22 tests
packages/core/test/subscription.test.ts   16 tests
packages/core/test/dates.test.ts          13 tests
packages/core/test/fairness.test.ts        8 tests
packages/core/test/attendance.test.ts      8 tests
packages/core/test/shift.test.ts           7 tests
packages/core/test/billing.test.ts         5 tests
```

### Backend API — `apps/api/`

```
apps/api/src/server.ts               All HTTP routes; also serves the built web app
apps/api/src/auth.ts                 scrypt, JWT, revocable sessions, rate limit
apps/api/src/repo.ts                 Tenant-scoped data access
apps/api/src/entitlement.ts          Plan feature guard (402)
apps/api/src/features.ts             DB → attrition feature vector
apps/api/src/db.ts                   Picks SQLite or PostgreSQL (ADR-009)
apps/api/src/db-sqlite.ts            SQLite backend (prototype, local)
apps/api/src/db-postgres.ts          PostgreSQL backend (production)
apps/api/src/seed.ts                 3 tenants, deterministic demo data
apps/api/src/jobs/queue.ts           Job queue interface
apps/api/src/jobs/runPayroll.ts      Payroll worker
apps/api/src/jobs/scoreAll.ts        Attrition scoring batch
apps/api/src/jobs/markAbsences.ts    Absence marking (F3.3)
apps/api/src/jobs/biasAudit.ts       Quarterly bias audit
apps/api/src/jobs/scheduler.ts       Nightly 02:00 Asia/Dhaka schedule
apps/api/src/mailer.ts               Password-reset email over SMTP (optional)

apps/api/migrations/                 14 forward-only SQLite migrations (001–014)
apps/api/migrations-postgres/        The same 14 migrations for PostgreSQL
```

### Frontend — `apps/web/`

```
apps/web/src/App.tsx                 Shell: nav, plan chip, theme, routes
apps/web/src/api.ts                  Fetch client, token refresh, 402 typing
apps/web/src/store.ts                Redux Toolkit auth slice
apps/web/src/subscription.ts         Client entitlement mirror
apps/web/src/styles.css              Design tokens, light + dark, responsive

apps/web/src/components/             Toast, Feedback (skeletons, empty states),
                                     NotificationBell, Logo, RiskInsights,
                                     MyRiskIndicator, AttendanceTools (duty time,
                                     correction form and review queue), Combobox
                                     (type-ahead search and searchable pickers)

apps/web/src/pages/                  15 screens: Login, ResetPassword, Dashboard,
                                     Profile, People, Attendance, Shifts, Leave, Payslips,
                                     Notices, AtRisk, Plan, OKR, Recruitment, Careers
```

---

## 3. Test & tooling scripts — `scripts/` and `tools/`

```
scripts/smoke.mjs                     30 end-to-end checks against a live API
scripts/bughunt.mjs                   Regression checks for every SQA defect found
scripts/loadtest.mjs                  150-user load and stress test
scripts/verify-payslip-uniqueness.mjs Proves the DB constraint actually holds
scripts/verify-leave-overlap.mjs      Proves the DB refuses overlapping approved leave
scripts/demo.mjs                      Seed, score, run payroll, serve web + API
tools/fix_deck_numbering.py           Repairs the deck's slide-number footers
```

---

## 4. Config, CI & deployment

```
package.json               Workspace root + all npm scripts
tsconfig.json              Project references
tsconfig.base.json         Shared strict TypeScript config
.github/workflows/ci.yml   Typecheck, tests, build, seed, jobs, smoke, audit
render.yaml                Live demo on one free Render web service
README.md                  Start here
FILE-MAP.md                This file
```

---

## Commands

```bash
npm install                      # first time only
npm test                         # 130 unit tests
npm run demo                     # everything on http://localhost:4000
npm run seed                     # 3 tenants of demo data
npm run job:score                # attrition scoring batch
npm run job:payroll -- 2026 8    # payroll run for a month
npm run job:absences             # mark absences
npm run job:bias-audit           # quarterly bias audit
npm run dev:api                  # API on :4000 (hot reload)
npm run dev:web                  # UI on :5173 (hot reload)
node scripts/smoke.mjs           # end-to-end checks
node scripts/bughunt.mjs         # regression checks
```

**Demo logins** — password `Passw0rd!` for all:

| Email | Tenant | Tier | Shows |
|---|---|---|---|
| `hr@meridian.test` | Meridian Textiles | **Enterprise** | Everything unlocked |
| `hr@bengal.test` | Bengal Logistics | **Growth** | Attrition module gated → upgrade prompt |
| `hr@dhakacraft.test` | Dhaka Craft Apparels | **Starter** | Performance + Recruitment locked in nav |
| `shabnam.rahman@meridian.test` | Meridian | — | Manager view (refused the at-risk list) |
| `farhana.akter@meridian.test` | Meridian | — | Employee self-service |
