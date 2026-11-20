// Pooled comic-book effects: tracers, star bursts, goo blobs and poof clouds.
// Particles shrink instead of fading so they stay opaque and cel-flat.
import * as pc from 'playcanvas';
import { box, sphere, make, toMesh, trs } from './geo';
import { app, device, meshEntity, makeToon, makeUnlit, setTint } from './gfx';
import { STAR_MESH } from './viewmodel';

interface Particle {
  ent: pc.Entity; vx: number; vy: number; vz: number; life: number; max: number; size: number;
  grav: number; spin: number; grow: number; x: number; y: number; z: number;
}
interface Tracer { ent: pc.Entity; life: number }
export interface P3 { x: number; y: number; z: number }

const BLOB_MESH = toMesh(device, make(sphere(8, 6)));
// Unit box stretched along -Z so lookAt() points it at the target.
const TRACER_MESH = toMesh(device, make(box(), undefined, trs(0, 0, -0.5)));
const blobMat = makeToon();
const starMat = makeUnlit({ cull: 'none' });
const tracerMat = makeUnlit({ color: 0xfff1a8, fog: false });
const _q = new pc.Quat(), _spin = new pc.Quat();

export class FX {
  private stars: Particle[] = [];
  private blobs: Particle[] = [];
  private tracers: Tracer[] = [];

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

  /** `camRot` is the camera's world rotation, used to billboard the stars. */
  update(dt: number, camRot: pc.Quat): void {
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
