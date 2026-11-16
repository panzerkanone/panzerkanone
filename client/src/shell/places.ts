/**
 * The places of the title screen's moving things on the owner's painting, and the numbers their
 * look is tuned by. Data only: positions are pixels of the frame (2752 by 1536: the stage's own
 * pixels, stage.ts), found on his sheets; where he painted a thing of the same kind (the whole
 * painting, `...ifompd...`), ours stands where his does.
 *
 * `?marks=1` in the address draws every place on the screen, to check them against the painting.
 */

export type Rgb = readonly [number, number, number];

/** The wind blows this way: the smoke leans to the right, as his does. */
export const WIND = 1;

// ---- the layers' slow drift -----------------------------------------------------------------------

export const DRIFT = {
  /** Each layer is drawn this much larger than the window needs, so that its drift never shows an edge. */
  over: 0.006,
  /** The breathing zoom: the share it adds at its fullest, and the seconds of one breath. */
  breath: 0.006,
  breathS: 46,
  /**
   * How far each layer wanders, in frame pixels, and the seconds of its two wanderings. A layer with
   * a picture may wander, kick included, no farther than `over` lets it: half of `over` of the
   * frame's width sideways (8 pixels), of its height up and down (4.6); a test holds them to it.
   */
  back: { x: 2, y: 0.9, sx: 61, sy: 43 },
  tanks: { x: 4.5, y: 1.8, sx: 61, sy: 43 },
  front: { x: 9, y: 4, sx: 61, sy: 43 },
  /** A shot's kick: the tanks' layer jumps this many frame pixels away from the gun and settles in this many seconds. */
  kick: 3,
  kickS: 0.5,
} as const;

/** Seconds the picture takes to come up from black when the page opens, and the title lettering to follow. */
export const OPENING = { picture: 1.6, title: 1.4, titleAfter: 0.5, titleRise: 14 } as const;

// ---- behind the tanks ----------------------------------------------------------------------------

export interface Column {
  /** Where it rises from (hidden behind the tanks' ground or a hull). */
  x: number;
  y: number;
  /** How high it rises and how far the wind carries its top, in frame pixels. */
  rise: number;
  lean: number;
  /** A puff's width at its foot; it ends `grow` times as wide. */
  size: number;
  grow: number;
  /** Seconds a puff lives, and seconds between puffs. */
  life: number;
  every: number;
  /** How dark and how dense: the puff's cover at its fullest. */
  cover: number;
  /** A fire at its foot: its height in frame pixels; 0 for none. */
  fire: number;
}

/** The smoke columns: his tall plume right of the middle, the cloud behind the Tiger, and the two burning wrecks at the edges. */
export const COLUMNS: readonly Column[] = [
  { x: 2052, y: 800, rise: 720, lean: 560, size: 104, grow: 6, life: 22, every: 0.45, cover: 0.88, fire: 0 },
  { x: 1004, y: 790, rise: 500, lean: 400, size: 72, grow: 5, life: 18, every: 0.56, cover: 0.66, fire: 0 },
  { x: 232, y: 866, rise: 400, lean: 360, size: 46, grow: 4.8, life: 17, every: 0.6, cover: 0.7, fire: 66 },
  { x: 2612, y: 940, rise: 360, lean: 300, size: 42, grow: 4.8, life: 16, every: 0.62, cover: 0.66, fire: 58 },
];

/** The smoke's colour at a column's foot and at its top (it thins and pales as it rises), and the dust's. */
export const SMOKE_DARK: Rgb = [46, 43, 45];
export const SMOKE_PALE: Rgb = [88, 86, 92];
export const DUST: Rgb = [176, 160, 140];
/** A gun's smoke: a warm grey. */
export const GUN_SMOKE: Rgb = [166, 160, 152];

/**
 * The slow storm: dark masses of cloud that cross the upper sky with the wind, in two layers. How
 * many masses a frame's width holds, their width in frame pixels, their cover, the rows of the frame
 * the band of them lies between (it thins away toward its lower edge), and the frame pixels a second
 * each layer moves.
 */
