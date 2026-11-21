// Headless end-to-end check: boots the server, joins two bots, walks one out
// of the safe room and verifies zombies wake, take damage and hurt players,
// then plays chapter 1's quest start to finish (teleporting between steps).
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { getLevel } from '../shared/chapters';
import { F, cellOf } from '../shared/level';
import { TILE, PSTATE, ZT, WEAPONS, weaponIndex } from '../shared/constants';
import type { ClientMsg, GameEvent, ServerMsg } from '../shared/protocol';

// Random port so parallel runs (e.g. several agents) do not collide.
const PORT = Number(process.env.SMOKE_PORT) || 4000 + Math.floor(Math.random() * 900);
const server = spawn('npx', ['tsx', 'server/index.ts'], { env: { ...process.env, PORT: String(PORT), HOLDOUT_SCALE: '0.03' }, stdio: ['ignore', 'pipe', 'inherit'] });
const L = getLevel(0), MAP = L.def;
const fail = (msg: string): never => { console.error('FAIL:', msg); server.kill(); process.exit(1); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Bot { ws: WebSocket; id: number; room: string; snap: Extract<ServerMsg, { t: 's' }> | null; events: GameEvent[]; send(m: ClientMsg): void }
function bot(name: string, room: string): Promise<Bot> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    const b: Bot = { ws, id: 0, room: '', snap: null, events: [], send: (m) => ws.send(JSON.stringify(m)) };
    ws.on('open', () => b.send({ t: 'j', name, room, ch: 0 }));
    ws.on('error', reject);
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString()) as ServerMsg;
      if (m.t === 'w') { b.id = m.id; b.room = m.room; resolve(b); }
      else if (m.t === 's') { b.snap = m; b.events.push(...m.ev); }
    });
  });
}

await new Promise<void>((resolve) => server.stdout!.on('data', (d: Buffer) => { if (d.toString().includes('running at')) resolve(); }));
const page = await fetch(`http://localhost:${PORT}/`).then((r) => r.text());
if (!page.includes('Chibi Outbreak')) fail('index.html not served');

const a = await bot('Alpha', 'TEST');
const b = await bot('Beta', 'TEST');
if (a.room !== 'TEST' || a.id === b.id) fail('room join');
await sleep(300);
if (a.snap?.p.length !== 2) fail(`expected 2 players, saw ${a.snap?.p.length}`);
const dormant = a.snap!.z.length;
if (dormant < 10) fail(`expected wandering zombies, saw ${dormant}`);
console.log(`ok: 2 players joined room ${a.room}, ${dormant} wanderers placed`);

// Pick up the first weapon and medkit in the chapter.
const gun = MAP.pickups.find((p) => p.kind === 'smg' || p.kind === 'shotgun' || p.kind === 'rifle')!;
const kit = MAP.pickups.find((p) => p.kind === 'medkit')!;
a.send({ t: 'p', x: gun.x, y: 0, z: gun.z, ry: 0, rx: 0, w: 0, a: 0 });
await sleep(100);
a.send({ t: 'u', id: gun.id });
a.send({ t: 'p', x: kit.x, y: 0, z: kit.z, ry: 0, rx: 0, w: 1, a: 0 });
await sleep(100);
a.send({ t: 'u', id: kit.id });
await sleep(200);
if (!a.events.some((e) => e[0] === 'got' && e[1] === a.id)) fail('pickup not granted');
if (!b.events.some((e) => e[0] === 'pk' && e[1] === gun.id)) fail('weapon pickup did not disappear for teammates');
b.send({ t: 'p', x: gun.x, y: 0, z: gun.z, ry: 0, rx: 0, w: 0, a: 0 });
await sleep(100);
b.send({ t: 'u', id: gun.id });
await sleep(200);
if (b.events.some((e) => e[0] === 'got' && e[1] === b.id && e[2] === gun.id)) fail('a taken weapon was granted twice');
if (a.snap!.p.find((p) => p[0] === a.id)![9] !== 1) fail('medkit not carried');
console.log('ok: pickups work');

