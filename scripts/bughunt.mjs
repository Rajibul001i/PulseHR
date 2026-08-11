/**
 * Adversarial bug hunt — SQA Lead (Muradujjaman).
 *
 * The smoke suite proves the things we designed FOR. This script attacks the things we
 * did not: it checks the running system against the team's own 49 user stories and the
 * API contract we published, looking for gaps between what we CLAIMED and what we BUILT.
 *
 * A check that "fails" here is a defect found — which is the point.
 *
 * Usage:  node scripts/bughunt.mjs      (with the API running on :4000)
 */

const BASE = process.env.API ?? 'http://localhost:4000';

const findings = [];
let checks = 0;

function expect(id, story, description, condition, actual = '') {
  checks++;
  if (condition) {
    console.log(`  ok   ${id}  ${description}`);
  } else {
    console.log(`  BUG  ${id}  ${description}${actual ? `  [${actual}]` : ''}`);
    findings.push({ id, story, description, actual });
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
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, body: json };
}

const login = (email) =>
  call('/auth/login', { method: 'POST', body: { email, password: 'Passw0rd!' } });

console.log('\nPulseHR adversarial bug hunt\n');

const hrA = (await login('hr@meridian.test')).body;
const hrB = (await login('hr@bengal.test')).body;
const mgr = (await login('shabnam.rahman@meridian.test')).body;
const emp = (await login('farhana.akter@meridian.test')).body;

/* ---------------------------------------------------------------------- */
console.log('F1 · Authentication & Role Management');

// US-04: "A Manager opening the attendance report sees only their own department."
{
  const grid = await call('/attendance/grid?from=2026-07-01&to=2026-07-31', {
    token: mgr.accessToken,
  });
  const names = new Set((grid.body ?? []).map((r) => r.full_name));
  expect(
    'BUG-01',
    'US-04',
    'Manager attendance report is scoped to their own department',
    grid.status === 200 && names.size > 0 && names.size <= 8,
    `manager sees ${names.size} employees across all departments`,
  );
}

// API contract §4 says /attendance/grid is MANAGER+HR. Is it actually enforced?
{
  const grid = await call('/attendance/grid?from=2026-07-01&to=2026-07-31', {
    token: emp.accessToken,
  });
  expect(
    'BUG-02',
    'US-04',
    'Plain EMPLOYEE is refused the org-wide attendance grid',
    grid.status === 403,
    `got ${grid.status}, ${(grid.body ?? []).length} rows of colleagues' attendance`,
  );
}

// US-02: "Six consecutive failed attempts lock the account for a cool-down period."
{
  let lockedAt = null;
  for (let i = 1; i <= 8; i++) {
    const r = await call('/auth/login', {
      method: 'POST',
      body: { email: 'lockme@meridian.test', password: 'wrong' },
    });
    if (r.status === 429 && lockedAt === null) lockedAt = i;
  }
  expect(
    'BUG-03',
    'US-02',
    'Account locks after exactly 6 consecutive failed attempts',
    lockedAt === 7,
    `locked after attempt ${lockedAt} (story says 6 failures, then lock)`,
  );
}

