/**
 * Where the live pieces of the settings screen, the scenario list and the side selector lie on the
 * stage: plain arithmetic, no browser. Every number is in stage pixels (the owner's sheets are the
 * stage's size and registered to one another), read off his finished pictures of the screens
 * (images/ui_sheets/2026-11-13-settings/, -side/) where he painted the thing, and the lead's or this
 * builder's choice where he did not (the slider labels, the opponent's sentence, the scenario list).
 */
import type { Box } from './layout';

/** A word or a line set by its middle. */
export interface Spot {
  x: number;
  y: number;
  /** Type size. */
  size: number;
}

/** A slider: where its value 0 lies across the stage, how far one step is, and where its knob sits. */
export interface SliderPlace {
  /** The middle of the scale's 0, and the distance between two of its numbers (his scale, measured). */
  zero: number;
  step: number;
  /** The knob's top, and how far its face's middle lies in from its left edge. */
  knobTop: number;
  /** The label, set to the left of the scale's 0: its right edge and its middle. */
  label: { right: number; y: number; size: number };
  /** Where a press or a drag takes hold of the slider (its rail, its scale and its knob). */
  hold: Box;
  /** The painted rail's plate, which the kit's spare rail is laid over. */
  rail: Box;
}

export const VOLUME_STEPS_SHOWN = 10;

/** Where a value lies along a slider (stage x of the knob's middle). */
export const sliderX = (s: SliderPlace, value: number): number => s.zero + value * s.step;
/** The value a stage x stands for on a slider, kept within 0 and 10 (not rounded: the knob follows a drag directly). */
export const sliderValue = (s: SliderPlace, x: number): number => Math.max(0, Math.min(VOLUME_STEPS_SHOWN, (x - s.zero) / s.step));

const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h });

export const SETTINGS_PLACES = {
  /** The heading strip's word. */
  heading: { x: 1377, y: 366, size: 108 } as Spot,
  /** The left page: its heading and its rule. */
  volumes: { x: 857, y: 619, size: 82 } as Spot,
  sliders: {
    music: { zero: 530, step: 63.5, knobTop: 722, label: { right: 522, y: 716, size: 32 }, hold: box(505, 696, 765, 186), rail: box(450, 755, 795, 97) } as SliderPlace,
    sound: { zero: 513, step: 64.9, knobTop: 983, label: { right: 505, y: 973, size: 32 }, hold: box(488, 955, 782, 190), rail: box(427, 1015, 815, 96) } as SliderPlace,
  },
  /** The right page: the opponent's three levels, the sentence about the chosen one, the three levels of detail. */
  difficulty: {
    heading: { x: 1933, y: 618, size: 70 } as Spot,
    buttons: [box(1530, 718, 234, 110), box(1825, 718, 232, 111), box(2116, 718, 240, 109)],
    /** The sentence about the chosen level (three lines at the most), between the two rows. */
    note: box(1440, 848, 950, 92),
    /** Its red frame has no word: a short foot. */
    foot: 14,
  },
  detail: {
    heading: { x: 1933, y: 974, size: 60 } as Spot,
    buttons: [box(1534, 1047, 243, 120), box(1836, 1046, 246, 118), box(2138, 1047, 239, 119)],
    /** Its red frame carries a word in its foot. */
    foot: 26,
  },
  /** The button inside each of the three button pictures (the upper row's, the lower row's, the lit one's), where it was cut. */
  buttonIn: {
    button: box(16, 14, 234, 110),
    buttonLower: box(16, 15, 243, 120),
    buttonLit: box(16, 15, 246, 118),
  },
  /** How far the red frame round a chosen button reaches out from it: left and right, and top (the foot is the row's). */
  frameOut: { side: 22, top: 22 },
  /** The two emblems at the right page's foot, laid back over a frame (it runs under them), and how far left of them the frame's word keeps. */
  emblems: { left: 2250, clear: 12 },
  frameWord: 34,
  buttonText: 58,
  /** The three tags (Apply, Cancel, Back) at the foot, each a copy of his blank steel tag: their top-left corners, and the words' middle within one. */
  tags: [
    [1593, 1378],
    [1942, 1378],
    [2291, 1378],
  ] as readonly (readonly [number, number])[],
  tagText: { x: 171, y: 60, size: 76 },
  /** The line that answers a press of a tag: its right edge and middle. */
  answer: { right: 1560, y: 1440 },
} as const;

/**
 * The right-hand page's two folder tabs (the owner painted "Files" on the first, which the cut covers, and left the
 * second blank; the screen writes both words, in one face and size) and the Advanced page behind the second: where a
 * press takes each tab, where its word sits, the page's heading, and its list of options. Measured on his finished
 * picture of the screen; the list is this builder's layout.
 */
