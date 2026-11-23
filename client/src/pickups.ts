// Pickup models: supplies (medkit, vest, ammo), the small medical items and the quest items. Pure
// geometry, so the world (world.ts) and the guide page (tools/guide.ts) draw the very same models.
import { type Geo, box, cylinder, make, merge, inflateBox, inflateSmooth, insideOut, trs, unionHull, trimHulls } from './geo';

const cube = box();
/** Ink for hull geometry drawn by the lit toon material (a touch darker than INK, since lights add to it). */
export const INK_LIT = 0x150f1f;

// Pickup models are one mesh each, shared by every pickup of that kind: the toon parts plus their
// ink hull wound inside-out and coloured ink, so a single back-face-culled toon draw shows both.
export type BoxPart = [w: number, h: number, d: number, color: number, x?: number, y?: number, z?: number, ink?: number];
const inkModel = (parts: BoxPart[], extra: Geo[] = []): Geo => inkGeo(parts, extra);
/** Each single part's hull → that part (for `trimHulls`). Group hulls (`inkGroup`) have none. */
const hullOf = new WeakMap<Geo, Geo>();
export function inkGeo(parts: BoxPart[], extra: Geo[] = []): Geo {
  const list: Geo[] = [...extra];
  for (const [w, h, d, color, x = 0, y = 0, z = 0, t = 0.03] of parts) {
    const m = trs(x, y, z, 0, 0, 0, w, h, d), solid = make(cube, color, m);
    list.push(solid);
    if (t > 0) { const hull = insideOut(make(inflateBox(cube, t / w, t / h, t / d), INK_LIT, m)); hullOf.set(hull, solid); list.push(hull); }
  }
  // No outline floating in front of another part (geo.ts trimHulls): pair each part with its own hull.
  const hulls = new Set(list.filter((g) => hullOf.has(g) || isInk(g)));
  const solids = list.filter((g) => !hulls.has(g));
  const pairs = solids.map((solid) => ({ solid, hull: null as Geo | null }));
  for (const h of hulls) { const own = hullOf.get(h); const k = own ? solids.indexOf(own) : -1; if (k >= 0) pairs[k].hull = h; }
  trimHulls(pairs);
  return merge([...pairs.map((p) => p.solid), ...pairs.flatMap((p) => (p.hull ? [p.hull] : [])), ...[...hulls].filter((h) => !hullOf.has(h) || solids.indexOf(hullOf.get(h)!) < 0)]);
}
const isInk = (g: Geo): boolean => g.col.length > 0 && Math.abs(g.col[0] - 0x15 / 255) < 1e-4 && Math.abs(g.col[1] - 0x0f / 255) < 1e-4 && Math.abs(g.col[2] - 0x1f / 255) < 1e-4;
/**
 * Axis-aligned boxes that read as one shape (a cross, a handle), drawn without their own hulls, plus one
 * ink hull round them all (geo.ts `unionHull`): a hull per box drew dark strips across its flush neighbours.
 */
