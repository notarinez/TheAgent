import { $$ } from './util.js';
import { loadSettings } from './store.js';
import { initHome, enterHome, leaveHome, reminderFired } from './home.js';
import { initNotes, render as renderNotes } from './views/notes.js';
import { initCalendar, render as renderCalendar } from './views/calendar.js';
import { initSettings, render as renderSettings } from './views/settings.js';
import { startReminders, beep } from './reminders.js';
import { flushQueue } from './agent.js';
import { startAudit } from './audit.js';

const RENDER = { notes: renderNotes, calendar: renderCalendar, settings: renderSettings };
let current = null;

function route() {
  const view = location.hash.replace('#', '');
  const name = RENDER[view] ? view : 'home';
  if (current === 'home' && name !== 'home') leaveHome();
  $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
  $$('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === name));
  current = name;
  if (name === 'home') enterHome({ auto: true });
  else RENDER[name]();
}

async function main() {
  await loadSettings();
  startAudit().catch(() => {});
  initHome();
  initNotes();
  initCalendar();
  initSettings();
  startReminders((n) => { beep(); reminderFired(n); });
  window.addEventListener('hashchange', () => route());
  route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.onLine) flushQueue().catch(() => {});
}

main();
