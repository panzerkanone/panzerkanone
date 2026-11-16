/**
 * The pieces as three.js objects, in the board frame like everything else on
 * the table: every counter in one instanced mesh, the shadows they lay on the
 * boards and the table (cells of the plan, each with the list of counters
 * whose shadow can reach it), the glow round a marked counter, and what the
 * game of orders shows besides (cues.ts): the strokes of its lines of fire,
 * tags and routes, and the markers lying on hexes. It reads pieces.ts and
 * changes nothing in it.
 *
 * What is drawn is recomputed only when the pieces say something moved
 * (`stamp`), and nothing here asks for a frame.
 */
import * as THREE from 'three';
import { keyDirection, linearOf } from '../world';
import { Strokes, strokesOf } from './cues';
import { CHOSEN, CLOSE, COUNTER, CUE, FEEL, LIT, LIT_INK, MARK_INKS, MARK_LOOK, MOVED_MARK, SPENT, chosenPulseOf, closePulseOf, pulseOf } from './dims';
import { FACE_INSET, STOCKS, TAB, faceKey, makeFaceAtlas, tabLeft } from './faces';
import type { FaceAtlas, Silhouette } from './faces';
import { makeMarkerAtlas, printKey } from './markerart';
import type { MarkerAtlas, MarkerPrint } from './markerart';
import type { Piece, Pieces } from './pieces';
import { rotate } from './pose';
import type { Pose } from './pose';
import { openingAt, overTray } from '../tray/layout';
import type { PlacedTray } from '../tray/layout';
import { TrayView, placeTrayUniforms, trayUniforms } from '../tray/view';
import type { TrayArt } from '../tray/view';
import { DICE_DRAWN, DiceView } from '../dice/view';
import type { DieShown } from '../dice/dice';
import { DIE } from '../dice/throw';
import {
  CELL_CASTERS, COUNTER_CASTERS, COUNTER_FRAGMENT, COUNTER_VERTEX, GROUND_FRAGMENT, GROUND_VERTEX, HALO_FRAGMENT, HALO_VERTEX,
  MARKER_FRAGMENT, MARKER_SHADOW_FRAGMENT, MARKER_SHADOW_VERTEX, MARKER_VERTEX, STROKE_FRAGMENT, STROKE_VERTEX,
} from './shaders';

type Uniform<T> = { value: T };
type Rect = readonly [number, number, number, number];

/** The look's dials for the pieces. */
export const PIECE_LOOK = {
  /** The card's grey-brown core, and its plain back, sRGB 0..255. */
  core: [141, 128, 108] as [number, number, number],
  back: [203, 196, 180] as [number, number, number],
  /** How much glossier a counter's face is than the map sheet. */
  gloss: 1.25,
  /** The surface's light back onto a counter's wall, and how dark the foot of a wall is. */
  wallFill: 0.2,
  footDark: 0.34,
  /** Tangent of the key's angular radius for the counters' shadows, and the width of the dark line where one meets a surface (h). */
  penumbra: 0.3,
  contactWidth: 0.02,
  /** How much of a shadow the ground is given (1 is all of it). */
  groundShadow: 1,
  /** A cell of the ground's shadow grid, in h: small, so that little ground is shaded that no shadow reaches. */
  cell: 0.25,
  /** How glossy a marker's print is, against the map sheet (a counter's face is `gloss`). */
  markerGloss: 0.9,
  /** The share of a marker's cell in the atlas that is only card on each side. */
  markerInset: 0.04,
};

const S = COUNTER.side;
const T = COUNTER.thickness;
/**
 * Which faces of a counter are drawn: its outside only (the rings of `counterGeometry` are wound so
 * that, in the board frame as the page's camera draws it, the outside is the front). Drawing both
 * sides shades every counter twice.
 */
const COUNTER_SIDE: THREE.Side = THREE.FrontSide;
/** How far from a caster its shadow of the room reaches (the shader's AO_REACH). */
const AO_REACH = 0.11;

/** A die-cut counter, centred on its own middle, lying in the xy plane. */
function counterGeometry(): { pos: number[]; nor: number[]; uv: number[]; part: number[]; idx: number[] } {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const part: number[] = [];
  const idx: number[] = [];
  const h = S / 2;
  const r = COUNTER.cornerRadius;
  const cornerSegs = 7;
  const bevelSegs = 3;
  const dirs: { ox: number; oy: number; nx: number; ny: number }[] = [];
  const corners: [number, number, number][] = [[1, 1, 0], [-1, 1, 90], [-1, -1, 180], [1, -1, 270]];
  for (const [sx, sy, a0] of corners) {
    for (let k = 0; k <= cornerSegs; k++) {
      const a = ((a0 + (90 * k) / cornerSegs) * Math.PI) / 180;
      dirs.push({ ox: sx * (h - r), oy: sy * (h - r), nx: Math.cos(a), ny: Math.sin(a) });
    }
  }
  dirs.push(dirs[0] as { ox: number; oy: number; nx: number; ny: number });
  const n = dirs.length;
  const along: number[] = [0];
  for (let i = 1; i < n; i++) {
    const a = dirs[i - 1] as { ox: number; oy: number; nx: number; ny: number };
    const b = dirs[i] as { ox: number; oy: number; nx: number; ny: number };
    along.push((along[i - 1] as number) + Math.hypot(b.ox + b.nx * r - a.ox - a.nx * r, b.oy + b.ny * r - a.oy - a.ny * r));
  }
  const ring = (inset: number, z: number, up: number, out: number, which: number, height: number): number => {
    const start = pos.length / 3;
    const len = Math.hypot(up, out) || 1;
    for (let i = 0; i < n; i++) {
      const d = dirs[i] as { ox: number; oy: number; nx: number; ny: number };
      const x = d.ox + d.nx * (r - inset);
      const y = d.oy + d.ny * (r - inset);
      pos.push(x, y, z);
      nor.push((d.nx * out) / len, (d.ny * out) / len, up / len);
      uv.push(x / S + 0.5, y / S + 0.5);
      part.push(along[i] as number, height, which);
    }
    return start;
  };
  const join = (a: number, b: number): void => {
    for (let i = 0; i < n - 1; i++) idx.push(a + i, a + i + 1, b + i, a + i + 1, b + i + 1, b + i);
  };
  const fan = (z: number, up: number, which: number, height: number, rim: number): void => {
    const hub = pos.length / 3;
    pos.push(0, 0, z);
    nor.push(0, 0, up);
    uv.push(0.5, 0.5);
    part.push(0, height, which);
    // Wound so that the face is seen from outside the counter: one way for the top, the other for the back.
    for (let i = 0; i < n - 1; i++) {
      if (up > 0) idx.push(hub, rim + i + 1, rim + i);
      else idx.push(hub, rim + i, rim + i + 1);
    }
  };
  const tb = COUNTER.topBevel;
  const bb = COUNTER.bottomBevel;
  // The printed face, and the pressed edge the die leaves round it (the print runs over it).
  const faceRim = ring(tb, T / 2, 1, 0, 0, 1);
  fan(T / 2, 1, 0, 1, faceRim);
  let prev = -1;
  for (let j = 0; j <= bevelSegs; j++) {
    const a = ((j / bevelSegs) * Math.PI) / 2;
    const k = ring(tb * (1 - Math.sin(a)), T / 2 - tb * (1 - Math.cos(a)), Math.cos(a), Math.sin(a), 0, 1);
    if (prev >= 0) join(prev, k);
    prev = k;
  }
  // The cut edge.
  const wallTop = ring(0, T / 2 - tb, 0, 1, 1, 1);
  const wallFoot = ring(0, -T / 2 + bb, 0, 1, 1, 0);
  join(wallTop, wallFoot);
  const turnUnder = ring(bb, -T / 2, -1, 1, 1, 0);
  join(wallFoot, turnUnder);
  // The plain back.
  const backRim = ring(bb, -T / 2, -1, 0, 2, 0);
  fan(-T / 2, -1, 2, 0, backRim);
  return { pos, nor, uv, part, idx };
}

