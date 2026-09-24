/**
 * Shifts — duty times, lateness and overtime measured against the employee's own shift.
 *
 * A shift is a daily start and end time in Asia/Dhaka with an unpaid break and a grace
 * period. A shift whose end is earlier than its start runs overnight (a night shift serving
 * US clients, 19:00–03:00): its attendance belongs to the business date it STARTED on.
 *
 * Overtime follows the Labour Act (§100, §108): hours actually worked beyond the ordinary 8
 * in a day, whatever the shift length. Worked hours exclude the shift's unpaid break.
 */

import { addDays, dayOfWeek, startOfDhakaDay, type DhakaDate } from './dates.js';

export const ORDINARY_DAILY_HOURS = 8;
const DAY = 24 * 60;

export interface ShiftDef {
  /** 'HH:MM', Asia/Dhaka. */
  startTime: string;
  endTime: string;
  breakMinutes: number;
  /** Check-ins up to this many minutes after the start are not counted as late. */
  graceMinutes: number;
  /** Working weekdays, 0 = Sunday … 6 = Saturday. Null = the organisation's usual week. */
  workDays: number[] | null;
}

export function parseHm(hm: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hm);
  if (!m) throw new Error(`Invalid time "${hm}" — expected HH:MM`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function formatHm(minutes: number): string {
  const m = ((minutes % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function isOvernight(s: Pick<ShiftDef, 'startTime' | 'endTime'>): boolean {
  return parseHm(s.endTime) <= parseHm(s.startTime);
}

/** Scheduled working hours: the shift's length less its unpaid break. */
export function scheduledHours(s: Pick<ShiftDef, 'startTime' | 'endTime' | 'breakMinutes'>): number {
  const span = (parseHm(s.endTime) - parseHm(s.startTime) + DAY) % DAY || DAY;
  return Math.round(((span - s.breakMinutes) / 60) * 100) / 100;
}

/**
 * Minutes late for a check-in at `minutesOfDay` (Dhaka wall clock). `nextDay` is true when
 * the check-in happened after midnight for an overnight shift that started the day before.
 * Within the grace period the employee is not late at all.
 */
export function lateMinutes(minutesOfDay: number, s: Pick<ShiftDef, 'startTime' | 'graceMinutes'>, nextDay = false): number {
  const late = minutesOfDay + (nextDay ? DAY : 0) - parseHm(s.startTime);
  return late > s.graceMinutes ? late : 0;
}

/** Hours worked between two instants, less the unpaid break, never negative. */
export function workedHours(checkIn: Date | string, checkOut: Date | string, breakMinutes: number): number {
  const elapsed = (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 60_000;
  return Math.max(0, Math.round(((elapsed - breakMinutes) / 60) * 100) / 100);
}

export function overtimeHours(worked: number): number {
  return Math.max(0, Math.round((worked - ORDINARY_DAILY_HOURS) * 100) / 100);
}

/** The UTC instant for a Dhaka wall-clock time on a business date. */
export function dhakaInstant(date: DhakaDate, hm: string): Date {
  return new Date(startOfDhakaDay(date).getTime() + parseHm(hm) * 60_000);
}

/**
 * Turns a correction typed as times on a business date into instants. A check-out at or
 * before the check-in time is the next morning (an overnight shift).
 */
export function correctionInstants(workDate: DhakaDate, checkIn: string, checkOut: string | null): { checkIn: Date; checkOut: Date | null } {
  const inAt = dhakaInstant(workDate, checkIn);
  if (!checkOut) return { checkIn: inAt, checkOut: null };
  const outDate = parseHm(checkOut) <= parseHm(checkIn) ? addDays(workDate, 1) : workDate;
  return { checkIn: inAt, checkOut: dhakaInstant(outDate, checkOut) };
}

/** Whether the shift works on this date, given the organisation's weekend. */
export function isShiftWorkDay(date: DhakaDate, s: Pick<ShiftDef, 'workDays'> | null, weekendDays: number[]): boolean {
  const dow = dayOfWeek(date);
  return s?.workDays ? s.workDays.includes(dow) : !weekendDays.includes(dow);
}
