/**
 * Seed data.
 *
 * Creates TWO organisations deliberately: tenant isolation (ADR-003 / P0-5) cannot be
 * demonstrated — or tested — with a single tenant in the database.
 *
 * Attendance is generated with a Friday+Saturday weekend (P0-9) and a deterministic PRNG,
 * so every run produces the same database and the demo is reproducible.
 */

import {
  accrueEarnedLeave,
  addDays,
  annualGrant,
  businessDate,
  DEFAULT_WORK_WEEK,
  eachDay,
  isWorkingDay,
  taka,
} from '@pulsehr/core';
import { all, exec, nowIso, one, openDb, run, uuid } from './db.js';
import { hashPassword } from './auth.js';

/** Deterministic PRNG (mulberry32) — a seeded demo must be reproducible. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TODAY = businessDate(new Date());
const HISTORY_DAYS = 180;

// hashPassword is async now (load-test finding, docs/17-load-test-report.md -- scrypt must
// not block the live server's event loop). Every seeded account uses this one literal demo
// password, so it's hashed once here rather than threading async through every call site in
// seedOrganisation -- this is throwaway demo data, not a live auth path.
const DEMO_PASSWORD_HASH = await hashPassword('Passw0rd!');

interface Profile {
  name: string;
  designation: string;
  gender: 'M' | 'F';
  monthsTenure: number;
  basic: number;
  /** Drives the generated behaviour pattern — how the attrition signals will look. */
  risk: 'calm' | 'drifting' | 'leaving';
  department: string;
}

const PROFILES: Profile[] = [
  { name: 'Farhana Akter', designation: 'Senior Software Engineer', gender: 'F', monthsTenure: 12, basic: 65_000, risk: 'leaving', department: 'Engineering' },
  { name: 'Tanvir Hasan', designation: 'Software Engineer', gender: 'M', monthsTenure: 24, basic: 48_000, risk: 'leaving', department: 'Engineering' },
  { name: 'Nusrat Jahan', designation: 'QA Engineer', gender: 'F', monthsTenure: 13, basic: 38_000, risk: 'drifting', department: 'Engineering' },
  { name: 'Sabbir Ahmed', designation: 'DevOps Engineer', gender: 'M', monthsTenure: 30, basic: 72_000, risk: 'calm', department: 'Engineering' },
  { name: 'Mahmudul Karim', designation: 'Software Engineer', gender: 'M', monthsTenure: 8, basic: 42_000, risk: 'calm', department: 'Engineering' },
  { name: 'Rifat Chowdhury', designation: 'Frontend Engineer', gender: 'M', monthsTenure: 11, basic: 45_000, risk: 'drifting', department: 'Engineering' },
  { name: 'Shabnam Rahman', designation: 'Engineering Manager', gender: 'F', monthsTenure: 42, basic: 95_000, risk: 'calm', department: 'Engineering' },
  { name: 'Imran Hossain', designation: 'Data Analyst', gender: 'M', monthsTenure: 12, basic: 40_000, risk: 'leaving', department: 'Analytics' },
  { name: 'Sumaiya Islam', designation: 'Business Analyst', gender: 'F', monthsTenure: 19, basic: 44_000, risk: 'calm', department: 'Analytics' },
  { name: 'Arif Mahmud', designation: 'Accounts Officer', gender: 'M', monthsTenure: 36, basic: 32_000, risk: 'calm', department: 'Finance' },
  { name: 'Kamrun Nahar', designation: 'Finance Manager', gender: 'F', monthsTenure: 48, basic: 85_000, risk: 'calm', department: 'Finance' },
  { name: 'Jubayer Alam', designation: 'Accounts Executive', gender: 'M', monthsTenure: 24, basic: 28_000, risk: 'drifting', department: 'Finance' },
  { name: 'Mehjabin Sultana', designation: 'HR Executive', gender: 'F', monthsTenure: 15, basic: 34_000, risk: 'calm', department: 'People' },
  { name: 'Rezaul Haque', designation: 'Recruitment Officer', gender: 'M', monthsTenure: 9, basic: 30_000, risk: 'calm', department: 'People' },
  { name: 'Tahmina Begum', designation: 'Admin Officer', gender: 'F', monthsTenure: 26, basic: 26_000, risk: 'drifting', department: 'People' },
  { name: 'Shafiqul Islam', designation: 'Sales Executive', gender: 'M', monthsTenure: 12, basic: 35_000, risk: 'leaving', department: 'Sales' },
  { name: 'Ruma Khatun', designation: 'Sales Executive', gender: 'F', monthsTenure: 7, basic: 33_000, risk: 'calm', department: 'Sales' },
  { name: 'Nazmul Huda', designation: 'Sales Manager', gender: 'M', monthsTenure: 40, basic: 78_000, risk: 'calm', department: 'Sales' },
  { name: 'Fahim Reza', designation: 'Support Engineer', gender: 'M', monthsTenure: 23, basic: 31_000, risk: 'drifting', department: 'Support' },
  { name: 'Ishrat Jahan', designation: 'Support Lead', gender: 'F', monthsTenure: 33, basic: 52_000, risk: 'calm', department: 'Support' },
];

