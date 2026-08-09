# Model Card — PulseHR Attrition Risk Engine v1.0.0-scorecard

**Owner:** Md. Nuraafrid Rouf — AI Algorithm & Logic Engineer
**Feature:** F9 · Increment 4 · Functions F9.1 – F9.5
**Implementation:** `packages/core/src/attrition.ts` · 22 unit tests
**Design rationale:** [`05-attrition-risk-spec.md`](05-attrition-risk-spec.md)

A model card states plainly what a model does, what it does not do, and where it should not
be used. For a system that scores people's likelihood of leaving their job, that is not
optional documentation.

---

## 1. What this is — stated without inflation

**A transparent, expert-weighted scorecard. Not a trained machine-learning model.**

Eight behavioural signals, each normalised to `[0,1]`, multiplied by a fixed weight, summed
to an integer `0–100`.

Calling it "AI" is defensible only in the broad decision-support sense. The honest framing,
and the one to use in the viva:

> *A transparent, explainable risk model, designed to be replaced by a learned model once
> labelled data exists.*

### Why not the logistic regression the proposal named

Our proposal specified logistic regression, and the deck said weights come from *"historical
correlation with resignations."*

**A new PulseHR installation has zero historical resignations.** There is no `y` to regress
against. Our 50-respondent survey and two HR-manager interviews produce **opinions**, not
labelled separation events. No amount of feature engineering creates a label that does not
exist.

Shipping a scorecard is not the easy option — it is the only correct one without labels, and
it has a property the regression would not: **it is auditable.** An HR manager can be shown
exactly why a number is what it is.

---

## 2. Intended use

| | |
|---|---|
| **Intended** | Prioritising which employees HR should have a retention conversation with |
| **Users** | HR personnel only — never the employee's line manager (enforced in code) |
| **Cadence** | Nightly batch, 02:00 Asia/Dhaka, in the worker process |
| **Output** | Integer 0–100 + band + per-feature contributions, always together |

### Out-of-scope uses — prohibited, and stated in-product

Using a score as an input to **termination, promotion, appraisal or compensation** decisions
is a prohibited use. It is returned with every API response and displayed above every score
in the UI.

**Why this is a hard rule.** An HRIS that flags employees as "likely to quit" and shows it
to their manager produces two predictable harms:

- **Retaliation** — the flagged employee is quietly passed over for projects and training.
- **Self-fulfilling prophecy** — being treated as a flight risk *causes* the exit, and the
  model then looks accurate.

---

## 3. Target variable

> **`P(voluntary separation within 90 days)`**, expressed as an integer 0–100.

| Aspect | Definition |
|---|---|
| Event | Employee-initiated resignation |
| **Excluded** | Termination, redundancy, contract expiry, retirement, death |
| Horizon | 90 days from scoring date |
| Range | **0–100 integer** (the proposal said 1.0, the deck said 0–100 — resolved to 0–100) |

Involuntary separations are excluded because predicting them predicts *management's*
behaviour, not the employee's — and including them would train the system to flag people
management already dislikes.

---

## 4. Features and weights

| # | Feature | Window | Weight | Normalisation |
|---|---|---|---|---|
| F1 | `tenure_milestone_proximity` | — | **25** | Gaussian bump at 12/24/36 months, σ=2; zero below 6 months |
| F2 | `unplanned_absence_pattern` | 90 d | **20** | Linear ramp 0→4 weekend-adjacent single-day absences |
| F3 | `lateness_trend_z` | 60 vs prior 60 d | **15** | One-sided z-score within department, over 0–3σ |
| F4 | `leave_balance_drawdown` | 90 d | **15** | Ramp 0.2→0.6 of opening balance consumed |
| F5 | `no_recent_promotion_or_raise` | 24 mo | **10** | Ramp 12→24 months since last increase |
| F6 | `manager_change_recent` | 180 d | **5** | Linear decay to zero at 180 days |
| F7 | `overtime_sustained` | 90 d | **5** | Ramp 10→40 OT hours/month |
| F8 | `okr_engagement_drop` | 2 cycles | **5** | Proportional fall in self-set goal activity |

Weights sum to exactly 100 — **asserted at module load**, so a future edit that breaks the
invariant fails immediately rather than silently rescaling every score.

### How the weights were set

They are **elicited, not fitted**. Sources, in order of influence:

1. HR-manager interviews — which signals practitioners report noticing before a resignation
2. Objectivity — signals derived from system records (tenure, salary history, manager
   changes) are weighted above self-reported or subjective ones
3. Gameability — a signal an employee could trivially manipulate is weighted down

F1 carries the largest weight because it is the best-evidenced, least gameable and most
objective signal available. F6–F8 are deliberately small: plausible, but weakly evidenced.

**This is a v1 prior, not a finding.** Weights are versioned with the engine
(`1.0.0-scorecard`) and every score records the version that produced it, so a re-weighting
is traceable.

---

## 5. What we deliberately excluded, and why

### `review_score_delta` — the signal our own documents list first

`PulseHR_Features_Functions.docx` states:

> **F6.3** — *"Records the manager's review score each quarter — **a direct input to the AI
> risk model**."*
> **F9.1** — gathers *"…**review-score dips**."*

**It is excluded from v1.** The reason comes from our own proposal:

- §3a: existing performance reviews in local firms are distorted by *"favoritism or bias"*
- §4b: PulseHR will *"remove human bias, subjectivity, and favoritism from performance
  review scores"*

Feeding those same scores into the risk model would **launder an acknowledged human bias
into an algorithmic output that looks objective**. The model would inherit the prejudice and
lend it a number — and a number is much harder to argue with than a manager's opinion.

