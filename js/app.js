import { APP_PASSWORD } from './config.js';

const app = document.getElementById('app');
app.innerHTML = `
  <div class="flex min-h-screen items-center justify-center">
    <h1 class="text-3xl font-black tracking-tight">TEAM <span class="text-accent">LIFT</span></h1>
  </div>`;
console.log('scaffold ok, password constant loaded:', APP_PASSWORD.length > 0);
