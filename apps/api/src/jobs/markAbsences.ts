/**
 * F3.3 — nightly absence marking.
 *
 * For every active employee, each working day in the window that has no attendance record
 * and no approved leave becomes an ABSENT row. The rule itself is pure (packages/core
 * attendance.ts); this job only reads and writes. Today is never marked: the employee may
 * still check in.
 *
 * Run directly:  npm run job:absences
 */

import { pathToFileURL } from 'node:url';
import { absencesToMark, addDays, businessDate } from '@pulsehr/core';
import { all, nowIso, openDb, run, uuid } from '../db.js';
import { Repo } from '../repo.js';
import { registerHandler } from './queue.js';

/** How far back one run looks. A missed night is caught up by the next run. */
export const ABSENCE_WINDOW_DAYS = 14;

export async function markAbsences(organisationId: string, userId: string, asOf?: string) {
  const today = asOf ?? businessDate(new Date());
  const to = addDays(today, -1);
  const from = addDays(today, -ABSENCE_WINDOW_DAYS);

  const org = await all('SELECT weekend_days FROM organisation WHERE id = ?', organisationId);
  const weekendDays = String(org[0]?.weekend_days ?? '5,6').split(',').map(Number);
  const holidays = (await all('SELECT holiday_date FROM holiday WHERE organisation_id = ?', organisationId)).map((h) =>
    String(h.holiday_date),
  );

  const employees = await all(
    `SELECT id, hire_date, separation_date FROM employee WHERE organisation_id = ? AND employment_status = 'ACTIVE'`,
    organisationId,
  );

  let marked = 0;
  for (const e of employees) {
    const recorded = await all(
      'SELECT work_date FROM attendance WHERE employee_id = ? AND work_date BETWEEN ? AND ?',
      e.id,
      from,
      to,
    );
    const leave = await all(
      `SELECT start_date, end_date FROM leave_request
        WHERE employee_id = ? AND status = 'APPROVED' AND end_date >= ? AND start_date <= ?`,
      e.id,
      from,
      to,
    );
    const marks = absencesToMark({
      from,
      to,
      hireDate: String(e.hire_date),
      separationDate: e.separation_date ? String(e.separation_date) : null,
      week: { weekendDays, holidays },
      recordedDates: recorded.map((r) => String(r.work_date)),
      approvedLeave: leave.map((l) => ({ startDate: String(l.start_date), endDate: String(l.end_date) })),
    });
    for (const m of marks) {
      await run(
        `INSERT INTO attendance (id, organisation_id, employee_id, work_date, status, is_unplanned)
         VALUES (?, ?, ?, ?, 'ABSENT', ?)
         ON CONFLICT (employee_id, work_date) DO NOTHING`,
        uuid(),
        organisationId,
        e.id,
        m.date,
        m.unplanned ? 1 : 0,
      );
      marked += 1;
    }
  }

  await new Repo(organisationId, userId).audit('MARK_ABSENCES', 'attendance', null, { from, to, marked, at: nowIso() });
  return { from, to, marked };
}

registerHandler('MARK_ABSENCES', (payload) => markAbsences(String(payload.organisationId), String(payload.userId)));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await openDb();
  for (const org of await all('SELECT id, name FROM organisation')) {
    console.log(`[absences] ${org.name}:`, await markAbsences(String(org.id), 'system'));
  }
}
