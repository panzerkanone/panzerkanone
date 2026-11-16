/**
 * The things on the table, as three.js objects: the table top, the three
 * mounted boards (each its own top face, rounded arris, wall and foot), and the
 * pieces of the baked map laid on their tops. Everything is built in the board
 * frame (x right, y down the board, z up, in h).
 *
 * A board's top face is one mesh for the whole board: the board shader paints
 * the printed sheet where the sheet lies and the covering paper round it
 * (ruling 32). The printed surface is the plane z = 0. Pieces of the map are
 * flat rectangles in that plane, one picture across the joints (PLAN V7): level
 * 0 in one or a few, sharper tiles over them; the shader leaves them out off the
 * sheets, so the wrap and the gaps show. A polygon offset by level settles which
 * shows where two overlap, and they are drawn sharpest first so that nothing
 * under a tile is shaded.
 *
 * The former construction (one rounded outline, printed to its edge, a groove
 * at each seam) is still here for comparison: `construction: 'old'` of the
 * layout draws it with the first build's shapes and shader paths.
 */
import * as THREE from 'three';
import type { Point } from './camera';
import type { GridGeometry } from './grid';
import { DIGIT_ASPECT, FRAME_WIDTH, LABEL_GAP, LABEL_HEIGHT, LINE_WIDTH, MIN_LINE_PX, RULER_HEIGHT } from './grid';
import { DIGIT_HALF_STROKE, DIGIT_RANGE } from './digits';
import { BOTTOM_BEVEL, MOUNT_BOTTOM_BEVEL, boardsForShaders } from './layout';
import type { BoardLayout, Rect } from './layout';
import { SCENE_SEED, hash01 } from './hash';
import type { Fault } from './settings';
import { BOARD_FRAGMENT, EDGE_FRAGMENT, STRESS_FRAGMENT, STRESS_VERTEX, TABLE_FRAGMENT, VERTEX } from './shaders';
import { INSET_LAYER } from './dice/layer';
import type { Surfaces } from './surfaces';
import type { WoodTextures } from './wood';
import { roomUniforms } from './env';
import { WOODS } from './woods';
import type { Wood } from './woods';

/** The look's dials, in one place. */
export const LOOK = {
  /** Where the key light stands: its height above the table, and its heading as [x, y] (upper left, a little beyond the board). */
  keyElevationDeg: 46,
  keyHeading: [-0.8, -0.6] as [number, number],
  /** The key's share of the light on an upward face; the rest is the room. */
  keyShare: 0.72,
  /** Tangent of the key's angular radius: how fast a shadow's edge softens with height. */
  penumbra: 0.3,
  /** Width of the dark line where a slab meets the table, in h. */
  contactWidth: 0.025,
  /** The warm grade: a gain on red, green, blue in linear light. */
  grade: [1.0, 0.968, 0.9] as [number, number, number],
  /** Values under this pass through the tone curve unchanged; a soft shoulder above. */
  shoulderStart: 0.97,
  /** The vignette: how much of the light it takes at the frame's corners, and where it begins (in half-diagonals from the middle). */
  vignette: 0.28,
  vignetteStart: 0.5,
  /**
   * The lamp over the table (ruling 36): where it hangs, from the middle of the boards (x, y, in h:
   * a little toward the far left, on the key's side) and its height above the sheet (h; about 0.9 m).
   */
  lampOffset: [-4, -7] as [number, number],
  lampHeight: 44,
  /**
   * Its reflection: the light it adds to the sheet at its middle, seen from above (a share of white);
   * the sharpness of that reflection (lower is broader); the same two for the table's varnish; and
   * how much it grows toward a grazing angle.
   */
  lampSheen: 0.1,
  lampLobe: 70,
  lampTable: 0.035,
  lampTableLobe: 30,
  lampGraze: 3.0,
  /** The board's sheen: highlight of the key, of the window; reflectance facing the eye; how fast it grows toward a grazing angle. */
  sheen: [6.0, 1.0, 0.014, 3.0] as [number, number, number, number],
  /** Sharpness of the key's and the window's lobe; how far the sheen takes the print's colour; scratch gain. */
  sheenB: [44, 9.5, 0.6, 1.0] as [number, number, number, number],
  /** The window beyond the far side of the table that the board mirrors from a low angle. */
  windowDir: [0.3, -0.75, 0.56] as [number, number, number],
  /** Unevenness of tone; rim wear; burnish (unevenness of the sheen); unused. */
  wear: [0.045, 1.0, 0.36, 0] as [number, number, number, number],
  /** Depth of the groove at a seam: how much of the light it takes at its middle (the former construction). */
  grooveDepth: 0.55,
  /** The mounted boards' covering paper, sRGB 0..255: a kraft brown, much greyer than the table's wood and lighter than its shadow. */
  wrapBrown: [138, 114, 88] as [number, number, number],
  /** Strength of the wrap's folds at the corners, and of its wear along the arrises (0 none, 1 as built, to 2). */
  wrapFolds: 1,
  wrapWear: 1,
  /** What a strength of 1 is to the shader, for the folds and for the wear: chosen by looking. */
  wrapFoldsGain: 1.35,
  wrapWearGain: 1.25,
  /** Depth of the wrap's relief: how strongly its tooth and fibres turn the light. */
  wrapRelief: 1.0,
  /** Gain of the coarser relief (the lie of the fibres), which is what shows of the tooth from further off. */
  wrapCoarseRelief: 0.9,
  /** The room's light that reaches the table inside a joint, as a share of what open table has: deep shadow, still wood. */
  gapLight: 0.9,
  /** The table's light given back onto a board's wall, as a share of the light on an upward face. */
  wallFill: 0.09,
  /** Strength of the sheet's cut edge: the hairline of white core toward the light, the shadow line away from it. */
  sheetEdge: 1,
  /** The table's finish: highlight of the key, of the window; reflectance facing the eye; lobe sharpness. */
  tableSheen: [1.1, 1.3, 0.035, 26] as [number, number, number, number],
  /** The wood's grain is turned this much against the board. */
  grainTurnDeg: -7,
  /** A table board's width and the wood texture's length, in h (128 mm and 512 mm at 20 mm a hex). */
  woodBoard: 6.4,
  woodLength: 25.6,
  /** The light's own dials (lights.ts, `uRig`): today's unless the address names another light. */
  rig: [0, 0.52, 0, 0] as [number, number, number, number],
  /**
   * The scanned wood under its clear coat (scene/wood.ts): how the finish wets the bare scan (a power on its
   * colour, then a gain); the coat's reflectance facing the eye, the sharpness of the key's and the lamp's
   * reflections in it, its wear (dull patches) and its scratches; and how bright the key, the window and the
   * lamp are in it (the window as a share of the light's `tableSheen` window, the lamp of its `lampTable`), and the room.
   */
  woodWet: [1.45, 0.7] as [number, number],
  coat: [0.04, 240, 1.0, 0.7] as [number, number, number, number],
  coatLight: [9, 5, 260, 0.35] as [number, number, number, number],
  /** The coat's relief, as slopes: its orange peel, its scratches of use, its swirls, its dents (chosen by looking). */
  coatB: [0.12, 0.2, 0.0016, 0.08] as [number, number, number, number],
  /** The printed paper's relief in its sheen, as slopes: its cockle, its fibre and tooth; and how much handling rubbed it smoother in places. */
  paper: [0.5, 0.05, 1.0, 0] as [number, number, number, number],
};

