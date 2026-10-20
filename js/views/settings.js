// Ajustes: agente (avatar/estilo/gestos), API y consumo, categorías, aprendizaje y datos.
import { $, esc, fmtNum, fmtUntil, fmtAgo, localDay, PALETTE, uid } from '../util.js';
import { settings, saveSettings, onSettings } from '../store.js';
import { getAll, put, del, clear, putMany, bus, emit } from '../db.js';
import { Buddy, AVATARS, STYLES, ACTS } from '../buddy.js';
import { newKey, maskKey, keyStatus, keyUsageToday, testKey, listModels, activeKey } from '../gemini.js';
import { toast, confirmBox } from '../ui.js';
import { askNotifications } from '../reminders.js';
import { listSessions, currentSessionId } from '../audit.js';

let root, preview;
const avatarBuddies = {}, styleBuddies = {};

const STATE_LABELS = { listening: '👂 Escuchando', bored: '🥱 Aburrido', surprised: '😮 Sorprendido', thinking: '🤔 Pensando', happy: '😄 Contento', confused: '😵 Confuso', sleeping: '😴 Durmiendo' };
const ACT_LABELS = {
  jump: 'Saltar', spin: 'Girar', hide: 'Esconderse', sneeze: 'Estornudar', dance: 'Bailar', shades: 'Gafas de sol', yawn: 'Bostezar',
  shapeshift: 'Transformarse', lookaround: 'Mirar alrededor', shiver: 'Tiritar', bounce: 'Rebotar', scan: 'Escanear', glitch: 'Fallo de sistema',
  fade: 'Desvanecerse', boo: '¡Bu!', groom: 'Lamerse la pata', melt: 'Derretirse',
};