async function seedOrganisation(opts: {
  name: string;
  tier: 'STARTER' | 'GROWTH' | 'ENTERPRISE';
  emailDomain: string;
  profiles: Profile[];
  seed: number;
}): Promise<void> {
  const orgId = uuid();
  const random = rng(opts.seed);

  const seatLimit = opts.tier === 'STARTER' ? 50 : opts.tier === 'GROWTH' ? 300 : 5000;
  await run(
    `INSERT INTO organisation (id, name, tier, weekend_days, plan_status, seat_limit,
                               billing_email, renews_on, created_at)
     VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`,
    orgId,
    opts.name,
    opts.tier,
    '5,6',
    seatLimit,
    `billing@${opts.emailDomain}`,
    addDays(TODAY, 300),
    nowIso(),
  );
  await run(
    `INSERT INTO subscription_event (id, organisation_id, event_type, from_tier, to_tier,
                                     effective_on, note, created_at)
     VALUES (?, ?, 'SUBSCRIBED', NULL, ?, ?, 'Initial subscription', ?)`,
    uuid(),
    orgId,
    opts.tier,
    addDays(TODAY, -365),
    nowIso(),
  );

  const departments = new Map<string, string>();
  for (const dept of new Set(opts.profiles.map((p) => p.department))) {
    const id = uuid();
    departments.set(dept, id);
    // BUG-07: office start is per-department. Support starts early, Sales starts late.
    const start = dept === 'Support' ? '08:30' : dept === 'Sales' ? '10:00' : '09:00';
    await run(
      'INSERT INTO department (id, organisation_id, name, office_start_time) VALUES (?, ?, ?, ?)',
      id, orgId, dept, start,
    );
  }

  // HR admin account
  const hrUserId = uuid();
  await run(
    `INSERT INTO app_user (id, organisation_id, email, password_hash, role, is_active, created_at)
     VALUES (?, ?, ?, ?, 'HR_ADMIN', 1, ?)`,
    hrUserId,
    orgId,
    `hr@${opts.emailDomain}`,
    DEMO_PASSWORD_HASH,
    nowIso(),
  );

  const employeeIds: string[] = [];
  let managerId: string | null = null;

  // Sequential, not Promise.all -- a manager's employeeId must be committed before the next
  // profile in line can reference it as manager_id (see `if (isManager) managerId = ...`
  // below). A .forEach with an async callback would fire every iteration concurrently and
  // silently drop this ordering.
  for (const [index, profile] of opts.profiles.entries()) {
    const employeeId = uuid();
    const userId = uuid();
    const isManager = profile.designation.includes('Manager') || profile.designation.includes('Lead');

    const emailLocal = profile.name.toLowerCase().replace(/[^a-z]+/g, '.');
    await run(
      `INSERT INTO app_user (id, organisation_id, email, password_hash, role, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      userId,
      orgId,
      `${emailLocal}@${opts.emailDomain}`,
      DEMO_PASSWORD_HASH,
      isManager ? 'MANAGER' : 'EMPLOYEE',
      nowIso(),
    );

    const hireDate = addDays(TODAY, -Math.round(profile.monthsTenure * 30.44));
    // A recent manager change only for the "leaving" profiles — F6.
    const managerChangedAt = profile.risk === 'leaving' && index % 2 === 0 ? addDays(TODAY, -45) : null;

    await run(
      `INSERT INTO employee (id, organisation_id, user_id, department_id, manager_id, employee_code,
                             full_name, designation, gender, hire_date, employment_status,
                             manager_changed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
      employeeId,
      orgId,
      userId,
      departments.get(profile.department)!,
      isManager ? null : managerId,
      `EMP-${String(index + 1).padStart(4, '0')}`,
      profile.name,
      profile.designation,
      profile.gender,
      hireDate,
      managerChangedAt,
      nowIso(),
    );
    if (isManager) managerId = employeeId;
    employeeIds.push(employeeId);

    // --- Salary structure. "calm" long-tenure staff got a raise; "leaving" did not (F5).
    const basic = taka(profile.basic);
    const structure = (id: string, from: string, b: number) =>
      run(
        `INSERT INTO salary_structure (id, organisation_id, employee_id, effective_from, basic,
                                        house_rent, medical, conveyance, food, dearness,
                                        provident_fund_pct, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 10, ?)`,
        id,
        orgId,
        employeeId,
        from,
        b,
        Math.round(b * 0.5),
        taka(1_500),
        taka(1_500),
        taka(1_000),
        nowIso(),
      );

    await structure(uuid(), hireDate, Math.round(basic * 0.85));
    if (profile.risk !== 'leaving' && profile.monthsTenure > 14) {
      await structure(uuid(), addDays(TODAY, -200), basic); // a raise ~6.5 months ago
    }

    // --- Leave: accrual to date, then annual grants.
    const workedDays = countWorkingDaysApprox(hireDate, TODAY);
    const accrued = accrueEarnedLeave(workedDays);
    if (accrued > 0) {
      await run(
        `INSERT INTO leave_ledger (id, organisation_id, employee_id, leave_type, delta,
                                   effective_date, reason, created_by, created_at)
         VALUES (?, ?, ?, 'EARNED', ?, ?, ?, 'system', ?)`,
        uuid(),
        orgId,
        employeeId,
        accrued,
        hireDate,
        `§117 accrual: ${workedDays} days worked / 18`,
        nowIso(),
      );
    }
    for (const type of ['CASUAL', 'SICK'] as const) {
      const grant = annualGrant(type, 12);
      await run(
        `INSERT INTO leave_ledger (id, organisation_id, employee_id, leave_type, delta,
                                   effective_date, reason, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'system', ?)`,
        uuid(),
        orgId,
        employeeId,
        type,
        grant,
        `${TODAY.slice(0, 4)}-01-01`,
        `Annual statutory grant`,
        nowIso(),
      );
    }

    // "leaving" employees have drawn down leave heavily in the last 90 days (F4).
    if (profile.risk === 'leaving' && accrued >= 6) {
      await run(
        `INSERT INTO leave_ledger (id, organisation_id, employee_id, leave_type, delta,
                                   effective_date, reason, created_by, created_at)
         VALUES (?, ?, ?, 'EARNED', ?, ?, 'Leave taken', 'system', ?)`,
        uuid(),
        orgId,
        employeeId,
        -Math.floor(accrued * 0.7),
        addDays(TODAY, -40),
        nowIso(),
      );
    }

    // --- Attendance history
    await seedAttendance(orgId, employeeId, profile, random);
  }

  // Noticeboard
  for (const [title, body] of [
    ['Eid-ul-Adha Holiday Schedule', 'The office will remain closed for the festival holiday. Payroll for the month will be processed on schedule.'],
    ['Quarterly OKR Review', 'All teams should finalise their quarterly key results before the review cycle opens.'],
    ['Updated Leave Policy', 'Earned leave now accrues per the statutory rate of one day per eighteen days worked, visible in your dashboard.'],
  ] as const) {
    await run(
      'INSERT INTO notice (id, organisation_id, title, body, published_by, published_at) VALUES (?, ?, ?, ?, ?, ?)',
      uuid(),
      orgId,
      title,
      body,
      hrUserId,
      nowIso(),
    );
  }

  console.log(
    `[seed] ${opts.name} (${opts.tier}) — ${employeeIds.length} employees, login hr@${opts.emailDomain} / Passw0rd!`,
  );
}

async function seedAttendance(
  orgId: string,
  employeeId: string,
  profile: Profile,
  random: () => number,
): Promise<void> {
  const from = addDays(TODAY, -HISTORY_DAYS);

  for (const date of eachDay(from, TODAY)) {
    // P0-9: Friday + Saturday weekend, not Saturday + Sunday.
    if (!isWorkingDay(date, DEFAULT_WORK_WEEK)) {
      await run(
        `INSERT INTO attendance (id, organisation_id, employee_id, work_date, status)
         VALUES (?, ?, ?, ?, 'WEEKEND')`,
        uuid(),
        orgId,
        employeeId,
        date,
      );
      continue;
    }

    const daysAgo = -Math.round(
      (new Date(`${date}T00:00:00Z`).getTime() - new Date(`${TODAY}T00:00:00Z`).getTime()) /
        86_400_000,
    );
    const recent = daysAgo <= 60;

    // Lateness drifts upward in the recent window for at-risk profiles (F3).
    let baseLate = 3;
    if (profile.risk === 'leaving') baseLate = recent ? 26 : 6;
    else if (profile.risk === 'drifting') baseLate = recent ? 13 : 6;
    const lateMinutes = Math.max(0, Math.round(baseLate + (random() - 0.5) * 10));

    // Unplanned single-day absences adjacent to a weekend (F2) — Sunday or Thursday,
    // i.e. the days that bracket a Fri/Sat weekend.
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const weekendAdjacent = dow === 0 || dow === 4;
    const absenceChance = profile.risk === 'leaving' ? 0.1 : profile.risk === 'drifting' ? 0.04 : 0.01;
    const isAbsent = recent && weekendAdjacent && random() < absenceChance;

    if (isAbsent) {
      await run(
        `INSERT INTO attendance (id, organisation_id, employee_id, work_date, status, is_unplanned)
         VALUES (?, ?, ?, ?, 'ABSENT', 1)`,
        uuid(),
        orgId,
        employeeId,
        date,
      );
      continue;
    }

    const checkIn = `${date}T${String(3 + Math.floor(lateMinutes / 60)).padStart(2, '0')}:${String(lateMinutes % 60).padStart(2, '0')}:00.000Z`;
    const otHours = profile.risk === 'leaving' && random() < 0.4 ? Math.round(random() * 3 * 10) / 10 : 0;
    const checkOut = `${date}T${String(12 + Math.floor(otHours)).padStart(2, '0')}:00:00.000Z`;

    await run(
      `INSERT INTO attendance (id, organisation_id, employee_id, work_date, check_in, check_out,
                               late_minutes, ot_hours, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PRESENT')`,
      uuid(),
      orgId,
      employeeId,
      date,
      checkIn,
      checkOut,
      lateMinutes,
      otHours,
    );
  }
}

function countWorkingDaysApprox(from: string, to: string): number {
  const total = Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
  );
  return Math.max(0, Math.round(total * (5 / 7))); // 5 working days in 7
}

