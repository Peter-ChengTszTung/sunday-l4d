import { DROOLER } from '../../shared/constants';
// Pooled comic-book effects: tracers, star bursts, goo blobs and poof clouds.
// Particles shrink instead of fading so they stay opaque and cel-flat.
import * as pc from 'playcanvas';
import { box, sphere, ring, make, merge, toMesh, trs } from './geo';
import { app, device, meshEntity, makeToon, makeUnlit, setTint, outlineMat, instances, rgb } from './gfx';
import { STAR_MESH } from './viewmodel';

interface Particle {
  ent: pc.Entity; vx: number; vy: number; vz: number; life: number; max: number; size: number;
  grav: number; spin: number; grow: number; x: number; y: number; z: number;
}
interface Tracer { ent: pc.Entity; life: number }
/** Drooler goo in flight: a ballistic arc from (x0, z0) to (x1, z1). */
interface Glob { ent: pc.Entity; x0: number; z0: number; x1: number; z1: number; t: number; flight: number }
interface Puddle { ent: pc.Entity; id: number; x: number; z: number; r: number; age: number; life: number; bub: number }
export interface P3 { x: number; y: number; z: number }

const BLOB_MESH = toMesh(device, make(sphere(8, 6)));
// Unit box stretched along -Z so lookAt() points it at the target.
const TRACER_MESH = toMesh(device, make(box(), undefined, trs(0, 0, -0.5)));
const blobMat = makeToon();
const starMat = makeUnlit({ cull: 'none' });
const tracerMat = makeUnlit({ color: 0xfff1a8, fog: false });
// Launcher grenade: a chunky candy-pink egg with a yellow band.
const SHELL_MESH = toMesh(device, make(sphere(10, 8), 0xff6fae, trs(0, 0, 0, 0, 0, 0, 0.09, 0.09, 0.13)));
const SHELL_BAND = toMesh(device, make(sphere(10, 4), 0xffd43b, trs(0, 0, 0, 0, 0, 0, 0.095, 0.095, 0.05)));
const shellMat = makeToon();
const _q = new pc.Quat(), _spin = new pc.Quat();
export const GOO = 0x8cf07a, GOO_DARK = 0x3a8f52;
const globMat = makeToon();
// Unit-radius puddle: a dark rim around a bright pool with a few highlight spots, one mesh.
const PUDDLE_MESH = toMesh(device, merge([
  make(ring(0, 1, 28), GOO_DARK),
  make(ring(0, 0.86, 28), GOO, trs(0, 0.004, 0)),
  make(ring(0, 0.16, 12), 0xe6ffd0, trs(-0.35, 0.008, -0.2)),
  make(ring(0, 0.09, 10), 0xe6ffd0, trs(0.3, 0.008, 0.32)),
  make(ring(0, 0.12, 10), 0xc8ffb0, trs(0.15, 0.008, -0.45)),
]));
const puddleMat = makeUnlit({ alpha: 0.82, blend: 'normal' });

export class FX {
  private stars: Particle[] = [];
  private blobs: Particle[] = [];
  private tracers: Tracer[] = [];
  private globs: Glob[] = [];
  private puddles: Puddle[] = [];
  /** Called when a glob lands (for the splat sound). */
  onSplat: ((x: number, z: number) => void) | null = null;

  /** Drooler goo glob: flies the same arc the server simulates. */
  glob(x0: number, z0: number, x1: number, z1: number, flight: number): void {
    const ent = meshEntity(BLOB_MESH, [globMat, outlineMat]);
    ent.setLocalScale(0.32, 0.32, 0.32);
    instances(ent)[0].setParameter('uTint', rgb(GOO)); // toon pass only; the ink hull keeps its colour
    app.root.addChild(ent);
    this.globs.push({ ent, x0, z0, x1, z1, t: 0, flight });
  }

