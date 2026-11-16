/**
 * Bake a display list to pixels with Canvas 2D (an OffscreenCanvas in the bake
 * worker). docs/art/map-art-spec.md, section 2:
 *
 *   - stock is white; each plate is drawn in list order into a scratch canvas,
 *     then multiplied onto the sheet once, at its registration offset;
 *   - within a plate, a draw op lays its tone opaque (a later tone replaces an
 *     earlier one); an erase op takes `tone` of what is there away;
 *   - rings fill even-odd; a stamp or glyph shape fills even-odd within itself,
 *     and the placements of one op join (they never punch holes in each other);
 *   - a feathered fill is a field raster drawn at quarter resolution and scaled
 *     up; its soft band is `feather` wide, centred on the ring, falling smoothly;
 *   - no ctx.filter, no read-back of pixels, no fonts;
 *   - the paper's grain, if the list has a `paper` entry, is laid on last (grain.ts);
 *   - one path per op (one op is one hex-sized cluster);
 *   - every op is settled before the next is drawn (see `settle`), so the same
 *     list, level and rectangle give the same pixels every time.
 *
 * Level pixel (0, 0) is the top-left corner of the list's bounds.
 */
import type { DisplayList, DisplayOp, FillOp, Ring } from '@mapart/displayList';
import { drawGrain } from './grain';

type Ctx2D = OffscreenCanvasRenderingContext2D;

/** A rectangle in level pixels: x, y, width, height. */
export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PreparedPlate {
  id: string;
  rgb: [number, number, number];
  offset: [number, number];
  ops: { op: DisplayOp; box: [number, number, number, number] }[];
}

export interface Prepared {
  list: DisplayList;
  bounds: [number, number, number, number];
  plates: PreparedPlate[];
  /** Shape rings oriented so that a nonzero fill gives each shape's even-odd interior. */
  shapes: Map<string, number[][]>;
}

/** The stock the plates print on is white (docs/art/map-art-spec.md, section 2); erasing returns to it. */
const STOCK = 'white';

/** Quarter resolution: one field cell is this many level pixels across. */
export const FIELD_CELL = 4;

function parseInk(ink: string): [number, number, number] {
  return [parseInt(ink.slice(1, 3), 16), parseInt(ink.slice(3, 5), 16), parseInt(ink.slice(5, 7), 16)];
}

function signedArea(r: readonly number[]): number {
  let a = 0;
  const n = r.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    a += (r[i] as number) * (r[j + 1] as number) - (r[j] as number) * (r[i + 1] as number);
  }
  return a / 2;
}

