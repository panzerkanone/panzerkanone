/**
 * The counters on the table (Milestone 4b; PLAN 7.5).
 *
 * The rule that shapes everything: the game owns where a counter is, and
 * physics only borrows it. Every counter has a home (a hex and a place in that
 * hex's stack, bottom to top). Regular play changes homes; nothing physical
 * ever does. A counter is at home (resting exactly at its home pose), loose (a
 * live body, wherever a hand left it), or travelling (an eased curve to its
 * home: no simulation, and it never shoves anything).
 *
 * This file is that rule: the counters and their homes, the port a game drives
 * them through (port.ts), plain input (a click, a hover), the physical gestures
 * that need Alt held, and the step that advances all of it. It draws nothing
 * and touches no DOM: view.ts draws what is here, and index.ts joins it to the
 * page. The physics engine is loaded at the first physical gesture, never
 * before: a session of plain clicks and orders neither loads nor steps it.
 */
import { invert, ndcOf, rayThrough } from '../camera';
import { SCENE_SEED, hash01 } from '../hash';
import { onBoards } from '../layout';
import type { BoardLayout } from '../layout';
import { Cues, eased } from './cues';
import type { ChanceSpec } from './chances';
import type { CueReadings, MarkerSpec, Shot } from './cues';
import { CHOSEN, CLOSE, COUNTER, CUE, FEEL, LIT, MARK_LOOK, PHYS, STEP_S, chosenLift, markTurnDeg } from './dims';
import { arriveTravel, homeTravel, orderTravel, removeTravel, settleTravel, travelAt, travelDone, travelEnd, trayTravel } from './motion';
import type { Travel } from './motion';
import { Sim } from './physics';
import type { Rapier } from './physics';
import type { CounterFace, CounterSpec, IntentAct, PiecesPort, TableAnswer } from './port';
import { angleBetween, clonePose, quatConj, quatOfYaw, rotate, slerp, yawOf } from './pose';
import type { Pose, Vec3 } from './pose';
import { TrayFill, overTray, rayTray, slotPose, trayBoxes, trayToBoard } from '../tray/layout';
import type { PlacedTray, TrayBox } from '../tray/layout';
import { Dice } from '../dice/dice';
import type { DiceRoll } from '../dice/dice';

/** What this file needs of engine/core/hex, handed in (the scene's pure files take the hex module as an argument). */
export interface HexLike {
  centreOf(g: GridLike, id: number): readonly [number, number];
  worldToHex(g: GridLike, x: number, y: number): number;
  hexCount(g: GridLike): number;
}
export interface GridLike {
  cols: number;
  rows: number;
}

/** The kinds of hexes the board's overlay tints for the pieces: the port's own, and `reach-near`, the nearer part of the reach (the port's `reachNear`). */
export type TintKind = 'reach' | 'reach-near' | 'target' | 'path' | 'objective' | 'zone';

export interface PiecesEnv {
  hex: HexLike;
  grid: GridLike;
  layout: BoardLayout;
  /** The camera as it stands: board frame to clip space, and the window in CSS pixels. */
  camera(): { viewProj: readonly number[]; css: readonly [number, number] };
  /** Load the physics engine. Called at the first physical gesture and never before. */
  loadPhysics(): Promise<Rapier>;
  /** Tint hexes through the board's own overlay. */
  tint(kind: TintKind, hexes: readonly number[]): void;
  /** Something changed: the page should run its loop. */
  wake(): void;
  /** Whoever watches what a game asks of the pieces (the table's effects), or nobody. */
  watch?: PiecesWatch | undefined;
  /** Where the port's `intent` and `answer` are shown (the table's marks: ../fx/answers.ts), or nowhere. */
  answers?: PiecesAnswers | undefined;
  /**
   * The dice (../dice): `tumble` false lays them showing their faces at once (`fx=0`, reduced motion, the fast
   * play-back); `inset` false keeps the inset away (`dice=0`). Both true when left out.
   */
  dice?: { tumble: boolean; inset: boolean } | undefined;
}

/** The port's `intent` and `answer`, as whoever shows them takes them. */
export interface PiecesAnswers {
  intent(i: { hex: number; unit: string | null; act: IntentAct; can: boolean; words: string } | null): void;
  answer(a: TableAnswer): void;
}

/**
 * What a watcher is told as the pieces are driven: the table's effects (../fx) start from these.
 * The pieces know nothing more of effects than this, and are the same without a watcher.
 */
export interface PiecesWatch {
  /** A new set-up is on the table. */
  setUp(pieces: Pieces): void;
  /** The port's threats, as given. */
  threats(pieces: Pieces, shots: readonly Shot[]): void;
  /** A counter is destroyed where it lies. Returns the seconds it should stay there before it leaves (a blast is over it). */
  destroyed(pieces: Pieces, p: Piece): number;
  /** A counter has been ordered from this hex to another (its home is the new one, and its travel has begun). */
  moved(pieces: Pieces, p: Piece, from: number): void;
  /** A counter's suppressed mark changed. */
  suppressed(pieces: Pieces, p: Piece): void;
  /** The port's markers, as given. */
  markers(pieces: Pieces, markers: readonly MarkerSpec[]): void;
}

export interface Marks {
  selected: boolean;
  canAct: boolean;
  spent: boolean;
  suppressed: boolean;
  target: boolean;
}

/** What a game has said of a counter besides its marks (the port's `note`). */
export interface Notes {
  /** One or two characters naming the group it is ordered with; '' for none. */
  group: string;
  /** Its group is the one now acting. */
  active: boolean;
  /** The id of the counter that carries it, or null. */
  carriedBy: string | null;
  revealed: boolean;
  pick: boolean;
  /** It has moved this turn and can still do one thing more: a small chevron at the face's lower right (added 2026-11-14). */
  moved: boolean;
  /** A click on it would attack it at close quarters (a close assault, an overrun): it glows red (added 2026-11-14). */
  close: boolean;
}

export type PieceState = 'home' | 'loose' | 'moving' | 'gone';

export interface Piece {
  id: string;
  /** Its number in this set-up: the row it has in every buffer. */
  n: number;
  side: string;
  face: CounterFace;
  /** The unit type, where the set-up names one (the toy's does); otherwise the face's kind. */
  unit: string;
  home: { hex: number; place: number };
  first: { hex: number; place: number };
  state: PieceState;
  /** Where it is now. */
  pose: Pose;
  /** Where it was one physics step ago: a frame is drawn between the two. */
  prev: Pose;
  /** Its home pose, kept up to date with its home and its marks. */
  rest: Pose;
  scale: number;
  travel: Travel | null;
  /** Called when the travel under way ends. */
  waiting: (() => void)[];
  marks: Marks;
  notes: Notes;
  /**
   * The marks and notes as drawn, each easing to 0 or 1. `lift` is how high it rides, as a share of a selected
   * counter's ride (1 selected; `LIT.lift` of that when it is only lit). `lit`: it is one of the group in hand and
   * carries no group mark (`active` with `group` empty): lit, with nothing printed.
   */
  shown: { lift: number; selected: number; hover: number; canAct: number; spent: number; suppressed: number; target: number; active: number; revealed: number; pick: number; lit: number; moved: number; close: number };
  /**
   * The pulse it gives when it is first lit: seconds since it began (0 while it waits for the view to arrive), or
   * null when none is under way; and how long it has waited.
   */
  pulse: number | null;
  pulseWaited: number;
  /** Seconds since it was chosen, while the swells of its light are under way (`CHOSEN.pulseS`); null when none is. */
  chosenPulse: number | null;
  /** Seconds since the red glow of a close attack came on it, while its one swell is under way; null when none is. */
  closePulse: number | null;
  /**
   * It is travelling under the counter that carries it, as one with it: where it is drawn is that
   * counter's place, less what lies between their two homes. `err` is how far from that it was when
   * the ride began (eased away in the first moments), `turn` how it was turned then.
   */
  ride: { carrier: Piece; err: Vec3; turn: Pose['q']; t: number } | null;
  /** A hair of offset and a degree or two of turn at home, by its id. */
  jitter: [number, number, number];
  /**
   * It is a free body in the physics world now. One at home is live while something stirs it; a
   * loose one is live until it comes to rest, and is then held where it lies until stirred again.
   */
  live: boolean;
  /** It has been taken off the table (it may still be seen leaving): it is in no stack. */
  off: boolean;
  /**
   * It was lost and lies in the tray (or is on its way there): the well, and how many lie under it.
   * It is out of the game (`off`), and still a thing on the table: its home is that place in the tray.
   */
  tray: { well: number; level: number } | null;
  asleep: boolean;
}

/** What `window.__table.pieces` gives for each counter. */
export interface PieceReading {
  id: string;
  unit: string;
  side: string;
  /** Home hex and place in its stack, from the bottom. */
  hex: number;
  place: number;
  position: Vec3;
  /** Its turn: the quaternion, and for convenience its turn about the vertical in degrees and whether it lies face up. */
  turn: [number, number, number, number];
  yawDeg: number;
  faceUp: boolean;
  /** `home`, `loose`, `easing` (travelling on a curve) or `gone` (taken off the table). */
  state: 'home' | 'loose' | 'easing' | 'gone';
  asleep: boolean;
  /** The hex its centre rests in, or -1. */
  over: number;
  marks: Marks;
  notes: Notes;
  /** How far in the light of the group in hand has come on it, 0 to 1 (`active` with no group mark); whether its one pulse is under way or waiting for the view; how far above its place it is drawn, in h. */
  lit: number;
  pulsing: boolean;
  lift: number;
  /** It is travelling under its carrier, as one with it. */
  riding: boolean;
  /**
   * Lost, and in the tray: the well and how many lie under it; `settled` once it lies at that place
   * (not on its way, not knocked loose). Null for every other counter. Its `state` is `gone`: it is
   * out of the game, though `position` says where it lies.
   */
  tray: { well: number; level: number; settled: boolean } | null;
}

