# Formation Impulse: the ruleset

The game's real ruleset, `docs/rules/rules-v1.md` at **revision 2** (transports as units, close assault
by several units together, overrun), on the kernel's `Ruleset` interface (`engine/kernel/ruleset.ts`),
built for Milestone 2a package A (`docs/bars/M2a.md`). Every number is data; the code knows no side,
nation or unit by name.

## How to build a match

```ts
import { loadImpulseMatch } from '../engine/rulesets/impulse/load';
const { content, problems } = loadImpulseMatch({ scenario, rules, units, map });   // each { file, text }
content.ruleset     // the ruleset: an ImpulseRuleset, the kernel's Ruleset<S, A, E, V, Q>
content.refs        // { ruleset, scenario, map }: id, content hash and file, as a record pins them
```

`loadImpulseMatch` (load.ts) is the one function that builds a match's ruleset from the four texts. It
checks each by its own format. A scenario pins its map by id and content hash, and names its rules data
and its unit file by id alone (the lead's ruling on round 1): a map other than the pinned one is refused
naming the file and both content hashes; a unit file or rules data whose id is not the one named is
refused naming the file, both ids and the given file's content hash. An optional `{ board }` reuses a
compiled board: it is held to the map given (which is held to the scenario's pin) by the map's content
hash, and to the rules data's terrain by the terrain's content hash; a board of another map, the same id
included, or of other terrain data is refused naming the scenario file and both hashes (the lead's
ruling 70, point 1). Where files are, by
convention: `content/rulesets/<id>.ruleset.yaml`, `content/units/<id>.units.yaml`,
`assets/maps/<id>.map.yaml` (`rulesFileFor`, `unitsFileFor`, `mapFileFor`).

### What a match's record holds of the four texts

A record made with the kernel's `recordOf` and `content.refs` holds three references, each
`{ id, hash, file }`:

| Reference | id | hash |
|---|---|---|
| `ruleset` | the rules data's `id` | `contentHash({ rules, units })`: the rules data **and the unit file** together |
| `scenario` | the scenario's `id` | `contentHash(scenario)` of the checked scenario (it names the unit file's and the rules data's ids) |
| `map` | the map's `id` | `mapHash(map)`, the content hash the scenario pins |

The unit file has no reference of its own: its id is in the scenario (so in the scenario's hash) and
its content is in the ruleset's hash. `replayFromActions` and `replayFromEvents` (the kernel's) take a
ruleset already built and compare state hashes; they do not compare these references with the content
the ruleset was built from. Whether a replay must refuse a record made on other content is the lead's to
rule (the lead asked for this paragraph so as to rule on it).

## Files

| File | What |
|---|---|
| `types.ts` | state, view, actions, events, the outcome query, the preview and branch types |
| `data.ts` | the rules data (`format: impulse-ruleset/1`) and its check |
| `units.ts` | the unit file (`format: impulse-units/1`) and its check |
| `scenario.ts` | the scenario (`format: impulse-scenario/1`) and its check |
| `load.ts` | building a match's ruleset from the four texts |
| `rules.ts` | the ruleset: validate, apply (by events), reduce, the legal list, outcomes, the search interface, the preview, views, the event schema, invariants, the hash |
| `table.ts` | the fire table, the one routine that resolves an attack, and the rollers (the match's dice, or every way the dice can fall) |
| `paths.ts` | the least exposed path: an exact search over (hex, cost spent) |
| `seen.ts` | a cache of the board's sight answers by distance (it walks no line itself: ruling 21) |
| `index.ts` | what other code imports |

## The three formats

- **Rules data** (`impulse-ruleset/1`): `format`, `id`, every key of spec section 19 (revision 2 adds
  `assault.support`, `overrun.steps`, `overrun.cost` and `cover.<type>.overrun`; rulings 74 to 77 of
  2026-11-13 add `assault.targets`, `assault.vsHard`, `assault.coverVsHard` and the group `moveFire`:
  see "Rulings 74 to 77" below), and the terrain data
  `moverTypes`, `movement`, `sight` in the reference ruleset's shape. Every key required, no unknown key,
  nothing defaulted.
- **Unit file** (`impulse-units/1`): `format`, `id`, `types`, each type with `id`, `name`, `kind` (tank,
  assault_gun, self_propelled_gun, towed_gun, mortar, infantry, truck, half_track, wagon), `count`, `ap`,
  `he`, `range`, `defense`, `class`, `move`, `mover`, `close`, `cost`, `assaults`, `overruns`, `rides`,
  `carries`, and `indirect: { minRange }` on batteries only. All four of the last keys are required
  (2.1: all four are given for every type); `carries` is 0 or 1 (anything else is refused); a type that overruns has `he`
  above 0, one that assaults has `close` above 0, a transport does not ride, and a type with `move` 0 has the
  mover type `towed` (2.1; ruling 70, point 10: refused naming the type and `mover`). A `mounted` key is an
  unknown key.
- **Scenario** (`impulse-scenario/1`): see `scenario.ts`'s header. A unit has `hex` or `carriedBy` (the id
  of the transport of its own side that carries it at the start), exactly one (4.1). Refused: neither or
  both; a `carriedBy` that names no unit, the unit itself, a unit of the other side, a unit whose type
  carries nothing, or a transport another unit also names; a carried unit whose type does not ride; a
  formation with fewer than two or more than five units that are not transports, more transports than
  units that can be carried, or a transport listed before a unit that is not one (3.1); a unit starting
  in a hex its mover type may not enter (4.1, the lead's ruling on round 1): a hex into which no step
  from a hex beside it is open to that mover type on the compiled board (`enterableHexes` in
  `scenario.ts`: cover, rivers, roads and hexsides all count, so a river hex is closed to a tank and a
  swamp hex a road crosses is open to a truck); a set-up with more units in a hex than `stack.limit`, or,
  in a scenario with free deployment, a unit set up outside its side's zones (4.2 as amended by ruling 70,
  point 2: "The scenario's own set-up must itself place every unit inside its side's zones and within the
  stacking limit"; both refusals name the unit and the hex); an objective without a `holder` (15.1). The
  ruleset's `place` and the deployment list read the same table.

## Types

- **State** `ImpulseState` (`format: 'impulse/1'`): stage (`deploy`, `play`, `over`), turn, initiative,
  firstInitiative, impulse (whose impulse it is), roll (the next roll number), bought, activation
  (`{ kind, side, formation, unit, inCommand }` or null), units (`{ hex, destroyed, spent, moved,
  suppressed, carriedBy, revealed }`; `moved` is the Moved state of spec 6.8, never true with `spent`), formations (`{ units, discipline, leaderLosses, commandRange, activated }`),
  sides (`{ orders, score, lost, lostThisTurn, startCost, passed }`), missions (`{ battery, hex, kind,
  due }` in the order called), smoke, holders (per objective: the holding side or -1), deployment
  (`{ placed, finished }` per side, or null), result (`{ winner, reason }` or null).
- A unit is **on the board** (`hex` a hex number, `carriedBy` -1), **carried** (`hex` -1, `carriedBy` the
  transport's index: 14.4, it has no hex) or **destroyed** (`destroyed` true, `hex` -1, `carriedBy` -1).
  `revealed` is the turn of its latest reveal, or 0. Who carries whom is in the state and in the hash.
- **View** `ImpulseView` (`format: 'impulse-view/1'`): the same fields, plus **`viewer`** (the seat, or
  null for a spectator), the one field in which the views differ after the start. During a free
  deployment the other side's `deployment.placed` and `deployment.finished` are null.
- Units are numbered from 0 in the order of spec 2.4 (a unit's spec number less one), formations
  likewise, sides 0 and 1; hexes are hex numbers (`row * cols + col`), -1 for none.
- **Outcome query** `OutcomeQuery`: `{ seat, action }`, any action of any seat.

### Actions (spec 17): the eighteen, exactly

| Action | Shape |
|---|---|
| `place` | `{ type, unit, hex }` |
| `unplace` | `{ type, unit }` |
| `submit`, `takeSetup` | `{ type }` |
| `land` | `{ type }` |
| `activate` | `{ type, formation }` |
| `activateUnit` | `{ type, unit }` |
| `activateSide` | `{ type }` |
| `pass` | `{ type }` |
| `discipline` | `{ type, formation, setting }`, setting `free`, `armor` or `hold` |
| `fire` | `{ type, firers: unit[], target }` |
| `move` | `{ type, unit, path: hex[] }` (the hexes entered, the start left out; at least one) |
| `assault` | `{ type, units: [{ unit, path: hex[] }, ...], target, advance: unit[] }`: the units in the order the assault makes their paths (12.2), each path possibly empty; `target` a unit; `advance` the units named to advance, in the order named (12.5), possibly empty |
| `overrun` | `{ type, unit, path: hex[], target }`: `target` is the **target hex** (12.7); the path ends beside it (empty when the unit is beside it); the exit hex is not sent, it follows from the path |
| `mount` | `{ type, unit, transport }` |
| `dismount` | `{ type, unit, hex }` |
| `mission` | `{ type, unit, hex, kind }`, kind `he` or `smoke` |
| `end` | `{ type }` |

No other key is accepted (`malformed`), at the top or in a unit of an assault; nor a firer listed twice,
a unit named twice in one assault, or a unit named twice to advance (`malformed`).

### Events (spec 18): every event, exactly

| Event | Shape |
|---|---|
| `placed` | `{ side, unit, hex }`, hex null for an unplace; seen by its own side only |
| `submitted` | `{ side, setup }`, setup true for takeSetup; seen by its own side only |
| `deployed` | `{ hexes }`: every unit's hex, by unit index (the reveal); -1 for a unit that starts carried |
| `impulse` | `{ side, orders, due }`: an impulse begins; `due` the batteries whose missions became due as it began |
| `activated` | `{ side, formation, unit, whole, inCommand, orders }`: a formation, a unit alone, or the whole side (whole) |
| `activationEnded` | `{ side }`: by `end`, or by itself (5.7) |
| `passed` | `{ side, orders, buys }`: orders held after; buys the initiative under `bought` |
| `disciplineSet` | `{ formation, setting }` |
| `moved` | `{ unit, path, stopped, hex, cost, after }`: the hexes actually entered, whether stopped, where it stands after (8.6, or 12.2's put-back, may put it back), the cost of the path entered, and `after`: `'moved'` when the move leaves the unit Moved (6.8), `'spent'` otherwise |
| `reaction` | `{ reactor, mover, hex, column, rolls, dice, result }` |
| `fired` | `{ firers, target, column, rolls, dice, result }` |
| `assaulted` | `{ units, target, column, rolls, dice, result, advanced }`: `units` the units that arrived (12.2), in the assault's order; `advanced` the units that entered the target's hex, in the order they entered |
| `overran` | `{ unit, target, exit, attacks: [{ unit, column, rolls, dice, result }] }`: target and exit are hexes; one attack per unit attacked, in unit order; the unit stands in the exit hex after it, Spent |
| `suppressed`, `recovered` | `{ unit }` |
| `destroyed` | `{ unit, cost, leader }`: leader when it led its formation (3.4) |
| `revealed` | `{ unit, until }`: Revealed until the end of turn `until` |
| `mounted` | `{ unit, transport }`: the unit leaves the board, carried, Spent |
| `dismounted` | `{ unit, hex }`: the unit stands in `hex`, Spent; reaction shots there follow |
| `setDown` | `{ unit, hex }`: a passenger of a destroyed transport stands in `hex`, Suppressed (14.6) |
| `missionCalled`, `missionLost` | `{ battery, hex, kind }` |
| `missionLanded` | `{ battery, hex, kind, attacks: [{ unit, column, rolls, dice, result }] }` |
| `smoke` | `{ hex, placed }` |
| `objective` | `{ hex, holder }` |
| `scored` | `{ side, objectives, kills, total }` |
| `turnEnded` | `{ turn, initiative }`: steps 5 to 7 of the end phase; `turn` the turn that ended |
| `ended` | `{ winner, reason }`, reason `break`, `sudden death` or `turn limit` |

`result` in an attack is the effect on the target after 7.7 (a second suppression reads `destroyed`);
`rolls` are roll numbers and `dice` the faces, both empty when the attack was not rolled (7.6).
`activationEnded`, which round 1 added, is in spec 18 since revision 2 (the lead's ruling on round 1).

**Order of events.**

- A move: `moved` (the path actually entered), the mover's `revealed` (6.6) if any, a `destroyed` for
  each empty transport without firepower in a hex the mover entered (14.7, a combat mover only), then each
  `reaction` with the reactor's `revealed` and the mover's `suppressed` or `destroyed`; then, if the mover
  was a transport destroyed with a unit aboard, that unit's `setDown`. The animation reads where each shot
  fell from `reaction.hex`.
- A dismount: `dismounted`, then as a move from the mover's `revealed` on.
- A close assault: each path in turn as a move (its own `moved` and shots); then, if any unit arrived,
  `assaulted`, a `revealed` for each unit that arrived, the effects (`suppressed` for each of them on no
  effect, else the target's `suppressed` or `destroyed`), a `setDown` if the target was a loaded transport
  destroyed, and a `destroyed` for each empty transport in the hex entered by the advance.
- An overrun: its path as a move; if it arrives beside the target hex, its `revealed` (12.11), a
  `destroyed` for each empty transport in the target hex, `overran` (the attacks), their effects, the
  `setDown` of any passenger of a transport destroyed there (12.12), a `destroyed` for each empty transport
  in the exit hex, then the shots planned at the exit hex by reactors still able to fire (12.10).
- Fire and a landing mission: the attack event, the firers' `revealed` (fire), the effects, then any
  `setDown` (14.6: when the attack, or the mission, is over).
- A landing (5.4): every mission due lands, in the order called, each as above, whatever has become of
  either side meanwhile (ruling 70, point 8); a mission whose battery an earlier one of the landing has
  hit is lost (13.4). Only then is 15.3 judged: an `ended` with reason `break` when a side has no combat
  unit left; when neither has, both have broken and the higher score as it stands wins, a tie going to
  the side that did not have the initiative on turn 1 (15.5; 15.3 as amended). The same holds after any
  action, a landing being the one that can empty both sides (a battery hit by its own side's mission).

## How it is built

`apply` checks the action (`validate`, which also makes the reaction plan of a move, a dismount or an
overrun), then resolves it on a copy of the state (`execute`) by emitting events, each reduced onto the
copy as it is emitted; `reduce` replays recorded events with the same reducer and asks no die. Every
attack (fire, a reaction shot, an assault, each attack of an overrun or of a mission) goes through
`table.resolveAttack` with a `Roller`: `DiceRoller` (the match's dice) in `apply`, `BranchRoller` (every
way the dice can fall) in `outcomes`, `branches` and nowhere else. So the exact distribution and the
resolution are one code (rulings 5, 16). The paths of a close assault are planned one at a time as each
one's turn comes, by the same `plan` a move uses (12.2): a reactor that fired at an earlier unit is Spent
for the later ones (8.7).

### Exact outcomes (spec 17), and how `result` is read off an apply's events

`outcomes(stateOrView, { seat, action })` runs the action's resolution once for every way its attacks
can fall (each attack's effect, with its number of dice values), and groups the runs by `result`:

> `result` = `outcomeKey(events)`: the effect of every attack of the action, in the order of its
> events, each `reaction R: effect`, `fire: effect`, `assault: effect`, `overrun on U: effect` (one per
> attack of an `overran`) or `mission B on U: effect`, joined by ` / `; `-` for an action with no
> attack. (An empty transport destroyed by 14.7 is not an attack: it is not rolled and not in `result`.)

Each outcome's `of` is a power of the dice faces: `faces ** (dice a roll × the most rolled attacks of
any run)`, a shorter run counting once for every value of the dice it did not ask for (cases file,
section 2), with common factors of the faces taken out. Past 2^53 (more than ten rolled attacks in one
action, which only cap `none` can reach) `ways` and `of` are rounded; `p` stays exact to the float.

### The search interface (ruling 16), the preview (8.8)

`branches(view, action): Branch<ImpulseView>[]`, each `{ ways, of, p, view }`: every way an action of
the view's seat (`view.viewer`) can turn out, with the seat's view of the position that results, equal
views put together. It reads the view alone (after the start a view holds everything) and resolves with
`execute`, as `apply` does. The views are new data.

`preview(stateOrView, seat, action): ReactionPlan[] | null` is what a player is shown before committing
(8.8): for a move, a dismount or an overrun one plan; for a close assault one plan for each of its units
in the order the assault lists them, each made on the position the earlier units' paths leave where no
shot has any effect (a unit with an empty path has a plan with no shots). Null for an action that is
not a legal one of these. A plan is `{ unit, path, shots: [{ reactor, step, hex, column, effect,
destroy, of }] }` in firing order; `path` is the hexes the mover enters: for an overrun its path, then
the target hex (never fired at, 12.10), then the exit hex, whose planned shots come after the attacks.
`planPath(stateOrView, unit, path)` gives the plan of a unit setting out on a path from where it stands,
the same code (the bar's M2a-A-18 judges an assault's later paths by it on the state the earlier moves
left in each branch). The cases' `reactions` are compared with the preview's shots, plan by plan.

### Ties left to the builder (ruling 22) and other fixed orders

- **Two least exposed paths equal in exposure and cost**: the first found by the search of `paths.ts`,
  which takes costs in increasing order, at each cost the hexes in the order first reached at that
  cost, and from each hex the directions N, NE, SE, S, SW, NW; a later path replaces a kept one only
  when it enters strictly fewer exposed hexes.
- **The cheapest path**: `routeTo` of the core path search's flood (spec 17), with enemy-held hexes
  blocked (for a combat unit, a hex of nothing but empty transports without firepower is open, 14.7)
  and the allowance as its limit.
- **A mission's attacks on the units of one hex** (13.5) and **an overrun's attacks** (12.9): in unit order;
  each asks its own dice.
- **A passenger set down** (14.6): in the hex where its transport was destroyed; if it may not stay
  there, the last hex its transport passed, back along its path, then the hex it set out from.
- **The order of the legal list**: fixed (activations, pass; per unit: moves, overruns, mounts or
  dismounts, missions; then close assaults by target; fire; end; discipline), so the same view always
  gives the same list.

### The legal list (spec 17)

Asked of a view. **Moves**: for each hex a unit can reach, the cheapest path and, where it is more
exposed, the least exposed (exposure judged by 8.2 and 8.3 hex by hex, the mover as it sets out; no hex
is exposed for a mover with no firepower that carries nothing); a hex reachable only by 6.2 has its
one-hex path. **Close assaults**: for every target and every set of units of the activation that may
assault it together, the set's units in unit order: once with each unit by its cheapest approach (the
cheapest path to a hex beside the target within its share, or the empty path when it is beside it, or
6.2's one hex) and, if any unit's least exposed approach differs, once with each unit by its least
exposed; each of these twice, with every unit of the set advancing in the set's order and with none. A
unit's approach is chosen among those whose end hex still has room when the units before it in the set
have taken theirs (6.4, 12.2): each unit in turn by its best approach (cheapest, or least exposed) with
which every later unit of the set can still be given one, so an earlier unit takes its next best only
where that lets a later one in (a unit beside the target in a full hex steps to another hex beside it
so that the next takes its place); a set for which no choice of approaches fits, in unit order, is not
listed in unit order. Such a set is then listed in the first order of its units that is legal, the
orders taken in the order of the units' numbers (the lead's rulings 69 and 70, point 6): `firstOrder`
finds it without walking the orders one by one. A position of its search is which units have been given
an approach and how many units each end hex has gained or lost; it answers once, for each position,
whether the units left can all still be given one, and builds the order from the front, at each place
the lowest-numbered unit with which some position reached stays open. Its work is bounded by the
positions, at most the product over the set's units of one more than each unit's end hexes (at most
seven: where it stands and the six hexes beside the target), never the factorial of the set's size; it
runs only for a set that fits in no way in unit order, after `roomFor` has turned away a set too large
for the hexes its units could end in. A set that fits in no order is not listed.
No approach enters the target's own hex: where the target is an empty transport without firepower
(its hex open to a combat unit, 14.7), the approaches are the cheapest and least exposed paths that
keep out of it (`approachesAvoiding`; such a path is refused, below). Sets are left out only
when they are illegal (outside `support.within`, or a column that cannot suppress): spec 17 asks for
every set, so no dominated set is dropped as fire's are. **Overruns**: every target hex and every hex
beside it from which an overrun is legal, by the cheapest path to that hex and, where it differs, the
least exposed (or the empty path from the unit's own hex), each among the paths that enter neither the
target hex nor the exit hex (6.7): where the unit's own cheapest or least exposed path to the hex runs
through the exit, the two searches are made again with it closed (`approachesAvoiding`). **Mounting**: every transport the unit may
mount. **Dismounting**: every hex it may dismount into (the transport's hex, then its neighbours N to
NW). **Fire**: every legal set of firers for every target, but a set when one of fewer of the same
firers gives the same chances (the same distribution of effects on that target). The walk over larger
sets stops at a set whose chances are those of the highest column any set of the target's candidates
could reach (no larger set can then do more), under any fire table the data check admits: not at a set
whose effect is merely the same on every roll, which under thresholds further apart than the dice reach
(a set certain to suppress, a larger one able to destroy) dropped legal sets (ruling 70, point 5). **Missions**: every hex
within range and observed, both kinds. **Discipline**: every other setting of every own formation.

## Rulings 74 to 77 (2026-11-13): a close assault is made on armour; armour may move, then fire

What changed in this package, for whoever wires a client to it. The reasons, the tables and the measure are in
`docs/review/M2b/assault/README.md`.

- **`assault.targets`** (`hard` | `any`; ships `hard`). Under `hard` a close assault may be declared only on a unit of class
  Hard: `validateAssault` refuses any other target with the code **`assault_target_soft`**, whose detail begins "a close
  assault is made on armour". The check comes after the checks of the assaulting units and of the target's being an enemy
  unit on the board (so a carried target is still `target_carried`) and before every check of paths and columns. The legal
  list offers no assault on a Soft unit. `mayBeAssaulted(unit)` is public.
- **`assault.vsHard`** (a whole number; ships -1) is added to a unit's own column when the target is Hard, and
  **`assault.coverVsHard`** (-1, 0 or 1; ships 0) is how many times the close cover of its hex is taken from that column
  when the target is Hard (a Soft target always has it once). `assaultColumn(position, unit, target)` is the one place;
  the stand-in opponent reads it.
- **`moveFire`** (`{ class: none | hard, moveShare, steps }`; ships `hard`, 0.5, -1). A unit state has **`moved: boolean`**
  beside `spent`, in the state and in every view. A `move` action whose path cost no more than
  `floor(type.move * moveShare)` leaves a unit of the class Moved (`moved` true, `spent` false) unless reaction fire stopped
  it; the `moved` event says which in **`after`**. A Moved unit counts as able to act (the activation stays open; it may be
  activated alone if out of command), may be a firer (`ownColumn` adds `moveFire.steps` for it, which its reaction fire
  takes too) and is refused every other action of 5.7 with the code **`moved`**. Firing or reacting makes it Spent and not
  Moved; the end phase (`turnEnded`) clears it. The legal list gives a Moved unit its fire and nothing else. A list's `move`
  entries are unchanged: **`shortMove(unit)`** gives the most a move may cost and leave the unit Moved (null for a unit
  whose class has no such move), and **`moveLeaves(view, unit, path)`** answers `'moved'` or `'spent'` for any path.
- The hash text of a state has one more flag a unit (`moved`), and the rules data has six more keys: every state hash and
  ruleset hash differs from one made before these rulings.

**Rulings 80 and 81 (2026-11-14)**, spec 6.8 (rewritten), 6.9 (new), 7.1, 8.2, 12.1:
- A unit state has **`moveUsed`** (the cost of the move that left it Moved; 0 otherwise, kept after it then acts, cleared
  when it is destroyed and by `turnEnded`), in the state, every view and the hash text.
- **Moved has two kinds.** Armor after a short move (`moveFire`) may fire once, as before. A unit that can close assault
  (`assaults`), under the new key **`assault.afterMove`** (true ships; false is the rule as it was), is left Moved by a
  move that costs less than its allowance, and may make one close assault; it never fires, in its activation or in
  reaction. Either may instead **move on** within its allowance less `moveUsed` (6.2's one hex is no exception), which
  leaves it Spent (`after: 'spent'`) and draws reaction fire as any move. Anything else is still `moved`.
- **`assault.moveShare: 0`** ships (it was 0.5): a close assault moves no unit; any path is `assault_too_far` (6.2's one
  hex no exception), and the list offers only units that stand next to the target, with empty paths. Under a share above
  0 a Moved unit's assault path is paid from what is left.
- A new code, **`over_remaining`**: a move on (or a Moved unit's assault path) that costs more than what is left.
- Public: **`movedMay(position, unit)`** (`{ left, fire, assault }`, or null when not Moved), **`allowanceLeft`**,
  **`assaultsAfterMove`**; `moveLeaves` knows both kinds and answers `'spent'` for a Moved unit's move on.

## The cases (`docs/rules/rules-v1-cases.md`, revision 2: 339 cases, the seven of ruling 70, the ten of rulings 74 and 75 and the twelve of ruling 77 among them)

`tests/impulse/cases.test.ts` reads the cases file itself and runs every case by its section 2;
`tests/impulse/caseAdapter.ts` is the adapter (board, data, types, state: a unit's `hex` or `carriedBy`
becomes the scenario's set-up), `caseRunner.ts` the steps (actions in the shapes of section 2:
`units` with paths, `advance` lists, an overrun's target hex, `transport`, a dismount's `hex`; the fact
`carriedBy`; a close assault's `column` with every unit arriving; an overrun's `column` map; a close
assault's `reactions` over every path, with `mover`). The list's actions are compared whatever the order
of their keys. Every key of a case, its state, its steps, its branches, its reactions and its list
questions must be one the adapter or the runner reads (`CASE_KEYS`, `caseKeyProblems`): a mistyped key
(`outcome:`, `thenn:`, `hass:`) is reported as a problem of the case, not passed over with its check;
a `do` step has exactly one of `refused` and `legal: true`. The reasons of section 3.7 map to the ruleset's rejection codes one to one, by the same
name (`REASON_CODE` in `caseAdapter.ts`; the test reads the table of section 3.7 from the file and checks
the map holds exactly its reasons):

| Reason (cases 3.7) | Code |
|---|---|
| every one of the 47 reasons of the table (`not_your_turn` … `no_unit_can_act`, `carried` … `off_board`) | the code of the same name |

`not_your_turn` and `game_over` are kernel codes. The closed list (`IMPULSE_REJECTION_CODES`, `rules.ts`)
adds codes the cases do not use: `wrong_stage`, `wrong_profile`, `activation_open`, `unknown_unit`,
`unknown_formation`, `not_your_unit`, `not_your_formation`, `not_on_board`, `bad_target`,
`no_mission_due`, `already_placed`, `not_placed` (and the kernel's `unknown_seat`, `malformed`,
`unknown_action`). Round 1's `mounted`, `no_carriers`, `not_mounted`, `already_mounted` and `no_close` are
gone with revision 2.

## Content and tests

- Rules data: `content/rulesets/v1.ruleset.yaml`. Placeholder unit file:
  `content/units/placeholder.units.yaml` (nine plain types; a truck and a half-track, transports of their
  own).
- The test scenario: `tests/impulse/scenarios/crossroads.scenario.yaml` (on
  `assets/maps/test_standard.map.yaml`) and its free-deployment form `crossroads-free.scenario.yaml`: four
  formations a side of 3 or 4 units that are not transports (15 a side), a half-track (in the formation of
  rifles) and a truck (in the formation of guns) a side, one rifle company a side starting carried in the
  half-track; the two fronts start in contact around 2211 to 2312, so that close assaults by two units and
  overruns happen in random play.
- `npx vitest run tests/impulse`: the cases, the data checks, the keys, the paths, the refusals, the
  interface, the positions of `rules-r2.test.ts` (rules of sections 4, 12 and 14 no worked case reached:
  a path over the stacking limit, the paths made one at a time, a put-back, an impassable advance, the
  overrun's attacks in unit order, Revealed at a concealing exit, a passenger set down not Revealed, an
  empty Hard carrier, the assault path into the target's hex, the overrun and assault-set lists), the
  repairs of ruling 70 in `ruling70.test.ts` (the fire list under eleven fire tables, the assault sets
  in their first legal order with the count on positions of random games under a stacking limit of 1,
  the landing that lands every mission and the landing that empties both sides, with events, record,
  replay, exact outcomes and the search interface), and small samples of every property on every
  swept configuration (`IMPULSE_TEST_GAMES`, default 2 games a configuration).
- `keys.test.ts` (M2a-A-11 as ruling 70 restates it): one test for each of the 57 leaf keys of section
  19, in positions of its own, every expectation written in the test; each shows what the key's value
  gives and the value one less and one more (or every other option) does not, then states the value as
  section 19 gives it. A change to a key in the data file alone turns its test red.
- `refusals.test.ts` (M2a-A-15): each kind of invalid action is made where nothing else is wrong and is
  refused with its own code (`OWN_CODE` in `refusalCases.ts`) and no other (ruling 70, point 9).
- **Long runs** (the bar's sizes): `npx tsx tests/impulse/longrun.ts`, reading `IMPULSE_GAMES` (default
  1000 a configuration), `IMPULSE_CONFIGS` (e.g. `0,7`; default all sixteen), `IMPULSE_SCALE` (a factor
  on the fixed sizes of the other checks, default 1; 0.1 with `IMPULSE_GAMES=200` runs all sixteen in
  about ten minutes on a lightly loaded machine) and `IMPULSE_CHECKS`
  (`games,lists,outcomes,search,purity,records,events,sample`; default all). See its header. The `games`
  check also asks, in each configuration, for an assault by two or more units, an overrun, a mount, a
  dismount and a transport destroyed while carrying (a `setDown`).
- **Timing** (M2a-A-31, and the 15 s of M2a-A-15's 15,000 refusals): `npx tsx tests/impulse/timing.ts`,
  reading `IMPULSE_TIMING_GAMES` (default 100). On a quiet machine: the figures mean nothing under load.
- **Determinism** (M2a-A-28): `npx tsx tests/impulse/determinism.ts` prints 20 records; two runs must agree.

## Edits outside this package (bar ruling 20)

- `scripts/gate.ts`: the header line of the `content files` check; four imports (`yaml`'s `parse`, and
  `loadImpulseMatch`, `mapFileFor`, `namesOfScenario`, `rulesFileFor`, `unitsFileFor`, `parseRulesData`,
  `parseUnitFile` from this package); and the body of `check('content files', ...)`, which walks
  `content/rulesets`, `content/units` (but `facts/`) and `content/scenarios` (and their folders), reads
  each file's `format` and checks it by that format's validator: `ruleset/1` and `scenario/1` by the
  reference ruleset's, `impulse-ruleset/1`, `impulse-units/1` and `impulse-scenario/1` by this
  package's. A file whose name or format no validator accepts is a problem. (Round 1's edit, applied
  unchanged in round 2.)
- `tests/kernel/content.test.ts`: the file list of "every file under content/ validates" names
  `content/rulesets/v1.ruleset.yaml` and `content/units/placeholder.units.yaml`, and its comment names
  `tests/impulse/content.test.ts`, which checks them. (Round 1's edit, unchanged.)

## Questions put to the lead, and the answers

Asked in round 1 and answered:

1. **ART-01, ART-09, ART-10, ART-11** (revision 1): the lead ruled the specification right and moved `a1`.
2. **Rulings received during round 1**: the scenario names the unit file (`units: <id>`), not the rules
   data; a unit type also has `id`, `name`, `kind` and `count`; one movement point is half a hex of open
   ground; unit values are whole numbers, none below 0, cost at least 1; each objective names its
   starting `holder`. (Revision 2 replaced the `mounted` key of that ruling by `carriedBy`.)
3. **Round 1's choices, ruled by the lead** (the bar, "Round 1 reported"): as built and now the rule —
   15.3 judged when the action is done, its bookkeeping included, before any end phase; a mover put back
   into its starting hex draws no later shot; a discipline set to its value is accepted and not listed; a
   mission's attacks in unit order; assault approaches listed as moves are; a move's events `moved`, the
   mover's `revealed`, then the shots; the rules data has an `id`; `activationEnded` added to spec 18.
   Changed in round 2, and built: `activateUnit` of a unit that could not act (a battery with a mission
   waiting) is refused `no_unit_can_act` (`activateSide` likewise, as built); no unit starts, or is placed
   in free deployment, in a hex its mover type may not enter (the scenario check refuses the one, `place`
   is refused `impassable` and not listed for the other). Pins: as described under "How to build a match".

Points of revision 2 where the specification left a choice, built as follows (each the lead's to
overrule; none is hidden in the code):

- **"Not straight through"** (M2a-A-15's overrun kind): the action has no exit field, so an exit that is
  not straight through cannot be sent (the cases' author noted the same). The kind is built as an overrun
  whose path does not end beside the target hex, so that no straight line through it exists
  (`not_beside`).
- **The set's order in the legal list of close assaults** (ruling 8, left open by it): unit order, as
  LST-09 takes it; with each unit's cheapest (least exposed) approach chosen among those with room for it
  after the units before it, an earlier unit taking its next best where that alone lets a later unit in
  (round 2's attack found such sets missing: a quarter of the pairs under `stack.limit` 1), and each set
  listed with every unit advancing in that order and with none: at most four actions a set. Spec 17's
  words ("once with each unit by its cheapest approach") give no action for such a set; this reading
  keeps "every set of units that may assault it together" and is the lead's to overrule.
- **A close assault path that enters the target's own hex** (round 2's attack: possible only when the
  target is an empty transport without firepower alone in its hex, which 14.7 opens to a combat unit's
  move) is refused `enemy_hex`, and no listed approach makes one. Accepted, the move would destroy the
  target (14.7) before the assault, and 12.2 to 12.4 would roll and Suppress the assaulting units
  against a unit no longer in play. The same unit's plain move through the hex is legal and destroys the
  transport. The other reading (accept the path; the assault then has no target and ends without a roll,
  as when none arrives) is the lead's to choose.
- **12.8's "Empty transports without firepower do not count for this"** is read as covering both tests,
  "at least one enemy Soft unit" and "no enemy Hard unit": an empty transport without firepower is set
  aside whatever its class (it is destroyed as the unit enters, 12.9, and 14.7 names the target hex of an
  overrun among the movements it does not stop). An empty Hard one beside a Soft unit lets the overrun
  through; alone, the hex holds no Soft unit (`overrun_no_target`) and is simply entered by a move.
- **A unit of a close assault that may not stay at the end of its path** (12.2) is put back as 8.6 does:
  the last hex of its path before the end where it may, else the hex it set out from; its `moved` event
  says `stopped: false` and the hex it stands in.
- **14.5's "a towed unit counts as foot"** is read by the mover type names the specification gives (2.1
  lists tracked, wheeled, foot, towed): a unit whose mover type is named `towed` judges a dismount's step
  by the `foot` costs. A rules data that renamed `towed` or `foot` would lose that reading.
- **When an overrun's mover is stopped on its path**, the shots planned at its exit hex are reactors
  still to fire (8.6): each fires at the hex where the mover stopped if that hex qualifies for it and its
  chance there is at least the floor, as every other planned shot does.
- **A second shot at the exit hex after the first Suppressed the overrunning unit** fires at the exit
  hex (the mover still stands there, 8.6), now against a Suppressed mover.
- **A mount by a unit of the activation names any transport of its side** in its hex or beside it, of any
  formation, activated or not (14.2, TRN-08); the transport's own state does not change.
- **A unit carried, Ready and in command counts as a unit that could act** (5.5, 5.7): it may dismount.
  So an activation whose only remaining actor is a carried unit with no legal dismount stays open until
  the side ends it.
- The bar's line M2a-A-32 speaks of points "R1 to R6 below"; there is no such list in the bar. The points
  the cases file listed as open are settled by the amended specification (6.7, 5.5).

Ruled after the independent check of round 2 (the lead's ruling 70, `docs/bars/M2a.md`), and built:

- **Under the whole-side profile, units of several formations fire and assault together**: stands as
  built. The whole side is what is activated, so "the activated formation" of 7.1 and 12.1 is the side
  (5.9 as reworded; cases SID-05, SID-06). The profile is a swept alternative, not the game as it opens.
- **A unit already beside the target may path to another hex beside it**: stands as built (12.1 as
  reworded: "a unit already beside the target may declare an empty path, or a path to another hex
  beside the target"; case ASL-30). The list gives such a path only where it lets a later unit in.
- **A landing lands every mission due**, whatever has become of either side, and only then is the ending
  judged; both sides emptied: the higher score wins, 15.5 decides a tie (15.3 as amended; cases LND-05 to
  LND-08). "The higher score" is the score as it stands when the action is resolved: nothing is scored
  first (15.3: "without waiting for the end phase"). This can happen only when the landing side's last
  battery is hit by a mission of its own landing: in the cases, a battery with `minRange` 0 called on its
  own hex.
- **An action object whose accessor throws** makes `check` and `apply` throw: recorded, not repaired
  (ruling 70, point 11). An action arrives as data, and no such object comes out of JSON.
