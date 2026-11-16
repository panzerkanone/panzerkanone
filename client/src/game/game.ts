/**
 * A game on a table: one or more seats' ports, the controller, the play-back
 * and the model, joined, with the table's pieces at the far end. No DOM and no
 * rendering here: a panel listens to the model (onModel), a board is whatever
 * implements PiecesPort.
 *
 *   port.updates ──► Playback ──► the view shown ──► Controller (offers, selection)
 *                        │                                │
 *                        └──────────► buildModel ◄────────┘
 *                                        │
 *                 panel (hud.ts) ◄───────┴───────► Table ──► PiecesPort
 *
 * The view shown runs behind the port's while steps play. Input is held until
 * it has caught up, so a person never acts on a position they have not seen;
 * then, if a local host is behind the port, it is told (caughtUp) and lets
 * its computer seat take one action, which is how the computer's play comes at
 * the display's pace.
 *
 * With two people's seats (hot-seat) the game shows the seat that must decide
 * and changes over when the decision does.
 */
import { Controller } from './controller';
import type { Hit } from './controller';
import type { ControlView, FlagModel, GameModel, Marks, Notes, PointModel, StageView, TintKind } from './model';
import { TINT_KINDS, buildModel, stockOf, unitsOnBoard } from './model';
import type { CounterSpec, PiecesPort, TableAnswer } from './pieces-port';
import type { Clock, Hands, Pace } from './playback';
import { Playback } from './playback';
import type { Answer, SeatPort } from './port';
import type { Position, Reading, Step } from './reading';

export interface GameDeps<V, A, E, Q> {
  readonly reading: Reading<V, A, E, Q>;
  /** The ports of the seats people play here, in order of play; none to watch. */
  readonly people: readonly SeatPort<V, A, E, Q>[];
  /** The spectator's port: what is shown when no person plays. */
  readonly spectator: SeatPort<V, A, E, Q>;
  /** The seats the computer plays (for the banner's words only). */
  readonly computer: readonly string[];
  readonly pieces: PiecesPort;
  readonly clock: Clock;
  readonly pace: Pace;
  readonly seed: number;
  /** The display has caught up with the game. A local host lets its computer seat act now. */
  readonly caughtUp?: () => void;
  /** "Play again" (the same seed) or "New seed" was asked for. */
  readonly restart?: (how: 'again' | 'reseed') => void;
  /** Each event as it finishes playing, and each action sent with its answer (for checks). */
  readonly played?: (event: E, step: Step) => void;
  readonly sent?: (action: A, answer: Answer) => void;
  /** A rejection or a fault: it is shown in the model too. */
  readonly report?: (message: string) => void;
  /**
   * Ask the board to take its view, eased, to where these hexes are all in it: when a group is gone to, when Tab steps
   * to something, when a unit is picked in a list. Absent: the board stays where it is, and nothing depends on it.
   */
  readonly goTo?: (hexes: readonly number[]) => void;
  /**
   * One line for the box of words' answer line from the start, until the first answer to something the player does
   * (start.ts: a kept battle that could not be brought back says so here).
   */
  readonly notice?: string;
}

/** The serial of the notice's answer: one no answer of the controller's has (they count from 1). */
const NOTICE_SERIAL = -3;

const NO_MARKS: Marks = { selected: false, canAct: false, spent: false, suppressed: false, target: false };
const MARK_KEYS: readonly (keyof Marks)[] = ['selected', 'canAct', 'spent', 'suppressed', 'target'];
const NO_NOTES: Notes = { group: '', active: false, carriedBy: null, revealed: false, pick: false, moved: false, close: false };
const NOTE_KEYS: readonly (keyof Notes)[] = ['group', 'active', 'carriedBy', 'revealed', 'pick', 'moved', 'close'];

