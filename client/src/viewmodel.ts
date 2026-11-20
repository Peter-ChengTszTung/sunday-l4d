// First-person weapon rig. Lives in its own layer and is drawn by a second
// camera that clears depth, so the gun never clips into walls.
import * as pc from 'playcanvas';
import { box, sphere, star, make, toMesh, trs } from './geo';
import { app, device, VM, WORLD, Batch, inkBox, meshEntity, makeToon, makeUnlit, setRot, setTint } from './gfx';
import type { WeaponDef } from '../../shared/constants';

type GunId = WeaponDef['id'];
export interface Gun { ent: pc.Entity; muzzle: [number, number, number]; pump: pc.Entity | null }

const cube = box();
/** Chunky toy-like guns. Barrel points down -Z, origin at the grip. */
export function buildGun(id: GunId, vm = false): Gun {
  const layer = vm ? VM : WORLD;
  const b = new Batch();
  const part = (w: number, h: number, d: number, color: number, x: number, y: number, z: number, rx = 0) => b.add(cube, color, trs(x, y, z, rx, 0, 0, w, h, d), 'box', 0.012);
  let muzzle: [number, number, number] = [0, 0, 0];
  let pump: pc.Entity | null = null;
  switch (id) {
    case 'pistol':
      part(0.07, 0.09, 0.3, 0xff8fab, 0, 0.06, -0.1);
      part(0.06, 0.16, 0.08, 0x54506e, 0, -0.04, 0.02, 0.25);
      part(0.04, 0.04, 0.06, 0xffe066, 0, 0.12, -0.2);
      muzzle = [0, 0.06, -0.3];
      break;
    case 'smg':
      part(0.08, 0.11, 0.42, 0x4dd4c6, 0, 0.06, -0.14);
      part(0.06, 0.15, 0.08, 0x54506e, 0, -0.05, 0.03, 0.25);
      part(0.05, 0.22, 0.07, 0xffe066, 0, -0.1, -0.16, -0.12);
      part(0.045, 0.045, 0.16, 0x54506e, 0, 0.065, -0.42);
      part(0.06, 0.08, 0.16, 0x54506e, 0, 0.05, 0.15);
      muzzle = [0, 0.065, -0.52];
      break;
    case 'shotgun':
      part(0.085, 0.1, 0.62, 0xffa94d, 0, 0.07, -0.22);
      part(0.06, 0.06, 0.5, 0x54506e, 0, 0.1, -0.42);
      part(0.07, 0.12, 0.26, 0x8a5a3c, 0, 0.01, 0.17, -0.2);
      pump = inkBox(0.1, 0.075, 0.2, 0x8a5a3c, 0.012, layer, vm);
      pump.setLocalPosition(0, 0.01, -0.36);
      muzzle = [0, 0.1, -0.7];
      break;
    case 'rifle':
      part(0.08, 0.11, 0.56, 0xb197fc, 0, 0.06, -0.18);
      part(0.045, 0.045, 0.3, 0x54506e, 0, 0.065, -0.58);
      part(0.06, 0.15, 0.08, 0x54506e, 0, -0.05, 0.03, 0.25);
      part(0.05, 0.2, 0.09, 0x54506e, 0, -0.09, -0.2, -0.25);
      part(0.07, 0.1, 0.24, 0x7c5cd6, 0, 0.04, 0.2);
      part(0.05, 0.05, 0.16, 0xffe066, 0, 0.15, -0.14);
      muzzle = [0, 0.065, -0.75];
      break;
  }
  const ent = b.build(layer, vm);
  if (pump) ent.addChild(pump);
  return { ent, muzzle, pump };
}

export const STAR_MESH = toMesh(device, make(star(6, 1, 0.42)));
const ballMesh = toMesh(device, make(sphere(12, 10)));

