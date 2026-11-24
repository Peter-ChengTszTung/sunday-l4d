// Chapter 4: "Morning Bell" — Pinecone Hollow & Pinecone Hill, 6:05 a.m. to sunrise.
// Brief: docs/campaign.md, "Chapter 4: Morning Bell".
//
// Suburb into forest edge. Open streets and cul-de-sacs with tight fenced backyards, a school,
// a creek culvert, a dark pine trail, the ranger cabin, a rockslide detour through the lower woods
// (logging camp, the Pinecone Dam), rock switchbacks up Pinecone Hill to the transmitter compound,
// then the downhill road, the river flats (Mill Row, the lumber yard, the campground), the army field
// post and the Big Hold On at the old river bridge.
//
// Three storeys. Storey 0 is the valley floor. Storey 1 is the rock shelf of Pinecone Hill: the
// HILL STEPS at the top of the H2 switchback climb onto it, and the switchbacks H3-H5, the fire
// road, the hilltop compound and the first half of the downhill road sit on it; the OLD STONE
// STEPS drop the road back to the valley. Storey 1 also carries the PINECONE DAM deck (a long
// chokepoint over the reservoir and spillway). Storey 2 is the TRANSMITTER DECK on the control shed
// roof (the Bell, reached by a stair flight from the yard and two ladders: the horde's three
// routes up) and the fire lookout cab. Ladder side trips: the treehouse on the school path
// (storey 1), the fire lookout (storey 2), the army watchtower over the boom gate (storey 1, with
// the Fizzbang Pod on its roof).
//
//   x: 0     30    46        102      134     159 172 179
//  z 0  RAIL=BERTHA=PINE   (bulb-north lots)          ~~~~~  river
//       STATION | park | MAPLE N lots | CRN |  bulb E   ~~~~~
//    29 ========== MAPLE LOOP ===============( BULB )   ~~~~~
//       MART | MAPLE S lots (backyard gaps) |BIRCH W|=|BIRCH E|walk
//    59 ------ school fence -----------|p|  lots  |=|  lots  |walk
//       SCHOOL BLDG  YARD (bus, XING)  |p| HENDERSON (BULB) camper
//       BACK FIELD       shed          |p|  basement
//   109 *valve ~~~~~~~~~~~~~~~ CREEK ~~~~~~~~~~~~~~~~~~~~~~~~~~
//       culvert   fire road ====== HILLTOP: COMPOUND, shed, mast, lookout | far
//       FOREST TRAIL (fork, blind)  H5 / H4 switchbacks                  | bank
//       F5 ... fern hollow  H3 ===== H2 | road    park  weir ~~~~~~~~~~~~~ |
//   164 CABIN = H1 =#ROCKSLIDE#= H1 H2  |steps DINER = road  PLAZA  boom | No. 9 BUS |
//            |LR|              |flume|  MILL  truck         FIELD POST  motor pool
//       lean-to +==+  ~~~~~~~~~ +=+  |  ROAD  MILL ROW lots  BRIDGE RD
//       LOGGING CAMP  RESERVOIR |F|  |        LUMBER YARD    CAMPGROUND  ~~ river
//   237 forecourt =[DAM DECK, storey 1]= forecourt   SAWMILL    bathhouse, tents
//       dam keeper   ~~spillway~~                              CAMP STORE
//
// Route: station (start) → Maple Loop to the cul-de-sac bulb → battery sweep (bulb garage, a
// car on blocks in a Maple backyard, Birch Court golf cart, camper van by the river) → the
// Henderson basement (checkpoint) → hatch to the school path → across Pinecone Elementary's
// schoolyard (Brute) → creek flood gate (crescendo 1) → culvert → pine trail with the slipper
// fork → ranger cabin (checkpoint) → rockslide on the hill trail: the old logging road, the logging
// camp and over the Pinecone Dam (storey 1), back up the flume path → switchbacks, up the hill steps
// (storey 1) → transmitter compound, up the deck stairs (storey 2) to ring the Bell (crescendo 2) →
// down the downhill road among the sleepers and the stone steps (storey 0) → the convoy's tail truck
// blocks the bridge road: fuel sweep round the river flats (a Mill Row garage, the sawmill office,
// the camp store) → the army field post (checkpoint) → fuel its generator → THE BIG HOLD ON at the
// boom gate, on the army's mounted guns → aboard Dot's No. 9 bus on the far span.
// Tile coordinates: x grows east, z grows south. Arrow rot 0 points south (+z).
import { LevelBuilder, F, WALL, hash2, type PropType, type Theme } from '../level';
import { STOREY } from '../constants';

export const META = { id: 'ch4', title: 'Morning Bell', subtitle: 'Pinecone Hollow & Pinecone Hill' };

const S = 0, E = Math.PI / 2, WEST = -Math.PI / 2, N = Math.PI;
const CREAM = '#fff1c9', RED = '#ff5a5a', GOLD = '#ffd43b', LAV = '#c9a8ff', PINK = '#ff8fc8';
const PEACH = '#ffc48a', MINT = '#8fe3c0', SKY = '#a8d8ff', WHITE_L = '#f4f4ff', OLIVE = '#c8d48a';
const CHERRY = 0xc8324b, SCHOOLBUS = 0xffc94a, ARMY = 0x5f6b3f, WHITE = 0xf2f0f6;
/** Pastel car paint for driveways and kerbs. */
const CARS = [0xff8a80, 0x7fb3e6, 0xf2d06b, 0x9ad4b0, 0xc9a8ff, 0xf4a3c0, 0xe8e3f0, 0x8a9ab8];

/** 6:05 a.m. into sunrise: peach-gold horizon, rose mid-sky, cool blue top; thin lavender mist. */
const THEME: Theme = {
  sky: [0xffc98a, 0xf2a3a0, 0x7f8fd0],
  fog: 0xd2b0cc, fogNear: 30, fogFar: 150,
  // Suburban pastels: blush, mint, butter, powder blue, lilac, peach, sage, eggshell.
  buildings: [0xf4c6c0, 0xbfe3d2, 0xf6e2a8, 0xc6d4f2, 0xe6c8ea, 0xf6d2b0, 0xd4e8b6, 0xefe6da],
  floors: {
    [F.GRASS]: 0x86b06a, [F.DIRT]: 0x9c7a58, [F.ASPHALT]: 0x5a5c74, [F.SIDEWALK]: 0xd8c6b2,
    [F.CONCRETE]: 0xb2aab6, [F.WATER]: 0x5f86b8, [F.SAFE]: 0xf2dcae, [F.INTERIOR]: 0xc8b6bc,
    [F.WOOD]: 0xb07c4c, [F.TILES]: 0xe8e0d8,
  },
};

const INTRO = '6:05 a.m. Bertha ran out of track at Pinecone Hollow. Dot is driving the No. 9 bus to the old bridge to meet the last convoy at sunrise. But the voice on the radio says the sleepers will follow you all the way out, unless someone rings the Morning Bell from the top of the hill.';

type Face = 'N' | 'S' | 'E' | 'W';
interface LotOpts {
  /** Open garage (carved, walk-in) instead of a closed door. */ garage?: boolean;
  /** A walk-through kitchen with front and back doors. */ walkIn?: boolean;
  /** Gap in the side fence into the neighbouring backyard. */ sideGap?: boolean;
  /** Gap in the rear fence. */ rearGap?: boolean;
  /** Car parked on the driveway (paint colour). */ car?: number;
}

