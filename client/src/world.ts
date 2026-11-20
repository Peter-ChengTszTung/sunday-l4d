// Turns the shared grid map into cel-shaded scenery.
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { TILE, CEIL_H } from '../../shared/constants';
import { MAP, F, hash2, type Pickup } from '../../shared/map';
import { Batch, toonVC, toon, trs, inkBox, INK, merge } from './toon';
import { buildGun } from './viewmodel';

const { W, H } = MAP;
const T = TILE;
const BUILDING_COLORS = [0x8e6fa8, 0x5f8fa8, 0xc77b6b, 0x6f7fb8, 0xb58a5f, 0x7f6f9a, 0x5fa39a, 0xa86f8e];
const INTERIOR_WALL = 0x6f8fa3, SAFE_WALL = 0xe0884f;
const isInterior = (f: number) => f === F.INTERIOR || f === F.SAFE_A || f === F.SAFE_B || f === F.GATE;
const floorOf = (x: number, z: number) => (x < 0 || z < 0 || x >= W || z >= H ? F.NONE : MAP.floor[z * W + x]);
const isWall = (x: number, z: number) => floorOf(x, z) === F.NONE;

export interface PickupView { def: Pickup; group: THREE.Group; taken: boolean }
export interface World {
  pickups: PickupView[];
  setGate(open: boolean, instant?: boolean): void;
  setTaken(id: number, taken: boolean): void;
  setGenerator(active: boolean): void;
  update(t: number, dt: number, camera: THREE.Camera): void;
  resize(w: number, h: number): void;
}

function faceHeight(x: number, z: number, dx: number, dz: number): number {
  // 0 when (x,z) has no visible face towards (dx,dz).
  if (!isWall(x, z) || x < 0 || z < 0 || x >= W || z >= H) return 0;
  const nf = floorOf(x + dx, z + dz);
  if (nf === F.NONE) return 0;
  return isInterior(nf) ? CEIL_H : MAP.wallH[z * W + x];
}

function buildWalls(scene: THREE.Scene): LineMaterial {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  const wpos: number[] = [], wcol: number[] = [], widx: number[] = [];
  const lines: number[] = [];
  const c = new THREE.Color(), c2 = new THREE.Color();
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

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
      c.setHex(interior ? (nf === F.INTERIOR || nf === F.GATE ? INTERIOR_WALL : SAFE_WALL) : BUILDING_COLORS[Math.floor(chunk * BUILDING_COLORS.length)]);
      c2.copy(c).multiplyScalar(interior ? 0.72 : 0.62);
      const base = pos.length / 3;
      pos.push(p1x, 0, p1z, p0x, 0, p0z, p0x, h, p0z, p1x, h, p1z);
      for (let i = 0; i < 4; i++) nor.push(dx, 0, dz);
      col.push(c2.r, c2.g, c2.b, c2.r, c2.g, c2.b, c.r, c.g, c.b, c.r, c.g, c.b);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);

      // Ink: top + bottom edges, and verticals wherever the wall run ends or steps.
      lines.push(p0x, h, p0z, p1x, h, p1z, p0x, 0.02, p0z, p1x, 0.02, p1z);
      if (faceHeight(x - tx, z - tz, dx, dz) !== h) lines.push(p0x, 0, p0z, p0x, h, p0z);
      if (faceHeight(x + tx, z + tz, dx, dz) !== h) lines.push(p1x, 0, p1z, p1x, h, p1z);

      if (interior) {
        // Painted dado stripe so interiors don't read as flat slabs.
        const sb = wpos.length / 3, o = 0.02;
        c.setHex(nf === F.INTERIOR || nf === F.GATE ? 0x4f6a7c : 0xfff1c9);
        wpos.push(p1x + dx * o, 1.0, p1z + dz * o, p0x + dx * o, 1.0, p0z + dz * o, p0x + dx * o, 1.25, p0z + dz * o, p1x + dx * o, 1.25, p1z + dz * o);
        for (let i = 0; i < 4; i++) wcol.push(c.r, c.g, c.b);
        widx.push(sb, sb + 1, sb + 2, sb, sb + 2, sb + 3);
        continue;
      }
      // Windows on street-facing walls.
      for (let y = 2.7, row = 0; y + 1.3 < h - 0.5; y += 2.3, row++) {
        const lit = hash2(x * 7 + di * 3 + row * 11, z * 13 + row) < 0.3;
        c.setHex(lit ? (hash2(x + row, z) < 0.5 ? 0xffd98a : 0xff9e6d) : 0x2a2452);
        const o = 0.03, hw = 0.5, wb = wpos.length / 3;
        const ax = mx - tx * hw + dx * o, az = mz - tz * hw + dz * o, bx = mx + tx * hw + dx * o, bz = mz + tz * hw + dz * o;
        wpos.push(bx, y, bz, ax, y, az, ax, y + 1.2, az, bx, y + 1.2, bz);
        for (let i = 0; i < 4; i++) wcol.push(c.r, c.g, c.b);
        widx.push(wb, wb + 1, wb + 2, wb, wb + 2, wb + 3);
        lines.push(ax, y, az, bx, y, bz, bx, y, bz, bx, y + 1.2, bz, bx, y + 1.2, bz, ax, y + 1.2, az, ax, y + 1.2, az, ax, y, az);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  scene.add(new THREE.Mesh(g, toonVC));

  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
  wg.setAttribute('color', new THREE.Float32BufferAttribute(wcol, 3));
  wg.setIndex(widx);
  scene.add(new THREE.Mesh(wg, new THREE.MeshBasicMaterial({ vertexColors: true })));

  const lg = new LineSegmentsGeometry().setPositions(lines);
  const lm = new LineMaterial({ color: INK, linewidth: 2.2, fog: true });
  const seg = new LineSegments2(lg, lm);
  seg.frustumCulled = false;
  scene.add(seg);
  return lm;
}

