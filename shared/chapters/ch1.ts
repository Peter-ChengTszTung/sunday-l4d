// Chapter 1: "Last Stop" — Downtown Mallow Bay, 3:20 a.m. in the rain.
// Brief: docs/campaign.md, "Chapter 1: Last Stop".
//
// Route (a clockwise spiral through downtown):
//   Laundromat (NW) → Marshmallow Avenue south → Tony's Pizza → Pell Plaza Parking
//   forecourt (crescendo 1) → garage: ground deck, ramp to level 2, ramp to the roof deck
//   (storey 2) and its viewpoint pier over City Hall Square → stair tower down → across the
//   square → Library (checkpoint) → Library Row alleys (fuse sweep: laundry storeroom upstairs,
//   fire escape by ladder; optional rooftops by ladder) → Cherry Street tram stop (crescendo 2,
//   footbridge perch) → rail underpass →
//   Clocktower Corner → Kettle Corner Diner (checkpoint) → the Guard has fenced Depot Square off
//   from the diner, so the long way round: Kettle Lane and the Butterwick Night Market → Lantern
//   Canal east, through the towpath arch under the railway → Gumdrop Street and the Snoozle Sleep
//   Shop → the river promenade → Night Ferry Terminal (alarmed freight stairs) → Wharf Halt and the
//   freight bridge west over the Library Row alleys (storey 1) → Mallow Junction yard → signal box
//   (checkpoint) → Depot Square (Gerald) → depot maintenance bay (finale: the Big Hold On, with the
//   Guard's Popcorn Gatling) → Shuttle No. 4.
// Tile coordinates: x grows east, z grows south. Arrow rot 0 points south (+z). Label rot is the way
// a reader faces: 0 north, N (PI) south, E east, WEST west.
// Storeys: 0 street, 1 garage level 2 / rooftops / fire escape / storeroom / footbridge / Wharf Halt
// and the freight bridge, 2 garage roof.
import { LevelBuilder, F, WALL, type Theme } from '../level';

export const META = { id: 'ch1', title: 'Last Stop', subtitle: 'Downtown Mallow Bay' };

const S = 0, E = Math.PI / 2, WEST = -Math.PI / 2, N = Math.PI;
const PINK = '#ff7ac8', TEAL = '#5ff2e0', CREAM = '#fff1c9', RED = '#ff6b6b', GOLD = '#ffd43b', LAV = '#c9a8ff';
const CHERRY = 0xc8324b;
const CAR = [0xff6b6b, 0x4dabf7, 0xffd43b, 0x9775fa, 0x63e6be, 0xf783ac, 0xe8e3f0, 0x845ef7];

/** Rainy 3 a.m.: indigo sky with a pink city glow, lavender fog, neon teal/pink blocks, wet asphalt. */
const THEME: Theme = {
  sky: [0x8a4a8f, 0x2e2768, 0x0c0b29],
  fog: 0x3b2d66, fogNear: 16, fogFar: 92,
  buildings: [0x3d3577, 0x2f5f78, 0x6a3a78, 0x2a7470, 0x4a3f8a, 0x8a4a78, 0x354a7a, 0x5a3468],
  floors: {
    [F.ASPHALT]: 0x39345e, [F.SIDEWALK]: 0x66628c, [F.CONCRETE]: 0x5c5976, [F.GRASS]: 0x3f6f66,
    [F.TILES]: 0xd8c6dc, [F.WOOD]: 0x8f6448, [F.INTERIOR]: 0x7c7494,
  },
};

const INTRO = '3:00 a.m. A sweet lavender fog rolled through Mallow Bay, and everyone asleep got out of bed and kept walking. You four were awake. Lucky you. Now the radio is crackling: a night dispatcher called Dot says there\'s a way out of town, and she\'ll talk you there. First, you have to get out of the laundromat.';

