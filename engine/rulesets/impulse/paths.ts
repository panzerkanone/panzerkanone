/**
 * The least exposed path (spec 17): an exact search over (hex, cost spent).
 * For every hex and every cost up to the allowance it finds the fewest
 * exposed hexes a path can enter to stand there having spent exactly that
 * cost; a hex's least exposed path is then the one with the fewest exposed
 * hexes and, among those, the least cost. A shortest-first search on
 * exposure alone is not exact under an allowance (a less exposed way to an
 * early hex may cost too much to go on), which is why the cost is part of the
 * search state.
 *
 * Such a path never enters a hex twice (6.7): a path that did could drop the
 * loop and enter no more exposed hexes at a lower cost.
 *
 * Ties (bar M2a ruling 22): among paths equal in exposure and cost, the one
 * kept is the first found, the search taking costs in increasing order, at
 * each cost the hexes in the order they were first reached at that cost, and
 * from each hex the directions N, NE, SE, S, SW, NW; a later path replaces a
 * kept one only when it enters strictly fewer exposed hexes. The same position
 * always gives the same path.
 */
import type { CompiledBoard } from '../../core/board';

const INF = 0x7fff;

export class ExposureSearch {
  private readonly board: CompiledBoard;
  private bestE: Int16Array = new Int16Array(0);
  private pred: Int32Array = new Int32Array(0);
  private width = 0;
  private start = -1;
  private mover = -1;

  constructor(board: CompiledBoard) {
    this.board = board;
  }

  /**
   * Search from `start` for mover type `mover` (a board index) with
   * `allowance`, never entering a hex marked in `blocked`; `exposed[h]` is 1
   * where entering h counts as exposed.
   */
  run(mover: number, start: number, blocked: Uint8Array, exposed: Uint8Array, allowance: number): void {
    const n = this.board.n;
    const W = allowance + 1;
    const size = n * W;
    if (this.bestE.length < size) {
      this.bestE = new Int16Array(size);
      this.pred = new Int32Array(size);
    }
    this.bestE.fill(INF, 0, size);
    this.width = W;
    this.start = start;
    this.mover = mover;
    const buckets: number[][] = [];
    for (let c = 0; c < W; c++) buckets.push([]);
    const steps = this.board.stepCost[mover] as Int32Array;
    const nb = this.board.neighbour;
    const bestE = this.bestE;
    const pred = this.pred;
    bestE[start * W] = 0;
    pred[start * W] = -1;
    (buckets[0] as number[]).push(start);
    for (let c = 0; c < W; c++) {
      const list = buckets[c] as number[];
      for (let i = 0; i < list.length; i++) {
        const h = list[i] as number;
        const e = bestE[h * W + c] as number;
        const base = h * 6;
        for (let d = 0; d < 6; d++) {
          const step = steps[base + d] as number;
          if (step < 0) continue;
          const c2 = c + step;
          if (c2 >= W) continue;
          const to = nb[base + d] as number;
          if (blocked[to] === 1) continue;
          const e2 = e + (exposed[to] as number);
          const idx = to * W + c2;
          const old = bestE[idx] as number;
          if (e2 < old) {
            if (old === INF) (buckets[c2] as number[]).push(to);
            bestE[idx] = e2;
            pred[idx] = h;
          }
        }
      }
    }
  }

  /** The fewest exposed hexes and then the least cost of a path to h costing at most maxCost, or null. */
  best(h: number, maxCost: number): { exposure: number; cost: number } | null {
    const W = this.width;
    const top = Math.min(maxCost, W - 1);
    let be = INF;
    let bc = -1;
    for (let c = 1; c <= top; c++) {
      const e = this.bestE[h * W + c] as number;
      if (e < be) {
        be = e;
        bc = c;
      }
    }
    return bc < 0 ? null : { exposure: be, cost: bc };
  }

  /** The hexes entered by the kept path to h at exactly `cost` (the start left out). */
  route(h: number, cost: number): number[] {
    const W = this.width;
    const steps = this.board.stepCost[this.mover] as Int32Array;
    const nb = this.board.neighbour;
    const out: number[] = [];
    let cur = h;
    let c = cost;
    while (!(cur === this.start && c === 0)) {
      out.push(cur);
      const prev = this.pred[cur * W + c] as number;
      let step = -1;
      for (let d = 0; d < 6; d++) if (nb[prev * 6 + d] === cur) step = steps[prev * 6 + d] as number;
      if (prev < 0 || step < 0) throw new Error(`least exposed path: no way back from hex ${cur} at cost ${c}`);
      c -= step;
      cur = prev;
    }
    out.reverse();
    return out;
  }
}
