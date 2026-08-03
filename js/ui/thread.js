// Expandable Aiden thread under a card parent or feed line.
// Spec: docs/superpowers/specs/2026-07-19-aiden-threads-design.md
//
// UX: no heavy "Reply" chrome. Tap the parent text to expand + focus compose.
// When N ≥ 1 show "N comments"; when empty a quiet "Banter" invite (Phase 2).
// Author bin on own messages only.
import { writeBanterThread } from '../firebase.js';
import { state } from '../state.js';
import {
  commentCount, visibleMessages, appendUserMessage, deleteUserMessage,
  aidenThinkingState, USER_MSG_MAX
} from '../lib/threads.js';
import { esc } from '../lib/esc.js';

// Survive full dashboard re-renders (every Firestore snapshot) so an open
// compose does not collapse when someone else logs a step.
const expandedTargets = new Set();

// A Firestore snapshot rebuilds the whole feed, which throws away the compose
// box mid-sentence and drops the keyboard on mobile: you tapped, the keyboard
// came up, the panel repainted under it and the chat looked like it had
// closed, so you never saw Aiden's typing dots or his reply landing.
// These two keep the compose alive across a repaint: the draft text is stashed
// per target, and focus is handed back only if the bloke actually had the
// input focused when the repaint hit.
const drafts = new Map();
let focusedTarget = null;

