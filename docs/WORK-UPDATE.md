# PulseHR — Work Update

A running log of substantive work: what was done, what was decided, what was found, and
what remains. Written to be handed to the instructor as a progress record and to the team
as a changelog.

---

## Session 5 — 15 August 2026

### 1. Full-app visual/UX audit — seven real defects found and fixed

Requested as "implement the frontend-design skills, make an assessment and fix everything" —
read as a systematic pass across the whole product, not just one page. Screenshotted every
authenticated page plus login/reset-password at desktop (1360px) and mobile (390px) widths,
against **real seeded data** (leave requests, notices, an OKR objective, real payslips) —
empty states already proved earlier in this project (Session 4 item 6) that they mask real
bugs. Found seven, all fixed, none caught by `bughunt.mjs` because none are backend logic
defects:

1. **Profile.tsx and OKR.tsx silently never loaded for HR_ADMIN.** Both pick a default
   employee via `if (emp) setViewingId(...)`, which never fires for HR_ADMIN (no employee
   record of their own) — and with no matching `<select>` option for `viewingId`'s `null`
   state, the browser's own fallback rendering made it *look* like the first employee was
   already selected while React's real state stayed `null` and the fetch never fired. Both
   pages appeared to be showing someone's documents/OKRs while actually stuck on a loading
   skeleton forever. Fixed by auto-selecting the first employee once the list loads.
2. **Payslips.tsx leaked a raw `employeeId required` API error** to every HR admin who opened
   the page — a gap already flagged and left unfixed in Session 3. The backend already
   accepted an explicit `?employeeId=`, the same pattern Leave and Profile already used for
   HR_ADMIN; Payslips just never got it. Fixed the same way, which also means HR admins can
   now actually browse any employee's payslip history and download their PDFs — a real
   capability the API already supported.