function buildCeilings(scene: THREE.Scene): void {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    if (!isInterior(floorOf(x, z))) continue;
    const b = pos.length / 3, x0 = x * T, x1 = x0 + T, z0 = z * T, z1 = z0 + T;
    pos.push(x0, CEIL_H, z0, x1, CEIL_H, z0, x1, CEIL_H, z1, x0, CEIL_H, z1);
    for (let i = 0; i < 4; i++) nor.push(0, -1, 0);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  scene.add(new THREE.Mesh(g, toon(0x54506e)));
}

function buildGround(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
  const PX = 40;
  const cv = document.createElement('canvas');
  cv.width = W * PX; cv.height = H * PX;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#1a1730'; g.fillRect(0, 0, cv.width, cv.height);
  const shade = (hex: number, k: number) => `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`;
  const BASE: Record<number, number> = { [F.ASPHALT]: 0x4a4d70, [F.SIDEWALK]: 0x8a87ad, [F.GRASS]: 0x4f9a6c, [F.INTERIOR]: 0x8d7f95, [F.SAFE_A]: 0xd6a66a, [F.SAFE_B]: 0xd6a66a, [F.GATE]: 0x8d7f95 };
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const f = floorOf(x, z);
    if (f === F.NONE) continue;
    const r = hash2(x, z), px = x * PX, pz = z * PX;
    g.fillStyle = shade(BASE[f], 0.94 + r * 0.12);
    g.fillRect(px, pz, PX, PX);
    g.strokeStyle = 'rgba(26,18,38,0.22)'; g.lineWidth = 1;
    if (f === F.SIDEWALK) { g.strokeRect(px + 0.5, pz + 0.5, PX - 1, PX - 1); }
    else if (f === F.GRASS) {
      g.fillStyle = shade(0x6cc67a, 1);
      for (let i = 0; i < 3; i++) { const a = hash2(x * 3 + i, z * 5 + i), b = hash2(x + i * 7, z * 2 + i); g.fillRect(px + a * 28, pz + b * 26, 2, 5); }
    } else if (f === F.INTERIOR || f === F.GATE) {
      g.strokeRect(px + 0.5, pz + 0.5, PX - 1, PX - 1);
      if (r < 0.12) { g.fillStyle = 'rgba(26,18,38,0.12)'; g.beginPath(); g.ellipse(px + 16, pz + 16, 10, 7, r * 9, 0, 7); g.fill(); }
    } else if (f === F.SAFE_A || f === F.SAFE_B) {
      g.beginPath(); g.moveTo(px, pz + PX / 2); g.lineTo(px + PX, pz + PX / 2); g.stroke();
    } else if (f === F.ASPHALT && r < 0.1) {
      g.strokeStyle = 'rgba(26,18,38,0.35)'; g.lineWidth = 2; g.beginPath();
      g.moveTo(px + 4, pz + 6); g.lineTo(px + 15, pz + 16); g.lineTo(px + 11, pz + 27); g.stroke();
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
    g.beginPath(); g.moveTo(0, 26); g.lineTo(-18, 2); g.lineTo(-7, 2); g.lineTo(-7, -24); g.lineTo(7, -24); g.lineTo(7, 2); g.lineTo(18, 2); g.closePath();
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

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, H * T, W * T, 0, H * T, W * T, 0, 0], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 1, 1], 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  scene.add(new THREE.Mesh(geo, new THREE.MeshToonMaterial({ map: tex, gradientMap: toonVC.gradientMap })));
}