export function initSettings() {
  root = $('#view-settings');
  const s = settings();
  root.innerHTML = `
    <header class="view-head"><h2>Ajustes</h2></header>

    <details class="card" open>
      <summary>🎭 Agente</summary>
      <div class="preview-box">
        <div class="preview-buddy" id="s-preview"></div>
        <div class="gesture-list">
          <div class="muted small">Estados</div>
          <div class="chips small" id="s-states"></div>
          <div class="muted small">Gestos de este avatar</div>
          <div class="chips small" id="s-acts"></div>
        </div>
      </div>
      <label>Nombre<input id="s-name" value="${esc(s.name)}" maxlength="24"></label>

      <h4>Avatar</h4>
      <div class="gallery" id="s-avatars">
        ${Object.entries(AVATARS).map(([k, a]) => `
          <button class="g-card" data-skin="${k}"><div class="g-buddy"></div><b>${a.name}</b><span class="muted small">${a.desc}</span></button>`).join('')}
      </div>

      <h4>Estilo</h4>
      <div class="gallery" id="s-styles">
        ${Object.entries(STYLES).map(([k, st]) => `
          <button class="g-card" data-style="${k}"><div class="g-buddy"></div><b>${st.name}</b><span class="muted small">${st.desc}</span></button>`).join('')}
      </div>

      <h4>Color</h4>
      <div class="row wrap" id="s-colors">
        <button class="swatch auto ${!s.color ? 'on' : ''}" data-color="">Auto</button>
        ${['#8f7bff', '#58c6d4', '#ffa75e', '#7ed957', '#ff7fa8', '#ffd84a', '#5b8cff', '#b0b0c0', '#2b2b38'].map((c) => `<button class="swatch ${s.color === c ? 'on' : ''}" data-color="${c}" style="background:${c}"></button>`).join('')}
        <label class="swatch picker">🎨<input type="color" id="s-color" value="${s.color || '#8f7bff'}"></label>
      </div>

      <h4>Comportamiento</h4>
      <label class="check"><input type="checkbox" id="s-auto" ${s.autoListen ? 'checked' : ''}> Escuchar nada más abrir la app</label>
      <label class="check"><input type="checkbox" id="s-keep" ${s.keepListening ? 'checked' : ''}> Seguir escuchando después de guardar</label>
      <label class="check"><input type="checkbox" id="s-tts" ${s.tts ? 'checked' : ''}> Que me conteste en voz alta</label>
      <div class="grid2">
        <label>Enviar tras silencio (s)<input type="number" id="s-silence" min="0" max="15" step="0.5" value="${s.silenceSend}"><span class="muted small">0 = solo al tocar</span></label>
        <label>Dormirse sin voz (s)<input type="number" id="s-sleep" min="0" max="600" step="5" value="${s.sleepAfter}"><span class="muted small">Suelta el micro</span></label>
      </div>
    </details>

    <details class="card" id="s-api-card">
      <summary>🔑 API · Admin</summary>
      <div id="s-usage-top"></div>
      <h4>Modelo</h4>
      <div class="row">
        <input id="s-model" list="s-models" value="${esc(s.model)}">
        <datalist id="s-models"><option value="gemini-2.5-flash"><option value="gemini-2.5-flash-lite"><option value="gemini-2.5-pro"></datalist>
        <button class="btn small" id="s-load-models">Cargar lista</button>
      </div>
      <label class="check"><input type="checkbox" id="s-thinking" ${s.thinking ? 'checked' : ''}> Razonamiento (más preciso, gasta más tokens)</label>

      <h4>Claves (rotación)</h4>
      <p class="muted small">Se usan en orden. Cuando una se agota (error de cuota o tu límite diario), salta a la siguiente. Las cuotas de Gemini se reinician a medianoche hora del Pacífico (09:00 en España).</p>
      <div id="s-keys"></div>
      <form class="key-add" id="s-key-form" autocomplete="off">
        <div class="grid2"><input name="label" placeholder="Nombre (ej. Cuenta 1)"><input name="key" placeholder="Clave API (AIza…)" required></div>
        <div class="grid2"><input name="rpd" type="number" min="0" placeholder="Límite peticiones/día (opcional)"><input name="tpd" type="number" min="0" placeholder="Límite tokens/día (opcional)"></div>
        <button class="btn primary">Añadir clave</button>
      </form>

      <h4>Historial de uso</h4>
      <div id="s-history"></div>
      <button class="btn small ghost" id="s-clear-usage">Borrar historial de uso</button>
    </details>

    <details class="card" id="s-audit-card">
      <summary>🛡️ Auditoría de sesiones</summary>
      <p class="muted small">Cada vez que se abre la app en <b>este dispositivo</b> se registra: dispositivo, navegador, IP, ubicación aproximada y tiempo de uso. Se marca en naranja si aparece una IP o un dispositivo nuevo. Otro móvil que abra tu web tiene su propio registro vacío y no ve tus notas ni tus claves.</p>
      <div id="s-audit-sum"></div>
      <label class="check"><input type="checkbox" id="s-audit-ip" ${s.auditIp ? 'checked' : ''}> Consultar IP y ubicación al abrir (servicio ipapi.co)</label>
      <div id="s-audit"></div>
      <button class="btn small ghost" id="s-audit-clear">Borrar registro</button>
    </details>

    <details class="card">
      <summary>🗂️ Categorías</summary>
      <p class="muted small">La descripción es lo que el agente lee para decidir dónde va cada cosa. Cuanto más clara, mejor clasifica.</p>
      <div id="s-cats"></div>
      <button class="btn" id="s-cat-add">+ Categoría</button>
    </details>

    <details class="card">
      <summary>🧠 Aprendizaje</summary>
      <label>Reglas para el agente<textarea id="s-rules" rows="5" placeholder="Ej: Todo lo que mencione dragones, forja o crafteo va a Wildforge.&#10;Las cosas del súper van a Compras aunque diga «recuérdame».">${esc(s.rules)}</textarea></label>
      <h4>Correcciones aprendidas</h4>
      <p class="muted small">Cuando cambias de categoría una nota que guardó el agente, lo apunta aquí y lo tiene en cuenta.</p>
      <div id="s-lessons"></div>
    </details>

    <details class="card">
      <summary>🔔 Avisos</summary>
      <p class="muted small" id="s-notif-state"></p>
      <button class="btn" id="s-notif">Permitir notificaciones</button>
      <p class="muted small">Los avisos saltan mientras la app sigue viva en el móvil. Para alarmas 100 % fiables con la app cerrada, en cada recordatorio tienes «Google Calendar», «.ics» o «Alarma Android».</p>
    </details>

    <details class="card">
      <summary>💾 Datos</summary>
      <div class="row wrap">
        <button class="btn" id="s-export">Exportar copia</button>
        <label class="btn">Importar copia<input type="file" id="s-import" accept="application/json" hidden></label>
        <button class="btn danger" id="s-wipe">Borrar todo</button>
      </div>
      <p class="muted small">La copia no incluye las claves de API.</p>
    </details>
    <p class="muted small center">TheAgent v1</p>`;

  setupAgent();
  setupApi();
  setupCats();
  setupLearning();
  setupMisc();
  $('#s-audit-ip').onchange = (e) => saveSettings({ auditIp: e.target.checked });
  $('#s-audit-clear').onclick = async () => {
    if (await confirmBox('¿Borrar el registro de sesiones?', 'Borrar')) { await clear('sessions'); renderAudit(); }
  };
  bus.addEventListener('change', (e) => {
    if (e.detail === 'sessions' && root.classList.contains('active') && $('#s-audit-card').open) renderAudit();
    if (e.detail === 'usage') renderUsage();
    if (e.detail === 'categories') renderCats();
  });
  onSettings(() => renderKeys());
}