/** The pieces as the game last left them, and the only caller of the PiecesPort. */
class Table implements Hands {
  private readonly pieces: PiecesPort;
  /** `noted`: the pieces have been told this counter's notes at least once since it was set up. */
  private readonly on = new Map<string, { hex: number; marks: Marks; notes: Notes; noted: boolean }>();
  private readonly flying = new Set<string>();
  /** Counters the play-back has moved to where the view shown does not yet say they are: left alone until it does, or until the action is played out. */
  private readonly ahead = new Set<string>();
  private readonly leaving = new Set<string>();
  private readonly where = new Map<string, string>();
  private readonly stacks = new Map<number, string[]>();
  /** Each hex's stack as the pieces have it, from the bottom: what they were told, in the order they were told it. */
  private readonly told = new Map<number, string[]>();
  private readonly tints = new Map<TintKind, string>();
  private lineKey = '';
  private threatKey = '';
  private routeKey = '';
  private markerKey = '';
  private pointKey = '';
  /** The nearer part of the reach, as the pieces were last told it. */
  private nearKey = '';
  private chanceKey = '';
  /** What the pieces were last told of the flag ('?': nothing yet). */
  private flagKey = '?';
  /** The roll as the pieces were last told it ('' none). */
  private diceKey = '';
  private closed = false;
  /** The pieces have been brought to a model of this game at least once. */
  private begun = false;

  /** The game's seed (the table seeds how its hulks and craters lie by it). */
  private readonly seed: number;

  constructor(pieces: PiecesPort, seed: number) {
    this.pieces = pieces;
    this.seed = seed;
  }

  /** A call (fire asked for from afar) has landed on a hex (`key` names it the same wherever the game is watched): the table may leave a crater there. */
  shelled(hex: number, key: string): void {
    if (this.closed) return;
    this.pieces.scar?.({ what: 'shelled', hex, key });
  }

  /** Something for the pieces to show at a place: a refusal, fire leaving and landing, a label for a thing done. */
  answer(a: TableAnswer): void {
    if (this.closed) return;
    this.pieces.answer?.(a);
  }

  /** What a click where the pointer is would do, for the pieces to show there (null: nothing). */
  point(p: PointModel | null): void {
    if (this.closed) return;
    const key = p === null ? '' : `${p.hex}|${p.unit ?? ''}|${p.act}|${p.can ? 1 : 0}|${p.words}`;
    if (key === this.pointKey) return;
    this.pointKey = key;
    this.pieces.intent?.(p === null ? null : { hex: p.hex, unit: p.unit, act: p.act, can: p.can, words: p.words });
  }

  /** Where a side's flag stands (null: none does): told to the pieces only when it has changed. */
  flag(f: FlagModel | null): void {
    if (this.closed) return;
    const key = f === null ? '' : `${f.side}|${f.stock}|${f.hexes.join(',')}`;
    if (key === this.flagKey) return;
    // Nothing is said of a flag that never stood.
    const first = this.flagKey === '?';
    this.flagKey = key;
    if (first && f === null) return;
    this.pieces.flag?.(f === null ? null : { side: f.side, stock: f.stock, hexes: f.hexes.slice() });
  }

  /** The counters of a hex from the bottom, as arranged. */
  stackOf(hex: number): readonly string[] {
    return this.stacks.get(hex) ?? [];
  }

  /** A new game on these pieces: nothing of the last one's tints and lines stays. */
  clear(): void {
    this.tints.clear();
    this.lineKey = '';
    this.threatKey = '';
    this.routeKey = '';
    this.markerKey = '';
    this.pointKey = '';
    this.nearKey = '';
    this.chanceKey = '';
    this.flagKey = '?';
    this.diceKey = '';
    this.pieces.dice?.(null);
    this.pieces.flag?.(null);
    this.pieces.intent?.(null);
    for (const kind of TINT_KINDS) this.pieces.tint(kind, []);
    this.pieces.reachNear?.([]);
    this.pieces.chances?.([]);
    this.pieces.lines('fire', []);
    this.pieces.threats?.([]);
    this.pieces.routes?.([]);
    this.pieces.markers?.([]);
    // Nor the hulks and craters the last one left.
    this.pieces.scar?.({ what: 'begin', seed: this.seed });
  }

  /** The game is over for this table: it touches the pieces no more (another game may have them now). */
  close(): void {
    this.closed = true;
  }