const inkGroup = (parts: BoxPart[], t: number): Geo[] => [
  ...parts.map(([w, h, d, c, x = 0, y = 0, z = 0]) => make(cube, c, trs(x, y, z, 0, 0, 0, w, h, d))),
  insideOut(make(unionHull(parts.map(([w, h, d, , x = 0, y = 0, z = 0]) => ({ lo: [x - w / 2, y - h / 2, z - d / 2], hi: [x + w / 2, y + h / 2, z + d / 2] })), t), INK_LIT)),
];
/** Round pickup part (cylinder along Y: radius r, height h) with its ink hull; `rTop` < 1 tapers it (0 = cone). */
const round = (r: number, h: number, color: number, x: number, y: number, z: number, rTop = 1, t = 0.025): Geo[] => {
  const g = make(cylinder(10, rTop), color, trs(x, y, z, 0, 0, 0, r, h, r));
  if (t <= 0) return [g];
  const hull = insideOut(inflateSmooth(make(g, INK_LIT), t));
  hullOf.set(hull, g);
  return [g, hull];
};
/** Flat trim box turned by `rz` about Z (no ink): embossing and diagonal marks. */
const slash = (w: number, h: number, d: number, color: number, x: number, y: number, rz: number): Geo => make(cube, color, trs(x, y, 0, 0, 0, rz, w, h, d));
/** A cartridge standing on the ammo crate: brass case and rim, copper nose. */
const bullet = (x: number, z: number): Geo[] => [
  ...round(0.05, 0.2, 0xffc94a, x, 0.28, z), ...round(0.058, 0.025, 0xc9a04a, x, 0.19, z, 1, 0),
  ...round(0.05, 0.09, 0xff8a5c, x, 0.425, z, 0.25),
];
// Trim parts have ink 0 (a trailing 0): they sit a hair proud of the face they decorate.
const FLOAT: Record<string, () => Geo> = {
  // First-aid case: red cross both sides, lid seam, two brass latches a side, red base band, carry handle.
  medkit: () => inkModel([
    [0.55, 0.38, 0.28, 0xfff5f5], [0.3, 0.09, 0.3, 0xff4d6d, 0, -0.03, 0, 0], [0.09, 0.3, 0.3, 0xff4d6d, 0, -0.03, 0, 0],
    [0.56, 0.018, 0.29, 0xcfc8d8, 0, 0.14, 0, 0], [0.56, 0.054, 0.29, 0xff4d6d, 0, -0.165, 0, 0],
    [0.06, 0.07, 0.31, 0xffd43b, -0.19, 0.14, 0, 0], [0.06, 0.07, 0.31, 0xffd43b, 0.19, 0.14, 0, 0],
  ], inkGroup([[0.05, 0.07, 0.06, 0x54506e, -0.1, 0.22, 0], [0.05, 0.07, 0.06, 0x54506e, 0.1, 0.22, 0], [0.26, 0.045, 0.07, 0x54506e, 0, 0.27, 0]], 0.02)), // the handle, one outline
  // Pillow Vest: a plump pillow with two straps, shoulder pads, a buckled belt, a heart patch and tufting buttons.
  armor: () => inkModel([
    [0.5, 0.56, 0.2, 0xf6f2ff], [0.08, 0.6, 0.22, 0x74c0fc, -0.14, 0, 0, 0], [0.08, 0.6, 0.22, 0x74c0fc, 0.14, 0, 0, 0], [0.52, 0.07, 0.23, 0x4a78c2, 0, -0.08, 0, 0], // belt a hair deeper than the straps: same depth z-fought where they cross
    [0.13, 0.07, 0.25, 0x4a78c2, -0.14, 0.3, 0, 0.02], [0.13, 0.07, 0.25, 0x4a78c2, 0.14, 0.3, 0, 0.02],
    [0.11, 0.11, 0.24, 0xffd43b, 0, -0.08, 0, 0], [0.05, 0.05, 0.25, 0x4a78c2, 0, -0.08, 0, 0],
    [0.09, 0.08, 0.215, 0xff8fab, 0, 0.13, 0, 0], [0.04, 0.04, 0.215, 0xcfc4ea, 0, -0.2, 0, 0],
    [0.04, 0.04, 0.215, 0xcfc4ea, -0.21, 0.2, 0, 0], [0.04, 0.04, 0.215, 0xcfc4ea, 0.21, 0.2, 0, 0],
    [0.04, 0.04, 0.215, 0xcfc4ea, -0.21, -0.2, 0, 0], [0.04, 0.04, 0.215, 0xcfc4ea, 0.21, -0.2, 0, 0],
  ]),
  // Ammo crate: darker end caps, lid seam, rope-handle blocks on the ends, five loose cartridges standing on top.
  ammo: () => inkModel([
    [0.62, 0.36, 0.42, 0x7fa650], [0.64, 0.1, 0.44, 0xffd43b, 0, -0.02, 0, 0],
    [0.09, 0.37, 0.43, 0x5f8040, -0.27, 0, 0, 0], [0.09, 0.37, 0.43, 0x5f8040, 0.27, 0, 0, 0], [0.63, 0.018, 0.43, 0x5f8040, 0, 0.11, 0, 0],
    [0.05, 0.07, 0.2, 0x54506e, -0.33, 0.06, 0, 0.02], [0.05, 0.07, 0.2, 0x54506e, 0.33, 0.06, 0, 0.02],
    [0.1, 0.104, 0.445, 0x2b2540, 0, -0.02, 0, 0],
  ], [...bullet(-0.17, 0.07), ...bullet(0, 0.07), ...bullet(0.17, 0.07), ...bullet(-0.085, -0.08), ...bullet(0.085, -0.08)]),
  // Jerry can: embossed X on both faces, dark base, carry handle, capped spout.
  fuel: () => inkModel([
    [0.42, 0.55, 0.26, 0xe8413c], [0.1, 0.14, 0.1, 0xffd43b, 0.12, 0.33, 0], [0.05, 0.05, 0.05, 0x2b2540, 0.12, 0.42, 0, 0.02],
    [0.43, 0.06, 0.27, 0xb8322e, 0, -0.25, 0, 0], [0.43, 0.025, 0.27, 0xb8322e, 0, 0.2, 0, 0],
    [0.045, 0.09, 0.08, 0xb8322e, -0.17, 0.31, 0, 0.02], [0.045, 0.09, 0.08, 0xb8322e, -0.01, 0.31, 0, 0.02], [0.22, 0.045, 0.09, 0x2b2540, -0.09, 0.37, 0, 0.02],
  ], [slash(0.42, 0.04, 0.275, 0xc92a2a, 0, -0.03, 0.75), slash(0.42, 0.04, 0.275, 0xc92a2a, 0, -0.03, -0.75)]),
  // Cartridge fuse: glass barrel with a glowing filament, brass caps, steel end prongs.
  fuse: () => inkModel([
    [0.18, 0.5, 0.18, 0xe8e6f2], [0.22, 0.08, 0.22, 0xc9a04a, 0, -0.22, 0], [0.22, 0.08, 0.22, 0xc9a04a, 0, 0.22, 0],
    [0.19, 0.26, 0.1, 0x99d5ff, 0, 0, 0, 0], [0.1, 0.26, 0.19, 0x99d5ff, 0, 0, 0, 0],
    [0.195, 0.2, 0.025, 0xffd43b, 0, 0, 0, 0], [0.025, 0.2, 0.195, 0xffd43b, 0, 0, 0, 0],
    [0.09, 0.07, 0.09, 0x8f93a8, 0, -0.29, 0, 0.02], [0.09, 0.07, 0.09, 0x8f93a8, 0, 0.29, 0, 0.02],
    [0.225, 0.02, 0.225, 0xa07c30, 0, -0.2, 0, 0], [0.225, 0.02, 0.225, 0xa07c30, 0, 0.2, 0, 0],
  ]),
  // Staff keycard: magnetic stripe, gold chip, photo, two lines of print, a clip and a red lanyard.
  keycard: () => inkModel([
    [0.45, 0.3, 0.04, 0x74c0fc], [0.455, 0.06, 0.05, 0x2b2540, 0, 0.06, 0, 0],
    [0.09, 0.08, 0.05, 0xffd43b, -0.14, -0.06, 0, 0], [0.11, 0.11, 0.05, 0xfff5f5, 0.13, -0.065, 0, 0], [0.06, 0.05, 0.055, 0xffb4a2, 0.13, -0.05, 0, 0],
    [0.13, 0.016, 0.05, 0xe7f5ff, -0.02, -0.03, 0, 0], [0.09, 0.016, 0.05, 0xe7f5ff, -0.04, -0.07, 0, 0],
    [0.1, 0.05, 0.05, 0x8f93a8, 0, 0.17, 0, 0.02], [0.045, 0.16, 0.02, 0xff6b6b, 0, 0.27, 0, 0.02],
  ]),
  // Medicine box: teal band with a white cross, lid flap, and a pill bottle standing on top.
  medicine: () => inkModel([
    [0.4, 0.32, 0.3, 0xffffff], [0.41, 0.1, 0.31, 0x39c5bb, 0, -0.03, 0, 0],
    [0.08, 0.026, 0.32, 0xffffff, -0.1, -0.03, 0, 0], [0.026, 0.08, 0.32, 0xffffff, -0.1, -0.03, 0, 0],
    [0.14, 0.02, 0.315, 0xffffff, 0.08, -0.03, 0, 0], [0.41, 0.016, 0.31, 0xcfc8d8, 0, 0.1, 0, 0],
  ], [...round(0.07, 0.16, 0xffa94d, 0.08, 0.24, 0), ...round(0.073, 0.05, 0xfff5f5, 0.08, 0.24, 0, 1, 0), ...round(0.078, 0.05, 0xffffff, 0.08, 0.34, 0)]),
  // Cassette tape: cream label with a red stripe, two reel hubs and a window, a raised lower lip, corner screws.
  tape: () => inkModel([
    [0.4, 0.26, 0.08, 0x2b2540], [0.32, 0.13, 0.09, 0xfff1c9, 0, 0.02, 0, 0], [0.324, 0.022, 0.092, 0xff6b6b, 0, 0.065, 0, 0],
    [0.06, 0.06, 0.095, 0x2b2540, -0.085, 0.005, 0, 0], [0.06, 0.06, 0.095, 0x2b2540, 0.085, 0.005, 0, 0],
    [0.025, 0.025, 0.1, 0xfff5f5, -0.085, 0.005, 0, 0], [0.025, 0.025, 0.1, 0xfff5f5, 0.085, 0.005, 0, 0],
    [0.08, 0.04, 0.093, 0x8f93a8, 0, 0.005, 0, 0], [0.24, 0.05, 0.1, 0x3d3955, 0, -0.1, 0, 0],
    [0.022, 0.022, 0.086, 0x8f93a8, -0.175, 0.105, 0, 0], [0.022, 0.022, 0.086, 0x8f93a8, 0.175, 0.105, 0, 0],
    [0.022, 0.022, 0.086, 0x8f93a8, -0.175, -0.105, 0, 0], [0.022, 0.022, 0.086, 0x8f93a8, 0.175, -0.105, 0, 0],
  ]),
  // Car battery (and any other spare part): dark top plate, red and black terminal posts, yellow cell caps, a warning stripe.
  part: () => inkModel([
    [0.4, 0.4, 0.4, 0x8f93a8], [0.2, 0.2, 0.42, 0xffd43b, 0, -0.02, 0, 0], [0.41, 0.06, 0.41, 0x54506e, 0, 0.18, 0, 0],
    [0.41, 0.03, 0.41, 0x6f7388, 0, -0.17, 0, 0], [0.05, 0.12, 0.425, 0x2b2540, 0, -0.02, 0, 0],
    [0.045, 0.035, 0.045, 0xffd43b, -0.1, 0.22, 0.1, 0.015], [0.045, 0.035, 0.045, 0xffd43b, 0, 0.22, 0.1, 0.015], [0.045, 0.035, 0.045, 0xffd43b, 0.1, 0.22, 0.1, 0.015],
  ], [...round(0.04, 0.09, 0xff6b6b, -0.11, 0.25, -0.08), ...round(0.04, 0.09, 0x2b2540, 0.11, 0.25, -0.08)]),
};
// Small medical items: each floats under a green cross, so they read as "health" from across a room.
// One outline round the whole cross (inkGroup): a hull per bar drew dark strips across the other bar.
const SIGN = (): Geo[] => inkGroup([[0.17, 0.055, 0.055, 0x51cf66, 0, 0.44, 0], [0.055, 0.17, 0.055, 0x51cf66, 0, 0.44, 0]], 0.018);
// Boo-Boo Plaster: a tin of plasters with one printed on the lid and a loose one stuck across the corner.
FLOAT.plaster = () => inkModel([
  [0.4, 0.26, 0.16, 0xfff5f5], [0.41, 0.054, 0.17, 0x63e6be, 0, 0.105, 0, 0], [0.41, 0.034, 0.17, 0x63e6be, 0, -0.115, 0, 0],
  [0.26, 0.085, 0.175, 0xffc9a3, 0, -0.015, 0, 0], [0.085, 0.09, 0.18, 0xffe8d6, 0, -0.015, 0, 0],
  [0.02, 0.02, 0.183, 0xe8a87c, -0.09, -0.015, 0, 0], [0.02, 0.02, 0.183, 0xe8a87c, 0.09, -0.015, 0, 0],
], [slash(0.2, 0.06, 0.02, 0xffc9a3, 0.16, 0.12, -0.6), slash(0.06, 0.062, 0.022, 0xffe8d6, 0.16, 0.12, -0.6), ...SIGN()]);
// Gummy Vitamins: an orange jar with a white cap and label, three gummies stuck to it.
FLOAT.vitamins = () => inkModel([
  [0.07, 0.07, 0.03, 0xff6b6b, -0.07, -0.03, 0.135, 0], [0.07, 0.07, 0.03, 0xffd43b, 0.0, -0.03, 0.14, 0], [0.07, 0.07, 0.03, 0x51cf66, 0.07, -0.03, 0.135, 0],
  [0.07, 0.07, 0.03, 0xff6b6b, 0.07, -0.03, -0.135, 0], [0.07, 0.07, 0.03, 0xffd43b, 0.0, -0.03, -0.14, 0], [0.07, 0.07, 0.03, 0x51cf66, -0.07, -0.03, -0.135, 0],
], [...SIGN(), ...round(0.14, 0.3, 0xffa94d, 0, -0.03, 0), ...round(0.144, 0.14, 0xfff5f5, 0, -0.03, 0, 1, 0), ...round(0.11, 0.05, 0xffa94d, 0, 0.145, 0, 1, 0), ...round(0.15, 0.08, 0xfff5f5, 0, 0.2, 0)]);
// Hot Cocoa: a pink mug, cocoa to the brim, two marshmallows, a handle.
FLOAT.cocoa = () => inkModel([
  [0.07, 0.05, 0.07, 0xfff5f5, -0.04, 0.165, 0.02, 0.015], [0.06, 0.05, 0.06, 0xfff5f5, 0.05, 0.16, -0.04, 0.015],
], [...SIGN(), ...inkGroup([[0.05, 0.045, 0.06, 0xff8fab, 0.2, 0.07, 0], [0.05, 0.045, 0.06, 0xff8fab, 0.2, -0.09, 0], [0.045, 0.2, 0.06, 0xff8fab, 0.235, -0.01, 0]], 0.02), // the handle, one outline
  ...round(0.17, 0.3, 0xff8fab, 0, -0.01, 0), ...round(0.176, 0.035, 0xfff5f5, 0, 0.125, 0, 1, 0), ...round(0.174, 0.03, 0xffc2d1, 0, -0.06, 0, 1, 0), ...round(0.145, 0.012, 0x7a4a3a, 0, 0.142, 0, 1, 0)]);

const geoCache = new Map<string, Geo>();
/** Geometry of the pickup model `key` (a supply or medical item kind, or a quest item look); unknown keys get the spare part. */
export function pickupGeo(key: string): Geo {
  let g = geoCache.get(key);
  if (!g) { g = (FLOAT[key] ?? FLOAT.part)(); geoCache.set(key, g); }
  return g;
}
/** Whether `key` has its own pickup model. */
export const hasPickupModel = (key: string): boolean => key in FLOAT;
