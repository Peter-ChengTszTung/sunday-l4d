// The zombie horde, drawn instanced: every zombie sharing a mesh (a look) is one toon draw and one ink-hull
// draw, and all their ring shadows are one more. Each zombie is still posed on the CPU (chibi.ts); once a
// frame, just before rendering, the ones in view are written out here:
//   - per look, an instance buffer (HORDE_FORMAT): the root's world matrix and normal matrix, exactly the
//     values the engine set as `matrix_model` / `matrix_normal` when each zombie was its own draw, and a row index;
//   - one RGBA32F pose texture, a row per zombie in view: its six part transforms, as `uParts` held them;
//   - one instance buffer (INST_FORMAT) of shadow ring matrices.
// The engine cannot cull single instances, so the frustum test it ran per zombie is run here instead (the same
// test on the same box), which also tells remotes.ts which zombies were on screen.
import * as pc from 'playcanvas';
import { app, device, draw, WORLD, rgb, hordeToonMat, hordeInkMat, makeUnlitInst, HORDE_FORMAT, HORDE_FLOATS, POSE_TEXELS, INST_FORMAT, INST_FLOATS } from './gfx';

/** What the horde draws of one zombie (a Chibi built `instanced`). */
export interface HordeItem {
  /** The look's merged mesh; its `aabb` is the root-space box holding every pose. */
  readonly mesh: pc.Mesh;
  /** World transform of the body (tilt, squash and all) and of the shadow ring. */
  readonly root: pc.GraphNode;
  readonly shadowNode: pc.GraphNode;
  /** The six part transforms, three row vec4s each (POSE_TEXELS * 4 floats). */
  readonly parts: Float32Array;
  /** Wanted on screen (not pooled, not swallowed by the fog). */
  visible: boolean;
  /** Set by `flush`: the body was inside the camera's view when the last frame was drawn. */
  drawn: boolean;
  /** Its place in its look's list (-1: not in the horde). */
  hordeAt: number;
}

interface Look { list: HordeItem[]; cap: number; vb: pc.VertexBuffer; data: Float32Array; ent: pc.Entity; draws: pc.MeshInstance[] }

const POSE_FLOATS = POSE_TEXELS * 4;
const SHADOW_TINT = rgb(0x0a0614);
const _inv = new pc.Mat4(), _view = new pc.Mat4(), _vp = new pc.Mat4(), _box = new pc.BoundingBox(), _frustum = new pc.Frustum();
const grown = (cap: number, need: number) => { while (cap < need) cap *= 2; return cap; };

export class Horde {
  private readonly looks = new Map<pc.Mesh, Look>();
  private count = 0;
  /** Rows the pose texture and the shadow buffer hold. */
  private cap = 0;
  private pose = new Float32Array(0);
  private poseTex: pc.Texture | null = null;
  private shadowVb: pc.VertexBuffer | null = null;
  private shadowData = new Float32Array(0);
  private readonly shadowDraw: pc.MeshInstance;
  /** Last flush: zombies drawn, shadows drawn, and draw calls they took. */
  readonly stats = { bodies: 0, shadows: 0, draws: 0 };

  /** `shadowMesh`: the ring every zombie stands on, `shadowAlpha` its opacity. */
  constructor(private readonly shadowMesh: pc.Mesh, shadowAlpha: number) {
    const ent = new pc.Entity('horde-shadows');
    this.shadowDraw = new pc.MeshInstance(shadowMesh, makeUnlitInst(shadowAlpha));
    // The rings lie on the floor under everything else that blends (smoke, glows, goo): draw them first of
    // the blended draws, rather than wherever one distance for the whole lot would sort them.
    this.shadowDraw.calculateSortDistance = () => 1e6;
    ent.addComponent('render', { meshInstances: [this.shadowDraw], castShadows: false, receiveShadows: false, layers: [WORLD] });
    app.root.addChild(ent);
    this.reserve(64);
    app.on('prerender', () => this.flush(this.camera()));
  }

  add(it: HordeItem): void {
    if (it.hordeAt >= 0) return;
    let L = this.looks.get(it.mesh);
    if (!L) {
      const ent = new pc.Entity('horde');
      const draws = [draw(it.mesh, hordeToonMat), draw(it.mesh, hordeInkMat)];
      ent.addComponent('render', { meshInstances: draws, castShadows: false, receiveShadows: false, layers: [WORLD] });
      app.root.addChild(ent);
      L = { list: [], cap: 0, vb: null as unknown as pc.VertexBuffer, data: new Float32Array(0), ent, draws };
      this.looks.set(it.mesh, L);
      this.size(L, 16);
    }
    it.hordeAt = L.list.length;
    L.list.push(it);
    this.count++;
  }

  remove(it: HordeItem): void {
    const L = this.looks.get(it.mesh);
    if (!L || it.hordeAt < 0) return;
    const last = L.list.pop()!;
    if (last !== it) { L.list[it.hordeAt] = last; last.hordeAt = it.hordeAt; }
    it.hordeAt = -1; it.drawn = false;
    this.count--;
  }

