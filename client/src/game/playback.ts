/**
 * Play-back: the events a seat may see, shown in order, each to its end
 * before the next begins. It takes the port's updates as they come, reads
 * each event into a step (reading.ts) and plays the step through the table's
 * pieces and the model:
 *
 *   a move          the counter travels its path, which is tinted while it does; where fire
 *                   falls on it on the way it stops at that hex, the shot is played there,
 *                   and it goes on if it can
 *   an attack       its lines and its target alone are shown; then the dice;
 *                   then the result in words; then the removal or the mark, with whatever
 *                   else the attack did (the events it absorbs); then units that go in after
 *   strikes         several throws at one hex one after another, each as an attack; a unit
 *                   that drives through is in the hex while they are thrown and comes out after
 *   boarding        the unit travels to its carrier
 *   a removal       the counter is taken off
 *   a phase change  the banner changes and holds a moment
 *   a score         the score changes and holds a moment
 *   anything else   the board and the panel are brought to the view after it
 *
 * Whatever is played is also answered on the table (the pieces' `answer`): fire
 * leaving a counter when an attack is shown and landing when its result is, the
 * computer's and fire drawn by a move as much as the viewer's own; and a short
 * label at the place of anything else the reading gives one for (a step's
 * `badges`).
 *
 * After every step the view shown becomes the seat's view just after that
 * event (the update carries it), so nothing here works out what an event did.
 *
 * Every wait is a setting (Pace). When the seat watching is not the one to
 * decide next, a pause follows each update that showed something, so the other
 * side's actions come at a pace a person can read. `fast` shortens every wait.
 */
import type { DiceModel, LogLine, Segment, StageView, Stock, ThreatModel } from './model';
import { isPaused, unpaused } from './pause';
import { percentOf, sideNameOf, stockOf } from './model';
import type { TableAnswer } from './pieces-port';
import type { Seen, Update } from './port';
import type { Badge, Figure, Hold, Position, Reading, Say, Step } from './reading';

/** Waits, in milliseconds. */
export interface Pace {
  /** Between two actions of a side the viewer is watching (about a third of a second). */
  gapMs: number;
  /** A new phase holds on the banner. */
  phaseMs: number;
  /** A new turn of a side holds a little longer. */
  turnMs: number;
  /** An attack: its lines are shown before the dice. */
  aimMs: number;
  /** The dice are shown before the result. */
  diceMs: number;
  /** The result holds before the next step. */
  resultMs: number;
  /** A score holds. */
  scoreMs: number;
  /** Both sides come onto the board. */
  revealMs: number;
  /** The fast switch: every wait is multiplied by `fastFactor`. */
  fast: boolean;
  fastFactor: number;
}

export const DEFAULT_PACE: Readonly<Pace> = {
  gapMs: 330, phaseMs: 650, turnMs: 900, aimMs: 450, diceMs: 750, resultMs: 700, scoreMs: 500, revealMs: 600, fast: false, fastFactor: 0.1,
};

export interface Clock {
  /** Resolves after about `ms` milliseconds; at once (still asynchronously) for 0. */
  wait(ms: number): Promise<void>;
}

/** The pieces, as the play-back moves them. */
export interface Hands {
  /** Move a counter to a hex by the hexes of `path` (which ends at it); `under`: a counter it goes directly under. */
  travel(id: string, hex: number, path: readonly number[], under?: string): Promise<void>;
  takeOff(id: string, how: 'destroyed' | 'withdrawn'): Promise<void>;
  /** An action has been played to its end: every counter belongs where the view says again. */
  settle(): void;
  /** Something for the table to show at a place: fire leaving and landing, a label for a thing done. */
  answer(a: TableAnswer): void;
  /** A call (fire asked for from afar) has landed on a hex (`key`: who called it, the turn and the hex): the table may leave a crater there. */
  shelled?(hex: number, key: string): void;
}

