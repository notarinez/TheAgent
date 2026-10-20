// Vista calendario: mes, día seleccionado y próximos recordatorios.
import { $, esc, localDay, parseLocalISO, fmtTime, fmtDateTime, KIND_ICON, pad } from '../util.js';
import { getAll, bus } from '../db.js';
import { openNoteEditor } from '../ui.js';

let root;
const now = new Date();
const state = { y: now.getFullYear(), m: now.getMonth(), sel: localDay(now) };
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function initCalendar() {
  root = $('#view-calendar');
  root.innerHTML = `
    <header class="view-head">
      <button class="icon-btn" id="c-prev" aria-label="Mes anterior">‹</button>
      <h2 id="c-title"></h2>
      <button class="icon-btn" id="c-next" aria-label="Mes siguiente">›</button>
    </header>
    <div class="cal-grid" id="c-grid"></div>
    <div class="row between"><h3 class="sec" id="c-day"></h3><button class="btn small" id="c-add">+ Añadir</button></div>
    <div id="c-list"></div>
    <h3 class="sec">Próximos</h3>
    <div id="c-next-list"></div>`;
  $('#c-prev').onclick = () => { if (--state.m < 0) { state.m = 11; state.y--; } render(); };
  $('#c-next').onclick = () => { if (++state.m > 11) { state.m = 0; state.y++; } render(); };
  $('#c-add').onclick = () => openNoteEditor(null, { kind: 'reminder', datetime: `${state.sel}T09:00`, alarm: true });
  bus.addEventListener('change', (e) => { if (['notes', 'categories'].includes(e.detail)) render(); });
}

export async function render() {
  if (!root) return;
  const [notes, cats] = await Promise.all([getAll('notes'), getAll('categories')]);
  const catById = Object.fromEntries(cats.map((c) => [c.id, c]));
  const dated = notes.filter((n) => parseLocalISO(n.datetime));
  const byDay = {};
  dated.forEach((n) => (byDay[n.datetime.slice(0, 10)] ||= []).push(n));

  $('#c-title').textContent = `${MONTHS[state.m]} ${state.y}`;
  const first = new Date(state.y, state.m, 1);
  const offset = (first.getDay() + 6) % 7; // lunes primero
  const days = new Date(state.y, state.m + 1, 0).getDate();
  const today = localDay();
  let html = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => `<span class="dow">${d}</span>`).join('');
  for (let i = 0; i < offset; i++) html += '<span></span>';
  for (let d = 1; d <= days; d++) {
    const key = `${state.y}-${pad(state.m + 1)}-${pad(d)}`;
    const items = byDay[key] || [];
    html += `<button class="day ${key === today ? 'today' : ''} ${key === state.sel ? 'sel' : ''}" data-day="${key}">
      <span>${d}</span><span class="dots">${items.slice(0, 4).map((n) => `<i style="background:${catById[n.categoryId]?.color || '#999'}"></i>`).join('')}</span></button>`;
  }
  $('#c-grid').innerHTML = html;
  $('#c-grid').querySelectorAll('[data-day]').forEach((b) => (b.onclick = () => { state.sel = b.dataset.day; render(); }));

  const selDate = parseLocalISO(state.sel);
  $('#c-day').textContent = selDate.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  const dayItems = (byDay[state.sel] || []).sort((a, b) => a.datetime.localeCompare(b.datetime));
  $('#c-list').innerHTML = dayItems.length ? dayItems.map((n) => row(n, catById, false)).join('') : '<p class="muted small">Nada este día.</p>';

  const upcoming = dated.filter((n) => !n.done && parseLocalISO(n.datetime) >= new Date(Date.now() - 3600000))
    .sort((a, b) => a.datetime.localeCompare(b.datetime)).slice(0, 12);
  $('#c-next-list').innerHTML = upcoming.length ? upcoming.map((n) => row(n, catById, true)).join('') : '<p class="muted small">No tienes nada próximo. Dile al agente «recuérdame…».</p>';

  root.querySelectorAll('.cal-item').forEach((el) => (el.onclick = () => openNoteEditor(notes.find((n) => n.id === el.dataset.id))));
}

function row(n, catById, withDate) {
  const d = parseLocalISO(n.datetime);
  const c = catById[n.categoryId];
  return `<button class="cal-item ${n.done ? 'done' : ''}" data-id="${n.id}" style="--pc:${c?.color || '#ccc'}">
    <span class="time">${n.allDay ? 'Todo el día' : withDate ? fmtDateTime(d) : fmtTime(d)}</span>
    <span class="t">${KIND_ICON[n.kind] || ''} ${esc(n.title)}${n.alarm ? ' ⏰' : ''}</span>
    <span class="muted small">${esc(c?.name || '')}</span>
  </button>`;
}