  /** A look's instance buffer, `cap` zombies long (not culled by the engine: `flush` fills in only those in view). */
  private size(L: Look, cap: number): void {
    const old = L.vb as pc.VertexBuffer | null;
    L.cap = cap;
    L.vb = new pc.VertexBuffer(device, HORDE_FORMAT, cap, { usage: pc.BUFFER_DYNAMIC });
    L.data = new Float32Array(cap * HORDE_FLOATS);
    for (const mi of L.draws) { mi.setInstancing(L.vb); mi.instancingCount = 0; }
    old?.destroy();
  }

  /** Room for `cap` zombies in the pose texture and the shadow buffer. */
  private reserve(cap: number): void {
    this.cap = cap;
    this.pose = new Float32Array(cap * POSE_FLOATS);
    this.poseTex?.destroy();
    this.poseTex = new pc.Texture(device, {
      name: 'horde-pose', width: POSE_TEXELS, height: cap, format: pc.PIXELFORMAT_RGBA32F, mipmaps: false,
      minFilter: pc.FILTER_NEAREST, magFilter: pc.FILTER_NEAREST, addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE, levels: [this.pose],
    });
    hordeToonMat.setParameter('uPose', this.poseTex); hordeInkMat.setParameter('uPose', this.poseTex);
    const old = this.shadowVb;
    this.shadowVb = new pc.VertexBuffer(device, INST_FORMAT, cap, { usage: pc.BUFFER_DYNAMIC });
    this.shadowData = new Float32Array(cap * INST_FLOATS);
    this.shadowDraw.setInstancing(this.shadowVb); this.shadowDraw.instancingCount = 0;
    old?.destroy();
  }

  /** The camera that draws the world. */
  private camera(): pc.CameraComponent | null {
    for (const c of app.systems.camera!.cameras) if (c.enabled && c.entity.enabled && c.layers.includes(WORLD)) return c;
    return null;
  }

  /**
   * Write out every zombie `cam` can see, for the frame about to be drawn. The view test is the engine's own
   * (Camera#updateFrustum, then the mesh's box under the root's transform against it), run a moment early.
   */
  flush(cam: pc.CameraComponent | null): void {
    const st = this.stats;
    st.bodies = st.shadows = st.draws = 0;
    if (!cam) {
      for (const L of this.looks.values()) { for (const it of L.list) it.drawn = false; for (const mi of L.draws) mi.instancingCount = 0; }
      this.shadowDraw.instancingCount = 0;
      return;
    }
    if (this.count > this.cap) this.reserve(grown(this.cap, this.count));
    _inv.setTRS(cam.entity.getPosition(), cam.entity.getRotation(), pc.Vec3.ONE);
    _view.copy(_inv).invert();
    _vp.mul2(cam.projectionMatrix, _view);
    _frustum.setFromMat4(_vp);
    const pose = this.pose, shadow = this.shadowData, ringBox = this.shadowMesh.aabb;
    let row = 0, rings = 0;
    for (const L of this.looks.values()) {
      const list = L.list;
      if (list.length > L.cap) this.size(L, grown(L.cap, list.length));
      const data = L.data, box = list.length ? list[0].mesh.aabb : null;
      let n = 0;
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        if (!it.visible) { it.drawn = false; continue; }
        const sw = it.shadowNode.getWorldTransform();
        _box.setFromTransformedAabb(ringBox, sw);
        if (_frustum.containsAabb(_box)) {
          const o = rings++ * INST_FLOATS;
          shadow.set(sw.data, o);
          shadow[o + 16] = SHADOW_TINT[0]; shadow[o + 17] = SHADOW_TINT[1]; shadow[o + 18] = SHADOW_TINT[2]; shadow[o + 19] = 1;
        }
        const w = it.root.getWorldTransform();
        _box.setFromTransformedAabb(box!, w);
        if (!(it.drawn = _frustum.containsAabb(_box))) continue;
        const o = n++ * HORDE_FLOATS, nm = it.root.normalMatrix.data;
        data.set(w.data, o);
        data[o + 16] = nm[0]; data[o + 17] = nm[1]; data[o + 18] = nm[2]; data[o + 19] = row;
        data[o + 20] = nm[3]; data[o + 21] = nm[4]; data[o + 22] = nm[5]; data[o + 23] = 0;
        data[o + 24] = nm[6]; data[o + 25] = nm[7]; data[o + 26] = nm[8]; data[o + 27] = 0;
        pose.set(it.parts, row++ * POSE_FLOATS);
      }
      if (n) { L.vb.setData(data); st.draws += L.draws.length; }
      for (const mi of L.draws) mi.instancingCount = n;
    }
    if (row) this.poseTex!.upload();
    if (rings) { this.shadowVb!.setData(shadow); st.draws++; }
    this.shadowDraw.instancingCount = rings;
    st.bodies = row; st.shadows = rings;
  }

  /** For checks: a look's instance buffer contents and count, and the pose rows. */
  peek(mesh: pc.Mesh): { data: Float32Array; n: number; pose: Float32Array; shadow: Float32Array } | null {
    const L = this.looks.get(mesh);
    return L ? { data: L.data, n: L.draws[0].instancingCount, pose: this.pose, shadow: this.shadowData } : null;
  }
}