function restoreCompose(panel, target) {
  const input = panel.querySelector(`[data-thread-input="${CSS.escape(target)}"]`);
  if (!input) return;
  const draft = drafts.get(target);
  if (draft) input.value = draft;
  input.addEventListener('input', () => {
    if (input.value) drafts.set(target, input.value);
    else drafts.delete(target);
  });
  input.addEventListener('focus', () => { focusedTarget = target; });
  input.addEventListener('blur', () => {
    // A repaint blurs the input by removing it from the document. Only a real
    // user blur (element still on the page) means he is done typing.
    if (input.isConnected && focusedTarget === target) focusedTarget = null;
  });
  if (focusedTarget === target) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

function threadOf(banter, target) {
  return banter?.threads?.[target] || { messages: [], lastAidenAt: null };
}

function allThreads(banter) {
  return { ...(banter?.threads || {}) };
}

/**
 * Tappable parent + optional comment count + expandable thread.
 * @param {string} [opts.parentClass='coach'] - `coach` (card italics) or
 *   `feed-parent` (recent activity: roman, name+line inline).
 */
export function threadBlockHtml(target, parentHtml, banter, { parentClass = 'coach' } = {}) {
  const n = commentCount(threadOf(banter, target));
  // Empty threads still need a discoverable affordance (Phase 2); keep it quiet.
  const count = n > 0
    ? `<button type="button" class="thread-count" data-thread-target="${esc(target)}"
         aria-expanded="false">${n} comment${n === 1 ? '' : 's'}</button>`
    : `<button type="button" class="thread-count thread-invite" data-thread-target="${esc(target)}"
         aria-expanded="false">Banter</button>`;
  return `
    <div class="thread-wrap" data-thread-root="${esc(target)}">
      <div class="thread-parent ${parentClass}" data-thread-target="${esc(target)}" role="button" tabindex="0">
        ${parentHtml}
      </div>
      ${count}
      <div class="thread-panel hidden" data-thread-panel="${esc(target)}"></div>
    </div>`;
}

function messageRowHtml(m, meId) {
  const isAiden = m.kind === 'aiden';
  const name = isAiden ? 'Aiden' : (m.name || 'mate');
  const mine = !isAiden && m.userId === meId;
  return `
    <div class="thread-msg" data-msg-id="${esc(m.id)}">
      <div class="thread-msg-body">
        <span class="thread-msg-name ${isAiden ? 'thread-aiden' : ''}">${esc(name)}</span>
        <span class="thread-msg-text">${esc(m.text)}</span>
      </div>
      ${mine ? `<button type="button" class="thread-del" data-del-id="${esc(m.id)}"
        data-thread-target="" aria-label="Delete comment">🗑</button>` : ''}
    </div>`;
}

// "Aiden is typing" dots, shown while a comment is waiting on his reply so the
// crew knows one is coming rather than assuming he ignored them. Aiden answers
// on the tick (~20s of model time, up to a minute of waiting), which is long
// enough that silence reads as broken.
function typingHtml(target, thread) {
  const { thinking } = aidenThinkingState(thread);
  if (!thinking) return '';
  return `
    <div class="thread-typing" data-thread-typing="${esc(target)}" aria-live="polite">
      <span class="thread-msg-name thread-aiden">Aiden</span>
      <span class="typing-dots" role="img" aria-label="Aiden is typing"><i></i><i></i><i></i></span>
    </div>`;
}

function panelHtml(target, banter, meId) {
  const thread = threadOf(banter, target);
  const msgs = visibleMessages(thread);
  return `
    <div class="thread-list">
      ${msgs.map(m => messageRowHtml(m, meId).replace(
        'data-thread-target=""',
        `data-thread-target="${esc(target)}"`
      )).join('') || ''}
      ${typingHtml(target, thread)}
    </div>
    <div class="thread-compose">
      <textarea class="thread-input" data-thread-input="${esc(target)}"
        maxlength="${USER_MSG_MAX}" rows="3" placeholder="Banter back…"></textarea>
      <button type="button" class="thread-send" data-thread-send="${esc(target)}"
        aria-label="Send">▶</button>
    </div>`;
}

function expand(root, target, banter, meId, { focus = true } = {}) {
  const panel = root.querySelector(`[data-thread-panel="${CSS.escape(target)}"]`);
  if (!panel) return;
  expandedTargets.add(target);
  panel.classList.remove('hidden');
  panel.innerHTML = panelHtml(target, banter, meId);
  const countBtn = root.querySelector(`.thread-count[data-thread-target="${CSS.escape(target)}"]`);
  countBtn?.setAttribute('aria-expanded', 'true');
  bindPanel(panel, target);

  if (focus) {
    const input = panel.querySelector(`[data-thread-input="${CSS.escape(target)}"]`);
    input?.focus();
  }
}

function collapse(root, target) {
  const panel = root.querySelector(`[data-thread-panel="${CSS.escape(target)}"]`);
  if (!panel) return;
  expandedTargets.delete(target);
  panel.classList.add('hidden');
  panel.innerHTML = '';
  root.querySelector(`.thread-count[data-thread-target="${CSS.escape(target)}"]`)
    ?.setAttribute('aria-expanded', 'false');
}

function isExpanded(root, target) {
  const panel = root.querySelector(`[data-thread-panel="${CSS.escape(target)}"]`);
  return panel && !panel.classList.contains('hidden');
}

async function sendMessage(target, text) {
  const me = state.currentUser;
  if (!me) return;
  const trimmed = text.trim().slice(0, USER_MSG_MAX);
  if (!trimmed) return;
  const banter = state.banter || {};
  const threads = allThreads(banter);
  const msg = {
    id: `u_${me.id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    kind: 'user',
    userId: me.id,
    name: me.name,
    text: trimmed,
    at: new Date().toISOString()
  };
  const thread = appendUserMessage(threads[target], msg);
  threads[target] = thread;
  // Optimistic local state so a slow write still shows the msg on next render.
  state.banter = { ...banter, threads };
  // Scoped to this one thread key: two blokes commenting on different targets
  // (or the tick writing a reply elsewhere) no longer clobber each other.
  await writeBanterThread(target, thread);
}

async function removeMessage(target, messageId) {
  const me = state.currentUser;
  if (!me) return;
  const banter = state.banter || {};
  const threads = allThreads(banter);
  const { thread, changed } = deleteUserMessage(threads[target], messageId, me.id);
  if (!changed) return;
  const emptied = thread.messages.length === 0 && !thread.lastAidenAt;
  if (emptied) delete threads[target];
  else threads[target] = thread;
  state.banter = { ...banter, threads };
  await writeBanterThread(target, emptied ? null : thread);
}

/**
 * Drop the typing dots when the window runs out, so a failed tick leaves a
 * quiet thread rather than Aiden apparently typing forever. Firestore snapshots
 * re-render the panel when his reply actually lands, which removes them sooner.
 */
function scheduleTypingClear(panel, target) {
  clearTimeout(Number(panel.dataset.typingTimer) || 0);
  const { thinking, expiresInMs } = aidenThinkingState(threadOf(state.banter, target));
  if (!thinking) return;
  panel.dataset.typingTimer = String(setTimeout(() => {
    panel.querySelector(`[data-thread-typing="${CSS.escape(target)}"]`)?.remove();
  }, expiresInMs));
}

function renderPanel(panel, target) {
  panel.innerHTML = panelHtml(target, state.banter, state.currentUser?.id);
  bindPanel(panel, target);
}

function bindPanel(panel, target) {
  const send = panel.querySelector(`[data-thread-send="${CSS.escape(target)}"]`);
  const input = panel.querySelector(`[data-thread-input="${CSS.escape(target)}"]`);
  send?.addEventListener('click', async () => {
    const text = input?.value || '';
    if (!text.trim()) return;
    send.disabled = true;
    try {
      await sendMessage(target, text);
      drafts.delete(target);
      if (input) input.value = '';
      // Repaint straight away so the message and the typing dots appear now,
      // rather than waiting on the Firestore snapshot to come back.
      renderPanel(panel, target);
    } catch (err) {
      console.error(err);
      send.disabled = false;
    }
  });
  scheduleTypingClear(panel, target);
  restoreCompose(panel, target);
  input?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      send?.click();
    }
  });
  panel.querySelectorAll('.thread-del').forEach(btn => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.delId;
      const t = btn.dataset.threadTarget || target;
      try { await removeMessage(t, id); } catch (err) { console.error(err); }
    });
  });
}

/**
 * Wire tap-to-expand on a container that already has threadBlockHtml output.
 * Re-bind after every dashboard/feed re-render.
 */
export function bindThreads(container, banter) {
  if (!container) return;
  const meId = state.currentUser?.id;

  container.querySelectorAll('[data-thread-target]').forEach(el => {
    if (el.dataset.threadBound === '1') return;
    el.dataset.threadBound = '1';
    const target = el.dataset.threadTarget;
    const root = el.closest('[data-thread-root]');
    if (!root || !target) return;

    const open = () => {
      if (isExpanded(root, target)) {
        root.querySelector(`[data-thread-input="${CSS.escape(target)}"]`)?.focus();
        return;
      }
      expand(root, target, banter, meId);
    };

    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      open();
    });
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        open();
      }
    });
  });

  // Re-open panels that were expanded before the last full re-render.
  for (const target of expandedTargets) {
    const root = container.querySelector(`[data-thread-root="${CSS.escape(target)}"]`);
    if (root) expand(root, target, banter, meId, { focus: false });
    else expandedTargets.delete(target);
  }
}
