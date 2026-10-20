// El muñeco: SVG con formas que se transforman entre sí y estados/gestos por clases CSS.
import { rand, pick } from './util.js';

// ---------- Formas del cuerpo (todas con el mismo nº de puntos para poder transformarse) ----------
const N = 60, CX = 100, CY = 120;
const sgn = Math.sign;
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

const SHAPE_FN = {
  blob: (t, c, s) => [CX + 60 * c, CY + 62 * s * (s > 0 ? 0.93 : 1)],
  robot: (t, c, s) => [CX + 62 * sgn(c) * Math.abs(c) ** (1 / 3), CY + 58 * sgn(s) * Math.abs(s) ** (1 / 3)],
  ghost: (t, c, s) => (s <= 0
    ? [CX + 58 * c, 114 + 62 * s]
    : [CX + 58 * c, 114 + 64 * s ** 0.22 + 7 * Math.sin(c * Math.PI * 3) * s ** 3]),
  cat: (t, c, s) => {
    let r = 1;
    for (const e of [-Math.PI / 2 - 0.72, -Math.PI / 2 + 0.72]) r += 0.5 * Math.exp(-((angDiff(t, e) / 0.13) ** 2));
    return [CX + 60 * c * r, CY + 62 * s * (s > 0 ? 0.93 : 1) * r];
  },
  slime: (t, c, s) => {
    let y = CY + 4 + 58 * s * (s > 0 ? 0.95 : 1.05);
    if (s > 0) for (const [e, a] of [[0.75, 16], [1.9, 11], [2.5, 19]]) y += a * Math.exp(-(((t - e) / 0.1) ** 2));
    return [CX + 62 * c, y];
  },
  star: (t, c, s) => {
    const r = 50 + 16 * Math.cos(5 * (t + Math.PI / 2));
    return [CX + r * c, CY + r * s];
  },
};

// aclara (amt>0) u oscurece (amt<0) un color #rrggbb
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((c) => Math.round(amt > 0 ? c + (255 - c) * amt : c * (1 + amt)));
  return '#' + ch.map((c) => c.toString(16).padStart(2, '0')).join('');
}

const f1 = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
function catmull(pts) {
  const n = pts.length;
  let d = `M${f1(pts[0])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f1(c1)} ${f1(c2)} ${f1(p2)}`;
  }
  return d + ' Z';
}
const PATHS = {};
for (const [name, fn] of Object.entries(SHAPE_FN)) {
  const pts = [];
  for (let i = 0; i < N; i++) {
    const t = -Math.PI / 2 + (2 * Math.PI * i) / N;
    pts.push(fn(t, Math.cos(t), Math.sin(t)));
  }
  PATHS[name] = catmull(pts);
}

