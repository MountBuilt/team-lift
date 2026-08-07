// Stats tab: week tiles, workouts panel, weight + team steps charts.
// Spec: docs/superpowers/specs/2026-08-07-home-stats-ai-feed-design.md
import {
  teamTiles, workoutWeek, weeklyWorkoutCount, streakWeeks
} from '../lib/aggregate.js';
import { todayStr, mondayOf, addDays } from '../lib/dates.js';
import { esc, safeColor } from '../lib/esc.js';
import { runCountUps, compactNumber } from './fx.js';
import { openLogModal } from './logmodal.js';

const card = (inner, i, extra = '') =>
  `<section class="fx-card rounded-2xl bg-card border border-edge p-4 ${extra}" style="--fx-i:${i}">${inner}</section>`;

function chartEmptyHtml(kind) {
  const copy = kind === 'weight'
    ? 'Nobody has hit the scales yet. Be the first trend, not a ghost.'
    : 'No steps on the board. Walk the dog, walk the block, then log it.';
  return `
    <p class="text-sm text-neutral-400">${esc(copy)}</p>
    <button type="button" data-log-empty
      class="pressable mt-3 w-full rounded-xl border border-edge py-2.5 text-sm font-black text-accent">
      LOG IT</button>`;
}

function tilesHtml(t) {
  const tile = (big, small, opts = {}) => `
    <div class="flex-1 rounded-xl bg-ink border ${opts.hot ? 'border-green-400/40' : 'border-edge'} px-2 py-3 text-center">
      <p class="display text-3xl ${opts.hot ? 'text-green-400' : ''}"
        ${opts.count ? `data-countup="${opts.count}" data-fmt="${opts.fmt || 'plain'}"` : ''}>${big}</p>
      <p class="mt-1 eyebrow">${small}</p>
    </div>`;
  const allHit = t.membersAt3 === t.totalMembers && t.totalMembers > 0;
  return `<div class="flex gap-2">
    ${tile(String(t.totalWorkouts), 'workouts<br>this wk', { count: t.totalWorkouts })}
    ${tile(`${t.membersAt3}/${t.totalMembers}`, 'hit 3+<br>this wk', { count: 0, hot: allHit })}
    ${tile(compactNumber(t.totalSteps), 'team steps<br>this wk', { count: t.totalSteps, fmt: 'compact' })}
  </div>`;
}

function dotsRow(days, count) {
  const hit = count >= 3;
  const dot = (day, j) => {
    if (day.parts.length === 0) {
      return `<span class="fx-dot inline-block h-3.5 w-3.5 rounded-full bg-edge" style="--fx-j:${j}"></span>`;
    }
    const label = esc(day.parts.join(' + '));
    return `<span class="fx-dot inline-block h-3.5 w-3.5 rounded-full cursor-pointer
      ${hit ? 'bg-green-400' : 'bg-accent'}" style="--fx-j:${j}" data-parts="${label}" aria-label="${label}"></span>`;
  };
  return `<span class="flex gap-1.5">${days.map(dot).join('')}</span>`;
}

function workoutsPanel(state, monday) {
  const lastMonday = addDays(monday, -7);
  const rows = state.users.map(u => {
    const days = workoutWeek(state.entries, u.id, monday);
    const count = weeklyWorkoutCount(state.entries, u.id, monday);
    const lastCount = weeklyWorkoutCount(state.entries, u.id, lastMonday);
    const streak = streakWeeks(state.entries, u.id, monday);
    return `
      <div class="flex items-center justify-between gap-3 py-2.5 border-b border-edge/60 last:border-0">
        <span class="w-20 truncate font-bold" style="color:${safeColor(u.color)}">${esc(u.name)}
          ${streak >= 2 ? '<span class="flame" title="' + streak + '-week streak">🔥</span>' : ''}</span>
        ${dotsRow(days, count)}
        <span class="w-16 text-right text-sm ${count >= 3 ? 'font-black text-green-400' : 'text-neutral-400'}">
          ${count}/7 <span class="text-neutral-600 text-xs">(${lastCount})</span></span>
      </div>`;
  }).join('');
  const allHit = state.users.length > 0 &&
    state.users.every(u => weeklyWorkoutCount(state.entries, u.id, monday) >= 3);
  return `
    ${allHit ? `<p class="team-hit mb-2 rounded-xl border border-green-400/30
      px-3 py-2 text-center display text-base tracking-wide text-green-400">
      💪 WHOLE TEAM AT 3+ THIS WEEK</p>` : ''}
    <div class="mb-1 flex items-center justify-between">
      <h3 class="eyebrow">Workouts this week</h3>
      <span class="text-xs text-neutral-500">last wk in ( )</span>
    </div>
    ${rows || '<p class="text-neutral-500 text-sm">No members yet.</p>'}
    <div id="workout-tooltip" role="tooltip"
      class="hidden fixed z-50 pointer-events-none max-w-[16rem] rounded-lg border border-edge
        bg-ink px-2 py-1 text-xs text-neutral-100 shadow-lg"></div>`;
}