**Readmission condition:** a bias audit showing review scores are statistically independent
of gender and department after controlling for role.

> **This is a conflict between the implementation and F6.3/F9.1 as written.** It is flagged
> in the SQA report for a team decision, not resolved silently. My recommendation is to
> amend F6.3/F9.1 and record the reasoning — spotting a fairness problem in your own design
> is a stronger position than shipping it.

### Raw leave clustering

The deck lists *"short-leave clustering"*. Replaced by F2. Counting leave volume penalises
employees who are genuinely ill or caring for family, and systematically disadvantages
parents and people with chronic conditions. F2 targets the **pattern** associated with
interviewing — a single day adjacent to a weekend — not the amount of illness.

---

## 6. Evaluation

### Metrics — and the one we refuse to report

**Accuracy is never reported.** At a ~3% base rate per 90-day window (12% annual turnover), a
model predicting "nobody leaves" scores **97% accurate**. Accuracy in an SQA report signals
that the team has not understood the problem.

| Metric | Why |
|---|---|
| **precision@10** *(primary)* | An HR team can hold roughly ten retention conversations a month. Whether the top ten are right is the only question that maps to the real operating constraint. |
| recall@threshold | Guards against a model that is precise but flags almost nobody |
| Base rate | Always alongside — precision@10 of 30% means nothing until you know the base rate |
| Lift over baseline | Against *"flag everyone at 11–13 months' tenure"*. If we cannot beat that, we have no value |

### A correction made during development

Our first `precision@k` implementation broke ties by **array order**. A degenerate model
assigning every employee an identical score "ranked" them by database order and scored a
perfect 1.0 — passing the acceptance criterion with no signal whatsoever.

Fixed with **expected precision under random tie-breaking**: items strictly above the cut-off
count in full; items tied at the cut-off share remaining slots proportionally. A no-signal
model now returns exactly the base rate, lift 1.0, and correctly fails.

Recorded because a metric that cannot fail is not a metric.

### Acceptance criteria (Increment 4)

> F9 is accepted when **both** hold:
> 1. precision@10 ≥ **3× base rate** on the held-out validation set
> 2. every score decomposes into contributions summing to the total
>
> Both asserted automatically; `evaluate()` returns `meetsAcceptance`.

These are **acceptance criteria, not a stage gate** — ADR-001 selects a plain Incremental
lifecycle. A miss is a bug to fix inside Increment 4.

### Validation set

40 hand-constructed scenarios derived from HR-manager interviews — 12 *resigned within 90
days*, 28 *stayed*. Constructed **before** weights were tuned and held out during tuning.

> **Limitation, to be stated plainly in the viva:** 40 synthetic scenarios validate that the
> engine behaves as HR experts expect. They do **not** establish real-world predictive
> accuracy. That requires production data over 2–3 years. Claiming validated prediction from
> 40 constructed cases invites a challenge we would lose — and the honest version is more
> impressive.

---

## 7. Path to a learned model (v2)

```
v1 scorecard ──── collects labelled outcomes ────▶ v2 logistic regression
                  (score + features + actual
                   separation, voluntary flag)

UNLOCK CONDITION:  >= 80 voluntary separation events
                   (10 events per predictor x 8 predictors)
              AND  v2 beats v1 on precision@10 on a held-out period
```

**80 events is 2–3 years of data from a 300-person customer** at 12% annual turnover
(~36 events/year). Stating that plainly is more credible than implying a model will be
trained in week 7.

Encoded as `MODEL_ACCEPTANCE.minSeparationEventsForRegression` and unit-tested, so the bar
cannot quietly move.

---

## 8. Known limitations

1. **Not validated on real outcomes.** No production separations have been observed.
2. **Most flags will be false.** At a 3% base rate, even a good model's top-10 is mostly
   false positives. Acceptable *only* because the intervention — a conversation — is
   low-cost and benign. It would not be acceptable for any consequential decision.
3. **Weights are opinions.** Well-sourced opinions, but priors, not findings.
4. **Cold start.** An employee with under 90 days of data scores on partial features.
5. **F8 is inert today.** The OKR module (F6) is Increment 3 and not yet built, so
   `okrUpdates*` are zero for every employee — 5 of 100 points are currently unreachable.
   Documented rather than hidden.
6. **Culturally unvalidated.** Signals are drawn from HR practice plus general literature.
   Whether they hold in Bangladeshi mid-market firms is exactly what production data will
   tell us.

---

## 9. Fairness

| Control | Status |
|---|---|
| Most bias-prone input (review scores) excluded | ✅ Implemented, unit-asserted |
| Health-proxy signal replaced with a behavioural pattern | ✅ Implemented |
| Lateness normalised within department | ✅ Implemented — a shared commute problem cannot flag a whole team |
| Score visible to HR only | ✅ Enforced at route and repository |
| Every view audited | ✅ |
| Contributions returned with every score | ✅ Enforced — the API cannot return one without the other |
| Employees may request and contest their score | ⬜ `contested` column exists; endpoint not built |
| Quarterly bias audit across gender/department/tenure | ⬜ Specified, Enterprise tier, not built |

The two unbuilt items are the **most important remaining work on this feature**. A model
with fairness controls specified but not implemented is not yet a fair model.

---

## 10. Reproducibility

- Pure functions, no clock, no randomness, no I/O — same input, same output, always
- Engine version stamped on every stored score
- Feature values persisted alongside contributions, so any historical score can be re-derived
- 22 unit tests, including the assertion that `review_score_delta` is **absent** from the
  feature set — so it cannot be reintroduced without a test failing