export const STORM = { count: 14, size: [800, 1400], cover: [0.16, 0.32], band: [-220, 720], speed: [7.5, 12.5] } as const;
/**
 * The empty battlefield's sky is lighter and bluer than the sky of his finished look. It is brought
 * toward that one: darkened toward its top (`cover`: the cover of black at the top edge) and greyed
 * (`grey`: how much of its colour is taken out at the top edge), both falling to none at `to` of the
 * frame's height, about where the horizon lies.
 */
export const SKY_SHADE = { cover: 0.5, grey: 0.72, to: 0.68 } as const;
/**
 * His horizon burns: a warm band along it, warmer and stronger than the empty battlefield's pale
 * skyline. `at` is its middle and `reach` its half-height, as shares of the frame's height; the band
 * is laid on once when the picture is sized: `tint` multiplied over it at `tinted`, then `glow` added
 * as light at `glowing` (strongest at its middle, and at its ends, where the wrecks burn).
 */
export const HORIZON = { at: 0.57, reach: 0.11, tint: [255, 190, 140], tinted: 0.55, glow: [255, 112, 44], glowing: 0.32 } as const;

/** Where far shells burst: on the skyline, their foot hidden by the tanks' ground. x, y, and the burst's width in frame pixels. */
export const BURSTS: readonly (readonly [number, number, number])[] = [
  [96, 880, 150],
  [212, 874, 110],
  [352, 884, 96],
  [1786, 884, 120],
  [2470, 948, 130],
  [2700, 978, 170],
];

/** Where guns flash beyond the horizon and light the cloud above: x, y, and the light's reach in frame pixels. */
export const GLOWS: readonly (readonly [number, number, number])[] = [
  [330, 860, 560],
  [860, 840, 480],
  [1500, 850, 520],
  [1900, 860, 600],
  [2520, 900, 620],
];

/** The lanes tracers fly along, far off: from x, y to x, y. His run toward a point low in the middle. */
export const LANES: readonly (readonly [number, number, number, number])[] = [
  [-120, 548, 1020, 792],
  [-120, 668, 760, 812],
  [2872, 726, 1880, 842],
  [2872, 842, 2100, 880],
  [520, 800, 1180, 822],
  [2380, 902, 1790, 868],
];

// ---- at the tanks --------------------------------------------------------------------------------

export interface Gun {
  /** The muzzle on the frame. */
  x: number;
  y: number;
  /** The way the round leaves, as the painting shows it (a unit vector; y grows downward). */
  dx: number;
  dy: number;
  /** The flash's width in frame pixels: the gun's nearness. */
  size: number;
  /** Where dust jumps from the ground under the blast, and how wide. */
  dust: readonly [number, number, number];
  /** How loud, of 1. */
  loud: number;
}

/** The three muzzles: the Tiger's, in front at the top left; the left tank's; the right tank's. */
export const GUNS: readonly Gun[] = [
  { x: 236, y: 242, dx: -0.913, dy: -0.408, size: 760, dust: [1250, 1210, 520], loud: 0.5 },
  { x: 366, y: 716, dx: -0.981, dy: -0.193, size: 220, dust: [380, 926, 260], loud: 0.3 },
  { x: 2526, y: 728, dx: 0.959, dy: -0.283, size: 220, dust: [2480, 1076, 280], loud: 0.3 },
];

/** Where a shell lands on the near ground: x, y, and the burst's width in frame pixels. */
export const STRIKES: readonly (readonly [number, number, number])[] = [
  [1010, 1030, 300],
  [1880, 1052, 320],
  [2330, 1272, 380],
];

// ---- in front ------------------------------------------------------------------------------------

/** The embers: how many, the part of the frame they rise from (x, y, width, height), and how they fly. */
export const EMBERS = {
  count: 64,
  from: [1820, 1040, 1000, 540],
  /** Frame pixels a second, to the left and upward, least and most. */
  speed: [40, 150],
  lifeS: [3.5, 8],
  /** A spark's width in frame pixels. */
  size: [3, 6.5],
} as const;
/** The ash: dark flecks that drift down across the whole picture. */
export const ASH = { count: 26, lifeS: [7, 14], size: [2, 5], speed: [26, 70] } as const;
/** The dust that drifts low over the ground in front. */
export const GROUND_DUST = { count: 6, size: [620, 980], cover: [0.07, 0.13], crossS: [70, 120], y: [1040, 1330] } as const;

