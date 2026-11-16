/**
 * The Formation Impulse ruleset's state, view, actions and events
 * (docs/rules/rules-v1.md, sections 17 and 18). All are plain data.
 *
 * Numbering. Units are numbered from 0 in the order of spec 2.4 (the first
 * side's formations in order, each formation's units in order, then the
 * second side's): a unit's index is its spec unit number less one, so "the
 * lower unit number" is "the lower index". Formations are numbered from 0 in
 * the same order, sides 0 and 1 in the scenario's order. Hexes are hex
 * numbers (engine/core/hex.ts: row * cols + col); -1 means "not on the
 * board". Seats are the scenario's side ids; nothing here names a side.
 */

export type Stage = 'deploy' | 'play' | 'over';
export type Discipline = 'free' | 'armor' | 'hold';
export const DISCIPLINES: readonly Discipline[] = ['free', 'armor', 'hold'];
export type MissionKind = 'he' | 'smoke';
export const MISSION_KINDS: readonly MissionKind[] = ['he', 'smoke'];
/** What an attack did to its target (7.7, after a second suppression became a destruction). */
export type Effect = 'none' | 'suppressed' | 'destroyed';
export const EFFECTS: readonly Effect[] = ['none', 'suppressed', 'destroyed'];
export type EndReason = 'break' | 'sudden death' | 'turn limit';
export const END_REASONS: readonly EndReason[] = ['break', 'sudden death', 'turn limit'];

export interface UnitState {
  /** Hex number, or -1 when not on the board (destroyed, carried, or not yet shown in a free deployment). */
  hex: number;
  destroyed: boolean;
  spent: boolean;
  /**
   * Moved (2.3, 6.8): the unit has made a move this turn that left it able to act once more, and is not Spent. Of two kinds
   * (6.8): after a short move a unit of `moveFire.class` may fire once (in an activation of its own side or in reaction); after
   * a move that left any of its allowance unused a unit that can close assault may make one close assault (12.1,
   * `assault.afterMove`). Either may instead move on with what is left of its allowance (6.9). Never true together with
   * `spent`; false again when it acts, reacts or is destroyed, and at the end phase.
   */
  moved: boolean;
  /**
   * The cost of the move that left the unit Moved this turn (6.8, 6.9); 0 when it has made none. Kept when the unit then acts
   * (it is Spent), cleared when it is destroyed and at the end phase.
   */
  moveUsed: number;
  suppressed: boolean;
  /** The transport that carries the unit (14.4), or -1. A carried unit has no hex. */
  carriedBy: number;
  /** The turn of the unit's latest reveal (9.4), or 0 when it is not Revealed. */
  revealed: number;
}

export interface FormationState {
  /** The units of the formation, in the scenario's order (static; kept so the state can be checked whole). */
  units: number[];
  discipline: Discipline;
  /** How many times the formation has lost its leader (3.4). */
  leaderLosses: number;
  /** The command range now (3.3, 3.4), or null when `command.range` is none. */
  commandRange: number | null;
  /** Activated this turn (5.5). */
  activated: boolean;
}

export interface SideState {
  /** Orders left this turn (5.3). */
  orders: number;
  score: number;
  /** The total cost of the side's units destroyed so far (15.3). */
  lost: number;
  /** The costs of the side's units destroyed this turn, one by one (15.2). */
  lostThisTurn: number[];
  /** The side's starting cost (15.3). */
  startCost: number;
  /** `pass.rule: free`: the side has passed since the last activation (5.5). */
  passed: boolean;
}

export interface MissionState {
  battery: number;
  hex: number;
  kind: MissionKind;
  /** Due (13.3): the other side has finished an impulse since it was called. */
  due: boolean;
}

export interface ActivationState {
  /** 'formation' (activate), 'unit' (activateUnit) or 'side' (activateSide). */
  kind: 'formation' | 'unit' | 'side';
  side: number;
  /** The formation activated, or -1. */
  formation: number;
  /** The unit activated alone, or -1. */
  unit: number;
  /** The units in command for this activation, measured when it was opened (3.3), in index order. */
  inCommand: number[];
}

