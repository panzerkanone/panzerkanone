/**
 * What a counter is, and every dial of how the pieces feel, in one place.
 * Lengths are in h (one hex across flats) and h is taken as 20 mm, so that
 * gravity, friction and speeds are those of real cardboard on a real table.
 * Plain numbers, no browser.
 */

/** One h in millimetres: the scale the physics is real at. */
export const MM_PER_H = 20;

/** A die-cut counter: 5/8 inch (about 16.4 mm) square, about 1.9 mm thick, corners rounded by an eighth of the side. */
export const COUNTER = {
  side: 0.82,
  thickness: 0.095,
  cornerRadius: 0.82 / 8,
  /** The pressed top edge the die leaves, and the sharper lower one. */
  topBevel: 0.011,
  bottomBevel: 0.004,
} as const;

/** Gravity, 9.81 m/s² in h. */
export const GRAVITY = 9810 / MM_PER_H;
/** The physics' fixed step. */
export const STEP_S = 1 / 120;

/** The physics' dials. */
export const PHYS = {
  /** Solver passes a step. */
  solverIterations: 4,
  /**
   * How stiff a contact is, as a natural frequency in Hz. Rapier's own 30 Hz lets a counter sink a
   * seventh of its thickness under real gravity at this scale; at 240 the top of a stack of four
   * stands 0.006 h low. (Above about 400, with four passes at this step, a stack shakes itself apart.)
   */
  contactHz: 240,
  /** The collider's rounding of every edge (the visible corner radius is drawn, not collided). */
  colliderRound: 0.012,
  /** Cardboard on the printed sheet, on the wrap and wood, and on cardboard (Rapier averages a pair). */
  frictionCounter: 0.46,
  frictionBoard: 0.34,
  frictionTable: 0.3,
  /** The tray's stained wood, and the felt pad of its large well. */
  frictionTray: 0.32,
  frictionFelt: 0.7,
  restitution: 0,
  /** Air and the give of card: a little linear loss, more for spin. */
  linearDamping: 0.5,
  angularDamping: 1.6,
  /** A body is still under these speeds (h/s, rad/s); when every waking body has been still this long, each is held where it lies and nothing more is stepped. */
  stillLinear: 0.35,
  stillAngular: 0.6,
  sleepAfterS: 0.3,
  /** Never more fixed steps than this in one frame: a slow frame slows the toy rather than piling up. */
  maxStepsAFrame: 6,
} as const;

