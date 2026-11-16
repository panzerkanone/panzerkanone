/**
 * The judgement of the planning opponent (opponent-planner.ts) as data: every
 * weight and threshold it uses, in one record. Nothing here is a rule or a
 * number of the rules: those it asks of the ruleset. The three levels of the
 * opponent (easy, normal, hard) are three records of the same shape (TABLES):
 * `hard` is the opponent at its best, and the other two are that record with
 * a few values changed (LEVEL_KNOBS says which, and nothing else differs).
 *
 * The currency is the game's own: points of the final margin. A destroyed
 * unit is worth the points its loss scores (the ruleset's share of its cost)
 * and `future` more for what it would still have done; an objective is worth
 * its points for the turns that remain.
 */
export interface PlannerTable {
  // ---- what things are worth -------------------------------------------------
  /** Points a unit is worth, per point of cost, beyond what its loss scores, with the whole game ahead; less as the turns run out. */
  readonly future: number;
  /** How far each later turn's objective points count against this turn's: 1 counts them in full. */
  readonly keep: number;
  /** A side this near its breaking point (the cube of its share of the way there) is this many points worse off. */
  readonly breakNear: number;
  /** A side past its breaking point at the next scoring. */
  readonly breakWin: number;
  /** The same for a lead on its way to the sudden-death lead. */
  readonly suddenNear: number;
  /** A Suppressed unit that will miss its next action, as a share of what it is worth; and one that will have recovered by then. */
  readonly heldDenied: number;
  readonly heldBrief: number;
  /** A unit set down Suppressed from a destroyed transport, as a share of what it is worth. */
  readonly setDown: number;
  /** A unit out of command (where formations are activated one at a time), as a share of what it is worth. */
  readonly outOfCommand: number;

  // ---- what the other side is expected to do with its next move ---------------
  /**
   * How far the other side's fire is trusted to be what is reckoned for it: its best use of its shooters, target by
   * target (1: wholly). The most units reckoned to fire together at one target, and the least a shot must be worth, in
   * points for each unit it uses up, to be reckoned at all.
   */
  readonly volley: number;
  readonly volleyMost: number;
  readonly volleyFloor: number;
  /** How far an attack is trusted that some of its units must first make a short move for, as a share of one made from where they stand. */
  readonly mobileTrust: number;
  /** For a hex a unit might move to: the chance that the units able to fire at it there do so (they have other targets). */
  readonly fireShare: number;
  /** The same for armour that must first make a short move to see it. */
  readonly mobileShare: number;
  /**
   * The chance that infantry able to close with a tank does, and that armour able to overrun does. A company is able when it
   * stands beside the tank, or can end a move beside it with movement over (rulings 80 to 82) and comes through the
   * reaction fire on the way; the companies that are go in alone or together, as is likelier to destroy the tank.
   */
  readonly assaultShare: number;
  readonly overrunShare: number;
  /**
   * How the loss of a tank to the close assaults the enemy could make where a move would leave it is weighed, against how
   * the rest of the enemy's answer is (1: like the reaction fire a move draws, by `heed` alone, however the game stands; 0:
   * like its fire, which a side that is behind and must attack counts for less, `desperate`). Whether the tank will still
   * stand on an objective at the scoring counts the close assaults in full whatever this is: a side that is behind may be
   * willing to lose a tank, but it does not hold a hex with one that is gone. At 1 the two are the same. (Measured on
   * 2026-11-14, docs/review/M2b/opponent-3-handover.md: below 0.5 the Keliach Tiger is again thrown onto the bridge.)
   */
  readonly closeFear: number;
  /**
   * What a move that leaves a company beside an enemy tank with movement over counts of the close assault it opens this
   * move (rulings 80 and 81), as a share of what the company adds to the companies that could go in with it.
   */
  readonly chargeOpen: number;
  /** A unit of mine Suppressed by that move, as a share of one destroyed. */
  readonly supCost: number;
  /** How much more of all that counts when the other side will move twice before I move again. */
  readonly exposureTwice: number;
  /** A unit of mine that is carried and so does nothing, as a share of what it is worth: while the ride still saves it time, and once it could as well walk. */
  readonly carriedIdle: number;
  readonly carriedStuck: number;
  /** How much of all that counts when I move again before the other side does; and for my own chances at its units when it moves first. */
  readonly exposureLater: number;
  readonly threatKept: number;
  /** How much my chances at its units count when I am the next to move. */
  readonly followUp: number;
  /** The chance that an enemy unit able to walk onto an empty objective does; and that one of mine does next move. */
  readonly walkIn: number;
  readonly walkInLater: number;

