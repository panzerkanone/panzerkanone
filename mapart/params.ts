/**
 * The data the map art reads besides the map itself: the art parameters, the
 * ink table and the lettering outlines. All three are data files (YAML or
 * JSON), checked on load in the manner of engine/core/map.ts: every key is
 * required unless stated, an unknown key is refused, and each problem is
 * named with its place. Nothing has a silent default.
 *
 *   mapart/data/params.yaml                  art parameters
 *   mapart/data/inks-a2.yaml                 ink table A2, version 1
 *   mapart/data/lettering/board-lettering.json  glyph outlines (OFL 1.1: the file carries its copyright
 *                                                notice and licence; the record is SOURCE.yaml there)
 *   mapart/data/params-winter.yaml           the winter set: what winter changes of the parameters,
 *                                                and what winter draws on top of the summer art
 *   mapart/data/inks-winter.yaml             the winter ink table: summer's, with one colour transform
 *                                                (mapart/seasonInks.ts)
 *
 * A board is printed for its season (engine/core/map.ts `seasonOf`): a summer
 * board from the first two files, a winter board from the winter ink table and
 * the parameters with the winter file's changes made. `seasonArt` gives the
 * data a season prints from; a winter board with art data that has no winter
 * set is refused, never printed as summer.
 */
import { parse as parseText } from 'yaml';
import { deriveSeasonInks, validateSeasonInks } from './seasonInks';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlateAssignment {
  ground: string;
  wash: string;
  fieldTint: string;
  furrow: string;
  swampTint: string;
  swampWater: string;
  swampReed: string;
  rough: string;
  river: string;
  canopy: string;
  buildingOutline: string;
  separator: string;
  ridge: string;
  crest: string;
  roadCasing: string;
  bridge: string;
  spotHeight: string;
  townName: string;
  roadKnockout: string[];
}

export interface ArtParams {
  format: string;
  plates: PlateAssignment;
  precision: number;
  ground: { bleed: number };
  wash: { ringOffset: number; feather: number; eraseFeather: number; tone: number; gridStep: number; simplify: number; mergeDistance: number };
  hillLines: { crestHalfWidth: number; ridgeHalfWidth: number; separatorHalfWidth: number };
  spotHeight: { triangleWidth: number; triangleHeight: number; numberSize: number; gap: number; clearance: number; woodedClearance: number };
  roads: {
    casingHalfWidth: number; fillHalfWidth: number; tangentBlend: number; handle: number; wobble: number;
    segmentsPerHex: number; offMapLength: number;
    /** The tone of the casing: the two lines either side of the bare road. */
    casingTone: number;
  };
  rivers: {
    bankHalfWidth: number; waterHalfWidth: number; bankTone: number; waterTone: number; tangentBlend: number;
    handle: number; meander: number; segmentsPerHex: number;
    /** A river that joins another (a tributary) is drawn this share of a river's widths. */
    tributaryWidth: number;
    /** Where a tributary meets its river, how far it has turned into the river's flow: 0 comes straight in, 1 runs in along it. */
    confluence: number;
    /** A stream that rises at a spring (the map's `springs`) is drawn this share of a river's widths... */
    springWidth: number;
    /** ...and widens from nothing over this length from its spring, in h. */
    springTaper: number;
  };
  bridges: { railGap: number; railLength: number; railHalfWidth: number; flare: number };
  woods: {
    latticePitch: number; spacing: number; canopySize: number; sizeVariation: number; turn: number; squash: number;
    edgeMargin: number; edgeMarginVariation: number; roadClearance: number; riverClearance: number;
    hillLineClearance: number; hilltopInset: number; numberedHilltopInset: number; outlineScale: number; outlineTone: number;
    bodyTone: number; highlightScale: number; highlightShift: number; highlightTone: number;
  };
  towns: {
    inset: number; roadGap: number; riverClearance: number; lotDepth: number; lotDepthMax: number; lotDepthMin: number; lotFrontMin: number;
    lotFrontMax: number; bigLotShare: number; emptyShare: number; edgeOpenShare: number; lotMargin: number; buildingGap: number; frontageStretch: number;
    rowShare: number; coverMin: number; coverMax: number; baseSize: number; scaleVariation: number;
    inks: Record<'brown' | 'tan' | 'gray' | 'green', { plate: string; tone: number; roofLine: number }>;
    hipTopTone: number; outlineTone: number; outlineHalfWidth: number; roofLineWidth: number;
    types: Record<string, { family: string; width: number; height: number; first: number; other: number; roof: string }>;
  };
  fields: {
    inset: number; gap: number; spacing: number; strokeWidth: number; minStroke: number; tintTone: number; furrowTone: number;
    roadGap: number; layoutWeights: number[];
  };
  swamp: {
    tintTone: number; pitch: number; inset: number; dashLengthMin: number; dashLengthMax: number; dashHalfWidth: number;
    dashTone: number; reedShare: number; reedHeight: number; reedTone: number; roadClearance: number; riverClearance: number;
  };
  rough: {
    pitch: number; inset: number; dotRadiusMin: number; dotRadiusMax: number; stoneShare: number;
    stoneRadiusMin: number; stoneRadiusMax: number; tone: number; roadClearance: number; riverClearance: number;
  };
  lettering: { townSize: number; tracking: number; townOffset: number; margin: number };
  /**
   * Woods from tree sides (mapart/treeSides.ts): the field, the lattice pass, the clumps, the masks
   * beside roads and streams, the green sides. Read only by a map that has a `trees` layer.
   */
  treeSides: {
    plate: string;
    threshold: number; sideStrength: number; helperStrength: number; strengthScale: number; sideRadius: number; helperRadius: number;
    noiseLow: number; noiseHigh: number; noisePower: number; noiseScale: number;
    roadCorridor: number; riverCorridor: number; maskSoft: number; roadGap: number; riverGap: number;
    buildingClearance: number; labelClearance: number;
    latticePitch: number; jitter: number;
    clumps: number; clumpSeed: number; clumpTreesMin: number; clumpTreesMax: number; clumpRadiusMin: number; clumpRadiusMax: number;
    clumpAspect: number; clumpSpacing: number; clumpSpacingVariation: number; clumpSpacingEase: number; clumpAttempts: number; clumpTries: number;
    sideHalfWidth: number; sideEdge: number; sideEdgeTone: number; sideCrossReach: number; sideCrossGap: number; sideStubMin: number;
  };
  /**
   * Standing water (mapart/water.ts): the shore's field, and the treatments of the body.
   * Read only by a map that has water. It prints from the river's plate, and every tone of it is
   * named here: none is a number in the drawing code.
   */
  water: {
    /**
     * Which treatment is drawn: `flat`, one tint; `lines`, a tint with fine lines along the shore;
     * `depth`, two tones (a pale band along the shore, a deeper tone beyond it); `deep`, those two
     * and a third for open water away from land.
     */
    treatment: string;
    gridStep: number; reach: number; smooth: number; centreHold: number; centreLevel: number; wobble: number; wobblePitch: number; inset: number;
    simplify: number;
    shoreHalfWidth: number; shoreTone: number;
    flat: { tone: number };
    lines: { tone: number; offsets: number[]; tones: number[]; halfWidths: number[] };
    /** Treatments `depth` and `deep`: the pale band along the shore, how far offshore it reaches, and the tone beyond it. */
    depth: { shallowTone: number; offshoreFrom: number; offshoreTone: number };
    /**
     * Treatment `deep`: the third tone, for open water `fromHexes` hexes or more from any land hex.
     * Its edge is smoothed over `smooth`, strays by `wobble`, and never comes nearer the shore than `clear`.
     */
    deep: { tone: number; fromHexes: number; smooth: number; wobble: number; clear: number };
  };
  /** The paper's grain (O5), carried to the bake by the display list's `paper` entry. */
  paper: { amplitude: number; scale: number; carry: number };
  /** The six levers of Milestone 3b: 0 is off (the base). Stage 1 knows no other setting. */
  levers: { woodsBody: number; hillForm: number; lineQuality: number; townDepth: number; lettering: number; print: number };
  light: { azimuth: number };
}

