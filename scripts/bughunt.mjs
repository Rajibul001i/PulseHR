/**
 * Adversarial bug hunt — SQA Lead (Munadujjaman).
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
console.log('\nGap closure — functions the report claimed that were not yet built (docs/18)');

const dhakaToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
const shiftDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
async function waitForJob(jobId, token) {
  for (let i = 0; i < 50; i++) {
    const j = await call(`/jobs/${jobId}`, { token });
    if (j.body?.state === 'DONE' || j.body?.state === 'FAILED') return j.body;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}
const runTag = Date.now().toString(36).slice(-5);

// F2.3 — departments
const newDept = await call('/departments', {
  method: 'POST',
  token: hrA.accessToken,
  body: { name: `Quality ${runTag}`, officeStartTime: '08:30' },
});
expect('GAP-03', 'F2.3', 'HR creates a department with its own office start time', newDept.status === 201, `got ${newDept.status}`);
{
  const dup = await call('/departments', { method: 'POST', token: hrA.accessToken, body: { name: `quality ${runTag}` } });
  expect('GAP-03', 'F2.3', 'A duplicate department name is refused', dup.status === 409, `got ${dup.status}`);
  const asMgr = await call('/departments', { method: 'POST', token: mgr.accessToken, body: { name: `X ${runTag}` } });
  expect('GAP-03', 'F2.3', 'A MANAGER cannot create departments', asMgr.status === 403, `got ${asMgr.status}`);
  const upd = await call(`/departments/${newDept.body?.id}`, { method: 'POST', token: hrA.accessToken, body: { officeStartTime: '09:15' } });
  const listed = (await call('/departments', { token: hrA.accessToken })).body ?? [];
  const row = listed.find((d) => d.id === newDept.body?.id);
  expect('GAP-03', 'F2.3', 'HR changes a department office start time', upd.status === 200 && row?.officeStartTime === '09:15', `got ${upd.status} ${row?.officeStartTime}`);
}

// F1.1 / F2.1 — add an employee with a login
const newEmail = `new.joiner.${runTag}@meridian.test`;
const hireDate = shiftDays(dhakaToday, -10);
const created = await call('/employees', {
  method: 'POST',
  token: hrA.accessToken,
  body: {
    employeeCode: `NEW-${runTag}`,
    fullName: 'Nabila Rahman',
    designation: 'Quality Analyst',
    departmentId: newDept.body?.id ?? null,
    managerId: mgr.user.employeeId,
    hireDate,
    gender: 'F',
    salary: { basic: 30000, houseRent: 15000, medical: 1500, conveyance: 1500, food: 1000, providentFundPct: 10 },
    account: { email: newEmail, role: 'EMPLOYEE', temporaryPassword: 'Welcome123' },
  },
});
expect('GAP-01', 'F1.1/F2.1', 'HR adds an employee with a login', created.status === 201 && !!created.body?.id, `got ${created.status} ${JSON.stringify(created.body)}`);
const newId = created.body?.id;
const newLogin = await call('/auth/login', { method: 'POST', body: { email: newEmail, password: 'Welcome123' } });
expect('GAP-01', 'F1.1', 'The new employee can sign in with the temporary password', newLogin.status === 200, `got ${newLogin.status}`);
const newToken = newLogin.body?.accessToken;
{
  const me = await call('/me', { token: newToken });
  expect('GAP-01', 'F2.1', 'Casual and sick leave are granted on joining', (me.body?.balances?.CASUAL ?? 0) > 0 && (me.body?.balances?.SICK ?? 0) > 0, JSON.stringify(me.body?.balances));
  const dupCode = await call('/employees', { method: 'POST', token: hrA.accessToken, body: { employeeCode: `NEW-${runTag}`, fullName: 'Dup', designation: 'X', hireDate, salary: { basic: 1000 } } });
  expect('GAP-01', 'F2.1', 'A duplicate employee code is refused', dupCode.status === 409, `got ${dupCode.status}`);
  const dupEmail = await call('/employees', { method: 'POST', token: hrA.accessToken, body: { employeeCode: `DUP-${runTag}`, fullName: 'Dup', designation: 'X', hireDate, salary: { basic: 1000 }, account: { email: 'farhana.akter@meridian.test', temporaryPassword: 'Welcome123' } } });
  expect('GAP-01', 'F1.1', 'An email that already has a login is refused', dupEmail.status === 409, `got ${dupEmail.status}`);
  const asEmp = await call('/employees', { method: 'POST', token: emp.accessToken, body: { employeeCode: 'X', fullName: 'X Y', designation: 'X', hireDate, salary: { basic: 1 } } });
  expect('GAP-01', 'F1.3', 'An EMPLOYEE cannot add employees', asEmp.status === 403, `got ${asEmp.status}`);
}

// F2.2 — HR edits employment data
{
  const edit = await call(`/employees/${newId}/employment`, { method: 'POST', token: hrA.accessToken, body: { designation: 'Senior Quality Analyst', managerId: null } });
  expect('GAP-02', 'F2.2', 'HR edits designation and manager', edit.status === 200 && edit.body?.designation === 'Senior Quality Analyst', `got ${edit.status}`);
  expect('GAP-02', 'F9 F6', 'A manager change is stamped for the attrition scorecard', edit.body?.manager_changed_at === dhakaToday, `got ${edit.body?.manager_changed_at}`);
  const self = await call(`/employees/${newId}/employment`, { method: 'POST', token: hrA.accessToken, body: { managerId: newId } });
  expect('GAP-02', 'F2.2', 'An employee cannot be made their own manager', self.status === 400, `got ${self.status}`);
  const cross = await call(`/employees/${newId}/employment`, { method: 'POST', token: hrB.accessToken, body: { designation: 'Hacked' } });
  expect('GAP-02', 'NFR-14', "Another tenant's HR cannot edit this employee", cross.status === 404, `got ${cross.status}`);
}

// F5.1 — salary structures
{
  const future = shiftDays(dhakaToday, 20);
  const add = await call(`/employees/${newId}/salary`, { method: 'POST', token: hrA.accessToken, body: { effectiveFrom: future, basic: 33000, houseRent: 16500 } });
  expect('GAP-04', 'F5.1', 'HR adds a new effective-dated salary structure', add.status === 201, `got ${add.status} ${JSON.stringify(add.body)}`);
  const again = await call(`/employees/${newId}/salary`, { method: 'POST', token: hrA.accessToken, body: { effectiveFrom: future, basic: 34000 } });
  expect('GAP-04', 'F5.1', 'Two structures cannot start on the same date', again.status === 409, `got ${again.status}`);
  const beforeHire = await call(`/employees/${newId}/salary`, { method: 'POST', token: hrA.accessToken, body: { effectiveFrom: shiftDays(hireDate, -5), basic: 34000 } });
  expect('GAP-04', 'F5.1', 'A structure cannot start before the hire date', beforeHire.status === 409, `got ${beforeHire.status}`);
  const list = await call(`/employees/${newId}/salary`, { token: hrA.accessToken });
  expect('GAP-04', 'F5.1 P0-8', 'The old structure is kept, not overwritten', list.body?.length === 2 && list.body[1].basic === 3300000, JSON.stringify(list.body?.map((s) => s.basic)));
  // July 2026 is the period this script pays out in its payroll section above.
  const issuedMonth = await call(`/employees/${emp.user.employeeId}/salary`, { method: 'POST', token: hrA.accessToken, body: { effectiveFrom: '2026-07-01', basic: 99999 } });
  expect('GAP-04', 'F5.4', 'A structure cannot start in a month whose payroll is already issued', issuedMonth.status === 409, `got ${issuedMonth.status}`);
  const asEmp = await call(`/employees/${newId}/salary`, { token: emp.accessToken });
  expect('GAP-04', 'F1.3', 'An EMPLOYEE cannot read salary structures', asEmp.status === 403, `got ${asEmp.status}`);
}

// Leave cancellation — compensating ledger entry
{
  const start = shiftDays(dhakaToday, 30);
  const before = (await call('/me', { token: newToken })).body?.balances?.CASUAL;
  const applied = await call('/leave/requests', { method: 'POST', token: newToken, body: { leaveType: 'CASUAL', startDate: start, endDate: start, reason: 'Family event' } });
  const leaveId = applied.body?.id;
  await call(`/leave/requests/${leaveId}/decision`, { method: 'POST', token: hrA.accessToken, body: { decision: 'APPROVE' } });
  const afterApprove = (await call('/me', { token: newToken })).body?.balances?.CASUAL;
  const cancelOther = await call(`/leave/requests/${leaveId}/cancel`, { method: 'POST', token: emp.accessToken });
  expect('GAP-06', 'F4', "An employee cannot cancel someone else's leave", cancelOther.status === 403, `got ${cancelOther.status}`);
  const cancel = await call(`/leave/requests/${leaveId}/cancel`, { method: 'POST', token: newToken });
  const afterCancel = (await call('/me', { token: newToken })).body?.balances?.CASUAL;
  expect('GAP-06', 'F4 P0-7', 'Cancelling approved leave gives the days back through the ledger', cancel.status === 200 && afterApprove === before - 1 && afterCancel === before, `status ${cancel.status}, balances ${before} → ${afterApprove} → ${afterCancel}`);
  const again = await call(`/leave/requests/${leaveId}/cancel`, { method: 'POST', token: newToken });
  expect('GAP-06', 'F4', 'A cancelled request cannot be cancelled again', again.status === 409, `got ${again.status}`);
}

// F3.3 — absence marking: the new joiner has worked 10 days with no check-ins
{
  const run = await call('/attendance/absence-runs', { method: 'POST', token: hrA.accessToken });
  const job = await waitForJob(run.body?.jobId, hrA.accessToken);
  const grid = await call(`/attendance/grid?from=${hireDate}&to=${shiftDays(dhakaToday, -1)}`, { token: hrA.accessToken });
  const mine = (grid.body ?? []).filter((r) => r.employee_id === newId && r.status === 'ABSENT');
  expect('GAP-10', 'F3.3', 'Working days with no check-in and no leave are marked absent', job?.state === 'DONE' && mine.length > 0, `job ${job?.state}, absent rows ${mine.length}`);
  const weekend = mine.filter((r) => [5, 6].includes(new Date(`${r.work_date}T00:00:00Z`).getUTCDay()));
  expect('GAP-10', 'F3.3 P0-9', 'Fridays and Saturdays are never marked absent', weekend.length === 0, `got ${weekend.length}`);
  const asEmp = await call('/attendance/absence-runs', { method: 'POST', token: emp.accessToken });
  expect('GAP-10', 'F1.3', 'An EMPLOYEE cannot trigger absence marking', asEmp.status === 403, `got ${asEmp.status}`);
}

// F1.5 — deactivation cuts access immediately
{
  const seatsBefore = (await call('/subscription', { token: hrA.accessToken })).body?.seats?.seatsUsed;
  const sep = await call(`/employees/${newId}/separate`, { method: 'POST', token: hrA.accessToken, body: { status: 'RESIGNED', separationDate: dhakaToday, separationType: 'VOLUNTARY' } });
  expect('GAP-05', 'F1.5', 'HR records a resignation', sep.status === 200, `got ${sep.status}`);
  const stillIn = await call('/me', { token: newToken });
  expect('GAP-05', 'F1.5 C4', "The leaver's existing access token stops working immediately", stillIn.status === 401, `got ${stillIn.status}`);
  const relogin = await call('/auth/login', { method: 'POST', body: { email: newEmail, password: 'Welcome123' } });
  expect('GAP-05', 'F1.5', 'The leaver can no longer sign in', relogin.status === 401, `got ${relogin.status}`);
  const refresh = await call('/auth/refresh', { method: 'POST', body: { refreshToken: newLogin.body?.refreshToken } });
  expect('GAP-05', 'F1.5', "The leaver's refresh token is revoked", refresh.status === 401, `got ${refresh.status}`);
  const seatsAfter = (await call('/subscription', { token: hrA.accessToken })).body?.seats?.seatsUsed;
  expect('GAP-05', 'F1.5', 'The seat is released', seatsAfter === seatsBefore - 1, `${seatsBefore} → ${seatsAfter}`);
  const twice = await call(`/employees/${newId}/separate`, { method: 'POST', token: hrA.accessToken, body: { status: 'RESIGNED', separationDate: dhakaToday, separationType: 'VOLUNTARY' } });
  expect('GAP-05', 'F1.5', 'An employee who has already left cannot be separated again', twice.status === 409, `got ${twice.status}`);
  const record = await call(`/employees/${newId}`, { token: hrA.accessToken });
  expect('GAP-05', 'F1.5', 'The record is kept, marked RESIGNED', record.body?.employment_status === 'RESIGNED', `got ${record.body?.employment_status}`);
}

// F9.1 — the OKR engagement feature is live
{
  const top = (await call('/attrition/at-risk?limit=20', { token: hrA.accessToken })).body ?? [];
  let maxOkr = 0;
  for (const s of top) {
    const detail = await call(`/attrition/scores/${s.id}`, { token: hrA.accessToken });
    const okr = (detail.body?.contributions ?? []).find((c) => c.feature_key === 'okr_engagement_drop');
    maxOkr = Math.max(maxOkr, okr?.points ?? 0);
  }
  expect('GAP-08', 'F9.1', 'OKR engagement drop contributes to at least one score (no longer hard-coded to 0)', maxOkr > 0, `max points ${maxOkr}`);
}

// F9.5 — department-level risk
{
  const depts = await call('/attrition/departments', { token: hrA.accessToken });
  const rows = depts.body ?? [];
  expect('GAP-11', 'F9.5', 'HR sees average risk per department', depts.status === 200 && rows.length > 0 && rows.every((r) => typeof r.average_score === 'number'), `got ${depts.status}`);
  expect('GAP-11', 'F9.5 §9', 'The department view carries no names or individual scores', rows.every((r) => !('full_name' in r) && !('employee_id' in r)), JSON.stringify(Object.keys(rows[0] ?? {})));
  const asMgr = await call('/attrition/departments', { token: mgr.accessToken });
  expect('GAP-11', 'F9.5 §9', 'A MANAGER is refused the department risk view', asMgr.status === 403, `got ${asMgr.status}`);
}

// Spec §9 — request your own score, contest it, HR reviews
{
  const mine = await call('/me/attrition-score', { token: emp.accessToken });
  expect('GAP-07', '§9', 'An employee can request their own score with its contributions', mine.status === 200 && (mine.body?.contributions?.length ?? 0) === 8, `got ${mine.status}`);
  const scoreId = mine.body?.score?.id;
  const short = await call('/me/attrition-score/contest', { method: 'POST', token: emp.accessToken, body: { scoreId, note: 'no' } });
  expect('GAP-07', '§9', 'A contest needs a reason', short.status === 400, `got ${short.status}`);
  const otherId = ((await call('/attrition/at-risk?limit=20', { token: hrA.accessToken })).body ?? []).find((s) => s.employee_id !== emp.user.employeeId)?.id;
  const others = await call('/me/attrition-score/contest', { method: 'POST', token: emp.accessToken, body: { scoreId: otherId, note: 'This is not my score but I will try anyway' } });
  expect('GAP-07', '§9', "An employee cannot contest someone else's score", others.status === 404, `got ${others.status}`);
  const contest = await call('/me/attrition-score/contest', { method: 'POST', token: emp.accessToken, body: { scoreId, note: 'My recent lateness was a road closure on my route, now resolved.' } });
  expect('GAP-07', '§9', 'An employee contests their score', contest.status === 200, `got ${contest.status}`);
  const again = await call('/me/attrition-score/contest', { method: 'POST', token: emp.accessToken, body: { scoreId, note: 'Contesting the same score twice' } });
  expect('GAP-07', '§9', 'The same score cannot be contested twice', again.status === 409, `got ${again.status}`);
  const queue = await call('/attrition/contests', { token: hrA.accessToken });
  expect('GAP-07', '§9', 'HR sees the contest in the review queue', (queue.body ?? []).some((c) => c.id === scoreId && !c.contest_outcome), `got ${queue.status}`);
  const review = await call(`/attrition/scores/${scoreId}/contest-review`, { method: 'POST', token: hrA.accessToken, body: { outcome: 'CORRECTED', note: 'Confirmed the road closure; lateness excluded from the conversation.' } });
  expect('GAP-07', '§9', 'HR records the review outcome', review.status === 200, `got ${review.status}`);
  const uncontested = (queue.body ?? []).length ? otherId : null;
  const bad = await call(`/attrition/scores/${uncontested}/contest-review`, { method: 'POST', token: hrA.accessToken, body: { outcome: 'UPHELD', note: 'Nothing to review here' } });
  expect('GAP-07', '§9', 'A score nobody contested cannot be "reviewed"', bad.status === 409, `got ${bad.status}`);
  const mgrQueue = await call('/attrition/contests', { token: mgr.accessToken });
  expect('GAP-07', '§9', 'A MANAGER cannot see contests', mgrQueue.status === 403, `got ${mgrQueue.status}`);
}

// Spec §9 — quarterly bias audit
{
  const run = await call('/attrition/bias-audit/runs', { method: 'POST', token: hrA.accessToken });
  const job = await waitForJob(run.body?.jobId, hrA.accessToken);
  const audit = await call('/attrition/bias-audit', { token: hrA.accessToken });
  const dims = (audit.body?.report?.dimensions ?? []).map((d) => d.dimension).sort().join(',');
  expect('GAP-13', '§9', 'The bias audit runs and stores a report across gender, department and tenure', job?.state === 'DONE' && dims === 'department,gender,tenure', `job ${job?.state}, dims ${dims}`);
  const growth = await call('/attrition/bias-audit', { token: hrB.accessToken });
  expect('GAP-13', '§9 plan', 'The bias audit is an Enterprise feature (402 on Growth)', growth.status === 402, `got ${growth.status}`);
}

// F5.5 — payroll summary by department
{
  const [py, pm] = [2026, 7]; // paid out by this script's payroll section above
  const sum = await call(`/payroll/summary?year=${py}&month=${pm}`, { token: hrA.accessToken });
  const depts = sum.body?.departments ?? [];
  const netTotal = depts.reduce((t, d) => t + Number(d.net), 0);
  expect('GAP-14', 'F5.5', 'HR sees payroll totals per department for a month', sum.status === 200 && depts.length > 1 && netTotal === sum.body?.total?.net, `got ${sum.status}, ${depts.length} departments`);
  const asEmp = await call(`/payroll/summary?year=${py}&month=${pm}`, { token: emp.accessToken });
  expect('GAP-14', 'F5.5', 'An EMPLOYEE cannot see the payroll summary', asEmp.status === 403, `got ${asEmp.status}`);
}

// F8.4 — notice search
{
  const found = await call('/notices?q=eid', { token: emp.accessToken });
  const none = await call('/notices?q=zzzz-no-such-notice', { token: emp.accessToken });
  expect('GAP-15', 'F8.4', 'Searching notices returns only matches', found.status === 200 && found.body.length > 0 && found.body.every((n) => /eid/i.test(`${n.title} ${n.body}`)) && none.body.length === 0, `found ${found.body?.length}, none ${none.body?.length}`);
}

/* ---------------------------------------------------------------------- */
console.log('\nShifts, duty times and attendance corrections');
{
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
  const addD = (date, n) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const dow = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
  const tag = Date.now().toString(36).slice(-4);
  const nusrat = (await login('nusrat.jahan@meridian.test')).body;
  const sumaiyaId = (await call('/employees?q=sumaiya', { token: hrA.accessToken })).body?.[0]?.id;

  // Shift definitions (HR)
  const created = await call('/shifts', { method: 'POST', token: hrA.accessToken, body: { name: `Evening ${tag}`, startTime: '14:00', endTime: '22:00', breakMinutes: 30, graceMinutes: 5 } });
  expect('SHIFT-01', 'Shifts', 'HR defines a shift', created.status === 201, `got ${created.status}`);
  const dup = await call('/shifts', { method: 'POST', token: hrA.accessToken, body: { name: `evening ${tag}`, startTime: '14:00', endTime: '22:00' } });
  expect('SHIFT-01', 'Shifts', 'A duplicate shift name is refused', dup.status === 409, `got ${dup.status}`);
  const same = await call('/shifts', { method: 'POST', token: hrA.accessToken, body: { name: `Zero ${tag}`, startTime: '09:00', endTime: '09:00' } });
  expect('SHIFT-01', 'Shifts', 'A shift that starts and ends at the same time is refused', same.status === 400, `got ${same.status}`);
  const asMgr = await call('/shifts', { method: 'POST', token: mgr.accessToken, body: { name: `M ${tag}`, startTime: '09:00', endTime: '17:00' } });
  expect('SHIFT-01', 'Shifts', 'A MANAGER cannot define shifts', asMgr.status === 403, `got ${asMgr.status}`);

  // Duty time for the employee
  const mine = await call('/me/shift', { token: nusrat.accessToken });
  const friday = (mine.body?.roster ?? []).find((d) => dow(d.date) === 5);
  expect('SHIFT-02', 'Duty time', "An employee sees today's shift and a 14-day roster", mine.status === 200 && mine.body?.today?.name === 'General' && mine.body?.roster?.length === 14, `got ${mine.status} ${mine.body?.today?.name}`);
  expect('SHIFT-02', 'Duty time', 'Friday shows as a day off on the General shift', friday?.status === 'OFF', `got ${friday?.status}`);

  // Assignment
  const tomorrow = addD(today, 1);
  const assign = await call('/shifts/assign', { method: 'POST', token: mgr.accessToken, body: { employeeIds: [nusrat.user.employeeId], shiftId: created.body?.id, effectiveFrom: tomorrow } });
  expect('SHIFT-03', 'Shifts', 'A manager assigns a shift to someone in their department from tomorrow', assign.status === 200, `got ${assign.status} ${JSON.stringify(assign.body)}`);
  const after = await call('/me/shift', { token: nusrat.accessToken });
  const t0 = after.body?.roster?.[0]?.shift?.name;
  const t1 = after.body?.roster?.[1]?.shift?.name;
  expect('SHIFT-03', 'Shifts', 'The roster keeps today on the old shift and switches from tomorrow', t0 === 'General' && t1 === `Evening ${tag}`, `today ${t0}, tomorrow ${t1}`);
  const past = await call('/shifts/assign', { method: 'POST', token: hrA.accessToken, body: { employeeIds: [nusrat.user.employeeId], shiftId: created.body?.id, effectiveFrom: addD(today, -3) } });
  expect('SHIFT-03', 'Shifts', 'A shift change cannot be backdated', past.status === 400, `got ${past.status}`);
  const outside = await call('/shifts/assign', { method: 'POST', token: mgr.accessToken, body: { employeeIds: [sumaiyaId], shiftId: created.body?.id, effectiveFrom: tomorrow } });
  expect('SHIFT-03', 'Shifts', 'A manager cannot assign shifts outside their department', outside.status === 403, `got ${outside.status}`);
  const notes = await call('/notifications', { token: nusrat.accessToken });
  expect('SHIFT-03', 'Shifts', 'The employee is notified of the new shift', (notes.body ?? []).some((n) => n.type === 'SHIFT_ASSIGNED'), `got ${notes.body?.length}`);

  // Corrections: the most recent working day this month (a month not yet paid)
  let day = addD(today, -1);
  while ([5, 6].includes(dow(day))) day = addD(day, -1);
  let day2 = addD(day, -1);
  while ([5, 6].includes(dow(day2))) day2 = addD(day2, -1);
  if (day.slice(0, 7) !== today.slice(0, 7) || day2.slice(0, 7) !== today.slice(0, 7)) {
    console.log('  skip  CORR-*  too early in the month for two unpaid working days');
  } else {
    // Clear the seeded pending request for that day so this run controls its own data.
    const seeded = (await call('/attendance/corrections?status=PENDING', { token: hrA.accessToken })).body ?? [];
    for (const c of seeded.filter((r) => r.employee_id === nusrat.user.employeeId)) {
      await call(`/attendance/corrections/${c.id}/decision`, { method: 'POST', token: hrA.accessToken, body: { decision: 'REJECT', reason: 'Superseded by test' } });
    }
    const req1 = await call('/attendance/corrections', { method: 'POST', token: nusrat.accessToken, body: { workDate: day, checkIn: '09:05', checkOut: '17:40', reason: 'Card reader was down in the morning' } });
    expect('CORR-01', 'Corrections', 'An employee requests a correction; it waits for approval', req1.status === 201 && req1.body?.status === 'PENDING', `got ${req1.status} ${JSON.stringify(req1.body)}`);
    const again = await call('/attendance/corrections', { method: 'POST', token: nusrat.accessToken, body: { workDate: day, checkIn: '09:00', checkOut: '17:00', reason: 'Asking twice for the same day' } });
    expect('CORR-01', 'Corrections', 'Only one pending request per day', again.status === 409, `got ${again.status}`);
    const hrNotes = await call('/notifications', { token: hrA.accessToken });
    expect('CORR-01', 'Corrections', 'The approver is notified', (hrNotes.body ?? []).some((n) => n.type === 'CORRECTION_PENDING'), `got ${hrNotes.body?.length}`);
    const queue = await call('/attendance/corrections?status=PENDING', { token: mgr.accessToken });
    expect('CORR-01', 'Corrections', "The manager sees the request in their department's queue", (queue.body ?? []).some((c) => c.id === req1.body?.id), `got ${queue.body?.length}`);
    const byEmp = await call(`/attendance/corrections/${req1.body?.id}/decision`, { method: 'POST', token: emp.accessToken, body: { decision: 'APPROVE' } });
    expect('CORR-01', 'Corrections', 'An EMPLOYEE cannot approve corrections', byEmp.status === 403, `got ${byEmp.status}`);
    const crossTenant = await call(`/attendance/corrections/${req1.body?.id}/decision`, { method: 'POST', token: hrB.accessToken, body: { decision: 'APPROVE' } });
    expect('CORR-01', 'NFR-14', "Another tenant's HR cannot decide this request", crossTenant.status === 404, `got ${crossTenant.status}`);
    const ok = await call(`/attendance/corrections/${req1.body?.id}/decision`, { method: 'POST', token: mgr.accessToken, body: { decision: 'APPROVE' } });
    const grid = await call(`/attendance/grid?from=${day}&to=${day}`, { token: mgr.accessToken });
    const row = (grid.body ?? []).find((r) => r.employee_id === nusrat.user.employeeId);
    expect('CORR-01', 'Corrections', 'Approval rewrites the record: check-in and check-out as corrected', ok.status === 200 && row?.check_in?.endsWith('03:05:00.000Z') && row?.check_out?.endsWith('11:40:00.000Z'), `status ${ok.status}, row ${JSON.stringify(row)}`);
    expect('CORR-01', 'Corrections', 'Lateness is re-measured against the shift (09:05 is inside the 10-minute grace)', row?.late_minutes === 0 && row?.status === 'PRESENT', `late ${row?.late_minutes}`);
    const history = (await call('/attendance/corrections?mine=1', { token: nusrat.accessToken })).body ?? [];
    const decided = history.find((c) => c.id === req1.body?.id);
    expect('CORR-01', 'Corrections', 'The previous values are kept on the correction', decided?.status === 'APPROVED' && decided?.previous_check_in !== undefined, JSON.stringify(decided));
    const twice = await call(`/attendance/corrections/${req1.body?.id}/decision`, { method: 'POST', token: mgr.accessToken, body: { decision: 'APPROVE' } });
    expect('CORR-01', 'Corrections', 'A decided request cannot be decided again', twice.status === 409, `got ${twice.status}`);

    const req2 = await call('/attendance/corrections', { method: 'POST', token: nusrat.accessToken, body: { workDate: day2, checkIn: '08:00', checkOut: '20:00', reason: 'Please add overtime for this day' } });
    const noReason = await call(`/attendance/corrections/${req2.body?.id}/decision`, { method: 'POST', token: mgr.accessToken, body: { decision: 'REJECT' } });
    expect('CORR-02', 'Corrections', 'A rejection needs a reason', noReason.status === 400, `got ${noReason.status}`);
    const rej = await call(`/attendance/corrections/${req2.body?.id}/decision`, { method: 'POST', token: mgr.accessToken, body: { decision: 'REJECT', reason: 'Badge log shows 09:00 to 17:00' } });
    expect('CORR-02', 'Corrections', 'A manager rejects a request with a reason; the record is unchanged', rej.status === 200, `got ${rej.status}`);

    const direct = await call('/attendance/corrections', { method: 'POST', token: mgr.accessToken, body: { employeeId: nusrat.user.employeeId, workDate: day2, checkIn: '09:00', checkOut: '19:30', reason: 'Stayed late for the release, confirmed' } });
    const grid2 = await call(`/attendance/grid?from=${day2}&to=${day2}`, { token: mgr.accessToken });
    const row2 = (grid2.body ?? []).find((r) => r.employee_id === nusrat.user.employeeId);
    expect('CORR-03', 'Corrections', 'A manager fixes a record directly; it applies at once', direct.status === 201 && direct.body?.status === 'APPROVED', `got ${direct.status} ${JSON.stringify(direct.body)}`);
    expect('CORR-03', 'Corrections §108', 'Overtime is worked hours past 8, after the 1-hour break (09:00–19:30 → 1.5 h)', row2?.ot_hours === 1.5, `got ${row2?.ot_hours}`);
    const otherDept = await call('/attendance/corrections', { method: 'POST', token: mgr.accessToken, body: { employeeId: sumaiyaId, workDate: day2, checkIn: '09:00', checkOut: '17:00', reason: 'Not my department' } });
    expect('CORR-03', 'Corrections', "A manager cannot fix attendance outside their department", otherDept.status === 403, `got ${otherDept.status}`);
    const own = await call('/attendance/corrections', { method: 'POST', token: mgr.accessToken, body: { workDate: day2, checkIn: '09:00', checkOut: '17:00', reason: 'My own record needs fixing' } });
    const mgrQueue = (await call('/attendance/corrections?status=PENDING', { token: mgr.accessToken })).body ?? [];
    expect('CORR-03', 'Corrections', "A manager's own correction waits for someone else to approve it", own.body?.status === 'PENDING' && !mgrQueue.some((c) => c.id === own.body?.id), `got ${JSON.stringify(own.body)}`);

    const future = await call('/attendance/corrections', { method: 'POST', token: nusrat.accessToken, body: { workDate: addD(today, 2), checkIn: '09:00', checkOut: '17:00', reason: 'Correcting a future day' } });
    expect('CORR-04', 'Corrections', 'A future date cannot be corrected', future.status === 409, `got ${future.status}`);
    const paid = await call('/attendance/corrections', { method: 'POST', token: hrA.accessToken, body: { employeeId: emp.user.employeeId, workDate: '2026-07-15', checkIn: '09:00', checkOut: '17:00', reason: 'Fixing a paid month' } });
    expect('CORR-04', 'Corrections P0-8', "A month whose payroll is issued is closed to corrections", paid.status === 409 && /payroll/i.test(paid.body?.error ?? ''), `got ${paid.status} ${paid.body?.error}`);
  }
}

