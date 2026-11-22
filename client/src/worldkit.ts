// Shared bits for the world builders (world.ts, arch.ts, ground.ts, atmo.ts):
// the build context, raw geometry writers and a few colour helpers.
import * as pc from 'playcanvas';
import { TILE, STOREY } from '../../shared/constants';
import { F, isIndoor, RAMP_DX, RAMP_DZ, type Level, type ChapterDef, type Theme, type Vec2 } from '../../shared/level';
import { type Geo, box } from './geo';
import { rgb, type V3 } from './gfx';

export const CHUNK = 32; // tiles per side of a render chunk (frustum culling + texture size)

export interface Ctx {
  L: Level; def: ChapterDef; W: number; H: number; theme: Theme;
  /** 1 at night, falling to 0 under a bright dawn sky: scales lit windows, neon, glows and lamp light. */ night: number;
  root: pc.Entity;
  /** Textures to destroy with the world. */ textures: pc.Texture[];
  /** Uploads `g` and remembers the mesh so `dispose()` can free it. */
  mesh(g: Geo): pc.Mesh;
  /** Registers a material made for this world so `dispose()` can destroy it. Returns it. */
  mat<M extends pc.Material>(m: M): M;
  add(e: pc.Entity): pc.Entity;
  /** Floor type of tile (x,z) on storey `lv` (default 0); NONE outside the map, in walls and in air. */
  floorOf(x: number, z: number, lv?: number): number;
  /** Tile (x,z) on storey `lv` (default 0) is wall, or off the map. Upstairs, air is not wall. */
  isWall(x: number, z: number, lv?: number): boolean;
  /** Per-node render facts for multi-storey maps (wall stacks, looks). */ S: Storeys;
  chunks(fn: (cx0: number, cz0: number, cx1: number, cz1: number) => void): void;
}

export const newGeo = (): Geo => ({ pos: [], nor: [], col: [], uv: [], idx: [] });

/** Ink strokes are real geometry: a thin axis-aligned beam per line segment. */
export function beam(g: Geo, ax: number, ay: number, az: number, bx: number, by: number, bz: number, t = 0.022): void {
  const x0 = Math.min(ax, bx) - t, x1 = Math.max(ax, bx) + t, y0 = Math.min(ay, by) - t, y1 = Math.max(ay, by) + t, z0 = Math.min(az, bz) - t, z1 = Math.max(az, bz) + t;
  const b = g.pos.length / 3;
  g.pos.push(x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1);
  g.idx.push(b, b + 2, b + 1, b, b + 3, b + 2, b + 4, b + 5, b + 6, b + 4, b + 6, b + 7, b, b + 1, b + 5, b, b + 5, b + 4, b + 3, b + 6, b + 2, b + 3, b + 7, b + 6, b, b + 4, b + 7, b, b + 7, b + 3, b + 1, b + 2, b + 6, b + 1, b + 6, b + 5);
}

/** One quad, corners counter-clockwise seen from the side `n` points to. `c2` colours the last two corners (vertical gradients). */
export function quad(g: Geo, c: V3, n: V3 | null, p: number[], c2: V3 = c): void {
  const b = g.pos.length / 3;
  for (let i = 0; i < 12; i++) g.pos.push(p[i]);
  if (n) for (let i = 0; i < 4; i++) g.nor.push(n[0], n[1], n[2]);
  g.col.push(c[0], c[1], c[2], c[0], c[1], c[2], c2[0], c2[1], c2[2], c2[0], c2[1], c2[2]);
  g.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
}

/** Vertical quad on the side of tile (x,z) facing direction `di` (+x, -x, +z, -z), from height ya up to yb. */
const SIDE = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export function sideQuad(g: Geo, c: V3, x: number, z: number, di: number, ya: number, yb: number): void {
  const [dx, dz] = SIDE[di], tx = -dz, tz = dx, mx = (x + 0.5 + dx * 0.5) * TILE, mz = (z + 0.5 + dz * 0.5) * TILE;
  quad(g, c, [dx, 0, dz], [mx + tx, ya, mz + tz, mx - tx, ya, mz - tz, mx - tx, yb, mz - tz, mx + tx, yb, mz + tz]);
}

const UNIT = box();
/** Axis-aligned box with outward faces (so an inflated copy works as an ink hull). */
export function aabb(g: Geo, c: V3, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, normals = true): void {
  const b = g.pos.length / 3, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2, sx = Math.abs(x1 - x0), sy = Math.abs(y1 - y0), sz = Math.abs(z1 - z0);
  for (let i = 0; i < UNIT.pos.length; i += 3) {
    g.pos.push(cx + UNIT.pos[i] * sx, cy + UNIT.pos[i + 1] * sy, cz + UNIT.pos[i + 2] * sz);
    if (normals) g.nor.push(UNIT.nor[i], UNIT.nor[i + 1], UNIT.nor[i + 2]);
    g.col.push(c[0], c[1], c[2]);
  }
  for (const i of UNIT.idx) g.idx.push(b + i);
}

