// One co-op session: authoritative zombies, director, health, pickups and the
// chapter's quest steps. Players are trusted for their own movement and hit
// claims (validated loosely).
import type { WebSocket } from 'ws';
import { TILE, STOREY, LADDER_SPEED, ZOMBIE_LADDER, TICK_HZ, SNAP_EVERY, MAX_PLAYERS, PLAYER, WEAPONS, shotDamage, blastPower, blastRadius, blastDamage, ZTYPES, ZT, ZSTATE, PSTATE, SURVIVORS, CHARGER, DROOLER, ALARM, SNATCHER, PIGGY, WEEPER, FIRE, LURE, ARMOR, INTRO, introduced, isCommon, armoredFront, TINPOT_FRONT, ZHIT, meleeDamage, THROW_MAX, packThrowables, SURVIVOR_RULES, HEAL_MIN, MEDS, medIndex, packMeds, medUseful, shoveFatigue, shoveCooldown, type BlastDef, type DifficultyId, type WeaponDef } from '../shared/constants';
import { F, ALL_OPEN, cellOf, type HoldStage, type HoldStageKind, type Level, type Pos3, type Rect, type Step, type Vec2 } from '../shared/level';
import { getLevel, chapterCount } from '../shared/chapters';
import { wandererRegions, type Regions } from '../shared/regions';
import type { ClientMsg, GameEvent, PlayerSnap, ServerMsg, ZombieSnap } from '../shared/protocol';

const INF = 32767;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const r2 = (v: number) => Math.round(v * 100) / 100;
// Overridable so the smoke test doesn't have to sit through holdouts.
const HOLD_SCALE = Number(process.env.HOLDOUT_SCALE) || 1;
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
/**
 * Storeys (shared/level.ts). Sight tests run eye to eye, EYE m above each thing's floor height. REACH_DY:
 * the most floor-height difference across which bites, melee, shoves, pickups, revives and floor hazards
 * connect (a flight of stairs is within it, the storey above is not: a zombie in the street can't bite
 * someone on the roof over it).
 */
const EYE = 1.2, REACH_DY = 1.6;
/**
 * Dormant wanderers, placed once per region per attempt (regions and density: shared/regions.ts).
 * Every `every` s the director measures each region's distance from the team on `reach` (path tiles
 * from the standing survivors with the current step's doors already open, so the street beyond
 * the next door is stocked before it opens). A region within `act` tiles that hasn't been placed
 * yet gets its rolled budget (weight x `roll`): sleepers in clumps of 1-3 (`clump` weights), on cells
 * `near`..`far` tiles out and hidden from every survivor (20 m). Each sleeper placed
 * counts against the budget for good: killing or waking it never refunds. A region is spent once a
 * survivor comes within `visit` tiles; until then a budget cut short by the `max` live-sleeper cap
 * (perf/bandwidth) or by visible cells tops up on later passes. Sleepers more than `cull` tiles away
 * (or cut off by a door) and out of sight are removed; one from an unspent region is refunded to it.
 * At the cap, sleepers from spent regions more than `evict` tiles away make room for unspent ones.
 */
const WANDERERS = {
  every: 1, act: 40, near: 10, far: 56, cull: 64, evict: 28, visit: 4, max: 40,
  roll: [0.75, 1.25] as const, clump: [0.55, 0.3, 0.15] as const, triesPer: 6, triesMax: 160,
};
/** Director spawns never appear closer than this (metres) to any survivor. */
const MIN_SPAWN_DIST = 16;
/** Horde waves: members spawn within CLUSTER tiles of their source; FLANK_CHANCE that a big team-sourced
 * wave (FLANK_MIN+) also comes from a second side; NOISE_REACH: how far (path tiles) a noise source may sit
 * from the noise; GOO_HUNT: seconds a gooed survivor stays marked (wave members chase them first). */
const CLUSTER = 3, FLANK_CHANCE = 0.22, FLANK_MIN = 10, NOISE_REACH = 12, GOO_HUNT = 12;

/**
 * Adaptive pacing (L4D-style). Each survivor has an intensity 0..100 that rises when they are hurt,
 * downed, pinned/leaped/charged, gooed or kill zombies close by, and decays only while nothing
 * active is near them. The director cycles BUILD_UP -> SUSTAIN -> FADE -> RELAX on the team's
 * (max) intensity. Times in seconds, distances in metres unless noted.
 */
const DIRECTOR = {
  // Intensity gains.
  dmg: 0.8, // per hp of damage taken
  down: 35, pin: 25, leap: 15, charge: 12, goo: 15,
  // Per zombie that dies within killR of the survivor; killFar for one further out, within killFarR
  // (fighting at range still builds toward a breather, just slower).
  kill: 2, killR: 6, killFar: 1, killFarR: 15,
  // Intensity decay: per second, only while no active zombie is within engageR (and not pinned).
  decay: 4, engageR: 9,
  peak: 70, // team intensity that ends BUILD_UP
  // BUILD_UP also ends (-> SUSTAIN) after this long (rolled, x difficulty `build`), so a team that
  // never gets hurt enough to peak still gets its FADE/RELAX breathers.
  buildMax: [60, 90] as const,
  sustain: [3, 5] as const,
  // FADE ends when the wave queue is empty and at most fadeQuiet active walkers are within
  // fadeNear path tiles of the team, or after fadeMax.
  fadeQuiet: 3, fadeNear: 15, fadeMax: 25,
  // RELAX: at least relaxMin, then until relaxMax (rolled) or the team advances relaxAdvance tiles.
  relaxMin: 15, relaxMax: [30, 45] as const, relaxAdvance: 20,
  // Mob timer: counts down only in BUILD_UP; x mobMove while the team advanced in the last
  // advanceWindow, x mobStill otherwise.
  mobFirst: [80, 110] as const, mobEvery: [75, 120] as const, mobMove: 1.4, mobStill: 0.6, advanceWindow: 8,
  mobAfterHoldout: [70, 100] as const,
  // Anti-camping: this long in BUILD_UP without progress (outside holdouts/safe rooms) -> a horde from behind.
  camp: 80,
  /**
   * Specials (L4D2-style). `slots[n - 1]` specials may be alive at once for n players (the Brute is
   * extra; per-type caps are in pickSpecial). A type whose last one dies is off for its rolled `cd`
   * (the Alarm Clock uses its own `alarmAt`). Free slots fill one at a time every `fill` s, after
   * `first` s, in BUILD_UP/SUSTAIN only. New specials spawn *holding*: they lurk unseen `holdNear`..
   * `holdFar` path tiles from their target and attack together once the slots are full or `maxWait`
   * s after the first holder spawned. A holder that is spotted (in sight within `spotClose` m, or
   * in a survivor's view cone `spotCone` within `spotR` m), hurt, or walked up on (`closeTiles`)
   * attacks at once and cuts the rest's wait to `blownWait`. Holdouts skip all this: their specials
   * come in pushes on their own clock (DIRECTOR.holdout).
   * `place[type]`: chance of [ahead, level/flank, behind] the team; the rest anywhere.
   */
  specials: {
    slots: [2, 2, 3, 4], first: [20, 30] as const, fill: [4, 8] as const,
    cd: { [ZT.LEAPER]: [16, 26], [ZT.PUFFER]: [18, 28], [ZT.CHARGER]: [24, 36], [ZT.DROOLER]: [18, 28], [ZT.SNATCHER]: [22, 32], [ZT.PIGGYBACK]: [20, 30] } as Record<number, readonly [number, number]>,
    maxWait: 22, blownWait: 3, holdNear: 6, holdFar: 10, closeTiles: 4, spotR: 26, spotClose: 9, spotCone: 0.6,
    place: {
      [ZT.CHARGER]: [0.75, 0.2, 0], // needs a straight run at the team: meet them head on
      [ZT.LEAPER]: [0.1, 0.5, 0.3], [ZT.PUFFER]: [0.15, 0.45, 0.3], [ZT.DROOLER]: [0.1, 0.5, 0.3],
      [ZT.ALARM]: [0.6, 0.25, 0], // has to be found to matter
      [ZT.SNATCHER]: [0.2, 0.55, 0.2], // pulls from a side street
      [ZT.PIGGYBACK]: [0.1, 0.4, 0.45], // jumps the back marker
    } as Record<number, readonly [number, number, number]>,
    // Lone wolf (2+ players): a survivor further than `lonerDist` m (walking, if they can't see each
    // other) from every standing teammate for `lonerTime` s is singled out until back within
    // `lonerExit` m. `lonerBias` of special spawns then come `lonerSpawn` path tiles from them, and
    // specials within `lonerReach` path tiles of them go for them (unless someone is within 4 m).
    lonerDist: 14, lonerExit: 11, lonerTime: 2, lonerBias: 0.7, lonerSpawn: [6, 14] as const, lonerReach: 30,
  },
  /**
   * Roaming Brute (L4D Tank-flow style). Each attempt (fresh start or checkpoint restart) rolls, with
   * `chance` (`scriptedChance` in a chapter that already has a `brute: true` step), a point in the
   * `band` fraction of the chapter's route (ChapterData.route, path tiles), at least `minAhead` past
   * where the attempt starts. A point within `clearance` tiles of a safe room or a holdout's machine,
   * or from `clearance` before to `scriptGap` after where a scripted Brute's step begins, is rejected
   * (up to `tries` draws, then no Brute this attempt). When the team's route progress passes it the
   * Brute spawns `spawn` path tiles ahead, hidden; deferred during holdouts, while the whole team is
   * in a safe room, or while another Brute is alive. While a Brute is up the mob timer and
   * anti-camping pause (it is the peak; specials still fill their slots).
   */
  boss: {
    chance: 0.8, scriptedChance: 0.4, band: [0.3, 0.7] as const, minAhead: 20,
    clearance: 25, scriptGap: 70, tries: 12, spawn: [12, 24] as const,
  },
  /**
   * The Weeper (L4D Witch style): each attempt rolls, with `chance` (x difficulty `brute`), a point in
   * the `band` fraction of the route at least `minAhead` tiles on and `clearance` from any safe room or
   * holdout, where the campaign has introduced her (INTRO). When the team's route progress passes it
   * she is put down `spawn` path tiles ahead, out of sight, sitting. Never during a holdout.
   */
  weeper: { chance: 0.55, band: [0.12, 0.9] as const, minAhead: 25, clearance: 14, tries: 10, spawn: [14, 26] as const },
  /** Chance a common spawns as an uncommon variant, once INTRO has introduced it. */
  uncommon: { [ZT.TINPOT]: 0.07, [ZT.RAINCOAT]: 0.06 } as Record<number, number>,
  /**
   * Ambient trickle (BUILD_UP/SUSTAIN only, outside holdouts): one running walker every `every` s
   * (minus `perPlayer` s per survivor) while fewer than `target[0] + target[1] * n` commons are up.
   * Both the rate and the target are scaled by a factor: in BUILD_UP it ramps from `rampFrom` to 1
   * over `rampTime` s (pressure grows the longer the build-up lasts), times (1 - `ease` * team
   * intensity / peak) so the trickle backs off as the team nears its peak and lets the fight finish
   * the job; SUSTAIN runs at `sustain`. FADE/RELAX: none. A spawn is a clump of `clump` walkers
   * from one hidden spot with chance `clumpChance` (if the target has room).
   */
  ambient: {
    every: [1.6, 3.2] as const, perPlayer: 0.25, minEvery: 0.5, target: [3, 3] as const,
    rampFrom: 0.45, rampTime: 60, ease: 0.4, sustain: 1, clumpChance: 0.25, clump: [2, 3] as const,
  },
  /**
   * Straggler cull (every `every` ticks): an active common or special (never the Brute or a sleeper)
   * more than `tiles` path tiles from the nearest standing survivor is removed, unless a standing or
   * downed survivor could see it (line of sight within the chapter's fog distance, at most `seeR` m),
   * so nobody watches one vanish, or it is within `downGuard` m of a downed survivor (whoever is
   * chewing on a teammate left behind keeps at it). A culled horde member goes back in the queue (see cullStragglers).
   * Specials just free their slot (no cooldown). Holders lurk holdNear..holdFar tiles from their
   * target, well inside `tiles`, so only one that has truly been left behind is culled.
   */
  cull: { every: 60, tiles: 34, seeR: 110, downGuard: 20 },
  /**
   * Staged holdouts (L4D2 finale/crescendo style): a holdout plays a script of stages (shared/level.ts
   * HoldStage) over its timer. A step's `holdScript` is used as written; otherwise defaultHoldScript
   * builds one from `hold` and the team size:
   *   wave -> breather -> wave + specials -> breather -> final                       (hold < longHold)
   *   wave -> breather -> wave + specials -> breather -> brute|specials -> breather -> final
   * `final` is `finalFrac` of the hold clamped to `finalSecs`; breathers are `breath`, then
   * `shortBreath` ([fraction of the hold, min, max] s); the fight stages share the rest by `split`
   * (`split[2]` = the middle brute/specials stage). The Brute stage is rolled with `bruteChance`, never
   * on a step that already brings one; if a Brute is up when it begins it plays as a specials push.
   * Holds under `shortHold` s are just wave -> final.
   * Per stage kind: `horde` (fraction of a full horde, HORDE.base + HORDE.per x n; the first stage's horde is the step's
   * `horde` flag), `trickle` (s between walkers at one survivor, minus `triPer` per extra one, at
   * least `triMin`; 0 = none) and `push[kind][n - 1]` specials spawned lurking that strike together
   * after at most `pushWait` s (spotting or hurting one blows it sooner). The default script's second
   * wave adds `wave2Push[n - 1]` specials and is `wave2Horde` of a full horde; its middle specials stage
   * brings `midHorde`. Alive specials never exceed `maxSpecials[n - 1]`; in `final` they are topped up
   * toward the push size every `drip` s (attacking at once). `final` also floods from two sides.
   * With the whole team up on a perch (an upper floor under `perchMax` nodes: perchLevel), spawns come
   * from a storey below, up to `perchReach` path tiles further out than usual (trySpawnCell).
   */
  holdout: {
    finalFrac: 0.2, finalSecs: [15, 20] as const, breath: [0.1, 6, 8] as const, shortBreath: [0.07, 4, 6] as const,
    split: [0.35, 0.35, 0.3] as const, longHold: 90, shortHold: 40, bruteChance: 0.4,
    horde: { wave: 1, breather: 0, specials: 0, brute: 0, final: 1.25 } as Record<HoldStageKind, number>,
    trickle: { wave: 1.0, breather: 0, specials: 1.4, brute: 1.8, final: 0.5 } as Record<HoldStageKind, number>,
    triPer: 0.12, triMin: 0.3,
    push: {
      wave: [0, 0, 0, 0], breather: [0, 0, 0, 0], specials: [2, 2, 3, 3], brute: [0, 0, 0, 0], final: [2, 2, 3, 3],
    } as Record<HoldStageKind, readonly number[]>,
    wave2Push: [1, 2, 2, 3] as const, wave2Horde: 0.75, midHorde: 0.5,
    pushWait: 6, maxSpecials: [2, 2, 3, 4] as const, drip: 7, perchReach: 16, perchMax: 300,
    finalMsg: 'Here they come! Hold the line!',
  },
};
/**
 * Room difficulty (ids and labels: shared/constants.ts DIFFICULTIES). Multipliers on DIRECTOR /
 * WANDERERS / zombie tuning, read through `this.diff`; 'normal' is all 1 / 0 = the base tuning.
 *  - `peak`: x DIRECTOR.peak, the team intensity that ends BUILD_UP (also the ambient ease scale).
 *    Higher = the team has to take more before the director backs off. Capped at 95 (intensity tops out at 100).
 *  - `relax`: x DIRECTOR.relaxMin and relaxMax (the RELAX breather).
 *  - `build`: x DIRECTOR.buildMax, the longest a BUILD_UP lasts without reaching the peak.
 *  - `mob`: x horde sizes: timed/camping/lever/step hordes (HORDE), holdout stage hordes, and the
 *    Alarm Clock and puffer-goo waves.
 *  - `mobEvery`: x the mob timer (mobFirst, mobEvery, mobAfterHoldout) and the anti-camping wait.
 *  - `slots[n - 1]`: + special slots for n survivors (DIRECTOR.specials.slots and holdout.maxSpecials), at least 1.
 *  - `spCd`: x special timers: per-type cooldowns, the first fill and the gap between fills.
 *  - `ambient`: x ambient trickle rate and target (and the holdout trickle rate).
 *  - `wander`: x each wanderer region's rolled budget (WANDERERS; the live cap `max` is unchanged).
 *  - `brute`: x roaming Brute chance (boss.chance and scriptedChance, at most 1) and the default
 *    holdout script's Brute stage chance; `bruteHp`: x Brute health.
 *  - `spHp`: x health of the other specials (leaper, puffer, charger, drooler, alarm clock).
 *  - `dmg`: x all damage zombies (and goo puddles) deal to survivors.
 *  - `intro`: + campaign position for INTRO (new infected types show up that much sooner; negative = later).
 *  - `ladder`: most zombies on one ladder at once (the rest wait at its foot or top); 1 = single file.
 * Survivor-side rules (respawn, downs, medkit heal, solo self-revives) are shared/constants.ts SURVIVOR_RULES.
 */
const DIFFICULTY: Record<DifficultyId, {
  peak: number; relax: number; build: number; mob: number; mobEvery: number; slots: readonly number[]; spCd: number;
  ambient: number; wander: number; brute: number; bruteHp: number; spHp: number; dmg: number; intro: number; ladder: number;
}> = {
  easy: { peak: 0.75, relax: 1.3, build: 0.75, mob: 0.7, mobEvery: 1.3, slots: [-1, -1, -1, -1], spCd: 1.35, ambient: 0.6, wander: 0.8, brute: 0.6, bruteHp: 0.8, spHp: 0.85, dmg: 0.5, intro: -0.08, ladder: 1 },
  normal: { peak: 1, relax: 1, build: 1, mob: 1, mobEvery: 1, slots: [0, 0, 0, 0], spCd: 1, ambient: 1, wander: 1, brute: 1, bruteHp: 1, spHp: 1, dmg: 1, intro: 0, ladder: 5 },
  hard: { peak: 1.2, relax: 0.75, build: 1.3, mob: 1.25, mobEvery: 0.85, slots: [0, 0, 1, 1], spCd: 0.85, ambient: 1.2, wander: 1.2, brute: 1.15, bruteHp: 1.15, spHp: 1.1, dmg: 1.5, intro: 0.05, ladder: 5 },
  nightmare: { peak: 1.35, relax: 0.55, build: 1.6, mob: 1.5, mobEvery: 0.7, slots: [1, 1, 1, 1], spCd: 0.7, ambient: 1.4, wander: 1.4, brute: 1.25, bruteHp: 1.3, spHp: 1.25, dmg: 2.2, intro: 0.1, ladder: Infinity },
};
/** Brute health: base + this per survivor beyond the first (before difficulty). */
const BRUTE_HP_PER = 1100;
/** The Brute runs this much faster while its target is further than `far` m away (no kiting it forever in the open). */
const BRUTE_CATCHUP = { mult: 1.3, far: 9 };
/** A full horde: base + per survivor walkers (before difficulty). Solo gets a smaller one, a full squad the same as before. */
const HORDE = { base: 8, per: 5 };
/**
 * Loot thinning, rolled each attempt: medkits kept on the map are at most base + per x survivors, small
 * medical items (plasters, vitamins, cocoa) at most smallBase + smallPer x survivors, wherever they lie;
 * `ammo` of the ammo piles are kept (each pile serves every survivor once, see onUse).
 */
const LOOT = { medBase: 3, medPer: 2, ammo: 0.5, smallBase: 5, smallPer: 3 };
/** Most a launcher blast does to a survivor at its centre (falls to 0 at half its radius). */
const BLAST_FF = 20;
const DIRECTOR_DEBUG = !!process.env.DIRECTOR_DEBUG;
const roll = (r: readonly [number, number]) => rand(r[0], r[1]);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const tenth = (v: number) => Math.round(v * 10) / 10;

/** The staged script for a holdout of `hold` s with no authored `holdScript` (DIRECTOR.holdout). `brute`: include a Brute stage. */
export function defaultHoldScript(hold: number, n: number, brute: boolean): HoldStage[] {
  const H = DIRECTOR.holdout, k = Math.min(Math.max(n, 1), 4) - 1;
  const fin = clamp(hold * H.finalFrac, H.finalSecs[0], H.finalSecs[1]);
  if (hold < H.shortHold) {
    const f = tenth(Math.min(fin, hold * 0.4));
    return [{ kind: 'wave', secs: tenth(hold - f) }, { kind: 'final', secs: f }];
  }
  const b1 = tenth(clamp(hold * H.breath[0], H.breath[1], H.breath[2]));
  const b2 = tenth(clamp(hold * H.shortBreath[0], H.shortBreath[1], H.shortBreath[2]));
  const wave2 = (secs: number): HoldStage => ({ kind: 'wave', secs, horde: H.wave2Horde, specials: H.wave2Push[k] });
  if (hold < H.longHold) {
    const rest = hold - fin - b1 - b2, a = tenth(rest / 2);
    return [{ kind: 'wave', secs: a }, { kind: 'breather', secs: b1 }, wave2(tenth(rest - a)), { kind: 'breather', secs: b2 }, { kind: 'final', secs: tenth(fin) }];
  }
  const rest = hold - fin - b1 - 2 * b2, a = tenth(rest * H.split[0]), b = tenth(rest * H.split[1]), c = tenth(rest - a - b);
  const mid: HoldStage = brute ? { kind: 'brute', secs: c } : { kind: 'specials', secs: c, horde: H.midHorde };
  return [
    { kind: 'wave', secs: a }, { kind: 'breather', secs: b1 }, wave2(b), { kind: 'breather', secs: b2 },
    mid, { kind: 'breather', secs: b2 }, { kind: 'final', secs: tenth(fin) },
  ];
}

