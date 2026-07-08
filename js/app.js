import { state, restoreSession } from './state.js';
import { subscribeAll } from './firebase.js';
import { renderGate } from './ui/gate.js';
import { renderRoster } from './ui/roster.js';
import { mountFab, openLogModal } from './ui/logmodal.js';
import { esc } from './lib/esc.js';

const app = document.getElementById('app');
let unsubscribe = null;
let started = false;

function renderLoading() {
  app.innerHTML = `<div class="flex min-h-screen items-center justify-center">
    <p class="animate-pulse text-neutral-500 font-bold">LOADING…</p></div>`;
}

// Placeholder — replaced by the dashboard task.
function renderMain() {
  app.innerHTML = `<div class="p-6"><h1 class="text-2xl font-black">
    Hi ${esc(state.currentUser.name)} — dashboard coming next.</h1></div>`;
  mountFab(() => openLogModal());
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
