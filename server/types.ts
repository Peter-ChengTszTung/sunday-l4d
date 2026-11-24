// Server-side entity state: players, zombies, hordes and floor hazards the room simulates.
import type { WebSocket } from 'ws';
import type { Side } from './tuning';

export interface Player {
  id: number; ws: WebSocket; name: string; look: number;
  /** `y`: feet height from the client (floor + any jump). */
  x: number; y: number; z: number; ry: number; rx: number;
  /** Floor height under them and their walk-graph node (shared/level.ts), refreshed by `place`. */
  gy: number; node: number;
  hp: number; st: number; w: number; anim: number;
  /** Medical items carried, per kind in MEDS order, and health still to trickle back from Gummy Vitamins (`regen`, at `regenRate` a second). */
  meds: number[]; regen: number; regenRate: number;
  revT: number; reviving: number; respawnT: number; lastFire: number; lastShove: number; kills: number;
  /** Shot clock: scheduled time of the last accepted shot, and the weapon it came from. */ fireW: number;
  /** Launcher grenades fired and not yet claimed ('g'): where and when they left the tube. */
  nades: { x: number; y: number; z: number; t: number; w: number; seq: number; ex: number; ez: number }[];
  /** Weapons the server has seen this player pick up (-1 = none). Fire claims must use one of these or the pistol. */
  primary: number; sidearm: number;
  /** Close-in weapon carried (weapon index, -1 = none), throwables carried (weapon index -> how many; THROW_MAX in all), and armour points left (ARMOR). */
  melee: number; thr: Record<number, number>; armor: number;
  /** Room time until which position updates are still ignored after a hold ends (the client is catching up to where it was dragged). */
  freeAt: number;
  /** Shot clock per weapon index, so alternating weapons can't beat each weapon's own rate. */
  shotAt: Record<number, number>;
  /** Id of the zombie holding this survivor: Charger pin, Snatcher lasso, Piggyback ride (0 = free). While held the server owns their position. */
  pinned: number;
  /** Director pacing: how hard-pressed this survivor is (0..100, server-only). */
  intensity: number;
  /** Times downed since the last medkit, rescue or safe room (SURVIVOR_RULES.downs). */ downs: number;
  /** Solo self-revives left this attempt, and the revive time the current one needs (s). */ selfRev: number; revNeed: number;
  /** Shove fatigue (PLAYER.shoveMax). */ shoveFat: number;
  /** Ammo piles and safe-room weapon stacks this survivor has used (each serves every survivor once). */ ammoUsed: Set<number>;
  /** Mounted gun this survivor is manning (index into ChapterDef.mounts), -1 = none. The server keeps them at its seat. */ mount: number;
}

export interface Zombie {
  /** `y`: floor height it stands on (follows stairs and ladders through Level.moveSlide). */
  id: number; type: number; x: number; y: number; z: number; ry: number; st: number; hp: number; speed: number;
  offX: number; offZ: number; t: number; hitDone: boolean; target: number; dormant: boolean;
  /** Spawned by a dev 'dbgz' message: survives the dev `calm` switch. */ dbg?: boolean;
  stun: number; vx: number; vz: number; leapCd: number; lx: number; lz: number;
  /** Special-ability cooldown (charge, spit, ring), separate from the leaper's `leapCd`. */
  sp: number;
  /** Seconds left fleeing (alarm clock after ringing). */
  flee: number;
  /** Charger pin: time pinned, damage accumulator. */
  pinT: number; acc: number;
  /** Damage taken from survivors while pinning (knocks it off at CHARGER.pinBreakDmg). */ pinHit: number;
  /** Until this room time, chase goo-marked survivors first (puffer wave members). */ hunt: number;
  /** Big Hold On grabber sent at a gunner: that survivor's id while they man a gun (0 = none). */ gunner: number;
  /** Special holding for a coordinated attack: 0 = attacking, 1 = lurking unseen, 2 = lurking but in a survivor's sight (backs off). */
  hold: number;
  /** Id of the queued horde (Wave.id) this walker was spawned for; 0 = not a horde member (ambient, wanderer, holdout). */
  wave: number;
  /** Wanderer region it was placed in (-1 = not a placed wanderer). */
  region: number;
  /** Weeper: still sitting (not yet woken), and her anger 0..1 (WEEPER). */
  sit: boolean; anger: number;
  /** Running straight at its target (the line there is clear, see FOCUS), and seconds until that is tested again. */
  run: boolean; runT: number; /** Survivor `run` was tested toward. */ runTgt: number;
}

/**
 * A queued horde. Members drip in from hidden cells clustered around `srcs` (spawn cells; a second
 * one flanks from another side). `anchor`: cell of the noise that called it (-1 = the team); a lost
 * source is re-picked by the same rule. `hunt`: room time until which members chase marked survivors.
 * `side`: for team-sourced waves, 1 = ahead-biased (default), -1 = from behind (anti-camping), 0 = any.
 */
export interface Wave { id: number; left: number; srcs: number[]; anchor: number; hunt: number; repicks: number; side: Side; requeue?: boolean }

/** Drooler goo in flight (simulated on the server along the same arc the clients draw). */
export interface Glob { x1: number; y1: number; z1: number; t: number }
/** A damaging goo puddle on the floor. */
export interface Puddle { id: number; x: number; y: number; z: number; r: number; life: number; age: number; tick: number }
/** A firebomb's burning patch; `by`: id of the survivor who threw it (kill credit). */
export interface Fire { id: number; x: number; y: number; z: number; r: number; life: number; age: number; tick: number; by: number }
/** A rattling Rattle Bomb: seconds until it goes off, who threw it and with which weapon, and the path field toward it. */
export interface Lure { x: number; y: number; z: number; t: number; by: number; w: number; field: Int16Array }

export interface Checkpoint { step: number; doors: number; taken: number[] }
