import { state, restoreSession, logout } from './state.js';
import { subscribeAll } from './firebase.js';
import { renderGate } from './ui/gate.js';
import { renderRoster } from './ui/roster.js';
import { mountFab, openLogModal } from './ui/logmodal.js';
import { renderDashboard } from './ui/dashboard.js';
import { renderMe } from './ui/me.js';

const app = document.getElementById('app');
let unsubscribe = null;
let started = false;

function renderLoading() {
  app.innerHTML = `<div class="flex min-h-screen items-center justify-center">
    <p class="animate-pulse text-neutral-500 font-bold">LOADING…</p></div>`;
}

function renderMain() {
  mountFab(() => openLogModal());
  const tab = state.tab || 'dash';
  app.innerHTML = `
    <nav class="sticky top-0 z-30 flex border-b border-edge bg-ink/95 backdrop-blur">
      <button data-tab="dash" class="tab flex-1 py-4 text-sm font-black tracking-wide
        ${tab === 'dash' ? 'text-accent border-b-2 border-accent' : 'text-neutral-500'}">DASHBOARD</button>
      <button data-tab="me" class="tab flex-1 py-4 text-sm font-black tracking-wide
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
      onLogout: () => { logout(); state.tab = 'dash'; route(); }
    });
  } else {
    renderDashboard(view, state);
  }
}

export function route() {
  if (!state.passwordOk) return renderGate(app, route);
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
  if (!state.challenge) return renderLoading();
  if (!state.currentUser) return renderRoster(app, state.users, route);
  renderMain();
}

restoreSession();
route();
