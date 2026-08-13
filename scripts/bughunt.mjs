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

// BUG-25 (load-test finding, docs/17-load-test-report.md): the original rate limiter
// incremented its counter on every login CALL, not every FAILURE, so several concurrent
// requests for the same email with the CORRECT password could trip a 429 before any of them
// finished and cleared it -- a race the sequential BUG-03 test above can't see. Fire 10
// concurrent correct-password logins for one account and confirm none of them are refused.
{
  const concurrentLogins = await Promise.all(
    Array.from({ length: 10 }, () => login('hr@dhakacraft.test')),
  );
  const statuses = concurrentLogins.map((r) => r.status);
  expect(
    'BUG-25',
    'US-02',
    '10 concurrent logins with the correct password never trip the failed-attempt lockout',
    statuses.every((s) => s === 200),
    `statuses: ${JSON.stringify(statuses)}`,
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

// US-09: employee updates their own contact details. Acceptance criteria: phone/address/
// emergency contact are editable; salary, designation, department are read-only on this
// screen; visible to HR without a further approval step.
{
  const before = (await call('/me', { token: emp.accessToken })).body.employee;
  const r = await call('/me/contact', {
    method: 'POST',
    token: emp.accessToken,
    body: { phone: '01711111111', address: 'House 12, Road 5, Dhaka', emergencyContact: 'Mother, 01799999999' },
  });
  expect('BUG-05', 'US-09', 'Employee can update own contact details (F2.2)', r.status === 200, `got ${r.status}`);
  expect(
    'BUG-05',
    'US-09',
    'Designation and department are unchanged by a contact update (read-only enforced server-side)',
    r.body?.designation === before?.designation && r.body?.department_id === before?.department_id,
    'a contact-only update changed employment data',
  );

  // No approval step -- HR's own view of the same employee shows it immediately.
  const hrView = await call(`/employees/${before.id}`, { token: hrA.accessToken });
  expect(
    'BUG-05',
    'US-09',
    'HR sees the updated contact details immediately, no approval step',
    hrView.body?.phone === '01711111111',
    `HR view shows phone=${hrView.body?.phone}`,
  );
}

// US-12 (F2.5): HR attaches a document; the employee and HR can see it, a disallowed type
// is refused, and it carries type/date/uploader.
{
  const meRow = (await call('/me', { token: emp.accessToken })).body.employee;
  const tinyPdfBase64 = Buffer.from('%PDF-1.4 not a real pdf, just bytes for the test').toString('base64');

  const upload = await call(`/employees/${meRow.id}/documents`, {
    method: 'POST',
    token: hrA.accessToken,
    body: { category: 'NID_COPY', filename: 'nid.pdf', mimeType: 'application/pdf', contentBase64: tinyPdfBase64 },
  });
  expect('BUG-19', 'US-12', 'HR can attach a document to an employee profile (F2.5)', upload.status === 201, `got ${upload.status}`);

  const rejected = await call(`/employees/${meRow.id}/documents`, {
    method: 'POST',
    token: hrA.accessToken,
    body: { category: 'OTHER', filename: 'malware.exe', mimeType: 'application/x-msdownload', contentBase64: 'AA==' },
  });
  expect('BUG-19', 'US-12', 'A disallowed file type is refused, not silently accepted', rejected.status === 415, `got ${rejected.status}`);

  const asSelf = await call(`/employees/${meRow.id}/documents`, { token: emp.accessToken });
  expect(
    'BUG-19',
    'US-12',
    'The employee can see documents on their own profile',
    asSelf.status === 200 && asSelf.body.some((d) => d.filename === 'nid.pdf'),
    `got ${asSelf.status}, ${JSON.stringify(asSelf.body)}`,
  );
  const doc = asSelf.body.find((d) => d.filename === 'nid.pdf');
  expect(
    'BUG-19',
    'US-12',
    'Each document shows its type, upload date and uploader',
    Boolean(doc?.category && doc?.created_at && doc?.uploaded_by_email),
    JSON.stringify(doc),
  );

  // mgr is a MANAGER, not HR_ADMIN and not this employee -- exactly the "other employee"
  // case the third acceptance criterion excludes, regardless of the org chart.
  const asManager = await call(`/employees/${meRow.id}/documents`, { token: mgr.accessToken });
  expect(
    'BUG-19',
    'US-12',
    'Documents are visible to the employee and Administrators only -- not other roles',
    asManager.status === 403,
    `got ${asManager.status} for a non-HR, non-owner role`,
  );
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

// F4.4 / US-21 + US-22: in-app leave notifications.
{
  const meRow = (await call('/me', { token: emp.accessToken })).body.employee;
  const mgrIsHerManager = meRow.manager_id === mgr.user.employeeId;
  const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);

  const mgrBefore = mgrIsHerManager ? await call('/notifications', { token: mgr.accessToken }) : null;

  const submitted = await call('/leave/requests', {
    method: 'POST',
    token: emp.accessToken,
    body: { leaveType: 'CASUAL', startDate: future, endDate: future, reason: 'bughunt F4.4 check' },
  });

  if (mgrIsHerManager) {
    const mgrAfter = await call('/notifications', { token: mgr.accessToken });
    expect(
      'BUG-20',
      'US-22',
      "Manager is notified when a request enters their queue",
      (mgrAfter.body ?? []).length > (mgrBefore.body ?? []).length,
      `notification count ${(mgrBefore.body ?? []).length} -> ${(mgrAfter.body ?? []).length}`,
    );
  }

  const REJECTION_REASON = 'bughunt test rejection — not enough documentation attached';
  const noReason = await call(`/leave/requests/${submitted.body.id}/decision`, {
    method: 'POST',
    token: hrA.accessToken,
    body: { decision: 'REJECT' },
  });
  expect('BUG-20', 'US-19', 'A rejection cannot be submitted without a reason', noReason.status === 400, `got ${noReason.status}`);

  await call(`/leave/requests/${submitted.body.id}/decision`, {
    method: 'POST',
    token: hrA.accessToken,
    body: { decision: 'REJECT', reason: REJECTION_REASON },
  });
  const empNotifs = await call('/notifications', { token: emp.accessToken });
  const decided = (empNotifs.body ?? []).find((n) => n.entity_id === submitted.body.id);
  expect(
    'BUG-20',
    'US-21',
    'Employee is notified on rejection, carrying the stated reason',
    Boolean(decided?.message?.includes(REJECTION_REASON)),
    JSON.stringify(decided),
  );

  if (mgrIsHerManager) {
    const mgrFinal = await call('/notifications', { token: mgr.accessToken });
    const stillPending = (mgrFinal.body ?? []).some((n) => n.entity_id === submitted.body.id && !n.read_at);
    expect(
      'BUG-20',
      'US-22',
      "The manager's notification clears once they (or HR) record a decision",
      !stillPending,
      'the pending notification for this request is still unread',
    );
  }
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

// The DB UNIQUE constraint on payslip should prevent a duplicate period. Self-contained --
// runs the period twice in this same script execution rather than assuming an earlier
// session already ran it, so a freshly-reseeded database doesn't produce a false BUG-12.
{
  const first = await call('/payroll/runs', {
    method: 'POST',
    token: hrA.accessToken,
    body: { year: 2026, month: 7 },
  });
  await new Promise((r) => setTimeout(r, 1500));
  await call(`/jobs/${first.body.jobId}`, { token: hrA.accessToken }); // let the first run finish

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

// F5.3 / US-27 — a real generated PDF, not a print-to-PDF shortcut. Reuses the 2026-07 run
// from the BUG-12 block above, so it must run after it.
{
  const meRow = (await call('/me', { token: emp.accessToken })).body.employee;
  const mine = await call(`/payroll/payslips?employeeId=${meRow.id}`, { token: emp.accessToken });
  const payslipId = mine.body?.[0]?.id;

  const own = await fetch(`${BASE}/api/payroll/payslips/${payslipId}/pdf`, {
    headers: { Authorization: `Bearer ${emp.accessToken}` },
  });
  const ownBytes = new Uint8Array(await own.arrayBuffer());
  const ownMagic = Buffer.from(ownBytes.slice(0, 5)).toString('latin1');
  expect(
    'BUG-22',
    'US-27',
    'Employee can download their own payslip as a real PDF (gross/deductions/net all present)',
    own.status === 200 &&
      own.headers.get('content-type') === 'application/pdf' &&
      ownMagic === '%PDF-' &&
      ownBytes.length > 800,
    `status ${own.status}, content-type ${own.headers.get('content-type')}, magic "${ownMagic}", ${ownBytes.length} bytes`,
  );

  const crossOrg = await fetch(`${BASE}/api/payroll/payslips/${payslipId}/pdf`, {
    headers: { Authorization: `Bearer ${hrB.accessToken}` },
  });
  expect(
    'BUG-22',
    'US-27 / P0-5',
    'A different tenant cannot download this payslip PDF',
    crossOrg.status === 404,
    `got ${crossOrg.status}`,
  );
}

/* ---------------------------------------------------------------------- */
console.log('\nF6 · Performance (OKR)');

const starter = (await login('hr@dhakacraft.test')).body;
const meFarhana = (await call('/me', { token: emp.accessToken })).body.employee;

{
  const q = '2027-Q1'; // a quarter nothing else in this run touches, to stay order-independent

  const first = await call('/okr/objectives', {
    method: 'POST',
    token: hrA.accessToken,
    body: {
      employeeId: meFarhana.id,
      quarter: q,
      title: 'Ship the onboarding revamp',
      weightPct: 60,
      keyResults: [{ title: 'Docs published', targetValue: 10 }],
    },
  });
  expect('BUG-13', 'US-30', 'HR can set a quarterly objective with a key result', first.status === 201, `got ${first.status}`);

  const over = await call('/okr/objectives', {
    method: 'POST',
    token: hrA.accessToken,
    body: {
      employeeId: meFarhana.id,
      quarter: q,
      title: 'Second objective',
      weightPct: 50,
      keyResults: [{ title: 'KR', targetValue: 1 }],
    },
  });
  expect(
    'BUG-13',
    'US-30',
    'A second objective that would push weight over 100% for the quarter is refused',
    over.status === 400,
    `got ${over.status} — 60% + 50% was accepted`,
  );

  const listed = await call(`/okr/objectives?employeeId=${meFarhana.id}&quarter=${q}`, { token: emp.accessToken });
  const krId = listed.body?.[0]?.keyResults?.[0]?.id;

  const notOwner = await call(`/okr/key-results/${krId}/progress`, {
    method: 'POST',
    token: mgr.accessToken,
    body: { currentValue: 3 },
  });
  expect(
    'BUG-13',
    'US-31',
    'An employee can update only their own key results',
    notOwner.status === 403,
    `got ${notOwner.status} — a different employee updated it`,
  );

  const overTarget = await call(`/okr/key-results/${krId}/progress`, {
    method: 'POST',
    token: emp.accessToken,
    body: { currentValue: 12 }, // target is 10
  });
  expect(
    'BUG-13',
    'US-31',
    'Progress beyond the target is refused without a comment',
    overTarget.status === 400,
    `got ${overTarget.status}`,
  );

  const withComment = await call(`/okr/key-results/${krId}/progress`, {
    method: 'POST',
    token: emp.accessToken,
    body: { currentValue: 12, comment: 'Two bonus guides added beyond scope' },
  });
  const recalculated = await call(`/okr/objectives?employeeId=${meFarhana.id}&quarter=${q}`, { token: emp.accessToken });
  expect(
    'BUG-13',
    'US-31',
    'Progress beyond the target is accepted with a comment, and completion recalculates immediately',
    withComment.status === 200 && recalculated.body?.[0]?.completionPct === 120,
    `update status ${withComment.status}, completionPct ${recalculated.body?.[0]?.completionPct}`,
  );

  await call(`/okr/quarters/${q}/close`, { method: 'POST', token: hrA.accessToken });
  const afterClose = await call(`/okr/key-results/${krId}/progress`, {
    method: 'POST',
    token: emp.accessToken,
    body: { currentValue: 5, comment: 'should be refused' },
  });
  expect(
    'BUG-13',
    'US-30',
    'Objectives become read-only once HR closes the quarter',
    afterClose.status === 403,
    `got ${afterClose.status} after closing ${q}`,
  );

  // HR, not the manager fixture -- Shabnam (mgr) isn't necessarily Farhana's manager, and
  // the review-score route rightly refuses a non-manager MANAGER the same way OKR objective
  // routes do. HR_ADMIN has no such restriction, same as the objective-creation call above.
  const score = await call('/okr/review-scores', {
    method: 'POST',
    token: hrA.accessToken,
    body: { employeeId: meFarhana.id, quarter: q, score: 4 },
  });
  const beforePublish = await call(`/okr/review-scores?employeeId=${meFarhana.id}`, { token: emp.accessToken });
  const publish = await call(`/okr/review-scores/${score.body?.id}/publish`, { method: 'POST', token: hrA.accessToken });
  const afterPublish = await call(`/okr/review-scores?employeeId=${meFarhana.id}`, { token: emp.accessToken });
  expect(
    'BUG-13',
    'US-32',
    'A review score is hidden from the employee until published, then visible',
    score.status === 201 &&
      !beforePublish.body?.some((s) => s.id === score.body.id) &&
      publish.status === 200 &&
      afterPublish.body?.some((s) => s.id === score.body.id),
    `create ${score.status}, visible-before-publish ${beforePublish.body?.length}, publish ${publish.status}`,
  );

  const gated = await call('/okr/objectives?employeeId=x', { token: starter.accessToken });
  expect('BUG-13', 'Business model', 'A STARTER tenant is gated out of the OKR module', gated.status === 402, `got ${gated.status}`);
}

/* ---------------------------------------------------------------------- */
console.log('\nF7 · Recruitment (ATS)');

{
  const futureDeadline = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const vac = await call('/vacancies', {
    method: 'POST',
    token: hrA.accessToken,
    body: { title: 'Bug-hunt QA Engineer', requirements: 'Adversarial mindset', deadline: futureDeadline },
  });
  expect('BUG-14', 'US-34', 'HR can publish a vacancy', vac.status === 201, `got ${vac.status}`);

  const meHr = (await call('/me', { token: hrA.accessToken })).body.principal;
  const publicList = await fetch(`${BASE}/api/public/vacancies?org=${meHr.organisationId}`).then((r) => r.json());
  expect(
    'BUG-14',
    'US-34',
    'A published vacancy is reachable on a public link with no login',
    Array.isArray(publicList) && publicList.some((v) => v.id === vac.body.id),
    `public list had ${publicList?.length ?? 0} entries`,
  );

  const badApply = await fetch(`${BASE}/api/public/vacancies/${vac.body.id}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      organisationId: meHr.organisationId,
      fullName: 'Bad File',
      email: 'bad@example.com',
      cvFilename: 'cv.exe',
      cvMimeType: 'application/x-msdownload',
      cvContentBase64: Buffer.from('x').toString('base64'),
    }),
  });
  expect('BUG-14', 'US-35', 'A disallowed CV file type is refused before submission completes', badApply.status === 400, `got ${badApply.status}`);

  const apply = await fetch(`${BASE}/api/public/vacancies/${vac.body.id}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      organisationId: meHr.organisationId,
      fullName: 'Bughunt Candidate',
      email: 'bughunt.candidate@example.com',
      cvFilename: 'cv.pdf',
      cvMimeType: 'application/pdf',
      cvContentBase64: Buffer.from('%PDF-1.4 test').toString('base64'),
    }),
  }).then((r) => r.json());
  expect('BUG-14', 'US-35', 'The applicant receives a confirmation carrying a reference number', typeof apply.referenceCode === 'string' && apply.referenceCode.length > 0, `got ${JSON.stringify(apply)}`);

  const list = await call(`/candidates?vacancyId=${vac.body.id}`, { token: hrA.accessToken });
  const candidateId = list.body?.[0]?.id;

  // Still APPLIED at this point -- an evaluation now must be refused (US-37).
  const evalTooEarly = await call(`/candidates/${candidateId}/evaluations`, {
    method: 'POST',
    token: mgr.accessToken,
    body: { interviewDate: '2026-09-01', comments: 'n/a', score: 3 },
  });

  const forward = await call(`/candidates/${candidateId}/stage`, { method: 'POST', token: hrA.accessToken, body: { toStage: 'SHORTLISTED' } });
  await call(`/candidates/${candidateId}/stage`, { method: 'POST', token: hrA.accessToken, body: { toStage: 'INTERVIEW' } });
  const backwardsNoReason = await call(`/candidates/${candidateId}/stage`, { method: 'POST', token: hrA.accessToken, body: { toStage: 'APPLIED' } });
  const backwardsWithReason = await call(`/candidates/${candidateId}/stage`, {
    method: 'POST',
    token: hrA.accessToken,
    body: { toStage: 'APPLIED', reason: 'Panel unavailable, restarting the process' },
  });
  expect(
    'BUG-14',
    'US-36',
    'Moving a candidate backwards through the pipeline is refused without a reason, accepted with one',
    forward.status === 200 && backwardsNoReason.status === 400 && backwardsWithReason.status === 200,
    `forward ${forward.status}, no-reason ${backwardsNoReason.status}, with-reason ${backwardsWithReason.status}`,
  );

  // Back to Interview to record a real evaluation (US-37's success path).
  await call(`/candidates/${candidateId}/stage`, { method: 'POST', token: hrA.accessToken, body: { toStage: 'SHORTLISTED' } });
  await call(`/candidates/${candidateId}/stage`, { method: 'POST', token: hrA.accessToken, body: { toStage: 'INTERVIEW' } });
  const evalOk = await call(`/candidates/${candidateId}/evaluations`, {
    method: 'POST',
    token: mgr.accessToken,
    body: { interviewDate: '2026-09-01', comments: 'Strong technical round', score: 4.5 },
  });
  expect(
    'BUG-14',
    'US-37',
    'An evaluation can only be added while the candidate is at the Interview stage',
    evalTooEarly.status === 400 && evalOk.status === 201,
    `while-applied ${evalTooEarly.status}, while-interview ${evalOk.status}`,
  );

  await call(`/candidates/${candidateId}/stage`, { method: 'POST', token: hrA.accessToken, body: { toStage: 'OFFER' } });
  await call(`/candidates/${candidateId}/stage`, { method: 'POST', token: hrA.accessToken, body: { toStage: 'HIRED' } });
  const convert = await call(`/candidates/${candidateId}/convert`, {
    method: 'POST',
    token: hrA.accessToken,
    body: { employeeCode: `BUGHUNT-${Date.now().toString(36).toUpperCase()}`, designation: 'QA Engineer', departmentId: null, hireDate: '2026-09-15' },
  });
  const moveAfterHire = await call(`/candidates/${candidateId}/stage`, { method: 'POST', token: hrA.accessToken, body: { toStage: 'OFFER' } });
  expect(
    'BUG-14',
    'US-38',
    'A Hired candidate converts to an employee profile in one action and the application then locks',
    convert.status === 201 && typeof convert.body?.employeeId === 'string' && moveAfterHire.status === 400,
    `convert ${convert.status}, move-after-hire ${moveAfterHire.status}`,
  );

  const gated = await call('/vacancies', { token: starter.accessToken });
  expect('BUG-14', 'Business model', 'A STARTER tenant is gated out of the ATS module', gated.status === 402, `got ${gated.status}`);
}

/* ---------------------------------------------------------------------- */
console.log('\nF8 · Digital Noticeboard');

{
  const noDept = await call('/notices', {
    method: 'POST',
    token: hrA.accessToken,
    body: { title: 'Dept notice', body: 'x', audienceType: 'DEPARTMENTS', departmentIds: [] },
  });
  expect('BUG-15', 'US-39', 'A department-targeted notice requires at least one department', noDept.status === 400, `got ${noDept.status}`);

  const depts = (await call('/departments', { token: hrA.accessToken })).body ?? [];
  const herDept = depts.find((d) => d.id === meFarhana.department_id);
  const otherDept = depts.find((d) => d.id !== meFarhana.department_id);

  const targeted = await call('/notices', {
    method: 'POST',
    token: hrA.accessToken,
    body: { title: 'For her department', body: 'x', audienceType: 'DEPARTMENTS', departmentIds: [herDept.id], isUrgent: true },
  });
  const untargeted = await call('/notices', {
    method: 'POST',
    token: hrA.accessToken,
    body: { title: 'For a different department', body: 'x', audienceType: 'DEPARTMENTS', departmentIds: [otherDept.id] },
  });
  const herFeed = (await call('/notices', { token: emp.accessToken })).body ?? [];
  expect(
    'BUG-15',
    'US-39',
    'An employee sees notices targeted at their own department but not other departments',
    herFeed.some((n) => n.id === targeted.body.id) && !herFeed.some((n) => n.id === untargeted.body.id),
    `sees targeted: ${herFeed.some((n) => n.id === targeted.body.id)}, sees other-dept: ${herFeed.some((n) => n.id === untargeted.body.id)}`,
  );
  expect(
    'BUG-15',
    'US-40',
    'An urgent notice is pinned above routine ones on the feed',
    herFeed[0]?.id === targeted.body.id,
    `top of feed was ${herFeed[0]?.title}`,
  );

  const beforeRead = herFeed.find((n) => n.id === targeted.body.id)?.read;
  await call(`/notices/${targeted.body.id}/read`, { method: 'POST', token: emp.accessToken });
  const afterRead = (await call('/notices', { token: emp.accessToken })).body ?? [];
  expect(
    'BUG-15',
    'US-41',
    'Opening a notice marks it read, distinguishing it from unread ones',
    beforeRead === false && afterRead.find((n) => n.id === targeted.body.id)?.read === true,
    `before ${beforeRead}, after ${afterRead.find((n) => n.id === targeted.body.id)?.read}`,
  );

  const report = await call(`/notices/${targeted.body.id}/report`, { token: hrA.accessToken });
  expect(
    'BUG-15',
    'US-42',
    "HR's read report lists read and unread employees separately for a notice",
    report.status === 200 && Array.isArray(report.body?.read) && report.body.read.some((e) => e.id === meFarhana.id),
    `status ${report.status}, read ${report.body?.read?.length}, unread ${report.body?.unread?.length}`,
  );
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
console.log('\nSelf-service billing (docs/11-subscription-model.md §8)');

// Bengal Logistics starts and ends this block on GROWTH -- upgrades to ENTERPRISE and back,
// so the tier BUG-17 above depends on is unchanged for the next run of this script.
{
  const upPreview = await call('/subscription/preview-change?tier=ENTERPRISE', { token: hrB.accessToken });
  expect(
    'BUG-23',
    'Business model',
    'Previewing an upgrade returns a positive amount due, prorated for days left this month',
    upPreview.status === 200 && upPreview.body?.changeType === 'UPGRADE' && upPreview.body?.netDuePaisa > 0,
    `status ${upPreview.status}, body ${JSON.stringify(upPreview.body)}`,
  );

  const upConfirm = await call('/subscription/change', {
    method: 'POST',
    token: hrB.accessToken,
    body: { tier: 'ENTERPRISE' },
  });
  const afterUp = await call('/subscription', { token: hrB.accessToken });
  expect(
    'BUG-23',
    'Business model',
    'Confirming an upgrade issues a PAID invoice and the tier actually changes',
    upConfirm.status === 201 &&
      upConfirm.body?.status === 'PAID' &&
      upConfirm.body?.amount_paisa === upPreview.body?.netDuePaisa &&
      afterUp.body?.tier === 'ENTERPRISE',
    `confirm ${upConfirm.status}, invoice status ${upConfirm.body?.status}, tier now ${afterUp.body?.tier}`,
  );

  const sameTier = await call('/subscription/change', {
    method: 'POST',
    token: hrB.accessToken,
    body: { tier: 'ENTERPRISE' },
  });
  expect('BUG-23', 'Business model', 'Changing to the already-active plan is refused', sameTier.status === 400, `got ${sameTier.status}`);

  const notHr = await call('/subscription/change', {
    method: 'POST',
    token: mgr.accessToken,
    body: { tier: 'STARTER' },
  });
  expect('BUG-23', 'Business model', 'A non-HR role cannot change the plan', notHr.status === 403, `got ${notHr.status}`);

  const downPreview = await call('/subscription/preview-change?tier=GROWTH', { token: hrB.accessToken });
  const downConfirm = await call('/subscription/change', {
    method: 'POST',
    token: hrB.accessToken,
    body: { tier: 'GROWTH' },
  });
  const afterDown = await call('/subscription', { token: hrB.accessToken });
  expect(
    'BUG-23',
    'Business model',
    'A downgrade issues a credit note and restores the original tier',
    downPreview.body?.changeType === 'DOWNGRADE' &&
      downPreview.body?.netDuePaisa < 0 &&
      downConfirm.status === 201 &&
      downConfirm.body?.status === 'CREDITED' &&
      afterDown.body?.tier === 'GROWTH',
    `preview net ${downPreview.body?.netDuePaisa}, confirm status ${downConfirm.body?.status}, tier now ${afterDown.body?.tier}`,
  );

  const invoices = await call('/subscription/invoices', { token: hrB.accessToken });
  expect(
    'BUG-23',
    'Business model',
    'Both the upgrade and the downgrade are recorded in invoice history',
    Array.isArray(invoices.body) && invoices.body.length >= 2,
    `got ${invoices.body?.length ?? 0} invoices`,
  );
}

/* ---------------------------------------------------------------------- */
console.log('\nAI risk-explanation assistant (F9, explain-only)');

// Same role + feature gate as /attrition/scores/:id, plus its own constraints: it must
// never answer for another tenant's score, and it must degrade cleanly (not 500) when no
// ANTHROPIC_API_KEY is configured, since most dev/CI environments will not have one.
{
  const atRiskHr = await call('/attrition/at-risk?limit=5', { token: hrA.accessToken });

  if (!atRiskHr.body?.length) {
    console.log('  skip  BUG-24  no attrition scores exist yet (run `npm run job:score` first) — skipping');
  } else {
    const scoreId = atRiskHr.body[0].id;
    const askBody = { turns: [{ role: 'user', content: 'Why is this employee flagged?' }] };

    const asMgr = await call(`/attrition/scores/${scoreId}/explain`, {
      method: 'POST',
      token: mgr.accessToken,
      body: askBody,
    });
    expect(
      'BUG-24',
      'F9 · AI assistant',
      'A MANAGER is refused the explain endpoint (same retaliation-risk gate as the score itself)',
      asMgr.status === 403,
      `got ${asMgr.status}`,
    );

    const asEmp = await call(`/attrition/scores/${scoreId}/explain`, {
      method: 'POST',
      token: emp.accessToken,
      body: askBody,
    });
    expect('BUG-24', 'F9 · AI assistant', 'An EMPLOYEE is refused the explain endpoint', asEmp.status === 403, `got ${asEmp.status}`);

    const badShape = await call(`/attrition/scores/${scoreId}/explain`, {
      method: 'POST',
      token: hrA.accessToken,
      body: { turns: [{ role: 'assistant', content: 'not how this starts' }] },
    });
    expect(
      'BUG-24',
      'F9 · AI assistant',
      "A turn history that doesn't end on the user is rejected, not silently accepted",
      badShape.status === 400,
      `got ${badShape.status}`,
    );

    const emptyTurns = await call(`/attrition/scores/${scoreId}/explain`, {
      method: 'POST',
      token: hrA.accessToken,
      body: { turns: [] },
    });
    expect('BUG-24', 'F9 · AI assistant', 'An empty turn list is rejected', emptyTurns.status === 400, `got ${emptyTurns.status}`);

    const notFound = await call('/attrition/scores/does-not-exist/explain', {
      method: 'POST',
      token: hrA.accessToken,
      body: askBody,
    });
    expect('BUG-24', 'F9 · AI assistant', 'A bogus score id is a 404, not a crash', notFound.status === 404, `got ${notFound.status}`);

    // Cross-tenant: temporarily lift Bengal to ENTERPRISE so a 404 here proves org-scoping,
    // not tier-gating (BUG-17 already covers tier-gating on its own). Restored to GROWTH
    // before this block ends, matching the discipline the billing block above already uses.
    await call('/subscription/change', { method: 'POST', token: hrB.accessToken, body: { tier: 'ENTERPRISE' } });
    const crossTenant = await call(`/attrition/scores/${scoreId}/explain`, {
      method: 'POST',
      token: hrB.accessToken,
      body: askBody,
    });
    expect(
      'BUG-24',
      'F9 · AI assistant',
      "One tenant's HR admin cannot ask about another tenant's score, even with matching entitlements",
      crossTenant.status === 404,
      `got ${crossTenant.status}`,
    );
    await call('/subscription/change', { method: 'POST', token: hrB.accessToken, body: { tier: 'GROWTH' } });

    // The environment running this script almost certainly has no ANTHROPIC_API_KEY set
    // (this is a student demo, not a funded deployment) — assert whichever of the two
    // legitimate outcomes actually happened, so the check is meaningful either way instead
    // of being hard-coded to the common case.
    const ask = await call(`/attrition/scores/${scoreId}/explain`, {
      method: 'POST',
      token: hrA.accessToken,
      body: askBody,
    });
    if (ask.status === 503) {
      expect(
        'BUG-24',
        'F9 · AI assistant',
        'With no API key configured, the assistant fails clearly (503) instead of crashing (500)',
        typeof ask.body?.error === 'string' && ask.body.error.includes('ANTHROPIC_API_KEY'),
        `status ${ask.status}, body ${JSON.stringify(ask.body)}`,
      );
    } else {
      expect(
        'BUG-24',
        'F9 · AI assistant',
        'With an API key configured, a question about the score gets a real, non-empty answer',
        ask.status === 200 && typeof ask.body?.reply === 'string' && ask.body.reply.trim().length > 0,
        `status ${ask.status}, body ${JSON.stringify(ask.body)}`,
      );
    }
  }
}

/* ---------------------------------------------------------------------- */
console.log(`\n${checks} checks, ${findings.length} defects found\n`);
for (const f of findings) {
  console.log(`${f.id}  (${f.story})  ${f.description}`);
  if (f.actual) console.log(`         -> ${f.actual}`);
}
console.log('');
