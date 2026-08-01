# ADR-001 — Software Process Model

**Status:** Accepted
**Date:** 2 August 2026
**Resolves:** P0-1, P0-2, P0-3, P2-11, P2-12

---

## Context

The proposal and the presentation currently name different governing process models, and
the presentation contradicts itself. The three descriptions in circulation are:

| Source | Model claimed |
|---|---|
| Proposal §1 | "prototype-driven process with Scrum" |
| Proposal §5.4 | Pressman & Maxim's **Recommended Process Model**, executed via Scrum |
| Deck slide 10 | **Incremental Model** |

Meanwhile deck slide 29 argues the model was chosen *"over plain incremental delivery"* —
while slide 10 says incremental *was* the choice.

One model has to win, and every document has to say the same thing.

---

## Decision

> **PulseHR is developed under the Incremental Process Model, with prototyping used as a
> risk-reduction technique inside Increment 3, gated by a documented Go/No-Go review.
> Scrum ceremonies provide the day-to-day operating rhythm.**

Three claims, in a deliberate order:

1. **Incremental is the *governing lifecycle*.** It determines what is delivered and when.
2. **Prototyping is a *technique*, not the lifecycle.** It is applied to exactly one
   module — the AI Attrition Risk engine — because that is the only component whose
   requirements cannot be fixed in advance.
3. **Scrum is the *cadence*.** Stand-ups, sprint reviews, retrospectives. It is how the
   team operates, not what the team delivers.

Confusing these three levels is precisely what produced the contradiction.

## Why Incremental wins

| Criterion | Why Incremental satisfies it |
|---|---|
| **Fixed, immovable deadline** | 8 weeks, externally set. Incremental delivers working software at weeks 2, 4, 6 and 8 — if week 8 goes badly, three releases already exist. Waterfall gives one delivery, at the end, or nothing. |
| **The system is genuinely modular** | Attendance, Leave, Payroll, Performance, ATS and the AI engine are separable with clean interfaces. This is the textbook precondition for Incremental. |
| **The riskiest module can be deferred last** | The AI engine is Increment 4. If it under-performs, the platform still ships. |
| **Five-person student team** | Low process overhead. Spiral's risk-analysis machinery would consume build time the team does not have. |
| **Client-visible value mid-project** | By end of Increment 2 there is a usable HR system to demo — which is also what the instructor sees at the mid-point. |

## Why prototyping is still needed — and why that is not a contradiction

The AI Attrition Risk module differs from every other module in one specific way: **its
requirements cannot be written down before something is built.** Nobody — not the team, not
the HR managers interviewed — can state in advance which behavioural signals predict
resignation in a Bangladeshi mid-sized firm, or how they should be weighted. That is an
empirical question.

Pure Incremental has no answer for this. It assumes each increment's requirements are
known when the increment starts. So Increment 3 carries a **throwaway spike**: a rough
scoring prototype built against seeded and interview-derived scenarios, evaluated as a
team, and then subjected to a **formal Go/No-Go decision** before Increment 4 commits its
entire capacity.

This is not a second process model. It is the standard practice of using a **spike** inside
an incremental lifecycle to retire a requirements risk — and it is exactly what Pressman &
Maxim describe when discussing evolutionary process models and the prototyping paradigm.

**The Go/No-Go criterion is written in advance** (see
[`05-attrition-risk-spec.md`](05-attrition-risk-spec.md) §8) so that it cannot be
rationalised after the fact:

> Increment 4 proceeds with the full scoring engine **only if** the Increment 3 spike
> achieves **precision@10 ≥ 3× the base rate** on the validation scenario set, **and** every
> score produced is explainable down to its individual feature contributions.
> If it does not, scope reduces to a **rule-based watchlist** — tenure milestones and
> unplanned-absence patterns only, no composite score — and Increment 4's spare capacity
> goes to hardening Payroll and the ATS.

Naming the fallback before you need it is what makes the gate real.

## Why not the others

Unified candidate set — **the same six models must appear in the proposal and the deck**:

| Model | Fits modular delivery? | Handles the AI uncertainty? | Overhead | Verdict |
|---|---|---|---|---|
| **Waterfall** | Yes | **No** — requirements frozen up front | Low | **Rejected.** One late delivery; a defect found in week 7 has nowhere to go. |
| **V-Model** | Yes | **No** — inherits Waterfall's rigidity | Medium | **Rejected.** Its test-pairing discipline is valuable, so we *adopt that practice* (see `07-test-plan.md`) without adopting the lifecycle. |
| **Prototyping (as governing model)** | **No** — silent on how the other five modules get built | Yes | Low | **Rejected as a lifecycle. Retained as a technique** inside Increment 3. |
| **Spiral** | Yes | Yes | **High** | **Rejected.** Its risk-analysis cycles are designed for large, long-running, high-stakes programmes. For a 5-person team over 8 weeks the overhead consumes the schedule it is meant to protect. |
| **Concurrent Development** | Yes | Partial | Medium | **Rejected.** It models the *states* activities move through realistically, but yields no delivery schedule a client or an instructor can hold the team to. |
| **Incremental** | **Yes** | **Yes, with a spike** | Low–Medium | **✅ Selected.** |

Scrum is deliberately **not** in this table. Scrum is not a lifecycle model; it is a
management framework. Listing it as a competitor to Waterfall is a category error, and it
is how the original documents ended up with three different answers. It appears instead as
the **execution cadence** below.