function buildProps(scene: THREE.Scene): THREE.Mesh {
  const b = new Batch();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 14);
  const ball = new THREE.SphereGeometry(1, 10, 7);
  const glowPos: THREE.BufferGeometry[] = [];
  const pools: THREE.BufferGeometry[] = [];
  const at = (m: THREE.Matrix4, x: number, z: number, ry = 0) => new THREE.Matrix4().makeTranslation(x, 0, z).multiply(new THREE.Matrix4().makeRotationY(ry)).multiply(m);

  for (const p of MAP.props) {
    const cx = (p.x + p.w / 2) * T, cz = (p.z + p.d / 2) * T, r = hash2(p.x * 5 + 3, p.z * 7 + 1);
    switch (p.type) {
      case 'car': {
        const ry = p.w > p.d ? Math.PI / 2 : 0, col = p.color ?? 0xff6b6b;
        b.add(box, col, at(trs(0, 0.62, 0, 0, 0, 0, 1.7, 0.7, 3.6), cx, cz, ry));
        b.add(box, 0xbfe6ff, at(trs(0, 1.25, 0.15, 0, 0, 0, 1.45, 0.6, 1.9), cx, cz, ry));
        b.add(box, col, at(trs(0, 1.58, 0.15, 0, 0, 0, 1.5, 0.08, 1.95), cx, cz, ry), 'none');
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(cyl, 0x2b2540, at(trs(sx * 0.85, 0.34, sz * 1.15, 0, 0, Math.PI / 2, 0.34, 0.26, 0.34), cx, cz, ry), 'smooth');
        for (const sx of [-1, 1]) b.add(box, 0xfff3a8, at(trs(sx * 0.55, 0.7, -1.81, 0, 0, 0, 0.3, 0.18, 0.06), cx, cz, ry), 'none');
        break;
      }
      case 'crate': {
        b.add(box, 0xc8924e, at(trs(0, 0.95, 0, 0, 0, 0, 1.9), cx, cz, (r - 0.5) * 0.12));
        b.add(box, 0xa9763a, at(trs(0, 0.95, 0, 0, 0, 0, 1.94, 0.22, 1.94), cx, cz, (r - 0.5) * 0.12), 'none');
        b.add(box, r < 0.5 ? 0xd9a55e : 0x7fa8c9, at(trs((r - 0.5) * 0.3, 2.55, (r - 0.5) * 0.2, 0, r * 2, 0, 1.3), cx, cz));
        break;
      }
      case 'dumpster':
        b.add(box, 0x3f9f7b, at(trs(0, 0.85, 0, 0, 0, 0, 1.8, 1.7, 1.7), cx, cz));
        b.add(box, 0x2f7a5e, at(trs(0, 1.78, 0.1, 0.12, 0, 0, 1.9, 0.14, 1.85), cx, cz));
        b.add(box, 0xffe7a3, at(trs(0, 1.0, -0.86, 0, 0, 0, 0.9, 0.3, 0.03), cx, cz), 'none');
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
        b.add(box, 0xf2c14e, at(trs(0, 0.7, 0, 0, 0, 0, 1.6, 1.4, 1.3), cx, cz));
        b.add(box, 0x2b2540, at(trs(0, 0.85, -0.66, 0, 0, 0, 1.0, 0.6, 0.04), cx, cz), 'none');
        b.add(cyl, 0x5a5670, at(trs(0.5, 1.6, 0.3, 0, 0, 0, 0.12, 0.5, 0.12), cx, cz), 'smooth');
        break;
    }
  }
  for (const l of MAP.lamps) {
    b.add(cyl, 0x2b2840, at(trs(0, 1.75, 0, 0, 0, 0, 0.07, 3.5, 0.07), l.x, l.z), 'none');
    b.add(box, 0x2b2840, at(trs(0, 3.5, 0, 0, 0, 0, 0.5, 0.1, 0.5), l.x, l.z), 'none');
    glowPos.push(new THREE.SphereGeometry(0.24, 10, 8).translate(l.x, 3.28, l.z).deleteAttribute('uv').deleteAttribute('normal'));
    pools.push(new THREE.CircleGeometry(3.2, 20).rotateX(-Math.PI / 2).translate(l.x, 0.03, l.z));
  }
  scene.add(b.build());
  if (glowPos.length) {
    scene.add(new THREE.Mesh(merge(glowPos), new THREE.MeshBasicMaterial({ color: 0xffe9b0, fog: false })));
    scene.add(new THREE.Mesh(merge(pools), new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false })));
  }
  // Generator beacon (animated separately).
  const gen = MAP.props.find((p) => p.type === 'gen')!;
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff4d5e }));
  beacon.position.set((gen.x + 0.5) * T + 0.5, 1.95, (gen.z + 0.5) * T + 0.3);
  scene.add(beacon);
  return beacon;
}

