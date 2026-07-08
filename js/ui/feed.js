import { activityFeed } from '../lib/aggregate.js';
import { formatShort, todayStr } from '../lib/dates.js';
import { esc } from '../lib/esc.js';

function describe(entry) {
  const bits = [];
  if (Array.isArray(entry.workoutParts) && entry.workoutParts.length > 0) {
    bits.push(`a ${entry.workoutParts.map(esc).join(' + ')} workout`);
  }
  if (typeof entry.steps === 'number') bits.push(`${entry.steps.toLocaleString()} steps`);
  if (typeof entry.weight === 'number') bits.push('a weigh-in');
  return bits.join(', ') || 'an entry';
}

export function renderFeed(container, entries) {
  const items = activityFeed(entries, 12);
  if (items.length === 0) {
    container.innerHTML = `<p class="text-neutral-500 text-sm">No entries yet — be the first!</p>`;
    return;
  }
  container.innerHTML = items.map(e => `
    <div class="flex items-baseline justify-between gap-3 border-b border-edge/60 py-2.5 last:border-0">
      <p class="text-sm"><span class="font-bold">${esc(e.name)}</span>
        <span class="text-neutral-400">logged ${describe(e)}</span></p>
      <span class="shrink-0 text-xs text-neutral-500">
        ${e.date === todayStr() ? 'Today' : formatShort(e.date)}</span>
    </div>`).join('');
}