function pointInRing(px: number, py: number, r: readonly number[]): boolean {
  let inside = false;
  const n = r.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const yi = r[i + 1] as number;
    const yj = r[j + 1] as number;
    if ((yi > py) !== (yj > py)) {
      const xi = r[i] as number;
      const xj = r[j] as number;
      if (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function reversed(r: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = r.length - 2; i >= 0; i -= 2) out.push(r[i] as number, r[i + 1] as number);
  return out;
}

/** Orient each ring of a shape: rings at even nesting depth run one way, odd depth the other. */
function orientShape(rings: readonly Ring[]): number[][] {
  return rings.map((r, i) => {
    let depth = 0;
    for (let k = 0; k < rings.length; k++) {
      if (k !== i && pointInRing(r[0] as number, r[1] as number, rings[k] as Ring)) depth++;
    }
    const want = Number.isInteger(depth / 2) ? 1 : -1;
    return Math.sign(signedArea(r)) === want ? r.slice() : reversed(r);
  });
}

function ringsBox(rings: readonly (readonly number[])[], pad: number): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rings) {
    for (let i = 0; i + 1 < r.length; i += 2) {
      const x = r[i] as number;
      const y = r[i + 1] as number;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}

function shapeRadius(rings: readonly (readonly number[])[]): number {
  let r = 0;
  for (const ring of rings) for (let i = 0; i + 1 < ring.length; i += 2) r = Math.max(r, Math.hypot(ring[i] as number, ring[i + 1] as number));
  return r;
}

/** Bounding box of what an op can mark, in hex units, before the plate offset. */
function opBox(op: DisplayOp, shapeR: Map<string, number>): [number, number, number, number] {
  switch (op.op) {
    case 'fill':
      return ringsBox(op.rings, (op.feather ?? 0) / 2 + 0.01);
    case 'ribbon': {
      let w = 0;
      for (const v of op.halfWidths) w = Math.max(w, v);
      return ringsBox([op.line], w + 0.01);
    }
    case 'stamp': {
      const r = shapeR.get(op.shape) ?? 0;
      let s = 0;
      for (let i = 0; i < op.placements.length; i += 5) s = Math.max(s, Math.abs(op.placements[i + 3] as number), Math.abs(op.placements[i + 4] as number));
      const pts: number[] = [];
      for (let i = 0; i < op.placements.length; i += 5) pts.push(op.placements[i] as number, op.placements[i + 1] as number);
      return ringsBox([pts], r * s + 0.01);
    }
    case 'pattern':
      return ringsBox(op.clip, op.width + 0.01);
    case 'glyphs': {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      op.shapes.forEach((key, g) => {
        const r = shapeR.get(key) ?? 0;
        const t = op.transforms.slice(g * 6, g * 6 + 6) as number[];
        const s = Math.max(Math.hypot(t[0] as number, t[1] as number), Math.hypot(t[2] as number, t[3] as number)) * r;
        x0 = Math.min(x0, (t[4] as number) - s);
        x1 = Math.max(x1, (t[4] as number) + s);
        y0 = Math.min(y0, (t[5] as number) - s);
        y1 = Math.max(y1, (t[5] as number) + s);
      });
      return [x0 - 0.01, y0 - 0.01, x1 + 0.01, y1 + 0.01];
    }
  }
}

/** Get a display list ready to bake: inks parsed, shapes oriented, ops grouped by plate with their boxes. */
export function prepare(list: DisplayList): Prepared {
  const shapes = new Map<string, number[][]>();
  const shapeR = new Map<string, number>();
  for (const [key, rings] of Object.entries(list.shapes)) {
    shapes.set(key, orientShape(rings));
    shapeR.set(key, shapeRadius(rings));
  }
  const plates: PreparedPlate[] = list.plates.map(p => ({ id: p.id, rgb: parseInk(p.ink), offset: [p.offset[0], p.offset[1]], ops: [] }));
  const byId = new Map(plates.map(p => [p.id, p]));
  for (const op of list.ops) {
    const plate = byId.get(op.plate);
    if (!plate) continue;
    plate.ops.push({ op, box: opBox(op, shapeR) });
  }
  return { list, bounds: [list.bounds[0], list.bounds[1], list.bounds[2], list.bounds[3]], plates, shapes };
}

/** Size of the whole board at a resolution, in level pixels. */
export function boardSize(prep: Prepared, ppx: number): [number, number] {
  const [x0, y0, x1, y1] = prep.bounds;
  return [Math.ceil((x1 - x0) * ppx - 1e-6), Math.ceil((y1 - y0) * ppx - 1e-6)];
}

function toneColour(rgb: readonly number[], tone: number): string {
  const c = (v: number) => Math.round(255 - tone * (255 - v));
  return `rgb(${c(rgb[0] as number)},${c(rgb[1] as number)},${c(rgb[2] as number)})`;
}

function ringsPath(rings: readonly (readonly number[])[]): Path2D {
  const path = new Path2D();
  for (const r of rings) {
    if (r.length < 6) continue;
    path.moveTo(r[0] as number, r[1] as number);
    for (let i = 2; i < r.length; i += 2) path.lineTo(r[i] as number, r[i + 1] as number);
  }
  return path;
}

/** Add rings placed by x' = a x + c y + e, y' = b x + d y + f; a mirroring transform reverses each ring. */
function addPlaced(path: Path2D, rings: readonly (readonly number[])[], a: number, b: number, c: number, d: number, e: number, f: number): void {
  const flip = a * d - b * c < 0;
  for (const r of rings) {
    const n = r.length;
    if (n < 6) continue;
    if (!flip) {
      path.moveTo(a * (r[0] as number) + c * (r[1] as number) + e, b * (r[0] as number) + d * (r[1] as number) + f);
      for (let i = 2; i < n; i += 2) path.lineTo(a * (r[i] as number) + c * (r[i + 1] as number) + e, b * (r[i] as number) + d * (r[i + 1] as number) + f);
    } else {
      path.moveTo(a * (r[n - 2] as number) + c * (r[n - 1] as number) + e, b * (r[n - 2] as number) + d * (r[n - 1] as number) + f);
      for (let i = n - 4; i >= 0; i -= 2) path.lineTo(a * (r[i] as number) + c * (r[i + 1] as number) + e, b * (r[i] as number) + d * (r[i + 1] as number) + f);
    }
  }
}

// ---------------------------------------------------------------------------
// Feathered fills: a field raster at quarter resolution
// ---------------------------------------------------------------------------

interface SegmentGrid {
  cell: number;
  cells: Map<number, number[]>;
  segs: Float64Array;
}

const fieldGrids = new WeakMap<FillOp, SegmentGrid>();

function segmentGrid(op: FillOp, cell: number): SegmentGrid {
  const cached = fieldGrids.get(op);
  if (cached) return cached;
  let count = 0;
  for (const r of op.rings) count += r.length / 2;
  const segs = new Float64Array(count * 4);
  const cells = new Map<number, number[]>();
  let s = 0;
  for (const r of op.rings) {
    const n = r.length;
    for (let i = 0; i < n; i += 2) {
      const ax = r[i] as number;
      const ay = r[i + 1] as number;
      const bx = r[(i + 2) % n] as number;
      const by = r[(i + 3) % n] as number;
      segs[s * 4] = ax;
      segs[s * 4 + 1] = ay;
      segs[s * 4 + 2] = bx;
      segs[s * 4 + 3] = by;
      const i0 = Math.floor(Math.min(ax, bx) / cell);
      const i1 = Math.floor(Math.max(ax, bx) / cell);
      const j0 = Math.floor(Math.min(ay, by) / cell);
      const j1 = Math.floor(Math.max(ay, by) / cell);
      for (let ci = i0; ci <= i1; ci++) {
        for (let cj = j0; cj <= j1; cj++) {
          const key = (ci + 32768) * 65536 + (cj + 32768);
          const list = cells.get(key);
          if (list) list.push(s);
          else cells.set(key, [s]);
        }
      }
      s++;
    }
  }
  const grid = { cell, cells, segs };
  fieldGrids.set(op, grid);
  return grid;
}

function nearestSeg(grid: SegmentGrid, px: number, py: number, reach: number): number {
  const c = grid.cell;
  const i0 = Math.floor((px - reach) / c);
  const i1 = Math.floor((px + reach) / c);
  const j0 = Math.floor((py - reach) / c);
  const j1 = Math.floor((py + reach) / c);
  let best = reach * reach;
  const s = grid.segs;
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const list = grid.cells.get((i + 32768) * 65536 + (j + 32768));
      if (!list) continue;
      for (const k of list) {
        const ax = s[k * 4] as number;
        const ay = s[k * 4 + 1] as number;
        const abx = (s[k * 4 + 2] as number) - ax;
        const aby = (s[k * 4 + 3] as number) - ay;
        const l2 = abx * abx + aby * aby;
        let t = l2 === 0 ? 0 : ((px - ax) * abx + (py - ay) * aby) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = px - (ax + t * abx);
        const dy = py - (ay + t * aby);
        const d2 = dx * dx + dy * dy;
        if (d2 < best) best = d2;
      }
    }
  }
  return Math.sqrt(best);
}