/** How the pieces move and answer the hand. Every number here was set by playing. */
export const FEEL = {
  // ---- regular play ---------------------------------------------------------------------------
  /** An ordered move: seconds for the first hex and for each further hex of a path, and its ceiling. */
  orderS: 0.34,
  orderPerHexS: 0.085,
  orderMaxS: 1.5,
  /** How high an ordered counter lifts: a base, a share of the distance, a ceiling. */
  orderLift: 0.2,
  orderLiftPerH: 0.035,
  orderLiftMax: 0.55,
  /** A counter left in a stack whose place changed settles to it in this time. */
  settleS: 0.2,
  /**
   * A counter that leaves from under others, or goes in under others: those others are lifted clear
   * of it (this much above its own lift and a counter's thickness) and set down this long after it
   * has gone or come in; never in the air longer than the third figure.
   */
  clearLift: 0.06,
  clearAfterS: 0.12,
  clearMaxS: 0.55,
  /** A selected counter rides this far above its place; it and its marks ease with this time constant. */
  selectLift: 0.05,
  markTau: 0.055,
  /** A suppressed counter lies turned by this many degrees. */
  suppressedTurnDeg: 24,
  // ---- going home (Space) ---------------------------------------------------------------------
  homeS: 0.5,
  homePerHS: 0.03,
  homeMaxS: 0.95,
  homeLift: 0.3,
  homeLiftPerH: 0.05,
  homeLiftMax: 0.9,
  /** Counters start this far apart in time, and never so far that the whole flow takes longer than the second figure. */
  homeGapS: 0.035,
  homeSpreadMaxS: 0.9,
  /** A counter nearer its home than this (h) has only been nudged: it squares up at once, outside the queue. */
  homeNudge: 0.3,
  /** In a stack the counter above lands at least this long after the one below. */
  homeStackGapS: 0.06,
  // ---- taking a counter off the table -----------------------------------------------------------
  destroyedS: 0.75,
  withdrawnS: 0.32,
  // ---- to the tray, and out of it ---------------------------------------------------------------
  /**
   * A lost counter is carried to its well in the tray: seconds for the lift and the setting down,
   * and for each h of the way, and the ceiling. It is carried this far above the tray's rim (or
   * above where it starts or ends, if that is higher).
   */
  trayS: 0.8,
  trayPerHS: 0.024,
  trayMaxS: 1.5,
  trayLift: 0.45,
  /**
   * The carry's three parts as shares of its time: it rises in the first, crosses between the next
   * two, and comes down in the last. They overlap a little, so that it is one movement; but it is
   * clear of a well's rim before it sets off across, and over its place before it comes down past one.
   */
  trayRise: 0.3,
  trayGoFrom: 0.12,
  trayGoTo: 0.8,
  trayFall: 0.34,
  /** In a well the counter above lands at least this long after the one below. */
  trayStackGapS: 0.08,
  // ---- the finger (Alt + drag) ------------------------------------------------------------------
  /**
   * A fingertip: a flat pad of this radius and half this height (its rim rounded by the third
   * figure), this many counters heavy, pressed down by this many times its weight. Flat, and about
   * as thick as one counter, so that it meets a counter's edge squarely and takes one counter at a
   * time: on the board the bottom one of a stack, on a stack's top the top one, against a counter's
   * side that counter.
   */
  fingerRadius: 0.3,
  fingerHalfHeight: 0.046,
  fingerRound: 0.02,
  fingerMass: 6,
  fingerPress: 2,
  /** It closes on the pointer with this time constant, never faster than this (h/s). */
  fingerTau: 0.03,
  fingerMaxSpeed: 70,
  /** Skin on card grips: the finger's friction (the larger of a pair's is used). */
  fingerFriction: 1.1,
  // ---- the poke (Alt + click) -------------------------------------------------------------------
  /** Speed given along the board, from a click at the middle to one at the rim (h/s); the hop; the spin (rad/s). */
  pokeSpeedCentre: 5,
  pokeSpeedRim: 36,
  pokeHop: 9,
  pokeSpin: 9,
  // ---- pick up and carry (Alt + Shift + drag) -----------------------------------------------------
  /** How far it lifts, how stiff the hand is (rad/s) and how damped (1 is critical), and how far it leans into a move. */
  carryLift: 0.5,
  carryOmega: 30,
  carryDamping: 0.7,
  carryLeanPerH: 0.3,
  carryLeanMax: 0.22,
  carryMaxSpeed: 90,
  // ---- the bump (B) -----------------------------------------------------------------------------
  /** Everything jumps at about this speed (h/s), each a little differently, with a little drift and spin. */
  bumpSpeed: 8.5,
  bumpSpread: 0.25,
  bumpDrift: 0.8,
  bumpSpin: 2.2,
  // ---- homes ------------------------------------------------------------------------------------
  /** A counter at home keeps a hair of offset and a degree or two of turn, by its id. */
  homeJitter: 0.014,
  homeTurnDeg: 1.8,
  /** A live counter this far from its home pose (h, degrees) is loose. */
  homeTolerance: 0.012,
  homeToleranceDeg: 1.2,
  /** A home counter comes alive when something moving is within this margin of it (h). */
  wakeMargin: 0.14,
} as const;

