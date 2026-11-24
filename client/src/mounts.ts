// Mounted support guns in the world (shared/level.ts Mount, shared/constants.ts MOUNT): a sandbag
// nest and a post, with the gun on a pivot that turns and tilts with whoever mans it. Your own gun
// is hidden while you man it (the first-person rig draws it instead).
import * as pc from 'playcanvas';
import { MOUNT } from '../../shared/constants';
import type { Level } from '../../shared/level';
import { app, inkBox } from './gfx';
import { worldGun } from './viewmodel';

/** Gun-unit to metre scale for a mounted gun's world model, and its pivot height above the floor. */
const GUN_SCALE = 1.8, PIVOT_Y = 1.0;
const SAND = 0xc9b27c, SAND_DARK = 0xa8915e, POST = 0x54506e;

/** How a mount is aimed this frame: the gunner's yaw and pitch, and whether the gunner is you. */
export interface MountAim { yaw: number; pitch: number; mine: boolean }

export interface Mounts {
  /** `aim(id)`: the gunner's aim for mount `id`, or null while nobody mans it. */
  update(dt: number, aim: (id: number) => MountAim | null): void;
  dispose(): void;
}

export function buildMounts(L: Level): Mounts {
  const root = new pc.Entity('mounts');
  app.root.addChild(root);
  const views = L.def.mounts.map((m) => {
    const base = new pc.Entity(`mount-${m.id}`);
    base.setPosition(m.x, m.y, m.z);
    base.setLocalEulerAngles(0, (m.yaw * 180) / Math.PI, 0);
    root.addChild(base);
    // Sandbags in a horseshoe round the front of the gun (local -Z is where it faces), open at the seat.
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI * 0.75 + (i / 6) * Math.PI * 1.5, r = 1.15;
      for (let row = 0; row < 2; row++) {
        const bag = inkBox(0.62, 0.26, 0.34, row ? SAND : SAND_DARK, 0.025);
        bag.setLocalPosition(Math.sin(a) * r, 0.13 + row * 0.26, -Math.cos(a) * r);
        bag.setLocalEulerAngles(0, (-a * 180) / Math.PI + (row ? 8 : 0), 0);
        base.addChild(bag);
      }
    }
    const post = inkBox(0.14, PIVOT_Y, 0.14, POST, 0.025);
    post.setLocalPosition(0, PIVOT_Y / 2, 0);
    base.addChild(post);
    const foot = inkBox(0.7, 0.08, 0.7, POST, 0.025);
    foot.setLocalPosition(0, 0.04, 0);
    base.addChild(foot);
    // Yaw on the pivot, pitch on the gun. The model's grips sit behind the pivot, toward the seat.
    const pivot = new pc.Entity('pivot');
    pivot.setPosition(m.x, m.y + PIVOT_Y, m.z);
    root.addChild(pivot);
    const gun = worldGun(m.kind);
    gun.setLocalScale(GUN_SCALE, GUN_SCALE, GUN_SCALE);
    gun.setLocalPosition(0, -0.06 * GUN_SCALE, -0.05);
    const tilt = new pc.Entity('tilt');
    tilt.addChild(gun);
    pivot.addChild(tilt);
    return { m, pivot, tilt, yaw: m.yaw, pitch: 0 };
  });

  return {
    update(dt, aim) {
      const k = Math.min(1, dt * 12);
      for (const v of views) {
        const a = aim(v.m.id);
        // Unmanned, it settles back to face the way it was placed, barrel dipped a little.
        const wantYaw = a ? a.yaw : v.m.yaw, wantPitch = a ? Math.max(MOUNT.pitchDown, Math.min(MOUNT.pitchUp, a.pitch)) : -0.12;
        let dy = wantYaw - v.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        v.yaw += dy * k; v.pitch += (wantPitch - v.pitch) * k;
        v.pivot.enabled = !a?.mine;
        v.pivot.setLocalEulerAngles(0, (v.yaw * 180) / Math.PI, 0);
        v.tilt.setLocalEulerAngles((v.pitch * 180) / Math.PI, 0, 0);
      }
    },
    dispose() { root.destroy(); },
  };
}
