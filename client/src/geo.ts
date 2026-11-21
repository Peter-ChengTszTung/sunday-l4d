// Tiny CPU-side geometry kit. Everything in the game is built from these
// primitives, coloured per vertex, merged, and uploaded once as a pc.Mesh.
import * as pc from 'playcanvas';

export interface Geo { pos: number[]; nor: number[]; col: number[]; uv: number[]; idx: number[] }
const empty = (): Geo => ({ pos: [], nor: [], col: [], uv: [], idx: [] });

export function box(): Geo {
  const g = empty();
  // [normal, u-axis, v-axis] for each face of a unit cube centred on the origin.
  const F: [number[], number[], number[]][] = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  for (const [n, u, v] of F) {
    const b = g.pos.length / 3;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      g.pos.push((n[0] + u[0] * su + v[0] * sv) / 2, (n[1] + u[1] * su + v[1] * sv) / 2, (n[2] + u[2] * su + v[2] * sv) / 2);
      g.nor.push(n[0], n[1], n[2]);
      g.uv.push((su + 1) / 2, (sv + 1) / 2);
    }
    g.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return g;
}

/** Rows of (polar angle, y offset) swept around Y. Shared by sphere/dome/capsule. */
function lathe(rows: [number, number][], seg: number, radius: number): Geo {
  const g = empty();
  for (const [theta, yo] of rows) {
    const y = Math.cos(theta), r = Math.sin(theta);
    for (let j = 0; j <= seg; j++) {
      const phi = (j / seg) * Math.PI * 2, cx = Math.cos(phi), cz = Math.sin(phi);
      g.pos.push(r * cx * radius, y * radius + yo, r * cz * radius);
      g.nor.push(r * cx, y, r * cz);
    }
  }
  const w = seg + 1;
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * w + j, b = a + w, c = b + 1, d = a + 1;
    g.idx.push(a, d, b, b, d, c);
  }
  return g;
}

/** Unit sphere, or a cap of it when `thetaLen` < π (π/2 = dome). */
export function sphere(seg = 18, rings = 12, thetaLen = Math.PI): Geo {
  const rows: [number, number][] = [];
  for (let i = 0; i <= rings; i++) rows.push([(thetaLen * i) / rings, 0]);
  return lathe(rows, seg, 1);
}

/** Capsule along Y: `len` is the straight section, total height len + 2r. */
export function capsule(r: number, len: number, seg = 10, rings = 4): Geo {
  const rows: [number, number][] = [];
  for (let i = 0; i <= rings; i++) rows.push([(Math.PI / 2) * (i / rings), len / 2]);
  for (let i = 0; i <= rings; i++) rows.push([Math.PI / 2 + (Math.PI / 2) * (i / rings), -len / 2]);
  return lathe(rows, seg, r);
}

/** Height-1 cylinder along Y with caps; rTop = 0 gives a cone. */
export function cylinder(seg = 14, rTop = 1, rBot = 1): Geo {
  const g = empty();
  const slope = rBot - rTop, nl = Math.hypot(1, slope);
  for (const [y, r] of [[0.5, rTop], [-0.5, rBot]]) for (let j = 0; j <= seg; j++) {
    const phi = (j / seg) * Math.PI * 2, cx = Math.cos(phi), cz = Math.sin(phi);
    g.pos.push(cx * r, y, cz * r); g.nor.push(cx / nl, slope / nl, cz / nl);
  }
  const w = seg + 1;
  for (let j = 0; j < seg; j++) g.idx.push(j, j + 1, j + w, j + w, j + 1, j + w + 1);
  for (const [y, r, up] of [[0.5, rTop, 1], [-0.5, rBot, -1]]) {
    if (r <= 0) continue;
    const c = g.pos.length / 3;
    g.pos.push(0, y, 0); g.nor.push(0, up, 0);
    for (let j = 0; j <= seg; j++) { const phi = (j / seg) * Math.PI * 2; g.pos.push(Math.cos(phi) * r, y, Math.sin(phi) * r); g.nor.push(0, up, 0); }
    for (let j = 0; j < seg; j++) { if (up > 0) g.idx.push(c, c + 2 + j, c + 1 + j); else g.idx.push(c, c + 1 + j, c + 2 + j); }
  }
  return g;
}

/** Flat ring (or disc when inner = 0) lying in XZ, facing +Y. */
export function ring(inner: number, outer: number, seg = 24): Geo {
  const g = empty();
  for (let j = 0; j <= seg; j++) {
    const phi = (j / seg) * Math.PI * 2, cx = Math.cos(phi), cz = Math.sin(phi);
    g.pos.push(cx * inner, 0, cz * inner, cx * outer, 0, cz * outer); g.nor.push(0, 1, 0, 0, 1, 0);
  }
  for (let j = 0; j < seg; j++) { const a = j * 2; g.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  return g;
}

/** Comic star in the XY plane (draw double-sided). */
export function star(points: number, outer: number, inner: number): Geo {
  const g = empty();
  g.pos.push(0, 0, 0); g.nor.push(0, 0, 1);
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer, a = (i / (points * 2)) * Math.PI * 2;
    g.pos.push(Math.cos(a) * r, Math.sin(a) * r, 0); g.nor.push(0, 0, 1);
  }
  for (let i = 0; i < points * 2; i++) g.idx.push(0, 1 + i, 1 + ((i + 1) % (points * 2)));
  return g;
}

/** Unit quad in the XY plane facing +Z, with UVs (v = 0 at the top). */
export function quad(): Geo {
  return { pos: [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], nor: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], col: [], uv: [0, 1, 1, 1, 1, 0, 0, 0], idx: [0, 1, 2, 0, 2, 3] };
}