// US-05: password reset. Acceptance criteria: a reset link/token only for a registered
// address, expires in 30 minutes, single-use. Exercised as a black box, the same path the
// frontend takes (no direct DB access) -- the demoResetToken field is this prototype's
// stand-in for "the link that would have been emailed" (no email provider is configured).
{
  const known = await call('/auth/forgot-password', {
    method: 'POST',
    body: { email: 'farhana.akter@meridian.test' },
  });
  expect(
    'BUG-04',
    'US-05',
    'Password-reset request issues a token for a registered address',
    known.status === 200 && typeof known.body?.demoResetToken === 'string',
    `got ${known.status}, demoResetToken=${known.body?.demoResetToken}`,
  );

  const unknown = await call('/auth/forgot-password', {
    method: 'POST',
    body: { email: 'nobody-at-all@meridian.test' },
  });
  expect(
    'BUG-04',
    'US-05',
    'Password-reset gives the same response for an unregistered address (no enumeration)',
    unknown.status === known.status && unknown.body?.message === known.body?.message && !unknown.body?.demoResetToken,
    `got ${unknown.status} ${JSON.stringify(unknown.body)}`,
  );

  const token = known.body?.demoResetToken;
  const NEW_PASSWORD = 'ResetByBughunt1!';
  const reset = await call('/auth/reset-password', { method: 'POST', body: { token, password: NEW_PASSWORD } });
  expect('BUG-04', 'US-05', 'The issued token actually resets the password', reset.status === 200, `got ${reset.status}`);

  const reuse = await call('/auth/reset-password', { method: 'POST', body: { token, password: 'AnotherOne1!' } });
  expect(
    'BUG-04',
    'US-05',
    'A used reset token cannot be used a second time',
    reuse.status === 400,
    `got ${reuse.status} -- reused a spent token`,
  );

  const loginNew = await call('/auth/login', {
    method: 'POST',
    body: { email: 'farhana.akter@meridian.test', password: NEW_PASSWORD },
  });
  expect('BUG-04', 'US-05', 'Sign-in works with the new password', loginNew.status === 200, `got ${loginNew.status}`);

  // Put the seed password back so the rest of this run (and re-runs) aren't affected.
  const freshToken = (
    await call('/auth/forgot-password', { method: 'POST', body: { email: 'farhana.akter@meridian.test' } })
  ).body?.demoResetToken;
  await call('/auth/reset-password', { method: 'POST', body: { token: freshToken, password: 'Passw0rd!' } });
}

/* ---------------------------------------------------------------------- */
console.log('\nF2 · Employee Information');

// US-09: employee updates their own contact details
{
  const r = await call('/me/contact', {
    method: 'POST',
    token: emp.accessToken,
    body: { phone: '01700000000' },
  });
  expect('BUG-05', 'US-09', 'Employee can update own contact details (F2.2)', r.status !== 404, `got ${r.status}`);
}

// US-11: employee search & filter
{
  const r = await call('/employees?q=Farhana', { token: hrA.accessToken });
  const all = await call('/employees', { token: hrA.accessToken });
  expect(
    'BUG-06',
    'US-11',
    'Employee directory supports search/filter (F2.4)',
    r.status === 200 && (r.body ?? []).length < (all.body ?? []).length,
    `?q= ignored — returned all ${(r.body ?? []).length} employees`,
  );
}

/* ---------------------------------------------------------------------- */
console.log('\nF3 · Attendance');

// Class diagram: Department.officeStartTime — lateness must be per-department.
{
  const r = await call('/departments', { token: hrA.accessToken });
  expect(
    'BUG-07',
    'Class:Department',
    'Departments are exposed with a configurable officeStartTime',
    r.status === 200 && Array.isArray(r.body) && r.body.length > 0 && 'officeStartTime' in (r.body[0] ?? {}),
    `got ${r.status} — lateness threshold is hard-coded at 09:00 for every department`,
  );
}

// Double check-in should not silently overwrite the original timestamp.
{
  const first = await call('/attendance/check-in', { method: 'POST', token: emp.accessToken });
  const second = await call('/attendance/check-in', { method: 'POST', token: emp.accessToken });
  expect(
    'BUG-08',
    'F3.1',
    'A second check-in on the same day is rejected, not silently overwritten',
    second.status === 409,
    `got ${second.status} — original check-in ${first.body?.checkIn} was overwritten`,
  );
}

/* ---------------------------------------------------------------------- */
console.log('\nF4 · Leave');