/** What `window.__table.tray` gives: the tray as it stands and what lies in each of its wells for counters, from the bottom. */
export interface TrayReading {
  /** The middle of its footprint on the plan, the table's height under it, its turn, the height of its rim. */
  centre: [number, number];
  z: number;
  yawDeg: number;
  rimZ: number;
  /** Its length, depth and height. */
  size: [number, number, number];
  /** How many boxes it is to the physics. */
  boxes: number;
  /** Each well: the side whose losses it holds (null: free), where a counter on its floor has its middle, and the counters in it from the bottom. */
  wells: { id: number; side: string | null; centre: [number, number, number]; counters: string[] }[];
  /** The felt-lined well (for dice, later): the middle of its felt in the board frame, its length along the tray and its depth across it, and how high its walls stand over the felt. */
  felt: { centre: [number, number, number]; size: [number, number]; wall: number };
}

export interface Hit {
  piece: Piece | null;
  /** Where the pointer's ray meets the counter, the board or the table. */
  point: Vec3;
  /** The face it met. */
  normal: Vec3;
  on: 'counter' | 'board' | 'table' | 'tray' | 'nothing';
}

export interface ClickHit {
  counter: string | null;
  hex: number;
  stack: readonly string[];
}

/** The default user of the table: what a click, a hover and a key do when no game has taken the clicks. */
export interface DefaultUser {
  click(hit: ClickHit): void;
  hover(hit: { counter: string | null; hex: number }): void;
  /** A key by its place on the keyboard (`event.code`); true when it was used. */
  key(code: string): boolean;
}

interface Gesture {
  kind: 'push' | 'carry';
  x0: number;
  y0: number;
  x: number;
  y: number;
  moved: boolean;
  /** The push or the carry has begun in the physics world. */
  begun: boolean;
  over: boolean;
  hit: Hit;
  /** The height of the plane the pointer is read on. */
  planeZ: number;
  /** The finger's centre, from the point under the pointer. */
  offset: [number, number];
  age: number;
  startedMs: number;
}

const T = COUNTER.thickness;
const RAD = Math.PI / 180;
const CLICK_PX = 4;

function emptyMarks(): Marks {
  return { selected: false, canAct: false, spent: false, suppressed: false, target: false };
}

function emptyNotes(): Notes {
  return { group: '', active: false, carriedBy: null, revealed: false, pick: false, moved: false, close: false };
}

/** Whether a counter is lit as one of the group in hand: its group is the one acting and it carries no group mark (with a mark, its tab is printed the other way round instead). */
export function isLit(p: { notes: Pick<Notes, 'group' | 'active'>; off: boolean }): boolean {
  return p.notes.active && p.notes.group === '' && !p.off;
}

export class Pieces implements PiecesPort {
  /** Every counter of the set-up, those taken off included. */
  list: Piece[] = [];
  /** Counts set-ups: the view makes its faces again when it changes. */
  version = 0;
  /** The physics world, once loaded. */
  sim: Sim | null = null;
  /** How often the engine was asked for, and fixed steps taken, for the checks. */
  physicsLoads = 0;
  /** The counter a click would take, as shown. */
  hoverId: string | null = null;
  /** Lines of fire with their tags, routes, markers: what the game of orders shows besides the counters (cues.ts). */
  readonly cues: Cues;
  /** Counts changes to what the faces print (a counter's group): the view prints them again when it moves on. */
  faceVersion = 0;
  /** The lines of declared fire as last given, as hex pairs (what is fading out is not among them). */
  get fire(): { from: number; to: number }[] {
    return this.cues.fire.filter(l => l.want === 1).map(l => ({ from: l.from, to: l.to }));
  }
  /** Share of a physics step the frame stands at, for drawing between two steps. */
  alpha = 1;
  /** Counts changes to anything that is drawn: the view works only when it has moved on. */
  stamp = 0;
  /**
   * The page's view is gliding to somewhere (the table's `goTo`): a counter lit meanwhile keeps its pulse until the
   * view has arrived, so that the eye is there to see it. Set by whoever steps the pieces; false where nobody does.
   */
  viewGliding = false;
  /** Plain clicks reported since the pieces were made (to a game's handlers, or to the default user), for checks. */
  clicks = 0;
  private wasMoving = false;
  private readonly env: PiecesEnv;
  private byId = new Map<string, Piece>();
  private stacks = new Map<number, Piece[]>();
  private loading: Promise<void> | null = null;
  private queued: (() => void)[] = [];
  private acc = 0;
  private clickers: ((hit: ClickHit) => void)[] = [];
  private hoverers: ((hit: { counter: string | null; hex: number }) => void)[] = [];
  private user: DefaultUser | null = null;
  private press: { x: number; y: number } | null = null;
  private gesture: Gesture | null = null;
  private lastHover = '';
  /** The counter tray, once it has been put on the table: where it stands, its boxes, and which wells are taken. */
  private tray: { placed: PlacedTray; boxes: TrayBox[]; fill: TrayFill } | null = null;
  /** The dice in the tray's felt well, thrown when the game shows a roll (the port's `dice`). */
  readonly rolls: Dice;
  /** The pieces' own clock (s), for a caller that steps them without one. */
  private clock = 0;

  constructor(env: PiecesEnv) {
    this.env = env;
    this.rolls = new Dice(() => env.loadPhysics(), { tumble: env.dice?.tumble ?? true, inset: env.dice?.inset ?? true, wake: () => this.touch() });
    this.cues = new Cues(hex => env.hex.centreOf(env.grid, hex), () => env.hex.hexCount(env.grid));
    // A tag is laid clear of the counters where its line has room for that: clear of every counter's square, however the tag is turned.
    this.cues.covered = (x, y, reach) => this.list.some(p => p.state !== 'gone' && !p.off && Math.abs(p.rest.p[0] - x) < COUNTER.side / 2 + reach && Math.abs(p.rest.p[1] - y) < COUNTER.side / 2 + reach);
  }

  /** Something changed: what is drawn is out of date, and the page should run its loop. */
  private touch(): void {
    this.stamp++;
    this.env.wake();
  }

  // ---- homes -------------------------------------------------------------------------------------

