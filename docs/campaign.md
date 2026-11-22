# Chibi Outbreak: The Long Lullaby

Campaign brief for level design. Four chapters, each 30–60 minutes for a 4-player team. Chapter 1 replaces "Last Stop Lane" and reuses its spirit: safe room, main street, back alley, plaza, crescendo, gate, end safe room.

## How to read this brief

- **Step kinds** match the engine exactly: `reach`, `gather`, `use`, `collect`, `holdout`.
- **Where** says which storey a step is on when it isn't street level. Every chapter has real stacked storeys (storey 0 is the ground, storey 1 the first floor up, and so on; see `docs/storeys.md`), joined by stairs, ramps, escalators and ladders. Areas, objectives and perches can sit on upper storeys, and the horde climbs the same stairs and ladders you do.
- **HUD** is the objective line (max 40 chars). For `collect`, the engine appends the count, so it isn't in the text.
- **Radio** lines play when the step begins (max 90 chars each). Speaker names are what the subtitle shows. Until chapter 4 step 8, Wren's subtitle is **Voice**.
- **Flags** say what happens with the step: `horde` / `brute` when it begins, `holdout N s`, `checkpoint` (the team respawns here after a wipe), `opens: X` (a door or barrier that opens when the step completes), `closes: X` (a door that shuts behind the team when the step completes, sealing a safe room), `chapter end` (the last step). The start safe room needs no `checkpoint` flag: the team respawns there until it reaches the first checkpoint.
- **Safe-room exits** are their own short `use` step after each checkpoint (a switch or lever by the back door), numbered with a "b" (for example 1.6b), so the main step numbers stay put.
- **Pacing target:** about 3 minutes per main step including fighting, which puts 13–14 steps at roughly 40–50 minutes. The "b" exit steps take seconds and don't count. Reach legs should be long, winding street or interior runs, not short hops.
- **Brute:** one per chapter, each with a nickname the radio uses.

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
**Setting:** Downtown street grid. 24-hour laundromat, Marshmallow Avenue (four lanes), Tony's Pizza, Pell Plaza Parking, City Hall Square, public library, the Library Row back alleys, Cherry Street heritage tram stop, rail underpass, Clocktower Corner, Kettle Corner Diner, Transit Depot. Three storeys: the street (storey 0); the garage's level 2, the Lather Laundry storeroom, a fire-escape landing, the Library Row rooftops and the tram footbridge (storey 1); the garage roof deck (storey 2). The garage is the big climb: ground deck, a ramp to level 2, a ramp to the roof deck and its viewpoint pier, then a stair tower back down to the square.
**Mood:** 3:20 a.m. in rain. Wet indigo asphalt, pink and teal neon, ankle-deep lavender fog pooling in gutters.

**Intro card:**
> 3:00 a.m. A sweet lavender fog rolled through Mallow Bay, and everyone asleep got out of bed and kept walking. You four were awake. Lucky you. Now the radio is crackling: a night dispatcher called Dot says there's a way out of town, and she'll talk you there. First, you have to get out of the laundromat.

**Requirements check:** start safe room 1.1 · checkpoints 1.6, 1.10 · crescendos 1.4, 1.8, 1.13 · collect 1.7 · Brute 1.11 · finale 1.14

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
- **Where:** The back alleys of Library Row: Library Row, Wash Alley, the middle cut-through and the south cross alley. One fuse is up the back stairs of Lather Laundry in the dark storeroom (storey 1), one on a dumpster lid in the south cross alley, one at the junction box on Wash Alley, and one on the fire-escape landing over Wash Alley (storey 1), reached by two drop ladders. Optional: a ladder up from Library Row and another from Wash Alley lead onto the Library Row rooftops (storey 1), a sniper perch over all three alleys with a rifle and the pigeon keeper's log.
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
  - Dot: "Fuses in, pull the lever, then get up on that footbridge. Bell rings till she's clear."
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
  - Mochi: "Last leg, team. The depot's right behind this place!"
- **Flags:** opens: diner back door

