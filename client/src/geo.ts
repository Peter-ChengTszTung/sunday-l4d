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

/**
 * One closed outline shell round several axis-aligned boxes (`lo`/`hi` corners), each grown by `t`: the
 * outer surface of their union, with no walls inside it. Outward winding, no colour. A hull per box
 * would be `t` bigger than the boxes, so where one box meets a flush neighbour its hull's walls stand
 * proud of the neighbour's face as a dark line across what should read as one shape (a trigger guard,
 * a cross, a handle). Built on the grid of the grown boxes' faces: a cell is filled when a box covers it,
 * and a face is laid wherever a filled cell meets an empty one.
 */
export function unionHull(boxes: { lo: number[]; hi: number[] }[], t: number): Geo {
  const g = empty();
  const grown = boxes.map((b) => ({ lo: b.lo.map((v) => v - t), hi: b.hi.map((v) => v + t) }));
  const axes = [0, 1, 2].map((a) => [...new Set(grown.flatMap((b) => [b.lo[a], b.hi[a]]))].sort((p, q) => p - q));
  const [X, Y, Z] = axes, nx = X.length - 1, ny = Y.length - 1, nz = Z.length - 1;
  const filled = new Uint8Array(Math.max(0, nx * ny * nz));
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
    const c = [(X[i] + X[i + 1]) / 2, (Y[j] + Y[j + 1]) / 2, (Z[k] + Z[k + 1]) / 2];
    if (grown.some((b) => b.lo.every((v, a) => v < c[a]) && b.hi.every((v, a) => c[a] < v))) filled[(i * ny + j) * nz + k] = 1;
  }
  const at = (i: number, j: number, k: number) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && filled[(i * ny + j) * nz + k] === 1;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
    if (!at(i, j, k)) continue;
    const lo = [X[i], Y[j], Z[k]], hi = [X[i + 1], Y[j + 1], Z[k + 1]], cell = [i, j, k];
    for (let a = 0; a < 3; a++) for (const s of [-1, 1]) {
      const nb = cell.slice(); nb[a] += s;
      if (at(nb[0], nb[1], nb[2])) continue;
      // The quad on side s of axis a, wound counter-clockwise seen from outside (along +n).
      const u = (a + 1) % 3, v = (a + 2) % 3, w = s > 0 ? hi[a] : lo[a];
      const corner = (cu: number, cv: number) => { const p = [0, 0, 0]; p[a] = w; p[u] = cu; p[v] = cv; return p; };
      const q = s > 0 ? [corner(lo[u], lo[v]), corner(hi[u], lo[v]), corner(hi[u], hi[v]), corner(lo[u], hi[v])]
        : [corner(lo[u], lo[v]), corner(lo[u], hi[v]), corner(hi[u], hi[v]), corner(hi[u], lo[v])];
      const b = g.pos.length / 3, n = [0, 0, 0]; n[a] = s;
      for (const p of q) { g.pos.push(p[0], p[1], p[2]); g.nor.push(n[0], n[1], n[2]); g.uv.push(0, 0); }
      g.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  return g;
}

interface Face { n: number[]; d: number; poly: number[][] }
const dot3 = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Flat sides of a convex mesh, outward, each with its outline as an ordered polygon; null when not convex. */
function facesOf(g: Geo): Face[] | null {
  const P: number[][] = [];
  for (let i = 0; i < g.pos.length; i += 3) P.push([g.pos[i], g.pos[i + 1], g.pos[i + 2]]);
  if (!P.length) return null;
  const c = [0, 1, 2].map((a) => P.reduce((s, p) => s + p[a], 0) / P.length);
  const groups: { n: number[]; d: number; pts: number[][] }[] = [];
  for (let i = 0; i < g.idx.length; i += 3) {
    const a = P[g.idx[i]], b = P[g.idx[i + 1]], q = P[g.idx[i + 2]];
    let n = cross3([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [q[0] - a[0], q[1] - a[1], q[2] - a[2]]);
    const l = Math.hypot(n[0], n[1], n[2]); if (l < 1e-12) continue;
    n = n.map((x) => x / l);
    let d = dot3(n, a);
    if (dot3(n, c) > d) { n = n.map((x) => -x); d = -d; }
    let f = groups.find((f) => dot3(f.n, n) > 1 - 1e-6 && Math.abs(f.d - d) < 1e-6);
    if (!f) groups.push(f = { n, d, pts: [] });
    f.pts.push(a, b, q);
  }
  for (const p of P) for (const f of groups) if (dot3(f.n, p) - f.d > 1e-5) return null;
  return groups.map((f) => {
    // Order the side's corners round it (a convex hull in the side's own plane, counter-clockwise about n).
    const u0 = Math.abs(f.n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], u = cross3(f.n, u0), ul = Math.hypot(u[0], u[1], u[2]);
    const U = u.map((x) => x / ul), V = cross3(f.n, U);
    const pts = f.pts.map((p) => ({ p, x: dot3(p, U), y: dot3(p, V) })).sort((a, b) => a.x - b.x || a.y - b.y);
    const cr = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lo: typeof pts = [], hi: typeof pts = [];
    for (const q of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 1e-14) lo.pop(); lo.push(q); }
    for (let i = pts.length - 1; i >= 0; i--) { const q = pts[i]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 1e-14) hi.pop(); hi.push(q); }
    return { n: f.n, d: f.d, poly: lo.slice(0, -1).concat(hi.slice(0, -1)).map((q) => q.p) };
  });
}
/**
 * `g` with the part inside the convex region `R` (planes n·p <= d, all of them) cut away; triangles across
 * its boundary are split. No cap: the hole is left open.
 */
