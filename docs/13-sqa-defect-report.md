# SQA Defect Report — SQA-2026-08-10

**Prepared by:** Md. Muradujjaman — SQA Lead & Documentation Specialist
**Build under test:** `ffe3d10` + subscription layer
**Method:** adversarial black-box testing of the running API against the team's own
`PulseHR_Features_Functions.docx` (9 features / 43 functions), the 49 user stories in the
Requirements Model, the 18-class analysis model, and our published API contract.
**Harness:** `scripts/bughunt.mjs` — reproducible, re-runnable.

---

## 1. Why this pass found things the existing suites did not

We already had 102 unit tests and 30 integration checks, all green. They test **what we
designed for**. This pass tested **what we claimed** — every acceptance criterion in the
user stories, and every promise in the API contract — looking specifically for gaps between
the two.

That framing is the reason it found 16 defects in a build with a fully green test suite.
A test written by the person who wrote the feature inherits that person's assumptions.

---

## 2. Summary

| | Count |
|---|---|
| Checks executed | 17 |
| **Defects found** | **16** |
| **Fixed and re-verified** | **11** |
| Confirmed as not-yet-implemented (Increment 2–3 scope) | 5 |

Two findings were **security defects**, both contradicting our own published API contract.

---

## 3. Defects found and fixed

### BUG-02 — Severity: **Critical** · Access control

> **Any authenticated EMPLOYEE could read the entire company's attendance record.**

`GET /api/attendance/grid` had **no role guard at all**. The API contract (§4) documents it
as MANAGER + HR. In the seeded demo a plain employee retrieved **620 attendance rows** for
all 20 colleagues, including lateness for every day.

- **Detected:** direct call with an EMPLOYEE token returned `200` instead of `403`.
- **Root cause:** the route was written before `requireRole` existed and never revisited.
  The contract was written from intent, not from the code.
- **Fix:** `requireRole('MANAGER','HR_ADMIN')` on the route.
- **Re-verified:** now returns `403`.

**Lesson recorded:** documentation asserting a control is not evidence of the control. Every
role claim in the API contract now has a corresponding negative test.

### BUG-11 — Severity: **Critical** · Cross-tenant leak

> **One tenant could read another tenant's payroll job result.**

Job ids were global. `GET /api/jobs/:id` returned any job to any authenticated caller. An HR
admin at Bengal Logistics, holding a job id from Meridian Textiles, received Meridian's
payroll run summary — including total net pay for the period.

- **Root cause:** the job queue was built as infrastructure and never given a tenant
  dimension, even though every enqueue already carried `organisationId` in its payload.
- **Fix:** the route compares `job.payload.organisationId` to the caller's organisation and
  returns **404** (not 403) on mismatch, so it does not confirm the job exists.
- **Re-verified:** cross-tenant read now returns `404`.

This is notable because our smoke suite already tested tenant isolation — but only on the
routes we had thought about. The job route was invisible to that reasoning.

### BUG-01 — Severity: High · US-04 acceptance criterion

> *"A Manager opening the attendance report sees only their own department."*

A manager saw all 20 employees across all 6 departments.

- **Fix:** `attendanceGrid()` takes an optional department scope; MANAGER is narrowed to
  their own department, HR sees the organisation.
- **Re-verified:** manager now sees their department only.

### BUG-12 — Severity: High · Latent data integrity

> **The payslip duplicate-prevention constraint did not prevent duplicates.**

Migration 001 declared `UNIQUE (employee_id, period_year, period_month, adjusts_payslip_id)`
intending "one ordinary payslip per employee per period". In both SQLite and PostgreSQL,
**NULLs compare as DISTINCT inside a UNIQUE index** — so two ordinary payslips, each with
`adjusts_payslip_id = NULL`, never collide. The constraint read as though it protected the
invariant while protecting nothing.

- **Detected:** `scripts/verify-payslip-uniqueness.mjs` inserted a duplicate successfully.
- **Impact at time of testing:** none — only `runPayroll()` writes payslips and it checks
  first. That is precisely why it was worth fixing: the guard was one forgotten `if` away
  from paying an employee twice.
- **Fix:** migration `003` adds a **partial unique index** `WHERE adjusts_payslip_id IS NULL`,
  which expresses the rule correctly and still permits multiple adjustments against one
  original.
- **Re-verified:** duplicate insert now rejected by the database.

> Note on our own process: the first bug-hunt run reported this as *"re-run issued undefined
> payslips"*, which was a **timing artefact in the test**, not evidence of the real defect.
> The genuine finding only emerged on direct investigation. Recorded here because an SQA
> report that hides its own false starts is not worth much.

### BUG-08 — Severity: Medium · F3.1

A second check-in on the same day silently overwrote the first timestamp — destroying the
evidence the lateness signal (F9.1) and payroll both depend on. Now returns `409` with the
existing check-in time.

### BUG-10 — Severity: Medium · F4.1

A leave request dated **2020-01-01** was accepted with `201`. Leave is applied for, not
back-filled; retroactive entries are an HR adjustment, not a self-service action. Now
returns `400 START_DATE_IN_PAST`.

### BUG-06 — Severity: Medium · F2.4 / US-11

`GET /api/employees?q=` accepted the parameter and **silently ignored it**, returning the
entire directory. A silently-ignored filter is worse than an error: the caller believes it
worked. Now filters name, employee code, designation and department.