/** Colours of the pieces' marks, linear light, 0 to 1. */
export const MARK_INKS = {
  selected: [1.0, 0.78, 0.3],
  hover: [1.0, 0.93, 0.7],
  canAct: [0.95, 0.9, 0.62],
  target: [0.95, 0.22, 0.1],
  suppressed: [0.62, 0.1, 0.06],
  fire: [0.56, 0.07, 0.04],
  /** A click here would choose this one: a cool dashed line, apart from every warm mark. */
  pick: [0.5, 0.8, 1.0],
  /** It has been seen: brackets at the face's corners. */
  revealed: [0.62, 0.08, 0.04],
  /** It has moved and can still do one thing more: a small chevron at the face's lower right, in a dark ink that reads on either stock. */
  moved: [0.05, 0.045, 0.04],
} as const;

/**
 * A counter a click would attack at close quarters (the port's `note` with `close`: a close assault, an overrun): a clear
 * red glow on it and round it (the owner, 2026-11-14: "show the unit that can be close attacked as red glow"). Its own
 * edge glows red in a wider band than a target's, the face takes a faint red wash, and a wide red glow lies on the
 * surface round it. It eases in more slowly than the other marks (`tau`), and swells once when it comes on (`pulseS`),
 * so that the eye finds it.
 */
export const CLOSE = {
  ink: [1.0, 0.12, 0.05] as readonly [number, number, number],
  /** The band of its edge that glows (h in from the edge), and how strongly; the wash over its face. */
  rimIn: 0.11,
  rim: 1.15,
  wash: 0.16,
  /** The glow on the surface round it: how far it reaches from its edge (h), and how strong it is at the edge. */
  reach: 0.55,
  halo: 0.85,
  tau: 0.12,
  pulseS: 0.9,
  pulseGain: 0.7,
} as const;

/**
 * The chosen counter (the owner, 2026-11-14: "It's a little hard to detect which unit is the currently selected unit").
 * Its treatment, by name (`MARK_LOOK.chosen`): `today` as it was (an amber glow at its rim and a hair of lift); `lift`
 * raised higher, so its shadow stands off it; `outline` a crisp bright line round its edge, with a dark keyline on the
 * surface just outside it so that it reads on pale ground (snow) as on dark (woods), and its cut edge lit; `all` the
 * outline and the lift, with two slow swells of the light when it is chosen. Lengths in h.
 */
export const CHOSEN = {
  /** How high it rides: as it was, and raised. */
  liftToday: 0.05,
  liftHigh: 0.16,
  /** The outline on the surface: how far off the counter's edge its middle lies, its half width; the keyline's width outside it and how dark it is. */
  ringOff: 0.038,
  ringHalf: 0.032,
  keyline: 0.032,
  keyDark: 0.55,
  /** The line on its own face just inside the edge (its half width), and its cut edge's light. */
  faceLine: 0.021,
  wallLight: 0.85,
  /** The outline's light, linear: a warm white, brighter than any lit counter's. */
  ink: [1.0, 0.9, 0.62] as readonly [number, number, number],
  /** The swells when it is chosen: how long both take, and how much brighter the light is at their height. */
  pulseS: 1.5,
  pulseGain: 0.9,
} as const;

/**
 * A Spent counter (it has acted this turn). Its treatment, by name (`MARK_LOOK.spent`): `today` greyed and a little
 * darker; `grey` greyer and darker still, its cut edge too, its sheen dulled; `turn` as `grey`, and turned a little on
 * its hex, as a played piece is turned on a real table (Suppressed is then turned the other way, so that the two are
 * never confused: its red sash is its own); `mark` as `grey`, and its band, the brightest part of a face, goes dark, so
 * that a Spent counter reads at a glance from the opening camera. `mark` is drawn (picked 2026-11-14): it is never
 * turned, so only a Suppressed counter lies turned.
 */