3. **Recruitment and Attendance forced the whole page wider than the viewport on mobile**
   (measured 1084px and 963px wide at a 390px viewport, respectively) despite both already
   having their own internal horizontal-scroll wrapper. Root cause was one level up: `.main`
   is a flex item with no `min-width: 0`, so it refused to shrink below its widest child's
   content — the entire layout grew instead of letting the inner wrappers scroll. One CSS
   fix resolved both, plus every other page with a wide table and no dedicated wrapper got a
   new `.table-card` scroll class (kept separate from the shared `.card` rule, since
   `.plan-card`'s badge relies on `.card` staying `overflow: visible`).
4. **Two pages showed internal spec-tracking IDs to real users** — "…we'll send a reset
   link — F1.4, US-05." on the forgot-password form, and "(F2.5)" on Profile's subtitle.
   Removed both; the same IDs remain in code comments, which is where they belong.

**Verified:** full regression (107 unit, 30 smoke, 64 bughunt — all green) plus a complete
re-screenshot of all 20 page/width combinations confirming each specific symptom is gone —
every previously-overflowing mobile screenshot now measures exactly 390px, and the two
previously-stuck pages now show real loaded content. Full writeup in
`docs/13-sqa-defect-report.md` §15.

### 2. Navigation restructure + a second visual pass — four more real defects

Direct feedback on the Plan & billing page specifically (screenshot attached, called "messy"),
plus a request to move it out of the main sidebar and apply the design skills more broadly.

- **Plan & billing is no longer in the sidebar's page list.** It's an account-level page,
  checked rarely and only by HR_ADMIN — not a peer of Attendance or Leave. The sidebar's
  existing plan summary (tier, seats, trial countdown, already shown to every role) is now
  itself the link into `/plan` for HR_ADMIN, with the ⌘K command palette updated separately so
  it's still searchable there. Every existing "upgrade to unlock" link elsewhere is unchanged.
- **The pricing cards' dead space, fixed.** This is what the screenshot actually showed as
  "messy" — Starter's card lists 4 features against Enterprise's 10, and the button pins to the
  bottom of all three, so the shorter cards had a large blank gap above their button. Each card
  now also lists what it *doesn't* include yet, dimmed with a lock icon — fills the space with
  real information and doubles as the upsell the page exists to make.
- **Three permanently-blank Dashboard cards for every HR admin, fixed.** Earned/Casual/Sick
  leave balance cards read from the signed-in user's own employee record — which HR_ADMIN
  accounts don't have (by design). Every HR admin has seen three `—` cards on every visit.
  Replaced with org-level stats (pending approvals, employees needing attention) for that role.
- **An unstyled native file input, fixed.** Profile's document upload and the public careers
  page's CV upload both showed the browser's own white "Choose File" button sitting in an
  otherwise fully dark-themed form — the one element on either page that visibly didn't belong.
  Styled to match each page's own palette.
- **Backend jargon leaked into Payslips' copy, fixed.** "Runs in the worker process, not the
  API — CPU-bound..." explained to every HR admin why payroll is async, in engineering terms
  nobody asked for. Replaced with a plain "runs in the background, stays responsive" sentence
  that gives the same reassurance without the internals.
- **Mobile confirmed EMPLOYEE-only**, per team direction — Manager/HR_ADMIN screens stay
  desktop-oriented. Verified the EMPLOYEE role at 390px across every page it uses: no overflow
  anywhere. Added a small scroll-shadow affordance to mobile data tables (Leave, Payslips) so a
  swipeable column reads as "more this way," not "cut off."

**Verified:** full regression on a freshly reseeded database (107 unit, 20 smoke, 64 bughunt —
all green). Two scripts briefly showed failures on non-final runs from database state left over
by a *previous* run of the same scripts in this pass, not from anything shipped — confirmed by
re-running each in isolation against a clean reseed, both fully green. Full writeup, including
that verification trail, in `docs/13-sqa-defect-report.md` §16.

---

## Session 4 — 13 August 2026

Direct feedback on the live demo after Session 3's close-out: a session-recovery bug that
left the app stuck, the live API's cold start reading as "frozen," self-service billing
buttons that didn't do anything, and the interface itself judged dated. All four addressed.

### 1. Fixed: a dead session left the app stuck instead of bouncing to login

Reported live: after signing in, every button stopped working with "Missing bearer token,"
while the sidebar still showed as signed in. Root cause: when a refresh token died (expired,
or — on the Render free-tier demo — invalidated because the whole database gets wiped and
reseeded on every cold start), `tryRefresh()` cleared the stored tokens but never reset
Redux's `authenticated` flag or the persisted identity fields. Every request from then on
went out with no Authorization header, and the shell had no way to recover short of the user
manually clearing storage.

Fixed by forcing a full sign-out and reload back to the login screen whenever a request 401s
and refresh can't recover it. `/auth/*` is explicitly excluded from this path — login and
forgot-password legitimately return their own 401s (wrong password) that must reach the
caller as a normal error, not trigger a reload mid-login; verified both paths hold with
Playwright, including simulating a dead session by corrupting the stored tokens directly.

### 2. Fixed: a slow cold start read as "the app is frozen"

Same feedback session: "the server is too slow." The live API is on Render's free tier,
which sleeps after 15 minutes idle and can take 30-60s to wake on the next request — during
that wait the login button just said "Signing in…" with nothing else on the page, which
reads exactly like the app is frozen, not merely slow. If a request takes more than 4
seconds, the login and forgot-password forms now explain what's happening instead of
leaving it to be guessed at. Verified with a simulated 6-second-delayed response.

### 3. Rebrand — new logo, teal accent default, a palette switcher

You provided a new logo (a rendered image, not a source file) and said the current one was
wrong — this directly reversed an earlier instruction in this project to leave the logo
alone, so I confirmed the swap explicitly before touching anything. Since no source asset
existed, the mark (ascending "pulse" bars + a heartbeat pin) is a fresh SVG interpretation
built to match what was shown, not a pixel-perfect reproduction, applied consistently across
the sidebar, login, reset-password and public careers pages plus a matching favicon.

Introduced a second theming axis independent of the existing light/dark toggle: an accent
palette (Pulse/Classic/Violet, `[data-palette]` on `<html>`, persisted separately from
`[data-theme]`). Pulse — teal, brand-aligned — is now the default, replacing the old
hard-coded blue; Classic keeps the original blue so no one's existing preference is lost;
Violet is a genuine third option, since "we need more themes" meant plural. A swatch-
triggered switcher sits next to the theme toggle, closing on an outside click via a document
listener rather than a full-page scrim — that exact pattern already caused a real bug once
this session (the notification bell), so it wasn't repeated here.

### 4. Visual redesign pass

"The UI/UX is boring and not up to date," specifically. Since most pages already share their
card/table/button/typography styling centrally in `styles.css`, the redesign lives almost
entirely there rather than touching each page — refining the shared tokens cascades the
update everywhere at once. Bigger, bolder headings and stat numbers; a theme-aware card
shadow token (`--card-shadow`) for real depth instead of a flat border; a coherent 9px/12px
corner-radius scale across buttons, inputs and cards; a soft accent-tinted glow on primary
buttons and the active sidebar item instead of a flat colour block. Deliberately did not add
glassmorphism, blur or heavier animation — `docs/12-ui-modernisation.md` §3 already flags
those as fashionable but wrong for this product, and nothing about that reasoning changed.

### 5. Self-service plan upgrade/downgrade, with real proration and invoicing

The Plan & billing page's Upgrade/Downgrade buttons had never had a click handler — clicking
them did nothing, which is what prompted "I can't upgrade or downgrade." A payment gateway
is still out of scope (no merchant account exists for this project), so a plan change applies
immediately and "payment" is simulated — but the proration math is real: the unused portion
of the current plan for the rest of the calendar month is credited, the new plan is charged
for the same days, and the net amount is recorded as an invoice (`packages/core/src/billing.ts`,
5 unit tests covering upgrade/downgrade/no-op/boundary days). A downgrade that would leave
more active employees than the new tier's seat limit is refused before it applies. Full
writeup in `docs/11-subscription-model.md` §8.

**Verified:** `bughunt.mjs` BUG-23 (6 assertions: preview, confirm, same-tier refusal,
non-HR-role refusal, downgrade credit, invoice history) and a full Playwright pass —
Bengal Logistics (seeded GROWTH) upgrades to Enterprise, the proration preview and resulting
invoice are checked, then downgrades back to Growth and the credit note is checked. Full
regression on a clean reseed: 107 unit tests (5 new), 20 smoke, 56 bughunt checks (6 new) —
all green, typecheck and build clean.

**Live demo redeployed** with all of the above — Render API auto-deployed from the push;
GitHub Pages `/app/` rebuilt via the `gh-pages` worktree and pushed, each fix verified
against the actual live URLs, not just local dev.

### 6. Fixed a real layout bug: toolbar buttons/badges force-stretched to 140px

Follow-up feedback after item 4's redesign pass: "the UI still not good and every layout is
disastrous" — a request to research, act as a senior UI/UX reviewer, and audit the actual
built product rather than restyle colors again. Root cause, found by screenshotting real
populated pages (not empty states, which had been masking it): `.row` — a CSS class meant
for form fields, forcing `flex:1; min-width:140px` on every direct child — was reused for
header/toolbar rows on the OKR, Recruitment, and Notices pages. Small badges got stretched
into 140px+ pills; button labels got squeezed narrower than their own text and wrapped
("Close 2026-Q3 org-wide" broke onto two lines; "Pin urgent" and "Who's read this?" each
stretched to roughly half a card's width). Fixed by redefining `.row-tight` (toolbar rows)
to size children to their own content instead of stretching them, auditing all 14 existing
`className="row"` usages app-wide and switching the 5 genuinely-misused toolbar instances,
converting Notices' single-line "Body" input to a `<textarea>`, and widening one button's
explicit min-width. Verified with real data via Playwright across a published notice, an
OKR objective, and a candidate application. Live demo redeployed.

### 7. Added an explain-only AI assistant to the attrition-risk module

Requested as "include an AI agent in the AI risk module." Before building anything, this
needed a scope decision — the risk scorecard already carries hard safety constraints
(HR_ADMIN-only, advisory-only, MANAGER excluded from the whole feature for retaliation
prevention, review scores deliberately kept out of the model) that an agent able to *take
action* would conflict with. Confirmed the intended scope explicitly: an HR-admin chat panel
that explains why a given employee is flagged, grounded only in that score's own
contribution data — nothing that can act on anything.

Built as a real Claude API integration (`claude-opus-5`, `apps/api/src/aiExplain.ts`), not a
templated string formatter — the existing scorecard page already shows contributions as a
table, so a canned paraphrase of the same table would add little. The system prompt restates
the scorecard's own constraints (advisory-only, no protected-characteristic speculation, why
review scores are excluded) and the grounding data deliberately omits the employee's `gender`
column even though the query could trivially join it — that field exists in the schema for
the quarterly bias audit alone. New route `POST /api/attrition/scores/:id/explain`, gated
identically to the score-detail route it sits beside (`requireRole('HR_ADMIN')` +
`requireFeature('attrition_full')`), scoped by `organisation_id` the same way every other
repo method is. No payment-gateway-style workaround was needed here — there's no billing
dependency — but there is a real missing-dependency case: this environment (and the free-tier
Render deploy, until an operator configures one) has no `ANTHROPIC_API_KEY`, so the endpoint
returns a clear `503` naming the missing variable instead of a crash, and the chat panel
shows that inline rather than losing the admin's typed question.

**Verified:** `bughunt.mjs` BUG-24 (7 new assertions — role gating, malformed turn-history
rejection, bogus-id 404, and a cross-tenant check that temporarily lifts a second tenant to
Enterprise tier first so the 404 provably comes from tenant scoping and not from tier gating)
and a Playwright pass confirming the chat panel renders and surfaces the 503 notice cleanly.
Full regression on a clean reseed: 107 unit tests, 24 smoke, 63 bughunt checks (7 new) — all
green, typecheck and build clean. Full writeup in `docs/13-sqa-defect-report.md` §13.

### 8. Load/stress test — found and fixed two real concurrency bugs

Requested alongside item 7: high latency, high output, low throughput, heavy server
pressure, multiple companies working concurrently, a mix of old and recently revised data,
and a huge active-user count. Ran entirely against local dev, deliberately not the live
Render demo — a stress test's job is to find where a system breaks, and doing that to a
public URL other people might be viewing is the wrong place to do it. New script,
`scripts/loadtest.mjs` (plain Node `fetch`, no new dependency): five phases, each isolating
one part of the requested scenario — multi-tenant read storm, PDF-generation output stress,
mixed read/write against old-seeded + freshly-written data, a login storm, and everything
combined and sustained — at 150 concurrent simulated users per phase.

It found two real bugs, not in this project's business logic (the existing 63-check
adversarial suite already covers that), but in how the server behaves under concurrency,
which nothing before this had exercised:

