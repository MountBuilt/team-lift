import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, safeColor } from '../js/lib/esc.js';

test('escapes the five HTML-sensitive characters', () => {
  assert.equal(esc('&'), '&amp;');
  assert.equal(esc('<'), '&lt;');
  assert.equal(esc('>'), '&gt;');
  assert.equal(esc('"'), '&quot;');
  assert.equal(esc("'"), '&#39;');
});

test('neutralizes an XSS payload', () => {
  assert.equal(
    esc('<img src=x onerror=alert(1)>'),
    '&lt;img src=x onerror=alert(1)&gt;'
  );
});

test('passes a plain string through unchanged', () => {
  assert.equal(esc('Alice'), 'Alice');
});

test('coerces non-strings via String()', () => {
  assert.equal(esc(42), '42');
});

test('safeColor passes a valid 6-digit hex through unchanged', () => {
  assert.equal(safeColor('#22d3ee'), '#22d3ee');
  assert.equal(safeColor('#ABCDEF'), '#ABCDEF');
});

test('safeColor falls back on an injection string', () => {
  assert.equal(safeColor('red;background:url(x)"onload=alert(1)'), '#f97316');
  assert.equal(safeColor('#22d3ee', '#000000'), '#22d3ee');
  assert.equal(safeColor('nope', '#000000'), '#000000');
});

test('safeColor falls back on a non-string', () => {
  assert.equal(safeColor(null), '#f97316');
  assert.equal(safeColor(undefined), '#f97316');
  assert.equal(safeColor(123), '#f97316');
});
