# AI Attrition Risk Module — Engineering Specification

**Resolves:** P0-4, P1-5, P1-13, P1-14, P1-15, P1-16, P1-17
**Status:** v1 design, implemented in `packages/core/src/attrition.ts`

---

## 1. The problem the source documents didn't solve

The deck says signals are *"weighted by historical correlation with resignations."* The
proposal says the method is *"logistic regression."*

**A new PulseHR installation has zero historical resignations.** There is no `y`. You cannot
fit a regression, and the 50-person survey plus two HR interviews yield opinions rather than
labelled separation events.

This is not a small gap — it sits directly beneath the feature the product is sold on. It
has to be answered before Increment 3, and the answer determines what gets built.

## 2. The answer: earn the model

**v1 is a transparent expert-weighted scorecard.** Not because it is easier, but because it
is the only correct thing to ship without labels — and because it is **auditable**, which a
fitted regression is not.

The system is designed from day one to collect the data that would let it become a learned
model later, and the promotion criterion is written now so it cannot be fudged later.

```
   ┌─────────────────────────────────────────────────────────────────┐
   │  v1 — Expert scorecard          (ships in Increment 4)          │
   │  weights from HR interviews · documented · versioned            │
   └───────────────────────────────┬─────────────────────────────────┘
                                   │ collects labelled outcomes
                                   ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  v2 — Fitted logistic regression                                │
   │  UNLOCKED ONLY WHEN: ≥ 80 voluntary separations observed        │
   │  (10 events per predictor × 8 predictors)                       │
   │  AND v2 beats v1 on precision@10 on a held-out period           │
   └─────────────────────────────────────────────────────────────────┘
```

**≥ 80 events** comes from the standard events-per-variable rule of thumb: roughly 10
outcome events per predictor for a stable logistic fit. At a 12% annual voluntary turnover
rate, a 300-person customer produces ~36 events a year — so **v2 is realistically two to
three years away.** Saying that plainly is more credible than implying a model will be
trained in week 7.

## 3. Target variable

**Resolves P1-13.** "Attrition risk" is undefined without a horizon.

> **`P(voluntary separation within 90 days)`**, expressed as an integer **0–100**.

| Aspect | Definition |
|---|---|
| Event | Employee-initiated resignation |
| **Excluded** | Termination, redundancy, contract expiry, retirement, death |
| Horizon | 90 days from the scoring date |
| Unit | One score per employee per night |
| Range | **Integer 0–100** — resolves P1-17 (proposal said 1.0, deck said 0–100) |

Involuntary separations are excluded from the label because predicting them is predicting
*management's* behaviour, not the employee's — and because including them would train the
system to flag people management already dislikes.

## 4. Feature set (v1)

**Resolves P1-16.** Two of the four signals in the source documents are perverse and are not
shipped as described.

| # | Feature | Window | Weight | Rationale |
|---|---|---|---|---|
| F1 | `tenure_milestone_proximity` | — | **25** | Strongest, best-evidenced, least gameable signal. Resignation risk spikes near the 12-month and 24-month marks. |
| F2 | `unplanned_absence_pattern` | 90 d | **20** | Single-day unplanned absences **adjacent to a weekend**. A behavioural pattern (interviewing), not a health proxy. |
| F3 | `lateness_trend_z` | 60 d vs prior 60 d | **15** | Change in lateness, **z-scored within department** so a team with a common commute problem isn't uniformly flagged. |
| F4 | `leave_balance_drawdown` | 90 d | **15** | Rapidly consuming accrued leave often precedes exit. |
| F5 | `no_recent_promotion_or_raise` | 24 mo | **10** | Compensation stagnation. Objective, from the salary-structure history. |
| F6 | `manager_change_recent` | 180 d | **5** | "People leave managers." Objective, from the org history. |
| F7 | `overtime_sustained` | 90 d | **5** | Sustained OT above a threshold — burnout proxy. |
| F8 | `okr_engagement_drop` | 2 cycles | **5** | Drop in *self-set* OKR activity — behavioural, distinct from a manager's rating. |
| | **Total** | | **100** | |

### Explicitly excluded from v1

**`review_score_delta`** — the signal the deck lists first.

The proposal states elsewhere that existing performance reviews are corrupted by *"favoritism
or bias"*, and separately promises to *"remove human bias, subjectivity, and favoritism from
performance review scores."* Feeding those same scores into the risk model would **launder
that bias into an algorithmic output that looks objective** — the model would inherit the
prejudice and lend it a number.

It is admitted to v2 only once a bias audit shows review scores are statistically
independent of gender and department after controlling for role. That test is specified in
§9.

**Raw leave clustering** — replaced by F2. "Clusters of short leaves" penalises employees
who are genuinely ill or caring for a family member, systematically disadvantaging parents
and people with chronic conditions. F2 targets the specific *pattern* associated with
interviewing (a single day adjacent to a weekend) rather than illness volume.

## 5. Scoring

Each feature produces a normalised sub-score in `[0, 1]`, multiplied by its weight and
summed:

```
score = round( Σ (fᵢ.normalised × fᵢ.weight) )     clamped to [0, 100]
```

Every score is stored with its **per-feature contributions**, so the UI can always answer
*"why is this person at 72?"*. A bare number is never displayed — see §9.

**Band thresholds** (configurable per tenant):

