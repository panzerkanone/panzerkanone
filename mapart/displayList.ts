/**
 * The display list: what the map art generator hands to the bake worker.
 *
 * See docs/art/map-art-spec.md section 2. The art generator (description file
 * in, display list out) is pure and deterministic; the worker only draws.
 *
 *   - Every op names a PLATE (one ink) and a MODE (draw, or erase to knock out).
 *   - All coordinates are in hex units: 1 = one hex across flats, x right, y
 *     down, the same world units as engine/core/hex.
 *   - Stock is white and the ground tint is itself a plate, so a pale road is
 *     a knock-out, not a white line.
 *   - Tones within a plate are painted opaque in list order; each plate is
 *     then multiplied onto the sheet once, at its registration offset.
 *   - One op per hex-sized cluster of shapes: never one path for the whole map
 *     and never one path per shape.
 *
 * Soft washes: a fill with a `feather` is the display list's whole statement of
 * softness. How the worker makes it soft (the spec's quarter-resolution field
 * raster) is the worker's business, not a separate op.
 *
 * This file is types only. Nothing here draws.
 */

/** Name of an ink plate, for example "ground", "wash", "green", "red", "black". */
export type PlateId = string;

/** draw lays ink on the plate; erase removes it (a knock-out). */
export type Mode = 'draw' | 'erase';

/** A closed outline as x0, y0, x1, y1, ... in hex units. */
export type Ring = readonly number[];

/** An open line as x0, y0, x1, y1, ... in hex units. */
export type Polyline = readonly number[];

/** A plate: its ink colour and how far it sits out of register. */
export interface Plate {
  id: PlateId;
  /** Ink colour as #rrggbb. Tone 1 is this colour; tone 0 is bare stock. */
  ink: string;
  /** Registration offset in hex units (0.005 to 0.011 in the spec). */
  offset: readonly [number, number];
}

interface OpBase {
  plate: PlateId;
  mode: Mode;
  /**
   * Strength from 0 to 1. In draw mode, how much ink is laid: 1 is the plate's
   * full ink, and a later op on the same plate replaces an earlier one where
   * they overlap. In erase mode, how much is taken away: 1 leaves bare stock,
   * 0.5 leaves half of what was there.
   */
  tone: number;
  /**
   * What the op depicts, for the checks that read a display list: "wash",
   * "crest", "canopy", "road-fill" and so on. The reserved names are listed
   * in docs/bars/M3a.md; anything else (a shadow, an outline, a roof) takes a
   * name of its own. Never read by the bake.
   */
  feature: string;
}

/** Filled rings, even-odd. Tints, washes, roofs, wedge hachures. */
export interface FillOp extends OpBase {
  op: 'fill';
  rings: readonly Ring[];
  /**
   * Soft edge, in hex units: the whole width of the band over which the fill
   * fades, centred on the ring (half inside it, half outside), falling
   * smoothly and never rising again. Absent means a crisp edge.
   */
  feather?: number;
}

/**
 * A centre line with a half-width at each point. Roads, tapering rivers, inked
 * lines of varying weight. A cased line is two ribbons, not one: every casing
 * of a network is listed first and every fill after, so that junctions merge.
 */
export interface RibbonOp extends OpBase {
  op: 'ribbon';
  line: Polyline;
  /** One half-width per point of `line`, in hex units. */
  halfWidths: readonly number[];
  /** Dash and gap lengths in hex units, when the line is dashed. */
  dash?: readonly number[];
}

/** One shape placed many times. Canopies, hatch clusters, reeds, rocks. */
export interface StampOp extends OpBase {
  op: 'stamp';
  /** Key into DisplayList.shapes. */
  shape: string;
  /**
   * Per placement, five numbers: x, y, rotation in radians, scale across,
   * scale down. The shape is scaled first, in its own axes, then turned, then
   * moved to (x, y). A negative scale across mirrors the shape. One tone per
   * op: shapes that differ in tone go in separate ops.
   */
  placements: readonly number[];
}

/** Strokes clipped to rings. Furrows, stipple. */
export interface PatternOp extends OpBase {
  op: 'pattern';
  clip: readonly Ring[];
  strokes: readonly Polyline[];
  /** Stroke width in hex units. */
  width: number;
}

/**
 * Lettering as outlines. Glyph outlines are taken from the font when the list
 * is built, so the worker loads no fonts and text is the same in every browser.
 */
export interface GlyphsOp extends OpBase {
  op: 'glyphs';
  /** The text these glyphs spell, for the checks. Never read by the bake. */
  text: string;
  /** Key into DisplayList.shapes for each glyph's outline, drawn around the origin at size 1. */
  shapes: readonly string[];
  /**
   * Per glyph, six numbers: the transform a, b, c, d, e, f that places it
   * (x' = a x + c y + e, y' = b x + d y + f), so text can run straight or along
   * a path.
   */
  transforms: readonly number[];
}

export type DisplayOp = FillOp | RibbonOp | StampOp | PatternOp | GlyphsOp;

/**
 * The paper's grain (docs/bars/M3b.md, the owner's O5 and ruling 14): a fine
 * speckle over the whole sheet, drawn by the bake after the last plate. It
 * belongs to the board, not to a tile: its value at a place depends on that
 * place, the seed and the bake level only. A list without this entry bakes
 * with no grain.
 *
 * The grain of a pixel is built from cells of `scale` h, halved until a cell
 * is one pixel of the level being baked: a cell's value is `carry` times its
 * parent cell's value plus sqrt(1 - carry^2) times a fresh value of its own
 * (the coarsest cell is all its own), each fresh value drawn from hash(seed,
 * cell size, cell) with mean 0. The pixel is lightened or darkened by
 * `amplitude` (a share of white) times that value: the same amount on every
 * channel, mean 0, standard deviation `amplitude`.
 */
export interface Paper {
  /** Whole number: the map's art seed. */
  seed: number;
  /** Standard deviation of the grain, as a share of white (0.01 is about 2.5 of 255). */
  amplitude: number;
  /** The coarsest cell, in hex units. */
  scale: number;
  /** The share of a cell's value that its four quarters keep, from 0 to 0.95. */
  carry: number;
}

export interface DisplayList {
  /** Hex units, as engine/core/hex world units. */
  units: 'hex';
  /**
   * minX, minY, maxX, maxY of the board rectangle (worldBounds of the map's
   * grid). Lines that leave the map run a little past it; a bake is cut to it.
   */
  bounds: readonly [number, number, number, number];
  /** Plates in the order they are multiplied onto the sheet. */
  plates: readonly Plate[];
  /** Shapes used by stamp ops: name to rings around the origin. */
  shapes: Readonly<Record<string, readonly Ring[]>>;
  /** Ops in paint order. */
  ops: readonly DisplayOp[];
  /** The paper's grain, when the sheet has one. */
  paper?: Paper;
}
