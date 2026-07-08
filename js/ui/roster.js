import { loginAs, signup } from '../state.js';
import { esc, safeColor } from '../lib/esc.js';

export function renderRoster(container, users, onLoggedIn) {
  const names = users.map(u => `
    <button data-id="${u.id}" class="roster-name w-full rounded-xl bg-card border border-edge
      px-4 py-4 text-lg font-bold text-left active:border-accent"
      style="border-left: 4px solid ${safeColor(u.color)}">${esc(u.name)}</button>`).join('');

  container.innerHTML = `
    <div class="flex min-h-screen flex-col justify-center gap-6 px-6 py-10 max-w-sm mx-auto">
      <h2 class="text-2xl font-black">Who are you?</h2>
      <div class="flex flex-col gap-3">${names || '<p class="text-neutral-500">No members yet.</p>'}</div>
      <button id="new-user" class="w-full rounded-xl border-2 border-dashed border-edge py-4
        text-lg font-bold text-neutral-400 active:border-accent">+ I'm new</button>
      <div id="roster-sub"></div>
    </div>`;

  const sub = container.querySelector('#roster-sub');

  container.querySelectorAll('.roster-name').forEach(btn => {
    btn.addEventListener('click', () => {
      const user = users.find(u => u.id === btn.dataset.id);
      sub.innerHTML = `
        <form id="pin-form" class="mt-2 flex gap-3">
          <input id="pin-in" type="password" inputmode="numeric" maxlength="4" placeholder="PIN"
            class="flex-1 rounded-xl bg-card border border-edge px-4 py-4 text-lg text-center" autofocus>
          <button class="rounded-xl bg-accent px-6 font-bold text-black">GO</button>
        </form>
        <p id="pin-err" class="hidden mt-2 text-sm text-red-400">Wrong PIN</p>`;
      sub.querySelector('#pin-form').addEventListener('submit', (ev) => {
        ev.preventDefault();
        if (loginAs(user, sub.querySelector('#pin-in').value)) onLoggedIn();
        else sub.querySelector('#pin-err').classList.remove('hidden');
      });
    });
  });

  container.querySelector('#new-user').addEventListener('click', () => {
    sub.innerHTML = `
      <form id="signup-form" class="mt-2 flex flex-col gap-3">
        <input id="su-name" type="text" placeholder="First name" maxlength="20" required
          class="rounded-xl bg-card border border-edge px-4 py-4 text-lg">
        <input id="su-pin" type="password" inputmode="numeric" pattern="\\d{4}" maxlength="4"
          placeholder="Choose a 4-digit PIN" required
          class="rounded-xl bg-card border border-edge px-4 py-4 text-lg text-center">
        <p id="su-warn" class="hidden text-sm text-amber-400"></p>
        <button class="rounded-xl bg-accent py-4 text-lg font-bold text-black">JOIN</button>
      </form>`;
    const form = sub.querySelector('#signup-form');
    form.querySelector('#su-name').addEventListener('input', (ev) => {
      const dup = users.some(u => u.name.toLowerCase() === ev.target.value.trim().toLowerCase());
      const warn = sub.querySelector('#su-warn');
      warn.textContent = dup ? 'That name is taken — add an initial so we can tell you apart.' : '';
      warn.classList.toggle('hidden', !dup);
    });
    let submitting = false;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (submitting) return;
      submitting = true;
      const btn = form.querySelector('button');
      btn.disabled = true;
      const warn = sub.querySelector('#su-warn');
      try {
        await signup(form.querySelector('#su-name').value, form.querySelector('#su-pin').value);
        onLoggedIn();
      } catch (err) {
        submitting = false;
        btn.disabled = false;
        warn.textContent = 'Could not create your profile — try again.';
        warn.classList.remove('hidden');
      }
    });
  });
}
