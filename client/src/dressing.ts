// Set dressing: deterministic, purely decorative clutter scattered over a
// chapter (street furniture, ward trolleys, mall kiosks, yard junk, forest
// floor, wall posters and scribbles). Nothing here collides or blocks sight:
// `solid`/`opaque` are never touched. Everything is written straight into the
// per-chunk prop batches, so it costs no extra draw calls.
import { TILE, CEIL_H } from '../../shared/constants';
import { F, WALL, isIndoor, hash2 } from '../../shared/level';
import { type Geo, box, sphere, cylinder } from './geo';
import { type Batch, rgb, type V3 } from './gfx';
import { type Ctx, CHUNK, newGeo, quad } from './worldkit';
import type { GlowSpot } from './atmo';

const T = TILE, HP = Math.PI / 2;
/** Overall amount of clutter. 1 = shipped look; lower it to thin every kit at once. */
const DENSITY = 1;

export interface DressStats { items: number; wall: number; scatter: number; tris: number; trisItems: number; trisScatter: number; trisWall: number; ms: number }

// ------------------------------------------------------------- primitives
interface Tpl { g: Geo; ex: number; ey: number; ez: number }
const tpl = (g: Geo, ex: number, ey: number, ez: number): Tpl => ({ g, ex, ey, ez });
const BOX = tpl(box(), 0.5, 0.5, 0.5), CYL = tpl(cylinder(7), 1, 0.5, 1), TAPER = tpl(cylinder(7, 1, 0.72), 1, 0.5, 1);
const CONE = tpl(cylinder(7, 0, 1), 1, 0.5, 1), BALL = tpl(sphere(6, 3), 1, 1, 1), DOME = tpl(sphere(7, 2, HP), 1, 1, 1);
// Cheaper versions for thin poles and pebble-sized blobs.
const CYL_S = tpl(cylinder(5), 1, 0.5, 1), BALL_S = tpl(sphere(5, 2), 1, 1, 1);
/** A grass blade: three flat-shaded sides rising to a point, no base (it stands on the ground). */
const BLADE = ((): Tpl => {
  const g = newGeo(), p = [[1, 0, 0], [-0.5, 0, 0.87], [-0.5, 0, -0.87]];
  for (let i = 0; i < 3; i++) {
    const a = p[i], b = p[(i + 1) % 3], nx = (a[0] + b[0]) / 2, nz = (a[2] + b[2]) / 2, l = Math.hypot(nx, 0.25, nz);
    g.pos.push(b[0], 0, b[2], a[0], 0, a[2], 0, 1, 0);
    for (let k = 0; k < 3; k++) g.nor.push(nx / l, 0.25 / l, nz / l);
    g.idx.push(i * 3, i * 3 + 1, i * 3 + 2);
  }
  return tpl(g, 1, 0.5, 1);
})();

// Hint districts read from the chapter's floor labels.
const HINT = { NONE: 0, ARCADE: 1, TOYS: 2, GIFT: 3, FOOD: 4, SCHOOL: 5, BOOKS: 6, OFFICE: 7, PARKING: 8, LAUNDRY: 9 } as const;
const HINTS: [RegExp, number, number][] = [
  [/PARKING|RAMP UP|PAY STATION|PARK & RIDE|AMBULANCE|BUS LOOP|FUEL POINT/, HINT.PARKING, 11],
  [/OFFICE|YARDMASTER|SECURITY|DESK|CONTROL|TICKETS|INFORMATION|RANGER/, HINT.OFFICE, 6],
  [/LIBRARY|SHHH|RECORDS|CLASS /, HINT.BOOKS, 8],
  [/FOOD COURT|NOODLE|TACO|BUBBLE TEA|PRETZEL|SUSHI|PIZZA|DINER|SOUP|BREAK ROOM|MART|TAKE A PIE/, HINT.FOOD, 7],
  [/GYM|ELEMENTARY|ASSEMBLY|SWINGS|JUNGLE/, HINT.SCHOOL, 8],
  [/LAUNDR|SUDS|LINEN/, HINT.LAUNDRY, 6],
  [/GIFT|GET WELL/, HINT.GIFT, 5],
  [/TOYS|PLUSH/, HINT.TOYS, 7],
  [/ARCADE|INSERT COIN/, HINT.ARCADE, 7],
];

const PASTEL = [0xff8fa3, 0x74c0fc, 0xffd43b, 0x8ce99a, 0xb197fc, 0xffa94d, 0x66d9e8, 0xf783ac];
const DARK = 0x2b2540, STEEL = 0x8f93a8, CREAM = 0xfff1e0, WOODC = 0xb5894f, PAPER = 0xfffaf0;