export const SPENT = {
  /** Its grey: how far toward grey, and how dark that grey is (1 as light as the face). */
  greyToday: 0.62,
  darkToday: 0.74,
  grey: 0.86,
  dark: 0.58,
  /** Its cut edge and its sheen, as shares of their own (1: as they were). */
  wall: 0.72,
  sheen: 0.35,
  /** How far it is turned on its hex (degrees), in the `turn` treatment. */
  turnDeg: 14,
} as const;

/**
 * Which treatments the table draws: picked 2026-11-14 from the four of each shown side by side (docs/review/M7/feel/).
 * The page may change them (the pieces' hook: `markLook`) to show them side by side again.
 */
export const MARK_LOOK: { chosen: 'today' | 'lift' | 'outline' | 'all'; spent: 'today' | 'grey' | 'turn' | 'mark' } = { chosen: 'all', spent: 'mark' };

/** How high a chosen counter rides under the treatment drawn. */
export function chosenLift(): number {
  return MARK_LOOK.chosen === 'lift' || MARK_LOOK.chosen === 'all' ? CHOSEN.liftHigh : CHOSEN.liftToday;
}

/** How far a counter is turned on its hex for what it is: Suppressed, and (in the `turn` treatment) Spent, the other way. */
export function markTurnDeg(m: { readonly spent: boolean; readonly suppressed: boolean }): number {
  const turned = MARK_LOOK.spent === 'turn';
  if (m.suppressed) return turned ? -FEEL.suppressedTurnDeg : FEEL.suppressedTurnDeg;
  return m.spent && turned ? SPENT.turnDeg : 0;
}

/**
 * How bright the chosen counter's light is over its steady level, `t` seconds after it was chosen: two slow swells that
 * fade, level at both ends (nothing starts or stops at a step); 0 when none is under way.
 */
export function chosenPulseOf(t: number): number {
  if (!(t > 0) || t >= CHOSEN.pulseS) return 0;
  const k = t / CHOSEN.pulseS;
  const s = Math.sin(2 * Math.PI * k);
  return s * s * (1 - 0.45 * k);
}

/** How strong the swell of a close attack's glow is, `t` seconds after it came on: one swell, level at both ends. */
export function closePulseOf(t: number): number {
  if (!(t > 0) || t >= CLOSE.pulseS) return 0;
  const s = Math.sin(Math.PI * (t / CLOSE.pulseS));
  return s * s;
}

/**
 * The mark of a Moved counter (the port's `note` with `moved`): a small chevron pointing on, ">", at the face's lower
 * right, in the free stock between how far the counter moves (its number and the line under it) and its foot, so that
 * it covers no number. Shares of the face: its middle (across, down from the band's top), its half height, and its
 * stroke's half width.
 */
export const MOVED_MARK = { x: 0.84, y: 0.684, half: 0.043, stroke: 0.0125 } as const;

/**
 * The group in hand (the port's `note` with `active` and no group mark): each of its counters is lit. Nothing is
 * printed on it. A soft ring of warm light lies on the surface round it, a little way off its edge, in a wider and
 * fainter pool; its own edge catches a little of that light (its cut edge most, which is what a low camera sees);
 * and it rides a hair above its place. It is a quieter sign than `selected`, and another shape: the selected counter
 * glows from its own rim inward, tightly and brightly; a lit one stands in a ring of lamplight and its face is as it was.
 * When a counter is first lit the light swells once and settles (`pulse`), so that the eye finds the group; held, it is still.
 */
