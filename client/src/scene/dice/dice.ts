/**
 * The dice on the table: a pair of each side's, lying in the counter tray's
 * felt well, and thrown there when the game shows a roll (the port's `dice`).
 *
 * A roll comes in three steps (game/playback.ts): pointed out (`rolled`
 * false), thrown (`rolled` true, its faces set), read (its result set). When
 * it is pointed out the throw is planned (throw.ts: simulated headless,
 * recorded; the physics engine is fetched the first time). When it is thrown,
 * the dice are gathered from where they lie and thrown: each is carried on a
 * short eased curve from where it is to the launch, arriving at the launch's
 * own speed, and the recording plays from there, each die turned within its
 * body so that it lands on its face. The faces lie still well before the game
 * reads them (a kept throw comes to rest within `THROW.keepS`).
 *
 * The dice are the attacking side's, in its colours: a roll by the other side
 * than the pair lying in the well, or by another number of dice, takes that
 * pair away (each die lifts and is gone in a moment) and throws the side's own,
 * which come in from above. With no tumble (`fx=0`, reduced motion, the fast
 * play-back) the dice are laid in the well at once, showing their faces.
 *
 * And the inset (inset.ts draws it): it is wanted from the moment a throw
 * begins until a moment after the result has been read with the dice at rest
 * (`DICE_FEEL.holdS`), and eases in and out. `dice=0` keeps it away.
 *
 * Plain arithmetic and the physics engine handed in; no browser.
 */
import { STEP_S } from '../pieces/dims';
import type { Rapier } from '../pieces/physics';
import { clonePose, quatMul, quatOfAxis, slerp } from '../pieces/pose';
import type { Pose, Quat, Vec3 } from '../pieces/pose';
import type { DiceRoll } from '../pieces/port';
import type { PlacedTray } from '../tray/layout';
import { bodyAt, faceUp, laid, launchOf, planThrow, turnsFor, wellOf } from './throw';
import type { Recorded, ThrowKey, Well } from './throw';

/** What the game says of a roll: the port's `dice` (../pieces/port.ts). */
export type { DiceRoll };

/** How the dice move and when the inset comes and goes. Every number here was set by watching. */
export const DICE_FEEL = {
  /** The gathering: how long a die takes from where it lies to the launch, and how far it first rises off the felt. */
  liftS: 0.22,
  liftRise: 0.5,
  /** A pair that comes in comes from this far above its launch. */
  enterHeight: 2.4,
  /** A pair taken away lifts this far and is gone in this long. */
  leaveRise: 0.9,
  leaveS: 0.24,
  /** The inset: how long it takes to come in and to go, and how long it stays once the result is read with the dice at rest. */
  insetInS: 0.28,
  insetOutS: 0.34,
  holdS: 1.5,
  /** The most dice thrown at once; more (or dice that are not six-sided) are read in the inset's words alone. */
  maxDice: 3,
} as const;

/** The pair lying in the well before any roll: the first side's, showing these. */
const IDLE_FACES = [6, 3];
const IDLE_SEED = 20261114;

/** A die as it is drawn: its mesh's place and turn in the board frame, how large (1; less while it is taken away), whose. */
export interface DieShown {
  pose: Pose;
  scale: number;
  stock: 0 | 1;
}

/** What `window.__table.dice` gives, for checks. */
export interface DiceReading {
  /** No tray yet; lying still; waiting for the engine; gathered; tumbling; at rest after a throw. */
  state: 'none' | 'idle' | 'waiting' | 'lift' | 'tumble' | 'rest';
  /** The roll last thrown: its serial, its faces, its result. */
  serial: number;
  faces: number[];
  result: string | null;
  /** How it was shown: thrown (a recording), laid (no tumble), or only in words (dice of another kind). */
  how: 'thrown' | 'laid' | 'words' | null;
  /** The faces the dice show now, read from how they lie, and how squarely each lies (1: flat). */
  showing: number[];
  flat: number[];
  /** The recorded throw: which variant of its seed, how many were simulated, the time that took (ms), and when its dice came to rest (s after the launch). */
  variant: number;
  tried: number;
  planMs: number;
  restS: number;
  /** The inset: how far in it is (0 to 1) and whether it is wanted. */
  inset: number;
  insetWanted: boolean;
  /** Whether the physics engine has been loaded for the dice. */
  engine: boolean;
  /** Throws laid for want of a variant that ended well (never wrong; it should stay 0). */
  fallbacks: number;
}

