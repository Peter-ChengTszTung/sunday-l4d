// Chibi characters: huge head, bean body, stubby limbs. Built from primitives,
// vertex-coloured so every character shares one toon material, and animated
// procedurally (no skeletons). Models face -Z so rotation.y matches camera yaw.
import * as THREE from 'three';
import { toonVC, outlineMat, tint, trs, merge } from './toon';
import { SURVIVORS, type SurvivorLook } from '../../shared/constants';

export type HairStyle = SurvivorLook['style'] | 'bald' | 'mess' | 'hood';
export type ZombieKind = 'walker' | 'leaper' | 'puffer' | 'brute';
export interface ChibiLook {
  skin: number; shirt: number; pants: number; hair: number; style: HairStyle;
  zombie?: ZombieKind; eye?: number;
}
export type Pose = 'idle' | 'run' | 'aim' | 'attack' | 'stagger' | 'windup' | 'leap' | 'down';

const HEAD_Y = 1.06;
const sphere = new THREE.SphereGeometry(1, 18, 12);
const dome = new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2);
const hoodGeo = new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.68);
const cone = new THREE.ConeGeometry(1, 1, 8);
const boxG = new THREE.BoxGeometry(1, 1, 1);
const limb = new THREE.CapsuleGeometry(1, 1, 4, 10); // radius 1, mid-length 1 → scaled per use
const shadowGeo = new THREE.CircleGeometry(0.36, 16).rotateX(-Math.PI / 2);
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x0a0614, transparent: true, opacity: 0.38, depthWrite: false });

const cache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) { g = make(); cache.set(key, g); }
  return g;
}

function headGeometry(l: ChibiLook): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [tint(sphere, l.skin, trs(0, 0, 0, 0, 0, 0, 0.36, 0.335, 0.35))];
  const dark = 0x1a1226;
  if (l.zombie) {
    const glow = l.eye ?? 0xfff3a8;
    // Mismatched goggly eyes + a toothy grin.
    parts.push(tint(sphere, glow, trs(-0.135, 0.0, -0.3, 0, 0, 0, 0.095, 0.105, 0.05)));
    parts.push(tint(sphere, glow, trs(0.14, 0.02, -0.305, 0, 0, 0, 0.065, 0.07, 0.04)));
    parts.push(tint(sphere, dark, trs(-0.125, -0.01, -0.345, 0, 0, 0, 0.028, 0.028, 0.02)));
    parts.push(tint(sphere, dark, trs(0.15, 0.03, -0.34, 0, 0, 0, 0.022, 0.022, 0.02)));
    parts.push(tint(boxG, 0x4a1630, trs(0, -0.16, -0.315, 0.1, 0, 0, 0.2, 0.07, 0.05)));
    parts.push(tint(boxG, 0xfff8ee, trs(-0.05, -0.135, -0.335, 0.1, 0, 0, 0.045, 0.04, 0.03)));
    parts.push(tint(boxG, 0xfff8ee, trs(0.045, -0.185, -0.33, 0.1, 0, 0, 0.045, 0.04, 0.03)));
  } else {
    for (const s of [-1, 1]) {
      parts.push(tint(sphere, dark, trs(s * 0.13, -0.02, -0.31, 0, 0, 0, 0.058, 0.082, 0.04)));
      parts.push(tint(sphere, 0xffffff, trs(s * 0.13 + 0.02, 0.015, -0.345, 0, 0, 0, 0.022, 0.026, 0.015)));
      parts.push(tint(sphere, 0xff9bb0, trs(s * 0.22, -0.11, -0.27, 0, s * -0.6, 0, 0.05, 0.03, 0.012)));
    }
    parts.push(tint(sphere, 0x8a3b4a, trs(0, -0.14, -0.325, 0, 0, 0, 0.03, 0.016, 0.012)));
  }
  const tilt = 0.32;
  switch (l.style) {
    case 'cap':
      parts.push(tint(dome, l.hair, trs(0, 0.1, 0.02, tilt * 0.5, 0, 0, 0.375, 0.29, 0.37)));
      parts.push(tint(boxG, l.hair, trs(0, 0.2, -0.38, -0.12, 0, 0, 0.34, 0.035, 0.2)));
      break;
    case 'spiky':
      parts.push(tint(dome, l.hair, trs(0, 0.01, 0.02, tilt, 0, 0, 0.38, 0.36, 0.37)));
      for (const [x, y, z, rz, rx] of [[0, 0.38, 0, 0, 0.2], [-0.17, 0.32, 0.02, 0.55, 0.2], [0.17, 0.32, 0.02, -0.55, 0.2], [-0.08, 0.3, 0.2, 0.2, 0.9], [0.1, 0.3, 0.2, -0.2, 0.9]]) {
        parts.push(tint(cone, l.hair, trs(x, y, z, rx, 0, rz, 0.09, 0.22, 0.09)));
      }
      break;
    case 'buns':
      parts.push(tint(dome, l.hair, trs(0, 0.01, 0.02, tilt, 0, 0, 0.38, 0.36, 0.37)));
      for (const s of [-1, 1]) parts.push(tint(sphere, l.hair, trs(s * 0.31, 0.27, 0.06, 0, 0, 0, 0.135)));
      break;
    case 'bob':
      parts.push(tint(hoodGeo, l.hair, trs(0, 0.0, 0.03, tilt * 1.6, 0, 0, 0.39, 0.37, 0.38)));
      break;
    case 'hood':
      parts.push(tint(hoodGeo, l.hair, trs(0, 0.0, 0.04, 0.62, 0, 0, 0.41, 0.4, 0.4)));
      break;
    case 'mess':
      parts.push(tint(dome, l.hair, trs(0, 0.03, 0.03, tilt * 1.2, 0, 0.1, 0.375, 0.33, 0.36)));
      parts.push(tint(cone, l.hair, trs(0.12, 0.34, 0.05, 0.2, 0, -0.7, 0.07, 0.2, 0.07)));
      parts.push(tint(cone, l.hair, trs(-0.2, 0.28, 0.1, 0.4, 0, 0.9, 0.06, 0.16, 0.06)));
      break;
    case 'bald':
      break;
  }
  return merge(parts);
}