export interface PlaybackDeps<V, A, E, Q> {
  readonly reading: Reading<V, A, E, Q>;
  readonly hands: Hands;
  readonly clock: Clock;
  readonly pace: Pace;
  /** The view shown, or what the stage shows, has changed. */
  changed(): void;
  /** True when a reading pause should follow what was just shown: the viewer is not the one to decide next. */
  watching(): boolean;
  /** Nothing is left to play. */
  idle(): void;
  /** Each event as it finishes playing (for checks). */
  played?(event: E, step: Step): void;
  /** A step that failed to play (a fault of the pieces): the board is still brought to the view after it. */
  fault(message: string): void;
  /** The seat whose view is shown (null: a watcher's): news is good or bad from where it sits. Absent: all news is plain. */
  viewer?(): string | null;
}

const LOG_KEPT = 400;
/** How many updates' outcomes are kept for whoever asks what came of an action. */
const OUTCOMES_KEPT = 8;

/** A unit on its way along a path on which fire falls: where it has got to, and what is still to come. */
interface Journey {
  readonly unit: string;
  readonly path: readonly number[];
  /** The place in the path it has reached (-1: still where it set out from). */
  at: number;
  /** The hex its counter is in now. */
  hex: number;
  /** How many attacks on it are still to be played. */
  left: number;
  /** Where it stands in the end, when that is not the end of the path. */
  readonly to: number | undefined;
  readonly with: readonly string[];
  /** The move's own step: its labels that wait for the unit to come to rest (a badge that is `late`) are shown when the journey ends. */
  readonly step: Step;
}

/** The units a step that shows an action is about: those that act, then what it is done to. None for a step that is no unit's action. */
function unitsOf(step: Step): string[] {
  switch (step.kind) {
    case 'moved':
    case 'held':
      return [step.unit];
    case 'declared':
      return [step.unit, step.target];
    case 'attack':
      return [...step.attackers, step.target];
    case 'strikes':
      return [...step.attackers];
    case 'boarded':
      return [step.unit, step.carrier];
    default:
      return [];
  }
}

export class Playback<V, A, E, Q> {
  private readonly deps: PlaybackDeps<V, A, E, Q>;
  private readonly queue: Update<V, E>[] = [];
  private running = false;
  private view: V;
  private at: number;
  private waiters: { seq: number | null; resolve: () => void }[] = [];

  private focus: StageView['focus'] = null;
  /** The chance printed beside each line of an attack while it is made (live fire). */
  private threats: ThreatModel[] = [];
  private path: readonly number[] = [];
  private dice: DiceModel | null = null;
  private rolls = 0;
  private log: LogLine[] = [];
  private now = '';
  /** The units the step being shown is about (those that act first), or the step last shown that was about any; none since the turn passed to another side. */
  private acting: readonly string[] = [];
  private lines = 0;
  private readonly holders = new Map<number, string>();
  private journey: Journey | null = null;
  /** What the update being played has said: its first line, and in a few words each attack shown after that. */
  private heard: { first: string | null; later: string[] } = { first: null, later: [] };
  private readonly outcomes = new Map<number, string>();

  constructor(deps: PlaybackDeps<V, A, E, Q>, view: V, seq: number) {
    this.deps = deps;
    this.view = view;
    this.at = seq;
  }

  /** The view shown now. */
  get shown(): V {
    return this.view;
  }

  /** The number of the last update played to its end. */
  get seq(): number {
    return this.at;
  }

  get busy(): boolean {
    return this.running || this.queue.length > 0;
  }

  /** Another seat's view of the same moment takes the place of the one shown (hot-seat). */
  look(view: V): void {
    this.view = view;
  }

  stage(): StageView {
    return { focus: this.focus, path: this.path, dice: this.dice, log: this.log, now: this.now, holders: this.holders, threats: this.threats, acting: this.acting };
  }

  enqueue(update: Update<V, E>): void {
    if (update.seq <= this.at || this.queue.some(u => u.seq === update.seq)) return;
    this.queue.push(update);
    void this.run();
  }

  /** Resolves when nothing is playing or waiting to be played. */
  idle(): Promise<void> {
    if (!this.busy) return Promise.resolve();
    return new Promise(resolve => this.waiters.push({ seq: null, resolve }));
  }

