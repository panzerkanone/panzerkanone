/**
 * What a hex sees, by distance: a cache over the board's own sight answers
 * (board.sees), filled one hex at a time on first use. It walks no sight line
 * of its own (bar M2a ruling 21): every answer is the board's. Smoke is not
 * here: callers filter by it, through board.seesPast, where a smoke hex lies
 * between the two ends.
 */
import type { CompiledBoard } from '../../core/board';
import { distance } from '../../core/hex';

export class SeenCache {
  private readonly board: CompiledBoard;
  /** Per hex: the hexes it sees (itself left out), nearest first. */
  private readonly lists: (Int32Array | undefined)[];
  /** Per hex: ends[d] is how many of its list are within distance d. */
  private readonly ends: (Int32Array | undefined)[];

  constructor(board: CompiledBoard) {
    this.board = board;
    this.lists = new Array<Int32Array | undefined>(board.n);
    this.ends = new Array<Int32Array | undefined>(board.n);
  }

  private fill(a: number): void {
    const g = this.board.grid;
    const byDist: number[][] = [];
    for (let b = 0; b < this.board.n; b++) {
      if (b === a || !this.board.sees(a, b)) continue;
      const d = distance(g, a, b);
      (byDist[d] ??= []).push(b);
    }
    const list: number[] = [];
    const ends = new Int32Array(byDist.length + 1);
    for (let d = 0; d < byDist.length; d++) {
      for (const b of byDist[d] ?? []) list.push(b);
      ends[d] = list.length;
    }
    ends[byDist.length] = list.length;
    this.lists[a] = Int32Array.from(list);
    this.ends[a] = ends;
  }

  /** The hexes `a` sees within distance `d` (without smoke), nearest first. */
  within(a: number, d: number): Int32Array {
    let list = this.lists[a];
    if (list === undefined) {
      this.fill(a);
      list = this.lists[a] as Int32Array;
    }
    const ends = this.ends[a] as Int32Array;
    const k = d >= ends.length ? (ends[ends.length - 1] as number) : d < 0 ? 0 : (ends[d] as number);
    return list.subarray(0, k);
  }
}
