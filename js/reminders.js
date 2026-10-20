// Recordatorios: revisa cada 20 s (mientras la app está abierta o en segundo plano reciente)
// y lanza una notificación del sistema + aviso del muñeco.
import { getAll, put, emit } from './db.js';
import { parseLocalISO } from './util.js';

let onFire = null;

export function startReminders(cb) {
  onFire = cb;
  check();
  setInterval(check, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
}

async function check() {
  const now = Date.now();
  const due = (await getAll('notes')).filter((n) => n.alarm && n.datetime && !n.notified && !n.done && parseLocalISO(n.datetime)?.getTime() <= now);
  for (const n of due) {
    n.notified = true;
    await put('notes', n);
    await notify(n);
    onFire?.(n);
  }
  if (due.length) emit('notes');
}

async function notify(n) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker?.getRegistration();
  const opts = { body: n.content || '', tag: n.id, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', vibrate: [200, 100, 200, 100, 400], requireInteraction: true };
  if (reg) reg.showNotification(`⏰ ${n.title}`, opts);
  else new Notification(`⏰ ${n.title}`, opts);
}

export async function askNotifications() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.requestPermission();
}

// Pitido corto con WebAudio (no necesita archivos).
export function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.25, 0.5].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.2);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch {}
}
