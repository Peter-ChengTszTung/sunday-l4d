# Chibi Outbreak: The Long Lullaby

Campaign brief for level design. Four chapters, each 30–60 minutes for a 4-player team. Chapter 1 replaces "Last Stop Lane" and reuses its spirit: safe room, main street, back alley, plaza, crescendo, gate, end safe room.

## How to read this brief

- **Step kinds** match the engine exactly: `reach`, `gather`, `use`, `collect`, `holdout`.
- **Where** says which storey a step is on when it isn't street level. Every chapter has real stacked storeys (storey 0 is the ground, storey 1 the first floor up, and so on; see `docs/storeys.md`), joined by stairs, ramps, escalators and ladders. Areas, objectives and perches can sit on upper storeys, and the horde climbs the same stairs and ladders you do.
- **HUD** is the objective line (max 40 chars). For `collect`, the engine appends the count, so it isn't in the text.
- **Radio** lines play when the step begins (max 90 chars each). Speaker names are what the subtitle shows. Until chapter 4 step 8, Wren's subtitle is **Voice**.
- **Flags** say what happens with the step: `horde` / `brute` when it begins, `holdout N s`, `big` (a Big Hold On, see below), `checkpoint` (the team respawns here after a wipe), `opens: X` (a door or barrier that opens when the step completes), `closes: X` (a door that shuts behind the team when the step completes, sealing a safe room), `chapter end` (the last step). The start safe room needs no `checkpoint` flag: the team respawns there until it reaches the first checkpoint.
- **Safe-room exits** are their own short `use` step after each checkpoint (a switch or lever by the back door), numbered with a "b" (for example 1.6b), so the main step numbers stay put.
- **Pacing target:** about 3 minutes per main step including fighting, which puts 13–14 steps at roughly 40–50 minutes. The "b" exit steps take seconds and don't count. Reach legs should be long, winding street or interior runs, not short hops.
- **Brute:** one per chapter, each with a nickname the radio uses. The finale's script adds its own (two in chapter 4), and they have no nickname.

### Big Hold On: the finale rules

Each chapter ends with a Big Hold On: a `use` step with `big`, a 150 s hold, and a `gather` step after it that is the escape. The approved design is `docs/big-hold-on-v2.html`; the numbers below are the code (`server/tuning.ts` `BIG_HOLD`, `ZONE_MIN`, `ZONE_GUN_GAP`).

- **Prepare.** Nothing spawns until someone uses the objective. Every finale has a supply stand within a few tiles of it: a medkit for each of four survivors, ammo and throwables. Use the time.
- **Lanes.** The step names its lanes and gives each its own spawn zone behind its entrance. **A** and **B** are the front lanes, inside the mounted gun's arc (±80° of its facing), and carry the commons. **C** is the flank, outside every arc: the Brute and the special pushes come down it, and it is the rest of the team's job. Each stage lists its live lanes; wave 1 is lane A only.
- **Spawns** land only in live lanes' zones, at least 24 path tiles from the team and at least 30 m in a straight line from every mounted gun, so the flood walks in down the lanes instead of appearing at the sandbags.
- **Stage script.** Wave 35 s (A), breather 10 s, wave 35 s (A + B, a special push of 2), Brute 25 s (the Brute from C, a light trickle down A and B), breather 10 s, final 35 s (A + B, specials kept topped up to 2–3 from C). The final is no heavier than wave 2. Chapter 4 runs a shorter version with two Brute stages. A Brute stage while a Brute is still up becomes a specials push instead (one Brute at a time).
- **Budgets per player count (Normal).** Commons are fixed budgets, not multipliers. Wave 1 is the base, wave 2 and the final are 1.5 × base, a Brute stage trickles 0.4 × base, a breather nothing. 60% of a wave arrives at once, the rest trickles evenly over the stage. Easy, Hard and Nightmare scale the base by their horde multiplier.

  | Survivors | 1 | 2 | 3 | 4 |
  | --- | --- | --- | --- | --- |
  | Base (wave 1) | 44 | 60 | 80 | 100 |
  | Wave 2 / final | 66 | 90 | 120 | 150 |
  | Commons alive at once | 60 | 80 | 110 | 140 |

- **Breathers bring the dead back.** A survivor who died comes back when a breather starts, so one early death doesn't end the hold.
- **The gunner is a target.** In each special push, one grabber (Snatcher or Piggyback) goes for whoever is on a mounted gun.
- **Timer stops** (`gates`). Chapters 2 and 3 stop the timer at set points until the team does a job (pick up a power cell, hold a crank). While it is stopped the stage doesn't advance, but the horde already queued keeps coming.
- **Escape.** When the timer runs out the vehicle opens. Until everyone is aboard, one walker spawns every 0.55 s from the lane zones (all lanes, flank included), up to the cap. The run is short in chapters 1 to 3 and a real run in chapter 4.
- **Map rules.** Each gun sits in a sandbag nest with a wall or vehicle at its back and both front lanes in its arc, with 25 m or more of open lane in front of it. Guns have 8 facings (diagonals included). Cover in the arena is low and imperfect. The arena itself has no sleepers waiting (density 0).

---

## 1. Premise, cast, mystery

### Premise

At 3:00 a.m. a sweet lavender fog rolled through the little city of Mallow Bay, and everyone who was asleep got out of bed and kept walking. Four night owls who happened to be awake woke up to a city that won't wake up. Dot, a night-shift bus dispatcher who is still on the radio, guides them across town toward the last evacuation convoy out of the valley. Somewhere in the static, somebody keeps humming a lullaby.

### Survivors

Why each one was awake at 3 a.m. is part of the mystery: only people who were asleep turned.

| Survivor | Look (from `SURVIVORS`) | Personality (for barks) |
| --- | --- | --- |
| **Mochi** | pink shirt, cap | Pizza courier on a late delivery. Relentlessly upbeat, keeps the team moving, talks in delivery jargon ("ten-minute delivery", "last drop of the night"). |
| **Pip** | teal shirt, spiky blond | 17-year-old gamer who was up past bedtime. Loud, treats everything like a game ("side quest", "fetch quest"), nicknames every monster. Secretly the bravest. |
| **Nori** | lavender shirt, buns | Night-shift pharmacy tech at St. Marigold Hospital and a chronic insomniac. Deadpan, practical, reads every label. She's the one who puts the clues together. |
| **Taro** | orange shirt, silver bob | Retired night watchman and amateur stargazer, oldest of the group. Unhurried and gentle, with soft proverbs and a widower's quiet sadness. Knows half the town by name. |

### Radio voices

- **Dot (Dorothy Lowell)**: night dispatcher for Mallow Bay Transit, broadcasting from the Dispatch Tower across the river. Warm, bossy grandma energy, calls everyone "sweet pea", makes terrible jokes under pressure. She keeps trying to reach her daughter.
- **Voice / Wren (Dr. Wren Lowell)**: lead chemist at Dreamwell Sleep Co. and Dot's daughter. She first breaks into the frequency in chapter 3 as a humming, apologetic stranger. Clever, guilty, kind. She made the fog.

### Recurring motifs (for art and map design)

- **Snoozle**, Dreamwell's sheep mascot, always shown with its eyes closed and the slogan "Sleep tight, Mallow Bay!" Snoozle billboards, nightlights and plushies appear in every chapter. By chapter 4 they're graffitied with "WAKE UP".
- Clocks stopped at **3:00**.
- **Trails of slippers, dressing gowns and dropped pillows** run in the direction the sleepers walked. Use them as wordless arrows along the critical path.
- **Time of day moves forward across the campaign:** 3 a.m. (ch1), then 4:40, 5:20, and sunrise at the end of ch4. The palette goes from indigo to mint, orange, and finally gold.

### The mystery thread

**What happened.** Dreamwell Sleep Co. sold Mallow Bay's council on "Sweet Dreams Night": free sleep-aid mist (*Hush*) pumped through fog machines at 3 a.m. to cure a tired city. Dreamwell's CEO, **Gideon Pell**, shipped the experimental concentrate **HX-9** even though Wren had written "NOT SAFE. DO NOT SHIP." on the order. HX-9 puts sleepers into a dream they can't wake from, and they sleepwalk.

**Why they attack.** The dream wants quiet. Sleepers drift toward lullaby-like sounds (chimes, bells, elevator music) and swarm anything awake and noisy. They aren't cruel. They're trying to *hush* you. That's why noisy objectives call hordes.

**The zombie types in-world:**
- *Walker*: an ordinary sleepwalker in pyjamas.
- *Leaper*: a restless sleeper, the "kicker" who thrashes and pounces.
- *Puffer*: a sleeper swollen with mist. Its goo smells of lavender and carries the lullaby scent, which is why it calls the horde.
- *Brute*: someone who got a heavy dose of concentrate (the tank crew at the plant, or anyone who napped right next to a fog unit).
- *Sleep-Charger*: a sleeper stuck in the "running late" dream, sprinting for a bus that left hours ago. Sleep mask shoved up, dressing gown flapping, one arm swollen from clutching a pillow. It lowers its head and scrapes its slippers before it runs, and it runs in a straight line until something stops it, usually a wall, sometimes you.
- *Drooler*: a mouth-breather who slept face-down on a pillow soaked in Hush. Its cheeks fill with lavender goo and it gargles before it spits. The goo pools and stings anything awake, so sleepers walk through it and survivors don't.
- *Alarm Clock*: a light sleeper who never let go of the bedside clock. It shies away from people, but the moment it sees someone awake its dream says "time to get up" and it rings. The dream hates that sound, so every sleeper nearby shuffles over to hush it. Shoot it before it rings out.
- *Snatcher*: a sleeper tangled in the "falling" dream, forever grabbing for something to hold. Tall, thin, wrapped in a long striped scarf it never took off. It whirls the scarf, lassoes whoever is awake and hauls them close, the way you would pull a blanket back over yourself.
- *Piggyback*: a small one in an animal onesie, dreaming of being carried up to bed. It jumps on a survivor's shoulders and steers them off into the dark, giggling.
- *Weeper*: a sleeper having the saddest dream in Mallow Bay. She sits and sobs and wants only to be left alone. Light, noise or company wakes her, and what wakes up is furious. She goes for whoever did it, and once they are down she runs off crying.
- *Tinpot*: a sleepwalking cook who wandered through the kitchen first: saucepan on the head, baking tray on the chest. Bullets mostly ring off the front.
- *Raincoat*: fell asleep waiting for the bus in a storm slicker. Fire does nothing through the oilskin.

**How the infected arrive.** The campaign brings them in one at a time (shared/constants.ts `INTRO`): chapter 1 opens with walkers only, then the Leaper, Puffer, Drooler and finally the Charger; chapter 2 adds the Alarm Clock, Tinpot, Weeper and Snatcher, then the Raincoat; the Piggyback from chapter 3. A room started on a later chapter has everything before it.

**What the survivors learn, chapter by chapter:**
1. The fog came from City Hall's "Sweet Dreams Night" machines, which Dreamwell sponsored. Only people who were asleep turned. A Dr. W. Lowell asked for a delay and was refused. Dot has a daughter called Wren.
2. Dreamwell ran HX-9 sleep trials at St. Marigold. Sleepers walk toward chime tones. An ID badge confirms Dr. Wren Lowell is Dot's daughter, which players learn before Dot does.
3. At the Hush Works the survivors learn that Pell shipped HX-9 over Wren's objection. Wren is the Voice. She built the **Morning Bell**, a counter-tone that won't wake anyone but lets sleepers lie down and rest. It needs the big transmitter on Pinecone Hill.
4. **Payoff.** Wren is locked in the hilltop transmitter shed. Mother and daughter reunite over the radio. The team rings the Morning Bell and the valley's sleepers curl up and sleep peacefully: not cured, but asleep and not gone. The Bell has to keep ringing, so Wren stays behind to keep it going and to work on a real way to wake them. Dot promises to keep the radio on every night. Pell's empty limo sits by the bridge with an open "Executive Rest Kit" on the seat.

---

## 2. Chapters

### Chapter 1: Last Stop

