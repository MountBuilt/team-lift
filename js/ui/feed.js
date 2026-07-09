import { groupFeedByDay } from '../lib/aggregate.js';
import { feedLine } from '../lib/banter.js';
import { todayStr } from '../lib/dates.js';
import { esc } from '../lib/esc.js';

// `ai` is a fresh config/banter doc or null; ai.feed maps entry ids
// (`userId_date`) to AI-written lines, template feedLine covers the rest.
export function renderFeed(container, entries, ai = null) {
  const groups = groupFeedByDay(entries, todayStr(), 12);
  if (groups.length === 0) {
    container.innerHTML = `<p class="text-neutral-500 text-sm">No entries yet. Be the first!</p>`;
    return;
  }
  container.innerHTML = groups.map(g => `
    <div>
      <p class="pt-2 text-xs font-bold uppercase tracking-wide text-neutral-500">${esc(g.label)}</p>
      ${g.items.map(e => `
        <div class="flex items-baseline justify-between gap-3 border-b border-edge/60 py-2.5 last:border-0">
          <p class="text-sm"><span class="font-bold">${esc(e.name)}</span>
            <span class="text-neutral-400">${esc(ai?.feed?.[e.id] ?? feedLine(e))}</span></p>
        </div>`).join('')}
    </div>`).join('');
}
