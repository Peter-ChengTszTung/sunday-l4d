// What only a map with storeys has: the visible edges and undersides of floor
// slabs, railings along drops, stair flights and ladders. Everything goes into
// the per-chunk prop batches (world.ts), so it costs no draw calls of its own.
import * as pc from 'playcanvas';
import { TILE, STOREY } from '../../shared/constants';
import { F, RAMP_DX, RAMP_DZ, isIndoor } from '../../shared/level';
import { box, trs } from './geo';
import { type Batch, rgb, type V3 } from './gfx';
import { type Ctx, CHUNK, newGeo, quad, sideQuad, aabb, mul, mix3, SLAB_T } from './worldkit';
import { floorColors } from './ground';

const T = TILE;
const EDGE = 0xb4b1c8, UNDER = 0x6f6c88, INKY = 0x1a1226;
const RAIL = 0xd4d1e2, POST = 0x54506e;
const STRINGER = 0x4a4662;
const LADDER = 0xffb84a, RUNG = 0xfff1c9;
const cube = box();

/** A box from point a to point b, `w` wide (level, across the run) and `t` thick: for anything that leans. */
function bar(ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, t: number): pc.Mat4 {
  const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz), fx = dx / len, fy = dy / len, fz = dz / len;
  let rx = fz, rz = -fx;
  const rl = Math.hypot(rx, rz);
  if (rl < 1e-4) { rx = 1; rz = 0; } else { rx /= rl; rz /= rl; }
  const m = new pc.Mat4(), d = m.data;
  d[0] = rx * w; d[1] = 0; d[2] = rz * w; d[3] = 0;
  d[4] = fy * rz * t; d[5] = (fz * rx - fx * rz) * t; d[6] = -fy * rx * t; d[7] = 0;
  d[8] = fx * len; d[9] = fy * len; d[10] = fz * len; d[11] = 0;
  d[12] = (ax + bx) / 2; d[13] = (ay + by) / 2; d[14] = (az + bz) / 2; d[15] = 1;
  return m;
}