1. **`hashPassword`/`verifyPassword` used `scryptSync`** (`apps/api/src/auth.ts`) — runs on
   Node's single main thread and blocks it for the full hash duration. Under concurrent
   login load, every *other* request in flight, including unrelated tenants' reads, queued
   behind whatever password hash happened to be running at the time: p99 latency across the
   whole server hit 14.9 seconds, and 85 requests failed outright with connection resets.
   Fixed by switching to the async `scrypt` (same algorithm, same cost, same security
   property — only the thread it runs on changed), which needed this API's first-ever
   genuinely asynchronous route handler (`asyncHandler`, alongside the existing sync
   `handler`).
2. **The login rate limiter counted every attempt, not every failure** — invisible
   sequentially (which is all the existing BUG-03 test checked), but once the scrypt fix let
   far more concurrent logins for the same account genuinely overlap, up to 982 of them in
   one 15-second window came back `429` with the **correct** password. Fixed by splitting
   the limiter into a read-only lockout check and an explicit "record a failure" call, so a
   successful login — however many arrive at once — never touches the counter.

**Verified:** full regression after each fix (107 unit, 30 smoke, 64 bughunt — 1 new check,
BUG-25, firing 10 concurrent correct-password logins and asserting zero 429s) on a clean
reseed+restart each time, then re-ran the load test itself: **16,859 requests across the
final run, zero genuine errors**, down from 85 failures and a 14.9s worst-case p99 before the
fixes. Full writeup, including why login latency itself didn't drop (it isn't supposed to —
see the report for why that's the correct outcome, not an unfixed bug) and what this local
single-process test does and doesn't prove: `docs/17-load-test-report.md`.

