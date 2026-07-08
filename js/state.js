import { APP_PASSWORD, PALETTE } from './config.js';
import { createUser } from './firebase.js';

export const state = {
  passwordOk: false,
  currentUser: null,   // { id, name, pin, color }
  users: [],
  entries: [],
  challenge: null
};

export function restoreSession() {
  state.passwordOk = localStorage.getItem('teamlift_pw_ok') === '1';
  state.savedUserId = localStorage.getItem('teamlift_userId') || null;
}

export function checkPassword(input) {
  if (input.trim() !== APP_PASSWORD) return false;
  state.passwordOk = true;
  localStorage.setItem('teamlift_pw_ok', '1');
  return true;
}

export function loginAs(user, pinInput) {
  if (String(pinInput).trim() !== String(user.pin)) return false;
  state.currentUser = user;
  localStorage.setItem('teamlift_userId', user.id);
  return true;
}

export async function signup(name, pin) {
  const color = PALETTE[state.users.length % PALETTE.length];
  const id = await createUser({ name: name.trim(), pin: String(pin).trim(), color });
  const user = { id, name: name.trim(), pin: String(pin).trim(), color };
  state.currentUser = user;
  localStorage.setItem('teamlift_userId', id);
  return user;
}

export function logout() {
  state.currentUser = null;
  localStorage.removeItem('teamlift_userId');
}
