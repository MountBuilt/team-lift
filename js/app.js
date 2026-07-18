import { state, restoreSession, logout } from './state.js';
import { subscribeAll } from './firebase.js';
import { renderGate } from './ui/gate.js';
import { renderRoster } from './ui/roster.js';
import { mountFab, openLogModal, setFabVisible } from './ui/logmodal.js';
import { renderDashboard } from './ui/dashboard.js';
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
  if (animate) window.scrollTo(0, 0);
  app.innerHTML = `
    <nav class="sticky top-0 z-30 flex border-b border-edge bg-ink/90 backdrop-blur">
      <button data-tab="dash" class="tab flex-1 py-4 display text-sm tracking-[0.18em]
        ${tab === 'dash' ? 'text-accent border-b-2 border-accent' : 'text-neutral-500'}">DASHBOARD</button>
      <button data-tab="me" class="tab flex-1 py-4 display text-sm tracking-[0.18em]
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
  } else {
    renderDashboard(view, state, { animate });
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
