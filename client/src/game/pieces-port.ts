/** What a game asks of the table's pieces. Counters by id; hexes by the one hex number of engine/core/hex. */
export interface PiecesPort {
  /** Replace every counter on the table with these, at home. */
  setUp(counters: readonly CounterSpec[]): void;
  /** Move a counter's home to a hex (on top of that hex's stack unless `place`, counted from the bottom, is given), with the eased lift-travel-settle of regular play; `path`, when given, is the hexes it passes through in order. Resolves when it has settled. */
  move(id: string, hex: number, opts?: { place?: number; path?: readonly number[] }): Promise<void>;
  /** Take a counter off the table. Resolves when it is gone. */
  remove(id: string, how: 'destroyed' | 'withdrawn'): Promise<void>;
  /** Marks on a counter; a field left out keeps its value. */
  mark(id: string, marks: { selected?: boolean; canAct?: boolean; spent?: boolean; suppressed?: boolean; target?: boolean }): void;
  /** Tint hexes of one kind, replacing that kind's last set (an empty list clears it). */
  tint(kind: 'reach' | 'target' | 'path' | 'objective' | 'zone', hexes: readonly number[]): void;
  /** A line from one hex to another, for a declared attack (replaces the set; an empty list clears). */
  lines(kind: 'fire', segments: readonly { from: number; to: number }[]): void;
  /** Plain clicks only: the top counter under the pointer or null, the hex or -1, and the ids of that hex's stack from the bottom. Returns a function that stops it. */
  onClick(handler: (hit: { counter: string | null; hex: number; stack: readonly string[] }) => void): () => void;
  onHover(handler: (hit: { counter: string | null; hex: number }) => void): () => void;

  // ---- Optional members, added for the game of orders (2026-11-11). An implementation without them still plays: the game then
  // ---- says the same things in the panel, and sends the lines of `threats` through `lines('fire')` instead.
  /**
   * More about a counter than `mark` says; a field left out keeps its value. `group`: one or two characters naming the group it is
   * ordered with (print them small on the counter); `active`: its group is the one now acting; `carriedBy`: the id of the counter
   * that carries it (it sits directly under that counter in the stack and goes where it goes), or null; `revealed`: it may be fired
   * at though its ground would hide it; `pick`: a click on it would choose it (one of the player's own, as a carrier to get onto).
   * `moved` (added 2026-11-14): it has moved this turn and can still do one thing more (fire, a charge, or a move on with
   * what is left): a small chevron at the face's lower right while it is so. `close` (added 2026-11-14): a click on it
   * would attack it at close quarters (a charge, or a drive through its hex): a clear red glow on it, eased in.
   */
  note?(id: string, notes: { group?: string; active?: boolean; carriedBy?: string | null; revealed?: boolean; pick?: boolean; moved?: boolean; close?: boolean }): void;
  /**
   * Fire that a move being pointed at would draw (`live` false), or that is being drawn now (`live` true): for each a line from the
   * firer's hex to the hex fired at, with a short label to print beside it (the chance, "58%"). Replaces the set; empty clears it.
   */
  threats?(shots: readonly { from: number; to: number; label: string; live: boolean }[]): void;
  /** Paths to draw besides the one tinted as 'path': each the hexes in order, the start first. Replaces the set; empty clears it. */
  routes?(paths: readonly (readonly number[])[]): void;
  /** Things lying on hexes that both sides see: a `screen` blocks sight through its hex, an `incoming` arrives there later. Replaces the set. */
  markers?(markers: readonly { hex: number; kind: 'screen' | 'incoming'; label: string; side: string | null }[]): void;
}
export interface CounterSpec { id: string; side: string; hex: number; place: number; face: CounterFace }
/** A placeholder face from data: which of the two stocks, a title band, a kind for the plain silhouette block, and up to four numbers. */
export interface CounterFace { stock: 'first' | 'second'; title: string; kind: string; numbers: { attack?: string; range?: string; defence?: string; move?: string } }
/**
 * Added after the lines above were fixed, and optional (TypeScript merges the two declarations): the
 * id of the unit type whose picture this counter carries (a roster id such as `pz4h`). A table
 * without unit art, or a face without this, draws the plain block.
 */
export interface CounterFace { art?: string }

// ---- Added 2026-11-13 for the owner's rule that every action is answered, done or refused. Optional members (TypeScript merges
// ---- the declarations): a table without them still plays, and the panel says the same things in words.
/** What a click would do, by kind: the table has an animated icon for each. The names are the game layer's own (as its controls'): `charge` an attack into an enemy's hex, `drive` one through it, `board` and `unload` getting onto and off a carrier, `call` fire asked for from afar, `screen` a screen laid on a hex. */
export type IntentAct = 'select' | 'order' | 'move' | 'fire' | 'charge' | 'drive' | 'board' | 'unload' | 'call' | 'screen' | 'place';
/** The answer to something a player did, shown on the table at the place it concerns. */
export type TableAnswer =
  /** A short label that appears at the hex, floats up and fades away: a thing done ("Activated", "Mounted") or what came of it. */
  | { kind: 'badge'; hex: number; unit: string | null; words: string; tone: 'good' | 'bad' | 'plain' }
  /** A red X at the hex that shakes (turning quickly one way and the other) and goes; `words` is why, in a few words, shown beside it. */
  | { kind: 'refused'; hex: number; unit: string | null; words: string }
  /** Fire leaves a counter for a hex: the shot itself. `on` is the counter fired at, when there is one. */
  | { kind: 'fired'; from: number; to: number; by: string; on: string | null }
  /** The fire arrives and this came of it: the impact by its result, and `words` as a badge at the target ("No effect", "Suppressed", "Destroyed"). */
  | { kind: 'landed'; from: number; to: number; by: string; on: string | null; result: 'none' | 'suppressed' | 'destroyed'; words: string; tone: 'good' | 'bad' | 'plain' };
