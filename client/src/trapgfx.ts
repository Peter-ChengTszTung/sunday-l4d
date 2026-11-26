// The look of booby traps (docs/booby-traps.html, "Feedback"): an alarm car's dash light and flashing
// headlights, a nightlight's glowing sheep and its cone of light on the floor. The cars themselves are
// ordinary 'car' props drawn by world.ts; these are small separate entities on top, so the baked world
// and its culling tables are untouched.
//   Still parts (pale window tint, Snoozle stickers, the light's housing, a nightlight's wall plate) are
//   baked into one toon mesh and one ink hull for the whole chapter: two draws however many traps.
//   Lit parts are a few tiny entities per trap that share their meshes and materials, switched on only
//   while they show: an armed car is 2 draws for the blink and none between, a ringing car 4, a
//   nightlight 3 (sheep, halo, cone), a spent or dark trap 0 or 1.
import * as pc from 'playcanvas';
import { TILE, STOREY, PLAYER, TRAP, TRAP_ST } from '../../shared/constants';
import type { Level, Trap } from '../../shared/level';
import { type Geo, box, cylinder, sphere, make, merge, inflateSmooth, insideOut, trs, toMesh } from './geo';
import { app, device, DRAW, drawAs, makeUnlit, makeGlow, meshEntity, toonMat, instances, rgb, Batch } from './gfx';
import { INK_LIT } from './pickups';

export interface TrapLooks {
  /**
   * Trap `id` changed: `state` (TRAP_ST), `live` (armed traps lit; false = dark through a holdout or
   * Brute fight), `ringLeft` (seconds of ringing left, RING only).
   */
  set(id: number, state: number, live: boolean, ringLeft: number): void;
  /** Per frame: animate blinking and flashing. `st`/`ringLeft`: every trap's state and ring time, by id. */
  update(t: number, dt: number, camX: number, camY: number, camZ: number, st: Uint8Array, ringLeft: Float32Array): void;
  dispose(): void;
}

const T = TILE;
const cube = box(), ball = sphere(10, 7), disc = cylinder(16);
// Snoozle's colours: candy pink, cream wool, a lilac face.
const PINK = 0xff8fab, WOOL = 0xfff4d2, FACE = 0xc9b3f2, DARK = 0x2b2540;
/** An alarm car's windows: paler than the 0xbfe6ff of every other car (world.ts drawProp). */
const PALE_GLASS = 0xeefaff;
const LED = 0xff2a3c, HEAD = 0xfffbe0, TAIL = 0xff6a78, AMBER = 0xffb52e;
const CONE = 0xffe9a6;
/** Seconds between a ringing car's pulses (the jingle's bar, traps.ts CAR_PULSE), and between an armed car's blinks. */
const PULSE = 0.5, BLINK = 1, BLINK_ON = 0.3;
/** The cone's light lies this far above the floor (a decal: nearer, it flickers from across a room). */
const CONE_Y = 0.03;

type Spot = [x: number, y: number, z: number, size: number, color: number, k: number];
/** Camera-facing halos for `makeGlow`: each corner carries its spot's centre, and (corner, radius) as the normal. */
function haloGeo(spots: Spot[]): Geo {
  const g: Geo = { pos: [], nor: [], col: [], uv: [], idx: [] };
  for (const [x, y, z, size, color, k] of spots) {
    const b = g.pos.length / 3, c = rgb(color);
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { g.pos.push(x, y, z); g.nor.push(u, v, size); g.col.push(Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)); }
    g.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return g;
}

/**
 * The Snoozle sheep of a nightlight, asleep: a wool cloud, a lilac face with closed eyes, drooping ears.
 * Origin: where the light hangs; +z out of the wall. Its ink hull is in the mesh, wound inside-out, so
 * one back-face-culled draw shows both (glowing with the unlit material, or dull with the toon one).
 * `broken`: what a hit leaves, knocked askew with wool missing, a cracked shell and crosses for eyes.
 */
