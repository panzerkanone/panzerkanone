/**
 * The controller: the click-driven play of a turn. It turns a click on a
 * counter or a hex and a few keys into selections, previews and submitted
 * actions, and holds no rendering. It offers nothing that is not among the
 * seat's legal actions: every action it submits is one of the objects the
 * port's legal() listed, found again in a fresh list at the moment it is sent.
 * It knows no rule: what each legal action would do it asks the reading
 * (reading.ts), what it calls things it takes from the reading's words, and
 * why a thing cannot be done it asks the reading too (`why`).
 *
 * Two rules hold for every input (the owner's, 2026-11-13):
 *
 *   Pointing shows, one click does. Whatever is under the pointer shows what
 *   a click there would do; a click does it at once. Nothing is confirmed by
 *   a second click. One function says what a click at a place would do
 *   (planAt), and both the preview and the click are made from its answer, so
 *   the two cannot differ.
 *
 *   Every input is answered, done or refused. A click or key that can do
 *   nothing says why in a few true words (the model's `answer`, and on the
 *   table a mark at the place); it never changes what was chosen.
 *
 * The gestures of any game (play):
 *   click one of your units that can act     choose it: the hexes it can reach and the enemy
 *                                            units it can hit are shown
 *   click a hex it can reach                 it moves there
 *   click an enemy it can hit                it attacks
 *   Ctrl-, Cmd- or Shift-click another       add it to those that will act together (again: take it out);
 *     of your units                          a click on a target then sends them all
 *   Tab / Shift+Tab                          step through what can be chosen, each shown as if pointed at
 *   Enter                                    do what Tab has stepped to (never anything that is not shown)
 *   Escape                                   one step back
 *   E                                        end the phase
 * Set-up, in the first game: the seat's adviser proposes a whole set-up; N
 * deals another, Enter starts with it.
 *
 * The gestures of the fuller game (a reading that says it is one: GameInfo.rich), besides:
 *   (nothing)                                a side's turn opens by itself: the action that opens it carries
 *                                            no choice, and is sent for the seat without being asked for
 *   E                                        end the turn. While units can still act the first press only says
 *                                            how many and asks for E again; the second, with nothing done in
 *                                            between, ends it. With nothing left that can act, one press does
 *   a digit, or a group's button             go to that group of the seat's units and light it: it is the
 *                                            active group (the group in hand). It chooses no unit; a unit of
 *                                            another group that was chosen is let go, because the active group
 *                                            is always the chosen unit's. A group is the units that stand near
 *                                            one another, as the reading finds them
 *   click any unit of yours                  choose it, whatever its group; its group becomes the active one.
 *                                            With several chosen, the active group is the first one's
 *   (always)                                 in play exactly one of the seat's groups is the active one: at
 *                                            the start the first with a unit that could act, and from then
 *                                            on the one that holds the unit last chosen. Esc lets go of a
 *                                            unit and leaves its group active
 *   point at a hex a unit can reach          its path, its cost, and every enemy that would fire on the
 *                                            way, where, and with what chance; X shows the other route.
 *                                            Where a move would leave the unit something it can still do
 *                                            this turn (an offer that `keeps`: a short move of armor, after
 *                                            which it can still fire or move on; a move of infantry with
 *                                            movement over, after which it can still charge a tank beside it
 *                                            or move on), the hex is of the nearer reach, which a board shades
 *                                            stronger, and the line says so; a move beyond it says that the
 *                                            unit will be spent. A unit that has moved so is chosen like
 *                                            any other: its reach is what is left of its movement
 *   C, then an enemy                         an attack by closing with it, by every unit chosen; G for
 *                                            whether they go in after
 *   V, then an enemy hex                     an attack by driving through it (and, where there are two
 *                                            ways out, then the hex to come out in)
 *   M, then a carrier                        get onto it; a carried unit is chosen by clicking its
 *                                            carrier again, by Tab, or by U, and gets down as a move
 *   T or K, then a hex                       call something down on it
 *   H                                        the side's next setting (one switch for the whole side)
 *   Tab / Shift+Tab                          choose the next (the previous) unit, as a click on it would: what it can do
 *                                            is shown at once, the table glides to it (the owner, 2026-11-14: "When your
 *                                            current unit is selected with Tab, it should be in move/attack mode"). The
 *                                            units go group by group, in a fixed order, from the unit last chosen. A unit
 *                                            that could act but has no legal action now (a gun with nothing in sight and
 *                                            no transport) is stepped to too, so that the player sees why: "No valid
 *                                            moves" floats up on it, and a moment later the next unit is chosen by itself.
 *                                            In a way switched on by its key (C, V, M, T, K), and while choosing where a
 *                                            drive comes out, Tab steps through that way's choices and Enter does the one
 *                                            stepped to, as before
 *   (after a move)                           a move that leaves the unit Moved (it can still fire, charge or move
 *                                            on) keeps it chosen: what it can still attack is shown at once, a target of
 *                                            a charge glowing red, and the line names it
 *   (a home way with one choice)             a unit whose first way to act has one thing to choose (a gun beside one
 *                                            transport) has it stepped to when it is chosen, so that Enter does it
 * Set-up by hand: click a unit in the tray (or Tab), then a hex of the zone; a
 * placed unit is moved the same way or taken back (Backspace); Enter hands the
 * set-up in; Q takes the one the scenario gives.
 *
 * A click on a counter means the counter; a click on bare hex means the hex.
 * So a unit moves onto a hex that holds one of its own side's units that can
 * still act by a click on the hex beside that counter; a click on the counter
 * chooses it instead. (A counter of the seat's that cannot act is no choice,
 * and a click on it in a hex the chosen unit can reach moves the unit there.)
 *
 * A stack (the owner, 2026-11-14: "It's hard to select a unit in a stack"): two
 * or more of the seat's own counters in one hex, a carried unit not counted (it
 * is its carrier's, lies under it and goes where it goes). A click on any
 * counter of a stack means the stack: it chooses the uppermost unit of it that
 * can still act, whichever counter the pointer touched and though a spent one
 * lies on top; a click on the chosen unit's own stack again chooses the next of
 * them that can act, round and round (it never lets go: that is Esc's); with
 * the adding modifier held it adds the uppermost that can act and is not yet
 * chosen, and when all of them are, takes out the one touched. Whatever is
 * chosen is brought to the top of its stack (game.ts tells the table), its
 * passenger under it. A stack none of whose units can act is answered as a
 * counter that cannot act is.
 * On bare hex that holds an enemy a click fires at what can be fired at there;
 * when nothing can, it is a move into the hex, and is refused as one.
 */
import { labelOf } from '../../../engine/core/hex';
import { chanceLabels } from './chances';
import type { ChanceLabel } from './chances';
import { ADD_CLICK } from './keys';
import type { AdviceModel, AnswerModel, CardModel, ControlId, ControlModel, ControlView, OddsModel, OddsRow, PointModel, Segment, ShotRow, ThreatModel } from './model';
import { percentOf, percentOfShare, sideNameOf, stockOf } from './model';
import type { IntentAct, TableAnswer } from './pieces-port';
import type { SeatPort } from './port';
import type { Attempt, Forecast, GameInfo, GroupNow, Offer, Position, Reading } from './reading';

export interface Hit {
  readonly counter: string | null;
  readonly hex: number;
  readonly stack: readonly string[];
  /**
   * This very counter is meant, and no other of its stack: Tab stepped to it, or the unit was picked by its name in a
   * list. Absent: the pointer touched it on the board, where a click on any counter of a stack means the stack.
   */
  readonly exact?: boolean;
}

/** What a click means while a unit is chosen: move or fire (`act`), or one of the second layer's ways to act. */
type Mode = 'act' | 'charge' | 'drive' | 'board' | 'call' | 'screen';

type Selection =
  | { readonly kind: 'none' }
  /** The units that will act: the first is the one chosen, the rest were added to it. */
  | { readonly kind: 'unit'; readonly units: readonly string[]; readonly mode: Mode }
  /** A unit is to go through a hex, and the hex to come out in is still to be chosen. */
  | { readonly kind: 'drive'; readonly unit: string; readonly through: number }
  /** Set-up by hand: a unit picked up. */
  | { readonly kind: 'placing'; readonly unit: string };

type MoveOffer<A> = Extract<Offer<A>, { kind: 'move' }>;
type AttackOffer<A> = Extract<Offer<A>, { kind: 'attack' }>;
type PlaceOffer<A> = Extract<Offer<A>, { kind: 'place' }>;
type ChargeOffer<A> = Extract<Offer<A>, { kind: 'charge' }>;
type DriveOffer<A> = Extract<Offer<A>, { kind: 'drive' }>;
type BoardOffer<A> = Extract<Offer<A>, { kind: 'board' }>;
type CallOffer<A> = Extract<Offer<A>, { kind: 'call' }>;
type SettingOffer<A> = Extract<Offer<A>, { kind: 'setting' }>;

interface AttackSet<A> {
  readonly units: readonly string[];
  readonly offer: AttackOffer<A>;
}

interface OfferIndex<A> {
  /** unit, then destination hex: one route, or two (the cheaper first, then the less exposed). */
  readonly moves: ReadonlyMap<string, ReadonlyMap<number, readonly MoveOffer<A>[]>>;
  /** unit, then target: attacks declared one unit at a time. */
  readonly attacks: ReadonlyMap<string, ReadonlyMap<string, AttackOffer<A>>>;
  /** target, then every set of units that may attack it together as one action. */
  readonly sets: ReadonlyMap<string, readonly AttackSet<A>[]>;
  readonly charges: ReadonlyMap<string, readonly ChargeOffer<A>[]>;
  readonly drives: ReadonlyMap<string, readonly DriveOffer<A>[]>;
  readonly boards: ReadonlyMap<string, readonly BoardOffer<A>[]>;
  /** unit, then variant, then hex. */
  readonly calls: ReadonlyMap<string, ReadonlyMap<string, ReadonlyMap<number, CallOffer<A>>>>;
  /** The settings each part of the side may be given, by the part. */
  readonly settings: ReadonlyMap<string, readonly SettingOffer<A>[]>;
  readonly places: readonly PlaceOffer<A>[];
  readonly takeBacks: ReadonlyMap<string, Offer<A>>;
  readonly end: Offer<A> | null;
  readonly ready: Offer<A> | null;
  readonly auto: Offer<A> | null;
  readonly preset: Offer<A> | null;
  /** Units with something to do of their own, in the view's order. */
  readonly actable: readonly string[];
}

const NO_OFFERS: OfferIndex<never> = {
  moves: new Map(), attacks: new Map(), sets: new Map(), charges: new Map(), drives: new Map(), boards: new Map(), calls: new Map(),
  settings: new Map(), places: [], takeBacks: new Map(), end: null, ready: null, auto: null, preset: null, actable: [],
};
const NONE: Selection = { kind: 'none' };
/** How a board shows the nearer part of a reach, in the word a prompt uses for it: a shade stronger, which on the board's light ground is darker. */
const NEAR_SHADE = 'darker';
/** The key of each way to act besides moving and firing: the control's own, and the one a prompt names. */
const MODE_KEYS: Readonly<Record<Exclude<Mode, 'act'>, string>> = { charge: 'C', drive: 'V', board: 'M', call: 'T', screen: 'K' };
/** An attack whose chance of any effect is under this share is weak: the panel then says how it could be made stronger. A third. */
const WEAK: readonly [number, number] = [1, 3];

/** What is drawn while a plan is pointed at. */
interface Shown {
  readonly path?: readonly number[];
  readonly routes?: readonly (readonly number[])[];
  readonly aim?: readonly Segment[];
  readonly threats?: readonly ThreatModel[];
  readonly odds?: OddsModel | null;
  /** A unit a click would choose, while none is: what it could then do is shown as if it were. */
  readonly preview?: string;
}

/**
 * What a click at a place would do. `can` false: it would be refused, and
 * `line` says why. `run` does it. Both the preview and the click come from
 * this one answer.
 */
interface Plan {
  readonly act: IntentAct;
  readonly can: boolean;
  readonly hex: number;
  readonly unit: string | null;
  /** A few words for the table's label at the hex: "Fire 58%", "Move 4 of 11"; the reason when it cannot. */
  readonly words: string;
  /** One line for the panel: "Fire on Guard post 3: 58%." */
  readonly line: string;
  /** Not shown while only pointed at (bare ground with nothing to do there): said when it is clicked. */
  readonly quiet?: boolean;
  readonly run?: () => void;
  readonly shown?: Shown;
  /** How many routes there are for it (1 or 2), and which is shown. */
  readonly ways?: number;
  readonly way?: 0 | 1;
  /**
   * For a weak attack: its chance and how to raise it, as the prompt while it is pointed at. (The panel's line of what
   * a click would do is one line and is cut short when it is long; the prompt is not.)
   */
  readonly weak?: string;
  /**
   * For a move the reading has something to say of (it leaves the unit something it can still do this turn; or it
   * spends it where a shorter move would not): that sentence, as the prompt while the move is pointed at. The panel's
   * line of what a click would do is one line and is cut short when it is long; the prompt is not.
   */
  readonly told?: string;
}

