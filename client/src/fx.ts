import { DROOLER, FIRE } from '../../shared/constants';
// Pooled comic-book effects: tracers, star bursts, goo blobs and poof clouds.
// Particles shrink instead of fading so they stay opaque and cel-flat.
import * as pc from 'playcanvas';
import { box, sphere, ring, make, merge, toMesh, trs } from './geo';
import { app, device, meshEntity, makeUnlit, toonMat, outlineMat, tintOf } from './gfx';
import { STAR_MESH } from './viewmodel';

interface Particle {
  ent: pc.Entity; mi: pc.MeshInstance; vx: number; vy: number; vz: number; life: number; max: number; size: number;
  grav: number; spin: number; grow: number; x: number; y: number; z: number;
  /** Floor height under where it was spawned (it bounces there). */ fl: number;
}
/** Particles of one kind. `free` is a stack of the indices in `items` that are dead, so spawning never searches. */
interface Pool { items: Particle[]; free: number[]; mesh: pc.Mesh; mat: pc.Material; star: boolean }
interface Tracer { ent: pc.Entity; life: number }
/** Drooler goo in flight: a ballistic arc from (x0, y0, z0) to (x1, y1, z1) (y: floor heights; multi-storey maps). */
interface Glob { ent: pc.Entity; x0: number; z0: number; x1: number; z1: number; y0: number; y1: number; t: number; flight: number }
/** `y`: the floor height it lies on. */
interface Puddle { ent: pc.Entity; id: number; x: number; y: number; z: number; r: number; age: number; life: number; bub: number }
/** A firebomb's burning patch: scorch disc plus a steady stream of flame blobs. `snd`: seconds to the next crackle. */
interface Flame { ent: pc.Entity; id: number; x: number; y: number; z: number; r: number; age: number; life: number; snd: number }
/** A Rattle Bomb shaking on the floor until it goes off. */
interface Rattle { ent: pc.Entity; x: number; y: number; z: number; t: number; snd: number }
export interface P3 { x: number; y: number; z: number }
/** Most particles of one kind alive at once; further spawns are dropped. */
const POOL_MAX = 220;

// Blobs, globs and shells all draw with the shared toon material; only the per-instance `uTint` differs.
const BLOB_MESH = toMesh(device, make(sphere(8, 6)));
// Unit box stretched along -Z so lookAt() points it at the target.
const TRACER_MESH = toMesh(device, make(box(), undefined, trs(0, 0, -0.5)));
const starMat = makeUnlit({ cull: 'none' });
const tracerMat = makeUnlit({ color: 0xfff1a8, fog: false });
// Launcher grenade: a chunky candy-pink egg with a yellow band.
const SHELL_MESH = toMesh(device, make(sphere(10, 8), 0xff6fae, trs(0, 0, 0, 0, 0, 0, 0.09, 0.09, 0.13)));
const SHELL_BAND = toMesh(device, make(sphere(10, 4), 0xffd43b, trs(0, 0, 0, 0, 0, 0, 0.095, 0.095, 0.05)));
const _q = new pc.Quat(), _spin = new pc.Quat();
const _p: P3 = { x: 0, y: 0, z: 0 };
export const GOO = 0x8cf07a, GOO_DARK = 0x3a8f52;
// Unit-radius puddle: a dark rim around a bright pool with a few highlight spots, one mesh.
const PUDDLE_MESH = toMesh(device, merge([
  make(ring(0, 1, 28), GOO_DARK),
  make(ring(0, 0.86, 28), GOO, trs(0, 0.004, 0)),
  make(ring(0, 0.16, 12), 0xe6ffd0, trs(-0.35, 0.008, -0.2)),
  make(ring(0, 0.09, 10), 0xe6ffd0, trs(0.3, 0.008, 0.32)),
  make(ring(0, 0.12, 10), 0xc8ffb0, trs(0.15, 0.008, -0.45)),
]));
const puddleMat = makeUnlit({ alpha: 0.82, blend: 'normal' });
// Scorch mark under a fire: a dark disc with a glowing rim.
const SCORCH_MESH = toMesh(device, merge([
  make(ring(0, 1, 28), 0xff922b),
  make(ring(0, 0.9, 28), 0x3a1f1a, trs(0, 0.004, 0)),
  make(ring(0, 0.45, 20), 0x1a1226, trs(0.1, 0.008, -0.05)),
]));
const FLAME_COLORS = [0xff5a1f, 0xff922b, 0xffd43b, 0xfff1a8];
const ROPE_COLORS = [0xff8fab, 0xfff5f5];
const ropeMats = ROPE_COLORS.map((color) => makeUnlit({ color, fog: false }));
// Throw preview: pale dashes and a ring where it lands.
const arcMat = makeUnlit({ color: 0xfff1a8, fog: false });
const ARC_RING = toMesh(device, make(ring(0.78, 1, 28), 0xffd43b));

