import { checkPassword } from '../state.js';

export function renderGate(container, onSuccess) {
  container.innerHTML = `
    <div class="fx-on ember-bg flex min-h-screen flex-col items-center justify-center gap-8 px-6">
      <div class="fx-card text-center" style="--fx-i:0">
        <h1 class="display text-6xl tracking-tight">TEAM <span class="heat-text">LIFT</span></h1>
        <p class="mt-2 eyebrow">Members only. No excuses inside.</p>
      </div>
      <form id="gate-form" class="fx-card w-full max-w-xs flex flex-col gap-3" style="--fx-i:1">
        <input id="gate-pw" type="password" inputmode="text" placeholder="Team password"
          class="w-full rounded-xl bg-card border border-edge px-4 py-4 text-lg text-center
                 placeholder-neutral-500 focus:border-accent focus:outline-none" autofocus>
        <button class="pressable w-full rounded-xl bg-accent py-4 display text-xl tracking-wide text-black active:bg-accentDim">
          ENTER
        </button>
        <p id="gate-err" class="hidden text-center text-sm text-red-400">Wrong password</p>
      </form>
    </div>`;
  container.querySelector('#gate-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const ok = checkPassword(container.querySelector('#gate-pw').value);
    if (ok) onSuccess();
    else container.querySelector('#gate-err').classList.remove('hidden');
  });
}
