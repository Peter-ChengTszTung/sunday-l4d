// Chapter 3: "Night Freight" — Mallow Bay Rail Yard & Docks, 5:20 a.m.
// Brief: docs/campaign.md, "Chapter 3: Night Freight".
//
// Big open industrial ground under sodium lamps, then the Hush Works plant, then the
// waterfront. Three storeys (0 ground, 1 at 4.2 m, 2 at 8.4 m):
//   - the freight-car roofs, the water-tower deck, two container stacks, the tank-farm valve
//     catwalk and a wharf stack at the siding are storey-1 perches reached by ladders;
//   - the yardmaster's office is a cabin on stilts (storey 1): front stairs up, back stairs down;
//   - the Hush Works labs (2F) sit over the mixing floor (storey 1), up the main or back stairs,
//     with the break room upstairs too and a fire escape down to the loading yard;
//   - the drawbridge control tower is stacked: hall (0), switchgear (1), control room (2).
//
//   x: 0        45          103 112                       179
//  z 0  +--------T-----------+---+------------------------+
//       |HUT  yard  T  water   E |  | TANK FARM, HX-9 siding  |   T  freight train wall (car roofs 1F)
//       |(start)    T  tower   E |D | valve catwalk (1F)      |   E  engine house
//       |  signal   g (cresc.1)  |o +--plant door------------+   g  the one gap
//    55 +--box------+---gate-----+c | MIXING FLOOR (Hank) 0F  |
//       |          lot/OFFICE 1F |k |  LABS 2F above (1F)     |
//    74 +---------terminal road--+  |  break room 1F (CP)     |
//       | CONTAINER MAZE | CRANE  |R +-------fire escape-----+
//       | (stacks A/B 1F,| YARD   |d |  south wing  | LOADING  |
//       |  reefer)       | fuel pt|  |              |  YARD    |
//   117 +-----------+----TOWER---+--+--------------+-pier gate+
//       ~~~~~~~~~~~~ PIER ~~~~~~~~~ barges, dock cranes ~~~~~~~
//   123 ~~~~~ RIVER ~~~~~ | drawbridge ~~~~~~~~~~~~~~~~~~~~~~~~~
//   140 | DOCK SIDING apron: BERTHA (finale), wharf stack (1F),  ~~~~
//       | boxcars, dock shed                              harbour
//   179 +-------------------------------------------------~~~~~
//
// Route: switchman's hut → across the switching yard to the only gap in the stopped
// freight train → hill-line switch at the water tower (crescendo 1, deck perch) → yard gate →
// up the stilts stairs into the yardmaster's office (checkpoint, 1F) → back stairs down →
// container terminal diesel sweep (fuel point, crane base, two stack tops by ladder, the
// reefer) → terminal gate → Dock Road north → Hush Works gate → tank farm → mixing floor
// (Hank) → main stairs up to the labs (2F) → Wren's lab, terminal four (crescendo 2: zombies
// come up both stairwells) → break room (checkpoint, 2F) → fire escape down → loading yard →
// pier west → control tower: up two flights to the control room → back down and over the
// drawbridge → dock siding → Bertha (finale) → cab and flatcar.
// Tile coordinates: x grows east, z grows south. Arrow rot 0 points south (+z).
import { LevelBuilder, F, WALL, type Theme } from '../level';
import { STOREY } from '../constants';

export const META = { id: 'ch3', title: 'Night Freight', subtitle: 'Mallow Bay Rail Yard & Docks' };

const S = 0, E = Math.PI / 2, WEST = -Math.PI / 2, N = Math.PI;
const SODIUM = '#ffb347', CREAM = '#fff1c9', RED = '#ff5a5a', GOLD = '#ffd43b', LAV = '#c9a8ff', PINK = '#ff8fc8';
const TEAL = '#5fd6c8', STEEL = '#a9aec4', RUSTL = '#ff8a5c', WHITE_L = '#f4f4ff';
const CHERRY = 0xc8324b, YELLOW = 0xf2c14e, LAVTANK = 0xc9a8ff, WHITE = 0xeef2f6;
/** Rust-red and teal boxes, with a few ochre, navy and grey ones. */
const BOX = [0xb5523b, 0x2f8f8a, 0x8a3a32, 0x3f6f8a, 0xc98a3a, 0x2a6a66, 0xa84a5a, 0x5a6478];

/** 5:20 a.m.: an orange sodium glow under a bruised sky, thick lavender fog, black water. */
const THEME: Theme = {
  sky: [0xff9a4d, 0x7a3f62, 0x1a1430],
  fog: 0x6f5470, fogNear: 14, fogFar: 92,
  buildings: [0xa8503c, 0x2f7f86, 0x7a3a34, 0x3f6f8a, 0xc98a3a, 0x4a5466, 0x8a4a3a, 0x2a6a66],
  floors: {
    [F.ASPHALT]: 0x3a3640, [F.CONCRETE]: 0x6e6670, [F.DIRT]: 0x5e5048, [F.SIDEWALK]: 0x7a6352,
    [F.WATER]: 0x0e1420, [F.SAFE]: 0xe8cf9c, [F.INTERIOR]: 0x857a8c, [F.TILES]: 0xd8d4e6,
  },
};

const INTRO = '5:20 a.m. No helicopter, but Dot knows trains. Old Bertha, a diesel locomotive older than Taro, sits dry on the dock siding, and the hill line runs straight out of town. Between you and her: a rail yard, a lot of fog, and the factory where the fog comes from. Someone else is on the radio now. Humming.';

