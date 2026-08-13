# Load / Stress Test Report — 13 August 2026

**Owner:** Md. Muradujjaman — SQA Lead & Documentation Specialist
**Script:** [`scripts/loadtest.mjs`](../scripts/loadtest.mjs)
**Target:** local dev only — **deliberately not the live Render demo**

> A stress test's entire purpose is to find where a system breaks. Doing that to a public
> URL other people might be looking at, on a free-tier instance that sleeps and shares
> compute with nothing to spare, is the wrong place to run one. This report is entirely
> against `localhost:4000` on the development machine.

Requested scenario: high latency, high output, low throughput, heavy pressure on the
server, multiple companies working at the same time, a mix of old and recently revised
data, and a huge active-user count. Read literally, that's not one test — it's five
different kinds of pressure, so the script isolates each one into its own phase rather than
producing a single number that would average them into meaninglessness.

---

## 1. Method

Node's built-in `fetch`, no new dependency. Five phases, each hammering the running API with
`CONCURRENCY` (default 150) concurrent "virtual users" with **no think-time** between
requests per worker — this is a saturation test, not a paced-usage simulation — for
`PHASE_MS` (default 15s; phase 5 runs for 30s as the sustained combined case).

| Phase | What it isolates | How |
|---|---|---|
| 1. Multi-tenant read storm | "multiple companies working at the same time" | All 3 seeded tenants (Meridian/Enterprise, Bengal/Growth, Dhaka Craft/Starter) hit concurrently across 5 read endpoints |
| 2. High-output stress | "high output" | Real `pdfkit` payslip PDF generation (the heaviest single response this API produces) mixed with large list payloads |
| 3. Mixed read/write | "old and recently revised data" | 30% fresh writes (new notices, immediately re-readable — "recent"), reads of attrition scores computed from years-old seeded hire dates ("old") |
| 4. Login storm | "huge active user" spike | Concurrent logins against the same 3 accounts — password verification is the single most CPU-expensive operation in this API, and a realistic model for a shared HR_ADMIN login used by several staff at once, or a mass sign-in after a company-wide notice |
| 5. Everything at once | "heavy pressure… low throughput" | All of the above, mixed randomly, sustained for 30s — the actual stress figure |

**Every phase run against real seeded/scored/payrolled data** — `npm run job:score` and
`npm run job:payroll -- 2026 7` were run before each measurement, not synthetic fixtures.

### A design decision worth stating plainly

402/403 responses from tier- or role-gated endpoints (2 of the 3 seeded tenants are not
Enterprise, and the script deliberately calls Enterprise-only routes from all 3) are **not**
counted as failures. A load test that reports "40% error rate" when what actually happened
is the entitlement system correctly refusing a Starter tenant an Enterprise feature would be
actively misleading. The report below separates **genuine errors** (5xx, network failures,
an unexpected 4xx) from **correctly gated** requests throughout.

---

## 2. What the first run found

The first full run (150 concurrency, 15s phases) surfaced two real, reproducible problems —
not in the business logic (which the existing 63-check adversarial suite already covers),
but in how the server behaves under concurrency specifically, which nothing in this
project's test suite had exercised before this pass.

### BUG-25a — Severity: **High** · `scryptSync` blocked the event loop for every request in flight

Phase 4 (login storm) alone:

| | Before | After |
|---|---|---|
| Throughput | 7.2 req/s | 32.6 req/s |
| p50 latency | 2,565 ms | 2,880 ms* |
| p99 latency | 2,868–14,723 ms (grew with concurrency) | 3,893 ms |
| Failures | 0 at low concurrency, 54 `fetch failed` at 150 | 0 |

*p50 doesn't drop much — see §3, this is expected and correct, not unfixed.

The finding wasn't really about login being slow (scrypt at `N=16384`, NFR-15's stated
password-hashing cost, is *supposed* to be slow — that's the whole point of the algorithm).
The finding was that **`hashPassword`/`verifyPassword` used `scryptSync`**
(`apps/api/src/auth.ts`), which runs on Node's single main thread and blocks it for the
full duration of the hash. Under concurrent login load, every *other* request in flight —
reads, writes, other tenants entirely — queued behind whatever hash happened to be running.
This is exactly the risk `server.ts`'s own ADR-004 comment warns about for payroll and
attrition scoring; nobody had checked whether the same risk existed in the auth path, because
nothing before this load test put concurrent load on it.

At full concurrency (150), the stall was severe enough that some connections hit
`fetch failed` outright rather than just queueing — 54 requests in the 15-second phase 4
window, and 31 more in the combined phase 5.