let activeWorkoutTip = null;
let globalWorkoutTooltipDismissalBound = false;

function hideActiveWorkoutTooltip() {
  if (activeWorkoutTip) {
    activeWorkoutTip.classList.add('hidden');
    activeWorkoutTip = null;
  }
}

function bindGlobalWorkoutTooltipDismissal() {
  if (globalWorkoutTooltipDismissalBound) return;
  globalWorkoutTooltipDismissalBound = true;
  document.addEventListener('click', hideActiveWorkoutTooltip);
  window.addEventListener('scroll', hideActiveWorkoutTooltip, true);
}

function initWorkoutTooltip(cardEl) {
  const tip = cardEl.querySelector('#workout-tooltip');
  if (!tip) return;

  const hide = () => {
    tip.classList.add('hidden');
    if (activeWorkoutTip === tip) activeWorkoutTip = null;
  };

  const show = (dot) => {
    const parts = dot.dataset.parts;
    if (!parts) return;
    tip.textContent = parts;
    tip.classList.remove('hidden');
    activeWorkoutTip = tip;
    const dotRect = dot.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    let left = dotRect.left + dotRect.width / 2 - tipRect.width / 2;
    left = Math.max(4, Math.min(left, window.innerWidth - tipRect.width - 4));
    let top = dotRect.top - tipRect.height - 8;
    if (top < 4) top = dotRect.bottom + 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };

  cardEl.addEventListener('pointerenter', (ev) => {
    if (ev.pointerType !== 'mouse') return;
    const dot = ev.target.closest?.('[data-parts]');
    if (dot) show(dot);
  }, true);

  cardEl.addEventListener('pointerleave', (ev) => {
    if (ev.pointerType !== 'mouse') return;
    if (ev.target.closest?.('[data-parts]')) hide();
  }, true);

  cardEl.addEventListener('click', (ev) => {
    const dot = ev.target.closest?.('[data-parts]');
    if (!dot) return;
    ev.stopPropagation();
    show(dot);
  });

  bindGlobalWorkoutTooltipDismissal();
}

export function renderStats(container, state, { animate = false } = {}) {
  const today = todayStr();
  const monday = mondayOf(today);
  let fx = 0;
  const nextFx = () => fx++;

  container.innerHTML = `
    <div class="${animate ? 'fx-on ' : ''}flex flex-col gap-3 px-4 pt-5 safe-bottom">
      ${card(tilesHtml(teamTiles(state.entries, state.users, monday)), nextFx())}
      <section id="workouts-card" class="fx-card rounded-2xl bg-card border border-edge p-4" style="--fx-i:${nextFx()}">
        ${workoutsPanel(state, monday)}
      </section>
      ${card(`<h3 class="mb-2 eyebrow">Weight (kg)</h3>
        <div class="relative h-56"><canvas id="weight-chart"></canvas></div>
        <div id="weight-empty" class="hidden mt-2">${chartEmptyHtml('weight')}</div>`, nextFx())}
      ${card(`<h3 class="mb-2 eyebrow">Team steps · daily</h3>
        <div class="relative h-56"><canvas id="steps-chart"></canvas></div>
        <div id="steps-empty" class="hidden mt-2">${chartEmptyHtml('steps')}</div>`, nextFx())}
    </div>`;

  initWorkoutTooltip(container.querySelector('#workouts-card'));
  if (animate) runCountUps(container);
  container.querySelectorAll('[data-log-empty]').forEach(btn =>
    btn.addEventListener('click', () => openLogModal()));
  import('../charts.js').then(m => m.drawCharts(state, { animate })).catch(() => {});
}
