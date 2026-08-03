// Turns a context object into Aiden's copy. Owns the model call and nothing
// else: no Firestore, no sends.
//
// Backends, picked automatically (override with TEAM_LIFT_COPY_BACKEND):
//
//   grok-cli  (default when grok is signed in)
//                    `grok -p` on SuperGrok / Grok Build OAuth
//                    (~/.grok/auth.json). No metered console.x.ai bill.
//                    Child env strips XAI_API_KEY so the sub is used, not
//                    pay-per-token. ~6s for a thread-shaped call measured
//                    2026-08-02.
//   cli              `claude -p` on Claude Pro. Fallback if grok is missing
//                    or auth is gone. ~17s for a thread reply.
//   api              Anthropic Messages API, only if a key is present at
//                    KEY_FILE / ANTHROPIC_API_KEY. Metered; escape hatch.
//
// TWO THINGS KEEP BOTH CLI PATHS FAST. Measured, do not remove:
//
//   * stdin: 'ignore'. Without it the CLI waits for piped input it will
//     never get, and prints a warning.
//   * cwd outside the repo. Run from the project root and the coding agent
//     discovers and loads CLAUDE.md / AGENTS.md / .claude as context,
//     which more than doubles the call. Nothing here needs repo context:
//     the whole job is in the prompt + system override.
//
// For reference, the pipeline this replaced shelled out to
// `claude -p /copywriter <dir>` from the repo root, which loaded the Claude
// Code system prompt, CLAUDE.md, a 28.8 KB skill file and an agentic loop of up
// to 60 turns to emit one sentence. That measured 88s.
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copySchema } from './context.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPT_FILE = join(HERE, '..', 'prompt', 'aiden.md');
const KEY_FILE = join(homedir(), '.config/teamlift/anthropic-key');
const GROK_AUTH_FILE = join(homedir(), '.grok', 'auth.json');

/** Claude Messages API model. Swap to 'claude-opus-5' for sharper (metered) copy. */
export const CLAUDE_MODEL = 'claude-sonnet-5';
/** SuperGrok / Grok Build model alias. */
export const GROK_MODEL = 'grok-4.5';
/** Back-compat: name of the active default model for logging. */
export const MODEL = GROK_MODEL;
export const MAX_TOKENS = 4000;

export function readPrompt() {
  return readFileSync(PROMPT_FILE, 'utf8');
}

function forcedBackend() {
  return (process.env.TEAM_LIFT_COPY_BACKEND || '').trim().toLowerCase();
}

export function apiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY.trim();
  if (existsSync(KEY_FILE)) {
    const k = readFileSync(KEY_FILE, 'utf8').trim();
    if (k) return k;
  }
  return null;
}

/** Resolve the Grok Build binary (PATH, then ~/.grok/bin for launchd). */
export function grokBinaryPath() {
  const homeBin = join(homedir(), '.grok', 'bin', 'grok');
  if (existsSync(homeBin)) return homeBin;
  try {
    const p = execSync('command -v grok', { encoding: 'utf8' }).trim();
    if (p) return p;
  } catch {
    // not on PATH
  }
  return null;
}

/** True when the Grok Build binary is findable. */
export function grokBinaryAvailable() {
  return Boolean(grokBinaryPath());
}

/** SuperGrok OAuth session file written by `grok login`. */
export function grokAuthAvailable() {
  return existsSync(GROK_AUTH_FILE);
}

/**
 * Pick backend. Prefer SuperGrok CLI so Aiden rides the monthly sub, not
 * metered API credits. TEAM_LIFT_COPY_BACKEND=grok|claude|api forces one.
 */
export function backendName() {
  const force = forcedBackend();
  if (force === 'grok' || force === 'grok-cli') return 'grok-cli';
  if (force === 'claude' || force === 'cli') return 'cli';
  if (force === 'api' || force === 'anthropic') return 'api';
  if (grokBinaryAvailable() && grokAuthAvailable()) return 'grok-cli';
  if (apiKey()) return 'api';
  return 'cli';
}

/** Model label for the active backend (logs / dry-run). */
export function modelFor(backend = backendName()) {
  if (backend === 'grok-cli') return GROK_MODEL;
  if (backend === 'api') return CLAUDE_MODEL;
  return 'sonnet'; // claude -p --model sonnet
}

/**
 * Pull the first balanced JSON object out of a model response. The schema-
 * constrained paths usually return clean JSON; CLI prose wrappers still happen.
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

/**
 * Grok Build `--output-format json` wraps the model result:
 *   { text, structuredOutput?, usage, modelUsage, ... }
 * Prefer structuredOutput when --json-schema was used.
 */