export interface InkPlate {
  id: string;
  ink: string;
  offset: [number, number];
}

export interface InkTable {
  format: string;
  name: string;
  version: number;
  /** The plates every display list carries, in the order they are multiplied onto the sheet. */
  plates: InkPlate[];
  /**
   * Plates that only some boards print from, each for one element. A display list carries one of
   * these, after `plates`, only when the board has that element; so a board without it lists
   * `plates` and nothing else.
   */
  extraPlates: InkPlate[];
  /**
   * The sheet's margin round the map, as #RRGGBB: the stock as it is printed there, which the table
   * shows. The grid and the hex numbers the table prints are in the `key` plate's ink.
   */
  margin: string;
}

export interface Glyph {
  advance: number;
  rings: number[][];
}

export interface GlyphSet {
  format: string;
  name: string;
  ascender: number;
  descender: number;
  capHeight: number;
  xHeight: number;
  glyphs: Map<number, Glyph>;
}

export interface ArtData {
  params: ArtParams;
  inks: InkTable;
  glyphs: GlyphSet;
  /**
   * The winter set, when it was loaded (`loadArtData`'s `winter` texts): the winter ink table, the
   * parameters with winter's changes made, and what winter draws besides. Without it a winter
   * board is refused (`seasonArt`).
   */
  winter?: WinterArt;
}

/** The data a winter board prints from. */
export interface WinterArt {
  params: ArtParams;
  inks: InkTable;
  draw: WinterDraw;
}

/**
 * The pillow manner, for one kind of thing snow lies on (mapart/winter.ts): the owner's "geometric objects ...
 * that have a slight highlight on one side and a suggested thin shadow on the other ... slightly lighter than
 * the surrounding areas". The shape is flat. Under it `lift` of every plate it lies on is cleared (how much
 * lighter it is); a band `edge` wide inside its sides toward the light is cleared by `light` more (the slight
 * highlight); a line `shadow` wide along its sides away from the light, half of it outside the shape, prints
 * at `shadowTone` of the shade plate (the thin shadow). A side takes the highlight, or the shadow, when its
 * outward normal lies along the light's direction, or against it, by more than `facing` (their dot product).
 */
export interface PillowShade { lift: number; edge: number; light: number; shadow: number; shadowTone: number; facing: number }

/**
 * A scatter of flecks (mapart/winter.ts `scatterFlecks`): tiny flat pieces on a world lattice of `pitch`, at
 * most one a cell. The chance of one is `share` where the flecks lie thickest and in the heart of a clump,
 * `scatter` of that outside the clumps; a clump is where a smooth seeded value of `clumpPitch` rises over
 * `clumpLevel` (0 to 1). A fleck is `sizeMin` to `sizeMax` across, a seeded number from 0 to 1 raised to
 * `sizePower` saying where between (the higher the power, the more of them are specks).
 */
export interface FleckScatter {
  pitch: number; share: number; scatter: number; clumpPitch: number; clumpLevel: number; sizeMin: number; sizeMax: number; sizePower: number;
}

/**
 * Soft patches (mapart/winter.ts `softPatches`): on a world lattice of `pitch`, in `share` of its cells, a flat
 * piece `sizeMin` to `sizeMax` across, printed with an edge soft over `feather`: a cloud, and no shape.
 */
export interface SoftPatches { pitch: number; share: number; sizeMin: number; sizeMax: number; feather: number }

/** The size of a mound of the second round: its length (along it) and width, each drawn between the two. */
interface MoundSize { lengthMin: number; lengthMax: number; widthMin: number; widthMax: number }

/**
 * What winter draws on top of the summer art (mapart/winter.ts), each part with its own dials. Every
 * colour is a plate of the winter ink table at a tone. Sizes are in h.
 */
