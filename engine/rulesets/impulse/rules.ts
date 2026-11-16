/**
 * Formation Impulse (docs/rules/rules-v1.md, revision 2) on the kernel's
 * Ruleset interface. Every number comes from the rules data, the unit file
 * and the scenario; the code knows no side, nation or unit by name.
 *
 * How it is built. `apply` checks the action (validate), then resolves it on
 * a copy of the state (execute) by emitting events, each of which is reduced
 * onto the copy as it is emitted; `reduce` replays recorded events with the
 * same reducer, so a game rebuilt from its events is the game that was
 * played. Every attack is resolved by table.resolveAttack with a Roller: the
 * match's dice in `apply`, or a walk over every way the dice can fall in
 * `outcomes` and `branches` (ruling 16), so the exact distribution and the
 * resolution are one code. The checks and the reaction plan of a move, a
 * dismount or an overrun are made once, in `validate`, from the state or
 * from a view (after the start a view holds everything); the plans of a close
 * assault's paths are made one at a time as each path's turn comes (12.2), by
 * the same `plan`.
 *
 * Where a unit is. A unit is on the board (a hex), carried by a transport of
 * its own side (no hex: 14.4), or destroyed. `alive` means not destroyed;
 * `onBoard` means it stands in a hex. A carried unit is where its transport is
 * for command (3.3) and nothing else.
 */
import { CompiledBoard, boardMismatch, compileBoard, mapHash, terrainHash } from '../../core/board';
import { contentHash } from '../../core/canonical';
import { distance, labelOf } from '../../core/hex';
import { gridOf, hexOf, MapDescription } from '../../core/map';
import { FloodResult, newFloodResult, PathSearch, routeTo } from '../../core/path';
import { sha256Text } from '../../core/sha256';
import { Checker } from '../../kernel/check';
import {
  Applied, ContentRef, Decision, Dice, KERNEL_REJECTION_CODES, MatchResult, Outcome, Rejection, Ruleset, Seat,
} from '../../kernel/ruleset';
import { NONE, RulesData, terrainOf } from './data';
import { ExposureSearch } from './paths';
import { enterableHexes, ScenarioData, zoneHexes } from './scenario';
import { SeenCache } from './seen';
import { BranchRoller, DiceRoller, FireTable, normalise, Resolved, resolveAttack, Roller } from './table';
import {
  ACTION_KEYS, ACTION_TYPES, ActionType, ActivationState, AssaultUnit, Attack, Branch, DISCIPLINES, Discipline, Effect, EFFECTS,
  END_REASONS, EndReason, EVENT_TYPES, ImpulseAction, ImpulseEvent, ImpulseState, ImpulseView, MISSION_KINDS, MissionKind,
  OutcomeQuery, PlannedShot, Position, ReactionPlan, UnitState,
} from './types';
import type { UnitFile, UnitType } from './units';

// ---------------------------------------------------------------------------
// rejection codes
// ---------------------------------------------------------------------------

export const IMPULSE_REJECTION_CODES = [
  ...KERNEL_REJECTION_CODES,
  'wrong_stage',          // a deployment action after the start, or a play action during the deployment
  'wrong_profile',        // activateSide under `sequence.activation: formation`, activate under `side`
  'activation_open',      // activate, activateUnit, activateSide or pass while an activation is open
  'not_activated',        // the unit is not of the open activation, or no activation is open
  'formation_used',       // the formation has been activated this turn
  'no_unit_can_act',      // activate (activateSide) with no unit that could act; activateUnit of a unit that could not (5.5, 5.9)
  'unit_in_command',      // activateUnit on a unit that is in command
  'out_of_command',       // the unit is out of command for this activation
  'unknown_unit',         // no unit has that index
  'unknown_formation',    // no formation has that index
  'not_your_unit',        // the unit belongs to the other side
  'not_your_formation',   // the formation belongs to the other side
  'not_on_board',         // the unit has been destroyed
  'spent',                // the unit is Spent
  'moved',                // the unit is Moved (6.8): it may fire once (armour), close assault (12.1, assault.afterMove) or move on (6.9), and do nothing else
  'suppressed',           // the unit is Suppressed
  'carried',              // the unit is carried and the action is not dismount (14.4); a placement of a unit that starts carried (4.1)
  'target_carried',       // fire or a close assault at a unit that is carried (7.9, 14.4)
  'not_carried',          // dismount by a unit that is not carried (14.5)
  'cannot_ride',          // mount by a unit whose type has rides: false (14.1)
  'cannot_carry',         // mount on a unit whose type has carries: 0 (14.1)
  'enemy_transport',      // mount on a transport of the other side (14.1)
  'transport_full',       // mount on a transport that already carries a unit (14.1, 14.2)
  'transport_suppressed', // mount on a Suppressed transport (14.2)
  'transport_far',        // mount on a transport neither in the unit's hex nor beside it (14.2)
  'dismount_far',         // dismount into a hex neither the transport's nor beside it (14.5)
  'bad_target',           // the target is not an enemy unit in play, or a mount names a destroyed unit
  'no_firepower',         // a firer without firepower against the target's class
  'no_sight',             // a firer without a sight line to the target
  'out_of_range',         // the target beyond one and a half times the firer's range
  'concealed',            // the target may not be fired at (9.3)
  'not_within_support',   // a firer's, or an assaulting unit's, own column more than support.within below the best (7.4, 12.1)
  'cannot_suppress',      // a fire's or an assault's column cannot suppress on any roll; an overrun none of whose attacks can (7.6, 12.1, 12.8)
  'battery',              // a battery fires directly, or a unit that is not a battery calls a mission
  'off_board',            // a hex that is not on the board; an overrun's exit hex off the board (12.8)
  'not_adjacent',         // two consecutive hexes of a path are not neighbours
  'revisit',              // a path (an overrun's whole movement) that enters a hex twice, or the hex it started from (6.7, 12.8)
  'enemy_hex',            // a path, an overrun's exit hex or a dismount's hex that holds an enemy unit (6.3, 12.8, 14.5; 14.7 aside)
  'impassable',           // a step the unit's mover type cannot make; a placement or a start in a hex it may not enter (4.1)
  'over_allowance',       // a path, or an overrun's whole movement with overrun.cost, costs more than the allowance (6.1, 12.8)
  'over_remaining',       // a Moved unit's further move, or its close assault's path, costs more than what is left of its allowance (6.9)
  'stacking',             // a move, placement, dismount or overrun exit that would leave a hex over stack.limit
  'assault_too_far',      // an assault path that costs more than its share of the allowance (12.1)
  'not_beside',           // an assault path that does not end beside the target; an overrun path not beside the target hex
  'cannot_assault',       // a close assault by a unit whose type has assaults: false (12.1)
  'not_assaulting',       // a close assault names to advance a unit that is not one of its units (12.1)
  'assault_target_soft',  // a close assault on a Soft unit while assault.targets is hard: a close assault is made on armour (12.1)
  'cannot_overrun',       // an overrun by a unit whose type has overruns: false (12.7)
  'overrun_ground',       // an overrun's target hex has ground whose cover.<type>.overrun is false (12.8)
  'overrun_hard',         // an overrun's target hex holds an enemy Hard unit (12.8)
  'overrun_no_target',    // an overrun's target hex holds no enemy Soft unit, empty transports without firepower not counted (12.8, 14.7)
  'mission_range',        // a mission hex beyond the battery's range or nearer than its minRange
  'mission_unobserved',   // no friendly combat unit that is not Suppressed has a sight line to the hex
  'mission_waiting',      // the battery has a mission waiting (13.1)
  'must_land',            // any action but land while the side has a mission due (5.4)
  'no_mission_due',       // land when the side has no mission due
  'placement_zone',       // a placement outside the side's zone
  'placement_incomplete', // submit with a unit not yet placed
  'already_placed',       // place of a unit already placed (unplace it first)
  'not_placed',           // unplace of a unit not placed
] as const;

export type ImpulseRejectionCode = (typeof IMPULSE_REJECTION_CODES)[number];

