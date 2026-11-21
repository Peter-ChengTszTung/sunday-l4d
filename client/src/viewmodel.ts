// First-person weapon rig. Lives in its own layer and is drawn by a second
// camera that clears depth, so the gun never clips into walls.
import * as pc from 'playcanvas';
import { box, cylinder, sphere, star, make, merge, inflateBox, insideOut, toMesh, trs } from './geo';
import { app, device, VM, Batch, inkBox, meshEntity, makeUnlit, toonVM, toonInkMat, setRot, setTint } from './gfx';
import type { WeaponDef } from '../../shared/constants';

type GunId = WeaponDef['id'];
export interface Gun { ent: pc.Entity; muzzle: [number, number, number]; pump: pc.Entity | null }

const cube = box();
const cyl = cylinder(14);
/** Shotgun pump: a separate part so the first-person rig can rack it. */
const PUMP = { w: 0.1, h: 0.075, d: 0.2, color: 0x8a5a3c, t: 0.012, x: 0, y: 0.01, z: -0.36 };
/** Chunky toy-like guns. Barrel points down -Z, origin at the grip. Returns the parts as an unbuilt batch. */
function gunParts(id: GunId): { b: Batch; muzzle: [number, number, number]; pump: boolean } {
  const b = new Batch();
  const part = (w: number, h: number, d: number, color: number, x: number, y: number, z: number, rx = 0) => b.add(cube, color, trs(x, y, z, rx, 0, 0, w, h, d), 'box', 0.012);
  /** Round part: radius r, length len, along Z (barrels, scopes) or X (drums). */
  const tube = (r: number, len: number, color: number, x: number, y: number, z: number, axis: 'z' | 'x' = 'z') =>
    b.add(cyl, color, trs(x, y, z, axis === 'z' ? Math.PI / 2 : 0, 0, axis === 'x' ? Math.PI / 2 : 0, r, len, r), 'smooth', 0.012);
  let muzzle: [number, number, number] = [0, 0, 0];
  let pump = false;
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
      pump = true;
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
    case 'autoshotgun': // Rumble Drum: stubby coral auto shotgun with a big yellow drum.
      part(0.1, 0.13, 0.48, 0xff6b6b, 0, 0.07, -0.15);
      tube(0.036, 0.4, 0x54506e, 0, 0.105, -0.52);
      part(0.085, 0.07, 0.07, 0x54506e, 0, 0.105, -0.73);
      tube(0.11, 0.1, 0xffe066, 0, -0.02, -0.33, 'x');
      tube(0.04, 0.12, 0x54506e, 0, -0.02, -0.33, 'x');
      part(0.06, 0.15, 0.08, 0x54506e, 0, -0.05, 0.04, 0.25);
      part(0.085, 0.12, 0.2, 0xc94f4f, 0, 0.045, 0.19);
      part(0.04, 0.04, 0.08, 0xffe066, 0, 0.155, -0.1);
      muzzle = [0, 0.105, -0.77];
      break;
    case 'sniper': // Kebabber: long mint bolt-action with a fat scope and a skewer-tip muzzle.
      part(0.075, 0.1, 0.5, 0x63e6be, 0, 0.06, -0.12);
      tube(0.022, 0.56, 0x54506e, 0, 0.075, -0.63);
      part(0.05, 0.05, 0.07, 0xffe066, 0, 0.075, -0.93);
      tube(0.036, 0.26, 0x54506e, 0, 0.165, -0.24);
      tube(0.044, 0.035, 0xff8fab, 0, 0.165, -0.38);
      tube(0.04, 0.03, 0xff8fab, 0, 0.165, -0.1);
      part(0.03, 0.06, 0.03, 0x54506e, 0, 0.12, -0.31);
      part(0.03, 0.06, 0.03, 0x54506e, 0, 0.12, -0.16);
      part(0.09, 0.025, 0.025, 0xffe066, 0.065, 0.085, 0.0);
      part(0.06, 0.15, 0.08, 0x54506e, 0, -0.05, 0.04, 0.25);
      part(0.07, 0.13, 0.28, 0x8a5a3c, 0, 0.035, 0.24);
      muzzle = [0, 0.075, -0.97];
      break;
    case 'launcher': // Bloop Tube: fat bubblegum tube with yellow bands, a pop-gun on steroids.
      tube(0.08, 0.5, 0xda77f2, 0, 0.1, -0.24);
      tube(0.092, 0.055, 0xffe066, 0, 0.1, -0.47);
      tube(0.088, 0.045, 0xffe066, 0, 0.1, -0.03);
      tube(0.058, 0.012, 0x2b2540, 0, 0.1, -0.5);
      part(0.06, 0.15, 0.08, 0x54506e, 0, -0.05, 0.04, 0.25);
      part(0.05, 0.13, 0.06, 0x54506e, 0, -0.01, -0.27, -0.2);
      part(0.03, 0.07, 0.03, 0xffe066, 0, 0.215, -0.32);
      part(0.07, 0.08, 0.08, 0xae3ec9, 0, 0.06, 0.08);
      muzzle = [0, 0.1, -0.54];
      break;
    case 'magnum': // Thunder Pea: gold revolver, silver cylinder, red lightning stripe.
      part(0.07, 0.08, 0.3, 0xffd43b, 0, 0.08, -0.17);
      part(0.072, 0.022, 0.12, 0xff6b6b, 0, 0.08, -0.2);
      tube(0.066, 0.11, 0xc3bdd8, 0, 0.05, -0.02);
      part(0.06, 0.1, 0.14, 0xf0b429, 0, 0.04, 0.03);
      part(0.065, 0.17, 0.08, 0x8a5a3c, 0, -0.07, 0.08, 0.3);
      part(0.022, 0.045, 0.035, 0x54506e, 0, 0.135, 0.07);
      part(0.022, 0.04, 0.022, 0xff6b6b, 0, 0.135, -0.3);
      muzzle = [0, 0.08, -0.34];
      break;
  }
  return { b, muzzle, pump };
}

