// Pantalla del agente: une micrófono, muñeco y cerebro.
import { $, esc, rand, KIND_ICON, fmtDateTime, parseLocalISO } from './util.js';
import { Buddy, line } from './buddy.js';
import { Recorder, MAX_SECONDS } from './recorder.js';
import { settings, onSettings } from './store.js';
import { processInput, enqueue, flushQueue } from './agent.js';
import { activeKey } from './gemini.js';
import { getAll, count, bus } from './db.js';
import { toast, openNoteEditor } from './ui.js';

let buddy, rec;
let mode = 'off'; // off | recording | processing | sleeping
let heard = false, lastVoice = 0, startedAt = 0, lastSpeech = 0, nextRandom = 0, lastBubbleKind = '';
let speaking = false;

const bubble = (text, kind = '') => {
  const b = $('#bubble');
  b.textContent = text;
  b.classList.toggle('hidden', !text);
  lastBubbleKind = kind;
};

function setMainButton() {
  const btn = $('#btn-main');
  const lbl = { off: 'Escuchar', sleeping: 'Despertar', recording: heard ? 'Enviar' : 'Escuchando…', processing: 'Pensando…' }[mode];
  btn.querySelector('.lbl').textContent = lbl;
  btn.classList.toggle('rec', mode === 'recording');
  btn.disabled = mode === 'processing';
  $('#btn-cancel').classList.toggle('invisible', mode !== 'recording');
}

export function initHome() {
  const s = settings();
  buddy = new Buddy($('#buddy'), s.skin, s.style, s.color);
  onSettings((st) => {
    if (st.skin !== buddy.skin) buddy.setSkin(st.skin);
    if (st.style !== buddy.style) buddy.setStyle(st.style);
    buddy.setColor(st.color);
    refreshPills();
  });

  rec = new Recorder();
  rec.addEventListener('level', (e) => {
    const { level, speaking: sp } = e.detail;
    speaking = sp;
    buddy.setLevel(level);
    $('#meter-bar').style.transform = `scaleX(${Math.min(1, level * 1.6)})`;
  });
  rec.addEventListener('spike', () => {
    if (mode === 'recording' && !buddy.acting) {
      buddy.setState('surprised');
      bubble(line('surprised'));
      lastSpeech = Date.now();
    }
  });

  $('#btn-main').onclick = () => mainAction();
  $('#buddy').onclick = () => tapBuddy();
  $('#btn-cancel').onclick = () => {
    rec.cancel();
    mode = 'off';
    buddy.setState('off');
    bubble('Vale, lo olvido. Toca para volver a empezar.');
    setMainButton();
  };
  $('#btn-type').onclick = () => {
    const box = $('#type-box');
    box.classList.toggle('hidden');
    if (!box.classList.contains('hidden')) $('#type-input').focus();
  };
  $('#type-box').onsubmit = (e) => {
    e.preventDefault();
    const text = $('#type-input').value.trim();
    if (!text) return;
    $('#type-input').value = '';
    $('#type-box').classList.add('hidden');
    if (mode === 'recording') rec.cancel();
    send({ type: 'text', text, ts: Date.now() });
  };
  $('#queue-pill').onclick = () => retryQueue();

  bus.addEventListener('change', (e) => { if (['queue', 'usage', 'notes'].includes(e.detail)) refreshPills(); });
  window.addEventListener('online', () => retryQueue(true));
  document.addEventListener('visibilitychange', onVisibility);

  setInterval(tick, 250);
  buddy.setState('off');
  setMainButton();
  refreshPills();
  renderRecent();
}

// Se llama al entrar en la pestaña del agente (y al abrir la app).
export function enterHome({ auto } = {}) {
  if (auto && settings().autoListen && mode === 'off') startListening();
}
export function leaveHome() {
  if (mode === 'recording') finishOrDrop();
}

async function onVisibility() {
  if (document.hidden) {
    if (mode === 'recording') finishOrDrop();
  } else if (location.hash.replace('#', '') in { '': 1, home: 1 } && settings().autoListen && (mode === 'off' || mode === 'sleeping')) {
    startListening();
  }
}

function finishOrDrop() {
  if (rec.heardSpeech) stopAndSend();
  else { rec.cancel(); mode = 'off'; buddy.setState('off'); setMainButton(); }
}