**Subtitle:** Downtown Mallow Bay
**Setting:** Downtown street grid on the west bank of the river. 24-hour laundromat, Marshmallow Avenue (four lanes), Tony's Pizza, Pell Plaza Parking, City Hall Square, public library, the Library Row back alleys, Cherry Street heritage tram stop, rail underpass, Clocktower Corner, Kettle Corner Diner, then the long way round to the depot: Kettle Lane and the Butterwick Night Market, Lantern Canal and its towpath arch under the railway, Gumdrop Street and the Snoozle Sleep Shop, the Bayfront Promenade on the river (Dot's Dispatch Tower blinks on the far bank), the Night Ferry Terminal, Wharf Halt and the freight bridge, Mallow Junction freight yard and its signal box, and finally the Transit Depot, where the Mallow Bay Guard set up an evacuation post and fell asleep at it. Three storeys: the street (storey 0); the garage's level 2, the Lather Laundry storeroom, a fire-escape landing, the Library Row rooftops, the tram footbridge, Wharf Halt and the freight bridge over the alleys (storey 1); the garage roof deck (storey 2). The garage is the big climb: ground deck, a ramp to level 2, a ramp to the roof deck and its viewpoint pier, then a stair tower back down to the square.
**Mood:** 3:20 a.m. in rain. Wet indigo asphalt, pink and teal neon, ankle-deep lavender fog pooling in gutters. Strings of festival lanterns along the canal.

**Intro card:**
> 3:00 a.m. A sweet lavender fog rolled through Mallow Bay, and everyone asleep got out of bed and kept walking. You four were awake. Lucky you. Now the radio is crackling: a night dispatcher called Dot says there's a way out of town, and she'll talk you there. First, you have to get out of the laundromat.

**Requirements check:** start safe room 1.1 · checkpoints 1.6, 1.10, 1.16 · crescendos 1.4, 1.8, 1.15 · collect 1.7 · Brute 1.17 · Big Hold On (finale, teaching: Popcorn Gatling, Brute from the flank) 1.19 · escape 1.20

**1.1 · `use` · Start safe room**
- **Where:** Suds & Bubbles 24h Laundromat. A row of dryers, a folding table with a CB radio, and a front roller shutter onto Marshmallow Avenue.
- **HUD:** `Answer the radio`
- **Radio:**
  - Dot: "Hello? Anybody awake out there? Dot at Transit Dispatch. Pick up, sweet pea."
  - Mochi: "Mochi here! Four of us. All awake. Mostly caffeinated."
  - Dot: "Good. Get to the Transit Depot. There's a shuttle there with your name on it."
- **Flags:** opens: laundromat shutter

**1.2 · `reach` · Main street**
- **Where:** Down Marshmallow Avenue to the crosswalk under the giant Snoozle billboard. Abandoned cars sit with their doors open, all facing north.
- **HUD:** `Head down Marshmallow Avenue`
- **Radio:**
  - Dot: "South down Marshmallow Avenue. Mind the sleepwalkers. They get cranky."
  - Pip: "Cranky? Dot, they're ZOMBIES."
  - Taro: "Sleepwalkers. Hm. They do look terribly tired."
- **Flags:** none

**1.3 · `reach` · Weapon stop**
- **Where:** Tony's Pizza on the corner: counter, oven kitchen, back door to the alley. Boomstick and tier-2 weapon spawns behind the counter.
- **HUD:** `Gear up at Tony's Pizza`
- **Radio:**
  - Mochi: "My work! Tony keeps a Boomstick under the till. For rude customers."
  - Nori: "Is that legal?"
  - Mochi: "It's pizza, Nori."
- **Flags:** none

**1.4 · `use` · Crescendo 1**
- **Where:** Pell Plaza Parking forecourt. A pile-up blocks the avenue, so the alarmed garage barrier is the only way through. The lever is in the attendant booth.
- **HUD:** `Open the parking garage gate`
- **Radio:**
  - Dot: "Avenue's jammed with cars. Cut through the garage. The gate's loud, so get ready."
  - Pip: "Loud is my middle name."
  - Nori: "Your middle name is Bartholomew."
- **Flags:** horde · holdout 60 s · opens: garage shutter

**1.5 · `reach` · Overlook**
- **Where:** Up through the garage. In through the gate onto the dark ground deck, east along the north lane to ramp 1, which rises south to level 2 (storey 1). The level-2 slab has caved in mid-deck, so the way round is back west past the pay station to ramp 2, which rises north onto the open roof deck (storey 2). East across the roof to the viewpoint pier, which looks down on City Hall Square. Twelve fog machines on the City Hall steps are still puffing lavender under a "SWEET DREAMS NIGHT" banner. The pier has a weapon cache.
- **HUD:** `Climb to the garage roof`
- **Radio:**
  - Taro: "Look there. The fog's pouring out of City Hall."
  - Nori: "'Sweet Dreams Night.' The city's free sleep thing. Sponsored by Dreamwell."
  - Pip: "Free sleep. What could possibly go wrong."
- **Flags:** opens: library safe-room door

**1.6 · `gather` · Checkpoint safe room**
- **Where:** Down the stair tower at the end of the pier (one flight to a landing on storey 1, a second flight to the street), across the square, through the library stacks to the Mallow Bay Public Library reading room (red safe-room door).
- **HUD:** `Get everyone into the library`
- **Radio:**
  - Dot: "Stair tower at the end of that pier goes down to the square. Library's across it."
  - Dot: "Library's got a safe room. Shush in there, it's a library."
  - Mochi: "Ten-minute delivery. Go go go!"
- **Flags:** checkpoint · closes: library safe-room door

**1.6b · `use` · Safe-room exit**
- **Where:** The back-door switch by the reading-room shelves.
- **HUD:** `Open the safe room door`
- **Radio:**
  - Nori: "Back door switch is by the shelves. Whenever we're ready."
  - Pip: "Game saved. Okay. Back out into the alleys."
- **Flags:** opens: library back door

**1.7 · `collect` (4 fuses) · Sweep**
- **Where:** The back alleys of Library Row: Library Row, Wash Alley, the middle cut-through and the south cross alley. One fuse is up the back stairs of Lather Laundry in the dark storeroom (storey 1), one on a dumpster lid in the south cross alley, one at the junction box on Wash Alley, and one on the fire-escape landing over Wash Alley (storey 1), reached by two drop ladders. Optional: a ladder up from Library Row and another from Wash Alley lead onto the Library Row rooftops (storey 1), a perch over all three alleys with a rifle and the pigeon keeper's log.
- **HUD:** `Find fuses for the old tram`
- **Radio:**
  - Dot: "The heritage tram on Cherry Street runs on fuses. Check the alley junction boxes."
  - Dot: "Lather Laundry keeps spares up in the storeroom. And there's one on a fire escape."
  - Pip: "A fetch quest. In the apocalypse. Classic."
  - Taro: "Ladders, at my age. Well. Slowly does it."
- **Flags:** none

**1.8 · `use` · Crescendo 2**
- **Where:** Cherry Street tram stop. A cream-and-cherry heritage tram sits across the junction, blocking the underpass. The control box is on the platform. Powering it up rings the tram's bell non-stop while it creeps clear. A footbridge over Cherry Street (storey 1) is the perch for the fight, with stairs up from the platform and a ladder from the north kerb, so the horde climbs at both ends.
- **HUD:** `Power up the heritage tram`
- **Radio:**
  - Dot: "Fuses in, pull the lever. The line powers the underpass gate too."
  - Dot: "Tram bell rings till she's warmed up. Get up on that footbridge."
  - Taro: "Ah. A dinner bell."
  - Mochi: "We ARE dinner. Everybody face out!"
- **Flags:** horde · holdout 90 s · opens: underpass (tram rolls clear)

**1.9 · `reach` · Transition**
- **Where:** Through the rail underpass to Clocktower Corner, a small square whose clock is stopped at 3:00.
- **HUD:** `Go under the rail bridge`
- **Radio:**
  - Nori: "They're all shuffling the same way. North, toward the hills."
  - Taro: "Like geese heading home."
  - Pip: "Clock stopped at three. That's not creepy at all."
- **Flags:** opens: diner safe-room door

**1.10 · `gather` · Checkpoint safe room**
- **Where:** Kettle Corner Diner, in the walk-in pantry behind the kitchen.
- **HUD:** `Regroup in the Kettle Corner Diner`
- **Radio:**
  - Dot: "Diner's safe room is behind the kitchen. Take a pie. I won't tell."
  - Pip: "Is the pie also a zombie?"
  - Nori: "Everything's a zombie until proven otherwise."
- **Flags:** checkpoint · closes: diner safe-room door

**1.10b · `use` · Safe-room exit**
- **Where:** The back-door lever by the pantry shelves.
- **HUD:** `Open the safe room door`
- **Radio:**
  - Taro: "Pie's finished. The back door lever is by the shelves."
  - Mochi: "The depot's right behind this place. Easy delivery!"
- **Flags:** opens: diner back door

**1.11 · `reach` · The long way round**
- **Where:** The diner's back lot ends at a Mallow Bay Guard roadblock: a chain-link fence, jersey barriers and two olive trucks, with Depot Square right there on the other side. The only way out is a gap west into Kettle Lane, then the Butterwick Night Market: three solid rows of shuttered stalls make a serpentine of four lanes (tight, shotgun range) under paper lanterns. Optional: the market office in the north-east corner has a Desert Eagle, a firebomb and the manager's chalkboard. Out through Lantern Alley at the market's north-west corner.
- **HUD:** `Cut through the night market`
- **Radio:**
  - Dot: "Hold up, sweet pea. The Guard fenced Depot Square off at ten past three."
  - Dot: "You'll have to go round. Through the night market, then along the canal."
  - Pip: "The scenic route. Love a scenic route."
  - Mochi: "Long delivery. Still a delivery!"
- **Flags:** none

**1.12 · `reach` · Canal**
- **Where:** Lantern Canal: a long, straight canal street east under strings of festival lanterns, barges moored along the water (rifle range). Optional: two footbridges cross to the north towpath, which has a rifle, ammo and a medkit. At the railway embankment the street ends and the towpath ducks through a dark, three-wide arch under the tracks (no lamps, the chokepoint), coming out on Gumdrop Street.
- **HUD:** `Follow the canal under the railway`
- **Radio:**
  - Nori: "The lanterns are still lit. Someone strung these up for Sweet Dreams Night."
  - Taro: "My Hana loved this canal. We fed the ducks here at midnight, once upon a time."
  - Pip: "Ducks are fine. Ducks are always fine."
  - Dot: "Towpath goes under the railway. It's dark in that arch. Torches on."
- **Flags:** none

**1.13 · `reach` · River**
- **Where:** East along Gumdrop Street. A Dreamwell delivery truck has jack-knifed across it, so the way on is in one door of the Snoozle Sleep Shop and out of the other (pink shelves of Snoozle plushies, a staff memo about HX-9 testers). Then south onto the Bayfront Promenade along the river. Across the water Dot's Dispatch Tower blinks red. Optional: a pier out over the river (the best view of the tower) and a saltwater taffy shop.
- **HUD:** `Head down to the river`
- **Radio:**
  - Dot: "Down to the river. Look across. See a red light blinking? That's my tower."
  - Mochi: "Hi, Dot! We're waving!"
  - Dot: "I'm waving back. You can't see it, but I am."
- **Flags:** none

**1.14 · `use` · Freight stairs**
- **Where:** The Night Ferry Terminal at the south end of the promenade: benches, a moored ferry, "NO SAILINGS". The switch for the freight stairs shutter is behind the ticket windows. It's alarmed. Medkits, ammo and a firebomb by the shutter.
- **HUD:** `Open the freight stairs`
- **Radio:**
  - Dot: "The freight line runs right over Library Row to the junction behind the depot."
  - Dot: "Stairs up are behind the ferry terminal. Hal keeps the switch in the ticket office."
  - Nori: "The sign says "ALARMED. STAFF ONLY.""
  - Pip: "We're staff now. Night shift."
- **Flags:** opens: freight stairs shutter

