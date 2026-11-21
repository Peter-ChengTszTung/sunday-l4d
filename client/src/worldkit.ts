// Shared bits for the world builders (world.ts, arch.ts, ground.ts, atmo.ts):
// the build context, raw geometry writers and a few colour helpers.
import * as pc from 'playcanvas';
import { TILE } from '../../shared/constants';
import { F, isIndoor, type Level, type ChapterDef, type Theme, type Vec2 } from '../../shared/level';
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
  floorOf(x: number, z: number): number;
  isWall(x: number, z: number): boolean;
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

/** Is this lamp a ceiling fixture? (Lamps sit on tile corners, so ask the cells around it.) */
export function lampIndoor(ctx: Ctx, l: Vec2): boolean {
  let inside = 0, outside = 0;
  for (const [ox, oz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
    const f = ctx.floorOf(Math.floor((l.x + ox) / TILE), Math.floor((l.z + oz) / TILE));
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
