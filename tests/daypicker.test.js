// The log sheet's day picker (js/ui/logmodal.js renders these options).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayOptions } from '../js/lib/dates.js';

const TODAY = '2026-07-20'; // Monday

test('offers today, yesterday and the day before, newest first', () => {
  const opts = dayOptions(TODAY, TODAY);
  assert.deepEqual(opts.map(o => o.date), ['2026-07-20', '2026-07-19', '2026-07-18']);
  assert.deepEqual(opts.map(o => o.label), ['Today', 'Yesterday', 'Saturday']);
});

test('labels match the Recent activity day headers', () => {
  // dayLabel gives weekday names for 2-6 days back, so the picker and the feed
  // headings read the same.
  const opts = dayOptions('2026-07-19', TODAY);
  assert.equal(opts[1].label, 'Yesterday');
  assert.equal(opts[2].label, 'Saturday');
});

test('marks no future days', () => {
  const opts = dayOptions(TODAY, TODAY);
  assert.ok(opts.every(o => o.date <= TODAY));
});

test('an older edit target is appended so the selection is representable', () => {
  // Reachable from the Me view, which lists this Mon-Sun.
  const opts = dayOptions('2026-07-14', TODAY);
  assert.equal(opts.length, 4);
  assert.equal(opts[3].date, '2026-07-14');
  assert.match(opts[3].label, /Tue 14 Jul/);
});

test('a date already in the quick list is not duplicated', () => {
  const opts = dayOptions('2026-07-19', TODAY);
  assert.equal(opts.length, 3);
  assert.equal(new Set(opts.map(o => o.date)).size, 3);
});

test('handles a missing selection', () => {
  const opts = dayOptions(undefined, TODAY);
  assert.equal(opts.length, 3);
});
