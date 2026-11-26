// Chibi characters: huge head, bean body, stubby limbs. Built from primitives,
// vertex-coloured so every character shares one toon material, and animated
// procedurally (no skeletons). Models face -Z so yaw matches the camera.
// Each character is ONE merged mesh (toon pass + ink hull = 2 draws, plus its
// shadow): every vertex carries its part index in the colour alpha, and the
// vertex shader poses the parts from a small per-instance uniform array.
import * as pc from 'playcanvas';
import { type Geo, box, sphere, cylinder, capsule, ring, quad, make, merge, trs, toMesh } from './geo';
import { device, draw, meshEntity, toonPartsMat, outlinePartsMat, makeUnlit, canvasTexture, freeTexture, setRot, WORLD, CHIBI_PARTS } from './gfx';
import { SURVIVORS, type SurvivorLook } from '../../shared/constants';
import { Horde, type HordeItem } from './horde';

export type HairStyle = SurvivorLook['style'] | 'bald' | 'mess' | 'hood';
export type ZombieKind = 'walker' | 'leaper' | 'puffer' | 'brute' | 'charger' | 'drooler' | 'alarm' | 'snatcher' | 'piggyback' | 'weeper' | 'tinpot' | 'raincoat';
/** What sets one walker apart from the next (they all went to bed as somebody). */
export type WalkerExtra = 'teddy' | 'bandage' | 'bow' | 'badge' | 'phones' | 'specs';
export interface ChibiLook {
  skin: number; shirt: number; pants: number; hair: number; style: HairStyle;
  zombie?: ZombieKind; eye?: number; extra?: WalkerExtra;
}
export type Pose = 'idle' | 'run' | 'aim' | 'attack' | 'stagger' | 'windup' | 'leap' | 'down' | 'charge' | 'pin' | 'ring' | 'sit' | 'swing' | 'slash' | 'chop';

const HEAD_Y = 1.06;
const ball = sphere(18, 12);
// Lower-poly balls for detail, by size on screen: a horde draws every vertex of every zombie twice (toon + ink).
const mid = sphere(12, 8), bit = sphere(8, 6), nub = sphere(6, 4);
const dome = sphere(18, 8, Math.PI / 2);
const hood = sphere(18, 10, Math.PI * 0.68);
const cone = cylinder(8, 0, 1);
const hoop = cylinder(12);
const cube = box();
const shadowMesh = toMesh(device, make(ring(0, 0.36, 16)));
const SHADOW_ALPHA = 0.38;
const shadowMat = makeUnlit({ color: 0x0a0614, alpha: SHADOW_ALPHA, blend: 'normal' });
/** The instanced zombie draws (see horde.ts); built with the first zombie. */
let horde: Horde | null = null;
/** The horde, once there has been a zombie (its `stats`: what it drew last frame). For checks and `?debug`. */
export const zombieHorde = (): Horde | null => horde;
const DARK = 0x1a1226, STEEL = 0xaab0c4, IRON = 0x7d8399, SLATE = 0x54506e, CREAM = 0xfff3d6, GOO = 0xb8ff6a, TEAR = 0x8fd8ff;

/** `color` darkened (f < 1) or lightened (f > 1). */
function shade(color: number, f: number): number {
  const c = (v: number) => Math.min(255, Math.round(v * f));
  return (c((color >> 16) & 255) << 16) | (c((color >> 8) & 255) << 8) | c(color & 255);
}
/** A primitive placed, turned and scaled: centre, radii (or box size), then rotation. */
const put = (g: Geo, color: number, x: number, y: number, z: number, sx: number, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0): Geo =>
  make(g, color, trs(x, y, z, rx, ry, rz, sx, sy, sz));
/** An ellipsoid body section: radii and centre height. */
type Egg = [ex: number, ey: number, ez: number, cy: number];
/** A band round an egg at height `y` (belts, stripes, hems), `grow` times its girth there. */
function band(color: number, y: number, [ex, ey, ez, cy]: Egg, h = 0.03, grow = 1.04): Geo {
  const k = Math.sqrt(Math.max(0.04, 1 - ((y - cy) / ey) ** 2));
  return put(hoop, color, 0, y, 0, ex * k * grow, h, ez * k * grow);
}
/** Z of an egg's front surface at (x, y): where buttons, patches and badges sit. */
const front = (x: number, y: number, [ex, ey, ez, cy]: Egg): number => -ez * Math.sqrt(Math.max(0.04, 1 - (x / ex) ** 2 - ((y - cy) / ey) ** 2));

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

/** Eyebrows: 1 = scowling (inner ends down), -1 = woeful (inner ends up). */
function brows(skin: number, tilt: number): Geo[] {
  const c = shade(skin, 0.45);
  return [put(cube, c, -0.135, 0.135, -0.315, 0.15, 0.035, 0.05, 0, 0, -0.38 * tilt), put(cube, c, 0.14, 0.12, -0.32, 0.11, 0.03, 0.05, 0, 0, 0.38 * tilt)];
}