### 9. Redesigned the public careers pages

The public job-listing and application pages (`/careers/:orgId`) had never had a real design
pass — they reused the login-card shell verbatim, and didn't even show which company was
hiring. Rebuilt from the brief up: the page's own subject (Bangladeshi operating companies —
textiles, logistics, apparel export — hiring corporate/technical staff) grounds the direction,
extended from the existing PulseHR mark rather than a disconnected new one. The signature
idea is literal: the logo's heartbeat motif becomes an actual ECG-style waveform across the
header, with one spike per open role, spike height driven by real deadline urgency — not
decoration. Vacancy rows read as manifest/docket entries; the application form numbers its
fields the way a real document would; the confirmation screen gives the reference code a
stamped-document treatment. Typography (Space Grotesk display, IBM Plex Sans/Mono) and a
fixed teal/mint/coral palette drawn from the logo's own colors are loaded only on this page,
so the authenticated dashboard's payload is untouched.

Building this against real data (not mockups) surfaced a real bug before it shipped: the org
name was derived from the first vacancy in the list, so a company with zero open positions —
the exact scenario a candidate hits on a stale shared link — showed "Loading…" forever
instead of identifying the employer. Fixed with a small dedicated endpoint
(`GET /api/public/organisations/:id`) fetched independently of the vacancy list, and the
vacancy queries now actually return the employer's name at all (they never did before).

