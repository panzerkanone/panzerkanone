/**
 * A reading: how the game layer reads a ruleset's plain data. The port
 * (port.ts) carries a ruleset's own views, actions and events; the controller,
 * the model, the play-back, the panel and the pieces never look inside them.
 * They ask a reading, which answers in the small vocabulary of this file:
 * where the units are, what an action offers, how an event is shown and said.
 *
 * A reading knows the SHAPE of one ruleset's data (which field holds a unit's
 * hex) and its words (a unit's name, a phase's name). It decides nothing: what
 * is legal comes from the port's legal actions, what an attack can do from the
 * port's outcomes, what happened from the events. One file per ruleset
 * implements this (reading-reference.ts, reading-impulse.ts); a new ruleset
 * brings its own and nothing else in the layer changes.
 *
 * Units are named by a string id (the counter's id on the table), hexes by
 * the one hex number of engine/core/hex, seats by their id.
 *
 * The vocabulary has two layers. The first is what any game of counters on
 * hexes has: units placed, moved, attacking, a turn's phases, an end. The
 * second, every member of it optional, is what a fuller game has (GameInfo.rich):
 * a side's turn in which each of its units does one thing, in any order, until
 * the side ends it; the side's units found in groups by where they stand (a
 * way to find and name them: nothing is decided by group); attacks made by
 * closing with the target (a `charge`: several units each by its own path) or
 * by driving through its hex (a `drive`), units carried by other units
 * (`board`, and leaving again as a move of one hex), things called down on a
 * hex that arrive later (`call`), a setting of the side, and fire drawn on the
 * way (a `Forecast`'s shots). A reading that offers none of the second layer
 * is played exactly as before it existed.
 */
import type { PortOutcome } from './port';
import type { CounterFace } from './pieces-port';

/** A labelled value for a card: both already in words. */
export interface Figure {
  readonly label: string;
  readonly value: string;
}

export interface SideInfo {
  readonly seat: string;
  readonly name: string;
  /** Which of the two counter stocks its units are printed on. */
  readonly stock: 'first' | 'second';
  /** The side in a word, for a small plate ("Whose turn"); absent: its name is used. */
  readonly short?: string;
  /** The mark it is shown with, by id ('cross', 'hammer-sickle'); absent: none. A panel draws the ids it knows. */
  readonly mark?: string;
}

export interface UnitInfo {
  readonly id: string;
  readonly seat: string;
  /** Its name in a sentence: "Field gun 2". */
  readonly name: string;
  readonly face: CounterFace;
  /** What tells it from the others of its kind, in two or three characters ("1a"): the end of its name. */
  readonly tag?: string;
  /**
   * The ways besides moving and firing its type can ever act, by the controls' names ('charge', 'drive', 'board', 'call',
   * 'screen'): whether it may act so now is the legal list's; this says only whether it ever may. Absent: not said.
   */
  readonly ways?: readonly string[];
}

/** A span of words; `strong` ones are printed heavier. */
export interface Span {
  readonly text: string;
  readonly strong: boolean;
}

/** One page of a player's guide to the rules. */
export interface RulePage {
  readonly id: string;
  /** Its number in the contents ("2"), or a dot for a page outside the numbered run. */
  readonly mark: string;
  readonly title: string;
  /** One line under the title. */
  readonly lead: string;
  /** The page's points, in order. */
  readonly points: readonly (readonly Span[])[];
  /** A closing hint, or null. */
  readonly tip: string | null;
  /** A small table of figures beside the text, or null. */
  readonly table: { readonly title: string; readonly rows: readonly Figure[] } | null;
}

/** A player's guide to the rules, as pages. */
export interface RuleBook {
  readonly title: string;
  readonly pages: readonly RulePage[];
}

/** One side's part of a briefing: its units as the scenario gives them, and what they cost. */
export interface BriefForce {
  readonly seat: string;
  readonly name: string;
  /** The side's mark by id, or null. */
  readonly mark: string | null;
  /** What it is there to do, in a sentence. */
  readonly aim: string;
  readonly groups: readonly {
    /** "Group 1 · tank company" */
    readonly name: string;
    /** Its units, like types together: the type's id (for a picture), the line's words ("Field gun × 2") and their points together. */
    readonly lines: readonly { readonly type: string; readonly text: string; readonly points: number }[];
  }[];
  /** The word for the sum, and the sum of every line's points. */
  readonly totalLabel: string;
  readonly total: number;
}