function headGeo(l: ChibiLook): Geo {
  const parts: Geo[] = [make(ball, l.skin, trs(0, 0, 0, 0, 0, 0, 0.36, 0.335, 0.35))];
  const dark = DARK, z = l.zombie;
  if (z) {
    const glow = l.eye ?? 0xfff3a8, sunk = shade(l.skin, 0.62);
    // Mismatched goggly eyes in sunken sockets + a toothy grin.
    if (l.extra !== 'specs') {
      parts.push(put(mid, sunk, -0.135, -0.015, -0.283, 0.118, 0.128, 0.05));
      parts.push(put(bit, sunk, 0.14, 0.005, -0.288, 0.086, 0.092, 0.04));
    }
    parts.push(put(mid, glow, -0.135, 0.0, -0.3, 0.095, 0.105, 0.05));
    parts.push(put(mid, glow, 0.14, 0.02, -0.305, 0.065, 0.07, 0.04));
    parts.push(put(bit, dark, -0.125, -0.01, -0.345, 0.028, 0.028, 0.02));
    parts.push(put(nub, dark, 0.15, 0.03, -0.34, 0.022, 0.022, 0.02));
    parts.push(make(cube, 0x4a1630, trs(0, -0.16, -0.315, 0.1, 0, 0, 0.2, 0.07, 0.05)));
    parts.push(make(cube, 0xfff8ee, trs(-0.05, -0.135, -0.335, 0.1, 0, 0, 0.045, 0.04, 0.03)));
    parts.push(make(cube, 0xfff8ee, trs(0.045, -0.185, -0.33, 0.1, 0, 0, 0.045, 0.04, 0.03)));
    // A heavy lid drooping over the big eye (the wide-awake ones keep both eyes peeled), a nub of a nose, ears.
    if (z !== 'alarm' && z !== 'piggyback' && z !== 'weeper') parts.push(put(bit, shade(l.skin, 0.84), -0.135, 0.072, -0.305, 0.102, 0.052, 0.058, -0.2));
    if (z !== 'snatcher') parts.push(put(nub, shade(l.skin, 0.8), 0.01, -0.07, -0.345, 0.03, 0.024, 0.02));
    for (const sx of [-1, 1]) parts.push(put(bit, l.skin, sx * 0.35, -0.02, 0.02, 0.05, 0.085, 0.06));
    parts.push(put(nub, shade(l.skin, 0.7), 0.365, -0.05, 0.02, 0.03, 0.04, 0.035)); // a bite out of one ear
  } else {
    for (const s of [-1, 1]) {
      parts.push(make(mid, dark, trs(s * 0.13, -0.02, -0.31, 0, 0, 0, 0.058, 0.082, 0.04)));
      parts.push(make(nub, 0xffffff, trs(s * 0.13 + 0.02, 0.015, -0.345, 0, 0, 0, 0.022, 0.026, 0.015)));
      parts.push(make(bit, 0xff9bb0, trs(s * 0.22, -0.11, -0.27, 0, s * -0.6, 0, 0.05, 0.03, 0.012)));
    }
    parts.push(make(bit, 0x8a3b4a, trs(0, -0.14, -0.325, 0, 0, 0, 0.03, 0.016, 0.012)));
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
      for (const s of [-1, 1]) parts.push(make(mid, l.hair, trs(s * 0.31, 0.27, 0.06, 0, 0, 0, 0.135)));
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
      if (z) parts.push(make(cone, l.hair, trs(-0.02, 0.33, -0.12, -0.5, 0, 0.15, 0.06, 0.15, 0.06))); // bed-head tuft
      break;
    case 'bald':
      break;
  }
  switch (l.extra) {
    case 'bandage':
      // Head wrapped in a bandage, a spot of red soaking through.
      parts.push(put(hoop, 0xf3efe6, 0, 0.15, 0, 0.365, 0.08, 0.355, 0.12, 0, 0.22));
      parts.push(put(hoop, 0xe3ddd0, 0, 0.19, 0, 0.345, 0.03, 0.335, 0.12, 0, 0.22));
      parts.push(put(nub, 0xe8413c, -0.2, 0.2, -0.27, 0.05, 0.04, 0.03));
      break;
    case 'bow':
      // A big bow, slipped sideways.
      for (const sx of [-1, 1]) parts.push(put(bit, 0xff6b8a, 0.2 + sx * 0.085, 0.36, -0.02, 0.085, 0.065, 0.045, 0, 0, sx * -0.35));
      parts.push(put(nub, 0xd94a6c, 0.2, 0.355, -0.03, 0.04));
      break;
    case 'phones':
      // Fell asleep with the headphones on.
      parts.push(put(hoop, SLATE, 0, 0.08, 0.02, 0.385, 0.05, 0.39, Math.PI / 2));
      for (const sx of [-1, 1]) {
        parts.push(put(hoop, 0xff6b6b, sx * 0.37, -0.02, 0.02, 0.115, 0.07, 0.115, 0, 0, Math.PI / 2));
        parts.push(put(hoop, SLATE, sx * 0.405, -0.02, 0.02, 0.07, 0.02, 0.07, 0, 0, Math.PI / 2));
      }
      break;
    case 'specs':
      // Cracked glasses, and the toothbrush is still in.
      parts.push(put(hoop, dark, -0.135, 0.0, -0.3, 0.128, 0.03, 0.138, Math.PI / 2));
      parts.push(put(hoop, dark, 0.14, 0.02, -0.305, 0.098, 0.03, 0.104, Math.PI / 2));
      parts.push(put(cube, dark, 0.01, 0.015, -0.335, 0.09, 0.022, 0.02));
      for (const sx of [-1, 1]) parts.push(put(cube, dark, sx * 0.325, 0.02, -0.14, 0.02, 0.022, 0.3));
      parts.push(put(cube, 0xffffff, -0.17, 0.05, -0.352, 0.012, 0.09, 0.008, 0, 0, 0.6));
      parts.push(put(cube, 0x4dd4c6, 0.13, -0.17, -0.4, 0.022, 0.022, 0.2, 0, -0.5, 0));
      parts.push(put(cube, 0xffffff, 0.085, -0.17, -0.325, 0.03, 0.04, 0.04, 0, -0.5, 0));
      break;
  }
  switch (z) {
    case 'leaper':
      // Scowl, fangs, a pointed hood with its drawstrings swinging.
      parts.push(...brows(l.skin, 1));
      for (const sx of [-1, 1]) {
        parts.push(put(cone, 0xfff8ee, sx * 0.075, -0.2, -0.33, 0.022, 0.07, 0.022, Math.PI));
        parts.push(put(cube, 0xffa13d, sx * 0.1, -0.36, -0.23, 0.02, 0.17, 0.02, 0.15, 0, sx * 0.1));
        parts.push(put(nub, 0xffd43b, sx * 0.11, -0.45, -0.245, 0.024));
      }
      parts.push(put(cone, l.hair, 0, 0.38, 0.2, 0.13, 0.26, 0.13, 0.95));
      break;
    case 'puffer':
      // Blown-out cheeks, a lolling tongue, boils on the scalp.
      for (const sx of [-1, 1]) parts.push(put(bit, shade(l.skin, 1.08), sx * 0.24, -0.1, -0.2, 0.1, 0.09, 0.085));
      parts.push(put(bit, 0xff8fab, 0.03, -0.215, -0.34, 0.05, 0.03, 0.04));
      for (const [x, y, zz, r] of [[0.14, 0.29, -0.1, 0.05], [-0.2, 0.24, 0.05, 0.06], [0.02, 0.32, 0.12, 0.04]]) {
        parts.push(put(nub, 0xe9f76a, x, y, zz, r));
        parts.push(put(nub, 0xffffff, x + 0.012, y + r * 0.6, zz - r * 0.5, r * 0.3));
      }
      break;
    case 'brute':
      // One heavy brow ridge, a jutting jaw with tusks, a scar through the small eye.
      parts.push(put(cube, shade(l.skin, 0.68), 0, 0.125, -0.285, 0.52, 0.085, 0.13, 0.22));
      parts.push(put(bit, shade(l.skin, 0.92), 0, -0.21, -0.2, 0.22, 0.1, 0.15));
      for (const sx of [-1, 1]) parts.push(put(cone, 0xfff8ee, sx * 0.115, -0.115, -0.335, 0.032, 0.1, 0.032));
      parts.push(put(cube, shade(l.skin, 0.55), 0.21, 0.02, -0.285, 0.022, 0.24, 0.03, 0, 0, 0.35));
      break;
    case 'charger':
      // Sleep mask shoved up onto the forehead like a headband; still snoring, with a bubble on the nose.
      parts.push(make(cylinder(18), 0x2a1f4a, trs(0, 0.13, 0.0, -0.12, 0, 0, 0.375, 0.09, 0.365)));
      for (const sx of [-1, 1]) {
        parts.push(make(bit, 0xff9bd0, trs(sx * 0.12, 0.15, -0.355, -0.1, 0, 0, 0.085, 0.05, 0.03)));
        parts.push(put(cube, 0x2a1f4a, sx * 0.12, 0.14, -0.385, 0.09, 0.012, 0.01, -0.1)); // stitched-shut eyes on the mask
      }
      parts.push(put(bit, 0xbfe9ff, 0.07, -0.06, -0.41, 0.065));
      parts.push(put(nub, 0xffffff, 0.09, -0.03, -0.455, 0.018));
      parts.push(put(bit, shade(l.skin, 0.78), 0, -0.25, -0.2, 0.2, 0.08, 0.13)); // stubbly chin
      break;
    case 'drooler':
      // Hair curlers, puffed cheeks and a glowing rope of goo.
      for (const [x, zz, c] of [[-0.18, -0.05, 0xff8fb8], [0.0, 0.02, 0x8fd8ff], [0.18, -0.03, 0xff8fb8], [-0.09, 0.2, 0x8fd8ff], [0.11, 0.2, 0xff8fb8]]) {
        const y = 0.4 - Math.abs(x) * 0.45;
        parts.push(make(cylinder(10), c, trs(x, y, zz - 0.02, 0, 0, Math.PI / 2, 0.075, 0.17, 0.075)));
        parts.push(put(hoop, 0xfff5f5, x, y, zz - 0.02, 0.079, 0.03, 0.079, 0, 0, Math.PI / 2)); // the clip round each curler
      }
      for (const sx of [-1, 1]) parts.push(make(bit, 0xb7e37a, trs(sx * 0.2, -0.12, -0.25, 0, 0, 0, 0.1, 0.085, 0.07)));
      parts.push(make(cone, GOO, trs(0.02, -0.3, -0.31, Math.PI, 0, 0, 0.05, 0.2, 0.05)));
      parts.push(make(bit, GOO, trs(0.02, -0.42, -0.31, 0, 0, 0, 0.055)));
      // More dribble at the corners of the mouth, and lashes over the big eye.
      parts.push(put(cone, GOO, -0.09, -0.24, -0.3, 0.03, 0.11, 0.03, Math.PI));
      parts.push(put(cone, GOO, 0.1, -0.22, -0.3, 0.025, 0.08, 0.025, Math.PI));
      for (const [x, rz] of [[-0.2, 0.5], [-0.135, 0], [-0.07, -0.5]]) parts.push(put(cube, dark, x, 0.135, -0.33, 0.014, 0.06, 0.014, 0, 0, rz));
      break;
    case 'alarm':
      // Floppy nightcap with a pompom and a fleecy trim; a bead of cold sweat.
      parts.push(make(cone, 0x5a7fe0, trs(0.08, 0.36, 0.08, -0.5, 0, -0.35, 0.3, 0.45, 0.3)));
      parts.push(make(mid, 0xfff3d6, trs(0.22, 0.5, 0.3, 0, 0, 0, 0.085)));
      parts.push(put(hoop, 0xfff3d6, 0.0, 0.2, 0.0, 0.33, 0.075, 0.325, -0.25, 0, -0.18));
      parts.push(put(hoop, 0x8fb4ff, 0.115, 0.4, 0.14, 0.2, 0.03, 0.2, -0.5, 0, -0.35));
      parts.push(put(nub, TEAR, 0.28, 0.1, -0.2, 0.03, 0.045, 0.03));
      break;
    case 'snatcher':
      // A long striped scarf wound round the neck, one end trailing: the lasso. A long nose poking over it.
      for (const [y, c, r] of [[-0.3, 0xff8fab, 0.3], [-0.24, 0xfff5f5, 0.31], [-0.18, 0xff8fab, 0.29]] as const) {
        parts.push(make(cylinder(16), c, trs(0, y, 0.01, 0, 0, 0, r, 0.07, r)));
      }
      parts.push(make(cube, 0xff8fab, trs(0.2, -0.42, -0.2, 0.2, 0, -0.25, 0.1, 0.26, 0.04)));
      parts.push(make(cube, 0xfff5f5, trs(0.23, -0.57, -0.22, 0.2, 0, -0.25, 0.1, 0.06, 0.045)));
      parts.push(put(cube, 0xfff5f5, 0.195, -0.4, -0.2, 0.104, 0.05, 0.046, 0.2, 0, -0.25));
      for (const dx of [-0.035, 0, 0.035]) parts.push(put(cube, 0xff8fab, 0.24 + dx, -0.625, -0.23, 0.02, 0.06, 0.02, 0.2, 0, -0.25));
      parts.push(put(cone, shade(l.skin, 0.85), 0, -0.07, -0.4, 0.04, 0.14, 0.04, -Math.PI / 2));
      parts.push(...brows(l.skin, -0.6));
      break;
    case 'piggyback':
      // Animal-onesie hood with round ears, a snout and button eyes; a wide open grin underneath.
      for (const sx of [-1, 1]) {
        parts.push(make(mid, 0xffb3d1, trs(sx * 0.24, 0.33, 0.02, 0, 0, 0, 0.11, 0.11, 0.06)));
        parts.push(make(bit, 0xff7fb0, trs(sx * 0.24, 0.33, -0.02, 0, 0, 0, 0.06, 0.06, 0.04)));
        parts.push(put(nub, dark, sx * 0.13, 0.275, -0.275, 0.026));
        parts.push(put(nub, 0x8a2f58, sx * 0.03, 0.34, -0.3, 0.014));
      }
      parts.push(put(hoop, 0xff7fb0, 0, 0.31, -0.27, 0.085, 0.06, 0.07, -0.71));
      parts.push(put(cube, 0x4a1630, 0, -0.175, -0.31, 0.25, 0.11, 0.05, 0.1));
      parts.push(put(bit, 0xff8fab, 0, -0.2, -0.33, 0.07, 0.03, 0.025));
      break;
    case 'weeper':
      // Long lank hair falling past the shoulders and over the eyes, tear streaks ending in fat drops.
      parts.push(make(cube, 0xe9e4f5, trs(-0.27, -0.28, 0.06, 0, 0, 0.08, 0.14, 0.5, 0.3)));
      parts.push(make(cube, 0xe9e4f5, trs(0.27, -0.28, 0.06, 0, 0, -0.08, 0.14, 0.5, 0.3)));
      parts.push(make(cube, 0xe9e4f5, trs(0, -0.26, 0.26, 0.1, 0, 0, 0.5, 0.56, 0.12)));
      for (const sx of [-1, 1]) {
        parts.push(make(cube, TEAR, trs(sx * 0.14, -0.13, -0.33, 0, 0, 0, 0.03, 0.13, 0.02)));
        parts.push(put(nub, TEAR, sx * 0.14, -0.21, -0.33, 0.032, 0.04, 0.025));
      }
      for (const [x, h, rz] of [[-0.22, 0.2, 0.12], [-0.02, 0.15, -0.05], [0.2, 0.24, -0.14]]) parts.push(put(cube, 0xe9e4f5, x, 0.27 - h / 2, -0.31, 0.15, h, 0.05, 0.3, 0, rz));
      break;
    case 'tinpot':
      // A saucepan jammed on as a helmet, handle sticking out the back, and a colander-grey visor rim.
      parts.push(make(cylinder(16), STEEL, trs(0, 0.2, 0.0, 0, 0, 0, 0.39, 0.3, 0.39)));
      parts.push(make(cylinder(16), IRON, trs(0, 0.06, 0.0, 0, 0, 0, 0.42, 0.045, 0.42)));
      parts.push(make(cube, SLATE, trs(0, 0.2, 0.52, 0, 0, 0, 0.07, 0.05, 0.34)));
      // A bright top rim, a row of dents across the front, the handle's rivets and hanging loop.
      parts.push(put(hoop, 0xc9cfe0, 0, 0.345, 0, 0.4, 0.022, 0.4));
      for (const a of [-0.75, -0.3, 0.2, 0.65]) parts.push(put(nub, IRON, Math.sin(a) * 0.385, 0.2 + Math.cos(a * 7) * 0.05, -Math.cos(a) * 0.385, 0.035, 0.03, 0.02, 0, -a));
      for (const sx of [-1, 1]) parts.push(put(nub, 0xc9cfe0, sx * 0.02, 0.23, 0.4, 0.016));
      parts.push(put(hoop, 0xc9cfe0, 0, 0.2, 0.7, 0.045, 0.02, 0.045));
      parts.push(...brows(l.skin, 1));
      break;
    case 'raincoat':
      // Sou'wester brim over the hood, drawstring toggles, rain still dripping off it.
      parts.push(make(cylinder(16), 0xf2b90f, trs(0, 0.1, 0.04, 0.2, 0, 0, 0.47, 0.03, 0.47)));
      for (const sx of [-1, 1]) {
        parts.push(put(cube, SLATE, sx * 0.1, -0.34, -0.25, 0.016, 0.1, 0.016));
        parts.push(put(nub, SLATE, sx * 0.1, -0.4, -0.25, 0.024));
      }
      parts.push(put(cone, TEAR, 0.3, 0.0, -0.34, 0.022, 0.07, 0.022, Math.PI));
      parts.push(put(cone, TEAR, -0.38, 0.06, -0.2, 0.018, 0.05, 0.018, Math.PI));
      parts.push(put(nub, TEAR, 0.1, 0.19, -0.3, 0.03, 0.012, 0.03));
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
    // Hour marks, the hub of the hands, a chrome bezel, the winding key on the back, the hammer between the bells.
    put(hoop, 0xfff0c2, 0, y, z - 0.05, 0.158, 0.03, 0.158, Math.PI / 2),
    put(nub, 0xe8453c, 0, y, z - 0.072, 0.016),
    put(cube, 0xffd43b, 0, y, z + 0.085, 0.09, 0.03, 0.014),
    put(cube, IRON, 0, y, z + 0.07, 0.02, 0.02, 0.03),
    put(nub, 0xffd43b, 0, y + 0.225, z, 0.03),
  ];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, big = i % 3 === 0;
    parts.push(put(cube, 0x1a1226, Math.sin(a) * 0.108, y + Math.cos(a) * 0.108, z - 0.068, big ? 0.014 : 0.008, big ? 0.032 : 0.018, 0.006, 0, 0, -a));
  }
  for (const sx of [-1, 1]) {
    parts.push(make(dome, 0xffd43b, trs(sx * 0.1, y + 0.15, z, 0, 0, sx * -0.5, 0.085, 0.08, 0.085)));
    parts.push(make(cube, 0xb0303a, trs(sx * 0.1, y - 0.15, z, 0, 0, sx * 0.4, 0.025, 0.07, 0.025)));
    parts.push(put(nub, 0xfff0c2, sx * 0.135, y + 0.215, z, 0.02));
    parts.push(put(nub, 0xb0303a, sx * 0.115, y - 0.19, z, 0.028, 0.016, 0.028));
  }
  return merge(parts);
}

