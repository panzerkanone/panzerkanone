/**
 * Standing water (the cover `water`): a lake or a sea drawn as one body with a
 * shore, never hex by hex.
 *
 * The shore follows the outline of the water hexes loosely, as a river's banks
 * follow its chain of hexes. It is the zero line of a field:
 *
 *   s(p) = distance from p to the nearest water hex centre
 *        - distance from p to the nearest land hex centre
 *
 * whose zero line, left alone, is the hex outline itself. The field is
 * smoothed (so the zigzag of the outline becomes a run of shore and a corner
 * becomes a bend), held to its sign round every hex centre (so that, however
 * much is smoothed away, the middle of a water hex is water and the middle of
 * a land hex is land: a player reads a hex by its middle), given a seeded
 * wobble (so no two reaches are alike), and moved a little into the water (so
 * the shore lies inside the water hexes more than outside them). The field
 * falls by two for each hex of distance into the water, so a line a distance d
 * offshore is the level -2d: the fine lines and the deeper tone of the two
 * richer treatments are levels of the same field, parallel to the shore.
 *
 * Off the board the ground is what the nearest hex of the board is, for two
 * hexes; beyond that it is land. A sea therefore runs out over the board's
 * edge and closes well outside it, where the bake cuts it off and where
 * nothing of that false shore, smoothed as it is, reaches back onto the board.
 *
 * The field is worked only where there is water: on a rectangle round each
 * body of it, bodies whose rectangles meet sharing one.
 *
 * Deep water (the third tone of the treatment `deep`) is derived from the
 * water hexes and never stored: a water hex `fromHexes` hexes or more from the
 * nearest land hex is deep, where the water is open (`deepWaterHexes`). Its
 * edge is drawn as the shore is, from a field of the same kind (distance to
 * the nearest deep hex centre less distance to the nearest hex centre that is
 * not), smoothed and given its own wobble; and it is held `clear` off the
 * shore by the shore's own field, so it never touches the pale band there.
 * It is art alone: nothing in the rules knows of it.
 *
 * Pure and deterministic; every layout fact comes from engine/core/hex.
 */
import { Grid, HexId, centreAt, centreOf, hexCount, indexOf, isBoundary, neighboursOf, stepAt, worldToCoord } from '../engine/core/hex';
import { waterBodiesOf } from '../engine/core/map';
import { MapContext } from './context';
import { simplifyRing, zeroContours } from './geom';
import { valueNoise } from './woods';

export interface WaterArt {
  /** The shore: closed rings round the water (a ring that runs off the board closes outside it). */
  shore: number[][];
  /** The rings a given distance offshore, in h. */
  offshore(distance: number): number[][];
  /** The rings round deep water; none on a map whose water is nowhere open enough. */
  deep(): number[][];
}

/**
 * The deep water hexes of a board, 1 for each: a water hex `from` hexes or more from the nearest
 * land hex (a hex beside land is 1 from it), where the water is open: the hex, or one beside it, is
 * a hex further out still, or it lies on the board's edge, where a sea runs on. So the outer rows
 * of a sea are deep, a bay and a strait a few hexes wide are not, and a lake is only where it is
 * broad.
 */
export function deepWaterHexes(g: Grid, cover: readonly string[], from: number): Uint8Array {
  const n = hexCount(g);
  // Hexes from the nearest land hex, outwards from the land.
  const out = new Float64Array(n).fill(Infinity);
  let front: HexId[] = [];
  for (let h = 0; h < n; h++) {
    if (cover[h] !== 'water') {
      out[h] = 0;
      front.push(h);
    }
  }
  while (front.length > 0) {
    const next: HexId[] = [];
    for (const h of front) {
      for (const nb of neighboursOf(g, h)) {
        if (out[nb] !== Infinity) continue;
        out[nb] = (out[h] as number) + 1;
        next.push(nb);
      }
    }
    front = next;
  }
  const deep = new Uint8Array(n);
  for (let h = 0; h < n; h++) {
    const d = out[h] as number;
    if (cover[h] !== 'water' || d < from) continue;
    if (d > from || isBoundary(g, h) || neighboursOf(g, h).some(nb => (out[nb] as number) > from)) deep[h] = 1;
  }
  return deep;
}

/** How many hexes past the board's edge a sea is carried before it is closed. */
const OFF_BOARD = 2;

/** A rectangle the field is worked on: its corner, its size in samples, and the field itself. */
interface Patch {
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  field: Float64Array;
}

/** A box blur along one axis of a grid, by a running sum; the window is cut short at the grid's border. */
function blurAxis(src: Float64Array, nx: number, ny: number, half: number, alongX: boolean): Float64Array {
  const out = new Float64Array(src.length);
  const lines = alongX ? ny : nx;
  const length = alongX ? nx : ny;
  const at = (line: number, k: number): number => (alongX ? line * nx + k : k * nx + line);
  for (let line = 0; line < lines; line++) {
    let sum = 0;
    let count = 0;
    for (let k = 0; k <= Math.min(length - 1, half); k++) {
      sum += src[at(line, k)] as number;
      count += 1;
    }
    for (let k = 0; k < length; k++) {
      out[at(line, k)] = sum / count;
      const leaving = k - half;
      const entering = k + half + 1;
      if (leaving >= 0) {
        sum -= src[at(line, leaving)] as number;
        count -= 1;
      }
      if (entering < length) {
        sum += src[at(line, entering)] as number;
        count += 1;
      }
    }
  }
  return out;
}