  /** Resolves when update `seq` has been played to its end. */
  reached(seq: number): Promise<void> {
    if (this.at >= seq) return Promise.resolve();
    return new Promise(resolve => this.waiters.push({ seq, resolve }));
  }

  private wake(): void {
    const idle = !this.busy;
    const still: typeof this.waiters = [];
    for (const w of this.waiters) {
      if (w.seq === null ? idle : this.at >= w.seq) w.resolve();
      else still.push(w);
    }
    this.waiters = still;
  }

  private wait(ms: number): Promise<void> {
    const pace = this.deps.pace;
    // While the page is paused (pause.ts: the settings lie over the game) the showing holds here, and the wait starts after.
    if (isPaused()) return unpaused().then(() => this.deps.clock.wait(pace.fast ? ms * pace.fastFactor : ms));
    return this.deps.clock.wait(pace.fast ? ms * pace.fastFactor : ms);
  }

  private hold(hold: Hold | undefined): Promise<void> {
    const pace = this.deps.pace;
    if (hold === undefined) return Promise.resolve();
    return this.wait(hold === 'phase' ? pace.phaseMs : hold === 'turn' ? pace.turnMs : hold === 'score' ? pace.scoreMs : hold === 'reveal' ? pace.revealMs : pace.resultMs);
  }

  /**
   * What came of update `seq`, in a line: what its first event said, and the result of each attack shown after it
   * ("... moves 1409 to 1410, cost 2. Fire drawn: suppressed."). '' when it said nothing, or is no longer kept.
   */
  outcomeOf(seq: number): string {
    return this.outcomes.get(seq) ?? '';
  }

  /** News for one side, as the viewer takes it. */
  private tone(seat: string | null | undefined, news: 'good' | 'bad' | undefined): 'good' | 'bad' | 'plain' {
    const viewer = this.deps.viewer?.() ?? null;
    if (news === undefined || seat === null || seat === undefined || viewer === null) return 'plain';
    if (seat === viewer) return news;
    return news === 'good' ? 'bad' : 'good';
  }

  /**
   * A step's labels, shown on the table; not those about a unit in `covered` (the result of the attack on it says it
   * already). `when`: all of them, or only those that do not wait for the unit to come to rest ('early'), or only
   * those that do ('late').
   */
  private badges(step: Step, covered: readonly string[] = [], when: 'all' | 'early' | 'late' = 'all'): void {
    for (const b of step.badges ?? []) {
      const badge: Badge = b;
      if (badge.hex < 0 || (badge.unit !== null && covered.includes(badge.unit))) continue;
      if (when !== 'all' && (badge.late === true) !== (when === 'late')) continue;
      this.deps.hands.answer({ kind: 'badge', hex: badge.hex, unit: badge.unit, words: badge.words, tone: this.tone(badge.seat, badge.news) });
    }
  }

  /** The result of an attack on a unit, landing: good news for the viewer when it hurts the other side, bad when it hurts the viewer's own. */
  private landed(from: number, to: number, by: string, on: string | null, fate: 'destroyed' | 'marked' | 'none', words: string): void {
    if (to < 0) return;
    const seat = on === null ? null : this.deps.reading.info.units.find(u => u.id === on)?.seat ?? null;
    this.deps.hands.answer({
      kind: 'landed', from, to, by, on, result: fate === 'destroyed' ? 'destroyed' : fate === 'marked' ? 'suppressed' : 'none', words,
      tone: fate === 'none' ? 'plain' : this.tone(seat, 'bad'),
    });
  }

  private say(say: Say | null): void {
    if (!say) return;
    if (this.heard.first === null) this.heard.first = say.text;
    this.now = say.text;
    this.lines += 1;
    const next = [...this.log, { n: this.lines, seat: say.seat, stock: stockOf(this.deps.reading.info, say.seat), text: say.text }];
    this.log = next.length > LOG_KEPT ? next.slice(next.length - LOG_KEPT) : next;
  }

