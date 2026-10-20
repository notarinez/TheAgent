// Micrófono: nivel de voz en tiempo real (para los gestos) + grabación a WAV 16 kHz mono.
// Se usa WAV porque es un formato de audio que Gemini acepta con seguridad.
const TARGET_SR = 16000;
export const MAX_SECONDS = 240;

export class Recorder extends EventTarget {
  constructor() {
    super();
    this.active = false;
  }

  async start() {
    if (this.active) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    if (!this.ctx) {
      this.ctx = new AudioContext();
      await this.ctx.audioWorklet.addModule('js/pcm-worklet.js');
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});

    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.node = new AudioWorkletNode(this.ctx, 'pcm-capture');
    this.mute = this.ctx.createGain();
    this.mute.gain.value = 0;
    this.src.connect(this.analyser);
    this.src.connect(this.node).connect(this.mute).connect(this.ctx.destination);

    this.chunks = [];
    this.samples = 0;
    this.speechStart = -1;
    this.node.port.onmessage = (e) => {
      this.chunks.push(e.data);
      this.samples += e.data.length;
    };

    this.floor = 0;
    this.prev = 0;
    this.lastLoud = 0;
    this.buf = new Float32Array(this.analyser.fftSize);
    this.timer = setInterval(() => this._tick(), 60);
    this.active = true;
  }

  get suspended() {
    return this.ctx?.state === 'suspended';
  }

  resume() {
    return this.ctx?.resume();
  }

  get seconds() {
    return this.ctx ? this.samples / this.ctx.sampleRate : 0;
  }

  _tick() {
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sum / this.buf.length);

    // suelo de ruido adaptativo
    if (!this.floor) this.floor = rms;
    else this.floor = rms < this.floor ? this.floor * 0.9 + rms * 0.1 : this.floor * 0.997 + rms * 0.003;
    const thr = Math.max(0.012, this.floor * 3);
    const now = performance.now();
    if (rms > thr) {
      this.lastLoud = now;
      if (this.speechStart < 0) this.speechStart = this.samples;
    }
    const speaking = now - this.lastLoud < 350;
    if (rms > 0.25 && this.prev < 0.06) this.dispatchEvent(new Event('spike'));
    this.prev = rms;
    this.dispatchEvent(new CustomEvent('level', { detail: { level: Math.min(1, rms * 7), speaking } }));
  }

  get heardSpeech() {
    return this.speechStart >= 0;
  }

  _release() {
    clearInterval(this.timer);
    try { this.src.disconnect(); this.node.disconnect(); this.mute.disconnect(); } catch {}
    this.stream?.getTracks().forEach((t) => t.stop());
    this.active = false;
  }

  cancel() {
    if (!this.active) return;
    this._release();
    this.chunks = [];
  }

  // Devuelve { b64, mime, seconds } o null si no había voz.
  async stop() {
    if (!this.active) return null;
    const sr = this.ctx.sampleRate;
    const chunks = this.chunks;
    const start = this.speechStart;
    this._release();
    this.chunks = [];
    if (start < 0) return null;

    const total = chunks.reduce((a, c) => a + c.length, 0);
    const all = new Float32Array(total);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    // recorta el silencio inicial (dejando 0,6 s) para no gastar tokens en nada
    const from = Math.max(0, start - Math.round(sr * 0.6));
    const pcm = downsample(all.subarray(from), sr, TARGET_SR);
    const blob = encodeWav(pcm, TARGET_SR);
    return { b64: await blobToB64(blob), mime: 'audio/wav', seconds: pcm.length / TARGET_SR };
  }
}

function downsample(input, from, to) {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio), b = Math.min(input.length, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = a; j < b; j++) s += input[j];
    out[i] = s / Math.max(1, b - a);
  }
  return out;
}

function encodeWav(pcm, sr) {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

function blobToB64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
