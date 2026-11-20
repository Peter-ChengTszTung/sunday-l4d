// Headless end-to-end check: boots the server, joins two bots, walks one out
// of the safe room and verifies zombies wake, take damage and hurt players.
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { MAP } from '../shared/map';
import { TILE, PSTATE } from '../shared/constants';
import type { ClientMsg, GameEvent, ServerMsg } from '../shared/protocol';

const PORT = 3999;
const server = spawn('npx', ['tsx', 'server/index.ts'], { env: { ...process.env, PORT: String(PORT), HOLDOUT_SECONDS: '2' }, stdio: ['ignore', 'pipe', 'inherit'] });
const fail = (msg: string): never => { console.error('FAIL:', msg); server.kill(); process.exit(1); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Bot { ws: WebSocket; id: number; room: string; snap: Extract<ServerMsg, { t: 's' }> | null; events: GameEvent[]; send(m: ClientMsg): void }
function bot(name: string, room: string): Promise<Bot> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    const b: Bot = { ws, id: 0, room: '', snap: null, events: [], send: (m) => ws.send(JSON.stringify(m)) };
    ws.on('open', () => b.send({ t: 'j', name, room }));
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

// Pick up the SMG and a medkit.
a.send({ t: 'p', x: 19.5 * TILE, y: 0, z: 3.5 * TILE, ry: 0, rx: 0, w: 0, a: 0 });
await sleep(100);
a.send({ t: 'u', id: MAP.pickups.find((p) => p.kind === 'smg')!.id });
a.send({ t: 'p', x: 18.5 * TILE, y: 0, z: 6.5 * TILE, ry: 0, rx: 0, w: 1, a: 0 });
await sleep(100);
a.send({ t: 'u', id: MAP.pickups.find((p) => p.kind === 'medkit')!.id });
await sleep(200);
if (!a.events.some((e) => e[0] === 'got' && e[1] === a.id)) fail('pickup not granted');
if (a.snap!.p.find((p) => p[0] === a.id)![9] !== 1) fail('medkit not carried');
console.log('ok: pickups work');

// Walk Alpha into the street and wait for the horde to engage.
const pos = { x: 22 * TILE, z: 14 * TILE };
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
  revived = a.events.some((e) => e[0] === 'revived' && e[1] === a.id);
}
if (!revived) fail('revive did not complete (Beta may have been downed too)');
console.log('ok: down + revive work');

// Finale: start the generator, wait out the (shortened) holdout, reach the safe house.
const gen = MAP.pickups.find((p) => p.kind === 'gen')!;
const stay = (bot: Bot, x: number, z: number) => bot.send({ t: 'p', x, y: 0, z, ry: 0, rx: 0, w: 0, a: 0 });
if (a.snap!.g !== 0) fail('gate should start closed');
stay(a, gen.x - 2, gen.z + 2); stay(b, gen.x - 2, gen.z + 2);
await sleep(150);
a.send({ t: 'u', id: gen.id });
await sleep(300);
if (!a.events.some((e) => e[0] === 'holdstart')) fail('generator did not start the holdout');
let open = false;
for (let i = 0; i < 80 && !open; i++) { await sleep(50); stay(a, gen.x - 2, gen.z + 2); stay(b, gen.x - 2, gen.z + 2); open = a.snap!.g === 1; }
if (!open) fail('gate never opened');
const ex = (MAP.endCell.x + 0.5) * TILE, ez = (MAP.endCell.z + 0.5) * TILE;
let won = false;
for (let i = 0; i < 40 && !won; i++) { stay(a, ex, ez); stay(b, ex + 1, ez); await sleep(50); won = a.events.some((e) => e[0] === 'end' && e[1] === 1); }
if (!won) fail('reaching the safe house did not win the run');
console.log('ok: generator → holdout → gate → safe house wins');

a.ws.close(); b.ws.close();
await sleep(200);
server.kill();
console.log('SMOKE TEST PASSED');
process.exit(0);
