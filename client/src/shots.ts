// Hitscan for your own shots: where a bullet stops and which zombies it hit. Pure functions of the
// level, the open doors and the zombies as shown (main.ts fire()).
import { ZT, zedHitSpheres } from '../../shared/constants';
import type { Level } from '../../shared/level';

export type V3 = { x: number; y: number; z: number };
/** What a shot needs to know about a zombie: its type, state and where it is shown (`y`: its floor). */
export interface ShotTarget { type: number; st: number; x: number; y: number; z: number }
export interface ShotHit<Z extends ShotTarget> { zed: Z; head: boolean; t: number }
/** Camera basis for a shot: forward (fw*), right (rx, rz) and up (ux, uy, uz). */
export interface AimBasis { fwx: number; fwy: number; fwz: number; rx: number; rz: number; ux: number; uy: number; uz: number }

/** Scratch for zedHitSpheres in castShot. */
const hitScratch = { headY: 0, headR: 0, bodyY: 0, bodyR: 0 };

/**
 * Hitscan from `o` along unit `d` against walls, floor and zombie hit spheres (doors in `doors` open).
 * A bullet passes through up to `pierce` zombies (nearest first) and stops at a Brute; `t` is where it stopped.
 */
export function castShot<Z extends ShotTarget>(L: Level, doors: number, zeds: Iterable<Z>, o: V3, d: V3, range: number, pierce = 1): { t: number; hits: ShotHit<Z>[] } {
  // Walls, props, closed doors, floors, slabs and ceilings.
  let t = L.ray(o.x, o.y, o.z, d.x, d.y, d.z, range, doors);
  const hits: ShotHit<Z>[] = [];
  const sphere = (cx: number, cy: number, cz: number, r: number): number => {
    const ox = cx - o.x, oy = cy - o.y, oz = cz - o.z;
    const tca = ox * d.x + oy * d.y + oz * d.z;
    if (tca < 0) return Infinity;
    const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
    return d2 > r * r ? Infinity : tca - Math.sqrt(r * r - d2);
  };
  for (const z of zeds) {
    const hs = zedHitSpheres(z.type, z.st, hitScratch);
    const th = sphere(z.x, z.y + hs.headY, z.z, hs.headR);
    const tb = sphere(z.x, z.y + hs.bodyY, z.z, hs.bodyR);
    const tz = Math.min(th, tb);
    if (tz < t) hits.push({ zed: z, head: th <= tb, t: tz });
  }
  hits.sort((a, b) => a.t - b.t);
  let n = 0;
  while (n < hits.length && n < pierce) if (hits[n++].zed.type === ZT.BRUTE) break;
  hits.length = n;
  if (n && (n === pierce || hits[n - 1].zed.type === ZT.BRUTE)) t = hits[n - 1].t;
  return { t, hits };
}

/** Random unit direction in a disc of radius `spread` around the basis' forward, into `out`. */
export function spreadDir(b: AimBasis, spread: number, out: V3): V3 {
  const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
  const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
  out.x = b.fwx + b.rx * ca + b.ux * sa; out.y = b.fwy + b.uy * sa; out.z = b.fwz + b.rz * ca + b.uz * sa;
  const dl = Math.hypot(out.x, out.y, out.z); out.x /= dl; out.y /= dl; out.z /= dl;
  return out;
}