export class FX {
  private stars: Pool = { items: [], free: [], mesh: STAR_MESH, mat: starMat, star: true };
  private blobs: Pool = { items: [], free: [], mesh: BLOB_MESH, mat: toonMat, star: false };
  private tracers: Tracer[] = [];
  private globs: Glob[] = [];
  private puddles: Puddle[] = [];
  // Parked (disabled) goo entities, reused instead of being destroyed and rebuilt.
  private spareGlobs: pc.Entity[] = [];
  private sparePuddles: pc.Entity[] = [];
  private shells: pc.Entity[] = [];
  private flames: Flame[] = [];
  private spareScorch: pc.Entity[] = [];
  private rattles: Rattle[] = [];
  /** Snatcher scarves drawn this frame (see `rope`); `ropeN` of them are in use. */
  private ropes: pc.Entity[] = [];
  private ropeN = 0;
  /** Throw preview drawn this frame (see `aimArc`): dash entities in use, and the landing ring. */
  private dashes: pc.Entity[] = [];
  private dashN = 0;
  private arcRing: pc.Entity | null = null;
  private arcOn = false;
  /** A burning patch wants its next crackle: returns seconds until the one after. */
  onCrackle: ((x: number, y: number, z: number) => number) | null = null;
  /** A Rattle Bomb shakes (several times a second until it blows). */
  onRattle: ((x: number, y: number, z: number) => void) | null = null;
  /** Called when a glob lands (for the splat sound). */
  onSplat: ((x: number, y: number, z: number) => void) | null = null;
  /**
   * Floor height at or below height y at (x, z) (set by main.ts), so particles bounce on the storey they
   * were spawned over. Unset: the ground (y = 0).
   */
  groundAt: ((x: number, y: number, z: number) => number) | null = null;

  /** Drooler goo glob: flies the same arc the server simulates, from floor height y0 to y1. */
  glob(x0: number, z0: number, x1: number, z1: number, flight: number, y0 = 0, y1 = 0): void {
    let ent = this.spareGlobs.pop();
    if (ent) ent.enabled = true;
    else {
      ent = meshEntity(BLOB_MESH, [toonMat, outlineMat]);
      ent.render!.meshInstances[0].setParameter('uTint', tintOf(GOO)); // toon pass only; the ink hull keeps its colour
      app.root.addChild(ent);
    }
    ent.setLocalScale(0.32, 0.32, 0.32);
    this.globs.push({ ent, x0, z0, x1, z1, y0, y1, t: 0, flight });
  }

  /** A goo puddle on the floor at height y. */
  puddle(id: number, x: number, z: number, r: number, life: number, y = 0): void {
    // Same cap as the server, which drops its oldest puddle silently.
    while (this.puddles.length >= DROOLER.maxPuddles) this.parkPuddle(this.puddles.shift()!);
    let ent = this.sparePuddles.pop();
    if (ent) ent.enabled = true;
    else { ent = meshEntity(PUDDLE_MESH, puddleMat); app.root.addChild(ent); }
    ent.setPosition(x, y + 0.035 + (id % 7) * 0.002, z); // tiny offset so overlapping puddles don't z-fight
    ent.setLocalScale(0.01, 1, 0.01);
    this.puddles.push({ ent, id, x, y, z, r, age: 0, life, bub: 0 });
  }
  private parkGlob(g: Glob): void { g.ent.enabled = false; this.spareGlobs.push(g.ent); }
  private parkPuddle(p: Puddle): void { p.ent.enabled = false; this.sparePuddles.push(p.ent); }