/* --------------------------------- main ---------------------------------- */

await openDb();

// SQLite (no DATABASE_URL): the file lives on Render's ephemeral disk anyway (wiped on every
// restart regardless), so wipe-and-reseed on every run is what already made the free-tier
// demo deterministic -- see render.yaml's header comment. PostgreSQL (DATABASE_URL set): the
// whole point of a real database is that it persists, so this must NOT run on every restart
// the way the startCommand's `npm run seed` invocation does today -- that would silently
// erase real data on every redeploy. Guarded on the database already having an organisation:
// empty (first boot against a fresh Postgres instance) seeds normally; non-empty skips
// entirely, whether this script was launched by render.yaml's startCommand or run by hand --
// wiping real Postgres data should require a deliberate action (dropping/truncating tables
// directly), not just re-running the same command that seeded it the first time.
if (process.env.DATABASE_URL) {
  const existing = await all('SELECT id FROM organisation LIMIT 1');
  if (existing.length > 0) {
    console.log('[seed] PostgreSQL already has data -- skipping to avoid erasing it.');
    process.exit(0);
  }
}

// Idempotent: wipe and re-seed so the demo is reproducible. Order matters -- a table must
// be cleared before anything it references (FK enforcement is on, db.ts).
for (const table of [
  'key_result', 'candidate_stage_event', 'candidate_evaluation', 'notice_department', 'notice_read',
  'attrition_contribution', 'attrition_score', 'payslip_line', 'payslip', 'leave_ledger',
  'leave_request', 'attendance', 'salary_structure', 'notice', 'audit_log', 'holiday',
  'notification', 'password_reset_token', 'employee_document', // added with migrations 004-007
  'objective', 'review_score', 'candidate', 'vacancy', // added with migrations 008-009
  'session', 'employee', 'app_user', 'department',
  'subscription_event', 'feature_gate_hit', 'invoice', 'organisation', // invoice added with migration 011
]) {
  await exec(`DELETE FROM ${table}`);
}

