// Motion helpers for the UI layer. DOM-only, no Firebase, no data logic.
// Everything here degrades to nothing under prefers-reduced-motion.

export const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// Animate every [data-countup] number in `container` from 0 to its value.
// Elements carry the finished text already (so no-JS/reduced-motion is
// correct by default); we only take over the text while the count runs.
export function runCountUps(container) {
  if (reducedMotion()) return;
  container.querySelectorAll('[data-countup]').forEach(el => {
    const target = Number(el.dataset.countup);
    if (!Number.isFinite(target) || target <= 0) return;
    const finished = el.textContent;
    const t0 = performance.now();
    const dur = 900;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      if (p < 1) {
        el.textContent = format(Math.round(target * eased), el.dataset.fmt);
        requestAnimationFrame(tick);
      } else {
        el.textContent = finished;
      }
    };
    requestAnimationFrame(tick);
  });
}

function format(n, fmt) {
  if (fmt === 'compact') return compactNumber(n);
  if (fmt === 'plain') return String(n);
  return n.toLocaleString('en-AU');
}

// 999 -> "999", 12345 -> "12.3k", 1200000 -> "1.2m"
export function compactNumber(n) {
  if (n >= 1000000) return `${trim1(n / 1000000)}m`;
  if (n >= 10000) return `${trim1(n / 1000)}k`;
  return n.toLocaleString('en-AU');
}
const trim1 = (x) => (Math.round(x * 10) / 10).toFixed(1).replace(/\.0$/, '');

// Ember confetti burst from an element (celebrations only). WAAPI so the
// pieces clean themselves up; capped and skipped under reduced motion.
const CONFETTI_COLORS = ['#f97316', '#fbbf24', '#4ade80', '#fafafa', '#fb7185'];

export function burstFrom(el, count = 26) {
  if (reducedMotion() || !el?.animate) return;
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    piece.style.left = `${cx}px`;
    piece.style.top = `${cy}px`;
    document.body.appendChild(piece);
    const angle = Math.random() * Math.PI * 2;
    const dist = 60 + Math.random() * 130;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 90;
    const spin = (Math.random() - 0.5) * 720;
    const anim = piece.animate([
      { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
      { transform: `translate(${dx}px, ${dy + 160}px) rotate(${spin}deg)`, opacity: 0 }
    ], {
      duration: 800 + Math.random() * 500,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'forwards'
    });
    anim.onfinish = () => piece.remove();
  }
  navigator.vibrate?.(30);
}