/** The water of a map, or null when it has none. */
export function buildWater(ctx: MapContext): WaterArt | null {
  const { g, cover } = ctx;
  if (!cover.includes('water')) return null;
  const P = ctx.art.params.water;
  const step = P.gridStep;

  // Water at a board coordinate. Two hexes off the board the ground is what the nearest hex of the board is.
  const isWater = (col: number, row: number): boolean => {
    const c = Math.min(g.cols - 1, Math.max(0, col));
    const r = Math.min(g.rows - 1, Math.max(0, row));
    if (Math.abs(c - col) > OFF_BOARD || Math.abs(r - row) > OFF_BOARD) return false;
    return cover[indexOf(g, c, r)] === 'water';
  };

  // ---- a rectangle round each body, `reach` past its hex centres; rectangles that meet become one ----
  let boxes: [number, number, number, number][] = waterBodiesOf(ctx.map).map(body => {
    const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const h of body.hexes) {
      const c = centreOf(g, h as HexId);
      box[0] = Math.min(box[0], c[0] - P.reach);
      box[1] = Math.min(box[1], c[1] - P.reach);
      box[2] = Math.max(box[2], c[0] + P.reach);
      box[3] = Math.max(box[3], c[1] + P.reach);
    }
    return box;
  });
  for (let merged = true; merged;) {
    merged = false;
    const next: [number, number, number, number][] = [];
    for (const b of boxes) {
      const hit = next.find(a => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]);
      if (hit) {
        hit[0] = Math.min(hit[0], b[0]);
        hit[1] = Math.min(hit[1], b[1]);
        hit[2] = Math.max(hit[2], b[2]);
        hit[3] = Math.max(hit[3], b[3]);
        merged = true;
      } else {
        next.push([b[0], b[1], b[2], b[3]]);
      }
    }
    boxes = next;
  }

  const half = Math.max(1, Math.round(P.smooth / step));
  const patches: Patch[] = boxes.map(box => {
    // The samples sit on one lattice for the whole board, whatever the rectangle: a body is drawn the same wherever others lie.
    const i0 = Math.floor(box[0] / step);
    const j0 = Math.floor(box[1] / step);
    const nx = Math.ceil(box[2] / step) - i0 + 1;
    const ny = Math.ceil(box[3] / step) - j0 + 1;
    const x0 = i0 * step;
    const y0 = j0 * step;
    let field: Float64Array = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      const y = y0 + j * step;
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * step;
        const [col, row] = worldToCoord(x, y);
        let toWater = Infinity;
        let toLand = Infinity;
        for (let d = -1; d < 6; d++) {
          const [c, r] = d < 0 ? [col, row] : stepAt(col, row, d);
          const p = centreAt(c, r);
          const dist = Math.hypot(p[0] - x, p[1] - y);
          if (isWater(c, r)) toWater = Math.min(toWater, dist);
          else toLand = Math.min(toLand, dist);
        }
        field[j * nx + i] = toWater === Infinity ? 1 : toLand === Infinity ? -1 : Math.max(-1, Math.min(1, toWater - toLand));
      }
    }
    // Smoothed: a box blur each way, twice.
    for (let pass = 0; pass < 2; pass++) field = blurAxis(blurAxis(field, nx, ny, half, true), nx, ny, half, false);
    // The wobble: the shore strays by up to `wobble` either way over a reach of `wobblePitch`, and by a
    // quarter of that over a third of the reach. (The field falls by two for each hex of distance.)
    for (let j = 0; j < ny; j++) {
      const y = y0 + j * step;
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        // Only near a shore: far inside the water or the land no wobble can bring the zero line.
        if (Math.abs(field[k] as number) > 0.999) continue;
        const x = x0 + i * step;
        const broad = valueNoise(ctx.seed, 'water-shore', x, y, P.wobblePitch) - 0.5;
        const fine = valueNoise(ctx.seed, 'water-shore-fine', x, y, P.wobblePitch / 3) - 0.5;
        field[k] = (field[k] as number) + 2 * P.wobble * (2 * broad + 0.5 * fine);
      }
    }
    // Held at the hex centres, last of all: within `centreHold` of the middle of a hex the field is
    // drawn towards that hex's own sign, to `centreLevel` at the middle itself. The level is more than
    // the inset moves the field and less than the first line or tone offshore, so the middle of every
    // water hex is water, the middle of every land hex is land, and the hold draws no ring of its own.
    if (P.centreHold > 0) {
      const reachCells = Math.ceil(P.centreHold / step);
      for (let h = 0; h < hexCount(g); h++) {
        const c = centreOf(g, h);
        const ci = Math.round((c[0] - x0) / step);
        const cj = Math.round((c[1] - y0) / step);
        if (ci < -reachCells || cj < -reachCells || ci >= nx + reachCells || cj >= ny + reachCells) continue;
        const target = cover[h] === 'water' ? -P.centreLevel : P.centreLevel;
        for (let j = Math.max(0, cj - reachCells); j <= Math.min(ny - 1, cj + reachCells); j++) {
          for (let i = Math.max(0, ci - reachCells); i <= Math.min(nx - 1, ci + reachCells); i++) {
            const d = Math.hypot(x0 + i * step - c[0], y0 + j * step - c[1]) / P.centreHold;
            if (d >= 1) continue;
            const hold = (1 - d * d) * (1 - d * d);
            const k = j * nx + i;
            const v = field[k] as number;
            // Only ever towards the hex's own sign: a field already further that way is left alone.
            const held = v * (1 - hold) + target * hold;
            field[k] = target < 0 ? Math.min(v, held) : Math.max(v, held);
          }
        }
      }
    }
    // The rectangle's own border is land, whatever the wobble did there: every ring closes.
    for (let i = 0; i < nx; i++) {
      field[i] = 1;
      field[(ny - 1) * nx + i] = 1;
    }
    for (let j = 0; j < ny; j++) {
      field[j * nx] = 1;
      field[j * nx + nx - 1] = 1;
    }
    return { x0, y0, nx, ny, field };
  });

  const offshore = (distance: number): number[][] => {
    const lift = 2 * (P.inset + distance);
    const rings: number[][] = [];
    for (const p of patches) {
      const level = new Float64Array(p.field.length);
      for (let k = 0; k < level.length; k++) level[k] = (p.field[k] as number) + lift;
      for (const ring of zeroContours(level, p.nx, p.ny, p.x0, p.y0, step)) {
        const thin = simplifyRing(ring, P.simplify);
        if (thin.length >= 6) rings.push(thin);
      }
    }
    return rings;
  };

  const deep = (): number[][] => {
    const D = P.deep;
    const deepHex = deepWaterHexes(g, cover, D.fromHexes);
    if (!deepHex.includes(1)) return [];
    // Deep at a board coordinate: off the board, as with the water itself, what the nearest hex of the board is.
    const isDeep = (col: number, row: number): boolean => {
      const c = Math.min(g.cols - 1, Math.max(0, col));
      const r = Math.min(g.rows - 1, Math.max(0, row));
      if (Math.abs(c - col) > OFF_BOARD || Math.abs(r - row) > OFF_BOARD) return false;
      return deepHex[indexOf(g, c, r)] === 1;
    };
    const halfDeep = Math.max(1, Math.round(D.smooth / step));
    const keepOff = 2 * (P.inset + D.clear);
    const rings: number[][] = [];
    for (const p of patches) {
      const { x0, y0, nx, ny } = p;
      // Positive is not deep, as in the shore's field positive is land.
      let field: Float64Array = new Float64Array(nx * ny).fill(1);
      let any = false;
      for (let j = 0; j < ny; j++) {
        const y = y0 + j * step;
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          if ((p.field[k] as number) >= 0) continue;                // land: never deep
          const x = x0 + i * step;
          const [col, row] = worldToCoord(x, y);
          let toDeep = Infinity;
          let toOther = Infinity;
          for (let d = -1; d < 6; d++) {
            const [c, r] = d < 0 ? [col, row] : stepAt(col, row, d);
            const q = centreAt(c, r);
            const dist = Math.hypot(q[0] - x, q[1] - y);
            if (isDeep(c, r)) toDeep = Math.min(toDeep, dist);
            else toOther = Math.min(toOther, dist);
          }
          if (toDeep === Infinity) continue;
          any = true;
          field[k] = toOther === Infinity ? -1 : Math.max(-1, Math.min(1, toDeep - toOther));
        }
      }
      if (!any) continue;
      for (let pass = 0; pass < 2; pass++) field = blurAxis(blurAxis(field, nx, ny, halfDeep, true), nx, ny, halfDeep, false);
      for (let j = 0; j < ny; j++) {
        const y = y0 + j * step;
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          let v = field[k] as number;
          if (Math.abs(v) <= 0.999) {
            const x = x0 + i * step;
            const broad = valueNoise(ctx.seed, 'water-deep', x, y, P.wobblePitch) - 0.5;
            const fine = valueNoise(ctx.seed, 'water-deep-fine', x, y, P.wobblePitch / 3) - 0.5;
            v += 2 * D.wobble * (2 * broad + 0.5 * fine);
          }
          // Never nearer the shore than `clear`: where the shore's own field says the shore is that near, it is not deep.
          field[k] = Math.max(v, (p.field[k] as number) + keepOff);
        }
      }
      for (let i = 0; i < nx; i++) {
        field[i] = 1;
        field[(ny - 1) * nx + i] = 1;
      }
      for (let j = 0; j < ny; j++) {
        field[j * nx] = 1;
        field[j * nx + nx - 1] = 1;
      }
      for (const ring of zeroContours(field, nx, ny, x0, y0, step)) {
        const thin = simplifyRing(ring, P.simplify);
        if (thin.length >= 6) rings.push(thin);
      }
    }
    return rings;
  };
  return { shore: offshore(0), offshore, deep };
}