export function render() {
  renderUsage();
  renderKeys();
  renderCats();
  renderLessons();
  renderAudit();
  const p ='Notification' in window ? Notification.permission : 'unsupported';
  $('#s-notif-state').textContent = { granted: '✅ Notificaciones permitidas.', denied: '⛔ Bloqueadas: actívalas en los ajustes del navegador.', default: 'Aún no has dado permiso.', unsupported: 'Este navegador no soporta notificaciones.' }[p];
}

// ---------------- Agente ----------------
function setupAgent() {
  const s = settings();
  preview = new Buddy($('#s-preview'), s.skin, s.style, s.color);
  preview.setState('idle');
  root.querySelectorAll('[data-skin]').forEach((card) => {
    avatarBuddies[card.dataset.skin] = new Buddy(card.querySelector('.g-buddy'), card.dataset.skin, s.style, '');
  });
  root.querySelectorAll('[data-style]').forEach((card) => {
    styleBuddies[card.dataset.style] = new Buddy(card.querySelector('.g-buddy'), s.skin, card.dataset.style, s.color);
  });
  markSelected();
  renderGestures();

  root.querySelectorAll('[data-skin]').forEach((card) => (card.onclick = async () => {
    await saveSettings({ skin: card.dataset.skin });
    preview.setSkin(card.dataset.skin);
    Object.values(styleBuddies).forEach((b) => b.setSkin(card.dataset.skin));
    preview.act(preview.signature());
    markSelected();
    renderGestures();
  }));
  root.querySelectorAll('[data-style]').forEach((card) => (card.onclick = async () => {
    await saveSettings({ style: card.dataset.style });
    preview.setStyle(card.dataset.style);
    Object.values(avatarBuddies).forEach((b) => b.setStyle(card.dataset.style));
    preview.act('jump');
    markSelected();
  }));
  const setColor = async (c) => {
    await saveSettings({ color: c });
    preview.setColor(c);
    Object.values(styleBuddies).forEach((b) => b.setColor(c));
    root.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('on', b.dataset.color === c));
  };
  root.querySelectorAll('[data-color]').forEach((b) => (b.onclick = () => setColor(b.dataset.color)));
  $('#s-color').onchange = (e) => setColor(e.target.value);

  // los gestos de muestra animan de vez en cuando las tarjetas para que se vean vivas
  setInterval(() => {
    if (root.hidden || document.hidden || !root.classList.contains('active')) return;
    const all = [...Object.values(avatarBuddies), ...Object.values(styleBuddies)];
    const b = all[Math.floor(Math.random() * all.length)];
    b.act(b.randomWeird().name);
  }, 2500);

  $('#s-name').onchange = (e) => saveSettings({ name: e.target.value.trim() || 'Nubo' });
  $('#s-auto').onchange = (e) => saveSettings({ autoListen: e.target.checked });
  $('#s-keep').onchange = (e) => saveSettings({ keepListening: e.target.checked });
  $('#s-tts').onchange = (e) => saveSettings({ tts: e.target.checked });
  $('#s-silence').onchange = (e) => saveSettings({ silenceSend: Math.max(0, +e.target.value || 0) });
  $('#s-sleep').onchange = (e) => saveSettings({ sleepAfter: Math.max(0, +e.target.value || 0) });
}