// Start rooms are sealed until step 1 (usually "use the radio") opens the door: do that first.
const first = MAP.steps[0];
if (first.kind === 'use') {
  const t = MAP.pickups[first.target!];
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    if (L.solidAt(cellOf(t.x) + dx, cellOf(t.z) + dz, 0)) continue;
    a.send({ t: 'p', x: t.x + dx * TILE, y: 0, z: t.z + dz * TILE, ry: 0, rx: 0, w: 1, a: 0 }); break;
  }
  await sleep(100);
  a.send({ t: 'u', id: t.id });
  await sleep(300);
  if (a.snap!.q !== 1) fail('first quest step (use) did not complete');
}
// Walk Alpha out of the safe room (a cell ~12 tiles away, not safe floor) and wait for the horde to engage.
const field = L.distanceField([cellOf(MAP.spawns[0].z) * L.W + cellOf(MAP.spawns[0].x)], L.doorsAfter(1));
let outside = -1;
for (let i = 0; i < field.length; i++) if (field[i] >= 12 && field[i] < 16 && MAP.floor[i] !== F.SAFE && !MAP.solid[i]) { outside = i; break; }
if (outside < 0) fail('no open cell near the start');
const pos = { x: (outside % L.W + 0.5) * TILE, z: (Math.floor(outside / L.W) + 0.5) * TILE };
const walk = setInterval(() => a.send({ t: 'p', x: pos.x, y: 0, z: pos.z, ry: Math.PI, rx: 0, w: 1, a: 0 }), 50);
let hurt = false, kills = 0;
for (let i = 0; i < 400 && !(hurt && kills >= 3); i++) {
  await sleep(50);
  hurt ||= a.events.some((e) => e[0] === 'hurt' && e[1] === a.id);
  // Shoot whatever is closest (claims a head hit, as the real client would).
  const near = a.snap!.z.filter((z) => Math.hypot(z[2] - pos.x, z[3] - pos.z) < 12).sort((p, q) => Math.hypot(p[2] - pos.x, p[3] - pos.z) - Math.hypot(q[2] - pos.x, q[3] - pos.z))[0];
  if (near && hurt) a.send({ t: 'f', w: 1, h: [[near[0], 0, 1]], e: [near[2], 1, near[3]] });
  kills = a.events.filter((e) => e[0] === 'zdie' && e[6] === a.id).length;
}
clearInterval(walk);
if (!hurt) fail('zombies never reached the player');
if (kills < 3) fail(`expected kills, got ${kills}`);
if (!b.events.some((e) => e[0] === 'shot' && e[1] === a.id)) fail('shots not relayed to teammate');
console.log(`ok: zombies attacked, ${kills} killed, shots relayed`);

// New weapons: a Kebabber round through two walkers in a line, then a Bloop Tube grenade.
const SNIPER = weaponIndex('sniper'), LAUNCHER = weaponIndex('launcher');
const hold = () => a.send({ t: 'p', x: pos.x, y: 0, z: pos.z, ry: Math.PI, rx: 0, w: SNIPER, a: 0 });
const walkersInSight = () => a.snap!.z
  .filter((z) => z[1] === ZT.WALKER && Math.hypot(z[2] - pos.x, z[3] - pos.z) < 30 && L.hasLOS(pos.x, pos.z, z[2], z[3], a.snap!.g))
  .sort((p, q) => Math.hypot(p[2] - pos.x, p[3] - pos.z) - Math.hypot(q[2] - pos.x, q[3] - pos.z));