export function buildDressing(ctx: Ctx, batchFor: (x: number, z: number) => Batch, glows: Geo[], glowSpots: GlowSpot[]): DressStats {
  const t0 = performance.now();
  const { def, W, H, floorOf } = ctx;
  const chap = Number(def.id.replace(/\D/g, '')) || 1;
  const stats: DressStats = { items: 0, wall: 0, scatter: 0, tris: 0, trisItems: 0, trisScatter: 0, trisWall: 0, ms: 0 };
  let triCount = 0; // running total, for the per-category split in `stats`

  // ---------------------------------------------------------------- emitter
  const chunkGeo = new Map<number, { s: Geo; h: Geo; x: number; z: number }>();
  let S: Geo = newGeo(), HULL: Geo = newGeo();
  const glow = newGeo();
  let ox = 0, oy = 0, oz = 0, ca = 1, sa = 0, seedA = 0, seedB = 0;
  /** Start an item at world metres (x, z), rotated `yaw` about Y (local +Z maps to (sin yaw, cos yaw)). */
  const begin = (x: number, z: number, yaw: number, y = 0): void => {
    const cx = Math.floor(x / (CHUNK * T)), cz = Math.floor(z / (CHUNK * T)), k = cz * 1000 + cx;
    let c = chunkGeo.get(k);
    if (!c) { c = { s: newGeo(), h: newGeo(), x, z }; chunkGeo.set(k, c); }
    S = c.s; HULL = c.h; ox = x; oy = y; oz = z; ca = Math.cos(yaw); sa = Math.sin(yaw);
    seedA = Math.round(x * 37) + 11; seedB = Math.round(z * 53) + 5;
  };
  /** The item's own random numbers. */
  const R = (k: number): number => hash2(seedA + k * 131, seedB + k * 71);
  const pick = <V>(r: number, a: readonly V[]): V => a[Math.min(a.length - 1, Math.floor(r * a.length))];

  /** One primitive in item space. `o`: 0 = no ink, 1 = box hull, 2 = smooth hull. */
  function prim(tp: Tpl, color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, o = 1, rx = 0, ry = 0, rz = 0, into: Geo = S): void {
    let m00 = 1, m01 = 0, m02 = 0, m10 = 0, m11 = 1, m12 = 0, m20 = 0, m21 = 0, m22 = 1;
    if (rx || ry || rz) {
      const cx = Math.cos(rx), sxx = Math.sin(rx), cy = Math.cos(ry), syy = Math.sin(ry), cz = Math.cos(rz), szz = Math.sin(rz);
      m00 = cy * cz; m01 = -cy * szz; m02 = syy;
      m10 = cx * szz + sxx * syy * cz; m11 = cx * cz - sxx * syy * szz; m12 = -sxx * cy;
      m20 = sxx * szz - cx * syy * cz; m21 = sxx * cz + cx * syy * szz; m22 = cx * cy;
    }
    const a00 = ca * m00 + sa * m20, a01 = ca * m01 + sa * m21, a02 = ca * m02 + sa * m22;
    const a20 = -sa * m00 + ca * m20, a21 = -sa * m01 + ca * m21, a22 = -sa * m02 + ca * m22;
    const tx = ox + ca * x + sa * z, ty = oy + y, tz = oz - sa * x + ca * z;
    const P = tp.g.pos, N = tp.g.nor, I = tp.g.idx, n = P.length / 3, base = into.pos.length / 3;
    const cr = ((color >> 16) & 255) / 255, cg = ((color >> 8) & 255) / 255, cb = (color & 255) / 255;
    const hull = o && into === S ? HULL : null, hb = hull ? hull.pos.length / 3 : 0;
    const t = Math.max(0.007, Math.min(0.02, Math.min(sx * tp.ex, sy * tp.ey, sz * tp.ez) * 0.22));
    const kx = 1 + t / (sx * tp.ex), ky = 1 + t / (sy * tp.ey), kz = 1 + t / (sz * tp.ez);
    for (let i = 0; i < n; i++) {
      const px = P[i * 3] * sx, py = P[i * 3 + 1] * sy, pz = P[i * 3 + 2] * sz;
      const wx = a00 * px + a01 * py + a02 * pz + tx, wy = m10 * px + m11 * py + m12 * pz + ty, wz = a20 * px + a21 * py + a22 * pz + tz;
      const qx = N[i * 3] / sx, qy = N[i * 3 + 1] / sy, qz = N[i * 3 + 2] / sz;
      let nx = a00 * qx + a01 * qy + a02 * qz, ny = m10 * qx + m11 * qy + m12 * qz, nz = a20 * qx + a21 * qy + a22 * qz;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      into.pos.push(wx, wy, wz); into.nor.push(nx, ny, nz); into.col.push(cr, cg, cb);
      if (hull) {
        if (o === 1) {
          const hx = px * kx, hy = py * ky, hz = pz * kz;
          hull.pos.push(a00 * hx + a01 * hy + a02 * hz + tx, m10 * hx + m11 * hy + m12 * hz + ty, a20 * hx + a21 * hy + a22 * hz + tz);
        } else hull.pos.push(wx + nx * t, wy + ny * t, wz + nz * t);
        hull.nor.push(nx, ny, nz);
      }
    }
    for (let i = 0; i < I.length; i++) into.idx.push(base + I[i]);
    triCount += (I.length / 3) * (hull ? 2 : 1);
    if (hull) for (let i = 0; i < I.length; i++) hull.idx.push(hb + I[i]);
  }
  // Shorthands. All take the centre of the primitive except D (dome), which takes its base.
  const B = (c: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, o = 1, rx = 0, ry = 0, rz = 0) => prim(BOX, c, x, y, z, sx, sy, sz, o, rx, ry, rz);
  const C = (c: number, x: number, y: number, z: number, r: number, h: number, o = 2, rx = 0, rz = 0) => prim(r < 0.09 ? CYL_S : CYL, c, x, y, z, r, h, r, o, rx, 0, rz);
  const TP = (c: number, x: number, y: number, z: number, r: number, h: number, o = 2) => prim(TAPER, c, x, y, z, r, h, r, o);
  const K = (c: number, x: number, y: number, z: number, r: number, h: number, o = 2, rx = 0, rz = 0) => prim(CONE, c, x, y, z, r, h, r, o, rx, 0, rz);
  const SP = (c: number, x: number, y: number, z: number, sx: number, sy = sx, sz = sx, o = 2) => prim(sx < 0.12 ? BALL_S : BALL, c, x, y, z, sx, sy, sz, o);
  const D = (c: number, x: number, y: number, z: number, sx: number, sy = sx, sz = sx, o = 2) => prim(DOME, c, x, y, z, sx, sy, sz, o);
  const G = (c: number, x: number, z: number, r: number, h: number, rx = 0, rz = 0) => prim(BLADE, c, x, 0, z, r, h, r, 0, rx, 0, rz);
  /** Unlit, unfogged bright bit (screens, flames). */
  const GL = (c: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0) => prim(BOX, c, x, y, z, sx, sy, sz, 0, rx, 0, 0, glow);
  /** Flat sheet on the ground (paper, leaf, card), optionally with an ink rim. */
  function sheet(c: number, x: number, z: number, w: number, d: number, rot: number, rim = true, y = 0.03): void {
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const put = (col: V3, hw: number, hd: number, yy: number) => {
      const p: number[] = [];
      for (const [u, v] of [[-hw, -hd], [-hw, hd], [hw, hd], [hw, -hd]]) {
        const lx = x + u * cr + v * sr, lz = z - u * sr + v * cr;
        p.push(ox + ca * lx + sa * lz, oy + yy, oz - sa * lx + ca * lz);
      }
      quad(S, col, [0, 1, 0], p);
    };
    if (rim) put(rgb(0x1a1226), w / 2 + 0.018, d / 2 + 0.018, y - 0.013);
    triCount += rim ? 4 : 2;
    put(rgb(c), w / 2, d / 2, y);
  }

  // ------------------------------------------------------------------ items
  interface Item { d: number; h: number; f: (r: number) => void }
  const it = (d: number, h: number, f: (r: number) => void): Item => ({ d, h, f });

  // ---- street
  const hydrant = it(0.42, 0.75, (r) => {
    const c = r < 0.6 ? 0xe8413c : 0xffc94a;
    C(c, 0, 0.29, 0, 0.14, 0.58); D(c, 0, 0.56, 0, 0.15, 0.13, 0.15, 0);
    C(c, 0, 0.36, 0, 0.065, 0.44, 0, 0, HP); B(0xe8e6f2, 0, 0.72, 0, 0.07, 0.07, 0.07, 0);
  });
  const bollard = it(0.3, 0.92, () => { C(0x3a3654, 0, 0.42, 0, 0.1, 0.84); D(0x3a3654, 0, 0.84, 0, 0.1, 0.07, 0.1, 0); C(0xffd43b, 0, 0.6, 0, 0.106, 0.12, 0); });
  const bin = it(0.62, 0.95, (r) => {
    TP(pick(r, [0x3f9f7b, 0x5a6ea8, 0x8f6fb0]), 0, 0.42, 0, 0.27, 0.84); C(DARK, 0, 0.87, 0, 0.29, 0.07, 0);
    if (R(1) < 0.4) { SP(0x3b3558, 0.44, 0.2, 0.04, 0.25, 0.21, 0.23); B(0x3b3558, 0.44, 0.42, 0.04, 0.08, 0.08, 0.08, 0); }
    else { SP(CREAM, 0.05, 0.92, 0, 0.15, 0.08, 0.13, 0); B(0xff8fa3, -0.08, 0.95, 0.05, 0.12, 0.07, 0.1, 0, 0.3, 0.5); }
  });
  const bags = it(0.6, 0.5, (r) => {
    SP(0x3b3558, -0.2, 0.22, 0, 0.28, 0.23, 0.25); SP(0x4a4470, 0.25, 0.18, 0.06, 0.24, 0.19, 0.22);
    B(0x3b3558, -0.2, 0.46, 0, 0.08, 0.08, 0.08, 0); if (r < 0.3) SP(0x3b3558, 0.02, 0.5, -0.02, 0.2, 0.17, 0.19, 0);
  });
  const newsbox = it(0.45, 1.05, (r) => {
    const c = pick(r, [0x3f7cc4, 0xe8413c, 0xffc94a, 0x4fa36a]);
    B(c, 0, 0.6, 0, 0.46, 0.8, 0.4); B(DARK, 0, 0.1, 0, 0.36, 0.2, 0.3, 0); B(0xbfe6ff, 0, 0.72, 0.205, 0.34, 0.34, 0.02, 0);
    B(PAPER, 0, 0.66, 0.21, 0.24, 0.16, 0.02, 0); B(CREAM, 0, 1.03, 0, 0.4, 0.06, 0.3, 0);
  });
  const cone = it(0.36, 0.55, (r) => {
    const tip = r < 0.18;
    B(0xff8a3c, 0, 0.025, 0, 0.34, 0.05, 0.34);
    if (tip) { K(0xff8a3c, 0.3, 0.14, 0.1, 0.13, 0.5, 2, 0, -HP * 1.05); }
    else { K(0xff8a3c, 0, 0.3, 0, 0.13, 0.5); C(PAPER, 0, 0.3, 0, 0.075, 0.09, 0); }
  });
  const meter = it(0.26, 1.3, (r) => {
    C(0x54506e, 0, 0.5, 0, 0.035, 1.0); B(0x6f7f9a, 0, 1.13, 0, 0.17, 0.28, 0.13); D(0x6f7f9a, 0, 1.27, 0, 0.085, 0.07, 0.065, 0);
    B(r < 0.5 ? 0xff4d5e : 0x8ce99a, 0, 1.17, 0.07, 0.1, 0.07, 0.01, 0);
  });
  const sign = it(0.2, 2.5, (r) => {
    C(0x54506e, 0, 1.2, 0, 0.03, 2.4);
    if (r < 0.35) { B(0xffd43b, 0, 2.15, 0.03, 0.44, 0.44, 0.03, 1, 0, 0, Math.PI / 4); B(DARK, 0, 2.15, 0.05, 0.05, 0.2, 0.01, 0); }
    else if (r < 0.7) { C(0xe8413c, 0, 2.15, 0.03, 0.24, 0.03, 2, HP); B(PAPER, 0, 2.15, 0.05, 0.3, 0.07, 0.01, 0); }
    else { B(0x3f7cc4, 0, 2.15, 0.03, 0.42, 0.52, 0.03); B(PAPER, 0, 2.2, 0.05, 0.14, 0.26, 0.01, 0); B(PAPER, 0, 2.0, 0.05, 0.26, 0.05, 0.01, 0); }
  });
  const bike = it(0.34, 1.0, (r) => {
    const c = pick(r, PASTEL), lean = 0.16;
    B(STEEL, -0.75, 0.42, -0.02, 0.05, 0.84, 0.05, 0); // rack post
    for (const s of [-1, 1]) C(DARK, s * 0.48, 0.33, 0, 0.33, 0.045, 2, HP + lean);
    B(c, -0.14, 0.56, -0.04, 0.72, 0.06, 0.05, 0, 0, 0, 0.62); B(c, 0.2, 0.56, -0.04, 0.62, 0.06, 0.05, 0, 0, 0, -0.72);
    B(DARK, -0.36, 0.86, -0.08, 0.24, 0.06, 0.12, 0); B(DARK, 0.42, 0.94, -0.09, 0.06, 0.06, 0.46, 0);
  });
  const planter = it(0.55, 0.85, (r) => {
    B(r < 0.5 ? 0xa9a6ba : 0xb5894f, 0, 0.22, 0, 1.0, 0.44, 0.5); 
    SP(0x4f9f62, -0.2, 0.58, 0, 0.3, 0.22, 0.24); SP(0x5fbb72, 0.24, 0.55, 0.02, 0.26, 0.19, 0.22, 0);
    for (let i = 0; i < 3; i++) B(pick(R(i + 2), [0xff8fa3, 0xffd43b, 0xfff1e0]), -0.3 + i * 0.28, 0.76 - (i % 2) * 0.05, 0.08, 0.09, 0.09, 0.09, 0, 0.5, i);
  });
  const boxes = it(0.62, 0.8, (r) => {
    B(0xc8a06a, -0.2, 0.22, 0, 0.56, 0.44, 0.5, 1, 0, r * 0.4); B(0xfff1c9, -0.2, 0.445, 0, 0.1, 0.01, 0.5, 0, 0, r * 0.4);
    B(0xb98d57, 0.36, 0.15, 0.04, 0.4, 0.3, 0.38, 1, 0, -r); if (r < 0.6) B(0xd4ae78, -0.16, 0.6, 0, 0.4, 0.3, 0.36, 1, 0, r * 2);
  });
  const sawhorse = it(0.4, 0.95, () => {
    for (let i = 0; i < 4; i++) B(i % 2 ? PAPER : 0xff8a3c, -0.525 + i * 0.35, 0.78, 0, 0.35, 0.2, 0.05, 0);
    B(DARK, 0, 0.78, -0.01, 1.42, 0.22, 0.04);
    for (const s of [-1, 1]) for (const q of [-1, 1]) B(0x54506e, s * 0.55, 0.38, q * 0.13, 0.05, 0.78, 0.05, 0, q * 0.3);
  });
  const umbrella = it(0.8, 0.6, (r) => {
    const c = pick(r, [0xff7ac8, 0x5ff0e0, 0xffd45e, 0x9d8cff, 0xe8413c]);
    K(c, 0, 0.3, 0, 0.4, 0.26, 2, 0, 1.9); C(DARK, 0.2, 0.23, 0, 0.014, 0.66, 0, 0, 1.9); B(DARK, 0.5, 0.12, 0, 0.04, 0.1, 0.04, 0);
  });
  const cardboard = it(0.7, 0.1, (r) => { B(0xc8a06a, 0, 0.02, 0, 0.9, 0.035, 0.6, 1, 0, r * 3); B(0xb98d57, 0.1, 0.055, 0.05, 0.6, 0.03, 0.45, 0, 0, r * 5); });
  const scooter = it(0.3, 1.0, (r) => {
    const c = pick(r, PASTEL);
    B(c, 0, 0.12, 0, 0.7, 0.05, 0.14); for (const s of [-1, 1]) C(DARK, s * 0.36, 0.09, 0, 0.09, 0.05, 0, HP);
    C(STEEL, 0.34, 0.52, -0.05, 0.022, 0.86, 0, -0.12); B(DARK, 0.34, 0.95, -0.1, 0.05, 0.05, 0.4, 0);
  });
  const postbox = it(0.5, 1.15, () => {
    B(0x3f7cc4, 0, 0.6, 0, 0.5, 0.8, 0.45); C(0x3f7cc4, 0, 1.0, 0, 0.225, 0.5, 2, 0, HP); B(DARK, 0, 0.9, 0.23, 0.36, 0.05, 0.02, 0);
    B(PAPER, 0, 0.6, 0.23, 0.26, 0.16, 0.02, 0); for (const s of [-1, 1]) B(0x2b2540, s * 0.19, 0.1, 0, 0.07, 0.2, 0.36, 0);
  });
  const vending = it(0.72, 1.95, (r) => {
    const c = pick(r, [0xe8413c, 0x3f7cc4, 0x39c5bb, 0xff7ac8]);
    B(c, 0, 0.98, 0, 0.92, 1.92, 0.7); B(DARK, 0, 0.07, 0, 0.94, 0.14, 0.72, 0);
    GL(0xd8f6ff, -0.1, 1.25, 0.352, 0.56, 1.0, 0.01); B(DARK, 0.33, 1.2, 0.355, 0.1, 0.5, 0.01, 0); B(DARK, -0.1, 0.36, 0.355, 0.5, 0.16, 0.01, 0);
    for (let j = 0; j < 3; j++) B(pick(R(j), PASTEL), -0.1, 0.95 + j * 0.3, 0.36, 0.48, 0.14, 0.01, 0);
    glowSpots.push({ x: ox + sa * 0.5, y: 1.3, z: oz + ca * 0.5, size: 1.1, color: 0xbfeaff, k: 0.3 });
  });
  const aboard = it(0.5, 0.95, (r) => {
    const c = r < 0.5 ? 0x3a3654 : 0xffd43b;
    for (const s of [-1, 1]) B(c, 0, 0.45, s * 0.14, 0.55, 0.92, 0.04, 1, s * 0.3);
    B(r < 0.5 ? PAPER : DARK, 0, 0.62, 0.2, 0.36, 0.05, 0.01, 0, 0.3); B(r < 0.5 ? 0xff8fa3 : DARK, 0, 0.45, 0.25, 0.26, 0.05, 0.01, 0, 0.3);
  });
  const bottleCrate = it(0.5, 0.5, (r) => {
    B(pick(r, [0xe8413c, 0x3f7cc4, 0xffc94a]), 0, 0.16, 0, 0.6, 0.32, 0.44);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) if (R(i * 2 + j) < 0.6) C(i % 2 ? 0x4fa36a : 0x8a5a3c, -0.19 + i * 0.19, 0.36, -0.1 + j * 0.2, 0.05, 0.22, 0);
  });
  const wheelie = it(0.62, 1.1, (r) => {
    const c = pick(r, [0x4fa36a, 0x3f7cc4, 0x54506e]);
    B(c, 0, 0.5, 0, 0.55, 0.9, 0.56); B(c, 0, 0.99, 0.02, 0.6, 0.07, 0.64, 1, R(1) < 0.3 ? -0.5 : 0); for (const s of [-1, 1]) B(DARK, s * 0.28, 0.1, -0.2, 0.06, 0.2, 0.2, 0);
  });

  // ---- hospital
  const gurney = it(0.8, 0.95, (r) => {
    B(STEEL, 0, 0.56, 0, 1.75, 0.06, 0.66); B(0xe8e6f2, 0, 0.66, 0, 1.7, 0.14, 0.62); B(PAPER, -0.62, 0.77, 0, 0.36, 0.1, 0.44, 0);
    B(pick(r, [0x74c0fc, 0x8ce99a, 0xa5d8ff]), 0.3, 0.75, 0, 1.0, 0.05, 0.64, 0);
    for (const s of [-1, 1]) { B(STEEL, s * 0.7, 0.3, 0, 0.05, 0.5, 0.56, 0); B(DARK, s * 0.7, 0.05, 0, 0.1, 0.1, 0.6, 0); }
  });
  const wheelchair = it(0.62, 0.95, (r) => {
    const c = pick(r, [0x3b3a66, 0x39c5bb, 0xe8413c]);
    B(c, 0, 0.46, 0, 0.46, 0.06, 0.44); B(c, 0, 0.72, -0.2, 0.46, 0.46, 0.05);
    for (const s of [-1, 1]) C(DARK, s * 0.27, 0.3, -0.08, 0.3, 0.04, 2, 0, HP);
    B(STEEL, 0, 0.14, 0.3, 0.4, 0.03, 0.14, 0);
  });
  const ivStand = it(0.44, 1.75, (r) => {
    C(STEEL, 0, 0.03, 0, 0.2, 0.05, 0); C(STEEL, 0, 0.86, 0, 0.02, 1.66, 0); B(STEEL, 0, 1.68, 0, 0.3, 0.03, 0.03, 0);
    B(r < 0.5 ? 0xffc9d6 : 0xd8f6ff, 0.13, 1.48, 0, 0.13, 0.24, 0.06); if (r > 0.3) B(0xfff3bf, -0.13, 1.52, 0, 0.11, 0.18, 0.05);
  });
  const chair = it(0.5, 0.9, (r) => {
    const c = pick(r, [0x74c0fc, 0xffa94d, 0x8ce99a, 0xb197fc, 0xff8fa3]);
    B(c, 0, 0.45, 0, 0.46, 0.06, 0.44); B(c, 0, 0.72, -0.2, 0.46, 0.34, 0.05); for (const s of [-1, 1]) B(STEEL, s * 0.2, 0.22, 0, 0.04, 0.44, 0.4, 0);
  });
  const seatRow = it(0.55, 0.9, (r) => {
    const c = pick(r, [0x74c0fc, 0x39c5bb, 0xffa94d]);
    B(STEEL, 0, 0.36, 0, 1.7, 0.06, 0.08, 0); for (const s of [-1, 1]) B(STEEL, s * 0.7, 0.18, 0, 0.06, 0.36, 0.44, 0);
    B(c, 0, 0.44, 0.02, 1.66, 0.07, 0.44); for (let i = -1; i <= 1; i++) B(c, i * 0.56, 0.7, -0.2, 0.5, 0.36, 0.06);
  });
  const plant = it(0.5, 1.2, (r) => {
    TP(r < 0.5 ? 0xd9825a : 0xe8e6f2, 0, 0.19, 0, 0.21, 0.38);
    if (R(1) < 0.4) { SP(0x4f9f62, 0, 0.68, 0, 0.3, 0.3, 0.28); SP(0x6cc67a, 0.1, 0.95, 0.04, 0.2, 0.2, 0.19, 0); }
    else for (let i = 0; i < 5; i++) { const a = i * 1.257 + r * 3; prim(BLADE, i % 2 ? 0x4f9f62 : 0x3f8f5f, Math.cos(a) * 0.06, 0.38, Math.sin(a) * 0.06, 0.09, 0.8, 0.09, 0, Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45); }
  });
  const cabinet = it(0.56, 1.35, (r) => {
    B(r < 0.5 ? 0x8f9ab8 : 0xa9a6ba, 0, 0.66, 0, 0.5, 1.32, 0.56);
    for (let i = 0; i < 3; i++) { B(DARK, 0, 0.44 + i * 0.42, 0.283, 0.46, 0.015, 0.01, 0); B(CREAM, 0, 0.3 + i * 0.42, 0.285, 0.16, 0.05, 0.015, 0); }
    if (R(1) < 0.5) B(0xc8a06a, 0.02, 1.43, 0, 0.36, 0.2, 0.3, 1, 0, r);
  });
  const crashCart = it(0.5, 1.05, (r) => {
    B(r < 0.6 ? 0xe8413c : 0x39c5bb, 0, 0.52, 0, 0.62, 0.74, 0.46); B(0xe8e6f2, 0, 0.92, 0, 0.68, 0.05, 0.5);
    for (let i = 0; i < 3; i++) B(DARK, 0, 0.36 + i * 0.2, 0.233, 0.56, 0.015, 0.01, 0);
    B(DARK, 0, 0.07, 0, 0.5, 0.14, 0.36, 0); C(0x8ce99a, 0.16, 1.03, 0, 0.05, 0.18, 0); B(PAPER, -0.12, 0.98, 0, 0.2, 0.07, 0.16, 0);
  });
  const wetSign = it(0.4, 0.62, () => {
    for (const s of [-1, 1]) B(0xffd43b, 0, 0.3, s * 0.1, 0.3, 0.62, 0.03, 1, s * 0.3);
    B(DARK, 0, 0.36, 0.13, 0.05, 0.2, 0.01, 0, 0.3); B(DARK, 0, 0.2, 0.18, 0.05, 0.05, 0.01, 0, 0.3);
  });
  const o2 = it(0.3, 1.15, (r) => {
    C(r < 0.5 ? 0x4fa36a : 0xe8e6f2, 0, 0.5, 0, 0.11, 0.92); D(r < 0.5 ? 0x4fa36a : 0xe8e6f2, 0, 0.96, 0, 0.11, 0.08, 0.11, 0); C(STEEL, 0, 1.08, 0, 0.04, 0.12, 0);
  });
  const laundryCart = it(0.6, 0.95, (r) => {
    B(r < 0.5 ? 0x74c0fc : 0xfff3bf, 0, 0.5, 0, 0.8, 0.6, 0.55); B(STEEL, 0, 0.82, 0, 0.84, 0.04, 0.59, 0);
    SP(PAPER, -0.1, 0.84, 0, 0.3, 0.13, 0.22, 0); B(DARK, 0, 0.1, 0, 0.7, 0.2, 0.45, 0);
  });
  const medBin = it(0.4, 0.75, (r) => { TP(r < 0.5 ? 0xffd43b : 0xe8e6f2, 0, 0.32, 0, 0.2, 0.64); C(r < 0.5 ? 0xe8413c : 0x39c5bb, 0, 0.67, 0, 0.215, 0.07, 0); });
  const waterCooler = it(0.4, 1.3, () => {
    B(0xe8e6f2, 0, 0.45, 0, 0.36, 0.9, 0.36); C(0x9fd8ff, 0, 1.1, 0, 0.15, 0.36); D(0x9fd8ff, 0, 1.28, 0, 0.15, 0.06, 0.15, 0);
    B(0x74c0fc, -0.07, 0.68, 0.185, 0.05, 0.06, 0.02, 0); B(0xff6b6b, 0.07, 0.68, 0.185, 0.05, 0.06, 0.02, 0);
  });
  const mopBucket = it(0.42, 1.4, (r) => {
    TP(r < 0.5 ? 0xffd43b : 0x74c0fc, 0, 0.17, 0.02, 0.2, 0.34);
    C(WOODC, 0.05, 0.75, -0.08, 0.02, 1.3, 0, -0.13); SP(0xe8e6f2, 0.05, 0.14, 0.08, 0.1, 0.1, 0.1, 0);
  });
  const wardBed = it(0.95, 1.05, (r) => {
    B(STEEL, 0, 0.42, 0, 1.9, 0.08, 0.84); B(0xe8e6f2, 0, 0.54, 0, 1.84, 0.16, 0.8, 0);
    B(CREAM, -0.95, 0.62, 0, 0.06, 0.86, 0.88); B(CREAM, 0.95, 0.5, 0, 0.06, 0.62, 0.88);
    B(PAPER, -0.66, 0.67, 0, 0.36, 0.1, 0.5, 0); B(pick(r, [0x74c0fc, 0x8ce99a, 0xffc9d6, 0xb197fc]), 0.28, 0.635, 0, 1.2, 0.05, 0.82, 0);
    B(STEEL, 0.1, 0.8, 0.41, 1.0, 0.04, 0.03, 0); for (const s of [-1, 1]) B(DARK, s * 0.8, 0.19, 0, 0.08, 0.38, 0.7, 0);
  });
  const linenCart = it(0.55, 1.3, (r) => {
    for (const s of [-1, 1]) B(STEEL, s * 0.42, 0.66, 0, 0.04, 1.24, 0.5);
    for (let j = 0; j < 3; j++) {
      B(0xc9c6d6, 0, 0.2 + j * 0.42, 0, 0.82, 0.03, 0.48, 0);
      B(pick(R(j), [PAPER, 0xbfeaff, 0xd3f9d8, 0xffc9d6]), (R(j + 3) - 0.5) * 0.16, 0.3 + j * 0.42, 0, 0.46 + R(j + 6) * 0.2, 0.17, 0.4, j === 2 ? 1 : 0);
    }
    void r;
  });
  const bioBin = it(0.42, 0.8, (r) => {
    B(r < 0.6 ? 0xff8a3c : 0xe8413c, 0, 0.34, 0, 0.4, 0.68, 0.38); B(DARK, 0, 0.71, 0, 0.44, 0.07, 0.42, 0);
    B(0xffd43b, 0, 0.4, 0.193, 0.22, 0.22, 0.01, 0); B(DARK, 0, 0.4, 0.2, 0.1, 0.1, 0.01, 0, 0, 0, Math.PI / 4);
  });
  const supplyBoxes = it(0.6, 0.95, (r) => {
    B(0xe8e6f2, -0.2, 0.2, 0, 0.58, 0.4, 0.5); B(0x39c5bb, -0.2, 0.3, 0, 0.59, 0.07, 0.51, 0);
    B(0xd8ecf5, 0.36, 0.16, 0.02, 0.44, 0.32, 0.42, 1, 0, r - 0.5);
    if (r < 0.7) { B(0xe8e6f2, -0.16, 0.56, 0, 0.44, 0.32, 0.4, 1, 0, r * 2); B(0xff4d6d, -0.16, 0.725, 0, 0.14, 0.01, 0.14, 0, 0, r * 2); }
  });

  // ---- mall and shops
  const lowBench = it(0.5, 0.5, (r) => {
    B(r < 0.5 ? WOODC : 0xd9c7e8, 0, 0.42, 0, 1.5, 0.1, 0.46); for (const s of [-1, 1]) B(0x54506e, s * 0.55, 0.19, 0, 0.1, 0.38, 0.4, 0);
    if (R(1) < 0.35) B(pick(R(2), PASTEL), 0.3, 0.6, 0, 0.26, 0.28, 0.12, 1, 0, 0.4);
  });
  const palm = it(0.7, 1.7, (r) => {
    B(0xd9c7e8, 0, 0.25, 0, 0.66, 0.5, 0.66); B(0x5a4636, 0, 0.51, 0, 0.56, 0.02, 0.56, 0); C(0x8a5a3c, 0, 0.9, 0, 0.06, 0.8);
    for (let i = 0; i < 5; i++) { const a = i * 1.257 + r * 3; prim(BLADE, i % 2 ? 0x4fae6a : 0x3f8f5f, Math.cos(a) * 0.05, 1.28, Math.sin(a) * 0.05, 0.14, 0.75, 0.14, 0, Math.sin(a) * 0.95, 0, -Math.cos(a) * 0.95); }
  });
  const kiosk = it(0.7, 2.1, (r) => {
    const c = pick(r, PASTEL);
    B(CREAM, 0, 0.5, 0, 1.2, 1.0, 0.6); B(c, 0, 0.5, 0.305, 1.1, 0.5, 0.01, 0); B(0x8f7aa8, 0, 1.03, 0, 1.28, 0.06, 0.68);
    for (const s of [-1, 1]) B(0x54506e, s * 0.56, 1.5, -0.24, 0.05, 0.9, 0.05, 0);
    for (let i = 0; i < 4; i++) B(i % 2 ? CREAM : c, -0.48 + i * 0.32, 2.0, 0.05, 0.32, 0.05, 0.8, 0, 0.3);
    B(DARK, 0, 2.0, 0.05, 1.3, 0.04, 0.82, 1, 0.3);
  });
  const dressForm = it(0.4, 1.5, (r) => {
    C(0x54506e, 0, 0.02, 0, 0.19, 0.04, 0); C(STEEL, 0, 0.45, 0, 0.02, 0.86, 0);
    TP(pick(r, PASTEL), 0, 1.15, 0, 0.19, 0.56); D(CREAM, 0, 1.43, 0, 0.19, 0.06, 0.19, 0);
  });
  const rack = it(0.5, 1.5, (r) => {
    for (const s of [-1, 1]) { B(STEEL, s * 0.7, 0.72, 0, 0.04, 1.44, 0.04, 0); B(STEEL, s * 0.7, 0.02, 0, 0.06, 0.04, 0.46, 0); }
    B(STEEL, 0, 1.42, 0, 1.44, 0.04, 0.04, 0);
    for (let i = 0; i < 4; i++) B(pick(R(i + 9), PASTEL), -0.5 + i * 0.33, 1.0 - R(i + 5) * 0.12, 0, 0.09, 0.7 + R(i + 5) * 0.2, 0.4, i % 2 ? 0 : 1);
    void r;
  });
  const shopBags = it(0.4, 0.5, (r) => {
    for (let i = 0; i < (r < 0.5 ? 2 : 3); i++) {
      const c = pick(R(i), PASTEL), x = -0.22 + i * 0.24, h = 0.3 + R(i + 3) * 0.12;
      B(c, x, h / 2, (i % 2) * 0.08, 0.26, h, 0.12, 1, 0, (R(i + 5) - 0.5) * 0.7); B(CREAM, x, h + 0.04, (i % 2) * 0.08, 0.12, 0.08, 0.02, 0, 0, (R(i + 5) - 0.5) * 0.7);
    }
  });
  const cafeSet = it(0.9, 0.78, (r) => {
    C(CREAM, 0, 0.73, 0, 0.36, 0.05); C(0x54506e, 0, 0.36, 0, 0.035, 0.7, 0); C(0x54506e, 0, 0.02, 0, 0.2, 0.04, 0);
    for (const s of r < 0.5 ? [1] : [-1, 1]) { C(pick(R(s + 2), PASTEL), s * 0.6, 0.44, 0.05 * s, 0.16, 0.06); C(0x54506e, s * 0.6, 0.21, 0.05 * s, 0.03, 0.42, 0); }
    C(pick(r, PASTEL), 0.1, 0.82, 0.05, 0.045, 0.12, 0);
  });
  const arcade = it(0.76, 1.85, (r) => {
    const c = pick(r, [0x9d8cff, 0xff7ac8, 0x39c5bb, 0xffa94d, 0x3f7cc4]);
    B(c, 0, 0.9, -0.04, 0.72, 1.8, 0.66); B(DARK, 0, 0.92, 0.2, 0.74, 0.12, 0.36); B(DARK, 0, 1.3, 0.25, 0.6, 0.5, 0.05, 0, -0.25);
    GL(pick(R(1), [0x8ce99a, 0xffd43b, 0x74c0fc, 0xff8fa3]), 0, 1.3, 0.285, 0.5, 0.4, 0.01, -0.25); GL(CREAM, 0, 1.68, 0.3, 0.6, 0.16, 0.01);
    SP(0xe8413c, -0.16, 1.03, 0.24, 0.045, 0.045, 0.045, 0); B(0xffd43b, 0.14, 1.0, 0.26, 0.07, 0.03, 0.07, 0); B(CREAM, 0, 0.5, 0.292, 0.3, 0.4, 0.01, 0);
    glowSpots.push({ x: ox + sa * 0.5, y: 1.35, z: oz + ca * 0.5, size: 1.0, color: 0xc9b8ff, k: 0.3 });
  });
  const stanchion = it(0.3, 0.98, () => {
    for (const s of [-1, 1]) { C(0xc9a04a, s * 0.7, 0.03, 0, 0.14, 0.05, 0); C(0xc9a04a, s * 0.7, 0.48, 0, 0.03, 0.9); }
    B(0xe8413c, 0, 0.8, 0, 1.36, 0.06, 0.04, 0);
  });
  const plush = it(0.5, 0.62, (r) => {
    const c = pick(r, [0xfff1e0, 0xffc9d6, 0xc9b8ff, 0xbfeaff]);
    SP(c, 0, 0.19, 0, 0.2, 0.19, 0.18); SP(c, 0, 0.44, 0.02, 0.15, 0.14, 0.14);
    for (const s of [-1, 1]) B(c, s * 0.07, 0.64, 0, 0.06, 0.2, 0.04, 1, 0, 0, -s * 0.2);
    for (const s of [-1, 1]) B(DARK, s * 0.055, 0.46, 0.155, 0.045, 0.012, 0.01, 0); // closed, sleepy eyes
    if (R(1) < 0.4) { SP(pick(R(2), [0xffc9d6, 0xbfeaff]), 0.36, 0.13, 0.05, 0.14, 0.13, 0.13, 0); SP(pick(R(2), [0xffc9d6, 0xbfeaff]), 0.36, 0.3, 0.06, 0.1, 0.1, 0.1, 0); }
  });
  const balloons = it(0.4, 1.9, (r) => {
    B(0x54506e, 0, 0.05, 0, 0.16, 0.1, 0.16);
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.2, y = 1.45 + (i % 2) * 0.26;
      SP(pick(R(i), [0xff8fa3, 0xffd43b, 0x74c0fc, 0xb197fc]), x, y, (i % 2) * 0.08, 0.16, 0.19, 0.16);
      B(CREAM, x / 2, y / 2, (i % 2) * 0.04, 0.012, y - 0.18, 0.012, 0, 0, 0, -Math.atan2(x, y));
    }
    void r;
  });
  const trashcan = it(0.44, 0.9, (r) => { B(r < 0.5 ? 0x8f93a8 : 0x8f7aa8, 0, 0.4, 0, 0.42, 0.8, 0.42); B(DARK, 0, 0.84, 0, 0.46, 0.1, 0.46); B(DARK, 0, 0.66, 0.212, 0.26, 0.08, 0.01, 0); });
  const stackChairs = it(0.5, 1.0, (r) => {
    const c = pick(r, [0xffa94d, 0x74c0fc, 0xff8fa3]);
    for (let i = 0; i < 3; i++) { B(c, 0, 0.45 + i * 0.13, i * 0.02, 0.46, 0.05, 0.44); B(c, 0, 0.68 + i * 0.13, -0.2 + i * 0.02, 0.46, 0.3, 0.04, i === 2 ? 1 : 0); }
    for (const s of [-1, 1]) B(STEEL, s * 0.2, 0.22, 0, 0.04, 0.44, 0.4, 0);
  });
  const bookStack = it(0.42, 0.6, (r) => {
    const n = 3 + Math.floor(r * 3);
    for (let i = 0; i < n; i++) B(pick(R(i), [0xe8413c, 0x3f7cc4, 0x4fa36a, 0xffc94a, 0x8f6fb0, 0xfff1e0]), (R(i + 7) - 0.5) * 0.06, 0.045 + i * 0.09, 0, 0.34 - R(i + 3) * 0.06, 0.085, 0.26, i === n - 1 || i === 0 ? 1 : 0, 0, (R(i + 5) - 0.5) * 0.6);
    if (R(9) < 0.5) B(pick(R(8), PASTEL), 0.36, 0.14, 0, 0.07, 0.28, 0.22, 1, 0, 0, -0.25);
  });
  const backpack = it(0.36, 0.5, (r) => {
    const c = pick(r, PASTEL);
    SP(c, 0, 0.23, 0, 0.19, 0.24, 0.14); B(c, 0, 0.16, 0.13, 0.22, 0.16, 0.06); B(DARK, 0, 0.36, 0.13, 0.16, 0.02, 0.02, 0);
  });
  const laundryBasket = it(0.5, 0.6, (r) => {
    TP(r < 0.5 ? 0xfff1e0 : 0x74c0fc, 0, 0.2, 0, 0.28, 0.4); SP(pick(R(1), PASTEL), -0.05, 0.42, 0, 0.2, 0.1, 0.18, 0);
    if (R(2) < 0.4) C(0xff8fa3, 0.42, 0.12, 0.05, 0.07, 0.24, 0);
  });
  const ball = it(0.36, 0.36, (r) => { SP(pick(r, [0xff8a3c, 0xe8413c, 0xfff1e0, 0x74c0fc]), 0, 0.17, 0, 0.17); });

  // ---- industrial
  const palletGoods = it(0.95, 0.95, (r) => {
    B(WOODC, 0, 0.07, 0, 1.05, 0.14, 0.9);
    if (r < 0.75) { B(pick(R(1), [0xd8ecf5, 0xe8e3f0, 0xd9c08a]), 0, 0.5, 0, 0.92, 0.7, 0.78); B(pick(R(2), [0x3f7cc4, 0xe8413c, 0x4fa36a]), 0, 0.55, 0, 0.94, 0.07, 0.8, 0); B(PAPER, 0.2, 0.62, 0.395, 0.22, 0.16, 0.01, 0); }
  });
  const drum = it(0.62, 0.92, (r) => {
    const c = pick(r, [0x3f7cc4, 0xd9534f, 0xe39b3a, 0x4fa36a, 0x6f7f9a]);
    if (R(1) < 0.22) { C(c, 0, 0.29, 0, 0.29, 0.88, 2, 0, HP); C(DARK, 0.2, 0.29, 0, 0.3, 0.04, 0, 0, HP); }
    else {
      C(c, 0, 0.44, 0, 0.29, 0.88); C(DARK, 0, 0.58, 0, 0.297, 0.04, 0);
      if (R(2) < 0.3) B(0xffd43b, 0, 0.45, 0.295, 0.2, 0.2, 0.01, 0);
    }
  });
  const hoseCoil = it(0.6, 0.3, (r) => {
    const c = pick(r, [0x4fa36a, 0xff8a3c, 0xffd43b]);
    C(c, 0, 0.05, 0, 0.32, 0.1); C(c, 0.02, 0.14, 0, 0.27, 0.09, 0); B(0xc9a04a, 0.36, 0.05, 0.14, 0.2, 0.06, 0.06, 0, 0, 0.6);
  });
  const tyres = it(0.7, 0.75, (r) => {
    const n = 2 + Math.floor(r * 1.6);
    for (let i = 0; i < n; i++) { C(0x2b2540, (R(i) - 0.5) * 0.1, 0.11 + i * 0.21, (R(i + 3) - 0.5) * 0.08, 0.33, 0.2); }
    C(0x8f93a8, 0, 0.11 + (n - 1) * 0.21 + 0.1, 0, 0.16, 0.012, 0);
    if (R(8) < 0.2) { C(0x2b2540, 0.52, 0.33, -0.1, 0.33, 0.2, 2, HP - 0.25); }
  });
  const toolbox = it(0.36, 0.34, (r) => {
    B(r < 0.6 ? 0xe8413c : 0x3f7cc4, 0, 0.12, 0, 0.52, 0.22, 0.26); B(DARK, 0, 0.24, 0, 0.54, 0.04, 0.28, 0); B(STEEL, 0, 0.3, 0, 0.22, 0.03, 0.04, 0);
    B(STEEL, 0.44, 0.015, 0.1, 0.3, 0.03, 0.06, 0, 0, 0.7); B(0xffd43b, -0.42, 0.02, 0.08, 0.22, 0.04, 0.05, 0, 0, -0.4);
  });
  const sleepers = it(0.75, 0.6, (r) => {
    const n = 2 + Math.floor(r * 1.5);
    for (let j = 0; j < n; j++) for (let i = 0; i < 2; i++)
      B(j % 2 ? 0x7a5235 : 0x6b4a34, j % 2 ? -0.4 + i * 0.8 : 0, 0.075 + j * 0.15, j % 2 ? 0 : -0.2 + i * 0.4, j % 2 ? 0.24 : 1.6, 0.14, j % 2 ? 0.7 : 0.24, 1, 0, (R(i + j * 3) - 0.5) * 0.06);
  });
  const sacks = it(0.6, 0.6, (r) => {
    const c = r < 0.5 ? 0xd9c08a : 0xc9c6d6;
    for (let i = 0; i < 3 + Math.floor(R(1) * 2); i++) B(c, (i % 2) * 0.32 - 0.16 + (i > 1 ? 0.16 : 0), 0.1 + Math.floor(i / 2) * 0.19, 0, 0.6, 0.18, 0.4, 1, 0, (R(i + 2) - 0.5) * 0.3, (R(i + 5) - 0.5) * 0.08);
    B(0xe8413c, -0.16, 0.1, 0.205, 0.2, 0.1, 0.01, 0);
  });
  const gasCyl = it(0.34, 1.35, (r) => {
    for (const s of [-1, 1]) { const c = s < 0 ? 0xe8413c : r < 0.5 ? 0x3f7cc4 : 0xffd43b; C(c, s * 0.14, 0.55, 0, 0.12, 1.1); D(c, s * 0.14, 1.1, 0, 0.12, 0.09, 0.12, 0); }
    B(DARK, 0, 0.8, 0, 0.56, 0.05, 0.27, 0);
  });
  const spool = it(0.7, 1.1, (r) => {
    C(r < 0.5 ? 0x2b2540 : 0xe39b3a, 0, 0.54, 0, 0.36, 0.5, 0, HP); for (const s of [-1, 1]) C(WOODC, 0, 0.54, s * 0.28, 0.54, 0.06, 2, HP);
  });
  const handTruck = it(0.4, 1.2, (r) => {
    for (const s of [-1, 1]) { B(0xe8413c, s * 0.18, 0.6, -0.05, 0.04, 1.14, 0.04, 0, -0.14); B(DARK, s * 0.22, 0.11, -0.1, 0.05, 0.22, 0.22, 0); }
    B(0xe8413c, 0, 0.75, -0.07, 0.4, 0.05, 0.04, 0, -0.14); B(0xe8413c, 0, 1.15, -0.13, 0.4, 0.05, 0.04, 1, -0.14); B(STEEL, 0, 0.03, 0.14, 0.42, 0.03, 0.3);
    if (r < 0.5) B(0xc8a06a, 0, 0.26, 0.14, 0.38, 0.42, 0.28);
  });
  const jerry = it(0.3, 0.5, (r) => {
    for (let i = 0; i < (r < 0.5 ? 1 : 2); i++) { const c = i ? 0x4fa36a : 0xe8413c, x = i * 0.38 - (r < 0.5 ? 0 : 0.19); B(c, x, 0.21, 0, 0.3, 0.42, 0.16, 1, 0, i * 0.5); B(DARK, x + 0.08, 0.45, 0, 0.07, 0.07, 0.07, 0); B(c, x - 0.05, 0.46, 0, 0.14, 0.03, 0.04, 0); }
  });
  const pipeStack = it(0.6, 0.45, (r) => {
    const c = r < 0.5 ? 0x8f93a8 : 0xb46a4a;
    for (const [x, y] of [[-0.11, 0.1], [0.11, 0.1], [0, 0.28]]) prim(CYL, c, 0, y, x, 0.1, 1.6, 0.1, 2, 0, 0, HP);
  });
  const lockers = it(0.5, 1.85, (r) => {
    const c = pick(r, [0x6f7f9a, 0x4fa3a0, 0xb46a4a]);
    B(c, 0, 0.92, 0, 1.2, 1.84, 0.46);
    for (let i = 0; i < 3; i++) { B(DARK, -0.4 + i * 0.4, 1.5, 0.232, 0.22, 0.1, 0.01, 0); B(CREAM, -0.3 + i * 0.4, 0.95, 0.235, 0.04, 0.1, 0.012, 0); if (i) B(DARK, -0.6 + i * 0.4, 0.92, 0.232, 0.014, 1.8, 0.01, 0); }
  });

  // ---- yards and forest
  const fern = it(0.6, 0.6, (r) => {
    for (let i = 0; i < 6; i++) { const a = i * 1.047 + r * 3, l = 0.45 + R(i) * 0.2; prim(BLADE, i % 2 ? 0x3f8f5f : 0x4fae6a, Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04, 0.09, l, 0.09, 0, Math.sin(a) * 1.0, 0, -Math.cos(a) * 1.0); }
  });
  const bushlet = it(0.6, 0.55, (r) => { SP(r < 0.5 ? 0x4f9f62 : 0x5aa86a, 0, 0.22, 0, 0.36, 0.26, 0.3); SP(0x6cc67a, 0.2, 0.36, 0.05, 0.2, 0.16, 0.18, 0); if (R(1) < 0.4) for (let i = 0; i < 3; i++) B(0xffb3d1, -0.2 + i * 0.16, 0.42 - (i % 2) * 0.06, 0.2, 0.07, 0.07, 0.07, 0, 0.6, i); });
  const log = it(0.5, 0.42, (r) => {
    C(0x8a5a3c, 0, 0.2, 0, 0.2, 1.3 + r * 0.3, 2, 0, HP); for (const s of [-1, 1]) C(0xd9b98a, s * (0.655 + r * 0.15), 0.2, 0, 0.15, 0.01, 0, 0, HP);
    if (R(1) < 0.4) { C(CREAM, 0.2, 0.42, 0, 0.03, 0.1, 0); D(0xe8413c, 0.2, 0.45, 0, 0.09, 0.07, 0.09, 0); }
  });
  const stump = it(0.6, 0.4, (r) => {
    C(0x8a5a3c, 0, 0.16, 0, 0.26, 0.32); C(0xd9b98a, 0, 0.325, 0, 0.21, 0.01, 0);
    if (r < 0.3) { B(STEEL, 0.05, 0.5, 0, 0.22, 0.14, 0.03, 1, 0, 0, 0.5); B(WOODC, 0.22, 0.56, 0, 0.5, 0.04, 0.04, 0, 0, 0, 0.5); }
  });
  const mushrooms = it(0.4, 0.3, (r) => {
    for (let i = 0; i < 2 + Math.floor(r * 2.5); i++) {
      const x = (R(i) - 0.5) * 0.4, z = (R(i + 4) - 0.5) * 0.3, s = 0.7 + R(i + 8) * 0.7;
      C(CREAM, x, 0.06 * s, z, 0.03 * s, 0.12 * s, 0); D(r < 0.6 ? 0xe8413c : 0xc98f6a, x, 0.11 * s, z, 0.1 * s, 0.08 * s, 0.1 * s, i ? 0 : 2);
    }
  });
  const rocks = it(0.5, 0.35, (r) => { SP(0x8a8197, 0, 0.1, 0, 0.26, 0.17, 0.2); if (r < 0.6) SP(0x9a91a8, 0.3, 0.06, 0.1, 0.11, 0.09, 0.1, 0); });
  const gnome = it(0.36, 0.62, (r) => {
    TP(pick(r, [0x3f7cc4, 0x4fa36a, 0x8f6fb0]), 0, 0.14, 0, 0.13, 0.28); SP(0xffdcc2, 0, 0.34, 0, 0.11, 0.1, 0.1); SP(PAPER, 0, 0.27, 0.07, 0.09, 0.1, 0.06, 0);
    K(0xe8413c, 0, 0.53, 0, 0.12, 0.26);
  });
  const tricycle = it(0.5, 0.6, (r) => {
    const c = pick(r, [0xe8413c, 0xff7ac8, 0x39c5bb]);
    C(DARK, 0.32, 0.16, 0, 0.16, 0.05, 2, HP); for (const s of [-1, 1]) C(DARK, -0.26, 0.11, s * 0.18, 0.11, 0.05, 0, HP);
    B(c, 0.02, 0.26, 0, 0.6, 0.06, 0.07, 1, 0, 0, 0.25); B(c, 0.3, 0.4, 0, 0.05, 0.4, 0.05, 0); B(DARK, 0.3, 0.6, 0, 0.05, 0.05, 0.38, 0); B(CREAM, -0.16, 0.3, 0, 0.2, 0.05, 0.18, 0);
  });
  const lawnChair = it(0.6, 0.85, (r) => {
    const c = pick(r, [0xff8fa3, 0x74c0fc, 0xffd43b, 0x8ce99a]);
    for (let i = 0; i < 3; i++) B(i % 2 ? PAPER : c, 0, 0.36, -0.15 + i * 0.17, 0.5, 0.04, 0.17, 0);
    B(DARK, 0, 0.345, 0.02, 0.52, 0.02, 0.53); B(c, 0, 0.62, -0.33, 0.5, 0.56, 0.04, 1, -0.3);
    for (const s of [-1, 1]) for (const q of [-1, 1]) B(STEEL, s * 0.24, 0.17, q * 0.2, 0.03, 0.36, 0.03, 0, q * 0.25);
  });
  const pickets = it(0.2, 0.7, (r) => {
    for (let i = 0; i < 5; i++) { if (R(i) < 0.15) continue; const lean = R(i + 5) < 0.2 ? (R(i + 9) - 0.5) * 0.9 : 0; B(PAPER, -0.48 + i * 0.24, 0.3, 0, 0.13, 0.6, 0.03, 1, 0, 0, lean); prim(BLADE, PAPER, -0.48 + i * 0.24 - Math.sin(lean) * 0.3, 0.6 * Math.cos(lean), 0, 0.07, 0.1, 0.02, 0, 0, 0, lean); }
    B(0xe8e3f0, 0, 0.42, -0.025, 1.2, 0.06, 0.03, 0); void r;
  });
  const birdhouse = it(0.3, 1.75, (r) => {
    C(WOODC, 0, 0.7, 0, 0.035, 1.4, 0); B(pick(r, [0xfff1e0, 0x74c0fc, 0xffd43b]), 0, 1.5, 0, 0.26, 0.26, 0.24);
    for (const s of [-1, 1]) B(0xe8413c, s * 0.09, 1.69, 0, 0.24, 0.04, 0.3, 1, 0, 0, -s * 0.7); C(DARK, 0, 1.52, 0.122, 0.045, 0.01, 0, HP);
  });
  const flamingo = it(0.3, 0.85, () => {
    C(DARK, 0, 0.2, 0, 0.012, 0.4, 0); SP(0xff8fc0, 0, 0.47, 0, 0.14, 0.1, 0.09); C(0xff8fc0, 0.12, 0.62, 0, 0.022, 0.3, 0, 0, -0.35);
    SP(0xff8fc0, 0.17, 0.78, 0, 0.05, 0.05, 0.045, 0); B(DARK, 0.23, 0.76, 0, 0.07, 0.03, 0.03, 0, 0, 0, -0.5);
  });
  const bbq = it(0.5, 0.95, (r) => {
    SP(r < 0.5 ? 0xe8413c : 0x2b2540, 0, 0.7, 0, 0.26, 0.22, 0.26); C(STEEL, 0, 0.72, 0, 0.265, 0.02, 0); B(DARK, 0, 0.95, 0, 0.1, 0.05, 0.04, 0);
    for (let i = 0; i < 3; i++) { const a = i * 2.094; C(STEEL, Math.cos(a) * 0.15, 0.26, Math.sin(a) * 0.15, 0.014, 0.56, 0, Math.sin(a) * 0.3, -Math.cos(a) * 0.3); }
  });
  const birdBath = it(0.5, 0.8, () => { C(0xa8a4c4, 0, 0.36, 0, 0.08, 0.72); TP(0xa8a4c4, 0, 0.72, 0, 0.3, 0.1); C(0x6ad1e3, 0, 0.775, 0, 0.26, 0.01, 0); });
  const mailbox = it(0.26, 1.08, (r) => {
    C(WOODC, 0, 0.42, 0, 0.04, 0.84, 0); B(pick(r, [0x3a3654, 0xe8e6f2, 0x3f7cc4, 0xe8413c]), 0, 0.92, 0, 0.2, 0.16, 0.42);
    C(pick(r, [0x3a3654, 0xe8e6f2, 0x3f7cc4, 0xe8413c]), 0, 1.0, 0, 0.1, 0.42, 2, HP); B(0xe8413c, 0.115, 1.02, 0.06, 0.02, 0.16, 0.05, 0);
  });
  const woodpile = it(0.5, 0.7, (r) => {
    for (let j = 0; j < 2; j++) for (let i = 0; i < 3 - j; i++) { B(i % 2 ? 0x8a5a3c : 0x7a4f35, -0.24 + i * 0.24 + j * 0.12, 0.11 + j * 0.21, 0, 0.21, 0.2, 0.5, 1, 0, 0, (R(i + j * 3) - 0.5) * 0.5); B(0xd9b98a, -0.24 + i * 0.24 + j * 0.12, 0.11 + j * 0.21, 0.252, 0.14, 0.13, 0.01, 0); }
    void r;
  });

  // ---- safe rooms
  const sleepingBag = it(0.75, 0.25, (r) => {
    const c = pick(r, [0xe8413c, 0x3f7cc4, 0x4fa36a, 0x8f6fb0, 0xffa94d]);
    B(c, 0.1, 0.08, 0, 1.5, 0.15, 0.62, 1, 0, (r - 0.5) * 0.2); B(CREAM, 0.1, 0.165, 0, 0.3, 0.02, 0.63, 0, 0, (r - 0.5) * 0.2); B(PAPER, -0.72, 0.09, 0, 0.3, 0.14, 0.44, 1, 0, (r - 0.5) * 0.2);
  });
  const supplyCrate = it(0.62, 1.0, (r) => {
    B(0xc8924e, 0, 0.28, 0, 0.62, 0.56, 0.58); for (const y of [0.06, 0.5]) B(0xa9763a, 0, y, 0, 0.64, 0.1, 0.6, 0); B(PAPER, 0, 0.28, 0.292, 0.24, 0.24, 0.01, 0);
    B(0xff4d6d, 0, 0.28, 0.296, 0.16, 0.05, 0.01, 0); B(0xff4d6d, 0, 0.28, 0.296, 0.05, 0.16, 0.01, 0);
    if (r < 0.5) B(0x7fa650, 0.04, 0.7, 0, 0.42, 0.28, 0.34, 1, 0, r * 2); else for (let i = 0; i < 3; i++) C(pick(R(i), [0xe8413c, 0xffd43b, 0x74c0fc]), -0.16 + i * 0.16, 0.64, (i % 2) * 0.1, 0.065, 0.16, i === 1 ? 2 : 0);
  });
  const radioCrate = it(0.5, 0.85, () => {
    B(0xb5894f, 0, 0.2, 0, 0.56, 0.4, 0.46); B(0x5a7a5a, 0, 0.53, 0, 0.42, 0.26, 0.16); B(DARK, -0.09, 0.53, 0.082, 0.16, 0.14, 0.01, 0); C(0xffd43b, 0.12, 0.55, 0.085, 0.04, 0.01, 0, HP);
    C(STEEL, 0.17, 0.9, 0, 0.01, 0.5, 0, 0, -0.2);
  });
  const candles = it(0.4, 0.3, (r) => {
    C(0x8f7aa8, 0, 0.012, 0, 0.2, 0.024, 0);
    for (let i = 0; i < 3; i++) {
      const x = -0.1 + i * 0.1, z = (i % 2) * 0.08 - 0.03, h = 0.1 + R(i) * 0.14;
      C(CREAM, x, h / 2 + 0.02, z, 0.035, h, i === 1 ? 2 : 0); GL(0xffd98a, x, h + 0.06, z, 0.03, 0.07, 0.03);
    }
    glowSpots.push({ x: ox, y: 0.32, z: oz, size: 0.7, color: 0xffc46b, k: 0.55 }); void r;
  });
  const jugs = it(0.36, 0.5, (r) => { for (let i = 0; i < (r < 0.4 ? 1 : 2); i++) { C(0x9fd8ff, -0.17 + i * 0.34, 0.2, 0, 0.14, 0.4); C(0x3f7cc4, -0.17 + i * 0.34, 0.43, 0, 0.05, 0.06, 0); } });
  const cans = it(0.34, 0.36, (r) => {
    for (let i = 0; i < 3; i++) C(pick(R(i), [0xe8413c, 0xffa94d, 0x8ce99a]), -0.14 + i * 0.14, 0.08, 0, 0.065, 0.16, i === 1 ? 2 : 0);
    for (let i = 0; i < 2; i++) C(pick(R(i + 4), [0xffd43b, 0xe8413c]), -0.07 + i * 0.14, 0.24, 0, 0.065, 0.16, i ? 2 : 0); C(PAPER, 0.3, 0.05, 0.1, 0.05, 0.1, 0); void r;
  });
  const lantern = it(0.3, 0.42, () => { C(0x4fa36a, 0, 0.03, 0, 0.11, 0.06, 0); GL(0xffe9b0, 0, 0.17, 0, 0.13, 0.2, 0.13); C(0x4fa36a, 0, 0.3, 0, 0.12, 0.05); B(DARK, 0, 0.4, 0, 0.16, 0.02, 0.02, 0); glowSpots.push({ x: ox, y: 0.3, z: oz, size: 0.9, color: 0xffd9a0, k: 0.55 }); });

  // -------------------------------------------------------------------- kits
  const K_STREET = [bin, bin, bags, bags, hydrant, bollard, newsbox, newsbox, cone, meter, sign, bike, planter, planter, boxes, boxes, sawhorse, cardboard, scooter, postbox, vending, aboard, bottleCrate];
  const K_SUBURB_ST = [wheelie, wheelie, wheelie, bags, hydrant, cone, tricycle, scooter, bike, boxes, planter, sign, postbox, bushlet, ball];
  const K_PARKING = [cone, cone, cone, sawhorse, tyres, drum, bollard, bollard, boxes, bin, jerry, sign, bags];
  const K_HOSP = [gurney, gurney, wheelchair, wheelchair, ivStand, ivStand, chair, seatRow, seatRow, plant, cabinet, crashCart, crashCart, wetSign, o2, laundryCart, medBin, waterCooler, mopBucket, boxes];
  // Hospital corridors (ch2): big things parked along the wall, and slim things tucked in beside them.
  const K_CORR_BIG = [gurney, seatRow, linenCart, wardBed, crashCart, cabinet, laundryCart, gurney, supplyBoxes, wheelchair, wardBed, waterCooler, seatRow, plant];
  const K_CORR_SMALL = [ivStand, o2, medBin, bioBin, wetSign, plant, chair, wheelchair, boxes, mopBucket, ivStand];
  const K_LAB = [cabinet, cabinet, chair, plant, o2, crashCart, medBin, boxes, waterCooler, gasCyl, drum, mopBucket];
  const K_MALL = [lowBench, lowBench, palm, palm, kiosk, dressForm, dressForm, rack, rack, shopBags, shopBags, cafeSet, vending, stanchion, trashcan, trashcan, aboard, plant, boxes];
  const K_SHOP = [boxes, boxes, chair, plant, vending, trashcan, cabinet, bookStack, bottleCrate, shopBags, mopBucket, stackChairs, lowBench];
  const K_HOME = [chair, plant, boxes, backpack, bookStack, cabinet, shopBags, laundryBasket, ball, lowBench];
  const K_PLANT = [drum, drum, palletGoods, toolbox, gasCyl, lockers, hoseCoil, sacks, handTruck, jerry, cabinet, mopBucket, pipeStack, cone, boxes];
  const K_INDUS = [palletGoods, palletGoods, drum, drum, drum, hoseCoil, tyres, tyres, toolbox, sacks, gasCyl, spool, handTruck, jerry, cone, sawhorse, pipeStack, boxes, bags];
  const K_RAIL = [sleepers, sleepers, sleepers, drum, tyres, sacks, spool, palletGoods, pipeStack, bushlet, rocks, toolbox, jerry];
  const K_YARD = [gnome, hoseCoil, lawnChair, lawnChair, bbq, flamingo, wheelie, tricycle, ball, planter, birdBath, pickets, bushlet, woodpile, fern];
  const K_FOREST = [fern, fern, fern, fern, fern, log, log, stump, stump, mushrooms, mushrooms, rocks, rocks, bushlet, birdhouse, woodpile];
  const K_PARK = [bushlet, bushlet, planter, bin, lowBench, rocks, fern, birdBath, bike];
  const K_SAFE = [sleepingBag, sleepingBag, supplyCrate, supplyCrate, radioCrate, candles, candles, jugs, cans, backpack, lantern, bookStack, boxes];
  const K_ROAD = [cone, cone, sawhorse, cardboard, boxes, bags];
  const K_HINT: Record<number, Item[]> = {
    [HINT.ARCADE]: [arcade, arcade, arcade, arcade, vending, trashcan, stanchion],
    [HINT.TOYS]: [plush, plush, plush, shopBags, rack, boxes, balloons, ball],
    [HINT.GIFT]: [balloons, balloons, plush, plant, shopBags, rack],
    [HINT.FOOD]: [cafeSet, cafeSet, trashcan, aboard, vending, plant, stackChairs, bottleCrate, boxes],
    [HINT.SCHOOL]: [chair, backpack, backpack, ball, ball, bookStack, cabinet, plant, stackChairs, lockers],
    [HINT.BOOKS]: [bookStack, bookStack, bookStack, chair, plant, cabinet, boxes, lowBench],
    [HINT.OFFICE]: [cabinet, cabinet, chair, plant, waterCooler, boxes, bookStack, trashcan],
    [HINT.LAUNDRY]: [laundryBasket, laundryBasket, laundryCart, boxes, chair, mopBucket],
  };

  // ------------------------------------------------------------------ masks
  const n = W * H;
  const NO_FLOOR = 1, NO_WALL = 2, NO_PAINT = 4;
  const mask = new Uint8Array(n), hint = new Uint8Array(n);
  const stamp = (cx: number, cz: number, rad: number, bits: number) => {
    for (let z = Math.max(0, Math.floor(cz - rad)); z <= Math.min(H - 1, Math.floor(cz + rad)); z++)
      for (let x = Math.max(0, Math.floor(cx - rad)); x <= Math.min(W - 1, Math.floor(cx + rad)); x++)
        if (Math.hypot(x + 0.5 - cx, z + 0.5 - cz) <= rad) mask[z * W + x] |= bits;
  };
  const rectMask = (x0: number, z0: number, x1: number, z1: number, bits: number) => {
    for (let z = Math.max(0, Math.floor(z0)); z <= Math.min(H - 1, Math.floor(z1)); z++) for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(W - 1, Math.floor(x1)); x++) mask[z * W + x] |= bits;
  };
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const i = z * W + x, f = def.floor[i];
    if (def.doorCell[i] >= 0) rectMask(x - 1, z - 1, x + 1, z + 1, NO_FLOOR | NO_WALL);
    if (f === F.NONE || f === F.WATER) continue;
    // Thresholds: arch.ts hangs a door frame wherever an indoor floor meets a different floor.
    for (const [ax, az] of [[1, 0], [0, 1]]) {
      const g = floorOf(x + ax, z + az);
      if (g === F.NONE || g === F.WATER || g === f || !(isIndoor(f) || isIndoor(g))) continue;
      rectMask(x - 1 + ax * 0, z - 1, x + 1 + ax, z + 1 + az, NO_FLOOR); mask[i] |= NO_WALL; mask[(z + az) * W + x + ax] |= NO_WALL;
    }
  }
  // Storeys: this pass dresses the ground storey only, so only what stands on the ground keeps clutter away.
  const onGround = (o: { y?: number }): boolean => (o.y ?? 0) < 1;
  if (ctx.S.levels > 1) {
    const { WH, wall } = ctx.S;
    // Nothing on stairs or ladders, or in the way at their foot...
    for (const r of def.ramps) if (r.lv === 0) rectMask(r.x0 - 1, r.z0 - 1, r.x1 + 1, r.z1 + 1, NO_FLOOR | NO_WALL);
    // ...and nothing under a slab outdoors (a skybridge, a balcony), where trees, poles and wall signs would poke through it.
    for (let i = 0; i < n; i++) if (def.floor[i] !== F.NONE && !isIndoor(def.floor[i]) && (def.floor[i + WH] !== F.NONE || wall[i + WH])) mask[i] |= NO_FLOOR | NO_WALL;
  }
  for (const p of def.pickups) if (onGround(p)) stamp(p.x / T, p.z / T, 2.0, p.kind === 'obj' ? NO_FLOOR | NO_WALL : NO_FLOOR);
  for (const p of def.notes) if (onGround(p)) stamp(p.x / T, p.z / T, 2.0, NO_FLOOR);
  for (const s of def.steps) if (onGround(s.at)) stamp(s.at.x / T, s.at.z / T, 2.0, NO_FLOOR);
  for (const s of def.spawns) if (onGround(s)) stamp(s.x / T, s.z / T, 1.2, NO_FLOOR);
  for (const k in def.checkpointSpawns) for (const s of def.checkpointSpawns[k]) if (onGround(s)) stamp(s.x / T, s.z / T, 1.2, NO_FLOOR);
  for (const a of def.arrows) if (onGround(a)) { stamp(a.x, a.z, 1.1, NO_FLOOR); stamp(a.x, a.z, 0.75, NO_PAINT); }
  for (const l of def.labels) {
    if (!onGround(l)) continue;
    const across = Math.abs(Math.sin(l.rot)) > 0.7, hw = (l.text.length * l.size * 0.62) / 80 + 0.2, hh = (l.size * 1.1) / 80 + 0.1;
    rectMask(l.x - (across ? hh : hw), l.z - (across ? hw : hh), l.x + (across ? hh : hw), l.z + (across ? hw : hh), NO_FLOOR | NO_PAINT);
    for (const [re, id, rad] of HINTS) if (re.test(l.text)) {
      for (let z = Math.max(0, Math.floor(l.z - rad)); z <= Math.min(H - 1, Math.floor(l.z + rad)); z++)
        for (let x = Math.max(0, Math.floor(l.x - rad)); x <= Math.min(W - 1, Math.floor(l.x + rad)); x++) hint[z * W + x] = id;
    }
  }
  const last = def.steps[def.steps.length - 1];
  if (last?.area && !last.area.lv) rectMask(last.area.x0 - 1, last.area.z0 - 1, last.area.x1 + 1, last.area.z1 + 1, NO_FLOOR);

  // Free run lengths through each cell (walls and props both narrow a passage).
  const runX = new Uint8Array(n), runZ = new Uint8Array(n);
  const free = (i: number) => def.solid[i] === 0;
  for (let z = 0; z < H; z++) for (let x = 0, s = 0; x <= W; x++) {
    if (x < W && free(z * W + x)) continue;
    for (let k = s; k < x; k++) runX[z * W + k] = Math.min(255, x - s);
    s = x + 1;
  }
  for (let x = 0; x < W; x++) for (let z = 0, s = 0; z <= H; z++) {
    if (z < H && free(z * W + x)) continue;
    for (let k = s; k < z; k++) runZ[k * W + x] = Math.min(255, z - s);
    s = z + 1;
  }
  const lampNear = (x: number, z: number, r: number): boolean => { for (const l of def.lamps) if (onGround(l) && Math.abs(l.x - x) < r && Math.abs(l.z - z) < r) return true; return false; };

  // ---------------------------------------------- hospital corridors (ch2)
  // Long 2-5 tile wide passages on the hospital's tiled floors get their own treatment: a steady
  // rhythm of parked equipment down both walls, handrails, signs and floor stripes, with the
  // middle lane left clear. `corr` holds which way each such cell runs.
  const CX = 1, CZ = 2;
  const corr = new Uint8Array(n), hosp = new Uint8Array(n);
  if (chap === 2) {
    // The hospital is the big connected tiled areas (not the mall's tiled shop floors or the roof huts).
    const seen = new Uint8Array(n);
    for (let s = 0; s < n; s++) {
      if (seen[s] || def.floor[s] !== F.TILES) continue;
      const comp = [s]; seen[s] = 1;
      for (let k = 0; k < comp.length; k++) {
        const c = comp[k], cx = c % W;
        for (const d of [1, -1, W, -W]) {
          const j = c + d;
          if (j < 0 || j >= n || seen[j] || def.floor[j] !== F.TILES || (d === 1 && cx === W - 1) || (d === -1 && cx === 0)) continue;
          seen[j] = 1; comp.push(j);
        }
      }
      if (comp.length >= 600) for (const c of comp) hosp[c] = 1;
    }
    // One pass per axis. `at(a, b)` is the cell `a` tiles along the corridor on line `b`.
    for (const bit of [CX, CZ]) {
      const LA = bit === CX ? W : H, LB = bit === CX ? H : W;
      const at = (a: number, b: number) => (bit === CX ? b * W + a : a * W + b);
      const along = new Uint16Array(n), across = new Uint16Array(n);
      for (let b = 0; b < LB; b++) for (let a = 0, s = 0; a <= LA; a++) {
        if (a < LA && hosp[at(a, b)]) continue;
        for (let k = s; k < a; k++) along[at(k, b)] = a - s;
        s = a + 1;
      }
      for (let a = 0; a < LA; a++) for (let b = 0, s = 0; b <= LB; b++) {
        if (b < LB && hosp[at(a, b)]) continue;
        for (let k = s; k < b; k++) across[at(a, k)] = b - s;
        s = b + 1;
      }
      const is = new Uint8Array(n);
      for (let i = 0; i < n; i++) if (hosp[i] && across[i] >= 2 && across[i] <= 5 && along[i] >= Math.max(8, across[i] * 3)) is[i] = 1;
      for (let b = 0; b < LB; b++) {
        // A doorway stub can look like a corridor seen end-on: forget those first.
        for (let a = 0, s = -1; a <= LA; a++) {
          const on = a < LA && is[at(a, b)] > 0;
          if (on && s < 0) s = a;
          if (!on && s >= 0) { if (a - s < 3) for (let k = s; k < a; k++) is[at(k, b)] = 0; s = -1; }
        }
        // Carry the corridor across side openings and junctions...
        for (let a = 0, prev = -1; a <= LA; a++) {
          if (a === LA || !hosp[at(a, b)]) { prev = -1; continue; }
          if (is[at(a, b)] !== 1) continue;
          if (prev >= 0 && a - prev - 1 <= 20) for (let m = prev + 1; m < a; m++) is[at(m, b)] = 2;
          prev = a;
        }
        // ...drop short stubs (a lift shaft, a doorway vestibule)...
        for (let a = 0, s = -1; a <= LA; a++) {
          const on = a < LA && is[at(a, b)] > 0;
          if (on && s < 0) s = a;
          if (!on && s >= 0) { if (a - s < 8) for (let k = s; k < a; k++) is[at(k, b)] = 0; s = -1; }
        }
        // ...and run on to the end wall.
        for (let a = 0, s = 0; a <= LA; a++) {
          if (a < LA && hosp[at(a, b)]) continue;
          let first = -1, last = -1;
          for (let k = s; k < a; k++) if (is[at(k, b)]) { if (first < 0) first = k; last = k; }
          if (first >= 0 && first - s <= 5) for (let m = s; m < first; m++) is[at(m, b)] = 2;
          if (last >= 0 && a - 1 - last <= 5) for (let m = last + 1; m < a; m++) is[at(m, b)] = 2;
          s = a + 1;
        }
      }
      for (let i = 0; i < n; i++) if (is[i]) corr[i] |= bit;
    }
  }
  const wallAt = (x: number, z: number): boolean => x >= 0 && z >= 0 && x < W && z < H && def.floor[z * W + x] === F.NONE;
  const CORR_MINOR = 0.8; // how often a slim item is tucked in after a big one
  /** The corridor rhythm: a big item every fourth tile on each wall (the two walls half a step apart), slim ones between. */
  function corridorItem(x: number, z: number, i: number, narrow: number): boolean {
    if (narrow < 2) return false;
    for (let di = 0; di < 4; di++) {
      const [dx, dz] = DIRS[di];
      if (!(corr[i] & (dz ? CX : CZ)) || !wallAt(x - dx, z - dz)) continue;
      const a = dz ? x : z, line = dz ? z - dz : x - dx, side = di & 1, k = (a + side * 2) & 3;
      const major = k === 0;
      if (!major && !(k === 1 && hash2(a * 7 + side, line * 13 + 5) < CORR_MINOR * DENSITY)) continue;
      const slim = narrow === 2 ? 0.5 : narrow === 3 ? 0.8 : 9;
      let list = (major ? K_CORR_BIG : K_CORR_SMALL).filter((it) => it.d <= slim);
      if (!list.length) list = K_CORR_SMALL.filter((it) => it.d <= slim);
      if (!list.length) continue;
      const item = list[((a >> 2) * 3 + side * 5 + line * 7 + (major ? 0 : 2)) % list.length];
      const off = 1 - item.d / 2 - 0.09, j = hash2(x * 3 + 9, z * 5 + 1) - 0.5, sh = major ? j * 0.12 : -0.4 + j * 0.2;
      const px = (x + 0.5) * T - dx * off + (dz ? sh : 0), pz = (z + 0.5) * T - dz * off + (dx ? sh : 0);
      if (item.h > 1.2 && lampNear(px, pz, 0.8)) continue;
      begin(px, pz, Math.atan2(dx, dz));
      item.f(hash2(x * 41 + 1, z * 43 + 3));
      faceItem.set(i * 4 + di, item.h); stats.items++;
      return true;
    }
    return false;
  }
  /** Things dropped in a hurry: charts, a clipboard, a stethoscope. All flat on the floor. */
  function corridorLitter(x: number, z: number): void {
    const r = hash2(x * 19 + 31, z * 13 + 47), p = 0.13 * DENSITY;
    if (r > p) return;
    const q = hash2(x * 11 + 3, z * 19 + 7), k = r / p;
    begin((x + 0.2 + hash2(x * 5 + 1, z * 3 + 2) * 0.6) * T, (z + 0.2 + hash2(x * 3 + 4, z * 7 + 6) * 0.6) * T, q * 6.283); stats.scatter++;
    const clipboard = (cx: number, cz: number, rot: number) => {
      B(0x8a5a3c, cx, 0.014, cz, 0.25, 0.028, 0.34, 1, 0, rot); sheet(PAPER, cx, cz + 0.015, 0.2, 0.26, rot, false, 0.032);
      B(STEEL, cx - Math.sin(rot) * 0.14, 0.04, cz - Math.cos(rot) * 0.14, 0.11, 0.025, 0.04, 0, 0, rot);
    };
    if (k < 0.46) {
      // Patient charts: sheets with a coloured header strip.
      for (let b = 0; b < 2 + Math.floor(q * 3); b++) {
        const sx = (R(b) - 0.5) * 0.9, sz = (R(b + 4) - 0.5) * 0.9, rot = R(b + 8) * 6;
        sheet(b % 3 === 2 ? 0xf4ecd8 : PAPER, sx, sz, 0.21, 0.3, rot);
        if (b % 2 === 0) sheet(pick(R(b + 12), [0x74c0fc, 0xff8fa3, 0x8ce99a, 0xffd43b]), sx - Math.sin(rot) * 0.11, sz - Math.cos(rot) * 0.11, 0.19, 0.05, rot, false, 0.034);
      }
    } else if (k < 0.66) { clipboard(0, 0, q * 5); if (q < 0.5) sheet(PAPER, 0.34, 0.2, 0.21, 0.3, q * 9); }
    else if (k < 0.8) {
      // A dropped stethoscope beside its owner's clipboard.
      clipboard(-0.3, 0.1, q * 5);
      B(DARK, 0.2, 0.012, 0, 0.36, 0.024, 0.028, 0); B(DARK, 0.46, 0.012, 0.07, 0.24, 0.024, 0.026, 0, 0, -0.6); B(DARK, 0.46, 0.012, -0.07, 0.24, 0.024, 0.026, 0, 0, 0.6);
      C(STEEL, 0, 0.014, 0, 0.045, 0.028, 0);
    } else if (k < 0.92) { C(pick(q, [0xe8413c, 0xfff1e0, 0x74c0fc]), 0, 0.045, 0, 0.045, 0.13, 0, HP); sheet(0xd8ecf5, 0.2, 0.1, 0.2, 0.14, q * 5, false, 0.02); }
    else for (let b = 0; b < 3; b++) sheet(pick(R(b), PASTEL), (R(b + 2) - 0.5) * 0.7, (R(b + 5) - 0.5) * 0.7, 0.16, 0.11, R(b + 8) * 6);
  }

  // ------------------------------------------------------------ wall faces
  // Same order as arch.ts: the direction from a wall cell out to the open cell it faces.
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const PLAIN = 0, WINDOW = 1, DOOR = 2, NATURAL = 3;
  /** What arch.ts drew on the face of wall cell (wx, wz) looking out along DIRS[di]. Mirrors its hashes. */
  function faceKind(wx: number, wz: number, di: number, nf: number): number {
    if (isIndoor(nf)) return PLAIN;
    if (def.wallKind[wz * W + wx] !== WALL.BUILDING) return NATURAL;
    const [dx, dz] = DIRS[di], h = def.wallH[wz * W + wx];
    const street = nf === F.ASPHALT || nf === F.SIDEWALK, bx = Math.floor(wx / 3), bz = Math.floor(wz / 3);
    const along = (wx * Math.abs(dz) + wz * Math.abs(dx)) % 3;
    if (street && h >= 6.5 && hash2(bx * 3 + di, bz * 5 + 7) < 0.6) return along === 1 && hash2(bx + di, bz) < 0.5 ? DOOR : WINDOW;
    if (h >= 4 && along === 1 && hash2(bx * 5 + di, bz * 3 + 1) < 0.35) return DOOR;
    return PLAIN;
  }
  /** Height of the tallest floor item standing against each wall face (key: open cell index * 4 + di). */
  const faceItem = new Map<number, number>();

  const kitFor = (f: number, i: number, wallKind: number): Item[] => {
    const h = hint[i];
    if (f === F.SAFE) return K_SAFE;
    if (isIndoor(f)) {
      if (K_HINT[h]) return K_HINT[h];
      if (f === F.TILES) return chap === 2 ? K_HOSP : K_LAB;
      return chap === 2 ? K_MALL : chap === 3 ? K_PLANT : chap === 4 ? K_HOME : K_SHOP;
    }
    if (f === F.ASPHALT || f === F.SIDEWALK) return chap === 3 ? K_INDUS : h === HINT.PARKING ? K_PARKING : chap === 4 ? K_SUBURB_ST : K_STREET;
    if (f === F.CONCRETE) return h === HINT.PARKING && chap !== 3 ? K_PARKING : K_INDUS;
    if (chap === 3) return K_RAIL;
    if (chap !== 4) return K_PARK;
    return wallKind === WALL.BUILDING || wallKind === WALL.FENCE ? K_YARD : K_FOREST;
  };

  // ----------------------------------------------------------- open scatter
  const LEAF = [0xffa94d, 0xffd43b, 0xe8793c, 0xc98f6a];
  function scatter(f: number, x: number, z: number, i: number, r: number, edge: boolean): void {
    const q = hash2(x * 11 + 3, z * 19 + 7), px = (x + 0.2 + hash2(x * 5 + 1, z * 3 + 2) * 0.6) * T, pz = (z + 0.2 + hash2(x * 3 + 4, z * 7 + 6) * 0.6) * T;
    const yaw = q * 6.283;
    if (f === F.GRASS || f === F.DIRT) {
      const grass = f === F.GRASS, forest = chap === 4, p = (grass ? 0.3 : chap === 3 ? 0.1 : 0.2) * DENSITY;
      if (r > p) return;
      begin(px, pz, yaw); stats.scatter++;
      const k = r / p;
      if (k < (grass ? 0.56 : 0.3)) {
        // Tuft: a few blades, sometimes with flowers.
        const c = grass ? 0x7fcf8a : 0x8fae6a, nb = 3 + Math.floor(q * 3);
        for (let b = 0; b < nb; b++) { const a = b * 2.2 + q * 6; G(b % 2 ? c : 0x4f9f62, Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0.035, 0.2 + R(b) * 0.2, Math.sin(a) * 0.3, -Math.cos(a) * 0.3); }
        if (grass && q < 0.4) for (let b = 0; b < 3; b++) { const fx = (R(b + 6) - 0.5) * 0.5, fz = (R(b + 9) - 0.5) * 0.5; G(0x4f9f62, fx, fz, 0.012, 0.2); prim(BLADE, pick(R(b + 3), [0xfff1c9, 0xffb3d1, 0xffd43b, 0xc9b8ff]), fx, 0.27, fz, 0.06, 0.09, 0.06, 0, 0, b, Math.PI); }
      } else if (k < 0.72 && (forest || chap === 1)) {
        for (let b = 0; b < 3 + Math.floor(q * 4); b++) sheet(pick(R(b), LEAF), (R(b + 4) - 0.5) * 1.1, (R(b + 9) - 0.5) * 1.1, 0.13, 0.08, R(b + 14) * 6, false, 0.022);
      } else if (k < 0.82) { SP(0x8a8197, 0, 0.05, 0, 0.08 + q * 0.035, 0.07, 0.09); } // pebble
      else if (k < 0.88 && forest) { C(CREAM, 0, 0.06, 0, 0.03, 0.12, 0); D(q < 0.6 ? 0xe8413c : 0xc98f6a, 0, 0.11, 0, 0.1, 0.08, 0.1, 0); }
      else if (k < 0.93 && forest && !grass) { prim(BLADE, 0x8a5a3c, 0, 0.05, 0, 0.05, 0.14, 0.05, 0, HP * 0.9); prim(BLADE, 0x7a4f35, 0.3, 0.05, 0.2, 0.045, 0.12, 0.045, 0, HP * 0.9, 1); } // pinecones
      else if (forest && !edge) fern.f(q);
      else for (let b = 0; b < 3; b++) { const a = b * 2.2 + q * 6; G(0x5aa86a, Math.cos(a) * 0.08, Math.sin(a) * 0.08, 0.03, 0.18 + R(b) * 0.1, Math.sin(a) * 0.3, -Math.cos(a) * 0.3); }
      return;
    }
    if (f === F.SAFE) return;
    const indoor = isIndoor(f), p = (indoor ? 0.06 : f === F.CONCRETE ? 0.055 : 0.07) * DENSITY;
    if (r > p) return;
    begin(px, pz, yaw); stats.scatter++;
    const k = r / p, h = hint[i];
    if (k < 0.42) {
      // Dropped sheets (the ground texture has a few too; these catch the light).
      for (let b = 0; b < 2 + Math.floor(q * 3); b++) sheet(b % 3 === 2 ? 0xf4ecd8 : PAPER, (R(b) - 0.5) * 0.9, (R(b + 4) - 0.5) * 0.9, 0.21, 0.3, R(b + 8) * 6);
    } else if (indoor) {
      if (k < 0.5 && (chap === 2 || h === HINT.TOYS) && f !== F.TILES) shopBags.f(q * 0.49);
      else if (k < 0.48 && f === F.TILES && chap === 2) wetSign.f(q);
      else if (k < 0.64) { C(pick(q, [0xe8413c, 0xfff1e0, 0x74c0fc]), 0, 0.045, 0, 0.045, 0.13, 0, HP); sheet(0xd8ecf5, 0.2, 0.1, 0.2, 0.14, q * 5, false, 0.02); } // dropped cup and a spill
      else if (k < 0.7 && (chap === 3 || h === HINT.PARKING)) cone.f(q);
      else if (k < 0.74 && chap === 4) backpack.f(q);
      else if (k < 0.84) cardboard.f(q);
      else for (let b = 0; b < 3; b++) sheet(pick(R(b), PASTEL), (R(b + 2) - 0.5) * 0.7, (R(b + 5) - 0.5) * 0.7, 0.16, 0.11, R(b + 8) * 6); // flyers
    } else {
      if (k < 0.5 && chap === 1) umbrella.f(q);
      else if (k < 0.52 && chap === 4) for (let b = 0; b < 5; b++) sheet(pick(R(b), LEAF), (R(b + 4) - 0.5) * 1.1, (R(b + 9) - 0.5) * 1.1, 0.13, 0.08, R(b + 14) * 6, false, 0.022);
      else if (k < 0.57) cone.f(q * 0.5);
      else if (k < 0.7) cardboard.f(q);
      else if (k < 0.8) { C(pick(q, [0xe8413c, 0xc9c6d6, 0x8ce99a]), 0, 0.04, 0, 0.04, 0.12, 0, HP); C(0xc9c6d6, 0.25, 0.04, 0.2, 0.04, 0.12, 0, HP, 0.8); } // cans
      else if (k < 0.88 && chap === 3) { B(STEEL, 0, 0.03, 0, 0.5, 0.05, 0.08, 1, 0, 0.4); B(0x6b4a34, 0.2, 0.05, 0.3, 0.8, 0.1, 0.16, 1, 0, -0.5); } // scrap
      else if (k < 0.91 && chap !== 3) bags.f(0.6 + q * 0.4);
      else for (let b = 0; b < 3; b++) sheet(pick(R(b), PASTEL), (R(b + 2) - 0.5) * 0.7, (R(b + 5) - 0.5) * 0.7, 0.16, 0.11, R(b + 8) * 6);
    }
  }

  // --------------------------------------------------------- pass 1: floors
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const i = z * W + x, f = def.floor[i];
    if (f === F.NONE || f === F.WATER || def.solid[i] || def.doorCell[i] >= 0 || mask[i] & NO_FLOOR) continue;
    const walls: number[] = [], props: number[] = [];
    for (let di = 0; di < 4; di++) {
      // Looking from the open cell towards DIRS[di]'s wall cell means stepping against the face direction.
      const wx = x - DIRS[di][0], wz = z - DIRS[di][1];
      if (wx < 0 || wz < 0 || wx >= W || wz >= H) continue;
      const g = def.floor[wz * W + wx];
      if (g === F.NONE) walls.push(di); else if (def.propCell[wz * W + wx]) props.push(di);
    }
    const narrow = Math.min(runX[i], runZ[i]), r = hash2(x * 7 + 13, z * 11 + 29), r2 = hash2(x * 17 + 5, z * 23 + 3);
    const nature = f === F.GRASS || f === F.DIRT;
    let placed = false;
    const tri0 = triCount;
    if (corr[i]) {
      // Hospital corridor: its own rhythm instead of the random kit.
      if (!corridorItem(x, z, i, narrow) && narrow >= 2) { corridorLitter(x, z); stats.trisScatter += triCount - tri0; }
      continue;
    }
    if (walls.length && narrow >= 2) {
      const corner = walls.length >= 2 && !(walls.includes(0) && walls.includes(1) && walls.length === 2) && !(walls.includes(2) && walls.includes(3) && walls.length === 2);
      const base = f === F.SAFE ? 0.5 : nature ? 0.17 : isIndoor(f) ? 0.16 : chap === 1 ? 0.29 : 0.2; // ch1 is the smallest map: spend its spare budget on the streets
      if (r < base * (corner ? 1.8 : 1) * (narrow === 2 ? 0.5 : 1) * DENSITY) {
        const di = walls[Math.floor(r2 * walls.length)], [dx, dz] = DIRS[di], wx = x - dx, wz = z - dz;
        const fk = faceKind(wx, wz, di, f), wk = def.wallKind[wz * W + wx];
        if (fk !== DOOR) {
          let list = kitFor(f, i, wk);
          const lowOnly = fk === WINDOW || wk === WALL.FENCE, slim = narrow === 2 ? 0.45 : narrow === 3 ? 0.65 : 9;
          if (lowOnly || slim < 9) list = list.filter((it) => (!lowOnly || it.h <= 1.1) && it.d <= slim);
          if (list.length) {
            const item = list[Math.floor(hash2(x * 29 + 7, z * 31 + 17) * list.length)];
            const off = 1 - item.d / 2 - (isIndoor(f) ? 0.09 : 0.06), u = (hash2(x * 3 + 9, z * 5 + 1) - 0.5) * 0.3;
            const px = (x + 0.5) * T - dx * off - dz * u, pz = (z + 0.5) * T - dz * off + dx * u;
            if (!(item.h > 1.2 && lampNear(px, pz, 0.8)) && !(walls.length > 1 && item.d > 0.8 && !corner)) {
              begin(px, pz, Math.atan2(dx, dz) + (item.h < 1 ? (r2 - 0.5) * 0.3 : 0));
              item.f(hash2(x * 41 + 1, z * 43 + 3));
              faceItem.set(i * 4 + di, item.h); stats.items++; placed = true;
            }
          }
        }
      }
    } else if (!walls.length && props.length && narrow >= 3 && r < 0.26 * DENSITY) {
      // Beside a car, crate or counter: low junk only.
      const di = props[Math.floor(r2 * props.length)], [dx, dz] = DIRS[di];
      const list = kitFor(f, i, WALL.BUILDING).filter((it) => it.h <= 1.1 && it.d <= 0.7);
      if (list.length) {
        const item = list[Math.floor(hash2(x * 29 + 7, z * 31 + 17) * list.length)];
        const px = (x + 0.5) * T - dx * 0.5 + dz * (r2 - 0.5) * 0.8, pz = (z + 0.5) * T - dz * 0.5 + dx * (r2 - 0.5) * 0.8;
        if (!lampNear(px, pz, 0.6)) { begin(px, pz, Math.atan2(dx, dz) + (r2 - 0.5) * 1.2); item.f(hash2(x * 41 + 1, z * 43 + 3)); stats.items++; placed = true; }
      }
    }
    // Islands: a few low things out in the open of big halls, plazas and yards (never tall, so never cover).
    if (!walls.length && !props.length && narrow >= 7 && f !== F.SAFE && (x * 3 + z * 7) % 23 === 0 && r < 0.45 * DENSITY) {
      let clear = true;
      for (const [ax, az] of [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, 1], [1, -1], [-1, -1]]) { const g = floorOf(x + ax, z + az); if (g === F.NONE || g === F.WATER || def.solid[(z + az) * W + x + ax]) clear = false; }
      const road = f === F.ASPHALT && chap !== 3;
      const list = road ? K_ROAD : kitFor(f, i, WALL.HEDGE).filter((it) => it.h <= 1.1 && it.d >= 0.36);
      if (clear && list.length && !lampNear((x + 0.5) * T, (z + 0.5) * T, 1.2)) {
        begin((x + 0.5) * T, (z + 0.5) * T, Math.floor(r2 * 4) * HP + (r2 - 0.5) * 0.5);
        list[Math.floor(hash2(x * 29 + 7, z * 31 + 17) * list.length)].f(hash2(x * 41 + 1, z * 43 + 3)); stats.items++; placed = true;
      }
    }
    stats.trisItems += triCount - tri0;
    const tri1 = triCount;
    // Open-floor litter and undergrowth. Paved cells with an item keep clear; grass grows everywhere.
    if ((!placed || nature) && narrow >= 3) scatter(f, x, z, i, hash2(x * 19 + 31, z * 13 + 47), walls.length > 0);
    stats.trisScatter += triCount - tri1;
    // Banners hung across big indoor halls, well above head height.
    if ((f === F.INTERIOR || f === F.WOOD) && chap === 2 && runX[i] >= 9 && runZ[i] >= 9 && !walls.length && x % 5 === 2 && z % 4 === 1 && hash2(x * 3 + 1, z * 3 + 2) < 0.5 && !lampNear((x + 0.5) * T, (z + 0.5) * T, 1.3)) {
      let clear = true;
      for (const [ax, az] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) if (floorOf(x + ax, z + az) !== f) clear = false;
      if (clear) {
        begin((x + 0.5) * T, (z + 0.5) * T, r < 0.5 ? 0 : HP);
        const c = pick(r2, PASTEL), y = CEIL_H - 0.95;
        B(c, 0, y, 0, 1.5, 0.9, 0.03); B(CREAM, 0, y + 0.22, 0, 1.1, 0.14, 0.04, 0); B(CREAM, 0, y - 0.05, 0, 0.7, 0.08, 0.04, 0);
        for (const s of [-1, 1]) prim(BLADE, c, s * 0.38, y - 0.45, 0, 0.37, 0.3, 0.015, 0, 0, 0, Math.PI);
        for (const s of [-1, 1]) B(DARK, s * 0.65, CEIL_H - 0.25, 0, 0.015, 0.5, 0.015, 0);
        stats.items++;
      }
    }
  }
  // Kerbside furniture: low things only, since this is away from any wall.
  const K_KERB = [hydrant, bollard, bollard, cone, bin, newsbox, bags];
  if (chap !== 3) for (let z = 1; z < H - 1; z++) for (let x = 1; x < W - 1; x++) {
    const i = z * W + x;
    if (def.floor[i] !== F.SIDEWALK || def.solid[i] || mask[i] & NO_FLOOR || Math.min(runX[i], runZ[i]) < 3 || hash2(x * 23 + 9, z * 29 + 5) > (chap === 1 ? 0.12 : 0.075) * DENSITY) continue;
    for (const [dx, dz] of DIRS) if (def.floor[(z + dz) * W + x + dx] === F.ASPHALT && def.floor[(z - dz) * W + x - dx] !== F.NONE) {
      const px = (x + 0.5 + dx * 0.24) * T, pz = (z + 0.5 + dz * 0.24) * T;
      if (lampNear(px, pz, 0.9)) break;
      begin(px, pz, Math.atan2(-dx, -dz)); pick(hash2(x * 7 + 1, z * 3 + 8), K_KERB).f(hash2(x, z)); stats.items++;
      break;
    }
  }
  // Mailboxes down suburban sidewalks, on the lawn side.
  if (chap === 4) for (let z = 1; z < H - 1; z++) for (let x = 1; x < W - 1; x++) {
    const i = z * W + x;
    if (def.floor[i] !== F.SIDEWALK || def.solid[i] || mask[i] & NO_FLOOR || (x + z * 3) % 7 !== 0) continue;
    for (const [dx, dz] of DIRS) if (def.floor[(z + dz) * W + x + dx] === F.GRASS && def.floor[(z - dz) * W + x - dx] !== F.GRASS) {
      const px = (x + 0.5 + dx * 0.36) * T, pz = (z + 0.5 + dz * 0.36) * T;
      if (lampNear(px, pz, 0.8)) break;
      begin(px, pz, Math.atan2(-dx, -dz)); mailbox.f(hash2(x, z)); stats.items++;
      break;
    }
  }

  stats.trisItems = triCount - stats.trisScatter;
  // ---------------------------------------------------------- pass 2: walls
  const NEONS = [0xff7ac8, 0x5ff0e0, 0xffd45e, 0x9d8cff, 0xff8a6a];
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const i = z * W + x, f = def.floor[i];
    if (f === F.NONE || f === F.WATER || def.propCell[i] || mask[i] & NO_WALL) continue;
    for (let di = 0; di < 4; di++) {
      const [dx, dz] = DIRS[di], wx = x - dx, wz = z - dz;
      if (wx < 0 || wz < 0 || wx >= W || wz >= H || def.floor[wz * W + wx] !== F.NONE) continue;
      const fk = faceKind(wx, wz, di, f);
      if (fk === DOOR || fk === WINDOW || fk === NATURAL) continue;
      const indoor = isIndoor(f), h = indoor ? CEIL_H : def.wallH[wz * W + wx];
      if (h < 2.4) continue;
      const r = hash2(x * 13 + di * 7 + 3, z * 17 + di * 3 + 11), q = hash2(x * 5 + di + 23, z * 9 + di * 5 + 1);
      const mx = (wx + 0.5 + dx * 0.5) * T, mz = (wz + 0.5 + dz * 0.5) * T, tx = -dz, tz = dx, nrm: V3 = [dx, 0, dz];
      const below = faceItem.get(i * 4 + di) ?? 0;
      begin(mx, mz, Math.atan2(dx, dz));
      // Face frame: u runs along the wall (positive = the viewer's left), y up, o out of the wall.
      const P = (u: number, y: number, o: number) => [mx + tx * u + dx * o, y, mz + tz * u + dz * o];
      const rq = (c: number, u: number, y: number, hw: number, hh: number, o = 0.05, ang = 0) => {
        const cs = Math.cos(ang), sn = Math.sin(ang), p: number[] = [];
        for (const [a, b] of [[hw, -hh], [-hw, -hh], [-hw, hh], [hw, hh]]) p.push(...P(u + a * cs - b * sn, y + a * sn + b * cs, o));
        quad(S, rgb(c), nrm, p); triCount += 2;
      };
      /** A flat card with an ink border behind it. */
      const card = (c: number, u: number, y: number, hw: number, hh: number, ang = 0) => { rq(0x1a1226, u, y, hw + 0.022, hh + 0.022, 0.03, ang); rq(c, u, y, hw, hh, 0.048, ang); };
      /** A chalk/paint stroke between two points given in the viewer's frame (x to the right). */
      const stroke = (c: number, x0: number, y0: number, x1: number, y1: number, w = 0.035, o = 0.03) => rq(c, -(x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(x1 - x0, y1 - y0) / 2 + w * 0.4, w / 2, o, Math.atan2(y1 - y0, -(x1 - x0)));
      const glyphs: Record<string, number[][]> = {
        S: [[1, 1, 0, 1], [0, 1, 0, 0.5], [0, 0.5, 1, 0.5], [1, 0.5, 1, 0], [1, 0, 0, 0]], A: [[0, 0, 0.5, 1], [0.5, 1, 1, 0], [0.22, 0.4, 0.78, 0.4]],
        F: [[0, 0, 0, 1], [0, 1, 1, 1], [0, 0.5, 0.7, 0.5]], E: [[0, 0, 0, 1], [0, 1, 1, 1], [0, 0.5, 0.7, 0.5], [0, 0, 1, 0]], Z: [[0, 1, 1, 1], [1, 1, 0, 0], [0, 0, 1, 0]],
        O: [[0, 0, 0, 1], [0, 1, 1, 1], [1, 1, 1, 0], [1, 0, 0, 0]], K: [[0, 0, 0, 1], [0, 0.5, 1, 1], [0, 0.5, 1, 0]],
        W: [[0, 1, 0.25, 0], [0.25, 0, 0.5, 0.6], [0.5, 0.6, 0.75, 0], [0.75, 0, 1, 1]], R: [[0, 0, 0, 1], [0, 1, 1, 1], [1, 1, 1, 0.5], [1, 0.5, 0, 0.5], [0.4, 0.5, 1, 0]],
        D: [[0, 0, 0, 1], [0, 1, 0.7, 1], [0.7, 1, 1, 0.7], [1, 0.7, 1, 0.3], [1, 0.3, 0.7, 0], [0.7, 0, 0, 0]], 3: [[0, 1, 1, 1], [1, 1, 1, 0], [1, 0, 0, 0], [0.3, 0.5, 1, 0.5]],
        '<': [[0.5, 0, 0, 0.6], [0.5, 0, 1, 0.6], [0, 0.6, 0.25, 0.95], [0.25, 0.95, 0.5, 0.65], [0.5, 0.65, 0.75, 0.95], [0.75, 0.95, 1, 0.6]], // heart
      };
      const write = (text: string, c: number, x0: number, y0: number, size: number, w = 0.035, o = 0.03) => {
        let cx = x0;
        for (const ch of text) { for (const [a, b, c2, d2] of glyphs[ch] ?? []) stroke(c, cx + a * size * 0.6, y0 + b * size, cx + c2 * size * 0.6, y0 + d2 * size, w, o); cx += size * (ch === ' ' ? 0.5 : 0.85); }
      };
      const poster = (u: number, y: number) => {
        const c = pick(q, PASTEL), ang = (hash2(x + di, z * 3) - 0.5) * 0.14, hw = 0.3, hh = 0.42;
        card(c, u, y, hw, hh, ang); rq(CREAM, u, y + 0.2, hw * 0.75, 0.08, 0.055, ang); rq(pick(1 - q, PASTEL), u, y - 0.1, hw * 0.6, 0.16, 0.055, ang);
      };
      const picture = (u: number, y: number) => {
        const hw = 0.3 + q * 0.12, hh = 0.24;
        B(q < 0.5 ? 0x8a5a3c : 0xc9a04a, -u, y, 0.03, hw * 2 + 0.1, hh * 2 + 0.1, 0.05);
        rq(pick(r * 7 % 1, [0xbfe6ff, 0xffd9a0, 0xc9b8ff]), u, y, hw, hh, 0.062); rq(pick(q, [0x5fbb72, 0x8f6fb0, 0xe8793c]), u, y - hh * 0.55, hw, hh * 0.45, 0.066); rq(0xfff1c9, u + hw * 0.4, y + hh * 0.4, 0.06, 0.06, 0.066, 0.78);
      };
      const clock = (u: number, y: number) => {
        prim(CYL, PAPER, -u, y, 0.03, 0.22, 0.05, 0.22, 2, HP);
        rq(0x1a1226, u, y + 0.07, 0.014, 0.08, 0.062); rq(0x1a1226, u - 0.055, y, 0.06, 0.016, 0.062); // stopped at 3:00
      };
      const vent = (u: number, y: number) => { B(0x8f93a8, -u, y, 0.03, 0.66, 0.4, 0.06); for (let k = 0; k < 3; k++) rq(DARK, u, y - 0.1 + k * 0.1, 0.27, 0.018, 0.064); };
      const fuseBox = (u: number, y: number) => {
        B(0x6f7f9a, -u, y, 0.07, 0.42, 0.56, 0.14); rq(0xffd43b, u, y + 0.08, 0.08, 0.08, 0.144); rq(DARK, u - 0.14, y - 0.05, 0.015, 0.05, 0.144);
        const top = indoor ? h - 0.45 : 2.6; B(0x54506e, -u, (y + 0.28 + top) / 2, 0.04, 0.05, top - y - 0.28, 0.05, 0);
      };
      const extinguisher = (u: number) => { rq(CREAM, u, 1.2, 0.13, 0.3, 0.02); C(0xe8413c, -u, 1.16, 0.12, 0.085, 0.44); B(DARK, -u + 0.03, 1.43, 0.12, 0.12, 0.08, 0.05, 0); };
      const sanitiser = (u: number) => { B(PAPER, -u, 1.42, 0.06, 0.16, 0.26, 0.11); rq(0x39c5bb, u, 1.42, 0.05, 0.05, 0.118); B(0x8f93a8, -u, 1.26, 0.09, 0.07, 0.04, 0.1, 0); };
      const board = (u: number, y: number) => {
        B(0x8a5a3c, -u, y, 0.025, 1.2, 0.8, 0.04); rq(0xd9b98a, u, y, 0.55, 0.35, 0.05);
        for (let k = 0; k < 5; k++) { const a = hash2(x * 3 + k, z + di), b = hash2(x + k * 5, z * 7 + di); rq(pick(a, [PAPER, 0xfff3bf, 0xffc9d6, 0xbfeaff, 0xd3f9d8]), u - 0.42 + k * 0.21, y + (b - 0.5) * 0.3, 0.085, 0.11, 0.056, (a - 0.5) * 0.4); }
      };
      const signPlate = (u: number, y: number, kind: number) => {
        if (kind === 0) { card(0xffd43b, u, y, 0.26, 0.26); stroke(0x1a1226, u * -1 - 0.14, y - 0.12, u * -1, y + 0.14, 0.04, 0.055); stroke(0x1a1226, u * -1, y + 0.14, u * -1 + 0.14, y - 0.12, 0.04, 0.055); stroke(0x1a1226, u * -1 - 0.14, y - 0.12, u * -1 + 0.14, y - 0.12, 0.04, 0.055); } // hazard triangle
        else if (kind === 1) { card(0x4fa36a, u, y, 0.34, 0.15); rq(PAPER, u + 0.1, y, 0.14, 0.035, 0.055); rq(PAPER, u - 0.16, y, 0.07, 0.07, 0.055, 0.78); } // exit arrow
        else if (kind === 2) { card(PAPER, u, y, 0.24, 0.24); rq(0x39c5bb, u, y, 0.16, 0.055, 0.055); rq(0x39c5bb, u, y, 0.055, 0.16, 0.055); } // cross
        else { card(0xe8413c, u, y, 0.3, 0.12); rq(PAPER, u, y, 0.22, 0.03, 0.055); } // red notice
      };
      const graffiti = (u: number, y: number) => {
        const c = pick(q, NEONS), k = hash2(x * 7 + di, z * 3 + 5);
        if (k < 0.45) { write('Z', c, -u - 0.4, y - 0.1, 0.36, 0.06); write('Z', c, -u - 0.05, y + 0.05, 0.5, 0.07); write('Z', pick(1 - q, NEONS), -u + 0.42, y + 0.3, 0.3, 0.05); }
        else if (k < 0.7) { write('<', c, -u - 0.3, y - 0.2, 0.6, 0.07); }
        else { for (let s = 0; s < 4; s++) stroke(c, -u - 0.5 + s * 0.26, y - 0.25 + (s % 2) * 0.5, -u - 0.24 + s * 0.26, y + 0.25 - (s % 2) * 0.5, 0.07); stroke(pick(1 - q, NEONS), -u - 0.55, y - 0.36, -u + 0.55, y - 0.36, 0.05); }
        if (k > 0.8 || k < 0.1) rq(c, u + 0.2, y - 0.5, 0.02, 0.14, 0.03); // a drip
      };
      const pipeRun = (y: number, c: number) => { prim(CYL_S, c, 0, y, 0.1, 0.06, 2, 0.06, 2, 0, 0, HP); if ((x * Math.abs(tx) + z * Math.abs(tz)) % 3 === 0) B(DARK, 0, y, 0.07, 0.07, 0.17, 0.14, 0); };

      if (corr[i] & (dz ? CX : CZ)) {
        // Hospital corridor wall: a fixed rhythm of fittings instead of the random scatter.
        const a = dz ? x : z, side = di & 1, b = a + side * 3 + (dz ? wz : wx), m = b % 6, g = Math.floor(b / 6);
        // A side opening next door gets a room-number plaque on the near edge of this panel.
        let open = 0;
        for (const s of [-1, 1]) if (!wallAt(wx + (dz ? s : 0), wz + (dz ? 0 : s)) && !(corr[i + (dz ? s : s * W)] & (dz ? CZ : CX))) open = s * (dz ? tx : tz);
        if (open) {
          const pu = open * 0.66;
          card(PAPER, pu, 1.62, 0.2, 0.12); rq(pick(q, [0x39c5bb, 0xff8fa3, 0x74c0fc, 0xffa94d]), pu, 1.7, 0.2, 0.04, 0.055);
          write('3' + pick(r, ['OS', 'Z3', 'SO', '3Z', 'OZ']), 0x1a1226, -pu - 0.14, 1.53, 0.1, 0.02, 0.056);
          stats.wall++; continue;
        }
        const cu = (q - 0.5) * 0.3;
        if (m === 0) { if (below <= 1.05) sanitiser(cu); else vent(cu, 3.1); }
        else if (m === 1) {
          if (g % 2 === 0) {
            // Directional sign pointing along the wall to the nearest ward (floor 3) or the ER (ground floor).
            let to: { x: number; z: number } | null = null, best = 1e9, ward = false;
            for (const l of def.labels) {
              const w = /^WARD 3/.test(l.text) && l.z - z > -10 && l.z - z < 38, er = l.text === 'ER' && Math.abs(l.z - z) < 40 && Math.abs(l.x - x) < 70;
              const d = Math.hypot(l.x - x, l.z - z) - (w ? 1000 : 0);
              if ((w || er) && d < best) { best = d; to = l; ward = w; }
            }
            if (to) {
              const sd = (to.x - x - 0.5) * tx + (to.z - z - 0.5) * tz, left = Math.abs(sd) > 2 ? sd > 0 : q < 0.5;
              const text = ward ? 'WARD 3' : 'ER', tw = ward ? 0.7 : 0.24, x0 = -(tw + 0.3) / 2 + (left ? 0.3 : 0), xa = left ? x0 - 0.3 : x0 + tw + 0.06, hd = left ? 1 : -1, tipx = left ? xa : xa + 0.2;
              card(ward ? 0x3f7cc4 : 0xe8413c, 0, 2.42, (tw + 0.3) / 2 + 0.1, 0.14);
              write(text, PAPER, x0, 2.35, 0.14, 0.026, 0.056);
              stroke(PAPER, xa, 2.42, xa + 0.2, 2.42, 0.03, 0.056); stroke(PAPER, tipx, 2.42, tipx + hd * 0.08, 2.49, 0.03, 0.056); stroke(PAPER, tipx, 2.42, tipx + hd * 0.08, 2.35, 0.03, 0.056);
            } else signPlate(cu, 2.9, 1);
          } else if (g % 4 === 1) clock(cu, 2.75); else signPlate(cu, 2.9, 1);
        }
        else if (m === 2) { if (below <= 1.5) { if (g % 2) picture(cu, 1.98); else poster(cu, 1.95); } }
        else if (m === 4) {
          if (below > 1.0) { if (below <= 1.5 && g % 2) board(0, 2.05); }
          else if (g % 3 === 0) board(0, 1.95);
          else if (g % 3 === 1) { B(0xe8413c, -cu, 1.25, 0.06, 0.42, 0.68, 0.12); rq(0xd8f6ff, cu, 1.25, 0.15, 0.27, 0.125); rq(0xc0322e, cu, 1.2, 0.055, 0.17, 0.13); rq(DARK, cu, 1.4, 0.03, 0.035, 0.13); } // extinguisher cabinet
          else { B(0xffd43b, -cu, 1.34, 0.07, 0.24, 0.3, 0.14); B(0xe8413c, -cu, 1.51, 0.07, 0.26, 0.05, 0.16, 0); rq(DARK, cu, 1.32, 0.05, 0.05, 0.145, 0.78); } // sharps box
        }
        else if (m === 5 && q < 0.6) signPlate(cu, below > 1.5 ? 2.7 : 2.05, 2);
        else continue;
        stats.wall++; continue;
      }
      const industrial = chap === 3 || (!indoor && f === F.CONCRETE);
      // Long pipe runs: decided per stretch of wall so neighbouring tiles line up.
      const stretch = hash2(Math.floor((x * Math.abs(tx) + z * Math.abs(tz)) / 6) + di * 31, (x * Math.abs(dx) + z * Math.abs(dz)) * 7 + 5);
      let pipes = false;
      if ((industrial && stretch < 0.3) || (f === F.INTERIOR && chap !== 2 && stretch < 0.12)) {
        pipes = true; pipeRun(indoor ? 3.3 : 2.4, stretch < 0.1 ? 0xb46a4a : 0x8f93a8); if (stretch < 0.15) pipeRun(indoor ? 3.05 : 2.18, 0xffd43b); stats.wall++;
      }
      const u = (q - 0.5) * 0.8;
      if (f === F.SAFE) {
        if (r > 0.55 * DENSITY) continue;
        stats.wall++;
        const chalk = pick(q, [0xfff6e0, 0xfff1c9, 0xbfeaff, 0xffc9d6]);
        if (below > 1.2) { if (r < 0.2) clock(u, 2.9); continue; }
        const k = r / 0.55;
        if (k < 0.28) { write('SAFE', chalk, -0.62, 1.7, 0.42, 0.05); write('<', 0xff8fa3, 0.3, 2.3, 0.3, 0.05); }
        else if (k < 0.42) { for (let s = 0; s < 4; s++) stroke(chalk, -0.3 + s * 0.14, 1.6, -0.3 + s * 0.14 + 0.02, 2.0, 0.04); stroke(chalk, -0.4, 1.66, 0.24, 1.94, 0.04); } // days survived
        else if (k < 0.56) { write('OK', chalk, -0.3, 1.7, 0.4, 0.05); write('<', 0xff8fa3, 0.36, 1.72, 0.3, 0.05); }
        else if (k < 0.7) picture(u, 1.95);
        else if (k < 0.84) poster(u, 1.95);
        else board(0, 1.95);
        continue;
      }
      if (indoor) {
        const p = (f === F.TILES ? 0.3 : 0.26) * DENSITY;
        if (r > p) continue;
        stats.wall++;
        const k = r / p, hi = below > 1.0;
        if (hi) { if (k < 0.35) clock(u, 2.95); else if (k < 0.7) vent(u, 3.1); else signPlate(u, 2.9, 1); continue; }
        if (f === F.TILES) {
          if (k < 0.16) sanitiser(u); else if (k < 0.34) board(0, 1.95); else if (k < 0.46) signPlate(u, 2.0, 2); else if (k < 0.58) extinguisher(u);
          else if (k < 0.7) clock(u, 2.6); else if (k < 0.82) poster(u, 1.95); else if (k < 0.92) signPlate(u, 2.9, 1); else vent(u, 3.1);
        } else if (chap === 3 || hint[i] === HINT.PARKING) {
          if (k < 0.2) fuseBox(u, 1.6); else if (k < 0.4) signPlate(u, 1.9, 0); else if (k < 0.55) extinguisher(u); else if (k < 0.7) vent(u, 3.0);
          else if (k < 0.82) signPlate(u, 2.0, 3); else if (k < 0.92) poster(u, 1.95); else if (!pipes) clock(u, 2.7);
        } else {
          if (k < 0.34) poster(u, 1.95); else if (k < 0.56) picture(u, 1.95); else if (k < 0.66) clock(u, 2.6); else if (k < 0.76) vent(u, 3.1);
          else if (k < 0.84) signPlate(u, 2.9, 1); else if (k < 0.92) extinguisher(u); else if (hint[i] === HINT.BOOKS || hint[i] === HINT.SCHOOL || hint[i] === HINT.OFFICE) board(0, 1.95); else poster(u, 2.0);
        }
        continue;
      }
      // Exterior building wall (plain stretch: no shop window or door here). Windows start at 2.7 m.
      const p = (industrial ? 0.26 : chap === 4 ? 0.1 : 0.3) * DENSITY;
      if (r > p || h < 2.9) continue;
      stats.wall++;
      const k = r / p;
      if (below > 1.2) continue;
      if (industrial) {
        if (k < 0.3) signPlate(u, 1.8, 0); else if (k < 0.48) fuseBox(u, 1.5); else if (k < 0.68) graffiti(u, 1.5); else if (k < 0.8) signPlate(u, 1.9, 3);
        else if (k < 0.9) vent(u, 1.6); else { B(DARK, -u, 1.9, 0.04, 0.05, 0.08, 0.08, 0); for (let s = 0; s < 5; s++) B(s % 2 ? 0x54506e : 0x8f93a8, -u, 1.75 - s * 0.2, 0.05 + (s % 2) * 0.02, 0.05, 0.2, 0.04, 0); } // hanging chain
      } else if (chap === 4) {
        if (k < 0.4) vent(u, 0.7); else if (k < 0.7) fuseBox(u, 1.4); else poster(u, 1.6);
      } else {
        if (k < 0.34) graffiti(u, 1.5); else if (k < 0.62) { poster(u - 0.34, 1.6); if (q < 0.6) poster(u + 0.36, 1.66); } else if (k < 0.74) vent(u, 0.75);
        else if (k < 0.86) fuseBox(u, 1.45); else if (k < 0.93) signPlate(u, 2.0, 3); else { B(0x54506e, -u, 1.25, 0.05, 0.07, 2.5, 0.07, 0); B(DARK, -u, 1.7, 0.06, 0.12, 0.05, 0.1, 0); } // conduit
      }
    }
  }

  // ------------------------------------- pass 3: corridor rails and stripes
  // One beam (or one painted quad) per straight run, cut at chunk edges so culling stays tight.
  if (chap === 2) for (const di of [0, 1, 2, 3]) {
    const [dx, dz] = DIRS[di], bit = dz ? CX : CZ, LA = dz ? W : H, LB = dz ? H : W;
    const cell = (a: number, b: number) => (dz ? b * W + a : a * W + b);
    /** Runs of `ok` cells along line `b`; `fn` gets the inclusive ends and whether each end is cut short by an opening. */
    const runs = (b: number, ok: (a: number, i: number) => boolean, fn: (a0: number, a1: number, e0: boolean, e1: boolean) => void) => {
      for (let a = 0, s = -1, e0 = true; a <= LA; a++) {
        const on = a < LA && ok(a, cell(a, b));
        if (s >= 0 && (!on || a % CHUNK === 0)) { fn(s, a - 1, e0, !on); s = -1; }
        if (on && s < 0) { s = a; e0 = a % CHUNK !== 0 || a === 0 || !ok(a - 1, cell(a - 1, b)); }
      }
    };
    /** World position `a` tiles along line `b`, `o` metres out from the wall face on this side. */
    const place = (a: number, b: number, o: number) => { const pa = a * T, pb = (b + 0.5 - (dx + dz) * 0.5) * T + (dx + dz) * o; return dz ? [pa, pb] : [pb, pa]; };
    const wallSide = (a: number, b: number) => (dz ? wallAt(a, b - dz) : wallAt(b - dx, a));
    for (let b = 0; b < LB; b++) {
      // Handrail at 0.9 m.
      runs(b, (a, i) => (corr[i] & bit) !== 0 && !(mask[i] & NO_WALL) && wallSide(a, b), (a0, a1, e0, e1) => {
        const s0 = a0 * T + (e0 ? 0.14 : 0), s1 = (a1 + 1) * T - (e1 ? 0.14 : 0), [px, pz] = place((s0 + s1) / 2 / T, b, 0);
        begin(px, pz, Math.atan2(dx, dz));
        B(0xe8b98a, 0, 0.92, 0.05, s1 - s0, 0.1, 0.06); stats.wall++;
      });
      // A curtain rail over each room opening, the curtain bunched to one side.
      runs(b, (a, i) => (corr[i] & bit) !== 0 && !(mask[i] & NO_WALL) && !wallSide(a, b) && hosp[i - (dz ? dz * W : dx)] === 1 && !corr[i - (dz ? dz * W : dx)] && def.doorCell[i - (dz ? dz * W : dx)] < 0, (a0, a1, e0, e1) => {
        if (!e0 || !e1 || a1 - a0 > 2 || !wallSide(a0 - 1, b) || !wallSide(a1 + 1, b)) return;
        const len = (a1 - a0 + 1) * T, [px, pz] = place((a0 + a1 + 1) / 2, b, 0), hs = hash2(a0 * 5 + di, b * 3 + 1);
        begin(px, pz, Math.atan2(dx, dz));
        B(STEEL, 0, 2.66, -0.16, len, 0.045, 0.045, 0);
        const cx = (hs < 0.5 ? -1 : 1) * (len / 2 - 0.22), c = pick(hs * 2 % 1, [0x9fe3cf, 0xffc9d6, 0xbfeaff, 0xfff3bf]);
        B(c, cx, 1.6, -0.16, 0.36, 2.08, 0.14); for (const s of [-1, 1]) B(DARK, cx + s * 0.07, 1.6, -0.085, 0.012, 2.0, 0.01, 0);
        stats.wall++;
      });
      // Wayfinding stripes painted down the first lane (one wall only).
      if (!(di & 1)) runs(b, (a, i) => (corr[i] & bit) !== 0 && !(corr[i - (dz ? W : 1)] & bit) && !(mask[i] & NO_PAINT) && !def.propCell[i] && def.doorCell[i] < 0 && hash2(a * 3 + 1, b * 7 + di) > 0.05, (a0, a1) => {
        const len = (a1 - a0 + 1) * T, [px, pz] = place((a0 + a1 + 1) / 2, b, 0), hs = (b + di) % 3;
        begin(px, pz, Math.atan2(dx, dz));
        for (let k = 0; k < 2; k++) sheet([0x39c5bb, 0xff8fa3, 0xffd43b, 0x74c0fc, 0xff8a3c, 0x8ce99a][hs * 2 + k], 0, 1.2 + k * 0.2, len, 0.1, 0, true, 0.024);
      });
    }
  }

  stats.trisWall = triCount - stats.trisItems - stats.trisScatter;
  // ---------------------------------------------------------------- handoff
  for (const c of chunkGeo.values()) {
    batchFor(c.x, c.z).raw(c.s, c.h);
  }
  if (glow.idx.length) glows.push(glow);
  stats.tris = triCount;
  stats.ms = Math.round(performance.now() - t0);
  return stats;
}