/** What the inset shows under the picture: the sum once the dice are at rest, the result once it has been read. */
export interface DiceCaption {
  serial: number;
  faces: number[];
  sum: number | null;
  result: string | null;
  fate: 'destroyed' | 'marked' | 'none' | null;
  stock: 'first' | 'second' | null;
}

interface Throw {
  roll: DiceRoll;
  key: ThrowKey;
  how: 'thrown' | 'laid' | 'words';
  rec: Recorded | null;
  turns: Quat[];
  /** Where each die was when it was gathered, and where it is launched from (its mesh, board frame), and its speed there. */
  from: Pose[];
  launch: Pose[];
  speed: Vec3[];
  /** Whether the dice rise off the felt first (they lay there), or come down from above (a pair coming in). */
  rise: boolean;
  /** Seconds since the dice set off; null while waiting for the engine. */
  t: number | null;
  /** The page's clock (s) when the dice came to rest, and when the result was read with them at rest. */
  restAt: number | null;
  readAt: number | null;
  tried: number;
  planMs: number;
}

/** A point of a cubic Bezier curve. */
function bezier(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, u: number): Vec3 {
  const a = 1 - u;
  const b0 = a * a * a;
  const b1 = 3 * a * a * u;
  const b2 = 3 * a * u * u;
  const b3 = u * u * u;
  return [b0 * p0[0] + b1 * p1[0] + b2 * p2[0] + b3 * p3[0], b0 * p0[1] + b1 * p1[1] + b2 * p2[1] + b3 * p3[1], b0 * p0[2] + b1 * p1[2] + b2 * p2[2] + b3 * p3[2]];
}

/** The gathering's pace: no speed at its start, and at its end the launch's own (the curve's handle carries it). */
const gather = (s: number): number => s * s * (2 - s);

export class Dice {
  /** Counts changes to anything drawn. */
  stamp = 0;
  /** The pair in the well (or on its way there), and a pair being taken away. */
  private pair: DieShown[] = [];
  private leaving: { die: DieShown; from: Pose; t: number }[] = [];
  private well: Well | null = null;
  private current: Throw | null = null;
  private thrown = '';
  /** Planned throws by their key, kept for the next roll (a roll is pointed out before it is thrown). */
  private plans = new Map<string, { rec: Recorded | null; tried: number; ms: number }>();
  private engine: Rapier | null = null;
  private loading: Promise<void> | null = null;
  private insetAt = 0;
  private insetWant = false;
  private fallbacks = 0;
  /** The dice's clock (the page's, less the time it was stopped), and the page's as last given. */
  private now = 0;
  private paused = false;
  private pausedAt = 0;
  private pausedFor = 0;

  constructor(
    private readonly load: () => Promise<Rapier>,
    private readonly opts: { tumble: boolean; inset: boolean; wake: () => void },
  ) {}

  /** The tray is on the table: the first side's pair lies in its well. */
  setTray(tray: PlacedTray): void {
    this.well = wellOf(tray);
    const key: ThrowKey = { seed: IDLE_SEED, serial: 0, dice: IDLE_FACES.length, from: 1 };
    this.pair = laid(this.well, key, IDLE_FACES).map(pose => ({ pose, scale: 1, stock: 0 as const }));
    this.leaving = [];
    this.current = null;
    this.stamp++;
  }

