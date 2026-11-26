// Dev check for the order of the opaque draws (client/src/gfx.ts `DRAW`), no browser: builds each chapter's
// world against a stand-in for WebGL, adds one of every moving thing (a survivor, a zombie drawn plainly
// and one drawn by the horde, a teammate's gun, goo, sparks, mounted guns, set pieces, the first-person
// weapon), sorts each layer's opaque draws with the engine's own sorter, and
//   1. prints the order as runs of draw classes, next to the order before there were buckets (every draw
//      on the engine's default bucket: its order by material and mesh alone);
//   2. checks the order is the table's: no opaque draw of the World layer without a row, no blended draw
//      with one, and the rows in the table's order down the frame;
//   3. for every pair of draws works out which shows where their depths are equal, before (the later
//      one: every depth test was "less or equal") and now (the later one, unless it tests "less": then
//      the earlier). A pair whose winner changed is an error unless
//        - both are still geometry of the world: then 4. must find nothing; or
//        - one of them moves (they cannot keep the very same depth as anything) and they share a row,
//          or one is a door: these are listed;
//   (and, once, the same search within each rigid part of the characters' meshes, whose material tests "less" too)
//   4. looks through the world's still geometry for two surfaces in one plane (within 0.2 mm), overlapping,
//      drawn towards the same side and not the same flat ink, in a pair of draws (or within one draw) whose
//      winner changed: each is an error.
// `TIES=1` also lists where surfaces of different materials do share a plane (their winner is unchanged,
// by 3.), and how many do within each material.
// Exit code 1 on errors. Usage: npm run check:order [chapterIndex]
import type * as PC from 'playcanvas';

await import('./headless');
const pc = await import('playcanvas');
const { getLevel, chapterCount } = await import('../shared/chapters');
const { buildWorld } = await import('../client/src/world');
const gfx = await import('../client/src/gfx');
const { Chibi, survivorLook, zombieLook, zombieHorde } = await import('../client/src/chibi');
const { worldGun, buildGun } = await import('../client/src/viewmodel');
const { FX } = await import('../client/src/fx');
const { buildMounts } = await import('../client/src/mounts');
const { buildSetPieces } = await import('../client/src/setpieces');

const only = process.argv[2] !== undefined ? Number(process.argv[2]) : -1;
let failed = false;
const fail = (msg: string) => { failed = true; console.log(`   ERROR ${msg}`); };

type MI = PC.MeshInstance & { material: PC.Material; mesh: PC.Mesh };
const DRAW = gfx.DRAW as Record<string, number>;
const sorter = (gfx.app.renderer as unknown as { meshInstanceSorter: never }).meshInstanceSorter;
const camEnt = new pc.Entity('camera');
camEnt.addComponent('camera', { fov: 74, nearClip: 0.08, farClip: 600 });
gfx.app.root.addChild(camEnt);
const fakeCam = { node: camEnt } as unknown as PC.Camera;

// ------------------------------------------------------------------ names
const named = new Map<PC.Material, string>();
for (const [k, v] of Object.entries(gfx)) if (v instanceof pc.Material) named.set(v, k);
const rowName = new Map<number, string>(Object.entries(DRAW).map(([k, v]) => [v, k]));
const less = (m: PC.Material) => m.depthFunc === pc.FUNC_LESS;
const matName = (m: PC.Material) => named.get(m) ?? `${(m as PC.ShaderMaterial & { shaderDesc?: { uniqueName?: string } }).shaderDesc?.uniqueName ?? m.name}(${m.cull === pc.CULLFACE_NONE ? 'two-sided' : m.cull === pc.CULLFACE_FRONT ? 'backs' : 'fronts'})`;
const row = (mi: MI) => rowName.get(mi.drawBucket) ?? `${mi.drawBucket}`;
const cls = (mi: MI) => `${row(mi)} ${matName(mi.material)}`;

/** A layer's opaque draws in the order the engine would draw them. */
function sorted(layer: PC.Layer, list: MI[]): MI[] {
  const culled = layer.getCulledInstances(fakeCam);
  culled.opaque = list.slice();
  layer.sortVisible(fakeCam, false, sorter);
  return culled.opaque.slice() as MI[];
}
function runs(list: MI[], now: boolean): string {
  const out: string[] = [];
  let last = '', n = 0;
  const flush = () => { if (n) out.push(n > 1 ? `${last} x${n}` : last); };
  for (const mi of list) {
    const s = now ? `${cls(mi)}${less(mi.material) ? ' (<)' : ' (<=)'}` : matName(mi.material);
    if (s === last) n++; else { flush(); last = s; n = 1; }
  }
  flush();
  return out.join('\n           ');
}