export interface WinterDraw {
  /** The plate of the cool shade: the shaded side of snow, and the ice. */
  shadePlate: string;
  /** What snow lies on: the plates cleared under it (every plate but the key, which prints the grid, the numbers, the names and the outlines). */
  snowPlates: string[];
  /** The way the wind blows, degrees clockwise from east: the streaks of a hilltop's ice run along it, and banked snow lies along it. */
  wind: number;
  /**
   * The shaded side of a rounded form of snow (a cap on a tree; a lump of a mound): bands, each a crescent
   * `lunes[i]` of the form's width thick at `tones[i]` of the shade (printed in that order, so a thinner, darker
   * band lies inside a broader, paler one).
   */
  bands: { lunes: number[]; tones: number[] };
  /**
   * The speckled, icy snow of the hills. On the `slopes`: `clouds`, soft patches where snow shows through the
   * haze (their middles `near` to `reach` from a crest or a ridge; the haze cleared under each by between
   * `liftMin` and `liftMax`), and `flecks` of frost on it, thickest beside a crest or a ridge and thinning
   * outward by the power `power` to none `reach` from it (under a fleck `lift` of the haze is cleared, and
   * `whiten` of the ground: frost is whiter than the plain). On the `hilltops`, inside their crests: a `tint`
   * of the shade over the whole hilltop; `patches`, soft darker clouds of it (a tone between `toneMin` and
   * `toneMax`); `clouds`, soft whiter ones (the shade cleared by between `liftMin` and `liftMax`); fine
   * `streaks` along the wind (in `share` of the cells of a lattice of `pitch`, a line `lengthMin` to
   * `lengthMax` long and `width` wide, turned by up to `turn` degrees and bowed by up to `bend`, clearing `lift`
   * of the shade and `whiten` of the ground under it); and `flecks`, each clearing the shade under it and
   * `whiten` of the ground. On the `plain` (a trial, none while its `share` is 0): faint soft clouds of the
   * shade on the open snow, a tone between `toneMin` and `toneMax`, off the hilltops and away from the water.
   */
  frost: {
    plain: SoftPatches & { toneMin: number; toneMax: number };
    slopes: {
      clouds: SoftPatches & { near: number; reach: number; liftMin: number; liftMax: number };
      flecks: FleckScatter & { reach: number; power: number; lift: number; whiten: number };
    };
    hilltops: {
      tint: number;
      patches: SoftPatches & { toneMin: number; toneMax: number };
      clouds: SoftPatches & { liftMin: number; liftMax: number };
      streaks: { pitch: number; share: number; lengthMin: number; lengthMax: number; turn: number; bend: number; width: number; lift: number; whiten: number };
      flecks: FleckScatter & { whiten: number };
    };
  };
  /**
   * A cap of snow on `share` of the trees: a circle `scale` of the crown's size, moved `shift` of it toward the
   * light, clearing `clear` of the plates in `knockout` (what lies under a crown); its side away from the light
   * shaded in the `bands`, at `shadeScale` of their tones.
   */
  caps: { share: number; scale: number; shift: number; shadeScale: number; knockout: string[]; clear: number };
  /**
   * Snow on every roof, `inset` inside its edge. `style` says how it is drawn: `ridge` (as the second round drew
   * it: the roof cleared to bare stock, the half of it across the ridge away from the light at `shadeTone`) or
   * `pillow` (the roof's square in the pillow manner, by `pillow`).
   */
  roofs: { inset: number; shadeTone: number; style: 'ridge' | 'pillow'; pillow: PillowShade };
  /**
   * What a freestanding thing on open ground keeps clear of (a flat piece of banked snow; a mound of the second
   * round): `spacing` from the next, `counterClear` from the middle of every hex (a counter's place), out of the
   * box the table prints a hex's number in (`numberBox`: the half-width, the gap under the hex's top side and the
   * height of client/src/scene/grid.ts, and a pad round it), `edgeClear` inside the board, and the given
   * clearances from roads, streams, hill lines and green sides, and trees.
   */
  keepClear: {
    spacing: number; counterClear: number; numberBox: { halfWidth: number; top: number; height: number; pad: number };
    edgeClear: number; roadClear: number; riverClear: number; lineClear: number; treeClear: number;
  };
  /**
   * Flat pieces of banked snow on open ground, in the pillow manner: in `share` of the open hexes that are no
   * hilltop (0: none), up to `tries` places `reachMin` to `reachMax` from the hex's middle; each a shape of the
   * set, `lengthMin` to `lengthMax` long the way the wind blows (turned by up to `turn` degrees either way) and
   * `widthMin` to `widthMax` wide, lifting the plates in `plates`; kept clear by `keepClear`, its outline tested
   * at points `step` apart.
   */
  drifts: {
    share: number; tries: number; reachMin: number; reachMax: number; lengthMin: number; lengthMax: number; widthMin: number; widthMax: number;
    turn: number; plates: string[]; step: number; pillow: PillowShade;
  };
  /** Snow on the stones of rough ground, when `on`: each stone's own shape in the pillow manner, lifting the plates in `plates`. */
  stones: { on: boolean; plates: string[]; pillow: PillowShade };
  /**
   * The second round's snow pillows, kept and drawn only when `on`: mounds of snow, each a row of up to `most`
   * rounded lumps, a lump's lit top clearing the snow's plates to bare stock and its side away from the light
   * shaded in the `bands`; the mound throws a shadow `castOffset` away from the light, grown by `castGrow`,
   * feathered over `castFeather`, at `castTone`. They lie on the `lee` side of woods' edges (behind an edge tree)
   * and of the green sides (one try every `pitch` along them), along the uphill side of `crests`, against the
   * `banks` of streams (`share` of the places, `gap` from the tree or line), and as low drifts on `open` ground
   * and fields (in `share` of those hexes, up to `tries` places `reachMin` to `reachMax` from the hex's middle;
   * fainter than the rest: their bands at `shadeScale` of the tones, their shadow at `castTone`). Kept clear by
   * `keepClear`.
   */
  mounds: {
    on: boolean; most: number; castTone: number; castOffset: number; castGrow: number; castFeather: number;
    lee: MoundSize & { share: number; pitch: number; gap: number };
    crests: MoundSize & { share: number; pitch: number; gap: number };
    banks: MoundSize & { share: number; pitch: number; gap: number };
    open: MoundSize & { share: number; tries: number; reachMin: number; reachMax: number; shadeScale: number; castTone: number };
  };
  /**
   * Ice on the water, drawn over the summer water. Standing water: a rim of snow `rim` wide inside the
   * shore (the ground plate lifted by `rimLift` there), the ice beyond it at `tone`, its edge a line at
   * `edgeTone`, and fine cracks cleared out of it; a sea's open water (the summer art's deep water) stays
   * as summer draws it. A river: its water frozen at `riverTone`, and on it what `river` says. `floes`: chunks
   * of ice, flat shapes of the set, each clearing `lift` of the river's ice under it (a little lighter than
   * the ice round it); across the river `sizeMin` to `sizeMax` of the room the water has there (its width less
   * `edge` on each side), along it up to `stretch` longer than that, turned from the river's direction by up to
   * `turn` degrees, none narrower than `least`; between one chunk and the next a reach of clear ice `gapMin` to
   * `gapMax` long, most of them short. `dashes` (the second round's, kept): patches of snow about `patch` long
   * and `gap` apart, each varied by `jitter`.
   */
  ice: {
    rim: number; rimLift: number; tone: number; edgeTone: number; edgeHalfWidth: number;
    crackShare: number; crackStepsMin: number; crackStepsMax: number; crackStep: number; crackTurn: number; crackBranch: number;
    crackWidth: number; crackTone: number; crackClear: number;
    riverTone: number; river: 'floes' | 'dashes';
    floes: { lift: number; sizeMin: number; sizeMax: number; stretch: number; turn: number; least: number; edge: number; gapMin: number; gapMax: number };
    dashes: { patch: number; gap: number; jitter: number };
  };
}

export interface LoadResult<T> {
  value: T | null;
  problems: string[];
}

// ---------------------------------------------------------------------------
// A small schema checker
// ---------------------------------------------------------------------------

type Spec =
  | { kind: 'number'; min: number; max: number }
  | { kind: 'int'; min: number; max: number }
  | { kind: 'string'; pattern?: RegExp; what?: string }
  | { kind: 'strings' }
  | { kind: 'numbers'; min: number; max: number }
  | { kind: 'bool' }
  | { kind: 'object'; keys: Readonly<Record<string, Spec>> };

const num = (min: number, max: number): Spec => ({ kind: 'number', min, max });
const int = (min: number, max: number): Spec => ({ kind: 'int', min, max });
const str = (pattern?: RegExp, what?: string): Spec =>
  pattern ? { kind: 'string', pattern, ...(what ? { what } : {}) } : { kind: 'string' };
const obj = (keys: Readonly<Record<string, Spec>>): Spec => ({ kind: 'object', keys });
const SIZE = num(0, 2);
const TONE = num(0, 1);
const SHARE = num(0, 1);

function show(v: unknown): string {
  const s = typeof v === 'string' ? JSON.stringify(v) : Array.isArray(v) ? 'a list' : typeof v === 'object' && v !== null ? 'a mapping' : String(v);
  return s.length > 40 ? `${s.slice(0, 37)}...` : s;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkValue(v: unknown, spec: Spec, where: string, problems: string[]): void {
  switch (spec.kind) {
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v) || v < spec.min || v > spec.max) {
        problems.push(`${where} must be a number from ${spec.min} to ${spec.max}, got ${show(v)}`);
      }
      return;
    case 'int':
      if (typeof v !== 'number' || !Number.isInteger(v) || v < spec.min || v > spec.max) {
        problems.push(`${where} must be a whole number from ${spec.min} to ${spec.max}, got ${show(v)}`);
      }
      return;
    case 'string':
      if (typeof v !== 'string' || v.length === 0) problems.push(`${where} must be a non-empty string, got ${show(v)}`);
      else if (spec.pattern && !spec.pattern.test(v)) problems.push(`${where} must be ${spec.what ?? spec.pattern.source}, got ${show(v)}`);
      return;
    case 'strings':
      if (!Array.isArray(v) || v.some(s => typeof s !== 'string' || s.length === 0)) {
        problems.push(`${where} must be a list of names, got ${show(v)}`);
      }
      return;
    case 'numbers':
      if (!Array.isArray(v) || v.length === 0 || v.some(x => typeof x !== 'number' || !Number.isFinite(x) || x < spec.min || x > spec.max)) {
        problems.push(`${where} must be a list of numbers from ${spec.min} to ${spec.max}, got ${show(v)}`);
      }
      return;
    case 'bool':
      if (typeof v !== 'boolean') problems.push(`${where} must be true or false, got ${show(v)}`);
      return;
    case 'object': {
      if (!isRecord(v)) {
        problems.push(`${where} must be a mapping, got ${show(v)}`);
        return;
      }
      for (const key of Object.keys(v)) {
        if (!(key in spec.keys)) problems.push(`${where ? `${where}.` : ''}${key} is not a known key (unknown keys are refused)`);
      }
      for (const [key, sub] of Object.entries(spec.keys)) {
        const at = where ? `${where}.${key}` : key;
        if (!(key in v)) problems.push(`${at} is missing`);
        else checkValue(v[key], sub, at, problems);
      }
      return;
    }
  }
}

const PLATE_NAME = str(/^[a-z][a-z0-9-]*$/, 'a plate name');

/** One family of buildings: its plate, the tone of its fill, the tone of its roof lines. */
const FAMILY_INK = obj({ plate: PLATE_NAME, tone: TONE, roofLine: TONE });
/** One building type of the owner's set. */
const BUILDING_TYPE = obj({
  family: str(/^(brown|tan|gray|green)$/, 'one of the families brown, tan, gray, green'), width: num(0.3, 5), height: num(0.3, 5),
  first: num(0, 100), other: num(0, 100), roof: str(/^(gable|gable_ends|hip|flat|cross)$/, 'gable, gable_ends, hip, flat or cross'),
});

