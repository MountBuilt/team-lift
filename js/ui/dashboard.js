import { userHasLogged } from '../lib/aggregate.js';
import { weeklyAwards, AWARD_LABELS } from '../lib/awards.js';
import { dailyChallenge, challengeDoneOn, challengeStreak } from '../lib/challenge.js';
import { todayStr, mondayOf, addDays, weekNumber, totalWeeks, parseLocal } from '../lib/dates.js';
import {
  pickFrom, CHALLENGE_QUIPS, todayBoardMembers
} from '../lib/banter.js';
import {
  templateReport, reportFresh, templateWeeklyReport, weeklyReportFresh
} from '../lib/report.js';
import {
  REPORT_TARGET, WEEKLY_TARGET, reportPreviewMessages, latestReportBody,
  visibleMessages, clipCoachPreviewText
} from '../lib/threads.js';
import { shouldShowPushCoach, PUSH_COACH_KEY } from '../lib/push-coach.js';
import { saveEntry } from '../firebase.js';
import { pushSupported } from '../push.js';
import { renderFeed } from './feed.js';
import { esc, safeColor } from '../lib/esc.js';
import { runCountUps, burstFrom, compactNumber } from './fx.js';
import { threadBlockHtml, bindThreads } from './thread.js';

// One-shot celebration: set when the user ticks the challenge, consumed by
// the next render so the DONE stamp slams in exactly once.
let celebratePending = false;

const card = (inner, i, extra = '') =>
  `<section class="fx-card rounded-2xl bg-card border border-edge p-4 ${extra}" style="--fx-i:${i}">${inner}</section>`;

// Plain coach line (daily challenge quip — not threaded).
const coach = (comment) => comment ? `<p class="coach">${esc(comment)}</p>` : '';

/**
 * Coach chat home card: last 3 messages in the continuous report thread.
 * Morning report is just another bubble (role:report). Offline / pre-tick
 * falls back to template or banter.report as a synthetic preview line.
 * Expanded thread opens at the bottom with load-earlier windowing.
 */
function reportCard(state, today) {
  const banter = state.banter;
  const thread = banter?.threads?.[REPORT_TARGET];
  const n = visibleMessages(thread).length;
  const preview = reportPreviewMessages(thread);
  let lines = preview.messages;
  if (lines.length === 0) {
    let body = null;
    if (reportFresh(banter?.report, today)) body = banter.report.text;
    else body = latestReportBody(banter, today);
    if (!body) {
      body = templateReport(
        state.entries, state.users, today,
        dailyChallenge(today, state.challenge.startDate)
      );
    }
    lines = [{ kind: 'aiden', name: 'Aiden', text: body, role: 'report' }];
  }
  const previewHtml = `<div class="coach-preview-lines space-y-2">
    ${lines.map(m => {
      const who = m.kind === 'aiden' ? 'Aiden' : (m.name || 'mate');
      const cls = m.kind === 'aiden' ? 'text-accent' : 'text-neutral-300';
      const tag = m.role === 'report'
        ? `<span class="coach-report-tag">report</span>`
        : '';
      return `<p class="coach-preview-line text-sm leading-snug">
        <span class="font-black ${cls}">${esc(who)}</span>${tag}
        <span class="text-neutral-400"> ${esc(clipCoachPreviewText(m.text))}</span>
      </p>`;
    }).join('')}
  </div>`;
  const openHint = n > 0
    ? `<p class="mt-2 text-[11px] font-bold text-neutral-500">Tap to open chat · ${n} in thread</p>`
    : `<p class="mt-2 text-[11px] font-bold text-neutral-500">Tap to open chat</p>`;
  return `
    <div class="flex items-center justify-between">
      <h3 class="eyebrow">Coach chat</h3>
      <span class="eyebrow text-neutral-600">${n > 0 ? `${n} msgs` : 'live'}</span>
    </div>
    ${threadBlockHtml(REPORT_TARGET, previewHtml + openHint, banter, {
      parentClass: 'report-parent coach-preview',
      hideCount: true
    })}`;
}