// Cada avatar: forma + colores (CSS .skin-x) + gestos propios + frases propias.
// "signature" son sus gestos característicos; "weird" los raros que hace para llamar la atención.
export const AVATARS = {
  blob: {
    name: 'Gominola', desc: 'Blandito y saltarín. Rebota de alegría y baila cuando se aburre.',
    signature: ['bounce', 'jump'], weird: ['dance', 'spin', 'shapeshift', 'shades'],
    lines: { greet: ['¡Boing! Te escucho.', '¡Hola! Estoy blandito y atento.'], bored: ['Boing… boing… ¿nada?', 'Me estoy derritiendo de aburrimiento.'], saved: ['¡Apuntado y rebotado!'] },
  },
  robot: {
    name: 'Robotín', desc: 'Pitidos, escáneres y algún fallo de sistema de vez en cuando.',
    signature: ['scan', 'glitch'], weird: ['glitch', 'scan', 'spin', 'shiver'],
    lines: { greet: ['SISTEMA ACTIVO. Te escucho, humano.', 'Bip bup. Micrófono online.'], bored: ['Entrando en modo ahorro… bip.', 'Calculando aburrimiento: 100 %.'], saved: ['Datos almacenados. Bip.'] },
  },
  ghost: {
    name: 'Fantasmín', desc: 'Se vuelve transparente, flota y te suelta algún «¡Bu!».',
    signature: ['fade', 'boo'], weird: ['boo', 'fade', 'hide', 'lookaround'],
    lines: { greet: ['Uuuh… te escucho desde el más allá.', '¿Me oyes? Yo a ti sí.'], bored: ['Uuuuh… qué silencio más fantasmal.', 'Voy a atravesar una pared, ahora vuelvo.'], saved: ['Guardado en el más allá.'] },
  },
  cat: {
    name: 'Michi', desc: 'Se lame la pata, bosteza mucho y se sorprende con cualquier ruido.',
    signature: ['groom', 'yawn'], weird: ['groom', 'yawn', 'sneeze', 'hide'],
    lines: { greet: ['Miau. Te escucho (si me apetece).', 'Prrr… dime.'], bored: ['Miau… me voy a dormir encima del teclado.', 'Prrr… ¿no hay atún?'], saved: ['Miau. Apuntado.'] },
  },
  slime: {
    name: 'Slime', desc: 'Se derrite, gotea y vuelve a su forma. Asquerosamente simpático.',
    signature: ['melt', 'bounce'], weird: ['melt', 'shapeshift', 'shiver', 'dance'],
    lines: { greet: ['Blurp. Te escucho.', '¡Slurp! Dime.'], bored: ['Blurp… me estoy escurriendo.', 'Goteando de aburrimiento…'], saved: ['¡Blurp! Pegado en su sitio.'] },
  },
};
// Estilos visuales (se combinan con cualquier avatar).
export const STYLES = {
  cartoon: { name: 'Dibujo animado', desc: 'Degradado suave y contorno. El de siempre.' },
  flat: { name: 'Plano', desc: 'Colores planos, minimalista, tipo icono.' },
  clay: { name: 'Plastilina', desc: 'Volumen y brillo, como de arcilla.' },
  sketch: { name: 'Boceto', desc: 'Trazo a lápiz tembloroso sobre papel.' },
  ink: { name: 'Tinta', desc: 'Blanco y negro, línea gruesa de cómic.' },
  neon: { name: 'Neón', desc: 'Solo contornos brillantes, ideal en modo oscuro.' },
  pastel: { name: 'Pastel', desc: 'Colores suaves y lavados.' },
};
export const SKINS = Object.fromEntries(Object.entries(AVATARS).map(([k, v]) => [k, v.name]));

// ---------- SVG ----------
const eye = (side, x) => `
  <clipPath id="clip-${side}"><ellipse cx="${x}" cy="108" rx="14" ry="15"/></clipPath>
  <g class="eye eye-${side}">
    <ellipse class="ew" cx="${x}" cy="108" rx="14" ry="15"/>
    <circle class="pupil" cx="${x}" cy="110" r="6.5"/>
    <circle class="glint" cx="${x + 2.5}" cy="107" r="2"/>
    <rect class="lid" clip-path="url(#clip-${side})" x="${x - 15}" y="92" width="30" height="31"/>
    <path class="happy-eye" d="M${x - 11} 112 Q${x} 98 ${x + 11} 112"/>
  </g>`;

