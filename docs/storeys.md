# Storeys, stairs and ladders

Maps can stack up to 4 storeys. The engine lives in `shared/level.ts`. Its file header and doc comments are the reference. This page is the short version for anyone touching maps, the server or the client.

## Model

- `ChapterDef.levels` is the number of storeys (1 = flat map, which behaves exactly as before). Storey `k`'s floor is at `k * STOREY` m (`STOREY` = `CEIL_H` = 4.2 m, in `shared/constants.ts`).
- Every per-cell array (`floor`, `solid`, `opaque`, `propCell`, `wallH`, `wallKind`, `doorCell`, `air`, `ramp`, `ladder`, `rampLo`, `rampHi`) has `levels * W * H` entries. A **node** is `k * W * H + z * W + x`, so storey 0's nodes are the old `z * W + x` cell indices. `Level.N` is the node count, and `L.node(tx, tz, lv)`, `L.lvOf(n)`, `L.nodeX/Z(n)` and `L.centre(n)` convert between them.
- An upper-storey cell is one of three things:
  - **floor**: carved, with a slab under it.
  - **wall**: filled by the author (`wallH` = absolute top), or an **auto wall**. An auto wall continues a taller building below (`wallH` = 0; it is part of the column below, so draw nothing for it).
  - **air**: `def.air` = 1. Air is open, never walkable and see-through. Where it borders floor, render a railing.
- Untouched upper cells become auto walls over buildings taller than the storey, and air everywhere else. A storey-0 wall's `wallH` is clamped to the floor carved on top of it, which is how roofs work.
- **Stairs and ladders are ramps.** Ramp cells sit on storey `k`, and their floor rises along `ramp` dir (`RAMP.PX/NX/PZ/NZ`, see `RAMP_DX/DZ`) from `rampLo` to `rampHi` (relative to `k * STOREY`). Walking off the high end puts you on storey `k+1`. The cells above a ramp are air (the stairwell hole). A ladder is a one-tile ramp with `def.ladder[n]` = 1, climbed at `LADDER_SPEED`. `def.ramps` lists every flight and ladder as a rect plus `lv`, `dir` and `ladder`, for rendering.
- Positions carry **y = the floor height a thing stands on** (absolute metres). A player's network `y` is feet height: floor plus any jump. Pickups, notes, labels, arrows, lamps, spawns and step waypoints (`at.y`) carry y. Props and doors carry `lv`, and step areas (`Rect.lv`) carry their storey.

## What gets drawn

`client/src/cull.ts` hides scenery the camera cannot see: rooms behind walls on its own storey, and other storeys except through stairwells, drops and open air. It works from the same facts as above (a wall that fills its storey blocks; a floor, ceiling or slab underside closes its tile of the floor line), so it repeats a few of the drawing rules in `arch.ts`, `storeys.ts` and `ground.ts`. After changing what those draw across a floor line, run `npm run check:cull`: it casts rays at everything hidden and fails if any of it was in sight. `?cull=off` in the URL turns the culling off for comparison.

What is in sight from each 4 m square of each storey is worked out ahead of time and kept in `client/src/pvs/` (one generated file per chapter, fetched with the chapter), so at run time the culling is a table lookup. **After changing a map, or anything the world builders draw, run `npm run bake:cull`** (a minute or two). A table that no longer matches the geometry is never used: the game notices at load, warns in the console and works each tile out as the camera enters it instead (correct, but a few milliseconds per new tile), and `npm run check:cull` fails. `?cull=live` forces that mode.

## Level API (all positions in metres)

| Call | What it does |
| --- | --- |
| `moveSlide(pos{x,y,z}, dx, dz, r, open)` | Slides with collision. `pos.y` is the floor height it stands on and follows stairs and ladders. You can't walk off an edge: air is a wall. |
| `speedAt(x, y, z, LADDER_SPEED)` | Speed multiplier: slow on ladders. |
| `nodeAt(x, y, z)` / `groundY(x, y, z)` / `floorAt(x, y, z)` / `inRect(x, y, z, rect)` | Storey-aware lookups. `y` only has to be roughly the feet height. |
| `ray(ox, oy, oz, dx, dy, dz, max, open)` | 3D ray against walls, tall props, closed doors, floor slabs, indoor ceilings and the ground. |
| `hasLOS(ax, ay, az, bx, by, bz, open)`, `sees(a, b, open, eye = 1.2)` | 3D line of sight. |
| `distanceField(nodes, open, out?)` | BFS over the walk graph. `out` has `N` entries. |
| `adj` (4 per node) / `neighbors8(n, open, out)` | The walk graph. It crosses storeys at stair and ladder ends. |
| `blocked(n, open)` / `walkable(n)` | Node tests. |
| `solidAt(tx, tz, open, lv = 0)` | Tile test. **Defaults to storey 0, so pass `lv` when the thing might be upstairs.** |

## Authoring (LevelBuilder)

```ts
const b = new LevelBuilder(W, H, 3);   // 3 storeys
b.carve(...); b.fill(...);              // storey 0 as before
b.walls(40, 10, 49, 19, WALL.BUILDING, STOREY);  // a one-storey building: its roof can be storey 1
b.stairs(12, 12, 12, 14, '+z');         // a flight on storey 0 rising +z; lands on storey 1 at z = 15
b.ladder(39, 15, '+x');                 // a ladder against the wall at x = 40; step off onto storey 1 at (40,15)
b.level(1);                             // now author storey 1
b.carve(40, 10, 49, 19, F.CONCRETE);    // the roof
b.fill(...);                            // upstairs walls (one storey tall)
b.open(...);                            // force air (gaps, light wells)
b.prop(...); b.pick(...); b.lamp(...); b.label(...); b.door(...); // all land on storey 1
b.level(0);
b.gather({ x0, z0, x1, z1, lv: 1 }, {...});   // a step area upstairs
b.holdout(60, { at: [x, z, 1], ... });         // a waypoint upstairs
```

Rules the validator (`npm run check:maps`) enforces or warns about:

- The tile past a ramp's high end must be walkable on the storey above.
- Areas must exist on their storey.
- Safe rooms must be sealed on every storey: no stairs or ladders out of them except through doors.

Practical rules:

- Stairs: 3 tiles of run reads well (each tile rises 1.4 m). Give flights 2-tile-wide runs on the critical path, because the Brute has a 0.8 m radius.
- Put a wall or air on both sides of a flight. You can only step onto a flight from its low end, its high end, or the side of its bottom tile.
- You can't step off a flight's side partway up; the bottom tile's side and a flush top corner are fine. `npm run check:maps` walks a Brute-sized body and a survivor up every lane of every flight (centres and seams) and errors if one gets stuck.
- Zombies climb ladders at `LADDER_SPEED * ZOMBIE_LADDER`, slower than survivors. The difficulty caps how many zombies can be on one ladder at once (`DIFFICULTY.ladder` in `server/tuning.ts`: Easy 1, Normal and Hard 5, Nightmare unlimited). During a holdout on a small perch (under `perchMax` nodes), the director spawns the horde on the storey below.
- The server clamps a survivor's claimed height to between the floor under them and 1.3 m above it (`MAX_LIFT`). After a server teleport it ignores stale position messages for `TP_GRACE`.
- Ladders go against the wall of the thing they climb. Zombies climb them too, slowly, which makes rooftops good holdouts but never perfectly safe.
