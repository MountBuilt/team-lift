import { saveEntry } from '../firebase.js';
import { state } from '../state.js';
import { todayStr } from '../lib/dates.js';
import { WORKOUT_PARTS } from '../config.js';
import { esc } from '../lib/esc.js';

export function mountFab(onClick) {
  if (document.getElementById('fab')) return;
  const fab = document.createElement('button');
  fab.id = 'fab';
  fab.textContent = '+';
  fab.className = `fixed bottom-6 right-6 z-40 h-16 w-16 rounded-full text-4xl
    font-black text-black shadow-lg shadow-accent/40`;
  fab.setAttribute('aria-label', 'Log an entry');
  fab.addEventListener('click', onClick);
  document.body.appendChild(fab);
}

// The FAB lives on document.body, so it survives app.innerHTML swaps. Hide it
// on non-main screens (gate/roster/loading) — e.g. after logout.
export function setFabVisible(visible) {
  document.getElementById('fab')?.classList.toggle('hidden', !visible);
}

export function openLogModal(dateStr = todayStr()) {
  document.getElementById('log-modal')?.remove();
  const user = state.currentUser;
  const existing = state.entries.find(e => e.userId === user.id && e.date === dateStr);
  const parts = new Set(existing?.workoutParts || []);

  const chip = (p) => `
    <button type="button" data-part="${p}" class="part-chip rounded-full border px-4 py-2 text-sm font-bold
      ${parts.has(p) ? 'border-accent bg-accent text-black' : 'border-edge bg-card text-neutral-300'}">
      ${p}</button>`;

  const modal = document.createElement('div');
  modal.id = 'log-modal';
  modal.className = 'sheet-backdrop fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70';
  modal.innerHTML = `
    <form id="log-form" class="sheet w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-card border border-edge
      p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between">
        <h3 class="display text-2xl tracking-wide">LOG IT</h3>
        <button type="button" id="log-close" class="text-2xl text-neutral-500 px-2">✕</button>
      </div>
      <label class="flex flex-col gap-1 text-sm font-bold text-neutral-400">Date
        <input id="log-date" type="date" value="${esc(dateStr)}" max="${todayStr()}"
          class="rounded-xl bg-ink border border-edge px-4 py-3 text-lg text-neutral-100">
      </label>
      <label class="flex flex-col gap-1 text-sm font-bold text-neutral-400">Weight (kg)
        <input id="log-weight" type="number" step="0.1" min="30" max="300" inputmode="decimal"
          value="${esc(existing?.weight ?? '')}" placeholder="—"
          class="rounded-xl bg-ink border border-edge px-4 py-3 text-lg">
      </label>
      <label class="flex flex-col gap-1 text-sm font-bold text-neutral-400">Steps
        <input id="log-steps" type="number" step="1" min="0" max="200000" inputmode="numeric"
          value="${esc(existing?.steps ?? '')}" placeholder="—"
          class="rounded-xl bg-ink border border-edge px-4 py-3 text-lg">
      </label>
      <div class="flex flex-col gap-2">
        <span class="text-sm font-bold text-neutral-400">Workout</span>
        <div class="flex flex-wrap gap-2">${WORKOUT_PARTS.map(chip).join('')}</div>
      </div>
      <p id="log-err" class="hidden text-sm text-red-400">Couldn't save. Check your connection and try again.</p>
      <button id="log-save" class="pressable rounded-xl bg-accent py-4 display text-xl tracking-wide text-black active:bg-accentDim">
        SAVE</button>
    </form>`;

  document.body.appendChild(modal);
  document.body.classList.add('modal-open');
  const close = () => { modal.remove(); document.body.classList.remove('modal-open'); };
  modal.addEventListener('click', (ev) => { if (ev.target === modal) close(); });
  modal.querySelector('#log-close').addEventListener('click', close);

  modal.querySelectorAll('.part-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.part;
      parts.has(p) ? parts.delete(p) : parts.add(p);
      btn.className = btn.className.replace(
        parts.has(p) ? 'border-edge bg-card text-neutral-300' : 'border-accent bg-accent text-black',
        parts.has(p) ? 'border-accent bg-accent text-black' : 'border-edge bg-card text-neutral-300');
      if (parts.has(p)) {
        btn.classList.remove('chip-pop');
        void btn.offsetWidth; // restart the pop if re-selected quickly
        btn.classList.add('chip-pop');
      }
    });
  });

  // Reload prefill when the date changes.
  modal.querySelector('#log-date').addEventListener('change', (ev) => {
    close();
    openLogModal(ev.target.value);
  });

  modal.querySelector('#log-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fields = {};
    const w = modal.querySelector('#log-weight').value;
    const s = modal.querySelector('#log-steps').value;
    // Blank inputs are omitted (never overwrite); a value that was prefilled
    // and then cleared becomes an explicit null (field cleared).
    if (w !== '') fields.weight = Number(w);
    else if (existing?.weight != null) fields.weight = null;
    if (s !== '') fields.steps = Number(s);
    else if (existing?.steps != null) fields.steps = null;
    if (parts.size > 0 || (existing?.workoutParts?.length ?? 0) > 0) {
      fields.workoutParts = [...parts];
    }
    if (Object.keys(fields).length === 0) { close(); return; }
    const btn = modal.querySelector('#log-save');
    btn.disabled = true;
    btn.textContent = 'SAVING…';
    try {
      await saveEntry(user.id, user.name, modal.querySelector('#log-date').value, fields);
      close();
    } catch (err) {
      console.error(err);
      modal.querySelector('#log-err').classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'SAVE';
    }
  });
}