function limbGeometry(color: number, tip: number, r: number, len: number): THREE.BufferGeometry {
  // Hangs down from the pivot (origin) along -Y, with a contrasting hand/shoe.
  const total = len + 2 * r;
  return merge([
    tint(limb, color, trs(0, -total / 2, 0, 0, 0, 0, r, len, r)),
    tint(sphere, tip, trs(0, -total + r * 0.6, 0, 0, 0, 0, r * 1.25, r * 1.1, r * 1.3)),
  ]);
}

function bodyGeometry(l: ChibiLook): THREE.BufferGeometry {
  if (l.zombie === 'puffer') {
    const parts = [tint(sphere, l.shirt, trs(0, 0, 0, 0, 0, 0, 0.36, 0.33, 0.34))];
    for (const [x, y, z, s] of [[0.2, 0.12, -0.24, 0.09], [-0.16, -0.05, -0.29, 0.07], [0.02, 0.2, -0.26, 0.06], [-0.26, 0.14, -0.1, 0.08], [0.28, -0.08, 0.0, 0.07], [0.0, 0.1, 0.3, 0.09]]) {
      parts.push(tint(sphere, 0xe9f76a, trs(x, y, z, 0, 0, 0, s)));
    }
    return merge(parts);
  }
  const wide = l.zombie === 'brute' ? 1.45 : l.zombie === 'leaper' ? 0.85 : 1;
  return merge([
    tint(sphere, l.shirt, trs(0, 0.02, 0, 0, 0, 0, 0.23 * wide, 0.25, 0.2 * (wide > 1 ? 1.25 : wide))),
    tint(sphere, l.pants, trs(0, -0.13, 0, 0, 0, 0, 0.2 * wide, 0.13, 0.18 * (wide > 1 ? 1.2 : wide))),
  ]);
}

export class Chibi {
  readonly group = new THREE.Group();
  readonly root = new THREE.Group(); // tilts/squashes without touching the shadow
  readonly head: THREE.Mesh;
  readonly body: THREE.Mesh;
  readonly armL = new THREE.Group();
  readonly armR = new THREE.Group();
  readonly legL = new THREE.Group();
  readonly legR = new THREE.Group();
  phase = Math.random() * 10;
  punch = 0; // hit squash, decays to 0
  private readonly headBaseY: number;

  constructor(readonly look: ChibiLook) {
    const k = [look.skin, look.shirt, look.pants, look.hair, look.style, look.zombie ?? 'p', look.eye ?? 0].join('|');
    const z = look.zombie;
    const mk = (geo: THREE.BufferGeometry) => {
      const m = new THREE.Mesh(geo, toonVC);
      m.add(new THREE.Mesh(geo, outlineMat));
      return m;
    };
    this.body = mk(cached('b' + k, () => bodyGeometry(look)));
    this.body.position.y = z === 'puffer' ? 0.62 : 0.55;
    this.head = mk(cached('h' + k, () => headGeometry(look)));
    this.headBaseY = z === 'puffer' ? 1.16 : HEAD_Y;
    this.head.position.y = this.headBaseY;
    if (z === 'brute') this.head.scale.setScalar(0.82);

    const armR = z === 'brute' ? 0.11 : 0.065, armLen = z === 'leaper' ? 0.24 : z === 'brute' ? 0.22 : 0.15;
    const armGeo = cached('a' + k, () => limbGeometry(z ? look.skin : look.shirt, look.skin, armR, armLen));
    const legGeo = cached('l' + k, () => limbGeometry(look.pants, z ? look.skin : 0x2b2540, 0.085, 0.13));
    const sx = z === 'brute' ? 0.4 : z === 'puffer' ? 0.37 : 0.25;
    for (const [pivot, s] of [[this.armL, -1], [this.armR, 1]] as const) {
      pivot.position.set(s * sx, z === 'puffer' ? 0.72 : 0.72, 0);
      pivot.add(mk(armGeo));
      this.root.add(pivot);
    }
    for (const [pivot, s] of [[this.legL, -1], [this.legR, 1]] as const) {
      pivot.position.set(s * (z === 'brute' ? 0.17 : 0.11), 0.33, 0);
      pivot.add(mk(legGeo));
      this.root.add(pivot);
    }
    this.root.add(this.body, this.head);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.position.y = 0.03;
    shadow.scale.setScalar(z === 'brute' || z === 'puffer' ? 1.5 : 1);
    this.group.add(this.root, shadow);
  }

