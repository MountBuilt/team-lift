// Expandable Aiden thread under a card parent or feed line.
// Spec: docs/superpowers/specs/2026-07-19-aiden-threads-design.md
//
// UX: no "Reply" chrome. Tap the parent text to expand + focus compose.
// "N comments" only when N ≥ 1. Author bin on own messages only.
import { writeBanterThreads } from '../firebase.js';
import { state } from '../state.js';
import {
  commentCount, visibleMessages, appendUserMessage, deleteUserMessage, USER_MSG_MAX
} from '../lib/threads.js';
import { esc } from '../lib/esc.js';

// Survive full dashboard re-renders (every Firestore snapshot) so an open
// compose does not collapse when someone else logs a step.
const expandedTargets = new Set();

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
  const count = n > 0
    ? `<button type="button" class="thread-count" data-thread-target="${esc(target)}"
         aria-expanded="false">${n} comment${n === 1 ? '' : 's'}</button>`
    : '';
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

function panelHtml(target, banter, meId) {
  const msgs = visibleMessages(threadOf(banter, target));
  return `
    <div class="thread-list">
      ${msgs.map(m => messageRowHtml(m, meId).replace(
        'data-thread-target=""',
        `data-thread-target="${esc(target)}"`
      )).join('') || ''}
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
  threads[target] = appendUserMessage(threads[target], msg);
  // Optimistic local state so a slow write still shows the msg on next render.
  state.banter = { ...banter, threads };
  await writeBanterThreads(threads);
}

async function removeMessage(target, messageId) {
  const me = state.currentUser;
  if (!me) return;
  const banter = state.banter || {};
  const threads = allThreads(banter);
  const { thread, changed } = deleteUserMessage(threads[target], messageId, me.id);
  if (!changed) return;
  if (thread.messages.length === 0 && !thread.lastAidenAt) delete threads[target];
  else threads[target] = thread;
  state.banter = { ...banter, threads };
  await writeBanterThreads(threads);
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
      if (input) input.value = '';
    } catch (err) {
      console.error(err);
      send.disabled = false;
    }
  });
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