function markSelected() {
  const s = settings();
  root.querySelectorAll('[data-skin]').forEach((c) => c.classList.toggle('on', c.dataset.skin === s.skin));
  root.querySelectorAll('[data-style]').forEach((c) => c.classList.toggle('on', c.dataset.style === s.style));
}

function renderGestures() {
  const av = AVATARS[settings().skin];
  $('#s-states').innerHTML = Object.entries(STATE_LABELS).map(([k, v]) => `<button class="chip" data-st="${k}">${v}</button>`).join('');
  const acts = [...new Set([...av.signature, ...av.weird, 'jump', 'yawn', 'lookaround'])].filter((a) => ACTS[a]);
  $('#s-acts').innerHTML = acts.map((a) => `<button class="chip ${av.signature.includes(a) ? 'on' : ''}" data-act="${a}">${ACT_LABELS[a] || a}</button>`).join('');
  $('#s-states').querySelectorAll('[data-st]').forEach((b) => (b.onclick = () => {
    preview.setState(b.dataset.st);
    if (b.dataset.st === 'listening') pulseLevel();
    clearTimeout(preview._back);
    preview._back = setTimeout(() => preview.setState('idle'), 3500);
  }));
  $('#s-acts').querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => preview.act(b.dataset.act)));
}

function pulseLevel() {
  let t = 0;
  const iv = setInterval(() => {
    preview.setLevel(Math.abs(Math.sin(t += 0.4)) * 0.6);
    if (t > 40) { clearInterval(iv); preview.setLevel(0); }
  }, 80);
}

// ---------------- API ----------------
function setupApi() {
  $('#s-model').onchange = (e) => saveSettings({ model: e.target.value.trim() || 'gemini-2.5-flash' });
  $('#s-thinking').onchange = (e) => saveSettings({ thinking: e.target.checked });
  $('#s-load-models').onclick = async () => {
    const k = await activeKey();
    if (!k) return toast('Necesito una clave disponible');
    try {
      const models = await listModels(k);
      $('#s-models').innerHTML = models.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
      toast(`${models.length} modelos cargados. Toca el campo para elegir.`);
    } catch (e) { toast(e.message); }
  };
  $('#s-key-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const key = f.get('key').trim();
    if (settings().keys.some((k) => k.key === key)) return toast('Esa clave ya está');
    const k = newKey(f.get('label') || `Clave ${settings().keys.length + 1}`, key, f.get('rpd'), f.get('tpd'));
    await saveSettings({ keys: [...settings().keys, k] });
    e.target.reset();
    const r = await testKey(k);
    toast(r.ok ? '✅ Clave añadida y funcionando' : `⚠️ Añadida, pero falla: ${r.msg}`);
    renderUsage();
  };
  $('#s-clear-usage').onclick = async () => {
    if (await confirmBox('¿Borrar todo el historial de consumo?', 'Borrar')) { await clear('usage'); emit('usage'); }
  };
}