| Band | Range | HR action |
|---|---|---|
| 🟢 Low | 0–39 | None |
| 🟡 Moderate | 40–59 | Include in quarterly check-in |
| 🟠 Elevated | 60–79 | Retention conversation within 30 days |
| 🔴 High | 80–100 | Retention conversation within 7 days |

Thresholds are configurable because the right operating point depends on how many
conversations an HR team can actually hold — which is a capacity question, not a modelling
question.

## 6. Cadence

**Nightly batch**, 02:00 Asia/Dhaka, in the worker process (ADR-004).

This resolves P0-6's design half and **P1's real-time inconsistency**: the proposal says
*"live"* and *"real-time,"* the deck says *"nightly batch."*
**Nightly is correct and is the shipped behaviour** — real-time scoring would require stream
processing for no benefit, since HR acts on these signals weekly at best. The proposal's
wording must change, not the design.

## 7. Evaluation

**Resolves P1-14 and P1-15.**

**Do not report accuracy.** At a ~3% base rate per 90-day window (12% annual turnover), a
model predicting "nobody leaves" scores **97% accurate**. Accuracy in an SQA report signals
that the team does not understand the problem.

| Metric | Why |
|---|---|
| **precision@10** *(primary)* | Of the 10 employees flagged highest, how many actually resign within 90 days. HR can hold ~10 conversations a month — this is the only metric that maps to the real operating constraint. |
| **recall@threshold** | Of everyone who resigned, how many were flagged. Guards against a model that is precise but flags almost nobody. |
| **Base rate** | Always reported alongside. precision@10 of 30% means nothing until you know the base rate is 3%. |
| **Lift over baseline** | Compared against the trivial rule *"flag everyone at 11–13 months' tenure."* If the model cannot beat that, it has no value. |

## 8. Acceptance criteria — Increment 4

These are **acceptance criteria**, not a stage gate. ADR-001 selects a plain Incremental
lifecycle with no Go/No-Go checkpoints: Feature 9 is done when it meets its criteria, just as
every other feature is done when its user stories pass. A miss is a bug to fix inside
Increment 4, not a trigger to renegotiate scope.

> **F9 is accepted when both hold:**
> 1. **precision@10 ≥ 3× base rate** on the held-out validation set, and
> 2. every score decomposes into per-feature contributions that sum to the total.
>
> Both are asserted automatically — `packages/core/test/attrition.test.ts`, and
> `evaluate()` returns `meetsAcceptance`.

Validation set: 40 hand-constructed employee scenarios derived from the HR-manager
interviews — 12 labelled *resigned within 90 days*, 28 labelled *stayed*. Constructed
**before** the weights are tuned, held out, and not looked at during tuning.

> **Honest limitation, state it in the viva:** 40 synthetic scenarios validate that the
> engine behaves as HR experts expect. They do **not** establish real-world predictive
> accuracy. That claim requires production data over 2–3 years. Do not overstate this —
> claiming validated prediction from 40 constructed cases is the kind of thing that gets
> challenged, and the honest version is more impressive.

## 9. Responsible use — mandatory

**Resolves P1-5.** Neither source document contains a single line on this. It is the largest
non-technical gap, and closing it is worth more marks than any other change in this review.

An HRIS that silently flags employees as "likely to quit" and shows it to their manager
produces two predictable harms:

- **Retaliation** — a flagged employee is quietly passed over for projects, training or
  promotion by a manager who now believes they are leaving.
- **Self-fulfilling prophecy** — being treated as a flight risk *causes* the exit the model
  predicted, and the model then looks accurate.

### Enforced in code

| Rule | Enforcement |
|---|---|
| Scores visible to **HR role only**, never to the line manager in v1 | Route guard + repository guard |
| Every score view written to `audit_log` | Repository layer, no bypass |
| Score is **advisory for retention outreach only** — using it in termination, promotion, appraisal or pay decisions is a **prohibited use** | Displayed on every score view; recorded in the terms of service |
| Employees are **notified** that behavioural analytics run, and may request their own score and its contributions | Onboarding notice + self-service endpoint |
| No score is displayed without its feature contributions | UI contract; API returns them together or not at all |
| Employees may **contest** a score; contested scores are flagged and reviewed | `attrition_score.contested` flag |

### Quarterly bias audit

Score distributions compared across **gender, department, age band and tenure band**. A
mean-score gap exceeding **5 points** between groups, after controlling for tenure, triggers
mandatory re-weighting before the next cycle. The audit is a scheduled job with a written
report — not a manual promise.

### Data minimisation

Feature values are retained **13 months** (enough for a year-over-year comparison), scores
**25 months**. Older rows are aggregated and the per-employee detail deleted.

## 10. What v1 is not

Stated plainly, because overclaiming here is the easiest way to lose credibility in a viva:

- It is **not** a trained machine-learning model. It is a weighted scorecard with expert-set
  weights. Calling it "AI" is defensible only in the broad sense of decision support — and
  the honest framing is *"a transparent, explainable risk model, designed to be replaced by
  a learned model once labelled data exists."*
- It does **not** know why anyone actually leaves. It detects behavioural correlates that
  experienced HR managers report noticing.
- It will produce **false positives**, and at a 3% base rate most flags will be false. This
  is acceptable *only* because the intervention — a conversation — is low-cost and benign.
  It would not be acceptable for any consequential decision, which is why §9 prohibits them.
