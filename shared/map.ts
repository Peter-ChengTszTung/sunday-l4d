// The campaign level: "Last Stop Lane". Grid based, shared by server (AI,
// collision) and client (rendering, movement, hitscan).
import { TILE } from './constants';

export const F = { NONE: 0, ASPHALT: 1, SIDEWALK: 2, GRASS: 3, INTERIOR: 4, SAFE_A: 5, SAFE_B: 6, GATE: 7 } as const;

export type PropType = 'car' | 'dumpster' | 'crate' | 'tree' | 'fountain' | 'gen';
export type PickupKind = 'smg' | 'shotgun' | 'rifle' | 'ammo' | 'medkit' | 'gen';
export interface Prop { type: PropType; x: number; z: number; w: number; d: number; color?: number }
export interface Pickup { id: number; kind: PickupKind; x: number; z: number }
export interface Vec2 { x: number; z: number }

function hash2(x: number, z: number): number {
  let h = (x * 374761393 + z * 668265263) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function build() {
  const W = 44, H = 84;
  const floor = new Uint8Array(W * H);
  const solid = new Uint8Array(W * H).fill(1);
  const propCell = new Uint8Array(W * H);
  const wallH = new Float32Array(W * H);
  const props: Prop[] = [];
  const pickups: Pickup[] = [];
  const lamps: Vec2[] = [];
  const arrows: { x: number; z: number; rot: number }[] = [];
  const idx = (x: number, z: number) => z * W + x;

  const carve = (x0: number, z0: number, x1: number, z1: number, type: number) => {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) { floor[idx(x, z)] = type; solid[idx(x, z)] = 0; }
  };
  const prop = (type: PropType, x: number, z: number, w = 1, d = 1, extra: { color?: number } = {}) => {
    for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) { solid[idx(x + dx, z + dz)] = 1; propCell[idx(x + dx, z + dz)] = 1; }
    props.push({ type, x, z, w, d, ...extra });
  };
  const pick = (kind: PickupKind, x: number, z: number) => pickups.push({ id: pickups.length, kind, x: (x + 0.5) * TILE, z: (z + 0.5) * TILE });
  const lamp = (x: number, z: number) => lamps.push({ x: x * TILE, z: z * TILE });
  const arrow = (x: number, z: number, rot: number) => arrows.push({ x, z, rot });

  // --- 1. Start safe room -------------------------------------------------
  carve(18, 2, 25, 7, F.SAFE_A);
  carve(21, 8, 22, 8, F.SAFE_A); // doorway
  pick('smg', 19, 3); pick('shotgun', 24, 3); pick('ammo', 21, 2); pick('ammo', 22, 2);
  pick('medkit', 18, 6); pick('medkit', 19, 6); pick('medkit', 24, 6); pick('medkit', 25, 6);

  // --- 2. Main street ------------------------------------------------------
  carve(13, 9, 30, 29, F.ASPHALT);
  carve(13, 9, 14, 29, F.SIDEWALK); carve(29, 9, 30, 29, F.SIDEWALK);
  carve(5, 16, 12, 18, F.ASPHALT); carve(5, 12, 9, 22, F.GRASS);     // west courtyard
  carve(31, 22, 38, 24, F.ASPHALT); carve(35, 18, 38, 28, F.SIDEWALK); // east yard
  prop('car', 17, 12, 1, 2, { color: 0xff6b6b });
  prop('car', 24, 16, 2, 1, { color: 0x4dabf7 });
  prop('car', 19, 21, 1, 2, { color: 0xffd43b });
  prop('car', 25, 25, 1, 2, { color: 0x9775fa });
  prop('dumpster', 29, 13); prop('dumpster', 13, 24);
  prop('crate', 22, 27); prop('crate', 7, 20); prop('crate', 37, 26);
  prop('tree', 6, 13); prop('tree', 9, 21);
  for (const z of [11, 17, 23, 28]) { lamp(13.3, z); lamp(30.7, z + 2 > 29 ? 28 : z + 2); }
  arrow(21.5, 12, 0); arrow(24, 24, 0); arrow(27.5, 28, 0);

  // --- 3. Back alley -------------------------------------------------------
  carve(27, 30, 29, 39, F.ASPHALT);
  prop('dumpster', 27, 33); prop('crate', 29, 37);
  arrow(28.5, 35, 0);
  pick('ammo', 29, 31);

  // --- 4. Park plaza -------------------------------------------------------
  carve(8, 40, 35, 55, F.GRASS);
  carve(8, 47, 35, 48, F.SIDEWALK); carve(21, 40, 22, 55, F.SIDEWALK);
  carve(4, 44, 7, 46, F.SIDEWALK);   // west alcove
  carve(36, 50, 39, 52, F.SIDEWALK); // east alcove
  prop('fountain', 21, 47, 2, 2);
  for (const [x, z] of [[11, 42], [15, 44], [12, 51], [17, 53], [25, 43], [31, 45], [28, 52], [33, 53], [18, 41], [33, 41], [26, 50], [14, 54]]) prop('tree', x, z);
  prop('crate', 24, 55); prop('crate', 9, 44);
  for (const [x, z] of [[20.8, 44], [23.2, 51], [14, 46.8], [29, 49.2]]) lamp(x, z);
  pick('rifle', 5, 45); pick('medkit', 38, 51); pick('ammo', 23, 50);
  arrow(24, 42, Math.PI / 2); arrow(16, 49.5, Math.PI / 2); arrow(10.5, 53, 0);

  // --- 5. Service alley + warehouse ---------------------------------------
  carve(9, 56, 11, 61, F.ASPHALT);
  carve(6, 62, 37, 73, F.INTERIOR);
  carve(2, 66, 5, 70, F.INTERIOR); // back office
  for (let z = 64; z <= 69; z++) prop('crate', 14, z);
  for (let z = 66; z <= 73; z++) prop('crate', 20, z);
  for (let z = 62; z <= 68; z++) prop('crate', 26, z);
  for (let z = 67; z <= 71; z++) prop('crate', 32, z);
  for (const [x, z] of [[10, 68], [11, 68], [17, 71], [23, 63], [29, 71], [7, 72], [17, 64], [23, 70]]) prop('crate', x, z);
  prop('gen', 37, 62);
  pick('gen', 37, 62);
  pick('ammo', 8, 63); pick('medkit', 3, 67); pick('medkit', 3, 69); pick('shotgun', 2, 68);
  pick('ammo', 35, 65); pick('rifle', 33, 63); pick('medkit', 36, 71);
  arrow(10.5, 59, 0); arrow(12, 62.8, -Math.PI / 2); arrow(17, 62.8, -Math.PI / 2); arrow(23, 71.5, -Math.PI / 2); arrow(30, 63.5, -Math.PI / 2);
  arrow(35, 72, 0);

  // --- 6. Gate + end safe room --------------------------------------------
  carve(34, 74, 35, 74, F.GATE);
  carve(31, 75, 38, 80, F.SAFE_B);
  pick('ammo', 32, 79); pick('medkit', 37, 79);

  // Building heights, in blocky 3x3 chunks so the skyline reads as buildings.
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    wallH[idx(x, z)] = 7 + Math.floor(hash2(Math.floor(x / 3), Math.floor(z / 3)) * 4) * 2.2;
  }

  return {
    W, H, floor, solid, propCell, wallH, props, pickups, lamps, arrows,
    spawns: [[20.5, 4.5], [21.5, 5.2], [22.5, 4.5], [23.5, 5.2]].map(([x, z]) => ({ x: x * TILE, z: z * TILE })),
    startCell: { x: 21, z: 5 },
    endCell: { x: 34, z: 78 },
    gate: { x0: 34, x1: 35, z: 74 },
  };
}

