/**
 * The fire table (7.5, 7.6, 7.7): dice plus the column against two
 * thresholds, counted exactly over every dice value, and the one routine
 * that resolves an attack. Every attack of the game (fire, a reaction shot,
 * an assault, each attack of a fire mission) goes through resolveAttack, with
 * a Roller that either rolls the match's dice (apply) or walks every way the
 * dice can fall (the exact outcomes and the search interface): so the
 * distribution and the resolution are one code.
 */
import type { Dice } from '../../kernel/ruleset';
import type { Effect } from './types';

export interface TableData {
  readonly count: number;
  readonly faces: number;
  readonly suppress: number;
  readonly destroy: number;
}

/** The ways (of `total`) each effect of an attack can happen. */
export interface EffectWays {
  readonly none: number;
  readonly suppressed: number;
  readonly destroyed: number;
}

export class FireTable {
  readonly count: number;
  readonly faces: number;
  readonly suppress: number;
  readonly destroy: number;
  /** faces ** count: the dice values one roll can take. */
  readonly total: number;
  readonly minSum: number;
  readonly maxSum: number;
  /** atLeastBySum[s - minSum]: the ways the sum is s or more. */
  private readonly atLeastBySum: number[];
  /** For each sum, one sequence of faces that gives it (for the events of an enumerated branch). */
  private readonly facesOfSum: number[][];

  constructor(d: TableData) {
    this.count = d.count;
    this.faces = d.faces;
    this.suppress = d.suppress;
    this.destroy = d.destroy;
    this.total = d.faces ** d.count;
    this.minSum = d.count;
    this.maxSum = d.count * d.faces;
    const ways = new Array<number>(this.maxSum - this.minSum + 1).fill(0);
    const facesOf: number[][] = new Array<number[]>(this.maxSum - this.minSum + 1);
    for (let v = 0; v < this.total; v++) {
      let x = v;
      let sum = 0;
      const fs: number[] = [];
      for (let k = 0; k < d.count; k++) {
        const face = (x % d.faces) + 1;
        fs.push(face);
        sum += face;
        x = Math.floor(x / d.faces);
      }
      ways[sum - this.minSum] = (ways[sum - this.minSum] as number) + 1;
      if (facesOf[sum - this.minSum] === undefined) facesOf[sum - this.minSum] = fs;
    }
    this.atLeastBySum = new Array<number>(ways.length).fill(0);
    let acc = 0;
    for (let i = ways.length - 1; i >= 0; i--) {
      acc += ways[i] as number;
      this.atLeastBySum[i] = acc;
    }
    this.facesOfSum = facesOf;
  }

  /** The ways the dice sum to t or more. */
  atLeast(t: number): number {
    if (t <= this.minSum) return this.total;
    if (t > this.maxSum) return 0;
    return this.atLeastBySum[t - this.minSum] as number;
  }

  /** The ways a column has any effect on a target that is not Suppressed (a Suppressed result or better). */
  effectWays(column: number): number {
    return this.atLeast(this.suppress - column);
  }

  /** The ways a column destroys a target that is not Suppressed. */
  destroyWays(column: number): number {
    return this.atLeast(this.destroy - column);
  }

  /** Whether any roll suppresses (7.6). */
  canSuppress(column: number): boolean {
    return this.atLeast(this.suppress - column) > 0;
  }

  /** The ways of each effect of an attack at a column, on a target Suppressed or not (7.7). */
  ways(column: number, targetSuppressed: boolean): EffectWays {
    const hit = this.atLeast(this.suppress - column);
    const des = this.atLeast(this.destroy - column);
    if (targetSuppressed) return { none: this.total - hit, suppressed: 0, destroyed: hit };
    return { none: this.total - hit, suppressed: hit - des, destroyed: des };
  }

  /** The table's result for a sum at a column, before 7.7. */
  resultOfSum(sum: number, column: number): Effect {
    if (sum + column >= this.destroy) return 'destroyed';
    if (sum + column >= this.suppress) return 'suppressed';
    return 'none';
  }

  /** One sequence of faces that gives an effect at a column (for an enumerated branch's events). */
  facesFor(column: number, effect: Effect, targetSuppressed: boolean): number[] {
    for (let s = this.minSum; s <= this.maxSum; s++) {
      let r = this.resultOfSum(s, column);
      if (targetSuppressed && r === 'suppressed') r = 'destroyed';
      if (r === effect) return (this.facesOfSum[s - this.minSum] as number[]).slice();
    }
    throw new Error(`fire table: no roll gives ${effect} at column ${column}`);
  }
}

/** One attack resolved: its effect, and the roll numbers and faces it used (none when it was not rolled). */
export interface Resolved {
  readonly effect: Effect;
  readonly rolls: number[];
  readonly dice: number[];
}

/**
 * Who answers an attack that must be rolled. `next` is the number of the
 * next roll; rolling moves it on by the table's dice count.
 */
export interface Roller {
  roll(table: FireTable, column: number, targetSuppressed: boolean, ways: EffectWays): Resolved;
}

/** The match's dice: roll k is asked of the dice source, for every die of the roll. */
export class DiceRoller implements Roller {
  private readonly dice: Dice;
  next: number;

  constructor(dice: Dice, next: number) {
    this.dice = dice;
    this.next = next;
  }

  roll(table: FireTable, column: number, targetSuppressed: boolean): Resolved {
    const rolls: number[] = [];
    const faces: number[] = [];
    let sum = 0;
    for (let k = 0; k < table.count; k++) {
      const n = this.next++;
      const face = this.dice.roll(n, table.faces);
      rolls.push(n);
      faces.push(face);
      sum += face;
    }
    let effect = table.resultOfSum(sum, column);
    if (targetSuppressed && effect === 'suppressed') effect = 'destroyed';
    return { effect, rolls, dice: faces };
  }
}

