// Chibi characters: huge head, bean body, stubby limbs. Built from primitives,
// vertex-coloured so every character shares one toon material, and animated
// procedurally (no skeletons). Models face -Z so yaw matches the camera.
import * as pc from 'playcanvas';
import { type Geo, box, sphere, cylinder, capsule, ring, quad, make, merge, trs, toMesh } from './geo';
import { device, meshEntity, toonMat, outlineMat, makeUnlit, canvasTexture, setRot } from './gfx';
import { SURVIVORS, type SurvivorLook } from '../../shared/constants';

export type HairStyle = SurvivorLook['style'] | 'bald' | 'mess' | 'hood';
export type ZombieKind = 'walker' | 'leaper' | 'puffer' | 'brute';
export interface ChibiLook {
  skin: number; shirt: number; pants: number; hair: number; style: HairStyle;
  zombie?: ZombieKind; eye?: number;
}
export type Pose = 'idle' | 'run' | 'aim' | 'attack' | 'stagger' | 'windup' | 'leap' | 'down';

const HEAD_Y = 1.06;
const ball = sphere(18, 12);
const dome = sphere(18, 8, Math.PI / 2);
const hood = sphere(18, 10, Math.PI * 0.68);
const cone = cylinder(8, 0, 1);
const cube = box();
const shadowMesh = toMesh(device, make(ring(0, 0.36, 16)));
const shadowMat = makeUnlit({ color: 0x0a0614, alpha: 0.38, blend: 'normal', fog: false });

const cache = new Map<string, pc.Mesh>();
function cached(key: string, build: () => Geo): pc.Mesh {
  let m = cache.get(key);
  if (!m) { m = toMesh(device, build()); cache.set(key, m); }
  return m;
}

function headGeo(l: ChibiLook): Geo {
  const parts: Geo[] = [make(ball, l.skin, trs(0, 0, 0, 0, 0, 0, 0.36, 0.335, 0.35))];
  const dark = 0x1a1226;
  if (l.zombie) {
    const glow = l.eye ?? 0xfff3a8;
    // Mismatched goggly eyes + a toothy grin.
    parts.push(make(ball, glow, trs(-0.135, 0.0, -0.3, 0, 0, 0, 0.095, 0.105, 0.05)));
    parts.push(make(ball, glow, trs(0.14, 0.02, -0.305, 0, 0, 0, 0.065, 0.07, 0.04)));
    parts.push(make(ball, dark, trs(-0.125, -0.01, -0.345, 0, 0, 0, 0.028, 0.028, 0.02)));
    parts.push(make(ball, dark, trs(0.15, 0.03, -0.34, 0, 0, 0, 0.022, 0.022, 0.02)));
    parts.push(make(cube, 0x4a1630, trs(0, -0.16, -0.315, 0.1, 0, 0, 0.2, 0.07, 0.05)));
    parts.push(make(cube, 0xfff8ee, trs(-0.05, -0.135, -0.335, 0.1, 0, 0, 0.045, 0.04, 0.03)));
    parts.push(make(cube, 0xfff8ee, trs(0.045, -0.185, -0.33, 0.1, 0, 0, 0.045, 0.04, 0.03)));
  } else {
    for (const s of [-1, 1]) {
      parts.push(make(ball, dark, trs(s * 0.13, -0.02, -0.31, 0, 0, 0, 0.058, 0.082, 0.04)));
      parts.push(make(ball, 0xffffff, trs(s * 0.13 + 0.02, 0.015, -0.345, 0, 0, 0, 0.022, 0.026, 0.015)));
      parts.push(make(ball, 0xff9bb0, trs(s * 0.22, -0.11, -0.27, 0, s * -0.6, 0, 0.05, 0.03, 0.012)));
    }
    parts.push(make(ball, 0x8a3b4a, trs(0, -0.14, -0.325, 0, 0, 0, 0.03, 0.016, 0.012)));
  }
  const tilt = 0.32;
  switch (l.style) {
    case 'cap':
      parts.push(make(dome, l.hair, trs(0, 0.1, 0.02, tilt * 0.5, 0, 0, 0.375, 0.29, 0.37)));
      parts.push(make(cube, l.hair, trs(0, 0.2, -0.38, -0.12, 0, 0, 0.34, 0.035, 0.2)));
      break;
    case 'spiky':
      parts.push(make(dome, l.hair, trs(0, 0.01, 0.02, tilt, 0, 0, 0.38, 0.36, 0.37)));
      for (const [x, y, z, rz, rx] of [[0, 0.38, 0, 0, 0.2], [-0.17, 0.32, 0.02, 0.55, 0.2], [0.17, 0.32, 0.02, -0.55, 0.2], [-0.08, 0.3, 0.2, 0.2, 0.9], [0.1, 0.3, 0.2, -0.2, 0.9]]) {
        parts.push(make(cone, l.hair, trs(x, y, z, rx, 0, rz, 0.09, 0.22, 0.09)));
      }
      break;
    case 'buns':
      parts.push(make(dome, l.hair, trs(0, 0.01, 0.02, tilt, 0, 0, 0.38, 0.36, 0.37)));
      for (const s of [-1, 1]) parts.push(make(ball, l.hair, trs(s * 0.31, 0.27, 0.06, 0, 0, 0, 0.135)));
      break;
    case 'bob':
      parts.push(make(hood, l.hair, trs(0, 0.0, 0.03, tilt * 1.6, 0, 0, 0.39, 0.37, 0.38)));
      break;
    case 'hood':
      parts.push(make(hood, l.hair, trs(0, 0.0, 0.04, 0.62, 0, 0, 0.41, 0.4, 0.4)));
      break;
    case 'mess':
      parts.push(make(dome, l.hair, trs(0, 0.03, 0.03, tilt * 1.2, 0, 0.1, 0.375, 0.33, 0.36)));
      parts.push(make(cone, l.hair, trs(0.12, 0.34, 0.05, 0.2, 0, -0.7, 0.07, 0.2, 0.07)));
      parts.push(make(cone, l.hair, trs(-0.2, 0.28, 0.1, 0.4, 0, 0.9, 0.06, 0.16, 0.06)));
      break;
    case 'bald':
      break;
  }
  return merge(parts);
}

