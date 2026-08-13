/**
 * Load / stress test — local dev only, deliberately NOT the live Render demo. A single
 * free-tier instance would degrade for every other viewer while this runs, and the point of
 * a stress test is to find where a system breaks, which is not something to do to a public
 * URL other people are looking at.
 *
 * Scenario requested: high latency, high output, low throughput, heavy pressure on the
 * server, multiple companies (tenants) working at the same time, a mix of old and recently
 * revised data, and a huge active-user count. Five phases, each isolating one of those:
 *
 *   1. Multi-tenant read storm    — all 3 seeded tenants hit concurrently (multiple companies)
 *   2. High-output stress         — PDF payslip generation + large list payloads
 *   3. Mixed read/write pressure  — writes creating fresh data next to years-old seeded rows
 *   4. Login storm                — password verification is the single most CPU-expensive
 *                                    operation in this API; a mass-login event (e.g. after a
 *                                    company-wide notice) is a realistic "huge active user" spike
 *   5. Everything at once         — all four combined, sustained, for the actual stress figure
 *
 * This API is Node's built-in `node:sqlite` (DatabaseSync) end to end — synchronous, and
 * per server.ts's own ADR-004 comment, a long synchronous call blocks the event loop for
 * every other request in flight. That is exactly the failure mode this script is built to
 * surface: not "does it crash" but "does p99 latency blow up under concurrency because one
 * slow synchronous call froze everyone else."
 *
 * Usage: node scripts/loadtest.mjs   (API running on :4000, freshly seeded, scored, payrolled)
 */

const BASE = process.env.API ?? 'http://localhost:4000';

/* ------------------------------- utilities ------------------------------- */

function percentile(sortedMs, p) {
  if (sortedMs.length === 0) return 0;
  const idx = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1);
  return sortedMs[Math.max(0, idx)];
}

async function timed(fn) {
  const start = performance.now();
  try {
    const res = await fn();
    // Drain the body so the connection is actually released back to the pool — an
    // un-consumed body under high concurrency is its own throughput bug to rule out.
    if (res.body) await res.arrayBuffer().catch(() => {});
    return { ok: res.ok, status: res.status, ms: performance.now() - start };
  } catch (err) {
    return { ok: false, status: 0, ms: performance.now() - start, error: String(err?.message ?? err) };
  }
}