export function extractGrokCopy(stdout) {
  const raw = String(stdout || '').trim();
  if (!raw) throw new Error('grok-cli returned empty stdout');
  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return extractJson(raw);
  }
  if (envelope && typeof envelope === 'object') {
    if (envelope.structuredOutput && typeof envelope.structuredOutput === 'object') {
      return envelope.structuredOutput;
    }
    // Already the copy shape (no envelope)
    if ('threadReplies' in envelope || 'report' in envelope || 'weeklyReport' in envelope || 'pushes' in envelope) {
      return envelope;
    }
    if (typeof envelope.text === 'string' && envelope.text.trim()) {
      return extractJson(envelope.text);
    }
  }
  return extractJson(raw);
}

/** Env for SuperGrok child: drop metered API keys so OAuth is used. */
function grokChildEnv() {
  const env = { ...process.env };
  for (const k of [
    'XAI_API_KEY',
    'GROK_API_KEY',
    'GROK_CODE_XAI_API_KEY',
    'xai_api_key'
  ]) {
    delete env[k];
  }
  return env;
}

function outputInstructions() {
  return [
    '## Output',
    '',
    'Return ONLY a JSON object with keys `report` (string, empty when not',
    'requested), `weeklyReport` (string, empty when not requested),',
    '`threadReplies` (array of {target, text}) and `pushes` (array',
    'of {userId, kind, title, body}). No markdown fence, no commentary.'
  ].join('\n');
}

async function viaApi(context, log) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: apiKey() });

  // The daily report is written once at ~3am with nobody waiting, so let it
  // think. Thread-only ticks are latency-critical (a bloke is sitting there
  // waiting for Aiden to answer), so skip thinking and keep it snappy.
  const wantsLongCopy = context.jobs.includes('report') || context.jobs.includes('weeklyReport');
  const resp = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    thinking: wantsLongCopy ? { type: 'adaptive' } : { type: 'disabled' },
    output_config: {
      effort: wantsLongCopy ? 'high' : 'medium',
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
    outputInstructions(),
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

/**
 * SuperGrok path. Auth via ~/.grok/auth.json (grok login).
 * Must not inherit XAI_API_KEY or launchd will burn metered credits.
 */
function viaGrokCli(context, log) {
  const userPrompt = [
    outputInstructions(),
    '',
    '## Context',
    '',
    JSON.stringify(context)
  ].join('\n');

  const schema = JSON.stringify(copySchema());
  const args = [
    '-p', userPrompt,
    '--json-schema', schema,
    '--system-prompt-override', readPrompt(),
    '--max-turns', '1',
    '--no-subagents',
    '--no-plan',
    '--verbatim',
    '--disable-web-search',
    '-m', GROK_MODEL,
    '--cwd', tmpdir()
  ];

  const bin = grokBinaryPath();
  if (!bin) throw new Error('grok binary not found (install Grok Build, or put grok on PATH)');

  let out;
  try {
    out = execFileSync(bin, args, {
      encoding: 'utf8',
      timeout: 300_000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: tmpdir(),
      env: grokChildEnv()
    });
  } catch (err) {
    const stderr = err.stderr ? String(err.stderr).slice(0, 800) : '';
    const stdout = err.stdout ? String(err.stdout).slice(0, 400) : '';
    throw new Error(
      `grok-cli failed (status=${err.status ?? 'n/a'}): ${err.message}` +
      (stderr ? `\nstderr: ${stderr}` : '') +
      (stdout ? `\nstdout: ${stdout}` : '')
    );
  }

  log(`grok-cli prompt bytes=${userPrompt.length} schemaBytes=${schema.length}`);
  // Log usage envelope when present so we can smell metered vs sub usage.
  try {
    const envelope = JSON.parse(out);
    if (envelope?.usage) {
      const u = envelope.usage;
      const models = envelope.modelUsage ? Object.keys(envelope.modelUsage).join(',') : '?';
      log(`grok-cli usage: in=${u.input_tokens} out=${u.output_tokens} ` +
          `cost_usd=${envelope.total_cost_usd ?? '?'} models=${models} turns=${envelope.num_turns ?? '?'}`);
    }
  } catch {
    // non-envelope stdout; extractGrokCopy will still try
  }
  return extractGrokCopy(out);
}

/** @returns {Promise<{copy: object, backend: string, ms: number, model: string}>} */
export async function generateCopy(context, { log = () => {} } = {}) {
  const backend = backendName();
  const model = modelFor(backend);
  const started = Date.now();
  let copy;
  if (backend === 'grok-cli') copy = viaGrokCli(context, log);
  else if (backend === 'api') copy = await viaApi(context, log);
  else copy = viaCli(context, log);
  return { copy, backend, model, ms: Date.now() - started };
}