const PARAMS_SPEC: Spec = obj({
  format: str(/^mapart-params\/1$/, "'mapart-params/1'"),
  plates: obj({
    ground: PLATE_NAME, wash: PLATE_NAME, fieldTint: PLATE_NAME, furrow: PLATE_NAME, swampTint: PLATE_NAME,
    swampWater: PLATE_NAME, swampReed: PLATE_NAME, rough: PLATE_NAME, river: PLATE_NAME, canopy: PLATE_NAME,
    buildingOutline: PLATE_NAME, separator: PLATE_NAME, ridge: PLATE_NAME, crest: PLATE_NAME,
    roadCasing: PLATE_NAME, bridge: PLATE_NAME, spotHeight: PLATE_NAME, townName: PLATE_NAME, roadKnockout: { kind: 'strings' },
  }),
  precision: int(3, 8),
  ground: obj({ bleed: num(0, 1.4) }),
  wash: obj({
    ringOffset: SIZE, feather: num(0.01, 2), eraseFeather: num(0, 0.5), tone: TONE, gridStep: num(0.005, 0.2), simplify: num(0, 0.05),
    mergeDistance: num(0, 4),
  }),
  hillLines: obj({ crestHalfWidth: SIZE, ridgeHalfWidth: SIZE, separatorHalfWidth: SIZE }),
  spotHeight: obj({ triangleWidth: SIZE, triangleHeight: SIZE, numberSize: SIZE, gap: SIZE, clearance: SIZE, woodedClearance: SIZE }),
  roads: obj({
    casingHalfWidth: SIZE, fillHalfWidth: SIZE, tangentBlend: SHARE, handle: num(0, 1), wobble: SIZE,
    segmentsPerHex: int(2, 200), offMapLength: num(0.1, 1.4), casingTone: TONE,
  }),
  rivers: obj({
    bankHalfWidth: SIZE, waterHalfWidth: SIZE, bankTone: TONE, waterTone: TONE, tangentBlend: SHARE, handle: num(0, 1),
    meander: SIZE, segmentsPerHex: int(2, 200), tributaryWidth: num(0.3, 1), confluence: SHARE,
    springWidth: num(0.3, 1), springTaper: num(0.1, 3),
  }),
  bridges: obj({ railGap: SIZE, railLength: SIZE, railHalfWidth: SIZE, flare: SIZE }),
  woods: obj({
    latticePitch: num(0.01, 0.5), spacing: num(0.01, 1), canopySize: SIZE, sizeVariation: SHARE, turn: num(0, 180),
    squash: SHARE, edgeMargin: SIZE, edgeMarginVariation: SIZE, roadClearance: SIZE, riverClearance: SIZE,
    hillLineClearance: num(0, 0.5), hilltopInset: num(0, 0.5), numberedHilltopInset: num(0, 0.5), outlineScale: num(0, 4),
    outlineTone: TONE, bodyTone: TONE, highlightScale: num(0, 4), highlightShift: num(0, 2), highlightTone: TONE,
  }),
  towns: obj({
    inset: SIZE, roadGap: SIZE, riverClearance: SIZE, lotDepth: num(0.05, 1), lotDepthMax: num(0.05, 1), lotDepthMin: num(0.02, 1), lotFrontMin: num(0.05, 1),
    lotFrontMax: num(0.05, 1), bigLotShare: SHARE, emptyShare: SHARE, edgeOpenShare: SHARE, lotMargin: num(0.002, 0.2), buildingGap: num(0.002, 0.2),
    frontageStretch: num(1, 3), rowShare: SHARE, coverMin: SHARE, coverMax: SHARE, baseSize: num(0.02, 0.5), scaleVariation: num(0, 0.5),
    inks: obj({ brown: FAMILY_INK, tan: FAMILY_INK, gray: FAMILY_INK, green: FAMILY_INK }),
    hipTopTone: num(0, 0.5), outlineTone: TONE, outlineHalfWidth: SIZE, roofLineWidth: num(0.001, 0.1),
    types: obj({
      house_brown_med: BUILDING_TYPE, house_brown_short: BUILDING_TYPE, house_tan: BUILDING_TYPE, house_gray_med: BUILDING_TYPE,
      house_gray_short: BUILDING_TYPE, long_green: BUILDING_TYPE, med_green: BUILDING_TYPE, warehouse: BUILDING_TYPE,
      single_brown: BUILDING_TYPE, single_tan: BUILDING_TYPE, shed: BUILDING_TYPE, town_center: BUILDING_TYPE, church: BUILDING_TYPE,
    }),
  }),
  fields: obj({
    inset: num(0.03, 0.3), gap: num(0.02, 0.06), spacing: num(0.04, 0.06), strokeWidth: SIZE, minStroke: SIZE, tintTone: TONE,
    furrowTone: TONE, roadGap: num(0.02, 0.5), layoutWeights: { kind: 'numbers', min: 0, max: 100 },
  }),
  swamp: obj({
    tintTone: TONE, pitch: num(0.02, 1), inset: SIZE, dashLengthMin: SIZE, dashLengthMax: SIZE, dashHalfWidth: SIZE,
    dashTone: TONE, reedShare: SHARE, reedHeight: SIZE, reedTone: TONE, roadClearance: SIZE, riverClearance: SIZE,
  }),
  rough: obj({
    pitch: num(0.02, 1), inset: SIZE, dotRadiusMin: SIZE, dotRadiusMax: SIZE, stoneShare: SHARE, stoneRadiusMin: SIZE,
    stoneRadiusMax: SIZE, tone: TONE, roadClearance: SIZE, riverClearance: SIZE,
  }),
  lettering: obj({ townSize: num(0.05, 1), tracking: num(0, 0.5), townOffset: num(0, 1.5), margin: num(0, 1) }),
  treeSides: obj({
    plate: PLATE_NAME,
    threshold: num(0.01, 10), sideStrength: num(0, 10), helperStrength: num(0, 10), strengthScale: num(0.01, 10),
    sideRadius: num(0.05, 4), helperRadius: num(0.05, 4),
    noiseLow: num(0, 10), noiseHigh: num(0, 10), noisePower: num(0.1, 8), noiseScale: num(0.1, 20),
    roadCorridor: SIZE, riverCorridor: SIZE, maskSoft: num(0.001, 2), roadGap: num(0, 0.5), riverGap: num(0, 0.5),
    buildingClearance: num(0, 0.5), labelClearance: num(0, 0.5),
    latticePitch: num(0.02, 1), jitter: num(0, 0.5),
    clumps: int(1, 64), clumpSeed: int(0, 0xffffffff), clumpTreesMin: int(1, 40), clumpTreesMax: int(1, 40),
    clumpRadiusMin: num(0.1, 10), clumpRadiusMax: num(0.1, 10), clumpAspect: num(0.1, 1), clumpSpacing: num(0.1, 4),
    clumpSpacingVariation: num(0, 1), clumpSpacingEase: num(0.5, 0.99), clumpAttempts: int(1, 64), clumpTries: int(1, 5000),
    sideHalfWidth: num(0.001, 0.2), sideEdge: num(0, 0.1), sideEdgeTone: TONE, sideCrossReach: num(0.001, 0.25),
    sideCrossGap: num(0, 0.2), sideStubMin: num(0, 0.25),
  }),
  water: obj({
    treatment: str(/^(flat|lines|depth|deep)$/, 'flat, lines, depth or deep'),
    gridStep: num(0.01, 0.2), reach: num(1.5, 4), smooth: num(0, 1), centreHold: num(0, 0.45), centreLevel: num(0.1, 1),
    wobble: num(0, 0.3), wobblePitch: num(0.2, 10), inset: num(0, 0.3),
    simplify: num(0, 0.05), shoreHalfWidth: SIZE, shoreTone: TONE,
    // An offset is a distance offshore of at most 0.35 h: the shore's field is worked half a hex into the water.
    flat: obj({ tone: TONE }),
    lines: obj({
      tone: TONE, offsets: { kind: 'numbers', min: 0.01, max: 0.35 }, tones: { kind: 'numbers', min: 0, max: 1 },
      halfWidths: { kind: 'numbers', min: 0.001, max: 0.1 },
    }),
    depth: obj({ shallowTone: TONE, offshoreFrom: num(0.01, 0.35), offshoreTone: TONE }),
    // Deep water keeps `clear` off the shore: more than the pale band is wide (checked below), and no
    // more than 0.45 h, which is as far into the water as the shore's field can measure.
    deep: obj({ tone: TONE, fromHexes: int(2, 6), smooth: num(0, 1.5), wobble: num(0, 0.3), clear: num(0.05, 0.45) }),
  }),
  paper: obj({ amplitude: num(0, 0.1), scale: num(0.001, 1), carry: num(0, 0.95) }),
  // Stage 1 of Milestone 3b: the levers exist and every one is off. No other setting is built yet.
  levers: obj({ woodsBody: int(0, 0), hillForm: int(0, 0), lineQuality: int(0, 0), townDepth: int(0, 0), lettering: int(0, 0), print: int(0, 0) }),
  light: obj({ azimuth: num(0, 360) }),
});