function limbGeo(color: number, tip: number, r: number, len: number): Geo {
  // Hangs down from the pivot (origin) along -Y, with a contrasting hand/shoe.
  const total = len + 2 * r;
  return merge([
    make(capsule(r, len), color, trs(0, -total / 2, 0)),
    make(mid, tip, trs(0, -total + r * 0.6, 0, 0, 0, 0, r * 1.25, r * 1.1, r * 1.3)),
  ]);
}

/** Three claws on the end of an arm of radius `r` and total length `total`: `len` long, in `color`. */
function claws(r: number, total: number, len: number, color: number): Geo[] {
  return [-0.62, 0, 0.62].map((k) => put(cone, color, k * r, -total - len * 0.3, -r * 0.5, r * 0.3, len, r * 0.3, Math.PI, 0, k * 0.25));
}

/** A zombie's arm (`side` -1 = left, 1 = right), hanging from the shoulder along -Y, palm side -Z. */
function zombieArm(l: ChibiLook, side: number, r: number, len: number): Geo {
  const z = l.zombie!, total = len + 2 * r, right = side > 0;
  const sleeved = z === 'raincoat' || z === 'snatcher' || z === 'alarm' || z === 'piggyback' || (z === 'charger' && !right);
  /** A band round the arm at `y`. */
  const cuff = (color: number, y: number, h = 0.035, grow = 1.16) => put(hoop, color, 0, y, 0, r * grow, h, r * grow);
  if (z === 'charger' && right) {
    // The battering arm: burst out of its sleeve, bandaged at the forearm, knuckles like cobblestones.
    const R = 0.14, T = 0.3 + 2 * R, parts = [limbGeo(l.skin, l.skin, R, 0.3), put(hoop, l.shirt, 0, -0.07, 0, R * 1.17, 0.09, R * 1.17), put(hoop, shade(l.shirt, 0.7), 0, -0.12, 0, R * 1.2, 0.025, R * 1.2)];
    for (const y of [-0.3, -0.355]) parts.push(put(hoop, 0xf0d9e8, 0, y, 0, R * 1.07, 0.04, R * 1.07, 0, 0, 0.12));
    for (const x of [-0.095, -0.032, 0.032, 0.095]) parts.push(put(bit, shade(l.skin, 0.84), x, -T + 0.03, -0.11, 0.042, 0.042, 0.05));
    parts.push(put(bit, shade(l.skin, 0.9), 0.06, -0.2, -0.1, 0.05, 0.09, 0.05)); // a vein standing out
    return merge(parts);
  }
  const hand = z === 'piggyback' ? shade(l.shirt, 0.82) : l.skin;
  const parts = [limbGeo(sleeved ? l.shirt : l.skin, hand, r, len)];
  // Bare arms keep the stump of a short sleeve at the shoulder; long sleeves end in a cuff.
  if (sleeved) parts.push(cuff(z === 'raincoat' ? shade(l.shirt, 0.8) : z === 'alarm' ? 0xdbe7ff : z === 'piggyback' ? 0xffd0e4 : shade(l.shirt, 1.3), -total + r * 1.75));
  else if (z !== 'puffer' && z !== 'brute') parts.push(put(mid, l.shirt, 0, -r * 0.75, 0, r * 1.32, r * 1.25, r * 1.32), cuff(shade(l.shirt, 0.78), -r * 1.7, 0.025, 1.3));
  // Hands: claws for most (long and red-tipped on the Weeper, hooked on the Leaper), mitts on the onesie.
  const mitt = z === 'tinpot' && right;
  if (z === 'weeper') parts.push(...claws(r, total, r * 2.6, 0xff4d6d));
  else if (z === 'leaper') parts.push(...claws(r, total, r * 1.9, 0x2a2440));
  else if (z === 'snatcher') parts.push(...claws(r, total, r * 1.9, shade(l.skin, 0.8)));
  else if (z !== 'piggyback' && !mitt) parts.push(...claws(r, total, r * (z === 'puffer' ? 0.7 : 1.15), CREAM));
  switch (z) {
    case 'walker':
      if (l.extra === 'teddy' && !right) {
        // Dragging a teddy bear by one leg.
        const y = -total, fur = 0xb07a4a;
        parts.push(put(nub, fur, 0.0, y - 0.03, 0, 0.026, 0.05, 0.026), put(nub, fur, 0.055, y - 0.07, 0, 0.026, 0.045, 0.026, 0, 0, 0.9));
        parts.push(put(bit, fur, 0.01, y - 0.13, 0, 0.062, 0.07, 0.052), put(bit, fur, 0.01, y - 0.225, 0, 0.058));
        parts.push(put(nub, 0xe8c79a, 0.01, y - 0.14, -0.04, 0.035, 0.04, 0.02), put(nub, 0xe8c79a, 0.01, y - 0.235, -0.045, 0.028, 0.022, 0.022));
        for (const sx of [-1, 1]) parts.push(put(nub, fur, 0.01 + sx * 0.048, y - 0.275, 0, 0.024), put(nub, DARK, 0.01 + sx * 0.022, y - 0.215, -0.052, 0.009), put(nub, fur, 0.01 + sx * 0.07, y - 0.12, 0, 0.022, 0.04, 0.022, 0, 0, sx * 0.9));
      }
      if (l.extra === 'badge' && right) parts.push(cuff(0x2b2540, -total + r * 1.9, 0.03, 1.12), put(cube, CREAM, 0, -total + r * 1.9, -r * 1.1, 0.045, 0.045, 0.02)); // wristwatch
      break;
    case 'brute':
      // Broken shackles, with a couple of links still swinging, and scarred knuckles.
      parts.push(cuff(IRON, -total + r * 2.1, 0.07, 1.14), cuff(STEEL, -total + r * 2.1, 0.02, 1.2));
      parts.push(put(hoop, IRON, side * r * 1.15, -total + r * 1.6, 0, 0.03, 0.05, 0.022), put(hoop, STEEL, side * r * 1.15, -total + r * 1.05, 0, 0.022, 0.05, 0.03));
      for (const x of [-0.07, 0, 0.07]) parts.push(put(bit, shade(l.skin, 0.82), x, -total + 0.02, -0.085, 0.036, 0.036, 0.045));
      parts.push(put(cube, shade(l.skin, 0.6), side * -0.02, -0.14, -r, 0.02, 0.12, 0.02, 0, 0, 0.5));
      break;
    case 'leaper':
      parts.push(cuff(shade(l.shirt, 1.5), -r * 2.3, 0.02, 1.22)); // hoodie sleeves shoved up past the elbow
      break;
    case 'alarm':
      for (const y of [-r * 1.2, -r * 2.6]) parts.push(cuff(0xdbe7ff, y, 0.025, 1.06)); // pyjama stripes
      break;
    case 'snatcher':
      parts.push(put(bit, 0xc9a04a, 0, -total * 0.5, r * 0.75, r * 0.75, r * 1.1, r * 0.4)); // elbow patch
      break;
    case 'tinpot':
      if (mitt) {
        // An oven mitt.
        parts.push(put(mid, 0xff8fab, 0, -total + r * 0.2, 0, r * 1.75, r * 1.9, r * 1.6), put(bit, 0xff8fab, -r * 1.5, -total + r * 0.9, 0, r * 0.7, r * 0.9, r * 0.7));
        parts.push(cuff(0xfff5f5, -total + r * 2.0, 0.045, 1.6), put(nub, 0xfff5f5, 0, -total + r * 0.1, -r * 1.5, r * 0.5));
      } else {
        // A wooden spoon to bang the pot with.
        parts.push(put(hoop, 0xc9a04a, 0, -total - 0.15, -0.015, 0.018, 0.34, 0.018), put(bit, 0xdcb766, 0, -total - 0.36, -0.015, 0.055, 0.075, 0.028), put(bit, 0xa07c30, 0, -total - 0.36, -0.03, 0.038, 0.055, 0.016));
      }
      break;
    case 'raincoat':
      parts.push(put(nub, SLATE, 0, -total + r * 1.75, -r * 1.2, 0.02)); // cuff stud
      break;
  }
  return merge(parts);
}