export interface PiecesPort {
  /** What a click on the hex under the pointer would do, to be shown there with an animated icon and `words` ("Fire 58%", "Move 4 of 11"); `can` false: the click would be refused and `words` says why (the icon crossed out). Null: nothing to show. Replaces the last. */
  intent?(i: { hex: number; unit: string | null; act: IntentAct; can: boolean; words: string } | null): void;
  /** Every action is answered, done or refused (the owner's rule of 2026-11-13). */
  answer?(a: TableAnswer): void;
}

// ---- Added 2026-11-13 with the whole-side turn. What `note` carries is read differently from that day (its lines above are as
// ---- they were fixed): `group` is always '' (a counter carries no group's number: a group is the units that stand near one
// ---- another, which changes as they move; the game says `group: ''` in so many words the first time it tells a counter's
// ---- notes), and `active` is true for the counters of the group in hand, the group the player last went to or whose unit was
// ---- last chosen (the table lights them). The flag below is optional: a table without it plays the same.
export interface PiecesPort {
  /**
   * Where a side's flag stands: `hexes` are the hexes of the units of the group in hand, `side` whose they are (as a
   * counter's `side`), `stock` that side's stock. The table plants a small flag at a hex corner in their midst and
   * moves it when this changes. Null: no flag stands.
   */
  flag?(f: { side: string; stock: 'first' | 'second'; hexes: readonly number[] } | null): void;
}

// ---- Added 2026-11-14 with the short move (a unit that moves a little can still fire that turn). Optional: a table
// ---- without it shows all of the reach alike, and the panel says the same in words.
export interface PiecesPort {
  /**
   * The part of the hexes last tinted as 'reach' from which the unit could still fire this turn (a short move):
   * shown a shade stronger than the rest of the reach. Replaces the last set; an empty list clears it. A table
   * without it shows all of the reach alike.
   */
  reachNear?(hexes: readonly number[]): void;
}

// ---- Added 2026-11-14 with the chance of every target at once (the reach audit). Optional: a table without it shows
// ---- the chance of the one target pointed at, as before, and the panel says the same.
export interface PiecesPort {
  /**
   * While units are chosen to attack: a small label on each enemy counter (`unit`, standing in `hex`) that a click
   * would attack (beside it where its face is hidden), with the chance of any effect (`chance`, "62%") and, smaller
   * under it, the chance to destroy (`kill`, "18%"; '' for none). `best`: the best of them, which stands out a little.
   * A label must not cover a counter's numbers or another label. Replaces the set; an empty list clears it.
   * `also` (added 2026-11-14, optional): the key letters of the other ways the target can be attacked besides the click's
   * own ("C", a charge; "V", a drive through its hex), printed small at the foot of the label; absent, nothing more is printed.
   */
  chances?(labels: readonly { unit: string; hex: number; chance: string; kill: string; best: boolean; also?: string }[]): void;
}
// ---- Added 2026-11-14 with the dice on the table. Optional: a table without it shows a roll in the panel alone.
/** A roll as the game shows it (its DiceModel), with the game's seed: told when it is pointed out, when it is thrown, and when it is read. */
export interface DiceRoll {
  /** Goes up by one with every roll the game shows. */
  serial: number;
  /** The game's seed: with the serial it seeds the throw, so that the same game throws the same way. */
  seed: number;
  /** The faces rolled; empty while the roll is only pointed out, and when the result was certain and no dice were needed. */
  faces: readonly number[];
  /** How many sides each die has. */
  sides: number;
  /** False while the attack is only pointed out, before the throw. */
  rolled: boolean;
  /** The result in the panel's words ("Suppressed"), once the dice have been read; null before. */
  result: string | null;
  /** What became of the target, once the result is known. */
  fate: 'destroyed' | 'marked' | 'none' | null;
  /** The stock of the side that throws. */
  stock: 'first' | 'second' | null;
}
export interface PiecesPort {
  /**
   * A roll, each time it changes (pointed out, thrown, read), or null when there is none to show. The table throws real
   * dice into its tray and shows them with the sum and the result; the flat bench shows the faces plainly.
   */
  dice?(roll: DiceRoll | null): void;
}

// ---- Added 2026-11-14 with the hulks and craters (the advanced options Show hulks and Show craters). Optional: a table
// ---- without it leaves no marks, and the game plays the same (no rule reads a mark).
export interface PiecesPort {
  /**
   * What the battle leaves on the table, told as it happens. `begin`: a game starts on these pieces (every mark of the
   * last one goes); `seed` is the game's seed, which seeds how each mark lies. `shelled`: a `call` (fire asked for from
   * afar) has landed on `hex`; `key` names it the same wherever the game is watched (who called it, the turn, the hex).
   * A hulk needs no word of its own: it is laid where a counter taken off as destroyed lay, by its kind of unit.
   */
  scar?(s: { what: 'begin'; seed: number } | { what: 'shelled'; hex: number; key: string }): void;
}