export const mul = (c: V3, k: number): V3 => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
export const mix3 = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
export const mixHex = (a: number, b: number, k: number): V3 => mix3(rgb(a), rgb(b), k);
export const css = (c: V3, a = 1): string => `rgba(${Math.round(Math.min(1, c[0]) * 255)},${Math.round(Math.min(1, c[1]) * 255)},${Math.round(Math.min(1, c[2]) * 255)},${a})`;

/** Storey a thing standing at floor height `y` is on. */
export const storeyOfY = (y: number | undefined, levels: number): number => Math.max(0, Math.min(levels - 1, Math.round((y ?? 0) / STOREY)));

/** How thick a floor slab is drawn where its edge or underside shows, and the roof over a room with nothing built on it. */
export const SLAB_T = 0.3, ROOF_T = 0.3;

/**
 * Render-side facts per node (shared/level.ts: `lv * W * H + z * W + x`).
 * - `wall`: the node is inside a wall stack; `base`/`top` are that stack's absolute bottom and top
 *   (a storey-0 wall, or an authored upper wall, plus the auto walls above it; cut off where the
 *   next storey has something else).
 * - `look`: the floor type to dress the node as. `def.floor`, except that stairs and ladders take
 *   the room they belong to (so a stairwell is not a patch of "street"), and the hole above an
 *   indoor stair takes the room it lands in.
 */
export interface Storeys { levels: number; WH: number; wall: Uint8Array; base: Float32Array; top: Float32Array; look: Uint8Array }
export function storeysOf(L: Level): Storeys {
  const def = L.def, { W, H, WH, levels, N } = L;
  const wall = new Uint8Array(N), base = new Float32Array(N), top = new Float32Array(N), look = Uint8Array.from(def.floor);
  const isWallNode = (n: number) => def.floor[n] === F.NONE && !def.air[n];
  for (let c = 0; c < WH; c++) {
    for (let k = 0; k < levels;) {
      const n = k * WH + c;
      if (!(isWallNode(n) && (k === 0 || def.wallH[n] > 0))) { k++; continue; }
      let j = k + 1;
      while (j < levels && isWallNode(j * WH + c) && def.wallH[j * WH + c] === 0) j++;
      const t = j < levels ? Math.min(def.wallH[n], j * STOREY) : def.wallH[n];
      for (let i = k; i < j; i++) { wall[i * WH + c] = 1; base[i * WH + c] = k * STOREY; top[i * WH + c] = t; }
      k = j;
    }
  }
  const at = (x: number, z: number, lv: number) => (x < 0 || z < 0 || x >= W || z >= H || lv >= levels ? F.NONE : def.floor[lv * WH + z * W + x]);
  for (const r of def.ramps) {
    const dx = RAMP_DX[r.dir], dz = RAMP_DZ[r.dir];
    for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) {
      // The cell before the low end (same storey) and the landing past the high end (storey above).
      const ex = dx > 0 ? r.x0 - 1 : dx < 0 ? r.x1 + 1 : x, ez = dz > 0 ? r.z0 - 1 : dz < 0 ? r.z1 + 1 : z;
      const lx = dx > 0 ? r.x1 + 1 : dx < 0 ? r.x0 - 1 : x, lz = dz > 0 ? r.z1 + 1 : dz < 0 ? r.z0 - 1 : z;
      const ef = at(ex, ez, r.lv), lf = at(lx, lz, r.lv + 1), n = r.lv * WH + z * W + x;
      if (isIndoor(ef)) look[n] = ef; else if (isIndoor(lf)) look[n] = lf;
      if (r.lv + 1 < levels && def.air[n + WH] && isIndoor(lf)) look[n + WH] = lf;
    }
  }
  return { levels, WH, wall, base, top, look };
}

/** Is this lamp a ceiling fixture? (Lamps sit on tile corners, so ask the cells around it.) */
export function lampIndoor(ctx: Ctx, l: Vec2): boolean {
  let inside = 0, outside = 0;
  const lv = storeyOfY(l.y, ctx.S.levels);
  for (const [ox, oz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
    const f = ctx.floorOf(Math.floor((l.x + ox) / TILE), Math.floor((l.z + oz) / TILE), lv);
    if (f === F.NONE) continue;
    if (isIndoor(f)) inside++; else outside++;
  }
  return inside > 0 && inside >= outside;
}

/** How dark the chapter's sky is (1 = night, 0 = bright dawn/day), from the average luminance of its three sky colours. */
export function nightOf(theme: Theme): number {
  let l = 0;
  for (const c of theme.sky) { const [r, g, b] = rgb(c); l += (0.3 * r + 0.59 * g + 0.11 * b) / 3; }
  return Math.max(0, Math.min(1, (0.64 - l) / 0.16));
}