function parseDocument(text: string, what: string): { raw: unknown; problems: string[] } {
  try {
    return { raw: parseText(text), problems: [] };
  } catch (err) {
    return { raw: null, problems: [`${what} is not readable as YAML or JSON: ${(err as Error).message.split('\n')[0]}`] };
  }
}

// ---------------------------------------------------------------------------
// Art parameters
// ---------------------------------------------------------------------------

/** Check parsed art parameters. */
export function validateParams(raw: unknown): LoadResult<ArtParams> {
  const problems: string[] = [];
  checkValue(raw, PARAMS_SPEC, '', problems);
  if (problems.length === 0) {
    const p = raw as ArtParams;
    const T = p.towns;
    if (T.lotFrontMin > T.lotFrontMax) problems.push('towns.lotFrontMin must not be more than towns.lotFrontMax');
    if (T.lotDepth > T.lotDepthMax) problems.push('towns.lotDepth must not be more than towns.lotDepthMax');
    const fills = Object.values(T.inks).map(i => `${i.plate} ${i.tone}`);
    if (new Set(fills).size !== fills.length) problems.push('towns.inks: two families share a plate and tone; each family must be told from the others');
    if (p.fields.layoutWeights.length !== 3 || p.fields.layoutWeights.every(w => w === 0)) problems.push('fields.layoutWeights must hold three numbers, not all 0');
    if (p.roads.fillHalfWidth >= p.roads.casingHalfWidth) problems.push('roads.fillHalfWidth must be less than roads.casingHalfWidth');
    if (p.rivers.waterHalfWidth >= p.rivers.bankHalfWidth) problems.push('rivers.waterHalfWidth must be less than rivers.bankHalfWidth');
    const TS = p.treeSides;
    if (TS.noiseLow > TS.noiseHigh) problems.push('treeSides.noiseLow must not be more than treeSides.noiseHigh');
    if (TS.clumpTreesMin > TS.clumpTreesMax) problems.push('treeSides.clumpTreesMin must not be more than treeSides.clumpTreesMax');
    if (TS.clumpRadiusMin > TS.clumpRadiusMax) problems.push('treeSides.clumpRadiusMin must not be more than treeSides.clumpRadiusMax');
  }
  return problems.length > 0 ? { value: null, problems } : { value: raw as ArtParams, problems };
}

/** Read and check an art parameter file's text. */
export function parseParams(text: string): LoadResult<ArtParams> {
  const doc = parseDocument(text, 'the parameter file');
  if (doc.problems.length > 0) return { value: null, problems: doc.problems };
  return validateParams(doc.raw);
}

// ---------------------------------------------------------------------------
// The winter set's parameters
// ---------------------------------------------------------------------------

/** The pillow manner's dials (PillowShade): the highlight's band and the shadow's line are thin. */
const PILLOW_SHADE = obj({ lift: TONE, edge: num(0, 0.1), light: TONE, shadow: num(0, 0.05), shadowTone: TONE, facing: num(0, 0.9) });

/** A scatter of flecks (FleckScatter): a fleck is tiny, and its lattice fine. */
const FLECK_SCATTER = {
  pitch: num(0.01, 0.5), share: SHARE, scatter: SHARE, clumpPitch: num(0.05, 4), clumpLevel: num(0, 0.99), sizeMin: num(0.002, 0.2), sizeMax: num(0.002, 0.2),
  sizePower: num(0.2, 8),
};

/** Soft patches (SoftPatches). */
const SOFT_PATCHES = { pitch: num(0.1, 4), share: SHARE, sizeMin: num(0.05, 2), sizeMax: num(0.05, 2), feather: num(0.01, 1) };

/** A mound of the second round: its size, and where it is tried. */
const MOUND_SIZE = { lengthMin: num(0.01, 1), lengthMax: num(0.01, 1), widthMin: num(0.005, 0.5), widthMax: num(0.005, 0.5) };
const MOUND_ALONG = obj({ ...MOUND_SIZE, share: SHARE, pitch: num(0.02, 2), gap: num(0, 0.5) });

const WINTER_SPEC: Spec = obj({
  shadePlate: PLATE_NAME,
  snowPlates: { kind: 'strings' },
  wind: num(-180, 180),
  bands: obj({ lunes: { kind: 'numbers', min: 0.05, max: 0.9 }, tones: { kind: 'numbers', min: 0, max: 1 } }),
  frost: obj({
    plain: obj({ ...SOFT_PATCHES, toneMin: TONE, toneMax: TONE }),
    slopes: obj({
      clouds: obj({ ...SOFT_PATCHES, near: num(0, 2), reach: num(0.05, 2), liftMin: TONE, liftMax: TONE }),
      flecks: obj({ ...FLECK_SCATTER, reach: num(0.05, 2), power: num(0.2, 6), lift: TONE, whiten: TONE }),
    }),
    hilltops: obj({
      tint: TONE,
      patches: obj({ ...SOFT_PATCHES, toneMin: TONE, toneMax: TONE }),
      clouds: obj({ ...SOFT_PATCHES, liftMin: TONE, liftMax: TONE }),
      streaks: obj({
        pitch: num(0.05, 4), share: SHARE, lengthMin: num(0.02, 2), lengthMax: num(0.02, 2), turn: num(0, 90), bend: num(0, 0.3), width: num(0.001, 0.05),
        lift: TONE, whiten: TONE,
      }),
      flecks: obj({ ...FLECK_SCATTER, whiten: TONE }),
    }),
  }),
  caps: obj({ share: SHARE, scale: num(0.05, 1.5), shift: num(0, 1), shadeScale: num(0, 2), knockout: { kind: 'strings' }, clear: TONE }),
  roofs: obj({ inset: num(0, 0.1), shadeTone: TONE, style: str(/^(ridge|pillow)$/, 'ridge or pillow'), pillow: PILLOW_SHADE }),
  keepClear: obj({
    spacing: num(0, 0.5), counterClear: num(0, 0.5),
    numberBox: obj({ halfWidth: num(0, 0.5), top: num(0, 0.5), height: num(0, 0.5), pad: num(0, 0.2) }),
    edgeClear: num(0, 0.5), roadClear: num(0, 0.5), riverClear: num(0, 0.5), lineClear: num(0, 0.5), treeClear: num(0, 0.5),
  }),
  drifts: obj({
    share: SHARE, tries: int(1, 20), reachMin: num(0, 0.6), reachMax: num(0, 0.6),
    lengthMin: num(0.01, 1), lengthMax: num(0.01, 1), widthMin: num(0.005, 0.5), widthMax: num(0.005, 0.5),
    turn: num(0, 90), plates: { kind: 'strings' }, step: num(0.005, 0.2), pillow: PILLOW_SHADE,
  }),
  stones: obj({ on: { kind: 'bool' }, plates: { kind: 'strings' }, pillow: PILLOW_SHADE }),
  mounds: obj({
    on: { kind: 'bool' }, most: int(1, 8), castTone: TONE, castOffset: num(0, 0.2), castGrow: num(0, 0.1), castFeather: num(0.005, 0.5),
    lee: MOUND_ALONG, crests: MOUND_ALONG, banks: MOUND_ALONG,
    open: obj({ ...MOUND_SIZE, share: SHARE, tries: int(1, 20), reachMin: num(0, 0.6), reachMax: num(0, 0.6), shadeScale: num(0, 2), castTone: TONE }),
  }),
  ice: obj({
    rim: num(0.01, 0.35), rimLift: TONE, tone: TONE, edgeTone: TONE, edgeHalfWidth: num(0.001, 0.1),
    crackShare: SHARE, crackStepsMin: int(1, 40), crackStepsMax: int(1, 40), crackStep: num(0.01, 1), crackTurn: num(0, 180),
    crackBranch: SHARE, crackWidth: num(0.001, 0.05), crackTone: TONE, crackClear: num(0, 0.3),
    riverTone: TONE, river: str(/^(floes|dashes)$/, 'floes or dashes'),
    floes: obj({
      lift: TONE, sizeMin: num(0.05, 1), sizeMax: num(0.05, 1), stretch: num(0, 4), turn: num(0, 180), least: num(0.001, 0.2), edge: num(0, 0.05),
      gapMin: num(0, 2), gapMax: num(0.001, 2),
    }),
    dashes: obj({ patch: num(0.005, 1), gap: num(0.005, 2), jitter: num(0, 0.9) }),
  }),
});