export class ViewModel {
  private root = new pc.Entity('viewmodel');
  private rig = new pc.Entity('rig');
  private guns: Gun[] = [];
  private shoveHand: pc.Entity;
  private flash: pc.Entity;
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
    // Parked far below the level so nothing in the world layer is ever near it.
    this.root.setPosition(0, -500, 0);
    const cam = new pc.Entity('vm-camera');
    cam.addComponent('camera', { fov: 52, nearClip: 0.01, farClip: 10, priority: 1, layers: [VM], clearColorBuffer: false, clearDepthBuffer: true });
    this.root.addChild(cam);
    this.root.addChild(this.rig);
    this.rig.setLocalScale(0.62, 0.62, 0.62);
    for (const id of ids) {
      const g = buildGun(id, true);
      g.ent.enabled = false;
      this.rig.addChild(g.ent);
      this.guns.push(g);
    }
    const skin = makeToon({ fog: false, torch: false });
    const hand = meshEntity(ballMesh, skin, VM);
    setTint(hand, 0xffdcc2);
    hand.setLocalPosition(0, -0.04, 0.03); hand.setLocalScale(0.06, 0.06, 0.06);
    this.rig.addChild(hand);
    this.shoveHand = meshEntity(ballMesh, skin, VM);
    setTint(this.shoveHand, 0xffdcc2);
    this.shoveHand.enabled = false;
    this.root.addChild(this.shoveHand);
    const flashOpts = { fog: false, depthTest: false, cull: 'none' as const };
    this.flash = meshEntity(STAR_MESH, makeUnlit({ color: 0xffd43b, ...flashOpts }), VM);
    const core = meshEntity(STAR_MESH, makeUnlit({ color: 0xffffff, ...flashOpts }), VM);
    core.setLocalScale(0.5, 0.5, 0.5); core.setLocalPosition(0, 0, 0.001);
    this.flash.addChild(core);
    this.flash.enabled = false;
    this.rig.addChild(this.flash);
    app.root.addChild(this.root);
    this.setWeapon(0);
  }

  setWeapon(i: number): void {
    if (i !== this.current) this.swap = 1;
    this.current = i;
    this.guns.forEach((g, j) => { g.ent.enabled = j === i; });
    this.reload = 0;
  }

  fire(): void {
    this.kick = 1;
    this.flashT = 0.055;
    const [x, y, z] = this.guns[this.current].muzzle;
    this.flash.setLocalPosition(x, y, z);
    setRot(this.flash, 0, 0, Math.random() * Math.PI);
    const s = 0.075 + Math.random() * 0.04;
    this.flash.setLocalScale(s, s, s);
  }
  setReload(progress: number): void { this.reload = progress; }
  shove(): void { this.shoveT = 1; }

  update(dt: number, moving: number, lookDX: number, lookDY: number): void {
    this.root.enabled = this.visible;
    if (!this.visible) return;
    this.kick = Math.max(0, this.kick - dt * 9);
    this.swap = Math.max(0, this.swap - dt * 4.5);
    this.shoveT = Math.max(0, this.shoveT - dt * 3.2);
    this.flashT -= dt;
    this.flash.enabled = this.flashT > 0;
    this.bob += dt * (4 + moving * 9);
    this.swayX += (-lookDX * 0.0006 - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (lookDY * 0.0006 - this.swayY) * Math.min(1, dt * 10);
    const r = this.reload > 0 ? Math.sin(Math.min(1, this.reload) * Math.PI) : 0;
    const amp = 0.004 + moving * 0.012;
    this.rig.setLocalPosition(
      0.17 + Math.cos(this.bob * 0.5) * amp + this.swayX,
      -0.15 + Math.abs(Math.sin(this.bob * 0.5)) * amp - this.swap * 0.3 - r * 0.16 + this.swayY - this.shoveT * 0.1,
      -0.4 + this.kick * 0.05,
    );
    setRot(this.rig, this.kick * 0.16 - r * 0.9 - this.swap * 0.8, 0.04 + this.swayX * 2, r * 0.5);
    const pump = this.guns[this.current].pump;
    if (pump) pump.setLocalPosition(0, 0.01, -0.36 + Math.sin(Math.min(1, this.kick * 1.4) * Math.PI) * 0.09);
    // Shove: an open palm sweeps across the screen.
    this.shoveHand.enabled = this.shoveT > 0;
    if (this.shoveT > 0) {
      const k = 1 - this.shoveT;
      this.shoveHand.setLocalPosition(-0.28 + k * 0.42, -0.14 + Math.sin(k * Math.PI) * 0.07, -0.34 - Math.sin(k * Math.PI) * 0.14);
      this.shoveHand.setLocalScale(0.1, 0.13, 0.05);
    }
  }
}