function listed(names: readonly string[], and = 'and'): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} ${and} ${names[names.length - 1] as string}`;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every(x => b.includes(x));
}

function holds(all: readonly string[], part: readonly string[]): boolean {
  return part.every(x => all.includes(x));
}

function pushTo<K, T>(map: Map<K, T[]>, key: K, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "1 unit", "3 units". */
function unitsWord(n: number): string {
  return n === 1 ? '1 unit' : `${n} units`;
}

export interface ControllerDeps<V, A, E, Q> {
  readonly reading: Reading<V, A, E, Q>;
  /**
   * Send actions one after another. `next` is asked for each when the one
   * before it has been accepted and shown, so it reads a fresh list of legal
   * actions; null ends the run.
   */
  run(next: () => A | null): void;
  /** Something the model shows has changed. */
  changed(): void;
  /** An answer for the table to show at a place: here, only a refusal (what was done the play-back shows). */
  answer?(a: TableAnswer): void;
  /** The counters of a hex from the bottom, as the table has them. Absent: in the view's order. */
  stack?(hex: number): readonly string[];
  /** Ask the board to bring these hexes into view (a group gone to; where Tab has stepped). Absent: the board stays where it is. */
  goTo?(hexes: readonly number[]): void;
  /**
   * Resolves after about `ms` milliseconds (the game's clock): how long a unit with no valid moves that Tab stepped to
   * is shown before the next unit is chosen by itself. Absent: it is shown until the next key.
   */
  wait?(ms: number): Promise<void>;
}

/** What floats up on a unit Tab steps to that could act but has no legal action now (the owner's words, 2026-11-14). */
export const NO_MOVES = 'No valid moves';
/** How long such a unit is shown before Tab goes on to the next unit by itself, in milliseconds: about a second. */
export const NO_MOVES_MS = 1000;

export class Controller<V, A, E, Q> {
  private readonly reading: Reading<V, A, E, Q>;
  private readonly info: GameInfo;
  private readonly deps: ControllerDeps<V, A, E, Q>;
  /** The fuller game (the second layer of reading.ts). */
  private readonly rich: boolean;
  private port: SeatPort<V, A, E, Q>;
  private shown: V;
  private pos: Position;
  /** The view shown is the port's latest: the port's legal actions belong to it. */
  private current = false;
  /** Current, and nothing is on its way. */
  private free = false;
  /** Input is taken: free, and no action that carries no choice is waiting to be sent first. */
  private open = false;
  private selection: Selection = NONE;
  private pointed: { counter: string | null; hex: number } = { counter: null, hex: -1 };
  /** Where Tab has stepped to: it stands in for the pointer until the pointer moves. */
  private cursor: Hit | null = null;
  /** The player stepped there by Tab (a level Escape steps back from); false when a mode with one thing to choose stepped to it by itself. */
  private steppedByKey = false;
  /** The adding modifier is held (Shift, Ctrl or Cmd): a click on one of the seat's units adds it to those chosen, or takes it out. */
  private shiftDown = false;
  /**
   * The group in hand, which a player is told is the active group: the group of the unit chosen (of the first, when
   * several are), else the group the seat last went to (by its number or its button) or whose unit it last chose. Its
   * counters are lit. In play the seat always has one (null only while it has no group at all): see `rehand`.
   * `units`: its units as they last stood; `anchor`: the unit whose choosing made it the group in hand (null: it was
   * gone to). Groups re-form as units move.
   */
  private hand: { id: string; units: readonly string[]; anchor: string | null } | null = null;
  /**
   * The seat asked to end its turn while units could still act, and has done nothing since: the number of the port's
   * update it asked at. A second asking at the same update ends the turn. Null: it has not asked.
   */
  private endAsked: number | null = null;
  private cache: { seq: number; index: OfferIndex<A>; forecasts: Map<A, Forecast> } | null = null;
  private deal = 0;
  private proposal: { deal: number; seat: string | null; offers: readonly PlaceOffer<A>[] } | null = null;
  /** Which of two routes is shown: by the lesser risk (null), or the one asked for (0 the cheaper, 1 the less exposed). */
  private route: 0 | 1 | null = null;
  /** Units that close with a target go into its hex after. */
  private advance = true;
  /** The tray as last shown while input was open. */
  private trayKept: readonly string[] = [];
  /**
   * An action has been sent since the pointer last moved. A refusal at the place where the pointer still rests is then
   * not pointed out by itself (a crossed-out mark coming up on the unit that has just moved would read as the move's
   * own failure): it shows when the pointer moves, and a click there is answered as ever.
   */
  private rested = false;
  /** The answer to the last input. */
  private said: AnswerModel | null = null;
  private serial = 0;
  /** The unit last chosen (by a click, Tab or a list), or last stepped to by Tab, this turn: Tab goes on from it. */
  private tabFrom: string | null = null;
  /** A unit kept chosen through a move it is sending (a move that leaves it Moved): its mark stays on while the move is shown. */
  private kept: string | null = null;
  /** Units with no valid moves that Tab has just stepped to (their card is shown), until the next input or the step on. */
  private idleShown: readonly string[] | null = null;
  /** Goes up with every input: a step on by itself that was waiting is then not made. */
  private idleSerial = 0;

  constructor(port: SeatPort<V, A, E, Q>, deps: ControllerDeps<V, A, E, Q>) {
    this.port = port;
    this.deps = deps;
    this.reading = deps.reading;
    this.info = deps.reading.info;
    this.rich = this.info.rich === true;
    this.shown = port.view();
    this.pos = this.reading.position(this.shown);
  }

  /** The seat being played changes (hot-seat): everything chosen is let go. */
  setPort(port: SeatPort<V, A, E, Q>): void {
    this.port = port;
    this.cache = null;
    this.proposal = null;
    this.deal = 0;
    this.hand = null;
    this.endAsked = null;
    this.choose(NONE);
  }

  /**
   * The view now shown; whether it is the port's latest (nothing is waiting to
   * be played); and whether input is open (that, and no action on its way).
   */
  show(view: V, current: boolean, open: boolean): void {
    const moved = view !== this.shown;
    if (moved) {
      this.shown = view;
      this.pos = this.reading.position(view);
    }
    this.current = current;
    this.free = current && open;
    // An action that carries no choice goes first (it opens the seat's turn): until it has gone no input is taken.
    this.open = this.free && this.index().auto === null;
    // A unit kept chosen through its move is chosen like every other once the move has been shown.
    if (this.open) this.kept = null;
    // Another side's turn: next turn Tab starts again from the group in hand.
    const seat = this.port.seat;
    if (seat === null || !this.pos.deciding.includes(seat)) {
      this.tabFrom = null;
      this.idleShown = null;
    }
    if (current) this.settle();
    // The units have settled where this view has them: the groups are as they stand now, and one of them is in hand.
    if (moved || this.hand === null) this.rehand();
  }

  /** An action that carries no choice and comes before anything else, when nothing is on its way: the game sends it without being asked. */
  forced(): A | null {
    if (!this.free) return null;
    return this.index().auto?.action ?? null;
  }

  /** The adding modifier (Shift, Ctrl or Cmd) goes down or comes up. */
  shift(on: boolean): void {
    if (this.shiftDown === on) return;
    this.shiftDown = on;
    this.deps.changed();
  }

  /** What came of the action the seat last sent, once it has been shown: it takes the place of the words said when it was sent. */
  outcome(text: string): void {
    if (text === '') return;
    this.answer('done', text);
  }

  // ---------------------------------------------------------------------------
  // what the seat may do
  // ---------------------------------------------------------------------------

  private fresh(): { seq: number; index: OfferIndex<A>; forecasts: Map<A, Forecast> } {
    const seq = this.port.seq();
    if (this.cache && this.cache.seq === seq) return this.cache;
    const moves = new Map<string, Map<number, MoveOffer<A>[]>>();
    const attacks = new Map<string, Map<string, AttackOffer<A>>>();
    const sets = new Map<string, AttackSet<A>[]>();
    const charges = new Map<string, ChargeOffer<A>[]>();
    const drives = new Map<string, DriveOffer<A>[]>();
    const boards = new Map<string, BoardOffer<A>[]>();
    const calls = new Map<string, Map<string, Map<number, CallOffer<A>>>>();
    const settings = new Map<string, SettingOffer<A>[]>();
    const places: PlaceOffer<A>[] = [];
    const takeBacks = new Map<string, Offer<A>>();
    const able = new Set<string>();
    let end: Offer<A> | null = null;
    let ready: Offer<A> | null = null;
    let auto: Offer<A> | null = null;
    let preset: Offer<A> | null = null;
    const view = this.port.view();
    for (const action of this.port.legal()) {
      const o = this.reading.offer(view, action);
      switch (o.kind) {
        case 'move': {
          const to = o.path[o.path.length - 1];
          if (to === undefined) break;
          let m = moves.get(o.unit);
          if (!m) moves.set(o.unit, m = new Map());
          const had = m.get(to);
          if (!had) m.set(to, [o]);
          else if (this.rich) had.push(o);
          else if (o.cost < (had[0] as MoveOffer<A>).cost) m.set(to, [o]);
          able.add(o.unit);
          break;
        }
        case 'attack': {
          if (this.info.attackSets) {
            const units = [o.unit, ...(o.with ?? [])];
            pushTo(sets, o.target, { units, offer: o });
            for (const u of units) able.add(u);
          } else {
            let m = attacks.get(o.unit);
            if (!m) attacks.set(o.unit, m = new Map());
            m.set(o.target, o);
            able.add(o.unit);
          }
          break;
        }
        case 'charge':
          pushTo(charges, o.target, o);
          for (const u of o.units) able.add(u.unit);
          break;
        case 'drive':
          pushTo(drives, o.unit, o);
          able.add(o.unit);
          break;
        case 'board':
          pushTo(boards, o.unit, o);
          able.add(o.unit);
          break;
        case 'call': {
          let byVariant = calls.get(o.unit);
          if (!byVariant) calls.set(o.unit, byVariant = new Map());
          let byHex = byVariant.get(o.variant);
          if (!byHex) byVariant.set(o.variant, byHex = new Map());
          byHex.set(o.hex, o);
          able.add(o.unit);
          break;
        }
        case 'setting':
          pushTo(settings, o.of, o);
          break;
        case 'place':
          places.push(o);
          break;
        case 'takeBack':
          takeBacks.set(o.unit, o);
          break;
        case 'end':
          end = o;
          break;
        case 'ready':
          ready = o;
          break;
        case 'auto':
          auto = o;
          break;
        case 'preset':
          preset = o;
          break;
        default:
          break;
      }
    }
    const actable = this.reading.position(view).units.filter(u => able.has(u.id)).map(u => u.id);
    const index: OfferIndex<A> = { moves, attacks, sets, charges, drives, boards, calls, settings, places, takeBacks, end, ready, auto, preset, actable };
    this.cache = { seq, index, forecasts: new Map() };
    return this.cache;
  }

  private index(): OfferIndex<A> {
    if (!this.current) return NO_OFFERS;
    return this.fresh().index;
  }

  /** What a legal action would do, asked of the reading once for each action of a position. */
  private forecastOf(action: A): Forecast | null {
    if (!this.current || !this.reading.forecast) return null;
    const cache = this.fresh().forecasts;
    let f = cache.get(action);
    if (!f) {
      f = this.reading.forecast(this.port.view(), action, q => this.port.outcomes(q));
      cache.set(action, f);
    }
    return f;
  }

  /** Of one or two offers for the same thing by two routes: the one shown. Asked for by key, else the one of lesser risk (the first when equal). */
  private routed<T extends { readonly action: A }>(offers: readonly T[]): T | null {
    const first = offers[0];
    const second = offers[1];
    if (!first) return null;
    if (!second) return first;
    if (this.route !== null) return this.route === 0 ? first : second;
    const a = this.forecastOf(first.action)?.risk ?? 0;
    const b = this.forecastOf(second.action)?.risk ?? 0;
    return b < a ? second : first;
  }

  /**
   * Of one or two moves to one hex: as `routed`, but where one of the two would leave the unit something it can still
   * do this turn (`keeps`) and the other would not, that one is shown unless the other is asked for by key. The hex
   * is shaded as one of the nearer reach, and a click on it must do what the shade promises.
   */
  private routedMove(offers: readonly MoveOffer<A>[]): MoveOffer<A> | null {
    const first = offers[0];
    const second = offers[1];
    if (first && second && this.route === null && (first.keeps === true) !== (second.keeps === true)) return first.keeps === true ? first : second;
    return this.routed(offers);
  }

  /** The hexes a unit can move to and still do one thing more this turn: the nearer part of its reach. */
  private nearOf(idx: OfferIndex<A>, unit: string): number[] {
    const moves = idx.moves.get(unit);
    if (!moves) return [];
    const out: number[] = [];
    for (const [hex, offers] of moves) if (offers.some(o => o.keeps === true)) out.push(hex);
    return out;
  }

  /** What a unit can still do after a move into the nearer part of its reach, in the reading's few words ("fire or move on"); '' when it says nothing. */
  private nearStill(idx: OfferIndex<A>, unit: string): string {
    for (const offers of idx.moves.get(unit)?.values() ?? []) for (const o of offers) if (o.keeps === true && o.still !== undefined) return o.still;
    return '';
  }

  /** The one listed attack of exactly these units on this target: one action for the set, or (attacks declared unit by unit) each unit's own. */
  private fireOf(idx: OfferIndex<A>, units: readonly string[], target: string): AttackOffer<A> | null {
    if (this.info.attackSets) return (idx.sets.get(target) ?? []).find(s => sameSet(s.units, units))?.offer ?? null;
    const first = units[0];
    if (first === undefined || !units.every(u => idx.attacks.get(u)?.has(target))) return null;
    return idx.attacks.get(first)?.get(target) ?? null;
  }

  /** The targets these units, and no others, may attack together. */
  private targetsOf(idx: OfferIndex<A>, units: readonly string[]): string[] {
    if (!this.info.attackSets) {
      const first = units[0];
      if (first === undefined) return [];
      return [...(idx.attacks.get(first)?.keys() ?? [])].filter(t => units.every(u => idx.attacks.get(u)?.has(t)));
    }
    const out: string[] = [];
    for (const [target, sets] of idx.sets) if (sets.some(s => sameSet(s.units, units))) out.push(target);
    return out;
  }

  /** Whether these units are together in some attack on a target: with others besides, perhaps. */
  private canAim(idx: OfferIndex<A>, units: readonly string[], target: string): boolean {
    if (!this.info.attackSets) return units.every(u => idx.attacks.get(u)?.has(target));
    return (idx.sets.get(target) ?? []).some(s => holds(s.units, units));
  }

  /** The units that could be added to these for an attack on a target. */
  private fireJoiners(idx: OfferIndex<A>, units: readonly string[], target: string): string[] {
    return idx.actable.filter(u => !units.includes(u) && this.canAim(idx, [...units, u], target));
  }

  /** The charges on a target by exactly these units, with or without the advance: one route or two. */
  private chargesOf(idx: OfferIndex<A>, units: readonly string[], target: string): ChargeOffer<A>[] {
    const all = (idx.charges.get(target) ?? []).filter(c => sameSet(c.units.map(u => u.unit), units));
    const wanted = all.filter(c => (c.advance.length > 0) === this.advance);
    return wanted.length > 0 ? wanted : all;
  }

  /** The targets exactly these units may charge together. */
  private chargeTargets(idx: OfferIndex<A>, units: readonly string[]): string[] {
    const out: string[] = [];
    for (const [target, list] of idx.charges) if (list.some(c => sameSet(c.units.map(u => u.unit), units))) out.push(target);
    return out;
  }

  /** Whether these units are together in some charge: with others besides, perhaps. */
  private canCharge(idx: OfferIndex<A>, units: readonly string[], target?: string): boolean {
    for (const [t, list] of idx.charges) {
      if (target !== undefined && t !== target) continue;
      if (list.some(c => holds(c.units.map(u => u.unit), units))) return true;
    }
    return false;
  }

  /** The reading says the unit's type never acts in this way at all (absent: it does not say, and the unit may). */
  private never(unit: string, way: Exclude<Mode, 'act'>): boolean {
    const ways = this.info.units.find(u => u.id === unit)?.ways;
    return ways !== undefined && !ways.includes(way);
  }

  /**
   * Every way these units could attack a target by a click: their fire on it; their charge on it (exactly these units,
   * by the route shown and with the advance asked for); a drive through its hex (one unit alone), each way out.
   */
  private waysOn(idx: OfferIndex<A>, units: readonly string[], target: string): { fire: AttackOffer<A> | null; charge: ChargeOffer<A> | null; drives: DriveOffer<A>[] } {
    const hex = this.hexOf(target);
    const lead = units[0];
    return {
      fire: this.fireOf(idx, units, target),
      charge: this.routed(this.chargesOf(idx, units, target)),
      drives: units.length === 1 && lead !== undefined && hex >= 0 ? (idx.drives.get(lead) ?? []).filter(d => d.through === hex) : [],
    };
  }

  /**
   * The enemies a click attacks in the plain mode: those these units can fire on, then those they cannot fire on but can
   * charge together, then (one unit alone) those in a hex it can drive through.
   */
  private plainTargets(idx: OfferIndex<A>, units: readonly string[]): string[] {
    const out = this.targetsOf(idx, units);
    if (!this.rich) return out;
    for (const t of this.chargeTargets(idx, units)) if (!out.includes(t)) out.push(t);
    const lead = units[0];
    if (units.length === 1 && lead !== undefined) {
      const through = new Set((idx.drives.get(lead) ?? []).map(d => d.through));
      for (const u of this.pos.units) {
        if (u.destroyed || u.carriedBy !== null || this.mine(u.id) || !through.has(u.hex) || out.includes(u.id)) continue;
        out.push(u.id);
      }
    }
    return out;
  }

  /**
   * The action a click on a target attacks it with in the plain mode, for its chance: the fire, else the charge, else
   * the drive by the route shown (with two ways out or more the click first chooses the hex; the attack is the same).
   */
  private plainAction(idx: OfferIndex<A>, units: readonly string[], target: string): A | undefined {
    const ways = this.waysOn(idx, units, target);
    if (ways.fire) return ways.fire.action;
    if (ways.charge) return ways.charge.action;
    return this.routed(ways.drives)?.action;
  }

  /**
   * The other ways besides the click's own to attack a target, each with its key and its chance from the reading's
   * forecast: ["C: <the charge, in the reading's word> 68%"]. `own`: the way a click takes, left out.
   */
  private otherWays(idx: OfferIndex<A>, units: readonly string[], target: string, own: 'fire' | 'charge' | 'drive'): string[] {
    if (!this.rich) return [];
    const ways = this.waysOn(idx, units, target);
    const chanceOf = (action: A | undefined): string => {
      const c = action === undefined ? undefined : this.forecastOf(action)?.chance;
      return c && c.of > 0 ? ` ${percentOf(c.ways, c.of)}` : '';
    };
    const out: string[] = [];
    if (own !== 'charge' && ways.charge) out.push(`${MODE_KEYS.charge}: ${this.word('charge', 'attack').toLowerCase()}${chanceOf(ways.charge.action)}`);
    if (own !== 'drive' && ways.drives.length > 0) out.push(`${MODE_KEYS.drive}: ${this.word('drive', 'drive').toLowerCase()}${chanceOf(this.routed(ways.drives)?.action)}`);
    return out;
  }

  /** The key letters of the other ways to attack a target, for the mark on its chance card: "C", "V". */
  private otherKeys(idx: OfferIndex<A>, units: readonly string[], target: string): string {
    const ways = this.waysOn(idx, units, target);
    const own = ways.fire ? 'fire' : ways.charge ? 'charge' : 'drive';
    return [own !== 'charge' && ways.charge ? MODE_KEYS.charge : '', own !== 'drive' && ways.drives.length > 0 ? MODE_KEYS.drive : ''].join('');
  }

  /** The modes a unit has, in the order they are offered. */
  private modesOf(idx: OfferIndex<A>, unit: string): Mode[] {
    const out: Mode[] = [];
    // The plain mode first wherever a click in it does something: a move, fire, and in the fuller game a charge or a drive
    // (a click on the enemy makes them), so that a unit that can only charge is chosen like every other, with what a click does.
    if (idx.moves.has(unit) || this.attacker(idx, unit) || (this.rich && (this.canCharge(idx, [unit]) || idx.drives.has(unit)))) out.push('act');
    if (idx.calls.get(unit)?.has('call')) out.push('call');
    if (idx.calls.get(unit)?.has('screen')) out.push('screen');
    if (this.canCharge(idx, [unit])) out.push('charge');
    if (idx.drives.has(unit)) out.push('drive');
    if (idx.boards.has(unit)) out.push('board');
    return out;
  }

  /** The unit is in some attack: alone or with others. */
  private attacker(idx: OfferIndex<A>, unit: string): boolean {
    if (!this.info.attackSets) return (idx.attacks.get(unit)?.size ?? 0) > 0;
    for (const sets of idx.sets.values()) if (sets.some(s => s.units.includes(unit))) return true;
    return false;
  }

  private pick(idx: OfferIndex<A>, unit: string): Selection {
    return { kind: 'unit', units: [unit], mode: this.rich ? this.modesOf(idx, unit)[0] ?? 'act' : 'act' };
  }

  private choose(selection: Selection): void {
    this.selection = selection;
    this.route = null;
    this.cursor = null;
    this.kept = null;
    // The hand follows the unit chosen: the first, when several are (so taking the first out hands on to the next).
    const lead = selection.kind === 'unit' ? selection.units[0] : selection.kind === 'drive' ? selection.unit : undefined;
    if (lead !== undefined) {
      this.handTo(lead);
      this.tabFrom = lead;
      this.idleShown = null;
    }
  }

  /**
   * Choose a unit as a click on it does: in its first way to act. Where that way has one thing to choose (a gun beside
   * one transport, in the fuller game), it is stepped to already, so that Enter does it as the prompt says.
   */
  private chooseUnit(idx: OfferIndex<A>, unit: string): void {
    this.choose(this.pick(idx, unit));
    // The hand follows the unit: its group is the one in hand now.
    this.handTo(unit);
    const sel = this.selection;
    if (!this.rich || sel.kind !== 'unit' || sel.mode === 'act') return;
    const ring = this.ring(idx);
    if (ring.length === 1) {
      this.cursor = ring[0] as Hit;
      this.steppedByKey = false;
    }
  }

  /** Something was put in: a step on by itself that was waiting is not made, and the units it was waiting on are no longer shown. */
  private input(): void {
    this.idleSerial += 1;
    this.idleShown = null;
    // Anything put in lets go of E's question: E asks again from the start.
    this.endAsked = null;
  }

  /** Let go of a selection the fresh offers no longer support, and make the set-up proposal when it is wanted. */
  private settle(): void {
    const idx = this.index();
    const sel = this.selection;
    if (sel.kind === 'unit') {
      const units = sel.units.filter(u => idx.actable.includes(u));
      const lead = sel.units[0] as string;
      if (units[0] !== lead) this.choose(NONE);
      else if (sel.mode !== 'act' && !this.modesOf(idx, lead).includes(sel.mode)) this.choose(this.pick(idx, lead));
      else if (units.length !== sel.units.length) this.selection = { kind: 'unit', units, mode: sel.mode };
    }
    if (sel.kind === 'drive' && !(idx.drives.get(sel.unit) ?? []).some(d => d.through === sel.through)) this.choose(NONE);
    if (sel.kind === 'placing' && !idx.places.some(p => p.unit === sel.unit) && !idx.takeBacks.has(sel.unit)) this.choose(NONE);
    if (this.cursor !== null && !this.ring(idx).some(h => h.counter === this.cursor?.counter && h.hex === this.cursor.hex)) this.cursor = null;
    const seat = this.port.seat;
    const settingUp = this.pos.stage === 'setup' && seat !== null && this.pos.deciding.includes(seat);
    if (!settingUp || this.rich) {
      this.proposal = null;
    } else if ((!this.proposal || this.proposal.deal !== this.deal || this.proposal.seat !== seat) && idx.places.length > 0 && this.port.setUpAdvice) {
      const view = this.port.view();
      const offers: PlaceOffer<A>[] = [];
      for (const action of this.port.setUpAdvice(this.deal)) {
        const o = this.reading.offer(view, action);
        if (o.kind === 'place') offers.push(o);
      }
      this.proposal = { deal: this.deal, seat, offers };
    }
  }

  private hexOf(unit: string): number {
    return this.pos.units.find(u => u.id === unit)?.hex ?? -1;
  }

  private nameOf(unit: string): string {
    return this.info.units.find(u => u.id === unit)?.name ?? unit;
  }

  private names(units: readonly string[]): string {
    return listed(units.map(u => this.nameOf(u)));
  }

  /** The seat's groups as its units stand in the view shown, in the order of their numbers. */
  private myGroups(): readonly GroupNow[] {
    const seat = this.port.seat;
    return seat === null ? [] : (this.pos.groups ?? []).filter(g => g.seat === seat);
  }

  /** A unit has been chosen: its group is the group in hand. */
  private handTo(unit: string): void {
    const g = this.myGroups().find(x => x.units.includes(unit));
    if (g) this.hand = { id: g.id, units: g.units, anchor: unit };
  }

  /**
   * The group in hand, as the groups now stand (they re-form when units move, are lost, get onto a carrier). In order:
   * the group of the unit chosen (the first, when several are); the group that now holds the unit whose choosing last
   * made a group the one in hand; when it was gone to by its number, or that unit is gone, the group that holds most of
   * the units it had (the lower number when two hold as many); and when there is none of those (a game's first turn),
   * the seat's first group with a unit that could act, or its first group. So the seat always has one while it has
   * any group, and never two.
   */
  private rehand(): void {
    const groups = this.myGroups();
    const was = this.hand;
    const lead = this.chosenUnit();
    let now = lead === null ? undefined : groups.find(g => g.units.includes(lead));
    let anchor: string | null = now ? lead : null;
    if (!now && was !== null && was.anchor !== null) {
      now = groups.find(g => g.units.includes(was.anchor as string));
      if (now) anchor = was.anchor;
    }
    if (!now && was !== null) {
      let most = 0;
      for (const g of groups) {
        const held = g.units.filter(u => was.units.includes(u)).length;
        if (held > most) {
          most = held;
          now = g;
        }
      }
    }
    if (!now) {
      // A unit that could act: on the board, and neither spent nor suppressed as the view has it.
      const could = (id: string): boolean => this.pos.units.some(u => u.id === id && !u.destroyed && u.hex >= 0 && !u.spent && !u.suppressed);
      now = groups.find(g => g.units.some(could)) ?? groups[0];
    }
    this.hand = now ? { id: now.id, units: now.units, anchor } : null;
  }

  /** The name of a unit's side. */
  private sideOf(unit: string): string {
    return sideNameOf(this.info, this.info.units.find(u => u.id === unit)?.seat ?? null);
  }

  private mine(unit: string): boolean {
    return this.pos.units.find(u => u.id === unit)?.seat === this.port.seat;
  }

  private word(id: string, fallback: string): string {
    return this.info.words?.[id] ?? fallback;
  }

  private label(hex: number): string {
    return labelOf(this.info.grid, hex);
  }

  /** How many of the seat's units have not yet been placed (set-up). */
  private unplaced(): number {
    return this.pos.units.filter(u => u.seat === this.port.seat && u.hex < 0 && !u.destroyed).length;
  }

  /** The counters of a hex from the bottom. */
  private stackAt(hex: number): readonly string[] {
    if (hex < 0) return [];
    return this.deps.stack?.(hex) ?? this.pos.units.filter(u => u.hex === hex && !u.destroyed).map(u => u.id);
  }

  /** The unit is carried by another: it is its carrier's, and no counter of a stack in its own right. */
  private isCarried(unit: string): boolean {
    const by = this.pos.units.find(u => u.id === unit)?.carriedBy;
    return by !== undefined && by !== null;
  }

  /** The unit a unit carries, or null. */
  private carriedBy(carrier: string | null): string | null {
    if (carrier === null) return null;
    return this.pos.units.find(u => u.carriedBy === carrier && !u.destroyed)?.id ?? null;
  }

  /** The unit chosen: the first of those that will act. */
  private chosenUnit(): string | null {
    const sel = this.selection;
    return sel.kind === 'unit' ? sel.units[0] ?? null : sel.kind === 'drive' ? sel.unit : null;
  }

  // ---------------------------------------------------------------------------
  // answers
  // ---------------------------------------------------------------------------

  private answer(kind: 'done' | 'refused', text: string): void {
    this.serial += 1;
    this.said = { serial: this.serial, kind, text };
  }

  /** Something was done that sends nothing: say so. */
  private did(text: string): void {
    this.answer('done', text);
    this.deps.changed();
  }

  /** An input that can do nothing: say why, on the panel and (when it has a place) on the table. Nothing chosen changes. */
  private refuse(line: string, at: { readonly hex: number; readonly unit: string | null } | null, words?: string): void {
    this.answer('refused', line);
    if (at && at.hex >= 0) this.deps.answer?.({ kind: 'refused', hex: at.hex, unit: at.unit, words: words ?? line });
    this.deps.changed();
  }

  /** What a control does, as the words that follow "Unable to" when it is off. */
  private verbOf(id: ControlId, label: string): string {
    switch (id) {
      case 'end': return 'end the turn';
      case 'next': return 'step to the next unit';
      case 'aim': return 'step through the choices';
      case 'back': return 'go back';
      case 'confirm': return 'confirm';
      case 'route': return 'take the other route';
      case 'advance': return 'set the advance';
      case 'setting': return `change ${this.word('setting', 'the setting').toLowerCase()}`;
      case 'call':
      case 'screen': return `call ${this.callWhat(id)}`;
      case 'preset': return 'deploy for you';
      case 'takeBack': return 'take the unit back';
      case 'start': return this.rich ? 'hand in the set-up' : 'start';
      default: return label.toLowerCase();
    }
  }

  /** What a call is of, as the words after "call", in the reading's words: the first kind with an article, the second (a screen) without. */
  private callWhat(id: 'call' | 'screen'): string {
    const word = this.word(id, id).toLowerCase();
    return id === 'call' ? `a ${word}` : word;
  }

  /** Where the chosen unit is: the place of a refusal that has none of its own (a key, a button). */
  private chosenPlace(): { hex: number; unit: string | null } | null {
    const unit = this.chosenUnit();
    return unit === null ? null : { hex: this.hexOf(unit), unit };
  }

  /** Why nothing can be done at all just now: '' when input is open. */
  private closed(): string {
    if (this.open) return '';
    const seat = this.port.seat;
    if (this.pos.stage === 'over') return 'The game is over.';
    if (seat === null) return 'You are watching. The computer plays both sides.';
    if (!this.pos.deciding.includes(seat)) {
      if (this.pos.stage === 'setup') return 'The other side is setting up.';
      // The reading may know more of why the decision is not the seat's.
      const why = this.reading.why ? this.reading.why(this.shown, { kind: 'end' }) : '';
      return why !== '' ? `${capital(why)}.` : 'It\u2019s your opponent\u2019s turn.';
    }
    if (this.free) return 'Your turn is starting.';
    return 'The last action is still being shown.';
  }

  /** Why the reading says a thing tried cannot be done, as words for the table and a line for the panel. `subject` is the line's beginning ("X cannot fire on Y"). */
  private whyNot(attempt: Attempt, subject: string): { words: string; line: string } {
    const reason = this.reading.why ? this.reading.why(this.port.view(), attempt) : '';
    if (reason === '') return { words: 'Not now', line: `${subject} now.` };
    return { words: capital(reason), line: `${subject}: ${reason}.` };
  }

  private refusal(act: IntentAct, hit: { hex: number; counter: string | null }, why: { words: string; line: string }, quiet = false): Plan {
    return { act, can: false, hex: hit.hex, unit: hit.counter, words: why.words, line: why.line, ...(quiet ? { quiet } : {}) };
  }

  private send(action: A, line: string): void {
    this.answer('done', line);
    this.once(action);
  }

  /** Send actions one after another (ControllerDeps.run): the pointer is at rest from now until it moves. */
  private dispatch(next: () => A | null): void {
    this.rested = true;
    this.deps.run(next);
  }

  private once(action: A): void {
    let sent = false;
    this.dispatch(() => {
      if (sent) return null;
      sent = true;
      return action;
    });
  }

  // ---------------------------------------------------------------------------
  // what a click at a place would do
  // ---------------------------------------------------------------------------

  /** "Draws 2 shots: 44% chance unit is stopped or destroyed." `many`: several units go (one of them, then). */
  private riskWords(f: Forecast | null, many = false): string {
    if (!f) return '';
    if (f.shots.length === 0) return 'No fire on the way.';
    return `Draws ${f.shots.length === 1 ? '1 shot' : `${f.shots.length} shots`}: ${percentOfShare(f.risk)} chance ${many ? 'a unit' : 'unit'} is stopped or destroyed.`;
  }

  private threatsOf(f: Forecast | null): ThreatModel[] {
    if (!f) return [];
    return f.shots.map(s => ({ by: s.by, on: s.on, from: s.from, to: s.hex, label: percentOf(s.ways, s.of), ways: s.ways, kill: s.kill, of: s.of, live: false }));
  }

  /** The chance of an attack, in a word for a label ("58%") and in a few for a line ("58% to suppress or destroy, 17% to destroy"); '' when the reading gives none. */
  private chanceWords(f: Forecast | null): { short: string; long: string } {
    const c = f?.chance;
    if (!c || c.of <= 0) return { short: '', long: '' };
    // "58% to suppress or destroy, 17% to destroy": what the two chances are of is the reading's to say.
    const effect = percentOf(c.ways, c.of);
    const some = `${effect} ${this.word('chanceAny', 'to have an effect')}`;
    return { short: effect, long: c.kill > 0 ? `${some}, ${percentOf(c.kill, c.of)} ${this.word('chanceKill', 'to destroy')}` : some };
  }

  /** The odds of an attack by these units, with those already declared on the target, as it stands (attacks declared unit by unit). */
  private oddsOf(attackers: readonly string[], target: string): OddsModel | null {
    if (!this.open) return null;
    const declared = this.pos.units.filter(u => u.target === target && this.mine(u.id)).map(u => u.id);
    const all = [...declared, ...attackers.filter(a => !declared.includes(a))];
    if (all.length === 0) return null;
    const outcomes = this.port.outcomes(this.reading.attackQuery(all, target));
    return {
      title: `${listed(all.map(a => this.nameOf(a)))} on ${this.nameOf(target)} (${this.sideOf(target)})`,
      figures: this.reading.attackFigures(this.shown, all, target),
      rows: outcomes.map(o => {
        const words = this.reading.resultWords(o.result);
        return { name: words.name, effect: words.effect, percent: percentOf(o.ways, o.of), ways: `${o.ways} in ${o.of}`, share: o.of > 0 ? o.ways / o.of : 0 };
      }),
      pinned: false,
      note: 'Click it to declare the attack.',
    };
  }

  /** A forecast as the odds card shows it; `advice`: how the attack could be made stronger, when it is weak. */
  private oddsFrom(f: Forecast, note: string, advice?: AdviceModel | null): OddsModel {
    const tables = f.tables.map(t => ({
      title: t.title,
      rows: t.rows.map((r): OddsRow => ({ name: r.name, effect: r.effect, percent: percentOf(r.ways, r.of), ways: `${r.ways} in ${r.of}`, share: r.of > 0 ? r.ways / r.of : 0 })),
    }));
    const shots: ShotRow[] = f.shots.map(s => ({
      who: `${this.nameOf(s.by)} (${this.sideOf(s.by)})`,
      where: `on ${this.nameOf(s.on)} at ${this.label(s.hex)}`,
      percent: percentOf(s.ways, s.of), kill: percentOf(s.kill, s.of), share: s.of > 0 ? s.ways / s.of : 0,
    }));
    return {
      title: f.title, figures: f.figures, rows: tables[0]?.rows ?? [], pinned: false, note: [f.note, note].filter(s => s !== '').join(' '), tables, shots,
      ...(advice ? { advice } : {}),
    };
  }

  /** Up to four names in full; of more, the first three and how many others. */
  private namesBriefly(units: readonly string[]): string {
    if (units.length <= 4) return this.names(units);
    return `${units.slice(0, 3).map(u => this.nameOf(u)).join(', ')} and ${units.length - 3} others`;
  }

  /**
   * How a weak attack could be made stronger, from the seat's legal actions and their forecasts alone: the listed
   * attack on the same target, by these units and more, that has the best chance (the fewest units when two are as
   * good); and, where the reading says the target would be easier once fired on, who could fire on it now. Null when
   * the attack is not weak (or attacks are not made by sets).
   */
  private adviceFor(act: 'fire' | 'charge', idx: OfferIndex<A>, units: readonly string[], target: string, f: Forecast | null): AdviceModel | null {
    const c = f?.chance;
    if (!this.info.attackSets || !c || c.of <= 0 || c.ways * WEAK[1] >= c.of * WEAK[0]) return null;
    // Every set of units that holds these and more, with the action it would send.
    const wider: { units: readonly string[]; action: A }[] = [];
    if (act === 'fire') {
      for (const s of idx.sets.get(target) ?? []) if (s.units.length > units.length && holds(s.units, units)) wider.push({ units: s.units, action: s.offer.action });
    } else {
      const seen = new Set<string>();
      for (const offer of idx.charges.get(target) ?? []) {
        const all = offer.units.map(u => u.unit);
        const key = all.slice().sort().join(',');
        if (all.length <= units.length || !holds(all, units) || seen.has(key)) continue;
        seen.add(key);
        // As a click would send it: by the route shown and with the advance asked for.
        const sent = this.routed(this.chargesOf(idx, all, target));
        if (sent) wider.push({ units: all, action: sent.action });
      }
    }
    let best: { units: readonly string[]; ways: number; kill: number; of: number } | null = null;
    for (const w of wider) {
      const chance = this.forecastOf(w.action)?.chance;
      if (!chance || chance.of <= 0 || chance.ways * c.of <= c.ways * chance.of) continue;
      const better = best === null || chance.ways * best.of > best.ways * chance.of || (chance.ways * best.of === best.ways * chance.of && w.units.length < best.units.length);
      if (better) best = { units: w.units, ways: chance.ways, kill: chance.kill, of: chance.of };
    }
    const lines: string[] = [];
    let join: AdviceModel['join'] = null;
    if (best) {
      const add = best.units.filter(u => !units.includes(u));
      join = { add, with: units, target, act, ways: best.ways, kill: best.kill, of: best.of };
      const more = add.length === 1 ? `${this.namesBriefly(add)} can join this attack` : `${add.length} more units can join this attack: ${this.namesBriefly(add)}`;
      lines.push(`${more}. ${ADD_CLICK} ${add.length === 1 ? 'that unit' : 'them'} to raise the chance ${this.word('chanceAny', 'to have an effect')} to ${percentOf(best.ways, best.of)}.`);
    } else {
      lines.push('No more of your units can join this attack.');
    }
    // The units that could fire on the target now and are not in the attack: the listed fire on it with the best chance.
    let first: readonly string[] = [];
    if (act === 'charge' && f.easier !== undefined) {
      let most = 0;
      for (const s of idx.sets.get(target) ?? []) {
        if (s.units.some(u => units.includes(u))) continue;
        const chance = this.forecastOf(s.offer.action)?.chance;
        const share = chance && chance.of > 0 ? chance.ways / chance.of : 0;
        if (share > most) {
          most = share;
          first = s.units;
        }
      }
      if (first.length > 0) lines.push(`${this.namesBriefly(first)} can fire on the target first. ${f.easier}`);
    }
    return { lines, join, first };
  }

  /** The place the pointer is at, or the one Tab has stepped to. */
  private focus(): Hit | null {
    if (this.cursor !== null) return this.cursor;
    if (this.pointed.hex < 0 && this.pointed.counter === null) return null;
    const hex = this.pointed.counter !== null ? this.hexOf(this.pointed.counter) : this.pointed.hex;
    return { counter: this.pointed.counter, hex: hex >= 0 ? hex : this.pointed.hex, stack: this.stackAt(hex >= 0 ? hex : this.pointed.hex) };
  }

  /**
   * What a click on `hit` would do, with the adding modifier (`shift`) held or
   * not. Null: nothing at all (input is not the seat's to give; the preview
   * then shows nothing, and a click is answered by `closed`).
   */
  private planAt(hit: Hit, shift: boolean): Plan | null {
    if (!this.open) return null;
    const pos = this.pos;
    if (pos.stage === 'setup') return this.rich ? this.planSetUp(hit) : this.refusal('place', hit, { words: 'Set-up', line: 'Press Enter to start with this set-up, or N to deal another.' }, true);
    if (pos.stage !== 'play') return null;
    const idx = this.index();
    const sel = this.selection;
    const actable = (id: string): boolean => idx.actable.includes(id);
    const topMost = (pred: (id: string) => boolean): string | null => {
      for (let i = hit.stack.length - 1; i >= 0; i--) if (pred(hit.stack[i] as string)) return hit.stack[i] as string;
      return null;
    };
    const enemyHere = hit.counter !== null ? (this.mine(hit.counter) ? null : hit.counter) : topMost(id => !this.mine(id));
    const mineHere = hit.counter !== null ? (this.mine(hit.counter) ? hit.counter : null) : topMost(id => this.mine(id));

    // A click on a carrier that cannot act itself is a click on the unit it carries, when that one can.
    const under = hit.counter !== null && !actable(hit.counter) ? this.carriedBy(hit.counter) : null;
    const plainMode = sel.kind === 'none' || (sel.kind === 'unit' && sel.mode === 'act');

    // ---- a stack: a click on any of its counters means the stack (not while a click on a counter picks a carrier) ----
    const ownHere = hit.counter !== null && this.mine(hit.counter) ? hit.stack.filter(id => this.mine(id) && !this.isCarried(id)) : [];
    const stackHere = ownHere.length >= 2 && (sel.kind === 'none' || (sel.kind === 'unit' && sel.mode !== 'board'));
    // (A counter stepped to by Tab, or picked by its name in a list, is that counter and no other.)
    const stacked = stackHere && hit.exact !== true;
    /** The units of the stack that can act, in the view's order: a steady round to step through, whatever lies on top. */
    const round = stacked ? idx.actable.filter(id => ownHere.includes(id)) : [];
    /** The same, the uppermost first. */
    const fromTop = ownHere.filter(id => round.includes(id)).reverse();
    let stackPick: string | null = null;
    if (sel.kind === 'unit' && shift) {
      // Adding: the uppermost that can act and is not yet among those chosen (one that can act together with them, if any can).
      const chosen = sel.units;
      const free = fromTop.filter(id => !chosen.includes(id));
      const fits = (id: string): boolean => (sel.mode === 'charge' ? this.canCharge(idx, [...chosen, id]) : sel.mode === 'act' ? this.targetsTogether(idx, [...chosen, id]).length > 0 : false);
      stackPick = free.find(fits) ?? free[0] ?? null;
    } else if (sel.kind === 'unit' && sel.units.length === 1 && round.includes(sel.units[0] as string)) {
      // The chosen unit's own stack again: the next of them that can act (itself, when it is the only one).
      stackPick = round[(round.indexOf(sel.units[0] as string) + 1) % round.length] ?? null;
    } else {
      stackPick = fromTop[0] ?? null;
    }
    const c = stackPick ?? (under !== null && actable(under) && plainMode ? under : hit.counter);
    /** The stack the choice is made in, for its words; undefined: no stack. */
    const inStack = stackHere ? hit.stack : undefined;
    /** The seat's own counter under the click; and the one a click here would choose: that counter, or on bare hex the top one there that can act. */
    const clicked = c !== null && this.mine(c) ? c : null;
    const pickable = c !== null ? (clicked !== null && actable(clicked) ? clicked : null) : topMost(actable);

    // ---- nothing is chosen: a click chooses ----
    if (sel.kind === 'none' || sel.kind === 'placing') {
      if (pickable !== null) return this.selectPlan(idx, pickable, hit.hex, true, inStack);
      const own = clicked ?? mineHere;
      if (own !== null) return this.refusal('select', { hex: hit.hex, counter: own }, this.whyNot({ kind: 'select', unit: own }, 'Unable to act'));
      const first = idx.actable.length > 0
        ? { words: 'Choose a unit first', line: `Choose a unit first. ${idx.actable.length} of your units can still act.` }
        : { words: 'No unit can act', line: this.noneLeft() };
      return this.refusal(enemyHere !== null ? 'fire' : 'select', { hex: hit.hex, counter: enemyHere }, first, enemyHere === null);
    }

    // ---- a unit is to go through a hex: the click chooses where it comes out ----
    if (sel.kind === 'drive') {
      const through = (idx.drives.get(sel.unit) ?? []).filter(d => d.through === sel.through);
      const here = through.filter(d => d.exit === hit.hex);
      if (here.length > 0) return this.drivePlan(here, hit);
      const exits = new Set(through.map(d => d.exit)).size;
      return this.refusal('drive', hit, { words: 'Choose where to come out', line: `${this.word('drive', 'Drive')} through ${this.label(sel.through)}: click one of the ${exits} tinted hexes to come out in, or press Esc.` });
    }

    const units = sel.units;
    const lead = units[0] as string;
    const together = units.length > 1;

    // ---- the adding modifier: one of the seat's units into those that will act together, or out of them (on anything else it changes nothing) ----
    if (shift && c !== null && this.mine(c)) {
      if (units.includes(c)) {
        if (!together) return this.refusal('select', hit, { words: 'The only unit chosen', line: 'Unable to remove unit: no other unit is chosen.' });
        const rest = units.filter(u => u !== c);
        return {
          act: 'select', can: true, hex: hit.hex, unit: c, words: 'Remove', line: `Remove ${this.nameOf(c)}. ${this.names(rest)} ${rest.length > 1 ? 'act together' : 'acts alone'}.`,
          run: () => {
            this.choose({ kind: 'unit', units: rest, mode: sel.mode });
            this.did(`${this.nameOf(c)} removed. ${this.names(rest)} ${rest.length > 1 ? 'will act together' : 'acts alone'}.`);
          },
        };
      }
      if (!actable(c)) return this.refusal('select', hit, this.whyNot({ kind: 'select', unit: c }, 'Unable to act'));
      const all = [...units, c];
      // A unit whose type can never charge can never help a charge: that alone is refused (the owner, 2026-11-14).
      if (sel.mode === 'charge' && this.never(c, 'charge')) {
        return this.refusal('select', hit, { words: `Cannot ${this.word('charge', 'attack').toLowerCase()}`, line: `Unable to add: unit cannot ${this.word('charge', 'attack').toLowerCase()}.` });
      }
      const fits = sel.mode === 'charge' ? this.canCharge(idx, all) : sel.mode === 'act' ? this.targetsTogether(idx, all).length > 0 : false;
      // In the plain mode and in the charge a unit is always added, whether or not they have a target in common yet (the
      // owner, 2026-11-14: "CTRL-CLICK should always select any unselected tokens in a stack before it unselects", and of a
      // joint charge: "can't do joint attack with this unit even though it was the same kind of unit"); the answer
      // says what is missing. In a charge the others' targets are the ones to join: the reading says what that asks.
      const join = sel.mode === 'charge' && this.chargeTargets(idx, units).length > 0 ? this.word('chargeJoin', '') : '';
      const apart = fits ? '' : sel.mode === 'act' || sel.mode === 'charge' ? ` ${join !== '' ? join : 'No target in common yet.'}` : '';
      if (!fits && apart === '') {
        const line = `Unable to add unit: only fire and ${this.word('charge', 'an attack').toLowerCase()} can be made together.`;
        return this.refusal('select', hit, { words: 'Cannot act together', line });
      }
      const up = this.comesUp(c, inStack);
      const added = `${this.nameOf(c)} added${up ? ' and brought to the top of its stack' : ''}.`;
      return {
        act: 'select', can: true, hex: hit.hex, unit: c, words: 'Add',
        line: apart !== '' ? `Add ${this.nameOf(c)}${inStack ? ' from this stack' : ''}.${apart}` : `Add ${this.nameOf(c)}${inStack ? ' from this stack' : ''}: ${this.names(all)} act together.`,
        run: () => {
          this.choose({ kind: 'unit', units: all, mode: sel.mode });
          this.did(apart !== '' ? `${added}${apart}` : `${added} ${this.names(all)} will act together.`);
        },
      };
    }

    // ---- the chosen units' own business, by the mode they are in ----
    if (sel.mode === 'charge') {
      const targets = this.chargeTargets(idx, units);
      const target = enemyHere !== null && targets.includes(enemyHere) ? enemyHere : c === null ? topMost(id => targets.includes(id)) : null;
      if (target !== null) return this.chargePlan(idx, units, target, hit);
      if (enemyHere !== null && clicked === null) {
        const why = this.whyNot({ kind: 'charge', units, target: enemyHere }, `Unable to ${this.word('charge', 'attack').toLowerCase()}`);
        const more = idx.actable.filter(u => !units.includes(u) && this.canCharge(idx, [...units, u], enemyHere));
        return this.refusal('charge', { hex: hit.hex, counter: enemyHere }, more.length > 0 ? { words: why.words, line: `${why.line} ${ADD_CLICK} ${this.nameOf(more[0] as string)} to join in.` } : why);
      }
    } else if (sel.mode === 'drive') {
      const through = (idx.drives.get(lead) ?? []).filter(d => d.through === hit.hex);
      if (through.length > 0) return this.driveThrough(lead, through, hit);
      if (clicked === null) {
        return this.refusal('drive', { hex: hit.hex, counter: enemyHere }, this.whyNot({ kind: 'drive', unit: lead, hex: hit.hex }, `Unable to ${this.word('drive', 'drive').toLowerCase()}`));
      }
    } else if (sel.mode === 'board') {
      const offer = (idx.boards.get(lead) ?? []).find(b => b.carrier === c) ?? (c === null ? (idx.boards.get(lead) ?? []).find(b => hit.stack.includes(b.carrier)) : undefined);
      if (offer) {
        const f = this.forecastOf(offer.action);
        const line = `${this.word('board', 'Board')} ${this.nameOf(offer.carrier)}.${f && f.note !== '' ? ` ${f.note}` : ''}`;
        return {
          act: 'board', can: true, hex: hit.hex, unit: offer.carrier, words: this.word('board', 'Board'), line,
          run: () => {
            this.choose(NONE);
            this.send(offer.action, `${this.nameOf(lead)}: ${this.word('board', 'board').toLowerCase()} ${this.nameOf(offer.carrier)}.`);
          },
        };
      }
      if (clicked !== null && !actable(clicked)) {
        return this.refusal('board', { hex: hit.hex, counter: clicked }, this.whyNot({ kind: 'board', unit: lead, carrier: clicked }, `Unable to ${this.word('board', 'board').toLowerCase()}`));
      }
      if (clicked === null) return this.refusal('board', hit, { words: 'Click a transport', line: `${this.word('board', 'Board')}: click an outlined transport, or press Esc.` });
    } else if (sel.mode === 'call' || sel.mode === 'screen') {
      // A click on one of the seat's own counters is that counter, never a call on its hex: for that, the bare hex beside it.
      const call = clicked === null ? idx.calls.get(lead)?.get(sel.mode)?.get(hit.hex) : undefined;
      const word = this.word(sel.mode, sel.mode);
      if (call) {
        const f = this.forecastOf(call.action);
        return {
          act: sel.mode, can: true, hex: hit.hex, unit: hit.counter, words: word, line: `${word} on ${this.label(hit.hex)}.`,
          run: () => {
            this.choose(NONE);
            this.send(call.action, `${this.nameOf(lead)}: ${word.toLowerCase()} on ${this.label(hit.hex)}.`);
          },
          ...(f ? { shown: { odds: this.oddsFrom(f, '') } } : {}),
        };
      }
      if (clicked === null) {
        return this.refusal(sel.mode, hit, this.whyNot({ kind: 'call', unit: lead, hex: hit.hex, variant: sel.mode }, `Unable to call ${this.callWhat(sel.mode)} there`));
      }
    } else {
      // Fire, or a move; and, on an enemy the chosen units cannot fire on but can charge or drive through, that: one click
      // acts (the owner, 2026-11-14: "If a unit can close attack the ui should show it hovering mouse").
      const targets = this.plainTargets(idx, units);
      const target = enemyHere !== null && targets.includes(enemyHere) ? enemyHere : c === null ? topMost(id => targets.includes(id)) : null;
      if (target !== null) {
        const ways = this.waysOn(idx, units, target);
        if (ways.fire) return this.firePlan(idx, units, target, hit);
        if (ways.charge) return this.chargePlan(idx, units, target, hit);
        if (ways.drives.length > 0) return this.driveThrough(lead, ways.drives, { ...hit, hex: this.hexOf(target), counter: hit.counter ?? target });
      }
      // Onto the hex, though a counter that cannot be chosen lies in it (one of the seat's that has acted; an enemy that stops nothing).
      const moves = together ? undefined : idx.moves.get(lead)?.get(hit.hex);
      if (moves && moves.length > 0 && (c === null || !actable(c))) return this.movePlan(lead, moves, hit);
      // A click on an enemy's counter means fire on it; a click on the bare part of its hex means the hex, and a move into it.
      if (enemyHere !== null && hit.counter !== null && clicked === null) {
        const why = this.whyNot({ kind: 'attack', units, target: enemyHere }, 'Unable to fire');
        const more = this.fireJoiners(idx, units, enemyHere);
        const tail = [
          more.length > 0 ? ` ${ADD_CLICK} ${this.nameOf(more[0] as string)} to fire together.` : '',
          this.alsoWords(idx, units, enemyHere, 'fire'),
        ].join('');
        return this.refusal('fire', { hex: hit.hex, counter: enemyHere }, { words: why.words, line: `${why.line}${tail}` });
      }
    }

    // ---- one of the seat's own counters: a plain click on it chooses it (with a unit chosen, bare hex is the hex, and means a move) ----
    const another = clicked !== null && actable(clicked) ? clicked : null;
    if (another !== null) {
      if (another !== lead || together) return this.selectPlan(idx, another, hit.hex, false, inStack);
      if (stacked) {
        // Its own stack again, and it is the only unit of it that can act: it stays chosen (letting go is Esc's).
        const line = `${this.nameOf(lead)} is chosen. No other unit in this stack can act.`;
        return { act: 'select', can: true, hex: hit.hex, unit: lead, words: 'Chosen', line, run: () => this.did(line) };
      }
      // The chosen unit again, where there is no stack: the unit it carries, when that one can act; else let go.
      const others = hit.stack.filter(id => id !== lead && actable(id));
      const at = hit.stack.indexOf(lead);
      const next = others.find(id => hit.stack.indexOf(id) < at) ?? others[others.length - 1];
      if (next !== undefined) return this.selectPlan(idx, next, hit.hex, false);
      return {
        act: 'select', can: true, hex: hit.hex, unit: lead, words: 'Let go', line: 'Let go of the unit.',
        run: () => {
          this.choose(NONE);
          this.did('Unit let go.');
        },
      };
    }
    if (clicked !== null) return this.refusal('select', { hex: hit.hex, counter: clicked }, this.whyNot({ kind: 'select', unit: clicked }, 'Unable to act'));
    if (sel.mode !== 'act') {
      const word = this.word(sel.mode, sel.mode);
      return this.refusal(sel.mode, hit, { words: `${word}: not here`, line: `${word}: click ${this.modeTarget(sel.mode)}, or press Esc.` });
    }
    if (together) {
      return this.refusal('move', hit, { words: 'One at a time', line: 'Unable to move there: units move one at a time. Press Esc to remove the last unit added.' });
    }
    return this.refusal('move', hit, this.whyNot({ kind: 'move', unit: lead, hex: hit.hex }, 'Unable to move there'));
  }

  /**
   * Of the targets a click attacks in the plain mode, those it would attack at close quarters: those these units cannot
   * fire on, which a click attacks by a charge or a drive through their hex (the fuller game's). They glow red.
   */
  private closeOnes(idx: OfferIndex<A>, units: readonly string[], targets: readonly string[]): string[] {
    if (!this.rich) return [];
    return targets.filter(t => this.fireOf(idx, units, t) === null);
  }

  /** The enemies a line names: up to three by name ("T-34/76 1a or KV-1 1b"), more by how many ("4 enemy units"). */
  private aimWords(aims: readonly string[]): string {
    return aims.length <= 3 ? listed(aims.map(t => this.nameOf(t)), 'or') : `${aims.length} enemy units`;
  }

  /** The targets these units could attack together, others joining them or not. */
  private targetsTogether(idx: OfferIndex<A>, units: readonly string[]): string[] {
    if (!this.info.attackSets) return this.targetsOf(idx, units);
    const out: string[] = [];
    for (const [target, sets] of idx.sets) if (sets.some(s => holds(s.units, units))) out.push(target);
    return out;
  }

  /** What a mode asks to be clicked, in a few words. */
  private modeTarget(mode: Mode): string {
    if (mode === 'charge') return 'an enemy that glows red';
    if (mode === 'drive') return 'an enemy hex marked red';
    if (mode === 'board') return 'an outlined transport';
    return 'a tinted hex';
  }

  /** " C: <charge, in the reading's word> 68%." for each way besides `own` the units could also attack the target (otherWays). */
  private alsoWords(idx: OfferIndex<A>, units: readonly string[], target: string, own: 'fire' | 'charge' | 'drive'): string {
    const others = this.otherWays(idx, units, target, own);
    return others.length > 0 ? ` ${others.map(o => `${o}.`).join(' ')}` : '';
  }

  /** `stack`: the stack it is chosen in (the counters of its hex from the bottom), when the click was on a stack: the words then say which unit of it. */
  private selectPlan(idx: OfferIndex<A>, unit: string, hex: number, preview: boolean, stack?: readonly string[]): Plan {
    const can: string[] = [];
    if (idx.moves.has(unit)) can.push('move');
    if (this.targetsOf(idx, [unit]).length > 0) can.push('fire');
    for (const m of this.modesOf(idx, unit)) if (m !== 'act') can.push(this.word(m, m).toLowerCase());
    const up = this.comesUp(unit, stack);
    return {
      act: 'select', can: true, hex, unit, words: 'Choose', line: `Choose ${this.nameOf(unit)}${stack ? ' from this stack' : ''}.${can.length > 0 ? ` Unit can ${listed(can, 'or')}.` : ''}`,
      run: () => {
        this.chooseUnit(idx, unit);
        this.did(`${this.nameOf(unit)} chosen${up ? ' and brought to the top of its stack' : ''}.`);
      },
      ...(preview ? { shown: { preview: unit } } : {}),
    };
  }

  /** A unit chosen in a stack is not the counter lying on top of it: it will be brought up (the table is told by game.ts), and the answer says so. */
  private comesUp(unit: string, stack: readonly string[] | undefined): boolean {
    return stack !== undefined && stack.length > 1 && stack[stack.length - 1] !== unit;
  }

  private firePlan(idx: OfferIndex<A>, units: readonly string[], target: string, hit: Hit): Plan {
    const offer = this.fireOf(idx, units, target) as AttackOffer<A>;
    const to = this.hexOf(target);
    const aim = units.map(a => ({ from: this.hexOf(a), to })).filter(s => s.from >= 0 && s.to >= 0);
    const by = units.length > 1 ? ` by ${this.names(units)}` : '';
    if (!this.info.attackSets) {
      // Attacks declared unit by unit: one action for each, each found among the legal actions when its turn comes.
      const waiting = units.slice();
      return {
        act: 'fire', can: true, hex: hit.hex, unit: target, words: 'Attack', line: `Attack ${this.nameOf(target)}${by}: it is declared now and resolved when the phase ends.`,
        run: () => {
          this.choose(NONE);
          this.answer('done', `Attack on ${this.nameOf(target)}${by} declared.`);
          this.dispatch(() => {
            for (;;) {
              const unit = waiting.shift();
              if (unit === undefined) return null;
              const next = this.index().attacks.get(unit)?.get(target);
              if (next) return next.action;
            }
          });
        },
        shown: { aim, odds: this.oddsOf(units, target) },
      };
    }
    const f = this.forecastOf(offer.action);
    const chance = this.chanceWords(f);
    // Every other way to attack it, with its chance, after the click's own (the owner, 2026-11-14): "Fire 42%. C: <charge> 68%".
    const others = this.otherWays(idx, units, target, 'fire');
    const also = this.alsoWords(idx, units, target, 'fire');
    const advice = this.adviceFor('fire', idx, units, target, f);
    // What the chance already carries (a unit that fires after moving fires worse): said with the chance.
    const counted = f?.counted !== undefined ? ` ${f.counted}` : '';
    return {
      act: 'fire', can: true, hex: hit.hex, unit: target, words: `Fire${chance.short !== '' ? ` ${chance.short}` : ''}${others.map(o => `. ${o}`).join('')}`,
      line: `Fire on ${this.nameOf(target)}${by}.${chance.long !== '' ? ` ${chance.long}.` : ''}${counted}${advice ? ` ${advice.lines.join(' ')}` : ''}${also}`,
      run: () => {
        this.choose(NONE);
        this.send(offer.action, `${this.names(units)} ${units.length > 1 ? 'fire' : 'fires'} on ${this.nameOf(target)}.`);
      },
      shown: { aim, odds: f ? this.oddsFrom(f, '', advice) : null },
      ...(advice ? { weak: `Only ${chance.long}.${counted} ${advice.lines.join(' ')}` } : {}),
    };
  }

  private movePlan(unit: string, offers: readonly MoveOffer<A>[], hit: Hit): Plan {
    const chosen = this.routedMove(offers) as MoveOffer<A>;
    const f = this.forecastOf(chosen.action);
    const name = this.nameOf(unit);
    const at = this.label(hit.hex);
    // What becomes of the unit after the move, where the reading says a player should be told (it can still fire; it will be spent).
    const after = f?.after !== undefined ? ` ${f.after}` : '';
    const moveWord = chosen.keeps === true ? chosen.tag ?? 'Move' : 'Move';
    const other = offers.length > 1 ? offers[chosen === offers[0] ? 1 : 0] : undefined;
    const otherRisk = other ? this.forecastOf(other.action) : null;
    const otherWords = other ? ` Press X for the other route (cost ${other.cost}${otherRisk ? `, ${percentOfShare(otherRisk.risk)} risk` : ''}).` : '';
    const risk = this.rich ? ` ${this.riskWords(f)}` : '';
    const leaves = chosen.off !== undefined;
    return {
      act: leaves ? 'unload' : 'move', can: true, hex: hit.hex, unit: hit.counter,
      words: leaves ? this.word('unload', 'Get down') : `${moveWord} ${chosen.cost} of ${chosen.budget}`,
      line: chosen.verb !== undefined ? `${name} ${chosen.verb} at ${at}.${risk}` : `Move ${name} to ${at}: cost ${chosen.cost} of ${chosen.budget}.${after}${risk}${otherWords}`,
      run: () => {
        if (chosen.keeps === true) {
          // A move that leaves the unit something it can still do this turn keeps it chosen (the owner, 2026-11-14: "When you
          // move and you can close attack, your unit should stay selected"). Once the move has been shown it is chosen like any
          // other unit is, if the fresh offers have something for it; else it is let go (fire on the way stopped it).
          this.choose({ kind: 'unit', units: [unit], mode: 'act' });
          this.kept = unit;
        } else {
          this.choose(NONE);
        }
        this.send(chosen.action, chosen.verb !== undefined ? `${name} ${chosen.verb} at ${at}.` : `${name} moves to ${at}.`);
      },
      shown: { path: [this.hexOf(unit), ...chosen.path], threats: this.threatsOf(f), odds: f && f.shots.length > 0 ? this.oddsFrom(f, '') : null },
      ways: offers.length, way: chosen === offers[1] ? 1 : 0,
      ...(f?.after !== undefined ? { told: f.after } : {}),
    };
  }

  private chargePlan(idx: OfferIndex<A>, units: readonly string[], target: string, hit: Hit): Plan {
    const offers = this.chargesOf(idx, units, target);
    const charge = this.routed(offers) as ChargeOffer<A>;
    const f = this.forecastOf(charge.action);
    const chance = this.chanceWords(f);
    const word = this.word('charge', 'Attack');
    const paths = charge.units.filter(u => u.path.length > 0).map(u => [this.hexOf(u.unit), ...u.path]);
    const to = this.hexOf(target);
    const aim = charge.units.map(u => ({ from: u.path[u.path.length - 1] ?? this.hexOf(u.unit), to })).filter(s => s.from >= 0 && s.to >= 0);
    const advice = this.adviceFor('charge', idx, units, target, f);
    const others = this.otherWays(idx, units, target, 'charge');
    return {
      act: 'charge', can: true, hex: hit.hex, unit: target, words: `${word}${chance.short !== '' ? ` ${chance.short}` : ''}${others.map(o => `. ${o}`).join('')}`,
      line: `${word} on ${this.nameOf(target)} by ${this.names(units)}.${chance.long !== '' ? ` ${chance.long}.` : ''} ${this.riskWords(f, units.length > 1)}${advice ? ` ${advice.lines.join(' ')}` : ''}${others.map(o => ` ${o}.`).join('')}`,
      run: () => {
        this.choose(NONE);
        this.send(charge.action, `${this.names(units)}: ${word.toLowerCase()} on ${this.nameOf(target)}.`);
      },
      shown: { path: paths[0] ?? [], routes: paths.slice(1), aim, threats: this.threatsOf(f), odds: f ? this.oddsFrom(f, '', advice) : null },
      ways: offers.length, way: charge === offers[1] ? 1 : 0,
      ...(advice ? { weak: `Only ${chance.long}. ${advice.lines.join(' ')}` } : {}),
    };
  }

  /** `offers`: the ways through one hex that come out in one hex (one route or two). */
  private drivePlan(offers: readonly DriveOffer<A>[], hit: Hit): Plan {
    const drive = this.routed(offers) as DriveOffer<A>;
    const f = this.forecastOf(drive.action);
    const chance = this.chanceWords(f);
    const word = this.word('drive', 'Drive');
    const name = this.nameOf(drive.unit);
    return {
      act: 'drive', can: true, hex: hit.hex, unit: hit.counter, words: `${word}${chance.short !== '' ? ` ${chance.short}` : ''}`,
      line: `${word}: ${name} through ${this.label(drive.through)} to ${this.label(drive.exit)}. Cost ${drive.cost} of ${drive.budget}.${chance.long !== '' ? ` ${chance.long}.` : ''} ${this.riskWords(f)}`,
      run: () => {
        this.choose(NONE);
        this.send(drive.action, `${name}: ${word.toLowerCase()} through ${this.label(drive.through)} to ${this.label(drive.exit)}.`);
      },
      shown: { path: [this.hexOf(drive.unit), ...drive.path, drive.through, drive.exit], threats: this.threatsOf(f), odds: f ? this.oddsFrom(f, '') : null },
      ways: offers.length, way: drive === offers[1] ? 1 : 0,
    };
  }

  /**
   * A drive through a hex by a unit: one click where there is one way out; else this click chooses the hex, and the
   * next the hex to come out in. `through`: every way through that hex.
   */
  private driveThrough(unit: string, through: readonly DriveOffer<A>[], hit: Hit): Plan {
    const exits = [...new Set(through.map(d => d.exit))];
    if (exits.length === 1) return this.drivePlan(through, hit);
    const best = this.routed(through);
    const word = this.word('drive', 'Drive');
    return {
      act: 'drive', can: true, hex: hit.hex, unit: hit.counter, words: `${word}: ${exits.length} ways out`,
      line: `${word} through ${this.label(hit.hex)}. Click here, then choose a hex to come out in (${exits.length} to choose from).`,
      run: () => {
        this.choose({ kind: 'drive', unit, through: hit.hex });
        this.did(`${word} through ${this.label(hit.hex)}. Now click a tinted hex to come out in (${exits.length} to choose from).`);
      },
      ...(best ? { shown: { path: [this.hexOf(unit), ...best.path, best.through] } } : {}),
    };
  }

  /** Set-up by hand: a unit picked up goes to the hex clicked; a click on a placed unit picks it up. */
  private planSetUp(hit: Hit): Plan {
    const idx = this.index();
    const sel = this.selection;
    const c = hit.counter;
    if (sel.kind === 'placing' && hit.hex >= 0 && (c === null || c !== sel.unit)) {
      const unit = sel.unit;
      const name = this.nameOf(unit);
      const at = this.label(hit.hex);
      const here = idx.places.find(p => p.unit === unit && p.hex === hit.hex);
      if (here) {
        return {
          act: 'place', can: true, hex: hit.hex, unit: c, words: 'Place', line: `Place ${name} at ${at}.`,
          run: () => {
            this.choose(NONE);
            this.send(here.action, `${name} placed at ${at}.`);
          },
        };
      }
      if (idx.takeBacks.has(unit) && (this.info.zones[this.port.seat ?? ''] ?? []).includes(hit.hex) && !(c !== null && this.mine(c) && idx.takeBacks.has(c))) {
        // A placed unit to another hex of the zone: taken back, then placed there if that is then legal.
        return {
          act: 'place', can: true, hex: hit.hex, unit: c, words: 'Move here', line: `Move ${name} to ${at}.`,
          run: () => {
            let step = 0;
            this.choose(NONE);
            this.answer('done', `${name} moved to ${at}.`);
            this.dispatch(() => {
              const now = this.index();
              step += 1;
              if (step === 1) return now.takeBacks.get(unit)?.action ?? null;
              if (step === 2) return now.places.find(p => p.unit === unit && p.hex === hit.hex)?.action ?? null;
              return null;
            });
          },
        };
      }
      if (!(c !== null && this.mine(c) && (idx.takeBacks.has(c) || idx.places.some(p => p.unit === c)))) {
        return this.refusal('place', hit, this.whyNot({ kind: 'place', unit, hex: hit.hex }, 'Unable to place unit there'));
      }
    }
    if (c !== null && this.mine(c) && (idx.takeBacks.has(c) || idx.places.some(p => p.unit === c))) {
      const down = sel.kind === 'placing' && sel.unit === c;
      return {
        act: 'select', can: true, hex: hit.hex, unit: c, words: down ? 'Put down' : 'Pick up', line: down ? `Put ${this.nameOf(c)} down again.` : `Pick up ${this.nameOf(c)}.`,
        run: () => {
          this.choose(down ? NONE : { kind: 'placing', unit: c });
          this.did(down ? `${this.nameOf(c)} put down.` : `${this.nameOf(c)} picked up. Now click another hex in your zone.`);
        },
      };
    }
    return this.refusal('place', hit, { words: 'Pick a unit first', line: 'Pick a unit in the folder, or press Tab. Then click a hex in your zone.' }, true);
  }

  // ---------------------------------------------------------------------------
  // input
  // ---------------------------------------------------------------------------

  /** A plain click on the table; `shift`: with the adding modifier held (absent: as the page last said). */
  click(hit: Hit, shift?: boolean): void {
    this.input();
    const at = { hex: hit.hex, unit: hit.counter };
    const closed = this.closed();
    if (closed !== '') {
      this.refuse(closed, at, closed.replace(/\.$/, ''));
      return;
    }
    this.cursor = null;
    const plan = this.planAt(hit, shift ?? this.shiftDown);
    if (!plan) {
      this.refuse('Nothing can be done there now.', at);
      return;
    }
    this.perform(plan);
  }

  private perform(plan: Plan): void {
    if (!plan.can || !plan.run) {
      this.refuse(plan.line, { hex: plan.hex, unit: plan.unit }, plan.words);
      return;
    }
    plan.run();
  }

  hover(hit: { counter: string | null; hex: number }): void {
    if (hit.counter === this.pointed.counter && hit.hex === this.pointed.hex) return;
    if (hit.hex !== this.pointed.hex) this.route = null;
    this.pointed = { counter: hit.counter, hex: hit.hex };
    // The pointer has moved: it is what is pointed at again, not where Tab stepped to.
    this.cursor = null;
    this.rested = false;
    this.deps.changed();
  }

  /** A unit waiting in the tray (set-up by hand) is clicked; or a group's button is pressed. */
  take(kind: 'unit' | 'group', id: string): void {
    this.input();
    if (kind === 'group') {
      this.goToGroup(id);
      return;
    }
    const closed = this.closed();
    if (closed !== '') {
      this.refuse(closed, null);
      return;
    }
    const idx = this.index();
    if (kind === 'unit') {
      if (this.pos.stage !== 'setup' || !idx.places.some(p => p.unit === id)) {
        this.refuse(`Unable to pick up ${this.nameOf(id)}: unit is not waiting to be placed.`, null);
        return;
      }
      const down = this.selection.kind === 'placing' && this.selection.unit === id;
      this.choose(down ? NONE : { kind: 'placing', unit: id });
      this.did(down ? `${this.nameOf(id)} put back.` : `${this.nameOf(id)} picked up. Now click a tinted hex in your zone.`);
    }
  }

  /**
   * Go to one of the seat's groups: it is the group in hand (its counters are lit), and the board is asked to bring
   * its hexes into view. It chooses no unit and sends nothing: so it is done at any time in play, the other side's turn
   * and a step being shown included. A unit of another group that was chosen is let go: the group in hand is always the
   * chosen unit's.
   */
  private goToGroup(id: string): void {
    const group = this.myGroups().find(g => g.id === id);
    if (!group) {
      this.refuse(this.port.seat === null ? 'You are watching. You have no groups to go to.' : 'Unable to go to that group: it no longer exists.', null);
      return;
    }
    const lead = this.chosenUnit();
    const stays = lead !== null && group.units.includes(lead);
    if (lead !== null && !stays) this.choose(NONE);
    // Tab then begins with this group's units (unless one of them is chosen: it goes on from that one).
    if (!stays) this.tabFrom = null;
    this.hand = { id: group.id, units: group.units, anchor: stays ? lead : null };
    this.deps.goTo?.([...new Set(group.units.map(u => this.hexOf(u)).filter(h => h >= 0))]);
    const n = group.units.length;
    const able = this.open ? group.units.filter(u => this.index().actable.includes(u)).length : -1;
    const can = able < 0 ? '' : able === 0 ? ', none can act now' : able < n ? `, ${able} can still act` : n === 1 ? ', which can still act' : ', all can still act';
    this.did(`${group.name} is now the active group: ${unitsWord(n)}${can}. Click a unit to choose it.`);
  }

  /** What to do when none of the seat's units has anything it can do. */
  private noneLeft(): string {
    return this.rich ? 'None of your units can act now. Press E to end your turn.' : `Nothing more can act: press ${this.endWord()} (E).`;
  }

  /** Escape: one step back. */
  back(): void {
    // Units with no valid moves that Tab has just stepped to: Esc stops the step on to the next unit.
    const stopping = this.idleShown !== null;
    this.input();
    const closed = this.closed();
    if (closed !== '') {
      this.refuse(closed, null);
      return;
    }
    const sel = this.selection;
    if (stopping && sel.kind === 'none') {
      this.did('Stopped. Press Tab for the next unit.');
      return;
    }
    if (this.cursor !== null) {
      this.cursor = null;
      if (this.steppedByKey) {
        this.did('Back: nothing is stepped to.');
        return;
      }
    }
    if (sel.kind === 'none') {
      // (The group in hand stays in hand: one of the seat's groups always is.)
      this.refuse('Unable to go back: nothing is chosen.', null, 'Nothing is chosen');
      return;
    }
    if (sel.kind === 'drive') {
      this.choose({ kind: 'unit', units: [sel.unit], mode: 'drive' });
      this.did(`Back: choose a hex to ${this.word('drive', 'drive').toLowerCase()}.`);
    } else if (sel.kind === 'unit' && sel.units.length > 1) {
      const rest = sel.units.slice(0, -1);
      this.choose({ kind: 'unit', units: rest, mode: sel.mode });
      this.did(`Back: ${this.nameOf(sel.units[sel.units.length - 1] as string)} removed.`);
    } else if (sel.kind === 'unit' && this.rich && sel.mode !== (this.modesOf(this.index(), sel.units[0] as string)[0] ?? 'act')) {
      this.choose(this.pick(this.index(), sel.units[0] as string));
      this.did(`Back: ${this.word(sel.mode, sel.mode).toLowerCase()} is off.`);
    } else {
      const name = this.nameOf(sel.kind === 'unit' ? sel.units[0] as string : sel.unit);
      this.choose(NONE);
      this.did(`${name} let go.`);
    }
  }

  /** What Tab steps through: every place a click would do something now, the likeliest first. */
  private ring(idx: OfferIndex<A>): Hit[] {
    const at = (counter: string | null, hex: number): Hit => ({ counter, hex, stack: this.stackAt(hex), ...(counter !== null ? { exact: true } : {}) });
    const ofUnits = (units: readonly string[]): Hit[] => units.filter(u => this.hexOf(u) >= 0).map(u => at(u, this.hexOf(u)));
    const sel = this.selection;
    if (this.pos.stage !== 'play') return [];
    if (sel.kind === 'none') {
      // The units that can still act: those of the group in hand first, then the rest.
      const hand = this.hand;
      const inHand = hand === null ? [] : idx.actable.filter(u => hand.units.includes(u));
      return ofUnits([...inHand, ...idx.actable.filter(u => !inHand.includes(u))]);
    }
    if (sel.kind === 'drive') {
      return [...new Set((idx.drives.get(sel.unit) ?? []).filter(d => d.through === sel.through).map(d => d.exit))].map(h => at(null, h));
    }
    if (sel.kind !== 'unit') return [];
    const lead = sel.units[0] as string;
    const from = this.hexOf(lead);
    const near = (a: number, b: number): number => this.span(from, a) - this.span(from, b);
    if (sel.mode === 'charge') return ofUnits(this.chargeTargets(idx, sel.units));
    if (sel.mode === 'drive') return [...new Set((idx.drives.get(lead) ?? []).map(d => d.through))].sort(near).map(h => at(null, h));
    if (sel.mode === 'board') return ofUnits((idx.boards.get(lead) ?? []).map(b => b.carrier));
    if (sel.mode === 'call' || sel.mode === 'screen') {
      // The hexes that hold the other side's units first, then the rest, each nearest first.
      const held = new Set(this.pos.units.filter(u => !u.destroyed && u.hex >= 0 && !this.mine(u.id)).map(u => u.hex));
      const hexes = [...(idx.calls.get(lead)?.get(sel.mode)?.keys() ?? [])];
      return [...hexes.filter(h => held.has(h)).sort(near), ...hexes.filter(h => !held.has(h)).sort(near)].map(h => at(null, h));
    }
    const targets = ofUnits(this.plainTargets(idx, sel.units)).sort((a, b) => near(a.hex, b.hex));
    const reach = sel.units.length > 1 ? [] : [...(idx.moves.get(lead)?.keys() ?? [])].sort(near).map(h => at(null, h));
    return [...targets, ...reach];
  }

  /** How far apart two hexes are, for putting choices in order: by their columns and rows (the layer measures nothing by it). */
  private span(a: number, b: number): number {
    const rows = this.info.grid.rows;
    return Math.abs(Math.floor(a / rows) - Math.floor(b / rows)) + Math.abs((a % rows) - (b % rows));
  }

  /**
   * Whether Tab steps through the units now (choosing each) in the fuller game's play: while nothing is chosen, and while
   * what is chosen is in its first way to act, as a click left it. In a way switched on by its key, and while choosing
   * where a drive comes out, Tab steps through that way's choices.
   */
  private tabsUnits(idx: OfferIndex<A>): boolean {
    if (!this.rich || this.pos.stage !== 'play') return false;
    const sel = this.selection;
    if (sel.kind === 'none') return true;
    if (sel.kind !== 'unit') return false;
    return sel.mode === 'act' || sel.mode === (this.modesOf(idx, sel.units[0] as string)[0] ?? 'act');
  }

  /**
   * The seat's units on the board in the order Tab takes them: group by group, in the order of the groups' numbers,
   * and in a group in the view's order. A fixed order, so that a step that chooses a unit of another group (which makes
   * that group the one in hand) skips no group. Each says whether it can act (it has a legal action now) or is idle:
   * it could act in name (neither Spent nor Suppressed) but has no legal action now. A unit that is neither is in it
   * too, for the place a step starts from (the unit last chosen may have been spent since).
   */
  private tabOrder(idx: OfferIndex<A>): { id: string; can: boolean; idle: boolean }[] {
    const seat = this.port.seat;
    if (seat === null) return [];
    const groupOf = new Map<string, number>();
    for (const g of this.myGroups()) for (const u of g.units) groupOf.set(u, g.number);
    const actable = new Set(idx.actable);
    return this.pos.units
      .map((u, i) => ({ u, i }))
      .filter(({ u }) => u.seat === seat && !u.destroyed && u.hex >= 0)
      .sort((a, b) => (groupOf.get(a.u.id) ?? 1e9) - (groupOf.get(b.u.id) ?? 1e9) || a.i - b.i)
      .map(({ u }) => ({ id: u.id, can: actable.has(u.id), idle: !actable.has(u.id) && !u.spent && !u.suppressed }));
  }

  /**
   * Tab in the fuller game's play: choose the next unit that can act (dir -1: the one before), as a click on it would,
   * and bring it into view. Where the next are units that could act but have no legal action now, they are stepped to
   * instead, so that the player sees why: "No valid moves" floats up on each, the line says why, and about a second
   * later the next unit that can act is chosen by itself (unless something else was put in meanwhile).
   */
  private stepUnit(idx: OfferIndex<A>, dir: 1 | -1): void {
    const order = this.tabOrder(idx);
    const n = order.length;
    if (!order.some(u => u.can || u.idle)) {
      this.refuse(this.noneLeft(), null, 'No unit can act');
      return;
    }
    // Where the step starts: the unit chosen; else the one last chosen or stepped to this turn; else just before the
    // first unit of the group in hand (Shift+Tab: at it, so the step goes to the unit before it).
    const lead = this.chosenUnit();
    const from = lead ?? this.tabFrom;
    let at = from === null ? -1 : order.findIndex(u => u.id === from);
    if (at < 0) {
      const hand = this.hand;
      const first = hand === null ? -1 : order.findIndex(u => hand.units.includes(u.id));
      at = first < 0 ? (dir === 1 ? n - 1 : 0) : dir === 1 ? (first - 1 + n) % n : first;
    }
    let k = at;
    for (let s = 0; s < n; s++) {
      k = (k + dir + n) % n;
      const u = order[k] as { can: boolean; idle: boolean };
      if (u.can || u.idle) break;
    }
    const to = order[k] as { id: string; can: boolean; idle: boolean };
    if (to.can) {
      const hex = this.hexOf(to.id);
      const sel = this.selection;
      if (sel.kind === 'unit' && sel.units.length === 1 && sel.units[0] === to.id) {
        // The only unit that can act is chosen already.
        this.deps.goTo?.([hex]);
        this.did(`${this.nameOf(to.id)} is the only unit that can act now.`);
        return;
      }
      // As a click on it: in a stack of the seat's own it is brought to the top, and the words say so.
      const own = this.stackAt(hex).filter(id => this.mine(id) && !this.isCarried(id));
      this.selectPlan(idx, to.id, hex, false, own.length >= 2 ? this.stackAt(hex) : undefined).run?.();
      // What Tab chose may be off the screen: the board is asked to bring it into view.
      if (hex >= 0) this.deps.goTo?.([hex]);
      return;
    }
    // Units with no valid moves: this one and those that follow it the same way round, up to the next that can act.
    const run: string[] = [to.id];
    for (let s = 1; s < n; s++) {
      const u = order[(k + s * dir + n * n) % n] as { id: string; can: boolean; idle: boolean };
      if (u.can || u.id === to.id) break;
      if (u.idle) run.push(u.id);
    }
    const anyCan = order.some(u => u.can);
    this.choose(NONE);
    this.tabFrom = run[run.length - 1] as string;
    this.idleShown = run;
    const hexes = [...new Set(run.map(u => this.hexOf(u)).filter(h => h >= 0))];
    for (const u of run) {
      const hex = this.hexOf(u);
      if (hex >= 0) this.deps.answer?.({ kind: 'badge', hex, unit: u, words: NO_MOVES, tone: 'plain' });
    }
    if (hexes.length > 0) this.deps.goTo?.(hexes);
    // Why, in the reading's words: of the one, or of all of them when it is the same for each.
    const whys = [...new Set(run.map(u => (this.reading.why ? this.reading.why(this.port.view(), { kind: 'select', unit: u }) : '')))];
    const why = whys.length === 1 && whys[0] !== '' ? `: ${whys[0] as string}` : '';
    const said = `${this.names(run)} ${run.length === 1 ? 'has' : 'have'} no valid moves${why}.`;
    this.answer('done', anyCan ? said : `${said} ${this.noneLeft()}`);
    this.deps.changed();
    // A moment later, the next unit that can act is chosen by itself: unless something else was put in meanwhile.
    if (!anyCan || !this.deps.wait) return;
    const serial = ++this.idleSerial;
    void this.deps.wait(NO_MOVES_MS).then(() => {
      if (serial !== this.idleSerial) return;
      this.idleShown = null;
      if (!this.open || !this.tabsUnits(this.index())) {
        this.deps.changed();
        return;
      }
      this.stepUnit(this.index(), dir);
    });
  }

  /** Tab: step to the next thing that can be chosen (dir -1: the one before), shown as if pointed at; in a set-up by hand, the next unit to place. */
  next(dir: 1 | -1): void {
    this.input();
    const closed = this.closed();
    if (closed !== '') {
      this.refuse(closed, null);
      return;
    }
    const idx = this.index();
    const sel = this.selection;
    // The fuller game's play: Tab chooses the next unit (the owner, 2026-11-14), unless a way switched on by its key has choices of its own.
    if (this.pos.stage === 'play' && this.tabsUnits(idx)) {
      this.stepUnit(idx, dir);
      return;
    }
    const step = <T>(list: readonly T[], at: number): T | undefined => list[at < 0 ? (dir === 1 ? 0 : list.length - 1) : (at + dir + list.length) % list.length];
    if (this.pos.stage === 'setup') {
      if (!this.rich) {
        this.refuse('Unable to step to a unit: the set-up is dealt whole.', null);
        return;
      }
      const waiting = [...new Set(idx.places.map(p => p.unit))];
      const unit = step(waiting, sel.kind === 'placing' ? waiting.indexOf(sel.unit) : -1);
      if (unit === undefined) {
        this.refuse('Unable to step to a unit: every unit is placed.', null);
        return;
      }
      this.choose({ kind: 'placing', unit });
      this.did(`${this.nameOf(unit)} picked up. Now click a tinted hex in your zone.`);
      return;
    }
    this.stepChoice(idx, dir);
  }

  /**
   * Step to the next of what can be chosen now (dir -1: the one before), shown as if pointed at, so that Enter does it:
   * with a unit chosen, the enemies it can attack (the nearest first), then the hexes it can reach.
   */
  private stepChoice(idx: OfferIndex<A>, dir: 1 | -1): void {
    const ring = this.ring(idx);
    const now = this.cursor;
    const at = now === null ? -1 : ring.findIndex(h => h.counter === now.counter && h.hex === now.hex);
    const to = ring[at < 0 ? (dir === 1 ? 0 : ring.length - 1) : (at + dir + ring.length) % ring.length];
    if (to === undefined) {
      this.refuse('Unable to step through the choices: there are none now.', this.chosenPlace(), 'Nothing to step through');
      return;
    }
    this.cursor = to;
    this.steppedByKey = true;
    this.route = null;
    // What is stepped to may be off the screen: the board is asked to bring it into view.
    if (to.hex >= 0) this.deps.goTo?.([to.hex]);
    this.deps.changed();
  }

  /**
   * R (the fuller game): with a unit chosen, step to the next thing it can do, as Tab did before it chose units: the
   * enemies it can attack, then the hexes it can reach; Enter does the one shown (every action can be made from the
   * keyboard). Tab still chooses units.
   */
  private aim(): void {
    const closed = this.closed();
    if (closed !== '') {
      this.refuse(closed, null);
      return;
    }
    if (this.selection.kind !== 'unit' && this.selection.kind !== 'drive') {
      this.refuse(`Unable to ${this.verbOf('aim', 'Next choice')}: no unit is chosen (press Tab or click one).`, null, 'No unit is chosen');
      return;
    }
    this.stepChoice(this.index(), 1);
  }

  /**
   * Enter: do what Tab has stepped to; in the set-up, start with it. It never acts on what is not shown as stepped to:
   * with nothing stepped to it is refused, and says to press Tab.
   */
  confirm(): void {
    this.input();
    const closed = this.closed();
    if (closed !== '') {
      this.refuse(closed, null);
      return;
    }
    if (this.pos.stage === 'setup') {
      this.start();
      return;
    }
    const plan = this.cursor ? this.planAt(this.cursor, false) : null;
    if (!plan) {
      // On the table, a few words by the chosen unit; in the panel, the whole of it. Where Tab chooses units (the fuller
      // game's play), what to do is a click on the board.
      if (this.tabsUnits(this.index())) {
        const what = this.chosenUnit() === null ? 'press Tab or click a unit' : 'click a tinted hex or an enemy, or press R to step to one';
        this.refuse(`Unable to confirm: nothing is stepped to (${what}).`, this.chosenPlace(), this.chosenUnit() === null ? 'Press Tab first' : 'Click on the board');
        return;
      }
      this.refuse('Unable to confirm: nothing is stepped to (press Tab first).', this.chosenPlace(), 'Press Tab first');
      return;
    }
    this.cursor = null;
    this.perform(plan);
  }

  /**
   * E: end the phase. In the fuller game it ends the seat's turn, and a turn is not lost by one slip of a finger: while
   * units can still act the first press only says how many and asks for E again (in the panel, and on the table where
   * the eye is); a second press with nothing done in between ends the turn. With nothing left that can act, one press
   * ends it.
   */
  end(): void {
    // E keeps its own question across the input it is: the second press must find it.
    const asked = this.endAsked;
    this.input();
    this.endAsked = asked;
    const closed = this.closed();
    if (closed !== '') {
      this.endAsked = null;
      this.refuse(closed, null);
      return;
    }
    const idx = this.index();
    const end = idx.end;
    if (!end) {
      this.endAsked = null;
      const why = this.whyNot({ kind: 'end' }, 'Unable to end the turn');
      this.refuse(why.line, this.chosenPlace(), why.words);
      return;
    }
    const able = idx.actable.length;
    const seq = this.port.seq();
    if (this.rich && able > 0 && this.endAsked !== seq) {
      this.endAsked = seq;
      const again = 'Press E again to end your turn';
      this.answer('done', `${unitsWord(able)} can still act. ${again}.`);
      const at = this.chosenPlace() ?? this.handPlace();
      if (at && at.hex >= 0) this.deps.answer?.({ kind: 'badge', hex: at.hex, unit: at.unit, words: again, tone: 'plain' });
      this.deps.changed();
      return;
    }
    this.endAsked = null;
    this.choose(NONE);
    this.send(end.action, `${this.endWord()}.`);
  }

  /** Where the group in hand is, for an answer on the table that is about no one unit: its first unit on the board. */
  private handPlace(): { hex: number; unit: string | null } | null {
    for (const u of this.hand?.units ?? []) {
      const hex = this.hexOf(u);
      if (hex >= 0) return { hex, unit: null };
    }
    return null;
  }

  private endWord(): string {
    return this.rich ? this.word('end', 'End') : `End ${this.pos.phase.toLowerCase()}`;
  }

  /** N: another set-up from the adviser, while none of the seat's units is placed. */
  dealAgain(): void {
    this.endAsked = null;
    if (!this.canDeal()) {
      // Only where dealing is a thing at all (the first game's set-up) does the key say why it does nothing.
      if (!this.rich && this.pos.stage === 'setup') this.refuse(this.closed() || 'Unable to deal again: the set-up has started.', null);
      return;
    }
    this.deal += 1;
    this.settle();
    this.did('Another set-up is dealt.');
  }

  /** One of the ways a chosen unit can act besides moving and firing: the same key again goes back to those. */
  private mode(mode: Exclude<Mode, 'act'>): void {
    const idx = this.index();
    const sel = this.selection;
    const unit = this.chosenUnit();
    const word = this.word(mode, mode);
    if (unit === null) {
      this.refuse(`Unable to ${this.verbOf(mode, word)}: no unit is chosen.`, null);
      return;
    }
    if (!this.modesOf(idx, unit).includes(mode)) {
      this.refuse(`Unable to ${this.verbOf(mode, word)}: ${this.whyOff(mode, idx)}.`, this.chosenPlace(), word);
      return;
    }
    if (sel.kind === 'unit' && sel.mode === mode) {
      // The same key again leaves the mode; but a unit whose first way to act this is stays in it (it has no other to go back to).
      const first = this.modesOf(idx, unit)[0] ?? 'act';
      if (first === mode) {
        this.did(`${word}: click ${this.modeTarget(mode)}.`);
        return;
      }
      this.choose({ kind: 'unit', units: sel.units, mode: first });
      this.did(`${word} is off.`);
      return;
    }
    // Several units stay chosen where the mode is one they can act in together; else the first alone.
    const units = sel.kind === 'unit' && sel.units.length > 1 && mode === 'charge' && this.canCharge(idx, sel.units) ? sel.units : [unit];
    this.choose({ kind: 'unit', units, mode });
    // With one thing to choose, Enter does it: it is stepped to already.
    const ring = this.ring(idx);
    if (ring.length === 1) {
      this.cursor = ring[0] as Hit;
      this.steppedByKey = false;
    }
    this.did(`${word}: click ${this.modeTarget(mode)}${ring.length === 1 ? ', or press Enter' : ''}.`);
  }

  /** U: the unit that the chosen unit carries. */
  private unload(): void {
    const idx = this.index();
    const carried = this.carriedBy(this.chosenUnit());
    if (carried === null || !idx.actable.includes(carried)) {
      this.refuse(`Unable to ${this.verbOf('unload', this.word('unload', 'Unload'))}: ${this.whyOff('unload', idx)}.`, this.chosenPlace());
      return;
    }
    this.chooseUnit(idx, carried);
    this.did(`${this.nameOf(carried)} chosen. Click a tinted hex to ${this.word('unload', 'unload').toLowerCase()}.`);
  }

  /**
   * H: the side's next setting. The side has one switch; the rules may keep the setting part by part, so every part
   * that is not yet at the new setting is given it, one action after another, each found among the legal actions when
   * its turn comes.
   */
  private setting(): void {
    const word = this.word('setting', 'Setting');
    const target = this.nextSetting(this.index());
    if (target === null) {
      this.refuse(`Unable to ${this.verbOf('setting', word)}: ${this.whyOff('setting', this.index())}.`, this.chosenPlace(), word);
      return;
    }
    const waiting = (): SettingOffer<A> | undefined => [...this.index().settings.values()].flat().find(s => s.setting === target);
    // No more actions than there are parts to set: a part that is at the setting is offered it no more.
    let left = [...this.index().settings.values()].filter(list => list.some(s => s.setting === target)).length;
    // The setting, and what it does in the reading's one sentence.
    const does = this.word(`setting:${target}`, '');
    this.answer('done', `${word}: ${target}.${does !== '' ? ` ${does}` : ''}`);
    this.dispatch(() => {
      if (left <= 0) return null;
      left -= 1;
      return waiting()?.action ?? null;
    });
  }

  /** The setting the side's switch goes to next: the one after its present one in the reading's order that some part of it may be given; null when none may. */
  private nextSetting(idx: OfferIndex<A>): string | null {
    const offered = new Set([...idx.settings.values()].flat().map(s => s.setting));
    const now = this.pos.sides.find(s => s.seat === this.port.seat)?.setting ?? '';
    const order = [...(this.info.settings ?? []), ...[...offered].filter(s => !(this.info.settings ?? []).includes(s)).sort()];
    const at = order.indexOf(now);
    for (let k = 1; k <= order.length; k++) {
      const next = order[(at + k) % order.length];
      if (next !== undefined && next !== now && offered.has(next)) return next;
    }
    return null;
  }

  private canDeal(): boolean {
    return this.open && this.proposal !== null && this.proposal.offers.length > 0 && this.proposal.offers.length === this.unplaced();
  }

  private canStart(): boolean {
    if (!this.open || this.pos.stage !== 'setup') return false;
    const idx = this.index();
    return idx.ready !== null || (this.proposal !== null && this.proposal.offers.length > 0 && idx.places.length > 0);
  }

  /** Start: make the proposed placements in order, each as the legal action it is at that moment, then hand the set-up in. */
  private start(): void {
    if (!this.canStart()) {
      const left = this.unplaced();
      this.refuse(`Unable to ${this.verbOf('start', 'Start')}: ${left > 0 ? `${left === 1 ? '1 unit is' : `${left} units are`} still to be placed` : 'not now'}.`, null);
      return;
    }
    const proposed = this.proposal ? this.proposal.offers.slice() : [];
    let handedIn = false;
    this.choose(NONE);
    this.answer('done', 'The set-up is handed in.');
    this.dispatch(() => {
      const idx = this.index();
      if (idx.ready) {
        if (handedIn) return null;
        handedIn = true;
        return idx.ready.action;
      }
      for (const want of proposed) {
        if (this.hexOf(want.unit) >= 0) continue;
        const legal = idx.places.find(o => o.unit === want.unit && o.hex === want.hex);
        if (legal) return legal.action;
      }
      return null;
    });
  }

  /** A control of the panel, by id: done, or refused with the control's own reason when it is off. */
  press(id: string): void {
    // E's question ("Press E again") stands only while nothing else is put in; every other press lets it go.
    const asked = this.endAsked;
    this.input();
    if (id === 'end') this.endAsked = asked;
    const control = this.view().controls.find(c => c.id === id);
    if (control && !control.enabled) {
      const why = control.why ?? 'not now';
      this.refuse(`Unable to ${this.verbOf(control.id, control.label)}: ${why}.`, this.chosenPlace(), capital(why));
      return;
    }
    if (id === 'end') this.end();
    else if (id === 'next') this.next(1);
    else if (id === 'back') this.back();
    else if (id === 'confirm' || id === 'start') this.confirm();
    else if (id === 'deal') this.dealAgain();
    else if (id === 'aim') this.aim();
    else if (id === 'charge' || id === 'drive' || id === 'board' || id === 'call' || id === 'screen') this.mode(id);
    else if (id === 'unload') this.unload();
    else if (id === 'setting') this.setting();
    else if (id === 'route') {
      const plan = this.planNow();
      if (!plan || (plan.ways ?? 1) < 2) return;
      this.route = plan.way === 1 ? 0 : 1;
      this.did(this.route === 1 ? 'Other route: the less exposed one.' : 'Other route: the cheaper one.');
    } else if (id === 'advance') {
      this.advance = !this.advance;
      const word = this.word('advance', 'Advance');
      this.did(this.advance ? `${word}: on. If the target is destroyed, your units move into its hex.` : `${word}: off. Your units stay where they are.`);
    } else if (id === 'preset') {
      const preset = this.index().preset;
      if (preset) {
        this.choose(NONE);
        this.send(preset.action, `${this.word('preset', 'Preset')}.`);
      }
    } else if (id === 'takeBack') {
      const sel = this.selection;
      const back = sel.kind === 'placing' ? this.index().takeBacks.get(sel.unit) : undefined;
      if (back && sel.kind === 'placing') {
        const name = this.nameOf(sel.unit);
        this.choose(NONE);
        this.send(back.action, `${name} taken back.`);
      }
    }
  }

  /**
   * A key that is one of the present controls' own, or a digit from 1 to 9 (in the fuller game, in play: it goes to
   * the seat's group of that number): true when it was (the page then keeps it from the browser). A key of a control
   * that is off, and a digit with no group of that number, are refused in words.
   */
  key(key: string): boolean {
    const k = key.length === 1 ? key.toUpperCase() : key;
    const control = this.view().controls.find(c => c.key.toUpperCase() === k.toUpperCase() || (c.key === 'Bksp' && (k === 'Backspace' || k === 'Delete')));
    if (control) {
      // On or off: a press of a control that is off is refused, with its reason.
      this.press(control.id);
      return true;
    }
    // P was Pass before the whole side moved: a player who reaches for it is told the key that ends the turn now.
    if (this.rich && this.pos.stage === 'play' && k === 'P' && this.port.seat !== null) {
      this.input();
      const end = this.view().controls.find(c => c.id === 'end')?.key ?? 'E';
      this.refuse(`Press ${end} to end your turn.`, null, `Press ${end}`);
      return true;
    }
    if (!this.rich || this.pos.stage !== 'play' || !/^[1-9]$/.test(k)) return false;
    this.input();
    const groups = this.myGroups();
    const group = groups.find(g => g.number === Number(k));
    if (group) {
      this.goToGroup(group.id);
    } else if (this.port.seat === null) {
      this.refuse('You are watching. You have no groups to go to.', null);
    } else {
      this.refuse(`There is no group ${k}. You have ${groups.length === 1 ? '1 group' : `${groups.length} groups`}.`, null, `No group ${k}`);
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // what the model shows of all this
  // ---------------------------------------------------------------------------

  private cardOf(unit: string): CardModel | null {
    const u = this.info.units.find(x => x.id === unit);
    if (!u) return null;
    const more = this.reading.unitCard?.(this.shown, unit);
    return {
      id: u.id, name: u.name, side: sideNameOf(this.info, u.seat), stock: stockOf(this.info, u.seat) ?? 'first', face: u.face,
      rows: this.reading.unitFigures(this.shown, unit),
      ...(more ? { tiles: more.tiles, stamp: more.stamp, lines: more.lines } : {}),
    };
  }

  /** What a click where the pointer is (or where Tab has stepped to) would do now. */
  private planNow(): Plan | null {
    const focus = this.open ? this.focus() : null;
    // Shift is the pointer's: what Tab has stepped to is done by Enter, plainly.
    const plan = focus ? this.planAt(focus, this.shiftDown && this.cursor === null) : null;
    if (plan && !plan.can && this.rested && this.cursor === null) return null;
    return plan;
  }

  /** Why a control is off, in a few words that follow its name and a colon. */
  private whyOff(id: ControlId, idx: OfferIndex<A>): string {
    const closed = this.closed();
    if (closed !== '') return closed.replace(/\.$/, '').replace(/^./, c => c.toLowerCase());
    const unit = this.chosenUnit();
    const sel = this.selection;
    const ask = (attempt: Attempt): string => (this.reading.why ? this.reading.why(this.port.view(), attempt) : '') || 'not now';
    switch (id) {
      case 'confirm':
        if (this.tabsUnits(idx)) return unit === null ? 'nothing is stepped to (press Tab or click a unit)' : 'nothing is stepped to (click a tinted hex or an enemy, or press R to step to one)';
        return 'nothing is stepped to (press Tab first)';
      case 'end':
        return ask({ kind: 'end' });
      case 'next':
        return 'nothing to step through now';
      case 'aim':
        return unit === null ? 'no unit is chosen' : 'nothing to step to';
      case 'back':
        return 'nothing is chosen';
      case 'charge':
        return unit === null ? 'no unit is chosen' : ask({ kind: 'charge', units: [unit], target: null });
      case 'drive':
        return unit === null ? 'no unit is chosen' : ask({ kind: 'drive', unit, hex: -1 });
      case 'board':
        return unit === null ? 'no unit is chosen' : ask({ kind: 'board', unit, carrier: null });
      case 'call':
      case 'screen':
        return unit === null ? 'no unit is chosen' : ask({ kind: 'call', unit, hex: -1, variant: id });
      case 'unload':
        return unit === null ? 'no transport is chosen' : `no carried unit can ${this.word('unload', 'unload').toLowerCase()} now`;
      case 'route':
        return 'there is only one route there';
      case 'advance':
        return `only for a ${this.word('charge', 'an attack').toLowerCase()}`;
      case 'setting':
        return 'it can\u2019t be changed now';
      case 'preset':
        return 'you have begun placing units by hand';
      case 'takeBack':
        return sel.kind === 'placing' ? 'unit is not on the board' : 'no placed unit is picked up';
      case 'start': {
        const left = this.unplaced();
        return left > 0 ? `${left === 1 ? '1 unit is' : `${left} units are`} still to be placed` : 'not now';
      }
      case 'deal':
        return 'the set-up has started';
      default:
        return idx.actable.length === 0 ? 'none of your units can act' : 'not now';
    }
  }

  /** Each target's label: the chance of exactly what a click on it would send, from the reading's forecast (chances.ts). */
  private chancesOf(targets: readonly string[], actionOf: (target: string) => A | undefined, also?: (target: string) => string): ChanceLabel[] {
    // (The fuller game's: in the first game an attack is declared now and resolved later, with the others on its target.)
    if (!this.rich) return [];
    return chanceLabels(targets.map(t => {
      const action = actionOf(t);
      return { unit: t, hex: this.hexOf(t), forecast: action === undefined ? null : this.forecastOf(action), ...(also ? { also: also(t) } : {}) };
    }));
  }

  view(): ControlView {
    const idx: OfferIndex<A> = this.open ? this.index() : NO_OFFERS;
    const pos = this.pos;
    const seat = this.port.seat;
    const sel = this.open ? this.selection : NONE;
    const label = (hex: number): string => this.label(hex);

    let selected: readonly string[] = [];
    let canAct: readonly string[] = idx.actable;
    let targets: readonly string[] = [];
    /** Of the targets, those a click would attack at close quarters (a charge, or a drive through its hex): they glow red. */
    let close: readonly string[] = [];
    let chances: readonly ChanceLabel[] = [];
    let reach: readonly number[] = [];
    let reachNear: readonly number[] = [];
    let targetHexes: readonly number[] | null = null;
    let prompt = '';
    let picks: readonly string[] = [];
    let tray: readonly string[] = [];
    // Where the seat is in the turn's loop, in the ruleset's own words, when its reading has them.
    const guide = this.reading.guide?.(this.shown, seat);

    const settingUp = pos.stage === 'setup' && seat !== null && pos.deciding.includes(seat);
    const proposal = settingUp && this.proposal ? new Map(this.proposal.offers.map(o => [o.unit, o.hex] as const)) : null;
    const playing = pos.stage === 'play' && seat !== null && pos.deciding.includes(seat);
    const plan = this.planNow();
    const shown: Shown = plan?.shown ?? {};

    if (pos.stage === 'over') {
      prompt = '';
    } else if (seat === null) {
      prompt = 'You are watching. The computer plays both sides.';
    } else if (pos.stage === 'setup' && this.rich) {
      if (!settingUp) {
        prompt = 'Waiting for the other side to set up.';
      } else if (!this.open) {
        // An action is on its way: the tray stays as it was, so that it does not blink.
        tray = this.trayKept;
      } else {
        const waiting = [...new Set(idx.places.map(p => p.unit))];
        tray = waiting;
        this.trayKept = waiting;
        if (sel.kind === 'placing') {
          selected = [sel.unit];
          const mayGo = idx.places.filter(p => p.unit === sel.unit).map(p => p.hex);
          reach = mayGo;
          prompt = mayGo.length > 0
            ? `${this.nameOf(sel.unit)}: click a tinted hex in your zone.`
            : `${this.nameOf(sel.unit)}: click another hex in your zone, or press Backspace to take the unit back.`;
        } else if (waiting.length > 0) {
          prompt = `${unitsWord(waiting.length)} to place. Pick one in the folder, or press Tab. Then click a hex in your zone. Or press Q to take the scenario\u2019s set-up.`;
        } else {
          prompt = 'Every unit is placed. Press Enter to hand in the set-up, or click a unit to move it.';
        }
      }
    } else if (pos.stage === 'setup') {
      if (settingUp) prompt = proposal && proposal.size > 0 ? 'Your side is set up as shown. Press Enter to start, or N to deal another.' : (idx.ready ? 'Your side is set up. Press Enter to start.' : '');
      else prompt = 'Waiting for the other side to set up.';
    } else if (!this.open) {
      prompt = '';
      // A unit kept chosen through its move keeps its mark while the move is shown (it does not go out and come on again).
      const keep = this.selection;
      if (this.kept !== null && keep.kind === 'unit' && keep.units[0] === this.kept && pos.stage === 'play') selected = [this.kept];
    } else if (sel.kind === 'none' || sel.kind === 'placing') {
      if (this.rich) {
        if (idx.actable.length > 0) {
          // "6 units can still act. Click one, or press E to end your turn." Then what the reading says of units left unused, and how to find them.
          const unused = this.word('unused', '');
          const where = this.myGroups().length > 1 ? ' Press a number key to go to a group.' : '';
          prompt = `${unitsWord(idx.actable.length)} can still act. Click one, or press E to end your turn.${unused !== '' ? ` ${unused}` : ''}${where}`;
        } else if (idx.end) {
          prompt = this.noneLeft();
        }
      } else {
        const movers = [...idx.moves.keys()].length;
        const shooters = [...idx.attacks.keys()].length;
        const waiting = new Set(pos.units.filter(u => u.target !== null && u.seat === seat).map(u => u.target)).size;
        if (idx.actable.length === 0) prompt = 'Nothing more to do. Press E to end the phase.';
        else if (movers === 0) prompt = `${shooters} of your units can fire: click one to see what it can hit.`;
        else if (shooters === 0) prompt = `${movers} of your units can move: click one to see where it can go.`;
        else prompt = `${idx.actable.length} of your units can act: click one.`;
        if (waiting > 0) prompt += ` ${waiting} ${waiting === 1 ? 'attack is' : 'attacks are'} declared.`;
      }
      // A unit a click would choose, while none is chosen: what it could do is shown as if it were.
      if (shown.preview !== undefined) {
        const moves = idx.moves.get(shown.preview);
        reach = moves ? [...moves.keys()] : [];
        reachNear = this.nearOf(idx, shown.preview);
        targets = this.plainTargets(idx, [shown.preview]);
        close = this.closeOnes(idx, [shown.preview], targets);
      }
    } else if (sel.kind === 'drive') {
      selected = [sel.unit];
      const through = (idx.drives.get(sel.unit) ?? []).filter(d => d.through === sel.through);
      const exits = [...new Set(through.map(d => d.exit))];
      targetHexes = [sel.through];
      reach = exits;
      prompt = `${this.word('drive', 'Drive')}: ${this.nameOf(sel.unit)} through ${label(sel.through)}. Click a tinted hex to come out in (${exits.length} to choose from), or press Esc to go back.`;
    } else {
      const units = sel.units;
      const lead = units[0] as string;
      const together = units.length > 1;
      selected = units;
      const name = this.names(units);
      // The other ways the unit can act, each with its key: " Press C to <charge>, or M to <board>."
      const others = together ? [] : this.modesOf(idx, lead).filter((m): m is Exclude<Mode, 'act'> => m !== sel.mode && m !== 'act');
      const also = others.length > 0 ? ` Press ${others.map(m => `${MODE_KEYS[m]} to ${this.verbOf(m, this.word(m, m))}`).join(', or ')}.` : '';
      if (sel.mode === 'act') {
        const moves = together ? undefined : idx.moves.get(lead);
        reach = moves ? [...moves.keys()] : [];
        reachNear = together ? [] : this.nearOf(idx, lead);
        targets = this.plainTargets(idx, units);
        close = this.closeOnes(idx, units, targets);
        // Each target's card: the chance of what a click on it sends, and a mark when it can be attacked another way too.
        chances = this.chancesOf(targets, t => this.plainAction(idx, units, t), t => this.otherKeys(idx, units, t));
        const fireTargets = this.targetsOf(idx, units);
        const join = idx.actable.some(u => !units.includes(u) && this.targetsTogether(idx, [...units, u]).length > 0) ? ` ${ADD_CLICK} another unit to fire together.` : '';
        const fire = !this.rich ? 'to attack it' : targets.every(t => fireTargets.includes(t)) ? 'to fire' : 'to attack';
        // What to click to attack: a ringed enemy; or, where every target is one a click attacks at close quarters, the one
        // that glows red, in the reading's word for the way (a charge, a drive through its hex).
        const closeWay = close.length === 0 || close.length < targets.length ? ''
          : close.every(t => this.waysOn(idx, units, t).charge !== null) ? this.word('charge', 'attack').toLowerCase()
            : close.every(t => this.waysOn(idx, units, t).charge === null) ? this.word('drive', 'attack').toLowerCase() : 'attack';
        const aim = closeWay !== '' ? `${targets.length === 1 ? 'the enemy' : 'an enemy'} that glows red to ${closeWay}` : `a ringed enemy ${fire}`;
        // The nearer part of the reach: what its stronger shade means, in the reading's words.
        const still = together ? '' : this.nearStill(idx, lead);
        const near = reachNear.length > 0 ? ` ${NEAR_SHADE.replace(/^./, c => c.toUpperCase())} hexes: unit can still ${still !== '' ? still : 'act'}.` : '';
        // A unit that has moved and can still do one thing more: the reading says what, and what it costs.
        const movedNow = together ? undefined : pos.units.find(u => u.id === lead && u.moved === true)?.still;
        const movedShot = this.word('movedShot', '');
        const charges = !together && this.chargeTargets(idx, units).length > 0;
        if (together) {
          prompt = targets.length > 0
            ? `${name} chosen together. Click ${aim}. ${ADD_CLICK} a unit to add or remove it.`
            : `${name} have no target in common. ${ADD_CLICK} a unit to remove it, or press Esc.`;
        } else if (movedNow !== undefined) {
          // A unit that has moved: one thing more (fire, or a charge), or a move on with what is left (the engine's rulings 80 and 81).
          // The line names what it can still attack, and says to click it (the owner, 2026-11-14).
          const on = reach.length > 0 ? ' Or click a tinted hex to move on.' : '';
          if (movedNow.attack === 'attack' && targets.length > 0) {
            prompt = `${name} can still fire on ${this.aimWords(targets)}. ${targets.length === 1 ? 'Click it.' : 'Click a ringed enemy.'}${movedShot !== '' ? ` ${movedShot}` : ''}${on}${join}`;
          } else if (movedNow.attack === 'charge' && charges) {
            const aims = this.chargeTargets(idx, units);
            prompt = `${name} can still ${this.word('charge', 'attack').toLowerCase()} ${this.aimWords(aims)}. ${aims.length === 1 ? 'Click it.' : 'Click one that glows red.'}${on}`;
          } else {
            const none = movedNow.attack === 'attack' ? this.word('noTarget', 'nothing to attack') : this.word('noCharge', 'nothing to attack');
            prompt = `${name}: ${none}.${reach.length > 0 ? ' Click a tinted hex to move on.' : ''}`;
          }
        } else if (reach.length > 0 && targets.length > 0) {
          prompt = `${name} chosen. Click a tinted hex to move, or ${aim}.${near}${join}${also}`;
        } else if (targets.length > 0) {
          prompt = `${name} chosen. Click ${aim}.${join}${also}`;
        } else if (reach.length > 0) {
          prompt = `${name} chosen. Click a tinted hex to move.${near}${also}`;
        } else {
          prompt = `${name} chosen. Nothing to move to or fire on.${join}${also}`;
        }
      } else if (sel.mode === 'charge') {
        targets = this.chargeTargets(idx, units);
        close = targets;
        chances = this.chancesOf(targets, t => this.routed(this.chargesOf(idx, units, t))?.action);
        const after = `${this.word('advance', 'Advance')}: ${this.advance ? 'on' : 'off'} (G).`;
        prompt = targets.length > 0
          ? `${this.word('charge', 'Attack')}: click ${targets.length === 1 ? 'the enemy' : 'an enemy'} that glows red to send ${name} in. ${after} ${ADD_CLICK} more units to go in together.`
          : `${this.word('charge', 'Attack')}: no target in common.${this.word('chargeMove', '') !== '' ? ` ${this.word('chargeMove', '')}` : ''} ${ADD_CLICK} a unit to remove it, or press Esc.`;
      } else if (sel.mode === 'drive') {
        const drives = idx.drives.get(lead) ?? [];
        targetHexes = [...new Set(drives.map(d => d.through))];
        prompt = `${this.word('drive', 'Drive')}: click an enemy hex marked red. ${name} drives through it.`;
      } else if (sel.mode === 'board') {
        const carriers = idx.boards.get(lead) ?? [];
        picks = carriers.map(b => b.carrier);
        prompt = carriers.length === 1
          ? `${this.word('board', 'Board')}: click ${this.nameOf((carriers[0] as BoardOffer<A>).carrier)} (outlined), or press Enter. ${name} gets on.`
          : `${this.word('board', 'Board')}: click an outlined transport. ${name} gets on.`;
      } else {
        const hexes = idx.calls.get(lead)?.get(sel.mode);
        reach = hexes ? [...hexes.keys()] : [];
        prompt = `${this.word(sel.mode, sel.mode)}: click a tinted hex to aim it.${also}`;
      }
    }

    // A weak attack is pointed at: the prompt says its chance and how to raise it, in full (in a mode, after the mode's name).
    if (plan?.weak !== undefined && plan.can) {
      const mode = sel.kind === 'unit' && sel.mode !== 'act' ? sel.mode : null;
      prompt = mode === null ? plan.weak : `${this.word(mode, mode)}: ${plan.weak.charAt(0).toLowerCase()}${plan.weak.slice(1)}`;
    } else if (plan?.told !== undefined && plan.can) {
      // A move is pointed at of which there is something to be told (it is a short move; it will spend the unit): in full.
      prompt = plan.told;
    }
    const focus = this.open ? this.focus() : null;
    const pointedCard = focus && focus.counter !== null ? this.cardOf(focus.counter) : this.pointed.counter !== null ? this.cardOf(this.pointed.counter) : null;
    // A unit with no valid moves that Tab has just stepped to: its card, so that the player sees what it is.
    const idleCard = this.open && this.idleShown !== null && this.idleShown.length > 0 ? this.cardOf(this.idleShown[0] as string) : null;
    const card = pointedCard ?? (selected.length > 0 ? this.cardOf(selected[0] as string) : idleCard);
    const point: PointModel | null = plan && !plan.quiet && plan.hex >= 0 ? { hex: plan.hex, unit: plan.unit, act: plan.act, can: plan.can, words: plan.words } : null;

    const controls: ControlModel[] = [];
    /** What a control's hover line says besides its name, by control. */
    const hints = new Map<ControlId, string>();
    const add = (id: ControlId, text: string, key: string, enabled: boolean, primary = false, on = false, row?: 'unit'): void => {
      controls.push({ id, label: text, key, enabled, primary, on, ...(row ? { row } : {}) });
    };
    // Enter does what Tab has stepped to.
    const ring = this.open && pos.stage === 'play' ? this.ring(idx) : [];
    const entered = this.cursor !== null ? plan : null;
    const confirmable = entered !== null && entered.can;
    if (this.rich && seat !== null && pos.stage === 'setup') {
      add('preset', this.word('preset', 'Preset'), 'Q', idx.preset !== null);
      add('next', 'Next unit', 'Tab', idx.places.length > 0);
      add('takeBack', this.word('takeBack', 'Take back'), 'Bksp', sel.kind === 'placing' && idx.takeBacks.has(sel.unit));
      add('start', this.word('start', 'Start'), 'Enter', idx.ready !== null, true);
    } else if (this.rich && seat !== null && pos.stage === 'play') {
      const unit = this.open ? this.chosenUnit() : null;
      const modes = unit === null ? [] : this.modesOf(idx, unit);
      const mode = sel.kind === 'unit' ? sel.mode : sel.kind === 'drive' ? 'drive' : null;
      const act = entered?.act;
      const confirmWord = act === 'fire' ? 'Fire' : act === 'charge' || act === 'drive' ? 'Go' : act === 'board' ? this.word('board', 'Go') : act === 'select' ? 'Choose' : act === 'move' ? 'Move' : 'Confirm';
      add('confirm', confirmWord, 'Enter', confirmable, confirmable);
      // Ending the turn is always there on the seat's turn; it is the suggested control only when nothing of the seat's can still act.
      // (It is also the suggested one, and lit, while it waits for its second press: the first asked, and nothing was done since.)
      const asked = this.open && this.endAsked !== null && this.endAsked === this.port.seq();
      add('end', this.word('end', 'End'), 'E', idx.end !== null, idx.end !== null && !confirmable && (idx.actable.length === 0 || asked), asked);
      // Tab chooses the next unit, or (in a way switched on by its key) steps through that way's choices.
      const stepsUnits = this.open && this.tabsUnits(idx);
      const canStep = stepsUnits ? this.tabOrder(idx).some(u => u.can || u.idle) : ring.length > 0;
      add('next', stepsUnits ? 'Next unit' : 'Next choice', 'Tab', canStep, idx.actable.length > 0 && !confirmable && !asked);
      // While Tab chooses units, R steps through what the chosen unit can do (its targets, then its hexes), so that every
      // action can be made from the keyboard: Enter does the one stepped to.
      add('aim', 'Next choice', 'R', stepsUnits && (sel.kind === 'unit' || sel.kind === 'drive') && ring.length > 0, false, false, 'unit');
      add('back', 'Back', 'Esc', sel.kind !== 'none' || this.cursor !== null);
      const carried = this.carriedBy(unit);
      add('charge', this.word('charge', 'Charge'), MODE_KEYS.charge, modes.includes('charge'), false, mode === 'charge', 'unit');
      add('drive', this.word('drive', 'Drive'), MODE_KEYS.drive, modes.includes('drive'), false, mode === 'drive', 'unit');
      add('board', this.word('board', 'Board'), MODE_KEYS.board, modes.includes('board'), false, mode === 'board', 'unit');
      add('unload', this.word('unload', 'Unload'), 'U', carried !== null && idx.actable.includes(carried), false, false, 'unit');
      add('call', this.word('call', 'Call'), MODE_KEYS.call, modes.includes('call'), false, mode === 'call', 'unit');
      add('screen', this.word('screen', 'Screen'), MODE_KEYS.screen, modes.includes('screen'), false, mode === 'screen', 'unit');
      add('route', this.word('route', 'Other route'), 'X', (plan?.ways ?? 1) > 1, false, (plan?.ways ?? 1) > 1 && plan?.way === 1, 'unit');
      add('advance', this.word('advance', 'Advance'), 'G', mode === 'charge', false, mode === 'charge' && this.advance, 'unit');
      // The side's one switch, with its setting now after its name, and what that does on its hover line.
      const now = pos.sides.find(s => s.seat === seat)?.setting;
      add('setting', now !== undefined ? `${this.word('setting', 'Setting')}: ${now}` : this.word('setting', 'Setting'), 'H', this.nextSetting(idx) !== null, false, false, 'unit');
      const does = now !== undefined ? this.word(`setting:${now}`, '') : '';
      if (does !== '') hints.set('setting', does);
    } else if (seat !== null && pos.stage === 'setup') {
      add('deal', 'Deal again', 'N', this.canDeal());
      add('start', 'Start', 'Enter', this.canStart(), true);
    } else if (seat !== null && pos.stage === 'play') {
      add('end', `End ${pos.phase.toLowerCase()}`, 'E', idx.end !== null, !confirmable);
      add('next', sel.kind === 'none' ? 'Next unit' : 'Next choice', 'Tab', ring.length > 0);
      add('confirm', entered?.act === 'fire' ? 'Attack' : entered?.act === 'move' ? 'Move' : entered?.act === 'select' ? 'Choose' : 'Confirm', 'Enter', confirmable, confirmable);
      add('back', 'Back', 'Esc', sel.kind !== 'none' || this.cursor !== null);
    }
    // Every control that is off says why.
    const explained = controls.map(c => {
      const hint = hints.get(c.id);
      const with_ = hint !== undefined ? { ...c, hint } : c;
      return c.enabled ? with_ : { ...with_, why: this.whyOff(c.id, idx) };
    });

    return {
      selected,
      canAct,
      targets,
      close,
      reach,
      reachNear,
      targetHexes: targetHexes ?? [...new Set(targets.map(t => this.hexOf(t)).filter(h => h >= 0))],
      path: shown.path ?? [],
      zone: settingUp && seat !== null ? this.info.zones[seat] ?? [] : [],
      aim: shown.aim ?? [],
      proposal,
      card,
      odds: shown.odds ?? null,
      prompt,
      note: (playing || (this.rich && settingUp)) ? this.reading.phaseNote(this.shown) : '',
      controls: explained,
      threats: shown.threats ?? [],
      routes: shown.routes ?? [],
      chances,
      picks,
      hand: this.hand?.id ?? null,
      // A group is gone to at any time in play: it sends nothing.
      groupsGo: this.rich && pos.stage === 'play' && seat !== null,
      tray,
      point,
      intent: plan && !plan.quiet ? plan.line : '',
      answer: this.said,
      ...(guide ? { guide } : {}),
    };
  }
}
