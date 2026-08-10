# PulseHR — Complete File Map

**Single project root:** `E:\PulseHR`

Everything lives here. Nothing is scattered across other drives. **98 files, 9.76 MB**
(excluding `node_modules` and `.git`).

> The project was previously at `D:\PulseHR` (inside a Steam installation directory) and has
> been moved to `E:` with git history intact. `D:\PulseHR` no longer exists.

---

## Quick reference

| I want… | Path |
|---|---|
| **The defect review of your proposal** | `E:\PulseHR\docs\00-source-document-review.md` |
| **The progress log for your instructor** | `E:\PulseHR\docs\WORK-UPDATE.md` |
| **The SQA defect report** | `E:\PulseHR\docs\13-sqa-defect-report.md` |
| **Your fixed presentation** | `E:\PulseHR\_deliverables\PulseHR_Presentation_(01-08-26)_renumbered.pptx` |
| **The LinkedIn drafts** | `E:\PulseHR\_deliverables\linkedin-post-draft.md` |
| **To run the app** | `E:\PulseHR` → `npm run dev:api` + `npm run dev:web` |

---

## 1. Documentation — `E:\PulseHR\docs\` *(17 files, 189 KB)*

| File | Owner | What it is |
|---|---|---|
| `00-source-document-review.md` | — | **45 defects** found in your proposal + deck, with fixes |
| `01-process-model-decision.md` | Rabbi | ADR-001 — Incremental, no gates. Drop-in replacement text |
| `02-architecture.md` | Rabbi | ADR-002…009, NFRs, load model, security posture |
| `03-data-model.md` | Jakariya | ERD, PostgreSQL DDL, indexing, retention |
| `04-payroll-spec.md` | Rabbi | Labour Act rules, formulas, worked examples, boundaries |
| `05-attrition-risk-spec.md` | Rouf | Scorecard design, metrics, acceptance criteria, responsible use |
| `06-api-contract.md` | Rabbi | Endpoints + the 16-screen inventory |
| `07-test-plan.md` | Muradujjaman | Test levels, load model, traceability |
| `08-business-model-corrections.md` | Rabbi | Corrected unit economics and pricing |
| `09-risk-register.md` | Rabbi | Live and closed risks by exposure |
| `10-proposal-patches.md` | — | **Ready-to-paste** replacement text for the proposal |
| `11-subscription-model.md` | Rabbi | Entitlement matrix, plan status, 402 semantics |
| `12-ui-modernisation.md` | Rayhan | What's modern for subscription SaaS, phased plan |
| `13-sqa-defect-report.md` | **Muradujjaman** | **16 defects found, 11 fixed** — the SQA deliverable |
| `14-data-layer.md` | **Jakariya** | Normalisation proof, indexing rationale, `LeaveBalance` → ledger |
| `15-model-card.md` | **Rouf** | Formal model card: use, limits, fairness, evaluation |
| `16-team-and-governance.md` | **Rabbi** | Responsibility matrix, backend rationale, increment sign-off |
| `WORK-UPDATE.md` | — | **Running progress log — hand this to your instructor** |

---

## 2. Source code

### Domain core — `E:\PulseHR\packages\core\`

Pure logic: no database, no network, no clock. This is where correctness lives.

```
packages\core\src\money.ts           Integer paisa, never float
packages\core\src\dates.ts           Asia/Dhaka business dates, Fri+Sat weekend
packages\core\src\types.ts           Shared domain types
packages\core\src\payroll.ts         Payroll engine (§108 overtime on basic)
packages\core\src\leave.ts           Accrual (§117 1-per-18) + ledger balance
packages\core\src\attrition.ts       Attrition scorecard + evaluation
packages\core\src\subscription.ts    Entitlement matrix + seat accounting
packages\core\src\index.ts           Barrel export
```

**Tests — 102 passing:**
```
packages\core\test\payroll.test.ts        26 tests
packages\core\test\leave.test.ts          25 tests
packages\core\test\attrition.test.ts      22 tests
packages\core\test\subscription.test.ts   16 tests
packages\core\test\dates.test.ts          13 tests
```

### Backend API — `E:\PulseHR\apps\api\`

```
apps\api\src\server.ts               All HTTP routes
apps\api\src\auth.ts                 scrypt, JWT, revocable sessions, rate limit
apps\api\src\repo.ts                 Tenant-scoped data access
apps\api\src\entitlement.ts          Plan feature guard (402)
apps\api\src\features.ts             DB → attrition feature vector
apps\api\src\db.ts                   Connection + migration runner
apps\api\src\seed.ts                 3 tenants, 30 employees, 180 days attendance
apps\api\src\jobs\queue.ts           Job queue interface
apps\api\src\jobs\runPayroll.ts      Payroll worker
apps\api\src\jobs\scoreAll.ts        Nightly attrition batch

apps\api\migrations\001_init.sql          Core schema, 16 tables, triggers
apps\api\migrations\002_subscription.sql  Plans, seats, dept start time
apps\api\migrations\003_payslip_unique.sql Partial unique index (BUG-12)

apps\api\pulsehr.db                  SQLite database (git-ignored)
```

