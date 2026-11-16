/**
 * Path search over a compiled board: a whole-board flood from one hex for one
 * mover type, recording the cheapest cost to every hex and the step it came
 * from, so a route to any reached hex can be read back.
 *
 * The flood is Dijkstra's search with a bucket queue (step costs are whole
 * numbers from 1 to the board's dearest step), so every cost is the exact
 * optimum. Ties are broken the same way every time: the same flood gives the
 * same route.
 *
 *   const search = new PathSearch(board);
 *   const f = search.flood(moverIndex, start, blocked);   // blocked: 1 = may not be entered
 *   f.cost[h]                                             // -1 when not reached
 *   routeTo(f, target)                                    // [start, ..., target] or null
 *
 * A PathSearch keeps its scratch space between floods; a flood result is
 * written into a fresh FloodResult unless one is passed in to reuse.
 */
import type { HexId } from './hex';
import type { CompiledBoard } from './board';

export interface FloodResult {
  start: HexId;
  mover: number;
  /** Cheapest cost from the start to each hex; -1 when not reached. */
  readonly cost: Int32Array;
  /** The hex each cheapest route comes from; -1 for the start and for hexes not reached. */
  readonly from: Int32Array;
}

export function newFloodResult(n: number): FloodResult {
  return { start: -1, mover: -1, cost: new Int32Array(n), from: new Int32Array(n) };
}

export class PathSearch {
  readonly board: CompiledBoard;
  private readonly head: Int32Array;
  private readonly entryNode: Int32Array;
  private readonly entryNext: Int32Array;

  constructor(board: CompiledBoard) {
    this.board = board;
    const most = Math.max(...board.maxStep);
    this.head = new Int32Array(most + 1);
    // One entry for the start and at most one per successful relaxation (six per hex).
    this.entryNode = new Int32Array(board.n * 6 + 1);
    this.entryNext = new Int32Array(board.n * 6 + 1);
  }

  /**
   * Flood from `start` for mover type `mover` (an index into board.moverTypes).
   * Hexes marked 1 in `blocked` are never entered (the start itself may be
   * marked). Routes dearer than `limit` are not followed.
   */
  flood(mover: number, start: HexId, blocked: Uint8Array | null = null, limit = Number.MAX_SAFE_INTEGER, out?: FloodResult): FloodResult {
    const board = this.board;
    const steps = board.stepCost[mover];
    if (steps === undefined) throw new Error(`path: unknown mover index ${mover}`);
    if (!board.has(start)) throw new Error(`path: start ${start} is not a hex of board ${board.id}`);
    const res = out ?? newFloodResult(board.n);
    res.start = start;
    res.mover = mover;
    const cost = res.cost;
    const from = res.from;
    cost.fill(-1);
    from.fill(-1);
    const buckets = (board.maxStep[mover] as number) + 1;
    const head = this.head;
    head.fill(-1, 0, buckets);
    const node = this.entryNode;
    const next = this.entryNext;
    const nb = board.neighbour;

    let used: number;
    node[0] = start;
    next[0] = -1;
    head[0] = 0;
    used = 1;
    cost[start] = 0;
    let pending = 1;
    for (let d = 0; pending > 0; d++) {
      const b = d % buckets;
      let e = head[b] as number;
      head[b] = -1;
      while (e >= 0) {
        pending--;
        const h = node[e] as number;
        e = next[e] as number;
        if (cost[h] !== d) continue;              // a dearer entry left behind by a later improvement
        const base = h * 6;
        for (let k = 0; k < 6; k++) {
          const step = steps[base + k] as number;
          if (step < 0) continue;
          const to = nb[base + k] as number;
          if (blocked !== null && blocked[to] === 1) continue;
          const c = d + step;
          if (c > limit) continue;
          const old = cost[to] as number;
          if (old >= 0 && old <= c) continue;
          cost[to] = c;
          from[to] = h;
          const slot = c % buckets;
          node[used] = to;
          next[used] = head[slot] as number;
          head[slot] = used;
          used++;
          pending++;
        }
      }
    }
    return res;
  }
}

/** The route from the flood's start to `target`, both included, or null when it was not reached. */
export function routeTo(f: FloodResult, target: HexId): HexId[] | null {
  if (target < 0 || target >= f.cost.length || (f.cost[target] as number) < 0) return null;
  const out: HexId[] = [];
  let h = target;
  while (h >= 0) {
    out.push(h);
    if (h === f.start) break;
    h = f.from[h] as number;
  }
  out.reverse();
  return out;
}
