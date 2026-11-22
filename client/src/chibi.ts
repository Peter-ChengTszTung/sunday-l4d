// Chibi characters: huge head, bean body, stubby limbs. Built from primitives,
// vertex-coloured so every character shares one toon material, and animated
// procedurally (no skeletons). Models face -Z so yaw matches the camera.
// Each character is ONE merged mesh (toon pass + ink hull = 2 draws, plus its
// shadow): every vertex carries its part index in the colour alpha, and the
// vertex shader poses the parts from a small per-instance uniform array.
import * as pc from 'playcanvas';
import { type Geo, box, sphere, cylinder, capsule, ring, quad, make, merge, trs, toMesh } from './geo';
import { device, meshEntity, toonPartsMat, outlinePartsMat, makeUnlit, canvasTexture, freeTexture, setRot, WORLD, CHIBI_PARTS } from './gfx';
import { SURVIVORS, type SurvivorLook } from '../../shared/constants';

export type HairStyle = SurvivorLook['style'] | 'bald' | 'mess' | 'hood';
export type ZombieKind = 'walker' | 'leaper' | 'puffer' | 'brute' | 'charger' | 'drooler' | 'alarm' | 'snatcher' | 'piggyback' | 'weeper' | 'tinpot' | 'raincoat';
export interface ChibiLook {
  skin: number; shirt: number; pants: number; hair: number; style: HairStyle;
  zombie?: ZombieKind; eye?: number;
}
export type Pose = 'idle' | 'run' | 'aim' | 'attack' | 'stagger' | 'windup' | 'leap' | 'down' | 'charge' | 'pin' | 'ring' | 'sit' | 'swing' | 'slash' | 'chop';

const HEAD_Y = 1.06;
const ball = sphere(18, 12);
const dome = sphere(18, 8, Math.PI / 2);
const hood = sphere(18, 10, Math.PI * 0.68);
const cone = cylinder(8, 0, 1);
const cube = box();
const shadowMesh = toMesh(device, make(ring(0, 0.36, 16)));
const shadowMat = makeUnlit({ color: 0x0a0614, alpha: 0.38, blend: 'normal', fog: false });

// Part indices (vertex colour alpha / uParts slot).
const BODY = 0, HEAD = 1, ARM_L = 2, ARM_R = 3, LEG_L = 4, LEG_R = 5;
// Root-space box that holds every pose (down, leap, raised arms) of every type.
const POSE_AABB = new pc.BoundingBox(new pc.Vec3(0, 0.7, 0), new pc.Vec3(1.1, 1.05, 1.05));