### BUG-07 — Severity: Medium · Class model

The class diagram specifies `Department.officeStartTime`, but lateness was hard-coded at
09:00 for every department in every tenant. Support (08:30) and Sales (10:00) were being
marked late incorrectly. Now per-department, with `GET /api/departments` exposing it.

### BUG-03 — Severity: Low · US-02

> *"Six consecutive failed attempts lock the account."*

Lockout triggered on the **6th** attempt rather than after six failures. Off-by-one against
the story's acceptance criterion. `MAX_ATTEMPTS` 5 → 6.

### BUG-16 / BUG-17 — Severity: High · Commercial

> **A GROWTH tenant had full access to the Enterprise attrition module, and nothing in the
> codebase knew what plan any tenant was on.**

PulseHR is sold in three tiers. No code anywhere referenced a plan. Fixed by building the
subscription layer — see [`11-subscription-model.md`](11-subscription-model.md).

---

## 4. Confirmed as not-yet-implemented (not defects)

These are **scope**, not failures. Recording them separately matters: reporting unbuilt
features as defects inflates the count and hides the real ones.

| ID | Function | Increment | Status |
|---|---|---|---|
| BUG-04 | F1.4 Password reset (US-05) | 1 | **Gap in Increment 1** — should have shipped |
| BUG-05 | F2.2 Employee self-service contact update (US-09) | 2 | Not built |
| BUG-13 | F6 OKR Performance | 3 | Not built |
| BUG-14 | F7 Recruitment ATS | 3 | Not built |
| BUG-15 | F8.3 Notice read tracking | 3 | Not built |

**BUG-04 is flagged for the team's attention.** Password reset belongs to Increment 1, which
is supposed to be complete. Under the Incremental Model an increment is done when *all* its
functions pass their acceptance criteria — F1.4 has not. Increment 1 is therefore **not
closed**, and saying so is the discipline the model requires.

---

## 5. Function coverage — F1–F9

| Feature | Functions | Implemented | Tested | Notes |
|---|---|---|---|---|
| F1 Authentication | 5 | 4 / 5 | ✅ | F1.4 password reset missing |
| F2 Employee Info | 5 | 3 / 5 | ✅ | F2.2 self-service, F2.5 documents missing |
| F3 Attendance | 5 | 5 / 5 | ✅ | |
| F4 Leave | 5 | 4 / 5 | ✅ | F4.4 in-app notifications missing |
| F5 Payroll | 5 | 4 / 5 | ✅ | F5.3 PDF is print-to-PDF, not generated |
| F6 Performance (OKR) | 4 | 0 / 4 | — | Increment 3 |
| F7 Recruitment (ATS) | 5 | 0 / 5 | — | Increment 3 |
| F8 Noticeboard | 4 | 2 / 4 | ✅ | F8.2 priority, F8.3 read tracking missing |
| F9 Attrition Risk | 5 | 5 / 5 | ✅ | |
| **Total** | **43** | **27 / 43 (63%)** | | |

---

## 6. One conflict to settle — F6.3 / F9.1

`PulseHR_Features_Functions.docx` states:

> **F6.3 Quarterly review scoring** — *"Records the manager's review score each quarter —
> **a direct input to the AI risk model**."*
> **F9.1 Behavioral signal collection** — gathers *"…**review-score dips**"*.

The implemented model **deliberately excludes review scores** (see
[`05-attrition-risk-spec.md`](05-attrition-risk-spec.md) §4). The reason is in the team's own
proposal: §3a says review scores are corrupted by *"favoritism or bias"*, and §4b promises to
remove that bias. Feeding them into the risk model launders an acknowledged human bias into
an output that looks objective.

**This is a decision for the team, not for SQA to make silently.** Options:

1. **Keep them excluded** (current implementation) and amend F6.3/F9.1 to say so, with the
   reasoning. Strongest position academically — it shows the team spotted a fairness problem
   in its own design.
2. **Include them**, and add the bias audit as a *precondition* rather than a later check.
3. **Make it configurable per tenant**, default off, documented.

**SQA recommendation: option 1.** It is defensible under questioning and costs nothing.
Flagged here so the choice is made deliberately and recorded either way.

---

## 7. Regression protection added

Every fixed defect now has a permanent test, so none can silently return:

| Defect | Permanent test |
|---|---|
| BUG-01, 02 | `scripts/bughunt.mjs` — role and scope checks |
| BUG-03 | `bughunt.mjs` — lockout on the 7th attempt |
| BUG-06, 07, 08, 10 | `bughunt.mjs` |
| BUG-11 | `bughunt.mjs` — cross-tenant job read |
| BUG-12 | `scripts/verify-payslip-uniqueness.mjs` — exits non-zero if the index is ineffective |
| BUG-16, 17 | `packages/core/test/subscription.test.ts` — 16 unit tests |

`bughunt.mjs` runs in CI alongside `smoke.mjs`.

---

## 8. Test totals after this pass

| Suite | Count | Status |
|---|---|---|
| Unit (`packages/core`) | **102** | ✅ all passing |
| Integration smoke | 30 | ✅ all passing |
| Adversarial bug hunt | 17 | 11 pass, 5 unbuilt features, 1 settled |
| Payslip uniqueness | 1 | ✅ constraint verified at DB level |
