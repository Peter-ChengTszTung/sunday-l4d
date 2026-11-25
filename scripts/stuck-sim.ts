// Dev check: do zombies reach the survivors from everywhere? Survivors stand (god mode) at a step's
// spot; one zombie at a time is spawned on sampled reachable tiles and given `secs` to come within
// reach. Prints, per type, how many never arrived and where they ended up.
// Usage: npx tsx scripts/stuck-sim.ts <chapterIndex 0-3> [step index, default the Big Hold On] [types, default "0,3,2,4"] [samples, default 120]
import { Room } from '../server/room';
import { ZTYPES } from '../shared/constants';
const ws = () => ({ send() {}, readyState: 1, close() {}, on() {} }) as any;
const ch = Number(process.argv[2] ?? 0);
const r = new Room('STUCK', ch, false) as any; r.destroy();
const def = r.def, bi = process.argv[3] && process.argv[3] !== '-' ? Number(process.argv[3]) : def.steps.findIndex((s: any) => s.big), s = def.steps[bi];
const types = (process.argv[4] ?? '0,3,2,4').split(',').map(Number), samples = Number(process.argv[5] ?? 120), secs = 30;
for (let k = 0; k < 2; k++) r.addPlayer(ws(), 'bot' + k);
r.doors = r.L.doorsAfter(bi); r.step = bi; r.state = 'play'; r.dbgGod = true; r.dbgCalm = true;
const at = s.at ?? { x: def.spawns[0].x, y: def.spawns[0].y ?? 0, z: def.spawns[0].z };
const place = () => { let i = 0; for (const p of r.players.values()) { p.hp = 100; p.st = 0; p.pinned = 0; p.x = at.x + i++ * 0.8; p.z = at.z; p.y = p.gy = at.y; p.node = r.L.nodeAt(p.x, p.y, p.z); } };
place(); r.recomputeFlow();
const cand: number[] = [];
for (let n = 0; n < r.flow.length; n++) if (r.flow[n] >= 4 && r.flow[n] < 60) cand.push(n);
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = Array.from({ length: Math.min(samples, cand.length) }, () => cand[Math.floor(rnd() * cand.length)]);
for (const ty of types) {
  const fails: string[] = [];
  for (const n of pick) {
    for (const z of [...r.zombies.keys()]) r.zombies.delete(z);
    const c = r.L.centre(n);
    const z = r.spawnZombie(ty, c.x, c.y, c.z); z.dbg = true; z.sp = 999; z.leapCd = 999;
    let ok = false, best = Infinity;
    for (let t = 0; t < secs * 30; t++) {
      place(); r.tick(1 / 30);
      if (!r.zombies.has(z.id)) { ok = true; break; }
      let d = Infinity; for (const p of r.players.values()) d = Math.min(d, Math.hypot(p.x - z.x, p.z - z.z, p.gy - z.y));
      best = Math.min(best, d);
      if (d < ZTYPES[ty].range + 0.6) { ok = true; break; }
    }
    if (!ok) fails.push(`from (${(c.x / 2) | 0},${(c.z / 2) | 0},lv${r.L.lvOf(n)}) flow ${r.flow[n]} -> stuck at (${(z.x / 2).toFixed(1)},${(z.z / 2).toFixed(1)}) flow ${r.flow[r.nodeOf(z)]} closest ${best.toFixed(1)} m`);
  }
  console.log(`ch${ch + 1} step ${bi + 1} ${ZTYPES[ty].id} (r ${ZTYPES[ty].radius}): ${fails.length}/${pick.length} never arrived`);
  for (const f of fails.slice(0, 8)) console.log('   ' + f);
}
process.exit(0);