  /** Procedural pose. `t` is seconds, `dt` frame delta. */
  animate(pose: Pose, t: number, dt: number): void {
    const p = t * 1 + this.phase;
    const z = !!this.look.zombie;
    const { armL, armR, legL, legR, head, body, root } = this;
    let legSwing = 0, bob = 0, lean = 0, aL = 0, aR = 0, aLz = 0, aRz = 0, headTilt = 0, squashY = 1, rootX = 0, rootY = 0;
    switch (pose) {
      case 'idle':
        bob = Math.sin(p * 2.2) * 0.012;
        headTilt = Math.sin(p * 1.3) * (z ? 0.18 : 0.04);
        aL = aR = z ? 0.25 + Math.sin(p * 1.7) * 0.1 : 0.05;
        aLz = -0.12; aRz = 0.12;
        lean = z ? 0.12 : 0;
        break;
      case 'run': {
        const s = Math.sin(p * 13);
        legSwing = s * 0.95; bob = Math.abs(Math.cos(p * 13)) * 0.05;
        lean = z ? 0.28 : 0.12;
        if (z) { aL = 1.35 + Math.sin(p * 9) * 0.22; aR = 1.45 + Math.cos(p * 8) * 0.22; headTilt = Math.sin(p * 6.5) * 0.16; }
        else { aL = -s * 0.8; aR = s * 0.8; }
        break;
      }
      case 'aim':
        aL = 1.25; aR = 1.4; aLz = 0.45; aRz = -0.1;
        bob = Math.sin(p * 2.2) * 0.01;
        break;
      case 'attack': {
        const s = Math.sin(p * 16);
        aL = 1.2 + s * 0.9; aR = 1.2 - s * 0.9; lean = 0.35; headTilt = s * 0.12;
        bob = Math.abs(s) * 0.03;
        break;
      }
      case 'stagger':
        lean = -0.55; aL = aR = -0.6; aLz = -0.9; aRz = 0.9; headTilt = Math.sin(p * 20) * 0.2;
        legSwing = Math.sin(p * 18) * 0.4;
        break;
      case 'windup':
        squashY = 0.72; lean = 0.5; aL = aR = -0.9; aLz = -0.5; aRz = 0.5;
        break;
      case 'leap':
        lean = 1.15; aL = aR = 2.6; legSwing = 0; rootY = 0.45; squashY = 1.12;
        break;
      case 'down':
        rootX = -Math.PI / 2; rootY = 0.22; aL = 2.6 + Math.sin(p * 3) * 0.2; aR = 0.4; headTilt = Math.sin(p * 2) * 0.1;
        break;
    }
    const k = Math.min(1, dt * 14);
    const lerp = (a: number, b: number) => a + (b - a) * k;
    legL.rotation.x = lerp(legL.rotation.x, legSwing);
    legR.rotation.x = lerp(legR.rotation.x, -legSwing);
    armL.rotation.x = lerp(armL.rotation.x, aL); armR.rotation.x = lerp(armR.rotation.x, aR);
    armL.rotation.z = lerp(armL.rotation.z, aLz); armR.rotation.z = lerp(armR.rotation.z, aRz);
    head.rotation.z = lerp(head.rotation.z, headTilt);
    body.rotation.x = lerp(body.rotation.x, -lean * 0.6);
    head.position.z = lerp(head.position.z, -lean * 0.16);
    head.position.y = this.headBaseY + bob * 1.4;
    body.position.y = (this.look.zombie === 'puffer' ? 0.62 : 0.55) + bob;
    root.rotation.x = lerp(root.rotation.x, rootX !== 0 ? rootX : pose === 'leap' ? -0.9 : 0);
    root.position.y = lerp(root.position.y, rootY);
    this.punch = Math.max(0, this.punch - dt * 6);
    const pu = this.punch * 0.22;
    root.scale.set(1 + pu, lerp(root.scale.y, squashY) - pu * 0.5, 1 + pu);
  }

  dispose(): void { this.group.removeFromParent(); }
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

/** Floating name tag (canvas sprite). */
export function nameTag(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '800 34px ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = '#1a1226'; g.lineJoin = 'round';
  g.strokeText(text, 128, 34); g.fillStyle = color; g.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false }));
  s.scale.set(1.5, 0.375, 1);
  s.renderOrder = 10;
  return s;
}
