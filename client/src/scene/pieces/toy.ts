/**
 * The pieces' own toy: the default user of the table (port.ts). It lays out a
 * set-up from a data file and gives plain clicks their first meaning: click a
 * counter to select it (the top of a stack; the same stack again steps down
 * through it), click another hex to send it there, Escape to let go. There are
 * no rules yet, so every hex is a legal destination. When a game takes the
 * clicks (`onClick`), all of this stands aside.
 *
 * No browser; the page hands in the set-up's text.
 */
import type { ClickHit, DefaultUser, Pieces } from './pieces';
import type { CounterFace, CounterSpec } from './port';

export interface ToyUnit {
  side: string;
  title: string;
  kind: string;
  ap: number;
  he: number;
  range: number;
  defence: number;
  move: number;
  rides: boolean;
  carries: number;
}

export interface ToySetup {
  board: { cols: number; rows: number };
  sides: Record<string, { stock: 'first' | 'second' }>;
  units: Record<string, ToyUnit>;
  /** Each stack from the bottom. A transport that carries names the unit lying under it. */
  stacks: { hex: string; units: { unit: string; carries: string | null }[] }[];
}

/** A counter of the toy: a counter of the port, and the unit type it is. */
export interface ToyCounter extends CounterSpec {
  unit: string;
  /** The id of the counter this one carries (it lies directly under it), or null. */
  carrying: string | null;
}

function fail(what: string): never {
  throw new Error(`pieces set-up: ${what}`);
}

function record(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(`${what} must be an object`);
  return v as Record<string, unknown>;
}

function whole(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) fail(`${what} must be a whole number, 0 or more`);
  return v;
}

function text(v: unknown, what: string): string {
  if (typeof v !== 'string' || v === '') fail(`${what} must be text`);
  return v;
}

/** Read a set-up file. Every field must be there and of its kind: nothing is filled in. */
export function parseSetup(source: string): ToySetup {
  const root = record(JSON.parse(source), 'the file');
  if (root.format !== 'pieces-setup/1') fail(`format is ${String(root.format)}, not pieces-setup/1`);
  const board = record(root.board, 'board');
  const sides: ToySetup['sides'] = {};
  for (const [name, v] of Object.entries(record(root.sides, 'sides'))) {
    const stock = record(v, `side ${name}`).stock;
    if (stock !== 'first' && stock !== 'second') fail(`side ${name}: stock must be first or second`);
    sides[name] = { stock };
  }
  const units: ToySetup['units'] = {};
  for (const [id, v] of Object.entries(record(root.units, 'units'))) {
    const u = record(v, `unit ${id}`);
    const side = text(u.side, `unit ${id}: side`);
    if (!sides[side]) fail(`unit ${id}: no side ${side}`);
    if (typeof u.rides !== 'boolean') fail(`unit ${id}: rides must be true or false`);
    units[id] = {
      side,
      title: text(u.title, `unit ${id}: title`),
      kind: text(u.kind, `unit ${id}: kind`),
      ap: whole(u.ap, `unit ${id}: ap`),
      he: whole(u.he, `unit ${id}: he`),
      range: whole(u.range, `unit ${id}: range`),
      defence: whole(u.defence, `unit ${id}: defence`),
      move: whole(u.move, `unit ${id}: move`),
      rides: u.rides,
      carries: whole(u.carries, `unit ${id}: carries`),
    };
  }
  if (!Array.isArray(root.stacks)) fail('stacks must be a list');
  const seen = new Set<string>();
  const stacks = (root.stacks as unknown[]).map((v, k) => {
    const s = record(v, `stack ${k}`);
    const hex = text(s.hex, `stack ${k}: hex`);
    if (!/^\d{4}$/.test(hex)) fail(`stack ${k}: hex ${hex} is not four digits`);
    if (seen.has(hex)) fail(`two stacks are in hex ${hex}`);
    seen.add(hex);
    if (!Array.isArray(s.units) || s.units.length === 0) fail(`stack in ${hex}: units must be a list of at least one`);
    const list = (s.units as unknown[]).map((entry, place) => {
      const named = typeof entry === 'string' ? { unit: entry, carries: null } : { unit: text(record(entry, `stack in ${hex}, place ${place}`).unit, `stack in ${hex}, place ${place}: unit`), carries: text((entry as Record<string, unknown>).carries, `stack in ${hex}, place ${place}: carries`) };
      const unit = units[named.unit];
      if (!unit) fail(`stack in ${hex}: no unit ${named.unit}`);
      return named;
    });
    list.forEach((entry, place) => {
      if (entry.carries === null) return;
      const under = list[place - 1];
      const carrier = units[entry.unit] as ToyUnit;
      if (carrier.carries < 1) fail(`stack in ${hex}: ${entry.unit} carries nothing`);
      if (!under || under.unit !== entry.carries) fail(`stack in ${hex}: ${entry.unit} carries ${entry.carries}, which must lie directly under it`);
      if (!(units[under.unit] as ToyUnit).rides) fail(`stack in ${hex}: ${under.unit} does not ride`);
    });
    return { hex, units: list };
  });
  return { board: { cols: whole(board.cols, 'board: cols'), rows: whole(board.rows, 'board: rows') }, sides, units, stacks };
}

