import { groupFeedByDay } from '../lib/aggregate.js';
import { feedLine, effortLabel, isBigEffort } from '../lib/banter.js';
import { todayStr } from '../lib/dates.js';
import { esc, safeColor } from '../lib/esc.js';
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
  const colorOf = (e) => safeColor(users.find(u => u.id === e.userId)?.color, '#737373');
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