  /**
   * Each unit's place in its hex's stack: the order of arrival, units set up
   * together in the order given; a carried unit directly under its carrier. A
   * unit that gets onto a carrier, or down from one, arrives anew.
   */
  arrange(units: readonly { id: string; hex: number; carriedBy?: string | null }[]): ReadonlyMap<string, number> {
    const keyOf = (u: { hex: number; carriedBy?: string | null }): string => (u.carriedBy ? `${u.hex}/${u.carriedBy}` : String(u.hex));
    const now = new Map(units.map(u => [u.id, keyOf(u)]));
    for (const [id, key] of [...this.where]) {
      if (now.get(id) === key) continue;
      const hex = Number(key.split('/')[0]);
      const stack = this.stacks.get(hex);
      if (stack) {
        const at = stack.indexOf(id);
        if (at >= 0) stack.splice(at, 1);
        if (stack.length === 0) this.stacks.delete(hex);
      }
      this.where.delete(id);
    }
    for (const u of units) {
      if (this.where.has(u.id)) continue;
      const stack = this.stacks.get(u.hex);
      if (stack) stack.push(u.id);
      else this.stacks.set(u.hex, [u.id]);
      this.where.set(u.id, keyOf(u));
    }
    for (const u of units) {
      if (!u.carriedBy) continue;
      const stack = this.stacks.get(u.hex);
      if (!stack || !stack.includes(u.carriedBy)) continue;
      stack.splice(stack.indexOf(u.id), 1);
      stack.splice(stack.indexOf(u.carriedBy), 0, u.id);
    }
    const places = new Map<string, number>();
    for (const stack of this.stacks.values()) stack.forEach((id, i) => places.set(id, i));
    return places;
  }

  private lift(id: string): void {
    for (const [hex, stack] of this.told) {
      const at = stack.indexOf(id);
      if (at < 0) continue;
      stack.splice(at, 1);
      if (stack.length === 0) this.told.delete(hex);
    }
  }

  /** Tell the pieces to move a counter, and keep the stack they then have. */
  private send(id: string, hex: number, opts: { place?: number; path?: readonly number[] }): Promise<void> {
    this.lift(id);
    const stack = this.told.get(hex) ?? [];
    if (opts.place === undefined || opts.place >= stack.length) stack.push(id);
    else stack.splice(Math.max(0, opts.place), 0, id);
    this.told.set(hex, stack);
    return this.pieces.move(id, hex, opts);
  }