/** The placeholder face of a unit: its title, its kind, the numbers that mean something for it, and (when its type is named) the type whose picture it carries. */
export function faceOf(unit: ToyUnit, stock: 'first' | 'second', art?: string): CounterFace {
  const numbers: CounterFace['numbers'] = { defence: String(unit.defence), move: String(unit.move) };
  if (unit.ap > 0 || unit.he > 0) {
    numbers.attack = `${unit.ap}/${unit.he}`;
    numbers.range = String(unit.range);
  }
  return art === undefined ? { stock, title: unit.title, kind: unit.kind, numbers } : { stock, title: unit.title, kind: unit.kind, numbers, art };
}

/**
 * The counters of a set-up. `hexOfLabel` is the hex module's reading of a
 * printed label (-1 off the board): a set-up that names a hex the board does
 * not have is an error.
 */
export function countersOf(setup: ToySetup, hexOfLabel: (label: string) => number): ToyCounter[] {
  const out: ToyCounter[] = [];
  const made = new Map<string, number>();
  for (const stack of setup.stacks) {
    const hex = hexOfLabel(stack.hex);
    if (hex < 0) fail(`hex ${stack.hex} is not on this board`);
    stack.units.forEach((entry, place) => {
      const unit = setup.units[entry.unit] as ToyUnit;
      const k = (made.get(entry.unit) ?? 0) + 1;
      made.set(entry.unit, k);
      const side = setup.sides[unit.side] as { stock: 'first' | 'second' };
      const under = out[out.length - 1];
      out.push({
        id: `${entry.unit}-${k}`,
        unit: entry.unit,
        side: unit.side,
        hex,
        place,
        face: faceOf(unit, side.stock, entry.unit),
        carrying: entry.carries !== null && under ? under.id : null,
      });
    });
  }
  return out;
}

/** The toy's select-and-order: the table's default user. */
export class Toy implements DefaultUser {
  selected: string | null = null;
  private readonly table: Pieces;
  private readonly counters: readonly ToyCounter[];

  constructor(table: Pieces, counters: readonly ToyCounter[]) {
    this.table = table;
    this.counters = counters;
    table.setUp(counters);
    table.setDefaultUser(this);
  }

  /** Let go of the selection. */
  clear(): void {
    if (this.selected !== null && this.table.has(this.selected)) this.table.mark(this.selected, { selected: false });
    this.selected = null;
    this.table.tint('path', []);
  }

  select(id: string | null): void {
    if (id === this.selected) return;
    this.clear();
    if (id === null) return;
    this.selected = id;
    this.table.mark(id, { selected: true });
  }

  /** The counter a click on a stack takes: its top, or, when the selection is in that stack, the next one down (null below the bottom). */
  private wouldTake(hit: { counter: string | null; hex: number }): string | null {
    if (hit.counter === null) return null;
    const top = this.table.get(hit.counter);
    const sel = this.selected !== null && this.table.has(this.selected) ? this.table.get(this.selected) : null;
    if (!sel || sel.home.hex !== hit.hex || top.state === 'loose' || sel.state === 'loose') return hit.counter;
    const stack = this.table.stackAt(hit.hex);
    const under = stack[sel.home.place - 1];
    return under ? under.id : null;
  }

  click(hit: ClickHit): void {
    const sel = this.selected !== null && this.table.has(this.selected) ? this.table.get(this.selected) : null;
    if (!sel || sel.off) {
      this.selected = null;
      this.select(hit.counter);
      return;
    }
    // On the stack the selection is in: step down through it, and past the bottom let go.
    if (hit.counter !== null && hit.hex === sel.home.hex) {
      this.select(hit.counter === sel.id && this.table.get(hit.counter).state === 'loose' ? null : this.wouldTake(hit));
      return;
    }
    // Anywhere else on the board: the selected counter goes there, onto whatever is at home in that hex.
    if (hit.hex >= 0) {
      if (hit.hex !== sel.home.hex) void this.table.move(sel.id, hit.hex);
      this.table.tint('path', []);
      return;
    }
    // Off the board: let go.
    this.clear();
  }

  hover(hit: { counter: string | null; hex: number }): void {
    const sel = this.selected !== null && this.table.has(this.selected) ? this.table.get(this.selected) : null;
    if (!sel || sel.off) {
      this.table.setHover(hit.counter);
      return;
    }
    if (hit.counter !== null && hit.hex === sel.home.hex) {
      this.table.setHover(this.wouldTake(hit));
      this.table.tint('path', []);
      return;
    }
    // With a counter selected a click sends it: show the hex it would go to.
    this.table.setHover(null);
    this.table.tint('path', hit.hex >= 0 && hit.hex !== sel.home.hex ? [hit.hex] : []);
  }

  key(code: string): boolean {
    if (code === 'Escape') {
      this.clear();
      return true;
    }
    if (code === 'KeyR') {
      this.reset();
      return true;
    }
    return false;
  }

  /** R: the whole set-up back to its first homes. */
  reset(): void {
    this.clear();
    this.table.resetHomes();
  }

  /** Lay the set-up out afresh, at once (no easing): for a board that has been changed under it. */
  again(): void {
    this.selected = null;
    this.table.setUp(this.counters);
  }
}
