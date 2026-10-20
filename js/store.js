// Ajustes de la app (en IndexedDB) + categorías iniciales.
import { get, put, getAll, putMany } from './db.js';
import { uid } from './util.js';

export const DEFAULTS = {
  name: 'Nubo',
  skin: 'blob',            // avatar
  style: 'cartoon',         // estilo visual
  color: '',                // color personalizado del cuerpo ('' = el del avatar)
  tts: true,
  autoListen: true,         // empezar a escuchar al abrir la app
  keepListening: true,      // volver a escuchar tras guardar
  silenceSend: 2.5,         // segundos de silencio tras hablar para enviar (0 = solo manual)
  sleepAfter: 60,           // segundos sin oír nada para dormirse y soltar el micro
  model: 'gemini-2.5-flash',
  thinking: false,
  rules: '',
  keys: [],                 // [{id,label,key,enabled,rpd,tpd,exhaustedUntil,invalid,lastError}]
  lastTurn: null,
  seeded: false,
  auditIp: true,            // consultar IP y ubicación aproximada al abrir (ipapi.co)
};

let cache = null;
const listeners = new Set();

export async function loadSettings() {
  cache = { ...DEFAULTS, ...((await get('kv', 'settings')) || {}) };
  if (!cache.seeded) await seed();
  return cache;
}

export const settings = () => cache;

export async function saveSettings(patch) {
  Object.assign(cache, patch);
  await put('kv', JSON.parse(JSON.stringify(cache)), 'settings');
  listeners.forEach((fn) => fn(cache));
}

export const onSettings = (fn) => listeners.add(fn);

async function seed() {
  const existing = await getAll('categories');
  if (!existing.length) {
    const base = [
      ['Wildforge', '#9be7a0', 'Mi videojuego Wildforge: ideas de diseño, mecánicas, lore, personajes, arte, música, bugs y tareas del juego.'],
      ['Ideas', '#ffe17a', 'Ocurrencias sueltas que no pertenecen a ningún proyecto concreto.'],
      ['Personal', '#ffb3c7', 'Vida personal, salud, familia, amigos, casa.'],
      ['Trabajo', '#8fd3ff', 'Cosas del trabajo y reuniones.'],
      ['Compras', '#ffc48a', 'Cosas que comprar o pedir.'],
    ];
    await putMany('categories', base.map(([name, color, description], i) => ({ id: uid(), name, color, description, order: i, createdAt: Date.now() })));
  }
  await saveSettings({ seeded: true });
}
