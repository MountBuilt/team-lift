import { groupFeedByDay } from '../lib/aggregate.js';
import { feedLine, effortLabel, isBigEffort } from '../lib/banter.js';
import {
  REACTION_EMOJIS, reactionCounts, userReaction, toggleUserReaction
} from '../lib/reactions.js';
import { todayStr } from '../lib/dates.js';
import { esc, safeColor } from '../lib/esc.js';
import { writeEntryReaction } from '../firebase.js';
import { state } from '../state.js';
import { threadBlockHtml, bindThreads } from './thread.js';

/**
 * Recent activity. The line is ALWAYS the local template (js/lib/banter.js
 * feedLine) so it appears the instant a bloke saves, with no AI call and no
 * waiting. That instant callout is the reward for logging, and it is the point
 * of this panel.
 *
 * Before 2026-07-26 an AI line overwrote it on the next hourly tick, which
 * meant the text visibly changed under him up to an hour later, cost a model
 * call per entry (9-22 a day), and produced the repetition the crew noticed
 * (70 of 110 stored lines mentioned the scales). Aiden now reacts as a COMMENT
 * in the thread underneath instead, which is additive and never rewrites.
 *
 * Peer reactions (Phase 4) are client-only, stored on the entry doc.
 * `banter` is the full config/banter doc (threads live there).
 */
export function renderFeed(container, entries, users = [], banter = null) {
  const groups = groupFeedByDay(entries, todayStr(), 12);
  if (groups.length === 0) {
    container.innerHTML = `
      <p class="text-sm text-neutral-400">Dead quiet. Someone has to open the board, might as well be you.</p>
      <button type="button" id="feed-empty-log"
        class="pressable mt-3 w-full rounded-xl border border-edge py-2.5 text-sm font-black text-accent">
        LOG SOMETHING</button>`;
    container.querySelector('#feed-empty-log')?.addEventListener('click', () => {
      import('./logmodal.js').then(m => m.openLogModal());
    });
    return;
  }
  const meId = state.currentUser?.id;
  const colorOf = (e) => safeColor(users.find(u => u.id === e.userId)?.color, '#737373');

  const reactionsHtml = (e) => {
    const reactions = e.reactions || {};
    const counts = reactionCounts(reactions);
    const mine = meId ? userReaction(reactions, meId) : null;
    const btns = REACTION_EMOJIS.map(em => {
      const n = counts[em] || 0;
      const on = mine === em;
      return `
        <button type="button" class="react-btn ${on ? 'react-on' : ''}"
          data-entry-id="${esc(e.id)}" data-emoji="${em}"
          aria-label="React ${em}" aria-pressed="${on ? 'true' : 'false'}">
          <span class="react-emoji">${em}</span>
          ${n > 0 ? `<span class="react-n">${n}</span>` : ''}
        </button>`;
    }).join('');
    return `<div class="react-row" data-reactions-for="${esc(e.id)}">${btns}</div>`;
  };

  const row = (e) => {
    const color = colorOf(e);
    const badge = isBigEffort(e)
      ? `<span class="ml-1 rounded bg-accent/15 px-1.5 py-0.5 align-middle text-[10px] font-black tracking-wider text-accent">${esc(effortLabel(e))}</span>`
      : '';
    // Name + banter on one line (no separate name row / no italics).
    const parentHtml =
      `<span class="font-bold" style="color:${color}">${esc(e.name)}</span>${badge} ` +
      `<span class="feed-line-text">${esc(feedLine(e))}</span>`;
    const banterParent = threadBlockHtml(e.id, parentHtml, banter, { parentClass: 'feed-parent' });
    return `
      <div class="flex items-start gap-3 py-2.5 border-b border-edge/60 last:border-0">
        <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full display text-xs"
          style="background:${color}26;color:${color}">${esc(e.name.charAt(0).toUpperCase())}</span>
        <div class="min-w-0 flex-1">
          ${banterParent}
          ${reactionsHtml(e)}
        </div>
      </div>`;
  };
  container.innerHTML = groups.map(g => `
    <div>
      <p class="pt-2 eyebrow">${esc(g.label)}</p>
      ${g.items.map(row).join('')}
    </div>`).join('');
  bindThreads(container, banter);
  bindReactions(container, entries);
}

function bindReactions(container, entries) {
  const me = state.currentUser;
  if (!me) return;
  container.querySelectorAll('.react-btn').forEach(btn => {
    btn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const entryId = btn.dataset.entryId;
      const emoji = btn.dataset.emoji;
      if (!entryId || !emoji) return;
      const entry = entries.find(e => e.id === entryId);
      const prev = entry?.reactions || {};
      const next = toggleUserReaction(prev, me.id, emoji);
      const mine = next[me.id] || null;
      // Optimistic local update so the count flips before the snapshot.
      if (entry) entry.reactions = next;
      const idx = state.entries.findIndex(e => e.id === entryId);
      if (idx >= 0) state.entries[idx] = { ...state.entries[idx], reactions: next };
      paintReactionRow(container, entryId, next, me.id);
      try {
        await writeEntryReaction(entryId, me.id, mine);
      } catch (err) {
        console.error(err);
        if (entry) entry.reactions = prev;
        if (idx >= 0) state.entries[idx] = { ...state.entries[idx], reactions: prev };
        paintReactionRow(container, entryId, prev, me.id);
      }
    });
  });
}

function paintReactionRow(container, entryId, reactions, meId) {
  const row = container.querySelector(`[data-reactions-for="${CSS.escape(entryId)}"]`);
  if (!row) return;
  const counts = reactionCounts(reactions);
  const mine = userReaction(reactions, meId);
  row.querySelectorAll('.react-btn').forEach(btn => {
    const em = btn.dataset.emoji;
    const n = counts[em] || 0;
    const on = mine === em;
    btn.classList.toggle('react-on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    const nEl = btn.querySelector('.react-n');
    if (n > 0) {
      if (nEl) nEl.textContent = String(n);
      else {
        const span = document.createElement('span');
        span.className = 'react-n';
        span.textContent = String(n);
        btn.appendChild(span);
      }
    } else {
      nEl?.remove();
    }
  });
}
