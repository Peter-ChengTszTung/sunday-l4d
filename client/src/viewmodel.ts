// First-person weapon rig. Lives in its own layer and is drawn by a second
// camera that clears depth, so the gun never clips into walls.
import * as pc from 'playcanvas';
import { box, cylinder, sphere, star, make, merge, inflateBox, insideOut, toMesh, trs } from './geo';
import { app, device, VM, Batch, inkBox, meshEntity, makeUnlit, toonVM, toonInkMat, setRot, setTint } from './gfx';
import { WEAPONS, type WeaponDef } from '../../shared/constants';

type GunId = WeaponDef['id'];
type P3 = [number, number, number];
export interface Gun { ent: pc.Entity; muzzle: P3; pump: pc.Entity | null; /** The minigun's barrel cluster, spun round Z while it fires. */ spin: pc.Entity | null }

const cube = box();
const cyl = cylinder(14);
const orb = sphere(10, 8);
/** Ink outline thickness of a gun part, in gun units. */
const INK = 0.012;
/** Shared trim colours. */
const DARK = 0x54506e, SOOT = 0x2b2540, PAD = 0x3d3955, GOLD = 0xffe066, BRASS = 0xf0b429, STEEL = 0xc3bdd8, WOOD = 0x8a5a3c;
/** Shotgun pump: a separate part so the first-person rig can rack it. */
// Wider than the body's outline (0.085 + 2 x INK): narrower, the body's ink showed as a line along its sides.
const PUMP = { w: 0.112, h: 0.075, d: 0.2, color: 0x8a5a3c, t: 0.012, x: 0, y: 0.01, z: -0.36 };
/** How far past the barrel's front face the muzzle point (flash, tracer origin) sits, in gun units. */
const MUZZLE_GAP = 0.02;
/**
 * Chunky toy-like guns. Barrel points down -Z, origin at the grip. Returns the parts as an unbuilt batch,
 * plus the muzzle point in gun space: taken from the barrel-end part itself (see `tip`), so it can't drift
 * from the geometry.
 *
 * The gun sits at the right of the screen, so the player mostly sees its top and its left (-X) side:
 * one-sided detail goes there.
 */
