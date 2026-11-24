// Dev check for a chapter's Big Hold On, server only (no browser): runs the hold with n invulnerable
// survivors at the stand who kill the nearest zombie a few times a second, then prints where the
// commons spawned (per lane), how close any came to a gun, the summary line and whether the escape
// started. Usage: npx tsx scripts/bighold-sim.ts <chapterIndex 0-3> [players, default "2,4"]
import { Room } from '../server/room';
const ws = () => ({ send() {}, readyState: 1, close() {}, on() {} }) as any;
const ch = Number(process.argv[2] ?? 0), counts = (process.argv[3] ?? '2,4').split(',').map(Number);
for (const n of counts) {
  const r = new Room('SIM' + n, ch, false) as any; r.destroy();
  const def = r.def, bi = def.steps.findIndex((s: any) => s.big), s = def.steps[bi];
  for (let k = 0; k < n; k++) r.addPlayer(ws(), 'bot' + k);
  r.doors = r.L.doorsAfter(bi); r.step = bi; r.state = 'play';
  for (const z of [...r.zombies.keys()]) r.zombies.delete(z);
  const place = () => { for (const p of r.players.values()) { p.hp = 100; p.st = 0; p.pinned = 0; p.x = s.at.x; p.z = s.at.z + 2; p.y = p.gy = s.at.y; p.node = r.L.nodeAt(p.x, p.y, p.z); } };
  place();
  r.startHoldout(s);
  const lanes = s.lanes ?? {}, byLane: Record<string, number> = {}, seen = new Set<number>();
  let gunMin = Infinity, kills = 0, t = 0, brutes = 0;
  const laneOf = (z: any) => { const x = Math.floor(z.x / 2), q = Math.floor(z.z / 2); for (const [k, rs] of Object.entries(lanes) as any) if (rs.some((a: any) => x >= a.x0 && x <= a.x1 && q >= a.z0 && q <= a.z1)) return k; return 'outside'; };
  for (; t < 30 * 260 && r.step === bi; t++) {
    place();
    // Gates: collect the step's items and stand in gate areas as soon as the timer stops.
    const g = s.gates?.[r.hs.gate];
    if (g && r.hs.total - r.holdout >= g.at) {
      if (g.items !== undefined) r.collected = Math.max(r.collected, g.items);
      if (g.area) { const p = [...r.players.values()][0]; p.x = (g.area.x0 + g.area.x1 + 1); p.z = (g.area.z0 + g.area.z1 + 1); p.y = p.gy = (g.area.lv ?? 0) * 4.2; }
    }
    if (t % 8 === 0) for (let k = 0; k < n; k++) { let best: any = null, bd = 1e9; for (const z of r.zombies.values()) { if (z.dormant) continue; const d = Math.hypot(z.x - s.at.x, z.z - s.at.z); if (d < bd) { bd = d; best = z; } } if (best && bd < 40) { r.damageZombie(best, 1e5, null, false); kills++; } }
    r.tick(1 / 30);
    for (const z of r.zombies.values()) {
      if (seen.has(z.id) || z.dormant) continue; seen.add(z.id);
      if (z.type === 3) brutes++;
      const l = laneOf(z); byLane[l] = (byLane[l] ?? 0) + 1;
      for (const m of def.mounts) gunMin = Math.min(gunMin, Math.hypot(m.x - z.x, m.z - z.z));
    }
  }
  console.log(`ch${ch + 1} ${n}p: hold ${(t / 30).toFixed(0)} s, step ${bi + 1} -> ${r.step + 1}, escape ${!!r.escape}, spawns by lane ${JSON.stringify(byLane)}, closest spawn to a gun ${gunMin.toFixed(0)} m, brutes ${brutes}, stat ${JSON.stringify({ ...r.hs.stat, t0: undefined, kills: undefined })}`);
}
process.exit(0);