/** What a player is told before the first turn. Everything in it that a rule reads is computed from what the rules read. */
export interface Briefing {
  readonly title: string;
  /** One line under the title: when, where, how long. */
  readonly dateline: string;
  /** The id of the scenario's picture; a page may have one by that id. */
  readonly picture: string;
  readonly paragraphs: readonly string[];
  /** One line of small print. */
  readonly note: string;
  readonly forces: readonly BriefForce[];
  /** The heading of the win conditions. */
  readonly winTitle: string;
  /** The objectives, in the order of GameInfo.objectives: a name and what each is worth, in words. */
  readonly goals: readonly { readonly hex: number; readonly name: string; readonly worth: string }[];
  /** What else scores. */
  readonly terms: readonly Figure[];
  /** The heading of the endings, and each ending: when, and what then. */
  readonly endTitle: string;
  readonly endings: readonly Figure[];
}

/** Where the viewer is in a turn's loop, for a panel's box of words. */
export interface Guide {
  /** The steps of the loop in order, a few words each. */
  readonly steps: readonly string[];
  /** The present one (-1: none of them). */
  readonly step: number;
  /** The heading: the present step in the viewer's terms ("Your turn"). */
  readonly title: string;
  /** What to do when nothing more particular can be said. */
  readonly todo: string;
  /** Why, in a line: what a player who has not read the rules should know here. */
  readonly why: string;
}

/** A unit's card beyond its plain rows: its main numbers as tiles, how it stands as a stamp, and the rest as lines. */
export interface UnitCard {
  /** `kind` picks a picture for the tile: what it fires with, how far, what protects it, how it moves, how it fights hand to hand, what it is worth. */
  readonly tiles: readonly { readonly kind: 'fire' | 'range' | 'defence' | 'move' | 'close' | 'cost'; readonly value: string; readonly label: string }[];
  /** How it stands now, in a word, and how loud to say it. */
  readonly stamp: { readonly word: string; readonly tone: 'plain' | 'alert' | 'faint' } | null;
  readonly lines: readonly Figure[];
}

/** What a match is played with: read once, never changes. */
export interface GameInfo {
  /** The scenario's name. */
  readonly title: string;
  /** The last turn. */
  readonly turns: number;
  readonly grid: { readonly cols: number; readonly rows: number };
  /** The sides in order of play. */
  readonly sides: readonly SideInfo[];
  /** Every unit of the match. */
  readonly units: readonly UnitInfo[];
  readonly objectives: readonly { readonly hex: number; readonly points: number }[];
  /** Each seat's set-up zone. */
  readonly zones: Readonly<Record<string, readonly number[]>>;
  /** How many dice an attack rolls and their faces, for drawing them. */
  readonly dice: { readonly count: number; readonly faces: number };
  /** The fuller game: the second layer of this file. Its controls and prompts are then that layer's. */
  readonly rich?: true;
  /** An attack by several units is ONE listed action for the whole set (true), or one action declared for each unit (absent). */
  readonly attackSets?: boolean;
  /** The ruleset's own words for the controls of the second layer, by control id (model.ts ControlId), and for a few things a panel names. */
  readonly words?: Readonly<Record<string, string>>;
  /** The settings a side may be given (SideNow.setting), in the order a switch steps through them. */
  readonly settings?: readonly string[];
  /** What a player is told before the first turn, when the scenario has it. */
  readonly briefing?: Briefing;
  /** A player's guide to the rules, when the ruleset has one. */
  readonly rulebook?: RuleBook;
}