function limbGeo(color: number, tip: number, r: number, len: number): Geo {
  // Hangs down from the pivot (origin) along -Y, with a contrasting hand/shoe.
  const total = len + 2 * r;
  return merge([
    make(capsule(r, len), color, trs(0, -total / 2, 0)),
    make(ball, tip, trs(0, -total + r * 0.6, 0, 0, 0, 0, r * 1.25, r * 1.1, r * 1.3)),
  ]);
}

function bodyGeo(l: ChibiLook): Geo {
  if (l.zombie === 'puffer') {
    const parts = [make(ball, l.shirt, trs(0, 0, 0, 0, 0, 0, 0.36, 0.33, 0.34))];
    for (const [x, y, z, s] of [[0.2, 0.12, -0.24, 0.09], [-0.16, -0.05, -0.29, 0.07], [0.02, 0.2, -0.26, 0.06], [-0.26, 0.14, -0.1, 0.08], [0.28, -0.08, 0.0, 0.07], [0.0, 0.1, 0.3, 0.09]]) {
      parts.push(make(ball, 0xe9f76a, trs(x, y, z, 0, 0, 0, s)));
    }
    return merge(parts);
  }
  const wide = l.zombie === 'brute' ? 1.45 : l.zombie === 'leaper' ? 0.85 : 1;
  return merge([
    make(ball, l.shirt, trs(0, 0.02, 0, 0, 0, 0, 0.23 * wide, 0.25, 0.2 * (wide > 1 ? 1.25 : wide))),
    make(ball, l.pants, trs(0, -0.13, 0, 0, 0, 0, 0.2 * wide, 0.13, 0.18 * (wide > 1 ? 1.2 : wide))),
  ]);
}

export class Chibi {
  readonly group = new pc.Entity('chibi');
  readonly root = new pc.Entity('root'); // tilts/squashes without touching the shadow
  readonly head: pc.Entity;
  readonly body: pc.Entity;
  readonly armL = new pc.Entity();
  readonly armR = new pc.Entity();
  readonly legL = new pc.Entity();
  readonly legR = new pc.Entity();
  phase = Math.random() * 10;
  punch = 0; // hit squash, decays to 0
  private readonly headBaseY: number;
  private readonly bodyBaseY: number;
  // Smoothed pose values (kept here so we never read rotations back from the engine).
  private p = { leg: 0, aL: 0, aR: 0, aLz: 0, aRz: 0, headZ: 0, lean: 0, rootX: 0, rootY: 0, squash: 1 };

