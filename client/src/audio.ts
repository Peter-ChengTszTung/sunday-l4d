// All sound is synthesised with WebAudio — no asset files to ship.
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  muted = false;

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(this.ctx.destination);
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m: boolean): void { this.muted = m; if (this.ctx) this.master.gain.value = m ? 0 : 0.5; }

  private env(vol: number, attack: number, decay: number, when = 0): GainNode | null {
    if (!this.ctx) return null;
    const g = this.ctx.createGain(), t = this.ctx.currentTime + when;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.master);
    return g;
  }

  private tone(type: OscillatorType, f0: number, f1: number, vol: number, attack: number, decay: number, when = 0): void {
    const g = this.env(vol, attack, decay, when);
    if (!g || !this.ctx) return;
    const o = this.ctx.createOscillator(), t = this.ctx.currentTime + when;
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + attack + decay);
    o.connect(g); o.start(t); o.stop(t + attack + decay + 0.05);
  }

  private hiss(filter: BiquadFilterType, f0: number, f1: number, q: number, vol: number, attack: number, decay: number, when = 0): void {
    const g = this.env(vol, attack, decay, when);
    if (!g || !this.ctx) return;
    const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), t = this.ctx.currentTime + when;
    s.buffer = this.noise; s.loop = true;
    f.type = filter; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + decay);
    s.connect(f).connect(g); s.start(t, Math.random() * 0.5); s.stop(t + attack + decay + 0.05);
  }

  /** `dist` in metres attenuates remote sounds. */
  private att(dist: number): number { return 1 / (1 + (dist / 9) ** 2); }

  shoot(weapon: number, dist = 0): void {
    const v = this.att(dist) * (dist > 0 ? 0.7 : 1);
    switch (weapon) {
      case 0: this.hiss('bandpass', 2600, 700, 0.8, 0.5 * v, 0.002, 0.09); this.tone('square', 520, 140, 0.22 * v, 0.002, 0.07); break;
      case 1: this.hiss('bandpass', 3200, 900, 0.9, 0.38 * v, 0.001, 0.06); this.tone('square', 380, 120, 0.18 * v, 0.001, 0.05); break;
      case 2: this.hiss('lowpass', 2400, 180, 0.4, 0.9 * v, 0.002, 0.3); this.tone('sine', 150, 40, 0.7 * v, 0.002, 0.22); break;
      default: this.hiss('bandpass', 1900, 500, 0.7, 0.55 * v, 0.001, 0.11); this.tone('sawtooth', 300, 70, 0.3 * v, 0.001, 0.09);
    }
  }
  dryFire(): void { this.tone('square', 900, 700, 0.12, 0.001, 0.03); }
  reload(): void { this.tone('square', 500, 300, 0.12, 0.002, 0.04); this.tone('square', 760, 900, 0.14, 0.002, 0.05, 0.22); }
  reloadDone(): void { this.tone('square', 640, 1100, 0.16, 0.002, 0.06); }
  hit(head: boolean): void { this.tone('triangle', head ? 1500 : 880, head ? 2100 : 620, 0.2, 0.001, 0.05); }
  pop(dist: number): void { const v = this.att(dist); this.tone('sine', 520, 90, 0.35 * v, 0.002, 0.14); this.hiss('highpass', 1400, 3000, 0.5, 0.2 * v, 0.002, 0.08); }
  shove(): void { this.hiss('bandpass', 500, 1600, 0.7, 0.45, 0.02, 0.13); }
  hurt(): void { this.tone('sawtooth', 210, 70, 0.4, 0.004, 0.2); this.hiss('lowpass', 900, 200, 0.5, 0.35, 0.003, 0.12); }
  groan(dist: number, big = false): void {
    const v = this.att(dist) * 0.3, f = (big ? 55 : 95) + Math.random() * 50;
    this.tone('sawtooth', f, f * (0.6 + Math.random() * 0.5), v, 0.12, 0.45 + Math.random() * 0.3);
    this.hiss('bandpass', 420 + Math.random() * 300, 260, 3, v * 0.8, 0.1, 0.4);
  }
  pickup(): void { [660, 880, 1320].forEach((f, i) => this.tone('square', f, f, 0.13, 0.003, 0.08, i * 0.07)); }
  heal(): void { [523, 659, 784, 1046].forEach((f, i) => this.tone('triangle', f, f, 0.2, 0.004, 0.14, i * 0.09)); }
  down(): void { [440, 330, 220, 147].forEach((f, i) => this.tone('sawtooth', f, f * 0.94, 0.22, 0.004, 0.2, i * 0.15)); }
  boom(dist: number): void { const v = this.att(dist * 0.5); this.hiss('lowpass', 1800, 90, 0.4, v, 0.004, 0.6); this.tone('sine', 110, 30, 0.9 * v, 0.004, 0.45); }
  horde(): void {
    for (let i = 0; i < 4; i++) this.tone('sawtooth', 190 + i * 37, 420 + i * 61, 0.12, 0.5, 1.7, i * 0.08);
    this.hiss('bandpass', 500, 1500, 2, 0.25, 0.7, 1.6);
  }
  brute(): void { this.tone('sawtooth', 70, 38, 0.6, 0.25, 1.5); this.tone('square', 52, 30, 0.35, 0.3, 1.4); this.hiss('lowpass', 500, 100, 1, 0.5, 0.3, 1.3); }
  leap(dist: number): void { const v = this.att(dist); this.tone('sawtooth', 300, 950, 0.35 * v, 0.03, 0.35); }
  win(): void { [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone('square', f, f, 0.16, 0.004, 0.22, i * 0.12)); }
  lose(): void { [392, 370, 349, 262].forEach((f, i) => this.tone('sawtooth', f, f * 0.97, 0.2, 0.01, 0.4, i * 0.3)); }
  gate(): void { this.hiss('lowpass', 300, 900, 1, 0.5, 0.2, 1.6); this.tone('square', 660, 660, 0.14, 0.01, 0.2); this.tone('square', 880, 880, 0.14, 0.01, 0.3, 0.25); }
  step(): void { this.hiss('lowpass', 420, 180, 0.6, 0.08, 0.004, 0.05); }
}
