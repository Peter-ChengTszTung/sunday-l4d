// Turns the shared grid map into cel-shaded scenery.
import * as pc from 'playcanvas';
import { TILE, CEIL_H } from '../../shared/constants';
import { MAP, F, hash2, type Pickup } from '../../shared/map';
import { type Geo, box, sphere, cylinder, ring, make, merge, trs, toMesh } from './geo';
import { app, device, Batch, toonMat, makeToon, makeUnlit, meshEntity, inkBox, canvasTexture, setTint, rgb, INK } from './gfx';
import { buildGun } from './viewmodel';

const { W, H } = MAP;
const T = TILE;
const BUILDING_COLORS = [0x8e6fa8, 0x5f8fa8, 0xc77b6b, 0x6f7fb8, 0xb58a5f, 0x7f6f9a, 0x5fa39a, 0xa86f8e];
const INTERIOR_WALL = 0x6f8fa3, SAFE_WALL = 0xe0884f;
const isInterior = (f: number) => f === F.INTERIOR || f === F.SAFE_A || f === F.SAFE_B || f === F.GATE;
const floorOf = (x: number, z: number) => (x < 0 || z < 0 || x >= W || z >= H ? F.NONE : MAP.floor[z * W + x]);
const isWall = (x: number, z: number) => floorOf(x, z) === F.NONE;
const newGeo = (): Geo => ({ pos: [], nor: [], col: [], uv: [], idx: [] });
const add = (e: pc.Entity) => { app.root.addChild(e); return e; };

export interface PickupView { def: Pickup; group: pc.Entity; float: pc.Entity; taken: boolean }
export interface World {
  pickups: PickupView[];
  setGate(open: boolean, instant?: boolean): void;
  setTaken(id: number, taken: boolean): void;
  setGenerator(active: boolean): void;
  update(t: number, dt: number, camX: number, camY: number, camZ: number): void;
}

function faceHeight(x: number, z: number, dx: number, dz: number): number {
  // 0 when (x,z) has no visible face towards (dx,dz).
  if (x < 0 || z < 0 || x >= W || z >= H || !isWall(x, z)) return 0;
  const nf = floorOf(x + dx, z + dz);
  if (nf === F.NONE) return 0;
  return isInterior(nf) ? CEIL_H : MAP.wallH[z * W + x];
}

/** Ink strokes are real geometry: a thin axis-aligned beam per line segment. */
function beam(g: Geo, ax: number, ay: number, az: number, bx: number, by: number, bz: number, t = 0.035): void {
  const x0 = Math.min(ax, bx) - t, x1 = Math.max(ax, bx) + t, y0 = Math.min(ay, by) - t, y1 = Math.max(ay, by) + t, z0 = Math.min(az, bz) - t, z1 = Math.max(az, bz) + t;
  const b = g.pos.length / 3;
  g.pos.push(x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1);
  g.idx.push(...[0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 6, 2, 3, 7, 6, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5].map((i) => b + i));
}