export const LIT = {
  /** Where its light lies between the pale light of a counter pointed at (0) and the amber of the one chosen (1): the marks' own inks. */
  inkShare: 0.8,
  /** It rides this far above its place (a selected counter rides `FEEL.selectLift`), and so does what lies on it. */
  lift: 0.022,
  /**
   * The light on the surface, a wash of its colour over what is there. A soft ring a little way off the counter's
   * edge: the wash's share at its middle, how far off the edge that is (h), and its half width. And a fainter pool
   * round it: its share at the counter's edge, the distance (h) in which it falls to about a third, and how far it reaches.
   */
  ring: 0.4,
  ringOff: 0.07,
  ringWidth: 0.045,
  pool: 0.15,
  poolFall: 0.2,
  poolReach: 0.55,
  /**
   * The light on its own edge: its strength, how far in from the edge it reaches on the face (h: short of every
   * number and of the may-act line), and its share on the cut edge (which is most of what a low camera sees of a
   * counter's rim; a selected counter's cut edge is given 0.6, about twice this).
   */
  rim: 0.3,
  rimIn: 0.028,
  rimWall: 1.1,
  /**
   * The one pulse: how long it lasts; how much stronger the pool and the edge are at its height (as shares of their
   * own strength), and how much wider the pool. It waits while the view is gliding to the group, never longer than
   * `pulseWaitMaxS`; one that had only just begun when the view set off (under `pulseRewindS`) begins again on arrival.
   */
  pulseS: 0.95,
  pulsePool: 0.9,
  pulseRim: 0.8,
  pulseSpread: 0.3,
  pulseWaitMaxS: 3,
  pulseRewindS: 0.04,
} as const;

/** The light of a lit counter, linear light: between two of the marks' inks (`LIT.inkShare`). */
export const LIT_INK: readonly [number, number, number] = [
  MARK_INKS.hover[0] + (MARK_INKS.selected[0] - MARK_INKS.hover[0]) * LIT.inkShare,
  MARK_INKS.hover[1] + (MARK_INKS.selected[1] - MARK_INKS.hover[1]) * LIT.inkShare,
  MARK_INKS.hover[2] + (MARK_INKS.selected[2] - MARK_INKS.hover[2]) * LIT.inkShare,
];

/**
 * How high the pulse of a counter first lit stands, 0 to 1, `t` seconds after it began: it rises quickly, falls
 * slowly, and is level (no slope) where it begins and where it ends, so that nothing about it starts or stops at a step.
 */
export function pulseOf(t: number): number {
  if (!(t > 0) || t >= LIT.pulseS) return 0;
  const s = Math.sin(Math.PI * Math.pow(t / LIT.pulseS, 0.8));
  return s * s;
}

/**
 * The cues of the game of orders (cues.ts): the fire a move would draw and the fire being drawn, with
 * their printed tags; routes in grease pencil; markers lying on hexes. Lengths in h, times in seconds
 * of the page's own capped frame time. Every dial of how they look and move is here.
 */
