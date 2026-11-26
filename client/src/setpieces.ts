// Scripted moments on quest steps that carry a `cue` (shared/level.ts StepCue). Purely cosmetic and
// client-side: they read the step index and whether a holdout is running, and never touch the sim.
//   lift: the floor indicator over the nearest lift door counts the car down through the hold
//         (3, 2, 1, G, with a chime at each floor); when the step completes the car faults: a thud,
//         sparks and a buzzer, and the indicator blinks FAULT from then on.
//   tram: the nearest tram (a 'bus' prop) powers up when its hold starts: headlamps and cabin lights
//         come on, the line crackles at the pantograph, and the bell clangs until the hold is over.
import * as pc from 'playcanvas';
import { TILE, CEIL_H, STOREY } from '../../shared/constants';
import { type Level, type Step } from '../../shared/level';
import { box, make, trs, toMesh } from './geo';
import { app, device, DRAW, drawAs, makeUnlit, meshEntity, canvasTexture, freeTexture, setTint } from './gfx';
import type { Sfx } from './audio';
import type { FX } from './fx';

export interface SetPieces {
  /** `step`: the quest step on now; `hold`: a holdout is running. */
  update(t: number, dt: number, step: number, hold: boolean): void;
  dispose(): void;
}

const T = TILE;

/** Indicator faces: one small texture each (amber digits, a red FAULT). */
function paintPanel(text: string, color: string): HTMLCanvasElement {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 48;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#14121e'; g.fillRect(0, 0, 128, 48);
  g.strokeStyle = '#5a5f74'; g.lineWidth = 4; g.strokeRect(2, 2, 124, 44);
  // The panel's front face maps the texture upside down: paint the text flipped so it reads upright.
  g.translate(0, 48); g.scale(1, -1);
  g.fillStyle = color; g.font = `bold ${text.length > 2 ? 26 : 34}px monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 64, 26);
  return cv;
}

export function buildSetPieces(L: Level, sfx: Sfx, fx: FX): SetPieces {
  const def = L.def;
  const root = new pc.Entity('setpieces');
  app.root.addChild(root);
  const meshes: pc.Mesh[] = [], materials: pc.Material[] = [], textures: pc.Texture[] = [];
  const boxMesh = (m: pc.Mat4) => { const me = toMesh(device, make(box(), undefined, m)); meshes.push(me); return me; };
  const unlit = (color: number, tex?: pc.Texture) => { const m = drawAs(DRAW.PIECE, makeUnlit({ color, fog: true, tex })); materials.push(m); return m; };
  const pieces: ((t: number, dt: number, step: number, hold: boolean) => void)[] = [];

  def.steps.forEach((s, i) => {
    if (!s.cue || s.target === undefined) return;
    const obj = def.pickups[s.target];
    if (s.cue === 'lift') pieces.push(liftPiece(i, s, obj.x, obj.z));
    else if (s.cue === 'tram') pieces.push(tramPiece(i, s, obj.x, obj.z));
  });

  /** Elevator floor indicator over the lift door nearest the call button. */
  function liftPiece(i: number, s: Step, bx: number, bz: number) {
    const lifts = def.doors.filter((d) => d.kind === 'lift');
    const centre = (d: (typeof lifts)[number]) => [((d.x0 + d.x1 + 1) / 2) * T, ((d.z0 + d.z1 + 1) / 2) * T] as const;
    const d = lifts.sort((a, b) => Math.hypot(centre(a)[0] - bx, centre(a)[1] - bz) - Math.hypot(centre(b)[0] - bx, centre(b)[1] - bz))[0];
    if (!d) return () => {};
    const [cx, cz] = centre(d), base = (d.lv ?? 0) * STOREY;
    const alongX = d.x1 - d.x0 >= d.z1 - d.z0;
    // On the face of the door that looks at the button, high up.
    const side = alongX ? Math.sign(bz - cz) || 1 : Math.sign(bx - cx) || 1;
    // The door slab is 0.4 m thick: the panel sits just proud of its face.
    const px = alongX ? cx : cx + side * 0.24, pz = alongX ? cz + side * 0.24 : cz;
    const faces: Record<string, pc.Texture> = {};
    for (const [k, c] of [['3', '#ffb347'], ['2', '#ffb347'], ['1', '#ffb347'], ['G', '#ffd43b'], ['FAULT', '#ff4d5e'], ['', '#000']] as const) {
      const tex = canvasTexture(() => paintPanel(k, c), false); textures.push(tex); faces[k] = tex;
    }
    const panel = meshEntity(boxMesh(trs(0, 0, 0, 0, alongX ? 0 : Math.PI / 2, 0, 2.2, 0.82, 0.04)), unlit(0xffffff, faces['3']));
    panel.setPosition(px, base + CEIL_H - 0.9, pz);
    root.addChild(panel);
    const show = (k: string) => panel.render!.meshInstances[0].setParameter('uTex', faces[k]);
    let shown = '3', holdT = -1, faulted = false, seen = -1;
    return (t: number, dt: number, step: number, hold: boolean) => {
      let want = '3';
      if (step === i && hold) {
        if (holdT < 0) holdT = 0;
        holdT += dt;
        const per = (s.hold ?? 60) / 4;
        want = ['3', '2', '1', 'G'][Math.min(3, Math.floor(holdT / per))];
      } else if (step > i) {
        // Only a fault seen happening plays its thud and sparks; joining later just finds it broken.
        if (!faulted && seen === i) {
          sfx.at(base).liftFault(cx, cz);
          for (let k = 0; k < 3; k++) fx.burst({ x: px, y: base + CEIL_H - 0.6 - k * 0.5, z: pz }, 0xfff1a8, 12, 5, 0.13, true, 0.6, 9);
        }
        faulted = true;
        want = Math.sin(t * 5) > -0.2 ? 'FAULT' : '';
      }
      if (step === i) seen = i;
      if (want !== shown) {
        if (step === i && hold && want !== '3') sfx.at(base).liftDing(cx, cz);
        show(want); shown = want;
      }
    };
  }

  /** Headlamps, cabin lights, pantograph sparks and the bell on the tram nearest the lever. */
  function tramPiece(i: number, s: Step, lx: number, lz: number) {
    const trams = def.props.filter((p) => p.type === 'bus');
    const mid = (p: (typeof trams)[number]) => [(p.x + p.w / 2) * T, (p.z + p.d / 2) * T] as const;
    const p = trams.sort((a, b) => Math.hypot(mid(a)[0] - lx, mid(a)[1] - lz) - Math.hypot(mid(b)[0] - lx, mid(b)[1] - lz))[0];
    if (!p) return () => {};
    const [cx, cz] = mid(p), base = (p.lv ?? 0) * STOREY;
    // Same frame as the prop's own model (world.ts): its windscreen faces local -z.
    const ry = p.rot ?? (p.w > p.d ? Math.PI / 2 : 0);
    const len = Math.max(p.w, p.d) * T, wid = Math.min(p.w, p.d) * T, w = Math.min(wid - 0.2, 2.5), l = len - 0.3;
    const frame = new pc.Entity('tram');
    frame.setPosition(cx, base, cz); frame.setEulerAngles(0, (ry * 180) / Math.PI, 0);
    root.addChild(frame);
    const lampMat = unlit(0x3a3a46), cabinMat = unlit(0xfff1b0);
    const lamps: pc.Entity[] = [];
    for (const sx of [-1, 1]) {
      const e = meshEntity(boxMesh(trs(sx * w * 0.32, 0.95, -l / 2 - 0.04, 0, 0, 0, 0.42, 0.3, 0.06)), lampMat);
      frame.addChild(e); lamps.push(e);
    }
    // Lit cabin: a warm band over the dark window strip (a hair proud of it on every side).
    const cabin = meshEntity(boxMesh(trs(0, 2.0, 0, 0, 0, 0, w + 0.08, 0.7, l * 0.9)), cabinMat);
    cabin.enabled = false; frame.addChild(cabin);
    const roof = (): { x: number; y: number; z: number } => ({ x: cx + (Math.random() - 0.5) * 2, y: base + 2.95, z: cz + (Math.random() - 0.5) * 2 });
    let on = false, bellT = 0, sparkT = 0;
    const powerUp = (live: boolean) => {
      on = true; cabin.enabled = true;
      for (const e of lamps) setTint(e, 0xfff6d0);
      if (live) { sfx.tramPower(cx, cz); for (let k = 0; k < 2; k++) fx.burst(roof(), 0xbfe6ff, 10, 4, 0.07, true, 0.4, 6); }
    };
    return (_t: number, dt: number, step: number, hold: boolean) => {
      if (!on && (step > i || (step === i && hold))) powerUp(step === i);
      if (!(step === i && hold)) return;
      bellT -= dt; sparkT -= dt;
      if (bellT <= 0) { bellT = 2.4; sfx.tramBell(cx, cz); }
      if (sparkT <= 0) { sparkT = 1.5 + Math.random() * 2.5; fx.burst(roof(), 0xbfe6ff, 6, 3.5, 0.06, true, 0.35, 6); }
    };
  }

  return {
    update(t, dt, step, hold) { for (const f of pieces) f(t, dt, step, hold); },
    dispose() {
      root.destroy();
      for (const m of meshes) m.destroy();
      for (const m of materials) m.destroy();
      for (const x of textures) freeTexture(x);
    },
  };
}