// US: a manager approves their own team, not the whole company.
{
  const q = await call('/leave/requests?status=PENDING', { token: mgr.accessToken });
  const emps = new Set((q.body ?? []).map((r) => r.employeeId));
  const reports = await call('/employees', { token: mgr.accessToken });
  expect(
    'BUG-09',
    'US-14',
    "Manager's approval queue is limited to their direct reports",
    q.status === 200 && emps.size <= 8,
    `manager sees ${emps.size} employees' requests across the whole company`,
  );
}

// Leave dated in the past should be refused.
{
  const r = await call('/leave/requests', {
    method: 'POST',
    token: emp.accessToken,
    body: { leaveType: 'CASUAL', startDate: '2020-01-01', endDate: '2020-01-02', reason: 'past' },
  });
  expect(
    'BUG-10',
    'F4.1',
    'Leave request with dates in the past is refused',
    r.status === 400,
    `got ${r.status} — accepted a request dated 2020`,
  );
}

/* ---------------------------------------------------------------------- */
console.log('\nF5 · Payroll');

// Job status must be tenant-scoped: payroll totals leak otherwise.
{
  const run = await call('/payroll/runs', {
    method: 'POST',
    token: hrA.accessToken,
    body: { year: 2026, month: 6 },
  });
  await new Promise((r) => setTimeout(r, 1200));
  const cross = await call(`/jobs/${run.body.jobId}`, { token: hrB.accessToken });
  expect(
    'BUG-11',
    'US-04',
    'Job status is tenant-scoped (org B cannot read org A payroll job)',
    cross.status === 404 || cross.status === 403,
    `got ${cross.status} — org B read org A's payroll result: ${JSON.stringify(cross.body?.result ?? {}).slice(0, 90)}`,
  );
}

// The DB UNIQUE constraint on payslip should prevent a duplicate period.
{
  const r1 = await call('/payroll/runs', {
    method: 'POST',
    token: hrA.accessToken,
    body: { year: 2026, month: 7 },
  });
  await new Promise((r) => setTimeout(r, 1500));
  const j = await call(`/jobs/${r1.body.jobId}`, { token: hrA.accessToken });
  expect(
    'BUG-12',
    'PayrollRun.isDuplicate()',
    'Re-running a completed period issues no duplicate payslips',
    j.body?.result?.issued === 0,
    `re-run issued ${j.body?.result?.issued} additional payslips`,
  );
}

/* ---------------------------------------------------------------------- */
console.log('\nF6-F8 · Modules declared in the feature spec');

for (const [id, fn, path] of [
  ['BUG-13', 'F6 · OKR Performance', '/okr/objectives'],
  ['BUG-14', 'F7 · Recruitment ATS', '/recruitment/postings'],
  ['BUG-15', 'F8.3 · Notice read tracking', '/notices/read-report'],
]) {
  const r = await call(path, { token: hrA.accessToken });
  expect(id, fn, `${fn} endpoint exists`, r.status !== 404, `got ${r.status}`);
}

/* ---------------------------------------------------------------------- */
console.log('\nSubscription / tiering — the product is sold per tier');

{
  const r = await call('/subscription', { token: hrA.accessToken });
  expect(
    'BUG-16',
    'Business model',
    'Tenant subscription/plan is exposed to the app',
    r.status === 200,
    `got ${r.status} — no plan awareness anywhere in the API`,
  );
}

{
  // Bengal Logistics is a GROWTH tenant. The AI module is an Enterprise feature.
  const r = await call('/attrition/at-risk', { token: hrB.accessToken });
  expect(
    'BUG-17',
    'Business model',
    'A GROWTH tenant is gated out of the full Enterprise attrition module',
    r.status === 402 || r.status === 403,
    `got ${r.status} — tier gating is not enforced anywhere`,
  );
}

/* ---------------------------------------------------------------------- */
console.log(`\n${checks} checks, ${findings.length} defects found\n`);
for (const f of findings) {
  console.log(`${f.id}  (${f.story})  ${f.description}`);
  if (f.actual) console.log(`         -> ${f.actual}`);
}
console.log('');
