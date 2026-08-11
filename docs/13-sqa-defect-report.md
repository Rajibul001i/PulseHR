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
| BUG-13 | F6 OKR Performance | 3 | Not built |
| BUG-14 | F7 Recruitment ATS | 3 | Not built |
| BUG-15 | F8.3 Notice read tracking | 3 | Not built |

**BUG-04 (F1.4 password reset) is fixed as of 11 August 2026 — see §9.** Increment 1 is now
closed: all five F1 functions pass their acceptance criteria. It was the one function in
that increment not yet delivered, and under the Incremental Model an increment isn't done
until every function in it is — this is worth recording precisely because it stayed
un-closed for two sessions before anyone acted on the earlier flag.

**F2.2, F2.5 and F4.4 are fixed as of 12 August 2026 — see §10.** Increment 2 is now closed:
every function in F2 and F4 passes its acceptance criteria.

---

## 5. Function coverage — F1–F9

| Feature | Functions | Implemented | Tested | Notes |
|---|---|---|---|---|
| F1 Authentication | 5 | **5 / 5** | ✅ | Closed 11 Aug — F1.4 password reset shipped |
| F2 Employee Info | 5 | **5 / 5** | ✅ | Closed 12 Aug — F2.2 self-service, F2.5 documents shipped |
| F3 Attendance | 5 | 5 / 5 | ✅ | |
| F4 Leave | 5 | **5 / 5** | ✅ | Closed 12 Aug — F4.4 in-app notifications shipped |
| F5 Payroll | 5 | 4 / 5 | ✅ | F5.3 PDF is print-to-PDF, not generated |
| F6 Performance (OKR) | 4 | 0 / 4 | — | Increment 3 |
| F7 Recruitment (ATS) | 5 | 0 / 5 | — | Increment 3 |
| F8 Noticeboard | 4 | 2 / 4 | ✅ | F8.2 priority, F8.3 read tracking missing |
| F9 Attrition Risk | 5 | 5 / 5 | ✅ | |
| **Total** | **43** | **31 / 43 (72%)** | | |

---

## 6. One conflict to settle — F6.3 / F9.1

`PulseHR_Features_Functions.docx` states:

> **F6.3 Quarterly review scoring** — *"Records the manager's review score each quarter —
> **a direct input to the AI risk model**."*
> **F9.1 Behavioral signal collection** — gathers *"…**review-score dips**"*.

The implemented model **deliberately excludes review scores** (see
[`05-attrition-risk-spec.md`](05-attrition-risk-spec.md) §4). The reason is in the team's own
proposal: it says elsewhere that review scores are corrupted by *"favoritism or bias,"* and
separately promises to remove that bias. Feeding them into the risk model launders an
acknowledged human bias into an output that looks objective.

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
| Integration smoke | 20 | ✅ all passing |
| Adversarial bug hunt | 30 | 27 pass, 3 unbuilt features (Increment 3) |
| Payslip uniqueness | 1 | ✅ constraint verified at DB level |

(Both suites have grown since §2's original count as more user stories gained black-box
checks — see §10 for the checks added this pass.)

---

## 9. Addendum — 11 August 2026

### Correction to §3's BUG-12 note

The note above says the first bug-hunt run's *"re-run issued undefined payslips"* was **"a
timing artefact in the test, not evidence of the real defect."** That was wrong. Re-running
`bughunt.mjs` this session reproduced the identical symptom, and this time it was chased down
by polling the job directly instead of trusting a single 1.5s wait:

```
state: "FAILED", error: "No handler registered for PAYROLL_RUN"
```

It was not flakiness. It was — and had been since session 2 — a real, 100%-reproducible bug.
Leaving the record above unedited rather than quietly fixing the claim; the correction is
here instead.

### BUG-18 — Severity: **Critical** · Both async job types were non-functional

> **`POST /payroll/runs` and `POST /attrition/runs` both queued successfully and then failed
> every single time.** "Run payroll" and "Run scoring batch" — the two headline async
> features ADR-004 exists to support — did not work in the running server.

