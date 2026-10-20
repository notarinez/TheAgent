// El "cerebro": arma el prompt, llama a Gemini, interpreta la respuesta y guarda notas/acciones.
import { settings } from './store.js';
import { generate, ApiError } from './gemini.js';
import { getAll, put, del, emit } from './db.js';
import { uid, toLocalISO, timeZone, PALETTE, parseLocalISO, fmtDate } from './util.js';

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcript: { type: 'STRING', description: 'Transcripción literal de lo que dijo el usuario.' },
    reply: { type: 'STRING', description: 'Respuesta corta y simpática del muñeco.' },
    mood: { type: 'STRING', enum: ['happy', 'surprised', 'confused', 'thinking'] },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          kind: { type: 'STRING', enum: ['idea', 'task', 'reminder', 'event', 'note'] },
          title: { type: 'STRING' },
          content: { type: 'STRING' },
          category: { type: 'STRING' },
          isNewCategory: { type: 'BOOLEAN' },
          tags: { type: 'ARRAY', items: { type: 'STRING' } },
          datetime: { type: 'STRING', nullable: true },
          endDatetime: { type: 'STRING', nullable: true },
          allDay: { type: 'BOOLEAN' },
          alarm: { type: 'BOOLEAN' },
        },
        required: ['kind', 'title', 'content', 'category'],
      },
    },
    actions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          type: { type: 'STRING', enum: ['whatsapp', 'email', 'other'] },
          target: { type: 'STRING', description: 'Destinatario: grupo, persona o email.' },
          message: { type: 'STRING', description: 'Texto a enviar si lo dictó el usuario.' },
          category: { type: 'STRING', nullable: true, description: 'Si pide enviar notas de una categoría.' },
          sinceDays: { type: 'INTEGER', nullable: true, description: 'Si pide notas de un periodo: días hacia atrás.' },
          summary: { type: 'STRING', description: 'Descripción corta de la acción.' },
        },
        required: ['type', 'summary'],
      },
    },
  },
  required: ['transcript', 'reply', 'items'],
};

async function systemPrompt() {
  const s = settings();
  const cats = (await getAll('categories')).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const lessons = (await getAll('lessons')).sort((a, b) => a.ts - b.ts).slice(-40);
  const now = new Date();
  const weekday = now.toLocaleDateString('es-ES', { weekday: 'long' });

  return `Eres «${s.name}», un muñeco asistente de notas por voz que vive en el móvil de tu usuario. Hablas español de España, con gracia y brevedad.
Ahora es ${weekday} ${toLocalISO(now)} (zona horaria ${timeZone()}).

TU TRABAJO
1. transcript: transcribe fielmente lo que dice (si te llega texto escrito, cópialo).
2. items: decide qué guardar. Si habla de varios temas, crea varios elementos. No inventes nada que no haya dicho.
   - kind: "idea" (ocurrencias/propuestas), "task" (algo por hacer sin hora), "reminder" (avisar en un momento), "event" (cita en el calendario), "note" (información a guardar).
   - title: corto, máx. 8 palabras. content: el contenido limpio y bien redactado, conservando TODOS los detalles.
   - category: elige UNA de las categorías existentes (escrita exactamente igual). Solo si claramente no encaja ninguna, inventa una nueva corta y pon isNewCategory=true.
   - tags: 0-4 etiquetas cortas en minúscula.
   - datetime: si hay fecha u hora, formato local "YYYY-MM-DDTHH:mm" sin zona. Resuelve lo relativo ("mañana a las 5", "el viernes"). Si solo hay día, allDay=true y hora 09:00. Si no hay fecha: null.
   - alarm: true si pide que le avises o le recuerdes algo con fecha/hora.
3. actions: si pide hacer algo que no es guardar una nota (mandar un WhatsApp, un email…), ponlo aquí y NO lo guardes como item. Si pide mandar notas de una categoría o periodo, rellena category y sinceDays (ej. "esta semana" = 7).
4. reply: máx. 20 palabras, con personalidad, confirmando qué has guardado y dónde.
5. Si el audio está vacío, es ruido o no se entiende: items=[], mood="confused" y una reply graciosa pidiendo que repita.

CATEGORÍAS EXISTENTES (nombre: qué va ahí)
${cats.map((c) => `- ${c.name}: ${c.description || '(sin descripción)'}`).join('\n') || '(ninguna)'}
${lessons.length ? `\nCORRECCIONES QUE TE HA HECHO EL USUARIO (aprende de ellas)\n${lessons.map((l) => `- «${l.text}» → no iba en «${l.from}», va en «${l.to}»`).join('\n')}\n` : ''}${s.rules?.trim() ? `\nREGLAS DEL USUARIO (obligatorias)\n${s.rules.trim()}\n` : ''}`;
}