export interface UnitNow {
  readonly id: string;
  readonly seat: string;
  /** -1 when it is not on the board for this seat: not yet revealed, or destroyed. A carried unit is in its carrier's hex. */
  readonly hex: number;
  readonly destroyed: boolean;
  readonly suppressed: boolean;
  /** Has acted this turn of its side. */
  readonly spent: boolean;
  /**
   * It has moved this turn and may still do one thing more (the fuller game: fire once after a short move of armor, or
   * a charge after a move with movement over; either may instead move on). It is not spent, and it is not as it was
   * before it moved: a status of its own. Absent: false.
   */
  readonly moved?: boolean;
  /**
   * For a unit that is `moved`: what it can still do, in a few words that follow "can still" ("fire or move on"), and the
   * way it can still attack: by fire (`attack`) or by closing with a target (`charge`). Absent: it is not moved.
   */
  readonly still?: { readonly words: string; readonly attack: 'attack' | 'charge' };
  /** The unit it has declared an attack on, or null. */
  readonly target: string | null;
  /** The unit that carries it, or null. */
  readonly carriedBy?: string | null;
  /** It may be fired at though the ground it stands on would hide it. */
  readonly revealed?: boolean;
}

export interface SideNow {
  readonly seat: string;
  readonly score: number;
  readonly losses: number;
  /** Set-up handed in. */
  readonly ready: boolean;
  /** One line under the score in place of the count of losses: "lost 16 of 109". */
  readonly note?: string;
  /** What it has left to act with this turn, in a few words: "7 of 14 units can still act". */
  readonly hand?: string;
  /** The side's setting now, in a word or two ("free fire"); a word of the reading's when its parts are not all set alike. Absent: it has none. */
  readonly setting?: string;
}

/**
 * Units of one side that stand near one another, as they stand in this view: a way to find them and to name them, and
 * nothing more. No rule reads it and nothing is decided by it; it changes as units move.
 */
export interface GroupNow {
  /** Its name among all the groups of the view: steady for as long as the group's first unit stays its first. */
  readonly id: string;
  readonly seat: string;
  /** Its number among its side's groups, from 1, in the order of their first units. */
  readonly number: number;
  /** Its name in a sentence: "Group 2". */
  readonly name: string;
  /** Its units, in the order of GameInfo.units. */
  readonly units: readonly string[];
}

/** Something lying on a hex that both sides see: a `screen` blocks sight through the hex, an `incoming` arrives there later. */
export interface MarkerNow {
  readonly hex: number;
  readonly kind: 'screen' | 'incoming';
  /** A word or two for it, from the reading. */
  readonly label: string;
  /** Whose it is, or null. */
  readonly seat: string | null;
}

/** A view, read. */
export interface Position {
  readonly stage: 'setup' | 'play' | 'over';
  readonly turn: number;
  /** The phase's name from the data, in words; '' outside play. In the fuller game: whose turn it is, as the viewer would say it ("Your turn"). */
  readonly phase: string;
  /** The seats that must decide now. */
  readonly deciding: readonly string[];
  readonly units: readonly UnitNow[];
  readonly sides: readonly SideNow[];
  readonly result: { readonly winner: string | null; readonly reason: string } | null;
  /** What is left to decide with, for the banner: units that can still act. */
  readonly status?: readonly Figure[];
  /** The groups of every side, each side's in the order of their numbers. */
  readonly groups?: readonly GroupNow[];
  readonly markers?: readonly MarkerNow[];
  /** Who holds each objective, in the order of GameInfo.objectives (null: neither), when the view says. */
  readonly holders?: readonly (string | null)[];
}

