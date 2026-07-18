import { groupFeedByDay } from '../lib/aggregate.js';
import { feedLine } from '../lib/banter.js';
import { todayStr } from '../lib/dates.js';
import { esc, safeColor } from '../lib/esc.js';

// An entry that deserves its moment in lights: a monster step day, a big
// multi-part session, or a workout with the daily challenge knocked over too.
function isBigEffort(e) {
  const parts = Array.isArray(e.workoutParts) ? e.workoutParts.length : 0;
  return (typeof e.steps === 'number' && e.steps >= 15000)
    || parts >= 3
    || (parts > 0 && e.dailyChallenge === true);
}

// `ai` is a fresh config/banter doc or null; ai.feed maps entry ids
// (`userId_date`) to AI-written lines, template feedLine covers the rest.
// `users` supplies member colors for the avatar chips.
export function renderFeed(container, entries, ai = null, users = []) {
  const groups = groupFeedByDay(entries, todayStr(), 12);
  if (groups.length === 0) {
    container.innerHTML = `<p class="text-neutral-500 text-sm">No entries yet. Be the first on the board!</p>`;
    return;
  }
  const colorOf = (e) => safeColor(users.find(u => u.id === e.userId)?.color, '#737373');
  const row = (e) => {
    const color = colorOf(e);
    const big = isBigEffort(e);
    return `
      <div class="flex items-start gap-3 py-2.5 border-b border-edge/60 last:border-0
        ${big ? 'big-effort -mx-2 rounded-r-lg px-2' : ''}">
        <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full display text-xs"
          style="background:${color}26;color:${color}">${esc(e.name.charAt(0).toUpperCase())}</span>
        <p class="text-sm leading-relaxed">
          <span class="font-bold" style="color:${color}">${esc(e.name)}</span>
          ${big ? '<span class="ml-1 rounded bg-accent/15 px-1.5 py-0.5 align-middle text-[10px] font-black tracking-wider text-accent">BIG EFFORT</span>' : ''}
          <span class="text-neutral-400">${esc(ai?.feed?.[e.id] ?? feedLine(e))}</span></p>
      </div>`;
  };
  container.innerHTML = groups.map(g => `
    <div>
      <p class="pt-2 eyebrow">${esc(g.label)}</p>
      ${g.items.map(row).join('')}
    </div>`).join('');
}