**1.15 · `reach` · Crescendo 3 (running fight)**
- **Where:** The alarm brings a horde. Through the siding yard behind the terminal, up the stairs to Wharf Halt (storey 1) with a stalled wagon on the platform, then west along the freight bridge, a three-wide deck high over Wash Alley and Library Row (one long elevated sightline back over the chapter's own alleys). Stairs at its west end drop into Mallow Junction freight yard.
- **HUD:** `Cross the freight bridge`
- **Radio:**
  - Taro: "There's the alarm. Up the stairs, everyone, and don't stop on the bridge."
  - Pip: "Bridge fight! Best kind of fight!"
  - Dot: "West over the alleys, then down into Mallow Junction. Go, go!"
- **Flags:** horde · opens: signal-box safe-room door

**1.16 · `gather` · Checkpoint safe room**
- **Where:** Mallow Junction is dark. A stalled freight train splits the yard: south down its east side, round its tail, north up the west side between tank cars. Optional: the yard office corner north of the stairs. The signal box is built into the railway embankment, red door on the yard side; the old lever frame is still inside.
- **HUD:** `Get to the signal box`
- **Radio:**
  - Dot: "There's a signal box built into the embankment. Thick walls, red door."
  - Nori: "Red door. Safe room. I love a red door."
  - Taro: "Round the tail of the train, then up the far side. Mind your feet."
- **Flags:** checkpoint · closes: signal-box safe-room door

**1.16b · `use` · Safe-room exit**
- **Where:** The lever by the signal box's depot-side door, which opens on a short passage through the embankment to Depot Square.
- **HUD:** `Open the safe room door`
- **Radio:**
  - Dot: "That door comes out on Depot Square. On the right side of the Guard's fence."
  - Taro: "Last leg, then. For real this time."
  - Mochi: "Last drop of the night!"
- **Flags:** opens: signal box door

**1.17 · `reach` · Brute**
- **Where:** Depot Square, an open lot in front of the Transit Depot fence with a guard booth by the gate, the Guard's trucks and "EVAC STAGING" painted on the asphalt. The Brute is **Gerald**, the depot's night gatekeeper, in a huge hi-vis vest.
- **HUD:** `Reach the Transit Depot`
- **Radio:**
  - Dot: "Oh no. That's Gerald from the night gate. Gerald, honey, you've let yourself go."
  - Mochi: "BIG one! Spread out and keep shooting!"
- **Flags:** brute

**1.18 · `use` · Gate**
- **Where:** The gate switch inside Gerald's guard booth. It runs the whole yard: the depot gate, the freight spur gate and the bay roller door all roll up, so the finale's three lanes are open before anyone touches the ignition.
- **HUD:** `Open the depot gate`
- **Radio:**
  - Dot: "Gate switch is in Gerald's booth. Sorry, Gerald."
  - Taro: "Gerald and I shared a thermos most nights. Sleep well, big fella."
  - Dot: "That switch runs the whole yard, sweet pea. The gate, the freight tunnel and the bay roller door. Three ways in."
- **Flags:** opens: depot gate, freight spur gate, bay roller door

**1.19 · `use` · Big Hold On (finale)**
- **Where:** The depot maintenance bay, one open yard from the fence to the back wall. Hospital Shuttle No. 4 is a walk-in body along the south half of the bay, ignition at its driver's (east) end, door just behind it. The Guard wired their evacuation siren to the bay, so cranking the shuttle sets it off and every sleeper downtown comes to hush it. This is the teaching finale: no side task, just the lanes, the gun and the run.
  - **Lane A:** out of Depot Square through the depot gate in the bay's north-west corner (spawn zone: Depot Square and the passage from the signal box). Live in every wave.
  - **Lane B:** from Mallow Junction down the freight spur tunnel to the spur gate in the north-east. Just inside the gate the spur widens into a loading cutting with a wagon parked in it, where lane B's crowd gathers out of sight (spawn zones: the cutting and the junction end of the spur). Opens with wave 2.
  - **Lane C (flank):** the east lane outside the bay's west wall, through the bay roller door. The shuttle body hides it from the gun, and the crowd comes round either end of the shuttle. Brute and special pushes only.
  - **Gun:** the Guard's **Popcorn Gatling** (minigun) in a sandbag nest at the shuttle's east end, beside the ignition, facing north, with a second dead shuttle parked behind it. The depot gate is about 55° west of its facing and 38 m away, the spur gate about 50° east and 28 m away, both inside its ±80° arc. The roller door is behind it.
  - **Map:** two low sandbag lines split the north half. One runs from the Guard truck to the middle of the bay, so the gate crowd has to come round its east end into the gun's face (and lane C's way round the shuttle runs under it on the other side); the other parts the gate funnel from the tunnel funnel. The gun fires over both. The bus wash off the south-west corner is bricked up for good. Other cover: the Guard truck, crates, barrels, workbenches.
  - **Supply stand:** between the nest and the ignition: four medkits, two ammo piles, a launcher, a firebomb, a rattle and armour. A spare ammo pile by the whiteboard is for whoever covers the roller door.
  - **Escape:** the shuttle door opens about 4 tiles from the ignition, with the trickle coming from all three lanes.
- **HUD:** `Start the hospital shuttle`
- **Radio:**
  - Dot: "Shuttle No. 4's battery is moody. Crank her and keep her company. Two and a half minutes."
  - Dot: "And the Guard wired their evac siren to that bay. Every sleeper in town will come."
  - Pip: "There's a Guard gun on the sandbags by the ignition. Popcorn Gatling. I named it. It's named."
  - Mochi: "Somebody on the popcorn! It sees the gate and the tunnel. Everybody else, watch the roller door!"
  - Dot: "The Guard left supplies by the nest. Stock up before you crank her, sweet pea."
  - Pip: "Why do all the vehicles have moods?"
  - Dot: "Because they're old, sweet pea. Like me."
- **Holdout script (feed lines):** wave 35 s, lane A ("Here they come! Watch the gate!") · breather 10 s ("Breather! Reload and patch up!") · wave 35 s, A + B, 2 specials ("The tunnel too! Gate and tunnel!") · Brute 25 s, lane C ("A Brute at the roller door!") · breather 10 s ("Breather! One more push!") · final 35 s, A + B ("Last push! Gate and tunnel!")
- **Flags:** horde · holdout 150 s · big (Big Hold On, teaching; lanes A gate, B tunnel, C roller door; mount: minigun) · opens: shuttle door

**1.20 · `gather` · Chapter end (vehicle)**
- **Where:** Aboard Shuttle No. 4. The bus interior is the end zone. The escape trickle runs from all three lanes until everyone is inside.
- **HUD:** `Everybody on the shuttle!`
- **Radio:**
  - Dot: "She's purring! Door's open. Everybody aboard, and don't stop for anything!"
  - Dot: "St. Marigold Hospital. There's a helicopter on the roof. Drive safe!"
  - Mochi: "I've never driven a bus."
  - Taro: "Then I'll drive. I've never driven one either, but I'm older."
- **Flags:** chapter end

**Lore notes**

| # | Placement | Text |
| --- | --- | --- |
| 1 | Laundromat corkboard (start room) | SWEET DREAMS NIGHT! At 3 a.m. Dreamwell's gentle Hush mist drifts through downtown. Close your eyes, Mallow Bay. A rested city is a happy city! |
| 2 | Order spike on Tony's Pizza counter | Order 3:02 a.m. 2x large pineapple. Note: "pls hurry, my whole street is sleepwalking and they're all humming the same song??" |
| 3 | Library returns desk, sticky note | Anyone who dozed off in the reading room got up at 3 and walked out. The ones still reading are fine. Note to self: overdue fines are not tonight's problem. |
| 4 | Clipboard by fog machine #12, City Hall steps | Fog units calibrated to Dreamwell spec. Dr. W. Lowell requested postponement: "HX-9 not ready." Request denied. G. Pell. Proceed 3:00 a.m. |
| 5 | Pigeon loft logbook, Library Row rooftops (optional) | 3:04 a.m. The whole block came out in pyjamas, eyes shut, slippers on. Walked right under the loft. Not one of them looked up. Birds are fine. |
| 6 | Market office chalkboard, Butterwick Night Market (optional) | SWEET DREAMS NIGHT! Stalls shut at 2:45 so everyone is tucked up by 3. Free Snoozle sleep mask with every jar of honey. Lights OFF, Bert. |
| 7 | Staff memo, Snoozle Sleep Shop | SWEET DREAMS NIGHT PROMO: every customer gets a free spritz from the Hush tester! New tester stock came in a crate marked HX-9. Same thing, only stronger. Mgmt. |
| 8 | Ferry master's note, Night Ferry Terminal ticket office | Last sailing 11:40. Moored her and turned in early for Sweet Dreams Night. The freight stairs switch is in the ticket office. It's alarmed, so DON'T. Hal |
| 9 | Guard duty log by the Gatling nest, depot yard | MALLOW BAY GUARD, POST 3, TRANSIT DEPOT. 3:10 Evac staging up. Siren wired to the shuttle bay. Gatling on the sandbags. 3:20 Sarge says rest your eyes, long night. 3:22 Everybody is resting their eyes. 3:2 |
| 10 | Whiteboard in the depot maintenance bay | NIGHT ROTA: Dispatch, Dot. Gate, Gerald. Shuttle 4 battery is moody, warm her up! Birthday card for Dot's girl Wren by the kettle. SIGN IT. |
| 11 | Birthday card on the depot table | Happy birthday, Wren! Love from your mum and the whole night shift. (Signed: Dot, Gerald, and a very smudged thermos ring.) |

**Map designer notes:** Snoozle billboard at the 1.2 crosswalk as the first landmark. A slipper-and-pillow trail runs from the laundromat toward Tony's, and again along Lantern Canal. Lit windows appear only where someone was awake (a gamer bedroom, the diner). The garage is dark: lamps only mark the ramps. City Hall's fog machines should be visible from the viewpoint pier and keep emitting particles. Put a stopped 3:00 clock in Clocktower Corner. The towpath arch and Mallow Junction are dark stretches for the flashlight. Dot's Dispatch Tower is a pale column with a red beacon on the far bank of the river, seen from the promenade and the pier. The Guard's roadblock should be readable from the diner lot (fence, olive trucks, "ROAD CLOSED"), so the detour makes sense before Dot explains it. Leave a signed birthday card on the depot table next to the whiteboard. In the maintenance bay, each lane mouth is signed and lit (DEPOT GATE, FREIGHT SPUR, ROLLER DOOR), so the stage banners ("Gate and tunnel!") match what players see. Keep the gun's view north clear: nothing taller than the sandbags between the nest and the two gates. The roller door's lamp and red sign should be the one thing the gunner can't see, which is why somebody else watches it.

---

### Chapter 2: Visiting Hours

**Subtitle:** St. Marigold Hospital & Bayside Galleria
**Setting:** An interior complex on four real storeys. Ground (storey 0): triage and the ambulance bay, ER, waiting room, main lobby, gift shop, pharmacy, the staff corridor and staff rooms, the staff elevator lobby and fire stairs; across the bay inlet, the Galleria's arcade, security office, food court atrium, the loading dock (the police evacuation point) and truck yard, Plumley's department store ground floor, and the ground deck of Galleria Parking with its parking office. Floor 2 (storey 1): the hospital wards, day room and soup kitchen, the lower roofs over the ER and lobby, Bun Bun Toys and its stockroom, the mezzanine ring over the food court, the dock catwalk, Plumley's Home & Bedding floor, and the car park's level 1. Floor 3 (storey 2): the Dreamwell Sleep Clinic, the skybridge terrace on the east wing's roof, the glass skybridge, the Galleria upper concourse with its old ballroom, the Galleria Cineplex (over Plumley's), and the open car park roof. Roof (storey 3): the helipad, with roof-access huts where the stair cores come up.
**Mood:** 4:40 a.m. Flickering mint-and-white fluorescents and red emergency strips. The mall is dim pastel pink and lemon, with dark shopfronts.

