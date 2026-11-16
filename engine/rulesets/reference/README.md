# The reference ruleset

A small ruleset that proves the engine kernel (Milestone 1b). It is wholly data-driven: its numbers
are in `content/rulesets/reference.ruleset.yaml` and its scenario in
`content/scenarios/reference.scenario.yaml`, both checked on load (`data.ts`, `scenario.ts`). Every
number in them was invented for it; none is copied from a published game or from the old prototype's
rules profile (`shared/logic/rules.ts`).

It ports the old prototype's behaviour in general form only:

| Old behaviour | Here |
|---|---|
| A fixed list of six phases, with vehicle and non-vehicle movement phases | A sequence of phases from the data (`sequence: [gunnery, manoeuvre]`), the same for every unit |
| Setup by one side, then the other | Both sides set up at once, hidden from each other until both have submitted (PLAN R3) |
| A stacking limit per side, keyed by two fixed side names | A stacking limit per side, from the scenario's sides |
| Fire by odds against a table, one die, weapon-class letters with multipliers | Fire by odds against the data's table: attack (firepower against the target's class) over defense (plus cover), columns at the data's ratios, two dice, two thresholds per column, three results |
| Movement by terrain cost for two mover classes | Movement by the five-term cost rule (the lead's ruling 6) for any mover types the data names |
| Elimination, or surviving defense points at the turn limit | A side down to `brokenAt` live units loses at once; at the turn limit the higher score wins (destroyed enemy values and objectives held) |

## The old rules tests and their counterparts

Each test of `tests/rules-core.test.ts`, by line, and its counterpart in `tests/kernel/ported.test.ts`
(describe block, then test). The old tests' side names and chart names are not repeated here.

| Old test (line) | Counterpart | Note |
|---|---|---|
| 45 "allows a move exactly at the MP limit" | movement point budget: allows a move exactly at the allowance | |
| 52 "rejects a move beyond the MP limit" | movement point budget: refuses a move beyond the allowance | code `over_allowance` |
| 60 "rejects infantry moving more than 1 hex" | movement point budget: a unit type with a small allowance moves only that far | each unit type has its own allowance |
| 67 "immobile artillery (movement 0) cannot move" | movement point budget: a unit type with no allowance cannot move | |
| 75 "vehicles move only in the vehicle phase" | phase gating: moves only in the manoeuvre phase, fires only in the gunnery phase | The vehicle and non-vehicle phases are retired (PLAN section 14: the six-phase list with its vehicle and non-vehicle phases is not ported). What survives in general form, an action refused outside its phase, is mapped |
| 83 "non-vehicles move only in the non-vehicle phase" | phase gating: moves only in the manoeuvre phase, fires only in the gunnery phase | As above |
| 91 "enemy-occupied hexes block movement paths" | occupancy and stacking: enemy-held hexes block movement | code `enemy_hex` |
| 102 "enforces the stacking limit at the destination" | occupancy and stacking: enforces the stacking limit at the destination (a side with a limit of three) | code `stacking` |
| 118 "(second side's) stacking limit is 2" | occupancy and stacking: a side's own stacking limit applies (a side with a limit of two) | a stacking limit per side, from the scenario |
| 128 "executeMove does not mutate the input state" | apply never mutates its input: a move leaves the input state as it was | also M1b-16 in `tests/kernel/ruleset.test.ts` |
| 140 "marks a unit moved in movement phase and fired in announcement phase" | holding a unit: marks the unit spent, in the manoeuvre phase and in the gunnery phase | |
| 150 "rejects passing a unit that already acted" | holding a unit: refuses to hold a unit that has already acted | code `unit_unable` |
| 158 "rejects out-of-range attacks" | fire: refuses fire beyond the range | code `out_of_range` |
| 165 "combines multiple attackers on one target and marks them fired" | fire: combines several attackers on one target into one attack and marks them spent | |
| 182 "I-class weapons cannot hurt armor" | fire: a unit with no firepower against Hard targets cannot fire on one | Zero firepower against Hard targets survives as unit data (`firepower.hard: 0`); such a shot is refused (`no_effect`) instead of costing the unit its turn |
| 189 "A-class weapons are halved against soft targets" | fire: firepower depends on the target class | The weapon-class letters are retired (PLAN section 14) and their multiplier is a table value of the old profile, not ported; the behaviour that survives, firepower that differs by target class, is mapped |
| 196 "ending combat_announcement auto-resolves declared attacks" | fire: ending the gunnery phase resolves every declared attack and goes on to the manoeuvre phase | |
| 209 "disrupted units recover at the end of their own turn, not on its start" | suppression and recovery: a suppressed unit stays suppressed through its own player-turn and recovers at its end | |
| 229 "elimination wins immediately at turn rollover" | game end: a side with no units left loses at once | checked after every attack, with `brokenAt: 0` |
| 239 "turn limit ends the game on surviving defense points" | game end: at the turn limit the higher score wins | the points compared are the scenario's score |
| 249 "game continues below the turn limit" | game end: the game goes on below the turn limit | |

All 21 old tests are mapped; none is retired outright. Two have their phase-specific part retired
(lines 75 and 83) and one its letter-and-multiplier part (line 189), each for a reason PLAN section 14
gives, with the general behaviour mapped.

The self-play tests of `tests/selfplay.test.ts` (a game runs to completion with no invariant
violation; both sides deploy and fight; the same seed gives the same game; different seeds differ; a
ten-seed sweep finishes cleanly) have their counterparts in `tests/kernel/sim.test.ts` (M1b-24 and
M1b-29).

## Files

| File | What |
|---|---|
| `data.ts` | the data file's types and check |
| `scenario.ts` | the scenario file's types and check |
| `types.ts` | state, view, actions, events |
| `rules.ts` | the ruleset: legal actions, checks, apply (by events), reduce, outcomes, views, invariants, event schema |
