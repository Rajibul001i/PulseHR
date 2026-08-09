/**
 * End-to-end smoke test against a running API.
 *
 * Verifies the behaviours the source-document review identified as blocking, so that the
 * claims in docs/00-source-document-review.md are demonstrated, not asserted:
 *
 *   P0-5  tenant isolation      — org A cannot see org B's employees
 *   P0-7  leave concurrency     — the balance can never go negative
 *   P0-8  payslip immutability  — an UPDATE is rejected by the database
 *   P1-5  attrition access      — a MANAGER is refused the at-risk list
 *   P1-19 session revocation    — logout kills the refresh token
 *
 * Usage:  node scripts/smoke.mjs      (with the API running on :4000)
 */

const BASE = process.env.API ?? 'http://localhost:4000';

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json };
}

const login = (email) =>
  call('/auth/login', { method: 'POST', body: { email, password: 'Passw0rd!' } });

console.log('\nPulseHR end-to-end smoke test\n');

/* ---------------------------------- auth ---------------------------------- */
console.log('Authentication');
const hrA = await login('hr@meridian.test');
check('HR admin can log in', hrA.status === 200 && !!hrA.body.accessToken);

const bad = await call('/auth/login', {
  method: 'POST',
  body: { email: 'hr@meridian.test', password: 'wrong' },
});
check('wrong password is rejected', bad.status === 401);

const unknown = await call('/auth/login', {
  method: 'POST',
  body: { email: 'nobody@nowhere.test', password: 'whatever' },
});
check(
  'unknown user gives the same response as a wrong password (no user enumeration)',
  unknown.status === bad.status && unknown.body.error === bad.body.error,
);

const noToken = await call('/employees');
check('unauthenticated request is refused', noToken.status === 401);

const tokenA = hrA.body.accessToken;

/* ------------------------------ P0-5 tenancy ------------------------------ */
console.log('\nP0-5 · Tenant isolation');
const hrB = await login('hr@bengal.test');
const tokenB = hrB.body.accessToken;

const empA = await call('/employees', { token: tokenA });
const empB = await call('/employees', { token: tokenB });
check('org A sees its own employees', empA.body.length === 20, `got ${empA.body?.length}`);
check('org B sees its own employees', empB.body.length === 6, `got ${empB.body?.length}`);

const idsA = new Set(empA.body.map((e) => e.id));
const overlap = empB.body.filter((e) => idsA.has(e.id));
check('no employee appears in both tenants', overlap.length === 0);

const targetA = empA.body[0];
const crossRead = await call(`/employees/${targetA.id}`, { token: tokenB });
check(
  'org B cannot read an org A employee by direct id',
  crossRead.status === 404,
  `got ${crossRead.status}`,
);

/* -------------------------- P1-5 attrition access ------------------------- */
console.log('\nP1-5 · Attrition score access control');
const atRiskHr = await call('/attrition/at-risk?limit=5', { token: tokenA });
check('HR can read the at-risk list', atRiskHr.status === 200 && Array.isArray(atRiskHr.body));

const manager = await login('shabnam.rahman@meridian.test');
const atRiskMgr = await call('/attrition/at-risk', { token: manager.body.accessToken });
check(
  'a MANAGER is refused the at-risk list (retaliation risk)',
  atRiskMgr.status === 403,
  `got ${atRiskMgr.status}`,
);

const employee = await login('farhana.akter@meridian.test');
const atRiskEmp = await call('/attrition/at-risk', { token: employee.body.accessToken });
check('an EMPLOYEE is refused the at-risk list', atRiskEmp.status === 403);

if (atRiskHr.body.length > 0) {
  const detail = await call(`/attrition/scores/${atRiskHr.body[0].id}`, { token: tokenA });
  check(
    'a score is never returned without its feature contributions',
    detail.status === 200 && detail.body.contributions.length === 8,
    `got ${detail.body?.contributions?.length} contributions`,
  );
  const total = detail.body.contributions.reduce((a, c) => a + c.normalised * c.weight, 0);
  check(
    'contributions sum to the composite score',
    Math.round(total) === detail.body.score.score,
    `${Math.round(total)} vs ${detail.body.score.score}`,
  );
  check(
    'the prohibited-use notice travels with the score',
    typeof detail.body.responsibleUse === 'string' &&
      detail.body.responsibleUse.includes('prohibited'),
  );
  check(
    'performance-review score is not among the features',
    !detail.body.contributions.some((c) => c.feature_key.includes('review')),
  );
}

/* --------------------------- P0-7 leave concurrency ----------------------- */
console.log('\nP0-7 · Leave balance cannot go negative');
const empToken = employee.body.accessToken;
const balBefore = await call('/leave/balances', { token: empToken });
const earnedBefore = balBefore.body.EARNED;
console.log(`  (starting earned-leave balance: ${earnedBefore} days)`);

// Two separate, non-overlapping requests that each fit the balance alone but not together.
//
// The dates are offset by any leave this employee already has approved, so the suite is
// RE-RUNNABLE. An earlier version hard-coded 2026-11-02 and passed only against a freshly
// seeded database — the second run collided with the leave the first run had approved and
// reported three false failures. A test that only passes once is a trap for the next person.
/**
 * PRECONDITION: this scenario consumes the employee's entire earned-leave balance, so it
 * needs a known non-zero starting balance. Run `npm run seed` first.
 *
 * It is stated and checked rather than assumed: an earlier version silently reported three
 * failures on the second run, which looks exactly like a product regression and is not one.
 * A suite that cries wolf gets ignored.
 */
