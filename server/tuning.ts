// Server-side director and AI tuning tables, plus small pure helpers shared by the room's systems.
import { ZT, isCommon, type DifficultyId } from '../shared/constants';
import type { HoldStage, HoldStageKind } from '../shared/level';

export const INF = 32767;
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const r2 = (v: number) => Math.round(v * 100) / 100;
// Overridable so the smoke test doesn't have to sit through holdouts.
export const HOLD_SCALE = Number(process.env.HOLDOUT_SCALE) || 1;
export const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
/**
 * Storeys (shared/level.ts). Sight tests run eye to eye, EYE m above each thing's floor height. REACH_DY:
 * the most floor-height difference across which bites, melee, shoves, pickups, revives and floor hazards
 * connect (a flight of stairs is within it, the storey above is not: a zombie in the street can't bite
 * someone on the roof over it).
 */
export const EYE = 1.2, REACH_DY = 1.6;
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
export const WANDERERS = {
  every: 1, act: 40, near: 10, far: 56, cull: 64, evict: 28, visit: 4, max: 40,
  roll: [0.75, 1.25] as const, clump: [0.55, 0.3, 0.15] as const, triesPer: 6, triesMax: 160,
};
/** Director spawns never appear closer than this (metres) to any survivor. */
export const MIN_SPAWN_DIST = 16;
/**
 * A holdout with lanes (Step.lanes) places its zombies at least this many path tiles from the
 * team when the zone reaches that far, so the flood walks in down the guns' lanes instead of
 * appearing at the zone's near edge, right by the sandbags.
 */
export const ZONE_MIN = 24;
/** ...and at least this many metres in a straight line from every mounted gun (a fence or a wall by the guns is no distance). */
export const ZONE_GUN_GAP = 30;
/** Horde waves: members spawn within CLUSTER tiles of their source; FLANK_CHANCE that a big team-sourced
 * wave (FLANK_MIN+) also comes from a second side; NOISE_REACH: how far (path tiles) a noise source may sit
 * from the noise; GOO_HUNT: seconds a gooed survivor stays marked (wave members chase them first). */
export const CLUSTER = 3, FLANK_CHANCE = 0.22, FLANK_MIN = 10, NOISE_REACH = 12, GOO_HUNT = 12;

/**
 * Adaptive pacing (L4D-style). Each survivor has an intensity 0..100 that rises when they are hurt,
 * downed, pinned/leaped/charged, gooed or kill zombies close by, and decays only while nothing
 * active is near them. The director cycles BUILD_UP -> SUSTAIN -> FADE -> RELAX on the team's
 * (max) intensity. Times in seconds, distances in metres unless noted.
 */