/** A zombie's leg and whatever it went to bed (or out) wearing on that foot. */
function zombieLeg(l: ChibiLook, side: number): Geo {
  const z = l.zombie!, r = 0.085;
  /** A slipper pulled over the foot. */
  const slipper = (c: number) => put(bit, c, 0, -0.262, -0.04, 0.11, 0.072, 0.15);
  const toes = (c: number) => [-0.055, 0, 0.055].map((x) => put(nub, c, x, -0.277, -0.105, 0.03, 0.028, 0.034));
  const cuff = (color: number, y: number, h = 0.03, grow = 1.14) => put(hoop, color, 0, y, 0, r * grow, h, r * grow);
  const parts = [limbGeo(l.pants, z === 'raincoat' ? 0x2a3a4a : z === 'snatcher' ? 0x3a2f2f : z === 'piggyback' ? shade(l.pants, 0.82) : l.skin, r, 0.13)];
  switch (z) {
    case 'raincoat':
      // Wellies, turned down at the top, with a pale sole.
      parts.push(put(bit, 0x2a3a4a, 0, -0.262, -0.04, 0.108, 0.07, 0.145), cuff(0x2a3a4a, -0.15, 0.09, 1.16), cuff(0x4a6a8a, -0.11, 0.025, 1.24), put(hoop, 0xdfe6f0, 0, -0.325, -0.035, 0.105, 0.02, 0.14));
      break;
    case 'snatcher':
      // Long scuffed loafers and one striped sock showing.
      parts.push(put(bit, 0x3a2f2f, 0, -0.268, -0.07, 0.095, 0.06, 0.185), cuff(side < 0 ? 0xff8fab : 0xfff5f5, -0.19, 0.03, 1.08), cuff(0xfff5f5, -0.16, 0.02, 1.08));
      break;
    case 'drooler':
      // Fluffy slippers with a pompom.
      parts.push(slipper(0xff9bd0), put(bit, 0xfff5f5, 0, -0.215, -0.14, 0.048), cuff(0xfff5f5, -0.2, 0.035, 1.2));
      break;
    case 'charger':
      // Tartan carpet slippers.
      parts.push(slipper(0x7a4a3a), cuff(0xf0d9e8, -0.215, 0.03, 1.2), put(cube, 0xc9a04a, 0, -0.215, -0.13, 0.13, 0.02, 0.02), put(cube, 0xc9a04a, 0, -0.225, -0.1, 0.02, 0.02, 0.14));
      break;
    case 'alarm': {
      // Bunny slippers; pyjama stripes up the leg.
      parts.push(slipper(0xfff5f5), put(nub, 0xff8fab, 0, -0.255, -0.19, 0.02), cuff(0xdbe7ff, -0.12, 0.025, 1.06));
      for (const sx of [-1, 1]) parts.push(put(nub, 0xfff5f5, sx * 0.045, -0.17, -0.1, 0.026, 0.075, 0.02, -0.3, 0, sx * -0.3), put(nub, 0xff8fab, sx * 0.045, -0.17, -0.112, 0.012, 0.05, 0.01, -0.3, 0, sx * -0.3), put(nub, DARK, sx * 0.04, -0.235, -0.165, 0.012));
      break;
    }
    case 'piggyback':
      parts.push(put(nub, 0x8a2f58, -0.03, -0.285, -0.1, 0.03, 0.02, 0.035), put(nub, 0x8a2f58, 0.03, -0.285, -0.1, 0.03, 0.02, 0.035)); // trotters
      break;
    case 'brute':
      parts.push(...toes(shade(l.skin, 0.85)), cuff(IRON, -0.17, 0.05, 1.18), cuff(shade(l.pants, 0.7), -0.11, 0.03, 1.2));
      break;
    case 'leaper':
      // Clawed toes, a patched knee.
      for (const x of [-0.055, 0, 0.055]) parts.push(put(cone, 0x2a2440, x, -0.285, -0.14, 0.022, 0.07, 0.022, -Math.PI / 2));
      parts.push(put(bit, shade(l.pants, 1.9), 0, -0.1, -0.075, 0.055, 0.06, 0.025), cuff(shade(l.pants, 0.7), -0.185, 0.025, 1.14));
      break;
    case 'weeper': case 'puffer':
      parts.push(...toes(shade(l.skin, 0.9)));
      break;
    default:
      // Barefoot, pyjama legs frayed at the ankle. The walker with the teddy kept his slippers; the one with glasses, one sock.
      if (l.extra === 'teddy') parts.push(slipper(0x5a7fe0), put(bit, 0xfff5f5, 0, -0.22, -0.13, 0.04));
      else if (l.extra === 'specs' && side < 0) parts.push(put(bit, 0xfff5f5, 0, -0.255, -0.02, 0.112, 0.085, 0.14), cuff(0xff6b6b, -0.19, 0.025, 1.1));
      else parts.push(...toes(shade(l.skin, 0.9)));
      parts.push(cuff(shade(l.pants, 0.75), -0.175, 0.03, 1.15));
  }
  return merge(parts);
}

