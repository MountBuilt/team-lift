// Dash helpers: workouts panel + compact trend chart shells.
// Spec: docs/superpowers/specs/2026-08-16-dash-home-design.md
import {
  weekMarks, streakWeeks
} from '../lib/aggregate.js';
import { esc, safeColor } from '../lib/esc.js';
import { toggleTrendVisible, trendNameOn } from '../lib/trend-filter.js';
import { openLogModal } from './logmodal.js';

// null = every name on. Survives snapshot re-renders of the dash.
let trendVisibleIds = null;

export function trendVisibleUserIds() {
  return trendVisibleIds;
}

export const card = (inner, i, extra = '') =>
  `<section class="fx-card rounded-2xl bg-card border border-edge p-4 ${extra}" style="--fx-i:${i}">${inner}</section>`;

export function chartEmptyHtml(kind) {
  const copy = kind === 'weight'
    ? 'Nobody has hit the scales yet. Be the first trend, not a ghost.'
    : 'No steps on the board. Walk the dog, walk the block, then log it.';
  return `
    <p class="text-sm text-neutral-400">${esc(copy)}</p>
    <button type="button" data-log-empty
      class="pressable mt-3 w-full rounded-xl border border-edge py-2.5 text-sm font-black text-accent">
      LOG IT</button>`;
}

function dotsRow(days) {
  const dot = (day, j) => {
    const workout = day.parts.length > 0;
    const snack = day.challenge === true;
    if (!workout && !snack) {
      return `<span class="fx-dot inline-block h-3.5 w-3.5 rounded-full bg-edge" style="--fx-j:${j}"></span>`;
    }
    const bits = [];
    if (workout) bits.push(day.parts.join(' + '));
    if (snack) bits.push('snack');
    const label = esc(bits.join(' · '));
    const fill = workout ? 'bg-accent' : 'bg-card';
    const ring = snack ? 'dot-snack' : '';
    return `<span class="fx-dot inline-block h-3.5 w-3.5 rounded-full cursor-pointer
      ${fill} ${ring}" style="--fx-j:${j}" data-parts="${label}" aria-label="${label}"></span>`;
  };
  return `<span class="flex gap-1.5">${days.map(dot).join('')}</span>`;
}

export function workoutsPanel(state, monday) {
  const rows = state.users.map(u => {
    const days = weekMarks(state.entries, u.id, monday);
    const streak = streakWeeks(state.entries, u.id, monday);
    return `
      <div class="flex items-center justify-between gap-3 py-2.5 border-b border-edge/60 last:border-0">
        <span class="w-20 truncate font-bold" style="color:${safeColor(u.color)}">${esc(u.name)}
          ${streak >= 2 ? '<span class="flame" title="' + streak + '-week streak">🔥</span>' : ''}</span>
        ${dotsRow(days)}
      </div>`;
  }).join('');
  return `
    <div class="mb-1 flex items-center justify-between">
      <h3 class="eyebrow">Workouts this week</h3>
      <span class="text-xs text-neutral-500">fill workout · ring snack</span>
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

export function initWorkoutTooltip(cardEl) {
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

function trendLegend(users) {
  if (!users.length) return '';
  return `<div id="trend-legend" class="mt-2 flex flex-wrap gap-x-3 gap-y-1">
    ${users.map(u => {
      const on = trendNameOn(trendVisibleIds, u.id);
      return `<button type="button" data-user-id="${esc(u.id)}"
        class="trend-name inline-flex items-center gap-1.5 text-[11px] font-bold ${on ? 'text-neutral-300' : 'trend-name-off'}"
        aria-pressed="${on ? 'true' : 'false'}">
        <span class="inline-block h-2 w-2 rounded-full" style="background:${safeColor(u.color)}"></span>
        ${esc(u.name)}
      </button>`;
    }).join('')}
  </div>`;
}

export function bindTrendLegend(container, state) {
  const root = container.querySelector('#trend-legend');
  if (!root) return;
  root.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-user-id]');
    if (!btn) return;
    const allIds = state.users.map(u => u.id);
    trendVisibleIds = toggleTrendVisible(trendVisibleIds, btn.dataset.userId, allIds);
    for (const el of root.querySelectorAll('[data-user-id]')) {
      const on = trendNameOn(trendVisibleIds, el.dataset.userId);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
      el.classList.toggle('trend-name-off', !on);
      el.classList.toggle('text-neutral-300', on);
    }
    import('../charts.js').then(m => m.drawCharts(state, {
      animate: false, visibleUserIds: trendVisibleIds
    })).catch(() => {});
  });
}

export function trendCardsHtml(state, fxI) {
  return card(`
    <div class="flex gap-3">
      <div class="min-w-0 flex-1">
        <h3 class="eyebrow leading-none">Weight</h3>
        <div class="relative chart-short mt-1"><canvas id="weight-chart"></canvas></div>
        <div id="weight-empty" class="hidden mt-1">${chartEmptyHtml('weight')}</div>
      </div>
      <div class="min-w-0 flex-1">
        <h3 class="eyebrow leading-none">Steps</h3>
        <div class="relative chart-short mt-1"><canvas id="steps-chart"></canvas></div>
        <div id="steps-empty" class="hidden mt-1">${chartEmptyHtml('steps')}</div>
      </div>
    </div>
    ${trendLegend(state.users)}
  `, fxI);
}

export function bindChartEmpties(container) {
  container.querySelectorAll('[data-log-empty]').forEach(btn =>
    btn.addEventListener('click', () => openLogModal()));
}