function cutAway(g: Geo, R: { n: number[]; d: number }[]): Geo {
  const out: Geo = { pos: [], nor: [], col: [], uv: [], idx: [] };
  const hasN = g.nor.length > 0, hasC = g.col.length > 0, hasU = g.uv.length > 0;
  interface V { p: number[]; n: number[]; c: number[]; u: number[] }
  const vert = (i: number): V => ({
    p: [g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]], n: hasN ? [g.nor[i * 3], g.nor[i * 3 + 1], g.nor[i * 3 + 2]] : [],
    c: hasC ? [g.col[i * 3], g.col[i * 3 + 1], g.col[i * 3 + 2]] : [], u: hasU ? [g.uv[i * 2], g.uv[i * 2 + 1]] : [],
  });
  const lerp = (a: V, b: V, t: number): V => {
    const m = (x: number[], y: number[]) => x.map((v, k) => v + (y[k] - v) * t);
    return { p: m(a.p, b.p), n: m(a.n, b.n), c: m(a.c, b.c), u: m(a.u, b.u) };
  };
  const emit = (poly: V[]) => {
    if (poly.length < 3) return;
    const b = out.pos.length / 3;
    for (const v of poly) { out.pos.push(...v.p); if (hasN) out.nor.push(...v.n); if (hasC) out.col.push(...v.c); if (hasU) out.uv.push(...v.u); }
    for (let k = 1; k + 1 < poly.length; k++) out.idx.push(b, b + k, b + k + 1);
  };
  /** Split a convex polygon by plane: [the part outside (n·p > d), the part inside]. */
  const split = (poly: V[], n: number[], d: number): [V[], V[]] => {
    const o: V[] = [], i: V[] = [];
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length], sa = dot3(n, a.p) - d, sb = dot3(n, b.p) - d;
      if (sa > 0) o.push(a); else i.push(a);
      if ((sa > 0) !== (sb > 0)) { const x = lerp(a, b, sa / (sa - sb)); o.push(x); i.push(x); }
    }
    return [o, i];
  };
  for (let t = 0; t < g.idx.length; t += 3) {
    let rest: V[] = [vert(g.idx[t]), vert(g.idx[t + 1]), vert(g.idx[t + 2])];
    // Wholly outside one of the planes: untouched.
    if (R.some((h) => rest.every((v) => dot3(h.n, v.p) - h.d > 0))) { emit(rest); continue; }
    for (const h of R) {
      const [o, i] = split(rest, h.n, h.d);
      emit(o);
      rest = i;
      if (rest.length < 3) break;
    }
    // Whatever is left lies inside R: dropped.
  }
  return out;
}
/**
 * Item models: remove outline that floats in front of another part. Each part's ink hull is `t` bigger
 * than the part, so wherever the part sits behind, flush with or just under another part's face
 * (a grip pushed into a slide, a stock butted onto a receiver, a body behind a drum's rim, two bars of
 * one cross) its hull pokes out in front of that face as a dark line across it. The part never comes
 * out through that face, so its outline has no business there: the hull is cut away over the face's
 * footprint, from a hair inside it outwards. Outlines round a part that does come out through a face
 * (the contact line round a grip under a slide) are kept. `parts` pairs each solid with its hull (null:
 * none, or a hull of several parts); hulls are replaced in place. Convex solids only.
 */