/** Free deployment (4.2): each side's placements, by the side's own units in order (-1: not placed). */
export interface DeploymentState {
  /** Per side: the hex chosen for each of its units (in the side's unit order), -1 when not placed. Null in a view: hidden. */
  placed: (number[] | null)[];
  /** Per side: finished. Null in a view: hidden. */
  finished: (boolean | null)[];
}

export interface ResultState {
  /** The winning side's index. */
  winner: number;
  reason: EndReason;
}

/** The fields a state and a view share: everything the rules read. */
export interface Position {
  readonly stage: Stage;
  readonly turn: number;
  /** The side holding the initiative this turn. */
  readonly initiative: number;
  /** The side that had the initiative on turn 1 (15.5). */
  readonly firstInitiative: number;
  /** The side whose impulse it is. */
  readonly impulse: number;
  /** The number of the next die roll. */
  readonly roll: number;
  /** `initiative.policy: bought`: the side without the initiative has bought it this turn (5.1). */
  readonly bought: boolean;
  readonly activation: ActivationState | null;
  readonly units: readonly UnitState[];
  readonly formations: readonly FormationState[];
  readonly sides: readonly SideState[];
  /** Waiting missions, in the order they were called. */
  readonly missions: readonly MissionState[];
  /** Smoke hexes, in the order they were placed. */
  readonly smoke: readonly number[];
  /** Per objective of the scenario, in its order: the holding side, or -1. */
  readonly holders: readonly number[];
  readonly deployment: DeploymentState | null;
  readonly result: ResultState | null;
}

export interface ImpulseState extends Position {
  readonly format: 'impulse/1';
}

/** What a seat (or a spectator, viewer null) sees: the state, but the other side's free-deployment placements. */
export interface ImpulseView extends Position {
  readonly format: 'impulse-view/1';
  /** The seat this view is for, or null for a spectator. The only field in which the views differ after the start. */
  readonly viewer: string | null;
}

// ---------------------------------------------------------------------------
// actions (spec 17)
// ---------------------------------------------------------------------------

/** One unit of a close assault (12.1): the unit and its path (the hexes entered; empty when it is beside the target already). */
export interface AssaultUnit {
  readonly unit: number;
  readonly path: readonly number[];
}

export type ImpulseAction =
  | { readonly type: 'place'; readonly unit: number; readonly hex: number }
  | { readonly type: 'unplace'; readonly unit: number }
  | { readonly type: 'submit' }
  | { readonly type: 'takeSetup' }
  | { readonly type: 'land' }
  | { readonly type: 'activate'; readonly formation: number }
  | { readonly type: 'activateUnit'; readonly unit: number }
  | { readonly type: 'activateSide' }
  | { readonly type: 'pass' }
  | { readonly type: 'discipline'; readonly formation: number; readonly setting: Discipline }
  | { readonly type: 'fire'; readonly firers: readonly number[]; readonly target: number }
  | { readonly type: 'move'; readonly unit: number; readonly path: readonly number[] }
  | { readonly type: 'assault'; readonly units: readonly AssaultUnit[]; readonly target: number; readonly advance: readonly number[] }
  | { readonly type: 'overrun'; readonly unit: number; readonly path: readonly number[]; readonly target: number }
  | { readonly type: 'mount'; readonly unit: number; readonly transport: number }
  | { readonly type: 'dismount'; readonly unit: number; readonly hex: number }
  | { readonly type: 'mission'; readonly unit: number; readonly hex: number; readonly kind: MissionKind }
  | { readonly type: 'end' };

export type ActionType = ImpulseAction['type'];

export const ACTION_TYPES: readonly ActionType[] = [
  'place', 'unplace', 'submit', 'takeSetup', 'land', 'activate', 'activateUnit', 'activateSide', 'pass', 'discipline',
  'fire', 'move', 'assault', 'overrun', 'mount', 'dismount', 'mission', 'end',
];

