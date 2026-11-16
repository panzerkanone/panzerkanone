/**
 * The reference ruleset: a small, wholly data-driven ruleset that proves the
 * engine kernel. It ports the old prototype's behaviour in general form (see
 * README.md): both sides set up at once, hidden until both have submitted;
 * then each turn every side in order takes a player-turn of phases from the
 * data (gunnery, then manoeuvre); fire is declared by unit and resolved when
 * gunnery ends, combined per target, by odds against the data's fire table on
 * two dice; movement is by terrain cost up to an allowance; stacking is
 * limited per side; a side with too few units left loses at once, otherwise
 * the higher score wins at the turn limit.
 *
 * Every number comes from the ruleset data and the scenario. apply never
 * mutates its input: it builds the new state by reducing the events it emits
 * onto a copy, and reduce() replays recorded events with the same code, so a
 * game rebuilt from its events is the game that was played.
 */
import { HexId, distance } from '../../core/hex';
import { Cover, MapDescription, hexOf } from '../../core/map';
import { CompiledBoard, boardMismatch, compileBoard, mapHash, terrainHash } from '../../core/board';
import { FloodResult, PathSearch, newFloodResult, routeTo } from '../../core/path';
import { contentHash } from '../../core/canonical';
import { Checker } from '../../kernel/check';
import {
  Applied, ContentRef, Decision, Dice, KERNEL_REJECTION_CODES, MatchResult, Outcome, Rejection, Ruleset, Seat,
} from '../../kernel/ruleset';
import { FireColumn, RulesetData, rulesetHash, terrainOf } from './data';
import { ScenarioData, scenarioHash, zoneHexes } from './scenario';
import {
  ACTION_TYPES, ATTACK_RESULTS, AttackQuery, AttackResult, EVENT_TYPES, END_REASONS, RefAction, RefEvent, RefState,
  RefView, SideState, SideView, UnitState,
} from './types';

export const REFERENCE_REJECTION_CODES = [
  ...KERNEL_REJECTION_CODES,
  'already_submitted', // the seat has already submitted its set-up
  'wrong_phase',       // the action cannot be taken in this stage or phase
  'unknown_unit',      // no unit has that id
  'not_your_unit',     // the unit belongs to the other side
  'unit_unable',       // the unit cannot act now: destroyed, suppressed, spent, not on the board, or not next to be placed
  'off_board',         // a hex that is not on the board
  'not_adjacent',      // a path step to a hex that is not next to the one before
  'impassable',        // a step (or a placement) the unit's mover type cannot make
  'over_allowance',    // the path costs more than the unit's allowance
  'enemy_hex',         // the path enters a hex an enemy unit holds
  'stacking',          // the hex would hold more of the side's units than its stacking limit
  'outside_zone',      // a placement outside the side's set-up zone
  'bad_target',        // the target is not an enemy unit on the board
  'out_of_range',      // the target is beyond the unit's range
  'no_sight',          // the unit cannot see the target
  'no_effect',         // the unit has no firepower against the target's class
  'incomplete',        // submitting before every unit is placed
] as const;

export type RefRejectionCode = (typeof REFERENCE_REJECTION_CODES)[number];

/** A unit type compiled for fast lookups. */
export interface TypeInfo {
  readonly id: string;
  readonly mover: number;
  readonly classIndex: number;
  /** Firepower per target class index. */
  readonly firepower: readonly number[];
  readonly defense: number;
  readonly range: number;
  readonly allowance: number;
  readonly value: number;
}

/** The ways (out of the dice space) each result can happen, for one column. */
interface ColumnWays {
  readonly destroyed: number;
  readonly suppressed: number;
  readonly none: number;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Draft = Mutable<RefState> & { units: UnitState[]; sides: SideState[] };

/** A value the checked data must hold; its absence is a bug, never a default. */
function need<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`reference ruleset: no value for ${what}`);
  return v;
}