/** Every leaf of `changes`, as its path and value: a mapping is walked, anything else (a number, a name, a list) is a value. */
function leavesOf(changes: Record<string, unknown>, at: string, out: [string, unknown][]): void {
  for (const [key, v] of Object.entries(changes)) {
    const path = at ? `${at}.${key}` : key;
    if (isRecord(v)) leavesOf(v, path, out);
    else out.push([path, v]);
  }
}

/**
 * Read a season's parameter file: what the season changes of the base parameters, and what it
 * draws besides. Its `changes` name keys of the parameters by their path, nested as they are
 * there; each leaf replaces the base's value (a list is replaced whole), and a key the parameters
 * do not have is refused. The parameters with the changes made are then checked as a whole, as
 * the base is. Everything a season does not change is the base's, by this rule and no other.
 */
export function parseSeasonParams(text: string, base: ArtParams): LoadResult<{ params: ArtParams; draw: WinterDraw }> {
  const doc = parseDocument(text, 'the season parameter file');
  if (doc.problems.length > 0) return { value: null, problems: doc.problems };
  const raw = doc.raw;
  const problems: string[] = [];
  if (!isRecord(raw)) return { value: null, problems: [`a season parameter file must be a mapping, got ${show(raw)}`] };
  const keys = ['format', 'season', 'changes', 'winter'];
  for (const key of Object.keys(raw)) if (!keys.includes(key)) problems.push(`${key} is not a known key (unknown keys are refused)`);
  for (const key of keys) if (!(key in raw)) problems.push(`${key} is missing`);
  if ('format' in raw && raw.format !== 'mapart-season/1') problems.push(`format must be 'mapart-season/1', got ${show(raw.format)}`);
  if ('season' in raw && raw.season !== 'winter') problems.push(`season must be 'winter' (the one season with a set of its own), got ${show(raw.season)}`);
  const merged = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
  if ('changes' in raw) {
    if (!isRecord(raw.changes)) problems.push(`changes must be a mapping of the parameters' keys, got ${show(raw.changes)}`);
    else {
      const leaves: [string, unknown][] = [];
      leavesOf(raw.changes, '', leaves);
      for (const [path, v] of leaves) {
        const parts = path.split('.');
        let node: Record<string, unknown> = merged;
        let ok = true;
        for (let i = 0; i < parts.length - 1 && ok; i++) {
          const next = node[parts[i] as string];
          if (isRecord(next)) node = next;
          else ok = false;
        }
        const last = parts[parts.length - 1] as string;
        if (!ok || !(last in node)) problems.push(`changes.${path} is not a key of the parameters (a season changes only what the parameters have)`);
        else if (isRecord(node[last])) problems.push(`changes.${path} is a mapping in the parameters: name its keys`);
        else node[last] = v;
      }
    }
  }
  if ('winter' in raw) checkValue(raw.winter, WINTER_SPEC, 'winter', problems);
  if (problems.length === 0) {
    const checked = validateParams(merged);
    problems.push(...checked.problems.map(p => `with the changes made: ${p}`));
    const D = raw.winter as WinterDraw;
    if (D.ice.crackStepsMin > D.ice.crackStepsMax) problems.push('winter.ice.crackStepsMin must not be more than winter.ice.crackStepsMax');
    const ordered = (where: string, lo: number, hi: number, what: string): void => {
      if (lo > hi) problems.push(`winter.${where}.${what}Min must not be more than winter.${where}.${what}Max`);
    };
    ordered('drifts', D.drifts.lengthMin, D.drifts.lengthMax, 'length');
    ordered('drifts', D.drifts.widthMin, D.drifts.widthMax, 'width');
    ordered('drifts', D.drifts.reachMin, D.drifts.reachMax, 'reach');
    for (const k of ['lee', 'crests', 'banks', 'open'] as const) {
      ordered(`mounds.${k}`, D.mounds[k].lengthMin, D.mounds[k].lengthMax, 'length');
      ordered(`mounds.${k}`, D.mounds[k].widthMin, D.mounds[k].widthMax, 'width');
    }
    ordered('mounds.open', D.mounds.open.reachMin, D.mounds.open.reachMax, 'reach');
    if (D.bands.lunes.length !== D.bands.tones.length) problems.push(`winter.bands has ${D.bands.lunes.length} lunes and ${D.bands.tones.length} tones (one of each for every band)`);
    for (const [where, scale] of [['caps', D.caps.shadeScale], ['mounds.open', D.mounds.open.shadeScale]] as const) {
      if (D.bands.tones.some(t => t * scale > 1)) problems.push(`winter.${where}.shadeScale takes a band's tone over 1`);
    }
    const FR = D.frost;
    ordered('frost.plain', FR.plain.sizeMin, FR.plain.sizeMax, 'size');
    ordered('frost.plain', FR.plain.toneMin, FR.plain.toneMax, 'tone');
    ordered('frost.slopes.clouds', FR.slopes.clouds.sizeMin, FR.slopes.clouds.sizeMax, 'size');
    ordered('frost.slopes.clouds', FR.slopes.clouds.liftMin, FR.slopes.clouds.liftMax, 'lift');
    if (FR.slopes.clouds.near > FR.slopes.clouds.reach) problems.push('winter.frost.slopes.clouds.near must not be more than winter.frost.slopes.clouds.reach');
    ordered('frost.slopes.flecks', FR.slopes.flecks.sizeMin, FR.slopes.flecks.sizeMax, 'size');
    ordered('frost.hilltops.patches', FR.hilltops.patches.sizeMin, FR.hilltops.patches.sizeMax, 'size');
    ordered('frost.hilltops.patches', FR.hilltops.patches.toneMin, FR.hilltops.patches.toneMax, 'tone');
    ordered('frost.hilltops.clouds', FR.hilltops.clouds.sizeMin, FR.hilltops.clouds.sizeMax, 'size');
    ordered('frost.hilltops.clouds', FR.hilltops.clouds.liftMin, FR.hilltops.clouds.liftMax, 'lift');
    ordered('frost.hilltops.streaks', FR.hilltops.streaks.lengthMin, FR.hilltops.streaks.lengthMax, 'length');
    ordered('frost.hilltops.flecks', FR.hilltops.flecks.sizeMin, FR.hilltops.flecks.sizeMax, 'size');
    ordered('ice.floes', D.ice.floes.sizeMin, D.ice.floes.sizeMax, 'size');
    ordered('ice.floes', D.ice.floes.gapMin, D.ice.floes.gapMax, 'gap');
  }
  if (problems.length > 0) return { value: null, problems };
  return { value: { params: merged as unknown as ArtParams, draw: raw.winter as WinterDraw }, problems };
}

