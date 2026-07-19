import { entriesInWindow, weeklyWorkoutCount } from '../lib/aggregate.js';
import { formatShort, todayStr, mondayOf, addDays } from '../lib/dates.js';
import { esc, safeColor } from '../lib/esc.js';
import { pushSupported, enablePush, disablePush } from '../push.js';
import { reducedMotion } from './fx.js';

let meChart = null;

// The weekly target as three fillable slabs: the whole game is 3+ workouts.
function targetSlabs(count, color) {
  const slab = (i) => `
    <span class="h-2.5 flex-1 rounded-full ${i < count ? '' : 'bg-edge'}"
      ${i < count ? `style="background:${color}"` : ''}></span>`;
  return `<span class="flex w-24 items-center gap-1">${[0, 1, 2].map(slab).join('')}</span>`;
}

export function renderMe(container, state, { onEdit, onLogout }, { animate = false } = {}) {
  const me = state.currentUser;
  const color = safeColor(me.color);
  const today = todayStr();
  const monday = mondayOf(today);
  const weekEnd = addDays(monday, 6);
  // Weight chart: full challenge window. Entry list: this Mon–Sun only.
  const allMine = entriesInWindow(state.entries, state.challenge)
    .filter(e => e.userId === me.id)
    .sort((a, b) => a.date < b.date ? 1 : -1);
  const mine = allMine.filter(e => e.date >= monday && e.date <= weekEnd);
  const weights = [...allMine].reverse().filter(e => typeof e.weight === 'number');
  const wkCount = weeklyWorkoutCount(state.entries, me.id, monday);
  const pushOn = me.push?.enabled === true;
  const hit = wkCount >= 3;

  const row = (e) => {
    const bits = [];
    if (typeof e.weight === 'number') bits.push(`${e.weight} kg`);
    if (typeof e.steps === 'number') bits.push(`${e.steps.toLocaleString()} steps`);
    if (e.workoutParts?.length) bits.push(esc(e.workoutParts.join(' + ')));
    if (e.dailyChallenge === true) bits.push('challenge ✔');
    return `
      <button data-date="${esc(e.date)}" class="entry-row flex w-full items-baseline justify-between gap-3
        border-b border-edge/60 py-3 text-left last:border-0 active:bg-ink">
        <span class="text-sm font-bold">${e.date === todayStr() ? 'Today' : formatShort(e.date)}</span>
        <span class="text-sm text-neutral-400 text-right">${bits.join(' · ') || '-'}</span>
      </button>`;
  };

  container.innerHTML = `
    <div class="${animate ? 'fx-on ' : ''}flex flex-col gap-3 px-4 pb-28 pt-5">
      <header class="fx-card ember-bg px-1 pt-2" style="--fx-i:0">
        <p class="eyebrow">This is you, champion</p>
        <h1 class="display text-[2.6rem] leading-none tracking-tight mt-1" style="color:${color}">
          ${esc(me.name.toUpperCase())}</h1>
        <div class="mt-3 flex items-center justify-between">
          <span class="text-sm font-bold ${hit ? 'text-green-400' : 'text-neutral-400'}">
            ${hit ? 'Weekly target smashed 💪' : `${wkCount}/3 workouts this week`}</span>
          ${targetSlabs(wkCount, hit ? '#4ade80' : color)}
        </div>
      </header>
      <section class="fx-card rounded-2xl bg-card border border-edge p-4" style="--fx-i:1">
        <h3 class="mb-2 eyebrow">My weight (kg)</h3>
        <div class="relative h-48"><canvas id="me-weight-chart"></canvas></div>
        ${weights.length === 0 ? '<p class="text-sm text-neutral-500">No weigh-ins yet. Front the scales, get the trend line.</p>' : ''}
      </section>
      <section class="fx-card rounded-2xl bg-card border border-edge p-4" style="--fx-i:2">
        <h3 class="mb-2 eyebrow">My entries <span class="normal-case tracking-normal text-neutral-600">· this week · tap to edit</span></h3>
        ${mine.map(row).join('') || '<p class="text-sm text-neutral-500">Nothing this week yet. Hit the + and get on the board.</p>'}
      </section>
      <section class="fx-card rounded-2xl bg-card border border-edge p-4" style="--fx-i:3">
        <h3 class="mb-2 eyebrow">Notifications</h3>
        ${pushSupported() ? `
        <p class="text-sm text-neutral-400">Morning motivation plus an evening kick up the arse if you haven't logged anything.</p>
        <button id="push-toggle" class="pressable mt-3 w-full rounded-xl border border-edge py-3 text-sm font-black
          ${pushOn ? 'text-green-400' : 'text-neutral-400'}">
          ${pushOn ? 'NOTIFICATIONS ON' : 'TURN ON NOTIFICATIONS'}</button>`
      : '<p class="text-sm text-neutral-500">Install the app to your home screen first, then this switch turns up.</p>'}
      </section>
      <button id="logout" class="py-3 text-sm font-bold text-neutral-600">Log out</button>
    </div>`;

  container.querySelectorAll('.entry-row').forEach(b =>
    b.addEventListener('click', () => onEdit(b.dataset.date)));
  container.querySelector('#logout').addEventListener('click', onLogout);

  const toggle = container.querySelector('#push-toggle');
  toggle?.addEventListener('click', async () => {
    toggle.disabled = true;
    toggle.textContent = 'WORKING…';
    try {
      if (pushOn) {
        await disablePush(me.id, me);
      } else {
        const res = await enablePush(me.id);
        if (!res.ok) {
          toggle.textContent = 'BLOCKED. ALLOW NOTIFICATIONS IN SETTINGS.';
          return;
        }
      }
    } catch {
      toggle.textContent = 'FAILED. TAP TO TRY AGAIN.';
      toggle.disabled = false;
    }
  });

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
        responsive: true, maintainAspectRatio: false,
        animation: animate && !reducedMotion() ? { duration: 800, easing: 'easeOutQuart' } : false,
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