**Fix:** switched to the async `scrypt` (Node's `node:crypto`, promisified) —
`apps/api/src/auth.ts`. Same algorithm, same `N`, same output, same security property; the
only change is that libuv's threadpool now does the computation instead of the main thread.
`hashPassword`/`verifyPassword` are now `async`, so their two live call sites
(`/auth/login`, `/auth/reset-password` in `server.ts`) needed converting from the existing
synchronous `handler()` wrapper to a new `asyncHandler()` — added because this was the
**first** genuinely asynchronous route in this API (everything else is synchronous
`node:sqlite` and now-async-scrypt only). `seed.ts`'s two call sites (33 accounts, same
literal demo password each time) were left as a single hash computed once at module load via
top-level `await`, rather than threading async through the whole seeding loop for a one-time
offline script that isn't on any live request path.

**Verified:** re-ran the full regression (107 unit, 30 smoke, 64 bughunt — all green) to
confirm the async conversion changed nothing observable about correctness, then re-ran the
load test (§3) to confirm it changed the actual bottleneck.

### BUG-25b — Severity: Medium · concurrent *correct* logins could trip the lockout

Re-running the load test after the scrypt fix surfaced a second, different problem — a bug
that scrypt's blocking behavior had been *masking*: with the event loop no longer stalled,
far more concurrent login requests for the same email now genuinely overlapped in flight,
and 982 of them in phase 4 (out of 1,551) came back `429 Too Many Requests` — with every
single one using the **correct** password.

Root cause, in `apps/api/src/auth.ts`: the login rate limiter was a single
`checkLoginRateLimit(email)` function that incremented its counter on **every call**, and
only reset it (`clearLoginRateLimit`) after a *successful* login completed. Sequentially,
this is indistinguishable from "count only failures" (BUG-03's test — 8 sequential wrong
passwords for one account, expects lock on the 7th — passed both before and after this fix,
unchanged). But under concurrency, several simultaneous requests for the same email — all
with the right password — each increment the shared counter *before any of them finishes and
clears it*. Six or more legitimate concurrent logins for one account, none of them wrong,
could trip the same 429 a real attacker would get.

Whether this matters in practice depends on how "huge active user" is read: many *different*
users logging in at once never touches this at all, because the counter is per-email — each
user only ever sees their own attempt. It matters specifically for the same account used
concurrently by several people at once, which is a real pattern for a shared HR_ADMIN login
in a small organisation, and is also exactly what this project's own login-storm phase does.

**Fix:** split the single function into `isLockedOut(email)` (read-only) and
`recordFailedLogin(email)` (called only on an actual bad password) —
`apps/api/src/auth.ts`. A successful login, however many arrive concurrently, never touches
the failure counter at all now.

**Verified:** `bughunt.mjs` BUG-25 — 10 concurrent logins with the correct password for one
account, asserting all 10 return 200. This is a deterministic check, not a timing-dependent
one; it doesn't depend on load-test concurrency to reproduce the race. BUG-03's original
sequential-failure test (§ above) still passes unchanged — the fix only changes what happens
to *successful* concurrent attempts.

---

## 3. Final numbers — after both fixes, clean server restart

150 concurrent virtual users, 15s phases (30s for phase 5), against a freshly reseeded,
scored, and payrolled server.

| Phase | Requests | Correctly gated | Genuine errors | Throughput | p50 | p95 | p99 | Max |
|---|---|---|---|---|---|---|---|---|
| 1. Multi-tenant read storm | 5,829 | 1,183 | **0** | 377.3 req/s | 380ms | 471ms | 554ms | 725ms |
| 2. High-output (PDF) | 1,257 | 0 | **0** | 80.4 req/s | 740ms | 959ms | 1,072ms | 1,109ms |
| 3. Mixed read/write | 4,197 | 0 | **0** | 269.9 req/s | 552ms | 637ms | 1,014ms | 1,461ms |
| 4. Login storm | 579 | 0 | **0** | 32.6 req/s | 2,880ms | 3,614ms | 3,893ms | 4,027ms |
| 5. Everything at once | 4,997 | 662 | **0** | 147.4 req/s | 131ms | 5,328ms | 5,703ms | 5,821ms |

