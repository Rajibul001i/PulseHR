# 18 · Gap Analysis — Report & Deck vs. Repository

Checked on 24 Sep 2026: every claim in *PulseHR_Project_Report* and *PulseHR_Report_Presentation*
against the code on `master` (b7898e7). Verified locally: 107/107 unit tests, typecheck clean,
30/30 smoke, 57 bug-hunt checks with 0 defects.

## Fixed in this pass

| Problem | Fix |
|---|---|
| Live demo down: the free Render PostgreSQL (created 15 Aug) was deleted after 30 days, so the API could not start | `render.yaml` runs on SQLite by default (free web services do not expire); an external `DATABASE_URL` is optional |
| Demo needed two hosts (GitHub Pages + Render) | The API serves the built web app, so one URL is the whole product; `npm run demo` does the same locally |
| CI never ran: it triggered on `main`/`develop`, but the branch is `master` | `master` added to the triggers |
| README said 86 tests and "OKR / ATS not built" | Updated |

## Things the report says are done but the code doesn't do

These need either code or a correction in the report before submission.

| # | Report claim | What the code actually does |
|---|---|---|
| 1 | F1.1 HR creates accounts; F2.1 create employee profile | No endpoint or screen. Employees are only created by the seed or by hiring a candidate (F7.5) |
| 2 | F2.2 HR edits employment data | Employees can edit their own contact details. HR has no edit endpoint |
| 3 | F2.3 manage departments and designations | `GET /api/departments` only (read-only) |
| 4 | F5.1 configure salary structure | Set only by the seed. There's no API or UI |
| 5 | F1.5 account deactivation on separation | Session revocation exists. No action sets an employee to RESIGNED/TERMINATED and revokes access |
| 6 | Leave cancellation writes a compensating ledger entry | `CANCELLED` exists in the schema. No route or UI |
| 7 | F3.3 marks absence where there's no check-in and no leave | No job does this. Absences come only from the seed |
| 8 | Eight-feature scorecard | `okrEngagementDrop` gets hard-coded 0/0 (`apps/api/src/features.ts`), so only 7 of the 8 features are live |
| 9 | F9.2 nightly batch at 02:00 Asia/Dhaka | No scheduler. Scoring runs from the button, at boot (`scripts/demo.mjs`), or from `npm run job:score` |
| 10 | F9.5 department-level risk view for management | Not built. There is only the individual list for HR |
| 11 | Score contest and quarterly bias audit | There's a `contested` column but no route or screen. The report's own increment table calls this "outstanding" but also counts 5/5 |
| 12 | "PostgreSQL enforces … overlapping approved leave impossible at the schema level" | No exclusion constraint and no RLS in `migrations-postgres/` (WORK-UPDATE Session 5 says this was deliberately not done) |
| 13 | F5.5 department-wise payroll summary | There's no summary endpoint or screen. Payslips are per employee |
| 14 | F8.4 searchable notice archive | `GET /api/notices` has no search or archive filter |
| 15 | F1.4 reset link sent by email | No email is sent. The API returns the token in the response (`demoResetToken`) |
| 16 | "Feature branches merge into develop" | No `develop` branch exists |

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
- `docs/06-api-contract.md` lists 16 screens. The report lists 13, and the app has 13.
- WORK-UPDATE Session 5 quotes 20 smoke checks. The script has 30.
