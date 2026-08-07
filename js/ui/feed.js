import { groupFeedByDay } from '../lib/aggregate.js';
import { displayFeedLine, effortLabel, isBigEffort } from '../lib/banter.js';
import { todayStr } from '../lib/dates.js';
import { esc, safeColor } from '../lib/esc.js';
import { threadBlockHtml, bindThreads } from './thread.js';

/**
 * Recent activity. Factual placeholder until Aiden's line lands in
 * banter.feedLines[entryId], then the AI line sticks. Spec:
 * docs/superpowers/specs/2026-08-07-home-stats-ai-feed-design.md
 *
 * Tap the parent text to open the thread. Comment count only shows once a
 * chat has started.
 */
export function renderFeed(container, entries, users = [], banter = null) {
  const groups = groupFeedByDay(entries, todayStr(), 12);
  if (groups.length === 0) {
    container.innerHTML = `
      <p class="text-sm text-neutral-400">Dead quiet. Someone has to open the board, might as well be you.</p>
      <button type="button" id="feed-empty-log"
        class="pressable mt-3 w-full rounded-xl border border-edge py-2.5 text-sm font-black text-accent">
        LOG IT</button>`;
    container.querySelector('#feed-empty-log')?.addEventListener('click', () => {
      import('./logmodal.js').then(m => m.openLogModal());
    });
    return;
  }
  const colorOf = (e) => safeColor(users.find(u => u.id === e.userId)?.color, '#737373');

  const row = (e) => {
    const color = colorOf(e);
    const badge = isBigEffort(e)
      ? `<span class="ml-1 rounded bg-accent/15 px-1.5 py-0.5 align-middle text-[10px] font-black tracking-wider text-accent">${esc(effortLabel(e))}</span>`
      : '';
    const line = displayFeedLine(e, banter);
    const isAi = Boolean(banter?.feedLines?.[e.id]?.text?.trim?.());
    // Name + banter on one line (no separate name row / no italics).
    const parentHtml =
      `<span class="font-bold" style="color:${color}">${esc(e.name)}</span>${badge} ` +
      `<span class="feed-line-text${isAi ? '' : ' text-neutral-400'}">${esc(line)}</span>`;
    const banterParent = threadBlockHtml(e.id, parentHtml, banter, { parentClass: 'feed-parent' });
    return `
      <div class="flex items-start gap-3 py-2.5 border-b border-edge/60 last:border-0">
        <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full display text-xs"
          style="background:${color}26;color:${color}">${esc(e.name.charAt(0).toUpperCase())}</span>
        <div class="min-w-0 flex-1">
          ${banterParent}
        </div>
      </div>`;
  };
  container.innerHTML = groups.map(g => `
    <div>
      <p class="pt-2 eyebrow">${esc(g.label)}</p>
      ${g.items.map(row).join('')}
    </div>`).join('');
  bindThreads(container, banter);
}