**Verified:** full regression (107 unit, 20 smoke, 57 bughunt — including all BUG-14
recruitment/ATS checks) on a clean reseed, plus Playwright screenshots at desktop and mobile
widths across the list, detail/apply, empty, and confirmation states — the empty-state pass
is what caught the "Loading…" bug above.

---

## Session 3 — 11 August 2026

### 13. Final regression pass and live-demo redeploy — all four increments closed

With Increment 3 closed, this closes out the session: a full regression pass from a clean
reseed, then both halves of the live demo redeployed with everything built this session.

**Regression, clean reseed + freshly-restarted server:** 102 unit tests, 20 smoke checks, 50
adversarial bug-hunt checks — **0 defects, 0 unbuilt features** — `tsc -b` and `vite build`
both clean.

**Render API:** the blueprint's auto-deploy picked up the push on its own — no manual
redeploy needed. Confirmed live with an authenticated request against `/api/vacancies`,
`/api/okr/objectives` and `/api/notices`: all three respond correctly, meaning migrations
008-010 (OKR, ATS, noticeboard audience/read-tracking) applied cleanly against the live
instance's reseed-on-boot SQLite.

**GitHub Pages `/app/`:** rebuilt via a `gh-pages` worktree with
`VITE_API_BASE=https://pulsehr-api-n7il.onrender.com/api npx vite build --base=/PulseHR/app/`
and pushed — the same process as the original live-demo deploy in entry #9, run again with
this session's code. The prototype picker at the branch root was untouched.

**Verified with a real browser against the actual live URLs** (not local dev): signed in at
https://rajibul001i.github.io/PulseHR/app/ against the live Render API, and loaded
Performance, Recruitment, Noticeboard and Payslips — all four of this session's closed
increments — with no console errors beyond the two expected 404/400s from normal empty-state
API calls.

**Where the project stands:** all four increments closed under ADR-001, 43/43 functions
(100%) built and tested per `docs/13-sqa-defect-report.md`. Remaining backlog is entirely
post-MVP or judgment calls for the team (§ Standing backlog below) — F6.3/F9.1's bias
question, UI polish phases 2-4, the OKR-engagement attrition signal, payment/billing
infrastructure, and a full audit of every Bangladesh Labour Act figure against the
consolidated text.

### 12. Closed Increment 3 — F5.3 real PDF payslips, F6 OKR, F7 ATS, F8 noticeboard

Continuing the same incremental discipline as #10 and #11: Increment 3 had four open gaps
(F5.3, F6, F7, F8.2/F8.3). All four are built, tested, and verified through the real UI —
and building F8 surfaced that F8.1 (audience targeting) had never actually shipped despite
being marked done, so that got fixed alongside it rather than left as a silent gap.

**F5.3 — real generated PDF payslips.** `GET /api/payroll/payslips/:id/pdf` now streams an
actual server-generated PDF (`pdfkit`), not a browser print-to-PDF of the page. Caught a
real layout bug before shipping it: every earnings/deductions line rendered on top of the
last one, because pdfkit's text-positioning cursor doesn't track the way three column cells
sharing one captured y-coordinate assumed. Fixed by managing the table's y-cursor explicitly
— confirmed by generating a payslip and reading the actual PDF, not just checking headers.

**F6 — Performance (OKR).** Managers/HR set quarterly objectives with key results, weighted
to 100% per employee per quarter (enforced server-side); employees update progress on their
own key results only, with a required comment for over-target progress; HR closes a quarter,
after which it's read-only; managers/HR record review scores that stay hidden from the
employee until explicitly published, with a correction resetting to draft rather than
silently changing what's already visible.

**F7 — Recruitment (ATS).** HR publishes vacancies; a public, no-login careers page
(`/careers/:orgId`) lists them and accepts applications with CV upload (same file-type/size
validation as F2.5); HR runs candidates through a real **drag-and-drop** pipeline board
(`@dnd-kit/core` — US-36 says "dragged," so this wasn't built as buttons standing in for
it), with backwards moves requiring a reason; evaluations are gated to the Interview stage;
a Hired candidate converts to an employee profile in one action and the application locks.

