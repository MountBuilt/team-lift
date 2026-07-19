import {
  teamTiles, workoutWeek, weeklyWorkoutCount, streakWeeks
} from '../lib/aggregate.js';
import { dailyChallenge, challengeDoneOn, challengeStreak } from '../lib/challenge.js';
import { todayStr, mondayOf, addDays, weekNumber, totalWeeks, parseLocal } from '../lib/dates.js';
import { pickFrom, stepsComment, workoutsComment, weightComment, banterFresh, CHALLENGE_QUIPS } from '../lib/banter.js';
import { saveEntry } from '../firebase.js';
import { renderFeed } from './feed.js';
import { esc, safeColor } from '../lib/esc.js';
import { runCountUps, burstFrom, compactNumber } from './fx.js';
import { threadBlockHtml, bindThreads } from './thread.js';

// One-shot celebration: set when the user ticks the challenge, consumed by
// the next render so the DONE stamp slams in exactly once.
let celebratePending = false;

const card = (inner, i, extra = '') =>
  `<section class="fx-card rounded-2xl bg-card border border-edge p-4 ${extra}" style="--fx-i:${i}">${inner}</section>`;

// Aiden parent under a card: tappable thread (see js/ui/thread.js). No separate Reply.
const coachThread = (target, comment, banter) =>
  comment ? threadBlockHtml(target, esc(comment), banter) : '';

