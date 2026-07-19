import { groupFeedByDay } from '../lib/aggregate.js';
import { feedLine, effortLabel, isBigEffort } from '../lib/banter.js';
import { todayStr } from '../lib/dates.js';
import { esc, safeColor } from '../lib/esc.js';
import { threadBlockHtml, bindThreads } from './thread.js';

// `ai` is a fresh config/banter doc or null; ai.feed maps entry ids
// (`userId_date`) to AI-written lines, template feedLine covers the rest.
// `users` supplies member colors for the avatar chips.
// `banter` is the full config/banter doc (threads live there).
export function renderFeed(container, entries, ai = null, users = [], banter = null) {
  const groups = groupFeedByDay(entries, todayStr(), 12);
  if (groups.length === 0) {
    container.innerHTML = `<p class="text-neutral-500 text-sm">No entries yet. Be the first on the board!</p>`;
    return;
  }
  const colorOf = (e) => safeColor(users.find(u => u.id === e.userId)?.color, '#737373');
  const row = (e) => {
    const color = colorOf(e);
    const big = isBigEffort(e);
    const line = ai?.feed?.[e.id] ?? feedLine(e);
    // Name + banter on one line (no separate name row / no italics).
    const badge = big
      ? `<span class="ml-1 rounded bg-accent/15 px-1.5 py-0.5 align-middle text-[10px] font-black tracking-wider text-accent">${esc(effortLabel(e))}</span>`
      : '';
    const parentHtml =
      `<span class="font-bold" style="color:${color}">${esc(e.name)}</span>${badge} ` +
      `<span class="feed-line-text">${esc(line)}</span>`;
    const banterParent = threadBlockHtml(e.id, parentHtml, banter || ai, { parentClass: 'feed-parent' });
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
  bindThreads(container, banter || ai);
}