  constructor(readonly look: ChibiLook) {
    const k = [look.skin, look.shirt, look.pants, look.hair, look.style, look.zombie ?? 'p', look.eye ?? 0].join('|');
    const z = look.zombie;
    const mk = (mesh: pc.Mesh) => meshEntity(mesh, [toonMat, outlineMat]);
    this.body = mk(cached('b' + k, () => bodyGeo(look)));
    this.bodyBaseY = z === 'puffer' ? 0.62 : 0.55;
    this.head = mk(cached('h' + k, () => headGeo(look)));
    this.headBaseY = z === 'puffer' ? 1.16 : HEAD_Y;
    if (z === 'brute') this.head.setLocalScale(0.82, 0.82, 0.82);

    const armR = z === 'brute' ? 0.11 : 0.065, armLen = z === 'leaper' ? 0.24 : z === 'brute' ? 0.22 : 0.15;
    const armMesh = cached('a' + k, () => limbGeo(z ? look.skin : look.shirt, look.skin, armR, armLen));
    const legMesh = cached('l' + k, () => limbGeo(look.pants, z ? look.skin : 0x2b2540, 0.085, 0.13));
    const sx = z === 'brute' ? 0.4 : z === 'puffer' ? 0.37 : 0.25;
    for (const [pivot, s] of [[this.armL, -1], [this.armR, 1]] as const) {
      pivot.setLocalPosition(s * sx, 0.72, 0);
      pivot.addChild(mk(armMesh));
      this.root.addChild(pivot);
    }
    for (const [pivot, s] of [[this.legL, -1], [this.legR, 1]] as const) {
      pivot.setLocalPosition(s * (z === 'brute' ? 0.17 : 0.11), 0.33, 0);
      pivot.addChild(mk(legMesh));
      this.root.addChild(pivot);
    }
    this.root.addChild(this.body);
    this.root.addChild(this.head);
    const shadow = meshEntity(shadowMesh, shadowMat);
    const ss = z === 'brute' || z === 'puffer' ? 1.5 : 1;
    shadow.setLocalPosition(0, 0.03, 0);
    shadow.setLocalScale(ss, 1, ss);
    this.group.addChild(this.root);
    this.group.addChild(shadow);
  }

  /** Procedural pose. `t` is seconds, `dt` frame delta. */
  animate(pose: Pose, t: number, dt: number): void {
    const ph = t + this.phase;
    const z = !!this.look.zombie;
    let leg = 0, bob = 0, lean = 0, aL = 0, aR = 0, aLz = 0, aRz = 0, headZ = 0, squash = 1, rootX = 0, rootY = 0;
    switch (pose) {
      case 'idle':
        bob = Math.sin(ph * 2.2) * 0.012;
        headZ = Math.sin(ph * 1.3) * (z ? 0.18 : 0.04);
        aL = aR = z ? 0.25 + Math.sin(ph * 1.7) * 0.1 : 0.05;
        aLz = -0.12; aRz = 0.12;
        lean = z ? 0.12 : 0;
        break;
      case 'run': {
        const s = Math.sin(ph * 13);
        leg = s * 0.95; bob = Math.abs(Math.cos(ph * 13)) * 0.05;
        lean = z ? 0.28 : 0.12;
        if (z) { aL = 1.35 + Math.sin(ph * 9) * 0.22; aR = 1.45 + Math.cos(ph * 8) * 0.22; headZ = Math.sin(ph * 6.5) * 0.16; }
        else { aL = 1.25; aR = 1.4; aLz = 0.45; aRz = -0.1; } // survivors keep their gun up
        break;
      }
      case 'aim':
        aL = 1.25; aR = 1.4; aLz = 0.45; aRz = -0.1;
        bob = Math.sin(ph * 2.2) * 0.01;
        break;
      case 'attack': {
        const s = Math.sin(ph * 16);
        aL = 1.2 + s * 0.9; aR = 1.2 - s * 0.9; lean = 0.35; headZ = s * 0.12;
        bob = Math.abs(s) * 0.03;
        break;
      }
      case 'stagger':
        lean = -0.55; aL = aR = -0.6; aLz = -0.9; aRz = 0.9; headZ = Math.sin(ph * 20) * 0.2;
        leg = Math.sin(ph * 18) * 0.4;
        break;
      case 'windup':
        squash = 0.72; lean = 0.5; aL = aR = -0.9; aLz = -0.5; aRz = 0.5;
        break;
      case 'leap':
        lean = 1.15; aL = aR = 2.6; rootX = -0.9; rootY = 0.45; squash = 1.12;
        break;
      case 'down':
        rootX = -Math.PI / 2; rootY = 0.22; aL = 2.6 + Math.sin(ph * 3) * 0.2; aR = 0.4; headZ = Math.sin(ph * 2) * 0.1;
        break;
    }
    const k = Math.min(1, dt * 14), p = this.p;
    const to = (key: keyof typeof p, target: number) => { p[key] += (target - p[key]) * k; };
    to('leg', leg); to('aL', aL); to('aR', aR); to('aLz', aLz); to('aRz', aRz); to('headZ', headZ);
    to('lean', lean); to('rootX', rootX); to('rootY', rootY); to('squash', squash);
    setRot(this.legL, p.leg, 0, 0); setRot(this.legR, -p.leg, 0, 0);
    setRot(this.armL, p.aL, 0, p.aLz); setRot(this.armR, p.aR, 0, p.aRz);
    setRot(this.head, 0, 0, p.headZ);
    this.head.setLocalPosition(0, this.headBaseY + bob * 1.4, -p.lean * 0.16);
    setRot(this.body, -p.lean * 0.6, 0, 0);
    this.body.setLocalPosition(0, this.bodyBaseY + bob, 0);
    setRot(this.root, p.rootX, 0, 0);
    this.root.setLocalPosition(0, p.rootY, 0);
    this.punch = Math.max(0, this.punch - dt * 6);
    const pu = this.punch * 0.22;
    this.root.setLocalScale(1 + pu, p.squash - pu * 0.5, 1 + pu);
  }