function reject(code: RefRejectionCode, detail: string): Rejection {
  return { code, detail };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function own(o: Record<string, unknown>, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

function isWhole(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

const ACTION_KEYS: Readonly<Record<string, readonly string[]>> = {
  place: ['type', 'unit', 'hex'],
  submit: ['type'],
  fire: ['type', 'unit', 'target'],
  hold: ['type', 'unit'],
  move: ['type', 'unit', 'path'],
  end: ['type'],
};

export interface ReferenceContent {
  readonly data: RulesetData;
  readonly scenario: ScenarioData;
  readonly map: MapDescription;
}

export class ReferenceRuleset implements Ruleset<RefState, RefAction, RefEvent, RefView, AttackQuery> {
  readonly id: string;
  readonly version: string;
  readonly content: ContentRef;
  readonly scenarioRef: ContentRef;
  readonly seats: readonly Seat[];
  readonly rejectionCodes: readonly string[] = REFERENCE_REJECTION_CODES;
  readonly eventTypes: readonly string[] = EVENT_TYPES;

  readonly data: RulesetData;
  readonly scenario: ScenarioData;
  readonly board: CompiledBoard;
  readonly sequence: readonly string[];
  /** Unit types by id. */
  readonly types: ReadonlyMap<string, TypeInfo>;
  /** Per side: its unit ids in force order. */
  readonly rosters: readonly (readonly number[])[];
  /** The type of each unit id. */
  readonly unitTypes: readonly string[];
  /** Per side: 1 for the hexes of its set-up zone. */
  readonly zones: readonly Uint8Array[];
  /** Per mover index: 1 where a unit of that mover type may stand. */
  readonly standable: readonly Uint8Array[];
  readonly stacking: readonly number[];
  readonly objectives: readonly { readonly hex: HexId; readonly points: number }[];
  readonly diceSpace: number;
  private readonly columnWays: readonly ColumnWays[];
  private readonly coverDefense: ReadonlyMap<Cover, number>;
  private readonly search: PathSearch;
  private readonly flood: FloodResult;

  constructor(content: ReferenceContent, board?: CompiledBoard) {
    const { data, scenario, map } = content;
    this.data = data;
    this.scenario = scenario;
    this.id = data.id;
    this.version = String(data.version);
    this.content = { id: data.id, hash: rulesetHash(data) };
    this.scenarioRef = { id: scenario.id, hash: scenarioHash(scenario) };
    // The board must be the one this content compiles to: the scenario's map, and this
    // data's terrain. A board compiled from anything else is refused, never played on.
    const terrain = terrainOf(data);
    const givenMap = mapHash(map);
    if (map.id !== scenario.map.id || givenMap !== scenario.map.hash) {
      throw new Error(`map ${scenario.map.id}: the scenario was made for content hash ${scenario.map.hash}, the map given is ${map.id} with ${givenMap}`);
    }
    this.board = board ?? compileBoard(map, terrain);
    const mismatch = boardMismatch(this.board, { mapId: scenario.map.id, mapHash: scenario.map.hash, terrainHash: terrainHash(terrain) });
    if (mismatch !== null) throw new Error(`reference ruleset ${data.id}: refused ${mismatch}`);
    this.seats = scenario.sides.map(s => s.id);
    this.sequence = data.sequence.slice();

    const types = new Map<string, TypeInfo>();
    for (const t of data.unitTypes) {
      types.set(t.id, {
        id: t.id,
        mover: this.board.moverIndex(t.mover),
        classIndex: data.targetClasses.indexOf(t.class),
        firepower: data.targetClasses.map(k => need(t.firepower[k], `unit type ${t.id}: firepower against ${k}`)),
        defense: t.defense,
        range: t.range,
        allowance: t.allowance,
        value: t.value,
      });
    }
    this.types = types;

    const rosters: number[][] = [];
    const unitTypes: string[] = [];
    for (const side of scenario.sides) {
      const ids: number[] = [];
      for (const entry of side.force) {
        for (let k = 0; k < entry.count; k++) {
          ids.push(unitTypes.length);
          unitTypes.push(entry.type);
        }
      }
      rosters.push(ids);
    }
    this.rosters = rosters;
    this.unitTypes = unitTypes;

    const n = this.board.n;
    this.zones = scenario.sides.map(s => {
      const z = new Uint8Array(n);
      for (const h of zoneHexes(map, s.zone)) z[h] = 1;
      return z;
    });
    this.stacking = scenario.sides.map(s => s.stacking);
    this.objectives = scenario.objectives.map(o => ({ hex: this.hexOfLabel(o.hex), points: o.points }));

    // Where a mover type may stand: it could enter the hex off-road, or a road runs through it.
    const mv = data.movement;
    this.standable = data.moverTypes.map(m => {
      const s = new Uint8Array(n);
      for (let h = 0; h < n; h++) {
        const cover = this.board.coverOf(h);
        const enter = need(mv.enter[cover][m], `movement.enter.${cover}.${m}`);
        const offRoad = enter !== null && (this.board.riverHex[h] !== 1 || need(mv.river[m], `movement.river.${m}`) !== null);
        const onRoad = this.board.roadHex[h] === 1 && need(mv.road[m], `movement.road.${m}`) !== null;
        s[h] = offRoad || onRoad ? 1 : 0;
      }
      return s;
    });

    this.coverDefense = new Map(Object.entries(data.fire.coverDefense) as [Cover, number][]);
    this.diceSpace = data.dice.faces ** data.dice.count;
    this.columnWays = data.fire.columns.map(col => this.waysOf(col));
    this.search = new PathSearch(this.board);
    this.flood = newFloodResult(n);
  }

  private hexOfLabel(label: string): HexId {
    const h = hexOf(this.board.grid, label);
    if (h < 0) throw new Error(`hex ${label} is not on board ${this.board.id}`);
    return h;
  }

  /** Count, over every dice value, how often each result happens in a column. */
  private waysOf(col: FireColumn): ColumnWays {
    const { count, faces } = this.data.dice;
    let destroyed = 0;
    let suppressed = 0;
    let none = 0;
    const total = faces ** count;
    for (let v = 0; v < total; v++) {
      let sum = 0;
      let x = v;
      for (let k = 0; k < count; k++) {
        sum += (x % faces) + 1;
        x = Math.floor(x / faces);
      }
      const r = resultOf(col, sum);
      if (r === 'destroyed') destroyed++;
      else if (r === 'suppressed') suppressed++;
      else none++;
    }
    return { destroyed, suppressed, none };
  }

  // -------------------------------------------------------------------------
  // the state
  // -------------------------------------------------------------------------

  initial(): RefState {
    const units: UnitState[] = this.unitTypes.map((type, id) => ({
      id, type, side: this.sideOfUnit(id), hex: -1, destroyed: false, suppressed: false, spent: false, target: -1,
    }));
    return {
      format: 'reference/1',
      map: { id: this.board.id, hash: this.board.hash },
      stage: 'setup',
      turn: 1,
      side: 0,
      phase: '',
      roll: 0,
      units,
      sides: this.seats.map(() => ({ placed: [], submitted: false, score: 0, losses: 0 })),
      result: null,
    };
  }

  private sideOfUnit(id: number): number {
    for (let s = 0; s < this.rosters.length; s++) if ((this.rosters[s] as readonly number[]).includes(id)) return s;
    return -1;
  }

  /** The compiled unit type of a unit. */
  typeOf(u: UnitState): TypeInfo {
    const t = this.types.get(u.type);
    if (!t) throw new Error(`unknown unit type '${u.type}'`);
    return t;
  }

  pending(s: RefState): Decision {
    return this.decidingIn(s);
  }

  /** Who must decide, from a state or a view: both hold the stage, the side to play and who has submitted. */
  private decidingIn(at: RefState | RefView): Decision {
    if (at.stage === 'over') return { kind: 'over' };
    if (at.stage === 'setup') {
      const seats = this.seats.filter((_, i) => !(at.sides[i] as { readonly submitted: boolean }).submitted);
      return { kind: 'decide', seats };
    }
    return { kind: 'decide', seats: [this.seats[at.side] as Seat] };
  }

  result(s: RefState): MatchResult | null {
    if (!s.result) return null;
    return { winner: s.result.winner >= 0 ? (this.seats[s.result.winner] ?? null) : null, reason: s.result.reason };
  }

  turn(s: RefState): number {
    return s.turn;
  }

  copy(s: RefState): RefState {
    return {
      format: s.format,
      map: { id: s.map.id, hash: s.map.hash },
      stage: s.stage,
      turn: s.turn,
      side: s.side,
      phase: s.phase,
      roll: s.roll,
      units: s.units.map(u => ({
        id: u.id, type: u.type, side: u.side, hex: u.hex, destroyed: u.destroyed, suppressed: u.suppressed, spent: u.spent, target: u.target,
      })),
      sides: s.sides.map(x => ({ placed: x.placed.slice(), submitted: x.submitted, score: x.score, losses: x.losses })),
      result: s.result ? { winner: s.result.winner, reason: s.result.reason } : null,
    };
  }

  hash(s: RefState): string {
    return contentHash(s);
  }

  // -------------------------------------------------------------------------
  // views
  // -------------------------------------------------------------------------

  /**
   * What a seat (or a spectator) sees: everything on the map once play starts
   * (PLAN R3); during set-up, only its own side's placements. The view is new
   * data: no object in it is an object of the state, so writing into a view
   * changes nothing the host keeps.
   */
  view(s: RefState, viewer: Seat | null): RefView {
    const vi = viewer === null ? -1 : this.seats.indexOf(viewer);
    if (viewer !== null && vi < 0) throw new Error(`view: '${viewer}' is not a seat of this match`);
    return {
      format: 'reference-view/1',
      viewer: vi,
      map: { id: s.map.id, hash: s.map.hash },
      stage: s.stage,
      turn: s.turn,
      side: s.side,
      phase: s.phase,
      units: s.units.map(u => ({
        id: u.id, type: u.type, side: u.side, hex: u.hex, destroyed: u.destroyed, suppressed: u.suppressed, spent: u.spent, target: u.target,
      })),
      sides: s.sides.map((x, i) => ({ placed: i === vi ? x.placed.slice() : null, submitted: x.submitted, score: x.score, losses: x.losses })),
      result: s.result ? { winner: s.result.winner, reason: s.result.reason } : null,
    };
  }

  /** What a viewer sees of an event: a copy of it, or null when hidden (another side's set-up placement). */
  eventFor(e: RefEvent, viewer: Seat | null): RefEvent | null {
    if (e.type === 'placed') {
      const vi = viewer === null ? -1 : this.seats.indexOf(viewer);
      if (vi !== e.side) return null;
    }
    return copyEvent(e);
  }

  // -------------------------------------------------------------------------
  // positions: helpers that read a state or a view
  // -------------------------------------------------------------------------

  private live(u: UnitState): boolean {
    return !u.destroyed && u.hex >= 0;
  }

  /** A unit that may act now: alive, on the board, not suppressed, not spent. */
  private able(u: UnitState): boolean {
    return !u.destroyed && u.hex >= 0 && !u.suppressed && !u.spent;
  }

  private liveCount(units: readonly UnitState[], side: number): number {
    let n = 0;
    for (const u of units) if (u.side === side && !u.destroyed) n++;
    return n;
  }

  /** What the cover of a hex adds to the defense of a unit in it. */
  coverDefenseAt(hex: HexId): number {
    const cover = this.board.coverOf(hex);
    return need(this.coverDefense.get(cover), `fire.coverDefense.${cover}`);
  }

  /** The defense of a unit where it stands: its own plus its hex's cover. */
  defenseOf(units: readonly UnitState[], target: number): number {
    const t = units[target] as UnitState;
    return this.typeOf(t).defense + this.coverDefenseAt(t.hex);
  }

  /** The combined firepower of some units against a target's class. */
  attackOf(units: readonly UnitState[], attackers: readonly number[], target: number): number {
    const cls = this.typeOf(units[target] as UnitState).classIndex;
    let a = 0;
    for (const id of attackers) a += this.typeOf(units[id] as UnitState).firepower[cls] as number;
    return a;
  }

  /** The fire table column for an attack and defense, or -1 below the first column. */
  columnOf(attack: number, defense: number): number {
    const cols = this.data.fire.columns;
    let col = -1;
    for (let i = 0; i < cols.length; i++) {
      const [p, q] = (cols[i] as FireColumn).atLeast;
      if (attack * q >= defense * p) col = i;
      else break;
    }
    return col;
  }

  private distributionOf(column: number): Outcome[] {
    const total = this.diceSpace;
    const w: ColumnWays = column < 0 ? { destroyed: 0, suppressed: 0, none: total } : (this.columnWays[column] as ColumnWays);
    return [
      { result: 'destroyed', ways: w.destroyed, of: total, p: w.destroyed / total },
      { result: 'suppressed', ways: w.suppressed, of: total, p: w.suppressed / total },
      { result: 'none', ways: w.none, of: total, p: w.none / total },
    ];
  }

  /**
   * The exact outcome distribution of an attack: every result with the number
   * of dice values (out of the whole dice space) that give it. Works on a
   * state or on a view: everything it reads is visible once play starts.
   */
  outcomes(at: RefState | RefView, q: AttackQuery): Outcome[] {
    const units = at.units;
    const t = units[q.target];
    if (!t || !this.live(t)) throw new Error(`outcomes: unit ${q.target} is not a unit on the board`);
    if (q.attackers.length === 0) throw new Error('outcomes: an attack needs at least one attacker');
    for (const a of q.attackers) {
      const u = units[a];
      if (!u || !this.live(u) || u.side === t.side) throw new Error(`outcomes: unit ${a} cannot attack unit ${q.target}`);
    }
    return this.distributionOf(this.columnOf(this.attackOf(units, q.attackers, q.target), this.defenseOf(units, q.target)));
  }

  // -------------------------------------------------------------------------
  // legal actions
  // -------------------------------------------------------------------------

  /** Count of a side's live units in each hex that holds any. */
  private occupancy(units: readonly UnitState[]): { own: Map<HexId, number>[]; enemyMask: Uint8Array[] } {
    const own: Map<HexId, number>[] = this.seats.map(() => new Map());
    const enemyMask = this.seats.map(() => new Uint8Array(this.board.n));
    for (const u of units) {
      if (!this.live(u)) continue;
      const m = own[u.side] as Map<HexId, number>;
      m.set(u.hex, (m.get(u.hex) ?? 0) + 1);
      for (let s = 0; s < enemyMask.length; s++) if (s !== u.side) (enemyMask[s] as Uint8Array)[u.hex] = 1;
    }
    return { own, enemyMask };
  }

  /**
   * Every action the view's seat may take now, read from the view alone (a
   * client, an agent and the host ask the same question of the same data).
   * During set-up the view holds the seat's own placements and nothing of the
   * other side's, so what the other side has placed cannot change the list.
   */
  legalActions(v: RefView): RefAction[] {
    const si = v.viewer;
    const seat = this.seats[si];
    if (seat === undefined || v.stage === 'over') return [];
    const pend = this.decidingIn(v);
    if (pend.kind !== 'decide' || !pend.seats.includes(seat)) return [];
    const out: RefAction[] = [];
    if (v.stage === 'setup') {
      const placed = (v.sides[si] as SideView).placed;
      if (placed === null) throw new Error(`legalActions: the view of seat ${seat} does not hold its own placements`);
      const roster = this.rosters[si] as readonly number[];
      if (placed.length >= roster.length) return [{ type: 'submit' }];
      const unit = roster[placed.length] as number;
      const mover = this.typeOf(v.units[unit] as UnitState).mover;
      const standable = this.standable[mover] as Uint8Array;
      const zone = this.zones[si] as Uint8Array;
      const count = new Map<HexId, number>();
      for (const h of placed) count.set(h, (count.get(h) ?? 0) + 1);
      const limit = this.stacking[si] as number;
      for (let h = 0; h < this.board.n; h++) {
        if (zone[h] === 1 && standable[h] === 1 && (count.get(h) ?? 0) < limit) out.push({ type: 'place', unit, hex: h });
      }
      return out;
    }
    const units = v.units;
    if (v.phase === 'gunnery') {
      for (const u of units) {
        if (u.side !== si || !this.able(u)) continue;
        const t = this.typeOf(u);
        for (const e of units) {
          if (e.side === si || !this.live(e)) continue;
          if ((t.firepower[this.typeOf(e).classIndex] as number) <= 0) continue;
          if (distance(this.board.grid, u.hex, e.hex) > t.range) continue;
          if (!this.board.sees(u.hex, e.hex)) continue;
          out.push({ type: 'fire', unit: u.id, target: e.id });
        }
      }
    } else if (v.phase === 'manoeuvre') {
      const occ = this.occupancy(units);
      const own = occ.own[si] as Map<HexId, number>;
      const blocked = occ.enemyMask[si] as Uint8Array;
      const limit = this.stacking[si] as number;
      for (const u of units) {
        if (u.side !== si || !this.able(u)) continue;
        const t = this.typeOf(u);
        if (t.allowance <= 0) continue;
        const f = this.search.flood(t.mover, u.hex, blocked, t.allowance, this.flood);
        for (let h = 0; h < this.board.n; h++) {
          if (h === u.hex || (f.cost[h] as number) < 0) continue;
          if ((own.get(h) ?? 0) >= limit) continue;
          const route = routeTo(f, h) as HexId[];
          out.push({ type: 'move', unit: u.id, path: route.slice(1) });
        }
      }
    }
    for (const u of units) if (u.side === si && this.able(u)) out.push({ type: 'hold', unit: u.id });
    out.push({ type: 'end' });
    return out;
  }

  // -------------------------------------------------------------------------
  // checking an action
  // -------------------------------------------------------------------------

  check(s: RefState, seat: Seat, action: unknown): Rejection | null {
    const v = this.validate(s, seat, action);
    return 'code' in v ? v : null;
  }

  /** The action checked and typed, with its seat's side index, or a rejection. */
  private validate(s: RefState, seat: unknown, raw: unknown): Rejection | { side: number; action: RefAction } {
    const si = typeof seat === 'string' ? this.seats.indexOf(seat) : -1;
    if (si < 0) return reject('unknown_seat', `'${String(seat)}' is not a seat of this match`);
    if (s.stage === 'over') return reject('game_over', 'the game is over');
    if (s.stage === 'setup' && (s.sides[si] as SideState).submitted) return reject('already_submitted', `${String(seat)} has already submitted its set-up`);
    const pend = this.pending(s);
    if (pend.kind !== 'decide' || !pend.seats.includes(seat as string)) return reject('not_your_turn', `it is not ${String(seat)}'s decision`);

    if (!isPlainObject(raw)) return reject('malformed', 'an action is a mapping of keys to values');
    if (!own(raw, 'type') || typeof raw.type !== 'string') return reject('malformed', 'an action needs a type');
    const type = raw.type;
    const keys = ACTION_KEYS[type];
    if (!(ACTION_TYPES as readonly string[]).includes(type) || keys === undefined) return reject('unknown_action', `no action is called '${type}'`);
    for (const k of Object.keys(raw)) if (!keys.includes(k)) return reject('malformed', `unknown key '${k}' in a ${type} action`);
    for (const k of keys) if (!own(raw, k)) return reject('malformed', `a ${type} action needs '${k}'`);
    for (const k of ['unit', 'hex', 'target']) {
      if (own(raw, k) && !isWhole(raw[k])) return reject('malformed', `${k} must be a whole number`);
    }
    if (type === 'move') {
      const p = raw.path;
      if (!Array.isArray(p) || p.length < 1 || p.length > this.board.n) return reject('malformed', 'path must be a list of one or more hexes');
      for (const h of p) if (!isWhole(h)) return reject('malformed', 'every hex of a path is a whole number');
    }
    const units = s.units;
    const unitArg = (): UnitState | Rejection => {
      const id = raw.unit as number;
      const u = id >= 0 ? units[id] : undefined;
      if (!u) return reject('unknown_unit', `there is no unit ${id}`);
      if (u.side !== si) return reject('not_your_unit', `unit ${id} is not ${String(seat)}'s`);
      return u;
    };

    switch (type) {
      case 'place': {
        if (s.stage !== 'setup') return reject('wrong_phase', 'units are placed only during set-up');
        const u = unitArg();
        if ('code' in u) return u;
        const side = s.sides[si] as SideState;
        const roster = this.rosters[si] as readonly number[];
        const next = roster[side.placed.length];
        if (next !== u.id) return reject('unit_unable', next === undefined ? 'every unit is placed' : `unit ${next} is the next to be placed, not ${u.id}`);
        const h = raw.hex as number;
        if (!this.board.has(h)) return reject('off_board', `hex ${h} is not on the board`);
        if ((this.zones[si] as Uint8Array)[h] !== 1) return reject('outside_zone', `hex ${h} is outside ${String(seat)}'s set-up zone`);
        if ((this.standable[this.typeOf(u).mover] as Uint8Array)[h] !== 1) return reject('impassable', `a ${u.type} cannot stand in hex ${h}`);
        let here = 0;
        for (const x of side.placed) if (x === h) here++;
        if (here >= (this.stacking[si] as number)) return reject('stacking', `hex ${h} already holds ${here} units`);
        return { side: si, action: { type: 'place', unit: u.id, hex: h } };
      }
      case 'submit': {
        if (s.stage !== 'setup') return reject('wrong_phase', 'set-up is over');
        const side = s.sides[si] as SideState;
        const roster = this.rosters[si] as readonly number[];
        if (side.placed.length < roster.length) return reject('incomplete', `${roster.length - side.placed.length} units are not yet placed`);
        return { side: si, action: { type: 'submit' } };
      }
      case 'fire': {
        if (s.stage !== 'play' || s.phase !== 'gunnery') return reject('wrong_phase', 'fire is declared only in the gunnery phase');
        const u = unitArg();
        if ('code' in u) return u;
        if (!this.able(u)) return reject('unit_unable', `unit ${u.id} cannot act now`);
        const tid = raw.target as number;
        const t = tid >= 0 ? units[tid] : undefined;
        if (!t) return reject('unknown_unit', `there is no unit ${tid}`);
        if (t.side === si || !this.live(t)) return reject('bad_target', `unit ${tid} is not an enemy unit on the board`);
        const ti = this.typeOf(u);
        if (distance(this.board.grid, u.hex, t.hex) > ti.range) return reject('out_of_range', `unit ${tid} is beyond unit ${u.id}'s range of ${ti.range}`);
        if (!this.board.sees(u.hex, t.hex)) return reject('no_sight', `unit ${u.id} cannot see unit ${tid}`);
        if ((ti.firepower[this.typeOf(t).classIndex] as number) <= 0) return reject('no_effect', `unit ${u.id} has no firepower against unit ${tid}`);
        return { side: si, action: { type: 'fire', unit: u.id, target: tid } };
      }
      case 'hold': {
        if (s.stage !== 'play') return reject('wrong_phase', 'units hold only during play');
        const u = unitArg();
        if ('code' in u) return u;
        if (!this.able(u)) return reject('unit_unable', `unit ${u.id} cannot act now`);
        return { side: si, action: { type: 'hold', unit: u.id } };
      }
      case 'move': {
        if (s.stage !== 'play' || s.phase !== 'manoeuvre') return reject('wrong_phase', 'units move only in the manoeuvre phase');
        const u = unitArg();
        if ('code' in u) return u;
        if (!this.able(u)) return reject('unit_unable', `unit ${u.id} cannot act now`);
        const t = this.typeOf(u);
        const steps = this.board.stepCost[t.mover] as Int32Array;
        const path = raw.path as number[];
        let at = u.hex;
        let cost = 0;
        for (const h of path) {
          if (!this.board.has(h)) return reject('off_board', `hex ${h} is not on the board`);
          let d = -1;
          for (let k = 0; k < 6; k++) if (this.board.neighbour[at * 6 + k] === h) d = k;
          if (d < 0) return reject('not_adjacent', `hex ${h} is not next to hex ${at}`);
          for (const e of units) {
            if (e.side !== si && this.live(e) && e.hex === h) return reject('enemy_hex', `hex ${h} holds an enemy unit`);
          }
          const c = steps[at * 6 + d] as number;
          if (c < 0) return reject('impassable', `a ${u.type} cannot step from hex ${at} to hex ${h}`);
          cost += c;
          if (cost > t.allowance) return reject('over_allowance', `the path costs at least ${cost}, more than the allowance of ${t.allowance}`);
          at = h;
        }
        let here = 0;
        for (const e of units) if (e.side === si && e.id !== u.id && this.live(e) && e.hex === at) here++;
        if (here >= (this.stacking[si] as number)) return reject('stacking', `hex ${at} already holds ${here} units`);
        return { side: si, action: { type: 'move', unit: u.id, path: path.slice() } };
      }
      case 'end': {
        if (s.stage !== 'play') return reject('wrong_phase', 'there is no phase to end during set-up');
        return { side: si, action: { type: 'end' } };
      }
      default:
        return reject('unknown_action', `no action is called '${type}'`);
    }
  }

  // -------------------------------------------------------------------------
  // applying an action
  // -------------------------------------------------------------------------

  apply(s: RefState, seat: Seat, action: unknown, dice: Dice): Applied<RefState, RefEvent> {
    const v = this.validate(s, seat, action);
    if ('code' in v) return { ok: false, rejection: v };
    const d = draftOf(s);
    const events: RefEvent[] = [];
    const emit = (e: RefEvent): void => {
      this.reduceOne(d, e);
      events.push(e);
    };
    const act = v.action;
    const si = v.side;
    switch (act.type) {
      case 'place':
        emit({ type: 'placed', side: si, unit: act.unit, hex: act.hex });
        break;
      case 'submit': {
        emit({ type: 'submitted', side: si });
        if (d.sides.every(x => x.submitted)) {
          const hexes = d.units.map(() => -1);
          d.sides.forEach((x, k) => {
            (this.rosters[k] as readonly number[]).forEach((id, j) => { hexes[id] = x.placed[j] as number; });
          });
          emit({ type: 'revealed', hexes });
          emit({ type: 'phase_begun', turn: 1, side: 0, phase: this.sequence[0] as string, fresh: true });
        }
        break;
      }
      case 'fire':
        emit({ type: 'declared', unit: act.unit, target: act.target });
        break;
      case 'hold':
        emit({ type: 'held', unit: act.unit });
        break;
      case 'move': {
        const t = this.typeOf(d.units[act.unit] as UnitState);
        const steps = this.board.stepCost[t.mover] as Int32Array;
        let at = (d.units[act.unit] as UnitState).hex;
        let cost = 0;
        for (const h of act.path) {
          for (let k = 0; k < 6; k++) {
            if (this.board.neighbour[at * 6 + k] === h) {
              cost += steps[at * 6 + k] as number;
              break;
            }
          }
          at = h;
        }
        emit({ type: 'moved', unit: act.unit, path: act.path.slice(), cost });
        break;
      }
      case 'end':
        this.endPhase(d, dice, emit);
        break;
    }
    return { ok: true, state: d, events };
  }

  /** Ending a phase: resolve declared fire after gunnery; after the last phase, close the player-turn. */
  private endPhase(d: Draft, dice: Dice, emit: (e: RefEvent) => void): void {
    if (d.phase === 'gunnery') {
      const byTarget = new Map<number, number[]>();
      for (const u of d.units) {
        if (u.side === d.side && u.target >= 0) {
          const list = byTarget.get(u.target) ?? [];
          list.push(u.id);
          byTarget.set(u.target, list);
        }
      }
      const targets = [...byTarget.keys()].sort((a, b) => a - b);
      for (const target of targets) {
        const attackers = (byTarget.get(target) as number[]).sort((a, b) => a - b);
        const attack = this.attackOf(d.units, attackers, target);
        const defense = this.defenseOf(d.units, target);
        const column = this.columnOf(attack, defense);
        const dist = this.distributionOf(column);
        const certain = dist.find(o => o.ways === o.of);
        const rolls: number[] = [];
        const faces: number[] = [];
        let result: AttackResult;
        if (certain) {
          result = certain.result as AttackResult;
        } else {
          let sum = 0;
          for (let k = 0; k < this.data.dice.count; k++) {
            const n = d.roll + k;
            const f = dice.roll(n, this.data.dice.faces);
            rolls.push(n);
            faces.push(f);
            sum += f;
          }
          result = resultOf(this.data.fire.columns[column] as FireColumn, sum);
        }
        emit({ type: 'attack', target, attackers, attack, defense, column, rolls, dice: faces, result });
        if (result === 'destroyed') {
          const ts = (d.units[target] as UnitState).side;
          if (this.liveCount(d.units, ts) <= this.scenario.brokenAt) {
            const other = this.liveCount(d.units, d.side) <= this.scenario.brokenAt;
            emit({ type: 'ended', winner: other ? -1 : d.side, reason: 'broken' });
            return;
          }
        }
      }
    }
    const at = this.sequence.indexOf(d.phase);
    const next = this.sequence[at + 1];
    if (next !== undefined) {
      emit({ type: 'phase_begun', turn: d.turn, side: d.side, phase: next, fresh: false });
      return;
    }
    // The player-turn ends: the side's suppressed units recover.
    for (const u of d.units) if (u.side === d.side && !u.destroyed && u.suppressed) emit({ type: 'recovered', unit: u.id });
    if (d.side + 1 < this.seats.length) {
      emit({ type: 'phase_begun', turn: d.turn, side: d.side + 1, phase: this.sequence[0] as string, fresh: true });
      return;
    }
    // The turn ends: objectives score for the side that alone holds them.
    for (const o of this.objectives) {
      let holder = -1;
      let contested = false;
      for (const u of d.units) {
        if (!this.live(u) || u.hex !== o.hex) continue;
        if (holder < 0) holder = u.side;
        else if (holder !== u.side) contested = true;
      }
      if (holder >= 0 && !contested) emit({ type: 'scored', side: holder, hex: o.hex, points: o.points });
    }
    if (d.turn >= this.scenario.turns) {
      const a = (d.sides[0] as SideState).score;
      const b = (d.sides[1] as SideState).score;
      emit({ type: 'ended', winner: a > b ? 0 : b > a ? 1 : -1, reason: 'turn-limit' });
      return;
    }
    emit({ type: 'phase_begun', turn: d.turn + 1, side: 0, phase: this.sequence[0] as string, fresh: true });
  }

  // -------------------------------------------------------------------------
  // events onto a state
  // -------------------------------------------------------------------------

  reduce(s: RefState, events: readonly RefEvent[]): RefState {
    const d = draftOf(s);
    for (const e of events) this.reduceOne(d, e);
    return d;
  }

  private setUnit(d: Draft, id: number, change: Partial<UnitState>): void {
    const u = d.units[id];
    if (!u) throw new Error(`event names unit ${id}, which does not exist`);
    d.units[id] = { ...u, ...change };
  }

  private setSide(d: Draft, i: number, change: Partial<SideState>): void {
    const x = d.sides[i];
    if (!x) throw new Error(`event names side ${i}, which does not exist`);
    d.sides[i] = { ...x, ...change };
  }

  private reduceOne(d: Draft, e: RefEvent): void {
    switch (e.type) {
      case 'placed': {
        const x = d.sides[e.side] as SideState;
        this.setSide(d, e.side, { placed: [...x.placed, e.hex] });
        break;
      }
      case 'submitted':
        this.setSide(d, e.side, { submitted: true });
        break;
      case 'revealed':
        e.hexes.forEach((h, id) => this.setUnit(d, id, { hex: h }));
        d.sides.forEach((_, i) => this.setSide(d, i, { placed: [] }));
        break;
      case 'phase_begun':
        d.stage = 'play';
        d.turn = e.turn;
        d.side = e.side;
        d.phase = e.phase;
        if (e.fresh) {
          for (const u of d.units) if (u.side === e.side && (u.spent || u.target >= 0)) this.setUnit(d, u.id, { spent: false, target: -1 });
        }
        break;
      case 'declared':
        this.setUnit(d, e.unit, { spent: true, target: e.target });
        break;
      case 'held':
        this.setUnit(d, e.unit, { spent: true });
        break;
      case 'moved':
        this.setUnit(d, e.unit, { hex: e.path[e.path.length - 1] as number, spent: true });
        break;
      case 'attack': {
        d.roll += e.rolls.length;
        for (const a of e.attackers) this.setUnit(d, a, { target: -1 });
        const t = d.units[e.target] as UnitState;
        if (e.result === 'destroyed') {
          this.setUnit(d, e.target, { destroyed: true, hex: -1, suppressed: false, target: -1 });
          const ts = d.sides[t.side] as SideState;
          this.setSide(d, t.side, { losses: ts.losses + 1 });
          const attackerSide = (d.units[e.attackers[0] as number] as UnitState).side;
          const as = d.sides[attackerSide] as SideState;
          this.setSide(d, attackerSide, { score: as.score + this.typeOf(t).value });
        } else if (e.result === 'suppressed') {
          this.setUnit(d, e.target, { suppressed: true });
        }
        break;
      }
      case 'recovered':
        this.setUnit(d, e.unit, { suppressed: false });
        break;
      case 'scored': {
        const x = d.sides[e.side] as SideState;
        this.setSide(d, e.side, { score: x.score + e.points });
        break;
      }
      case 'ended':
        d.stage = 'over';
        d.phase = '';
        d.result = { winner: e.winner, reason: e.reason };
        // Fire declared but not resolved when the game ended lapses.
        for (const u of d.units) if (u.target >= 0) this.setUnit(d, u.id, { target: -1 });
        break;
    }
  }

  // -------------------------------------------------------------------------
  // the event schema
  // -------------------------------------------------------------------------

  checkEvent(raw: unknown): string[] {
    const c = new Checker('event');
    const t = isPlainObject(raw) ? raw.type : undefined;
    if (typeof t !== 'string' || !(EVENT_TYPES as readonly string[]).includes(t)) {
      c.add('type', `unknown event type ${JSON.stringify(t)} (known: ${EVENT_TYPES.join(', ')})`);
      return c.problems;
    }
    const nUnits = this.unitTypes.length;
    const nHex = this.board.n;
    const nSides = this.seats.length;
    const keysOf: Record<string, string[]> = {
      placed: ['type', 'side', 'unit', 'hex'],
      submitted: ['type', 'side'],
      revealed: ['type', 'hexes'],
      phase_begun: ['type', 'turn', 'side', 'phase', 'fresh'],
      declared: ['type', 'unit', 'target'],
      held: ['type', 'unit'],
      moved: ['type', 'unit', 'path', 'cost'],
      attack: ['type', 'target', 'attackers', 'attack', 'defense', 'column', 'rolls', 'dice', 'result'],
      recovered: ['type', 'unit'],
      scored: ['type', 'side', 'hex', 'points'],
      ended: ['type', 'winner', 'reason'],
    };
    const e = c.record(t, raw, keysOf[t] as string[]);
    if (!e) return c.problems;
    const unit = (k: string): void => { c.int(`${t}.${k}`, c.at(e, k), 0, nUnits - 1); };
    const hexList = (k: string, min: number): void => {
      const l = c.list(`${t}.${k}`, c.at(e, k), min, Math.max(min, nHex));
      l?.forEach((h, i) => c.int(`${t}.${k}[${i + 1}]`, h, 0, nHex - 1));
    };
    switch (t) {
      case 'placed':
        c.int('placed.side', c.at(e, 'side'), 0, nSides - 1); unit('unit'); c.int('placed.hex', c.at(e, 'hex'), 0, nHex - 1);
        break;
      case 'submitted':
        c.int('submitted.side', c.at(e, 'side'), 0, nSides - 1);
        break;
      case 'revealed': {
        const l = c.list('revealed.hexes', c.at(e, 'hexes'), nUnits, nUnits);
        l?.forEach((h, i) => c.int(`revealed.hexes[${i + 1}]`, h, 0, nHex - 1));
        break;
      }
      case 'phase_begun':
        c.int('phase_begun.turn', c.at(e, 'turn'), 1, this.scenario.turns);
        c.int('phase_begun.side', c.at(e, 'side'), 0, nSides - 1);
        c.oneOf('phase_begun.phase', c.at(e, 'phase'), this.sequence, 'phase');
        c.bool('phase_begun.fresh', c.at(e, 'fresh'));
        break;
      case 'declared':
        unit('unit'); unit('target');
        break;
      case 'held':
      case 'recovered':
        unit('unit');
        break;
      case 'moved':
        unit('unit'); hexList('path', 1); c.int('moved.cost', c.at(e, 'cost'), 1, 9999);
        break;
      case 'attack': {
        unit('target');
        const l = c.list('attack.attackers', c.at(e, 'attackers'), 1, nUnits);
        l?.forEach((a, i) => c.int(`attack.attackers[${i + 1}]`, a, 0, nUnits - 1));
        c.int('attack.attack', c.at(e, 'attack'), 0, 99999);
        c.int('attack.defense', c.at(e, 'defense'), 1, 99999);
        c.int('attack.column', c.at(e, 'column'), -1, this.data.fire.columns.length - 1);
        const dc = this.data.dice.count;
        const rolls = c.list('attack.rolls', c.at(e, 'rolls'), 0, dc);
        rolls?.forEach((r, i) => c.int(`attack.rolls[${i + 1}]`, r, 0, Number.MAX_SAFE_INTEGER));
        const faces = c.list('attack.dice', c.at(e, 'dice'), 0, dc);
        faces?.forEach((f, i) => c.int(`attack.dice[${i + 1}]`, f, 1, this.data.dice.faces));
        if (rolls && faces && rolls.length !== faces.length) c.add('attack', 'rolls and dice must be the same length');
        if (rolls && rolls.length !== 0 && rolls.length !== dc) c.add('attack.rolls', `must hold no roll or ${dc}`);
        c.oneOf('attack.result', c.at(e, 'result'), ATTACK_RESULTS, 'attack result');
        break;
      }
      case 'scored':
        c.int('scored.side', c.at(e, 'side'), 0, nSides - 1); c.int('scored.hex', c.at(e, 'hex'), 0, nHex - 1);
        c.int('scored.points', c.at(e, 'points'), 1, 9999);
        break;
      case 'ended':
        c.int('ended.winner', c.at(e, 'winner'), -1, nSides - 1);
        c.oneOf('ended.reason', c.at(e, 'reason'), END_REASONS, 'reason');
        break;
    }
    return c.problems;
  }

  // -------------------------------------------------------------------------
  // invariants
  // -------------------------------------------------------------------------

  invariants(s: RefState): string[] {
    const out: string[] = [];
    if (s.format !== 'reference/1') out.push(`format is ${JSON.stringify(s.format)}`);
    if (!s.map || s.map.id !== this.board.id || s.map.hash !== this.board.hash) out.push(`the state names map ${s.map?.id} ${s.map?.hash}, the board is ${this.board.id} ${this.board.hash}`);
    if (!['setup', 'play', 'over'].includes(s.stage)) out.push(`unknown stage ${JSON.stringify(s.stage)}`);
    if (!Number.isInteger(s.turn) || s.turn < 1 || s.turn > this.scenario.turns) out.push(`turn ${s.turn} is outside 1 to ${this.scenario.turns}`);
    if (!Number.isInteger(s.side) || s.side < 0 || s.side >= this.seats.length) out.push(`side ${s.side} is not a side`);
    if (s.stage === 'play' && !this.sequence.includes(s.phase)) out.push(`phase ${JSON.stringify(s.phase)} is not a phase of the sequence`);
    if (s.stage !== 'play' && s.phase !== '') out.push(`phase ${JSON.stringify(s.phase)} outside play`);
    if (!Number.isInteger(s.roll) || s.roll < 0) out.push(`negative or broken roll count ${s.roll}`);
    if ((s.stage === 'over') !== (s.result !== null)) out.push(s.stage === 'over' ? 'the game is over with no result' : 'a result is set but the game is not over');

    if (s.sides.length !== this.seats.length) out.push(`${s.sides.length} sides, the scenario has ${this.seats.length}`);
    s.sides.forEach((x, i) => {
      if (!Number.isInteger(x.losses) || x.losses < 0) out.push(`side ${i}: negative count of losses (${x.losses})`);
      if (!Number.isInteger(x.score) || x.score < 0) out.push(`side ${i}: negative score (${x.score})`);
      const roster = this.rosters[i];
      if (roster && x.placed.length > roster.length) out.push(`side ${i}: ${x.placed.length} placements for ${roster.length} units`);
      if (s.stage !== 'setup' && x.placed.length > 0) out.push(`side ${i}: set-up placements kept after set-up`);
    });

    if (s.units.length !== this.unitTypes.length) out.push(`${s.units.length} units, the scenario has ${this.unitTypes.length}`);
    const seenIds = new Set<number>();
    const perHex = new Map<HexId, number[]>();
    const destroyedPerSide = this.seats.map(() => 0);
    s.units.forEach((u, i) => {
      const at = `unit ${u.id} (index ${i})`;
      if (seenIds.has(u.id)) out.push(`two units with the id ${u.id}`);
      seenIds.add(u.id);
      if (u.id !== i) out.push(`${at}: its id is not its index`);
      const t = this.types.get(u.type);
      if (!t) out.push(`${at}: unknown unit type '${u.type}'`);
      if (!Number.isInteger(u.side) || u.side < 0 || u.side >= this.seats.length) out.push(`${at}: side ${u.side} is not a side`);
      else if (this.sideOfUnit(i) !== u.side) out.push(`${at}: on side ${u.side}, the scenario puts it on side ${this.sideOfUnit(i)}`);
      if (!Number.isInteger(u.hex) || u.hex < -1 || u.hex >= this.board.n) out.push(`${at}: off the board at hex ${u.hex}`);
      if (u.destroyed) {
        if (u.side >= 0 && u.side < destroyedPerSide.length) destroyedPerSide[u.side] = (destroyedPerSide[u.side] as number) + 1;
        if (u.hex !== -1) out.push(`${at}: destroyed but still on the board at hex ${u.hex}`);
        if (u.suppressed) out.push(`${at}: destroyed and suppressed`);
      } else if (s.stage !== 'setup' && u.hex < 0) {
        out.push(`${at}: alive but not on the board`);
      }
      if (s.stage === 'setup' && u.hex !== -1) out.push(`${at}: on the board before the reveal`);
      if (!u.destroyed && u.hex >= 0 && u.hex < this.board.n) {
        if (t && (this.standable[t.mover] as Uint8Array)[u.hex] !== 1) out.push(`${at}: stands in hex ${u.hex}, where a ${u.type} cannot be`);
        const list = perHex.get(u.hex) ?? [];
        list.push(i);
        perHex.set(u.hex, list);
      }
      if (u.target !== -1) {
        const tg = s.units[u.target];
        if (s.stage !== 'play' || s.phase !== 'gunnery' || u.side !== s.side) out.push(`${at}: a declared target outside its own gunnery phase`);
        else if (!tg || tg.destroyed || tg.hex < 0 || tg.side === u.side) out.push(`${at}: declared on unit ${u.target}, which is not an enemy unit on the board`);
        if (!u.spent) out.push(`${at}: declared fire but is not spent`);
      }
    });
    for (const [h, ids] of perHex) {
      const sides = new Set(ids.map(i => (s.units[i] as UnitState).side));
      if (sides.size > 1) out.push(`hex ${h} holds units of both sides`);
      for (const side of sides) {
        const n = ids.filter(i => (s.units[i] as UnitState).side === side).length;
        const limit = this.stacking[side];
        if (limit !== undefined && n > limit) out.push(`hex ${h}: ${n} units of side ${side}, over the stacking limit of ${limit}`);
      }
    }
    destroyedPerSide.forEach((n, i) => {
      const x = s.sides[i];
      if (x && x.losses !== n) out.push(`side ${i}: ${x.losses} losses counted, ${n} units destroyed`);
    });
    return out;
  }
}

/** A copy of an event that shares no object with it. */
function copyEvent(e: RefEvent): RefEvent {
  switch (e.type) {
    case 'revealed':
      return { type: e.type, hexes: e.hexes.slice() };
    case 'moved':
      return { type: e.type, unit: e.unit, path: e.path.slice(), cost: e.cost };
    case 'attack':
      return {
        type: e.type, target: e.target, attackers: e.attackers.slice(), attack: e.attack, defense: e.defense, column: e.column,
        rolls: e.rolls.slice(), dice: e.dice.slice(), result: e.result,
      };
    default:
      // Every other event holds numbers, strings and booleans only.
      return { ...e };
  }
}

/** The result of a dice sum in a column. */
export function resultOf(col: FireColumn, sum: number): AttackResult {
  if (col.destroy !== null && sum >= col.destroy) return 'destroyed';
  if (col.suppress !== null && sum >= col.suppress) return 'suppressed';
  return 'none';
}

function draftOf(s: RefState): Draft {
  return {
    format: s.format,
    map: s.map,
    stage: s.stage,
    turn: s.turn,
    side: s.side,
    phase: s.phase,
    roll: s.roll,
    units: s.units.slice(),
    sides: s.sides.slice(),
    result: s.result,
  };
}

/** Make the reference ruleset for one match's content. */
export function createReferenceRuleset(content: ReferenceContent, board?: CompiledBoard): ReferenceRuleset {
  return new ReferenceRuleset(content, board);
}