### Frontend — `E:\PulseHR\apps\web\`

```
apps\web\src\App.tsx                 Shell: nav, plan chip, theme, responsive
apps\web\src\api.ts                  Fetch client, token refresh, 402 typing
apps\web\src\store.ts                Redux Toolkit auth slice
apps\web\src\subscription.ts         Client entitlement mirror
apps\web\src\styles.css              Design tokens, light + dark, responsive
apps\web\src\main.tsx                Entry point

apps\web\src\components\Toast.tsx    Toast system (aria-live)
apps\web\src\components\Feedback.tsx Skeletons, empty states, upgrade prompt

apps\web\src\pages\Login.tsx
apps\web\src\pages\Dashboard.tsx     Stats + at-risk list + upgrade gate
apps\web\src\pages\Attendance.tsx    Monthly grid, check in/out
apps\web\src\pages\Leave.tsx         Request + approval queue
apps\web\src\pages\Payslips.tsx      List + printable payslip
apps\web\src\pages\AtRisk.tsx        Score breakdown with contributions
apps\web\src\pages\Plan.tsx          Plan & billing, tier comparison
```

---

## 3. Test & tooling scripts — `E:\PulseHR\scripts\` and `tools\`

```
scripts\smoke.mjs                     30 end-to-end checks against a live API
scripts\bughunt.mjs                   17 adversarial checks vs the user stories
scripts\verify-payslip-uniqueness.mjs  Proves the DB constraint actually holds
tools\fix_deck_numbering.py           Repairs the deck's slide-number footers
```

---

## 4. Your original documents — `E:\PulseHR\_source-docs\`

Copies of what you supplied. **Originals still in `C:\Users\ri511\Downloads`, but C: has
only ~10 GB free and files have already been auto-deleted from there once** (see
`WORK-UPDATE.md` → Issues). These are your safe copies.

```
_source-docs\PulseHR_Features_Functions (1).docx      9 features / 43 functions
_source-docs\PulseHR_Presentation_(01-08-26).pptx     35 slides
_source-docs\PulseHR_Requirements_Model (1).drawio    13 pages of UML
_source-docs\PulseHR_Requirements_Model.drawio        (+5 earlier versions)
_source-docs\PulseHR_Requirements_Model_1..5.drawio
```

**Missing and not recoverable from here:** `PulseHR_Proposal_(25-07-2026).docx` and the other
presentation versions were deleted from Downloads before I could copy them. Check OneDrive,
email, or a teammate's copy.

Extracted plain text (used for the analysis) is in `_source-extracts\`.

---

## 5. Deliverables — `E:\PulseHR\_deliverables\`

```
_deliverables\PulseHR_Presentation_(01-08-26)_renumbered.pptx
    Your deck with all 27 wrong slide numbers fixed. Original untouched.

_deliverables\linkedin-post-draft.md
    Three post drafts for your review. Not published.
```

---

## 6. Config & CI

```
package.json               Workspace root + all npm scripts
tsconfig.json              Project references
tsconfig.base.json         Shared strict TypeScript config
.github\workflows\ci.yml   Typecheck, tests, build, seed, jobs, smoke, audit
.gitignore
README.md                  Start here
FILE-MAP.md                This file
```

---

## 7. Toolchain — outside the project

```
E:\tools\node\             Portable Node.js 24.19.0 (on PATH)
```

Installed to E: because the system Node installation at `C:\Program Files\nodejs` was
destroyed mid-session and its MSI could no longer repair itself.

---

## Commands — all run from `E:\PulseHR`

```bash
npm install                      # first time only
npm test                         # 102 unit tests
npm run seed                     # 3 tenants, 30 employees
npm run job:score                # nightly attrition batch
npm run job:payroll -- 2026 7    # payroll run
npm run dev:api                  # API on :4000
npm run dev:web                  # UI on :5173
node scripts/smoke.mjs           # 30 integration checks
node scripts/bughunt.mjs         # 17 adversarial checks
```

**Demo logins** — password `Passw0rd!` for all:

| Email | Tenant | Tier | Shows |
|---|---|---|---|
| `hr@meridian.test` | Meridian Textiles | **Enterprise** | Everything unlocked |
| `hr@bengal.test` | Bengal Logistics | **Growth** | Attrition module gated → upgrade prompt |
| `hr@dhakacraft.test` | Dhaka Craft Apparels | **Starter** | Performance + Recruitment locked in nav |
| `shabnam.rahman@meridian.test` | Meridian | — | Manager view (refused the at-risk list) |
| `farhana.akter@meridian.test` | Meridian | — | Employee self-service |