  /** Bring the pieces to the model: counters that came or went, a home that changed, marks, tints, lines. */
  sync(model: GameModel): void {
    if (this.closed) return;
    // A game that begins with no counter on the board (each side still to place its own) begins on a bare table:
    // whatever lay there before it (another game's counters, the table's own to play with) is taken off.
    if (!this.begun && model.counters.length === 0) this.pieces.setUp([]);
    this.begun = true;
    const want = new Map(model.counters.map(c => [c.id, c]));
    for (const id of [...this.leaving]) if (!want.has(id)) this.leaving.delete(id);
    if (model.counters.some(c => !this.on.has(c.id) && !this.leaving.has(c.id))) {
      const specs: CounterSpec[] = model.counters
        .filter(c => !this.leaving.has(c.id))
        .map(c => ({ id: c.id, side: c.side, hex: c.hex, place: c.place, face: c.face }));
      this.pieces.setUp(specs);
      this.on.clear();
      this.told.clear();
      this.ahead.clear();
      for (const c of [...specs].sort((a, b) => a.hex - b.hex || a.place - b.place)) {
        this.on.set(c.id, { hex: c.hex, marks: NO_MARKS, notes: NO_NOTES, noted: false });
        const stack = this.told.get(c.hex);
        if (stack) stack.push(c.id);
        else this.told.set(c.hex, [c.id]);
      }
    }
    for (const [id, was] of [...this.on]) {
      const c = want.get(id);
      if (!c) {
        this.on.delete(id);
        this.ahead.delete(id);
        this.lift(id);
        void this.pieces.remove(id, 'withdrawn').catch(() => undefined);
        continue;
      }
      if (c.hex === was.hex) {
        this.ahead.delete(id);
      } else if (!this.flying.has(id) && !this.ahead.has(id)) {
        was.hex = c.hex;
        void this.send(id, c.hex, { place: c.place }).catch(() => undefined);
      }
      const diff: { -readonly [K in keyof Marks]?: boolean } = {};
      let any = false;
      for (const k of MARK_KEYS) {
        if (c.marks[k] !== was.marks[k]) {
          diff[k] = c.marks[k];
          any = true;
        }
      }
      if (any) {
        this.pieces.mark(id, diff);
        was.marks = c.marks;
      }
      if (this.pieces.note && !was.noted) {
        // The first time, all of them: so that the pieces are told in so many words what a counter does not carry
        // (`group: ''`: no group's number is printed on it) and do not keep a default of their own.
        const n = c.notes;
        this.pieces.note(id, { group: n.group, active: n.active, carriedBy: n.carriedBy, revealed: n.revealed, pick: n.pick, moved: n.moved, close: n.close });
        was.notes = n;
        was.noted = true;
      } else if (this.pieces.note && NOTE_KEYS.some(k => c.notes[k] !== was.notes[k])) {
        const n = c.notes;
        const w = was.notes;
        this.pieces.note(id, {
          ...(n.group !== w.group ? { group: n.group } : {}), ...(n.active !== w.active ? { active: n.active } : {}),
          ...(n.carriedBy !== w.carriedBy ? { carriedBy: n.carriedBy } : {}), ...(n.revealed !== w.revealed ? { revealed: n.revealed } : {}),
          ...(n.pick !== w.pick ? { pick: n.pick } : {}), ...(n.moved !== w.moved ? { moved: n.moved } : {}),
          ...(n.close !== w.close ? { close: n.close } : {}),
        });
        was.notes = n;
      }
    }
    this.seat(model);
    for (const kind of TINT_KINDS) {
      const hexes = model.tints[kind];
      const key = hexes.join(',');
      if ((this.tints.get(kind) ?? '') === key) continue;
      this.tints.set(kind, key);
      this.pieces.tint(kind, hexes);
    }
    // The nearer part of the reach, after the reach itself: told when it changes, an empty list when the reach is put away.
    const nearKey = model.reachNear.join(',');
    if (nearKey !== this.nearKey) {
      this.nearKey = nearKey;
      this.pieces.reachNear?.(model.reachNear);
    }
    // The chance of every target a click would attack (chances.ts): told when it changes.
    const chanceKey = JSON.stringify(model.chances);
    if (chanceKey !== this.chanceKey) {
      this.chanceKey = chanceKey;
      this.pieces.chances?.(model.chances.map(c => ({ ...c })));
    }
    // Fire a move would draw has lines of its own when the pieces can draw them; else it joins the attack lines.
    const own = this.pieces.threats !== undefined;
    const lines = own ? model.lines : [...model.lines, ...model.threats.map(t => ({ from: t.from, to: t.to }))];
    const lineKey = lines.map(l => `${l.from}>${l.to}`).join(',');
    if (lineKey !== this.lineKey) {
      this.lineKey = lineKey;
      this.pieces.lines('fire', lines);
    }
    const threatKey = model.threats.map(t => `${t.from}>${t.to}:${t.label}:${t.live ? 1 : 0}`).join(',');
    if (own && threatKey !== this.threatKey) {
      this.threatKey = threatKey;
      this.pieces.threats?.(model.threats.map(t => ({ from: t.from, to: t.to, label: t.label, live: t.live })));
    }
    const routeKey = model.routes.map(r => r.join('-')).join(',');
    if (this.pieces.routes && routeKey !== this.routeKey) {
      this.routeKey = routeKey;
      this.pieces.routes(model.routes);
    }
    const markerKey = model.markers.map(m => `${m.hex}:${m.kind}:${m.label}:${m.side ?? ''}`).join(',');
    if (this.pieces.markers && markerKey !== this.markerKey) {
      this.markerKey = markerKey;
      this.pieces.markers(model.markers.map(m => ({ hex: m.hex, kind: m.kind, label: m.label, side: m.side })));
    }
    // The roll, each time it changes (pointed out, thrown, read): the table throws its dice.
    const d = model.dice;
    const diceKey = d === null ? '' : `${model.seed}|${d.serial}|${d.rolled ? 1 : 0}|${d.faces.join(',')}|${d.result ?? ''}`;
    if (this.pieces.dice && diceKey !== this.diceKey) {
      this.diceKey = diceKey;
      this.pieces.dice(d === null ? null : { serial: d.serial, seed: model.seed, faces: d.faces.slice(), sides: d.sides, rolled: d.rolled, result: d.result, fate: d.fate, stock: d.stock });
    }
  }