const cache = new Map<string, pc.Mesh>();
/** One merged mesh for a look: [geometry, part index] pairs, each in its part's local space. */
function cachedChibi(key: string, build: () => [Geo, number][]): pc.Mesh {
  let m = cache.get(key);
  if (!m) {
    const parts = build();
    const alpha: number[] = [];
    for (const [g, i] of parts) for (let v = 0; v < g.pos.length / 3; v++) alpha.push(i);
    m = toMesh(device, merge(parts.map(([g]) => g)), true, alpha);
    m.aabb = POSE_AABB;
    cache.set(key, m);
  }
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
  switch (l.zombie) {
    case 'charger':
      // Sleep mask shoved up onto the forehead like a headband.
      parts.push(make(cylinder(18), 0x2a1f4a, trs(0, 0.13, 0.0, -0.12, 0, 0, 0.375, 0.09, 0.365)));
      for (const sx of [-1, 1]) parts.push(make(ball, 0xff9bd0, trs(sx * 0.12, 0.15, -0.355, -0.1, 0, 0, 0.085, 0.05, 0.03)));
      break;
    case 'drooler':
      // Hair curlers, puffed cheeks and a glowing rope of goo.
      for (const [x, z, c] of [[-0.18, -0.05, 0xff8fb8], [0.0, 0.02, 0x8fd8ff], [0.18, -0.03, 0xff8fb8], [-0.09, 0.2, 0x8fd8ff], [0.11, 0.2, 0xff8fb8]]) {
        parts.push(make(cylinder(10), c, trs(x, 0.4 - Math.abs(x) * 0.45, z - 0.02, 0, 0, Math.PI / 2, 0.075, 0.17, 0.075)));
      }
      for (const sx of [-1, 1]) parts.push(make(ball, 0xb7e37a, trs(sx * 0.2, -0.12, -0.25, 0, 0, 0, 0.1, 0.085, 0.07)));
      parts.push(make(cone, 0xb8ff6a, trs(0.02, -0.3, -0.31, Math.PI, 0, 0, 0.05, 0.2, 0.05)));
      parts.push(make(ball, 0xb8ff6a, trs(0.02, -0.42, -0.31, 0, 0, 0, 0.055)));
      break;
    case 'alarm':
      // Floppy nightcap with a pompom.
      parts.push(make(cone, 0x5a7fe0, trs(0.08, 0.36, 0.08, -0.5, 0, -0.35, 0.3, 0.45, 0.3)));
      parts.push(make(ball, 0xfff3d6, trs(0.22, 0.5, 0.3, 0, 0, 0, 0.085)));
      break;
    case 'snatcher':
      // A long striped scarf wound round the neck, one end trailing: the lasso.
      for (const [y, c, r] of [[-0.3, 0xff8fab, 0.3], [-0.24, 0xfff5f5, 0.31], [-0.18, 0xff8fab, 0.29]] as const) {
        parts.push(make(cylinder(16), c, trs(0, y, 0.01, 0, 0, 0, r, 0.07, r)));
      }
      parts.push(make(cube, 0xff8fab, trs(0.2, -0.42, -0.2, 0.2, 0, -0.25, 0.1, 0.26, 0.04)));
      parts.push(make(cube, 0xfff5f5, trs(0.23, -0.57, -0.22, 0.2, 0, -0.25, 0.1, 0.06, 0.045)));
      break;
    case 'piggyback':
      // Animal-onesie hood with round ears, and a wide open grin.
      for (const sx of [-1, 1]) {
        parts.push(make(ball, 0xffb3d1, trs(sx * 0.24, 0.33, 0.02, 0, 0, 0, 0.11, 0.11, 0.06)));
        parts.push(make(ball, 0xff7fb0, trs(sx * 0.24, 0.33, -0.02, 0, 0, 0, 0.06, 0.06, 0.04)));
      }
      break;
    case 'weeper':
      // Long lank hair falling past the shoulders, tear streaks under the eyes.
      parts.push(make(cube, 0xe9e4f5, trs(-0.27, -0.28, 0.06, 0, 0, 0.08, 0.14, 0.5, 0.3)));
      parts.push(make(cube, 0xe9e4f5, trs(0.27, -0.28, 0.06, 0, 0, -0.08, 0.14, 0.5, 0.3)));
      parts.push(make(cube, 0xe9e4f5, trs(0, -0.26, 0.26, 0.1, 0, 0, 0.5, 0.56, 0.12)));
      for (const sx of [-1, 1]) parts.push(make(cube, 0x8fd8ff, trs(sx * 0.14, -0.13, -0.33, 0, 0, 0, 0.03, 0.13, 0.02)));
      break;
    case 'tinpot':
      // A saucepan jammed on as a helmet, handle sticking out the back, and a colander-grey visor rim.
      parts.push(make(cylinder(16), 0xaab0c4, trs(0, 0.2, 0.0, 0, 0, 0, 0.39, 0.3, 0.39)));
      parts.push(make(cylinder(16), 0x7d8399, trs(0, 0.06, 0.0, 0, 0, 0, 0.42, 0.045, 0.42)));
      parts.push(make(cube, 0x54506e, trs(0, 0.2, 0.52, 0, 0, 0, 0.07, 0.05, 0.34)));
      break;
    case 'raincoat':
      // Sou'wester brim over the hood.
      parts.push(make(cylinder(16), 0xf2b90f, trs(0, 0.1, 0.04, 0.2, 0, 0, 0.47, 0.03, 0.47)));
      break;
  }
  return merge(parts);
}