function reject(code: ImpulseRejectionCode, detail: string): Rejection {
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

// ---------------------------------------------------------------------------
// static content, compiled
// ---------------------------------------------------------------------------

/** A unit of the scenario, compiled. */
export interface UnitInfo {
  readonly index: number;
  readonly id: string;
  readonly side: number;
  readonly formation: number;
  /** The unit's place in its side's units (free deployment keeps placements in this order). */
  readonly place: number;
  readonly type: UnitType;
  readonly mover: number;
  /** The mover index a dismount's step is judged by (14.5: a `towed` unit counts as `foot`). */
  readonly dismountMover: number;
  /** The set-up hex, or -1 for a unit that starts carried. */
  readonly setupHex: number;
  /** The transport that carries the unit at the start (4.1), or -1. */
  readonly setupCarrier: number;
  /** A combat unit, one with firepower ("How to read it"). */
  readonly combat: boolean;
  readonly battery: boolean;
  /** A transport: its type carries (14.1). */
  readonly transport: boolean;
}

export interface FormationInfo {
  readonly index: number;
  readonly id: string;
  readonly side: number;
  readonly units: readonly number[];
  readonly discipline: Discipline;
}

/** What a match's ruleset is built from (load.ts makes it from the four texts; the cases' tests directly). */
export interface ImpulseSetup {
  readonly rules: RulesData;
  readonly units: UnitFile;
  readonly scenario: ScenarioData;
  readonly map: MapDescription;
  /** A board already compiled from the same map and terrain data (checked; refused otherwise). */
  readonly board?: CompiledBoard;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
interface Draft extends Mutable<Omit<ImpulseState, 'units' | 'formations' | 'sides' | 'missions' | 'smoke' | 'holders'>> {
  units: UnitState[];
  formations: { units: number[]; discipline: Discipline; leaderLosses: number; commandRange: number | null; activated: boolean }[];
  sides: { orders: number; score: number; lost: number; lostThisTurn: number[]; startCost: number; passed: boolean }[];
  missions: { battery: number; hex: number; kind: MissionKind; due: boolean }[];
  smoke: number[];
  holders: number[];
}

/** An action checked, with what its resolution needs. */
interface Checked {
  readonly side: number;
  readonly action: ImpulseAction;
  /** move, dismount, overrun: the reaction plan. */
  readonly plan?: Plan;
  /** fire: the column of the attack. */
  readonly column?: number;
}

interface Plan {
  readonly unit: number;
  /** The hex it sets out from, or -1 for a dismount (the unit was not on the board). */
  readonly start: number;
  /** The hexes entered: a path; for an overrun, its path, the target hex and the exit hex. */
  readonly path: readonly number[];
  /** Per step: entering it reveals the mover (6.6). */
  readonly reveals: readonly boolean[];
  readonly revealedAtStart: boolean;
  readonly shots: readonly PlannedShot[];
  /** Per step: the cost of the path up to and including it. */
  readonly costs: readonly number[];
  /** The steps walked as a move (6.5): the whole path, or an overrun's path before its target hex. */
  readonly walked: number;
}

interface PlanOptions {
  /** The hex the mover sets out from (default: its hex); -1 for a dismount. */
  readonly start?: number;
  /** A dismount: the step costs nothing (14.5). */
  readonly free?: boolean;
  /** An overrun: the target hex's step, never fired at (12.10), from which on the mover is Revealed (12.11). */
  readonly targetStep?: number;
}

/** A reaction shot fired, before its events. */
interface Fired {
  readonly reactor: number;
  readonly hex: number;
  readonly column: number;
  readonly res: Resolved;
}

/** A path walked under reaction fire, decided before any event is emitted. */
interface Walk {
  readonly fired: Fired[];
  /** The step at which the mover was stopped or destroyed, or -1. */
  readonly stopStep: number;
  /** Where it stands after a stop (8.6), or -1. */
  readonly stopHex: number;
  readonly destroyed: boolean;
  /** Shots planned at or beyond the walked steps (an overrun's exit hex), not yet fired because no stop came. */
  readonly deferred: PlannedShot[];
}

/** A passenger to set down when the attack, mission or overrun that destroyed its transport is over (14.6). */
interface SetDown {
  readonly unit: number;
  /** Where, in order of preference: where the transport was destroyed, then back along the hexes it passed (14.6). */
  readonly hexes: readonly number[];
}

type Emit = (e: ImpulseEvent) => void;

/** The kernel's interface, with the state, view, action, event and outcome-query types of this ruleset. */
export type ImpulseRulesetType = Ruleset<ImpulseState, ImpulseAction, ImpulseEvent, ImpulseView, OutcomeQuery>;

export class ImpulseRuleset implements ImpulseRulesetType {
  readonly id: string;
  readonly version = '2';
  readonly content: ContentRef;
  readonly seats: readonly Seat[];
  readonly rejectionCodes: readonly string[] = IMPULSE_REJECTION_CODES;
  readonly eventTypes: readonly string[] = EVENT_TYPES;

  readonly rules: RulesData;
  readonly scenario: ScenarioData;
  readonly board: CompiledBoard;
  readonly table: FireTable;
  readonly unitInfo: readonly UnitInfo[];
  readonly formationInfo: readonly FormationInfo[];
  /** Per side: its units, in index order. */
  readonly sideUnits: readonly (readonly number[])[];
  /** Per side: its formations, in index order. */
  readonly sideFormations: readonly (readonly number[])[];
  /** Per side: 1 for each hex of its deployment zone. */
  readonly zones: readonly Uint8Array[];
  readonly ordersPerTurn: readonly number[];
  readonly objectives: readonly { readonly hex: number; readonly points: number }[];
  readonly lastTurn: number;
  readonly sideProfile: boolean;
  /** 5.10 (ruling 84, `ready.when: own-turn`): a side's units are made Ready when its own turn begins, not at the end phase. */
  readonly ownTurnReady: boolean;
  readonly killShare: readonly [number, number];
  readonly breakShare: number;
  readonly suddenDeathLead: number;
  readonly coverFire: Int32Array;
  readonly coverClose: Int32Array;
  readonly conceals: Uint8Array;
  /** 1 where the hex's ground may be overrun (cover.<type>.overrun, 12.8). */
  readonly overrunGround: Uint8Array;
  /** Per mover index: 1 where a unit of that mover type may stand: some step into the hex is open to it on the board (4.1; scenario.ts enterableHexes). */
  readonly enterable: readonly Uint8Array[];
  private readonly seen: SeenCache;
  private readonly search: PathSearch;
  private readonly exposure: ExposureSearch;
  private readonly flood = { result: newFloodResult(0) };
  /** The second pair of searches (approachesAvoiding): a unit's floods made again with some hexes closed; `of` and `key` say for what. */
  private readonly exposureAlt: ExposureSearch;
  private readonly floodAlt: { result: FloodResult; of: PathFacts | null; key: string; facts: PathFacts | null } = { result: newFloodResult(0), of: null, key: '', facts: null };

  constructor(setup: ImpulseSetup) {
    const { rules, units, scenario, map } = setup;
    this.rules = rules;
    this.scenario = scenario;
    this.id = rules.id;
    this.content = { id: rules.id, hash: contentHash({ rules, units }) };
    const terrain = terrainOf(rules);
    if (setup.board) {
      // The board is held to the map given, by the map's content hash (ruling 18; the loader has held that map to the scenario's pin):
      // a board compiled from another map, the same id included, is refused naming both hashes.
      const mismatch = boardMismatch(setup.board, { mapId: map.id, mapHash: mapHash(map), terrainHash: terrainHash(terrain) });
      if (mismatch !== null) throw new Error(`impulse ruleset: refused ${mismatch}`);
    }
    this.board = setup.board ?? compileBoard(map, terrain);
    this.seats = scenario.sides.map(s => s.id);
    this.sideProfile = rules.sequence.activation === 'side';
    this.ownTurnReady = rules.ready.when === 'own-turn';
    const types = new Map(units.types.map(t => [t.id, t]));
    const moverIndex = (m: string): number => {
      const i = this.board.moverIndex(m);
      if (i < 0) throw new Error(`impulse ruleset: mover type '${m}' is not in the rules data`);
      return i;
    };
    // 14.5: for a dismount's step a `towed` unit counts as `foot` (the spec's own mover type names, 2.1).
    const footIndex = this.board.moverIndex('foot');

    const unitInfo: UnitInfo[] = [];
    const formationInfo: FormationInfo[] = [];
    const sideUnits: number[][] = [];
    const sideFormations: number[][] = [];
    const carrierIds: (string | null)[] = [];
    scenario.sides.forEach((side, si) => {
      const su: number[] = [];
      const sf: number[] = [];
      for (const f of side.formations) {
        const fi = formationInfo.length;
        const list: number[] = [];
        for (const u of f.units) {
          const t = types.get(u.type);
          if (!t) throw new Error(`impulse ruleset: unit ${u.id} has the unknown type '${u.type}'`);
          let hex = -1;
          if (u.hex !== undefined) {
            hex = hexOf(map, u.hex);
            if (hex < 0) throw new Error(`impulse ruleset: unit ${u.id} stands off the board at ${u.hex}`);
          } else if (u.carriedBy === undefined) {
            throw new Error(`impulse ruleset: unit ${u.id} has neither a hex nor a transport`);
          }
          const index = unitInfo.length;
          const mover = moverIndex(t.mover);
          unitInfo.push({
            index, id: u.id, side: si, formation: fi, place: su.length, type: t, mover,
            dismountMover: t.mover === 'towed' && footIndex >= 0 ? footIndex : mover, setupHex: hex, setupCarrier: -1,
            combat: t.ap > 0 || t.he > 0, battery: t.indirect !== undefined, transport: t.carries > 0,
          });
          carrierIds.push(u.carriedBy ?? null);
          list.push(index);
          su.push(index);
        }
        formationInfo.push({ index: fi, id: f.id, side: si, units: list, discipline: f.discipline });
        sf.push(fi);
      }
      sideUnits.push(su);
      sideFormations.push(sf);
    });
    carrierIds.forEach((cid, i) => {
      if (cid === null) return;
      const t = unitInfo.findIndex(x => x.id === cid);
      const u = unitInfo[i] as UnitInfo;
      if (t < 0 || t === i) throw new Error(`impulse ruleset: unit ${u.id} names ${cid} as its transport, which is not another unit`);
      unitInfo[i] = { ...u, setupCarrier: t };
    });
    this.unitInfo = unitInfo;
    this.formationInfo = formationInfo;
    this.sideUnits = sideUnits;
    this.sideFormations = sideFormations;
    this.zones = scenario.sides.map(s => {
      const z = new Uint8Array(this.board.n);
      for (const h of zoneHexes(map, s.zone)) z[h] = 1;
      return z;
    });
    this.ordersPerTurn = scenario.sides.map(s => (this.sideProfile ? 1 : s.orders));
    this.objectives = scenario.objectives.map(o => ({ hex: hexOf(map, o.hex), points: o.points }));
    this.lastTurn = scenario.ending.turns;
    this.killShare = scenario.ending.killShare ?? rules.score.killShare;
    this.breakShare = scenario.ending.breakShare ?? rules.break.share;
    this.suddenDeathLead = scenario.ending.suddenDeathLead ?? rules.suddenDeath.lead;
    const n = this.board.n;
    this.coverFire = new Int32Array(n);
    this.coverClose = new Int32Array(n);
    this.conceals = new Uint8Array(n);
    this.overrunGround = new Uint8Array(n);
    for (let h = 0; h < n; h++) {
      const c = rules.cover[this.board.coverOf(h)];
      this.coverFire[h] = c.fire;
      this.coverClose[h] = c.close;
      this.conceals[h] = c.conceals ? 1 : 0;
      this.overrunGround[h] = c.overrun ? 1 : 0;
    }
    // 4.1: a hex into which some step from a hex beside it is open to the mover type (rivers and roads count, not cover alone).
    this.enterable = rules.moverTypes.map(m => enterableHexes(this.board, this.board.moverTypes.indexOf(m)));
    const ft = rules.fireTable;
    this.table = new FireTable({ count: ft.dice.count, faces: ft.dice.faces, suppress: ft.suppress, destroy: ft.destroy });
    this.seen = new SeenCache(this.board);
    this.search = new PathSearch(this.board);
    this.exposure = new ExposureSearch(this.board);
    this.flood.result = newFloodResult(n);
    this.exposureAlt = new ExposureSearch(this.board);
    this.floodAlt.result = newFloodResult(n);
  }

  // -------------------------------------------------------------------------
  // the state
  // -------------------------------------------------------------------------

  initial(): ImpulseState {
    const free = this.scenario.freeDeployment;
    const first = this.seats.indexOf(this.scenario.initiative);
    const range = this.rules.command.range;
    return {
      format: 'impulse/1',
      stage: free ? 'deploy' : 'play',
      turn: 1,
      initiative: first,
      firstInitiative: first,
      impulse: first,
      roll: 0,
      bought: false,
      activation: null,
      units: this.unitInfo.map(u => ({
        hex: free ? -1 : u.setupHex, destroyed: false, spent: false, moved: false, moveUsed: 0, suppressed: false, carriedBy: u.setupCarrier, revealed: 0,
      })),
      formations: this.formationInfo.map(f => ({
        units: f.units.slice(), discipline: f.discipline, leaderLosses: 0, commandRange: range === NONE ? null : range, activated: false,
      })),
      sides: this.seats.map((_, si) => ({
        orders: this.ordersPerTurn[si] as number, score: 0, lost: 0, lostThisTurn: [],
        startCost: (this.sideUnits[si] as number[]).reduce((a, u) => a + (this.unitInfo[u] as UnitInfo).type.cost, 0), passed: false,
      })),
      missions: [],
      smoke: [],
      holders: this.scenario.objectives.map(o => (o.holder === 'none' ? -1 : this.seats.indexOf(o.holder))),
      deployment: free ? { placed: this.sideUnits.map(l => l.map(() => -1)), finished: this.seats.map(() => false) } : null,
      result: null,
    };
  }

  pending(s: ImpulseState): Decision {
    return this.decidingIn(s);
  }

  private decidingIn(p: Position): Decision {
    if (p.stage === 'over') return { kind: 'over' };
    if (p.stage === 'deploy') {
      const fin = p.deployment?.finished ?? [];
      return { kind: 'decide', seats: this.seats.filter((_, i) => fin[i] === false) };
    }
    return { kind: 'decide', seats: [this.seats[p.impulse] as Seat] };
  }

  result(s: ImpulseState): MatchResult | null {
    if (!s.result) return null;
    return { winner: this.seats[s.result.winner] ?? null, reason: s.result.reason };
  }

  turn(s: ImpulseState): number {
    return s.turn;
  }

  copy(s: ImpulseState): ImpulseState {
    return { ...copyPosition(s), format: 'impulse/1' };
  }

  /** SHA-256 of a text that writes down every field of the state (serialise). */
  hash(s: ImpulseState): string {
    return sha256Text(serialise(s));
  }

  // -------------------------------------------------------------------------
  // views and events for viewers
  // -------------------------------------------------------------------------

  /**
   * What a seat (or a spectator) sees: everything, after the start (4.3,
   * 9.2). During a free deployment, only the seat's own placements and
   * whether it has finished; nothing of the other side's (4.2). New data.
   */
  view(s: ImpulseState, viewer: Seat | null): ImpulseView {
    const vi = viewer === null ? -1 : this.seats.indexOf(viewer);
    if (viewer !== null && vi < 0) throw new Error(`view: '${viewer}' is not a seat of this match`);
    const p = copyPosition(s);
    const dep = p.deployment;
    if (dep) {
      dep.placed = dep.placed.map((x, i) => (i === vi ? x : null));
      dep.finished = dep.finished.map((x, i) => (i === vi ? x : null));
    }
    return { ...p, format: 'impulse-view/1', viewer };
  }

  /** A view's state: after the start a view holds everything, so this is the state it was made from. */
  stateOfView(v: ImpulseView): ImpulseState {
    if (v.stage === 'deploy') throw new Error('a view of a free deployment does not hold the other side\'s placements');
    return { ...copyPosition(v), format: 'impulse/1' };
  }

  /** A deployment placement or finish is seen by its own side only (4.2); everything else by everyone, whole. */
  eventFor(e: ImpulseEvent, viewer: Seat | null): ImpulseEvent | null {
    if (e.type === 'placed' || e.type === 'submitted') {
      const vi = viewer === null ? -1 : this.seats.indexOf(viewer);
      if (vi !== e.side) return null;
    }
    return copyEvent(e);
  }

  // -------------------------------------------------------------------------
  // position helpers (they read a state or a view)
  // -------------------------------------------------------------------------

  private u(i: number): UnitInfo {
    return this.unitInfo[i] as UnitInfo;
  }

  /** In play: not destroyed (on the board or carried). */
  private alive(p: Position, i: number): boolean {
    return !(p.units[i] as UnitState).destroyed;
  }

  /** Standing in a hex of the board. */
  private onBoard(p: Position, i: number): boolean {
    const u = p.units[i] as UnitState;
    return !u.destroyed && u.hex >= 0;
  }

  private isCarried(p: Position, i: number): boolean {
    const u = p.units[i] as UnitState;
    return !u.destroyed && u.carriedBy >= 0;
  }

  /** Where a unit is for command (3.3): its hex, or its transport's (14.4). */
  whereIs(p: Position, i: number): number {
    const u = p.units[i] as UnitState;
    if (u.carriedBy >= 0) return (p.units[u.carriedBy] as UnitState).hex;
    return u.hex;
  }

  /** The unit a transport carries, or -1. */
  passengerOf(p: Position, t: number): number {
    if (!this.u(t).transport) return -1;
    for (let i = 0; i < p.units.length; i++) {
      const u = p.units[i] as UnitState;
      if (u.carriedBy === t && !u.destroyed) return i;
    }
    return -1;
  }

  /** 14.7: a transport without firepower that carries nothing, on the board. */
  private emptyTruck(p: Position, i: number): boolean {
    const info = this.u(i);
    return info.transport && !info.combat && this.onBoard(p, i) && this.passengerOf(p, i) < 0;
  }

  /** 8.2, 14.7: does anything react to this mover at all? Not to one with no firepower that carries nothing. */
  private drawsFire(p: Position, mover: number): boolean {
    return this.u(mover).combat || this.passengerOf(p, mover) >= 0;
  }

  /** The first surviving unit of a formation (3.2), or -1. A carried unit survives. */
  leaderOf(p: Position, f: number): number {
    for (const i of (this.formationInfo[f] as FormationInfo).units) if (this.alive(p, i)) return i;
    return -1;
  }

  private classOf(i: number): 'hard' | 'soft' {
    return this.u(i).type.class;
  }

  private firepower(i: number, cls: 'hard' | 'soft'): number {
    const t = this.u(i).type;
    return cls === 'hard' ? t.ap : t.he;
  }

  private missionOf(p: Position, i: number): number {
    for (let k = 0; k < p.missions.length; k++) if ((p.missions[k] as { battery: number }).battery === i) return k;
    return -1;
  }

  /** The command range of a formation now, or Infinity for none. */
  private rangeOf(p: Position, f: number): number {
    const r = (p.formations[f] as { commandRange: number | null }).commandRange;
    return r === null ? Infinity : r;
  }

  /** In command now (3.3): the leader, or within the formation's command range of it; always in the whole-side profile. */
  inCommandNow(p: Position, i: number): boolean {
    if (this.sideProfile) return true;
    const f = this.u(i).formation;
    const range = this.rangeOf(p, f);
    if (range === Infinity) return true;
    const leader = this.leaderOf(p, f);
    if (leader === i) return true;
    if (leader < 0) return false;
    return distance(this.board.grid, this.whereIs(p, i), this.whereIs(p, leader)) <= range;
  }

  /**
   * Ready or Moved, not Suppressed, in play (on the board or carried) and not a battery with a mission waiting (5.5, 13.1): a
   * unit that could act. A Moved unit is not Spent: it may still fire once (6.8), and nothing else.
   */
  private ready(p: Position, i: number): boolean {
    const u = p.units[i] as UnitState;
    if (u.destroyed || u.spent || u.suppressed) return false;
    if (u.hex < 0 && u.carriedBy < 0) return false;
    return !(this.u(i).battery && this.missionOf(p, i) >= 0);
  }

  /** A unit that could act in the open activation (5.7). */
  private couldAct(p: Position, a: ActivationState, i: number): boolean {
    return a.inCommand.includes(i) && this.ready(p, i);
  }

  private anyCanAct(p: Position, a: ActivationState): boolean {
    for (const i of a.inCommand) if (this.ready(p, i)) return true;
    return false;
  }

  /** Units of a formation that could act if it were activated now (5.5). */
  private formationCanAct(p: Position, f: number): boolean {
    for (const i of (this.formationInfo[f] as FormationInfo).units) if (this.ready(p, i) && this.inCommandNow(p, i)) return true;
    return false;
  }

  private sideCanAct(p: Position, side: number): boolean {
    for (const i of this.sideUnits[side] as number[]) if (this.ready(p, i)) return true;
    return false;
  }

  private dueOf(p: Position, side: number): boolean {
    for (const m of p.missions) if (m.due && this.u(m.battery).side === side) return true;
    return false;
  }

  /** Units of a side standing in a hex (other than `except`); a carried unit stands in none (11.1, 14.4). */
  private countAt(p: Position, side: number, hex: number, except: number): number {
    let n = 0;
    for (const i of this.sideUnits[side] as number[]) if (i !== except && (p.units[i] as UnitState).hex === hex && !(p.units[i] as UnitState).destroyed) n++;
    return n;
  }

  /** Does the hex hold an enemy unit of `side` for a unit's movement (6.3)? For a combat unit, empty transports without firepower do not count (14.7). */
  private enemyAt(p: Position, side: number, hex: number, combat: boolean): boolean {
    for (const i of this.sideUnits[1 - side] as number[]) {
      const u = p.units[i] as UnitState;
      if (u.hex !== hex || u.destroyed) continue;
      if (combat && this.emptyTruck(p, i)) continue;
      return true;
    }
    return false;
  }

  /** The enemy empty transports without firepower in a hex (14.7), in unit order. */
  private emptyTrucksAt(p: Position, side: number, hex: number): number[] {
    const out: number[] = [];
    for (const i of this.sideUnits[1 - side] as number[]) if ((p.units[i] as UnitState).hex === hex && this.emptyTruck(p, i)) out.push(i);
    return out;
  }

  /** Sight between two hexes with the smoke of the position (13.6): the board's, through seesPast where smoke lies between. */
  sees(p: Position, a: number, b: number): boolean {
    if (!this.board.sees(a, b)) return false;
    if (p.smoke.length === 0) return true;
    const g = this.board.grid;
    const dab = distance(g, a, b);
    let between = false;
    for (const s of p.smoke) {
      if (s !== a && s !== b && distance(g, a, s) + distance(g, s, b) === dab) {
        between = true;
        break;
      }
    }
    if (!between) return true;
    return this.board.seesPast(a, b, h => p.smoke.includes(h));
  }

  /** A unit that spots, reveals and observes (9.5, 14.4, 10.1): a combat unit on the board, not Suppressed. */
  private watcher(p: Position, i: number): boolean {
    const u = p.units[i] as UnitState;
    return this.u(i).combat && !u.destroyed && u.hex >= 0 && !u.suppressed;
  }

  /** 9.3: may a unit of `side` (Revealed or not) be fired at in a hex? */
  mayBeFiredAt(p: Position, side: number, hex: number, revealed: boolean): boolean {
    if (this.conceals[hex] !== 1 || revealed) return true;
    const g = this.board.grid;
    const reach = this.rules.spot.distance;
    for (const e of this.sideUnits[1 - side] as number[]) {
      if (!this.watcher(p, e)) continue;
      const eh = (p.units[e] as UnitState).hex;
      if (distance(g, eh, hex) <= reach && this.sees(p, eh, hex)) return true;
    }
    return false;
  }

  /** 6.6: does entering a hex reveal a unit of `side`? */
  private revealsAt(p: Position, side: number, hex: number): boolean {
    if (this.conceals[hex] === 1) return false;
    for (const e of this.sideUnits[1 - side] as number[]) {
      if (this.watcher(p, e) && this.sees(p, (p.units[e] as UnitState).hex, hex)) return true;
    }
    return false;
  }

  /** The range step (7.3) at distance d for range r, or null beyond one and a half times r. */
  rangeStep(d: number, r: number): number | null {
    const rs = this.rules.rangeSteps;
    if (d <= 1) return rs.adjacent;
    if (d <= Math.ceil(r / 2)) return rs.half;
    if (d <= r) return rs.full;
    if (d <= Math.floor(rs.longFactor * r)) return rs.long;
    return null;
  }

  private longRange(r: number): number {
    return Math.floor(this.rules.rangeSteps.longFactor * r);
  }

  /** A firer's own column (7.2) against a target standing in `hex`, or null out of range. A Moved firer's takes `moveFire.steps` (6.8). */
  ownColumn(p: Position, firer: number, target: number, hex: number): number | null {
    const f = p.units[firer] as UnitState;
    const d = distance(this.board.grid, f.hex, hex);
    const step = this.rangeStep(d, this.u(firer).type.range);
    if (step === null) return null;
    return this.firepower(firer, this.classOf(target)) - this.u(target).type.defense - (this.coverFire[hex] as number) + step
      + (f.moved ? this.rules.moveFire.steps : 0);
  }

  /**
   * 6.8: the most a move of a unit may cost and leave it Moved, not Spent: `moveFire.moveShare` of its allowance, rounded
   * down; null when its class is not `moveFire.class` (no move leaves it Moved).
   */
  shortMove(unit: number): number | null {
    const mf = this.rules.moveFire;
    if (mf.class === 'none' || this.classOf(unit) !== mf.class) return null;
    return Math.floor(this.u(unit).type.move * mf.moveShare);
  }

  /** 12.1, `assault.afterMove`: may a move with movement over leave this unit Moved, able to make one close assault? */
  assaultsAfterMove(unit: number): boolean {
    return this.rules.assault.afterMove && this.u(unit).type.assaults;
  }

  /**
   * 6.8: does a move of 5.7 that costs `cost`, made by a unit that is not Moved and that no reaction fire stops, leave it
   * Moved? A unit of `moveFire.class` after a short move (no more than `shortMove`), and a unit that can close assault
   * (`assault.afterMove`) after a move that leaves any of its allowance unused.
   */
  private leavesMoved(unit: number, cost: number): boolean {
    const most = this.shortMove(unit);
    if (most !== null && cost <= most) return true;
    return this.assaultsAfterMove(unit) && cost < this.u(unit).type.move;
  }

  /**
   * 6.8, 6.9: what a Moved unit may still do, or null when it is not Moved: `left`, what is left of its allowance for a
   * move on (6.9); `fire`, whether it may fire once (a short move of `moveFire.class`); `assault`, whether it may make one
   * close assault (`assault.afterMove`).
   */
  movedMay(at: Position, unit: number): { readonly left: number; readonly fire: boolean; readonly assault: boolean } | null {
    const u = at.units[unit] as UnitState;
    if (!u.moved) return null;
    const most = this.shortMove(unit);
    return { left: this.u(unit).type.move - u.moveUsed, fire: most !== null && u.moveUsed <= most, assault: this.assaultsAfterMove(unit) };
  }

  /** 6.9: what is left of a unit's allowance for its move now: all of it, or for a Moved unit its allowance less `moveUsed`. */
  allowanceLeft(at: Position, unit: number): number {
    const u = at.units[unit] as UnitState;
    return this.u(unit).type.move - (u.moved ? u.moveUsed : 0);
  }

  /** 6.8: may this unit fire now as far as Moved goes: it is not Moved, or it is Moved after a short move of `moveFire.class`. */
  private firesMoved(p: Position, unit: number): boolean {
    return (this.movedMay(p, unit)?.fire ?? true);
  }

  /**
   * 6.8, 6.9: what a move by this path would leave the unit, if no reaction fire stops it: `moved` (it may still act once) or
   * `spent`. The whole cost of the path against 6.8; it checks nothing of the path's legality. A Moved unit's move on always
   * leaves it Spent (6.9). For a client that marks the hexes a unit can reach and still act.
   */
  moveLeaves(at: ImpulseState | ImpulseView, unit: number, path: readonly number[]): 'moved' | 'spent' {
    if (path.length === 0 || (at.units[unit] as UnitState).moved) return 'spent';
    const mv = this.u(unit).mover;
    let from = (at.units[unit] as UnitState).hex;
    let cost = 0;
    for (const h of path) {
      cost += this.board.cost(mv, from, h) ?? 0;
      from = h;
    }
    return this.leavesMoved(unit, cost) ? 'moved' : 'spent';
  }

  /** Fire's support (7.4) of `n` firers. */
  private support(n: number): number {
    return supportOf(this.rules.support.steps, n);
  }

  /** A close assault's support (12.3, `assault.support`) of `n` units. */
  private assaultSupport(n: number): number {
    return supportOf(this.rules.assault.support, n);
  }

  /** May a unit be the target of a close assault by its class (12.1)? Under `assault.targets: hard`, armour only. */
  mayBeAssaulted(target: number): boolean {
    return this.rules.assault.targets === 'any' || this.classOf(target) === 'hard';
  }

  /**
   * A unit's own column in a close assault (12.3): close against close; for a
   * Hard target `assault.vsHard`, and the close cover of its hex
   * `assault.coverVsHard` times (0: close ground is no shelter to armour); for
   * a Soft target that cover in full; `assault.vsSuppressed` on a Suppressed one.
   */
  assaultColumn(p: Position, unit: number, target: number): number {
    const t = p.units[target] as UnitState;
    const a = this.rules.assault;
    const cover = this.coverClose[t.hex] as number;
    const ground = this.classOf(target) === 'hard' ? a.vsHard - a.coverVsHard * cover : -cover;
    return this.u(unit).type.close - this.u(target).type.close + ground + (t.suppressed ? a.vsSuppressed : 0);
  }

  /** The column of an overrun's attack on a unit in the target hex (12.9). */
  overrunColumn(unit: number, target: number, hex: number): number {
    return this.u(unit).type.he - this.u(target).type.defense - (this.coverFire[hex] as number) + this.rules.overrun.steps;
  }

  /** The column of a high-explosive attack on a unit (13.5). */
  private heColumn(p: Position, battery: number, target: number): number {
    const hex = (p.units[target] as UnitState).hex;
    return this.u(battery).type.he - this.u(target).type.defense - (this.coverFire[hex] as number)
      + (this.classOf(target) === 'hard' ? this.rules.artillery.vsHard : 0);
  }

  /** May a unit react to a mover at all (8.2)? A carried unit never does (14.4). */
  private mayReact(p: Position, r: number, moverClass: 'hard' | 'soft'): boolean {
    const u = p.units[r] as UnitState;
    if (u.destroyed || u.hex < 0 || u.spent || u.suppressed || this.u(r).battery) return false;
    // 6.8, 8.2: a Moved unit reacts only if it may fire (a short move of moveFire.class); one Moved to close assault does not.
    if (!this.firesMoved(p, r)) return false;
    const disc = (p.formations[this.u(r).formation] as { discipline: Discipline }).discipline;
    if (disc === 'hold' || (disc === 'armor' && moverClass !== 'hard')) return false;
    return this.firepower(r, moverClass) > 0;
  }

  private atFloor(effectWays: number): boolean {
    return effectWays > 0 && effectWays >= this.rules.reaction.floor * this.table.total;
  }

  // -------------------------------------------------------------------------
  // reaction fire: the plan (8.2 to 8.5) and the preview (8.8)
  // -------------------------------------------------------------------------

  /** May reactor r fire at the mover standing in `hex` (8.3), and at what column (8.4)? */
  private shotAt(p: Position, r: number, mover: number, hex: number, moverRevealed: boolean): number | null {
    const rh = (p.units[r] as UnitState).hex;
    if (distance(this.board.grid, rh, hex) > this.longRange(this.u(r).type.range)) return null;
    if (!this.sees(p, rh, hex)) return null;
    if (!this.mayBeFiredAt(p, this.u(mover).side, hex, moverRevealed)) return null;
    const own = this.ownColumn(p, r, mover, hex);
    return own === null ? null : own + this.rules.reaction.modifier;
  }

  /**
   * The plan of the reaction shots a path draws (8.2 to 8.5), on the position
   * as it is when the mover sets out. For an overrun the path runs on through
   * the target hex (no shot there, 12.10; Revealed from there on, 12.11) to
   * the exit hex.
   */
  private plan(p: Position, mover: number, path: readonly number[], opts: PlanOptions = {}): Plan {
    const side = this.u(mover).side;
    const cls = this.classOf(mover);
    const start = opts.start ?? (p.units[mover] as UnitState).hex;
    const target = opts.targetStep ?? -1;
    const revealedAtStart = (p.units[mover] as UnitState).revealed > 0;
    const reveals = path.map(h => this.revealsAt(p, side, h));
    const revealedAt: boolean[] = [];
    let rv = revealedAtStart;
    for (let k = 0; k < path.length; k++) {
      if (reveals[k] || (target >= 0 && k >= target)) rv = true;
      revealedAt.push(rv);
    }
    const mv = this.u(mover).mover;
    const costs: number[] = [];
    let at = start;
    let cost = 0;
    for (const h of path) {
      if (!opts.free) cost += this.board.cost(mv, at, h) ?? 0;
      costs.push(cost);
      at = h;
    }
    const walked = target >= 0 ? target : path.length;
    const total = this.table.total;
    const candidates: PlannedShot[] = [];
    // 9.3 at each step does not depend on the reactor: judged once a step, when first asked.
    const fireable: (boolean | undefined)[] = [];
    const g = this.board.grid;
    if (this.drawsFire(p, mover)) {
      for (const r of this.sideUnits[1 - side] as number[]) {
        if (!this.mayReact(p, r, cls)) continue;
        const rh = (p.units[r] as UnitState).hex;
        const reach = this.longRange(this.u(r).type.range);
        let best: PlannedShot | null = null;
        for (let k = 0; k < path.length; k++) {
          if (k === target) continue;
          // shotAt (8.3, 8.4), with 9.3 taken from the step's judgement.
          const h = path[k] as number;
          if (distance(g, rh, h) > reach || !this.sees(p, rh, h)) continue;
          let f = fireable[k];
          if (f === undefined) {
            f = this.mayBeFiredAt(p, side, h, revealedAt[k] as boolean);
            fireable[k] = f;
          }
          if (!f) continue;
          const own = this.ownColumn(p, r, mover, h);
          const col = own === null ? null : own + this.rules.reaction.modifier;
          if (col === null) continue;
          const eff = this.table.effectWays(col);
          if (eff === 0) continue;
          const des = this.table.destroyWays(col);
          if (best === null || eff > best.effect || (eff === best.effect && des > best.destroy)) {
            best = { reactor: r, step: k, hex: path[k] as number, column: col, effect: eff, destroy: des, of: total };
          }
        }
        if (best !== null && this.atFloor(best.effect)) candidates.push(best);
      }
    }
    candidates.sort((a, b) => b.effect - a.effect || b.destroy - a.destroy || a.reactor - b.reactor);
    const cap = this.rules.reaction.cap;
    const firing = cap === NONE ? candidates : candidates.slice(0, cap);
    firing.sort((a, b) => a.step - b.step || b.effect - a.effect || b.destroy - a.destroy || a.reactor - b.reactor);
    return { unit: mover, start, path: path.slice(), reveals, revealedAtStart, shots: firing, costs, walked };
  }

  /**
   * The reaction plan of a unit setting out on a path from the hex it stands
   * in (8.2 to 8.5): the plan every move and every path of a close assault is
   * walked by, made by the same code. It checks nothing of the path's
   * legality; `preview` is what a player is shown.
   */
  planPath(at: ImpulseState | ImpulseView, unit: number, path: readonly number[]): ReactionPlan {
    const pl = this.plan(at, unit, path);
    return { unit: pl.unit, path: pl.path.slice(), shots: pl.shots.map(s => ({ ...s })) };
  }

  /**
   * The preview a player sees before committing (8.8): for a move, a
   * dismount or an overrun, its one plan; for a close assault, a plan for
   * each of its units in the order the assault lists them (12.2), each made
   * on the position the earlier units' paths leave where no shot has any
   * effect (a reactor that fired at an earlier unit is Spent, 8.7). Null when
   * the action is not a legal one of those of that seat. Reads a state or a
   * view alike.
   */
  preview(at: ImpulseState | ImpulseView, seat: Seat, action: unknown): ReactionPlan[] | null {
    const v = this.validate(at, seat, action);
    if ('code' in v) return null;
    const out = (pl: Plan): ReactionPlan => ({ unit: pl.unit, path: pl.path.slice(), shots: pl.shots.map(s => ({ ...s })) });
    if (v.plan) return [out(v.plan)];
    if (v.action.type !== 'assault') return null;
    const d = draftOf(at);
    const plans: ReactionPlan[] = [];
    for (const { unit, path } of v.action.units) {
      const pl = this.plan(d, unit, path);
      plans.push(out(pl));
      for (const s of pl.shots) {
        const r = d.units[s.reactor] as UnitState;
        r.spent = true;
        r.moved = false;
        r.revealed = d.turn;
      }
      if (path.length > 0) (d.units[unit] as UnitState).hex = path[path.length - 1] as number;
    }
    return plans;
  }

  // -------------------------------------------------------------------------
  // checking an action
  // -------------------------------------------------------------------------

  check(s: ImpulseState, seat: Seat, action: unknown): Rejection | null {
    const v = this.validate(s, seat, action);
    return 'code' in v ? v : null;
  }

  /** The action checked and typed, with what its resolution needs, or a rejection. Reads a state or a view. */
  private validate(p: Position, seat: unknown, raw: unknown): Rejection | Checked {
    const si = typeof seat === 'string' ? this.seats.indexOf(seat) : -1;
    if (si < 0) return reject('unknown_seat', `'${String(seat)}' is not a seat of this match`);
    if (p.stage === 'over') return reject('game_over', 'the game is over');
    const pend = this.decidingIn(p);
    if (pend.kind !== 'decide' || !pend.seats.includes(seat as string)) return reject('not_your_turn', `it is not ${String(seat)}'s decision`);

    const shaped = this.shapeOf(raw);
    if ('code' in shaped) return shaped;
    const action = shaped;
    const type = action.type;

    // The deployment step (4.2).
    const deployTypes: readonly string[] = ['place', 'unplace', 'submit', 'takeSetup'];
    if (p.stage === 'deploy') {
      if (!deployTypes.includes(type)) return reject('wrong_stage', 'during the free deployment only place, unplace, submit and takeSetup are taken');
      return this.validateDeploy(p, si, action);
    }
    if (deployTypes.includes(type)) return reject('wrong_stage', 'the deployment is over');

    // A side with a mission due lands it first (5.4).
    const due = this.dueOf(p, si);
    if (type === 'land') return due ? { side: si, action } : reject('no_mission_due', 'the side has no mission due');
    if (due) return reject('must_land', 'the side has a mission due: it lands it first (5.4)');

    switch (action.type) {
      case 'activate': {
        if (this.sideProfile) return reject('wrong_profile', 'under the whole-side profile a side activates with activateSide (5.9)');
        if (p.activation) return reject('activation_open', 'an activation is open');
        const f = this.formationArg(si, action.formation);
        if ('code' in f) return f;
        if ((p.formations[action.formation] as { activated: boolean }).activated) return reject('formation_used', 'the formation has been activated this turn');
        if (!this.formationCanAct(p, action.formation)) return reject('no_unit_can_act', 'no unit of the formation is in command, Ready and not Suppressed');
        return { side: si, action };
      }
      case 'activateUnit': {
        if (p.activation) return reject('activation_open', 'an activation is open');
        const u = this.unitArg(p, si, action.unit);
        if (u) return u;
        const us = p.units[action.unit] as UnitState;
        if (us.spent) return reject('spent', 'the unit is Spent');
        if (us.suppressed) return reject('suppressed', 'the unit is Suppressed');
        if (this.inCommandNow(p, action.unit)) return reject('unit_in_command', 'the unit is in command: it acts when its formation is activated');
        // 5.5 as amended (the lead's ruling on round 1): a battery with a mission waiting could not act.
        if (!this.ready(p, action.unit)) return reject('no_unit_can_act', 'the unit could not act: a battery with a mission waiting (5.5, 13.1)');
        return { side: si, action };
      }
      case 'activateSide': {
        if (!this.sideProfile) return reject('wrong_profile', 'activateSide belongs to the whole-side profile (5.9)');
        if (p.activation) return reject('activation_open', 'an activation is open');
        if (!this.sideCanAct(p, si)) return reject('no_unit_can_act', 'no unit of the side is Ready and not Suppressed');
        return { side: si, action };
      }
      case 'pass':
        if (p.activation) return reject('activation_open', 'an activation is open: end it first');
        return { side: si, action };
      case 'discipline': {
        const f = this.formationArg(si, action.formation);
        if ('code' in f) return f;
        return { side: si, action };
      }
      case 'end':
        if (!p.activation) return reject('not_activated', 'no activation is open');
        return { side: si, action };
      case 'fire':
        return this.validateFire(p, si, action);
      case 'move':
        return this.validateMove(p, si, action);
      case 'assault':
        return this.validateAssault(p, si, action);
      case 'overrun': {
        const r = this.checkOverrun(p, si, action);
        if (r) return r;
        const start = (p.units[action.unit] as UnitState).hex;
        const { target, exit } = this.overrunHexes(start, action.path, action.target);
        return { side: si, action, plan: this.plan(p, action.unit, [...action.path, target, exit], { targetStep: action.path.length }) };
      }
      case 'mount': {
        const r = this.checkMount(p, si, action);
        return r ?? { side: si, action };
      }
      case 'dismount': {
        const r = this.checkDismount(p, si, action);
        if (r) return r;
        return { side: si, action, plan: this.plan(p, action.unit, [action.hex], { start: -1, free: true }) };
      }
      case 'mission':
        return this.validateMission(p, si, action);
      default:
        return reject('unknown_action', `no action is called '${type}'`);
    }
  }

  /** The shape of an action: its type, exactly its keys, whole numbers where a unit, hex or formation goes. */
  private shapeOf(raw: unknown): Rejection | ImpulseAction {
    if (!isPlainObject(raw)) return reject('malformed', 'an action is a mapping of keys to values');
    if (!own(raw, 'type') || typeof raw.type !== 'string') return reject('malformed', 'an action needs a type');
    const type = raw.type as ActionType;
    if (!(ACTION_TYPES as readonly string[]).includes(type)) return reject('unknown_action', `no action is called '${String(raw.type)}'`);
    const keys = ACTION_KEYS[type];
    for (const k of Object.keys(raw)) if (!keys.includes(k)) return reject('malformed', `unknown key '${k}' in a ${type} action`);
    for (const k of keys) if (!own(raw, k)) return reject('malformed', `a ${type} action needs '${k}'`);
    for (const k of ['unit', 'hex', 'target', 'formation', 'transport']) {
      if (own(raw, k) && !isWhole(raw[k])) return reject('malformed', `${k} must be a whole number`);
    }
    const pathOk = (path: unknown, what: string): Rejection | null => {
      if (!Array.isArray(path) || path.length > this.board.n) return reject('malformed', `${what} must be a list of at most ${this.board.n} hexes`);
      for (const h of path) if (!isWhole(h)) return reject('malformed', `every hex of ${what} is a whole number`);
      return null;
    };
    if (own(raw, 'path')) {
      const r = pathOk(raw.path, 'a path');
      if (r) return r;
      if (type === 'move' && (raw.path as unknown[]).length === 0) return reject('malformed', 'a move path enters at least one hex');
    }
    if (own(raw, 'firers')) {
      const f = raw.firers;
      if (!Array.isArray(f) || f.length < 1 || f.length > this.unitInfo.length) return reject('malformed', 'firers must be a list of one or more units');
      for (const x of f) if (!isWhole(x)) return reject('malformed', 'every firer is a whole number');
      if (new Set(f).size !== f.length) return reject('malformed', 'a firer is listed twice');
    }
    if (type === 'assault') {
      const us = raw.units;
      if (!Array.isArray(us) || us.length < 1 || us.length > this.unitInfo.length) return reject('malformed', 'units must be a list of one or more { unit, path }');
      const seenUnits = new Set<number>();
      for (const e of us) {
        if (!isPlainObject(e)) return reject('malformed', 'each unit of an assault is { unit, path }');
        for (const k of Object.keys(e)) if (k !== 'unit' && k !== 'path') return reject('malformed', `unknown key '${k}' in a unit of an assault`);
        if (!own(e, 'unit') || !own(e, 'path')) return reject('malformed', 'each unit of an assault has unit and path');
        if (!isWhole(e.unit)) return reject('malformed', 'unit must be a whole number');
        const r = pathOk(e.path, 'a path');
        if (r) return r;
        if (seenUnits.has(e.unit)) return reject('malformed', `unit ${e.unit} is named twice in one assault (12.1)`);
        seenUnits.add(e.unit);
      }
      const adv = raw.advance;
      if (!Array.isArray(adv) || adv.length > this.unitInfo.length) return reject('malformed', 'advance must be a list of units');
      for (const x of adv) if (!isWhole(x)) return reject('malformed', 'every unit named to advance is a whole number');
      if (new Set(adv).size !== adv.length) return reject('malformed', 'a unit is named twice to advance');
    }
    if (own(raw, 'setting') && !(DISCIPLINES as readonly unknown[]).includes(raw.setting)) return reject('malformed', `setting must be one of ${DISCIPLINES.join(', ')}`);
    if (own(raw, 'kind') && !(MISSION_KINDS as readonly unknown[]).includes(raw.kind)) return reject('malformed', `kind must be one of ${MISSION_KINDS.join(', ')}`);
    return plainAction(type, raw);
  }

  private formationArg(si: number, f: number): Rejection | FormationInfo {
    const fi = this.formationInfo[f];
    if (f < 0 || !fi) return reject('unknown_formation', `there is no formation ${f}`);
    if (fi.side !== si) return reject('not_your_formation', `formation ${f} is not this side's`);
    return fi;
  }

  /** The unit exists, is the side's and is in play (on the board or carried); null when it is. */
  private unitArg(p: Position, si: number, i: number): Rejection | null {
    if (i < 0 || i >= this.unitInfo.length) return reject('unknown_unit', `there is no unit ${i}`);
    if (this.u(i).side !== si) return reject('not_your_unit', `unit ${i} is not this side's`);
    if (!this.alive(p, i)) return reject('not_on_board', `unit ${i} has been destroyed`);
    return null;
  }

  /** A unit taking one of the things of 5.7: of the open activation, in command, Ready, not Suppressed, no mission waiting. */
  private actor(p: Position, si: number, i: number): Rejection | null {
    const r = this.unitArg(p, si, i);
    if (r) return r;
    const a = p.activation;
    if (!a) return reject('not_activated', 'no activation is open');
    const info = this.u(i);
    const inActivation = a.kind === 'side' || (a.kind === 'formation' && info.formation === a.formation) || (a.kind === 'unit' && a.unit === i);
    if (!inActivation) return reject('not_activated', `unit ${i} is not of the open activation`);
    if (!a.inCommand.includes(i)) return reject('out_of_command', `unit ${i} was out of command when its formation was activated`);
    const u = p.units[i] as UnitState;
    if (u.spent) return reject('spent', `unit ${i} is Spent`);
    if (u.suppressed) return reject('suppressed', `unit ${i} is Suppressed`);
    if (info.battery && this.missionOf(p, i) >= 0) return reject('mission_waiting', `battery ${i} has a mission waiting`);
    return null;
  }

  /** An actor that is on the board: a carried unit does nothing but dismount (14.4). */
  private boardActor(p: Position, si: number, i: number): Rejection | null {
    const r = this.actor(p, si, i);
    if (r) return r;
    if (this.isCarried(p, i)) return reject('carried', `unit ${i} is carried: it does nothing but dismount (14.4)`);
    return null;
  }

  /** 6.8: a Moved unit may fire once (or close assault) or move on (6.9), and do nothing else. For overrun, mount, dismount and mission. */
  private unmoved(p: Position, i: number): Rejection | null {
    return (p.units[i] as UnitState).moved ? reject('moved', `unit ${i} is Moved: it may ${this.movedMay(p, i)?.fire ? 'fire once' : 'close assault'} or move on, and do nothing else this turn (6.8, 6.9)`) : null;
  }

  private validateDeploy(p: Position, si: number, action: ImpulseAction): Rejection | Checked {
    const dep = p.deployment;
    const placed = dep?.placed[si];
    if (!dep || !placed) throw new Error('validate: a deployment without the side\'s placements');
    const unitOf = (i: number): Rejection | number => {
      if (i < 0 || i >= this.unitInfo.length) return reject('unknown_unit', `there is no unit ${i}`);
      if (this.u(i).side !== si) return reject('not_your_unit', `unit ${i} is not this side's`);
      return this.u(i).place;
    };
    switch (action.type) {
      case 'place': {
        const k = unitOf(action.unit);
        if (typeof k !== 'number') return k;
        if (this.u(action.unit).setupCarrier >= 0) return reject('carried', `unit ${action.unit} starts carried: it is placed with its transport (4.1)`);
        if ((placed[k] as number) >= 0) return reject('already_placed', `unit ${action.unit} is placed: unplace it first`);
        if (!this.board.has(action.hex)) return reject('off_board', `hex ${action.hex} is not on the board`);
        if ((this.zones[si] as Uint8Array)[action.hex] !== 1) return reject('placement_zone', `hex ${action.hex} is outside the side's zone`);
        if ((this.enterable[this.u(action.unit).mover] as Uint8Array)[action.hex] !== 1) return reject('impassable', `the unit's mover type may not enter hex ${action.hex} (4.1)`);
        let here = 0;
        for (const h of placed) if (h === action.hex) here++;
        if (here >= this.rules.stack.limit) return reject('stacking', `hex ${action.hex} already holds ${here} units`);
        return { side: si, action };
      }
      case 'unplace': {
        const k = unitOf(action.unit);
        if (typeof k !== 'number') return k;
        if ((placed[k] as number) < 0) return reject('not_placed', `unit ${action.unit} is not placed`);
        return { side: si, action };
      }
      case 'submit': {
        let missing = 0;
        for (const i of this.sideUnits[si] as number[]) if (this.u(i).setupCarrier < 0 && (placed[this.u(i).place] as number) < 0) missing++;
        if (missing > 0) return reject('placement_incomplete', `${missing} units are not yet placed`);
        return { side: si, action };
      }
      default:
        return { side: si, action };
    }
  }

  /** Check a path from a hex (section 6): adjacency, no revisit, no enemy hex (14.7 aside), passable. Returns its cost. */
  private checkPath(p: Position, si: number, unit: number, start: number, path: readonly number[], seen: number[] = [start]): Rejection | number {
    const steps = this.board.stepCost[this.u(unit).mover] as Int32Array;
    const combat = this.u(unit).combat;
    const nb = this.board.neighbour;
    let at = start;
    let cost = 0;
    for (const h of path) {
      if (!this.board.has(h)) return reject('off_board', `hex ${h} is not on the board`);
      let d = -1;
      for (let k = 0; k < 6; k++) if (nb[at * 6 + k] === h) d = k;
      if (d < 0) return reject('not_adjacent', `hex ${h} is not next to hex ${at}`);
      if (seen.includes(h)) return reject('revisit', `the path enters hex ${h} twice, or the hex it started from (6.7)`);
      if (this.enemyAt(p, si, h, combat)) return reject('enemy_hex', `hex ${h} holds an enemy unit (6.3)`);
      const c = steps[at * 6 + d] as number;
      if (c < 0) return reject('impassable', `the unit cannot step from hex ${at} to hex ${h}`);
      cost += c;
      seen.push(h);
      at = h;
    }
    return cost;
  }

  private validateMove(p: Position, si: number, action: ImpulseAction & { type: 'move' }): Rejection | Checked {
    const r = this.checkMove(p, si, action.unit, action.path);
    if (r) return r;
    return { side: si, action, plan: this.plan(p, action.unit, action.path) };
  }

  private checkMove(p: Position, si: number, i: number, path: readonly number[]): Rejection | null {
    const r = this.boardActor(p, si, i);
    if (r) return r;
    const allowance = this.u(i).type.move;
    const start = (p.units[i] as UnitState).hex;
    const cost = this.checkPath(p, si, i, start, path);
    if (typeof cost !== 'number') return cost;
    const moved = (p.units[i] as UnitState).moved;
    if (moved) {
      // 6.9: a Moved unit moves on with what is left of its allowance; 6.2's one hex is no exception.
      const left = this.allowanceLeft(p, i);
      if (cost > left) return reject('over_remaining', `the path costs ${cost}, more than the ${left} left of unit ${i}'s allowance after its first move (6.9)`);
    }
    const one = path.length === 1 && this.rules.move.alwaysOne && allowance > 0;
    if (cost > allowance && !one) return reject('over_allowance', `the path costs ${cost}, more than the allowance of ${allowance}`);
    const end = path[path.length - 1] as number;
    if (this.countAt(p, si, end, i) >= this.rules.stack.limit) return reject('stacking', `hex ${end} would hold more than ${this.rules.stack.limit} units (6.4)`);
    return null;
  }

  /** 12.1: one or more units, each named once, each of the activation and able to assault, each path within its share and ending beside the target. */
  private validateAssault(p: Position, si: number, action: ImpulseAction & { type: 'assault' }): Rejection | Checked {
    for (const { unit } of action.units) {
      const r = this.boardActor(p, si, unit);
      if (r) return r;
      if (!this.u(unit).type.assaults) return reject('cannot_assault', `unit ${unit}'s type may not make a close assault (12.1)`);
      // 6.8, 12.1: a Moved unit may close assault only if a move with movement over left it Moved for that (assault.afterMove).
      if ((p.units[unit] as UnitState).moved && !this.movedMay(p, unit)?.assault) return this.unmoved(p, unit) as Rejection;
    }
    const t = this.targetArg(p, si, action.target);
    if (t) return t;
    // 12.1, assault.targets: a close assault is made on armour. The words before the colon are the lead's (ruling 74); the game layer has its own.
    if (!this.mayBeAssaulted(action.target)) return reject('assault_target_soft', `a close assault is made on armour: unit ${action.target} is Soft (12.1)`);
    const named = action.units.map(x => x.unit);
    for (const a of action.advance) if (!named.includes(a)) return reject('not_assaulting', `unit ${a} is named to advance but is not one of the assault's units (12.1)`);
    const th = (p.units[action.target] as UnitState).hex;
    const g = this.board.grid;
    const limit = this.rules.stack.limit;
    const delta = new Map<number, number>();
    const cols: number[] = [];
    for (const { unit, path } of action.units) {
      const allowance = this.u(unit).type.move;
      const start = (p.units[unit] as UnitState).hex;
      const cost = this.checkPath(p, si, unit, start, path);
      if (typeof cost !== 'number') return cost;
      // An empty transport without firepower opens its hex to a combat unit's move (6.3, 14.7), but a path into the target's own hex would
      // destroy the target before the assault is made (12.1 to 12.3 assault a unit that is there): such a path is no approach to it.
      if (path.includes(th)) return reject('enemy_hex', `unit ${unit}'s path enters hex ${th}, the hex of the unit it assaults (12.1, 6.3)`);
      const share = Math.floor(allowance * this.rules.assault.moveShare);
      // 12.1: under assault.moveShare 0 a close assault moves no unit, and 6.2's one hex is no exception.
      if (this.rules.assault.moveShare === 0 && path.length > 0) return reject('assault_too_far', `a close assault moves no unit (assault.moveShare 0): unit ${unit} must stand beside the target (12.1)`);
      if ((p.units[unit] as UnitState).moved && cost > this.allowanceLeft(p, unit)) {
        return reject('over_remaining', `unit ${unit}'s path costs ${cost}, more than the ${this.allowanceLeft(p, unit)} left of its allowance after its first move (6.9, 12.1)`);
      }
      const one = path.length === 1 && this.rules.move.alwaysOne && allowance > 0;
      if (cost > share && !one) return reject('assault_too_far', `unit ${unit}'s path costs ${cost}, more than ${share}, the assault's share of its allowance (12.1)`);
      const end = path.length > 0 ? (path[path.length - 1] as number) : start;
      if (distance(g, end, th) !== 1) return reject('not_beside', `unit ${unit}'s path does not end beside the target`);
      if (path.length > 0) {
        // 6.4, the paths made one at a time (12.2): the units before it stand at the ends of theirs.
        if (this.countAt(p, si, end, unit) + (delta.get(end) ?? 0) >= limit) return reject('stacking', `hex ${end} would hold more than ${limit} units (6.4)`);
        delta.set(end, (delta.get(end) ?? 0) + 1);
        delta.set(start, (delta.get(start) ?? 0) - 1);
      }
      cols.push(this.assaultColumn(p, unit, action.target));
    }
    const best = Math.max(...cols);
    for (let k = 0; k < cols.length; k++) {
      if ((cols[k] as number) < best - this.rules.support.within) return reject('not_within_support', `unit ${named[k]}'s own column is more than ${this.rules.support.within} below the best (12.1)`);
    }
    const column = best + this.assaultSupport(cols.length);
    if (!this.table.canSuppress(column)) return reject('cannot_suppress', `column ${column} cannot suppress on any roll (12.1, 7.6)`);
    return { side: si, action, column };
  }

  /** The target is an enemy unit in play on the board. */
  private targetArg(p: Position, si: number, t: number): Rejection | null {
    if (t < 0 || t >= this.unitInfo.length) return reject('unknown_unit', `there is no unit ${t}`);
    if (this.u(t).side === si || !this.alive(p, t)) return reject('bad_target', `unit ${t} is not an enemy unit in play`);
    if (this.isCarried(p, t)) return reject('target_carried', `unit ${t} is carried: it cannot be fired at or assaulted (7.9, 14.4)`);
    return null;
  }

  /** The target hex and exit hex of an overrun (12.7): the exit straight on from the hex it comes from. */
  private overrunHexes(start: number, path: readonly number[], target: number): { from: number; dir: number; target: number; exit: number } {
    const from = path.length > 0 ? (path[path.length - 1] as number) : start;
    const dir = this.dirFrom(from, target);
    const exit = dir < 0 ? -1 : (this.board.neighbour[target * 6 + dir] as number);
    return { from, dir, target, exit };
  }

  /** 12.7, 12.8: an overrun's checks; null when it is legal. */
  private checkOverrun(p: Position, si: number, action: ImpulseAction & { type: 'overrun' }): Rejection | null {
    const i = action.unit;
    const r = this.boardActor(p, si, i) ?? this.unmoved(p, i);
    if (r) return r;
    const info = this.u(i);
    if (!info.type.overruns) return reject('cannot_overrun', `unit ${i}'s type may not overrun (12.7)`);
    if (!this.board.has(action.target)) return reject('off_board', `hex ${action.target} is not on the board`);
    const start = (p.units[i] as UnitState).hex;
    const seen = [start];
    const cost = this.checkPath(p, si, i, start, action.path, seen);
    if (typeof cost !== 'number') return cost;
    const { from, dir, target, exit } = this.overrunHexes(start, action.path, action.target);
    if (dir < 0) return reject('not_beside', 'the path does not end beside the target hex (12.7)');
    if (this.overrunGround[target] !== 1) return reject('overrun_ground', `hex ${target}'s ground may not be overrun (12.8)`);
    let soft = 0;
    let canSuppress = false;
    for (const e of this.sideUnits[1 - si] as number[]) {
      if (!this.onBoard(p, e) || (p.units[e] as UnitState).hex !== target) continue;
      // 12.8 with 14.7: an empty transport without firepower counts for neither test, whatever its class (it is destroyed as the unit enters, 12.9).
      if (this.emptyTruck(p, e)) continue;
      if (this.classOf(e) === 'hard') return reject('overrun_hard', `hex ${target} holds an enemy Hard unit (12.8)`);
      soft++;
      if (this.table.canSuppress(this.overrunColumn(i, e, target))) canSuppress = true;
    }
    if (soft === 0) return reject('overrun_no_target', `hex ${target} holds no enemy Soft unit to overrun (12.8, 14.7)`);
    if (exit < 0) return reject('off_board', 'the exit hex is off the board (12.8)');
    if (seen.includes(target) || seen.includes(exit)) return reject('revisit', 'the overrun returns to a hex it has been in, or the hex it started from (6.7, 12.8)');
    const steps = this.board.stepCost[info.mover] as Int32Array;
    const intoTarget = steps[from * 6 + dir] as number;
    const intoExit = steps[target * 6 + dir] as number;
    if (intoTarget < 0) return reject('impassable', `the unit cannot step from hex ${from} into the target hex ${target}`);
    if (intoExit < 0) return reject('impassable', `the unit cannot step from the target hex into the exit hex ${exit}`);
    if (this.enemyAt(p, si, exit, info.combat)) return reject('enemy_hex', `the exit hex ${exit} holds an enemy unit (12.8)`);
    if (this.countAt(p, si, exit, i) >= this.rules.stack.limit) return reject('stacking', `the exit hex ${exit} would hold more than ${this.rules.stack.limit} units (12.8, 6.4)`);
    const total = cost + intoTarget + intoExit + this.rules.overrun.cost;
    if (total > info.type.move) return reject('over_allowance', `the overrun costs ${total} with overrun.cost, more than the allowance of ${info.type.move} (12.8)`);
    if (!canSuppress) return reject('cannot_suppress', 'none of the overrun\'s attacks can suppress on any roll (12.8, 7.6)');
    return null;
  }

  /** 14.1, 14.2: mounting. */
  private checkMount(p: Position, si: number, action: ImpulseAction & { type: 'mount' }): Rejection | null {
    const i = action.unit;
    const r = this.boardActor(p, si, i) ?? this.unmoved(p, i);
    if (r) return r;
    if (!this.u(i).type.rides) return reject('cannot_ride', `unit ${i}'s type does not ride (14.1)`);
    const t = action.transport;
    if (t < 0 || t >= this.unitInfo.length) return reject('unknown_unit', `there is no unit ${t}`);
    if (!this.u(t).transport) return reject('cannot_carry', `unit ${t}'s type carries nothing (14.1)`);
    if (this.u(t).side !== si) return reject('enemy_transport', `unit ${t} is the other side's (14.1)`);
    if (!this.onBoard(p, t)) return reject('bad_target', `transport ${t} has been destroyed`);
    if (this.passengerOf(p, t) >= 0) return reject('transport_full', `transport ${t} already carries a unit (14.1)`);
    if ((p.units[t] as UnitState).suppressed) return reject('transport_suppressed', `transport ${t} is Suppressed (14.2)`);
    if (distance(this.board.grid, (p.units[i] as UnitState).hex, (p.units[t] as UnitState).hex) > 1) return reject('transport_far', `transport ${t} is neither in the unit's hex nor beside it (14.2)`);
    return null;
  }

  /** 14.5: dismounting. */
  private checkDismount(p: Position, si: number, action: ImpulseAction & { type: 'dismount' }): Rejection | null {
    const i = action.unit;
    const r = this.actor(p, si, i) ?? this.unmoved(p, i);
    if (r) return r;
    const u = p.units[i] as UnitState;
    if (u.carriedBy < 0) return reject('not_carried', `unit ${i} is not carried (14.5)`);
    const h = action.hex;
    if (!this.board.has(h)) return reject('off_board', `hex ${h} is not on the board`);
    const th = (p.units[u.carriedBy] as UnitState).hex;
    const dir = h === th ? -1 : this.dirFrom(th, h);
    if (h !== th && dir < 0) return reject('dismount_far', `hex ${h} is neither the transport's nor beside it (14.5)`);
    if (this.enemyAt(p, si, h, this.u(i).combat)) return reject('enemy_hex', `hex ${h} holds an enemy unit (14.5)`);
    if (this.countAt(p, si, h, i) >= this.rules.stack.limit) return reject('stacking', `hex ${h} would hold more than ${this.rules.stack.limit} units (14.5)`);
    if (dir >= 0 && ((this.board.stepCost[this.u(i).dismountMover] as Int32Array)[th * 6 + dir] as number) < 0) {
      return reject('impassable', `the step from the transport's hex into hex ${h} is impassable for the unit (14.5)`);
    }
    return null;
  }

  private validateFire(p: Position, si: number, action: ImpulseAction & { type: 'fire' }): Rejection | Checked {
    for (const f of action.firers) {
      const r = this.boardActor(p, si, f);
      if (r) return r;
      if (this.u(f).battery) return reject('battery', `unit ${f} is a battery: it fires missions, never direct fire (7.1)`);
      // 6.8: a unit Moved to close assault does not fire.
      if (!this.firesMoved(p, f)) return this.unmoved(p, f) as Rejection;
    }
    const t = this.targetArg(p, si, action.target);
    if (t) return t;
    const th = (p.units[action.target] as UnitState).hex;
    const cls = this.classOf(action.target);
    const cols: number[] = [];
    for (const f of action.firers) {
      if (this.firepower(f, cls) <= 0) return reject('no_firepower', `unit ${f} has no firepower against a ${cls} target`);
      if (!this.sees(p, (p.units[f] as UnitState).hex, th)) return reject('no_sight', `unit ${f} has no sight line to the target`);
      const col = this.ownColumn(p, f, action.target, th);
      if (col === null) return reject('out_of_range', `the target is beyond one and a half times unit ${f}'s range`);
      cols.push(col);
    }
    if (!this.mayBeFiredAt(p, this.u(action.target).side, th, (p.units[action.target] as UnitState).revealed > 0)) {
      return reject('concealed', 'the target is concealed: not Revealed and not spotted (9.3)');
    }
    const best = Math.max(...cols);
    for (let k = 0; k < cols.length; k++) {
      if ((cols[k] as number) < best - this.rules.support.within) return reject('not_within_support', `unit ${action.firers[k]}'s own column is more than ${this.rules.support.within} below the best (7.4)`);
    }
    const column = best + this.support(cols.length);
    if (!this.table.canSuppress(column)) return reject('cannot_suppress', `column ${column} cannot suppress on any roll (7.6)`);
    return { side: si, action, column };
  }

  private validateMission(p: Position, si: number, action: ImpulseAction & { type: 'mission' }): Rejection | Checked {
    const i = action.unit;
    const r = this.boardActor(p, si, i) ?? this.unmoved(p, i);
    if (r) return r;
    const ind = this.u(i).type.indirect;
    if (!ind) return reject('battery', 'only a battery calls a fire mission (13.1)');
    if (!this.board.has(action.hex)) return reject('off_board', `hex ${action.hex} is not on the board`);
    const d = distance(this.board.grid, (p.units[i] as UnitState).hex, action.hex);
    if (d > this.u(i).type.range || d < ind.minRange) return reject('mission_range', `hex ${action.hex} is ${d} hexes away: outside ${ind.minRange} to ${this.u(i).type.range}`);
    if (!this.observed(p, si, action.hex)) return reject('mission_unobserved', 'no friendly combat unit that is not Suppressed has a sight line to the hex');
    return { side: si, action };
  }

  private observed(p: Position, si: number, hex: number): boolean {
    for (const o of this.sideUnits[si] as number[]) if (this.watcher(p, o) && this.sees(p, (p.units[o] as UnitState).hex, hex)) return true;
    return false;
  }

  // -------------------------------------------------------------------------
  // applying an action
  // -------------------------------------------------------------------------

  apply(s: ImpulseState, seat: Seat, action: unknown, dice: Dice): Applied<ImpulseState, ImpulseEvent> {
    const v = this.validate(s, seat, action);
    if ('code' in v) return { ok: false, rejection: v };
    const d = draftOf(s);
    const events: ImpulseEvent[] = [];
    const emit: Emit = e => {
      this.reduceOne(d, e);
      events.push(e);
    };
    this.execute(v, d, new DiceRoller(dice, s.roll), emit);
    return { ok: true, state: d as ImpulseState, events };
  }

  /** Resolve a checked action on a draft. The one resolution code: apply, outcomes and branches all call it. */
  private execute(v: Checked, d: Draft, roller: Roller, emit: Emit): void {
    this.resolve(v, d, roller, emit);
    this.endIfWiped(d, emit);
  }

  private resolve(v: Checked, d: Draft, roller: Roller, emit: Emit): void {
    const a = v.action;
    const si = v.side;
    switch (a.type) {
      case 'place':
        emit({ type: 'placed', side: si, unit: a.unit, hex: a.hex });
        return;
      case 'unplace':
        emit({ type: 'placed', side: si, unit: a.unit, hex: null });
        return;
      case 'submit':
      case 'takeSetup':
        emit({ type: 'submitted', side: si, setup: a.type === 'takeSetup' });
        if (d.deployment && d.deployment.finished.every(f => f === true)) {
          const hexes = this.unitInfo.map(u => ((d.deployment as { placed: (number[] | null)[] }).placed[u.side] as number[])[u.place] as number);
          emit({ type: 'deployed', hexes });
          this.startImpulse(d, d.initiative, emit);
        }
        return;
      case 'land':
        this.land(d, si, roller, emit);
        return;
      case 'activate':
      case 'activateUnit':
      case 'activateSide': {
        let inCommand: number[];
        if (a.type === 'activate') inCommand = (this.formationInfo[a.formation] as FormationInfo).units.filter(i => this.alive(d, i) && this.inCommandNow(d, i));
        else if (a.type === 'activateUnit') inCommand = [a.unit];
        else inCommand = (this.sideUnits[si] as number[]).filter(i => this.alive(d, i));
        emit({
          type: 'activated', side: si, formation: a.type === 'activate' ? a.formation : null, unit: a.type === 'activateUnit' ? a.unit : null,
          whole: a.type === 'activateSide', inCommand, orders: (d.sides[si] as { orders: number }).orders - 1,
        });
        this.afterUnitAction(d, emit);
        return;
      }
      case 'pass': {
        const held = (d.sides[si] as { orders: number }).orders;
        const rule = this.rules.pass.rule;
        const orders = rule === 'spends' ? held - 1 : rule === 'free' ? held : 0;
        const buys = this.rules.initiative.policy === 'bought' && si !== d.initiative && (rule === 'free' || held >= 2);
        emit({ type: 'passed', side: si, orders, buys });
        this.nextImpulse(d, emit);
        return;
      }
      case 'discipline':
        emit({ type: 'disciplineSet', formation: a.formation, setting: a.setting });
        return;
      case 'end':
        emit({ type: 'activationEnded', side: si });
        this.nextImpulse(d, emit);
        return;
      case 'fire': {
        const column = v.column as number;
        const target = a.target;
        const res = resolveAttack(this.table, roller, column, (d.units[target] as UnitState).suppressed);
        emit({ type: 'fired', firers: a.firers.slice(), target, column, rolls: res.rolls, dice: res.dice, result: res.effect });
        for (const f of a.firers) emit({ type: 'revealed', unit: f, until: d.turn + 1 });
        const downs: SetDown[] = [];
        this.hit(d, target, res.effect, emit, downs);
        this.setDown(d, downs, emit);
        this.afterUnitAction(d, emit);
        return;
      }
      case 'move': {
        const plan = v.plan as Plan;
        this.emitWalk(d, plan, this.walk(d, plan, roller), 'move', emit, -1, true);
        this.afterUnitAction(d, emit);
        return;
      }
      case 'dismount': {
        const plan = v.plan as Plan;
        this.emitWalk(d, plan, this.walk(d, plan, roller), 'dismount', emit);
        this.afterUnitAction(d, emit);
        return;
      }
      case 'assault':
        this.assault(d, si, a, roller, emit);
        this.afterUnitAction(d, emit);
        return;
      case 'overrun':
        this.overrun(d, si, v.plan as Plan, a, roller, emit);
        this.afterUnitAction(d, emit);
        return;
      case 'mount':
        emit({ type: 'mounted', unit: a.unit, transport: a.transport });
        this.afterUnitAction(d, emit);
        return;
      case 'mission':
        emit({ type: 'missionCalled', battery: a.unit, hex: a.hex, kind: a.kind });
        this.afterUnitAction(d, emit);
        return;
    }
  }

  /**
   * A path walked under reaction fire (6.5, 8.6), decided on the draft as the
   * mover sets out, before any event. The shots fire in the plan's order
   * until one stops or destroys the mover; after a stop each reactor still to
   * fire shoots at the hex where the mover stopped, if that hex qualifies for
   * it and its chance there is at least the floor. Shots planned at a step at
   * or beyond the walked steps (an overrun's exit hex) are left for later
   * when no stop comes.
   */
  private walk(d: Draft, plan: Plan, roller: Roller): Walk {
    const mover = plan.unit;
    const side = this.u(mover).side;
    const fired: Fired[] = [];
    const deferred: PlannedShot[] = [];
    let stopStep = -1;
    let stopHex = -1;
    let destroyed = false;
    for (const shot of plan.shots) {
      if (destroyed) break;
      if (stopStep < 0) {
        if (shot.step >= plan.walked) {
          deferred.push(shot);
          continue;
        }
        const res = resolveAttack(this.table, roller, shot.column, false);
        fired.push({ reactor: shot.reactor, hex: shot.hex, column: shot.column, res });
        if (res.effect === 'destroyed') {
          destroyed = true;
          stopStep = shot.step;
          stopHex = shot.hex;
        } else if (res.effect === 'suppressed') {
          stopStep = shot.step;
          stopHex = this.putBack(d, side, mover, plan, shot.step);
        }
        continue;
      }
      // After a stop: the start hex never qualifies (8.3); otherwise judge the stop hex for this reactor.
      if (stopHex === plan.start) continue;
      let revealed = plan.revealedAtStart;
      for (let k = 0; k <= stopStep; k++) if (plan.reveals[k]) revealed = true;
      const col = this.shotAt(d, shot.reactor, mover, stopHex, revealed);
      if (col === null || !this.atFloor(this.table.effectWays(col))) continue;
      const res = resolveAttack(this.table, roller, col, true);
      fired.push({ reactor: shot.reactor, hex: stopHex, column: col, res });
      if (res.effect !== 'none') destroyed = true;
    }
    return { fired, stopStep, stopHex, destroyed, deferred };
  }

  /**
   * The events of a walk: `moved` (or `dismounted`) with the hexes actually
   * entered and where the unit stands after, the mover's `revealed` (6.6),
   * the empty transports without firepower destroyed as a combat unit enters
   * their hex (14.7), then each reaction shot with the reactor's `revealed`
   * and the mover's `suppressed` or `destroyed`; a passenger of a mover
   * destroyed is then set down (14.6). `endHex` puts back a unit of a close
   * assault that may not stay at the end of its path (12.2).
   */
  /**
   * The events of a walk. `shortMoves`: the walk is a move of 5.7 (not a path of a close assault), so a mover that was not
   * Moved, was not stopped and whose path's cost leaves it Moved by 6.8 (a short move of `moveFire.class`, or movement over
   * for a unit that can close assault) is left Moved, not Spent. A Moved unit's move on leaves it Spent (6.9).
   */
  private emitWalk(d: Draft, plan: Plan, w: Walk, kind: 'move' | 'dismount', emit: Emit, endHex = -1, shortMoves = false): void {
    const mover = plan.unit;
    const side = this.u(mover).side;
    const walkedPath = plan.path.slice(0, plan.walked);
    const entered = w.stopStep < 0 ? walkedPath : plan.path.slice(0, w.stopStep + 1);
    if (entered.length === 0) return;
    const finalHex = w.stopStep >= 0 ? w.stopHex : endHex >= 0 ? endHex : (entered[entered.length - 1] as number);
    if (kind === 'move') {
      const cost = plan.costs[entered.length - 1] as number;
      const wasMoved = (d.units[mover] as UnitState).moved;
      const after = shortMoves && !wasMoved && w.stopStep < 0 && !w.destroyed && this.leavesMoved(mover, cost) ? 'moved' : 'spent';
      emit({ type: 'moved', unit: mover, path: entered, stopped: w.stopStep >= 0, hex: finalHex, cost, after });
    } else {
      emit({ type: 'dismounted', unit: mover, hex: finalHex });
    }
    if (!w.destroyed && plan.reveals.slice(0, entered.length).some(x => x)) emit({ type: 'revealed', unit: mover, until: d.turn + 1 });
    if (this.u(mover).combat) for (const h of entered) for (const t of this.emptyTrucksAt(d, side, h)) this.hit(d, t, 'destroyed', emit, []);
    // Where a passenger of the mover is set down if the mover is destroyed: where that happened, then back along its path (14.6).
    const at = entered.lastIndexOf(finalHex);
    const back = [finalHex, ...(at >= 0 ? entered.slice(0, at).reverse() : entered.slice().reverse())];
    if (plan.start >= 0) back.push(plan.start);
    const downs: SetDown[] = [];
    this.emitShots(d, mover, w.fired, emit, downs, back);
    this.setDown(d, downs, emit);
  }

  /** Reaction shots fired at a mover, with their effects (7.7: a second suppression destroys). */
  private emitShots(d: Draft, mover: number, fired: readonly Fired[], emit: Emit, downs: SetDown[], back: readonly number[]): void {
    for (const f of fired) {
      emit({ type: 'reaction', reactor: f.reactor, mover, hex: f.hex, column: f.column, rolls: f.res.rolls, dice: f.res.dice, result: f.res.effect });
      emit({ type: 'revealed', unit: f.reactor, until: d.turn + 1 });
      if (f.res.effect === 'none') continue;
      const effect: Effect = (d.units[mover] as UnitState).suppressed ? 'destroyed' : f.res.effect;
      this.hit(d, mover, effect, emit, downs, back);
    }
  }

  /** 8.6: the hex a mover suppressed at step k stands in: that hex, or the last hex of its path before it where it may stay. */
  private putBack(p: Position, side: number, mover: number, plan: Plan, k: number): number {
    for (let j = k; j >= 0; j--) {
      const h = plan.path[j] as number;
      if (this.countAt(p, side, h, mover) < this.rules.stack.limit) return h;
    }
    return plan.start;
  }

  /**
   * A close assault (12.2 to 12.6). The paths are walked one unit at a time in
   * the order the assault lists them, each under the reaction fire planned
   * when its turn comes; a unit stopped or destroyed on its way, or one that
   * may not stay at the end of its path, takes no part. The column is made
   * from the units that arrived (12.3).
   */
  private assault(d: Draft, si: number, a: ImpulseAction & { type: 'assault' }, roller: Roller, emit: Emit): void {
    const limit = this.rules.stack.limit;
    const arrived: number[] = [];
    for (const { unit, path } of a.units) {
      if (path.length === 0) {
        arrived.push(unit);
        continue;
      }
      const plan = this.plan(d, unit, path);
      const w = this.walk(d, plan, roller);
      let endHex = -1;
      let takesPart = w.stopStep < 0 && !w.destroyed;
      if (takesPart) {
        const end = path[path.length - 1] as number;
        if (this.countAt(d, si, end, unit) >= limit) {
          // 12.2: an earlier unit was stopped where this one's path ends; put back as 8.6 does.
          endHex = this.putBack(d, si, unit, plan, path.length - 2);
          takesPart = false;
        }
      }
      this.emitWalk(d, plan, w, 'move', emit, endHex);
      if (takesPart) arrived.push(unit);
    }
    if (arrived.length === 0) return; // 12.2: none arrives, no assault
    const target = a.target;
    const tu = d.units[target] as UnitState;
    const th = tu.hex;
    let best = -Infinity;
    for (const i of arrived) best = Math.max(best, this.assaultColumn(d, i, target));
    const column = best + this.assaultSupport(arrived.length);
    const res = resolveAttack(this.table, roller, column, tu.suppressed);
    // 12.5: the advance, decided before the events so that `assaulted` names it.
    const advanced: number[] = [];
    if (res.effect === 'destroyed' && this.passengerOf(d, target) < 0) {
      let room = limit - this.countAt(d, si, th, -1);
      for (const i of a.advance) {
        if (room <= 0) break;
        if (!arrived.includes(i)) continue;
        if (this.othersAt(d, si, th, target, this.u(i).combat)) continue;
        const dir = this.dirFrom((d.units[i] as UnitState).hex, th);
        if (dir < 0 || ((this.board.stepCost[this.u(i).mover] as Int32Array)[(d.units[i] as UnitState).hex * 6 + dir] as number) < 0) continue;
        advanced.push(i);
        room--;
      }
    }
    emit({ type: 'assaulted', units: arrived.slice(), target, column, rolls: res.rolls, dice: res.dice, result: res.effect, advanced });
    for (const i of arrived) emit({ type: 'revealed', unit: i, until: d.turn + 1 });
    const downs: SetDown[] = [];
    if (res.effect === 'none') for (const i of arrived) this.hit(d, i, 'suppressed', emit, downs);
    else this.hit(d, target, res.effect, emit, downs, [th]);
    this.setDown(d, downs, emit);
    if (advanced.length > 0) for (const t of this.emptyTrucksAt(d, si, th)) this.hit(d, t, 'destroyed', emit, []);
  }

  /** Does hex `th` hold an enemy unit of `side` other than `target`, for a unit's movement (14.7)? */
  private othersAt(p: Position, side: number, th: number, target: number, combat: boolean): boolean {
    for (const i of this.sideUnits[1 - side] as number[]) {
      if (i === target || !this.onBoard(p, i) || (p.units[i] as UnitState).hex !== th) continue;
      if (combat && this.emptyTruck(p, i)) continue;
      return true;
    }
    return false;
  }

  /**
   * An overrun (12.9 to 12.12). Its path is walked as a move; a unit stopped
   * or destroyed before it leaves the last hex of its path makes no overrun.
   * Otherwise it becomes Revealed entering the target hex, the empty
   * transports without firepower there are destroyed, it attacks each other
   * enemy Soft unit there in unit order, passengers of destroyed transports
   * are set down, and it enters the exit hex, where the shots planned there
   * are fired by reactors still able to (12.10).
   */
  private overrun(d: Draft, si: number, plan: Plan, a: ImpulseAction & { type: 'overrun' }, roller: Roller, emit: Emit): void {
    const unit = a.unit;
    const w = this.walk(d, plan, roller);
    this.emitWalk(d, plan, w, 'move', emit);
    if (w.stopStep >= 0 || w.destroyed) return;
    const target = a.target;
    const exit = plan.path[plan.path.length - 1] as number;
    emit({ type: 'revealed', unit, until: d.turn + 1 });
    for (const t of this.emptyTrucksAt(d, si, target)) this.hit(d, t, 'destroyed', emit, []);
    const attacks: Attack[] = [];
    for (const e of this.sideUnits[1 - si] as number[]) {
      const eu = d.units[e] as UnitState;
      if (eu.destroyed || eu.hex !== target || this.classOf(e) !== 'soft') continue;
      const column = this.overrunColumn(unit, e, target);
      const res = resolveAttack(this.table, roller, column, eu.suppressed);
      attacks.push({ unit: e, column, rolls: res.rolls, dice: res.dice, result: res.effect });
    }
    emit({ type: 'overran', unit, target, exit, attacks });
    const downs: SetDown[] = [];
    for (const at of attacks) this.hit(d, at.unit, at.result, emit, downs, [target]);
    this.setDown(d, downs, emit);
    for (const t of this.emptyTrucksAt(d, si, exit)) this.hit(d, t, 'destroyed', emit, []);
    // 12.10: the shots planned at the exit hex, by reactors still able to fire; none takes another's place.
    const cls = this.classOf(unit);
    const fired: Fired[] = [];
    let suppressed = false;
    for (const shot of w.deferred) {
      if (!this.mayReact(d, shot.reactor, cls)) continue;
      // After a stop the mover still stands in the exit hex, which qualifies for every shot planned there (8.6).
      const res = resolveAttack(this.table, roller, shot.column, suppressed);
      fired.push({ reactor: shot.reactor, hex: shot.hex, column: shot.column, res });
      if (res.effect === 'destroyed') break;
      if (res.effect === 'suppressed') suppressed = true;
    }
    const exitDowns: SetDown[] = [];
    this.emitShots(d, unit, fired, emit, exitDowns, [exit]);
    this.setDown(d, exitDowns, emit);
  }

  /**
   * What an attack did to a unit (7.7), and what follows: a lost mission
   * (13.4), a lost leader (3.4), and a passenger to set down later (14.6),
   * in the first hex of `where` it may stay in (by default the transport's).
   */
  private hit(d: Draft, unit: number, effect: Effect, emit: Emit, downs: SetDown[], where?: readonly number[]): void {
    if (effect === 'none') return;
    const k = this.missionOf(d, unit);
    if (effect === 'suppressed') {
      emit({ type: 'suppressed', unit });
    } else {
      const passenger = this.passengerOf(d, unit);
      if (passenger >= 0) downs.push({ unit: passenger, hexes: where ?? [(d.units[unit] as UnitState).hex] });
      const f = this.u(unit).formation;
      emit({ type: 'destroyed', unit, cost: this.u(unit).type.cost, leader: this.leaderOf(d, f) === unit });
    }
    if (k >= 0) {
      const m = d.missions[k] as { battery: number; hex: number; kind: MissionKind };
      emit({ type: 'missionLost', battery: m.battery, hex: m.hex, kind: m.kind });
    }
  }

  /** 14.6: passengers set down, Suppressed, where their transports were destroyed (or the last hex passed where they may stay). */
  private setDown(d: Draft, downs: readonly SetDown[], emit: Emit): void {
    for (const s of downs) {
      const side = this.u(s.unit).side;
      let hex = s.hexes[0] as number;
      for (const h of s.hexes) {
        if (this.countAt(d, side, h, s.unit) < this.rules.stack.limit) {
          hex = h;
          break;
        }
      }
      emit({ type: 'setDown', unit: s.unit, hex });
    }
  }

  /** Whether the side has no combat unit left, on the board or carried (15.3). */
  private wiped(p: Position, side: number): boolean {
    return !(this.sideUnits[side] as number[]).some(i => this.alive(p, i) && this.u(i).combat);
  }

  /**
   * 15.3: a side with no combat unit left has lost at once. It is judged when
   * the action that took its last one has been resolved in full, its own
   * bookkeeping included (the activation that ends by itself, the impulse
   * that follows), and before any end phase: a landing lands every mission
   * due first (5.4), whatever has become of either side meanwhile. If both
   * sides are then without a combat unit, both have broken: the higher score
   * as it stands wins, and 15.5 decides a tie (the side that did not have the
   * initiative on turn 1).
   */
  private endIfWiped(d: Draft, emit: Emit): boolean {
    if (d.stage !== 'play') return d.stage === 'over';
    const gone = [this.wiped(d, 0), this.wiped(d, 1)];
    if (!gone[0] && !gone[1]) return false;
    emit({ type: 'ended', winner: gone[0] && gone[1] ? this.higherScore(d) : gone[0] ? 1 : 0, reason: 'break' });
    return true;
  }

  /** The side with the higher score; a tie goes to the side that did not have the initiative on turn 1 (15.5). */
  private higherScore(d: Draft): number {
    const score = (s: number): number => (d.sides[s] as { score: number }).score;
    return score(0) > score(1) ? 0 : score(1) > score(0) ? 1 : 1 - d.firstInitiative;
  }

  /** After a unit's action: the activation ends by itself when no unit is left that could act (5.7). */
  private afterUnitAction(d: Draft, emit: Emit): void {
    if (d.stage !== 'play' || !d.activation) return;
    if (this.anyCanAct(d, d.activation)) return;
    emit({ type: 'activationEnded', side: d.activation.side });
    this.nextImpulse(d, emit);
  }

  /** 5.2: who takes the next impulse, or the end phase. */
  private nextImpulse(d: Draft, emit: Emit): void {
    if (d.stage !== 'play') return;
    const x = d.impulse;
    const y = 1 - x;
    const orders = (s: number): number => (d.sides[s] as { orders: number }).orders;
    const free = this.rules.pass.rule === 'free' && d.sides.every(s => s.orders <= 0 || s.passed);
    const side = free ? -1 : orders(y) > 0 ? y : orders(x) > 0 ? x : -1;
    if (side >= 0) {
      this.startImpulse(d, side, emit);
      return;
    }
    if (this.endIfWiped(d, emit)) return;
    this.endPhase(d, emit);
  }

  /** An impulse begins; missions of the side that has just finished an impulse's opponent become due (13.3). */
  private startImpulse(d: Draft, side: number, emit: Emit): void {
    const finished = d.impulse;
    const due: number[] = [];
    if (d.stage === 'play') for (const m of d.missions) if (!m.due && this.u(m.battery).side !== finished) due.push(m.battery);
    emit({ type: 'impulse', side, orders: (d.sides[side] as { orders: number }).orders, due });
  }

  /**
   * 5.4: every due mission of the side lands, in the order called (13.5,
   * 13.6): all of them, whatever has become of either side meanwhile. The
   * ending is judged only when the landing has been resolved in full (15.3:
   * execute, after this).
   */
  private land(d: Draft, si: number, roller: Roller, emit: Emit): void {
    const dueNow = d.missions.filter(m => m.due && this.u(m.battery).side === si).map(m => m.battery);
    for (const battery of dueNow) {
      const k = this.missionOf(d, battery);
      if (k < 0) continue; // lost to an earlier mission of this landing (13.4)
      const m = d.missions[k] as { battery: number; hex: number; kind: MissionKind };
      if (m.kind === 'smoke') {
        emit({ type: 'missionLanded', battery, hex: m.hex, kind: 'smoke', attacks: [] });
        emit({ type: 'smoke', hex: m.hex, placed: true });
        continue;
      }
      const attacks: Attack[] = [];
      for (let i = 0; i < d.units.length; i++) {
        const u = d.units[i] as UnitState;
        if (u.destroyed || u.hex !== m.hex) continue;
        const column = this.heColumn(d, battery, i);
        const res = resolveAttack(this.table, roller, column, u.suppressed);
        attacks.push({ unit: i, column, rolls: res.rolls, dice: res.dice, result: res.effect });
      }
      emit({ type: 'missionLanded', battery, hex: m.hex, kind: 'he', attacks });
      const downs: SetDown[] = [];
      for (const at of attacks) this.hit(d, at.unit, at.result, emit, downs);
      this.setDown(d, downs, emit);
    }
  }

  /** The end phase (5.8). */
  private endPhase(d: Draft, emit: Emit): void {
    // 1. Objectives change hands (15.1); each side scores (15.2). A carried unit holds nothing (14.4).
    this.objectives.forEach((o, k) => {
      const holding = new Set<number>();
      for (let i = 0; i < d.units.length; i++) {
        const u = d.units[i] as UnitState;
        if (!u.destroyed && u.hex === o.hex && !u.suppressed && this.u(i).combat) holding.add(this.u(i).side);
      }
      if (holding.size === 1) {
        const side = [...holding][0] as number;
        if (d.holders[k] !== side) emit({ type: 'objective', hex: o.hex, holder: side });
      }
    });
    const [kp, kq] = this.killShare;
    for (let s = 0; s < this.seats.length; s++) {
      let objectives = 0;
      this.objectives.forEach((o, k) => { if (d.holders[k] === s) objectives += o.points; });
      const theirs = (d.sides[1 - s] as { lostThisTurn: number[] }).lostThisTurn.reduce((a, b) => a + b, 0);
      const kills = Math.floor((kp * theirs + kq - 1) / kq);
      const total = (d.sides[s] as { score: number }).score + objectives + kills;
      emit({ type: 'scored', side: s, objectives, kills, total });
    }
    // 2. The game ends if a side has won (15.3 to 15.6).
    const ending = this.judge(d);
    if (ending) {
      emit({ type: 'ended', winner: ending.winner, reason: ending.reason });
      return;
    }
    // 3. Smoke comes off. 4. Suppressed units that are not Spent recover.
    for (const h of d.smoke.slice()) emit({ type: 'smoke', hex: h, placed: false });
    for (let i = 0; i < d.units.length; i++) {
      const u = d.units[i] as UnitState;
      if (!u.destroyed && u.suppressed && !u.spent) emit({ type: 'recovered', unit: i });
    }
    // 5 to 7: everyone Ready (under `ready.when: end-phase`; under own-turn the next impulse makes its side Ready, 5.10),
    // old reveals off, the initiative by the policy, orders back, the next turn.
    const policy = this.rules.initiative.policy;
    const next = policy === 'alternate' || (policy === 'bought' && d.bought) ? 1 - d.initiative : d.initiative;
    emit({ type: 'turnEnded', turn: d.turn, initiative: next });
    this.startImpulse(d, next, emit);
  }

  /** Which ending decides at an end phase (15.6): break, then sudden death, then the turn limit. */
  private judge(d: Draft): { winner: number; reason: EndReason } | null {
    const score = (s: number): number => (d.sides[s] as { score: number }).score;
    const higher = (): number => this.higherScore(d);
    const broken = d.sides.map(s => s.startCost > 0 && s.lost >= this.breakShare * s.startCost);
    if (broken[0] || broken[1]) return { winner: broken[0] && broken[1] ? higher() : broken[0] ? 1 : 0, reason: 'break' };
    const lead = score(0) - score(1);
    if (Math.abs(lead) >= this.suddenDeathLead) return { winner: lead > 0 ? 0 : 1, reason: 'sudden death' };
    if (d.turn >= this.lastTurn) return { winner: higher(), reason: 'turn limit' };
    return null;
  }

  // -------------------------------------------------------------------------
  // events onto a state
  // -------------------------------------------------------------------------

  reduce(s: ImpulseState, events: readonly ImpulseEvent[]): ImpulseState {
    const d = draftOf(s);
    for (const e of events) this.reduceOne(d, e);
    return d as ImpulseState;
  }

  private reduceOne(d: Draft, e: ImpulseEvent): void {
    const unit = (i: number): UnitState => {
      const u = d.units[i];
      if (!u) throw new Error(`event ${e.type} names unit ${i}, which does not exist`);
      return u;
    };
    switch (e.type) {
      case 'placed': {
        const placed = d.deployment?.placed[e.side];
        if (!placed) throw new Error('placed: no deployment for that side');
        placed[this.u(e.unit).place] = e.hex ?? -1;
        break;
      }
      case 'submitted': {
        const dep = d.deployment;
        if (!dep) throw new Error('submitted: no deployment');
        if (e.setup) dep.placed[e.side] = (this.sideUnits[e.side] as number[]).map(i => this.u(i).setupHex);
        dep.finished[e.side] = true;
        break;
      }
      case 'deployed':
        e.hexes.forEach((h, i) => { unit(i).hex = h; });
        d.deployment = null;
        d.stage = 'play';
        break;
      case 'impulse':
        d.impulse = e.side;
        d.activation = null;
        for (const m of d.missions) if (e.due.includes(m.battery)) m.due = true;
        // 5.10 (ruling 84): a side's units are made Ready when its own turn begins. Nothing else of them changes here.
        if (this.ownTurnReady) {
          for (const i of this.sideUnits[e.side] as readonly number[]) {
            const u = d.units[i] as UnitState;
            if (u.destroyed) continue;
            u.spent = false;
            u.moved = false;
            u.moveUsed = 0;
          }
        }
        break;
      case 'activated':
        d.activation = {
          kind: e.whole ? 'side' : e.formation !== null ? 'formation' : 'unit', side: e.side,
          formation: e.formation ?? -1, unit: e.unit ?? -1, inCommand: e.inCommand.slice(),
        };
        (d.sides[e.side] as { orders: number }).orders = e.orders;
        if (e.formation !== null) (d.formations[e.formation] as { activated: boolean }).activated = true;
        for (const s of d.sides) s.passed = false;
        break;
      case 'activationEnded':
        d.activation = null;
        break;
      case 'passed': {
        const s = d.sides[e.side] as { orders: number; passed: boolean };
        s.orders = e.orders;
        s.passed = true;
        if (e.buys) d.bought = true;
        break;
      }
      case 'disciplineSet':
        (d.formations[e.formation] as { discipline: Discipline }).discipline = e.setting;
        break;
      case 'moved': {
        const u = unit(e.unit);
        u.hex = e.hex;
        // 6.8: a move that leaves the unit able to act once more leaves it Moved, and records its cost; every other move leaves
        // it Spent (a Moved unit's move on among them, 6.9, which keeps the cost of the first).
        u.moved = e.after === 'moved';
        u.spent = !u.moved;
        if (u.moved) u.moveUsed = e.cost;
        break;
      }
      case 'reaction': {
        const r = unit(e.reactor);
        r.spent = true;
        r.moved = false;
        d.roll += e.rolls.length;
        break;
      }
      case 'fired':
        for (const f of e.firers) {
          unit(f).spent = true;
          unit(f).moved = false;
        }
        d.roll += e.rolls.length;
        break;
      case 'assaulted': {
        const th = unit(e.target).hex;
        for (const i of e.units) {
          unit(i).spent = true;
          unit(i).moved = false;
        }
        for (const i of e.advanced) unit(i).hex = th;
        d.roll += e.rolls.length;
        break;
      }
      case 'overran': {
        const u = unit(e.unit);
        u.hex = e.exit;
        u.spent = true;
        for (const a of e.attacks) d.roll += a.rolls.length;
        break;
      }
      case 'suppressed':
        unit(e.unit).suppressed = true;
        break;
      case 'destroyed': {
        const u = unit(e.unit);
        u.hex = -1;
        u.destroyed = true;
        u.suppressed = false;
        u.spent = false;
        u.moved = false;
        u.moveUsed = 0;
        u.carriedBy = -1;
        u.revealed = 0;
        const s = d.sides[this.u(e.unit).side] as { lost: number; lostThisTurn: number[] };
        s.lost += e.cost;
        s.lostThisTurn.push(e.cost);
        if (e.leader) {
          const f = d.formations[this.u(e.unit).formation] as { leaderLosses: number; commandRange: number | null };
          f.leaderLosses += 1;
          if (f.commandRange !== null) f.commandRange = Math.max(this.rules.command.min, f.commandRange - this.rules.command.lossStep);
        }
        break;
      }
      case 'recovered':
        unit(e.unit).suppressed = false;
        break;
      case 'revealed':
        unit(e.unit).revealed = e.until - 1;
        break;
      case 'mounted': {
        const u = unit(e.unit);
        u.carriedBy = e.transport;
        u.hex = -1;
        u.spent = true;
        break;
      }
      case 'dismounted': {
        const u = unit(e.unit);
        u.carriedBy = -1;
        u.hex = e.hex;
        u.spent = true;
        break;
      }
      case 'setDown': {
        const u = unit(e.unit);
        u.carriedBy = -1;
        u.hex = e.hex;
        u.suppressed = true;
        break;
      }
      case 'missionCalled':
        unit(e.battery).spent = true;
        d.missions.push({ battery: e.battery, hex: e.hex, kind: e.kind, due: false });
        break;
      case 'missionLanded':
        d.missions = d.missions.filter(m => m.battery !== e.battery);
        for (const a of e.attacks) d.roll += a.rolls.length;
        break;
      case 'missionLost':
        d.missions = d.missions.filter(m => m.battery !== e.battery);
        break;
      case 'smoke':
        if (e.placed) {
          if (!d.smoke.includes(e.hex)) d.smoke.push(e.hex);
        } else {
          d.smoke = d.smoke.filter(h => h !== e.hex);
        }
        break;
      case 'objective': {
        const k = this.objectives.findIndex(o => o.hex === e.hex);
        if (k < 0) throw new Error(`objective: hex ${e.hex} is not an objective`);
        d.holders[k] = e.holder;
        break;
      }
      case 'scored':
        (d.sides[e.side] as { score: number }).score = e.total;
        break;
      case 'turnEnded':
        for (const u of d.units) {
          // 5.8.5: every unit made Ready, under `ready.when: end-phase`; under `own-turn` a side's are made Ready when its turn begins (5.10).
          if (!this.ownTurnReady) {
            if (!u.destroyed) u.spent = false;
            u.moved = false;
            u.moveUsed = 0;
          }
          if (u.revealed > 0 && u.revealed < e.turn) u.revealed = 0;
        }
        for (const f of d.formations) f.activated = false;
        d.sides.forEach((s, i) => {
          s.orders = this.ordersPerTurn[i] as number;
          s.passed = false;
          s.lostThisTurn = [];
        });
        d.bought = false;
        d.initiative = e.initiative;
        d.turn = e.turn + 1;
        d.activation = null;
        break;
      case 'ended':
        d.stage = 'over';
        d.result = { winner: e.winner, reason: e.reason };
        d.activation = null;
        break;
    }
  }

  // -------------------------------------------------------------------------
  // exact outcomes and the search interface (17, rulings 5 and 16)
  // -------------------------------------------------------------------------

  /** Every way an action can turn out: the resulting draft and its events, with its weight. Throws for an illegal action. */
  private runs(at: Position, seat: Seat, action: unknown): { state: Draft; events: ImpulseEvent[]; ways: number; of: number; p: number }[] {
    const v = this.validate(at, seat, action);
    if ('code' in v) throw new Error(`not a legal action of ${seat}: ${v.code}: ${v.detail}`);
    const roller = new BranchRoller(at.roll);
    const out: { state: Draft; events: ImpulseEvent[] }[] = [];
    const weights: { ways: number; big: bigint | null; attacks: number }[] = [];
    do {
      roller.reset();
      const d = draftOf(at);
      const events: ImpulseEvent[] = [];
      this.execute(v, d, roller, e => {
        this.reduceOne(d, e);
        events.push(e);
      });
      out.push({ state: d, events });
      weights.push(roller.weight());
    } while (roller.advance());
    const norm = normalise(weights, this.table);
    return out.map((o, i) => ({ ...o, ...(norm[i] as { ways: number; of: number; p: number }) }));
  }

  /**
   * The exact outcome distribution of an action (spec 17), from a state or a
   * view. `result` names what every attack of the action did, in the order of
   * its events (outcomeKey); actions with no attack have one outcome, '-'.
   */
  outcomes(at: ImpulseState | ImpulseView, q: OutcomeQuery): Outcome[] {
    const runs = this.runs(at, q.seat, q.action);
    const byKey = new Map<string, Outcome>();
    for (const r of runs) {
      const key = outcomeKey(r.events);
      const o = byKey.get(key);
      byKey.set(key, o ? { result: key, ways: o.ways + r.ways, of: r.of, p: (o.ways + r.ways) / r.of } : { result: key, ways: r.ways, of: r.of, p: r.p });
    }
    return [...byKey.values()];
  }

  /**
   * The search interface (ruling 16): every way an action of the view's seat
   * can turn out, each with its probability and the seat's view of the
   * position that results, equal views put together. It reads the view
   * alone (after the start a view holds everything) and resolves the action
   * with the code apply uses.
   */
  branches(view: ImpulseView, action: unknown): Branch<ImpulseView>[] {
    if (view.viewer === null) throw new Error('branches: a spectator takes no action');
    const runs = this.runs(view, view.viewer, action);
    const byKey = new Map<string, { ways: number; of: number; view: ImpulseView }>();
    for (const r of runs) {
      const v = this.view(r.state as ImpulseState, view.viewer);
      const key = runs.length === 1 ? '' : serialise(v);
      const o = byKey.get(key);
      if (o) o.ways += r.ways;
      else byKey.set(key, { ways: r.ways, of: r.of, view: v });
    }
    return [...byKey.values()].map(b => ({ ways: b.ways, of: b.of, p: b.ways / b.of, view: b.view }));
  }

  // -------------------------------------------------------------------------
  // the legal list (17)
  // -------------------------------------------------------------------------

  /**
   * Every action the view's seat may take now, read from the view alone.
   * Moves: for each hex a unit can reach, the cheapest path and, where it
   * differs, the least exposed (paths.ts). Close assaults: every set of units
   * that may assault a target together, by the units' cheapest approaches
   * and, where any differs, their least exposed, each with every unit
   * advancing and with none. Overruns: every target hex and every hex beside
   * it from which one is legal, by the cheapest path and, where it differs,
   * the least exposed. Fire: every legal set of firers for every target, but
   * a set for which fewer of the same firers give the same chances.
   */
  legalActions(v: ImpulseView): ImpulseAction[] {
    if (v.viewer === null || v.stage === 'over') return [];
    const si = this.seats.indexOf(v.viewer);
    if (si < 0) return [];
    const pend = this.decidingIn(v);
    if (pend.kind !== 'decide' || !pend.seats.includes(v.viewer)) return [];
    if (v.stage === 'deploy') return this.deployList(v, si);
    if (this.dueOf(v, si)) return [{ type: 'land' }];
    const out: ImpulseAction[] = [];
    const a = v.activation;
    if (!a) {
      if (this.sideProfile) {
        if (this.sideCanAct(v, si)) out.push({ type: 'activateSide' });
      } else {
        for (const f of this.sideFormations[si] as number[]) {
          if (!(v.formations[f] as { activated: boolean }).activated && this.formationCanAct(v, f)) out.push({ type: 'activate', formation: f });
        }
        for (const i of this.sideUnits[si] as number[]) {
          if (this.ready(v, i) && !this.inCommandNow(v, i)) out.push({ type: 'activateUnit', unit: i });
        }
      }
      out.push({ type: 'pass' });
    } else {
      const able = a.inCommand.filter(i => this.couldAct(v, a, i));
      const ctx = this.listContext(v, si);
      const approaches = new Map<number, Approach[][]>();
      for (const i of able) {
        if (this.isCarried(v, i)) {
          this.listDismounts(v, si, i, out);
          continue;
        }
        const t = this.u(i).type;
        // 6.8, 6.9: a Moved unit is offered its moves on within what is left of its allowance, and either its fire (listFire,
        // below) or its close assaults from where it stands (12.1, assault.afterMove), and nothing else.
        const may = this.movedMay(v, i);
        if (may) {
          const pf = may.left > 0 ? this.pathsOf(v, si, i, ctx) : null;
          if (pf) this.listMoves(v, si, i, pf, ctx, out);
          if (may.assault) approaches.set(i, this.assaultApproaches(v, si, i, pf, ctx));
          continue;
        }
        const pf = t.move > 0 ? this.pathsOf(v, si, i, ctx) : null;
        if (pf) this.listMoves(v, si, i, pf, ctx, out);
        if (t.assaults) approaches.set(i, this.assaultApproaches(v, si, i, pf, ctx));
        if (t.overruns && pf) this.listOverruns(v, si, i, pf, ctx, out);
        if (t.rides) this.listMounts(v, si, i, out);
        if (this.u(i).battery) this.listMissions(v, si, i, out);
      }
      this.listAssaults(v, si, approaches, out);
      this.listFire(v, si, able.filter(i => this.firesMoved(v, i)), out);
      out.push({ type: 'end' });
    }
    for (const f of this.sideFormations[si] as number[]) {
      const cur = (v.formations[f] as { discipline: Discipline }).discipline;
      for (const setting of DISCIPLINES) if (setting !== cur) out.push({ type: 'discipline', formation: f, setting });
    }
    return out;
  }

  private deployList(v: Position, si: number): ImpulseAction[] {
    const placed = v.deployment?.placed[si];
    if (!placed || v.deployment?.finished[si] !== false) return [];
    const out: ImpulseAction[] = [];
    const count = new Map<number, number>();
    for (const h of placed) if (h >= 0) count.set(h, (count.get(h) ?? 0) + 1);
    const zone = this.zones[si] as Uint8Array;
    const units = (this.sideUnits[si] as number[]).filter(i => this.u(i).setupCarrier < 0);
    for (const i of units) {
      if ((placed[this.u(i).place] as number) >= 0) continue;
      const enter = this.enterable[this.u(i).mover] as Uint8Array;
      for (let h = 0; h < this.board.n; h++) if (zone[h] === 1 && enter[h] === 1 && (count.get(h) ?? 0) < this.rules.stack.limit) out.push({ type: 'place', unit: i, hex: h });
    }
    for (const i of units) if ((placed[this.u(i).place] as number) >= 0) out.push({ type: 'unplace', unit: i });
    if (units.every(i => (placed[this.u(i).place] as number) >= 0)) out.push({ type: 'submit' });
    out.push({ type: 'takeSetup' });
    return out;
  }

  /** What every list of one position shares: enemy-held hexes (for a combat unit, 14.7's empty transports aside), and the exposure masks (made on first use). */
  private listContext(v: Position, si: number): ListContext {
    const blocked = new Uint8Array(this.board.n);
    const blockedCombat = new Uint8Array(this.board.n);
    for (const i of this.sideUnits[1 - si] as number[]) {
      const u = v.units[i] as UnitState;
      if (u.destroyed || u.hex < 0) continue;
      blocked[u.hex] = 1;
      if (!this.emptyTruck(v, i)) blockedCombat[u.hex] = 1;
    }
    return { blocked, blockedCombat, masks: new Map() };
  }

  private blockedFor(ctx: ListContext, i: number): Uint8Array {
    return this.u(i).combat ? ctx.blockedCombat : ctx.blocked;
  }

  /** Hexes `a` sees within distance d, with the position's smoke. */
  private seenWithin(p: Position, a: number, d: number, mark: Uint8Array): void {
    const list = this.seen.within(a, d);
    mark[a] = 1;
    if (p.smoke.length === 0) {
      for (let k = 0; k < list.length; k++) mark[list[k] as number] = 1;
      return;
    }
    for (let k = 0; k < list.length; k++) {
      const b = list[k] as number;
      if (mark[b] === 1) continue;
      if (this.sees(p, a, b)) mark[b] = 1;
    }
  }

  /**
   * Hexes at which some enemy unit may react to a mover of `side` (8.2, 8.3),
   * judged hex by hex with the mover as it stands when it sets out: its
   * class, whether it is Revealed, and whether it draws fire at all (14.7).
   */
  private exposedMask(p: Position, side: number, cls: 'hard' | 'soft', revealed: boolean, draws: boolean, ctx: ListContext): Uint8Array {
    const key = draws ? `${cls}/${revealed ? 1 : 0}` : 'none';
    const hit = ctx.masks.get(key);
    if (hit) return hit;
    const n = this.board.n;
    const out = new Uint8Array(n);
    if (!draws) {
      ctx.masks.set(key, out);
      return out;
    }
    const react = new Uint8Array(n);
    for (const r of this.sideUnits[1 - side] as number[]) {
      if (this.mayReact(p, r, cls)) this.seenWithin(p, (p.units[r] as UnitState).hex, this.longRange(this.u(r).type.range), react);
    }
    let spotted: Uint8Array | null = null;
    if (!revealed) {
      spotted = new Uint8Array(n);
      for (const e of this.sideUnits[1 - side] as number[]) {
        if (this.watcher(p, e)) this.seenWithin(p, (p.units[e] as UnitState).hex, this.rules.spot.distance, spotted);
      }
    }
    for (let h = 0; h < n; h++) {
      if (react[h] !== 1) continue;
      if (this.conceals[h] !== 1 || revealed || (spotted as Uint8Array)[h] === 1) out[h] = 1;
    }
    ctx.masks.set(key, out);
    return out;
  }

  /** Floods for a unit: the cheapest routes within its allowance (for a Moved unit, what is left of it: 6.9), and the least exposed search. */
  private pathsOf(v: Position, si: number, i: number, ctx: ListContext): PathFacts {
    const mover = this.u(i).mover;
    const allowance = this.allowanceLeft(v, i);
    const u = v.units[i] as UnitState;
    const blocked = this.blockedFor(ctx, i);
    const f = this.search.flood(mover, u.hex, blocked, allowance, this.flood.result);
    const exposed = this.exposedMask(v, si, this.classOf(i), u.revealed > 0, this.drawsFire(v, i), ctx);
    this.exposure.run(mover, u.hex, blocked, exposed, allowance);
    return { mover, allowance, capped: u.moved, start: u.hex, cost: f.cost, from: f.from, exposed, blocked };
  }

  /** The listed approaches to a hex within a cost: the cheapest and, where it is more exposed, the least exposed; or the one-hex path of 6.2. */
  private approachesTo(h: number, limit: number, pf: PathFacts, oneHex: boolean, fr: FloodResult = this.flood.result, ex0: ExposureSearch = this.exposure): Approach[] {
    const c = pf.cost[h] as number;
    if (c >= 0 && c <= limit) {
      const cheap = (routeTo(fr, h) as number[]).slice(1);
      let ex = 0;
      for (const x of cheap) ex += pf.exposed[x] as number;
      const out: Approach[] = [{ end: h, path: cheap, cost: c, exposure: ex }];
      const best = ex0.best(h, limit);
      if (best && best.exposure < ex) out.push({ end: h, path: ex0.route(h, best.cost), cost: best.cost, exposure: best.exposure });
      return out;
    }
    if (!oneHex) return [];
    const dir = this.dirFrom(pf.start, h);
    return [{ end: h, path: [h], cost: (this.board.stepCost[pf.mover] as Int32Array)[pf.start * 6 + dir] as number, exposure: pf.exposed[h] as number }];
  }

  /**
   * The listed approaches to hex h among the paths that enter none of the
   * hexes `avoid` (an overrun's target and exit hex, 6.7 and 12.8; a close
   * assault's target hex, 12.1): spec 17's cheapest and least exposed are of
   * the paths that are legal. The unit's own floods serve while their paths
   * keep out of `avoid`; where one does not, both searches are made again with
   * `avoid` closed, in the second pair of buffers (the first stays the unit's).
   */
  private approachesAvoiding(h: number, limit: number, pf: PathFacts, oneHex: boolean, avoid: readonly number[]): Approach[] {
    const base = this.approachesTo(h, limit, pf, oneHex);
    const bad = (a: Approach): boolean => a.path.some(x => avoid.includes(x));
    if (!base.some(bad)) return base;
    const alt = this.altPaths(pf, avoid);
    const other = this.approachesTo(h, limit, alt, oneHex, this.floodAlt.result, this.exposureAlt);
    const first = base[0] as Approach;
    const cheap = !bad(first) ? first : other[0];
    if (!cheap) return [];
    const least = other[other.length - 1];
    const out: Approach[] = [cheap];
    if (least && least.exposure < cheap.exposure) out.push(least);
    return out;
  }

  /** The unit's floods made again with the hexes `avoid` closed (approachesAvoiding); kept while asked for the same unit's flood and hexes. */
  private altPaths(pf: PathFacts, avoid: readonly number[]): PathFacts {
    const alt = this.floodAlt;
    const key = avoid.join(',');
    if (alt.of === pf && alt.key === key && alt.facts) return alt.facts;
    const blocked = Uint8Array.from(pf.blocked);
    for (const x of avoid) if (x >= 0) blocked[x] = 1;
    const f = this.search.flood(pf.mover, pf.start, blocked, pf.allowance, alt.result);
    this.exposureAlt.run(pf.mover, pf.start, blocked, pf.exposed, pf.allowance);
    alt.of = pf;
    alt.key = key;
    alt.facts = { ...pf, cost: f.cost, from: f.from, blocked };
    return alt.facts;
  }

  /** Whether the 6.2 one-hex step from the start into h is open to the unit (to a Moved unit only where what is left pays for it: 6.9). */
  private oneHexOpen(pf: PathFacts, h: number): boolean {
    if (!this.rules.move.alwaysOne || pf.allowance <= 0) return false;
    const dir = this.dirFrom(pf.start, h);
    if (dir < 0 || pf.blocked[h] === 1) return false;
    const step = (this.board.stepCost[pf.mover] as Int32Array)[pf.start * 6 + dir] as number;
    return step >= 0 && (!pf.capped || step <= pf.allowance);
  }

  private listMoves(v: Position, si: number, i: number, pf: PathFacts, _ctx: ListContext, out: ImpulseAction[]): void {
    const allowance = pf.allowance;
    for (let h = 0; h < this.board.n; h++) {
      if (h === pf.start) continue;
      const one = this.oneHexOpen(pf, h);
      if ((pf.cost[h] as number) < 0 && !one) continue;
      if (this.countAt(v, si, h, i) >= this.rules.stack.limit) continue;
      for (const ap of this.approachesTo(h, allowance, pf, one)) out.push({ type: 'move', unit: i, path: ap.path });
    }
  }

  /** A unit's approaches to every enemy unit it might assault (12.1): per target, its candidate paths to a hex beside it, in a fixed order. */
  private assaultApproaches(v: Position, si: number, i: number, pf: PathFacts | null, ctx: ListContext): Approach[][] {
    const out: Approach[][] = this.unitInfo.map(() => []);
    const start = (v.units[i] as UnitState).hex;
    const share = Math.floor(this.u(i).type.move * this.rules.assault.moveShare);
    const g = this.board.grid;
    const blocked = this.blockedFor(ctx, i);
    for (const t of this.sideUnits[1 - si] as number[]) {
      if (!this.onBoard(v, t) || !this.mayBeAssaulted(t)) continue;
      const th = (v.units[t] as UnitState).hex;
      const list = out[t] as Approach[];
      if (distance(g, start, th) === 1) list.push({ end: start, path: [], cost: 0, exposure: 0 });
      // 12.1: under assault.moveShare 0 a close assault moves no unit: only a unit already beside the target is offered.
      if (pf === null || this.rules.assault.moveShare === 0) continue;
      // A target hex open to the unit's move (14.7: empty transports alone) is kept out of its paths (12.1: validateAssault).
      const avoid = blocked[th] === 1 ? null : [th];
      for (let dd = 0; dd < 6; dd++) {
        const h = this.board.neighbour[th * 6 + dd] as number;
        if (h < 0 || h === start || blocked[h] === 1) continue;
        const one = this.oneHexOpen(pf, h);
        for (const ap of avoid ? this.approachesAvoiding(h, share, pf, one, avoid) : this.approachesTo(h, share, pf, one)) list.push(ap);
      }
    }
    return out;
  }

  /**
   * Close assaults (spec 17): for every target and every set of units that
   * may assault it together, in unit order, once with each unit by its
   * cheapest approach and, if any unit's least exposed approach differs,
   * once with each by its least exposed; each with every unit advancing in
   * the set's order and with none. A unit's approach is chosen among those
   * whose end hex still has room when the units before it in the set have
   * taken theirs (6.4, 12.2), an earlier unit taking its next best where that
   * is what lets a later one in (assemble).
   */
  private listAssaults(v: Position, si: number, approaches: Map<number, Approach[][]>, out: ImpulseAction[]): void {
    const units = [...approaches.keys()].sort((x, y) => x - y);
    if (units.length === 0) return;
    const within = this.rules.support.within;
    for (const t of this.sideUnits[1 - si] as number[]) {
      if (!this.onBoard(v, t) || !this.mayBeAssaulted(t)) continue;
      const cand = units.filter(i => ((approaches.get(i) as Approach[][])[t] as Approach[]).length > 0)
        .map(i => ({ unit: i, col: this.assaultColumn(v, i, t), aps: (approaches.get(i) as Approach[][])[t] as Approach[] }));
      if (cand.length === 0) continue;
      const rec = (startAt: number, cur: number[]): void => {
        if (cur.length > 0) {
          const cols = cur.map(k => (cand[k] as { col: number }).col);
          const best = Math.max(...cols);
          // Outside the window no superset is inside it (adding a unit never lowers the best).
          if (!cols.every(c => c >= best - within)) return;
          if (this.table.canSuppress(best + this.assaultSupport(cols.length))) this.pushAssaults(v, si, t, cur.map(k => cand[k] as AssaultCandidate), out);
        }
        for (let k = startAt; k < cand.length; k++) {
          cur.push(k);
          rec(k + 1, cur);
          cur.pop();
        }
      };
      rec(0, []);
    }
  }

  /**
   * A set of units that may assault a target together, listed (spec 17, and
   * the lead's ruling 69): in the first order of its units that is legal,
   * orders tried in the order of the units' numbers. Unit order is tried
   * first; only a set that fits in no choice of approaches in unit order is
   * searched for another order (firstOrder).
   */
  private pushAssaults(v: Position, si: number, target: number, set: readonly AssaultCandidate[], out: ImpulseAction[]): void {
    if (!this.roomFor(v, si, set)) return;
    const byCost = (a: Approach, b: Approach): number => a.cost - b.cost;
    let ordered = set;
    let cheap = this.assemble(v, si, ordered, byCost);
    if (!cheap && set.length > 1) {
      const other = this.firstOrder(v, si, set);
      if (!other) return;
      ordered = other;
      cheap = this.assemble(v, si, ordered, byCost);
    }
    const least = this.assemble(v, si, ordered, (a, b) => a.exposure - b.exposure || a.cost - b.cost);
    const variants: AssaultUnit[][] = [];
    if (cheap) variants.push(cheap);
    if (least && (!cheap || JSON.stringify(least) !== JSON.stringify(cheap))) variants.push(least);
    const order = ordered.map(c => c.unit);
    for (const units of variants) {
      for (const advance of [order, []]) {
        const action: ImpulseAction = { type: 'assault', units, target, advance: advance.slice() };
        const r = this.validateAssault(v, si, action);
        if (!('code' in r)) out.push(action);
      }
    }
  }

  /**
   * Each unit of a set by an approach whose end hex has room once the units
   * before it in the set have made theirs (6.4, 12.2), in the set's order: the
   * first unit by its best approach under `by` with which every later unit can
   * still be given one, then the second likewise, and so on. This is the
   * choice of each unit in turn by its best approach, going back on an earlier
   * unit's choice only where a later unit would otherwise have none (a unit
   * beside the target in a full hex steps to another hex beside it so that the
   * next may take its place). Only the end hex of an approach bears on room, so
   * each unit tries its best approach to each end hex. Null when nothing fits.
   */
  private assemble(v: Position, si: number, set: readonly AssaultCandidate[], by: (a: Approach, b: Approach) => number): AssaultUnit[] | null {
    const limit = this.rules.stack.limit;
    const options = set.map(c => {
      const sorted = c.aps.map((a, k) => ({ a, k })).sort((x, y) => by(x.a, y.a) || x.k - y.k);
      const ends = new Set<number>();
      const out: Approach[] = [];
      for (const { a } of sorted) {
        if (ends.has(a.end)) continue;
        ends.add(a.end);
        out.push(a);
      }
      return out;
    });
    const starts = set.map(c => (v.units[c.unit] as UnitState).hex);
    const delta = new Map<number, number>();
    const add = (h: number, n: number): void => { delta.set(h, (delta.get(h) ?? 0) + n); };
    const chosen: Approach[] = [];
    const failed = new Set<string>();
    const place = (k: number): boolean => {
      if (k === set.length) return true;
      const key = `${k}|${[...delta].filter(([, n]) => n !== 0).sort((x, y) => x[0] - y[0]).map(([h, n]) => `${h}:${n}`).join(',')}`;
      if (failed.has(key)) return false;
      const unit = (set[k] as AssaultCandidate).unit;
      for (const a of options[k] as Approach[]) {
        const moves = a.path.length > 0;
        if (moves && this.countAt(v, si, a.end, unit) + (delta.get(a.end) ?? 0) >= limit) continue;
        if (moves) {
          add(a.end, 1);
          add(starts[k] as number, -1);
        }
        chosen.push(a);
        if (place(k + 1)) return true;
        chosen.pop();
        if (moves) {
          add(a.end, -1);
          add(starts[k] as number, 1);
        }
      }
      failed.add(key);
      return false;
    };
    if (!place(0)) return null;
    return chosen.map((a, k) => ({ unit: (set[k] as AssaultCandidate).unit, path: a.path.slice() }));
  }

  /**
   * Whether the hexes the units of a set could end in have room for them all
   * (11.1): a set too large for them fits in no order, and is not searched.
   * Each unit ends where one of its approaches ends (where it stands, for the
   * empty path); a hex ends with no more of the set's units than the stacking
   * limit leaves beside the other units there, or than stand in it already
   * and may stay.
   */
  private roomFor(v: Position, si: number, set: readonly AssaultCandidate[]): boolean {
    const limit = this.rules.stack.limit;
    const here = new Map<number, number>();
    const stay = new Map<number, number>();
    const ends = new Set<number>();
    for (const c of set) {
      const start = (v.units[c.unit] as UnitState).hex;
      here.set(start, (here.get(start) ?? 0) + 1);
      for (const a of c.aps) {
        ends.add(a.end);
        if (a.path.length === 0) stay.set(start, (stay.get(start) ?? 0) + 1);
      }
    }
    let room = 0;
    for (const h of ends) room += Math.max(limit - (this.countAt(v, si, h, -1) - (here.get(h) ?? 0)), stay.get(h) ?? 0, 0);
    return set.length <= room;
  }

  /**
   * The first order of a set's units in which they may assault together, the
   * orders taken in the order of the units' numbers (the lead's ruling 69), or
   * null when no order fits. An order fits when each unit in turn can be given
   * an approach whose end hex has room once the units before it have made
   * theirs (6.4, 12.2); only the end hex of an approach bears on that, and
   * only the hexes beside the target are ended in.
   *
   * What bounds the search. It never walks the orders one by one. A position
   * of the search is which units have been given an approach and how many
   * units each hex beside the target has gained or lost by them; `open`
   * answers once for each such position whether the units left can still all
   * be given one, in any order. The order is then built from the front: at
   * each place the lowest-numbered unit left with which some position reached
   * so far stays open. So the work is at most (positions) x (units) x (end
   * hexes of a unit), and the positions number at most the product, over the
   * set's units, of one more than each unit's end hexes (seven at most: where
   * it stands, and the six hexes beside the target): never the factorial of
   * the set's size. It runs only for a set that fits in no way in unit order,
   * and after roomFor has turned away a set too large for the hexes.
   */
  private firstOrder(v: Position, si: number, set: readonly AssaultCandidate[]): AssaultCandidate[] | null {
    const limit = this.rules.stack.limit;
    const n = set.length;
    // The end hexes that are moved into, numbered; a unit's start bears on room only if it is one of them.
    const slot = new Map<number, number>();
    const options: { end: number; base: number }[][] = [];
    const startSlot: number[] = [];
    for (const c of set) {
      const seen = new Set<number>();
      const list: { end: number; base: number }[] = [];
      for (const a of c.aps) {
        const moves = a.path.length > 0;
        const key = moves ? a.end : -1;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!moves) {
          list.push({ end: -1, base: 0 });
          continue;
        }
        if (!slot.has(a.end)) slot.set(a.end, slot.size);
        list.push({ end: slot.get(a.end) as number, base: this.countAt(v, si, a.end, c.unit) });
      }
      options.push(list);
    }
    for (const c of set) startSlot.push(slot.get((v.units[c.unit] as UnitState).hex) ?? -1);
    const full = (1 << n) - 1;
    const keyOf = (mask: number, delta: readonly number[]): string => `${mask}|${delta.join(',')}`;
    /** The positions that giving unit j an approach leads to from one position. */
    const step = (j: number, delta: readonly number[]): number[][] => {
      const out: number[][] = [];
      for (const o of options[j] as { end: number; base: number }[]) {
        if (o.end < 0) {
          out.push(delta as number[]);
          continue;
        }
        if (o.base + (delta[o.end] as number) >= limit) continue;
        const next = delta.slice();
        next[o.end] = (next[o.end] as number) + 1;
        const from = startSlot[j] as number;
        if (from >= 0) next[from] = (next[from] as number) - 1;
        out.push(next);
      }
      return out;
    };
    const known = new Map<string, boolean>();
    const open = (mask: number, delta: readonly number[]): boolean => {
      if (mask === full) return true;
      const key = keyOf(mask, delta);
      const hit = known.get(key);
      if (hit !== undefined) return hit;
      let ok = false;
      for (let j = 0; j < n && !ok; j++) {
        if ((mask & (1 << j)) !== 0) continue;
        for (const next of step(j, delta)) {
          if (open(mask | (1 << j), next)) {
            ok = true;
            break;
          }
        }
      }
      known.set(key, ok);
      return ok;
    };
    const none = new Array<number>(slot.size).fill(0);
    if (!open(0, none)) return null;
    const order: number[] = [];
    let mask = 0;
    let reached = new Map<string, readonly number[]>([[keyOf(0, none), none]]);
    while (order.length < n) {
      let placed = false;
      for (let j = 0; j < n && !placed; j++) {
        if ((mask & (1 << j)) !== 0) continue;
        const after = new Map<string, readonly number[]>();
        for (const delta of reached.values()) {
          for (const next of step(j, delta)) if (open(mask | (1 << j), next)) after.set(keyOf(mask | (1 << j), next), next);
        }
        if (after.size === 0) continue;
        order.push(j);
        mask |= 1 << j;
        reached = after;
        placed = true;
      }
      if (!placed) return null;
    }
    return order.map(j => set[j] as AssaultCandidate);
  }

  /** Overruns (spec 17): every target hex and every hex beside it from which one is legal, by the cheapest path and, where it differs, the least exposed. */
  private listOverruns(v: Position, si: number, i: number, pf: PathFacts, _ctx: ListContext, out: ImpulseAction[]): void {
    const targets = new Set<number>();
    for (const e of this.sideUnits[1 - si] as number[]) {
      const eu = v.units[e] as UnitState;
      if (!eu.destroyed && eu.hex >= 0 && this.overrunGround[eu.hex] === 1) targets.add(eu.hex);
    }
    const steps = this.board.stepCost[pf.mover] as Int32Array;
    const nb = this.board.neighbour;
    const room = pf.allowance - this.rules.overrun.cost;
    for (const T of [...targets].sort((x, y) => x - y)) {
      for (let dd = 0; dd < 6; dd++) {
        const h = nb[T * 6 + dd] as number;
        if (h < 0) continue;
        const dir = (dd + 3) % 6;
        const exit = nb[T * 6 + dir] as number;
        if (exit < 0) continue;
        const c1 = steps[h * 6 + dir] as number;
        const c2 = steps[T * 6 + dir] as number;
        if (c1 < 0 || c2 < 0) continue;
        const paths: number[][] = [];
        if (h === pf.start) paths.push([]);
        else if (pf.blocked[h] !== 1) for (const ap of this.approachesAvoiding(h, room - c1 - c2, pf, false, [T, exit])) paths.push(ap.path);
        for (const path of paths) {
          const action: ImpulseAction & { type: 'overrun' } = { type: 'overrun', unit: i, path, target: T };
          if (this.checkOverrun(v, si, action) === null) out.push(action);
        }
      }
    }
  }

  private listMounts(v: Position, si: number, i: number, out: ImpulseAction[]): void {
    for (const t of this.sideUnits[si] as number[]) {
      if (!this.u(t).transport || t === i) continue;
      const action: ImpulseAction & { type: 'mount' } = { type: 'mount', unit: i, transport: t };
      if (this.checkMount(v, si, action) === null) out.push(action);
    }
  }

  private listDismounts(v: Position, si: number, i: number, out: ImpulseAction[]): void {
    const th = (v.units[(v.units[i] as UnitState).carriedBy] as UnitState).hex;
    const hexes = [th];
    for (let dd = 0; dd < 6; dd++) {
      const h = this.board.neighbour[th * 6 + dd] as number;
      if (h >= 0) hexes.push(h);
    }
    for (const hex of hexes) {
      const action: ImpulseAction & { type: 'dismount' } = { type: 'dismount', unit: i, hex };
      if (this.checkDismount(v, si, action) === null) out.push(action);
    }
  }

  private dirFrom(a: number, b: number): number {
    if (a < 0) return -1;
    for (let d = 0; d < 6; d++) if (this.board.neighbour[a * 6 + d] === b) return d;
    return -1;
  }

  private listMissions(v: Position, si: number, i: number, out: ImpulseAction[]): void {
    const ind = this.u(i).type.indirect;
    if (!ind) return;
    const n = this.board.n;
    const obs = new Uint8Array(n);
    for (const o of this.sideUnits[si] as number[]) if (this.watcher(v, o)) this.seenWithin(v, (v.units[o] as UnitState).hex, n, obs);
    const g = this.board.grid;
    const from = (v.units[i] as UnitState).hex;
    const range = this.u(i).type.range;
    for (let h = 0; h < n; h++) {
      if (obs[h] !== 1) continue;
      const d = distance(g, from, h);
      if (d > range || d < ind.minRange) continue;
      for (const kind of MISSION_KINDS) out.push({ type: 'mission', unit: i, hex: h, kind });
    }
  }

  private listFire(v: Position, si: number, able: readonly number[], out: ImpulseAction[]): void {
    const shooters = able.filter(i => !this.isCarried(v, i) && !this.u(i).battery);
    if (shooters.length === 0) return;
    for (const t of this.sideUnits[1 - si] as number[]) {
      if (!this.onBoard(v, t)) continue;
      const tu = v.units[t] as UnitState;
      if (!this.mayBeFiredAt(v, 1 - si, tu.hex, tu.revealed > 0)) continue;
      const cls = this.classOf(t);
      const cand: { unit: number; col: number }[] = [];
      for (const f of shooters) {
        if (this.firepower(f, cls) <= 0) continue;
        if (!this.sees(v, (v.units[f] as UnitState).hex, tu.hex)) continue;
        const col = this.ownColumn(v, f, t, tu.hex);
        if (col !== null) cand.push({ unit: f, col });
      }
      if (cand.length === 0) continue;
      const within = this.rules.support.within;
      const ways = (cols: number[]): string => {
        const best = Math.max(...cols);
        const w = this.table.ways(best + this.support(cols.length), tu.suppressed);
        return `${w.none}/${w.suppressed}/${w.destroyed}`;
      };
      // Every subset, in a fixed order: by size, then by the candidates' order.
      const sets: number[][] = [];
      const n = cand.length;
      const colsOf = (idx: number[]): number[] => idx.map(k => (cand[k] as { col: number }).col);
      const inWindow = (cols: number[]): boolean => {
        const best = Math.max(...cols);
        return cols.every(c => c >= best - within);
      };
      const legal = (cols: number[]): boolean => inWindow(cols) && this.table.canSuppress(Math.max(...cols) + this.support(cols.length));
      // The chances at the highest column any set of these candidates could reach: the best own column with every candidate's support.
      // A column never falls when a firer is added (no support step is below 0), and the chances never fall with the column.
      const w = this.table.ways(Math.max(...cand.map(c => c.col)) + this.support(n), tu.suppressed);
      const most = `${w.none}/${w.suppressed}/${w.destroyed}`;
      const rec = (startAt: number, cur: number[]): void => {
        if (cur.length > 0) {
          const cols = colsOf(cur);
          // Outside the window no superset is inside it (adding a firer never lowers the best).
          if (!inWindow(cols)) return;
          const column = Math.max(...cols) + this.support(cols.length);
          if (this.table.canSuppress(column)) {
            // Left out when a set of one firer fewer gives the same chances; were any smaller set to, so would one of one fewer
            // (the column grows with every firer added, and the chances with the column).
            const mine = ways(cols);
            let dominated = false;
            for (let drop = 0; drop < cur.length && cur.length > 1 && !dominated; drop++) {
              const sub = colsOf(cur.filter((_, j) => j !== drop));
              if (legal(sub) && ways(sub) === mine) dominated = true;
            }
            if (!dominated) sets.push(cur.slice());
            // No larger set can do more than this one does: every superset has these chances, and this set as a subset of it.
            // (Not "its effect is the same on every roll": a set certain to suppress may leave a larger one a chance to
            // destroy, where the table's two thresholds lie further apart than the dice reach.)
            if (mine === most) return;
          }
        }
        for (let k = startAt; k < n; k++) {
          cur.push(k);
          rec(k + 1, cur);
          cur.pop();
        }
      };
      rec(0, []);
      sets.sort((a, b) => a.length - b.length);
      for (const s of sets) out.push({ type: 'fire', firers: s.map(k => (cand[k] as { unit: number }).unit), target: t });
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
    const keys = EVENT_KEYS[t as keyof typeof EVENT_KEYS];
    const e = c.record(t, raw, keys);
    if (!e) return c.problems;
    const nU = this.unitInfo.length;
    const nH = this.board.n;
    const at = (k: string): unknown => c.at(e, k);
    const unit = (k: string): void => { c.int(`${t}.${k}`, at(k), 0, nU - 1); };
    const hex = (k: string): void => { c.int(`${t}.${k}`, at(k), 0, nH - 1); };
    const side = (k: string): void => { c.int(`${t}.${k}`, at(k), 0, this.seats.length - 1); };
    const bool = (k: string): void => { c.bool(`${t}.${k}`, at(k)); };
    const int = (k: string, lo: number, hi: number): void => { c.int(`${t}.${k}`, at(k), lo, hi); };
    const units = (k: string, min: number): void => {
      const l = c.list(`${t}.${k}`, at(k), min, nU);
      l?.forEach((x, i) => c.int(`${t}.${k}[${i + 1}]`, x, 0, nU - 1));
    };
    const rolled = (place: string, obj: Record<string, unknown>): void => {
      const rolls = c.list(`${place}.rolls`, c.at(obj, 'rolls'), 0, this.table.count);
      rolls?.forEach((r, i) => c.int(`${place}.rolls[${i + 1}]`, r, 0, Number.MAX_SAFE_INTEGER));
      const faces = c.list(`${place}.dice`, c.at(obj, 'dice'), 0, this.table.count);
      faces?.forEach((f, i) => c.int(`${place}.dice[${i + 1}]`, f, 1, this.table.faces));
      if (rolls && faces && rolls.length !== faces.length) c.add(place, 'rolls and dice must be the same length');
      if (rolls && rolls.length !== 0 && rolls.length !== this.table.count) c.add(`${place}.rolls`, `must hold no roll or ${this.table.count}`);
      c.oneOf(`${place}.result`, c.at(obj, 'result'), EFFECTS, 'result');
      c.int(`${place}.column`, c.at(obj, 'column'), -999, 999);
    };
    const attacks = (k: string): void => {
      const l = c.list(`${t}.${k}`, at(k), 0, nU);
      l?.forEach((a, i) => {
        const place = `${t}.${k}[${i + 1}]`;
        const v = c.record(place, a, ['unit', 'column', 'rolls', 'dice', 'result']);
        if (!v) return;
        c.int(`${place}.unit`, c.at(v, 'unit'), 0, nU - 1);
        rolled(place, v);
      });
    };
    switch (t) {
      case 'placed': {
        side('side'); unit('unit');
        const h = at('hex');
        if (h !== null) hex('hex');
        break;
      }
      case 'submitted': side('side'); bool('setup'); break;
      case 'deployed': {
        const l = c.list('deployed.hexes', at('hexes'), nU, nU);
        l?.forEach((h, i) => c.int(`deployed.hexes[${i + 1}]`, h, -1, nH - 1));
        break;
      }
      case 'impulse': side('side'); int('orders', 0, 99); units('due', 0); break;
      case 'activated': {
        side('side'); bool('whole'); units('inCommand', 0); int('orders', 0, 99);
        if (at('formation') !== null) int('formation', 0, this.formationInfo.length - 1);
        if (at('unit') !== null) unit('unit');
        break;
      }
      case 'activationEnded': side('side'); break;
      case 'passed': side('side'); int('orders', 0, 99); bool('buys'); break;
      case 'disciplineSet': int('formation', 0, this.formationInfo.length - 1); c.oneOf('disciplineSet.setting', at('setting'), DISCIPLINES, 'setting'); break;
      case 'moved': {
        unit('unit'); bool('stopped'); hex('hex'); int('cost', 0, 9999); c.oneOf('moved.after', at('after'), ['moved', 'spent'], 'state after a move');
        const l = c.list('moved.path', at('path'), 1, nH);
        l?.forEach((h, i) => c.int(`moved.path[${i + 1}]`, h, 0, nH - 1));
        break;
      }
      case 'reaction': unit('reactor'); unit('mover'); hex('hex'); rolled(t, e); break;
      case 'fired': units('firers', 1); unit('target'); rolled(t, e); break;
      case 'assaulted': units('units', 1); unit('target'); units('advanced', 0); rolled(t, e); break;
      case 'overran': unit('unit'); hex('target'); hex('exit'); attacks('attacks'); break;
      case 'suppressed': case 'recovered': unit('unit'); break;
      case 'mounted': unit('unit'); unit('transport'); break;
      case 'dismounted': case 'setDown': unit('unit'); hex('hex'); break;
      case 'destroyed': unit('unit'); int('cost', 0, 9999); bool('leader'); break;
      case 'revealed': unit('unit'); int('until', 2, 999); break;
      case 'missionCalled': case 'missionLost':
        unit('battery'); hex('hex'); c.oneOf(`${t}.kind`, at('kind'), MISSION_KINDS, 'kind');
        break;
      case 'missionLanded':
        unit('battery'); hex('hex'); c.oneOf('missionLanded.kind', at('kind'), MISSION_KINDS, 'kind');
        attacks('attacks');
        break;
      case 'smoke': hex('hex'); bool('placed'); break;
      case 'objective': hex('hex'); side('holder'); break;
      case 'scored': side('side'); int('objectives', 0, 99999); int('kills', 0, 99999); int('total', 0, 999999); break;
      case 'turnEnded': int('turn', 1, 999); side('initiative'); break;
      case 'ended': side('winner'); c.oneOf('ended.reason', at('reason'), END_REASONS, 'reason'); break;
    }
    return c.problems;
  }

  // -------------------------------------------------------------------------
  // invariants
  // -------------------------------------------------------------------------

  invariants(s: ImpulseState): string[] {
    const out: string[] = [];
    const nU = this.unitInfo.length;
    if (s.format !== 'impulse/1') out.push(`format is ${JSON.stringify(s.format)}`);
    if (!['deploy', 'play', 'over'].includes(s.stage)) out.push(`unknown stage ${JSON.stringify(s.stage)}`);
    if (!Number.isInteger(s.turn) || s.turn < 1 || s.turn > this.lastTurn) out.push(`turn ${s.turn} is outside 1 to ${this.lastTurn}`);
    for (const k of ['initiative', 'firstInitiative', 'impulse'] as const) {
      if (s[k] !== 0 && s[k] !== 1) out.push(`${k} ${s[k]} is not a side`);
    }
    if (!Number.isInteger(s.roll) || s.roll < 0) out.push(`broken roll count ${s.roll}`);
    if ((s.stage === 'over') !== (s.result !== null)) out.push(s.stage === 'over' ? 'the game is over with no result' : 'a result is set but the game is not over');
    if ((s.stage === 'deploy') !== (s.deployment !== null)) out.push('a deployment record outside the deployment, or none during it');
    if (s.activation && s.stage !== 'play') out.push('an activation is open outside play');
    if (s.activation && s.activation.side !== s.impulse) out.push('the open activation is not the side whose impulse it is');
    if (s.activation) for (const i of s.activation.inCommand) if (this.unitInfo[i]?.side !== s.activation.side) out.push(`unit ${i} in command for the other side's activation`);

    // Units, hexes, transport and stacking.
    if (s.units.length !== nU) out.push(`${s.units.length} units, the scenario has ${nU}`);
    const perHex = new Map<number, number[]>();
    const carriers = new Map<number, number>();
    s.units.forEach((u, i) => {
      const at = `unit ${i} (${this.unitInfo[i]?.id ?? '?'})`;
      if (!Number.isInteger(u.hex) || u.hex < -1 || u.hex >= this.board.n) out.push(`${at}: off the board at hex ${u.hex}`);
      if (!Number.isInteger(u.carriedBy) || u.carriedBy < -1 || u.carriedBy >= nU) out.push(`${at}: carried by ${u.carriedBy}, which is no unit`);
      const carried = u.carriedBy >= 0;
      if (u.destroyed) {
        if (u.hex !== -1) out.push(`${at}: destroyed but still on the board at hex ${u.hex}`);
        if (u.suppressed || u.spent || u.moved) out.push(`${at}: destroyed but still Suppressed, Spent or Moved`);
        if (carried) out.push(`${at}: destroyed but still carried`);
      } else if (s.stage !== 'deploy' && u.hex < 0 && !carried) {
        out.push(`${at}: in play but neither on the board nor carried`);
      }
      if (s.stage === 'deploy' && u.hex !== -1) out.push(`${at}: on the board before the reveal`);
      if (typeof u.moved !== 'boolean') out.push(`${at}: moved is not true or false`);
      if (u.moved && u.spent) out.push(`${at}: Moved and Spent at once (6.8)`);
      if (u.moved && (carried || u.hex < 0)) out.push(`${at}: Moved but not on the board (6.8)`);
      if (u.moved && i < nU && this.shortMove(i) === null && !this.assaultsAfterMove(i)) out.push(`${at}: Moved, but no move leaves a unit of its type Moved (6.8, moveFire.class, assault.afterMove)`);
      if (!Number.isInteger(u.moveUsed) || u.moveUsed < 0 || (i < nU && u.moveUsed > (this.unitInfo[i] as UnitInfo).type.move)) out.push(`${at}: moveUsed ${u.moveUsed} is outside 0 to its allowance`);
      else if (u.moveUsed > 0 && (u.destroyed || (!u.moved && !u.spent))) out.push(`${at}: moveUsed ${u.moveUsed}, yet it is ${u.destroyed ? 'destroyed' : 'Ready'} (6.8)`);
      else if (u.moved && i < nU && !this.leavesMoved(i, u.moveUsed)) out.push(`${at}: Moved, but a move of cost ${u.moveUsed} leaves it Spent (6.8)`);
      if (carried && u.carriedBy < nU) {
        const t = this.unitInfo[u.carriedBy];
        const tu = s.units[u.carriedBy];
        if (u.hex !== -1) out.push(`${at}: carried, yet it has a hex (${u.hex})`);
        if (u.suppressed) out.push(`${at}: carried, yet Suppressed (14.4)`);
        if (!this.unitInfo[i]?.type.rides) out.push(`${at}: carried, but its type does not ride`);
        if (!t || !t.transport) out.push(`${at}: carried by unit ${u.carriedBy}, which cannot carry`);
        else if (t.side !== this.unitInfo[i]?.side) out.push(`${at}: carried by unit ${u.carriedBy}, an enemy unit`);
        if (tu && tu.destroyed && !u.destroyed) out.push(`${at}: carried by unit ${u.carriedBy}, which has been destroyed`);
        if (tu && tu.carriedBy >= 0) out.push(`${at}: carried by unit ${u.carriedBy}, which is itself carried`);
        if (!u.destroyed) {
          const other = carriers.get(u.carriedBy);
          if (other !== undefined) out.push(`${at}: carried by unit ${u.carriedBy}, which already carries unit ${other}`);
          carriers.set(u.carriedBy, i);
        }
      }
      if (!Number.isInteger(u.revealed) || u.revealed < 0 || u.revealed > s.turn) out.push(`${at}: revealed on turn ${u.revealed}, at turn ${s.turn}`);
      if (!u.destroyed && u.hex >= 0) {
        const l = perHex.get(u.hex) ?? [];
        l.push(i);
        perHex.set(u.hex, l);
      }
    });
    for (const [h, ids] of perHex) {
      const sides = new Set(ids.map(i => this.unitInfo[i]?.side));
      if (sides.size > 1) out.push(`hex ${labelOf(this.board.grid, h)} holds units of both sides`);
      if (ids.length > this.rules.stack.limit) out.push(`hex ${labelOf(this.board.grid, h)} holds ${ids.length} units, over stack.limit ${this.rules.stack.limit}`);
    }

    // Formations.
    const member = new Array<number>(nU).fill(0);
    s.formations.forEach((f, k) => {
      const plain = f.units.filter(i => !this.unitInfo[i]?.transport).length;
      if (plain > 5) out.push(`formation ${k}: ${plain} units that are not transports, more than five (3.1)`);
      for (const i of f.units) {
        if (i >= 0 && i < nU) member[i] = (member[i] as number) + 1;
        if (this.unitInfo[i]?.formation !== k) out.push(`formation ${k} lists unit ${i}, which the scenario puts elsewhere`);
      }
      const min = this.rules.command.min;
      if (f.commandRange !== null && f.commandRange < min) out.push(`formation ${k}: command range ${f.commandRange} is below command.min ${min}`);
      const r = this.rules.command.range;
      const expect = r === NONE ? null : Math.max(min, r - this.rules.command.lossStep * f.leaderLosses);
      if (f.commandRange !== expect) out.push(`formation ${k}: command range ${String(f.commandRange)} after ${f.leaderLosses} leader losses, expected ${String(expect)}`);
      if (!DISCIPLINES.includes(f.discipline)) out.push(`formation ${k}: unknown discipline ${JSON.stringify(f.discipline)}`);
    });
    member.forEach((m, i) => { if (m !== 1) out.push(`unit ${i} is in ${m} formations`); });

    // Sides.
    s.sides.forEach((x, i) => {
      const most = this.ordersPerTurn[i] as number;
      if (!Number.isInteger(x.orders) || x.orders < 0 || x.orders > most) out.push(`side ${i}: ${x.orders} orders, outside 0 to ${most}`);
      if (x.lost < 0 || x.score < 0) out.push(`side ${i}: negative losses or score`);
      const destroyed = (this.sideUnits[i] as number[]).filter(u => s.units[u]?.destroyed).reduce((a, u) => a + (this.unitInfo[u] as UnitInfo).type.cost, 0);
      if (x.lost < destroyed) out.push(`side ${i}: ${x.lost} lost, but its destroyed units cost ${destroyed}`);
      if (x.lostThisTurn.reduce((a, b) => a + b, 0) > x.lost) out.push(`side ${i}: lost more this turn than in all`);
    });
    if (s.stage === 'play') {
      for (let side = 0; side < this.seats.length; side++) {
        if (!(this.sideUnits[side] as number[]).some(i => !s.units[i]?.destroyed && this.unitInfo[i]?.combat)) out.push(`side ${side} has no combat unit left, but the game is not over (15.3)`);
      }
    }

    // Missions, smoke, objectives.
    const batteries = new Set<number>();
    for (const m of s.missions) {
      const b = this.unitInfo[m.battery];
      if (!b || !b.battery) out.push(`a mission of unit ${m.battery}, which is not a battery`);
      if (batteries.has(m.battery)) out.push(`battery ${m.battery} has two missions`);
      batteries.add(m.battery);
      const u = s.units[m.battery];
      if (u && (u.destroyed || u.suppressed)) out.push(`battery ${m.battery} has a mission but is destroyed or Suppressed`);
      if (!this.board.has(m.hex)) out.push(`a mission on hex ${m.hex}, off the board`);
    }
    for (const h of s.smoke) if (!this.board.has(h)) out.push(`smoke on hex ${h}, off the board`);
    if (new Set(s.smoke).size !== s.smoke.length) out.push('a smoke hex listed twice');
    if (s.holders.length !== this.objectives.length) out.push(`${s.holders.length} objective holders for ${this.objectives.length} objectives`);
    for (const h of s.holders) if (h !== -1 && h !== 0 && h !== 1) out.push(`objective holder ${h} is not a side`);
    if (s.deployment) {
      s.deployment.placed.forEach((l, i) => {
        if (!l || l.length !== (this.sideUnits[i] as number[]).length) {
          out.push(`side ${i}: placements do not match its units`);
          return;
        }
        l.forEach((h, k) => {
          const unitIndex = (this.sideUnits[i] as number[])[k] as number;
          if (h !== -1 && (this.zones[i] as Uint8Array)[h] !== 1) out.push(`side ${i}: a placement outside its zone`);
          if (h !== -1 && this.unitInfo[unitIndex]?.setupCarrier !== -1) out.push(`side ${i}: unit ${unitIndex} starts carried but is placed`);
        });
      });
    }
    return out;
  }

  /** Labels for messages and tests. */
  label(h: number): string {
    return labelOf(this.board.grid, h);
  }

  hexOfLabel(label: string): number {
    return hexOf(gridOf(this.board.grid), label);
  }
}

/** Fire's or a close assault's support for `n` units (7.4, 12.3): the steps in turn, the last repeating. */
function supportOf(steps: readonly number[], n: number): number {
  let s = 0;
  for (let k = 1; k < n; k++) s += steps[Math.min(k - 1, steps.length - 1)] as number;
  return s;
}

/** A unit's floods, for the legal list: the cheapest routes (the path search's result buffer) and the exposure search. */
interface PathFacts {
  readonly mover: number;
  /** The allowance the floods were made within: the unit's, or for a Moved unit what is left of it (6.9). */
  readonly allowance: number;
  /** A Moved unit's floods: 6.2's one hex only where `allowance` pays for it (6.9). */
  readonly capped: boolean;
  readonly start: number;
  readonly cost: Int32Array;
  readonly from: Int32Array;
  readonly exposed: Uint8Array;
  readonly blocked: Uint8Array;
}

/** One way to a hex (for the legal list): its path, cost and the exposed hexes it enters. */
interface Approach {
  readonly end: number;
  readonly path: number[];
  readonly cost: number;
  readonly exposure: number;
}

interface AssaultCandidate {
  readonly unit: number;
  readonly col: number;
  readonly aps: readonly Approach[];
}

interface ListContext {
  readonly blocked: Uint8Array;
  readonly blockedCombat: Uint8Array;
  readonly masks: Map<string, Uint8Array>;
}

const EVENT_KEYS = {
  placed: ['type', 'side', 'unit', 'hex'],
  submitted: ['type', 'side', 'setup'],
  deployed: ['type', 'hexes'],
  impulse: ['type', 'side', 'orders', 'due'],
  activated: ['type', 'side', 'formation', 'unit', 'whole', 'inCommand', 'orders'],
  activationEnded: ['type', 'side'],
  passed: ['type', 'side', 'orders', 'buys'],
  disciplineSet: ['type', 'formation', 'setting'],
  moved: ['type', 'unit', 'path', 'stopped', 'hex', 'cost', 'after'],
  reaction: ['type', 'reactor', 'mover', 'hex', 'column', 'rolls', 'dice', 'result'],
  fired: ['type', 'firers', 'target', 'column', 'rolls', 'dice', 'result'],
  assaulted: ['type', 'units', 'target', 'column', 'rolls', 'dice', 'result', 'advanced'],
  overran: ['type', 'unit', 'target', 'exit', 'attacks'],
  suppressed: ['type', 'unit'],
  destroyed: ['type', 'unit', 'cost', 'leader'],
  recovered: ['type', 'unit'],
  revealed: ['type', 'unit', 'until'],
  mounted: ['type', 'unit', 'transport'],
  dismounted: ['type', 'unit', 'hex'],
  setDown: ['type', 'unit', 'hex'],
  missionCalled: ['type', 'battery', 'hex', 'kind'],
  missionLanded: ['type', 'battery', 'hex', 'kind', 'attacks'],
  missionLost: ['type', 'battery', 'hex', 'kind'],
  smoke: ['type', 'hex', 'placed'],
  objective: ['type', 'hex', 'holder'],
  scored: ['type', 'side', 'objectives', 'kills', 'total'],
  turnEnded: ['type', 'turn', 'initiative'],
  ended: ['type', 'winner', 'reason'],
} as const satisfies Record<string, readonly string[]>;

/** An action with exactly its keys, as plain data (the caller's object stays the caller's). */
function plainAction(type: ActionType, raw: Record<string, unknown>): ImpulseAction {
  const out: Record<string, unknown> = { type };
  for (const k of ACTION_KEYS[type]) {
    if (k === 'type') continue;
    const v = raw[k];
    if (k === 'units') out[k] = (v as { unit: number; path: number[] }[]).map(x => ({ unit: x.unit, path: x.path.slice() }));
    else out[k] = Array.isArray(v) ? v.slice() : v;
  }
  return out as unknown as ImpulseAction;
}

/**
 * How an outcome's `result` is read off the events of an apply: the effect of
 * every attack, in the order of the events (each `reaction`, `fired`,
 * `assaulted`, each attack of each `overran` and of each `missionLanded`),
 * joined by ' / '; '-' when the action made no attack.
 */
export function outcomeKey(events: readonly ImpulseEvent[]): string {
  const parts: string[] = [];
  for (const e of events) {
    if (e.type === 'reaction') parts.push(`reaction ${e.reactor}: ${e.result}`);
    else if (e.type === 'fired') parts.push(`fire: ${e.result}`);
    else if (e.type === 'assaulted') parts.push(`assault: ${e.result}`);
    else if (e.type === 'overran') for (const a of e.attacks) parts.push(`overrun on ${a.unit}: ${a.result}`);
    else if (e.type === 'missionLanded') for (const a of e.attacks) parts.push(`mission ${e.battery} on ${a.unit}: ${a.result}`);
  }
  return parts.length === 0 ? '-' : parts.join(' / ');
}

// ---------------------------------------------------------------------------
// copies and the hash text
// ---------------------------------------------------------------------------

/** A deep copy of a position's fields. */
function copyPosition(s: Position): Omit<Draft, 'format'> {
  return {
    stage: s.stage,
    turn: s.turn,
    initiative: s.initiative,
    firstInitiative: s.firstInitiative,
    impulse: s.impulse,
    roll: s.roll,
    bought: s.bought,
    activation: s.activation
      ? { kind: s.activation.kind, side: s.activation.side, formation: s.activation.formation, unit: s.activation.unit, inCommand: s.activation.inCommand.slice() }
      : null,
    units: s.units.map(u => ({ hex: u.hex, destroyed: u.destroyed, spent: u.spent, moved: u.moved, moveUsed: u.moveUsed, suppressed: u.suppressed, carriedBy: u.carriedBy, revealed: u.revealed })),
    formations: s.formations.map(f => ({ units: f.units.slice(), discipline: f.discipline, leaderLosses: f.leaderLosses, commandRange: f.commandRange, activated: f.activated })),
    sides: s.sides.map(x => ({ orders: x.orders, score: x.score, lost: x.lost, lostThisTurn: x.lostThisTurn.slice(), startCost: x.startCost, passed: x.passed })),
    missions: s.missions.map(m => ({ battery: m.battery, hex: m.hex, kind: m.kind, due: m.due })),
    smoke: s.smoke.slice(),
    holders: s.holders.slice(),
    deployment: s.deployment ? { placed: s.deployment.placed.map(l => (l ? l.slice() : null)), finished: s.deployment.finished.slice() } : null,
    result: s.result ? { winner: s.result.winner, reason: s.result.reason } : null,
  };
}

function draftOf(s: Position): Draft {
  return { ...copyPosition(s), format: 'impulse/1' } as Draft;
}

const b = (x: boolean | null): string => (x === null ? 'n' : x ? '1' : '0');

/**
 * The text a state's hash is taken over: every field, in a fixed order, each
 * list with its length, so that no two states share a text. A unit is its
 * hex, its flags (destroyed, Spent, Moved, Suppressed), what its move that
 * left it Moved cost, the transport that carries it and its latest reveal.
 */
export function serialise(s: Position & { readonly format: string; readonly viewer?: string | null }): string {
  const parts: string[] = [s.format, s.stage, String(s.turn), String(s.initiative), String(s.firstInitiative), String(s.impulse), String(s.roll), b(s.bought)];
  if ('viewer' in s) parts.push(`v${JSON.stringify(s.viewer)}`);
  const a = s.activation;
  parts.push(a ? `a${a.kind},${a.side},${a.formation},${a.unit},${a.inCommand.length}:${a.inCommand.join(',')}` : 'a-');
  parts.push(`u${s.units.length}`);
  for (const u of s.units) parts.push(`${u.hex},${b(u.destroyed)}${b(u.spent)}${b(u.moved)}${b(u.suppressed)},${u.moveUsed},${u.carriedBy},${u.revealed}`);
  parts.push(`f${s.formations.length}`);
  for (const f of s.formations) parts.push(`${f.units.length}:${f.units.join(',')},${f.discipline},${f.leaderLosses},${f.commandRange === null ? 'n' : f.commandRange},${b(f.activated)}`);
  parts.push(`s${s.sides.length}`);
  for (const x of s.sides) parts.push(`${x.orders},${x.score},${x.lost},${x.lostThisTurn.length}:${x.lostThisTurn.join(',')},${x.startCost},${b(x.passed)}`);
  parts.push(`m${s.missions.length}`);
  for (const m of s.missions) parts.push(`${m.battery},${m.hex},${m.kind},${b(m.due)}`);
  parts.push(`k${s.smoke.length}:${s.smoke.join(',')}`);
  parts.push(`o${s.holders.length}:${s.holders.join(',')}`);
  const d = s.deployment;
  if (d) {
    parts.push(`d${d.placed.length}`);
    for (const l of d.placed) parts.push(l === null ? 'n' : `${l.length}:${l.join(',')}`);
    parts.push(d.finished.map(b).join(''));
  } else {
    parts.push('d-');
  }
  parts.push(s.result ? `r${s.result.winner},${s.result.reason}` : 'r-');
  return parts.join('|');
}

/** A copy of an event that shares no object with it. */
function copyEvent(e: ImpulseEvent): ImpulseEvent {
  return JSON.parse(JSON.stringify(e)) as ImpulseEvent;
}