export const DIRECTOR = {
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
export const DIFFICULTY: Record<DifficultyId, {
  peak: number; relax: number; build: number; mob: number; mobEvery: number; slots: readonly number[]; spCd: number;
  ambient: number; wander: number; brute: number; bruteHp: number; spHp: number; dmg: number; intro: number; ladder: number;
}> = {
  easy: { peak: 0.75, relax: 1.3, build: 0.75, mob: 0.7, mobEvery: 1.3, slots: [-1, -1, -1, -1], spCd: 1.35, ambient: 0.6, wander: 0.8, brute: 0.6, bruteHp: 0.8, spHp: 0.85, dmg: 0.5, intro: -0.08, ladder: 1 },
  normal: { peak: 1, relax: 1, build: 1, mob: 1, mobEvery: 1, slots: [0, 0, 0, 0], spCd: 1, ambient: 1, wander: 1, brute: 1, bruteHp: 1, spHp: 1, dmg: 1, intro: 0, ladder: 5 },
  hard: { peak: 1.2, relax: 0.75, build: 1.3, mob: 1.25, mobEvery: 0.85, slots: [0, 0, 1, 1], spCd: 0.85, ambient: 1.2, wander: 1.2, brute: 1.15, bruteHp: 1.15, spHp: 1.1, dmg: 1.5, intro: 0.05, ladder: 5 },
  nightmare: { peak: 1.35, relax: 0.55, build: 1.6, mob: 1.5, mobEvery: 0.7, slots: [1, 1, 1, 1], spCd: 0.7, ambient: 1.4, wander: 1.4, brute: 1.25, bruteHp: 1.3, spHp: 1.25, dmg: 2.2, intro: 0.1, ladder: Infinity },
};
/**
 * Horde focus (L4D-style "one at a time"): commons and the Brute all go for one survivor, the focus,
 * instead of each going for whoever is nearest. The focus is the standing survivor with the most
 * active commons within `near` m (ties: the weakest), kept until they go down, die, leave or can't
 * be reached; every `reconsider` s another survivor takes over only if `margin` more commons are on
 * them. A zombie still swings at any other standing survivor within `block` m of it (they are in
 * its way). Movement: a zombie on the target's floor runs straight at them while the straight line
 * is clear for its body (re-tested every `recheck` s, out to `beeline` m), else it follows the field.
 */
export const FOCUS = { near: 18, reconsider: 12, margin: 6, block: 2.4, beeline: 32, recheck: 0.3 };
/**
 * A Big Hold On (a step with `big: true`, shared/level.ts), the finale of each chapter. Hordes are
 * budgets, not multipliers: a stage's commons are `base[n - 1]` (n survivors) x its `horde` fraction
 * (wave 1 by default; wave 2 and the final 1.5), `open` of them as the stage's opening horde and the
 * rest trickled evenly over the stage. A Brute stage trickles `brute` x base, a breather nothing.
 * `cap[n - 1]` commons alive at once; queued hordes drain one walker every `drain` s. Survivors who
 * died come back when a breather starts. The escape after it (the next step, until everyone is
 * aboard) trickles one walker every `escapeEvery` s from every lane. Spawns use the step's lanes
 * (ZONE_MIN, ZONE_GUN_GAP). One grabber per special push goes for whoever mans a gun.
 */
// Doubled (base, cap, escape trickle) after the first v2 review: the finales read too thin.
export const BIG_HOLD = { base: [44, 60, 80, 100] as const, open: 0.6, brute: 0.4, cap: [60, 80, 110, 140] as const, drain: 0.08, escapeEvery: 0.55 };
/** Brute health: base + this per survivor beyond the first (before difficulty). */
export const BRUTE_HP_PER = 1100;
/** The Brute runs this much faster while its target is further than `far` m away (no kiting it forever in the open). */
export const BRUTE_CATCHUP = { mult: 1.3, far: 9 };
/** A full horde: base + per survivor walkers (before difficulty). Solo gets a smaller one, a full squad the same as before. */
export const HORDE = { base: 8, per: 5 };
/**
 * Loot thinning, rolled each attempt: medkits kept on the map are at most base + per x survivors, small
 * medical items (plasters, vitamins, cocoa) at most smallBase + smallPer x survivors, wherever they lie;
 * `ammo` of the ammo piles are kept (each pile serves every survivor once, see onUse).
 */
export const LOOT = { medBase: 3, medPer: 2, ammo: 0.5, smallBase: 5, smallPer: 3 };
/** Most a launcher blast does to a survivor at its centre (falls to 0 at half its radius). */
export const BLAST_FF = 20;
export const DIRECTOR_DEBUG = !!process.env.DIRECTOR_DEBUG;
export const roll = (r: readonly [number, number]) => rand(r[0], r[1]);
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const tenth = (v: number) => Math.round(v * 10) / 10;

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

/** Which side of the team a spawn must be on: 1 ahead (toward the objective), -1 behind, 2 level with it (a flank), 0 any. */
export type Side = -1 | 0 | 1 | 2;
/** Specials that hold for a coordinated attack and go for a lone survivor (not the Alarm Clock: it keeps away and rings). */
export const AMBUSHER = (type: number) => type === ZT.LEAPER || type === ZT.PUFFER || type === ZT.CHARGER || type === ZT.DROOLER || type === ZT.SNATCHER || type === ZT.PIGGYBACK;
/** Highest a survivor's feet may be above the floor under them: a jump (~1.08 m) or a knockback hop, with slack. */
export const MAX_LIFT = 1.3;
/** After the server teleports a survivor, their own position messages are ignored this long (ones already in flight would undo it). */
export const TP_GRACE = 0.3;
/** Specials that take a director slot: not commons, the Brute or the Weeper. */
export const SLOTTED = (type: number) => !isCommon(type) && type !== ZT.BRUTE && type !== ZT.WEEPER;
/** Zombies that hold a survivor without a wall (freed by shoving the victim, too). */
export const GRABBER = (type: number) => type === ZT.SNATCHER || type === ZT.PIGGYBACK;

/**
 * Booby-trap hordes per difficulty (docs/booby-traps.html): an alarm car brings `car` x a full horde
 * (HORDE.base + HORDE.per x survivors, no further difficulty scaling); a nightlight brings `base` + `per`
 * x survivors walkers. Easy: the lure and the wake-up only.
 */
export const TRAP_HORDE: Record<DifficultyId, { car: number; base: number; per: number }> = {
  easy: { car: 0, base: 0, per: 0 },
  normal: { car: 1.2, base: 12, per: 2 },
  hard: { car: 1.6, base: 16, per: 4 },
  nightmare: { car: 2, base: 20, per: 4 },
};
/** A car's horde scale by survivors in the room (index = team size): 1.2x on Normal becomes 0.8x for one or two. */
export const TRAP_TEAM = [2 / 3, 2 / 3, 2 / 3, 5 / 6, 1];
