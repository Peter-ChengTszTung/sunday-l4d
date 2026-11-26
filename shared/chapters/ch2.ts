// Chapter 2: "Visiting Hours" — St. Marigold Hospital & Bayside Galleria, 4:40 a.m.
// Brief: docs/campaign.md, "Chapter 2: Visiting Hours".
//
// Four real storeys (storey k's floor is k * STOREY = 4.2k m):
//
//   storey 3  .......... HOSPITAL ROOF / HELIPAD (x 4-61) with roof-access huts (stair cores up from 3F)
//   storey 2  3F DREAMWELL SLEEP CLINIC (x 4-60) | SKYBRIDGE TERRACE (x 62-98) = skybridge ===> GALLERIA UPPER CONCOURSE | CINEPLEX | CAR PARK ROOF
//   storey 1  2F WARDS + SOUP (x 4-97) / ER roof + lobby roof (lower roofs)      BUN BUN TOYS + stockroom | MEZZANINE ring | PLUMLEY'S HOME & BEDDING | CAR PARK LEVEL 1
//   storey 0  GROUND: triage, ER, lobby, staff rooms, elevator lobby | bay inlet | arcade, security, FOOD COURT, loading dock | PLUMLEY'S GROUND | CAR PARK GROUND
//
//   x:  0     20     40     62        99  100   121 122            163 165        203 205       224
//  z 3  +-----------------------+---------+ ~~~~~~~~ +----------------+-+------------+-----------+
//       | tower: staff rooms    | east    | ~ bay  ~ | north block:   | | PLUMLEY'S  : CINEPLEX  |  storey 0/1: Plumley's two
//       | (G) / wards (2F) /    | wing:   | ~inlet ~ |   G  arcade    |=| DEPARTMENT : (storey 2,|  sales floors; storey 2: the
//       | Sleep Clinic (3F) /   | elev.   |=skybridge| 1  toys        | | STORE (0,1): over both)|  Cineplex lobby, Screen 1
//       | helipad roof (R)      | lobby   | (storey2)| 2  concourse   | |            :  Screen 2 |  (pocket), Screen 2, fire exit
//    37 +-----------------------+---------+ ~~~~~~~~ +----------------+ +------------+---------F+  corridor (F) down the east side
//       | south wing: ER, waiting room,   | ~      ~ | FOOD COURT     |                        F   footbridge (storey 2)
//       | lobby, gift, pharmacy (G only;  | ~      ~ | (Brute)        | +----------------------F+
//    65 | roofs on storey 1)              |          +--kitchens------+ | GALLERIA PARKING:      |  three decks (0, 1, roof 2),
//       | AMBULANCE BAY (triage start)    |   cold storage | LOADING DOCK | ramps SW and SE, the   |  roof crossed corner to corner,
//       |                                 |   EVACUATION POINT (finale)  | parking office (safe   |  then along the south side
//   107 +---------------------------------+          | truck yard  <====gate=office) at the SW  |
//
// Route (storey in brackets): triage [0] → ER → waiting room → main lobby → two staff keycards (the
// pharmacy, the nurses' station) → staff elevator lobby (crescendo 1; the car arrives and faults,
// which unlocks the fire stairs) → fire stairs up [0→1] → 2F east hall, corridor A west to the day
// room and the soup → day-room stairs up [1→2] into the pod ward → 3F Sleep Clinic → observation
// room (checkpoint) → stairwell up [2→3] → helipad (no helicopter) → flight down to the skybridge terrace [3→2] (crescendo 2: the horde boils up the roof-access
// huts and the ladders from the lobby roof) → glass skybridge over the bay inlet [2] → Galleria
// upper concourse, ballroom → escalator down into Bun Bun Toys [2→1] → stockroom (checkpoint) →
// mezzanine over the food court → escalator down [1→0] (Snoozle Brute) → arcade → Security
// breakers (the police have barricaded the dock from inside, so the way on is round the back) →
// Plumley's ground floor [0] → escalator up to Home & Bedding [0→1] → escalator up to the Cineplex
// [1→2] → dark Screen 2, fire-exit corridor, footbridge → car park roof, down the ramps [2→1→0] →
// parking office (checkpoint) → truck yard → loading dock evacuation point (the Big Hold On: the
// police's rocket pod, four power cells to scavenge while the lift chimes all the way up) → freight lift.
//
// Optional ladder routes: ambulance bay → ER roof (two ladders; loot, Larry's thermos note),
// dock catwalk (ladder + stairs; a rifle perch over the finale).
// Tile coordinates: x grows east, z grows south. Arrow rot 0 points south (+z).
import { LevelBuilder, F, WALL, type Theme } from '../level';
import { STOREY } from '../constants';

export const META = { id: 'ch2', title: 'Visiting Hours', subtitle: 'St. Marigold Hospital & Bayside Galleria' };

const S = 0, E = Math.PI / 2, WEST = -Math.PI / 2, N = Math.PI;
const MINT = '#7cf2c8', CREAM = '#fff1c9', RED = '#ff5a5a', GOLD = '#ffd43b', LAV = '#c9a8ff', PINK = '#ff8fc8';
const SOUP = '#f2a541', LEMON = '#fff27a', MAGENTA = '#ff3df0', SKY = '#8fd8ff';
const GURNEY = 0xe8f0ee, PASTEL = [0xffb3d1, 0xfff1a8, 0xb8f0d8, 0xc9b8ff, 0xffd0a8];
const W = 228, H = 108;
/** Wall tops (absolute metres): the hospital tower and the mall's north block reach the roof, the east wing the terrace. */
const ROOF = 3 * STOREY, TERRACE = 2 * STOREY;

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

const INTRO = '4:40 a.m. The shuttle got you to St. Marigold Hospital, mostly in one piece. Dot says a helicopter is waiting on the roof. Nori used to work nights here and swears the second floor always smells like soup. The beds are empty. Every one of them is neatly made.';