**16,859 total requests across the run. Zero genuine errors.** 1,845 correctly gated
(business logic doing exactly what it's supposed to for non-entitled tenants).

### Reading phase 4 and 5 correctly

Login latency (p50 ~2.9s, max ~4s) did **not** drop much from the pre-fix numbers, and that
is the correct outcome, not an unfixed bug. `scrypt` at `N=16384` costs roughly the same CPU
time whichever thread runs it — the fix moves *where* that cost is paid, not how much it
costs. What changed is that the cost is now **contained**: reads and writes for unrelated
requests (phases 1–3) stayed in the 350–750ms range at the *same* concurrency that used to
push login latency past 14 seconds, and phase 5's own p50 of 131ms — with only its p95/p99
elevated — shows the fast majority of mixed traffic staying fast while the login subset
absorbs its own real cost, instead of dragging everything else down with it. Before the fix,
there was no such thing as "the login subset's cost" as a separate line item — it was
everyone's cost, because the whole process was blocked.

Node's default libuv threadpool is 4 threads, so ~4 scrypt computations run genuinely in
parallel; the rest queue on the threadpool specifically (not the event loop). That queue is
now the actual, honest bottleneck for concurrent auth load — a single-process Node
deployment with default threadpool sizing has a real, finite login throughput ceiling around
30-35 req/s at this hash cost. Raising `UV_THREADPOOL_SIZE` or scaling horizontally are the
two real levers if that ceiling becomes a production problem; lowering `N` is not one of
them (NFR-15 sets that cost deliberately, for a reason unrelated to throughput).

### Everything else, evaluated on its own terms

- **Phase 1 (multi-tenant reads):** 377 req/s, p99 under 600ms at 150 concurrent users
  across 3 tenants simultaneously. No tenant-isolation leakage under load — every response
  was scoped correctly (verified structurally by the adversarial suite, not by this script).
- **Phase 2 (PDF generation):** the heaviest per-request payload this API produces, p99 just
  over 1s at 150-capped-to-60 concurrency (payslip PDF is genuinely CPU-bound `pdfkit`
  rendering; concurrency was capped here deliberately to avoid conflating "PDF generation is
  costly" — expected — with "PDF generation blocks everything else" — which it does not,
  confirmed by phase 1/3's numbers staying independent).
- **Phase 3 (mixed read/write, old + fresh data):** 270 req/s with writes landing correctly
  next to reads of years-old seeded records — no corruption, no lock contention surfaced
  (SQLite's WAL mode, already configured in `db.ts`, is doing its job here).

---

## 4. What this test does not tell you

Stated plainly rather than left implicit:

- **Single process, single machine.** This is Node's default single-threaded-event-loop
  model on one developer laptop. It says nothing about how the system behaves horizontally
  scaled behind a load balancer, which is how a real "huge active user" count would actually
  be served.
- **No artificial network latency was injected.** "High latency" in the request was read as
  *characterizing* latency under load (what this report measures), not manufacturing WAN
  conditions — the local network path is effectively zero-latency, so every millisecond
  reported above is server-side processing time, not network time.
- **The free-tier Render demo was never touched**, by design (see the banner at the top).
  Its cold-start and shared-compute behavior is a different, already-documented problem
  (`docs/WORK-UPDATE.md` Session 4 §2), not something this pass re-measured.
- **This is a synthetic saturation test, not a realistic usage simulation.** Zero think-time
  between requests per virtual user is deliberately unrealistic — it's what makes this a
  stress test rather than a load test in the gentler sense. Real users type, read, and pause
  between actions; 150 real concurrent users would produce meaningfully less request volume
  than 150 synthetic workers in a tight loop.

---

## 5. Regression protection added

| Finding | Permanent test |
|---|---|
| BUG-25a (scrypt blocking) | Not directly testable as a unit/integration check — a timing property under load, not a correctness property. Guarded instead by keeping `hashPassword`/`verifyPassword` async (a type-level guarantee: reverting to `*Sync` would need every call site to change back) and by this report as the record of why. |
| BUG-25b (rate-limiter race) | `bughunt.mjs` BUG-25 — 10 concurrent correct-password logins, asserts zero 429s. Deterministic, not timing-dependent. |
| BUG-03 (unchanged) | `bughunt.mjs` BUG-03 — still asserts lock on exactly the 7th sequential wrong-password attempt. |

## 6. Test totals after this pass

| Suite | Count | Status |
|---|---|---|
| Unit (`packages/core`) | 107 | ✅ all passing |
| Integration smoke | 30 | ✅ all passing |
| Adversarial bug hunt | 64 | ✅ all passing — 0 defects |
| Load/stress (`scripts/loadtest.mjs`) | 5 phases, 16,859 requests | ✅ 0 genuine errors after fixes |

Full regression re-run on a clean reseed after every code change in this report — no result
above was taken from a server process that had also served an earlier run's traffic.
