// Dev check for HoldGates (Step.gates: Bertha's crank in ch3, the lift's power cells in ch2), in process, no network.
// For every chapter with an area gate, at the first gate:
//   - snapshots carry `gt` while the timer is stopped, and not before;
//   - the hold script can't start the next stage while it is stopped (no Brute or final for a team that hasn't
//     found the crank), and the feed line repeats;
//   - leaving the spot drains the progress rather than resetting it;
//   - standing on it for `secs` restarts the timer and `gt` goes away.
// Exit code 1 on failure. Usage: npx tsx scripts/check-gates.ts
import { CHAPTERS, getLevel } from '../shared/chapters';
import { TICK_HZ, TILE, STOREY } from '../shared/constants';
import type { GameEvent, ServerMsg } from '../shared/protocol';
import { Room } from '../server/room';
import { HOLD_SCALE } from '../server/tuning';

let failed = 0, tested = 0;
const fail = (msg: string) => { console.error('FAIL:', msg); failed++; };
const DT = 1 / TICK_HZ;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

for (let ch = 0; ch < CHAPTERS.length; ch++) {
  const def = getLevel(ch).def, bi = def.steps.findIndex((s) => s.gates?.some((g) => g.area));
  if (bi < 0) continue;
  const s = def.steps[bi], g = s.gates![0], name = `ch${ch + 1}`;
  if (!g.area) { console.log(`${name}: first gate is not an area gate, skipped`); continue; }
  let last: ServerMsg & { t: 's' } | null = null;
  const events: GameEvent[] = [];
  const ws = { readyState: 1, send(raw: string) { const m = JSON.parse(raw) as ServerMsg; if (m.t === 's') { last = m; events.push(...m.ev); } } };
  const r = new Room(`G${ch}`, ch, true) as Any;
  r.destroy();
  const p = r.addPlayer(ws as Any, 'Tester');
  r.onMessage(p, { t: 'dbgf', god: 1, calm: 1 });
  r.doors = r.L.doorsAfter(bi); r.step = bi; r.state = 'play';
  const away = { x: s.at.x, z: s.at.z, y: s.at.y ?? 0 };
  const spot = { x: ((g.area.x0 + g.area.x1 + 1) / 2) * TILE, z: ((g.area.z0 + g.area.z1 + 1) / 2) * TILE, y: (g.area.lv ?? 0) * STOREY };
  const put = (q: { x: number; z: number; y: number }) => { p.x = q.x; p.z = q.z; p.y = p.gy = q.y; p.hp = 100; p.st = 0; p.pinned = 0; r.place(p); };
  // The player stands at the step's spot, which must not be in the gate's area.
  put(away);
  if (r.L.inRect(p.x, p.y, p.z, g.area)) { fail(`${name}: the step's waypoint is inside the gate area; pick another 'away' spot`); continue; }
  r.startHoldout(s);
  const tick = (secs: number, at = away) => { for (let i = 0; i < Math.round(secs / DT); i++) { put(at); r.tick(DT); } };
  const gt = () => (last as Any)?.gt as [number, number, number] | undefined;

  tick(g.at * HOLD_SCALE - 1);
  if (gt()) fail(`${name}: gt in the snapshot before the gate`);
  tick(1.5);
  if (!gt()) { fail(`${name}: no gt once the gate stopped the timer`); continue; }
  const stalledAt = r.holdout, stage = r.hs.i, msgs = () => events.filter((e) => e[0] === 'msg' && e[1] === g.msg).length;
  // Nobody cranks for long enough that the script would otherwise have moved on twice.
  tick(60);
  if (Math.abs(r.holdout - stalledAt) > 0.01) fail(`${name}: the timer ran while stalled (${stalledAt} -> ${r.holdout})`);
  const cap = r.hs.ends.find((e: number) => e > g.at * HOLD_SCALE);
  if (r.hs.i > stage + 1 || (cap !== undefined && r.hs.run >= cap)) fail(`${name}: the hold script moved past the stage the gate stopped in (stage ${stage} -> ${r.hs.i}, run ${r.hs.run.toFixed(1)}, cap ${cap})`);
  const held = r.hs.i;
  if (msgs() < 3) fail(`${name}: the gate's feed line said ${msgs()} times in 60 s; it should repeat while nobody is on it`);
  // Half the crank, then knocked off for a second: progress drains, not resets.
  const secs = g.secs ?? 0;
  tick(secs / 2, spot);
  const half = gt()?.[1] ?? 0;
  if (gt()?.[2] !== p.id) fail(`${name}: gt doesn't name the survivor on the spot`);
  tick(0.5);
  const after = gt()?.[1] ?? 0;
  if (!(after > 0 && after < half)) fail(`${name}: progress ${half} -> ${after} after 0.5 s off the spot; it should drain, not reset or hold`);
  tick(secs, spot);
  tick(0.5);
  if (gt()) fail(`${name}: still stalled after ${secs} s on the spot`);
  else if (!(r.holdout < stalledAt - 0.2)) fail(`${name}: the timer didn't restart after the crank`);
  else console.log(`ok: ${name} "${s.objective}": gate at ${g.at} s stops the timer, holds the script at stage ${held}, repeats its line, drains progress, restarts after ${secs} s on the spot`);
  tested++;
}
if (!tested) fail('no chapter has an area gate');
if (failed) { console.error(`${failed} gate check(s) failed`); process.exit(1); }
console.log('GATE CHECK PASSED');
process.exit(0);
