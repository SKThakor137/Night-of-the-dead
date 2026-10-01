type Vec = { x: number; y: number; z: number };

/** Procedural WebAudio (no asset files). Created lazily on the first user gesture. Zombie sounds are 3D-positional. */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private growlCount = 0;
  private growlWindow = 0;

  /** Call from a user gesture (the click that locks the pointer). */
  resume() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private init() {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 1.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    this.startWind();
  }

  /** Quiet looping night wind. */
  private startWind() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320;
    const g = ctx.createGain(); g.gain.value = 0.07;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
    const lg = ctx.createGain(); lg.gain.value = 0.04;
    lfo.connect(lg); lg.connect(g.gain);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(); lfo.start();
  }

  setListener(p: Vec, fwd: Vec) {
    const l = this.ctx?.listener;
    if (!l || !l.positionX) return;
    l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
    l.forwardX.value = fwd.x; l.forwardY.value = fwd.y; l.forwardZ.value = fwd.z;
    l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
  }

  // ---- building blocks ----
  private dest(pos?: Vec): AudioNode {
    if (!pos) return this.master;
    const p = this.ctx!.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 4; p.maxDistance = 120; p.rolloffFactor = 1.3;
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    p.connect(this.master);
    return p;
  }

  noise(dur: number, type: BiquadFilterType, f0: number, f1: number, vol: number, delay = 0, pos?: Vec) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.dest(pos));
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0, pos?: Vec) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.dest(pos));
    o.start(t); o.stop(t + dur + 0.05);
  }

  // ---- weapons ----
  shot() {
    this.noise(0.2, 'lowpass', 4000, 300, 0.9);
    this.tone('square', 200, 45, 0.14, 0.55);
    this.tone('sawtooth', 1200, 200, 0.05, 0.25);
  }
  empty() { this.tone('square', 1300, 900, 0.035, 0.18); }
  /** stage 0 = magazine out, 1 = magazine in + slide */
  reload(stage: 0 | 1) {
    if (stage === 0) {
      this.noise(0.05, 'highpass', 2500, 2000, 0.3);
      this.tone('square', 500, 300, 0.05, 0.12);
    } else {
      this.noise(0.05, 'highpass', 3000, 2500, 0.35);
      this.tone('square', 700, 400, 0.04, 0.15);
      this.noise(0.07, 'highpass', 2000, 1500, 0.3, 0.12);
    }
  }
  knifeSwing() { this.noise(0.18, 'bandpass', 700, 2600, 0.35); }
  knifeHit() {
    this.noise(0.12, 'lowpass', 1600, 200, 0.6);
    this.tone('sine', 140, 50, 0.12, 0.4);
  }
  impact() { this.noise(0.05, 'bandpass', 2200, 1200, 0.18); }

  // ---- player ----
  hurt() {
    this.tone('sawtooth', 220, 90, 0.25, 0.4);
    this.noise(0.15, 'lowpass', 1200, 200, 0.4);
  }
  death() { this.tone('sawtooth', 200, 30, 1.4, 0.5); }
  heartbeat() {
    this.tone('sine', 70, 40, 0.12, 0.5);
    this.tone('sine', 62, 38, 0.14, 0.4, 0.17);
  }
  step() { this.noise(0.07, 'lowpass', 500, 200, 0.22); }
  flashlight() { this.tone('square', 2200, 1800, 0.02, 0.1); }
  waveStart() {
    this.tone('sawtooth', 55, 50, 1.6, 0.35);
    this.tone('sawtooth', 82, 78, 1.6, 0.22);
  }

  // ---- zombies (positional, rate limited) ----
  private growlOk() {
    const now = performance.now();
    if (now - this.growlWindow > 1000) { this.growlWindow = now; this.growlCount = 0; }
    return ++this.growlCount <= 3;
  }
  zombieGrowl(pos: Vec, type: string, loud = false) {
    if (!this.ctx || !this.growlOk()) return;
    const base = type === 'brute' ? 55 : type === 'runner' ? 110 : 80;
    const d = loud ? 0.9 : 0.6, v = loud ? 0.5 : 0.3;
    this.tone('sawtooth', base * (1 + Math.random() * 0.3), base * 0.6, d, v, 0, pos);
    this.noise(d * 0.8, 'bandpass', 300, 150, v * 0.6, 0, pos);
  }
  zombieAttack(pos: Vec) {
    this.tone('sawtooth', 160, 70, 0.18, 0.4, 0, pos);
    this.noise(0.15, 'bandpass', 500, 200, 0.35, 0, pos);
  }
  zombieHurt(pos: Vec) { this.tone('sawtooth', 180, 80, 0.2, 0.4, 0, pos); }
  zombieDie(pos: Vec) {
    this.tone('sawtooth', 130, 30, 0.8, 0.45, 0, pos);
    this.noise(0.5, 'lowpass', 600, 100, 0.3, 0, pos);
  }
}