  /** The port's `dice`: a roll pointed out, thrown, read; or null, none. */
  roll(r: DiceRoll | null): void {
    if (r === null) {
      this.thrown = '';
      this.insetWant = false;
      if (this.current && this.current.restAt === null && this.current.t !== null) return;
      this.current = null;
      this.stamp++;
      return;
    }
    const id = `${r.seed}|${r.serial}`;
    if (!r.rolled) {
      // Pointed out: plan the throw it will be (the faces do not change a throw, only how each die is turned in it).
      if (this.opts.tumble && this.well && r.sides === 6) this.prepare(r, Math.max(1, this.pair.length));
      return;
    }
    if (r.faces.length === 0) return;
    if (id !== this.thrown) {
      this.thrown = id;
      this.begin(r);
      return;
    }
    // The same throw, read.
    const c = this.current;
    if (c && `${c.roll.seed}|${c.roll.serial}` === id) {
      c.roll = r;
      this.stamp++;
      this.opts.wake();
    }
  }

  private keyOf(r: DiceRoll, n: number): ThrowKey {
    return { seed: r.seed | 0, serial: r.serial | 0, dice: n, from: r.stock === 'second' ? -1 : 1 };
  }

  private planKey(k: ThrowKey): string {
    return `${k.seed}|${k.serial}|${k.dice}|${k.from}`;
  }

  /** Plan a throw now if the engine is here; otherwise fetch the engine. */
  private prepare(r: DiceRoll, n: number): void {
    const R = this.engine;
    if (!R) {
      this.askEngine();
      return;
    }
    this.planned(R, this.keyOf(r, n));
  }

  private planned(R: Rapier, k: ThrowKey): { rec: Recorded | null; tried: number; ms: number } {
    const key = this.planKey(k);
    let p = this.plans.get(key);
    if (!p) {
      p = planThrow(R, this.well as Well, k);
      if (this.plans.size > 8) this.plans.clear();
      this.plans.set(key, p);
    }
    return p;
  }

  private askEngine(): void {
    if (this.loading) return;
    this.loading = this.load().then(
      R => {
        this.engine = R;
        const c = this.current;
        if (c && c.t === null) this.launch(c);
        this.stamp++;
        this.opts.wake();
      },
      (err: unknown) => {
        // Without the engine every throw is laid, never thrown: the faces are still the game's.
        console.error(err);
        this.opts.tumble = false;
        const c = this.current;
        if (c && c.t === null) this.lay(c);
        this.opts.wake();
      },
    );
  }

  /** A roll is thrown. */
  private begin(r: DiceRoll): void {
    const n = r.faces.length;
    const stock: 0 | 1 = r.stock === 'second' ? 1 : 0;
    const key = this.keyOf(r, n);
    const c: Throw = { roll: r, key, how: 'words', rec: null, turns: [], from: [], launch: [], speed: [], rise: true, t: 0, restAt: null, readAt: null, tried: 0, planMs: 0 };
    this.current = c;
    this.insetWant = this.opts.inset;
    this.stamp++;
    this.opts.wake();
    const well = this.well;
    if (!well || r.sides !== 6 || n > DICE_FEEL.maxDice || r.faces.some(f => !(Number.isInteger(f) && f >= 1 && f <= 6))) {
      // Dice the table has no model of: the inset says the numbers, and the dice in the well stay as they lie.
      c.restAt = this.now;
      return;
    }
    // The pair in the well is this side's, as many as are thrown: it is gathered. Otherwise it is taken away, and this side's comes in.
    const same = this.pair.length === n && this.pair.every(d => d.stock === stock && d.scale === 1);
    if (!same) {
      for (const d of this.pair) this.leaving.push({ die: d, from: clonePose(d.pose), t: 0 });
      this.pair = [];
    }
    c.rise = same;
    if (!this.opts.tumble) {
      this.lay(c);
      return;
    }
    if (!this.engine) {
      c.t = null;
      this.askEngine();
      return;
    }
    this.launch(c);
  }

  /** Lay the dice showing their faces, at once. */
  private lay(c: Throw): void {
    const well = this.well as Well;
    const stock: 0 | 1 = c.roll.stock === 'second' ? 1 : 0;
    c.how = 'laid';
    c.t = 0;
    this.pair = laid(well, c.key, c.roll.faces).map(pose => ({ pose, scale: 1, stock }));
    c.restAt = this.now;
    this.stamp++;
  }

