// Booby traps on the client (docs/booby-traps.html; server/traps.ts owns them): each trap's state from
// the server ('trap' / 'traps' events, 'w' tr/ton), the sounds it makes, and its look (trapgfx.ts).
// Purely presentational: nothing here touches the sim.
import { TRAP, TRAP_ST } from '../../shared/constants';
import type { Level } from '../../shared/level';
import type { Sfx } from './audio';
import { buildTrapLooks } from './trapgfx';

export interface TrapView {
  /** Trap `id` is now in TRAP_ST `state`. `quiet`: a resync (join, restart): no sound. */
  set(id: number, state: number, quiet?: boolean): void;
  /** Armed traps are live (lit) or dark (a holdout or Brute fight is on). */
  setLive(on: boolean): void;
  /** Everything armed and live again (a 'reset'). */
  rearm(): void;
  update(t: number, dt: number, camX: number, camY: number, camZ: number): void;
  dispose(): void;
}

/** Seconds between car-alarm pulses while it rings (each pulse is one bar of the jingle). */
const CAR_PULSE = 0.5;

export function buildTraps(L: Level, sfx: Sfx): TrapView {
  const list = L.def.traps;
  const st = new Uint8Array(list.length), ringT = new Float32Array(list.length), pulseT = new Float32Array(list.length);
  const pulseN = new Int32Array(list.length);
  let live = true;
  const looks = buildTrapLooks(L);
  const show = () => { for (let i = 0; i < list.length; i++) looks.set(i, st[i], live, ringT[i]); };
  show();
  return {
    set(id, state, quiet) {
      const tr = list[id];
      if (!tr || st[id] === state) return;
      const was = st[id];
      st[id] = state;
      if (state === TRAP_ST.RING) { ringT[id] = tr.kind === 'car' ? TRAP.car.ring : TRAP.light.ring; pulseT[id] = 0; pulseN[id] = 0; }
      else ringT[id] = 0;
      if (!quiet) {
        const s = sfx.at(tr.y);
        if (state === TRAP_ST.WARN) s.nightChirp(tr.x, tr.z);
        else if (state === TRAP_ST.RING && tr.kind === 'light') s.nightLullaby(tr.x, tr.z);
        else if (state === TRAP_ST.SPENT && was === TRAP_ST.RING) s.trapWindDown(tr.kind, tr.x, tr.z);
        else if (state === TRAP_ST.SPENT) s.trapBreak(tr.kind, tr.x, tr.z);
      }
      looks.set(id, state, live, ringT[id]);
    },
    setLive(on) { if (on !== live) { live = on; show(); } },
    rearm() { st.fill(0); ringT.fill(0); live = true; show(); },
    update(t, dt, camX, camY, camZ) {
      for (let i = 0; i < list.length; i++) {
        if (st[i] !== TRAP_ST.RING) continue;
        ringT[i] = Math.max(0, ringT[i] - dt);
        const tr = list[i];
        if (tr.kind !== 'car') continue;
        // The jingle runs bar by bar until the server says it stopped.
        if ((pulseT[i] -= dt) <= 0) { pulseT[i] += CAR_PULSE; sfx.at(tr.y).carAlarm(tr.x, tr.z, pulseN[i]++); }
      }
      looks.update(t, dt, camX, camY, camZ, st, ringT);
    },
    dispose() { looks.dispose(); },
  };
}
