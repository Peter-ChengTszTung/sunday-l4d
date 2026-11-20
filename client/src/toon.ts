// Cel-shading toolkit: banded toon materials, inverted-hull outlines and a
// static batcher that bakes many coloured primitives into two draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const INK = 0x1a1226;

export const gradientMap = (() => {
  const data = new Uint8Array([95, 95, 95, 255, 165, 165, 165, 255, 230, 230, 230, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();

/** Shared toon material for anything carrying per-vertex colour. */
export const toonVC = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });

const toonCache = new Map<number, THREE.MeshToonMaterial>();
export function toon(color: number): THREE.MeshToonMaterial {
  let m = toonCache.get(color);
  if (!m) { m = new THREE.MeshToonMaterial({ color, gradientMap }); toonCache.set(color, m); }
  return m;
}

/** Back-face hull pushed out along normals: the classic cartoon ink line. */
export function makeOutlineMaterial(thickness: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { thickness: { value: thickness }, ink: { value: new THREE.Color(INK) } }]),
    vertexShader: /* glsl */ `
      uniform float thickness;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vec3 p = position + normalize(normal) * thickness;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 ink;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        gl_FragColor = vec4(ink, 1.0);
        #include <fog_fragment>
      }`,
    side: THREE.BackSide,
    fog: true,
  });
}
export const outlineMat = makeOutlineMaterial(0.022);
/** Plain back-face ink for hulls whose geometry is already inflated. */
export const inkBackMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });

export function addOutline(mesh: THREE.Mesh, mat: THREE.Material = outlineMat): THREE.Mesh {
  const o = new THREE.Mesh(mesh.geometry, mat);
  o.name = 'outline';
  mesh.add(o);
  return mesh;
}

const _c = new THREE.Color();
/** Returns a clone of `geo` with a flat vertex colour (and optional transform). */
export function tint(geo: THREE.BufferGeometry, color: number, matrix?: THREE.Matrix4): THREE.BufferGeometry {
  const g = geo.clone();
  if (matrix) g.applyMatrix4(matrix);
  _c.setHex(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

export function trs(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
}

export function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(geos, false);
  if (!g) throw new Error('mergeGeometries failed: mismatched attributes');
  for (const x of geos) x.dispose();
  return g;
}

/** Grow a box-like geometry about its centre by a per-axis margin (keeps corners closed). */
function inflateBox(geo: THREE.BufferGeometry, tx: number, ty: number, tz: number): THREE.BufferGeometry {
  const g = geo.clone();
  const pos = g.attributes.position as THREE.BufferAttribute;
  g.computeBoundingBox();
  const bb = g.boundingBox!, c = bb.getCenter(new THREE.Vector3()), s = bb.getSize(new THREE.Vector3());
  const kx = (s.x + 2 * tx) / Math.max(s.x, 1e-4), ky = (s.y + 2 * ty) / Math.max(s.y, 1e-4), kz = (s.z + 2 * tz) / Math.max(s.z, 1e-4);
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, c.x + (pos.getX(i) - c.x) * kx, c.y + (pos.getY(i) - c.y) * ky, c.z + (pos.getZ(i) - c.z) * kz);
  return g;
}

/** Push vertices out along their (already world-space) normals. */
function inflateSmooth(g: THREE.BufferGeometry, t: number): void {
  const pos = g.attributes.position as THREE.BufferAttribute, nor = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) + nor.getX(i) * t, pos.getY(i) + nor.getY(i) * t, pos.getZ(i) + nor.getZ(i) * t);
}

/** Collects static coloured primitives and bakes them into one toon mesh + one ink hull. */
export class Batch {
  private solids: THREE.BufferGeometry[] = [];
  private hulls: THREE.BufferGeometry[] = [];

  add(geo: THREE.BufferGeometry, color: number, matrix: THREE.Matrix4, outline: 'box' | 'smooth' | 'none' = 'box', thickness = 0.045): void {
    this.solids.push(tint(geo, color, matrix));
    if (outline !== 'none') {
      let h: THREE.BufferGeometry;
      if (outline === 'box') {
        const sc = new THREE.Vector3().setFromMatrixScale(matrix);
        h = inflateBox(geo, thickness / sc.x, thickness / sc.y, thickness / sc.z);
        h.applyMatrix4(matrix);
      } else {
        h = geo.clone();
        h.applyMatrix4(matrix);
        inflateSmooth(h, thickness);
      }
      h.deleteAttribute('uv'); h.deleteAttribute('normal');
      this.hulls.push(h);
    }
  }

  build(): THREE.Group {
    const g = new THREE.Group();
    if (this.solids.length) g.add(new THREE.Mesh(merge(this.solids), toonVC));
    if (this.hulls.length) g.add(new THREE.Mesh(merge(this.hulls), inkBackMat));
    this.solids = []; this.hulls = [];
    return g;
  }
}

/** A single outlined toon box, for the handful of animated props. */
export function inkBox(w: number, h: number, d: number, color: number, t = 0.03): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toon(color));
  const o = new THREE.Mesh(m.geometry, inkBackMat);
  o.scale.set((w + 2 * t) / w, (h + 2 * t) / h, (d + 2 * t) / d);
  m.add(o);
  return m;
}