function buildWalls(): void {
  const walls = newGeo(), flat = newGeo(), ink = newGeo();
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const quadFlat = (c: [number, number, number], p: number[]) => {
    const b = flat.pos.length / 3;
    flat.pos.push(...p);
    for (let i = 0; i < 4; i++) flat.col.push(c[0], c[1], c[2]);
    flat.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };

  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    if (!isWall(x, z)) continue;
    for (let di = 0; di < 4; di++) {
      const [dx, dz] = DIRS[di];
      const h = faceHeight(x, z, dx, dz);
      if (!h) continue;
      const nf = floorOf(x + dx, z + dz);
      const tx = -dz, tz = dx;
      const mx = (x + 0.5 + dx * 0.5) * T, mz = (z + 0.5 + dz * 0.5) * T;
      const p0x = mx - tx * T / 2, p0z = mz - tz * T / 2, p1x = mx + tx * T / 2, p1z = mz + tz * T / 2;
      const interior = isInterior(nf);
      const chunk = hash2(Math.floor(x / 3) + 91, Math.floor(z / 3) + 17);
      const c = rgb(interior ? (nf === F.INTERIOR || nf === F.GATE ? INTERIOR_WALL : SAFE_WALL) : BUILDING_COLORS[Math.floor(chunk * BUILDING_COLORS.length)]);
      const k = interior ? 0.8 : 0.72; // darker towards the ground
      const base = walls.pos.length / 3;
      walls.pos.push(p1x, 0, p1z, p0x, 0, p0z, p0x, h, p0z, p1x, h, p1z);
      for (let i = 0; i < 4; i++) walls.nor.push(dx, 0, dz);
      walls.col.push(c[0] * k, c[1] * k, c[2] * k, c[0] * k, c[1] * k, c[2] * k, c[0], c[1], c[2], c[0], c[1], c[2]);
      walls.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);

      // Ink: top + bottom edges, and verticals wherever the wall run ends or steps.
      beam(ink, p0x, h, p0z, p1x, h, p1z); beam(ink, p0x, 0.02, p0z, p1x, 0.02, p1z);
      if (faceHeight(x - tx, z - tz, dx, dz) !== h) beam(ink, p0x, 0, p0z, p0x, h, p0z);
      if (faceHeight(x + tx, z + tz, dx, dz) !== h) beam(ink, p1x, 0, p1z, p1x, h, p1z);

      if (interior) {
        // Painted dado stripe so interiors don't read as flat slabs.
        const o = 0.02;
        quadFlat(rgb(nf === F.INTERIOR || nf === F.GATE ? 0x4f6a7c : 0xfff1c9),
          [p1x + dx * o, 1.0, p1z + dz * o, p0x + dx * o, 1.0, p0z + dz * o, p0x + dx * o, 1.25, p0z + dz * o, p1x + dx * o, 1.25, p1z + dz * o]);
        continue;
      }
      // Windows on street-facing walls.
      for (let y = 2.7, row = 0; y + 1.3 < h - 0.5; y += 2.3, row++) {
        const lit = hash2(x * 7 + di * 3 + row * 11, z * 13 + row) < 0.3;
        const o = 0.03, hw = 0.5;
        const ax = mx - tx * hw + dx * o, az = mz - tz * hw + dz * o, bx = mx + tx * hw + dx * o, bz = mz + tz * hw + dz * o;
        quadFlat(rgb(lit ? (hash2(x + row, z) < 0.5 ? 0xffd98a : 0xff9e6d) : 0x2a2452), [bx, y, bz, ax, y, az, ax, y + 1.2, az, bx, y + 1.2, bz]);
        const t = 0.025;
        beam(ink, ax, y, az, bx, y, bz, t); beam(ink, bx, y, bz, bx, y + 1.2, bz, t); beam(ink, bx, y + 1.2, bz, ax, y + 1.2, az, t); beam(ink, ax, y + 1.2, az, ax, y, az, t);
      }
    }
  }
  add(meshEntity(toMesh(device, walls), toonMat));
  add(meshEntity(toMesh(device, flat), makeUnlit({})));
  add(meshEntity(toMesh(device, ink), makeUnlit({ color: INK, cull: 'none' })));
}

function buildCeilings(): void {
  const g = newGeo();
  const c = rgb(0x54506e);
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    if (!isInterior(floorOf(x, z))) continue;
    const b = g.pos.length / 3, x0 = x * T, x1 = x0 + T, z0 = z * T, z1 = z0 + T;
    g.pos.push(x0, CEIL_H, z0, x1, CEIL_H, z0, x1, CEIL_H, z1, x0, CEIL_H, z1);
    for (let i = 0; i < 4; i++) { g.nor.push(0, -1, 0); g.col.push(c[0], c[1], c[2]); }
    g.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  add(meshEntity(toMesh(device, g), toonMat));
}