  get(id: string): Piece {
    const p = this.byId.get(id);
    if (!p) throw new Error(`no counter ${id}`);
    return p;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** The counters whose home is a hex, bottom to top. */
  stackAt(hex: number): readonly Piece[] {
    return this.stacks.get(hex) ?? [];
  }

  /**
   * The stack a counter is in is its hex's; a lost counter's is its well's in the tray, kept among
   * the stacks under a number no hex has.
   */
  private keyOf(p: Piece): number {
    return p.tray ? -1 - p.tray.well : p.home.hex;
  }

  private placeOf(p: Piece): number {
    return p.tray ? p.tray.level : p.home.place;
  }

  /** The counters that stand with a counter, bottom to top: its hex's stack, or its well's. */
  private stackOf(p: Piece): readonly Piece[] {
    return this.stacks.get(this.keyOf(p)) ?? [];
  }

  private restack(): void {
    this.stacks.clear();
    for (const p of this.list) {
      if (p.off && !p.tray) continue;
      const key = this.keyOf(p);
      const s = this.stacks.get(key);
      if (s) s.push(p);
      else this.stacks.set(key, [p]);
    }
    for (const s of this.stacks.values()) s.sort((a, b) => this.placeOf(a) - this.placeOf(b));
  }

  /** The pose a counter has at home: squared up on its hex, with its own hair of offset and turn. A lost counter's home is its place in the tray. */
  homePose(p: Piece): Pose {
    if (p.tray && this.tray) {
      const slot = slotPose(this.tray.placed, p.tray.well, p.tray.level);
      return { p: [slot.p[0] + p.jitter[0], slot.p[1] + p.jitter[1], slot.p[2]], q: quatOfYaw(slot.yaw + p.jitter[2]) };
    }
    const c = this.env.hex.centreOf(this.env.grid, p.home.hex);
    // Suppressed lies turned; in one of Spent's treatments a Spent counter is turned too, and Suppressed the other way.
    const yaw = p.jitter[2] + markTurnDeg(p.marks) * RAD;
    return { p: [c[0] + p.jitter[0], c[1] + p.jitter[1], T * (p.home.place + 0.5)], q: quatOfYaw(yaw) };
  }

  /** The hex a point of the plan lies in, or -1 off the boards' printed hexes. */
  hexAt(x: number, y: number): number {
    return this.env.hex.worldToHex(this.env.grid, x, y);
  }

  // ---- the port ----------------------------------------------------------------------------------

  setUp(counters: readonly CounterSpec[]): void {
    const hexes = this.env.hex.hexCount(this.env.grid);
    const seen = new Set<string>();
    const places = new Map<number, number[]>();
    for (const c of counters) {
      if (typeof c.id !== 'string' || c.id === '') throw new Error('a counter needs an id');
      if (seen.has(c.id)) throw new Error(`two counters are called ${c.id}`);
      seen.add(c.id);
      if (!Number.isInteger(c.hex) || c.hex < 0 || c.hex >= hexes) throw new Error(`counter ${c.id}: hex ${c.hex} is not on this board`);
      if (!Number.isInteger(c.place) || c.place < 0) throw new Error(`counter ${c.id}: place ${c.place} is not a place in a stack`);
      const at = places.get(c.hex) ?? [];
      at.push(c.place);
      places.set(c.hex, at);
    }
    for (const [hex, at] of places) {
      at.sort((a, b) => a - b);
      at.forEach((v, k) => {
        if (v !== k) throw new Error(`hex ${hex}: its stack's places are ${at.join(', ')}; they must run 0, 1, 2 with none missing or twice`);
      });
    }
    // Whatever was under way is over: nothing of the old set-up is left to wait for.
    for (const p of this.list) for (const done of p.waiting.splice(0)) done();
    this.endGesture();
    this.list = counters.map((c, n) => {
      const jitter: [number, number, number] = [
        (hash01(SCENE_SEED, `home-x:${c.id}`, 0) - 0.5) * 2 * FEEL.homeJitter,
        (hash01(SCENE_SEED, `home-y:${c.id}`, 0) - 0.5) * 2 * FEEL.homeJitter,
        (hash01(SCENE_SEED, `home-turn:${c.id}`, 0) - 0.5) * 2 * FEEL.homeTurnDeg * RAD,
      ];
      const unit = (c as { unit?: unknown }).unit;
      const p: Piece = {
        id: c.id,
        n,
        side: c.side,
        face: { stock: c.face.stock, title: c.face.title, kind: c.face.kind, numbers: { ...c.face.numbers }, ...(c.face.art !== undefined ? { art: c.face.art } : {}) },
        unit: typeof unit === 'string' ? unit : c.face.kind,
        home: { hex: c.hex, place: c.place },
        first: { hex: c.hex, place: c.place },
        state: 'home',
        pose: { p: [0, 0, 0], q: [0, 0, 0, 1] },
        prev: { p: [0, 0, 0], q: [0, 0, 0, 1] },
        rest: { p: [0, 0, 0], q: [0, 0, 0, 1] },
        scale: 1,
        travel: null,
        waiting: [],
        marks: emptyMarks(),
        notes: emptyNotes(),
        shown: { lift: 0, selected: 0, hover: 0, canAct: 0, spent: 0, suppressed: 0, target: 0, active: 0, revealed: 0, pick: 0, lit: 0, moved: 0, close: 0 },
        pulse: null,
        pulseWaited: 0,
        chosenPulse: null,
        closePulse: null,
        ride: null,
        jitter,
        live: false,
        off: false,
        tray: null,
        asleep: true,
      };
      p.rest = this.homePose(p);
      p.pose = clonePose(p.rest);
      p.prev = clonePose(p.rest);
      return p;
    });
    this.byId = new Map(this.list.map(p => [p.id, p]));
    this.restack();
    this.hoverId = null;
    this.lastHover = '';
    // A declared attack was between counters that are no longer here. (Threats, routes and markers are sets of their own: a game replaces them when they change.)
    this.cues.setFire([]);
    // The tray is emptied with the table.
    this.tray?.fill.reset(this.list.map(p => p.side));
    this.version++;
    if (this.sim) this.sim.setCounters(this.list.map(p => p.pose), this.list.map(() => false));
    this.env.watch?.setUp(this);
    this.touch();
  }

  move(id: string, hex: number, opts?: { place?: number; path?: readonly number[] }): Promise<void> {
    if (!this.byId.has(id)) return Promise.reject(new Error(`no counter ${id}`));
    const p = this.get(id);
    if (p.off) return Promise.reject(new Error(`counter ${id} is off the table`));
    if (!Number.isInteger(hex) || hex < 0 || hex >= this.env.hex.hexCount(this.env.grid)) return Promise.reject(new Error(`hex ${hex} is not on this board`));
    const fromHex = p.home.hex;
    const fromPlace = p.home.place;
    // The stack it leaves closes up; the stack it joins makes room at its place (the top unless one is given).
    const leaving = this.stackAt(fromHex).filter(q => q !== p);
    const joining = hex === fromHex ? leaving : [...this.stackAt(hex)];
    const place = Math.min(joining.length, Math.max(0, opts?.place ?? joining.length));
    const order = [...joining.slice(0, place), p, ...joining.slice(place)];
    const touched = new Set<Piece>([...leaving, ...order]);
    // What lay on it where it was, and what will lie on it where it is going: a hand lifts these clear and sets them down again.
    const over = new Set<Piece>([...leaving.filter(q => q.home.place > fromPlace), ...order.slice(place + 1)]);
    if (hex !== fromHex) leaving.forEach((q, k) => (q.home = { hex: fromHex, place: k }));
    order.forEach((q, k) => (q.home = { hex, place: k }));
    this.restack();
    const landing = this.homePose(p);
    // What it carries, lying directly under it where it is going, goes with it as one (the game moves
    // the carried counter first and its carrier after it, to the same hex): it rides, and is not sent
    // home by itself.
    p.ride = null;
    const riders = this.list.filter(q => q !== p && this.mayRide(q, p));
    // Everything else it touches ends at home: what is loose in either stack goes home, what has a new
    // place settles to it, and a loose counter lying where it will land goes home out of its way.
    let ready = 0;
    const lifted: Piece[] = [];
    for (const q of touched) {
      if (q === p || riders.includes(q)) continue;
      if (over.has(q) && q.state !== 'loose' && !q.live) {
        lifted.push(q);
        continue;
      }
      const end = this.sendHome(q, 0);
      if (q.home.hex === hex && q.home.place < place) ready = Math.max(ready, end);
    }
    for (const q of this.list) {
      if (q.state !== 'loose' || touched.has(q)) continue;
      if (Math.hypot(q.pose.p[0] - landing.p[0], q.pose.p[1] - landing.p[1]) < COUNTER.side * 1.1 && Math.abs(q.pose.p[2] - landing.p[2]) < COUNTER.side * 0.75) this.sendHome(q, 0);
    }
    p.rest = landing;
    const centre = (h: number): readonly [number, number] => this.env.hex.centreOf(this.env.grid, h);
    let via = (opts?.path ?? []).filter(h => Number.isInteger(h) && h >= 0 && h < this.env.hex.hexCount(this.env.grid));
    // The path is the hexes passed through: its ends, if it names them, are where the counter is and where it lands.
    if (via.length > 0 && via[0] === fromHex) via = via.slice(1);
    if (via.length > 0 && via[via.length - 1] === hex) via = via.slice(0, -1);
    const travel = orderTravel(p.pose, landing, via.map(centre));
    // It lands after what lies under it has settled.
    travel.delay = Math.max(0, ready + 0.03 - travel.dur);
    this.startTravel(p, travel);
    if (hex !== fromHex) this.env.watch?.moved(this, p, fromHex);
    // Those lifted clear: up before it passes under them, and down when it has gone, or when it has come in.
    for (const q of lifted) {
      const rest = this.homePose(q);
      const hop = orderTravel(q.pose, rest, [], 0);
      hop.lift = travel.lift + T + FEEL.clearLift;
      if (q.home.hex === hex && q.home.place > place) {
        hop.dur = Math.min(FEEL.clearMaxS, travelEnd(travel) + FEEL.clearAfterS);
        hop.delay = Math.max(0, travelEnd(travel) + FEEL.clearAfterS - hop.dur);
      } else {
        hop.dur = Math.min(FEEL.clearMaxS, travel.dur + FEEL.clearAfterS);
        hop.delay = travel.delay;
      }
      q.rest = rest;
      this.startTravel(q, hop);
    }
    for (const q of riders) this.startRide(q, p);
    // Sent to lie directly under its carrier while that carrier is on its way there: it joins it.
    const carrier = p.notes.carriedBy !== null ? this.byId.get(p.notes.carriedBy) : undefined;
    if (carrier && carrier.state === 'moving' && carrier.travel && carrier.travel.kind === 'order' && this.mayRide(p, carrier)) this.startRide(p, carrier);
    this.thaw();
    this.touch();
    return new Promise(resolve => p.waiting.push(resolve));
  }

  remove(id: string, how: 'destroyed' | 'withdrawn'): Promise<void> {
    if (!this.byId.has(id)) return Promise.reject(new Error(`no counter ${id}`));
    const p = this.get(id);
    // Already gone, or going: it is gone when its leaving ends (a lost counter: when it lies in the tray).
    if (p.state === 'gone') return Promise.resolve();
    if (p.off) return p.travel ? new Promise(resolve => p.waiting.push(resolve)) : Promise.resolve();
    // A watcher (the effects) may ask that a destroyed counter stay a moment under its blast before it leaves.
    const hold = how === 'destroyed' ? (this.env.watch?.destroyed(this, p) ?? 0) : 0;
    // With a tray on the table a destroyed counter is not flicked away: it is carried to the tray.
    if (how === 'destroyed' && this.tray) return this.lose(p, hold);
    const hex = p.home.hex;
    // It leaves from where it is; the stack it was in closes up at once.
    const o = this.env.layout.outline;
    const x = p.pose.p[0];
    const y = p.pose.p[1];
    const sides: [number, number, number][] = [[x - o[0], -1, 0], [o[2] - x, 1, 0], [y - o[1], 0, -1], [o[3] - y, 0, 1]];
    sides.sort((a, b) => a[0] - b[0]);
    const near = sides[0] as [number, number, number];
    // Flicked the way of the nearest edge, a little to one side by its id.
    const skew = (hash01(SCENE_SEED, `flick:${p.id}`, 0) - 0.5) * 0.9;
    const away: [number, number] = [near[1] + (near[1] === 0 ? skew : 0), near[2] + (near[2] === 0 ? skew : 0)];
    const len = Math.hypot(away[0], away[1]);
    const travel = removeTravel(p.pose, how, [away[0] / len, away[1] / len], hold);
    p.marks = emptyMarks();
    this.startTravel(p, travel);
    // It is out of every stack from now, though still seen until its travel ends.
    p.off = true;
    const rest = this.stackAt(hex).filter(q => q !== p);
    rest.forEach((q, k) => (q.home = { hex, place: k }));
    this.restack();
    for (const q of rest) this.sendHome(q, 0);
    this.thaw();
    this.touch();
    return new Promise(resolve => p.waiting.push(resolve));
  }

  /**
   * A destroyed counter goes to the tray: it lifts, is carried over, and is set down face up in the
   * next free well of its side, on top of what lies there. It is out of the game from this moment
   * (in no stack; no mark, no note, no click), and still a thing on the table. Resolves when it has settled.
   */
  private lose(p: Piece, hold = 0): Promise<void> {
    const tray = this.tray as NonNullable<Pieces['tray']>;
    const hex = p.home.hex;
    p.marks = emptyMarks();
    // What its face prints stays (its group's tab); what a game lights on it does not.
    p.notes = { ...emptyNotes(), group: p.notes.group };
    p.off = true;
    const slot = tray.fill.take(p.side);
    p.tray = slot;
    // The stack it leaves closes up at once.
    const rest = this.stackAt(hex).filter(q => q !== p);
    rest.forEach((q, k) => (q.home = { hex, place: k }));
    this.restack();
    for (const q of rest) this.sendHome(q, 0);
    const landing = this.homePose(p);
    // It lands after what lies under it in its well has; a loose counter lying where it will land goes home out of its way.
    let ready = 0;
    for (const q of this.list) {
      if (q === p || q.state === 'gone') continue;
      if (q.tray && q.tray.well === slot.well && q.tray.level < slot.level) {
        if (q.state === 'loose' || q.live) ready = Math.max(ready, this.sendHome(q, 0));
        else if (q.travel) ready = Math.max(ready, travelEnd(q.travel) - q.travel.t);
        continue;
      }
      if (q.state !== 'loose') continue;
      if (Math.hypot(q.pose.p[0] - landing.p[0], q.pose.p[1] - landing.p[1]) < COUNTER.side * 1.1 && Math.abs(q.pose.p[2] - landing.p[2]) < COUNTER.side * 0.75) this.sendHome(q, 0);
    }
    p.rest = landing;
    const travel = trayTravel(p.pose, landing, tray.placed.rimZ, T);
    travel.delay = Math.max(hold, ready + FEEL.trayStackGapS - travel.dur);
    this.startTravel(p, travel);
    this.thaw();
    this.touch();
    return new Promise(resolve => p.waiting.push(resolve));
  }

  /**
   * Put the counter tray on the table (the page does, when the tray's art has been handed in): from
   * now on a destroyed counter goes to it, and its floor and walls are in the physics world.
   */
  setTray(placed: PlacedTray): void {
    this.tray = { placed, boxes: trayBoxes(placed.layout), fill: new TrayFill(placed.layout) };
    this.tray.fill.reset(this.list.map(p => p.side));
    if (this.sim) this.sim.setFixture(this.fixture());
    this.rolls.setTray(placed);
    this.touch();
  }

  /**
   * A roll the game shows (pointed out, thrown, read), or null: the dice are thrown into the tray's felt well and land
   * on its faces, and the inset shows them (../dice). Without a tray the inset shows the faces in words alone.
   */
  dice(roll: DiceRoll | null): void {
    this.rolls.roll(roll);
    this.touch();
  }

  /** The tray as the physics takes it: its boxes, where it stands. */
  private fixture(): { at: Vec3; yaw: number; boxes: { centre: Vec3; half: Vec3; friction: number }[] } | null {
    const t = this.tray;
    if (!t) return null;
    return {
      at: [t.placed.centre[0], t.placed.centre[1], t.placed.z],
      yaw: t.placed.yaw,
      boxes: t.boxes.map(b => ({ centre: b.centre, half: b.half, friction: b.part === 'felt' ? PHYS.frictionFelt : PHYS.frictionTray })),
    };
  }

  /** The tray as it stands, for the checks: null until one is on the table. */
  trayReading(): TrayReading | null {
    const t = this.tray;
    if (!t) return null;
    const held = t.fill.held();
    const felt = t.placed.layout.felt;
    return {
      centre: [t.placed.centre[0], t.placed.centre[1]],
      z: t.placed.z,
      yawDeg: (t.placed.yaw * 180) / Math.PI,
      rimZ: t.placed.rimZ,
      size: [t.placed.layout.size[0], t.placed.layout.size[1], t.placed.layout.size[2]],
      boxes: t.boxes.length,
      wells: t.placed.layout.wells.map(w => ({
        id: w.id,
        side: (held[w.id] as { side: string | null }).side,
        centre: slotPose(t.placed, w.id, 0).p,
        counters: this.list
          .filter(p => p.tray !== null && p.tray.well === w.id)
          .sort((a, b) => this.placeOf(a) - this.placeOf(b))
          .map(p => p.id),
      })),
      felt: {
        centre: trayToBoard(t.placed, (felt.rect[0] + felt.rect[2]) / 2, (felt.rect[1] + felt.rect[3]) / 2, felt.floor),
        size: [felt.rect[2] - felt.rect[0], felt.rect[3] - felt.rect[1]],
        wall: t.placed.layout.rim - felt.floor,
      },
    };
  }

  mark(id: string, marks: { selected?: boolean; canAct?: boolean; spent?: boolean; suppressed?: boolean; target?: boolean }): void {
    const p = this.get(id);
    // A lost counter takes no mark.
    if (p.tray) return;
    const turnWas = markTurnDeg(p.marks);
    const suppressedWas = p.marks.suppressed;
    if (marks.selected !== undefined && marks.selected && !p.marks.selected) p.chosenPulse = 0;
    if (marks.selected !== undefined && !marks.selected) p.chosenPulse = null;
    if (marks.selected !== undefined) p.marks.selected = marks.selected;
    if (marks.canAct !== undefined) p.marks.canAct = marks.canAct;
    if (marks.spent !== undefined) p.marks.spent = marks.spent;
    if (marks.suppressed !== undefined) p.marks.suppressed = marks.suppressed;
    if (marks.target !== undefined) p.marks.target = marks.target;
    // A suppressed counter lies turned (and in one of Spent's treatments a Spent one): its home pose changes, and it eases to it.
    const turned = markTurnDeg(p.marks) !== turnWas;
    if (turned && (p.state === 'home' || p.state === 'moving')) this.sendHome(p, 0);
    if (p.marks.suppressed !== suppressedWas) this.env.watch?.suppressed(this, p);
    this.touch();
  }

  tint(kind: TintKind, hexes: readonly number[]): void {
    this.env.tint(kind, hexes.filter(h => Number.isInteger(h) && h >= 0));
    this.touch();
  }

  /** The nearer part of the reach: tinted a shade stronger, through the board's overlay like every tint. */
  reachNear(hexes: readonly number[]): void {
    this.tint('reach-near', hexes);
  }

  lines(_kind: 'fire', segments: readonly { from: number; to: number }[]): void {
    this.cues.setFire(segments);
    this.touch();
  }

  note(id: string, notes: { group?: string; active?: boolean; carriedBy?: string | null; revealed?: boolean; pick?: boolean; moved?: boolean; close?: boolean }): void {
    const p = this.get(id);
    // Nor a note.
    if (p.tray) return;
    const wasLit = isLit(p);
    if (notes.group !== undefined && notes.group !== p.notes.group) {
      // The face carries it in print: the faces are printed again before the next frame.
      p.notes.group = notes.group;
      this.faceVersion++;
    }
    if (notes.active !== undefined) p.notes.active = notes.active;
    // First lit: one pulse (it begins when the view, if it is gliding here, has arrived).
    if (!wasLit && isLit(p)) {
      p.pulse = 0;
      p.pulseWaited = 0;
    }
    if (notes.carriedBy !== undefined) p.notes.carriedBy = notes.carriedBy;
    if (notes.revealed !== undefined) p.notes.revealed = notes.revealed;
    if (notes.pick !== undefined) p.notes.pick = notes.pick;
    if (notes.moved !== undefined) p.notes.moved = notes.moved;
    if (notes.close !== undefined && notes.close && !p.notes.close) p.closePulse = 0;
    if (notes.close !== undefined && !notes.close) p.closePulse = null;
    if (notes.close !== undefined) p.notes.close = notes.close;
    this.touch();
  }

  threats(shots: readonly Shot[]): void {
    this.cues.setThreats(shots);
    this.env.watch?.threats(this, shots);
    this.touch();
  }

  routes(paths: readonly (readonly number[])[]): void {
    this.cues.setRoutes(paths);
    this.touch();
  }

  markers(markers: readonly MarkerSpec[]): void {
    this.cues.setMarkers(markers);
    this.env.watch?.markers(this, markers);
    this.touch();
  }

  /** The chance of every target at once: a card beside each counter named, laid clear of every counter's numbers (chances.ts). */
  chances(labels: readonly ChanceSpec[]): void {
    const counters = this.list.filter(p => p.state !== 'gone' && !p.off && !p.tray).map(p => {
      const stack = this.stackAt(p.home.hex);
      return { id: p.id, x: p.rest.p[0], y: p.rest.p[1], yaw: yawOf(p.rest.q), top: stack[stack.length - 1] === p };
    });
    this.cues.setChances(labels, counters);
    this.touch();
  }

  /** What a click on the hex under the pointer would do: shown there by the table's marks, and by the cursor. Nothing of the counters changes. */
  intent(i: { hex: number; unit: string | null; act: IntentAct; can: boolean; words: string } | null): void {
    this.env.answers?.intent(i);
  }

  /** The table's answer to something a player did: a badge, a refusal, a shot and what came of it. */
  answer(a: TableAnswer): void {
    this.env.answers?.answer(a);
  }

  /** The stock a side's counters are printed on (a marker of that side lies on the same), or null where the side has no counter here. */
  stockOf(side: string | null): 'first' | 'second' | null {
    if (side === null) return null;
    for (const p of this.list) if (p.side === side) return p.face.stock;
    return null;
  }

  /**
   * The height of what lies under a flat thing put down at a point (a tag: `right` is the way its
   * long side runs, `along` and `across` its half sizes): 0 on the bare board, the top of a marker,
   * the face of the highest counter it would lie on.
   */
  topUnder(x: number, y: number, right: readonly [number, number], along: number, across: number): number {
    const hex = this.hexAt(x, y);
    let top = hex >= 0 ? this.cues.markerTop(hex) : 0;
    // A counter's square, turned against the tag by no more than the camera is, taken a little large.
    const reach = (COUNTER.side / 2) * (Math.abs(right[0]) + Math.abs(right[1]));
    for (const p of this.list) {
      if (p.state === 'gone' || p.scale < 0.5) continue;
      const dx = p.pose.p[0] - x;
      const dy = p.pose.p[1] - y;
      if (Math.abs(dx * right[0] + dy * right[1]) >= along + reach || Math.abs(dy * right[0] - dx * right[1]) >= across + reach) continue;
      top = Math.max(top, p.pose.p[2] + T / 2 + p.shown.lift * chosenLift());
    }
    return top;
  }

  /** The way the screen's right lies on the board as the camera stands (a unit vector): letters on the table run along it. */
  screenRight(): [number, number] {
    const css = this.env.camera().css;
    const a = this.planeUnder(css[0] / 2 - 40, css[1] / 2, 0);
    const b = this.planeUnder(css[0] / 2 + 40, css[1] / 2, 0);
    if (!a || !b) return [1, 0];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return len > 1e-9 ? [(b[0] - a[0]) / len, (b[1] - a[1]) / len] : [1, 0];
  }

  onClick(handler: (hit: ClickHit) => void): () => void {
    this.clickers.push(handler);
    return () => {
      const k = this.clickers.indexOf(handler);
      if (k >= 0) this.clickers.splice(k, 1);
    };
  }

  onHover(handler: (hit: { counter: string | null; hex: number }) => void): () => void {
    this.hoverers.push(handler);
    return () => {
      const k = this.hoverers.indexOf(handler);
      if (k >= 0) this.hoverers.splice(k, 1);
    };
  }

  /** Whether a game has taken the clicks: the default user then does nothing. */
  get taken(): boolean {
    return this.clickers.length > 0;
  }

  /** The table's default user (the toy): asked only while no game has taken the clicks. */
  setDefaultUser(user: DefaultUser | null): void {
    this.user = user;
  }

  /** Show which counter a click would take (the default user's hover; a game's hover lights the top counter). */
  setHover(id: string | null): void {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.touch();
  }

  // ---- travelling --------------------------------------------------------------------------------

  private startTravel(p: Piece, travel: Travel): void {
    p.travel = travel;
    p.ride = null;
    p.state = 'moving';
    p.live = false;
    p.asleep = true;
    p.prev = clonePose(p.pose);
    if (this.sim) this.sim.takeOut(p.n);
  }

  /**
   * Send a counter to its home pose if it is not exactly there: a loose one
   * flies home, one at home whose place or turn changed settles. Returns the
   * time, from now, at which it will be there.
   */
  private sendHome(p: Piece, delay: number): number {
    if (p.state === 'gone') return 0;
    const rest = this.homePose(p);
    if (p.ride) {
      // It is under its carrier, on the way: it comes home with it.
      p.rest = rest;
      const m = p.ride.carrier.travel;
      return m ? Math.max(0, travelEnd(m) - m.t) : 0;
    }
    if (p.state === 'moving' && p.travel) {
      // Already on its way somewhere: it goes on from where it is, to where its home now is.
      if (p.travel.kind === 'destroyed' || p.travel.kind === 'withdrawn') return 0;
      p.rest = rest;
      // Being carried into the tray or out of it: the carry goes on (its end does not change under it).
      if (p.travel.kind === 'tray') return Math.max(0, travelEnd(p.travel) - p.travel.t);
      const left = Math.max(0.08, travelEnd(p.travel) - p.travel.t);
      const t = p.travel.kind === 'order' ? orderTravel(p.pose, rest, [], 0) : p.travel.kind === 'home' ? homeTravel(p.pose, rest, 0) : settleTravel(p.pose, rest, 0);
      t.dur = Math.max(left, Math.min(t.dur, left + 0.1));
      p.travel = t;
      return t.dur;
    }
    const d = Math.hypot(rest.p[0] - p.pose.p[0], rest.p[1] - p.pose.p[1], rest.p[2] - p.pose.p[2]);
    const a = angleBetween(rest.q, p.pose.q);
    p.rest = rest;
    if (p.state === 'home' && !p.live && d < 1e-9 && a < 1e-9) return 0;
    // Into a well of the tray, or out of one, it is carried up, across and down (never through a wall).
    const tray = this.tray;
    const carried = tray !== null && d > FEEL.homeNudge && (p.tray !== null || (overTray(tray.placed, p.pose.p[0], p.pose.p[1]) && p.pose.p[2] < tray.placed.rimZ + T));
    const travel = carried ? trayTravel(p.pose, rest, tray.placed.rimZ, T, delay) : p.state === 'loose' || p.live ? homeTravel(p.pose, rest, delay) : settleTravel(p.pose, rest, delay);
    this.startTravel(p, travel);
    return travelEnd(travel);
  }

  /** Whether a counter may travel as one with another: that other carries it, and its home is directly under that other's. */
  private mayRide(p: Piece, carrier: Piece): boolean {
    if (p.notes.carriedBy !== carrier.id || p.off || carrier.off || p.state === 'gone' || p.state === 'loose' || p.live) return false;
    return p.home.hex === carrier.home.hex && p.home.place === carrier.home.place - 1;
  }

  /** A carried counter begins to travel under its carrier, from wherever it is. */
  private startRide(p: Piece, carrier: Piece): void {
    p.rest = this.homePose(p);
    const c = carrier;
    const err: Vec3 = [
      p.pose.p[0] - (c.pose.p[0] + p.rest.p[0] - c.rest.p[0]),
      p.pose.p[1] - (c.pose.p[1] + p.rest.p[1] - c.rest.p[1]),
      p.pose.p[2] - (c.pose.p[2] + p.rest.p[2] - c.rest.p[2]),
    ];
    p.travel = null;
    p.ride = { carrier, err, turn: [p.pose.q[0], p.pose.q[1], p.pose.q[2], p.pose.q[3]], t: 0 };
    p.state = 'moving';
    p.live = false;
    p.asleep = true;
    p.prev = clonePose(p.pose);
    if (this.sim) this.sim.takeOut(p.n);
  }

  /**
   * Counters travelling under their carriers: each is drawn where its carrier is, less what lies
   * between their two homes, and lands when its carrier does, exactly at home. One whose carrier
   * is no longer over it (taken off, or sent elsewhere) goes home by itself.
   */
  private advanceRides(dt: number): { any: boolean; landed: boolean } {
    let any = false;
    let landed = false;
    for (const p of this.list) {
      const r = p.ride;
      if (!r) continue;
      const c = r.carrier;
      r.t += dt;
      const over = !p.off && !c.off && c.home.hex === p.home.hex && c.home.place === p.home.place + 1;
      if (over && c.state === 'moving' && c.travel) {
        p.rest = this.homePose(p);
        const k = eased(r.t / CUE.easeS);
        const at: Vec3 = [
          c.pose.p[0] + p.rest.p[0] - c.rest.p[0] + r.err[0] * (1 - k),
          c.pose.p[1] + p.rest.p[1] - c.rest.p[1] + r.err[1] * (1 - k),
          c.pose.p[2] + p.rest.p[2] - c.rest.p[2] + r.err[2] * (1 - k),
        ];
        p.pose = { p: at, q: slerp(r.turn, p.rest.q, k) };
        p.prev = p.pose;
        any = true;
        continue;
      }
      p.ride = null;
      if (over && c.state === 'home') {
        p.rest = this.homePose(p);
        p.pose = clonePose(p.rest);
        p.prev = clonePose(p.rest);
        p.scale = 1;
        p.state = 'home';
        if (this.sim) this.sim.hold(p.n, p.pose);
        landed = true;
        for (const done of p.waiting.splice(0)) done();
      } else if (!p.off) {
        p.rest = this.homePose(p);
        this.startTravel(p, settleTravel(p.pose, p.rest, 0));
        any = true;
      }
    }
    return { any, landed };
  }

  /** Space: everything loose goes home, a few hundredths of a second apart, stacks re-forming bottom first. Returns how many set off. */
  goHome(): number {
    const going = this.list.filter(p => p.state === 'loose' || (p.state === 'home' && p.live));
    if (going.length === 0) return 0;
    this.endGesture();
    return this.flow(going);
  }

  /** Start a flow of counters to their homes: nearest first, each a little after the last, lower places landing first. */
  private flow(going: Piece[]): number {
    const dist = (p: Piece): number => Math.hypot(p.rest.p[0] - p.pose.p[0], p.rest.p[1] - p.pose.p[1]);
    for (const p of going) p.rest = this.homePose(p);
    going.sort((a, b) => dist(a) - dist(b) || a.n - b.n);
    // Those that have hardly moved square up at once, together; the rest set off one after another,
    // nearest first, so that the first of them answers the key at once and the farthest comes in last.
    const far = going.filter(p => p.state === 'gone' || dist(p) > FEEL.homeNudge);
    const gap = Math.min(FEEL.homeGapS, FEEL.homeSpreadMaxS / Math.max(1, far.length));
    const landing = new Map<Piece, number>();
    let k = 0;
    for (const p of going) {
      const delay = far.includes(p) ? k++ * gap : 0;
      landing.set(p, p.state === 'gone' ? this.arrive(p, delay) : this.sendHome(p, delay));
    }
    // Bottom first: no counter lands before the one under it has, with a beat between.
    const byHex = new Map<number, Piece[]>();
    for (const p of going) byHex.set(this.keyOf(p), [...(byHex.get(this.keyOf(p)) ?? []), p]);
    for (const stack of byHex.values()) {
      stack.sort((a, b) => this.placeOf(a) - this.placeOf(b));
      let floor = 0;
      for (const p of stack) {
        const end = landing.get(p) ?? 0;
        if (p.travel && end < floor + FEEL.homeStackGapS && floor > 0) {
          p.travel.delay += floor + FEEL.homeStackGapS - end;
          floor = travelEnd(p.travel);
        } else floor = Math.max(floor, end);
      }
    }
    this.touch();
    return going.length;
  }

  /** Put a counter that was taken off back on the table at its home. */
  private arrive(p: Piece, delay: number): number {
    p.rest = this.homePose(p);
    const travel = arriveTravel(p.rest, delay);
    p.pose = clonePose(travel.from);
    p.scale = 0;
    this.startTravel(p, travel);
    return travelEnd(travel);
  }

  /** R: the whole set-up back to its first homes, everything flowing there; counters taken off come back. */
  resetHomes(): void {
    this.endGesture();
    for (const p of this.list) {
      p.home = { hex: p.first.hex, place: p.first.place };
      p.marks = emptyMarks();
      if (p.ride) {
        // No longer under a carrier on its way: it flows home with the others, from where it is.
        p.ride = null;
        p.state = 'loose';
      }
      if (p.tray) {
        // Lost to the tray, or on its way there: it comes back from where it is, as a loose counter does.
        p.tray = null;
        p.off = false;
        p.travel = null;
        p.scale = 1;
        p.state = 'loose';
        for (const done of p.waiting.splice(0)) done();
        continue;
      }
      if (!p.off) continue;
      // Taken off, or on its way off: it comes back.
      p.off = false;
      p.state = 'gone';
      p.travel = null;
      p.scale = 0;
      for (const done of p.waiting.splice(0)) done();
    }
    this.restack();
    this.tray?.fill.reset(this.list.map(p => p.side));
    const going = this.list.filter(p => {
      if (p.state === 'gone') return true;
      const rest = this.homePose(p);
      return p.live || p.state !== 'home' || Math.hypot(rest.p[0] - p.pose.p[0], rest.p[1] - p.pose.p[1], rest.p[2] - p.pose.p[2]) > 1e-9 || angleBetween(rest.q, p.pose.q) > 1e-9;
    });
    this.hoverId = null;
    if (going.length > 0) this.flow(going);
    this.touch();
  }

  private advanceTravels(dt: number): boolean {
    let any = false;
    let landed = false;
    for (const p of this.list) {
      const m = p.travel;
      if (!m) continue;
      m.t += dt;
      if (travelDone(m)) {
        p.travel = null;
        if (m.kind === 'destroyed' || m.kind === 'withdrawn') {
          p.state = 'gone';
          p.scale = 0;
        } else {
          // The end of every way home is the home pose itself, not a point computed near it.
          p.rest = this.homePose(p);
          p.pose = clonePose(p.rest);
          p.prev = clonePose(p.rest);
          p.scale = 1;
          p.state = 'home';
          if (this.sim) this.sim.hold(p.n, p.pose);
          landed = true;
        }
        for (const done of p.waiting.splice(0)) done();
      } else {
        const at = travelAt(m);
        p.pose = at.pose;
        p.prev = at.pose;
        p.scale = at.scale;
        any = true;
      }
    }
    // What rides under a carrier is placed after every carrier has moved.
    const rides = this.advanceRides(dt);
    if (landed || rides.landed) this.thaw();
    return any || rides.any;
  }

  // ---- the physics, borrowed -----------------------------------------------------------------------

  /** Load the engine if it is not loaded, and run what is waiting for it. */
  loadPhysics(): Promise<void> {
    if (this.sim) return Promise.resolve();
    if (!this.loading) {
      this.physicsLoads++;
      this.loading = this.env.loadPhysics().then(R => {
        const l = this.env.layout;
        const sim = new Sim(R, { slabs: l.slabs, cornerRadius: l.cornerRadius, thickness: l.thickness, table: l.table });
        sim.setCounters(this.list.map(p => p.pose), this.list.map(p => p.state === 'moving' || p.state === 'gone'));
        sim.setFixture(this.fixture());
        this.sim = sim;
        for (const run of this.queued.splice(0)) run();
        this.touch();
      });
    }
    return this.loading;
  }

  /** Do something that needs the physics world: now if it is loaded, otherwise when it is. */
  private whenSim(run: (sim: Sim) => void): void {
    if (this.sim) run(this.sim);
    else {
      this.queued.push(() => run(this.sim as Sim));
      void this.loadPhysics();
    }
  }

  /** Stir a counter at home and the whole stack it is in: they become free bodies where they lie. */
  private stir(p: Piece): void {
    const sim = this.sim;
    if (!sim) return;
    for (const q of this.stackOf(p)) {
      if (q.state !== 'home' || q.live) continue;
      sim.free(q.n);
      q.live = true;
      q.asleep = false;
    }
    if (p.state === 'loose' && !p.live) {
      sim.free(p.n);
      p.live = true;
      p.asleep = false;
    }
  }

  /** Free every loose counter that lies at rest: something it may lie on has moved. */
  private thaw(): void {
    const sim = this.sim;
    if (!sim) return;
    for (const p of this.list) {
      if (p.state !== 'loose' || p.live) continue;
      sim.free(p.n);
      p.live = true;
      p.asleep = false;
    }
    sim.wakeAll();
  }

  /** Counters held still (at home, or loose and at rest) come alive when something moving comes within a margin of them: a finger, a hand's load, a body awake. */
  private stirNear(): void {
    const sim = this.sim as Sim;
    const held: Piece[] = [];
    for (const p of this.list) if ((p.state === 'home' || p.state === 'loose') && !p.live) held.push(p);
    if (held.length === 0) return;
    const near = (x: number, y: number, z: number, r: number, rz: number, margin: number): void => {
      for (const p of held) {
        if (p.live) continue;
        const reach = r + COUNTER.side * 0.71 + margin;
        const dx = p.pose.p[0] - x;
        const dy = p.pose.p[1] - y;
        if (dx * dx + dy * dy > reach * reach) continue;
        if (Math.abs(p.pose.p[2] - z) > rz + T / 2 + margin) continue;
        this.stir(p);
      }
    };
    const f = sim.fingerAt();
    if (f) near(f[0], f[1], f[2], FEEL.fingerRadius, FEEL.fingerHalfHeight, FEEL.wakeMargin + FEEL.fingerMaxSpeed * STEP_S);
    for (const p of this.list) {
      if (!p.live || p.asleep) continue;
      const flat = Math.abs(rotate(p.pose.q, [0, 0, 1])[2]) > 0.95;
      near(p.pose.p[0], p.pose.p[1], p.pose.p[2], COUNTER.side * 0.71, flat ? T / 2 : COUNTER.side * 0.71, FEEL.wakeMargin + sim.speed(p.n) * STEP_S * 2);
    }
  }

  /** One fixed step of the physics world, and what it means for the counters. */
  private simStep(): void {
    const sim = this.sim as Sim;
    this.stirNear();
    sim.step();
    const tol = FEEL.homeTolerance;
    const tolA = FEEL.homeToleranceDeg * RAD;
    for (const p of this.list) {
      if (!p.live) continue;
      p.prev.p[0] = p.pose.p[0];
      p.prev.p[1] = p.pose.p[1];
      p.prev.p[2] = p.pose.p[2];
      p.prev.q[0] = p.pose.q[0];
      p.prev.q[1] = p.pose.q[1];
      p.prev.q[2] = p.pose.q[2];
      p.prev.q[3] = p.pose.q[3];
      sim.read(p.n, p.pose);
      p.asleep = sim.isAsleep(p.n);
      // Fallen off the table's edge, or through anything: it is loose, and will come home with the rest.
      if (p.state === 'home') {
        const r = p.rest;
        if (Math.hypot(p.pose.p[0] - r.p[0], p.pose.p[1] - r.p[1], p.pose.p[2] - r.p[2]) > tol || angleBetween(p.pose.q, r.q) > tolA) p.state = 'loose';
      }
    }
    if (sim.settled) this.rest();
  }

  /**
   * The world has come to rest. A stirred counter that never left its home pose
   * is held there again, exactly; a loose one is held where it lies. Nothing is
   * then left to step, and the page stops.
   */
  private rest(): void {
    const sim = this.sim as Sim;
    for (const stack of this.stacks.values()) {
      let sound = true;
      for (const p of stack) {
        if (p.state !== 'home') {
          sound = false;
          continue;
        }
        if (!p.live) continue;
        if (!sound) {
          p.state = 'loose';
          continue;
        }
        p.pose = clonePose(p.rest);
        p.prev = clonePose(p.rest);
        p.live = false;
        sim.hold(p.n, p.pose);
      }
    }
    for (const p of this.list) {
      if (!p.live) continue;
      p.prev = clonePose(p.pose);
      p.live = false;
      p.asleep = true;
      sim.hold(p.n, p.pose);
    }
  }

  /** Advance the physics world by n fixed steps with no drawing (the checks' way). */
  stepPhysics(n: number): void {
    if (!this.sim) throw new Error('the physics is not loaded');
    for (let k = 0; k < n; k++) this.simStep();
    this.acc = 0;
    this.alpha = 1;
    this.touch();
  }

  /** B: the table is bumped. Everything jumps a hair and settles. */
  bump(): void {
    this.whenSim(sim => {
      for (const p of this.list) {
        if (p.state === 'home' && !p.live) {
          sim.free(p.n);
          p.live = true;
          p.asleep = false;
        }
      }
      this.thaw();
      sim.bump();
      this.touch();
    });
  }

  /** A poke at a counter: it hops and skids away from the side it was poked on. */
  poke(id: string, at: readonly [number, number, number]): void {
    this.whenSim(sim => {
      const p = this.get(id);
      if (p.state === 'gone' || p.state === 'moving') return;
      this.stir(p);
      sim.poke(p.n, at);
      this.touch();
    });
  }

  /** The counter a hand takes with the one it presses on: everything lying on it, as a pinch would. */
  pileOn(p: Piece): Piece[] {
    const pile = [p];
    let top = p;
    for (;;) {
      let next: Piece | null = null;
      for (const q of this.list) {
        if (q.state === 'gone' || q.state === 'moving' || pile.includes(q)) continue;
        const dz = q.pose.p[2] - top.pose.p[2];
        if (dz < T * 0.4 || dz > T * 1.7) continue;
        if (Math.hypot(q.pose.p[0] - top.pose.p[0], q.pose.p[1] - top.pose.p[1]) > COUNTER.side * 0.55) continue;
        if (!next || q.pose.p[2] < next.pose.p[2]) next = q;
      }
      if (!next) return pile;
      pile.push(next);
      top = next;
    }
  }

  /** Take a counter in hand at a point of it, with what lies on it. */
  grab(id: string, at: readonly [number, number, number]): void {
    this.whenSim(sim => {
      const p = this.get(id);
      if (p.state === 'gone' || p.state === 'moving') return;
      const pile = this.pileOn(p);
      for (const q of pile) this.stir(q);
      sim.grab(pile.map(q => q.n), at);
      this.touch();
    });
  }

  // ---- what is under the pointer ---------------------------------------------------------------------

  private ray(x: number, y: number): { o: Vec3; d: Vec3 } | null {
    const cam = this.env.camera();
    const [nx, ny] = ndcOf(x, y, cam.css);
    let pair: [Vec3, Vec3];
    try {
      pair = rayThrough(invert(cam.viewProj), nx, ny) as [Vec3, Vec3];
    } catch {
      return null;
    }
    const [a, b] = pair;
    return { o: a, d: [b[0] - a[0], b[1] - a[1], b[2] - a[2]] };
  }

  /** The point of a horizontal plane under a CSS-pixel point, or null. */
  planeUnder(x: number, y: number, z: number): [number, number] | null {
    const r = this.ray(x, y);
    if (!r || Math.abs(r.d[2]) < 1e-12) return null;
    const t = (z - r.o[2]) / r.d[2];
    return t > 0 ? [r.o[0] + r.d[0] * t, r.o[1] + r.d[1] * t] : null;
  }

  /** What the pointer's ray meets first: a counter, a board, the table. */
  hitAt(x: number, y: number): Hit {
    const r = this.ray(x, y);
    const none: Hit = { piece: null, point: [0, 0, 0], normal: [0, 0, 1], on: 'nothing' };
    if (!r) return none;
    let best: Hit = none;
    let bestT = Infinity;
    const half: Vec3 = [COUNTER.side / 2, COUNTER.side / 2, T / 2];
    for (const p of this.list) {
      if (p.state === 'gone' || p.scale < 0.5) continue;
      const lift = p.shown.lift * chosenLift();
      const inv = quatConj(p.pose.q);
      const o = rotate(inv, [r.o[0] - p.pose.p[0], r.o[1] - p.pose.p[1], r.o[2] - p.pose.p[2] - lift]);
      const d = rotate(inv, r.d);
      let t0 = -Infinity;
      let t1 = Infinity;
      let axis = 0;
      let sign = 1;
      let miss = false;
      for (let k = 0; k < 3; k++) {
        const ok = o[k] as number;
        const dk = d[k] as number;
        const h = half[k] as number;
        if (Math.abs(dk) < 1e-12) {
          if (Math.abs(ok) > h) miss = true;
          continue;
        }
        let a = (-h - ok) / dk;
        let b = (h - ok) / dk;
        let s = -1;
        if (a > b) {
          [a, b] = [b, a];
          s = 1;
        }
        if (a > t0) {
          t0 = a;
          axis = k;
          sign = s;
        }
        if (b < t1) t1 = b;
      }
      if (miss || t0 > t1 || t0 <= 0 || t0 >= bestT) continue;
      bestT = t0;
      const n: Vec3 = [0, 0, 0];
      n[axis] = sign;
      best = { piece: p, point: [r.o[0] + r.d[0] * t0, r.o[1] + r.d[1] * t0, r.o[2] + r.d[2] * t0], normal: rotate(p.pose.q, n), on: 'counter' };
    }
    // The tray stands in the way of what is behind it: a counter in a well is met through the well's opening only.
    const tray = this.tray;
    const met = tray ? rayTray(tray.placed, r.o, r.d, tray.boxes) : null;
    if (met && met.t < bestT) return { piece: null, point: met.point, normal: met.normal, on: 'tray' };
    if (best.piece || r.d[2] >= 0) return best;
    const at = (z: number): Vec3 => {
      const t = (z - r.o[2]) / r.d[2];
      return [r.o[0] + r.d[0] * t, r.o[1] + r.d[1] * t, z];
    };
    const top = at(0);
    if (onBoards(this.env.layout, top[0], top[1])) return { piece: null, point: top, normal: [0, 0, 1], on: 'board' };
    return { piece: null, point: at(this.env.layout.table.z), normal: [0, 0, 1], on: 'table' };
  }

  /** What a plain click or a hover reports: the top counter under the pointer, its hex, that hex's stack from the bottom. */
  clickAt(x: number, y: number): ClickHit {
    const hit = this.hitAt(x, y);
    const p = hit.piece;
    // A lost counter is out of the game: a click on it, or on the tray, reports nothing.
    if (p && p.tray) return { counter: null, hex: -1, stack: [] };
    if (p) {
      // A counter is where the game has it: its home hex. One at home stands for its stack, whose top is taken.
      const stack = this.stackAt(p.home.hex);
      const top = p.state === 'loose' ? p : (stack[stack.length - 1] ?? p);
      return { counter: top.id, hex: p.home.hex, stack: stack.map(q => q.id) };
    }
    if (hit.on !== 'board') return { counter: null, hex: -1, stack: [] };
    const hex = this.hexAt(hit.point[0], hit.point[1]);
    return { counter: null, hex, stack: hex >= 0 ? this.stackAt(hex).map(q => q.id) : [] };
  }

  // ---- input -------------------------------------------------------------------------------------

  /** Whether a physical gesture is under way: the camera then leaves the pointer alone. */
  get handling(): boolean {
    return this.gesture !== null;
  }

  /**
   * A press. With Alt held it begins a physical gesture and the answer is true:
   * the page then does not pan. Otherwise it is remembered, to tell a click from
   * a drag when it is let go, and the page pans as it always has.
   */
  pointerDown(x: number, y: number, alt: boolean, shift: boolean): boolean {
    if (!alt) {
      this.press = { x, y };
      return false;
    }
    this.press = null;
    const hit = this.hitAt(x, y);
    const carry = shift && hit.piece !== null && hit.piece.state !== 'moving';
    const r = FEEL.fingerRadius;
    // Pressed on the side of a counter, the fingertip is set against that side at that height, not inside the stack.
    const wall = hit.piece !== null && Math.abs(hit.normal[2]) < 0.5;
    const offset: [number, number] = wall && !carry ? [hit.normal[0] * (r + 0.02), hit.normal[1] * (r + 0.02)] : [0, 0];
    this.gesture = { kind: carry ? 'carry' : 'push', x0: x, y0: y, x, y, moved: false, begun: false, over: false, hit, planeZ: hit.point[2], offset, age: 0, startedMs: 0 };
    void this.loadPhysics();
    if (carry && hit.piece) {
      const g = this.gesture;
      const id = hit.piece.id;
      this.whenSim(() => {
        if (g.over) return;
        this.grab(id, hit.point);
        g.begun = true;
      });
    }
    this.setHover(null);
    this.touch();
    return true;
  }

  pointerMove(x: number, y: number, alt = false): void {
    const g = this.gesture;
    if (!g) {
      if (this.press && Math.hypot(x - this.press.x, y - this.press.y) > CLICK_PX) this.press = null;
      // With Alt held a click would poke, not take: nothing is shown as about to be taken.
      if (alt) {
        if (this.lastHover !== 'alt') {
          this.lastHover = 'alt';
          this.setHover(null);
          if (this.clickers.length === 0) this.env.tint('path', []);
        }
      } else this.reportHover(x, y);
      return;
    }
    g.x = x;
    g.y = y;
    if (!g.moved && Math.hypot(x - g.x0, y - g.y0) > CLICK_PX - 1) {
      g.moved = true;
      if (g.kind === 'push') {
        this.whenSim(sim => {
          if (g.over) return;
          const start = this.fingerStart(g);
          sim.fingerDown(start[0], start[1], start[2], this.fingerIsHeld(g));
          g.begun = true;
          this.aim(g);
        });
      }
    }
    this.aim(g);
    this.touch();
  }

  /**
   * A fingertip put down on the top of a counter rests on it, pressed, and drags
   * it by its grip; anywhere else it keeps the height it was put down at: along
   * the board and on past the board's edge at the same height (so that what it
   * sweeps goes over the edge), or against a counter's side at the height of
   * that counter.
   */
  private fingerIsHeld(g: Gesture): boolean {
    return !(g.hit.piece !== null && g.hit.normal[2] >= 0.5);
  }

  /** Where the fingertip is put down for a push (its underside): on what was pressed, or beside it at that height. */
  private fingerStart(g: Gesture): Vec3 {
    const x = g.hit.point[0] + g.offset[0];
    const y = g.hit.point[1] + g.offset[1];
    const wall = g.offset[0] !== 0 || g.offset[1] !== 0;
    if (!wall) return [x, y, g.hit.point[2]];
    const floor = onBoards(this.env.layout, x, y) ? 0 : this.env.layout.table.z;
    return [x, y, Math.max(floor, g.hit.point[2] - FEEL.fingerHalfHeight)];
  }

  /** Send the finger, or the hand, to where the pointer is. */
  private aim(g: Gesture): void {
    const sim = this.sim;
    if (!sim || !g.begun) return;
    if (g.kind === 'push') {
      const at = this.planeUnder(g.x, g.y, g.planeZ);
      if (at) sim.fingerTo(at[0] + g.offset[0], at[1] + g.offset[1]);
    } else {
      // It lifts as it is taken: quickly at first, then held at its height, always under the pointer.
      const k = Math.min(1, g.age / 0.16);
      const z = g.planeZ + FEEL.carryLift * (1 - (1 - k) * (1 - k));
      const at = this.planeUnder(g.x, g.y, z);
      if (at) sim.handTo(at[0], at[1], z);
    }
  }

  /** The pointer is let go. True when it ended a physical gesture. */
  pointerUp(x: number, y: number): boolean {
    const g = this.gesture;
    if (g) {
      g.x = x;
      g.y = y;
      this.aim(g);
      const piece = g.hit.piece;
      if (g.kind === 'push' && !g.moved && piece) this.poke(piece.id, g.hit.point);
      else if (g.kind === 'push' && g.moved && !g.begun) {
        // Let go before the engine had loaded: the push is played as it was made.
        const start = this.fingerStart(g);
        const end = this.planeUnder(x, y, g.planeZ);
        const seconds = Math.max(0.05, g.age);
        if (end) this.whenSim(sim => sim.scriptPush([start[0], start[1]], [end[0] + g.offset[0], end[1] + g.offset[1]], seconds, start[2], this.fingerIsHeld(g)));
      }
      this.endGesture();
      this.touch();
      return true;
    }
    const press = this.press;
    this.press = null;
    if (press && Math.hypot(x - press.x, y - press.y) <= CLICK_PX) {
      const hit = this.clickAt(x, y);
      this.clicks++;
      if (this.clickers.length > 0) for (const h of [...this.clickers]) h(hit);
      else this.user?.click(hit);
      this.lastHover = '';
      this.reportHover(x, y);
      this.touch();
    }
    return false;
  }

  /** The pointer has left the page. */
  pointerLeave(): void {
    this.press = null;
    if (this.lastHover !== 'none') {
      this.lastHover = 'none';
      const hit = { counter: null, hex: -1 };
      if (this.hoverers.length > 0 || this.clickers.length > 0) {
        for (const h of [...this.hoverers]) h(hit);
        this.setHover(null);
      } else this.user?.hover(hit);
    }
  }

  private endGesture(): void {
    const g = this.gesture;
    if (!g) return;
    g.over = true;
    this.gesture = null;
    if (this.sim) {
      if (g.kind === 'push') this.sim.fingerUp();
      else this.sim.release();
    }
  }

  private reportHover(x: number, y: number): void {
    const hit = this.clickAt(x, y);
    const key = `${hit.counter ?? ''}:${hit.hex}`;
    if (key === this.lastHover) return;
    this.lastHover = key;
    const report = { counter: hit.counter, hex: hit.hex };
    if (this.hoverers.length > 0 || this.clickers.length > 0) {
      for (const h of [...this.hoverers]) h(report);
      // With a game in charge the table still shows which counter a click would report.
      this.setHover(hit.counter);
    } else this.user?.hover(report);
  }

  /**
   * A key, by its place on the keyboard (`event.code`). Space sends everything
   * loose home; B bumps the table; the rest are the default user's (Escape, R).
   * True when the key was used.
   */
  key(code: string): boolean {
    if (code === 'Space') {
      this.goHome();
      return true;
    }
    if (code === 'KeyB') {
      this.bump();
      return true;
    }
    if (this.clickers.length === 0 && this.user) return this.user.key(code);
    return false;
  }

  // ---- stepping ------------------------------------------------------------------------------------

  /**
   * Advance everything by a frame's worth of time: travels, the physics world
   * (in fixed steps, when it has anything awake), the easing of marks. Says
   * whether anything is still moving; when nothing is, the page stops drawing.
   */
  step(dt: number, now?: number): boolean {
    this.clock = now ?? this.clock + dt;
    let moving = this.advanceTravels(dt);
    if (this.rolls.step(dt, this.clock)) moving = true;
    const g = this.gesture;
    if (g) {
      g.age += dt;
      this.aim(g);
      moving = true;
    }
    const sim = this.sim;
    if (sim && sim.busy) {
      this.acc += dt;
      let n = Math.floor(this.acc / STEP_S + 1e-9);
      if (n > PHYS.maxStepsAFrame) {
        n = PHYS.maxStepsAFrame;
        this.acc = n * STEP_S;
      }
      for (let k = 0; k < n; k++) this.simStep();
      this.acc -= n * STEP_S;
      this.alpha = sim.busy ? Math.min(1, Math.max(0, this.acc / STEP_S)) : 1;
      moving = true;
    } else {
      this.acc = 0;
      this.alpha = 1;
    }
    if (this.loading && !sim) moving = true;
    if (this.easeMarks(dt)) moving = true;
    if (this.cues.step(dt)) moving = true;
    // The frame after the last movement still shows something new: where everything came to rest.
    if (moving || this.wasMoving) this.stamp++;
    this.wasMoving = moving;
    return moving;
  }

  /** Ease every mark toward what it should show. */
  private easeMarks(dt: number): boolean {
    const k = 1 - Math.exp(-dt / FEEL.markTau);
    const kClose = 1 - Math.exp(-dt / CLOSE.tau);
    let any = false;
    // A selected counter rides a hair high, and so does everything lying on it in its stack; a lit one (the
    // group in hand) rides less high, and what lies on it with it. Each rides as high as the highest ride asked of it.
    const lifted = new Map<Piece, number>();
    const raise = (p: Piece, by: number): void => {
      if ((lifted.get(p) ?? 0) < by) lifted.set(p, by);
    };
    for (const p of this.list) {
      if (p.off) continue;
      const by = p.marks.selected ? 1 : isLit(p) ? LIT.lift / chosenLift() : 0;
      if (by <= 0) continue;
      if (p.state === 'moving') raise(p, by);
      if (p.state !== 'home') continue;
      for (const q of this.stackAt(p.home.hex)) if (q.home.place >= p.home.place && q.state === 'home') raise(q, by);
    }
    // What a lifted counter carries is lifted with it: the two are taken up as one.
    for (const p of this.list) {
      if (p.notes.carriedBy === null || p.off) continue;
      const carrier = this.byId.get(p.notes.carriedBy);
      const by = carrier ? (lifted.get(carrier) ?? 0) : 0;
      if (carrier && by > (lifted.get(p) ?? 0) && carrier.home.hex === p.home.hex && carrier.home.place === p.home.place + 1 && (p.state === 'home' || p.ride !== null)) raise(p, by);
    }
    for (const p of this.list) {
      // The pulse of a counter first lit. It waits while the view glides to it (not for ever); one that had only just
      // begun when the view set off begins again when the view has arrived.
      if (p.pulse !== null) {
        if (this.viewGliding && p.pulse < LIT.pulseRewindS && p.pulseWaited < LIT.pulseWaitMaxS) {
          p.pulse = 0;
          p.pulseWaited += dt;
        } else p.pulse += dt;
        if (p.pulse >= LIT.pulseS) p.pulse = null;
        any = true;
      }
      // The swells of a counter just chosen, and of a close attack's glow just come on.
      if (p.chosenPulse !== null) {
        p.chosenPulse += dt;
        if (p.chosenPulse >= CHOSEN.pulseS) p.chosenPulse = null;
        any = true;
      }
      if (p.closePulse !== null) {
        p.closePulse += dt;
        if (p.closePulse >= CLOSE.pulseS) p.closePulse = null;
        any = true;
      }
      const s = p.shown;
      const want = {
        lift: p.live ? 0 : (lifted.get(p) ?? 0),
        selected: p.marks.selected ? 1 : 0,
        hover: p.id === this.hoverId ? 1 : 0,
        canAct: p.marks.canAct ? 1 : 0,
        spent: p.marks.spent ? 1 : 0,
        suppressed: p.marks.suppressed ? 1 : 0,
        target: p.marks.target ? 1 : 0,
        active: p.notes.active ? 1 : 0,
        revealed: p.notes.revealed ? 1 : 0,
        pick: p.notes.pick ? 1 : 0,
        lit: isLit(p) ? 1 : 0,
        moved: p.notes.moved ? 1 : 0,
        close: p.notes.close ? 1 : 0,
      };
      for (const name of ['lift', 'selected', 'hover', 'canAct', 'spent', 'suppressed', 'target', 'active', 'revealed', 'pick', 'lit', 'moved', 'close'] as const) {
        const d = want[name] - s[name];
        if (Math.abs(d) < 0.004) s[name] = want[name];
        else {
          // The red glow of a close attack comes up more slowly than the other marks: it is seen coming on.
          s[name] += d * (name === 'close' ? kClose : k);
          any = true;
        }
      }
    }
    return any;
  }

  /** Where a counter is drawn: between its last two physics steps while it is a live body, and a hair high while selected. */
  drawn(p: Piece, into: Pose): void {
    const a = p.live && !p.asleep ? this.alpha : 1;
    if (a >= 1) {
      into.p[0] = p.pose.p[0];
      into.p[1] = p.pose.p[1];
      into.p[2] = p.pose.p[2];
      into.q[0] = p.pose.q[0];
      into.q[1] = p.pose.q[1];
      into.q[2] = p.pose.q[2];
      into.q[3] = p.pose.q[3];
    } else {
      into.p[0] = p.prev.p[0] + (p.pose.p[0] - p.prev.p[0]) * a;
      into.p[1] = p.prev.p[1] + (p.pose.p[1] - p.prev.p[1]) * a;
      into.p[2] = p.prev.p[2] + (p.pose.p[2] - p.prev.p[2]) * a;
      const q = slerp(p.prev.q, p.pose.q, a);
      into.q[0] = q[0];
      into.q[1] = q[1];
      into.q[2] = q[2];
      into.q[3] = q[3];
    }
    into.p[2] += p.shown.lift * chosenLift();
  }

  // ---- readings ------------------------------------------------------------------------------------

  readings(): PieceReading[] {
    return this.list.map(p => {
      const up = rotate(p.pose.q, [0, 0, 1])[2];
      const ex = rotate(p.pose.q, [1, 0, 0]);
      return {
        id: p.id,
        unit: p.unit,
        side: p.side,
        hex: p.home.hex,
        place: p.home.place,
        position: [p.pose.p[0], p.pose.p[1], p.pose.p[2]],
        turn: [p.pose.q[0], p.pose.q[1], p.pose.q[2], p.pose.q[3]],
        yawDeg: Math.atan2(ex[1], ex[0]) / RAD,
        faceUp: up > 0,
        state: p.state === 'moving' ? 'easing' : p.tray ? 'gone' : p.state,
        asleep: !p.live || p.asleep,
        over: p.state === 'gone' || !onBoards(this.env.layout, p.pose.p[0], p.pose.p[1]) || p.pose.p[2] < -T ? -1 : this.hexAt(p.pose.p[0], p.pose.p[1]),
        marks: { ...p.marks },
        notes: { ...p.notes },
        lit: p.shown.lit,
        pulsing: p.pulse !== null,
        lift: p.shown.lift * chosenLift(),
        riding: p.ride !== null,
        tray: p.tray ? { well: p.tray.well, level: p.tray.level, settled: p.state === 'home' && !p.live } : null,
      };
    });
  }

  /** What the cues show now (lines with their tags, routes, markers), for checks. */
  cueReadings(): CueReadings {
    return this.cues.readings();
  }

  /**
   * Draw the chosen counter and Spent in another of their treatments (dims.ts: `MARK_LOOK`), for showing them side by
   * side. Counters whose turn on their hex changes with it ease to their new pose.
   */
  setMarkLook(look: { chosen?: typeof MARK_LOOK.chosen; spent?: typeof MARK_LOOK.spent }): void {
    const was = new Map(this.list.map(p => [p, markTurnDeg(p.marks)] as const));
    if (look.chosen !== undefined) MARK_LOOK.chosen = look.chosen;
    if (look.spent !== undefined) MARK_LOOK.spent = look.spent;
    for (const p of this.list) {
      if (p.off || markTurnDeg(p.marks) === was.get(p)) continue;
      if (p.state === 'home' || p.state === 'moving') this.sendHome(p, 0);
    }
    this.touch();
  }

  /** The counters marked selected. */
  selectedIds(): string[] {
    return this.list.filter(p => p.marks.selected && !p.off).map(p => p.id);
  }
}
