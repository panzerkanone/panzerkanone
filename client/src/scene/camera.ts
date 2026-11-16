/**
 * The camera: where it stands for a view, the matrix it draws with, and the
 * limits that keep the frame on the board and the table. Plain arithmetic, no
 * browser and no three.
 *
 * Everything is in the board frame (x right, y down the board, z up from the
 * printed surface, all in h). A matrix is 16 numbers, column-major, and takes a
 * board-frame point to clip space; `viewProjection` is the one the page
 * publishes as `__table.camera.viewProj` and draws with.
 *
 * The player's camera looks at a point of the board (the view's centre) from
 * the near side, tilted `tiltDeg` from straight down, with no roll: screen right
 * is board +x. A view is a centre and a width: `hexesAcross` is the length, in
 * column steps, of the part of the plane z = 0 that the frame's horizontal
 * centre line shows.
 */
import type { Rect } from './layout';

export type Mat4 = number[];
export type Vec3 = [number, number, number];
export type Point = [number, number];

/** Vertical field of view of every camera here. Narrow: the board reads as a plan, not a landscape. */
export const FOV_Y_DEG = 24;
/** Tilt from straight down in the tilted tiers. */
export const TILT_DEG = 12;
/** The default view is this many hexes across at most (ruling 9; columns, ruling 23). */
export const DEFAULT_HEXES = 18;
/** The closest zoom never shows fewer hexes across than this (PLAN 6.3). */
export const MIN_HEXES = 4;
/** Nor more device pixels per h than this, anywhere in the frame (M3a ruling 9). */
export const MAX_DENSITY = 640;
/** The closest zoom is set a hair inside MAX_DENSITY, so that rounding never carries it over. */
const DENSITY_TARGET = 636;
/** In play the frame never holds more than this share of the board along one of its two axes. */
const PLAY_SHARE = 0.92;
/** The view's centre stays this share of the view's own width and depth inside the board rectangle. */
const CENTRE_INSET = 0.1;

const RAD = Math.PI / 180;

// ---------------------------------------------------------------------------
// Matrices
// ---------------------------------------------------------------------------

export function multiply(a: readonly number[], b: readonly number[]): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += (a[k * 4 + r] as number) * (b[c * 4 + k] as number);
      out[c * 4 + r] = s;
    }
  }
  return out;
}