/**
 * How much of the reach's ink the nearer part of a reach is given besides the reach's own: 1 is the same ink laid
 * twice. (An ink is multiplied onto the sheet, so a share of it is that ink raised to the share.)
 */
export const NEAR_REACH_WEIGHT = 1;
function nearReachInk(reach: readonly [number, number, number]): [number, number, number] {
  const share = (v: number): number => Math.round(255 * Math.pow(v / 255, NEAR_REACH_WEIGHT));
  return [share(reach[0]), share(reach[1]), share(reach[2])];
}

/** Tint inks, sRGB 0..255: multiplied onto the hexes of a set. */
export const TINT_INKS: Readonly<Record<string, [number, number, number]>> = {
  reach: [190, 212, 235],
  fire: [236, 168, 150],
  selection: [235, 205, 110],
  other: [200, 200, 200],
  // For a game's tints (the pieces' port): a path, an objective, a zone. Quiet, and apart from the four above.
  path: [206, 228, 158],
  objective: [216, 192, 234],
  zone: [168, 222, 204],
  // The nearer part of a reach (the port's `reachNear`): laid over hexes that carry the reach's tint already, it is
  // the reach's own ink a second time (`NEAR_REACH_WEIGHT` of it), so the two are one family, a clear step apart.
  reachNear: nearReachInk([190, 212, 235]),
};
/** The first four are the channels of one texture, the rest of a second. */
export const TINT_NAMES = ['reach', 'fire', 'selection', 'other', 'path', 'objective', 'zone', 'reachNear'] as const;

/**
 * The lines that bar sight, drawn over the grid (ruling 34). Their inks and widths are the map
 * art's own, handed over with the sides; here only the least width in pixels, and how fully a line
 * covers the grid line and the print under it.
 */
export const SIGHT_LINE_MIN_PX = 1.6;
export const SIGHT_LINE_COVER = 0.94;
/** The most kinds of line the board's shader takes: one byte of a hex's texel each. */
export const SIGHT_LINE_KINDS = 4;

function toLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearOf(rgb: readonly [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(toLinear(rgb[0]), toLinear(rgb[1]), toLinear(rgb[2]));
}

/** Unit vector toward the key light, board frame. */
export function keyDirection(): [number, number, number] {
  const e = (LOOK.keyElevationDeg * Math.PI) / 180;
  const [hx, hy] = LOOK.keyHeading;
  const n = Math.hypot(hx, hy);
  return [(hx / n) * Math.cos(e), (hy / n) * Math.cos(e), Math.sin(e)];
}

export interface WorldInit {
  layout: BoardLayout;
  grid: GridGeometry;
  cols: number;
  rows: number;
  /** y of row 0's centre in the last column. */
  lastColumnY: number;
  /** Four digits a hex, row by row: the hex module's label. */
  hexDigits: Uint8Array;
  /** Row 0: two digits a column; row 1: two digits a row. Four bytes a texel. */
  rulerDigits: Uint8Array;
  rulerWidth: number;
  /** The key plate's ink, sRGB 0..255: the frame line is printed in it. */
  keyInk: [number, number, number];
  /** The overlay's ink, sRGB 0..255. */
  overlayInk: [number, number, number];
  /** The sheet's margin round the map in the map's season, sRGB 0..255 (white in summer). */
  stock: [number, number, number];
  /**
   * The lines that bar sight, in up to four kinds. `hexSides`: four bytes a hex, row by row, one
   * byte a kind, with one bit for each of the hex's six sides that is set (by the hex module's
   * number of the side), each side set in both hexes it lies between. `sideDirs`: for each of the
   * grid's three steps, the number of the side of a hex that lies toward it, then the three that lie
   * away. `sightInks` (sRGB 0..255) and `sightWidths` (h): the ink and the width of each kind.
   */
  hexSides: Uint8Array;
  sideDirs: [number, number, number, number, number, number];
  sightInks: [number, number, number][];
  sightWidths: number[];
  /**
   * How each kind is drawn. 'ink': printed on the map here, as an ink. 'cover': laid over what is
   * under it (a tree side, over the canopy). 'art': the art has printed it already, and the table
   * only keeps the grid's line off it (the hill lines, until the art leaves them out).
   */
  sightModes: ('ink' | 'cover' | 'art')[];
  faults: ReadonlySet<Fault>;
  maxAnisotropy: number;
}

type Uniform<T> = { value: T };

type Parts = { pos: number[]; nor: number[]; side: number[]; idx: number[] };

/**
 * Rounded boards and their edges, one after another in two geometries. `top`
 * holds each board's flat face; `edge` its rounded top arris, its wall and its
 * foot. Each board has its own four corners.
 */
function slabGeometry(rects: readonly Rect[], radius: number, thickness: number, topBevel: number, bottomBevel: number): { top: THREE.BufferGeometry; edge: THREE.BufferGeometry } {
  const top: Parts = { pos: [], nor: [], side: [], idx: [] };
  const edge: Parts = { pos: [], nor: [], side: [], idx: [] };
  rects.forEach((rect, k) => addSlab(top, edge, rect, radius, thickness, topBevel, bottomBevel, k * 97.3));
  const finish = (g: Parts): THREE.BufferGeometry => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3));
    geo.setAttribute('aSide', new THREE.Float32BufferAttribute(g.side, 3));
    geo.setIndex(g.idx);
    return geo;
  };
  return { top: finish(top), edge: finish(edge) };
}

