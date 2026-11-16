/**
 * What the table page publishes on `window.__table` for the checks
 * (docs/bars/M4a.md, "Page settings and window.__table"). Types only: nothing
 * here needs a browser, so scripts/scenecheck.ts reads them too.
 *
 * Every position is in the board frame: x and y are the world coordinates of
 * engine/core/hex.ts in h (x right, y down the board), z is height in h above
 * the printed surface.
 */
import type { ViewMode } from './camera';
import type { RulerNumber } from './grid';
import type { AnswersHook, FxHook } from './fx/hook';
import type { PiecesHook } from './pieces/hook';
import type { TierName } from './tiers';

export type RectTuple = [x0: number, y0: number, x1: number, y1: number];

export interface ViewReading {
  mode: ViewMode;
  centre: [number, number];
  hexesAcross: number;
}

export interface CameraReading {
  /** 16 numbers, column-major: board frame to clip space, the matrix the last frame was drawn with. */
  viewProj: number[];
  position: [number, number, number];
  target: [number, number, number];
  /** Tilt from straight down. */
  tiltDeg: number;
  fovYDeg: number;
}

/**
 * A camera for checks only. `azimuthDeg` is where the camera stands round the
 * target, measured from the near side of the board (+y) toward the right (+x):
 * 0 looks up the board as the player does, 90 looks from the right-hand side.
 * `elevationDeg` is its height above the table plane (90 is straight down).
 * `distance` is in h. `target` is [x, y] on the printed surface, or [x, y, z].
 * (`look.keyAzimuthDeg` is where the key light stands, the same way.)
 */
export interface FreeCamera {
  azimuthDeg: number;
  elevationDeg: number;
  distance: number;
  target: [number, number] | [number, number, number];
}

export interface OverlayReading {
  /** 0 to 1; it scales every part of the overlay, and 0 hides it. */
  strength: number;
  lines: boolean;
  labels: boolean;
  /** The lines that bar sight (crests, ridges, separators and the green sides of tree sides), drawn over the grid. */
  sight: boolean;
  /** How many hexsides carry such a line on this board. */
  sightSides: number;
  /**
   * Set name (`reach`, `fire`, `selection`, ...) to hex ids. `reachNear` is the nearer part of the reach (the
   * counters' port, `reachNear`): the hexes that carry its stronger shade, which are always hexes of `reach`.
   */
  tints: Record<string, number[]>;
  /** The overlay's ink, sRGB 0..255. At full strength a covered pixel is the board's colour times this ink (in linear light). */
  ink: [number, number, number];
  /** The ink of each tint set, sRGB 0..255. */
  tintInks: Record<string, [number, number, number]>;
  /** The tints as the table hands them to a page for a legend (`TableControls.tints`): a game's kinds in order, each with its colour as CSS. */
  legend: { kind: string; colour: string }[];
  /** For each labelled hex: its id, its text, and the box its number is drawn inside (four board points). */
  labelBoxes(): { hex: number; text: string; box: [[number, number], [number, number], [number, number], [number, number]] }[];
  /** The numbers of the rulers in the margin. */
  rulers(): RulerNumber[];
}

export interface LookReading {
  grade: boolean;
  vignette: boolean;
  /** The warm grade: a gain on red, green and blue in linear light. */
  gradeGain: [number, number, number];
  vignetteStrength: number;
  /** Where the key light stands, as a FreeCamera's azimuth and elevation. */
  keyAzimuthDeg: number;
  keyElevationDeg: number;
  /** `mounted` (ruling 32), or `old`: the former construction, kept for comparison. */
  construction: 'mounted' | 'old';
  /** The mounted boards' dials, in h: the width of wrap round a sheet, the space between two boards, a board's corner radius. */
  border: number;
  gap: number;
  cornerRadius: number;
  /** The covering paper, sRGB 0..255. */
  brown: [number, number, number];
  /** Strength of the wrap's folds at the corners and of its wear, 0 to 2 (1 as built). */
  folds: number;
  wrapWear: number;
}

/**
 * What `setLook` takes. Beyond `grade` and `vignette` every field is for checks
 * and comparisons only (no input reaches it): the dials of the mounted boards,
 * and `construction: 'old'`, which draws the first build's board (one outline,
 * the white margin to the edge, a groove at each seam) at the same camera.
 */