/** Inverse of a 4 x 4 matrix; throws when it has none. */
export function invert(m: readonly number[]): Mat4 {
  const a = m as number[];
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = a as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!(Math.abs(det) > 0)) throw new Error('the matrix has no inverse');
  const d = 1 / det;
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * d,
    (a02 * b10 - a01 * b11 - a03 * b09) * d,
    (a31 * b05 - a32 * b04 + a33 * b03) * d,
    (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d,
    (a00 * b11 - a02 * b08 + a03 * b07) * d,
    (a32 * b02 - a30 * b05 - a33 * b01) * d,
    (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d,
    (a01 * b08 - a00 * b10 - a03 * b06) * d,
    (a30 * b04 - a31 * b02 + a33 * b00) * d,
    (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d,
    (a00 * b09 - a01 * b07 + a02 * b06) * d,
    (a31 * b01 - a30 * b03 - a32 * b00) * d,
    (a20 * b03 - a21 * b01 + a22 * b00) * d,
  ];
}

/** The usual perspective matrix: eye space (x right, y up, looking down -z) to clip space. */
export function perspective(fovYDeg: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan((fovYDeg * RAD) / 2);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
}

// ---------------------------------------------------------------------------
// Where the camera stands
// ---------------------------------------------------------------------------

/** A camera: where it is, what it looks at, and its three axes, all in the board frame. */
export interface Pose {
  position: Vec3;
  target: Vec3;
  /** Screen right. */
  right: Vec3;
  /** Screen up. */
  up: Vec3;
  /** From the target toward the camera. */
  back: Vec3;
  distance: number;
}

/**
 * A camera on a sphere round its target. `azimuthDeg` is where the camera stands,
 * measured round the target from the near side of the board (+y) toward the right
 * (+x): 0 looks up the board as the player does, 90 looks from the right-hand side.
 * `elevationDeg` is its height above the table plane: 90 is straight down.
 */
export function orbitPose(azimuthDeg: number, elevationDeg: number, distance: number, target: Vec3): Pose {
  const a = azimuthDeg * RAD;
  const e = elevationDeg * RAD;
  const back: Vec3 = [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
  const right: Vec3 = [Math.cos(a), -Math.sin(a), 0];
  const up: Vec3 = [-Math.sin(e) * Math.sin(a), -Math.sin(e) * Math.cos(a), Math.cos(e)];
  return {
    position: [target[0] + back[0] * distance, target[1] + back[1] * distance, target[2] + back[2] * distance],
    target: [target[0], target[1], target[2]],
    right,
    up,
    back,
    distance,
  };
}

/** The player's camera: over `centre`, tilted `tiltDeg` from straight down, looking up the board. */
export function playPose(centre: readonly [number, number], distance: number, tiltDeg: number): Pose {
  return orbitPose(0, 90 - tiltDeg, distance, [centre[0], centre[1], 0]);
}

/** Board frame to eye space (x right, y up, looking down -z). */
export function viewMatrix(p: Pose): Mat4 {
  const { right: r, up: u, back: b, position: c } = p;
  return [
    r[0], u[0], b[0], 0,
    r[1], u[1], b[1], 0,
    r[2], u[2], b[2], 0,
    -(r[0] * c[0] + r[1] * c[1] + r[2] * c[2]), -(u[0] * c[0] + u[1] * c[1] + u[2] * c[2]), -(b[0] * c[0] + b[1] * c[1] + b[2] * c[2]), 1,
  ];
}

/** Near and far planes for a camera at this distance from its target: far enough apart for the whole table. */
export function clipRange(distance: number): [number, number] {
  return [distance * 0.1, distance * 200];
}

/** Board frame to clip space for a pose. */
export function viewProjection(p: Pose, fovYDeg: number, aspect: number): Mat4 {
  const [near, far] = clipRange(p.distance);
  return multiply(perspective(fovYDeg, aspect, near, far), viewMatrix(p));
}

// ---------------------------------------------------------------------------
// Through the matrix, both ways
// ---------------------------------------------------------------------------

/** Clip coordinates of a board-frame point. */
export function toClip(m: readonly number[], x: number, y: number, z: number): [number, number, number, number] {
  return [
    (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number),
    (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number),
    (m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number),
    (m[3] as number) * x + (m[7] as number) * y + (m[11] as number) * z + (m[15] as number),
  ];
}

/** Position of a board-frame point on screen, in pixels of a w x h frame (y down), or null when it is behind the camera. */
export function toScreen(m: readonly number[], size: readonly [number, number], x: number, y: number, z = 0): Point | null {
  const c = toClip(m, x, y, z);
  if (!(c[3] > 0)) return null;
  return [((c[0] / c[3]) * 0.5 + 0.5) * size[0], (0.5 - (c[1] / c[3]) * 0.5) * size[1]];
}

/** The ray through a point of the frame (normalised device coordinates): two board-frame points on it, near then far. */
export function rayThrough(inverse: readonly number[], ndcX: number, ndcY: number): [Vec3, Vec3] {
  const at = (ndcZ: number): Vec3 => {
    const c = toClip(inverse, ndcX, ndcY, ndcZ);
    return [c[0] / c[3], c[1] / c[3], c[2] / c[3]];
  };
  return [at(-1), at(1)];
}

/** Where the ray through a point of the frame meets the plane at height z, or null when it never does going forward. */
export function planePoint(inverse: readonly number[], ndcX: number, ndcY: number, z = 0): Point | null {
  const [a, b] = rayThrough(inverse, ndcX, ndcY);
  const dz = b[2] - a[2];
  if (!(Math.abs(dz) > 1e-12)) return null;
  const t = (z - a[2]) / dz;
  if (!(t >= 0) || !Number.isFinite(t)) return null;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Normalised device coordinates of the centre of nothing in particular: a point given in pixels of a w x h frame, y down. */
export function ndcOf(px: number, py: number, size: readonly [number, number]): Point {
  return [(px / size[0]) * 2 - 1, 1 - (py / size[1]) * 2];
}

/**
 * D(p): the screen density at a point of the plane z = 0, in drawing-buffer pixels
 * per h. It is the larger singular value of the derivative of the map from the
 * board plane to drawing-buffer pixels.
 */
export function density(m: readonly number[], device: readonly [number, number], x: number, y: number): number {
  const cx = (m[0] as number) * x + (m[4] as number) * y + (m[12] as number);
  const cy = (m[1] as number) * x + (m[5] as number) * y + (m[13] as number);
  const cw = (m[3] as number) * x + (m[7] as number) * y + (m[15] as number);
  const kx = (0.5 * device[0]) / (cw * cw);
  const ky = (0.5 * device[1]) / (cw * cw);
  const a = kx * ((m[0] as number) * cw - cx * (m[3] as number));
  const b = kx * ((m[4] as number) * cw - cx * (m[7] as number));
  const c = ky * ((m[1] as number) * cw - cy * (m[3] as number));
  const d = ky * ((m[5] as number) * cw - cy * (m[7] as number));
  const s = a * a + b * b + c * c + d * d;
  const det = a * d - b * c;
  return Math.sqrt((s + Math.sqrt(Math.max(s * s - 4 * det * det, 0))) / 2);
}

// ---------------------------------------------------------------------------
// Views and their limits
// ---------------------------------------------------------------------------

export type ViewMode = 'play' | 'overview';

export interface View {
  mode: ViewMode;
  /** The point of the board at the middle of the frame. */
  centre: Point;
  hexesAcross: number;
}

/** What the limits depend on. */
export interface ViewEnv {
  /** The board rectangle. */
  board: Rect;
  /** The slabs together: the board rectangle grown by its margin. */
  outline: Rect;
  /** The table top. */
  table: Rect;
  /** The window in CSS pixels, and its drawing buffer in device pixels. */
  css: readonly [number, number];
  device: readonly [number, number];
  /** Tilt from straight down: TILT_DEG in the tilted tiers, 0 in Flat. */
  tiltDeg: number;
  fovYDeg: number;
  /** One column step in h: COL_STEP of the hex module. */
  colStep: number;
}

export interface ZoomLimits {
  /** Hexes across at the closest zoom. */
  closest: number;
  /** Hexes across at the farthest zoom of play. The frame never holds the whole board there. */
  farthest: number;
  /** Hexes across in the overview, which holds the whole board with table all round. */
  overview: number;
}

/** The frame of a camera at distance 1 from its target: how far the plane z = 0 reaches in it. */
interface UnitFrame {
  /** tan of half the horizontal field of view. */
  halfWidth: number;
  /** Reach of the frame along the board from the target toward the camera, and away from it. */
  near: number;
  far: number;
  /** Half the frame's width on the board at its near and far edges. */
  halfNear: number;
  halfFar: number;
  /** Largest density in the frame, in device pixels per h. */
  density: number;
}

function unitFrame(env: ViewEnv): UnitFrame {
  const t = Math.tan((env.fovYDeg * RAD) / 2);
  const aspect = env.css[0] / env.css[1];
  const sin = Math.sin(env.tiltDeg * RAD);
  const cos = Math.cos(env.tiltDeg * RAD);
  const near = t / (cos + t * sin);
  const far = t / (cos - t * sin);
  const halfWidth = aspect * t;
  const m = viewProjection(playPose([0, 0], 1, env.tiltDeg), env.fovYDeg, aspect);
  const inv = invert(m);
  let dMax = 0;
  for (let j = 0; j <= 8; j++) {
    for (let i = 0; i <= 8; i++) {
      const p = planePoint(inv, i / 4 - 1, j / 4 - 1, 0);
      if (p) dMax = Math.max(dMax, density(m, env.device, p[0], p[1]));
    }
  }
  return { halfWidth, near, far, halfNear: halfWidth * (1 - near * sin), halfFar: halfWidth * (1 + far * sin), density: dMax };
}

/** Distance from the camera to its target for a view this many hexes across. */
export function distanceOf(hexesAcross: number, env: ViewEnv): number {
  const aspect = env.css[0] / env.css[1];
  return (hexesAcross * env.colStep) / (2 * aspect * Math.tan((env.fovYDeg * RAD) / 2));
}

function hexesOf(distance: number, env: ViewEnv): number {
  const aspect = env.css[0] / env.css[1];
  return (distance * 2 * aspect * Math.tan((env.fovYDeg * RAD) / 2)) / env.colStep;
}

/** Where the centre of a view at this distance may be: inside the board rectangle by a share of the view's own size. */
function centreRange(distance: number, env: ViewEnv, u: UnitFrame): Rect {
  const [x0, y0, x1, y1] = env.board;
  const ix = Math.min(CENTRE_INSET * 2 * u.halfWidth * distance, (x1 - x0) / 2);
  const iy = Math.min(CENTRE_INSET * (u.near + u.far) * distance, (y1 - y0) / 2);
  return [x0 + ix, y0 + iy, x1 - ix, y1 - iy];
}

/** True when the frame of a camera at this distance stays on the table wherever its centre may be. */
function onTable(distance: number, env: ViewEnv, u: UnitFrame): boolean {
  const r = centreRange(distance, env, u);
  const half = Math.max(u.halfNear, u.halfFar) * distance;
  return r[0] - half >= env.table[0] && r[2] + half <= env.table[2] && r[1] - u.far * distance >= env.table[1] && r[3] + u.near * distance <= env.table[3];
}

/**
 * The overview: the whole board with its margin and a border of table inside the
 * frame, as large as that allows, the border equal at the top and the bottom.
 */
export function overviewOf(env: ViewEnv): View {
  const u = unitFrame(env);
  const sin = Math.sin(env.tiltDeg * RAD);
  const [bx0, by0, bx1, by1] = env.board;
  const border = Math.max(1, 0.04 * Math.max(bx1 - bx0, by1 - by0));
  const g: Rect = [env.outline[0] - border, env.outline[1] - border, env.outline[2] + border, env.outline[3] + border];
  const gh = g[3] - g[1];
  const ghw = (g[2] - g[0]) / 2;
  const cx = (g[0] + g[2]) / 2;
  // The height decides: the frame's near and far edges lie on the border's.
  const dv = gh / (u.near + u.far);
  if (dv * u.halfNear >= ghw) return { mode: 'overview', centre: [cx, g[3] - u.near * dv], hexesAcross: hexesOf(dv, env) };
  // The width decides: the near corners touch the sides, and the room left over is shared top and bottom.
  // s is how far the near edge of the border lies from the target; d(s) follows from the width.
  const dOf = (s: number): number => ghw / u.halfWidth + s * sin;
  const f = (s: number): number => dOf(s) * (gh - 2 * s) - 2 * s * (gh - s) * sin;
  let lo = 0;
  let hi = gh / 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  const s = (lo + hi) / 2;
  return { mode: 'overview', centre: [cx, g[3] - s], hexesAcross: hexesOf(dOf(s), env) };
}

/** The zoom limits for a board, a window and a tilt. */
export function zoomLimits(env: ViewEnv): ZoomLimits {
  const u = unitFrame(env);
  const bw = env.board[2] - env.board[0];
  const bh = env.board[3] - env.board[1];
  const closest = Math.max(u.density / DENSITY_TARGET, distanceOf(MIN_HEXES, env));
  // In play the frame never holds the whole board: it falls short along the board's depth or along its width.
  let farthest = Math.max((PLAY_SHARE * bh) / (u.near + u.far), (PLAY_SHARE * bw) / (2 * u.halfFar));
  if (!onTable(farthest, env, u)) {
    let lo = 0;
    let hi = farthest;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (onTable(mid, env, u)) lo = mid;
      else hi = mid;
    }
    farthest = lo;
  }
  // A board too small for both: the density limit wins, and play may then show the whole board.
  if (farthest < closest) farthest = closest;
  return { closest: hexesOf(closest, env), farthest: hexesOf(farthest, env), overview: overviewOf(env).hexesAcross };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The view that a request becomes: the zoom inside its limits, then the centre
 * inside the range that zoom allows. A request already inside comes back
 * unchanged. `mode: 'overview'` gives the overview whatever else is asked.
 */
export function limitView(request: { mode?: ViewMode; centre?: readonly [number, number]; hexesAcross?: number }, env: ViewEnv): View {
  if (request.mode === 'overview') return overviewOf(env);
  const limits = zoomLimits(env);
  const wanted = request.hexesAcross;
  const hexesAcross = clamp(typeof wanted === 'number' && Number.isFinite(wanted) ? wanted : Math.min(DEFAULT_HEXES, limits.farthest), limits.closest, limits.farthest);
  const r = centreRange(distanceOf(hexesAcross, env), env, unitFrame(env));
  const c = request.centre;
  const cx = c && Number.isFinite(c[0]) ? c[0] : (env.board[0] + env.board[2]) / 2;
  const cy = c && Number.isFinite(c[1]) ? c[1] : (env.board[1] + env.board[3]) / 2;
  return { mode: 'play', centre: [clamp(cx, r[0], r[2]), clamp(cy, r[1], r[3])], hexesAcross };
}

/** The view a board opens with: the middle of the board, DEFAULT_HEXES across or the farthest play allows. */
export function defaultView(env: ViewEnv): View {
  return limitView({}, env);
}

/** The player's camera for a view. */
export function cameraOf(view: View, env: ViewEnv): { pose: Pose; viewProj: Mat4 } {
  const pose = playPose(view.centre, distanceOf(view.hexesAcross, env), env.tiltDeg);
  return { pose, viewProj: viewProjection(pose, env.fovYDeg, env.css[0] / env.css[1]) };
}

/** Hexes across of any camera: the length of z = 0 along the frame's horizontal centre line, in column steps. */
export function hexesAcrossOf(viewProj: readonly number[], colStep: number): number {
  const inv = invert(viewProj);
  const a = planePoint(inv, -1, 0, 0);
  const b = planePoint(inv, 1, 0, 0);
  if (!a || !b) return Infinity;
  return Math.hypot(b[0] - a[0], b[1] - a[1]) / colStep;
}

/**
 * The centre that keeps a board point under a point of the frame: with the
 * player's camera, moving the centre moves every board point on screen by the
 * same amount, so the answer is exact. `ndc` is the pointer; `anchor` the board
 * point that must stay under it.
 */
export function centreKeeping(anchor: readonly [number, number], ndc: readonly [number, number], hexesAcross: number, env: ViewEnv): Point | null {
  const { viewProj } = cameraOf({ mode: 'play', centre: [0, 0], hexesAcross }, env);
  const offset = planePoint(invert(viewProj), ndc[0], ndc[1], 0);
  if (!offset) return null;
  return [anchor[0] - offset[0], anchor[1] - offset[1]];
}

// ---------------------------------------------------------------------------
// Holding points of the board in the frame (the table's `goTo`)
// ---------------------------------------------------------------------------

/** Any of the table's cameras without where it looks: where it stands round its target, how far it tilts, and its frame. */
export interface Stand {
  /** Where it stands round its target, as `orbitPose` takes it: 0 looks up the board. */
  azimuthDeg: number;
  /** Tilt from straight down. */
  tiltDeg: number;
  fovYDeg: number;
  /** The frame's width over its height. */
  aspect: number;
  /** One column step in h. */
  colStep: number;
}

/** The matrix a stand draws a view with: board frame to clip space. */
export function standProjection(stand: Stand, centre: readonly [number, number], hexesAcross: number): Mat4 {
  const distance = (hexesAcross * stand.colStep) / (2 * stand.aspect * Math.tan((stand.fovYDeg * RAD) / 2));
  return viewProjection(orbitPose(stand.azimuthDeg, 90 - stand.tiltDeg, distance, [centre[0], centre[1], 0]), stand.fovYDeg, stand.aspect);
}

/** What a frame keeps clear to hold points of the board. */
export interface Hold {
  /** Shares of the frame's height that something lies over at its top and at its bottom (a panel): points are held between the two. */
  top: number;
  bottom: number;
  /** Room wanted round each point, in h on the board: toward the frame's sides, and toward its top and its bottom. */
  side: number;
  end: number;
}

/**
 * Where points of the board fall in a frame, each with room round it: the box round them all, in
 * normalised device coordinates (left, bottom, right, top). The room is laid out on the board along
 * the screen's own right and up as the camera stands, and seen through the camera, so that a point
 * far up a tilted board takes less of the frame than a near one. Null when a point is behind the camera.
 */
export function boxInFrame(viewProj: readonly number[], azimuthDeg: number, points: readonly (readonly [number, number])[], side: number, end: number): [number, number, number, number] | null {
  const a = azimuthDeg * RAD;
  const rx = Math.cos(a);
  const ry = -Math.sin(a);
  const ux = -Math.sin(a);
  const uy = -Math.cos(a);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    for (let k = 0; k < 5; k++) {
      const s = k === 1 ? side : k === 2 ? -side : 0;
      const e = k === 3 ? end : k === 4 ? -end : 0;
      const c = toClip(viewProj, p[0] + rx * s + ux * e, p[1] + ry * s + uy * e, 0);
      if (!(c[3] > 1e-9)) return null;
      const x = c[0] / c[3];
      const y = c[1] / c[3];
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  return x0 <= x1 ? [x0, y0, x1, y1] : null;
}

/** Whether a box in the frame (`boxInFrame`) lies wholly inside it, clear of what lies over its top and its bottom. */
export function heldIn(box: readonly [number, number, number, number], hold: Pick<Hold, 'top' | 'bottom'>): boolean {
  return box[0] >= -1 && box[2] <= 1 && box[1] >= -1 + 2 * hold.bottom && box[3] <= 1 - 2 * hold.top;
}

/**
 * The view that holds points of the board, by a camera as it stands: its centre puts them, with
 * their room, in the middle of what the frame has clear (so a little below the frame's own middle
 * when more lies over its top than over its bottom), and its zoom is `from` when they fit at that,
 * and otherwise runs out only as far as they need, never past `farthest`. It never runs in.
 * `held` says whether they all fit. Null with no points.
 */
export function viewHolding(points: readonly (readonly [number, number])[], stand: Stand, hold: Hold, from: number, farthest: number): { centre: Point; hexesAcross: number; held: boolean } | null {
  if (points.length === 0) return null;
  const most = Math.max(farthest, from);
  const aim: Point = [0, hold.bottom - hold.top];
  const halfHeight = Math.max(1e-6, 1 - hold.top - hold.bottom);
  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  for (const p of points) {
    bx0 = Math.min(bx0, p[0]);
    bx1 = Math.max(bx1, p[0]);
    by0 = Math.min(by0, p[1]);
    by1 = Math.max(by1, p[1]);
  }
  const middle: Point = [(bx0 + bx1) / 2, (by0 + by1) / 2];
  let across = from;
  let centre: Point = middle;
  for (let round = 0; round < 40; round++) {
    // Their box is brought to the middle of the clear part of the frame: the board point under the box's
    // middle is put under that place. A few passes, because the box changes a little as the camera moves.
    centre = [middle[0], middle[1]];
    let seen = true;
    for (let pass = 0; pass < 16 && seen; pass++) {
      const m = standProjection(stand, centre, across);
      const at = boxInFrame(m, stand.azimuthDeg, points, hold.side, hold.end);
      const inv = invert(m);
      const under = at ? planePoint(inv, (at[0] + at[2]) / 2, (at[1] + at[3]) / 2, 0) : null;
      const want = planePoint(inv, aim[0], aim[1], 0);
      if (!under || !want) {
        seen = false;
        break;
      }
      const dx = under[0] - want[0];
      const dy = under[1] - want[1];
      centre = [centre[0] + dx, centre[1] + dy];
      if (Math.hypot(dx, dy) < 1e-7 * across) break;
    }
    const box = seen ? boxInFrame(standProjection(stand, centre, across), stand.azimuthDeg, points, hold.side, hold.end) : null;
    // How much wider the view must be for the box to fit between the frame's sides and in its clear height.
    const need = box ? Math.max((box[2] - box[0]) / 2, (box[3] - box[1]) / 2 / halfHeight) : 2;
    if (box && need <= 1 + 1e-9) return { centre, hexesAcross: across, held: true };
    if (across >= most * (1 - 1e-12)) return { centre: box ? centre : middle, hexesAcross: most, held: false };
    across = Math.min(most, across * Math.min(2, Math.max(need, 1.0002)) * 1.0005);
  }
  return { centre, hexesAcross: across, held: false };
}

// ---------------------------------------------------------------------------
// The glide: a view's centre drawn to a goal, critically damped
// ---------------------------------------------------------------------------

/**
 * The glide's dials. A centre is drawn to its goal as by a critically damped spring of this `rate` (in a
 * second): it comes in gently, with no bounce. As the zoom is, it is held under a top speed (`top`, in
 * widths of the view a second) and takes `gatherS` to gather that speed from nothing: a short glide is the
 * spring's own, about half a second; a long one runs at the top speed through its middle, so that the
 * board is seen to pass rather than to jump, and is not much longer. It has arrived when it is nearer its
 * goal than `stillShare` of the view's width (well under a pixel) and slower than `stillSpeed` of that
 * width a second.
 */
export const GLIDE = { rate: 17, top: 4.5, gatherS: 0.12, stillShare: 0.0003, stillSpeed: 0.004 } as const;

/**
 * The speed a glide may begin with, in a view `width` wide: the speed the view has, no more of it than the
 * glide's top speed, and less any part of it toward the goal that a critically damped approach could not
 * shed before the goal (it would carry the view past and back).
 */
export function glideEntry(at: readonly [number, number], vel: readonly [number, number], goal: readonly [number, number], width: number): Point {
  const yx = at[0] - goal[0];
  const yy = at[1] - goal[1];
  const far = Math.hypot(yx, yy);
  if (!(far > 1e-12)) return [0, 0];
  const top = GLIDE.top * width;
  const speed = Math.hypot(vel[0], vel[1]);
  const k = speed > top ? top / speed : 1;
  const vx = vel[0] * k;
  const vy = vel[1] * k;
  const ux = yx / far;
  const uy = yy / far;
  // Its speed away from the goal (negative: toward it). Toward the goal no faster than the rate times the distance.
  const away = vx * ux + vy * uy;
  const over = -GLIDE.rate * far - away;
  return over > 0 ? [vx + ux * over, vy + uy * over] : [vx, vy];
}

/** One step of the spring alone: its own solution, so it is the same whatever the length of the step. */
function springStep(at: readonly [number, number], vel: readonly [number, number], goal: readonly [number, number], rate: number, dt: number): { at: Point; vel: Point } {
  const k = Math.exp(-rate * dt);
  const yx = at[0] - goal[0];
  const yy = at[1] - goal[1];
  const bx = vel[0] + rate * yx;
  const by = vel[1] + rate * yy;
  return {
    at: [goal[0] + (yx + bx * dt) * k, goal[1] + (yy + by * dt) * k],
    vel: [(vel[0] - rate * bx * dt) * k, (vel[1] - rate * by * dt) * k],
  };
}

/**
 * One step of a glide: where the centre is and how fast it moves after `dt` seconds, drawn to `goal`, in a
 * view `width` wide (h). It is the spring's step, with the speed held under the top speed and under what
 * it had a step ago plus what it may gather in the step. From rest it never passes its goal.
 */
export function glideStep(at: readonly [number, number], vel: readonly [number, number], goal: readonly [number, number], dt: number, width: number): { at: Point; vel: Point } {
  const s = springStep(at, vel, goal, GLIDE.rate, dt);
  const top = GLIDE.top * width;
  const may = Math.min(top, Math.hypot(vel[0], vel[1]) + (top / GLIDE.gatherS) * dt);
  const asked = Math.hypot(s.vel[0], s.vel[1]);
  if (asked <= may) return s;
  // Held back: the way the spring would go, at the speed it may have; the step covers the mean of the two speeds.
  const k = may / asked;
  const v: Point = [s.vel[0] * k, s.vel[1] * k];
  return { at: [at[0] + ((vel[0] + v[0]) / 2) * dt, at[1] + ((vel[1] + v[1]) / 2) * dt], vel: v };
}

/** Whether a glide has arrived, in a view `width` wide: it is then put exactly on its goal and ends. */
export function glideArrived(at: readonly [number, number], vel: readonly [number, number], goal: readonly [number, number], width: number): boolean {
  return Math.hypot(at[0] - goal[0], at[1] - goal[1]) <= GLIDE.stillShare * width && Math.hypot(vel[0], vel[1]) <= GLIDE.stillSpeed * width;
}