export function trimHulls(parts: { solid: Geo; hull: Geo | null }[], eps = 0.0005): void {
  const bounds = (pos: number[]) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i++) { const a = i % 3; lo[a] = Math.min(lo[a], pos[i]); hi[a] = Math.max(hi[a], pos[i]); }
    return { lo, hi };
  };
  const apart = (a: { lo: number[]; hi: number[] }, b: { lo: number[]; hi: number[] }) => [0, 1, 2].some((k) => a.hi[k] < b.lo[k] - 1e-4 || b.hi[k] < a.lo[k] - 1e-4);
  const info = parts.map((p) => {
    const P: number[][] = []; for (let i = 0; i < p.solid.pos.length; i += 3) P.push([p.solid.pos[i], p.solid.pos[i + 1], p.solid.pos[i + 2]]);
    return { verts: P, box: bounds(p.solid.pos), faces: null as Face[] | null, done: false };
  });
  const facesFor = (k: number) => { const f = info[k]; if (!f.done) { f.faces = facesOf(parts[k].solid); f.done = true; } return f.faces; };
  parts.forEach((A, ia) => {
    if (!A.hull) return;
    const hullBox = bounds(A.hull.pos);
    info.forEach((b, ib) => {
      // Only parts the hull actually reaches.
      if (ib === ia || apart(hullBox, b.box)) return;
      const faces = facesFor(ib);
      if (!faces) return;
      for (const F of faces) {
        if (F.poly.length < 3) continue;
        if (apart(hullBox, bounds(F.poly.flat()))) continue;
        // A never comes out through F...
        if (Math.max(...info[ia].verts.map((v) => dot3(F.n, v))) > F.d + 1e-5) continue;
        // ...but its hull does.
        let top = -Infinity; for (let i = 0; i < A.hull!.pos.length; i += 3) top = Math.max(top, dot3(F.n, [A.hull!.pos[i], A.hull!.pos[i + 1], A.hull!.pos[i + 2]]));
        if (top <= F.d + 1e-5) continue;
        // The slab over F's footprint, from a hair inside F to past the hull.
        const R = [{ n: F.n.map((x) => -x), d: -(F.d - eps) }, { n: F.n, d: top + 1e-3 }];
        for (let k = 0; k < F.poly.length; k++) {
          const p = F.poly[k], q = F.poly[(k + 1) % F.poly.length];
          let m = cross3([q[0] - p[0], q[1] - p[1], q[2] - p[2]], F.n); const l = Math.hypot(m[0], m[1], m[2]); if (l < 1e-12) continue;
          m = m.map((x) => x / l);
          const c = F.poly.reduce((s, v) => [s[0] + v[0] / F.poly.length, s[1] + v[1] / F.poly.length, s[2] + v[2] / F.poly.length], [0, 0, 0]);
          if (dot3(m, c) > dot3(m, p)) m = m.map((x) => -x); // pointing out of the face
          R.push({ n: m, d: dot3(m, p) });
        }
        A.hull = cutAway(A.hull!, R);
      }
    });
  });
}

/** Turn `g` inside-out (in place): reversed winding and normals, so back-face culling shows its far side. */
export function insideOut(g: Geo): Geo {
  for (let i = 0; i < g.idx.length; i += 3) { const t = g.idx[i]; g.idx[i] = g.idx[i + 1]; g.idx[i + 1] = t; }
  for (let i = 0; i < g.nor.length; i++) g.nor[i] = -g.nor[i];
  return g;
}

/** `alpha` (optional, one byte per vertex) fills the colour alpha channel, e.g. a part index. */
export function toMesh(device: pc.GraphicsDevice, g: Geo, pin = true, alpha?: ArrayLike<number>): pc.Mesh {
  const mesh = new pc.Mesh(device);
  const n = g.pos.length / 3;
  // Typed copies: the mesh keeps these arrays for its lifetime, and the Geo's plain arrays can then be collected.
  mesh.setPositions(new Float32Array(g.pos));
  if (g.nor.length) mesh.setNormals(new Float32Array(g.nor));
  const c = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const has = g.col.length > 0;
    c[i * 4] = has ? Math.round(g.col[i * 3] * 255) : 255; c[i * 4 + 1] = has ? Math.round(g.col[i * 3 + 1] * 255) : 255;
    c[i * 4 + 2] = has ? Math.round(g.col[i * 3 + 2] * 255) : 255; c[i * 4 + 3] = alpha ? alpha[i] : 255;
  }
  mesh.setColors32(c);
  if (g.uv.length) mesh.setUvs(0, new Float32Array(g.uv));
  mesh.setIndices(n > 65535 ? new Uint32Array(g.idx) : new Uint16Array(g.idx));
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  // Shared meshes outlive any single entity: hold a reference so destroying
  // one mesh instance doesn't free the mesh under the others.
  if (pin) mesh.incRefCount();
  return mesh;
}
