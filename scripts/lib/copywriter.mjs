// Turns a context object into Aiden's copy. Owns the model call and nothing
// else: no Firestore, no sends.
//
// Two backends, picked automatically:
//
//   cli  (default)   `claude -p` on the Claude Pro subscription via
//                    CLAUDE_CODE_OAUTH_TOKEN. No per-token bill. ~17s for a
//                    thread reply, which with a 60s tick is responsive enough
//                    to feel live.
//   api  (optional)  Anthropic Messages API, used only if a key is present at
//                    KEY_FILE. One turn, schema-constrained output, ~5s, but
//                    metered against an Anthropic account.
//
// TWO THINGS KEEP THE CLI PATH FAST. Measured, do not remove:
//
//   * stdin: 'ignore'. Without it the CLI waits 3s for piped input it will
//     never get, and prints a warning.
//   * cwd outside the repo. Run from the project root and Claude Code
//     discovers and loads CLAUDE.md plus the .claude directory as context,
//     which more than doubled the call (38.6s -> 17.4s on the same prompt).
//     Nothing here needs repo context: the whole job is in the prompt.
//
// For reference, the pipeline this replaced shelled out to
// `claude -p /copywriter <dir>` from the repo root, which loaded the Claude
// Code system prompt, CLAUDE.md, a 28.8 KB skill file and an agentic loop of up
// to 60 turns to emit one sentence. That measured 88s.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copySchema } from './context.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPT_FILE = join(HERE, '..', 'prompt', 'aiden.md');
const KEY_FILE = join(homedir(), '.config/teamlift/anthropic-key');

/** Swap to 'claude-opus-5' for the sharpest copy at ~2.5x the input cost. */
export const MODEL = 'claude-sonnet-5';
export const MAX_TOKENS = 4000;

export function readPrompt() {
  return readFileSync(PROMPT_FILE, 'utf8');
}

export function apiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY.trim();
  if (existsSync(KEY_FILE)) {
    const k = readFileSync(KEY_FILE, 'utf8').trim();
    if (k) return k;
  }
  return null;
}

export function backendName() {
  return apiKey() ? 'api' : 'cli';
}

/**
 * Pull the first balanced JSON object out of a model response. The API path is
 * schema-constrained so this is a no-op there; the CLI path can wrap the JSON
 * in prose.
 */
export function extractJson(text) {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('no JSON object in model output');
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error('unbalanced JSON in model output');
}

async function viaApi(context, log) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: apiKey() });

  // The daily report is written once at ~3am with nobody waiting, so let it
  // think. Thread-only ticks are latency-critical (a bloke is sitting there
  // waiting for Aiden to answer), so skip thinking and keep it snappy.
  const wantsReport = context.jobs.includes('report');
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: wantsReport ? { type: 'adaptive' } : { type: 'disabled' },
    output_config: {
      effort: wantsReport ? 'high' : 'medium',
      format: { type: 'json_schema', schema: copySchema() }
    },
    system: [{
      type: 'text',
      text: readPrompt(),
      cache_control: { type: 'ephemeral' }
    }],
    messages: [{ role: 'user', content: JSON.stringify(context) }]
  });

  if (resp.stop_reason === 'refusal') {
    throw new Error(`model refused (${resp.stop_details?.category ?? 'unknown'})`);
  }
  if (resp.stop_reason === 'max_tokens') {
    throw new Error(`output truncated at max_tokens=${MAX_TOKENS}`);
  }
  const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const u = resp.usage;
  log(`api usage: in=${u.input_tokens} out=${u.output_tokens} ` +
      `cacheRead=${u.cache_read_input_tokens ?? 0} cacheWrite=${u.cache_creation_input_tokens ?? 0}`);
  return extractJson(text);
}

function viaCli(context, log) {
  const prompt = [
    readPrompt(),
    '',
    '## Output',
    '',
    'Return ONLY a JSON object with keys `report` (string, empty when not',
    'requested), `threadReplies` (array of {target, text}) and `pushes` (array',
    'of {userId, kind, title, body}). No markdown fence, no commentary.',
    '',
    '## Context',
    '',
    JSON.stringify(context)
  ].join('\n');

  const out = execFileSync('claude', ['-p', prompt, '--model', 'sonnet'], {
    encoding: 'utf8',
    timeout: 300_000,
    maxBuffer: 8 * 1024 * 1024,
    // stdin closed: else the CLI waits 3s for input that never comes.
    // cwd off-repo: keeps CLAUDE.md and .claude/ out of the context.
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: tmpdir()
  });
  log(`cli prompt bytes=${prompt.length}`);
  return extractJson(out);
}

/** @returns {Promise<{copy: object, backend: string, ms: number}>} */
export async function generateCopy(context, { log = () => {} } = {}) {
  const backend = backendName();
  const started = Date.now();
  const copy = backend === 'api' ? await viaApi(context, log) : viaCli(context, log);
  return { copy, backend, ms: Date.now() - started };
}
