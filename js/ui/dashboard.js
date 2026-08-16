import { userHasLogged } from '../lib/aggregate.js';
import {
  dailyChallenge, challengeDoneOn, challengeStreak,
  challengeNudgeCard, challengeTickLabel
} from '../lib/challenge.js';
import { todayStr, mondayOf, weekNumber, totalWeeks, parseLocal } from '../lib/dates.js';
import {
  templateReport, reportFresh
} from '../lib/report.js';
import {
  REPORT_TARGET, reportPreviewMessages, latestReportBody,
  visibleMessages, clipCoachPreviewText
} from '../lib/threads.js';
import { shouldShowPushCoach, PUSH_COACH_KEY } from '../lib/push-coach.js';
import { saveEntry } from '../firebase.js';
import { pushSupported } from '../push.js';
import { renderFeed } from './feed.js';
import { esc } from '../lib/esc.js';
import { runCountUps, burstFrom } from './fx.js';
import { threadBlockHtml, bindThreads } from './thread.js';
import {
  card, workoutsPanel, initWorkoutTooltip, trendCardsHtml, bindChartEmpties,
  bindTrendLegend, trendVisibleUserIds
} from './stats.js';

// After a successful snack tick, keep the pair in the tree for one collapse
// animation. Snapshot re-renders must not yank it mid-motion.
let snackCollapseActive = false;

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

function reducedMotion() {
  return typeof window !== 'undefined'
    && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
}

// Two equal cards: snack + nudge. Hidden after this user ticks today.
function snackPairHtml(state, today, fx) {
  const ch = dailyChallenge(today, state.challenge.startDate);
  const me = state.currentUser;
  const meDone = challengeDoneOn(state.entries, today).includes(me.id);
  if (today > state.challenge.endDate) return '';
  if (meDone && !snackCollapseActive) return '';

  const myStreak = challengeStreak(state.entries, me.id, today);
  const tick = challengeTickLabel(today);
  const nudge = challengeNudgeCard(today, ch.name);
  const collapsing = meDone && snackCollapseActive;
  return `<div id="snack-pair" class="flex gap-2 items-stretch${collapsing ? ' snack-pair-collapse' : ''}">
    ${card(`
      <div class="flex items-center justify-between gap-2">
        <h3 class="eyebrow">Daily snack</h3>
        ${myStreak >= 2 ? `<span class="text-xs font-black text-accent"><span class="flame">🔥</span> ${myStreak}</span>` : ''}
      </div>
      <p class="mt-1 display text-2xl tracking-tight heat-text leading-none">${ch.reps} ${esc(ch.name.toUpperCase())}</p>
      <button id="challenge-done" class="pressable mt-3 w-full rounded-xl bg-accent py-2.5 display text-base tracking-wide
        text-black active:bg-accentDim">${esc(tick.toUpperCase())}</button>
    `, fx, 'flex-1 min-w-0')}
    ${card(`
      <h3 class="eyebrow">${esc(nudge.eyebrow)}</h3>
      <p class="mt-2 text-sm leading-snug text-neutral-300">${esc(nudge.text)}</p>
    `, fx, 'flex-1 min-w-0')}
  </div>`;
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

  container.innerHTML = `
    <div class="${animate ? 'fx-on ' : ''}flex flex-col gap-3 px-4 pt-5 safe-bottom">
      ${headerHtml(c, today)}
      ${coach ? card(coach, nextFx(), 'push-coach-card border-edge') : ''}
      ${snackPairHtml(state, today, nextFx())}
      <section id="workouts-card" class="fx-card rounded-2xl bg-card border border-edge p-4" style="--fx-i:${nextFx()}">
        ${workoutsPanel(state, monday)}
      </section>
      ${card(reportCard(state, today), nextFx(), 'report-card')}
      ${trendCardsHtml(state, nextFx())}
      ${card(`<h3 class="mb-2 eyebrow">Recent activity</h3><div id="feed"></div>`, nextFx())}
    </div>`;

  renderFeed(container.querySelector('#feed'), state.entries, state.users, state.banter);
  bindThreads(container, state.banter);
  initWorkoutTooltip(container.querySelector('#workouts-card'));
  bindChartEmpties(container);
  bindTrendLegend(container, state);
  import('../charts.js').then(m => m.drawCharts(state, {
    animate, visibleUserIds: trendVisibleUserIds()
  })).catch(() => {});
  if (animate) runCountUps(container);

  const pair = container.querySelector('#snack-pair');
  if (pair?.classList.contains('snack-pair-collapse')) {
    pair.addEventListener('animationend', () => {
      snackCollapseActive = false;
      pair.remove();
    }, { once: true });
  }

  container.querySelector('#push-coach-dismiss')?.addEventListener('click', () => {
    try { localStorage.setItem(PUSH_COACH_KEY, '1'); } catch { /* ignore */ }
    container.querySelector('.push-coach-card')?.remove();
  });
  container.querySelector('#push-coach-me')?.addEventListener('click', () => {
    if (typeof onGoMe === 'function') onGoMe();
  });

  container.querySelector('#challenge-done')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'SAVING…';
    burstFrom(btn);
    snackCollapseActive = !reducedMotion();
    try {
      await saveEntry(state.currentUser.id, state.currentUser.name, todayStr(), { dailyChallenge: true });
    } catch (err) {
      console.error(err);
      snackCollapseActive = false;
      btn.disabled = false;
      btn.textContent = label;
    }
  });
}