  /** Remove every glob, puddle, fire and rattle (chapter reset). */
  clearGoo(): void {
    for (const g of this.globs) this.parkGlob(g);
    for (const p of this.puddles) this.parkPuddle(p);
    this.globs.length = 0; this.puddles.length = 0;
    for (const f of this.flames) this.parkFlame(f);
    this.flames.length = 0;
    for (const r of this.rattles) this.dropShell(r.ent);
    this.rattles.length = 0;
  }

  /** A firebomb burst: a flash of flame, then a patch that burns for `life` seconds on the floor at height y. */
  fire(id: number, x: number, z: number, r: number, life: number, y = 0): void {
    while (this.flames.length >= FIRE.max) this.parkFlame(this.flames.shift()!);
    let ent = this.spareScorch.pop();
    if (ent) ent.enabled = true;
    else { ent = meshEntity(SCORCH_MESH, puddleMat); app.root.addChild(ent); }
    ent.setPosition(x, y + 0.03 + (id % 7) * 0.002, z);
    ent.setLocalScale(0.01, 1, 0.01);
    this.flames.push({ ent, id, x, y, z, r, age: 0, life, snd: 0 });
    _p.x = x; _p.y = y + 0.3; _p.z = z;
    this.burst(_p, 0xff922b, 18, 7, 0.26);
    this.burst(_p, 0xffd43b, 8, 5, 0.3, true, 0.4, 3);
  }
  private parkFlame(f: Flame): void { f.ent.enabled = false; this.spareScorch.push(f.ent); }
  /** True if (x, z) on the floor at height y is inside a burning patch. */
  inFire(x: number, z: number, y = 0): boolean {
    for (const f of this.flames) if (f.age > 0.2 && Math.abs(y - f.y) < 1.5 && Math.hypot(x - f.x, z - f.z) < f.r) return true;
    return false;
  }

  /** A Rattle Bomb at (x, z) on the floor at height y, shaking for `secs` seconds (the boom comes from the server's 'blast'). */
  lure(x: number, z: number, secs: number, y = 0): void {
    const ent = this.shell();
    this.rattles.push({ ent, x, y, z, t: secs, snd: 0 });
  }

  /** Draw a Snatcher's scarf from `a` to `b` for this frame only (call every frame while it holds someone). */
  rope(a: P3, b: P3): void {
    const segs = 6;
    for (let i = 0; i < segs; i++) {
      let e = this.ropes[this.ropeN];
      if (!e) { e = meshEntity(TRACER_MESH, ropeMats[this.ropeN % 2]); app.root.addChild(e); this.ropes.push(e); }
      this.ropeN++;
      // Striped segments with a little sag in the middle.
      const k0 = i / segs, k1 = (i + 1) / segs, sag = (k: number) => -Math.sin(k * Math.PI) * 0.25;
      const x0 = a.x + (b.x - a.x) * k0, y0 = a.y + (b.y - a.y) * k0 + sag(k0), z0 = a.z + (b.z - a.z) * k0;
      const x1 = a.x + (b.x - a.x) * k1, y1 = a.y + (b.y - a.y) * k1 + sag(k1), z1 = a.z + (b.z - a.z) * k1;
      const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
      e.enabled = len > 0.02;
      if (!e.enabled) continue;
      e.setPosition(x0, y0, z0);
      e.lookAt(x1, y1, z1);
      e.setLocalScale(0.07, 0.07, len);
    }
  }

  /** Draw a throw's path for this frame only: `pts` is x, y, z triples along it; the last one is where it lands. */
  aimArc(pts: number[]): void {
    const n = pts.length / 3;
    if (n < 2) return;
    // Every other step is a dash.
    for (let i = 0; i + 1 < n; i += 2) {
      let e = this.dashes[this.dashN];
      if (!e) { e = meshEntity(TRACER_MESH, arcMat); app.root.addChild(e); this.dashes.push(e); }
      this.dashN++;
      const a = i * 3, b = a + 3, len = Math.hypot(pts[b] - pts[a], pts[b + 1] - pts[a + 1], pts[b + 2] - pts[a + 2]);
      e.enabled = len > 0.02;
      if (!e.enabled) continue;
      e.setPosition(pts[a], pts[a + 1], pts[a + 2]);
      e.lookAt(pts[b], pts[b + 1], pts[b + 2]);
      e.setLocalScale(0.035, 0.035, len);
    }
    if (!this.arcRing) { this.arcRing = meshEntity(ARC_RING, puddleMat); app.root.addChild(this.arcRing); }
    const l = (n - 1) * 3;
    this.arcRing.enabled = true; this.arcOn = true;
    this.arcRing.setPosition(pts[l], Math.max(0.05, pts[l + 1] - 0.02), pts[l + 2]);
    this.arcRing.setLocalScale(0.55, 1, 0.55);
  }