export interface LookRequest {
  grade?: boolean;
  vignette?: boolean;
  /** The lamp's reflection on the sheet and the table, as a share of its own strength (0 none, 1 as built). */
  lamp?: number;
  construction?: 'mounted' | 'old';
  border?: number;
  gap?: number;
  cornerRadius?: number;
  brown?: [number, number, number];
  folds?: number;
  wrapWear?: number;
}

/** A glide of the view to a set of hexes (the table's `goTo`), while it is in progress. */
export interface GlideReading {
  /** Where it is going: the centre play will have, and the zoom in hexes across. */
  centre: [number, number];
  hexesAcross: number;
  /** The hexes asked for (those that are on the board). */
  hexes: number[];
  /** The centre has arrived; only the zoom is still easing. */
  centred: boolean;
}

export interface TierReading {
  name: TierName;
  chosenBy: 'auto' | 'player';
  pixelRatio: number;
  msaaSamples: number;
  tilt: boolean;
  lit: boolean;
  surfaceDetail: boolean;
  changes: { atMs: number; from: TierName; to: TierName }[];
  /**
   * What the step-down is measured from: `gpu` (a timer query round every frame) or, where the browser
   * has none, `interval` (the time between frames, and every third frame timed until the GPU has finished it).
   */
  measuredBy: 'gpu' | 'interval';
}

export interface TilesReading {
  level0: { pxPerHex: number; megapixels: number };
  capMegapixels: number;
  /** One tile with its gutters, in megapixels (a megapixel is a million pixels). */
  tileMegapixels: number;
  residentMegapixels: number;
  /** Tile keys `level:i:j` of levels 1 and 2. Level 0 is always held whole and is not listed. */
  resident: string[];
  /** The tiles drawn in the last frame. */
  shown: string[];
  pending: number;
  /** The level the last frame asked for: L* of the level rule. */
  level: number;
}

/**
 * The page's hook. What the pieces add (`pieces`, `selected`, `order`, `home`, `reset`, `physics`,
 * `piecesPort`, `piecesInfo`: see pieces/hook.ts) is there once the board is up, unless the address
 * says `pieces=0`.
 */