export const MAP = build();
export { hash2 };

export const cellOf = (v: number): number => Math.floor(v / TILE);
export const cellIdx = (x: number, z: number): number => cellOf(z) * MAP.W + cellOf(x);

export function solidAt(tx: number, tz: number, gateOpen: boolean): boolean {
  if (tx < 0 || tz < 0 || tx >= MAP.W || tz >= MAP.H) return true;
  const i = tz * MAP.W + tx;
  return MAP.solid[i] === 1 || (!gateOpen && MAP.floor[i] === F.GATE);
}

export function floorAt(x: number, z: number): number {
  const tx = cellOf(x), tz = cellOf(z);
  if (tx < 0 || tz < 0 || tx >= MAP.W || tz >= MAP.H) return F.NONE;
  return MAP.floor[tz * MAP.W + tx];
}

export function boxBlocked(x: number, z: number, r: number, gateOpen: boolean): boolean {
  const x0 = cellOf(x - r), x1 = cellOf(x + r), z0 = cellOf(z - r), z1 = cellOf(z + r);
  for (let tz = z0; tz <= z1; tz++) for (let tx = x0; tx <= x1; tx++) if (solidAt(tx, tz, gateOpen)) return true;
  return false;
}

// Axis-separated slide. Mutates and returns `pos` ({x, z}).
export function moveSlide<T extends Vec2>(pos: T, dx: number, dz: number, r: number, gateOpen: boolean): T {
  if (dx !== 0 && !boxBlocked(pos.x + dx, pos.z, r, gateOpen)) pos.x += dx;
  if (dz !== 0 && !boxBlocked(pos.x, pos.z + dz, r, gateOpen)) pos.z += dz;
  return pos;
}