  private updateFire(dt: number): void {
    for (let i = this.flames.length - 1; i >= 0; i--) {
      const f = this.flames[i];
      f.age += dt;
      if (f.age >= f.life) { this.parkFlame(f); this.flames.splice(i, 1); continue; }
      const k = Math.min(1, f.age / 0.3) * Math.min(1, (f.life - f.age) / 1.2), s = f.r * k;
      f.ent.setLocalScale(Math.max(0.01, s), 1, Math.max(0.01, s));
      // Flame tongues: blobs that rise, swell and pop, thinning out as the fire dies.
      for (let n = Math.random() < dt * 34 * k ? (Math.random() < 0.4 ? 2 : 1) : 0; n > 0; n--) {
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * s * 0.92;
        const c = FLAME_COLORS[(Math.random() * FLAME_COLORS.length) | 0];
        this.spawn(this.blobs, c, f.x + Math.cos(a) * d, f.y + 0.1, f.z + Math.sin(a) * d, (Math.random() - 0.5) * 0.5, 1.6 + Math.random() * 1.6, (Math.random() - 0.5) * 0.5, 0.2 + Math.random() * 0.18, 0.45 + Math.random() * 0.3, -1.5, 0.9);
      }
      if (Math.random() < dt * 3 * k) this.spawn(this.blobs, 0x4a4458, f.x + (Math.random() - 0.5) * s, f.y + 1.2, f.z + (Math.random() - 0.5) * s, 0, 1.2, 0, 0.3, 0.9, -0.3, 1.5);
      if ((f.snd -= dt) <= 0) f.snd = this.onCrackle?.(f.x, f.y, f.z) ?? 1;
    }
    for (let i = this.rattles.length - 1; i >= 0; i--) {
      const r = this.rattles[i];
      r.t -= dt;
      if (r.t <= 0) { this.dropShell(r.ent); this.rattles.splice(i, 1); continue; }
      // Hops and spins faster as the fuse runs down.
      const rate = 9 + (1 - Math.min(1, r.t / 5)) * 14;
      r.ent.setPosition(r.x, r.y + 0.14 + Math.abs(Math.sin(r.t * rate)) * 0.22, r.z);
      r.ent.setLocalEulerAngles(Math.sin(r.t * rate * 1.3) * 50, r.t * 400, 0);
      if ((r.snd -= dt) <= 0) {
        r.snd = 0.2;
        this.onRattle?.(r.x, r.y, r.z);
        this.spawn(this.stars, Math.random() < 0.5 ? 0xffd43b : 0x74c0fc, r.x, r.y + 0.5, r.z, (Math.random() - 0.5) * 3, 2.5, (Math.random() - 0.5) * 3, 0.16, 0.35, 4);
      }
    }
    // Scarves not redrawn this frame disappear.
    for (let i = this.ropeN; i < this.ropes.length; i++) this.ropes[i].enabled = false;
    this.ropeN = 0;
    for (let i = this.dashN; i < this.dashes.length; i++) this.dashes[i].enabled = false;
    this.dashN = 0;
    if (this.arcRing && !this.arcOn) this.arcRing.enabled = false;
    this.arcOn = false;
  }

