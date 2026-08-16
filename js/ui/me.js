import {
  entriesInWindow, weeklyWorkoutCount, daysLoggedThisWeek, weeklySteps
} from '../lib/aggregate.js';
import { challengeStreak } from '../lib/challenge.js';
import { formatShort, todayStr, mondayOf, addDays } from '../lib/dates.js';
import { esc, safeColor } from '../lib/esc.js';
import { compactNumber, reducedMotion } from './fx.js';
import { pushSupported, enablePush, disablePush } from '../push.js';
import { openLogModal } from './logmodal.js';

let meChart = null;

function statTile(big, label, opts = {}) {
  return `
    <div class="flex-1 rounded-xl bg-ink border border-edge px-2 py-3 text-center min-w-[4.5rem]">
      <p class="display text-2xl ${opts.hot ? 'text-green-400' : ''}">${big}</p>
      <p class="mt-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">${label}</p>
    </div>`;
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
  const daysLogged = daysLoggedThisWeek(state.entries, me.id, monday);
  const stepsWeek = weeklySteps(state.entries, me.id, monday);
  const streak = challengeStreak(state.entries, me.id, today);
  const pushOn = me.push?.enabled === true;

  const row = (e) => {
    const bits = [];
    if (typeof e.weight === 'number') bits.push(`${e.weight} kg`);
    if (typeof e.steps === 'number') bits.push(`${e.steps.toLocaleString()} steps`);
    if (e.workoutParts?.length) bits.push(esc(e.workoutParts.join(' + ')));
    if (e.dailyChallenge === true) bits.push('snack ✔');
    return `
      <button data-date="${esc(e.date)}" class="entry-row flex w-full items-baseline justify-between gap-3
        border-b border-edge/60 py-3 text-left last:border-0 active:bg-ink">
        <span class="text-sm font-bold">${e.date === todayStr() ? 'Today' : formatShort(e.date)}</span>
        <span class="text-sm text-neutral-400 text-right">${bits.join(' · ') || '-'}</span>
      </button>`;
  };

  container.innerHTML = `
    <div class="${animate ? 'fx-on ' : ''}flex flex-col gap-3 px-4 pt-5 safe-bottom">
      <header class="fx-card ember-bg px-1 pt-2" style="--fx-i:0">
        <p class="eyebrow">This is you, champion</p>
        <h1 class="display text-[2.6rem] leading-none tracking-tight mt-1" style="color:${color}">
          ${esc(me.name.toUpperCase())}</h1>
      </header>
      <section class="fx-card rounded-2xl bg-card border border-edge p-4" style="--fx-i:1">
        <h3 class="mb-3 eyebrow">This week</h3>
        <div class="flex flex-wrap gap-2">
          ${statTile(String(daysLogged), 'days logged')}
          ${statTile(compactNumber(stepsWeek), 'steps')}
          ${statTile(String(wkCount), 'workouts')}
          ${statTile(streak > 0 ? String(streak) : '—', streak >= 2 ? `🔥 streak` : 'snack streak')}
        </div>
      </section>
      <section class="fx-card rounded-2xl bg-card border border-edge p-4" style="--fx-i:2">
        <h3 class="mb-2 eyebrow">My weight (kg)</h3>
        <div class="relative h-48"><canvas id="me-weight-chart"></canvas></div>
        ${weights.length === 0 ? `
          <p class="text-sm text-neutral-400">No weigh-ins yet. Front the scales, get the trend line.</p>
          <button type="button" id="me-log-weight"
            class="pressable mt-3 w-full rounded-xl border border-edge py-2.5 text-sm font-black text-accent">
            LOG A WEIGH-IN</button>` : ''}
      </section>
      <section class="fx-card rounded-2xl bg-card border border-edge p-4" style="--fx-i:3">
        <h3 class="mb-2 eyebrow">My entries <span class="normal-case tracking-normal text-neutral-600">· this week · tap to edit</span></h3>
        ${mine.map(row).join('') || `
          <p class="text-sm text-neutral-400">Nothing this week yet. Hit the + and get on the board.</p>
          <button type="button" id="me-log-entry"
            class="pressable mt-3 w-full rounded-xl border border-edge py-2.5 text-sm font-black text-accent">
            LOG SOMETHING</button>`}
      </section>
      <section class="fx-card rounded-2xl bg-card border border-edge p-4" style="--fx-i:4">
        <h3 class="mb-2 eyebrow">Notifications</h3>
        ${pushSupported() ? `
        <p class="text-sm text-neutral-400">Morning motivation plus an evening kick up the arse if you haven't logged anything.</p>
        <button id="push-toggle" class="pressable mt-3 w-full rounded-xl border border-edge py-3 text-sm font-black
          ${pushOn ? 'text-green-400' : 'text-neutral-400'}">
          ${pushOn ? 'NOTIFICATIONS ON' : 'TURN ON NOTIFICATIONS'}</button>`
      : `<p class="text-sm text-neutral-400">Install the app to your home screen first, then this switch turns up.</p>
          <p class="mt-2 text-xs text-neutral-600">iPhone: Share → Add to Home Screen. Android: browser menu → Install app.</p>`}
      </section>
      <button id="logout" class="py-3 text-sm font-bold text-neutral-600">Log out</button>
    </div>`;

  container.querySelectorAll('.entry-row').forEach(b =>
    b.addEventListener('click', () => onEdit(b.dataset.date)));
  container.querySelector('#logout').addEventListener('click', onLogout);
  container.querySelector('#me-log-weight')?.addEventListener('click', () => openLogModal());
  container.querySelector('#me-log-entry')?.addEventListener('click', () => openLogModal());

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
