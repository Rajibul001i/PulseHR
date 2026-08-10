# PulseHR

Predictive Human Resource Information System — groundwork and working prototype.

**Team Pulse** · Southeast University · Information System Design & Software Engineering

**Repo:** https://github.com/Rajibul001i/PulseHR

---

## What this repository is

Two things:

1. **Groundwork** (`docs/`) — a review of the proposal and presentation that found
   **45 defects**, and the corrected engineering specifications that resolve them.
2. **A working prototype** — the real stack from the proposal (TypeScript, React, Node,
   Express), running and tested.

Everything below has been executed on this machine, not just written.

## Quick start

```bash
npm install
npm test          # 86 unit tests
npm run seed      # 2 organisations, 26 employees, 4,706 attendance rows
npm run job:score # nightly attrition batch
npm run job:payroll -- 2026 7
```

Then, in two terminals:

```bash
npm run dev:api   # http://localhost:4000
```

```bash
npm run dev:web   # http://localhost:5173
```

Sign in as `hr@meridian.test` / `Passw0rd!`.

| Account | Role |
|---|---|
| `hr@meridian.test` | HR Admin — sees the at-risk dashboard, runs payroll |
| `shabnam.rahman@meridian.test` | Manager — approves leave, **refused** the at-risk list |
| `farhana.akter@meridian.test` | Employee — own attendance, leave, payslips |
| `hr@bengal.test` | HR Admin of a **second tenant** — proves isolation |

Requires **Node 24+** (for the built-in `node:sqlite`). No database install, no Docker.

## Verification status

| Check | Result |
|---|---|
| `npm test` | **86 / 86 passing** |
| `npx tsc -b` | **clean**, TypeScript strict across 3 workspaces |
| `npm run build` | frontend builds, 214 kB (70 kB gzipped) |
| `node scripts/smoke.mjs` | **30 / 30 passing** against a live API |
| Payslip immutability trigger | verified — `UPDATE` rejected at the database level |

## Documentation

| Doc | What it covers |
|---|---|
| **[00 · Source Document Review](docs/00-source-document-review.md)** | **Start here.** 45 defects in the proposal and deck, with fixes. |
| [01 · Process Model Decision](docs/01-process-model-decision.md) | ADR-001 — Incremental, with drop-in text for both documents |
| [02 · Architecture](docs/02-architecture.md) | ADR-002…009, NFRs, load model, security posture |
| [03 · Data Model](docs/03-data-model.md) | Full ERD, PostgreSQL DDL, indexing, retention |
| [04 · Payroll Spec](docs/04-payroll-spec.md) | Labour Act rules, formulas, worked examples, boundaries |
| [05 · Attrition Risk Spec](docs/05-attrition-risk-spec.md) | Cold-start scorecard, metrics, acceptance criteria, responsible use |
| [06 · API Contract](docs/06-api-contract.md) | Endpoints and the 16-screen inventory |
| [07 · Test Plan](docs/07-test-plan.md) | What each test level actually runs, with traceability |
| [08 · Business Model](docs/08-business-model-corrections.md) | Corrected unit economics and pricing |
| [09 · Risk Register](docs/09-risk-register.md) | Live and closed risks by exposure |
| [10 · Proposal Patches](docs/10-proposal-patches.md) | Ready-to-paste replacement text |

## The nine blocking defects

| # | Defect | Fixed by |
|---|---|---|
| P0-1/2/3 | Proposal and deck select **different process models**, and the deck contradicts itself | ADR-001 |
| P0-4 | The AI module has **no training data and no label** | Expert scorecard + written promotion criterion |
| P0-5 | ERD has **no tenant column** — a multi-tenant SaaS that leaks | `organisation_id` everywhere + repository injection + RLS |
| P0-6 | The Node.js justification is **backwards** — payroll is CPU-bound, Node is single-threaded | Worker process, `202 Accepted` |
| P0-7 | Leave balance is mutable state with a **race condition** | Append-only ledger + transactional check |
| P0-8 | Payslip stores only `net_pay` — **unauditable** | Line items + immutability trigger |
| P0-9 | Business dates with **no timezone** — corrupts attendance *and* payroll | Single `businessDate()` helper, Asia/Dhaka |

And the most expensive single defect: the proposal's *"twice the standard hourly rate"* for
overtime reads as gross-based, but §108 sets it on **basic**. At a 30,000 basic / 50,000
gross salary that is a **67% overpayment on every overtime hour** — roughly BDT 3.7 lakh a
year across 200 employees. Fixed in `packages/core/src/payroll.ts`, with a test that
demonstrates the difference.

## Layout

```
packages/core/     Pure domain logic — money, dates, leave, payroll, attrition.
                   No I/O, no clock, no database. 86 tests.
apps/api/          Express API + worker jobs + migrations + seeder.
apps/web/          React 18 SPA (Vite, Redux Toolkit).
scripts/smoke.mjs  30 end-to-end checks, each mapped to a defect.
tools/             fix_deck_numbering.py — repairs the deck's slide numbers.
docs/              Groundwork.
```

## Notable design decisions

- **The domain core is pure.** Payroll and scoring are functions with no I/O, so every
  boundary case is testable in milliseconds. This is what makes the SQA plan's white-box
  testing actually feasible.
- **Money is integer paisa**, never a float.
- **Statutory values are configuration**, not code — an amendment to the Labour Act is a
  settings change.
- **Attrition scores are HR-only, audited on every view, and never displayed without their
  feature contributions.** Performance-review scores are deliberately excluded from the
  model, because the proposal itself identifies reviews as the artifact most corrupted by
  favouritism.
- **SQLite for the prototype, PostgreSQL for production** (ADR-009). The trade-offs are
  documented, not hand-waved.

## What is specified but not built

Honest scope. Both are documented in `docs/` and left out of the prototype deliberately:

- OKR performance module and the ATS Kanban board (screens 15–16)
- Income tax / TDS calculation — the schema and slab table exist; the calculation needs an
  investment-declaration workflow that is a module in its own right
