// Vista de notas: post-its agrupados por categoría, filtros y acciones pendientes.
import { $, esc, hashStr, KIND_ICON, KIND_LABEL, fmtDateTime, fmtAgo, parseLocalISO } from '../util.js';
import { getAll, put, bus, emit } from '../db.js';
import { openNoteEditor, toast } from '../ui.js';
import { composeAction } from '../agent.js';

const state = { cat: 'all', kind: 'all', q: '', showDone: false };
let root;

export function initNotes() {
  root = $('#view-notes');
  root.innerHTML = `
    <header class="view-head">
      <h2>Notas</h2>
      <button class="btn primary small" id="n-add">+ Nueva</button>
    </header>
    <input class="search" id="n-q" type="search" placeholder="Buscar…">
    <div class="chips" id="n-cats"></div>
    <div class="chips small" id="n-kinds"></div>
    <div id="n-actions"></div>
    <div id="n-list"></div>`;
  $('#n-add').onclick = () => openNoteEditor(null, state.cat !== 'all' ? { categoryId: state.cat } : {});
  $('#n-q').oninput = (e) => { state.q = e.target.value.toLowerCase(); render(); };
  bus.addEventListener('change', (e) => { if (['notes', 'categories', 'actions'].includes(e.detail)) render(); });
}

export async function render() {
  if (!root) return;
  const [notes, cats, actions] = await Promise.all([getAll('notes'), getAll('categories'), getAll('actions')]);
  cats.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const catById = Object.fromEntries(cats.map((c) => [c.id, c]));

  // chips de categoría
  const counts = {};
  notes.forEach((n) => (counts[n.categoryId] = (counts[n.categoryId] || 0) + 1));
  $('#n-cats').innerHTML = [`<button class="chip ${state.cat === 'all' ? 'on' : ''}" data-cat="all">Todas · ${notes.length}</button>`,
    ...cats.map((c) => `<button class="chip ${state.cat === c.id ? 'on' : ''}" data-cat="${c.id}" style="--cc:${c.color}"><i></i>${esc(c.name)} · ${counts[c.id] || 0}</button>`)].join('');
  $('#n-cats').querySelectorAll('[data-cat]').forEach((b) => (b.onclick = () => { state.cat = b.dataset.cat; render(); }));

  $('#n-kinds').innerHTML = [['all', 'Todo'], ...Object.entries(KIND_LABEL)].map(([k, v]) =>
    `<button class="chip ${state.kind === k ? 'on' : ''}" data-kind="${k}">${k === 'all' ? '' : KIND_ICON[k] + ' '}${v}</button>`).join('') +
    `<button class="chip ${state.showDone ? 'on' : ''}" data-done>✔ Mostrar hechas</button>`;
  $('#n-kinds').querySelectorAll('[data-kind]').forEach((b) => (b.onclick = () => { state.kind = b.dataset.kind; render(); }));
  $('#n-kinds').querySelector('[data-done]').onclick = () => { state.showDone = !state.showDone; render(); };

  // acciones pendientes (WhatsApp, email…)
  const pend = actions.filter((a) => a.status === 'pending').sort((a, b) => b.ts - a.ts);
  $('#n-actions').innerHTML = pend.length ? `
    <h3 class="sec">📤 Acciones que me has pedido</h3>
    ${pend.map((a) => `
      <div class="action-card" data-id="${a.id}">
        <div><b>${esc(a.summary)}</b><div class="muted small">${a.type === 'whatsapp' ? 'WhatsApp' : a.type === 'email' ? 'Email' : 'Otra'}${a.target ? ' → ' + esc(a.target) : ''} · ${fmtAgo(a.ts)}</div></div>
        <div class="row">
          ${a.type === 'whatsapp' ? '<button class="btn small primary" data-go="wa">Abrir WhatsApp</button>' : ''}
          ${a.type === 'email' ? '<button class="btn small primary" data-go="mail">Abrir email</button>' : ''}
          <button class="btn small" data-go="copy">Copiar</button>
          <button class="btn small ghost" data-go="done">Hecho</button>
        </div>
      </div>`).join('')}` : '';
  $('#n-actions').querySelectorAll('[data-go]').forEach((b) => (b.onclick = async () => {
    const act = pend.find((a) => a.id === b.closest('[data-id]').dataset.id);
    const text = await composeAction(act);
    if (b.dataset.go === 'wa') window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    if (b.dataset.go === 'mail') location.href = `mailto:${/@/.test(act.target || '') ? act.target : ''}?subject=${encodeURIComponent(act.summary)}&body=${encodeURIComponent(text)}`;
    if (b.dataset.go === 'copy') { await navigator.clipboard.writeText(text); toast('Copiado'); }
    if (b.dataset.go === 'done') { act.status = 'done'; await put('actions', act); emit('actions'); }
  }));

  // lista filtrada
  let list = notes.filter((n) =>
    (state.cat === 'all' || n.categoryId === state.cat) &&
    (state.kind === 'all' || n.kind === state.kind) &&
    (state.showDone || !n.done) &&
    (!state.q || `${n.title} ${n.content} ${(n.tags || []).join(' ')}`.toLowerCase().includes(state.q)));
  list.sort((a, b) => b.createdAt - a.createdAt);

  const groups = state.cat === 'all'
    ? cats.map((c) => [c, list.filter((n) => n.categoryId === c.id)]).filter(([, l]) => l.length)
    : [[catById[state.cat], list]];
  const orphans = list.filter((n) => !catById[n.categoryId]);
  if (state.cat === 'all' && orphans.length) groups.push([{ name: 'Sin categoría', color: '#ddd' }, orphans]);

  $('#n-list').innerHTML = list.length ? groups.map(([c, l]) => `
    <section class="cat-group">
      ${state.cat === 'all' ? `<h3 class="sec"><i class="dot" style="background:${c.color}"></i>${esc(c.name)} <span class="muted">${l.length}</span></h3>` : ''}
      <div class="postits">${l.map((n) => postit(n, c)).join('')}</div>
    </section>`).join('')
    : `<div class="empty">${notes.length ? 'Nada con esos filtros.' : 'Aún no hay notas. Ve al agente y cuéntale algo 🎙️'}</div>`;

  $('#n-list').querySelectorAll('.postit').forEach((el) => {
    el.onclick = (e) => {
      const n = notes.find((x) => x.id === el.dataset.id);
      if (e.target.closest('[data-check]')) { n.done = !n.done; put('notes', n).then(() => emit('notes')); return; }
      openNoteEditor(n);
    };
  });
}

function postit(n, c) {
  const rot = ((hashStr(n.id) % 50) - 25) / 10;
  const when = n.datetime ? parseLocalISO(n.datetime) : null;
  return `<article class="postit ${n.done ? 'done' : ''}" data-id="${n.id}" style="--pc:${c?.color || '#ffe17a'};--rot:${rot}deg">
    <header><span>${KIND_ICON[n.kind] || ''} ${KIND_LABEL[n.kind] || ''}</span>${['task', 'reminder'].includes(n.kind) ? `<button class="check-btn" data-check aria-label="Hecho">${n.done ? '✔' : '○'}</button>` : ''}</header>
    <h4>${esc(n.title)}</h4>
    <p>${esc(n.content).slice(0, 260)}</p>
    <footer>
      ${when ? `<span class="when ${n.alarm ? 'alarm' : ''}">${n.alarm ? '⏰' : '📅'} ${fmtDateTime(when)}</span>` : ''}
      ${(n.tags || []).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}
      <span class="muted">${fmtAgo(n.createdAt)}</span>
    </footer>
  </article>`;
}

