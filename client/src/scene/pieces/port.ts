/**
 * The outward face of the table's pieces: what a game asks of them. The game
 * layer (client/src/game/) is written against exactly this text; the pieces'
 * own toy (toy.ts: forty counters, select and order anywhere) is merely the
 * default user of it. Types only.
 */

/** What a game asks of the table's pieces. Counters by id; hexes by the one hex number of engine/core/hex. */
export interface PiecesPort {
  /** Replace every counter on the table with these, at home. */
  setUp(counters: readonly CounterSpec[]): void;
  /** Move a counter's home to a hex (on top of that hex's stack unless `place`, counted from the bottom, is given), with the eased lift-travel-settle of regular play; `path`, when given, is the hexes it passes through in order (follow it, corner to corner, smoothly). Resolves when it has settled. */
  move(id: string, hex: number, opts?: { place?: number; path?: readonly number[] }): Promise<void>;
  /** Take a counter off the table; 'destroyed' should be worth watching (your choice: it is flicked off the board, or lifts away), 'withdrawn' is plain. Resolves when it is gone. */
  remove(id: string, how: 'destroyed' | 'withdrawn'): Promise<void>;
  /** Marks on a counter; a field left out keeps its value. `canAct` is a quiet cue that the counter may still do something this phase; `spent` dims it a little; `suppressed` needs a clear sign (a marker chip on it, or a turn of the counter: your choice); `target` is a counter that may be fired on. */
  mark(id: string, marks: { selected?: boolean; canAct?: boolean; spent?: boolean; suppressed?: boolean; target?: boolean }): void;
  /** Tint hexes of one kind, replacing that kind's last set (an empty list clears it). Use the board overlay's own tints (see `overlay` on the page's hook and how the grid shader takes them); pick quiet, distinct colours through the scene's ink tables. */
  tint(kind: 'reach' | 'target' | 'path' | 'objective' | 'zone', hexes: readonly number[]): void;
  /** A line from one hex to another, for a declared attack (replaces the set; an empty list clears). A flat stroke on the board is enough for now. */
  lines(kind: 'fire', segments: readonly { from: number; to: number }[]): void;
  /** Plain clicks only (no Alt held, not a drag): the top counter under the pointer or null, the hex or -1, and the ids of that hex's stack from the bottom. Returns a function that stops it. While a handler is attached, your toy's own select-and-order does nothing. */
  onClick(handler: (hit: { counter: string | null; hex: number; stack: readonly string[] }) => void): () => void;
  onHover(handler: (hit: { counter: string | null; hex: number }) => void): () => void;

  // ---- For the game of orders (2026-11-12). The game layer's own text of this port has these four as optional members; the
  // ---- cardboard pieces have all four, so they are plain members here (a port with them is accepted wherever one without is).
  /**
   * More about a counter than `mark` says; a field left out keeps its value. `group`: one or two characters naming the group it is
   * ordered with: printed in a small box at the right end of the face's band, in the band's own inks (the faces are printed again
   * when one changes). `active`: its group is the one now acting: the box is printed the other way round, solid, and a little larger; with no group
   * mark (`group` empty) nothing is printed, and the counter is lit instead: a soft ring of warm light round it and a hair of lift, with one pulse when
   * it is first lit (which waits for the view, if the table's `goTo` is taking it there). `carriedBy`: the
   * id of the counter that carries it, or null: while it lies directly under that counter it travels with it, as one. `revealed`:
   * it may be fired at though its ground would hide it: brackets at the face's corners. `pick`: a click on it would choose it: a
   * cool dashed line inside the edge. `moved` (added 2026-11-14): it has moved this turn and can still do one thing more (fire,
   * close assault, or move on with what is left): a small chevron at the face's lower right, between how far it moves and
   * its foot, while it is so. `assault` (added 2026-11-14): a click on it would attack it at close quarters (a close
   * assault, an overrun through its hex): a clear red glow on it and round it, eased in.
   */
  note(id: string, notes: { group?: string; active?: boolean; carriedBy?: string | null; revealed?: boolean; pick?: boolean; moved?: boolean; close?: boolean }): void;
  /**
   * Fire that a move being pointed at would draw (`live` false: a thin broken line, a pale tag), or that is being drawn now (`live`
   * true: the stroke of a declared attack, a tag in the fire's ink): for each a line from the firer's hex to the hex fired at, and
   * its label on a small tag lying on the table by the line, turned to the camera. Replaces the set; an empty list clears it.
   */
  threats(shots: readonly { from: number; to: number; label: string; live: boolean }[]): void;
  /** Paths to draw besides the one tinted as 'path': each the hexes in order, the start first; a grease-pencil stroke through their middles. Replaces the set; an empty list clears it. */
  routes(paths: readonly (readonly number[])[]): void;
  /**
   * Things lying on hexes that both sides see: a `screen` blocks sight through its hex, an `incoming` arrives there later. Each is
   * a hexagon of thin card lying on its hex, under any stack there and showing round it, printed with what it is and its label,
   * an `incoming` on its side's stock. Replaces the set; an empty list clears it.
   */
  markers(markers: readonly { hex: number; kind: 'screen' | 'incoming'; label: string; side: string | null }[]): void;
}
export interface CounterSpec { id: string; side: string; hex: number; place: number; face: CounterFace }
/**
 * A placeholder face from data: which of the two stocks, a title band, a kind for the plain silhouette block, and up to four numbers.
 * `art` is the id of the unit type whose picture this counter carries (a roster id such as `pz4h`); without it the plain block is drawn.
 */
export interface CounterFace { stock: 'first' | 'second'; title: string; kind: string; numbers: { attack?: string; range?: string; defence?: string; move?: string }; art?: string }
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
   * own ("C", a close assault; "V", an overrun), printed small at the foot of the label; absent, nothing more is printed.
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
   * dice into the tray's felt well, landing on `faces`, and shows them in an inset with the sum and the result.
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
