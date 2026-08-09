# ADR-001 — Software Process Model

**Status:** Accepted · **Revised 10 Aug 2026** — the Go/No-Go gate has been removed
**Resolves:** P0-1, P0-2, P0-3, P2-11, P2-12

---

## Decision

> **PulseHR is developed under the Incremental Process Model.**
> Four increments of two weeks each. Every increment ends with working, tested software.
> Scrum ceremonies provide the day-to-day operating rhythm.

That is the whole model. No stage gates, no prototype-evaluation checkpoint, no Go/No-Go
decision point.

### What changed in this revision, and why

The earlier version of this ADR added a **Go/No-Go gate** at the end of Increment 3, before
the AI module was built. That has been removed, for three reasons:

1. **It contradicted the team's own documents.** `PulseHR_Features_Functions.docx` states
   plainly: *"Because we follow the Incremental Process Model, every function listed here is
   delivered inside working, tested software at the end of its increment."* The Requirements
   Model says the same. Neither mentions a gate. A gate was an addition nobody asked for.
2. **It muddied a clean answer.** Under questioning, *"we use the Incremental Model"* is
   stronger than *"we use the Incremental Model, but with a prototyping technique inside
   Increment 3, gated by a checkpoint."* The second invites the question the first closes.
3. **Incremental already handles the risk it was meant to handle.** The AI module is the
   last increment. If it under-delivers, three increments of working software have already
   shipped. That *is* the risk control — bolting a formal gate on top added process without
   adding protection.

The AI module still has an **acceptance criterion**, as every increment does (§4). An
acceptance criterion is not a gate: it says what "done" means for a feature, it does not
create a decision point about whether to proceed.

## Why Incremental

| Criterion | Why Incremental satisfies it |
|---|---|
| **Fixed, immovable deadline** | 8 weeks, externally set. Working software at weeks 2, 4, 6 and 8 — if week 8 goes badly, three releases already exist. Waterfall gives one delivery at the end, or nothing. |
| **The system is genuinely modular** | The team's own feature breakdown is 9 features across 4 increments with clean seams. This is the textbook precondition for Incremental. |
| **Riskiest module goes last** | AI Attrition Risk (F9) is Increment 4. The platform ships regardless of how it performs. |
| **Five-person student team** | Low process overhead. Spiral's risk-analysis machinery would consume the schedule it exists to protect. |
| **Client-visible value mid-project** | By end of Increment 2 there is a usable HR system — which is also what the instructor sees at the midpoint. |

## Why not the others

The same six models must appear in the proposal and the deck.

| Model | Fits modular delivery? | Overhead | Verdict |
|---|---|---|---|
| **Waterfall** | Yes | Low | **Rejected.** Requirements frozen up front; one late delivery. A defect found in week 7 has nowhere to go. |
| **V-Model** | Yes | Medium | **Rejected.** Its test-pairing discipline is valuable, so we adopt that *practice* (see `07-test-plan.md`) without adopting the lifecycle — it still delivers once, at the end. |
| **Prototyping** | No | Low | **Rejected.** Built for projects whose requirements cannot be pinned down. Ours are specified: 9 features, 43 functions, 49 user stories with acceptance criteria. It is also silent on how the rest of the system gets built. |
| **Spiral** | Yes | High | **Rejected.** Risk-driven loops designed for large, long-running programmes. Disproportionate to a 5-person team over 8 weeks. |
| **Concurrent Development** | Yes | Medium | **Rejected.** Models the *states* activities move through realistically, but yields no delivery schedule a client or instructor can hold the team to. |
| **Incremental** | **Yes** | Low–Medium | **✅ Selected.** |

Scrum is deliberately **not** in this table. Scrum is a management framework, not a lifecycle
model; listing it as a competitor to Waterfall is a category error, and it is how the
original documents ended up with three different answers to the same question. It appears
below as the execution cadence.

## How Scrum fits

| Ceremony | Cadence | Purpose |
|---|---|---|
| Daily stand-up | 15 min, daily | Surface blockers early |
| Increment planning | Start of each increment | Fix the backlog and acceptance criteria |
| Increment review | End of each increment | Demo working software |
| Retrospective | End of each increment | Update the risk register (`09-risk-register.md`) |

## The four increments