// 2D DDA through the grid. (dx, dz) must be normalised. Returns the distance
// to the first solid tile, or maxDist.
export function rayGrid(ox: number, oz: number, dx: number, dz: number, maxDist: number, gateOpen: boolean): number {
  let tx = cellOf(ox), tz = cellOf(oz);
  if (solidAt(tx, tz, gateOpen)) return 0;
  const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const ddx = dx !== 0 ? Math.abs(TILE / dx) : Infinity;
  const ddz = dz !== 0 ? Math.abs(TILE / dz) : Infinity;
  let tmx = dx !== 0 ? ((dx > 0 ? (tx + 1) * TILE - ox : ox - tx * TILE) / Math.abs(dx)) : Infinity;
  let tmz = dz !== 0 ? ((dz > 0 ? (tz + 1) * TILE - oz : oz - tz * TILE) / Math.abs(dz)) : Infinity;
  let t = 0;
  while (t < maxDist) {
    if (tmx < tmz) { t = tmx; tmx += ddx; tx += sx; } else { t = tmz; tmz += ddz; tz += sz; }
    if (t >= maxDist) break;
    if (solidAt(tx, tz, gateOpen)) return t;
  }
  return maxDist;
}

export function hasLOS(ax: number, az: number, bx: number, bz: number, gateOpen: boolean): boolean {
  const dx = bx - ax, dz = bz - az;
  const d = Math.hypot(dx, dz);
  if (d < 0.001) return true;
  return rayGrid(ax, az, dx / d, dz / d, d, gateOpen) >= d - 0.001;
}

// Breadth-first distance field (in tiles) from a list of source cell indices.
const NEI = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export function distanceField(sources: number[], gateOpen: boolean, out?: Int16Array): Int16Array {
  const { W, H } = MAP;
  const dist = out || new Int16Array(W * H);
  dist.fill(32767);
  const queue = new Int32Array(W * H);
  let head = 0, tail = 0;
  for (const s of sources) if (dist[s] !== 0) { dist[s] = 0; queue[tail++] = s; }
  while (head < tail) {
    const c = queue[head++];
    const cx = c % W, cz = (c / W) | 0, d = dist[c] + 1;
    for (const [ox, oz] of NEI) {
      const nx = cx + ox, nz = cz + oz;
      if (solidAt(nx, nz, gateOpen)) continue;
      const n = nz * W + nx;
      if (dist[n] > d) { dist[n] = d; queue[tail++] = n; }
    }
  }
  return dist;
}
