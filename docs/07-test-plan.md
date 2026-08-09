# SQA Test Plan

**Resolves:** P1-21, P1-23, and the "10,000 dummy records" claim in proposal §6.2

---

## 1. Test levels

The deck (slide 33) already lists six levels correctly — that section is good and should
stay. What is missing is what each level actually *runs*, and an automated gate.

| Level | Technique | Where | Status in prototype |
|---|---|---|---|
| **Unit** | White-box | `packages/core/test/` | ✅ **86 tests passing** |
| **Integration** | Grey-box | `scripts/smoke.mjs` | ✅ **30 checks passing** |
| **System** | Black-box | End-to-end flows via the API | ✅ covered by smoke |
| **Acceptance** | Scenario | HR-manager scenarios per increment | Increment 2 onward |
| **Regression** | Automated | Full suite in CI on every PR | ✅ `.github/workflows/ci.yml` |
| **Performance** | Load | Seeded volume benchmarks | Increment 4 |
| **Security** | Black + white | Authn/authz, injection, tenancy | ✅ partly in smoke |

## 2. Unit tests — white-box (86 passing)

Proposal §6.5 promises boundary testing of the payroll engine and risk scorer. Here is what
is actually asserted.

### `payroll.test.ts` — 26 tests

Boundaries from [`04-payroll-spec.md`](04-payroll-spec.md) §10:

- OT rate computed on **basic + dearness**, not gross — with an explicit test demonstrating
  the **67% overpayment** the gross-based reading would cause (P1-2)
- Full-month LWP → net 0, payslip still issued with zero-valued lines
- LWP **and** OT in the same month — proration does not touch OT pay
- February divides by **28** (and leap-year 29), not a fixed 30
- OT beyond the §102 60-hour weekly ceiling → run **rejected**, not silently paid
- Stored totals always reconcile against the line items
- Rounding at each line, then summing — matching the printed payslip
- Salary structure in force at **period start**, so a mid-month revision does not apply
- Provident fund levied on **prorated** basic
- Invalid input rejected: LWP > days in month, negative OT, month out of range
- Money never floating point: `taka(0.1) + taka(0.2) === taka(0.3)`

### `leave.test.ts` — 25 tests

- Accrual **1 day per 18 days worked** (§117) — floor, not round: 17 days → 0, 18 → 1
- A full working year yields **20** days, explicitly asserted **not** to be the proposal's 21
- Mid-year joiner accrues proportionally
- Carry-forward capped at 40, with the lapsed amount reported
- Annual grants: casual 10 (§115), sick 14 (§116), festival 11 (§118), pro-rated
- Balance = SUM(ledger), respecting an as-of date, never mixing leave types
- **The concurrency case:** two requests each affordable alone, second rejected, balance
  never negative
- Overlapping approved leave rejected; another employee's leave ignored
- LWP not drawn from any balance

### `attrition.test.ts` — 22 tests

- Feature weights total exactly 100 (asserted at module load, too)
- **`review_score_delta` is asserted absent** from the feature set (P1-5 bias laundering)
- Score is an integer 0–100, never 0–1 (P1-17)
- Contributions sum to the composite score
- Tenure milestone peaks at 12 and 24 months; a 2-month joiner is **not** flagged as
  "approaching 12"
- Lateness is department-normalised — a team with a shared commute problem is not uniformly
  flagged
- precision@k, base rate and lift reported; **`accuracy` asserted absent** (P1-15)
- **A no-signal model FAILS the acceptance criterion** — proving the criterion is real

### `dates.test.ts` — 13 tests

- A **23:30 Dhaka** check-in stays on the same business date; **00:30** rolls to the next
- An explicit test showing naive UTC slicing gets this wrong (P0-9)
- The 18:00 UTC boundary, exactly
- **Friday and Saturday are the weekend; Sunday is a working day**

## 3. Integration & system tests — 30 checks

`scripts/smoke.mjs`, run against a live API. Each maps to a defect from the review:

| Group | Verifies |
|---|---|
| Authentication | Login, wrong password, **no user enumeration**, unauthenticated refusal |
| **P0-5 tenancy** | Org B cannot list or directly fetch an org A employee |
| **P1-5 attrition access** | MANAGER and EMPLOYEE both refused the at-risk list; a score never returns without its contributions; contributions sum to the score; prohibited-use notice attached; no review-score feature |
| **P0-7 leave** | Both requests accepted while pending; first approval succeeds; **second returns 409**; balance never negative; overlap refused |
| **P0-8 payroll** | Payslip line-itemised; stored gross = Σ earning lines; net = gross − deductions; engine version stamped; an employee cannot read a colleague's payslip |
| **P1-19 sessions** | Refresh token single-use; reuse rejected; **logout revokes immediately** |

Separately verified at the database level: `UPDATE payslip` and `UPDATE payslip_line` are
both rejected by trigger, and the row is unchanged afterwards.

## 4. Performance testing — a real load model

**P1-23.** "Stress tests with over 10,000 dummy records" (proposal §6.2) is not a stress
test — PostgreSQL will not notice 10,000 rows. The dimension that hurts is **attendance
volume**.

| Scale | Employees | Attendance rows (3 yr) | Payslip lines (3 yr) | Scores (1 yr) |
|---|---|---|---|---|
| Small | 50 | 75,000 | 14,400 | 18,250 |
| **Target** | **500** | **750,000** | **144,000** | **182,500** |
| Stretch | 5,000 | 7,500,000 | 1,440,000 | 1,825,000 |

*(The prototype seeds 4,706 attendance rows across 26 employees over 180 days — a
correctness fixture, not a load test. Increment 4 scales the same seeder to the target
row counts.)*

| Scenario | Target | NFR |
|---|---|---|
| Monthly attendance grid, 500 employees × 31 days | p95 < 300 ms | NFR-1 |
| Payroll run, 500 employees | < 60 s in the worker | NFR-4 |
| Nightly scoring, 5,000 employees | < 5 min | NFR-5 |
| Dashboard top-20 at-risk | p95 < 300 ms | NFR-1 |
| 200 concurrent users | no degradation | NFR-6 |

## 5. Security testing

| Check | Method |
|---|---|
| SQL injection | Every query parameterised — asserted by code review; `'; DROP TABLE--` in every text input |
| Broken access control | Cross-role and cross-tenant matrix in the smoke suite |
| Session revocation | Terminate an employee → all tokens dead within 15 minutes |
| Password storage | scrypt N=16384; no plaintext or reversible hash anywhere |
| Rate limiting | 6 rapid login attempts → 429 |
| Dependency CVEs | `npm audit` in CI |
| Secrets | No credentials in git; `.env` git-ignored |

## 6. CI gate — P1-21

§6.4 requires code-review approval before merge, but nothing runs the tests. A reviewer
approving code that does not compile is a normal Friday.

`.github/workflows/ci.yml` runs on every PR:

1. `npm ci`
2. `npm run typecheck` — TypeScript strict across all three workspaces
3. `npm test` — the 86 unit tests
4. `npm run build` — the frontend must build
5. `npm audit --audit-level=high`

Branch protection requires all five green. **That** is a gate; a policy is not.

## 7. Acceptance criteria per increment

No increment is released until:

- every unit test passes
- the smoke suite passes
- the regression suite (all previous increments' tests) passes
- UML and SRS documents are updated to match what shipped
- the increment's acceptance scenarios are demonstrated to the stakeholder

## 8. Traceability

| Defect | Test that proves it fixed |
|---|---|
| P0-7 leave concurrency | `leave.test.ts` "case 10"; smoke "second approval is REJECTED" |
| P0-8 payslip audit | `payroll.test.ts` "case 11"; smoke payslip integrity; DB trigger check |
| P0-9 timezone | `dates.test.ts` "23:30 Dhaka check-in" |
| P1-1 accrual | `leave.test.ts` "18 days worked accrues exactly 1" |
| P1-2 OT base | `payroll.test.ts` "demonstrates the overpayment" |
| P1-5 score access | smoke "a MANAGER is refused the at-risk list" |
| P1-15 imbalance | `attrition.test.ts` "reports precision@k … never accuracy" |
| P1-16 bias | `attrition.test.ts` "deliberately EXCLUDES review_score_delta" |
| P1-17 score range | `attrition.test.ts` "is an integer 0-100" |
| P1-19 revocation | smoke "logout revokes the refresh token immediately" |
| P0-5 tenancy | smoke "org B cannot read an org A employee by direct id" |