let pierced = false;
for (let i = 0; i < 80 && !pierced; i++) {
  hold();
  const w = walkersInSight();
  if (w.length < 2) { await sleep(100); continue; }
  const near = w[0], far = w[w.length - 1];
  a.send({ t: 'f', w: SNIPER, h: [[near[0], 1, 0], [far[0], 1, 0]], e: [far[2], 1, far[3]] });
  await sleep(500);
  pierced = a.events.some((e) => e[0] === 'zdie' && e[1] === far[0] && e[6] === a.id);
}
if (!pierced) fail('a piercing Kebabber round did not kill the second walker in line');
let boomed = false;
for (let i = 0; i < 80 && !boomed; i++) {
  hold();
  const t = walkersInSight()[0];
  if (!t) { await sleep(100); continue; }
  a.send({ t: 'g', x: t[2], y: 0.1, z: t[3] }); // no grenade in flight: ignored
  await sleep(150);
  if (a.events.some((e) => e[0] === 'blast')) fail('a grenade impact claim without a launch was accepted');
  await sleep(250);
  // Like the real client: number the shell, and claim the impact only after its time of flight.
  const seq = i + 1, flight = Math.hypot(t[2] - pos.x, t[3] - pos.z) / WEAPONS[LAUNCHER].blast!.speed;
  a.send({ t: 'f', w: LAUNCHER, h: [], e: [t[2], 0.1, t[3]], n: seq });
  await sleep(flight * 1000 + 80);
  a.send({ t: 'g', x: t[2], y: 0.1, z: t[3], n: seq });
  await sleep(250);
  if (!a.events.some((e) => e[0] === 'blast' && e[1] === a.id)) fail('grenade blast not applied');
  boomed = a.events.some((e) => e[0] === 'zdie' && e[1] === t[0] && e[6] === a.id);
  if (!boomed) fail('the grenade did not kill the walker at ground zero');
}
if (!boomed) fail('no walker in sight for the grenade test');
console.log('ok: piercing sniper round and grenade blast validated');

// Let Alpha go down, then have Beta revive.
for (let i = 0; i < 600; i++) {
  await sleep(50);
  a.send({ t: 'p', x: pos.x, y: 0, z: pos.z, ry: Math.PI, rx: 0, w: 1, a: 0 });
  if (a.snap!.p.find((p) => p[0] === a.id)![7] === PSTATE.DOWN) break;
}
if (a.snap!.p.find((p) => p[0] === a.id)![7] !== PSTATE.DOWN) fail('player never went down');
b.send({ t: 'p', x: pos.x + 1, y: 0, z: pos.z, ry: 0, rx: 0, w: 0, a: 0 });
b.send({ t: 'r', id: a.id });
let revived = false;
for (let i = 0; i < 100 && !revived; i++) {
  await sleep(50);
  b.send({ t: 'p', x: pos.x + 1, y: 0, z: pos.z, ry: 0, rx: 0, w: 0, a: 0 });
  // Beta keeps the area clear while helping (head-shot claims with the pistol).
  const near = b.snap!.z.filter((z) => Math.hypot(z[2] - pos.x, z[3] - pos.z) < 10)[0];
  if (near) b.send({ t: 'f', w: 0, h: [[near[0], 0, 1]], e: [near[2], 1, near[3]] });
  revived = a.events.some((e) => e[0] === 'revived' && e[1] === a.id);
}
if (!revived) fail(`revive did not complete: beta state ${b.snap!.p.find((p) => p[0] === b.id)![7]}, alpha ${a.snap!.p.find((p) => p[0] === a.id)![7]}, zombies near ${a.snap!.z.filter((z) => Math.hypot(z[2] - pos.x, z[3] - pos.z) < 3).length}`);
console.log('ok: down + revive work');