export function build() {
  const b = new LevelBuilder(236, 180, 3);
  let ci = 0;
  /** Abandoned car (1x2, facing north unless rotated). */
  const car = (x: number, z: number, rot = N, w = 1, d = 2) => b.prop('car', x, z, w, d, { color: CAR[ci++ % CAR.length], rot });
  /** Sleeper trail: little painted "zZ" marks along the way the sleepwalkers went. */
  const zz = (x: number, z: number, rot = N) => b.label('zZ', x, z, 18, LAV, rot);

  // ------------------------------------------------------------------
  // 1. Suds & Bubbles 24h Laundromat (start safe room) + back yard
  // ------------------------------------------------------------------
  b.carve(5, 5, 14, 12, F.SAFE);
  b.prop('shelf', 6, 5, 6, 1, { color: 0xe8e6f2 });            // row of dryers
  b.prop('counter', 9, 8, 3, 1);                                // folding table
  const cbRadio = b.obj('radio', 12, 8, 'Answer the CB radio');
  b.carve(15, 8, 15, 10, F.SIDEWALK);
  const shutter = b.door(15, 8, 15, 10, 'shutter', 'SUDS & BUBBLES');
  b.pick('smg', 11, 12); b.pick('shotgun', 12, 12); b.pick('smg', 13, 12); b.pick('shotgun', 14, 12); b.pick('smg', 12, 11);
  b.pick('ammo', 9, 12); b.pick('ammo', 10, 12); b.pick('ammo', 11, 11);
  b.pick('bat', 13, 11); b.pick('bat', 14, 11);                 // something close-in from the start
  for (const z of [7, 8, 9, 10]) b.pick('medkit', 5, z);
  b.note(14, 6, 'Corkboard flyer', 'SWEET DREAMS NIGHT! At 3 a.m. Dreamwell\'s gentle Hush mist drifts through downtown. Close your eyes, Mallow Bay. A rested city is a happy city!');
  b.label('SAFE ROOM', 10, 6.6, 26, RED); b.label('SUDS & BUBBLES 24H', 10, 11.6, 16, TEAL);
  b.lamp(10, 10);

  // ------------------------------------------------------------------
  // 2. Marshmallow Avenue (four lanes, south) to the Snoozle crosswalk
  // ------------------------------------------------------------------
  b.carve(16, 2, 31, 102, F.SIDEWALK);
  b.carve(19, 2, 28, 102, F.ASPHALT);
  for (let x = 19; x <= 28; x += 2) b.paint(x, 48, x, 51, F.SIDEWALK);   // zebra crossing
  b.label('MARSHMALLOW AVE', 23.5, 7, 30, CREAM);
  // Snoozle billboard over the crosswalk: the first landmark.
  b.prop('pillar', 16, 45); b.prop('pillar', 16, 54);
  b.prop('container', 16, 46, 1, 8, { color: 0xb784e0 });
  b.label('SNOOZLE', 23.5, 44.5, 64, PINK);
  b.label('SLEEP TIGHT, MALLOW BAY!', 23.5, 54.5, 26, CREAM);
  b.lamp(18.6, 47); b.lamp(18.6, 53); b.lamp(29.4, 50);
  // Abandoned cars, doors open, all facing north (the way the sleepers walked).
  car(20, 10); car(25, 14); b.prop('van', 22, 20, 1, 3, { color: 0xe8e3f0, rot: N }); car(27, 24);
  car(19, 30); car(24, 33); b.prop('van', 21, 39, 1, 3, { color: 0x63e6be, rot: N }); car(26, 42);
  car(20, 58); car(27, 60); b.prop('van', 23, 66, 1, 3, { color: 0xffd43b, rot: N }); car(19, 73);
  car(25, 77); car(21, 83); b.prop('van', 27, 86, 1, 3, { color: 0x4dabf7, rot: N }); car(20, 90);
  // The pile-up that closes the avenue at the garage.
  b.prop('bus', 16, 101, 8, 2, { color: 0xffc94a }); b.prop('truck', 24, 101, 8, 2);
  car(17, 97, 0.6, 2, 1); car(21, 96); car(24, 98, -0.4, 2, 1); car(28, 95); b.prop('barrier', 30, 97, 1, 3);
  for (const z of [6, 18, 30, 42, 66, 78, 90]) b.lamp(16.6, z);
  for (const z of [12, 24, 36, 60, 72, 84]) b.lamp(31.4, z);
  b.prop('bench', 31, 38, 1, 2); b.pick('ammo', 30, 41);           // bus shelter
  for (let z = 14; z <= 62; z += 8) zz(17.5 + ((z / 8) % 2), z);
  b.arrow(17.5, 13, S); b.arrow(23.5, 28, S); b.arrow(23.5, 57, S);
  // Side pocket: Kwik Mart 24h (west side).
  b.carve(9, 28, 14, 36, F.INTERIOR); b.carve(15, 30, 15, 33, F.INTERIOR);
  b.prop('shelf', 11, 29, 1, 3); b.prop('shelf', 11, 33, 1, 3); b.prop('counter', 14, 35, 1, 2);
  b.pick('medkit', 9, 29); b.pick('ammo', 9, 35);
  b.label('KWIK MART', 12.5, 32, 20, TEAL, WEST);

  // ------------------------------------------------------------------
  // 3. Crumb Street, Tony's Pizza, Crust Alley and the east lane
  // ------------------------------------------------------------------
  b.carve(32, 56, 58, 61, F.ASPHALT); b.paint(32, 56, 58, 56, F.SIDEWALK); b.paint(32, 61, 44, 61, F.SIDEWALK);
  car(36, 57, E, 2, 1); b.prop('dumpster', 51, 59);
  b.lamp(40, 56.6); b.lamp(52, 61.4);
  // Tony's: dining room, counter, oven kitchen, back door to the alley.
  b.carve(33, 63, 43, 73, F.TILES); b.carve(32, 64, 32, 67, F.TILES);
  b.prop('counter', 34, 71, 7, 1, { color: 0xc8324b });
  for (const [x, z] of [[35, 65], [39, 65], [35, 68], [39, 68]]) b.prop('desk', x, z, 2, 1);
  b.carve(41, 74, 42, 74, F.TILES); b.carve(33, 75, 43, 80, F.TILES);
  b.prop('counter', 33, 80, 6, 1, { color: 0x8a8a99 }); b.prop('counter', 36, 77, 4, 1);
  b.carve(44, 78, 44, 79, F.TILES);
  b.pick('shotgun', 34, 72); b.pick('smg', 35, 72); b.pick('shotgun', 36, 72); b.pick('rifle', 37, 72); b.pick('rifle', 38, 72);
  b.pick('ammo', 40, 73); b.pick('ammo', 33, 73); b.pick('ammo', 34, 73);
  b.pick('medkit', 33, 76); b.pick('medkit', 34, 76);
  b.pick('firebomb', 39, 72);                                   // the first throwable
  b.note(37, 70, 'Order spike', 'Order 3:02 a.m. 2x large pineapple. Note: "pls hurry, my whole street is sleepwalking and they\'re all humming the same song??"');
  b.label("TONY'S PIZZA", 38, 63.7, 26, PINK);
  b.lamp(38, 69.5);
  b.arrow(30, 65.5, E); b.arrow(42, 73, S); b.arrow(46.5, 81, S);
  // Crust Alley: Tony's back door and Crumb Street both drop into it.
  b.carve(45, 62, 48, 83, F.ASPHALT);
  b.prop('dumpster', 45, 68, 1, 2); b.prop('crate', 48, 72); b.prop('dumpster', 47, 77, 2, 1); b.prop('barrel', 45, 82);
  b.lamp(46.5, 66);
  // East lane: a loop from Crumb Street down to the forecourt (and the depot's roller door).
  b.carve(54, 56, 58, 98, F.ASPHALT); b.carve(53, 92, 53, 98, F.ASPHALT);
  car(55, 64); b.prop('van', 57, 74, 1, 3, { color: 0xe8e3f0, rot: N }); b.prop('crate', 54, 82); car(56, 88);
  b.lamp(53.6, 70); b.lamp(58.4, 84);

  // ------------------------------------------------------------------
  // 4. Pell Plaza Parking forecourt (crescendo 1)
  // ------------------------------------------------------------------
  b.carve(32, 84, 52, 104, F.CONCRETE);
  // Attendant booth with the barrier lever.
  b.fill(44, 88, 48, 92); b.carve(45, 89, 47, 91, F.INTERIOR); b.carve(44, 90, 44, 91, F.INTERIOR);
  const garageLever = b.obj('lever', 47, 89, 'Raise the garage barrier (ALARM!)');
  b.prop('barrier', 35, 95, 3, 1); b.prop('barrier', 40, 99, 3, 1); b.prop('barrier', 49, 97, 1, 3);
  b.prop('bush', 33, 88, 2, 1); b.prop('bush', 38, 88, 2, 1); b.prop('terminal', 42, 103);
  car(34, 101, E, 2, 1); b.prop('crate', 50, 86);
  b.pick('ammo', 33, 103); b.pick('ammo', 34, 103); b.pick('ammo', 51, 103); b.pick('ammo', 52, 103);
  b.label('PELL PLAZA PARKING', 38.5, 102.6, 28, TEAL);
  b.lamp(33, 85); b.lamp(51.5, 85); b.lamp(33, 99); b.lamp(51.5, 100);
  b.arrow(46.5, 86, S); b.arrow(41.5, 92, E);

  // ------------------------------------------------------------------
  // 5. Pell Plaza Parking: three stacked decks (ground, level 2, roof deck)
  //    joined by wide ramps, the viewpoint pier and the stair tower
  // ------------------------------------------------------------------
  // The garage is two storeys of concrete; the roof deck (storey 2) is carved on top of it. The
  // offices to the south and west stand taller, so the deck reads as a roof between buildings, and
  // its north and east edges look out over open ground (the forecourt and City Hall Square).
  b.walls(21, 105, 85, 122, WALL.BUILDING, 8.4);
  b.walls(80, 123, 85, 145, WALL.BUILDING, 8.4);          // pier block and stair tower
  b.walls(14, 123, 79, 150, WALL.BUILDING, 12.6);
  b.walls(14, 103, 20, 122, WALL.BUILDING, 12.6);
  // Ground deck (storey 0): in through the gate, east along the north lane to ramp 1.
  b.carve(22, 106, 84, 121, F.INTERIOR);
  b.paint(46, 106, 50, 117, F.CONCRETE);                  // under the collapsed level-2 slab: open to the roof
  b.carve(36, 105, 41, 105, F.CONCRETE);
  const garageDoor = b.door(36, 105, 41, 105, 'shutter', 'PELL PLAZA PARKING');
  for (let x = 28; x <= 76; x += 6) { b.prop('pillar', x, 110); b.prop('pillar', x, 117); }
  for (const x of [24, 27, 30, 33, 44, 53, 59, 62, 68, 74]) car(x, 106, S);
  for (const x of [25, 31, 37, 43, 55, 61, 67, 73]) car(x, 113, N);
  for (const x of [23, 29, 35, 41, 53, 59, 65, 71, 77]) car(x, 120, N);
  b.prop('crate', 47, 109); b.prop('barrel', 49, 111); b.prop('pallet', 46, 114); b.prop('crate', 49, 116);  // fallen slab
  b.pick('ammo', 23, 108);                                // dead-end corner west of the gate
  // Ramp 1: four lanes wide, rising south along the east wall to level 2.
  b.fill(80, 112, 80, 114); b.fill(81, 115, 84, 121);
  b.stairs(81, 112, 84, 114, '+z');
  b.label('RAMP UP: LEVEL 2', 82.5, 110.3, 18, GOLD);
  b.lamp(82.5, 110.6);                                    // the garage is dark: lamps only mark the ramps
  b.arrow(41.5, 108.5, E); b.arrow(62, 108.5, E); b.arrow(79, 109, E); b.arrow(82.5, 111.4, S);
  // Level 2 (storey 1): back west. The slab has caved in mid-deck, so the way round is the pay office.
  b.level(1);
  b.carve(22, 106, 84, 121, F.INTERIOR);
  b.fill(36, 105, 41, 105);                               // lintel over the gate
  b.open(46, 106, 50, 117);                               // collapsed slab: look down onto the ground deck
  b.fill(43, 118, 55, 118); b.fill(43, 119, 43, 119); b.fill(55, 119, 55, 119);   // pay office, doorways at z 120-121
  b.fill(26, 113, 26, 115); b.fill(22, 106, 25, 112);
  b.stairs(22, 113, 25, 115, '-z');                       // ramp 2, rising north to the roof deck
  for (let x = 28; x <= 76; x += 6) if (x !== 46) { b.prop('pillar', x, 110); b.prop('pillar', x, 117); }
  for (const x of [28, 31, 34, 38, 56, 62, 65, 71, 74]) car(x, 106, S);
  for (const x of [31, 37, 58, 64, 70]) car(x, 113, N);
  for (const x of [30, 36, 59, 65, 71]) car(x, 120, N);
  b.prop('desk', 45, 119, 2, 1); b.prop('desk', 50, 119, 2, 1); b.prop('shelf', 54, 119);
  b.pick('medkit', 48, 121); b.pick('ammo', 44, 121);
  b.label('LEVEL 2', 82.5, 117.6, 22, GOLD);
  b.label('PAY STATION', 49, 120.6, 16, TEAL, WEST);
  b.label('RAMP UP: ROOF', 23.5, 117.6, 18, GOLD, N);
  b.lamp(49, 120); b.lamp(23.5, 116.8);
  b.arrow(80, 118.5, WEST); b.arrow(62, 118.5, WEST); b.arrow(57, 120.5, WEST); b.arrow(40, 118.5, WEST); b.arrow(28, 117, WEST); b.arrow(23.5, 116.4, N);
  // Roof deck (storey 2): open sky, parked cars, light poles; east to the viewpoint pier over the square.
  b.level(2);
  b.carve(21, 105, 85, 122, F.CONCRETE);
  b.carve(80, 123, 84, 136, F.CONCRETE);                  // viewpoint pier
  for (const x of [30, 42, 54, 66]) car(x, 106, S);
  car(48, 120, N); car(72, 120, N); car(36, 114, E, 2, 1); car(60, 116, WEST, 2, 1);
  for (const x of [33, 45, 57, 69]) b.lamp(x, 121.6);
  b.lamp(24, 110.6);
  b.label('ROOF DECK', 34, 110, 26, GOLD, WEST);
  b.arrow(27, 109.5, E); b.arrow(45, 110, E); b.arrow(66, 110, E); b.arrow(82.5, 114, S); b.arrow(82.5, 124, S);
  b.pick('rifle', 81, 124); b.pick('shotgun', 81, 125); b.pick('rifle', 81, 126); b.pick('smg', 82, 125); b.pick('ammo', 84, 124); b.pick('ammo', 83, 124);
  b.label('SWEET DREAMS NIGHT VIEWPOINT', 83.5, 129.5, 14, LAV, WEST);
  b.label('STAIR TOWER', 81, 134.6, 14, CREAM);
  b.lamp(80.6, 127); b.lamp(84.4, 133);
  b.arrow(81, 133, S);
  // Stair tower: from the pier down to storey 1 (flight A), along the landing, then down to the
  // street (flight B) and out to the square.
  b.level(1);
  b.carve(80, 140, 84, 141, F.INTERIOR);                  // landing
  b.fill(82, 137, 82, 139);                               // between the flights
  b.fill(83, 135, 84, 136);                               // over the street passage
  b.stairs(80, 137, 81, 139, '-z');                       // flight A: landing -> pier
  b.label('EXIT: CITY HALL SQ', 82.2, 141.6, 11, CREAM, E);
  b.lamp(82.5, 140.8);
  b.arrow(81.5, 140.5, E); b.arrow(84, 140.5, N);
  b.level(0);
  b.carve(83, 135, 84, 136, F.INTERIOR);                  // passage out to the square
  b.stairs(83, 137, 84, 139, '+z');                       // flight B: street -> landing
  b.label('STAIR TOWER', 87.3, 134, 14, CREAM, WEST);
  b.arrow(85.5, 135.5, E);

  // ------------------------------------------------------------------
  // 6. City Hall Square (open fight) and the fog machines
  // ------------------------------------------------------------------
  b.carve(86, 105, 122, 158, F.SIDEWALK);
  b.carve(85, 123, 85, 136, F.SIDEWALK);                 // kerb under the viewpoint pier (open sky above it)
  b.carve(97, 120, 112, 142, F.GRASS); b.paint(97, 130, 112, 131, F.SIDEWALK); b.paint(104, 120, 105, 142, F.SIDEWALK);
  b.prop('fountain', 112, 110, 3, 3);
  // Trees (opaque) stay off the overlook's sightline to the steps; bushes and benches are see-through.
  for (const [x, z] of [[99, 122], [110, 122], [99, 140], [110, 140], [89, 112], [120, 112], [120, 134]]) b.prop('tree', x, z);
  for (const [x, z] of [[101, 125], [108, 125], [101, 136], [108, 136]]) b.prop('bush', x, z, 1, 2);
  for (const [x, z] of [[94, 118], [94, 134], [116, 124], [116, 142]]) b.prop('bench', x, z, 1, 2);
  car(91, 126, 0.3); b.prop('van', 115, 114, 1, 3, { color: 0xf783ac, rot: 0.2 }); b.prop('barrier', 92, 144, 3, 1);
  // City Hall steps: twelve fog machines under the SWEET DREAMS NIGHT banner.
  b.paint(90, 148, 120, 158, F.CONCRETE);
  for (let i = 0; i < 12; i++) b.prop('gen', 93 + 2 * i, 151);
  for (let x = 92; x <= 118; x += 4) b.prop('pillar', x, 158);
  b.label('SWEET DREAMS NIGHT', 105, 154.5, 40, PINK);
  b.label('CITY HALL', 105, 147.6, 30, CREAM);
  b.note(116, 152, 'Clipboard by fog unit #12', 'Fog units calibrated to Dreamwell spec. Dr. W. Lowell requested postponement: "HX-9 not ready." Request denied. G. Pell. Proceed 3:00 a.m.');
  b.pick('ammo', 105, 131); b.pick('ammo', 95, 149);
  for (const [x, z] of [[92, 106], [104, 106], [121, 120], [88, 122], [88, 140], [121, 146], [96, 147], [114, 147], [104, 127], [104, 138]]) b.lamp(x, z);
  b.arrow(89, 135.5, E); b.arrow(104.5, 143.5, S); b.arrow(118, 151.5, E);
  // Council Lane: optional dead-end side street off the square.
  b.carve(70, 150, 86, 155, F.ASPHALT);
  car(74, 151, E, 2, 1); b.prop('dumpster', 70, 155); b.pick('medkit', 80, 152); b.pick('ammo', 71, 153);
  b.lamp(78, 150.5);
  // The lane opens behind you as you leave the stair tower: light its mouth, name it on the square,
  // and drop an ammo pile on the way so the eye goes there before the long walk east.
  b.lamp(87, 149.4); b.label('COUNCIL LANE', 88.5, 152.5, 18, CREAM);
  b.pick('ammo', 86, 145);

  // ------------------------------------------------------------------
  // 7. Mallow Bay Public Library (checkpoint safe room)
  // ------------------------------------------------------------------
  b.carve(124, 122, 140, 158, F.WOOD); b.carve(123, 150, 123, 153, F.WOOD);
  b.prop('counter', 128, 149, 5, 1);                                     // returns desk
  b.note(130, 150, 'Sticky note on the returns desk', 'Anyone who dozed off in the reading room got up at 3 and walked out. The ones still reading are fine. Note to self: overdue fines are not tonight\'s problem.');
  b.prop('bench', 135, 155, 3, 1); b.prop('shelf', 140, 147, 1, 6);
  // The stacks: a serpentine of shelving.
  for (const [x, z] of [[124, 142], [127, 138], [124, 134], [127, 130], [124, 126]]) b.prop('shelf', x, z, 14, 1);
  b.label('LIBRARY', 132, 153, 34, TEAL);
  b.lamp(126, 156);
  b.arrow(126, 151.5, E); b.arrow(139, 144, N); b.arrow(125, 140, N); b.arrow(139, 136, N); b.arrow(125, 132, N); b.arrow(139, 128, N); b.arrow(125.5, 123.5, N);
  // Reading room safe room.
  // Sealed: the only openings are the entry door (from the stacks) and the back door.
  b.carve(125, 112, 137, 119, F.SAFE); b.carve(125, 121, 126, 121, F.WOOD); b.carve(125, 120, 126, 120, F.SAFE);
  const libraryEntry = b.door(125, 120, 126, 120, 'shutter', 'SAFE ROOM');
  const librarySwitch = b.obj('terminal', 137, 113, 'Open the back door');
  b.prop('desk', 127, 117, 2, 1); b.prop('desk', 134, 117, 2, 1); b.prop('shelf', 125, 112, 1, 3);
  for (const x of [127, 128, 129, 130]) b.pick('medkit', x, 112);
  b.pick('ammo', 135, 119); b.pick('ammo', 136, 119); b.pick('ammo', 137, 119);
  b.pick('armor', 131, 112); b.pick('rattle', 134, 119);
  b.pick('rifle', 133, 112); b.pick('shotgun', 134, 112); b.pick('rifle', 135, 112); b.pick('smg', 136, 112); b.pick('smg', 137, 112); // tier 2 waits for the second half (tram line on)
  b.label('SAFE ROOM', 131, 114, 26, RED); b.label('SHHH', 131, 118.5, 18, CREAM);
  b.carve(138, 114, 138, 116, F.INTERIOR);
  const libraryDoor = b.door(138, 114, 138, 116, 'shutter', 'LIBRARY BACK DOOR');
  b.carve(139, 113, 141, 117, F.INTERIOR);

  // ------------------------------------------------------------------
  // 8. Library Row back alleys (fuse sweep)
  // ------------------------------------------------------------------
  b.carve(142, 56, 146, 176, F.ASPHALT);                 // Library Row
  b.carve(168, 56, 172, 176, F.ASPHALT);                 // Wash Alley
  b.carve(147, 92, 167, 95, F.ASPHALT);                  // middle cut-through
  b.carve(147, 172, 167, 176, F.ASPHALT);                // south cross alley
  // Fuse 1: Lather Laundry, up the back stairs in the storeroom (storey 1, dark).
  b.carve(147, 143, 149, 145, F.INTERIOR); b.carve(150, 136, 163, 150, F.INTERIOR);
  for (const z of [138, 142, 146]) b.prop('counter', 153, z, 8, 1, { color: 0xe8e6f2 });
  b.prop('crate', 163, 136); b.prop('barrel', 150, 150);
  b.fill(161, 139, 161, 141);                                    // stair wall
  b.stairs(162, 139, 163, 141, '-z');
  b.pick('medkit', 151, 149);
  b.label('LATHER LAUNDRY', 148, 144, 16, TEAL, E);
  b.label('STAIRS UP: STOREROOM', 162.5, 143.3, 10, GOLD, N);
  b.lamp(162.5, 142.6);
  b.arrow(156, 144, E); b.arrow(162.5, 142.4, N);
  b.level(1);
  b.fill(149, 135, 164, 142); b.carve(150, 136, 163, 141, F.INTERIOR);
  b.prop('shelf', 153, 136, 6, 1); b.prop('shelf', 150, 139, 1, 3); b.prop('crate', 157, 140); b.prop('crate', 158, 140);
  b.item('fuse', 'fuse', 151, 137, 'fuse');
  b.pick('armor', 152, 141);                                    // off-route reward
  b.label('STOREROOM', 157, 138.4, 14, CREAM, WEST);
  b.arrow(160, 138, WEST);
  b.level(0);
  // Fuse 2: on a dumpster lid in the south cross alley.
  b.prop('dumpster', 157, 172, 2, 1); b.item('fuse', 'fuse', 159, 172, 'fuse');
  // Fuse 3: alley junction box on Wash Alley.
  b.prop('terminal', 172, 119); b.item('fuse', 'fuse', 171, 119, 'fuse');
  b.label('JUNCTION BOX', 170, 121.5, 14, GOLD, N);
  // Fuse 4: on the fire-escape landing over Wash Alley (storey 1), two drop ladders up to it.
  b.ladder(172, 69, '+x'); b.ladder(172, 77, '+x');
  b.label('FIRE ESCAPE', 170.6, 73, 14, CREAM, N);
  b.label('LADDER', 171, 70.6, 9, GOLD, N); b.label('LADDER', 171, 78.6, 9, GOLD, N);
  b.level(1);
  b.carve(173, 67, 174, 78, F.CONCRETE);
  b.prop('pallet', 174, 68); b.prop('crate', 174, 76);
  b.item('fuse', 'fuse', 174, 73, 'fuse');
  b.level(0);
  // Optional: the Library Row rooftops (storey 1), a ladder up from each alley. A perch over
  // Library Row, Wash Alley and the cut-through, with a rifle and the pigeon keeper's log.
  b.ladder(146, 114, '+x'); b.ladder(168, 102, '-x');
  b.label('LADDER', 145, 114.5, 9, GOLD, E); b.label('LADDER', 169, 102.5, 9, GOLD, WEST);
  b.level(1);
  b.carve(147, 96, 167, 134, F.CONCRETE);
  b.prop('gen', 151, 101, 2, 2); b.prop('gen', 162, 110, 2, 2); b.prop('gen', 150, 127, 2, 2);   // air-con units
  b.prop('tank', 157, 117, 2, 2, { color: 0x8a8a99 });                                         // water tank
  b.prop('pillar', 165, 99); b.prop('pillar', 148, 112); b.prop('pillar', 160, 131);            // chimneys
  b.prop('container', 158, 125, 4, 2, { color: 0xe8e3f0 });                                      // pigeon loft
  b.prop('pallet', 155, 104, 2, 2); b.prop('pallet', 163, 122, 2, 2);                            // skylights
  b.pick('rifle', 148, 97); b.pick('ammo', 149, 97); b.pick('medkit', 166, 133); b.pick('ammo', 165, 133); b.pick('firebomb', 157, 124);
  b.note(157, 127, 'Pigeon loft logbook', '3:04 a.m. The whole block came out in pyjamas, eyes shut, slippers on. Walked right under the loft. Not one of them looked up. Birds are fine.');
  b.label('ROOFTOPS', 157, 108, 22, LAV);
  b.lamp(150, 98); b.lamp(158, 128);
  b.level(0);
  // Noodle bar: side pocket with supplies before the tram.
  b.carve(134, 72, 141, 78, F.TILES);
  b.prop('counter', 135, 74, 1, 4); b.pick('medkit', 137, 73); b.pick('ammo', 137, 77);
  b.pick('machete', 138, 73);                                   // off-route reward
  b.label('NOODLE BAR', 139, 75, 16, PINK, WEST);
  // Alley clutter.
  for (const [x, z] of [[142, 100], [146, 125], [142, 160], [168, 150], [172, 132], [172, 104], [168, 84]]) b.prop('dumpster', x, z);
  for (const [x, z] of [[146, 106], [142, 133], [146, 166], [168, 162], [172, 110], [168, 70], [160, 94]]) b.prop('crate', x, z);
  for (const [x, z] of [[142, 152], [172, 140], [150, 175], [168, 96], [146, 62]]) b.prop('barrel', x, z);
  b.pick('ammo', 146, 170); b.pick('ammo', 172, 90); b.pick('ammo', 143, 64);
  for (const [x, z] of [[144, 118], [144, 144], [144, 174], [158, 174], [170, 174], [170, 140], [170, 119], [170, 94], [144, 94], [170, 74], [144, 60], [170, 60]]) b.lamp(x, z);
  b.arrow(143.5, 120, S); b.arrow(144, 140, S); b.arrow(144, 168, S); b.arrow(150, 174, E); b.arrow(165, 174, E);
  b.arrow(170, 168, N); b.arrow(170, 126, N); b.arrow(170, 98, N); b.arrow(170, 82, N); b.arrow(170, 62, N);
  for (let z = 160; z >= 64; z -= 16) zz(170.5, z, S);

  // ------------------------------------------------------------------
  // 9. Cherry Street heritage tram stop (crescendo 2)
  // ------------------------------------------------------------------
  b.carve(118, 40, 175, 55, F.ASPHALT);
  b.paint(118, 40, 175, 41, F.SIDEWALK); b.paint(118, 52, 142, 55, F.CONCRETE);
  b.prop('bus', 122, 46, 12, 3, { color: CHERRY });                     // the cream-and-cherry tram
  const tramLever = b.obj('lever', 128, 52, 'Power up the tram line (the bell is LOUD)');
  b.prop('bench', 131, 54, 3, 1); b.prop('bench', 139, 55, 3, 1); b.prop('barrier', 140, 51, 1, 3);
  car(150, 43, E, 2, 1); car(160, 49, WEST, 2, 1); b.prop('van', 165, 42, 3, 1, { color: 0x63e6be }); b.prop('crate', 156, 52); b.prop('barrier', 147, 47, 1, 3);
  b.pick('medkit', 123, 54); b.pick('medkit', 124, 54); b.pick('ammo', 125, 55); b.pick('ammo', 126, 55); b.pick('ammo', 134, 55); b.pick('ammo', 133, 55);
  b.pick('launcher', 125, 54); // before the big tram holdout
  b.pick('rattle', 126, 54);
  b.label('CHERRY ST TRAM STOP', 130, 53.5, 22, PINK);
  b.label('CHERRY STREET', 158, 47.5, 30, CREAM);
  for (const [x, z] of [[121, 52], [134, 51.6], [146, 40.6], [158, 55], [170, 40.6], [126, 40.6]]) b.lamp(x, z);
  b.arrow(144, 54, N); b.arrow(165, 48.5, WEST); b.arrow(140, 48.5, WEST);
  // Footbridge over Cherry Street (storey 1): a perch over the tram-stop fight. Stairs come up from
  // the platform and a ladder from the north kerb, so the horde climbs at both ends.
  b.fill(136, 42, 138, 42);                                     // bridge pier at the north kerb
  b.prop('barrier', 135, 52, 1, 3); b.prop('barrier', 138, 52, 1, 3);   // stair rails
  b.stairs(136, 52, 137, 54, '-z');
  b.ladder(137, 41, '+z');
  b.label('FOOTBRIDGE', 136.5, 55.6, 12, GOLD, N); b.label('LADDER', 137.5, 40.4, 9, GOLD);
  b.level(1);
  b.carve(136, 42, 138, 51, F.CONCRETE);
  b.pick('ammo', 136, 45); b.pick('ammo', 138, 48);
  b.label('TRAM FOOTBRIDGE', 137.5, 47, 10, PINK, E);
  b.lamp(138.85, 45); b.lamp(138.85, 49);                     // on the east rail, clear of the stair and ladder landings
  b.level(0);
  // Pie Lane: a loop north of Cherry Street (more ways in for the horde).
  b.carve(128, 24, 131, 39, F.ASPHALT); b.carve(128, 24, 153, 27, F.ASPHALT); b.carve(150, 24, 153, 39, F.ASPHALT);
  car(129, 30); b.prop('dumpster', 140, 24); b.pick('ammo', 141, 26); b.lamp(140, 27.4);

  // ------------------------------------------------------------------
  // 10. Rail underpass and Clocktower Corner
  // ------------------------------------------------------------------
  b.walls(100, 0, 117, 103, WALL.ROCK, 6);
  b.carve(100, 42, 116, 47, F.INTERIOR);
  b.carve(117, 42, 117, 47, F.ASPHALT);
  const underpass = b.door(117, 42, 117, 47, 'shutter', 'TRAM LINE GATE');   // an electric roller gate on the tram line's power
  b.prop('barrel', 108, 42); b.prop('crate', 112, 47);
  b.label('RAIL UNDERPASS', 108, 44.5, 22, CREAM, WEST);
  b.arrow(120, 44.5, WEST);
  b.carve(80, 34, 99, 54, F.SIDEWALK); b.paint(83, 37, 96, 51, F.ASPHALT);
  b.prop('pillar', 89, 43, 2, 2, { color: 0xd8c8a8 });                  // the clock, stopped at 3:00
  b.prop('beacon', 89, 42); b.prop('bench', 85, 40, 1, 2); b.prop('bench', 93, 46, 1, 2);
  car(84, 50, E, 2, 1); b.prop('barrier', 95, 37, 1, 3);
  b.label('3:00', 90, 46.5, 44, GOLD);
  b.label('CLOCKTOWER CORNER', 90, 52.5, 24, CREAM);
  for (const [x, z] of [[87, 41], [93, 41], [87, 47], [93, 47]]) b.lamp(x, z);
  b.arrow(97, 44.5, WEST); b.arrow(82, 38, WEST);
  // Bell Street: a short dead end north of the corner.
  b.carve(86, 22, 89, 33, F.ASPHALT); car(87, 24); b.pick('ammo', 88, 23); b.pick('firebomb', 89, 23);
  b.lamp(86.4, 33.6); b.label('BELL ST', 87.5, 35.4, 16, CREAM, 0);                   // its mouth, lit and named from the corner

  // ------------------------------------------------------------------
  // 11. Kettle Corner Diner (checkpoint: walk-in pantry)
  // ------------------------------------------------------------------
  b.carve(68, 30, 78, 39, F.TILES); b.carve(79, 35, 79, 38, F.TILES);
  b.prop('counter', 70, 32, 1, 6, { color: 0x63e6be });
  for (const [x, z] of [[75, 31], [75, 35], [75, 38]]) b.prop('desk', x, z, 2, 1);
  b.carve(67, 34, 67, 35, F.TILES); b.carve(60, 30, 66, 39, F.TILES);
  b.prop('counter', 60, 30, 5, 1, { color: 0x8a8a99 }); b.prop('counter', 63, 34, 1, 3);
  b.pick('ammo', 72, 31);
  b.label('KETTLE CORNER DINER', 74, 33.5, 18, TEAL);
  b.lamp(73.5, 37);
  b.arrow(77, 36.5, WEST); b.arrow(68, 34.5, WEST); b.arrow(62.5, 38, S);
  // Sealed walk-in: entry door from the kitchen, back door to the lot.
  b.carve(60, 42, 67, 46, F.SAFE); b.carve(62, 40, 63, 40, F.TILES); b.carve(62, 41, 63, 41, F.SAFE);
  const pantryEntry = b.door(62, 41, 63, 41, 'shutter', 'SAFE ROOM');
  const pantrySwitch = b.obj('lever', 67, 45, 'Open the back door');
  b.prop('shelf', 60, 42, 1, 5); b.prop('shelf', 67, 42, 1, 3);
  for (const z of [42, 43, 44, 45]) b.pick('medkit', 61, z);
  b.pick('ammo', 65, 46); b.pick('ammo', 66, 46); b.pick('ammo', 67, 46);
  b.pick('machete', 65, 42); b.pick('armor', 64, 46);
  b.pick('shotgun', 66, 42); b.pick('smg', 66, 43); b.pick('rifle', 66, 44); b.pick('autoshotgun', 66, 45); b.pick('launcher', 65, 43); b.pick('magnum', 65, 44);
  b.label('SAFE ROOM', 64, 44, 22, RED); b.label('TAKE A PIE', 64, 45.6, 12, CREAM);
  b.carve(64, 47, 65, 47, F.ASPHALT);
  const dinerDoor = b.door(64, 47, 65, 47, 'shutter', 'DINER BACK DOOR');
  b.carve(62, 48, 72, 57, F.ASPHALT);
  b.prop('dumpster', 70, 48, 2, 1); b.prop('crate', 72, 54);
  b.lamp(67, 52);
  // The Mallow Bay Guard's roadblock: Depot Square is right there, behind a fence and two trucks.
  // The only way out of the lot is the gap west into Kettle Lane.
  b.fill(62, 57, 72, 57); b.walls(62, 57, 72, 57, WALL.FENCE, 3.2);
  b.prop('barrier', 63, 56, 4, 1); b.prop('barrier', 68, 56, 4, 1);
  b.label('ROAD CLOSED', 67.5, 55, 18, RED, N); b.label('MALLOW BAY GUARD', 67.5, 53.6, 11, CREAM, N);
  b.carve(59, 50, 61, 53, F.SIDEWALK);
  b.arrow(64, 51.5, WEST);

  // ------------------------------------------------------------------
  // 12. Depot Square, Gerald's guard booth and the depot gate
  // ------------------------------------------------------------------
  b.carve(62, 58, 98, 72, F.ASPHALT);
  b.walls(62, 73, 98, 73, WALL.FENCE, 3.2);
  b.carve(77, 73, 82, 73, F.ASPHALT);
  const depotGate = b.door(77, 73, 82, 73, 'fence', 'DEPOT GATE');
  b.fill(84, 65, 88, 71); b.carve(85, 66, 87, 70, F.INTERIOR); b.carve(84, 67, 84, 68, F.INTERIOR);
  const gateSwitch = b.obj('lever', 87, 69, 'Flip the depot gate switch');
  b.label('GATE', 86, 66.5, 14, GOLD);
  car(66, 62, 0.4); b.prop('van', 72, 66, 3, 1, { color: 0xe8e3f0 }); b.prop('container', 92, 59, 2, 5); b.prop('barrier', 76, 61, 3, 1);
  b.prop('truck', 65, 58, 7, 2, { color: 0x6b7f4a });                 // the Guard's trucks, parked against their own fence
  b.label('EVAC STAGING', 90, 66.5, 18, GOLD, WEST);
  // The signal box's depot-side door comes out of the embankment on the east side of the square.
  b.lamp(98.4, 60.6); b.arrow(96, 62, WEST);
  b.prop('barrier', 70, 70, 3, 1); b.prop('crate', 96, 70); b.prop('crate', 63, 70);
  b.label('TRANSIT DEPOT', 80, 70.5, 34, TEAL);
  for (const [x, z] of [[64, 59], [80, 58.6], [96, 66], [76, 72.4], [83.5, 72.4], [70, 66]]) b.lamp(x, z);
  b.arrow(80, 63, S); b.arrow(83, 67.5, E);

  // ------------------------------------------------------------------
  // 13. Depot yard and maintenance bay (finale: the Big Hold On), Shuttle No. 4
  // ------------------------------------------------------------------
  // One open bay from the fence to the back wall. During the Big Hold On the flood comes one way only:
  // out of Depot Square through the depot gate (north), straight down the barrel of the Guard's Popcorn
  // Gatling on its sandbags north of the ignition. The freight spur tunnel (north-east), the bay roller
  // door (west) and the bus wash (south-west) stay shut until the shuttle starts.
  b.carve(62, 74, 98, 92, F.CONCRETE);
  // Shuttle No. 4: a walk-in body in the middle of the bay, ignition at the driver's end.
  b.fill(70, 84, 84, 88); b.walls(70, 84, 84, 88, WALL.BUILDING, 3.2);
  b.carve(71, 85, 83, 87, F.SAFE);
  b.carve(75, 84, 76, 84, F.CONCRETE);
  const shuttleDoor = b.door(75, 84, 76, 84, 'shutter', 'SHUTTLE No.4');
  b.carve(84, 86, 84, 86, F.CONCRETE);
  const ignition = b.obj('terminal', 84, 86, 'Crank the shuttle ignition');
  b.label('SHUTTLE No. 4', 77, 82.5, 22, GOLD); b.label('ST. MARIGOLD', 77, 86, 14, CREAM);
  // Street-side roller door onto the east lane.
  b.carve(59, 84, 60, 87, F.ASPHALT);
  const bayDoor = b.door(61, 84, 61, 87, 'shutter', 'BAY ROLLER DOOR');
  // Bus wash: a lane from the bay's south-west corner out to the east lane, behind a gate.
  b.carve(63, 93, 66, 93, F.CONCRETE); b.carve(59, 94, 66, 97, F.CONCRETE);
  const busWash = b.door(59, 94, 59, 97, 'fence', 'BUS WASH GATE');
  b.prop('barrel', 62, 97); b.prop('pallet', 61, 94);
  b.label('BUS WASH', 64.5, 95.5, 12, TEAL, N);
  // Freight spur tunnel: through the embankment to Mallow Junction.
  b.carve(99, 74, 117, 77, F.INTERIOR);
  const spurGate = b.door(99, 74, 99, 77, 'fence', 'FREIGHT SPUR GATE');
  b.prop('crate', 106, 74); b.prop('barrel', 112, 77);
  // Cover: a dead shuttle east of the stand, crates and sandbag lines that stop nothing for long.
  b.prop('bus', 89, 81, 2, 10, { color: 0x5ff2e0 });                  // a dead shuttle for cover
  b.prop('counter', 92, 92, 5, 1, { color: 0x8a8a99 }); b.prop('counter', 68, 92, 4, 1, { color: 0x8a8a99 });
  for (const [x, z] of [[66, 81], [79, 80], [94, 85], [86, 91], [72, 91], [70, 76], [96, 83]]) b.prop('crate', x, z);
  b.prop('barrier', 82, 78, 3, 1); b.prop('barrier', 89, 77, 1, 3); b.prop('barrier', 66, 86, 1, 3); b.prop('barrier', 74, 90, 3, 1);
  b.prop('barrel', 97, 80); b.prop('barrel', 62, 88);
  b.prop('truck', 63, 77, 2, 6, { color: 0x6b7f4a });                 // a Guard truck nobody woke up to drive
  // The Guard's nest: Popcorn Gatling on the sandbags, facing the gate.
  b.mount('minigun', 86, 79, '-z');
  b.label('POPCORN GATLING', 86.5, 81.6, 10, GOLD, 0);
  b.note(88, 80, 'Guard duty log', 'MALLOW BAY GUARD, POST 3, TRANSIT DEPOT. 3:10 Evac staging up. Siren wired to the shuttle bay. Gatling on the sandbags. 3:20 Sarge says rest your eyes, long night. 3:22 Everybody is resting their eyes. 3:2');
  b.prop('desk', 63, 90, 2, 1);
  b.note(65, 90, 'Whiteboard', 'NIGHT ROTA: Dispatch, Dot. Gate, Gerald. Shuttle 4 battery is moody, warm her up! Birthday card for Dot\'s girl Wren by the kettle. SIGN IT.');
  b.note(63, 89, 'Birthday card', 'Happy birthday, Wren! Love from your mum and the whole night shift. (Signed: Dot, Gerald, and a very smudged thermos ring.)');
  // Before the Big Hold On: ammo at each corner of the stand, meds, a launcher and throwables.
  b.pick('medkit', 96, 90); b.pick('medkit', 97, 90); b.pick('ammo', 94, 75); b.pick('ammo', 94, 74); b.pick('ammo', 64, 75); b.pick('ammo', 64, 74); b.pick('ammo', 86, 90); b.pick('ammo', 86, 89);
  b.pick('firebomb', 87, 89); b.pick('rattle', 87, 90);
  b.pick('launcher', 88, 84); b.pick('ammo', 88, 85); b.pick('firebomb', 88, 86); b.pick('armor', 87, 84);
  b.label('MAINTENANCE BAY', 80, 80.3, 24, CREAM);
  for (const [x, z] of [[68, 82], [86, 82.6], [68, 90], [92, 88], [80, 76], [96, 76], [64, 95.5]]) b.lamp(x, z);
  b.arrow(80, 75.5, S); b.arrow(85.5, 77, S);
  // Finale arena: the ignition holdout brings its own crowd, so no sleepers wait in the bay.
  b.density(59, 74, 98, 97, 0);

  // ------------------------------------------------------------------
  // 14. Kettle Lane and the Butterwick Night Market (the way round the roadblock)
  // ------------------------------------------------------------------
  // West out of the diner lot along Kettle Lane, then a serpentine between the market's stall rows
  // (tight, shotgun range) and out of its north-west corner to the canal. The office is a side pocket.
  const STALL = [0xff8fab, 0x63e6be, 0xffd43b, 0x9775fa, 0x4dabf7, 0xff922b];
  let si = 0;
  /** A solid row of market stalls from x0 to x1 on row z. */
  const stalls = (x0: number, x1: number, z: number) => {
    for (let x = x0; x <= x1; x += 3) b.prop('counter', x, z, Math.min(3, x1 - x + 1), 1, { color: STALL[si++ % STALL.length] });
  };
  b.carve(34, 49, 58, 54, F.ASPHALT); b.paint(34, 49, 58, 49, F.SIDEWALK); b.paint(34, 54, 58, 54, F.SIDEWALK);
  b.prop('van', 46, 52, 3, 1, { color: 0xff8fab });                  // a crepe van, hatch still open
  b.prop('counter', 52, 49, 3, 1, { color: 0x63e6be }); b.prop('crate', 41, 54); b.prop('dumpster', 36, 54, 2, 1);
  b.pick('ammo', 56, 54);
  b.label('KETTLE LANE', 52, 51.5, 18, CREAM, WEST);
  b.lamp(57, 49.4); b.lamp(44, 54.4); b.lamp(37, 49.4);
  b.arrow(55, 51.5, WEST); b.arrow(42, 51.5, WEST); b.arrow(36.5, 49.5, N);
  // The market yard: three rows of stalls make four lanes, walked east, west, east, west.
  b.carve(34, 24, 57, 46, F.CONCRETE); b.carve(34, 47, 38, 48, F.CONCRETE);
  stalls(34, 52, 43); stalls(39, 57, 37); stalls(34, 52, 32);
  b.prop('crate', 44, 40); b.prop('barrel', 50, 35); b.prop('crate', 40, 27); b.prop('pallet', 47, 45);
  b.pick('medkit', 35, 40); b.pick('ammo', 56, 35);
  b.label('BUTTERWICK NIGHT MARKET', 46, 45.3, 16, PINK, E);
  for (const [x, z] of [[46, 44.4], [48, 40], [44, 34.6], [45, 27]]) b.lamp(x, z);
  b.arrow(44, 45, E); b.arrow(55, 43.5, N); b.arrow(47, 40, WEST); b.arrow(36.5, 37.5, N);
  b.arrow(45, 34.5, E); b.arrow(55, 32.5, N); b.arrow(46, 29, WEST); b.arrow(36.5, 25, N);
  // Market office (optional): the takings, a hand cannon and the manager's chalkboard.
  b.fill(51, 24, 57, 28); b.carve(52, 24, 57, 27, F.INTERIOR); b.carve(54, 28, 55, 28, F.INTERIOR);
  b.prop('desk', 55, 24, 2, 1); b.prop('shelf', 57, 24, 1, 3);
  b.pick('deagle', 52, 24); b.pick('ammo', 53, 24); b.pick('firebomb', 52, 27);
  b.note(56, 26, 'Market office chalkboard', 'SWEET DREAMS NIGHT! Stalls shut at 2:45 so everyone is tucked up by 3. Free Snoozle sleep mask with every jar of honey. Lights OFF, Bert.');
  b.label('MARKET OFFICE', 54.5, 30, 10, CREAM, 0);
  b.lamp(54.5, 25.5);
  // Lantern Alley, out to the canal.
  b.carve(35, 17, 38, 23, F.SIDEWALK);
  b.lamp(38.4, 20);

  // ------------------------------------------------------------------
  // 15. Lantern Canal, the towpath arch and Gumdrop Street
  // ------------------------------------------------------------------
  // A long, straight canal street under strings of lanterns (rifle range), with an optional north
  // towpath over two footbridges. The canal runs east under the railway (a dark three-wide arch, the
  // chokepoint) and on along Gumdrop Street to the river.
  b.carve(34, 1, 99, 2, F.SIDEWALK);                                 // north towpath
  b.carve(34, 3, 221, 6, F.WATER);                                   // the canal, all the way to the river
  b.carve(34, 7, 99, 8, F.CONCRETE); b.carve(34, 9, 99, 14, F.ASPHALT); b.carve(34, 15, 99, 16, F.SIDEWALK);
  b.carve(58, 3, 60, 6, F.WOOD); b.carve(84, 3, 86, 6, F.WOOD);     // footbridges
  b.prop('container', 40, 4, 8, 2, { color: 0xc8324b }); b.prop('container', 66, 3, 7, 2, { color: 0x2f5f78 }); b.prop('container', 91, 4, 6, 2, { color: 0xffd43b });   // moored barges
  car(45, 10, E, 2, 1); car(55, 13, WEST, 2, 1); b.prop('van', 63, 10, 3, 1, { color: 0x9775fa }); car(73, 12, E, 2, 1); car(81, 9, WEST, 2, 1); car(93, 13, E, 2, 1);
  b.prop('bench', 50, 7, 2, 1); b.prop('bench', 77, 7, 2, 1); b.prop('dumpster', 70, 16, 2, 1);
  b.pick('ammo', 66, 16); b.pick('rifle', 72, 1); b.pick('ammo', 73, 1); b.pick('medkit', 40, 1);   // the towpath pays for the detour
  b.label('LANTERN CANAL', 58, 11.5, 30, PINK, E);
  b.label('CANAL ARCH', 95.5, 8, 14, CREAM, E);
  for (const x of [40, 52, 64, 76, 88, 98]) b.lamp(x, 15.6);
  for (const x of [46, 70, 94]) b.lamp(x, 7.3);
  b.lamp(62, 1.3); b.lamp(82, 1.3);
  b.arrow(36.5, 16, N); b.arrow(42, 12, E); b.arrow(68, 12, E); b.arrow(96, 9, E);
  for (let x = 44; x <= 92; x += 16) zz(x, 15.5, WEST);
  b.density(34, 7, 99, 16, 1.5);
  // The arch under the railway: no lamps inside.
  b.carve(100, 7, 117, 9, F.INTERIOR);
  b.prop('barrel', 106, 9); b.prop('crate', 112, 7);
  b.lamp(118.6, 7.3);
  // Gumdrop Street, east to the river.
  b.carve(118, 7, 221, 8, F.CONCRETE); b.carve(118, 9, 221, 14, F.ASPHALT); b.carve(118, 15, 211, 16, F.SIDEWALK);
  car(125, 10, E, 2, 1); car(160, 13, WEST, 2, 1); b.prop('van', 172, 9, 3, 1, { color: 0xe8e3f0 }); car(185, 11, E, 2, 1); car(198, 13, WEST, 2, 1);
  b.prop('container', 165, 4, 7, 2, { color: 0x63e6be }); b.prop('container', 194, 3, 6, 2, { color: 0x8a4a78 });
  b.label('GUMDROP ST', 125, 12, 26, CREAM, E);
  for (const x of [124, 156, 168, 180, 192, 204]) b.lamp(x, 15.6);
  b.arrow(160, 12, E); b.arrow(190, 12, E); b.arrow(208, 12, E);
  b.density(118, 7, 211, 16, 1.2);
  // Snoozle Sleep Shop: a Dreamwell truck has jack-knifed across the street, so the way on is in one
  // door and out of the other.
  b.carve(130, 18, 152, 21, F.TILES); b.carve(132, 17, 133, 17, F.TILES); b.carve(149, 17, 150, 17, F.TILES);
  b.prop('truck', 140, 8, 2, 7, { color: 0xb784e0 }); b.prop('crate', 140, 7, 2, 1); b.prop('barrier', 140, 15, 2, 2);
  b.prop('shelf', 131, 21, 6, 1, { color: 0xffc9de }); b.prop('shelf', 140, 21, 6, 1, { color: 0xffc9de }); b.prop('counter', 147, 20, 1, 2, { color: 0xb784e0 });
  b.pick('ammo', 135, 20); b.pick('medkit', 143, 20); b.pick('firebomb', 151, 21);
  b.note(146, 18, 'Staff memo', 'SWEET DREAMS NIGHT PROMO: every customer gets a free spritz from the Hush tester! New tester stock came in a crate marked HX-9. Same thing, only stronger. Mgmt.');
  b.label('SNOOZLE SLEEP SHOP', 141, 19, 14, PINK, E); b.label('DREAMWELL', 137.5, 11.5, 16, LAV, E);
  b.lamp(136, 19.5); b.lamp(146, 19.5);
  b.arrow(132.5, 15.5, S); b.arrow(138, 19, E); b.arrow(149.5, 16.5, N);

  // ------------------------------------------------------------------
  // 16. The river: Bayfront Promenade, Night Ferry Terminal, Wharf Halt and the freight bridge
  // ------------------------------------------------------------------
  // South along the river (Dot's tower blinks on the far bank), into the ferry terminal, whose alarmed
  // switch opens the freight stairs. Up to Wharf Halt (storey 1) with the horde behind, then west over
  // the freight bridge above Wash Alley and Library Row: one long elevated sightline.
  b.carve(222, 0, 231, 100, F.WATER);                                // the river
  b.carve(212, 15, 221, 61, F.SIDEWALK); b.paint(219, 17, 221, 61, F.WOOD);
  b.carve(233, 34, 234, 35, F.CONCRETE); b.prop('pillar', 233, 34, 2, 2, { color: 0xe8e3f0 });   // Dispatch Tower, far bank
  b.carve(233, 36, 233, 36, F.CONCRETE); b.prop('beacon', 233, 36);
  for (const [x, z] of [[213, 20], [213, 37], [213, 54]]) b.prop('tree', x, z);
  b.prop('bench', 217, 24, 1, 2); b.prop('bench', 217, 46, 1, 2); b.prop('dumpster', 212, 44, 1, 2);
  b.label('BAYFRONT PROMENADE', 216.5, 27, 18, CREAM, N);
  for (const z of [22, 32, 42, 52, 60]) b.lamp(220.6, z);
  b.arrow(215.5, 15, S); b.arrow(216, 34, S); b.arrow(216, 50, S);
  b.density(212, 17, 221, 61, 1.3);
  // Pier (optional): out over the water, the best view of the tower.
  b.carve(222, 38, 229, 40, F.WOOD);
  b.pick('ammo', 229, 39); b.pick('rattle', 229, 38);
  b.label('DISPATCH TOWER', 226, 39, 12, RED, E);
  b.lamp(228.5, 40.6);
  // Saltwater taffy shop (optional).
  b.carve(203, 26, 210, 33, F.TILES); b.carve(211, 29, 211, 31, F.TILES);
  b.prop('counter', 204, 27, 1, 5, { color: 0xff8fab }); b.prop('shelf', 210, 26, 1, 2);
  b.pick('medkit', 206, 32); b.pick('armor', 207, 27); b.pick('cocoa', 209, 33);
  b.label('SALTWATER TAFFY', 207, 30, 12, PINK, WEST);
  b.lamp(207, 29.5);
  // Night Ferry Terminal: doors off the promenade, the ticket office (and its switch) at the far end.
  b.carve(196, 64, 221, 75, F.TILES); b.carve(213, 62, 218, 63, F.TILES);
  b.prop('counter', 199, 64, 1, 6, { color: 0x2f5f78 });            // ticket windows; the office is behind them
  for (const x of [203, 208, 213]) for (const z of [67, 71]) b.prop('bench', x, z, 3, 1);
  b.prop('bus', 222, 64, 2, 10, { color: 0xe8e3f0 });               // the Night Ferry, moored for the night
  const ferrySwitch = b.obj('terminal', 196, 65, 'Open the freight stairs (ALARMED!)');
  b.note(197, 68, "Ferry master's note", 'Last sailing 11:40. Moored her and turned in early for Sweet Dreams Night. The freight stairs switch is in the ticket office. It\'s alarmed, so DON\'T. Hal');
  b.pick('medkit', 205, 74); b.pick('medkit', 206, 74); b.pick('ammo', 197, 75); b.pick('ammo', 198, 75); b.pick('firebomb', 199, 75);   // before the alarm
  b.label('NIGHT FERRY TERMINAL', 215.5, 65.5, 16, TEAL, N); b.label('NO SAILINGS', 219.5, 70, 12, RED, E);
  for (const [x, z] of [[215.5, 61.4], [205, 69.5], [214, 69.5], [197.5, 66.5]]) b.lamp(x, z);
  b.arrow(215.5, 63, S); b.arrow(211, 69.5, WEST); b.arrow(201, 72, WEST);
  // Behind the terminal: the siding yard and the stairs up to Wharf Halt.
  b.carve(195, 71, 195, 73, F.CONCRETE);
  const freightStairs = b.door(195, 71, 195, 73, 'shutter', 'FREIGHT STAIRS');
  b.carve(183, 64, 194, 75, F.CONCRETE);
  b.fill(185, 72, 185, 75); b.fill(188, 72, 188, 75);
  b.stairs(186, 72, 187, 75, '+z');
  b.prop('container', 190, 65, 4, 2, { color: 0x354a7a }); b.prop('crate', 183, 64); b.prop('barrel', 184, 69);
  b.label('UP TO WHARF HALT', 186.5, 70.6, 10, GOLD, N);
  b.lamp(186.5, 70.4);
  b.arrow(192, 72, WEST); b.arrow(186.5, 69.6, S);
  b.level(1);
  b.carve(183, 76, 192, 86, F.CONCRETE);                             // Wharf Halt
  b.carve(141, 84, 182, 86, F.CONCRETE);                             // the freight bridge
  b.prop('container', 190, 77, 2, 7, { color: 0x8a4a78 });          // a stalled wagon
  b.prop('bench', 183, 78, 1, 2); b.prop('crate', 165, 84); b.prop('crate', 152, 86);
  b.pick('ammo', 184, 81); b.pick('ammo', 171, 86);
  b.label('WHARF HALT', 187, 80, 18, CREAM, N); b.label('FREIGHT LINE', 176, 85, 14, GOLD, WEST);
  for (const [x, z] of [[187, 77.4], [185, 86.4], [172, 83.6], [158, 86.4], [146, 83.6]]) b.lamp(x, z);
  b.arrow(186.5, 78, S); b.arrow(186, 85, WEST); b.arrow(178, 85, WEST); b.arrow(160, 85, WEST); b.arrow(145, 85, WEST);
  b.density(141, 76, 192, 86, 0.5);                                 // the alarm horde fills it
  b.level(0);

  // ------------------------------------------------------------------
  // 17. Mallow Junction freight yard and the signal box (checkpoint)
  // ------------------------------------------------------------------
  // Down off the bridge into a dark yard. A stalled freight train splits it: south down the east
  // side, round the tail, north up the west side to the signal box built into the embankment.
  b.carve(118, 57, 132, 103, F.CONCRETE); b.carve(133, 57, 140, 69, F.CONCRETE); b.carve(133, 81, 140, 103, F.CONCRETE);
  b.fill(136, 83, 140, 83); b.fill(136, 87, 140, 87);
  b.stairs(136, 84, 140, 86, '+x');                                  // down from the freight bridge
  for (const [z, d, k] of [[57, 8, 0], [65, 8, 1], [73, 8, 0], [81, 8, 1], [89, 7, 0]] as const)
    b.prop(k ? 'tank' : 'container', 129, z, 2, d, { color: k ? 0x8a8a99 : [0xc8324b, 0x2a7470, 0x6a3a78][z % 3] });
  b.prop('container', 123, 66, 2, 7, { color: 0x354a7a }); b.prop('tank', 123, 76, 2, 6, { color: 0x8a8a99 }); b.prop('container', 123, 85, 2, 6, { color: 0x8a4a78 });
  b.prop('crate', 134, 92); b.prop('pallet', 137, 98); b.prop('crate', 119, 96); b.prop('barrel', 127, 70);
  // Yard office corner (optional): north of the noodle bar's back wall.
  b.prop('desk', 136, 58, 2, 1); b.pick('medkit', 139, 58); b.pick('ammo', 139, 59); b.pick('machete', 134, 58);
  b.label('MALLOW JUNCTION', 125, 100, 20, CREAM, WEST);
  for (const [x, z] of [[134.6, 88.6], [133, 100], [121, 100], [120.5, 79], [137, 60]]) b.lamp(x, z);
  b.arrow(134, 89, S); b.arrow(133, 97, S); b.arrow(127, 100, WEST); b.arrow(120.5, 92, N); b.arrow(120.5, 72, N); b.arrow(119.5, 63, WEST);
  // Signal box safe room: entry from the yard, a door out to Depot Square through the embankment.
  b.carve(107, 58, 116, 66, F.SAFE);
  const boxEntry = b.door(117, 61, 117, 62, 'shutter', 'SAFE ROOM');
  b.carve(99, 61, 105, 63, F.CONCRETE);
  const boxDoor = b.door(106, 61, 106, 63, 'shutter', 'SIGNAL BOX DOOR');
  const boxLever = b.obj('lever', 107, 65, 'Open the depot-side door');
  b.prop('counter', 109, 58, 6, 1, { color: 0x8a8a99 });            // the old lever frame
  for (const x of [108, 109, 110, 111]) b.pick('medkit', x, 66);
  b.pick('ammo', 114, 66); b.pick('ammo', 115, 66); b.pick('ammo', 116, 66);
  b.pick('rifle', 109, 60); b.pick('autoshotgun', 110, 60); b.pick('shotgun', 111, 60); b.pick('smg', 112, 60); b.pick('launcher', 113, 60);
  b.pick('deagle', 114, 60); b.pick('armor', 115, 59); b.pick('firebomb', 116, 59); b.pick('rattle', 116, 60);
  b.label('SAFE ROOM', 111.5, 62.6, 22, RED); b.label('SIGNAL BOX', 111.5, 64.4, 12, CREAM);
  b.label('SIGNAL BOX', 120, 61.5, 14, GOLD, WEST);
  b.lamp(111.5, 62); b.lamp(118.4, 60.4);

  // ------------------------------------------------------------------
  // Quest
  // ------------------------------------------------------------------
  b.start([[7.5, 10.5], [8.5, 11.5], [10.5, 10.5], [11.5, 11.5]]);
  b.use(cbRadio, {
    objective: 'Answer the radio', opens: [shutter],
    radio: [
      ['Dot', 'Hello? Anybody awake out there? Dot at Transit Dispatch. Pick up, sweet pea.'],
      ['Mochi', 'Mochi here! Four of us. All awake. Mostly caffeinated.'],
      ['Dot', 'Good. Get to the Transit Depot. There\'s a shuttle there with your name on it.'],
    ],
  });
  b.reach({ x0: 16, z0: 47, x1: 31, z1: 52 }, {
    objective: 'Head down Marshmallow Avenue',
    radio: [
      ['Dot', 'South down Marshmallow Avenue. Mind the sleepwalkers. They get cranky.'],
      ['Pip', 'Cranky? Dot, they\'re ZOMBIES.'],
      ['Taro', 'Sleepwalkers. Hm. They do look terribly tired.'],
    ],
  });
  b.reach({ x0: 33, z0: 63, x1: 43, z1: 70 }, {
    objective: 'Gear up at Tony\'s Pizza',
    radio: [
      ['Mochi', 'My work! Tony keeps a Boomstick under the till. For rude customers.'],
      ['Nori', 'Is that legal?'],
      ['Mochi', 'It\'s pizza, Nori.'],
    ],
  });
  b.use(garageLever, {
    objective: 'Open the parking garage gate', horde: true, hold: 60, opens: [garageDoor],
    radio: [
      ['Dot', 'Avenue\'s jammed with cars. Cut through the garage. The gate\'s loud, so get ready.'],
      ['Pip', 'Loud is my middle name.'],
      ['Nori', 'Your middle name is Bartholomew.'],
    ],
  });
  b.reach({ x0: 80, z0: 123, x1: 84, z1: 134, lv: 2 }, {
    objective: 'Climb to the garage roof', opens: [libraryEntry],
    radio: [
      ['Taro', 'Look there. The fog\'s pouring out of City Hall.'],
      ['Nori', '\'Sweet Dreams Night.\' The city\'s free sleep thing. Sponsored by Dreamwell.'],
      ['Pip', 'Free sleep. What could possibly go wrong.'],
    ],
  });
  b.gather({ x0: 125, z0: 112, x1: 137, z1: 119 }, {
    objective: 'Get everyone into the library', checkpoint: true, closes: [libraryEntry],
    radio: [
      ['Dot', 'Stair tower at the end of that pier goes down to the square. Library\'s across it.'],
      ['Dot', 'Library\'s got a safe room. Shush in there, it\'s a library.'],
      ['Mochi', 'Ten-minute delivery. Go go go!'],
    ],
  });
  b.use(librarySwitch, {
    objective: 'Open the safe room door', opens: [libraryDoor],
    radio: [
      ['Nori', 'Back door switch is by the shelves. Whenever we\'re ready.'],
      ['Pip', 'Game saved. Okay. Back out into the alleys.'],
    ],
  });
  b.collect('fuse', {
    objective: 'Find fuses for the old tram',
    radio: [
      ['Dot', 'The heritage tram on Cherry Street runs on fuses. Check the alley junction boxes.'],
      ['Dot', 'Lather Laundry keeps spares up in the storeroom. And there\'s one on a fire escape.'],
      ['Pip', 'A fetch quest. In the apocalypse. Classic.'],
      ['Taro', 'Ladders, at my age. Well. Slowly does it.'],
    ],
  });
  b.use(tramLever, {
    objective: 'Power up the heritage tram', horde: true, hold: 90, opens: [underpass], cue: 'tram',
    radio: [
      ['Dot', 'Fuses in, pull the lever. The line powers the underpass gate too.'],
      ['Dot', 'Tram bell rings till she\'s warmed up. Get up on that footbridge.'],
      ['Taro', 'Ah. A dinner bell.'],
      ['Mochi', 'We ARE dinner. Everybody face out!'],
    ],
  });
  b.reach({ x0: 80, z0: 34, x1: 98, z1: 54 }, {
    objective: 'Go under the rail bridge', opens: [pantryEntry],
    radio: [
      ['Nori', 'They\'re all shuffling the same way. North, toward the hills.'],
      ['Taro', 'Like geese heading home.'],
      ['Pip', 'Clock stopped at three. That\'s not creepy at all.'],
    ],
  });
  b.gather({ x0: 60, z0: 42, x1: 67, z1: 46 }, {
    objective: 'Regroup in the Kettle Corner Diner', checkpoint: true, closes: [pantryEntry],
    radio: [
      ['Dot', 'Diner\'s safe room is behind the kitchen. Take a pie. I won\'t tell.'],
      ['Pip', 'Is the pie also a zombie?'],
      ['Nori', 'Everything\'s a zombie until proven otherwise.'],
    ],
  });
  b.use(pantrySwitch, {
    objective: 'Open the safe room door', opens: [dinerDoor],
    radio: [
      ['Taro', 'Pie\'s finished. The back door lever is by the shelves.'],
      ['Mochi', 'The depot\'s right behind this place. Easy delivery!'],
    ],
  });
  b.reach({ x0: 35, z0: 17, x1: 38, z1: 23 }, {
    objective: 'Cut through the night market',
    radio: [
      ['Dot', 'Hold up, sweet pea. The Guard fenced Depot Square off at ten past three.'],
      ['Dot', 'You\'ll have to go round. Through the night market, then along the canal.'],
      ['Pip', 'The scenic route. Love a scenic route.'],
      ['Mochi', 'Long delivery. Still a delivery!'],
    ],
  });
  b.reach({ x0: 118, z0: 7, x1: 123, z1: 16 }, {
    objective: 'Follow the canal under the railway',
    radio: [
      ['Nori', 'The lanterns are still lit. Someone strung these up for Sweet Dreams Night.'],
      ['Taro', 'My Hana loved this canal. We fed the ducks here at midnight, once upon a time.'],
      ['Pip', 'Ducks are fine. Ducks are always fine.'],
      ['Dot', 'Towpath goes under the railway. It\'s dark in that arch. Torches on.'],
    ],
  });
  b.reach({ x0: 212, z0: 30, x1: 221, z1: 42 }, {
    objective: 'Head down to the river',
    radio: [
      ['Dot', 'Down to the river. Look across. See a red light blinking? That\'s my tower.'],
      ['Mochi', 'Hi, Dot! We\'re waving!'],
      ['Dot', 'I\'m waving back. You can\'t see it, but I am.'],
    ],
  });
  b.use(ferrySwitch, {
    objective: 'Open the freight stairs', opens: [freightStairs],
    radio: [
      ['Dot', 'The freight line runs right over Library Row to the junction behind the depot.'],
      ['Dot', 'Stairs up are behind the ferry terminal. Hal keeps the switch in the ticket office.'],
      ['Nori', 'The sign says "ALARMED. STAFF ONLY."'],
      ['Pip', 'We\'re staff now. Night shift.'],
    ],
  });
  b.reach({ x0: 131, z0: 80, x1: 135, z1: 90 }, {
    objective: 'Cross the freight bridge', horde: true, opens: [boxEntry],
    radio: [
      ['Taro', 'There\'s the alarm. Up the stairs, everyone, and don\'t stop on the bridge.'],
      ['Pip', 'Bridge fight! Best kind of fight!'],
      ['Dot', 'West over the alleys, then down into Mallow Junction. Go, go!'],
    ],
  });
  b.gather({ x0: 107, z0: 58, x1: 116, z1: 66 }, {
    objective: 'Get to the signal box', checkpoint: true, closes: [boxEntry],
    radio: [
      ['Dot', 'There\'s a signal box built into the embankment. Thick walls, red door.'],
      ['Nori', 'Red door. Safe room. I love a red door.'],
      ['Taro', 'Round the tail of the train, then up the far side. Mind your feet.'],
    ],
  });
  b.use(boxLever, {
    objective: 'Open the safe room door', opens: [boxDoor],
    radio: [
      ['Dot', 'That door comes out on Depot Square. On the right side of the Guard\'s fence.'],
      ['Taro', 'Last leg, then. For real this time.'],
      ['Mochi', 'Last drop of the night!'],
    ],
  });
  b.reach({ x0: 74, z0: 62, x1: 90, z1: 72 }, {
    objective: 'Reach the Transit Depot', brute: true,
    radio: [
      ['Dot', 'Oh no. That\'s Gerald from the night gate. Gerald, honey, you\'ve let yourself go.'],
      ['Mochi', 'BIG one! Spread out and keep shooting!'],
    ],
  });
  b.use(gateSwitch, {
    objective: 'Open the depot gate', opens: [depotGate],
    radio: [
      ['Dot', 'Gate switch is in Gerald\'s booth. Sorry, Gerald.'],
      ['Taro', 'Gerald and I shared a thermos most nights. Sleep well, big fella.'],
      ['Dot', 'The rest of the yard is locked tight. Anything that wants you comes through that gate.'],
    ],
  });
  b.use(ignition, {
    objective: 'Start the hospital shuttle', horde: true, hold: 180, big: true, opens: [shuttleDoor, bayDoor, busWash, spurGate], at: [85.5, 86.5],
    // The siren pulls the town into Depot Square, and from there through the gate, in front of the Gatling.
    from: [{ x0: 62, z0: 58, x1: 98, z1: 72 }],
    radio: [
      ['Dot', 'Shuttle No. 4\'s battery is moody. Crank her and keep her company. Three minutes.'],
      ['Dot', 'And the Guard wired their evac siren to that bay. Every sleeper in town will come.'],
      ['Pip', 'There\'s a Guard gun on those sandbags. Popcorn Gatling. I named it. It\'s named.'],
      ['Mochi', 'Somebody on the popcorn! Everybody else, face out!'],
      ['Pip', 'Why do all the vehicles have moods?'],
      ['Dot', 'Because they\'re old, sweet pea. Like me.'],
    ],
  });
  b.gather({ x0: 71, z0: 85, x1: 83, z1: 87 }, {
    objective: 'Everybody on the shuttle!',
    radio: [
      ['Dot', 'St. Marigold Hospital. There\'s a helicopter on the roof. Drive safe!'],
      ['Mochi', 'I\'ve never driven a bus.'],
      ['Taro', 'Then I\'ll drive. I\'ve never driven one either, but I\'m older.'],
    ],
  });
  return b.done({ id: META.id, title: META.title, subtitle: META.subtitle, intro: INTRO, theme: THEME });
}
