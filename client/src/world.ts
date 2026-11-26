// Turns a chapter's grid into cel-shaded scenery. Everything hangs off one
// root entity so a chapter change can tear the whole world down.
import * as pc from 'playcanvas';
import { TILE, CEIL_H, STOREY, WEAPONS } from '../../shared/constants';
import { F, hash2, isIndoor, type Level, type Pickup, type Note, type Prop } from '../../shared/level';
import { type Geo, box, sphere, cylinder, ring, make, merge, trs, toMesh } from './geo';
import { app, device, Batch, DRAW, drawAs, toonMat, inkBack, makeToon, makeUnlit, meshEntity, canvasTexture, freeTexture, whiteTex, setTint } from './gfx';
import { buildCull, type CullStats, type WorldCull } from './cull';
import { worldGun } from './viewmodel';
import { inkGeo, pickupGeo } from './pickups';
import { type Ctx, CHUNK, lampIndoor, nightOf, storeysOf, storeyOfY } from './worldkit';
import { buildStoreys } from './storeys';
import { buildArchitecture } from './arch';
import { buildGround } from './ground';
import { buildAtmosphere, type GlowSpot } from './atmo';
import { buildDressing, type DressStats } from './dressing';

const T = TILE;

export interface PickupView { def: Pickup; group: pc.Entity; float: pc.Entity; taken: boolean; shown: boolean }
export interface NoteView { def: Note; group: pc.Entity; read: boolean }
export interface World {
  L: Level;
  /** Set-dressing counts for the debug overlay and tuning. */ dressing: DressStats;
  /** Debug: how much of the static scenery is being drawn (cull.ts). */ culled(): CullStats;
  /** Dev scripts (bake-cull.ts, check-cull.ts). */ cull: WorldCull;
  pickups: PickupView[];
  notes: NoteView[];
  setDoors(mask: number, instant?: boolean): void;
  setTaken(id: number, taken: boolean): void;
  /** Shows the active step's items / objective marker. */
  setStep(step: number): void;
  setNoteRead(id: number): void;
  update(t: number, dt: number, camX: number, camY: number, camZ: number): void;
  dispose(): void;
}