function sheepGeo(broken: boolean): Geo {
  const wool = broken ? 0x9a95ad : WOOL, face = broken ? 0x6a5f86 : FACE;
  const out: Geo[] = [];
  const blob = (c: number, x: number, y: number, z: number, rx: number, ry: number, rz: number, roll = 0): void => {
    const m = trs(x, y, z, 0, 0, roll, rx, ry, rz);
    out.push(make(ball, c, m), insideOut(inflateSmooth(make(ball, INK_LIT, m), 0.014)));
  };
  const ink = (x: number, y: number, z: number, w: number, h: number, roll: number): void => { out.push(make(cube, INK_LIT, trs(x, y, z, 0, 0, roll, w, h, 0.02))); };
  blob(wool, 0, 0.02, 0.05, 0.2, 0.15, 0.09);
  for (let k = 0; k < 7; k++) {
    if (broken && (k === 1 || k === 2 || k === 5)) continue;
    const a = (k / 7) * Math.PI * 2 + 0.3;
    blob(wool, Math.cos(a) * 0.17, 0.02 + Math.sin(a) * 0.125, 0.05, 0.085, 0.085, 0.075);
  }
  if (!broken) blob(wool, 0, 0.13, 0.1, 0.06, 0.055, 0.05);
  blob(face, 0, -0.035, 0.125, 0.105, 0.088, 0.07);
  blob(face, -0.13, -0.02, 0.12, 0.055, 0.028, 0.03, 0.45);
  if (!broken) blob(face, 0.13, -0.02, 0.12, 0.055, 0.028, 0.03, -0.45);
  for (const s of [-1, 1]) {
    if (broken) { ink(s * 0.045, -0.03, 0.19, 0.045, 0.01, 0.78); ink(s * 0.045, -0.03, 0.19, 0.045, 0.01, -0.78); continue; }
    // Closed eyes: a little smile-shaped arc each.
    ink(s * 0.045, -0.034, 0.19, 0.026, 0.009, 0);
    ink(s * 0.045 + 0.019, -0.028, 0.186, 0.02, 0.009, 0.6);
    ink(s * 0.045 - 0.019, -0.028, 0.186, 0.02, 0.009, -0.6);
  }
  if (broken) {
    // A crack down the shell where the wool is gone.
    const zig: [number, number][] = [[0.03, 0.17], [0.09, 0.11], [0.05, 0.08], [0.12, 0.03]];
    for (let i = 0; i + 1 < zig.length; i++) {
      const [ax, ay] = zig[i], [bx, by] = zig[i + 1];
      out.push(make(cube, INK_LIT, trs((ax + bx) / 2, (ay + by) / 2, 0.1, 0, 0, Math.atan2(by - ay, bx - ax), Math.hypot(bx - ax, by - ay) + 0.01, 0.014, 0.08)));
    }
    return make(merge(out), undefined, trs(0.01, -0.035, 0, 0, 0, -0.28));
  }
  return merge(out);
}

/**
 * A nightlight's light on the floor, in the light's own frame (+z the way it shines): a fan TRAP.light.range
 * long and 2 x TRAP.light.half wide, in three flat steps with a bright rim at its end. Each slice stops at
 * the first thing that blocks sight at eye height, as the server's own test does (server/traps.ts), so the
 * pool on the floor is where the trap can see you. Doors count as open: the mask isn't known here.
 * Returns the geometry and each vertex's opacity.
 */