  /**
   * Bring a counter to the top of its hex's stack, where it is not there already: the unit just chosen, so that the
   * player sees which one it is. It rises and settles like every counter that is moved to its own hex (the pieces' `move`
   * with no place given is "on top"); the unit it carries goes first, and so lies directly under it there. A carried
   * unit is never raised by itself: it stays under its carrier.
   */
  raise(id: string): void {
    if (this.closed) return;
    const key = this.where.get(id);
    if (key === undefined || key.includes('/')) return;
    const hex = Number(key);
    const stack = this.stacks.get(hex);
    if (!stack || stack.length < 2 || stack[stack.length - 1] === id) return;
    const carried = stack.find(x => this.where.get(x) === `${hex}/${id}`);
    const going = carried === undefined ? [id] : [carried, id];
    if (going.some(x => !this.on.has(x) || this.flying.has(x) || this.ahead.has(x))) return;
    for (const x of going) {
      stack.splice(stack.indexOf(x), 1);
      stack.push(x);
      void this.send(x, hex, {}).catch(() => undefined);
    }
  }

  /** Where the pieces' stack in a hex is not in the model's order (a unit got under its carrier), put each counter in its place. */
  private seat(model: GameModel): void {
    const byHex = new Map<number, { id: string; place: number }[]>();
    for (const c of model.counters) {
      const list = byHex.get(c.hex);
      if (list) list.push({ id: c.id, place: c.place });
      else byHex.set(c.hex, [{ id: c.id, place: c.place }]);
    }
    for (const [hex, list] of byHex) {
      const wanted = list.sort((a, b) => a.place - b.place).map(x => x.id);
      const have = this.told.get(hex) ?? [];
      if (wanted.length !== have.length || wanted.every((id, i) => have[i] === id)) continue;
      if (wanted.some(id => !have.includes(id) || this.flying.has(id) || this.ahead.has(id))) continue;
      wanted.forEach((id, i) => {
        if ((this.told.get(hex) ?? [])[i] !== id) void this.send(id, hex, { place: i }).catch(() => undefined);
      });
    }
  }

  async travel(id: string, hex: number, path: readonly number[], under?: string): Promise<void> {
    const rec = this.on.get(id);
    if (!rec || this.closed) return;
    rec.hex = hex;
    this.flying.add(id);
    this.ahead.add(id);
    const below = under === undefined ? -1 : (this.told.get(hex) ?? []).filter(x => x !== id).indexOf(under);
    try {
      await this.send(id, hex, below >= 0 ? { path, place: below } : { path });
    } finally {
      this.flying.delete(id);
    }
  }

  async takeOff(id: string, how: 'destroyed' | 'withdrawn'): Promise<void> {
    if (this.closed || !this.on.delete(id)) return;
    this.leaving.add(id);
    this.ahead.delete(id);
    this.lift(id);
    await this.pieces.remove(id, how);
  }

  settle(): void {
    this.ahead.clear();
  }
}

export class Game<V, A, E, Q> {
  private readonly deps: GameDeps<V, A, E, Q>;
  private readonly reading: Reading<V, A, E, Q>;
  private readonly table: Table;
  private readonly controller: Controller<V, A, E, Q>;
  private readonly playback: Playback<V, A, E, Q>;
  private readonly listeners = new Set<(m: GameModel) => void>();
  private port: SeatPort<V, A, E, Q>;
  private stopUpdates: () => void = () => undefined;
  private stopClick: () => void = () => undefined;
  private stopHover: () => void = () => undefined;
  private sending: Promise<void> | null = null;
  private problem: string | null = null;
  private read: { view: V; position: Position } | null = null;
  private current: GameModel | null = null;
  private started = false;
  private disposed = false;
  /** The adding modifier (Shift, Ctrl or Cmd) is held, as the page last said. */
  private shiftDown = false;
  /** On another side's turn: the side whose flag stands, and the units of the group it stands among (it follows them as groups re-form). */
  private led: { side: string; units: readonly string[] } | null = null;
  /** The units chosen, as the last model had them: one that is newly among them is brought to the top of its stack. */
  private chosen: readonly string[] = [];
  /** The notice in the answer line, until the first answer (null: none, or gone). */
  private notice: string | null;