let fieldCanvas: OffscreenCanvas | null = null;

function featheredFill(ctx: Ctx2D, op: FillOp, plate: PreparedPlate, prep: Prepared, ppx: number, rect: PixelRect, box: readonly number[]): void {
  const f = op.feather as number;
  const half = f / 2;
  const [minX, minY] = prep.bounds;
  const [offX, offY] = plate.offset;
  const C = FIELD_CELL;
  // Level-pixel extent of the op, clipped to the rect.
  const X0 = Math.max(rect.x, ((box[0] as number) + offX - minX) * ppx);
  const X1 = Math.min(rect.x + rect.w, ((box[2] as number) + offX - minX) * ppx);
  const Y0 = Math.max(rect.y, ((box[1] as number) + offY - minY) * ppx);
  const Y1 = Math.min(rect.y + rect.h, ((box[3] as number) + offY - minY) * ppx);
  if (X0 >= X1 || Y0 >= Y1) return;
  const k0 = Math.floor(X0 / C) - 2;
  const k1 = Math.ceil(X1 / C) + 2;
  const l0 = Math.floor(Y0 / C) - 2;
  const l1 = Math.ceil(Y1 / C) + 2;
  const nx = k1 - k0;
  const ny = l1 - l0;
  const grid = segmentGrid(op, Math.max(0.05, half / 2));
  const img = new ImageData(nx, ny);
  const data = img.data;
  const rgb = op.mode === 'erase' ? [255, 255, 255] : plate.rgb.map(v => Math.round(255 - op.tone * (255 - v)));
  const peak = op.mode === 'erase' ? op.tone : 1;
  // Edges of every ring, for the even-odd test along each row.
  const edges: number[] = [];
  for (const r of op.rings) {
    const n = r.length;
    for (let i = 0; i < n; i += 2) edges.push(r[i] as number, r[i + 1] as number, r[(i + 2) % n] as number, r[(i + 3) % n] as number);
  }
  const xs: number[] = [];
  for (let l = 0; l < ny; l++) {
    const y = minY + ((l0 + l) * C + C / 2) / ppx - offY;
    xs.length = 0;
    for (let e = 0; e < edges.length; e += 4) {
      const ay = edges[e + 1] as number;
      const by = edges[e + 3] as number;
      if ((ay > y) !== (by > y)) {
        const ax = edges[e] as number;
        const bx = edges[e + 2] as number;
        xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
      }
    }
    xs.sort((a, b) => a - b);
    let ptr = 0;
    let inside = false;
    for (let k = 0; k < nx; k++) {
      const x = minX + ((k0 + k) * C + C / 2) / ppx - offX;
      // Even-odd: every crossing passed flips inside and out.
      while (ptr < xs.length && (xs[ptr] as number) <= x) {
        ptr++;
        inside = !inside;
      }
      const d = nearestSeg(grid, x, y, half);
      const sd = inside ? -d : d;
      let a = 0.5 - sd / f;
      a = a < 0 ? 0 : a > 1 ? 1 : a;
      a = a * a * (3 - 2 * a);
      const o = (l * nx + k) * 4;
      data[o] = rgb[0] as number;
      data[o + 1] = rgb[1] as number;
      data[o + 2] = rgb[2] as number;
      data[o + 3] = Math.round(a * peak * 255);
    }
  }
  if (!fieldCanvas) fieldCanvas = new OffscreenCanvas(nx, ny);
  if (fieldCanvas.width !== nx || fieldCanvas.height !== ny) {
    fieldCanvas.width = nx;
    fieldCanvas.height = ny;
  }
  const fctx = fieldCanvas.getContext('2d') as Ctx2D;
  fctx.putImageData(img, 0, 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(fieldCanvas, 0, 0, nx, ny, k0 * C - rect.x, l0 * C - rect.y, nx * C, ny * C);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Settling: where the GPU breaks the drawing must not move a pixel
// ---------------------------------------------------------------------------

/**
 * Chromium draws a worker's canvas on the GPU, and there the antialiased edges
 * of paths come out a little differently according to where the canvas's
 * drawing is broken into pieces for the GPU: a break between two paths whose
 * edges share pixels moves those pixels. Chromium breaks the drawing where it
 * chooses, and now and then it chose one break more than usual: a bake of a
 * wood moved from 3 to 175 pixels on canopy edges, by up to 20 of 255
 * (docs/bars/M3b.md, ruling 30). That was seen in about one bake in a hundred
 * of the place where it showed, on a busy machine, and only in the first bake
 * of a freshly started browser; every such picture is the one a break between
 * ops gives.
 *
 * So the bake makes the breaks itself: after every op it draws the canvas as
 * an image into a canvas of 1 x 1 pixel, which makes Chromium hand all that has
 * been drawn to the GPU before anything more is drawn. Each op is then drawn
 * over finished pixels, and a break Chromium adds between two ops changes
 * nothing. The other draws of a bake (the white stock, a plate multiplied onto
 * the sheet, the grain, a cell copied out) cover whole pixels, so a break
 * beside them changes nothing either. No pixel is read back; the 1 x 1 canvas
 * is never looked at. On this machine it costs no measurable time.
 */
let settleCanvas: OffscreenCanvas | null = null;

function settle(canvas: OffscreenCanvas): void {
  if (!settleCanvas) settleCanvas = new OffscreenCanvas(1, 1);
  (settleCanvas.getContext('2d') as Ctx2D).drawImage(canvas, 0, 0, 1, 1, 0, 0, 1, 1);
}

/**
 * A check, not a setting (`npm run bake -- --extra-breaks`, scripts/bakecheck.ts):
 * break the drawing once more before every op, through a canvas of its own.
 * With every op settled this changes no pixel; were the settling lost or
 * weakened, it would move the pixels the fault moved, on every run.
 */
let breakCanvas: OffscreenCanvas | null = null;

function extraBreak(canvas: OffscreenCanvas): void {
  if (!breakCanvas) breakCanvas = new OffscreenCanvas(1, 1);
  (breakCanvas.getContext('2d') as Ctx2D).drawImage(canvas, 0, 0, 1, 1, 0, 0, 1, 1);
}

// ---------------------------------------------------------------------------
// Drawing one op
// ---------------------------------------------------------------------------

function drawOp(ctx: Ctx2D, op: DisplayOp, plate: PreparedPlate, prep: Prepared, ppx: number, rect: PixelRect, box: readonly number[]): void {
  const erase = op.mode === 'erase';
  const colour = erase ? STOCK : toneColour(plate.rgb, op.tone);
  ctx.globalAlpha = erase ? op.tone : 1;
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  switch (op.op) {
    case 'fill':
      if (op.feather !== undefined && op.feather > 0) {
        featheredFill(ctx, op, plate, prep, ppx, rect, box);
        return;
      }
      ctx.fill(ringsPath(op.rings), 'evenodd');
      return;
    case 'ribbon': {
      const line = op.line;
      const hw = op.halfWidths;
      let constant = true;
      for (let i = 1; i < hw.length; i++) if (hw[i] !== hw[0]) constant = false;
      if (constant) {
        const path = new Path2D();
        path.moveTo(line[0] as number, line[1] as number);
        for (let i = 2; i < line.length; i += 2) path.lineTo(line[i] as number, line[i + 1] as number);
        ctx.lineWidth = 2 * (hw[0] as number);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash(op.dash ? [...op.dash] : []);
        ctx.stroke(path);
        ctx.setLineDash([]);
        return;
      }
      // Varying width: a quad per segment and a disc per point, all wound the same way.
      const path = new Path2D();
      for (let i = 0; i < line.length; i += 2) {
        const r = hw[i / 2] as number;
        if (r > 0) {
          path.moveTo((line[i] as number) + r, line[i + 1] as number);
          path.arc(line[i] as number, line[i + 1] as number, r, 0, Math.PI * 2, false);
        }
      }
      for (let i = 0; i + 3 < line.length; i += 2) {
        const ax = line[i] as number;
        const ay = line[i + 1] as number;
        const bx = line[i + 2] as number;
        const by = line[i + 3] as number;
        const ra = hw[i / 2] as number;
        const rb = hw[i / 2 + 1] as number;
        const l = Math.hypot(bx - ax, by - ay);
        if (l === 0) continue;
        const nx = -(by - ay) / l;
        const ny = (bx - ax) / l;
        // Wound clockwise on screen, as the discs are.
        const quad = [ax - nx * ra, ay - ny * ra, bx - nx * rb, by - ny * rb, bx + nx * rb, by + ny * rb, ax + nx * ra, ay + ny * ra];
        const q = signedArea(quad) > 0 ? quad : reversed(quad);
        path.moveTo(q[0] as number, q[1] as number);
        for (let k = 2; k < 8; k += 2) path.lineTo(q[k] as number, q[k + 1] as number);
        path.closePath();
      }
      ctx.fill(path, 'nonzero');
      return;
    }
    case 'stamp': {
      const rings = prep.shapes.get(op.shape);
      if (!rings) return;
      const path = new Path2D();
      const p = op.placements;
      for (let i = 0; i < p.length; i += 5) {
        const x = p[i] as number;
        const y = p[i + 1] as number;
        const rot = p[i + 2] as number;
        const sx = p[i + 3] as number;
        const sy = p[i + 4] as number;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        // Scaled, then turned, then moved.
        addPlaced(path, rings, cos * sx, sin * sx, -sin * sy, cos * sy, x, y);
      }
      ctx.fill(path, 'nonzero');
      return;
    }
    case 'pattern': {
      ctx.save();
      ctx.clip(ringsPath(op.clip), 'evenodd');
      const path = new Path2D();
      for (const s of op.strokes) {
        path.moveTo(s[0] as number, s[1] as number);
        for (let i = 2; i < s.length; i += 2) path.lineTo(s[i] as number, s[i + 1] as number);
      }
      ctx.lineWidth = op.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(path);
      ctx.restore();
      return;
    }
    case 'glyphs': {
      const path = new Path2D();
      op.shapes.forEach((key, g) => {
        const rings = prep.shapes.get(key);
        if (!rings) return;
        const t = op.transforms;
        const o = g * 6;
        addPlaced(path, rings, t[o] as number, t[o + 1] as number, t[o + 2] as number, t[o + 3] as number, t[o + 4] as number, t[o + 5] as number);
      });
      ctx.fill(path, 'nonzero');
      return;
    }
  }
}

export interface BakeCanvases {
  /** The image handed back: resized to each request. */
  out: OffscreenCanvas;
  /** One cell of the sheet and its scratch plate, CELL x CELL. */
  sheet: OffscreenCanvas;
  scratch: OffscreenCanvas;
}

/**
 * Every bake is put together from cells of one fixed grid: CELL x CELL level
 * pixels, the first at level pixel (0, 0). A cell is always drawn whole, on a
 * canvas of the same size at the same place, whatever rectangle was asked for,
 * so a tile and a single pass over the same ground give the same pixels: a
 * GPU canvas may pick its way of drawing a path from how much of the path is
 * on the canvas, and here that never changes.
 */
export const CELL = 1024;

export function makeCanvases(): BakeCanvases {
  return { out: new OffscreenCanvas(CELL, CELL), sheet: new OffscreenCanvas(CELL, CELL), scratch: new OffscreenCanvas(CELL, CELL) };
}

/**
 * Bake one rectangle of the board at `ppx` level pixels per h onto `canvases.out`
 * (resized to the rectangle). Returns that canvas. `extraBreaks` is a check
 * (see `extraBreak`): it must not change a pixel.
 */
export function bakeRect(prep: Prepared, ppx: number, rect: PixelRect, canvases: BakeCanvases, extraBreaks = false): OffscreenCanvas {
  const { out } = canvases;
  if (out.width !== rect.w || out.height !== rect.h) {
    out.width = rect.w;
    out.height = rect.h;
  }
  const o = out.getContext('2d', { alpha: false }) as Ctx2D;
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.globalCompositeOperation = 'source-over';
  o.globalAlpha = 1;
  o.imageSmoothingEnabled = false;
  const i0 = Math.floor(rect.x / CELL);
  const i1 = Math.floor((rect.x + rect.w - 1) / CELL);
  const j0 = Math.floor(rect.y / CELL);
  const j1 = Math.floor((rect.y + rect.h - 1) / CELL);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const cell = { x: i * CELL, y: j * CELL, w: CELL, h: CELL };
      renderCell(prep, ppx, cell, canvases, extraBreaks);
      const x0 = Math.max(rect.x, cell.x);
      const y0 = Math.max(rect.y, cell.y);
      const x1 = Math.min(rect.x + rect.w, cell.x + CELL);
      const y1 = Math.min(rect.y + rect.h, cell.y + CELL);
      o.drawImage(canvases.sheet, x0 - cell.x, y0 - cell.y, x1 - x0, y1 - y0, x0 - rect.x, y0 - rect.y, x1 - x0, y1 - y0);
    }
  }
  o.globalCompositeOperation = 'source-over';
  return out;
}