// ---------------------------------------------------------------------------
// Ink table
// ---------------------------------------------------------------------------

/** Check a parsed ink table. */
export function validateInks(raw: unknown): LoadResult<InkTable> {
  const problems: string[] = [];
  if (!isRecord(raw)) return { value: null, problems: [`an ink table must be a mapping, got ${show(raw)}`] };
  const keys = ['format', 'name', 'version', 'margin', 'plates', 'extraPlates'];
  for (const key of Object.keys(raw)) if (!keys.includes(key)) problems.push(`${key} is not a known key (unknown keys are refused)`);
  for (const key of keys) if (!(key in raw)) problems.push(`${key} is missing`);
  if ('format' in raw && raw.format !== 'inks/1') problems.push(`format must be 'inks/1', got ${show(raw.format)}`);
  if ('name' in raw && (typeof raw.name !== 'string' || raw.name.length === 0)) problems.push(`name must be a non-empty string, got ${show(raw.name)}`);
  if ('version' in raw && (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1)) {
    problems.push(`version must be a whole number from 1, got ${show(raw.version)}`);
  }
  if ('margin' in raw && (typeof raw.margin !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(raw.margin))) {
    problems.push(`margin must be a colour written #rrggbb, got ${show(raw.margin)}`);
  }
  const plates: InkPlate[] = [];
  const extraPlates: InkPlate[] = [];
  const seen = new Set<string>();
  // `plates` holds one or more; `extraPlates` may be empty. A plate name is used once in the whole table.
  for (const [listKey, into, mayBeEmpty] of [['plates', plates, false], ['extraPlates', extraPlates, true]] as const) {
    if (!(listKey in raw)) continue;
    const given = raw[listKey];
    if (!Array.isArray(given) || (given.length === 0 && !mayBeEmpty)) {
      problems.push(`${listKey} must be a list of ${mayBeEmpty ? 'plates (it may be empty)' : 'one or more plates'}, got ${show(given)}`);
    } else {
      given.forEach((item: unknown, i: number) => {
        const where = `${listKey}[${i + 1}]`;
        if (!isRecord(item)) {
          problems.push(`${where}: a plate is { id, ink, offset }, got ${show(item)}`);
          return;
        }
        for (const key of Object.keys(item)) if (!['id', 'ink', 'offset'].includes(key)) problems.push(`${where}.${key} is not a known key (unknown keys are refused)`);
        for (const key of ['id', 'ink', 'offset']) if (!(key in item)) problems.push(`${where}.${key} is missing`);
        const id = item.id;
        if ('id' in item && (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id))) problems.push(`${where}.id must be a plate name, got ${show(id)}`);
        else if (typeof id === 'string') {
          if (seen.has(id)) problems.push(`${where}: the plate ${id} is listed twice`);
          seen.add(id);
        }
        const ink = item.ink;
        if ('ink' in item && (typeof ink !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(ink))) problems.push(`${where}.ink must be a colour written #rrggbb, got ${show(ink)}`);
        const off = item.offset;
        if ('offset' in item) {
          if (!Array.isArray(off) || off.length !== 2 || off.some(v => typeof v !== 'number' || !Number.isFinite(v))) {
            problems.push(`${where}.offset must be two numbers [x, y] in h, got ${show(off)}`);
          } else {
            const l = Math.hypot(off[0] as number, off[1] as number);
            if (l !== 0 && (l < 0.005 - 1e-9 || l > 0.011 + 1e-9)) {
              problems.push(`${where}.offset must be 0 or between 0.005 and 0.011 h long (docs/art/map-art-spec.md, section 2), got ${l.toFixed(4)}`);
            }
          }
        }
        if (typeof id === 'string' && typeof ink === 'string' && Array.isArray(off)) {
          into.push({ id, ink: ink.toUpperCase(), offset: [off[0] as number, off[1] as number] });
        }
      });
    }
  }
  if (problems.length > 0) return { value: null, problems };
  return {
    value: { format: 'inks/1', name: raw.name as string, version: raw.version as number, plates, extraPlates, margin: (raw.margin as string).toUpperCase() },
    problems,
  };
}

/** Read and check an ink table file's text. */
export function parseInks(text: string): LoadResult<InkTable> {
  const doc = parseDocument(text, 'the ink table');
  if (doc.problems.length > 0) return { value: null, problems: doc.problems };
  return validateInks(doc.raw);
}

// ---------------------------------------------------------------------------
// Lettering outlines
// ---------------------------------------------------------------------------

/** Check a parsed lettering outline file. */
export function validateGlyphs(raw: unknown): LoadResult<GlyphSet> {
  const problems: string[] = [];
  if (!isRecord(raw)) return { value: null, problems: [`the lettering data must be a mapping, got ${show(raw)}`] };
  const keys = ['format', 'name', 'note', 'units', 'copyright', 'modifiedVersion', 'licence', 'ascender', 'descender', 'capHeight', 'xHeight', 'glyphs'];
  for (const key of Object.keys(raw)) if (!keys.includes(key)) problems.push(`${key} is not a known key (unknown keys are refused)`);
  for (const key of keys) if (!(key in raw)) problems.push(`${key} is missing`);
  if (raw.format !== 'lettering/1') problems.push(`format must be 'lettering/1', got ${show(raw.format)}`);
  // The outlines are a Modified Version of a font under the SIL Open Font License 1.1: the data
  // carries the font's copyright notice, the licence text and the statement that it is modified.
  for (const key of ['copyright', 'modifiedVersion', 'licence']) {
    if (key in raw && (typeof raw[key] !== 'string' || (raw[key] as string).length === 0)) problems.push(`${key} must be a non-empty string, got ${show(raw[key])}`);
  }
  for (const key of ['ascender', 'descender', 'capHeight', 'xHeight']) {
    const v = raw[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 3) problems.push(`${key} must be a number from 0 to 3 (em), got ${show(v)}`);
  }
  const glyphs = new Map<number, Glyph>();
  if (!isRecord(raw.glyphs)) problems.push(`glyphs must be a mapping of code points to glyphs, got ${show(raw.glyphs)}`);
  else {
    for (const [key, g] of Object.entries(raw.glyphs)) {
      const where = `glyphs.${key}`;
      const cp = Number(key);
      if (!/^[0-9]+$/.test(key) || !Number.isInteger(cp)) {
        problems.push(`${where}: a glyph is keyed by its code point as a whole number`);
        continue;
      }
      if (!isRecord(g)) {
        problems.push(`${where} must be { advance, rings }, got ${show(g)}`);
        continue;
      }
      for (const k of Object.keys(g)) if (k !== 'advance' && k !== 'rings') problems.push(`${where}.${k} is not a known key (unknown keys are refused)`);
      const adv = g.advance;
      const rings = g.rings;
      if (typeof adv !== 'number' || !Number.isFinite(adv) || adv < 0) problems.push(`${where}.advance must be a number from 0, got ${show(adv)}`);
      if (!Array.isArray(rings) || rings.some(r => !Array.isArray(r) || r.length < 6 || !Number.isInteger(r.length / 2) || r.some(v => typeof v !== 'number' || !Number.isFinite(v)))) {
        problems.push(`${where}.rings must be a list of rings, each an even list of six or more numbers`);
        continue;
      }
      glyphs.set(cp, { advance: adv as number, rings: rings as number[][] });
    }
  }
  if (problems.length > 0) return { value: null, problems };
  return {
    value: {
      format: 'lettering/1', name: String(raw.name), ascender: raw.ascender as number, descender: raw.descender as number,
      capHeight: raw.capHeight as number, xHeight: raw.xHeight as number, glyphs,
    },
    problems,
  };
}

