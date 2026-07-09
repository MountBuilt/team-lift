import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  todayStr, addDays, mondayOf, dateRange, weekdayIndex,
  weekNumber, totalWeeks, formatShort, dayLabel
} from '../js/lib/dates.js';

test('todayStr formats a known Date as local YYYY-MM-DD', () => {
  assert.equal(todayStr(new Date(2026, 6, 8)), '2026-07-08'); // July 8 2026
});

test('addDays crosses month boundaries', () => {
  assert.equal(addDays('2026-07-31', 1), '2026-08-01');
  assert.equal(addDays('2026-07-01', -1), '2026-06-30');
});

test('mondayOf returns the Monday of a Mon–Sun week', () => {
  assert.equal(mondayOf('2026-07-08'), '2026-07-06'); // Wed → Mon
  assert.equal(mondayOf('2026-07-06'), '2026-07-06'); // Mon → itself
  assert.equal(mondayOf('2026-07-12'), '2026-07-06'); // Sun → previous Mon
});

test('dateRange is inclusive and ordered', () => {
  assert.deepEqual(dateRange('2026-07-06', '2026-07-08'),
    ['2026-07-06', '2026-07-07', '2026-07-08']);
  assert.deepEqual(dateRange('2026-07-08', '2026-07-06'), []);
});

test('weekdayIndex: Monday is 0, Sunday is 6', () => {
  assert.equal(weekdayIndex('2026-07-06'), 0);
  assert.equal(weekdayIndex('2026-07-12'), 6);
});

test('weekNumber is 1-based and anchored to the start week Monday', () => {
  assert.equal(weekNumber('2026-07-08', '2026-07-08'), 1); // start day itself
  assert.equal(weekNumber('2026-07-12', '2026-07-08'), 1); // same Mon–Sun week
  assert.equal(weekNumber('2026-07-13', '2026-07-08'), 2); // next Monday
});

test('totalWeeks counts Mon–Sun weeks the window touches', () => {
  assert.equal(totalWeeks('2026-07-06', '2026-07-12'), 1);
  assert.equal(totalWeeks('2026-07-08', '2026-08-16'), 6); // Wed → 6 weeks later Sun
});

test('formatShort renders weekday, day, month', () => {
  assert.equal(formatShort('2026-07-07'), 'Tue 7 Jul');
});

test('dayLabel: today', () => {
  assert.equal(dayLabel('2026-07-08', '2026-07-08'), 'Today');
});

test('dayLabel: yesterday', () => {
  assert.equal(dayLabel('2026-07-07', '2026-07-08'), 'Yesterday');
});

test('dayLabel: full weekday name for 2..6 days ago', () => {
  assert.equal(dayLabel('2026-07-06', '2026-07-08'), 'Monday'); // 2 days ago
  assert.equal(dayLabel('2026-07-02', '2026-07-08'), 'Thursday'); // 6 days ago
});

test('dayLabel: formatShort for 7+ days ago and for future dates', () => {
  assert.equal(dayLabel('2026-07-01', '2026-07-08'), formatShort('2026-07-01')); // 7 days ago
  assert.equal(dayLabel('2026-07-10', '2026-07-08'), formatShort('2026-07-10')); // future
});