/** Draw one whole cell of the grid onto `canvases.sheet`. */
function renderCell(prep: Prepared, ppx: number, rect: PixelRect, canvases: BakeCanvases, extraBreaks: boolean): void {
  const { sheet, scratch } = canvases;
  if (sheet.width !== rect.w || sheet.height !== rect.h) {
    sheet.width = rect.w;
    sheet.height = rect.h;
  }
  if (scratch.width !== rect.w || scratch.height !== rect.h) {
    scratch.width = rect.w;
    scratch.height = rect.h;
  }
  const s = sheet.getContext('2d', { alpha: false }) as Ctx2D;
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.globalCompositeOperation = 'source-over';
  s.globalAlpha = 1;
  s.fillStyle = STOCK;
  s.fillRect(0, 0, rect.w, rect.h);
  const c = scratch.getContext('2d', { alpha: false }) as Ctx2D;
  const [minX, minY] = prep.bounds;
  let sheetIsBlank = true;
  for (const plate of prep.plates) {
    const [offX, offY] = plate.offset;
    // The ops of this plate that reach the rectangle, and the part of the rectangle they cover.
    let px0 = Infinity;
    let py0 = Infinity;
    let px1 = -Infinity;
    let py1 = -Infinity;
    const live: { op: DisplayOp; box: [number, number, number, number] }[] = [];
    for (const item of plate.ops) {
      const b = item.box;
      const bx0 = (b[0] + offX - minX) * ppx - rect.x;
      const by0 = (b[1] + offY - minY) * ppx - rect.y;
      const bx1 = (b[2] + offX - minX) * ppx - rect.x;
      const by1 = (b[3] + offY - minY) * ppx - rect.y;
      if (bx1 < 0 || by1 < 0 || bx0 > rect.w || by0 > rect.h) continue;
      live.push(item);
      px0 = Math.min(px0, bx0);
      py0 = Math.min(py0, by0);
      px1 = Math.max(px1, bx1);
      py1 = Math.max(py1, by1);
    }
    if (live.length === 0) continue;
    const ax = Math.max(0, Math.floor(px0) - 2);
    const ay = Math.max(0, Math.floor(py0) - 2);
    const aw = Math.min(rect.w, Math.ceil(px1) + 2) - ax;
    const ah = Math.min(rect.h, Math.ceil(py1) + 2) - ay;
    if (aw <= 0 || ah <= 0) continue;
    // The first plate goes straight onto the white sheet: multiplying onto white changes nothing.
    const target = sheetIsBlank ? s : c;
    const targetCanvas = sheetIsBlank ? sheet : scratch;
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalAlpha = 1;
    target.globalCompositeOperation = 'source-over';
    if (target === c) {
      c.fillStyle = STOCK;
      c.fillRect(ax, ay, aw, ah);
    }
    target.save();
    target.beginPath();
    target.rect(ax, ay, aw, ah);
    target.clip();
    target.setTransform(ppx, 0, 0, ppx, (offX - minX) * ppx - rect.x, (offY - minY) * ppx - rect.y);
    for (const item of live) {
      if (extraBreaks) extraBreak(targetCanvas);
      target.setTransform(ppx, 0, 0, ppx, (offX - minX) * ppx - rect.x, (offY - minY) * ppx - rect.y);
      drawOp(target, item.op, plate, prep, ppx, rect, item.box);
      settle(targetCanvas);
    }
    target.restore();
    target.globalAlpha = 1;
    if (target === c) {
      s.globalCompositeOperation = 'multiply';
      s.drawImage(scratch, ax, ay, aw, ah, ax, ay, aw, ah);
      s.globalCompositeOperation = 'source-over';
    }
    sheetIsBlank = false;
  }
  // The paper's grain, when the list carries one: over the whole cell, after the last plate (grain.ts).
  if (prep.list.paper) drawGrain(s, scratch, prep.list.paper, ppx, rect.x, rect.y, rect.w, rect.h);
}
