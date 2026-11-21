// Shooting range: an offline practice map (client only, no room or server). Not part of the
// campaign (CHAPTERS); the client runs it with client/src/range.ts standing in for the server.
// Tile coordinates: x grows east, z grows south. You start at the north end facing south (+z).
import { LevelBuilder, Level, F, WALL, type Theme } from './level';
import { TILE, ZT } from './constants';
import type { GunKind } from './level';

/** Where the firing line is (tile z); target distances are measured from it. */
export const RANGE_LINE = 6;
/** Metres downrange of the firing line for tile row `z`. */
const rowZ = (metres: number) => RANGE_LINE + metres / TILE;

/**
 * A target dummy: a zombie of `type` standing at (x, z) metres. `sway`: metres it strafes either side
 * (tracking practice), at `speed` m/s. Dummies respawn where they stood a moment after dying.
 */
export interface RangeDummy { type: number; x: number; z: number; sway?: number; speed?: number }

/** Distance rows (metres from the firing line), labelled on the floor. */
export const RANGE_ROWS = [10, 20, 40, 60, 80] as const;

const at = (tx: number, metres: number) => ({ x: (tx + 0.5) * TILE, z: (rowZ(metres) + 0.5) * TILE });
export const RANGE_DUMMIES: RangeDummy[] = [
  // 10 m: one of every type, spaced wider than a launcher blast so each can be tested alone.
  ...[ZT.WALKER, ZT.LEAPER, ZT.PUFFER, ZT.DROOLER, ZT.ALARM, ZT.CHARGER, ZT.BRUTE].map((type, i) => ({ type, ...at(5 + i * 4, 10) })),
  // 20 m: three walkers in a file (piercing rounds), a moving walker, and a clump (launcher splash).
  ...[0, 1.4, 2.8].map((d) => ({ type: ZT.WALKER, x: (9.5) * TILE, z: (rowZ(20) + 0.5) * TILE + d })),
  { type: ZT.WALKER, ...at(18, 20), sway: 6, speed: 3.5 },
  ...[[0, 0], [1.3, 0.4], [-1.2, 0.5], [0.4, 1.4], [-0.5, -1.2]].map(([dx, dz]) => ({ type: ZT.WALKER, x: 27.5 * TILE + dx, z: (rowZ(20) + 0.5) * TILE + dz })),
  // 40 m and beyond: falloff-free but spread matters.
  ...[10, 18, 26].map((tx) => ({ type: ZT.WALKER, ...at(tx, 40) })),
  { type: ZT.WALKER, ...at(14, 60) }, { type: ZT.LEAPER, ...at(22, 60) }, { type: ZT.WALKER, ...at(18, 60), sway: 8, speed: 4.5 },
  { type: ZT.WALKER, ...at(14, 80) }, { type: ZT.BRUTE, ...at(24, 80) },
];

/** The rack at the back of the booth: every pickup gun (the pistol is the default sidearm). */
const RACK: GunKind[] = ['smg', 'shotgun', 'rifle', 'autoshotgun', 'sniper', 'launcher', 'magnum'];

const THEME: Theme = {
  sky: [0xffc38a, 0x8fb4e0, 0x3d5fa8], fog: 0x9fb1d6, fogNear: 60, fogFar: 190,
  buildings: [0x6f7fb8, 0x5f8fa8, 0x8e6fa8],
  floors: { [F.CONCRETE]: 0x8c8aa3, [F.SIDEWALK]: 0xb9b4cf, [F.DIRT]: 0x8d6f58 },
};

function build() {
  const W = 38, H = RANGE_LINE + 50;
  const b = new LevelBuilder(W, H);
  // Booth (behind the line) and the field.
  b.carve(2, 2, W - 3, RANGE_LINE, F.SIDEWALK);
  b.carve(2, RANGE_LINE + 1, W - 3, H - 4, F.CONCRETE);
  b.carve(2, H - 3, W - 3, H - 3, F.DIRT);
  b.walls(0, H - 2, W - 1, H - 1, WALL.ROCK, 9);
  b.walls(0, 0, 1, H - 1, WALL.FENCE, 3); b.walls(W - 2, 0, W - 1, H - 1, WALL.FENCE, 3);
  b.walls(0, 0, W - 1, 1, WALL.BUILDING, 6);
  b.label('FIRING LINE', W / 2, RANGE_LINE + 0.6, 26, '#ffd43b');
  for (const m of RANGE_ROWS) {
    b.label(`${m} m`, 3.6, rowZ(m) + 0.5, 24, '#fff1c9');
    b.label(`${m} m`, W - 3.6, rowZ(m) + 0.5, 24, '#fff1c9');
  }
  RACK.forEach((k, i) => b.pick(k, 12 + i * 2, 2));
  b.label('WEAPON RACK — or press 1-8', W / 2, 3.6, 18, '#5ff2e0');
  for (let z = 4; z < H - 3; z += 8) { b.lamp(2.5, z); b.lamp(W - 2.5, z); }
  b.start([[W / 2, 4], [W / 2 - 2, 4], [W / 2 + 2, 4], [W / 2, 3]]);
  b.reach({ x0: 2, z0: 2, x1: W - 3, z1: RANGE_LINE }, { objective: 'Shooting range: test any weapon', at: [W / 2, 2.5] });
  return b.done({ id: 'range', title: 'Shooting Range', subtitle: 'Practice', intro: '', theme: THEME });
}

let cached: Level | null = null;
export function rangeLevel(): Level { return (cached ??= new Level(build())); }