/**
 * A marker: a hexagon of thin card, its corners a little rounded, centred on its own middle and
 * lying in the xy plane. `corners` are the hexagon's corners from its middle, in order.
 */
function markerGeometry(corners: readonly (readonly [number, number])[], thickness: number, round: number, inset: number): { pos: number[]; nor: number[]; uv: number[]; part: number[]; idx: number[] } {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const part: number[] = [];
  const idx: number[] = [];
  const n = corners.length;
  const reach = Math.max(...corners.map(c => Math.hypot(c[0], c[1])));
  // The outline: each corner cut by a short curve from one side to the next.
  const ring: [number, number][] = [];
  const per = 3;
  for (let i = 0; i < n; i++) {
    const c = corners[i] as readonly [number, number];
    const a = corners[(i + n - 1) - n * Math.floor((i + n - 1) / n)] as readonly [number, number];
    const b = corners[(i + 1) - n * Math.floor((i + 1) / n)] as readonly [number, number];
    const toward = (q: readonly [number, number]): [number, number] => {
      const len = Math.hypot(q[0] - c[0], q[1] - c[1]) || 1;
      return [c[0] + ((q[0] - c[0]) / len) * round, c[1] + ((q[1] - c[1]) / len) * round];
    };
    const p0 = toward(a);
    const p1 = toward(b);
    for (let k = 0; k <= per; k++) {
      const u = k / per;
      ring.push([(1 - u) * (1 - u) * p0[0] + 2 * u * (1 - u) * c[0] + u * u * p1[0], (1 - u) * (1 - u) * p0[1] + 2 * u * (1 - u) * c[1] + u * u * p1[1]]);
    }
  }
  const m = ring.length;
  const at = (i: number): [number, number] => ring[i - m * Math.floor(i / m)] as [number, number];
  const uvOf = (x: number, y: number): [number, number] => [0.5 + (x / (2 * reach)) * (1 - 2 * inset), 0.5 + (y / (2 * reach)) * (1 - 2 * inset)];
  // The printed face: a fan from the middle.
  const hub = 0;
  pos.push(0, 0, thickness / 2);
  nor.push(0, 0, 1);
  uv.push(0.5, 0.5);
  part.push(1, 1, 0);
  for (let i = 0; i < m; i++) {
    const q = at(i);
    pos.push(q[0], q[1], thickness / 2);
    nor.push(0, 0, 1);
    uv.push(...uvOf(q[0], q[1]));
    part.push(0, 1, 0);
  }
  for (let i = 0; i < m; i++) idx.push(hub, 1 + i, 1 + (i + 1 - m * Math.floor((i + 1) / m)));
  // The cut edge.
  const wall = pos.length / 3;
  for (let i = 0; i <= m; i++) {
    const q = at(i);
    const before = at(i + m - 1);
    const after = at(i + 1);
    let nx = after[1] - before[1];
    let ny = -(after[0] - before[0]);
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    if (nx * q[0] + ny * q[1] < 0) {
      nx = -nx;
      ny = -ny;
    }
    for (const top of [1, 0]) {
      pos.push(q[0], q[1], top === 1 ? thickness / 2 : -thickness / 2);
      nor.push(nx, ny, 0);
      uv.push(...uvOf(q[0], q[1]));
      part.push(0, top, 1);
    }
  }
  for (let i = 0; i < m; i++) {
    const a = wall + i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  return { pos, nor, uv, part, idx };
}

function quad(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

function instanced(g: THREE.InstancedBufferGeometry, name: string, size: number, count: number): Float32Array {
  const data = new Float32Array(size * count);
  const a = new THREE.InstancedBufferAttribute(data, size);
  a.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute(name, a);
  return data;
}

interface Caster {
  x: number;
  y: number;
  z0: number;
  z1: number;
  c: number;
  s: number;
  hx: number;
  hy: number;
  /** Half its reach on the plan, whichever way it is turned. */
  ex: number;
  ey: number;
  on: boolean;
}

export class PiecesView {
  readonly group = new THREE.Group();
  /** Textures this view holds, and their bytes on the GPU. */
  textures = { count: 0, bytes: 0 };
  private readonly pieces: Pieces;
  private readonly shared: Record<string, Uniform<unknown>>;
  private readonly maxAnisotropy: number;
  private readonly slabs: () => readonly Rect[];
  private readonly tableZ: () => number;
  private atlas: FaceAtlas | null = null;
  private art: ReadonlyMap<string, Silhouette> | null = null;
  private version = -1;
  private faceVersion = -1;
  private stamp = -1;
  private cueStamp = -1;
  private cuesDrawn = false;
  /** The way letters on the table ran when the tags were last laid out. */
  private right: [number, number] = [1, 0];
  private capacity = 0;
  private counters: THREE.Mesh | null = null;
  private place: Float32Array = new Float32Array(0);
  private turn: Float32Array = new Float32Array(0);
  private info: Float32Array = new Float32Array(0);
  private marks: Float32Array = new Float32Array(0);
  private marksB: Float32Array = new Float32Array(0);
  /** A close attack's red glow (with its swell), and the swells of a counter just chosen. */
  private marksC: Float32Array = new Float32Array(0);
  private notes: Float32Array = new Float32Array(0);
  private occA: Float32Array = new Float32Array(0);
  private occB: Float32Array = new Float32Array(0);
  private casterData: Float32Array = new Float32Array(0);
  private casterTexture: THREE.DataTexture | null = null;
  private casters: Caster[] = [];
  private readonly own: Record<string, Uniform<unknown>>;
  private ground: THREE.Mesh;
  private groundCap = 0;
  private cell: Float32Array = new Float32Array(0);
  private lists: Float32Array[] = [];
  private halo: THREE.Mesh;
  private haloCap = 0;
  private haloAt: Float32Array = new Float32Array(0);
  private haloTint: Float32Array = new Float32Array(0);
  private strokes: THREE.Mesh;
  private readonly strokeList = new Strokes();
  private markers: THREE.Mesh;
  private markerShadows: THREE.Mesh;
  private markerCap = 0;
  private markerPlace: Float32Array = new Float32Array(0);
  private markerTurn: Float32Array = new Float32Array(0);
  private markerHex: Float32Array = new Float32Array(0);
  private markerOccA: Float32Array = new Float32Array(0);
  private markerOccB: Float32Array = new Float32Array(0);
  private markerAtlas: MarkerAtlas | null = null;
  private markerVersion = -1;
  /** A marker's shape: its corners from its middle, and how far its sides and corners are from it. */
  private readonly markerCorners: [number, number][];
  private readonly markerHalf: number;
  private readonly markerReach: number;
  private readonly scratch: Pose = { p: [0, 0, 0], q: [0, 0, 0, 1] };
  /** The counter tray, once its art has been handed in: where it stands, and what draws it. */
  private tray: { placed: PlacedTray; view: TrayView } | null = null;
  /** The dice (../dice): drawn after the counters' rows of the caster table, so that they shadow the felt and each other. */
  private readonly dice: DiceView;
  private readonly centreOf: (hex: number) => readonly [number, number];
  private readonly colRowOf: (hex: number) => readonly [number, number];

  constructor(
    pieces: Pieces,
    shared: Record<string, Uniform<unknown>>,
    opts: {
      maxAnisotropy: number;
      slabs: () => readonly Rect[];
      tableZ: () => number;
      centreOf: (hex: number) => readonly [number, number];
      /** A hex's corners, in order (a marker is cut to a hex's shape, a little smaller). */
      cornersOf: (hex: number) => readonly (readonly [number, number])[];
      /** A hex's column and row (the board's tints are kept by them). */
      colRowOf: (hex: number) => readonly [number, number];
    },
  ) {
    this.pieces = pieces;
    this.shared = shared;
    this.maxAnisotropy = opts.maxAnisotropy;
    this.slabs = opts.slabs;
    this.tableZ = opts.tableZ;
    this.centreOf = opts.centreOf;
    this.colRowOf = opts.colRowOf;
    const ink = (c: readonly [number, number, number]): THREE.Vector3 => new THREE.Vector3(c[0], c[1], c[2]);
    // A marker's outline: the first hex's own, from its middle, a little smaller.
    const mid = opts.centreOf(0);
    this.markerCorners = opts.cornersOf(0).map(c => [(c[0] - mid[0]) * CUE.markerSize, (c[1] - mid[1]) * CUE.markerSize] as [number, number]);
    this.markerReach = Math.max(...this.markerCorners.map(c => Math.hypot(c[0], c[1])));
    this.markerHalf = Math.min(
      ...this.markerCorners.map((c, i) => {
        const d = this.markerCorners[i + 1 < this.markerCorners.length ? i + 1 : 0] as [number, number];
        return Math.hypot((c[0] + d[0]) / 2, (c[1] + d[1]) / 2);
      }),
    );
    const key = keyDirection();
    this.own = {
      uCasters: { value: null },
      uCounter: { value: new THREE.Vector4(S / 2, COUNTER.cornerRadius, PIECE_LOOK.penumbra, PIECE_LOOK.contactWidth) },
      uAtlas: { value: null },
      uAtlasGrid: { value: new THREE.Vector4(1, 1, FACE_INSET, PIECE_LOOK.gloss) },
      uCore: { value: linearOf(PIECE_LOOK.core) },
      uBack: { value: linearOf(PIECE_LOOK.back) },
      uCard: { value: new THREE.Vector4(PIECE_LOOK.wallFill, PIECE_LOOK.footDark, 0, 0) },
      uInkSelected: { value: ink(MARK_INKS.selected) },
      uInkHover: { value: ink(MARK_INKS.hover) },
      uInkTarget: { value: ink(MARK_INKS.target) },
      uInkCanAct: { value: ink(MARK_INKS.canAct) },
      uInkSuppressed: { value: ink(MARK_INKS.suppressed) },
      uInkPick: { value: ink(MARK_INKS.pick) },
      uInkRevealed: { value: ink(MARK_INKS.revealed) },
      uInkMoved: { value: ink(MARK_INKS.moved) },
      uMoved: { value: new THREE.Vector4(MOVED_MARK.x, MOVED_MARK.y, MOVED_MARK.half, MOVED_MARK.stroke) },
      // A close attack's red glow: its ink; the band of the edge that glows, its strength, the wash over the face.
      uInkClose: { value: ink(CLOSE.ink) },
      uClose: { value: new THREE.Vector4(CLOSE.rimIn, CLOSE.rim, CLOSE.wash, 0) },
      // The chosen counter's treatment (MARK_LOOK.chosen): the outline's ink; the line on its face, its cut edge's light,
      // whether the outline is drawn, how much brighter its light is at the height of a swell.
      uInkChosen: { value: ink(CHOSEN.ink) },
      uChosen: { value: new THREE.Vector4(CHOSEN.faceLine, CHOSEN.wallLight, 0, CHOSEN.pulseGain) },
      // The chosen counter's outline on the surface: how far off its edge, its half width, the keyline's width and darkness.
      uChosenRing: { value: new THREE.Vector4(CHOSEN.ringOff, CHOSEN.ringHalf, CHOSEN.keyline, CHOSEN.keyDark) },
      // Spent's treatment (MARK_LOOK.spent): how far toward grey and how dark; its cut edge and its sheen; its band darkened.
      uSpent: { value: new THREE.Vector4(SPENT.greyToday, SPENT.darkToday, 1, 1) },
      uSpentB: { value: new THREE.Vector4(0.31, 0, 0, 0) },
      // The group in hand: its light, how its counters' own edges take it, and the pool of it on the surface round each.
      uInkLit: { value: ink(LIT_INK) },
      uLitRim: { value: new THREE.Vector4(LIT.rim, LIT.rimIn, LIT.rimWall, LIT.pulseRim) },
      uLitPool: { value: new THREE.Vector4(LIT.poolReach, LIT.poolFall, LIT.ringOff, LIT.ringWidth) },
      uLitRing: { value: new THREE.Vector4(LIT.ring, LIT.pool, 0, 0) },
      uTab: { value: new THREE.Vector4(TAB.right, TAB.top, TAB.foot, TAB.grow) },
      // In an acting group's tab the band's colour is printed in the band's ink and the ink in the band's colour.
      uTabInks: { value: [STOCKS.first, STOCKS.second].flatMap(st => [st.band, st.bandInk, st.bandInk, st.band].map(c => linearOf(c))) },
      uGround: { value: new THREE.Vector4(0, PIECE_LOOK.groundShadow, 0, 0) },
      uMarkerAtlas: { value: null },
      uMarkerGrid: { value: new THREE.Vector4(1, 1, PIECE_LOOK.markerGloss, 0) },
      uMarker: { value: new THREE.Vector4(CUE.markerShadow, CUE.markerShadowAlpha, (-key[0] / key[2]) * CUE.markerThickness, (-key[1] / key[2]) * CUE.markerThickness) },
      uMarkerB: { value: new THREE.Vector4(0.0012, this.markerHalf, 0, 0) },
      // Where the tray stands (none, until one is handed in): a counter lying in one of its wells is shaded by the walls round it.
      ...trayUniforms(),
    };
    // The ground's shadows: multiplied onto what is there.
    this.ground = new THREE.Mesh(
      quad(),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms(),
        vertexShader: GROUND_VERTEX,
        fragmentShader: GROUND_FRAGMENT,
        side: THREE.DoubleSide,
        toneMapped: false,
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.DstColorFactor,
        blendDst: THREE.ZeroFactor,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -8,
      }),
    );
    this.ground.renderOrder = 6.5;
    this.halo = new THREE.Mesh(
      quad(),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms(),
        vertexShader: HALO_VERTEX,
        fragmentShader: HALO_FRAGMENT,
        side: THREE.DoubleSide,
        toneMapped: false,
        transparent: true,
        depthWrite: false,
        // What a halo writes is added, and what is under it is kept less the share the halo names (its alpha): none
        // for a mark's glow, which is light added as it always was; the wash's own share for a lit counter's pool.
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -12,
      }),
    );
    this.halo.renderOrder = 7;
    // The strokes of the cues: lines of fire, routes, tags and their letters. Flat, drawn in the order they are listed.
    this.strokes = new THREE.Mesh(
      quad(),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms(),
        vertexShader: STROKE_VERTEX,
        fragmentShader: STROKE_FRAGMENT,
        side: THREE.DoubleSide,
        toneMapped: false,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4,
      }),
    );
    this.strokes.renderOrder = 6.2;
    // The markers: card lying on the board, drawn before the counters that stand on it; and the shadow each lays on the sheet.
    const src = markerGeometry(this.markerCorners, CUE.markerThickness, CUE.markerCorner, PIECE_LOOK.markerInset);
    const mg = new THREE.InstancedBufferGeometry();
    mg.setAttribute('position', new THREE.Float32BufferAttribute(src.pos, 3));
    mg.setAttribute('normal', new THREE.Float32BufferAttribute(src.nor, 3));
    mg.setAttribute('uv', new THREE.Float32BufferAttribute(src.uv, 2));
    mg.setAttribute('aPart', new THREE.Float32BufferAttribute(src.part, 3));
    mg.setIndex(src.idx);
    mg.instanceCount = 0;
    this.markers = new THREE.Mesh(mg, new THREE.ShaderMaterial({ uniforms: this.uniforms(), vertexShader: MARKER_VERTEX, fragmentShader: MARKER_FRAGMENT, side: THREE.DoubleSide, toneMapped: false }));
    this.markers.renderOrder = 5.9;
    this.markerShadows = new THREE.Mesh(
      mg,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms(),
        vertexShader: MARKER_SHADOW_VERTEX,
        fragmentShader: MARKER_SHADOW_FRAGMENT,
        side: THREE.DoubleSide,
        toneMapped: false,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -3,
      }),
    );
    this.markerShadows.renderOrder = 6.1;
    for (const m of [this.ground, this.halo, this.strokes, this.markers, this.markerShadows]) {
      m.frustumCulled = false;
      m.visible = false;
      this.group.add(m);
    }
    this.growMarkers(16);
    this.growGround(4096);
    this.growHalo(16);
    this.dice = new DiceView(this.uniforms() as Record<string, Uniform<unknown>>, () => (this.tray ? this.tray.placed.z + this.tray.placed.layout.felt.floor : 0));
    this.group.add(this.dice.mesh);
  }

  private uniforms(): Record<string, THREE.IUniform> {
    return { ...this.shared, ...this.own } as Record<string, THREE.IUniform>;
  }

  private growGround(count: number): void {
    const g = quad();
    this.cell = instanced(g, 'aCell', 4, count);
    this.lists = ['aListA', 'aListB', 'aListC', 'aListD'].map(name => instanced(g, name, 4, count));
    g.instanceCount = 0;
    this.ground.geometry.dispose();
    this.ground.geometry = g;
    this.groundCap = count;
  }

  private growHalo(count: number): void {
    const g = quad();
    this.haloAt = instanced(g, 'aHalo', 4, count);
    this.haloTint = instanced(g, 'aTint', 4, count);
    g.instanceCount = 0;
    this.halo.geometry.dispose();
    this.halo.geometry = g;
    this.haloCap = count;
  }

  private growMarkers(count: number): void {
    const g = this.markers.geometry as THREE.InstancedBufferGeometry;
    // Buffers of another length: what the GPU holds of the old ones is let go first, and the geometry is handed over again.
    g.dispose();
    this.markerPlace = instanced(g, 'aPlace', 4, count);
    this.markerTurn = instanced(g, 'aTurn', 4, count);
    this.markerHex = instanced(g, 'aHex', 4, count);
    this.markerOccA = instanced(g, 'aOccA', 4, count);
    this.markerOccB = instanced(g, 'aOccB', 4, count);
    this.markerCap = count;
  }

  /** A new set-up: its faces are drawn, and the counters' mesh made for their number. */
  private rebuild(): void {
    const list = this.pieces.list;
    this.atlas?.texture.dispose();
    this.atlas = makeFaceAtlas(list.map(p => p.face), this.maxAnisotropy, this.art ?? undefined, list.map(p => p.notes.group));
    (this.own.uAtlas as Uniform<THREE.Texture>).value = this.atlas.texture;
    (this.own.uAtlasGrid as Uniform<THREE.Vector4>).value.set(this.atlas.cols, this.atlas.rows, FACE_INSET, PIECE_LOOK.gloss);
    // A row of the caster table for each counter, and after them one for each die.
    const need = Math.max(64, list.length + DICE_DRAWN);
    if (need > this.capacity || !this.counters) {
      const cap = Math.max(need, this.capacity * 2);
      const src = counterGeometry();
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(src.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(src.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(src.uv, 2));
      g.setAttribute('aPart', new THREE.Float32BufferAttribute(src.part, 3));
      g.setIndex(src.idx);
      this.place = instanced(g, 'aPlace', 4, cap);
      this.turn = instanced(g, 'aTurn', 4, cap);
      this.info = instanced(g, 'aInfo', 4, cap);
      this.marks = instanced(g, 'aMarks', 4, cap);
      this.marksB = instanced(g, 'aMarksB', 4, cap);
      this.marksC = instanced(g, 'aMarksC', 4, cap);
      this.notes = instanced(g, 'aNotes', 4, cap);
      this.occA = instanced(g, 'aOccA', 4, cap);
      this.occB = instanced(g, 'aOccB', 4, cap);
      this.casterData = new Float32Array(cap * 8);
      this.casterTexture?.dispose();
      const t = new THREE.DataTexture(this.casterData, 2, cap, THREE.RGBAFormat, THREE.FloatType);
      t.minFilter = THREE.NearestFilter;
      t.magFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.needsUpdate = true;
      this.casterTexture = t;
      (this.own.uCasters as Uniform<THREE.Texture>).value = t;
      if (this.counters) {
        this.group.remove(this.counters);
        this.counters.geometry.dispose();
        (this.counters.material as THREE.Material).dispose();
      }
      const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: this.uniforms(), vertexShader: COUNTER_VERTEX, fragmentShader: COUNTER_FRAGMENT, side: COUNTER_SIDE, toneMapped: false }));
      mesh.frustumCulled = false;
      mesh.renderOrder = 6;
      this.group.add(mesh);
      this.counters = mesh;
      this.capacity = cap;
    }
    const cells = this.atlas.cellOf;
    list.forEach((p, i) => {
      const cell = cells.get(faceKey(p.face, p.notes.group)) ?? 0;
      this.info[i * 4] = cell % this.atlas!.cols;
      this.info[i * 4 + 1] = Math.floor(cell / this.atlas!.cols);
      // A number of its own, for the grain of its edge: its row will do.
      this.info[i * 4 + 2] = ((i * 0.6180339887) % 1) + 0.01;
      // Where its group's tab begins on the face (none: 0), and which stock it is printed on.
      this.info[i * 4 + 3] = tabLeft(p.notes.group);
      this.notes[i * 4 + 3] = (p.face.stock === 'second' ? -1 : 1) * (1 + p.shown.moved);
    });
    const g = (this.counters as THREE.Mesh).geometry as THREE.InstancedBufferGeometry;
    g.instanceCount = list.length;
    (g.getAttribute('aInfo') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (this.counters as THREE.Mesh).visible = list.length > 0;
    this.countTextures();
    this.version = this.pieces.version;
    this.faceVersion = this.pieces.faceVersion;
    // A side's stock may have changed with the set-up: the markers are printed again.
    this.markerVersion = -1;
    this.stamp = -1;
  }

  private countTextures(): void {
    this.textures = {
      count: 2 + (this.markerAtlas ? 1 : 0) + (this.tray ? 1 : 0),
      bytes: (this.atlas ? this.atlas.bytes : 0) + this.capacity * 2 * 16 + (this.markerAtlas ? this.markerAtlas.bytes : 0) + (this.tray ? this.tray.view.bytes : 0),
    };
  }

  /**
   * The counter tray is put on the table: its mesh and its shadow are drawn from now on (two draws),
   * the counters are told where its wells are, and those lying in it shadow it.
   */
  setTray(placed: PlacedTray, art: TrayArt): void {
    if (this.tray) return;
    placeTrayUniforms(this.own, placed);
    const view = new TrayView(placed, art, this.uniforms() as Record<string, Uniform<unknown>>, this.maxAnisotropy);
    this.group.add(view.group);
    this.tray = { placed, view };
    this.countTextures();
    this.stamp = -1;
  }

  /** How many triangles the tray is drawn with (0 with no tray). */
  get trayTriangles(): number {
    return this.tray ? this.tray.view.triangles : 0;
  }

  /** Silhouettes by unit type, handed in when their pictures have arrived: the faces are drawn again before the next frame. */
  setArt(art: ReadonlyMap<string, Silhouette>): void {
    this.art = art;
    this.version = -1;
  }

  /** Bring what is drawn up to date with the pieces. Called before every frame; does nothing when nothing moved. */
  sync(): void {
    const P = this.pieces;
    if (P.version !== this.version || P.faceVersion !== this.faceVersion) this.rebuild();
    const moved = P.stamp !== this.stamp;
    if (moved) this.syncCounters();
    this.syncCues(moved);
  }

  /** The uniforms of the chosen counter's and Spent's treatments, as MARK_LOOK has them now. */
  private syncLook(): void {
    const chosen = MARK_LOOK.chosen;
    (this.own.uChosen as Uniform<THREE.Vector4>).value.z = chosen === 'outline' || chosen === 'all' ? 1 : 0;
    const spent = MARK_LOOK.spent;
    const today = spent === 'today';
    (this.own.uSpent as Uniform<THREE.Vector4>).value.set(today ? SPENT.greyToday : SPENT.grey, today ? SPENT.darkToday : SPENT.dark, today ? 1 : SPENT.wall, today ? 1 : SPENT.sheen);
    (this.own.uSpentB as Uniform<THREE.Vector4>).value.y = spent === 'mark' ? 1 : 0;
  }

  private syncCounters(): void {
    const P = this.pieces;
    this.stamp = P.stamp;
    this.syncLook();
    const list = P.list;
    const pose = this.scratch;
    const casters = this.casters;
    casters.length = list.length;
    let halos = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i] as Piece;
      P.drawn(p, pose);
      const k = i * 4;
      const scale = p.state === 'gone' ? 0 : p.scale;
      this.place[k] = pose.p[0];
      this.place[k + 1] = pose.p[1];
      this.place[k + 2] = pose.p[2];
      this.place[k + 3] = scale;
      this.turn[k] = pose.q[0];
      this.turn[k + 1] = pose.q[1];
      this.turn[k + 2] = pose.q[2];
      this.turn[k + 3] = pose.q[3];
      const s = p.shown;
      this.marks[k] = s.selected;
      this.marks[k + 1] = s.hover;
      this.marks[k + 2] = s.target;
      this.marks[k + 3] = s.canAct;
      this.marksB[k] = s.spent;
      this.marksB[k + 1] = s.suppressed;
      this.marksB[k + 2] = s.lit;
      this.marksB[k + 3] = p.pulse !== null ? pulseOf(p.pulse) : 0;
      // A close attack's glow, stronger at the height of its one swell; the chosen counter's swells (in the treatment that has them).
      this.marksC[k] = s.close * (1 + CLOSE.pulseGain * (p.closePulse !== null ? closePulseOf(p.closePulse) : 0));
      this.marksC[k + 1] = MARK_LOOK.chosen === 'all' && p.chosenPulse !== null ? chosenPulseOf(p.chosenPulse) * s.selected : 0;
      this.marksC[k + 2] = 0;
      this.marksC[k + 3] = 0;
      this.notes[k] = s.active;
      this.notes[k + 1] = s.revealed;
      this.notes[k + 2] = s.pick;
      // Its stock by the sign, and how far its Moved chevron has come in (0 to 1) past the one.
      this.notes[k + 3] = (p.face.stock === 'second' ? -1 : 1) * (1 + s.moved);
      // The caster it is: its reach on the plan, turned as it lies, between its lowest and highest points.
      const ex = rotate(pose.q, [1, 0, 0]);
      const ey = rotate(pose.q, [0, 1, 0]);
      const ez = rotate(pose.q, [0, 0, 1]);
      let c = ex[0];
      let sn = ex[1];
      const flat = Math.hypot(c, sn);
      if (flat > 1e-4) {
        c /= flat;
        sn /= flat;
      } else {
        c = 1;
        sn = 0;
      }
      const hs = (S / 2) * scale;
      const ht = (T / 2) * scale;
      const hx = hs * (Math.abs(ex[0] * c + ex[1] * sn) + Math.abs(ey[0] * c + ey[1] * sn)) + ht * Math.abs(ez[0] * c + ez[1] * sn);
      const hy = hs * (Math.abs(-ex[0] * sn + ex[1] * c) + Math.abs(-ey[0] * sn + ey[1] * c)) + ht * Math.abs(-ez[0] * sn + ez[1] * c);
      const hz = hs * (Math.abs(ex[2]) + Math.abs(ey[2])) + ht * Math.abs(ez[2]);
      const on = scale > 0.3;
      const cst: Caster = casters[i] ?? { x: 0, y: 0, z0: 0, z1: 0, c: 1, s: 0, hx: 0, hy: 0, ex: 0, ey: 0, on: false };
      cst.x = pose.p[0];
      cst.y = pose.p[1];
      cst.z0 = pose.p[2] - hz;
      cst.z1 = on ? pose.p[2] + hz : -1e4;
      cst.c = c;
      cst.s = sn;
      cst.hx = hx;
      cst.hy = hy;
      cst.ex = Math.abs(c) * hx + Math.abs(sn) * hy;
      cst.ey = Math.abs(sn) * hx + Math.abs(c) * hy;
      cst.on = on;
      casters[i] = cst;
      const d = i * 8;
      this.casterData[d] = cst.x;
      this.casterData[d + 1] = cst.y;
      this.casterData[d + 2] = cst.z0;
      this.casterData[d + 3] = cst.z1;
      this.casterData[d + 4] = c;
      this.casterData[d + 5] = sn;
      this.casterData[d + 6] = hx;
      this.casterData[d + 7] = hy;
      if (on && (s.selected > 0.01 || s.hover > 0.01 || s.target > 0.01)) halos++;
      if (on && s.lit > 0.01) halos++;
      if (on && s.close > 0.01) halos++;
      if (on && s.selected > 0.01) halos++;
    }
    this.syncDice(list.length);
    this.syncOccluders();
    this.syncTray();
    this.syncGround();
    this.syncHalos(halos);
    const mesh = this.counters;
    if (mesh) {
      const g = mesh.geometry;
      for (const name of ['aPlace', 'aTurn', 'aMarks', 'aMarksB', 'aMarksC', 'aNotes', 'aOccA', 'aOccB']) (g.getAttribute(name) as THREE.InstancedBufferAttribute).needsUpdate = true;
    }
    if (this.casterTexture) this.casterTexture.needsUpdate = true;
  }

  /**
   * The dice: each a row of the caster table after the counters' (its reach on the plan, turned by
   * whichever of its edges lies flattest, between its lowest and highest points), so that they shadow
   * the felt and one another; and drawn.
   */
  private syncDice(first: number): void {
    const shown: readonly DieShown[] = this.pieces.rolls.shown().slice(0, Math.max(0, Math.min(DICE_DRAWN, this.capacity - first)));
    const casters = this.casters;
    for (let j = 0; j < shown.length; j++) {
      const d = shown[j] as DieShown;
      const q = d.pose.q;
      const axes = [rotate(q, [1, 0, 0]), rotate(q, [0, 1, 0]), rotate(q, [0, 0, 1])];
      const level = axes.reduce((a, b) => (Math.hypot(b[0], b[1]) > Math.hypot(a[0], a[1]) ? b : a));
      const flat = Math.hypot(level[0], level[1]) || 1;
      const c = level[0] / flat;
      const sn = level[1] / flat;
      const half = (DIE.side / 2) * d.scale;
      const hx = half * axes.reduce((a, e) => a + Math.abs(e[0] * c + e[1] * sn), 0);
      const hy = half * axes.reduce((a, e) => a + Math.abs(-e[0] * sn + e[1] * c), 0);
      const hz = half * axes.reduce((a, e) => a + Math.abs(e[2]), 0);
      const on = d.scale > 0.3;
      const i = first + j;
      const cst: Caster = casters[i] ?? { x: 0, y: 0, z0: 0, z1: 0, c: 1, s: 0, hx: 0, hy: 0, ex: 0, ey: 0, on: false };
      cst.x = d.pose.p[0];
      cst.y = d.pose.p[1];
      cst.z0 = d.pose.p[2] - hz;
      cst.z1 = on ? d.pose.p[2] + hz : -1e4;
      cst.c = c;
      cst.s = sn;
      cst.hx = hx;
      cst.hy = hy;
      cst.ex = Math.abs(c) * hx + Math.abs(sn) * hy;
      cst.ey = Math.abs(sn) * hx + Math.abs(c) * hy;
      cst.on = on;
      casters[i] = cst;
      const k = i * 8;
      this.casterData[k] = cst.x;
      this.casterData[k + 1] = cst.y;
      this.casterData[k + 2] = cst.z0;
      this.casterData[k + 3] = cst.z1;
      this.casterData[k + 4] = c;
      this.casterData[k + 5] = sn;
      this.casterData[k + 6] = hx;
      this.casterData[k + 7] = hy;
    }
    casters.length = first + shown.length;
    // Each die is shadowed by the nearest two of the others.
    this.dice.sync(shown, j => {
      const me = casters[first + j] as Caster;
      return shown
        .map((_, k) => k)
        .filter(k => k !== j && (casters[first + k] as Caster).on)
        .sort((a, b) => Math.hypot((casters[first + a] as Caster).x - me.x, (casters[first + a] as Caster).y - me.y) - Math.hypot((casters[first + b] as Caster).x - me.x, (casters[first + b] as Caster).y - me.y))
        .slice(0, 2)
        .map(k => first + k);
    });
  }

  /** For each counter, the few others that may shadow it: those that reach above its foot, nearest first. */
  private syncOccluders(): void {
    const casters = this.casters;
    const key = keyDirection();
    const slope = Math.hypot(key[0], key[1]) / key[2];
    const near: { i: number; d: number }[] = [];
    for (let i = 0; i < casters.length; i++) {
      const a = casters[i] as Caster;
      near.length = 0;
      if (a.on) {
        for (let j = 0; j < casters.length; j++) {
          if (j === i) continue;
          const b = casters[j] as Caster;
          if (!b.on || b.z1 <= a.z0 + 0.004) continue;
          const reach = S * 1.42 + (b.z1 - a.z0) * slope * 1.3 + AO_REACH;
          const d = Math.hypot(b.x - a.x, b.y - a.y);
          if (d < reach) near.push({ i: j, d });
        }
        near.sort((p, q) => p.d - q.d || p.i - q.i);
      }
      for (let k = 0; k < COUNTER_CASTERS; k++) {
        const v = k < near.length ? (near[k] as { i: number }).i : -1;
        if (k < 4) this.occA[i * 4 + k] = v;
        else this.occB[i * 4 + k - 4] = v;
      }
    }
  }

  /**
   * The counters lying in the tray, opening by opening: the tray's shader lays their shadows on its
   * floors and walls. An opening lists four: the highest, when more lie in it.
   */
  private syncTray(): void {
    const tray = this.tray;
    if (!tray) return;
    const casters = this.casters;
    const lists: number[][] = tray.view.casters.map(() => []);
    for (let i = 0; i < casters.length; i++) {
      const c = casters[i] as Caster;
      if (!c.on || !overTray(tray.placed, c.x, c.y, 0.3)) continue;
      const k = openingAt(tray.placed, c.x, c.y, 0.07);
      if (k >= 0 && k < lists.length) (lists[k] as number[]).push(i);
    }
    tray.view.casters.forEach((v, k) => {
      const l = (lists[k] as number[]).sort((a, b) => (casters[b] as Caster).z1 - (casters[a] as Caster).z1 || a - b);
      v.set(l[0] ?? -1, l[1] ?? -1, l[2] ?? -1, l[3] ?? -1);
    });
  }

  /** The cells of the plan a shadow can reach, on the boards' plane and on the table's, each with its casters. */
  private syncGround(): void {
    const casters = this.casters;
    const key = keyDirection();
    const lx = -key[0] / key[2];
    const ly = -key[1] / key[2];
    const size = PIECE_LOOK.cell;
    const tableZ = this.tableZ();
    (this.own.uGround as Uniform<THREE.Vector4>).value.x = tableZ;
    const slabs = this.slabs();
    // One table of cells for the boards' plane and one for the table's.
    const planes: Map<number, number[]>[] = [new Map<number, number[]>(), new Map<number, number[]>()];
    for (let i = 0; i < casters.length; i++) {
      const c = casters[i] as Caster;
      if (!c.on) continue;
      // A counter lying in the tray shadows the tray (its shader's work), not the table under it; and so do the dice (the rows after the counters').
      const inTray = this.tray !== null && (c.z1 < this.tray.placed.rimZ + T || i >= this.pieces.list.length) && overTray(this.tray.placed, c.x, c.y);
      for (let plane = 0; plane < 2; plane++) {
        if (inTray && plane === 1) continue;
        const zr = plane === 0 ? 0 : tableZ;
        const top = c.z1 - zr;
        if (top <= 0.004) continue;
        const foot = Math.max(c.z0 - zr, 0);
        const pad = Math.max(AO_REACH, top * PIECE_LOOK.penumbra * 1.2) + 0.02;
        const x0 = c.x - c.ex + Math.min(lx * foot, lx * top) - pad;
        const x1 = c.x + c.ex + Math.max(lx * foot, lx * top) + pad;
        const y0 = c.y - c.ey + Math.min(ly * foot, ly * top) - pad;
        const y1 = c.y + c.ey + Math.max(ly * foot, ly * top) + pad;
        for (let iy = Math.floor(y0 / size); iy <= Math.floor(y1 / size); iy++) {
          for (let ix = Math.floor(x0 / size); ix <= Math.floor(x1 / size); ix++) {
            const k = (ix + 2048) * 4096 + (iy + 2048);
            const cells = planes[plane] as Map<number, number[]>;
            const l = cells.get(k);
            if (l) l.push(i);
            else cells.set(k, [i]);
          }
        }
      }
    }
    let count = 0;
    const within = (r: Rect, x0: number, y0: number, x1: number, y1: number, shrink: number): boolean => x0 >= r[0] + shrink && y0 >= r[1] + shrink && x1 <= r[2] - shrink && y1 <= r[3] - shrink;
    const meets = (r: Rect, x0: number, y0: number, x1: number, y1: number): boolean => x1 > r[0] && x0 < r[2] && y1 > r[1] && y0 < r[3];
    for (let plane = 0; plane < 2; plane++) for (const [k, l] of planes[plane] as Map<number, number[]>) {
      const iy = (k % 4096) - 2048;
      const ix = Math.floor(k / 4096) - 2048;
      const x0 = ix * size;
      const y0 = iy * size;
      // On the boards' plane only where a board is; on the table's only where the table shows.
      if (plane === 0 && !slabs.some(r => meets(r, x0, y0, x0 + size, y0 + size))) continue;
      if (plane === 1 && slabs.some(r => within(r, x0, y0, x0 + size, y0 + size, 0.3))) continue;
      if (count >= this.groundCap) {
        this.growGround(this.groundCap * 2);
        this.syncGround();
        return;
      }
      if (l.length > CELL_CASTERS) {
        const cx = x0 + size / 2;
        const cy = y0 + size / 2;
        const far = (i: number): number => Math.hypot((casters[i] as Caster).x - cx, (casters[i] as Caster).y - cy);
        l.sort((a, b) => far(a) - far(b) || a - b);
        l.length = CELL_CASTERS;
      }
      const at = count * 4;
      this.cell[at] = x0;
      this.cell[at + 1] = y0;
      this.cell[at + 2] = size;
      this.cell[at + 3] = (plane === 0 ? 0 : tableZ) + 0.0008;
      for (let j = 0; j < CELL_CASTERS; j++) ((this.lists[j >> 2] as Float32Array)[at + (j % 4)] = j < l.length ? (l[j] as number) : -1);
      count++;
    }
    const g = this.ground.geometry as THREE.InstancedBufferGeometry;
    g.instanceCount = count;
    this.ground.visible = count > 0;
    for (const name of ['aCell', 'aListA', 'aListB', 'aListC', 'aListD']) (g.getAttribute(name) as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  /**
   * Light on the surface round the counters: a tight glow round each that is selected, hovered or a target; and a
   * soft ring in a wider pool round each that is lit as one of the group in hand (one to a stack, however many of it are lit).
   */
  private syncHalos(wanted: number): void {
    if (wanted > this.haloCap) this.growHalo(Math.max(wanted, this.haloCap * 2));
    const list = this.pieces.list;
    const tableZ = this.tableZ();
    const slabs = this.slabs();
    // The height of the surface under a counter: the board (a marker's card where one lies under it) or the table.
    const surface = (c: Caster): number => {
      const onBoard = slabs.some(r => c.x > r[0] && c.x < r[2] && c.y > r[1] && c.y < r[3]);
      return (onBoard ? (this.pieces.cues.any ? this.pieces.cues.markerTop(this.pieces.hexAt(c.x, c.y)) : 0) : tableZ) + 0.0014;
    };
    let n = 0;
    for (let i = 0; i < list.length && n < this.haloCap; i++) {
      const p = list[i] as Piece;
      const s = p.shown;
      const c = this.casters[i] as Caster;
      if (!c.on || !(s.selected > 0.01 || s.hover > 0.01 || s.target > 0.01)) continue;
      const k = n * 4;
      this.haloAt[k] = c.x;
      this.haloAt[k + 1] = c.y;
      this.haloAt[k + 2] = surface(c);
      this.haloAt[k + 3] = Math.atan2(c.s, c.c);
      const a = MARK_INKS.selected;
      const b = MARK_INKS.hover;
      const t = MARK_INKS.target;
      const w = [s.selected * 0.5, s.hover * 0.14, s.target * 0.42];
      this.haloTint[k] = a[0] * (w[0] as number) + b[0] * (w[1] as number) + t[0] * (w[2] as number);
      this.haloTint[k + 1] = a[1] * (w[0] as number) + b[1] * (w[1] as number) + t[1] * (w[2] as number);
      this.haloTint[k + 2] = a[2] * (w[0] as number) + b[2] * (w[1] as number) + t[2] * (w[2] as number);
      this.haloTint[k + 3] = 0;
      n++;
    }
    // The chosen counter's outline (in the treatments that have one): a bright line just off its edge with a dark keyline
    // outside it, on the surface under it; brighter at the height of a swell. And the wide red glow round a counter a click
    // would attack at close quarters. (Each kind is told by its fourth figure: -1 the outline, below -2 a wide glow of that reach.)
    const outline = MARK_LOOK.chosen === 'outline' || MARK_LOOK.chosen === 'all';
    for (let i = 0; i < list.length && n < this.haloCap; i++) {
      const p = list[i] as Piece;
      const s = p.shown;
      const c = this.casters[i] as Caster;
      if (!c.on) continue;
      if (outline && s.selected > 0.01 && n < this.haloCap) {
        const k = n * 4;
        this.haloAt[k] = c.x;
        this.haloAt[k + 1] = c.y;
        this.haloAt[k + 2] = surface(c);
        this.haloAt[k + 3] = Math.atan2(c.s, c.c);
        const swell = 1 + CHOSEN.pulseGain * (MARK_LOOK.chosen === 'all' && p.chosenPulse !== null ? chosenPulseOf(p.chosenPulse) : 0);
        this.haloTint[k] = CHOSEN.ink[0] * s.selected * swell;
        this.haloTint[k + 1] = CHOSEN.ink[1] * s.selected * swell;
        this.haloTint[k + 2] = CHOSEN.ink[2] * s.selected * swell;
        this.haloTint[k + 3] = -1;
        n++;
      }
      if (s.close > 0.01 && n < this.haloCap) {
        const k = n * 4;
        this.haloAt[k] = c.x;
        this.haloAt[k + 1] = c.y;
        this.haloAt[k + 2] = surface(c);
        this.haloAt[k + 3] = Math.atan2(c.s, c.c);
        const glow = s.close * CLOSE.halo * (1 + CLOSE.pulseGain * (p.closePulse !== null ? closePulseOf(p.closePulse) : 0));
        this.haloTint[k] = CLOSE.ink[0] * glow;
        this.haloTint[k + 1] = CLOSE.ink[1] * glow;
        this.haloTint[k + 2] = CLOSE.ink[2] * glow;
        this.haloTint[k + 3] = -2 - CLOSE.reach;
        n++;
      }
    }
    // The light round the counters of the group in hand (a ring in a pool). Where several lit counters lie one on
    // another, the stack has one: the strongest of theirs (laid twice, it would stand out from the single counters beside it).
    const pooled: { x: number; y: number; k: number; strength: number }[] = [];
    for (let i = 0; i < list.length && n < this.haloCap; i++) {
      const p = list[i] as Piece;
      const c = this.casters[i] as Caster;
      if (!c.on || !(p.shown.lit > 0.01)) continue;
      const pulse = p.pulse !== null ? pulseOf(p.pulse) : 0;
      const strength = p.shown.lit * (1 + LIT.pulsePool * pulse);
      const spread = 1 + LIT.pulseSpread * pulse;
      const same = pooled.find(q => Math.hypot(q.x - c.x, q.y - c.y) < S * 0.3);
      if (same && same.strength >= strength) continue;
      const k = same ? same.k : n * 4;
      this.haloAt[k] = c.x;
      this.haloAt[k + 1] = c.y;
      this.haloAt[k + 2] = surface(c);
      this.haloAt[k + 3] = Math.atan2(c.s, c.c);
      this.haloTint[k] = strength;
      this.haloTint[k + 1] = 0;
      this.haloTint[k + 2] = 0;
      this.haloTint[k + 3] = spread;
      if (same) same.strength = strength;
      else {
        pooled.push({ x: c.x, y: c.y, k, strength });
        n++;
      }
    }
    const g = this.halo.geometry as THREE.InstancedBufferGeometry;
    g.instanceCount = n;
    this.halo.visible = n > 0;
    (g.getAttribute('aHalo') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (g.getAttribute('aTint') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  /**
   * The cues: strokes and markers. Worked out again when the cues changed, when a counter moved (a
   * tag lies on what is under it; a marker takes the shadows of the counters by it), or when the
   * camera turned (a tag's letters run across the screen).
   */
  private syncCues(moved: boolean): void {
    const P = this.pieces;
    const C = P.cues;
    if (!C.any) {
      if (this.cuesDrawn) {
        this.strokes.visible = false;
        this.markers.visible = false;
        this.markerShadows.visible = false;
        this.cuesDrawn = false;
      }
      this.cueStamp = C.stamp;
      return;
    }
    const right = C.threats.length > 0 || C.chances.length > 0 ? P.screenRight() : this.right;
    const turned = Math.abs(right[0] - this.right[0]) + Math.abs(right[1] - this.right[1]) > 1e-5;
    if (C.stamp === this.cueStamp && !moved && !turned && this.cuesDrawn) return;
    this.cueStamp = C.stamp;
    this.right = right;
    this.cuesDrawn = true;
    const key = keyDirection();
    const flat = Math.hypot(key[0], key[1]) || 1;
    const list = strokesOf(
      C,
      {
        centreOf: this.centreOf,
        right,
        shadow: [-key[0] / flat, -key[1] / flat],
        topUnder: (x, y, along, across) => P.topUnder(x, y, right, along, across),
      },
      this.strokeList,
    );
    const g = this.strokes.geometry as THREE.InstancedBufferGeometry;
    const have = g.getAttribute('aSeg') as THREE.InstancedBufferAttribute | undefined;
    if (!have || have.array !== list.seg) {
      // The list grew: its buffers are new ones.
      const fresh = quad();
      const names: [string, Float32Array][] = [['aSeg', list.seg], ['aShape', list.shape], ['aInk', list.ink], ['aStyle', list.style], ['aJoin', list.join]];
      for (const [name, data] of names) {
        const a = new THREE.InstancedBufferAttribute(data, 4);
        a.setUsage(THREE.DynamicDrawUsage);
        fresh.setAttribute(name, a);
      }
      g.dispose();
      this.strokes.geometry = fresh;
    }
    const sg = this.strokes.geometry as THREE.InstancedBufferGeometry;
    sg.instanceCount = list.count;
    this.strokes.visible = list.count > 0;
    for (const name of ['aSeg', 'aShape', 'aInk', 'aStyle', 'aJoin']) (sg.getAttribute(name) as THREE.InstancedBufferAttribute).needsUpdate = true;
    this.syncMarkers();
  }

  private syncMarkers(): void {
    const P = this.pieces;
    const C = P.cues;
    const poses = C.markerPoses();
    const printOf = (m: { kind: 'screen' | 'incoming'; label: string; side: string | null }): MarkerPrint => ({ kind: m.kind, label: m.label, stock: m.kind === 'incoming' ? P.stockOf(m.side) : null });
    if (C.markerVersion !== this.markerVersion) {
      // The prints: drawn again when the set of markers changes (a few times a game).
      this.markerVersion = C.markerVersion;
      // The marker's outline in a cell of the atlas, as its geometry reads the print.
      const k = (1 - 2 * PIECE_LOOK.markerInset) / (2 * this.markerReach);
      const outline = this.markerCorners.map(c => [0.5 + c[0] * k, 0.5 + c[1] * k] as [number, number]);
      this.markerAtlas?.texture.dispose();
      this.markerAtlas = poses.length > 0 ? makeMarkerAtlas(poses.map(p => printOf(p.marker)), outline, this.maxAnisotropy) : null;
      (this.own.uMarkerAtlas as Uniform<THREE.Texture | null>).value = this.markerAtlas ? this.markerAtlas.texture : null;
      if (this.markerAtlas) (this.own.uMarkerGrid as Uniform<THREE.Vector4>).value.set(this.markerAtlas.cols, this.markerAtlas.rows, PIECE_LOOK.markerGloss, 0);
      this.countTextures();
    }
    if (poses.length > this.markerCap) this.growMarkers(Math.max(poses.length, this.markerCap * 2));
    const atlas = this.markerAtlas;
    const casters = this.casters;
    const key = keyDirection();
    const slope = Math.hypot(key[0], key[1]) / key[2];
    const near: { i: number; d: number }[] = [];
    let n = 0;
    for (const p of poses) {
      if (!atlas || p.scale <= 0.001) continue;
      const k = n * 4;
      const cell = atlas.cellOf.get(printKey(printOf(p.marker))) ?? 0;
      const at = this.colRowOf(p.marker.hex);
      this.markerPlace[k] = p.x;
      this.markerPlace[k + 1] = p.y;
      this.markerPlace[k + 2] = p.z;
      this.markerPlace[k + 3] = p.scale;
      this.markerTurn[k] = Math.cos(p.yaw);
      this.markerTurn[k + 1] = Math.sin(p.yaw);
      this.markerTurn[k + 2] = cell - atlas.cols * Math.floor(cell / atlas.cols);
      this.markerTurn[k + 3] = Math.floor(cell / atlas.cols);
      this.markerHex[k] = at[0];
      this.markerHex[k + 1] = at[1];
      this.markerHex[k + 2] = ((n * 0.6180339887) % 1) + 0.01;
      this.markerHex[k + 3] = 0;
      // The counters whose shadows may reach its face: those standing on it and by it, nearest first.
      near.length = 0;
      const top = p.z + (CUE.markerThickness / 2) * p.scale;
      for (let j = 0; j < casters.length; j++) {
        const c = casters[j] as Caster;
        if (!c.on || c.z1 <= top + 0.004) continue;
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        if (d < this.markerReach + S * 0.71 + (c.z1 - top) * slope * 1.3 + AO_REACH) near.push({ i: j, d });
      }
      near.sort((a, b) => a.d - b.d || a.i - b.i);
      for (let j = 0; j < COUNTER_CASTERS; j++) {
        const v = j < near.length ? (near[j] as { i: number }).i : -1;
        if (j < 4) this.markerOccA[k + j] = v;
        else this.markerOccB[k + j - 4] = v;
      }
      n++;
    }
    const g = this.markers.geometry as THREE.InstancedBufferGeometry;
    g.instanceCount = n;
    this.markers.visible = n > 0;
    this.markerShadows.visible = n > 0;
    for (const name of ['aPlace', 'aTurn', 'aHex', 'aOccA', 'aOccB']) (g.getAttribute(name) as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  /** After a lost context the textures made here are uploaded again. */
  restore(): void {
    if (this.atlas) this.atlas.texture.needsUpdate = true;
    if (this.markerAtlas) this.markerAtlas.texture.needsUpdate = true;
    if (this.casterTexture) this.casterTexture.needsUpdate = true;
    this.tray?.view.restore();
  }
}

/** The stocks' paper colours, for anything that wants to match a counter's edge. */
export const STOCK_PAPER = { first: STOCKS.first.paper, second: STOCKS.second.paper };
/** A selected counter rides this high (for captions and checks). */
export const SELECT_LIFT = FEEL.selectLift;