/** One board: `alongFrom` is where its distance along the outline starts, so that no two boards wear alike. */
function addSlab(top: Parts, edge: Parts, outline: Rect, radius: number, thickness: number, topBevel: number, bottomBevel: number, alongFrom: number): void {
  const cx = (outline[0] + outline[2]) / 2;
  const cy = (outline[1] + outline[3]) / 2;
  const hx = (outline[2] - outline[0]) / 2;
  const hy = (outline[3] - outline[1]) / 2;
  const cornerSegs = 16;
  const bevelSegs = 4;
  const dirs: { ox: number; oy: number; nx: number; ny: number }[] = [];
  const corners: [number, number, number][] = [[1, 1, 0], [-1, 1, 90], [-1, -1, 180], [1, -1, 270]];
  for (const [sx, sy, a0] of corners) {
    for (let k = 0; k <= cornerSegs; k++) {
      const a = ((a0 + (90 * k) / cornerSegs) * Math.PI) / 180;
      dirs.push({ ox: cx + sx * (hx - radius), oy: cy + sy * (hy - radius), nx: Math.cos(a), ny: Math.sin(a) });
    }
  }
  dirs.push(dirs[0] as { ox: number; oy: number; nx: number; ny: number });
  const n = dirs.length;
  const along: number[] = [alongFrom];
  for (let i = 1; i < n; i++) {
    const a = dirs[i - 1] as { ox: number; oy: number; nx: number; ny: number };
    const b = dirs[i] as { ox: number; oy: number; nx: number; ny: number };
    along.push((along[i - 1] as number) + Math.hypot(b.ox + b.nx * radius - a.ox - a.nx * radius, b.oy + b.ny * radius - a.oy - a.ny * radius));
  }
  const ring = (g: { pos: number[]; nor: number[]; side: number[] }, inset: number, z: number, up: number, out: number, edge: number): number => {
    const start = g.pos.length / 3;
    const len = Math.hypot(up, out) || 1;
    for (let i = 0; i < n; i++) {
      const d = dirs[i] as { ox: number; oy: number; nx: number; ny: number };
      g.pos.push(d.ox + d.nx * (radius - inset), d.oy + d.ny * (radius - inset), z);
      g.nor.push((d.nx * out) / len, (d.ny * out) / len, up / len);
      g.side.push(along[i] as number, z + thickness, edge);
    }
    return start;
  };
  const join = (g: { idx: number[] }, a: number, b: number): void => {
    for (let i = 0; i < n - 1; i++) g.idx.push(a + i, a + i + 1, b + i, a + i + 1, b + i + 1, b + i);
  };

  const hub = top.pos.length / 3;
  top.pos.push(cx, cy, 0);
  top.nor.push(0, 0, 1);
  top.side.push(alongFrom, thickness, 0);
  const face = ring(top, topBevel, 0, 1, 0, 0);
  for (let i = 0; i < n - 1; i++) top.idx.push(hub, face + i, face + i + 1);

  let prev = -1;
  for (let j = 0; j <= bevelSegs; j++) {
    const a = ((j / bevelSegs) * Math.PI) / 2;
    const r = ring(edge, topBevel * (1 - Math.sin(a)), -topBevel * (1 - Math.cos(a)), Math.cos(a), Math.sin(a), j / bevelSegs);
    if (prev >= 0) join(edge, prev, r);
    prev = r;
  }
  const wallFoot = ring(edge, 0, -thickness + bottomBevel, 0, 1, 1);
  join(edge, prev, wallFoot);
  prev = wallFoot;
  for (let j = 1; j <= 2; j++) {
    const a = ((j / 2) * Math.PI) / 2;
    const r = ring(edge, bottomBevel * (1 - Math.cos(a)), -thickness + bottomBevel * (1 - Math.sin(a)), -Math.sin(a), Math.cos(a), 1);
    join(edge, prev, r);
    prev = r;
  }
}

/** The rectangles the board meshes are built on: three mounted boards, or the former construction's one outline. */
function boardRects(layout: BoardLayout): Rect[] {
  return layout.construction === 'old' ? [layout.outline] : [...layout.slabs];
}

/** The bottom arris: the former construction keeps its own. */
function bottomBevelOf(layout: BoardLayout): number {
  return layout.construction === 'old' ? BOTTOM_BEVEL : MOUNT_BOTTOM_BEVEL;
}