  puddle(id: number, x: number, z: number, r: number, life: number): void {
    // Same cap as the server, which drops its oldest puddle silently.
    while (this.puddles.length >= DROOLER.maxPuddles) this.puddles.shift()!.ent.destroy();
    const ent = meshEntity(PUDDLE_MESH, puddleMat);
    ent.setPosition(x, 0.035 + (id % 7) * 0.002, z); // tiny offset so overlapping puddles don't z-fight
    ent.setLocalScale(0.01, 1, 0.01);
    app.root.addChild(ent);
    this.puddles.push({ ent, id, x, z, r, age: 0, life, bub: 0 });
  }

  /** Remove every glob and puddle (chapter reset). */
  clearGoo(): void {
    for (const g of this.globs) g.ent.destroy();
    for (const p of this.puddles) p.ent.destroy();
    this.globs.length = 0; this.puddles.length = 0;
  }

  private updateGoo(dt: number): void {
    for (let i = this.globs.length - 1; i >= 0; i--) {
      const g = this.globs[i];
      g.t += dt;
      const s = Math.min(1, g.t / g.flight), h = 1.2 + g.flight * 1.6;
      const x = g.x0 + (g.x1 - g.x0) * s, z = g.z0 + (g.z1 - g.z0) * s, y = 1.3 + (0.1 - 1.3) * s + 4 * h * s * (1 - s);
      g.ent.setPosition(x, y, z);
      const wob = 0.32 + Math.sin(g.t * 25) * 0.04;
      g.ent.setLocalScale(wob, 0.64 - wob, wob);
      if (Math.random() < dt * 30) this.spawn(false, GOO, x, y, z, 0, 0, 0, 0.09, 0.35, 2);
      if (s >= 1) {
        g.ent.destroy(); this.globs.splice(i, 1);
        this.burst({ x, y: 0.2, z }, GOO, 14, 5, 0.13);
        this.onSplat?.(x, z);
      }
    }
    for (let i = this.puddles.length - 1; i >= 0; i--) {
      const p = this.puddles[i];
      p.age += dt;
      if (p.age >= p.life) { p.ent.destroy(); this.puddles.splice(i, 1); continue; }
      // Spread out quickly, slosh a little, shrink away at the end.
      const k = Math.min(1, p.age / 0.4) * Math.min(1, (p.life - p.age) / 0.8);
      const s = p.r * k * (1 + Math.sin(p.age * 3 + p.id) * 0.03);
      p.ent.setLocalScale(Math.max(0.01, s), 1, Math.max(0.01, s * (1 + Math.sin(p.age * 2.3) * 0.03)));
      p.bub -= dt;
      if (p.bub <= 0) {
        p.bub = 0.12 + Math.random() * 0.2;
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * s * 0.85;
        this.spawn(false, Math.random() < 0.5 ? GOO : 0xd8ffc0, p.x + Math.cos(a) * d, 0.08, p.z + Math.sin(a) * d, 0, 0.9, 0, 0.1 + Math.random() * 0.08, 0.5, -0.4, 1.2);
      }
    }
  }

  /** True if (x, z) is inside a live puddle (client-side hint for HUD warnings). */
  inGoo(x: number, z: number): boolean {
    for (const p of this.puddles) if (p.age > 0.3 && Math.hypot(x - p.x, z - p.z) < p.r) return true;
    return false;
  }
  private shells: pc.Entity[] = [];

  private spawn(isStar: boolean, color: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, grav: number, grow = 0): void {
    const pool = isStar ? this.stars : this.blobs;
    let p = pool.find((q) => q.life <= 0);
    if (!p) {
      if (pool.length > 220) return;
      const ent = meshEntity(isStar ? STAR_MESH : BLOB_MESH, isStar ? starMat : blobMat);
      app.root.addChild(ent);
      p = { ent, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1, grav: 0, spin: 0, grow: 0, x: 0, y: 0, z: 0 };
      pool.push(p);
    }
    setTint(p.ent, color);
    p.ent.enabled = true;
    Object.assign(p, { x, y, z, vx, vy, vz, life, max: life, size, grav, grow, spin: (Math.random() - 0.5) * 12 });
  }