const SVG = `
<svg class="buddy" viewBox="0 0 200 220" role="img" aria-label="Tu agente">
  <defs>
    <radialGradient id="bgrad" cx="38%" cy="30%" r="80%">
      <stop offset="0" class="g0"/><stop offset=".65" class="g1"/><stop offset="1" class="g2"/>
    </radialGradient>
    <filter id="f-sketch" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="2" seed="3"/>
      <feDisplacementMap in="SourceGraphic" scale="4"/>
    </filter>
    <filter id="f-neon" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="1.6" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="f-clay" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="4" result="blur"/>
      <feSpecularLighting in="blur" surfaceScale="5" specularConstant=".7" specularExponent="18" lighting-color="#fff" result="spec">
        <fePointLight x="40" y="-40" z="120"/>
      </feSpecularLighting>
      <feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn"/>
      <feComposite in="SourceGraphic" in2="specIn" operator="arithmetic" k1="0" k2="1" k3=".6" k4="0"/>
    </filter>
  </defs>
  <ellipse class="shadow" cx="100" cy="203" rx="52" ry="7"/>
  <g class="b-all">
    <g class="b-tilt">
      <g class="b-breath">
        <g class="antenna"><path d="M100 64 L100 40"/><circle cx="100" cy="36" r="6"/></g>
        <g class="ear ear-l"><circle class="ear-o" cx="40" cy="112" r="13"/><circle class="ear-in" cx="40" cy="112" r="6"/></g>
        <g class="ear ear-r"><circle class="ear-o" cx="160" cy="112" r="13"/><circle class="ear-in" cx="160" cy="112" r="6"/></g>
        <path class="body" fill="url(#bgrad)"/>
        <ellipse class="belly" cx="100" cy="152" rx="34" ry="20"/>
        <g class="robo-panel"><rect x="80" y="148" width="40" height="16" rx="4"/><circle cx="90" cy="156" r="3"/><circle cx="100" cy="156" r="3"/><circle cx="110" cy="156" r="3"/></g>
        ${eye('l', 78)}
        ${eye('r', 122)}
        <path class="brow brow-l" d="M66 88 Q78 82 90 88"/>
        <path class="brow brow-r" d="M110 88 Q122 82 134 88"/>
        <ellipse class="cheek" cx="64" cy="130" rx="8" ry="5"/>
        <ellipse class="cheek" cx="136" cy="130" rx="8" ry="5"/>
        <path class="mouth"/>
        <g class="shades">
          <path d="M58 100 h38 v10 q-2 12 -18 12 q-16 0 -20 -12 z M104 100 h38 v10 q-4 12 -20 12 q-16 0 -18 -12 z"/>
          <path class="bridge" d="M94 103 h12"/>
        </g>
        <path class="sweat" d="M146 84 q6 9 0 13 q-6 -4 0 -13z"/>
      </g>
    </g>
    <g class="hand hand-l"><circle cx="48" cy="170" r="11"/></g>
    <g class="hand hand-r"><circle cx="152" cy="170" r="11"/></g>
  </g>
  <g class="fx">
    <g class="waves"><path d="M192 104 q6 10 0 20"/><path d="M200 98 q10 16 0 32"/><path d="M208 92 q14 22 0 44"/></g>
    <g class="zzz"><text x="150" y="60">z</text><text x="165" y="42">z</text><text x="182" y="24">Z</text></g>
    <text class="qmark" x="150" y="62">?</text>
    <text class="bang" x="148" y="58">!</text>
    <g class="dots"><circle cx="140" cy="54" r="5"/><circle cx="156" cy="44" r="6.5"/><circle cx="175" cy="30" r="8"/></g>
    <g class="sparkles"><path d="M30 60 l4 10 l10 4 l-10 4 l-4 10 l-4 -10 l-10 -4 l10 -4z"/><path d="M168 46 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3z"/><path d="M178 150 l3 6 l6 3 l-6 3 l-3 6 l-3 -6 l-6 -3 l6 -3z"/></g>
    <text class="achis" x="100" y="30">¡Achís!</text>
    <g class="notes"><text x="30" y="70">♪</text><text x="160" y="56">♫</text></g>
  </g>
</svg>`;

