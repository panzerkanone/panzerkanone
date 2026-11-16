/**
 * What the marks hear of a game, and what they lay from it: plain arithmetic on the port's calls, no browser and no
 * drawing (index.ts joins this to the view and the table).
 *
 *   scar({ what: 'begin', seed })        a game starts on the table: every mark goes; the game's seed seeds them all
 *   setUp(counters), move(id, hex)       where each counter is, and its kind of unit (its face's `kind`)
 *   remove(id, 'destroyed')              once the counter has gone (its removal has ended), a hulk where it was
 *   scar({ what: 'shelled', hex, key })  a fire mission has landed: a crater a moment later (its blast comes first)
 *
 * Every other member of the port passes through untouched, those the marks never heard of too.
 */
import type { PiecesPort } from '../pieces/port';
import type { MarkOptions, MarkPicture, MarksModel } from './model';

/** What the game says to the table of what the battle leaves (the port's optional `scar`). */
export type Scar = { what: 'begin'; seed: number } | { what: 'shelled'; hex: number; key: string };

export class MarksListener {
  readonly model: MarksModel;
  private readonly pictures: readonly MarkPicture[];
  /** The table's clock, in seconds. */
  private readonly clock: () => number;
  /** Something changed that wants a frame. */
  private readonly wake: () => void;
  seed: number | null = null;
  /** How far each kind is shown (0 to 1), eased toward its option by `step`. */
  readonly shown: { hulks: number; craters: number };
  /** The clock at the last `step`. */
  now = 0;
  /** Each counter's hex and kind of unit, as the game last set them. */
  private readonly counters = new Map<string, { hex: number; kind: string }>();
  /** Craters waiting for their moment. */
  private readonly due: { hex: number; key: string; at: number }[] = [];

  constructor(model: MarksModel, pictures: readonly MarkPicture[], options: MarkOptions, clock: () => number, wake: () => void) {
    this.model = model;
    this.pictures = pictures;
    this.clock = clock;
    this.wake = wake;
    model.options = { ...options };
    this.shown = { hulks: options.hulks ? 1 : 0, craters: options.craters ? 1 : 0 };
  }

  private lay(what: Parameters<MarksModel['lay']>[0], hex: number): void {
    if (hex < 0 || this.seed === null) return;
    if (this.model.lay(what, hex, this.clock())) this.wake();
  }

  scar(s: Scar): void {
    if (s.what === 'begin') {
      this.seed = s.seed;
      this.model.begin(s.seed);
      this.due.length = 0;
    } else this.due.push({ hex: s.hex, key: s.key, at: this.clock() + this.model.table.ease.craterAfter });
    this.wake();
  }

  /** Switch a kind on or off: its marks ease out, or back in. */
  set(options: Partial<MarkOptions>): void {
    this.model.options = { ...this.model.options, ...options };
    this.wake();
  }

  /** For checks and pictures: lay this picture on this hex now, as a game's would be laid. */
  place(picture: string, hex: number, key: string): boolean {
    const kind = this.pictures.find(p => p.id === picture)?.kind;
    if (!kind || this.seed === null) return false;
    const laid = this.model.lay(kind === 'hulk' ? { kind, unit: key, unitKind: '', picture } : { kind, name: key, picture }, hex, this.clock());
    this.wake();
    return laid !== null;
  }

  /** The counters' port with the marks listening. */
  port<P extends PiecesPort>(real: P): P {
    const own = new Map<PropertyKey, unknown>([
      ['scar', (s: Scar) => this.scar(s)],
      ['setUp', (list: Parameters<PiecesPort['setUp']>[0]) => {
        this.counters.clear();
        for (const c of list) this.counters.set(c.id, { hex: c.hex, kind: c.face.kind });
        return real.setUp(list);
      }],
      ['move', (id: string, hex: number, opts?: Parameters<PiecesPort['move']>[2]) => {
        const c = this.counters.get(id);
        if (c) c.hex = hex;
        return real.move(id, hex, opts);
      }],
      ['remove', (id: string, how: 'destroyed' | 'withdrawn') => {
        const c = this.counters.get(id);
        this.counters.delete(id);
        const done = real.remove(id, how);
        if (how === 'destroyed' && c) void done.then(() => this.lay({ kind: 'hulk', unit: id, unitKind: c.kind }, c.hex), () => undefined);
        return done;
      }],
    ]);
    // One function a member, for as long as the real one is the same (`port.tint === port.tint` holds here as there).
    const bound = new Map<PropertyKey, { real: unknown; fn: unknown }>();
    return new Proxy(real, {
      get(target, prop) {
        if (own.has(prop)) return own.get(prop);
        const v = Reflect.get(target, prop, target) as unknown;
        if (typeof v !== 'function') return v;
        let b = bound.get(prop);
        if (!b || b.real !== v) {
          b = { real: v, fn: (v as (...a: unknown[]) => unknown).bind(target) };
          bound.set(prop, b);
        }
        return b.fn;
      },
      has(target, prop) {
        return own.has(prop) || Reflect.has(target, prop);
      },
    });
  }

  /** One pass of the table's loop: craters due are laid, each kind eases toward its option. True while anything is still to come or still easing. */
  step(): boolean {
    const before = this.now;
    this.now = this.clock();
    const dt = Math.min(0.1, Math.max(0, this.now - before));
    for (let i = this.due.length - 1; i >= 0; i--) {
      const d = this.due[i] as { hex: number; key: string; at: number };
      if (d.at > this.now) continue;
      this.due.splice(i, 1);
      this.lay({ kind: 'crater', name: d.key }, d.hex);
    }
    const rate = 1 / this.model.table.ease.switchSeconds;
    let easing = false;
    for (const k of ['hulks', 'craters'] as const) {
      const want = this.model.options[k] ? 1 : 0;
      const was = this.shown[k];
      if (was === want) continue;
      this.shown[k] = want > was ? Math.min(want, was + rate * dt) : Math.max(want, was - rate * dt);
      easing = true;
    }
    if (this.model.marks.some(m => this.now - m.born < this.model.table.ease.seconds)) easing = true;
    return this.due.length > 0 || easing;
  }
}
