/**
 * F3.3 — absence marking.
 *
 * A working day on which an employee neither checked in nor had approved leave is an
 * absence. The nightly job applies this to days that have already ended, so today (when the
 * employee may still check in) is never marked.
 *
 * An absence is flagged `unplanned` when it is a single day next to a weekend or holiday —
 * the pattern the attrition scorecard's F2 feature counts. A multi-day absence is still an
 * absence, but not that pattern, and counting it would penalise illness (P1-16).
 */

import { addDays, eachDay, isWorkingDay, type DhakaDate, type WorkWeek } from './dates.js';

export interface AbsenceInput {
  /** First and last day to check, inclusive. */
  from: DhakaDate;
  to: DhakaDate;
  hireDate: DhakaDate;
  /** Last day of employment, if the employee has left. */
  separationDate?: DhakaDate | null;
  week: WorkWeek;
  /** Overrides `week` day by day — an employee's shift may work days the organisation doesn't. */
  isWorkingDay?: (date: DhakaDate) => boolean;
  /** Days that already have an attendance row of any status. */
  recordedDates: Iterable<DhakaDate>;
  /** Approved leave, inclusive ranges. */
  approvedLeave: { startDate: DhakaDate; endDate: DhakaDate }[];
}

export interface AbsenceMark {
  date: DhakaDate;
  unplanned: boolean;
}

export function absencesToMark(input: AbsenceInput): AbsenceMark[] {
  const recorded = new Set(input.recordedDates);
  const onLeave = (d: DhakaDate) => input.approvedLeave.some((l) => l.startDate <= d && d <= l.endDate);
  const start = input.from > input.hireDate ? input.from : input.hireDate;
  const end = input.separationDate && input.separationDate < input.to ? input.separationDate : input.to;
  if (start > end) return [];

  const working = input.isWorkingDay ?? ((d: DhakaDate) => isWorkingDay(d, input.week));
  const absent = eachDay(start, end).filter((d) => working(d) && !recorded.has(d) && !onLeave(d));
  const absentSet = new Set(absent);
  // Neighbours are judged by what they are, not only inside the window: an absence on the
  // first or last day of the window still sees the weekend next to it.
  const isAbsentDay = (d: DhakaDate) => absentSet.has(d);
  const isOffDay = (d: DhakaDate) => !working(d);

  return absent.map((date) => {
    const before = addDays(date, -1);
    const after = addDays(date, 1);
    const singleDay = !isAbsentDay(before) && !isAbsentDay(after);
    return { date, unplanned: singleDay && (isOffDay(before) || isOffDay(after)) };
  });
}