// Gestos puntuales: nombre -> duración (ms)
export const ACTS = {
  jump: 650, spin: 1100, hide: 1900, sneeze: 1500, dance: 2400, shades: 3200,
  yawn: 2200, shapeshift: 2400, lookaround: 2200, shiver: 1200,
  bounce: 1400, scan: 1800, glitch: 1100, fade: 2600, boo: 1300, groom: 2400, melt: 2600,
};
export const WEIRD_ACTS = ['spin', 'hide', 'sneeze', 'dance', 'shades', 'shapeshift', 'lookaround', 'shiver'];
const ACT_LINES = {
  bounce: '¡Boing, boing!', scan: 'Escaneando entorno…', glitch: 'Err0r… r3iniciand0…', fade: 'Ahora me ves…',
  boo: '¡BU!', groom: 'Un momento, que me aseo.', melt: 'Me derritooo…',
};

const GAZE = {
  listening: [4, -1], thinking: [-4, -5], surprised: [0, 0], happy: [0, 0], confused: [3, -3],
};

export class Buddy {
  constructor(host, skin = 'blob', style = 'cartoon', color = '') {
    // ids únicos por instancia (puede haber varias vistas previas en Ajustes)
    const sfx = Math.random().toString(36).slice(2, 7);
    host.innerHTML = SVG.replace(/id="([\w-]+)"/g, `id="$1-${sfx}"`).replace(/url\(#([\w-]+)\)/g, `url(#$1-${sfx})`);
    this.svg = host.querySelector('svg');
    this.body = this.svg.querySelector('.body');
    this.state = 'idle';
    this.acting = null;
    this.svg.classList.add('st-idle');
    this.sfx = sfx;
    this.setSkin(skin);
    this.setStyle(style);
    this.setColor(color);
    this._blinkLoop();
    this._wanderLoop();
  }

  setSkin(skin) {
    this.skin = AVATARS[skin] ? skin : 'blob';
    this.avatar = AVATARS[this.skin];
    [...this.svg.classList].filter((c) => c.startsWith('skin-')).forEach((c) => this.svg.classList.remove(c));
    this.svg.classList.add('skin-' + this.skin);
    this.setShape(this.skin);
  }

  setStyle(style) {
    this.style = STYLES[style] ? style : 'cartoon';
    [...this.svg.classList].filter((c) => c.startsWith('style-')).forEach((c) => this.svg.classList.remove(c));
    this.svg.classList.add('style-' + this.style);
    const filter = { sketch: 'f-sketch', neon: 'f-neon', clay: 'f-clay' }[this.style];
    const g = this.svg.querySelector('.b-all');
    if (filter) g.setAttribute('filter', `url(#${filter}-${this.sfx})`);
    else g.removeAttribute('filter');
  }

  // Color personalizado del cuerpo (vacío = el del avatar).
  setColor(hex) {
    const st = this.svg.style;
    if (!hex) { ['--body', '--body-l', '--body-d'].forEach((p) => st.removeProperty(p)); return; }
    st.setProperty('--body', hex);
    st.setProperty('--body-l', shade(hex, 0.45));
    st.setProperty('--body-d', shade(hex, -0.3));
  }

  setShape(name) {
    this.body.style.d = `path("${PATHS[name] || PATHS.blob}")`;
  }

  setState(s) {
    if (this.state === s) return;
    this.svg.classList.remove('st-' + this.state);
    this.state = s;
    this.svg.classList.add('st-' + s);
    const g = GAZE[s];
    if (g) this.look(...g);
    else if (s === 'bored') this.look(rand(-5, 5), 4);
    else this.look(0, 0);
  }

  setLevel(l) {
    this.svg.style.setProperty('--lvl', l.toFixed(3));
  }

  look(x, y) {
    this.svg.style.setProperty('--px', x.toFixed(1));
    this.svg.style.setProperty('--py', y.toFixed(1));
  }

  talk(on) {
    this.svg.classList.toggle('talking', on);
  }

  act(name) {
    if (this.acting || !ACTS[name]) return Promise.resolve(false);
    this.acting = name;
    this.svg.classList.add('act-' + name);
    const dur = ACTS[name];
    if (name === 'shapeshift') this._shapeshift(dur);
    if (name === 'lookaround') this._lookaround(dur);
    return new Promise((resolve) => setTimeout(() => {
      this.svg.classList.remove('act-' + name);
      this.acting = null;
      resolve(true);
    }, dur));
  }

  // Gesto raro propio del avatar (o uno genérico de vez en cuando). Devuelve { name, text }.
  randomWeird() {
    const pool = Math.random() < 0.75 ? this.avatar.weird : WEIRD_ACTS;
    const name = pick(pool);
    return { name, text: ACT_LINES[name] ?? LINES.weird[name] ?? '' };
  }

  signature() {
    return pick(this.avatar.signature);
  }

  // Frase del avatar si tiene una propia para esa situación; si no, la genérica.
  say(kind) {
    const own = this.avatar.lines[kind];
    if (own && (Math.random() < 0.6 || !LINES[kind])) return pick(own);
    return LINES[kind] ? pick(LINES[kind]) : '';
  }

  _shapeshift(dur) {
    const seq = ['star', ...Object.keys(SKINS).filter((s) => s !== this.skin)].sort(() => Math.random() - 0.5).slice(0, 4);
    const step = dur / (seq.length + 1);
    seq.forEach((s, i) => setTimeout(() => this.setShape(s), i * step));
    setTimeout(() => this.setShape(this.skin), seq.length * step);
  }

  _lookaround(dur) {
    const pts = [[-6, 0], [6, 0], [-6, -2], [6, -2], [0, 0]];
    pts.forEach((p, i) => setTimeout(() => this.look(...p), (i * dur) / pts.length));
  }

  _blinkLoop() {
    const go = () => {
      if (!['sleeping', 'happy'].includes(this.state)) {
        this.svg.classList.add('blink');
        setTimeout(() => this.svg.classList.remove('blink'), 140);
        if (Math.random() < 0.2) setTimeout(() => {
          this.svg.classList.add('blink');
          setTimeout(() => this.svg.classList.remove('blink'), 120);
        }, 260);
      }
      setTimeout(go, rand(2200, 5500));
    };
    setTimeout(go, 1500);
  }

  _wanderLoop() {
    const go = () => {
      if (!this.acting && (this.state === 'idle' || this.state === 'bored')) {
        if (Math.random() < 0.6) this.look(rand(-6, 6), this.state === 'bored' ? rand(1, 5) : rand(-4, 3));
        else this.look(0, 0);
      }
      setTimeout(go, rand(1200, 3200));
    };
    setTimeout(go, 2000);
  }
}

export const LINES = {
  greet: ['¡Hola! Te escucho.', 'Dime, dime…', '¿Qué se te ha ocurrido?', 'Soy todo orejas.', 'Listo para apuntar.'],
  listening: ['Mmm…', 'Ajá…', 'Sigo…', 'Te escucho…'],
  bored: ['¿Me cuentas algo?', 'Me aburrooo…', '…', 'Estoy aquí, ¿eh?', '¿Hola? ¿Hay alguien?', 'Tic, tac…'],
  surprised: ['¡Uy!', '¡Anda!', '¡Oh!', '¿Eh?'],
  weird: {
    spin: '¡Mira qué giro!', hide: '¡Cucú!', sneeze: '', dance: '♪ Bailando por aburrimiento ♪',
    shades: 'Modo guay activado.', shapeshift: 'A veces me transformo. Cosas mías.',
    lookaround: '¿Has oído eso?', shiver: 'Brrr… qué frío hace aquí dentro.',
  },
  sleeping: ['Zzz… (tócame para despertarme)'],
  tickle: ['¡Jiji, cosquillas!', '¡Eh! Primero háblame.', '¿Sí? Dime algo.'],
  nothing: ['No he oído nada… ¿repites?', 'Silencio total. ¿Probamos otra vez?'],
  saved: ['¡Apuntado!', 'Guardado.'],
};
export const line = (k) => pick(LINES[k]);