/** A legal action, read: what it would do, and the action itself to hand back to the port. */
export type Offer<A> =
  | { readonly kind: 'place'; readonly unit: string; readonly hex: number; readonly action: A }
  | { readonly kind: 'ready'; readonly action: A }
  /** `with`: the other units of the same action, when an attack by several is one action (GameInfo.attackSets). */
  | { readonly kind: 'attack'; readonly unit: string; readonly target: string; readonly with?: readonly string[]; readonly action: A }
  /**
   * `verb`: what the unit does when it is not a plain move ("gets down"). `off`: the carrier it leaves by it. Two moves of one
   * unit to one hex are two routes: the list's first is the cheaper, its second the less exposed. `budget`: the movement
   * it has for this move (for a unit that has moved and moves on, what is left). `keeps`: after this move, if nothing
   * stops it, the unit is not spent but `moved` (UnitNow): it may still do one thing more this turn, which `still` says
   * in a few words that follow "can still", and the move's forecast says in full (`after`); `tag`, when given, is what
   * such a move is called on the table ("Short move"). Absent: the move spends it.
   */
  | {
    readonly kind: 'move'; readonly unit: string; readonly path: readonly number[]; readonly cost: number; readonly budget: number;
    readonly verb?: string; readonly off?: string; readonly keeps?: boolean; readonly still?: string; readonly tag?: string; readonly action: A;
  }
  | { readonly kind: 'hold'; readonly unit: string; readonly action: A }
  /** End the phase; in the fuller game, the side's turn (whether or not anything was done in it). */
  | { readonly kind: 'end'; readonly action: A }
  // ---- the second layer ----
  /** Take a placement back (set-up by hand). */
  | { readonly kind: 'takeBack'; readonly unit: string; readonly action: A }
  /** Take the set-up the scenario gives and hand it in at once. */
  | { readonly kind: 'preset'; readonly action: A }
  /**
   * An action that carries no choice and comes before anything else: it is sent without being asked for (what opens a
   * side's turn; what must land before it).
   */
  | { readonly kind: 'auto'; readonly action: A }
  /**
   * Give one part of the side a setting (`of` names the part). The side has one setting (SideNow.setting): the layer
   * gives every part the same, by as many of these as it takes.
   */
  | { readonly kind: 'setting'; readonly of: string; readonly setting: string; readonly action: A }
  /** Units close with a target, each by its own path (empty when it is beside it already); `advance`: those that go in after. */
  | {
    readonly kind: 'charge'; readonly units: readonly { readonly unit: string; readonly path: readonly number[] }[]; readonly target: string;
    readonly advance: readonly string[]; readonly action: A;
  }
  /** A unit goes by `path`, through the hex `through`, attacking what is in it, and stops in `exit`. */
  | {
    readonly kind: 'drive'; readonly unit: string; readonly path: readonly number[]; readonly through: number; readonly exit: number;
    readonly cost: number; readonly budget: number; readonly action: A;
  }
  /** A unit gets onto a carrier. */
  | { readonly kind: 'board'; readonly unit: string; readonly carrier: string; readonly action: A }
  /** A unit calls something down on a hex, of one of the ruleset's kinds (`variant`, a control id of GameInfo.words). */
  | { readonly kind: 'call'; readonly unit: string; readonly hex: number; readonly variant: string; readonly action: A }
  /** An action this layer has no gesture for yet. */
  | { readonly kind: 'other'; readonly action: A };

/** One line for the log, in plain words; `seat` is the side it is about (null: both). */
export interface Say {
  readonly seat: string | null;
  readonly text: string;
}

/** One throw of the dice against one unit, as a step shows it. */
export interface Roll {
  readonly target: string;
  /** The faces rolled; empty when the result was certain and no dice were rolled. */
  readonly dice: readonly number[];
  /** The result in words, and what became of the target. */
  readonly result: string;
  readonly fate: 'destroyed' | 'marked' | 'none';
  readonly figures: readonly Figure[];
}

/** How long a step with no picture of its own holds after it is shown. */
export type Hold = 'phase' | 'turn' | 'score' | 'result' | 'reveal';

/**
 * A short label for the table to show at a hex when a step is played: a thing done ("Activated") or what came of it
 * ("Recovers"). `news`: it is good or bad for the side `seat`; left out, it is plain news.
 */
export interface Badge {
  readonly hex: number;
  readonly unit: string | null;
  readonly words: string;
  readonly seat?: string;
  readonly news?: 'good' | 'bad';
  /**
   * For a label on a move: it is shown when the unit has come to rest where the move ends, after any fire drawn on the
   * way has been played, and not at all if that fire destroyed the unit. Absent: shown as soon as the step is.
   */
  readonly late?: boolean;
}

/**
 * An event, read: how the play-back shows it. `say` is its one line in the log, or null to say nothing. `badges`: labels
 * the table shows when it is played (an attack needs none for its result: the play-back makes that one itself).
 */
export type Step = StepShown & { readonly badges?: readonly Badge[] };

