// Cliente de Gemini con rotación de claves y registro de consumo.
// Gemini no expone por API cuánta cuota te queda: lo "restante" se calcula con
// los límites diarios que pongas a cada clave y lo que la app ha ido gastando.
import { settings, saveSettings } from './store.js';
import { put, getAll, emit } from './db.js';
import { uid, quotaDay, localDay, nextQuotaReset } from './util.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class ApiError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable; // si conviene guardar la petición en cola para reintentar
  }
}

export const maskKey = (k) => (k ? `${k.slice(0, 4)}…${k.slice(-4)}` : '');

export function newKey(label, key, rpd = 0, tpd = 0) {
  return { id: uid(), label: label || 'Clave', key: key.trim(), enabled: true, rpd: +rpd || 0, tpd: +tpd || 0, exhaustedUntil: 0, invalid: false, lastError: '' };
}

// ---------- consumo ----------
export async function keyUsageToday() {
  const qd = quotaDay();
  const map = {};
  for (const u of await getAll('usage')) {
    if (u.qday !== qd || !u.ok) continue;
    const m = (map[u.keyId] ||= { req: 0, tok: 0 });
    m.req++;
    m.tok += u.total;
  }
  return map;
}

export function keyStatus(k, used = { req: 0, tok: 0 }) {
  if (!k.enabled) return { ok: false, label: 'Desactivada', cls: 'muted' };
  if (k.invalid) return { ok: false, label: 'No válida', cls: 'bad' };
  if (k.exhaustedUntil > Date.now()) return { ok: false, label: 'Agotada', cls: 'warn', until: k.exhaustedUntil };
  if (k.rpd && used.req >= k.rpd) return { ok: false, label: 'Límite diario', cls: 'warn', until: nextQuotaReset() };
  if (k.tpd && used.tok >= k.tpd) return { ok: false, label: 'Límite tokens', cls: 'warn', until: nextQuotaReset() };
  return { ok: true, label: 'Disponible', cls: 'good' };
}

export async function activeKey() {
  const used = await keyUsageToday();
  return settings().keys.find((k) => keyStatus(k, used[k.id]).ok) || null;
}

async function patchKey(id, patch) {
  const keys = settings().keys.map((k) => (k.id === id ? { ...k, ...patch } : k));
  await saveSettings({ keys });
}

async function record(entry) {
  await put('usage', { ts: Date.now(), day: localDay(), qday: quotaDay(), ...entry });
  emit('usage');
}

function parseQuotaError(data) {
  const details = data?.error?.details || [];
  let perDay = false, retryMs = 60000;
  for (const d of details) {
    const t = d['@type'] || '';
    if (t.endsWith('QuotaFailure')) perDay = (d.violations || []).some((v) => /PerDay/i.test(v.quotaId || ''));
    if (t.endsWith('RetryInfo') && d.retryDelay) retryMs = Math.ceil(parseFloat(d.retryDelay) * 1000) || retryMs;
  }
  return perDay ? nextQuotaReset() : Date.now() + retryMs;
}

// ---------- llamada con rotación ----------
export async function generate(body, { model, kind = 'text' } = {}) {
  model = model || settings().model;
  if (!settings().keys.length) throw new ApiError('NO_KEYS', 'No hay ninguna clave de API. Añádela en Ajustes → API.');
  if (!navigator.onLine) throw new ApiError('OFFLINE', 'Sin conexión. Lo guardo para más tarde.', true);

  const tried = new Set();
  let lastErr = null;
  for (;;) {
    const used = await keyUsageToday();
    const k = settings().keys.find((x) => !tried.has(x.id) && keyStatus(x, used[x.id]).ok);
    if (!k) throw lastErr || new ApiError('EXHAUSTED', 'Todas las claves están agotadas por hoy. Lo guardo para más tarde.', true);
    tried.add(k.id);

    let res, data;
    try {
      res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': k.key },
        body: JSON.stringify(body),
      });
      data = await res.json().catch(() => ({}));
    } catch {
      throw new ApiError('NETWORK', 'No llego al servidor. Lo guardo para más tarde.', true);
    }

    if (res.ok) {
      const u = data.usageMetadata || {};
      const inTok = u.promptTokenCount || 0;
      const outTok = u.candidatesTokenCount || 0;
      const thinkTok = u.thoughtsTokenCount || 0;
      const total = u.totalTokenCount || inTok + outTok + thinkTok;
      await record({ keyId: k.id, keyLabel: k.label, model, kind, inTok, outTok, thinkTok, total, ok: true, status: 200 });
      const turn = { ts: Date.now(), keyId: k.id, keyLabel: k.label, model, inTok, outTok, thinkTok, total };
      await saveSettings({ lastTurn: turn });
      if (k.lastError) await patchKey(k.id, { lastError: '' });
      return { data, key: k, turn };
    }

    const msg = data?.error?.message || `HTTP ${res.status}`;
    await record({ keyId: k.id, keyLabel: k.label, model, kind, inTok: 0, outTok: 0, thinkTok: 0, total: 0, ok: false, status: res.status, error: msg.slice(0, 200) });

    if (res.status === 429) {
      await patchKey(k.id, { exhaustedUntil: parseQuotaError(data), lastError: 'Cuota agotada' });
      lastErr = new ApiError('EXHAUSTED', 'Todas las claves están agotadas. Lo guardo para más tarde.', true);
      continue; // siguiente clave
    }
    if (res.status === 403 || (res.status === 400 && /api key/i.test(msg))) {
      await patchKey(k.id, { invalid: true, lastError: msg.slice(0, 160) });
      lastErr = new ApiError('BAD_KEY', `Clave «${k.label}» rechazada: ${msg}`);
      continue;
    }
    if (res.status >= 500) {
      lastErr = new ApiError('SERVER', 'Gemini está teniendo problemas. Lo guardo para más tarde.', true);
      continue;
    }
    throw new ApiError('API', msg);
  }
}

// Comprueba una clave sin gastar tokens (listar modelos es gratis).
export async function testKey(k) {
  try {
    const res = await fetch(`${BASE}/models?pageSize=1`, { headers: { 'x-goog-api-key': k.key } });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      await patchKey(k.id, { invalid: false, lastError: '' });
      return { ok: true };
    }
    const msg = data?.error?.message || `HTTP ${res.status}`;
    if (res.status === 400 || res.status === 403) await patchKey(k.id, { invalid: true, lastError: msg.slice(0, 160) });
    return { ok: false, msg };
  } catch {
    return { ok: false, msg: 'Sin conexión' };
  }
}

export async function listModels(k) {
  const res = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': k.key } });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  return (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => ({ id: m.name.replace(/^models\//, ''), name: m.displayName, inLimit: m.inputTokenLimit, outLimit: m.outputTokenLimit }));
}
