// What of the static world gets drawn. Rendering only: it reads the level, never changes it.
//
// The builders hand their merged geometry to `put()`. Each call stays one mesh and one draw call (one
// vertex buffer, one index buffer), but its triangles are sorted into "parts": one per storey per 32 m
// cell of the map, each a contiguous run of the index buffer. Hiding parts costs nothing: the mesh is
// drawn as the range of its index buffer from the first part in sight to the last (with a box round
// only those, for the engine's frustum test), and not at all when none is.
//
// Which parts are in sight is a table, looked up by the 4 m square and storey the camera is in: the map
// is static and doors count as open, so it is worked out once per chapter by `npm run bake:cull` and kept
// in `pvs/`. Per square it is the union over every eye position in it (and a range of eye heights: see
// `BANDS`) of three rules:
//
//  1. Fog. Past `fogFar` every fogged fragment is the flat fog colour, so only an object's outline
//     against the sky is left. "Deco" meshes (ink strokes, ink hulls, lit panes: all within a few
//     centimetres of a solid surface) change nothing but that outline's last centimetres, and are
//     dropped once wholly in the fog. The solids themselves stay: they are the outline.
//  2. Walls, on the camera's own storey. A sight line between two points of one storey never leaves
//     it, so it is blocked by any wall column that fills the storey from floor to ceiling. `los()`
//     sweeps the storey's tile grid outward from four points of each tile the camera can be in and
//     marks the tiles some line reaches.
//  3. Floors, for the storeys above and below. A sight line to another storey crosses the floor
//     plane between them, and has to do so through a tile with nothing drawn across it (open air, a
//     stairwell) that (2) can see. Each box is projected from the eye onto the planes it lies behind.
//     Going up there are two heights to pass, since a slab's underside hangs lower than a room's
//     ceiling and nothing closes the step between the two (see `openA`).
//
// All three err on the side of drawing: a part is hidden only when no line from any eye in the square
// can reach any box of it. Doors count as open, props never block, and a camera inside a wall shows
// everything.
//
// The table is only right for the geometry it was baked from, so it carries a hash of everything the
// rules read (the parts, their boxes, the walls and floors). When that does not match (a map or a
// builder changed and nobody ran the bake), or the camera is somewhere the bake did not cover (high
// up: the spectator and ride cameras), the same rules are worked out on the spot for the tile the
// camera enters, and kept. `npm run check:cull` casts rays at everything hidden, either way.
import * as pc from 'playcanvas';
import { TILE, STOREY } from '../../shared/constants';
import { F, isIndoor, type Level } from '../../shared/level';
import type { Geo } from './geo';
import { meshEntity } from './gfx';
import { type Storeys, SLAB_T } from './worldkit';
import { PVS } from './pvs';

const T = TILE;
/** Tiles per side of a part, and of one of the boxes a part's triangles are sorted into (the boxes are what is tested). */
const SUB = 16, BLK = 4, RB = SUB / BLK;
/**
 * Index ranges (draw calls, mesh instances) a mesh may be drawn as. One: no more draw calls than without
 * culling, ever. (Two, measured over the four chapters: a fifth more draw calls for 7% fewer triangles.)
 */
const SLOTS = 1;
/** Deco is dropped this far past the fog distance (m): a partly covered pixel can be shaded a little nearer than its surface. */
const FOG_MARGIN = 8;
/**
 * The wall sweep is run from four points of the camera's tile, with the walls shrunk by this much (m):
 * no eye in the tile is farther than that from one of the four, so what none of them sees past the
 * shrunk walls, no eye in the tile sees past the real ones.
 */
const SLACK = 0.72;
/** Boxes are tested this much (m) bigger than they are. */
const EPS = 0.05;
/** A triangle may dip this far (m) under its own storey's floor line (ink hulls do) and still count as standing on it. */
const DIP = 0.035;
/**
 * Eye heights above the camera storey's floor line, lowest to highest (m), that a tile's answer is worked out
 * for; each band includes the ones before it. 0: on foot (downed 0.42, standing 1.22, the top of a jump 2.3).
 * 1: anything under the slab above (the ride and spectator cameras; stairs, ladders and falls). 2: the eye is
 * within the thickness of the floor above (a stair's last steps, the first of a fall): little is hidden.
 */
const BANDS: readonly (readonly [number, number])[] = [[0, 2.6], [0, STOREY - SLAB_T - 0.05], [0, STOREY]];
/** How far (tiles) from a floor's edge a jump can carry a player out over a drop: those tiles are baked for a falling eye. */
const DROP_REACH = 3;
/** Bump when the rules above or the table's layout change: older bakes then read as stale. */
const VERSION = 1, MAGIC = 0x31535650, HEAD = 28;
/** Tiles per side of the squares the baked table has an answer for (the union over every eye in the square). */
const CELL = 2;

/**
 * `?cull=off`: one range per mesh as before, nothing hidden. `?cull=live`: ignore the baked table (work each tile
 * out on entering it). `?cull=hard`: also drops solids past the fog (changes the skyline: for comparison only).
 */
const MODE = new URLSearchParams(location.search).get('cull') ?? '';

interface Batch { deco: boolean; /** Parts p0..p1 - 1, in index buffer order. */ p0: number; p1: number; /** First of its `n` slots. */ slot: number; n: number; tris: number }
/** What to draw: the slots that are on, each with its index range and the box round what is in sight of it. */
interface DrawList { slot: Int32Array; base: Int32Array; count: Int32Array; box: Float32Array; tris: number; parts: number }
export interface CullStats {
  /** Draw ranges there are, and that are on. */ meshes: number; shown: number;
  /** Triangles there are, and inside the ranges that are on. */ tris: number; shownTris: number;
  /** Parts there are, and in sight. */ parts: number; shownParts: number;
  /** Milliseconds the last change of tile took, and the last tile worked out on the spot; how many of those there were. */ ms: number; losMs: number; sweeps: number;
  /** 'baked': the chapter's table is in use. 'loading': it is on its way (everything is drawn). 'live': there is none, or it is stale. 'off'. */ mode: 'baked' | 'loading' | 'live' | 'off';
}
export interface WorldCull {
  /**
   * Adds static world geometry drawn with `mat`. `deco`: it lies within a few centimetres of solid geometry put here too.
   * Returns its mesh instances (one per draw range: per-mesh parameters go on each).
   */
  put(g: Geo, mat: pc.Material, deco?: boolean): pc.MeshInstance[];
  update(camX: number, camY: number, camZ: number): void;
  stats(): CullStats;
  dispose(): void;
  /** Settles once the chapter's baked table is in use, or known to be missing or stale. */
  readonly ready: Promise<void>;
  /** Dev (scripts/bake-cull.ts): works out every tile a camera can be in, and returns the table to keep in `pvs/`. Null on a flat map (fog only: nothing worth keeping). */
  bake(log?: (done: number, of: number) => void): Uint8Array | null;
  /** Dev (scripts/check-cull.ts): every part, as a range of its mesh's index buffer; `mis` are that mesh's draw ranges. */
  debugParts(): { mis: pc.MeshInstance[]; base: number; count: number; deco: boolean }[];
}