const RING: Record<string, number> = { medkit: 0xff6b8a, ammo: 0xa9e34b, smg: 0x74c0fc, shotgun: 0x74c0fc, rifle: 0x74c0fc, gen: 0xffd43b };
function buildPickup(def: Pickup): THREE.Group {
  const g = new THREE.Group();
  g.position.set(def.x, 0, def.z);
  const float = new THREE.Group();
  float.name = 'float';
  float.position.y = 0.75;
  switch (def.kind) {
    case 'medkit': {
      const m = inkBox(0.55, 0.38, 0.28, 0xfff5f5);
      const red = toon(0xff4d6d);
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.3), red), c = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.3, 0.3), red);
      m.add(a, c); float.add(m);
      break;
    }
    case 'ammo': {
      const m = inkBox(0.62, 0.36, 0.42, 0x7fa650);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.1, 0.44), toon(0xffd43b));
      m.add(band); float.add(m);
      for (let i = 0; i < 3; i++) {
        const bullet = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 8), toon(0xffc94a));
        bullet.position.set(-0.16 + i * 0.16, 0.28, 0); m.add(bullet);
      }
      break;
    }
    case 'gen': {
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 4), new THREE.MeshBasicMaterial({ color: 0xffd43b }));
      arrow.rotation.x = Math.PI; float.position.y = 2.7; float.add(arrow);
      break;
    }
    default: {
      const gun = buildGun(def.kind);
      gun.scale.setScalar(1.9); gun.rotation.y = Math.PI / 2; float.add(gun);
    }
  }
  g.add(float);
  if (def.kind !== 'gen') {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.56, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: RING[def.kind], transparent: true, opacity: 0.85, depthWrite: false }));
    ring.position.y = 0.04; g.add(ring);
    const pedestal = inkBox(0.5, 0.36, 0.5, 0x54506e);
    pedestal.position.y = 0.18; g.add(pedestal);
  }
  return g;
}