  /** Death tumble, driven directly by the corpse animation. */
  tumble(rx: number, y: number): void { this.p.rootX = rx; this.p.rootY = y; setRot(this.root, rx, 0, 0); this.root.setLocalPosition(0, y, 0); }

  dispose(): void { this.group.destroy(); }
}

export function survivorLook(i: number): ChibiLook {
  const s = SURVIVORS[i % SURVIVORS.length];
  return { skin: 0xffdcc2, shirt: s.shirt, pants: 0x3d4a7a, hair: s.hair, style: s.style };
}

const WALKER_LOOKS: ChibiLook[] = [
  { skin: 0x9ccf7a, shirt: 0x6d7fb3, pants: 0x4a4466, hair: 0x4a3b33, style: 'mess', zombie: 'walker' },
  { skin: 0x86c79a, shirt: 0xc97b84, pants: 0x3e4a5c, hair: 0x2f2a3a, style: 'bald', zombie: 'walker' },
  { skin: 0xb0cf78, shirt: 0xe0c070, pants: 0x5a4a52, hair: 0x7a4a3a, style: 'bob', zombie: 'walker' },
  { skin: 0x7fbf8f, shirt: 0xe8e4f0, pants: 0x394a6a, hair: 0x5a5a6a, style: 'cap', zombie: 'walker' },
  { skin: 0xa4d68a, shirt: 0x8f6fb5, pants: 0x4a3f5f, hair: 0xc9a25a, style: 'mess', zombie: 'walker' },
  { skin: 0x8fc4a8, shirt: 0x5fa8a0, pants: 0x4f4a4a, hair: 0x3a2f2f, style: 'bob', zombie: 'walker' },
];
const SPECIAL_LOOKS: ChibiLook[] = [
  WALKER_LOOKS[0],
  { skin: 0x9a8fd0, shirt: 0x3a2f5f, pants: 0x2a2440, hair: 0x3a2f5f, style: 'hood', zombie: 'leaper', eye: 0xffa13d },
  { skin: 0xc8d86a, shirt: 0xa9c75a, pants: 0x6a6a3a, hair: 0x5a5a2a, style: 'bald', zombie: 'puffer', eye: 0xffffff },
  { skin: 0xe07a6a, shirt: 0x7a3f4f, pants: 0x3a2a3a, hair: 0x2a1a22, style: 'mess', zombie: 'brute', eye: 0xfff06a },
];

export function zombieLook(type: number, id: number): ChibiLook {
  return type === 0 ? WALKER_LOOKS[id % WALKER_LOOKS.length] : SPECIAL_LOOKS[type];
}

const tagMesh = toMesh(device, make(quad(), undefined, new pc.Mat4().setScale(1.5, 0.375, 1)));
/** Floating name tag: a camera-facing quad with the name drawn on a canvas. */
export function nameTag(text: string, color: string): pc.Entity {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '800 34px ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = '#1a1226'; g.lineJoin = 'round';
  g.strokeText(text, 128, 34); g.fillStyle = color; g.fillText(text, 128, 34);
  const mat = makeUnlit({ tex: canvasTexture(c, false), blend: 'normal', depthTest: false, fog: false, cull: 'none' });
  return meshEntity(tagMesh, mat);
}
