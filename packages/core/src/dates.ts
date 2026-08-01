/**
 * Business dates in Asia/Dhaka.
 *
 * ADR-005 / P0-9. Bangladesh is UTC+6 with no DST. A server running in a UTC region that
 * computes "today" via `new Date().toISOString()` assigns a 22:30 Dhaka check-in to the
 * FOLLOWING day. That silently corrupts:
 *   - the attendance grid,
 *   - the lateness signal feeding the attrition model,
 *   - LWP day counts in payroll.
 *
 * It is invisible when testing on a laptop already set to Dhaka time, and appears only in
 * production. This module is the ONLY place the conversion is permitted.
 */

/** Fixed offset for Asia/Dhaka. No DST has been observed since the 2009 experiment ended. */
export const DHAKA_OFFSET_MINUTES = 6 * 60;

/** An ISO calendar date, `YYYY-MM-DD`, always interpreted in Asia/Dhaka. */
export type DhakaDate = string;

/** Convert an instant to its Asia/Dhaka calendar date. The only sanctioned conversion. */
export function businessDate(instant: Date | string): DhakaDate {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  if (Number.isNaN(d.getTime())) throw new Error(`businessDate: invalid instant ${String(instant)}`);
  const shifted = new Date(d.getTime() + DHAKA_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** Local wall-clock time in Dhaka as minutes past midnight — used for lateness. */
export function dhakaMinutesOfDay(instant: Date | string): number {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  const shifted = new Date(d.getTime() + DHAKA_OFFSET_MINUTES * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** Midnight Dhaka on the given business date, as a UTC instant. */
export function startOfDhakaDay(date: DhakaDate): Date {
  return new Date(new Date(`${date}T00:00:00.000Z`).getTime() - DHAKA_OFFSET_MINUTES * 60_000);
}

export function addDays(date: DhakaDate, days: number): DhakaDate {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Inclusive difference in days: `daysBetween(d, d) === 0`. */
export function daysBetween(from: DhakaDate, to: DhakaDate): number {
  const a = new Date(`${from}T00:00:00.000Z`).getTime();
  const b = new Date(`${to}T00:00:00.000Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Inclusive count of calendar days in a range. */
export function inclusiveDayCount(from: DhakaDate, to: DhakaDate): number {
  return daysBetween(from, to) + 1;
}

/** 0 = Sunday … 6 = Saturday, in Dhaka. */
export function dayOfWeek(date: DhakaDate): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

export function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

export function firstOfMonth(year: number, month1to12: number): DhakaDate {
  return `${year}-${String(month1to12).padStart(2, '0')}-01`;
}

export function lastOfMonth(year: number, month1to12: number): DhakaDate {
  return `${year}-${String(month1to12).padStart(2, '0')}-${daysInMonth(year, month1to12)}`;
}

export function eachDay(from: DhakaDate, to: DhakaDate): DhakaDate[] {
  const out: DhakaDate[] = [];
  for (let d = from; daysBetween(d, to) >= 0; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Working-week configuration.
 *
 * P0-9: Bangladesh's standard weekend is FRIDAY, plus Saturday in most corporates.
 * A default of Saturday–Sunday miscounts working days in every Bangladeshi payroll run.
 */
export interface WorkWeek {
  /** Day numbers (0=Sun … 6=Sat) that are non-working. Default: Fri(5) + Sat(6). */
  weekendDays: number[];
  /** Statutory festival holidays (§118) and any tenant-declared closures. */
  holidays: DhakaDate[];
}

export const DEFAULT_WORK_WEEK: WorkWeek = { weekendDays: [5, 6], holidays: [] };

export function isWorkingDay(date: DhakaDate, week: WorkWeek = DEFAULT_WORK_WEEK): boolean {
  if (week.weekendDays.includes(dayOfWeek(date))) return false;
  return !week.holidays.includes(date);
}

export function countWorkingDays(
  from: DhakaDate,
  to: DhakaDate,
  week: WorkWeek = DEFAULT_WORK_WEEK,
): number {
  return eachDay(from, to).filter((d) => isWorkingDay(d, week)).length;
}