`src/jobs/queue.ts` is an in-process job runner: `enqueue()` schedules work, and a handler
registered via `registerHandler()` processes it. `src/jobs/runPayroll.ts` and
`src/jobs/scoreAll.ts` each call `registerHandler(...)` — but only at module load time, and
**nothing in `server.ts` ever imported either file.** Both handler registrations simply never
ran. Every queued job landed on `handlers.get(job.type)` returning `undefined` and failed
immediately with `No handler registered for <type>`.

- **Detected:** `bughunt.mjs`'s BUG-12 check, then confirmed by polling
  `GET /jobs/:id` directly against a fresh payroll run and a fresh attrition run.
- **Why the unit and smoke suites missed it:** both call the job **functions**
  (`runPayroll()`, `scoreOrganisation()`) directly, exactly as `npm run job:payroll` and
  `npm run job:score` do on the CLI. Nothing exercised the **API → queue → handler** path a
  browser click actually takes.
- **Fix:** two side-effecting imports added to `server.ts`:
  ```ts
  import './jobs/runPayroll.js';
  import './jobs/scoreAll.js';
  ```
  Both files already guard their CLI-only block with
  `import.meta.url === pathToFileURL(process.argv[1]).href`, so importing them for their
  `registerHandler` side effect does not also trigger the "score every org now" behaviour.
- **Re-verified:** `bughunt.mjs` BUG-12 now passes. Directly confirmed both job types reach
  `state: "DONE"` — a payroll run and a fresh attrition run (`scored: 20`,
  `bands: {LOW:16, MODERATE:1, ELEVATED:3, HIGH:0}`) — via `GET /jobs/:id`.

### BUG-04 fixed — F1.4 password reset, Increment 1 closed

> **F1.4 (US-05) was the one function keeping Increment 1 open. It now ships and passes its
> stated acceptance criteria.**

Built per US-05 exactly: `POST /auth/forgot-password` issues a single-use token expiring in
30 minutes (migration `004_password_reset.sql`, `password_reset_token`, hashed the same way
sessions are — auth.ts:69); `POST /auth/reset-password` consumes it and revokes every
existing session, since a reset is presumably a response to a compromised password.
Anti-enumeration is enforced identically to `/auth/login`: the same response regardless of
whether the email is registered.

**Documented limitation, not hidden:** no email provider is configured anywhere in this
project (no SMTP/API-key secret exists). The token that a real deployment would email is
returned directly in the API response instead (`demoResetToken`), and the frontend labels
this plainly rather than pretending email delivery exists. A production build would wire
this to a real provider (Resend, SES) and remove the field from the response entirely.

- **Re-verified:** `bughunt.mjs`'s BUG-04 now runs the full cycle black-box — issue a token,
  confirm the unregistered-email response is indistinguishable, consume the token, confirm
  a second use is rejected, confirm the new password signs in. All five assertions pass.
- Also verified through the real UI (Playwright): Login → "Forgot password?" → email →
  demo link → new password → redirected to sign in → signs in successfully.

### Updated regression protection (§7)

| Defect | Permanent test |
|---|---|
| BUG-18 | `bughunt.mjs` BUG-12 check now exercises the real API→queue→handler path, not just the job function |
| BUG-04 | `bughunt.mjs` — full request/consume/reuse/login cycle, 5 assertions |

**Recommendation for the team:** add an integration check that hits `POST /payroll/runs` (or
`/attrition/runs`) and asserts `state: "DONE"` within N seconds — not just that the job
*enqueues*. That's the gap that let this ship silently broken for a full session.

---

## 10. Addendum — 12 August 2026 — Increment 2 closed

Per ADR-001, Increment 2 is not done until every function it contains passes its acceptance
criteria. Three were open at the start of this pass: **F2.2** (self-service contact update,
US-09), **F2.5** (HR-managed employee documents, US-12), and **F4.4** (in-app leave
notifications, US-21/US-22). All three now ship.

### F2.2 — Employee self-service contact update

`POST /api/me/contact` accepts only `phone` / `address` / `emergencyContact`; designation,
department and employee code stay server-authoritative — an employee cannot promote or
relocate themselves by editing their own profile. HR sees the change immediately, no approval
step, matching US-09's stated flow.