// ------------------------------------------------------------------ one of every moving thing
const fx = new FX();
const survivor = new Chibi(survivorLook(0)), zedPlain = new Chibi(zombieLook(0, 1)), zedHorde = new Chibi(zombieLook(0, 2), true);
gfx.app.root.addChild(survivor.group); gfx.app.root.addChild(zedPlain.group);
void zedHorde;
gfx.app.root.addChild(worldGun('pistol'));
gfx.app.root.addChild(buildGun('shotgun').ent);
const at = { x: 0, y: 1, z: 0 };
fx.glob(0, 0, 1, 1, 1); fx.shell(); fx.tracer(at, { x: 1, y: 1, z: 1 }); fx.rope(at, { x: 1, y: 1, z: 1 }); fx.aimArc([0, 1, 0, 1, 1, 1, 2, 1, 2]);
fx.burst(at, 0xffffff, 3, 1, 0.2, true); fx.burst(at, 0xffffff, 3, 1, 0.2); fx.update(0.016, new pc.Quat());
// The characters' own meshes: their material tests "less" now, so within one a tie goes to the first triangle.
{
  const looks = [...Array.from({ length: 8 }, (_, i) => survivorLook(i)), ...Array.from({ length: 48 }, (_, i) => zombieLook(i % 12, i))];
  const made = looks.map((l) => new Chibi(l));
  const draws = made.map((c) => c.root.render!.meshInstances[0] as MI);
  const ties = coplanar(draws, new Map(draws.map((mi, i) => [mi, i])), (a, b) => a === b, true);
  console.log(`characters: ${looks.length} looks, surfaces of one part in one plane (overlapping, same side, differently coloured): ${ties.total}`);
  for (const [k, v] of ties.where) fail(`a character's part has surfaces in one plane: ${k} x${v.n}, e.g. at (${v.at.map((x) => x.toFixed(3)).join(', ')})`);
  for (const c of made) c.dispose();
}
const inertSfx = new Proxy(function () {}, { get: () => () => undefined }) as never;

