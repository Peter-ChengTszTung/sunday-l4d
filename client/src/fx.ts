// Pooled comic-book effects: tracers, star bursts, goo blobs and poof clouds.
// Particles shrink instead of fading so they stay opaque and cel-flat.
import * as THREE from 'three';
import { toon } from './toon';
import { STAR_GEO } from './viewmodel';

interface Particle {
  mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number; max: number; size: number;
  grav: number; spin: number; star: boolean; grow: number;
}
interface Tracer { mesh: THREE.Mesh; life: number }

const BLOB_GEO = new THREE.IcosahedronGeometry(1, 1);
const TRACER_GEO = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
const basicCache = new Map<number, THREE.MeshBasicMaterial>();
const basic = (c: number) => {
  let m = basicCache.get(c);
  if (!m) { m = new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }); basicCache.set(c, m); }
  return m;
};

export class FX {
  private parts: Particle[] = [];
  private tracers: Tracer[] = [];
  private tracerMat = new THREE.MeshBasicMaterial({ color: 0xfff1a8, fog: false });

  constructor(private scene: THREE.Scene) {}

  private spawn(star: boolean, color: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, grav: number, grow = 0): void {
    let p = this.parts.find((q) => q.life <= 0);
    if (!p) {
      if (this.parts.length > 420) return;
      p = { mesh: new THREE.Mesh(BLOB_GEO), vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1, grav: 0, spin: 0, star: false, grow: 0 };
      this.scene.add(p.mesh);
      this.parts.push(p);
    }
    p.mesh.geometry = star ? STAR_GEO : BLOB_GEO;
    p.mesh.material = star ? basic(color) : toon(color);
    p.mesh.position.set(x, y, z);
    p.mesh.visible = true;
    Object.assign(p, { vx, vy, vz, life, max: life, size, grav, star, grow, spin: (Math.random() - 0.5) * 12 });
  }

  /** Radial burst. `star` = flat comic stars, otherwise chunky blobs. */
  burst(pos: THREE.Vector3Like, color: number, n: number, speed: number, size: number, star = false, life = 0.45, grav = 9): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, s = Math.sqrt(1 - u * u), v = speed * (0.4 + Math.random() * 0.6);
      this.spawn(star, color, pos.x, pos.y, pos.z, Math.cos(a) * s * v, Math.abs(u) * v + 1, Math.sin(a) * s * v, size * (0.6 + Math.random() * 0.7), life * (0.7 + Math.random() * 0.6), grav);
    }
  }

  /** Cartoon dust cloud: blobs swell up and then pop away. */
  poof(pos: THREE.Vector3Like, color: number, n = 7, size = 0.32): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
      this.spawn(false, color, pos.x + Math.cos(a) * 0.15, pos.y + Math.random() * 0.5, pos.z + Math.sin(a) * 0.15, Math.cos(a) * 1.8, 0.8 + Math.random() * 1.2, Math.sin(a) * 1.8, size, 0.5 + Math.random() * 0.2, -0.5, 1.4);
    }
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, width = 0.03): void {
    let t = this.tracers.find((q) => q.life <= 0);
    if (!t) {
      if (this.tracers.length > 40) return;
      t = { mesh: new THREE.Mesh(TRACER_GEO, this.tracerMat), life: 0 };
      this.scene.add(t.mesh);
      this.tracers.push(t);
    }
    t.mesh.position.copy(from);
    t.mesh.lookAt(to);
    t.mesh.scale.set(width, width, from.distanceTo(to));
    t.mesh.visible = true;
    t.life = 0.07;
  }

  update(dt: number, camera: THREE.Camera): void {
    for (const p of this.parts) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      p.vy -= p.grav * dt;
      const m = p.mesh;
      m.position.x += p.vx * dt; m.position.y += p.vy * dt; m.position.z += p.vz * dt;
      if (m.position.y < 0.05 && p.grav > 0) { m.position.y = 0.05; p.vy *= -0.35; p.vx *= 0.6; p.vz *= 0.6; }
      const k = p.life / p.max;
      // Swell first (for poofs), then shrink to nothing.
      const s = p.size * (p.grow ? (1 + p.grow * (1 - k)) * Math.min(1, k * 3.2) : Math.min(1, k * 2.2));
      m.scale.setScalar(Math.max(0.001, s));
      if (p.star) { m.quaternion.copy(camera.quaternion); m.rotateZ(p.spin * (p.max - p.life)); }
    }
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) t.mesh.visible = false;
    }
  }
}
