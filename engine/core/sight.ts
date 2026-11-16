/**
 * Line of sight between two hexes: the procedure written down in
 * docs/rules/line-of-sight-cases.md, section 2, with the lead's rulings of
 * 2026-11-11 (reading (a) on all five open points).
 *
 *   1. A hex sees itself and its six neighbours.
 *   2. Otherwise take the steps S0..Sn of lineOf(A, B) (n = the distance; a
 *      step holds one hex, or two where the line runs along their hexside; a
 *      half that is off the board is left out, and the on-board hex decides).
 *   3. The line's height at step i is h(i) = level(A) + (level(B) - level(A)) * i / n.
 *   4. A hex's height is its level, plus one if its cover adds a level.
 *   5. A hex X at step i (0 < i < n) stands above the line when height(X) > h(i).
 *      Equal is not above. The end hexes are never tested.
 *   6. The crest rule applies when it is switched on and both ends are level ground.
 *   7. A path takes one hex from each step, in order. Two consecutive hexes of
 *      a path are neighbours and the path crosses the hexside between them.
 *   8. A path is blocked when one of its in-between hexes stands above the
 *      line or, when the crest rule applies, it crosses a hill line (a hilltop
 *      crest, a ridge crest or a separator).
 *   9. A sees B when at least one path is not blocked.
 *  10. Tree sides (the lead's provisional ruling of 2026-11-11, from the owner's "trees ... have
 *      green hex sides that indicate los barriers ... rules are very similar to slopes"). A tree
 *      side is a hexside with trees on it, one level high above the ground it stands on (the
 *      higher of the two hexes it lies between). A path that crosses a tree side is blocked when
 *      the trees stand above the line where it crosses, midway between the two steps: with the
 *      crossing between steps i - 1 and i, when ground + 1 > h(i - 1/2). Equal is not above. So
 *      between two hexes on level ground every tree side crossed blocks, a side of either end
 *      hex included; from a hilltop a tree side in the nearer half of the line is seen over, and
 *      one in the farther half blocks. A line that runs along a tree side does not cross it. A
 *      tree side adds nothing to the height of the hexes it lies between: a tree hex does not
 *      block as a hex.
 *
 * Units never block sight. A ruleset may lay smoke over the same steps: a
 * hex it names as blocked counts, at any step between the ends, exactly as a
 * hex that stands above the line does (so a two-hex step is blocked only when
 * both its hexes are, by height or by smoke, and a hex at either end never
 * blocks). Heights are compared in whole numbers: height(X) * n > level(A) * n
 * + (level(B) - level(A)) * i, and for a tree side (ground + 1) * 2n >
 * level(A) * 2n + (level(B) - level(A)) * (2i - 1), so no rounding enters.
 *
 * The hill lines are taken as given (deriveHillLines in hillLines.ts); this
 * module never derives them.
 */
import { Grid, HexId, directionTo, distance, hexCount, lineOf, neighbourOf, opposite } from './hex';

export interface SightInputs {
  readonly grid: Grid;
  /** Elevation level of every hex (0 level ground, 2 hilltop), indexed by hex number. */
  readonly level: ArrayLike<number>;
  /** Sight height of every hex: its level plus one if its cover adds a level. */
  readonly height: ArrayLike<number>;
  /** Every hexside that is a hill line: hilltop crests, ridge crests and separators. */
  readonly hillLines: readonly (readonly [HexId, HexId])[];
  /** Whether the crest rule is switched on. */
  readonly crestRule: boolean;
  /** Every hexside that is a tree side, as a hex and one of its six directions. Left out: none. */
  readonly treeSides?: readonly (readonly [HexId, number])[];
}

/** The inputs laid out for fast lookups. */
export interface SightContext {
  readonly grid: Grid;
  readonly n: number;
  readonly level: Uint8Array;
  readonly height: Uint8Array;
  /** neighbour[h * 6 + d]: the neighbour of h in direction d, or -1. */
  readonly neighbour: Int32Array;
  /** hill[h * 6 + d] = 1 when the hexside of h in direction d is a hill line. */
  readonly hill: Uint8Array;
  readonly crestRule: boolean;
  /** tree[h * 6 + d] = 1 when the hexside of h in direction d is a tree side. */
  readonly tree: Uint8Array;
}

