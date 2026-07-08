import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc } from '../js/lib/esc.js';

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