  // ---- ground ------------------------------------------------------------------
  /** The pull of an objective on a unit, as a share of what the objective is worth, falling to nothing `pullTurns` turns away. */
  readonly pull: number;
  readonly pullTurns: number;
  /** How much an objective still needs units: one I do not hold, one I hold with nobody on it, one I hold with a unit on it. */
  readonly needTake: number;
  readonly needEmpty: number;
  readonly needHeld: number;

  // ---- reaction fire -------------------------------------------------------------
  /** What a unit left Ready is worth for the shots it would take at the other side's moves, as a share of their sum. */
  readonly reactCover: number;
  /** What any fighting unit left Ready is worth besides, while the enemy has still to move this turn: it can still answer what was not foreseen. */
  readonly readyWorth: number;
  /** The chance that an enemy unit moves at all in its move. */
  readonly moves: number;
  /** A unit that has made its short move keeps this share of its cover. */
  readonly coverMoved: number;
  /** A formation holds its fire for armour when its shots at armour are worth this many times its shots at the rest. */
  readonly armorOnly: number;

  // ---- fire missions ---------------------------------------------------------------
  /** The chance that a unit is still under a marker when the shells land: one that cannot move, one that is Suppressed, one on an objective, any other. */
  readonly stayFixed: number;
  readonly stayHeld: number;
  readonly stayGarrison: number;
  readonly stayMobile: number;
  /** How much an enemy marker counts on a unit of mine that has a move left before it lands. */
  readonly dodgeLater: number;
  /** What a battery gives up while a mission of its own waits. */
  readonly missionHold: number;

  // ---- the level -----------------------------------------------------------------------
  /** The most of its own units it thinks of using in one action: firing together, charging together. */
  readonly together: number;
  /** How many of its units it keeps in hand in one turn: once that many have acted, it leaves the rest as they are. */
  readonly busy: number;
  /**
   * How much thought it gives to what the enemy will do in answer: the share at which it counts what the enemy's next
   * move could do to its units, and the reaction fire a move would draw (1: in full).
   */
  readonly heed: number;
  /**
   * The chance, at each decision, that it takes a lesser choice than the best it found: the second best of those worth
   * taking, and one time in three of those the third. Seeded: it is drawn from the stream the decision is handed.
   */
  readonly slip: number;

  // ---- the clock -----------------------------------------------------------------------
  /**
   * A side that will lose on points if nothing changes (its score, and the objectives as they are held, counted to the
   * last turn) has less to lose: what the enemy could do to its units counts for less by up to `desperate` of itself, in
   * full when it is `decided` points or more short of winning. 0: it counts its losses the same however the game stands.
   */
  readonly desperate: number;
  readonly decided: number;

  // ---- nerve ---------------------------------------------------------------------------
  /**
   * The margin, in points, at which a game is as good as decided: the worth of a position is its margin up to about a
   * third of this and flattens toward it beyond (0: the margin itself, however large).
   */
  readonly nerve: number;

  // ---- the rest of the move -----------------------------------------------------------
  /**
   * How much of what the units still to act could do to the enemy in this move is reckoned into the worth of a position
   * in the middle of it (0: nothing, and every action is judged as if the move ended with it). It is what puts first the
   * action that opens something for the others, and makes a unit's action cost what else it could have done.
   */
  readonly potential: number;

