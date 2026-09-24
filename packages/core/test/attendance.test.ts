import { describe, expect, it } from 'vitest';
import { absencesToMark, type AbsenceInput } from '../src/attendance.js';
import { DEFAULT_WORK_WEEK } from '../src/dates.js';

// 2026-09-06 is a Sunday. Weekend is Friday (5) + Saturday (6).
const base: AbsenceInput = {
  from: '2026-09-06',
  to: '2026-09-10', // Sun..Thu, all working days
  hireDate: '2020-01-01',
  week: DEFAULT_WORK_WEEK,
  recordedDates: ['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'],
  approvedLeave: [],
};

describe('F3.3 absence marking', () => {
  it('marks nothing when every working day has a record', () => {
    expect(absencesToMark(base)).toEqual([]);
  });

  it('marks a working day with no check-in and no leave', () => {
    const marks = absencesToMark({ ...base, recordedDates: ['2026-09-06', '2026-09-07', '2026-09-09', '2026-09-10'] });
    expect(marks).toEqual([{ date: '2026-09-08', unplanned: false }]);
  });

  it('never marks weekends or holidays', () => {
    const marks = absencesToMark({
      ...base,
      from: '2026-09-10',
      to: '2026-09-13', // Thu, Fri, Sat, Sun
      week: { weekendDays: [5, 6], holidays: ['2026-09-13'] },
      recordedDates: ['2026-09-10'],
    });
    expect(marks).toEqual([]);
  });

  it('does not mark a day covered by approved leave', () => {
    const marks = absencesToMark({
      ...base,
      recordedDates: ['2026-09-06', '2026-09-10'],
      approvedLeave: [{ startDate: '2026-09-07', endDate: '2026-09-09' }],
    });
    expect(marks).toEqual([]);
  });

  it('flags a single-day absence next to the weekend as unplanned (the F2 pattern)', () => {
    const marks = absencesToMark({ ...base, recordedDates: ['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09'] });
    expect(marks).toEqual([{ date: '2026-09-10', unplanned: true }]); // Thursday, before Friday
  });

  it('does not flag a multi-day absence as the unplanned pattern', () => {
    const marks = absencesToMark({ ...base, recordedDates: ['2026-09-06', '2026-09-07', '2026-09-08'] });
    expect(marks).toEqual([
      { date: '2026-09-09', unplanned: false },
      { date: '2026-09-10', unplanned: false },
    ]);
  });

  it('ignores days before the hire date and after separation', () => {
    const marks = absencesToMark({
      ...base,
      hireDate: '2026-09-08',
      separationDate: '2026-09-09',
      recordedDates: [],
    });
    expect(marks.map((m) => m.date)).toEqual(['2026-09-08', '2026-09-09']);
  });
});
