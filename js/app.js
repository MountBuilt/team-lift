import { state, restoreSession, logout } from './state.js';
import { subscribeAll } from './firebase.js';
import { renderGate } from './ui/gate.js';
import { renderRoster } from './ui/roster.js';
import { mountFab, openLogModal, setFabVisible } from './ui/logmodal.js';
import { renderDashboard } from './ui/dashboard.js';
import { renderStats } from './ui/stats.js';
import { renderMe } from './ui/me.js';

const app = document.getElementById('app');
let unsubscribe = null;
let started = false;

// Entrance choreography plays on a real visit (first paint of a tab, or a
// tab switch), never on Firestore snapshot re-renders. `lastShownTab` is the
// tab whose entrance has already played.
let lastShownTab = null;

function renderLoading() {
  app.innerHTML = `<div class="flex min-h-screen items-center justify-center">
    <p class="animate-pulse display text-lg tracking-widest text-neutral-600">LOADING THE BOARD…</p></div>`;
}

function renderMain() {
  mountFab(() => openLogModal());
  setFabVisible(true);
  const tab = state.tab || 'dash';
  const animate = tab !== lastShownTab;
  lastShownTab = tab;
  // Snapshot re-renders used to jump scroll to top / mid-page. Keep position
  // when we are only refreshing live data on the same tab (Phase 4.5).
  const scrollY = animate ? 0 : window.scrollY;
  if (animate) window.scrollTo(0, 0);
  app.innerHTML = `
    <nav class="sticky top-0 z-30 flex border-b border-edge bg-ink/90 backdrop-blur safe-top" role="tablist" aria-label="Main">
      <button type="button" data-tab="dash" role="tab" aria-selected="${tab === 'dash'}"
        class="tab flex-1 py-3.5 display text-[11px] tracking-[0.14em]
        ${tab === 'dash' ? 'text-accent border-b-2 border-accent' : 'text-neutral-500'}">DASH</button>
      <button type="button" data-tab="stats" role="tab" aria-selected="${tab === 'stats'}"
        class="tab flex-1 py-3.5 display text-[11px] tracking-[0.14em]
        ${tab === 'stats' ? 'text-accent border-b-2 border-accent' : 'text-neutral-500'}">STATS</button>
      <button type="button" data-tab="me" role="tab" aria-selected="${tab === 'me'}"
        class="tab flex-1 py-3.5 display text-[11px] tracking-[0.14em]
        ${tab === 'me' ? 'text-accent border-b-2 border-accent' : 'text-neutral-500'}">ME</button>
    </nav>
    <main id="view"></main>`;
  app.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => {
    state.tab = b.dataset.tab;
    route();
  }));
  const view = app.querySelector('#view');
  if (tab === 'me') {
    renderMe(view, state, {
      onEdit: (date) => openLogModal(date),
      onLogout: () => { logout(); state.tab = 'dash'; lastShownTab = null; route(); }
    }, { animate });
  } else if (tab === 'stats') {
    renderStats(view, state, { animate });
  } else {
    renderDashboard(view, state, {
      animate,
      onGoMe: () => { state.tab = 'me'; route(); }
    });
  }
  if (!animate && scrollY > 0) {
    // Restore after layout; rAF so charts/DOM height settle first.
    requestAnimationFrame(() => window.scrollTo(0, scrollY));
  }
}

export function route() {
  if (!state.passwordOk) { setFabVisible(false); return renderGate(app, route); }
  if (!started) {
    started = true;
    renderLoading();
    unsubscribe = subscribeAll((data) => {
      Object.assign(state, data);
      if (state.currentUser) {
        const fresh = state.users.find(u => u.id === state.currentUser.id);
        if (fresh) state.currentUser = fresh;
      } else if (state.savedUserId) {
        state.currentUser = state.users.find(u => u.id === state.savedUserId) || null;
      }
      route();
    });
    return;
  }
  if (!state.challenge) { setFabVisible(false); return renderLoading(); }
  if (!state.currentUser) { setFabVisible(false); return renderRoster(app, state.users, route); }
  renderMain();
}

restoreSession();
route();

// PWA: relative path keeps the scope correct under the GitHub Pages subpath.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