  /** Radial burst. `star` = flat comic stars, otherwise chunky blobs. */
  burst(pos: P3, color: number, n: number, speed: number, size: number, star = false, life = 0.45, grav = 9): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, s = Math.sqrt(1 - u * u), v = speed * (0.4 + Math.random() * 0.6);
      this.spawn(star, color, pos.x, pos.y, pos.z, Math.cos(a) * s * v, Math.abs(u) * v + 1, Math.sin(a) * s * v, size * (0.6 + Math.random() * 0.7), life * (0.7 + Math.random() * 0.6), grav);
    }
  }

  /** Cartoon dust cloud: blobs swell up and then pop away. */
  poof(pos: P3, color: number, n = 7, size = 0.32): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
      this.spawn(false, color, pos.x + Math.cos(a) * 0.15, pos.y + Math.random() * 0.5, pos.z + Math.sin(a) * 0.15, Math.cos(a) * 1.8, 0.8 + Math.random() * 1.2, Math.sin(a) * 1.8, size, 0.5 + Math.random() * 0.2, -0.5, 1.4);
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
      e = meshEntity(SHELL_MESH, shellMat);
      e.addChild(meshEntity(SHELL_BAND, shellMat));
      app.root.addChild(e);
      this.shells.push(e);
    }
    e.enabled = true;
    return e;
  }
  dropShell(e: pc.Entity): void { e.enabled = false; }

  /** Little cream puffs left behind a grenade in flight. */
  trail(pos: P3): void {
    this.spawn(false, 0xfff1c9, pos.x, pos.y, pos.z, (Math.random() - 0.5) * 0.6, 0.3 + Math.random() * 0.4, (Math.random() - 0.5) * 0.6, 0.08, 0.32, -0.4, 1.2);
  }

  /** Grenade boom: a white flash star, orange/yellow chunks, comic stars and a cream smoke ring. `power` < 1 = half-armed pop. */
  blast(pos: P3, power = 1): void {
    const k = power < 1 ? 0.5 : 1;
    this.spawn(true, 0xffffff, pos.x, pos.y + 0.3, pos.z, 0, 0, 0, 2.2 * k, 0.13, 0);
    this.spawn(true, 0xffd43b, pos.x, pos.y + 0.3, pos.z, 0, 0, 0, 3.0 * k, 0.2, 0);
    this.burst(pos, 0xff922b, Math.round(22 * k), 9 * k, 0.24);
    this.burst(pos, 0xffd43b, Math.round(12 * k), 7 * k, 0.3, true, 0.5, 4);
    this.poof(pos, 0xfff1c9, Math.round(12 * k), 0.6 * k);
    this.poof({ x: pos.x, y: pos.y + 0.6, z: pos.z }, 0x8f87a8, Math.round(7 * k), 0.45 * k);
  }

  /** `camRot` is the camera's world rotation, used to billboard the stars. */
  update(dt: number, camRot: pc.Quat): void {
    this.updateGoo(dt);
    for (const pool of [this.stars, this.blobs]) for (const p of pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.ent.enabled = false; continue; }
      p.vy -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.05 && p.grav > 0) { p.y = 0.05; p.vy *= -0.35; p.vx *= 0.6; p.vz *= 0.6; }
      p.ent.setPosition(p.x, p.y, p.z);
      const k = p.life / p.max;
      // Swell first (for poofs), then shrink to nothing.
      const s = Math.max(0.001, p.size * (p.grow ? (1 + p.grow * (1 - k)) * Math.min(1, k * 3.2) : Math.min(1, k * 2.2)));
      p.ent.setLocalScale(s, s, s);
      if (pool === this.stars) {
        _spin.setFromAxisAngle(pc.Vec3.BACK, p.spin * (p.max - p.life) * 57.3);
        p.ent.setRotation(_q.copy(camRot).mul(_spin));
      }
    }
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) t.ent.enabled = false;
    }
  }
}