function bodyGeo(l: ChibiLook): Geo {
  const z = l.zombie;
  if (z === 'puffer') {
    const E: Egg = [0.36, 0.33, 0.34, 0];
    const parts = [make(ball, l.shirt, trs(0, 0, 0, 0, 0, 0, 0.36, 0.33, 0.34))];
    // Boils (each with a shine on it), big and small, all the way round.
    for (const [x, y, zz, s] of [[0.2, 0.12, -0.24, 0.09], [-0.16, -0.05, -0.29, 0.07], [0.02, 0.2, -0.26, 0.06], [-0.26, 0.14, -0.1, 0.08], [0.28, -0.08, 0.0, 0.07], [0.0, 0.1, 0.3, 0.09],
      [0.14, -0.2, -0.22, 0.05], [-0.27, -0.12, 0.12, 0.06], [0.2, 0.16, 0.2, 0.065], [-0.12, 0.24, 0.14, 0.05], [0.31, 0.1, -0.08, 0.045]]) {
      parts.push(make(s > 0.065 ? bit : nub, 0xe9f76a, trs(x, y, zz, 0, 0, 0, s)));
      parts.push(put(nub, 0xffffff, x * 1.12, y * 1.12 + s * 0.45, zz * 1.12, s * 0.28));
    }
    // What is left of the pyjamas: a waistband cutting in, one braces strap, a stitched seam about to give, a belly button.
    parts.push(band(l.pants, -0.19, E, 0.07, 1.02), band(shade(l.pants, 0.75), -0.15, E, 0.02, 1.03));
    parts.push(put(hoop, shade(l.pants, 0.8), 0, 0.02, 0, 0.366, 0.055, 0.346, 0, 0, 0.72));
    parts.push(put(cube, shade(l.shirt, 0.55), -0.07, 0.0, front(-0.07, 0, E) - 0.004, 0.018, 0.22, 0.02));
    for (const y of [-0.07, 0, 0.07]) parts.push(put(cube, shade(l.shirt, 0.55), -0.07, y, front(-0.07, y, E) - 0.006, 0.07, 0.016, 0.02));
    parts.push(put(nub, shade(l.shirt, 0.6), 0.05, -0.09, front(0.05, -0.09, E), 0.026, 0.03, 0.02));
    return merge(parts);
  }
  if (z === 'charger') {
    // Hulking dressing gown with a lopsided shoulder hump over the big arm.
    const E: Egg = [0.3, 0.27, 0.25, 0.02], trim = 0xf0d9e8;
    const parts = [
      make(ball, l.shirt, trs(0, 0.02, 0, 0, 0, 0, 0.3, 0.27, 0.25)),
      make(mid, l.shirt, trs(0.16, 0.17, 0.04, 0, 0, -0.3, 0.2, 0.17, 0.2)),
      make(mid, l.pants, trs(0, -0.13, 0, 0, 0, 0, 0.25, 0.14, 0.22)),
      // Cord belt tied in front with the ends hanging, quilted lapels, a hanky in the pocket, the hem.
      band(trim, -0.03, E, 0.05, 1.03),
      put(bit, trim, 0.02, -0.03, front(0.02, -0.03, E) - 0.02, 0.045, 0.04, 0.03),
      put(cube, trim, -0.01, -0.12, front(0, -0.1, E) - 0.012, 0.028, 0.14, 0.02, 0, 0, 0.12),
      put(cube, trim, 0.05, -0.1, front(0.05, -0.1, E) - 0.012, 0.028, 0.1, 0.02, 0, 0, -0.2),
      put(nub, trim, -0.02, -0.2, front(0, -0.14, E) - 0.012, 0.024),
      put(cube, shade(l.shirt, 0.72), -0.17, -0.11, front(-0.17, -0.11, E) - 0.003, 0.1, 0.085, 0.02),
      put(nub, 0xfff5f5, -0.17, -0.06, front(-0.17, -0.07, E) - 0.006, 0.035, 0.03, 0.015),
      band(shade(l.shirt, 0.72), -0.2, E, 0.03, 1.05),
    ];
    for (const sx of [-1, 1]) parts.push(put(cube, trim, sx * 0.075, 0.1, front(sx * 0.075, 0.1, E) - 0.005, 0.06, 0.23, 0.03, 0, 0, sx * 0.42));
    return merge(parts);
  }
  const wide = z === 'brute' ? 1.45 : z === 'leaper' || z === 'drooler' || z === 'snatcher' ? 0.85 : 1;
  const E: Egg = [0.23 * wide, 0.25, 0.2 * (wide > 1 ? 1.25 : wide), 0.02];
  /** On the chest at (x, y), `out` proud of the cloth. */
  const at = (x: number, y: number, out = 0) => front(x, y, E) - out;
  if (z === 'tinpot') {
    // A baking tray strapped across the chest and a pot lid on the belly: the bulletproof front.
    const parts = [
      make(ball, l.shirt, trs(0, 0.02, 0, 0, 0, 0, 0.23, 0.25, 0.2)),
      make(mid, l.pants, trs(0, -0.13, 0, 0, 0, 0, 0.2, 0.13, 0.18)),
      make(cube, STEEL, trs(0, 0.04, -0.21, 0, 0, 0, 0.36, 0.3, 0.035)),
      make(cylinder(14), IRON, trs(0, 0.0, -0.235, Math.PI / 2, 0, 0, 0.11, 0.03, 0.11)),
      make(bit, 0xffd43b, trs(0, 0.0, -0.26, 0, 0, 0, 0.03)),
      // The tray's rolled edge and a dent, the straps holding it on, an apron bow at the back, a ladle through the belt.
      put(cube, 0xc9cfe0, 0, 0.19, -0.222, 0.38, 0.025, 0.045), put(cube, 0xc9cfe0, 0, -0.11, -0.222, 0.38, 0.025, 0.045),
      put(nub, IRON, 0.11, 0.12, -0.228, 0.04, 0.032, 0.008),
      band(SLATE, 0.13, E, 0.035, 1.05), band(SLATE, -0.05, E, 0.035, 1.05),
      put(hoop, STEEL, 0.0, 0.0, -0.238, 0.118, 0.012, 0.118, Math.PI / 2),
      put(hoop, 0xc9a04a, -0.2, 0.0, 0.1, 0.014, 0.26, 0.014, 0.25, 0, 0.1), put(bit, IRON, -0.215, -0.14, 0.07, 0.045, 0.035, 0.045),
    ];
    for (const sx of [-1, 1]) {
      for (const y of [0.15, -0.07]) parts.push(put(nub, SLATE, sx * 0.15, y, -0.232, 0.018));
      parts.push(put(bit, 0xfff5f5, sx * 0.055, -0.05, 0.2, 0.055, 0.035, 0.02, 0, 0, sx * -0.4), put(cube, 0xfff5f5, sx * 0.03, -0.13, 0.19, 0.03, 0.12, 0.015, 0, 0, sx * 0.15));
    }
    return merge(parts);
  }
  if (z === 'weeper') {
    // Long nightdress, flared at the hem.
    const parts = [
      make(ball, l.shirt, trs(0, 0.02, 0, 0, 0, 0, 0.2, 0.25, 0.18)),
      make(cylinder(14, 0.55, 1), l.shirt, trs(0, -0.17, 0, 0, 0, 0, 0.27, 0.26, 0.25)),
      // Lace at the hem, a sash, a red ribbon at the throat, the front of the skirt gone grey with tears.
      put(hoop, 0xe9e4f5, 0, -0.295, 0, 0.285, 0.03, 0.265), put(hoop, 0xdcd4ee, 0, -0.262, 0, 0.268, 0.012, 0.249),
      put(hoop, 0xdcd4ee, 0, -0.05, 0, 0.19, 0.035, 0.175),
      put(nub, 0xff4d6d, 0, 0.16, -0.15, 0.022),
      put(bit, 0xc9c2dc, 0.03, -0.17, -0.2, 0.09, 0.09, 0.03), put(nub, 0xc9c2dc, -0.08, -0.22, -0.215, 0.05, 0.05, 0.02),
    ];
    for (const sx of [-1, 1]) {
      parts.push(put(nub, 0xff4d6d, sx * 0.04, 0.165, -0.145, 0.035, 0.022, 0.015, 0, 0, sx * 0.4), put(cube, 0xff4d6d, sx * 0.02, 0.1, -0.165, 0.016, 0.09, 0.012, 0, 0, sx * 0.2));
      for (const a of [0.5, 1.4, 2.3]) parts.push(put(nub, 0xe9e4f5, Math.sin(a) * 0.285 * sx, -0.315, -Math.cos(a) * 0.265, 0.045, 0.03, 0.045)); // scalloped hem
    }
    return merge(parts);
  }
  const parts = [
    make(ball, l.shirt, trs(0, 0.02, 0, 0, 0, 0, E[0], 0.25, E[2])),
    make(mid, l.pants, trs(0, -0.13, 0, 0, 0, 0, 0.2 * wide, 0.13, 0.18 * (wide > 1 ? 1.2 : wide))),
  ];
  if (!z) return merge(parts);
  const buttons = (color: number, ys: number[], x = 0, r = 0.022) => { for (const y of ys) parts.push(put(nub, color, x, y, at(x, y, 0.004), r, r, r * 0.7)); };
  switch (z) {
    case 'walker': {
      // Pyjamas: buttons, a waistband, something spilt down the front, a rip showing the belly.
      buttons(shade(l.shirt, 1.5), [0.15, 0.06, -0.03]);
      parts.push(band(shade(l.pants, 1.35), -0.09, E, 0.03, 1.03));
      parts.push(put(bit, shade(l.shirt, 0.72), -0.1, 0.1, at(-0.1, 0.1) + 0.012, 0.065, 0.055, 0.02), put(nub, shade(l.shirt, 0.72), -0.13, 0.02, at(-0.13, 0.02) + 0.012, 0.03, 0.04, 0.02));
      parts.push(put(bit, l.skin, 0.12, -0.02, at(0.12, -0.02) + 0.016, 0.06, 0.045, 0.022), put(cube, shade(l.shirt, 0.6), 0.12, 0.025, at(0.12, 0.025), 0.1, 0.012, 0.02, 0, 0, 0.15));
      if (l.extra === 'badge') {
        // Night shift: a name badge and a satchel on a strap.
        parts.push(put(cube, 0xfff5f5, 0.1, 0.1, at(0.1, 0.1, 0.006), 0.075, 0.05, 0.02), put(cube, 0xff6b6b, 0.1, 0.115, at(0.1, 0.115, 0.01), 0.075, 0.016, 0.02));
        parts.push(put(hoop, 0x3a2f2f, 0, 0.03, 0, 0.222, 0.04, 0.2, 0, 0, 0.75), put(cube, 0x5a4a3a, -0.215, -0.11, 0.0, 0.09, 0.15, 0.17), put(cube, 0x3a2f2f, -0.225, -0.07, 0.0, 0.085, 0.07, 0.175));
      }
      if (l.extra === 'bow') for (const sx of [-1, 1]) parts.push(put(nub, 0xfff5f5, sx * 0.07, 0.19, at(sx * 0.07, 0.19, 0.01), 0.06, 0.03, 0.03, 0, 0, sx * 0.5)); // frilly collar
      if (l.extra === 'phones') parts.push(put(hoop, SLATE, 0.05, 0.02, at(0.05, 0.02, 0.004), 0.008, 0.3, 0.008, 0, 0, 0.2), put(cube, SLATE, 0.085, -0.13, at(0.085, -0.1, 0.01), 0.05, 0.07, 0.02)); // the player on its lead
      break;
    }
    case 'leaper':
      // Hoodie: zip, kangaroo pocket, ribbed hem.
      parts.push(put(cube, shade(l.shirt, 1.7), 0, 0.07, at(0, 0.07, 0.002), 0.014, 0.26, 0.02), put(nub, 0xffa13d, 0, 0.16, at(0, 0.16, 0.012), 0.018, 0.028, 0.012));
      parts.push(put(cube, shade(l.shirt, 1.45), 0, -0.04, at(0, -0.04, 0.004), 0.2, 0.085, 0.03), band(shade(l.shirt, 1.45), -0.1, E, 0.035, 1.05));
      break;
    case 'brute': {
      // A vest long since outgrown: two stretched stripes, a rope belt, slabs of shoulder, a scar down the chest.
      parts.push(band(shade(l.shirt, 1.35), 0.11, E, 0.035, 1.02), band(shade(l.shirt, 1.35), 0.0, E, 0.035, 1.02));
      parts.push(band(0xc9a04a, -0.1, E, 0.04, 1.04), put(bit, 0xc9a04a, 0.06, -0.1, at(0.06, -0.1, 0.02), 0.04, 0.035, 0.03), put(cube, 0xc9a04a, 0.08, -0.17, at(0.08, -0.12, 0.02), 0.025, 0.11, 0.02, 0, 0, -0.2));
      for (const sx of [-1, 1]) parts.push(put(mid, l.skin, sx * 0.27, 0.19, 0.0, 0.13, 0.1, 0.13));
      parts.push(put(cube, shade(l.skin, 0.6), -0.1, 0.19, at(-0.1, 0.19, 0.004), 0.02, 0.13, 0.02, 0, 0, 0.5));
      for (const k of [-1, 0, 1]) parts.push(put(cube, shade(l.skin, 0.6), -0.1 + k * 0.022, 0.19 + k * 0.04, at(-0.1, 0.19, 0.008), 0.05, 0.012, 0.02, 0, 0, 0.5));
      break;
    }
    case 'drooler':
      // Nightgown: a frill at the hem, a pink bow, goo down the front.
      parts.push(band(0xfff5f5, -0.2, [0.2 * wide, 0.13, 0.18 * wide, -0.13], 0.035, 1.3));
      for (const sx of [-1, 1]) parts.push(put(nub, 0xff8fb8, sx * 0.04, 0.16, at(sx * 0.04, 0.16, 0.006), 0.04, 0.025, 0.02, 0, 0, sx * 0.5));
      parts.push(put(nub, 0xd96a94, 0, 0.16, at(0, 0.16, 0.012), 0.018));
      parts.push(put(bit, GOO, 0.03, 0.06, at(0.03, 0.06) + 0.01, 0.055, 0.07, 0.02), put(nub, GOO, -0.05, -0.04, at(-0.05, -0.04) + 0.008, 0.035, 0.05, 0.02), put(cone, GOO, 0.03, -0.04, at(0.03, -0.04) - 0.004, 0.02, 0.08, 0.02, Math.PI));
      break;
    case 'alarm':
      // Striped pyjamas, buttoned up, with a breast pocket.
      for (const y of [0.15, 0.06, -0.03]) parts.push(band(0xdbe7ff, y, E, 0.022, 1.015));
      parts.push(band(0x8fb4ff, -0.15, [0.2, 0.13, 0.18, -0.13], 0.02, 1.02), band(shade(l.pants, 0.8), -0.09, E, 0.025, 1.03));
      buttons(0xfff5f5, [0.105, 0.015], 0, 0.02);
      parts.push(put(cube, 0x5a7fe0, 0.11, 0.1, at(0.11, 0.1, 0.002), 0.07, 0.06, 0.02));
      break;
    case 'snatcher':
      // Cardigan: a darker placket with brass buttons, two sagging pockets, a ribbed hem.
      parts.push(put(cube, shade(l.shirt, 0.65), 0, 0.02, at(0, 0.02, 0.003), 0.035, 0.26, 0.02));
      buttons(0xffd43b, [0.09, 0.01, -0.07], 0, 0.018);
      for (const sx of [-1, 1]) parts.push(put(cube, shade(l.shirt, 0.7), sx * 0.1, -0.05, at(sx * 0.1, -0.05, 0.002), 0.07, 0.06, 0.02));
      parts.push(band(shade(l.shirt, 0.7), -0.1, E, 0.035, 1.05));
      break;
    case 'piggyback':
      // Onesie: pale tummy patch, a zip, a curly tail.
      parts.push(put(mid, 0xffd0e4, 0, -0.02, -0.15, 0.13, 0.17, 0.062), put(cube, 0xff7fb0, 0, 0.06, at(0, 0.06, 0.012), 0.012, 0.2, 0.02), put(nub, 0xffd43b, 0, 0.15, at(0, 0.15, 0.016), 0.02, 0.03, 0.012));
      parts.push(put(nub, 0xff7fb0, 0, -0.12, 0.19, 0.03), put(nub, 0xff7fb0, 0.035, -0.09, 0.225, 0.028), put(nub, 0xff7fb0, 0.0, -0.06, 0.25, 0.024));
      break;
    case 'raincoat':
      // Slicker: flared skirt, toggles, a reflective band, pocket flaps.
      parts.push(put(cylinder(14, 0.72, 1), l.shirt, 0, -0.13, 0, 0.26, 0.2, 0.235), put(hoop, shade(l.shirt, 0.82), 0, -0.225, 0, 0.268, 0.022, 0.242));
      parts.push(band(0xdfe6f0, 0.07, E, 0.035, 1.03), put(cube, shade(l.shirt, 0.82), 0, 0.02, at(0, 0.02, 0.003), 0.02, 0.3, 0.02));
      for (const y of [0.15, 0.02, -0.1]) parts.push(put(cube, SLATE, 0.03, y, y < -0.05 ? -0.225 : at(0.03, y, 0.008), 0.06, 0.022, 0.02));
      for (const sx of [-1, 1]) parts.push(put(cube, shade(l.shirt, 0.82), sx * 0.12, -0.1, -0.205, 0.085, 0.03, 0.03, 0.1));
      break;
  }
  return merge(parts);
}

/** Everything a pose can set; `animate` eases the character toward it. Angles in radians, offsets in model units. */
const REST = {
  /** Legs: `leg` swings them opposite ways, `legB` both the same way, `limp` (0..1) shortens the right leg's swing, `legZ` splays them. */
  leg: 0, legB: 0, limp: 0, legZ: 0,
  /** Arms: swing forward/up (`aL`, `aR`) and out to the side (`aLz`, `aRz`; negative on the left is outward). */
  aL: 0, aR: 0, aLz: 0, aRz: 0,
  /** Head: nod (positive looks up), turn, tilt, and a size pulse. */
  headX: 0, headY: 0, headZ: 0, hs: 1,
  /** Torso: forward lean, shoulder twist, sideways roll, breadth and height pulses (breathing, jiggle). */
  lean: 0, twist: 0, bodyZ: 0, bw: 1, bh: 1,
  /** Whole character: pitch, lift, roll, vertical squash; `bob` is the step bounce (not eased). */
  rootX: 0, rootY: 0, rootZ: 0, squash: 1, bob: 0,
};
type Target = typeof REST;
/** The eased values, in the order they are stepped. */
const EASED = ['legL', 'legR', 'legZ', 'aL', 'aR', 'aLz', 'aRz', 'headX', 'headY', 'headZ', 'hs', 'lean', 'twist', 'bodyZ', 'bw', 'bh', 'rootX', 'rootY', 'rootZ', 'squash'] as const;
/** The eased values at rest (a fresh chibi, and one reset for reuse). */
const EASED_REST = { legL: 0, legR: 0, legZ: 0, aL: 0, aR: 0, aLz: 0, aRz: 0, headX: 0, headY: 0, headZ: 0, hs: 1, lean: 0, twist: 0, bodyZ: 0, bw: 1, bh: 1, rootX: 0, rootY: 0, rootZ: 0, squash: 1 };
const sin = Math.sin, cos = Math.cos, abs = Math.abs, pos = (v: number) => Math.max(0, v);

