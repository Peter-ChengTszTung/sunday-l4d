// All sound is synthesised with WebAudio — no asset files to ship.
//
// Mix graph:
//   positional voice ─► lowpass (air + occlusion + behind) ─► pan ─┬─► dry (distance) ─► world ─┐
//                                                                 └─► send ─► reverb ──────────┤
//   local voice (your gun, steps, foley) ─► local ─► world (+ a small reverb send) ────────────┤
//   ambience beds ─► ambLP (dull indoors) ─┐                                                   │
//   horde murmur, tension drone ───────────┴─► duck (dips under big blasts) ───────────────────┤
//                                                                                              ▼
//                                     muffle (down / pinned / near death / shellshock) ─► master ─► limiter ─► out
//   ui (pickups, stingers, heartbeat, tinnitus) ──────────────────────────────────────► master
import { WEAPONS, ZT, ZSTATE } from '../../shared/constants';

/** What the listener is doing; main.ts feeds this every frame through `update`. */
export interface Listener {
  x: number; z: number;
  /** Facing on the ground plane (unit vector). */ fx: number; fz: number;
  indoor: boolean;
  /** 0 healthy … 1 nearly dead. */ hurt: number;
  down: boolean; dead: boolean; pinned: boolean;
  /** Awake infected within ~22 m. */ threat: number;
  /** A holdout or crescendo is running. */ holdout: boolean;
}

interface Emit {
  /** Distance scale: 2 means it carries twice as far (`att(d / 2)`). */ reach?: number;
  /** Reverb send at close range (the send falls off slower than the dry signal). */ wet?: number;
  /** Random pitch spread (0.05 = ±5 %) so repeats never sound identical. */ jit?: number;
  /** Survives the voice cap (special-infected tells, your own gun). */ prio?: boolean;
  /** Walls muffle it (default true). */ occlude?: boolean;
}