const enum Phase { BUILD_UP, SUSTAIN, FADE, RELAX }
const PHASE_NAMES = ['BUILD_UP', 'SUSTAIN', 'FADE', 'RELAX'];
/** Which side of the team a spawn must be on: 1 ahead (toward the objective), -1 behind, 2 level with it (a flank), 0 any. */
type Side = -1 | 0 | 1 | 2;
/** Specials that hold for a coordinated attack and go for a lone survivor (not the Alarm Clock: it keeps away and rings). */
const AMBUSHER = (type: number) => type === ZT.LEAPER || type === ZT.PUFFER || type === ZT.CHARGER || type === ZT.DROOLER || type === ZT.SNATCHER || type === ZT.PIGGYBACK;
/** Specials that take a director slot: not commons, the Brute or the Weeper. */
/** Highest a survivor's feet may be above the floor under them: a jump (~1.08 m) or a knockback hop, with slack. */
const MAX_LIFT = 1.3;
/** After the server teleports a survivor, their own position messages are ignored this long (ones already in flight would undo it). */
const TP_GRACE = 0.3;
const SLOTTED = (type: number) => !isCommon(type) && type !== ZT.BRUTE && type !== ZT.WEEPER;
/** Zombies that hold a survivor without a wall (freed by shoving the victim, too). */
const GRABBER = (type: number) => type === ZT.SNATCHER || type === ZT.PIGGYBACK;

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
}

interface Zombie {
  /** `y`: floor height it stands on (follows stairs and ladders through Level.moveSlide). */
  id: number; type: number; x: number; y: number; z: number; ry: number; st: number; hp: number; speed: number;
  offX: number; offZ: number; t: number; hitDone: boolean; target: number; dormant: boolean;
  stun: number; vx: number; vz: number; leapCd: number; lx: number; lz: number;
  /** Special-ability cooldown (charge, spit, ring), separate from the leaper's `leapCd`. */
  sp: number;
  /** Seconds left fleeing (alarm clock after ringing). */
  flee: number;
  /** Charger pin: time pinned, damage accumulator. */
  pinT: number; acc: number;
  /** Damage taken from survivors while pinning (knocks it off at CHARGER.pinBreakDmg). */ pinHit: number;
  /** Until this room time, chase goo-marked survivors first (puffer wave members). */ hunt: number;
  /** Special holding for a coordinated attack: 0 = attacking, 1 = lurking unseen, 2 = lurking but in a survivor's sight (backs off). */
  hold: number;
  /** Id of the queued horde (Wave.id) this walker was spawned for; 0 = not a horde member (ambient, wanderer, holdout). */
  wave: number;
  /** Wanderer region it was placed in (-1 = not a placed wanderer). */
  region: number;
  /** Weeper: still sitting (not yet woken), and her anger 0..1 (WEEPER). */
  sit: boolean; anger: number;
}

/**
 * A queued horde. Members drip in from hidden cells clustered around `srcs` (spawn cells; a second
 * one flanks from another side). `anchor`: cell of the noise that called it (-1 = the team); a lost
 * source is re-picked by the same rule. `hunt`: room time until which members chase marked survivors.
 * `side`: for team-sourced waves, 1 = ahead-biased (default), -1 = from behind (anti-camping), 0 = any.
 */
interface Wave { id: number; left: number; srcs: number[]; anchor: number; hunt: number; repicks: number; side: Side; requeue?: boolean }
/** `pickSpawnCell`'s `ahead` for a team-sourced wave's side. */
const waveAhead = (w: Wave) => (w.side < 0 ? -1 : w.side > 0 ? 0.75 : 0);

/** Drooler goo in flight (simulated on the server along the same arc the clients draw). */
interface Glob { x1: number; y1: number; z1: number; t: number }
/** A damaging goo puddle on the floor. */
interface Puddle { id: number; x: number; y: number; z: number; r: number; life: number; age: number; tick: number }
/** A firebomb's burning patch; `by`: id of the survivor who threw it (kill credit). */
interface Fire { id: number; x: number; y: number; z: number; r: number; life: number; age: number; tick: number; by: number }
/** A rattling Rattle Bomb: seconds until it goes off, who threw it and with which weapon, and the path field toward it. */
interface Lure { x: number; y: number; z: number; t: number; by: number; w: number; field: Int16Array }

/** Per-chapter static data the director needs. */
interface ChapterData {
  L: Level;
  progress: Int16Array; // BFS distance from the start with every door open
  /** Spawnable cells (not safe rooms/doors). */
  open: number[];
  /** 1 where `open` has the cell. */ spawnable: Uint8Array;
  /** Wanderer regions over `open` (populated once per attempt, see WANDERERS). */ regions: Regions;
  /**
   * The quest route as one distance (path tiles), monotone along the steps, unlike `progress` (some
   * chapters loop back toward the start). Leg `i` runs from step i-1's objective to step i's, walked
   * with step i's doors: it starts at `start[i]` and is `len[i]` long; `total` is the whole route.
   */
  route: { start: number[]; len: number[]; total: number };
}
const chapterData = new Map<number, ChapterData>();
function dataFor(ch: number): ChapterData {
  let d = chapterData.get(ch);
  if (d) return d;
  const L = getLevel(ch), regions = wandererRegions(L);
  const { progress, open, spawnable } = regions;
  d = { L, progress, open, spawnable, regions, route: routeOf(L) };
  chapterData.set(ch, d);
  return d;
}

/**
 * Nodes of step `s`'s objective, walkable with door mask `doors`: its untaken items, its area (on the
 * area's storey), or around its waypoint (a `use` step: on the machine's storey).
 */
function objectiveCells(L: Level, s: Step, doors: number, taken?: Set<number>): number[] {
  const src: number[] = [];
  const add = (tx: number, tz: number, lv: number) => { if (!L.solidAt(tx, tz, doors, lv)) src.push(L.node(tx, tz, lv)); };
  if (s.kind === 'collect') {
    for (const p of L.def.pickups) if (p.kind === 'item' && p.group === s.group && !taken?.has(p.id)) add(cellOf(p.x), cellOf(p.z), L.storeyOf(p.y));
  } else if (s.area) {
    const lv = s.area.lv ?? 0;
    for (let z = s.area.z0; z <= s.area.z1; z++) for (let x = s.area.x0; x <= s.area.x1; x++) add(x, z, lv);
  } else {
    const m = s.kind === 'use' && s.target !== undefined ? L.def.pickups[s.target] : undefined;
    const tx = cellOf(s.at.x), tz = cellOf(s.at.z), lv = L.storeyOf(m ? m.y : s.at.y ?? 0);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) add(tx + dx, tz + dz, lv);
  }
  return src;
}

function routeOf(L: Level): ChapterData['route'] {
  const def = L.def, start: number[] = [], len: number[] = [], field = new Int16Array(L.N);
  let from = [L.node(def.startCell.x, def.startCell.z, def.startCell.lv ?? 0)], total = 0;
  def.steps.forEach((s, i) => {
    const doors = L.doorsAfter(i), dst = objectiveCells(L, s, doors);
    L.distanceField(dst, doors, field);
    let d = INF;
    for (const c of from) d = Math.min(d, field[c]);
    start.push(total); len.push(d < INF ? d : 0); total += len[i];
    if (dst.length) from = dst;
  });
  return { start, len, total };
}

interface Checkpoint { step: number; doors: number; taken: number[] }

export class Room {
  players = new Map<number, Player>();
  zombies = new Map<number, Zombie>();
  private nextPid = 1;
  private nextZid = 1;
  private ch = 0;
  private cd!: ChapterData;
  private L!: Level;
  private flow = new Int16Array(1);
  private tickN = 0;
  private interval: ReturnType<typeof setInterval>;
  private doors = 0;
  private state: 'play' | 'won' | 'lost' = 'play';
  private endTimer = 0;
  private started = false;
  private step = 0;
  private holdout = -1; // seconds left; -1 = not running
  /**
   * The running holdout's script: stages, each one's end (seconds into the holdout, scaled), total
   * length, current stage index, seconds to the next final-stage special refill, and a Brute the
   * current stage still owes (retried every second until one fits).
   */
  private hs = { stages: [] as HoldStage[], ends: [] as number[], total: 0, i: -1, drip: 0, bruteWant: false, bruteTry: 0 };
  private collected = 0;
  private checkpoint: Checkpoint | null = null;
  private taken = new Set<number>();
  /** Loot thinning (thinLoot): this attempt's medkits in reveal order, and those currently held back. */
  private medOrder: number[] = [];
  private smallOrder: number[] = [];
  /** Each safe room's (start + checkpoints) medkits in reveal order: one per survivor is stocked. */
  private safeMeds: number[][] = [];
  private thinned = new Set<number>();
  private events: GameEvent[] = [];
  private time = 0;
  private kills = 0;
  private best = 0; // furthest progress (tiles) reached this attempt
  private pendingBrute = false;
  /** Furthest route progress (ChapterData.route tiles) this attempt, and where the roaming Brute comes (-1 = none/spawned). */
  private routeBest = 0;
  private bossAt = -1;
  private globs: Glob[] = [];
  private puddles: Puddle[] = [];
  private nextPuddle = 1;
  private fires: Fire[] = [];
  private lures: Lure[] = [];
  /** Route point where this attempt's Weeper sits (-1 = none/placed). */
  private weeperAt = -1;
  /** Earliest `time` the director may send another Alarm Clock. */
  private alarmAt = 0;
  private t = { flow: 0, ambient: 3, horde: 90, special: 25, hordeTick: 0, wander: 0 };
  /**
   * Wanderer regions this attempt (index = region id): rolled budget, sleepers placed so far, and
   * spent (a survivor came within WANDERERS.visit tiles: never placed into again). `reach`: scratch
   * field for the region pass.
   */
  private wander = { budget: new Int16Array(0), placed: new Int16Array(0), spent: new Uint8Array(0), minD: new Int16Array(0) };
  private reach = new Int16Array(1);
  /** Director pacing phase, seconds in it, `best` when it began, and how long it lasts (SUSTAIN/RELAX). */
  private phase = Phase.BUILD_UP;
  private phaseT = 0;
  private phaseBest = 0;
  private phaseLen = 0;
  /** Room time `best` last increased; seconds of BUILD_UP since then (anti-camping). */
  private advancedAt = 0;
  private campT = 0;
  /** Closest the team has been to the current objective (path tiles), for the objective field `objSeenKey`. */
  private objBest = INF;
  private objSeenKey = '';
  /** Specials: room time each type may fill a slot again; when the current holders attack anyway (Infinity = none holding). */
  private spReady: number[] = ZTYPES.map(() => 0);
  private ambushUntil = Infinity;
  /** Lone wolf: id of the survivor singled out (0 = none), seconds each has been cut off, and the BFS field toward the loner. */
  private loner = 0;
  private isoT = new Map<number, number>();
  private lonerField = new Int16Array(1);
  private isoScratch = new Int16Array(1);

  /**
   * `startAt`: step index of a checkpoint (gather) step to begin the chapter in that safe room,
   * or -1 for the chapter start. `listed`: shown in the lobby's room list. `difficulty`: DIFFICULTY row, fixed for the room's life.
   */
  constructor(public code: string, chapter = 0, private allowDebug = false, startAt = -1, readonly listed = true, readonly difficulty: DifficultyId = 'normal') {
    this.loadChapter(chapter);
    const cp = this.checkpointFor(startAt);
    if (cp) { this.checkpoint = cp; this.reset(true, true); } else this.reset(false);
    this.interval = setInterval(() => this.tick(1 / TICK_HZ), 1000 / TICK_HZ);
  }

  destroy(): void { clearInterval(this.interval); }

  get chapter(): number { return this.ch; }
  /** This room's difficulty multipliers (DIFFICULTY). */
  private get diff() { return DIFFICULTY[this.difficulty]; }
  /** Team intensity that ends BUILD_UP, after difficulty. */
  private get peak(): number { return Math.min(95, DIRECTOR.peak * this.diff.peak); }
  /** Special slots for `n` survivors, after difficulty. */
  private specialSlots(n: number): number { const S = DIRECTOR.specials.slots; return Math.min(this.slotCap(), Math.max(1, S[Math.min(Math.max(n, 1), S.length) - 1] + this.slotBonus(n))); }
  /** Campaign position for INTRO: chapter + fraction of its route walked this attempt, shifted by difficulty. */
  private get pos(): number { return this.ch + Math.min(1, this.routeBest / Math.max(1, this.cd.route.total)) + this.diff.intro; }
  /** Most specials alive at once this early in the campaign (INTRO.slots); Infinity later on. */
  private slotCap(): number { const pos = this.pos; for (const [at, cap] of INTRO.slots) if (pos < at) return cap; return Infinity; }
  /** The type for a new common: a walker, or (rarely, once introduced) an uncommon variant. */
  private commonType(): number {
    const pos = this.pos;
    let r = Math.random();
    for (const [type, chance] of Object.entries(DIRECTOR.uncommon)) { if (introduced(+type, pos) && (r -= chance) < 0) return +type; }
    return ZT.WALKER;
  }
  /** Extra special slots from difficulty for `n` survivors. */
  private slotBonus(n: number): number { const B = this.diff.slots; return B[Math.min(Math.max(n, 1), B.length) - 1]; }
  /** Survivor-side rules for this room's difficulty. */
  private get rules() { return SURVIVOR_RULES[this.difficulty]; }
  /** A wave of `base` walkers (a full horde is HORDE.base + HORDE.per x n), after difficulty. */
  private mobSize(base: number): number { return Math.max(1, Math.round(base * this.diff.mob)); }
  private get def() { return this.L.def; }
  private get cur(): Step | undefined { return this.def.steps[this.step]; }

  private loadChapter(ch: number): void {
    this.ch = ((ch % chapterCount()) + chapterCount()) % chapterCount();
    this.cd = dataFor(this.ch);
    this.L = this.cd.L;
    this.flow = new Int16Array(this.L.N);
    this.checkpoint = null;
  }

  // ------------------------------------------------------------------ setup
  /**
   * Checkpoint state as if the team had just completed checkpoint step `step` (objective
   * machines and quest items before it count as done). Null if `step` isn't a checkpoint.
   */
  private checkpointFor(step: number): Checkpoint | null {
    const s = this.def.steps[step];
    if (!s || s.kind !== 'gather' || !s.checkpoint) return null;
    const taken: number[] = [];
    for (let i = 0; i <= step; i++) {
      const t = this.def.steps[i];
      if (t.kind === 'use' && t.target !== undefined) taken.push(t.target);
      if (t.kind === 'collect') for (const p of this.def.pickups) if (p.kind === 'item' && p.group === t.group) taken.push(p.id);
    }
    return { step, doors: this.L.doorsAfter(step + 1), taken };
  }

  /** Where a player (re)spawns when there's no teammate to join: the active checkpoint's safe room or the start. */
  private spawnPoints(): Vec2[] {
    return (this.checkpoint && this.def.checkpointSpawns[this.checkpoint.step]) || this.def.spawns;
  }

  /** Lobby room-list entry. */
  info() {
    const s = this.cur;
    return {
      code: this.code, ch: this.ch, title: this.def.title, step: this.step + 1, steps: this.def.steps.length,
      objective: s ? s.objective : '', players: [...this.players.values()].map((p) => p.name), max: MAX_PLAYERS, state: this.state,
      diff: this.difficulty,
    };
  }

  /**
   * Start the chapter, or (fromCheckpoint) restart at the last checkpoint. `freshStart`: a new run
   * that begins at the checkpoint (picked in the lobby) rather than a restart after a wipe.
   */
  reset(fromCheckpoint: boolean, freshStart = false): void {
    const cp = fromCheckpoint ? this.checkpoint : null;
    this.zombies = new Map();
    this.nextZid = 1;
    this.state = 'play';
    this.endTimer = 0;
    this.holdout = -1;
    this.collected = 0;
    this.time = cp && !freshStart ? this.time : 0;
    if (!cp || freshStart) this.kills = 0;
    if (!cp) this.checkpoint = null;
    this.pendingBrute = false;
    this.clearHazards();
    this.alarmAt = 0;
    this.waves = []; this.marks.clear();
    this.t = { flow: 0, ambient: 3, horde: roll(DIRECTOR.mobFirst) * this.diff.mobEvery, special: roll(DIRECTOR.specials.first) * this.diff.spCd, hordeTick: 0, wander: 0 };
    this.doors = cp ? cp.doors : 0;
    this.taken = new Set(cp ? cp.taken : []);
    this.thinLoot();
    this.step = cp ? cp.step + 1 : 0;
    this.started = !!cp;
    this.events = [['reset', this.ch, this.step, this.doors, [...this.taken], cp && !freshStart ? 1 : 0]];
    const spawns = this.spawnPoints();
    let slot = 0;
    for (const p of this.players.values()) this.spawnPlayer(p, spawns[slot++ % spawns.length], !cp || freshStart);
    const sp = spawns[0];
    this.best = this.progressAt(sp.x, sp.y ?? 0, sp.z);
    this.routeBest = 0;
    this.resetPacing();
    this.beginStep(true);
    this.rollBoss(); this.rollWeeper();
    this.resetWanderers();
    this.placeWanderers();
  }

  /**
   * Roll which loot this attempt leaves out (LOOT): marked taken, so clients never show it. Medkits
   * outside safe rooms scale with the squad; each safe room stocks one medkit per survivor; ammo piles
   * are halved because each one now serves every survivor.
   */
  private thinLoot(): void {
    const shuffle = <T>(a: T[]): T[] => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const meds = this.def.pickups.filter((p) => p.kind === 'medkit' && !this.taken.has(p.id));
    const inSafe = new Set(this.L.safeRooms().flat());
    this.safeMeds = this.L.safeRooms().map((r) => shuffle(r.filter((id) => this.def.pickups[id].kind === 'medkit' && !this.taken.has(id))));
    this.medOrder = shuffle(meds.filter((p) => !inSafe.has(p.id)).map((p) => p.id));
    this.smallOrder = shuffle(this.def.pickups.filter((p) => medIndex(p.kind) > 0 && !this.taken.has(p.id)).map((p) => p.id));
    const squad = this.squad();
    this.thinned = new Set([...this.medOrder.slice(this.medLimit()), ...this.smallOrder.slice(this.smallLimit()), ...this.safeMeds.flatMap((r) => r.slice(squad))]);
    for (const id of this.thinned) this.taken.add(id);
    const ammo = shuffle(this.def.pickups.filter((p) => p.kind === 'ammo' && !this.taken.has(p.id)));
    for (const p of ammo.slice(Math.ceil(ammo.length * LOOT.ammo))) this.taken.add(p.id);
  }
  private squad(): number { return Math.max(1, this.players.size); }
  private medLimit(): number { return LOOT.medBase + LOOT.medPer * this.squad(); }
  private smallLimit(): number { return LOOT.smallBase + LOOT.smallPer * this.squad(); }
  /** The squad grew: put back thinned medkits up to the new limits (clients get a 'loot' event). */
  private revealLoot(): void {
    const back = [...this.medOrder.slice(0, this.medLimit()), ...this.smallOrder.slice(0, this.smallLimit()), ...this.safeMeds.flatMap((r) => r.slice(0, this.squad()))].filter((id) => this.thinned.has(id));
    if (!back.length) return;
    for (const id of back) { this.thinned.delete(id); this.taken.delete(id); }
    this.events.push(['loot', back]);
  }

  private spawnPlayer(p: Player, s0: Vec2, fresh: boolean): void {
    const s = this.settle(s0), y = s.y;
    Object.assign(p, { x: s.x, y, z: s.z, ry: Math.PI, rx: 0, hp: PLAYER.hp, st: PSTATE.ALIVE, w: 0, anim: 0,
      revT: 0, reviving: 0, respawnT: 0, lastFire: 0, lastShove: 0, pinned: 0, freeAt: 0, fireW: 0, nades: [], shotAt: {}, intensity: 0,
      downs: 0, selfRev: this.rules.selfRevives, revNeed: PLAYER.reviveTime, shoveFat: 0, ammoUsed: new Set<number>(), armor: 0, regen: 0, regenRate: 0 });
    if (fresh || p.primary === undefined) { p.primary = -1; p.sidearm = 0; p.melee = -1; p.thr = {}; }
    if (fresh || !p.meds) p.meds = MEDS.map(() => 0);
    if (fresh) p.kills = 0;
    this.place(p);
    this.events.push(['tp', p.id, s.x, s.z, Math.PI, r2(y)]);
    p.freeAt = this.time + TP_GRACE;
  }

  /** A spawn point standing on real floor: its own tile's floor height (stairs included), else the nearest open tile. */
  private settle(s: Vec2): Pos3 {
    const L = this.L, y = s.y ?? 0, n = L.nodeAt(s.x, y, s.z);
    // The whole body must fit, not just its centre (a spawn offset can brush a machine or a wall).
    if (!L.blocked(n, this.doors) && Math.abs(L.heightAt(n, s.x, s.z) - y) <= STOREY / 2 && !L.boxBlocked(s.x, L.heightAt(n, s.x, s.z), s.z, PLAYER.radius, this.doors)) return { x: s.x, y: L.heightAt(n, s.x, s.z), z: s.z };
    return this.nearestOpen(s);
  }