async function renderKeys() {
  const box = $('#s-keys');
  if (!box) return;
  const keys = settings().keys;
  const used = await keyUsageToday();
  const active = await activeKey();
  box.innerHTML = keys.length ? keys.map((k, i) => {
    const u = used[k.id] || { req: 0, tok: 0 };
    const st = keyStatus(k, u);
    return `<div class="key-row ${active?.id === k.id ? 'current' : ''}" data-id="${k.id}">
      <div class="row between">
        <div><b>${i + 1}. ${esc(k.label)}</b> ${active?.id === k.id ? '<span class="pill good">EN USO</span>' : ''}<div class="muted small mono">${maskKey(k.key)}</div></div>
        <span class="pill ${st.cls}">${st.label}${st.until ? ` · ${fmtUntil(st.until)}` : ''}</span>
      </div>
      <div class="key-meter">
        <span>Hoy: <b>${fmtNum(u.req)}</b>${k.rpd ? ` / ${fmtNum(k.rpd)}` : ''} peticiones · <b>${fmtNum(u.tok)}</b>${k.tpd ? ` / ${fmtNum(k.tpd)}` : ''} tokens</span>
        ${k.rpd ? `<div class="bar"><i style="width:${Math.min(100, (u.req / k.rpd) * 100)}%"></i></div>` : ''}
        ${k.tpd ? `<div class="bar"><i style="width:${Math.min(100, (u.tok / k.tpd) * 100)}%"></i></div>` : ''}
      </div>
      ${k.lastError ? `<div class="small bad-text">${esc(k.lastError)}</div>` : ''}
      <div class="grid2 small-inputs">
        <label>Peticiones/día<input type="number" min="0" data-f="rpd" value="${k.rpd || ''}" placeholder="sin límite"></label>
        <label>Tokens/día<input type="number" min="0" data-f="tpd" value="${k.tpd || ''}" placeholder="sin límite"></label>
      </div>
      <div class="row wrap">
        <button class="btn small" data-a="up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn small" data-a="down" ${i === keys.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="btn small" data-a="test">Probar</button>
        <button class="btn small" data-a="toggle">${k.enabled ? 'Desactivar' : 'Activar'}</button>
        ${k.exhaustedUntil > Date.now() || k.invalid ? '<button class="btn small" data-a="reset">Reactivar</button>' : ''}
        <button class="btn small danger" data-a="del">Quitar</button>
      </div>
    </div>`;
  }).join('') : '<p class="muted">No hay claves. Consíguela gratis en aistudio.google.com → «Get API key».</p>';

  box.querySelectorAll('.key-row').forEach((row) => {
    const id = row.dataset.id;
    const patch = (p) => saveSettings({ keys: settings().keys.map((k) => (k.id === id ? { ...k, ...p } : k)) });
    row.querySelectorAll('[data-f]').forEach((inp) => (inp.onchange = () => patch({ [inp.dataset.f]: Math.max(0, +inp.value || 0) })));
    row.querySelectorAll('[data-a]').forEach((b) => (b.onclick = async () => {
      const keys = [...settings().keys];
      const i = keys.findIndex((k) => k.id === id);
      const a = b.dataset.a;
      if (a === 'up' || a === 'down') {
        const j = a === 'up' ? i - 1 : i + 1;
        [keys[i], keys[j]] = [keys[j], keys[i]];
        await saveSettings({ keys });
      } else if (a === 'test') {
        b.textContent = '…';
        const r = await testKey(keys[i]);
        toast(r.ok ? '✅ Funciona' : `❌ ${r.msg}`);
      } else if (a === 'toggle') await patch({ enabled: !keys[i].enabled });
      else if (a === 'reset') await patch({ exhaustedUntil: 0, invalid: false, lastError: '' });
      else if (a === 'del' && await confirmBox(`¿Quitar la clave «${keys[i].label}»?`, 'Quitar')) await saveSettings({ keys: keys.filter((k) => k.id !== id) });
      renderUsage();
    }));
  });
}

