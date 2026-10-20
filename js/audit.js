// Auditoría de sesiones EN ESTE DISPOSITIVO: cuándo se abre la app, desde qué dispositivo/IP
// y cuánto tiempo se usa. (La app no tiene servidor: otros dispositivos llevan su propio registro.)
import { get, put, getAll, emit } from './db.js';
import { settings } from './store.js';
import { uid } from './util.js';

let session = null;
let lastTick = 0;

async function deviceId() {
  let id = await get('kv', 'deviceId');
  if (!id) { id = uid(); await put('kv', id, 'deviceId'); }
  return id;
}

function browserName(ua) {
  const m = ua.match(/(SamsungBrowser|Edg|OPR|Firefox|Chrome|Safari)\/([\d.]+)/);
  if (!m) return 'Desconocido';
  const name = { Edg: 'Edge', OPR: 'Opera', SamsungBrowser: 'Samsung Internet' }[m[1]] || m[1];
  return `${name} ${m[2].split('.')[0]}`;
}

async function deviceInfo() {
  const ua = navigator.userAgent;
  const info = {
    browser: browserName(ua),
    os: /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Otro',
    model: '',
    mobile: /Mobi|Android/.test(ua),
    screen: `${screen.width}×${screen.height}`,
    lang: navigator.language,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    installed: matchMedia('(display-mode: standalone)').matches,
    ua,
  };
  // Chrome Android da el modelo real del móvil (ej. "SM-S918B").
  try {
    const h = await navigator.userAgentData?.getHighEntropyValues(['model', 'platformVersion']);
    if (h?.model) info.model = h.model;
    if (h?.platformVersion) info.os += ` ${h.platformVersion.split('.')[0]}`;
  } catch {}
  return info;
}

async function ipInfo() {
  if (!settings().auditIp) return {};
  try {
    const r = await fetch('https://ipapi.co/json/', { cache: 'no-store' });
    if (r.ok) {
      const d = await r.json();
      if (d.ip) return { ip: d.ip, city: d.city, region: d.region, country: d.country_name, org: d.org };
    }
  } catch {}
  try {
    const r = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' });
    if (r.ok) return { ip: (await r.json()).ip };
  } catch {}
  return {};
}

export async function startAudit() {
  const now = Date.now();
  session = { id: uid(), start: now, lastSeen: now, activeMs: 0, deviceId: await deviceId(), ...(await deviceInfo()) };
  await save();
  ipInfo().then(async (ip) => { Object.assign(session, ip); await save(); });
  lastTick = now;
  setInterval(tick, 15000);
  document.addEventListener('visibilitychange', () => { tick(); lastTick = Date.now(); });
  addEventListener('pagehide', tick);
}

function tick() {
  if (!session) return;
  const now = Date.now();
  if (!document.hidden) session.activeMs += Math.min(now - lastTick, 60000);
  lastTick = now;
  session.lastSeen = now;
  save();
}

async function save() {
  await put('sessions', { ...session });
  emit('sessions');
}

export const currentSessionId = () => session?.id;

// Sesiones ordenadas (más recientes primero) + marcas de "nuevo".
export async function listSessions() {
  const all = (await getAll('sessions')).sort((a, b) => a.start - b.start);
  const seenIps = new Set(), seenDevices = new Set();
  for (const s of all) {
    s.newIp = !!s.ip && seenIps.size > 0 && !seenIps.has(s.ip);
    s.newDevice = seenDevices.size > 0 && !seenDevices.has(s.deviceId);
    if (s.ip) seenIps.add(s.ip);
    seenDevices.add(s.deviceId);
  }
  return all.reverse();
}
