# Team Responsibilities, Backend Architecture & Project Governance

**Owner:** Md. Rajibul Islam Rabbi — Team Lead & Backend Architect
**Covers:** who owns what, the backend design, how we work, and increment status

---

## 1. Responsibility matrix

Every one of the 9 features has a **single accountable owner**. Shared ownership of a module
means nobody owns it.

| Member | Role | Owns | Documentation |
|---|---|---|---|
| **Md. Rajibul Islam Rabbi** | Team Lead & Backend Architect | Project governance, API design, F1 authentication, worker/job architecture | This document, [`02-architecture.md`](02-architecture.md), [`06-api-contract.md`](06-api-contract.md) |
| **Md. Rayhan Babu Emon** | Frontend UI/UX Developer | All 16 screens, React SPA, Redux state, subscription-aware shell | [`12-ui-modernisation.md`](12-ui-modernisation.md) |
| **Md. Jakariya** | Database Administrator | Schema, normalisation, indexing, migrations, query performance | [`14-data-layer.md`](14-data-layer.md), [`03-data-model.md`](03-data-model.md) |
| **Md. Nuraafrid Rouf** | AI Algorithm & Logic Engineer | F9 attrition engine, weighting, calibration, evaluation | [`15-model-card.md`](15-model-card.md), [`05-attrition-risk-spec.md`](05-attrition-risk-spec.md) |
| **Md. Muradujjaman** | SQA Lead & Documentation Specialist | Test strategy, defect management, UML, formal documentation | [`13-sqa-defect-report.md`](13-sqa-defect-report.md), [`07-test-plan.md`](07-test-plan.md) |

> **Naming note:** the proposal spells this member **Muradujjaman** in Table 0 and
> **Munadujjaman** in Appendix E; the deck uses both. It appears in at least six places
> across the submission. Settle the correct spelling and make it consistent — it is a
> person's name on a graded document.

### Feature ownership

| Feature | Increment | Owner | Status |
|---|---|---|---|
| F1 Authentication & Roles | 1 | Rabbi | ⚠️ **4/5** — F1.4 password reset missing |
| F2 Employee Information | 2 | Jakariya + Rayhan | 3/5 |
| F3 Attendance | 2 | Rabbi | ✅ 5/5 |
| F4 Leave | 2 | Rabbi + Rayhan | 4/5 |
| F5 Payroll | 3 | Rabbi | 4/5 |
| F6 Performance (OKR) | 3 | Rayhan | ⬜ 0/4 |
| F7 Recruitment (ATS) | 3 | Rayhan | ⬜ 0/5 |
| F8 Noticeboard | 3 | Rayhan | 2/4 |
| F9 Attrition Risk | 4 | Rouf | ✅ 5/5 |
| Subscription & entitlement | — | Rabbi | ✅ Built |

**27 of 43 functions implemented (63%).**

---

## 2. Backend architecture

### Shape

```
React SPA  ──HTTPS/JSON──▶  API process (Express)  ──job queue──▶  Worker process
                                    │                                    │
                                    └────────┬───────────────────────────┘
                                             ▼
                              @pulsehr/core  (pure domain logic)
                                             │
                                             ▼
                                 PostgreSQL (SQLite in prototype)
```

### The three decisions that shaped it

**1. Layered monolith, not microservices (ADR-002).**
Five developers, eight weeks. Payroll needs ACID transactions *across* employees, leave and
salary structures — exactly what service boundaries make hard. The worker split is the seam
along which the first service would be extracted if we ever needed one.

**2. Long work runs in a worker, never in the API (ADR-004).**
Our proposal claimed Node's async I/O made it good at concurrent payroll. That is backwards:
month-end payroll is **CPU- and database-bound**, and Node executes JavaScript on a **single
thread**. A payroll run over 10,000 employees inside the API process blocks the event loop
and hangs every other request.

Payroll and nightly scoring are **jobs**. The API returns `202 Accepted` with a job id.

The honest reasons to choose Node here: one language across the stack for a five-person
team, the largest package ecosystem, and genuinely good I/O concurrency for the
*interactive* workload — many small dashboard requests that mostly wait on the database.

**3. The domain core is pure (ADR-008).**
Payroll, leave accrual, attrition scoring and date handling are **pure functions**: no
database, no network, no clock. Time and randomness are injected.

Money and a score that affects people are the two things that must be provably correct. Pure
functions are exhaustively testable at boundaries with no fixtures or containers — which is
the only reason the white-box testing our SQA plan promises is actually feasible. 102 unit
tests run in under 4 seconds, so CI can run the full suite on every PR.