async function renderUsage() {
  if (!$('#s-usage-top')) return;
  const s = settings();
  const all = await getAll('usage');
  const today = localDay();
  const t = all.filter((u) => u.day === today);
  const ok = t.filter((u) => u.ok);
  const sum = (arr, f) => arr.reduce((a, u) => a + (u[f] || 0), 0);
  const active = await activeKey();
  const used = await keyUsageToday();
  let remReq = 0, remTok = 0, hasReq = false, hasTok = false;
  for (const k of s.keys) {
    if (!keyStatus(k, used[k.id]).ok) continue;
    if (k.rpd) { hasReq = true; remReq += Math.max(0, k.rpd - (used[k.id]?.req || 0)); }
    if (k.tpd) { hasTok = true; remTok += Math.max(0, k.tpd - (used[k.id]?.tok || 0)); }
  }
  const lt = s.lastTurn;
  $('#s-usage-top').innerHTML = `
    <div class="stats">
      <div class="stat"><span>Clave en uso</span><b>${active ? esc(active.label) : '—'}</b><small>${esc(s.model)}</small></div>
      <div class="stat"><span>Último turno</span><b>${lt ? fmtNum(lt.total) : '—'}</b><small>${lt ? `↑${fmtNum(lt.inTok)} ↓${fmtNum(lt.outTok)}${lt.thinkTok ? ` 🧠${fmtNum(lt.thinkTok)}` : ''} · ${fmtAgo(lt.ts)}` : 'tokens'}</small></div>
      <div class="stat"><span>Hoy</span><b>${fmtNum(sum(ok, 'total'))}</b><small>${ok.length} peticiones${t.length - ok.length ? ` · ${t.length - ok.length} errores` : ''}</small></div>
      <div class="stat"><span>Restante hoy</span><b>${hasReq ? fmtNum(remReq) + ' pet.' : hasTok ? fmtNum(remTok) + ' tok.' : '—'}</b><small>${hasReq && hasTok ? fmtNum(remTok) + ' tokens' : hasReq || hasTok ? 'según tus límites' : 'pon límites a las claves'}</small></div>
    </div>`;

  // últimos 30 días
  const days = [];
  for (let i = 29; i >= 0; i--) days.push(localDay(new Date(Date.now() - i * 86400000)));
  const byDay = Object.fromEntries(days.map((d) => [d, { req: 0, err: 0, inTok: 0, outTok: 0, total: 0 }]));
  for (const u of all) {
    const d = byDay[u.day];
    if (!d) continue;
    if (u.ok) { d.req++; d.inTok += u.inTok; d.outTok += u.outTok + (u.thinkTok || 0); d.total += u.total; } else d.err++;
  }
  const max = Math.max(1, ...Object.values(byDay).map((d) => d.total));
  const rows = days.filter((d) => byDay[d].req || byDay[d].err).reverse();
  $('#s-history').innerHTML = `
    <div class="chart" role="img" aria-label="Tokens por día, últimos 30 días">
      ${days.map((d) => `<div class="col" title="${d}: ${fmtNum(byDay[d].total)} tokens, ${byDay[d].req} peticiones"><i style="height:${(byDay[d].total / max) * 100}%"></i></div>`).join('')}
    </div>
    <div class="row between muted small"><span>hace 30 días</span><span>hoy</span></div>
    ${rows.length ? `<table class="tbl"><thead><tr><th>Día</th><th>Pet.</th><th>Entrada</th><th>Salida</th><th>Total</th></tr></thead><tbody>
      ${rows.map((d) => `<tr><td>${d.slice(5).split('-').reverse().join('/')}</td><td>${byDay[d].req}${byDay[d].err ? ` <span class="bad-text">(${byDay[d].err}✕)</span>` : ''}</td><td>${fmtNum(byDay[d].inTok)}</td><td>${fmtNum(byDay[d].outTok)}</td><td><b>${fmtNum(byDay[d].total)}</b></td></tr>`).join('')}
    </tbody></table>` : '<p class="muted small">Sin consumo todavía.</p>'}`;
  renderKeys();
}