async function startListening() {
  if (mode === 'recording' || mode === 'processing') return;
  try {
    await rec.start();
  } catch (e) {
    mode = 'off';
    buddy.setState('confused');
    bubble(e.name === 'NotAllowedError' ? 'Necesito permiso para el micrófono. Tócame y dale a «Permitir».' : 'No puedo abrir el micrófono 😕');
    setMainButton();
    return;
  }
  if (rec.suspended) {
    // el navegador no deja arrancar el audio sin un toque
    rec.cancel();
    mode = 'off';
    buddy.setState('off');
    bubble('Tócame para empezar a escuchar.');
    setMainButton();
    return;
  }
  mode = 'recording';
  heard = false;
  startedAt = lastVoice = lastSpeech = Date.now();
  nextRandom = Date.now() + rand(9000, 16000);
  buddy.setState('idle');
  bubble(buddy.say('greet'), 'greet');
  setMainButton();
}

function mainAction() {
  if (mode === 'recording') {
    if (rec.heardSpeech) stopAndSend();
    else { buddy.act('jump'); bubble(line('tickle')); }
  } else if (mode === 'off' || mode === 'sleeping') startListening();
}

function tapBuddy() {
  if (mode === 'recording' && rec.heardSpeech) return stopAndSend();
  if (mode === 'recording') { buddy.act(buddy.signature()); bubble(line('tickle')); return; }
  if (mode === 'off' || mode === 'sleeping') startListening();
}

function sleepNow() {
  rec.cancel();
  mode = 'sleeping';
  buddy.setState('sleeping');
  bubble(line('sleeping'));
  setMainButton();
}

async function tick() {
  if (mode !== 'recording') {
    // gestos raros también cuando está quieto sin micro
    if ((mode === 'off') && Date.now() > nextRandom && !buddy.acting && !document.hidden) {
      nextRandom = Date.now() + rand(20000, 40000);
      if (Math.random() < 0.5) buddy.act(buddy.randomWeird().name);
    }
    return;
  }
  const now = Date.now();
  const s = settings();
  if (speaking) {
    lastVoice = now;
    if (!heard) { heard = true; setMainButton(); }
    if (buddy.state !== 'surprised' || now - lastSpeech > 700) buddy.setState('listening');
    if (lastBubbleKind !== 'listening') bubble(line('listening'), 'listening');
    return;
  }
  const silent = now - lastVoice;
  if (rec.seconds > MAX_SECONDS) return stopAndSend();
  if (heard && s.silenceSend > 0 && silent > s.silenceSend * 1000) return stopAndSend();
  if (!heard && s.sleepAfter > 0 && silent > s.sleepAfter * 1000) return sleepNow();

  if (silent > 900 && buddy.state === 'listening') { buddy.setState('idle'); bubble(heard ? 'Ajá… ¿algo más? (tócame para enviar)' : '…', 'wait'); }
  if (silent > 1200 && buddy.state === 'surprised') buddy.setState('idle');
  if (!heard && silent > 8000 && buddy.state === 'idle') { buddy.setState('bored'); bubble(buddy.say('bored'), 'bored'); }

  // cosas raras de vez en cuando para llamar la atención
  if (now > nextRandom && !buddy.acting && (buddy.state === 'idle' || buddy.state === 'bored')) {
    nextRandom = now + rand(12000, 25000);
    const r = Math.random();
    if (r < 0.25) { buddy.setState('surprised'); bubble(line('surprised')); setTimeout(() => buddy.state === 'surprised' && buddy.setState(heard ? 'idle' : 'bored'), 1300); }
    else if (r < 0.45 && buddy.state === 'bored') { buddy.act('yawn'); bubble('Aaaaah…'); }
    else { const w = buddy.randomWeird(); buddy.act(w.name); if (w.text) bubble(w.text); }
  }
}

async function stopAndSend() {
  if (mode !== 'recording') return;
  mode = 'processing';
  setMainButton();
  const audio = await rec.stop();
  if (!audio) {
    mode = 'off';
    buddy.setState('confused');
    bubble(line('nothing'));
    setMainButton();
    return;
  }
  await send({ type: 'audio', ...audio, ts: Date.now() });
}