/** Twin-bell alarm clock held in the hand at the end of an arm of total length `len`. */
function clockGeo(len: number): Geo {
  const y = -len - 0.12, z = -0.04;
  const parts = [
    make(cylinder(18), 0xe8453c, trs(0, y, z, Math.PI / 2, 0, 0, 0.17, 0.12, 0.17)),
    make(cylinder(18), 0xfff6dc, trs(0, y, z - 0.062, Math.PI / 2, 0, 0, 0.135, 0.01, 0.135)),
    make(cube, 0x1a1226, trs(0, y + 0.04, z - 0.07, 0, 0, 0, 0.018, 0.09, 0.01)),
    make(cube, 0x1a1226, trs(0.03, y, z - 0.07, 0, 0, 0, 0.065, 0.016, 0.01)),
    make(cube, 0xffd43b, trs(0, y + 0.19, z, 0, 0, 0, 0.02, 0.06, 0.02)),
  ];
  for (const sx of [-1, 1]) {
    parts.push(make(dome, 0xffd43b, trs(sx * 0.1, y + 0.15, z, 0, 0, sx * -0.5, 0.085, 0.08, 0.085)));
    parts.push(make(cube, 0xb0303a, trs(sx * 0.1, y - 0.15, z, 0, 0, sx * 0.4, 0.025, 0.07, 0.025)));
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
  if (l.zombie === 'charger') {
    // Hulking dressing gown with a lopsided shoulder hump over the big arm.
    return merge([
      make(ball, l.shirt, trs(0, 0.02, 0, 0, 0, 0, 0.3, 0.27, 0.25)),
      make(ball, l.shirt, trs(0.16, 0.17, 0.04, 0, 0, -0.3, 0.2, 0.17, 0.2)),
      make(cube, 0xf0d9e8, trs(0, -0.02, -0.2, 0, 0, 0, 0.36, 0.05, 0.04)),
      make(ball, l.pants, trs(0, -0.13, 0, 0, 0, 0, 0.25, 0.14, 0.22)),
    ]);
  }
  const wide = l.zombie === 'brute' ? 1.45 : l.zombie === 'leaper' || l.zombie === 'drooler' || l.zombie === 'snatcher' ? 0.85 : 1;
  if (l.zombie === 'tinpot') {
    // A baking tray strapped across the chest and a pot lid on the belly: the bulletproof front.
    return merge([
      make(ball, l.shirt, trs(0, 0.02, 0, 0, 0, 0, 0.23, 0.25, 0.2)),
      make(ball, l.pants, trs(0, -0.13, 0, 0, 0, 0, 0.2, 0.13, 0.18)),
      make(cube, 0xaab0c4, trs(0, 0.04, -0.21, 0, 0, 0, 0.36, 0.3, 0.035)),
      make(cylinder(14), 0x7d8399, trs(0, 0.0, -0.235, Math.PI / 2, 0, 0, 0.11, 0.03, 0.11)),
      make(ball, 0xffd43b, trs(0, 0.0, -0.26, 0, 0, 0, 0.03)),
    ]);
  }
  if (l.zombie === 'weeper') {
    // Long nightdress, flared at the hem.
    return merge([
      make(ball, l.shirt, trs(0, 0.02, 0, 0, 0, 0, 0.2, 0.25, 0.18)),
      make(cylinder(14, 0.55, 1), l.shirt, trs(0, -0.17, 0, 0, 0, 0, 0.27, 0.26, 0.25)),
    ]);
  }
  return merge([
    make(ball, l.shirt, trs(0, 0.02, 0, 0, 0, 0, 0.23 * wide, 0.25, 0.2 * (wide > 1 ? 1.25 : wide))),
    make(ball, l.pants, trs(0, -0.13, 0, 0, 0, 0, 0.2 * wide, 0.13, 0.18 * (wide > 1 ? 1.2 : wide))),
  ]);
}

export class Chibi {
  readonly group = new pc.Entity('chibi');
  readonly root = new pc.Entity('root'); // tilts/squashes without touching the shadow; draws the merged mesh
  // Transform-only part nodes (not in the scene graph): their local transforms,
  // relative to root, are packed into `parts` for the vertex shader.
  readonly head = new pc.GraphNode();
  readonly body = new pc.GraphNode();
  readonly armL = new pc.GraphNode();
  readonly armR = new pc.GraphNode();
  readonly legL = new pc.GraphNode();
  readonly legR = new pc.GraphNode();
  private readonly nodes = [this.body, this.head, this.armL, this.armR, this.legL, this.legR];
  private readonly parts = new Float32Array(CHIBI_PARTS * 12);
  phase = Math.random() * 10;
  punch = 0; // hit squash, decays to 0
  private readonly headBaseY: number;
  private readonly bodyBaseY: number;
  // Smoothed pose values (kept here so we never read rotations back from the engine).
  private p = { leg: 0, aL: 0, aR: 0, aLz: 0, aRz: 0, headZ: 0, lean: 0, rootX: 0, rootY: 0, rootZ: 0, squash: 1 };

  constructor(readonly look: ChibiLook) {
    const k = [look.skin, look.shirt, look.pants, look.hair, look.style, look.zombie ?? 'p', look.eye ?? 0].join('|');
    const z = look.zombie;
    const armR = z === 'brute' ? 0.11 : z === 'drooler' ? 0.055 : 0.065;
    const armLen = z === 'leaper' || z === 'drooler' || z === 'weeper' ? 0.24 : z === 'snatcher' ? 0.3 : z === 'brute' ? 0.22 : 0.15;
    const mesh = cachedChibi(k, () => {
      const arm = limbGeo(z ? look.skin : look.shirt, look.skin, armR, armLen);
      // Per-type right arm: the Charger's huge battering arm, the Alarm Clock's clock.
      const right = z === 'charger' ? limbGeo(look.skin, look.skin, 0.14, 0.3)
        : z === 'alarm' ? merge([arm, clockGeo(armLen + 2 * armR)]) : arm;
      const leg = limbGeo(look.pants, z ? look.skin : 0x2b2540, 0.085, 0.13);
      return [[bodyGeo(look), BODY], [headGeo(look), HEAD], [arm, ARM_L], [right, ARM_R], [leg, LEG_L], [leg, LEG_R]];
    });
    this.bodyBaseY = z === 'puffer' ? 0.62 : 0.55;
    this.headBaseY = z === 'puffer' ? 1.16 : HEAD_Y;
    if (z === 'brute') this.head.setLocalScale(0.82, 0.82, 0.82);
    if (z === 'charger') this.head.setLocalScale(0.9, 0.9, 0.9);
    const sx = z === 'brute' ? 0.4 : z === 'puffer' ? 0.37 : z === 'charger' ? 0.33 : 0.25;
    this.armL.setLocalPosition(-sx, 0.72, 0); this.armR.setLocalPosition(sx, 0.72, 0);
    const lx = z === 'brute' ? 0.17 : 0.11;
    this.legL.setLocalPosition(-lx, 0.33, 0); this.legR.setLocalPosition(lx, 0.33, 0);
    this.head.setLocalPosition(0, this.headBaseY, 0);
    this.body.setLocalPosition(0, this.bodyBaseY, 0);
    const meshInstances = [new pc.MeshInstance(mesh, toonPartsMat), new pc.MeshInstance(mesh, outlinePartsMat)];
    for (const mi of meshInstances) mi.setParameter('uParts[0]', this.parts);
    this.root.addComponent('render', { meshInstances, castShadows: false, receiveShadows: false, layers: [WORLD] });
    this.packParts();
    const shadow = meshEntity(shadowMesh, shadowMat);
    const ss = z === 'brute' || z === 'puffer' ? 1.5 : z === 'charger' ? 1.3 : 1;
    shadow.setLocalPosition(0, 0.03, 0);
    shadow.setLocalScale(ss, 1, ss);
    this.group.addChild(this.root);
    this.group.addChild(shadow);
  }

  /** Procedural pose. `t` is seconds, `dt` frame delta. */
  animate(pose: Pose, t: number, dt: number): void {
    const ph = t + this.phase;
    const z = !!this.look.zombie;
    const kind = this.look.zombie;
    let leg = 0, bob = 0, lean = 0, aL = 0, aR = 0, aLz = 0, aRz = 0, headZ = 0, squash = 1, rootX = 0, rootY = 0, rootZ = 0;
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
      case 'sit':
        // The Weeper: knees up, face in her hands, shoulders shaking.
        rootY = -0.2; lean = 0.75; leg = 0; aL = aR = 2.15 + Math.sin(ph * 9) * 0.05; aLz = 0.45; aRz = -0.45;
        headZ = Math.sin(ph * 2.1) * 0.07; bob = Math.abs(Math.sin(ph * 4.4)) * 0.018; squash = 0.9;
        break;
      case 'swing': {
        // Bat: both hands on it, a flat sweep across the body with the shoulders turning.
        const s = Math.sin(ph * 13);
        aR = 1.45; aL = 1.35; aRz = -0.2 + s * 0.95; aLz = 0.5 + s * 0.8; lean = 0.2; rootZ = -s * 0.1; headZ = s * 0.08;
        break;
      }
      case 'slash': {
        // Shears: quick one-handed cuts, up to one side and down to the other.
        const s = Math.sin(ph * 21);
        aR = 1.5 + s * 1.0; aRz = -0.3 + Math.cos(ph * 21) * 0.7; aL = 0.5; aLz = 0.35; lean = 0.3;
        break;
      }
      case 'chop': {
        // Axe: both arms hauled overhead, then slammed down with the whole body.
        const s = Math.sin(ph * 9.5), up = Math.max(0, s), dn = Math.max(0, -s);
        aL = aR = 1.4 + up * 1.5 - dn * 0.6; aLz = 0.25; aRz = -0.25; lean = -0.15 * up + 0.6 * dn; squash = 1 + up * 0.06 - dn * 0.1; bob = up * 0.03;
        break;
      }
      case 'windup':
        if (kind === 'weeper') {
          // Stirring: half risen, hands off her face, trembling. Back away.
          rootY = -0.08; lean = 0.4; aL = aR = 0.9; aLz = -0.7; aRz = 0.7; headZ = Math.sin(ph * 26) * 0.16; rootZ = Math.sin(ph * 33) * 0.035; squash = 0.96;
        } else if (kind === 'snatcher') {
          // Whirling the scarf overhead.
          aR = 2.9; aRz = Math.sin(ph * 20) * 0.7; aL = 0.4; aLz = -0.4; lean = -0.2; rootZ = Math.sin(ph * 20) * 0.05; headZ = Math.cos(ph * 20) * 0.1;
        } else if (kind === 'charger') {
          // Head down, big arm cocked back, one foot scraping the ground.
          lean = 0.95; squash = 0.86; aL = -0.4; aR = -1.1; aRz = 0.35; leg = Math.sin(ph * 16) * 0.7; headZ = Math.sin(ph * 9) * 0.08;
          rootX = 0.08; rootZ = Math.sin(ph * 30) * 0.03;
        } else if (kind === 'drooler') {
          // Rears back, cheeks swelling, arms flung out.
          lean = -0.45; squash = 1.1; aL = aR = 0.6; aLz = -1.1; aRz = 1.1; headZ = Math.sin(ph * 12) * 0.06;
        } else { squash = 0.72; lean = 0.5; aL = aR = -0.9; aLz = -0.5; aRz = 0.5; }
        break;
      case 'charge': {
        const s = Math.sin(ph * 22);
        lean = 1.05; leg = s * 1.1; bob = Math.abs(Math.cos(ph * 22)) * 0.07; aL = -0.6 + s * 0.3; aR = 1.5; aRz = -0.3; rootX = 0.15;
        break;
      }
      case 'pin': {
        const s = Math.sin(ph * 11);
        if (kind === 'snatcher') {
          // Hauling the scarf in hand over hand, leaning back against the weight.
          lean = -0.4; aL = 1.5 + s * 0.5; aR = 1.5 - s * 0.5; headZ = s * 0.06; leg = 0.25;
        } else if (kind === 'piggyback') {
          // Clinging on: arms hugged down round the victim's head, legs splayed, bouncing with glee.
          lean = 0.5; aL = aR = 0.9; aLz = 0.5; aRz = -0.5; leg = 1.0 + s * 0.15; headZ = Math.sin(ph * 15) * 0.25; bob = Math.abs(s) * 0.04;
        } else {
          // Pounding with the big arm.
          lean = 0.55; aR = 1.7 + s * 1.0; aL = 0.5; headZ = s * 0.1; bob = Math.max(0, -s) * 0.05;
        }
        break;
      }
      case 'ring':
        // Clock held high and rattling, the whole body wobbling with it.
        aR = 2.85 + Math.sin(ph * 42) * 0.18; aRz = 0.15; aL = 1.3 + Math.sin(ph * 17) * 0.4; aLz = -0.4;
        headZ = Math.sin(ph * 31) * 0.28; rootZ = Math.sin(ph * 24) * 0.13; bob = Math.abs(Math.sin(ph * 24)) * 0.05; squash = 1.04;
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
    to('lean', lean); to('rootX', rootX); to('rootY', rootY); to('rootZ', rootZ); to('squash', squash);
    setRot(this.legL, p.leg, 0, 0); setRot(this.legR, -p.leg, 0, 0);
    setRot(this.armL, p.aL, 0, p.aLz); setRot(this.armR, p.aR, 0, p.aRz);
    setRot(this.head, 0, 0, p.headZ);
    this.head.setLocalPosition(0, this.headBaseY + bob * 1.4, -p.lean * 0.16);
    setRot(this.body, -p.lean * 0.6, 0, 0);
    this.body.setLocalPosition(0, this.bodyBaseY + bob, 0);
    setRot(this.root, p.rootX, 0, p.rootZ);
    this.root.setLocalPosition(0, p.rootY, 0);
    this.punch = Math.max(0, this.punch - dt * 6);
    const pu = this.punch * 0.22;
    this.root.setLocalScale(1 + pu, p.squash - pu * 0.5, 1 + pu);
    this.packParts();
  }

  /** Copy each part's local transform into the uniform array as three row vec4s. */
  private packParts(): void {
    const out = this.parts;
    for (let i = 0; i < this.nodes.length; i++) {
      const d = this.nodes[i].getLocalTransform().data, o = i * 12;
      out[o] = d[0]; out[o + 1] = d[4]; out[o + 2] = d[8]; out[o + 3] = d[12];
      out[o + 4] = d[1]; out[o + 5] = d[5]; out[o + 6] = d[9]; out[o + 7] = d[13];
      out[o + 8] = d[2]; out[o + 9] = d[6]; out[o + 10] = d[10]; out[o + 11] = d[14];
    }
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
  // Sleep-Charger: maroon dressing gown, sleep mask up, one enormous arm.
  { skin: 0xa9c486, shirt: 0x8a2f45, pants: 0x3a2433, hair: 0x2a1a22, style: 'bald', zombie: 'charger', eye: 0xff5a4a },
  // Drooler: pale nightgown, curlers, goo-green glow.
  { skin: 0xb7c9a0, shirt: 0xe8e2f8, pants: 0xe8e2f8, hair: 0x7a5a8a, style: 'bob', zombie: 'drooler', eye: 0xb8ff6a },
  // Alarm Clock: striped-blue pyjamas, nightcap, bedside clock in hand.
  { skin: 0xa8d8a0, shirt: 0x8fb4ff, pants: 0x5a7fe0, hair: 0x4a3b33, style: 'bald', zombie: 'alarm', eye: 0xffe14a },
  // Snatcher: tall and thin in a teal cardigan, pink striped scarf, long arms.
  { skin: 0xa6c9c0, shirt: 0x2f7f8a, pants: 0x2a3a4a, hair: 0x2a3a4a, style: 'mess', zombie: 'snatcher', eye: 0xff8fab },
  // Piggyback: a little one in a pink animal onesie.
  { skin: 0xb6dc90, shirt: 0xff9ec4, pants: 0xff9ec4, hair: 0xff9ec4, style: 'hood', zombie: 'piggyback', eye: 0xffffff },
  // Weeper: bone-white nightdress, long pale hair, red-rimmed eyes.
  { skin: 0xc9d6c4, shirt: 0xf6f2ff, pants: 0xf6f2ff, hair: 0xe9e4f5, style: 'bob', zombie: 'weeper', eye: 0xff4d6d },
  // Tinpot: apron-brown clothes under kitchen armour.
  { skin: 0x9ccf7a, shirt: 0x8a6a4a, pants: 0x4a4466, hair: 0x4a3b33, style: 'bald', zombie: 'tinpot', eye: 0xfff3a8 },
  // Raincoat: yellow slicker with the hood up, red waterproof trousers.
  { skin: 0x8fc4a8, shirt: 0xffd43b, pants: 0xe8413c, hair: 0xffd43b, style: 'hood', zombie: 'raincoat', eye: 0xfff3a8 },
];

export function zombieLook(type: number, id: number): ChibiLook {
  return type === 0 ? WALKER_LOOKS[id % WALKER_LOOKS.length] : SPECIAL_LOOKS[type];
}

const tagMesh = toMesh(device, make(quad(), undefined, new pc.Mat4().setScale(1.5, 0.375, 1)));
/** Floating name tag: a camera-facing quad with the name drawn on a canvas. Its texture and material are freed when the entity is destroyed. */
export function nameTag(text: string, color: string): pc.Entity {
  const tex = canvasTexture(() => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d')!;
    g.font = '800 34px ui-rounded, "Arial Rounded MT Bold", "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 8; g.strokeStyle = '#1a1226'; g.lineJoin = 'round';
    g.strokeText(text, 128, 34); g.fillStyle = color; g.fillText(text, 128, 34);
    return c;
  }, false);
  const mat = makeUnlit({ tex, blend: 'normal', depthTest: false, fog: false, cull: 'none' });
  const e = meshEntity(tagMesh, mat);
  e.once('destroy', () => { mat.destroy(); freeTexture(tex); });
  return e;
}