  private show(view: V): void {
    this.view = view;
    this.deps.changed();
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    // Never play inside the call that brought the update: whoever sent it finishes first.
    await Promise.resolve();
    try {
      for (;;) {
        const update = this.queue.shift();
        if (!update) break;
        let showed = false;
        this.heard = { first: null, later: [] };
        const decidingBefore = this.deps.reading.position(this.view).deciding.join(',');
        for (let k = 0; k < update.events.length; k++) {
          const seen = update.events[k] as Seen<V, E>;
          const rest = update.events.slice(k + 1);
          const step = this.deps.reading.step(seen.event, this.view, rest.map(s => s.event));
          // The events that are this step's own effects are shown with it, each read against the view before it.
          const absorb = step.kind === 'attack' || step.kind === 'strikes' ? Math.min(step.absorb ?? 0, rest.length) : 0;
          const effects: { seen: Seen<V, E>; step: Step }[] = [];
          let before = seen.view;
          for (let j = 0; j < absorb; j++) {
            const s = rest[j] as Seen<V, E>;
            effects.push({ seen: s, step: this.deps.reading.step(s.event, before, rest.slice(j + 1).map(x => x.event)) });
            before = s.view;
          }
          const last = effects.length > 0 ? (effects[effects.length - 1] as { seen: Seen<V, E> }).seen.view : seen.view;
          // Whose action this is, for whoever leads the eye to it; a new turn begins with no one's.
          const about = unitsOf(step);
          if (about.length > 0 || step.kind === 'phase') this.acting = about;
          try {
            await this.play(step, last, effects.map(e => e.step));
          } catch (err) {
            this.deps.fault(`a step could not be played (${step.kind}): ${err instanceof Error ? err.message : String(err)}`);
            this.focus = null;
            this.threats = [];
            this.path = [];
            this.journey = null;
          }
          if (this.view !== last) this.show(last);
          if (step.kind !== 'placed') showed = true;
          this.deps.played?.(seen.event, step);
          for (const e of effects) this.deps.played?.(e.seen.event, e.step);
          k += absorb;
        }
        // Whatever was on its way is where the view says: a journey cut short (a fault) ends here.
        this.journey = null;
        if (this.path.length > 0) this.path = [];
        this.deps.hands.settle();
        if (this.heard.first !== null) {
          const later = this.heard.later.join('; ');
          this.outcomes.set(update.seq, later === '' ? this.heard.first : `${this.heard.first} ${later.charAt(0).toUpperCase()}${later.slice(1)}.`);
          for (const old of [...this.outcomes.keys()]) if (old <= update.seq - OUTCOMES_KEPT) this.outcomes.delete(old);
        }
        this.at = update.seq;
        // The decision has passed to another seat: the line that ended the last one's go is not what is happening now.
        if (this.deps.reading.position(update.view).deciding.join(',') !== decidingBefore) {
          this.now = '';
          this.acting = [];
        }
        if (this.view !== update.view) this.show(update.view);
        else if (update.events.length > 0) this.deps.changed();
        this.wake();
        if (showed && this.deps.watching()) await this.wait(this.deps.pace.gapMs);
      }
    } finally {
      this.running = false;
    }
    this.wake();
    this.deps.idle();
  }

  private hexOf(pos: Position, unit: string): number {
    return pos.units.find(u => u.id === unit)?.hex ?? -1;
  }

  /** Move a unit, and what it carries, along a leg of its way. */
  private async leg(unit: string, carried: readonly string[], path: readonly number[]): Promise<void> {
    const to = path[path.length - 1];
    if (to === undefined) return;
    const hands = this.deps.hands;
    await Promise.all([...carried.map(c => hands.travel(c, to, path)), hands.travel(unit, to, path)]);
  }