export function build() {
  const b = new LevelBuilder(180, 180, 3);
  let bi = 0;
  /** A shipping container / boxcar / reefer; colour cycles through the rust-and-teal palette. */
  const box = (x: number, z: number, w: number, d: number, color?: number) => b.prop('container', x, z, w, d, { color: color ?? BOX[bi++ % BOX.length] });
  /** A pair of rails between two points (tile coords), painted as steel lines either side of the centre. */
  const rail = (x0: number, z0: number, x1: number, z1: number) => {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz), n = Math.max(1, Math.ceil(len / 12));
    const ux = dx / len, uz = dz / len, rot = Math.atan2(dz, dx), chars = '━'.repeat(Math.ceil((len / n) * 2) + 1);
    for (let i = 0; i < n; i++) {
      const mx = x0 + (dx * (i + 0.5)) / n, mz = z0 + (dz * (i + 0.5)) / n;
      for (const s of [-0.36, 0.36]) b.label(chars, mx - uz * s, mz + ux * s, 20, STEEL, rot);
    }
  };
  /** Sleeper trail: dropped slippers and pillows pointing the way the sleepwalkers went. */
  const zz = (x: number, z: number, rot = N) => b.label('zZ', x, z, 18, LAV, rot);
  /** Lavender fog leaking from the tanks, drifting toward the river. */
  const fog = (x: number, z: number, rot = 0) => b.label('≈≈≈', x, z, 26, LAV, rot);
  /** Signal gantry: masts across the tracks with a sodium lamp on each. */
  const gantry = (z: number, xs: number[], name: string) => {
    for (const x of xs) { b.prop('beacon', x, z); b.lamp(x + 0.5, z + 1.2); }
    b.label(name, (xs[0] + xs[xs.length - 1]) / 2 + 0.5, z + 0.5, 12, RUSTL, 0);
  };

  // ------------------------------------------------------------------
  // 1. Switchman's hut (start safe room) at the service tunnel mouth
  // ------------------------------------------------------------------
  b.carve(2, 9, 6, 12, F.SAFE);                                            // tunnel mouth (from the Galleria)
  b.carve(7, 6, 15, 15, F.SAFE);
  b.walls(0, 7, 6, 14, WALL.ROCK);
  b.label('SERVICE TUNNEL', 4, 10.5, 12, CREAM, E); b.label('TO GALLERIA', 3, 11.6, 9, STEEL, E);
  b.prop('counter', 7, 6, 4, 1, { color: 0x8a6a40 });                     // switchman's bench
  const hutRadio = b.obj('radio', 11, 6, 'Check in with Dot on the wall radio');
  b.prop('shelf', 15, 6, 1, 2); b.prop('desk', 13, 14, 2, 1); b.prop('bench', 7, 13, 1, 2);
  b.prop('barrel', 15, 14, 1, 1, { color: 0xd98a3a });                    // the lantern and oil drum
  b.pick('smg', 8, 15); b.pick('shotgun', 9, 15); b.pick('rifle', 10, 15); b.pick('rifle', 11, 15); b.pick('shotgun', 12, 15);
  b.pick('ammo', 14, 8); b.pick('ammo', 14, 9); b.pick('ammo', 14, 10);
  for (const x of [7, 8, 9, 10]) b.pick('medkit', x, 8);
  b.pick('armor', 11, 8); b.pick('firebomb', 15, 8); b.pick('bat', 13, 15); b.pick('machete', 14, 15);
  b.label('SAFE ROOM', 11, 10.6, 24, RED); b.label("SWITCHMAN'S HUT", 11, 12.6, 14, SODIUM);
  b.lamp(11, 11);
  b.carve(16, 9, 16, 11, F.DIRT);
  const hutDoor = b.door(16, 9, 16, 11, 'shutter', "SWITCHMAN'S HUT");

  // ------------------------------------------------------------------
  // 2. Switching yard: tracks fan out under signal gantries, the freight-train wall
  // ------------------------------------------------------------------
  b.carve(17, 3, 102, 54, F.DIRT);
  b.walls(16, 0, 105, 2, WALL.FENCE, 3); b.walls(16, 55, 105, 56, WALL.FENCE, 3); b.walls(103, 0, 105, 56, WALL.FENCE, 3);
  b.paint(17, 3, 102, 4, F.CONCRETE); b.paint(46, 50, 102, 54, F.CONCRETE);   // service roads
  // The throat: tracks fan out from the tunnel mouth.
  for (const x of [20, 26, 32, 38]) { rail(17.5, 10, x, 18); rail(x, 18, x, x === 20 ? 43 : 54); }
  for (const x of [52, 58, 64, 78, 86, 92, 98]) rail(x, x >= 86 ? 17 : 3, x, 54);
  rail(64, 34, 70, 31.5); rail(78, 34, 74, 31.5);                              // the hill-line switch at the water tower
  b.label('HILL LINE', 72, 33.6, 14, GOLD, 0);
  // The stopped freight train (x 44-45): one long wall with a single gap (z 47-49).
  rail(45, 3, 45, 55);
  b.prop('bus', 44, 3, 2, 6, { color: 0xe8a23a });                          // the freight loco
  for (const z of [9, 14, 19, 39]) box(44, z, 2, 5);
  box(44, 44, 2, 3); box(44, 50, 2, 5);
  // Three boxcars (z 24-38) coupled tight: their roofs are a storey-1 walk, two ladders on the
  // west side. Overwatch across the east yard to the water tower; zombies climb up after you.
  b.fill(44, 24, 45, 38); b.walls(44, 24, 45, 38, WALL.BUILDING, STOREY);
  b.ladder(43, 26, '+x'); b.ladder(43, 36, '+x');
  b.label('LADDER', 42.4, 26.5, 10, GOLD, E); b.label('LADDER', 42.4, 36.5, 10, GOLD, E);
  b.level(1);
  b.carve(44, 24, 45, 38, F.CONCRETE);
  b.label('CAR ROOF', 45, 31, 11, CREAM, E);
  b.pick('ammo', 44, 30); b.pick('ammo', 45, 31); b.pick('medkit', 45, 33);   // reward for the climb
  b.lamp(45, 28); b.lamp(45, 35);
  b.level(0);
  b.label('MBR 4471', 43, 6, 12, CREAM, E);
  b.label('GAP', 45, 48, 14, GOLD, 0);
  // West half: dark ballast, stray cars, the sand tower and the signal box.
  box(19, 22, 2, 5); box(25, 34, 2, 4, 0x6a6a78); box(31, 6, 2, 5); box(37, 40, 2, 5);
  b.prop('pallet', 37, 26, 2, 5);                                            // flatcar
  b.prop('tank', 34, 45, 3, 3, { color: 0x8a8f9e }); b.label('SAND', 35.5, 49, 11, CREAM, 0);
  for (const [x, z] of [[23, 12], [29, 27], [35, 17], [41, 33]]) b.prop('crate', x, z);
  b.prop('barrel', 28, 44); b.prop('barrel', 40, 10);
  gantry(20, [17, 29, 41], 'SIGNAL GANTRY 1'); gantry(38, [48, 60, 75, 100], 'SIGNAL GANTRY 2');
  b.pick('ammo', 23, 30); b.pick('ammo', 41, 51); b.pick('medkit', 29, 52);
  // Signal box (side pocket): lever frame, a rifle.
  b.fill(17, 44, 24, 54); b.carve(18, 46, 23, 53, F.INTERIOR); b.carve(24, 49, 24, 50, F.INTERIOR);
  b.prop('counter', 18, 46, 1, 6, { color: 0x6f7f9a }); b.prop('desk', 21, 52, 2, 1);
  b.pick('rifle', 22, 47); b.pick('ammo', 23, 47);
  b.label('SIGNAL BOX', 21, 49.5, 12, SODIUM); b.lamp(21, 50);
  b.lamp(19, 13); b.lamp(40, 46);
  b.label('SWITCHING YARD', 30, 7, 26, SODIUM);
  b.label('MALLOW BAY RAIL', 30, 9.5, 12, STEEL);
  b.arrow(19, 12, E); b.arrow(30, 30, S); b.arrow(40, 48, E); b.arrow(49, 48, E);
  zz(24, 20, S); zz(34, 38, S); zz(42, 48, E);
  // Car shop (side pocket south of the yard).
  b.fill(27, 55, 42, 68); b.carve(28, 57, 41, 67, F.INTERIOR); b.carve(33, 55, 36, 56, F.INTERIOR);
  box(29, 59, 2, 6); b.prop('shelf', 41, 58, 1, 5); b.prop('counter', 33, 66, 5, 1, { color: 0x6f7f9a });
  b.pick('shotgun', 39, 64); b.pick('medkit', 32, 58); b.pick('ammo', 40, 66); b.pick('firebomb', 40, 65);   // off-route reward
  b.label('CAR SHOP', 35, 61, 16, SODIUM); b.lamp(35, 62);
  // East half: the water tower in the open middle, cover scattered around it. Its pump-house
  // base (storey 0) carries a deck (storey 1) round the tank: two ladders, a perch over the
  // crescendo-1 arena with a reward. Zombies climb both ladders, slowly.
  b.fill(68, 23, 75, 30); b.walls(68, 23, 75, 30, WALL.BUILDING, STOREY);
  b.ladder(67, 26, '+x'); b.ladder(76, 27, '-x');
  b.label('LADDER', 66.3, 26.5, 10, GOLD, E); b.label('LADDER', 77.7, 27.5, 10, GOLD, WEST);
  b.level(1);
  b.carve(68, 23, 75, 30, F.CONCRETE);
  b.prop('tank', 70, 25, 4, 4, { color: 0x8a5a3a });
  for (const [x, z] of [[68, 23], [75, 23], [68, 30], [75, 30]]) b.prop('beacon', x, z);
  b.pick('sniper', 69, 24); b.pick('ammo', 74, 24); b.pick('ammo', 74, 29); b.pick('medkit', 69, 29); b.pick('firebomb', 72, 30);
  b.label('TOWER DECK', 72, 24, 11, CREAM, 0);
  b.lamp(69, 27); b.lamp(75, 27);
  b.level(0);
  const hillSwitch = b.obj('lever', 71, 31, 'Throw the hill line switch (LOUD)');
  b.label('WATER TOWER', 72, 21.6, 16, CREAM, 0);
  box(51, 14, 2, 5); box(57, 30, 2, 5); box(63, 8, 2, 5); box(77, 40, 2, 5); box(85, 24, 2, 5); box(97, 40, 2, 5);
  box(85, 44, 2, 5);
  b.prop('pallet', 63, 40, 2, 5); b.prop('pallet', 91, 28, 2, 6); b.prop('pallet', 51, 26, 2, 5);
  for (const [x, z] of [[66, 21], [76, 32], [67, 33], [60, 46], [81, 30], [88, 36], [55, 22]]) b.prop('crate', x, z);
  b.prop('barrel', 66, 28); b.prop('barrel', 78, 25); b.prop('barrel', 94, 48); b.prop('barrel', 56, 40);
  b.pick('ammo', 66, 30); b.pick('ammo', 67, 30); b.pick('ammo', 76, 29); b.pick('ammo', 76, 30); b.pick('medkit', 66, 23); b.pick('ammo', 60, 20);
  b.pick('rattle', 69, 32);                                      // before the hill-switch holdout
  for (const [x, z] of [[66, 26], [77, 26], [66, 32], [77, 32]]) b.lamp(x, z);
  b.lamp(52, 46); b.lamp(88, 52);
  b.arrow(56, 44, N); b.arrow(64, 35, E); b.arrow(87.5, 50, S);
  zz(58, 42, N); zz(65, 37, E);
  // Engine house (north-east): three bays, two dead locos, a stash.
  b.fill(82, 3, 102, 16); b.carve(83, 4, 101, 14, F.INTERIOR);
  for (const x of [85, 91, 97]) b.carve(x - 1, 15, x + 2, 16, F.INTERIOR);
  b.prop('bus', 85, 5, 2, 8, { color: 0x3f6f4a }); b.prop('bus', 97, 5, 2, 8, { color: 0x8a3a32 });
  b.prop('shelf', 101, 4, 1, 6); b.prop('counter', 88, 4, 1, 5, { color: 0x6f7f9a }); b.prop('crate', 94, 4);
  b.label('PIT', 92, 8, 14, STEEL, E);
  b.pick('sniper', 91, 5); b.pick('rifle', 92, 5); b.pick('shotgun', 93, 5); b.pick('smg', 92, 6); b.pick('ammo', 93, 12); b.pick('medkit', 100, 13); b.pick('medkit', 89, 13); // engine house overlooks the yard
  b.label('ENGINE HOUSE', 92, 13.5, 16, SODIUM); b.lamp(89, 10); b.lamp(95, 10);

  // ------------------------------------------------------------------
  // 3. Office lot and the yardmaster's office (checkpoint)
  // ------------------------------------------------------------------
  b.carve(86, 55, 89, 55, F.ASPHALT);
  const yardGate = b.door(86, 55, 89, 55, 'fence', 'YARD GATE');
  // The lot runs on under the cabin (stilts); a fence at z 73 keeps it off the terminal road.
  b.carve(78, 56, 102, 72, F.ASPHALT);
  b.walls(77, 56, 77, 73, WALL.FENCE, 3); b.walls(78, 73, 102, 73, WALL.FENCE, 3); b.walls(103, 57, 103, 73, WALL.FENCE, 3);
  b.walls(88, 73, 91, 73, WALL.BUILDING, STOREY);                         // block under the back landing
  b.prop('car', 80, 58, 1, 2, { color: 0xc98a3a, rot: N }); b.prop('van', 99, 57, 1, 3, { color: 0xe8e3f0, rot: N });
  b.prop('pillar', 95, 58, 1, 1, { color: 0x2f8f8a }); b.prop('pillar', 96, 58, 1, 1, { color: 0x2f8f8a });  // portaloos
  for (const [x, z] of [[82, 63], [86, 63], [93, 63], [98, 63], [82, 68], [98, 68], [82, 72], [86, 72], [93, 72], [98, 72]]) b.prop('pillar', x, z, 1, 1, { color: 0x6f6a5a });   // the stilts
  b.prop('crate', 90, 67); b.prop('barrel', 85, 70);
  b.pick('ammo', 101, 62); b.pick('ammo', 89, 69);                         // under the cabin
  // Front stairs: a 2-wide flight rising north to south onto the porch, low rails either side.
  b.fill(88, 59, 88, 61); b.fill(91, 59, 91, 61); b.walls(88, 59, 91, 61, WALL.FENCE, 1.2);
  b.stairs(89, 59, 90, 61, '+z');
  b.label('YARDMASTER', 84, 59.5, 18, SODIUM); b.label('STAIRS UP', 89.5, 57.6, 11, GOLD);
  b.lamp(84, 60); b.lamp(95, 61); b.lamp(90, 66);
  b.arrow(89.5, 56.8, S);
  // The cabin (storey 1): sealed safe room with a front door off the porch and a back door.
  b.level(1);
  b.fill(81, 63, 99, 72); b.walls(81, 63, 99, 72, WALL.BUILDING, STOREY);
  b.carve(88, 62, 91, 62, F.CONCRETE);                                     // porch
  b.carve(89, 63, 90, 63, F.CONCRETE);
  const officeEntry = b.door(89, 63, 90, 63, 'shutter', 'YARDMASTER');
  b.lamp(89.5, 62.4);
  b.carve(82, 64, 98, 71, F.SAFE);
  b.prop('desk', 84, 65, 2, 1); b.prop('counter', 92, 64, 5, 1, { color: 0x8a6a40 }); b.prop('terminal', 93, 65);
  b.prop('shelf', 82, 68, 1, 3); b.prop('bench', 96, 68, 1, 2);
  b.note(86, 65, 'Clipboard', 'SPECIAL RUN 2:40 a.m.: 12 tankers HUSH HX-9 to City Hall. Auth: G. Pell. Attached: "NOT SAFE. DO NOT SHIP. W. Lowell." Shipped anyway.');
  for (const x of [84, 85, 86, 87]) b.pick('medkit', x, 71);
  b.pick('ammo', 97, 65); b.pick('ammo', 97, 66); b.pick('ammo', 97, 67);
  b.pick('shotgun', 92, 71); b.pick('rifle', 93, 71); b.pick('smg', 94, 71); b.pick('autoshotgun', 95, 71); b.pick('rifle', 93, 70); // the container maze is next
  b.pick('armor', 88, 71); b.pick('axe', 96, 71); b.pick('rattle', 97, 70);
  const officeLever = b.obj('lever', 98, 71, 'Unlatch the back door');
  b.label('SAFE ROOM', 89.5, 67, 22, RED); b.label("YARDMASTER'S OFFICE", 89.5, 69.4, 12, SODIUM);
  b.lamp(89.5, 68);
  b.carve(89, 72, 90, 72, F.CONCRETE);
  const officeExit = b.door(89, 72, 90, 72, 'shutter', 'BACK STAIRS');
  b.carve(88, 73, 91, 73, F.CONCRETE);                                     // back landing (stairs down: section 4)
  b.label('STAIRS DOWN', 89.5, 73.5, 9, GOLD, 0); b.lamp(89.5, 73.5);
  b.level(0);

  // ------------------------------------------------------------------
  // 4. Container terminal: terminal road, container maze, crane yard, fuel point
  // ------------------------------------------------------------------
  b.carve(6, 74, 104, 77, F.ASPHALT);
  b.carve(6, 78, 104, 100, F.ASPHALT); b.carve(6, 101, 83, 113, F.ASPHALT);
  b.walls(4, 72, 5, 116, WALL.FENCE, 3); b.walls(6, 114, 85, 116, WALL.FENCE, 3); b.walls(84, 101, 85, 113, WALL.FENCE, 3);
  b.label('CONTAINER TERMINAL', 60, 75.8, 22, SODIUM, 0);
  for (const x of [20, 44, 68, 96]) b.lamp(x, 76);
  // The office's back stairs: a 2-wide flight down from the back landing to the terminal road.
  b.fill(88, 74, 88, 76); b.fill(91, 74, 91, 76); b.walls(88, 74, 91, 76, WALL.FENCE, 1.2);
  b.stairs(89, 74, 90, 76, '-z');
  b.arrow(92.5, 77.5, E); b.arrow(86.5, 77.5, WEST); b.arrow(55, 76, WEST);
  // The maze: lanes between stacks of 20 ft / 40 ft boxes; two solid container stacks ('S')
  // whose tops are storey-1 decks reached by ladders, and an open reefer. Laid out on a grid,
  // then lanes are blocked to make dead ends.
  const MX = 6, MZ = 78, MW = 52, MH = 36;
  const grid = Array.from({ length: MH }, () => new Array<string>(MW).fill('.'));
  const put = (c: string, x0: number, z0: number, x1: number, z1: number) => { for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) grid[z][x] = c; };
  const COLS = [[0, 4], [8, 12], [16, 20], [24, 28], [32, 36], [40, 44], [48, 51]];
  for (const [z0, z1] of [[3, 8], [12, 17], [21, 26]]) for (const [x0, x1] of COLS) put('v', x0, z0, x1, z1);
  for (const [x0, x1] of COLS) put('h', x0, 30, x1, 32);
  put('h', 0, 0, 51, 0); put('.', 5, 0, 7, 0); put('.', 29, 0, 31, 0); put('.', 45, 0, 47, 0);   // north wall, three ways in
  // Stack A (north-west): ladders from the south and the east.
  put('S', 0, 3, 12, 8);
  // The open reefer (white), mouth to the north.
  put('.', 24, 12, 28, 17); put('w', 24, 12, 24, 16); put('w', 28, 12, 28, 16); put('W', 24, 17, 28, 17);
  // Stack B (south-east): ladders from the west and the east.
  put('S', 40, 21, 44, 32);
  // Lane blockers.
  put('h', 21, 5, 23, 5); put('v', 34, 9, 34, 11); put('h', 13, 14, 15, 14); put('h', 45, 13, 47, 13);
  put('v', 10, 18, 10, 20); put('v', 42, 18, 42, 20); put('h', 29, 22, 31, 22); put('v', 18, 27, 18, 29);
  put('h', 5, 13, 7, 13); put('v', 26, 18, 26, 20); put('h', 37, 4, 39, 4);
  put('h', 21, 24, 23, 24); put('v', 50, 9, 50, 11); put('v', 50, 27, 50, 29);
  const split = (n: number) => { const out: number[] = []; let left = n; for (let k = Math.ceil(n / 6); k > 0; k--) { const s = Math.ceil(left / k); out.push(s); left -= s; } return out; };
  for (let z = 0; z < MH; z++) for (let x = 0; x < MW;) {
    const c = grid[z][x];
    if (c !== 'h' && c !== 'W') { x++; continue; }
    let e = x; while (e + 1 < MW && grid[z][e + 1] === c) e++;
    let s = x; for (const n of split(e - x + 1)) { box(MX + s, MZ + z, n, 1, c === 'W' ? WHITE : undefined); s += n; }
    x = e + 1;
  }
  for (let x = 0; x < MW; x++) for (let z = 0; z < MH;) {
    const c = grid[z][x];
    if (c !== 'v' && c !== 'w') { z++; continue; }
    let e = z; while (e + 1 < MH && grid[e + 1][x] === c) e++;
    let s = z; for (const n of split(e - z + 1)) { box(MX + x, MZ + s, 1, n, c === 'w' ? WHITE : undefined); s += n; }
    z = e + 1;
  }
  // The stacks: solid two-high blocks (storey 0) with a walkable top (storey 1).
  for (let z = 0; z < MH; z++) for (let x = 0; x < MW; x++) if (grid[z][x] === 'S') b.fill(MX + x, MZ + z, MX + x, MZ + z);
  b.walls(6, 81, 18, 86, WALL.BUILDING, STOREY); b.walls(46, 99, 50, 110, WALL.BUILDING, STOREY);
  b.ladder(12, 87, '-z'); b.ladder(19, 83, '-x');                          // stack A
  b.ladder(45, 105, '+x'); b.ladder(51, 101, '-x');                        // stack B
  b.label('LADDER', 12.5, 88.4, 11, GOLD, 0); b.label('LADDER', 20.4, 83.5, 10, GOLD, WEST);
  b.label('LADDER', 44.6, 106.6, 10, GOLD, 0); b.label('LADDER', 52.4, 101.5, 10, GOLD, E);
  b.label('REEFER 7: OPEN', 32, 89, 12, WHITE_L, 0);
  b.label('MAZE', 37, 102, 30, RUSTL, 0);
  b.pick('smg', 33, 91); b.pick('autoshotgun', 32, 91); b.pick('medkit', 6, 113);
  b.pick('ammo', 22, 97); b.pick('medkit', 52, 88);
  b.lamp(12, 89); b.lamp(32, 88); b.lamp(44, 106); b.lamp(20, 105);
  b.level(1);
  b.carve(6, 81, 18, 86, F.CONCRETE); b.carve(46, 99, 50, 110, F.CONCRETE);
  box(10, 81, 3, 1); box(14, 85, 2, 1); box(48, 103, 1, 2);               // a third tier: cover on the tops
  b.label('STACK TOP A', 12, 83.5, 14, CREAM, 0); b.label('STACK TOP B', 48, 106, 12, CREAM, E);
  b.pick('ammo', 16, 82); b.pick('ammo', 48, 109);
  b.lamp(8, 84); b.lamp(16, 84); b.lamp(48, 101); b.lamp(48, 108);
  b.level(0);
  zz(12, 80, S); zz(36, 88, WEST);
  // Crane yard: long east-west lanes between container rows (rifle country).
  for (const [x0, z0] of [[60, 81], [76, 81], [64, 88], [80, 88], [60, 95], [76, 95]]) { box(x0, z0, 6, 1); box(x0 + 6, z0, 6, 1); box(x0, z0 + 1, 6, 1); box(x0 + 6, z0 + 1, 6, 1); }
  for (const [x, z] of [[75, 84], [75, 92], [91, 84], [91, 92]]) b.prop('pillar', x, z, 1, 1, { color: YELLOW });   // RTG crane legs
  b.label('RTG CRANE 3', 83, 86, 14, GOLD, 0);
  b.prop('truck', 70, 91, 4, 2, { color: YELLOW });                       // straddle carrier
  b.pick('ammo', 59, 86); b.pick('ammo', 88, 98);
  for (const [x, z] of [[62, 79], [80, 79], [70, 86], [86, 93], [66, 99], [82, 99]]) b.lamp(x, z);
  // Dock crane 2: the crane base in the south of the yard.
  for (const [x, z] of [[62, 103], [76, 103], [62, 110], [76, 110]]) b.prop('pillar', x, z, 2, 2, { color: YELLOW });
  b.prop('container', 67, 103, 5, 2, { color: YELLOW });                   // machinery house
  b.prop('gen', 68, 111); b.prop('barrel', 65, 107); b.prop('crate', 80, 106);
  b.label('DOCK CRANE 2', 70, 106, 16, GOLD, 0); b.label('CRANE BASE', 70, 113, 11, CREAM, 0);
  b.pick('medkit', 59, 112);
  b.lamp(70, 108); b.lamp(81, 112);
  // Fuel point (diesel pumps by the terminal gate).
  b.prop('gen', 95, 80, 1, 1); b.prop('gen', 99, 80, 1, 1);               // pumps
  b.prop('tank', 100, 84, 3, 3, { color: 0x9aa0b4 }); b.prop('truck', 94, 84, 2, 5, { color: 0xe8e3f0 });
  b.prop('barrel', 103, 79); b.prop('barrel', 103, 88);
  b.label('FUEL POINT', 97, 78.8, 16, SODIUM, 0); b.label('DIESEL ONLY', 101.5, 88.5, 10, RED, 0);
  b.lamp(97, 82); b.lamp(102, 90);
  // Diesel for Bertha.
  b.item('fuel', 'diesel', 97, 82, 'diesel can');                         // fuel point
  b.item('fuel', 'diesel', 69, 108, 'diesel can');                        // crane base
  b.item('fuel', 'diesel', 32, 94, 'diesel can');                         // inside the reefer
  b.level(1);
  b.item('fuel', 'diesel', 48, 100, 'diesel can');                        // stack top B
  b.item('fuel', 'diesel', 8, 83, 'diesel can');                          // stack top A
  b.level(0);
  // Terminal gate to Dock Road (opens once Bertha has her diesel).
  b.carve(105, 92, 105, 95, F.ASPHALT);
  const termGate = b.door(105, 92, 105, 95, 'fence', 'TERMINAL GATE');
  b.label('TO DOCK ROAD', 101, 93.5, 12, GOLD, E);
  b.arrow(102, 93.5, E);

  // ------------------------------------------------------------------
  // 5. Dock Road (north to the Hush Works gate)
  // ------------------------------------------------------------------
  b.carve(106, 28, 111, 112, F.ASPHALT);
  b.walls(104, 3, 105, 116, WALL.FENCE, 3); b.walls(106, 113, 111, 116, WALL.FENCE, 3);
  b.paint(106, 28, 106, 112, F.SIDEWALK); b.paint(111, 36, 111, 112, F.SIDEWALK);
  b.prop('truck', 107, 44, 2, 6, { color: 0xe8e3f0 }); b.prop('truck', 109, 62, 2, 6, { color: 0xa8503c, rot: N });
  b.prop('truck', 107, 78, 2, 6, { color: 0x3f6f8a }); b.prop('van', 110, 52, 1, 3, { color: 0xc9a8ff });
  b.prop('barrier', 108, 70, 2, 1); b.prop('crate', 111, 86); b.prop('barrel', 106, 58);
  // Truck stop (dead end at the river fence).
  b.prop('dumpster', 106, 108, 1, 2); b.prop('crate', 110, 110); b.prop('truck', 108, 100, 2, 6, { color: 0x8a3a32 });
  b.pick('ammo', 111, 112); b.pick('medkit', 106, 104); b.pick('ammo', 106, 66);
  b.label('DOCK ROAD', 108.5, 90, 22, CREAM, N); b.label('HUSH WORKS', 108.5, 60, 14, LAV, N); b.label('NO ACCESS TO PIER', 108.5, 111.5, 10, RED, N);
  b.label('SLEEP TIGHT, MALLOW BAY!', 111.6, 74, 12, PINK, WEST);
  for (const z of [34, 46, 58, 70, 82, 94, 106]) b.lamp(z % 24 === 10 ? 106.3 : 111.7, z);
  for (const z of [38, 50, 62, 74, 86, 98, 110]) fog(108.5, z, E);       // fog trail from the tanks to the river
  b.arrow(108.5, 92, N); b.arrow(108.5, 56, N); b.arrow(108.5, 32, E);

  // ------------------------------------------------------------------
  // 6. Dreamwell Hush Works: gate plaza, tank farm, the HX-9 siding
  // ------------------------------------------------------------------
  b.carve(112, 29, 112, 34, F.CONCRETE);
  b.carve(113, 3, 178, 38, F.CONCRETE);
  b.walls(112, 0, 179, 2, WALL.FENCE, 4); b.walls(112, 3, 112, 28, WALL.FENCE, 4); b.walls(112, 35, 112, 40, WALL.FENCE, 4);
  b.prop('pillar', 113, 28, 1, 1, { color: 0xc9a8ff }); b.prop('pillar', 113, 35, 1, 1, { color: 0xc9a8ff });   // gate posts
  b.label('DREAMWELL HUSH WORKS', 118, 31.5, 18, LAV, E); b.label('DAYS SINCE INCIDENT: 0', 115.5, 32, 10, RED, E);
  b.note(113, 30, 'Safety poster at the gate', 'HUSH is gentle! Side effects may include deep sleep, sweet dreams, mild humming and, rarely, walking toward pleasant sounds. Sleep tight!');
  // Gatehouse: supplies before the plant.
  b.fill(113, 20, 117, 26); b.carve(114, 21, 116, 25, F.INTERIOR); b.carve(117, 23, 117, 24, F.INTERIOR);
  b.prop('counter', 114, 21, 3, 1, { color: 0x6f7f9a });
  b.pick('medkit', 114, 25); b.pick('medkit', 115, 25); b.pick('ammo', 116, 24); b.pick('magnum', 117, 24);
  b.label('GATEHOUSE', 119.5, 23.5, 11, CREAM, E);
  // HX-9 tanker siding: twelve empty tankers, one bare bay.
  rail(113, 5, 178, 5);
  for (let k = 0; k < 13; k++) {
    const x = 114 + k * 5;
    if (k === 6) { b.label('BAY 7: EMPTY', x + 2, 5, 11, RED, 0); continue; }
    b.prop('tank', x, 4, 4, 2, { color: 0xe8e0f4 });
    b.label('HX-9', x + 2, 7, 12, LAV, 0);
  }
  b.label('HX-9 SIDING', 125, 8.6, 14, RED, 0);
  // Lavender tanks with the Snoozle logo, leaking fog.
  for (const x of [126, 138, 150, 162]) { b.prop('tank', x, 10, 6, 6, { color: LAVTANK }); b.label('SNOOZLE', x + 3, 17, 12, PINK, 0); }
  for (const x of [132, 144, 156, 168]) { b.prop('tank', x, 22, 6, 6, { color: LAVTANK }); b.label('HUSH', x + 3, 29, 12, LAV, 0); }
  for (const x of [130, 142, 154, 166]) { b.prop('valve', x, 18); fog(x + 2, 19); }
  b.prop('barrier', 120, 18, 1, 6); b.prop('barrier', 128, 32, 6, 1); b.prop('barrier', 150, 33, 6, 1);
  // Valve catwalk (storey 1): a walkway on stilts over the valve row between the two tank rows,
  // a ladder at each end against its concrete footings. Optional: a sniper perch over the farm.
  b.fill(124, 18, 125, 19); b.fill(174, 18, 175, 19);
  b.walls(124, 18, 125, 19, WALL.BUILDING, STOREY); b.walls(174, 18, 175, 19, WALL.BUILDING, STOREY);
  b.ladder(123, 18, '+x'); b.ladder(176, 19, '-x');
  b.label('LADDER', 122.4, 18.5, 10, GOLD, E); b.label('LADDER', 176.6, 20.6, 10, GOLD, 0);
  b.level(1);
  b.carve(124, 18, 175, 19, F.CONCRETE);
  b.label('VALVE CATWALK', 136, 18.9, 12, LAV, E);
  b.pick('sniper', 150, 18); b.pick('ammo', 151, 19); b.pick('ammo', 149, 19); b.pick('medkit', 162, 18);
  for (const x of [130, 142, 154, 166]) b.lamp(x, 18.5);
  b.level(0);
  b.pick('ammo', 124, 36); b.pick('ammo', 176, 20);
  for (const [x, z] of [[115, 28], [122, 36], [136, 19], [160, 19], [148, 36], [174, 30], [128, 7], [170, 8]]) b.lamp(x, z);
  fog(124, 30, Math.PI); fog(120, 34, Math.PI);
  b.arrow(120, 33, E); b.arrow(134, 35, E);
  zz(128, 36, E);
  // Plant doors in the south wall (main entrance + loading door).
  b.walls(112, 39, 178, 81, WALL.BUILDING, 2 * STOREY);                 // the plant shell: two storeys
  b.carve(140, 39, 145, 41, F.INTERIOR); b.carve(165, 39, 168, 41, F.INTERIOR);
  b.label('PLANT ENTRANCE', 142.5, 37, 14, CREAM, 0); b.label('LOADING', 166.5, 37, 11, CREAM, 0);
  b.lamp(139, 37); b.lamp(146, 37);

  // ------------------------------------------------------------------
  // 7. Mixing floor (storey 0: Hank, the Brute), lockers, control booth, the two stairs up
  // ------------------------------------------------------------------
  b.carve(113, 42, 177, 80, F.INTERIOR);
  for (const z of [47, 58, 69]) for (const x of [118, 130, 142, 154, 166]) {
    if (x === 142 && z === 58) continue;                                    // open middle around the drain
    if (x === 118 && z === 69) continue;                                    // the locker room is there
    if (x === 166 && z === 47) continue;                                    // the control booth is there
    b.prop('tank', x, z, 4, 4, { color: LAVTANK });
    b.prop('barrier', x - 1, z - 2, 6, 1);                                  // vat railings
  }
  b.label('MIXING FLOOR', 144, 60, 26, LAV, 0); b.label('DRAIN', 144, 62.5, 12, STEEL, 0);
  for (const [x, z] of [[126, 52], [138, 64], [150, 55], [160, 66], [134, 76], [172, 56]]) b.label('~ ~ ~', x, z, 26, LAV, 0);   // purple puddles
  b.prop('barrier', 136, 66, 1, 4); b.prop('barrier', 152, 66, 1, 4); b.prop('pallet', 126, 63, 2, 1); b.prop('crate', 162, 52);
  b.pick('ammo', 148, 52); b.pick('ammo', 128, 78); b.pick('medkit', 160, 78); b.pick('ammo', 176, 70);
  for (const [x, z] of [[124, 45], [148, 45], [136, 56], [160, 56], [148, 68], [124, 68], [172, 74]]) b.lamp(x, z);
  b.arrow(142.5, 43, S); b.arrow(148, 70.5, E); b.arrow(170, 67.5, E); b.arrow(174.9, 66.4, N);
  zz(150, 74, E);
  // Hank's locker room (tank crew).
  b.fill(113, 70, 122, 80); b.carve(114, 71, 121, 79, F.INTERIOR); b.carve(122, 74, 122, 75, F.INTERIOR);
  b.prop('shelf', 114, 71, 7, 1, { color: 0x6f8a9a }); b.prop('shelf', 114, 79, 6, 1, { color: 0x6f8a9a }); b.prop('bench', 117, 75, 3, 1);
  b.note(120, 72, "Hank's open locker", 'Tank 7 crew: Hank took a 20-min power nap inside Tank 7. Came out... bigger. Do not nap in the tanks. Do not nap anywhere.');
  b.pick('medkit', 114, 77); b.pick('ammo', 115, 77);
  b.label('TANK CREW LOCKERS', 117.5, 73.5, 10, CREAM); b.lamp(117.5, 76);
  b.label('TANK 7', 120, 67.5, 14, RED, 0);
  // Control booth (north-east corner).
  b.fill(168, 42, 177, 48); b.carve(169, 43, 176, 47, F.INTERIOR); b.carve(172, 48, 173, 48, F.INTERIOR);
  b.prop('counter', 169, 43, 6, 1, { color: 0x6f7f9a }); b.prop('terminal', 170, 44); b.prop('terminal', 173, 44);
  b.pick('shotgun', 176, 47); b.pick('launcher', 175, 47); b.pick('ammo', 169, 47); // Hank, the Brute, is on the mixing floor
  b.pick('firebomb', 174, 47);
  b.label('MIX CONTROL', 172.5, 46, 11, CREAM);
  // Two real flights up to the labs, both 2 wide and rising north (-z) into the 2F corridor:
  // the main stairs in the south-east corner and the back stairs by the lockers (west).
  b.fill(173, 62, 173, 64); b.fill(176, 62, 177, 64); b.walls(173, 62, 177, 64, WALL.BUILDING, STOREY);
  b.stairs(174, 62, 175, 64, '-z');
  b.fill(113, 62, 113, 64); b.fill(116, 62, 116, 64); b.walls(113, 62, 116, 64, WALL.BUILDING, STOREY);
  b.stairs(114, 62, 115, 64, '-z');
  b.label('STAIRS UP: LABS 2F', 174.5, 66.6, 10, GOLD, 0); b.label('BACK STAIRS UP', 114.5, 66, 10, CREAM, 0);
  b.lamp(174.5, 65.5); b.lamp(114.5, 65.5);

  // ------------------------------------------------------------------
  // 8. Second-floor labs (storey 1, over the mixing floor): Wren's lab (crescendo 2)
  // ------------------------------------------------------------------
  b.walls(113, 42, 177, 81, WALL.BUILDING, STOREY);                     // ground-floor walls stop under the 2F slab
  b.level(1);
  b.fill(113, 42, 177, 81);                                                 // plant mass; rooms carved out below
  b.fill(140, 39, 145, 41); b.fill(165, 39, 168, 41);                      // lintels over the ground-floor doors
  b.carve(113, 58, 177, 60, F.TILES);                                       // 2F corridor
  b.carve(114, 61, 115, 61, F.TILES); b.carve(174, 61, 175, 61, F.TILES);  // stair landings
  b.label('2F: LABORATORIES', 160, 59.6, 14, TEAL, 0);
  b.label('BACK STAIRS', 114.5, 61.4, 9, CREAM, 0); b.label('MAIN STAIRS', 174.5, 61.4, 9, GOLD, 0);
  b.prop('counter', 134, 58, 2, 1, { color: 0xc9d4e0 }); b.prop('bench', 164, 60, 3, 1); b.prop('barrier', 122, 59, 1, 1);
  for (const x of [118, 132, 146, 160, 172]) b.lamp(x, 59.5);
  b.arrow(170, 59.5, WEST); b.arrow(149, 59.5, WEST);
  // Lab A (the back-stair shaft takes its north-west corner).
  b.carve(119, 61, 120, 61, F.TILES); b.carve(117, 62, 125, 73, F.TILES); b.carve(113, 66, 116, 73, F.TILES);
  b.prop('counter', 117, 65, 7, 1, { color: 0xc9d4e0 }); b.prop('counter', 115, 69, 8, 1, { color: 0xc9d4e0 }); b.prop('shelf', 113, 71, 1, 3);
  b.pick('ammo', 124, 72); b.pick('ammo', 125, 72); b.pick('launcher', 124, 71); b.pick('medkit', 117, 63); // before the lab holdout
  b.label('LAB A: STABILITY', 120, 67.5, 11, TEAL); b.lamp(120, 71);
  // Lab B (side door into Wren's lab).
  b.carve(131, 61, 132, 61, F.TILES); b.carve(127, 62, 137, 73, F.TILES); b.carve(138, 67, 138, 68, F.TILES);
  b.prop('counter', 129, 64, 1, 6, { color: 0xc9d4e0 }); b.prop('shelf', 135, 71, 3, 1); b.prop('desk', 133, 65, 2, 1);
  b.pick('ammo', 136, 63); b.pick('ammo', 136, 62); b.pick('ammo', 128, 72);
  b.label('LAB B: AEROSOLS', 132, 69, 11, TEAL); b.lamp(132, 67);
  // Wren's lab: two corridor doors, two side doors, terminal four, the exit to the break room.
  b.carve(142, 61, 143, 61, F.TILES); b.carve(155, 61, 156, 61, F.TILES);
  b.carve(139, 62, 160, 73, F.TILES); b.carve(161, 67, 161, 68, F.TILES);
  for (const x of [141, 144, 147]) b.prop('terminal', x, 73);
  b.prop('counter', 146, 66, 5, 1, { color: 0xd9c7e8 });
  const terminal4 = b.obj('terminal', 151, 66, 'Download the MORNING BELL (terminal four)');
  b.prop('desk', 152, 65, 2, 1);
  b.prop('counter', 142, 69, 1, 3, { color: 0xd9c7e8 }); b.prop('counter', 157, 64, 1, 3, { color: 0xd9c7e8 });
  b.prop('shelf', 160, 70, 1, 3); b.prop('desk', 153, 70, 2, 1);
  b.note(151, 65, "Wren's lab notebook, page 1", 'HX-9 sleepers chase noise because the dream wants quiet. They\'re not cruel. They\'re trying to hush us.');
  b.note(140, 62, "Wren's lab notebook, page 2 (pinned up)", 'MORNING BELL won\'t wake them. I don\'t know how yet. It lets them lie down and rest. Needs the Pinecone Hill mast. Someone must keep it ringing.');
  b.label('∿∿∿∿∿∿∿∿', 147, 62.4, 22, TEAL, 0); b.label('∿∿∿∿∿∿', 158.6, 69, 18, TEAL, WEST);   // sound-wave charts
  b.label('TO WREN, FROM MUM ♥', 152.5, 72.4, 11, PINK, 0);              // a child's drawing
  b.label('FORMULATION: DR. W. LOWELL', 149.5, 68.6, 13, LAV, 0); b.label('TERMINAL 4', 151.5, 64.2, 10, GOLD, 0);
  b.pick('ammo', 140, 72); b.pick('ammo', 140, 73); b.pick('ammo', 159, 62); b.pick('ammo', 159, 63); b.pick('medkit', 145, 71);
  b.pick('rattle', 141, 72);                                     // for the terminal four holdout
  for (const [x, z] of [[144, 64], [156, 68], [148, 71]]) b.lamp(x, z);
  b.arrow(155.5, 60.5, S);
  // Sound lab (side door into Wren's lab; the main-stair shaft takes its north-east corner).
  b.carve(167, 61, 168, 61, F.TILES); b.carve(162, 62, 172, 73, F.TILES); b.carve(173, 66, 177, 73, F.TILES);
  b.prop('shelf', 177, 67, 1, 6, { color: 0x3b3a66 }); b.prop('radio', 168, 67); b.prop('counter', 164, 71, 6, 1, { color: 0xc9d4e0 });
  b.pick('ammo', 163, 63); b.pick('medkit', 174, 72);
  b.label('SOUND LAB', 167, 65, 12, TEAL); b.label('BELL PROTOTYPE', 168.5, 69, 9, GOLD); b.lamp(168, 69);
  // Lab exit → staff passage → break room.
  const labExit = b.door(149, 74, 151, 74, 'shutter', 'STAFF ONLY');
  b.carve(149, 75, 156, 77, F.INTERIOR);
  b.label('BREAK ROOM', 153, 76, 10, CREAM, E);
  const breakEntry = b.door(157, 75, 157, 77, 'shutter', 'BREAK ROOM');

  // ------------------------------------------------------------------
  // 9. Staff break room (storey 1, checkpoint) and the fire escape down
  // ------------------------------------------------------------------
  b.carve(158, 75, 177, 80, F.SAFE);
  b.prop('shelf', 158, 79, 1, 2, { color: 0xff8fc8 }); b.prop('shelf', 177, 75, 1, 2, { color: 0x5fd6c8 });   // vending machines
  b.prop('desk', 161, 77, 2, 2); b.prop('desk', 172, 77, 2, 2); b.prop('counter', 159, 75, 5, 1, { color: 0xd8c2a0 });
  b.prop('barrel', 176, 80, 1, 1, { color: 0x8f93a8 });                   // the bin
  b.note(175, 80, 'Crumpled memo in the bin', 'Wren, Council wants results by Sweet Dreams Night. Your "concerns" are noted. Ship HX-9. G.P. P.S. Get some sleep!');
  b.label('SNOOZLE CALENDAR: MARCH', 161.5, 76.4, 10, PINK);
  for (const x of [159, 160, 161, 162]) b.pick('medkit', x, 80);
  b.pick('ammo', 164, 80); b.pick('ammo', 165, 80); b.pick('ammo', 166, 80);
  b.pick('smg', 170, 76); b.pick('shotgun', 171, 76); b.pick('rifle', 172, 76); b.pick('sniper', 173, 76); b.pick('autoshotgun', 174, 76); b.pick('launcher', 175, 76);
  b.pick('armor', 167, 80); b.pick('armor', 168, 80); b.pick('axe', 169, 80); b.pick('machete', 172, 80); b.pick('firebomb', 176, 77); b.pick('rattle', 177, 80);   // last stop before Bertha
  const breakLever = b.obj('lever', 177, 78, 'Unbolt the fire escape');
  b.label('SAFE ROOM', 165, 78.4, 20, RED); b.label('STAFF BREAK ROOM', 165, 79.8, 11, LAV);
  b.label('FIRE ESCAPE', 170.5, 79.4, 10, GOLD, 0);
  b.lamp(165, 77.5); b.lamp(173, 78);
  const fireDoor = b.door(170, 81, 171, 81, 'shutter', 'FIRE ESCAPE');
  b.carve(169, 82, 172, 82, F.CONCRETE);                                   // fire-escape landing
  b.lamp(170.5, 82.5);
  b.level(0);
  // The flight down (storey 0) against the loading-dock block.
  b.walls(158, 82, 177, 85, WALL.BUILDING, STOREY);
  b.stairs(170, 83, 171, 85, '-z');

  // ------------------------------------------------------------------
  // 9b. Loading yard (south of the plant) to the pier gate
  // ------------------------------------------------------------------
  b.carve(158, 86, 177, 115, F.CONCRETE);
  b.walls(157, 82, 157, 116, WALL.FENCE, 4);
  b.carve(165, 116, 171, 116, F.SIDEWALK);
  b.label('LOADING YARD', 167.5, 92, 18, SODIUM, 0); b.label('PIER GATE', 168, 114.4, 12, GOLD, 0);
  b.prop('truck', 160, 90, 2, 6, { color: 0xe8e0f4 }); b.label('HX-9', 161, 97.4, 11, LAV, 0);   // a tanker trailer that never left
  b.prop('truck', 174, 96, 2, 4, { color: YELLOW });                       // forklift
  for (const [x, z] of [[164, 100], [169, 104], [162, 108], [173, 108]]) b.prop('pallet', x, z, 2, 2);
  for (const [x, z] of [[166, 96], [167, 96], [176, 104], [159, 102]]) b.prop('barrel', x, z, 1, 1, { color: LAVTANK });   // HX-9 drums
  b.prop('crate', 171, 100); b.prop('crate', 160, 113);
  b.pick('ammo', 176, 112); b.pick('medkit', 159, 112);
  for (const [x, z] of [[166, 88], [175, 94], [160, 104], [170, 112]]) b.lamp(x, z);
  b.arrow(170.5, 87.5, S); b.arrow(168, 106, S); b.arrow(168, 115.5, S);
  for (const z of [90, 100, 110]) fog(168, z, 0);
  zz(170, 98, S);

  // ------------------------------------------------------------------
  // 10. River, harbour and the pier walkway (barges, dock cranes, sheds, jetties)
  // ------------------------------------------------------------------
  b.carve(0, 123, 179, 139, F.WATER); b.carve(131, 140, 179, 179, F.WATER);
  b.carve(76, 117, 178, 122, F.SIDEWALK);
  b.walls(86, 116, 179, 116, WALL.FENCE, 3);
  b.label('PIER 4', 160, 120, 22, SODIUM, 0); b.label('NO MOORING', 130, 122.4, 10, RED, 0);
  // Dock cranes straddling the walkway (legs at the edges).
  for (const x0 of [100, 138]) {
    for (const x of [x0, x0 + 6]) { b.prop('pillar', x, 117, 1, 1, { color: YELLOW }); b.prop('pillar', x, 122, 1, 1, { color: YELLOW }); }
    b.label(`DOCK CRANE ${x0 === 100 ? 3 : 4}`, x0 + 3.5, 119.5, 12, GOLD, 0);
  }
  // Jetties and moored barges.
  b.carve(120, 123, 122, 131, F.SIDEWALK); b.carve(150, 123, 152, 129, F.SIDEWALK);
  b.prop('container', 88, 125, 10, 3, { color: 0x2b2a36 }); b.prop('container', 104, 125, 12, 3, { color: 0x3a2a2a });
  b.prop('container', 124, 124, 10, 3, { color: 0x2b3a36 }); b.prop('container', 154, 125, 12, 3, { color: 0x2b2a36 });
  b.prop('crate', 120, 131); b.prop('barrel', 152, 129);
  b.pick('ammo', 122, 130); b.pick('medkit', 150, 128);
  b.label('BARGE: MALLOW MAID', 129, 125.5, 10, CREAM, 0); b.label('JETTY', 121, 125, 10, CREAM, S);
  // Net shed and harbour office (side pockets).
  b.fill(118, 110, 128, 116); b.carve(119, 111, 127, 115, F.INTERIOR); b.carve(122, 116, 124, 116, F.INTERIOR);
  b.prop('shelf', 119, 111, 6, 1); b.prop('pallet', 126, 112, 1, 2);
  b.pick('ammo', 120, 114); b.pick('rifle', 127, 115); b.pick('sniper', 126, 115); // long river sightlines
  b.label('NET SHED', 123, 113, 12, CREAM);
  b.fill(133, 109, 144, 116); b.carve(134, 110, 143, 115, F.INTERIOR); b.carve(138, 116, 139, 116, F.INTERIOR);
  b.prop('desk', 135, 111, 2, 1); b.prop('shelf', 143, 110, 1, 4); b.prop('radio', 140, 110);
  b.pick('medkit', 134, 115); b.pick('ammo', 142, 115); b.pick('armor', 135, 115);   // off-route reward
  b.label('HARBOUR OFFICE', 138.5, 113, 11, CREAM);
  for (const x of [80, 96, 112, 126, 146, 160, 174]) b.lamp(x, x % 2 ? 117.4 : 122.6);
  for (const x of [170, 132, 110]) b.arrow(x, 119.5, WEST);
  b.arrow(168, 117.4, WEST);
  zz(150, 120, WEST); zz(116, 121, WEST);

  // ------------------------------------------------------------------
  // 11. Drawbridge control tower: three stacked floors (hall, switchgear, control room)
  // ------------------------------------------------------------------
  b.walls(86, 108, 97, 116, WALL.BUILDING, 3 * STOREY);                   // the tower shell
  // Storey 0: entrance hall, flight A up the east side.
  b.carve(87, 109, 96, 115, F.INTERIOR); b.carve(90, 116, 93, 116, F.INTERIOR);
  b.fill(94, 109, 94, 112); b.fill(95, 109, 96, 109); b.walls(94, 109, 96, 112, WALL.BUILDING, STOREY);
  b.stairs(95, 110, 96, 112, '-z');
  b.prop('counter', 88, 109, 5, 1, { color: 0x6f7f9a }); b.prop('shelf', 87, 113, 1, 2);
  b.pick('medkit', 92, 114); b.pick('ammo', 88, 115);
  b.label('CONTROL TOWER', 91, 112.4, 14, GOLD); b.label('STAIRS UP', 95.5, 113.6, 10, GOLD, N);
  b.lamp(91, 112); b.lamp(95.5, 114.5);
  b.arrow(93, 114, E); b.arrow(95.5, 114.6, N);
  // Storey 1: switchgear floor, flight B up the west side.
  b.level(1);
  b.carve(87, 109, 96, 115, F.INTERIOR);
  b.fill(87, 109, 89, 110); b.fill(89, 111, 89, 113); b.fill(90, 116, 93, 116);
  b.stairs(87, 111, 88, 113, '-z');
  b.prop('gen', 93, 115); b.prop('gen', 95, 115); b.prop('shelf', 91, 109, 2, 1);
  b.pick('ammo', 96, 114);
  b.label('SWITCHGEAR', 92.5, 112.5, 12, CREAM); b.label('STAIRS UP', 87.5, 114.6, 10, GOLD, N);
  b.label('STAIRS DOWN', 95.5, 109.5, 9, CREAM, 0);
  b.lamp(92, 112); b.lamp(88, 115);
  b.arrow(93.5, 110, WEST); b.arrow(90.5, 114.5, WEST); b.arrow(87.5, 114.4, N);
  // Storey 2: the control room, its front open onto a balcony over the pier (the lit window).
  b.level(2);
  b.carve(87, 109, 96, 115, F.TILES); b.carve(87, 116, 96, 116, F.CONCRETE);
  b.prop('counter', 92, 109, 5, 1, { color: 0x6f7f9a }); b.prop('terminal', 94, 110);
  const bridgeButton = b.obj('lever', 91, 114, 'Lower the drawbridge (BIG RED BUTTON)');
  b.label('BIG RED BUTTON', 91.5, 112.6, 11, RED); b.label('BALCONY: RIVER VIEW', 91.5, 116.4, 9, TEAL);
  b.label('STAIRS DOWN', 89.6, 110.5, 9, CREAM, E);
  b.pick('ammo', 96, 113);
  b.lamp(90, 112); b.lamp(94, 113); b.lamp(88, 116); b.lamp(95, 116);
  b.level(0);
  for (const x of [86.5, 98.5]) b.lamp(x, 117.2);                           // the tower's lit front, seen down the pier
  b.label('DRAWBRIDGE CONTROL', 91.5, 117.8, 16, GOLD, 0);
  b.arrow(91.5, 118.8, N); b.arrow(85, 119.5, WEST);

  // ------------------------------------------------------------------
  // 12. The drawbridge (hill line) over the river
  // ------------------------------------------------------------------
  b.carve(78, 123, 81, 139, F.ASPHALT);
  rail(80, 117, 80, 150);
  const bridgeBarrier = b.door(78, 123, 81, 123, 'fence', 'DRAWBRIDGE RAISED');
  b.label('HILL LINE', 79.9, 131, 14, GOLD, E); b.label('DRAWBRIDGE', 77.2, 120.5, 12, CREAM, 0);
  b.prop('barrier', 76, 121, 1, 2);
  b.lamp(77.5, 124.5); b.lamp(82.5, 137.5);
  b.arrow(80, 121, S); b.arrow(80, 135, S);

  // ------------------------------------------------------------------
  // 13. Dock siding: an open apron with containers on both sides, Bertha (finale)
  // ------------------------------------------------------------------
  b.carve(6, 140, 130, 177, F.CONCRETE);
  b.walls(0, 140, 5, 179, WALL.FENCE, 3); b.walls(6, 178, 130, 179, WALL.FENCE, 3);
  rail(6, 150.5, 130, 150.5); rail(6, 166, 82, 166); rail(84, 158, 130, 158);
  b.label('DOCK SIDING', 64, 147.5, 26, SODIUM, 0);
  // Wharf stacks (north) and yard stacks (south): flanking lanes for the horde.
  for (const [x0, z0] of [[8, 142], [48, 142], [92, 142], [110, 142], [26, 156], [46, 156], [66, 156], [112, 154], [10, 172], [40, 172]]) {
    box(x0, z0, 6, 1); box(x0 + 6, z0, 6, 1); box(x0, z0 + 1, 6, 1);
  }
  // Wharf stack (storey 1 on top): a perch over Bertha's crank, one ladder at each end. Strong
  // ground for the finale, but the horde climbs both ladders and the Brute comes up too.
  b.fill(28, 142, 39, 143); b.walls(28, 142, 39, 143, WALL.BUILDING, STOREY);
  b.ladder(27, 143, '+x'); b.ladder(40, 142, '-x');
  b.label('LADDER', 26.4, 143.5, 10, GOLD, E); b.label('LADDER', 40.6, 141.5, 10, GOLD, WEST);
  b.level(1);
  b.carve(28, 142, 39, 143, F.CONCRETE);
  b.label('WHARF STACK', 33.5, 143, 11, CREAM, 0);
  b.pick('ammo', 32, 142); b.pick('ammo', 35, 143); b.pick('firebomb', 30, 143);
  b.lamp(30, 142.5); b.lamp(37, 142.5);
  b.level(0);
  box(8, 156, 6, 1); box(8, 157, 6, 1);
  // Cars on Bertha's track and the back siding.
  box(46, 150, 5, 2); box(52, 150, 5, 2); b.prop('pallet', 62, 150, 5, 2); box(100, 150, 5, 2); box(106, 150, 5, 2);
  box(12, 165, 5, 2); box(17, 165, 5, 2); box(36, 165, 5, 2); box(41, 165, 5, 2); box(60, 165, 5, 2);
  for (const x of [66, 72, 86, 98, 116, 124]) b.prop('barrel', x, 140, 1, 1, { color: 0x2b2a36 });   // bollards
  b.prop('barrier', 6, 150, 1, 2); b.label('END OF LINE', 8, 153.4, 10, RED, 0);
  for (const [x, z] of [[44, 160], [58, 147], [70, 153], [120, 147], [30, 168], [56, 170]]) b.prop('crate', x, z);
  // Dock shed (pocket with supplies; doors on three sides).
  b.fill(84, 162, 112, 177); b.carve(85, 163, 111, 176, F.INTERIOR);
  b.carve(88, 162, 90, 162, F.INTERIOR); b.carve(104, 162, 106, 162, F.INTERIOR); b.carve(84, 169, 84, 170, F.INTERIOR);
  b.prop('shelf', 86, 164, 1, 10); b.prop('shelf', 110, 164, 1, 10); for (const x of [92, 98]) b.prop('pallet', x, 168, 3, 2);
  b.prop('truck', 94, 172, 6, 2, { color: 0xe8e3f0 });
  b.pick('rifle', 100, 164); b.pick('sniper', 101, 164); b.pick('autoshotgun', 99, 164); b.pick('launcher', 100, 165); b.pick('ammo', 90, 175); b.pick('ammo', 90, 174); b.pick('medkit', 106, 175);
  b.label('DOCK SHED 3', 98, 166.5, 16, SODIUM); b.lamp(92, 165); b.lamp(104, 170);
  // Bertha: a stubby cream-and-cherry diesel with a flatcar coupled behind.
  b.prop('bus', 16, 150, 5, 2, { color: CHERRY });                          // her hood
  b.fill(21, 149, 38, 152);
  b.walls(21, 149, 26, 152, WALL.BUILDING, 3.4); b.walls(27, 149, 38, 152, WALL.BUILDING, 1.2);
  b.carve(22, 150, 25, 151, F.SAFE); b.carve(26, 150, 26, 151, F.SAFE); b.carve(27, 150, 37, 151, F.SAFE);
  const cabDoor = b.door(23, 152, 24, 152, 'shutter', 'BERTHA');
  const ignition = b.obj('valve', 26, 153, 'Pour the diesel and crank Bertha');
  b.label('BERTHA', 18.5, 147.6, 26, '#fff3e0', 0); b.label('No. 9 DIESEL, 1958', 30, 147.8, 11, CREAM, 0);
  b.label('FLATCAR', 33, 154, 11, CREAM, 0);
  b.pick('ammo', 30, 154); b.pick('ammo', 31, 154); b.pick('ammo', 32, 154); b.pick('medkit', 20, 154); b.pick('ammo', 42, 147); b.pick('ammo', 43, 147); b.pick('medkit', 44, 154);
  b.pick('rattle', 33, 154);                                     // for Bertha's long crank
  b.pick('ammo', 60, 154); b.pick('ammo', 61, 154); b.pick('medkit', 72, 146);
  for (const [x, z] of [[19, 154], [30, 155.5], [40, 148], [14, 146], [56, 148], [76, 145], [64, 160], [88, 155], [104, 148], [122, 160], [22, 168], [50, 162]]) b.lamp(x, z);
  b.arrow(80, 143, WEST); b.arrow(62, 147, WEST); b.arrow(44, 152, WEST);
  zz(70, 145, WEST); zz(50, 147, WEST);

  // ------------------------------------------------------------------
  // Quest
  // ------------------------------------------------------------------
  b.start([[10.5, 10.5], [11.5, 11.5], [12.5, 10.5], [12.5, 12.5]]);
  b.use(hutRadio, {
    objective: 'Check in with Dot', opens: [hutDoor],
    radio: [
      ['Dot', 'Rail yard! Old Bertha\'s on the dock siding. She needs diesel and a little love.'],
      ['Taro', 'I\'m good at love. Diesel, less so.'],
    ],
  });
  b.reach({ x0: 46, z0: 40, x1: 62, z1: 54 }, {
    objective: 'Cross the switching yard',
    radio: [
      ['Pip', 'Real trains! Best apocalypse ever.'],
      ['Nori', 'Watch the third rail.'],
      ['Pip', 'There\'s no third rail.'],
      ['Nori', 'Watch it anyway.'],
    ],
  });
  b.use(hillSwitch, {
    objective: 'Throw the hill line switch', horde: true, hold: 60, opens: [yardGate, officeEntry],
    radio: [
      ['Dot', 'The hill line\'s switched off. Big lever by the water tower. It\'s a noisy one.'],
      ['Pip', 'Big lever, big noise, big horde. I\'m learning.'],
      ['Nori', 'Water tower has a ladder. High ground helps, but they climb too.'],
    ],
  });
  b.gather({ x0: 82, z0: 64, x1: 98, z1: 71, lv: 1 }, {
    objective: 'Regroup in the yardmaster\'s office', checkpoint: true, closes: [officeEntry],
    radio: [
      ['Voice', '...hello? Is anyone awake? Please. Don\'t go to the hill without the Bell.'],
      ['Mochi', 'Dot? Was that you?'],
      ['Dot', 'No, sweet pea. That wasn\'t me.'],
    ],
  });
  b.use(officeLever, {
    objective: 'Open the safe room door', opens: [officeExit],
    radio: [
      ['Taro', 'Whoever she is, she sounded tired. Like us.'],
      ['Mochi', 'Back stairs go down to the containers. Let\'s find Bertha a drink.'],
    ],
  });
  b.collect('diesel', {
    objective: 'Find diesel for Bertha', opens: [termGate],
    radio: [
      ['Dot', 'Bertha\'s thirsty. Diesel cans should be lying round the containers.'],
      ['Mochi', 'Five cans. I\'ve delivered heavier pizzas.'],
      ['Pip', 'Two are up on the container stacks. Ladders! I love ladders.'],
    ],
  });
  b.reach({ x0: 113, z0: 26, x1: 124, z1: 38 }, {
    objective: 'Head to the Dreamwell Hush Works',
    radio: [
      ['Taro', 'So this is where the fog comes from. Smells like my grandma\'s sock drawer.'],
      ['Nori', 'Breathe through your sleeve. I mean it.'],
      ['Voice', 'The Hush Works. My lab\'s on the second floor. Terminal four.'],
    ],
  });
  b.reach({ x0: 172, z0: 65, x1: 177, z1: 70 }, {
    objective: 'Cross the mixing floor', brute: true,
    radio: [
      ['Dot', 'Something big\'s moving in that plant. Big and soggy.'],
      ['Pip', 'Why is it always big AND soggy?'],
    ],
  });
  b.use(terminal4, {
    objective: 'Download the Morning Bell', horde: true, hold: 90, opens: [labExit, breakEntry],
    radio: [
      ['Voice', 'The file\'s called MORNING BELL. It won\'t wake them. But it lets them lie still.'],
      ['Nori', 'Who ARE you?'],
      ['Voice', 'The one who made the fog. I\'m so sorry.'],
      ['Nori', 'Two stairwells up here. Watch both!'],
    ],
  });
  b.gather({ x0: 158, z0: 75, x1: 177, z1: 80, lv: 1 }, {
    objective: 'Shelter in the break room', checkpoint: true, closes: [breakEntry],
    radio: [
      ['Dot', 'That voice. Did she give a name, sweet pea?'],
      ['Taro', '...Not yet, Dot. Keep the radio on.'],
    ],
  });
  b.use(breakLever, {
    objective: 'Open the fire escape', opens: [fireDoor],
    radio: [
      ['Nori', 'Fire escape\'s past the vending machines. Take a snack. Doctor\'s orders.'],
      ['Mochi', 'Pier, bridge, Bertha. Three more stops, team.'],
    ],
  });
  b.reach({ x0: 87, z0: 109, x1: 96, z1: 115 }, {
    objective: 'Follow the pier to the drawbridge',
    radio: [
      ['Dot', 'The hill line crosses the drawbridge. It\'s up. Controls are top of the tower.'],
      ['Pip', 'Gulls are fine, right? Gulls didn\'t nap?'],
    ],
  });
  b.use(bridgeButton, {
    objective: 'Lower the drawbridge', opens: [bridgeBarrier],
    radio: [
      ['Mochi', 'Big red button, top floor. My favourite kind.'],
      ['Voice', 'Once you\'re across, I\'ll see your lights from the hill. Hurry.'],
    ],
  });
  b.reach({ x0: 10, z0: 144, x1: 42, z1: 160 }, {
    objective: 'Get to Bertha on the dock siding',
    radio: [
      ['Taro', 'Bridge is down. Back downstairs, everyone.'],
      ['Dot', 'There she is. Bertha! Hello, old girl.'],
      ['Taro', 'She\'s older than me. I like her already.'],
    ],
  });
  b.use(ignition, {
    objective: 'Fuel up and start Bertha', horde: true, hold: 120, opens: [cabDoor],
    // Authored crescendo (the other holdouts get the server's default curve): Bertha coughs to life
    // in fits, so the waves come with breathers between, a Brute midway, then the big rush.
    holdScript: [
      { kind: 'wave', secs: 22 },
      { kind: 'breather', secs: 7, msg: 'Bertha wheezes... keep cranking!' },
      { kind: 'wave', secs: 20, horde: 0.75, flank: true },
      { kind: 'specials', secs: 14, horde: 0.4 },
      { kind: 'breather', secs: 8, msg: 'Bertha coughs. That\'s good, right?' },
      { kind: 'brute', secs: 22 },
      { kind: 'breather', secs: 7 },
      { kind: 'final', secs: 20, msg: 'She\'s nearly up! Hold the line!' },
    ],
    radio: [
      ['Dot', 'Prime her, crank her, and hold on. Bertha takes her time and so should you.'],
      ['Pip', 'Two minutes?! Dot, that\'s like a WEEK.'],
    ],
  });
  b.gather({ x0: 22, z0: 150, x1: 37, z1: 151 }, {
    objective: 'All aboard Bertha!', closes: [cabDoor],
    radio: [
      ['Dot', 'Hill line runs up to Pinecone Hollow. I\'ll meet you near there with the bus.'],
    ],
  });
  return b.done({ id: META.id, title: META.title, subtitle: META.subtitle, intro: INTRO, theme: THEME });
}