type StepShown =
  | { readonly kind: 'placed'; readonly unit: string; readonly hex: number; readonly say: Say | null }
  | { readonly kind: 'ready'; readonly seat: string; readonly say: Say | null }
  | { readonly kind: 'revealed'; readonly say: Say | null }
  | { readonly kind: 'phase'; readonly turn: number; readonly seat: string; readonly phase: string; readonly fresh: boolean; readonly say: Say | null }
  | { readonly kind: 'declared'; readonly unit: string; readonly target: string; readonly say: Say | null }
  | { readonly kind: 'held'; readonly unit: string; readonly say: Say | null }
  | {
    readonly kind: 'moved'; readonly unit: string; readonly path: readonly number[]; readonly cost: number; readonly say: Say | null;
    /** Where it stands after, when that is not the last hex of the path (it was put back). */
    readonly to?: number;
    /** For each attack on it that follows (an `attack` step with `at`), the place in the path of the hex fired at, -1 when it is not in it: the travel is played as far as each in turn. */
    readonly halts?: readonly number[];
    /** Units it carries: they travel with it. */
    readonly with?: readonly string[];
  }
  | {
    readonly kind: 'attack'; readonly attackers: readonly string[]; readonly target: string;
    /** The faces rolled; empty when the result was certain and no dice were rolled. */
    readonly dice: readonly number[];
    /** The result in words, and what became of the target. */
    readonly result: string; readonly fate: 'destroyed' | 'marked' | 'none';
    readonly figures: readonly Figure[]; readonly say: Say | null;
    /** What kind of attack, for the dice card's heading, from the reading; absent: an attack. */
    readonly title?: string;
    /** The chance, before the roll, of any effect and of destroying (`ways` and `kill` of `of`): printed beside the attack's lines while it is made. Absent: not shown. */
    readonly chance?: { readonly ways: number; readonly kill: number; readonly of: number };
    /** The hex fired at, when the target is on its way (fire drawn by a move): the shot is shown there. */
    readonly at?: number;
    /** How many of the events that follow are this attack's own effects: they are shown with its result, not after it. */
    readonly absorb?: number;
    /** Units that go into a hex when the result is known. */
    readonly advance?: readonly { readonly unit: string; readonly hex: number }[];
  }
  /** Several throws at one hex, one after another (what a `drive` does to each unit in the hex; what a `call` does when it lands). */
  | {
    readonly kind: 'strikes'; readonly title: string; readonly attackers: readonly string[]; readonly hex: number; readonly rolls: readonly Roll[];
    /** How many of the events that follow are these throws' own effects. */
    readonly absorb?: number;
    /** A unit that passes through the hex and comes out in `exit`. */
    readonly through?: { readonly unit: string; readonly exit: number };
    readonly say: Say | null;
  }
  /** A unit is taken off the board. */
  | { readonly kind: 'removed'; readonly unit: string; readonly say: Say | null }
  /** A unit gets onto a carrier. */
  | { readonly kind: 'boarded'; readonly unit: string; readonly carrier: string; readonly say: Say | null }
  | { readonly kind: 'recovered'; readonly unit: string; readonly say: Say | null }
  | { readonly kind: 'scored'; readonly seat: string; readonly hex: number; readonly points: number; readonly say: Say | null }
  | { readonly kind: 'ended'; readonly winner: string | null; readonly say: Say | null }
  /** An event with no picture of its own: the board is brought to the view after it; `hold` keeps it on screen a moment. */
  | { readonly kind: 'other'; readonly say: Say | null; readonly hold?: Hold };

/** One row of a small table of chances. */
export interface Chance {
  readonly name: string;
  readonly effect: string;
  readonly ways: number;
  readonly of: number;
}

/** Fire an action would draw: `by` fires at `on` as it enters `hex`. */
export interface Shot {
  readonly by: string;
  readonly on: string;
  readonly hex: number;
  /** The firer's hex. */
  readonly from: number;
  /** The ways (of `of`) that it has any effect, and that it destroys. */
  readonly ways: number;
  readonly kill: number;
  readonly of: number;
  readonly figures: readonly Figure[];
}