export class Chibi implements HordeItem {
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
  readonly parts = new Float32Array(CHIBI_PARTS * 12);
  phase = Math.random() * 10;
  punch = 0; // hit squash, decays to 0
  private readonly headBaseY: number;
  private readonly bodyBaseY: number;
  /** Shoulder half-width and the head's resting scale. */
  private readonly armX: number;
  private readonly headS: number;
  /** What makes this one move unlike the next: how it carries its arms (0 both out, 1 one hanging + a limp, 2 hunched and low) and which way its head lolls. */
  private readonly style = Math.random() < 0.4 ? 0 : Math.random() < 0.5 ? 1 : 2;
  private readonly loll = (Math.random() - 0.5) * 0.5;
  private readonly tgt: Target = { ...REST };
  // Smoothed pose values (kept here so we never read rotations back from the engine).
  private p = { ...EASED_REST };
  /** The toon and ink draws (see `onScreen`); none when the horde draws it. */
  private readonly draws: pc.MeshInstance[] | null = null;
  readonly mesh: pc.Mesh;
  /** Where the ring shadow lies (a transform only when the horde draws it). */
  readonly shadowNode: pc.GraphNode;
  // Horde bookkeeping (see HordeItem).
  private _visible = true;
  drawn = false;
  hordeAt = -1;

  /**
   * `instanced` (zombies): drawn by the horde, in a handful of draws for the whole crowd, rather than by
   * render components of its own. Such a chibi stays out of the scene graph: `group` and `root` only carry
   * its transforms, and `visible` (not `group.enabled`) shows and hides it.
   */
  constructor(readonly look: ChibiLook, readonly instanced = false) {
    const k = [look.skin, look.shirt, look.pants, look.hair, look.style, look.zombie ?? 'p', look.eye ?? 0, look.extra ?? ''].join('|');
    const z = look.zombie;
    const armR = z === 'brute' ? 0.11 : z === 'drooler' ? 0.055 : 0.065;
    const armLen = z === 'leaper' || z === 'drooler' || z === 'weeper' ? 0.24 : z === 'snatcher' ? 0.3 : z === 'brute' ? 0.22 : 0.15;
    const mesh = cachedChibi(k, () => {
      if (!z) {
        const arm = limbGeo(look.shirt, look.skin, armR, armLen), leg = limbGeo(look.pants, 0x2b2540, 0.085, 0.13);
        return [[bodyGeo(look), BODY], [headGeo(look), HEAD], [arm, ARM_L], [arm, ARM_R], [leg, LEG_L], [leg, LEG_R]];
      }
      // Per-type arms: the Charger's huge battering arm, the Alarm Clock's clock, the Tinpot's spoon and oven mitt...
      const right = zombieArm(look, 1, armR, armLen);
      return [[bodyGeo(look), BODY], [headGeo(look), HEAD], [zombieArm(look, -1, armR, armLen), ARM_L],
        [z === 'alarm' ? merge([right, clockGeo(armLen + 2 * armR)]) : right, ARM_R], [zombieLeg(look, -1), LEG_L], [zombieLeg(look, 1), LEG_R]];
    });
    this.bodyBaseY = z === 'puffer' ? 0.62 : 0.55;
    this.headBaseY = z === 'puffer' ? 1.16 : HEAD_Y;
    this.headS = z === 'brute' ? 0.82 : z === 'charger' ? 0.9 : 1;
    this.armX = z === 'brute' ? 0.4 : z === 'puffer' ? 0.37 : z === 'charger' ? 0.33 : 0.25;
    const lx = z === 'brute' ? 0.17 : 0.11;
    this.legL.setLocalPosition(-lx, 0.33, 0); this.legR.setLocalPosition(lx, 0.33, 0);
    this.mesh = mesh;
    if (!instanced) {
      const meshInstances = [draw(mesh, toonPartsMat), draw(mesh, outlinePartsMat)];
      for (const mi of meshInstances) mi.setParameter('uParts[0]', this.parts);
      this.draws = meshInstances;
      this.root.addComponent('render', { meshInstances, castShadows: false, receiveShadows: false, layers: [WORLD] });
    }
    this.place(0);
    const shadow = this.shadowNode = instanced ? new pc.GraphNode('shadow') : meshEntity(shadowMesh, shadowMat);
    const ss = z === 'brute' || z === 'puffer' ? 1.5 : z === 'charger' ? 1.3 : 1;
    shadow.setLocalPosition(0, 0.03, 0);
    shadow.setLocalScale(ss, 1, ss);
    this.group.addChild(this.root);
    this.group.addChild(shadow);
    if (instanced) (horde ??= new Horde(shadowMesh, SHADOW_ALPHA)).add(this);
  }

  /** Shown or hidden (a pooled spare, one out in the fog). The horde's zombies use this; others may too. */
  get visible(): boolean { return this._visible; }
  set visible(v: boolean) {
    this._visible = v;
    if (!this.instanced) this.group.enabled = v;
  }

