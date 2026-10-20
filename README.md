# TheAgent

Muñeco de notas por voz (PWA para Android). Abres la app, escucha directamente, y Gemini transcribe y decide dónde guardar cada cosa.

## Qué hace la v1

- **Muñeco animado** con 5 avatares (Gominola, Robotín, Fantasmín, Michi, Slime), cada uno con sus gestos y frases propios, y 7 estilos visuales (dibujo animado, plano, plastilina, boceto, tinta, neón, pastel) + color libre. Se elige en *Ajustes → Agente*, con vista previa para probar estados y gestos.
- **Gestos según lo que oye**: mano a la oreja y oreja que crece con el volumen cuando hablas, aburrido si no dices nada, sorpresa con ruidos fuertes, pensando mientras procesa, contento al guardar, y rarezas de vez en cuando (girar, esconderse, estornudar, transformarse, fallo de sistema, derretirse…). Se duerme y suelta el micro tras un rato sin voz.
- **Notas inteligentes**: una llamada a Gemini con el audio transcribe, separa en elementos (idea, tarea, recordatorio, evento, nota), elige la categoría y resuelve fechas («mañana a las 5»).
- **Aprendizaje**: cada categoría tiene una descripción que lee el agente, hay reglas libres, y si mueves una nota de categoría lo apunta como corrección para la próxima vez.
- **Post-its** por categorías, con filtros y búsqueda. **Calendario** mensual con próximos.
- **Recordatorios** con notificación + enlaces a Google Calendar, `.ics` o alarma de Android.
- **Acciones** (p. ej. «manda a Carlos Files lo de Wildforge de esta semana»): se guardan como pendientes y montan el texto; «Abrir WhatsApp» abre el selector de chat con el texto ya escrito.
- **API / Admin**: varias claves en rotación, límites diarios por clave, clave en uso, tokens del último turno, consumo de hoy, restante estimado e historial de 30 días.
- **Sin conexión**: si no hay red o se agotan las claves, el audio queda en cola y se reintenta solo.

## Probar en local

```bash
python -m http.server 8080
```

Abre http://localhost:8080 (en el PC el micro funciona en `localhost`).

## Instalar en el móvil

El micro y la instalación como app exigen HTTPS. La forma más sencilla es GitHub Pages:

1. Sube esta carpeta a un repositorio de GitHub.
2. *Settings → Pages → Deploy from branch → main / root*.
3. Abre la URL en Chrome Android → menú ⋮ → **Instalar aplicación**.
4. En la app: *Ajustes → API · Admin* → añade tu clave de [Google AI Studio](https://aistudio.google.com/apikey).

También vale Netlify, Cloudflare Pages o cualquier hosting estático.

## Limitaciones a tener en cuenta

- **Cuota restante**: la API de Gemini no informa de cuánto te queda. Lo «restante» se calcula con los límites que pongas a cada clave (mira los tuyos en AI Studio → *Rate limits*). Si no pones límites, la app rota cuando Gemini devuelve error de cuota.
- **Alarmas con la app cerrada**: una PWA no puede programar avisos exactos con la app cerrada del todo. Los avisos internos saltan si la app sigue viva en segundo plano; para algo fiable usa los botones de Google Calendar / `.ics` / alarma Android de cada recordatorio. Empaquetarla como app nativa (TWA/Capacitor) lo resolvería.
- **Claves de API**: se guardan solo en el móvil (IndexedDB). No las metas nunca en el código.

## Estructura

```
index.html · manifest.webmanifest · sw.js
css/app.css        interfaz
css/buddy.css      muñeco: estados, gestos, estilos
js/app.js          arranque y navegación
js/home.js         pantalla del agente (micro + muñeco + cerebro)
js/buddy.js        SVG, formas, avatares, estilos, gestos
js/recorder.js     micro, detección de voz, WAV 16 kHz
js/gemini.js       API, rotación de claves, consumo
js/agent.js        prompt, interpretación, cola offline, acciones
js/reminders.js    avisos
js/views/*.js      notas, calendario, ajustes
```

## Siguientes pasos naturales

- Preguntarle cosas a sus notas («¿qué te dije de Wildforge esta semana?»).
- WhatsApp/Gmail de verdad (necesitan un pequeño servidor o integraciones con OAuth).
- Más avatares (cada uno es una entrada en `AVATARS` de `js/buddy.js` + sus gestos en `css/buddy.css`).