export function buildStoreys(ctx: Ctx, batchFor: (x: number, z: number) => Batch): void {
  const { L, def, W, H } = ctx, { levels, WH, wall, look, base, top } = ctx.S;
  const floorBase = floorColors(ctx.theme);
  const inb = (x: number, z: number) => x >= 0 && z >= 0 && x < W && z < H;

  // ------------------------------------------------- slab edges and railings
  // A floor that ends in open air gets a kerb along the edge (the full slab thickness where the slab
  // hangs free) and a railing, except where the walk graph crosses the edge (the top of a stair or
  // ladder). Runs of edge cells are merged into long boxes, broken at chunk borders.
  const edgeC = rgb(EDGE);
  for (let lv = 1; lv < levels; lv++) for (const horiz of [true, false]) {
    const N = horiz ? H : W, M = horiz ? W : H, yb = lv * STOREY;
    for (let j = 0; j < N; j++) for (const side of [-1, 1]) {
      const d = horiz ? (side > 0 ? 2 : 3) : side > 0 ? 0 : 1; // Level.adj order: +x, -x, +z, -z
      let start = -1, kind = 0;
      for (let i = 0; i <= M; i++) {
        let k = 0;
        if (i < M) {
          const x = horiz ? i : j, z = horiz ? j : i, nx = horiz ? x : x + side, nz = horiz ? z + side : z;
          const n = lv * WH + z * W + x;
          if (def.floor[n] !== F.NONE) {
            const out = !inb(nx, nz), m = lv * WH + nz * W + nx;
            if (out || def.air[m]) {
              const hangs = !wall[n - WH] && !isIndoor(look[n - WH]) && !(!out && wall[m - WH] && top[m - WH] >= yb - 0.01);
              const rail = !def.ramp[n] && L.adj[n * 4 + d] < 0;
              k = 1 + (hangs ? 1 : 0) + (rail ? 2 : 0);
            }
          }
        }
        if (start >= 0 && (k !== kind || i % CHUNK === 0)) { edge(start * T, i * T, (side > 0 ? j + 1 : j) * T, side, horiz, yb, (kind - 1) & 1, (kind - 1) & 2); start = -1; }
        if (k && start < 0) { start = i; kind = k; }
      }
    }
  }
  function edge(lo: number, hi: number, e: number, side: number, horiz: boolean, yb: number, hangs: number, rail: number): void {
    const b = horiz ? batchFor((lo + hi) / 2, e - side * 0.1) : batchFor(e - side * 0.1, (lo + hi) / 2);
    /** Axis-aligned box given along (a0..a1), across (c0..c1) and height. */
    const put = (g: ReturnType<typeof newGeo>, c: V3, a0: number, a1: number, c0: number, c1: number, y0: number, y1: number, normals = true) =>
      horiz ? aabb(g, c, a0, y0, c0, a1, y1, c1, normals) : aabb(g, c, c0, y0, a0, c1, y1, a1, normals);
    if (hangs || rail) {
      const c0 = e - side * 0.22, c1 = e + side * (hangs ? 0.06 : 0), y0 = hangs ? yb - SLAB_T : yb, y1 = rail ? yb + 0.1 : yb - 0.004, t = 0.02;
      const solid = newGeo(), hull = newGeo();
      put(solid, edgeC, lo, hi, c0, c1, y0, y1);
      put(hull, [1, 1, 1], lo - t, hi + t, Math.min(c0, c1) - t, Math.max(c0, c1) + t, hangs ? y0 - t : yb + 0.004, rail ? y1 + t : y1);
      b.raw(solid, hull);
    }
    if (!rail) return;
    const cc = e - side * 0.11, at = (a: number, y: number, sa: number, sy: number, sc: number) => (horiz ? trs(a, y, cc, 0, 0, 0, sa, sy, sc) : trs(cc, y, a, 0, 0, 0, sc, sy, sa));
    const posts = [lo + 0.09];
    for (let a = lo + T; a < hi - 0.5; a += T) posts.push(a);
    posts.push(hi - 0.09);
    for (const a of posts) b.add(cube, POST, at(a, yb + 0.62, 0.1, 1.04, 0.1), 'box', 0.018);
    b.add(cube, RAIL, at((lo + hi) / 2, yb + 1.14, hi - lo, 0.1, 0.13), 'box', 0.02);
    b.add(cube, RAIL, at((lo + hi) / 2, yb + 0.62, hi - lo, 0.06, 0.06), 'none');
  }

  // ---------------------------------------------------------------- undersides
  // Under a slab that hangs over the open (a skybridge, a balcony), and under an upstairs wall that
  // stands over one. Over a room, the room's ceiling is the underside.
  const underC = rgb(UNDER);
  for (let lv = 1; lv < levels; lv++) for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const n = lv * WH + z * W + x, yb = lv * STOREY, upWall = wall[n] === 1 && base[n] === yb;
    if (!(def.floor[n] !== F.NONE || upWall) || wall[n - WH] || isIndoor(look[n - WH])) continue;
    const g = newGeo(), x0 = x * T, z0 = z * T, yu = yb - SLAB_T;
    quad(g, underC, [0, -1, 0], [x0, yu, z0, x0 + T, yu, z0, x0 + T, yu, z0 + T, x0, yu, z0 + T]);
    // The wall's own faces start at the floor line: close the slab's depth below them.
    if (upWall) for (let di = 0; di < 4; di++) {
      const ax = x + [1, -1, 0, 0][di], az = z + [0, 0, 1, -1][di];
      if (inb(ax, az) && !def.air[lv * WH + az * W + ax]) continue;
      sideQuad(g, edgeC, x, z, di, yu, yb);
    }
    batchFor((x + 0.5) * T, (z + 0.5) * T).raw(g);
  }

  // ----------------------------------------------------------- stairs, ladders
  for (const r of def.ramps) {
    const dx = RAMP_DX[r.dir], dz = RAMP_DZ[r.dir], alongX = dx !== 0, sgn = alongX ? dx : dz, yb = r.lv * STOREY;
    const b = batchFor(((r.x0 + r.x1 + 1) / 2) * T, ((r.z0 + r.z1 + 1) / 2) * T);
    if (r.ladder) { ladder(b, (r.x0 + 0.5) * T, (r.z0 + 0.5) * T, dx, dz, yb); continue; }
    const cells = alongX ? r.x1 - r.x0 + 1 : r.z1 - r.z0 + 1, per = Math.max(3, Math.round(STOREY / cells / 0.2)), n = cells * per;
    const rise = STOREY / n, run = (cells * T) / n;
    // Low end of the flight along its axis, and its extent across.
    const low = (sgn > 0 ? (alongX ? r.x0 : r.z0) : (alongX ? r.x1 : r.z1) + 1) * T;
    const w0 = (alongX ? r.z0 : r.x0) * T, w1 = ((alongX ? r.z1 : r.x1) + 1) * T;
    const f = def.floor[r.lv * WH + r.z0 * W + r.x0], tread = mix3(floorBase(f === F.NONE ? F.CONCRETE : f), [1, 1, 1], 0.32), ink = rgb(INKY);
    const g = newGeo();
    const put = (c: V3, a0: number, a1: number, y0: number, y1: number) => (alongX ? aabb(g, c, a0, y0, w0, a1, y1, w1) : aabb(g, c, w0, y0, a0, w1, y1, a1));
    for (let i = 0; i < n; i++) {
      // Each step is a block down to the floor, so the flight is solid; its top sits half a riser
      // either side of the ramp the walker actually follows.
      const a0 = low + sgn * i * run, y = yb + (i + 0.5) * rise;
      put(mul(tread, i % 2 ? 0.9 : 1), a0, a0 + sgn * run, yb, y);
      put(ink, a0 - sgn * 0.012, a0 + sgn * 0.045, y - 0.04, y + 0.005); // a dark nosing so every step reads
    }
    b.raw(g);
    // Open sides get a stringer and a handrail (the foot of the flight stays open where you can step on from the side).
    for (const side of [-1, 1]) {
      const wc = side < 0 ? w0 + 0.075 : w1 - 0.075;
      let from = -1;
      for (let ci = 0; ci <= cells; ci++) {
        let open = false;
        if (ci < cells) {
          const along = sgn > 0 ? ci : cells - 1 - ci;
          const cx = alongX ? r.x0 + along : side < 0 ? r.x0 - 1 : r.x1 + 1, cz = alongX ? (side < 0 ? r.z0 - 1 : r.z1 + 1) : r.z0 + along;
          const nb = r.lv * WH + cz * W + cx;
          open = !inb(cx, cz) || (!wall[nb] && !(ci === 0 && L.walkable(nb) && !def.ramp[nb]));
        }
        if (open && from < 0) from = ci;
        if (!open && from >= 0) {
          const P = (c: number, y: number): [number, number, number] => (alongX ? [low + sgn * c * T, yb + (c / cells) * STOREY + y, wc] : [wc, yb + (c / cells) * STOREY + y, low + sgn * c * T]);
          const seg = (c0: number, y0: number, c1: number, y1: number, w: number, t: number, color: number, th = 0.02) => b.add(cube, color, bar(...P(c0, y0), ...P(c1, y1), w, t), 'box', th);
          seg(from, 0.1, ci, 0.1, 0.13, 0.4, STRINGER);
          seg(from, 1.12, ci, 1.12, 0.1, 0.1, RAIL);
          for (let c = from; c <= ci; c++) { const q = Math.min(ci - 0.04, Math.max(from + 0.04, c)); seg(q, 0.28, q, 1.1, 0.09, 0.09, POST, 0.016); }
          from = -1;
        }
      }
    }
  }

  /** A ladder leaning from the low edge of its tile up to the roof edge, with hoops to grab at the top. */
  function ladder(b: Batch, cx: number, cz: number, dx: number, dz: number, yb: number): void {
    const px = -dz, pz = dx, HW = 0.34; // across the ladder
    const fx = cx - dx * (T / 2 - 0.12), fz = cz - dz * (T / 2 - 0.12); // foot
    const hx = cx + dx * (T / 2 - 0.05), hz = cz + dz * (T / 2 - 0.05), hy = yb + STOREY; // head, at the edge it climbs to
    const len = Math.hypot(hx - fx, hy - yb, hz - fz), ux = (hx - fx) / len, uy = (hy - yb) / len, uz = (hz - fz) / len;
    for (const s of [-1, 1]) {
      const ox = px * HW * s, oz = pz * HW * s;
      b.add(cube, LADDER, bar(fx + ox, yb, fz + oz, hx + ox, hy, hz + oz, 0.1, 0.1), 'box', 0.022);
      // Hoop: up from the head, over onto the roof, and down.
      const tx = hx + dx * 0.6, tz = hz + dz * 0.6, ty = hy + 1.05;
      b.add(cube, LADDER, bar(hx + ox, hy - 0.05, hz + oz, hx + ox, ty, hz + oz, 0.09, 0.09), 'box', 0.02);
      b.add(cube, LADDER, bar(hx + ox - dx * 0.045, ty, hz + oz - dz * 0.045, tx + ox + dx * 0.045, ty, tz + oz + dz * 0.045, 0.09, 0.09), 'box', 0.02);
      b.add(cube, LADDER, bar(tx + ox, hy, tz + oz, tx + ox, ty, tz + oz, 0.09, 0.09), 'box', 0.02);
      b.add(cube, POST, trs(fx + ox, yb + 0.03, fz + oz, 0, 0, 0, 0.2, 0.06, 0.2), 'none');
    }
    for (let d = 0.3; d < len - 0.1; d += 0.3) {
      const x = fx + ux * d, y = yb + uy * d, z = fz + uz * d;
      b.add(cube, RUNG, bar(x - px * HW, y, z - pz * HW, x + px * HW, y, z + pz * HW, 0.07, 0.07), 'none');
    }
  }
}
