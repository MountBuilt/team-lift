import {
  teamTiles, workoutDots, weeklyWorkoutCount, streakWeeks
} from '../lib/aggregate.js';
import { todayStr, mondayOf, addDays, weekNumber, totalWeeks } from '../lib/dates.js';
import { renderFeed } from './feed.js';
import { esc, safeColor } from '../lib/esc.js';

const card = (inner, extra = '') =>
  `<section class="rounded-2xl bg-card border border-edge p-4 ${extra}">${inner}</section>`;

function tilesHtml(t) {
  const tile = (big, small, hot = false) => `
    <div class="flex-1 rounded-xl bg-ink border border-edge px-2 py-3 text-center">
      <p class="text-2xl font-black ${hot ? 'text-accent' : ''}">${big}</p>
      <p class="text-[11px] font-bold uppercase tracking-wide text-neutral-500">${small}</p>
    </div>`;
  return `<div class="flex gap-2">
    ${tile(t.totalWorkouts, 'workouts this wk')}
    ${tile(`${t.membersAt3}/${t.totalMembers}`, 'hit 3+ this wk', t.membersAt3 === t.totalMembers && t.totalMembers > 0)}
    ${tile(t.totalSteps.toLocaleString(), 'team steps this wk')}
  </div>`;
}

function dotsRow(dots, count) {
  const hit = count >= 3;
  const dot = (on) => `<span class="inline-block h-3.5 w-3.5 rounded-full
    ${on ? (hit ? 'bg-green-400' : 'bg-accent') : 'bg-edge'}"></span>`;
  return `<span class="flex gap-1.5">${dots.map(dot).join('')}</span>`;
}

function workoutsPanel(state, monday) {
  const lastMonday = addDays(monday, -7);
  const rows = state.users.map(u => {
    const dots = workoutDots(state.entries, u.id, monday);
    const count = weeklyWorkoutCount(state.entries, u.id, monday);
    const lastCount = weeklyWorkoutCount(state.entries, u.id, lastMonday);
    const streak = streakWeeks(state.entries, u.id, monday);
    return `
      <div class="flex items-center justify-between gap-3 py-2.5 border-b border-edge/60 last:border-0">
        <span class="w-20 truncate font-bold" style="color:${safeColor(u.color)}">${esc(u.name)}
          ${streak >= 2 ? '<span title="' + streak + '-week streak">🔥</span>' : ''}</span>
        ${dotsRow(dots, count)}
        <span class="w-16 text-right text-sm ${count >= 3 ? 'font-black text-green-400' : 'text-neutral-400'}">
          ${count}/7 <span class="text-neutral-600 text-xs">(${lastCount})</span></span>
      </div>`;
  }).join('');
  const allHit = state.users.length > 0 &&
    state.users.every(u => weeklyWorkoutCount(state.entries, u.id, monday) >= 3);
  return `
    ${allHit ? `<p class="mb-2 rounded-xl bg-green-400/10 border border-green-400/30
      px-3 py-2 text-center text-sm font-black text-green-400">
      💪 WHOLE TEAM AT 3+ THIS WEEK</p>` : ''}
    <div class="mb-1 flex items-center justify-between">
      <h3 class="font-black">WORKOUTS THIS WEEK</h3>
      <span class="text-xs text-neutral-500">last wk in ( )</span>
    </div>
    ${rows || '<p class="text-neutral-500 text-sm">No members yet.</p>'}`;
}

export function renderDashboard(container, state) {
  const c = state.challenge;
  const today = todayStr();
  const monday = mondayOf(today);
  const wk = weekNumber(today, c.startDate);
  const total = totalWeeks(c.startDate, c.endDate);
  const inWindow = today >= c.startDate && today <= c.endDate;

  container.innerHTML = `
    <div class="flex flex-col gap-3 px-4 pb-28 pt-5">
      <header class="px-1">
        <h1 class="text-2xl font-black tracking-tight">${esc(c.title.toUpperCase())}</h1>
        <p class="text-sm font-bold text-neutral-500">
          ${inWindow ? `Week ${wk} of ${total}` :
            (today < c.startDate ? `Starts ${esc(c.startDate)}` : 'Challenge finished')}</p>
      </header>
      ${card(tilesHtml(teamTiles(state.entries, state.users, monday)))}
      ${card(`<h3 class="mb-2 font-black">WEIGHT · % FROM START</h3>
        <div class="relative h-56"><canvas id="weight-chart"></canvas></div>
        <p id="weight-empty" class="hidden text-sm text-neutral-500">No weigh-ins yet — be the first!</p>`)}
      ${card(`<h3 class="mb-2 font-black">TEAM STEPS · DAILY</h3>
        <div class="relative h-56"><canvas id="steps-chart"></canvas></div>
        <p id="steps-empty" class="hidden text-sm text-neutral-500">No steps logged yet — be the first!</p>`)}
      ${card(workoutsPanel(state, monday))}
      ${card(`<h3 class="mb-2 font-black">RECENT ACTIVITY</h3><div id="feed"></div>`)}
    </div>`;

  renderFeed(container.querySelector('#feed'), state.entries);
  import('../charts.js').then(m => m.drawCharts(state)).catch(() => {});
}