**1.11 · `reach` · Brute**
- **Where:** Depot Square, an open lot in front of the Transit Depot fence with a guard booth by the gate. The Brute is **Gerald**, the depot's night gatekeeper, in a huge hi-vis vest.
- **HUD:** `Reach the Transit Depot`
- **Radio:**
  - Dot: "Oh no. That's Gerald from the night gate. Gerald, honey, you've let yourself go."
  - Mochi: "BIG one! Spread out and keep shooting!"
- **Flags:** brute

**1.12 · `use` · Gate**
- **Where:** The gate switch inside Gerald's guard booth.
- **HUD:** `Open the depot gate`
- **Radio:**
  - Dot: "Gate switch is in Gerald's booth. Sorry, Gerald."
  - Taro: "Gerald and I shared a thermos most nights. Sleep well, big fella."
- **Flags:** opens: depot gate

**1.13 · `use` · Crescendo 3 (finale)**
- **Where:** Depot maintenance bay. Hospital Shuttle No. 4 sits on the floor, and its ignition is at the driver's seat. The bay roller door faces the street.
- **HUD:** `Start the hospital shuttle`
- **Radio:**
  - Dot: "Shuttle No. 4's battery is moody. Crank her and keep her company a while."
  - Pip: "Why do all the vehicles have moods?"
  - Dot: "Because they're old, sweet pea. Like me."
- **Flags:** horde · holdout 75 s · opens: bay roller door, shuttle door

**1.14 · `gather` · Chapter end (vehicle)**
- **Where:** Aboard Shuttle No. 4. The bus interior is the end zone.
- **HUD:** `Everybody on the shuttle!`
- **Radio:**
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
| 6 | Whiteboard in the depot maintenance bay | NIGHT ROTA: Dispatch, Dot. Gate, Gerald. Shuttle 4 battery is moody, warm her up! Birthday card for Dot's girl Wren by the kettle. SIGN IT. |
| 7 | Birthday card on the depot table | Happy birthday, Wren! Love from your mum and the whole night shift. (Signed: Dot, Gerald, and a very smudged thermos ring.) |

**Map designer notes:** Snoozle billboard at the 1.2 crosswalk as the first landmark. A slipper-and-pillow trail runs from the laundromat toward Tony's. Lit windows appear only where someone was awake (a gamer bedroom, the diner). The garage is dark: lamps only mark the ramps. City Hall's fog machines should be visible from the viewpoint pier and keep emitting particles. Put a stopped 3:00 clock in Clocktower Corner. Leave a signed birthday card on the depot table next to the whiteboard.

---

### Chapter 2: Visiting Hours

**Subtitle:** St. Marigold Hospital & Bayside Galleria
**Setting:** An interior complex on four real storeys. Ground (storey 0): triage and the ambulance bay, ER, waiting room, main lobby, gift shop, pharmacy, the staff corridor and staff rooms, the staff elevator lobby and fire stairs; across the bay inlet, the Galleria's arcade, security office, food court atrium and loading dock. Floor 2 (storey 1): the hospital wards, day room and soup kitchen, the lower roofs over the ER and lobby, Bun Bun Toys and its stockroom, the mezzanine ring over the food court, and the dock catwalk. Floor 3 (storey 2): the Dreamwell Sleep Clinic, the skybridge terrace on the east wing's roof, the glass skybridge, and the Galleria upper concourse with its old ballroom. Roof (storey 3): the helipad, with roof-access huts where the stair cores come up.
**Mood:** 4:40 a.m. Flickering mint-and-white fluorescents and red emergency strips. The mall is dim pastel pink and lemon, with dark shopfronts.

**Intro card:**
> 4:40 a.m. The shuttle got you to St. Marigold Hospital, mostly in one piece. Dot says a helicopter is waiting on the roof. Nori used to work nights here and swears the second floor always smells like soup. The beds are empty. Every one of them is neatly made.

**Requirements check:** start safe room 2.1 · checkpoints 2.6, 2.10 · crescendos 2.4, 2.8, 2.13 · collect 2.3 · Brute 2.11 · finale 2.14

**2.1 · `use` · Start safe room**
- **Where:** Triage station in the ambulance bay. Shuttle No. 4 is parked nose-first through the bay doors, and the triage radio sits on the nurse's desk. Optional: two fire-escape ladders up the bay's south wall lead onto the ER roof (storey 1), Larry's smoke-break ledge, a sniper perch over the bay with a note.
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

