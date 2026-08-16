import { weightSeries, stepsMatrix, chartWindow } from './lib/aggregate.js';

// Tight y-window so the small dash cards show shape, not a flat band.
// No tick labels, so exact kg stays unreadable.
function trendWeightBounds(kgValues) {
  const lo = Math.min(...kgValues);
  const hi = Math.max(...kgValues);
  const pad = Math.max(1.5, (hi - lo) * 0.25);
  return { min: lo - pad, max: hi + pad };
}
import { todayStr, formatShort, dateRange } from './lib/dates.js';

let weightChart = null;
let stepsChart = null;

const GRID = 'rgba(255,255,255,0.06)';

const baseOpts = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  layout: { padding: 0 },
  plugins: {
    legend: { display: false }
  }
};

// Entrance-only animation: charts sweep in when the user actually navigates
// to the view; Firestore snapshot redraws stay instant. Reduced motion always
// stays instant.
const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const entranceAnimation = (animate) =>
  animate && !reducedMotion() ? { duration: 800, easing: 'easeOutQuart' } : false;

export function drawCharts(state, { animate = false, visibleUserIds = null } = {}) {
  // Chart.js is loaded with `defer`; a cache-primed first render can beat it.
  // Wait for its script to land, then draw (the next render also redraws).
  if (typeof Chart === 'undefined') {
    document.querySelector('script[src*="chart.umd"]')
      ?.addEventListener('load', () => drawCharts(state, { animate, visibleUserIds }), { once: true });
    return;
  }
  drawWeight(state, animate, visibleUserIds);
  drawSteps(state, animate, visibleUserIds);
}

function isVisible(id, visibleUserIds) {
  return visibleUserIds == null || visibleUserIds.includes(id);
}

function drawWeight(state, animate, visibleUserIds) {
  const canvas = document.getElementById('weight-chart');
  if (!canvas) return;
  weightChart?.destroy();

  const { start, end } = chartWindow(state.entries, state.challenge, todayStr());
  const dates = dateRange(start, end);
  const series = weightSeries(state.entries, state.users, state.challenge)
    .filter(s => isVisible(s.userId, visibleUserIds));

  const empty = document.getElementById('weight-empty');
  canvas.parentElement.classList.toggle('hidden', series.length === 0);
  empty?.classList.toggle('hidden', series.length > 0);
  if (series.length === 0) return;

  // Tooltips show change vs each user's first weigh-in, never absolute kg —
  // the coarse 10 kg axis ticks keep exact weights unreadable.
  const firstKg = new Map(series.map(s => [s.name, s.points[0].kg]));

  weightChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: dates,
      datasets: series.map(s => {
        const byDate = new Map(s.points.map(p => [p.date, p.kg]));
        return {
          label: s.name,
          data: dates.map(d => byDate.get(d) ?? null),
          borderColor: s.color,
          backgroundColor: s.color,
          spanGaps: true,
          borderWidth: 2.2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.4
        };
      })
    },
    options: {
      ...baseOpts,
      animation: entranceAnimation(animate),
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        ...baseOpts.plugins,
        tooltip: {
          callbacks: {
            title: (items) => formatShort(dates[items[0].dataIndex]),
            label: (item) => {
              const d = Math.round((item.parsed.y - firstKg.get(item.dataset.label)) * 10) / 10;
              return ` ${item.dataset.label}: ${d > 0 ? '+' : ''}${d} kg vs start`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { display: false }
        },
        y: {
          ...trendWeightBounds(series.flatMap(s => s.points.map(p => p.kg))),
          grid: { color: GRID },
          ticks: { display: false }
        }
      }
    }
  });
}

function drawSteps(state, animate, visibleUserIds) {
  const canvas = document.getElementById('steps-chart');
  if (!canvas) return;
  stepsChart?.destroy();

  const m = stepsMatrix(state.entries, state.users, state.challenge, todayStr());
  m.series = m.series.filter(s => isVisible(s.userId, visibleUserIds));
  const hasData = m.series.some(s => s.values.some(v => v != null));

  const empty = document.getElementById('steps-empty');
  canvas.parentElement.classList.toggle('hidden', !hasData);
  empty?.classList.toggle('hidden', hasData);
  if (!hasData) return;

  stepsChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: m.dates,
      datasets: m.series.map(s => ({
        label: s.name,
        data: s.values.map(v => v ?? 0),
        backgroundColor: s.color,
        borderRadius: 2,
        stack: 'team'
      }))
    },
    options: {
      ...baseOpts,
      animation: entranceAnimation(animate),
      plugins: {
        ...baseOpts.plugins,
        tooltip: {
          callbacks: {
            title: (items) => formatShort(m.dates[items[0].dataIndex]),
            label: (item) => item.parsed.y > 0 ? ` ${item.dataset.label}: ${item.parsed.y.toLocaleString()}` : null
          }
        }
      },
      scales: {
        x: {
          stacked: true, grid: { display: false },
          ticks: { display: false }
        },
        y: {
          stacked: true, grid: { color: GRID },
          ticks: { display: false }
        }
      }
    }
  });
}