/** What an action would do, before it is sent. */
export interface Forecast {
  /** "Field gun 2 to 1611" */
  readonly title: string;
  readonly figures: readonly Figure[];
  /** What can happen, as small tables, each of which sums to the whole. */
  readonly tables: readonly { readonly title: string; readonly rows: readonly Chance[] }[];
  /** The fire it would draw on the way, in firing order. */
  readonly shots: readonly Shot[];
  /** The chance (0 to 1) that the side acting comes off worse on the way: for choosing between two routes to one hex. */
  readonly risk: number;
  /** One line under the tables; '' for none. */
  readonly note: string;
  /** For an attack: the ways (of `of`) that it has any effect on what it is made on, and that it destroys. Absent: it is no attack, or its effect comes later. */
  readonly chance?: { readonly ways: number; readonly kill: number; readonly of: number };
  /**
   * For an attack that would be easier if its target were fired on first: why, in a few words that can follow "fire on
   * it first" and a colon ("a Suppressed target is 3 columns easier to close with"). Absent: nothing of the kind.
   */
  readonly easier?: string;
  /**
   * For a move: what becomes of the unit after it, as a sentence, where a player should be told. What it can still do
   * this turn when the move leaves it something (an offer that `keeps`); that it will be spent, when a shorter move
   * of the same unit would have left it something. Absent: nothing to say (the move spends it, as every move does).
   */
  readonly after?: string;
  /**
   * For an attack: something already counted in its chance that a player should know of, as a sentence (a unit that
   * fires after moving fires worse). Absent: nothing.
   */
  readonly counted?: string;
}

/**
 * Something a player tried that is not among the legal actions: what was meant, for the reading to say why it cannot be
 * done. A `target` of null, a `carrier` of null or a `hex` of -1 asks why the unit can do that to nothing at all.
 */
export type Attempt =
  /** Choose this unit to do something. */
  | { readonly kind: 'select'; readonly unit: string }
  | { readonly kind: 'attack'; readonly units: readonly string[]; readonly target: string }
  | { readonly kind: 'move'; readonly unit: string; readonly hex: number }
  | { readonly kind: 'charge'; readonly units: readonly string[]; readonly target: string | null }
  | { readonly kind: 'drive'; readonly unit: string; readonly hex: number }
  | { readonly kind: 'board'; readonly unit: string; readonly carrier: string | null }
  | { readonly kind: 'call'; readonly unit: string; readonly hex: number; readonly variant: string }
  | { readonly kind: 'place'; readonly unit: string; readonly hex: number }
  | { readonly kind: 'end' };

export interface Reading<V, A, E, Q> {
  readonly info: GameInfo;
  position(view: V): Position;
  offer(view: V, action: A): Offer<A>;
  /** The question to ask the port's outcomes: these units together on that target. */
  attackQuery(attackers: readonly string[], target: string): Q;
  /** The figures behind an attack as it would be made in this view (strength, defence), for the preview. */
  attackFigures(view: V, attackers: readonly string[], target: string): readonly Figure[];
  /** An outcome's result code in words: its name and what it does to the target. */
  resultWords(result: string): { readonly name: string; readonly effect: string };
  /** One line about the phase a view is in, for a player who has not read the rules; '' when there is nothing to say. */
  phaseNote(view: V): string;
  /** A unit's card: what it is and how it stands in this view. */
  unitFigures(view: V, unit: string): readonly Figure[];
  /** How a game ended, as a sentence. */
  endingWords(view: V): string;
  /**
   * An event, read against the seat's view just before it. `rest`: the events
   * of the same action that follow it, for a step that must know what comes
   * next (where fire will fall on a move, which events are an attack's effects).
   */
  step(event: E, before: V, rest?: readonly E[]): Step;
  /**
   * What a legal action would do, before it is sent (second layer): the fire
   * it would draw and the chances of each result. `ask` is the port's
   * outcomes; the reading makes the question and puts the answer into words.
   */
  forecast?(view: V, action: A, ask: (query: Q) => readonly PortOutcome[]): Forecast;
  /**
   * Why something a player tried cannot be done in this view, in a few true words that follow a colon and begin small
   * ("out of range: it reaches 9 hexes and the target is 12 away"). '' when the reading cannot tell: the layer then says
   * only that it cannot be done now. It decides nothing: the layer asks it only about what the legal actions do not offer.
   */
  why?(view: V, attempt: Attempt): string;
  /** Where a seat (null: a watcher) is in the turn's loop, and what to say there. */
  guide?(view: V, seat: string | null): Guide;
  /** A unit's card as tiles, a stamp and lines (the plain rows of `unitFigures` are still given). */
  unitCard?(view: V, unit: string): UnitCard;
}