export const ADVANCED_PLACES = {
  tabs: {
    files: { hit: box(1490, 452, 436, 62), word: { x: 1696, y: 487, size: 34 } as Spot },
    advanced: { hit: box(1930, 446, 456, 54), word: { x: 2158, y: 476, size: 34 } as Spot },
  },
  heading: { x: 1933, y: 618, size: 70 } as Spot,
  /**
   * The list of options: its column on the page (under the heading's rule, clear of the white pin and above the
   * emblems; past what it holds it scrolls), one row's height, its name's and its line's type sizes, the checkbox at
   * its end (its side, and how far in from the column's right), and how far the soft fade reaches in where there is more.
   */
  list: box(1468, 678, 862, 470),
  row: 104,
  nameSize: 44,
  lineSize: 25,
  check: { side: 54, right: 26 },
  fade: 40,
  /**
   * The six buttons he painted on the page, taken off it for this page, a row of three at a time: each `rows` box
   * (the buttons, their shadows, and the paler patch of paper each was painted on) is filled with paper made from the
   * page itself: its light from the paper just outside the box (each side's, smoothed along it over `smooth` pixels,
   * blended across the box), its grain from the clean paper between the two rows (`grain`), and its edges eased into
   * the page over `feather` pixels. `keepOut`: what lies just outside a box and is not paper (the white pin, the
   * emblems), left out when the light round it is read.
   */
  heal: {
    rows: [box(1488, 682, 932, 190), box(1488, 1012, 932, 196)] as readonly Box[],
    grain: box(1488, 874, 884, 132),
    keepOut: [box(2338, 624, 92, 84), box(2244, 1160, 250, 116)] as readonly Box[],
    smooth: 40,
    feather: 12,
  },
} as const;

/**
 * The About panel (about.ts), laid over the settings screen: the kit's steel frame cut in nine, its three columns of
 * words (who made the game, what it was made with, thanks), and a Close tag (his blank steel tag) hung on the frame's
 * foot at the right. Stage pixels; the words' sizes are the scenario list's on its own steel panel.
 */
export const ABOUT_PLACES = {
  panel: box(276, 150, 2200, 1170),
  /** Where the words lie inside the panel: clear of the frame's corners. */
  inner: box(150, 120, 1900, 900),
  titleSize: 86,
  headSize: 46,
  textSize: 31,
  smallSize: 25,
  /** Between the columns, and between the paragraphs of one. */
  gap: 84,
  space: 22,
  close: [2110, 1255] as readonly [number, number],
  closeText: { x: 171, y: 60, size: 70 },
} as const;

/** How tall the list's rows are together. */
export const optionsHeight = (n: number): number => n * ADVANCED_PLACES.row;
/** How far the list scrolls for `n` rows: nothing while they fit the page. */
export const optionsMost = (n: number): number => Math.max(0, optionsHeight(n) - ADVANCED_PLACES.list.h);

/**
 * The scroll that brings row `i` of `n` fully into view, clear of the fades, when the list is (or is on its way) at
 * `at`: `at` itself when it is already clear.
 */
export function optionShowing(i: number, at: number, n: number): number {
  const top = i * ADVANCED_PLACES.row;
  const foot = top + ADVANCED_PLACES.row;
  const above = i > 0 ? ADVANCED_PLACES.fade : 0;
  const below = i < n - 1 ? ADVANCED_PLACES.fade : 0;
  let to = at;
  if (top - above < at) to = top - above;
  else if (foot + below > at + ADVANCED_PLACES.list.h) to = foot + below - ADVANCED_PLACES.list.h;
  return Math.max(0, Math.min(optionsMost(n), to));
}

/** The spare rail's picture: its plate within it (in its own pixels), and how far each end cap reaches in. */
export const RAIL = { plate: box(3, 3, 747, 103), cap: 92 } as const;

/**
 * The spare rail laid over a painted rail's plate: scaled to the plate's height, its end caps kept
 * whole and its middle stretched to the plate's length. The element's box on the stage, and the width
 * its caps take there.
 */
export function railOver(plate: Box, picture: { w: number; h: number }): { box: Box; cap: number } {
  const s = plate.h / RAIL.plate.h;
  return {
    box: { x: plate.x - RAIL.plate.x * s, y: plate.y - RAIL.plate.y * s, w: plate.w + (picture.w - RAIL.plate.w) * s, h: picture.h * s },
    cap: RAIL.cap * s,
  };
}

/** A button's picture laid over a button's place: the picture's own box on the stage. */
export function buttonPicture(place: Box, picture: { w: number; h: number }, inside: Box): Box {
  const sx = place.w / inside.w;
  const sy = place.h / inside.h;
  return { x: place.x - inside.x * sx, y: place.y - inside.y * sy, w: picture.w * sx, h: picture.h * sy };
}

/** The red frame round a chosen button, with a foot of `foot` below it. */
export function frameRound(b: Box, foot: number): Box {
  const o = SETTINGS_PLACES.frameOut;
  return { x: b.x - o.side, y: b.y - o.top, w: b.w + 2 * o.side, h: b.h + o.top + foot };
}

/**
 * Where the word in a frame's foot is centred across the stage: under the frame's middle, or as far
 * left of the emblems as it must be to keep clear of them (`half` is half the word's width).
 */
export function frameWordX(frame: Box, half: number): number {
  const e = SETTINGS_PLACES.emblems;
  return Math.min(frame.x + frame.w / 2, e.left - e.clear - half);
}