/** The keys of each action, `type` included: no other key is accepted. */
export const ACTION_KEYS: Readonly<Record<ActionType, readonly string[]>> = {
  place: ['type', 'unit', 'hex'],
  unplace: ['type', 'unit'],
  submit: ['type'],
  takeSetup: ['type'],
  land: ['type'],
  activate: ['type', 'formation'],
  activateUnit: ['type', 'unit'],
  activateSide: ['type'],
  pass: ['type'],
  discipline: ['type', 'formation', 'setting'],
  fire: ['type', 'firers', 'target'],
  move: ['type', 'unit', 'path'],
  assault: ['type', 'units', 'target', 'advance'],
  overrun: ['type', 'unit', 'path', 'target'],
  mount: ['type', 'unit', 'transport'],
  dismount: ['type', 'unit', 'hex'],
  mission: ['type', 'unit', 'hex', 'kind'],
  end: ['type'],
};

// ---------------------------------------------------------------------------
// events (spec 18)
// ---------------------------------------------------------------------------

/** One attack on one unit: of a landing mission (13.5) or of an overrun (12.9). */
export interface Attack {
  readonly unit: number;
  readonly column: number;
  readonly rolls: readonly number[];
  readonly dice: readonly number[];
  readonly result: Effect;
}

/** One attack of a landing mission (the name round 1 gave it). */
export type MissionAttack = Attack;

export type ImpulseEvent =
  /** A free-deployment placement (hex) or its undoing (hex null). Seen only by its own side. */
  | { readonly type: 'placed'; readonly side: number; readonly unit: number; readonly hex: number | null }
  /** A side has finished its free deployment; `setup` when it took the scenario's set-up. Seen only by its own side. */
  | { readonly type: 'submitted'; readonly side: number; readonly setup: boolean }
  /** Both sides have finished: every unit's hex, by unit index. */
  | { readonly type: 'deployed'; readonly hexes: readonly number[] }
  /** An impulse begins; `due`: the batteries whose missions became due as it began (13.3). */
  | { readonly type: 'impulse'; readonly side: number; readonly orders: number; readonly due: readonly number[] }
  /** An order spent on an activation: a formation, a unit alone, or the whole side; who is in command for it. */
  | {
    readonly type: 'activated'; readonly side: number; readonly formation: number | null; readonly unit: number | null;
    readonly whole: boolean; readonly inCommand: readonly number[]; readonly orders: number;
  }
  /** The open activation is over (by `end`, or because no unit is left that could act, 5.7). */
  | { readonly type: 'activationEnded'; readonly side: number }
  /** A pass; `orders`: what the side holds after it; `buys`: it buys the initiative (5.1 bought). */
  | { readonly type: 'passed'; readonly side: number; readonly orders: number; readonly buys: boolean }
  | { readonly type: 'disciplineSet'; readonly formation: number; readonly setting: Discipline }
  /** A move: the hexes actually entered, whether it was stopped, the hex it stands in after (8.6 may put it back), the cost of the path entered. */
  | { readonly type: 'moved'; readonly unit: number; readonly path: readonly number[]; readonly stopped: boolean; readonly hex: number; readonly cost: number; readonly after: 'moved' | 'spent' }
  | {
    readonly type: 'reaction'; readonly reactor: number; readonly mover: number; readonly hex: number; readonly column: number;
    readonly rolls: readonly number[]; readonly dice: readonly number[]; readonly result: Effect;
  }
  | {
    readonly type: 'fired'; readonly firers: readonly number[]; readonly target: number; readonly column: number;
    readonly rolls: readonly number[]; readonly dice: readonly number[]; readonly result: Effect;
  }
  /**
   * A close assault (12.3 to 12.6): `units` the units that arrived and assaulted, in the assault's order; `result` the
   * effect on the target (on 'none' every unit of `units` is Suppressed, by `suppressed` events); `advanced` the units
   * that entered the target's hex, in the order they entered (12.5).
   */
  | {
    readonly type: 'assaulted'; readonly units: readonly number[]; readonly target: number; readonly column: number;
    readonly rolls: readonly number[]; readonly dice: readonly number[]; readonly result: Effect; readonly advanced: readonly number[];
  }
  /**
   * An overrun (12.9 to 12.11): the unit has entered the target hex and attacked each enemy Soft unit there, in unit
   * order; it now stands in the exit hex, Spent. Each attack's effect follows as `suppressed` or `destroyed` events.
   */
  | { readonly type: 'overran'; readonly unit: number; readonly target: number; readonly exit: number; readonly attacks: readonly Attack[] }
  | { readonly type: 'suppressed'; readonly unit: number }
  /** A unit leaves play; `cost` is added to its side's losses; `leader` when it led its formation (3.4). */
  | { readonly type: 'destroyed'; readonly unit: number; readonly cost: number; readonly leader: boolean }
  | { readonly type: 'recovered'; readonly unit: number }
  /** A unit is Revealed until the end of turn `until` (9.4). */
  | { readonly type: 'revealed'; readonly unit: number; readonly until: number }
  /** A unit mounts a transport (14.2): it leaves the board, carried, Spent. */
  | { readonly type: 'mounted'; readonly unit: number; readonly transport: number }
  /** A carried unit dismounts into a hex (14.5): on the board again, Spent. Reaction shots at that hex follow. */
  | { readonly type: 'dismounted'; readonly unit: number; readonly hex: number }
  /** The passenger of a transport just destroyed is set down in a hex, Suppressed (14.6). */
  | { readonly type: 'setDown'; readonly unit: number; readonly hex: number }
  | { readonly type: 'missionCalled'; readonly battery: number; readonly hex: number; readonly kind: MissionKind }
  | { readonly type: 'missionLanded'; readonly battery: number; readonly hex: number; readonly kind: MissionKind; readonly attacks: readonly MissionAttack[] }
  | { readonly type: 'missionLost'; readonly battery: number; readonly hex: number; readonly kind: MissionKind }
  | { readonly type: 'smoke'; readonly hex: number; readonly placed: boolean }
  | { readonly type: 'objective'; readonly hex: number; readonly holder: number }
  | { readonly type: 'scored'; readonly side: number; readonly objectives: number; readonly kills: number; readonly total: number }
  /** The end phase's steps 5 to 7: `turn` is the turn that ended, `initiative` the side holding it next. */
  | { readonly type: 'turnEnded'; readonly turn: number; readonly initiative: number }
  | { readonly type: 'ended'; readonly winner: number; readonly reason: EndReason };

