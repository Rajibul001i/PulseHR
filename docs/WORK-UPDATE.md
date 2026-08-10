# PulseHR — Work Update

A running log of substantive work: what was done, what was decided, what was found, and
what remains. Written to be handed to the instructor as a progress record and to the team
as a changelog.

---

## Session 3 — 11 August 2026

### 5. `improve-animations` audit — 5 findings + 3 missed opportunities, all implemented

Ran a full audit (8 categories) against `apps/web`'s motion, now that it had CSS animation
from the earlier `find-animation-opportunities` pass to actually audit. Vetted findings,
presented them, and implemented all of them at your request:

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | **HIGH** | Reduced-motion handling was both too broad (`* { transition: none !important }` killed harmless color transitions) and too narrow (keyframe `animation`s with real movement — toast, content-in — weren't gated at all) | Rewrote to drop movement, keep color/opacity feedback |
| 2 | MEDIUM | No easing tokens existed; every transition used the browser's weak bare `ease`/`ease-out`; the sidebar drawer wasn't using a drawer curve | Added `--ease-out`, `--ease-in-out`, `--ease-drawer` tokens, applied at all 8 sites |
| 3 | MEDIUM | Toast used `@keyframes` for enter/exit — the exact pattern to avoid on rapidly-triggered UI (bulk-approving leave requests fires several toasts in quick succession) | Converted to `transition` + `@starting-style`, which retargets instead of restarting |
| 4 | MEDIUM | Progress bars animated `width` (layout-triggering) instead of `transform` | Switched to `transform: scaleX()` + `transform-origin: left` in `styles.css` and the 3 call sites (`App.tsx`, `AtRisk.tsx`, `Plan.tsx`) |
| 5 | LOW | `.view-fade` was pure-opacity with no initial transform, inconsistent with the rest of the app's entrances | Added `transform: translateY(4px)` to match |

Plus the missed opportunities: inline error text now fades in (`Login.tsx`, `Attendance.tsx`,
`Payslips.tsx`, `AtRisk.tsx`, `Plan.tsx`) instead of popping; `AtRisk.tsx` — which never got
the `.content-in` treatment in the previous pass — now has it; and the card grids on
`Dashboard.tsx` and `Plan.tsx` (plus the already-per-card Noticeboard) now stagger in at
30ms per card instead of all at once, capped at 90ms total spread.

**Verified:** typecheck, build, and two Playwright passes — one exercising the full flow
(login error, dashboard, plan, at-risk detail, toast, sign-out) and one with
`prefers-reduced-motion: reduce` emulated end to end, confirming the toast's computed
`transform` stays at identity (no movement) under reduced motion.

### 4. Implemented the animation-opportunities findings in `apps/web`

Ran the `find-animation-opportunities` skill against the web app, then implemented the six
surviving suggestions (all CSS-only or small, mechanical JSX changes — no new dependency):

- **Toast exit** (`Toast.tsx`, `styles.css`) — dismissal now plays a 160ms `slide-out`
  mirroring the existing entrance, instead of vanishing instantly.
- **Button press feedback** (`styles.css`) — `button:active:not(:disabled) { transform:
  scale(0.97) }`, appended to the existing hover-transition list.
- **Skeleton → content fade** (`Dashboard.tsx`, `Leave.tsx`, `Plan.tsx`, `App.tsx`
  Noticeboard) — a `.content-in` utility (140ms, opacity + 2px) applied wherever a
  `StatSkeleton`/`TableSkeleton` resolves into real content.
- **Mobile nav scrim** (`App.tsx`, `styles.css`) — was conditionally rendered (instant
  pop); now stays mounted and toggles an `open` class so it fades in/out over 180ms,
  matching the sidebar's own transition.
- **Payslip list ↔ detail** (`Payslips.tsx`) — both views wrapped in a `.view-fade`
  utility (180ms) instead of swapping with a hard cut.
- **Progress bar fill-on-mount** (`styles.css`) — `.bar > i` already had `transition:
  width .3s ease` but never played, because React mounted the bar pre-filled with no
  "before" state. Added `@starting-style { width: 0% }` so it now animates in on the
  seat-usage bar and the attrition contribution bars.

**Verified:** `npm run typecheck` and `npm run build` clean. Drove the running app with
Playwright (`playwright-core` against the system Chrome install, since neither
`chromium-cli` nor a Playwright browser download were available) through login → Dashboard
→ Leave → Payslips → Plan → mobile drawer → sign-out, screenshotting each step and checking
console/network errors.

**Found in the process, not caused by it:** `GET /api/leave/balances` and
`GET /api/payroll/payslips` return `400 { "error": "employeeId required" }` for the
`hr@meridian.test` demo account, because HR_ADMIN has no linked employee record. Confirmed
present in the code before this session's changes (`apps/api/src/server.ts:316,444`) via
`git stash`. `Leave.tsx` already catches this silently ("an HR admin has no employee record
of their own"); `Payslips.tsx` does not, so an HR Admin visiting **Payslips** sees a raw
`employeeId required` line above an empty table. Not fixed — flagging for the team to
decide whether Payslips should degrade the same way Leave does, or whether HR_ADMIN should
carry a linked employee record in the seed data.

### Summary

| | |
|---|---|
| GitHub repo | Created and pushed — **[Rajibul001i/PulseHR](https://github.com/Rajibul001i/PulseHR)**, public |
| LinkedIn post | Still **not posted** — no LinkedIn connector available. Draft finalized with the repo link. |
| Doc citations | Removed "Slide X / Proposal §Y" source-location citations from all 16 docs where they were decorative; kept them where a doc's whole job is pointing at a location, and kept every Labour Act legal citation |

### 1. Published the repository to GitHub

Repo created under the `Rajibul001i` account and the full existing local history (4 commits,
`ffe3d10` → `8ed0d4a`) pushed as-is — no history rewrite. Verified after push: public
visibility, default branch `master`, no secrets or `node_modules` in the tree (`.gitignore`
was already correct).

**Auth note for next time:** a classic PAT needed **three** scopes to get through
`gh repo create --source=. --push` cleanly — `repo`, `read:org` (gh validates this even for
a personal account), and `workflow` (required specifically because this repo has
`.github/workflows/ci.yml`; GitHub rejects pushes that touch workflow files without it). The
browser device-code flow (`gh auth login` → web) failed silently twice before switching to a
token — no config file was ever written to `%APPDATA%\GitHub CLI\`, so nothing had actually
authenticated despite the browser appearing to complete.

README updated with the repo link at the top.

### 2. Finalized the LinkedIn draft

`_deliverables/linkedin-post-draft.md` — all three options now have the GitHub link inlined,
and the "add the link once pushed" TODO is resolved. **Not sent.** No LinkedIn connector is
available in this environment; the draft is ready for you to copy, adjust the tagged
teammates if needed, and post yourself.

### 3. Removed source-location citations from the docs

You flagged that tables and prose reading like *"Slide 6 vs 14"* or *"§3b"* — pointers back
to exactly which slide or section of the original flawed proposal/deck a defect came
from — read as clutter. Went through all 16 files in `docs/` (161 occurrences) and applied
one rule consistently:

- **Removed/reworded:** citations pointing into the original `PulseHR_Proposal_(25-07-2026).docx`
  or `PulseHR_Presentation_(01-08-26).pptx` — e.g. "Proposal §3b" → "The proposal states,"
  "Slide 6 vs 14" contrasts reworded as "one part of the deck... another part..." Table
  "Where" columns citing slide/section numbers were dropped outright.
- **Kept:** Bangladesh Labour Act legal citations (§46, §86, §100, §102, §108, §115, §116,
  §117, §118) — these are binding legal references, not review bookkeeping.
- **Kept:** internal cross-references between this project's own docs (e.g. "see
  `05-attrition-risk-spec.md` §9") — navigation aids for documents that still exist.
- **Kept:** slide numbers in `00-source-document-review.md`'s P2-1, where the defect
  itself *is* the wrong numbering — the numbers are the subject, not a citation.
- **Kept:** internal self-references inside `10-proposal-patches.md`'s quoted replacement
  text — that text is the literal content meant to be pasted into the finished proposal, so
  a cross-reference like "(§6.1)" inside it is real content the future document will contain,
  not review commentary.

Verified afterward: no remaining `Slide X` / `Proposal §Y` patterns outside the two
exceptions above, and every edited markdown table still has consistent column counts.

### Outstanding from this session

- **Revoke the PAT** used to authenticate `gh` — `https://github.com/settings/tokens` — now
  that the push is done, it no longer needs to exist.
- Post the LinkedIn update yourself when ready (pick Option A/B/C in the draft).

---

## Session 2 — 10 August 2026

### Summary

| | |
|---|---|
| Source documents ingested | 3 (Features & Functions, Requirements Model, Presentation) |
| Process model | **Go/No-Go gate removed — now plain Incremental** |
| Defects found by adversarial testing | **16** |
| Defects fixed and re-verified | **11** (incl. 2 security) |
| New module built | Subscription & entitlement layer |
| Tests | **102 unit** (+16), 30 integration, 17 bug-hunt |
| Project relocated | `D:\PulseHR` → `E:\PulseHR` |

### 1. Ingested the team's requirements work

Three documents were supplied and are now the **authoritative spine**, replacing the
structure inferred in session 1:

- **9 features / 43 functions** with traceable IDs (F1.1 … F9.5), mapped to increments
- **49 user stories** with 3–4 acceptance criteria each (US-01 …), mapped to use cases
- **18 analysis classes**, CRC cards, activity/swimlane diagrams, traceability matrix

This is strong work and materially better than what I had assumed. All testing in this
session was conducted **against these documents**, not against my own design.

Extracted copies preserved at `_source-extracts/`, originals at `_source-docs/`.

### 2. Removed the Go/No-Go gate

**Decision:** the process model is now **plain Incremental**, no stage gates.

**Reason:** the gate contradicted the team's own documents. `PulseHR_Features_Functions.docx`
states *"Because we follow the Incremental Process Model, every function listed here is
delivered inside working, tested software at the end of its increment."* Neither that
document nor the Requirements Model mentions a gate. It was an addition nobody asked for,
and it weakened a clean answer under questioning.

**What was kept:** the AI module still has an **acceptance criterion** (precision@10 ≥ 3×
base rate). An acceptance criterion is not a gate — it defines "done" for a feature; it does
not create a decision point about whether to proceed. A miss is now a bug to fix inside
Increment 4.

**Changed:** ADR-001 rewritten; `MODEL_PROMOTION_CRITERION` → `MODEL_ACCEPTANCE`;
`passesGoNoGo` → `meetsAcceptance`; references purged from 6 documents and the test suite.

### 3. SQA pass — Muradujjaman's role

Built `scripts/bughunt.mjs`: adversarial black-box testing of the running API against the
49 user stories, the class model, and our own published API contract — specifically hunting
for gaps between **what we claimed** and **what we built**.

**16 defects found in a build whose 132 existing tests were all green.** That is the finding
worth repeating: tests written by the person who wrote the feature inherit that person's
assumptions.

**Two were security defects, both contradicting our own API contract:**

- **BUG-02 (Critical)** — `GET /api/attendance/grid` had **no role guard at all**. Any
  employee could read **620 rows** of the whole company's attendance. The API contract
  documented it as MANAGER+HR; the code enforced nothing.
- **BUG-11 (Critical)** — job ids were global, so one tenant could read another tenant's
  **payroll run result including total net pay**. Our smoke suite already tested tenant
  isolation — but only on routes we had thought about.

**Also fixed:** manager attendance scope (US-04), the 6-attempt lockout off-by-one (US-02),
silently-ignored employee search (F2.4), hard-coded 09:00 office start (class model),
overwritten check-in (F3.1), leave accepted with 2020 dates (F4.1).

**BUG-12** deserves a note. The schema declared
`UNIQUE (employee_id, period_year, period_month, adjusts_payslip_id)` intending "one payslip
per employee per period". It does not do that: **NULLs compare as DISTINCT inside a UNIQUE
index**, so two ordinary payslips never collide. The constraint read as if it protected the
invariant while protecting nothing. No duplicates existed in practice — only `runPayroll()`
writes payslips and it checks first — which is exactly why it was worth fixing: the guard
was one forgotten `if` away from paying someone twice. Migration `003` replaces it with a
partial unique index, verified at the database level.

**Full report:** [`13-sqa-defect-report.md`](13-sqa-defect-report.md).

### 4. Flagged for the team: Increment 1 is not closed

**F1.4 password reset (US-05) is not implemented.** It belongs to Increment 1, which is
supposed to be complete. Under the Incremental Model an increment is done when *all* its
functions pass their acceptance criteria. Saying so is the discipline the model requires.

### 5. Started the main build — subscription & entitlement layer

PulseHR is sold in three tiers, and **no code anywhere knew what plan a tenant was on.** For
a subscription product that is the missing commercial spine, so it was built before further
feature work.

- One pure entitlement function shared by the API guard and the UI, so they cannot disagree
- 10-feature entitlement matrix across Starter / Growth / Enterprise
- Plan status handling: `TRIAL` (exclusive expiry), `ACTIVE`, `PAST_DUE`, `CANCELLED`
- Seat accounting — warn at 90%, refuse at 100%
- **HTTP 402**, not 403, for tier gates — 403 means "never", 402 means "you could buy this"
- `feature_gate_hit` telemetry so tier boundaries become a data question, not guesswork
- `subscription_event` append-only plan-change log
- 16 unit tests

**Commercial change:** the attrition module was split. The deck gated the whole AI
capability to Enterprise, but the AI is the entire differentiator and the target market
buys Starter/Growth. Growth now gets a limited watchlist; Enterprise gets full nightly
scoring, history and configurable weights.

**Details:** [`11-subscription-model.md`](11-subscription-model.md).

### 6. UI/UX assessment

Written up in [`12-ui-modernisation.md`](12-ui-modernisation.md). Short version: the current
interface is a competent 2015 admin panel, and its real problem is not visual — **it has no
idea it is part of a subscription product**. A Growth customer and an Enterprise customer
see an identical screen: no visible reason to upgrade, no evidence of what they pay for, no
prompt when they hit a limit. The API can now answer all three; the UI does not yet ask.

Phased plan provided. **Implementation is the next work item.**

### 7. Infrastructure

- Project moved `D:\PulseHR` → `E:\PulseHR` (git history intact, 0 uncommitted changes lost)
- Node.js reinstalled as **portable at `E:\tools\node`** after the system installation was
  found broken (see Issues below)
- All source documents and extracts copied to E:

### Issues encountered

**Files disappeared from C: during the session.** Between the start and middle of this
session, the following vanished:

- `C:\Program Files\nodejs\` — the entire Node installation (registry entry survived, so
  both MSI install and uninstall failed with 1603)
- Several `PulseHR_*.docx` / `.pptx` files from `C:\Users\ri511\Downloads`, **including the
  original proposal** and the renumbered deck produced last session
- Two extracted `.txt` files from the session scratchpad

The Recycle Bin contains none of them, and C: has only **9.9 GB free**. This is the
signature of **Windows Storage Sense** running on a low-space drive — it deletes
permanently, bypassing the Recycle Bin. I did not run any delete command against those
paths; my only deletions were scoped to `D:\PulseHR\node_modules`.

**Action taken:** portable Node installed to E:; everything of value copied to E:.
**Action needed from the team:** check whether the original proposal `.docx` exists in
OneDrive, email, or another backup — and turn Storage Sense off.

---

## Session 1 — 2 August 2026

### Summary

| | |
|---|---|
| Source documents reviewed | 2 (Proposal, Presentation) |
| Defects found | **45** (9 blocking) |
| Prototype | TypeScript / React / Express / SQLite, verified running |
| Tests | 86 unit, 30 integration |

### What was done

1. **Reviewed the proposal and deck** — found 45 defects, 9 blocking, written up with fixes
   in [`00-source-document-review.md`](00-source-document-review.md).

2. **The nine blocking defects:**
   - The two documents selected **different process models**, and the deck contradicted itself
   - The AI module had **no training data and no label** — a fresh install has zero
     resignations, so no regression can be fitted
   - The ERD had **no tenant column** — a multi-tenant SaaS that leaks between customers
   - The Node.js justification was **backwards** (payroll is CPU-bound; Node is
     single-threaded)
   - Leave balance was **mutable state with a race condition**
   - Payslips stored only `net_pay` — **unauditable**
   - Business dates had **no timezone** — silently corrupts attendance *and* payroll

3. **The most expensive single defect:** the proposal's *"twice the standard hourly rate"*
   for overtime reads as gross-based, but §108 sets it on **basic**. At a 30,000 basic /
   50,000 gross salary that is a **67% overpayment on every overtime hour** — roughly
   BDT 3.7 lakh a year across 200 employees.

4. **Added a Responsible Use section** — neither document had a word on consent, appeal,
   access limits or bias auditing for the attrition score. Performance-review scores were
   dropped from the model because the proposal itself calls reviews bias-corrupted.

5. **Built the prototype** in the proposed stack and verified it end to end.

6. **Repaired the deck's slide numbers** — a third were wrong (11, 12, 16, 19, 20 each
   appeared twice; the sequence ran backwards at 22→18).

### Correction made during the session

My own `precision@k` implementation broke ties by array order, which silently inflated the
metric — a degenerate model with no signal scored 3.33× lift and "passed". Fixed with
expected-precision under random tie-breaking; a no-signal model now correctly returns
exactly the base rate.

---

## Standing backlog

| # | Item | Priority |
|---|---|---|
| 1 | **Implement F1.4 password reset** — closes Increment 1 | **High** |
| 2 | UI Phase 1 — subscription-aware shell, upgrade prompts, seat meter | **High** |
| 3 | Settle F6.3/F9.1 — do review scores feed the risk model? (SQA recommends no) | **High** |
| 4 | F2.2 employee self-service contact update | Medium |
| 5 | F6 OKR, F7 ATS, F8.2/F8.3 noticeboard — Increment 3 scope | Medium |
| 6 | UI Phases 2–4 — toasts, skeletons, empty states, responsive, a11y | Medium |
| 7 | Real PDF payslips (F5.3 — currently print-to-PDF) | Medium |
| 8 | Payment gateway, proration, invoices | Low (post-MVP) |
| 9 | Verify every Bangladesh Labour Act figure against the consolidated text | **High** |
