// App-wide constants. firebaseConfig is filled in by the infra task.
export const APP_PASSWORD = 'LIFT2026';

// Categorical palette chosen for distinctness on a dark background.
export const PALETTE = [
  '#f97316', // orange
  '#22d3ee', // cyan
  '#a3e635', // lime
  '#e879f9', // fuchsia
  '#facc15', // yellow
  '#60a5fa', // blue
  '#f472b6', // pink
  '#34d399', // emerald
  '#c084fc', // purple
  '#fb7185'  // rose
];

export const WORKOUT_PARTS = [
  'arms', 'shoulders', 'legs', 'chest', 'back', 'core', 'full body', 'stretching'
];

// REPLACED BY INFRA TASK with the real project's web app config.
export const firebaseConfig = null;
