import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toggleTrendVisible, trendNameOn } from '../js/lib/trend-filter.js';

const ALL = ['a', 'b', 'c'];

test('toggleTrendVisible: first tap from all-on isolates that name', () => {
  assert.deepEqual(toggleTrendVisible(null, 'b', ALL), ['b']);
  assert.deepEqual(toggleTrendVisible(ALL, 'a', ALL), ['a']);
});

test('toggleTrendVisible: tap a dimmed name to turn it on', () => {
  assert.deepEqual(toggleTrendVisible(['b'], 'c', ALL).sort(), ['b', 'c']);
});

test('toggleTrendVisible: tap a lit name to turn it off', () => {
  assert.deepEqual(toggleTrendVisible(['b', 'c'], 'b', ALL), ['c']);
});

test('toggleTrendVisible: last name off returns to all-on', () => {
  assert.equal(toggleTrendVisible(['b'], 'b', ALL), null);
});

test('trendNameOn is true for everyone when the filter is all-on', () => {
  assert.equal(trendNameOn(null, 'a'), true);
  assert.equal(trendNameOn(null, 'z'), true);
});

test('trendNameOn follows the isolated set', () => {
  assert.equal(trendNameOn(['b'], 'b'), true);
  assert.equal(trendNameOn(['b'], 'a'), false);
});
