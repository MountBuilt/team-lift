import {
  teamTiles, workoutWeek, weeklyWorkoutCount, streakWeeks, userHasLogged
} from '../lib/aggregate.js';
import { dailyChallenge, challengeDoneOn, challengeStreak } from '../lib/challenge.js';
import { todayStr, mondayOf, addDays, weekNumber, totalWeeks, parseLocal } from '../lib/dates.js';
import {
  pickFrom, CHALLENGE_QUIPS, todayBoardMembers, loggedToday, logNudgeLine
} from '../lib/banter.js';
import { templateReport, reportFresh } from '../lib/report.js';
import { REPORT_TARGET } from '../lib/threads.js';
import { shouldShowPushCoach, PUSH_COACH_KEY } from '../lib/push-coach.js';
import { saveEntry } from '../firebase.js';
import { pushSupported } from '../push.js';
import { renderFeed } from './feed.js';
import { esc, safeColor } from '../lib/esc.js';
import { runCountUps, burstFrom, compactNumber } from './fx.js';
import { threadBlockHtml, bindThreads } from './thread.js';
import { openLogModal } from './logmodal.js';

// One-shot celebration: set when the user ticks the challenge, consumed by
// the next render so the DONE stamp slams in exactly once.
let celebratePending = false;

const card = (inner, i, extra = '') =>
  `<section class="fx-card rounded-2xl bg-card border border-edge p-4 ${extra}" style="--fx-i:${i}">${inner}</section>`;

// Plain coach line (daily challenge quip — not threaded).
const coach = (comment) => comment ? `<p class="coach">${esc(comment)}</p>` : '';

/**
 * Aiden's morning report: one piece of copy about yesterday across weight, the
 * daily challenge, workouts and steps, with the crew's comment thread attached.
 *
 * This replaced the three separate per-card coach threads (weight/steps/
 * workouts) on 2026-07-26. One good daily read with a through-line beats three
 * disconnected 200-char quips, it is one comment surface instead of three, and
 * it is one model call instead of three. Do not put coach lines back on the
 * chart cards. See CLAUDE.md.
 */
function reportCard(state, today) {
  const ai = reportFresh(state.banter?.report, today) ? state.banter.report.text : null;
  const text = ai ?? templateReport(
    state.entries, state.users, today,
    dailyChallenge(today, state.challenge.startDate)
  );
  return `
    <div class="flex items-center justify-between">
      <h3 class="eyebrow">Aiden's morning report</h3>
      <span class="eyebrow text-neutral-600">Yesterday</span>
    </div>
    ${threadBlockHtml(REPORT_TARGET, esc(text), state.banter, { parentClass: 'report-parent' })}`;
}

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

// Who has logged something today (hasAnyLog). Quiet chips stay neutral —
// same-day grace means no roast copy on the strip.
function todayBoardHtml(state, today) {
  const board = todayBoardMembers(state.users, state.entries, today);
  if (board.length === 0) return '';
  const nLogged = board.filter(m => m.logged).length;
  const chips = board.map(m => {
    const color = safeColor(m.color);
    const initial = esc((m.name || '?').charAt(0).toUpperCase());
    // Optional secondary: tiny marks for challenge / workout when already logged.
    const marks = [];
    if (m.challenge) marks.push('<span title="Challenge done">✓</span>');
    if (m.workout) marks.push('<span title="Workout logged">W</span>');
    const markHtml = marks.length
      ? `<span class="mt-0.5 flex gap-0.5 text-[9px] font-black text-neutral-500">${marks.join('')}</span>`
      : '';
    return `
      <div class="flex min-w-[2.75rem] flex-1 flex-col items-center gap-1" title="${esc(m.name)}">
        <span class="relative flex h-10 w-10 items-center justify-center rounded-full display text-sm
          ${m.logged ? 'ring-2 ring-green-400/70' : 'opacity-40 grayscale-[30%]'}"
          style="background:${color}26;color:${color}"
          aria-label="${esc(m.name)}: ${m.logged ? 'logged today' : 'not yet'}">
          ${initial}
          ${m.logged
            ? '<span class="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-400 ring-2 ring-card"></span>'
            : ''}
        </span>
        <span class="max-w-[3.5rem] truncate text-[10px] font-bold
          ${m.logged ? 'text-neutral-300' : 'text-neutral-600'}">${esc(m.name)}</span>
        ${markHtml}
      </div>`;
  }).join('');
  return `
    <div class="mb-2 flex items-center justify-between">
      <h3 class="eyebrow">Today on the board</h3>
      <span class="text-[11px] font-bold text-neutral-500">${nLogged}/${board.length} logged</span>
    </div>
    <div class="flex flex-wrap gap-2">${chips}</div>`;
}