- **Verified:** `bughunt.mjs` BUG-05 (3 assertions: update succeeds, read-only fields are
  unchanged, HR sees it immediately) and a real UI pass (Playwright).

### F2.5 — Employee documents

`POST/GET /api/employees/:id/documents` (HR-only upload, self-or-HR read). Files travel as
base64 inside the existing JSON API rather than adding multipart handling for one feature;
`ALLOWED_DOCUMENT_TYPES` (PDF/JPEG/PNG) and a 5 MB cap are enforced server-side, not just in
the file picker. Storage is a BLOB column on `employee_document` — a deliberate choice, since
the SQLite file itself is already ephemeral on the free-tier host, so a separate object-store
integration would add complexity without adding durability.

- **Verified:** `bughunt.mjs` BUG-19 (5 assertions: upload, type rejection, self-visibility,
  metadata completeness — type/date/uploader, and denial to a non-HR non-owner role).

### F4.4 — In-app leave notifications

`GET /api/notifications`, `POST /api/notifications/read`. A manager is notified when a direct
report submits leave; the employee is notified when their manager decides it, carrying the
stated reason. Building this surfaced a genuine gap in the existing acceptance criteria for
US-19 that nothing had caught: **nothing stopped a rejection from being submitted with no
reason**, even though the story requires the employee to see why. Fixed alongside F4.4 by
making `reason` mandatory on `REJECT` decisions (`400` without it) — not a new feature, a
missing enforcement of an existing one.

- **Verified:** `bughunt.mjs` BUG-20 (rejection without a reason is refused; the employee's
  notification carries the stated reason) and a full real-account Playwright run: Arif submits
  leave → his manager Shabnam gets a badge and a panel entry → clicking it opens `/leave` →
  rejecting without a reason is blocked by the UI → rejecting with one clears Shabnam's
  notification and Arif receives a decision notification quoting it.

### BUG-21 — Severity: Medium · UI defect found during F4.4 verification

> **The notification panel's click-outside-to-close overlay blocked clicks on unrelated page
> elements, including Sign out.**

`NotificationBell` used a full-screen `position: fixed; inset: 0` transparent "scrim" div to
detect an outside click and close the panel — a common pattern, but it assumes the element
underneath participates in the same stacking context. The app's sidebar does not: at desktop
width it has no `position`/`z-index` of its own, so the scrim (`z-index: 90`) sat above it and
silently swallowed the first click on anything else on the page while the panel was open,
including the Sign-out button.

- **Detected:** not by `bughunt.mjs` (API-level checks can't see this — there's no HTTP
  request that fails). Found by the real-account Playwright pass above, which continued
  past reading the notification into signing out, and the sign-out click never registered.
- **Fix:** replaced the scrim div with a `document.addEventListener('mousedown', …)`
  click-outside handler scoped to the panel's wrapper ref. The outside click now reaches its
  real target instead of being intercepted first.
- **Re-verified:** the same Playwright script, re-run end to end, now signs out cleanly after
  interacting with the notification panel.
- **Lesson recorded:** this class of bug is invisible to API-level adversarial testing by
  construction — it only exists in the DOM. It is the reason this project keeps a real
  browser-driven verification pass as a required step for any UI-facing function, not just
  the HTTP contract.

### Updated function coverage (§5) and not-yet-implemented list (§4)

F2 and F4 both moved from partial to 5/5. Total function coverage: **31 / 43 (72%)**.
Increments 1 and 2 are now both fully closed under ADR-001; Increment 3 (F5.3 real PDF
generation, F6 OKR, F7 ATS, F8.2/F8.3) is the only remaining open scope.

### Updated regression protection (§7)

| Defect | Permanent test |
|---|---|
| — (F2.2) | `bughunt.mjs` BUG-05 — self-update, read-only enforcement, HR visibility |
| — (F2.5) | `bughunt.mjs` BUG-19 — upload, type rejection, visibility, metadata, access denial |
| — (F4.4 / US-19 reason gap) | `bughunt.mjs` BUG-20 — reason-required rejection, decision notification |
| BUG-21 | Playwright end-to-end script (`verify-notif-real-manager.mjs`) exercises the full notification → sign-out path |