function buildGround(): void {
  const PX = 40;
  const cv = document.createElement('canvas');
  cv.width = W * PX; cv.height = H * PX;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#1a1730'; g.fillRect(0, 0, cv.width, cv.height);
  const shade = (hex: number, k: number) => { const [r, gr, b] = rgb(hex); return `rgb(${Math.min(255, r * k * 255) | 0},${Math.min(255, gr * k * 255) | 0},${Math.min(255, b * k * 255) | 0})`; };
  const BASE: Record<number, number> = { [F.ASPHALT]: 0x5a5d84, [F.SIDEWALK]: 0x9a97bd, [F.GRASS]: 0x5aae7a, [F.INTERIOR]: 0x9d8fa5, [F.SAFE_A]: 0xe6b67a, [F.SAFE_B]: 0xe6b67a, [F.GATE]: 0x9d8fa5 };
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const f = floorOf(x, z);
    if (f === F.NONE) continue;
    const r = hash2(x, z), px = x * PX, pz = z * PX;
    g.fillStyle = shade(BASE[f], 0.94 + r * 0.12);
    g.fillRect(px, pz, PX, PX);
    g.strokeStyle = 'rgba(26,18,38,0.22)'; g.lineWidth = 1;
    if (f === F.SIDEWALK) { g.strokeRect(px + 0.5, pz + 0.5, PX - 1, PX - 1); }
    else if (f === F.GRASS) {
      g.fillStyle = shade(0x7cd68a, 1);
      for (let i = 0; i < 3; i++) { const a = hash2(x * 3 + i, z * 5 + i), b = hash2(x + i * 7, z * 2 + i); g.fillRect(px + a * 34, pz + b * 32, 2, 6); }
    } else if (f === F.INTERIOR || f === F.GATE) {
      g.strokeRect(px + 0.5, pz + 0.5, PX - 1, PX - 1);
      if (r < 0.12) { g.fillStyle = 'rgba(26,18,38,0.12)'; g.beginPath(); g.ellipse(px + 20, pz + 20, 12, 8, r * 9, 0, 7); g.fill(); }
    } else if (f === F.SAFE_A || f === F.SAFE_B) {
      g.beginPath(); g.moveTo(px, pz + PX / 2); g.lineTo(px + PX, pz + PX / 2); g.stroke();
    } else if (f === F.ASPHALT && r < 0.1) {
      g.strokeStyle = 'rgba(26,18,38,0.35)'; g.lineWidth = 2; g.beginPath();
      g.moveTo(px + 5, pz + 7); g.lineTo(px + 19, pz + 20); g.lineTo(px + 14, pz + 34); g.stroke();
    }
  }
  // Road centre dashes on the main street.
  g.fillStyle = '#ffe7a3';
  for (let z = 10; z < 29; z += 2) g.fillRect(22 * PX - 3, z * PX + 6, 6, PX);
  // Hazard stripes on the gate threshold.
  for (let x = MAP.gate.x0; x <= MAP.gate.x1; x++) for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? '#1a1226' : '#ffd43b';
    g.fillRect(x * PX + i * PX / 4, MAP.gate.z * PX, PX / 4, PX);
  }
  // Painted route arrows + lettering (rotated to read while walking +Z).
  const glyph = (x: number, z: number, rot: number, draw: () => void) => { g.save(); g.translate(x * PX, z * PX); g.rotate(rot); draw(); g.restore(); };
  for (const a of MAP.arrows) glyph(a.x, a.z, a.rot, () => {
    g.fillStyle = 'rgba(255,231,163,0.9)'; g.strokeStyle = '#1a1226'; g.lineWidth = 3; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(0, 32); g.lineTo(-22, 2); g.lineTo(-9, 2); g.lineTo(-9, -30); g.lineTo(9, -30); g.lineTo(9, 2); g.lineTo(22, 2); g.closePath();
    g.stroke(); g.fill();
  });
  const label = (text: string, x: number, z: number, size: number, color: string) => glyph(x, z, Math.PI, () => {
    g.font = `900 ${size}px ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 6; g.strokeStyle = '#1a1226'; g.lineJoin = 'round'; g.strokeText(text, 0, 0); g.fillStyle = color; g.fillText(text, 0, 0);
  });
  label('SAFE ROOM', 22, 4.5, 30, '#fff1c9');
  label('GOOD LUCK!', 22, 9.6, 30, '#ffe7a3');
  label('SAFE HOUSE', 35, 77.5, 30, '#fff1c9');
  label('START GENERATOR', 34, 63.6, 26, '#ffd43b');

  // Canvas row 0 (v = 0) maps to z = 0.
  const geo: Geo = {
    pos: [0, 0, 0, 0, 0, H * T, W * T, 0, H * T, W * T, 0, 0], nor: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], col: [],
    uv: [0, 0, 0, 1, 1, 1, 1, 0], idx: [0, 1, 2, 0, 2, 3],
  };
  add(meshEntity(toMesh(device, geo), makeToon({ tex: canvasTexture(cv) })));
}

function buildProps(): pc.Entity {
  const b = new Batch();
  const cube = box(), cyl = cylinder(14), ball = sphere(10, 7);
  const glows: Geo[] = [], pools: Geo[] = [];
  const at = (m: pc.Mat4, x: number, z: number, ry = 0) => trs(x, 0, z, 0, ry, 0).mul(m);

  for (const p of MAP.props) {
    const cx = (p.x + p.w / 2) * T, cz = (p.z + p.d / 2) * T, r = hash2(p.x * 5 + 3, p.z * 7 + 1);
    switch (p.type) {
      case 'car': {
        const ry = p.w > p.d ? Math.PI / 2 : 0, col = p.color ?? 0xff6b6b;
        b.add(cube, col, at(trs(0, 0.62, 0, 0, 0, 0, 1.7, 0.7, 3.6), cx, cz, ry));
        b.add(cube, 0xbfe6ff, at(trs(0, 1.25, 0.15, 0, 0, 0, 1.45, 0.6, 1.9), cx, cz, ry));
        b.add(cube, col, at(trs(0, 1.58, 0.15, 0, 0, 0, 1.5, 0.08, 1.95), cx, cz, ry), 'none');
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(cyl, 0x2b2540, at(trs(sx * 0.85, 0.34, sz * 1.15, 0, 0, Math.PI / 2, 0.34, 0.26, 0.34), cx, cz, ry), 'smooth');
        for (const sx of [-1, 1]) b.add(cube, 0xfff3a8, at(trs(sx * 0.55, 0.7, -1.81, 0, 0, 0, 0.3, 0.18, 0.06), cx, cz, ry), 'none');
        break;
      }
      case 'crate': {
        b.add(cube, 0xc8924e, at(trs(0, 0.95, 0, 0, 0, 0, 1.9), cx, cz, (r - 0.5) * 0.12));
        b.add(cube, 0xa9763a, at(trs(0, 0.95, 0, 0, 0, 0, 1.94, 0.22, 1.94), cx, cz, (r - 0.5) * 0.12), 'none');
        b.add(cube, r < 0.5 ? 0xd9a55e : 0x7fa8c9, at(trs((r - 0.5) * 0.3, 2.55, (r - 0.5) * 0.2, 0, r * 2, 0, 1.3), cx, cz));
        break;
      }
      case 'dumpster':
        b.add(cube, 0x3f9f7b, at(trs(0, 0.85, 0, 0, 0, 0, 1.8, 1.7, 1.7), cx, cz));
        b.add(cube, 0x2f7a5e, at(trs(0, 1.78, 0.1, 0.12, 0, 0, 1.9, 0.14, 1.85), cx, cz));
        b.add(cube, 0xffe7a3, at(trs(0, 1.0, -0.86, 0, 0, 0, 0.9, 0.3, 0.03), cx, cz), 'none');
        break;
      case 'tree':
        b.add(cyl, 0x8a5a3c, at(trs(0, 1.0, 0, 0, 0, 0, 0.3, 2.0, 0.3), cx, cz), 'smooth');
        b.add(ball, 0x4fae6a, at(trs(0, 3.0, 0, 0, r * 6, 0, 1.45, 1.3, 1.45), cx, cz), 'smooth', 0.06);
        b.add(ball, 0x6cc67a, at(trs(0.55, 3.95, 0.25, 0, r * 3, 0, 0.95), cx, cz, r * 6), 'smooth', 0.06);
        b.add(ball, 0x5fbb72, at(trs(-0.7, 3.5, -0.35, 0, 0, 0, 0.8), cx, cz, r * 6), 'smooth', 0.06);
        break;
      case 'fountain':
        b.add(cyl, 0xa8a4c4, at(trs(0, 0.3, 0, 0, 0, 0, 1.9, 0.6, 1.9), cx, cz), 'smooth');
        b.add(cyl, 0x6ad1e3, at(trs(0, 0.33, 0, 0, 0, 0, 1.6, 0.6, 1.6), cx, cz), 'none');
        b.add(cyl, 0xa8a4c4, at(trs(0, 1.1, 0, 0, 0, 0, 0.28, 1.6, 0.28), cx, cz), 'smooth');
        b.add(ball, 0x8fe3f0, at(trs(0, 2.1, 0, 0, 0, 0, 0.5), cx, cz), 'smooth');
        break;
      case 'gen':
        b.add(cube, 0xf2c14e, at(trs(0, 0.7, 0, 0, 0, 0, 1.6, 1.4, 1.3), cx, cz));
        b.add(cube, 0x2b2540, at(trs(0, 0.85, -0.66, 0, 0, 0, 1.0, 0.6, 0.04), cx, cz), 'none');
        b.add(cyl, 0x5a5670, at(trs(0.5, 1.6, 0.3, 0, 0, 0, 0.12, 0.5, 0.12), cx, cz), 'smooth');
        break;
    }
  }
  for (const l of MAP.lamps) {
    b.add(cyl, 0x2b2840, at(trs(0, 1.75, 0, 0, 0, 0, 0.07, 3.5, 0.07), l.x, l.z), 'none');
    b.add(cube, 0x2b2840, at(trs(0, 3.5, 0, 0, 0, 0, 0.5, 0.1, 0.5), l.x, l.z), 'none');
    glows.push(make(ball, undefined, trs(l.x, 3.28, l.z, 0, 0, 0, 0.24)));
    pools.push(make(ring(0, 3.2, 20), undefined, trs(l.x, 0.03, l.z)));
  }
  add(b.build());
  if (glows.length) {
    add(meshEntity(toMesh(device, merge(glows)), makeUnlit({ color: 0xffe9b0, fog: false })));
    add(meshEntity(toMesh(device, merge(pools)), makeUnlit({ color: 0xffc46b, alpha: 0.2, blend: 'add' })));
  }
  // Generator beacon (animated separately).
  const gen = MAP.props.find((p) => p.type === 'gen')!;
  const beacon = add(meshEntity(toMesh(device, make(ball)), makeUnlit({ fog: false })));
  beacon.setPosition((gen.x + 0.5) * T + 0.5, 1.95, (gen.z + 0.5) * T + 0.3);
  beacon.setLocalScale(0.16, 0.16, 0.16);
  return beacon;
}

const RING: Record<string, number> = { medkit: 0xff6b8a, ammo: 0xa9e34b, smg: 0x74c0fc, shotgun: 0x74c0fc, rifle: 0x74c0fc, gen: 0xffd43b };
const ringMesh = toMesh(device, make(ring(0.42, 0.56, 24)));
const arrowMesh = toMesh(device, make(cylinder(4, 0, 1), undefined, trs(0, 0, 0, Math.PI, 0, 0, 0.28, 0.5, 0.28)));
const bulletMesh = toMesh(device, make(cylinder(8), 0xffc94a, trs(0, 0, 0, 0, 0, 0, 0.05, 0.22, 0.05)));

function buildPickup(def: Pickup): PickupView {
  const group = new pc.Entity('pickup');
  group.setPosition(def.x, 0, def.z);
  const float = new pc.Entity('float');
  float.setLocalPosition(0, 0.75, 0);
  switch (def.kind) {
    case 'medkit':
      float.addChild(inkBox(0.55, 0.38, 0.28, 0xfff5f5));
      float.addChild(inkBox(0.3, 0.09, 0.3, 0xff4d6d, 0));
      float.addChild(inkBox(0.09, 0.3, 0.3, 0xff4d6d, 0));
      break;
    case 'ammo': {
      float.addChild(inkBox(0.62, 0.36, 0.42, 0x7fa650));
      float.addChild(inkBox(0.64, 0.1, 0.44, 0xffd43b, 0));
      for (let i = 0; i < 3; i++) {
        const bullet = meshEntity(bulletMesh, toonMat);
        bullet.setLocalPosition(-0.16 + i * 0.16, 0.28, 0);
        float.addChild(bullet);
      }
      break;
    }
    case 'gen':
      float.addChild(meshEntity(arrowMesh, makeUnlit({ color: 0xffd43b, fog: false })));
      break;
    default: {
      const gun = buildGun(def.kind).ent;
      gun.setLocalScale(1.9, 1.9, 1.9);
      gun.setLocalEulerAngles(0, 90, 0);
      float.addChild(gun);
    }
  }
  group.addChild(float);
  if (def.kind !== 'gen') {
    const ringEnt = meshEntity(ringMesh, makeUnlit({ color: RING[def.kind], alpha: 0.85, blend: 'normal' }));
    ringEnt.setLocalPosition(0, 0.04, 0);
    group.addChild(ringEnt);
    const pedestal = inkBox(0.5, 0.36, 0.5, 0x54506e);
    pedestal.setLocalPosition(0, 0.18, 0);
    group.addChild(pedestal);
  }
  add(group);
  return { def, group, float, taken: false };
}

function buildSky(): pc.Entity {
  const sky = new pc.Entity('sky');
  const mat = new pc.ShaderMaterial({
    uniqueName: 'Sky', attributes: { aPosition: pc.SEMANTIC_POSITION },
    vertexGLSL: /* glsl */ `attribute vec3 aPosition; uniform mat4 matrix_model; uniform mat4 matrix_viewProjection; varying vec3 vDir;
      void main(void) { vDir = normalize(aPosition); gl_Position = matrix_viewProjection * matrix_model * vec4(aPosition, 1.0); }`,
    fragmentGLSL: /* glsl */ `varying vec3 vDir;
      void main(void) {
        float h = clamp(normalize(vDir).y, -0.1, 1.0);
        vec3 horizon = vec3(0.99, 0.62, 0.64), mid = vec3(0.56, 0.38, 0.74), top = vec3(0.17, 0.15, 0.38);
        // Hard bands keep the sky in the same cel language as everything else.
        float b = floor(smoothstep(-0.02, 0.75, h) * 7.0) / 7.0;
        vec3 c = b < 0.45 ? mix(horizon, mid, b / 0.45) : mix(mid, top, (b - 0.45) / 0.55);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  mat.cull = pc.CULLFACE_NONE; mat.depthWrite = false; mat.update();
  sky.addChild(meshEntity(toMesh(device, make(sphere(24, 16), undefined, new pc.Mat4().setScale(300, 300, 300))), mat));

  // Moon, halo and stars are flat shapes pinned to the dome, facing the centre.
  const disc = (dir: pc.Vec3, dist: number, size: number): Geo => {
    const n = dir.clone().normalize(), u = new pc.Vec3().cross(pc.Vec3.UP, n).normalize(), v = new pc.Vec3().cross(n, u);
    const g = make(ring(0, size, 28));
    for (let i = 0; i < g.pos.length; i += 3) {
      const x = g.pos[i], z = g.pos[i + 2];
      g.pos[i] = n.x * dist + u.x * x + v.x * z; g.pos[i + 1] = n.y * dist + u.y * x + v.y * z; g.pos[i + 2] = n.z * dist + u.z * x + v.z * z;
    }
    return g;
  };
  const moonDir = new pc.Vec3(-90, 150, 230);
  const flatSky = (g: Geo, color: number, alpha = 1) => {
    // Blended so they draw in the transparent pass, after the opaque sky dome.
    const m = makeUnlit({ color, fog: false, cull: 'none', alpha, blend: 'normal' });
    sky.addChild(meshEntity(toMesh(device, g), m));
  };
  flatSky(disc(moonDir, 288, 31), 0xffd9c2, 0.25);
  flatSky(disc(moonDir, 285, 22), 0xfff6d6);
  const stars: Geo[] = [];
  for (let i = 0; i < 260; i++) {
    const a = hash2(i, 7) * Math.PI * 2, e = 0.25 + hash2(i, 31) * 1.2;
    stars.push(disc(new pc.Vec3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)), 290, 0.35 + hash2(i, 3) * 0.4));
  }
  flatSky(merge(stars), 0xfff6d6);
  add(sky);
  return sky;
}

