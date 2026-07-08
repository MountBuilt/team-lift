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
  'arms', 'shoulders', 'legs', 'chest', 'back', 'core', 'full body', 'cardio', 'swimming', 'stretching'
];

// Real project web app config (public client identifiers, not secrets).
export const firebaseConfig = {
  apiKey: 'AIzaSyAWOzfMn7YjxaqSr2qx6zTLRE0_xs9VpZI',
  authDomain: 'team-lift-app.firebaseapp.com',
  projectId: 'team-lift-app',
  storageBucket: 'team-lift-app.firebasestorage.app',
  messagingSenderId: '392861872242',
  appId: '1:392861872242:web:673bb846b9e7cc508d92eb'
};
