// Chapter 2: "Visiting Hours" — St. Marigold Hospital & Bayside Galleria, 4:40 a.m.
// Brief: docs/campaign.md, "Chapter 2: Visiting Hours".
//
// There is no verticality, so every "floor" is its own wing on the flat grid,
// joined by an elevator shaft and stair corridors (signposted with labels).
//
//   x:  0         40        80   100  125   153    179
//  z 0  +--------------------+-------+     +-------+
//       | FLOOR 4: Sleep     |stair| ROOF / HELIPAD |~~~~~| GALLERIA UPPER  |
//       | Clinic, pods, OBS  |well |  (crescendo 2) |=====| CONCOURSE,      |   ===== skybridge
//    40 +--stairs------------+-----+----------------+~~~~~| ballroom, Dream |   ~~~~~ bay inlet
//       | FLOOR 3: wards, day room, soup, nurses' post |~~~~~| Shop            |
//       |  corridor A west  <------------- elevator    |~~~~~+--BUN BUN TOYS-+
//    88 +-----------------------------------shaft-----+~~~~~| stockroom (CP)  |
//       | GROUND: staff rooms, staff corridor, ELEV LOBBY (cresc. 1)  |  FOOD COURT      |
//       | ER    | waiting | main lobby   | SECURITY/ARCADE| atrium (Brute)   |
//   140 | TRIAGE (start)  | gift, pharmacy|  dock corridor +------------------+
//       | ambulance bay   |               | LOADING DOCK (finale), FREIGHT LIFT
//   179 +-----------------+               | truck yard
//
// Route: triage (ambulance bay) → ER → waiting room → main lobby → staff areas
// (keycard sweep: nurses' station, on-call, radiology, pharmacy) → staff elevator
// lobby (crescendo 1) → elevator to Floor 3 (soup) → west along the ward → stairs up →
// Floor 4 Sleep Clinic → observation room (checkpoint) → stairwell → roof helipad →
// skybridge panel (crescendo 2) → glass skybridge over the bay inlet → Galleria upper
// concourse (ballroom) → Bun Bun Toys stockroom (checkpoint) → food court atrium
// (Snoozle Brute) → arcade → Security breakers → back through the arcade → loading
// dock (finale) → freight lift.
// Tile coordinates: x grows east, z grows south. Arrow rot 0 points south (+z).
import { LevelBuilder, F, WALL, type Theme } from '../level';

export const META = { id: 'ch2', title: 'Visiting Hours', subtitle: 'St. Marigold Hospital & Bayside Galleria' };

const S = 0, E = Math.PI / 2, WEST = -Math.PI / 2, N = Math.PI;
const MINT = '#7cf2c8', CREAM = '#fff1c9', RED = '#ff5a5a', GOLD = '#ffd43b', LAV = '#c9a8ff', PINK = '#ff8fc8';
const SOUP = '#f2a541', LEMON = '#fff27a', MAGENTA = '#ff3df0', SKY = '#8fd8ff';
const GURNEY = 0xe8f0ee, PASTEL = [0xffb3d1, 0xfff1a8, 0xb8f0d8, 0xc9b8ff, 0xffd0a8];

/** 4:40 a.m.: a teal pre-dawn sky, mint-white hospital, dusty pink and lemon mall. */
const THEME: Theme = {
  sky: [0x9fd9c6, 0x46708f, 0x18223f],
  fog: 0x4f7c7a, fogNear: 14, fogFar: 90,
  buildings: [0xcfe6dc, 0x9cc8bd, 0xe6c3d3, 0xeedfa6, 0x8fb4c6, 0xd3a7bf, 0xb3d5ad, 0x7aa59c],
  floors: {
    [F.TILES]: 0xcfe9df, [F.INTERIOR]: 0xc9a3b8, [F.WOOD]: 0xd9c27e, [F.SAFE]: 0xf0e2b6,
    [F.CONCRETE]: 0x76858a, [F.ASPHALT]: 0x434b58, [F.WATER]: 0x2c5a72,
  },
};

const INTRO = '4:40 a.m. The shuttle got you to St. Marigold Hospital, mostly in one piece. Dot says a helicopter is waiting on the roof. Nori used to work nights here and swears the third floor always smells like soup. The beds are empty. Every one of them is neatly made.';

