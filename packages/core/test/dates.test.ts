import { describe, expect, it } from 'vitest';
import {
  businessDate,
  countWorkingDays,
  dayOfWeek,
  daysInMonth,
  dhakaMinutesOfDay,
  eachDay,
  inclusiveDayCount,
  isWorkingDay,
  DEFAULT_WORK_WEEK,
} from '../src/dates.js';

describe('businessDate — ADR-005 / P0-9', () => {
  /**
   * THE BUG THIS PREVENTS: a server in a UTC region computing "today" from
   * new Date().toISOString() assigns a 23:30 Dhaka check-in to the FOLLOWING day,
   * silently corrupting attendance, the lateness signal, and LWP day counts.
   */
  it('keeps a 23:30 Dhaka check-in on the same business date', () => {
    // 17:30 UTC === 23:30 Dhaka on 2 August
    expect(businessDate('2026-08-02T17:30:00Z')).toBe('2026-08-02');
  });

  it('rolls to the next business date at Dhaka midnight, not UTC midnight', () => {
    // 18:30 UTC === 00:30 Dhaka on 3 August
    expect(businessDate('2026-08-02T18:30:00Z')).toBe('2026-08-03');
  });

  it('naive UTC slicing would have got both of those wrong', () => {
    const naive = (s: string) => new Date(s).toISOString().slice(0, 10);
    expect(naive('2026-08-02T17:30:00Z')).toBe('2026-08-02'); // agrees by luck
    expect(naive('2026-08-02T18:30:00Z')).toBe('2026-08-02'); // WRONG — should be 08-03
    expect(businessDate('2026-08-02T18:30:00Z')).not.toBe(naive('2026-08-02T18:30:00Z'));
  });

  it('handles the 18:00 UTC boundary exactly', () => {
    expect(businessDate('2026-08-02T17:59:59Z')).toBe('2026-08-02');
    expect(businessDate('2026-08-02T18:00:00Z')).toBe('2026-08-03');
  });

  it('rejects an invalid instant rather than returning a wrong date', () => {
    expect(() => businessDate('not-a-date')).toThrow(/invalid instant/);
  });
});

describe('dhakaMinutesOfDay', () => {
  it('converts a UTC instant to Dhaka wall-clock minutes', () => {
    expect(dhakaMinutesOfDay('2026-08-02T03:15:00Z')).toBe(9 * 60 + 15); // 09:15 Dhaka
  });

  it('wraps correctly past Dhaka midnight', () => {
    expect(dhakaMinutesOfDay('2026-08-02T18:30:00Z')).toBe(30); // 00:30 Dhaka
  });
});

describe('calendar helpers', () => {
  it('returns real days in month, including leap February', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('counts an inclusive range', () => {
    expect(inclusiveDayCount('2026-08-02', '2026-08-02')).toBe(1);
    expect(inclusiveDayCount('2026-08-02', '2026-08-06')).toBe(5);
  });

  it('enumerates each day inclusively', () => {
    expect(eachDay('2026-08-01', '2026-08-03')).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
  });
});

describe('working week — P0-9', () => {
  it('treats Friday and Saturday as the weekend, not Saturday and Sunday', () => {
    expect(dayOfWeek('2026-08-07')).toBe(5); // Friday
    expect(dayOfWeek('2026-08-08')).toBe(6); // Saturday
    expect(dayOfWeek('2026-08-09')).toBe(0); // Sunday

    expect(isWorkingDay('2026-08-07')).toBe(false); // Friday — off
    expect(isWorkingDay('2026-08-08')).toBe(false); // Saturday — off
    expect(isWorkingDay('2026-08-09')).toBe(true); // Sunday — a WORKING day in Bangladesh
  });

  it('excludes declared holidays', () => {
    const week = { ...DEFAULT_WORK_WEEK, holidays: ['2026-08-10'] };
    expect(isWorkingDay('2026-08-10', week)).toBe(false);
  });

  it('counts working days across a full week', () => {
    // Sun 2 Aug .. Sat 8 Aug 2026 => Sun-Thu working (5), Fri+Sat off
    expect(countWorkingDays('2026-08-02', '2026-08-08')).toBe(5);
  });
});