function headerHtml(c, today) {
  const wk = weekNumber(today, c.startDate);
  const total = totalWeeks(c.startDate, c.endDate);
  const inWindow = today >= c.startDate && today <= c.endDate;
  const totalDays = Math.round((parseLocal(c.endDate) - parseLocal(c.startDate)) / 86400000) + 1;
  const dayN = Math.min(totalDays, Math.max(0,
    Math.round((parseLocal(today) - parseLocal(c.startDate)) / 86400000) + 1));
  const pct = Math.min(100, Math.max(0, (dayN / totalDays) * 100));
  const sub = inWindow ? `WEEK ${wk} OF ${total}`
    : (today < c.startDate ? `STARTS ${esc(c.startDate)}` : 'CHALLENGE FINISHED');
  return `
    <header class="fx-card ember-bg px-1 pt-2" style="--fx-i:0">
      <p class="eyebrow">Team Lift · ${sub}</p>
      <h1 class="display text-[2.6rem] leading-none tracking-tight mt-1">${esc(c.title.toUpperCase())}</h1>
      <div class="mt-3 heatbar"><div class="heatbar-fill" style="width:${pct.toFixed(1)}%"></div></div>
      <div class="mt-1.5 flex justify-between text-[11px] font-bold text-neutral-500">
        <span>${inWindow ? `Day ${dayN} of ${totalDays}` : ''}</span>
        <span>${inWindow ? `${totalDays - dayN} days left` : ''}</span>
      </div>
    </header>`;
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

// One bodyweight exercise a day, same for everyone, ramping weekly. Ticking
// it writes dailyChallenge:true onto today's entry; streaks are consecutive
// ticked days. Hidden once the challenge window has ended.
function challengeCard(state, today) {
  const ch = dailyChallenge(today, state.challenge.startDate);
  const doneIds = challengeDoneOn(state.entries, today);
  const me = state.currentUser;
  const meDone = doneIds.includes(me.id);
  const streakOf = (id) => challengeStreak(state.entries, id, today);
  const myStreak = streakOf(me.id);
  const stamp = celebratePending;
  celebratePending = false;

  const doneChips = state.users
    .filter(u => doneIds.includes(u.id))
    .map(u => {
      const s = streakOf(u.id);
      return `<span class="font-bold" style="color:${safeColor(u.color)}">${esc(u.name)}${s >= 2 ? ` <span class="flame">🔥</span>${s}` : ''}</span>`;
    }).join('<span class="text-neutral-600"> · </span>');

  return `
    <div class="flex items-center justify-between">
      <h3 class="eyebrow">Daily challenge</h3>
      ${myStreak >= 2 ? `<span class="text-sm font-black text-accent"><span class="flame">🔥</span> ${myStreak}-day streak</span>` : ''}
    </div>
    <p class="mt-1 display text-4xl tracking-tight heat-text">${ch.reps} ${esc(ch.name.toUpperCase())}</p>
    ${coach(pickFrom(CHALLENGE_QUIPS, today))}
    ${meDone
      ? `<p class="${stamp ? 'stamp ' : ''}mt-3 rounded-xl bg-green-400/10 border border-green-400/30 py-3 text-center
           display text-lg tracking-wide text-green-400">DONE TODAY 💪</p>`
      : `<button id="challenge-done" class="pressable mt-3 w-full rounded-xl bg-accent py-3 display text-lg tracking-wide
           text-black active:bg-accentDim">I'VE DONE IT ✔</button>`}
    ${doneChips ? `<p class="mt-2 text-xs text-neutral-500">Done today: ${doneChips}</p>` : ''}`;
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

// Single delegated pointer/tap tooltip for the workout dots. Capture-phase
// listeners let one handler on the card catch pointerenter/pointerleave,
// which don't bubble, for every dot inside it.
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

  // cardEl is torn down and replaced on every re-render (app.js re-renders the
  // whole view on each Firestore snapshot), so listeners on it are naturally
  // garbage-collected with it. document/window listeners are not, so those
  // are bound exactly once at module scope (below) and call the module-level
  // hideActiveWorkoutTooltip, which always targets whichever tooltip is open.
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

export function renderDashboard(container, state, { animate = false } = {}) {
  const c = state.challenge;
  const today = todayStr();
  const monday = mondayOf(today);
  const ai = banterFresh(state.banter, today) ? state.banter : null;

  container.innerHTML = `
    <div class="${animate ? 'fx-on ' : ''}flex flex-col gap-3 px-4 pb-28 pt-5">
      ${headerHtml(c, today)}
      ${card(tilesHtml(teamTiles(state.entries, state.users, monday)), 1)}
      ${today <= c.endDate ? card(challengeCard(state, today), 2) : ''}
      ${card(`<h3 class="mb-2 eyebrow">Weight (kg)</h3>
        <div class="relative h-56"><canvas id="weight-chart"></canvas></div>
        <p id="weight-empty" class="hidden text-sm text-neutral-500">No weigh-ins yet. Be the first!</p>
        ${coachThread('weight', ai?.cards?.weight ?? weightComment(state.entries, state.users, today), state.banter)}`, 3)}
      <section id="workouts-card" class="fx-card rounded-2xl bg-card border border-edge p-4" style="--fx-i:4">
        ${workoutsPanel(state, monday) +
          coachThread('workouts', ai?.cards?.workouts ?? workoutsComment(state.entries, state.users, monday, today), state.banter)}
      </section>
      ${card(`<h3 class="mb-2 eyebrow">Team steps · daily</h3>
        <div class="relative h-56"><canvas id="steps-chart"></canvas></div>
        <p id="steps-empty" class="hidden text-sm text-neutral-500">No steps logged yet. Be the first!</p>
        ${coachThread('steps', ai?.cards?.steps ?? stepsComment(state.entries, state.users, monday, today), state.banter)}`, 5)}
      ${card(`<h3 class="mb-2 eyebrow">Recent activity</h3><div id="feed"></div>`, 6)}
    </div>`;

  renderFeed(container.querySelector('#feed'), state.entries, ai, state.users, state.banter);
  bindThreads(container, state.banter);
  initWorkoutTooltip(container.querySelector('#workouts-card'));
  if (animate) runCountUps(container);

  // Tick today's challenge: confetti fires immediately, then the Firestore
  // snapshot re-render flips the card to the DONE stamp (instant with local
  // persistence's latency compensation).
  container.querySelector('#challenge-done')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    btn.textContent = 'SAVING…';
    burstFrom(btn);
    celebratePending = true;
    try {
      await saveEntry(state.currentUser.id, state.currentUser.name, todayStr(), { dailyChallenge: true });
    } catch (err) {
      console.error(err);
      celebratePending = false;
      btn.disabled = false;
      btn.textContent = "I'VE DONE IT ✔";
    }
  });
  import('../charts.js').then(m => m.drawCharts(state, { animate })).catch(() => {});
}
