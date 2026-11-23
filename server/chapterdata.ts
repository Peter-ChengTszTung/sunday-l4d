// Per-chapter static data the director needs, computed once per chapter and cached.
import { cellOf, type Level, type Step } from '../shared/level';
import { getLevel } from '../shared/chapters';
import { wandererRegions, type Regions } from '../shared/regions';
import { INF } from './tuning';

/** Per-chapter static data the director needs. */
export interface ChapterData {
  L: Level;
  progress: Int16Array; // BFS distance from the start with every door open
  /** Spawnable cells (not safe rooms/doors). */
  open: number[];
  /** 1 where `open` has the cell. */ spawnable: Uint8Array;
  /** Wanderer regions over `open` (populated once per attempt, see WANDERERS). */ regions: Regions;
  /**
   * The quest route as one distance (path tiles), monotone along the steps, unlike `progress` (some
   * chapters loop back toward the start). Leg `i` runs from step i-1's objective to step i's, walked
   * with step i's doors: it starts at `start[i]` and is `len[i]` long; `total` is the whole route.
   */
  route: { start: number[]; len: number[]; total: number };
}
const chapterData = new Map<number, ChapterData>();
export function dataFor(ch: number): ChapterData {
  let d = chapterData.get(ch);
  if (d) return d;
  const L = getLevel(ch), regions = wandererRegions(L);
  const { progress, open, spawnable } = regions;
  d = { L, progress, open, spawnable, regions, route: routeOf(L) };
  chapterData.set(ch, d);
  return d;
}

/**
 * Nodes of step `s`'s objective, walkable with door mask `doors`: its untaken items, its area (on the
 * area's storey), or around its waypoint (a `use` step: on the machine's storey).
 */
export function objectiveCells(L: Level, s: Step, doors: number, taken?: Set<number>): number[] {
  const src: number[] = [];
  const add = (tx: number, tz: number, lv: number) => { if (!L.solidAt(tx, tz, doors, lv)) src.push(L.node(tx, tz, lv)); };
  if (s.kind === 'collect') {
    for (const p of L.def.pickups) if (p.kind === 'item' && p.group === s.group && !taken?.has(p.id)) add(cellOf(p.x), cellOf(p.z), L.storeyOf(p.y));
  } else if (s.area) {
    const lv = s.area.lv ?? 0;
    for (let z = s.area.z0; z <= s.area.z1; z++) for (let x = s.area.x0; x <= s.area.x1; x++) add(x, z, lv);
  } else {
    const m = s.kind === 'use' && s.target !== undefined ? L.def.pickups[s.target] : undefined;
    const tx = cellOf(s.at.x), tz = cellOf(s.at.z), lv = L.storeyOf(m ? m.y : s.at.y ?? 0);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) add(tx + dx, tz + dz, lv);
  }
  return src;
}

function routeOf(L: Level): ChapterData['route'] {
  const def = L.def, start: number[] = [], len: number[] = [], field = new Int16Array(L.N);
  let from = [L.node(def.startCell.x, def.startCell.z, def.startCell.lv ?? 0)], total = 0;
  def.steps.forEach((s, i) => {
    const doors = L.doorsAfter(i), dst = objectiveCells(L, s, doors);
    L.distanceField(dst, doors, field);
    let d = INF;
    for (const c of from) d = Math.min(d, field[c]);
    start.push(total); len.push(d < INF ? d : 0); total += len[i];
    if (dst.length) from = dst;
  });
  return { start, len, total };
}