  private updateGoo(dt: number): void {
    for (let i = this.globs.length - 1; i >= 0; i--) {
      const g = this.globs[i];
      g.t += dt;
      const s = Math.min(1, g.t / g.flight), h = 1.2 + g.flight * 1.6;
      const x = g.x0 + (g.x1 - g.x0) * s, z = g.z0 + (g.z1 - g.z0) * s, y = g.y0 + 1.3 + (g.y1 + 0.1 - g.y0 - 1.3) * s + 4 * h * s * (1 - s);
      g.ent.setPosition(x, y, z);
      const wob = 0.32 + Math.sin(g.t * 25) * 0.04;
      g.ent.setLocalScale(wob, 0.64 - wob, wob);
      if (Math.random() < dt * 30) this.spawn(this.blobs, GOO, x, y, z, 0, 0, 0, 0.09, 0.35, 2);
      if (s >= 1) {
        this.parkGlob(g); this.globs.splice(i, 1);
        _p.x = x; _p.y = g.y1 + 0.2; _p.z = z;
        this.burst(_p, GOO, 14, 5, 0.13);
        this.onSplat?.(x, g.y1, z);
      }
    }
    for (let i = this.puddles.length - 1; i >= 0; i--) {
      const p = this.puddles[i];
      p.age += dt;
      if (p.age >= p.life) { this.parkPuddle(p); this.puddles.splice(i, 1); continue; }
      // Spread out quickly, slosh a little, shrink away at the end.
      const k = Math.min(1, p.age / 0.4) * Math.min(1, (p.life - p.age) / 0.8);
      const s = p.r * k * (1 + Math.sin(p.age * 3 + p.id) * 0.03);
      p.ent.setLocalScale(Math.max(0.01, s), 1, Math.max(0.01, s * (1 + Math.sin(p.age * 2.3) * 0.03)));
      p.bub -= dt;
      if (p.bub <= 0) {
        p.bub = 0.12 + Math.random() * 0.2;
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * s * 0.85;
        this.spawn(this.blobs, Math.random() < 0.5 ? GOO : 0xd8ffc0, p.x + Math.cos(a) * d, p.y + 0.08, p.z + Math.sin(a) * d, 0, 0.9, 0, 0.1 + Math.random() * 0.08, 0.5, -0.4, 1.2);
      }
    }
  }

  /** True if (x, z) on the floor at height y is inside a live puddle (client-side hint for HUD warnings). */
  inGoo(x: number, z: number, y = 0): boolean {
    for (const p of this.puddles) if (p.age > 0.3 && Math.abs(y - p.y) < 1.5 && Math.hypot(x - p.x, z - p.z) < p.r) return true;
    return false;
  }

  private spawn(pool: Pool, color: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, grav: number, grow = 0): void {
    let p: Particle;
    if (pool.free.length) p = pool.items[pool.free.pop()!];
    else {
      if (pool.items.length > POOL_MAX) return;
      const ent = meshEntity(pool.mesh, pool.mat);
      app.root.addChild(ent);
      p = { ent, mi: ent.render!.meshInstances[0], vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1, grav: 0, spin: 0, grow: 0, x: 0, y: 0, z: 0, fl: 0 };
      pool.items.push(p);
    }
    p.mi.setParameter('uTint', tintOf(color));
    p.ent.enabled = true;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.fl = grav > 0 && this.groundAt ? this.groundAt(x, y, z) : 0;
    p.life = life; p.max = life; p.size = size; p.grav = grav; p.grow = grow;
    p.spin = (Math.random() - 0.5) * 12;
    // Nothing would ever retire a particle born dead: hand it straight back.
    if (!(life > 0)) { p.life = 0; p.ent.enabled = false; pool.free.push(pool.items.indexOf(p)); }
  }

