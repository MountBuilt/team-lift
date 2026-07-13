import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeValue, decodeFields, encodeValue, encodeFields, maskPath, buildPatchUrl, BASE, KEY
} from '../scripts/lib/firestore-rest.mjs';

test('decodeValue handles scalars, timestamps, arrays, maps', () => {
  assert.equal(decodeValue({ stringValue: 'hi' }), 'hi');
  assert.equal(decodeValue({ integerValue: '42' }), 42);
  assert.equal(decodeValue({ doubleValue: 1.5 }), 1.5);
  assert.equal(decodeValue({ booleanValue: true }), true);
  assert.equal(decodeValue({ timestampValue: '2026-07-13T00:00:00Z' }), '2026-07-13T00:00:00Z');
  assert.equal(decodeValue({ nullValue: null }), null);
  assert.deepEqual(decodeValue({ arrayValue: { values: [{ stringValue: 'a' }] } }), ['a']);
  assert.deepEqual(
    decodeValue({ mapValue: { fields: { k: { integerValue: '1' } } } }),
    { k: 1 }
  );
  assert.deepEqual(decodeValue({ arrayValue: {} }), []);
});

test('encode/decode round-trips plain objects', () => {
  const obj = { date: '2026-07-13', n: 3, w: 82.5, on: true, tags: ['a', 'b'], nested: { x: 1 } };
  assert.deepEqual(decodeFields(encodeFields(obj)), obj);
});

test('encodeValue picks integerValue for whole numbers', () => {
  assert.deepEqual(encodeValue(10), { integerValue: '10' });
  assert.deepEqual(encodeValue(10.5), { doubleValue: 10.5 });
});

test('maskPath backtick-quotes hyphenated segments only', () => {
  assert.equal(maskPath('cards', 'weight'), 'cards.weight');
  assert.equal(maskPath('feed', 'u2_2026-07-08'), 'feed.`u2_2026-07-08`');
});

test('buildPatchUrl percent-encodes backticks in the mask', () => {
  const url = buildPatchUrl('config/banter', ['date', 'feed.`u2_2026-07-08`']);
  assert.ok(url.startsWith(`${BASE}/config/banter?key=${KEY}&`));
  assert.ok(url.includes('updateMask.fieldPaths=date'));
  assert.ok(url.includes('updateMask.fieldPaths=feed.%60u2_2026-07-08%60'));
  assert.ok(!url.includes('`'));
});