export async function processInput(input) {
  const s = settings();
  const parts = input.type === 'audio'
    ? [{ inlineData: { mimeType: input.mime, data: input.b64 } }, { text: 'Procesa este audio del usuario.' }]
    : [{ text: input.text }];

  const body = {
    systemInstruction: { parts: [{ text: await systemPrompt() }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.4 },
  };
  if (/2\.5-flash/.test(s.model) && !s.thinking) body.generationConfig.thinkingConfig = { thinkingBudget: 0 };

  const { data, turn } = await generate(body, { kind: input.type });
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text) throw new ApiError('EMPTY', cand?.finishReason === 'SAFETY' ? 'Gemini ha bloqueado la respuesta.' : 'Gemini no ha devuelto nada.');
  let out;
  try {
    out = JSON.parse(text);
  } catch {
    throw new ApiError('PARSE', 'No he entendido la respuesta de Gemini.');
  }
  const saved = await applyResult(out, input);
  return { ...saved, out, turn };
}

async function applyResult(out, input) {
  const cats = await getAll('categories');
  const byName = new Map(cats.map((c) => [c.name.toLowerCase(), c]));
  const notes = [];
  for (const it of out.items || []) {
    const name = (it.category || 'Ideas').trim();
    let cat = byName.get(name.toLowerCase());
    if (!cat) {
      cat = { id: uid(), name, color: PALETTE[cats.length % PALETTE.length], description: 'Creada por el agente.', order: cats.length, createdAt: Date.now() };
      cats.push(cat);
      byName.set(name.toLowerCase(), cat);
      await put('categories', cat);
    }
    const note = {
      id: uid(),
      createdAt: input.ts || Date.now(),
      kind: it.kind || 'note',
      title: it.title || 'Sin título',
      content: it.content || '',
      categoryId: cat.id,
      tags: it.tags || [],
      datetime: parseLocalISO(it.datetime) ? it.datetime : null,
      endDatetime: parseLocalISO(it.endDatetime) ? it.endDatetime : null,
      allDay: !!it.allDay,
      alarm: !!it.alarm,
      done: false,
      notified: false,
      source: input.type,
      transcript: out.transcript || '',
    };
    await put('notes', note);
    notes.push(note);
  }
  const actions = [];
  for (const a of out.actions || []) {
    const act = { id: uid(), ts: Date.now(), status: 'pending', transcript: out.transcript || '', ...a };
    await put('actions', act);
    actions.push(act);
  }
  emit('notes');
  return { notes, actions };
}

// ---------- cola offline ----------
export async function enqueue(input) {
  await put('queue', { id: uid(), ts: Date.now(), ...input });
  emit('queue');
}

export async function flushQueue(onEach) {
  const items = (await getAll('queue')).sort((a, b) => a.ts - b.ts);
  let done = 0;
  for (const q of items) {
    try {
      const res = await processInput(q);
      await del('queue', q.id);
      done++;
      onEach?.(res);
    } catch (e) {
      if (e.retryable) break; // seguimos sin red / sin cuota: lo dejamos para luego
      await del('queue', q.id); // error definitivo: no lo reintentamos eternamente
    }
  }
  emit('queue');
  return { done, left: items.length - done };
}

// ---------- acciones (WhatsApp, email…) ----------
export async function composeAction(act) {
  if (act.message && !act.category) return act.message;
  const notes = await getAll('notes');
  const cats = await getAll('categories');
  let list = notes;
  if (act.category) {
    const c = cats.find((x) => x.name.toLowerCase() === act.category.toLowerCase());
    if (c) list = list.filter((n) => n.categoryId === c.id);
  }
  if (act.sinceDays) list = list.filter((n) => n.createdAt >= Date.now() - act.sinceDays * 86400000);
  list.sort((a, b) => a.createdAt - b.createdAt);
  const head = `${act.category ? `📂 ${act.category}` : '📝 Notas'}${act.sinceDays ? ` · últimos ${act.sinceDays} días` : ''}`;
  const body = list.map((n) => `• [${fmtDate(new Date(n.createdAt))}] ${n.title}\n${n.content}`).join('\n\n');
  return [act.message, head, body || '(no hay notas)'].filter(Boolean).join('\n\n');
}
