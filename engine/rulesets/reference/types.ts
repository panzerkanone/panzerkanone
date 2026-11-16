/**
 * The reference ruleset's state, view, actions and events. All are plain data
 * (JSON), and the state holds nothing per hex: the board is static content,
 * referenced by the map's id and content hash.
 *
 * Units are numbered from 0 in force order, the first side's units first; a
 * unit's id is its index in `units`. Sides are numbered 0 and 1 in order of
 * play; seats are the scenario's side ids. Hexes are hex numbers
 * (engine/core/hex.ts: row * cols + col), -1 for "not on the board".
 */

export type Stage = 'setup' | 'play' | 'over';

export interface UnitState {
  readonly id: number;
  /** Unit type id (ruleset data). */
  readonly type: string;
  /** Side index. */
  readonly side: number;
  /** Hex number, or -1 when the unit is not on the board (not yet revealed, or destroyed). */
  readonly hex: number;
  readonly destroyed: boolean;
  readonly suppressed: boolean;
  /** Has acted this player-turn (declared fire, held, or moved). */
  readonly spent: boolean;
  /** The unit it has declared fire on this gunnery phase, or -1. */
  readonly target: number;
}

export interface SideState {
  /** Set-up only: the hexes chosen so far for this side's units, in force order. Hidden from the other side. */
  readonly placed: readonly number[];
  readonly submitted: boolean;
  readonly score: number;
  /** How many of this side's units have been destroyed. */
  readonly losses: number;
}

export interface RefResult {
  /** Side index of the winner, or -1 for a draw. */
  readonly winner: number;
  readonly reason: string;
}

export interface RefState {
  readonly format: 'reference/1';
  readonly map: { readonly id: string; readonly hash: string };
  readonly stage: Stage;
  readonly turn: number;
  /** The side whose player-turn it is (0 during set-up). */
  readonly side: number;
  /** The current phase of the player-turn ('' during set-up and after the end). */
  readonly phase: string;
  /** The number of the next die roll. */
  readonly roll: number;
  readonly units: readonly UnitState[];
  readonly sides: readonly SideState[];
  readonly result: RefResult | null;
}

export interface SideView {
  /** The side's set-up placements, only in its own seat's view; null when hidden. */
  readonly placed: readonly number[] | null;
  readonly submitted: boolean;
  readonly score: number;
  readonly losses: number;
}

/** What a seat (or a spectator) sees. Everything on the map is visible once play starts (PLAN R3). */
export interface RefView {
  readonly format: 'reference-view/1';
  /** The viewer's side index, or -1 for a spectator. */
  readonly viewer: number;
  readonly map: { readonly id: string; readonly hash: string };
  readonly stage: Stage;
  readonly turn: number;
  readonly side: number;
  readonly phase: string;
  readonly units: readonly UnitState[];
  readonly sides: readonly SideView[];
  readonly result: RefResult | null;
}

export type RefAction =
  | { readonly type: 'place'; readonly unit: number; readonly hex: number }
  | { readonly type: 'submit' }
  | { readonly type: 'fire'; readonly unit: number; readonly target: number }
  | { readonly type: 'hold'; readonly unit: number }
  | { readonly type: 'move'; readonly unit: number; readonly path: readonly number[] }
  | { readonly type: 'end' };

export const ACTION_TYPES = ['place', 'submit', 'fire', 'hold', 'move', 'end'] as const;

export type AttackResult = 'destroyed' | 'suppressed' | 'none';
export const ATTACK_RESULTS: readonly AttackResult[] = ['destroyed', 'suppressed', 'none'];

export type RefEvent =
  /** A set-up placement: seen only by its own side. */
  | { readonly type: 'placed'; readonly side: number; readonly unit: number; readonly hex: number }
  | { readonly type: 'submitted'; readonly side: number }
  /** Both sides have submitted: every unit's hex, by unit id. */
  | { readonly type: 'revealed'; readonly hexes: readonly number[] }
  /** A phase begins; `fresh` when it opens a player-turn (that side's units are ready again). */
  | { readonly type: 'phase_begun'; readonly turn: number; readonly side: number; readonly phase: string; readonly fresh: boolean }
  | { readonly type: 'declared'; readonly unit: number; readonly target: number }
  | { readonly type: 'held'; readonly unit: number }
  /** A move: the hexes entered, in order, and their total cost. */
  | { readonly type: 'moved'; readonly unit: number; readonly path: readonly number[]; readonly cost: number }
  /** One attack resolved: the roll numbers used and their faces, and the result. */
  | {
    readonly type: 'attack'; readonly target: number; readonly attackers: readonly number[];
    readonly attack: number; readonly defense: number; readonly column: number;
    readonly rolls: readonly number[]; readonly dice: readonly number[]; readonly result: AttackResult;
  }
  | { readonly type: 'recovered'; readonly unit: number }
  | { readonly type: 'scored'; readonly side: number; readonly hex: number; readonly points: number }
  | { readonly type: 'ended'; readonly winner: number; readonly reason: string };

export const EVENT_TYPES = ['placed', 'submitted', 'revealed', 'phase_begun', 'declared', 'held', 'moved', 'attack', 'recovered', 'scored', 'ended'] as const;

/** An attack to ask the outcome distribution of: the attackers together against one target. */
export interface AttackQuery {
  readonly attackers: readonly number[];
  readonly target: number;
}

/** The reasons a game ends. */
export const END_REASONS = ['broken', 'turn-limit'] as const;