export function build() {
  const b = new LevelBuilder(W, H, 4);
  const WH = W * H;
  let pi = 0;
  const gurney = (x: number, z: number, w = 2, d = 1) => b.prop('bed', x, z, w, d, { color: GURNEY });
  const pastel = () => PASTEL[pi++ % PASTEL.length];
  /** Dropped slippers and pillows pointing the way the sleepers walked. */
  const zz = (x: number, z: number, rot = N) => b.label('zZ', x, z, 18, LAV, rot);
  /**
   * Walls on the storey being authored, up to absolute height `top`. Over floor below, a new wall
   * stands on the slab; over a wall below, that wall's column simply grows (the cells above become
   * its continuation), so wall stacks under roofs and upper floors stay one piece.
   */
  const wallUp = (x0: number, z0: number, x1: number, z1: number, top: number) => {
    const k = b.storey;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const c = z * W + x;
      // Already carved on this storey: wall it in place (nothing is built on these walls).
      if (b.floor[k * WH + c] !== F.NONE) { b.fill(x, z, x, z); b.walls(x, z, x, z, WALL.BUILDING, top - k * STOREY); continue; }
      let j = k - 1;
      // Skip untouched upper cells (no floor, no wall of their own): they continue the column below.
      while (j > 0 && b.floor[j * WH + c] === F.NONE && b.wallH[j * WH + c] === 0 && !b.air[j * WH + c]) j--;
      const i = j * WH + c;
      if (b.floor[i] === F.NONE && !b.air[i]) { b.level(j); b.walls(x, z, x, z, WALL.BUILDING, top - j * STOREY); b.level(k); }
      else { b.fill(x, z, x, z); b.walls(x, z, x, z, WALL.BUILDING, top - k * STOREY); }
    }
  };

  // ==================================================================
  // STOREY 0: hospital ground floor, bay inlet, Galleria ground floor
  // ==================================================================
  // The south wing (ER, waiting room, lobby, shops) is one storey: its roofs are storey 1.
  b.walls(3, 37, 99, 65, WALL.BUILDING, STOREY);

  // ------------------------------------------------------------------
  // 1. Triage station (start safe room), Shuttle No. 4, ambulance bay
  // ------------------------------------------------------------------
  b.carve(8, 52, 20, 59, F.SAFE);
  // Shuttle No. 4 parked nose-first through the bay doors (it seals the gap).
  b.carve(13, 60, 14, 62, F.SAFE);
  b.prop('counter', 9, 53, 3, 1, { color: 0xd8efe8 });                  // nurse's desk
  const triageRadio = b.obj('radio', 12, 53, 'Radio Dot from the triage desk');
  gurney(17, 53); gurney(17, 58);
  b.pick('smg', 8, 59); b.pick('smg', 9, 59); b.pick('shotgun', 10, 59); b.pick('shotgun', 11, 59); b.pick('rifle', 12, 59);
  b.pick('ammo', 20, 55); b.pick('ammo', 20, 56); b.pick('ammo', 19, 55);
  for (const z of [54, 55, 56, 57]) b.pick('medkit', 8, z);
  b.pick('armor', 8, 58); b.pick('bat', 9, 58); b.pick('machete', 10, 58); b.pick('firebomb', 20, 57);
  b.label('SAFE ROOM', 17.5, 55.6, 22, RED); b.label('TRIAGE', 10.5, 57.5, 20, MINT);
  b.lamp(10.5, 55.5); b.lamp(17.5, 57);
  b.carve(12, 49, 15, 51, F.TILES);
  const triageDoor = b.door(12, 51, 15, 51, 'shutter', 'TRIAGE');
  // Ambulance bay (open air): ambulances, the shuttle's tail, a pocket of supplies.
  b.carve(4, 63, 44, 88, F.CONCRETE);
  b.prop('bus', 13, 56, 2, 14, { color: 0x5ff2e0 });                     // placed after the bay so the carve keeps it
  b.prop('van', 22, 68, 1, 3, { color: 0xf4f4f4, rot: N }); b.prop('van', 28, 72, 1, 3, { color: 0xf4f4f4, rot: N });
  b.prop('van', 36, 78, 3, 1, { color: 0xff6b6b }); b.prop('barrier', 6, 78, 3, 1); b.prop('barrier', 30, 84, 3, 1);
  for (const [x, z] of [[42, 64], [5, 87], [18, 84], [40, 87]]) b.prop('crate', x, z);
  b.prop('dumpster', 43, 72, 1, 2); b.prop('barrel', 10, 70);
  b.pick('rifle', 23, 72); b.pick('ammo', 24, 72); b.pick('medkit', 41, 82); b.pick('ammo', 8, 64);
  b.label('SHUTTLE No. 4', 13.5, 74, 18, GOLD, E); b.label('AMBULANCE BAY', 26, 80, 28, CREAM);
  b.label('AMBULANCES ONLY', 35.5, 65.5, 14, RED);
  for (const [x, z] of [[8, 66], [30, 66], [20, 78], [40, 78], [10, 86]]) b.lamp(x, z);
  // Fire-escape ladders up the south wall onto the ER roof (optional route, storey 1).
  b.ladder(6, 63, '-z'); b.ladder(28, 63, '-z');
  b.label('ROOF LADDER', 6.5, 65, 9, CREAM); b.label('ROOF LADDER', 28.5, 65, 9, CREAM);
  // Ambulance entrance: sliding doors from the bay into the ER.
  b.carve(34, 49, 37, 62, F.TILES);
  gurney(34, 53, 1, 2); b.prop('bench', 37, 58, 1, 2);
  b.label('AMBULANCE ENTRANCE', 35.5, 56, 12, RED, E);
  b.lamp(35.5, 60);
  // The bay is behind the start, so the way back to it is signposted from the ER: a lit doorway, its
  // name on the ER floor, and ammo just inside to draw the eye down the corridor.
  b.lamp(35.5, 49.5); b.label('AMBULANCE BAY', 35.5, 46.4, 14, RED, N);
  b.pick('ammo', 35, 51);

  // ------------------------------------------------------------------
  // 2. Emergency Room (curtained bays) and Radiology (side room)
  // ------------------------------------------------------------------
  b.carve(4, 30, 36, 48, F.TILES);
  for (const x of [6, 10, 14, 18, 22]) { b.prop('bed', x, 31, 1, 2, { color: GURNEY }); b.prop('counter', x + 2, 30, 1, 3, { color: 0x9fe3cf }); }
  b.prop('counter', 14, 39, 7, 1, { color: 0xd8efe8 }); b.prop('terminal', 17, 40);
  gurney(26, 35); gurney(8, 43); gurney(28, 43); gurney(20, 45, 1, 2);
  b.prop('bench', 5, 38, 1, 3); b.prop('shelf', 33, 30, 3, 1);
  b.pick('ammo', 5, 47); b.pick('medkit', 35, 32);
  b.label('EMERGENCY', 17.5, 35.5, 30, RED); b.label('ER', 31, 40, 40, MINT);
  b.lamp(10, 37); b.lamp(24, 40); b.lamp(14, 46); b.lamp(32, 45);
  b.arrow(13.5, 47, N); b.arrow(22, 42, E); b.arrow(34, 37.5, E);
  // Radiology, off the ER's south wall: an optional side room.
  b.carve(25, 49, 27, 51, F.TILES);
  b.carve(22, 52, 31, 61, F.TILES);
  b.prop('bed', 24, 55, 3, 1, { color: 0xffffff }); b.prop('pillar', 23, 54, 1, 3, { color: 0xb8d8e8 });   // the scanner
  b.prop('counter', 28, 59, 3, 1, { color: 0x9aa6b8 }); b.prop('terminal', 31, 58);
  b.pick('medkit', 30, 60); b.pick('ammo', 29, 60);
  b.label('RADIOLOGY', 26.5, 53, 16, SKY); b.label('X-RAY: LEAD LINED', 26.5, 57.6, 11, GOLD);
  b.lamp(27, 58);

  // ------------------------------------------------------------------
  // 3. ER waiting room ("NOW SERVING 303")
  // ------------------------------------------------------------------
  b.carve(37, 33, 37, 41, F.TILES);
  b.carve(38, 28, 58, 50, F.TILES);
  for (const z of [32, 36, 40, 44]) { b.prop('bench', 41, z, 6, 1, { color: 0x7fc8b8 }); b.prop('bench', 50, z, 6, 1, { color: 0x7fc8b8 }); }
  b.prop('terminal', 48, 28, 2, 1); b.prop('counter', 39, 48, 5, 1, { color: 0xd8efe8 });
  b.prop('shelf', 57, 48, 1, 3, { color: 0xffd0a8 });                      // vending machines
  b.pick('ammo', 58, 47);
  b.label('NOW SERVING 303', 49, 29.8, 20, RED);
  b.label('WAITING ROOM', 48, 48.5, 22, MINT);
  b.lamp(44, 34); b.lamp(53, 34); b.lamp(44, 43); b.lamp(53, 43);
  b.arrow(48, 38, E); b.arrow(57, 39, E);
  zz(40, 38, E); zz(47.5, 46.5, E);

  // ------------------------------------------------------------------
  // 4. Main lobby, gift shop, pharmacy (keycard: Nori's old desk)
  // ------------------------------------------------------------------
  b.carve(59, 32, 59, 44, F.TILES);
  b.carve(60, 24, 98, 52, F.TILES);
  for (const [x, z] of [[66, 28], [92, 28], [66, 47], [92, 47]]) b.prop('pillar', x, z, 2, 2, { color: 0xe8f4f0 });
  b.prop('counter', 76, 36, 8, 1, { color: 0x9fe3cf }); b.prop('counter', 76, 40, 8, 1, { color: 0x9fe3cf });
  b.prop('counter', 76, 37, 1, 3, { color: 0x9fe3cf });                    // information desk (open east side)
  b.prop('bench', 64, 37, 1, 4); b.prop('bench', 89, 36, 1, 4); b.prop('bush', 70, 50, 2, 1); b.prop('bush', 86, 50, 2, 1);
  b.prop('bed', 70, 32, 2, 1, { color: 0xd0d0d8 }); b.prop('bench', 84, 44, 3, 1);   // wheelchairs and a gurney
  b.label('MAIN LOBBY', 80, 32, 30, MINT); b.label('INFORMATION', 80, 38.5, 14, CREAM);
  b.label('MAIN ENTRANCE: BARRICADED', 79, 51.3, 14, RED);
  for (const [x, z] of [[64, 26], [72, 42], [80, 28], [88, 42], [96, 26], [96, 50], [64, 50]]) b.lamp(x, z);
  b.arrow(62, 38, E);
  // Gift shop full of balloons.
  b.carve(66, 53, 69, 53, F.TILES); b.carve(62, 54, 74, 62, F.TILES);
  b.prop('shelf', 63, 57, 5, 1, { color: 0xffb3d1 }); b.prop('shelf', 63, 60, 5, 1, { color: 0xfff1a8 }); b.prop('counter', 71, 55, 1, 3);
  for (const [x, z] of [[70, 59], [73, 61], [62, 62], [72, 58]]) b.prop('barrel', x, z, 1, 1, { color: pastel() });   // balloon bunches
  b.pick('medkit', 74, 54); b.pick('ammo', 62, 55);
  b.label('GIFT SHOP', 67.5, 54.6, 16, PINK); b.label('GET WELL SOON', 68, 58.6, 11, LEMON);
  b.lamp(68, 59);
  // Outpatient pharmacy: Nori's old counter.
  b.carve(86, 53, 90, 53, F.TILES); b.carve(82, 54, 97, 64, F.TILES);
  b.prop('counter', 84, 58, 10, 1, { color: 0xc9b8ff });
  for (const x of [83, 87, 91, 95]) b.prop('shelf', x, 62, 3, 1, { color: 0xe8f4f0 });
  b.prop('desk', 95, 60, 2, 1);
  b.item('keycard', 'keycard', 94, 59, 'staff keycard');
  b.pick('ammo', 83, 55);
  b.label('PHARMACY', 89.5, 56, 22, LAV); b.label("NORI'S DESK: DO NOT TOUCH", 92, 60.6, 10, CREAM);
  b.lamp(89, 60);
  b.arrow(89, 51, S);

  // ------------------------------------------------------------------
  // 5. Staff corridor and staff rooms (one of the two keycards), under the wards
  // ------------------------------------------------------------------
  b.carve(4, 16, 79, 19, F.TILES);
  b.label('STAFF ONLY', 40, 17.5, 22, RED);
  b.label('━━ EMERGENCY ━━', 22, 16.5, 12, RED); b.label('━━ EMERGENCY ━━', 62, 18.6, 12, RED);
  gurney(14, 16); gurney(46, 19); gurney(64, 16); b.prop('bench', 33, 19, 2, 1); b.prop('shelf', 76, 16, 1, 1);
  for (const x of [10, 22, 34, 46, 58, 70]) b.lamp(x, 17.5);
  // Doors from the public side into the corridor.
  b.carve(28, 20, 30, 29, F.TILES);                                       // ER → corridor
  b.carve(70, 20, 73, 23, F.TILES);                                       // lobby → corridor
  b.label('STAFF', 71.5, 22, 14, RED); b.label('STAFF', 29, 25, 14, RED, E);
  // Supply room.
  b.carve(8, 15, 9, 15, F.TILES); b.carve(4, 4, 14, 14, F.TILES);
  b.prop('shelf', 4, 5, 1, 8); b.prop('shelf', 7, 5, 6, 1); b.prop('shelf', 14, 5, 1, 6);
  b.pick('medkit', 6, 9); b.pick('medkit', 12, 12);
  b.label('SUPPLIES', 9, 11, 14, MINT);
  // On-call room: an optional side room at the far end.
  b.carve(24, 15, 26, 15, F.TILES); b.carve(17, 4, 34, 14, F.TILES);
  for (const x of [18, 22, 29, 33]) b.prop('bed', x, 5, 1, 2, { color: 0xfff1f0 });
  b.prop('desk', 18, 12, 2, 1); b.prop('shelf', 33, 10, 1, 4);
  b.pick('medkit', 30, 5); b.pick('ammo', 19, 10);
  b.label('ON-CALL', 25.5, 9, 18, MINT);
  b.lamp(25.5, 7);
  // Quiet room (chapel): dark, a little ammo.
  b.carve(41, 15, 43, 15, F.TILES); b.carve(37, 4, 48, 14, F.WOOD);
  for (const z of [7, 10]) { b.prop('bench', 38, z, 4, 1); b.prop('bench', 44, z, 4, 1); }
  b.pick('ammo', 42, 5); b.pick('firebomb', 43, 5);              // off-route reward
  b.label('QUIET ROOM', 42.5, 12.5, 14, LAV);
  // Lab (rifle).
  b.carve(56, 15, 58, 15, F.TILES); b.carve(51, 4, 64, 14, F.TILES);
  b.prop('counter', 52, 7, 5, 1, { color: 0xe8f4f0 }); b.prop('counter', 59, 7, 5, 1, { color: 0xe8f4f0 }); b.prop('counter', 53, 11, 1, 3, { color: 0xe8f4f0 });
  b.pick('shotgun', 62, 5); b.pick('rifle', 63, 5); b.pick('smg', 64, 5); b.pick('ammo', 63, 4); b.pick('ammo', 52, 5);
  b.label('PATH LAB', 57.5, 10, 16, SKY);
  b.lamp(57.5, 9);
  // Break room (coffee machines), with a side door into the elevator lobby.
  b.carve(71, 15, 73, 15, F.TILES); b.carve(67, 4, 78, 14, F.TILES); b.carve(79, 7, 79, 9, F.TILES);
  b.prop('counter', 67, 4, 6, 1, { color: 0xd8c2a0 }); b.prop('terminal', 73, 4); b.prop('desk', 70, 8, 2, 2); b.prop('desk', 75, 11, 2, 1);
  b.pick('ammo', 77, 5); b.pick('ammo', 76, 5); b.pick('ammo', 68, 13);
  b.label('BREAK ROOM', 72.5, 12.8, 14, MINT);
  b.lamp(72, 10);
  // Records and storage, south side.
  b.carve(8, 20, 9, 20, F.TILES); b.carve(4, 21, 14, 27, F.TILES);
  b.prop('shelf', 5, 22, 1, 5); b.prop('shelf', 8, 23, 5, 1); b.prop('shelf', 8, 26, 5, 1); b.pick('ammo', 13, 27);
  b.label('RECORDS', 9.5, 24.6, 12, MINT);
  b.carve(20, 20, 21, 20, F.TILES); b.carve(16, 21, 26, 27, F.TILES);
  b.prop('crate', 17, 22); b.prop('crate', 25, 26); b.prop('shelf', 23, 22, 3, 1); b.pick('medkit', 17, 27);
  // Nurses' station (keycard by the coffee machine, handover sheet).
  b.carve(36, 20, 52, 20, F.TILES); b.carve(32, 21, 56, 26, F.TILES);
  b.prop('counter', 36, 22, 14, 1, { color: 0x9fe3cf }); b.prop('counter', 49, 23, 1, 2, { color: 0x9fe3cf });
  b.prop('terminal', 55, 21); b.prop('desk', 38, 25, 2, 1); b.prop('desk', 44, 25, 2, 1); b.prop('shelf', 32, 21, 1, 4);
  b.item('keycard', 'keycard', 54, 21, 'staff keycard');
  b.note(41, 23, 'Handover sheet', 'Everyone on nights is fine. Everyone who napped on break got up at 3 and walked out humming. Lesson: NEVER nap on break. Sister Agnes');
  b.label("NURSES' STATION", 44, 20.6, 16, MINT);
  b.lamp(44, 24);
  b.arrow(71.5, 21, N); b.arrow(60, 17.5, WEST); b.arrow(29, 21, S);

  // ------------------------------------------------------------------
  // 6. Staff elevator lobby (crescendo 1: the muzak holdout) and the fire stairs
  // ------------------------------------------------------------------
  b.carve(80, 7, 92, 11, F.TILES); b.carve(80, 12, 98, 22, F.TILES);
  b.carve(84, 23, 87, 23, F.TILES); b.carve(93, 23, 96, 23, F.TILES);  // two ways in from the main lobby
  // The car comes down to the muzak and faults with its doors shut: it never opens. Fault mode
  // releases the fire stairs beside it, and that is the way up.
  b.door(85, 6, 88, 6, 'lift', 'STAFF ELEVATOR');
  const elevButton = b.obj('terminal', 90, 7, 'Call the staff elevator (muzak!)');
  // Fire stairs: locked while the elevator is in service. Two wide, rising north to the 2F hall.
  b.carve(94, 9, 95, 10, F.TILES);
  b.stairs(94, 6, 95, 8, '-z', F.TILES);
  const fireDoor = b.door(94, 11, 95, 11, 'shutter', 'FIRE STAIRS');
  gurney(83, 13); gurney(91, 16); gurney(85, 18, 1, 2);
  b.prop('shelf', 97, 15, 1, 3, { color: 0xffd0a8 }); b.prop('bush', 81, 15); b.prop('bush', 96, 20);
  b.prop('bench', 88, 19, 3, 1); b.prop('desk', 81, 20, 2, 1);
  b.pick('ammo', 82, 8); b.pick('ammo', 83, 8); b.pick('ammo', 98, 21); b.pick('ammo', 98, 22); b.pick('medkit', 91, 21); b.pick('medkit', 80, 22);
  b.pick('rattle', 84, 8);                                      // before the muzak holdout
  b.label('STAFF ELEVATOR', 87, 9.5, 18, GOLD); b.label('STAFF CARD REQUIRED', 87, 11.2, 11, RED);
  b.label('FIRE STAIRS', 94.5, 12.8, 12, RED); b.label('LOCKED WHILE ELEVATOR IN SERVICE', 94.5, 14, 7, RED);
  b.label('UP: FLOOR 2', 94.5, 9.6, 10, GOLD, N);
  for (const [x, z] of [[84, 14], [94, 17], [84, 21], [92, 21], [89, 9], [94.5, 9.5]]) b.lamp(x, z);
  b.arrow(90, 15, N); b.arrow(94.5, 13, N);

  // ------------------------------------------------------------------
  // 7. Bay inlet (water under the skybridge)
  // ------------------------------------------------------------------
  b.carve(100, 2, 121, 70, F.WATER);

  // ------------------------------------------------------------------
  // 8. Galleria ground floor: Security, arcade, food court, kitchens
  // ------------------------------------------------------------------
  // Security: CCTV wall and the breaker panel on the back wall.
  b.carve(134, 8, 150, 18, F.INTERIOR);
  const breaker = b.obj('lever', 142, 8, 'Throw the breakers');
  b.prop('counter', 135, 12, 6, 1, { color: 0x6a7080 }); b.prop('terminal', 135, 11); b.prop('terminal', 137, 11); b.prop('terminal', 139, 11);
  b.prop('shelf', 150, 9, 1, 5); b.prop('desk', 146, 14, 2, 1);
  b.pick('medkit', 134, 18); b.pick('medkit', 135, 18); b.pick('ammo', 148, 18); b.pick('ammo', 147, 18); b.pick('ammo', 146, 18);
  b.pick('magnum', 137, 18); b.pick('launcher', 138, 18); b.pick('rifle', 139, 18); // before the freight lift finale
  b.pick('machete', 140, 18);
  b.label('MALL SECURITY', 142, 15.5, 16, CREAM); b.label('BREAKERS', 142, 9.6, 12, GOLD);
  b.lamp(142, 13);
  // The fire shutter in Security's east wall came down with the power; the breakers raise it. Past it
  // a staff corridor runs under Bun Bun Toys to Plumley's (the police barricaded the dock from inside).
  const plumShutter = b.door(151, 15, 151, 16, 'shutter', "PLUMLEY'S");
  b.label("STAFF: PLUMLEY'S", 148.5, 17.4, 9, PINK, E); b.arrow(148, 15.5, E);
  // Star Arcade, under the toy store.
  b.carve(141, 19, 143, 21, F.INTERIOR);
  b.carve(126, 22, 160, 37, F.INTERIOR);
  for (const z of [24, 28, 32]) for (const x of [129, 133, 137, 147, 151, 155]) b.prop('terminal', x, z, 1, 2, { color: [0xff3df0, 0x3dd8ff, 0xfff27a, 0x7cff6b][(x + z) % 4] });
  b.prop('counter', 126, 36, 3, 1, { color: 0xff3df0 }); b.prop('shelf', 160, 33, 1, 3);
  b.pick('ammo', 127, 23); b.pick('ammo', 159, 23);
  b.label('INSERT COIN', 142.5, 34.5, 30, MAGENTA); b.label('INSERT COIN', 142.5, 27.5, 16, MAGENTA);
  b.label('STAR ARCADE', 142.5, 31, 14, SKY);
  b.label('SECURITY', 142, 23.5, 16, MAGENTA);
  for (const [x, z] of [[131, 30], [154, 30], [142, 25], [142, 36]]) b.lamp(x, z);
  b.arrow(142, 26, N); b.arrow(130, 36, E); b.arrow(156.5, 36.5, S);
  b.carve(128, 38, 131, 39, F.INTERIOR); b.carve(155, 38, 158, 39, F.INTERIOR);   // arcade ↔ food court
  // Food court atrium: the mezzanine ring is overhead, the middle is open to the broken skylight.
  b.carve(124, 40, 162, 68, F.INTERIOR);
  b.paint(131, 46, 155, 68, F.SIDEWALK);                                   // under the open skylight
  // Escalators up to the mezzanine (west and east), with glass balustrades.
  b.stairs(131, 56, 133, 57, '-x', F.TILES); b.prop('barrier', 131, 55, 3, 1); b.prop('barrier', 131, 58, 3, 1);
  b.stairs(153, 50, 155, 51, '+x', F.TILES); b.prop('barrier', 153, 49, 3, 1); b.prop('barrier', 153, 52, 3, 1);
  // The dry fountain and the helicopter tail poking down through the skylight.
  b.prop('fountain', 142, 57, 4, 4, { color: 0xd8d0c8 });
  b.label('DRY FOUNTAIN', 144, 62.5, 12, CREAM);
  b.prop('container', 137, 47, 1, 8, { color: 0xe86a5a, rot: 0.25 });   // tail boom
  b.prop('pillar', 136, 46, 3, 1, { color: 0xe86a5a });                  // tail fin
  b.prop('crate', 140, 53, 2, 1, { color: 0x8fd8ff }); b.prop('crate', 134, 50, 1, 1, { color: 0x8fd8ff });   // skylight glass
  b.label("LARRY'S CHOPPER", 139.5, 49, 14, RED, WEST);
  // Tables in clusters, planters and the mezzanine's pillars.
  for (const [x, z] of [[127, 44], [127, 52], [127, 62], [159, 44], [159, 58], [148, 47], [150, 63], [137, 63]]) b.prop('desk', x, z, 2, 2, { color: 0xffe0b0 });
  for (const [x, z] of [[145, 52], [134, 60]]) b.prop('bush', x, z, 2, 1);
  for (const [x, z] of [[130, 45], [156, 45], [130, 66], [156, 66]]) b.prop('pillar', x, z, 1, 1, { color: 0xffd0e0 });
  b.prop('bench', 124, 56, 1, 3); b.prop('bench', 161, 50, 1, 3);
  b.pick('ammo', 125, 41); b.pick('ammo', 162, 41); b.pick('medkit', 162, 67);
  b.label('FOOD COURT', 143, 49.5, 34, LEMON);
  for (const [x, z] of [[127, 48], [127, 58], [160, 48], [160, 60], [143, 54], [136, 62], [150, 58], [143, 66]]) b.lamp(x, z);
  b.arrow(143, 46, N); b.arrow(129.5, 42, N);
  zz(150, 54, WEST); zz(138, 58, N);
  // Food stall kitchens along the south wall (hidey-holes and horde lanes).
  for (const [x0, name, col] of [[124, 'NOODLES', PINK], [131, 'TACO TACO', LEMON], [146, 'BUBBLE TEA', MINT], [153, 'PRETZEL', GOLD]] as const) {
    b.carve(x0, 69, x0 + 5, 70, F.INTERIOR); b.carve(x0, 71, x0 + 5, 76, F.TILES);
    b.prop('counter', x0 + 2, 69, 4, 1, { color: 0xf0e2b6 }); b.prop('shelf', x0 + 1, 76, 4, 1);
    b.label(name, x0 + 3, 67.8, 12, col);
    b.lamp(x0 + 3, 73.5);                                                  // a lit kitchen reads as worth a look from the court
  }
  b.pick('ammo', 125, 75); b.pick('ammo', 126, 75); b.pick('medkit', 149, 75); b.pick('ammo', 157, 74); b.pick('ammo', 157, 75);
  // Loading-dock corridor, under the dock catwalk. The police barricaded it from the dock side; it
  // gives when the team leaves the parking office, and the finale horde pours through it.
  const dockDoor = b.door(140, 69, 143, 69, 'barricade', 'MBPD: NO ENTRY');
  b.label('POLICE BARRICADE', 141.5, 67.6, 10, RED, N);
  b.carve(140, 70, 143, 79, F.CONCRETE);
  b.prop('pallet', 140, 73); b.prop('crate', 143, 76);
  b.pick('ammo', 143, 71); b.pick('medkit', 140, 78);
  b.label('LOADING DOCK', 141.5, 74, 14, GOLD, N);
  b.lamp(141.5, 71); b.lamp(141.5, 78);
  b.arrow(141.5, 76, S);

  // ------------------------------------------------------------------
  // 9. Loading dock: the police evacuation point (the Big Hold On), truck yard, freight lift
  // ------------------------------------------------------------------
  // St. Marigold sent its awake patients and staff here by ambulance at 3:30; the police ran them down
  // the freight lift to the service tunnel and the rail yard, then left on the last car at 4:15. They
  // barricaded the corridor from the food court, left their rocket pod in a sandbag nest by the lift and
  // ran the lift's power cells flat; the spares are stashed round the dock. The team comes in from the
  // truck yard (from the car park, through the parking office). The Big Hold On is a scavenge finale
  // (L4D2 Dead Center): the timer stops at each quarter until another cell is picked up.
  // Lanes: A = bays 3-4 from the east yard, B = bays 1-2 from the west yard then the length of the dock,
  // C = the police corridor from the food court (the flank: specials and the Brute; outside the pod's arc).
  b.carve(104, 80, 154, 96, F.CONCRETE);
  //
  //   x 104       114       124       134       144       154       164
  //  72 |c . cold storage . .|                 |C C|                       c = power cell
  //  77 |=|.|=|..|=| R R R R c (returns)        |C C|  (catwalk overhead, storey 1: cell at its west end)
  //  80 H . . . . . . . . . . . . . H . . . . . . . . . . . . . . . .///    H = ladders, /// = stairs up
  //  84 .    van     amb        car    POLICE CORRIDOR (C) . . . van  dd O|LIFT|  d = supply desk, O = button
  //  88 .  ~sb~      ~sb~       ~sb~      ~sb~           ~sb~ nn  *  f    |      * = stand, f = lift gate
  //  91 .  tents                                               G ##    |      G = Fizzbang Pod, facing SW
  //  95 .  BAY 1         BAY 2        BAY 3    BAY 4            . . c  (compactor)
  //  97 ####BBBB######BBBB##########BBBB####BBBB######################
  //  99 . lane B (west yard)  .|. lane A (centre yard) . . . . . . lane A (SE yard) . <gate
  //     (the police fence splits the yard at x 131)
  //
  // Truck bays in the south wall: the shutters are up and the yard is full of sleepers. A police fence
  // splits the yard in two, so the west half feeds bays 1 and 2 (lane B: in, then the length of the
  // dock past the cells) and the east half bays 3 and 4 (lane A: straight at the pod).
  b.carve(104, 99, 163, 106, F.ASPHALT);
  b.walls(103, 97, 164, 107, WALL.FENCE, 3.2);
  b.fill(131, 99, 131, 106); b.walls(131, 99, 131, 106, WALL.FENCE, 3.2);
  b.label('POLICE LINE', 133, 103, 9, RED, E);
  for (const [x0, n] of [[110, 1], [126, 2], [136, 3], [144, 4]] as const) {
    b.carve(x0, 97, x0 + 3, 98, F.CONCRETE);
    b.label(`BAY ${n}`, x0 + 2, 95.4, 12, GOLD);
    b.lamp(x0 + 2, 99.6);                                                // each bay lit from the yard side: the lanes read from the pod
  }
  b.prop('truck', 105, 104, 8, 2, { color: 0xf0e2b6 }); b.prop('container', 118, 104, 6, 2, { color: 0x8fb4c6 });
  b.prop('pallet', 124, 101); b.prop('pallet', 138, 105); b.prop('car', 150, 100, 2, 1, { color: 0x3a5fd0 });
  // Back-of-house pockets round the dock, dead ends now: the spare power cells were stashed in them.
  b.carve(106, 72, 121, 76, F.TILES);                                     // cold storage (NW)
  b.carve(110, 77, 112, 79, F.TILES); b.carve(117, 77, 118, 79, F.TILES);
  b.prop('shelf', 107, 72, 6, 1, { color: 0xd8efe8 }); b.prop('shelf', 114, 72, 6, 1, { color: 0xd8efe8 }); b.prop('crate', 120, 75);
  b.label('COLD STORAGE', 114, 74.5, 14, SKY);
  b.carve(155, 94, 163, 96, F.CONCRETE);                                  // compactor (SE), round the corner from the pod
  b.prop('dumpster', 160, 94, 2, 1); b.label('COMPACTOR', 158, 95.8, 10, CREAM);
  // Returns nook under the catwalk, by the mid-span ladder.
  b.carve(120, 77, 127, 78, F.CONCRETE); b.carve(120, 79, 121, 79, F.CONCRETE);
  b.prop('pallet', 123, 77, 2, 1);
  b.label('RETURNS', 120.5, 80.6, 10, CREAM);
  // The power cells (the catwalk's is with storey 1): the near one first, the far ones up the long lane B.
  b.item('part', 'cell', 106, 75, 'power cell'); b.label('SPARE CELL', 107, 76.4, 8, GOLD);
  b.item('part', 'cell', 127, 78, 'power cell'); b.label('SPARE CELL', 126, 77.2, 8, GOLD);
  b.item('part', 'cell', 162, 95, 'power cell'); b.label('SPARE CELL', 162, 96.6, 8, GOLD);
  // Dock floor. Solid cover (vans, the ambulance, a car) stands along the north wall between the
  // pocket mouths, where the runners go; the middle stays clear for the pod, with only low broken
  // sandbags (see-through cover, never a wall) and the triage tents tucked in the dead-end west end.
  b.prop('van', 113, 81, 3, 1, { color: 0x3a5fd0 }); b.prop('van', 124, 81, 3, 1, { color: 0xf4f4f4 }); b.prop('car', 134, 81, 2, 1, { color: 0xffd43b });
  b.prop('van', 145, 81, 3, 1, { color: 0x3a5fd0 });
  b.prop('container', 104, 89, 2, 4, { color: 0xe8f0ee }); b.prop('container', 104, 94, 2, 2, { color: 0xe8f0ee });   // triage tents
  for (const [x, z] of [[110, 88], [119, 91], [127, 86], [134, 92], [141, 87]] as const) b.prop('barrier', x, z, 2, 1, { color: 0xc9b38a });
  b.label('MBPD EVACUATION POINT', 128, 90, 18, LEMON); b.label('ST. MARIGOLD OVERFLOW', 107, 92, 9, MINT, E);
  b.label('BAYSIDE GALLERIA DELIVERIES', 124, 84.5, 16, CREAM);
  b.label('POLICE CORRIDOR', 141.5, 81.6, 10, RED);
  b.pick('ammo', 105, 81); b.pick('ammo', 128, 95);
  for (const [x, z] of [[108, 84], [118, 87], [128, 93], [138, 85], [146, 90], [113, 95], [141, 82], [114, 76], [109, 74], [124, 79], [159, 95], [118, 102], [140, 104], [157, 102]]) b.lamp(x, z);
  // Way in from the yard gate: west along the yard, north through bay 4 to the lift button.
  b.arrow(160, 100.5, WEST); b.arrow(145.5, 99.5, N); b.arrow(148, 93, 3 * Math.PI / 4);
  b.label('YARD GATE', 162, 102.6, 10, CREAM, WEST);
  // Dock catwalk access: a ladder at the west end and mid-span, stairs at the east end (catwalk is storey 1).
  b.ladder(108, 80, '-z'); b.ladder(130, 80, '-z');
  b.stairs(151, 80, 153, 81, '-x'); b.prop('barrier', 151, 82, 3, 1);
  b.label('CATWALK', 108.5, 81.6, 10, CREAM); b.label('CATWALK', 130.5, 81.6, 10, CREAM); b.label('CATWALK', 152, 83.4, 10, CREAM);
  // Freight lift (end safe room) behind its gate. The police ran its cells flat: it needs four.
  b.carve(156, 84, 163, 92, F.SAFE);
  const liftButton = b.obj('terminal', 154, 85, 'Call the freight lift');
  const liftGate = b.door(155, 86, 155, 89, 'fence', 'FREIGHT LIFT');
  b.label('FREIGHT LIFT', 160, 87, 18, GOLD); b.label('TO SERVICE TUNNEL', 160, 89.5, 11, CREAM);
  b.label('NEEDS 4 POWER CELLS', 160, 91.4, 9, RED);
  b.lamp(160, 88);
  // The stand by the button: the police's supply desk (stocked for the wait, before it, not after).
  b.prop('desk', 149, 84, 2, 1, { color: 0x3a5fd0 }); b.label('MBPD SUPPLIES', 150, 83.2, 8, SKY);
  for (const x of [149, 150, 151, 152]) b.pick('medkit', x, 85);
  b.pick('ammo', 151, 84); b.pick('ammo', 152, 84); b.pick('ammo', 152, 86);
  b.pick('firebomb', 149, 86); b.pick('rattle', 150, 86); b.pick('firebomb', 151, 86);
  b.lamp(150.5, 86.5);
  // The Fizzbang Pod's nest in the dock's south-east corner beside the lift: the wall at its back, broken
  // sandbags on its flanks, facing south-west. Its 80 degrees either way take in bays 1-4 and the whole
  // length of the dock; the police corridor's mouth (lane C, north-west) stays just outside it.
  b.mount('rockets', 153, 91, '-x+z');
  b.prop('barrier', 151, 88, 2, 1, { color: 0xc9b38a }); b.prop('barrier', 154, 92, 1, 2, { color: 0xc9b38a });
  b.label('FIZZBANG POD: MBPD', 151, 90, 8, SKY, N); b.label('FACE THE BAYS', 149.5, 93.6, 11, RED);

  // ------------------------------------------------------------------
  // 9b. Staff corridor and Plumley's ground floor: Cosmetics & Perfume, Shoes & Handbags
  // ------------------------------------------------------------------
  // Plumley's is the Galleria's old department store (x 165-203). Its ground floor is two halls split
  // by the perfume wall: in at the north-west, south-east through the perfume counters (tight, shotgun
  // range), through the mirror panel the sleepers walked into, then west through shoes to the
  // escalator up by the west wall. The far east (the Snoozle tower, round the wall's end) is optional.
  b.carve(152, 15, 166, 16, F.INTERIOR);
  b.pick('ammo', 158, 16);
  b.label('STAFF CORRIDOR', 159, 15.5, 9, CREAM, E);
  b.lamp(154, 16); b.lamp(164, 15.5);
  b.arrow(165, 15.5, E);
  b.carve(167, 4, 202, 48, F.INTERIOR);
  b.paint(167, 27, 202, 48, F.WOOD);
  b.fill(167, 26, 196, 26);                                               // the perfume wall
  b.carve(181, 26, 183, 26, F.INTERIOR);                                  // its smashed mirror panel
  b.label('MIND THE GLASS', 182, 24.6, 8, CREAM, S); b.lamp(182, 25);
  // Perfume and cosmetics islands, with pastel bottle displays.
  for (const x of [171, 178, 185, 192]) for (const z of [7, 12, 20]) b.prop('counter', x, z, 3, 2, { color: x % 2 ? 0xffd0e0 : 0xfff1c9 });
  for (const [x, z] of [[175, 5], [189, 16], [182, 23], [196, 9], [169, 22]]) b.prop('barrel', x, z, 1, 1, { color: pastel() });
  b.prop('pillar', 199, 6, 2, 2, { color: 0xffe0b0 });                    // a Snoozle display tower
  b.pick('shotgun', 201, 5); b.pick('ammo', 202, 5); b.pick('ammo', 168, 5); b.pick('medkit', 201, 24);
  b.label("PLUMLEY'S", 184, 16.5, 30, PINK, E); b.label('COSMETICS & PERFUME', 184, 10, 12, LEMON, E);
  b.label('SNOOZLE SAYS: SMELL DREAMY', 199.5, 9.4, 8, PINK, S);
  for (const [x, z] of [[171, 16], [181, 10], [188, 18], [196, 12], [200, 22]]) b.lamp(x, z);
  b.arrow(170, 15.5, E); b.arrow(176, 17, E); b.arrow(182, 23, S);
  zz(182, 17, S); zz(199, 25, S);
  // Shoes and handbags: shoe walls and fitting benches, a fitting-room pocket on the south wall.
  for (const x of [173, 179, 185, 191]) b.prop('shelf', x, 30, 1, 7, { color: 0xe8dcff });
  for (const x of [176, 188]) b.prop('bench', x, 40, 3, 1);
  b.prop('counter', 196, 36, 1, 4, { color: 0xc9b8ff });
  b.fill(185, 43, 197, 43); b.carve(190, 43, 191, 43, F.WOOD);             // fitting rooms
  b.fill(185, 44, 185, 48); b.fill(197, 44, 197, 48);
  for (const x of [188, 194]) b.prop('shelf', x, 46, 1, 3, { color: 0xffb3d1 });   // curtains
  b.pick('armor', 196, 48); b.pick('ammo', 186, 48);                       // off-route reward
  b.label('FITTING ROOMS', 190.5, 45.4, 9, PINK, N);
  b.label('SHOES & HANDBAGS', 184, 34, 14, LEMON, WEST);
  // The escalator up to Home & Bedding, against the west wall (it rises north).
  b.fill(167, 38, 169, 39); b.fill(169, 40, 169, 42);
  b.stairs(167, 40, 168, 42, '-z', F.TILES);
  b.label('ESCALATOR UP: HOME & BEDDING', 167.5, 45, 7, GOLD, S);
  b.note(171, 47, 'Customer service board', 'SWEET DREAMS NIGHT LATE OPENING till 3 a.m.! Free Hush Pillow Mist with every pillow, courtesy of Dreamwell. [pen:] Bob from Bedding dozed off on Bed 4 at 2:50.');
  b.pick('medkit', 170, 47); b.pick('ammo', 169, 44);
  for (const [x, z] of [[199, 31], [190, 36], [180, 41], [169, 45], [191, 46]]) b.lamp(x, z);
  b.arrow(182, 30, S); b.arrow(178, 42.5, WEST); b.arrow(167.5, 44, N);

  // ------------------------------------------------------------------
  // 9c. Galleria Parking, ground deck, and the parking office (checkpoint)
  // ------------------------------------------------------------------
  // Three decks (x 166-224, z 54-106): ground, level 1 and the open roof (storey 2). The team comes
  // down from the roof: the roof is crossed corner to corner (NE footbridge → SW ramp), level 1 along
  // its south side (SW → the SE ramp), and the ground deck back west to the office. St. Marigold's ambulances queued nose to tail all the
  // way up for the evacuation point. Enclosed and dim below the roof: flashlight decks, mid sightlines.
  b.walls(166, 54, 224, 106, WALL.BUILDING, TERRACE);
  b.walls(165, 51, 224, 53, WALL.FENCE, 2.5);                             // the service lane under the footbridge
  b.carve(167, 55, 223, 105, F.CONCRETE);
  const pillars = () => { for (const x of [176, 186, 196, 206]) for (const z of [64, 74, 84, 94]) b.prop('pillar', x, z, 1, 1, { color: 0x9aa6b0 }); };
  pillars();
  // The ramp up from the ground deck to level 1 (south-east corner; it rises north).
  b.fill(219, 98, 219, 103);
  b.stairs(220, 98, 223, 103, '-z');
  b.label('GROUND: PARKING OFFICE', 216.5, 104.6, 9, GOLD, WEST);
  // Ground deck: ambulances, a police car, rows of parked cars.
  for (const [x, z, c] of [[210, 70, 0xf4f4f4], [200, 78, 0xf4f4f4], [190, 86, 0xff6b6b], [214, 88, 0x3a5fd0]] as const) b.prop('van', x, z, 3, 1, { color: c });
  for (const x of [170, 173, 180, 183, 190, 199, 202, 209, 212]) b.prop('car', x, 56, 1, 2, { color: PASTEL[x % 5] });
  for (const x of [179, 182, 192, 195, 201, 211]) b.prop('car', x, 103, 1, 2, { color: PASTEL[(x + 2) % 5] });
  // One Snoozle alarm car (docs/booby-traps.html) on the run west to the office: the last one on the decks.
  for (const [x, z] of [[181, 69], [193, 69], [181, 79], [212, 79], [188, 97], [200, 97]]) {
    const o = { color: PASTEL[(x + z) % 5] };
    if (x === 188 && z === 97) b.alarmCar(x, z, 2, 1, o); else b.prop('car', x, z, 2, 1, o);
  }
  b.prop('terminal', 178, 89); b.prop('barrier', 177, 86, 1, 3);           // pay machine, queue rail
  b.pick('ammo', 222, 75); b.pick('medkit', 205, 104); b.pick('ammo', 187, 104);
  b.label('LEVEL G', 205, 66, 22, CREAM, WEST); b.label('EVAC QUEUE', 196, 82, 12, RED, WEST);
  for (const [x, z] of [[214, 67], [200, 72], [186, 80], [176, 90]]) b.lamp(x, z);
  b.arrow(216, 101, WEST); b.arrow(198, 100.5, WEST); b.arrow(180, 95, WEST);
  // The parking office (checkpoint safe room), south-west corner: in from the deck, out to the truck yard.
  b.fill(167, 96, 176, 96); b.fill(176, 97, 176, 105);
  b.carve(167, 97, 175, 105, F.SAFE);
  const officeEntry = b.door(171, 96, 172, 96, 'shutter', 'PARKING OFFICE');
  const officeExit = b.door(166, 100, 166, 101, 'shutter', 'YARD GATE');
  b.carve(164, 100, 165, 101, F.CONCRETE);                                // the gate through the yard fence
  b.prop('counter', 173, 98, 1, 3, { color: 0x9aa6b8 }); b.prop('terminal', 175, 98); b.prop('desk', 174, 104, 2, 1);
  const officeLever = b.obj('lever', 167, 98, 'Open the yard gate');
  b.note(173, 101, 'MBPD clipboard', 'EVAC POINT 2, Galleria dock. 61 awake folks down the freight lift to the rail yard. Last car 4:15. Lift cells flat, spares stashed round the dock. Pod in the nest by the lift, leave it. The lift CHIMES all the way up. They come for the chime. Face the bays, mind the corridor. Sgt. Tuttle');
  for (const x of [168, 169, 170, 171]) b.pick('medkit', x, 105);
  b.pick('ammo', 172, 105); b.pick('ammo', 173, 105); b.pick('ammo', 175, 102);
  b.pick('rifle', 175, 100); b.pick('autoshotgun', 175, 101); b.pick('shotgun', 168, 103); b.pick('smg', 169, 103); b.pick('launcher', 170, 103);
  b.pick('armor', 175, 97); b.pick('firebomb', 167, 105); b.pick('rattle', 172, 103); b.pick('machete', 174, 103);
  b.label('SAFE ROOM', 171, 99.5, 18, RED); b.label('PARKING OFFICE', 171, 104.2, 10, GOLD);
  b.label('PARKING OFFICE', 171.5, 94.6, 12, GOLD, N);
  b.lamp(171, 101); b.lamp(171.5, 94);

  // ==================================================================
  // STOREY 1: 2F wards, lower roofs, Bun Bun Toys, mezzanine, dock catwalk
  // ==================================================================
  b.level(1);
  wallUp(3, 3, 61, 36, ROOF);                                             // the tower: walls run up to the roof
  wallUp(62, 3, 99, 36, TERRACE);                                         // the east wing: up to the terrace

  // ------------------------------------------------------------------
  // 10. Floor 2: east hall (fire stairs arrive; elevator stuck), corridor A
  // ------------------------------------------------------------------
  b.carve(80, 5, 97, 35, F.TILES);
  wallUp(85, 4, 88, 6, TERRACE);                                          // the elevator shaft
  b.label('FLOOR 2', 90, 12, 40, SOUP); b.label('ELEVATOR: FAULT', 86.5, 7.8, 12, RED);
  b.label('MMM... SOUP', 83, 25, 12, SOUP);
  b.label('STAIRS TO FLOOR 3: DAY ROOM', 84, 18.6, 11, GOLD);
  gurney(90, 25); b.prop('bench', 96, 14, 1, 3); b.prop('shelf', 97, 30, 1, 3);
  b.pick('ammo', 96, 34); b.pick('medkit', 81, 8);
  b.lamp(90, 8); b.lamp(90, 20); b.lamp(90, 31);
  b.arrow(94.5, 11, S); b.arrow(84.5, 21.5, WEST);
  // Roof access D: stairs up to the skybridge terrace (locked until the roof doors give).
  wallUp(81, 29, 84, 33, TERRACE);
  b.stairs(82, 30, 83, 32, '+z', F.TILES);
  const hutD = b.door(82, 29, 83, 29, 'shutter', 'ROOF ACCESS D');
  b.label('ROOF ACCESS', 82.5, 27.6, 10, CREAM);
  // Fire exit onto the lobby roof (locked until the roof doors give).
  const fireExit = b.door(88, 36, 89, 36, 'shutter', 'FIRE EXIT');
  b.label('FIRE EXIT', 88.5, 34.6, 10, RED);
  // Corridor A runs west the whole length of the floor. The way on is only halfway: the day room,
  // whose stairs come up among the Sleep Clinic's pods. The west half (wards 2A-2C, patient rooms,
  // the west stair hall) is an optional loop with its own way up.
  b.carve(9, 20, 79, 23, F.TILES);
  gurney(62, 20); gurney(52, 23); gurney(33, 20); gurney(18, 23);
  b.prop('bench', 40, 23, 2, 1); b.prop('bench', 24, 20, 2, 1);
  for (const x of [12, 24, 36, 48, 60, 72]) b.lamp(x, 21.5);
  b.arrow(66, 21.5, WEST); b.arrow(50, 21, N);
  // IV stands and wheelchairs dragged toward the day room (wordless arrows).
  for (const x of [74, 64, 57]) b.prop('barrier', x, 23, 1, 1);
  zz(46, 20.5, N);

  // ------------------------------------------------------------------
  // 11. Floor 2: wards, patient rooms, day room and the soup, nurses' post
  // ------------------------------------------------------------------
  for (const [x0, x1] of [[10, 18], [21, 29], [32, 40], [43, 51], [54, 62], [65, 76]]) {
    const mid = Math.floor((x0 + x1) / 2);
    b.carve(mid, 24, mid + 1, 24, F.TILES); b.carve(x0, 25, x1, 35, F.TILES);
    b.prop('bed', x0 + 1, 27, 1, 2, { color: 0xfff1f0 }); b.prop('bed', x1 - 1, 31, 1, 2, { color: 0xfff1f0 });
    b.prop('desk', x0 + 1, 34, 1, 1);
  }
  b.pick('ammo', 12, 34); b.pick('medkit', 39, 26); b.pick('ammo', 60, 34); b.pick('medkit', 75, 26);
  b.label('WARD 2A', 14, 30, 12, MINT); b.label('WARD 2C', 36, 30, 12, MINT); b.label('WARD 2E', 58, 30, 12, MINT);
  // Patient rooms north of the corridor.
  for (const [x0, x1, door] of [[10, 21, 15], [24, 37, 30]]) {
    b.carve(door, 19, door + 1, 19, F.TILES); b.carve(x0, 5, x1, 18, F.TILES);
    b.prop('bed', x0 + 1, 7, 1, 2, { color: 0xfff1f0 }); b.prop('bed', x1 - 1, 7, 1, 2, { color: 0xfff1f0 });
    b.prop('bed', x0 + 1, 14, 1, 2, { color: 0xfff1f0 }); b.prop('bed', x1 - 1, 14, 1, 2, { color: 0xfff1f0 });
    b.prop('desk', door, 11, 2, 1);
  }
  b.pick('ammo', 11, 17); b.pick('ammo', 36, 6);
  // Day room and soup kitchen.
  b.carve(46, 19, 54, 19, F.TILES); b.carve(40, 5, 60, 18, F.TILES);
  for (const [x, z] of [[43, 8], [48, 8], [43, 13], [48, 13]]) b.prop('desk', x, z, 2, 2);
  b.prop('counter', 54, 6, 1, 9, { color: 0xf2c48d }); b.prop('gen', 57, 9, 2, 2, { color: 0xf2a541 });   // the soup pot
  b.prop('shelf', 59, 15, 2, 1);
  b.pick('medkit', 59, 17); b.pick('ammo', 57, 6);
  b.label('DAY ROOM', 46, 11, 22, MINT); b.label('SOUP', 57.5, 12.5, 18, SOUP);
  b.lamp(46, 10.5); b.lamp(57, 14);
  // The main stairs up to Floor 3, against the day room's west wall: they come up in the pod ward.
  b.fill(42, 14, 42, 16);
  b.stairs(40, 14, 41, 16, '-z', F.TILES);
  b.label('STAIRS UP', 40.5, 18.2, 12, GOLD, N); b.label('FLOOR 3: SLEEP CLINIC', 44.5, 17.4, 8, LAV, N);
  // A Snoozle nightlight at the foot of the stairs, on the day room's west wall: its cone lies across
  // the bottom step, glowing at the team all the way in from the door. Shoot it before you climb.
  b.nightlight(40, 17, '+x');
  b.lamp(41, 18);
  b.arrow(44, 17, WEST);
  // Floor 2 nurses' post, with roof access E in its corner.
  b.carve(70, 19, 71, 19, F.TILES); b.carve(79, 12, 79, 14, F.TILES);
  b.carve(63, 5, 78, 18, F.TILES);
  wallUp(65, 4, 68, 9, TERRACE);
  b.stairs(66, 7, 67, 9, '-z', F.TILES);
  const hutE = b.door(66, 10, 67, 10, 'shutter', 'ROOF ACCESS E');
  wallUp(65, 10, 65, 10, TERRACE); wallUp(68, 10, 68, 10, TERRACE);    // the shutter sits in the enclosure wall
  b.prop('counter', 71, 8, 6, 1, { color: 0x9fe3cf }); b.prop('terminal', 76, 6); b.prop('bench', 72, 16, 3, 1);
  gurney(64, 15);
  b.pick('ammo', 77, 17); b.pick('smg', 73, 6);
  b.label("NURSES' POST 2", 72, 12, 18, SOUP); b.label('ROOF ACCESS', 66.5, 11.6, 10, CREAM);
  b.lamp(72, 11);
  // West stair hall: corridor A ends here, stairs up to the Sleep Clinic.
  b.carve(4, 5, 8, 35, F.TILES);
  wallUp(4, 5, 8, 9, ROOF);
  wallUp(4, 10, 4, 12, ROOF); wallUp(7, 10, 7, 12, ROOF);
  b.stairs(5, 10, 6, 12, '-z', F.TILES);
  b.prop('bench', 4, 28, 1, 2); b.prop('barrier', 8, 31);
  b.label('STAIRS UP', 6.5, 15, 16, GOLD, N); b.label('FLOOR 3: SLEEP CLINIC', 6.5, 18, 8, LAV, N);
  b.lamp(6.5, 30); b.lamp(6.5, 16);
  b.arrow(6.5, 25, N); b.arrow(6.5, 14, N);

  // ------------------------------------------------------------------
  // 12. Lower roofs (storey 1): the ER roof (optional ladder route) and the lobby roof
  // ------------------------------------------------------------------
  b.carve(4, 37, 36, 62, F.CONCRETE);                                     // ER roof
  b.open(37, 37, 37, 62);                                                 // a gap between the two roofs
  b.prop('gen', 9, 41, 3, 2, { color: 0xb8c4c8 }); b.prop('gen', 24, 46, 3, 2, { color: 0xb8c4c8 }); b.prop('gen', 14, 52, 2, 2, { color: 0xb8c4c8 });
  b.prop('crate', 31, 40); b.prop('crate', 32, 40); b.prop('pallet', 18, 58, 2, 1); b.prop('bench', 21, 61, 2, 1);
  // Larry's smoke-break ledge: a rifle perch over the ambulance bay.
  b.pick('rifle', 16, 61); b.pick('ammo', 17, 61); b.pick('medkit', 25, 61); b.pick('armor', 34, 39);
  b.note(20, 60, 'Thermos on the roof ledge', 'Best seat in the house. You can see the helipad AND the Galleria skylight. Back in 10, just resting my eyes. L.');
  b.label('LARRY WAS HERE', 20, 57.5, 12, GOLD);
  b.lamp(20, 59);
  b.carve(38, 37, 98, 64, F.CONCRETE);                                    // lobby roof
  b.prop('gen', 46, 44, 3, 2, { color: 0xb8c4c8 }); b.prop('gen', 74, 48, 3, 2, { color: 0xb8c4c8 }); b.prop('gen', 90, 56, 2, 2, { color: 0xb8c4c8 });
  b.prop('container', 58, 52, 4, 2, { color: 0x8fb4c6 }); b.prop('crate', 80, 40); b.prop('crate', 81, 40); b.prop('pallet', 64, 60, 2, 1);
  b.pick('ammo', 96, 62); b.pick('ammo', 40, 63);
  // Ladders up the east wing's south wall to the skybridge terrace (storey 2).
  b.ladder(66, 37, '-z'); b.ladder(92, 37, '-z');
  b.label('LADDER', 66.5, 39, 10, CREAM); b.label('LADDER', 92.5, 39, 10, CREAM);
  b.lamp(68.5, 39.5); b.lamp(94.5, 39.5);

  // ------------------------------------------------------------------
  // 13. Galleria storey 1: Bun Bun Toys, its stockroom (checkpoint), the mezzanine
  // ------------------------------------------------------------------
  wallUp(122, 2, 163, 39, ROOF);
  wallUp(122, 40, 163, 79, TERRACE);
  b.carve(136, 6, 162, 37, F.WOOD);                                       // Bun Bun Toys
  // The escalator foot: two flights down from the upper concourse.
  wallUp(153, 30, 153, 32, ROOF); wallUp(156, 30, 157, 32, ROOF); wallUp(160, 30, 160, 32, ROOF);
  b.stairs(154, 30, 155, 32, '-z', F.TILES); b.stairs(158, 30, 159, 32, '-z', F.TILES);
  // Snoozle plush displays.
  for (const [x, z] of [[139, 10], [149, 10], [139, 18], [149, 18]]) { b.prop('shelf', x, z, 4, 1, { color: 0xffffff }); b.prop('barrel', x + 1, z + 1, 2, 1, { color: 0xffffff }); }
  b.prop('counter', 161, 8, 1, 5, { color: 0xffb3d1 }); b.prop('crate', 145, 26, 2, 2, { color: 0xffb3d1 });
  b.label('SNOOZLE PLUSH: 50% OFF', 149, 14.5, 12, PINK); b.label('BUN BUN TOYS', 149, 24, 22, LEMON);
  b.pick('ammo', 161, 36); b.pick('ammo', 137, 7);
  b.lamp(143, 14); b.lamp(155, 14); b.lamp(149, 34); b.lamp(140, 28);
  b.arrow(152, 35, WEST); b.arrow(139, 27.5, WEST);
  zz(146, 33, WEST);
  const stockEntry = b.door(135, 26, 135, 29, 'shutter', 'BUN BUN STOCKROOM');
  b.carve(124, 20, 134, 34, F.SAFE);
  b.prop('shelf', 124, 21, 1, 6, { color: 0xffffff }); b.prop('shelf', 134, 20, 1, 5, { color: 0xffffff });
  b.prop('crate', 126, 31); b.prop('crate', 132, 23); b.prop('barrel', 133, 24, 1, 1, { color: 0xffffff });
  for (const x of [125, 126, 127, 128]) b.pick('medkit', x, 20);
  b.pick('ammo', 129, 20); b.pick('ammo', 130, 20); b.pick('ammo', 131, 20);
  b.pick('launcher', 125, 33); b.pick('shotgun', 126, 33); b.pick('rifle', 127, 33); b.pick('smg', 132, 33); b.pick('autoshotgun', 133, 33);
  b.pick('machete', 132, 31); b.pick('armor', 133, 21); b.pick('firebomb', 134, 33);
  const stockLever = b.obj('lever', 124, 34, 'Unbolt the back door');
  b.label('SAFE ROOM', 129.5, 24.5, 22, RED); b.label('STOCKROOM: PLUSHIES', 129.5, 30.5, 12, LEMON);
  b.lamp(129.5, 27);
  const stockDoor = b.door(128, 35, 131, 35, 'shutter', 'STOCKROOM BACK DOOR');
  b.carve(128, 36, 131, 39, F.INTERIOR);
  // The mezzanine: a ring around the open atrium, escalators down at the west and east.
  b.carve(124, 40, 162, 74, F.INTERIOR);
  b.open(131, 46, 155, 68);
  b.prop('bench', 124, 47, 1, 3); b.prop('bench', 161, 62, 1, 3); b.prop('bench', 136, 72, 3, 1); b.prop('bench', 148, 42, 3, 1);
  for (const [x, z] of [[124, 66], [162, 44], [124, 74], [162, 74]]) b.prop('bush', x, z);
  b.pick('ammo', 133, 41); b.pick('ammo', 134, 41); b.pick('medkit', 125, 52);
  b.label('MEZZANINE', 143, 42.6, 18, PINK); b.label('SKYLIGHT', 143, 71.5, 12, SKY);
  b.label('ESCALATOR DOWN', 128, 54.5, 10, GOLD); b.label('ESCALATOR DOWN', 158.5, 53.5, 10, GOLD);
  for (const [x, z] of [[127, 43], [143, 43], [159, 43], [127, 57], [159, 57], [127, 71], [143, 71], [159, 71]]) b.lamp(x, z);
  b.arrow(129.5, 44, S); b.arrow(127, 50, S); b.arrow(130.5, 57, E);
  // Dock catwalk: a perch over the finale, ladder at the west end and stairs at the east end.
  b.carve(106, 77, 150, 79, F.CONCRETE); b.carve(146, 80, 150, 81, F.CONCRETE);
  b.prop('crate', 115, 77); b.prop('crate', 132, 77); b.prop('pallet', 140, 77, 2, 1);
  b.pick('rifle', 124, 78); b.pick('ammo', 125, 78); b.pick('medkit', 136, 78); b.pick('ammo', 148, 81);
  b.label('CATWALK', 128, 78, 12, CREAM, E);
  b.lamp(110, 78); b.lamp(128, 78); b.lamp(147, 80);
  // The fourth power cell, at the catwalk's west end (up the west ladder): the furthest run, in full view of the pod.
  b.item('part', 'cell', 106, 77, 'power cell'); b.label('SPARE CELL', 106.5, 79.2, 8, GOLD);

  // ------------------------------------------------------------------
  // 13b. Plumley's first floor: Home & Bedding and the Sweet Dreams Night sale
  // ------------------------------------------------------------------
  // Arrive at the south-west; north-east between the show beds, through the gap in the display wall,
  // south through Dreamwell's sale corner to the escalator up to the Cineplex. The linens along the
  // top (round the wall's north end) are a side loop.
  wallUp(165, 2, 203, 50, ROOF);
  b.carve(167, 4, 202, 48, F.INTERIOR);
  b.paint(167, 4, 202, 11, F.WOOD);
  b.fill(184, 12, 185, 48);                                               // the display wall
  b.carve(184, 27, 185, 29, F.INTERIOR);                                  // a gap halfway down it
  // Show beds: every one neatly made, one dented where Bob lay down.
  for (const x of [170, 175, 180]) for (const z of [15, 23, 31]) b.prop('bed', x, z, 2, 3, { color: pastel() });
  b.label('BED 4', 176, 22.4, 9, CREAM, N);
  b.label('HOME & BEDDING', 176, 27.5, 14, LEMON, S); b.label('MATTRESS TESTERS WELCOME', 176, 37, 8, PINK, S);
  // Linens and pillows along the top.
  for (const x of [170, 176, 190, 196]) b.prop('shelf', x, 4, 4, 1, { color: 0xfff1f0 });
  b.prop('counter', 186, 9, 4, 1, { color: 0xf2c48d });
  b.label('LINENS & PILLOWS', 185, 7.5, 12, CREAM, E);
  // Dreamwell's sale corner: Hush mist displays and nap pods.
  for (const [x, z] of [[189, 16], [196, 16], [189, 24], [196, 24]]) b.prop('bed', x, z, 2, 3, { color: 0xe8dcff });
  for (const [x, z] of [[193, 20], [193, 28], [200, 30], [188, 33]]) b.prop('barrel', x, z, 1, 1, { color: 0xc9a8ff });
  b.prop('counter', 190, 37, 6, 1, { color: 0xc9b8ff });
  b.label('SWEET DREAMS NIGHT SALE', 194, 34.5, 10, LAV, N); b.label('FREE HUSH WITH EVERY PILLOW', 194, 41, 8, PINK, N);
  zz(198, 21, S); zz(187, 28, S);
  b.pick('ammo', 168, 5); b.pick('firebomb', 183, 5); b.pick('ammo', 202, 12);
  b.pick('medkit', 186, 47); b.pick('ammo', 198, 47); b.pick('medkit', 199, 47);   // before the dark cinema
  // The escalator up to the Cineplex, against the east wall (it rises north).
  b.fill(200, 38, 202, 39); b.fill(200, 40, 200, 42);
  b.stairs(201, 40, 202, 42, '-z', F.TILES);
  b.label('ESCALATOR UP: CINEPLEX', 201.5, 45, 7, GOLD, S);
  for (const [x, z] of [[168, 36], [168, 20], [176, 8], [192, 8], [194, 20], [197, 32], [201, 45]]) b.lamp(x, z);
  b.arrow(170, 35, N); b.arrow(177, 28.5, E); b.arrow(188, 28.5, E); b.arrow(198, 32, S); b.arrow(201.5, 44, N);
  b.lamp(184.5, 26);

  // ------------------------------------------------------------------
  // 13c. Galleria Parking, level 1
  // ------------------------------------------------------------------
  // Down from the roof at the south-west, east along the south side to the ramp down in the south-east.
  // The evacuation queue jammed here: ambulances nose to tail up the deck and a crash at the turn,
  // up in the north-east. Dark: flashlight deck.
  b.carve(167, 55, 223, 105, F.CONCRETE);
  pillars();
  b.fill(171, 96, 171, 101);
  b.stairs(167, 96, 170, 101, '-z');                                      // up to the roof (rises north)
  for (const [x, z] of [[176, 99], [184, 92], [192, 85], [200, 78], [208, 71]]) b.prop('van', x, z, 3, 1, { color: 0xf4f4f4 });   // the ambulance queue
  b.prop('van', 213, 66, 1, 3, { color: 0xff6b6b, rot: 0.4 }); b.prop('car', 203, 65, 2, 1, { color: 0x3a5fd0, rot: -0.3 });   // the crash
  for (const x of [178, 181, 188, 191, 194, 203, 210]) b.prop('car', x, 56, 1, 2, { color: PASTEL[(x + 1) % 5] });
  // A Snoozle alarm car in the dark half of the south row, a firebomb in its open boot (tail to the wall).
  for (const x of [180, 186, 193, 199, 205, 214]) {
    const o = { color: PASTEL[(x + 3) % 5] };
    if (x === 205) b.alarmCar(x, 103, 1, 2, o); else b.prop('car', x, 103, 1, 2, o);
  }
  b.pick('firebomb', 205, 105);
  for (const [x, z] of [[214, 80], [214, 92], [182, 72], [190, 64]]) b.prop('car', x, z, 2, 1, { color: PASTEL[(x + z) % 5] });
  b.pick('ammo', 172, 104); b.pick('medkit', 222, 72); b.pick('ammo', 216, 56);
  b.label('LEVEL 1', 190, 100, 22, CREAM, E); b.label('EVAC QUEUE: KEEP LEFT', 196, 90, 10, RED, E);
  for (const [x, z] of [[180, 103], [200, 92], [218, 76]]) b.lamp(x, z);
  b.arrow(175, 102, E); b.arrow(194, 98, E); b.arrow(212, 97, E); b.arrow(221.5, 96.5, S);
  b.label('RAMP DOWN: GROUND', 221.5, 95, 9, GOLD, N); b.lamp(219, 96);

  // ==================================================================
  // STOREY 2: 3F Sleep Clinic, the skybridge terrace, skybridge, Galleria upper concourse
  // ==================================================================
  b.level(2);
  wallUp(3, 3, 61, 36, ROOF);

  // ------------------------------------------------------------------
  // 14. Floor 3: Dreamwell Sleep Clinic reception and pod ward
  // ------------------------------------------------------------------
  b.carve(4, 5, 20, 35, F.TILES);                                         // clinic reception
  b.label('FLOOR 3', 6.5, 7, 16, GOLD, S);
  b.prop('counter', 10, 16, 8, 1, { color: 0xc9b8ff }); b.prop('terminal', 17, 15);
  b.prop('bench', 4, 20, 1, 4); b.prop('bench', 8, 26, 4, 1); b.prop('bush', 19, 6);
  b.pick('ammo', 9, 6); b.pick('medkit', 19, 34);
  b.label('DREAMWELL SLEEP CLINIC', 12, 11, 18, LAV);
  b.label('SNOOZLE SAYS: SLEEP TIGHT', 12, 22, 12, PINK);
  b.lamp(8, 13); b.lamp(15, 24); b.lamp(10, 32);
  b.arrow(9, 9, E); b.arrow(19, 16, E);
  // Roof access B: stairs up to the roof from the reception (locked until the roof doors give).
  wallUp(13, 29, 16, 35, ROOF);
  b.stairs(14, 30, 15, 32, '+z', F.TILES);
  const hutB = b.door(14, 29, 15, 29, 'shutter', 'ROOF ACCESS B');
  b.label('ROOF ACCESS', 14.5, 27.6, 10, CREAM);
  // Sleep pod ward: rows of empty, perfectly made pods.
  b.carve(21, 14, 21, 18, F.TILES);
  b.carve(22, 5, 50, 35, F.TILES);
  let pod = 0;
  for (const z of [7, 14, 21, 28]) for (const x of [24, 28, 32, 36, 40, 44]) {
    pod++;
    if (pod === 20) continue;                                             // a gap in the rows: bed 20 got up and left
    if (pod === 11) continue;                                             // the day-room stairs come up here
    b.prop('bed', x, z, 2, 3, { color: 0xe8dcff });
  }
  b.prop('pillar', 34, 5, 2, 1, { color: 0xf4f0e0 });                    // the wall clock
  b.label('3:00', 35, 6.6, 26, GOLD);
  b.prop('shelf', 49, 5, 1, 3, { color: 0xffffff });                     // whiteboard
  b.note(48, 6, 'Sleep Clinic whiteboard', 'HX-9 TRIAL: deep sleep, 100%. Side effect: sleepwalks toward the chime tone. Stop the chime, they stop? Ask Dr. Lowell. DO NOT tell Pell.');
  // Bed 12 is the last pod of the second row (x 44, z 14).
  b.note(46, 15, 'Patient chart, bed 12', '"In the dream I\'m looking for somewhere quiet. Everything awake is so LOUD." Walked 40 m toward the chime. Calmed when shushed.');
  b.label('12', 45, 13.4, 12, CREAM);
  for (const [x, z, r] of [[23, 11, E], [23, 25, E], [49, 19, WEST], [49, 33, WEST]] as const) b.label('SNOOZLE', x, z, 14, PINK, r);
  b.label('SLEEP TRIALS', 34, 34, 24, LAV);
  b.pick('ammo', 38, 26); b.pick('ammo', 27, 33);
  for (const [x, z] of [[26, 11], [34, 11], [42, 11], [26, 25], [34, 25], [42, 25], [34, 18], [48, 12]]) b.lamp(x, z);
  b.arrow(26, 17.5, E); b.arrow(46, 18.5, E); b.arrow(49.5, 10, E);
  // Roof access C: stairs up from the back of the ward (locked until the roof doors give).
  wallUp(37, 32, 40, 35, ROOF);
  b.stairs(38, 33, 39, 35, '+z', F.TILES);
  const hutC = b.door(38, 32, 39, 32, 'shutter', 'ROOF ACCESS C');
  b.label('ROOF ACCESS', 38.5, 31.6, 9, CREAM);
  // Observation room (checkpoint): one-way glass onto the ward, a monitoring desk.
  const obsEntry = b.door(51, 9, 51, 10, 'shutter', 'OBSERVATION');
  b.carve(51, 5, 51, 8, F.TILES); b.carve(51, 11, 51, 15, F.TILES);
  b.prop('barrier', 51, 5, 1, 4, { color: 0xbfe8f0 }); b.prop('barrier', 51, 11, 1, 5, { color: 0xbfe8f0 });   // the one-way glass
  b.label('ONE-WAY GLASS', 50, 14, 10, SKY, E);
  b.carve(52, 5, 60, 15, F.SAFE);
  b.prop('counter', 53, 5, 5, 1, { color: 0x9aa6b8 }); b.prop('terminal', 53, 6); b.prop('terminal', 56, 6);
  b.prop('desk', 59, 5, 2, 1);
  b.note(59, 6, 'Lanyard on the desk', 'DREAMWELL SLEEP CO. Dr. Wren Lowell, Lead Formulation. Emergency contact: Dorothy "Dot" Lowell (Mum), Mallow Bay Transit.');
  b.note(58, 15, 'Taped to the stairwell door', 'LARRY. Do NOT nap in the chopper. We have talked about this. Mgmt');
  for (const [x, z] of [[52, 15], [53, 15], [54, 15], [52, 14]]) b.pick('medkit', x, z);
  b.pick('ammo', 58, 8); b.pick('ammo', 59, 8); b.pick('ammo', 60, 8);
  b.pick('deagle', 52, 12); b.pick('shotgun', 53, 12); b.pick('rifle', 54, 12); b.pick('smg', 59, 12); b.pick('autoshotgun', 60, 12);
  b.pick('armor', 59, 14); b.pick('bat', 60, 14); b.pick('firebomb', 60, 15);
  const obsLever = b.obj('lever', 60, 10, 'Unlock the stairwell door');
  b.label('SAFE ROOM', 56, 8.5, 20, RED); b.label('OBSERVATION', 56, 13.6, 12, LAV);
  b.lamp(56, 10);
  // Stairwell up to the roof.
  const stairDoor = b.door(56, 16, 57, 16, 'shutter', 'STAIRWELL');
  b.carve(55, 17, 58, 17, F.TILES);
  b.stairs(56, 18, 57, 20, '+z', F.TILES);
  b.label('STAIRS UP: ROOF', 56.5, 14.6, 10, GOLD);
  // East offices: a dead-end side pocket off the ward.
  b.carve(51, 29, 51, 30, F.TILES); b.carve(52, 25, 60, 35, F.TILES);
  b.prop('desk', 53, 26, 3, 1); b.prop('shelf', 57, 25, 3, 1); b.prop('bed', 57, 32, 2, 3, { color: 0xe8dcff });
  b.prop('counter', 55, 29, 1, 4, { color: 0xc9b8ff });
  b.pick('medkit', 60, 26); b.pick('rifle', 52, 35); b.pick('ammo', 53, 35);
  b.pick('armor', 60, 30);                                      // off-route reward
  b.label('NAP POD SHOWROOM', 58, 30, 10, LAV); b.label('DR. W. LOWELL', 54, 28, 10, CREAM);
  b.lamp(56, 30);

  // ------------------------------------------------------------------
  // 15. The skybridge terrace (roof of the east wing; crescendo 2)
  // ------------------------------------------------------------------
  b.carve(62, 4, 98, 36, F.CONCRETE);
  b.fill(84, 4, 89, 7);                                                   // elevator motor room
  b.label('LIFT MOTOR ROOM', 86.5, 8.6, 10, CREAM);
  // Roof-access huts: the tops of the stair cores from Floor 2 (D and E).
  b.fill(81, 29, 84, 34); b.carve(82, 33, 83, 34, F.CONCRETE);
  b.fill(65, 4, 68, 10); b.carve(66, 5, 68, 6, F.CONCRETE);
  b.label('ROOF ACCESS D', 82.5, 35.6, 9, CREAM); b.label('ROOF ACCESS E', 70, 5.6, 9, CREAM, E);
  // Up to the helipad roof: an outside flight and a ladder against the tower wall.
  b.fill(62, 25, 64, 25); b.fill(62, 28, 64, 28);
  b.stairs(62, 26, 64, 27, '-x');
  b.ladder(62, 8, '-x');
  b.label('HELIPAD', 66.5, 26.5, 10, CREAM, WEST); b.label('LADDER', 64, 8.5, 9, CREAM, WEST);
  // Cover: HVAC units, a container, crates. Imperfect on purpose.
  b.prop('gen', 72, 14, 3, 2, { color: 0xb8c4c8 }); b.prop('gen', 88, 22, 2, 2, { color: 0xb8c4c8 });
  b.prop('container', 76, 26, 2, 4, { color: 0x8fb4c6 }); b.prop('crate', 92, 12); b.prop('crate', 93, 12);
  b.prop('pallet', 70, 32, 2, 1); b.prop('barrier', 90, 30, 3, 1); b.prop('barrier', 95, 8, 1, 3);
  b.pick('ammo', 95, 24); b.pick('ammo', 96, 24); b.pick('ammo', 97, 24); b.pick('medkit', 98, 24);
  b.pick('launcher', 95, 25); b.pick('rifle', 96, 25);  // before the skybridge holdout; long roof sightlines
  b.pick('rattle', 97, 25);
  b.label('SKYBRIDGE TERRACE', 80, 18, 20, CREAM);
  b.label('SKYBRIDGE', 96.5, 20, 16, GOLD, E);
  for (const [x, z] of [[64, 4.5], [76, 10], [90, 6], [70, 22], [84, 18], [97, 14], [97, 28], [66, 34], [80, 35], [89, 34]]) b.lamp(x, z);
  b.arrow(68, 26.5, E); b.arrow(82, 22, E); b.arrow(93, 20, E);
  // The skybridge control panel and shutter.
  const skyPanel = b.obj('lever', 98, 17, 'Raise the skybridge shutter (LOUD)');
  const skyShutter = b.door(99, 19, 99, 21, 'shutter', 'SKYBRIDGE');

  // ------------------------------------------------------------------
  // 16. The glass skybridge over the bay inlet
  // ------------------------------------------------------------------
  b.carve(100, 19, 121, 21, F.INTERIOR);
  b.prop('bench', 105, 19, 2, 1); b.prop('barrier', 111, 21, 1, 1); b.prop('bench', 116, 19, 2, 1);
  b.label('SKYBRIDGE TO BAYSIDE GALLERIA', 110.5, 20, 14, GOLD, E);
  for (const x of [102, 108, 114, 120]) b.lamp(x, 20.5);
  b.arrow(103, 20.5, E); b.arrow(118, 20.5, E);

  // ------------------------------------------------------------------
  // 17. Galleria upper concourse: ballroom, chandelier, Dream Shop
  // ------------------------------------------------------------------
  wallUp(122, 2, 163, 39, ROOF);
  b.carve(122, 19, 122, 21, F.INTERIOR);
  b.carve(123, 13, 162, 29, F.INTERIOR); b.carve(123, 30, 152, 37, F.INTERIOR);
  b.carve(161, 30, 162, 37, F.INTERIOR); b.carve(153, 33, 160, 37, F.INTERIOR);
  b.paint(132, 15, 152, 29, F.WOOD);                                       // the old ballroom floor
  for (const [x, z] of [[132, 15], [152, 15], [132, 29], [152, 29]]) b.prop('pillar', x, z, 1, 1, { color: 0xffe0b0 });
  b.label('BAYSIDE GALLERIA', 142, 26.5, 28, PINK); b.label('GRAND BALLROOM 1931', 142, 18.6, 14, LEMON);
  // The chandelier: a ring of lights over the old dance floor.
  for (let a = 0; a < 8; a++) b.lamp(142.5 + Math.cos((a * Math.PI) / 4) * 4, 22.5 + Math.sin((a * Math.PI) / 4) * 4);
  b.lamp(142.5, 22.5);
  b.prop('bench', 125, 15, 1, 3); b.prop('bench', 125, 26, 1, 3); b.prop('bush', 162, 16); b.prop('bush', 162, 27);
  b.pick('ammo', 151, 36); b.pick('medkit', 124, 36);
  b.label('ESCALATOR DOWN: BUN BUN TOYS', 156.5, 27.6, 10, LEMON);
  b.arrow(126, 20.5, E); b.arrow(150, 22.5, E); b.arrow(154.5, 26, S); b.arrow(158.5, 26, S);
  zz(130, 21, E); zz(156, 24, S);
  b.lamp(128, 33); b.lamp(158, 35); b.lamp(158, 18);
  // The Dream Shop: pyjama-clad mannequins and a scrawled poster.
  b.carve(123, 4, 140, 11, F.INTERIOR); b.carve(128, 12, 134, 12, F.INTERIOR);
  for (const [x, z] of [[125, 6], [128, 6], [131, 6], [125, 9], [128, 9], [131, 9]]) b.prop('pillar', x, z, 1, 1, { color: pastel() });
  b.prop('counter', 136, 5, 1, 5, { color: 0xc9b8ff }); b.prop('shelf', 138, 10, 2, 1, { color: 0xe8dcff });
  b.note(133, 11, 'Dream Shop window poster', 'COMING SOON: Hush HX-9 Pillow Mist! Dreamwell, because Mallow Bay deserves to rest. [scrawled:] the one Wren said NO to');
  b.pick('medkit', 139, 5); b.pick('ammo', 123, 4); b.pick('rattle', 138, 4);   // off-route reward
  b.label('DREAMWELL DREAM SHOP', 132, 8, 14, LAV);
  b.lamp(132, 8);
  // Dark shopfronts on the north-east side.
  b.carve(143, 4, 162, 11, F.INTERIOR); b.carve(150, 12, 151, 12, F.INTERIOR);
  b.prop('shelf', 162, 5, 1, 6); b.prop('counter', 145, 9, 4, 1); b.pick('ammo', 160, 10);
  b.label('CLOSED', 152, 7, 12, PINK);

  // ------------------------------------------------------------------
  // 17b. Galleria Cineplex (over Plumley's and east of it): lobby, Screen 1, Screen 2, fire exit
  // ------------------------------------------------------------------
  // The Midnight Marathon audience dozed off in Screen 2 and turned in their seats at 3:00. The way
  // on is through it: in at the back corner, along the cross aisle in the dark, out by the screen,
  // then the long fire-exit corridor down the east side to the footbridge over the service lane.
  wallUp(165, 2, 224, 50, ROOF);
  b.carve(186, 33, 219, 48, F.INTERIOR);                                  // lobby
  b.prop('counter', 205, 45, 9, 1, { color: 0xff8fc8 }); b.prop('gen', 211, 46, 2, 2, { color: 0xffd43b });   // candy bar, popcorn
  b.prop('counter', 190, 44, 1, 3, { color: 0xc9b8ff });                  // ticket podium
  b.prop('bench', 208, 36, 4, 1); b.prop('bench', 194, 36, 1, 3); b.prop('bush', 219, 33); b.prop('bush', 186, 48);
  b.label('GALLERIA CINEPLEX', 208, 40, 18, MAGENTA, WEST);
  b.label('MIDNIGHT MARATHON: SNOOZLE 1, 2, 3', 208, 42.6, 9, LEMON, WEST);
  b.label('SCREEN 2', 188.5, 34.6, 12, GOLD, S);
  b.note(213, 44, "Usher's clipboard", 'Midnight Marathon, Screen 2: 212 tickets. Everybody dozed off in part 2. I stayed up on pick-n-mix. At 3 they all stood up at once, humming. Benji');
  b.pick('ammo', 214, 47); b.pick('ammo', 186, 33);
  for (const [x, z] of [[196, 40], [208, 38], [216, 44], [189, 36]]) b.lamp(x, z);
  b.arrow(198, 37, WEST); b.arrow(188.5, 36, N);
  zz(194, 41, WEST);
  // Screen 1 (side pocket off the lobby): SOLD OUT, its rows empty but for a stash in the projectionist's corner.
  b.carve(167, 33, 184, 48, F.INTERIOR); b.carve(185, 40, 185, 41, F.INTERIOR);
  for (const x of [171, 174, 177, 180]) b.prop('bench', x, 35, 1, 11, { color: 0x8a2b4a });
  b.pick('autoshotgun', 168, 34); b.pick('ammo', 169, 34); b.pick('medkit', 168, 47);   // off-route reward
  b.label('SCREEN 1: SOLD OUT', 176, 47, 9, PINK, WEST);
  b.lamp(169, 40);
  // Screen 2: the screen on the east wall, the seat rows run north-south with a cross aisle.
  b.carve(186, 4, 219, 30, F.INTERIOR); b.carve(188, 31, 189, 32, F.INTERIOR);
  for (const x of [192, 195, 198, 201, 204, 207, 210]) { b.prop('bench', x, 7, 1, 10, { color: 0x8a2b4a }); b.prop('bench', x, 19, 1, 12, { color: 0x8a2b4a }); }
  b.prop('shelf', 219, 8, 1, 18, { color: 0xf4f0e0 });                    // the screen
  b.label('SNOOZLE 2: COUNTING SHEEP', 216.5, 17, 12, CREAM, E);
  b.label('EXIT', 217.5, 28.6, 10, RED, E);
  b.pick('ammo', 187, 5); b.pick('medkit', 213, 5);
  b.lamp(216, 28); b.lamp(188, 18);                                       // only the exit signs are lit
  b.arrow(188.5, 24, N); b.arrow(195, 17.5, E); b.arrow(209, 17.5, E); b.arrow(214, 24, S);
  b.density(186, 4, 219, 30, 2);                                          // a packed house
  // Fire-exit corridor: tight and long, down the east side behind the lobby.
  b.carve(220, 28, 220, 29, F.INTERIOR); b.carve(221, 28, 222, 50, F.INTERIOR);
  b.pick('ammo', 222, 33);
  b.label('FIRE EXIT: CAR PARK', 221.5, 34, 8, RED, N);
  // A Snoozle nightlight on the corridor's end wall, shining down it: Screen 2's packed house is right
  // behind the exit door, and the cone fills the corridor a few steps in.
  b.nightlight(221, 28, '+z');
  for (const z of [30, 39, 48]) b.lamp(221.5, z);
  b.arrow(221.5, 31, S); b.arrow(221.5, 42, S);
  // The footbridge over the service lane onto the car park roof.
  b.carve(221, 51, 222, 54, F.CONCRETE);
  b.lamp(221.5, 52);

  // ------------------------------------------------------------------
  // 17c. Galleria Parking roof (open air): the Sweet Dreams Night fog unit
  // ------------------------------------------------------------------
  // In at the north-east off the footbridge, across to the ramp down in the south-west. Long open
  // sightlines (rifle country), parked cars for cover, and one of Dreamwell's fog trailers, empty.
  b.carve(167, 55, 223, 105, F.CONCRETE);
  b.prop('gen', 192, 76, 4, 2, { color: 0xc9a8ff }); b.prop('gen', 198, 76, 2, 2, { color: 0xc9a8ff });   // fog unit 7 and its blower
  for (const [x, z] of [[191, 79], [193, 79], [195, 79], [197, 79]]) b.prop('barrel', x, z, 1, 1, { color: 0xb38fe0 });   // spent Hush canisters
  b.label('SWEET DREAMS NIGHT: FOG UNIT 7', 195, 74.2, 10, LAV, WEST);
  b.prop('van', 208, 90, 3, 1, { color: 0xf4f4f4 }); b.prop('van', 178, 66, 1, 3, { color: 0x3a5fd0 });   // a news van, a police van
  // Two Snoozle alarm cars at opposite corners of the rifle deck: one by the footbridge where the team
  // comes on, one by the ramp down, 80 m apart (never both in view).
  for (const [x, z] of [[214, 62], [205, 68], [184, 62], [216, 82], [202, 98], [183, 88], [176, 78], [212, 72]]) {
    const o = { color: PASTEL[(x + z) % 5] };
    if ((x === 214 && z === 62) || (x === 176 && z === 78)) b.alarmCar(x, z, 2, 1, o); else b.prop('car', x, z, 2, 1, o);
  }
  for (const x of [172, 186, 200, 214]) b.prop('barrier', x, 104, 3, 1);
  b.pick('rifle', 222, 57); b.pick('ammo', 223, 57); b.pick('medkit', 186, 90); b.pick('ammo', 172, 92);
  b.label('ROOF', 205, 60, 26, CREAM, WEST); b.label('SNOOZLE SAYS: SLEEP TIGHT, MALLOW BAY!', 195, 102, 10, PINK, WEST);
  b.label('RAMP DOWN: LEVEL 1', 168.5, 92.6, 8, GOLD, N);
  for (const [x, z] of [[218, 58], [204, 66], [186, 70], [210, 84], [192, 90], [176, 96], [170, 88]]) b.lamp(x, z);
  b.arrow(218, 60, WEST); b.arrow(204, 72, S); b.arrow(186, 84, WEST); b.arrow(172, 90, S); b.arrow(168.5, 94, S);

  // ==================================================================
  // STOREY 3: the hospital roof and helipad
  // ==================================================================
  b.level(3);

  // ------------------------------------------------------------------
  // 18. Roof and helipad; roof-access huts are where the horde boils up
  // ------------------------------------------------------------------
  b.carve(4, 4, 61, 36, F.CONCRETE);
  b.fill(55, 16, 58, 22); b.carve(56, 21, 57, 22, F.CONCRETE);           // main stairwell hut (from observation)
  b.fill(13, 29, 16, 34); b.carve(14, 33, 15, 34, F.CONCRETE);           // roof access B
  b.fill(37, 32, 40, 35);                                                 // roof access C (opens onto the south edge)
  b.label('ROOF ACCESS A', 56.5, 24, 10, CREAM); b.label('ROOF ACCESS B', 14.5, 35.6, 10, CREAM); b.label('ROOF ACCESS C', 34.5, 36, 9, CREAM);
  // The helipad: big H, landing lights, skid marks, no helicopter.
  b.label('H', 32, 19.5, 110, CREAM); b.label('NO HELICOPTER', 32, 27.5, 12, RED);
  b.label('~~ skid marks ~~', 38, 13, 14, '#2b2b3a', 0.4);
  for (const [x, z] of [[25, 12], [39, 12], [25, 27], [39, 27]]) b.prop('beacon', x, z);
  // HVAC units, vents and crates: imperfect cover.
  b.prop('gen', 7, 7, 3, 2, { color: 0xb8c4c8 }); b.prop('gen', 7, 20, 3, 2, { color: 0xb8c4c8 }); b.prop('gen', 47, 8, 2, 2, { color: 0xb8c4c8 });
  b.prop('container', 48, 27, 2, 4, { color: 0x8fb4c6 }); b.prop('crate', 20, 7); b.prop('crate', 21, 7); b.prop('pallet', 44, 21, 2, 1);
  b.prop('barrier', 52, 31, 3, 1); b.prop('pallet', 10, 30, 2, 1);
  b.pick('ammo', 54, 24); b.pick('ammo', 5, 5); b.pick('medkit', 60, 35);
  b.label('HELIPAD', 32, 6, 26, CREAM);
  b.label('SKYBRIDGE TERRACE', 58, 26.5, 11, GOLD, E);
  for (const [x, z] of [[6, 5], [60, 5], [6, 35], [33, 35], [56, 25], [32, 10], [32, 30], [60, 26.5]]) b.lamp(x, z);
  b.arrow(54, 24.5, WEST); b.arrow(44, 18, WEST); b.arrow(52, 26.5, E); b.arrow(59, 26.5, E);

  b.level(0);
  // ------------------------------------------------------------------
  // Quest
  // ------------------------------------------------------------------
  b.start([[15.5, 55.5], [16.5, 56.5], [19.5, 55.5], [19.5, 57.5]]);
  b.use(triageRadio, {
    objective: 'Radio Dot from triage', opens: [triageDoor],
    radio: [
      ['Dot', 'You made it! Helicopter\'s on the roof. Pilot says he\'ll wait. Ish.'],
      ['Nori', 'I work nights here. Pharmacy. The second floor always smells like soup.'],
      ['Taro', 'Sorry about the doors, St. Marigold.'],
    ],
  });
  b.reach({ x0: 62, z0: 26, x1: 80, z1: 50 }, {
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
    objective: 'Call the staff elevator', horde: true, hold: 60, opens: [fireDoor], cue: 'lift',
    radio: [
      ['Dot', 'Call it down. If that old car faults, it unlocks the fire stairs. Up is up, sweet peas.'],
      ['Mochi', 'Elevator music. Of course there\'s elevator music.'],
      ['Pip', 'The zombies LIKE it! Why do they like it?!'],
      ['Nori', 'It\'s a lullaby. Huh.'],
    ],
  });
  b.reach({ x0: 24, z0: 6, x1: 48, z1: 32, lv: 2 }, {
    objective: 'Search the Sleep Clinic', opens: [obsEntry],
    radio: [
      ['Mochi', 'It came all the way down just to get stuck. Relatable.'],
      ['Dot', 'Fault mode unlocks the fire stairs. Sleep Clinic\'s on three, sweet peas.'],
      ['Nori', 'Dreamwell\'s sleep trials. I filled their prescriptions. \'Hush,\' every night.'],
    ],
  });
  b.gather({ x0: 52, z0: 5, x1: 60, z1: 15, lv: 2 }, {
    objective: 'Lock yourselves in observation', checkpoint: true, closes: [obsEntry],
    radio: [
      ['Taro', 'Every bed empty, and every bed made. That\'s the part I don\'t like.'],
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
  b.reach({ x0: 24, z0: 12, x1: 40, z1: 27, lv: 3 }, {
    objective: 'Get up to the helipad', opens: [hutB, hutC, hutD, hutE, fireExit],
    radio: [
      ['Dot', 'Larry? Come in, Larry. ...Oh, no. He took a nap. He was on a double.'],
      ['Mochi', 'So the helicopter is... on the mall.'],
      ['Dot', 'New plan, sweet peas. Freight trains still run from the rail yard.'],
    ],
  });
  b.use(skyPanel, {
    objective: 'Raise the skybridge shutter', horde: true, hold: 75, opens: [skyShutter],
    radio: [
      ['Dot', 'The skybridge leaves from the terrace one floor down. Panel\'s by the shutter.'],
      ['Taro', 'Every roof door in the place just banged open. Company\'s coming up.'],
      ['Dot', 'Cross the skybridge to the Galleria. Its service tunnel runs to the rail yard.'],
      ['Pip', 'A MALL. Finally, side quests.'],
    ],
  });
  b.reach({ x0: 132, z0: 15, x1: 152, z1: 29, lv: 2 }, {
    objective: 'Cross into the Galleria', opens: [stockEntry],
    radio: [
      ['Taro', 'This was a ballroom once. I took my wife dancing here. She\'d hate the carpet.'],
      ['Nori', '...That\'s actually lovely, Taro.'],
    ],
  });
  b.gather({ x0: 124, z0: 20, x1: 134, z1: 34, lv: 1 }, {
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
      ['Nori', 'Back door lets out on the mezzanine over the food court. Stay together.'],
      ['Pip', 'Snoozle plush is coming with me. For morale.'],
    ],
  });
  b.reach({ x0: 136, z0: 50, x1: 150, z1: 64 }, {
    objective: 'Cross the food court', brute: true,
    radio: [
      ['Pip', 'Is that SNOOZLE? Snoozle is HUGE.'],
      ['Dot', 'That\'s no sheep, sweet pea. That\'s a Brute in a sheep suit.'],
      ['Taro', 'Somebody\'s last shift was a long one.'],
    ],
  });
  b.use(breaker, {
    objective: 'Restore power in Security', opens: [plumShutter],
    radio: [
      ['Dot', 'The loading dock lift needs power. Breakers are in Security, past the arcade.'],
      ['Pip', 'Past the ARCADE?'],
      ['Nori', 'No.'],
    ],
  });
  b.reach({ x0: 167, z0: 33, x1: 172, z1: 39, lv: 1 }, {
    objective: "Go round through Plumley's",
    radio: [
      ['Dot', 'Lights are on! Oh. Sweet peas, the police barricaded the dock. It\'s an evacuation point.'],
      ['Dot', 'Go round: through Plumley\'s, over the car park, in from the truck yard.'],
      ['Mochi', 'The scenic route. Customers love the scenic route.'],
      ['Pip', 'Perfume counters. Every sleeper in here smells AMAZING.'],
    ],
  });
  b.reach({ x0: 186, z0: 33, x1: 219, z1: 48, lv: 2 }, {
    objective: 'Head up to the Cineplex',
    radio: [
      ['Pip', 'A whole floor of beds. Nobody touch the beds. This is SO a trap.'],
      ['Nori', '\'Sweet Dreams Night Sale.\' Free Hush with every pillow. They planned this.'],
      ['Dot', 'The cinema\'s up top. Its fire exit crosses to the car park roof.'],
    ],
  });
  b.reach({ x0: 200, z0: 55, x1: 223, z1: 68, lv: 2 }, {
    objective: 'Cut through to the car park roof',
    radio: [
      ['Taro', 'A midnight marathon. Three Snoozle films. I\'d have dozed off in the first one.'],
      ['Mochi', 'Looks like everybody did.'],
      ['Nori', 'Fire exit\'s past the screen. Flashlights on, and step quietly.'],
    ],
  });
  b.reach({ x0: 206, z0: 96, x1: 223, z1: 105 }, {
    objective: 'Get down through the car park', opens: [officeEntry],
    radio: [
      ['Pip', 'Is that a FOG MACHINE? On the roof? Who puts a fog machine on a roof?'],
      ['Nori', 'Dreamwell does. \'Sweet Dreams Night, Unit 7.\' Empty now.'],
      ['Dot', 'St. Marigold sent its ambulances up those ramps. The police office is at the bottom.'],
    ],
  });
  b.gather({ x0: 167, z0: 97, x1: 175, z1: 105 }, {
    objective: 'Hole up in the parking office', checkpoint: true, closes: [officeEntry],
    radio: [
      ['Dot', 'Parking office, ground floor, south-west corner. Get in and get that door shut.'],
      ['Taro', 'Ambulances nose to tail, doors open. They got out on foot. I hope.'],
    ],
  });
  b.use(officeLever, {
    objective: 'Open the yard gate', opens: [officeExit, dockDoor],
    radio: [
      ['Nori', 'Police clipboard. Last lift down to the tunnel left at 4:15. They left us something.'],
      ['Pip', 'A ROCKET POD. On the dock. In a sandbag nest. Best. Evacuation. Ever.'],
      ['Dot', 'The freight lift\'s at the bottom of the shaft, sweet peas. It\'s a long way up.'],
      ['Taro', 'Rest a minute first. That dock will be the longest few minutes of the night.'],
    ],
  });
  b.use(liftButton, {
    // The stand is the open tile beside the button (the button itself is solid), at the supply desk,
    // four tiles from the pod's nest. Scavenge finale: the lift needs four power cells, and the timer
    // stops at each quarter until one more has been picked up (the stage script keeps running).
    objective: 'Call the freight lift', horde: true, hold: 150, big: true, opens: [liftGate], at: [153.5, 86.5], group: 'cell',
    lanes: {
      // East yard: bays 3 and 4. Only its far corners, by the police fence and by the yard gate, so lane A
      // starts as far down its path as lane B does (spawns take the nearest hidden cell of the live lanes).
      A: [{ x0: 132, z0: 104, x1: 134, z1: 106 }, { x0: 160, z0: 105, x1: 163, z1: 106 }, { x0: 162, z0: 104, x1: 163, z1: 104 }],
      B: [{ x0: 104, z0: 99, x1: 130, z1: 106 }],                                           // west yard: bays 1 and 2, then the dock
      C: [{ x0: 128, z0: 58, x1: 156, z1: 68 }],                                            // food court: the police corridor
    },
    holdScript: [
      { kind: 'wave', secs: 35, lanes: ['A'], msg: 'Here they come! Bays 3 and 4!' },
      { kind: 'breather', secs: 10, msg: 'Quiet for a sec. Go get a cell!' },
      { kind: 'wave', secs: 35, lanes: ['A', 'B'], specials: 2, msg: 'All four bays! Watch the police corridor!' },
      { kind: 'brute', secs: 25, msg: 'Something big in the police corridor!' },
      { kind: 'breather', secs: 10, msg: 'Breathe. Pick each other up!' },
      { kind: 'final', secs: 35, lanes: ['A', 'B'], specials: 2, msg: 'Every bay at once! Hold on!' },
    ],
    gates: [
      { at: 10, items: 1, msg: 'The lift needs power! Find a cell!', hud: 'LIFT STOPPED! Bring a power cell!' },
      { at: 45, items: 2, msg: 'The lift stalled! Second cell!', hud: 'LIFT STOPPED! Bring a power cell!' },
      { at: 85, items: 3, msg: 'Stalled again! Third cell!', hud: 'LIFT STOPPED! Bring a power cell!' },
      { at: 125, items: 4, msg: 'One last cell and we\'re up!', hud: 'LIFT STOPPED! Bring a power cell!' },
    ],
    radio: [
      ['Dot', 'That lift chimes the whole way up. Every sleeper in the Galleria will come to listen.'],
      ['Dot', 'And the police ran its cells flat, sweet pea. It needs four power cells to climb.'],
      ['Nori', 'Spares: cold storage, the returns nook, the west end of the catwalk, and by the compactor.'],
      ['Pip', 'Dibs on the rocket pod!'],
      ['Mochi', 'The pod covers the bays and the dock. Runners, stay where it can see you!'],
      ['Taro', 'It can\'t swing round to the police corridor. That one\'s ours.'],
    ],
  });
  b.gather({ x0: 156, z0: 84, x1: 163, z1: 92 }, {
    objective: 'Everybody into the freight lift', closes: [liftGate],
    radio: [
      ['Dot', 'Tunnel runs under the river to the rail yard. I\'m right here on the radio.'],
    ],
  });
  return b.done({ id: META.id, title: META.title, subtitle: META.subtitle, intro: INTRO, theme: THEME });
}