### API conventions

| Status | Meaning |
|---|---|
| `202` | Queued as a job — poll `/jobs/{id}` |
| `402` | **Plan does not include this** — render an upgrade prompt |
| `403` | Role does not permit this — never |
| `404` | Not found **or not in your tenant** (deliberately indistinguishable) |
| `409` | Business-rule conflict — insufficient balance, overlapping leave, duplicate check-in |

**402 vs 403 matters.** `403` means "you will never have this"; `402` means "your
organisation could buy this". Only the second should produce an upgrade prompt, and the
client cannot tell them apart if we collapse both into 403.

**404 vs 403 for cross-tenant reads.** Returning 403 would confirm the resource exists in
some other tenant. 404 leaks nothing.

---

## 3. How we work

### Process

**Incremental Process Model**, executed with Scrum ceremonies. Four increments of two weeks.
No stage gates — see [`01-process-model-decision.md`](01-process-model-decision.md).

An increment is **done** when every function it delivers passes its acceptance criteria, the
regression suite is green, and it has been demonstrated.

### Version control

| Rule | |
|---|---|
| Branching | `feature/*` → `develop` → `main` |
| Merge | Pull request only; no direct pushes to `develop` or `main` |
| Review | One approval required; the Team Lead reviews anything touching payroll or auth |
| CI | Typecheck, unit tests, build, seed, jobs, smoke, bug hunt — all must pass |

**CI is the gate, not the review.** A reviewer approving code that does not compile is a
normal Friday. Branch protection requires the workflow green.

### Definition of Done

A function is done when it: has an implementation; has a test that fails without it; is
traceable to its user story and acceptance criteria; passes the regression suite; and has
its documentation updated in the same PR.

---

## 4. Increment status

### Increment 1 — Authentication & Roles · ⚠️ **NOT CLOSED**

| Function | Status |
|---|---|
| F1.1 User registration | ✅ |
| F1.2 Login / logout | ✅ Short-lived JWT + revocable refresh sessions |
| F1.3 Role-based access control | ✅ Route + repository layer |
| **F1.4 Password reset** | ❌ **Not implemented** |
| F1.5 Account deactivation | ✅ Revokes all sessions |

**Increment 1 cannot be signed off.** Under the Incremental Model an increment is done when
*all* its functions pass. F1.4 has not been built. Recording this rather than quietly
carrying it forward is the discipline the model requires — and it is a one-day task.

**Action:** Rabbi to implement F1.4 before Increment 3 review.

### Increment 2 — Employee, Attendance, Leave · Substantially complete

Gaps: F2.2 employee self-service contact update, F2.5 document storage, F4.4 in-app
notifications.

### Increment 3 — Payroll, OKR, ATS, Noticeboard · In progress

Payroll ✅ (F5.3 currently print-to-PDF rather than generated PDF). OKR and ATS not started —
these are the declared **cut line** if the schedule slips.

### Increment 4 — Attrition Risk · Complete

All five functions built, 22 unit tests. Outstanding: the employee-facing score request /
contest endpoint and the quarterly bias audit, both specified.

---

## 5. Risk position

Top three by exposure, from [`09-risk-register.md`](09-risk-register.md):

| Risk | Position |
|---|---|
| **AI module has no labelled training data** | **Mitigated by design** — expert scorecard with a written promotion criterion. The project's biggest weakness became its most defensible decision. |
| **Scope: 6 modules, 8 weeks, 5 part-time developers** | **Live.** 63% of functions built. OKR and ATS are the agreed cut line — decide *before* week 6, not during it. |
| **Statutory figures wrong in the payroll engine** | **Mitigated structurally** — every Labour Act value is configuration, not code. **Still requires one member to verify each figure against the consolidated Act before submission.** |

---

## 6. What I would tell the instructor

The most valuable thing this project did was **review its own proposal before writing code**.
That found 45 defects, nine blocking — including an overtime formula that would have
overpaid every overtime hour by 67%, an AI module designed to train on data that would not
exist, and an ERD with no tenant key.

The second most valuable thing was **testing the build against our own user stories rather
than against our own assumptions**. That found 16 more defects in a codebase where every one
of 132 tests was passing — two of them security holes, including one where any employee could
read the entire company's attendance records.

Both findings point the same way: the expensive defects are not in the code you are looking
at. They are in the gap between what you wrote down and what you built.