function gunParts(id: GunId): { b: Batch; muzzle: P3; pump: boolean; spin: { b: Batch; y: number } | null } {
  const main = new Batch();
  /** Where parts go: the gun itself, or (the minigun's barrels) a batch that spins round the Z axis. */
  let b = main;
  let spin: { b: Batch; y: number } | null = null;
  /** Centre and Z length of the part just added. */
  let lx = 0, ly = 0, lz = 0, ld = 0;
  const part = (w: number, h: number, d: number, color: number, x: number, y: number, z: number, rx = 0) => {
    b.add(cube, color, trs(x, y, z, rx, 0, 0, w, h, d), 'box', INK);
    lx = x; ly = y; lz = z; ld = d;
  };
  /**
   * Same-colour boxes [w, h, d, color, x, y, z] that read as one piece (a trigger guard, a finger loop): one
   * outline round them all. Each with its own drew a dark line across the next where they join flush.
   */
  const group = (...parts: [number, number, number, number, number, number, number][]) => b.group(parts, INK);
  /** Round part: radius r, length len, along Z (barrels, scopes), X (drums) or Y (posts). */
  const tube = (r: number, len: number, color: number, x: number, y: number, z: number, axis: 'z' | 'x' | 'y' = 'z') => {
    b.add(cyl, color, trs(x, y, z, axis === 'z' ? Math.PI / 2 : 0, 0, axis === 'x' ? Math.PI / 2 : 0, r, len, r), 'smooth', INK);
    lx = x; ly = y; lz = z; ld = axis === 'z' ? len : 2 * r;
  };
  // Trim: small surface detail with no ink of its own (an outline that size would swallow it). Never the barrel end.
  /** Flat trim: stripes, slots, ports, plates. */
  const deco = (w: number, h: number, d: number, color: number, x: number, y: number, z: number, rx = 0) =>
    b.add(cube, color, trs(x, y, z, rx, 0, 0, w, h, d), 'none');
  /** Round trim: bores, lenses, bolts, studs. */
  const stud = (r: number, len: number, color: number, x: number, y: number, z: number, axis: 'z' | 'x' | 'y' = 'z') =>
    b.add(cyl, color, trs(x, y, z, axis === 'z' ? Math.PI / 2 : 0, 0, axis === 'x' ? Math.PI / 2 : 0, r, len, r), 'none');
  /** Tapered round part along Z: radius `rFront` at the -Z end, `rBack` at the +Z end. */
  const cone = (rFront: number, rBack: number, len: number, color: number, x: number, y: number, z: number) =>
    b.add(cylinder(14, rBack, rFront), color, trs(x, y, z, Math.PI / 2, 0, 0, 1, len, 1), 'smooth', INK);
  /** Ball (or a squashed one: per-axis radii). */
  const ball = (color: number, x: number, y: number, z: number, rx: number, ry = rx, rz = rx) =>
    b.add(orb, color, trs(x, y, z, 0, 0, 0, rx, ry, rz), 'smooth', INK);
  /** Trigger guard and trigger hanging under the body: `z` is the trigger, `y` the underside it hangs from. */
  const trigger = (z: number, y: number, guard = DARK, blade = GOLD) => {
    group([0.024, 0.012, 0.1, guard, 0, y - 0.055, z - 0.01], [0.024, 0.055, 0.012, guard, 0, y - 0.027, z - 0.055]);
    deco(0.014, 0.036, 0.012, blade, 0, y - 0.02, z, 0.3);
  };
  let muzzle: P3 = [0, 0, 0];
  /** Call right after adding the barrel-end part: the muzzle is the centre of its front (-Z) face. */
  const tip = () => { muzzle = [lx, ly, lz - ld / 2 - MUZZLE_GAP]; };
  let pump = false;
  switch (id) {
    case 'pistol':
      part(0.07, 0.09, 0.3, 0xff8fab, 0, 0.06, -0.1); tip();
      part(0.06, 0.16, 0.08, DARK, 0, -0.04, 0.02, 0.25);
      part(0.04, 0.04, 0.06, GOLD, 0, 0.12, -0.2);
      // Slide: grip ridges at the back, a pale stripe, a notched rear sight, the bore.
      for (const z of [-0.02, 0.005, 0.03]) deco(0.076, 0.05, 0.012, 0xe0708f, 0, 0.075, z);
      deco(0.073, 0.012, 0.17, 0xffc2d1, 0, 0.035, -0.15);
      part(0.05, 0.025, 0.02, DARK, 0, 0.115, 0.035);
      stud(0.02, 0.01, SOOT, 0, 0.065, -0.251);
      // Frame: trigger guard, grip panels, magazine base.
      trigger(-0.05, 0.015);
      deco(0.066, 0.09, 0.045, 0x6e698c, 0, -0.045, 0.02, 0.25);
      part(0.066, 0.02, 0.09, GOLD, 0, -0.127, -0.002, 0.25);
      break;
    case 'smg':
      part(0.08, 0.11, 0.42, 0x4dd4c6, 0, 0.06, -0.14);
      part(0.06, 0.15, 0.08, DARK, 0, -0.05, 0.03, 0.25);
      part(0.05, 0.22, 0.07, GOLD, 0, -0.1, -0.16, -0.12);
      part(0.045, 0.045, 0.16, DARK, 0, 0.065, -0.42); tip();
      part(0.06, 0.08, 0.16, DARK, 0, 0.05, 0.15);
      // Top rail with sights, cooling slots, charging knob, muzzle ring.
      part(0.02, 0.04, 0.02, GOLD, 0, 0.15, -0.27);
      group([0.03, 0.02, 0.3, DARK, 0, 0.125, -0.14], [0.045, 0.03, 0.02, DARK, 0, 0.145, 0.0]); // rail and rear sight block
      for (const z of [-0.31, -0.265, -0.22]) deco(0.084, 0.035, 0.022, 0x2f9c92, 0, 0.075, z);
      deco(0.083, 0.012, 0.2, 0xb8f2ea, 0, 0.025, -0.1);
      part(0.03, 0.02, 0.03, GOLD, -0.05, 0.09, -0.1);
      tube(0.032, 0.03, GOLD, 0, 0.065, -0.47);
      stud(0.014, 0.01, SOOT, 0, 0.065, -0.501);
      trigger(-0.04, 0.005);
      part(0.058, 0.022, 0.08, BRASS, 0, -0.212, -0.147, -0.12);
      part(0.066, 0.1, 0.025, PAD, 0, 0.05, 0.24);
      break;
    case 'shotgun':
      part(0.085, 0.1, 0.62, 0xffa94d, 0, 0.07, -0.22);
      part(0.06, 0.06, 0.5, DARK, 0, 0.1, -0.42); tip();
      part(0.07, 0.12, 0.26, WOOD, 0, 0.01, 0.17, -0.2);
      pump = true;
      // Magazine tube under the barrel (the pump rides on it), clamped at the front; bead sight.
      tube(0.02, 0.44, DARK, 0, 0.01, -0.42);
      tube(0.025, 0.02, GOLD, 0, 0.01, -0.645);
      part(0.07, 0.15, 0.025, STEEL, 0, 0.06, -0.59);
      part(0.018, 0.025, 0.018, GOLD, 0, 0.142, -0.64);
      // Receiver: loading port, spare shells on the left, trigger, butt pad.
      deco(0.089, 0.035, 0.1, SOOT, 0, 0.085, -0.02);
      deco(0.088, 0.012, 0.3, 0xffd8a8, 0, 0.04, -0.35);
      for (const z of [-0.1, -0.135, -0.17]) { tube(0.013, 0.05, 0xff6b6b, -0.05, 0.085, z, 'y'); stud(0.0145, 0.014, 0xffd43b, -0.05, 0.056, z, 'y'); }
      trigger(0.0, 0.02);
      part(0.076, 0.13, 0.025, PAD, 0, 0.038, 0.305, -0.2);
      break;
    case 'rifle':
      part(0.08, 0.11, 0.56, 0xb197fc, 0, 0.06, -0.18);
      part(0.045, 0.045, 0.3, DARK, 0, 0.065, -0.58); tip();
      part(0.06, 0.15, 0.08, DARK, 0, -0.05, 0.03, 0.25);
      part(0.05, 0.2, 0.09, DARK, 0, -0.09, -0.2, -0.25);
      part(0.07, 0.1, 0.24, 0x7c5cd6, 0, 0.04, 0.2);
      part(0.05, 0.05, 0.16, GOLD, 0, 0.15, -0.14);
      // Scope: mounts and lenses.
      part(0.03, 0.03, 0.03, DARK, 0, 0.12, -0.19);
      part(0.03, 0.03, 0.03, DARK, 0, 0.12, -0.09);
      deco(0.036, 0.036, 0.006, 0x74c0fc, 0, 0.15, -0.221);
      deco(0.036, 0.036, 0.006, SOOT, 0, 0.15, -0.059);
      // Vented handguard, front sight, muzzle brake.
      part(0.065, 0.075, 0.16, 0x7c5cd6, 0, 0.06, -0.54);
      for (const z of [-0.5, -0.54, -0.58]) deco(0.069, 0.022, 0.022, SOOT, 0, 0.065, z);
      part(0.018, 0.05, 0.02, DARK, 0, 0.105, -0.65);
      part(0.058, 0.058, 0.045, GOLD, 0, 0.065, -0.7);
      stud(0.014, 0.01, SOOT, 0, 0.065, -0.731);
      // Body: pale stripe, bolt and charging handle, trigger, magazine base, cheek rest, butt pad.
      deco(0.083, 0.012, 0.4, 0xd0bfff, 0, 0.03, -0.2);
      deco(0.084, 0.03, 0.09, SOOT, 0, 0.085, -0.02);
      part(0.03, 0.02, 0.03, GOLD, -0.052, 0.085, -0.05);
      trigger(-0.05, 0.005);
      part(0.056, 0.02, 0.1, GOLD, 0, -0.19, -0.175, -0.25);
      part(0.05, 0.02, 0.14, DARK, 0, 0.1, 0.2);
      part(0.076, 0.115, 0.025, PAD, 0, 0.04, 0.33);
      break;
    case 'autoshotgun': // Rumble Drum: stubby coral auto shotgun with a big yellow drum.
      part(0.1, 0.13, 0.48, 0xff6b6b, 0, 0.07, -0.15);
      tube(0.036, 0.4, DARK, 0, 0.105, -0.52);
      part(0.085, 0.07, 0.07, DARK, 0, 0.105, -0.73); tip();
      tube(0.11, 0.1, GOLD, 0, -0.02, -0.33, 'x');
      tube(0.04, 0.12, DARK, 0, -0.02, -0.33, 'x');
      part(0.06, 0.15, 0.08, DARK, 0, -0.05, 0.04, 0.25);
      part(0.085, 0.12, 0.2, 0xc94f4f, 0, 0.045, 0.19);
      part(0.04, 0.04, 0.08, GOLD, 0, 0.155, -0.1);
      // Drum: rims and a ring of bolts on each face.
      for (const x of [-0.043, 0.043]) tube(0.116, 0.016, BRASS, x, -0.02, -0.33, 'x');
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        stud(0.012, 0.108, DARK, 0, -0.02 + Math.cos(a) * 0.075, -0.33 + Math.sin(a) * 0.075, 'x');
      }
      // Slotted heat shield over the barrel, bore, rear sight.
      part(0.06, 0.02, 0.26, 0xc94f4f, 0, 0.148, -0.5);
      for (const z of [-0.41, -0.47, -0.53, -0.59]) deco(0.04, 0.022, 0.028, SOOT, 0, 0.149, z);
      stud(0.024, 0.01, SOOT, 0, 0.105, -0.766);
      part(0.05, 0.03, 0.02, DARK, 0, 0.15, 0.05);
      // Body: racing stripe, charging handle, trigger, butt pad.
      deco(0.104, 0.014, 0.34, 0xfff5f5, 0, 0.1, -0.17);
      part(0.03, 0.025, 0.04, GOLD, -0.06, 0.07, -0.05);
      trigger(-0.05, 0.005);
      part(0.09, 0.135, 0.025, PAD, 0, 0.045, 0.3);
      break;
    case 'launcher': // Bloop Tube: fat bubblegum tube with yellow bands, a pop-gun on steroids.
      tube(0.08, 0.5, 0xda77f2, 0, 0.1, -0.24);
      tube(0.092, 0.055, GOLD, 0, 0.1, -0.47);
      tube(0.088, 0.045, GOLD, 0, 0.1, -0.03);
      tube(0.058, 0.012, SOOT, 0, 0.1, -0.5); tip();
      part(0.06, 0.15, 0.08, DARK, 0, -0.05, 0.04, 0.25);
      part(0.05, 0.13, 0.06, DARK, 0, -0.01, -0.27, -0.2);
      part(0.07, 0.08, 0.08, 0xae3ec9, 0, 0.06, 0.08);
      // Middle band, ladder sight crossbars, rear sight.
      tube(0.086, 0.03, 0xae3ec9, 0, 0.1, -0.25);
      group([0.03, 0.07, 0.03, GOLD, 0, 0.215, -0.32], [0.055, 0.012, 0.012, GOLD, 0, 0.245, -0.32]); // sight post and crossbar
      deco(0.045, 0.01, 0.034, DARK, 0, 0.215, -0.32);
      part(0.04, 0.03, 0.015, DARK, 0, 0.19, -0.06);
      // A shell seated in the breech.
      tube(0.05, 0.03, 0xffd43b, 0, 0.115, 0.02);
      stud(0.016, 0.006, DARK, 0, 0.115, 0.036);
      // Two spare shells strapped to the left side.
      deco(0.012, 0.03, 0.13, DARK, -0.083, 0.1, -0.14);
      for (const z of [-0.11, -0.17]) { tube(0.022, 0.07, 0x74c0fc, -0.1, 0.1, z, 'y'); tube(0.023, 0.016, GOLD, -0.1, 0.143, z, 'y'); }
      // Trigger, wire stock with a shoulder pad.
      trigger(-0.05, 0.03);
      part(0.02, 0.02, 0.2, DARK, 0, 0.06, 0.2);
      part(0.06, 0.12, 0.025, PAD, 0, 0.05, 0.31);
      break;
    case 'magnum': // Thunder Pea: gold revolver, silver cylinder, red lightning stripe.
      part(0.07, 0.08, 0.3, 0xffd43b, 0, 0.08, -0.17); tip();
      part(0.072, 0.022, 0.12, 0xff6b6b, 0, 0.08, -0.2);
      tube(0.066, 0.11, STEEL, 0, 0.05, -0.02);
      part(0.06, 0.1, 0.14, BRASS, 0, 0.04, 0.03);
      part(0.065, 0.17, 0.08, WOOD, 0, -0.07, 0.08, 0.3);
      part(0.022, 0.045, 0.035, DARK, 0, 0.135, 0.07);
      part(0.022, 0.04, 0.022, 0xff6b6b, 0, 0.135, -0.3);
      // Cylinder flutes, ejector rod under the barrel, top rib, rear sight, bore.
      for (let i = 0; i < 6; i++) {
        const a = ((i + 0.5) / 6) * Math.PI * 2;
        stud(0.013, 0.08, 0x9a94b5, Math.sin(a) * 0.059, 0.05 + Math.cos(a) * 0.059, -0.02);
      }
      tube(0.014, 0.2, STEEL, 0, 0.03, -0.2);
      part(0.025, 0.015, 0.24, BRASS, 0, 0.125, -0.16);
      part(0.04, 0.02, 0.02, DARK, 0, 0.128, -0.02);
      stud(0.02, 0.01, SOOT, 0, 0.085, -0.321);
      // Trigger, grip medallion and butt cap.
      trigger(0.0, -0.01, BRASS, DARK);
      stud(0.017, 0.069, 0xffd43b, 0, -0.06, 0.083, 'x');
      part(0.07, 0.02, 0.088, 0xffd43b, 0, -0.153, 0.055, 0.3);
      break;
    case 'deagle': // Desert Eagle: a chunky chrome hand cannon with a gold trim and a black grip.
      part(0.08, 0.1, 0.34, STEEL, 0, 0.07, -0.12); tip();
      part(0.066, 0.17, 0.085, SOOT, 0, -0.05, 0.03, 0.22);
      // Slide: a polished top strip, a raised rib with sights, rear serrations, the wide bore.
      deco(0.084, 0.02, 0.3, 0xe6e1f5, 0, 0.1, -0.12);
      part(0.03, 0.02, 0.3, DARK, 0, 0.13, -0.12);
      part(0.02, 0.03, 0.02, GOLD, 0, 0.15, -0.26);
      part(0.045, 0.025, 0.02, DARK, 0, 0.15, 0.02);
      for (const z of [-0.01, 0.015, 0.04]) deco(0.086, 0.06, 0.012, 0x9a94b5, 0, 0.07, z);
      stud(0.026, 0.01, SOOT, 0, 0.07, -0.291);
      // Frame: trigger, grip panel, a gold magazine base and hammer.
      trigger(-0.03, 0.02, DARK, GOLD);
      deco(0.07, 0.1, 0.05, PAD, 0, -0.04, 0.03, 0.22);
      part(0.07, 0.022, 0.095, GOLD, 0, -0.13, 0.05, 0.22);
      ball(GOLD, 0, 0.1, 0.055, 0.018);
      break;
    // Mounted support guns: bigger, and held square in the middle of the screen (see ViewModel).
    case 'minigun': { // Popcorn Gatling: a red motor housing, six spinning barrels, a striped popcorn bucket for an ammo box.
      part(0.16, 0.16, 0.34, 0xff6b6b, 0, 0.06, 0.04);
      part(0.172, 0.05, 0.3, GOLD, 0, 0.155, 0.04);
      deco(0.164, 0.03, 0.2, 0xffffff, 0, 0.02, 0.04);
      // The barrels and their clamps go on a separate batch that spins round the axis y = 0.06.
      spin = { b: new Batch(), y: 0.06 }; b = spin.b;
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; tube(0.02, 0.6, STEEL, Math.sin(a) * 0.048, Math.cos(a) * 0.048, -0.43); }
      tube(0.074, 0.03, DARK, 0, 0, -0.2);
      tube(0.074, 0.03, DARK, 0, 0, -0.5);
      tube(0.07, 0.03, BRASS, 0, 0, -0.71);
      stud(0.02, 0.01, SOOT, 0, 0, -0.73);
      b = main;
      muzzle = [0, 0.06, -0.725 - MUZZLE_GAP];
      // Spade grips with gold thumb triggers.
      group([0.03, 0.12, 0.03, DARK, -0.1, 0.03, 0.24], [0.03, 0.12, 0.03, DARK, 0.1, 0.03, 0.24], [0.23, 0.03, 0.03, DARK, 0, 0.08, 0.24]);
      part(0.03, 0.02, 0.025, GOLD, -0.06, 0.1, 0.24);
      part(0.03, 0.02, 0.025, GOLD, 0.06, 0.1, 0.24);
      // Popcorn bucket on the left, a chute feeding the housing.
      part(0.13, 0.15, 0.15, 0xfff5f5, -0.19, 0.0, 0.04);
      for (const z of [-0.01, 0.05]) deco(0.134, 0.15, 0.025, 0xff6b6b, -0.19, 0.0, z);
      for (let i = 0; i < 4; i++) ball(0xffe8a3, -0.19 + (i % 2 ? 0.03 : -0.03), 0.09, 0.02 + (i > 1 ? 0.04 : 0), 0.025);
      part(0.06, 0.03, 0.1, DARK, -0.11, 0.09, 0.04);
      break;
    }
    case 'cannon': // Thump Cannon: an olive tank gun, a fat barrel with a muzzle brake, a breech and side plates.
      part(0.22, 0.2, 0.32, 0x6f9a6b, 0, 0.06, 0.1);
      tube(0.068, 0.8, 0x86b281, 0, 0.08, -0.45);
      tube(0.095, 0.13, DARK, 0, 0.08, -0.9); tip();
      // Muzzle brake slots, a gold collar, a star on the breech, the bore.
      for (const z of [-0.88, -0.92]) deco(0.2, 0.04, 0.02, SOOT, 0, 0.08, z);
      tube(0.09, 0.05, GOLD, 0, 0.08, -0.1);
      deco(0.005, 0.07, 0.07, GOLD, -0.112, 0.08, 0.1);
      stud(0.05, 0.01, SOOT, 0, 0.08, -0.967);
      // Side plates, grips, a crate of shells on the right.
      part(0.03, 0.26, 0.24, 0x5d8a5a, -0.18, 0.1, -0.12);
      part(0.03, 0.26, 0.24, 0x5d8a5a, 0.18, 0.1, -0.12);
      group([0.03, 0.1, 0.03, DARK, -0.13, -0.01, 0.28], [0.03, 0.1, 0.03, DARK, 0.13, -0.01, 0.28], [0.29, 0.03, 0.03, DARK, 0, 0.04, 0.3]);
      part(0.14, 0.1, 0.18, WOOD, 0.24, -0.03, 0.12);
      for (const z of [0.07, 0.12, 0.17]) stud(0.022, 0.03, BRASS, 0.24, 0.03, z, 'y');
      break;
    case 'rockets': { // Fizzbang Pod: a sky-blue box of eight tubes with red rocket noses peeking out.
      part(0.3, 0.2, 0.5, 0x74c0fc, 0, 0.1, -0.16); tip();
      for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
        const x = -0.105 + c * 0.07, y = 0.055 + r * 0.09;
        stud(0.028, 0.01, SOOT, x, y, -0.412);
        stud(0.018, 0.01, 0xff6b6b, x, y, -0.405);
      }
      // Gold bands, a sight frame on top, grips behind.
      for (const z of [-0.3, -0.02]) deco(0.304, 0.204, 0.03, GOLD, 0, 0.1, z);
      group([0.02, 0.07, 0.02, DARK, -0.06, 0.235, -0.2], [0.02, 0.07, 0.02, DARK, 0.06, 0.235, -0.2], [0.14, 0.02, 0.02, DARK, 0, 0.27, -0.2]);
      group([0.03, 0.12, 0.03, DARK, -0.1, -0.02, 0.15], [0.03, 0.12, 0.03, DARK, 0.1, -0.02, 0.15], [0.23, 0.03, 0.03, DARK, 0, 0.03, 0.15]);
      part(0.03, 0.02, 0.025, GOLD, 0.06, 0.05, 0.15);
      break;
    }
    // Close-in weapons: the business end points down -Z like a barrel; the rig tips them upright (see ViewModel).
    case 'bat': // Bonk Bat: fat wooden slugger with a red tip band and taped grip.
      tube(0.026, 0.2, DARK, 0, 0.03, 0.0);
      tube(0.034, 0.03, GOLD, 0, 0.03, 0.1);
      tube(0.046, 0.4, 0xffc078, 0, 0.03, -0.42);
      tube(0.05, 0.07, 0xff6b6b, 0, 0.03, -0.6); tip();
      // Tapers from the grip out to the barrel; tape wraps; a white maker's band with a red pinstripe; end cap.
      cone(0.046, 0.026, 0.14, 0xffc078, 0, 0.03, -0.15);
      for (const z of [-0.055, 0.0, 0.055]) tube(0.029, 0.018, 0x6e698c, 0, 0.03, z);
      tube(0.048, 0.06, 0xfff5f5, 0, 0.03, -0.34);
      stud(0.0485, 0.012, 0xff6b6b, 0, 0.03, -0.34);
      stud(0.022, 0.01, BRASS, 0, 0.03, 0.116);
      stud(0.036, 0.008, 0xc94f4f, 0, 0.03, -0.637);
      break;
    case 'machete': // Snip-Snap: a big pair of garden shears' single blade, mint handle.
      part(0.04, 0.055, 0.17, 0x63e6be, 0, 0.03, 0.0);
      part(0.09, 0.03, 0.03, GOLD, 0, 0.03, -0.1);
      part(0.016, 0.1, 0.5, STEEL, 0, 0.045, -0.36); tip();
      part(0.018, 0.03, 0.504, 0xffffff, 0, -0.01, -0.36); // a hair longer than the blade: flush ends flickered
      // Shear pivot bolt, a groove down the blade.
      tube(0.022, 0.03, GOLD, 0, 0.045, -0.15, 'x');
      stud(0.01, 0.034, DARK, 0, 0.045, -0.15, 'x');
      deco(0.02, 0.012, 0.36, 0x9a94b5, 0, 0.07, -0.4);
      // Handle: grip grooves, a finger loop underneath, pommel.
      for (const z of [-0.04, 0.0, 0.04]) deco(0.044, 0.059, 0.012, 0x38d9a9, 0, 0.03, z);
      group([0.03, 0.015, 0.11, 0x38d9a9, 0, -0.045, 0.0], [0.03, 0.05, 0.015, 0x38d9a9, 0, -0.02, -0.05], [0.03, 0.05, 0.015, 0x38d9a9, 0, -0.02, 0.05]);
      part(0.046, 0.062, 0.02, GOLD, 0, 0.03, 0.09);
      break;
    // Throwables.
    case 'firebomb': // Hot Sauce: a squat red bottle with a yellow label and a rag in the neck.
      tube(0.055, 0.17, 0xe8413c, 0, 0.05, -0.04);
      tube(0.057, 0.06, GOLD, 0, 0.05, -0.04);
      tube(0.024, 0.09, 0xe8413c, 0, 0.05, -0.17);
      part(0.03, 0.03, 0.07, 0xfff5f5, 0, 0.05, -0.24); tip();
      // Shoulder up to the neck, cap ring, a band across the label, a darker base, a second rag end, an ember.
      cone(0.025, 0.055, 0.045, 0xe8413c, 0, 0.05, -0.147);
      tube(0.03, 0.02, GOLD, 0, 0.05, -0.2);
      stud(0.058, 0.014, 0xe8413c, 0, 0.05, -0.04);
      stud(0.0565, 0.014, 0xc92a2a, 0, 0.05, 0.036);
      part(0.02, 0.02, 0.05, 0xffe3e3, 0.012, 0.064, -0.245, 0.5);
      deco(0.032, 0.032, 0.014, 0xff922b, 0, 0.05, -0.27);
      break;
    case 'rattle': // Rattle Bomb: a baby rattle with a fuse.
      tube(0.02, 0.17, GOLD, 0, 0.05, 0.03);
      tube(0.075, 0.14, 0x74c0fc, 0, 0.05, -0.13);
      tube(0.079, 0.035, 0xff8fab, 0, 0.05, -0.13);
      part(0.015, 0.015, 0.05, SOOT, 0, 0.05, -0.225); tip();
      // Domed ends, a ring of yellow studs either side of the band.
      ball(0x74c0fc, 0, 0.05, -0.2, 0.073, 0.073, 0.022);
      ball(0x74c0fc, 0, 0.05, -0.06, 0.073, 0.073, 0.022);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        stud(0.012, 0.012, GOLD, Math.sin(a) * 0.072, 0.05 + Math.cos(a) * 0.072, i % 2 ? -0.17 : -0.09, 'y');
      }
      // Handle: two beads and a teething ring on the end; a spark on the fuse.
      tube(0.026, 0.02, 0xff8fab, 0, 0.05, 0.02);
      tube(0.026, 0.02, 0x74c0fc, 0, 0.05, 0.06);
      tube(0.036, 0.02, 0xff8fab, 0, 0.05, 0.14, 'x');
      stud(0.018, 0.024, GOLD, 0, 0.05, 0.14, 'x');
      deco(0.02, 0.02, 0.012, 0xff922b, 0, 0.05, -0.252);
      break;
  }
  main.trimHulls(); // no outline slivers where one part ends inside another
  spin?.b.trimHulls();
  return { b: main, muzzle, pump, spin };
}