for (let ch = 0; ch < chapterCount(); ch++) {
  if (only >= 0 && ch !== only) continue;
  const L = getLevel(ch), world = buildWorld(L), root = gfx.app.root.findByName('world') as PC.Entity;
  const mounts = buildMounts(L), pieces = buildSetPieces(L, inertSfx, fx);
  world.update(0, 0.016, -1, 0, -1);
  await world.cull.ready;
  gfx.app.root.syncHierarchy();
  zombieHorde()?.flush(camEnt.camera!);
  /** Still geometry of the world (doors as they stand closed), as against what moves about. */
  const still = (mi: MI) => { if (mi.instancingData) return false; for (let e: PC.GraphNode | null = mi.node; e; e = e.parent) if (e === root) return true; return false; };

  for (const layerName of ['World', 'Viewmodel']) {
    const layer = gfx.app.scene.layers.getLayerByName(layerName)!, isWorld = layerName === 'World';
    const all = layer.meshInstances.filter((mi) => !mi.transparent && mi.material && mi.mesh) as MI[];
    const blended = layer.meshInstances.filter((mi) => mi.transparent) as MI[];
    // Before: the engine's default bucket for all (and every depth test "less or equal").
    const buckets = all.map((mi) => mi.drawBucket);
    for (const mi of all) mi.drawBucket = 127;
    const before = sorted(layer, all);
    all.forEach((mi, i) => { mi.drawBucket = buckets[i]; });
    const now = sorted(layer, all);
    console.log(`ch${ch + 1} ${layerName}: ${all.length} opaque draws (${blended.length} blended, left alone)`);
    console.log(`   before: ${runs(before, false)}`);
    console.log(`   now:    ${runs(now, true)}`);

    // 2. the table's order
    for (const mi of blended) if (mi.drawBucket !== 127) fail(`a blended draw has a row: ${cls(mi)}`);
    for (let i = 1; i < now.length; i++) if (now[i].drawBucket > now[i - 1].drawBucket) fail(`rows out of order: ${cls(now[i - 1])} then ${cls(now[i])}`);
    for (const s of new Set(now.filter((mi) => !rowName.has(mi.drawBucket)).map(cls))) { if (isWorld) fail(`an opaque draw without a row: ${s}`); else console.log(`   (without a row, as before: ${s})`); }
    for (const mi of now) if (less(mi.material) !== (mi.drawBucket !== DRAW.ITEM && mi.drawBucket !== DRAW.SOLID && mi.drawBucket !== DRAW.VM_SOLID && rowName.has(mi.drawBucket))) fail(`depth test not the row's: ${cls(mi)}`);

    // 3. who wins a depth tie, pair by pair
    const posBefore = new Map(before.map((mi, i) => [mi, i])), posNow = new Map(now.map((mi, i) => [mi, i]));
    /** Does the winner of a tie between two draws (or between two triangles of one) differ from before? */
    const changed = (a: MI, b: MI): boolean => {
      if (a === b) return less(a.material);
      const laterBefore = posBefore.get(a)! > posBefore.get(b)! ? a : b, later = posNow.get(a)! > posNow.get(b)! ? a : b;
      return (less(later.material) ? (later === a ? b : a) : later) !== laterBefore;
    };
    const moving = new Map<string, number>(), bad = new Map<string, number>(), own = new Set<string>();
    let pairs = 0, swapped = 0, stillPairs = 0;
    for (let i = 0; i < all.length; i++) {
      if (changed(all[i], all[i])) own.add(matName(all[i].material));
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        pairs++;
        if ((posBefore.get(a)! < posBefore.get(b)!) !== (posNow.get(a)! < posNow.get(b)!)) swapped++;
        if (!changed(a, b)) continue;
        if (a.material === b.material) continue; // (as within one draw: 4., or moving)
        if (still(a) && still(b)) { stillPairs++; continue; } // (4.)
        const k = [cls(a), cls(b)].sort().join('  with  ');
        if (a.drawBucket === b.drawBucket || a.drawBucket === DRAW.DOOR || b.drawBucket === DRAW.DOOR) moving.set(k, (moving.get(k) ?? 0) + 1);
        else bad.set(k, (bad.get(k) ?? 0) + 1);
      }
    }
    console.log(`   ${pairs} pairs of draws, ${swapped} drawn the other way round now`);
    console.log(`   depth ties settled the other way round: within a material: ${[...own].join(', ') || 'none'}; between two materials of still geometry: ${stillPairs} pairs of draws; with something that moves: ${moving.size ? '' : 'none'}`);
    for (const [k, n] of moving) console.log(`      ${k} (x${n})`);
    for (const [k, n] of bad) fail(`depth-tie winner changed across rows: ${k} (x${n})`);

    // 4. surfaces in one plane, where the winner changed
    if (isWorld) {
      const ties = coplanar(all.filter(still), posBefore, (a, b) => changed(a, b));
      console.log(`   still surfaces in one plane (overlapping, same side, not both ink) where the winner changed: ${ties.total}`);
      for (const [k, v] of ties.where) fail(`surfaces in one plane, winner changed: ${k} x${v.n}, e.g. at (${v.at.map((x) => x.toFixed(3)).join(', ')})`);
      if (process.env.TIES) {
        const same = coplanar(all.filter(still), posBefore, (a, b) => a !== b && !changed(a, b));
        console.log(`   for the record, surfaces in one plane in two draws whose winner is unchanged: ${same.total}`);
        for (const [k, v] of same.where) console.log(`      ${k} x${v.n}, e.g. at (${v.at.map((x) => x.toFixed(3)).join(', ')})`);
        const within = coplanar(all.filter(still), posBefore, (a, b) => a === b && !changed(a, b));
        console.log(`   and within one draw, unchanged: ${within.total}`);
        for (const [k, v] of within.where) console.log(`      ${k} x${v.n}, e.g. at (${v.at.map((x) => x.toFixed(3)).join(', ')})`);
      }
    }
  }
  pieces.dispose(); mounts.dispose();
  world.dispose();
}
process.exit(failed ? 1 : 0);