  /** The engine is here: plan (if it is not planned), turn each die for its face, and gather them. */
  private launch(c: Throw): void {
    const R = this.engine as Rapier;
    const well = this.well as Well;
    const p = this.planned(R, c.key);
    c.tried = p.tried;
    c.planMs = p.ms;
    if (!p.rec) {
      this.fallbacks++;
      this.lay(c);
      return;
    }
    const rec = p.rec;
    c.rec = rec;
    c.how = 'thrown';
    c.turns = turnsFor(rec, c.key, c.roll.faces);
    const body: Pose = { p: [0, 0, 0], q: [0, 0, 0, 1] };
    c.launch = c.turns.map((turn, i) => {
      bodyAt(rec, i, 0, body);
      return { p: [body.p[0], body.p[1], body.p[2]], q: quatMul(body.q, turn) };
    });
    c.speed = launchOf(well, c.key, rec.variant).map(l => l.v);
    const stock: 0 | 1 = c.roll.stock === 'second' ? 1 : 0;
    if (c.rise && this.pair.length === c.launch.length) {
      c.from = this.pair.map(d => clonePose(d.pose));
    } else {
      // A pair coming in: from above its launch, turned a little otherwise.
      c.from = c.launch.map((l, i) => ({ p: [l.p[0], l.p[1], l.p[2] + DICE_FEEL.enterHeight], q: quatMul(l.q, quatOfAxis([1, i % 2 ? -1 : 1, 0.4], 1.3)) }));
      this.pair = c.launch.map(l => ({ pose: clonePose(l), scale: 1, stock }));
    }
    c.t = 0;
    this.place(c);
    this.stamp++;
  }

  /** Where each die of the pair is, at the throw's time. */
  private place(c: Throw): void {
    const rec = c.rec;
    if (!rec || c.t === null) return;
    const L = DICE_FEEL.liftS;
    const body: Pose = { p: [0, 0, 0], q: [0, 0, 0, 1] };
    for (let i = 0; i < this.pair.length; i++) {
      const d = this.pair[i] as DieShown;
      if (c.t < L) {
        const s = c.t / L;
        const u = gather(s);
        const a = c.from[i] as Pose;
        const b = c.launch[i] as Pose;
        const v = c.speed[i] as Vec3;
        const p1: Vec3 = c.rise ? [a.p[0], a.p[1], a.p[2] + DICE_FEEL.liftRise] : [a.p[0], a.p[1], a.p[2]];
        const p2: Vec3 = [b.p[0] - (v[0] * L) / 3, b.p[1] - (v[1] * L) / 3, b.p[2] - (v[2] * L) / 3];
        d.pose.p = bezier(a.p, p1, p2, b.p, u);
        d.pose.q = slerp(a.q, b.q, u);
      } else {
        bodyAt(rec, i, (c.t - L) / STEP_S, body);
        d.pose.p = [body.p[0], body.p[1], body.p[2]];
        d.pose.q = quatMul(body.q, c.turns[i] as Quat);
      }
    }
  }

  /**
   * Stop the dice's clock, or start it again (a check's way to take a still at a moment): while it is stopped
   * nothing of the dice moves, the inset included, and the time it was stopped is not counted. `now` is the
   * page's clock (s), as `step` is given it.
   */
  pause(on: boolean, now: number): void {
    if (on === this.paused) return;
    this.paused = on;
    if (on) this.pausedAt = now;
    else this.pausedFor += now - this.pausedAt;
    this.opts.wake();
  }