/** Sorted, disjoint spans of direction (see `pa`) that are blocked. */
class Spans {
  a = new Float64Array(64); b = new Float64Array(64); n = 0;
  /** Is all of lo..hi blocked? */
  covers(lo: number, hi: number): boolean {
    let l = 0, r = this.n - 1, i = -1;
    while (l <= r) { const m = (l + r) >> 1; if (this.a[m] <= lo) { i = m; l = m + 1; } else r = m - 1; }
    return i >= 0 && this.b[i] >= hi;
  }
  add(lo: number, hi: number): void {
    const { a, b } = this;
    // First span ending at or after lo, last span starting at or before hi: lo..hi swallows those between.
    let l = 0, r = this.n - 1, i = this.n;
    while (l <= r) { const m = (l + r) >> 1; if (b[m] >= lo) { i = m; r = m - 1; } else l = m + 1; }
    let j = i - 1;
    while (j + 1 < this.n && a[j + 1] <= hi) j++;
    if (j < i) {
      if (this.n === a.length) { const na = new Float64Array(this.n * 2), nb = new Float64Array(this.n * 2); na.set(a); nb.set(b); this.a = na; this.b = nb; }
      this.a.copyWithin(i + 1, i, this.n); this.b.copyWithin(i + 1, i, this.n);
      this.a[i] = lo; this.b[i] = hi; this.n++;
      return;
    }
    a[i] = Math.min(a[i], lo); b[i] = Math.max(b[j], hi);
    if (j > i) { a.copyWithin(i + 1, j + 1, this.n); b.copyWithin(i + 1, j + 1, this.n); this.n -= j - i; }
  }
  get full(): boolean { return this.n === 1 && this.a[0] <= 0 && this.b[0] >= 4; }
}

/** Direction of (dx, dz) as a number that grows with the angle from +x round through +z: 0..4, no trigonometry. */
const pa = (dx: number, dz: number): number => (dz < 0 ? 3 + dx / (Math.abs(dx) - dz) : 1 - dx / (Math.abs(dx) + dz));

/** Two running 32-bit hashes (FNV-1a and a multiply-rotate) over whole numbers. */
class Hash {
  a = 0x811c9dc5; b = 0x9e3779b9;
  add(v: number): void {
    this.a = Math.imul(this.a ^ (v & 0xffff), 0x01000193); this.a = Math.imul(this.a ^ (v >>> 16), 0x01000193);
    this.b = Math.imul(this.b ^ v, 0x85ebca6b); this.b = (this.b << 13) | (this.b >>> 19);
  }
  all(list: ArrayLike<number>): void { for (let i = 0; i < list.length; i++) this.add(list[i]); }
  /** The bit patterns of 32-bit floats. */
  floats(list: Float32Array): void { this.all(new Uint32Array(list.buffer, list.byteOffset, list.length)); }
}

/** Bytes of whole numbers, seven bits at a time. */
class Writer {
  buf = new Uint8Array(1 << 16); n = 0;
  u(v: number): void {
    if (this.n + 5 > this.buf.length) { const b = new Uint8Array(this.buf.length * 2); b.set(this.buf); this.buf = b; }
    while (v >= 0x80) { this.buf[this.n++] = (v & 0x7f) | 0x80; v = Math.floor(v / 128); }
    this.buf[this.n++] = v;
  }
}