Matching `PulseHR_Features_Functions.docx` and the Requirements Model exactly.

| # | Weeks | Features | Delivers |
|---|---|---|---|
| **1** | 1–2 | **F1** — Authentication & Role Management | Secured core: accounts, login/logout, RBAC, password reset, deactivation |
| **2** | 3–4 | **F2–F4** — Employee Records, Attendance, Leave | A usable HR system |
| **3** | 5–6 | **F5–F8** — Payroll, OKR, Recruitment, Noticeboard | Full operations suite |
| **4** | 7–8 | **F9** — AI Attrition Risk | Complete platform, released |

## Acceptance criteria, not gates

Each increment is **done** when every function it delivers passes its acceptance criteria
(the 49 user stories carry 3–4 each), the regression suite is green, and the increment is
demonstrated.

For Increment 4 specifically, the AI module's acceptance criterion is stated in
[`05-attrition-risk-spec.md`](05-attrition-risk-spec.md) §7: the scorecard must beat a
trivial tenure-based baseline on precision@10. If it does not, that is a **bug to fix inside
Increment 4**, handled like any other failing acceptance criterion — not a trigger for a
scope negotiation.

## Consequences

**Positive**

- One coherent story across every document, defensible in one sentence.
- Working software from week 4 onward; the project cannot fail to have a deliverable.
- No process machinery the team has to explain or justify.

**Negative / accepted**

- Incremental needs the architecture right early — a bad Increment-1 schema is expensive to
  change in Increment 3. Mitigated by forward-only migrations from day one (ADR-007).
- Regression cost grows with each increment. Mitigated by automated regression in CI from
  Increment 1.

---

# Drop-in replacement text

## Replaces proposal §5.4 (heading and opening)

> ### 5.4 Selected Process Model: The Incremental Model
>
> The engineering team has adopted the **Incremental Process Model** as PulseHR's governing
> lifecycle, executed through Scrum ceremonies as its day-to-day operating rhythm.
>
> The system decomposes naturally into nine features with clean interfaces between them, and
> the Incremental Model is designed for exactly this situation. Each increment applies all
> five framework activities — communication, planning, modeling, construction and deployment
> — to a defined subset of functionality, and each ends with working, tested software rather
> than a document promising it.
>
> Increment 1 delivers the secured core (Feature 1). Increment 2 delivers employee records,
> attendance and leave (Features 2–4), at which point the client already has a usable HR
> system. Increment 3 delivers payroll, performance management, recruitment and the
> noticeboard (Features 5–8). Increment 4 delivers the AI Attrition Risk module (Feature 9).
>
> Placing the AI module last is deliberate. It is the component carrying the most technical
> uncertainty, and the Incremental Model confines that uncertainty to the final increment:
> should it require more calibration than planned, three increments of working, tested
> software have already been delivered and the release is not placed at risk.

## Replaces proposal Table 2 (§5.3)

Use the six-row table under **"Why not the others"** above, verbatim. It differs from the
current Table 2 in four ways: V-Model and Concurrent Development are added, Scrum is removed
(not a lifecycle model), Prototyping's verdict changes to a plain rejection, and
**Incremental is the selected row**.

## Replaces deck slide 10 — "Prototyping" card

> **Prototyping** — *Rejected*
> Built for projects whose requirements cannot be pinned down in advance. Ours are specified
> — 9 features, 43 functions, 49 user stories with acceptance criteria — and prototyping is
> silent on how the remaining modules get built.

## Replaces deck slide 12, point 3

> **3 · The riskiest module can't sink the release**
> The AI engine is the final increment. If it needs more calibration time, three increments
> of working, tested software have already shipped and the platform is already usable.

## Replaces deck slide 29 — "Where this fits in the plan"

> Owns Feature 9 in Increment 4 — the behavioural signal model, its weighting, and the
> explainable output surfaced on the HR dashboard. Because the Incremental Model places this
> module last, its technical uncertainty is contained: the rest of the platform is already
> delivered and tested before this work begins.

## Replaces proposal §1 (process sentence)

> From an engineering perspective, the system will be developed over eight weeks in four
> increments under the Incremental Process Model, executed with Scrum ceremonies, following
> Pressman and Maxim's *Software Engineering: A Practitioner's Approach* (9th ed.).
