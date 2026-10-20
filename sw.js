// Service worker: app shell offline + notificaciones de recordatorios.
const VERSION = 'theagent-v2';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './css/app.css', './css/buddy.css',
  './js/app.js', './js/db.js', './js/util.js', './js/store.js', './js/ui.js',
  './js/buddy.js', './js/recorder.js', './js/pcm-worklet.js', './js/gemini.js',
  './js/agent.js', './js/audit.js', './js/home.js', './js/reminders.js', './js/calendar-links.js',
  './js/views/notes.js', './js/views/calendar.js', './js/views/settings.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Red primero para el shell (así las actualizaciones llegan solas), caché si no hay red.
// Las llamadas a APIs externas no se tocan.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL('./#calendar', self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) { c.navigate?.(target); return c.focus(); }
      return self.clients.openWindow(target);
    })
  );
});
