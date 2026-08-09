/**
 * Ported from Team Lift tests/dates.test.js and tests/daypicker.test.js.
 *
 * `totalWeeks` is deliberately not ported: it existed for "Week X of N" in a
 * fixed challenge window, and Sledged uses a rolling window instead.
 */
import { describe, it, expect } from 'vitest';
import {
  todayStr, addDays, mondayOf, dateRange, weekdayIndex,
  weekNumber, formatShort, dayLabel, dayOptions,
} from './dates.js';

describe('dates', () => {
  it('formats a known Date as local YYYY-MM-DD', () => {
    expect(todayStr(new Date(2026, 6, 8))).toBe('2026-07-08');
  });

  it('crosses month boundaries', () => {
    expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDays('2026-07-01', -1)).toBe('2026-06-30');
  });

  it('returns the Monday of a Mon-Sun week', () => {
    expect(mondayOf('2026-07-08')).toBe('2026-07-06'); // Wed -> Mon
    expect(mondayOf('2026-07-06')).toBe('2026-07-06'); // Mon -> itself
    expect(mondayOf('2026-07-12')).toBe('2026-07-06'); // Sun -> previous Mon
  });

  it('builds an inclusive, ordered range', () => {
    expect(dateRange('2026-07-06', '2026-07-08'))
      .toEqual(['2026-07-06', '2026-07-07', '2026-07-08']);
    expect(dateRange('2026-07-08', '2026-07-06')).toEqual([]);
  });

  it('indexes Monday as 0 and Sunday as 6', () => {
    expect(weekdayIndex('2026-07-06')).toBe(0);
    expect(weekdayIndex('2026-07-12')).toBe(6);
  });

  it('numbers weeks 1-based, anchored to the start week Monday', () => {
    expect(weekNumber('2026-07-08', '2026-07-08')).toBe(1); // start day itself
    expect(weekNumber('2026-07-12', '2026-07-08')).toBe(1); // same Mon-Sun week
    expect(weekNumber('2026-07-13', '2026-07-08')).toBe(2); // next Monday
  });

  it('renders weekday, day, month', () => {
    expect(formatShort('2026-07-07')).toBe('Tue 7 Jul');
  });

  it('labels today, yesterday, weekday names, then short dates', () => {
    expect(dayLabel('2026-07-08', '2026-07-08')).toBe('Today');
    expect(dayLabel('2026-07-07', '2026-07-08')).toBe('Yesterday');
    expect(dayLabel('2026-07-06', '2026-07-08')).toBe('Monday');   // 2 days ago
    expect(dayLabel('2026-07-02', '2026-07-08')).toBe('Thursday'); // 6 days ago
    expect(dayLabel('2026-07-01', '2026-07-08')).toBe(formatShort('2026-07-01')); // 7 days
    expect(dayLabel('2026-07-10', '2026-07-08')).toBe(formatShort('2026-07-10')); // future
  });

  it('does not shift the day for a UTC-negative offset', () => {
    // Regression: `new Date('2026-07-08')` parses as UTC midnight, which is the
    // 7th anywhere west of Greenwich. parseLocal is why this holds.
    expect(todayStr(new Date(2026, 0, 1))).toBe('2026-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('day picker', () => {
  const TODAY = '2026-07-20'; // Monday

  it('offers today, yesterday and the day before, newest first', () => {
    const opts = dayOptions(TODAY, TODAY);
    expect(opts.map((o) => o.date)).toEqual(['2026-07-20', '2026-07-19', '2026-07-18']);
    expect(opts.map((o) => o.label)).toEqual(['Today', 'Yesterday', 'Saturday']);
  });

  it('offers no future days', () => {
    expect(dayOptions(TODAY, TODAY).every((o) => o.date <= TODAY)).toBe(true);
  });

  it('appends an older edit target so the selection is representable', () => {
    const opts = dayOptions('2026-07-14', TODAY);
    expect(opts).toHaveLength(4);
    expect(opts[3].date).toBe('2026-07-14');
    expect(opts[3].label).toMatch(/Tue 14 Jul/);
  });

  it('does not duplicate a date already in the quick list', () => {
    const opts = dayOptions('2026-07-19', TODAY);
    expect(opts).toHaveLength(3);
    expect(new Set(opts.map((o) => o.date)).size).toBe(3);
  });

  it('handles a missing selection', () => {
    expect(dayOptions(undefined, TODAY)).toHaveLength(3);
  });
});
