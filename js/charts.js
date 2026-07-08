import { weightSeries, stepsMatrix, chartWindow, weightAxisBounds } from './lib/aggregate.js';
import { todayStr, formatShort, dateRange } from './lib/dates.js';

let weightChart = null;
let stepsChart = null;

const GRID = 'rgba(255,255,255,0.06)';
const TICK = '#737373';

const baseOpts = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  plugins: {
    legend: {
      position: 'bottom',
      labels: { color: '#a3a3a3', boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'circle' }
    }
  }
};

export function drawCharts(state) {
  drawWeight(state);
  drawSteps(state);
}

function drawWeight(state) {
  const canvas = document.getElementById('weight-chart');
  if (!canvas) return;
  weightChart?.destroy();

  const { start, end } = chartWindow(state.entries, state.challenge, todayStr());
  const dates = dateRange(start, end);
  const series = weightSeries(state.entries, state.users, state.challenge);

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
          borderWidth: 2.5,
          pointRadius: 2,
          pointHoverRadius: 5,
          tension: 0.3
        };
      })
    },
    options: {
      ...baseOpts,
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
          ticks: {
            color: TICK, maxTicksLimit: 6, maxRotation: 0,
            callback: (v, i) => formatShort(dates[i]).slice(4) // "7 Jul"
          }
        },
        y: {
          ...weightAxisBounds(series.flatMap(s => s.points.map(p => p.kg))),
          grid: { color: GRID },
          ticks: { color: TICK, stepSize: 10, callback: (v) => `${v}` }
        }
      }
    }
  });
}

function drawSteps(state) {
  const canvas = document.getElementById('steps-chart');
  if (!canvas) return;
  stepsChart?.destroy();

  const m = stepsMatrix(state.entries, state.users, state.challenge, todayStr());
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
          ticks: {
            color: TICK, maxTicksLimit: 6, maxRotation: 0,
            callback: (v, i) => formatShort(m.dates[i]).slice(4)
          }
        },
        y: {
          stacked: true, grid: { color: GRID },
          ticks: { color: TICK, callback: (v) => v >= 1000 ? `${v / 1000}k` : v }
        }
      }
    }
  });
}