// ---------------------------------------------------------------- operations
const QX = new pc.Quat(), QY = new pc.Quat(), QZ = new pc.Quat();
const DEG = 180 / Math.PI;
/** Quaternion for radians applied as Rx·Ry·Rz. */
export function quatXYZ(rx: number, ry: number, rz: number, out = new pc.Quat()): pc.Quat {
  QX.setFromAxisAngle(pc.Vec3.RIGHT, rx * DEG); QY.setFromAxisAngle(pc.Vec3.UP, ry * DEG); QZ.setFromAxisAngle(pc.Vec3.BACK, rz * DEG);
  return out.copy(QX).mul(QY).mul(QZ);
}
/** Quaternion for a camera: yaw, then pitch, then roll (radians). */
export function quatYXZ(rx: number, ry: number, rz: number, out = new pc.Quat()): pc.Quat {
  QX.setFromAxisAngle(pc.Vec3.RIGHT, rx * DEG); QY.setFromAxisAngle(pc.Vec3.UP, ry * DEG); QZ.setFromAxisAngle(pc.Vec3.BACK, rz * DEG);
  return out.copy(QY).mul(QX).mul(QZ);
}

export function trs(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): pc.Mat4 {
  return new pc.Mat4().setTRS(new pc.Vec3(x, y, z), quatXYZ(rx, ry, rz), new pc.Vec3(sx, sy, sz));
}

const _v = new pc.Vec3();
/** Copy of `g`, transformed and/or flat-coloured. */
export function make(g: Geo, color?: number, m?: pc.Mat4): Geo {
  const out: Geo = { pos: g.pos.slice(), nor: g.nor.slice(), col: g.col.slice(), uv: g.uv.slice(), idx: g.idx.slice() };
  if (m) {
    const nm = m.clone().invert().transpose();
    for (let i = 0; i < out.pos.length; i += 3) {
      m.transformPoint(_v.set(out.pos[i], out.pos[i + 1], out.pos[i + 2]), _v);
      out.pos[i] = _v.x; out.pos[i + 1] = _v.y; out.pos[i + 2] = _v.z;
    }
    for (let i = 0; i < out.nor.length; i += 3) {
      nm.transformVector(_v.set(out.nor[i], out.nor[i + 1], out.nor[i + 2]), _v).normalize();
      out.nor[i] = _v.x; out.nor[i + 1] = _v.y; out.nor[i + 2] = _v.z;
    }
  }
  if (color !== undefined) {
    const r = ((color >> 16) & 255) / 255, gr = ((color >> 8) & 255) / 255, b = (color & 255) / 255;
    out.col = [];
    for (let i = 0; i < out.pos.length / 3; i++) out.col.push(r, gr, b);
  }
  return out;
}

export function merge(list: Geo[]): Geo {
  const out = empty();
  const hasUv = list.every((g) => g.uv.length > 0), hasNor = list.every((g) => g.nor.length > 0);
  for (const g of list) {
    const base = out.pos.length / 3, n = g.pos.length / 3;
    for (const v of g.pos) out.pos.push(v);
    if (hasNor) for (const v of g.nor) out.nor.push(v);
    if (g.col.length) for (const v of g.col) out.col.push(v); else for (let i = 0; i < n * 3; i++) out.col.push(1);
    if (hasUv) for (const v of g.uv) out.uv.push(v);
    for (const i of g.idx) out.idx.push(base + i);
  }
  return out;
}

/** Grow about the bounding-box centre by a per-axis margin (keeps box corners closed). */
export function inflateBox(g: Geo, tx: number, ty: number, tz: number): Geo {
  const out = make(g);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < g.pos.length; i++) { const a = i % 3; lo[a] = Math.min(lo[a], g.pos[i]); hi[a] = Math.max(hi[a], g.pos[i]); }
  const t = [tx, ty, tz];
  for (let i = 0; i < out.pos.length; i++) {
    const a = i % 3, c = (lo[a] + hi[a]) / 2, s = Math.max(hi[a] - lo[a], 1e-4);
    out.pos[i] = c + (out.pos[i] - c) * ((s + 2 * t[a]) / s);
  }
  return out;
}

/** Push vertices out along their normals (in place). */
export function inflateSmooth(g: Geo, t: number): Geo {
  for (let i = 0; i < g.pos.length; i++) g.pos[i] += g.nor[i] * t;
  return g;
}

/** `alpha` (optional, one byte per vertex) fills the colour alpha channel, e.g. a part index. */
export function toMesh(device: pc.GraphicsDevice, g: Geo, pin = true, alpha?: ArrayLike<number>): pc.Mesh {
  const mesh = new pc.Mesh(device);
  const n = g.pos.length / 3;
  mesh.setPositions(g.pos);
  if (g.nor.length) mesh.setNormals(g.nor);
  const c = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const has = g.col.length > 0;
    c[i * 4] = has ? Math.round(g.col[i * 3] * 255) : 255; c[i * 4 + 1] = has ? Math.round(g.col[i * 3 + 1] * 255) : 255;
    c[i * 4 + 2] = has ? Math.round(g.col[i * 3 + 2] * 255) : 255; c[i * 4 + 3] = alpha ? alpha[i] : 255;
  }
  mesh.setColors32(c);
  if (g.uv.length) mesh.setUvs(0, g.uv);
  mesh.setIndices(n > 65535 ? new Uint32Array(g.idx) : new Uint16Array(g.idx));
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  // Shared meshes outlive any single entity: hold a reference so destroying
  // one mesh instance doesn't free the mesh under the others.
  if (pin) mesh.incRefCount();
  return mesh;
}
