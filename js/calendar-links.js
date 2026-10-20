// Enlaces para llevar un recordatorio al calendario / alarma del móvil.
import { parseLocalISO, pad, timeZone } from './util.js';

const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const dayStamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

function range(note) {
  const start = parseLocalISO(note.datetime);
  const end = parseLocalISO(note.endDatetime) || new Date(start.getTime() + 30 * 60000);
  return { start, end };
}

export function googleCalendarUrl(note) {
  const { start, end } = range(note);
  const dates = note.allDay
    ? `${dayStamp(start)}/${dayStamp(new Date(start.getTime() + 86400000))}`
    : `${stamp(start)}/${stamp(end)}`;
  const p = new URLSearchParams({ action: 'TEMPLATE', text: note.title, details: note.content || '', dates, ctz: timeZone() });
  return `https://calendar.google.com/calendar/render?${p}`;
}

const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => '\\' + c);

export function downloadIcs(note) {
  const { start, end } = range(note);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TheAgent//ES', 'BEGIN:VEVENT',
    `UID:${note.id}@theagent`, `DTSTAMP:${stamp(new Date())}`,
    note.allDay ? `DTSTART;VALUE=DATE:${dayStamp(start)}` : `DTSTART:${stamp(start)}`,
    note.allDay ? `DTEND;VALUE=DATE:${dayStamp(new Date(start.getTime() + 86400000))}` : `DTEND:${stamp(end)}`,
    `SUMMARY:${icsEsc(note.title)}`, `DESCRIPTION:${icsEsc(note.content)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(note.title)}`, 'TRIGGER:-PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${note.title.replace(/[^\w\- ]+/g, '').slice(0, 40) || 'evento'}.ics` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Intent de Android para crear una alarma en el reloj del sistema.
// Experimental: depende de que Chrome deje abrir el intent desde una PWA.
export function androidAlarmUrl(note) {
  const d = parseLocalISO(note.datetime);
  const msg = encodeURIComponent(note.title.slice(0, 60));
  return `intent:#Intent;action=android.intent.action.SET_ALARM;i.android.intent.extra.alarm.HOUR=${d.getHours()};i.android.intent.extra.alarm.MINUTES=${d.getMinutes()};S.android.intent.extra.alarm.MESSAGE=${msg};end`;
}