**2.3 · `collect` (4 keycards) · Sweep**
- **Where:** Ground-floor staff areas: on-call room (under a pillow), nurses' station, pharmacy counter (Nori's old desk), radiology.
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
- **Where:** Up the fire stairs to the Floor 2 east hall (storey 1), where the elevator sits stuck. West the length of corridor A, past the wards and the day room where the soup is, to the west stair hall, then up to Floor 3 (storey 2), the Dreamwell Sleep Clinic: rows of empty, perfectly made sleep pods (one gap where bed 20 got up and left), sheep murals on the walls, and a wall clock stopped at 3:00.
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
- **Where:** The skybridge terrace, one floor down (storey 2) on the roof of the east wing, reached from the helipad by an outside flight of stairs or a ladder against the tower wall. Shutter control panel at the hospital end of the skybridge, with a long glass corridor on the far side. The horde boils up the roof-access huts from Floor 2 and the ladders from the lobby roof. HVAC units, a container and crates make imperfect cover, and a sniper and launcher wait here for the long roof sightlines.
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
- **Where:** Mall security office, through the glowing Star Arcade (under the toy store). Breaker panel on the back wall.
- **HUD:** `Restore power in Security`
- **Radio:**
  - Dot: "The loading dock lift needs power. Breakers are in Security, past the arcade."
  - Pip: "Past the ARCADE?"
  - Nori: "No."
- **Flags:** opens: loading-dock corridor door

**2.13 · `use` · Crescendo 3 (finale)**
- **Where:** Loading dock, at the freight lift call button. The dock is wide and open, with truck bays that sleepers pour through. A catwalk along its north wall (storey 1), up a ladder at the west end or stairs at the east end, is a sniper perch over the finale.
- **HUD:** `Call the freight lift`
- **Radio:**
  - Mochi: "Slowest lift in the world. Everybody face out!"
  - Nori: "And Pip, do not hum along to the music."
- **Flags:** horde · holdout 90 s · opens: lift gate

**2.14 · `gather` · Chapter end**
- **Where:** Inside the freight lift. It's the end safe room and descends to the service tunnel.
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

**Map designer notes:** Drag IV stands and wheelchairs along corridor A toward the west stairs as direction arrows. Make the helicopter tail in the skylight visible from the skybridge so it works as a landmark pulling players to the food court. Stack Snoozle plush displays in the toy store. Give the arcade "INSERT COIN" glow a strong colour so it leads to Security. Use soup-coloured lighting on the Floor 2 sign.

---

### Chapter 3: Night Freight

**Subtitle:** Mallow Bay Rail Yard & Docks
**Setting:** Industrial waterfront on three storeys. Switchman's hut at the tunnel mouth, a switching yard with signal gantries, a water tower, the yardmaster's office, a container maze and crane yard. Then the Dreamwell Hush Works plant (tank farm, lavender tanks, mixing floor, second-floor labs, break room), the loading yard, a pier walkway, the drawbridge control tower, and the dock siding where Bertha waits. Storey 1 holds the yardmaster's office (a cabin on stilts, front stairs up and back stairs down), the 2F labs and break room over the mixing floor (up the main or back stairs, with a fire escape down to the loading yard), and ladder perches: the boxcar roofs in the stopped freight train, the water-tower deck, two container stack tops, the tank-farm valve catwalk and the wharf stack at the siding. The control tower is stacked: hall (storey 0), switchgear (storey 1), control room (storey 2).
**Mood:** 5:20 a.m. Sodium-orange lamps, rust-red and teal containers, black water, thick lavender fog rolling off the river.

**Intro card:**
> 5:20 a.m. No helicopter, but Dot knows trains. Old Bertha, a diesel locomotive older than Taro, sits dry on the dock siding, and the hill line runs straight out of town. Between you and her: a rail yard, a lot of fog, and the factory where the fog comes from. Someone else is on the radio now. Humming.