  /** Radial burst. `star` = flat comic stars, otherwise chunky blobs. */
  burst(pos: P3, color: number, n: number, speed: number, size: number, star = false, life = 0.45, grav = 9): void {
    const pool = star ? this.stars : this.blobs;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, s = Math.sqrt(1 - u * u), v = speed * (0.4 + Math.random() * 0.6);
      this.spawn(pool, color, pos.x, pos.y, pos.z, Math.cos(a) * s * v, Math.abs(u) * v + 1, Math.sin(a) * s * v, size * (0.6 + Math.random() * 0.7), life * (0.7 + Math.random() * 0.6), grav);
    }
  }

  /** Cartoon dust cloud: blobs swell up and then pop away. */
  poof(pos: P3, color: number, n = 7, size = 0.32, dy = 0): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
      this.spawn(this.blobs, color, pos.x + Math.cos(a) * 0.15, pos.y + dy + Math.random() * 0.5, pos.z + Math.sin(a) * 0.15, Math.cos(a) * 1.8, 0.8 + Math.random() * 1.2, Math.sin(a) * 1.8, size, 0.5 + Math.random() * 0.2, -0.5, 1.4);
    }
  }

  tracer(from: P3, to: P3, width = 0.03): void {
    let t = this.tracers.find((q) => q.life <= 0);
    if (!t) {
      if (this.tracers.length > 40) return;
      t = { ent: meshEntity(TRACER_MESH, tracerMat), life: 0 };
      app.root.addChild(t.ent);
      this.tracers.push(t);
    }
    const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    if (len < 0.05) return;
    t.ent.setPosition(from.x, from.y, from.z);
    t.ent.lookAt(to.x, to.y, to.z);
    t.ent.setLocalScale(width, width, len);
    t.ent.enabled = true;
    t.life = 0.07;
  }

  /** A pooled grenade shell (enabled). Hand it back with `dropShell`. */
  shell(): pc.Entity {
    let e = this.shells.find((q) => !q.enabled);
    if (!e) {
      e = meshEntity(SHELL_MESH, toonMat);
      e.addChild(meshEntity(SHELL_BAND, toonMat));
      app.root.addChild(e);
      this.shells.push(e);
    }
    e.enabled = true;
    return e;
  }
  dropShell(e: pc.Entity): void { e.enabled = false; }

  /** Little cream puffs left behind a grenade in flight. */
  trail(pos: P3): void {
    this.spawn(this.blobs, 0xfff1c9, pos.x, pos.y, pos.z, (Math.random() - 0.5) * 0.6, 0.3 + Math.random() * 0.4, (Math.random() - 0.5) * 0.6, 0.08, 0.32, -0.4, 1.2);
  }

  /** Grenade boom: a white flash star, orange/yellow chunks, comic stars and a cream smoke ring. `power` < 1 = half-armed pop. */
  blast(pos: P3, power = 1): void {
    const k = power < 1 ? 0.5 : 1;
    this.spawn(this.stars, 0xffffff, pos.x, pos.y + 0.3, pos.z, 0, 0, 0, 2.2 * k, 0.13, 0);
    this.spawn(this.stars, 0xffd43b, pos.x, pos.y + 0.3, pos.z, 0, 0, 0, 3.0 * k, 0.2, 0);
    this.burst(pos, 0xff922b, Math.round(22 * k), 9 * k, 0.24);
    this.burst(pos, 0xffd43b, Math.round(12 * k), 7 * k, 0.3, true, 0.5, 4);
    this.poof(pos, 0xfff1c9, Math.round(12 * k), 0.6 * k);
    this.poof(pos, 0x8f87a8, Math.round(7 * k), 0.45 * k, 0.6);
  }

  private step(pool: Pool, dt: number, camRot: pc.Quat): void {
    const items = pool.items;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.ent.enabled = false; pool.free.push(i); continue; }
      p.vy -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < p.fl + 0.05 && p.grav > 0) { p.y = p.fl + 0.05; p.vy *= -0.35; p.vx *= 0.6; p.vz *= 0.6; }
      p.ent.setPosition(p.x, p.y, p.z);
      const k = p.life / p.max;
      // Swell first (for poofs), then shrink to nothing.
      const s = Math.max(0.001, p.size * (p.grow ? (1 + p.grow * (1 - k)) * Math.min(1, k * 3.2) : Math.min(1, k * 2.2)));
      p.ent.setLocalScale(s, s, s);
      if (pool.star) {
        _spin.setFromAxisAngle(pc.Vec3.BACK, p.spin * (p.max - p.life) * 57.3);
        p.ent.setRotation(_q.copy(camRot).mul(_spin));
      }
    }
  }

  /** `camRot` is the camera's world rotation, used to billboard the stars. */
  update(dt: number, camRot: pc.Quat): void {
    this.updateGoo(dt);
    this.updateFire(dt);
    this.step(this.stars, dt, camRot);
    this.step(this.blobs, dt, camRot);
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) t.ent.enabled = false;
    }
  }
}