  // ---- thresholds and effort -----------------------------------------------------
  /** An action must be worth this much to be taken; under it the opponent ends its move. */
  readonly worthIt: number;
  /** A chain (fire, then the move or the charge it clears the way for) must beat its second step alone by this much. */
  readonly chainEdge: number;
  /** How many places a unit could move to are weighed with the reaction fire on the way. */
  readonly movesWeighed: number;
  /** How many actions a decision looks ahead at exactly (the ruleset's outcome lists; 0: none, it goes by its quick guess of each), and how many outcomes of one action. */
  readonly exact: number;
  readonly outcomes: number;
  /** How many chains a decision tries. */
  readonly chains: number;
  /** An order (where formations are activated one at a time) must promise this much. */
  readonly orderWorth: number;
}

/** The opponent at its best: the level `hard`. */
export const HARD: PlannerTable = {
  future: 0.6, keep: 0.85, breakNear: 12, breakWin: 60, suddenNear: 6, heldDenied: 0.3, heldBrief: 0.05, setDown: 0.5, outOfCommand: 0.3,
  volley: 0.8, volleyMost: 4, volleyFloor: 0.05, mobileTrust: 0.5, fireShare: 0.55, mobileShare: 0.3, assaultShare: 0.75, overrunShare: 0.6, closeFear: 1, chargeOpen: 0.8, supCost: 0.4, exposureTwice: 1.3, carriedIdle: 0.1, carriedStuck: 0.45, exposureLater: 0.35, threatKept: 0.15, followUp: 0.55,
  walkIn: 0.7, walkInLater: 0.5,
  pull: 0.1, pullTurns: 6, needTake: 1, needEmpty: 0.7, needHeld: 0.3,
  reactCover: 0.35, readyWorth: 0.15, moves: 0.6, coverMoved: 0.6, armorOnly: 1.5,
  stayFixed: 0.9, stayHeld: 0.7, stayGarrison: 0.5, stayMobile: 0.25, dodgeLater: 0.25, missionHold: 0.3,
  desperate: 0.7, decided: 10,
  nerve: 0,
  potential: 0.5,
  together: 6, busy: 99, heed: 1, slip: 0,
  worthIt: 0.05, chainEdge: 0.1, movesWeighed: 10, exact: 48, outcomes: 18, chains: 16, orderWorth: 0.3,
};

export const LEVELS = ['easy', 'normal', 'hard'] as const;
export type Level = (typeof LEVELS)[number];
/** The level the game seats when none is asked for. */
export const DEFAULT_LEVEL: Level = 'normal';

/** A level from a word (the page's address has `ai=easy|normal|hard`): the default for anything else. */
export function levelFrom(text: string | null | undefined): Level {
  return text === 'easy' || text === 'hard' || text === 'normal' ? text : DEFAULT_LEVEL;
}

/**
 * What a level changes, and nothing else: every other value is `hard`'s. Each is quality of play only: no level sees more
 * of the game, rolls other dice or has other units.
 *
 *   together        how many of its own units it thinks of using in one attack
 *   busy            how many of its units it keeps in hand in one turn
 *   exact, chains,  how far it looks: how many actions it looks ahead at exactly, how many two-step plans it tries (fire,
 *   movesWeighed,   then the charge; a short move, then the shot), how many places it weighs for each unit, and whether it
 *   potential       reckons what its other units could still do this turn
 *   heed            how much thought it gives to what the enemy will do in answer
 *   slip            a seeded chance of taking a lesser choice than its best
 *   readyWorth,     what a unit left Ready is worth to it while the enemy has still to move
 *   reactCover
 */
export const LEVEL_KNOBS: Readonly<Record<Level, Partial<PlannerTable>>> = {
  hard: {},
  normal: { together: 2, busy: 10, exact: 8, chains: 2, movesWeighed: 3, potential: 0, slip: 0.1 },
  easy: { together: 1, busy: 7, exact: 0, chains: 0, movesWeighed: 2, potential: 0, heed: 0.3, slip: 0.35, readyWorth: 0, reactCover: 0 },
};

/** The table of each level. */
export const TABLES: Readonly<Record<Level, PlannerTable>> = {
  easy: { ...HARD, ...LEVEL_KNOBS.easy },
  normal: { ...HARD, ...LEVEL_KNOBS.normal },
  hard: HARD,
};