**Intro card:**
> 4:40 a.m. The shuttle got you to St. Marigold Hospital, mostly in one piece. Dot says a helicopter is waiting on the roof. Nori used to work nights here and swears the second floor always smells like soup. The beds are empty. Every one of them is neatly made.

**Requirements check:** start safe room 2.1 · checkpoints 2.6, 2.10, 2.17 · crescendos 2.4, 2.8 · Big Hold On 2.18 (scavenge, 4 power cells; Fizzbang Pod; Brute from the police corridor) · collect 2.3 · Brute 2.11 · finale 2.19

**2.1 · `use` · Start safe room**
- **Where:** Triage station in the ambulance bay. Shuttle No. 4 is parked nose-first through the bay doors, and the triage radio sits on the nurse's desk. Optional: two fire-escape ladders up the bay's south wall lead onto the ER roof (storey 1), Larry's smoke-break ledge, a rifle perch over the bay with a note.
- **HUD:** `Radio Dot from triage`
- **Radio:**
  - Dot: "You made it! Helicopter's on the roof. Pilot says he'll wait. Ish."
  - Nori: "I work nights here. Pharmacy. The second floor always smells like soup."
  - Taro: "Sorry about the doors, St. Marigold."
- **Flags:** opens: triage doors

**2.2 · `reach` · Lobby run**
- **Where:** ER waiting room into the main lobby. Rows of chairs, a ticket display reading "NOW SERVING 303", and a gift shop full of balloons.
- **HUD:** `Get through the ER waiting room`
- **Radio:**
  - Pip: "Waiting room zombies. They've been waiting a REALLY long time."
  - Taro: "Haven't we all."
- **Flags:** none

**2.3 · `collect` (2 keycards) · Sweep**
- **Where:** The pharmacy counter (Nori's old desk) off the main lobby, and the nurses' station in the staff corridor, by the coffee machine. Radiology, the on-call room and the rest of the staff wing are optional side rooms with loot.
- **HUD:** `Find staff keycards`
- **Radio:**
  - Dot: "Elevators need staff cards. Nurses hide them in the darnedest places."
  - Nori: "Check the coffee machines. Trust me."
- **Flags:** none

**2.4 · `use` · Crescendo 1**
- **Where:** Staff elevator lobby. The car takes forever to come down while soft muzak plays. When it arrives it faults and goes no further, and fault mode unlocks the fire stairs beside it (signed "LOCKED WHILE ELEVATOR IN SERVICE").
- **HUD:** `Call the staff elevator`
- **Radio:**
  - Mochi: "Elevator music. Of course there's elevator music."
  - Pip: "The zombies LIKE it! Why do they like it?!"
  - Nori: "It's a lullaby. Huh."
- **Flags:** horde · holdout 60 s · opens: elevator doors, fire stairs

**2.5 · `reach` · Clue room**
- **Where:** Up the fire stairs to the Floor 2 east hall (storey 1), where the elevator sits stuck. West along corridor A to the day room where the soup is, then up its stairs to Floor 3 (storey 2). They come up among the pods of the Dreamwell Sleep Clinic. The rest of the floor (the west wards, the patient rooms and the west stair hall, which also climbs to the clinic's reception) is an optional loop. The clinic has rows of empty, perfectly made sleep pods (one gap where bed 20 got up and left), sheep murals on the walls, and a wall clock stopped at 3:00.
- **HUD:** `Search the Sleep Clinic`
- **Radio:**
  - Mochi: "It came all the way down just to get stuck. Relatable."
  - Dot: "Fault mode unlocks the fire stairs. Sleep Clinic's on three, sweet peas."
  - Nori: "Dreamwell's sleep trials. I filled their prescriptions. 'Hush,' every night."
- **Flags:** opens: observation room door

**2.6 · `gather` · Checkpoint safe room**
- **Where:** The clinic's observation room on Floor 3: one-way glass onto the pod ward, a monitoring desk, a lanyard on the desk.
- **HUD:** `Lock yourselves in observation`
- **Radio:**
  - Taro: "Every bed empty, and every bed made. That's the part I don't like."
  - Dot: "Find a room with a door that locks. I need you all in one piece."
  - Pip: "Guys. ID badge on the desk. 'Lowell.' Like Dot?"
  - Nori: "Common name. Probably."
- **Flags:** checkpoint · closes: observation room door

**2.6b · `use` · Safe-room exit**
- **Where:** The stairwell lever in the observation room.
- **HUD:** `Unlock the stairwell door`
- **Radio:**
  - Taro: "Catch your breath first. The roof isn't going anywhere."
  - Mochi: "Stairwell, then helipad. Last leg of the delivery!"
- **Flags:** opens: stairwell door

**2.7 · `reach` · Plan change**
- **Where:** Up the stairwell to the roof (storey 3) and the helipad. It's empty except for skid marks. Across the street, the helicopter has drifted down and settled through the Galleria's skylight with its rotor turning lazily. Arriving bangs open every roof-access door in the building, so the horde can follow you up.
- **HUD:** `Get up to the helipad`
- **Radio:**
  - Dot: "Larry? Come in, Larry. ...Oh, no. He took a nap. He was on a double."
  - Mochi: "So the helicopter is... on the mall."
  - Dot: "New plan, sweet peas. Freight trains still run from the rail yard."
- **Flags:** opens: roof-access doors B, C, D, E and the Floor 2 fire exit

**2.8 · `use` · Crescendo 2**
- **Where:** The skybridge terrace, one floor down (storey 2) on the roof of the east wing, reached from the helipad by an outside flight of stairs or a ladder against the tower wall. Shutter control panel at the hospital end of the skybridge, with a long glass corridor on the far side. The horde boils up the roof-access huts from Floor 2 and the ladders from the lobby roof. HVAC units, a container and crates make imperfect cover, and a rifle and launcher wait here for the long roof sightlines.
- **HUD:** `Raise the skybridge shutter`
- **Radio:**
  - Dot: "The skybridge leaves from the terrace one floor down. Panel's by the shutter."
  - Taro: "Every roof door in the place just banged open. Company's coming up."
  - Dot: "Cross the skybridge to the Galleria. Its service tunnel runs to the rail yard."
  - Pip: "A MALL. Finally, side quests."
- **Flags:** horde · holdout 75 s · opens: skybridge shutter

**2.9 · `reach` · Quiet beat**
- **Where:** Across the glass skybridge over the bay inlet (storey 2) into the Galleria upper concourse. The Dreamwell Dream Shop has pyjama-clad mannequins, and an old ballroom chandelier hangs over the ballroom's dance floor.
- **HUD:** `Cross into the Galleria`
- **Radio:**
  - Taro: "This was a ballroom once. I took my wife dancing here. She'd hate the carpet."
  - Nori: "...That's actually lovely, Taro."
- **Flags:** opens: stockroom door

**2.10 · `gather` · Checkpoint safe room**
- **Where:** Down the escalator into Bun Bun Toys (storey 1) and into its stockroom, which is full of plushies.
- **HUD:** `Hole up in the toy store stockroom`
- **Radio:**
  - Pip: "Plushies. Thousands of plushies."
  - Mochi: "No souvenirs, Pip."
  - Pip: "One souvenir."
- **Flags:** checkpoint · closes: stockroom door

**2.10b · `use` · Safe-room exit**
- **Where:** The back-door lever in the stockroom. The back door lets out onto the mezzanine ring over the food court.
- **HUD:** `Unbolt the stockroom back door`
- **Radio:**
  - Nori: "Back door lets out on the mezzanine over the food court. Stay together."
  - Pip: "Snoozle plush is coming with me. For morale."
- **Flags:** opens: stockroom back door

**2.11 · `reach` · Brute**
- **Where:** Round the mezzanine and down an escalator (storey 0) into the food court atrium, around a dry fountain, with the helicopter's tail poking down through the open skylight. The Brute is a huge sleeper in the **Snoozle mascot suit**.
- **HUD:** `Cross the food court`
- **Radio:**
  - Pip: "Is that SNOOZLE? Snoozle is HUGE."
  - Dot: "That's no sheep, sweet pea. That's a Brute in a sheep suit."
  - Taro: "Somebody's last shift was a long one."
- **Flags:** brute

**2.12 · `use` · Power**
- **Where:** Mall security office, through the glowing Star Arcade (under the toy store). Breaker panel on the back wall. The power raises the fire shutter in Security's east wall, which came down when the power went.
- **HUD:** `Restore power in Security`
- **Radio:**
  - Dot: "The loading dock lift needs power. Breakers are in Security, past the arcade."
  - Pip: "Past the ARCADE?"
  - Nori: "No."
- **Flags:** opens: Security's east fire shutter (to Plumley's)

**2.13 · `reach` · Round the back**
- **Where:** The police have barricaded the dock corridor from the inside, so the team goes round. A staff corridor under Bun Bun Toys leads into Plumley's, the Galleria's old department store. Its ground floor is two halls split by a perfume wall: south-east through the cosmetics and perfume counters (tight, shotgun range), through a smashed mirror panel in the wall, then west through shoes and handbags (a fitting-room pocket with armour) to the escalator up. The far east end, round the end of the wall, is optional (a Snoozle display tower and a shotgun).
- **HUD:** `Go round through Plumley's`
- **Radio:**
  - Dot: "Lights are on! Oh. Sweet peas, the police barricaded the dock. It's an evacuation point."
  - Dot: "Go round: through Plumley's, over the car park, in from the truck yard."
  - Mochi: "The scenic route. Customers love the scenic route."
  - Pip: "Perfume counters. Every sleeper in here smells AMAZING."
- **Flags:** none

**2.14 · `reach` · Home & Bedding**
- **Where:** Plumley's first floor (storey 1): north-east between rows of neatly made show beds (Bed 4 is where Bob from Bedding dozed off), through a gap halfway down the display wall (linens and pillows along the top are a side loop), south through Dreamwell's "Sweet Dreams Night Sale" corner of Hush displays and nap pods, then the escalator up to the Galleria Cineplex lobby (storey 2).
- **HUD:** `Head up to the Cineplex`
- **Radio:**
  - Pip: "A whole floor of beds. Nobody touch the beds. This is SO a trap."
  - Nori: "'Sweet Dreams Night Sale.' Free Hush with every pillow. They planned this."
  - Dot: "The cinema's up top. Its fire exit crosses to the car park roof."
- **Flags:** none

**2.15 · `reach` · Midnight Marathon**
- **Where:** The Cineplex lobby (candy bar, popcorn, a Midnight Marathon poster), then the dark Screen 2, packed with the marathon audience who turned in their seats: in at the back corner, along the cross aisle by flashlight, out by the screen. A long, tight fire-exit corridor runs down the east side to a footbridge onto the car park roof. Optional: Screen 1 ("SOLD OUT") off the lobby, with an auto shotgun.
- **HUD:** `Cut through to the car park roof`
- **Radio:**
  - Taro: "A midnight marathon. Three Snoozle films. I'd have dozed off in the first one."
  - Mochi: "Looks like everybody did."
  - Nori: "Fire exit's past the screen. Flashlights on, and step quietly."
- **Flags:** none

**2.16 · `reach` · Down the car park**
- **Where:** Galleria Parking, three decks. The open roof (storey 2) has long sightlines (a rifle by the footbridge) and one of Dreamwell's "Sweet Dreams Night" fog trailers, empty. The roof is crossed corner to corner, north-east to south-west. Level 1 (dark, St. Marigold's ambulances jammed nose to tail in the evacuation queue up the deck) is crossed along its south side to the ramp down in the south-east corner, onto the ground deck.
- **HUD:** `Get down through the car park`
- **Radio:**
  - Pip: "Is that a FOG MACHINE? On the roof? Who puts a fog machine on a roof?"
  - Nori: "Dreamwell does. 'Sweet Dreams Night, Unit 7.' Empty now."
  - Dot: "St. Marigold sent its ambulances up those ramps. The police office is at the bottom."
- **Flags:** opens: parking office door

**2.17 · `gather` · Checkpoint safe room**
- **Where:** Back west along the ground deck's south side to the parking office in its south-west corner, which the police used as their desk. Its back door is the yard gate.
- **HUD:** `Hole up in the parking office`
- **Radio:**
  - Dot: "Parking office, ground floor, south-west corner. Get in and get that door shut."
  - Taro: "Ambulances nose to tail, doors open. They got out on foot. I hope."