**F8 — Noticeboard.** HR can target a notice at the whole company or specific departments,
mark it urgent (pins above routine ones, capped at 5 simultaneous pins), and see a read/
unread report; employees see only notices targeted at them, newest first with urgent ones
pinned, and opening one marks it read exactly once with a visible unread/read distinction.

**Verified:** new `bughunt.mjs` checks BUG-13 (OKR, 8 assertions), BUG-14 (ATS, 8
assertions), BUG-15 (noticeboard, 5 assertions), BUG-22 (PDF payslip, 2 assertions). Full
regression on a clean reseed + freshly-restarted server: 102 unit tests, 20 smoke checks, 50
bughunt checks — **0 defects, 0 unbuilt features** — typecheck and build both clean. Real
Playwright passes for all three modules, including a genuine pointer-drag simulation moving
a candidate card between pipeline columns (not an API call standing in for the gesture) and
a full public-application flow with no authentication at any point.

**Increment 3 is now closed** — F5, F6, F7 and F8 all sit at full marks. Total function
coverage is **43/43 (100%)** — every function in the team's own feature spec is built,
tested, and passing. All four increments are closed under ADR-001.

### 11. Closed Increment 2 — F2.2 contact update, F2.5 documents, F4.4 notifications

Continuing the same incremental discipline from #10: Increment 2 had three open gaps
(F2.2, F2.5, F4.4). All three are built, tested, and verified through the real UI.

**F2.2 — self-service contact update.** `POST /api/me/contact` lets an employee update
their own phone/address/emergency contact; designation, department and employee code stay
server-authoritative regardless of what the request body contains. HR sees the change with
no approval step, per US-09.

**F2.5 — employee documents.** HR can attach documents (PDF/JPEG/PNG, 5 MB cap, both
enforced server-side) to an employee's profile; the employee and HR can view them, no one
else can. Files travel as base64 inside the existing JSON API rather than adding multipart
upload handling for one feature. New migration `006_employee_documents.sql`
(`employee_document`, BLOB storage — the SQLite file is already ephemeral on the free-tier
host, so a separate object store would add complexity without adding durability).

**F4.4 — in-app leave notifications.** A manager is notified when a direct report submits
leave; the employee is notified when it's decided, carrying the reason. Building this
surfaced a real gap in US-19's enforcement that nothing had caught before: nothing stopped a
rejection from being submitted with no reason. Fixed alongside F4.4 — `REJECT` now requires
a non-empty `reason` (`400` without one).

**A genuine UI bug found during verification, not by the API-level suite.** The
notification panel used a full-screen transparent overlay to detect clicks outside it and
close itself. That overlay sat above the sidebar (which has no stacking context of its own
at desktop width) and silently blocked the first click on anything else on the page while
the panel was open — including Sign out. Caught because the verification pass was a real
Playwright run that continued past reading the notification into signing out, not just an
API call. Fixed by replacing the overlay with a `document.addEventListener('mousedown', …)`
click-outside handler scoped to the panel itself. Full writeup in
`docs/13-sqa-defect-report.md` §10 (recorded as BUG-21) — this class of bug is invisible to
`bughunt.mjs` by construction, since there's no failing HTTP request; it only exists in the
DOM, which is exactly why this project keeps a real-browser verification step for anything
UI-facing.

**Verified:** new `bughunt.mjs` checks BUG-05 (F2.2, 3 assertions), BUG-19 (F2.5, 5
assertions), BUG-20 (F4.4 + the US-19 reason gap, includes the notification-clears-on-read
check). Full regression on a clean reseed + freshly-restarted server: 102 unit tests, 20
smoke checks, 30 bughunt checks (27 pass, 3 are Increment-3 stubs not yet built), typecheck
and build both clean. Real-account Playwright pass: Arif submits leave → manager Shabnam is
notified → clicks through to `/leave` → rejecting with no reason is blocked by the UI →
rejecting with one clears her notification and lands on Arif's, quoting the reason → she can
then sign out cleanly (confirming the BUG-21 fix holds).

**Increment 2 is now closed** — F2 and F4 both sit at 5/5. Total function coverage is now
31/43 (72%). Moving to Increment 3 next: F5.3 real PDF payslips, F6 OKR, F7 ATS, F8.2/F8.3
noticeboard priority + read tracking — in order, same discipline.

### 10. Closed Increment 1 — F1.4 password reset (US-05)