  /** A unit on a journey is brought to the hex where fire falls on it. */
  private async bring(unit: string, hex: number): Promise<void> {
    const j = this.journey;
    if (!j || j.unit !== unit || j.hex === hex) return;
    const at = j.path.indexOf(hex, Math.max(0, j.at + 1));
    if (at >= 0) {
      await this.leg(unit, j.with, j.path.slice(j.at + 1, at + 1));
      j.at = at;
    } else {
      // Not ahead of it on its path: it was put back there.
      await this.leg(unit, j.with, [hex]);
    }
    j.hex = hex;
  }

  /** After an attack on a unit on a journey: when no more fire is to come it goes on to where it ends. */
  private async onward(unit: string, gone: boolean): Promise<void> {
    const j = this.journey;
    if (!j || j.unit !== unit) return;
    j.left -= 1;
    if (gone) {
      this.journey = null;
      this.path = [];
      return;
    }
    if (j.left > 0) return;
    // No more fire: the rest of its path, if it is still on it (not put back off it), then where it stands in the end.
    const onPath = j.at < 0 || j.path[j.at] === j.hex;
    const rest = onPath ? j.path.slice(j.at + 1) : [];
    if (rest.length > 0) {
      await this.leg(unit, j.with, rest);
      j.hex = rest[rest.length - 1] as number;
    }
    if (j.to !== undefined && j.to !== j.hex) await this.leg(unit, j.with, [j.to]);
    this.journey = null;
    this.path = [];
    // It has come to rest: what the move's step says of where it stands now.
    this.badges(j.step, [], 'late');
  }

  private diceOf(serial: number, faces: readonly number[], caption: string, figures: readonly Figure[], stock: Stock | null, title: string | undefined,
    state: { result: string | null; fate: 'destroyed' | 'marked' | 'none' | null; rolled: boolean }): DiceModel {
    return {
      serial, faces, sides: this.deps.reading.info.dice.faces, caption, figures, result: state.result, fate: state.fate, stock, rolled: state.rolled,
      ...(title !== undefined ? { title } : {}),
    };
  }

  /**
   * The events an attack absorbed: said, labelled on the table (but for what the attack's own result has said of the
   * units in `covered`), and whatever they take off the board taken off.
   */
  private async effects(steps: readonly Step[], already: readonly string[], covered: readonly string[]): Promise<void> {
    for (const s of steps) {
      this.say(s.say);
      this.badges(s, covered);
      if (s.kind === 'removed' && !already.includes(s.unit)) await this.deps.hands.takeOff(s.unit, 'destroyed');
    }
  }