// ------------------------------------------------------------------ surfaces in one plane
interface Tri { mi: MI; id: number; p: Float64Array; col: number; side: number; part: number }
/**
 * Pairs of triangles of `list` (meshes as placed in the world) lying in one plane within 0.2 mm, overlapping
 * by more than 2 mm, both drawn towards one side, not the same flat ink, and whose draws `want`.
 * `parts`: character meshes, as modelled: only triangles of one rigid part (the vertex colour's alpha) stay in one plane once posed.
 */
function coplanar(list: MI[], order: Map<MI, number>, want: (a: MI, b: MI) => boolean, parts = false): { total: number; where: Map<string, { n: number; at: number[] }> } {
  const Q = 2e-4, where = new Map<string, { n: number; at: number[] }>();
  let total = 0, nid = 0;
  const bins = new Map<string, Tri[]>();
  const v = new pc.Vec3();
  for (const mi of list) {
    const mesh = mi.mesh;
    const pos: number[] = [], idx: number[] = [], col: number[] = [];
    mesh.getPositions(pos); mesh.getIndices(idx); mesh.getVertexStream(pc.SEMANTIC_COLOR, col);
    const pr = mesh.primitive[0], wt = mi.node.getWorldTransform();
    const cullMode = mi.material.cull, ink = mi.material === gfx.inkBack || mi.material === gfx.inkLineMat;
    for (let i = pr.base; i < pr.base + pr.count; i += 3) {
      const p = new Float64Array(9);
      for (let k = 0; k < 3; k++) { const o = idx[i + k] * 3; v.set(pos[o], pos[o + 1], pos[o + 2]); wt.transformPoint(v, v); p[k * 3] = v.x; p[k * 3 + 1] = v.y; p[k * 3 + 2] = v.z; }
      let nx = (p[4] - p[1]) * (p[8] - p[2]) - (p[5] - p[2]) * (p[7] - p[1]), ny = (p[5] - p[2]) * (p[6] - p[0]) - (p[3] - p[0]) * (p[8] - p[2]), nz = (p[3] - p[0]) * (p[7] - p[1]) - (p[4] - p[1]) * (p[6] - p[0]);
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-7) continue;
      nx /= len; ny /= len; nz /= len;
      // One name for the plane whichever way the triangle faces; `side`: the sides it is drawn towards
      // (bit 1: along the name's normal, bit 2: against it).
      const flip = nx < -1e-4 || (Math.abs(nx) <= 1e-4 && (ny < -1e-4 || (Math.abs(ny) <= 1e-4 && nz < 0)));
      if (flip) { nx = -nx; ny = -ny; nz = -nz; }
      const front = flip ? 2 : 1, back = flip ? 1 : 2;
      const side = cullMode === pc.CULLFACE_NONE ? 3 : cullMode === pc.CULLFACE_FRONT ? back : front;
      const d = nx * p[0] + ny * p[1] + nz * p[2];
      // Colour: the ink is one colour; the rest by their first corner's vertex colour (and by texture, in `sameLook`).
      const o0 = idx[i] * 4;
      const c = ink ? -1 : col.length ? ((Math.round(col[o0] * 255) << 16) | (Math.round(col[o0 + 1] * 255) << 8) | Math.round(col[o0 + 2] * 255)) : 0;
      const tri: Tri = { mi, id: nid++, p, col: c, side, part: parts ? Math.round(col[o0 + 3] * 255) : 0 };
      const nk = `${Math.round(nx * 500)},${Math.round(ny * 500)},${Math.round(nz * 500)}`, db = Math.floor(d / (Q * 4));
      for (const b of [db, db + 1]) { const k = `${nk},${b}`; let l = bins.get(k); if (!l) bins.set(k, (l = [])); l.push(tri); }
    }
  }
  const done = new Set<number>();
  for (const tris of bins.values()) {
    if (tris.length < 2) continue;
    // A 2 m grid in the plane's two widest axes, so only neighbours are compared.
    const cells = new Map<number, Tri[]>();
    const a = tris[0].p, nx = Math.abs((a[4] - a[1]) * (a[8] - a[2]) - (a[5] - a[2]) * (a[7] - a[1])), ny = Math.abs((a[5] - a[2]) * (a[6] - a[0]) - (a[3] - a[0]) * (a[8] - a[2])), nz = Math.abs((a[3] - a[0]) * (a[7] - a[1]) - (a[4] - a[1]) * (a[6] - a[0]));
    const drop = nx >= ny && nx >= nz ? 0 : ny >= nz ? 1 : 2, u = drop === 0 ? 1 : 0, w = drop === 2 ? 1 : 2;
    for (const t of tris) {
      const p = t.p, u0 = Math.floor(Math.min(p[u], p[3 + u], p[6 + u]) / 2), u1 = Math.floor(Math.max(p[u], p[3 + u], p[6 + u]) / 2), w0 = Math.floor(Math.min(p[w], p[3 + w], p[6 + w]) / 2), w1 = Math.floor(Math.max(p[w], p[3 + w], p[6 + w]) / 2);
      for (let i = u0; i <= u1; i++) for (let j = w0; j <= w1; j++) { const k = (i + 4096) * 16384 + j + 4096; let l = cells.get(k); if (!l) cells.set(k, (l = [])); l.push(t); }
    }
    for (const cell of cells.values()) for (let i = 0; i < cell.length; i++) for (let j = i + 1; j < cell.length; j++) {
      const A = cell[i], B = cell[j];
      if (!(A.side & B.side) || A.part !== B.part || !want(A.mi, B.mi) || sameLook(A, B)) continue;
      if (!overlap(A.p, B.p, u, w) || !inPlane(A.p, B.p, Q) || !inPlane(B.p, A.p, Q)) continue;
      const key = A.id < B.id ? A.id * 4194304 + B.id : B.id * 4194304 + A.id;
      if (done.has(key)) continue;
      done.add(key);
      total++;
      const first = order.get(A.mi)! <= order.get(B.mi)! ? A : B, second = first === A ? B : A;
      const k = A.mi === B.mi ? `within one ${cls(A.mi)}` : `${cls(first.mi)}  with  ${cls(second.mi)}`;
      const e = where.get(k);
      if (e) e.n++; else where.set(k, { n: 1, at: [(A.p[0] + A.p[3] + A.p[6]) / 3, (A.p[1] + A.p[4] + A.p[7]) / 3, (A.p[2] + A.p[5] + A.p[8]) / 3] });
    }
  }
  return { total, where };
}
/** Two triangles that come out the same colour whichever is drawn: both ink, or one material, colour and texture. */
function sameLook(a: Tri, b: Tri): boolean {
  if (a.col !== b.col) return false;
  if (a.col === -1) return true;
  const tex = (mi: MI) => (mi.getParameter('uTex') as { data?: unknown } | undefined)?.data;
  return a.mi.material === b.mi.material && tex(a.mi) === tex(b.mi);
}
/** Every corner of `b` within `q` of the plane of `a`. */
function inPlane(a: Float64Array, b: Float64Array, q: number): boolean {
  let nx = (a[4] - a[1]) * (a[8] - a[2]) - (a[5] - a[2]) * (a[7] - a[1]), ny = (a[5] - a[2]) * (a[6] - a[0]) - (a[3] - a[0]) * (a[8] - a[2]), nz = (a[3] - a[0]) * (a[7] - a[1]) - (a[4] - a[1]) * (a[6] - a[0]);
  const len = Math.hypot(nx, ny, nz);
  nx /= len; ny /= len; nz /= len;
  for (let k = 0; k < 9; k += 3) if (Math.abs(nx * (b[k] - a[0]) + ny * (b[k + 1] - a[1]) + nz * (b[k + 2] - a[2])) > q) return false;
  return true;
}
/** Do two triangles, flattened onto axes `u` and `w`, overlap by more than 2 mm every way? (Separating axes.) */
function overlap(a: Float64Array, b: Float64Array, u: number, w: number): boolean {
  const EPS = 2e-3;
  for (const t of [a, b]) for (let e = 0; e < 3; e++) {
    const i = e * 3, j = ((e + 1) % 3) * 3;
    let ax = -(t[j + w] - t[i + w]), ay = t[j + u] - t[i + u];
    const l = Math.hypot(ax, ay);
    if (l < 1e-9) continue;
    ax /= l; ay /= l;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (let k = 0; k < 9; k += 3) {
      const da = a[k + u] * ax + a[k + w] * ay, dbb = b[k + u] * ax + b[k + w] * ay;
      if (da < a0) a0 = da; if (da > a1) a1 = da;
      if (dbb < b0) b0 = dbb; if (dbb > b1) b1 = dbb;
    }
    if (Math.min(a1, b1) - Math.max(a0, b0) < EPS) return false;
  }
  return true;
}