export function buildWorld(): World {
  buildWalls();
  buildCeilings();
  buildGround();
  const beacon = buildProps();
  const sky = buildSky();
  const pickups = MAP.pickups.map(buildPickup);

  // Roll-up shutter gate.
  const gw = (MAP.gate.x1 - MAP.gate.x0 + 1) * T;
  const gcv = document.createElement('canvas'); gcv.width = 128; gcv.height = 128;
  const gg = gcv.getContext('2d')!;
  gg.fillStyle = '#ffd43b'; gg.fillRect(0, 0, 128, 128);
  gg.fillStyle = '#1a1226';
  for (let i = -128; i < 256; i += 48) { gg.beginPath(); gg.moveTo(i, 128); gg.lineTo(i + 24, 128); gg.lineTo(i + 152, 0); gg.lineTo(i + 128, 0); gg.fill(); }
  const gate = add(meshEntity(toMesh(device, make(box(), undefined, new pc.Mat4().setScale(gw, CEIL_H, 0.4))), makeToon({ tex: canvasTexture(gcv) })));
  const gx = (MAP.gate.x0 + MAP.gate.x1 + 1) / 2 * T, gz = (MAP.gate.z + 0.5) * T;
  let gateY = CEIL_H / 2, gateOpen = false, genActive = false;
  gate.setPosition(gx, gateY, gz);

  return {
    pickups,
    setGate(open, instant) { gateOpen = open; if (instant) { gateY = CEIL_H / 2 + (open ? CEIL_H - 0.3 : 0); gate.setPosition(gx, gateY, gz); } },
    setTaken(id, taken) { const p = pickups[id]; if (p) { p.taken = taken; p.group.enabled = !taken; } },
    setGenerator(active) { genActive = active; const p = pickups.find((q) => q.def.kind === 'gen'); if (p) p.group.enabled = !active; },
    update(t, dt, camX, camY, camZ) {
      const target = CEIL_H / 2 + (gateOpen ? CEIL_H - 0.3 : 0);
      gateY += (target - gateY) * Math.min(1, dt * 1.8);
      gate.setPosition(gx, gateY, gz);
      for (const p of pickups) {
        if (!p.group.enabled) continue;
        p.float.setLocalEulerAngles(0, (t * 92 + p.def.id * 57) % 360, 0);
        p.float.setLocalPosition(0, (p.def.kind === 'gen' ? 2.7 : 0.78) + Math.sin(t * 2.4 + p.def.id) * 0.07, 0);
      }
      const blink = genActive ? Math.sin(t * 18) > 0 : Math.sin(t * 3) > 0.6;
      setTint(beacon, genActive ? (blink ? 0x7dff8a : 0x1f6a34) : blink ? 0xff4d5e : 0x6a1f2a);
      sky.setPosition(camX, camY, camZ);
    },
  };
}