// ---- the PLAY GAME medallion ----------------------------------------------------------------------

/**
 * The medallion that waits over the title until the page is first pressed (play.ts), and the live
 * medallion's look (client/src/medallion). Places are on the frame; the medallion's own box is its 2D
 * cut's (the index of the art, manifest.ts). The halo and the 2D sweep are for a screen that cannot draw
 * the live one: there the 2D cut stays, and takes the ablaze cut with a soft halo when hot.
 */
export const PLAY = {
  /**
   * Where a press takes it, in its box's own pixels (its cut's: 803 by 680): the round disc (middle and
   * reach), the big plate and the small plate (x, y, width, height). A press in the box's empty corners
   * is a press on the painting.
   */
  hit: { disc: [401, 273, 268], plate: [15, 241, 775, 212], tag: [154, 537, 494, 118] },
  /**
   * The halo that hugs its outline when hot, as on the owner's ablaze sheet (the medallion's own shape,
   * blurred, in orange: a near one and a far one): their reach in its box's pixels and their cover.
   */
  halo: { near: 9, nearCover: 0.9, far: 30, farCover: 0.55 },
  /** Seconds, for the 2D medallion: hot and cool, held, its fading away on the press, its flare at a press elsewhere. */
  ease: { hot: 0.22, down: 0.08, gone: 0.65, pulse: 0.8 },
  /**
   * The 2D medallion's sweep at rest, a soft band of light across its metal, brightest on the bright
   * metal: seconds from one to the next, the share of those it takes to cross, and its strength.
   */
  sweep: { every: 7.5, share: 0.2, strength: 0.55 },
  /** The live medallion's canvas (client/src/medallion): how far it reaches past the cut's box at each side and above it, in stage pixels (below, it runs to the stage's foot). Its fire and its embers need the room. */
  canvas: { side: 420, above: 480 },
  /** The live medallion's look (client/src/medallion: MedallionLook). */
  model: {
    sweepEvery: 7.5, sweepS: 1.6, sweepLight: 1.15, sweepHigh: 520, sweepHotAfter: 1.1, sweepHotEvery: 4.4, surge: 1.0, surgeWide: 95, turn: 6, press: 0.05, fireDetail: 0.5, igniteS: 0.7, coolS: 0.9, easeS: 0.16, pressS: 0.05,
    pointerLight: 0.55, pointerHigh: 300, emberMore: 0.1, emberLife: [1.3, 2.8], ashLife: 1.7, emberRise: 36,
    smoulderEvery: 6.5, smoulderS: [1.8, 3.0], smoulderLevel: [0.55, 0.75], breath: 0.18, breathS: 5.2, teaseAfter: 17, teaseEvery: 15, teaseS: 1.8, teaseLevel: 0.8,
    burst: 240, burstSpeed: [420, 1500], burstLife: [0.6, 1.6], goneS: 1.8,
  },
} as const;

/** With `prefers-reduced-motion`: the screen is still but for the smoke, which drifts at this share of its speed. */
export const REDUCED_RATE = 0.35;
/** The animation is drawn this many times a second. */
export const FRAMES_PER_SECOND = 30;

/** Where an event of the timetable happens, on the frame: its kind's place of that number (a lane's start, for tracers). */
export function placeOf(kind: 'shot' | 'burst' | 'strike' | 'glow' | 'tracers', place: number): readonly [number, number] {
  const at = kind === 'shot' ? GUNS[place] : kind === 'burst' ? BURSTS[place] : kind === 'strike' ? STRIKES[place] : kind === 'glow' ? GLOWS[place] : LANES[place];
  if (at === undefined) throw new Error(`there is no place ${place} for a ${kind}`);
  return 'x' in at ? [at.x, at.y] : [at[0], at[1]];
}