export function build() {
  const W = 180, H = 276;
  const b = new LevelBuilder(W, H, 3);

  // Default: dense treeline everywhere that isn't carved (hedge, 6.5–9 m, in 2x2 clumps).
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) b.walls(x, z, x, z, WALL.HEDGE, 6.5 + Math.floor(hash2(x >> 1, z >> 1) * 4) * 0.85);

  // The Mallow River along the east edge (solid but see-through: long sightlines across it).
  b.carve(159, 0, 171, H - 1, F.WATER);
  // The river comes out of a rock gorge and goes back into one: rock across both map-edge rows, so the
  // water never just stops at the edge of the world (and the renderer does not run it on past it).
  b.fill(159, 0, 171, 1); b.walls(159, 0, 171, 1, WALL.ROCK, 9);
  b.fill(159, H - 2, 171, H - 1); b.walls(159, H - 2, 171, H - 1, WALL.ROCK, 9);

  /** A pair of rails between two points, painted as steel lines either side of the centre. */
  const rail = (x0: number, z0: number, x1: number, z1: number) => {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz), n = Math.max(1, Math.ceil(len / 12));
    const ux = dx / len, uz = dz / len, rot = Math.atan2(dz, dx), chars = '━'.repeat(Math.ceil((len / n) * 2) + 1);
    for (let i = 0; i < n; i++) {
      const mx = x0 + (dx * (i + 0.5)) / n, mz = z0 + (dz * (i + 0.5)) / n;
      for (const s of [-0.36, 0.36]) b.label(chars, mx - uz * s, mz + ux * s, 20, '#a9aec4', rot);
    }
  };
  /** Sleeper trail: dropped slippers and pillows pointing the way the sleepwalkers went. */
  const zz = (x: number, z: number, rot = N) => b.label('zZ', x, z, 18, LAV, rot);
  /** A curled-up sleeper on the verge after the Bell: a bedroll with a little "zZ". */
  const sleeper = (x: number, z: number, w: number, d: number) => {
    b.prop('bed', x, z, w, d);
    b.label('z z Z', x + w / 2 + (w > d ? 0 : 0.9), z + d / 2 + (w > d ? -0.9 : 0), 12, LAV, w > d ? 0 : E);
  };
  /** Snoozle billboard (a board on two posts) with the "WAKE UP" graffiti in front. */
  const billboard = (x: number, z: number, w: number, d: number, tx: number, tz: number, rot: number) => {
    b.prop('container', x, z, w, d, { color: 0xf6e6f0 });
    b.label('SNOOZLE: SLEEP TIGHT!', tx, tz, 11, PINK, rot);
    b.label('WAKE UP', tx + (rot === 0 || rot === N ? 0 : 1.2 * Math.sign(Math.sin(rot))), tz + (rot === 0 ? 1.3 : rot === N ? -1.3 : 0), 22, RED, rot);
  };
  /** Forest dressing along a carved strip: pines, bushes and boulders on alternating edges, never
   *  both sides at once, so a lane of at least (width - 1) tiles stays clear. */
  const dress = (x0: number, z0: number, x1: number, z1: number, seed: number, kinds: PropType[] = ['pine', 'pine', 'bush', 'rock', 'tree']) => {
    const horiz = x1 - x0 >= z1 - z0;
    const a0 = horiz ? x0 : z0, a1 = horiz ? x1 : z1;
    for (let t = a0 + 3; t <= a1 - 3; t += 3 + Math.floor(hash2(t, seed) * 3)) {
      const h = hash2(t * 7 + seed, seed * 3 + t);
      const side = h < 0.5;
      const kind = kinds[Math.floor(hash2(t + seed * 11, 5) * kinds.length)];
      const x = horiz ? t : (side ? x0 : x1), z = horiz ? (side ? z0 : z1) : t;
      b.prop(kind, x, z);
    }
  };

  /**
   * A suburban lot, 14 wide along the street and 24 deep, described in local coordinates:
   * c = 0..13 along the street, k = 0..23 away from it. Lawn k 0–5 (k 0 is the sidewalk),
   * house k 6–13 on c 1–10 with an optional garage (c 7–9) and walk-through kitchen (c 2–5),
   * side passage c 11–13, backyard k 14–22, fence on c 0 and along the rear (k 23).
   * `face` says where the street is: the lot lies north of it for 'S', and so on.
   */
  const lot = (x0: number, z0: number, face: Face, o: LotOpts = {}) => {
    const P = (c: number, k: number): [number, number] =>
      face === 'S' ? [x0 + c, z0 + 23 - k] : face === 'N' ? [x0 + c, z0 + k] : face === 'E' ? [x0 + 23 - k, z0 + c] : [x0 + k, z0 + c];
    const R = (c0: number, k0: number, c1: number, k1: number): [number, number, number, number] => {
      const [ax, az] = P(c0, k0), [bx, bz] = P(c1, k1);
      return [Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)];
    };
    const carveL = (c0: number, k0: number, c1: number, k1: number, f: number) => { const r = R(c0, k0, c1, k1); b.carve(r[0], r[1], r[2], r[3], f); };
    const propL = (type: PropType, c: number, k: number, wc = 1, dk = 1, extra: { color?: number; rot?: number } = {}) => {
      const r = R(c, k, c + wc - 1, k + dk - 1);
      b.prop(type, r[0], r[1], r[2] - r[0] + 1, r[3] - r[1] + 1, extra);
    };
    const mid = (c: number, k: number): [number, number] => { const [x, z] = P(c, k); return [x + 0.5, z + 0.5]; };
    // Ground.
    carveL(0, 0, 13, 5, F.GRASS);
    { const r = R(0, 0, 13, 0); b.paint(r[0], r[1], r[2], r[3], F.SIDEWALK); }
    { const r = R(7, 0, 9, 5); b.paint(r[0], r[1], r[2], r[3], F.CONCRETE); }      // driveway
    { const r = R(3, 1, 4, 5); b.paint(r[0], r[1], r[2], r[3], F.SIDEWALK); }      // front path
    carveL(11, 6, 13, 13, F.GRASS);                                                 // side passage
    carveL(1, 14, 13, 22, F.GRASS);                                                 // backyard
    // House and fences.
    { const r = R(1, 6, 10, 13); b.walls(r[0], r[1], r[2], r[3], WALL.BUILDING, 5.2 + Math.floor(hash2(x0, z0 + 3) * 3) * 0.7); }
    { const r = R(0, 6, 0, 23); b.walls(r[0], r[1], r[2], r[3], WALL.FENCE, 1.8); }
    { const r = R(0, 23, 13, 23); b.walls(r[0], r[1], r[2], r[3], WALL.FENCE, 1.8); }
    if (o.garage) carveL(7, 6, 9, 11, F.INTERIOR);
    if (o.walkIn) {
      carveL(2, 7, 5, 12, F.INTERIOR); carveL(3, 6, 4, 6, F.INTERIOR); carveL(3, 13, 4, 13, F.INTERIOR);
      propL('counter', 2, 8, 1, 4, { color: 0xf2e6d0 });
      propL('shelf', 5, 8, 1, 1, { color: 0xeef2f6 });                              // the fridge
      propL('desk', 5, 11, 1, 1);
    }
    if (o.sideGap) carveL(0, 17, 0, 19, F.GRASS);
    if (o.rearGap) carveL(5, 23, 7, 23, F.GRASS);
    // Dressing: a backyard tree, a bush by the porch, a bike on the lawn, the porch light.
    const h = hash2(x0 * 3 + 1, z0 * 5 + 2);
    propL(h < 0.4 ? 'tree' : h < 0.7 ? 'pine' : 'bush', 3, 19);
    propL('bush', 9, 15);
    if (!o.walkIn) propL('bush', 1, 5);
    if (h > 0.3) propL('barrier', 5, 3, 1, 1);                                       // a kid's bike dropped on the lawn
    if (o.car !== undefined) propL('car', 8, 1, 1, 2, { color: o.car });
    const [lx, lz] = mid(4, 5); b.lamp(lx, lz);                                     // porch light
    const [sx, sz] = mid(5, 5); b.label('zZ', sx, sz, 10, PINK, face === 'S' ? N : face === 'N' ? 0 : face === 'E' ? WEST : E);   // Snoozle nightlight in the window
    return { P, mid, propL, carveL };
  };

  // ------------------------------------------------------------------
  // 1. Pinecone Hollow station (start safe room), Bertha, the platform and car park
  // ------------------------------------------------------------------
  b.carve(2, 2, 44, 4, F.DIRT);                                              // rail bed
  rail(2, 3, 44, 3);
  b.carve(2, 5, 44, 7, F.CONCRETE);                                          // platform
  b.prop('bus', 4, 2, 8, 2, { color: CHERRY });                               // Bertha, nose against the pine
  for (const [x, z] of [[12, 2], [12, 3], [14, 2]]) b.prop('pine', x, z);    // the fallen pine across the track
  b.prop('rock', 13, 2); b.prop('barrier', 43, 2, 1, 2);                      // buffer stop
  b.label('BERTHA', 8, 4.5, 16, '#fff3e0', 0); b.label('FALLEN PINE', 14, 4.6, 11, PEACH, 0);
  b.label('PINECONE HOLLOW', 23, 6, 22, PEACH, 0); b.label('END OF HILL LINE', 36, 6.3, 10, CREAM, 0);
  for (const x of [20, 28, 36]) b.prop('bench', x, 5, 2, 1);
  for (const x of [8, 30, 42]) b.lamp(x, 6.5);
  // Waiting room.
  b.walls(6, 8, 24, 19, WALL.BUILDING, 6);
  b.carve(7, 9, 23, 18, F.SAFE);
  b.prop('counter', 11, 9, 1, 3, { color: 0x9a6a48 });                      // ticket office counter
  const stationRadio = b.obj('radio', 8, 9, 'Radio Dot from the ticket office');
  b.prop('shelf', 7, 12, 1, 1);
  for (const [x, z] of [[14, 11], [19, 11], [14, 14], [19, 14]]) b.prop('bench', x, z, 4, 1);
  b.prop('shelf', 23, 9, 1, 3, { color: 0xff8fc8 });                         // Snoozle vending machine
  b.pick('smg', 7, 17); b.pick('shotgun', 8, 17); b.pick('rifle', 9, 17); b.pick('rifle', 10, 17); b.pick('smg', 11, 17);
  b.pick('ammo', 22, 16); b.pick('ammo', 22, 17); b.pick('ammo', 21, 16);
  for (const x of [19, 20, 21, 22]) b.pick('medkit', x, 18);
  b.pick('bat', 12, 17); b.pick('machete', 13, 17); b.pick('firebomb', 23, 16); b.pick('armor', 18, 18);
  b.label('SAFE ROOM', 16, 13, 22, RED); b.label('WAITING ROOM', 16, 15.6, 12, PEACH);
  b.label('TICKETS', 9, 12.6, 10, CREAM); b.label('CLOCK: 3:00', 20, 9.6, 9, LAV);
  b.lamp(16, 16); b.lamp(9, 10.5);
  b.carve(14, 19, 16, 19, F.SIDEWALK);
  const stationDoor = b.door(14, 19, 16, 19, 'shutter', 'STATION');
  // Side path from the car park up to the platform (to look at Bertha).
  b.carve(25, 5, 27, 19, F.SIDEWALK);
  b.label('TO PLATFORM', 26, 14, 10, CREAM, N);
  // Station car park.
  b.carve(3, 20, 30, 28, F.ASPHALT);
  for (const x of [4, 7, 10, 22, 25, 28]) b.label('|', x + 0.5, 22, 30, WHITE_L, 0);
  b.prop('car', 5, 21, 1, 2, { color: 0xf2d06b }); b.prop('car', 23, 21, 1, 2, { color: 0x7fb3e6 });
  b.prop('car', 29, 21, 1, 2, { color: 0xe8e3f0 }); b.prop('van', 8, 25, 2, 1, { color: 0x9ad4b0 });
  b.prop('dumpster', 3, 20); b.prop('bush', 30, 27);
  b.pick('ammo', 4, 27); b.pick('medkit', 18, 21);
  b.label('PARK & RIDE', 15, 24.6, 14, CREAM, 0);
  b.lamp(12, 21); b.lamp(26, 26);
  b.arrow(15, 21, S); b.arrow(20, 27, E);
  zz(18, 26, E);

  // ------------------------------------------------------------------
  // 2. Hollow Green (pocket park with the first graffitied Snoozle board) and Hollow Mart
  // ------------------------------------------------------------------
  b.carve(31, 8, 45, 28, F.GRASS);
  b.paint(31, 28, 45, 28, F.SIDEWALK);
  billboard(35, 9, 6, 1, 38, 11, 0);
  b.prop('tree', 32, 16); b.prop('tree', 43, 20); b.prop('pine', 33, 23); b.prop('bush', 40, 15); b.prop('bush', 44, 10);
  b.prop('bench', 37, 18, 3, 1); b.prop('fountain', 38, 22, 2, 2);
  b.pick('ammo', 36, 26); b.pick('medkit', 44, 25);
  b.label('HOLLOW GREEN', 38, 26.4, 12, MINT, 0); b.lamp(35, 20);
  // Hollow Mart (corner shop, side pocket south of the car park).
  b.walls(2, 36, 13, 50, WALL.BUILDING, 5);
  b.carve(3, 37, 12, 49, F.INTERIOR); b.carve(6, 36, 8, 36, F.INTERIOR);
  b.carve(3, 35, 14, 35, F.SIDEWALK);
  for (const z of [41, 44, 47]) b.prop('shelf', 4, z, 6, 1);
  b.prop('counter', 10, 38, 1, 2, { color: 0xf2e6d0 }); b.prop('shelf', 12, 41, 1, 7, { color: 0x8fe3c0 });
  b.pick('shotgun', 11, 49); b.pick('smg', 12, 49); b.pick('rifle', 10, 49); b.pick('ammo', 3, 49); b.pick('medkit', 3, 39); b.pick('ammo', 11, 43);
  b.label('HOLLOW MART 24h', 7.5, 34.6, 12, MINT, 0); b.label('OPEN', 7, 38.5, 10, RED);
  b.lamp(7.5, 45);
  // Maple Loop pulls everyone east from the station; the mart's guns sit just west. A lit shopfront,
  // its name big on the road where you step out of the car park, and ammo on the kerb lead there.
  b.lamp(5.4, 35.4); b.lamp(9.6, 35.4); b.label('HOLLOW MART 24h', 12, 31.5, 18, MINT, N);
  b.pick('ammo', 9, 33);

  // ------------------------------------------------------------------
  // 3. Maple Loop: the long open street east to the cul-de-sac bulb, lots on both sides
  // ------------------------------------------------------------------
  // North side (face S): backyards along the treeline. Lot 60 has the fridge note.
  lot(46, 5, 'S', { walkIn: true, sideGap: true, car: CARS[0] });
  const kitchen = lot(60, 5, 'S', { walkIn: true, garage: true, sideGap: true });
  lot(74, 5, 'S', { garage: true, sideGap: true, car: CARS[1] });
  const g88 = lot(88, 5, 'S', { sideGap: true, garage: true, car: CARS[2] });
  { const [x, z] = g88.P(8, 9); b.item('part', 'battery', x, z, 'car battery'); }   // open garage, last house before the bulb
  { const [x, z] = g88.mid(8, 4); b.label('GARAGE SALE', x, z, 9, CREAM, 0); }
  { const [x, z] = kitchen.P(4, 8); b.note(x, z, 'Fridge note', 'Kids, trying the free Sweet Dreams fog tonight! Windows open, lights out by 11. Love you. Mum xx'); }
  { const [x, z] = kitchen.P(3, 10); b.pick('medkit', x, z); }
  { const [x, z] = kitchen.P(8, 9); b.pick('ammo', x, z); }
  { const [x, z] = kitchen.P(6, 18); b.pick('ammo', x, z); }
  // South side (face N): a chain of backyards joined by fence gaps.
  lot(15, 35, 'N', { car: CARS[3] });
  const s29 = lot(29, 35, 'N', { walkIn: true, sideGap: true });
  lot(43, 35, 'N', { garage: true, sideGap: true, car: CARS[4] });
  lot(57, 35, 'N', { sideGap: true });
  const s71 = lot(71, 35, 'N', { sideGap: true, car: CARS[5] });
  const s85 = lot(85, 35, 'N', { garage: true, sideGap: true });
  { const [x, z] = s29.P(3, 10); b.pick('ammo', x, z); }
  { const [x, z] = s85.P(8, 8); b.pick('medkit', x, z); }
  { const [x, z] = s85.P(6, 20); b.pick('ammo', x, z); }
  // The car up on blocks (battery) in the last Maple backyard. Its side passage is choked with
  // a woodpile, so the way in is next door's passage and the fence gap.
  s85.propL('car', 4, 16, 1, 2, { color: 0x8a9ab8 });
  s85.propL('crate', 6, 15); s85.propL('barrel', 6, 17);
  s85.propL('crate', 11, 9); s85.propL('pallet', 12, 9); s85.propL('crate', 13, 9);
  { const [x, z] = s85.mid(4, 19); b.label('ON BLOCKS', x, z, 10, CREAM, 0); }
  { const [x, z] = s85.mid(12, 11); b.label('WOODPILE', x, z, 9, CREAM, 0); }
  { const [x, z] = s85.P(7, 18); b.item('part', 'battery', x, z, 'car battery'); }
  { const [x, z] = s71.mid(12, 8); b.label('FENCE GAP NEXT DOOR', x, z, 8, GOLD, 0); }
  { const [x, z] = s71.mid(12, 15); b.arrow(x, z, E); }
  { const [x, z] = s71.P(6, 20); b.pick('medkit', x, z); }
  // The street.
  b.carve(3, 29, 101, 34, F.ASPHALT);
  for (let x = 8; x <= 96; x += 8) b.label('— —', x, 31.9, 16, '#f2e6c0', E);
  b.label('MAPLE LOOP', 24, 31.9, 20, PEACH, E);
  b.label('SCHOOL ZONE 20', 70, 30.2, 12, GOLD, E);
  for (const [x, z, c] of [[34, 29, 0], [52, 34, 1], [66, 29, 2], [80, 34, 6], [92, 29, 7]]) b.prop('car', x, z, 2, 1, { color: CARS[c] });
  b.prop('van', 58, 33, 2, 1, { color: 0xffffff }); b.prop('barrier', 45, 31, 1, 2);
  for (const x of [18, 32, 46, 60, 74, 88]) { b.lamp(x, x % 28 === 4 ? 28.6 : 35.4); }
  b.pick('ammo', 62, 30); b.pick('medkit', 84, 33);
  b.arrow(36, 32, E); b.arrow(70, 32, E); b.arrow(96, 32, E);
  for (const x of [28, 50, 64, 86]) zz(x, 32.5, E);

  // ------------------------------------------------------------------
  // 4. The cul-de-sac bulb at the end of Maple Loop, and its lots
  // ------------------------------------------------------------------
  const g116 = lot(116, 0, 'S', { garage: true });
  lot(102, 0, 'S', { garage: true, car: CARS[6] });
  lot(134, 10, 'W', { sideGap: false, car: CARS[7] });
  const e24 = lot(134, 24, 'W', { walkIn: true });
  { const [x, z] = g116.P(8, 9); b.pick('ammo', x, z); }
  { const [x, z] = e24.P(3, 9); b.pick('ammo', x, z); }
  { const [x, z] = e24.P(6, 18); b.pick('medkit', x, z); }
  b.carve(99, 24, 133, 40, F.ASPHALT);
  b.fill(131, 24, 133, 25); b.fill(132, 26, 133, 26); b.fill(131, 39, 133, 40); b.fill(132, 38, 133, 38);
  b.carve(112, 30, 120, 34, F.GRASS);                                        // turning island
  b.prop('tree', 116, 32); b.prop('bush', 113, 31); b.prop('bush', 119, 33);
  b.label('MAPLE LOOP', 116, 29.4, 12, PEACH, E); b.label('CUL-DE-SAC', 116, 35.4, 10, CREAM, E);
  b.prop('car', 104, 38, 2, 1, { color: CARS[3] }); b.prop('car', 127, 26, 1, 2, { color: CARS[0], rot: 0.4 });
  b.label('BIRCH CT', 126, 38.5, 14, PEACH, 0);
  for (const [x, z] of [[106, 24.4], [128, 31], [110, 40.4]]) b.lamp(x, z);
  b.arrow(122, 37, S); b.arrow(108, 27, E);

  // ------------------------------------------------------------------
  // 5. Birch Court: south from the bulb to its own bulb, the riverside walk, the camper van
  // ------------------------------------------------------------------
  lot(100, 42, 'E', { car: CARS[1] });
  const w56 = lot(100, 56, 'E', { sideGap: true, garage: true });
  const w70 = lot(100, 70, 'E', { sideGap: true, walkIn: true });
  lot(129, 42, 'W', { rearGap: true, car: CARS[2] });
  const e56 = lot(129, 56, 'W', { sideGap: true, rearGap: true });
  const e70 = lot(129, 70, 'W', { sideGap: true, rearGap: true, garage: true });
  { const [x, z] = w56.P(8, 9); b.pick('ammo', x, z); }
  { const [x, z] = w70.P(3, 10); b.pick('medkit', x, z); }
  { const [x, z] = w70.P(6, 18); b.pick('rifle', x, z); }
  { const [x, z] = e70.P(8, 9); b.pick('ammo', x, z); }
  // Golf cart (battery) in the Birch Court backyard.
  e56.propL('car', 5, 17, 1, 1, { color: 0xf4f4ee });
  { const [x, z] = e56.mid(5, 20); b.label('GOLF CART', x, z, 9, CREAM, E); }
  { const [x, z] = e56.P(7, 18); b.item('part', 'battery', x, z, 'car battery'); }
  { const [x, z] = e56.P(10, 20); b.pick('ammo', x, z); }
  // The street.
  b.carve(124, 41, 128, 83, F.ASPHALT);
  b.label('BIRCH COURT', 126, 50, 16, PEACH, N);
  b.prop('car', 124, 60, 1, 2, { color: CARS[5] }); b.prop('car', 128, 73, 1, 2, { color: CARS[4] });
  b.prop('barrier', 126, 66, 1, 1);
  for (const z of [46, 60, 74]) b.lamp(z === 60 ? 128.6 : 123.4, z);
  b.arrow(126, 44, S); b.arrow(126, 79, S);
  zz(126, 56, S); zz(126, 70, S);
  // Birch Court bulb.
  b.carve(118, 84, 146, 102, F.ASPHALT);
  b.fill(144, 84, 146, 85); b.fill(145, 86, 146, 86); b.fill(144, 101, 146, 102); b.fill(145, 100, 146, 100); b.fill(118, 101, 119, 102);
  b.carve(128, 90, 136, 96, F.GRASS);
  b.prop('tree', 132, 93); b.prop('bush', 129, 91); b.prop('bush', 135, 95); b.prop('bench', 130, 96, 3, 1);
  b.label('BIRCH COURT', 132, 89.4, 12, PEACH, E); b.label('NO THRU ROAD', 132, 97.8, 9, CREAM, E);
  b.prop('car', 140, 98, 2, 1, { color: CARS[6] }); b.prop('van', 121, 86, 1, 2, { color: 0xffffff });
  b.pick('ammo', 142, 88); b.pick('medkit', 122, 100);
  for (const [x, z] of [[120, 92], [143, 93], [132, 101.6]]) b.lamp(x, z);
  // Camper pad and the riverside walk.
  b.carve(147, 86, 152, 100, F.GRASS); b.paint(147, 88, 152, 98, F.DIRT);
  b.prop('van', 148, 88, 2, 4, { color: 0xf6ecd2 });                          // the camper van
  b.prop('barrel', 151, 87); b.prop('bench', 148, 94, 2, 1);
  b.label('HAPPY CAMPER', 149, 92.8, 9, PEACH, 0);
  b.item('part', 'battery', 150, 93, 'car battery');
  b.carve(153, 42, 158, 102, F.DIRT);
  b.paint(153, 42, 153, 102, F.GRASS);
  for (const z of [50, 64, 78, 96]) b.prop(z % 28 === 22 ? 'tree' : 'pine', z % 4 ? 158 : 153, z);
  b.prop('bench', 157, 58, 1, 2); b.prop('bench', 157, 86, 1, 2);
  b.pick('ammo', 156, 45); b.pick('medkit', 155, 71);
  b.label('RIVERSIDE WALK', 155.5, 66, 12, SKY, N); b.label('NO SWIMMING', 157, 92, 9, RED, N);
  for (const z of [48, 68, 88]) b.lamp(158.6, z);
  // Henderson house: a pastel two-storey over the prepper basement.
  b.walls(100, 84, 117, 102, WALL.BUILDING, 6.8);
  b.label('THE HENDERSONS', 121, 91, 11, PEACH, E); b.label('KEEP OUT. WE MEAN IT.', 120.6, 96, 9, RED, E);
  b.label('STORM CELLAR', 119.4, 93.5, 10, GOLD, WEST);
  b.prop('bush', 118, 89); b.prop('bush', 118, 97);
  b.lamp(118.6, 93.5);
  b.arrow(121, 93.5, WEST);
  b.carve(117, 92, 117, 94, F.SIDEWALK);
  const cellarDoor = b.door(117, 92, 117, 94, 'shutter', 'STORM CELLAR');

  // ------------------------------------------------------------------
  // 6. The Henderson basement (checkpoint)
  // ------------------------------------------------------------------
  b.carve(104, 87, 116, 99, F.SAFE);
  for (const x of [104, 106]) b.prop('shelf', x, 87, 1, 4, { color: 0xffb36b });   // canned peaches
  b.prop('shelf', 108, 87, 4, 1, { color: 0xffb36b });
  b.prop('gen', 115, 87); b.prop('pallet', 113, 87, 1, 1);                     // generator, toilet paper
  b.prop('pallet', 104, 97, 2, 2); b.prop('crate', 115, 98);
  b.prop('bed', 113, 95, 1, 2); b.prop('bed', 115, 95, 1, 2);                  // bunks
  b.prop('desk', 106, 94, 2, 1); b.prop('radio', 107, 93);
  b.note(105, 92, 'Journal on the basement shelf', 'Day 1. Told Barb the free fog was a government plot. It was a sleep company plot. Still counts. Day 2. Barb went upstairs for a nap.');
  for (const x of [109, 110, 111, 112]) b.pick('medkit', x, 99);
  b.pick('ammo', 113, 91); b.pick('ammo', 114, 91); b.pick('ammo', 112, 88);
  b.pick('shotgun', 106, 99); b.pick('rifle', 107, 99); b.pick('smg', 108, 99); b.pick('autoshotgun', 106, 98); b.pick('launcher', 108, 98); // the schoolyard Brute is next
  b.pick('machete', 107, 98); b.pick('armor', 113, 99); b.pick('rattle', 115, 91);
  const hatchLever = b.obj('lever', 104, 91, 'Open the basement hatch');
  b.label('SAFE ROOM', 110.5, 90, 22, RED); b.label('HENDERSON BASEMENT', 110.5, 92.4, 11, PEACH);
  b.label('PEACHES: 212 CANS', 107, 86.6, 8, CREAM); b.label('HATCH', 104.5, 94.8, 10, GOLD, E);
  b.lamp(110.5, 95); b.lamp(106, 89);
  b.carve(103, 92, 103, 94, F.DIRT);
  const hatch = b.door(103, 92, 103, 94, 'shutter', 'HATCH');
  b.carve(100, 92, 102, 94, F.DIRT);                                          // back steps

  // ------------------------------------------------------------------
  // 7. The school path: a fenced lane behind the Birch Court backyards (opens with the hatch)
  // ------------------------------------------------------------------
  b.carve(96, 60, 99, 104, F.DIRT);
  b.paint(96, 60, 96, 104, F.GRASS);
  b.walls(95, 59, 95, 110, WALL.FENCE, 2.4); b.walls(30, 59, 99, 59, WALL.FENCE, 2.4);
  b.label('SCHOOL PATH', 98, 88, 11, CREAM, N);
  // Treehouse corner (pocket north): a plank treehouse (storey 1) over the end of the lane, up a
  // ladder. Off-route reward. Compost heap (pocket south).
  b.prop('pallet', 96, 62, 1, 2); b.prop('bush', 99, 66);
  b.ladder(98, 64, '-z', F.WOOD);
  b.label('TREEHOUSE (NO GIRLS, NO ZOMBIES)', 97.5, 67, 8, PEACH, N); b.label('LADDER', 98.5, 65.6, 7, CREAM, N);
  b.level(1);
  b.carve(96, 60, 99, 63, F.WOOD);
  b.prop('crate', 96, 60);
  b.pick('ammo', 97, 61); b.pick('medkit', 99, 60); b.pick('armor', 96, 62);
  b.label('NO ZOMBIES', 97.5, 62.4, 9, PEACH, N);
  b.lamp(98, 61.5);
  b.level(0);
  b.prop('crate', 99, 103); b.prop('barrel', 96, 104);
  b.pick('ammo', 97, 102);
  b.lamp(97.5, 93); b.lamp(97.5, 72);
  b.arrow(98, 90, N); b.arrow(96.5, 78, WEST);
  zz(98, 84, N);

  // ------------------------------------------------------------------
  // 8. Pinecone Elementary: school building, schoolyard (Brute), back field, the flood gate
  // ------------------------------------------------------------------
  b.carve(30, 60, 94, 110, F.GRASS);
  b.carve(95, 76, 95, 80, F.GRASS);                                           // back gate from the school path
  b.label('BACK GATE', 95.5, 74.8, 9, CREAM, 0);
  b.paint(58, 60, 94, 86, F.ASPHALT);                                         // schoolyard
  b.paint(30, 109, 94, 110, F.DIRT);                                          // creek bank
  // School building: two classrooms, hallway, gym; doors east, west and south.
  b.fill(33, 63, 56, 81); b.walls(33, 63, 56, 81, WALL.BUILDING, 7.5);
  b.carve(34, 64, 43, 69, F.TILES); b.carve(46, 64, 55, 69, F.TILES);
  b.carve(38, 70, 39, 70, F.TILES); b.carve(50, 70, 51, 70, F.TILES);
  b.carve(33, 71, 56, 73, F.TILES);                                           // hallway (west and east doors)
  b.carve(44, 74, 46, 74, F.TILES); b.carve(34, 75, 55, 80, F.WOOD); b.carve(44, 81, 46, 81, F.WOOD);
  for (const [x0, z0] of [[35, 65], [47, 65]]) for (let i = 0; i < 3; i++) b.prop('desk', x0 + i * 3, z0 + 2, 2, 1);
  b.prop('counter', 34, 64, 1, 2, { color: 0xc9a8ff }); b.prop('shelf', 55, 64, 1, 3, { color: 0x8fe3c0 });
  b.prop('bench', 36, 79, 6, 1); b.prop('bench', 48, 79, 6, 1); b.prop('pillar', 40, 76, 1, 1, { color: 0xffd43b });
  b.pick('ammo', 42, 64); b.pick('medkit', 54, 68); b.pick('ammo', 35, 77); b.pick('smg', 53, 76); b.pick('autoshotgun', 52, 76); b.pick('rifle', 54, 76);
  b.label('CLASS 2B', 38.5, 66.6, 10, CREAM); b.label('CLASS 3A', 50.5, 66.6, 10, CREAM);
  b.label('GYM', 45, 77, 16, PEACH); b.label('SNOOZLE ASSEMBLY', 45, 78.4, 8, PINK);
  for (const [x, z] of [[40, 72], [50, 72], [45, 77]]) b.lamp(x, z);
  b.note(57, 70, 'Noticeboard', 'SNOOZLE ASSEMBLY CANCELLED due to "weird fog". School closed Friday. Enjoy your long weekend!');
  b.label('PINECONE ELEMENTARY', 66, 61.6, 16, PEACH, 0); b.label('GO PINECONES!', 45, 62.2, 10, GOLD, 0);
  // Schoolyard: bus loop and the crossing (west), jungle gym, basketball court.
  b.prop('bus', 60, 62, 2, 9, { color: SCHOOLBUS });
  b.label('BUS LOOP', 63, 74, 10, CREAM, N);
  b.label('| | | | |', 61.5, 84.5, 26, WHITE_L, E);                          // zebra crossing
  b.label('SCHOOL XING', 61.5, 82.6, 11, GOLD, 0); b.label('STOP', 66.5, 84.5, 16, RED, 0);
  for (const [x, z] of [[71, 66], [77, 66], [71, 71], [77, 71]]) b.prop('pillar', x, z, 1, 1, { color: 0xff8a5c });
  b.prop('barrier', 72, 66, 2, 1); b.prop('barrier', 75, 71, 2, 1); b.prop('pallet', 74, 68, 1, 1);
  b.label('JUNGLE GYM (FLATTENED)', 74, 73.4, 9, CREAM, 0);
  for (const x of [82, 84, 86]) b.prop('beacon', x, 62);                       // swing frame
  b.label('SWINGS', 84, 64, 9, CREAM, 0);
  b.prop('beacon', 87, 74); b.prop('beacon', 87, 85);                         // hoops
  b.label('O', 87.5, 79.5, 40, WHITE_L, 0); b.label('3', 84, 79.5, 14, WHITE_L, 0);
  b.prop('barrier', 66, 78, 4, 1);                                            // bike racks
  b.prop('bench', 91, 66, 1, 3); b.prop('tree', 93, 61); b.prop('tree', 79, 61);
  b.pick('ammo', 90, 80); b.pick('ammo', 68, 64); b.pick('medkit', 80, 76);
  for (const [x, z] of [[67, 70], [82, 70], [74, 82], [92, 78]]) b.lamp(x, z);
  b.arrow(90, 78, WEST); b.arrow(72, 80, WEST); b.arrow(58, 89, S);
  zz(80, 79, WEST); zz(68, 82, WEST);
  // Back field: goals, bleachers, an equipment shed, down to the creek.
  b.prop('barrier', 36, 95, 1, 3); b.prop('barrier', 80, 95, 1, 3);
  b.label('O', 58, 96.5, 60, WHITE_L, 0);
  for (const z of [104, 106]) b.prop('bench', 56, z, 10, 1);                   // bleachers
  b.fill(86, 99, 93, 106); b.walls(86, 99, 93, 106, WALL.BUILDING, 3.6);
  b.carve(87, 100, 92, 105, F.INTERIOR); b.carve(86, 102, 86, 103, F.INTERIOR);
  b.prop('shelf', 92, 100, 1, 4); b.prop('crate', 87, 100);
  b.pick('ammo', 88, 105); b.pick('medkit', 91, 105); b.pick('ammo', 89, 101);
  b.label('EQUIPMENT', 89.5, 102.5, 9, CREAM);
  b.lamp(85.4, 101.4); b.label('EQUIPMENT', 83.6, 102.5, 14, CREAM, E);          // its door, lit and named from the field
  for (const [x, z] of [[31, 88], [31, 100], [74, 108], [82, 92], [48, 108], [66, 90]]) b.prop(x === 31 ? 'pine' : 'tree', x, z);
  b.pick('ammo', 44, 104); b.pick('ammo', 45, 104); b.pick('medkit', 33, 96); b.pick('ammo', 70, 100);
  b.pick('rattle', 46, 104);                                     // before the flood gate holdout
  for (const [x, z] of [[46, 90], [70, 96], [36, 106], [84, 108]]) b.lamp(x, z);
  b.arrow(56, 100, WEST); b.arrow(44, 106, WEST);
  zz(50, 102, WEST);
  // The creek, the flood gate and the culvert mouth.
  b.carve(37, 111, 158, 114, F.WATER);
  b.walls(28, 110, 53, 125, WALL.ROCK, 4.5);
  const floodValve = b.obj('valve', 37, 110, 'Crank the creek flood gate (LOUD)');
  b.label('FLOOD GATE', 34, 108.4, 12, GOLD, 0); b.label('PINECONE CREEK', 60, 112.8, 14, SKY, E);
  b.label('CULVERT', 34, 107.2, 9, CREAM, 0);
  b.lamp(36, 108.6);
  // Cover round the flood gate: sandbags, a woodpile, reeds on the bank (imperfect on purpose).
  b.prop('barrier', 41, 103, 1, 3); b.prop('crate', 31, 105); b.prop('barrel', 45, 108); b.prop('pallet', 30, 98, 1, 2);
  b.prop('bush', 52, 109); b.prop('bush', 61, 110); b.prop('barrier', 49, 100, 3, 1);
  b.carve(33, 111, 35, 111, F.CONCRETE);
  const culvertGate = b.door(33, 111, 35, 111, 'fence', 'FLOOD GATE');

  // ------------------------------------------------------------------
  // 9. The culvert and the pine trail (dark, sparse lamps, the slipper fork)
  // ------------------------------------------------------------------
  // The culvert: a dark concrete dogleg under the embankment (no sightlines, shotgun range).
  b.carve(33, 112, 35, 120, F.CONCRETE); b.carve(33, 118, 50, 120, F.CONCRETE); b.carve(48, 118, 50, 125, F.CONCRETE);
  for (const [x, z] of [[34, 115], [40, 119], [46, 119], [49, 123]]) b.label('~ ~', x, z, 16, SKY, 0);   // puddles
  b.lamp(49, 122);
  b.arrow(34, 117, S); b.arrow(37, 119, E); b.arrow(49, 121.5, S);
  b.pick('ammo', 44, 118);
  b.carve(40, 126, 52, 132, F.DIRT);                                           // clearing at the culvert mouth
  b.prop('pine', 41, 126); b.prop('rock', 52, 131); b.prop('bush', 44, 132); b.prop('pine', 52, 127);
  b.pick('ammo', 50, 130);
  b.label('PINE TRAIL', 45, 128.6, 14, MINT, WEST);
  b.arrow(42, 128.5, WEST);
  b.carve(5, 127, 44, 130, F.DIRT);                                            // F1 west
  b.carve(5, 127, 8, 143, F.DIRT);                                             // F2 south
  b.carve(5, 140, 52, 143, F.DIRT);                                            // F3 east (the fork)
  b.carve(20, 134, 27, 139, F.GRASS);                                          // hunters' blind (dead end)
  b.carve(49, 140, 52, 154, F.DIRT);                                           // F4 south
  b.carve(16, 151, 52, 154, F.DIRT);                                           // F5 west
  b.carve(36, 155, 39, 160, F.GRASS);                                          // fern hollow (dead end)
  b.carve(16, 151, 19, 157, F.DIRT);                                           // F6 south to the cabin
  // A few bulges so the trail doesn't read as a corridor.
  for (const [x0, z0, x1, z1] of [[12, 126, 15, 126], [5, 133, 4, 136], [14, 144, 18, 144], [34, 139, 38, 139], [53, 146, 53, 149], [42, 150, 45, 150], [24, 155, 28, 155]]) b.carve(x0, z0, x1, z1, F.GRASS);
  dress(9, 127, 38, 130, 11); dress(5, 131, 8, 139, 12); dress(9, 140, 48, 143, 13); dress(49, 144, 52, 150, 14); dress(20, 151, 48, 154, 15);
  b.prop('pine', 21, 135); b.prop('pallet', 25, 135, 2, 1); b.prop('bush', 20, 139);
  b.pick('rifle', 23, 137); b.pick('ammo', 26, 138); b.pick('medkit', 22, 134);
  b.label("HUNTERS' BLIND", 23.5, 136.6, 9, CREAM, 0);
  b.label('slippers', 29, 141.2, 10, LAV, E); zz(31, 141.5, E); zz(34, 142, E); zz(38, 141.5, E);   // the slipper pile at the fork
  b.prop('rock', 37, 156); b.prop('bush', 39, 159);
  b.pick('ammo', 38, 158); b.pick('medkit', 36, 160); b.pick('firebomb', 37, 160);   // off-route reward
  b.label('FERNS', 37.5, 157.5, 9, MINT, 0);
  for (const [x, z] of [[7, 128.5], [28, 141.5], [50.5, 147], [18, 152.5]]) b.lamp(x, z);
  b.arrow(6.5, 132, S); b.arrow(24, 141.5, E); b.arrow(50.5, 144, S); b.arrow(44, 152.5, WEST); b.arrow(17.5, 155, S);
  zz(6.5, 136, S); zz(50.5, 150, S); zz(30, 152.5, WEST);
  b.pick('ammo', 7, 141); b.pick('ammo', 50, 153);

  // ------------------------------------------------------------------
  // 10. The ranger cabin (checkpoint, the reunion)
  // ------------------------------------------------------------------
  b.carve(6, 157, 30, 163, F.GRASS);
  b.prop('pine', 7, 158); b.prop('pine', 29, 158); b.prop('rock', 26, 161); b.prop('bench', 9, 162, 2, 1);
  b.label('PINECONE HILL RANGER STATION', 16.5, 159.5, 11, MINT, 0);
  b.lamp(13, 162.6); b.lamp(20, 162.6);
  b.arrow(16.5, 161, S);
  b.carve(15, 164, 17, 164, F.WOOD);
  const cabinDoor = b.door(15, 164, 17, 164, 'shutter', 'RANGER CABIN');
  b.carve(10, 165, 22, 173, F.SAFE);
  b.prop('gen', 10, 165); b.label('WOOD STOVE', 11, 167, 8, PEACH);
  b.prop('desk', 20, 165, 2, 1); b.prop('shelf', 22, 165, 1, 1);
  b.prop('bed', 10, 171, 2, 1); b.prop('bench', 13, 173, 4, 1);
  b.note(19, 166, 'Ranger cabin logbook', '3:10 a.m. Fog never reached the hill. 3:40 a lady in a lab coat ran up the trail with a hard drive and a sandwich. Said she\'s "fixing it". Gave her the transmitter key.');
  b.label('VALLEY MAP', 16.5, 165.6, 10, MINT);
  for (const x of [18, 19, 20, 21]) b.pick('medkit', x, 173);
  b.pick('ammo', 10, 169); b.pick('ammo', 11, 169); b.pick('ammo', 12, 169); b.pick('ammo', 12, 165);
  b.pick('smg', 12, 171); b.pick('shotgun', 13, 171); b.pick('rifle', 14, 171); b.pick('deagle', 15, 171); b.pick('autoshotgun', 13, 170); b.pick('launcher', 14, 170); b.pick('magnum', 12, 170);
  b.pick('armor', 17, 173); b.pick('armor', 22, 173); b.pick('bat', 15, 170); b.pick('machete', 16, 171); b.pick('firebomb', 13, 169); b.pick('rattle', 13, 165);   // last stop before the finale
  const cabinLatch = b.obj('lever', 22, 172, 'Unlatch the cabin back door');
  b.label('SAFE ROOM', 16.5, 169.4, 20, RED); b.label('RANGER CABIN', 16.5, 171.6, 10, MINT);
  b.lamp(16.5, 168);
  const cabinBack = b.door(23, 168, 23, 170, 'shutter', 'HILL TRAIL');

  // ------------------------------------------------------------------
  // 11. Pinecone Hill. The foot of the hill (H1, H2) is on the ground; the HILL STEPS climb to
  //     storey 1, the rock shelf the switchbacks (H3-H5), the fire road and the hilltop sit on.
  // ------------------------------------------------------------------
  b.walls(54, 115, 110, 178, WALL.ROCK, 6.8); b.walls(24, 164, 53, 178, WALL.ROCK, 6.8);
  b.walls(100, 115, 158, 163, WALL.ROCK, 6.8);                                // the hilltop's cliffs over the creek, river and Bridge Park
  b.walls(9, 164, 23, 174, WALL.BUILDING, 4.6);                               // the cabin (log walls)
  // Storey 0: the foot of the hill.
  b.carve(24, 167, 84, 170, F.DIRT);                                           // H1 east along the foot of the hill
  b.carve(81, 159, 84, 170, F.DIRT);                                           // H2 north to the steps
  for (const [x0, z0, x1, z1] of [[40, 166, 44, 166], [66, 171, 70, 171], [85, 160, 85, 163]]) b.carve(x0, z0, x1, z1, F.GRASS);
  b.stairs(81, 156, 84, 158, '-z');                                            // HILL STEPS: 4 wide, up onto the rock shelf
  dress(26, 167, 34, 170, 21, ['rock', 'rock', 'pine', 'bush']); dress(81, 162, 84, 166, 22, ['rock', 'pine']);
  b.prop('pine', 74, 167); b.prop('rock', 77, 170);
  b.label('PINECONE HILL TRAIL', 30, 168.6, 12, MINT, E); b.label('TRANSMITTER 1.2 km', 40, 169.6, 9, CREAM, E);
  b.label('SWITCHBACK', 82.5, 163, 10, CREAM, S); b.label('HILL STEPS', 82.5, 160.2, 12, GOLD, S);
  b.pick('ammo', 75, 168);
  for (const [x, z] of [[24.5, 168], [68.5, 170.4], [82.5, 168], [85.5, 160.6]]) b.lamp(x, z);
  b.arrow(30, 168.5, E); b.arrow(72, 168.5, E); b.arrow(82.5, 165, N); b.arrow(82.5, 161, N);
  zz(78, 168.5, E); zz(82.5, 163.5, N);

  // ------------------------------------------------------------------
  // 11b. The lower woods. A rockslide (4 a.m.) buries the middle of the hill trail, so the old
  //      logging road drops south through dark pines (flashlights) to the logging camp (an open
  //      fight round log stacks, the tight bunkhouse), over the PINECONE DAM (a storey-1 deck, a
  //      long 3-wide chokepoint: reservoir on one side, spillway on the other, rifle sightlines across
  //      the water) and back north up the old flume path along the far shore to the hill steps.
  // ------------------------------------------------------------------
  b.fill(45, 166, 65, 171);                                                    // the rockslide
  b.prop('rock', 44, 167); b.prop('rock', 44, 170); b.prop('rock', 66, 167); b.prop('rock', 66, 168);
  b.label('ROCKSLIDE', 42.4, 168.5, 14, RED, E); b.label('OLD LOGGING ROAD', 37.5, 172.6, 10, CREAM, N);
  b.arrow(37.5, 170, S);
  // The old logging road: south, a dogleg east, south again to the camp gate.
  b.carve(36, 171, 39, 189, F.DIRT);                                           // LR1 south
  b.carve(28, 179, 35, 184, F.GRASS);                                          // woodcutter's lean-to (dead end)
  b.carve(36, 186, 53, 189, F.DIRT);                                           // LR2 east
  b.carve(50, 186, 53, 197, F.DIRT);                                           // LR3 south to the camp gate
  dress(36, 172, 39, 177, 31, ['pine', 'bush', 'rock']); dress(40, 186, 49, 189, 32); dress(50, 190, 53, 197, 33, ['pine', 'rock']);
  b.prop('pallet', 29, 180, 2, 1); b.prop('crate', 28, 183); b.prop('pine', 33, 179);
  b.pick('magnum', 30, 182); b.pick('ammo', 31, 184);                          // off-route reward
  b.label("WOODCUTTER'S LEAN-TO", 32, 181.6, 8, CREAM, WEST);
  b.lamp(37.5, 180); b.lamp(51.5, 193);
  b.arrow(37.5, 184, S); b.arrow(44, 187.5, E); b.arrow(51.5, 191, S);
  zz(37.5, 176, N); zz(47, 187.5, E); zz(51.5, 195, N);
  // The logging camp: a clearing with the bunkhouse, log stacks, the log truck and the cookhouse tent.
  // Its east edge is the reservoir shore: you can see the flume path across the water.
  b.carve(26, 198, 62, 222, F.DIRT);
  b.paint(26, 198, 62, 198, F.GRASS); b.paint(26, 222, 62, 222, F.GRASS);
  b.fill(28, 201, 40, 209); b.walls(28, 201, 40, 209, WALL.BUILDING, 4.6);
  b.carve(29, 202, 39, 208, F.WOOD); b.carve(40, 204, 40, 205, F.WOOD); b.carve(33, 209, 34, 209, F.WOOD);
  for (const x of [29, 31, 35, 37]) b.prop('bed', x, 202, 1, 2);
  b.prop('desk', 31, 206, 3, 1); b.prop('gen', 39, 208); b.prop('shelf', 29, 208);
  b.note(35, 206, "Foreman's chalkboard", 'CREW BUS to the Sweet Dreams fog party in town, 10 p.m. Free pillows! Back by 6 for first shift. Harlow');
  b.pick('shotgun', 30, 205); b.pick('ammo', 38, 206); b.pick('medkit', 36, 205);
  b.label('BUNKHOUSE', 34, 204.4, 10, CREAM); b.lamp(34, 205);
  const LOGS = 0x9a6a44;
  b.prop('tank', 44, 201, 6, 1, { color: LOGS }); b.prop('tank', 44, 204, 6, 1, { color: LOGS }); b.prop('tank', 57, 201, 1, 6, { color: LOGS });
  b.prop('tank', 44, 214, 6, 1, { color: LOGS }); b.prop('tank', 29, 213, 1, 6, { color: LOGS });
  b.prop('truck', 51, 208, 2, 6, { color: 0x6b8f5a });                          // the log truck
  b.prop('container', 35, 215, 4, 3, { color: 0x9ad4b0 });                      // cookhouse tent
  b.prop('barrier', 46, 210, 2, 1); b.prop('crate', 58, 216); b.prop('barrel', 42, 208);
  for (const [x, z] of [[27, 199], [61, 199], [27, 221], [61, 221]]) b.prop('pine', x, z);
  billboard(61, 208, 1, 5, 59.6, 210.5, WEST);
  b.pick('ammo', 47, 202); b.pick('medkit', 56, 219); b.pick('firebomb', 41, 219); b.pick('ammo', 33, 220);
  b.label('PINECONE LOGGING CAMP', 44, 199.6, 14, MINT, N); b.label('COOKHOUSE', 37, 218.6, 9, CREAM, N);
  for (const [x, z] of [[45, 199.5], [33, 211], [50, 216], [42, 222.6]]) b.lamp(x, z);
  b.arrow(51.5, 199, S); b.arrow(48, 212, S); b.arrow(42, 221, S);
  zz(50, 205, N); zz(45, 218, N);
  // The reservoir (east of the camp) and the spillway below the dam: see-through water.
  b.carve(63, 194, 77, 236, F.WATER); b.carve(54, 224, 62, 236, F.WATER);
  b.carve(54, 240, 76, 245, F.WATER);
  b.label('PINECONE RESERVOIR', 70, 212, 16, SKY, N); b.label('SPILLWAY', 65, 243, 10, SKY, E);
  // West forecourt with the dam keeper's hut, the dam (its concrete body under the deck), the flights.
  b.carve(40, 223, 44, 229, F.DIRT);                                           // camp south exit
  b.carve(34, 230, 50, 244, F.DIRT);
  b.fill(34, 239, 40, 244); b.walls(34, 239, 40, 244, WALL.BUILDING, 3.6);
  b.carve(35, 240, 39, 243, F.WOOD); b.carve(40, 241, 40, 242, F.WOOD);
  b.prop('desk', 35, 243, 2, 1); b.prop('bed', 39, 240, 1, 2);
  b.note(36, 240, "Dam keeper's log", '4:10 a.m. Rockslide on the hill trail, heard it from here. 4:30 sleepers on the far shore, humming at the water. Kept the door shut. Kept the kettle on.');
  b.pick('ammo', 38, 243); b.pick('medkit', 37, 241);
  b.label('DAM KEEPER', 42.4, 241.5, 9, CREAM, WEST); b.lamp(42.4, 239.6);
  b.prop('barrier', 46, 233, 2, 1); b.prop('pine', 34, 231); b.prop('rock', 49, 243);
  b.walls(54, 237, 76, 239, WALL.BUILDING, 8);                                 // the dam body (clamped under the deck)
  b.stairs(51, 237, 53, 239, '+x');                                            // up onto the dam deck
  b.stairs(77, 237, 79, 239, '-x');                                            // down to the east forecourt
  b.label('PINECONE DAM', 47, 235.6, 12, SKY, N);
  b.lamp(45, 231); b.lamp(49.6, 236.4);
  b.arrow(44, 232, S); b.arrow(48, 238, E);
  b.level(1);
  b.carve(54, 237, 76, 239, F.CONCRETE);                                       // the deck: 23 x 3, air both sides
  b.prop('barrel', 59, 237); b.prop('crate', 66, 239); b.prop('barrel', 72, 237);
  b.pick('ammo', 69, 238);
  b.label('PINECONE DAM', 64, 238.5, 14, SKY, E); b.label('NO DIVING', 57, 238.5, 9, RED, E);
  for (const x of [56, 64, 74]) b.lamp(x, 238.5);
  b.arrow(61, 238.5, E);
  b.level(0);
  // East forecourt and the old flume path north along the far shore, then west round the head of the
  // reservoir and north into the hill trail beyond the rockslide.
  b.carve(80, 231, 85, 244, F.DIRT);
  b.prop('rock', 85, 243); b.prop('pine', 84, 232);
  b.carve(78, 194, 78, 230, F.GRASS);                                          // the shore
  b.carve(79, 190, 83, 230, F.DIRT);                                           // flume path
  b.carve(66, 186, 83, 190, F.DIRT);                                           // round the head of the reservoir
  b.carve(66, 171, 71, 185, F.DIRT);                                           // north to the hill trail
  b.carve(84, 205, 86, 211, F.GRASS);                                          // fishing spot (pocket)
  b.prop('bench', 86, 207, 1, 2); b.pick('ammo', 85, 206); b.pick('firebomb', 85, 210);
  for (const z of [196, 203, 214, 222]) b.prop('barrier', 83, z, 1, 3);        // the broken wooden flume
  dress(68, 186, 80, 190, 34, ['pine', 'bush', 'rock']); dress(66, 174, 71, 183, 35, ['pine', 'rock']);
  b.label('OLD FLUME', 81, 200, 10, CREAM, S); b.label('FISHING SPOT', 84.6, 208.5, 8, SKY, E);
  for (const [x, z] of [[80.6, 229], [80.6, 214], [80.6, 199], [74, 188.4], [68.5, 180]]) b.lamp(x, z);
  b.arrow(82.5, 233, N); b.arrow(80.5, 220, N); b.arrow(80.5, 200, N); b.arrow(76, 188, WEST); b.arrow(68.5, 184, N); b.arrow(68.5, 173, N);
  zz(80.5, 226, S); zz(80.5, 208, S); zz(72, 188, WEST); zz(68.5, 178, S);
  b.pick('medkit', 82, 236);
  // Storey 1: the switchbacks and the fire road on the shelf (long uphill sightlines).
  b.level(1);
  b.carve(58, 152, 84, 155, F.DIRT);                                           // H3 west from the top of the steps
  b.carve(58, 133, 61, 155, F.DIRT);                                           // H4 north
  b.carve(58, 133, 104, 136, F.DIRT);                                          // H5 east to the hilltop
  b.carve(62, 118, 65, 132, F.DIRT); b.carve(62, 118, 100, 121, F.GRASS);      // fire road (loop to the hilltop)
  for (const [x0, z0, x1, z1] of [[70, 151, 73, 151], [57, 142, 57, 145], [80, 137, 84, 137], [86, 117, 90, 117]]) b.carve(x0, z0, x1, z1, F.GRASS);
  dress(62, 152, 78, 155, 23, ['rock', 'bush', 'pine']); dress(58, 138, 61, 150, 24, ['rock', 'pine']);
  dress(66, 133, 96, 136, 25, ['rock', 'pine', 'bush']); dress(66, 118, 77, 121, 26, ['pine', 'tree', 'bush']); dress(84, 118, 96, 121, 27, ['pine', 'tree', 'bush']);
  b.label('STEEP', 70, 153.6, 10, PEACH, WEST);
  b.label('FIRE ROAD', 63.5, 126, 10, CREAM, N); b.label('LOOKOUT LOOP', 70, 119.6, 10, CREAM, E);
  b.pick('medkit', 83, 153); b.pick('ammo', 59, 146); b.pick('rifle', 60, 146); b.pick('ammo', 82, 135); b.pick('medkit', 64, 119);
  for (const [x, z] of [[82.5, 154], [59.5, 154], [59.5, 136], [80, 134.6]]) b.lamp(x, z);
  b.arrow(78, 153.5, WEST); b.arrow(59.5, 148, N); b.arrow(66, 134.5, E); b.arrow(90, 134.5, E);
  zz(64, 153.5, WEST); zz(59.5, 140, N); zz(76, 134.5, E);
  // The fire lookout: a timber tower on the fire road, one ladder up to a roofed cab (storey 2).
  // Optional perch: from the cab a rifle sees over the rocks to the transmitter compound.
  b.fill(80, 123, 83, 126);                                                    // the tower's timber base
  b.ladder(81, 122, '+z', F.WOOD);
  b.label('FIRE LOOKOUT', 81.5, 120.6, 10, GOLD, N); b.label('LADDER', 81.5, 121.6, 8, CREAM, N);
  b.lamp(79.6, 121.6);
  b.level(2);
  b.carve(80, 123, 83, 126, F.WOOD);
  b.prop('desk', 83, 126); b.prop('bench', 80, 126, 1, 1);
  b.pick('rifle', 82, 125); b.pick('ammo', 80, 124); b.pick('ammo', 81, 126); b.pick('medkit', 83, 124);
  b.label('FIRE LOOKOUT', 81.5, 124.4, 9, GOLD, 0); b.label('FIRE DANGER: LOW', 81.5, 125.4, 7, CREAM, 0);
  b.lamp(81.5, 124);
  b.level(0);

  // ------------------------------------------------------------------
  // 12. The hilltop (storey 1): transmitter compound, the control shed with Wren locked inside,
  //     and on the shed roof the TRANSMITTER DECK (storey 2) round the foot of the mast, where
  //     the Bell is rung (crescendo 2). The horde comes up the deck stairs and two ladders.
  // ------------------------------------------------------------------
  b.level(1);
  b.carve(104, 117, 158, 146, F.GRASS); b.carve(100, 118, 103, 136, F.GRASS);
  b.paint(101, 133, 110, 136, F.DIRT);
  // Compound fence (gaps west, north and east), concrete yard.
  b.fill(110, 122, 110, 146); b.fill(146, 122, 146, 146); b.fill(110, 122, 146, 122);
  b.walls(110, 122, 146, 122, WALL.FENCE, 2.6); b.walls(110, 122, 110, 146, WALL.FENCE, 2.6); b.walls(146, 122, 146, 146, WALL.FENCE, 2.6);
  b.paint(111, 123, 145, 146, F.CONCRETE);
  b.carve(110, 132, 110, 137, F.DIRT); b.carve(125, 122, 130, 122, F.DIRT); b.carve(146, 130, 146, 134, F.DIRT);
  b.label('PINECONE HILL TRANSMITTER', 118, 131.2, 12, GOLD, 0); b.label('AUTHORISED PERSONNEL ONLY', 113, 138.6, 8, RED, E);
  // Guy-wire anchors for the mast in the yard.
  for (const [x, z] of [[127, 129], [143, 129], [119, 145]]) b.prop('beacon', x, z);
  // Control shed: an outer room (doors west and north) and Wren's locked room behind the window.
  b.fill(130, 134, 143, 146);
  b.carve(131, 135, 137, 145, F.INTERIOR);
  b.carve(130, 137, 130, 139, F.INTERIOR); b.carve(132, 134, 134, 134, F.INTERIOR);
  b.prop('battery', 131, 145); b.prop('battery', 132, 145); b.prop('gen', 137, 145); b.prop('desk', 137, 136, 1, 2);
  b.note(137, 141, 'Taped inside the shed window', 'Mum, if you\'re reading this, I\'m fine. I\'ll ring it every morning until I know how to wake them. Save me a seat on the No. 9. W');
  b.label('REINFORCED WINDOW', 136.6, 141.8, 8, SKY, WEST); b.label('WREN ♥', 136.6, 143.6, 10, PINK, WEST);
  b.label('CONTROL SHED', 128.4, 138, 10, CREAM, WEST);
  b.lamp(133.5, 140); b.lamp(128.5, 136.5);
  b.pick('ammo', 133, 144); b.pick('ammo', 134, 145); b.pick('medkit', 134, 136); b.pick('medkit', 135, 136);
  b.pick('shotgun', 131, 136); b.pick('launcher', 132, 137); b.pick('autoshotgun', 131, 138);
  // The way up: a steel stair flight from the west yard (2 wide, cheek walls both sides), and two
  // ladders up the north and east walls of the shed.
  b.fill(127, 141, 129, 141); b.fill(127, 144, 129, 144);
  b.stairs(127, 142, 129, 143, '+x');
  b.ladder(140, 133, '+z');
  b.ladder(144, 140, '-x');
  b.label('TRANSMITTER DECK', 124.6, 142.5, 10, GOLD, E); b.label('STAIRS UP', 125.8, 142.5, 8, CREAM, E);
  b.label('LADDER', 140.5, 131.8, 8, CREAM, 0); b.label('LADDER', 145.4, 140.5, 8, CREAM, WEST);
  b.arrow(123.5, 142.5, E);
  // Cover in the yard: cable drums, sandbags, the ranger pickup.
  b.prop('truck', 115, 139, 2, 5, { color: 0x6f9a6a }); b.prop('barrel', 121, 126); b.prop('barrel', 124, 140);
  b.prop('barrier', 120, 136, 1, 3); b.prop('barrier', 125, 131, 3, 1); b.prop('crate', 141, 130); b.prop('crate', 116, 125);
  b.prop('pallet', 121, 144, 2, 1);
  b.pick('ammo', 120, 140); b.pick('ammo', 121, 140); b.pick('ammo', 142, 125); b.pick('ammo', 142, 126);
  b.pick('medkit', 112, 145); b.pick('rifle', 118, 124);
  for (const [x, z] of [[113, 126], [113, 143], [123, 125], [143, 126], [145, 144], [125.5, 137]]) b.lamp(x, z);
  b.arrow(106, 134.5, E); b.arrow(118, 134.5, E);
  // Outer ring: boulders and pines (spawn cover on three sides), the river lookout on the cliff edge.
  for (const [x, z] of [[105, 121], [106, 129], [107, 141], [118, 118], [133, 119], [150, 121], [149, 131], [151, 139], [143, 119], [124, 119]]) b.prop(hash2(x, z) < 0.5 ? 'pine' : 'rock', x, z);
  b.prop('bench', 156, 131, 1, 3); b.prop('barrier', 158, 125, 1, 4);
  b.label('LOOKOUT', 154, 130, 12, SKY, E); b.label('OLD BRIDGE: SOUTH', 154, 140, 10, CREAM, 0);
  b.pick('ammo', 155, 144); b.pick('medkit', 157, 120);
  b.lamp(154, 136); b.lamp(104, 125);
  b.carve(124, 147, 128, 147, F.ASPHALT);
  const compoundGate = b.door(124, 147, 128, 147, 'fence', 'COMPOUND GATE');
  // Storey 2: the transmitter deck on the shed roof, the mast rising from its middle.
  b.level(2);
  b.carve(130, 134, 143, 146, F.CONCRETE);
  b.prop('pillar', 136, 138, 2, 2, { color: 0xd8dde8 });                      // the mast
  for (const [x, z] of [[134, 136], [139, 136]]) b.prop('beacon', x, z);      // guy-wire collars
  const bellConsole = b.obj('terminal', 134, 141, 'Plug in the batteries and RING THE BELL');
  b.prop('battery', 133, 143); b.prop('battery', 134, 143);                   // where the car batteries go
  // Deck cover: cable drums and sandbags, imperfect on purpose (every route has a firing lane).
  b.prop('barrier', 132, 139, 1, 2); b.prop('crate', 140, 144); b.prop('barrel', 141, 137); b.prop('barrier', 138, 142, 2, 1);
  b.pick('ammo', 135, 144); b.pick('ammo', 136, 144); b.pick('ammo', 141, 141); b.pick('medkit', 131, 145); b.pick('rattle', 133, 145);
  b.label('MORNING BELL', 134.5, 140.2, 12, GOLD, WEST); b.label('MAST 1 kW', 137, 141.4, 10, GOLD, 0);
  b.label('( ( (   ) ) )', 137, 137.2, 18, GOLD, 0); b.label('TRANSMITTER DECK', 137, 145.4, 10, CREAM, 0);
  for (const [x, z] of [[131, 135], [142.6, 135], [131, 145.6], [142.6, 145.6]]) b.lamp(x, z);
  b.level(0);

  // ------------------------------------------------------------------
  // 13. The downhill road at sunrise: sleepers curled up on the verges (quiet beat). The road runs
  //     along the shelf (storey 1), then the OLD STONE STEPS drop it to the valley floor, where the
  //     convoy's tail truck lies jackknifed across the bridge road.
  // ------------------------------------------------------------------
  b.level(1);
  b.carve(123, 148, 129, 162, F.GRASS); b.carve(124, 148, 128, 161, F.ASPHALT);
  b.carve(91, 156, 129, 162, F.GRASS); b.carve(92, 157, 128, 161, F.ASPHALT);
  b.label('HILL ROAD', 126, 152, 12, PEACH, 0); b.label('SLOW: SLEEPERS', 110, 159, 11, GOLD, E);
  b.label('STONE STEPS', 94, 161.4, 11, GOLD, N);
  sleeper(123, 151, 1, 2); sleeper(123, 155, 1, 2); sleeper(117, 162, 2, 1); sleeper(104, 162, 2, 1); sleeper(99, 162, 2, 1);
  b.prop('car', 110, 158, 2, 1, { color: CARS[2], rot: E + 0.2 }); b.prop('bush', 123, 161); b.prop('tree', 91, 158);
  b.prop('pine', 129, 149);
  b.pick('ammo', 126, 157); b.pick('medkit', 94, 159);
  for (const [x, z] of [[129.6, 152], [113, 156.4], [97.6, 160]]) b.lamp(x, z);
  b.arrow(126, 156, S); b.arrow(100, 159, WEST); b.arrow(94, 160.6, S);
  zz(126, 150, S); zz(96, 159, WEST);
  b.level(0);
  b.stairs(92, 163, 96, 165, '-z');                                            // the old stone steps down (5 wide)
  b.carve(91, 166, 97, 177, F.GRASS); b.carve(92, 166, 96, 176, F.ASPHALT);
  b.carve(91, 171, 132, 177, F.GRASS); b.carve(92, 172, 132, 176, F.ASPHALT);
  b.label('OLD BRIDGE 400 m', 94, 168, 11, CREAM, N); b.label('SUNRISE', 114, 174, 14, PEACH, E);
  sleeper(91, 167, 1, 2); sleeper(91, 173, 1, 2); sleeper(103, 177, 2, 1); sleeper(112, 177, 2, 1); sleeper(120, 177, 2, 1);
  b.prop('pine', 97, 177); b.prop('tree', 108, 171);
  // The convoy's tail truck, jackknifed right across the bridge road (both verges): the detour.
  b.prop('truck', 99, 171, 2, 7, { color: ARMY });
  b.label('ROAD BLOCKED', 97.6, 174, 10, RED, E); b.label('DETOUR', 94, 177.6, 14, GOLD, N);
  // Pell's empty limo on the verge just before the bridge (the plaza side of the truck).
  b.prop('car', 126, 177, 3, 1, { color: WHITE });
  b.note(129, 176, 'Back seat of the white limo', 'Gift tag: "G. Pell, Executive Rest Kit: silk eye mask, HX-9 Pillow Mist (complimentary)." The kit is open. The limo is empty.');
  b.label('PELL 1', 127.5, 175.4, 9, CREAM, E);
  b.pick('ammo', 94, 174);
  for (const [x, z] of [[91.4, 170], [106, 177.6], [120, 171.4]]) b.lamp(x, z);
  b.arrow(94, 170, S); b.arrow(94, 175.5, S);
  // The Bridge Diner on the plaza side of the truck: a car park and a diner under the shelf. With the
  // road stub it is the west approach into the finale arena (hidden ground for the horde).
  b.carve(113, 164, 131, 170, F.ASPHALT);
  b.walls(104, 164, 112, 170, WALL.BUILDING, 5.5);
  b.carve(105, 165, 111, 169, F.TILES); b.carve(112, 166, 112, 168, F.TILES); b.carve(105, 170, 106, 170, F.TILES);
  b.prop('counter', 107, 165, 4, 1, { color: 0xf2e6d0 }); b.prop('bench', 109, 168, 2, 1); b.prop('bench', 105, 167, 1, 1);
  b.pick('ammo', 110, 166); b.pick('medkit', 108, 169);
  b.prop('car', 116, 165, 1, 2, { color: CARS[1] }); b.prop('car', 122, 165, 1, 2, { color: CARS[5] }); b.prop('car', 127, 168, 2, 1, { color: CARS[3] });
  b.prop('dumpster', 130, 164); b.prop('bush', 119, 170);
  b.label('BRIDGE DINER', 116, 167.5, 12, PEACH, WEST); b.label('PIE', 108, 167, 10, PINK);
  b.lamp(114, 164.6); b.lamp(125, 170.4); b.lamp(108, 167);

  // ------------------------------------------------------------------
  // 13b. The river flats: Mill Road south past Mill Row, the Pinecone Lumber Co. yard and sawmill,
  //      the Mallow River campground and its camp store, then Bridge Road north to the army field
  //      post. The Bell's chime doesn't carry down here: the sleepers on the flats are still up.
  //      The fuel sweep: a Mill Row garage, the sawmill office, the camp store.
  // ------------------------------------------------------------------
  b.carve(91, 178, 97, 244, F.GRASS); b.carve(92, 178, 96, 244, F.ASPHALT);
  b.carve(92, 240, 99, 244, F.ASPHALT);                                        // the bend into the yard gate
  b.label('MILL ROAD', 94, 186, 14, PEACH, N);
  for (let z = 192; z <= 232; z += 8) b.label('— —', 94, z, 16, '#f2e6c0', N);
  sleeper(97, 181, 1, 2); sleeper(91, 190, 1, 2);
  b.prop('car', 92, 199, 1, 2, { color: CARS[6] }); b.prop('car', 96, 214, 1, 2, { color: CARS[2], rot: 0.3 }); b.prop('barrier', 94, 221, 2, 1);
  for (const z of [186, 202, 218]) b.prop(z === 202 ? 'tree' : 'pine', 91, z);
  b.pick('ammo', 95, 207);
  for (const z of [184, 198, 212, 226, 240]) b.lamp(z === 198 ? 97.6 : 91.4, z);
  b.arrow(94, 182, S); b.arrow(94, 204, S); b.arrow(94, 226, S); b.arrow(97, 242, E);
  zz(94, 196, N); zz(94, 216, N); zz(94, 236, N);
  // Mill Row: two cottages on Mill Road's east side. The first has a lawnmower fuel can in its garage.
  const mill1 = lot(98, 180, 'W', { garage: true, car: CARS[4] });
  const mill2 = lot(98, 194, 'W', { walkIn: true, sideGap: true });
  { const [x, z] = mill1.P(8, 9); b.item('fuel', 'fuel', x, z, 'fuel can'); }
  { const [x, z] = mill1.mid(8, 4); b.label('MOWER FUEL', x, z, 8, CREAM, WEST); }
  { const [x, z] = mill2.P(3, 10); b.pick('medkit', x, z); }
  { const [x, z] = mill2.P(6, 18); b.pick('ammo', x, z); }
  { const [x, z] = mill1.P(6, 18); b.pick('smg', x, z); }
  { const [x, z] = mill1.mid(2, 2); b.label('MILL ROW', x, z, 10, PEACH, N); }
  // The Pinecone Lumber Co. yard: a fenced dirt yard (south-west gate off Mill Road, east gate to the
  // campground). South yard: lumber stacks. North yard: log stacks and the log loader (open, rifle
  // range). The sawmill shed in the middle (dark, saw line, tight: shotgun range) with the office in
  // its south-east corner.
  b.carve(100, 208, 134, 248, F.DIRT);
  b.fill(100, 208, 134, 208); b.fill(100, 248, 134, 248); b.fill(100, 208, 100, 248); b.fill(134, 208, 134, 248);
  b.walls(100, 208, 134, 248, WALL.FENCE, 2.6);
  b.carve(100, 240, 100, 244, F.ASPHALT);                                      // south-west gate
  b.carve(134, 236, 134, 240, F.DIRT);                                         // east gate
  b.label('PINECONE LUMBER CO.', 103.6, 242, 14, PEACH, E);
  b.fill(108, 220, 126, 236); b.walls(108, 220, 126, 236, WALL.BUILDING, 7);
  b.carve(109, 221, 125, 235, F.WOOD);
  b.carve(108, 227, 108, 230, F.WOOD); b.carve(126, 222, 126, 225, F.WOOD); b.carve(116, 220, 118, 220, F.WOOD);
  b.fill(120, 230, 125, 230); b.fill(120, 231, 120, 235); b.carve(120, 232, 120, 233, F.WOOD);   // the office
  b.prop('counter', 111, 222, 1, 6, { color: 0x8f93a8 });                        // the saw line conveyor
  b.prop('tank', 113, 224, 5, 1, { color: LOGS }); b.prop('desk', 115, 227, 2, 1); b.prop('pillar', 113, 230); b.prop('pillar', 117, 230);
  b.prop('shelf', 124, 221, 1, 3); b.prop('crate', 109, 234); b.prop('pallet', 116, 234, 2, 1);
  b.prop('desk', 123, 235, 2, 1); b.prop('shelf', 121, 231);
  b.note(122, 231, 'Sawmill office whiteboard', 'MON: Dreamwell order, 400 bed frames. TUE: Dreamwell order, 400 more. WED: who is buying all these beds??');
  b.item('fuel', 'fuel', 124, 233, 'fuel can');
  b.pick('shotgun', 110, 230); b.pick('ammo', 114, 233); b.pick('ammo', 121, 234);
  b.label('SAWMILL', 117, 218.6, 14, PEACH, N); b.label('OFFICE', 119.4, 232.5, 8, CREAM, E);
  b.lamp(114, 228); b.lamp(123, 233);
  // North yard.
  b.prop('tank', 103, 211, 6, 1, { color: LOGS }); b.prop('tank', 103, 214, 6, 1, { color: LOGS }); b.prop('tank', 112, 211, 1, 6, { color: LOGS });
  b.prop('truck', 124, 211, 2, 5, { color: 0xf2c14e });                         // the log loader
  b.prop('car', 118, 215, 1, 1, { color: 0xf2c14e }); b.prop('container', 128, 216, 4, 2, { color: 0xb07c4c });
  b.pick('ammo', 121, 213); b.pick('medkit', 131, 210); b.pick('launcher', 127, 213);
  b.label('LOG LOADER', 125, 217.4, 9, CREAM, N);
  // South yard: lumber stacks.
  b.prop('pallet', 103, 235, 3, 2); b.prop('crate', 110, 243, 2, 2); b.prop('pallet', 116, 239, 3, 2); b.prop('crate', 124, 244, 2, 2); b.prop('tank', 129, 241, 1, 5, { color: LOGS });
  b.pick('ammo', 107, 246);
  for (const [x, z] of [[103, 226.6], [130.6, 227], [112, 218.6], [130.6, 238], [104, 246.6], [101.4, 238]]) b.lamp(x, z);
  b.arrow(104, 240, N); b.arrow(105, 229, E); b.arrow(121, 232.5, E); b.arrow(130.5, 230, S); b.arrow(132, 238, E);
  zz(103, 236, N); zz(130.5, 234, N);
  // The Mallow River campground: tents, RVs and fire pits along the river, the bathhouse, the boat
  // ramp, and the camp store (fuel) at the south end. Bridge Road leaves it north to the field post.
  b.carve(135, 206, 158, 272, F.GRASS);
  b.paint(135, 236, 141, 240, F.DIRT); b.paint(141, 206, 145, 264, F.DIRT);    // camp lanes
  b.fill(138, 265, 148, 272); b.walls(138, 265, 148, 272, WALL.BUILDING, 4.4);
  b.carve(139, 266, 147, 271, F.INTERIOR); b.carve(142, 265, 144, 265, F.INTERIOR);
  b.prop('shelf', 139, 268, 3, 1, { color: 0x8fe3c0 }); b.prop('shelf', 139, 270, 3, 1, { color: 0xffb36b }); b.prop('counter', 147, 267, 1, 2, { color: 0xf2e6d0 });
  b.item('fuel', 'fuel', 146, 270, 'fuel can');
  b.pick('ammo', 140, 266); b.pick('rifle', 144, 271);
  b.prop('pillar', 140, 262, 1, 1, { color: 0xff5a5a }); b.prop('pillar', 146, 262, 1, 1, { color: 0xff5a5a });   // the fuel pumps
  b.label('CAMP STORE', 143, 263.6, 10, CREAM, N); b.label('GAS', 143, 261.6, 12, RED, N);
  b.lamp(143, 268); b.lamp(141.6, 263.6);
  // The south loop: lakeside cabins, the playground and the camp office.
  for (const [x, z, c] of [[136, 252, 2], [152, 254, 5], [136, 260, 4], [151, 262, 7]] as const) b.prop('container', x, z, 3, 2, { color: CARS[c] });   // camp cabins
  b.prop('beacon', 148, 250); b.prop('beacon', 150, 250); b.prop('barrier', 148, 252, 3, 1); b.prop('van', 154, 266, 2, 4, { color: 0xf4c6c0 });
  b.label('PLAYGROUND', 149.5, 248.6, 8, CREAM, N);
  b.pick('ammo', 139, 257); b.pick('medkit', 156, 259);
  b.lamp(138.6, 256); b.lamp(153, 258);
  b.arrow(143, 256, S); b.arrow(143, 252, N);
  b.fill(150, 207, 157, 213); b.walls(150, 207, 157, 213, WALL.BUILDING, 3.6);
  b.carve(151, 208, 156, 212, F.TILES); b.carve(150, 210, 150, 211, F.TILES);
  b.prop('counter', 156, 208, 1, 5, { color: 0xe8e0d8 }); b.pick('medkit', 152, 212); b.pick('ammo', 152, 208);
  b.label('BATHHOUSE', 148.6, 210.5, 8, CREAM, E);
  for (const [x, z, c] of [[137, 210, 0], [137, 220, 2], [147, 216, 4], [152, 222, 1], [137, 229, 5], [148, 229, 3], [152, 236, 6], [137, 243, 7], [149, 242, 0]] as const) b.prop('container', x, z, 2, 2, { color: CARS[c] });   // tents
  b.prop('van', 154, 244, 2, 4, { color: 0xf6ecd2 }); b.prop('van', 154, 214, 2, 4, { color: 0xc6d4f2 });   // RVs
  for (const [x, z] of [[140, 214], [151, 228], [140, 235]]) b.prop('barrel', x, z);   // fire pits
  b.prop('bench', 147, 210, 2, 1); b.prop('bench', 139, 224, 2, 1); b.prop('bench', 149, 234, 2, 1);
  for (const [x, z] of [[136, 207], [157, 230], [136, 249], [157, 252], [136, 271], [157, 271]]) b.prop('pine', x, z);
  b.paint(154, 236, 158, 240, F.CONCRETE); b.prop('barrier', 157, 235, 1, 1);
  b.label('BOAT RAMP', 156, 238, 10, SKY, E);
  billboard(157, 247, 1, 5, 155.4, 249.5, WEST);
  b.pick('ammo', 146, 221); b.pick('medkit', 139, 232); b.pick('firebomb', 151, 240);
  b.label('MALLOW RIVER CAMPGROUND', 141, 233.4, 11, MINT, E);
  for (const [x, z] of [[136, 238.6], [146, 226], [146, 212], [153, 240], [140, 244]]) b.lamp(x, z);
  b.arrow(138, 241, S); b.arrow(143, 244, S); b.arrow(143, 232, N); b.arrow(143, 218, N);
  zz(141, 238, E); zz(143, 225, S);
  // Bridge Road north to the army field post's back door.
  b.carve(138, 192, 148, 205, F.GRASS); b.carve(140, 192, 146, 205, F.ASPHALT);
  b.prop('barrier', 138, 193, 2, 1); b.prop('barrier', 147, 193, 2, 1); b.prop('car', 140, 199, 1, 2, { color: ARMY });
  b.label('BRIDGE ROAD', 143, 201, 12, PEACH, S);
  b.lamp(138.6, 196); b.lamp(147.4, 203);
  b.arrow(143, 207, N); b.arrow(144, 196, N);

  // ------------------------------------------------------------------
  // 13c. The army field post (checkpoint): the soldiers' block between Bridge Road and the plaza.
  //      In by the back door from Bridge Road; the generator by the east wall opens the front door
  //      onto the checkpoint plaza. Field orders on the desk explain the guns on the sandbags.
  // ------------------------------------------------------------------
  b.fill(136, 179, 150, 191); b.walls(136, 179, 150, 191, WALL.BUILDING, 4.6);
  b.carve(137, 180, 149, 190, F.SAFE);
  b.carve(142, 191, 144, 191, F.ASPHALT);
  const postDoor = b.door(142, 191, 144, 191, 'shutter', 'FIELD POST');
  b.carve(142, 179, 144, 179, F.SIDEWALK);
  const postExit = b.door(142, 179, 144, 179, 'shutter', 'CHECKPOINT');
  for (const z of [182, 185]) b.prop('bed', 137, z, 2, 1);                     // army cots
  b.prop('desk', 137, 188, 2, 1); b.prop('radio', 139, 188);
  b.prop('shelf', 149, 180, 1, 3, { color: ARMY }); b.prop('crate', 149, 189); b.prop('crate', 149, 190);
  const postGen = b.obj('gen', 149, 186, 'Fuel the generator');
  b.note(140, 189, 'Field orders, Bridge Post 9', 'Hold the bridge until the convoy is clear. 0430: convoy pulled back across the river. Guns stay on the sandbags for whoever comes next. Keep the generator fed. Sgt. Okafor');
  for (const x of [138, 139, 140, 141]) b.pick('medkit', x, 180);
  b.pick('ammo', 146, 181); b.pick('ammo', 147, 181); b.pick('ammo', 148, 181);
  b.pick('rifle', 146, 184); b.pick('autoshotgun', 147, 184); b.pick('smg', 146, 185); b.pick('shotgun', 147, 185); b.pick('launcher', 146, 188); b.pick('deagle', 147, 188);
  b.pick('armor', 140, 184); b.pick('armor', 140, 185); b.pick('machete', 141, 187); b.pick('firebomb', 145, 190); b.pick('rattle', 146, 190);   // the Big Hold On is next
  b.label('SAFE ROOM', 143, 183.4, 20, RED, S); b.label('ARMY FIELD POST', 143, 185.6, 11, OLIVE, S);
  b.label('GENERATOR', 147.6, 186.5, 8, GOLD, E);
  b.lamp(143, 186); b.lamp(139, 183);
  b.label('ARMY FIELD POST', 143, 193.6, 10, OLIVE, S);
  // The motor pool: a fenced bay east of the post, open to the plaza only (the south-east approach).
  b.carve(152, 179, 158, 190, F.ASPHALT);
  b.prop('car', 153, 182, 1, 2, { color: ARMY }); b.prop('truck', 156, 183, 2, 5, { color: ARMY }); b.prop('barrel', 152, 189); b.prop('crate', 158, 190);
  b.pick('ammo', 154, 189);
  b.label('MOTOR POOL', 155, 180.4, 10, OLIVE, S); b.lamp(152.6, 186);

  // ------------------------------------------------------------------
  // 14. The old bridge: the army checkpoint plaza, THE BIG HOLD ON. The soldiers left their guns on
  //     the sandbags: a Popcorn Gatling and a Thump Cannon in the nest by the boom control, a
  //     Fizzbang Pod on the watchtower roof (storey 1). The horde comes two ways (the step's spawn
  //     zones): out of Bridge Park (north: the Pod and the Cannon) and up the diner road (west: the
  //     Gatling). The post and the motor pool behind stay quiet. Cover is trucks and low sandbags.
  // ------------------------------------------------------------------
  b.carve(133, 164, 158, 178, F.ASPHALT);
  b.paint(133, 177, 158, 178, F.SIDEWALK);
  b.carve(134, 150, 155, 163, F.GRASS);                                        // Bridge Park (north entry)
  b.carve(154, 148, 158, 157, F.DIRT);                                         // weir landing
  b.carve(159, 150, 171, 151, F.CONCRETE);                                     // the old weir
  b.carve(164, 150, 166, 151, F.WATER);                                        // ...washed out mid-river: the bridge is the only way over
  b.carve(172, 118, 178, 178, F.DIRT);                                         // far bank river road
  b.label('OLD WEIR', 161.5, 149.4, 10, SKY, E); b.label('WASHED OUT', 167.5, 152.6, 9, RED, E); b.label('BRIDGE PARK', 144, 152, 12, MINT, 0);
  // Park: picnic benches, pines (cover; the far bank shambles in from here).
  for (const [x, z] of [[138, 154], [146, 157], [140, 160]]) b.prop('bench', x, z, 2, 1);
  for (const [x, z] of [[135, 151], [150, 152], [152, 160], [143, 151], [136, 162], [147, 161]]) b.prop(hash2(x, z) < 0.5 ? 'pine' : 'tree', x, z);
  b.pick('ammo', 148, 155);
  // Army checkpoint: trucks, sandbag lines, the nest round the boom gate control.
  b.prop('truck', 139, 164, 5, 2, { color: ARMY }); b.prop('truck', 134, 176, 5, 2, { color: ARMY });
  b.prop('container', 155, 173, 3, 2, { color: 0x7a8a52 });                    // supply tent
  b.prop('barrier', 145, 166, 1, 5); b.prop('barrier', 147, 173, 3, 1); b.prop('barrier', 153, 167, 1, 2);   // the nest
  b.prop('barrier', 138, 169, 1, 3); b.prop('barrier', 149, 176, 4, 1); b.prop('crate', 137, 167); b.prop('crate', 144, 159);
  b.prop('barrel', 157, 176);
  const boomLever = b.obj('lever', 153, 164, 'Raise the army boom gate');   // the control box at the foot of the bridge ramp
  b.mount('minigun', 147, 168, '-x');                                         // Popcorn Gatling: the plaza and the diner road
  b.mount('cannon', 151, 171, '-z');                                          // Thump Cannon: Bridge Park and the boom gate
  b.pick('ammo', 149, 166); b.pick('ammo', 150, 166); b.pick('ammo', 136, 172); b.pick('ammo', 136, 173); b.pick('ammo', 154, 176);
  b.pick('medkit', 141, 174); b.pick('medkit', 152, 169); b.pick('rifle', 137, 170); b.pick('autoshotgun', 136, 170); b.pick('launcher', 144, 172);
  b.pick('rattle', 143, 167); b.pick('firebomb', 154, 170);      // for the Big Hold On
  b.label('ARMY CHECKPOINT', 143, 174.6, 14, OLIVE, 0); b.label('CONVOY ASSEMBLY', 143, 176.2, 9, CREAM, 0);
  b.label('ARMY NEST', 149.5, 165.6, 9, OLIVE, 0);
  for (const [x, z] of [[138, 164.4], [144, 164.4], [152, 166], [157.6, 172], [138, 177.6], [150, 177.6], [134, 156], [154, 152], [147, 171]]) b.lamp(x, z);
  b.arrow(143, 177.6, N); b.arrow(151.5, 174.6, N);
  // The watchtower: a sandbagged block in the plaza's north-west corner, a ladder on its east and
  // south faces (so it is never a one-way cheese spot), the Fizzbang Pod on its roof over Bridge Park.
  b.fill(133, 164, 136, 167); b.walls(133, 164, 136, 167, WALL.BUILDING, STOREY);
  b.ladder(137, 165, '-x'); b.ladder(134, 168, '-z');
  b.label('WATCHTOWER', 134.5, 169.4, 9, OLIVE, 0); b.label('LADDER', 138.2, 165.5, 7, CREAM, WEST);
  b.level(1);
  b.carve(133, 164, 136, 167, F.CONCRETE);
  b.prop('barrier', 133, 164, 1, 1); b.prop('crate', 136, 164);
  b.mount('rockets', 134, 165, '-z');                                          // Fizzbang Pod: Bridge Park
  b.pick('rifle', 133, 167); b.pick('ammo', 135, 167); b.pick('ammo', 133, 166);
  b.label('WATCHTOWER', 135.5, 166.4, 8, OLIVE, 0);
  b.lamp(133.4, 165.5);
  b.level(0);
  // The old bridge: a deck one storey over the river (railings both sides), a ramp up from the plaza
  // and one down to the far bank's river road. The army boom gate bars the deck at its west end;
  // Dot's No. 9 is parked mid-span, nose to the far bank.
  b.label('MALLOW RIVER', 165, 158, 14, SKY, E);
  b.stairs(155, 164, 158, 171, '+x');                                          // plaza ramp, 8 wide
  b.stairs(172, 164, 175, 171, '-x');                                          // far-bank ramp
  b.label('OLD BRIDGE', 156.5, 167.5, 12, PEACH, E);
  b.level(1);
  b.carve(159, 164, 171, 171, F.ASPHALT);
  for (let x = 162; x <= 170; x += 4) b.label('— —', x, 165, 14, '#f2e6c0', E);
  const boomGate = b.door(160, 164, 160, 171, 'boom', 'ARMY BOOM GATE');
  b.label('BOOM GATE', 159.5, 167.5, 9, GOLD, E);
  b.fill(162, 166, 168, 169); b.walls(162, 166, 168, 169, WALL.BUILDING, 3.1);
  b.carve(163, 167, 167, 168, F.SAFE);
  b.carve(162, 167, 162, 168, F.ASPHALT);
  const busDoor = b.door(162, 167, 162, 168, 'shutter', 'No. 9');
  b.prop('bus', 169, 166, 2, 4, { color: 0xffc94a });                         // the No. 9's nose, pointing home
  b.label('No. 9', 165, 165.4, 14, GOLD, E); b.label('MALLOW BAY TRANSIT', 165, 170.6, 9, CREAM, E);
  b.lamp(159.2, 164.2); b.lamp(159.2, 171.8); b.lamp(171.8, 164.2); b.lamp(171.8, 171.8);
  b.level(0);
  // Far bank: river road under the pines, a last Snoozle board.
  for (const z of [124, 133, 141, 155, 162, 175]) b.prop('pine', z % 2 ? 178 : 172, z);
  b.prop('pine', 177, 147); b.prop('rock', 173, 128); b.prop('bush', 177, 168);
  billboard(177, 156, 1, 5, 175.4, 158.5, WEST);
  b.label('RIVER ROAD', 175, 138, 12, CREAM, N);
  b.pick('ammo', 175, 120);
  b.lamp(175, 151); b.lamp(175, 172);

  // Wanderer density: the hill road and the stone steps sleep (the Bell has rung), the river flats
  // are out of its range and crowded, the finale arena brings its own horde.
  b.density(86, 147, 132, 179, 0.25);
  b.density(98, 180, 158, 272, 1.4);
  b.density(132, 148, 158, 192, 0.5);

  // ------------------------------------------------------------------
  // Quest
  // ------------------------------------------------------------------
  b.start([[15.5, 16.5], [16.5, 16.5], [14.5, 15.5], [17.5, 15.5]]);
  b.use(stationRadio, {
    objective: 'Radio Dot from the station', opens: [stationDoor],
    radio: [
      ['Dot', 'I\'m taking the No. 9 bus to the old bridge. Last convoy leaves at sunrise.'],
      ['Voice', 'The sleepers will follow you all the way out. Ring the Bell first. Please.'],
      ['Mochi', 'Hill first, then bridge. Got it. Two-stop delivery.'],
    ],
  });
  b.reach({ x0: 108, z0: 24, x1: 133, z1: 40 }, {
    objective: 'Head up Maple Loop',
    radio: [
      ['Taro', 'My sister lived on this street. Lemon trees. Terrible parking.'],
      ['Pip', 'Every window\'s got a Snoozle nightlight. Every single one.'],
    ],
  });
  b.collect('battery', {
    objective: 'Grab car batteries', opens: [cellarDoor],
    radio: [
      ['Voice', 'The transmitter\'s backup power is dead. Car batteries. Four should do it.'],
      ['Mochi', 'Grand theft battery. I\'ll leave a tip.'],
    ],
  });
  b.gather({ x0: 104, z0: 87, x1: 116, z1: 99 }, {
    objective: 'Shelter in the Henderson basement', checkpoint: true, closes: [cellarDoor],
    radio: [
      ['Nori', 'Peaches, a generator, forty rolls of toilet paper. The Hendersons were ready.'],
      ['Pip', 'For everything except this.'],
    ],
  });
  b.use(hatchLever, {
    objective: 'Open the basement hatch', opens: [hatch],
    radio: [
      ['Taro', 'Hatch comes up behind the backyards. The school\'s just past the fence.'],
      ['Mochi', 'Grab a peach for the road. Batteries stay with me.'],
    ],
  });
  b.reach({ x0: 57, z0: 76, x1: 68, z1: 92 }, {
    objective: 'Cut across the schoolyard', brute: true,
    radio: [
      ['Dot', 'Careful by the school. Something\'s flattening the jungle gym.'],
      ['Pip', 'Is that... the crossing guard?'],
      ['Taro', 'Stop sign and everything. Let\'s not cross him.'],
    ],
  });
  b.use(floodValve, {
    objective: 'Open the creek flood gate', horde: true, hold: 60, opens: [culvertGate],
    radio: [
      ['Dot', 'The creek trail\'s the only way up the hill. Crank that flood gate.'],
      ['Nori', 'Squeaky wheel. Of course it\'s a squeaky wheel.'],
    ],
  });
  b.reach({ x0: 6, z0: 156, x1: 30, z1: 163 }, {
    objective: 'Follow the trail into the pines', opens: [cabinDoor],
    radio: [
      ['Voice', 'I can see your flashlights from up here. You\'re close.'],
      ['Nori', 'Good. Now tell us everything.'],
      ['Voice', 'I made Hush to help people sleep. My boss shipped the batch I said wasn\'t safe.'],
    ],
  });
  b.gather({ x0: 10, z0: 165, x1: 22, z1: 173 }, {
    objective: 'Rest up in the ranger cabin', checkpoint: true, closes: [cabinDoor],
    radio: [
      ['Wren', 'Mum? ...Mum, are you on this channel?'],
      ['Dot', 'Wren? Wren Lowell, you are in SO much trouble. Are you hurt, sweet pea?'],
      ['Taro', 'There we are. Took you two long enough.'],
    ],
  });
  b.use(cabinLatch, {
    objective: 'Open the cabin back door', opens: [cabinBack],
    radio: [
      ['Wren', 'Back door\'s on a latch. Trail runs east to the hill steps. Mind the rocks.'],
      ['Dot', 'You heard her. Up you go, and bring my daughter a sandwich.'],
    ],
  });
  b.reach({ x0: 80, z0: 231, x1: 85, z1: 244 }, {
    objective: 'Go round by the old dam',
    radio: [
      ['Wren', 'Oh no. The hill trail\'s under a rockslide. Take the old logging road round by the dam.'],
      ['Taro', 'Bill Harlow\'s logging camp. Best flapjacks on the hill, every Sunday.'],
      ['Pip', 'Detour quest. There\'s always a detour quest.'],
    ],
  });
  b.reach({ x0: 111, z0: 123, x1: 129, z1: 146, lv: 1 }, {
    objective: 'Reach the transmitter on the hill',
    radio: [
      ['Wren', 'I can see you on the dam! The flume path climbs back up to the hill steps.'],
      ['Mochi', 'Ten-minute delivery to the top of the hill. Keep the porch light on!'],
    ],
  });
  b.use(bellConsole, {
    objective: 'Ring the Morning Bell', horde: true, hold: 120, opens: [compoundGate],
    radio: [
      ['Wren', 'I\'m behind the glass. Locked myself in. The console\'s up on the deck, by the mast.'],
      ['Pip', 'She\'s real! Hi, radio lady!'],
      ['Wren', 'When it rings, they\'ll come. Then they\'ll lie down. Hold until it takes.'],
      ['Mochi', 'Hold the deck, team. Watch the stairs and ladders. Last delivery of the night!'],
    ],
  });
  b.reach({ x0: 91, z0: 170, x1: 98, z1: 177 }, {
    objective: 'Head down to the old bridge',
    radio: [
      ['Nori', 'They\'re lying down. Breathing. Just... asleep.'],
      ['Pip', 'Night night, everybody.'],
      ['Taro', 'Sleep well. We\'ll come back for you.'],
    ],
  });
  b.collect('fuel', {
    objective: 'Find fuel for the army generator', opens: [postDoor],
    radio: [
      ['Dot', 'Sweet pea, the convoy\'s last truck jackknifed on the bridge road. Go round by the river.'],
      ['Wren', 'The Bell doesn\'t carry down to the river flats. The sleepers there are still up.'],
      ['Dot', 'And the army post\'s generator is dry. No juice, no boom gate. Find me fuel cans.'],
    ],
  });
  b.gather({ x0: 137, z0: 180, x1: 149, z1: 190 }, {
    objective: 'Hole up in the army field post', checkpoint: true, closes: [postDoor],
    radio: [
      ['Mochi', 'Three cans of go-juice, signed for. Next stop, the bridge!'],
      ['Dot', 'I\'m parked just past the army post. Found the door button. In you come, sweet peas.'],
    ],
  });
  b.use(postGen, {
    objective: 'Fuel the field post generator', opens: [postExit],
    radio: [
      ['Nori', 'Cots, cold coffee, field orders. The soldiers left in a hurry.'],
      ['Taro', 'And left their big guns on the sandbags. Somebody hoped we\'d come.'],
    ],
  });
  b.use(boomLever, {
    objective: 'Raise the bridge boom gate', horde: true, hold: 180, big: true, at: [149.5, 169.5], opens: [boomGate, busDoor],
    // Two ways in: Bridge Park (north) and the diner road (west), where the guns face.
    from: [{ x0: 134, z0: 150, x1: 158, z1: 162 }, { x0: 84, z0: 164, x1: 118, z1: 192 }],
    radio: [
      ['Dot', 'I can see you! Get that boom gate up and get on my bus!'],
      ['Wren', 'The far bank\'s out of range. They\'re still coming. Hold them!'],
      ['Pip', 'Turret section! Gatling, cannon, rocket pod. Best level ever!'],
    ],
    holdScript: [
      { kind: 'wave', secs: 36, msg: 'Here they come! Man the guns!' },
      { kind: 'breather', secs: 8 },
      { kind: 'specials', secs: 26 },
      { kind: 'wave', secs: 34, flank: true, msg: 'Second wave! Watch the park and the road!' },
      { kind: 'breather', secs: 6 },
      { kind: 'brute', secs: 26, msg: 'A Brute! Swing the cannon round!' },
      { kind: 'final', secs: 44, msg: 'The boom gate\'s nearly up! Hold on!' },
    ],
  });
  b.gather({ x0: 163, z0: 167, x1: 167, z1: 168, lv: 1 }, {
    objective: 'Everybody on Dot\'s bus!', closes: [busDoor],
    radio: [
      ['Dot', 'Wren, honey. Come down. There\'s a seat.'],
      ['Wren', 'Somebody has to stay up and keep it ringing, Mum. Lowells are good at staying up.'],
      ['Dot', 'Then I\'ll keep the radio on. Every night, sweet pea. Every night.'],
    ],
  });
  return b.done({ id: META.id, title: META.title, subtitle: META.subtitle, intro: INTRO, theme: THEME });
}
