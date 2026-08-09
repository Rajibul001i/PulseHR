# Risk Register

Reviewed at every increment retrospective (ADR-001). Neither source document contains a
risk register, despite proposal §5.1 committing to *"a risk register checked at every sprint
retrospective."*

**Exposure = Probability × Impact**, each 1–5.

---

## Live risks

| # | Risk | P | I | Exp | Mitigation | Owner |
|---|---|---|---|---|---|---|
| **R1** | **The AI module has no labelled training data**, so no model can be fitted during the project | 5 | 4 | **20** | Ship the expert-weighted scorecard (P0-4). The AI module is the final increment, so three increments of working software ship regardless. **Already mitigated by design.** | AI Engineer |
| **R2** | Field research (2 org visits, 50 surveys, 2 interviews) slips or under-delivers, leaving weights unfounded | 4 | 4 | **16** | Start outreach in **week 1**, not week 3. Fall back to published attrition literature for weights, and say so. Target 2 interviews, accept 1. | Team Lead |
| **R3** | Statutory figures (leave rates, OT base, holidays) are wrong in the delivered engine | 3 | 5 | **15** | All statutory values are **configuration, not code**. One nominated member verifies every figure against the consolidated Act before submission. | SQA Lead |
| **R4** | Scope: six modules in 8 weeks with 5 part-time student developers | 4 | 4 | **16** | Increment order puts Payroll and Leave first. OKR and ATS are the declared **cut line** if week 6 is behind. | Team Lead |
| **R5** | Schema change in Increment 3 breaks the shared demo environment | 3 | 3 | 9 | Forward-only numbered migrations from day one (ADR-007). | DBA |
| **R6** | Cross-tenant data leak | 2 | 5 | **10** | Repository injection + RLS + an automated cross-tenant test on every PR (NFR-14). | Backend |
| **R7** | Payroll produces a wrong number that reaches an employee | 2 | 5 | **10** | Pure engine, 26 boundary tests, totals asserted before insert, immutable payslips, engine version stamped. | SQA Lead |
| **R8** | Attrition score used for a termination or promotion decision | 3 | 5 | **15** | HR-only access, audit on every view, prohibited-use notice returned with every score, quarterly bias audit (spec §9). | AI Engineer |
| **R9** | Model produces biased output against a protected group | 3 | 4 | 12 | `review_score_delta` excluded from v1; lateness department-normalised; absence signal keyed on pattern not volume; quarterly audit with a 5-point trigger. | AI Engineer |
| **R10** | Team member unavailable (illness, exams) at a critical point | 3 | 3 | 9 | Every module has a named secondary. Nobody is the sole holder of any knowledge. | Team Lead |
| **R11** | Timezone bug corrupts attendance and payroll silently in production | 2 | 4 | 8 | Single `businessDate()` helper, explicit boundary tests, lint rule against raw ISO slicing (ADR-005). | Backend |
| **R12** | Free-tier hosting is throttled or withdrawn during the demo | 2 | 4 | 8 | Local `npm run dev` is the primary demo path; cloud is a bonus. Prototype runs with zero external services. | DevOps |
| **R13** | Instructor challenges the process-model inconsistency between documents | 4 | 3 | 12 | **Resolved** — ADR-001 with drop-in replacement text for both documents. | Team Lead |
| **R14** | Merge conflicts / lost work with 5 people in one repo | 3 | 2 | 6 | Feature branches, PR review, CI on every PR (P1-21). | Team Lead |
| **R15** | Demo data looks synthetic and unconvincing | 2 | 2 | 4 | Deterministic seeder with realistic Bangladeshi names, salary bands, and behaviour profiles that produce a plausible risk ranking. | Frontend |

## Top three by exposure

1. **R1 (20)** — mitigated by design. The honest cold-start answer is also the correct
   engineering one, and it converts the project's biggest weakness into its most defensible
   decision.
2. **R2 (16)** and **R4 (16)** — both are schedule risks under the team's own control.
   R2 needs action in week 1. R4 needs the cut line agreed **before** week 6, not during it.
3. **R3 (15)** and **R8 (15)** — one legal-accuracy risk, one ethical risk. Both are
   mitigated structurally (configuration; access control) rather than by promising care.

## Closed

| # | Risk | Closed by |
|---|---|---|
| C1 | Two documents named different process models | ADR-001 |
| C2 | Leave balance could go negative under concurrency | Ledger + transactional check, test-verified |
| C3 | Payslips unauditable | Line items + immutability trigger, verified |
| C4 | Terminated employee retains access | Revocable sessions (ADR-006), verified |
| C5 | Overtime overpaid by 67% | OT base fixed to basic + dearness, test-verified |