export function buildCull(L: Level, S: Storeys, fogFar: number, add: (e: pc.Entity) => pc.Entity, mesh: (g: Geo) => pc.Mesh): WorldCull {
  const { W, H } = L, def = L.def, { levels, WH, wall, base, top, look } = S;
  const off = MODE === 'off';
  /** Storeys, walls and floors hide things only on maps that have storeys (a flat map draws no wall-against-wall faces). */
  const occl = !off && levels > 1;
  const blkW = BLK * T;
  /** The grid of boxes, with a part's width of margin each side for what lies off the map. */
  const nbx = Math.ceil(W / BLK) + 2 * RB, nbz = Math.ceil(H / BLK) + 2 * RB, nBox = levels * nbz * nbx;

  // ------------------------------------------------------------------ meshes, parts, boxes
  const batches: Batch[] = [], slotMesh: pc.Mesh[] = [], slotMi: pc.MeshInstance[] = [], extra: pc.Mesh[] = [];
  /** Per part: its range of the index buffer (indices), its boxes `pBox[p]..pBox[p + 1]`, its mesh. */
  const pBase: number[] = [], pCount: number[] = [], pBox: number[] = [0], pBatch: number[] = [];

  /** Six numbers a box (x0, y0, z0, x1, y1, z1). */
  let boxes = new Float32Array(6 * 4096), nb = 0;
  let totalTris = 0, sealed = false;
  // (Scratch for put(): triangles per box, each box's bounds, and where its triangles go.)
  const bCount = new Int32Array(nBox), bAt = new Int32Array(nBox), bBounds = new Float32Array(nBox * 6);
  let triBox = new Int32Array(1 << 16);

  function batch(g: Geo, mat: pc.Material, n: number): pc.MeshInstance[] {
    const m0 = mesh(g), ms = [m0];
    for (let j = 1; j < n; j++) {
      // The same buffers, drawn as another range. (Held here: freed in dispose(), without the buffers.)
      const m = new pc.Mesh(m0.device);
      m.vertexBuffer = m0.vertexBuffer; m.indexBuffer[0] = m0.indexBuffer[0];
      m.primitive[0] = { ...m0.primitive[0] };
      m.aabb = m0.aabb.clone();
      m.incRefCount();
      extra.push(m); ms.push(m);
    }
    const mis = [...add(meshEntity(ms, ms.map(() => mat))).render!.meshInstances];
    for (let j = 0; j < n; j++) { slotMesh.push(ms[j]); slotMi.push(mis[j]); if (j) mis[j].visible = false; }
    return mis;
  }

  function put(g: Geo, mat: pc.Material, deco = false): pc.MeshInstance[] {
    const idx = g.idx, nt = idx.length / 3;
    if (!nt) return [];
    if (sealed) throw new Error('cull: put() after the first update()');
    totalTris += nt;
    const p0 = pBase.length, slot = slotMesh.length;
    if (off) {
      pBase.push(0); pCount.push(nt * 3); pBox.push(nb); pBatch.push(batches.length);
      batches.push({ deco, p0, p1: p0 + 1, slot, n: 1, tris: nt });
      return batch(g, mat, 1);
    }
    // Each triangle goes to the box its middle is in: storey, then 8 m cell.
    // (Typed positions: quicker to read here, and geo.ts `toMesh` wants them anyway.)
    const pos = new Float32Array(g.pos);
    if (triBox.length < nt) triBox = new Int32Array(nt * 2);
    bCount.fill(0);
    const sTop = levels - 1, iTop = nbx - 1, jTop = nbz - 1, third = 1 / 3, perBox = third / blkW, perStorey = third / STOREY, lift = 1e-3 / STOREY;
    for (let t = 0, t3 = 0; t < nt; t++, t3 += 3) {
      const a = idx[t3] * 3, b = idx[t3 + 1] * 3, c = idx[t3 + 2] * 3;
      const ax = pos[a], ay = pos[a + 1], az = pos[a + 2], bx = pos[b], by = pos[b + 1], bz = pos[b + 2], cx = pos[c], cy = pos[c + 1], cz = pos[c + 2];
      let s = Math.floor((ay + by + cy) * perStorey + lift), i = Math.floor((ax + bx + cx) * perBox) + RB, j = Math.floor((az + bz + cz) * perBox) + RB;
      if (s < 0) s = 0; else if (s > sTop) s = sTop;
      if (i < 0) i = 0; else if (i > iTop) i = iTop;
      if (j < 0) j = 0; else if (j > jTop) j = jTop;
      const k = (s * nbz + j) * nbx + i, o = k * 6;
      let x0 = ax, x1 = ax, y0 = ay, y1 = ay, z0 = az, z1 = az;
      if (bx < x0) x0 = bx; else if (bx > x1) x1 = bx;
      if (cx < x0) x0 = cx; else if (cx > x1) x1 = cx;
      if (by < y0) y0 = by; else if (by > y1) y1 = by;
      if (cy < y0) y0 = cy; else if (cy > y1) y1 = cy;
      if (bz < z0) z0 = bz; else if (bz > z1) z1 = bz;
      if (cz < z0) z0 = cz; else if (cz > z1) z1 = cz;
      const yFloor = s * STOREY;
      if (y0 < yFloor && y0 >= yFloor - DIP) y0 = y1 < yFloor ? y1 : yFloor;
      if (!bCount[k]++) { bBounds[o] = x0; bBounds[o + 1] = y0; bBounds[o + 2] = z0; bBounds[o + 3] = x1; bBounds[o + 4] = y1; bBounds[o + 5] = z1; }
      else {
        if (x0 < bBounds[o]) bBounds[o] = x0;
        if (y0 < bBounds[o + 1]) bBounds[o + 1] = y0;
        if (z0 < bBounds[o + 2]) bBounds[o + 2] = z0;
        if (x1 > bBounds[o + 3]) bBounds[o + 3] = x1;
        if (y1 > bBounds[o + 4]) bBounds[o + 4] = y1;
        if (z1 > bBounds[o + 5]) bBounds[o + 5] = z1;
      }
      triBox[t] = k;
    }
    // The order of the index buffer: storey, part, box. So a storey is one range of it, and a part is.
    let at = 0;
    for (let s = 0; s < levels; s++) for (let pj = 0; pj < nbz; pj += RB) for (let pi = 0; pi < nbx; pi += RB) {
      const from = at;
      for (let j = pj; j < Math.min(nbz, pj + RB); j++) for (let i = pi; i < Math.min(nbx, pi + RB); i++) {
        const k = (s * nbz + j) * nbx + i;
        if (!bCount[k]) continue;
        bAt[k] = at; at += bCount[k] * 3;
        if ((nb + 1) * 6 > boxes.length) { const n = new Float32Array(boxes.length * 2); n.set(boxes); boxes = n; }
        for (let q = 0; q < 6; q++) boxes[nb * 6 + q] = bBounds[k * 6 + q];
        nb++;
      }
      if (at > from) { pBase.push(from); pCount.push(at - from); pBox.push(nb); pBatch.push(batches.length); }
    }
    const sorted = new Uint32Array(nt * 3);
    for (let t = 0, t3 = 0; t < nt; t++, t3 += 3) {
      const k = triBox[t], o = bAt[k];
      sorted[o] = idx[t3]; sorted[o + 1] = idx[t3 + 1]; sorted[o + 2] = idx[t3 + 2];
      bAt[k] = o + 3;
    }
    const p1 = pBase.length, n = Math.min(SLOTS, p1 - p0);
    batches.push({ deco, p0, p1, slot, n, tris: nt });
    // (Typed arrays where a Geo has plain ones: `toMesh` only copies them.)
    return batch({ pos: pos as unknown as number[], nor: g.nor, col: g.col, uv: g.uv, idx: sorted as unknown as number[] }, mat, n);
  }

  // ------------------------------------------------------------------ what blocks a sight line
  const inb = (x: number, z: number) => x >= 0 && z >= 0 && x < W && z < H;
  /**
   * A wall that stops within 6 cm of the next floor line: its taller neighbours draw no face towards it
   * (arch.ts `pieces`), so a line can slip over it and into them. No map has one; if one ever does, the
   * walls round it count as neither solid nor blocking.
   */
  const shy = (x: number, z: number, k: number): boolean => { if (!inb(x, z)) return false; const n = k * WH + z * W + x, y = (k + 1) * STOREY; return wall[n] === 1 && top[n] < y - 1e-3 && top[n] >= y - 0.06; };
  const byShy = (x: number, z: number, k: number): boolean => shy(x + 1, z, k) || shy(x - 1, z, k) || shy(x, z + 1, k) || shy(x, z - 1, k);
  /** Wall from the floor of storey k right up to the next floor line (off the map counts: no line of sight leaves it). */
  const fullAt = (x: number, z: number, k: number): boolean => { if (!inb(x, z)) return true; const n = k * WH + z * W + x; return wall[n] === 1 && top[n] >= (k + 1) * STOREY - 1e-3 && !byShy(x, z, k); };
  /** Per storey: the blocking rectangles of each tile (x0, z0, x1, z1), `rs[c]..rs[c + 1]`; and 0 for tiles deep inside a wall mass, which the sweep can skip. */
  const rects: Float64Array[] = [], rs: Int32Array[] = [], rim: Uint8Array[] = [];
  /**
   * Per floor plane p (between storeys p - 1 and p; `levels` = above the top storey): 1 where a line can pass,
   * and the summed-area tables of each. Going down there is one height to pass: the floor line (upper floors,
   * wall tops; a roof slab stands above it, but has sides). Going up there are two, and a line has to pass
   * both: `openA` at the slab undersides (SLAB_T below the line; a room's ceiling is higher, so its tiles
   * are open here), `openB` at the ceilings (3 cm below the line; a slab's underside is lower, so the tiles
   * over open ground are open here). One test at the floor line would miss the line that slips in sideways
   * between a ceiling and the underside next to it, and on up through the back of the floor.
   */
  const openA: Uint8Array[] = [], openB: Uint8Array[] = [], dnOpen: Uint8Array[] = [], satA: Int32Array[] = [], satB: Int32Array[] = [], dnSat: Int32Array[] = [];
  const SW = W + 1;
  const sat = (m: Uint8Array, out: Int32Array = new Int32Array(SW * (H + 1))): Int32Array => {
    for (let z = 0; z < H; z++) { let row = 0; for (let x = 0; x < W; x++) { row += m[z * W + x]; out[(z + 1) * SW + x + 1] = out[z * SW + x + 1] + row; } }
    return out;
  };
  /** Tiles of the camera's storey some sight line reaches, and the open plane tiles among them above and below. */
  let seen!: Uint8Array, tmp!: Uint8Array, seenSat!: Int32Array, aboveA!: Int32Array, aboveB!: Int32Array, belowSat!: Int32Array;
  let blockers = false;
  /** Only a tile worked out on the spot needs these (a chapter with a good bake never does). */
  function buildBlockers(): void {
    if (blockers) return;
    blockers = true;
    seen = new Uint8Array(WH); tmp = new Uint8Array(WH);
    seenSat = new Int32Array(SW * (H + 1)); aboveA = new Int32Array(SW * (H + 1)); aboveB = new Int32Array(SW * (H + 1)); belowSat = new Int32Array(SW * (H + 1));
    for (let k = 0; k < levels; k++) {
      const r: number[] = [], start = new Int32Array(WH + 1), edge = new Uint8Array(WH).fill(1);
      for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
        start[z * W + x] = r.length / 4;
        if (!fullAt(x, z, k)) continue;
        // Walled in on all eight sides: nothing of it faces the open, and the walls round it shut it in.
        if (fullAt(x - 1, z, k) && fullAt(x + 1, z, k) && fullAt(x, z - 1, k) && fullAt(x, z + 1, k) && fullAt(x - 1, z - 1, k) && fullAt(x + 1, z - 1, k) && fullAt(x - 1, z + 1, k) && fullAt(x + 1, z + 1, k)) { edge[z * W + x] = 0; continue; }
        // The wall mass shrunk by SLACK, as two rectangles per tile: one as wide as it can be, one as deep. A
        // side stays flush where the wall goes on, and steps back where that would reach round an open corner.
        const w = fullAt(x - 1, z, k), e = fullAt(x + 1, z, k), n = fullAt(x, z - 1, k), s = fullAt(x, z + 1, k);
        const nw = fullAt(x - 1, z - 1, k), ne = fullAt(x + 1, z - 1, k), sw = fullAt(x - 1, z + 1, k), se = fullAt(x + 1, z + 1, k);
        const x0 = x * T, z0 = z * T, x1 = x0 + T, z1 = z0 + T, d = SLACK;
        const hx0 = x0 + (w ? 0 : d), hx1 = x1 - (e ? 0 : d), hz0 = z0 + (!n || (w && !nw) || (e && !ne) ? d : 0), hz1 = z1 - (!s || (w && !sw) || (e && !se) ? d : 0);
        const vz0 = z0 + (n ? 0 : d), vz1 = z1 - (s ? 0 : d), vx0 = x0 + (!w || (n && !nw) || (s && !sw) ? d : 0), vx1 = x1 - (!e || (n && !ne) || (s && !se) ? d : 0);
        r.push(hx0, hz0, hx1, hz1);
        if (vx0 !== hx0 || vx1 !== hx1 || vz0 !== hz0 || vz1 !== hz1) r.push(vx0, vz0, vx1, vz1);
      }
      start[WH] = r.length / 4;
      rects.push(Float64Array.from(r)); rs.push(start); rim.push(edge);
    }
    // A wall column stops a line going up only if the line cannot be inside the wall. It can: a wall that
    // starts upstairs has no bottom face (over a room there are 3 cm between the ceiling and its foot), and
    // inside, walls that touch are one mass with no faces between them, right up through the roof.
    const hollow: Uint8Array[] = [];
    for (let k = 0; k < levels; k++) {
      const h = new Uint8Array(WH), todo: number[] = [];
      for (let c = 0; c < WH; c++) {
        const n = k * WH + c, lo = n - WH;
        if (!wall[n]) continue;
        const onWall = k === 0 || (wall[lo] === 1 && top[lo] >= k * STOREY - 1e-3);
        if ((onWall ? k > 0 && hollow[k - 1][c] : 1) || byShy(c % W, (c / W) | 0, k)) { h[c] = 1; todo.push(c); }
      }
      while (todo.length) {
        const c = todo.pop()!, x = c % W, z = (c / W) | 0;
        for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ax = x + ox, az = z + oz, m = az * W + ax;
          if (inb(ax, az) && !h[m] && wall[k * WH + m]) { h[m] = 1; todo.push(m); }
        }
      }
      hollow.push(h);
    }
    // These mirror what is drawn across each plane: ceilings (arch.ts), slab undersides (storeys.ts), upper
    // floors (ground.ts), roofs and wall tops (arch.ts). Anything not listed there leaves the tile open.
    for (let p = 0; p <= levels; p++) {
      const a = new Uint8Array(WH), b = new Uint8Array(WH), dn = new Uint8Array(WH);
      if (p > 0) for (let c = 0; c < WH; c++) {
        const lo = (p - 1) * WH + c, hi = p < levels ? p * WH + c : -1, yp = p * STOREY;
        const wallLo = wall[lo] === 1, massLo = wallLo && top[lo] >= yp - 1e-3, roomLo = !wallLo && isIndoor(look[lo]) && !def.ramp[lo];
        const floorHi = hi >= 0 && def.floor[hi] !== F.NONE, wallHi = hi >= 0 && wall[hi] === 1;
        const under = !wallLo && !isIndoor(look[lo]) && (floorHi || (wallHi && base[hi] === yp));
        const solid = massLo && !hollow[p - 1][c];
        a[c] = solid || under ? 0 : 1;
        b[c] = solid || roomLo ? 0 : 1;
        const roofed = roomLo && hi >= 0 && !floorHi && !wallHi && !isIndoor(look[hi]);
        dn[c] = floorHi || (wallHi && top[hi] > yp + 0.01) || massLo || roofed ? 0 : 1;
      }
      openA.push(a); openB.push(b); dnOpen.push(dn); satA.push(sat(a)); satB.push(sat(b)); dnSat.push(sat(dn));
    }
  }

  // ------------------------------------------------------------------ the wall sweep
  const spans = new Spans();
  let pend = new Float64Array(256), np = 0;
  let px = 0, pz = 0;
  /** Directions the rectangle covers from (px, pz) into e0..e1; 0 = the point is in it, 2 = the span wraps (e0..4 and 0..e1). */
  let e0 = 0, e1 = 0;
  function extent(x0: number, z0: number, x1: number, z1: number): number {
    if (x0 <= px && px <= x1 && z0 <= pz && pz <= z1) return 0;
    const a = pa(x0 - px, z0 - pz), b = pa(x1 - px, z0 - pz), c = pa(x0 - px, z1 - pz), d = pa(x1 - px, z1 - pz);
    if (x0 > px && z0 < pz && z1 >= pz) { e0 = Math.min(a, b); e1 = Math.max(c, d); return 2; }
    e0 = Math.min(a, b, c, d); e1 = Math.max(a, b, c, d);
    return 1;
  }
  /** Marks in `seen` the tiles of storey k that some sight line from (px, pz), or from within SLACK of it, reaches. */
  function los(k: number): void {
    spans.n = 0;
    const cx = Math.floor(px / T), cz = Math.floor(pz / T), R = Math.max(cx, W - 1 - cx, cz, H - 1 - cz);
    const r4 = rects[k], st = rs[k], edge = rim[k];
    seen[cz * W + cx] = 1;
    const visit = (x: number, z: number): void => {
      if (!edge[z * W + x]) return;
      const kind = extent(x * T, z * T, x * T + T, z * T + T);
      if (kind === 1 ? spans.covers(e0, e1) : kind === 2 && spans.covers(e0, 4) && spans.covers(0, e1)) return;
      const c = z * W + x;
      seen[c] = 1;
      // Its walls block the tiles of the rings beyond, not its own ring's.
      for (let i = st[c]; i < st[c + 1]; i++) {
        const q = extent(r4[i * 4], r4[i * 4 + 1], r4[i * 4 + 2], r4[i * 4 + 3]);
        if (!q) continue;
        if (np + 4 > pend.length) { const n = new Float64Array(pend.length * 2); n.set(pend); pend = n; }
        if (q === 1) { pend[np++] = e0; pend[np++] = e1; } else { pend[np++] = e0; pend[np++] = 4; pend[np++] = 0; pend[np++] = e1; }
      }
    };
    for (let r = 1; r <= R && !spans.full; r++) {
      const xa = Math.max(0, cx - r), xb = Math.min(W - 1, cx + r), za = Math.max(0, cz - r), zb = Math.min(H - 1, cz + r);
      if (cz - r >= 0) for (let x = xa; x <= xb; x++) visit(x, cz - r);
      if (cz + r < H) for (let x = xa; x <= xb; x++) visit(x, cz + r);
      const zc = Math.max(za, cz - r + 1), zd = Math.min(zb, cz + r - 1);
      if (cx - r >= 0) for (let z = zc; z <= zd; z++) visit(cx - r, z);
      if (cx + r < W) for (let z = zc; z <= zd; z++) visit(cx + r, z);
      for (let i = 0; i < np; i += 2) spans.add(pend[i], pend[i + 1]);
      np = 0;
    }
  }
  /** The sweeps for every eye in the square of `n` x `n` tiles at tile (tx, tz) of storey k. */
  let sweptAt = -1;
  function sweep(tx: number, tz: number, n: number, k: number): void {
    const key = ((k * H + tz) * W + tx) * 8 + n;
    if (key === sweptAt) return;
    sweptAt = key;
    seen.fill(0);
    for (let z = tz; z < Math.min(H, tz + n); z++) for (let x = tx; x < Math.min(W, tx + n); x++) {
      if (wall[k * WH + z * W + x]) continue; // no eye in there
      for (const oz of [0.25, 0.75]) for (const ox of [0.25, 0.75]) { px = (x + ox) * T; pz = (z + oz) * T; los(k); }
    }
    sat(seen, seenSat);
    const a = openA[k + 1], b = openB[k + 1], dn = dnOpen[k];
    for (let i = 0; i < WH; i++) tmp[i] = seen[i] & a[i];
    sat(tmp, aboveA);
    for (let i = 0; i < WH; i++) tmp[i] = seen[i] & b[i];
    sat(tmp, aboveB);
    for (let i = 0; i < WH; i++) tmp[i] = seen[i] & dn[i];
    sat(tmp, belowSat);
  }

  // ------------------------------------------------------------------ per box
  /** Where the eye can be: a tile (ex0..ex1, ez0..ez1), a range of heights, and its storey. */
  let ex0 = 0, ex1 = 0, ez0 = 0, ez1 = 0, ey0 = 0, ey1 = 0, slab = 0;
  /** How many marked tiles the rectangle touches. */
  const count = (s: Int32Array, x0: number, z0: number, x1: number, z1: number): number => {
    const i0 = Math.max(0, Math.floor((x0 - EPS) / T)), i1 = Math.min(W - 1, Math.floor((x1 + EPS) / T)), j0 = Math.max(0, Math.floor((z0 - EPS) / T)), j1 = Math.min(H - 1, Math.floor((z1 + EPS) / T));
    if (i0 > i1 || j0 > j1) return 0;
    return s[(j1 + 1) * SW + i1 + 1] - s[j0 * SW + i1 + 1] - s[(j1 + 1) * SW + i0] + s[j0 * SW + i0];
  };
  /** How far along the way from an eye at height ey to a point at height qy the plane at yp is crossed (0..1). */
  const cross = (yp: number, ey: number, qy: number): number => {
    // (An eye exactly on the plane sees along it: every line crosses at the eye.)
    const d = yp - ey;
    return d === 0 ? 0 : Math.max(0, Math.min(1, d / (qy - ey)));
  };
  /**
   * Where sight lines from the eye to the box (heights ya..yb, all beyond plane height yp) cross that plane: does it
   * touch a marked tile? The crossing point moves one way with each of the eye's and the point's coordinates, so its
   * range over all eyes and all points is reached at their extremes.
   */
  const through = (s: Int32Array, yp: number, x0: number, z0: number, x1: number, z1: number, ya: number, yb: number): boolean => {
    const t0 = cross(yp, ey0, ya), t1 = cross(yp, ey0, yb), t2 = cross(yp, ey1, ya), t3 = cross(yp, ey1, yb);
    const ta = Math.min(t0, t1, t2, t3), tb = Math.max(t0, t1, t2, t3);
    return count(s,
      ex0 + Math.min((x0 - ex0) * ta, (x0 - ex0) * tb), ez0 + Math.min((z0 - ez0) * ta, (z0 - ez0) * tb),
      ex1 + Math.max((x1 - ex1) * ta, (x1 - ex1) * tb), ez1 + Math.max((z1 - ez1) * ta, (z1 - ez1) * tb)) > 0;
  };
  const mapX = W * T, mapZ = H * T;
  function visible(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
    if (x0 < 0 || z0 < 0 || x1 > mapX || z1 > mapZ) return true;
    const yLo = slab * STOREY, yHi = yLo + STOREY, e = 1e-4;
    // The part on the camera's own storey.
    if ((y0 < yHi - e || y1 <= yHi + e) && (y1 > yLo + e || y0 >= yLo - e) && count(seenSat, x0, z0, x1, z1) > 0) return true;
    // The part above: through every floor plane on the way up.
    if (y1 > yHi + e) {
      const ya = Math.max(y0, yHi);
      let ok = true;
      // (Not the plane over the top storey for what lies in it: that is the top ceilings themselves, drawn at that very height.)
      for (let p = slab + 1; ok && p <= levels && p * STOREY <= ya + e && (p < levels || y1 > p * STOREY + e); p++) {
        // (An eye that can be above one of the two heights has no need to pass it.)
        const hA = p * STOREY - SLAB_T, hB = p < levels ? p * STOREY - 0.03 : p * STOREY, near = p === slab + 1;
        ok = (hA <= ey1 || through(near ? aboveA : satA[p], hA, x0, z0, x1, z1, ya, y1)) && (hB <= ey1 || through(near ? aboveB : satB[p], hB, x0, z0, x1, z1, ya, y1));
      }
      if (ok) return true;
    }
    // The part below.
    if (y0 < yLo - e) {
      const yb = Math.min(y1, yLo);
      let ok = true;
      for (let p = slab; ok && p >= 1 && p * STOREY >= yb - e; p--) ok = through(p === slab ? belowSat : dnSat[p], p * STOREY, x0, z0, x1, z1, yb, y0);
      if (ok) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ per tile
  const far = fogFar + FOG_MARGIN, far2 = far * far;
  let vis = new Uint8Array(0);
  /** The box round each part (six numbers, as the boxes). */
  let pBound = new Float32Array(0);
  /** Into `vis`: 1 for each part some eye in the square of `n` x `n` tiles at tile (tx, tz) of storey k, at a height in `band`, can see. */
  function compute(tx: number, tz: number, n: number, k: number, band: number): void {
    ex0 = tx * T; ex1 = Math.min(W, tx + n) * T; ez0 = tz * T; ez1 = Math.min(H, tz + n) * T;
    ey0 = k * STOREY + BANDS[band][0]; ey1 = k * STOREY + BANDS[band][1]; slab = k;
    if (occl) { buildBlockers(); sweep(tx, tz, n, k); }
    const b = boxes, hard = MODE === 'hard';
    for (let p = 0; p < vis.length; p++) {
      const fog = hard || batches[pBatch[p]].deco;
      let show = 0;
      for (let i = pBox[p] * 6, end = pBox[p + 1] * 6; i < end && !show; i += 6) {
        if (fog) {
          const dx = Math.max(b[i] - ex1, ex0 - b[i + 3], 0), dy = Math.max(b[i + 1] - ey1, ey0 - b[i + 4], 0), dz = Math.max(b[i + 2] - ez1, ez0 - b[i + 5], 0);
          if (dx * dx + dy * dy + dz * dz > far2) continue;
        }
        if (!occl || visible(b[i], b[i + 1], b[i + 2], b[i + 3], b[i + 4], b[i + 5])) show = 1;
      }
      vis[p] = show;
    }
  }

  /** The ranges that draw the parts marked in `v`: per mesh as many as it has slots, closing the smallest gaps first. */
  const runs: number[] = [], out: number[] = [];
  function drawList(v: Uint8Array): DrawList {
    const b = pBound;
    let tris = 0, parts = 0;
    out.length = 0;
    for (const bt of batches) {
      runs.length = 0;
      for (let p = bt.p0; p < bt.p1; p++) {
        if (!v[p]) continue;
        parts++;
        if (runs.length && runs[runs.length - 1] === p - 1) runs[runs.length - 1] = p; else runs.push(p, p);
      }
      while (runs.length > bt.n * 2) {
        let at = 2, least = Infinity;
        for (let i = 2; i < runs.length; i += 2) { const gap = pBase[runs[i]] - pBase[runs[i - 1]] - pCount[runs[i - 1]]; if (gap < least) { least = gap; at = i; } }
        runs.splice(at - 1, 2);
      }
      for (let r = 0; r < runs.length; r += 2) {
        const pa = runs[r], pb = runs[r + 1], count = pBase[pb] + pCount[pb] - pBase[pa];
        let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
        // (Only of the parts in sight: what the range draws between them is in nobody's view.)
        for (let p = pa, i = pa * 6; p <= pb; p++, i += 6) if (v[p]) {
          x0 = Math.min(x0, b[i]); y0 = Math.min(y0, b[i + 1]); z0 = Math.min(z0, b[i + 2]); x1 = Math.max(x1, b[i + 3]); y1 = Math.max(y1, b[i + 4]); z1 = Math.max(z1, b[i + 5]);
        }
        out.push(bt.slot + r / 2, pBase[pa], count, x0, y0 - DIP, z0, x1, y1, z1);
        tris += count / 3;
      }
    }
    const n = out.length / 9, dl: DrawList = { slot: new Int32Array(n), base: new Int32Array(n), count: new Int32Array(n), box: new Float32Array(n * 6), tris, parts };
    for (let i = 0; i < n; i++) { dl.slot[i] = out[i * 9]; dl.base[i] = out[i * 9 + 1]; dl.count[i] = out[i * 9 + 2]; for (let q = 0; q < 6; q++) dl.box[i * 6 + q] = out[i * 9 + 3 + q]; }
    return dl;
  }
  /** The list in force, and per slot the last change that turned it on. */
  let current: DrawList | null = null, turn = 0, onAt = new Int32Array(0);
  function apply(dl: DrawList): void {
    if (dl === current) return;
    if (onAt.length !== slotMesh.length) onAt = new Int32Array(slotMesh.length);
    const { slot, base, count: cnt, box } = dl;
    turn++;
    for (let i = 0; i < slot.length; i++) {
      const s = slot[i], m = slotMesh[s], prim = m.primitive[0], o = i * 6, bb = m.aabb;
      onAt[s] = turn;
      prim.base = base[i]; prim.count = cnt[i];
      bb.center.set((box[o] + box[o + 3]) / 2, (box[o + 1] + box[o + 4]) / 2, (box[o + 2] + box[o + 5]) / 2);
      bb.halfExtents.set((box[o + 3] - box[o]) / 2, (box[o + 4] - box[o + 1]) / 2, (box[o + 5] - box[o + 2]) / 2);
      m.aabb = bb; // (tells its mesh instance the box changed)
      slotMi[s].visible = true;
    }
    // Off: what the list before had on and this one has not (at first: everything else).
    if (current) { const was = current.slot; for (let i = 0; i < was.length; i++) if (onAt[was[i]] !== turn) slotMi[was[i]].visible = false; }
    else for (let s = 0; s < slotMi.length; s++) if (onAt[s] !== turn) slotMi[s].visible = false;
    current = dl;
  }

  // ------------------------------------------------------------------ the table
  /**
   * From the bake. Per band, storey and square of CELL x CELL tiles: which of the `sets` is its own (-1: not
   * baked). Per set: a bit per class of parts (parts that are in sight from exactly the same squares are one class).
   */
  const CW = Math.ceil(W / CELL), CH = Math.ceil(H / CELL), perStorey = CW * CH, perBand = levels * perStorey, nCells = BANDS.length * perBand;
  let table: Int32Array | null = null, sets = new Uint8Array(0), setBytes = 0, classOf = new Uint16Array(0);
  /** Lists made so far: by set (cheap to make again: only the last few hundred are kept), and by tile for those worked out on the spot. */
  const setLists = new Map<number, DrawList>(), liveLists = new Map<number, DrawList>();
  const keep = (m: Map<number, DrawList>, key: number, dl: DrawList, cap: number): DrawList => { if (m.size >= cap) m.delete(m.keys().next().value!); m.set(key, dl); return dl; };
  /**
   * A square's set is kept as its difference from a guess made from the squares before it. Guess 3, for a
   * square with baked squares to its west, north and north-west: what the west one sees, changed as the
   * north one differs from the north-west one. So a part that comes into sight along a line running north
   * to south or west to east costs nothing beyond its ends.
   * (0: nothing. 1: the west square. 2: the north one. 4: the same square a band lower. 5: a storey lower.)
   */
  const GUESSES = 6;
  /** Fills `out` (at `o`) with guess `g` for square `i` (column cx, row cz of its storey), given where each square's set is (`at`, -1: none), `n` 32-bit words a set; false if the guess needs a square that has none. */
  function guess(g: number, i: number, cx: number, cz: number, at: Int32Array, data: Uint32Array, n: number, out: Uint32Array, o: number): boolean {
    const w = cx ? at[i - 1] : -1, nn = cz ? at[i - CW] : -1, nw = cx && cz ? at[i - CW - 1] : -1;
    const from = g === 1 ? w : g === 2 ? nn : g === 4 ? (i >= perBand ? at[i - perBand] : -1) : g === 5 ? (i % perBand >= perStorey ? at[i - perStorey] : -1) : 0;
    if (g === 0) { out.fill(0, o, o + n); return true; }
    if (g === 3) {
      if (w < 0 || nn < 0 || nw < 0) return false;
      for (let j = 0; j < n; j++) out[o + j] = data[w * n + j] ^ data[nn * n + j] ^ data[nw * n + j];
      return true;
    }
    if (from < 0) return false;
    for (let j = 0; j < n; j++) out[o + j] = data[from * n + j];
    return true;
  }
  let everything!: DrawList;

  function hashOf(): [number, number] {
    const h = new Hash();
    h.all([VERSION, SUB, BLK, CELL, W, H, levels, pBase.length, nb]);
    h.floats(Float32Array.of(T, STOREY, SLAB_T, far, SLACK, EPS, DIP, ...BANDS.flat()));
    h.all(pBase); h.all(pCount); h.all(pBox); h.all(pBatch);
    for (const b of batches) h.add(b.deco ? 1 : 0);
    h.floats(boxes.subarray(0, nb * 6));
    h.all(wall); h.floats(base); h.floats(top); h.all(look); h.all(def.floor); h.all(def.ramp); h.all(def.air);
    return [h.a >>> 0, h.b >>> 0];
  }

  /** Reads the chapter's table, if it is the one for this geometry. */
  function adopt(text: string | undefined): void {
    let why = 'none baked';
    if (text) {
      const [ha, hb] = hashOf(), bin = atob(text), d = new Uint8Array(bin.length);
      for (let i = 0; i < d.length; i++) d[i] = bin.charCodeAt(i);
      const head = new DataView(d.buffer);
      if (d.length >= HEAD && head.getUint32(0, true) === MAGIC && head.getUint32(4, true) === ha && head.getUint32(8, true) === hb && head.getUint32(12, true) === pBase.length && head.getUint32(24, true) === nCells) {
        const nSets = head.getUint32(16, true), nClasses = head.getUint32(20, true);
        let at = HEAD;
        const u = (): number => { let v = 0, m = 1; for (;;) { const x = d[at++]; v += (x & 0x7f) * m; if (x < 0x80) return v; m *= 128; } };
        classOf = new Uint16Array(pBase.length);
        for (let p = 0; p < classOf.length; p++) classOf[p] = u();
        // Runs of squares without and with a set, in turn; then each set as the classes that differ from a guess.
        const tb = new Int32Array(nCells).fill(-1);
        for (let i = 0, n = 0, on = false; i < nCells; on = !on) { const run = u(); if (on) for (let j = i; j < i + run; j++) tb[j] = n++; i += run; }
        setBytes = ((nClasses + 31) >> 5) * 4;
        sets = new Uint8Array(nSets * setBytes);
        const words = new Uint32Array(sets.buffer), nw = setBytes / 4;
        for (let i = 0; i < nCells; i++) {
          const s = tb[i];
          if (s < 0) continue;
          const o = s * setBytes, v = u(), c0 = i % perStorey;
          guess(v % GUESSES, i, c0 % CW, (c0 / CW) | 0, tb, words, nw, words, s * nw);
          for (let n = Math.floor(v / GUESSES), c = -1; n > 0; n--) { c += u() + 1; sets[o + (c >> 3)] ^= 1 << (c & 7); }
        }
        table = tb;
        lastKey = -2; // (look the camera's square up again)
        return;
      }
      why = 'the one baked is for other geometry';
    }
    stale = true;
    console.warn(`cull: no visibility table for ${def.id} (${why}): working it out as the camera moves. Run \`npm run bake:cull\`.`);
  }

  /** No table (yet): false while one is on its way, true once it is known there is none to use. */
  let stale = false, gone = false;
  let ready: Promise<void> = Promise.resolve();
  function seal(): void {
    if (sealed) return;
    sealed = true;
    vis = new Uint8Array(pBase.length).fill(1);
    pBound = new Float32Array(pBase.length * 6);
    for (let p = 0; p < pBase.length; p++) {
      const o = p * 6;
      pBound[o] = pBound[o + 1] = pBound[o + 2] = Infinity; pBound[o + 3] = pBound[o + 4] = pBound[o + 5] = -Infinity;
      for (let i = pBox[p] * 6, end = pBox[p + 1] * 6; i < end; i += 6) for (let q = 0; q < 3; q++) { pBound[o + q] = Math.min(pBound[o + q], boxes[i + q]); pBound[o + 3 + q] = Math.max(pBound[o + 3 + q], boxes[i + 3 + q]); }
    }
    everything = drawList(vis);
    if (off) return;
    if (!occl || MODE === 'live' || MODE === 'hard') { stale = true; return; }
    const load = PVS[def.id];
    if (!load) { adopt(undefined); return; }
    // (The table is a file of its own, fetched now: until it is here everything is drawn.)
    ready = load().then((m) => { if (!gone) adopt(m.default); }, () => { if (!gone) adopt(undefined); });
  }

  let ms = 0, losMs = 0, lives = 0;
  /** What to draw from tile (tx, tz) of storey k with the eye in `band`. */
  function listFor(tx: number, tz: number, k: number, band: number): DrawList {
    // (A higher band's answer holds for a lower band's eyes too: stairs and drops are baked for the high ones only.)
    if (table) for (let b = band; b < BANDS.length; b++) {
      const id = table[((b * levels + k) * CH + ((tz / CELL) | 0)) * CW + ((tx / CELL) | 0)];
      if (id < 0) continue;
      let dl = setLists.get(id);
      if (!dl) {
        const o = id * setBytes;
        for (let p = 0; p < vis.length; p++) { const c = classOf[p]; vis[p] = (sets[o + (c >> 3)] >> (c & 7)) & 1; }
        dl = keep(setLists, id, drawList(vis), 512);
      }
      return dl;
    }
    if (!stale && !table) return everything;
    const key = (band * levels + k) * WH + tz * W + tx;
    let dl = liveLists.get(key);
    if (!dl) {
      const t0 = performance.now();
      compute(tx, tz, 1, k, band);
      dl = keep(liveLists, key, drawList(vis), 4096);
      losMs = performance.now() - t0; lives++;
    }
    return dl;
  }

  let lastKey = -2;
  function update(camX: number, camY: number, camZ: number): void {
    if (off) return;
    if (!sealed) seal();
    // Walls, floors and fog only count for an eye that is on the map, on a storey, and not inside a wall.
    let key = -1, tx = 0, tz = 0, k = 0, band = 0;
    if (camX >= 0 && camZ >= 0 && camX < mapX && camZ < mapZ && camY >= 0 && camY < levels * STOREY) {
      k = Math.floor(camY / STOREY); tx = Math.floor(camX / T); tz = Math.floor(camZ / T);
      const h = camY - k * STOREY;
      band = h <= BANDS[0][1] ? 0 : h <= BANDS[1][1] ? 1 : 2;
      if (!wall[k * WH + tz * W + tx]) key = (band * levels + k) * WH + tz * W + tx;
    }
    if (key === lastKey) return;
    lastKey = key;
    const began = performance.now();
    apply(key < 0 ? everything : listFor(tx, tz, k, band));
    ms = performance.now() - began;
  }

  /** Which bands of tile c on storey k a camera can be in (bits), going by the map. */
  function bakeBands(): Uint8Array {
    const out = new Uint8Array(levels * WH), floorAt = (n: number) => def.floor[n] !== F.NONE && !def.air[n];
    // A drop: open air within a jump of a floor of its own storey.
    const drop = new Uint8Array(levels * WH);
    for (let k = 1; k < levels; k++) for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const n = k * WH + z * W + x;
      if (!def.air[n]) continue;
      for (let az = Math.max(0, z - DROP_REACH); az <= Math.min(H - 1, z + DROP_REACH) && !drop[n]; az++) for (let ax = Math.max(0, x - DROP_REACH); ax <= Math.min(W - 1, x + DROP_REACH); ax++) {
        if (floorAt(k * WH + az * W + ax)) { drop[n] = 1; break; }
      }
    }
    for (let c = 0; c < WH; c++) {
      // (From the top down: `falls` = an eye falling through the drop above comes through this tile.)
      let falls = false;
      for (let k = levels - 1; k >= 0; k--) {
        const n = k * WH + c, air = def.air[n] === 1;
        if (!wall[n]) {
          const ramp = def.ramp[n] !== 0, onRamp = k > 0 && def.ramp[n - WH] !== 0;
          let m = 0;
          if (ramp) m |= 7; // climbing: the eye goes up through the floor line
          else if (floorAt(n)) m |= 1; // (the ride and spectator cameras, higher up, are worked out on the spot)
          if (air && (onRamp || drop[n])) m |= 1;
          if (falls) m |= 6;
          out[n] = m;
        }
        falls = air && (falls || drop[n] === 1);
      }
    }
    return out;
  }

  function bake(log?: (done: number, of: number) => void): Uint8Array | null {
    seal();
    if (!occl) return null;
    const bands = bakeBands(), P = pBase.length, bytes = (P + 7) >> 3;
    // Per square: the bands to bake. (Any tile of it says so. The answer is for every eye in the square.)
    const want = new Uint8Array(perBand);
    let total = 0, done = 0;
    for (let k = 0; k < levels; k++) for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) want[(k * CH + ((z / CELL) | 0)) * CW + ((x / CELL) | 0)] |= bands[k * WH + z * W + x];
    for (let i = 0; i < perBand; i++) for (let b = 0; b < BANDS.length; b++) if (want[i] & (1 << b)) total++;
    const at = new Int32Array(nCells).fill(-1), list: Uint8Array[] = [];
    for (let b = 0; b < BANDS.length; b++) for (let k = 0; k < levels; k++) for (let cz = 0; cz < CH; cz++) for (let cx = 0; cx < CW; cx++) {
      const i = (k * CH + cz) * CW + cx;
      if (!(want[i] & (1 << b))) continue;
      compute(cx * CELL, cz * CELL, CELL, k, b);
      const bits = new Uint8Array(bytes);
      for (let p = 0; p < P; p++) if (vis[p]) bits[p >> 3] |= 1 << (p & 7);
      at[b * perBand + i] = list.length; list.push(bits);
      if (log && (++done & 63) === 0) log(done, total);
    }
    // Parts in exactly the same sets are one class (checked bit for bit: the two hashes only sort them).
    const sa = new Uint32Array(P), sb = new Uint32Array(P);
    let seed = 0x2545f491;
    const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
    for (const s of list) { const ra = rnd(), rb = rnd(); for (let p = 0; p < P; p++) if ((s[p >> 3] >> (p & 7)) & 1) { sa[p] ^= ra; sb[p] ^= rb; } }
    const cls = new Uint16Array(P), first: number[] = [], byHash = new Map<string, number>();
    for (let p = 0; p < P; p++) {
      const key = `${sa[p]},${sb[p]}`;
      let c = byHash.get(key);
      if (c === undefined) { byHash.set(key, (c = first.length)); first.push(p); }
      cls[p] = c;
    }
    for (const s of list) for (let p = 0; p < P; p++) { const q = first[cls[p]]; if (((s[p >> 3] >> (p & 7)) & 1) !== ((s[q >> 3] >> (q & 7)) & 1)) throw new Error('cull bake: two classes of parts hashed alike'); }
    const C = first.length, cb = ((C + 31) >> 5) * 4, cw = cb / 4;
    if (C > 65535) throw new Error('cull bake: too many classes of parts');
    const data = new Uint8Array(list.length * cb), words = new Uint32Array(data.buffer);
    list.forEach((s, n) => first.forEach((p, c) => { if ((s[p >> 3] >> (p & 7)) & 1) data[n * cb + (c >> 3)] |= 1 << (c & 7); }));
    const w = new Writer(), [ha, hb] = hashOf(), diff: number[] = [], tryOut = new Uint8Array(cb), tryWords = new Uint32Array(tryOut.buffer);
    for (let p = 0; p < P; p++) w.u(cls[p]);
    for (let i = 0, on = false; i < nCells; on = !on) { let j = i; while (j < nCells && at[j] >= 0 === on) j++; w.u(j - i); i = j; }
    const POP = new Uint8Array(256);
    for (let i = 1; i < 256; i++) POP[i] = POP[i >> 1] + (i & 1);
    for (let i = 0; i < nCells; i++) {
      const s = at[i];
      if (s < 0) continue;
      // The guess that comes closest.
      const c0 = i % perStorey, cx = c0 % CW, cz = (c0 / CW) | 0;
      let best = 0, least = Infinity;
      for (let g = 0; g < GUESSES; g++) {
        if (!guess(g, i, cx, cz, at, words, cw, tryWords, 0)) continue;
        let n = 0;
        for (let j = 0; j < cb; j++) n += POP[tryOut[j] ^ data[s * cb + j]];
        if (n < least) { least = n; best = g; }
      }
      guess(best, i, cx, cz, at, words, cw, tryWords, 0);
      diff.length = 0;
      for (let c = 0; c < C; c++) if (((tryOut[c >> 3] ^ data[s * cb + (c >> 3)]) >> (c & 7)) & 1) diff.push(c);
      w.u(diff.length * GUESSES + best);
      for (let j = 0; j < diff.length; j++) w.u(diff[j] - (j ? diff[j - 1] : -1) - 1);
    }
    const out = new Uint8Array(HEAD + w.n), head = new DataView(out.buffer);
    head.setUint32(0, MAGIC, true); head.setUint32(4, ha, true); head.setUint32(8, hb, true); head.setUint32(12, P, true); head.setUint32(16, list.length, true); head.setUint32(20, C, true); head.setUint32(24, nCells, true);
    out.set(w.buf.subarray(0, w.n), HEAD);
    if (log) log(total, total);
    console.log(`cull bake ${def.id}: ${list.length} squares, ${C} classes of ${P} parts`);
    return out;
  }

  return {
    put, update, bake,
    get ready() { seal(); return ready; },
    stats() {
      seal();
      const dl = current ?? everything;
      return { meshes: slotMesh.length, shown: dl.slot.length, tris: totalTris, shownTris: dl.tris, parts: pBase.length, shownParts: dl.parts, ms, losMs, sweeps: lives, mode: off ? 'off' : table ? 'baked' : stale ? 'live' : 'loading' };
    },
    debugParts() {
      return pBase.map((b, p) => { const bt = batches[pBatch[p]]; return { mis: slotMi.slice(bt.slot, bt.slot + bt.n), base: b, count: pCount[p], deco: bt.deco }; });
    },
    dispose() {
      gone = true;
      // The extra ranges' meshes only borrowed their buffers: world.ts frees those with the first one.
      for (const m of extra) { m.vertexBuffer = null as unknown as pc.VertexBuffer; m.indexBuffer.length = 0; m.destroy(); }
      extra.length = 0;
    },
  };
}
