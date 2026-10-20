export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const rand = (a, b) => a + Math.random() * (b - a);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const pad = (n) => String(n).padStart(2, '0');
export const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toLocalISO = (d) => `${localDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

// 'YYYY-MM-DDTHH:mm' (hora local, sin zona) -> Date
export function parseLocalISO(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
}

export const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid';

// Las cuotas de la API de Gemini se reinician a medianoche hora del Pacífico.
function laParts(d) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  return Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
}
export const quotaDay = (d = new Date()) => {
  const p = laParts(d);
  return `${p.year}-${p.month}-${p.day}`;
};
export const nextQuotaReset = (now = Date.now()) => {
  const p = laParts(new Date(now));
  const elapsed = (+p.hour % 24) * 3600 + +p.minute * 60 + +p.second;
  return now - elapsed * 1000 + 86400000;
};

const dtf = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const df = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
const tf = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
export const fmtDateTime = (d) => (d ? dtf.format(d) : '');
export const fmtDate = (d) => (d ? df.format(d) : '');
export const fmtTime = (d) => (d ? tf.format(d) : '');
export const fmtNum = (n) => new Intl.NumberFormat('es-ES').format(Math.round(n || 0));

export function fmtAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'ahora';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return fmtDate(new Date(ts));
}

export function fmtUntil(ts) {
  const s = Math.max(0, Math.round((ts - Date.now()) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.ceil(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
}

export function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export const KIND_LABEL = { idea: 'Idea', task: 'Tarea', reminder: 'Recordatorio', event: 'Evento', note: 'Nota' };
export const KIND_ICON = { idea: '💡', task: '☑️', reminder: '⏰', event: '📅', note: '📝' };

export const PALETTE = ['#ffe17a', '#9be7a0', '#8fd3ff', '#ffb3c7', '#c9b6ff', '#ffc48a', '#a6f0e4', '#e4f59a', '#f7a8a8', '#b5c7ff'];