// ---------------- Auditoría ----------------
const fmtDur = (ms) => {
  const m = Math.round(ms / 60000);
  return m < 1 ? `${Math.max(1, Math.round(ms / 1000))} s` : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

async function renderAudit() {
  const box = $('#s-audit');
  if (!box) return;
  const [sessions, usage] = await Promise.all([listSessions(), getAll('usage')]);
  const cur = currentSessionId();
  const dayAgo = Date.now() - 86400000, weekAgo = Date.now() - 7 * 86400000;
  const active = (from) => sessions.filter((x) => x.lastSeen >= from).reduce((a, x) => a + x.activeMs, 0);
  const ips = new Set(sessions.map((x) => x.ip).filter(Boolean));
  const alerts = sessions.filter((x) => x.newIp || x.newDevice).length;
  $('#s-audit-sum').innerHTML = `
    <div class="stats">
      <div class="stat"><span>Uso últimas 24 h</span><b>${fmtDur(active(dayAgo))}</b><small>tiempo con la app delante</small></div>
      <div class="stat"><span>Uso 7 días</span><b>${fmtDur(active(weekAgo))}</b><small>${((n) => `${n} ${n === 1 ? 'sesión' : 'sesiones'}`)(sessions.filter((x) => x.start >= weekAgo).length)}</small></div>
      <div class="stat"><span>IPs distintas</span><b>${ips.size}</b><small>en todo el registro</small></div>
      <div class="stat"><span>Avisos</span><b class="${alerts ? 'bad-text' : ''}">${alerts}</b><small>IP o dispositivo nuevo</small></div>
    </div>`;
  box.innerHTML = sessions.length ? sessions.slice(0, 100).map((x) => {
    const req = usage.filter((u) => u.ok && u.ts >= x.start && u.ts <= x.lastSeen + 60000);
    const tok = req.reduce((a, u) => a + u.total, 0);
    const where = [x.city, x.country].filter(Boolean).join(', ');
    return `<div class="audit-row ${x.newIp || x.newDevice ? 'alert' : ''}">
      <div class="row between">
        <b>${new Date(x.start).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</b>
        ${x.id === cur ? '<span class="pill good">AHORA</span>' : ''}${x.newIp ? '<span class="pill warn">IP nueva</span>' : ''}${x.newDevice ? '<span class="pill warn">Dispositivo nuevo</span>' : ''}
      </div>
      <div class="small">📱 ${esc([x.model, x.os].filter(Boolean).join(' · '))} · ${esc(x.browser)} · ${x.installed ? 'app instalada' : 'navegador'} · ${esc(x.screen)}</div>
      <div class="small">🌐 ${esc(x.ip || 'IP no disponible')}${where ? ` · ${esc(where)}` : ''}${x.org ? ` · ${esc(x.org)}` : ''}</div>
      <div class="small muted">⏱️ ${fmtDur(x.activeMs)} activo de ${fmtDur(x.lastSeen - x.start)} · ${req.length} peticiones API${tok ? ` · ${fmtNum(tok)} tokens` : ''} · ${esc(x.lang)} · ${esc(x.tz)}</div>
    </div>`;
  }).join('') : '<p class="muted small">Sin sesiones registradas.</p>';
}

// ---------------- Categorías ----------------
function setupCats() {
  $('#s-cat-add').onclick = async () => {
    const cats = await getAll('categories');
    await put('categories', { id: uid(), name: 'Nueva', color: PALETTE[cats.length % PALETTE.length], description: '', order: cats.length, createdAt: Date.now() });
    emit('categories');
  };
}

async function renderCats() {
  const box = $('#s-cats');
  if (!box) return;
  const cats = (await getAll('categories')).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const notes = await getAll('notes');
  box.innerHTML = cats.map((c) => `
    <div class="cat-row" data-id="${c.id}">
      <div class="row"><input type="color" data-f="color" value="${c.color}"><input data-f="name" value="${esc(c.name)}"><span class="muted small">${notes.filter((n) => n.categoryId === c.id).length}</span><button class="icon-btn" data-del aria-label="Borrar">🗑</button></div>
      <textarea data-f="description" rows="2" placeholder="¿Qué va aquí? (lo lee el agente)">${esc(c.description)}</textarea>
    </div>`).join('');
  box.querySelectorAll('.cat-row').forEach((row) => {
    const c = cats.find((x) => x.id === row.dataset.id);
    row.querySelectorAll('[data-f]').forEach((inp) => (inp.onchange = async () => {
      c[inp.dataset.f] = inp.value.trim();
      await put('categories', c);
      emit('notes');
    }));
    row.querySelector('[data-del]').onclick = async () => {
      const n = notes.filter((x) => x.categoryId === c.id).length;
      if (!(await confirmBox(n ? `«${c.name}» tiene ${n} notas. Se moverán a la primera categoría. ¿Borrar?` : `¿Borrar «${c.name}»?`, 'Borrar'))) return;
      const target = cats.find((x) => x.id !== c.id);
      if (n && target) await putMany('notes', notes.filter((x) => x.categoryId === c.id).map((x) => ({ ...x, categoryId: target.id })));
      await del('categories', c.id);
      emit('categories');
      emit('notes');
    };
  });
}

// ---------------- Aprendizaje ----------------
function setupLearning() {
  $('#s-rules').onchange = (e) => saveSettings({ rules: e.target.value });
}

async function renderLessons() {
  const lessons = (await getAll('lessons')).sort((a, b) => b.ts - a.ts);
  $('#s-lessons').innerHTML = lessons.length ? lessons.map((l) => `
    <div class="lesson" data-id="${l.id}"><span class="small">«${esc(l.text)}» <b>${esc(l.from)} → ${esc(l.to)}</b></span><button class="icon-btn" aria-label="Olvidar">✕</button></div>`).join('')
    : '<p class="muted small">Todavía nada.</p>';
  $('#s-lessons').querySelectorAll('.lesson button').forEach((b) => (b.onclick = async () => { await del('lessons', b.parentElement.dataset.id); renderLessons(); }));
}

// ---------------- Avisos y datos ----------------
function setupMisc() {
  $('#s-notif').onclick = async () => { await askNotifications(); render(); };
  $('#s-export').onclick = async () => {
    const data = { app: 'theagent', v: 1, at: new Date().toISOString() };
    for (const st of ['notes', 'categories', 'lessons', 'actions']) data[st] = await getAll(st);
    const { keys, lastTurn, ...rest } = settings();
    data.settings = rest;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: `theagent-${localDay()}.json` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  $('#s-import').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'theagent') throw new Error();
      for (const st of ['notes', 'categories', 'lessons', 'actions']) if (Array.isArray(data[st])) await putMany(st, data[st]);
      if (data.settings) { const { keys, ...rest } = data.settings; await saveSettings(rest); }
      ['notes', 'categories', 'actions'].forEach(emit);
      toast('Copia importada');
    } catch { toast('Ese archivo no es una copia válida'); }
    e.target.value = '';
  };
  $('#s-wipe').onclick = async () => {
    if (!(await confirmBox('Se borrarán TODAS las notas, categorías, historial y aprendizaje (las claves se mantienen). ¿Seguro?', 'Borrar todo'))) return;
    for (const st of ['notes', 'categories', 'lessons', 'actions', 'usage', 'queue']) await clear(st);
    await saveSettings({ seeded: false, lastTurn: null });
    location.reload();
  };
}