export function build() {
  const b = new LevelBuilder(180, 180);
  let pi = 0;
  const gurney = (x: number, z: number, w = 2, d = 1) => b.prop('bed', x, z, w, d, { color: GURNEY });
  const pastel = () => PASTEL[pi++ % PASTEL.length];
  /** Dropped slippers and pillows pointing the way the sleepers walked. */
  const zz = (x: number, z: number, rot = N) => b.label('zZ', x, z, 18, LAV, rot);

  // ------------------------------------------------------------------
  // 1. Triage station (start safe room), Shuttle No. 4, ambulance bay
  // ------------------------------------------------------------------
  b.carve(8, 140, 20, 147, F.SAFE);
  // Shuttle No. 4 parked nose-first through the bay doors (it seals the gap).
  b.carve(13, 148, 14, 150, F.SAFE);
  b.prop('counter', 9, 141, 3, 1, { color: 0xd8efe8 });                // nurse's desk
  const triageRadio = b.obj('radio', 12, 141, 'Radio Dot from the triage desk');
  gurney(17, 141); gurney(17, 146);
  b.pick('smg', 8, 147); b.pick('smg', 9, 147); b.pick('shotgun', 10, 147); b.pick('shotgun', 11, 147); b.pick('rifle', 12, 147);
  b.pick('ammo', 20, 143); b.pick('ammo', 20, 144); b.pick('ammo', 19, 143);
  for (const z of [142, 143, 144, 145]) b.pick('medkit', 8, z);
  b.label('SAFE ROOM', 17.5, 143.6, 22, RED); b.label('TRIAGE', 10.5, 145.5, 20, MINT);
  b.lamp(10.5, 143.5); b.lamp(17.5, 145);
  b.carve(12, 137, 15, 139, F.TILES);
  const triageDoor = b.door(12, 139, 15, 139, 'shutter', 'TRIAGE');
  // Ambulance bay (open air): ambulances, the shuttle's tail, a pocket of supplies.
  b.carve(4, 151, 44, 176, F.CONCRETE);
  b.prop('bus', 13, 144, 2, 14, { color: 0x5ff2e0 });                   // placed after the bay so the carve keeps it
  b.prop('van', 22, 156, 1, 3, { color: 0xf4f4f4, rot: N }); b.prop('van', 28, 160, 1, 3, { color: 0xf4f4f4, rot: N });
  b.prop('van', 36, 166, 3, 1, { color: 0xff6b6b }); b.prop('barrier', 6, 166, 3, 1); b.prop('barrier', 30, 172, 3, 1);
  for (const [x, z] of [[42, 152], [5, 175], [18, 172], [40, 175]]) b.prop('crate', x, z);
  b.prop('dumpster', 43, 160, 1, 2); b.prop('barrel', 10, 158);
  b.pick('rifle', 23, 160); b.pick('ammo', 24, 160); b.pick('medkit', 41, 170); b.pick('ammo', 6, 152);
  b.label('SHUTTLE No. 4', 13.5, 162, 18, GOLD, E); b.label('AMBULANCE BAY', 26, 168, 28, CREAM);
  b.label('AMBULANCES ONLY', 35.5, 153.5, 14, RED);
  for (const [x, z] of [[8, 154], [30, 154], [20, 166], [40, 166], [10, 174]]) b.lamp(x, z);
  // Ambulance entrance: sliding doors from the bay into the ER.
  b.carve(34, 137, 37, 150, F.TILES);
  gurney(34, 141, 1, 2); b.prop('bench', 37, 146, 1, 2);
  b.label('AMBULANCE ENTRANCE', 35.5, 144, 12, RED, E);
  b.lamp(35.5, 148);

  // ------------------------------------------------------------------
  // 2. Emergency Room (curtained bays) and Radiology (keycard)
  // ------------------------------------------------------------------
  b.carve(4, 118, 36, 136, F.TILES);
  for (const x of [6, 10, 14, 18, 22]) { b.prop('bed', x, 119, 1, 2, { color: GURNEY }); b.prop('counter', x + 2, 118, 1, 3, { color: 0x9fe3cf }); }
  b.prop('counter', 14, 127, 7, 1, { color: 0xd8efe8 }); b.prop('terminal', 17, 128);
  gurney(26, 123); gurney(8, 131); gurney(28, 131); gurney(20, 133, 1, 2);
  b.prop('bench', 5, 126, 1, 3); b.prop('shelf', 33, 118, 3, 1);
  b.pick('ammo', 5, 135); b.pick('medkit', 35, 120);
  b.label('EMERGENCY', 17.5, 123.5, 30, RED); b.label('ER', 31, 128, 40, MINT);
  b.lamp(10, 125); b.lamp(24, 128); b.lamp(14, 134); b.lamp(32, 133);
  b.arrow(13.5, 135, N); b.arrow(22, 130, E); b.arrow(34, 125.5, E);
  // Radiology (keycard on the scanner console), off the ER's south wall.
  b.carve(25, 137, 27, 139, F.TILES);
  b.carve(22, 140, 31, 149, F.TILES);
  b.prop('bed', 24, 143, 3, 1, { color: 0xffffff }); b.prop('pillar', 23, 142, 1, 3, { color: 0xb8d8e8 });   // the scanner
  b.prop('counter', 28, 147, 3, 1, { color: 0x9aa6b8 }); b.prop('terminal', 31, 146);
  b.item('keycard', 'keycard', 30, 148, 'staff keycard');
  b.label('RADIOLOGY', 26.5, 141, 16, SKY); b.label('X-RAY: LEAD LINED', 26.5, 145.6, 11, GOLD);
  b.lamp(27, 146);

  // ------------------------------------------------------------------
  // 3. ER waiting room ("NOW SERVING 303")
  // ------------------------------------------------------------------
  b.carve(37, 121, 37, 129, F.TILES);
  b.carve(38, 116, 58, 138, F.TILES);
  for (const z of [120, 124, 128, 132]) { b.prop('bench', 41, z, 6, 1, { color: 0x7fc8b8 }); b.prop('bench', 50, z, 6, 1, { color: 0x7fc8b8 }); }
  b.prop('terminal', 48, 116, 2, 1); b.prop('counter', 39, 136, 5, 1, { color: 0xd8efe8 });
  b.prop('shelf', 57, 136, 1, 3, { color: 0xffd0a8 });                    // vending machines
  b.pick('ammo', 58, 135);
  b.label('NOW SERVING 303', 49, 117.8, 20, RED);
  b.label('WAITING ROOM', 48, 136.5, 22, MINT);
  b.lamp(44, 122); b.lamp(53, 122); b.lamp(44, 131); b.lamp(53, 131);
  b.arrow(48, 126, E); b.arrow(57, 127, E);
  zz(40, 126, E); zz(47.5, 134.5, E);

  // ------------------------------------------------------------------
  // 4. Main lobby, gift shop, pharmacy (keycard: Nori's old desk)
  // ------------------------------------------------------------------
  b.carve(59, 120, 59, 132, F.TILES);
  b.carve(60, 112, 98, 140, F.TILES);
  for (const [x, z] of [[66, 116], [92, 116], [66, 135], [92, 135]]) b.prop('pillar', x, z, 2, 2, { color: 0xe8f4f0 });
  b.prop('counter', 76, 124, 8, 1, { color: 0x9fe3cf }); b.prop('counter', 76, 128, 8, 1, { color: 0x9fe3cf });
  b.prop('counter', 76, 125, 1, 3, { color: 0x9fe3cf });                    // information desk (open east side)
  b.prop('bench', 64, 125, 1, 4); b.prop('bench', 89, 124, 1, 4); b.prop('bush', 70, 138, 2, 1); b.prop('bush', 86, 138, 2, 1);
  b.prop('bed', 70, 120, 2, 1, { color: 0xd0d0d8 }); b.prop('bench', 84, 132, 3, 1);   // wheelchairs and a gurney
  b.label('MAIN LOBBY', 80, 120, 30, MINT); b.label('INFORMATION', 80, 126.5, 14, CREAM);
  b.label('MAIN ENTRANCE: BARRICADED', 79, 139.3, 14, RED);
  for (const [x, z] of [[64, 114], [72, 130], [80, 116], [88, 130], [96, 114], [96, 138], [64, 138]]) b.lamp(x, z);
  b.arrow(62, 126, E);
  // Gift shop full of balloons.
  b.carve(66, 141, 69, 141, F.TILES); b.carve(62, 142, 74, 150, F.TILES);
  b.prop('shelf', 63, 145, 5, 1, { color: 0xffb3d1 }); b.prop('shelf', 63, 148, 5, 1, { color: 0xfff1a8 }); b.prop('counter', 71, 143, 1, 3);
  for (const [x, z] of [[70, 147], [73, 149], [62, 150], [72, 146]]) b.prop('barrel', x, z, 1, 1, { color: pastel() });   // balloon bunches
  b.pick('medkit', 74, 142); b.pick('ammo', 62, 143);
  b.label('GIFT SHOP', 67.5, 142.6, 16, PINK); b.label('GET WELL SOON', 68, 146.6, 11, LEMON);
  b.lamp(68, 147);
  // Outpatient pharmacy: Nori's old counter.
  b.carve(86, 141, 90, 141, F.TILES); b.carve(82, 142, 97, 152, F.TILES);
  b.prop('counter', 84, 146, 10, 1, { color: 0xc9b8ff });
  for (const x of [83, 87, 91, 95]) b.prop('shelf', x, 150, 3, 1, { color: 0xe8f4f0 });
  b.prop('desk', 95, 148, 2, 1);
  b.item('keycard', 'keycard', 94, 147, 'staff keycard');
  b.pick('ammo', 83, 143);
  b.label('PHARMACY', 89.5, 144, 22, LAV); b.label("NORI'S DESK: DO NOT TOUCH", 92, 148.6, 10, CREAM);
  b.lamp(89, 148);
  b.arrow(88, 139, S);

  // ------------------------------------------------------------------
  // 5. Staff corridor and staff rooms (keycard sweep)
  // ------------------------------------------------------------------
  b.carve(4, 104, 79, 107, F.TILES);
  b.label('STAFF ONLY', 40, 105.5, 22, RED);
  b.label('━━ EMERGENCY ━━', 22, 104.5, 12, RED); b.label('━━ EMERGENCY ━━', 62, 106.6, 12, RED);
  gurney(14, 104); gurney(46, 107); gurney(64, 104); b.prop('bench', 33, 107, 2, 1); b.prop('shelf', 76, 104, 1, 1);
  for (const x of [10, 22, 34, 46, 58, 70]) b.lamp(x, 105.5);
  // Doors from the public side into the corridor.
  b.carve(28, 108, 30, 117, F.TILES);                                     // ER → corridor
  b.carve(70, 108, 73, 111, F.TILES);                                     // lobby → corridor
  b.label('STAFF', 71.5, 110, 14, RED); b.label('STAFF', 29, 113, 14, RED, E);
  // Supply room.
  b.carve(8, 103, 9, 103, F.TILES); b.carve(4, 92, 14, 102, F.TILES);
  b.prop('shelf', 4, 93, 1, 8); b.prop('shelf', 7, 93, 6, 1); b.prop('shelf', 14, 93, 1, 6);
  b.pick('medkit', 6, 97); b.pick('medkit', 12, 100);
  b.label('SUPPLIES', 9, 99, 14, MINT);
  // On-call room (keycard under a pillow).
  b.carve(24, 103, 26, 103, F.TILES); b.carve(17, 92, 34, 102, F.TILES);
  for (const x of [18, 22, 29, 33]) b.prop('bed', x, 93, 1, 2, { color: 0xfff1f0 });
  b.prop('desk', 18, 100, 2, 1); b.prop('shelf', 33, 98, 1, 4);
  b.item('keycard', 'keycard', 30, 93, 'staff keycard');
  b.pick('ammo', 19, 98);
  b.label('ON-CALL', 25.5, 97, 18, MINT);
  b.lamp(25.5, 95);
  // Quiet room (chapel): dark, a little ammo.
  b.carve(41, 103, 43, 103, F.TILES); b.carve(37, 92, 48, 102, F.WOOD);
  for (const z of [95, 98]) { b.prop('bench', 38, z, 4, 1); b.prop('bench', 44, z, 4, 1); }
  b.pick('ammo', 42, 93);
  b.label('QUIET ROOM', 42.5, 100.5, 14, LAV);
  // Lab (rifle).
  b.carve(56, 103, 58, 103, F.TILES); b.carve(51, 92, 64, 102, F.TILES);
  b.prop('counter', 52, 95, 5, 1, { color: 0xe8f4f0 }); b.prop('counter', 59, 95, 5, 1, { color: 0xe8f4f0 }); b.prop('counter', 53, 99, 1, 3, { color: 0xe8f4f0 });
  b.pick('shotgun', 62, 93); b.pick('rifle', 63, 93); b.pick('smg', 64, 93); b.pick('ammo', 63, 92); b.pick('ammo', 52, 93);
  b.label('PATH LAB', 57.5, 98, 16, SKY);
  b.lamp(57.5, 97);
  // Break room (coffee machines), with a side door into the elevator lobby.
  b.carve(71, 103, 73, 103, F.TILES); b.carve(67, 92, 78, 102, F.TILES); b.carve(79, 95, 79, 97, F.TILES);
  b.prop('counter', 67, 92, 6, 1, { color: 0xd8c2a0 }); b.prop('terminal', 73, 92); b.prop('desk', 70, 96, 2, 2); b.prop('desk', 75, 99, 2, 1);
  b.pick('ammo', 77, 93); b.pick('ammo', 76, 93); b.pick('ammo', 68, 101);
  b.label('BREAK ROOM', 72.5, 100.8, 14, MINT);
  b.lamp(72, 98);
  // Records and storage, south side.
  b.carve(8, 108, 9, 108, F.TILES); b.carve(4, 109, 14, 115, F.TILES);
  b.prop('shelf', 5, 110, 1, 5); b.prop('shelf', 8, 111, 5, 1); b.prop('shelf', 8, 114, 5, 1); b.pick('ammo', 13, 115);
  b.label('RECORDS', 9.5, 112.6, 12, MINT);
  b.carve(20, 108, 21, 108, F.TILES); b.carve(16, 109, 26, 115, F.TILES);
  b.prop('crate', 17, 110); b.prop('crate', 25, 114); b.prop('shelf', 23, 110, 3, 1); b.pick('medkit', 17, 115);
  // Nurses' station (keycard by the coffee machine, handover sheet).
  b.carve(36, 108, 52, 108, F.TILES); b.carve(32, 109, 56, 114, F.TILES);
  b.prop('counter', 36, 110, 14, 1, { color: 0x9fe3cf }); b.prop('counter', 49, 111, 1, 2, { color: 0x9fe3cf });
  b.prop('terminal', 55, 109); b.prop('desk', 38, 113, 2, 1); b.prop('desk', 44, 113, 2, 1); b.prop('shelf', 32, 109, 1, 4);
  b.item('keycard', 'keycard', 54, 109, 'staff keycard');
  b.note(41, 111, 'Handover sheet', 'Everyone on nights is fine. Everyone who napped on break got up at 3 and walked out humming. Lesson: NEVER nap on break. Sister Agnes');
  b.label("NURSES' STATION", 44, 108.6, 16, MINT);
  b.lamp(44, 112);
  b.arrow(71.5, 109, N); b.arrow(60, 105.5, WEST); b.arrow(29, 109, S);

  // ------------------------------------------------------------------
  // 6. Staff elevator lobby (crescendo 1: the muzak holdout)
  // ------------------------------------------------------------------
  b.carve(80, 92, 98, 110, F.TILES);
  b.carve(84, 111, 87, 111, F.TILES); b.carve(93, 111, 96, 111, F.TILES);  // two ways in from the main lobby
  b.carve(85, 84, 88, 90, F.TILES);                                       // the elevator car / shaft
  const elevDoor = b.door(85, 91, 88, 91, 'shutter', 'STAFF ELEVATOR');
  const elevButton = b.obj('terminal', 90, 92, 'Call the staff elevator (muzak!)');
  gurney(83, 97); gurney(93, 100); gurney(85, 106, 1, 2);
  b.prop('shelf', 97, 93, 1, 3, { color: 0xffd0a8 }); b.prop('bush', 81, 102); b.prop('bush', 96, 106);
  b.prop('bench', 89, 103, 3, 1); b.prop('desk', 94, 95, 2, 1);
  b.pick('ammo', 82, 93); b.pick('ammo', 83, 93); b.pick('ammo', 98, 109); b.pick('ammo', 98, 108); b.pick('medkit', 91, 108); b.pick('medkit', 81, 109);
  b.label('STAFF ELEVATOR', 87, 94.5, 18, GOLD); b.label('STAFF CARD REQUIRED', 87, 96.5, 11, RED);
  b.label('ELEVATOR', 86.5, 88, 14, GOLD, E);
  for (const [x, z] of [[84, 98], [94, 98], [84, 108], [94, 108], [89, 93]]) b.lamp(x, z);
  b.arrow(90, 101, N); b.arrow(86.5, 86, N);

  // ------------------------------------------------------------------
  // 7. Floor 3: wards, day room, the soup (elevator stuck here)
  // ------------------------------------------------------------------
  b.carve(80, 72, 96, 83, F.TILES);                                       // floor 3 elevator hall
  b.label('FLOOR 3', 88, 79, 40, SOUP); b.label('ELEVATOR STUCK. USE STAIRS', 88, 75.5, 14, SOUP);
  b.label('MMM... SOUP', 92, 82, 12, SOUP);
  b.prop('bed', 81, 73, 2, 1, { color: GURNEY }); b.prop('bench', 94, 80, 1, 3);
  b.lamp(84, 78); b.lamp(93, 76);
  b.arrow(83, 74, WEST);
  // Corridor A runs west the whole length of the floor.
  b.carve(4, 72, 79, 75, F.TILES);
  gurney(70, 72); gurney(52, 75); gurney(33, 72); gurney(18, 75);
  b.prop('bench', 60, 75, 2, 1); b.prop('bench', 26, 72, 2, 1);
  for (const x of [12, 24, 36, 48, 60, 72]) b.lamp(x, 73.5);
  b.arrow(66, 73.5, WEST); b.arrow(42, 73.5, WEST); b.arrow(20, 73.5, WEST);
  // IV stands and wheelchairs dragged toward the stairwell (wordless arrows).
  for (const x of [74, 56, 38, 22]) b.prop('barrier', x, 75, 1, 1);
  zz(46, 73.5, WEST); zz(28, 74.5, WEST);
  // Wards south of corridor A.
  for (const [x0, x1] of [[10, 18], [21, 29], [32, 40], [43, 51], [54, 62], [65, 76]]) {
    const mid = Math.floor((x0 + x1) / 2);
    b.carve(mid, 76, mid + 1, 76, F.TILES); b.carve(x0, 77, x1, 86, F.TILES);
    b.prop('bed', x0 + 1, 79, 1, 2, { color: 0xfff1f0 }); b.prop('bed', x1 - 1, 83, 1, 2, { color: 0xfff1f0 });
    b.prop('desk', x0 + 1, 85, 1, 1);
  }
  b.pick('ammo', 12, 85); b.pick('medkit', 39, 78); b.pick('ammo', 60, 85); b.pick('medkit', 74, 79);
  b.label('WARD 3A', 14, 81, 12, MINT); b.label('WARD 3C', 36, 81, 12, MINT); b.label('WARD 3E', 58, 81, 12, MINT);
  // Day room and soup kitchen, joining corridor A to corridor B.
  b.carve(46, 71, 54, 71, F.TILES); b.carve(46, 56, 54, 57, F.TILES);
  b.carve(40, 58, 60, 70, F.TILES);
  for (const [x, z] of [[43, 61], [48, 61], [43, 66], [48, 66]]) b.prop('desk', x, z, 2, 2);
  b.prop('counter', 54, 59, 1, 9, { color: 0xf2c48d }); b.prop('gen', 57, 61, 2, 2, { color: 0xf2a541 });   // the soup pot
  b.prop('shelf', 59, 66, 2, 1);
  b.pick('medkit', 58, 69); b.pick('ammo', 57, 58);
  b.label('DAY ROOM', 46, 64, 22, MINT); b.label('SOUP', 57.5, 64.5, 18, SOUP);
  b.lamp(46, 63.5); b.lamp(57, 66);
  // Floor 3 nurses' post (east, a loop back to the elevator hall).
  b.carve(61, 60, 61, 66, F.TILES); b.carve(84, 71, 92, 71, F.TILES);
  b.carve(62, 52, 96, 70, F.TILES);
  b.prop('counter', 68, 60, 12, 1, { color: 0x9fe3cf }); b.prop('counter', 79, 61, 1, 4, { color: 0x9fe3cf });
  gurney(66, 54); gurney(86, 56); gurney(90, 66); b.prop('shelf', 95, 52, 1, 5); b.prop('bench', 70, 67, 3, 1);
  b.pick('ammo', 94, 69); b.pick('smg', 72, 54);
  b.label("NURSES' POST 3", 74, 57, 18, SOUP);
  b.lamp(73, 63); b.lamp(88, 61);
  // Patient rooms between the corridors (doors on both sides: loops).
  for (const [x0, x1] of [[10, 21], [24, 37]]) {
    const mid = Math.floor((x0 + x1) / 2);
    b.carve(mid, 71, mid + 1, 71, F.TILES); b.carve(mid, 56, mid + 1, 57, F.TILES);
    b.carve(x0, 58, x1, 70, F.TILES);
    b.prop('bed', x0 + 1, 60, 1, 2, { color: 0xfff1f0 }); b.prop('bed', x1 - 1, 60, 1, 2, { color: 0xfff1f0 });
    b.prop('bed', x0 + 1, 66, 1, 2, { color: 0xfff1f0 }); b.prop('bed', x1 - 1, 66, 1, 2, { color: 0xfff1f0 });
    b.prop('desk', mid, 64, 2, 1);
  }
  b.pick('ammo', 13, 69); b.pick('ammo', 33, 59);
  // Corridor B and the rooms above it.
  b.carve(4, 52, 60, 55, F.TILES);
  gurney(20, 52); gurney(40, 55); b.prop('bench', 50, 52, 2, 1);
  b.lamp(18, 53.5); b.lamp(38, 53.5);
  for (const [x0, x1] of [[12, 22], [26, 36]]) {
    const mid = Math.floor((x0 + x1) / 2);
    b.carve(mid, 51, mid + 1, 51, F.TILES); b.carve(x0, 45, x1, 50, F.TILES);
    b.prop('bed', x0 + 1, 46, 2, 1, { color: 0xfff1f0 }); b.prop('shelf', x1, 45, 1, 3);
  }
  b.pick('medkit', 20, 49); b.pick('ammo', 34, 49);
  b.label('LINEN', 17, 48, 12, MINT); b.label('STORE', 31, 48, 12, MINT);
  // West stair hall: both corridors end here, stairs up to floor 4.
  b.carve(4, 44, 8, 75, F.TILES);
  b.prop('bench', 4, 62, 1, 2); b.prop('barrier', 8, 66);
  b.label('STAIRS UP', 6.5, 58, 18, GOLD, N); b.label('FLOOR 4: SLEEP CLINIC', 6.5, 48, 11, LAV, N);
  b.lamp(6.5, 70); b.lamp(6.5, 56); b.lamp(6.5, 46);
  b.arrow(6.5, 66, N); b.arrow(6.5, 50, N);

  // ------------------------------------------------------------------
  // 8. Floor 4: Dreamwell Sleep Clinic
  // ------------------------------------------------------------------
  b.carve(5, 38, 8, 43, F.TILES);                                         // the stairs
  b.label('FLOOR 4', 6.5, 40.5, 16, GOLD, N);
  b.carve(4, 22, 22, 37, F.TILES);                                        // clinic reception
  b.prop('counter', 12, 26, 8, 1, { color: 0xc9b8ff }); b.prop('terminal', 19, 25);
  b.prop('bench', 4, 28, 1, 4); b.prop('bench', 16, 33, 4, 1); b.prop('bush', 21, 23);
  b.pick('ammo', 5, 23); b.pick('medkit', 21, 36);
  b.label('DREAMWELL SLEEP CLINIC', 13, 30, 20, LAV);
  b.label('SNOOZLE SAYS: SLEEP TIGHT', 13, 35.5, 12, PINK);
  b.lamp(8, 33); b.lamp(16, 28);
  b.arrow(9, 35, E); b.arrow(21, 30, E);
  // Sleep pod ward: rows of empty, perfectly made pods.
  b.carve(23, 27, 23, 33, F.TILES);
  b.carve(24, 4, 60, 38, F.TILES);
  let pod = 0;
  for (const z of [8, 15, 22, 29]) for (const x of [28, 33, 38, 43, 48, 53]) {
    pod++;
    if (pod === 20) continue;                                             // a gap in the rows: bed 20 got up and left
    b.prop('bed', x, z, 2, 3, { color: 0xe8dcff });
  }
  b.prop('pillar', 41, 4, 2, 1, { color: 0xf4f0e0 });                    // the wall clock
  b.label('3:00', 42, 5.6, 26, GOLD);
  b.prop('shelf', 24, 4, 1, 4, { color: 0xffffff });                     // whiteboard
  b.note(25, 6, 'Sleep Clinic whiteboard', 'HX-9 TRIAL: deep sleep, 100%. Side effect: sleepwalks toward the chime tone. Stop the chime, they stop? Ask Dr. Lowell. DO NOT tell Pell.');
  // Bed 12 is the last pod of the second row (x 53, z 15).
  b.note(55, 16, 'Patient chart, bed 12', '"In the dream I\'m looking for somewhere quiet. Everything awake is so LOUD." Walked 40 m toward the chime. Calmed when shushed.');
  b.label('12', 54, 14.4, 12, CREAM);
  for (const [x, z] of [[26, 12], [26, 26], [59, 6], [59, 36]]) b.label('SNOOZLE', x + (x > 40 ? -2 : 2), z, 14, PINK, x > 40 ? WEST : E);
  b.label('SLEEP TRIALS', 42, 36.5, 24, LAV);
  b.pick('ammo', 46, 26); b.pick('ammo', 31, 36);
  for (const [x, z] of [[30, 12], [42, 12], [54, 12], [30, 26], [42, 26], [54, 26], [42, 19]]) b.lamp(x, z);
  b.arrow(30, 31.5, E); b.arrow(46, 32.5, E); b.arrow(58, 20, N);
  // Observation room (checkpoint): one-way glass onto the ward, a monitoring desk.
  b.carve(61, 12, 62, 13, F.TILES);
  const obsEntry = b.door(63, 12, 63, 13, 'shutter', 'OBSERVATION');
  b.carve(61, 7, 63, 10, F.TILES); b.prop('barrier', 61, 7, 3, 4, { color: 0xbfe8f0 });   // the one-way glass
  b.label('ONE-WAY GLASS', 62, 9, 10, SKY, E);
  b.carve(64, 6, 76, 17, F.SAFE);
  b.prop('counter', 65, 6, 6, 1, { color: 0x9aa6b8 }); b.prop('terminal', 66, 7); b.prop('terminal', 69, 7);
  b.prop('desk', 72, 7, 2, 1);
  b.note(73, 8, 'Lanyard on the desk', 'DREAMWELL SLEEP CO. Dr. Wren Lowell, Lead Formulation. Emergency contact: Dorothy "Dot" Lowell (Mum), Mallow Bay Transit.');
  b.note(76, 15, 'Taped to the stairwell door', 'LARRY. Do NOT nap in the chopper. We have talked about this. Mgmt');
  for (const x of [64, 65, 66, 67]) b.pick('medkit', x, 17);
  b.pick('ammo', 74, 6); b.pick('ammo', 75, 6); b.pick('ammo', 76, 6);
  b.pick('sniper', 69, 17); b.pick('shotgun', 70, 17); b.pick('rifle', 71, 17); b.pick('smg', 72, 17); b.pick('autoshotgun', 73, 17);
  const obsLever = b.obj('lever', 76, 10, 'Unlock the stairwell door');
  b.label('SAFE ROOM', 70, 12, 22, RED); b.label('OBSERVATION', 70, 14.5, 14, LAV);
  b.lamp(70, 11);
  b.arrow(60, 12.5, E);
  // Stairwell up to the roof.
  const stairDoor = b.door(77, 11, 77, 13, 'shutter', 'STAIRWELL');
  b.carve(78, 4, 86, 16, F.TILES);
  b.prop('barrier', 82, 9, 3, 1); b.prop('barrier', 79, 13, 3, 1);       // switchback railings
  b.pick('ammo', 85, 15); b.pick('medkit', 86, 15);
  b.label('STAIRS UP: ROOF', 82, 11.5, 14, GOLD); b.label('HELIPAD', 84, 6, 14, CREAM, E);
  b.lamp(82, 14); b.lamp(82, 6);
  b.arrow(80, 11, N); b.arrow(85, 6.5, E);
  // East offices: a dead-end side pocket off the ward.
  b.carve(61, 29, 63, 31, F.TILES); b.carve(64, 21, 86, 38, F.TILES);
  for (const x of [66, 72, 78]) { b.prop('desk', x, 24, 3, 1); b.prop('shelf', x, 21, 3, 1); }
  b.prop('counter', 70, 31, 1, 7, { color: 0xc9b8ff }); b.prop('bed', 80, 33, 2, 3, { color: 0xe8dcff });
  b.pick('medkit', 85, 22); b.pick('rifle', 84, 37); b.pick('ammo', 65, 37);
  b.label('NAP POD SHOWROOM', 80, 30, 14, LAV); b.label('DR. W. LOWELL', 73, 26, 12, CREAM);
  b.lamp(75, 30);

  // ------------------------------------------------------------------
  // 9. Roof and helipad (crescendo 2 at the skybridge end)
  // ------------------------------------------------------------------
  b.carve(87, 5, 87, 8, F.CONCRETE);
  b.carve(88, 2, 124, 44, F.CONCRETE);
  // Roof access huts: other stair cores, where the horde boils up from.
  b.fill(89, 35, 97, 44); b.carve(90, 36, 96, 43, F.TILES); b.carve(93, 35, 94, 35, F.TILES);
  b.fill(112, 2, 122, 10); b.carve(113, 3, 121, 9, F.TILES); b.carve(116, 10, 117, 10, F.TILES);
  b.fill(104, 37, 112, 44); b.carve(105, 38, 111, 43, F.TILES); b.carve(105, 37, 106, 37, F.TILES);
  // Two more pockets close to the skybridge panel, so the horde can boil up out of sight nearby.
  b.fill(114, 38, 124, 44); b.carve(115, 39, 123, 43, F.TILES); b.carve(115, 38, 116, 38, F.TILES);
  b.fill(118, 12, 124, 22); b.carve(119, 13, 123, 21, F.TILES); b.carve(118, 16, 118, 18, F.TILES);
  b.prop('gen', 120, 14, 2, 2, { color: 0xb8c4c8 }); b.prop('crate', 122, 42);
  b.label('PLANT ROOM', 121, 19, 10, CREAM); b.label('ROOF ACCESS E', 119, 41, 12, CREAM);
  b.label('ROOF ACCESS B', 93.5, 39, 12, CREAM); b.label('ROOF ACCESS C', 117, 6, 12, CREAM); b.label('ROOF ACCESS D', 108, 41, 12, CREAM);
  b.prop('crate', 91, 37); b.prop('crate', 119, 4); b.prop('barrel', 110, 39);
  // The helipad: big H, landing lights, skid marks, no helicopter.
  b.label('H', 106, 20, 110, CREAM); b.label('NO HELICOPTER', 106, 27.5, 12, RED);
  b.label('~~ skid marks ~~', 112, 14, 14, '#2b2b3a', 0.4);
  for (const [x, z] of [[99, 12], [111, 12], [99, 28], [111, 28]]) b.prop('beacon', x, z);
  // HVAC units, vents and crates: imperfect cover.
  b.prop('gen', 91, 14, 3, 2, { color: 0xb8c4c8 }); b.prop('gen', 91, 24, 3, 2, { color: 0xb8c4c8 }); b.prop('gen', 112, 20, 2, 2, { color: 0xb8c4c8 });
  b.prop('container', 100, 39, 2, 4, { color: 0x8fb4c6 }); b.prop('crate', 110, 33); b.prop('crate', 111, 33); b.prop('pallet', 102, 33, 2, 1);
  b.prop('barrier', 118, 27, 1, 3); b.prop('barrier', 113, 34, 3, 1); b.prop('pallet', 96, 4, 2, 1);
  b.pick('ammo', 120, 35); b.pick('ammo', 121, 35); b.pick('ammo', 122, 35); b.pick('medkit', 122, 36); b.pick('ammo', 89, 3);
  b.pick('launcher', 119, 35); b.pick('sniper', 120, 36); // before the skybridge holdout; long roof sightlines
  b.label('HELIPAD', 106, 4.5, 26, CREAM);
  b.label('SKYBRIDGE', 121, 32, 16, GOLD, E);
  for (const [x, z] of [[90, 4], [124, 4], [89, 31], [124, 26], [124, 35], [100, 44], [113, 44]]) b.lamp(x, z);
  b.arrow(92, 7, E); b.arrow(112, 28, E); b.arrow(122, 31, E);
  // The skybridge control panel and shutter.
  const skyPanel = b.obj('lever', 124, 30, 'Raise the skybridge shutter (LOUD)');
  b.carve(125, 31, 125, 33, F.INTERIOR);
  const skyShutter = b.door(125, 31, 125, 33, 'shutter', 'SKYBRIDGE');

  // ------------------------------------------------------------------
  // 10. Bay inlet and the glass skybridge
  // ------------------------------------------------------------------
  b.carve(126, 20, 152, 30, F.WATER); b.carve(126, 34, 152, 79, F.WATER);
  b.carve(126, 31, 152, 33, F.INTERIOR);
  b.prop('bench', 133, 31, 2, 1); b.prop('barrier', 141, 33, 1, 1); b.prop('bench', 147, 31, 2, 1);
  b.label('SKYBRIDGE TO BAYSIDE GALLERIA', 139, 32, 14, GOLD, E);
  for (const x of [129, 137, 145, 151]) b.lamp(x, 32);
  b.arrow(131, 32, E); b.arrow(144, 32, E);

  // ------------------------------------------------------------------
  // 11. Galleria upper concourse: ballroom, chandelier, Dream Shop
  // ------------------------------------------------------------------
  b.carve(153, 4, 178, 50, F.INTERIOR);
  b.paint(158, 21, 174, 39, F.WOOD);                                       // the old ballroom floor
  for (const [x, z] of [[158, 21], [173, 21], [158, 38], [173, 38]]) b.prop('pillar', x, z, 1, 1, { color: 0xffe0b0 });
  b.label('BAYSIDE GALLERIA', 166, 34, 28, PINK); b.label('GRAND BALLROOM 1931', 166, 26, 14, LEMON);
  // The chandelier: a ring of lights over the old dance floor.
  for (let a = 0; a < 8; a++) b.lamp(166 + Math.cos((a * Math.PI) / 4) * 4, 30 + Math.sin((a * Math.PI) / 4) * 4);
  b.lamp(166, 30);
  b.prop('bench', 155, 24, 1, 3); b.prop('bench', 155, 35, 1, 3); b.prop('bush', 177, 30); b.prop('bush', 177, 22);
  b.pick('ammo', 170, 47); b.pick('medkit', 159, 49);
  // The Dream Shop: pyjama-clad mannequins and a scrawled poster.
  b.fill(153, 15, 170, 15); b.carve(159, 15, 163, 15, F.INTERIOR);
  for (const [x, z] of [[156, 7], [159, 7], [162, 7], [156, 11], [159, 11], [162, 11]]) b.prop('pillar', x, z, 1, 1, { color: pastel() });
  b.prop('counter', 166, 6, 1, 5, { color: 0xc9b8ff }); b.prop('shelf', 168, 12, 3, 1, { color: 0xe8dcff });
  b.note(161, 14, 'Dream Shop window poster', 'COMING SOON: Hush HX-9 Pillow Mist! Dreamwell, because Mallow Bay deserves to rest. [scrawled:] the one Wren said NO to');
  b.pick('medkit', 169, 5); b.pick('ammo', 154, 5);
  b.label('DREAMWELL DREAM SHOP', 161, 9, 14, LAV);
  b.lamp(161, 10);
  // Dark shopfronts on the east side.
  b.fill(171, 4, 171, 19); b.carve(171, 9, 171, 10, F.INTERIOR);
  b.prop('shelf', 176, 5, 1, 6); b.prop('counter', 173, 15, 4, 1); b.pick('ammo', 174, 6);
  b.label('CLOSED', 175, 12, 12, PINK, WEST);
  b.fill(153, 41, 158, 50); b.fill(171, 41, 178, 50);                    // hall down to the toy store
  b.prop('bench', 161, 45, 1, 3); b.prop('bush', 169, 42);
  b.label('BUN BUN TOYS', 164.5, 48, 18, LEMON);
  for (const [x, z] of [[156, 32], [176, 36], [164, 44]]) b.lamp(x, z);
  b.arrow(156, 32, E); b.arrow(164.5, 41, S); b.arrow(164.5, 49, S);
  zz(160, 42, S);

  // ------------------------------------------------------------------
  // 12. Bun Bun Toys and its stockroom (checkpoint)
  // ------------------------------------------------------------------
  b.carve(160, 51, 169, 51, F.WOOD); b.carve(153, 52, 178, 66, F.WOOD);
  // Snoozle plush displays.
  for (const [x, z] of [[155, 55], [155, 61], [172, 55], [172, 61]]) { b.prop('shelf', x, z, 4, 1, { color: 0xffffff }); b.prop('barrel', x + 1, z + 1, 2, 1, { color: 0xffffff }); }
  b.prop('counter', 176, 53, 1, 5, { color: 0xffb3d1 }); b.prop('crate', 162, 58, 2, 2, { color: 0xffb3d1 });
  b.label('SNOOZLE PLUSH: 50% OFF', 165, 63, 12, PINK); b.label('BUN BUN TOYS', 165, 56, 22, LEMON);
  b.pick('ammo', 177, 65); b.pick('ammo', 153, 65);
  b.lamp(158, 58); b.lamp(171, 58); b.lamp(165, 64);
  b.arrow(165.5, 62, S);
  b.carve(164, 67, 167, 67, F.WOOD);
  const stockEntry = b.door(164, 67, 167, 67, 'shutter', 'BUN BUN STOCKROOM');
  b.carve(158, 68, 174, 76, F.SAFE);
  b.prop('shelf', 158, 68, 1, 8, { color: 0xffffff }); b.prop('shelf', 174, 68, 1, 6, { color: 0xffffff });
  b.prop('crate', 160, 74); b.prop('crate', 171, 70); b.prop('barrel', 172, 70, 1, 1, { color: 0xffffff });
  for (const x of [160, 161, 162, 163]) b.pick('medkit', x, 68);
  b.pick('ammo', 168, 68); b.pick('ammo', 169, 68); b.pick('ammo', 170, 68);
  b.pick('launcher', 158, 76); b.pick('shotgun', 159, 76); b.pick('rifle', 160, 76); b.pick('smg', 161, 76); b.pick('autoshotgun', 162, 76);
  const stockLever = b.obj('lever', 173, 76, 'Unbolt the back door');
  b.label('SAFE ROOM', 166, 71, 22, RED); b.label('STOCKROOM: PLUSHIES', 166, 73.5, 12, LEMON);
  b.lamp(166, 72);
  b.carve(165, 78, 167, 79, F.INTERIOR);
  const stockDoor = b.door(165, 77, 167, 77, 'shutter', 'STOCKROOM BACK DOOR');

  // ------------------------------------------------------------------
  // 13. Food court atrium (the Snoozle Brute), helicopter in the skylight
  // ------------------------------------------------------------------
  b.carve(122, 80, 178, 126, F.INTERIOR);
  // Food stall kitchens along the south wall (hidey-holes and horde lanes).
  b.fill(122, 119, 178, 126);
  for (const [x0, name, col] of [[125, 'NOODLES', PINK], [136, 'TACO TACO', LEMON], [147, 'BUBBLE TEA', MINT], [158, 'PRETZEL', GOLD], [169, 'SUSHI GO', SKY]] as const) {
    b.carve(x0, 121, x0 + 7, 125, F.TILES); b.carve(x0, 119, x0 + 7, 120, F.INTERIOR);
    b.prop('counter', x0 + 2, 119, 6, 1, { color: 0xf0e2b6 }); b.prop('shelf', x0 + 1, 125, 5, 1);
    b.label(name, x0 + 4, 117.8, 14, col);
  }
  b.pick('ammo', 126, 124); b.pick('ammo', 127, 124); b.pick('medkit', 159, 124); b.pick('ammo', 175, 123); b.pick('ammo', 175, 124);
  // The dry fountain and the helicopter tail poking down through the skylight.
  b.prop('fountain', 146, 99, 4, 4, { color: 0xd8d0c8 });
  b.label('DRY FOUNTAIN', 148, 104.5, 12, CREAM);
  b.prop('container', 134, 83, 1, 9, { color: 0xe86a5a, rot: 0.25 });   // tail boom
  b.prop('pillar', 133, 82, 3, 1, { color: 0xe86a5a });                // tail fin
  b.prop('crate', 137, 92, 2, 1, { color: 0x8fd8ff }); b.prop('crate', 131, 90, 1, 1, { color: 0x8fd8ff });   // skylight glass
  b.label("LARRY'S CHOPPER", 137, 87, 14, RED, WEST); b.label('SKYLIGHT', 138, 81.2, 12, SKY);
  // Tables in clusters, planters and pillars.
  for (const [x, z] of [[128, 97], [128, 106], [139, 100], [139, 110], [155, 92], [157, 108], [166, 96], [166, 106], [174, 101], [148, 112]]) b.prop('desk', x, z, 2, 2, { color: 0xffe0b0 });
  for (const [x, z] of [[134, 104], [160, 101], [152, 88]]) b.prop('bush', x, z, 2, 1);
  for (const [x, z] of [[144, 90], [154, 90], [144, 110], [154, 110], [128, 86], [172, 86]]) b.prop('pillar', x, z, 1, 1, { color: 0xffd0e0 });
  b.prop('bench', 162, 84, 3, 1); b.prop('bench', 124, 112, 1, 3);
  b.pick('ammo', 177, 81); b.pick('ammo', 123, 81);
  b.label('FOOD COURT', 150, 95, 34, LEMON);
  for (const [x, z] of [[130, 92], [140, 104], [150, 88], [160, 96], [170, 92], [130, 114], [160, 114], [170, 108], [150, 108], [166, 82]]) b.lamp(x, z);
  b.arrow(166, 82, S); b.arrow(158, 100, WEST); b.arrow(132, 101, WEST); b.arrow(125, 102, WEST);
  zz(162, 90, WEST); zz(140, 96, WEST);

  // ------------------------------------------------------------------
  // 14. Arcade, Security office (breakers), dock corridor
  // ------------------------------------------------------------------
  b.carve(121, 98, 121, 106, F.INTERIOR);
  b.carve(104, 96, 120, 118, F.INTERIOR);
  for (const z of [99, 103, 107, 111]) for (const x of [106, 109, 114, 117]) b.prop('terminal', x, z, 1, 2, { color: [0xff3df0, 0x3dd8ff, 0xfff27a, 0x7cff6b][(x + z) % 4] });
  b.prop('counter', 104, 116, 3, 1, { color: 0xff3df0 }); b.prop('shelf', 120, 115, 1, 3);
  b.pick('ammo', 105, 97);
  b.label('INSERT COIN', 112, 114.5, 30, MAGENTA); b.label('INSERT COIN', 112, 101.5, 16, MAGENTA);
  b.label('STAR ARCADE', 112, 109, 14, SKY);
  b.label('SECURITY', 111, 97, 16, MAGENTA);
  for (const [x, z] of [[108, 105], [116, 105], [112, 98], [112, 116]]) b.lamp(x, z);
  b.arrow(118, 102, WEST); b.arrow(111.5, 98, N);
  // Security: CCTV wall and the breaker panel on the back wall.
  b.carve(110, 95, 112, 95, F.INTERIOR);
  b.carve(104, 84, 118, 94, F.INTERIOR);
  const breaker = b.obj('lever', 113, 84, 'Throw the breakers');
  b.prop('counter', 105, 88, 6, 1, { color: 0x6a7080 }); b.prop('terminal', 105, 87); b.prop('terminal', 107, 87); b.prop('terminal', 109, 87);
  b.prop('shelf', 118, 85, 1, 5); b.prop('desk', 114, 90, 2, 1);
  b.pick('medkit', 104, 93); b.pick('medkit', 105, 93); b.pick('ammo', 117, 93); b.pick('ammo', 116, 93); b.pick('ammo', 115, 93);
  b.pick('magnum', 106, 93); b.pick('launcher', 107, 93); b.pick('rifle', 108, 93); // before the freight lift finale
  b.label('MALL SECURITY', 111, 91.5, 16, CREAM); b.label('BREAKERS', 113, 85.6, 12, GOLD);
  b.lamp(111, 89);
  // Loading-dock corridor (opened by the breakers).
  b.carve(108, 119, 111, 119, F.INTERIOR);
  const dockDoor = b.door(108, 119, 111, 119, 'shutter', 'LOADING DOCK');
  b.carve(108, 120, 111, 133, F.CONCRETE);
  b.prop('pallet', 108, 124); b.prop('crate', 111, 128);
  b.pick('ammo', 111, 122); b.pick('medkit', 108, 131);
  b.label('LOADING DOCK', 109.5, 126, 14, GOLD, N);
  b.lamp(109.5, 121); b.lamp(109.5, 131);
  b.arrow(109.5, 117, S); b.arrow(109.5, 129, S);

  // ------------------------------------------------------------------
  // 15. Loading dock (finale), truck yard, freight lift
  // ------------------------------------------------------------------
  b.carve(104, 134, 164, 158, F.CONCRETE);
  // Truck bays in the south wall: the shutters are up and the yard is full of sleepers.
  b.carve(104, 161, 176, 176, F.ASPHALT);
  b.walls(103, 159, 177, 177, WALL.FENCE, 3.2);
  for (const x0 of [112, 126, 140, 154]) {
    b.carve(x0, 159, x0 + 3, 160, F.CONCRETE);
    b.label('BAY', x0 + 2, 157.4, 12, GOLD);
  }
  b.prop('truck', 106, 165, 2, 8, { color: 0xf0e2b6 }); b.prop('truck', 133, 164, 2, 8, { color: 0xffb3d1 }); b.prop('truck', 161, 166, 2, 8, { color: 0xfff1a8 });
  b.prop('container', 118, 170, 6, 2, { color: 0x8fb4c6 }); b.prop('container', 146, 168, 2, 6, { color: 0xd3a7bf });
  for (const [x, z] of [[122, 163], [150, 175], [172, 164], [140, 172]]) b.prop('pallet', x, z);
  // Back-of-house pockets around the dock: more ways in for the finale horde.
  b.carve(138, 128, 162, 132, F.TILES);                                   // cold storage
  b.carve(142, 133, 144, 133, F.TILES); b.carve(156, 133, 158, 133, F.TILES);
  b.prop('shelf', 139, 128, 10, 1, { color: 0xd8efe8 }); b.prop('shelf', 151, 128, 10, 1, { color: 0xd8efe8 }); b.prop('crate', 148, 131);
  b.label('COLD STORAGE', 150, 130.5, 14, SKY);
  b.carve(166, 134, 176, 140, F.CONCRETE); b.carve(165, 135, 165, 137, F.CONCRETE);   // returns cage
  b.prop('pallet', 170, 135); b.prop('crate', 174, 139); b.label('RETURNS', 171, 138, 12, CREAM);
  b.carve(166, 154, 176, 158, F.CONCRETE); b.carve(165, 155, 165, 157, F.CONCRETE);   // compactor
  b.prop('dumpster', 172, 155, 2, 2); b.label('COMPACTOR', 168, 157, 10, CREAM);
  // Dock floor cover: pallets, crate stacks, a forklift, a dead mall van.
  for (const [x, z] of [[116, 138], [130, 140], [146, 137], [124, 150], [140, 152], [156, 151], [150, 156]]) b.prop('crate', x, z, 2, 1);
  for (const [x, z] of [[120, 144], [136, 146], [152, 143], [110, 152]]) b.prop('pallet', x, z, 2, 1);
  b.prop('car', 134, 135, 2, 1, { color: 0xffd43b }); b.prop('van', 158, 136, 1, 3, { color: 0xe6c3d3, rot: N });
  b.prop('container', 113, 146, 1, 4, { color: 0x7aa59c }); b.prop('container', 160, 152, 3, 1, { color: 0xeedfa6 });
  b.pick('ammo', 105, 135); b.pick('ammo', 163, 141); b.pick('medkit', 160, 134); b.pick('ammo', 128, 157); b.pick('medkit', 163, 134);
  b.label('BAYSIDE GALLERIA DELIVERIES', 132, 142.5, 20, CREAM);
  for (const [x, z] of [[108, 138], [122, 136], [140, 140], [156, 140], [118, 154], [134, 154], [150, 154], [162, 148], [114, 168], [140, 168], [168, 170], [150, 130]]) b.lamp(x, z);
  b.arrow(112, 136, E); b.arrow(140, 136, E); b.arrow(158, 146, E);
  // Freight lift (end safe room) behind its gate.
  b.carve(166, 143, 174, 151, F.SAFE);
  const liftButton = b.obj('terminal', 164, 144, 'Call the freight lift');
  const liftGate = b.door(165, 145, 165, 148, 'fence', 'FREIGHT LIFT');
  b.label('FREIGHT LIFT', 170, 146, 18, GOLD); b.label('TO SERVICE TUNNEL', 170, 148.5, 11, CREAM);
  b.lamp(170, 147);

  // ------------------------------------------------------------------
  // Quest
  // ------------------------------------------------------------------
  b.start([[15.5, 143.5], [16.5, 144.5], [19.5, 143.5], [19.5, 145.5]]);
  b.use(triageRadio, {
    objective: 'Radio Dot from triage', opens: [triageDoor],
    radio: [
      ['Dot', 'You made it! Helicopter\'s on the roof. Pilot says he\'ll wait. Ish.'],
      ['Nori', 'I work nights here. Pharmacy. The third floor always smells like soup.'],
      ['Taro', 'Sorry about the doors, St. Marigold.'],
    ],
  });
  b.reach({ x0: 62, z0: 114, x1: 80, z1: 138 }, {
    objective: 'Get through the ER waiting room',
    radio: [
      ['Pip', 'Waiting room zombies. They\'ve been waiting a REALLY long time.'],
      ['Taro', 'Haven\'t we all.'],
    ],
  });
  b.collect('keycard', {
    objective: 'Find staff keycards',
    radio: [
      ['Dot', 'Elevators need staff cards. Nurses hide them in the darnedest places.'],
      ['Nori', 'Check the coffee machines. Trust me.'],
    ],
  });
  b.use(elevButton, {
    objective: 'Call the staff elevator', horde: true, hold: 60, opens: [elevDoor],
    radio: [
      ['Mochi', 'Elevator music. Of course there\'s elevator music.'],
      ['Pip', 'The zombies LIKE it! Why do they like it?!'],
      ['Nori', 'It\'s a lullaby. Huh.'],
    ],
  });
  b.reach({ x0: 26, z0: 6, x1: 58, z1: 36 }, {
    objective: 'Search the Sleep Clinic', opens: [obsEntry],
    radio: [
      ['Nori', 'Dreamwell\'s sleep trials. I filled their prescriptions. \'Hush,\' every night.'],
      ['Taro', 'Every bed empty, and every bed made. That\'s the part I don\'t like.'],
    ],
  });
  b.gather({ x0: 64, z0: 6, x1: 76, z1: 17 }, {
    objective: 'Lock yourselves in observation', checkpoint: true, closes: [obsEntry],
    radio: [
      ['Dot', 'Find a room with a door that locks. I need you all in one piece.'],
      ['Pip', 'Guys. ID badge on the desk. \'Lowell.\' Like Dot?'],
      ['Nori', 'Common name. Probably.'],
    ],
  });
  b.use(obsLever, {
    objective: 'Unlock the stairwell door', opens: [stairDoor],
    radio: [
      ['Taro', 'Catch your breath first. The roof isn\'t going anywhere.'],
      ['Mochi', 'Stairwell, then helipad. Last leg of the delivery!'],
    ],
  });
  b.reach({ x0: 98, z0: 12, x1: 114, z1: 28 }, {
    objective: 'Get up to the helipad',
    radio: [
      ['Dot', 'Larry? Come in, Larry. ...Oh, no. He took a nap. He was on a double.'],
      ['Mochi', 'So the helicopter is... on the mall.'],
      ['Dot', 'New plan, sweet peas. Freight trains still run from the rail yard.'],
    ],
  });
  b.use(skyPanel, {
    objective: 'Raise the skybridge shutter', horde: true, hold: 75, opens: [skyShutter],
    radio: [
      ['Dot', 'Cross the skybridge to the Galleria. Its service tunnel runs to the rail yard.'],
      ['Pip', 'A MALL. Finally, side quests.'],
    ],
  });
  b.reach({ x0: 158, z0: 20, x1: 176, z1: 40 }, {
    objective: 'Cross into the Galleria', opens: [stockEntry],
    radio: [
      ['Taro', 'This was a ballroom once. I took my wife dancing here. She\'d hate the carpet.'],
      ['Nori', '...That\'s actually lovely, Taro.'],
    ],
  });
  b.gather({ x0: 158, z0: 68, x1: 174, z1: 76 }, {
    objective: 'Hole up in the toy store stockroom', checkpoint: true, closes: [stockEntry],
    radio: [
      ['Pip', 'Plushies. Thousands of plushies.'],
      ['Mochi', 'No souvenirs, Pip.'],
      ['Pip', 'One souvenir.'],
    ],
  });
  b.use(stockLever, {
    objective: 'Unbolt the stockroom back door', opens: [stockDoor],
    radio: [
      ['Nori', 'Back door goes out to the food court. Stay together.'],
      ['Pip', 'Snoozle plush is coming with me. For morale.'],
    ],
  });
  b.reach({ x0: 138, z0: 92, x1: 158, z1: 112 }, {
    objective: 'Cross the food court', brute: true,
    radio: [
      ['Pip', 'Is that SNOOZLE? Snoozle is HUGE.'],
      ['Dot', 'That\'s no sheep, sweet pea. That\'s a Brute in a sheep suit.'],
      ['Taro', 'Somebody\'s last shift was a long one.'],
    ],
  });
  b.use(breaker, {
    objective: 'Restore power in Security', opens: [dockDoor],
    radio: [
      ['Dot', 'The loading dock lift needs power. Breakers are in Security, past the arcade.'],
      ['Pip', 'Past the ARCADE?'],
      ['Nori', 'No.'],
    ],
  });
  b.use(liftButton, {
    objective: 'Call the freight lift', horde: true, hold: 90, opens: [liftGate],
    radio: [
      ['Mochi', 'Slowest lift in the world. Everybody face out!'],
      ['Nori', 'And Pip, do not hum along to the music.'],
    ],
  });
  b.gather({ x0: 166, z0: 143, x1: 174, z1: 151 }, {
    objective: 'Everybody into the freight lift', closes: [liftGate],
    radio: [
      ['Dot', 'Tunnel runs under the river to the rail yard. I\'m right here on the radio.'],
    ],
  });
  return b.done({ id: META.id, title: META.title, subtitle: META.subtitle, intro: INTRO, theme: THEME });
}