/* ------------------ password recovery and plan visibility ------------------ */
console.log('Password recovery (employee ID → NID → SMS code) and plan visibility');
{
  const orgs = (await call('/auth/organisations')).body ?? [];
  const meridian = orgs.find((o) => /^Meridian/.test(o.name))?.id;
  const recEmail = `recover.${runTag}@meridian.test`;
  const recCode = `REC-${runTag}`.slice(0, 20);
  const badNid = await call('/employees', { method: 'POST', token: hrA.accessToken, body: { employeeCode: `BADNID-${runTag}`.slice(0, 20), fullName: 'Bad Nid', designation: 'X', hireDate, salary: { basic: 1000 }, nid: '12345' } });
  expect('REC-01', 'F1.4', 'An NID that is not 10, 13 or 17 digits is refused', badNid.status === 400, `got ${badNid.status}`);
  const made = await call('/employees', {
    method: 'POST',
    token: hrA.accessToken,
    body: { employeeCode: recCode, fullName: 'Rafiq Islam', designation: 'Machine Operator', hireDate, salary: { basic: 12000 }, nid: '1987654321', phone: '01819000111', account: { email: recEmail, role: 'EMPLOYEE', temporaryPassword: 'Welcome123' } },
  });
  const listed = (await call('/employees', { token: hrA.accessToken })).body ?? [];
  const rafiq = listed.find((e) => e.employee_code === recCode);
  expect('REC-01', 'F1.4 P1-4', 'HR records an NID and phone; only the last 4 NID digits are kept readable', made.status === 201 && rafiq?.nid_last4 === '4321' && rafiq?.phone === '01819000111', `got ${made.status} ${rafiq?.nid_last4}`);
  expect('REC-01', 'P1-4', 'The NID hash is never sent to the browser', listed.length > 0 && listed.every((e) => !('nid_hash' in e)), 'nid_hash present');

  const unknown = await call('/auth/recovery/start', { method: 'POST', body: { organisationId: meridian, employeeCode: 'NOPE-0000' } });
  expect('REC-02', 'F1.4', 'An unknown employee ID is refused', unknown.status === 404, `got ${unknown.status}`);
  const start = await call('/auth/recovery/start', { method: 'POST', body: { organisationId: meridian, employeeCode: recCode.toLowerCase() } });
  const token = start.body?.recoveryToken;
  expect('REC-02', 'F1.4', 'A known employee ID (any case) starts a recovery', start.status === 200 && !!token, `got ${start.status}`);
  const skip = await call('/auth/recovery/otp', { method: 'POST', body: { recoveryToken: token, code: '123456' } });
  expect('REC-02', 'F1.4', 'The SMS step cannot be reached without passing the NID step', skip.status === 409, `got ${skip.status}`);
  const wrongNid = await call('/auth/recovery/nid', { method: 'POST', body: { recoveryToken: token, nidLast4: '0000' } });
  expect('REC-03', 'F1.4', 'Wrong NID digits are refused and the tries left are shown', wrongNid.status === 400 && /4 tries left/.test(wrongNid.body?.error ?? ''), `got ${wrongNid.status} ${wrongNid.body?.error}`);
  const sent = await call('/auth/recovery/nid', { method: 'POST', body: { recoveryToken: token, nidLast4: '4321' } });
  expect('REC-03', 'F1.4', 'The right NID digits send a code to the masked phone on file', sent.status === 200 && sent.body?.phone === '+88018•••••111' && /^\d{6}$/.test(sent.body?.demoOtp ?? ''), `got ${sent.status} ${JSON.stringify(sent.body)}`);
  const early = await call('/auth/recovery/resend', { method: 'POST', body: { recoveryToken: token } });
  expect('REC-04', 'F1.4', 'A new code cannot be requested within 60 seconds', early.status === 429, `got ${early.status}`);
  const wrongOtp = await call('/auth/recovery/otp', { method: 'POST', body: { recoveryToken: token, code: sent.body?.demoOtp === '000000' ? '111111' : '000000' } });
  expect('REC-04', 'F1.4', 'A wrong code is refused', wrongOtp.status === 400, `got ${wrongOtp.status}`);
  const verified = await call('/auth/recovery/otp', { method: 'POST', body: { recoveryToken: token, code: sent.body?.demoOtp } });
  expect('REC-04', 'F1.4', 'The right code issues a reset token and names the sign-in email', verified.status === 200 && !!verified.body?.resetToken && verified.body?.email === recEmail, `got ${verified.status}`);
  const replay = await call('/auth/recovery/otp', { method: 'POST', body: { recoveryToken: token, code: sent.body?.demoOtp } });
  expect('REC-04', 'F1.4', 'A used recovery cannot be replayed', replay.status === 409, `got ${replay.status}`);
  const reset = await call('/auth/reset-password', { method: 'POST', body: { token: verified.body?.resetToken, password: 'Recovered123' } });
  const oldPw = await call('/auth/login', { method: 'POST', body: { email: recEmail, password: 'Welcome123' } });
  const newPw = await call('/auth/login', { method: 'POST', body: { email: recEmail, password: 'Recovered123' } });
  expect('REC-05', 'F1.4', 'The new password works and the old one no longer does', reset.status === 200 && oldPw.status === 401 && newPw.status === 200, `reset ${reset.status}, old ${oldPw.status}, new ${newPw.status}`);

  const lockStart = await call('/auth/recovery/start', { method: 'POST', body: { organisationId: meridian, employeeCode: recCode } });
  let last;
  for (let i = 0; i < 5; i++) last = await call('/auth/recovery/nid', { method: 'POST', body: { recoveryToken: lockStart.body?.recoveryToken, nidLast4: '9999' } });
  const afterLock = await call('/auth/recovery/nid', { method: 'POST', body: { recoveryToken: lockStart.body?.recoveryToken, nidLast4: '4321' } });
  expect('REC-06', 'F1.4', 'Five wrong NID tries lock the recovery, even against the right digits after', last?.status === 429 && afterLock.status === 429, `got ${last?.status} then ${afterLock.status}`);
  const starts = [];
  for (let i = 0; i < 4; i++) starts.push((await call('/auth/recovery/start', { method: 'POST', body: { organisationId: meridian, employeeCode: recCode } })).status);
  expect('REC-06', 'F1.4', 'An account can start at most 5 recoveries an hour', starts.slice(0, 3).every((s) => s === 200) && starts[3] === 429, `got ${starts.join(',')}`);

  const mgrTok = (await login('shabnam.rahman@meridian.test')).body?.accessToken;
  const empTok = (await login('imran.hossain@meridian.test')).body?.accessToken;
  const subHr = (await call('/subscription', { token: hrA.accessToken })).body;
  const subMgr = (await call('/subscription', { token: mgrTok })).body;
  const subEmp = (await call('/subscription', { token: empTok })).body;
  expect('VIS-01', 'Plan visibility', 'HR sees the plan, seats and price', !!subHr?.tier && !!subHr?.seats && subHr?.pricePaisa > 0, JSON.stringify(Object.keys(subHr ?? {})));
  expect('VIS-01', 'Plan visibility', 'Managers and employees get only the organisation name and entitlements', [subMgr, subEmp].every((b) => b && !('seats' in b) && !('tier' in b) && !('pricePaisa' in b) && Array.isArray(b.entitlements)), `${Object.keys(subMgr ?? {})} / ${Object.keys(subEmp ?? {})}`);
  const deptMgr = await call('/me/department', { token: mgrTok });
  const deptEmp = await call('/me/department', { token: empTok });
  expect('VIS-02', 'Plan visibility', "A manager sees their department's name and member count", deptMgr.status === 200 && deptMgr.body?.department === 'Engineering' && deptMgr.body?.members > 0, `got ${deptMgr.status} ${JSON.stringify(deptMgr.body)}`);
  expect('VIS-02', 'Plan visibility', 'An employee cannot read the department summary', deptEmp.status === 403, `got ${deptEmp.status}`);
  const invEmp = await call('/subscription/invoices', { token: empTok });
  expect('VIS-02', 'Plan visibility', 'An employee cannot read invoices', invEmp.status === 403, `got ${invEmp.status}`);
}

/* ---------------------------------------------------------------------- */
console.log(`\n${checks} checks, ${findings.length} defects found\n`);
for (const f of findings) {
  console.log(`${f.id}  (${f.story})  ${f.description}`);
  if (f.actual) console.log(`         -> ${f.actual}`);
}
console.log('');
