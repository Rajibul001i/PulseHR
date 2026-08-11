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
import { getDb, nowIso, openDb, run, uuid } from './db.js';
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

function seedOrganisation(opts: {
  name: string;
  tier: 'STARTER' | 'GROWTH' | 'ENTERPRISE';
  emailDomain: string;
  profiles: Profile[];
  seed: number;
}): void {
  const orgId = uuid();
  const random = rng(opts.seed);

  const seatLimit = opts.tier === 'STARTER' ? 50 : opts.tier === 'GROWTH' ? 300 : 5000;
  run(
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
  run(
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
    run(
      'INSERT INTO department (id, organisation_id, name, office_start_time) VALUES (?, ?, ?, ?)',
      id, orgId, dept, start,
    );
  }

  // HR admin account
  const hrUserId = uuid();
  run(
    `INSERT INTO app_user (id, organisation_id, email, password_hash, role, is_active, created_at)
     VALUES (?, ?, ?, ?, 'HR_ADMIN', 1, ?)`,
    hrUserId,
    orgId,
    `hr@${opts.emailDomain}`,
    hashPassword('Passw0rd!'),
    nowIso(),
  );

  const employeeIds: string[] = [];
  let managerId: string | null = null;

  opts.profiles.forEach((profile, index) => {
    const employeeId = uuid();
    const userId = uuid();
    const isManager = profile.designation.includes('Manager') || profile.designation.includes('Lead');

    const emailLocal = profile.name.toLowerCase().replace(/[^a-z]+/g, '.');
    run(
      `INSERT INTO app_user (id, organisation_id, email, password_hash, role, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      userId,
      orgId,
      `${emailLocal}@${opts.emailDomain}`,
      hashPassword('Passw0rd!'),
      isManager ? 'MANAGER' : 'EMPLOYEE',
      nowIso(),
    );

    const hireDate = addDays(TODAY, -Math.round(profile.monthsTenure * 30.44));
    // A recent manager change only for the "leaving" profiles — F6.
    const managerChangedAt = profile.risk === 'leaving' && index % 2 === 0 ? addDays(TODAY, -45) : null;

    run(
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

    structure(uuid(), hireDate, Math.round(basic * 0.85));
    if (profile.risk !== 'leaving' && profile.monthsTenure > 14) {
      structure(uuid(), addDays(TODAY, -200), basic); // a raise ~6.5 months ago
    }

    // --- Leave: accrual to date, then annual grants.
    const workedDays = countWorkingDaysApprox(hireDate, TODAY);
    const accrued = accrueEarnedLeave(workedDays);
    if (accrued > 0) {
      run(
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
      run(
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
      run(
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
    seedAttendance(orgId, employeeId, profile, random);
  });

  // Noticeboard
  for (const [title, body] of [
    ['Eid-ul-Adha Holiday Schedule', 'The office will remain closed for the festival holiday. Payroll for the month will be processed on schedule.'],
    ['Quarterly OKR Review', 'All teams should finalise their quarterly key results before the review cycle opens.'],
    ['Updated Leave Policy', 'Earned leave now accrues per the statutory rate of one day per eighteen days worked, visible in your dashboard.'],
  ] as const) {
    run(
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

function seedAttendance(
  orgId: string,
  employeeId: string,
  profile: Profile,
  random: () => number,
): void {
  const from = addDays(TODAY, -HISTORY_DAYS);

  for (const date of eachDay(from, TODAY)) {
    // P0-9: Friday + Saturday weekend, not Saturday + Sunday.
    if (!isWorkingDay(date, DEFAULT_WORK_WEEK)) {
      run(
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
      run(
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

    run(
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

openDb();
const db = getDb();

// Idempotent: wipe and re-seed so the demo is reproducible. Order matters -- a table must
// be cleared before anything it references (FK enforcement is on, db.ts:26).
for (const table of [
  'attrition_contribution', 'attrition_score', 'payslip_line', 'payslip', 'leave_ledger',
  'leave_request', 'attendance', 'salary_structure', 'notice', 'audit_log', 'holiday',
  'notification', 'password_reset_token', 'employee_document', // added with migrations 004-007
  'session', 'employee', 'app_user', 'department',
  'subscription_event', 'feature_gate_hit', 'organisation',
]) {
  db.exec(`DELETE FROM ${table}`);
}

seedOrganisation({
  name: 'Meridian Textiles Ltd.',
  tier: 'ENTERPRISE',
  emailDomain: 'meridian.test',
  profiles: PROFILES,
  seed: 20260802,
});

// A second tenant. Without it, tenant isolation cannot be tested (NFR-14).
seedOrganisation({
  name: 'Bengal Logistics Ltd.',
  tier: 'GROWTH',
  emailDomain: 'bengal.test',
  profiles: PROFILES.slice(0, 6).map((p) => ({ ...p, name: `${p.name} (BL)` })),
  seed: 991122,
});

// A third tenant on STARTER, so the locked-navigation and upgrade paths are demonstrable.
// With only Growth and Enterprise seeded there was no way to see a gated feature.
seedOrganisation({
  name: 'Dhaka Craft Apparels Ltd.',
  tier: 'STARTER',
  emailDomain: 'dhakacraft.test',
  profiles: PROFILES.slice(0, 4).map((p) => ({ ...p, name: `${p.name} (DC)` })),
  seed: 550011,
});

console.log('[seed] done.');
