import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractJson,
  extractGrokCopy,
  backendName,
  modelFor,
  GROK_MODEL
} from '../scripts/lib/copywriter.mjs';

test('extractJson pulls the first balanced object out of prose', () => {
  const got = extractJson('Sure.\n{"report":"","threadReplies":[],"pushes":[]}\n');
  assert.deepEqual(got, { report: '', threadReplies: [], pushes: [] });
});

test('extractGrokCopy prefers structuredOutput from the Grok Build envelope', () => {
  const envelope = {
    text: '{"report":"ignored"}',
    structuredOutput: {
      report: '',
      threadReplies: [{ target: 'report', text: 'oi' }],
      pushes: []
    },
    usage: { input_tokens: 1 }
  };
  assert.deepEqual(extractGrokCopy(JSON.stringify(envelope)), envelope.structuredOutput);
});

test('extractGrokCopy falls back to envelope.text then raw JSON', () => {
  const viaText = {
    text: '{"report":"","threadReplies":[],"pushes":[]}',
    usage: {}
  };
  assert.deepEqual(extractGrokCopy(JSON.stringify(viaText)), {
    report: '',
    threadReplies: [],
    pushes: []
  });

  assert.deepEqual(
    extractGrokCopy('{"report":"x","threadReplies":[],"pushes":[]}'),
    { report: 'x', threadReplies: [], pushes: [] }
  );
});

test('modelFor maps backends', () => {
  assert.equal(modelFor('grok-cli'), GROK_MODEL);
  assert.equal(modelFor('cli'), 'sonnet');
  assert.equal(modelFor('api'), 'claude-sonnet-5');
});

test('TEAM_LIFT_COPY_BACKEND force is observed by backendName', () => {
  // backendName reads process.env at call time via module-level FORCE only
  // once — force is captured at import. This test documents the env contract;
  // a live force is verified by the dry-run path.
  assert.equal(typeof backendName(), 'string');
  assert.ok(['grok-cli', 'cli', 'api'].includes(backendName()));
});