You asked me to actually follow the Incremental Model rather than just work off whatever
was asked next: an increment isn't done until every function in it passes acceptance
criteria, and F1.4 was the one gap keeping Increment 1 open since session 2. Closed it.

Built exactly to US-05's three acceptance criteria: single-use token, 30-minute expiry, and
(matching the login endpoint's existing anti-enumeration posture) the same response whether
or not the email is registered. New migration `004_password_reset.sql`
(`password_reset_token`, hashed like sessions), two new routes, a "Forgot password?" flow on
the login page, and a `/reset-password` page reachable regardless of auth state.

**Documented, not hidden:** no email provider exists anywhere in this project, so the token
a real deployment would email is returned in the API response and the UI says so plainly.
Full reasoning in `docs/13-sqa-defect-report.md` §9.

**Verified:** `bughunt.mjs`'s BUG-04 check now runs the full cycle (5 assertions, all
passing) instead of just checking the route isn't a 404; a Playwright pass drove the actual
UI end to end (forgot → demo link → reset → sign in with the new password). Unit tests
(102) and the smoke suite (24) still green throughout.

**Increment 1 is now closed** — all 5 F1 functions pass. Moving to Increment 2's remaining
gaps next (F2.2, F2.5, F4.4), then Increment 3 (F5.3, F6, F7, F8.2/F8.3), in order.

### 9. Deployed a genuinely working live demo — API on Render, frontend on GitHub Pages

You asked for a live prototype of the whole project, not just one component. That means a
real backend, not just a static page — GitHub Pages can't run Express, SQLite, or the job
queue, so a frontend-only deploy there would look like the app but fail on every action.

**Backend:** `render.yaml` (new, at repo root) deploys `apps/api` as a Node web service on
Render's free tier. `PORT` and `PULSEHR_JWT_SECRET` already read from environment variables
(the latter now auto-generated by Render), so no code changes were needed there. Start
command reseeds before every boot — deliberate, not a workaround: the seed is a deterministic
PRNG (ADR-009), so the free tier's sleep/wake cycle just means the demo is always in a known
fresh state, never stale. Live at **https://pulsehr-api-n7il.onrender.com**. You created and
own this Render service; I can't act on it further without you.

**Frontend:** three small, real changes, all committed to `master` (not prototype scaffolding):

- `apps/web/src/api.ts` — the API base URL is now `VITE_API_BASE` at build time, falling back
  to the existing `/api` dev-proxy path. Zero behavior change for local dev or the normal
  `npm run build`.
- `apps/web/src/main.tsx` — `BrowserRouter` now takes `basename={import.meta.env.BASE_URL}`.
  Required for a subpath deploy; without it every in-app link breaks.