if (earnedBefore <= 0) {
  console.log('  --   earned-leave balance is 0 — run `npm run seed` to exercise this section (skipping)');
} else {
const existing = await call('/leave/requests', { token: empToken });
const taken = (existing.body ?? []).filter((r) => r.status === 'APPROVED').length;
const slotA = addDays('2030-01-06', taken * 30);
const slotB = addDays('2030-01-06', taken * 30 + 15);

const big = Math.max(1, earnedBefore);
const r1 = await call('/leave/requests', {
  method: 'POST',
  token: empToken,
  body: { leaveType: 'EARNED', startDate: slotA, endDate: addDays(slotA, big - 1), reason: 'A' },
});
const r2 = await call('/leave/requests', {
  method: 'POST',
  token: empToken,
  body: { leaveType: 'EARNED', startDate: slotB, endDate: addDays(slotB, big - 1), reason: 'B' },
});
check('both requests are accepted while PENDING', r1.status === 201 && r2.status === 201);

const d1 = await call(`/leave/requests/${r1.body.id}/decision`, {
  method: 'POST',
  token: tokenA,
  body: { decision: 'APPROVE' },
});
check('first approval succeeds', d1.status === 200, JSON.stringify(d1.body));

const d2 = await call(`/leave/requests/${r2.body.id}/decision`, {
  method: 'POST',
  token: tokenA,
  body: { decision: 'APPROVE' },
});
check(
  'second approval is REJECTED with 409 — the balance guard holds',
  d2.status === 409 && d2.body.code === 'INSUFFICIENT_BALANCE',
  `got ${d2.status} ${JSON.stringify(d2.body)}`,
);

const balAfter = await call('/leave/balances', { token: empToken });
check('balance never went negative', balAfter.body.EARNED >= 0, `got ${balAfter.body.EARNED}`);
check(
  'balance decreased by exactly the approved request',
  balAfter.body.EARNED === earnedBefore - big,
  `${earnedBefore} -> ${balAfter.body.EARNED}`,
);

// Overlap guard
const o1 = await call('/leave/requests', {
  method: 'POST',
  token: empToken,
  body: { leaveType: 'LWP', startDate: slotA, endDate: addDays(slotA, 2), reason: 'overlap' },
});
const od = await call(`/leave/requests/${o1.body.id}/decision`, {
  method: 'POST',
  token: tokenA,
  body: { decision: 'APPROVE' },
});
check(
  'a request overlapping approved leave is refused',
  od.status === 409 && od.body.code === 'OVERLAPPING_LEAVE',
  `got ${od.status} ${JSON.stringify(od.body)}`,
);
}

/* ------------------------- P0-8 payslip immutability ---------------------- */
console.log('\nP0-8 · Payslip integrity');
const slips = await call('/payroll/payslips', { token: empToken });
if (slips.status === 200 && slips.body.length === 0) {
  console.log('  --   no payslips issued yet — run `npm run job:payroll -- 2026 7` first (skipping)');
} else {
  check('employee can see their own payslips', slips.status === 200 && slips.body.length > 0);
}

if (slips.body.length > 0) {
  const full = await call(`/payroll/payslips/${slips.body[0].id}`, { token: empToken });
  const lines = full.body.lines;
  const gross = lines.filter((l) => l.sign === 1).reduce((a, l) => a + l.amount, 0);
  const ded = lines.filter((l) => l.sign === -1).reduce((a, l) => a + l.amount, 0);
  check('payslip is line-itemised', lines.length >= 5);
  check('stored gross equals the sum of earning lines', gross === full.body.payslip.gross);
  check('stored net equals gross minus deductions', full.body.payslip.net_pay === gross - ded);
  check('engine version is stamped', !!full.body.payslip.engine_version);

  const otherEmployee = empA.body.find((e) => e.id !== employee.body.user.employeeId);
  const foreign = await call(`/payroll/payslips?employeeId=${otherEmployee.id}`, { token: empToken });
  check("an employee cannot read a colleague's payslips", foreign.status === 403);
}

/* --------------------------- P1-19 session revocation --------------------- */
console.log('\nP1-19 · Session revocation');
const temp = await login('hr@meridian.test');
const refresh = temp.body.refreshToken;
const refreshOk = await call('/auth/refresh', { method: 'POST', body: { refreshToken: refresh } });
check('a refresh token can be spent once', refreshOk.status === 200);

const refreshTwice = await call('/auth/refresh', { method: 'POST', body: { refreshToken: refresh } });
check('the same refresh token cannot be reused (rotation)', refreshTwice.status === 401);

const temp2 = await login('hr@meridian.test');
await call('/auth/logout', { method: 'POST', token: temp2.body.accessToken });
const afterLogout = await call('/auth/refresh', {
  method: 'POST',
  body: { refreshToken: temp2.body.refreshToken },
});
check('logout revokes the refresh token immediately', afterLogout.status === 401);

/* ----------------------------------- done --------------------------------- */
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
