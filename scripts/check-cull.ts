// Dev check for client/src/cull.ts, no browser: builds each chapter's world against a stand-in for
// WebGL, then
//   1. from many eye points casts rays at sample points of every part of a mesh the culling left out
//      of its draw ranges, against every opaque triangle of the world as drawn (back faces culled). A
//      sample nothing covers is a point you could see of something that is not drawn: an error. (Ink
//      past the fog distance is skipped: it is still "visible", as fog-coloured ink on a fog-coloured wall.)
//      Besides points inside the triangles, the "lips" are cast at: the very corners and edges that hang
//      a few centimetres under a floor line (an upstairs prop's ink hull does). Those can lie exactly in
//      the plane of the ceiling below, where the depth test lets a row of pixels through: a ray that is
//      only stopped within 3 mm of its end counts as arriving.
//   2. counts what the engine would draw of the world from a few fixed spots (eight headings each).
//   3. times the first frames of a chapter: the lobby's backdrop camera, then the spawn.
// It also fails when a chapter's baked table (client/src/pvs/) is not the one for its geometry: run
// `npm run bake:cull` then. cull.ts mirrors what arch.ts, storeys.ts and ground.ts draw across each
// floor line: run this after changing any of them. Exit code 1 on errors.
// Usage: npm run check:cull [chapterIndex] [eyes, default 150]
//   CULL=off: counts without culling.  CULL=live: checks the rules themselves, without the baked table.
import type * as PC from 'playcanvas';

// (A browser that draws nothing.)
await import('./headless');
// Only now the client modules: gfx.ts starts the engine on import.
const pc = await import('playcanvas');
const { getLevel, chapterCount } = await import('../shared/chapters');
const { TILE, STOREY, PLAYER } = await import('../shared/constants');
const { buildWorld } = await import('../client/src/world');
const gfx = await import('../client/src/gfx');

const only = process.argv[2] !== undefined ? Number(process.argv[2]) : -1, EYES = Number(process.argv[3] ?? 150);
/** Triangles sampled per hidden mesh, and the eye height the counts are taken at. */
const PER = 60, EYE = 1.6;
/** Eye heights the rays are cast from: standing (PLAYER.eye), the counts' own, downed. */
const HEIGHTS = [PLAYER.eye, EYE, PLAYER.eye, 0.42];
/** Lip points cast at per hidden part at most, and how far under a floor line counts as a lip (m: cull.ts `DIP`, and a little). */
const LIPS = 240, LIP = 0.05;
/** The lobby camera (main.ts): this far round the first step's waypoint, this high over it. */
const LOBBY = { r: 4, lift: 3.2 };
let seed = 20261126;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
type Kind = 'solid' | 'line' | 'hull';
interface Part { mi: PC.MeshInstance; pos: Float32Array; idx: Uint32Array; kind: Kind }
/** Spots to count at besides each chapter's start, middle step and Big Hold On. */
const MORE: Record<string, [string, { x: number; y?: number; z: number }][]> = { ch2: [['food court', { x: 287, z: 115 }]] };
let failed = false;