export interface TableHook extends Partial<PiecesHook> {
  /** The first complete frame has been drawn. */
  ready: boolean;
  /** The last error, or null. */
  error: string | null;
  /** Whether a WebGL 2 context was found. */
  webgl2: boolean;
  /** performance.now() at the first complete frame. */
  firstFrameMs: number | null;
  /**
   * Frames drawn since load. A frame drawn only because a lasting effect is alive (smoke drifting, a
   * wreck burning: `fx.lasting`) is not counted here but in `fx.ambientFrames`, so that this number
   * stands still when the table is at rest: nothing moving, no short effect alive (`fx.bursts` is 0).
   */
  frames: number;
  /** Draw calls in the last frame. */
  drawCalls: number;
  /** Triangles in the last frame. */
  triangles: number;
  /** Draw one frame now, synchronously. */
  drawOnce(): void;
  map: { id: string; cols: number; rows: number; bounds: RectTuple; hash: string | null };
  /** Display lists built. */
  builds: number;
  /** Bakes asked of the worker. */
  bakes: { level0: number; tiles: number };
  /** The three boards, left to right. `rimWidth` is how far in from a board's edge its wear reaches: the border. */
  slabs: { rect: RectTuple; cornerRadius: number; thickness: number; rimWidth: number }[];
  /** The printed sheet on each board: the board's rectangle inset by `border` on every side, its corners rounded to follow. */
  sheets: { rect: RectTuple; cornerRadius: number }[];
  /** x of each seam line: the middle of each joint. */
  seams: number[];
  /** Width of wrap that shows round a sheet, in h (0 in the former construction). */
  border: number;
  /** The space between two boards, in h (0 in the former construction). */
  gap: number;
  /** Equal to `gap`, for older scripts. (In the former construction: the groove's width.) */
  grooveWidth: number;
  /** Width of the unprinted margin round the map's rectangle. */
  margin: number;
  table: { rect: RectTuple; z: number };
  readonly camera: CameraReading;
  readonly screen: { css: [number, number]; device: [number, number]; pixelRatio: number };
  readonly view: ViewReading;
  /** Hexes across at the closest and the farthest zoom of play, and in the overview. */
  readonly limits: { closest: number; farthest: number; overview: number };
  /** Apply a view, clamped as input would be; returns what it applied. */
  setView(v: { centre?: [number, number]; hexesAcross?: number; mode?: ViewMode }): ViewReading;
  /** Checks only: place the camera anywhere; null gives back the player's camera. */
  setCamera(c: FreeCamera | null): void;
  /**
   * `goTo` as the table hands it to a page (`TableControls` in table.ts): the play view glides, eased, to where
   * these hexes are all in it; nothing moves when they are in view already.
   */
  goTo(hexes: readonly number[]): void;
  /** The glide that a `goTo` began, while it is in progress (its centre gliding, or its zoom still easing); null when there is none. */
  readonly glide: GlideReading | null;
  /**
   * What became of every `goTo` since load. `asked`: calls. `begun`: glides begun. `still`: the hexes were in view
   * already (or the view could come no nearer), and nothing moved. `held`: the player was holding the view (a hand
   * on the board, a key held that slides or zooms it), and it was left to them. `arrived`: glides that reached
   * their goal. `taken`: glides ended short of it, by the player's input or by another `goTo`.
   */
  readonly glides: { asked: number; begun: number; still: number; held: number; arrived: number; taken: number };
  /** `event.key` values: the keys that pan each way, zoom in and out, and switch the overview. */
  keys: { left: string[]; right: string[]; up: string[]; down: string[]; zoomIn: string[]; zoomOut: string[]; overview: string[] };
  /** What the ray through the centre of each corner pixel hits: top-left, top-right, bottom-right, bottom-left. */
  corners(): ('table' | 'slab' | 'none')[];
  /** The hex under a CSS-pixel point, -1 off the board. */
  pick(cssX: number, cssY: number): number;
  /** The middle of a hex on the printed surface, in h; null for a number that is no hex of this board. */
  centreOf(hex: number): [number, number] | null;
  /** The hex under the last pointer position, -1 off the board or before any. */
  hover: number;
  readonly tiles: TilesReading;
  /** Every texture the page holds on the GPU, mip levels counted. */
  readonly textures: { count: number; bytes: number };
  readonly overlay: OverlayReading;
  setOverlay(o: { strength?: number; lines?: boolean; labels?: boolean; sight?: boolean; tints?: Record<string, number[]> }): void;
  readonly look: LookReading;
  setLook(l: LookRequest): void;
  readonly tier: TierReading;
  /** The player's choice of tier; null returns the choice to the page. */
  setTier(t: TierName | null): void;
  context: { losses: number; restores: number; lastRestoredMs: number | null };
  /** The settings the page read from its address, and any it did not understand. */
  settings: { faults: string[]; stressMs: number; bench: boolean; ignored: string[] };
  /** Times of the start: the worker's list, level 0, and the first frame, in ms. */
  timings: { buildMs: number | null; level0Ms: number | null; lastTileMs: number | null };
  /** The effects (fire, blast, smoke: fx/hook.ts), once the board is up; absent when the address says `fx=0`. */
  fx?: FxHook;
  /** The table's answers to what a player does (what a click would do, badges, refusals: fx/answers.ts), once the counters are on the table. They stay with `fx=0`. */
  answers?: AnswersHook;
  /**
   * The dice inset (dice/inset.ts), with the counters: where its picture is on the screen (CSS pixels), how far in it is
   * (0 to 1), and the draws its camera made in the last frame; and `on`, false when the address says `dice=0`. `skip`
   * is for a check that times frames: while it is true the picture is not drawn.
   */
  diceInset?: { readonly rect: { x: number; y: number; w: number; h: number; shown: number }; readonly drawCalls: number; readonly on: boolean; skip: boolean };
  /** Things on the table (scene/props), for checks: what lies where (board frame, h; yaw in radians); absent when they are off. */
  props?: readonly { readonly id: string; readonly kind: string; readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }[];
  /** The room round the table (scene/env.ts), for checks: which, and how long its panorama took to decode and to prefilter (ms); absent with none. */
  room?: { readonly name: string; readonly ms: { decode: number; prefilter: number } };
}