  /** Refresh a survivor's floor height and node after they (or the server) moved them. */
  private place(p: Player): void {
    const L = this.L, n = L.nodeAt(p.x, p.y, p.z);
    p.node = n;
    p.gy = L.levels === 1 ? 0 : L.def.solid[n] === 1 && L.def.doorCell[n] < 0 ? p.y : L.heightAt(n, p.x, p.z);
  }
  /** Walk-graph node a zombie (or any point with a floor height) is on. */
  private nodeOf(o: Pos3): number { return this.L.nodeAt(o.x, o.y, o.z); }
  /** Eye-to-eye sight between things standing at floor heights ay and by. */
  private sight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    return this.L.hasLOS(ax, ay + EYE, az, bx, by + EYE, bz, this.doors);
  }

  addPlayer(ws: WebSocket, name: string): Player | null {
    if (this.players.size >= MAX_PLAYERS) return null;
    const used = new Set([...this.players.values()].map((p) => p.look));
    let look = 0;
    while (used.has(look)) look++;
    const p = { id: this.nextPid++, ws, name: name || SURVIVORS[look].name, look, meds: MEDS.map(() => 0), kills: 0 } as Player;
    // Beside a standing survivor, else beside a downed one (a solo self-reviving player gets their helper right there).
    const mate = this.standing()[0] ?? this.watchers()[0];
    this.players.set(p.id, p);
    this.revealLoot();
    const spawns = this.spawnPoints();
    this.spawnPlayer(p, spawns[look % spawns.length], true);
    // Late joiners start beside the team if the run is already under way.
    if (mate && (this.started || this.step > 0)) {
      p.x = mate.x; p.y = mate.gy; p.z = mate.z;
      this.place(p);
      this.events.pop();
      this.events.push(['tp', p.id, p.x, p.z, mate.ry, r2(p.y)]);
      p.freeAt = this.time + TP_GRACE;
    }
    this.send(p, { t: 'w', id: p.id, room: this.code, ch: this.ch, step: this.step, taken: [...this.taken], doors: this.doors, x: p.x, z: p.z, y: r2(p.y), debug: this.allowDebug ? 1 : 0, diff: this.difficulty });
    this.broadcastRoster();
    this.events.push(['msg', `${p.name} joined the squad`]);
    return p;
  }

  removePlayer(p: Player): void {
    this.players.delete(p.id);
    this.broadcastRoster();
    this.events.push(['msg', `${p.name} left`]);
  }

  private broadcastRoster(): void {
    this.broadcast({ t: 'ro', players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, look: p.look })) });
  }

  private send(p: Player, obj: ServerMsg): void { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(obj)); }
  private broadcast(obj: ServerMsg): void {
    const s = JSON.stringify(obj);
    for (const p of this.players.values()) if (p.ws.readyState === 1) p.ws.send(s);
  }

  private standing(): Player[] { return [...this.players.values()].filter((p) => p.st === PSTATE.ALIVE); }
  /** Survivors whose camera is in the world (standing or downed): nothing may vanish in front of them. */
  private watchers(): Player[] { return [...this.players.values()].filter((p) => p.st !== PSTATE.DEAD); }
  private progressAt(x: number, y: number, z: number): number {
    if (!this.L.inBounds(cellOf(x), cellOf(z))) return 0;
    const v = this.cd.progress[this.L.nodeAt(x, y, z)];
    return v < INF ? v : 0;
  }

  // ------------------------------------------------------------------ quest
  private beginStep(silent = false): void {
    const s = this.cur;
    if (!s) return;
    this.collected = 0;
    this.holdout = -1;
    if (!silent) this.events.push(['step', this.step]);
    // A holdout step starts its script now (its opening horde included); a lever with a holdout
    // saves both for the pull (the crescendo's opening burst), see onUse.
    if (s.kind === 'holdout') this.startHoldout(s);
    else if (s.horde && !(s.kind === 'use' && s.hold)) this.horde();
    if (s.brute) this.pendingBrute = true;
    this.routeBest = Math.max(this.routeBest, this.cd.route.start[this.step]);
  }

  private completeStep(): void {
    const s = this.cur;
    if (!s) return;
    for (const d of s.opens) if (!(this.doors & (1 << d))) { this.doors |= 1 << d; this.events.push(['door', d, 1]); }
    for (const d of s.closes) if (this.doors & (1 << d)) { this.doors &= ~(1 << d); this.events.push(['door', d, 0]); this.clearDoorway(d, s.area); }
    this.holdout = -1;
    if (s.checkpoint) {
      // Only objective pickups stay taken across a checkpoint restart; loot respawns.
      const keep = [...this.taken].filter((id) => { const k = this.def.pickups[id]?.kind; return k === 'obj' || k === 'item'; });
      this.checkpoint = { step: this.step, doors: this.doors, taken: keep };
      this.events.push(['checkpoint']);
      // A safe room rescues the dead (beside whoever made it) and clears everyone's downs.
      const mate = this.standing()[0];
      for (const p of this.players.values()) {
        p.downs = 0;
        if (p.st === PSTATE.DEAD && mate) this.rescue(p, mate);
      }
    }
    this.step++;
    if (this.step >= this.def.steps.length) { this.win(); return; }
    this.beginStep();
  }

  private updateQuest(dt: number): void {
    const s = this.cur;
    if (!s) return;
    const stand = this.standing();
    if (this.holdout >= 0) {
      this.holdout -= dt;
      if (this.holdout <= 0) { this.crescendoOver(); this.completeStep(); }
      return;
    }
    switch (s.kind) {
      case 'reach': if (s.area && stand.some((p) => this.L.inRect(p.x, p.y, p.z, s.area!))) this.completeStep(); break;
      case 'gather': if (s.area && stand.length && stand.every((p) => this.L.inRect(p.x, p.y, p.z, s.area!))) this.completeStep(); break;
      case 'collect': if (this.collected >= (s.count ?? 0)) this.completeStep(); break;
      default: break; // use: driven by onUse; holdout: timer above
    }
  }

  private win(): void {
    this.state = 'won'; this.endTimer = 16;
    const next = (this.ch + 1) % chapterCount();
    this.events.push(['end', 1, this.kills, Math.round(this.time), [...this.players.values()].map((p): [number, number] => [p.id, p.kills]), next]);
  }

  /** Dev tool: skip to a step with the team standing where the previous step ended. */
  private debugJump(step: number): void {
    const n = this.def.steps.length;
    step = Math.max(0, Math.min(n - 1, step | 0));
    this.zombies = new Map();
    this.clearHazards();
    this.doors = this.L.doorsAfter(step);
    this.step = step;
    this.started = step > 0;
    this.taken = new Set();
    this.events.push(['reset', this.ch, this.step, this.doors, [], 1]);
    const prev = this.def.steps[step - 1];
    const at = this.nearestOpen(prev ? prev.at : this.def.spawns[0]);
    let i = 0;
    for (const p of this.players.values()) {
      const s = this.settle({ x: at.x + (i % 2) * 0.9, z: at.z + (i >> 1) * 0.9, y: at.y }); i++;
      Object.assign(p, { x: s.x, y: s.y, z: s.z, st: PSTATE.ALIVE, hp: PLAYER.hp, pinned: 0 });
      this.place(p);
      this.events.push(['tp', p.id, s.x, s.z, Math.PI, r2(s.y)]);
      p.freeAt = this.time + TP_GRACE;
    }
    this.best = this.progressAt(at.x, at.y, at.z);
    this.waves = [];
    this.pendingBrute = false;
    this.routeBest = 0;
    this.resetPacing();
    this.beginStep();
    this.rollBoss(); this.rollWeeper();
    this.resetWanderers();
    this.placeWanderers();
  }

  /** A door just shut: zombies caught in the doorway are removed, players in it are moved into the room. */
  private clearDoorway(id: number, area?: Rect): void {
    const d = this.def.doors[id], pad = 1, L = this.L;
    const inDoor = (x: number, y: number, z: number, r: number) => L.storeyOf(y) === d.lv &&
      x + r > d.x0 * TILE - pad && x - r < (d.x1 + 1) * TILE + pad && z + r > d.z0 * TILE - pad && z - r < (d.z1 + 1) * TILE + pad;
    for (const z of [...this.zombies.values()]) if (inDoor(z.x, z.y, z.z, ZTYPES[z.type].radius)) this.zombies.delete(z.id);
    if (!area) return;
    const c = this.nearestOpen({ x: ((area.x0 + area.x1 + 1) / 2) * TILE, z: ((area.z0 + area.z1 + 1) / 2) * TILE, y: (area.lv ?? 0) * STOREY });
    for (const p of this.players.values()) if (p.st !== PSTATE.DEAD && inDoor(p.x, p.gy, p.z, PLAYER.radius)) {
      if (p.pinned) this.unpin(p);
      p.x = c.x; p.y = c.y; p.z = c.z;
      this.place(p);
      this.events.push(['tp', p.id, r2(p.x), r2(p.z), p.ry, r2(p.y)]);
      p.freeAt = this.time + TP_GRACE;
    }
  }

  /** Centre of the walkable tile nearest to `p` on its storey (waypoints can sit on solid machines). */
  private nearestOpen(p: Vec2): Pos3 {
    const L = this.L, cx = cellOf(p.x), cz = cellOf(p.z), lv = L.storeyOf(p.y ?? 0);
    for (let r = 0; r < 12; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      if (!L.solidAt(cx + dx, cz + dz, this.doors, lv)) return L.centre(L.node(cx + dx, cz + dz, lv));
    }
    return { x: p.x, y: p.y ?? 0, z: p.z };
  }

  // --------------------------------------------------------------- messages
  onMessage(p: Player, m: ClientMsg): void {
    switch (m.t) {
      case 'p': {
        if (p.st === PSTATE.DEAD) return;
        if (![m.x, m.y, m.z, m.ry, m.rx].every(Number.isFinite)) return;
        // In the grace after a teleport, a claim near where the server put you means the client has caught up.
        if (this.time < p.freeAt && Math.hypot(m.x - p.x, m.z - p.z) < 2.5 && Math.abs(m.y - p.y) < 2) p.freeAt = 0;
        if (p.st === PSTATE.ALIVE && !p.pinned && !(this.time < p.freeAt)) {
          // Feet may be at most a jump (or a knockback hop) above the floor under the claimed spot, never below it.
          const n = this.L.nodeAt(m.x, m.y, m.z), g = this.L.blocked(n, this.doors) ? p.gy : this.L.heightAt(n, m.x, m.z);
          p.x = m.x; p.z = m.z; p.y = Math.min(Math.max(m.y, g), g + MAX_LIFT); this.place(p);
        }
        p.ry = m.ry; p.rx = m.rx; p.w = m.w | 0; p.anim = m.a | 0;
        break;
      }
      case 'f': this.onFire(p, m); break;
      case 'g': this.onBlast(p, m); break;
      case 'v': this.onShove(p); break;
      case 'u': if (!p.pinned) this.onUse(p, m.id | 0); break;
      case 'h': {
        const k = m.k === undefined ? 0 : m.k | 0, med = MEDS[k];
        if (!med || p.st !== PSTATE.ALIVE || p.pinned || !(p.meds[k] > 0) || !medUseful(k, p.hp, p.downs)) return;
        p.meds[k]--;
        // The medkit heals a share of what is missing; the small items a flat amount, vitamins mostly as a trickle.
        const now = k === 0 ? Math.max(HEAL_MIN, (PLAYER.hp - p.hp) * this.rules.heal) : med.heal;
        p.hp = Math.min(PLAYER.hp, p.hp + now);
        if (med.regen > 0) { p.regen = Math.max(p.regen, med.regen); p.regenRate = med.regen / med.over; }
        if (med.steady) p.downs = 0;
        this.events.push(['heal', p.id, k]);
        break;
      }
      case 'r': p.reviving = p.pinned ? 0 : m.id | 0; break;
      case 'dbg': if (this.allowDebug && this.state === 'play') this.debugJump(m.step); break;
      case 'dbgz': {
        if (!this.allowDebug || this.state !== 'play' || !ZTYPES[m.zt | 0] || !Number.isFinite(m.x) || !Number.isFinite(m.z)) break;
        // No y on the wire: it goes on the requesting survivor's storey.
        const L = this.L, tx = cellOf(m.x), tz = cellOf(m.z), lv = L.lvOf(p.node);
        if (L.solidAt(tx, tz, this.doors, lv)) break;
        this.spawnZombie(m.zt | 0, m.x, L.heightAt(L.node(tx, tz, lv), m.x, m.z), m.z).leapCd = 0.2; // ready to pounce
        break;
      }
    }
  }
  private onFire(p: Player, m: Extract<ClientMsg, { t: 'f' }>): void {
    const wi = m.w | 0, wp = WEAPONS[wi];
    if (!wp || p.st !== PSTATE.ALIVE || p.pinned || this.state !== 'play') return; // pinned by a Charger: can't shoot
    // Only the pistol and weapons this player actually picked up (dev servers allow debug gives).
    if (wi !== 0 && wi !== p.primary && wi !== p.sidearm && wi !== p.melee && !(p.thr[wi] > 0) && !this.allowDebug) return;
    const e = Array.isArray(m.e) && m.e.length === 3 && m.e.every(Number.isFinite) ? m.e : null;
    if (wp.slot === 'throw') {
      // A throw is its own action (no shot clock): one of that kind is spent; what it does waits for the landing claim ('g').
      if (p.thr[wi] > 0) p.thr[wi]--;
      if (e) this.events.push(['shot', p.id, wi, r2(e[0]), r2(e[1]), r2(e[2])]);
      p.nades.push({ x: p.x, y: p.gy, z: p.z, t: this.time, w: wi, seq: (m.n ?? 0) | 0, ex: e ? e[0] : p.x, ez: e ? e[2] : p.z });
      if (p.nades.length > 6) p.nades.shift();
      return;
    }
    // Shot clock: scheduled from the previous accepted shot rather than reset to "now", so ordinary
    // jitter (bursts within about 0.35 s) doesn't drop real shots; a longer lag spike can still lose
    // some. Sustained rate is capped at 1.25x the weapon's own; an idle gap banks at most 0.25 s;
    // a weapon swap needs 0.25 s (the client spends 0.3 s) and each weapon keeps its own clock, so
    // alternating weapons can't beat either weapon's rate.
    const gap = wi === p.fireW ? wp.rate * 0.8 : 0.25;
    const clock = Math.max(p.lastFire + gap, (p.shotAt[wi] ?? -1e9) + wp.rate * 0.8, this.time - 0.25);
    if (clock > this.time + 0.1) return;
    p.lastFire = clock; p.fireW = wi; p.shotAt[wi] = clock;
    if (e) this.events.push(['shot', p.id, wi, r2(e[0]), r2(e[1]), r2(e[2])]);
    // A swing is quiet: it wakes nobody.
    if (wp.melee) { if (Array.isArray(m.h)) this.meleeHits(p, wp, m.h); return; }
    this.alertNear(p.x, p.gy, p.z, 22);
    if (wp.blast) {
      // Damage waits for the impact claim ('g'); remember where it was fired from.
      p.nades.push({ x: p.x, y: p.gy, z: p.z, t: this.time, w: wi, seq: (m.n ?? 0) | 0, ex: e ? e[0] : p.x, ez: e ? e[2] : p.z });
      if (p.nades.length > 6) p.nades.shift();
      return;
    }
    if (!Array.isArray(m.h)) return;
    if (wp.pierce > 1) { this.pierceHits(p, wi, m.h, e); return; }
    let budget = wp.pellets;
    for (const h of m.h.slice(0, wp.pellets)) {
      if (!Array.isArray(h)) continue;
      const z = this.zombies.get(h[0] | 0);
      if (!z) continue;
      const nb = Math.max(0, Math.min(budget, h[1] | 0)); budget -= nb;
      const nh = Math.max(0, Math.min(budget, h[2] | 0)); budget -= nh;
      if (nb + nh === 0) continue;
      const d = Math.hypot(z.x - p.x, z.z - p.z, z.y - p.gy);
      if (d > wp.range + 4) continue;
      // Across storeys, the floor between must not be in the way (on one floor, claims stay trusted as before, so lag never eats hits).
      if (Math.abs(z.y - p.gy) > REACH_DY && !this.sight(p.x, p.gy, p.z, z.x, z.y - EYE + 0.6, z.z) && !this.sight(p.x, p.gy, p.z, z.x, z.y - EYE + ZHIT.headY, z.z)) continue;
      // A Tinpot's front takes only a share of the bullet.
      const front = armoredFront(z.type, z.st, z.ry, z.x, z.z, p.x, p.z);
      if (front) this.events.push(['clang', z.id]);
      // Falloff from the server's view of the distance; the slack above stays at the range floor.
      this.damageZombie(z, shotDamage(wp, z.type, nb, nh, Math.min(d, wp.range)) * (front ? TINPOT_FRONT : 1), p, nh > 0 && !front);
    }
  }

  /**
   * A piercing bullet: up to `pierce` distinct zombies, one hit each. Checked nearest first:
   * every one in range; the ones after the first in line of sight and inside a lane around the
   * shooter -> end-point line. The bullet stops at a Brute.
   */
  private pierceHits(p: Player, wi: number, claims: unknown[], e: [number, number, number] | null): void {
    const wp = WEAPONS[wi];
    const seen = new Set<number>();
    const hits: { z: Zombie; head: boolean; d: number }[] = [];
    for (const h of claims.slice(0, wp.pierce)) {
      if (!Array.isArray(h)) continue;
      const z = this.zombies.get(h[0] | 0);
      const nb = Math.max(0, h[1] | 0), nh = Math.max(0, h[2] | 0);
      if (!z || seen.has(z.id) || nb + nh === 0) continue;
      seen.add(z.id);
      hits.push({ z, head: nh > 0, d: Math.hypot(z.x - p.x, z.z - p.z, z.y - p.gy) });
    }
    hits.sort((a, b) => a.d - b.d);
    if (!hits.length) return;
    // The lane: from the shooter through where the bullet stopped (or the nearest hit).
    let lx = (e ? e[0] : hits[0].z.x) - p.x, lz = (e ? e[2] : hits[0].z.z) - p.z;
    let ll = Math.hypot(lx, lz);
    if (ll < 0.5) { lx = hits[0].z.x - p.x; lz = hits[0].z.z - p.z; ll = Math.hypot(lx, lz) || 1; }
    lx /= ll; lz /= ll;
    for (let i = 0; i < hits.length; i++) {
      const { z, head, d } = hits[i];
      if (d > wp.range + 4) break;
      if (i > 0) {
        const ox = z.x - p.x, oz = z.z - p.z, side = Math.abs(ox * lz - oz * lx);
        if (side > 1.4 + ZTYPES[z.type].radius || ox * lx + oz * lz < -1) continue;
        if (!this.sight(p.x, p.gy, p.z, z.x, z.y, z.z)) break;
      }
      // A Tinpot's front takes a share of even a piercing round and stops it dead.
      if (armoredFront(z.type, z.st, z.ry, z.x, z.z, p.x, p.z)) {
        this.events.push(['clang', z.id]);
        this.damageZombie(z, shotDamage(wp, z.type, head ? 0 : 1, head ? 1 : 0, Math.min(d, wp.range)) * TINPOT_FRONT, p, false);
        break;
      }
      this.damageZombie(z, shotDamage(wp, z.type, head ? 0 : 1, head ? 1 : 0, Math.min(d, wp.range)), p, head);
      if (z.type === ZT.BRUTE) break;
    }
  }

  /**
   * A close-in swing: up to `cleave` distinct zombies, each within reach (plus slack for lag) and
   * inside the swing's cone from where the server has the survivor facing, in line of sight. Survivors
   * of the hit are staggered and shoved back (not the Brute, a Charger or a woken Weeper).
   */
  private meleeHits(p: Player, wp: WeaponDef, claims: unknown[]): void {
    const M = wp.melee!, fx = -Math.sin(p.ry), fz = -Math.cos(p.ry), seen = new Set<number>();
    for (const h of claims.slice(0, M.cleave)) {
      if (!Array.isArray(h)) continue;
      const z = this.zombies.get(h[0] | 0);
      if (!z || seen.has(z.id)) continue;
      seen.add(z.id);
      const T = ZTYPES[z.type], dx = z.x - p.x, dz = z.z - p.z, d = Math.hypot(dx, dz);
      if (d > M.reach + T.radius + 1 || Math.abs(z.y - p.gy) > REACH_DY || (d > 0.6 && (dx * fx + dz * fz) / d < M.arc - 0.35)) continue;
      if (!this.sight(p.x, p.gy, p.z, z.x, z.y, z.z)) continue;
      this.damageZombie(z, meleeDamage(wp, z.type), p, false);
      if (z.hp <= 0 || z.type === ZT.BRUTE || z.type === ZT.CHARGER || z.type === ZT.WEEPER) continue;
      const k = d || 1;
      z.stun = isCommon(z.type) ? M.stun : M.stun * 0.5; z.st = ZSTATE.STAGGER;
      z.vx = (dx / k) * M.knock; z.vz = (dz / k) * M.knock;
    }
  }

  /**
   * Launcher impact claim. Pairs with the oldest unclaimed grenade, checks the impact is in
   * range of where it was fired and in sight of it (2D, through the grid), then blasts:
   * linear falloff, walls block. Survivors near the centre take a little (BLAST_FF, not scaled by
   * difficulty) and a hop of knockback.
   */
  private onBlast(p: Player, m: Extract<ClientMsg, { t: 'g' }>): void {
    if (this.state !== 'play' || p.st === PSTATE.DEAD) return;
    while (p.nades.length && p.nades[0].t < this.time - 6) p.nades.shift();
    // Match the claim to its shell by sequence number, so a dropped 'f' can't shift claims by one.
    const at = m.n ? p.nades.findIndex((q) => q.seq === ((m.n ?? 0) | 0)) : 0;
    if (at < 0) return;
    const n = p.nades.splice(at, 1)[0];
    const wp = n && WEAPONS[n.w], B = wp?.blast;
    if (!n || !wp || !B || ![m.x, m.y, m.z].every(Number.isFinite)) return;
    const dx = m.x - n.x, dz = m.z - n.z, d = Math.hypot(dx, dz);
    if (d > wp.range + 4 || m.y < -1 || m.y > 60) return;
    // Time of flight: the shell can't land sooner than its launch speed allows.
    if (this.time - n.t < d / (B.speed * 1.3) - 0.15) return;
    // It lands near the line it was aimed along (it may stop short on a zombie or wall).
    const ax = n.ex - n.x, az = n.ez - n.z, al = Math.hypot(ax, az);
    if (al > 1 && (Math.abs(dx * az - dz * ax) / al > 3 || (dx * ax + dz * az) / al > al + 4)) return;
    // Pull the point back off the wall face it struck before the sight checks (lifted off the floor it landed on).
    const k = d > 0.01 ? Math.max(0, d - 0.6) / d : 0;
    const bx = n.x + dx * k, bz = n.z + dz * k, gb = this.L.groundY(bx, m.y, bz);
    const ay = n.y + EYE, by = Math.max(gb + 0.3, ay + (m.y - ay) * k);
    if (!this.L.hasLOS(n.x, ay, n.z, bx, by, bz, this.doors) && !this.lobClear(n.x, ay, n.z, bx, by, bz)) return;
    // Throwables: the landing starts a fire or a rattle instead of a blast.
    if (wp.thrown === 'fire') { this.addFire(bx, gb, bz, p); return; }
    if (wp.thrown === 'lure') { this.addLure(bx, gb, bz, p, n.w); return; }
    const power = blastPower(B, d);
    this.events.push(['blast', p.id, r2(m.x), r2(m.y), r2(m.z), power]);
    this.applyBlast(p, B, bx, m.y, bz, power);
  }

  /**
   * Multi-storey maps: a lobbed shell or throw may arc over what the straight line clips (a roof edge,
   * up onto a roof): clear along two legs through an apex above the midpoint. Flat maps keep the
   * straight-line rule (their walls are sky-high anyway).
   */
  private lobClear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    if (this.L.levels === 1) return false;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, my = Math.max(ay, by) + Math.min(6, 0.3 * Math.hypot(bx - ax, bz - az));
    return this.L.hasLOS(ax, ay, az, mx, my, mz, this.doors) && this.L.hasLOS(mx, my, mz, bx, by, bz, this.doors);
  }

  /** Blast `B` at (bx, by, bz): zombies in its radius and sight, a nick and a hop for survivors near the centre. */
  private applyBlast(by: Player | null, B: BlastDef, bx: number, y: number, bz: number, power: number): void {
    const R = blastRadius(B, power), gb = this.L.groundY(bx, y, bz), ly = Math.max(y, gb + 0.3);
    for (const z of [...this.zombies.values()]) {
      const T = ZTYPES[z.type], zc = z.y + T.scale * 0.7;
      const zd = Math.max(0, Math.hypot(z.x - bx, zc - y, z.z - bz) - T.radius);
      if (zd > R || !this.L.hasLOS(bx, ly, bz, z.x, Math.max(zc, z.y + 0.3), z.z, this.doors)) continue;
      if (isCommon(z.type) && zd < R * 0.8) {
        const a = Math.hypot(z.x - bx, z.z - bz) || 1;
        z.stun = 0.9; z.vx = ((z.x - bx) / a) * 8; z.vz = ((z.z - bz) / a) * 8; z.st = ZSTATE.STAGGER;
      }
      this.damageZombie(z, blastDamage(B, power, zd), by, false);
    }
    for (const q of this.players.values()) {
      if (q.st !== PSTATE.ALIVE || q.pinned || Math.abs(q.gy - gb) > REACH_DY) continue;
      const qd = Math.hypot(q.x - bx, q.z - bz);
      if (qd > R * 0.5) continue;
      const ff = Math.round(BLAST_FF * power * (1 - qd / (R * 0.5)));
      if (ff >= 1) this.damagePlayer(q, ff, bx, bz, false, false);
      if (qd < 0.01) continue;
      this.events.push(['kb', q.id, r2(((q.x - bx) / qd) * 6 * power), r2(((q.z - bz) / qd) * 6 * power)]);
    }
    this.alertNear(bx, gb, bz, 30);
  }

  /** A firebomb burst at (x, z) on the floor at height y: a patch that burns for FIRE.life (the oldest goes out past FIRE.max). */
  private addFire(x: number, y: number, z: number, by: Player): void {
    if (this.fires.length >= FIRE.max) this.fires.shift();
    const f: Fire = { id: this.nextPuddle++, x, y, z, r: FIRE.r, life: FIRE.life, age: 0, tick: 0, by: by.id };
    this.fires.push(f);
    this.events.push(['fire', f.id, r2(x), r2(z), f.r, f.life, r2(y)]);
    this.alertNear(x, y, z, 12);
  }

  /** A Rattle Bomb landed at (x, z) on the floor at height y: commons flock to it until it goes off (LURE). */
  private addLure(x: number, y: number, z: number, by: Player, w: number): void {
    const c = this.nearestOpen({ x, y, z }), field = new Int16Array(this.L.N);
    this.L.distanceField([this.nodeOf(c)], this.doors, field);
    // A third rattle sets the oldest off early rather than cancelling it.
    if (this.lures.length >= 2) this.popLure(this.lures.shift()!);
    this.lures.push({ x, y, z, t: LURE.time, by: by.id, w, field });
    this.events.push(['lure', r2(x), r2(z), LURE.time, r2(y)]);
    this.alertNear(x, y, z, LURE.wake);
  }

  private onShove(p: Player): void {
    if (p.st !== PSTATE.ALIVE || p.pinned) return;
    // Fatigue gets the same 0.8 slack as the cooldown, so arrival jitter can't tip it past shoveMax before the client.
    const rest = this.time - p.lastShove, fat = shoveFatigue(p.shoveFat, rest / 0.8);
    if (rest < shoveCooldown(fat) * 0.8) return;
    p.lastShove = this.time; p.shoveFat = fat + 1;
    const fx = -Math.sin(p.ry), fz = -Math.cos(p.ry);
    for (const z of [...this.zombies.values()]) {
      const dx = z.x - p.x, dz = z.z - p.z, d = Math.hypot(dx, dz);
      const T = ZTYPES[z.type];
      if (d > PLAYER.shoveRange + T.radius || d < 0.001 || Math.abs(z.y - p.gy) > REACH_DY) continue;
      if ((dx * fx + dz * fz) / d < 0.3) continue;
      if (z.type === ZT.BRUTE) continue;
      // Shoving the Weeper just makes her angry.
      if (z.type === ZT.WEEPER) { this.damageZombie(z, 8, p, false); continue; }
      // A pinning Charger isn't freed by one shove: it counts toward CHARGER.pinBreakDmg.
      if (z.type === ZT.CHARGER && z.st === ZSTATE.PIN) {
        z.pinHit += CHARGER.shovePin - 8;
        this.damageZombie(z, 8, p, false);
        continue;
      }
      // A shove interrupts any windup, charge or ring. Chargers are heavy and barely budge.
      const kick = z.type === ZT.CHARGER ? 3 : 9;
      // A Tinpot reels for longer: the window to shoot it while its guard is down.
      z.stun = z.type === ZT.TINPOT ? 1.7 : isCommon(z.type) ? 1.1 : 0.7;
      z.vx = (dx / d) * kick; z.vz = (dz / d) * kick;
      z.st = ZSTATE.STAGGER; z.dormant = false;
      this.damageZombie(z, 8, p, false);
    }
    // Shoving a lassoed or ridden teammate knocks their captor loose.
    for (const q of this.players.values()) {
      if (q === p || !q.pinned) continue;
      const z = this.zombies.get(q.pinned), dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
      if (!z || !GRABBER(z.type) || d > PLAYER.shoveRange + PLAYER.radius || Math.abs(q.gy - p.gy) > REACH_DY || (d > 0.3 && (dx * fx + dz * fz) / d < 0.3)) continue;
      z.stun = 1.2; z.st = ZSTATE.STAGGER; z.vx = z.vz = 0;
      this.unpin(q);
    }
    this.events.push(['shove', p.id]);
  }

  private onUse(p: Player, id: number): void {
    const pk = this.def.pickups[id];
    if (!pk || p.st !== PSTATE.ALIVE || this.state !== 'play') return;
    if (Math.hypot(pk.x - p.x, pk.z - p.z) > PLAYER.useRange + 1 || Math.abs(pk.y - p.gy) > REACH_DY) return;
    const s = this.cur;
    const mk = medIndex(pk.kind);
    if (mk >= 0) {
      // Medical items: each kind has its own pocket (MEDS[k].max).
      if (this.taken.has(id) || p.meds[mk] >= MEDS[mk].max) return;
      this.taken.add(id); p.meds[mk]++;
      this.events.push(['pk', id], ['got', p.id, id]);
      return;
    } else if (pk.kind === 'obj') {
      if (!s || s.kind !== 'use' || s.target !== id || this.holdout >= 0 || this.taken.has(id)) return;
      this.taken.add(id);
      this.alertNear(pk.x, pk.y, pk.z, 30);
      // Holdout first so the horde's source ignores the ahead bias. Its event goes before 'use' (whose HOLD OUT banner wins).
      if (s.hold) this.startHoldout(s);
      this.events.push(['use', p.id, id]);
      if (!s.hold) this.completeStep();
      return;
    } else if (pk.kind === 'item') {
      if (!s || s.kind !== 'collect' || s.group !== pk.group || this.taken.has(id)) return;
      this.taken.add(id); this.collected++;
      this.events.push(['pk', id], ['item', p.id, id, this.collected, s.count ?? 0]);
      return;
    }
    // Ammo piles serve each survivor once (hidden only for them); weapons are single-use.
    if (pk.kind === 'ammo') {
      if (this.taken.has(id) || p.ammoUsed.has(id) || p.primary < 0) return;
      p.ammoUsed.add(id);
      this.events.push(['got', p.id, id]);
      return;
    }
    if (this.taken.has(id) || p.ammoUsed.has(id)) return;
    if (pk.kind === 'armor') {
      if (p.armor >= ARMOR.max) return;
      this.taken.add(id); p.armor = ARMOR.max;
      this.events.push(['pk', id], ['got', p.id, id]);
      return;
    }
    const wi = WEAPONS.findIndex((w) => w.id === pk.kind), slot = WEAPONS[wi]?.slot;
    // Pockets full: it stays on the shelf for a teammate.
    if (slot === 'throw' && Object.values(p.thr).reduce((a, b) => a + b, 0) >= THROW_MAX) return;
    // Safe-room weapons are stacks (Level.stacks): one each, hidden only for whoever took it.
    const stack = this.L.stacks().has(id);
    if (stack) p.ammoUsed.add(id); else this.taken.add(id);
    if (slot === 'sidearm') p.sidearm = wi; else if (slot === 'melee') p.melee = wi; else if (slot === 'throw') p.thr[wi] = (p.thr[wi] ?? 0) + 1; else if (slot) p.primary = wi;
    this.events.push(...(stack ? [] : [['pk', id] as GameEvent]), ['got', p.id, id]);
  }

  // ---------------------------------------------------------------- zombies
  /** `y`: the floor height at (x, z) (a node centre's, from `cellPos`). */
  private spawnZombie(type: number, x: number, y: number, z: number, dormant = false): Zombie {
    const T = ZTYPES[type];
    const zb: Zombie = {
      id: this.nextZid++, type, x, y, z, ry: rand(0, Math.PI * 2), st: dormant ? ZSTATE.IDLE : ZSTATE.RUN,
      hp: type === ZT.BRUTE ? Math.round((T.hp + BRUTE_HP_PER * (this.players.size - 1)) * this.diff.bruteHp)
        : isCommon(type) ? T.hp : Math.round(T.hp * this.diff.spHp),
      speed: T.speed * rand(0.86, 1.14), offX: rand(-0.55, 0.55), offZ: rand(-0.55, 0.55),
      t: 0, hitDone: true, target: 0, dormant, stun: 0, vx: 0, vz: 0, leapCd: rand(1, 3), lx: 0, lz: 0,
      sp: rand(1.5, 3), flee: 0, pinT: 0, acc: 0, pinHit: 0, hunt: 0, hold: 0, wave: 0, region: -1, sit: false, anger: 0,
    };
    this.zombies.set(zb.id, zb);
    return zb;
  }

  /** A fresh attempt: roll every region's budget; nothing placed or spent yet. */
  private resetWanderers(): void {
    const list = this.cd.regions.list, n = list.length;
    const budget = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const v = list[i].weight * roll(WANDERERS.roll) * this.diff.wander;
      budget[i] = Math.floor(v) + (Math.random() < v % 1 ? 1 : 0);
    }
    this.wander = { budget, placed: new Int16Array(n), spent: new Uint8Array(n), minD: new Int16Array(n) };
    if (this.reach.length !== this.L.N) this.reach = new Int16Array(this.L.N);
  }

  /**
   * One wanderer pass (see WANDERERS): mark regions the team reached as spent, drop sleepers far
   * away, then place unplaced budget in unspent regions within reach, nearest region first. Cost:
   * one BFS plus a scan of the spawnable cells, and at most `triesMax` sight tests.
   */
  private placeWanderers(): void {
    const Wd = WANDERERS, L = this.L, R = this.cd.regions, st = this.wander;
    const stand = this.standing(), watch = this.watchers();
    let doors = this.doors;
    for (const d of this.cur?.opens ?? []) doors |= 1 << d;
    const src: number[] = [];
    for (const p of stand.length ? stand : this.spawnPoints()) {
      if (!L.inBounds(cellOf(p.x), cellOf(p.z))) continue;
      const n = L.nodeAt(p.x, p.y ?? 0, p.z);
      if (!L.blocked(n, doors)) src.push(n);
    }
    if (!src.length) return;
    const reach = this.L.distanceField(src, doors, this.reach);
    const minD = st.minD.fill(INF);
    for (const c of this.cd.open) { const r = R.regionOf[c]; if (reach[c] < minD[r]) minD[r] = reach[c]; }
    for (let r = 0; r < minD.length; r++) if (minD[r] <= Wd.visit) st.spent[r] = 1;

    let live = 0;
    const evictable: { z: Zombie; d: number }[] = [];
    for (const z of [...this.zombies.values()]) {
      if (!z.dormant) continue;
      const d = reach[this.nodeOf(z)];
      if (d > Wd.cull && !this.inSight(z.x, z.y, z.z, watch)) {
        this.zombies.delete(z.id);
        if (z.region >= 0 && !st.spent[z.region]) st.placed[z.region]--;
        continue;
      }
      live++;
      if (d > Wd.evict && (z.region < 0 || st.spent[z.region])) evictable.push({ z, d });
    }

    const want: number[] = [];
    let need = 0;
    for (let r = 0; r < minD.length; r++) {
      if (st.spent[r] || minD[r] > Wd.act || st.placed[r] >= st.budget[r]) continue;
      want.push(r); need += st.budget[r] - st.placed[r];
    }
    if (!want.length) return;
    want.sort((a, b) => minD[a] - minD[b]);
    // At the cap, sleepers left in spent regions well away from the team make room for fresh ground.
    if (live + need > Wd.max && evictable.length) {
      evictable.sort((a, b) => b.d - a.d);
      for (const e of evictable) {
        if (live + need <= Wd.max) break;
        if (this.inSight(e.z.x, e.z.y, e.z.z, watch)) continue;
        this.zombies.delete(e.z.id); live--;
      }
    }

    let tries = Wd.triesMax;
    const ok = (c: number, r: number) => R.regionOf[c] === r && reach[c] >= Wd.near && reach[c] <= Wd.far && Math.random() < R.mult[c];
    const put = (c: number, r: number): boolean => {
      const o = L.centre(c), x = o.x + rand(-0.4, 0.4), z = o.z + rand(-0.4, 0.4);
      if (!this.hidden(x, o.y, z, stand, 20)) return false;
      this.spawnZombie(this.commonType(), x, o.y, z, true).region = r;
      st.placed[r]++; live++;
      return true;
    };
    for (const r of want) {
      if (tries <= 0 || live >= Wd.max) break;
      const cells = R.list[r].cells, before = st.placed[r];
      let t = Math.min(tries, (st.budget[r] - st.placed[r]) * Wd.triesPer);
      tries -= t;
      while (t-- > 0 && st.placed[r] < st.budget[r] && live < Wd.max) {
        const c = cells[(Math.random() * cells.length) | 0];
        if (!ok(c, r) || !put(c, r)) continue;
        // A clump: up to two more on neighbouring cells of the same region.
        let k = 0, u = Math.random();
        while (k < Wd.clump.length - 1 && u >= Wd.clump[k]) u -= Wd.clump[k++];
        const cx = L.nodeX(c), cz = L.nodeZ(c), lv = L.lvOf(c);
        for (let i = 0, o = (Math.random() * 8) | 0; i < 8 && k > 0; i++) {
          const [dx, dz] = DIRS8[(o + i) % 8];
          if (st.placed[r] >= st.budget[r] || live >= Wd.max) break;
          if (!L.inBounds(cx + dx, cz + dz)) continue;
          const n = L.node(cx + dx, cz + dz, lv);
          if (ok(n, r) && put(n, r)) k--;
        }
      }
      if (DIRECTOR_DEBUG && st.placed[r] > before) console.log(`[director ${this.code}] t=${this.time.toFixed(1)} region ${r} at ${minD[r]} tiles: ${st.placed[r]}/${st.budget[r]} sleepers (${live} live)`);
    }
  }

  /** Wake sleepers within `radius` m of a noise at (x, z) on the floor at height y (it carries between storeys). */
  private alertNear(x: number, y: number, z: number, radius: number): void {
    for (const zb of this.zombies.values()) if (zb.dormant && Math.hypot(zb.x - x, zb.z - z, zb.y - y) < radius) zb.dormant = false;
  }

  private damageZombie(z: Zombie, dmg: number, by: Player | null, head: boolean): void {
    if (z.hp <= 0) return;
    z.hp -= dmg;
    z.dormant = false;
    if (z.hold && z.hp > 0) this.blowAmbush(z, 'hurt'); // found out: it fights back now
    if (z.sit && z.hp > 0) this.wakeWeeper(z, by);
    // Enough teammate fire knocks a pinning Charger off its victim.
    if (z.hp > 0 && by && z.type === ZT.CHARGER && z.st === ZSTATE.PIN) {
      z.pinHit += dmg;
      if (z.pinHit >= CHARGER.pinBreakDmg) {
        z.pinHit = 0;
        for (const q of this.players.values()) if (q.pinned === z.id) this.unpin(q);
        z.st = ZSTATE.STAGGER; z.stun = 1.2; z.vx = -z.lx * 2; z.vz = -z.lz * 2;
      }
    }
    if (z.hp > 0) return;
    this.zombies.delete(z.id);
    this.kills++;
    if (z.hold) this.blowAmbush(z, 'killed');
    if (SLOTTED(z.type)) this.specialGone(z.type);
    if (by) by.kills++;
    for (const p of this.players.values()) {
      const d = Math.hypot(p.x - z.x, p.z - z.z, p.gy - z.y);
      if (d < DIRECTOR.killR) this.bumpIntensity(p, DIRECTOR.kill);
      else if (d < DIRECTOR.killFarR) this.bumpIntensity(p, DIRECTOR.killFar);
    }
    this.events.push(['zdie', z.id, r2(z.x), r2(z.z), z.type, head ? 1 : 0, by ? by.id : 0, r2(z.y)]);
    if (z.type === ZT.PUFFER) this.explode(z);
    if (z.type === ZT.BRUTE) this.events.push(['msg', 'The Brute is down!']);
    if (z.type === ZT.DROOLER) this.addPuddle(z.x, z.y, z.z, DROOLER.deathR, DROOLER.deathLife);
    if (z.type === ZT.ALARM && z.st === ZSTATE.RING) this.events.push(['msg', 'Alarm Clock silenced!']);
    if (z.type === ZT.WEEPER) this.events.push(['msg', 'The Weeper is quiet now.']);
    for (const p of this.players.values()) if (p.pinned === z.id) this.unpin(p);
  }

  // ------------------------------------------------- goo, pins and alarms
  private clearHazards(): void {
    this.globs = []; this.puddles = []; this.fires = []; this.lures = [];
    for (const p of this.players.values()) p.pinned = 0;
  }

  /** A goo puddle at (x, z) on the floor at height y. */
  private addPuddle(x: number, y: number, z: number, r: number, life: number): void {
    if (this.puddles.length >= DROOLER.maxPuddles) this.puddles.shift();
    const pd: Puddle = { id: this.nextPuddle++, x, y, z, r, life, age: 0, tick: DROOLER.delay };
    this.puddles.push(pd);
    this.events.push(['puddle', pd.id, r2(x), r2(z), r, life, r2(y)]);
  }

  /** Globs in flight land as puddles; puddles burn whoever stands in them. */
  private updateHazards(dt: number): void {
    for (let i = this.globs.length - 1; i >= 0; i--) {
      const g = this.globs[i];
      g.t -= dt;
      if (g.t > 0) continue;
      this.globs.splice(i, 1);
      this.addPuddle(g.x1, g.y1, g.z1, DROOLER.puddleR, DROOLER.puddleLife);
    }
    for (let i = this.puddles.length - 1; i >= 0; i--) {
      const pd = this.puddles[i];
      pd.age += dt;
      if (pd.age >= pd.life) { this.puddles.splice(i, 1); continue; }
      if (pd.age < pd.tick) continue;
      pd.tick += DROOLER.tick;
      for (const p of this.players.values()) {
        if (p.st === PSTATE.DEAD || Math.hypot(p.x - pd.x, p.z - pd.z) > pd.r + PLAYER.radius * 0.5 || Math.abs(p.gy - pd.y) > REACH_DY) continue;
        // Downed survivors can't crawl out, so the goo goes easier on them.
        const dmg = DROOLER.dps * DROOLER.tick * (p.st === PSTATE.DOWN ? 0.5 : 1);
        this.damagePlayer(p, dmg, pd.x, pd.z, true);
      }
    }
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.age += dt;
      if (f.age >= f.life) { this.fires.splice(i, 1); continue; }
      if (f.age < f.tick) continue;
      f.tick += FIRE.tick;
      const by = this.players.get(f.by) ?? null;
      for (const z of [...this.zombies.values()]) {
        // Raincoats walk straight through.
        if (z.type === ZT.RAINCOAT || Math.hypot(z.x - f.x, z.z - f.z) > f.r + ZTYPES[z.type].radius || Math.abs(z.y - f.y) > REACH_DY) continue;
        if (!this.L.hasLOS(f.x, f.y + 0.5, f.z, z.x, z.y + 0.5, z.z, this.doors)) continue;
        this.damageZombie(z, FIRE.dps * FIRE.tick, by, false);
      }
      for (const p of this.players.values()) {
        // Only the standing burn: someone down can't crawl out of a teammate's fire.
        if (p.st !== PSTATE.ALIVE || Math.hypot(p.x - f.x, p.z - f.z) > f.r || Math.abs(p.gy - f.y) > REACH_DY) continue;
        this.damagePlayer(p, FIRE.ff * FIRE.tick, f.x, f.z, true, false);
      }
    }
    for (let i = this.lures.length - 1; i >= 0; i--) {
      const l = this.lures[i];
      if ((l.t -= dt) > 0) continue;
      this.lures.splice(i, 1);
      this.popLure(l);
    }
  }

  /** A Rattle Bomb goes off. */
  private popLure(l: Lure): void {
    const B = WEAPONS[l.w]?.blast;
    if (!B) return;
    this.events.push(['blast', 0, r2(l.x), r2(l.y + 0.4), r2(l.z), 1]);
    this.applyBlast(this.players.get(l.by) ?? null, B, l.x, l.y + 0.4, l.z, 1);
  }

  /** Path field toward an awake Weeper's victim (she goes for them, not whoever is nearest); refreshed with the flow field. */
  private weeperField = new Int16Array(1);
  private recomputeWeeper(): void {
    for (const z of this.zombies.values()) {
      if (z.type !== ZT.WEEPER || z.sit || z.flee > 0) continue;
      const v = this.players.get(z.target);
      if (!v) continue;
      if (this.weeperField.length !== this.flow.length) this.weeperField = new Int16Array(this.flow.length);
      this.L.distanceField([v.node], this.doors, this.weeperField);
      return;
    }
  }

  /** The lure a common at node `c` flocks to (the nearest within LURE.tiles), if any. */
  private lureFor(c: number): Lure | null {
    let best: Lure | null = null, bd = LURE.tiles + 1;
    for (const l of this.lures) if (l.field[c] < bd) { bd = l.field[c]; best = l; }
    return best;
  }

  /** Zombie `z` takes hold of survivor `p` (Snatcher lasso, Piggyback ride): the server moves them until 'unpin'. */
  private grab(z: Zombie, p: Player): void {
    p.pinned = z.id; p.reviving = 0;
    // The server moves them from here (Level.moveSlide): on the floor, out of any jump.
    p.y = p.gy;
    this.bumpIntensity(p, DIRECTOR.pin);
    z.st = ZSTATE.PIN; z.target = p.id; z.pinT = 0; z.acc = 0; z.pinHit = 0; z.t = 0;
    this.events.push(['pin', p.id, z.id, r2(p.x), r2(p.z), r2(p.y)]);
  }

  /** The sitting Weeper `z` is woken: she goes for `by` (or whoever is nearest) until they drop. */
  private wakeWeeper(z: Zombie, by: Player | null): void {
    let tg = by && by.st === PSTATE.ALIVE ? by : null;
    if (!tg) { let bd = Infinity; for (const p of this.standing()) { const d = Math.hypot(p.x - z.x, p.z - z.z, p.gy - z.y); if (d < bd) { bd = d; tg = p; } } }
    z.sit = false; z.anger = 1; z.target = tg ? tg.id : 0; z.st = ZSTATE.RUN; z.flee = 0;
    this.recomputeWeeper();
    if (tg) this.bumpIntensity(tg, DIRECTOR.pin);
    this.events.push(['weeper', z.id, 2, z.target], ['msg', tg ? `${tg.name} woke the Weeper!` : 'The Weeper is awake!']);
  }

  /**
   * Weeper tick. Sitting: anger builds while a standing survivor lingers close in her sight and
   * settles otherwise (WEEPER); returns true (she stays put). Awake: true while she is running off
   * after dropping her victim (removed once nobody can see her), false to chase and attack as usual.
   */
  private weeperTick(z: Zombie, dt: number): boolean {
    if (z.sit) {
      let rate = 0, who: Player | null = null;
      for (const p of this.players.values()) {
        if (p.st !== PSTATE.ALIVE) continue;
        const d = Math.hypot(p.x - z.x, p.z - z.z, p.gy - z.y);
        if (d > WEEPER.near || !this.sight(z.x, z.y, z.z, p.x, p.gy, p.z)) continue;
        const r = 1 + (WEEPER.closeMul - 1) * (1 - d / WEEPER.near);
        if (r > rate) { rate = r; who = p; }
      }
      const was = z.anger;
      z.anger = rate > 0 ? z.anger + (rate * dt) / WEEPER.wake : Math.max(0, z.anger - (WEEPER.calm * dt) / WEEPER.wake);
      if (was < WEEPER.warn && z.anger >= WEEPER.warn) this.events.push(['weeper', z.id, 1, who ? who.id : 0]);
      z.st = z.anger >= WEEPER.warn ? ZSTATE.WINDUP : ZSTATE.IDLE;
      if (who) z.ry = Math.atan2(-(who.x - z.x), -(who.z - z.z));
      if (z.anger >= 1) this.wakeWeeper(z, who);
      return true;
    }
    if (z.flee > 0) {
      z.flee -= dt;
      this.backOff(z, 1, dt);
      if (z.flee <= 0 || !this.inSight(z.x, z.y, z.z, this.watchers())) this.zombies.delete(z.id);
      return true;
    }
    const v = this.players.get(z.target);
    if (!v || v.st !== PSTATE.ALIVE) {
      z.flee = WEEPER.fleeTime; z.stun = 0;
      this.events.push(['msg', 'The Weeper runs off, sobbing.']);
      return true;
    }
    return false;
  }

  private unpin(p: Player): void {
    if (!p.pinned) return;
    // A grabber moved them: hold their position until their client has snapped to it.
    const by = this.zombies.get(p.pinned);
    if (by && GRABBER(by.type)) p.freeAt = this.time + 0.3;
    p.pinned = 0;
    this.events.push(['unpin', p.id]);
  }

  /** Drop holds whose zombie is gone, stunned or no longer holding this survivor. */
  private checkPins(): void {
    for (const p of this.players.values()) {
      if (!p.pinned) continue;
      const z = this.zombies.get(p.pinned);
      if (p.st !== PSTATE.ALIVE || !z || z.st !== ZSTATE.PIN || z.target !== p.id || z.stun > 0) this.unpin(p);
    }
  }

  /**
   * Charger hit survivor `p` while rushing along (lx, lz). With a wall close behind them they
   * are slammed and pinned there; otherwise they're bowled over. Returns true for a pin.
   */
  private chargeHit(z: Zombie, p: Player): boolean {
    const T = ZTYPES[ZT.CHARGER], go = this.doors;
    this.damagePlayer(p, CHARGER.hitDmg, z.x, z.z);
    if (p.st !== PSTATE.ALIVE) return false;
    this.bumpIntensity(p, DIRECTOR.charge);
    // March from the survivor along the charge until a wall (or a drop) stops them.
    let x = p.x, y = p.gy, zz = p.z, wall = false;
    for (let s = 0.25; s <= CHARGER.pinWallDist; s += 0.25) {
      const nx = p.x + z.lx * s, nz = p.z + z.lz * s;
      if (this.L.boxBlocked(nx, y, nz, PLAYER.radius, go)) { wall = true; break; }
      x = nx; zz = nz; y = this.L.groundY(nx, y, nz);
    }
    if (!wall) {
      this.events.push(['kb', p.id, r2(z.lx * CHARGER.knock), r2(z.lz * CHARGER.knock)]);
      return false;
    }
    p.x = x; p.y = y; p.z = zz; p.pinned = z.id; p.reviving = 0;
    this.place(p);
    this.bumpIntensity(p, DIRECTOR.pin);
    z.st = ZSTATE.PIN; z.target = p.id; z.pinT = 0; z.acc = 0; z.pinHit = 0;
    // Plant the Charger right in front of its victim.
    const back = T.radius + PLAYER.radius + 0.05;
    this.L.moveSlide(z, x - z.lx * back - z.x, zz - z.lz * back - z.z, T.radius, go);
    this.events.push(['pin', p.id, z.id, r2(x), r2(zz), r2(y)], ['slam', z.id, r2(x), r2(zz), r2(y)]);
    return true;
  }

  /** Retreat one flow-field step away from the survivors (idles when cornered). */
  private backOff(z: Zombie, mult: number, dt: number, field: Int16Array = this.flow): void {
    const to = this.flowStep(z, 1, field);
    if (!to) { z.st = ZSTATE.IDLE; return; }
    this.walkTo(z, to, mult, dt);
  }

  /** Walk straight toward `to` at `mult` x its speed (slower on ladders). */
  private walkTo(z: Zombie, to: Vec2, mult: number, dt: number): void {
    const dx = to.x - z.x, dz = to.z - z.z, len = Math.hypot(dx, dz);
    if (len > 0.01) {
      const sp = z.speed * mult * this.L.speedAt(z.x, z.y, z.z, LADDER_SPEED * ZOMBIE_LADDER) * dt;
      this.L.moveSlide(z, (dx / len) * sp, (dz / len) * sp, ZTYPES[z.type].radius, this.doors);
      z.ry = Math.atan2(-dx, -dz);
    }
    z.st = ZSTATE.RUN;
  }

  /** Scratch for Level.neighbors8. */
  private nb: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  /**
   * Next flow-field node centre (plus the zombie's own offset) toward (dir = -1) or away from (dir = 1)
   * the survivors, or null if stuck. Steps along the walk graph (Level.neighbors8: no cutting wall
   * corners; up and down stairs and ladders), so a zombie in the street finds the way up to the roof.
   */
  private flowStep(z: Zombie, dir: 1 | -1, field: Int16Array = this.flow): Pos3 | null {
    const L = this.L, here = this.nodeOf(z);
    let best = field[here], bn = here;
    this.stepNode = here;
    if (best >= INF) return null;
    const nb = this.nb, k = L.neighbors8(here, this.doors, nb);
    for (let i = 0; i < k; i++) {
      const v = field[nb[i]];
      if (v >= INF) continue;
      if (dir < 0 ? v < best : v > best) { best = v; bn = nb[i]; }
    }
    if (bn === here) return null;
    this.stepNode = bn;
    const c = L.centre(bn);
    c.x += z.offX; c.z += z.offZ;
    return c;
  }
  /** Node the last flowStep headed for (its own node when it returned null). */
  private stepNode = 0;
  /** Ladder node -> zombies on (or stepping onto) it this tick (at most `diff.ladder`, see updateZombies). */
  private onLadder = new Map<number, number>();

  private explode(z: Zombie): void {
    const T = ZTYPES[ZT.PUFFER];
    this.events.push(['boom', r2(z.x), r2(z.z), r2(z.y)]);
    let gooed = false;
    for (const p of this.players.values()) {
      if (p.st === PSTATE.DEAD) continue;
      if (Math.hypot(p.x - z.x, p.z - z.z) > T.boomRadius || Math.abs(p.gy - z.y) > REACH_DY) continue;
      this.damagePlayer(p, T.boomDmg, z.x, z.z);
      this.bumpIntensity(p, DIRECTOR.goo);
      this.events.push(['goo', p.id]);
      this.marks.set(p.id, this.time + GOO_HUNT);
      gooed = true;
    }
    for (const o of [...this.zombies.values()]) {
      if (!isCommon(o.type)) continue;
      if (Math.hypot(o.x - z.x, o.z - z.z) < 3 && Math.abs(o.y - z.y) < REACH_DY) this.damageZombie(o, 60, null, false);
    }
    // Like bile: the called wave comes at the gooed survivors and goes for them first.
    if (gooed) { this.recomputeMarks(); this.spawnWave(this.mobSize(6 + this.players.size), { hunt: GOO_HUNT }); this.events.push(['msg', 'The goo is attracting more of them!']); }
  }

  /**
   * `quiet`: damage over time (goo) that shouldn't stagger/slow the victim on their client.
   * `scaled`: zombie damage: the difficulty multiplier applies and it raises intensity (off for friendly fire).
   */
  private damagePlayer(p: Player, dmg: number, sx: number, sz: number, quiet = false, scaled = true): void {
    if (p.st === PSTATE.DEAD || this.state !== 'play') return;
    // Intensity reads the damage before difficulty: a softer bite on Easy must not make breathers rarer.
    if (scaled) this.bumpIntensity(p, dmg * DIRECTOR.dmg); // friendly fire doesn't make the director back off
    if (scaled && this.diff.dmg !== 1) dmg = r2(dmg * this.diff.dmg);
    // A Pillow Vest soaks up part of each bite or hit (not goo, fire or friendly blasts) while it lasts.
    if (scaled && !quiet && p.armor > 0 && p.st === PSTATE.ALIVE) {
      const a = Math.min(p.armor, dmg * ARMOR.absorb);
      p.armor = r2(p.armor - a); dmg = r2(dmg - a);
      this.events.push(['armor', p.id]);
    }
    p.hp -= dmg;
    this.events.push(quiet ? ['sizzle', p.id, dmg] : ['hurt', p.id, dmg, r2(sx), r2(sz)]);
    if (p.hp > 0) return;
    if (p.st === PSTATE.ALIVE) {
      this.bumpIntensity(p, DIRECTOR.down);
      this.unpin(p);
      p.downs++;
      // The down that kills (SURVIVOR_RULES.downs): no getting back up this time.
      if (p.downs >= this.rules.downs) {
        this.events.push(['msg', `${p.name} went down one time too many!`]);
        this.killPlayer(p);
        return;
      }
      p.st = PSTATE.DOWN; p.hp = PLAYER.hp; p.revT = 0; p.y = p.gy;
      // Alone: get yourself up (slowly) while self-revives last.
      p.revNeed = this.players.size === 1 && p.selfRev > 0 ? PLAYER.reviveTime * PLAYER.selfReviveMul : PLAYER.reviveTime;
      this.events.push(['down', p.id]);
    } else {
      this.killPlayer(p);
    }
  }

  private killPlayer(p: Player): void {
    this.unpin(p);
    p.st = PSTATE.DEAD; p.hp = 0; p.respawnT = this.rules.respawn; p.y = p.gy;
    this.events.push(['dead', p.id]);
  }

  // ---------------------------------------------------- "ahead of the team"
  /** BFS distance to the current objective (recomputed when the step, doors or items change). */
  private objField = new Int16Array(1);
  private objKey = '';
  private objectiveField(): Int16Array | null {
    const s = this.cur;
    if (!s) return null;
    const key = `${this.step}|${this.doors}|${this.collected}`;
    if (key === this.objKey) return this.objField;
    this.objKey = key;
    const src = objectiveCells(this.L, s, this.doors, this.taken);
    if (this.objField.length !== this.L.N) this.objField = new Int16Array(this.L.N);
    this.L.distanceField(src, this.doors, this.objField);
    return this.objField;
  }

  // Choose a tile to spawn on: a decent walk away, out of sight and (with probability `ahead`)
  // between the team and its objective rather than behind it. `ahead` < 0: behind the team instead.
  private pickSpawnCell(minD: number, maxD: number, ahead: number): number {
    const side: Side = ahead < 0 ? -1 : Math.random() < ahead ? 1 : 0;
    // Stages: in range (on the rolled side) → a bit further out → (sided) further still → any direction.
    return this.trySpawnCell(minD, maxD, side)
      ?? this.trySpawnCell(minD, maxD + 8, side)
      ?? (side ? this.trySpawnCell(minD + 4, maxD + 16, side) ?? this.trySpawnCell(minD, maxD + 8, 0) : null)
      ?? -1;
  }

  /**
   * `side` 1: no further from the objective than the lead survivor; -1: further from it than the
   * rearmost survivor (behind the team); 2: between the two (a flank); 0: anywhere. `field`: path distances `minD`..`maxD` are
   * measured on (default: to the nearest survivor).
   * Holding out on a perch (a holdout with every standing survivor up on a small deck, roof or
   * catwalk: see perchLevel), spawns first try a storey below it, up to `perchReach` path tiles
   * further out, so the horde comes up the stairs and ladders instead of out of a hidden corner of
   * the perch; the usual rule when no such cell is hidden.
   */
  private trySpawnCell(minD: number, maxD: number, side: Side, field = this.flow): number | null {
    if (this.holdout >= 0 && field === this.flow) {
      const lv = this.perchLevel();
      if (lv > 0) {
        const c = this.sampleSpawnCell(minD, maxD + DIRECTOR.holdout.perchReach, side, field, lv);
        if (c !== null) return c;
      }
    }
    return this.sampleSpawnCell(minD, maxD, side, field, Infinity);
  }

  /**
   * Storey of the perch the whole standing team is on, or 0 if they are not all up on one. A perch is
   * an upper-storey floor of fewer than `perchMax` nodes you can walk around without taking stairs
   * or a ladder (a deck, a small roof, a catwalk), measured from the lowest survivor; a whole upper
   * floor or a big roof is not one.
   */
  private perchLevel(): number {
    const L = this.L;
    if (L.levels < 2) return 0;
    let low: Player | null = null;
    for (const p of this.standing()) if (!low || L.lvOf(p.node) < L.lvOf(low.node)) low = p;
    if (!low || L.lvOf(low.node) === 0) return 0;
    const lv = L.lvOf(low.node), max = DIRECTOR.holdout.perchMax;
    if (this.perchMemo.doors !== this.doors) this.perchMemo = { doors: this.doors, size: new Map() };
    let size = this.perchMemo.size.get(low.node);
    if (size === undefined) {
      // Flood the flat floor on this storey from where they stand, up to perchMax nodes.
      const seen = new Set<number>([low.node]), queue = [low.node];
      for (let i = 0; i < queue.length && seen.size < max; i++) {
        for (let k = 0; k < 4; k++) {
          const m = L.adj[queue[i] * 4 + k];
          if (m < 0 || seen.has(m) || L.lvOf(m) !== lv || L.def.ramp[m] || L.blocked(m, this.doors)) continue;
          seen.add(m); queue.push(m);
        }
      }
      size = seen.size;
      this.perchMemo.size.set(low.node, size);
    }
    return size < max ? lv : 0;
  }
  private perchMemo = { doors: -1, size: new Map<number, number>() };

  /** trySpawnCell's sampler; `below`: only cells on a lower storey than this. */
  private sampleSpawnCell(minD: number, maxD: number, side: Side, field: Int16Array, below: number): number | null {
    const players = this.standing();
    const L = this.L, open = this.cd.open;
    let lo = -1, hi = INF;
    const obj = side ? this.objectiveField() : null;
    if (obj) {
      let lead = INF, rear = -1;
      for (const p of players) {
        const v = obj[p.node];
        if (v >= INF) continue;
        lead = Math.min(lead, v); rear = Math.max(rear, v);
      }
      if (side === 1 && lead < INF) hi = lead + 2;
      if (side === -1 && rear >= 0) lo = rear + 2;
      if (side === 2 && lead < INF) { lo = lead - 2; hi = rear + 2; } // level with the team, yet a walk away: a side branch
    }
    // Sample near the team first (most open cells are far away on a big map).
    const near = this.nearCells();
    for (let tries = 0; tries < 90; tries++) {
      const c = near.length && tries < 80 ? near[(Math.random() * near.length) | 0] : open[(Math.random() * open.length) | 0];
      const d = field[c];
      if (d < minD || d > maxD || L.lvOf(c) >= below) continue;
      if (obj && (obj[c] > hi || obj[c] < lo)) continue;
      const o = L.centre(c);
      if (this.hidden(o.x, o.y, o.z, players, MIN_SPAWN_DIST)) return c;
    }
    return null; // never spawn where a survivor can see it
  }

  /**
   * True if a zombie at (x, z) standing at floor height y can't be seen by any survivor: at least
   * `minDist` metres away, and no line of sight (eye to eye height) to the body's centre or its
   * edges, from where each survivor stands or from a few metres ahead of where they are
   * looking/walking on their own floor (so a spawn isn't revealed the moment they step through a
   * doorway, turn a corner or walk to a roof edge).
   */
  private hidden(x: number, y: number, z: number, players: Player[], minDist: number): boolean {
    const L = this.L, o = this.doors, e = 0.7, ty = y + EYE;
    for (const p of players) {
      if (Math.hypot(p.x - x, p.z - z) < minDist) return false;
      const fx = -Math.sin(p.ry), fz = -Math.cos(p.ry);
      const eyes: [number, number, number][] = [[p.x, p.gy + EYE, p.z]];
      for (const k of [2.5, 5]) {
        const ex = p.x + fx * k, ez = p.z + fz * k;
        if (!L.inBounds(cellOf(ex), cellOf(ez))) break;
        const n = L.nodeAt(ex, p.gy, ez), h = L.heightAt(n, ex, ez);
        // Not past a roof edge or a stairwell onto another storey's floor.
        if (L.blocked(n, o) || Math.abs(h - p.gy) > STOREY * 0.9) break;
        eyes.push([ex, h + EYE, ez]);
      }
      for (const [ex, ey, ez] of eyes) {
        if (L.hasLOS(ex, ey, ez, x, ty, z, o) || L.hasLOS(ex, ey, ez, x + e, ty, z, o) || L.hasLOS(ex, ey, ez, x - e, ty, z, o)
          || L.hasLOS(ex, ey, ez, x, ty, z + e, o) || L.hasLOS(ex, ey, ez, x, ty, z - e, o)) return false;
      }
    }
    return true;
  }

  private nearCache: { t: number; cells: number[] } = { t: -1, cells: [] };
  /** Spawnable cells within 40 path tiles of the team (refreshed once per tick). */
  private nearCells(): number[] {
    if (this.nearCache.t === this.tickN) return this.nearCache.cells;
    const cells: number[] = [];
    for (const c of this.cd.open) if (this.flow[c] <= 40) cells.push(c);
    this.nearCache = { t: this.tickN, cells };
    return cells;
  }

  /** `ahead`: chance the spawn must be on the objective side of the team. */
  private spawnAt(type: number, minD: number, maxD: number, ahead = 0.85): Zombie | null {
    const c = this.pickSpawnCell(minD, maxD, this.holdout >= 0 ? 0 : ahead);
    if (c < 0) return null;
    const o = this.cellPos(c);
    return this.spawnZombie(type, o.x + rand(-0.5, 0.5), o.y, o.z + rand(-0.5, 0.5));
  }

  /**
   * Spawn special `type` `minD`..`maxD` path tiles from the team: near a lone wolf (lonerBias), else on
   * the side its `place` entry rolls (any side in holdouts), the best covered of a few hidden cells.
   * `hold`: lurk until the coordinated release (ambushers only).
   */
  private spawnSpecial(type: number, minD: number, maxD: number, hold: boolean): Zombie | null {
    const S = DIRECTOR.specials;
    let c = -1;
    if (AMBUSHER(type) && this.lonerP() && Math.random() < S.lonerBias) {
      const [a, b] = S.lonerSpawn;
      c = this.trySpawnCell(a, b, 0, this.lonerField) ?? this.trySpawnCell(a, b + 6, 0, this.lonerField) ?? -1;
    }
    if (c < 0) {
      const [pa, pf, pb] = S.place[type] ?? [0, 0, 0], r = Math.random();
      const side: Side = this.holdout >= 0 ? 0 : r < pa ? 1 : r < pa + pf ? 2 : r < pa + pf + pb ? -1 : 0;
      let cover = -1;
      for (let i = 0; i < 3; i++) {
        const k = this.trySpawnCell(minD, maxD, side) ?? this.trySpawnCell(minD, maxD + 8, side);
        if (k === null) break;
        const v = this.coverAt(k);
        if (v > cover) { cover = v; c = k; }
      }
      if (c < 0 && side) c = this.trySpawnCell(minD, maxD + 8, 0) ?? -1;
    }
    if (c < 0) return null;
    const p = this.cellPos(c), zb = this.spawnZombie(type, p.x + rand(-0.5, 0.5), p.y, p.z + rand(-0.5, 0.5));
    if (hold && AMBUSHER(type)) zb.hold = 1;
    return zb;
  }

  /** Solid cells (walls, props; not open air) around node `c` on its storey: more = better cover to lurk behind. */
  private coverAt(c: number): number {
    const L = this.L, x = L.nodeX(c), z = L.nodeZ(c), lv = L.lvOf(c);
    let n = 0;
    for (const [ox, oz] of DIRS8) if (L.solidAt(x + ox, z + oz, this.doors, lv) && !(L.inBounds(x + ox, z + oz) && L.def.air[L.node(x + ox, z + oz, lv)])) n++;
    return n;
  }

  // ------------------------------------------------------------- ambushes
  /** Room time a type's cooldown starts: when the last live one of it is gone. */
  private specialGone(type: number): void {
    for (const o of this.zombies.values()) if (o.type === type && !o.dormant) return;
    const cd = DIRECTOR.specials.cd[type];
    if (cd) this.spReady[type] = this.time + roll(cd) * this.diff.spCd;
  }

  /** Holder `z` was found out: it attacks now, and the rest of the ambush follows shortly. */
  private blowAmbush(z: Zombie, why: string): void {
    z.hold = 0;
    this.ambushUntil = Math.min(this.ambushUntil, this.time + DIRECTOR.specials.blownWait);
    if (DIRECTOR_DEBUG) console.log(`[director ${this.code}] t=${this.time.toFixed(1)} ambush blown: ${ZTYPES[z.type].id} ${why}`);
  }

  /** Every holder attacks at once. */
  private releaseAmbush(why: string): void {
    let n = 0;
    for (const z of this.zombies.values()) if (z.hold) { z.hold = 0; n++; }
    this.ambushUntil = Infinity;
    if (DIRECTOR_DEBUG && n) console.log(`[director ${this.code}] t=${this.time.toFixed(1)} ambush released (${why}): ${n} specials`);
  }

  /** 0: no survivor sees (x, z) at floor height y; 1: one could (in sight, unaware); 2: spotted (close, or in someone's view cone). */
  private seenAt(x: number, y: number, z: number): number {
    const S = DIRECTOR.specials;
    let seen = 0;
    for (const p of this.players.values()) {
      if (p.st !== PSTATE.ALIVE) continue;
      const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz, y - p.gy);
      if (d > S.spotR || !this.sight(p.x, p.gy, p.z, x, y, z)) continue;
      if (d < S.spotClose || (-Math.sin(p.ry) * dx - Math.cos(p.ry) * dz) / (d || 1) > S.spotCone) return 2;
      seen = 1;
    }
    return seen;
  }

  /**
   * A holding special stalks `target` on `field` (path tiles): closes to holdFar without stepping
   * into anyone's sight, backs off inside holdNear or while seen, else waits facing them. Returns
   * false when it stops holding (spotted or walked up on) and should attack this tick.
   */
  private lurk(z: Zombie, target: Player, field: Int16Array, dt: number): boolean {
    const S = DIRECTOR.specials;
    const here = field[this.nodeOf(z)];
    // Perception at 10 Hz, staggered by id.
    if ((this.tickN + z.id) % 3 === 0) {
      if (here <= S.closeTiles) { this.blowAmbush(z, 'walked up on'); return false; }
      const seen = this.seenAt(z.x, z.y, z.z);
      if (seen === 2) { this.blowAmbush(z, 'spotted'); return false; }
      z.hold = seen ? 2 : 1;
    }
    if (here >= INF) { z.st = ZSTATE.IDLE; return true; }
    if (z.hold === 2 || here < S.holdNear) { this.backOff(z, 0.9, dt, field); return true; }
    if (here > S.holdFar) {
      const to = this.flowStep(z, -1, field);
      if (to && !this.seenAt(to.x, to.y, to.z)) { this.walkTo(z, to, 0.85, dt); return true; }
    }
    z.st = ZSTATE.IDLE; z.ry = Math.atan2(-(target.x - z.x), -(target.z - z.z));
    return true;
  }

  /** The singled-out lone wolf, if still standing. */
  private lonerP(): Player | null {
    const p = this.loner ? this.players.get(this.loner) : undefined;
    return p && p.st === PSTATE.ALIVE ? p : null;
  }

  /**
   * Lone-wolf check (with the flow field, 4 Hz). A survivor's isolation is the distance to the nearest
   * standing teammate: straight if they can see each other, else walking (one BFS from them, only
   * when a teammate is out of sight yet near enough to matter). Singles out the most isolated one
   * cut off for lonerTime (ties: the one further back), and keeps a field toward them.
   */
  private updateLoner(dt: number): void {
    const S = DIRECTOR.specials, stand = this.standing(), N = this.L.N;
    if (this.players.size < 2 || stand.length < 2) { this.loner = 0; this.isoT.clear(); return; }
    let pick: Player | null = null, pickIso = 0;
    for (const p of stand) {
      let iso = Infinity, walked = false;
      for (const q of stand) {
        if (q === p) continue;
        const d = Math.hypot(q.x - p.x, q.z - p.z, q.gy - p.gy);
        if (d >= iso) continue;
        if (d > S.lonerDist || this.sight(p.x, p.gy, p.z, q.x, q.gy, q.z)) { iso = d; continue; }
        if (!walked) {
          walked = true;
          if (this.isoScratch.length !== N) this.isoScratch = new Int16Array(N);
          this.L.distanceField([p.node], this.doors, this.isoScratch);
        }
        iso = Math.min(iso, this.isoScratch[q.node] * TILE);
      }
      const cut = p.id === this.loner ? iso > S.lonerExit : iso > S.lonerDist;
      const t = cut ? (this.isoT.get(p.id) ?? 0) + dt : 0;
      this.isoT.set(p.id, t);
      if (t < S.lonerTime && p.id !== this.loner) continue;
      if (!cut) continue;
      if (!pick || iso > pickIso + 1 || (iso > pickIso - 1 && this.progressAt(p.x, p.gy, p.z) < this.progressAt(pick.x, pick.gy, pick.z))) { pick = p; pickIso = iso; }
    }
    // Stick with the current loner while they're still cut off.
    const cur = this.lonerP();
    if (cur && (this.isoT.get(cur.id) ?? 0) > 0) pick = cur;
    if ((pick?.id ?? 0) !== this.loner && DIRECTOR_DEBUG) console.log(`[director ${this.code}] t=${this.time.toFixed(1)} loner: ${pick ? pick.name : 'none'}`);
    this.loner = pick ? pick.id : 0;
    if (!pick) return;
    if (this.lonerField.length !== N) this.lonerField = new Int16Array(N);
    this.L.distanceField([pick.node], this.doors, this.lonerField);
  }

  // ------------------------------------------------------------------ waves
  private waves: Wave[] = [];
  private nextWave = 1;
  /** Goo-marked survivors (pid → room time the mark wears off) and the BFS field toward them. */
  private marks = new Map<number, number>();
  private markFlow = new Int16Array(1);
  private noiseField = new Int16Array(1);

  /** Centre of node `c` (y: its floor height). */
  private cellPos(c: number): Pos3 { return this.L.centre(c); }

  /**
   * A horde (`size` x a full one): queue it and tell clients where it's coming from. `side` -1: from
   * behind the team. `flank`: also from a second side.
   */
  private horde(side: Side = 1, size = 1, flank = false): void {
    const at = this.spawnWave(this.mobSize((HORDE.base + HORDE.per * this.players.size) * size), { side, flank });
    this.events.push(at ? ['horde', r2(at.x), r2(at.z)] : ['horde']);
  }

  /**
   * Queue `n` walkers that arrive together from one place. `noise`: cell of a noise they come from
   * (else a hidden cell a walk from the team, ahead-biased; or from the goo-marked survivors with
   * `hunt`). Big team-sourced waves sometimes split to flank from a second side (`flank`: always try). `hunt`: seconds the
   * members chase marked survivors first. Returns the main source (metres), null if none was found
   * (members then pick cells one by one, as before).
   */
  private spawnWave(n: number, o: { noise?: number; hunt?: number; side?: Side; flank?: boolean } = {}): Vec2 | null {
    const w: Wave = { id: this.nextWave++, left: n, srcs: [], anchor: o.noise ?? -1, hunt: o.hunt ? this.time + o.hunt : 0, repicks: 0, side: o.side ?? 1 };
    const s = this.waveSource(w);
    if (s >= 0) {
      w.srcs.push(s);
      if (w.anchor < 0 && !w.hunt && (o.flank || (w.side > 0 && n >= FLANK_MIN && Math.random() < FLANK_CHANCE))) { const f = this.flankSource(s); if (f >= 0) w.srcs.push(f); }
    }
    this.waves.push(w);
    return s >= 0 ? this.cellPos(s) : null;
  }

  /** Pick (or re-pick) a wave's main source by its rule; -1 if none. */
  private waveSource(w: Wave): number {
    if (w.anchor >= 0) { const c = this.noiseSource(w.anchor); if (c >= 0) return c; }
    if (w.hunt > this.time && this.marks.size) {
      const c = this.trySpawnCell(7, 18, 0, this.markFlow) ?? this.trySpawnCell(7, 26, 0, this.markFlow);
      if (c !== null) return c;
    }
    return this.pickSpawnCell(8, 20, this.holdout >= 0 ? 0 : waveAhead(w));
  }

  /**
   * The hidden spawn cell nearest (by walking) to a noise at cell `at`, within NOISE_REACH of it
   * and a walk from the team; -1 if none. Event-time only: one BFS plus a bounded number of sight tests.
   */
  private noiseSource(at: number): number {
    if (this.noiseField.length !== this.L.N) this.noiseField = new Int16Array(this.L.N);
    const nf = this.L.distanceField([at], this.doors, this.noiseField);
    const cand: number[] = [];
    for (const c of this.nearCells()) if (nf[c] <= NOISE_REACH && this.flow[c] >= 6) cand.push(c);
    cand.sort((a, b) => nf[a] - nf[b]);
    // Cells right by the noise are usually in view (survivors are looking at it): test the
    // nearest ones, then stride further out.
    const players = this.standing();
    for (let i = 0, k = 0; i < cand.length && k < 40; i += k < 20 ? 1 : 3, k++) {
      const p = this.cellPos(cand[i]);
      if (this.hidden(p.x, p.y, p.z, players, MIN_SPAWN_DIST)) return cand[i];
    }
    return -1;
  }

  /** A second source on another side of the team from `main` (a flanking split), or -1. */
  private flankSource(main: number): number {
    const stand = this.standing();
    let cx = 0, cz = 0;
    for (const p of stand) { cx += p.x / stand.length; cz += p.z / stand.length; }
    const m = this.cellPos(main), ax = m.x - cx, az = m.z - cz, al = Math.hypot(ax, az) || 1;
    for (let i = 0; i < 4; i++) {
      const f = this.trySpawnCell(8, 22, 0);
      if (f === null) return -1;
      const q = this.cellPos(f), bx = q.x - cx, bz = q.z - cz;
      // At least ~80 degrees round from the main source (as seen from the team) and well apart.
      if ((ax * bx + az * bz) / (al * (Math.hypot(bx, bz) || 1)) < 0.2 && Math.hypot(q.x - m.x, q.z - m.z) > 14) return f;
    }
    return -1;
  }

  /**
   * A hidden spawnable node within CLUSTER tiles of source `src` (on its storey) and about as far from
   * the team by path (so not across a wall from it); -1 if the source is lost (seen, crowded, or left far behind).
   */
  private clusterCell(src: number, players: Player[]): number {
    const L = this.L, f = this.flow, fs = f[src];
    if (fs > 30) return -1;
    const sx = L.nodeX(src), sz = L.nodeZ(src), lv = L.lvOf(src), span = 2 * CLUSTER + 1;
    for (let i = 0; i < 10; i++) {
      const x = sx + ((Math.random() * span) | 0) - CLUSTER, z = sz + ((Math.random() * span) | 0) - CLUSTER;
      if (!L.inBounds(x, z)) continue;
      const c = L.node(x, z, lv);
      if (!this.cd.spawnable[c] || f[c] < 5 || Math.abs(f[c] - fs) > CLUSTER + 1) continue;
      const p = this.cellPos(c);
      if (this.hidden(p.x, p.y, p.z, players, MIN_SPAWN_DIST)) return c;
    }
    return -1;
  }

  /** Spawn one member of wave `w` near one of its sources, moving a lost source (twice per wave at most) before falling back to a lone pick. */
  private spawnWaveMember(w: Wave): boolean {
    const players = this.standing();
    let c = -1;
    if (w.srcs.length) {
      const i = w.srcs.length > 1 && Math.random() < 0.35 ? 1 : 0;
      c = this.clusterCell(w.srcs[i], players);
      if (c < 0 && w.repicks < 2) {
        w.repicks++;
        const s = i ? this.flankSource(w.srcs[0]) : this.waveSource(w);
        if (s >= 0) { w.srcs[i] = s; c = this.clusterCell(s, players); }
      }
    }
    let zb: Zombie | null = null;
    if (c >= 0) {
      const p = this.cellPos(c);
      zb = this.spawnZombie(this.commonType(), p.x + rand(-0.5, 0.5), p.y, p.z + rand(-0.5, 0.5));
    } else zb = this.spawnAt(this.commonType(), 7, 18, waveAhead(w));
    if (zb) { zb.hunt = w.hunt; zb.wave = w.id; }
    return !!zb;
  }

  /** Drop worn-off marks and rebuild the field toward the marked survivors (shared by all hunters). */
  private recomputeMarks(): void {
    if (!this.marks.size) return;
    const src: number[] = [];
    for (const [id, until] of this.marks) {
      const p = this.players.get(id);
      if (!p || p.st !== PSTATE.ALIVE || until <= this.time) { this.marks.delete(id); continue; }
      if (!this.L.blocked(p.node, this.doors)) src.push(p.node);
    }
    if (!this.marks.size) return;
    if (this.markFlow.length !== this.flow.length) this.markFlow = new Int16Array(this.flow.length);
    this.L.distanceField(src, this.doors, this.markFlow);
  }

  // ---------------------------------------------------------------- pacing
  private bumpIntensity(p: Player, v: number): void {
    if (p.st !== PSTATE.DEAD) p.intensity = Math.min(100, p.intensity + v);
  }

  /** Fresh attempt or debug jump: calm team, BUILD_UP, timers from now. */
  private resetPacing(): void {
    for (const p of this.players.values()) p.intensity = 0;
    this.phase = Phase.BUILD_UP; this.phaseT = 0; this.phaseLen = roll(DIRECTOR.buildMax) * this.diff.build; this.phaseBest = this.best;
    this.advancedAt = this.time; this.campT = 0; this.objSeenKey = '';
    this.spReady.fill(0); this.ambushUntil = Infinity; this.loner = 0; this.isoT.clear();
  }

  private setPhase(ph: Phase, why: string): void {
    if (DIRECTOR_DEBUG) {
      const team = Math.round(this.teamIntensity());
      console.log(`[director ${this.code}] t=${this.time.toFixed(1)} ${PHASE_NAMES[this.phase]} -> ${PHASE_NAMES[ph]} (${why}) intensity=${team} best=${this.best}`);
    }
    this.phase = ph; this.phaseT = 0; this.phaseBest = this.best;
    this.phaseLen = ph === Phase.SUSTAIN ? roll(DIRECTOR.sustain) : ph === Phase.RELAX ? roll(DIRECTOR.relaxMax) * this.diff.relax
      : ph === Phase.BUILD_UP ? roll(DIRECTOR.buildMax) * this.diff.build : 0;
  }

  /** A holdout (crescendo) just ended: L4D's post-crescendo breather, and no horde right after it. */
  private crescendoOver(): void {
    this.setPhase(Phase.RELAX, 'holdout over');
    this.t.horde = Math.max(this.t.horde, roll(DIRECTOR.mobAfterHoldout) * this.diff.mobEvery);
    this.campT = 0; this.advancedAt = this.time;
    // Team-sourced leftovers of the crescendo's horde are dropped; noise/goo waves are still owed.
    this.waves = this.waves.filter((w) => w.anchor >= 0 || w.hunt > this.time);
  }

  // -------------------------------------------------------------- holdouts
  /** Start step `s`'s holdout: the timer, its script (authored or the default curve) and the first stage. */
  private startHoldout(s: Step): void {
    const n = this.players.size, H = DIRECTOR.holdout, hold = s.hold ?? 60;
    const stages = s.holdScript ?? defaultHoldScript(hold, n, !s.brute && hold >= H.longHold && Math.random() < H.bruteChance * this.diff.brute);
    let acc = 0;
    const ends = stages.map((g) => (acc += g.secs) * HOLD_SCALE);
    ends[ends.length - 1] = Infinity; // the last stage runs until the timer does, whatever the script adds up to
    this.holdout = hold * HOLD_SCALE;
    this.hs = { stages, ends, total: this.holdout, i: -1, drip: 0, bruteWant: false, bruteTry: 0 };
    // Lurking specials from before join the fight now; from here on only the holdout's pushes hold.
    this.releaseAmbush('holdout');
    if (DIRECTOR_DEBUG) console.log(`[director ${this.code}] t=${this.time.toFixed(1)} holdout ${hold}s x${HOLD_SCALE}: ${stages.map((g) => `${g.kind} ${g.secs}`).join(' | ')}`);
    this.enterStage(0, s.horde);
  }

  /** Begin holdout stage `i`. `opening`: the first stage, whose horde is the step's `horde` flag. */
  private enterStage(i: number, opening = true): void {
    const H = DIRECTOR.holdout, hs = this.hs, g = hs.stages[i], k = Math.min(Math.max(this.players.size, 1), 4) - 1;
    hs.i = i; hs.drip = H.drip; hs.bruteWant = false;
    this.t.ambient = 0.5;
    let push = g.specials ?? H.push[g.kind][k];
    if (g.kind === 'brute') {
      let up = this.pendingBrute;
      for (const z of this.zombies.values()) if (z.type === ZT.BRUTE && !z.dormant) up = true;
      // One Brute at a time: with one already up this stage is a specials push instead.
      if (up) push = g.specials ?? H.push.specials[k];
      else { hs.bruteWant = true; hs.bruteTry = 0; }
    }
    const size = g.horde ?? H.horde[g.kind];
    const msg = g.msg ?? (g.kind === 'final' ? H.finalMsg : '');
    if (msg) this.events.push(['msg', msg]);
    if (size > 0 && (i > 0 || opening)) this.horde(1, size, g.flank ?? g.kind === 'final');
    const pushed = push > 0 ? this.pushSpecials(push, true) : 0;
    if (DIRECTOR_DEBUG) console.log(`[director ${this.code}] t=${this.time.toFixed(1)} holdout stage ${i + 1}/${hs.stages.length} ${g.kind}: horde ${i > 0 || opening ? size : 0}, specials ${pushed}/${push}${hs.bruteWant ? ', Brute' : ''}`);
  }

  /** Up to `k` holdout specials (within DIRECTOR.holdout.maxSpecials alive); `hold`: lurk and strike together after pushWait. Returns how many spawned. */
  private pushSpecials(k: number, hold: boolean): number {
    const H = DIRECTOR.holdout, n = this.players.size;
    const byType = ZTYPES.map(() => 0);
    let alive = 0;
    for (const z of this.zombies.values()) {
      if (z.dormant) continue;
      byType[z.type]++;
      if (SLOTTED(z.type)) alive++;
    }
    k = Math.min(k, Math.min(this.slotCap(), Math.max(1, H.maxSpecials[Math.min(Math.max(n, 1), 4) - 1] + this.slotBonus(n))) - alive);
    let got = 0;
    for (let j = 0; j < k; j++) {
      const type = this.pickSpecial(byType, true);
      const zb = type >= 0 ? this.spawnSpecial(type, 9, 20, hold) : null;
      if (!zb) break;
      byType[type]++; got++;
      if (zb.hold) this.ambushUntil = Math.min(this.ambushUntil, this.time + H.pushWait);
    }
    return got;
  }

  /** Holdout tick: advance the script by elapsed time, then the current stage's trickle, Brute and refills. */
  private updateHoldout(dt: number, room: boolean, specials: number, brute: boolean): void {
    const H = DIRECTOR.holdout, hs = this.hs, n = this.players.size;
    if (!hs.stages.length) return;
    const el = hs.total - this.holdout;
    let i = hs.i;
    while (i + 1 < hs.stages.length && el >= hs.ends[i]) i++;
    // Skipped stages (the whole team down for a while) are not replayed: only the latest begins.
    if (i !== hs.i) this.enterStage(i, false);
    const g = hs.stages[hs.i];
    if (hs.bruteWant) {
      if (brute) hs.bruteWant = false;
      else if ((hs.bruteTry -= dt) <= 0) { hs.bruteTry = 1; if (this.spawnBrute()) hs.bruteWant = false; }
    }
    const every = H.trickle[g.kind];
    if (every > 0) {
      this.t.ambient -= dt;
      if (this.t.ambient <= 0) {
        this.t.ambient = Math.max(H.triMin, every - H.triPer * (n - 1)) / this.diff.ambient;
        if (room) this.spawnAt(this.commonType(), 6, 18);
      }
    }
    if (g.kind === 'final' && (hs.drip -= dt) <= 0) {
      hs.drip = H.drip;
      const want = g.specials ?? H.push.final[Math.min(Math.max(n, 1), 4) - 1];
      if (specials < want) this.pushSpecials(1, false);
    }
  }

  /** Roll where on the route this attempt's roaming Brute comes (DIRECTOR.boss); -1 = none. */
  private rollBoss(): void {
    const B = DIRECTOR.boss, r = this.cd.route;
    this.bossAt = -1;
    const scripted = this.def.steps.some((s) => s.brute);
    // Not before the campaign brings Brutes in (INTRO.brute: partway through chapter 1).
    const lo = Math.max(r.total * B.band[0], this.routeBest + B.minAhead, (INTRO.brute - this.ch - this.diff.intro) * r.total), hi = r.total * B.band[1];
    let rejected = 0, why = 'no roll';
    if (Math.random() < Math.min(1, (scripted ? B.scriptedChance : B.chance) * this.diff.brute)) {
      why = lo < hi ? 'all rejected' : 'band behind';
      for (let i = 0; lo < hi && i < B.tries; i++) {
        const v = Math.round(rand(lo, hi));
        if (this.bossClear(v)) { this.bossAt = v; break; }
        rejected++;
      }
    }
    if (DIRECTOR_DEBUG) {
      console.log(`[director ${this.code}] boss: ${this.bossAt >= 0 ? `at route ${this.bossAt}` : why} of ${r.total} (from ${this.routeBest}, ${rejected} rejected${scripted ? ', chapter has a scripted Brute' : ''})`);
    }
  }

  /** Roll where on the route this attempt's Weeper sits (DIRECTOR.weeper); -1 = none. */
  private rollWeeper(): void {
    const Wp = DIRECTOR.weeper, r = this.cd.route;
    this.weeperAt = -1;
    if (Math.random() >= Math.min(1, Wp.chance * this.diff.brute)) return;
    const lo = Math.max(r.total * Wp.band[0], this.routeBest + Wp.minAhead, (INTRO.at[ZT.WEEPER] - this.ch - this.diff.intro) * r.total), hi = r.total * Wp.band[1];
    for (let i = 0; lo < hi && i < Wp.tries; i++) {
      const v = Math.round(rand(lo, hi));
      const clear = this.def.steps.every((s, k) => !((s.checkpoint || s.hold || s.kind === 'holdout') && Math.abs(v - (r.start[k] + r.len[k])) < Wp.clearance));
      if (clear) { this.weeperAt = v; break; }
    }
    if (DIRECTOR_DEBUG) console.log(`[director ${this.code}] weeper: ${this.weeperAt >= 0 ? `at route ${this.weeperAt}` : 'none'} of ${r.total}`);
  }

  /** The Weeper, sitting a walk ahead of the team and out of sight. */
  private spawnWeeper(): boolean {
    const [a, b] = DIRECTOR.weeper.spawn, c = this.pickSpawnCell(a, b, 1);
    if (c < 0) return false;
    const p = this.cellPos(c), zb = this.spawnZombie(ZT.WEEPER, p.x, p.y, p.z);
    zb.sit = true; zb.st = ZSTATE.IDLE;
    if (DIRECTOR_DEBUG) console.log(`[director ${this.code}] t=${this.time.toFixed(1)} weeper placed at route ${this.routeBest}`);
    return true;
  }

  /** False if route point `v` is too near a safe room, a holdout, or a scripted Brute (DIRECTOR.boss). */
  private bossClear(v: number): boolean {
    const B = DIRECTOR.boss, r = this.cd.route;
    return this.def.steps.every((s, i) => {
      const end = r.start[i] + r.len[i];
      if ((s.checkpoint || s.hold || s.kind === 'holdout') && Math.abs(v - end) < B.clearance) return false;
      return !(s.brute && v > r.start[i] - B.clearance && v < r.start[i] + B.scriptGap);
    });
  }

  /** A Brute ahead of the team (any side in a holdout), out of sight; announced. Cell centre: it's wide. */
  private spawnBrute(): Zombie | null {
    const [a, b] = DIRECTOR.boss.spawn;
    const c = this.pickSpawnCell(a, b, this.holdout >= 0 ? 0 : 1);
    if (c < 0) return null;
    const p = this.cellPos(c), zb = this.spawnZombie(ZT.BRUTE, p.x, p.y, p.z);
    this.events.push(['brute']);
    return zb;
  }

  private teamIntensity(): number {
    let m = 0;
    for (const p of this.players.values()) if (p.st === PSTATE.ALIVE) m = Math.max(m, p.intensity);
    return m;
  }

  /** Decay each survivor's intensity, but only while nothing active is on them (the L4D rule). */
  private decayIntensity(dt: number): void {
    const R = DIRECTOR.engageR;
    for (const p of this.players.values()) {
      if (p.intensity <= 0 || p.st === PSTATE.DEAD) continue;
      let engaged = !!p.pinned;
      if (!engaged) for (const z of this.zombies.values()) {
        if (z.dormant) continue;
        const dx = z.x - p.x, dz = z.z - p.z, dy = z.y - p.gy;
        if (dx * dx + dz * dz + dy * dy < R * R) { engaged = true; break; }
      }
      if (!engaged) p.intensity = Math.max(0, p.intensity - DIRECTOR.decay * dt);
    }
  }

  /** Advance BUILD_UP -> SUSTAIN -> FADE -> RELAX -> BUILD_UP. Frozen during holdouts (they force RELAX when they end). */
  private updatePhase(dt: number, nearCommons: number): void {
    this.phaseT += dt;
    const D = DIRECTOR;
    switch (this.phase) {
      case Phase.BUILD_UP:
        if (this.teamIntensity() >= this.peak) this.setPhase(Phase.SUSTAIN, 'peak');
        else if (this.phaseT >= this.phaseLen) this.setPhase(Phase.SUSTAIN, 'build cap');
        break;
      case Phase.SUSTAIN:
        if (this.phaseT >= this.phaseLen) this.setPhase(Phase.FADE, 'sustained');
        break;
      case Phase.FADE:
        if (this.phaseT >= D.fadeMax) this.setPhase(Phase.RELAX, 'fade timeout');
        else if (!this.waves.length && nearCommons <= D.fadeQuiet) this.setPhase(Phase.RELAX, 'cleared');
        break;
      case Phase.RELAX:
        if (this.phaseT >= D.relaxMin * this.diff.relax && (this.phaseT >= this.phaseLen || this.best - this.phaseBest >= D.relaxAdvance)) {
          this.setPhase(Phase.BUILD_UP, this.phaseT >= this.phaseLen ? 'relaxed' : 'advanced');
        }
        break;
    }
  }

  private director(dt: number): void {
    const n = this.players.size;
    const stand = this.standing();
    if (!stand.length) return;
    const allSafe = stand.every((p) => this.L.floorAt(p.x, p.y, p.z) === F.SAFE);
    if (!this.started) {
      if (allSafe) return;
      this.started = true;
    }
    // Furthest progress and closing on the objective (collect steps
    // may lead back the way they came) count as advancing for the mob timer and anti-camping.
    let advanced = false;
    for (const p of stand) {
      const pr = this.progressAt(p.x, p.y, p.z);
      if (pr > this.best) { this.best = pr; advanced = true; }
    }
    const obj = this.objectiveField();
    if (obj) {
      let lead = INF;
      for (const p of stand) lead = Math.min(lead, obj[p.node]);
      if (this.objKey !== this.objSeenKey) { this.objSeenKey = this.objKey; this.objBest = lead; advanced = true; }
      else if (lead < this.objBest) { this.objBest = lead; advanced = true; }
      // Route progress: how far along this step's leg the lead survivor is.
      const r = this.cd.route, len = r.len[this.step];
      if (lead < INF) this.routeBest = Math.max(this.routeBest, r.start[this.step] + Math.max(0, len - lead));
    }
    if (advanced) { this.advancedAt = this.time; this.campT = 0; }
    const t = this.t, D = DIRECTOR;
    t.wander -= dt;
    if (t.wander <= 0) { t.wander = WANDERERS.every; this.placeWanderers(); }

    let commons = 0, specials = 0, holders = 0, nearCommons = 0;
    const byType = ZTYPES.map(() => 0);
    const S = D.specials;
    for (const z of this.zombies.values()) {
      if (z.dormant) continue;
      byType[z.type]++;
      if (z.hold) holders++;
      if (z.type === ZT.BRUTE || z.type === ZT.WEEPER) continue;
      if (!isCommon(z.type)) { specials++; continue; }
      commons++;
      if (this.flow[this.nodeOf(z)] <= D.fadeNear) nearCommons++;
    }
    const cap = Math.min(46, 20 + 6 * n);

    this.decayIntensity(dt);
    if (this.holdout < 0) this.updatePhase(dt, nearCommons);

    // Holding specials attack together: slots full, waited long enough (in any phase), or a crescendo began.
    const slots = this.specialSlots(n);
    if (!holders) this.ambushUntil = Infinity;
    // In a holdout only its special pushes hold (startHoldout released the rest), on their own clock.
    else if ((specials >= slots && this.holdout < 0) || this.time >= this.ambushUntil) {
      this.releaseAmbush(this.holdout >= 0 ? 'holdout push' : specials >= slots ? 'slots full' : 'timeout');
      holders = 0;
    }

    // ---- Deliberate events: bypass the pacing phases. One Brute at a time: a scripted one waits for a
    // roaming one to die; the roaming one also waits out holdouts and safe rooms.
    let brute = byType[ZT.BRUTE] > 0;
    if (this.pendingBrute && !brute && this.spawnBrute()) { this.pendingBrute = false; brute = true; }
    if (this.bossAt >= 0 && this.routeBest >= this.bossAt && !brute && this.holdout < 0 && !allSafe && this.spawnBrute()) {
      if (DIRECTOR_DEBUG) console.log(`[director ${this.code}] t=${this.time.toFixed(1)} roaming Brute at route ${this.routeBest} (rolled ${this.bossAt})`);
      this.bossAt = -1; brute = true;
    }
    if (this.weeperAt >= 0 && this.routeBest >= this.weeperAt && this.holdout < 0 && !allSafe && this.spawnWeeper()) this.weeperAt = -1;

    // Drain queued hordes a walker at a time (oldest wave first), each from its wave's source.
    // Waves already queued are committed, so they keep draining in FADE/RELAX too.
    const wave = this.waves[0];
    if (wave) {
      t.hordeTick -= dt;
      if (t.hordeTick <= 0) {
        t.hordeTick = 0.22;
        if (commons < cap && this.spawnWaveMember(wave)) wave.left--;
        if (wave.left <= 0) this.waves.shift();
      }
    }

    if (this.holdout >= 0) { this.updateHoldout(dt, commons < cap - 4, specials, brute); return; }
    // Safe rooms are a breather: no new pressure while the whole team is inside one.
    if (allSafe) return;

    // ---- Paced pressure: ambient and specials in BUILD_UP/SUSTAIN, timed mobs in BUILD_UP only.
    const ph = this.phase;
    if (ph !== Phase.BUILD_UP && ph !== Phase.SUSTAIN) return;

    // Wanderers (placeWanderers above) are placed in every phase: each region is stocked once per
    // attempt, so a RELAX spent shooting only wakes what is already there and then goes quiet.
    t.ambient -= dt;
    if (t.ambient <= 0) {
      const A = D.ambient, f = this.ambientScale();
      t.ambient = Math.max(A.minEvery, (roll(A.every) - A.perPlayer * n) / (f * this.diff.ambient));
      const room = Math.round((A.target[0] + A.target[1] * n) * f * this.diff.ambient) - commons;
      if (room > 0) this.spawnAmbient(room);
    }
    // Fill a free slot with a holding special (one at a time); re-check soon if every type is cooling down.
    t.special -= dt;
    if (t.special <= 0) {
      const type = specials < slots ? this.pickSpecial(byType, false) : -1;
      // Alarm clocks lurk a bit further out so they have room to keep their distance.
      const zb = type < 0 ? null : type === ZT.ALARM ? this.spawnSpecial(type, 12, 24, false) : this.spawnSpecial(type, 9, 20, true);
      if (zb && type === ZT.ALARM) this.alarmAt = this.time + 75;
      if (zb?.hold && !holders) this.ambushUntil = this.time + S.maxWait;
      t.special = zb ? roll(S.fill) * this.diff.spCd : 1.5;
    }
    // A Brute fight is the peak: no timed mobs or camping hordes on top of it.
    if (ph !== Phase.BUILD_UP || brute) return;

    // Mob timer: runs faster while the team pushes on, slower while it holds still.
    const moving = this.time - this.advancedAt < D.advanceWindow;
    t.horde -= dt * (moving ? D.mobMove : D.mobStill);
    if (t.horde <= 0) {
      t.horde = roll(D.mobEvery) * this.diff.mobEvery;
      this.horde();
    }
    // Anti-camping: too long without progress brings a horde from behind, pushing them on.
    if (!moving) this.campT += dt;
    if (this.campT >= D.camp * this.diff.mobEvery) {
      this.campT = 0;
      t.horde = Math.max(t.horde, roll(D.mobEvery) * this.diff.mobEvery);
      if (DIRECTOR_DEBUG) console.log(`[director ${this.code}] t=${this.time.toFixed(1)} camping: horde from behind`);
      this.horde(-1);
    }
  }

  /** Ambient trickle factor (rate and target) for the current phase and team intensity (DIRECTOR.ambient). */
  private ambientScale(): number {
    const A = DIRECTOR.ambient;
    if (this.phase === Phase.SUSTAIN) return A.sustain;
    if (this.phase !== Phase.BUILD_UP) return 0;
    const ramp = A.rampFrom + (1 - A.rampFrom) * Math.min(1, this.phaseT / A.rampTime);
    return ramp * (1 - A.ease * Math.min(1, this.teamIntensity() / this.peak));
  }

  /** One ambient walker, or (clumpChance) a small clump from one hidden spot; at most `room` of them. */
  private spawnAmbient(room: number): void {
    const A = DIRECTOR.ambient;
    const k = room > 1 && Math.random() < A.clumpChance ? Math.min(room, Math.round(roll(A.clump))) : 1;
    if (k === 1) { this.spawnAt(this.commonType(), 10, 22); return; }
    const src = this.pickSpawnCell(10, 22, 0.85);
    if (src < 0) return;
    const players = this.standing();
    for (let i = 0; i < k; i++) {
      const c = i ? this.clusterCell(src, players) : src;
      if (c < 0) continue;
      const p = this.cellPos(c);
      this.spawnZombie(this.commonType(), p.x + rand(-0.5, 0.5), p.y, p.z + rand(-0.5, 0.5));
    }
  }

  /**
   * Weighted pick of the next special, respecting per-type caps for the team size and (outside
   * holdouts) respawn cooldowns (-1 = none). While someone is down (the team is struggling) no
   * Chargers or Alarm Clocks join in.
   */
  private pickSpecial(byType: number[], holdout: boolean): number {
    const n = this.players.size;
    const struggling = [...this.players.values()].some((p) => p.st !== PSTATE.ALIVE);
    const big = n >= 3 ? 1 : 0;
    // [type, weight, cap]
    const table: [number, number, number][] = [
      [ZT.LEAPER, 3, 1 + big],
      [ZT.PUFFER, holdout ? 1.5 : 2.5, 1],
      [ZT.CHARGER, struggling ? 0 : 2, 1 + (n >= 4 ? 1 : 0)],
      [ZT.DROOLER, holdout ? 2.5 : 2, 1 + big],
      [ZT.ALARM, holdout || struggling || this.time < ALARM.minChapterTime || this.time < this.alarmAt ? 0 : 1.3, 1],
      // Grabbers need a teammate to break them: none while someone is already down, and never two holds on a solo player.
      [ZT.SNATCHER, struggling ? 0 : 2, 1],
      [ZT.PIGGYBACK, struggling ? 0 : 2, 1],
    ];
    let sum = 0;
    const pos = this.pos;
    // Outside holdouts a type is off until its respawn cooldown (from its last death) runs out; none before the campaign introduces it.
    for (const e of table) { if (!introduced(e[0], pos) || byType[e[0]] >= e[2] || (!holdout && this.time < this.spReady[e[0]])) e[1] = 0; sum += e[1]; }
    if (sum <= 0) return -1;
    let r = Math.random() * sum;
    for (const [type, w] of table) { r -= w; if (r < 0 && w > 0) return type; }
    return -1;
  }

  private recomputeFlow(): void {
    const src: number[] = [];
    let targets = this.standing();
    if (!targets.length) targets = [...this.players.values()].filter((p) => p.st === PSTATE.DOWN);
    for (const p of targets) if (!this.L.blocked(p.node, this.doors)) src.push(p.node);
    this.L.distanceField(src, this.doors, this.flow);
  }

  /** Zombies the soft separation never pushes: the Brute, and Chargers mid-rush or pinning. */
  private anchored(z: Zombie): boolean {
    return z.type === ZT.BRUTE || z.sit || z.st === ZSTATE.PIN || (z.type === ZT.CHARGER && z.st === ZSTATE.CHARGE);
  }

  private updateZombies(dt: number): void {
    const players = [...this.players.values()].filter((p) => p.st !== PSTATE.DEAD);
    const zs = [...this.zombies.values()];
    const go = this.doors, L = this.L;
    const loner = this.lonerP();
    this.checkPins();
    const ladders = this.onLadder;
    ladders.clear();
    if (L.levels > 1) for (const z of zs) { if (z.hp > 0 && !z.dormant) { const n = this.nodeOf(z); if (L.isLadder(n)) ladders.set(n, (ladders.get(n) ?? 0) + 1); } }

    for (const z of zs) {
      if (z.hp <= 0) continue;
      const T = ZTYPES[z.type], zn = this.nodeOf(z);
      // Nearest standing player; fall back to a downed one. Distances run floor to floor: someone on
      // the roof above is a storey away, not on top of it.
      let tgt: Player | null = null, d = Infinity, tgtDown: Player | null = null, dDown = Infinity;
      for (const p of players) {
        const pd = Math.hypot(p.x - z.x, p.z - z.z, p.gy - z.y);
        if (p.st === PSTATE.ALIVE) { if (pd < d) { d = pd; tgt = p; } } else if (pd < dDown) { dDown = pd; tgtDown = p; }
      }
      if (tgtDown && (!tgt || (dDown < T.range && d > T.range + 1))) { tgt = tgtDown; d = dDown; }
      // Goo wave members go for the nearest marked survivor while the mark lasts (they path on markFlow).
      let field = this.flow;
      if (z.hunt > this.time && this.marks.size && this.markFlow[zn] < INF) {
        let mt: Player | null = null, md = Infinity;
        for (const p of players) {
          if (p.st !== PSTATE.ALIVE || !this.marks.has(p.id)) continue;
          const pd = Math.hypot(p.x - z.x, p.z - z.z, p.gy - z.y);
          if (pd < md) { md = pd; mt = p; }
        }
        if (mt) { tgt = mt; d = md; field = this.markFlow; }
      }
      // Specials single out a lone wolf within reach, unless someone else is right on top of them.
      if (loner && AMBUSHER(z.type) && tgt !== loner && d > 4 && this.lonerField[zn] <= DIRECTOR.specials.lonerReach) {
        tgt = loner; d = Math.hypot(loner.x - z.x, loner.z - z.z, loner.gy - z.y); field = this.lonerField;
      } else if (tgt === loner && loner && AMBUSHER(z.type)) field = this.lonerField;

      if (z.type === ZT.WEEPER) {
        if (z.stun > 0) z.stun = 0; // nothing staggers her
        if (this.weeperTick(z, dt)) continue;
        // Awake: only her victim matters.
        const v = this.players.get(z.target);
        if (v) { tgt = v; d = Math.hypot(v.x - z.x, v.z - z.z, v.gy - z.y); if (this.weeperField.length === this.flow.length) field = this.weeperField; }
      }
      if (z.dormant) {
        if (tgt && (d < 5 || (d < 15 && this.sight(z.x, z.y, z.z, tgt.x, tgt.gy, tgt.z)))) { z.dormant = false; this.alertNear(z.x, z.y, z.z, 7); }
        else { z.st = ZSTATE.IDLE; continue; }
      }
      if (z.stun > 0) {
        z.stun -= dt;
        L.moveSlide(z, z.vx * dt, z.vz * dt, T.radius, go);
        z.vx *= 0.86; z.vz *= 0.86;
        z.st = ZSTATE.STAGGER;
        if (z.type === ZT.ALARM) z.sp = Math.max(z.sp, 6); // a shove cuts a ring short
        continue;
      }
      if (z.st === ZSTATE.STAGGER) z.st = ZSTATE.RUN;
      // A rattling Rattle Bomb is all a common can think about.
      if (this.lures.length && isCommon(z.type)) {
        const lure = this.lureFor(zn);
        if (lure) {
          const ld = Math.hypot(lure.x - z.x, lure.z - z.z, lure.y - z.y);
          z.hitDone = true; z.t = 0;
          if (ld < 1.4) { z.st = ZSTATE.ATTACK; z.ry = Math.atan2(-(lure.x - z.x), -(lure.z - z.z)); continue; }
          const to = ld < 5 && Math.abs(lure.y - z.y) < REACH_DY && this.sight(z.x, z.y, z.z, lure.x, lure.y, lure.z) ? lure : this.flowStep(z, -1, lure.field);
          if (to) this.walkTo(z, to, 1.15, dt); else z.st = ZSTATE.IDLE;
          continue;
        }
      }
      if (!tgt) { z.st = ZSTATE.IDLE; continue; }
      const target: Player = tgt;
      const face = () => { z.ry = Math.atan2(-(target.x - z.x), -(target.z - z.z)); };
      // `level`: on the same floor (or the same flight of stairs) as the target, so melee, leaps,
      // charges and grabs can connect; `sees`: eye-to-eye sight (checked lazily, at most once a tick).
      const hd = Math.hypot(target.x - z.x, target.z - z.z), level = Math.abs(target.gy - z.y) < REACH_DY;
      let seen = -1;
      const sees = () => (seen < 0 ? (seen = this.sight(z.x, z.y, z.z, target.x, target.gy, target.z) ? 1 : 0) : seen) === 1;
      z.leapCd -= dt;

      if (z.st === ZSTATE.ATTACK) {
        z.t -= dt; face();
        if (!z.hitDone && z.t <= T.cd - 0.3) {
          z.hitDone = true;
          const victim = this.players.get(z.target);
          if (victim && victim.st !== PSTATE.DEAD && Math.hypot(victim.x - z.x, victim.z - z.z) < T.range + 0.6 && Math.abs(victim.gy - z.y) < REACH_DY) {
            const wasUp = victim.st === PSTATE.ALIVE;
            this.damagePlayer(victim, wasUp ? T.dmg : T.dmg * 1.5, z.x, z.z);
            if (z.type === ZT.BRUTE && wasUp) {
              const k = Math.hypot(victim.x - z.x, victim.z - z.z) || 1;
              this.events.push(['kb', victim.id, r2(((victim.x - z.x) / k) * 13), r2(((victim.z - z.z) / k) * 13)]);
            }
          }
        }
        if (z.t <= 0) z.st = ZSTATE.RUN;
        continue;
      }
      if (z.st === ZSTATE.WINDUP) {
        z.t -= dt; face();
        if (z.t <= 0) {
          const k = hd || 1; z.lx = (target.x - z.x) / k; z.lz = (target.z - z.z) / k;
          if (z.type === ZT.CHARGER) { z.st = ZSTATE.CHARGE; z.t = CHARGER.maxTime; }
          else if (z.type === ZT.DROOLER) {
            z.st = ZSTATE.RUN; z.sp = DROOLER.cooldown * rand(0.85, 1.2);
            // Lob at where the survivor stands now (no lead), so stepping aside always works.
            if (sees()) {
              const flight = Math.max(0.6, Math.min(1.6, d / DROOLER.globSpeed));
              this.globs.push({ x1: target.x, y1: target.gy, z1: target.z, t: flight });
              this.events.push(['spit', z.id, r2(z.x), r2(z.z), r2(target.x), r2(target.z), r2(flight), r2(z.y), r2(target.gy)]);
            }
          } else if (z.type === ZT.SNATCHER) {
            // The lasso lands only if they are still in reach and in sight when it is thrown.
            if (target.st === PSTATE.ALIVE && !target.pinned && d < SNATCHER.maxRange * 1.15 && level && sees()) { this.grab(z, target); z.sp = SNATCHER.cooldown; }
            else { z.st = ZSTATE.RUN; z.sp = 3; }
          } else { z.st = ZSTATE.LEAP; z.t = 0.75; }
        }
        continue;
      }
      if (z.st === ZSTATE.CHARGE) {
        z.t -= dt;
        const bx = z.x, bz = z.z, step = CHARGER.speed * dt;
        L.moveSlide(z, z.lx * step, z.lz * step, T.radius, go);
        z.ry = Math.atan2(-z.lx, -z.lz);
        // Walkers in the way get bowled aside.
        for (const o of zs) {
          if (o === z || o.hp <= 0 || o.type === ZT.BRUTE || o.type === ZT.CHARGER || Math.abs(o.y - z.y) > REACH_DY) continue;
          const ox = o.x - z.x, oz = o.z - z.z, od = Math.hypot(ox, oz);
          if (od > T.radius + ZTYPES[o.type].radius + 0.3) continue;
          const side = ox * z.lz - oz * z.lx >= 0 ? 1 : -1; // which side of the charge line
          o.dormant = false; o.stun = 0.9; o.st = ZSTATE.STAGGER;
          o.vx = z.lz * side * 8 + z.lx * 4; o.vz = -z.lx * side * 8 + z.lz * 4;
        }
        let hit = false;
        for (const p of players) {
          if (p.st !== PSTATE.ALIVE || p.pinned || Math.hypot(p.x - z.x, p.z - z.z) > T.radius + PLAYER.radius + 0.35 || Math.abs(p.gy - z.y) > REACH_DY) continue;
          hit = true;
          if (!this.chargeHit(z, p)) { z.st = ZSTATE.RUN; z.stun = CHARGER.skidStun; z.vx = z.lx * 3; z.vz = z.lz * 3; }
          break;
        }
        if (hit) { z.sp = CHARGER.cooldown; continue; }
        const moved = (z.x - bx) * z.lx + (z.z - bz) * z.lz;
        if (moved < step * 0.5) {
          // Ran into a wall: dazed for a good while (the big punish window).
          z.st = ZSTATE.STAGGER; z.stun = CHARGER.wallStun; z.vx = -z.lx * 2; z.vz = -z.lz * 2; z.sp = CHARGER.cooldown;
          this.events.push(['slam', z.id, r2(z.x), r2(z.z), r2(z.y)]);
        } else if (z.t <= 0) {
          z.st = ZSTATE.RUN; z.stun = CHARGER.skidStun; z.vx = z.lx * 5; z.vz = z.lz * 5; z.sp = CHARGER.cooldown;
        }
        continue;
      }
      if (z.st === ZSTATE.PIN) {
        const victim = this.players.get(z.target);
        if (!victim || victim.pinned !== z.id || victim.st !== PSTATE.ALIVE) { z.st = ZSTATE.RUN; continue; }
        z.pinT += dt; z.acc += dt;
        if (GRABBER(z.type)) {
          let helpers = 0, mate: Player | null = null, md = Infinity;
          for (const p of players) {
            if (p === victim || p.st !== PSTATE.ALIVE || p.pinned) continue;
            helpers++;
            const pd = Math.hypot(p.x - victim.x, p.z - victim.z);
            if (pd < md) { md = pd; mate = p; }
          }
          const G = z.type === ZT.SNATCHER ? SNATCHER : PIGGY;
          let dmg: number = PIGGY.dmg;
          if (z.type === ZT.SNATCHER) {
            // Reel them in, then squeeze.
            const dx = z.x - victim.x, dz = z.z - victim.z, vd = Math.hypot(dx, dz) || 1;
            z.ry = Math.atan2(dx, dz);
            const far = vd > SNATCHER.chokeDist;
            if (far) { L.moveSlide(victim, (dx / vd) * SNATCHER.pull * dt, (dz / vd) * SNATCHER.pull * dt, PLAYER.radius, go); this.place(victim); }
            dmg = far ? SNATCHER.dragDmg : SNATCHER.chokeDmg;
          } else {
            // Steer them away from the nearest teammate (alone: wherever it fancies, changing its mind now and then).
            z.leapCd = PIGGY.leapCd;
            if (mate && md > 0.2) { z.lx = (victim.x - mate.x) / md; z.lz = (victim.z - mate.z) / md; }
            else if ((z.t -= dt) <= 0) { const a = rand(0, Math.PI * 2); z.lx = Math.cos(a); z.lz = Math.sin(a); z.t = 1.5; }
            const bx = victim.x, bz = victim.z;
            L.moveSlide(victim, z.lx * PIGGY.steer * dt, z.lz * PIGGY.steer * dt, PLAYER.radius, go);
            this.place(victim);
            // Walked them into a wall: try another way next time.
            if (Math.hypot(victim.x - bx, victim.z - bz) < PIGGY.steer * dt * 0.3) z.t = 0;
            z.x = victim.x; z.y = victim.y; z.z = victim.z; z.ry = Math.atan2(-z.lx, -z.lz);
          }
          if (z.acc >= G.tick) { z.acc -= G.tick; this.damagePlayer(victim, dmg, z.x, z.z); }
          if (victim.pinned === z.id && (z.pinT >= G.holdMax || (!helpers && z.pinT >= G.soloBreak))) {
            this.unpin(victim);
            z.st = ZSTATE.STAGGER; z.stun = 1.2; z.vx = z.vz = 0;
          }
          continue;
        }
        z.ry = Math.atan2(-(victim.x - z.x), -(victim.z - z.z));
        if (z.acc >= 0.5) { z.acc -= 0.5; this.damagePlayer(victim, CHARGER.pinDps * 0.5, z.x, z.z); }
        // Teammates break pins by shoving, killing it, or dealing CHARGER.pinBreakDmg (see damageZombie). With nobody able to help, it lets go on its own.
        let helpers = 0;
        for (const p of players) if (p !== victim && p.st === PSTATE.ALIVE && !p.pinned) helpers++;
        if (victim.pinned === z.id && (z.pinT >= CHARGER.pinMax || (!helpers && z.pinT >= CHARGER.soloPinBreak))) {
          this.unpin(victim);
          z.st = ZSTATE.STAGGER; z.stun = 1.2; z.vx = -z.lx * 2; z.vz = -z.lz * 2;
        }
        continue;
      }
      if (z.st === ZSTATE.RING) {
        z.t -= dt; face();
        if (z.t <= 0) {
          // Rang out: sleepers for streets around wake, and a mini-horde comes from round the clock.
          this.alertNear(z.x, z.y, z.z, 25);
          this.spawnWave(this.mobSize(5 + 3 * this.players.size), { noise: zn });
          this.events.push(['alarm', z.id, r2(z.x), r2(z.z), r2(z.y)]);
          z.st = ZSTATE.RUN; z.flee = ALARM.flee; z.sp = ALARM.cooldown;
        }
        continue;
      }
      if (z.st === ZSTATE.LEAP) {
        z.t -= dt;
        const bx = z.x, bz = z.z, step = 17 * dt;
        L.moveSlide(z, z.lx * step, z.lz * step, T.radius, go);
        let done = z.t <= 0 || Math.hypot(z.x - bx, z.z - bz) < step * 0.5, rode = false;
        for (const p of players) {
          if (p.st !== PSTATE.ALIVE || Math.hypot(p.x - z.x, p.z - z.z) > 1.15 || Math.abs(p.gy - z.y) > REACH_DY) continue;
          this.damagePlayer(p, T.leapDmg, z.x, z.z);
          this.bumpIntensity(p, DIRECTOR.leap);
          done = true;
          // A Piggyback that lands on someone free stays on.
          if (z.type === ZT.PIGGYBACK) { if (p.st === PSTATE.ALIVE && !p.pinned) { this.grab(z, p); rode = true; } }
          else this.events.push(['kb', p.id, r2(z.lx * 9), r2(z.lz * 9)]);
          break;
        }
        if (rode) continue;
        if (done) { z.st = ZSTATE.RUN; z.leapCd = z.type === ZT.PIGGYBACK ? PIGGY.leapCd : 4.5; }
        continue;
      }

      // Holding for a coordinated attack: stalk out of sight, no attack triggers until released.
      if (z.hold && this.lurk(z, target, field, dt)) continue;
      if (z.type === ZT.PUFFER && target.st === PSTATE.ALIVE && d < T.range) { this.damageZombie(z, 9999, null, false); continue; }
      z.sp -= dt;
      if (z.type === ZT.CHARGER && target.st === PSTATE.ALIVE && !target.pinned && z.sp <= 0 && d > CHARGER.minRange && d < CHARGER.maxRange
        && level && sees()) {
        z.st = ZSTATE.WINDUP; z.t = CHARGER.windup; face();
        continue;
      }
      if (z.type === ZT.SNATCHER && level) {
        if (target.st === PSTATE.ALIVE && !target.pinned && z.sp <= 0 && d > SNATCHER.minRange && d < SNATCHER.maxRange && sees()) {
          z.st = ZSTATE.WINDUP; z.t = SNATCHER.windup; face();
          continue;
        }
        // Keeps its distance: well back while the lasso recovers, just out of arm's reach otherwise.
        if (d > T.range && d < (z.sp > 0 ? SNATCHER.keepAway : SNATCHER.minRange + 1) && sees()) { this.backOff(z, 0.95, dt, field); continue; }
      }
      if (z.type === ZT.PIGGYBACK && target.st === PSTATE.ALIVE && !target.pinned && z.leapCd <= 0 && d > PIGGY.leapMin && d < PIGGY.leapMax && level && sees()) {
        z.st = ZSTATE.WINDUP; z.t = PIGGY.windup; face();
        continue;
      }
      // Never spit at someone who can't step out of it (downed or pinned).
      // A lob carries up to a roof or down from one: no `level` needed.
      if (z.type === ZT.DROOLER && z.sp <= 0 && target.st === PSTATE.ALIVE && !target.pinned && d > DROOLER.minRange && d < DROOLER.maxRange && sees()) {
        z.st = ZSTATE.WINDUP; z.t = DROOLER.windup; face();
        continue;
      }
      if (z.type === ZT.ALARM) {
        const near = d < ALARM.ringRange && sees();
        if (z.flee <= 0 && z.sp <= 0 && target.st === PSTATE.ALIVE && near) {
          z.st = ZSTATE.RING; z.t = ALARM.ringTime; face();
          this.events.push(['ring', z.id]);
          continue;
        }
        z.flee -= dt;
        // Keep its distance: back off when close or after ringing, creep closer when it can't see anyone.
        const away = z.flee > 0 || (d < ALARM.keepAway && near);
        if (!away && near && d < ALARM.keepAway + 7) { z.st = ZSTATE.IDLE; face(); continue; }
        if (away) { this.backOff(z, 1.15, dt); continue; }
      }
      if (z.type === ZT.DROOLER && d < DROOLER.keepAway && d > T.range && sees()) {
        this.backOff(z, 0.9, dt, field); continue;
      }
      if (z.type === ZT.DROOLER && d < DROOLER.maxRange - 6 && d >= DROOLER.keepAway && sees()) {
        z.st = ZSTATE.IDLE; face(); continue; // in its comfort band: wait for the next spit
      }
      if (z.type === ZT.LEAPER && target.st === PSTATE.ALIVE && z.leapCd <= 0 && d > 4.5 && d < 12 && level && sees()) {
        z.st = ZSTATE.WINDUP; z.t = 0.6; face();
        continue;
      }
      if (T.dmg > 0 && d < T.range && level) {
        z.st = ZSTATE.ATTACK; z.t = T.cd; z.hitDone = false; z.target = target.id; face();
        continue;
      }

      // Movement: beeline when close and visible on the same floor, otherwise follow the flow field
      // (along the walk graph: round corners, up stairs and ladders).
      let dx = 0, dz = 0;
      if (d < 6 && level && sees()) { dx = target.x - z.x; dz = target.z - z.z; }
      else {
        if (field[zn] >= INF) { z.st = ZSTATE.IDLE; continue; }
        // No better neighbour (it is in the target's node): settle on its own spot in this one.
        let to = this.flowStep(z, -1, field);
        // A ladder takes `diff.ladder` climbers at a time: the rest wait at its foot (or its top).
        const rung = this.stepNode;
        if (to && rung !== zn && L.isLadder(rung)) {
          const on = ladders.get(rung) ?? 0;
          if (on >= this.diff.ladder) { z.st = ZSTATE.IDLE; face(); continue; }
          ladders.set(rung, on + 1);
        }
        if (!to) { to = L.centre(zn); to.x += z.offX; to.z += z.offZ; }
        dx = to.x - z.x; dz = to.z - z.z;
      }
      const len = Math.hypot(dx, dz);
      if (len > 0.01) {
        const sp = z.speed * (this.holdout >= 0 || d > 16 ? 1.12 : 1) * (z.type === ZT.BRUTE && d > BRUTE_CATCHUP.far ? BRUTE_CATCHUP.mult : 1)
          * L.speedAt(z.x, z.y, z.z, LADDER_SPEED * ZOMBIE_LADDER) * dt;
        L.moveSlide(z, (dx / len) * sp, (dz / len) * sp, T.radius, go);
        z.ry = Math.atan2(-dx, -dz);
      }
      z.st = ZSTATE.RUN;
    }

    // Soft separation so the horde doesn't collapse into one blob.
    for (let i = 0; i < zs.length; i++) {
      const a = zs[i];
      if (a.dormant || a.hp <= 0) continue;
      const ra = ZTYPES[a.type].radius;
      for (let j = i + 1; j < zs.length; j++) {
        const b = zs[j];
        if (b.hp <= 0) continue;
        const rb = ZTYPES[b.type].radius, min = ra + rb;
        const dx = b.x - a.x, dz = b.z - a.z;
        if (Math.abs(dx) > min || Math.abs(dz) > min || Math.abs(b.y - a.y) > REACH_DY) continue;
        const d = Math.hypot(dx, dz);
        if (d >= min) continue;
        const push = (min - d) * 0.5, nx = d > 0.001 ? dx / d : 1, nz = d > 0.001 ? dz / d : 0;
        if (!this.anchored(a)) L.moveSlide(a, -nx * push, -nz * push, ra, go);
        if (!this.anchored(b) && !b.dormant) L.moveSlide(b, nx * push, nz * push, rb, go);
      }
    }

    // Cull stragglers that are hopelessly far behind so the director can reuse them.
    if (this.tickN % DIRECTOR.cull.every === 0) this.cullStragglers(zs);
  }

  /** True if one of `stand` (standing or downed survivors) has line of sight to (x, z) at floor height y within fog range. */
  private inSight(x: number, y: number, z: number, stand: Player[]): boolean {
    const r = Math.min(DIRECTOR.cull.seeR, this.def.theme.fogFar);
    for (const p of stand) {
      const dx = p.x - x, dz = p.z - z, dy = p.gy - y;
      if (dx * dx + dz * dz + dy * dy < r * r && this.sight(p.x, p.gy, p.z, x, y, z)) return true;
    }
    return false;
  }

  /**
   * Remove active zombies left far behind (DIRECTOR.cull) that no survivor can see. Distance is on
   * `flow` (to the nearest standing survivor) for every zombie: goo hunters and loner-stalking
   * specials chase a standing survivor too, so `flow` is never more than their own field says.
   * A culled horde walker is owed back: to its own wave if that is still draining (any phase: it
   * was committed), else to a team-sourced requeue wave ahead of the team, but only in BUILD_UP/
   * SUSTAIN or a holdout (in FADE/RELAX a finished mob that was outrun stays outrun). Ambient and
   * wanderers are not owed. A culled special frees its slot on the next count; no cooldown (it
   * never got to attack), and specials spawn 9..28 tiles out, so a cull-respawn loop needs the
   * team to outrun them again. Cost: at most one sight test per standing survivor per far zombie.
   */
  private cullStragglers(zs: Zombie[]): void {
    const C = DIRECTOR.cull, stand = this.standing(), watch = this.watchers();
    if (!stand.length) return;
    const downed = watch.filter((p) => p.st === PSTATE.DOWN), g2 = C.downGuard * C.downGuard;
    let owed = 0, culled = 0;
    for (const z of zs) {
      if (z.dormant || z.type === ZT.BRUTE || z.sit || z.hp <= 0) continue;
      if (this.flow[this.nodeOf(z)] <= C.tiles || this.inSight(z.x, z.y, z.z, watch)) continue;
      // Zombies near a downed survivor left behind stay: they are that survivor's problem, not stragglers.
      if (downed.some((p) => (p.x - z.x) ** 2 + (p.z - z.z) ** 2 + (p.gy - z.y) ** 2 < g2)) continue;
      this.zombies.delete(z.id);
      culled++;
      if (!z.wave) continue;
      const own = this.waves.find((w) => w.id === z.wave);
      if (own) { own.left++; owed++; continue; }
      if (this.holdout < 0 && this.phase !== Phase.BUILD_UP && this.phase !== Phase.SUSTAIN) continue;
      let rq = this.waves.find((w) => w.requeue);
      if (!rq) { this.spawnWave(0, { side: 1 }); rq = this.waves[this.waves.length - 1]; rq.requeue = true; }
      rq.left++; owed++;
    }
    if (DIRECTOR_DEBUG && culled) console.log(`[director ${this.code}] t=${this.time.toFixed(1)} culled ${culled} stragglers, ${owed} requeued`);
  }

  private updatePlayers(dt: number): void {
    const all = [...this.players.values()];
    const revived = new Set<number>();
    for (const p of all) {
      if (p.st !== PSTATE.ALIVE || !p.reviving) continue;
      const tg = this.players.get(p.reviving);
      if (!tg || tg.st !== PSTATE.DOWN || Math.hypot(tg.x - p.x, tg.z - p.z) > PLAYER.useRange + 0.8 || Math.abs(tg.gy - p.gy) > REACH_DY) continue;
      if (revived.has(tg.id)) continue;
      revived.add(tg.id);
      tg.revNeed = PLAYER.reviveTime;
      tg.revT += dt;
      if (tg.revT >= tg.revNeed) { this.standUp(tg); p.reviving = 0; this.events.push(['revived', tg.id, p.id]); }
    }
    for (const p of all) {
      // Gummy Vitamins: health trickling back while on your feet (going down wastes the rest).
      if (p.regen > 0) {
        if (p.st !== PSTATE.ALIVE) p.regen = 0;
        else { const give = Math.min(p.regen, p.regenRate * dt); p.regen -= give; p.hp = Math.min(PLAYER.hp, p.hp + give); }
      }
      if (p.st === PSTATE.DOWN) {
        // Solo self-revive: progress on your own, bleeding as usual.
        const self = !revived.has(p.id) && this.players.size === 1 && p.selfRev > 0;
        if (self) {
          const need = PLAYER.reviveTime * PLAYER.selfReviveMul;
          if (p.revNeed !== need) { p.revNeed = need; p.revT = 0; } // a teammate's progress (they left) doesn't carry over
          p.revT += dt; p.hp -= PLAYER.bleedRate * dt;
          if (p.revT >= p.revNeed && p.hp > 0) {
            p.selfRev--; this.standUp(p);
            this.events.push(['revived', p.id, p.id]);
            continue;
          }
        } else if (!revived.has(p.id)) { p.revT = 0; p.hp -= PLAYER.bleedRate * dt; }
        if (p.hp <= 0) this.killPlayer(p);
      } else if (p.st === PSTATE.DEAD) {
        p.respawnT -= dt;
        if (p.respawnT <= 0) {
          const mate = this.standing()[0];
          if (mate) this.rescue(p, mate); else p.respawnT = 1;
        }
      }
    }
  }

  /** Back on their feet after a revive: weak, and one down closer to the last. */
  private standUp(p: Player): void {
    p.st = PSTATE.ALIVE; p.hp = 30; p.revT = 0;
    if (p.downs === this.rules.downs - 1) {
      this.events.push(['last', p.id], ['msg', `${p.name} is on their last legs — get them a medkit!`]);
    }
  }

  /** A dead survivor rejoins beside `mate` with a clean slate of downs. */
  private rescue(p: Player, mate: Player): void {
    p.st = PSTATE.ALIVE; p.hp = 50; p.x = mate.x; p.z = mate.z; p.y = mate.gy; p.downs = 0; p.revT = 0;
    this.place(p);
    this.events.push(['tp', p.id, r2(p.x), r2(p.z), mate.ry, r2(p.y)], ['msg', `${p.name} is back in the fight!`]);
    p.freeAt = this.time + TP_GRACE;
  }

  private checkEnd(): void {
    if (!this.players.size || this.standing().length) return;
    // A lone survivor still getting themselves up isn't beaten yet.
    if (this.players.size === 1 && [...this.players.values()].some((p) => p.st === PSTATE.DOWN && p.selfRev > 0)) return;
    this.state = 'lost'; this.endTimer = this.checkpoint ? 6 : 9;
    this.events.push(['end', 0, this.kills, Math.round(this.time)]);
  }

  // ------------------------------------------------------------------- tick
  tick(dt: number): void {
    this.tickN++;
    if (!this.players.size) return;
    this.time += dt;
    if (this.state === 'play') {
      for (const p of this.players.values()) this.place(p);
      this.updatePlayers(dt);
      this.updateHazards(dt);
      this.t.flow -= dt;
      if (this.t.flow <= 0) { this.t.flow = 0.25; this.recomputeFlow(); this.recomputeMarks(); this.recomputeWeeper(); this.updateLoner(0.25); }
      this.director(dt);
      this.updateZombies(dt);
      if (this.state === 'play') this.updateQuest(dt);
      if (this.state === 'play') this.checkEnd();
    } else {
      this.endTimer -= dt;
      if (this.endTimer <= 0) {
        if (this.state === 'won') { this.loadChapter(this.ch + 1); this.reset(false); }
        else this.reset(!!this.checkpoint);
      }
    }
    if (this.tickN % SNAP_EVERY === 0) this.snapshot();
  }

  private snapshot(): void {
    const p: PlayerSnap[] = [];
    for (const q of this.players.values()) {
      p.push([q.id, r2(q.x), r2(q.y), r2(q.z), r2(q.ry), r2(q.rx), Math.ceil(q.hp), q.st, q.w, packMeds(q.meds),
        r2(q.revT / q.revNeed), q.anim, q.st !== PSTATE.DEAD ? 0 : Number.isFinite(q.respawnT) ? Math.ceil(q.respawnT) : -1, Math.ceil(q.armor), packThrowables((wi) => q.thr[wi] ?? 0)]);
    }
    const z: ZombieSnap[] = [];
    for (const q of this.zombies.values()) z.push([q.id, q.type, r2(q.x), r2(q.z), r2(q.ry), q.st, r2(q.y)]);
    this.broadcast({ t: 's', st: this.state, g: this.doors, ho: this.holdout >= 0 ? Math.ceil(this.holdout) : -1, q: this.step, qc: this.collected, p, z, ev: this.events });
    this.events = [];
  }
}