  constructor(deps: GameDeps<V, A, E, Q>) {
    this.deps = deps;
    this.notice = deps.notice !== undefined && deps.notice !== '' ? deps.notice : null;
    this.reading = deps.reading;
    this.port = deps.people[0] ?? deps.spectator;
    this.table = new Table(deps.pieces, deps.seed);
    this.playback = new Playback<V, A, E, Q>({
      reading: deps.reading,
      hands: this.table,
      clock: deps.clock,
      pace: deps.pace,
      changed: () => this.refresh(),
      watching: () => {
        const seat = this.port.seat;
        return seat === null || !this.position().deciding.includes(seat);
      },
      idle: () => this.caughtUp(),
      fault: message => this.fault(message),
      viewer: () => this.port.seat,
      ...(deps.played ? { played: deps.played } : {}),
    }, this.port.view(), this.port.seq());
    this.controller = new Controller<V, A, E, Q>(this.port, {
      reading: deps.reading,
      run: next => this.run(next, true),
      changed: () => this.refresh(),
      answer: a => this.table.answer(a),
      stack: hex => this.table.stackOf(hex),
      goTo: hexes => this.goTo(hexes),
      wait: ms => deps.clock.wait(ms),
    });
  }

  /** Show the game as it stands, listen to the table, and open the stream of updates. */
  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.stopClick = this.deps.pieces.onClick(hit => this.click(hit));
    this.stopHover = this.deps.pieces.onHover(hit => this.hover(hit));
    this.stopUpdates = this.port.updates(this.playback.seq + 1, u => this.playback.enqueue(u));
    this.table.clear();
    this.refresh();
    this.caughtUp();
  }

  dispose(): void {
    this.disposed = true;
    this.table.close();
    this.stopUpdates();
    this.stopClick();
    this.stopHover();
    this.listeners.clear();
  }

  /** The model as last made. */
  get model(): GameModel {
    if (!this.current) this.refresh();
    return this.current as GameModel;
  }

  /** Call `listener` with every new model (and with the present one at once). Returns a function that stops it. */
  onModel(listener: (m: GameModel) => void): () => void {
    this.listeners.add(listener);
    listener(this.model);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The seat being shown: null when watching. */
  get seat(): string | null {
    return this.port.seat;
  }

  /** Input is held: a step is playing or an action is on its way. */
  get held(): boolean {
    return this.sending !== null || this.playback.busy;
  }

  /**
   * Resolves when nothing is playing, nothing is on its way and no computer
   * seat is about to act: a person must decide, or the game is over.
   */
  async settled(): Promise<void> {
    for (;;) {
      if (this.sending) await this.sending;
      else if (this.playback.busy) await this.playback.idle();
      else return;
      // Let whatever the end of that started (a computer seat's next action) show itself.
      await Promise.resolve();
    }
  }

  // ---------------------------------------------------------------------------
  // input
  // ---------------------------------------------------------------------------

  /**
   * A plain click on the table; `shift`: made with the adding modifier held (left out: as the page last said by
   * `shift`). A click that can do nothing is answered too: while a step plays, that it is still being shown.
   */
  click(hit: Hit, shift?: boolean): void {
    if (this.disposed) return;
    this.controller.click(hit, shift ?? this.shiftDown);
  }

  /**
   * A unit picked in a list (a chip of the folder): as a plain click on its counter, and the board is asked to bring it
   * into view (it may be off the screen; a click on the board itself moves nothing, the unit being under the pointer).
   */
  pick(unit: string): void {
    if (this.disposed) return;
    const counters = this.model.counters;
    const c = counters.find(x => x.id === unit);
    if (!c) return;
    const stack = counters.filter(x => x.hex === c.hex).sort((a, b) => a.place - b.place).map(x => x.id);
    // (The unit named, and no other of its stack.)
    this.controller.click({ counter: c.id, hex: c.hex, stack, exact: true }, false);
    this.goTo([c.hex]);
  }

  private goTo(hexes: readonly number[]): void {
    if (this.disposed || hexes.length === 0) return;
    this.deps.goTo?.(hexes);
  }

  /** The adding modifier (Shift, Ctrl or Cmd: keys.ts) goes down or comes up: a click on one of the seat's units then adds it to those chosen, or takes it out. */
  shift(on: boolean): void {
    if (this.disposed || this.shiftDown === on) return;
    this.shiftDown = on;
    this.controller.shift(on);
  }

  hover(hit: { counter: string | null; hex: number }): void {
    if (this.disposed) return;
    this.controller.hover(hit);
  }

  /** A click in the panel on a unit waiting in the tray, or a press of a group's button (it goes to the group). */
  take(kind: 'unit' | 'group', id: string): void {
    if (this.disposed) return;
    this.controller.take(kind, id);
  }

  /**
   * A key. True when it is one of the game's (the page then keeps it from the
   * browser). The game's keys: Escape, Tab, Enter, E, N, F, the key printed
   * on each of the present controls, and in the fuller game the digits 1 to 9
   * (each goes to a group of the seat's units).
   */
  key(key: string, shift = false): boolean {
    if (this.disposed) return false;
    const k = key.length === 1 ? key.toLowerCase() : key;
    const over = this.position().stage === 'over';
    switch (k) {
      case 'Escape':
        this.controller.back();
        return true;
      case 'Tab':
        this.controller.next(shift ? -1 : 1);
        return true;
      case 'Enter':
        if (over) this.deps.restart?.('again');
        else this.controller.confirm();
        return true;
      case 'e':
        this.controller.end();
        return true;
      case 'n':
        if (over) this.deps.restart?.('reseed');
        else this.controller.dealAgain();
        return true;
      case 'f':
        this.press('fast');
        return true;
      default:
        return this.controller.key(k);
    }
  }

  /** A control of the panel, by its id in the model. */
  press(id: string): void {
    if (this.disposed) return;
    if (id === 'fast') {
      this.deps.pace.fast = !this.deps.pace.fast;
      this.refresh();
    } else if (id === 'again' || id === 'reseed') {
      this.deps.restart?.(id);
    } else {
      this.controller.press(id);
    }
  }

  // ---------------------------------------------------------------------------
  // the loop
  // ---------------------------------------------------------------------------

  private position(): Position {
    const view = this.playback.shown;
    if (!this.read || this.read.view !== view) this.read = { view, position: this.reading.position(view) };
    return this.read.position;
  }

  private fault(message: string): void {
    this.problem = message;
    this.deps.report?.(message);
  }

  /**
   * Send the actions `next` gives, one at a time, each accepted and shown before the next is asked for. `asked`: the
   * person asked for them (the controller's), so what came of each is the answer to what they did.
   */
  private run(next: () => A | null, asked: boolean): void {
    if (this.sending || this.disposed) return;
    const work = async (): Promise<void> => {
      try {
        for (;;) {
          await this.playback.idle();
          this.refresh();
          const action = next();
          if (action === null) break;
          const answer = await this.port.submit(action);
          this.deps.sent?.(action, answer);
          if (!answer.ok) {
            // A rejection is a fault of the controller: say so, and go on.
            this.fault(`The host refused an action (${answer.code}): ${answer.detail}`);
            break;
          }
          this.problem = null;
          await this.playback.reached(answer.seq);
          if (asked) this.controller.outcome(this.playback.outcomeOf(answer.seq));
        }
      } catch (err) {
        this.fault(`An action could not be sent: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        this.sending = null;
      }
      this.caughtUp();
    };
    this.sending = work();
    this.refresh();
  }

  /** The display shows the game as it is: open input, change seats if the decision has, and let a local host go on. */
  private caughtUp(): void {
    if (this.disposed || !this.started || this.held) return;
    this.follow();
    // The host first: if a computer seat acts now, the model made next says input is still held.
    this.deps.caughtUp?.();
    this.refresh();
    // An action of the seat shown that carries no choice and must come first is sent for it.
    if (this.held) return;
    const forced = this.controller.forced();
    if (forced === null) return;
    let sent = false;
    this.run(() => {
      if (sent) return null;
      sent = true;
      return forced;
    }, false);
  }

  /** Hot-seat: show the seat that must decide. */
  private follow(): void {
    if (this.deps.people.length < 2) return;
    const deciding = this.position().deciding;
    if (this.port.seat !== null && deciding.includes(this.port.seat)) return;
    const next = this.deps.people.find(p => p.seat !== null && deciding.includes(p.seat));
    if (!next || next === this.port) return;
    this.stopUpdates();
    this.port = next;
    this.controller.setPort(next);
    this.playback.look(next.view());
    this.stopUpdates = next.updates(this.playback.seq + 1, u => this.playback.enqueue(u));
  }

  /**
   * Where a side's flag stands. On the turn of the seat shown: among the group in hand, when there is one. On another
   * side's turn: among the group that holds the unit of that side whose action is being shown (or was last shown), so
   * that the eye is led to where the action is; it stays with that group, as it re-forms, until the action is another
   * group's. None before anything is in hand or has acted, in a set-up, and when the game is over.
   */
  private flagOf(position: Position, control: ControlView, stage: StageView): FlagModel | null {
    const groups = position.groups ?? [];
    const seat = this.port.seat;
    const yours = seat !== null && position.deciding.includes(seat);
    const side = yours ? seat : position.deciding[0] ?? null;
    if (position.stage !== 'play' || side === null) {
      this.led = null;
      return null;
    }
    let units: readonly string[] | null = null;
    if (yours) {
      this.led = null;
      units = groups.find(g => g.id === (control.hand ?? null))?.units ?? null;
    } else {
      // Nothing of this side has been shown acting since its turn began: no flag stands yet.
      if ((this.led && this.led.side !== side) || (stage.acting ?? []).length === 0) this.led = null;
      const mine = (id: string): boolean => position.units.some(u => u.id === id && u.seat === side && !u.destroyed);
      const actor = (stage.acting ?? []).find(mine);
      let group = actor === undefined ? undefined : groups.find(g => g.seat === side && g.units.includes(actor));
      if (!group && this.led) {
        // The unit that acted is gone, or nothing is being shown: the group that holds most of the units the flag stood among.
        const was = this.led.units;
        let most = 0;
        for (const g of groups) {
          const held = g.seat === side ? g.units.filter(u => was.includes(u)).length : 0;
          if (held > most) {
            most = held;
            group = g;
          }
        }
      }
      this.led = group ? { side, units: group.units } : null;
      units = group?.units ?? null;
    }
    const stock = stockOf(this.reading.info, side);
    if (units === null || stock === null) return null;
    const hexes = [...new Set(units.map(id => position.units.find(u => u.id === id)?.hex ?? -1).filter(h => h >= 0))].sort((a, b) => a - b);
    return hexes.length > 0 ? { side, stock, hexes } : null;
  }

  private refresh(): void {
    if (this.disposed) return;
    const view = this.playback.shown;
    const current = !this.playback.busy;
    this.controller.show(view, current, this.sending === null);
    const position = this.position();
    let control = this.controller.view();
    // The notice holds the answer line until the player's first answer takes its place.
    if (this.notice !== null) {
      if (control.answer) this.notice = null;
      else control = { ...control, answer: { serial: NOTICE_SERIAL, kind: 'done', text: this.notice } };
    }
    const stage = this.playback.stage();
    const flag = this.flagOf(position, control, stage);
    // A unit that has just been chosen (or added to those chosen) is shown on top of its stack: in the order chosen, so
    // that the last one added is the uppermost.
    if (position.stage === 'play') for (const id of control.selected) if (!this.chosen.includes(id)) this.table.raise(id);
    this.chosen = control.selected;
    const places = this.table.arrange(unitsOnBoard(position, control.proposal));
    const model = buildModel({
      info: this.reading.info,
      seed: this.deps.seed,
      viewer: this.port.seat,
      computer: this.deps.computer,
      position,
      places,
      control,
      stage,
      flag,
      held: this.held,
      fast: this.deps.pace.fast,
      problem: this.problem,
      ending: position.stage === 'over' ? this.reading.endingWords(view) : '',
      people: this.deps.people.length,
    });
    this.current = model;
    this.table.sync(model);
    // What a click would do is pointed out only while nothing is being played.
    this.table.point(this.playback.busy ? null : control.point ?? null);
    this.table.flag(flag);
    for (const l of [...this.listeners]) l(model);
  }
}