await seedOrganisation({
  name: 'Meridian Textiles Ltd.',
  tier: 'ENTERPRISE',
  emailDomain: 'meridian.test',
  profiles: PROFILES,
  seed: 20260802,
});

// A second tenant. Without it, tenant isolation cannot be tested (NFR-14).
await seedOrganisation({
  name: 'Bengal Logistics Ltd.',
  tier: 'GROWTH',
  emailDomain: 'bengal.test',
  profiles: PROFILES.slice(0, 6).map((p) => ({ ...p, name: `${p.name} (BL)` })),
  seed: 991122,
});

// A third tenant on STARTER, so the locked-navigation and upgrade paths are demonstrable.
// With only Growth and Enterprise seeded there was no way to see a gated feature.
await seedOrganisation({
  name: 'Dhaka Craft Apparels Ltd.',
  tier: 'STARTER',
  emailDomain: 'dhakacraft.test',
  profiles: PROFILES.slice(0, 4).map((p) => ({ ...p, name: `${p.name} (DC)` })),
  seed: 550011,
});

/**
 * F7.1 — a couple of published vacancies per org so the public careers page (redesigned
 * 13 Aug 2026) has something real to demo, not just its own empty state. ATS requires the
 * `ats` feature (GROWTH+), so Dhaka Craft (STARTER) is deliberately left with none — its
 * careers page legitimately has nothing to show, which is itself worth seeing.
 */