**Requirements check:** start safe room 3.1 · checkpoints 3.4, 3.9 · crescendos 3.3, 3.8, 3.13 · collect 3.5 · Brute 3.7 · finale 3.14

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
- **Where:** The big hill-line switch lever at the foot of the water tower, in the exposed middle of the yard. The tower's pump house carries a deck round the tank (storey 1), up two ladders: a perch over the arena with a sniper, though the sleepers climb both ladders too.
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
- **Where:** North up Dock Road to the Dreamwell Hush Works gate. Giant lavender tanks carry the Snoozle logo, and fog leaks from the valves. Optional: a valve catwalk on stilts between the two tank rows (storey 1), a ladder at each end, is a sniper perch over the tank farm.
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
- **Where:** Up the main stairs to the second-floor labs (storey 1, over the mixing floor) and Wren's lab. The download runs at terminal four, under walls covered in sound-wave charts. Sleepers come up both stairwells, the main stairs and the back stairs by the lockers.
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

**3.12 · `reach` · Find Bertha**
- **Where:** Back down the tower and over the drawbridge to the dock siding. Bertha is a stubby chibi diesel locomotive in cream and cherry red, with a flatcar coupled behind her.
- **HUD:** `Get to Bertha on the dock siding`
- **Radio:**
  - Taro: "Bridge is down. Back downstairs, everyone."
  - Dot: "There she is. Bertha! Hello, old girl."
  - Taro: "She's older than me. I like her already."
- **Flags:** none

**3.13 · `use` · Crescendo 3 (finale)**
- **Where:** Bertha's cab. Pour the diesel and crank the engine. The siding is an open apron with containers on both sides for flanking. The wharf stack (storey 1), one ladder at each end, is a perch over the crank, but the horde climbs both ladders and the Brute comes up too.
- **HUD:** `Fuel up and start Bertha`
- **Radio:**
  - Dot: "Prime her, crank her, and hold on. Bertha takes her time and so should you."
  - Pip: "Two minutes?! Dot, that's like a WEEK."
- **Flags:** horde · holdout 120 s (scripted: waves with breathers, a Brute midway, then the big rush) · opens: cab door

**3.14 · `gather` · Chapter end (vehicle)**
- **Where:** Bertha's cab and the coupled flatcar.
- **HUD:** `All aboard Bertha!`
- **Radio:**
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

**Map designer notes:** Twelve empty tanker cars on a siding labelled HX-9, with one bay left bare. Put a "DAYS SINCE INCIDENT: 0" sign on the Hush Works gate. Run a fog-leak trail from the tanks to the river. Pin sound-wave charts and a child's drawing ("To Wren, from Mum") in the lab. Make the tower's lit window visible across the water from the pier so the destination reads before the radio line plays.

---

### Chapter 4: Morning Bell

**Subtitle:** Pinecone Hollow & Pinecone Hill
**Setting:** Suburb into forest edge. Pinecone Hollow station, Maple Loop and Birch Court cul-de-sacs, fenced backyards, a prepper basement, Pinecone Elementary's schoolyard, the creek culvert with its flood gate, a pine forest trail, a ranger cabin, the Pinecone Hill switchbacks and transmitter compound, the downhill road, and the old river bridge with an army boom gate. Storey 0 is the valley floor. Storey 1 is the rock shelf of Pinecone Hill: the Hill Steps climb onto it from the foot of the switchbacks, and the upper switchbacks, the fire road, the hilltop compound and the first half of the downhill road sit on it, until the Old Stone Steps drop the road back to the valley. Storey 2 is the transmitter deck on the control shed's roof, where the Bell is rung, and the fire lookout's cab. Ladder side trips: the treehouse on the school path, the fire lookout, and the army watchtower over the boom gate.
**Mood:** 6:05 a.m. moving to sunrise. Peach-gold sky, long blue shadows, lavender mist thinning in the pines. The last two steps are in full warm sunlight.

**Intro card:**
> 6:05 a.m. Bertha ran out of track at Pinecone Hollow. Dot is driving the No. 9 bus to the old bridge to meet the last convoy at sunrise. But the voice on the radio says the sleepers will follow you all the way out, unless someone rings the Morning Bell from the top of the hill.

**Requirements check:** start safe room 4.1 · checkpoints 4.4, 4.8 · crescendos 4.6, 4.10, 4.12 · collect 4.3 · Brute 4.5 · finale 4.13

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

