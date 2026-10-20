// Piezas de interfaz compartidas: aviso, confirmación y editor de notas.
import { $, esc, KIND_LABEL, KIND_ICON, parseLocalISO, fmtDateTime, uid } from './util.js';
import { getAll, put, del, emit } from './db.js';
import { googleCalendarUrl, downloadIcs, androidAlarmUrl } from './calendar-links.js';

let toastTimer;
export function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

export function openDialog(html, onMount) {
  const dlg = $('#dlg');
  dlg.innerHTML = html;
  dlg.showModal();
  dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
  onMount?.(dlg);
  return dlg;
}

export function confirmBox(msg, okLabel = 'Sí') {
  return new Promise((resolve) => {
    const dlg = openDialog(`<div class="dlg-body"><p>${esc(msg)}</p><div class="row end"><button class="btn" data-r="0">Cancelar</button><button class="btn danger" data-r="1">${esc(okLabel)}</button></div></div>`);
    dlg.querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => { dlg.close(); resolve(b.dataset.r === '1'); }));
    dlg.addEventListener('close', () => resolve(false), { once: true });
  });
}

// Editor de una nota (crear si note es null).
export async function openNoteEditor(note, defaults = {}) {
  const cats = (await getAll('categories')).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const isNew = !note;
  note = note || { id: uid(), createdAt: Date.now(), kind: 'note', title: '', content: '', categoryId: cats[0]?.id, tags: [], datetime: null, allDay: false, alarm: false, done: false, notified: false, source: 'manual', ...defaults };
  const original = note.categoryId;
  const hasDate = !!note.datetime;

  const dlg = openDialog(`
    <form class="dlg-body editor" method="dialog">
      <div class="row between"><h3>${isNew ? 'Nueva nota' : 'Editar'}</h3><button class="icon-btn" value="cancel" aria-label="Cerrar">✕</button></div>
      <input name="title" placeholder="Título" value="${esc(note.title)}" required>
      <textarea name="content" rows="5" placeholder="Contenido">${esc(note.content)}</textarea>
      <div class="grid2">
        <label>Tipo<select name="kind">${Object.entries(KIND_LABEL).map(([k, v]) => `<option value="${k}" ${k === note.kind ? 'selected' : ''}>${KIND_ICON[k]} ${v}</option>`).join('')}</select></label>
        <label>Categoría<select name="categoryId">${cats.map((c) => `<option value="${c.id}" ${c.id === note.categoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      </div>
      <label>Fecha y hora<input type="datetime-local" name="datetime" value="${hasDate ? esc(note.datetime.slice(0, 16)) : ''}"></label>
      <div class="row wrap">
        <label class="check"><input type="checkbox" name="alarm" ${note.alarm ? 'checked' : ''}> Avisarme</label>
        <label class="check"><input type="checkbox" name="allDay" ${note.allDay ? 'checked' : ''}> Todo el día</label>
        <label class="check"><input type="checkbox" name="done" ${note.done ? 'checked' : ''}> Hecho</label>
      </div>
      <input name="tags" placeholder="etiquetas, separadas, por comas" value="${esc((note.tags || []).join(', '))}">
      ${hasDate ? `
      <div class="links">
        <span class="muted small">Llevar a: </span>
        <a class="chip" href="${googleCalendarUrl(note)}" target="_blank" rel="noopener">Google Calendar</a>
        <button type="button" class="chip" data-ics>Archivo .ics</button>
        <a class="chip" href="${androidAlarmUrl(note)}">Alarma Android (beta)</a>
      </div>` : ''}
      ${note.transcript ? `<details><summary class="muted small">Transcripción original</summary><p class="small">${esc(note.transcript)}</p></details>` : ''}
      <p class="muted small">${note.source === 'audio' ? '🎙️ por voz' : note.source === 'text' ? '⌨️ escrito' : '✍️ manual'} · ${fmtDateTime(new Date(note.createdAt))}</p>
      <div class="row between">
        ${isNew ? '<span></span>' : '<button type="button" class="btn danger" data-del>Borrar</button>'}
        <button class="btn primary" value="save">Guardar</button>
      </div>
    </form>`);

  dlg.querySelector('[data-ics]')?.addEventListener('click', () => downloadIcs(note));

  return new Promise((resolve) => {
    dlg.querySelector('[data-del]')?.addEventListener('click', async () => {
      dlg.close();
      if (await confirmBox('¿Borrar esta nota?', 'Borrar')) {
        await del('notes', note.id);
        emit('notes');
        toast('Nota borrada');
      }
      resolve(null);
    });
    dlg.querySelector('form').addEventListener('submit', async (e) => {
      if (e.submitter?.value !== 'save') return resolve(null);
      const f = new FormData(e.target);
      const dt = f.get('datetime');
      const updated = {
        ...note,
        title: f.get('title').trim(),
        content: f.get('content').trim(),
        kind: f.get('kind'),
        categoryId: f.get('categoryId'),
        datetime: dt || null,
        alarm: !!f.get('alarm') && !!dt,
        allDay: !!f.get('allDay'),
        done: !!f.get('done'),
        tags: f.get('tags').split(',').map((t) => t.trim()).filter(Boolean),
      };
      if (updated.datetime !== note.datetime) updated.notified = parseLocalISO(updated.datetime)?.getTime() <= Date.now();
      await put('notes', updated);
      // Si el usuario corrige la categoría que eligió el agente, lo apuntamos como lección.
      if (!isNew && original !== updated.categoryId && note.source !== 'manual') await learn(updated, original, cats);
      emit('notes');
      resolve(updated);
    });
  });
}

async function learn(note, fromId, cats) {
  const from = cats.find((c) => c.id === fromId)?.name;
  const to = cats.find((c) => c.id === note.categoryId)?.name;
  if (!from || !to) return;
  await put('lessons', { id: uid(), ts: Date.now(), text: `${note.title}: ${note.content}`.slice(0, 140), from, to });
  toast(`Aprendido: esto va en «${to}» 🧠`);
}