export type EventType = ImpulseEvent['type'];

export const EVENT_TYPES: readonly EventType[] = [
  'placed', 'submitted', 'deployed', 'impulse', 'activated', 'activationEnded', 'passed', 'disciplineSet', 'moved', 'reaction',
  'fired', 'assaulted', 'overran', 'suppressed', 'destroyed', 'recovered', 'revealed', 'mounted', 'dismounted', 'setDown',
  'missionCalled', 'missionLanded', 'missionLost', 'smoke', 'objective', 'scored', 'turnEnded', 'ended',
];

// ---------------------------------------------------------------------------
// outcomes and the preview
// ---------------------------------------------------------------------------

/** What the kernel's `outcomes` is asked about: one action of one seat. */
export interface OutcomeQuery {
  readonly seat: string;
  readonly action: unknown;
}

/** One planned reaction shot (8.4, 8.5), as the preview shows it (8.8). */
export interface PlannedShot {
  readonly reactor: number;
  /** The index in the plan's path of the hex it fires at (0 is the first hex entered). */
  readonly step: number;
  readonly hex: number;
  /** The column, the modifier included. */
  readonly column: number;
  /** The ways (of `of`) of any effect, and of a destruction. */
  readonly effect: number;
  readonly destroy: number;
  readonly of: number;
}

/**
 * The reaction plan of one mover (8.8): every shot it will draw if none stops it, in firing order. `path` is
 * the hexes it enters: a move's path; one path of a close assault; a dismount's one hex; an overrun's path, then
 * the target hex (never fired at, 12.10), then the exit hex (its shots come after the attacks).
 */
export interface ReactionPlan {
  readonly unit: number;
  readonly path: readonly number[];
  readonly shots: readonly PlannedShot[];
}

/** One way an action can turn out (ruling 16). */
export interface Branch<V> {
  readonly ways: number;
  readonly of: number;
  readonly p: number;
  readonly view: V;
}
