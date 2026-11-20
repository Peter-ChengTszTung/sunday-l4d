// First-person weapon rig, rendered in its own scene on top of the world.
import * as THREE from 'three';
import { inkBox, gradientMap } from './toon';
import type { WeaponDef } from '../../shared/constants';

type GunId = WeaponDef['id'];

/** Chunky toy-like guns. Barrel points down -Z, origin at the grip. */
export function buildGun(id: GunId): THREE.Group {
  const g = new THREE.Group();
  const part = (w: number, h: number, d: number, color: number, x: number, y: number, z: number, rx = 0) => {
    const m = inkBox(w, h, d, color, 0.012);
    m.position.set(x, y, z); m.rotation.x = rx; g.add(m);
    return m;
  };
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  switch (id) {
    case 'pistol':
      part(0.07, 0.09, 0.3, 0xff8fab, 0, 0.06, -0.1);
      part(0.06, 0.16, 0.08, 0x54506e, 0, -0.04, 0.02, 0.25);
      part(0.04, 0.04, 0.06, 0xffe066, 0, 0.12, -0.2);
      muzzle.position.set(0, 0.06, -0.3);
      break;
    case 'smg':
      part(0.08, 0.11, 0.42, 0x4dd4c6, 0, 0.06, -0.14);
      part(0.06, 0.15, 0.08, 0x54506e, 0, -0.05, 0.03, 0.25);
      part(0.05, 0.22, 0.07, 0xffe066, 0, -0.1, -0.16, -0.12);
      part(0.045, 0.045, 0.16, 0x54506e, 0, 0.065, -0.42);
      part(0.06, 0.08, 0.16, 0x54506e, 0, 0.05, 0.15);
      muzzle.position.set(0, 0.065, -0.52);
      break;
    case 'shotgun':
      part(0.085, 0.1, 0.62, 0xffa94d, 0, 0.07, -0.22);
      part(0.06, 0.06, 0.5, 0x54506e, 0, 0.1, -0.42);
      part(0.1, 0.075, 0.2, 0x8a5a3c, 0, 0.01, -0.36).name = 'pump';
      part(0.07, 0.12, 0.26, 0x8a5a3c, 0, 0.01, 0.17, -0.2);
      muzzle.position.set(0, 0.1, -0.7);
      break;
    case 'rifle':
      part(0.08, 0.11, 0.56, 0xb197fc, 0, 0.06, -0.18);
      part(0.045, 0.045, 0.3, 0x54506e, 0, 0.065, -0.58);
      part(0.06, 0.15, 0.08, 0x54506e, 0, -0.05, 0.03, 0.25);
      part(0.05, 0.2, 0.09, 0x54506e, 0, -0.09, -0.2, -0.25);
      part(0.07, 0.1, 0.24, 0x7c5cd6, 0, 0.04, 0.2);
      part(0.05, 0.05, 0.16, 0xffe066, 0, 0.15, -0.14);
      muzzle.position.set(0, 0.065, -0.75);
      break;
  }
  g.add(muzzle);
  return g;
}

function starShape(points: number, outer: number, inner: number): THREE.ShapeGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer, a = (i / (points * 2)) * Math.PI * 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ShapeGeometry(s);
}
export const STAR_GEO = starShape(6, 1, 0.42);

export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(52, 1, 0.01, 10);
  private rig = new THREE.Group();
  private guns: THREE.Group[] = [];
  private hand: THREE.Mesh;
  private shoveHand: THREE.Mesh;
  private flash: THREE.Mesh;
  private flashCore: THREE.Mesh;
  private current = 0;
  private kick = 0;
  private swap = 0;
  private reload = 0; // 0..1 progress, 0 = idle
  private shoveT = 0;
  private flashT = 0;
  private bob = 0;
  private swayX = 0;
  private swayY = 0;
  visible = true;

  constructor(ids: GunId[]) {
    this.scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x6a5a8a, 2.4));
    const d = new THREE.DirectionalLight(0xfff1e0, 2.2);
    d.position.set(-1, 2, 1.5);
    this.scene.add(d, this.camera, this.rig);
    for (const id of ids) {
      const g = buildGun(id);
      g.visible = false;
      this.rig.add(g);
      this.guns.push(g);
    }
    const skin = new THREE.MeshToonMaterial({ color: 0xffdcc2, gradientMap });
    this.hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), skin);
    this.hand.position.set(0, -0.04, 0.03);
    this.rig.add(this.hand);
    this.shoveHand = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), skin);
    this.shoveHand.visible = false;
    this.scene.add(this.shoveHand);
    this.flash = new THREE.Mesh(STAR_GEO, new THREE.MeshBasicMaterial({ color: 0xffd43b, side: THREE.DoubleSide, depthTest: false }));
    this.flashCore = new THREE.Mesh(STAR_GEO, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthTest: false }));
    this.flashCore.scale.setScalar(0.5); this.flashCore.position.z = 0.001;
    this.flash.add(this.flashCore);
    this.flash.visible = false;
    this.rig.add(this.flash);
    this.rig.scale.setScalar(0.62);
    this.setWeapon(0);
  }

  setWeapon(i: number): void {
    if (i !== this.current) this.swap = 1;
    this.current = i;
    this.guns.forEach((g, j) => { g.visible = j === i; });
    this.reload = 0;
  }

  fire(): void {
    this.kick = 1;
    this.flashT = 0.055;
    const m = this.guns[this.current].getObjectByName('muzzle')!;
    this.flash.position.copy(m.position);
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar(0.075 + Math.random() * 0.04);
  }
  setReload(progress: number): void { this.reload = progress; }
  shove(): void { this.shoveT = 1; }
  resize(aspect: number): void { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }

  update(dt: number, moving: number, lookDX: number, lookDY: number): void {
    this.scene.visible = this.visible;
    this.kick = Math.max(0, this.kick - dt * 9);
    this.swap = Math.max(0, this.swap - dt * 4.5);
    this.shoveT = Math.max(0, this.shoveT - dt * 3.2);
    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    this.bob += dt * (4 + moving * 9);
    this.swayX += (-lookDX * 0.0006 - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (lookDY * 0.0006 - this.swayY) * Math.min(1, dt * 10);
    const r = this.reload > 0 ? Math.sin(Math.min(1, this.reload) * Math.PI) : 0;
    const amp = 0.004 + moving * 0.012;
    this.rig.position.set(
      0.17 + Math.cos(this.bob * 0.5) * amp + this.swayX,
      -0.15 + Math.abs(Math.sin(this.bob * 0.5)) * amp - this.swap * 0.3 - r * 0.16 + this.swayY - this.shoveT * 0.1,
      -0.4 + this.kick * 0.05,
    );
    this.rig.rotation.set(this.kick * 0.16 - r * 0.9 - this.swap * 0.8, 0.04 + this.swayX * 2, r * 0.5);
    const pump = this.guns[this.current].getObjectByName('pump');
    if (pump) pump.position.z = -0.36 + Math.sin(Math.min(1, this.kick * 1.4) * Math.PI) * 0.09;
    // Shove: an open palm sweeps across the screen.
    this.shoveHand.visible = this.shoveT > 0;
    if (this.shoveT > 0) {
      const k = 1 - this.shoveT;
      this.shoveHand.position.set(-0.28 + k * 0.42, -0.14 + Math.sin(k * Math.PI) * 0.07, -0.34 - Math.sin(k * Math.PI) * 0.14);
      this.shoveHand.scale.set(1.2, 1.5, 0.6);
    }
  }
}