// Quest: play every step of the chapter, teleporting the bots where each step needs them.
const stay = (bot: Bot, x: number, z: number) => bot.send({ t: 'p', x, y: 0, z, ry: 0, rx: 0, w: 0, a: 0 });
const both = (x: number, z: number) => { stay(a, x, z); stay(b, x + 0.4, z); };
const curStep = () => a.snap!.q;
const tileFree = (x: number, z: number) => !L.solidAt(cellOf(x), cellOf(z), a.snap!.g);
/** A walkable spot next to a solid objective machine. */
const besideObj = (x: number, z: number) => {
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) if (tileFree(x + dx * TILE, z + dz * TILE)) return { x: x + dx * TILE, z: z + dz * TILE };
  return { x, z };
};
let won = false;
for (let guard = 0; guard < 2000 && !won; guard++) {
  const i = curStep(), s = MAP.steps[i];
  // Keep both bots alive through the quest (revive if a stray zombie downed someone).
  for (const [bot, other] of [[a, b], [b, a]] as const) if (bot.snap!.p.find((p) => p[0] === other.id)?.[7] === PSTATE.DOWN) bot.send({ t: 'r', id: other.id });
  if (s.kind === 'reach' || s.kind === 'gather') {
    const ar = s.area!;
    let x = (ar.x0 + ar.x1 + 1) / 2 * TILE, z = (ar.z0 + ar.z1 + 1) / 2 * TILE;
    if (!tileFree(x, z)) for (let tz = ar.z0; tz <= ar.z1; tz++) for (let tx = ar.x0; tx <= ar.x1; tx++) if (!L.solidAt(tx, tz, a.snap!.g)) { x = (tx + 0.5) * TILE; z = (tz + 0.5) * TILE; }
    both(x, z);
  } else if (s.kind === 'use') {
    const t = MAP.pickups[s.target!], at = besideObj(t.x, t.z);
    both(at.x, at.z);
    await sleep(60);
    a.send({ t: 'u', id: t.id });
  } else if (s.kind === 'collect') {
    const item = MAP.pickups.find((p) => p.kind === 'item' && p.group === s.group && !a.events.some((e) => e[0] === 'pk' && e[1] === p.id));
    if (item) { both(item.x, item.z); await sleep(60); a.send({ t: 'u', id: item.id }); }
  } else both(s.at.x, s.at.z);
  await sleep(80);
  won = a.events.some((e) => e[0] === 'end' && e[1] === 1);
  if (a.events.some((e) => e[0] === 'end' && e[1] === 0)) fail(`squad wiped during quest step ${i + 1}`);
}
if (!won) fail(`quest stalled at step ${curStep() + 1}: ${MAP.steps[curStep()]?.objective}`);
const end = a.events.find((e) => e[0] === 'end' && e[1] === 1)!;
if (end[5] !== 1 % 1 && end[5] === undefined) fail('win did not name the next chapter');
console.log(`ok: all ${MAP.steps.length} quest steps of "${MAP.title}" completed, chapter won`);

// Lobby: listed rooms, and creating a room that starts in a chapter's first checkpoint safe room.
const cpStep = MAP.steps.findIndex((s) => s.kind === 'gather' && s.checkpoint);
const c = await new Promise<Bot>((resolve, reject) => {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const bt: Bot = { ws, id: 0, room: '', snap: null, events: [], send: (m) => ws.send(JSON.stringify(m)) };
  ws.on('open', () => bt.send({ t: 'j', name: 'Gamma', room: '', create: true, ch: 0, cp: cpStep }));
  ws.on('error', reject);
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString()) as ServerMsg;
    if (m.t === 'w') { bt.id = m.id; bt.room = m.room; if (m.step !== cpStep + 1) fail(`safe-room start began at step ${m.step}, expected ${cpStep + 1}`); resolve(bt); }
    else if (m.t === 's') { bt.snap = m; bt.events.push(...m.ev); }
  });
});
await sleep(300);
const me3 = c.snap!.p.find((p) => p[0] === c.id)!;
if (!L.inRect(me3[1], me3[3], MAP.steps[cpStep].area!)) fail('safe-room start did not spawn the player inside the safe room');
const listed = await fetch(`http://localhost:${PORT}/api/rooms`).then((r) => r.json()) as { code: string; step: number }[];
if (!listed.some((r) => r.code === c.room && r.step === cpStep + 2)) fail(`room list does not show the new room: ${JSON.stringify(listed)}`);
console.log(`ok: room list works; new room ${c.room} started in safe room (step ${cpStep + 1})`);
c.ws.close();

a.ws.close(); b.ws.close();
await sleep(200);
server.kill();
console.log('SMOKE TEST PASSED');
process.exit(0);