export function buildWorld(L: Level): World {
  const def = L.def, { W, H } = L, theme = def.theme;
  const root = new pc.Entity('world');
  app.root.addChild(root);
  const textures: pc.Texture[] = [], meshes: pc.Mesh[] = [], materials: pc.Material[] = [];
  /** Materials made for this chapter; destroyed in dispose(). */
  const mat = <M extends pc.Material>(m: M): M => { materials.push(m); return m; };
  /** Upload world-owned geometry; freed in dispose(). */
  const mesh = (g: Geo) => { const m = toMesh(device, g); meshes.push(m); return m; };
  const add = (e: pc.Entity, parent: pc.Entity = root) => { parent.addChild(e); return e; };
  const S = storeysOf(L), WH = W * H;
  const floorOf = (x: number, z: number, lv = 0) => (x < 0 || z < 0 || x >= W || z >= H ? F.NONE : def.floor[lv * WH + z * W + x]);
  const isWall = (x: number, z: number, lv = 0) => (lv ? x < 0 || z < 0 || x >= W || z >= H || S.wall[lv * WH + z * W + x] === 1 : floorOf(x, z) === F.NONE);
  const chunks = (fn: (cx0: number, cz0: number, cx1: number, cz1: number) => void) => {
    for (let cz = 0; cz < H; cz += CHUNK) for (let cx = 0; cx < W; cx += CHUNK) fn(cx, cz, Math.min(W, cx + CHUNK), Math.min(H, cz + CHUNK));
  };
  const cull = buildCull(L, S, theme.fogFar, (e) => add(e), mesh);
  const ctx: Ctx = { L, def, W, H, theme, night: nightOf(theme), root, textures, mesh, mat, add: (e) => add(e), floorOf, isWall, chunks, S, put: cull.put };
  /** Additive halos (lamps, neon, shop windows), drawn as one mesh by the atmosphere. */
  const glowSpots: GlowSpot[] = [];

  // Static props, curbs and lane paint are merged per chunk.
  const batches = new Map<number, Batch>();
  const batchFor = (x: number, z: number) => {
    const k = Math.floor(z / (CHUNK * T)) * 1000 + Math.floor(x / (CHUNK * T));
    let b = batches.get(k);
    if (!b) { b = new Batch(); batches.set(k, b); }
    return b;
  };

  buildArchitecture(ctx, glowSpots); // walls, door frames, ceilings
  const ground = buildGround(ctx, batchFor); // ground textures, curbs, lane paint, water
  if (S.levels > 1) buildStoreys(ctx, batchFor); // slab edges and undersides, railings, stairs, ladders

  // ------------------------------------------------------------------ props
  const cube = box(), cyl = cylinder(14), cone = cylinder(10, 0, 1), ball = sphere(10, 7), shade = cylinder(12, 0.4, 1);
  const glows: Geo[] = [];
  for (const p of def.props) drawProp(batchFor((p.x + p.w / 2) * T, (p.z + p.d / 2) * T), p);
  for (const l of def.lamps) {
    // `ly`: the floor the lamp stands on (or hangs over).
    const ly = l.y ?? 0, b = batchFor(l.x, l.z), at = (m: pc.Mat4) => trs(l.x, ly, l.z).mul(m);
    if (lampIndoor(ctx, l)) {
      // Ceiling fixtures indoors: a pendant in wooden rooms, a fluorescent panel elsewhere.
      if (floorOf(Math.floor(l.x / T), Math.floor(l.z / T), storeyOfY(ly, S.levels)) === F.WOOD) {
        b.add(cyl, 0x2b2840, at(trs(0, CEIL_H - 0.4, 0, 0, 0, 0, 0.02, 0.8, 0.02)), 'none');
        b.add(shade, 0xe8a44f, at(trs(0, CEIL_H - 0.95, 0, 0, 0, 0, 0.42, 0.32, 0.42)), 'smooth', 0.02);
        glows.push(make(ball, 0xffe9b0, trs(l.x, ly + CEIL_H - 1.12, l.z, 0, 0, 0, 0.15)));
        glowSpots.push({ x: l.x, y: ly + CEIL_H - 1.15, z: l.z, size: 1.3, color: 0xffd9a0, k: 0.55 });
      } else {
        const ry = hash2(Math.round(l.x * 3) + 7, Math.round(l.z * 3) + 13) < 0.5 ? 0 : Math.PI / 2;
        // (With a floor right above, the panel hangs a hair lower so its ink outline stays out of that floor.)
        b.add(cube, 0x3a3654, at(trs(0, CEIL_H - 0.045 - (S.levels > 1 ? 0.025 : 0), 0, 0, ry, 0, 1.56, 0.09, 0.56)), 'box', 0.018);
        glows.push(make(cube, 0xf2fbff, trs(l.x, ly + CEIL_H - 0.1 - (S.levels > 1 ? 0.025 : 0), l.z, 0, ry, 0, 1.4, 0.04, 0.4))); // 3 cm under the panel either way
        glowSpots.push({ x: l.x, y: ly + CEIL_H - 0.3, z: l.z, size: 1.5, color: 0xcfeaff, k: 0.4 });
      }
    } else {
      // Street lamp: footing, post, a lantern under a flat cap.
      b.add(cyl, 0x2b2840, at(trs(0, 0.22, 0, 0, 0, 0, 0.15, 0.44, 0.15)), 'smooth', 0.018);
      b.add(cyl, 0x2b2840, at(trs(0, 1.75, 0, 0, 0, 0, 0.055, 3.1, 0.055)), 'smooth', 0.014);
      b.add(cube, 0x2b2840, at(trs(0, 3.24, 0, 0, 0, 0, 0.34, 0.07, 0.34)), 'none');
      b.add(cube, 0x2b2840, at(trs(0, 3.66, 0, 0, 0, 0, 0.62, 0.09, 0.62)), 'box', 0.018);
      glows.push(make(cube, 0xffe9b0, trs(l.x, ly + 3.44, l.z, 0, 0, 0, 0.42, 0.34, 0.42)));
      glowSpots.push({ x: l.x, y: ly + 3.44, z: l.z, size: 1.9, color: 0xffc46b, k: 0.6 });
    }
  }
  // Decorative clutter goes into the same per-chunk batches (no extra draw calls).
  const dressing = buildDressing(ctx, batchFor, glows, glowSpots);
  for (const b of batches.values()) {
    // As Batch.build() would, but through the culling: the hulls are the solids a few centimetres bigger.
    const { solids, hulls } = b.take();
    if (solids.length) cull.put(merge(solids), toonMat);
    if (hulls.length) cull.put({ ...merge(hulls), nor: [] }, inkBack, true);
  }
  if (glows.length) add(meshEntity(mesh(merge(glows)), mat(drawAs(DRAW.GLOW, makeUnlit({ fog: false })))));

  function drawProp(b: Batch, p: Prop): void {
    const cx = (p.x + p.w / 2) * T, cz = (p.z + p.d / 2) * T, r = hash2(p.x * 5 + 3, p.z * 7 + 1);
    const ry = p.rot ?? (p.w > p.d ? Math.PI / 2 : 0);
    const len = Math.max(p.w, p.d) * T, wid = Math.min(p.w, p.d) * T;
    const at = (m: pc.Mat4, rot = ry) => trs(cx, (p.lv ?? 0) * STOREY, cz, 0, rot, 0).mul(m);
    const col = p.color;
    switch (p.type) {
      case 'car': case 'van': {
        const c = col ?? 0xff6b6b, van = p.type === 'van', l = Math.min(len - 0.3, 3.8);
        b.add(cube, c, at(trs(0, van ? 1.0 : 0.62, 0, 0, 0, 0, 1.7, van ? 1.5 : 0.7, l)));
        // Windows. The van's are its cab's side windows: a hair wider than the body and under its roof (level
        // with the roof, they only ever showed as a flickering patch on top).
        b.add(cube, 0xbfe6ff, at(trs(0, van ? 1.44 : 1.25, van ? -l * 0.36 : 0.15, 0, 0, 0, van ? 1.72 : 1.45, van ? 0.58 : 0.6, van ? 0.5 : 1.9)));
        if (!van) b.add(cube, c, at(trs(0, 1.58, 0.15, 0, 0, 0, 1.5, 0.08, 1.95)), 'none');
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(cyl, 0x2b2540, at(trs(sx * 0.85, 0.34, sz * l * 0.32, 0, 0, Math.PI / 2, 0.34, 0.26, 0.34)), 'smooth');
        for (const sx of [-1, 1]) b.add(cube, 0xfff3a8, at(trs(sx * 0.55, 0.7, -l / 2 - 0.01, 0, 0, 0, 0.3, 0.18, 0.06)), 'none');
        // Bumpers, tail lights, hubcaps, a belt line and (on cars) window pillars.
        for (const sz of [-1, 1]) b.add(cube, 0x3a3554, at(trs(0, 0.38, sz * (l / 2 + 0.03), 0, 0, 0, 1.76, 0.2, 0.14)), 'box', 0.02);
        for (const sx of [-1, 1]) b.add(cube, 0xff4d5e, at(trs(sx * 0.6, 0.72, l / 2 + 0.01, 0, 0, 0, 0.26, 0.14, 0.05)), 'none');
        b.add(cube, 0x2b2540, at(trs(0, 0.62, -l / 2 - 0.012, 0, 0, 0, 0.62, 0.16, 0.04)), 'none');
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(cyl, 0xc9c6d6, at(trs(sx * 0.99, 0.34, sz * l * 0.32, 0, 0, Math.PI / 2, 0.16, 0.02, 0.16)), 'none');
        for (const sx of [-1, 1]) b.add(cube, 0x2b2540, at(trs(sx * 0.856, van ? 0.9 : 0.66, 0, 0, 0, 0, 0.012, 0.03, l * 0.9)), 'none');
        if (!van) {
          for (const sx of [-1, 1]) for (const sz of [-0.8, 0.15, 1.1]) b.add(cube, c, at(trs(sx * 0.7, 1.26, sz, 0, 0, 0, 0.1, 0.62, 0.1)), 'none');
          b.add(cube, 0x2b2540, at(trs(0, 0.98, 0.15, 0, 0, 0, 1.72, 0.03, 1.96)), 'none');
        } else {
          b.add(cube, 0x2b2540, at(trs(0, 1.0, l * 0.5 + 0.012, 0, 0, 0, 0.03, 1.3, 0.02)), 'none');
          for (const sx of [-1, 1]) b.add(cube, 0xbfe6ff, at(trs(sx * 0.856, 1.42, -l * 0.3, 0, 0, 0, 0.02, 0.46, 0.6)), 'none');
          b.add(cube, 0xfff1e0, at(trs(0, 1.1, l * 0.12, 0, 0, 0, 1.72, 0.22, l * 0.5)), 'none');
        }
        break;
      }
      case 'bus': case 'truck': {
        const c = col ?? (p.type === 'bus' ? 0xffc94a : 0xe8e3f0), w = Math.min(wid - 0.2, 2.5), l = len - 0.3;
        if (p.type === 'bus') {
          b.add(cube, c, at(trs(0, 1.55, 0, 0, 0, 0, w, 2.5, l)));
          b.add(cube, 0x3b3a66, at(trs(0, 2.0, 0, 0, 0, 0, w + 0.04, 0.8, l * 0.92)), 'none');
          b.add(cube, 0xbfe6ff, at(trs(0, 2.0, -l / 2 - 0.01, 0, 0, 0, w * 0.85, 0.9, 0.06)), 'none');
        } else {
          b.add(cube, c, at(trs(0, 1.75, l * 0.12, 0, 0, 0, w, 2.7, l * 0.74)));
          b.add(cube, 0xff6b6b, at(trs(0, 1.2, -l * 0.38, 0, 0, 0, w * 0.95, 1.8, l * 0.22)));
          b.add(cube, 0xbfe6ff, at(trs(0, 1.6, -l * 0.49, 0, 0, 0, w * 0.8, 0.6, 0.05)), 'none');
        }
        for (const sx of [-1, 1]) for (const sz of [-0.36, 0.36]) b.add(cyl, 0x2b2540, at(trs(sx * w * 0.45, 0.45, sz * l, 0, 0, Math.PI / 2, 0.45, 0.3, 0.45)), 'smooth');
        break;
      }
      case 'container': {
        const c = col ?? [0xd9534f, 0x3f7cc4, 0x4fa36a, 0xe39b3a][Math.floor(r * 4)];
        b.add(cube, c, at(trs(0, 1.3, 0, 0, 0, 0, wid - 0.15, 2.6, len - 0.1)));
        for (let i = -3; i <= 3; i++) b.add(cube, c, at(trs(0, 1.3, (i / 7) * len, 0, 0, 0, wid - 0.05, 2.45, 0.08)), 'none');
        // Dark base rail, corner posts and locking bars on the door end.
        b.add(cube, 0x2b2540, at(trs(0, 0.09, 0, 0, 0, 0, wid - 0.11, 0.18, len - 0.06)), 'none');
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(cube, 0x3a3554, at(trs(sx * (wid / 2 - 0.1), 1.3, sz * (len / 2 - 0.07), 0, 0, 0, 0.14, 2.64, 0.14)), 'none');
        for (const sx of [-0.45, -0.15, 0.15, 0.45]) b.add(cube, 0xe8e3f0, at(trs(sx * (wid - 0.4), 1.3, -len / 2 + 0.03, 0, 0, 0, 0.05, 2.2, 0.05)), 'none');
        b.add(cube, 0xfff1e0, at(trs(0, 1.9, len / 2 - 0.04, 0, 0, 0, (wid - 0.4) * 0.5, 0.4, 0.02)), 'none');
        break;
      }
      case 'barrier':
        b.add(cube, 0xc9c6d6, at(trs(0, 0.45, 0, 0, 0, 0, wid * 0.4, 0.9, len - 0.1)));
        b.add(cube, 0xff6b6b, at(trs(0, 0.75, 0, 0, 0, 0, wid * 0.42, 0.12, len - 0.08)), 'none');
        // Splayed concrete foot, white reflector blocks along the stripe.
        b.add(cube, 0xa9a6ba, at(trs(0, 0.12, 0, 0, 0, 0, wid * 0.62, 0.24, len - 0.06)), 'box', 0.02);
        for (let i = 0, n = Math.max(2, Math.round(len / 1.0)); i < n; i++) b.add(cube, 0xfff6e0, at(trs(0, 0.75, -len / 2 + (i + 0.5) * (len / n), 0, 0, 0, wid * 0.44, 0.15, len / n * 0.34)), 'none'); // 1.5 cm proud of the stripe (5 mm flickered)
        break;
      case 'pallet':
        b.add(cube, 0xb5894f, at(trs(0, 0.15, 0, 0, 0, 0, wid * 0.85, 0.3, len * 0.85)));
        b.add(cube, 0xd9c08a, at(trs(0, 0.65, 0, 0, r, 0, wid * 0.6, 0.7, len * 0.55)));
        break;
      case 'barrel':
        b.add(cyl, col ?? (r < 0.5 ? 0x3f7cc4 : 0xd9534f), at(trs(-0.35, 0.6, -0.3, 0, 0, 0, 0.45, 1.2, 0.45)), 'smooth');
        b.add(cyl, col ?? (r < 0.5 ? 0xd9534f : 0x3f7cc4), at(trs(0.4, 0.6, 0.35, 0, 0, 0, 0.45, 1.2, 0.45)), 'smooth');
        break;
      case 'crate':
        b.add(cube, 0xc8924e, at(trs(0, 0.95, 0, 0, 0, 0, 1.9), (r - 0.5) * 0.12));
        b.add(cube, 0xa9763a, at(trs(0, 0.95, 0, 0, 0, 0, 1.94, 0.22, 1.94), (r - 0.5) * 0.12), 'none');
        // Slatted sides: top/bottom rails and corner posts standing a little proud.
        for (const y of [0.12, 1.78]) b.add(cube, 0xa9763a, at(trs(0, y, 0, 0, 0, 0, 1.96, 0.2, 1.96), (r - 0.5) * 0.12), 'none');
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(cube, 0x96652f, at(trs(sx * 0.9, 0.95, sz * 0.9, 0, 0, 0, 0.2, 1.92, 0.2), (r - 0.5) * 0.12), 'none');
        for (const y of [0.5, 1.4]) b.add(cube, 0xb9843f, at(trs(0, y, 0, 0, 0, 0, 1.915, 0.03, 1.915), (r - 0.5) * 0.12), 'none');
        b.add(cube, 0xfff1c9, at(trs(0.3, 1.25, -0.96, 0, 0, 0, 0.5, 0.3, 0.02), (r - 0.5) * 0.12), 'none');
        b.add(cube, r < 0.5 ? 0xd9a55e : 0x7fa8c9, at(trs((r - 0.5) * 0.3, 2.55, (r - 0.5) * 0.2, 0, r * 2, 0, 1.3), 0));
        break;
      case 'dumpster':
        b.add(cube, 0x3f9f7b, at(trs(0, 0.85, 0, 0, 0, 0, 1.8, 1.7, 1.7)));
        b.add(cube, 0x2f7a5e, at(trs(0, 1.78, 0.1, 0.12, 0, 0, 1.9, 0.14, 1.85)));
        b.add(cube, 0xffe7a3, at(trs(0, 1.0, -0.86, 0, 0, 0, 0.9, 0.3, 0.03)), 'none');
        break;
      case 'tree':
        b.add(cyl, 0x8a5a3c, at(trs(0, 1.0, 0, 0, 0, 0, 0.3, 2.0, 0.3)), 'smooth');
        b.add(ball, 0x4fae6a, at(trs(0, 3.0, 0, 0, r * 6, 0, 1.45, 1.3, 1.45)), 'smooth', 0.06);
        b.add(ball, 0x6cc67a, at(trs(0.55, 3.95, 0.25, 0, r * 3, 0, 0.95), r * 6), 'smooth', 0.06);
        b.add(ball, 0x5fbb72, at(trs(-0.7, 3.5, -0.35, 0, 0, 0, 0.8), r * 6), 'smooth', 0.06);
        // Root flare, a low branch stub and a pale highlight clump on the moonlit side.
        b.add(cone, 0x7a4f35, at(trs(0, 0.25, 0, 0, 0, 0, 0.26, 0.5, 0.26)), 'smooth', 0.02);
        b.add(ball, 0x449a5e, at(trs(0.2, 2.45, -0.75, 0, 0, 0, 0.75, 0.6, 0.75), r * 6), 'smooth', 0.05);
        b.add(ball, 0x8fdc92, at(trs(-0.35, 4.05, 0.55, 0, 0, 0, 0.5, 0.36, 0.5), r * 6), 'none');
        break;
      case 'pine':
        b.add(cyl, 0x7a4f35, at(trs(0, 0.8, 0, 0, 0, 0, 0.25, 1.6, 0.25)), 'smooth');
        for (let i = 0; i < 3; i++) b.add(cone, i === 1 ? 0x3f8f5f : 0x357f55, at(trs(0, 1.6 + i * 1.15, 0, 0, r * 4 + i, 0, 1.5 - i * 0.35, 1.9, 1.5 - i * 0.35)), 'smooth', 0.05);
        break;
      case 'bush':
        b.add(ball, 0x4f9f62, at(trs(0, 0.5, 0, 0, r * 6, 0, 0.95, 0.65, 0.95)), 'smooth', 0.05);
        break;
      case 'rock':
        b.add(ball, 0x8a8197, at(trs(0, 0.55, 0, 0.2, r * 6, 0.1, wid * 0.55, 1.0, len * 0.55)), 'smooth', 0.05);
        break;
      case 'fountain':
        b.add(cyl, 0xa8a4c4, at(trs(0, 0.3, 0, 0, 0, 0, 1.9, 0.6, 1.9)), 'smooth');
        b.add(cyl, 0x6ad1e3, at(trs(0, 0.33, 0, 0, 0, 0, 1.6, 0.6, 1.6)), 'none');
        b.add(cyl, 0xa8a4c4, at(trs(0, 1.1, 0, 0, 0, 0, 0.28, 1.6, 0.28)), 'smooth');
        b.add(ball, 0x8fe3f0, at(trs(0, 2.1, 0, 0, 0, 0, 0.5)), 'smooth');
        break;
      case 'bench':
        b.add(cube, 0xb5894f, at(trs(0, 0.45, 0, 0, 0, 0, 0.7, 0.12, len - 0.4)));
        b.add(cube, 0xb5894f, at(trs(0.3, 0.8, 0, 0, 0, 0, 0.1, 0.5, len - 0.4)));
        break;
      case 'shelf': {
        b.add(cube, 0x8f7aa8, at(trs(0, 1.1, 0, 0, 0, 0, wid * 0.7, 2.2, len - 0.15)));
        for (let y = 0.5; y < 2.1; y += 0.55) for (let i = 0; i < Math.round(len); i++) {
          const k = hash2(p.x * 3 + i, p.z + y * 10);
          b.add(cube, [0xff6b6b, 0xffd43b, 0x74c0fc, 0x8ce99a, 0xffa94d][Math.floor(k * 5)], at(trs(0, y + 0.18, -len / 2 + 0.36 + i, 0, 0, 0, wid * 0.74, 0.3, 0.46)), 'none');
          // A second, differently sized product beside it so rows are not uniform bricks.
          const k2 = hash2(p.x * 7 + i + 3, p.z * 3 + y * 20);
          if (k2 > 0.18) b.add(cube, [0xf783ac, 0xfff3bf, 0x66d9e8, 0xb197fc, 0xffc078][Math.floor(k2 * 5)], at(trs(0, y + 0.1 + k2 * 0.1, -len / 2 + 0.78 + i, 0, 0, 0, wid * 0.74, 0.16 + k2 * 0.2, 0.26)), 'none');
        }
        // Shelf boards and end panels.
        for (let y = 0.44; y < 2.2; y += 0.55) b.add(cube, 0xcfc3e0, at(trs(0, y, 0, 0, 0, 0, wid * 0.76, 0.05, len - 0.13)), 'none');
        for (const sz of [-1, 1]) b.add(cube, 0x7a6694, at(trs(0, 1.12, sz * (len / 2 - 0.09), 0, 0, 0, wid * 0.78, 2.26, 0.07)), 'none');
        break;
      }
      case 'desk':
        b.add(cube, 0xb5894f, at(trs(0, 0.75, 0, 0, 0, 0, wid * 0.8, 0.1, len * 0.8)));
        b.add(cube, 0x8a6a40, at(trs(0, 0.37, 0, 0, 0, 0, wid * 0.7, 0.74, len * 0.7)));
        b.add(cube, 0x2b2540, at(trs(0, 1.1, 0, 0, r, 0, 0.6, 0.45, 0.08)));
        // Screen glow, keyboard, a mug and drawer fronts.
        b.add(cube, 0x9fe8ff, at(trs(0, 1.1, 0, 0, r, 0, 0.5, 0.35, 0.09)), 'none');
        b.add(cube, 0x2b2540, at(trs(0, 0.86, 0, 0, r, 0, 0.1, 0.14, 0.06)), 'none');
        b.add(cube, 0xe8e6f2, at(trs(0.22, 0.815, 0.05, 0, r, 0, 0.16, 0.03, 0.46)), 'none');
        b.add(cyl, 0xff8fa3, at(trs(-0.2, 0.87, len * 0.26, 0, 0, 0, 0.055, 0.14, 0.055)), 'none');
        for (const sz of [-1, 1]) for (const y of [0.24, 0.52]) b.add(cube, 0xa07a4a, at(trs(0, y, sz * (len * 0.35 + 0.006), 0, 0, 0, wid * 0.56, 0.2, 0.01)), 'none');
        break;
      case 'bed':
        b.add(cube, 0xe8e6f2, at(trs(0, 0.5, 0, 0, 0, 0, wid * 0.6, 0.35, len * 0.9)));
        b.add(cube, 0x74c0fc, at(trs(0, 0.72, 0.2, 0, 0, 0, wid * 0.62, 0.12, len * 0.6)), 'none');
        b.add(cube, 0xffffff, at(trs(0, 0.75, -len * 0.35, 0, 0, 0, wid * 0.5, 0.18, 0.4)), 'none');
        // Steel frame: legs, head and foot rails, and a folded blanket edge.
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(cube, 0x8f93a8, at(trs(sx * wid * 0.28, 0.17, sz * len * 0.42, 0, 0, 0, 0.07, 0.34, 0.07)), 'none');
        b.add(cube, 0x8f93a8, at(trs(0, 0.82, -len * 0.455, 0, 0, 0, wid * 0.62, 0.62, 0.06)), 'box', 0.02);
        b.add(cube, 0x8f93a8, at(trs(0, 0.66, len * 0.455, 0, 0, 0, wid * 0.62, 0.34, 0.06)), 'box', 0.02);
        b.add(cube, 0xa5d8ff, at(trs(0, 0.74, -len * 0.1, 0, 0, 0, wid * 0.63, 0.13, 0.14)), 'none');
        break;
      case 'counter':
        b.add(cube, col ?? 0xd9c7e8, at(trs(0, 0.55, 0, 0, 0, 0, wid * 0.8, 1.1, len - 0.1)));
        b.add(cube, 0x8f7aa8, at(trs(0, 1.12, 0, 0, 0, 0, wid * 0.86, 0.08, len - 0.05)), 'none');
        // Kick plate, panel seams and (sometimes) a till.
        b.add(cube, 0x3a3554, at(trs(0, 0.08, 0, 0, 0, 0, wid * 0.81, 0.16, len - 0.09)), 'none');
        for (let i = 1, n = Math.max(1, Math.round(len / 1.0)); i < n; i++) b.add(cube, 0x3a3554, at(trs(0, 0.62, -len / 2 + i * (len / n), 0, 0, 0, wid * 0.81, 0.9, 0.02)), 'none');
        if (r < 0.45) { b.add(cube, 0x54506e, at(trs(0, 1.3, (r - 0.2) * len * 0.5, 0, 0, 0, 0.36, 0.28, 0.4)), 'box', 0.018); b.add(cube, 0x9fe8ff, at(trs(0, 1.5, (r - 0.2) * len * 0.5, 0.4, 0, 0, 0.3, 0.16, 0.03)), 'none'); }
        break;
      case 'pillar': {
        // Up to the ceiling. Under another storey that hangs 3 cm below the floor above (arch.ts): the top goes
        // between the two, since on the floor line itself it flickered with that floor.
        const lv = p.lv ?? 0, ph = lv + 1 < def.levels && floorOf(p.x, p.z, lv + 1) !== F.NONE ? CEIL_H - 0.015 : CEIL_H;
        // (The shaft stops a hair under the capital's top, or the two tops fight.)
        b.add(cube, col ?? 0xbdb5cc, at(trs(0, (ph - 0.02) / 2, 0, 0, 0, 0, wid * 0.6, ph - 0.02, len * 0.6)));
        // Plinth, capital and a painted safety band.
        b.add(cube, 0x8f88a6, at(trs(0, 0.2, 0, 0, 0, 0, wid * 0.72, 0.4, len * 0.72)), 'box', 0.02);
        b.add(cube, 0x8f88a6, at(trs(0, ph - 0.18, 0, 0, 0, 0, wid * 0.74, 0.36, len * 0.74)), 'box', 0.02);
        b.add(cube, 0xffd43b, at(trs(0, 1.25, 0, 0, 0, 0, wid * 0.61, 0.3, len * 0.61)), 'none');
        b.add(cube, 0x2b2540, at(trs(0, 1.25, 0, 0, 0, 0, wid * 0.615, 0.08, len * 0.615)), 'none');
        break;
      }
      case 'gen':
        b.add(cube, 0xf2c14e, at(trs(0, 0.7, 0, 0, 0, 0, 1.6, 1.4, 1.3)));
        b.add(cube, 0x2b2540, at(trs(0, 0.85, -0.66, 0, 0, 0, 1.0, 0.6, 0.04)), 'none');
        b.add(cyl, 0x5a5670, at(trs(0.5, 1.6, 0.3, 0, 0, 0, 0.12, 0.5, 0.12)), 'smooth');
        break;
      case 'radio':
        b.add(cube, 0xb5894f, at(trs(0, 0.5, 0, 0, 0, 0, 1.5, 1.0, 1.0)));
        b.add(cube, 0x5a7a5a, at(trs(0, 1.25, 0, 0, 0, 0, 1.0, 0.5, 0.6)));
        b.add(cube, 0xffd43b, at(trs(-0.25, 1.25, -0.31, 0, 0, 0, 0.3, 0.2, 0.02)), 'none');
        b.add(cyl, 0x2b2540, at(trs(0.35, 1.9, 0, 0, 0, 0.2, 0.03, 0.9, 0.03)), 'none');
        break;
      case 'lever':
        b.add(cube, 0x6f7f9a, at(trs(0, 0.7, 0, 0, 0, 0, 0.9, 1.4, 0.6)));
        b.add(cyl, 0xff6b6b, at(trs(0, 1.6, -0.1, 0.5, 0, 0, 0.07, 0.8, 0.07)), 'none');
        b.add(ball, 0x2b2540, at(trs(0, 1.95, -0.3, 0, 0, 0, 0.14)), 'none');
        break;
      case 'terminal':
        b.add(cube, 0x6f7f9a, at(trs(0, 0.6, 0, 0, 0, 0, 1.3, 1.2, 0.9)));
        b.add(cube, 0x2b2540, at(trs(0, 1.55, 0.15, -0.3, 0, 0, 1.1, 0.75, 0.12)));
        b.add(cube, 0x6cf0c2, at(trs(0, 1.55, 0.08, -0.3, 0, 0, 0.9, 0.58, 0.02)), 'none');
        break;
      case 'valve':
        b.add(cyl, 0x8f93a8, at(trs(0, 0.6, 0, Math.PI / 2, 0, 0, 0.35, 1.9, 0.35)), 'smooth');
        b.add(cyl, 0xff6b6b, at(trs(0, 1.25, 0, 0, 0, 0, 0.55, 0.08, 0.55)), 'none');
        b.add(cyl, 0x8f93a8, at(trs(0, 1.0, 0, 0, 0, 0, 0.08, 0.5, 0.08)), 'none');
        break;
      case 'battery':
        b.add(cube, 0x3b3a66, at(trs(0, 0.55, 0, 0, 0, 0, 1.4, 1.1, 1.0)));
        b.add(cyl, 0xff6b6b, at(trs(-0.35, 1.2, 0, 0, 0, 0, 0.12, 0.2, 0.12)), 'none');
        b.add(cyl, 0x2b2540, at(trs(0.35, 1.2, 0, 0, 0, 0, 0.12, 0.2, 0.12)), 'none');
        b.add(cube, 0xffd43b, at(trs(0, 0.7, -0.51, 0, 0, 0, 0.8, 0.25, 0.02)), 'none');
        break;
      case 'tank': {
        const c = col ?? 0xc9a8ff;
        if (p.w === p.d) {
          // Upright storage tank: body, a cream band, a shallow dome and a ladder.
          // Under a ceiling (an indoor floor, or a storey built over it) the tank stops below it, dome
          // included, or it pokes up through the slab into the room above (the Hush Works vats into the labs).
          const lv = p.lv ?? 0;
          let covered = false;
          for (let z = p.z; z < p.z + p.d && !covered; z++) for (let x = p.x; x < p.x + p.w && !covered; x++) {
            const f = floorOf(x, z, lv);
            if (f === F.NONE) continue; // off the map
            covered = isIndoor(f) || (lv + 1 < def.levels && !def.air[(lv + 1) * WH + z * W + x]);
          }
          const R = wid / 2 - 0.2, H = covered ? Math.min(9, 2 + wid, CEIL_H - 0.15 - R * 0.3) : Math.min(9, 2 + wid);
          b.add(cyl, c, at(trs(0, H / 2, 0, 0, 0, 0, R, H, R)), 'smooth');
          b.add(cyl, 0xfff1e6, at(trs(0, H * 0.55, 0, 0, 0, 0, R + 0.04, H * 0.16, R + 0.04)), 'smooth');
          b.add(ball, c, at(trs(0, H, 0, 0, 0, 0, R, R * 0.3, R)), 'smooth');
          b.add(cube, 0x2b2540, at(trs(R + 0.06, H / 2, 0, 0, 0, 0, 0.08, H, 0.45)), 'none');
        } else {
          // Tanker car: a horizontal barrel on a low chassis.
          const R = Math.min(wid / 2 - 0.15, 1.3), l = len - 0.6, y = 0.75 + R;
          b.add(cube, 0x2b2540, at(trs(0, 0.6, 0, 0, 0, 0, wid * 0.7, 0.25, len - 0.3)));
          b.add(cyl, c, at(trs(0, y, 0, Math.PI / 2, 0, 0, R, l, R)), 'smooth');
          for (const s of [-1, 1]) b.add(ball, c, at(trs(0, y, (s * l) / 2, 0, 0, 0, R, R, 0.35)), 'smooth');
          b.add(cyl, 0xfff1e6, at(trs(0, y + R, 0, 0, 0, 0, 0.35, 0.3, 0.35)), 'smooth');
          for (const sx of [-1, 1]) for (const sz of [-0.35, 0.35]) b.add(cyl, 0x2b2540, at(trs(sx * wid * 0.3, 0.4, sz * len, 0, 0, Math.PI / 2, 0.4, 0.25, 0.4)), 'smooth');
        }
        break;
      }
      case 'beacon':
        b.add(cyl, 0x5a5670, at(trs(0, 1.6, 0, 0, 0, 0, 0.18, 3.2, 0.18)), 'smooth');
        b.add(cube, 0x6f7f9a, at(trs(0, 0.3, 0, 0, 0, 0, 1.2, 0.6, 1.2)));
        break;
    }
  }

  // ------------------------------------------------------------------ doors
  /** One 128 px texture per door kind, shared by every door of that kind. */
  const paintDoor = (kind: string): HTMLCanvasElement => {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
    const g = cv.getContext('2d')!;
    if (kind === 'shutter') {
      g.fillStyle = '#ffd43b'; g.fillRect(0, 0, 128, 128); g.fillStyle = '#1a1226';
      for (let i = -128; i < 256; i += 48) { g.beginPath(); g.moveTo(i, 128); g.lineTo(i + 24, 128); g.lineTo(i + 152, 0); g.lineTo(i + 128, 0); g.fill(); }
    } else if (kind === 'barricade') {
      g.fillStyle = '#7a5235'; g.fillRect(0, 0, 128, 128);
      for (let y = 0; y < 128; y += 32) { g.fillStyle = y % 64 ? '#b5894f' : '#a0743f'; g.fillRect(0, y + 3, 128, 26); }
      g.strokeStyle = '#1a1226'; g.lineWidth = 6; g.beginPath(); g.moveTo(8, 8); g.lineTo(120, 120); g.moveTo(120, 8); g.lineTo(8, 120); g.stroke();
    } else if (kind === 'boom') {
      // Army checkpoint barrier: olive panel, a red-and-white striped arm across it, a stop disc.
      g.fillStyle = '#5f6b3f'; g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#4a5530'; for (let y = 8; y < 128; y += 24) g.fillRect(0, y, 128, 4);
      g.fillStyle = '#f4f4ff'; g.fillRect(0, 44, 128, 26); g.fillStyle = '#e03131';
      for (let x = -26; x < 128; x += 32) { g.beginPath(); g.moveTo(x, 70); g.lineTo(x + 16, 70); g.lineTo(x + 42, 44); g.lineTo(x + 26, 44); g.fill(); }
      g.strokeStyle = '#1a1226'; g.lineWidth = 3; g.strokeRect(0, 44, 128, 26);
      // No lettering: the one texture shows on both faces, so words read mirrored from one side.
      g.fillStyle = '#e03131'; g.beginPath(); g.arc(64, 98, 16, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#f4f4ff'; g.lineWidth = 4; g.beginPath(); g.arc(64, 98, 11, 0, Math.PI * 2); g.stroke();
    } else if (kind === 'boomArm') {
      // A checkpoint boom arm: red and white bands.
      for (let x = 0; x < 128; x += 32) { g.fillStyle = '#f4f4ff'; g.fillRect(x, 0, 16, 128); g.fillStyle = '#e03131'; g.fillRect(x + 16, 0, 16, 128); }
    } else if (kind === 'lift') {
      // Brushed-steel elevator doors: two leaves, a centre seam, a dark sill and header.
      const grad = g.createLinearGradient(0, 0, 128, 0);
      grad.addColorStop(0, '#9aa3b4'); grad.addColorStop(0.45, '#d6dbe6'); grad.addColorStop(0.5, '#8c94a6'); grad.addColorStop(0.55, '#d6dbe6'); grad.addColorStop(1, '#9aa3b4');
      g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#2a2f3d'; g.fillRect(0, 0, 128, 10); g.fillRect(0, 120, 128, 8); g.fillRect(62, 10, 4, 110);
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1;
      for (let x = 6; x < 128; x += 9) { if (x > 58 && x < 70) continue; g.beginPath(); g.moveTo(x, 12); g.lineTo(x, 118); g.stroke(); }
    } else if (kind === 'bridge') {
      // The underside of a raised drawbridge leaf: steel deck plates, rivet lines, hazard bands top and bottom.
      g.fillStyle = '#5a6074'; g.fillRect(0, 0, 128, 128);
      g.strokeStyle = '#3a3f52'; g.lineWidth = 3;
      for (let x = 0; x <= 128; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); }
      for (let y = 22; y <= 106; y += 28) { g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke(); }
      g.fillStyle = '#c9ccdc'; for (let x = 8; x < 128; x += 16) for (let y = 30; y < 100; y += 28) g.fillRect(x, y, 3, 3);
      for (const y0 of [0, 112]) { g.fillStyle = '#f4f4ff'; g.fillRect(0, y0, 128, 16); g.fillStyle = '#e03131'; for (let x = 0; x < 128; x += 32) g.fillRect(x, y0, 16, 16); }
    } else {
      g.fillStyle = '#4a4e66'; g.fillRect(0, 0, 128, 128); g.strokeStyle = '#c9ccdc'; g.lineWidth = 3;
      for (let i = -128; i < 256; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 128, 128); g.moveTo(i + 128, 0); g.lineTo(i, 128); g.stroke(); }
    }
    return cv;
  };
  const doorTex = new Map<string, pc.Texture>();
  // One textured toon material for every door of the chapter; each door sets its own `uTex`. (Its own,
  // not the ground's: doors have their own row of the draw order, straight after the walls. See gfx.ts `DRAW`.)
  const doorMat = mat(drawAs(DRAW.DOOR, makeToon({ tex: whiteTex })));
  const texFor = (kind: string): pc.Texture => {
    let tex = doorTex.get(kind);
    if (!tex) { tex = canvasTexture(() => paintDoor(kind)); doorTex.set(kind, tex); textures.push(tex); }
    return tex;
  };
  /** A box (in the parent's space) with a door texture. */
  const texBox = (parent: pc.Entity, kind: string, m: pc.Mat4): pc.Entity => {
    const e = add(meshEntity(mesh(make(box(), undefined, m)), doorMat), parent);
    e.render!.meshInstances[0].setParameter('uTex', texFor(kind));
    return e;
  };
  /**
   * Hinged doors swing instead of sliding. Each hinge is a pivot whose local +z is the moving part's
   * length; `closed` and `open` are its two rotations, blended by the view's progress.
   */
  interface Hinge { pivot: pc.Entity; closed: pc.Quat; open: pc.Quat }
  const yawed = (yaw: number, pitch: number): pc.Quat => new pc.Quat().mul2(new pc.Quat().setFromEulerAngles(0, yaw, 0), new pc.Quat().setFromEulerAngles(pitch, 0, 0));
  const hingesFor = (d: (typeof def.doors)[number], root: pc.Entity, base: number): Hinge[] => {
    const alongX = d.x1 - d.x0 >= d.z1 - d.z0;
    const w = (d.x1 - d.x0 + 1) * T, dd = (d.z1 - d.z0 + 1) * T;
    if (d.kind === 'bridge') {
      // A bascule leaf hinged on the gap's near edge: raised it stands upright, lowered it lies on the deck
      // across the gap (a hair proud of it, so the two never share a plane).
      const len = alongX ? dd : w, wid = alongX ? w : dd, th = 0.14;
      const pivot = add(new pc.Entity('leaf'), root);
      pivot.setPosition(d.x0 * T + (alongX ? w / 2 : 0), base, d.z0 * T + (alongX ? 0 : dd / 2));
      texBox(pivot, 'bridge', trs(0, th / 2 + 0.03, len / 2, 0, 0, 0, wid, th, len));
      const yaw = alongX ? 0 : 90;
      return [{ pivot, closed: yawed(yaw, -90), open: yawed(yaw, 0) }];
    }
    // Boom gate: a post at each end of the opening, an arm from each meeting in the middle; they swing up.
    const L = alongX ? w : dd, out: Hinge[] = [], armY = 1.05;
    for (const end of [0, 1]) {
      const sgn = end ? -1 : 1, off = 0.3;
      const px = alongX ? d.x0 * T + (end ? w - off : off) : d.x0 * T + w / 2;
      const pz = alongX ? d.z0 * T + dd / 2 : d.z0 * T + (end ? dd - off : off);
      texBox(root, 'boom', trs(px, base + armY / 2 + 0.1, pz, 0, 0, 0, 0.36, armY + 0.2, 0.36));
      const pivot = add(new pc.Entity('arm'), root);
      pivot.setPosition(px, base + armY, pz);
      const len = L / 2 - off - 0.05;
      texBox(pivot, 'boomArm', trs(0, 0, len / 2 + 0.18, 0, 0, 0, 0.16, 0.16, len));
      const yaw = alongX ? (sgn > 0 ? 90 : -90) : (sgn > 0 ? 0 : 180);
      out.push({ pivot, closed: yawed(yaw, 0), open: yawed(yaw, -82) });
    }
    return out;
  };
  const doorViews = def.doors.map((d) => {
    const w = (d.x1 - d.x0 + 1) * T, dd = (d.z1 - d.z0 + 1) * T;
    const sx = w >= dd ? w : 0.4, sz = w >= dd ? 0.4 : dd;
    if (d.kind === 'bridge' || d.kind === 'boom') {
      const e = add(new pc.Entity(d.kind));
      const base = (d.lv ?? 0) * STOREY;
      const hinges = hingesFor(d, e, base);
      // Seconds for a full swing: the drawbridge takes its time, the boom flicks up.
      const secs = d.kind === 'bridge' ? 7 : 1.8;
      const v = { d, e, x: 0, z: 0, base, fold: 0, y: CEIL_H / 2, open: false, hinges, p: 0, secs };
      for (const h of hinges) h.pivot.setLocalRotation(h.closed);
      return v;
    }
    const tex = texFor(d.kind);
    // With storeys the door stops 3 cm under the floor above (at the hung ceiling): its top on that floor flickered.
    const dh = S.levels > 1 ? 0.03 : 0;
    const e = add(meshEntity(mesh(make(box(), undefined, new pc.Mat4().setTRS(new pc.Vec3(0, -dh / 2, 0), pc.Quat.IDENTITY, new pc.Vec3(sx, CEIL_H - dh, sz)))), doorMat));
    e.render!.meshInstances[0].setParameter('uTex', tex);
    const x = ((d.x0 + d.x1 + 1) / 2) * T, z = ((d.z0 + d.z1 + 1) / 2) * T;
    // A flat map's door slides away whole: a shutter up into the wall above, the others down into the
    // ground. With storeys that would poke into the room above or below, so there it rolls up (or
    // folds down) in place: `fold` squashes it against the ceiling (1) or the floor (-1).
    const lv = d.lv ?? 0, base = lv * STOREY;
    let fold = 0;
    if (S.levels > 1) {
      const up = d.kind === 'shutter', k = up ? lv + 1 : lv - 1;
      let clear = k >= 0 && k < S.levels;
      for (let cz = d.z0; cz <= d.z1 && clear; cz++) for (let cx = d.x0; cx <= d.x1; cx++) if (!S.wall[k * WH + cz * W + cx]) { clear = false; break; }
      // A shutter with nothing built over it (the top storey, or open air above) still has headroom where the
      // walls at both ends of the doorway carry on up past the rolled-up door: it slides up between them.
      if (!clear && up) {
        let open = true;
        if (k < S.levels) for (let cz = d.z0; cz <= d.z1 && open; cz++) for (let cx = d.x0; cx <= d.x1; cx++) if (!def.air[k * WH + cz * W + cx]) { open = false; break; }
        const tall = (cx: number, cz: number): boolean => { const n = lv * WH + cz * W + cx; return cx >= 0 && cz >= 0 && cx < W && cz < H && S.wall[n] === 1 && S.top[n] >= base + 2 * CEIL_H - 0.35; };
        const alongX = d.x1 - d.x0 >= d.z1 - d.z0;
        clear = open && (alongX ? tall(d.x0 - 1, d.z0) && tall(d.x1 + 1, d.z0) : tall(d.x0, d.z0 - 1) && tall(d.x0, d.z1 + 1));
      }
      if (!clear && !(k < 0)) fold = up ? 1 : -1;
    }
    const v = { d, e, x, z, base, fold, y: CEIL_H / 2, open: false, hinges: [] as Hinge[], p: 0, secs: 0 };
    e.setPosition(x, base + v.y, z);
    return v;
  });
  const _q = new pc.Quat();
  /** Hinged doors: pose every hinge at progress `p` (0 closed, 1 open), eased in and out. */
  const swingDoor = (v: DoorView): void => {
    const k = v.p * v.p * (3 - 2 * v.p);
    for (const h of v.hinges) h.pivot.setLocalRotation(_q.slerp(h.closed, h.open, k));
  };
  type DoorView = (typeof doorViews)[number];
  /** `y` is the door's centre above its own floor, as if it slid: closed at CEIL_H / 2. */
  const doorTarget = (v: DoorView) => CEIL_H / 2 + (v.open ? (v.d.kind === 'shutter' ? CEIL_H - 0.3 : -CEIL_H - 0.1) : 0);
  const placeDoor = (v: DoorView): void => {
    if (!v.fold) { v.e.setPosition(v.x, v.base + v.y, v.z); return; }
    // How far it has travelled, as the fraction of itself that has rolled away.
    const k = Math.max(0.05, 1 - Math.abs(v.y - CEIL_H / 2) / (CEIL_H - 0.3));
    v.e.setLocalScale(1, k, 1);
    v.e.setPosition(v.x, v.base + (v.fold > 0 ? CEIL_H - (CEIL_H * k) / 2 : (CEIL_H * k) / 2), v.z);
  };

  // ---------------------------------------------------------------- pickups
  const RING: Record<string, number> = { medkit: 0xff6b8a, plaster: 0x63e6be, vitamins: 0x63e6be, cocoa: 0x63e6be, ammo: 0xa9e34b, item: 0xffd43b, armor: 0x74c0fc, firebomb: 0xff7a3a, rattle: 0xff7a3a };
  /** Ground ring colour: fixed for supplies, by tier for weapons (blue = basic, orange-gold = tier 2). */
  const ringColor = (kind: string): number => RING[kind] ?? ((WEAPONS.find((w) => w.id === kind)?.tier ?? 1) >= 2 ? 0xffa53a : 0x74c0fc);
  const arrowMesh = mesh(make(cylinder(4, 0, 1), undefined, trs(0, 0, 0, Math.PI, 0, 0, 0.28, 0.5, 0.28)));
  const objMat = mat(drawAs(DRAW.MARK, makeUnlit({ color: 0xffd43b, fog: false })));
  // Pickup models (pickups.ts) are one mesh each, shared by every pickup of that kind.
  const floatCache = new Map<string, pc.Mesh>();
  const floatMesh = (key: string): pc.Mesh => {
    let m = floatCache.get(key);
    if (!m) { m = mesh(pickupGeo(key)); floatCache.set(key, m); }
    return m;
  };
  // Floor rings and pedestals never move, so every one on the map shares two meshes (one draw each),
  // rebuilt whenever a pickup appears or is taken (see `rebuildBases`).
  const ringGeo = ring(0.42, 0.56, 24);
  const pedGeo = inkGeo([[0.5, 0.36, 0.5, 0x54506e, 0, 0.18, 0]]), notePedGeo = inkGeo([[0.5, 0.5, 0.5, 0x54506e, 0, 0.25, 0]]);
  const ringsEnt = add(meshEntity(mesh(make(ringGeo)), mat(makeUnlit({ alpha: 0.85, blend: 'normal' }))));
  const pedsEnt = add(meshEntity(mesh(pedGeo), toonMat));
  let basesDirty = true;

  function buildPickup(p: Pickup): PickupView {
    const group = new pc.Entity('pickup');
    group.setPosition(p.x, p.y ?? 0, p.z);
    const float = new pc.Entity('float');
    float.setLocalPosition(0, 0.75, 0);
    switch (p.kind) {
      case 'medkit': case 'ammo': case 'armor': case 'plaster': case 'vitamins': case 'cocoa': float.addChild(meshEntity(floatMesh(p.kind), toonMat)); break;
      case 'obj': float.addChild(meshEntity(arrowMesh, objMat)); break;
      case 'item': float.addChild(meshEntity(floatMesh(p.look ?? 'part'), toonMat)); break;
      default: {
        const gun = worldGun(p.kind);
        gun.setLocalScale(1.9, 1.9, 1.9);
        gun.setLocalEulerAngles(0, 90, 0);
        float.addChild(gun);
      }
    }
    group.addChild(float);
    add(group);
    const shown = p.kind !== 'obj' && p.kind !== 'item';
    group.enabled = shown;
    return { def: p, group, float, taken: false, shown };
  }
  const pickups = def.pickups.map(buildPickup);

  const noteMat = mat(drawAs(DRAW.MARK, makeUnlit({ color: 0xfff6e0 })));
  const paperMesh = mesh(make(box(), undefined, trs(0, 0, 0, 0, 0, 0, 0.42, 0.02, 0.55)));
  const notes: NoteView[] = def.notes.map((n) => {
    const group = new pc.Entity('note');
    group.setPosition(n.x, n.y ?? 0, n.z);
    const paper = meshEntity(paperMesh, noteMat);
    paper.setLocalPosition(0, 0.62, 0); paper.setLocalEulerAngles(-25, hash2(n.id, 3) * 360, 0);
    group.addChild(paper);
    add(group);
    return { def: n, group, read: false };
  });

  function rebuildBases(): void {
    basesDirty = false;
    const rings: Geo[] = [], peds: Geo[] = [];
    for (const p of pickups) {
      if (!p.shown || p.taken || p.def.kind === 'obj') continue;
      const py = p.def.y ?? 0;
      rings.push(make(ringGeo, ringColor(p.def.kind), trs(p.def.x, py + 0.04, p.def.z)));
      if (p.def.kind !== 'item') peds.push(make(pedGeo, undefined, trs(p.def.x, py, p.def.z)));
    }
    for (const n of def.notes) { const ny = n.y ?? 0; rings.push(make(ringGeo, 0xfff6e0, trs(n.x, ny + 0.04, n.z))); peds.push(make(notePedGeo, undefined, trs(n.x, ny, n.z))); }
    for (const [e, list] of [[ringsEnt, rings], [pedsEnt, peds]] as const) {
      e.enabled = list.length > 0;
      if (!list.length) continue;
      // Unpinned: the mesh instance owns it. Swapping the mesh only drops the old one's reference,
      // so free it here (the first, pinned mesh stays for dispose()), and reset the cached bounds:
      // a fresh mesh has the same bounds version as the one it replaced, so they wouldn't recompute.
      const mi = e.render!.meshInstances[0], old = mi.mesh;
      mi.mesh = toMesh(device, merge(list), false);
      mi.setCustomAabb(null);
      if (old && old.refCount < 1) old.destroy();
    }
  }

  // Beacon light that blinks over the active objective machine.
  const beacon = add(meshEntity(mesh(make(ball)), mat(drawAs(DRAW.MARK, makeUnlit({ fog: false })))));
  beacon.setLocalScale(0.16, 0.16, 0.16);
  beacon.enabled = false;
  let activeObj = -1;

  const atmo = buildAtmosphere(ctx, glowSpots); // light map, sky, skyline, glows, weather

  const world: World = {
    L, dressing, pickups, notes, culled: cull.stats, cull,
    setDoors(mask, instant) {
      for (const v of doorViews) {
        v.open = !!(mask & (1 << v.d.id));
        if (instant) { if (v.hinges.length) { v.p = v.open ? 1 : 0; swingDoor(v); } else { v.y = doorTarget(v); placeDoor(v); } }
      }
    },
    setTaken(id, taken) { const p = pickups[id]; if (p) { if (p.taken !== taken) basesDirty = true; p.taken = taken; p.group.enabled = p.shown && !taken; } },
    setStep(step) {
      const s = def.steps[step];
      activeObj = s?.kind === 'use' && s.target !== undefined ? s.target : -1;
      for (const p of pickups) {
        // Items show in a collect step, or in a holdout that waits on them (Step.gates items).
        if (p.def.kind === 'item') p.shown = (s?.kind === 'collect' || !!s?.gates?.some((g) => g.items !== undefined)) && s?.group === p.def.group;
        else if (p.def.kind === 'obj') p.shown = p.def.id === activeObj;
        p.group.enabled = p.shown && !p.taken;
      }
      basesDirty = true;
      const o = pickups[activeObj];
      beacon.enabled = !!o;
      if (o) beacon.setPosition(o.def.x, (o.def.y ?? 0) + 2.2, o.def.z);
    },
    setNoteRead(id) { const n = notes[id]; if (n) n.read = true; },
    update(t, dt, camX, camY, camZ) {
      if (basesDirty) rebuildBases();
      for (const v of doorViews) {
        if (v.hinges.length) {
          const goal = v.open ? 1 : 0;
          if (v.p !== goal) { v.p = goal > v.p ? Math.min(goal, v.p + dt / v.secs) : Math.max(goal, v.p - dt / v.secs); swingDoor(v); }
          continue;
        }
        const target = doorTarget(v);
        if (Math.abs(target - v.y) > 0.001) { v.y += (target - v.y) * Math.min(1, dt * 1.8); placeDoor(v); }
      }
      // Pickups are many small draw calls each: skip the ones the fog has already swallowed.
      const far = theme.fogFar + 12;
      for (const p of pickups) {
        p.group.enabled = p.shown && !p.taken && (p.def.kind === 'obj' || (Math.abs(p.def.x - camX) < far && Math.abs(p.def.z - camZ) < far));
        if (!p.group.enabled) continue;
        p.float.setLocalEulerAngles(0, (t * 92 + p.def.id * 57) % 360, 0);
        p.float.setLocalPosition(0, (p.def.kind === 'obj' ? 2.9 : 0.78) + Math.sin(t * 2.4 + p.def.id) * 0.07, 0);
      }
      if (beacon.enabled) {
        const used = pickups[activeObj]?.taken;
        const blink = used ? Math.sin(t * 18) > 0 : Math.sin(t * 3) > 0.6;
        setTint(beacon, used ? (blink ? 0x7dff8a : 0x1f6a34) : blink ? 0xff4d5e : 0x6a1f2a);
      }
      for (const n of notes) n.group.enabled = Math.abs(n.def.x - camX) < far && Math.abs(n.def.z - camZ) < far;
      cull.update(camX, camY, camZ);
      ground.update(camX, camY, camZ);
      atmo.update(t, dt, camX, camY, camZ);
    },
    dispose() {
      atmo.dispose();
      ground.dispose();
      cull.dispose();
      root.destroy();
      for (const t of textures) freeTexture(t);
      for (const m of meshes) m.destroy();
      for (const m of materials) m.destroy();
    },
  };
  return world;
}