export function sightContext(inp: SightInputs): SightContext {
  const g = inp.grid;
  const n = hexCount(g);
  const level = new Uint8Array(n);
  const height = new Uint8Array(n);
  const neighbour = new Int32Array(n * 6);
  const hill = new Uint8Array(n * 6);
  for (let h = 0; h < n; h++) {
    const lv = inp.level[h];
    const ht = inp.height[h];
    if (lv === undefined || ht === undefined) throw new Error(`sight: no level or height for hex ${h}`);
    level[h] = lv;
    height[h] = ht;
    for (let d = 0; d < 6; d++) neighbour[h * 6 + d] = neighbourOf(g, h, d);
  }
  for (const [x, y] of inp.hillLines) {
    const d = directionTo(g, x, y);
    if (d < 0) throw new Error(`sight: hill line between hexes ${x} and ${y}, which are not neighbours`);
    hill[x * 6 + d] = 1;
    hill[y * 6 + opposite(d)] = 1;
  }
  const tree = new Uint8Array(n * 6);
  for (const [x, d] of inp.treeSides ?? []) {
    if (!Number.isInteger(x) || x < 0 || x >= n || !Number.isInteger(d) || d < 0 || d >= 6) throw new Error(`sight: tree side of hex ${x} in direction ${d}, which is no side of the board`);
    tree[x * 6 + d] = 1;
    // A side on the board's own edge has no hex beyond it, and no line crosses it.
    const y = neighbour[x * 6 + d] as number;
    if (y >= 0) tree[y * 6 + opposite(d)] = 1;
  }
  return { grid: g, n, level, height, neighbour, hill, crestRule: inp.crestRule, tree };
}

/**
 * True when a path may go from hex y to hex x: they are neighbours; when the
 * crest rule applies, the hexside between them is not a hill line; and if it
 * is a tree side, its trees do not stand above the line there. `twoN` is twice
 * the line's length in steps and `crossing` the line's height where it crosses
 * that hexside, times `twoN`.
 */
function linked(ctx: SightContext, y: HexId, x: HexId, crest: boolean, twoN: number, crossing: number): boolean {
  const base = y * 6;
  for (let d = 0; d < 6; d++) {
    if (ctx.neighbour[base + d] !== x) continue;
    if (crest && ctx.hill[base + d] === 1) return false;
    if (ctx.tree[base + d] === 1) {
      const ground = Math.max(ctx.level[y] as number, ctx.level[x] as number);
      if ((ground + 1) * twoN > crossing) return false;
    }
    return true;
  }
  return false;
}

function adjacentOrSame(ctx: SightContext, a: HexId, b: HexId): boolean {
  if (a === b) return true;
  const base = a * 6;
  for (let d = 0; d < 6; d++) if (ctx.neighbour[base + d] === b) return true;
  return false;
}

/**
 * Whether a sees b, by the procedure, from lineOf(a, b). `blocked`, when
 * given, names further hexes that block wherever the line passes through them
 * (smoke): see the note at the top.
 */
export function sightBetween(ctx: SightContext, a: HexId, b: HexId, blocked?: (h: HexId) => boolean): boolean {
  if (adjacentOrSame(ctx, a, b)) return true;
  const steps = lineOf(ctx.grid, a, b);
  const n = steps.length - 1;
  if (n !== distance(ctx.grid, a, b)) {
    // lineOf drops a step only when both its hexes are off the board, which a
    // line between two hexes of a rectangular board never does.
    throw new Error(`sight: lineOf gave ${steps.length} steps between hexes ${a} and ${b}, ${distance(ctx.grid, a, b)} apart`);
  }
  const la = ctx.level[a] as number;
  const lb = ctx.level[b] as number;
  const crest = ctx.crestRule && la === 0 && lb === 0;
  // The hexes of the current step that an unblocked path reaches (at most two).
  let p0: HexId = a;
  let p1: HexId = -1;
  for (let i = 1; i < n; i++) {
    const step = steps[i] as HexId[];
    const lineTimesN = la * n + (lb - la) * i;
    // The line's height where it passes from step i - 1 to step i, times 2n.
    const crossing = la * 2 * n + (lb - la) * (2 * i - 1);
    let c0: HexId = -1;
    let c1: HexId = -1;
    for (let k = 0; k < step.length; k++) {
      const x = step[k] as HexId;
      if ((ctx.height[x] as number) * n > lineTimesN) continue;
      if (blocked !== undefined && blocked(x)) continue;
      if (linked(ctx, p0, x, crest, 2 * n, crossing) || (p1 >= 0 && linked(ctx, p1, x, crest, 2 * n, crossing))) {
        if (c0 < 0) c0 = x;
        else c1 = x;
      }
    }
    if (c0 < 0) return false;
    p0 = c0;
    p1 = c1;
  }
  const last = la * 2 * n + (lb - la) * (2 * n - 1);
  return linked(ctx, p0, b, crest, 2 * n, last) || (p1 >= 0 && linked(ctx, p1, b, crest, 2 * n, last));
}