for (let ch = 0; ch < chapterCount(); ch++) {
  if (only >= 0 && ch !== only) continue;
  const L = getLevel(ch), t0 = performance.now(), world = buildWorld(L), root = gfx.app.root.findByName('world') as PC.Entity;
  world.update(0, 0.016, -1, 0, -1);
  await world.cull.ready; // (the baked table)
  const buildMs = performance.now() - t0, mode = world.culled().mode;
  console.log(`ch${ch + 1}: built in ${buildMs.toFixed(0)} ms (no GPU), culling ${mode}`);
  {
    // The first frames, as main.ts has them: the lobby camera where it starts, a minute of its drift, then the spawn.
    const look = L.def.steps[0]?.at ?? L.def.spawns[0], sp = L.def.spawns[0], c0 = world.culled().sweeps;
    const lobby = (o: number): number => { const t = performance.now(); world.cull.update(look.x + Math.sin(o) * LOBBY.r, (look.y ?? 0) + LOBBY.lift, look.z + Math.cos(o * 0.7) * LOBBY.r); return performance.now() - t; };
    const first = lobby(0), c1 = world.culled().sweeps;
    let worst = 0;
    for (let o = 0; o < 7.2; o += 0.002) worst = Math.max(worst, lobby(o));
    const c2 = world.culled().sweeps, t = performance.now();
    world.cull.update(sp.x, (sp.y ?? 0) + PLAYER.eye, sp.z);
    const spawn = performance.now() - t, c3 = world.culled().sweeps;
    console.log(`ch${ch + 1}: first frame (lobby camera) ${first.toFixed(2)} ms, ${c1 - c0} tiles worked out on the spot; its drift ${worst.toFixed(2)} ms at most, ${c2 - c1} on the spot; the spawn ${spawn.toFixed(2)} ms, ${c3 - c2} on the spot`);
    if (c3 > c0 && mode === 'baked') { console.log(`   ERROR the lobby camera or the spawn is somewhere the baked table does not cover`); failed = true; }
  }
  if (mode === 'live' && !process.env.CULL) { console.log(`   ERROR the baked table in client/src/pvs/ is missing or not for this geometry: run \`npm run bake:cull\``); failed = true; }
  // The culled meshes: each is drawn as up to two ranges of one index buffer (mesh instances sharing it).
  const cullParts = world.cull.debugParts(), ranges = new Set<PC.MeshInstance>();
  for (const p of cullParts) for (const mi of p.mis.slice(1)) ranges.add(mi);
  const kindOf = new Map<PC.Material, Kind>([[gfx.toonMat, 'solid'], [gfx.ceilMat, 'solid'], [gfx.toonTexMat, 'solid'], [gfx.flatMat, 'solid'], [gfx.inkLineMat, 'line'], [gfx.inkBack, 'hull']]);
  const parts: Part[] = [];
  for (const e of root.children as PC.Entity[]) for (const mi of e.render?.meshInstances ?? []) {
    const kind = mi.material && kindOf.get(mi.material), mesh = mi.mesh;
    if (!kind || !mesh || ranges.has(mi)) continue;
    const pos: number[] = [], idx: number[] = [];
    mesh.getPositions(pos); mesh.getIndices(idx);
    parts.push({ mi, pos: Float32Array.from(pos), idx: Uint32Array.from(idx), kind });
  }
  const partOf = new Map(parts.map((m) => [m.mi, m]));
  /**
   * Per culled part, the points of its lips (x, y, z, and the normal of the triangle each is of): of every triangle
   * that stands on a floor line and hangs under it, the corners that do, and the middle of an edge between two.
   */
  const lipCache = new Map<number, Float32Array>();
  const lipsOf = (ci: number, m: Part, base: number, count: number): Float32Array => {
    let out = lipCache.get(ci);
    if (out) return out;
    const pts: number[] = [], p = m.pos;
    for (let i = base; i < base + count; i += 3) {
      const v = [m.idx[i] * 3, m.idx[i + 1] * 3, m.idx[i + 2] * 3];
      const line = Math.floor((p[v[0] + 1] + p[v[1] + 1] + p[v[2] + 1]) / 3 / STOREY + 1e-3 / STOREY) * STOREY;
      if (line <= 0) continue;
      const low = v.map((a) => p[a + 1] < line - 1e-4 && p[a + 1] >= line - LIP);
      if (!low[0] && !low[1] && !low[2]) continue;
      const [a, b, c] = v;
      const nx = (p[b + 1] - p[a + 1]) * (p[c + 2] - p[a + 2]) - (p[b + 2] - p[a + 2]) * (p[c + 1] - p[a + 1]);
      const ny = (p[b + 2] - p[a + 2]) * (p[c] - p[a]) - (p[b] - p[a]) * (p[c + 2] - p[a + 2]);
      const nz = (p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[b + 1] - p[a + 1]) * (p[c] - p[a]);
      for (let q = 0; q < 3; q++) {
        const u = v[q], w = v[(q + 1) % 3];
        if (low[q]) pts.push(p[u], p[u + 1], p[u + 2], nx, ny, nz);
        if (low[q] && low[(q + 1) % 3]) pts.push((p[u] + p[w]) / 2, (p[u + 1] + p[w + 1]) / 2, (p[u + 2] + p[w + 2]) / 2, nx, ny, nz);
      }
    }
    // (Too many: an even spread of them.)
    const n = pts.length / 6, take = Math.min(n, LIPS);
    out = new Float32Array(take * 6);
    for (let i = 0; i < take; i++) { const j = Math.floor(i * n / take) * 6; for (let q = 0; q < 6; q++) out[i * 6 + q] = pts[j + q]; }
    lipCache.set(ci, out);
    return out;
  };

  // ---------------------------------------------------------------- counts
  const proj = new pc.Mat4().setPerspective(74, 2867 / 1516, 0.08, 600), steps = L.def.steps;
  const big = steps.find((s) => s.big), mid = steps[steps.length >> 1];
  const spots: [string, { x: number; y?: number; z: number }][] = [['start', L.def.spawns[0]], ['mid quest', mid.at], ...(big ? [['Big Hold On', big.at] as [string, typeof mid.at]] : []), ...(MORE[L.def.id] ?? [])];
  for (const [name, at] of spots) {
    const x = at.x, y = (at.y ?? 0) + EYE, z = at.z;
    world.update(0, 0.016, x, y, z);
    const shown: PC.MeshInstance[] = [];
    for (const r of root.findComponents('render') as PC.RenderComponent[]) {
      let on = r.enabled;
      for (let e: PC.GraphNode | null = r.entity; on && e && e !== root; e = e.parent) on = e.enabled;
      if (on) for (const mi of r.meshInstances) if (mi.visible) shown.push(mi);
    }
    let dSum = 0, tSum = 0, dMax = 0, tMax = 0;
    for (let h = 0; h < 8; h++) {
      const cam = new pc.Mat4().setTRS(new pc.Vec3(x, y, z), new pc.Quat().setFromEulerAngles(0, h * 45, 0), pc.Vec3.ONE);
      const fr = new pc.Frustum();
      fr.setFromMat4(new pc.Mat4().mul2(proj, cam.invert()));
      let d = 0, t = 0;
      for (const mi of shown) if (!mi.cull || fr.containsAabb(mi.aabb)) { d++; t += (mi.mesh?.primitive[0].count ?? 0) / 3; }
      dSum += d; tSum += t; dMax = Math.max(dMax, d); tMax = Math.max(tMax, t);
    }
    const c = world.culled();
    console.log(`ch${ch + 1} ${name.padEnd(12)} (${x.toFixed(0)}, ${y.toFixed(1)}, ${z.toFixed(0)}): draws avg ${Math.round(dSum / 8)} max ${dMax}, triangles avg ${Math.round(tSum / 8000)}k max ${Math.round(tMax / 1000)}k; scenery ${c.shown}/${c.meshes} draw ranges, ${c.shownParts}/${c.parts} parts, ${Math.round(c.shownTris / 1000)}k/${Math.round(c.tris / 1000)}k triangles; update ${c.ms.toFixed(2)} ms`);
  }
  if (process.env.CULL === 'off') { world.dispose(); continue; }
  {
    // What a frame costs: a run at 5.6 m/s and 60 frames a second from each spot, 60 m east and back.
    let sum = 0, max = 0, n = 0;
    for (const [, at] of spots) for (let i = 0; i < 1300; i++) {
      const x = Math.max(1, Math.min(L.W * TILE - 1, at.x + (i < 650 ? i : 1300 - i) * 0.093)), t0 = performance.now();
      world.cull.update(x, (at.y ?? 0) + EYE, at.z);
      const d = performance.now() - t0;
      sum += d; max = Math.max(max, d); n++;
    }
    console.log(`ch${ch + 1}: running about, the culling's update takes ${(sum / n * 1000).toFixed(1)} us a frame on average, ${max.toFixed(2)} ms at most`);
  }

  // ---------------------------------------------------------------- rays
  // What can cover a point: every opaque triangle that is drawn back-face culled (lit panes left out: the safe side).
  const cover = parts.filter((m) => m.kind === 'solid' && m.mi.material !== gfx.flatMat);
  let nt = 0;
  for (const m of cover) nt += m.idx.length / 3;
  const tri = new Float32Array(nt * 9);
  { let o = 0; for (const m of cover) for (let i = 0; i < m.idx.length; i++) { const v = m.idx[i] * 3; tri[o++] = m.pos[v]; tri[o++] = m.pos[v + 1]; tri[o++] = m.pos[v + 2]; } }
  // A grid of 2 x 2.1 x 2 m cells over the map, each listing the triangles that touch it.
  const CS = 2, CY = 2.1, GX = L.W + 4, GZ = L.H + 4, GY = Math.ceil((L.levels * STOREY + 30) / CY) + 2, OX = -2 * CS, OZ = -2 * CS, OY = -CY;
  const cells: (number[] | undefined)[] = new Array(GX * GY * GZ);
  const ci = (v: number, o: number, s: number, n: number) => Math.max(0, Math.min(n - 1, Math.floor((v - o) / s)));
  for (let t = 0; t < nt; t++) {
    const o = t * 9;
    const x0 = ci(Math.min(tri[o], tri[o + 3], tri[o + 6]) - 0.01, OX, CS, GX), x1 = ci(Math.max(tri[o], tri[o + 3], tri[o + 6]) + 0.01, OX, CS, GX);
    const y0 = ci(Math.min(tri[o + 1], tri[o + 4], tri[o + 7]) - 0.01, OY, CY, GY), y1 = ci(Math.max(tri[o + 1], tri[o + 4], tri[o + 7]) + 0.01, OY, CY, GY);
    const z0 = ci(Math.min(tri[o + 2], tri[o + 5], tri[o + 8]) - 0.01, OZ, CS, GZ), z1 = ci(Math.max(tri[o + 2], tri[o + 5], tri[o + 8]) + 0.01, OZ, CS, GZ);
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) (cells[(y * GZ + z) * GX + x] ??= []).push(t);
  }
  const stamp = new Int32Array(nt);
  let stampN = 0;
  /** Does a triangle facing the eye cross the way from p to q, before `tMax` of it? */
  const blocked = (px: number, py: number, pz: number, qx: number, qy: number, qz: number, tMax: number): boolean => {
    const dx = qx - px, dy = qy - py, dz = qz - pz;
    stampN++;
    let x = ci(px, OX, CS, GX), y = ci(py, OY, CY, GY), z = ci(pz, OZ, CS, GZ);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    let tx = dx !== 0 ? (OX + (x + (dx > 0 ? 1 : 0)) * CS - px) / dx : Infinity, ty = dy !== 0 ? (OY + (y + (dy > 0 ? 1 : 0)) * CY - py) / dy : Infinity, tz = dz !== 0 ? (OZ + (z + (dz > 0 ? 1 : 0)) * CS - pz) / dz : Infinity;
    const ddx = dx !== 0 ? Math.abs(CS / dx) : Infinity, ddy = dy !== 0 ? Math.abs(CY / dy) : Infinity, ddz = dz !== 0 ? Math.abs(CS / dz) : Infinity;
    for (;;) {
      const list = cells[(y * GZ + z) * GX + x];
      if (list) for (const t of list) {
        if (stamp[t] === stampN) continue;
        stamp[t] = stampN;
        const o = t * 9, ax = tri[o], ay = tri[o + 1], az = tri[o + 2];
        const e1x = tri[o + 3] - ax, e1y = tri[o + 4] - ay, e1z = tri[o + 5] - az, e2x = tri[o + 6] - ax, e2y = tri[o + 7] - ay, e2z = tri[o + 8] - az;
        const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
        const det = e1x * hx + e1y * hy + e1z * hz;
        if (det < 1e-9) continue; // facing away, or edge on: not drawn
        const ux = px - ax, uy = py - ay, uz = pz - az, u = (ux * hx + uy * hy + uz * hz) / det;
        if (u < -1e-4 || u > 1 + 1e-4) continue;
        const wx = uy * e1z - uz * e1y, wy = uz * e1x - ux * e1z, wz = ux * e1y - uy * e1x, v = (dx * wx + dy * wy + dz * wz) / det;
        if (v < -1e-4 || u + v > 1 + 1e-4) continue;
        const tt = (e2x * wx + e2y * wy + e2z * wz) / det;
        if (tt > 1e-5 && tt < tMax) return true;
      }
      const tn = Math.min(tx, ty, tz);
      if (tn >= 1) return false;
      if (tx === tn) { x += sx; tx += ddx; if (x < 0 || x >= GX) return false; }
      else if (ty === tn) { y += sy; ty += ddy; if (y < 0 || y >= GY) return false; }
      else { z += sz; tz += ddz; if (z < 0 || z >= GZ) return false; }
    }
  };

  // Eyes: random walkable nodes of every storey; every other one on or beside stairs, ladders and drops, where
  // the culling has most to get wrong. Some mid-jump, and half stepped aside (into the next tile, at times).
  const nodes: number[] = [], edgy: number[] = [];
  for (let n = 0; n < L.N; n++) {
    if (!L.walkable(n)) continue;
    nodes.push(n);
    const lv = L.lvOf(n), x = L.nodeX(n), z = L.nodeZ(n);
    let edge = L.def.ramp[n] !== 0;
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ax = x + ox, az = z + oz;
      if (ax < 0 || az < 0 || ax >= L.W || az >= L.H) continue;
      const m = lv * L.WH + az * L.W + ax;
      if (L.def.air[m] || L.def.ramp[m]) edge = true;
    }
    if (edge) edgy.push(n);
  }
  const far = L.def.theme.fogFar + 8;
  let rays = 0, lipRays = 0, bad = 0, hidden = 0, upMs = 0, upMax = 0, ups = 0;
  const lives0 = world.culled().sweeps;
  const where = new Map<string, number>();
  for (let e = 0; e < EYES; e++) {
    const pool = e % 2 && edgy.length ? edgy : nodes, n = pool[Math.floor(rnd() * pool.length)], lv = L.lvOf(n);
    const bx = (L.nodeX(n) + 0.3 + rnd() * 0.4) * TILE, bz = (L.nodeZ(n) + 0.3 + rnd() * 0.4) * TILE;
    // (Every eighth eye off a stair is a ride or spectator camera: anywhere up to just under the slab above.)
    const feet = L.groundY(bx, lv * STOREY, bz), lift = e % 8 === 7 && !L.def.ramp[n] ? 2.6 + rnd() * (STOREY - 0.36 - 2.6) : HEIGHTS[(e >> 3) % HEIGHTS.length] + (rnd() < 0.3 ? rnd() : 0);
    // (Timed: the culling's own share of world.update().)
    let tu = performance.now();
    world.cull.update(bx, feet + lift, bz);
    let du = performance.now() - tu;
    upMs += du; upMax = Math.max(upMax, du); ups++;
    world.update(0, 0.016, bx, feet + lift, bz);
    const a = rnd() * 6.283, step = e % 4 >= 2 ? 0.3 + rnd() * 0.15 : 0;
    let x = bx + Math.cos(a) * step, z = bz + Math.sin(a) * step;
    const there = L.nodeAt(x, feet, z);
    if (!L.walkable(there) || L.lvOf(there) !== lv) { x = bx; z = bz; }
    const y = L.groundY(x, feet, z) + lift;
    tu = performance.now();
    world.cull.update(x, y, z);
    du = performance.now() - tu;
    upMs += du; upMax = Math.max(upMax, du); ups++;
    world.update(0.016, 0.016, x, y, z);
    /** Casts at a point of a hidden part (with its triangle's normal); `lip`: one of its lip points. */
    const probe = (m: Part, deco: boolean, qx: number, qy: number, qz: number, nx: number, ny: number, nz: number, lip: boolean): void => {
      const facing = nx * (qx - x) + ny * (qy - y) + nz * (qz - z);
      // Solids show their fronts, hulls their backs, ink strokes both.
      if ((m.kind === 'solid' && facing >= 0) || (m.kind === 'hull' && facing <= 0)) return;
      if (deco && (qx - x) ** 2 + (qy - y) ** 2 + (qz - z) ** 2 > far * far) return;
      rays++; if (lip) lipRays++;
      if (blocked(x, y, z, qx, qy, qz, 1 - 0.003 / Math.hypot(qx - x, qy - y, qz - z))) return;
      bad++;
      const key = `${m.kind}${lip ? ' lip' : ''} on storey ${Math.floor((qy + (lip ? LIP : 0.001)) / STOREY)} from storey ${Math.floor(y / STOREY)}`;
      where.set(key, (where.get(key) ?? 0) + 1);
      if (bad <= 8) console.log(`   ERROR hidden but in sight: eye (${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)}) -> ${m.kind}${lip ? ' lip' : ''} at (${qx.toFixed(3)}, ${qy.toFixed(3)}, ${qz.toFixed(3)})`);
    };
    for (let ci = 0; ci < cullParts.length; ci++) {
      const cp = cullParts[ci];
      // Drawn: inside a range that is on.
      if (cp.mis.some((mi) => { const pr = mi.mesh!.primitive[0]; return mi.visible && pr.base <= cp.base && cp.base + cp.count <= pr.base + pr.count; })) continue;
      const m = partOf.get(cp.mis[0]);
      if (!m) continue;
      hidden++;
      const ntm = cp.count / 3, take = Math.min(ntm, PER), p = m.pos, t0 = cp.base / 3;
      for (let s = 0; s < take; s++) {
        const t = t0 + (take === ntm ? s : Math.floor(rnd() * ntm)), ia = m.idx[t * 3] * 3, ib = m.idx[t * 3 + 1] * 3, ic = m.idx[t * 3 + 2] * 3;
        const nx = (p[ib + 1] - p[ia + 1]) * (p[ic + 2] - p[ia + 2]) - (p[ib + 2] - p[ia + 2]) * (p[ic + 1] - p[ia + 1]);
        const ny = (p[ib + 2] - p[ia + 2]) * (p[ic] - p[ia]) - (p[ib] - p[ia]) * (p[ic + 2] - p[ia + 2]);
        const nz = (p[ib] - p[ia]) * (p[ic + 1] - p[ia + 1]) - (p[ib + 1] - p[ia + 1]) * (p[ic] - p[ia]);
        for (const [wa, wb, wc] of [[1 / 3, 1 / 3, 1 / 3], [0.8, 0.1, 0.1], [0.1, 0.8, 0.1], [0.1, 0.1, 0.8]]) {
          probe(m, cp.deco, p[ia] * wa + p[ib] * wb + p[ic] * wc, p[ia + 1] * wa + p[ib + 1] * wb + p[ic + 1] * wc, p[ia + 2] * wa + p[ib + 2] * wb + p[ic + 2] * wc, nx, ny, nz, false);
        }
      }
      const lp = lipsOf(ci, m, cp.base, cp.count);
      for (let i = 0; i < lp.length; i += 6) probe(m, cp.deco, lp[i], lp[i + 1], lp[i + 2], lp[i + 3], lp[i + 4], lp[i + 5], true);
    }
  }
  console.log(`ch${ch + 1}: ${EYES} eyes, ${Math.round(hidden / EYES)} of ${cullParts.length} parts hidden on average, ${rays} rays (${lipRays} at lips), ${bad} in sight${bad ? ': ' + [...where].map(([k, v]) => `${k} x${v}`).join(', ') : ''}; culling update avg ${(upMs / ups).toFixed(3)} ms max ${upMax.toFixed(2)} ms over ${ups} jumps to somewhere else, ${world.culled().sweeps - lives0} tiles worked out on the spot`);
  if (bad) failed = true;
  world.dispose();
}
process.exit(failed ? 1 : 0);