function call(path, { method = 'GET', body, token } = {}) {
  return () =>
    fetch(`${BASE}/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
}

async function login(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Passw0rd!' }),
  });
  return res.json();
}

/**
 * Runs `pickRequest()` concurrently across `concurrency` workers for `durationMs`, with no
 * think-time between requests per worker — this is deliberately a saturation test, not a
 * realistic user-pacing simulation. Returns every sample so the caller can compute whatever
 * it needs.
 */
async function hammer({ concurrency, durationMs, pickRequest }) {
  const samples = [];
  const deadline = performance.now() + durationMs;

  async function worker() {
    while (performance.now() < deadline) {
      const requestFn = pickRequest();
      samples.push(await timed(requestFn));
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return samples;
}

// 402/403 against a tier-gated or role-gated route are the entitlement system working as
// designed (2 of the 3 seeded tenants are not Enterprise, and this script deliberately
// hits Enterprise-only endpoints from all 3) — counting them as "failed" would make a
// correctly-behaving system look broken. Only 5xx, network errors, and unexpected 4xx
// (a 400 this script's own request shape didn't anticipate) count as genuine errors.
function classify(s) {
  if (s.ok) return 'ok';
  if (s.status === 402 || s.status === 403) return 'gated';
  return 'error';
}

function report(phaseName, samples, wallMs) {
  const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
  const ok = samples.filter((s) => classify(s) === 'ok').length;
  const gated = samples.filter((s) => classify(s) === 'gated').length;
  const errors = samples.filter((s) => classify(s) === 'error');
  const byStatus = {};
  for (const s of samples) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;

  const throughput = (samples.length / wallMs) * 1000;
  const p50 = percentile(ms, 50);
  const p95 = percentile(ms, 95);
  const p99 = percentile(ms, 99);
  const max = ms[ms.length - 1] ?? 0;

  console.log(`\n## ${phaseName}`);
  console.log(`  requests        ${samples.length}   (${ok} ok, ${gated} correctly gated by entitlement, ${errors.length} genuine errors)`);
  console.log(`  throughput      ${throughput.toFixed(1)} req/s`);
  console.log(`  latency         p50 ${p50.toFixed(0)}ms · p95 ${p95.toFixed(0)}ms · p99 ${p99.toFixed(0)}ms · max ${max.toFixed(0)}ms`);
  console.log(`  status codes    ${JSON.stringify(byStatus)}`);
  if (errors.length > 0) {
    const sample = errors.slice(0, 3).map((e) => e.error ?? `status ${e.status}`);
    console.log(`  sample genuine errors   ${sample.join(' | ')}`);
  }

  return { phaseName, requests: samples.length, ok, gated, errors: errors.length, throughput, p50, p95, p99, max, byStatus };
}

/* ------------------------------- setup ----------------------------------- */

console.log('PulseHR load / stress test — local dev only\n');
console.log(`Target: ${BASE}`);

const tenants = [
  { name: 'Meridian Textiles (ENTERPRISE)', hr: 'hr@meridian.test', mgr: 'shabnam.rahman@meridian.test', emp: 'farhana.akter@meridian.test' },
  { name: 'Bengal Logistics (GROWTH)', hr: 'hr@bengal.test', mgr: null, emp: null },
  { name: 'Dhaka Craft Apparels (STARTER)', hr: 'hr@dhakacraft.test', mgr: null, emp: null },
];

for (const t of tenants) {
  t.hrAuth = await login(t.hr);
  if (!t.hrAuth?.accessToken) {
    console.error(`FATAL: could not log in as ${t.hr} — is the API running and seeded?`);
    process.exit(1);
  }
  if (t.mgr) t.mgrAuth = await login(t.mgr);
  if (t.emp) t.empAuth = await login(t.emp);
}
console.log(`Logged in as HR admin for ${tenants.length} tenants (multiple companies working concurrently, by design).\n`);

// One real score id and one real payslip id per tenant, so phase 2/3 hit real records
// (some of them years-old seeded rows — the "old data" half of the mixed-freshness ask)
// instead of 404ing the whole phase.
for (const t of tenants) {
  const at = await (await call('/attrition/at-risk?limit=5', { token: t.hrAuth.accessToken })()).json();
  t.scoreId = at?.[0]?.id ?? null;
  const employees = await (await call('/employees', { token: t.hrAuth.accessToken })()).json();
  t.employees = employees ?? [];
  t.employeeId = t.employees[0]?.id ?? null;
  const payslips = t.employeeId
    ? await (await call(`/payroll/payslips?employeeId=${t.employeeId}`, { token: t.hrAuth.accessToken })())
        .json()
        .catch(() => [])
    : [];
  t.payslipId = Array.isArray(payslips) ? payslips[0]?.id ?? null : null;
}

const CONCURRENCY = Number(process.env.LOADTEST_CONCURRENCY ?? 150);
const PHASE_MS = Number(process.env.LOADTEST_PHASE_MS ?? 15000);
console.log(`Concurrency: ${CONCURRENCY} simulated concurrent active users per phase. Phase length: ${PHASE_MS}ms.\n`);

const results = [];

/* ------------------------- phase 1: multi-tenant read storm --------------- */
{
  const readPaths = () => {
    const t = tenants[Math.floor(Math.random() * tenants.length)];
    const options = [
      call('/attrition/at-risk?limit=20', { token: t.hrAuth.accessToken }),
      call('/employees', { token: t.hrAuth.accessToken }),
      call('/notices', { token: t.hrAuth.accessToken }),
      call('/subscription', { token: t.hrAuth.accessToken }),
      t.employeeId
        ? call(`/okr/objectives?quarter=2026-Q3&employeeId=${t.employeeId}`, { token: t.hrAuth.accessToken })
        : call('/subscription', { token: t.hrAuth.accessToken }),
    ];
    return options[Math.floor(Math.random() * options.length)];
  };
  const start = performance.now();
  const samples = await hammer({ concurrency: CONCURRENCY, durationMs: PHASE_MS, pickRequest: readPaths });
  results.push(report('Phase 1 — multi-tenant read storm (3 companies concurrently)', samples, performance.now() - start));
}

/* ------------------------- phase 2: high-output stress --------------------- */
{
  const highOutput = () => {
    const t = tenants[Math.floor(Math.random() * tenants.length)];
    if (t.payslipId && Math.random() < 0.5) {
      // Real PDF generation (pdfkit) per request — CPU-bound, synchronous, the single
      // heaviest per-request payload this API produces.
      return call(`/payroll/payslips/${t.payslipId}/pdf`, { token: t.hrAuth.accessToken });
    }
    return call('/employees', { token: t.hrAuth.accessToken });
  };
  const missingPayslip = tenants.filter((t) => !t.payslipId).map((t) => t.name);
  if (missingPayslip.length) {
    console.log(`\n(note: no payslip found for ${missingPayslip.join(', ')} — falling back to the list endpoint for those requests)`);
  }
  const start = performance.now();
  const samples = await hammer({ concurrency: Math.min(CONCURRENCY, 60), durationMs: PHASE_MS, pickRequest: highOutput });
  results.push(report('Phase 2 — high-output stress (PDF generation + large payloads)', samples, performance.now() - start));
}

/* ------------------------- phase 3: mixed read/write, old + fresh data ----- */
{
  let noticeCounter = 0;
  const mixed = () => {
    const t = tenants[Math.floor(Math.random() * tenants.length)];
    const roll = Math.random();
    if (roll < 0.3 && t.employeeId) {
      // Fresh write, immediately re-readable — "recently revised data"
      noticeCounter++;
      return call('/notices', {
        method: 'POST',
        token: t.hrAuth.accessToken,
        body: { title: `Load-test notice ${noticeCounter}`, body: 'Generated by scripts/loadtest.mjs', audienceType: 'COMPANY', departmentIds: [], isUrgent: false },
      });
    }
    if (roll < 0.5 && t.scoreId) {
      // Reads a score computed from years-old hire-date data — "old data"
      return call(`/attrition/scores/${t.scoreId}`, { token: t.hrAuth.accessToken });
    }
    return call('/notices', { token: t.hrAuth.accessToken });
  };
  const start = performance.now();
  const samples = await hammer({ concurrency: CONCURRENCY, durationMs: PHASE_MS, pickRequest: mixed });
  results.push(report('Phase 3 — mixed read/write (old seeded records + fresh writes concurrently)', samples, performance.now() - start));
}

/* ------------------------- phase 4: login storm ----------------------------- */
{
  const emails = tenants.map((t) => t.hr);
  const loginReq = () => {
    const email = emails[Math.floor(Math.random() * emails.length)];
    return call('/auth/login', { method: 'POST', body: { email, password: 'Passw0rd!' } });
  };
  const start = performance.now();
  const samples = await hammer({ concurrency: Math.min(CONCURRENCY, 100), durationMs: PHASE_MS, pickRequest: loginReq });
  results.push(report('Phase 4 — login storm (password verification is the heaviest single op in this API)', samples, performance.now() - start));
}

/* ------------------------- phase 5: everything at once ---------------------- */
{
  const all = [];
  for (const t of tenants) {
    all.push(call('/attrition/at-risk?limit=20', { token: t.hrAuth.accessToken }));
    all.push(call('/employees', { token: t.hrAuth.accessToken }));
    all.push(call('/notices', { token: t.hrAuth.accessToken }));
    if (t.scoreId) all.push(call(`/attrition/scores/${t.scoreId}`, { token: t.hrAuth.accessToken }));
    if (t.payslipId) all.push(call(`/payroll/payslips/${t.payslipId}/pdf`, { token: t.hrAuth.accessToken }));
    all.push(call('/auth/login', { method: 'POST', body: { email: t.hr, password: 'Passw0rd!' } }));
  }
  const pick = () => all[Math.floor(Math.random() * all.length)];
  const start = performance.now();
  const samples = await hammer({ concurrency: CONCURRENCY, durationMs: PHASE_MS * 2, pickRequest: pick });
  results.push(report('Phase 5 — everything at once, sustained (the actual stress figure)', samples, performance.now() - start));
}

/* ------------------------------- summary ------------------------------------ */
console.log('\n\n=== Summary ===\n');
console.log('| Phase | Requests | Gated (402/403, expected) | Genuine errors | Throughput (req/s) | p50 | p95 | p99 | Max |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
  console.log(
    `| ${r.phaseName} | ${r.requests} | ${r.gated} | ${r.errors} | ${r.throughput.toFixed(1)} | ${r.p50.toFixed(0)}ms | ${r.p95.toFixed(0)}ms | ${r.p99.toFixed(0)}ms | ${r.max.toFixed(0)}ms |`,
  );
}

const totalErrors = results.reduce((a, r) => a + r.errors, 0);
const totalGated = results.reduce((a, r) => a + r.gated, 0);
const worstP99 = Math.max(...results.map((r) => r.p99));
console.log(`\nTotal requests: ${results.reduce((a, r) => a + r.requests, 0)}, correctly gated: ${totalGated}, genuine errors: ${totalErrors}`);
console.log(`Worst p99 latency across all phases: ${worstP99.toFixed(0)}ms`);
console.log(
  worstP99 > 5000
    ? '\nFINDING: p99 latency exceeded 5s under load — consistent with event-loop blocking from a synchronous DB/PDF call. See docs/17-load-test-report.md.'
    : '\nNo phase showed p99 latency consistent with event-loop stalling under this concurrency.',
);
if (totalErrors > 0) {
  console.log(`FINDING: ${totalErrors} requests failed for reasons other than entitlement gating — see the "sample genuine errors" lines above.`);
}