/** Sunday week recap (AI or template). Thread target `weekly`. */
function weeklyCard(state, today) {
  const stored = state.banter?.weeklyReport;
  const mon = mondayOf(today);
  const isSunday = today === addDays(mon, 6);
  const fresh = weeklyReportFresh(stored, today);
  // Fresh AI recap (this or last week), or Sunday template until the tick lands.
  if (!fresh && !isSunday) return '';
  const text = (fresh && stored?.text)
    ? stored.text
    : templateWeeklyReport(state.entries, state.users, today);
  const label = (stored?.weekKey === mon || isSunday) ? 'This week' : 'Last week';
  return `
    <div class="flex items-center justify-between">
      <h3 class="eyebrow">Aiden's week recap</h3>
      <span class="eyebrow text-neutral-600">${esc(label)}</span>
    </div>
    ${threadBlockHtml(WEEKLY_TARGET, esc(text), state.banter, { parentClass: 'report-parent' })}`;
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

// Client-only podium for this Mon–Sun. Never shows absolute kg.
function awardsHtml(state, monday) {
  const awards = weeklyAwards(state.entries, state.users, monday);
  const keys = ['steps', 'workouts', 'challenge', 'consistency'];
  const any = keys.some(k => awards[k]);
  if (!any) {
    return `
      <h3 class="eyebrow">This week's podium</h3>
      <p class="mt-2 text-sm text-neutral-400">Nobody's on it yet. Log something and start climbing.</p>`;
  }
  const fmt = (key, w) => {
    if (key === 'steps') return compactNumber(w.value);
    return String(w.value);
  };
  const rows = keys.map(key => {
    const w = awards[key];
    if (!w) {
      return `
        <div class="flex items-center justify-between gap-2 py-2 border-b border-edge/50 last:border-0">
          <span class="text-xs font-bold text-neutral-500">${esc(AWARD_LABELS[key])}</span>
          <span class="text-xs text-neutral-600">—</span>
        </div>`;
    }
    const color = safeColor(w.color);
    return `
      <div class="flex items-center justify-between gap-2 py-2 border-b border-edge/50 last:border-0">
        <span class="text-xs font-bold text-neutral-500">${esc(AWARD_LABELS[key])}</span>
        <span class="text-sm font-black truncate" style="color:${color}">
          ${esc(w.name)} <span class="text-neutral-500 font-bold">· ${fmt(key, w)}</span>
        </span>
      </div>`;
  }).join('');
  return `
    <h3 class="mb-1 eyebrow">This week's podium</h3>
    ${rows}`;
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

export function renderDashboard(container, state, {
  animate = false,
  onGoMe = null
} = {}) {
  const c = state.challenge;
  const today = todayStr();
  const monday = mondayOf(today);
  const coach = pushCoachHtml(state);
  let fx = 0;
  const nextFx = () => fx++;

  // Status + Aiden + feed. Scoreboard charts/tiles live on the Stats tab.
  container.innerHTML = `
    <div class="${animate ? 'fx-on ' : ''}flex flex-col gap-3 px-4 pt-5 safe-bottom">
      ${headerHtml(c, today)}
      ${card(todayBoardHtml(state, today), nextFx())}
      ${coach ? card(coach, nextFx(), 'push-coach-card border-edge') : ''}
      ${today <= c.endDate ? card(challengeCard(state, today), nextFx()) : ''}
      ${card(reportCard(state, today), nextFx(), 'report-card')}
      ${(() => {
        const w = weeklyCard(state, today);
        return w ? card(w, nextFx(), 'weekly-card') : '';
      })()}
      ${card(awardsHtml(state, monday), nextFx(), 'awards-card')}
      ${card(`<h3 class="mb-2 eyebrow">Recent activity</h3><div id="feed"></div>`, nextFx())}
    </div>`;

  renderFeed(container.querySelector('#feed'), state.entries, state.users, state.banter);
  bindThreads(container, state.banter);
  if (animate) runCountUps(container);

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
}
