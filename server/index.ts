// HTTP host + WebSocket game server on a single port.
// Dev: Vite runs as middleware (TS transpile + reload). Prod: serves ./dist.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { Room, type Player } from './room';
import { MAX_PLAYERS } from '../shared/constants';
import type { ClientMsg } from '../shared/protocol';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const PROD = process.env.NODE_ENV === 'production';
const DIST = path.join(ROOT, 'dist') + path.sep;
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

const serveDist: Handler = (req, res) => {
  let url: string;
  try { url = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  if (url === '/') url = '/index.html';
  const file = path.resolve(DIST, '.' + url);
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end('Not found'); return; }
    const hashed = url.startsWith('/assets/');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
};

let handler: Handler = serveDist;
const server = http.createServer((req, res) => {
  if (req.url === '/healthz') { res.writeHead(200).end('ok'); return; }
  handler(req, res);
});

if (PROD) {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('dist/ is missing. Run `npm run build` first.');
    process.exit(1);
  }
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ configFile: path.join(ROOT, 'vite.config.ts'), server: { middlewareMode: true, ws: { server } }, appType: 'spa' });
  handler = (req, res) => vite.middlewares(req, res);
}

const rooms = new Map<string, Room>();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode(): string {
  let c: string;
  do { c = Array.from({ length: 4 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join(''); } while (rooms.has(c));
  return c;
}

function findRoom(requested: unknown): Room {
  const code = String(requested ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (code) {
    let r = rooms.get(code);
    if (!r) { r = new Room(code); rooms.set(code, r); }
    return r;
  }
  // Quick play: any room with a free seat, otherwise a fresh one.
  for (const r of rooms.values()) if (r.players.size < MAX_PLAYERS) return r;
  const fresh = new Room(newCode());
  rooms.set(fresh.code, fresh);
  return fresh;
}

// noServer so Vite's HMR socket can share the same HTTP server in dev.
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
server.on('upgrade', (req, socket, head) => {
  if ((req.url ?? '').split('?')[0] !== '/ws') { if (PROD) socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

const alive = new WeakMap<WebSocket, boolean>();
wss.on('connection', (ws: WebSocket) => {
  let room: Room | null = null;
  let player: Player | null = null;
  alive.set(ws, true);
  ws.on('pong', () => alive.set(ws, true));
  ws.on('message', (raw) => {
    let m: ClientMsg;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (!player || !room) {
      if (m.t !== 'j') return;
      room = findRoom(m.room);
      const name = String(m.name ?? '').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 14);
      player = room.addPlayer(ws, name);
      if (!player) {
        ws.send(JSON.stringify({ t: 'err', msg: `Room ${room.code} is full (${MAX_PLAYERS} players max).` }));
        ws.close();
      }
      return;
    }
    try { room.onMessage(player, m); } catch (e) { console.error('message error', e); }
  });
  ws.on('close', () => {
    if (!player || !room) return;
    room.removePlayer(player);
    if (room.players.size === 0) { room.destroy(); rooms.delete(room.code); }
  });
  ws.on('error', () => {});
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.get(ws)) { ws.terminate(); continue; }
    alive.set(ws, false); ws.ping();
  }
}, 15000);

server.listen(PORT, () => console.log(`Chibi Outbreak (${PROD ? 'production' : 'dev'}) running at http://localhost:${PORT}`));