export const SIDE_PLACES = {
  heading: { x: 1374, y: 374, size: 116 } as Spot,
  /** Each page: where it takes a click, its heading (the scenario's side) with the width the heading may take, the middle of its rays, the words on its button. */
  pages: [
    { page: box(330, 520, 960, 730), heading: { x: 858, y: 616, size: 92 } as Spot, headingWidth: 640, rays: { x: 905, y: 870 }, button: { x: 821, y: 1163, size: 60 } as Spot },
    { page: box(1395, 520, 1000, 730), heading: { x: 1975, y: 612, size: 88 } as Spot, headingWidth: 540, rays: { x: 1965, y: 860 }, button: { x: 1986, y: 1163, size: 60 } as Spot },
  ],
  /** The rays' and the halo's reach from their middle. */
  raysReach: 600,
  haloReach: 330,
  /** The words on the wide tag (Start) and the narrow one (Back), by their middles. */
  startText: { x: 1938, y: 1440, size: 86 } as Spot,
  backText: { x: 2462, y: 1440, size: 86 } as Spot,
  /** Multiplayer: the band that holds the invitation link (or a line on an invitation), between the pages and the tags. */
  invite: box(330, 1262, 2065, 96),
} as const;

/**
 * Which of a scenario's sides (0 moves first) each page shows: the first page is painted for the
 * German side, the second for the Soviet side; a scenario whose first side is the Soviet one has its
 * sides the other way round on the pages.
 */
export function pagesOf(sides: readonly [string, string]): readonly [0 | 1, 0 | 1] {
  const soviet = /soviet|russian|red army|ussr/i;
  return soviet.test(sides[0]) && !soviet.test(sides[1]) ? [1, 0] : [0, 1];
}

/** The type size at which a heading of `chars` letters fits `width` (the stencil face in capitals is about half its size wide a letter, measured), never above `most`. */
export function fittedSize(chars: number, width: number, most: number): number {
  return Math.max(24, Math.min(most, Math.floor(width / (Math.max(1, chars) * 0.5))));
}

export const SCENARIO_PLACES = {
  heading: { x: 1374, y: 374, size: 100 } as Spot,
  /** The steel panel over the notebook, and the room inside its frame. */
  panel: box(236, 452, 2280, 890),
  inside: box(340, 548, 2072, 698),
  /** The list: the first plate's place and the distance from one plate to the next. */
  plate: box(350, 560, 640, 129),
  plateGap: 140,
  /** A plate's name: its type size, and the most letters a name has at that size (a longer one is set smaller, to the same width). */
  plateText: { size: 70, letters: 19 },
  /**
   * The list's column: the room of five plates (the frame was laid out for five), with as much room above the
   * first as below the fifth, inside the frame's dark. Past five the plates scroll in it, clipped to it.
   */
  column: box(340, 517, 670, 775),
  /** How far the soft fade at the column's top and foot reaches in, where there is more above or below. */
  fade: 40,
  /** How many battles a press of PageUp or PageDown moves the hand: the five in view. */
  page: 5,
  /** The chosen scenario: its picture, and the block of words beside it. */
  picture: box(1070, 562, 640, 535),
  words: box(1760, 556, 640, 700),
  /** The words on the wide tag (on to the side selector) and the narrow one (Back). */
  nextText: { x: 1938, y: 1440, size: 86 } as Spot,
  backText: { x: 2462, y: 1440, size: 86 } as Spot,
} as const;

const LIST = SCENARIO_PLACES;

/** The type size of a battle's name on its plate in the list: the plate's own, or smaller for a name longer than the plate holds at it. */
export function listNameSize(chars: number): number {
  return fittedSize(chars, LIST.plateText.letters * LIST.plateText.size * 0.5, LIST.plateText.size);
}
/** The room above the first plate in the list's column (and below the last, when it is scrolled to the foot). */
const LIST_PAD = LIST.plate.y - LIST.column.y;

/** Where battle plate `i` lies within the list's column, scrolled to its top. */
export function listPlate(i: number): Box {
  return { x: LIST.plate.x - LIST.column.x, y: LIST_PAD + i * LIST.plateGap, w: LIST.plate.w, h: LIST.plate.h };
}

/** How tall the column's content is for `n` battles: never less than the column (five fill it exactly). */
export function listHeight(n: number): number {
  return Math.max(LIST.column.h, 2 * LIST_PAD + (n - 1) * LIST.plateGap + LIST.plate.h);
}

/** How far the column scrolls for `n` battles: nothing for five or fewer. */
export function listMost(n: number): number {
  return listHeight(n) - LIST.column.h;
}

/**
 * The scroll that brings plate `i` fully into view, clear of the fades, when the column is (or is on its way)
 * at `at`: `at` itself when the plate is already clear; else the plate is set as far in from the edge it came
 * past as the first plate lies from the top, within the scroll there is.
 */
export function listShowing(i: number, at: number, n: number): number {
  const p = listPlate(i);
  let to = at;
  if (p.y < at + LIST.fade) to = p.y - LIST_PAD;
  else if (p.y + p.h > at + LIST.column.h - LIST.fade) to = p.y + p.h + LIST_PAD - LIST.column.h;
  return Math.max(0, Math.min(listMost(n), to));
}