/** Read and check the lettering outline file's text (JSON). */
export function parseGlyphs(text: string): LoadResult<GlyphSet> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { value: null, problems: [`the lettering data is not readable as JSON: ${(err as Error).message}`] };
  }
  return validateGlyphs(raw);
}

/** The problems of a set of parameters with its ink table: every plate the parameters name is in the table, and the water's dials agree. */
function checkTogether(params: ArtParams, inks: InkTable, say: (problem: string) => void): void {
  const ids = new Set(inks.plates.map(p => p.id));
  for (const [key, v] of Object.entries(params.plates)) {
    const names = Array.isArray(v) ? v : [v];
    for (const name of names) if (!ids.has(name)) say(`parameters: plates.${key} names the plate '${name}', which the ink table ${inks.name} does not have`);
  }
  for (const [family, ink] of Object.entries(params.towns.inks)) {
    if (!ids.has(ink.plate)) say(`parameters: towns.inks.${family}.plate names the plate '${ink.plate}', which the ink table ${inks.name} does not have`);
  }
  // The green sides print from a plate of their own, one of the table's extra plates, and the canopy
  // ink is knocked out under them: the two plates must sit in register, or the knock-out would show.
  const sidePlate = inks.extraPlates.find(p => p.id === params.treeSides.plate);
  const canopyPlate = inks.plates.find(p => p.id === params.plates.canopy);
  if (!sidePlate) {
    say(`parameters: treeSides.plate names the plate '${params.treeSides.plate}', which is not one of the extra plates of the ink table ${inks.name}`);
  } else if (canopyPlate && (sidePlate.offset[0] !== canopyPlate.offset[0] || sidePlate.offset[1] !== canopyPlate.offset[1])) {
    say(`ink table: the plate '${sidePlate.id}' must have the offset of the canopy's plate '${canopyPlate.id}' (the canopy ink is knocked out under the green sides)`);
  }
  // Each line along a shore is an offset with its own tone and width: the lists pair up.
  const w = params.water;
  if (w.lines.tones.length !== w.lines.offsets.length || w.lines.halfWidths.length !== w.lines.offsets.length) {
    say(`parameters: water.lines has ${w.lines.offsets.length} offsets, ${w.lines.tones.length} tones and ${w.lines.halfWidths.length} halfWidths (one of each for every line)`);
  }
  // The tones of the body darken away from the shore, and deep water keeps clear of the pale band.
  if (!(w.depth.shallowTone < w.depth.offshoreTone && w.depth.offshoreTone < w.deep.tone)) {
    say(`parameters: the water's tones must darken away from the shore: water.depth.shallowTone (${w.depth.shallowTone}), water.depth.offshoreTone (${w.depth.offshoreTone}), water.deep.tone (${w.deep.tone})`);
  }
  if (w.deep.clear <= w.depth.offshoreFrom) {
    say(`parameters: water.deep.clear (${w.deep.clear}) must be more than water.depth.offshoreFrom (${w.depth.offshoreFrom}): deep water keeps clear of the pale band along the shore`);
  }
  // The hold at a hex's middle (the field falls by 2 a hex): it must outweigh the inset, or the middle of a
  // water hex could be drawn as land; and stay short of the nearest line or tone offshore, or it would draw
  // a ring of that line round the middle of every hex on a shore.
  if (w.centreHold > 0) {
    const nearest = Math.min(...w.lines.offsets, w.depth.offshoreFrom);
    if (w.centreLevel <= 2 * w.inset) say(`parameters: water.centreLevel (${w.centreLevel}) must be more than twice water.inset (${w.inset})`);
    if (w.centreLevel >= 2 * (w.inset + nearest)) {
      say(`parameters: water.centreLevel (${w.centreLevel}) must be less than twice water.inset plus the nearest offset offshore (${w.inset} + ${nearest})`);
    }
  }
}

/**
 * Read all three files, and the winter set when its two texts are given, and check that they fit
 * together: every plate the parameters name is in the ink table they print with.
 */
export function loadArtData(texts: { params: string; inks: string; glyphs: string; winter?: { params: string; inks: string } }): LoadResult<ArtData> {
  const params = parseParams(texts.params);
  const inks = parseInks(texts.inks);
  const glyphs = parseGlyphs(texts.glyphs);
  const problems = [
    ...params.problems.map(p => `parameters: ${p}`),
    ...inks.problems.map(p => `ink table: ${p}`),
    ...glyphs.problems.map(p => `lettering: ${p}`),
  ];
  if (params.value && inks.value) checkTogether(params.value, inks.value, p => problems.push(p));
  let winter: WinterArt | undefined;
  if (texts.winter && params.value && inks.value) {
    const season = parseSeasonParams(texts.winter.params, params.value);
    // The winter ink table is summer's transformed (mapart/seasonInks.ts): its file holds the transform, not inks.
    const doc = parseDocument(texts.winter.inks, 'the winter ink file');
    const spec = doc.problems.length > 0 ? { value: null, problems: doc.problems } : validateSeasonInks(doc.raw);
    const derived = spec.value ? deriveSeasonInks(inks.value, spec.value) : { value: null, problems: [] as string[] };
    problems.push(...season.problems.map(p => `winter parameters: ${p}`), ...[...spec.problems, ...derived.problems].map(p => `winter ink table: ${p}`));
    if (season.value && derived.value) {
      const wp = season.value.params;
      const wi = derived.value;
      checkTogether(wp, wi, p => problems.push(`winter ${p}`));
      const ids = new Set(wi.plates.map(p => p.id));
      const D = season.value.draw;
      const listed = (where: string, plates: readonly string[]): [string, string][] => plates.map((k, i): [string, string] => [`${where}[${i + 1}]`, k]);
      const named: [string, string][] = [
        ['shadePlate', D.shadePlate], ...listed('snowPlates', D.snowPlates), ...listed('caps.knockout', D.caps.knockout),
        ...listed('drifts.plates', D.drifts.plates), ...listed('stones.plates', D.stones.plates),
      ];
      for (const [where, plate] of named) {
        if (!ids.has(plate)) problems.push(`winter parameters: winter.${where} names the plate '${plate}', which the ink table ${wi.name} does not have`);
      }
      if (D.ice.rim + D.ice.crackClear > 0.35) problems.push('winter parameters: winter.ice.rim and winter.ice.crackClear together must be at most 0.35 h (the shore\'s field is worked half a hex into the water)');
      winter = { params: wp, inks: wi, draw: D };
    }
  }
  if (problems.length > 0 || !params.value || !inks.value || !glyphs.value) return { value: null, problems };
  return { value: { params: params.value, inks: inks.value, glyphs: glyphs.value, ...(winter ? { winter } : {}) }, problems };
}

/** The data a board of this season prints from: the summer set, or the winter set (refused when it was not loaded). */
export function seasonArt(art: ArtData, season: 'summer' | 'winter'): { params: ArtParams; inks: InkTable; glyphs: GlyphSet; winter: WinterDraw | null } {
  if (season === 'summer') return { params: art.params, inks: art.inks, glyphs: art.glyphs, winter: null };
  if (!art.winter) {
    throw new Error('this is a winter board, and the art data was loaded without the winter set (mapart/data/params-winter.yaml and inks-winter.yaml): a winter board is never printed as summer');
  }
  return { params: art.winter.params, inks: art.winter.inks, glyphs: art.glyphs, winter: art.winter.draw };
}
