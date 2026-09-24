import { describe, expect, it } from 'vitest';
import {
  correctionInstants,
  formatHm,
  isOvernight,
  isShiftWorkDay,
  lateMinutes,
  overtimeHours,
  scheduledHours,
  workedHours,
  type ShiftDef,
} from '../src/shift.js';

const general: ShiftDef = { startTime: '09:00', endTime: '17:00', breakMinutes: 60, graceMinutes: 10, workDays: null };
const night: ShiftDef = { startTime: '19:00', endTime: '03:00', breakMinutes: 30, graceMinutes: 5, workDays: [1, 2, 3, 4, 5] };

describe('shifts', () => {
  it('detects an overnight shift and its scheduled hours', () => {
    expect(isOvernight(general)).toBe(false);
    expect(isOvernight(night)).toBe(true);
    expect(scheduledHours(general)).toBe(7);
    expect(scheduledHours(night)).toBe(7.5);
  });

  it('does not count a check-in inside the grace period as late', () => {
    expect(lateMinutes(9 * 60 + 10, general)).toBe(0);
    expect(lateMinutes(9 * 60 + 11, general)).toBe(11);
    expect(lateMinutes(8 * 60 + 50, general)).toBe(0);
  });

  it('measures lateness after midnight against the night shift that started the day before', () => {
    expect(lateMinutes(19 * 60 + 20, night)).toBe(20);
    expect(lateMinutes(30, night, true)).toBe(330); // 00:30 next day is 5.5 hours late
  });

  it('excludes the unpaid break from worked hours and pays overtime only past 8 hours (§100, §108)', () => {
    const worked = workedHours('2026-09-06T03:00:00.000Z', '2026-09-06T13:00:00.000Z', 60); // 09:00–19:00 Dhaka
    expect(worked).toBe(9);
    expect(overtimeHours(worked)).toBe(1);
    expect(overtimeHours(7.5)).toBe(0);
  });

  it('turns a correction on a night shift into instants that cross midnight', () => {
    const { checkIn, checkOut } = correctionInstants('2026-09-06', '19:05', '03:10');
    expect(checkIn.toISOString()).toBe('2026-09-06T13:05:00.000Z');
    expect(checkOut!.toISOString()).toBe('2026-09-06T21:10:00.000Z');
    expect(correctionInstants('2026-09-06', '09:00', null).checkOut).toBeNull();
  });

  it('uses the shift working days when set, otherwise the organisation weekend', () => {
    // 2026-09-11 is a Friday; 2026-09-06 a Sunday.
    expect(isShiftWorkDay('2026-09-11', general, [5, 6])).toBe(false);
    expect(isShiftWorkDay('2026-09-11', night, [5, 6])).toBe(true);
    expect(isShiftWorkDay('2026-09-06', night, [5, 6])).toBe(false);
    expect(isShiftWorkDay('2026-09-06', null, [5, 6])).toBe(true);
  });

  it('formats minutes as a wall-clock time', () => {
    expect(formatHm(19 * 60 + 5)).toBe('19:05');
    expect(formatHm(27 * 60)).toBe('03:00');
  });
});