async function send(input) {
  mode = 'processing';
  buddy.setState('thinking');
  bubble('Pensando dónde guardarlo…');
  setMainButton();
  try {
    const res = await processInput(input);
    const mood = res.out.mood && res.out.mood !== 'thinking' ? res.out.mood : res.notes.length || res.actions.length ? 'happy' : 'confused';
    buddy.setState(mood);
    const reply = res.out.reply || buddy.say('saved');
    bubble(reply);
    renderRecent(res);
    await speak(reply);
  } catch (e) {
    buddy.setState('confused');
    if (e.retryable) {
      await enqueue(input);
      bubble(e.message);
    } else {
      bubble(e.message || 'Algo ha fallado 😵');
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  mode = 'off';
  setMainButton();
  if (settings().keepListening && !document.hidden && /^#?(home)?$/.test(location.hash)) {
    setTimeout(() => { if (mode === 'off') startListening(); }, 1200);
  } else {
    setTimeout(() => mode === 'off' && buddy.setState('off'), 3000);
  }
}

function speak(text) {
  if (!settings().tts || !('speechSynthesis' in window) || !text) return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text.replace(/[\u{1F300}-\u{1FAFF}]/gu, ''));
    u.lang = 'es-ES';
    const voice = speechSynthesis.getVoices().find((v) => v.lang?.startsWith('es'));
    if (voice) u.voice = voice;
    u.pitch = { robot: 0.6, ghost: 1.1, cat: 1.6, slime: 0.9 }[buddy.skin] ?? 1.35;
    u.rate = 1.08;
    u.onstart = () => buddy.talk(true);
    u.onend = u.onerror = () => { buddy.talk(false); resolve(); };
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    setTimeout(() => { buddy.talk(false); resolve(); }, 12000);
  });
}

// Aviso de recordatorio con la app abierta.
export function reminderFired(n) {
  buddy?.setState('surprised');
  buddy?.act('jump');
  bubble(`⏰ ¡Eh! ${n.title}`);
  speak(`Te recuerdo: ${n.title}`);
}

async function retryQueue(silent) {
  const n = await count('queue');
  if (!n) return;
  if (!silent) toast(`Reintentando ${n} pendiente(s)…`);
  const r = await flushQueue((res) => renderRecent(res));
  if (!silent || r.done) toast(r.left ? `Procesados ${r.done}. Quedan ${r.left}.` : `¡Listo! Procesados ${r.done}.`);
}

async function refreshPills() {
  const k = await activeKey();
  const pill = $('#key-pill');
  if (!settings().keys.length) { pill.textContent = '⚠️ Sin API · Ajustes'; pill.className = 'pill warn'; }
  else if (!k) { pill.textContent = '⛔ Claves agotadas'; pill.className = 'pill bad'; }
  else { pill.textContent = `🔑 ${k.label}`; pill.className = 'pill'; }
  const q = await count('queue');
  const qp = $('#queue-pill');
  qp.textContent = `⏳ ${q} pendiente${q === 1 ? '' : 's'} · reintentar`;
  qp.classList.toggle('hidden', !q);
}

async function renderRecent(res) {
  const box = $('#recent');
  const cats = Object.fromEntries((await getAll('categories')).map((c) => [c.id, c]));
  let notes = res?.notes;
  if (!notes) notes = (await getAll('notes')).sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);
  const acts = res?.actions || [];
  box.innerHTML = `
    ${res ? '<h4>Acabo de guardar</h4>' : notes.length ? '<h4>Lo último</h4>' : ''}
    <div class="mini-grid">
      ${notes.map((n) => `<button class="mini-postit" data-id="${n.id}" style="--pc:${cats[n.categoryId]?.color || '#ffe17a'}">
        <span class="cat">${esc(cats[n.categoryId]?.name || '')}</span>
        <b>${KIND_ICON[n.kind] || ''} ${esc(n.title)}</b>
        ${n.datetime ? `<span class="when">${fmtDateTime(parseLocalISO(n.datetime))}</span>` : ''}
      </button>`).join('')}
      ${acts.map((a) => `<a class="mini-postit action" href="#notes" style="--pc:#d9d4ff"><span class="cat">Acción pendiente</span><b>📤 ${esc(a.summary)}</b></a>`).join('')}
    </div>`;
  const all = await getAll('notes');
  box.querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => openNoteEditor(all.find((n) => n.id === b.dataset.id))));
}