function flatRect(r: Rect, z: number): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([r[0], r[1], z, r[2], r[1], z, r[2], r[3], z, r[0], r[3], z], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geo.setAttribute('aSide', new THREE.Float32BufferAttribute(new Array<number>(12).fill(0), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  return geo;
}

function dataTexture(data: Uint8Array, width: number, height: number): THREE.DataTexture {
  const t = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export class World {
  readonly root = new THREE.Group();
  /** Uniforms every material shares: one object each, so a change reaches them all. */
  readonly shared: Record<string, Uniform<unknown>>;
  /** False under a planted fault that replaces the sheet's finish (`gloss`) or takes it away (`clean`). */
  private readonly lampOn: boolean;
  /** Bytes of this file's own small data textures. */
  readonly dataBytes: number;
  readonly dataCount = 5;
  private readonly tintData: Uint8Array;
  private readonly tintTexture: THREE.DataTexture;
  private readonly tintDataB: Uint8Array;
  private readonly tintTextureB: THREE.DataTexture;
  private readonly digitsTexture: THREE.DataTexture;
  private readonly sidesTexture: THREE.DataTexture;
  private readonly rulerTexture: THREE.DataTexture;
  private readonly defines: Record<string, string>;
  private readonly stress: THREE.Mesh;
  private readonly stressLoops: Uniform<number> = { value: 0 };
  private readonly art = new Set<THREE.Mesh>();
  private readonly fixed: THREE.Mesh[] = [];
  private readonly top: THREE.Mesh;
  private readonly edge: THREE.Mesh;
  private layout: BoardLayout;

  constructor(private readonly init: WorldInit, surfaces: Surfaces) {
    const { layout, grid, cols, rows } = init;
    const key = keyDirection();
    const faults = init.faults;
    this.tintData = new Uint8Array(cols * rows * 4);
    this.tintTexture = dataTexture(this.tintData, cols, rows);
    this.tintDataB = new Uint8Array(cols * rows * 4);
    this.tintTextureB = dataTexture(this.tintDataB, cols, rows);
    this.digitsTexture = dataTexture(init.hexDigits, cols, rows);
    this.sidesTexture = dataTexture(init.hexSides, cols, rows);
    this.rulerTexture = dataTexture(init.rulerDigits, init.rulerWidth, 2);
    this.dataBytes = cols * rows * 16 + init.rulerWidth * 8;
    this.defines = {};
    this.layout = layout;
    const win = new THREE.Vector3(...LOOK.windowDir).normalize();
    const diag = Math.hypot(layout.outline[2] - layout.outline[0], layout.outline[3] - layout.outline[1]) / 2;
    const turn = (LOOK.grainTurnDeg * Math.PI) / 180;
    const clean = faults.has('clean');
    const gloss = faults.has('gloss');
    const gpu = boardsForShaders(layout);
    this.shared = {
      uScreen: { value: new THREE.Vector4(1, 1, LOOK.vignette, LOOK.vignetteStart) },
      uGrade: { value: new THREE.Vector4(LOOK.grade[0], LOOK.grade[1], LOOK.grade[2], LOOK.shoulderStart) },
      uOutline: { value: new THREE.Vector4(...layout.outline) },
      uShape: { value: new THREE.Vector4(layout.cornerRadius, layout.rimWidth, layout.margin, layout.thickness) },
      uKeyDir: { value: new THREE.Vector3(...key) },
      uLight: { value: new THREE.Vector4(LOOK.keyShare, faults.has('noshadow') ? 0 : 1, 1, 1) },
      uNoise: { value: surfaces.noise },
      uBoard: { value: new THREE.Vector4(...layout.board) },
      uSeams: { value: new THREE.Vector4(...gpu.seams, layout.grooveWidth, LOOK.grooveDepth) },
      uBoards: { value: gpu.boards.map(r => new THREE.Vector4(...r)) },
      uSheets: { value: gpu.sheets.map(r => new THREE.Vector4(...r)) },
      uMount: { value: new THREE.Vector4(layout.border, layout.gap, layout.sheetCornerRadius, layout.construction === 'old' ? 0 : 1) },
      uWrap: { value: new THREE.Vector4(...linearOf(LOOK.wrapBrown).toArray(), LOOK.wrapFolds * LOOK.wrapFoldsGain) },
      uWrapB: { value: new THREE.Vector4(LOOK.wrapWear * LOOK.wrapWearGain, LOOK.wrapRelief, LOOK.sheetEdge, hash01(SCENE_SEED, 'pleats', 0) * 64) },
      uWrapC: { value: new THREE.Vector4(LOOK.gapLight, LOOK.wallFill, LOOK.wrapCoarseRelief, layout.topBevel) },
      uWrapTex: { value: surfaces.wrap },
      uStock: { value: linearOf(init.stock) },
      uGridA: { value: new THREE.Vector4(grid.origin[0], grid.origin[1], grid.cell[0], grid.cell[1]) },
      uGridB: { value: new THREE.Vector4(grid.odd[0], grid.odd[1], cols, rows) },
      uStep0: { value: new THREE.Vector2(...grid.steps[0]) },
      uStep1: { value: new THREE.Vector2(...grid.steps[1]) },
      uStep2: { value: new THREE.Vector2(...grid.steps[2]) },
      uHexDigits: { value: this.digitsTexture },
      uHexTints: { value: this.tintTexture },
      uHexTintsB: { value: this.tintTextureB },
      uHexSides: { value: this.sidesTexture },
      uSideDirA: { value: new THREE.Vector3(init.sideDirs[0], init.sideDirs[1], init.sideDirs[2]) },
      uSideDirB: { value: new THREE.Vector3(init.sideDirs[3], init.sideDirs[4], init.sideDirs[5]) },
      uSight: { value: new THREE.Vector4(1, 0, SIGHT_LINE_MIN_PX, SIGHT_LINE_COVER) },
      uSightW: { value: new THREE.Vector4(init.sightWidths[0] ?? 0, init.sightWidths[1] ?? 0, init.sightWidths[2] ?? 0, init.sightWidths[3] ?? 0) },
      uSightMode: { value: new THREE.Vector4(...[0, 1, 2, 3].map(k => ({ ink: 0, cover: 1, art: 2 })[init.sightModes[k] ?? 'ink'])) },
      uSightInk: { value: [0, 1, 2, 3].map(k => linearOf(init.sightInks[k] ?? [0, 0, 0])) },
      uRuler: { value: this.rulerTexture },
      uDigits: { value: surfaces.digits },
      uOverlay: { value: new THREE.Vector4(1, 1, 1, 0) },
      uInk: { value: linearOf(init.overlayInk) },
      uTintInk: { value: TINT_NAMES.map(name => linearOf(TINT_INKS[name] as [number, number, number])) },
      uLine: {
        value: new THREE.Vector4(
          faults.has('gridthin') || faults.has('gridfaint') ? 0 : LINE_WIDTH,
          faults.has('gridthin') || faults.has('gridfaint') ? 0.4 : MIN_LINE_PX,
          faults.has('gridshift') ? 0.02 : 0,
          faults.has('gridfaint') ? 0.3 : 1,
        ),
      },
      uLabel: { value: new THREE.Vector4(LABEL_HEIGHT, DIGIT_ASPECT, LABEL_GAP, DIGIT_HALF_STROKE) },
      uRulerA: { value: new THREE.Vector4(RULER_HEIGHT, init.lastColumnY, DIGIT_RANGE, 10) },
      uFrame: { value: new THREE.Vector4(...linearOf(init.keyInk).toArray(), FRAME_WIDTH) },
      uFault: { value: new THREE.Vector4(faults.has('seamshift') ? 0.02 : 0, gloss ? 1 : 0, clean ? 1 : 0, 0) },
      uSurface: { value: surfaces.surface },
      uSheen: { value: gloss ? new THREE.Vector4(9, 5, 0.05, 5) : new THREE.Vector4(...LOOK.sheen) },
      uSheenB: { value: gloss ? new THREE.Vector4(150, 120, 0, 0) : new THREE.Vector4(...LOOK.sheenB) },
      uWinDir: { value: win },
      uWear: { value: new THREE.Vector4(...LOOK.wear) },
      uWood: { value: surfaces.wood },
      uWoodXf: { value: new THREE.Vector4(Math.cos(turn), Math.sin(turn), LOOK.woodBoard, LOOK.woodLength) },
      uPool: { value: new THREE.Vector4((layout.outline[0] + layout.outline[2]) / 2, (layout.outline[1] + layout.outline[3]) / 2, diag * 1.05, diag * 3.2) },
      uShadow: { value: new THREE.Vector4((key[0] / key[2]) * layout.thickness, (key[1] / key[2]) * layout.thickness, LOOK.penumbra, LOOK.contactWidth) },
      uTableSheen: { value: new THREE.Vector4(...LOOK.tableSheen) },
      uLamp: { value: new THREE.Vector4((layout.outline[0] + layout.outline[2]) / 2 + LOOK.lampOffset[0], (layout.outline[1] + layout.outline[3]) / 2 + LOOK.lampOffset[1], LOOK.lampHeight, gloss || clean ? 0 : LOOK.lampSheen) },
      uLampB: { value: new THREE.Vector4(LOOK.lampLobe, gloss || clean ? 0 : LOOK.lampTable, LOOK.lampTableLobe, LOOK.lampGraze) },
      uRig: { value: new THREE.Vector4(...LOOK.rig) },
      uWoodColour: { value: null },
      uWoodNormal: { value: null },
      uWoodRough: { value: null },
      uWoodScan: { value: new THREE.Vector4(0, 50, LOOK.woodWet[0], LOOK.woodWet[1]) },
      // The scanned wood's laying and finish (woods.ts), set with the wood.
      uWoodLook: { value: new THREE.Vector4(0, 1, 1, 0.35) },
      uWoodLookB: { value: new THREE.Vector4(0.1, 0, 0, 1) },
      uCoat: { value: new THREE.Vector4(...LOOK.coat) },
      uCoatLight: { value: new THREE.Vector4(...LOOK.coatLight) },
      uCoatB: { value: new THREE.Vector4(...LOOK.coatB) },
      uPaper: { value: new THREE.Vector4(...LOOK.paper) },
      // The room round the table (env.ts): none until the page hands one over.
      ...roomUniforms(),
    };
    this.lampOn = !(gloss || clean);

    const slab = slabGeometry(boardRects(layout), layout.cornerRadius, layout.thickness, layout.topBevel, bottomBevelOf(layout));
    // The boards' own tops: the wrap, and the sheet's stock, margin and rulers. Everything of the map lies over them.
    const top = new THREE.Mesh(slab.top, this.boardMaterial(null, new THREE.Vector4(0, 0, 1, 1), 3));
    top.renderOrder = 3;
    const edge = new THREE.Mesh(slab.edge, this.material(EDGE_FRAGMENT, {}));
    edge.renderOrder = 4;
    this.top = top;
    this.edge = edge;
    const table = new THREE.Mesh(flatRect(layout.table.rect, layout.table.z), this.material(TABLE_FRAGMENT, {}));
    table.renderOrder = 5;
    // The dice inset's camera sees the table round the tray's corners (dice/inset.ts).
    table.layers.enable(INSET_LAYER);
    // The stress setting: work for the GPU that leaves the picture as it is.
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.stress = new THREE.Mesh(
      tri,
      new THREE.ShaderMaterial({
        uniforms: { uLoops: this.stressLoops },
        vertexShader: STRESS_VERTEX,
        fragmentShader: STRESS_FRAGMENT,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.stress.renderOrder = 9;
    this.stress.frustumCulled = false;
    this.stress.visible = false;
    this.fixed = [top, edge, table, this.stress];
    for (const m of this.fixed) this.root.add(m);
  }

  private material(fragment: string, own: Record<string, Uniform<unknown>>): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: { ...this.shared, ...own } as Record<string, THREE.IUniform>,
      defines: { ...this.defines },
      vertexShader: VERTEX,
      fragmentShader: fragment,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  }

  /** The board's material for one piece of the map (or, with no texture, for the slabs' own top). */
  private boardMaterial(texture: THREE.Texture | null, xf: THREE.Vector4, depthStep: number): THREE.ShaderMaterial {
    const m = this.material(BOARD_FRAGMENT, { uArt: { value: texture }, uArtXf: { value: xf }, uArtOn: { value: texture ? 1 : 0 } });
    if (depthStep > 0) {
      m.polygonOffset = true;
      m.polygonOffsetFactor = depthStep;
      m.polygonOffsetUnits = depthStep * 4;
    }
    return m;
  }

  /**
   * Lay a piece of the baked map on the board. `rect` is the ground it covers, in
   * h; `texel` the level-pixel rectangle the texture holds (x, y, w, h), which is
   * a little more than the ground where the tile has gutters.
   */
  addArt(level: number, rect: Rect, texture: THREE.Texture, texel: readonly [number, number, number, number], pxPerHex: number): THREE.Mesh {
    const b = this.init.layout.board;
    const xf = new THREE.Vector4(b[0] + texel[0] / pxPerHex, b[1] + texel[1] / pxPerHex, pxPerHex / texel[2], pxPerHex / texel[3]);
    const mesh = new THREE.Mesh(flatRect(rect, 0), this.boardMaterial(texture, xf, 2 - level));
    mesh.renderOrder = 2 - level;
    this.art.add(mesh);
    this.root.add(mesh);
    return mesh;
  }

  removeArt(mesh: THREE.Mesh): void {
    if (!this.art.delete(mesh)) return;
    this.root.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }

  /**
   * The boards laid out anew (a dial of the mounted boards changed, or the
   * construction): their meshes are rebuilt and the shaders told. The map's
   * rectangle, and so every piece of art, stays where it is.
   */
  relayout(layout: BoardLayout): void {
    this.layout = layout;
    const slab = slabGeometry(boardRects(layout), layout.cornerRadius, layout.thickness, layout.topBevel, bottomBevelOf(layout));
    this.top.geometry.dispose();
    this.edge.geometry.dispose();
    this.top.geometry = slab.top;
    this.edge.geometry = slab.edge;
    const u = this.shared;
    (u.uOutline as Uniform<THREE.Vector4>).value.set(...layout.outline);
    (u.uShape as Uniform<THREE.Vector4>).value.set(layout.cornerRadius, layout.rimWidth, layout.margin, layout.thickness);
    const gpu = boardsForShaders(layout);
    (u.uSeams as Uniform<THREE.Vector4>).value.set(...gpu.seams, layout.grooveWidth, LOOK.grooveDepth);
    (u.uBoards as Uniform<THREE.Vector4[]>).value.forEach((v, k) => v.set(...(gpu.boards[k] as Rect)));
    (u.uSheets as Uniform<THREE.Vector4[]>).value.forEach((v, k) => v.set(...(gpu.sheets[k] as Rect)));
    (u.uMount as Uniform<THREE.Vector4>).value.set(layout.border, layout.gap, layout.sheetCornerRadius, layout.construction === 'old' ? 0 : 1);
    (u.uWrapC as Uniform<THREE.Vector4>).value.set(LOOK.gapLight, LOOK.wallFill, LOOK.wrapCoarseRelief, layout.topBevel);
    const diag = Math.hypot(layout.outline[2] - layout.outline[0], layout.outline[3] - layout.outline[1]) / 2;
    (u.uPool as Uniform<THREE.Vector4>).value.set((layout.outline[0] + layout.outline[2]) / 2, (layout.outline[1] + layout.outline[3]) / 2, diag * 1.05, diag * 3.2);
    const lamp = (u.uLamp as Uniform<THREE.Vector4>).value;
    lamp.set((layout.outline[0] + layout.outline[2]) / 2 + LOOK.lampOffset[0], (layout.outline[1] + layout.outline[3]) / 2 + LOOK.lampOffset[1], LOOK.lampHeight, lamp.w);
  }

  /** The wrap's dials, after LOOK changed. */
  applyWrap(): void {
    const brown = linearOf(LOOK.wrapBrown);
    const wrap = (this.shared.uWrap as Uniform<THREE.Vector4>).value;
    wrap.set(brown.x, brown.y, brown.z, LOOK.wrapFolds * LOOK.wrapFoldsGain);
    const b = (this.shared.uWrapB as Uniform<THREE.Vector4>).value;
    b.set(LOOK.wrapWear * LOOK.wrapWearGain, LOOK.wrapRelief, LOOK.sheetEdge, b.w);
    const c = (this.shared.uWrapC as Uniform<THREE.Vector4>).value;
    c.set(LOOK.gapLight, LOOK.wallFill, LOOK.wrapCoarseRelief, c.w);
  }

  /** New surface textures after a lost context. */
  setSurfaces(s: Surfaces): void {
    (this.shared.uWrapTex as Uniform<THREE.Texture>).value = s.wrap;
    (this.shared.uNoise as Uniform<THREE.Texture>).value = s.noise;
    (this.shared.uSurface as Uniform<THREE.Texture>).value = s.surface;
    (this.shared.uWood as Uniform<THREE.Texture>).value = s.wood;
    (this.shared.uDigits as Uniform<THREE.Texture>).value = s.digits;
  }

  /** The hexes of each tint set. */
  setTints(tints: Readonly<Record<string, readonly number[]>>): void {
    this.tintData.fill(0);
    this.tintDataB.fill(0);
    const hexes = this.init.cols * this.init.rows;
    for (const [name, ids] of Object.entries(tints)) {
      const known = (TINT_NAMES as readonly string[]).indexOf(name);
      const channel = known >= 0 ? known : 3;
      const data = channel < 4 ? this.tintData : this.tintDataB;
      for (const id of ids) if (Number.isInteger(id) && id >= 0 && id < hexes) data[id * 4 + channel - (channel < 4 ? 0 : 4)] = 255;
    }
    this.tintTexture.needsUpdate = true;
    this.tintTextureB.needsUpdate = true;
  }

  /** What changes from frame to frame. */
  apply(s: {
    device: readonly [number, number];
    grade: boolean;
    vignette: boolean;
    /** The lamp's reflection, as a share of its own strength (0 none, 1 as built). */
    lamp: number;
    lit: boolean;
    detail: boolean;
    overlay: { strength: number; lines: boolean; labels: boolean; tints: boolean; sight: boolean };
    stressLoops: number;
  }): void {
    const screen = (this.shared.uScreen as Uniform<THREE.Vector4>).value;
    screen.set(s.device[0], s.device[1], s.vignette ? LOOK.vignette : 0, LOOK.vignetteStart);
    const lampShare = this.lampOn ? s.lamp : 0;
    (this.shared.uLamp as Uniform<THREE.Vector4>).value.w = LOOK.lampSheen * lampShare;
    (this.shared.uLampB as Uniform<THREE.Vector4>).value.y = LOOK.lampTable * lampShare;
    const grade = (this.shared.uGrade as Uniform<THREE.Vector4>).value;
    if (s.grade) grade.set(LOOK.grade[0], LOOK.grade[1], LOOK.grade[2], LOOK.shoulderStart);
    else grade.set(1, 1, 1, LOOK.shoulderStart);
    const light = (this.shared.uLight as Uniform<THREE.Vector4>).value;
    light.z = s.lit ? 1 : 0;
    light.w = s.detail ? 1 : 0;
    (this.shared.uOverlay as Uniform<THREE.Vector4>).value.set(s.overlay.strength, s.overlay.lines ? 1 : 0, s.overlay.labels ? 1 : 0, s.overlay.tints ? 1 : 0);
    (this.shared.uSight as Uniform<THREE.Vector4>).value.x = s.overlay.sight ? 1 : 0;
    this.stressLoops.value = s.stressLoops;
    this.stress.visible = s.stressLoops > 0;
  }

  /** The textures to upload again after a lost context. */
  dataTextures(): THREE.Texture[] {
    return [this.tintTexture, this.tintTextureB, this.digitsTexture, this.rulerTexture, this.sidesTexture, ...(this.wood ? [this.wood.colour, this.wood.normal, this.wood.rough] : [])];
  }

  private wood: WoodTextures | null = null;
  /** The table's scanned wood (scene/wood.ts), or null for the wood the table draws itself. */
  setWood(t: WoodTextures | null): void {
    if (this.wood) for (const old of [this.wood.colour, this.wood.normal, this.wood.rough]) old.dispose();
    this.wood = t;
    (this.shared.uWoodColour as Uniform<THREE.Texture | null>).value = t ? t.colour : null;
    (this.shared.uWoodNormal as Uniform<THREE.Texture | null>).value = t ? t.normal : null;
    (this.shared.uWoodRough as Uniform<THREE.Texture | null>).value = t ? t.rough : null;
    const scan = (this.shared.uWoodScan as Uniform<THREE.Vector4>).value;
    scan.x = t ? 1 : 0;
    scan.y = t ? t.sideH : 50;
    if (t) {
      const w: Wood = WOODS[t.name];
      scan.z = w.wet[0];
      scan.w = w.wet[1];
      (this.shared.uWoodLook as Uniform<THREE.Vector4>).value.set(w.planks === 'scan' ? 1 : 0, w.normalGain, w.coat ? 1 : 0, w.follow);
      (this.shared.uWoodLookB as Uniform<THREE.Vector4>).value.set(w.coatRough, w.roughGain, w.roughBias, w.wear);
    }
  }

  /** Centre of the boards' outline. */
  centre(): Point {
    const o = this.layout.outline;
    return [(o[0] + o[2]) / 2, (o[1] + o[3]) / 2];
  }
}