export const CUE = {
  /** A line, a tag or a route comes and goes in this long (a ramp, smoothed at both ends). */
  easeS: 0.15,
  // ---- lines of fire ------------------------------------------------------------------------------
  /** Fire being drawn now, and a declared attack: half the stroke's width, how solid it is, the length of its head in widths. */
  liveHalfWidth: 0.045,
  liveAlpha: 0.86,
  headWidths: 5,
  /** Fire a move would draw: thinner, lighter, broken into dashes (on, off). */
  wouldHalfWidth: 0.03,
  wouldAlpha: 0.62,
  wouldDash: [0.15, 0.11] as readonly [number, number],
  /** A line starts and ends this far from its two hex centres (under the counters standing there). */
  lineInset: 0.3,
  /** The height a stroke drawn on the sheet lies at (over the grid, under everything that lies on the board). */
  strokeZ: 0.0016,
  // ---- the printed tag beside a line ---------------------------------------------------------------
  /** Its letters' height; the room round them (along, across); its corner radius; its keyline's width. */
  tagLetter: 0.2,
  tagPad: [0.085, 0.07] as readonly [number, number],
  tagRadius: 0.05,
  tagKeyline: 0.016,
  /** The letters' stroke, as a share of their height. */
  tagWeight: 0.17,
  /** Its middle lies this far back from the hex fired at, along the line; a tag that would lie on another goes further back by this much at a time. */
  tagBack: 0.8,
  tagStep: 0.1,
  /** Clear card between two tags, and between a tag and a counter where the line has room to keep them apart. */
  tagGap: 0.05,
  /** It lies this far above what is under it (the board, a marker, a counter's face); its shadow's reach and strength. */
  tagLift: 0.004,
  tagShadow: 0.035,
  tagShadowAlpha: 0.34,
  // ---- routes ------------------------------------------------------------------------------------
  /** A grease-pencil stroke: half its width, how solid the wax is, how much the sheet's tooth breaks it up (0 none, 1 a lot). */
  routeHalfWidth: 0.027,
  routeAlpha: 0.8,
  routeWax: 0.75,
  /** Points on the curve round each corner of a route. */
  routeCorner: 5,
  // ---- markers -----------------------------------------------------------------------------------
  /** A marker is a hexagon of thin card: its size as a share of the hex (flat to flat), its thickness, the rounding of its corners. */
  markerSize: 0.97,
  markerThickness: 0.03,
  markerCorner: 0.06,
  /** It comes and goes in this long: slid in along the board from this far toward the viewer, growing from nothing. */
  markerS: 0.3,
  markerSlide: 0.35,
  /** A hair of offset and a few degrees of turn, by its hex and kind; a second marker on a hex lies this far off the first. */
  markerJitter: 0.012,
  markerTurnDeg: 2.2,
  markerSecond: [0.07, -0.05] as readonly [number, number],
  /** Its shadow on the sheet: how far it reaches and how dark it is. */
  markerShadow: 0.05,
  markerShadowAlpha: 0.42,
} as const;

/**
 * The chance of every target at once (the port's `chances`, chances.ts): a small card on each enemy a click would
 * attack, the chance of any effect on it and, smaller under that, the chance to destroy. Lengths in h. The card is laid
 * clear of every counter's numbers and of the other cards, on its own counter where it can be.
 */
export const CHANCE = {
  /** The chance's figures' height; the chance to destroy's, under them; the room between the two lines. (The card fits between a counter's title and its foot: 0.31 h.) */
  letter: 0.13,
  killLetter: 0.1,
  lineGap: 0.016,
  /** Between the chance and the small mark after it of the other ways to attack ("+C"), printed at the small letters' height. */
  markGap: 0.025,
  /** Room round the letters (along, across); the corner radius; the keyline; the best card's keyline. */
  pad: [0.04, 0.026] as readonly [number, number],
  radius: 0.04,
  keyline: 0.014,
  bestKeyline: 0.024,
  /** The letters' stroke, as a share of their height. */
  weight: 0.18,
  /** Clear card between a card and a counter, and between two cards. */
  gap: 0.03,
  /** How far further out the second ring of places is, when no place next to the counter is clear. */
  ring: 0.34,
  /** It lies this far above what is under it; its shadow's reach and strength. */
  lift: 0.005,
  shadow: 0.03,
  shadowAlpha: 0.3,
} as const;

/** The chance cards' inks, linear light. The best card is a brighter sheet with a keyline of the fire's ink. */
export const CHANCE_INKS = {
  paper: [0.84, 0.8, 0.68],
  bestPaper: [1.0, 0.97, 0.86],
  ink: [0.05, 0.04, 0.03],
  kill: [0.56, 0.07, 0.04],
  keyline: [0.2, 0.17, 0.13],
  bestKeyline: [0.56, 0.07, 0.04],
} as const;

/** The cues' inks, linear light, 0 to 1 (the fire ink is the marks' own). */
export const CUE_INKS = {
  /** A tag's card and keyline for fire that would be drawn; for fire being drawn the two change places. */
  tagPaper: [0.9, 0.86, 0.74],
  tagInk: [0.5, 0.06, 0.035],
  /** Grease pencil: a soft blue-black wax. */
  route: [0.045, 0.06, 0.1],
  shadow: [0.0, 0.0, 0.0],
} as const;