  /** Procedural pose. `t` is seconds, `dt` frame delta. */
  animate(pose: Pose, t: number, dt: number): void {
    const ph = t + this.phase, kind = this.look.zombie, z = !!kind;
    const T = Object.assign(this.tgt, REST), style = this.style;
    /** Now and then (about one second in seven) something in a zombie twitches: 0, briefly up to 1. */
    const tic = pos(sin(ph * 0.9 + this.phase) - 0.93) / 0.07;
    switch (pose) {
      case 'idle': {
        const breath = sin(ph * 2.2);
        T.bob = breath * 0.012; T.aLz = -0.12; T.aRz = 0.12;
        if (!z) { T.headZ = sin(ph * 1.3) * 0.04; T.aL = T.aR = 0.05; T.bh = 1 + breath * 0.015; break; }
        T.bh = 1 + breath * 0.03;
        switch (kind) {
          case 'leaper':
            // Down on its haunches, hands on the floor, head snapping from side to side.
            T.squash = 0.86; T.lean = 0.55; T.rootY = -0.05; T.aL = T.aR = 0.95; T.aLz = -0.25; T.aRz = 0.25; T.legZ = 0.35;
            T.headX = 0.3; T.headY = sin(ph * 1.2) * 0.6; T.headZ = tic * 0.4;
            break;
          case 'puffer':
            // Swelling and sagging, arms shoved out by the belly, the odd hiccup.
            T.bw = 1 + sin(ph * 1.6) * 0.05; T.bh = 1 - sin(ph * 1.6) * 0.04; T.rootZ = sin(ph * 0.8) * 0.06;
            T.aL = T.aR = 0.15; T.aLz = -0.55; T.aRz = 0.55; T.headZ = sin(ph * 1.3) * 0.1; T.bob += tic * 0.05; T.squash = 1 + tic * 0.05; T.hs = 1 + tic * 0.06;
            break;
          case 'brute':
            // Knuckles hanging, shoulders heaving, the head swinging slowly round for something to hit.
            T.lean = 0.3; T.aL = T.aR = 0.45 + sin(ph * 1.5) * 0.06; T.aLz = -0.3; T.aRz = 0.3;
            T.bh = 1 + sin(ph * 1.5) * 0.05; T.bw = 1 + sin(ph * 1.5) * 0.03; T.headX = -0.15; T.headY = sin(ph * 0.5) * 0.3; T.headZ = sin(ph * 1.1) * 0.05;
            break;
          case 'charger': {
            // Asleep on its feet: the head sinks, sinks, and jerks back up.
            const n = (ph * 0.3) % 1, nod = n < 0.85 ? n / 0.85 : (1 - n) / 0.15;
            T.headX = -0.6 * nod; T.lean = 0.12 + nod * 0.25; T.aR = 0.15; T.aRz = 0.15; T.aL = 0.1; T.rootZ = -0.05 + sin(ph * 0.9) * 0.04;
            T.bh = 1 + sin(ph * 1.2) * 0.04; T.headZ = sin(ph * 0.9) * 0.08;
            break;
          }
          case 'drooler':
            // Swaying with the head lolled back, arms dangling.
            T.lean = -0.1; T.headX = 0.25; T.headZ = sin(ph * 0.9) * 0.3; T.bodyZ = sin(ph * 0.9) * 0.1; T.rootZ = sin(ph * 0.9) * 0.05;
            T.aL = sin(ph * 0.9 + 1) * 0.15; T.aR = -T.aL;
            break;
          case 'alarm':
            // Hugging the clock and looking over both shoulders, knees knocking.
            T.headY = sin(ph * 3.1) * 0.6; T.headZ = sin(ph * 2.3) * 0.06; T.aR = 1.15; T.aRz = -0.55; T.aL = 1.0; T.aLz = 0.5;
            T.lean = 0.25; T.leg = sin(ph * 14) * 0.08; T.squash = 0.97;
            break;
          case 'snatcher':
            // Standing tall, fiddling with the scarf, peering about.
            T.lean = -0.05; T.aR = 1.2 + sin(ph * 2) * 0.15; T.aRz = -0.6; T.aL = 0.05; T.headZ = sin(ph * 1.1) * 0.12; T.headY = sin(ph * 0.6) * 0.4; T.bodyZ = sin(ph * 1.1) * 0.05;
            break;
          case 'piggyback': {
            // Can't keep still: bouncing on the spot, arms waving.
            const hop = abs(sin(ph * 5));
            T.bob = hop * 0.06; T.squash = 0.93 + hop * 0.09; T.aL = 2.4 + sin(ph * 10) * 0.3; T.aR = 2.4 - sin(ph * 10) * 0.3; T.aLz = -0.5; T.aRz = 0.5;
            T.headZ = sin(ph * 5) * 0.2; T.legZ = 0.2;
            break;
          }
          default:
            // Commons: swaying on the spot, weight shifting, the head drifting round and now and then jerking up.
            T.lean = style === 2 ? 0.25 : 0.12; T.headZ = this.loll + sin(ph * 1.3) * 0.18; T.headY = sin(ph * 0.7 + this.phase) * 0.35; T.headX = -0.08 + tic * 0.3;
            T.aL = 0.25 + sin(ph * 1.7) * 0.1; T.aR = style === 1 ? 0.05 : 0.25 + sin(ph * 1.7 + 1) * 0.1;
            T.bodyZ = sin(ph * 1.1) * 0.06; T.rootZ = sin(ph * 1.1) * 0.03; T.leg = sin(ph * 1.1) * 0.05;
            if (kind === 'tinpot') { T.aL = 1.6 + sin(ph * 1.7) * 0.12; T.headY *= 0.4; } // spoon at the ready
        }
        break;
      }
      case 'run': {
        if (!z) { const s = sin(ph * 13); T.leg = s * 0.95; T.bob = abs(cos(ph * 13)) * 0.05; T.lean = 0.12; T.aL = 1.25; T.aR = 1.4; T.aLz = 0.45; T.aRz = -0.1; break; } // survivors keep their gun up
        switch (kind) {
          case 'leaper': {
            // Loping low on all fours.
            const s = sin(ph * 16);
            T.leg = s * 1.1; T.bob = abs(cos(ph * 16)) * 0.07; T.lean = 0.75; T.squash = 0.9; T.rootY = -0.06; T.aL = 1.5 + s * 0.7; T.aR = 1.5 - s * 0.7; T.twist = s * 0.2; T.headX = 0.15;
            break;
          }
          case 'puffer': {
            // Waddling, the belly slopping from side to side.
            const s = sin(ph * 8.5), j = cos(ph * 17);
            T.leg = s * 0.55; T.rootZ = s * 0.16; T.bodyZ = -s * 0.08; T.bob = abs(cos(ph * 8.5)) * 0.04; T.bh = 1 + j * 0.05; T.bw = 1 - j * 0.03;
            T.aL = 0.3 - s * 0.3; T.aR = 0.3 + s * 0.3; T.aLz = -0.6; T.aRz = 0.6; T.lean = 0.1; T.headZ = -s * 0.12;
            break;
          }
          case 'brute': {
            // Stomping: every footfall lands with the whole weight, arms pumping like pistons.
            const s = sin(ph * 9.5), c = abs(cos(ph * 9.5));
            T.leg = s * 0.8; T.bob = c * 0.09; T.squash = 0.95 + c * 0.07; T.lean = 0.4; T.rootZ = s * 0.07; T.twist = s * 0.25;
            T.aL = 0.9 - s * 0.8; T.aR = 0.9 + s * 0.8; T.aLz = -0.35; T.aRz = 0.35; T.headX = -0.1; T.headZ = s * 0.06;
            break;
          }
          case 'charger': {
            // Lumbering, listing toward the big arm it drags along.
            const s = sin(ph * 11);
            T.leg = s * 0.85; T.bob = abs(cos(ph * 11)) * 0.05; T.lean = 0.35; T.aR = 0.25 + s * 0.15; T.aRz = 0.2; T.aL = 1.0 - s * 0.7;
            T.rootZ = -0.07 + s * 0.05; T.headZ = -0.1; T.twist = s * 0.12;
            break;
          }
          case 'drooler': {
            // Shuffling, arms swinging loose, head rolling.
            const s = sin(ph * 10);
            T.leg = s * 0.5; T.bob = abs(cos(ph * 10)) * 0.03; T.lean = 0.05; T.aL = 0.2 - s * 0.4; T.aR = 0.2 + s * 0.4; T.headX = 0.2; T.headZ = sin(ph * 5) * 0.3;
            T.bodyZ = s * 0.1; T.rootZ = s * 0.05;
            break;
          }
          case 'alarm': {
            // Scurrying on tiptoe with the clock clutched tight, glancing back.
            const s = sin(ph * 19);
            T.leg = s * 0.6; T.bob = abs(cos(ph * 19)) * 0.035; T.lean = 0.3; T.aR = 1.15; T.aRz = -0.55; T.aL = 1.0; T.aLz = 0.5; T.headY = sin(ph * 4) * 0.5; T.squash = 0.96;
            break;
          }
          case 'snatcher': {
            // Long loping strides, arms swinging wide against the legs.
            const s = sin(ph * 10.5);
            T.leg = s * 1.15; T.bob = abs(cos(ph * 10.5)) * 0.06; T.lean = 0.12; T.aL = 0.2 - s * 0.9; T.aR = 0.2 + s * 0.9; T.twist = s * 0.22; T.headZ = s * 0.1; T.bodyZ = s * 0.04;
            break;
          }
          case 'piggyback': {
            // Skipping, arms flailing overhead.
            const s = sin(ph * 17), c = abs(cos(ph * 17));
            T.leg = s; T.bob = c * 0.1; T.squash = 1 + c * 0.05; T.aL = 2.5 + s * 0.4; T.aR = 2.5 - s * 0.4; T.aLz = -0.4; T.aRz = 0.4; T.headZ = s * 0.25; T.lean = 0.2;
            break;
          }
          case 'weeper': {
            // Flat-out and furious: head thrashing, claws raking the air.
            const s = sin(ph * 20);
            T.leg = s * 1.2; T.bob = abs(cos(ph * 20)) * 0.06; T.lean = 0.7; T.aL = 1.7 + s * 0.9; T.aR = 1.7 - s * 0.9; T.aLz = -0.5; T.aRz = 0.5;
            T.headZ = sin(ph * 27) * 0.2; T.headX = 0.2; T.twist = s * 0.3;
            break;
          }
          default: {
            // Commons shamble, each in its own way (see `style`); the shoulders roll with every step.
            const s = sin(ph * 13);
            T.leg = s * 0.95; T.bob = abs(cos(ph * 13)) * 0.05; T.lean = 0.28; T.twist = s * 0.18; T.bodyZ = s * 0.06;
            T.headZ = this.loll + sin(ph * 6.5) * 0.16; T.headX = -0.05 + sin(ph * 26) * 0.04; T.headY = -T.twist * 0.5;
            T.aL = 1.35 + sin(ph * 9) * 0.22; T.aR = 1.45 + cos(ph * 8) * 0.22;
            if (style === 1) { T.aR = 0.2 + s * 0.3; T.aRz = 0.2; T.limp = 0.55; T.rootZ = s * 0.06; } // one arm hanging, dragging a foot
            else if (style === 2) { T.lean = 0.42; T.aL = 0.9 + s * 0.35; T.aR = 0.9 - s * 0.35; T.aLz = -0.25; T.aRz = 0.25; T.headZ += 0.2; } // hunched, reaching low
            if (kind === 'tinpot') { T.leg = s * 0.7; T.twist = 0; T.rootZ = s * 0.09; T.lean = 0.15; T.aL = 1.9 + s * 0.3; T.aR = 1.2; T.aRz = 0; T.limp = 0; } // a stiff, clanking march, spoon aloft
          }
        }
        break;
      }
      case 'aim':
        T.aL = 1.25; T.aR = 1.4; T.aLz = 0.45; T.aRz = -0.1;
        T.bob = sin(ph * 2.2) * 0.01; T.bh = 1 + sin(ph * 2.2) * 0.015;
        break;
      case 'attack': {
        const s = sin(ph * 16);
        switch (kind) {
          case 'brute': {
            // Both fists hauled overhead and brought down together.
            const b = sin(ph * 7.5), up = pos(b), dn = pos(-b);
            T.aL = T.aR = 1.3 + up * 1.6 - dn * 0.7; T.aLz = -0.2; T.aRz = 0.2; T.lean = -0.1 * up + 0.6 * dn; T.squash = 1 + up * 0.05 - dn * 0.1; T.bob = up * 0.04; T.headX = up * 0.3 - dn * 0.3;
            break;
          }
          case 'leaper': {
            // A blur of raking claws from a crouch.
            const r = sin(ph * 22);
            T.aL = 1.3 + r * 0.9; T.aR = 1.3 - r * 0.9; T.lean = 0.55; T.squash = 0.92; T.headZ = r * 0.15; T.twist = r * 0.3; T.legZ = 0.2;
            break;
          }
          case 'charger': {
            // A backhand swat with the big arm, the body turning into it.
            const b = sin(ph * 9);
            T.aR = 1.3 + b * 0.4; T.aRz = b * 1.1; T.twist = -b * 0.5; T.aL = 0.4; T.lean = 0.3; T.headZ = b * 0.1;
            break;
          }
          case 'drooler':
            // A feeble one-handed slap.
            T.aR = 1.2 + sin(ph * 10) * 0.7; T.aL = 0.2; T.headX = 0.2; T.lean = 0.1; T.headZ = sin(ph * 5) * 0.2;
            break;
          case 'piggyback': {
            // Hopping up to scratch and bite.
            const r = sin(ph * 24);
            T.aL = 1.6 + r * 0.8; T.aR = 1.6 - r * 0.8; T.bob = abs(sin(ph * 12)) * 0.07; T.lean = 0.3; T.headX = -abs(r) * 0.2; T.headZ = r * 0.15;
            break;
          }
          case 'weeper': {
            // Wide, wild slashes with the whole body behind them.
            const r = sin(ph * 18);
            T.aL = 1.6 + r * 1.1; T.aR = 1.6 - r * 1.1; T.aLz = -0.6; T.aRz = 0.6; T.twist = r * 0.5; T.lean = 0.5; T.headZ = sin(ph * 31) * 0.2; T.bob = abs(r) * 0.03;
            break;
          }
          case 'tinpot': {
            // Headbutts with the pot while the spoon comes down.
            const b = pos(sin(ph * 10));
            T.lean = 0.25 + b * 0.5; T.headX = -b * 0.4; T.aL = 1.9 - b * 1.2; T.aR = 0.6; T.bob = b * 0.03; T.squash = 1 - b * 0.05;
            break;
          }
          default:
            // Claws swiping left, right, left; the shoulders turn into each swipe and the head lunges to bite.
            T.aL = 1.2 + s * 0.9; T.aR = 1.2 - s * 0.9; T.lean = 0.35; T.headZ = s * 0.12; T.bob = abs(s) * 0.03;
            if (z) { T.twist = s * 0.3; T.headX = -0.1 + abs(s) * 0.15; }
        }
        break;
      }
      case 'stagger':
        T.lean = -0.55; T.aL = T.aR = -0.6; T.aLz = -0.9; T.aRz = 0.9; T.headZ = sin(ph * 20) * 0.2;
        T.leg = sin(ph * 18) * 0.4;
        // Reeling: head thrown back, shoulders wrenched round, knees buckling outward.
        if (z) { T.headX = 0.35; T.twist = sin(ph * 9) * 0.4; T.bodyZ = sin(ph * 20) * 0.1; T.legZ = 0.15; }
        break;
      case 'sit':
        // The Weeper: knees up, face in her hands, rocking, shoulders shaking with every sob.
        T.rootY = -0.2; T.lean = 0.75 + sin(ph * 1.4) * 0.08; T.aL = T.aR = 2.15 + sin(ph * 9) * 0.05; T.aLz = 0.45; T.aRz = -0.45;
        T.headZ = sin(ph * 2.1) * 0.07; T.headX = -0.2; T.bob = abs(sin(ph * 4.4)) * 0.018; T.squash = 0.9; T.bh = 1 + abs(sin(ph * 4.4)) * 0.04; T.legZ = 0.1;
        break;
      case 'swing': {
        // Bat: both hands on it, a flat sweep across the body with the shoulders turning.
        const s = sin(ph * 13);
        T.aR = 1.45; T.aL = 1.35; T.aRz = -0.2 + s * 0.95; T.aLz = 0.5 + s * 0.8; T.lean = 0.2; T.rootZ = -s * 0.1; T.headZ = s * 0.08;
        break;
      }
      case 'slash': {
        // Shears: quick one-handed cuts, up to one side and down to the other.
        const s = sin(ph * 21);
        T.aR = 1.5 + s * 1.0; T.aRz = -0.3 + cos(ph * 21) * 0.7; T.aL = 0.5; T.aLz = 0.35; T.lean = 0.3;
        break;
      }
      case 'chop': {
        // Axe: both arms hauled overhead, then slammed down with the whole body.
        const s = sin(ph * 9.5), up = pos(s), dn = pos(-s);
        T.aL = T.aR = 1.4 + up * 1.5 - dn * 0.6; T.aLz = 0.25; T.aRz = -0.25; T.lean = -0.15 * up + 0.6 * dn; T.squash = 1 + up * 0.06 - dn * 0.1; T.bob = up * 0.03;
        break;
      }
      case 'windup':
        if (kind === 'weeper') {
          // Stirring: half risen, hands off her face, trembling. Back away.
          T.rootY = -0.08; T.lean = 0.4; T.aL = T.aR = 0.9; T.aLz = -0.7; T.aRz = 0.7; T.headZ = sin(ph * 26) * 0.16; T.rootZ = sin(ph * 33) * 0.035; T.squash = 0.96;
          T.headX = 0.15; T.headY = sin(ph * 3) * 0.3; T.bh = 1 + sin(ph * 14) * 0.04;
        } else if (kind === 'snatcher') {
          // Whirling the scarf overhead.
          T.aR = 2.9; T.aRz = sin(ph * 20) * 0.7; T.aL = 0.4; T.aLz = -0.4; T.lean = -0.2; T.rootZ = sin(ph * 20) * 0.05; T.headZ = cos(ph * 20) * 0.1;
          T.twist = cos(ph * 20) * 0.2; T.headX = 0.2;
        } else if (kind === 'charger') {
          // Head down, big arm cocked back, one foot scraping the ground.
          T.lean = 0.95; T.squash = 0.86; T.aL = -0.4; T.aR = -1.1; T.aRz = 0.35; T.leg = sin(ph * 16) * 0.7; T.limp = 1; T.headZ = sin(ph * 9) * 0.08;
          T.rootX = 0.08; T.rootZ = sin(ph * 30) * 0.03; T.headX = -0.45; T.bh = 1 + sin(ph * 8) * 0.05;
        } else if (kind === 'drooler') {
          // Rears back, cheeks swelling, arms flung out.
          T.lean = -0.45; T.squash = 1.1; T.aL = T.aR = 0.6; T.aLz = -1.1; T.aRz = 1.1; T.headZ = sin(ph * 12) * 0.06;
          T.headX = 0.45; T.hs = 1.1 + sin(ph * 12) * 0.03;
        } else {
          // Coiled to spring, hindquarters wiggling like a cat's.
          T.squash = 0.72; T.lean = 0.5; T.aL = T.aR = -0.9; T.aLz = -0.5; T.aRz = 0.5;
          T.rootZ = sin(ph * 24) * 0.05; T.twist = sin(ph * 24) * 0.15; T.legZ = 0.3; T.headX = 0.3;
        }
        break;
      case 'charge': {
        const s = sin(ph * 22);
        T.lean = 1.05; T.leg = s * 1.1; T.bob = abs(cos(ph * 22)) * 0.07; T.aL = -0.6 + s * 0.3; T.aR = 1.5; T.aRz = -0.3; T.rootX = 0.15;
        T.headX = -0.4; T.twist = s * 0.12; T.rootZ = s * 0.04;
        break;
      }
      case 'pin': {
        const s = sin(ph * 11);
        if (kind === 'snatcher') {
          // Hauling the scarf in hand over hand, leaning back against the weight.
          T.lean = -0.4; T.aL = 1.5 + s * 0.5; T.aR = 1.5 - s * 0.5; T.headZ = s * 0.06; T.legB = 0.25; T.twist = s * 0.25; T.legZ = 0.2;
        } else if (kind === 'piggyback') {
          // Clinging on: arms hugged down round the victim's head, legs splayed, bouncing with glee.
          T.lean = 0.5; T.aL = T.aR = 0.9; T.aLz = 0.5; T.aRz = -0.5; T.legB = 1.0 + s * 0.15; T.legZ = 0.55; T.headZ = sin(ph * 15) * 0.25; T.bob = abs(s) * 0.04;
        } else {
          // Pounding with the big arm, the whole body dropping into each blow.
          T.lean = 0.55; T.aR = 1.7 + s * 1.0; T.aL = 0.5; T.headZ = s * 0.1; T.bob = pos(-s) * 0.05;
          T.squash = 1 - pos(-s) * 0.08; T.twist = -s * 0.25; T.headX = -0.2;
        }
        break;
      }
      case 'ring':
        // Clock held high and rattling, the whole body wobbling with it, feet drumming.
        T.aR = 2.85 + sin(ph * 42) * 0.18; T.aRz = 0.15; T.aL = 1.3 + sin(ph * 17) * 0.4; T.aLz = -0.4;
        T.headZ = sin(ph * 31) * 0.28; T.rootZ = sin(ph * 24) * 0.13; T.bob = abs(sin(ph * 24)) * 0.05; T.squash = 1.04;
        T.leg = sin(ph * 24) * 0.3; T.hs = 1 + abs(sin(ph * 24)) * 0.05; T.headX = 0.2;
        break;
      case 'leap':
        T.lean = 1.15; T.aL = T.aR = 2.6; T.rootX = -0.9; T.rootY = 0.45; T.squash = 1.12;
        // In the air: a Piggyback spread-eagled, anything else arrow-straight with its claws out front.
        if (kind === 'piggyback') { T.aLz = -0.9; T.aRz = 0.9; T.legZ = 0.6; T.legB = -0.4; T.headX = 0.3; }
        else { T.aLz = -0.3; T.aRz = 0.3; T.legB = -0.7; T.headX = 0.4; }
        break;
      case 'down':
        T.rootX = -Math.PI / 2; T.rootY = 0.22; T.aL = 2.6 + sin(ph * 3) * 0.2; T.aR = 0.4; T.headZ = sin(ph * 2) * 0.1;
        break;
    }
    const k = Math.min(1, dt * 14), p = this.p, tg = T as Target & { legL: number; legR: number };
    tg.legL = T.leg + T.legB; tg.legR = -T.leg * (1 - T.limp) + T.legB;
    for (const key of EASED) p[key] += (tg[key] - p[key]) * k;
    this.punch = Math.max(0, this.punch - dt * 6);
    const pu = this.punch * 0.22;
    setRot(this.root, p.rootX, 0, p.rootZ);
    this.root.setLocalPosition(0, p.rootY, 0);
    this.root.setLocalScale(1 + pu, p.squash - pu * 0.5, 1 + pu);
    this.place(T.bob);
  }