## How Scrum fits

| Ceremony | Cadence | Purpose here |
|---|---|---|
| Daily stand-up | 15 min, daily | Surface blockers early |
| Increment planning | Start of each 2-week increment | Fix the increment backlog and acceptance criteria |
| Increment review | End of each increment | Demo working software — this *is* the increment's release gate |
| Retrospective | End of each increment | Update the risk register (`09-risk-register.md`) |

Each increment ends with a release gate: all tests green
([`07-test-plan.md`](07-test-plan.md)) before the increment is declared done.

## The four increments

| # | Weeks | Delivers | Release gate |
|---|---|---|---|
| **1** | 1–2 | Requirements, SRS, ERD, migrations, wireframes, CI pipeline, walking skeleton (login → empty dashboard) | Skeleton deploys; CI green |
| **2** | 3–4 | Auth + RBAC, employees, departments, attendance, leave with approval workflow | Working core HR system, demoed |
| **3** | 5–6 | Payroll engine, OKR performance, ATS Kanban, **+ AI spike and Go/No-Go review** | Full ops suite; **Go/No-Go decision recorded** |
| **4** | 7–8 | AI engine hardened per the gate outcome, noticeboard, full SQA cycle, deployment | All suites green; production release |

Note the deliberate asymmetry: **Increment 3 carries the spike, Increment 4 carries the
consequences.** That gap is the entire point of the gate — a No-Go decision at end of week 6
still leaves two full weeks to execute the fallback.

## Consequences

**Positive**

- One coherent story across both documents, defensible under questioning.
- Working software exists from week 4 onward; the project cannot fail to have a deliverable.
- The AI risk is bounded by a pre-agreed, pre-written fallback.

**Negative / accepted**

- Incremental requires the architecture to be right early — a bad Increment-1 schema is
  expensive to change in Increment 3. Mitigated by forward-only migrations from day one
  (ADR-007) and by fixing the *core* schema early while leaving the AI module's data needs
  deliberately open.
- Regression cost grows with each increment. Mitigated by automated regression suites in CI
  from Increment 1 (P1-21).

---

# Drop-in replacement text

## Replaces proposal §5.4 heading and first paragraph

> ### 5.4 Selected Process Model: The Incremental Model, with a Prototyping Spike for the AI Module
>
> The engineering team has adopted the **Incremental Process Model** as PulseHR's governing
> lifecycle, executed through Scrum ceremonies as its day-to-day operating rhythm, with
> **prototyping applied as a targeted technique** within Increment 3 to retire the one
> requirement the team cannot specify in advance.
>
> The distinction matters and is deliberate. The Incremental Model determines **what is
> delivered and when**: four working releases at weeks 2, 4, 6 and 8, each adding whole
> modules to a system that already runs. Prototyping is **not** a competing lifecycle here —
> it is a technique applied to a single component, the AI Attrition Risk engine, whose
> behavioural variables and weightings cannot be fixed until interview data and real
> attendance patterns have been examined. Scrum is neither of these; it is the **management
> cadence** by which the increments are executed.
>
> Concretely, Increment 3 builds a throwaway scoring spike against seeded and
> interview-derived scenarios, evaluates it against a **pre-written acceptance criterion**,
> and records a formal **Go/No-Go decision** before Increment 4 commits its capacity. If the
> spike fails the criterion, Increment 4 delivers a reduced rule-based watchlist instead,
> and the recovered capacity hardens the Payroll and ATS modules. Naming that fallback in
> advance is what makes the gate a genuine decision point rather than a formality.

## Replaces proposal Table 2 (§5.3 Comparative Summary)

Use the six-row table under **"Why not the others"** above, verbatim. It differs from the
current Table 2 in four ways: V-Model and Concurrent Development are added, Scrum is
removed (it is not a lifecycle model), Prototyping's verdict is changed from *"Insufficient
alone"* to *"Rejected as lifecycle, retained as technique"*, and **Incremental is the
selected row**.

## Replaces deck slide 10, "Prototyping" card

> **Prototyping** — *Not as a lifecycle*
> Excellent for retiring unclear requirements, but silent on how the other five modules get
> built. **Retained as a technique inside Increment 3** for the AI engine — not adopted as
> the governing model.

## Replaces deck slide 12, point 3

> **3 · The riskiest module can't sink the release**
> The AI engine is prototyped in Increment 3 and hardened in Increment 4, behind a written
> Go/No-Go gate. If it misses its acceptance criterion, we ship a rule-based watchlist
> instead — and three increments of working, tested software have already been delivered.

## Replaces deck slide 29, "Where this fits in the plan"

> Owns the Increment 3 prototype spike, its evaluation, and the Go/No-Go review that
> follows — **the reason Increment 3 carries an explicit gate rather than flowing straight
> into Increment 4**. If the prototype doesn't clear its pre-written acceptance criterion,
> this is the checkpoint that reduces scope before the final increment starts.

## Replaces proposal §1, sentence 4 of the final paragraph

> From an engineering perspective, the system will be developed over eight weeks in four
> increments under the Incremental Process Model, executed with Scrum ceremonies, following
> Pressman and Maxim's *Software Engineering: A Practitioner's Approach* (9th ed.).

*(The current wording — "a prototype-driven process with Scrum" — is a third, separate
description of the process and must be replaced.)*
