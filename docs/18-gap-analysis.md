# 18 · Gap Analysis — Report & Deck vs. Repository

Checked on 24 Sep 2026: every claim in *PulseHR_Project_Report* and *PulseHR_Report_Presentation*
against the code on `master` (b7898e7). After the gaps below were closed: 122/122 unit tests,
typecheck clean, 30/30 smoke and 108 bug-hunt checks with 0 defects, on SQLite and on
PostgreSQL 16.

## Fixed in this pass

| Problem | Fix |
|---|---|
| Live demo down: the free Render PostgreSQL (created 15 Aug) was deleted after 30 days, so the API could not start | `render.yaml` runs on SQLite by default (free web services do not expire); an external `DATABASE_URL` is optional |
| Demo needed two hosts (GitHub Pages + Render) | The API serves the built web app, so one URL is the whole product; `npm run demo` does the same locally |
| CI never ran: it triggered on `main`/`develop`, but the branch is `master` | `master` added to the triggers |
| README said 86 tests and "OKR / ATS not built" | Updated |

## Report claims the code didn't back — now built

All 16 were closed on 24 Sep 2026. Each is covered by the regression checks named in
the last column (`scripts/bughunt.mjs`, section "Gap closure"), and everything was run
against both SQLite and a real PostgreSQL 16 database.

| # | Report claim | What was built | Checks |
|---|---|---|---|
| 1 | F1.1 / F2.1 HR creates accounts and employee profiles | **People** screen → Add employee. Optional login with a temporary password; seat limit enforced; casual and sick leave granted pro-rata. `POST /api/employees` | GAP-01 |
| 2 | F2.2 HR edits employment data | People → Manage → Employment details. A manager change is stamped for the scorecard's F6 feature. `POST /api/employees/:id/employment` | GAP-02 |
| 3 | F2.3 manage departments | People → Departments: add, rename, set office start time. `POST /api/departments[/:id]` | GAP-03 |
| 4 | F5.1 configure salary structure | People → Manage → Salary history. New effective-dated structures only, never edits; refused for a month already paid. `GET/POST /api/employees/:id/salary` | GAP-04 |
| 5 | F1.5 account deactivation on separation | People → Manage → Record a separation. The login is disabled, sessions revoked, and the current access token refused on the next request. `POST /api/employees/:id/separate` | GAP-05 |
| 6 | Leave cancellation with a compensating ledger entry | Leave → Cancel / Withdraw, for leave that hasn't started. `POST /api/leave/requests/:id/cancel` | GAP-06 |
| 7 | F3.3 mark absence with no check-in and no leave | Nightly job, plus `POST /api/attendance/absence-runs`. Rule: `packages/core/src/attendance.ts` (7 unit tests) | GAP-10 |
| 8 | Eight-feature scorecard | Key-result updates are logged (`key_result_update`); the OKR engagement feature reads them. Seed data now has OKR history | GAP-08 |
| 9 | F9.2 nightly batch at 02:00 Asia/Dhaka | `apps/api/src/jobs/scheduler.ts`: absences, scoring, and the quarterly bias audit | Run once by hand; see Session 6 in WORK-UPDATE |
| 10 | F9.5 department-level risk view | Dashboard → Risk by department. Averages and counts only, no names | GAP-11 |
| 11 | Score contest and quarterly bias audit | My profile → My retention indicator (request and contest); HR review on the score page; Dashboard → Quarterly bias audit. Rule: `packages/core/src/fairness.ts` (8 unit tests) | GAP-07, GAP-13 |
| 12 | PostgreSQL makes overlapping approved leave impossible at the schema level | Migration 013: an exclusion constraint on PostgreSQL, triggers on SQLite | `scripts/verify-leave-overlap.mjs` |
| 13 | F5.5 department-wise payroll summary | Payslips → Payroll by department. `GET /api/payroll/summary` | GAP-14 |
| 14 | F8.4 searchable notice archive | Noticeboard search, which also reaches notices older than the latest 50 | GAP-15 |
| 15 | F1.4 reset link sent by email | Sent by SMTP when `PULSEHR_SMTP_URL` is set. Without it (the free demo) the link is shown on screen, as before | Checked with a test transport |
| 16 | "Feature branches merge into develop" | Not code: the report text needs to say work merges into `master` | — |

Found and fixed along the way: on PostgreSQL the department list returned
`officestarttime` instead of `officeStartTime` (PostgreSQL lower-cases unquoted aliases), so
every department's office start time was missing on the live Postgres demo.

## Deferred, and the report already says so

- Income tax / TDS (the slab table exists, but there's no calculation)
- Responsive layout for Manager/HR (Employee already works on mobile)
- Sortable/filterable tables, a formal WCAG 2.1 AA audit, Bangla localization
- A real payment gateway (billing is simulated)

## NFRs with no verification in the repo

NFR-2 (CDN), NFR-3 (page audit in CI), NFR-4 (500-employee payroll < 60 s), NFR-5 (5,000-employee
scoring < 5 min), NFR-7 (availability monitor), NFR-8 (backup + restore drill), NFR-10 (retention
job), NFR-11 (accessibility check in CI). The table says each one is "verified by" a check,
but none of those checks exists yet.

## Report / deck consistency

- DFD level 1: the report says five processes and six data stores. Deck slide 40 says four
  processes and four data stores.
- `docs/06-api-contract.md` lists 16 screens. The report lists 13; the app now has 14 (People was added).
- WORK-UPDATE Session 5 quotes 20 smoke checks. The script has 30.

## What the report and deck need to say now

- **Screens:** 14, not 13. Add **People** (HR only): employee directory, add, edit, salary, separation, departments.
- **Unit tests:** 122, not 107 (15 new: 8 bias audit, 7 absence marking).
- **Regression checks:** 108, not 64 (the 7 AI-assistant checks were removed; 51 gap-closure checks were added).
- **Migrations and tables:** 13 forward-only migrations and 33 tables (added `key_result_update` and `bias_audit_report`).
- **Section 5.4.1:** remove the explain-only AI assistant; it was taken out of the product.
- **Section 5.4.2 version control:** feature work merges into `master`; there is no `develop` branch.
- **Section 5.1.5 NFR table:** eight NFRs name a verification that does not exist yet (list above). Either mark them "planned" or add the checks.