/**
 * The one routine for an attack (7.6, 7.7): an attack that cannot suppress on
 * any roll is no effect, and an attack whose effect is the same on every roll
 * is that effect, neither asking a die; any other is rolled once. The caller
 * has already refused an attack that cannot suppress where that is illegal
 * (fire, assault) and never plans a reaction shot that cannot.
 */
export function resolveAttack(table: FireTable, roller: Roller, column: number, targetSuppressed: boolean): Resolved {
  const w = table.ways(column, targetSuppressed);
  if (w.none === table.total) return { effect: 'none', rolls: [], dice: [] };
  if (w.suppressed === table.total) return { effect: 'suppressed', rolls: [], dice: [] };
  if (w.destroyed === table.total) return { effect: 'destroyed', rolls: [], dice: [] };
  return roller.roll(table, column, targetSuppressed, w);
}

/** Whether an attack is rolled at all (7.6). */
export function isRolled(table: FireTable, column: number, targetSuppressed: boolean): boolean {
  const w = table.ways(column, targetSuppressed);
  return w.none !== table.total && w.suppressed !== table.total && w.destroyed !== table.total;
}

/**
 * Walks every way the dice can fall. A run asks it for attacks; at each it
 * answers the effect the current script names (the first effect that can
 * happen, when the script is exhausted), and remembers how many ways that
 * effect has. After a run, advance() moves the script to the next run.
 */
export class BranchRoller implements Roller {
  next: number;
  private readonly start: number;
  /** For each attack asked in this run: the effects that can happen, with their ways, and which one was chosen. */
  private readonly path: { options: [Effect, number][]; chosen: number }[] = [];
  private depth = 0;

  constructor(next: number) {
    this.next = next;
    this.start = next;
  }

  /** Begin a run (the script is kept). */
  reset(): void {
    this.next = this.start;
    this.depth = 0;
  }

  roll(table: FireTable, column: number, targetSuppressed: boolean, w: EffectWays): Resolved {
    let node = this.path[this.depth];
    if (node === undefined) {
      const options: [Effect, number][] = [];
      if (w.none > 0) options.push(['none', w.none]);
      if (w.suppressed > 0) options.push(['suppressed', w.suppressed]);
      if (w.destroyed > 0) options.push(['destroyed', w.destroyed]);
      node = { options, chosen: 0 };
      this.path.push(node);
    }
    this.depth++;
    const [effect] = node.options[node.chosen] as [Effect, number];
    const rolls: number[] = [];
    for (let k = 0; k < table.count; k++) rolls.push(this.next++);
    return { effect, rolls, dice: table.facesFor(column, effect, targetSuppressed) };
  }

  /** The ways of this run's choices (a product of whole numbers, kept as a number and as an exact big integer), and how many rolled attacks it took. */
  weight(): { ways: number; big: bigint | null; attacks: number } {
    let ways = 1;
    for (let i = 0; i < this.depth; i++) {
      const n = this.path[i] as { options: [Effect, number][]; chosen: number };
      ways *= (n.options[n.chosen] as [Effect, number])[1];
    }
    if (Number.isSafeInteger(ways)) return { ways, big: null, attacks: this.depth };
    let big = 1n;
    for (let i = 0; i < this.depth; i++) {
      const n = this.path[i] as { options: [Effect, number][]; chosen: number };
      big *= BigInt((n.options[n.chosen] as [Effect, number])[1]);
    }
    return { ways, big, attacks: this.depth };
  }

  /** Move to the next run; false when every run has been made. */
  advance(): boolean {
    this.path.length = this.depth;
    while (this.path.length > 0) {
      const last = this.path[this.path.length - 1] as { options: [Effect, number][]; chosen: number };
      if (last.chosen + 1 < last.options.length) {
        last.chosen++;
        return true;
      }
      this.path.pop();
    }
    return false;
  }
}

/**
 * Put a weighted set of runs over one denominator, a power of the dice faces
 * (`of` = faces ** m): a run of fewer rolled attacks counts once for every
 * value of the dice it did not ask for; common factors of the faces are then
 * taken out while every count shares them. Exact in whole numbers while they
 * fit; in big integers beyond.
 */
export function normalise(runs: readonly { ways: number; big: bigint | null; attacks: number }[], table: FireTable): { ways: number; of: number; p: number }[] {
  let depth = 0;
  for (const r of runs) if (r.attacks > depth) depth = r.attacks;
  const of0 = table.total ** depth;
  if (Number.isSafeInteger(of0) && runs.every(r => r.big === null)) {
    const ways = runs.map(r => r.ways * table.total ** (depth - r.attacks));
    let of = of0;
    const f = table.faces;
    while (of > 1 && ways.every(w => w % f === 0)) {
      of /= f;
      for (let i = 0; i < ways.length; i++) ways[i] = (ways[i] as number) / f;
    }
    return ways.map(w => ({ ways: w, of, p: w / of }));
  }
  const total = BigInt(table.total);
  const faces = BigInt(table.faces);
  let of = total ** BigInt(depth);
  const ways = runs.map(r => (r.big ?? BigInt(r.ways)) * total ** BigInt(depth - r.attacks));
  while (of > 1n && ways.every(w => w % faces === 0n)) {
    of /= faces;
    for (let i = 0; i < ways.length; i++) ways[i] = (ways[i] as bigint) / faces;
  }
  const ofN = Number(of);
  return ways.map(w => ({ ways: Number(w), of: ofN, p: Number(w) / ofN }));
}