  /** One step, to its end. It shows `after` itself at the moment the step's effect lands; `effects` are the steps of the events it absorbs. */
  private async play(step: Step, after: V, effects: readonly Step[]): Promise<void> {
    const reading = this.deps.reading;
    const pace = this.deps.pace;
    const info = reading.info;
    const name = (id: string): string => info.units.find(u => u.id === id)?.name ?? id;
    const stockOfUnit = (id: string | undefined): Stock | null => (id === undefined ? null : stockOf(info, info.units.find(u => u.id === id)?.seat ?? null));
    switch (step.kind) {
      case 'placed':
        this.show(after);
        return;
      case 'moved': {
        const from = this.hexOf(reading.position(this.view), step.unit);
        const to = step.path[step.path.length - 1];
        this.say(step.say);
        if (to === undefined) {
          this.show(after);
          return;
        }
        this.path = from >= 0 ? [from, ...step.path] : step.path;
        this.deps.changed();
        const carried = step.with ?? [];
        const halts = step.halts ?? [];
        if (halts.length === 0) {
          await this.leg(step.unit, carried, step.path);
          if (step.to !== undefined && step.to !== to) await this.leg(step.unit, carried, [step.to]);
          this.path = [];
          this.badges(step);
          this.show(after);
          return;
        }
        // Fire falls on it on the way: it goes as far as the first hex fired at, and the attacks that follow take it on.
        this.journey = { unit: step.unit, path: step.path, at: -1, hex: from, left: halts.length, to: step.to, with: carried, step };
        const first = halts[0] as number;
        if (first >= 0) {
          await this.leg(step.unit, carried, step.path.slice(0, first + 1));
          this.journey.at = first;
          this.journey.hex = step.path[first] as number;
        }
        // (A label that waits for the unit to come to rest is shown when the fire on it is over and it has gone on.)
        this.badges(step, [], 'early');
        this.show(after);
        return;
      }
      case 'attack': {
        if (step.at !== undefined) await this.bring(step.target, step.at);
        const before = reading.position(this.view);
        const targetHex = step.at ?? this.hexOf(before, step.target);
        const lines: Segment[] = step.attackers
          .map(a => ({ from: this.hexOf(before, a), to: targetHex }))
          .filter(s => s.from >= 0 && s.to >= 0);
        const stock = stockOfUnit(step.attackers[0]);
        const side = sideNameOf(info, info.units.find(u => u.id === step.target)?.seat ?? null);
        const caption = `${step.attackers.map(name).join(', ')} on ${name(step.target)} (${side})`;
        this.focus = { lines, target: step.target, targetHex };
        const chance = step.chance;
        this.threats = chance
          ? lines.map((l, k) => ({
              by: step.attackers[k] ?? '', on: step.target, from: l.from, to: l.to,
              label: percentOf(chance.ways, chance.of), ways: chance.ways, kill: chance.kill, of: chance.of, live: true,
            }))
          : [];
        this.now = `${caption}…`;
        this.rolls += 1;
        const serial = this.rolls;
        this.dice = this.diceOf(serial, [], caption, step.figures, stock, step.title, { result: null, fate: null, rolled: false });
        this.deps.changed();
        // The shot itself, from every counter that makes the attack: the first thing seen of it.
        for (const a of step.attackers) {
          const from = this.hexOf(before, a);
          if (from >= 0 && targetHex >= 0) this.deps.hands.answer({ kind: 'fired', from, to: targetHex, by: a, on: step.target });
        }
        await this.wait(pace.aimMs);
        this.dice = this.diceOf(serial, step.dice, caption, step.figures, stock, step.title, { result: null, fate: null, rolled: true });
        this.deps.changed();
        if (step.dice.length > 0) await this.wait(pace.diceMs);
        this.dice = this.diceOf(serial, step.dice, caption, step.figures, stock, step.title, { result: step.result, fate: step.fate, rolled: true });
        // An attack that is not the first thing its action shows (fire drawn by a move) is told again in a few words.
        if (this.heard.first !== null) this.heard.later.push(`${(step.title ?? 'Attack').toLowerCase()}: ${step.result.toLowerCase()}`);
        this.say(step.say);
        this.landed(lines[0]?.from ?? targetHex, targetHex, step.attackers[0] ?? '', step.target, step.fate, step.result);
        this.deps.changed();
        if (step.fate === 'destroyed') await this.deps.hands.takeOff(step.target, 'destroyed');
        await this.effects(effects, step.fate === 'destroyed' ? [step.target] : [], [step.target]);
        if (step.advance && step.advance.length > 0) await Promise.all(step.advance.map(m => this.deps.hands.travel(m.unit, m.hex, [m.hex])));
        this.show(after);
        await this.wait(pace.resultMs);
        this.focus = null;
        this.threats = [];
        this.deps.changed();
        // The shot is over and off the board before the unit it fell on goes on its way.
        if (step.at !== undefined) {
          await this.onward(step.target, step.fate === 'destroyed' || effects.some(s => s.kind === 'removed' && s.unit === step.target));
          this.deps.changed();
        }
        return;
      }
      case 'strikes': {
        const before = reading.position(this.view);
        const stock = stockOfUnit(step.attackers[0]);
        const through = step.through;
        let lines: Segment[] = step.attackers.map(a => ({ from: this.hexOf(before, a), to: step.hex })).filter(s => s.from >= 0 && s.to >= 0);
        if (through) {
          // It drives into the hex, and is there while the throws are made.
          const from = this.hexOf(before, through.unit);
          this.path = from >= 0 ? [from, step.hex, through.exit] : [step.hex, through.exit];
          this.deps.changed();
          await this.deps.hands.travel(through.unit, step.hex, [step.hex]);
          lines = [];
        }
        this.focus = { lines, target: null, targetHex: step.hex };
        this.now = `${step.title}…`;
        this.deps.changed();
        // Fire from afar leaves its counter once, for the hex; a unit in the hex itself strikes each unit there in turn.
        const firer = step.attackers[0] ?? '';
        const from = through ? step.hex : lines[0]?.from ?? step.hex;
        if (!through) this.deps.hands.answer({ kind: 'fired', from, to: step.hex, by: firer, on: null });
        // Throws at a hex with nobody driving through it are a call landing (reading.ts: 'strikes'): it may leave a crater.
        if (!through) this.deps.hands.shelled?.(step.hex, `${firer}@${before.turn}@${step.hex}`);
        if (step.rolls.length === 0) {
          await this.wait(pace.aimMs);
          this.landed(from, step.hex, firer, null, 'none', 'Nothing there');
        }
        const gone: string[] = [];
        for (const roll of step.rolls) {
          const side = sideNameOf(info, info.units.find(u => u.id === roll.target)?.seat ?? null);
          const caption = `${step.attackers.map(name).join(', ')} on ${name(roll.target)} (${side})`;
          this.focus = { lines, target: roll.target, targetHex: step.hex };
          this.rolls += 1;
          const serial = this.rolls;
          this.dice = this.diceOf(serial, [], caption, roll.figures, stock, step.title, { result: null, fate: null, rolled: false });
          this.deps.changed();
          if (through) this.deps.hands.answer({ kind: 'fired', from, to: step.hex, by: firer, on: roll.target });
          await this.wait(pace.aimMs);
          this.dice = this.diceOf(serial, roll.dice, caption, roll.figures, stock, step.title, { result: null, fate: null, rolled: true });
          this.deps.changed();
          if (roll.dice.length > 0) await this.wait(pace.diceMs);
          this.dice = this.diceOf(serial, roll.dice, caption, roll.figures, stock, step.title, { result: roll.result, fate: roll.fate, rolled: true });
          this.landed(from, step.hex, firer, roll.target, roll.fate, roll.result);
          this.deps.changed();
          if (roll.fate === 'destroyed') {
            gone.push(roll.target);
            await this.deps.hands.takeOff(roll.target, 'destroyed');
          }
          await this.wait(pace.resultMs);
        }
        if (this.heard.first !== null) this.heard.later.push(`${step.title.toLowerCase()}: ${step.rolls.map(r => `${name(r.target)} ${r.result.toLowerCase()}`).join(', ') || 'nothing there'}`);
        this.say(step.say);
        await this.effects(effects, gone, step.rolls.map(r => r.target));
        if (through) await this.deps.hands.travel(through.unit, through.exit, [through.exit]);
        this.path = [];
        this.focus = null;
        this.show(after);
        return;
      }
      case 'removed':
        this.say(step.say);
        this.badges(step);
        await this.deps.hands.takeOff(step.unit, 'destroyed');
        this.show(after);
        return;
      case 'boarded': {
        const to = this.hexOf(reading.position(this.view), step.carrier);
        this.say(step.say);
        this.deps.changed();
        if (to >= 0) await this.deps.hands.travel(step.unit, to, [to], step.carrier);
        this.badges(step);
        this.show(after);
        return;
      }
      case 'phase':
        this.say(step.say);
        this.show(after);
        await this.wait(step.fresh ? pace.turnMs : pace.phaseMs);
        return;
      case 'scored':
        this.holders.set(step.hex, step.seat);
        this.say(step.say);
        this.show(after);
        await this.wait(pace.scoreMs);
        return;
      case 'revealed':
        this.say(step.say);
        this.show(after);
        await this.wait(pace.revealMs);
        return;
      case 'other':
        this.say(step.say);
        this.badges(step);
        this.show(after);
        await this.hold(step.hold);
        return;
      default:
        this.say(step.say);
        this.badges(step);
        this.show(after);
    }
  }
}
