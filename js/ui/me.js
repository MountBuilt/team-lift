import { entriesInWindow, weeklyWorkoutCount } from '../lib/aggregate.js';
import { formatShort, todayStr, mondayOf } from '../lib/dates.js';
import { esc } from '../lib/esc.js';

let meChart = null;

export function renderMe(container, state, { onEdit, onLogout }) {
  const me = state.currentUser;
  const mine = entriesInWindow(state.entries, state.challenge)
    .filter(e => e.userId === me.id)
    .sort((a, b) => a.date < b.date ? 1 : -1);
  const weights = [...mine].reverse().filter(e => typeof e.weight === 'number');
  const wkCount = weeklyWorkoutCount(state.entries, me.id, mondayOf(todayStr()));

  const row = (e) => {
    const bits = [];
    if (typeof e.weight === 'number') bits.push(`${e.weight} kg`);
    if (typeof e.steps === 'number') bits.push(`${e.steps.toLocaleString()} steps`);
    if (e.workoutParts?.length) bits.push(esc(e.workoutParts.join(' + ')));
    return `
      <button data-date="${e.date}" class="entry-row flex w-full items-baseline justify-between gap-3
        border-b border-edge/60 py-3 text-left last:border-0 active:bg-ink">
        <span class="text-sm font-bold">${e.date === todayStr() ? 'Today' : formatShort(e.date)}</span>
        <span class="text-sm text-neutral-400 text-right">${bits.join(' · ') || '—'}</span>
      </button>`;
  };

  container.innerHTML = `
    <div class="flex flex-col gap-3 px-4 pb-28 pt-5">
      <header class="flex items-baseline justify-between px-1">
        <h1 class="text-2xl font-black" style="color:${me.color}">${esc(me.name.toUpperCase())}</h1>
        <span class="text-sm font-bold ${wkCount >= 3 ? 'text-green-400' : 'text-neutral-500'}">
          ${wkCount}/3 workouts this week</span>
      </header>
      <section class="rounded-2xl bg-card border border-edge p-4">
        <h3 class="mb-2 font-black">MY WEIGHT (KG)</h3>
        <div class="relative h-48"><canvas id="me-weight-chart"></canvas></div>
        ${weights.length === 0 ? '<p class="text-sm text-neutral-500">No weigh-ins yet.</p>' : ''}
      </section>
      <section class="rounded-2xl bg-card border border-edge p-4">
        <h3 class="mb-2 font-black">MY ENTRIES <span class="text-xs text-neutral-500 font-bold">tap to edit</span></h3>
        ${mine.map(row).join('') || '<p class="text-sm text-neutral-500">Nothing logged yet.</p>'}
      </section>
      <button id="logout" class="py-3 text-sm font-bold text-neutral-600">Log out</button>
    </div>`;

  container.querySelectorAll('.entry-row').forEach(b =>
    b.addEventListener('click', () => onEdit(b.dataset.date)));
  container.querySelector('#logout').addEventListener('click', onLogout);

  meChart?.destroy();
  meChart = null;
  if (weights.length > 0) {
    meChart = new Chart(document.getElementById('me-weight-chart'), {
      type: 'line',
      data: {
        labels: weights.map(e => e.date),
        datasets: [{
          data: weights.map(e => e.weight),
          borderColor: me.color, backgroundColor: me.color,
          borderWidth: 2.5, pointRadius: 3, tension: 0.3
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            title: (items) => formatShort(weights[items[0].dataIndex].date),
            label: (item) => ` ${item.parsed.y} kg`
          } }
        },
        scales: {
          x: { grid: { display: false },
            ticks: { color: '#737373', maxTicksLimit: 5, maxRotation: 0,
              callback: (v, i) => formatShort(weights[i].date).slice(4) } },
          y: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#737373' } }
        }
      }
    });
  }
}