/** First-person gun for the viewmodel layer (separate toon and ink draws; the pump is its own entity). */
export function buildGun(id: GunId): Gun {
  const { b, muzzle, pump: hasPump, spin: sp } = gunParts(id);
  const ent = b.build(VM, true);
  let spin: pc.Entity | null = null;
  if (sp) { spin = sp.b.build(VM, true); spin.setLocalPosition(0, sp.y, 0); ent.addChild(spin); }
  let pump: pc.Entity | null = null;
  if (hasPump) {
    pump = inkBox(PUMP.w, PUMP.h, PUMP.d, PUMP.color, PUMP.t, VM, true);
    pump.setLocalPosition(PUMP.x, PUMP.y, PUMP.z);
    ent.addChild(pump);
  }
  return { ent, muzzle, pump, spin };
}

const worldGunMeshes = new Map<GunId, pc.Mesh>();
/** Gun geometry for the world: toon parts plus their ink hull (inside-out, colour alpha 0) in one mesh for `toonInkMat`. */
function worldGunMesh(id: GunId): pc.Mesh {
  let m = worldGunMeshes.get(id);
  if (!m) {
    const { b, pump, spin } = gunParts(id);
    const { solids, hulls } = b.take();
    if (spin) { const t = spin.b.take(), at = trs(0, spin.y, 0); for (const g of t.solids) solids.push(make(g, undefined, at)); for (const g of t.hulls) hulls.push(make(g, undefined, at)); }
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

const muzzles = new Map<GunId, P3>();
/** Muzzle point of a gun in its own space (the same for the first-person and world builds). Do not modify. */
export function gunMuzzle(id: GunId): Readonly<P3> {
  let m = muzzles.get(id);
  if (!m) { m = gunParts(id).muzzle; muzzles.set(id, m); }
  return m;
}

export const STAR_MESH = toMesh(device, make(star(6, 1, 0.42)));
const ballMesh = toMesh(device, make(sphere(12, 10)));

/** Vertical FOV of the first-person camera: fixed, so the gun looks the same whatever the world FOV is. */
const VM_FOV = 52;
const _mv = new pc.Vec3(), _mq = new pc.Quat();

/** One pose of a close-in swing at progress `k` (0..1): rig offset (x, y, z) from its rest position and rotation (rx, ry, rz). */
type SwingKey = [k: number, x: number, y: number, z: number, rx: number, ry: number, rz: number];
/** Rest pose of every close-in weapon: upright at the right of the screen (positive rx tips the business end up). */
const HELD: SwingKey = [0, 0, 0, 0, 1.05, 0.25, -0.2];
const rest = (k: number): SwingKey => [k, HELD[1], HELD[2], HELD[3], HELD[4], HELD[5], HELD[6]];
/**
 * First-person swings, one style per weapon. `secs`: how long the whole motion takes (under the
 * weapon's `rate`); `keys`: poses to ease through; `alt`: a second set used on every other swing.
 * Positive ry turns the tip toward the left of the screen.
 */
const SWINGS: Partial<Record<GunId, { secs: number; keys: SwingKey[]; alt?: SwingKey[] }>> = {
  // Bonk Bat: a flat baseball swing. Wound up over the right shoulder, then levelled and swept right to left.
  bat: {
    secs: 0.46,
    keys: [rest(0), [0.2, 0.03, 0.04, 0.04, 0.8, -0.55, -0.45], [0.48, -0.2, -0.03, -0.12, 0.18, 0.75, 0.25], [0.62, -0.36, -0.05, -0.06, 0.22, 1.5, 0.45], rest(1)],
  },
  // Snip-Snap: quick diagonal cuts that alternate, forehand (top right to bottom left) then backhand.
  machete: {
    secs: 0.3,
    keys: [rest(0), [0.16, 0.07, 0.11, 0.02, 1.55, -0.25, -0.55], [0.5, -0.27, -0.15, -0.14, -0.3, 0.95, 0.75], rest(1)],
    alt: [rest(0), [0.16, -0.3, -0.1, 0.0, 0.25, 1.15, 0.85], [0.5, 0.1, 0.1, -0.14, 1.05, -0.7, -0.7], rest(1)],
  },
};
const _swing: SwingKey = [0, 0, 0, 0, 0, 0, 0];
/** The swing pose at progress `k`, eased between the two keys around it (into `_swing`). */
function swingPose(keys: SwingKey[], k: number): SwingKey {
  let i = 1;
  while (i < keys.length - 1 && keys[i][0] < k) i++;
  const a = keys[i - 1], b = keys[i], u = Math.min(1, Math.max(0, (k - a[0]) / (b[0] - a[0] || 1))), e = u * u * (3 - 2 * u);
  for (let j = 1; j < 7; j++) _swing[j] = a[j] + (b[j] - a[j]) * e;
  return _swing;
}

export class ViewModel {
  private root = new pc.Entity('viewmodel');
  private cam = new pc.Entity('vm-camera');
  private rig = new pc.Entity('rig');
  private guns: Gun[] = [];
  private shoveHand: pc.Entity;
  private flash: pc.Entity;
  private current = 0;
  private kick = 0;
  private swap = 0;
  private reload = 0; // 0..1 progress, 0 = idle
  private shoveT = 0;
  /** Close-in swing (1 -> 0 over a swing) and throw flick. */
  private swingT = 0;
  private tossT = 0;
  private melee: boolean[];
  /** Throwables: held loosely at the right; `aim` (0..1) is the arm drawn back for a throw, `held` whether there is one in the hand. */
  private thrown: boolean[];
  /** Mounted guns: held square in the middle of the screen; the minigun's barrels spin up while it fires (`spinV` rad/s, `spinA` angle). */
  private mounted: boolean[];
  private spinV = 0;
  private spinA = 0;
  private aim = 0;
  private aimWant = false;
  private held = true;
  private ids: GunId[];
  /** Swings made so far (alternating styles use it). */
  private swings = 0;
  private flashT = 0;
  private bob = 0;
  private swayX = 0;
  private swayY = 0;
  visible = true;

  constructor(ids: GunId[]) {
    this.ids = ids;
    this.melee = ids.map((id) => !!WEAPONS.find((w) => w.id === id)?.melee);
    this.thrown = ids.map((id) => !!WEAPONS.find((w) => w.id === id)?.thrown);
    this.mounted = ids.map((id) => WEAPONS.find((w) => w.id === id)?.slot === 'mount');
    // Parked far below the level so nothing in the world layer is ever near it.
    this.root.setPosition(0, -500, 0);
    const cam = this.cam;
    cam.addComponent('camera', { fov: VM_FOV, nearClip: 0.01, farClip: 10, priority: 1, layers: [VM], clearColorBuffer: false, clearDepthBuffer: true });
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
    if (this.melee[this.current]) { this.swingT = 1; this.swings++; return; }
    this.kick = 1;
    if (this.guns[this.current].spin) this.spinV = Math.min(40, this.spinV + 9);
    this.flashT = 0.055;
    const [x, y, z] = this.guns[this.current].muzzle;
    this.flash.setLocalPosition(x, y, z);
    setRot(this.flash, 0, 0, Math.random() * Math.PI);
    const s = 0.075 + Math.random() * 0.04;
    this.flash.setLocalScale(s, s, s);
  }
  /**
   * Where the current gun's muzzle is drawn this frame, as a world-space point that lands on the same
   * pixel when seen through `worldCam`. The gun is drawn by its own camera with its own FOV, so the rig
   * position can't be used directly: the muzzle is taken from the posed rig (kick, sway, bob, reload
   * all included), in the first-person camera's view space, and its sideways/vertical offset is rescaled
   * by the ratio of the two FOVs at the same depth. Call after `update`.
   */
  muzzleWorld(worldCam: pc.Entity, out: { x: number; y: number; z: number }): void {
    const gun = this.guns[this.current], [mx, my, mz] = gun.muzzle;
    // Gun space -> world -> first-person view space (x right, y up, -z forward).
    gun.ent.getWorldTransform().transformPoint(_mv.set(mx, my, mz), _mv);
    _mv.sub(this.cam.getPosition());
    _mq.copy(this.cam.getRotation()).invert().transformVector(_mv, _mv);
    const k = Math.tan((worldCam.camera!.fov * Math.PI) / 360) / Math.tan((VM_FOV * Math.PI) / 360);
    _mv.x *= k; _mv.y *= k;
    worldCam.getRotation().transformVector(_mv, _mv);
    const p = worldCam.getPosition();
    out.x = p.x + _mv.x; out.y = p.y + _mv.y; out.z = p.z + _mv.z;
  }
  setReload(progress: number): void { this.reload = progress; }
  shove(): void { this.shoveT = 1; }
  /** Throwing the carried throwable: the free hand flicks forward. */
  toss(): void { this.tossT = 1; this.aim = 0; }
  /** A throwable in hand: `aiming` draws the arm back; `held` false shows an empty hand (just thrown). */
  setAim(aiming: boolean, held: boolean): void { this.aimWant = aiming; this.held = held; }

  update(dt: number, moving: number, lookDX: number, lookDY: number): void {
    this.root.enabled = this.visible;
    if (!this.visible) return;
    this.kick = Math.max(0, this.kick - dt * 9);
    this.swap = Math.max(0, this.swap - dt * 4.5);
    this.shoveT = Math.max(0, this.shoveT - dt * 3.2);
    this.swingT = Math.max(0, this.swingT - dt / (SWINGS[this.ids[this.current]]?.secs ?? 0.4));
    this.tossT = Math.max(0, this.tossT - dt * 3.4);
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
    if (this.melee[this.current]) {
      // Held upright at the right of the screen; each weapon swings its own way (SWINGS).
      const sw = SWINGS[this.ids[this.current]];
      const p = this.swingT > 0 && sw ? swingPose(this.swings % 2 === 0 && sw.alt ? sw.alt : sw.keys, 1 - this.swingT) : HELD;
      const lp = this.rig.getLocalPosition();
      this.rig.setLocalPosition(lp.x + p[1], lp.y + p[2], lp.z + p[3]);
      setRot(this.rig, p[4] - this.swap * 0.8, p[5] + this.swayX * 2, p[6]);
    } else if (this.thrown[this.current]) {
      // Held upright in the fist (neck and rag up, not pointed like a barrel); aiming, it comes up and tips back over the shoulder, cocked to throw.
      this.aim += ((this.aimWant ? 1 : 0) - this.aim) * Math.min(1, dt * 12);
      const a = this.aim, lp = this.rig.getLocalPosition();
      // (Kept at arm's length: nearer the eye it fills the corner of the screen.)
      this.rig.setLocalPosition(lp.x + 0.05 + a * 0.03, lp.y - 0.06 + a * 0.13 + Math.sin(this.bob * 3) * 0.004 * a, lp.z - 0.05 + a * 0.02);
      setRot(this.rig, 1.35 + a * 0.55 - this.swap * 0.8, this.swayX * 2, -0.12 - a * 0.1);
    } else if (this.mounted[this.current]) {
      // A mounted gun sits square in front of you, lower and further out; it shakes rather than kicks up, and tips down while it cools.
      this.rig.setLocalPosition(this.swayX * 0.5 + (Math.random() - 0.5) * this.kick * 0.006, -0.24 - this.swap * 0.3 - r * 0.08 + this.swayY * 0.5, -0.5 + this.kick * 0.035);
      setRot(this.rig, this.kick * 0.03 - r * 0.35 - this.swap * 0.8, this.swayX, 0);
    } else setRot(this.rig, this.kick * 0.16 - r * 0.9 - this.swap * 0.8, 0.04 + this.swayX * 2, r * 0.5);
    const spin = this.guns[this.current].spin;
    if (spin) {
      this.spinV = Math.max(0, this.spinV - dt * 14);
      this.spinA += this.spinV * dt;
      setRot(spin, 0, 0, this.spinA);
    }
    this.guns[this.current].ent.enabled = !this.thrown[this.current] || this.held;
    const pump = this.guns[this.current].pump;
    if (pump) pump.setLocalPosition(0, 0.01, -0.36 + Math.sin(Math.min(1, this.kick * 1.4) * Math.PI) * 0.09);
    // Shove: an open palm sweeps across the screen.
    this.shoveHand.enabled = this.shoveT > 0 || this.tossT > 0;
    if (this.tossT > 0 && this.shoveT <= 0) {
      // Throw: the left hand comes up from the bottom corner and flicks forward.
      const k = 1 - this.tossT;
      this.shoveHand.setLocalPosition(-0.2 + k * 0.08, -0.2 + Math.sin(k * Math.PI) * 0.16, -0.3 - k * 0.2);
      this.shoveHand.setLocalScale(0.07, 0.07, 0.07);
    }
    if (this.shoveT > 0) {
      const k = 1 - this.shoveT;
      this.shoveHand.setLocalPosition(-0.28 + k * 0.42, -0.14 + Math.sin(k * Math.PI) * 0.07, -0.34 - Math.sin(k * Math.PI) * 0.14);
      this.shoveHand.setLocalScale(0.1, 0.13, 0.05);
    }
  }
}