/** First-person gun for the viewmodel layer (separate toon and ink draws; the pump is its own entity). */
export function buildGun(id: GunId): Gun {
  const { b, muzzle, pump: hasPump } = gunParts(id);
  const ent = b.build(VM, true);
  let pump: pc.Entity | null = null;
  if (hasPump) {
    pump = inkBox(PUMP.w, PUMP.h, PUMP.d, PUMP.color, PUMP.t, VM, true);
    pump.setLocalPosition(PUMP.x, PUMP.y, PUMP.z);
    ent.addChild(pump);
  }
  return { ent, muzzle, pump };
}

const worldGunMeshes = new Map<GunId, pc.Mesh>();
/** Gun geometry for the world: toon parts plus their ink hull (inside-out, colour alpha 0) in one mesh for `toonInkMat`. */
function worldGunMesh(id: GunId): pc.Mesh {
  let m = worldGunMeshes.get(id);
  if (!m) {
    const { b, pump } = gunParts(id);
    const { solids, hulls } = b.take();
    if (pump) {
      const g = make(cube, PUMP.color, new pc.Mat4().setScale(PUMP.w, PUMP.h, PUMP.d)), at = trs(PUMP.x, PUMP.y, PUMP.z);
      solids.push(make(g, undefined, at));
      hulls.push(make(inflateBox(g, PUMP.t, PUMP.t, PUMP.t), undefined, at));
    }
    const solid = merge(solids), hull = insideOut(merge(hulls));
    // Hull first: the ink pass used to draw before the toon pass, and the order settles depth ties.
    const nh = hull.pos.length / 3, alpha = new Uint8Array(nh + solid.pos.length / 3).fill(255, nh);
    m = toMesh(device, merge([hull, solid]), true, alpha);
    worldGunMeshes.set(id, m);
  }
  return m;
}
/**
 * A gun for the world layer (teammates' hands, weapon pickups): one draw. The mesh is built once per
 * weapon and shared for the life of the app, so the entity can be created and destroyed freely.
 */
export function worldGun(id: GunId): pc.Entity { return meshEntity(worldGunMesh(id), toonInkMat); }

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
      const g = buildGun(id);
      g.ent.enabled = false;
      this.rig.addChild(g.ent);
      this.guns.push(g);
    }
    // Hands use the shared first-person toon material, tinted per instance.
    const hand = meshEntity(ballMesh, toonVM, VM);
    setTint(hand, 0xffdcc2);
    hand.setLocalPosition(0, -0.04, 0.03); hand.setLocalScale(0.06, 0.06, 0.06);
    this.rig.addChild(hand);
    this.shoveHand = meshEntity(ballMesh, toonVM, VM);
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