function coneGeo(L: Level, tr: Trap, yaw: number): [Geo, number[]] {
  const g: Geo = { pos: [], nor: [], col: [], uv: [], idx: [] }, alpha: number[] = [];
  const R = TRAP.light.range, half = TRAP.light.half, N = 40, y = CONE_Y - TRAP.light.height, c = rgb(CONE);
  const ox = tr.x + tr.fx * 0.06, oz = tr.z + tr.fz * 0.06;
  const quad = (p: number[], a: number): void => {
    const b = g.pos.length / 3;
    for (let i = 0; i < 4; i++) { g.pos.push(p[i * 2], y, p[i * 2 + 1]); g.col.push(c[0], c[1], c[2]); alpha.push(Math.round(a * 255)); }
    g.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const BANDS = [[0, 0.36, 0.58], [0.36, 0.7, 0.41], [0.7, 1, 0.26]];
  for (let i = 0; i < N; i++) {
    const p0 = -half + (i / N) * 2 * half, p1 = -half + ((i + 1) / N) * 2 * half, pm = (p0 + p1) / 2;
    const reach = Math.min(R, L.ray(ox, tr.y + PLAYER.eye, oz, Math.sin(yaw + pm), 0, Math.cos(yaw + pm), R, -1));
    const s0 = Math.sin(p0), c0 = Math.cos(p0), s1 = Math.sin(p1), c1 = Math.cos(p1);
    const slice = (r0: number, r1: number, a: number): void => { if (r1 > r0 + 1e-3) quad([s0 * r0, c0 * r0, s0 * r1, c0 * r1, s1 * r1, c1 * r1, s1 * r0, c1 * r0], a); };
    for (const [a, b, k] of BANDS) slice(Math.min(a * R, reach), Math.min(b * R, reach), k);
    slice(Math.max(0, reach - 0.08), reach, 0.65);
    // The fan's two straight sides, drawn in so the wedge reads on a pale floor.
    if (i === 0 || i === N - 1) {
      const sp = i === 0 ? p0 : p1, sx = Math.sin(sp), cz = Math.cos(sp), w = (i === 0 ? 1 : -1) * 0.05, r0 = Math.min(0.2, reach);
      quad([sx * r0, cz * r0, sx * reach, cz * reach, sx * reach + cz * w, cz * reach - sx * w, sx * r0 + cz * w, cz * r0 - sx * w], 0.5);
    }
  }
  return [g, alpha];
}

interface View {
  tr: Trap;
  /** Everything of this trap that is switched or animated; off when the trap is out of sight. */
  group: pc.Entity;
  set(state: number, live: boolean): void;
  update(t: number, ringLeft: number): void;
}

export function buildTrapLooks(L: Level): TrapLooks {
  const list = L.def.traps;
  if (!list.length) return { set() {}, update() {}, dispose() {} };
  const root = new pc.Entity('traps');
  app.root.addChild(root);
  const meshes: pc.Mesh[] = [];
  const mesh = (g: Geo, alpha?: number[]): pc.Mesh => { const m = toMesh(device, g, true, alpha); meshes.push(m); return m; };
  /** A halo mesh. Its corners all sit on the spots' centres, so it is given bounds that hold the halos. */
  const haloMesh = (spots: Spot[]): pc.Mesh => {
    const m = mesh(haloGeo(spots)), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const s of spots) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], s[a] - s[3]); hi[a] = Math.max(hi[a], s[a] + s[3]); }
    m.aabb = new pc.BoundingBox(new pc.Vec3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2), new pc.Vec3((hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2));
    return m;
  };
  // Three materials for every trap: lit lamps and the glowing sheep, their halos, the light on the floor.
  const lampMat = drawAs(DRAW.GLOW, makeUnlit({ fog: true }));
  const haloMat = makeGlow(1);
  const coneMat = makeUnlit({ blend: 'normal', vertexAlpha: true, cull: 'none' });
  const part = (parent: pc.Entity, m: pc.Mesh, mat: pc.Material): pc.Entity => { const e = meshEntity(m, mat); e.enabled = false; parent.addChild(e); return e; };
  // Always assign: `enabled` reads false under a hidden parent (a culled trap), so a compare would skip the change.
  // The setter itself does nothing when the value is unchanged.
  const show = (e: pc.Entity, on: boolean): void => { e.enabled = on; };
  const still = new Batch();

  // ------------------------------------------------------------------ alarm car
  // The car's own frame, as world.ts draws it: the floor under its middle, its nose toward -z.
  // The cabin's glass is a box 1.45 wide from z = -0.8 to 1.1 and y = 0.95 to 1.55, whatever the car's length.
  const LED_AT: [number, number, number][] = [[-0.36, 1.07, -0.9], [0.36, 1.07, 1.2]];
  const ledMesh = mesh(merge(LED_AT.map(([x, y, z]) => make(cube, LED, trs(x, y, z, 0, 0, 0, 0.14, 0.1, 0.14)))));
  const ledHalo = haloMesh(LED_AT.map(([x, y, z]): Spot => [x, y + 0.01, z, 0.5, LED, 1.5]));
  const flashMeshes = new Map<number, [pc.Mesh, pc.Mesh]>();
  /** Headlamps, tail lamps and the four indicators of a car `l` long, lit; and their halos. */
  const flashFor = (l: number): [pc.Mesh, pc.Mesh] => {
    let pair = flashMeshes.get(l);
    if (!pair) {
      const g: Geo[] = [], spots: Spot[] = [];
      for (const sx of [-1, 1]) {
        g.push(make(cube, HEAD, trs(sx * 0.55, 0.7, -l / 2 - 0.02, 0, 0, 0, 0.34, 0.22, 0.07)));
        g.push(make(cube, TAIL, trs(sx * 0.6, 0.72, l / 2 + 0.02, 0, 0, 0, 0.3, 0.18, 0.06)));
        for (const sz of [-1, 1]) g.push(make(cube, AMBER, trs(sx * 0.82, 0.7, sz * (l / 2 - 0.02), 0, 0, 0, 0.1, 0.16, 0.1)));
        spots.push([sx * 0.55, 0.7, -l / 2 - 0.08, 0.75, HEAD, 0.9], [sx * 0.6, 0.72, l / 2 + 0.07, 0.5, TAIL, 0.8]);
      }
      flashMeshes.set(l, pair = [mesh(merge(g)), haloMesh(spots)]);
    }
    return pair;
  };

  function carView(tr: Trap): View {
    const p = L.def.props.find((q) => q.type === 'car' && q.x === tr.tx && q.z === tr.tz && q.w === tr.w && q.d === tr.d);
    const ry = p?.rot ?? (tr.w > tr.d ? Math.PI / 2 : 0), l = Math.min(Math.max(tr.w, tr.d) * T - 0.3, 3.8);
    const at = (m: pc.Mat4) => trs(tr.x, tr.y, tr.z, 0, ry, 0).mul(m);
    // The tell that stays: paler glass all round, a pink Snoozle sun strip, and a sheep sticker front and back.
    still.add(cube, PALE_GLASS, at(trs(0, 1.25, -0.81, 0, 0, 0, 1.3, 0.56, 0.03)), 'none');
    still.add(cube, PALE_GLASS, at(trs(0, 1.25, 1.11, 0, 0, 0, 1.3, 0.56, 0.03)), 'none');
    for (const sx of [-1, 1]) for (const z of [-0.325, 0.625]) still.add(cube, PALE_GLASS, at(trs(sx * 0.728, 1.25, z, 0, 0, 0, 0.03, 0.56, 0.85)), 'none');
    still.add(cube, PINK, at(trs(0, 1.47, -0.83, 0, 0, 0, 1.3, 0.1, 0.03)), 'none');
    for (const [z0, s, x] of [[-0.825, -1, 0.36], [1.125, 1, -0.36]]) {
      // Flat discs laid on the glass, each 8 mm proud of the one under it (`s`: the way the glass faces).
      const dot = (c: number, dx: number, dy: number, r: number, layer: number) => still.add(disc, c, at(trs(x + dx, 1.19 + dy, z0 + s * (layer * 0.008 - 0.001), Math.PI / 2, 0, 0, r, 0.01, r)), 'none');
      dot(DARK, 0, 0, 0.185, 1); dot(PINK, 0, 0, 0.165, 2);
      dot(WOOL, 0, 0.01, 0.085, 3);
      for (const [dx, dy] of [[-0.07, 0.05], [0.07, 0.05], [-0.09, -0.02], [0.09, -0.02], [0, 0.085]]) dot(WOOL, dx, dy, 0.055, 3);
      dot(0x6a5796, 0, -0.035, 0.06, 4);
    }
    // The alarm light's housing, at the foot of the windscreen and on the shelf behind the rear glass.
    for (const [x, , z] of LED_AT) still.add(cube, DARK, at(trs(x, 0.995, z, 0, 0, 0, 0.2, 0.05, 0.18)), 'box', 0.012);

    const group = new pc.Entity(`trap-car-${tr.id}`);
    group.setPosition(tr.x, tr.y, tr.z); group.setEulerAngles(0, (ry * 180) / Math.PI, 0);
    root.addChild(group);
    const [flashM, flashH] = flashFor(l);
    const led = part(group, ledMesh, lampMat), ledGlow = part(group, ledHalo, haloMat);
    const flash = part(group, flashM, lampMat), flashGlow = part(group, flashH, haloMat);
    /** 0: no light (spent, or dark). 1: armed, blinking. 2: ringing. */
    let mode = 0;
    return {
      tr, group,
      set(state, live) {
        mode = state === TRAP_ST.RING ? 2 : state !== TRAP_ST.SPENT && live ? 1 : 0;
        if (mode !== 2) { show(flash, false); show(flashGlow, false); }
        if (mode === 0) { show(led, false); show(ledGlow, false); }
      },
      update(t, ringLeft) {
        if (mode === 0) return;
        // Armed: one short blink a second (each car on its own beat). Ringing: solid, and the lamps flash on every bar.
        const on = mode === 2 || (t + tr.id * 0.37) % BLINK < BLINK_ON;
        show(led, on); show(ledGlow, on);
        if (mode !== 2) return;
        const beat = (TRAP.car.ring - ringLeft) % PULSE < PULSE / 2;
        show(flash, beat); show(flashGlow, beat);
      },
    };
  }

  // ----------------------------------------------------------------- nightlight
  // The light's own frame: the point on the wall it hangs from, TRAP.light.height up, +z the way it shines.
  // (The trap's point is 4 cm out from the wall's face: level.ts `nightlight`.)
  const sheepMesh = mesh(sheepGeo(false)), brokenMesh = mesh(sheepGeo(true));
  const sheepHalo = haloMesh([[0, 0, 0.3, 0.75, 0xffd98a, 0.8]]);
  const UNLIT_SHEEP = [0.5, 0.48, 0.6];

  function lightView(tr: Trap): View {
    const yaw = Math.atan2(tr.fx, tr.fz), h = TRAP.light.height;
    // Its plate on the wall stays whatever becomes of the sheep.
    still.add(cube, PINK, trs(tr.x, tr.y + h, tr.z, 0, yaw, 0).mul(trs(0, 0, -0.025, 0, 0, 0, 0.62, 0.5, 0.03)), 'box', 0.015);
    const group = new pc.Entity(`trap-light-${tr.id}`);
    group.setPosition(tr.x, tr.y + h, tr.z); group.setEulerAngles(0, (yaw * 180) / Math.PI, 0);
    root.addChild(group);
    const glow = part(group, sheepMesh, lampMat), halo = part(group, sheepHalo, haloMat);
    const [cg, ca] = coneGeo(L, tr, yaw);
    const cone = part(group, mesh(cg, ca), coneMat);
    // Unlit (dark through a holdout) and broken (spent): ordinary toon models, so a torch still finds them.
    const off = part(group, sheepMesh, toonMat), broken = part(group, brokenMesh, toonMat);
    instances(off)[0].setParameter('uTint', UNLIT_SHEEP);
    const glowMi = instances(glow)[0], haloMi = instances(halo)[0], coneMi = instances(cone)[0], tint = [1, 1, 1];
    /** 0: no light (spent, or dark). 1: armed. 2: chirping (WARN). 3: playing (RING). */
    let mode = 0;
    return {
      tr, group,
      set(state, live) {
        mode = state === TRAP_ST.RING ? 3 : state === TRAP_ST.SPENT || !live ? 0 : state === TRAP_ST.WARN ? 2 : 1;
        show(glow, mode > 0); show(halo, mode > 0); show(cone, mode > 0);
        show(off, mode === 0 && state !== TRAP_ST.SPENT); show(broken, state === TRAP_ST.SPENT);
      },
      update(t) {
        if (mode === 0) return;
        // Armed: a slow breath. Chirping: a hard flicker, brighter. Playing: bright, swelling gently.
        const k = mode === 1 ? 1 + 0.04 * Math.sin(t * 1.7 + tr.id) : mode === 2 ? (Math.sin(t * 40) > 0 ? 1.45 : 0.7) : 1.3 + 0.14 * Math.sin(t * 5);
        tint[0] = tint[1] = tint[2] = k;
        glowMi.setParameter('uTint', tint);
        haloMi.setParameter('uAlpha', (mode === 1 ? 0.5 : 0.75) * k);
        coneMi.setParameter('uAlpha', (mode === 1 ? 1 : 1.35) * k);
      },
    };
  }

  const views = list.map((tr) => (tr.kind === 'car' ? carView(tr) : lightView(tr)));
  root.addChild(still.build(undefined, false, meshes));
  // Past the fog nothing of a trap shows. A nightlight is indoors: two storeys off it can't be seen
  // either (the next storey can, up a stairwell). A car is looked down on from any roof.
  const far = L.def.theme.fogFar + 12;

  return {
    set(id, state, live) { views[id]?.set(state, live); },
    update(t, _dt, camX, camY, camZ, _st, ringLeft) {
      for (const v of views) {
        const tr = v.tr;
        const seen = Math.abs(tr.x - camX) < far && Math.abs(tr.z - camZ) < far && (tr.kind === 'car' || Math.abs(camY - PLAYER.eye - tr.y) < STOREY * 1.25);
        show(v.group, seen);
        if (seen) v.update(t, ringLeft[tr.id]);
      }
    },
    dispose() {
      root.destroy();
      for (const m of meshes) m.destroy();
      lampMat.destroy(); haloMat.destroy(); coneMat.destroy();
    },
  };
}