async function seedVacancy(hrEmail: string, title: string, requirements: string, deadlineDays: number): Promise<void> {
  const hr = await one('SELECT id, organisation_id FROM app_user WHERE email = ?', hrEmail);
  if (!hr) return;
  await run(
    `INSERT INTO vacancy (id, organisation_id, title, requirements, deadline, status, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, 'PUBLISHED', ?, ?)`,
    uuid(),
    hr.organisation_id,
    title,
    requirements,
    addDays(TODAY, deadlineDays),
    hr.id,
    nowIso(),
  );
}

await seedVacancy(
  'hr@meridian.test',
  'Senior Backend Engineer',
  '5+ years designing distributed systems in Node.js or Go. Comfortable owning a service end to end, from schema design through on-call. You will work closely with our data and platform teams to keep the core HR engine fast under real payroll load.',
  35,
);
await seedVacancy(
  'hr@meridian.test',
  'QA Automation Engineer',
  "Own the adversarial test suite. Experience with black-box API testing, CI pipelines, and a healthy suspicion of your own team's claims about what already works.",
  4,
);
await seedVacancy(
  'hr@meridian.test',
  'Merchandising Coordinator',
  'Coordinate sample approvals and order timelines between our design team and export buyers. Strong spreadsheet skills and comfort chasing down a slipping deadline across three time zones.',
  16,
);
await seedVacancy(
  'hr@bengal.test',
  'Logistics Coordinator',
  'Coordinate shipment schedules across our export partners. Comfortable with spreadsheets, tight deadlines, and talking to freight forwarders daily.',
  9,
);
await seedVacancy(
  'hr@bengal.test',
  'Fleet Operations Analyst',
  'Track fleet utilisation and turnaround times across our regional routes, and turn that into a weekly report leadership actually reads. SQL literacy expected.',
  27,
);

console.log('[seed] done.');