**4.9 · `reach` · Summit**
- **Where:** East along the foot of Pinecone Hill and north to the Hill Steps, which climb onto the rock shelf (storey 1). Then the switchbacks west, north and east to the hilltop, with long uphill sightlines. A fire road loops off toward the hilltop past the fire lookout, a timber tower with one ladder up to its cab (storey 2), an optional sniper perch that sees over the rocks to the compound. The goal is the Pinecone Hill transmitter compound: a fenced concrete yard, the radio mast, and the control shed with Wren visible behind a reinforced window.
- **HUD:** `Reach the transmitter on the hill`
- **Radio:**
  - Wren: "I'm behind the glass. Locked myself in. The console's up on the deck, by the mast."
  - Pip: "She's real! Hi, radio lady!"
- **Flags:** none

**4.10 · `use` · Crescendo 2 (the Bell)**
- **Where:** The transmitter console on the transmitter deck, the control shed's roof (storey 2), round the foot of the mast. The way up is a steel stair flight from the west yard plus two ladders on the shed's north and east walls: the horde's three routes up. Cable drums and sandbags give imperfect cover, with a firing lane on every route. Ringing the Bell sends a slow, warm chime across the valley.
- **HUD:** `Ring the Morning Bell`
- **Radio:**
  - Wren: "When it rings, they'll come. Then they'll lie down. Hold until it takes."
  - Mochi: "Hold the deck, team. Watch the stairs and ladders. Last delivery of the night!"
- **Flags:** horde · holdout 120 s · opens: compound gate to the downhill road

**4.11 · `reach` · Aftermath (quiet beat)**
- **Where:** The downhill road at sunrise, along the shelf (storey 1) and then down the Old Stone Steps to the valley floor, past Pell's empty limo to the army checkpoint plaza by the old bridge. Sleepers lie curled up along the verges as non-hostile props, with little "Zzz" particles.
- **HUD:** `Head down to the old bridge`
- **Radio:**
  - Nori: "They're lying down. Breathing. Just... asleep."
  - Pip: "Night night, everybody."
  - Taro: "Sleep well. We'll come back for you."
- **Flags:** none

**4.12 · `use` · Crescendo 3 (finale)**
- **Where:** The army boom-gate control at the near end of the old bridge. Sleepers from across the river, outside the Bell's range, still pour in through Bridge Park. Dot's No. 9 bus is visible on the far span. A sandbagged watchtower in the plaza's corner (storey 1), with a ladder on two faces, is a sniper perch over the gate.
- **HUD:** `Raise the bridge boom gate`
- **Radio:**
  - Dot: "I can see you! Get that boom gate up and get on my bus!"
  - Wren: "The far bank's out of range. They're still coming. Hold them!"
- **Flags:** horde · holdout 90 s · opens: boom gate, bus door

**4.13 · `gather` · Campaign end (vehicle)**
- **Where:** Aboard Dot's No. 9 bus on the bridge.
- **HUD:** `Everybody on Dot's bus!`
- **Radio:**
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
| 5 | Taped inside the transmitter shed window | Mum, if you're reading this, I'm fine. I'll ring it every morning until I know how to wake them. Save me a seat on the No. 9. W |
| 6 | Back seat of an empty white limo by the bridge | Gift tag: "G. Pell, Executive Rest Kit: silk eye mask, HX-9 Pillow Mist (complimentary)." The kit is open. The limo is empty. |

**Map designer notes:** Snoozle billboards here are graffitied "WAKE UP". The Bell's chime should read visually as soft gold rings expanding from the mast during 4.10. After 4.10, swap ambient zombies on the downhill road for sleeping props. The No. 9 bus on the far side of the bridge should be visible from the boom gate, so the goal is on screen during the last holdout. Put Pell's limo on the verge just before the bridge.

---

## 3. Chapter transitions

- **1 → 2:** Taro drives Shuttle No. 4 across town and "parks" it nose-first through St. Marigold's ambulance bay doors.
- **2 → 3:** The freight lift drops into the Galleria's service tunnel, which runs under the river and comes up at the rail yard's switchman's hut.
- **3 → 4:** Bertha climbs the hill line through the fog until a fallen pine stops her at Pinecone Hollow station, just as the sky starts to pale.
- **Epilogue:** The No. 9 crosses the bridge into the sunrise while the Morning Bell rings over a sleeping valley, and on the radio Wren hums a morning song this time instead of a lullaby.