function buildSky(scene: THREE.Scene): THREE.Group {
  const sky = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: /* glsl */ `varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y, -0.1, 1.0);
        vec3 horizon = vec3(0.98, 0.50, 0.52), mid = vec3(0.42, 0.25, 0.62), top = vec3(0.07, 0.07, 0.22);
        // Hard-ish bands keep the sky in the same cel language as everything else.
        float b = floor(smoothstep(-0.02, 0.75, h) * 7.0) / 7.0;
        vec3 c = b < 0.45 ? mix(horizon, mid, b / 0.45) : mix(mid, top, (b - 0.45) / 0.55);
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  dome.renderOrder = -10;
  sky.add(dome);
  const moon = new THREE.Mesh(new THREE.CircleGeometry(22, 32), new THREE.MeshBasicMaterial({ color: 0xfff6d6, fog: false, depthWrite: false }));
  moon.position.set(-90, 150, 230); moon.lookAt(0, 0, 0); moon.renderOrder = -9;
  const halo = new THREE.Mesh(new THREE.CircleGeometry(31, 32), new THREE.MeshBasicMaterial({ color: 0xffd9c2, fog: false, depthWrite: false, transparent: true, opacity: 0.22 }));
  halo.position.copy(moon.position).multiplyScalar(1.01); halo.lookAt(0, 0, 0); halo.renderOrder = -9.5;
  sky.add(halo, moon);
  const sp: number[] = [];
  for (let i = 0; i < 260; i++) {
    const a = hash2(i, 7) * Math.PI * 2, e = 0.25 + hash2(i, 31) * 1.2;
    sp.push(Math.cos(a) * Math.cos(e) * 280, Math.sin(e) * 280, Math.sin(a) * Math.cos(e) * 280);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xfff6d6, size: 2.2, sizeAttenuation: false, fog: false, depthWrite: false }));
  stars.renderOrder = -9;
  sky.add(stars);
  scene.add(sky);
  return sky;
}

export function buildWorld(scene: THREE.Scene, renderer: THREE.WebGLRenderer): World {
  const lineMat = buildWalls(scene);
  buildCeilings(scene);
  buildGround(scene, renderer);
  const beacon = buildProps(scene);
  const sky = buildSky(scene);

  const pickups: PickupView[] = MAP.pickups.map((def) => {
    const group = buildPickup(def);
    scene.add(group);
    return { def, group, taken: false };
  });

  // Roll-up shutter gate.
  const gw = (MAP.gate.x1 - MAP.gate.x0 + 1) * T;
  const gcv = document.createElement('canvas'); gcv.width = 128; gcv.height = 128;
  const gg = gcv.getContext('2d')!;
  gg.fillStyle = '#ffd43b'; gg.fillRect(0, 0, 128, 128);
  gg.fillStyle = '#1a1226';
  for (let i = -128; i < 256; i += 48) { gg.beginPath(); gg.moveTo(i, 128); gg.lineTo(i + 24, 128); gg.lineTo(i + 152, 0); gg.lineTo(i + 128, 0); gg.fill(); }
  const gtex = new THREE.CanvasTexture(gcv); gtex.colorSpace = THREE.SRGBColorSpace;
  const gate = new THREE.Mesh(new THREE.BoxGeometry(gw, CEIL_H, 0.4), new THREE.MeshToonMaterial({ map: gtex, gradientMap: toonVC.gradientMap }));
  const gx = (MAP.gate.x0 + MAP.gate.x1 + 1) / 2 * T, gz = (MAP.gate.z + 0.5) * T;
  gate.position.set(gx, CEIL_H / 2, gz);
  scene.add(gate);
  let gateOpen = false, genActive = false;

  return {
    pickups,
    setGate(open, instant) { gateOpen = open; if (instant) gate.position.y = CEIL_H / 2 + (open ? CEIL_H - 0.3 : 0); },
    setTaken(id, taken) { const p = pickups[id]; if (p) { p.taken = taken; p.group.visible = !taken; } },
    setGenerator(active) { genActive = active; const p = pickups.find((q) => q.def.kind === 'gen'); if (p) p.group.visible = !active; },
    update(t, dt, camera) {
      const target = CEIL_H / 2 + (gateOpen ? CEIL_H - 0.3 : 0);
      gate.position.y += (target - gate.position.y) * Math.min(1, dt * 1.8);
      for (const p of pickups) {
        if (!p.group.visible) continue;
        const f = p.group.getObjectByName('float')!;
        f.rotation.y = t * 1.6 + p.def.id;
        f.position.y = (p.def.kind === 'gen' ? 2.7 : 0.78) + Math.sin(t * 2.4 + p.def.id) * 0.07;
      }
      const blink = genActive ? Math.sin(t * 18) > 0 : Math.sin(t * 3) > 0.6;
      (beacon.material as THREE.MeshBasicMaterial).color.setHex(genActive ? (blink ? 0x7dff8a : 0x1f6a34) : blink ? 0xff4d5e : 0x6a1f2a);
      sky.position.copy(camera.position);
    },
    resize(w, h) { lineMat.resolution.set(w, h); },
  };
}