  /** Pose the parts from the eased values (`bob`: step bounce) and hand them to the shader. */
  private place(bob: number): void {
    const p = this.p, ct = Math.cos(p.twist), st = Math.sin(p.twist), ax = this.armX;
    setRot(this.legL, p.legL, 0, -p.legZ); setRot(this.legR, p.legR, 0, p.legZ);
    // The shoulders ride the torso: round with its twist, forward with its lean, up and down with the step.
    setRot(this.armL, p.aL, 0, p.aLz); setRot(this.armR, p.aR, 0, p.aRz);
    this.armL.setLocalPosition(-ax * ct, 0.72 + bob, ax * st - p.lean * 0.05);
    this.armR.setLocalPosition(ax * ct, 0.72 + bob, -ax * st - p.lean * 0.05);
    setRot(this.head, p.headX, p.headY, p.headZ);
    this.head.setLocalPosition(0, this.headBaseY + bob * 1.4, -p.lean * 0.16);
    const hs = this.headS * p.hs;
    this.head.setLocalScale(hs, hs, hs);
    setRot(this.body, -p.lean * 0.6, p.twist, p.bodyZ);
    this.body.setLocalPosition(0, this.bodyBaseY + bob, 0);
    this.body.setLocalScale(p.bw, p.bh, p.bw);
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

  /**
   * Death tumble, driven directly by the corpse animation: pitched back by `rx` at height `y`, `k` = 0..1 through it.
   * The limbs fly out and the head snaps back, and it swells a little just before it pops. `dt`: frame delta.
   */
  tumble(rx: number, y: number, k = 0, dt = 1 / 60): void {
    const p = this.p, e = Math.min(1, dt * 18);
    const to = (key: (typeof EASED)[number], v: number) => { p[key] += (v - p[key]) * e; };
    to('aL', 2.7); to('aR', 2.2); to('aLz', -0.9); to('aRz', 0.9); to('legL', 0.7); to('legR', -0.4); to('legZ', 0.45);
    to('headX', 0.5); to('headY', 0); to('twist', 0); to('bodyZ', 0); to('lean', -0.3); to('bw', 1); to('bh', 1); to('hs', 1);
    p.rootX = rx; p.rootY = y; p.rootZ = 0;
    const s = 1 + pos(k - 0.55) * 0.5;
    setRot(this.root, rx, 0, 0); this.root.setLocalPosition(0, y, 0); this.root.setLocalScale(s, s, s);
    this.place(0);
  }

  /**
   * Whether the camera drew this one last frame (frustum culling sets it; for the horde's, its own copy of
   * that test). A part-hidden or disabled chibi keeps a stale value, so callers only trust it while the
   * chibi stays shown.
   */
  get onScreen(): boolean { return this.draws ? this.draws[0].visibleThisFrame : this.drawn; }

  /** Back to a fresh standing pose, for reuse from a pool after a death tumble. */
  reset(): void {
    Object.assign(this.p, EASED_REST);
    this.punch = 0;
    this.root.setLocalEulerAngles(0, 0, 0); this.root.setLocalPosition(0, 0, 0); this.root.setLocalScale(1, 1, 1);
    this.place(0);
  }

  dispose(): void { horde?.remove(this); this.group.destroy(); }
}

export function survivorLook(i: number): ChibiLook {
  const s = SURVIVORS[i % SURVIVORS.length];
  return { skin: 0xffdcc2, shirt: s.shirt, pants: 0x3d4a7a, hair: s.hair, style: s.style };
}

const WALKER_LOOKS: ChibiLook[] = [
  { skin: 0x9ccf7a, shirt: 0x6d7fb3, pants: 0x4a4466, hair: 0x4a3b33, style: 'mess', zombie: 'walker', extra: 'teddy' },
  { skin: 0x86c79a, shirt: 0xc97b84, pants: 0x3e4a5c, hair: 0x2f2a3a, style: 'bald', zombie: 'walker', extra: 'bandage' },
  { skin: 0xb0cf78, shirt: 0xe0c070, pants: 0x5a4a52, hair: 0x7a4a3a, style: 'bob', zombie: 'walker', extra: 'bow' },
  { skin: 0x7fbf8f, shirt: 0xe8e4f0, pants: 0x394a6a, hair: 0x5a5a6a, style: 'cap', zombie: 'walker', extra: 'badge' },
  { skin: 0xa4d68a, shirt: 0x8f6fb5, pants: 0x4a3f5f, hair: 0xc9a25a, style: 'mess', zombie: 'walker', extra: 'phones' },
  { skin: 0x8fc4a8, shirt: 0x5fa8a0, pants: 0x4f4a4a, hair: 0x3a2f2f, style: 'bob', zombie: 'walker', extra: 'specs' },
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