- **Flags:** checkpoint · closes: parking office door

**2.17b · `use` · Safe-room exit**
- **Where:** The yard-gate lever in the parking office. Opening it also lets the police barricade on the food-court side of the dock give way, one more lane for the horde.
- **HUD:** `Open the yard gate`
- **Radio:**
  - Nori: "Police clipboard. Last lift down to the tunnel left at 4:15. They left us something."
  - Pip: "A ROCKET POD. On the dock. Bolted to a truck. Best. Evacuation. Ever."
  - Dot: "The freight lift's at the bottom of the shaft, sweet peas. It's a long way up."
  - Taro: "Rest a minute first. That dock will be the longest few minutes of the night."
- **Flags:** opens: yard gate, dock barricade (the police corridor, the finale's lane C)

**2.18 · `use` · Big Hold On (finale)**
- **Where:** West along the truck yard and north through bay 4 to the loading dock, where St. Marigold's overflow was evacuated: police vans, an ambulance, triage tents in the dead-end west end and low broken sandbags. The police ran 61 awake people down the freight lift to the service tunnel, left on the last car at 4:15, and ran the lift's power cells flat; the spares are stashed round the dock. The lift chimes the whole way up from the bottom of the shaft, and every sleeper in the Galleria comes to listen. This is the scavenge finale: the lift needs four power cells, and the timer stops at set points until another one has been picked up.
  - **Lane A:** the east half of the truck yard, in through bays 3 and 4, straight at the pod. Its spawn zones are only the yard's far corners (by the police fence and by the yard gate), so it starts as far out as lane B. Live in every wave.
  - **Lane B:** the west half of the yard (a police fence splits the yard), in through bays 1 and 2, then east along the whole length of the dock past the cell pockets. Opens with wave 2.
  - **Lane C (flank):** the police corridor from the food court, whose barricade gave way at 2.17b. It comes out on the dock's north side, north-west of the nest and just outside the pod's arc. Brute and special pushes.
  - **Gun:** the police's **Fizzbang Pod** (rocket pod) in a sandbag nest in the dock's south-east corner beside the lift, the wall at its back, facing south-west. Its ±80° takes in all four bays and the whole length of the dock; the police corridor's mouth and the compactor stay outside it.
  - **Power cells:** cold storage (north-west), the returns nook under the catwalk, the west end of the catwalk (storey 1, up the west or mid-span ladder or the east stairs), and the compactor round the corner from the pod (south-east). Solid cover (vans, the ambulance, a car) runs along the north wall between the pocket mouths, where the runners go. Three of the four are up lane B's end of the dock, so whoever runs for them needs the pod covering them.
  - **Timer stops:** at 10 s ("The lift needs power! Find a cell!"), 45 s ("The lift stalled! Second cell!"), 85 s ("Stalled again! Third cell!") and 125 s ("One last cell and we're up!"), each until that many cells in total have been picked up.
  - **Supply stand:** the police supply desk by the lift button, four tiles from the nest: four medkits, three ammo piles, two firebombs and a rattle.
  - **Escape:** when the timer runs out the lift gate opens next to the stand, with the trickle coming from all three lanes.
- **HUD:** `Call the freight lift`
- **Radio:**
  - Dot: "That lift chimes the whole way up. Every sleeper in the Galleria will come to listen."
  - Dot: "And the police ran its cells flat, sweet pea. It needs four power cells to climb."
  - Nori: "Spares: cold storage, the returns nook, the west end of the catwalk, and by the compactor."
  - Pip: "Dibs on the rocket pod!"
  - Mochi: "The pod covers the bays and the dock. Runners, stay where it can see you!"
  - Taro: "It can't swing round to the police corridor. That one's ours."
- **Holdout script (feed lines):** wave 35 s, lane A ("Here they come! Bays 3 and 4!") · breather 10 s ("Quiet for a sec. Go get a cell!") · wave 35 s, A + B, 2 specials ("All four bays! Watch the police corridor!") · Brute 25 s, lane C ("Something big in the police corridor!") · breather 10 s ("Breathe. Pick each other up!") · final 35 s, A + B, 2 specials ("Every bay at once! Hold on!")
- **Flags:** horde · big (Big Hold On, scavenge: 4 power cells; lanes A bays 3–4, B bays 1–2 and the dock, C police corridor; mount: rocket pod) · holdout 150 s plus cell stops · opens: lift gate

**2.19 · `gather` · Chapter end**
- **Where:** Inside the freight lift. It's the end safe room and descends to the service tunnel. The escape trickle runs from all three lanes until everyone is inside.
- **HUD:** `Everybody into the freight lift`
- **Radio:**
  - Dot: "Tunnel runs under the river to the rail yard. I'm right here on the radio."
- **Flags:** chapter end · closes: lift gate

**Lore notes**

| # | Placement | Text |
| --- | --- | --- |
| 1 | Nurses' station, handover sheet | Everyone on nights is fine. Everyone who napped on break got up at 3 and walked out humming. Lesson: NEVER nap on break. Sister Agnes |
| 2 | Sleep Clinic whiteboard | HX-9 TRIAL: deep sleep, 100%. Side effect: sleepwalks toward the chime tone. Stop the chime, they stop? Ask Dr. Lowell. DO NOT tell Pell. |
| 3 | Patient chart at bed 12, Sleep Clinic | "In the dream I'm looking for somewhere quiet. Everything awake is so LOUD." Walked 40 m toward the chime. Calmed when shushed. |
| 4 | Lanyard on the observation room desk | DREAMWELL SLEEP CO. Dr. Wren Lowell, Lead Formulation. Emergency contact: Dorothy "Dot" Lowell (Mum), Mallow Bay Transit. |
| 5 | Taped to the stairwell door in the observation room | LARRY. Do NOT nap in the chopper. We have talked about this. Mgmt |
| 6 | Dream Shop window poster, with a scrawl in pen | COMING SOON: Hush HX-9 Pillow Mist! Dreamwell, because Mallow Bay deserves to rest. [scrawled:] the one Wren said NO to |
| 7 | Thermos on Larry's ledge, ER roof (optional) | Best seat in the house. You can see the helipad AND the Galleria skylight. Back in 10, just resting my eyes. L. |
| 8 | Customer service board, Plumley's ground floor | SWEET DREAMS NIGHT LATE OPENING till 3 a.m.! Free Hush Pillow Mist with every pillow, courtesy of Dreamwell. [pen:] Bob from Bedding dozed off on Bed 4 at 2:50. |
| 9 | Usher's clipboard, Cineplex lobby | Midnight Marathon, Screen 2: 212 tickets. Everybody dozed off in part 2. I stayed up on pick-n-mix. At 3 they all stood up at once, humming. Benji |
| 10 | MBPD clipboard, parking office | EVAC POINT 2, Galleria dock. 61 awake folks down the freight lift to the rail yard. Last car 4:15. Lift cells flat, spares stashed round the dock. Pod in the nest by the lift, leave it. The lift CHIMES all the way up. They come for the chime. Face the bays, mind the corridor. Sgt. Tuttle |

**Map designer notes:** Drag IV stands and wheelchairs along corridor A toward the day-room stairs as direction arrows. Make the helicopter tail in the skylight visible from the skybridge so it works as a landmark pulling players to the food court. Stack Snoozle plush displays in the toy store. Give the arcade "INSERT COIN" glow a strong colour so it leads to Security. Use soup-coloured lighting on the Floor 2 sign. In Screen 2 only the exit signs are lit; the house is packed (double sleeper density). Keep the evacuation point's sandbags low and broken, and the middle of the dock clear for the pod, which sits in the south-east corner facing south-west over the bays and the dock. Light each bay from the yard side so the lanes read from the nest. The police corridor gets a red POLICE CORRIDOR sign and a lamp: it's the team's to watch, not the pod's. Each spare cell has a gold SPARE CELL label and a lamp in its pocket, and the lift wall says NEEDS 4 POWER CELLS.

---

### Chapter 3: Night Freight

**Subtitle:** Mallow Bay Rail Yard & Docks
**Setting:** Industrial waterfront on three storeys. Switchman's hut at the tunnel mouth, a switching yard with signal gantries, a water tower, the yardmaster's office, a container maze and crane yard. Then the Dreamwell Hush Works plant (tank farm, lavender tanks, mixing floor, second-floor labs, break room), the loading yard, a pier walkway and the drawbridge control tower. South of the river: the dock siding where Bertha waits (requisitioned by the National Guard, with their gun flatcar beside her), Fish Dock Road, the fish market and its quay, the Guard railhead with its command post, the old steam depot (flooded turntable, roundhouse, coal stage) and the Seafarers' Mission. Storey 1 holds the yardmaster's office (a cabin on stilts, front stairs up and back stairs down), the 2F labs and break room over the mixing floor (up the main or back stairs, with a fire escape down to the loading yard), the sergeant's office over the Guard command post, and perches: the boxcar roofs in the stopped freight train, the water-tower deck, two container stack tops, the tank-farm valve catwalk, the wharf stack at the siding and the coal stage. The control tower is stacked: hall (storey 0), switchgear (storey 1), control room (storey 2).
**Mood:** 5:20 a.m. Sodium-orange lamps, rust-red and teal containers, black water, thick lavender fog rolling off the river. South of the river, Guard olive drab and coal black.

**Intro card:**
> 5:20 a.m. No helicopter, but Dot knows trains. Old Bertha, a diesel locomotive older than Taro, sits dry on the dock siding, and the hill line runs straight out of town. Between you and her: a rail yard, a lot of fog, and the factory where the fog comes from. Someone else is on the radio now. Humming.

**Requirements check:** start safe room 3.1 · checkpoints 3.4, 3.9, 3.15 · crescendos 3.3, 3.8 · collect 3.5, 3.14 · Brute 3.7 · horde run 3.15 · finale (Big Hold On, restart: Bertha stalls twice; Thump Cannon; Brute from the back gate) 3.17 · escape 3.18

**3.1 · `use` · Start safe room**
- **Where:** Switchman's hut at the service tunnel mouth, with a wall radio and a lantern.
- **HUD:** `Check in with Dot`
- **Radio:**
  - Dot: "Rail yard! Old Bertha's on the dock siding. She needs diesel and a little love."
  - Taro: "I'm good at love. Diesel, less so."
- **Flags:** opens: hut door

**3.2 · `reach` · Yard run**
- **Where:** The switching yard. Tracks fan out under signal gantries, and a stopped freight train forms a long wall with one gap. Optional: two ladders on its west side climb onto three coupled boxcar roofs (storey 1), an overwatch across the east yard with a small reward.
- **HUD:** `Cross the switching yard`
- **Radio:**
  - Pip: "Real trains! Best apocalypse ever."
  - Nori: "Watch the third rail."
  - Pip: "There's no third rail."
  - Nori: "Watch it anyway."
- **Flags:** none

**3.3 · `use` · Crescendo 1**
- **Where:** The big hill-line switch lever at the foot of the water tower, in the exposed middle of the yard. The tower's pump house carries a deck round the tank (storey 1), up two ladders: a perch over the arena with a rifle, though the sleepers climb both ladders too.
- **HUD:** `Throw the hill line switch`
- **Radio:**
  - Dot: "The hill line's switched off. Big lever by the water tower. It's a noisy one."
  - Pip: "Big lever, big noise, big horde. I'm learning."
  - Nori: "Water tower has a ladder. High ground helps, but they climb too."
- **Flags:** horde · holdout 60 s · opens: yard gate to the office lot, office front door

**3.4 · `gather` · Checkpoint safe room**
- **Where:** The yardmaster's office, a portable cabin on stilts above the office lot (storey 1), up the front stairs onto the porch.
- **HUD:** `Regroup in the yardmaster's office`
- **Radio:**
  - Voice: "...hello? Is anyone awake? Please. Don't go to the hill without the Bell."
  - Mochi: "Dot? Was that you?"
  - Dot: "No, sweet pea. That wasn't me."
- **Flags:** checkpoint · closes: office front door

**3.4b · `use` · Safe-room exit**
- **Where:** The back-door latch in the office. The back stairs go down toward the container terminal.
- **HUD:** `Open the safe room door`
- **Radio:**
  - Taro: "Whoever she is, she sounded tired. Like us."
  - Mochi: "Back stairs go down to the containers. Let's find Bertha a drink."
- **Flags:** opens: back stairs door

**3.5 · `collect` (5 diesel cans) · Sweep**
- **Where:** Container maze and crane yard. Cans are at the fuel point by the terminal gate, by the base of dock crane 2, inside open reefer 7, and on top of container stacks A and B (storey 1), each reached by two ladders.
- **HUD:** `Find diesel for Bertha`
- **Radio:**
  - Dot: "Bertha's thirsty. Diesel cans should be lying round the containers."
  - Mochi: "Five cans. I've delivered heavier pizzas."
  - Pip: "Two are up on the container stacks. Ladders! I love ladders."
- **Flags:** opens: terminal gate to Dock Road

**3.6 · `reach` · Approach**
- **Where:** North up Dock Road to the Dreamwell Hush Works gate. Giant lavender tanks carry the Snoozle logo, and fog leaks from the valves. Optional: a valve catwalk on stilts between the two tank rows (storey 1), a ladder at each end, is a rifle perch over the tank farm.
- **HUD:** `Head to the Dreamwell Hush Works`
- **Radio:**
  - Taro: "So this is where the fog comes from. Smells like my grandma's sock drawer."
  - Nori: "Breathe through your sleeve. I mean it."
  - Voice: "The Hush Works. My lab's on the second floor. Terminal four."
- **Flags:** none

**3.7 · `reach` · Brute**
- **Where:** Through the plant entrance and across the mixing floor (storey 0): vats, railings, purple puddles, to the foot of the main stairs in the south-east corner. The Brute is **Hank** from the tank-cleaning crew, in a swollen hazmat suit.
- **HUD:** `Cross the mixing floor`
- **Radio:**
  - Dot: "Something big's moving in that plant. Big and soggy."
  - Pip: "Why is it always big AND soggy?"
- **Flags:** brute

**3.8 · `use` · Crescendo 2**
- **Where:** Up the main stairs to the second-floor labs (storey 1, over the mixing floor): a short stair hall, then Wren's lab. The download runs at terminal four, under walls covered in sound-wave charts. Both stairwells (main and back) rise from the mixing floor straight into the stair hall beside Wren's lab, and that is where the sleepers come up. Lab B and the sound lab stay shut behind doors until the download is done, then open as loot pockets on the way to the break room.
- **HUD:** `Download the Morning Bell`
- **Radio:**
  - Voice: "The file's called MORNING BELL. It won't wake them. But it lets them lie still."
  - Nori: "Who ARE you?"
  - Voice: "The one who made the fog. I'm so sorry."
  - Nori: "Two stairwells up here. Watch both!"
- **Flags:** horde · holdout 90 s · opens: lab exit, break room door

**3.9 · `gather` · Checkpoint safe room**
- **Where:** Through a staff passage to the Hush Works staff break room, upstairs too (storey 1): vending machines, a Snoozle calendar, a bin full of crumpled memos.
- **HUD:** `Shelter in the break room`
- **Radio:**
  - Dot: "That voice. Did she give a name, sweet pea?"
  - Taro: "...Not yet, Dot. Keep the radio on."
- **Flags:** checkpoint · closes: break room door

**3.9b · `use` · Safe-room exit**
- **Where:** The fire-escape lever past the vending machines. The fire escape goes down to the loading yard.
- **HUD:** `Open the fire escape`
- **Radio:**
  - Nori: "Fire escape's past the vending machines. Take a snack. Doctor's orders."
  - Mochi: "Pier, bridge, Bertha. Three more stops, team."
- **Flags:** opens: fire escape

**3.10 · `reach` · Pier run**
- **Where:** Down the fire escape, south across the loading yard to the pier gate, then west along the pier walkway past moored barges and dock cranes into the hall of the drawbridge control tower.
- **HUD:** `Follow the pier to the drawbridge`
- **Radio:**
  - Dot: "The hill line crosses the drawbridge. It's up. Controls are top of the tower."
  - Pip: "Gulls are fine, right? Gulls didn't nap?"
- **Flags:** none

**3.11 · `use` · Bridge**
- **Where:** Up two flights (switchgear on storey 1) to the control room at the top of the tower (storey 2), at the big red button. The room opens onto a balcony over the pier.
- **HUD:** `Lower the drawbridge`
- **Radio:**
  - Mochi: "Big red button, top floor. My favourite kind."
  - Voice: "Once you're across, I'll see your lights from the hill. Hurry."
- **Flags:** opens: drawbridge track barrier

**3.12 · `reach` · Over the river**
- **Where:** Back down the tower, over the drawbridge onto the dock siding apron. Bertha sits at the west end, a stubby chibi diesel in cream and cherry red, but she has company: a Guard flatcar with a big gun on it, "REQUISITIONED: MALLOW BAY GUARD" stencilled by her cab door, and the cab padlocked. The arrows lead the other way, south through a gap in the apron fence onto Fish Dock Road, to the fish market's west doors. The road beyond is closed by a Guard checkpoint (sandbags and trucks, see-through but not passable).
- **HUD:** `Head south down Fish Dock Road`
- **Radio:**
  - Taro: "Bridge is down. Back downstairs, everyone."
  - Mochi: "There's Bertha, end of the siding! ...Why is there a cannon parked next to her?"
  - Nori: "Army stencils on everything. The Guard took her, and they padlocked her cab."
  - Dot: "Guard railhead's south, past the fish market. Their sergeant keeps the keys, sweet pea."
- **Flags:** none

**3.13 · `reach` · Fish market**
- **Where:** A long dark market hall (tight interior, shotgun ground) split into three bays by walls with one gap each at alternate ends, so the route zig-zags: south through the wet fish stalls, north across the auction floor (the board stopped mid-bid), south-east through the packing room, then out onto the quay, the first long sightline in a while, with trawlers moored in the basin. The Piggyback hides under the stalls. Optional: the ice house, a cold dark room off the packing room, holds a Desert Eagle and an auto shotgun.
- **HUD:** `Cut through the fish market`
- **Radio:**
  - Pip: "A fish market. In the dark. Full of sleepers. Cool cool cool."
  - Taro: "Mind the stalls. The little ones in onesies like to hide underneath."
  - Mochi: "In the west door, out by the quay. Like a delivery with extra steps."
- **Flags:** none

**3.14 · `collect` (1 key) · Guard railhead**
- **Where:** South off the quay into the National Guard's railhead: their evacuation train still stands on two sidings (army trucks on flatcars, olive boxcars, gaps to slip through), with tents, a gun rack and a field kitchen between. The command post is in the far south-east corner, sandbagged, with a siren on the roof. Bertha's cab key is on the sergeant's desk upstairs (storey 1), beside the requisition order.
- **HUD:** `Find the key to Bertha's cab`
- **Radio:**
  - Dot: "That's the Guard railhead. Command post's the cabin with the siren on the roof."
  - Pip: "Fetch quest! The key's upstairs. It's always upstairs."
  - Nori: "Nobody touch the siren."
- **Flags:** opens: Seafarers' Mission door

**3.15 · `gather` · Checkpoint safe room (horde run)**
- **Where:** The siren goes off. A fighting run back west across the railhead and over the level crossing into the old steam depot: round or across the flooded turntable pit (its deck is a 2-wide chokepoint), past or through the roundhouse, to the Seafarers' Mission, a little sailors' chapel and canteen in the north-west corner with bunks, a tea urn and a ship's bell nobody rings. Optional: the coal stage (storey 1, stairs and a ladder) is a perch over the depot with a rifle.
- **HUD:** `Run for the Seafarers' Mission`
- **Radio:**
  - Pip: "Got the key! Also I MAY have leaned on the siren button."
  - Nori: "Pip."
  - Taro: "The Seafarers' Mission never locks its door. Back past the old turntable. Run!"
- **Flags:** horde · checkpoint · closes: mission door

**3.15b · `use` · Safe-room exit**
- **Where:** The bar on the mission's siding door. A short lane runs north through the apron fence to Bertha.
- **HUD:** `Unbar the siding door`
- **Radio:**
  - Taro: "My wife and I sang carols here every Christmas. Same tea urn, I think."
  - Nori: "Guns, kit, a bell nobody rings. Load up. Bertha's crank is a long one."
  - Mochi: "Siding door goes straight to Bertha. Last drop of the night, team."
- **Flags:** opens: siding door

**3.16 · `reach` · Back to Bertha**
- **Where:** Up the mission lane onto the dock siding, to Bertha and the Guard flatcar beside her.
- **HUD:** `Get back to Bertha`
- **Radio:**
  - Dot: "Key in the cab, sweet pea, and say hello to Bertha for me."
  - Taro: "She's older than me. I like her already."
- **Flags:** none

**3.17 · `use` · Finale: the Big Hold On**
- **Where:** The fuel valve beside Bertha's cab. Pour the diesel and crank the engine, and hold the dock siding while she warms up. This is the restart finale: Bertha stalls twice, at the start of wave 2 and at the start of the final, and the timer stops until someone has stood at the starting crank on her nose for 4 s ("Bertha stalled! Crank her at the nose!", then "She stalled again! Back to the crank!"). The crank faces the south-west back gate, so whoever restarts her has their back to the cannon's side.
  - **Layout:** the apron is three parts. West: Bertha, the gun flatcar, the supply stand and the wharf stack. Middle (x 40–55): an open kill zone for the cannon. East: new container walls cut the apron into two 6-wide lanes that run straight at the cannon, with a two-high container wedge between them pointing at the kill zone. The lanes are lit at their mouths and far ends and dark between.
  - **Lane A:** down off the drawbridge and west along the north container wall (spawn zones: the far half of the north lane, the apron by the bridge foot, and the bridge deck on storey 1). Live in every wave.
  - **Lane B:** in at the road gate from Fish Dock Road and west along the south container wall (spawn zones: the far half of the south lane, the connector by the dock shed, and Fish Dock Road). Opens with wave 2. Both front lanes spawn only in their far halves, 60 m or more from the gun.
  - **Lane C (flank):** the south-west gate behind Bertha (the mission lane), fed from the bonded yard behind the south fence, 60 m from the cannon and out of sight of the apron. Outside the cannon's arc. Brute and special pushes.
  - **Gun:** the Guard's **Thump Cannon** on the flatcar beside Bertha, in a sandbag nest (Bertha to the north, bags to the south), facing east straight down both lanes. Its shells splash, so it wants them far away, and the lanes give it range.
  - **Perch:** the wharf stack (storey 1) over Bertha. Both its ladders are at its west end, facing lane C, so the front-lane crowds have to come round, and the Brute still climbs.
  - **Supply stand:** the Guard's, along the track by the cab (kept: the loot roll never thins it): four medkits, three ammo piles, two rattles and two firebombs. A little more ammo and a medkit at the edge of the kill zone.
  - **Escape:** the cab door opens about 4 tiles from the valve, with the trickle coming from all three lanes.
- **HUD:** `Fuel up and start Bertha`
- **Radio:**
  - Dot: "Prime her, crank her, and hold on. Bertha takes her time and so should you."
  - Taro: "She'll stall on us, mind. Old girls do. When she coughs out, someone runs to the crank on her nose."
  - Nori: "That's the Guard's cannon on the flatcar. Somebody man it. Aim long, it splashes."
  - Mochi: "They'll come off the bridge and in at the road gate. The back gate's ours to watch."
  - Pip: "I CALL THE CANNON!"
- **Holdout script (feed lines):** wave 35 s, lane A ("Here they come! Down off the bridge!") · breather 10 s ("Bertha coughs. That's good, right?") · wave 35 s, A + B, 2 specials ("The road gate too! Bridge and road!"; first stall) · Brute 25 s, lane C ("A Brute at the back gate! Behind Bertha!") · breather 10 s ("Bertha purrs. Breather! Patch up!") · final 35 s, A + B ("She's nearly up! Bridge and road, hold the line!"; second stall)
- **Flags:** horde · big (Big Hold On, restart: 2 stalls at the crank; lanes A bridge, B road gate, C south-west gate; mount: cannon) · holdout 150 s plus crank stops · opens: cab door

**3.18 · `gather` · Chapter end (vehicle)**
- **Where:** Bertha's cab and the coupled flatcar. The escape trickle runs from all three lanes until everyone is aboard.
- **HUD:** `All aboard Bertha!`
- **Radio:**
  - Taro: "She's running! Everybody in the cab, now!"
  - Dot: "Hill line runs up to Pinecone Hollow. I'll meet you near there with the bus."
- **Flags:** chapter end · closes: cab door

**Lore notes**

| # | Placement | Text |
| --- | --- | --- |
| 1 | Clipboard in the yardmaster's office | SPECIAL RUN 2:40 a.m.: 12 tankers HUSH HX-9 to City Hall. Auth: G. Pell. Attached: "NOT SAFE. DO NOT SHIP. W. Lowell." Shipped anyway. |
| 2 | Safety poster at the Hush Works gate | HUSH is gentle! Side effects may include deep sleep, sweet dreams, mild humming and, rarely, walking toward pleasant sounds. Sleep tight! |
| 3 | Open locker by the mixing floor (Hank's) | Tank 7 crew: Hank took a 20-min power nap inside Tank 7. Came out... bigger. Do not nap in the tanks. Do not nap anywhere. |
| 4 | Wren's lab notebook, page 1 (desk by terminal four) | HX-9 sleepers chase noise because the dream wants quiet. They're not cruel. They're trying to hush us. |
| 5 | Wren's lab notebook, page 2 (pinned to the wall) | MORNING BELL won't wake them. I don't know how yet. It lets them lie down and rest. Needs the Pinecone Hill mast. Someone must keep it ringing. |
| 6 | Crumpled memo in the break room bin | Wren, Council wants results by Sweet Dreams Night. Your "concerns" are noted. Ship HX-9. G.P. P.S. Get some sleep! |
| 7 | Auction board on the fish market's auction floor | 3:00 a.m. auction. Lot 14, live eels, going once, going tw |
| 8 | Requisition order on the sergeant's desk (Guard command post, upstairs) | 2:45 a.m. GUARD RAILHEAD. Loco No. 9 BERTHA taken for the hill line run. Escort gun on the flatcar beside her. Cab locked, key in the CP. Night watch: STAY AWAKE. |
| 9 | Noticeboard in the Seafarers' Mission | Seafarers welcome! Tea all night, bunks free. Please do NOT ring the ship's bell after ten. It brings the whole wharf over. |

**Map designer notes:** Twelve empty tanker cars on a siding labelled HX-9, with one bay left bare. Put a "DAYS SINCE INCIDENT: 0" sign on the Hush Works gate. Run a fog-leak trail from the tanks to the river. Pin sound-wave charts and a child's drawing ("To Wren, from Mum") in the lab. Make the tower's lit window visible across the water from the pier so the destination reads before the radio line plays. South of the river, Bertha and the Guard flatcar should be lit and in view from the bridge foot, so the team sees the cannon (and the reason for the detour) before the radio explains it. The Guard checkpoint on Fish Dock Road is see-through, so the railhead reads as the goal from the road. The mission's ship's bell is a quiet nod to the Morning Bell: bells bring the sleepers. On the apron, sign both lane mouths for the gunner (BRIDGE in teal, ROAD GATE in gold) and keep the two lanes clear of clutter, so the cannon looks straight down each. The crank on Bertha's nose gets a big gold CRANK label and its own lamp: it has to read from the cannon in two seconds when she stalls. Dock Shed 3, off the connector, keeps the chapter's best guns and is lit and signed from the bridge foot.

---

### Chapter 4: Morning Bell

**Subtitle:** Pinecone Hollow & Pinecone Hill
**Setting:** Suburb into forest edge, then down to the river. Pinecone Hollow station, Maple Loop and Birch Court cul-de-sacs, fenced backyards, a prepper basement, Pinecone Elementary's schoolyard, the creek culvert with its flood gate, a pine forest trail, a ranger cabin, the lower woods (a rockslide on the hill trail, the old logging road, the logging camp, the Pinecone Dam and the old flume path), the Pinecone Hill switchbacks and transmitter compound, the downhill road, the river flats (Mill Road and Mill Row, the Pinecone Lumber Co. yard and sawmill, the Mallow River campground), the army field post, and the old river bridge with its army checkpoint and boom gate. Storey 0 is the valley floor. Storey 1 is the rock shelf of Pinecone Hill: the Hill Steps climb onto it from the foot of the switchbacks, and the upper switchbacks, the fire road, the hilltop compound and the first half of the downhill road sit on it, until the Old Stone Steps drop the road back to the valley. Storey 1 also carries the Pinecone Dam's deck, a long chokepoint over the reservoir and spillway. Storey 2 is the transmitter deck on the control shed's roof, where the Bell is rung, and the fire lookout's cab. Ladder side trips: the treehouse on the school path, the fire lookout, and the army watchtower over the boom gate (with a rocket pod on its roof).
**Mood:** 6:05 a.m. moving to sunrise. Peach-gold sky, long blue shadows, lavender mist thinning in the pines. From the Bell on, everything is in warm sunlight.

**Intro card:**
> 6:05 a.m. Bertha ran out of track at Pinecone Hollow. Dot is driving the No. 9 bus to the old bridge to meet the last convoy at sunrise. But the voice on the radio says the sleepers will follow you all the way out, unless someone rings the Morning Bell from the top of the hill.

**Requirements check:** start safe room 4.1 · checkpoints 4.4, 4.8, 4.14 · crescendos 4.6, 4.11 · Big Hold On 4.15 (grand finale: three guns, two Brutes from the motor pool) · collects 4.3, 4.13 · Brute 4.5 · finale 4.15–4.16 (bridge run to the bus)

**4.1 · `use` · Start safe room**
- **Where:** Pinecone Hollow station waiting room, with the ticket-office radio inside. Bertha has stopped outside against a fallen pine across the track.
- **HUD:** `Radio Dot from the station`
- **Radio:**
  - Dot: "I'm taking the No. 9 bus to the old bridge. Last convoy leaves at sunrise."
  - Voice: "The sleepers will follow you all the way out. Ring the Bell first. Please."
  - Mochi: "Hill first, then bridge. Got it. Two-stop delivery."
- **Flags:** opens: station doors

**4.2 · `reach` · Suburb run**
- **Where:** Maple Loop to the cul-de-sac bulb: picket fences, sprinklers still ticking, bikes on lawns.
- **HUD:** `Head up Maple Loop`
- **Radio:**
  - Taro: "My sister lived on this street. Lemon trees. Terrible parking."
  - Pip: "Every window's got a Snoozle nightlight. Every single one."
- **Flags:** none

**4.3 · `collect` (4 car batteries) · Sweep**
- **Where:** An open garage by the bulb, a car up on blocks in a Maple Loop backyard, a golf cart on Birch Court, and a camper van by the river. Connect them through backyard fence gaps.
- **HUD:** `Grab car batteries`
- **Radio:**
  - Voice: "The transmitter's backup power is dead. Car batteries. Four should do it."
  - Mochi: "Grand theft battery. I'll leave a tip."
- **Flags:** opens: Henderson storm cellar door

**4.4 · `gather` · Checkpoint safe room**
- **Where:** The Hendersons' basement, a prepper bunker under a pastel house, through the storm cellar door, with a shelf of canned peaches.
- **HUD:** `Shelter in the Henderson basement`
- **Radio:**
  - Nori: "Peaches, a generator, forty rolls of toilet paper. The Hendersons were ready."
  - Pip: "For everything except this."
- **Flags:** checkpoint · closes: storm cellar door

**4.4b · `use` · Safe-room exit**
- **Where:** The hatch lever in the basement. The hatch comes up behind the Birch Court backyards onto the school path, a fenced lane to the school's back gate. Optional: a ladder at the north end of the lane leads up to a plank treehouse (storey 1) with a small reward.
- **HUD:** `Open the basement hatch`
- **Radio:**
  - Taro: "Hatch comes up behind the backyards. The school's just past the fence."
  - Mochi: "Grab a peach for the road. Batteries stay with me."
- **Flags:** opens: basement hatch to the school path

**4.5 · `reach` · Brute**
- **Where:** Pinecone Elementary schoolyard: playground, crossing, a parked school bus. The Brute is **the crossing guard**, still holding his STOP sign.
- **HUD:** `Cut across the schoolyard`
- **Radio:**
  - Dot: "Careful by the school. Something's flattening the jungle gym."
  - Pip: "Is that... the crossing guard?"
  - Taro: "Stop sign and everything. Let's not cross him."
- **Flags:** brute

**4.6 · `use` · Crescendo 1**
- **Where:** Behind the school, at the creek flood-gate wheel valve. It opens the culvert path up the hill.
- **HUD:** `Open the creek flood gate`
- **Radio:**
  - Dot: "The creek trail's the only way up the hill. Crank that flood gate."
  - Nori: "Squeaky wheel. Of course it's a squeaky wheel."
- **Flags:** horde · holdout 60 s · opens: culvert gate

**4.7 · `reach` · Forest trail (reveal)**
- **Where:** Through the culvert and a winding trail up through the pines: mist, ferns, and a little pile of lost slippers at a fork that points the way. Flashlights matter here. The trail ends at the ranger station.
- **HUD:** `Follow the trail into the pines`
- **Radio:**
  - Voice: "I can see your flashlights from up here. You're close."
  - Nori: "Good. Now tell us everything."
  - Voice: "I made Hush to help people sleep. My boss shipped the batch I said wasn't safe."
- **Flags:** opens: ranger cabin door

**4.8 · `gather` · Checkpoint safe room (reunion)**
- **Where:** The ranger cabin: wood stove, logbook, wall map of the valley. From this step on, the Voice's subtitle reads "Wren".
- **HUD:** `Rest up in the ranger cabin`
- **Radio:**
  - Wren: "Mum? ...Mum, are you on this channel?"
  - Dot: "Wren? Wren Lowell, you are in SO much trouble. Are you hurt, sweet pea?"
  - Taro: "There we are. Took you two long enough."
- **Flags:** checkpoint · closes: ranger cabin door

**4.8b · `use` · Safe-room exit**
- **Where:** The latch on the cabin back door, which opens onto the hill trail.
- **HUD:** `Open the cabin back door`
- **Radio:**
  - Wren: "Back door's on a latch. Trail runs east to the hill steps. Mind the rocks."
  - Dot: "You heard her. Up you go, and bring my daughter a sandwich."
- **Flags:** opens: cabin back door to the hill trail

**4.9 · `reach` · The lower woods (detour)**
- **Where:** A 4 a.m. rockslide buries the middle of the hill trail. The old logging road drops south through dark pines (flashlights; a woodcutter's lean-to off to the side hides a reward) to the Pinecone logging camp: an open clearing round log stacks, a log truck and a cookhouse tent, with the tight bunkhouse (the foreman's chalkboard) on one side and the reservoir on the other. South of the camp the trail climbs onto the **Pinecone Dam** (storey 1): a 3-wide, 23-tile deck with the reservoir on one side and the spillway on the other, a long chokepoint with rifle sightlines across the water. The dam keeper's hut sits on the west forecourt. The goal is the east end of the dam.
- **HUD:** `Go round by the old dam`
- **Radio:**
  - Wren: "Oh no. The hill trail's under a rockslide. Take the old logging road round by the dam."
  - Taro: "Bill Harlow's logging camp. Best flapjacks on the hill, every Sunday."
  - Pip: "Detour quest. There's always a detour quest."
- **Flags:** none

**4.10 · `reach` · Summit**
- **Where:** North up the old flume path along the reservoir's far shore (a fishing spot on the way), round the head of the reservoir and back onto the hill trail beyond the rockslide, then north to the Hill Steps, which climb onto the rock shelf (storey 1). Then the switchbacks west, north and east to the hilltop, with long uphill sightlines. A fire road loops off toward the hilltop past the fire lookout, a timber tower with one ladder up to its cab (storey 2), an optional perch that sees over the rocks to the compound. The goal is the Pinecone Hill transmitter compound: a fenced concrete yard, the radio mast, and the control shed with Wren visible behind a reinforced window.
- **HUD:** `Reach the transmitter on the hill`
- **Radio:**
  - Wren: "I can see you on the dam! The flume path climbs back up to the hill steps."
  - Mochi: "Ten-minute delivery to the top of the hill. Keep the porch light on!"
- **Flags:** none

**4.11 · `use` · Crescendo 2 (the Bell)**
- **Where:** The transmitter console on the transmitter deck, the control shed's roof (storey 2), round the foot of the mast. The way up is a steel stair flight from the west yard plus two ladders on the shed's north and east walls: the horde's three routes up. Cable drums and sandbags give imperfect cover, with a firing lane on every route. Ringing the Bell sends a slow, warm chime across the valley.
- **HUD:** `Ring the Morning Bell`
- **Radio:**
  - Wren: "I'm behind the glass. Locked myself in. The console's up on the deck, by the mast."
  - Pip: "She's real! Hi, radio lady!"
  - Wren: "When it rings, they'll come. Then they'll lie down. Hold until it takes."
  - Mochi: "Hold the deck, team. Watch the stairs and ladders. Last delivery of the night!"
- **Flags:** horde · holdout 120 s · opens: compound gate to the downhill road

**4.12 · `reach` · Aftermath (quiet beat)**
- **Where:** The downhill road at sunrise, along the shelf (storey 1) and then down the Old Stone Steps to the valley floor. Sleepers lie curled up along the verges as non-hostile props, with little "Zzz" particles, and the road is nearly empty (low wanderer density). At the foot of the steps the convoy's tail truck lies jackknifed right across the bridge road: DETOUR.
- **HUD:** `Head down to the old bridge`
- **Radio:**
  - Nori: "They're lying down. Breathing. Just... asleep."
  - Pip: "Night night, everybody."
  - Taro: "Sleep well. We'll come back for you."
- **Flags:** none

**4.13 · `collect` (3 fuel cans) · River flats sweep**
- **Where:** The river flats, down in the hill's shadow where the Bell's chime doesn't carry, so the sleepers here are still up (high wanderer density). Mill Road runs south past Mill Row (a mower fuel can in a cottage garage) to the Pinecone Lumber Co. yard: lumber stacks, log piles and the log loader in the open yard (rifle range), and the dark sawmill shed with its saw line (shotgun range), the second can in the office (and the whiteboard about Dreamwell's bed-frame orders). The yard's east gate opens onto the Mallow River campground: tents, RVs, fire pits, the bathhouse, the boat ramp, the playground, and the camp store with its fuel pumps at the far south end (the third can).
- **HUD:** `Find fuel for the army generator`
- **Radio:**
  - Dot: "Sweet pea, the convoy's last truck jackknifed on the bridge road. Go round by the river."
  - Wren: "The Bell doesn't carry down to the river flats. The sleepers there are still up."
  - Dot: "And the army post's generator is dry. No juice, no boom gate. Find me fuel cans."
- **Flags:** opens: army field post back door

**4.14 · `gather` · Checkpoint safe room**
- **Where:** North up Bridge Road from the campground to the army field post, the soldiers' block between the river flats and the checkpoint plaza: army cots, a radio desk, a weapons rack, the generator, and the sergeant's field orders on the desk (the guns stay on the sandbags for whoever comes next). The rest before the climax.
- **HUD:** `Hole up in the army field post`
- **Radio:**
  - Mochi: "Three cans of go-juice, signed for. Next stop, the bridge!"
  - Dot: "I'm parked just past the army post. Found the door button. In you come, sweet peas."
- **Flags:** checkpoint · closes: field post back door

**4.14b · `use` · Safe-room exit**
- **Where:** The field post generator. Fuelled, it powers the checkpoint, opens the front door onto the plaza, and rolls open the motor pool gate onto the service lane (the finale's lane C).
- **HUD:** `Fuel the field post generator`
- **Radio:**
  - Nori: "Cots, cold coffee, field orders. The soldiers left in a hurry."
  - Taro: "And left their big guns on the sandbags. Somebody hoped we'd come."
- **Flags:** opens: field post front door to the checkpoint plaza, motor pool gate

**4.15 · `use` · THE BIG HOLD ON (finale)**
- **Where:** The boom-gate control box at the foot of the old bridge's ramp, in the army checkpoint plaza. Raising the boom on generator power takes two and a half minutes, and its motor calls every sleeper outside the Bell's range. Dot's No. 9 bus is visible on the far span the whole time. This is the grand finale: three guns, two Brute stages, then a run across the bridge to the bus.
  - **Lane A:** down the river path from round the bend under the pines (spawn zone), over the weir landing and through Bridge Park, from the north. The weir itself is washed out mid-river. Live in every wave.
  - **Lane B:** up the diner road from the far west (spawn zone), into the plaza from the west. Opens with wave 2.
  - **Lane C (flank):** from Bridge Road up the service lane, through the motor pool gate (opened at 4.14b) and the motor pool, into the plaza from the south-east. Outside every gun's arc. Both Brutes and the special pushes come this way. The far bank's river road is also lane C, but it only joins up once the boom is raised, so it feeds the escape.
  - **Guns:** the soldiers left three. The **Fizzbang Pod** on the watchtower roof (storey 1) in the plaza's north-west corner faces north over Bridge Park (lane A); the tower has ladders on its east and south faces. The **Popcorn Gatling** in the sandbag nest faces west down the diner road (lane B). The **Thump Cannon** on the nest's south side, an army truck at its back, faces north-west, so it can swing onto either front lane. Nothing covers the motor pool: that's the team's.
  - **Supply stand:** by the boom lever: four medkits, two ammo piles, a firebomb and a rattle. Round the plaza: a rifle, an auto shotgun and a launcher, and more ammo. Cover is army trucks, a supply tent and low sandbags, never a full wall.
  - **Escape:** the boom on the deck rises and the bus door opens. The run is about 25 m up the ramp and along the deck (storey 1) to the No. 9's door, with sandbags at the midpoint of the span. The far bank's river road pours up the far-bank ramp and round both sides of the bus, so the run meets sleepers head-on.
- **HUD:** `Raise the bridge boom gate`
- **Radio:**
  - Dot: "I can see you! Get that boom gate up and get on my bus!"
  - Wren: "The far bank's out of range. They're still coming. Hold them!"
  - Taro: "Park to the north, diner road to the west. And somebody mind the motor pool behind us."
  - Pip: "Turret section! Gatling, cannon, rocket pod. Best level ever!"
- **Holdout script (feed lines):** wave 30 s, lane A ("Here they come! Out of Bridge Park!") · breather 8 s ("Quick breather! Restock at the boom gate.") · wave 30 s, A + B, 2 specials ("Park AND diner road! Watch the motor pool!") · Brute 22 s, lane C ("A Brute in the motor pool! Turn round!") · Brute 22 s, lane C ("Another Brute! Motor pool again!") · breather 8 s ("Last breather! Patch up!") · final 30 s, A + B ("The boom gate's nearly up! Hold on!"). The front lanes keep trickling through both Brute stages.
- **Flags:** Big Hold On (`big`, grand finale: 3 guns, 2 Brutes; lanes A Bridge Park, B diner road, C motor pool and far bank) · horde · holdout 150 s · opens: boom gate, bus door

**4.16 · `gather` · Campaign end (vehicle)**
- **Where:** Aboard Dot's No. 9 bus on the bridge (storey 1). The escape trickle runs from every lane, the far bank included, until everyone is aboard.
- **HUD:** `Everybody on Dot's bus!`
- **Radio:**
  - Dot: "Boom's up! Run for it, sweet peas! They're coming over the far bank too!"
  - Wren: "I can see the bridge from up here! Sandbags halfway: stop, shoot, then run!"
  - Dot: "Wren, honey. Come down. There's a seat."
  - Wren: "Somebody has to stay up and keep it ringing, Mum. Lowells are good at staying up."
  - Dot: "Then I'll keep the radio on. Every night, sweet pea. Every night."
- **Flags:** chapter end · campaign end · closes: bus door

**Lore notes**

| # | Placement | Text |
| --- | --- | --- |
| 1 | Fridge note, kitchen on Maple Loop | Kids, trying the free Sweet Dreams fog tonight! Windows open, lights out by 11. Love you. Mum xx |
| 2 | Journal on the Henderson basement shelf | Day 1. Told Barb the free fog was a government plot. It was a sleep company plot. Still counts. Day 2. Barb went upstairs for a nap. |
| 3 | Pinecone Elementary noticeboard | SNOOZLE ASSEMBLY CANCELLED due to "weird fog". School closed Friday. Enjoy your long weekend! |
| 4 | Ranger cabin logbook | 3:10 a.m. Fog never reached the hill. 3:40 a lady in a lab coat ran up the trail with a hard drive and a sandwich. Said she's "fixing it". Gave her the transmitter key. |
| 5 | Foreman's chalkboard, logging camp bunkhouse | CREW BUS to the Sweet Dreams fog party in town, 10 p.m. Free pillows! Back by 6 for first shift. Harlow |
| 6 | Dam keeper's log, the hut by the Pinecone Dam | 4:10 a.m. Rockslide on the hill trail, heard it from here. 4:30 sleepers on the far shore, humming at the water. Kept the door shut. Kept the kettle on. |
| 7 | Taped inside the transmitter shed window | Mum, if you're reading this, I'm fine. I'll ring it every morning until I know how to wake them. Save me a seat on the No. 9. W |
| 8 | Back seat of an empty white limo by the bridge | Gift tag: "G. Pell, Executive Rest Kit: silk eye mask, HX-9 Pillow Mist (complimentary)." The kit is open. The limo is empty. |
| 9 | Sawmill office whiteboard, Pinecone Lumber Co. | MON: Dreamwell order, 400 bed frames. TUE: Dreamwell order, 400 more. WED: who is buying all these beds?? |
| 10 | Field orders on the desk, army field post | Hold the bridge until the convoy is clear. 0430: convoy pulled back across the river. Guns stay on the sandbags for whoever comes next. Keep the generator fed. Sgt. Okafor |

**Map designer notes:** Snoozle billboards here are graffitied "WAKE UP" (the station green, the logging camp, the campground, the far bank). The Bell's chime should read visually as soft gold rings expanding from the mast during 4.11. After 4.11 the downhill road is a quiet stretch of sleeping props; the river flats are crowded again because the chime doesn't reach them. The rockslide and the jackknifed convoy truck are both visible dead ends, each signposted to its detour. Pell's limo sits on the verge just before the bridge, on the plaza side of the truck, so players find it during or after the finale. The No. 9 bus on the far side of the bridge should be visible from the boom gate, so the goal is on screen during the Big Hold On. In the plaza, label the nest (ARMY NEST), the supplies and the diner road, and keep the motor pool lit and signed (MOTOR POOL in olive) so the flank reads when the banner says "Turn round!". The washed-out weir is signed (OLD WEIR, WASHED OUT) so nobody tries it as a way over. The midpoint sandbags on the deck are the gauntlet's one stop; keep them low and on both sides of the span.

---

## 3. Chapter transitions

- **1 → 2:** Taro drives Shuttle No. 4 across town and "parks" it nose-first through St. Marigold's ambulance bay doors.
- **2 → 3:** The freight lift drops into the Galleria's service tunnel, which runs under the river and comes up at the rail yard's switchman's hut.
- **3 → 4:** Bertha climbs the hill line through the fog until a fallen pine stops her at Pinecone Hollow station, just as the sky starts to pale.
- **Epilogue:** The No. 9 crosses the bridge into the sunrise while the Morning Bell rings over a sleeping valley, and on the radio Wren hums a morning song this time instead of a lullaby.