  /** Advance by a frame's time; `now` is the page's clock in seconds. True while anything moves (the inset too). */
  step(dt: number, now: number): boolean {
    if (this.paused) return false;
    now -= this.pausedFor;
    this.now = now;
    let moving = false;
    const c = this.current;
    if (c && c.t !== null && c.restAt === null && c.rec) {
      c.t += dt;
      this.place(c);
      moving = true;
      if (c.t >= DICE_FEEL.liftS + c.rec.steps * STEP_S) c.restAt = now;
    }
    if (c && c.t === null) moving = true;
    for (const l of this.leaving) {
      l.t += dt;
      const s = Math.min(1, l.t / DICE_FEEL.leaveS);
      const e = s * s * (3 - 2 * s);
      l.die.pose.p = [l.from.p[0], l.from.p[1], l.from.p[2] + DICE_FEEL.leaveRise * e];
      l.die.scale = 1 - e;
      moving = true;
    }
    if (this.leaving.length > 0 && this.leaving.every(l => l.t >= DICE_FEEL.leaveS)) this.leaving = [];
    // The inset: wanted from the throw until a moment after the result is read with the dice at rest.
    if (c && c.restAt !== null && c.roll.result !== null && c.readAt === null) c.readAt = now;
    if (c && c.readAt !== null && now - c.readAt >= DICE_FEEL.holdS) this.insetWant = false;
    const want = this.insetWant && this.opts.inset ? 1 : 0;
    if (this.insetAt !== want) {
      const rate = dt / (want > this.insetAt ? DICE_FEEL.insetInS : DICE_FEEL.insetOutS);
      this.insetAt = want > this.insetAt ? Math.min(want, this.insetAt + rate) : Math.max(want, this.insetAt - rate);
      moving = true;
    }
    if (moving) this.stamp++;
    return moving;
  }

  /**
   * Seconds until the dice need a step though nothing moves (the inset waiting to go), or null. The page's
   * loop stops when nothing moves; it is woken again then.
   */
  wakeIn(): number | null {
    const c = this.current;
    if (!c || !this.insetWant || c.readAt === null) return null;
    return Math.max(0, DICE_FEEL.holdS - (this.now - c.readAt)) + 0.02;
  }

  /** Every die to draw: the pair, and a pair being taken away. */
  shown(): DieShown[] {
    return [...this.pair, ...this.leaving.map(l => l.die)].filter(d => d.scale > 0.002);
  }

  /** How far in the inset is, 0 to 1 (eased by whoever draws it). */
  get inset(): number {
    return this.insetAt;
  }

  /** The well, once the tray is on the table. */
  get wellNow(): Well | null {
    return this.well;
  }

  /** What the inset says under its picture. */
  caption(): DiceCaption | null {
    const c = this.current;
    if (!c) return null;
    const atRest = c.restAt !== null;
    return {
      serial: c.roll.serial,
      faces: [...c.roll.faces],
      sum: atRest ? c.roll.faces.reduce((a, b) => a + b, 0) : null,
      result: atRest ? c.roll.result : null,
      fate: atRest ? c.roll.fate : null,
      stock: c.roll.stock,
    };
  }

  readings(): DiceReading {
    const c = this.current;
    const tops = this.pair.map(d => faceUp(d.pose.q));
    let state: DiceReading['state'] = this.well ? 'idle' : 'none';
    if (c) {
      if (c.t === null) state = 'waiting';
      else if (c.restAt !== null) state = 'rest';
      else state = c.t < DICE_FEEL.liftS ? 'lift' : 'tumble';
    }
    return {
      state,
      serial: c ? c.roll.serial : 0,
      faces: c ? [...c.roll.faces] : [],
      result: c ? c.roll.result : null,
      how: c ? c.how : null,
      showing: tops.map(t => t.face),
      flat: tops.map(t => Math.round(t.flat * 10000) / 10000),
      variant: c && c.rec ? c.rec.variant : -1,
      tried: c ? c.tried : 0,
      planMs: c ? Math.round(c.planMs * 100) / 100 : 0,
      restS: c && c.rec ? Math.round(c.rec.restStep * STEP_S * 1000) / 1000 : 0,
      inset: this.insetAt,
      insetWanted: this.insetWant,
      engine: this.engine !== null,
      fallbacks: this.fallbacks,
    };
  }
}