- `apps/web/index.html` — added the standard GitHub-Pages SPA redirect script
  ([rafgraph/spa-github-pages](https://github.com/rafgraph/spa-github-pages)). GitHub Pages
  has no server-side rewrite, so a hard refresh or shared link on `/app/leave` 404s without
  it; paired with a `404.html` on the `gh-pages` branch. Verified via a real hard-refresh in
  a headless browser before and after — confirmed broken, then confirmed fixed.

Built with `VITE_API_BASE=https://pulsehr-api-n7il.onrender.com/api npx vite build
--base=/PulseHR/app/`, deployed to the `gh-pages` branch under `/app/`, alongside (not
replacing) the attrition-score prototype picker already at the branch root.

**Live at https://rajibul001i.github.io/PulseHR/app/.** Verified end to end in a real
browser: login, client-side navigation, and a hard refresh mid-session all work correctly
against the live Render API.

**Known limitation, by design, not a bug:** Render's free tier sleeps after 15 minutes idle;
the first request after that takes 30-60s to wake the instance. Acceptable for a demo,
worth knowing about before showing it live to someone.

### 8. Re-ran Muradujjaman's SQA pass — found and fixed a critical, previously-misdiagnosed bug

Re-ran the full test stack against the current build: 102 unit tests, 30 smoke checks, and
`scripts/bughunt.mjs` (the adversarial SQA script from session 2).

**`bughunt.mjs` failed a check that session 2 had waved off as test flakiness.** Its BUG-12
check — *"re-running a completed payroll period issues no duplicate payslips"* — came back
with `undefined` instead of `0`. Polling the job directly (rather than trusting a single
1.5s wait, which is what session 2's harness did) showed why:

```
state: "FAILED", error: "No handler registered for PAYROLL_RUN"
```

**Root cause:** `src/jobs/runPayroll.ts` and `src/jobs/scoreAll.ts` each register their job
handler as a side effect of being *imported* — but `server.ts` never imported either file.
Both handlers existed in the codebase and were never wired up. Every click of **"Run
payroll"** or **"Run scoring batch"** in the running app queued a job that failed
immediately. The unit and smoke suites never caught this because they call the job
*functions* directly (the same path `npm run job:payroll` takes) — nothing exercised the
actual API → queue → handler route a browser click uses.

**Fix:** two import lines in `server.ts`. **Re-verified:** `bughunt.mjs` now passes that
check, and a live payroll run and a live attrition run (`scored: 20`) both reach
`state: "DONE"` end to end.

Full writeup, including the correction to session 2's "timing artefact" claim, in
[`13-sqa-defect-report.md`](13-sqa-defect-report.md) §9.

### 7. Removed working artifacts from the public GitHub history

You flagged that `_source-docs/`, `_source-extracts/` and `_deliverables/` — your original
`.docx`/`.pptx` files, extracted text, and presentation/LinkedIn drafts — didn't belong in
a public repo alongside the actual project deliverables.

Before touching anything: copied all three folders to `E:\PulseHR-removed-from-git-backup\`
outside the repo, since `_source-docs/` is the only version-controlled copy of some of your
original files (the proposal `.docx` itself was already lost earlier this project — see
Session 2 — everything *except* that is in here).

Then, at your explicit request, used `git-filter-repo` to strip all three paths from **every
past commit**, not just the current tree, and force-pushed the rewritten history to
`origin/master`. Added them to `.gitignore` and restored the actual files to their normal
location on disk afterward — they're still exactly where they were, just no longer tracked
or visible on GitHub. Verified the removal against the live GitHub API afterward.

**If anyone else had already cloned this repo** (an instructor, a teammate), their clone now
has a divergent history and will need to re-clone rather than pull.

### 6. `review-animations` pass on the motion diff — 2 findings, both fixed

Reviewed the two motion commits above against a stricter, independent bar (didn't just
rubber-stamp the prior work). Verdict was **Approve** — no feel-breaking regressions — but
flagged two real gaps, both fixed:

- **Cohesion:** `Leave.tsx`'s 4-card balance grid used a group-level `.content-in` fade
  while the structurally identical `Dashboard.tsx` stat-card grid staggered per card.
  Moved `Leave.tsx` to the same per-card `animationDelay` pattern (`Leave.tsx:86-92`).
- **Accessibility (the sharper one):** staggered cards set `animationDelay` via inline
  `style`, which has higher specificity than the `@media (prefers-reduced-motion: reduce)`
  class override — so reduced-motion users still got a sequential 30/60/90ms reveal even
  though the movement itself was correctly suppressed. Fixed with
  `animation-delay: 0ms !important` in the reduced-motion `.content-in` rule
  (`styles.css:278`) — one of the few justified uses of `!important`.

**Verified:** typecheck, build, and a targeted Playwright check reading computed styles
directly — confirmed `animation-delay` resolves to `0s` under emulated reduced motion, and
that `Leave.tsx`'s cards (tested against the `farhana.akter@meridian.test` demo account,
which has an employee record) carry the expected `0/30/60/90/120ms` sequence normally.

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
| 1 | ~~Implement F1.4 password reset~~ — **done 11 Aug, Increment 1 closed** | ~~High~~ |
| 2 | ~~UI Phase 1 — subscription-aware shell, upgrade prompts, seat meter~~ — **done (session 2)** | ~~High~~ |
| 3 | Settle F6.3/F9.1 — do review scores feed the risk model? (SQA recommends no) | **High** |
| 4 | ~~F2.2 contact update, F2.5 documents, F4.4 notifications~~ — **done 12 Aug, Increment 2 closed** | ~~Medium~~ |
| 5 | ~~F5.3 real PDF, F6 OKR, F7 ATS, F8 noticeboard~~ — **done 12 Aug, Increment 3 closed** | ~~Medium~~ |
| 6 | UI Phases 2–4 — toasts, skeletons, empty states, responsive, a11y | Medium |
| 7 | Wire real OKR update counts into the `okrEngagementDrop` attrition feature (currently stubbed 0/0 — see docs/13-sqa-defect-report.md §11) | Low |
| 8 | Payment gateway, proration, invoices | Low (post-MVP) |
| 9 | Verify every Bangladesh Labour Act figure against the consolidated text | **High** |