/** Above this many live voices, quiet far sounds are dropped; at it, everything but `prio`. */
const MAX_VOICES = 90;
/** Vowel formant pairs (Hz): "ah", "oh", "oo", "uh". */
const VOWELS: readonly [number, number][] = [[650, 1080], [450, 800], [320, 900], [560, 1450]];
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const pick = <T>(xs: readonly T[]): T => xs[(Math.random() * xs.length) | 0];

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  /** 4 s of decorrelated stereo noise for the looping beds (a 1 s loop is audible as a pattern). */
  private wide!: AudioBuffer;
  muted = false;
  /** Set by main.ts: true when a wall stands between the listener and (x, z). */
  occluded: ((x: number, z: number) => boolean) | null = null;

  private world!: GainNode; private local!: GainNode; private ui!: GainNode;
  private muffle!: BiquadFilterNode; private verbIn!: GainNode; private verbOut!: GainNode; private verbRoom!: GainNode;
  private duck!: GainNode; private ambLP!: BiquadFilterNode;
  private hordeG!: GainNode; private tensionG!: GainNode; private dissG!: GainNode;
  /** Where helper voices connect and a pitch multiplier; both are set for the duration of `emit`. */
  private out!: AudioNode; private pj = 1;
  private voices = 0;
  private lis: Listener = { x: 0, z: 0, fx: 0, fz: -1, indoor: false, hurt: 0, down: false, dead: false, pinned: false, threat: 0, holdout: false };
  /** Chapter index whose ambience should play (-1 = the shooting range), and the one that is built. */
  private scene = -2; private built = -2;
  private bed: { srcs: AudioScheduledSourceNode[]; out: GainNode; outdoor: GainNode; indoor: GainNode } | null = null;
  private ambT = 6; private dripT = 0; private beatT = 0; private ctlT = 0; private shell = 0; private tension = 0;
  /** Scheduled reload foley, cut short if the reload is cancelled. */
  private pending: AudioScheduledSourceNode[] = [];

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const c = (this.ctx = new Ctor());
    this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.wide = c.createBuffer(2, c.sampleRate * 4, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const w = this.wide.getChannelData(ch); for (let i = 0; i < w.length; i++) w[i] = Math.random() * 2 - 1; }

    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    // A bus limiter, not a pumping compressor: single sounds pass untouched, pile-ups get caught.
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -8; lim.knee.value = 6; lim.ratio.value = 8; lim.attack.value = 0.003; lim.release.value = 0.25;
    this.master.connect(lim).connect(c.destination);
    this.muffle = c.createBiquadFilter();
    this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000; this.muffle.Q.value = 0.6;
    this.muffle.connect(this.master);
    this.world = this.gain(1, this.muffle);
    this.ui = this.gain(1, this.master);
    // Reverb: a long dark street with slapback off buildings, and a short bright room; crossfaded.
    this.verbIn = this.gain(1);
    const street = c.createConvolver(), room = c.createConvolver();
    street.buffer = this.impulse(2.6, 2.4, 3200, [0.09, 0.17, 0.29, 0.43]);
    room.buffer = this.impulse(0.9, 3.2, 6500, []);
    this.verbOut = this.gain(0.45, this.muffle); this.verbRoom = this.gain(0, this.muffle);
    this.verbIn.connect(street).connect(this.verbOut);
    this.verbIn.connect(room).connect(this.verbRoom);
    this.local = this.gain(1, this.world);
    this.local.connect(this.gain(0.16, this.verbIn));
    this.out = this.local;
    this.duck = this.gain(1, this.muffle);
    this.ambLP = c.createBiquadFilter();
    this.ambLP.type = 'lowpass'; this.ambLP.frequency.value = 18000;
    this.ambLP.connect(this.duck);

    // Horde murmur: many throats through moving vowel filters, plus a detuned low moan. Silent until a crowd is near.
    const keep: AudioScheduledSourceNode[] = [];
    this.hordeG = this.gain(0, this.duck);
    const m1 = this.bedNoise('bandpass', 380, 1.4, 0.9, this.hordeG, keep), m2 = this.bedNoise('bandpass', 950, 3, 0.6, this.hordeG, keep);
    this.lfo(m1.f.frequency, 0.6, 150, keep); this.lfo(m2.f.frequency, 1.3, 320, keep); this.lfo(m2.g.gain, 2.7, 0.35, keep);
    const moanLP = c.createBiquadFilter(); moanLP.type = 'lowpass'; moanLP.frequency.value = 520;
    moanLP.connect(this.gain(0.14, this.hordeG));
    for (const f of [78, 91, 104, 123]) { const o = this.bedTone('sawtooth', f, 0.25, moanLP, keep); this.lfo(o.o.frequency, rnd(0.15, 0.4), f * 0.06, keep); }
    // Tension drone: a low open fifth that is barely there, and a minor-second rub that grows with the danger.
    this.tensionG = this.gain(0, this.duck);
    const breath = this.gain(0.75, this.tensionG); this.lfo(breath.gain, 0.07, 0.25, keep);
    const droneLP = c.createBiquadFilter(); droneLP.type = 'lowpass'; droneLP.frequency.value = 420; droneLP.connect(breath);
    this.bedTone('sine', 55, 0.6, droneLP, keep); this.bedTone('triangle', 82.4, 0.3, droneLP, keep);
    this.dissG = this.gain(0, droneLP);
    this.bedTone('sine', 58.3, 0.5, this.dissG, keep); this.bedTone('triangle', 116.5, 0.25, this.dissG, keep);
  }

  setMuted(m: boolean): void { this.muted = m; if (this.ctx) this.master.gain.value = m ? 0 : 0.5; }

  // ------------------------------------------------------------------ helpers
  private gain(v: number, to?: AudioNode): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = v;
    if (to) g.connect(to);
    return g;
  }

  /** Synthesised impulse response: noise with a darkening tail and optional discrete echoes. */
  private impulse(sec: number, decay: number, bright: number, echoes: number[]): AudioBuffer {
    const c = this.ctx!, sr = c.sampleRate, n = Math.floor(sr * sec), b = c.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n, k = Math.exp((-2 * Math.PI * bright * (1 - 0.85 * t)) / sr);
        lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
        d[i] = lp * (1 - t) ** decay;
      }
      for (const e of echoes) {
        const at = Math.floor((e + ch * 0.011) * sr), amp = 0.35 * (1 - e / sec);
        for (let j = 0; j < 400 && at + j < n; j++) d[at + j] += (Math.random() * 2 - 1) * amp * (1 - j / 400);
      }
    }
    return b;
  }

  private track(s: AudioScheduledSourceNode): void { this.voices++; s.onended = () => { this.voices--; }; }

  private env(vol: number, attack: number, decay: number, when = 0): GainNode | null {
    if (!this.ctx) return null;
    const g = this.ctx.createGain(), t = this.ctx.currentTime + when;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.out);
    return g;
  }

  private tone(type: OscillatorType, f0: number, f1: number, vol: number, attack: number, decay: number, when = 0): OscillatorNode | null {
    const g = this.env(vol, attack, decay, when);
    if (!g || !this.ctx) return null;
    const o = this.ctx.createOscillator(), t = this.ctx.currentTime + when;
    o.type = type;
    o.frequency.setValueAtTime(f0 * this.pj, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1 * this.pj), t + attack + decay);
    o.connect(g); o.start(t); o.stop(t + attack + decay + 0.05);
    this.track(o);
    return o;
  }

  private hiss(filter: BiquadFilterType, f0: number, f1: number, q: number, vol: number, attack: number, decay: number, when = 0): AudioBufferSourceNode | null {
    const g = this.env(vol, attack, decay, when);
    if (!g || !this.ctx) return null;
    const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), t = this.ctx.currentTime + when;
    s.buffer = this.noise; s.loop = true;
    f.type = filter; f.Q.value = q;
    f.frequency.setValueAtTime(f0 * this.pj, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * this.pj), t + attack + decay);
    s.connect(f).connect(g); s.start(t, Math.random() * 0.5); s.stop(t + attack + decay + 0.05);
    this.track(s);
    return s;
  }

  /** A throat: a buzzy source through two vowel formants with a wobble, plus a little chest. */
  private vocal(f0: number, f1: number, fa: number, fb: number, vol: number, attack: number, decay: number, when = 0): void {
    const g = this.env(vol, attack, decay, when);
    if (!g || !this.ctx) return;
    const c = this.ctx, t = c.currentTime + when, end = t + attack + decay, p = this.pj;
    const o = c.createOscillator(), vib = c.createOscillator(), vd = c.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0 * p, t);
    o.frequency.linearRampToValueAtTime(f0 * p * rnd(1.04, 1.18), t + (end - t) * rnd(0.2, 0.45));
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1 * p), end);
    vib.frequency.value = rnd(4, 8); vd.gain.value = f0 * p * rnd(0.02, 0.05);
    vib.connect(vd).connect(o.frequency);
    const a = c.createBiquadFilter(), b = c.createBiquadFilter(), chest = c.createBiquadFilter(), mk = this.gain(2.6, g);
    a.type = 'bandpass'; a.frequency.value = fa * p; a.Q.value = 4;
    b.type = 'bandpass'; b.frequency.value = fb * p; b.Q.value = 6;
    chest.type = 'lowpass'; chest.frequency.value = f0 * p * 3;
    o.connect(a).connect(mk); o.connect(b).connect(mk); o.connect(chest).connect(this.gain(0.35, g));
    o.start(t); vib.start(t); o.stop(end + 0.05); vib.stop(end + 0.05);
    this.track(o);
  }

  /** Distance falloff, `1/(1+(d/9)^2)`. */
  private att(dist: number): number { return 1 / (1 + (dist / 9) ** 2); }

  /**
   * Run `body` with its voices routed through a fresh positional chain at `pos` (or the local bus for
   * null): distance gain, air absorption, stereo pan from the listener's facing, wall occlusion and a
   * reverb send that falls off slower than the dry signal (far sounds are wetter). Culls when the mix is full.
   */
  private emit(pos: readonly [number, number] | null, o: Emit, body: () => void): void {
    if (!this.ctx) return;
    const c = this.ctx, prio = o.prio ?? false;
    if (this.voices >= MAX_VOICES && !prio) return;
    let to: AudioNode = this.local;
    if (pos) {
      const l = this.lis, dx = pos[0] - l.x, dz = pos[1] - l.z, d = Math.hypot(dx, dz), reach = o.reach ?? 1;
      const a = this.att(d / reach);
      if (a < 0.012 || (!prio && this.voices > MAX_VOICES * 0.6 && a < 0.25)) return;
      let cut = Math.max(1100, 18000 * Math.exp(-d / (28 * Math.sqrt(reach)))), dry = a, pan = 0;
      if (d > 0.5) {
        const ux = dx / d, uz = dz / d, front = ux * l.fx + uz * l.fz;
        if (front < 0) cut *= 1 + 0.4 * front;
        pan = (ux * -l.fz + uz * l.fx) * 0.85 * Math.min(1, d / 3);
      }
      if (o.occlude !== false && d > 2 && this.occluded?.(pos[0], pos[1])) { cut = Math.min(cut, 650); dry *= 0.5; }
      const lp = c.createBiquadFilter(), p = c.createStereoPanner();
      lp.type = 'lowpass'; lp.frequency.value = cut; lp.Q.value = 0.5;
      p.pan.value = pan;
      lp.connect(p);
      p.connect(this.gain(dry, this.world));
      p.connect(this.gain(Math.sqrt(a) * (o.wet ?? 0.3), this.verbIn));
      to = lp;
    }
    this.out = to; this.pj = 1 + (Math.random() * 2 - 1) * (o.jit ?? 0);
    try { body(); } finally { this.out = this.local; this.pj = 1; }
  }
  /** Straight to the master: UI and stingers (not muffled, no reverb). */
  private flat(body: () => void): void {
    if (!this.ctx) return;
    this.out = this.ui;
    try { body(); } finally { this.out = this.local; }
  }
  /** A point at `d` metres in a random direction from the listener (for distant ambience). */
  private around(d: number): [number, number] {
    const a = Math.random() * Math.PI * 2;
    return [this.lis.x + Math.cos(a) * d, this.lis.z + Math.sin(a) * d];
  }

  /** Dip ambience and the horde/tension beds under a big event. */
  private dip(depth: number, hold: number): void {
    if (!this.ctx) return;
    const g = this.duck.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.setTargetAtTime(1 - depth, t, 0.02); g.setTargetAtTime(1, t + hold, 0.7);
  }
  /** Close blasts muffle the world for a moment and leave the ears ringing. */
  private shellshock(dist: number, radius: number): void {
    if (dist >= radius) return;
    const s = 1 - dist / radius;
    this.shell = Math.max(this.shell, s);
    this.flat(() => this.tone('sine', 3700, 3620, 0.05 * s, 0.06, 0.6 + 2 * s));
  }

  // ------------------------------------------------------------------ beds
  private bedNoise(type: BiquadFilterType, f: number, q: number, vol: number, to: AudioNode, list: AudioScheduledSourceNode[]): { f: BiquadFilterNode; g: GainNode } {
    const c = this.ctx!, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = this.gain(vol, to);
    s.buffer = this.wide; s.loop = true;
    fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    s.connect(fl).connect(g); s.start(c.currentTime, Math.random() * 4); list.push(s);
    return { f: fl, g };
  }
  private bedTone(type: OscillatorType, f: number, vol: number, to: AudioNode, list: AudioScheduledSourceNode[]): { o: OscillatorNode; g: GainNode } {
    const c = this.ctx!, o = c.createOscillator(), g = this.gain(vol, to);
    o.type = type; o.frequency.value = f; o.connect(g); o.start(); list.push(o);
    return { o, g };
  }
  /** Slow modulation of `param` around its set value. */
  private lfo(param: AudioParam, rate: number, depth: number, list: AudioScheduledSourceNode[]): void {
    const c = this.ctx!, o = c.createOscillator();
    o.frequency.value = rate; o.connect(this.gain(depth)).connect(param); o.start(); list.push(o);
  }

  /** Pick the ambience for a chapter (index into CHAPTERS; -1 for the shooting range). Cheap to call every frame. */
  setScene(ch: number): void { this.scene = ch; }

  private buildScene(): void {
    const c = this.ctx!, t = c.currentTime;
    if (this.bed) {
      const old = this.bed;
      old.out.gain.setTargetAtTime(0, t, 0.6);
      for (const s of old.srcs) s.stop(t + 3);
    }
    this.built = this.scene;
    const srcs: AudioScheduledSourceNode[] = [];
    const out = this.gain(0, this.ambLP), outdoor = this.gain(1, out), indoor = this.gain(0, out);
    out.gain.setTargetAtTime(1, t, 1.5);
    this.bed = { srcs, out, outdoor, indoor };
    // Every room hums a little; fluorescent buzz in the hospital.
    this.bedNoise('lowpass', 160, 0.7, 0.05, indoor, srcs);
    this.bedTone('sine', 100, 0.006, indoor, srcs);
    if (this.scene < 0) return;
    // Wind and a far-off city/sea rumble.
    const wind = this.bedNoise('bandpass', 420, 0.7, this.scene === 2 ? 0.09 : 0.05, outdoor, srcs);
    this.lfo(wind.f.frequency, 0.06, 220, srcs); this.lfo(wind.g.gain, 0.11, 0.03, srcs);
    this.bedNoise('lowpass', 110, 0.5, 0.12, out, srcs);
    switch (this.scene) {
      case 0: { // rain on a downtown street
        const rain = this.bedNoise('highpass', 1300, 0.5, 0.05, outdoor, srcs);
        this.lfo(rain.g.gain, 0.09, 0.012, srcs);
        this.bedNoise('bandpass', 5200, 0.7, 0.03, outdoor, srcs);
        this.bedNoise('lowpass', 500, 0.7, 0.05, indoor, srcs); // rain on the roof
        break;
      }
      case 1: { // hospital/mall: ballast buzz indoors
        const buzz = c.createBiquadFilter(); buzz.type = 'bandpass'; buzz.frequency.value = 2400; buzz.Q.value = 6; buzz.connect(indoor);
        this.bedTone('sawtooth', 120, 0.025, buzz, srcs);
        break;
      }
      case 2: { // docks: water slapping the pilings
        const water = this.bedNoise('lowpass', 450, 0.8, 0.06, outdoor, srcs);
        this.lfo(water.g.gain, 0.32, 0.045, srcs); this.lfo(water.f.frequency, 0.21, 150, srcs);
        break;
      }
      case 3: { // pre-dawn suburb: crickets
        const cr = this.bedNoise('bandpass', 4600, 18, 0.12, outdoor, srcs);
        this.lfo(cr.g.gain, 28, 0.12, srcs);
        const gate = this.gain(0.5, outdoor); cr.g.disconnect(); cr.g.connect(gate); this.lfo(gate.gain, 0.55, 0.5, srcs);
        break;
      }
    }
  }

  /** Call every frame with the listener; drives the beds, ducking, muffling and heartbeat. */
  update(dt: number, l: Listener): void {
    this.lis = l;
    if (!this.ctx) return;
    if (this.built !== this.scene) this.buildScene();
    this.shell = Math.max(0, this.shell - dt * 0.45);
    const want = Math.min(1, l.threat / 14 + (l.holdout ? 0.45 : 0) + (l.down ? 0.5 : l.hurt * 0.25));
    this.tension += (want - this.tension) * Math.min(1, dt * (want > this.tension ? 0.8 : 0.1));

    // Heartbeat when badly hurt or down: faster as health drops.
    if (!l.dead && (l.down || l.hurt > 0.62)) {
      this.beatT -= dt;
      if (this.beatT <= 0) {
        const u = l.down ? 0.4 : (l.hurt - 0.62) / 0.38;
        this.beatT = l.down ? 1.1 : 0.95 - 0.4 * u;
        this.flat(() => { this.tone('sine', 62, 42, 0.3 + 0.25 * u, 0.008, 0.13); this.tone('triangle', 110, 70, 0.08, 0.008, 0.08); this.tone('sine', 55, 40, 0.2 + 0.15 * u, 0.008, 0.12, 0.17); });
      }
    } else this.beatT = 0;

    // Distant life of the dead city, and rain plinking nearby.
    this.ambT -= dt;
    if (this.ambT <= 0) { this.ambT = rnd(7, 18); if (this.voices < 40) this.distant(); }
    if (this.scene === 0 && !l.indoor) {
      this.dripT -= dt;
      if (this.dripT <= 0) {
        this.dripT = rnd(0.07, 0.4);
        if (this.voices < 40) this.emit(this.around(rnd(1.5, 6)), { occlude: false, wet: 0.1, jit: 0.3 }, () => this.tone('sine', 2600, 1500, rnd(0.015, 0.045), 0.001, 0.035));
      }
    }

    // AudioParam targets at 10 Hz is plenty and keeps the automation timelines short.
    this.ctlT -= dt;
    if (this.ctlT > 0) return;
    this.ctlT = 0.1;
    const now = this.ctx.currentTime, k = (p: AudioParam, v: number, tc: number) => p.setTargetAtTime(v, now, tc);
    k(this.verbOut.gain, l.indoor ? 0.08 : 0.45, 0.4); k(this.verbRoom.gain, l.indoor ? 0.5 : 0, 0.4);
    if (this.bed) { k(this.bed.outdoor.gain, l.indoor ? 0.35 : 1, 0.5); k(this.bed.indoor.gain, l.indoor ? 1 : 0, 0.5); }
    k(this.ambLP.frequency, l.indoor ? 650 : 18000, 0.5);
    const crowd = Math.min(1, Math.max(0, (l.threat - 3) / 20));
    k(this.hordeG.gain, crowd * crowd * 0.32 + (l.holdout ? 0.03 : 0), 0.8);
    k(this.tensionG.gain, 0.012 + this.tension * 0.07, 0.6); k(this.dissG.gain, this.tension * this.tension, 0.6);
    let cut = l.dead ? 20000 : l.down ? 750 : l.pinned ? 1300 : l.hurt > 0.75 ? 3200 : 20000;
    if (this.shell > 0) cut = Math.min(cut, 400 + 20000 * (1 - this.shell) ** 3);
    k(this.muffle.frequency, cut, 0.06);
  }

  /** One far-off event from the chapter's palette, somewhere 35-90 m away. */
  private distant(): void {
    const at = this.around(rnd(35, 90)), o: Emit = { reach: 6, wet: 0.8, occlude: false, jit: 0.06 };
    const howl = () => this.emit(at, o, () => { const [a, b] = pick(VOWELS); this.vocal(rnd(170, 260), rnd(90, 130), a, b, 0.35, 0.2, rnd(0.9, 1.6)); });
    const gunfire = () => this.emit(at, o, () => { let w = 0; for (let i = 0, n = 2 + ((Math.random() * 5) | 0); i < n; i++) { w += rnd(0.08, 0.35); this.hiss('bandpass', 1500, 500, 0.8, 0.35, 0.002, 0.08, w); this.tone('sine', 120, 50, 0.25, 0.002, 0.1, w); } });
    const list: (() => void)[] = [howl, howl, gunfire];
    switch (this.scene) {
      case 0:
        list.push(() => this.emit(at, { ...o, reach: 10 }, () => { this.hiss('lowpass', 320, 60, 0.6, 0.55, 0.35, 3.8); this.tone('sine', 48, 30, 0.35, 0.4, 3); }), // thunder
          () => this.emit(at, { ...o, reach: 9 }, () => { for (let i = 0; i < 4; i++) { this.tone('triangle', 640, 920, 0.07, 0.05, 0.75, i * 0.85); this.tone('triangle', 920, 640, 0.07, 0.05, 0.75, i * 0.85 + 0.42); } })); // siren
        break;
      case 1:
        list.push(() => this.emit(at, { ...o, reach: 7 }, () => { this.tone('triangle', 784, 784, 0.12, 0.01, 1.1); this.tone('triangle', 622, 622, 0.12, 0.01, 1.4, 0.45); }), // PA chime
          () => this.emit(at, o, () => { this.hiss('bandpass', 2400, 900, 1, 0.3, 0.003, 0.5); this.tone('triangle', 1250, 1210, 0.08, 0.002, 0.9); })); // something falls over
        break;
      case 2:
        list.push(() => this.emit(at, { ...o, reach: 12 }, () => { this.tone('sawtooth', 82, 80, 0.3, 0.4, 3); this.tone('square', 41, 40, 0.15, 0.4, 3); }), // foghorn
          () => this.emit(at, { ...o, reach: 10 }, () => { for (const f of [311, 370, 466]) this.tone('sawtooth', f, f * 0.98, 0.07, 0.15, 2.2); }), // train horn
          () => this.emit(at, o, () => { this.tone('triangle', 1300, 1260, 0.12, 0.002, 1.2); this.tone('triangle', 2140, 2100, 0.06, 0.002, 0.9); })); // clank
        break;
      case 3:
        list.push(() => this.emit(this.around(rnd(12, 30)), { wet: 0.4, occlude: false, jit: 0.15 }, () => { for (let i = 0, n = 3 + ((Math.random() * 4) | 0); i < n; i++) this.tone('sine', 2900, 4300, 0.05, 0.01, 0.06, i * 0.13); }), // bird
          () => this.emit(at, { ...o, reach: 12 }, () => { for (const r of [1, 2, 2.4, 3, 4.2]) this.tone('sine', 392 * r, 392 * r, 0.12 / r, 0.003, 3 / Math.sqrt(r)); })); // a far bell
        break;
    }
    pick(list)();
  }

  // ------------------------------------------------------------------ weapons
  /** A gunshot: yours when `x`/`z` are omitted, else a teammate's at that position. */
  shoot(weapon: number, x?: number, z?: number): void {
    const remote = x !== undefined && z !== undefined, id = WEAPONS[weapon]?.id;
    const v = (remote ? 0.7 : 1) * rnd(0.9, 1.05);
    this.emit(remote ? [x, z] : null, { reach: 2.5, wet: 0.4, jit: id === 'smg' || id === 'rifle' ? 0.06 : 0.04, prio: !remote }, () => {
      const crack = (vol: number) => this.hiss('highpass', 5200, 2600, 0.7, vol * v, 0.0008, 0.014);
      switch (id) {
        case 'pistol': crack(0.3); this.hiss('bandpass', 2600, 700, 0.8, 0.45 * v, 0.002, 0.09); this.tone('square', 520, 140, 0.2 * v, 0.002, 0.07); break;
        case 'smg': crack(0.22); this.hiss('bandpass', 3200, 900, 0.9, 0.34 * v, 0.001, 0.06); this.tone('square', 380, 120, 0.16 * v, 0.001, 0.05); break;
        // A rounder bark than the SMG with some chest under it.
        case 'rifle':
          crack(0.32); this.hiss('bandpass', 2200, 520, 0.8, 0.48 * v, 0.001, 0.1);
          this.tone('sawtooth', 260, 70, 0.22 * v, 0.001, 0.09); this.tone('sine', 120, 48, 0.32 * v, 0.002, 0.13);
          break;
        // Boom, then the pump: chk-chk.
        case 'shotgun':
          crack(0.35); this.hiss('lowpass', 2400, 180, 0.4, 0.85 * v, 0.002, 0.3); this.tone('sine', 150, 40, 0.7 * v, 0.002, 0.22);
          this.hiss('bandpass', 1900, 900, 1, 0.14 * v, 0.004, 0.05, 0.34); this.tone('square', 320, 240, 0.07 * v, 0.002, 0.04, 0.34);
          this.hiss('bandpass', 2300, 1300, 1, 0.16 * v, 0.004, 0.05, 0.47); this.tone('square', 420, 330, 0.08 * v, 0.002, 0.04, 0.47);
          break;
        // Shorter, punchier boom with a mechanical clack as the drum turns.
        case 'autoshotgun':
          crack(0.3); this.hiss('lowpass', 2900, 220, 0.5, 0.75 * v, 0.002, 0.2); this.tone('sine', 135, 45, 0.6 * v, 0.002, 0.16);
          this.tone('square', 950, 620, 0.1 * v, 0.002, 0.03, 0.06);
          break;
        // Whip crack, a long rolling tail, a cute little "ping", then the bolt cycling.
        case 'sniper':
          crack(0.4); this.hiss('bandpass', 4200, 500, 0.6, 0.7 * v, 0.001, 0.1); this.tone('sawtooth', 230, 38, 0.42 * v, 0.001, 0.4);
          this.hiss('lowpass', 900, 120, 0.5, 0.35 * v, 0.02, 0.6); this.tone('triangle', 1900, 1800, 0.09 * v, 0.002, 0.25, 0.03);
          this.tone('square', 700, 560, 0.06 * v, 0.002, 0.03, 0.3); this.tone('square', 980, 900, 0.07 * v, 0.002, 0.03, 0.42);
          break;
        // A hollow "bloop" and a breathy puff.
        case 'launcher': this.tone('sine', 280, 85, 0.65 * v, 0.004, 0.2); this.hiss('lowpass', 1100, 200, 0.6, 0.35 * v, 0.003, 0.14); this.tone('triangle', 620, 300, 0.12 * v, 0.002, 0.1); break;
        // Pistol with a chest: low thump under a bright bark.
        case 'magnum':
          crack(0.38); this.hiss('bandpass', 2100, 380, 0.7, 0.65 * v, 0.001, 0.15); this.tone('square', 330, 60, 0.3 * v, 0.001, 0.15);
          this.tone('sine', 95, 38, 0.55 * v, 0.002, 0.22);
          break;
        default: crack(0.3); this.hiss('bandpass', 1900, 500, 0.7, 0.5 * v, 0.001, 0.11); this.tone('sawtooth', 300, 70, 0.28 * v, 0.001, 0.09);
      }
      // Your own brass tinkling on the floor (not every shot, so rapid fire doesn't turn into a wind chime).
      if (!remote && (id === 'pistol' || id === 'magnum' || id === 'rifle' || (id === 'smg' && Math.random() < 0.4))) {
        const w = rnd(0.28, 0.45);
        this.tone('triangle', 4300, 4150, 0.022, 0.001, 0.04, w); this.tone('triangle', 5300, 5200, 0.012, 0.001, 0.03, w + rnd(0.07, 0.12));
      }
    });
  }
  /** Launcher grenade going off: bigger and boomier than the puffer pop, with a crackle. */
  blast(x: number, z: number, power = 1): void {
    const d = Math.hypot(x - this.lis.x, z - this.lis.z), v = power < 1 ? 0.6 : 1;
    this.emit([x, z], { reach: 2.5, wet: 0.6, jit: 0.05, prio: true }, () => {
      this.hiss('lowpass', 2600, 70, 0.4, v, 0.003, 0.85); this.tone('sine', 95, 24, v, 0.003, 0.6);
      this.hiss('highpass', 3200, 1600, 0.5, 0.3 * v, 0.004, 0.25, 0.05);
      for (let i = 0; i < 4; i++) this.hiss('bandpass', rnd(2000, 4000), 800, 2, 0.06 * v, 0.002, 0.05, rnd(0.15, 0.6)); // debris
    });
    this.dip(0.6 * v, 0.5); this.shellshock(d, 6 * power);
  }
  dryFire(): void { this.emit(null, { jit: 0.05 }, () => this.tone('square', 900, 700, 0.12, 0.001, 0.03)); }

  /** Reload foley spread over the reload time: mag out/in, shell by shell, or break-open. */
  reload(weapon = 0): void {
    const w = WEAPONS[weapon], T = w?.reload ?? 1.5, keep = (s: AudioScheduledSourceNode | null) => { if (s) this.pending.push(s); };
    this.cancelReload();
    this.emit(null, { jit: 0.04 }, () => {
      switch (w?.id) {
        case 'shotgun': case 'autoshotgun': {
          const n = Math.max(2, Math.min(7, Math.floor((T - 0.5) / 0.3)));
          for (let i = 0; i < n; i++) {
            const at = 0.3 + (i * (T - 0.6)) / n + rnd(-0.03, 0.03);
            keep(this.hiss('bandpass', 2200, 1200, 1.2, 0.07, 0.004, 0.05, at)); keep(this.tone('square', 880, 720, 0.07, 0.002, 0.03, at + 0.03));
          }
          break;
        }
        case 'launcher':
          keep(this.tone('sine', 210, 120, 0.2, 0.003, 0.08)); keep(this.tone('square', 1100, 900, 0.06, 0.002, 0.03, 0.05));
          keep(this.hiss('bandpass', 900, 500, 1, 0.1, 0.02, 0.15, T * 0.5)); keep(this.tone('sine', 170, 100, 0.22, 0.003, 0.08, T * 0.62));
          break;
        default:
          keep(this.tone('square', 500, 300, 0.1, 0.002, 0.04)); keep(this.hiss('bandpass', 1300, 600, 1, 0.1, 0.01, 0.08, 0.04)); // mag out
          keep(this.hiss('bandpass', 1500, 900, 1, 0.08, 0.02, 0.1, T * 0.5)); keep(this.tone('square', 760, 900, 0.13, 0.002, 0.05, T * 0.58)); // mag in
      }
    });
  }
  /** Stop reload foley still to come (weapon switched, went down). */
  cancelReload(): void {
    for (const s of this.pending) { try { s.stop(); } catch { /* already stopped */ } }
    this.pending.length = 0;
  }
  reloadDone(weapon = 0): void {
    this.pending.length = 0;
    const id = WEAPONS[weapon]?.id;
    this.emit(null, { jit: 0.04 }, () => {
      if (id === 'shotgun') { this.hiss('bandpass', 1900, 900, 1, 0.14, 0.004, 0.05); this.hiss('bandpass', 2300, 1300, 1, 0.16, 0.004, 0.05, 0.12); this.tone('square', 420, 330, 0.08, 0.002, 0.04, 0.12); }
      else if (id === 'sniper') { this.tone('square', 700, 560, 0.08, 0.002, 0.03); this.tone('square', 980, 900, 0.1, 0.002, 0.04, 0.13); }
      else { this.hiss('bandpass', 2600, 1300, 1, 0.1, 0.004, 0.05); this.tone('square', 640, 1100, 0.15, 0.002, 0.06, 0.03); }
    });
  }
  /** Weapon swap: a cloth swish and a click as it seats. */
  draw(weapon = 0): void {
    const big = WEAPONS[weapon]?.slot === 'primary';
    this.emit(null, { jit: 0.06 }, () => {
      this.hiss('bandpass', 800, 1800, 0.8, 0.07, 0.03, 0.1);
      this.tone('square', 1300, 1100, 0.05, 0.001, 0.02, 0.12);
      if (big) this.tone('square', 850, 760, 0.06, 0.001, 0.03, 0.19);
    });
  }
  /** Hit confirmation: a UI tick plus a fleshy smack (a crack for headshots). */
  hit(head: boolean): void {
    this.flat(() => this.tone('triangle', head ? 1500 : 880, head ? 2100 : 620, 0.16, 0.001, 0.05));
    this.emit(null, { jit: 0.12 }, () => {
      this.hiss('lowpass', head ? 2400 : 1300, 250, 0.8, 0.2, 0.002, 0.06); this.tone('sine', head ? 260 : 180, 90, 0.18, 0.002, 0.06);
    });
  }
  shove(): void { this.emit(null, { jit: 0.08 }, () => { this.hiss('bandpass', 500, 1600, 0.7, 0.4, 0.02, 0.13); this.tone('sine', 140, 80, 0.2, 0.005, 0.08, 0.06); }); }

  // ------------------------------------------------------------------ player
  hurt(): void {
    this.emit(null, { jit: 0.1 }, () => {
      this.tone('sawtooth', 210, 70, 0.3, 0.004, 0.2); this.hiss('lowpass', 900, 200, 0.5, 0.3, 0.003, 0.12);
      this.vocal(rnd(300, 380), 240, 560 * 1.2, 1450 * 1.2, 0.3, 0.01, 0.16);
    });
  }
  /** A teammate getting bitten (a short "oof" where they are). */
  oof(x: number, z: number): void {
    this.emit([x, z], { jit: 0.12, wet: 0.25 }, () => this.vocal(rnd(320, 420), 260, 560 * 1.2, 1450 * 1.2, 0.35, 0.01, 0.16));
  }
  /** A footstep: tile tap indoors, splashy in the rain, gritty otherwise. Positional for teammates. */
  step(indoor: boolean, x?: number, z?: number): void {
    const pos: [number, number] | null = x !== undefined && z !== undefined ? [x, z] : null;
    this.emit(pos, { jit: 0.12, wet: 0.15, reach: 0.8 }, () => {
      const v = rnd(0.75, 1.1);
      this.hiss('lowpass', 420, 160, 0.6, 0.07 * v, 0.004, 0.05);
      if (indoor) this.hiss('bandpass', 1900, 1300, 1.3, 0.05 * v, 0.002, 0.03);
      else if (this.scene === 0) this.hiss('highpass', 2600, 4200, 0.5, 0.04 * v, 0.006, 0.09);
      else this.hiss('bandpass', 1000, 600, 0.8, 0.045 * v, 0.004, 0.06);
    });
  }
  /** Coming down from a jump or knockback; `speed` is the fall speed in m/s. */
  land(speed: number, indoor: boolean): void {
    const v = Math.min(1, speed / 8);
    this.emit(null, { jit: 0.08 }, () => { this.tone('sine', 95, 45, 0.25 * v, 0.003, 0.12); this.hiss('lowpass', 700, 150, 0.6, 0.15 * v, 0.003, 0.1); });
    this.step(indoor);
  }
  /** Medkit: tape tearing while you patch up. */
  bandage(): void {
    this.emit(null, { jit: 0.1 }, () => { for (let i = 0, w = 0.05; i < 3; i++, w += rnd(0.35, 0.55)) this.hiss('bandpass', rnd(1800, 2600), rnd(3000, 4200), 1.5, 0.11, 0.03, rnd(0.12, 0.22), w); });
  }
  pickup(): void { this.flat(() => [660, 880, 1320].forEach((f, i) => this.tone('square', f, f, 0.12, 0.003, 0.08, i * 0.07))); }
  heal(): void { this.flat(() => [523, 659, 784, 1046].forEach((f, i) => this.tone('triangle', f, f, 0.18, 0.004, 0.14, i * 0.09))); }
  down(): void { this.flat(() => [440, 330, 220, 147].forEach((f, i) => this.tone('sawtooth', f, f * 0.94, 0.2, 0.004, 0.2, i * 0.15))); }
  win(): void { this.flat(() => [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone('square', f, f, 0.16, 0.004, 0.22, i * 0.12))); }
  lose(): void { this.flat(() => [392, 370, 349, 262].forEach((f, i) => this.tone('sawtooth', f, f * 0.97, 0.2, 0.01, 0.4, i * 0.3))); }
  gate(): void { this.emit(null, {}, () => { this.hiss('lowpass', 300, 900, 1, 0.45, 0.2, 1.6); this.tone('square', 660, 660, 0.12, 0.01, 0.2); this.tone('square', 880, 880, 0.12, 0.01, 0.3, 0.25); }); }

  // ------------------------------------------------------------------ common infected
  /** An awake zombie moaning at (x, z); `big` for a Brute. */
  groan(x: number, z: number, big = false): void {
    this.emit([x, z], { jit: 0.12, wet: 0.35, reach: big ? 1.6 : 1 }, () => {
      const [a, b] = pick(VOWELS), s = big ? 0.7 : 1, f = big ? rnd(48, 62) : rnd(85, 140), len = rnd(0.45, 1.1);
      this.vocal(f, f * rnd(0.6, 0.95), a * s, b * s, big ? 0.8 : 0.5, rnd(0.08, 0.2), len);
      if (Math.random() < 0.4) this.hiss('bandpass', rnd(350, 650), 250, 3, 0.12, 0.1, len * 0.8);
    });
  }
  /** A sleepwalker still dozing: a soft snore (in, then a rattly out). */
  snore(x: number, z: number): void {
    this.emit([x, z], { jit: 0.15, wet: 0.25, reach: 0.8 }, () => {
      this.hiss('bandpass', 500, 950, 2, 0.06, 0.5, 0.3);
      this.vocal(rnd(55, 70), 50, 450, 800, 0.22, 0.05, 0.45, 0.6);
    });
  }
  /** A swipe/bite: a whoosh and a snarl. */
  swipe(x: number, z: number): void {
    this.emit([x, z], { jit: 0.12, wet: 0.2, reach: 0.9 }, () => {
      this.hiss('bandpass', 700, 2600, 1.2, 0.2, 0.04, 0.1);
      this.vocal(rnd(140, 185), 110, 650, 1080, 0.4, 0.02, 0.22);
    });
  }
  /** A zombie popping on death; size follows the type, Brutes fall like a wardrobe. */
  pop(x: number, z: number, type = 0): void {
    const big = type === ZT.BRUTE, s = big ? 2.1 : type === ZT.CHARGER || type === ZT.PUFFER ? 1.3 : 1;
    this.emit([x, z], { jit: 0.1, wet: 0.3, prio: big }, () => {
      this.tone('sine', 520 / s, 90 / s, 0.32, 0.002, 0.14 * s); this.hiss('highpass', 1400, 3000, 0.5, 0.18, 0.002, 0.08);
      this.hiss('lowpass', 1600, 200, 0.7, 0.22, 0.002, 0.1 * s);
      if (big) { this.vocal(55, 30, 315, 560, 0.8, 0.05, 1.3); this.tone('sine', 70, 28, 0.8, 0.004, 0.5, 0.3); this.hiss('lowpass', 900, 60, 0.5, 0.55, 0.004, 0.5, 0.3); }
      else if (Math.random() < 0.35) { const [a, b] = pick(VOWELS); this.vocal(rnd(110, 150), rnd(60, 80), a, b, 0.3, 0.02, 0.35); }
    });
  }
  /** The horde call: screams from all around, over a rising siren-like swell. */
  horde(): void {
    for (let i = 0; i < 6; i++) {
      this.emit(this.around(rnd(22, 45)), { reach: 4, wet: 0.6, occlude: false, jit: 0.1, prio: true }, () =>
        this.vocal(rnd(170, 260), rnd(100, 140), 650, 1080, 0.5, 0.15, rnd(0.8, 1.4), i * rnd(0.12, 0.25)));
    }
    this.emit(null, {}, () => {
      for (let i = 0; i < 4; i++) this.tone('sawtooth', 190 + i * 37, 420 + i * 61, 0.07, 0.5, 1.7, i * 0.08);
      this.hiss('bandpass', 500, 1500, 2, 0.2, 0.7, 1.6);
    });
  }

  // ------------------------------------------------------------------ specials
  /**
   * A special's idle presence cue, so you hear it before it acts. Each has its own register and rhythm:
   * Leaper high fast chitter, Charger low slow snorts, Drooler mid irregular bubbles, Puffer a wheezy
   * breath, Brute a deep growl and heavy footfalls, Alarm Clock a tick-tock. Returns seconds until the next cue.
   */
  special(type: number, x: number, z: number, st: number): number {
    const at: [number, number] = [x, z], o: Emit = { jit: 0.08, wet: 0.3, prio: true, reach: 1.3 };
    switch (type) {
      case ZT.LEAPER:
        this.emit(at, o, () => { for (let i = 0, w = 0; i < 4; i++, w += rnd(0.04, 0.08)) this.tone('square', rnd(1100, 1700), 950, 0.07, 0.002, 0.025, w); this.hiss('highpass', 3000, 4000, 0.7, 0.05, 0.01, 0.15); });
        return rnd(2.2, 4);
      case ZT.CHARGER:
        this.emit(at, o, () => { this.hiss('bandpass', 700, 400, 1.6, 0.3, 0.01, 0.12); this.hiss('bandpass', 650, 380, 1.6, 0.26, 0.01, 0.12, 0.28); this.vocal(70, 58, 315, 560, 0.45, 0.1, 0.5, 0.5); });
        return rnd(3, 5);
      case ZT.DROOLER:
        this.emit(at, o, () => { for (let i = 0, w = 0, n = 3 + ((Math.random() * 3) | 0); i < n; i++, w += rnd(0.05, 0.16)) this.tone('sine', rnd(180, 320), 520, 0.13, 0.003, 0.05, w); });
        return rnd(2.5, 4.5);
      case ZT.PUFFER:
        this.emit(at, o, () => { this.hiss('bandpass', 700, 1700, 2.5, 0.11, 0.6, 0.2); this.vocal(100, 78, 450, 800, 0.3, 0.05, 0.5, 0.8); this.hiss('lowpass', 900, 300, 0.7, 0.05, 0.05, 0.5, 0.8); });
        return rnd(2.8, 4);
      case ZT.BRUTE:
        if (st === ZSTATE.RUN) {
          this.emit(at, { ...o, reach: 2.2 }, () => { this.tone('sine', 65, 32, 0.55, 0.004, 0.22); this.hiss('lowpass', 500, 80, 0.6, 0.3, 0.004, 0.18); });
          if (Math.random() < 0.12) this.groan(x, z, true);
          return rnd(0.4, 0.46);
        }
        this.groan(x, z, true);
        return rnd(3, 5);
      case ZT.ALARM:
        this.emit(at, { ...o, reach: 1 }, () => { this.tone('triangle', 2000, 1980, 0.06, 0.001, 0.025); this.tone('triangle', 1600, 1580, 0.06, 0.001, 0.025, 0.5); });
        return 1;
    }
    return 4;
  }
  /** Leaper tell: a stuttering rise that breaks into a shriek (high register, fast rhythm). */
  leap(x: number, z: number): void {
    this.emit([x, z], { jit: 0.05, wet: 0.3, prio: true, reach: 1.4 }, () => {
      for (let i = 0; i < 5; i++) this.tone('sawtooth', 450 * 1.25 ** i, 500 * 1.25 ** i, 0.18, 0.003, 0.04, i * 0.055);
      this.tone('sawtooth', 1300, 1750, 0.28, 0.01, 0.25, 0.3); this.hiss('bandpass', 3000, 3600, 2, 0.18, 0.01, 0.3, 0.28);
    });
  }
  /** Charger tell: a snorting bull huff and hooves-on-asphalt scraping (low register, slow rhythm). */
  chargeTell(x: number, z: number): void {
    this.emit([x, z], { wet: 0.3, prio: true, reach: 1.67, jit: 0.04 }, () => {
      this.hiss('bandpass', 900, 300, 1.2, 0.5, 0.02, 0.35);
      this.tone('sawtooth', 90, 60, 0.45, 0.06, 0.5);
      for (let i = 0; i < 3; i++) this.hiss('highpass', 2600, 1200, 0.7, 0.3, 0.01, 0.12, 0.25 + i * 0.2);
    });
  }
  /** The rush itself: a rising bellow. */
  chargeGo(x: number, z: number): void {
    this.emit([x, z], { wet: 0.3, prio: true, reach: 1.67 }, () => { this.tone('sawtooth', 70, 160, 0.5, 0.05, 0.6); this.hiss('lowpass', 700, 1800, 0.6, 0.35, 0.05, 0.5); });
  }
  /** Charger meets wall (or survivor): a heavy cartoon thud. */
  thud(x: number, z: number): void {
    const d = Math.hypot(x - this.lis.x, z - this.lis.z);
    this.emit([x, z], { reach: 2, wet: 0.5, prio: true }, () => { this.tone('sine', 85, 28, 0.9, 0.003, 0.4); this.hiss('lowpass', 1200, 80, 0.5, 0.7, 0.003, 0.35); });
    this.dip(0.4, 0.3); this.shellshock(d, 3);
  }
  /** Drooler tell: a gargle of rising bubbles that speeds up (mid register, irregular rhythm). */
  gurgle(x: number, z: number): void {
    this.emit([x, z], { wet: 0.3, prio: true, reach: 1.43, jit: 0.05 }, () => {
      for (let i = 0, w = 0; i < 7; i++, w += 0.16 - i * 0.015) this.tone('sine', rnd(170, 260), rnd(380, 520), 0.22, 0.004, 0.06, w);
      this.vocal(140, 110, 450, 800, 0.3, 0.1, 0.5);
      this.hiss('bandpass', 400, 900, 4, 0.18, 0.05, 0.5);
    });
  }
  spit(x: number, z: number): void { this.emit([x, z], { reach: 1.43, wet: 0.3, prio: true }, () => { this.hiss('bandpass', 1400, 400, 1.5, 0.45, 0.005, 0.18); this.tone('sine', 420, 160, 0.3, 0.005, 0.15); }); }
  splat(x: number, z: number): void { this.emit([x, z], { wet: 0.3, jit: 0.08 }, () => { this.hiss('lowpass', 900, 150, 0.8, 0.55, 0.004, 0.3); this.tone('sine', 140, 50, 0.4, 0.004, 0.25); }); }
  /** Standing in goo. */
  sizzle(): void { this.emit(null, { jit: 0.1 }, () => { this.hiss('highpass', 3000, 5000, 0.5, 0.14, 0.01, 0.22); this.tone('sine', 300 + Math.random() * 200, 120, 0.08, 0.01, 0.15); }); }
  /** Puffer bursting. */
  boom(x: number, z: number): void {
    const d = Math.hypot(x - this.lis.x, z - this.lis.z);
    this.emit([x, z], { reach: 2, wet: 0.5, prio: true, jit: 0.05 }, () => { this.hiss('lowpass', 1800, 90, 0.4, 1, 0.004, 0.6); this.tone('sine', 110, 30, 0.9, 0.004, 0.45); });
    this.dip(0.5, 0.4); this.shellshock(d, 4);
  }
  /** One burst of a twin-bell alarm clock (call every ~0.3 s while it rings). */
  ring(x: number, z: number): void {
    this.emit([x, z], { reach: 2.9, wet: 0.4, prio: true }, () => { for (let i = 0; i < 8; i++) this.tone('square', i % 2 ? 2350 : 1980, i % 2 ? 2300 : 1950, 0.32, 0.002, 0.03, i * 0.036); });
  }
  /** It rang out. */
  alarmOut(): void { this.emit(null, {}, () => { for (let i = 0; i < 3; i++) this.tone('square', 2100, 1400, 0.16, 0.005, 0.25, i * 0.18); }); this.horde(); }
  /** A Brute is coming (no position: a growl that fills the street). */
  brute(): void {
    this.emit(null, {}, () => { this.tone('sawtooth', 70, 38, 0.55, 0.25, 1.5); this.tone('square', 52, 30, 0.3, 0.3, 1.4); this.hiss('lowpass', 500, 100, 1, 0.45, 0.3, 1.3); this.vocal(50, 36, 315, 560, 0.7, 0.2, 1.4); });
    this.dip(0.35, 1.2);
  }
}
