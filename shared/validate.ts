// Static checks + stats for a chapter, shared by scripts/check-chapters.ts and
// the map viewer. Walks the quest in order with each step's door state and
// verifies every objective is reachable from where the team stands.
import { TILE, WEAPONS } from './constants';
import { F, ALL_OPEN, cellOf, type Level, type Vec2 } from './level';

export interface StepReport { index: number; kind: string; objective: string; pathTiles: number; reachable: boolean; note?: string }
export interface ChapterReport {
  id: string; errors: string[]; warnings: string[]; steps: StepReport[];
  stats: { size: string; walkable: number; pathMetres: number; holdSeconds: number; estMinutes: [number, number]; checkpoints: number; doors: number; pickups: Record<string, number>; notes: number };
}

const INF = 32767;
/** Minimum loot in each start/checkpoint safe room for a 4-player squad. */
export const MIN_ROOM_GUNS = 4, MIN_ROOM_AMMO = 2;

export function validateChapter(L: Level): ChapterReport {
  const def = L.def, { W, H } = L;
  const errors: string[] = [], warnings: string[] = [];
  const steps: StepReport[] = [];
  const cell = (v: Vec2) => cellOf(v.z) * W + cellOf(v.x);
  const name = (i: number) => `step ${i + 1} (${def.steps[i].kind} "${def.steps[i].objective}")`;

  // Cells from which a survivor can press E on tile (tx,tz): itself if walkable, else 8 neighbours.
  const useCells = (x: number, z: number): number[] => {
    const tx = cellOf(x), tz = cellOf(z), out: number[] = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (L.inBounds(tx + dx, tz + dz)) out.push((tz + dz) * W + tx + dx);
    return out;
  };
  const best = (dist: Int16Array, cells: number[]) => cells.reduce((m, c) => Math.min(m, dist[c]), INF);

  let pos = cell(def.spawns[0]);
  if (L.solidAt(pos % W, (pos / W) | 0, 0)) errors.push('first spawn point is inside a wall');
  let pathTiles = 0, holdSeconds = 0;
  for (let i = 0; i < def.steps.length; i++) {
    const s = def.steps[i], open = L.doorsAfter(i);
    const dist = L.distanceField([pos], open);
    let d = INF, next = pos, note: string | undefined;
    if (s.kind === 'reach' || s.kind === 'gather') {
      if (!s.area) { errors.push(`${name(i)} has no area`); continue; }
      const cells: number[] = [];
      for (let z = s.area.z0; z <= s.area.z1; z++) for (let x = s.area.x0; x <= s.area.x1; x++) if (L.inBounds(x, z) && !L.solidAt(x, z, open)) cells.push(z * W + x);
      if (!cells.length) errors.push(`${name(i)}: area has no walkable tiles`);
      d = best(dist, cells);
      next = cells.find((c) => dist[c] === d) ?? pos;
      if (s.kind === 'gather' && s.checkpoint && cells.some((c) => def.floor[c] !== F.SAFE)) warnings.push(`${name(i)}: checkpoint area is not all SAFE floor (director keeps spawning there)`);
      if (s.kind === 'gather' && cells.length < 6) warnings.push(`${name(i)}: gather area is small (${cells.length} tiles) for 4 players`);
    } else if (s.kind === 'use') {
      const p = s.target !== undefined ? def.pickups[s.target] : undefined;
      if (!p || p.kind !== 'obj') { errors.push(`${name(i)}: target is not an obj pickup`); continue; }
      const cells = useCells(p.x, p.z).filter((c) => !L.solidAt(c % W, (c / W) | 0, open));
      d = best(dist, cells);
      next = cells.find((c) => dist[c] === d) ?? pos;
      if (s.hold) holdSeconds += s.hold;
    } else if (s.kind === 'collect') {
      const items = def.pickups.filter((p) => p.kind === 'item' && p.group === s.group);
      // Greedy tour through the items.
      let here = pos, tour = 0;
      const left = [...items];
      while (left.length) {
        const dd = L.distanceField([here], open);
        let bi = -1, bd = INF;
        left.forEach((p, k) => { const v = dd[cell(p)]; if (v < bd) { bd = v; bi = k; } });
        if (bi < 0) { errors.push(`${name(i)}: ${left.length} item(s) unreachable, e.g. tile ${cellOf(left[0].x)},${cellOf(left[0].z)}`); tour = INF; break; }
        tour += bd; here = cell(left[bi]); left.splice(bi, 1);
      }
      d = tour; next = here;
      note = `${items.length} items`;
    } else if (s.kind === 'holdout') {
      d = dist[cell(s.at)];
      next = cell(s.at);
      holdSeconds += s.hold ?? 0;
    }
    const reachable = d < INF;
    if (!reachable && s.kind !== 'collect') errors.push(`${name(i)} is unreachable from where the previous step ended (doors open: ${open.toString(2)})`);
    if (s.at && !L.inBounds(cellOf(s.at.x), cellOf(s.at.z))) errors.push(`${name(i)}: waypoint outside the map`);
    steps.push({ index: i, kind: s.kind, objective: s.objective, pathTiles: reachable ? d : -1, reachable, note });
    if (reachable) pathTiles += d;
    pos = next;
    if (s.checkpoint && !def.checkpointSpawns[i]) warnings.push(`${name(i)} is a checkpoint but not a gather step (team respawns at chapter start)`);
    if (s.objective.length > 40) warnings.push(`${name(i)}: objective longer than 40 chars`);
  }
  if (def.steps[def.steps.length - 1]?.kind !== 'gather') warnings.push('last step should be a gather (the exit)');

  // Safe rooms must be sealed: from inside, with the doors as they are once the room is in use,
  // no non-SAFE floor may be reachable (so zombies cannot walk in).
  const leak = (cells: number[], open: number): number => {
    const d = L.distanceField(cells, open);
    for (let c = 0; c < W * H; c++) if (d[c] < INF && def.floor[c] !== F.SAFE && def.doorCell[c] < 0) return c;
    return -1;
  };
  const tile = (c: number) => `${c % W},${(c / W) | 0}`;
  {
    const c = leak([cell(def.spawns[0])], 0);
    if (c >= 0) errors.push(`start safe room is not sealed before step 1 completes: reaches non-safe tile ${tile(c)}`);
  }
  def.steps.forEach((s, i) => {
    if (s.kind !== 'gather' || !s.checkpoint || !s.area) return;
    const cells: number[] = [];
    for (let z = s.area.z0; z <= s.area.z1; z++) for (let x = s.area.x0; x <= s.area.x1; x++) if (L.inBounds(x, z) && !L.solidAt(x, z, ALL_OPEN)) cells.push(z * W + x);
    for (const id of s.closes) {
      const d = def.doors[id];
      if (d && d.x0 <= s.area.x1 && d.x1 >= s.area.x0 && d.z0 <= s.area.z1 && d.z1 >= s.area.z0) errors.push(`${name(i)}: door ${id} it closes overlaps its own area`);
    }
    if (!cells.length) return;
    const c = leak(cells, L.doorsAfter(i + 1));
    if (c >= 0) errors.push(`${name(i)}: safe room is not sealed after the team gathers (reaches non-safe tile ${tile(c)}); close the entry door with \`closes\` and keep the exit shut until a later step`);
  });

  // Everything reachable with all doors open.
  const all = L.distanceField([cell(def.spawns[0])], ALL_OPEN);
  let walkable = 0, pockets = 0;
  for (let i = 0; i < W * H; i++) if (!def.solid[i] || def.doorCell[i] >= 0) { walkable++; if (all[i] >= INF) pockets++; }
  if (pockets) warnings.push(`${pockets} walkable tile(s) can never be reached`);
  for (const p of def.pickups) {
    if (p.kind === 'obj') continue;
    if (all[cell(p)] >= INF) errors.push(`${p.kind} pickup #${p.id} at tile ${cellOf(p.x)},${cellOf(p.z)} is unreachable or inside a prop`);
  }
  for (const n of def.notes) if (all[cell(n)] >= INF) errors.push(`note "${n.title}" at tile ${cellOf(n.x)},${cellOf(n.z)} is unreachable`);
  for (const sp of def.spawns) if (L.solidAt(cellOf(sp.x), cellOf(sp.z), 0)) errors.push(`spawn at ${sp.x},${sp.z} is solid`);
  for (const [k, pts] of Object.entries(def.checkpointSpawns)) for (const sp of pts) if (L.solidAt(cellOf(sp.x), cellOf(sp.z), ALL_OPEN)) errors.push(`checkpoint spawn for step ${+k + 1} is solid`);
  // Single-use loot: every safe room must be able to arm a full squad.
  const PRIMARY = new Set(WEAPONS.filter((w) => w.slot === 'primary').map((w) => w.id as string));
  const stock = (inRoom: (c: number) => boolean, where: string) => {
    let guns = 0, ammo = 0;
    for (const p of def.pickups) {
      if (!inRoom(cell(p))) continue;
      if (PRIMARY.has(p.kind)) guns++; else if (p.kind === 'ammo') ammo++;
    }
    if (guns < MIN_ROOM_GUNS || ammo < MIN_ROOM_AMMO) errors.push(`${where} stocks ${guns} primary guns and ${ammo} ammo piles; pickups are single-use, so it needs at least ${MIN_ROOM_GUNS} guns and ${MIN_ROOM_AMMO} ammo`);
  };
  {
    const room = L.distanceField([cell(def.spawns[0])], 0);
    stock((c) => room[c] < INF, 'start safe room');
  }
  def.steps.forEach((s, i) => {
    if (s.kind !== 'gather' || !s.checkpoint || !s.area) return;
    const a = s.area;
    stock((c) => { const x = c % W, z = (c / W) | 0; return x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1; }, `${name(i)} safe room`);
  });

  const usedDoors = new Set(def.steps.flatMap((s) => s.opens));
  for (const d of def.doors) if (!usedDoors.has(d.id)) warnings.push(`door ${d.id} at ${d.x0},${d.z0} is never opened`);

  const pickups: Record<string, number> = {};
  for (const p of def.pickups) pickups[p.kind] = (pickups[p.kind] ?? 0) + 1;
  const pathMetres = pathTiles * TILE;
  // Rough pacing model: careful co-op advance (fighting, looting, regrouping) runs 0.9–1.6 m/s,
  // plus holdouts and ~20–40 s of reading/regrouping per step.
  const n = def.steps.length;
  const estMinutes: [number, number] = [
    Math.round((pathMetres / 1.6 + holdSeconds + n * 20) / 60),
    Math.round((pathMetres / 0.9 + holdSeconds * 1.2 + n * 40) / 60),
  ];
  return {
    id: def.id, errors, warnings, steps,
    stats: { size: `${W}x${H}`, walkable, pathMetres, holdSeconds, estMinutes, checkpoints: def.steps.filter((s) => s.checkpoint).length, doors: def.doors.length, pickups, notes: def.notes.length },
  };
}