// Personal CTA when the current user has nothing logged today. Banter voice,
// not a guilt trip; disappears on the next snapshot after they save anything.
function logNudgeHtml(state, today) {
  const me = state.currentUser;
  if (!me || loggedToday(state.entries, me.id, today)) return '';
  const line = logNudgeLine(`${me.id}|${today}|nudge`);
  return `
    <div class="flex flex-col gap-3">
      <p class="text-sm leading-snug text-neutral-200">${esc(line)}</p>
      <button type="button" id="log-nudge-cta"
        class="pressable w-full rounded-xl bg-accent py-3 display text-lg tracking-wide text-black active:bg-accentDim">
        LOG SOMETHING</button>
    </div>`;
}

function isIosLike() {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// One-time install + push coach. Dismiss persists in localStorage.
function pushCoachHtml(state) {
  const me = state.currentUser;
  if (!me) return '';
  let dismissed = false;
  try { dismissed = localStorage.getItem(PUSH_COACH_KEY) === '1'; } catch { /* private mode */ }
  const show = shouldShowPushCoach({
    dismissed,
    pushEnabled: me.push?.enabled === true,
    everLogged: userHasLogged(state.entries, me.id),
    pushSupported: pushSupported()
  });
  if (!show) return '';
  const installStep = isIosLike()
    ? 'Share → Add to Home Screen'
    : 'Browser menu → Install app / Add to Home screen';
  const installed = pushSupported();
  return `
    <div class="flex flex-col gap-3">
      <div class="flex items-start justify-between gap-3">
        <h3 class="eyebrow">Stay in the fight</h3>
        <button type="button" id="push-coach-dismiss"
          class="shrink-0 text-xs font-bold text-neutral-500 px-1" aria-label="Dismiss">
          Got it</button>
      </div>
      <ol class="list-decimal pl-5 text-sm leading-relaxed text-neutral-300 space-y-1.5">
        <li>${installed
          ? 'App is installed. Nice.'
          : esc(installStep)}</li>
        <li>Open the <button type="button" id="push-coach-me"
          class="font-black text-accent underline-offset-2 hover:underline">Me</button> tab</li>
        <li>Turn on notifications so Aiden can nag you morning and night</li>
      </ol>
    </div>`;
}

// Chart empty states: banter voice + open the log sheet.
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

export function renderDashboard(container, state, {
  animate = false,
  onGoMe = null
} = {}) {
  const c = state.challenge;
  const today = todayStr();
  const monday = mondayOf(today);
  const nudge = logNudgeHtml(state, today);
  const coach = pushCoachHtml(state);
  let fx = 0;
  const nextFx = () => fx++;

  // Phase 3 order: log/status first, charts last. One report card only.
  container.innerHTML = `
    <div class="${animate ? 'fx-on ' : ''}flex flex-col gap-3 px-4 pt-5 safe-bottom">
      ${headerHtml(c, today)}
      ${card(todayBoardHtml(state, today), nextFx())}
      ${nudge ? card(nudge, nextFx(), 'log-nudge-card border-accent/30') : ''}
      ${coach ? card(coach, nextFx(), 'push-coach-card border-edge') : ''}
      ${today <= c.endDate ? card(challengeCard(state, today), nextFx()) : ''}
      ${card(reportCard(state, today), nextFx(), 'report-card')}
      ${card(tilesHtml(teamTiles(state.entries, state.users, monday)), nextFx())}
      <section id="workouts-card" class="fx-card rounded-2xl bg-card border border-edge p-4" style="--fx-i:${nextFx()}">
        ${workoutsPanel(state, monday)}
      </section>
      ${card(`<h3 class="mb-2 eyebrow">Recent activity</h3><div id="feed"></div>`, nextFx())}
      ${card(`<h3 class="mb-2 eyebrow">Weight (kg)</h3>
        <div class="relative h-56"><canvas id="weight-chart"></canvas></div>
        <div id="weight-empty" class="hidden mt-2">${chartEmptyHtml('weight')}</div>`, nextFx())}
      ${card(`<h3 class="mb-2 eyebrow">Team steps · daily</h3>
        <div class="relative h-56"><canvas id="steps-chart"></canvas></div>
        <div id="steps-empty" class="hidden mt-2">${chartEmptyHtml('steps')}</div>`, nextFx())}
    </div>`;

  renderFeed(container.querySelector('#feed'), state.entries, state.users, state.banter);
  bindThreads(container, state.banter);
  initWorkoutTooltip(container.querySelector('#workouts-card'));
  if (animate) runCountUps(container);

  container.querySelector('#log-nudge-cta')?.addEventListener('click', () => openLogModal());
  container.querySelectorAll('[data-log-empty]').forEach(btn =>
    btn.addEventListener('click', () => openLogModal()));

  container.querySelector('#push-coach-dismiss')?.addEventListener('click', () => {
    try { localStorage.setItem(PUSH_COACH_KEY, '1'); } catch { /* ignore */ }
    container.querySelector('.push-coach-card')?.remove();
  });
  container.querySelector('#push-coach-me')?.addEventListener('click', () => {
    if (typeof onGoMe === 'function') onGoMe();
  });

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