/**
 * Sight between every pair of hexes, as a bit table: bit (a * n + b) is set
 * when a sees b. By default it is filled for all pairs at compile time on
 * boards of up to ALL_PAIRS_LIMIT hexes (the standard 33 x 21 board, 693
 * hexes, takes about 0.15 s), and one row at a time, on the first query from a
 * hex, above that: all pairs of a 45 x 27 board (1,215 hexes) take about
 * 0.5 s, of a 64 x 64 board about 9 s, and the work grows faster than the
 * square of the hex count. Both ways give the same answers (the procedure is
 * the same; a row reuses the answers of rows already filled, sight being
 * mutual). `allPairs` overrides the default.
 */
export const ALL_PAIRS_LIMIT = 1024;

export class SightTable {
  readonly n: number;
  /** True when every pair was filled at construction; false when rows are filled on first use. */
  readonly allPairs: boolean;
  private readonly ctx: SightContext;
  private readonly bits: Uint32Array;
  private readonly rowDone: Uint8Array;

  constructor(ctx: SightContext, allPairs: boolean = ctx.n <= ALL_PAIRS_LIMIT) {
    this.ctx = ctx;
    const n = ctx.n;
    this.n = n;
    this.allPairs = allPairs;
    this.bits = new Uint32Array(Math.ceil((n * n) / 32));
    this.rowDone = new Uint8Array(n);
    if (allPairs) {
      for (let a = 0; a < n; a++) {
        this.set(a, a);
        for (let b = a + 1; b < n; b++) {
          if (sightBetween(ctx, a, b)) {
            this.set(a, b);
            this.set(b, a);
          }
        }
      }
      this.rowDone.fill(1);
    }
  }

  private set(a: HexId, b: HexId): void {
    const i = a * this.n + b;
    this.bits[i >>> 5] = (this.bits[i >>> 5] as number) | (1 << (i & 31));
  }

  private get(a: HexId, b: HexId): boolean {
    const i = a * this.n + b;
    return ((this.bits[i >>> 5] as number) & (1 << (i & 31))) !== 0;
  }

  private fillRow(a: HexId): void {
    for (let b = 0; b < this.n; b++) {
      const seen = this.rowDone[b] === 1 ? this.get(b, a) : sightBetween(this.ctx, a, b);
      if (seen) this.set(a, b);
    }
    this.rowDone[a] = 1;
  }

  /** Whether a sees b. Both must be hexes of the board. */
  sees(a: HexId, b: HexId): boolean {
    if (!this.allPairs && this.rowDone[a] !== 1) this.fillRow(a);
    return this.get(a, b);
  }

  /**
   * Whether a sees b when the hexes `blocked` names also block (smoke). What
   * is not seen without smoke is not seen with it, so the table answers first;
   * the rest is worked from the lower hex number to the higher, whichever way
   * it was asked, so that sight stays mutual.
   */
  seesPast(a: HexId, b: HexId, blocked: (h: HexId) => boolean): boolean {
    if (!this.sees(a, b)) return false;
    return a <= b ? sightBetween(this.ctx, a, b, blocked) : sightBetween(this.ctx, b, a, blocked);
  }
}
