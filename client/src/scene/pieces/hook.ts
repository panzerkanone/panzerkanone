/**
 * What the pieces add to `window.__table` (the page's hook, ../hook.ts), for
 * checks and for the rules later. Types only.
 *
 * Positions are in the board frame, in h. A counter's id is the one it was set
 * up with; a hex is the one hex number of engine/core/hex.
 */
import type { CueReadings } from './cues';
import type { PieceReading, TrayReading } from './pieces';
import type { PiecesPort } from './port';
import type { DiceReading } from '../dice/dice';

export type { CueReadings } from './cues';
export type { DiceReading } from '../dice/dice';
export type { PieceReading, TrayReading } from './pieces';

export interface PhysicsHook {
  /** Whether the engine has been loaded (it is, at the first physical gesture, and never before). */
  readonly loaded: boolean;
  /** How many times the engine was asked for (0 until a physical gesture; then 1). */
  readonly loads: number;
  /** Counters that are free bodies now (loose, or at home and stirred), and how many of them are awake. */
  readonly bodies: number;
  readonly awake: number;
  /** Fixed steps (1/120 s) taken since the engine was loaded. */
  readonly steps: number;
  /** Milliseconds the last fixed step took, and the mean of the last 120. */
  readonly stepMs: { last: number; mean: number };
  /** Where the fingertip is, or null when it is up. */
  readonly finger: [number, number, number] | null;
  /** Load the engine now (a check's way; play loads it at the first physical gesture). */
  load(): Promise<void>;
  /** Advance n fixed steps with no drawing. */
  step(n: number): void;
  /**
   * A scripted push: the fingertip goes down at `from` on the plan, travels straight to `to` in
   * `seconds` of the physics' own time, and lifts. With no `z` its underside starts on the surface
   * there (board or table) and keeps that height, as a fingertip put down beside a counter does.
   * With a `z` it starts at that height and rests on whatever is under it, pressed (a fingertip put
   * down on a counter's top); or, `held`, it keeps that height (one set against a counter's side).
   */
  push(from: [number, number], to: [number, number], seconds: number, z?: number, held?: boolean): void;
  /** Poke a counter at a point of the plan (its middle unless given): it hops, and skids away from that side. */
  poke(id: string, at?: [number, number]): void;
  /** Take a counter in hand (with what lies on it), at a point of it or at its middle. */
  grab(id: string, at?: [number, number, number]): void;
  /** Carry what is in hand to a point in `seconds` of the physics' time, and then let go (the default) or hold. */
  carry(to: [number, number, number], seconds: number, then?: 'release' | 'hold'): void;
  /** Let go of what is in hand. */
  release(): void;
  /** Bump the table. */
  bump(): void;
}

export interface PiecesHook {
  /** Every counter: where its home is, where it is, and how it stands. */
  readonly pieces: PieceReading[];
  /** The selected counter's id, or null. */
  readonly selected: string | null;
  /** Regular play's move, as a click would give it: the counter's home becomes the hex. Resolves when it has settled. */
  order(id: string, hex: number): Promise<void>;
  /** What Space does: everything loose goes home. Returns how many set off. */
  home(): number;
  /** What R does: the whole set-up back to its first homes. */
  reset(): void;
  physics: PhysicsHook;
  /** What a game drives the pieces through. */
  piecesPort: PiecesPort;
  /**
   * Draw the chosen counter and Spent in another of their treatments (dims.ts: `MARK_LOOK`), to show them side by side;
   * returns the treatments drawn now. `chosen`: today, lift, outline, all; `spent`: today, grey, turn, mark.
   */
  markLook(look: { chosen?: 'today' | 'lift' | 'outline' | 'all'; spent?: 'today' | 'grey' | 'turn' | 'mark' }): { chosen: string; spent: string };
  /**
   * Plain clicks the counters have reported since load: to a game's `onClick` handlers, or to the table's own toy
   * when there are none. A click made with Shift, Ctrl or Cmd held counts as any other; one with Alt (a poke) does not.
   */
  readonly clicks: number;
  /**
   * What the game of orders shows besides the counters, as it stands: every line of fire (declared attacks, and the
   * port's threats with where each one's tag lies and how large it is), every route, every marker with where it lies.
   * `shown` runs from 0 to 1 as a thing eases in; `leaving` is one that is no longer in its set and is easing out.
   */
  readonly cues: CueReadings;
  /** How many counters there are, the textures the pieces hold, and anything the page wants said (why there is no set-up, for one). */
  readonly piecesInfo: { counters: number; textures: { count: number; bytes: number }; note: string };
  /**
   * The counter tray: where it stands and what lies in each of its wells, from the bottom. Null until its art has
   * been handed to the table (and for good when none is): a destroyed counter is then flicked away as before.
   */
  readonly tray: TrayReading | null;
  /** The dice in the tray's felt well (../dice): how they lie, and a throw for a check. */
  readonly dice: DiceHook;
}

export interface DiceHook {
  /** The roll last thrown, how it was shown, the faces the dice show now, and the inset. */
  readonly reading: DiceReading;
  /**
   * Throw these faces as a game shows a roll: pointed out and thrown at once, read `readMs` later (750, the game's own
   * pace) with `result` ("No effect" when left out). Returns the roll's serial.
   */
  throw(faces: number[], opts?: { stock?: 'first' | 'second'; seed?: number; result?: string; fate?: 'destroyed' | 'marked' | 'none'; readMs?: number }): number;
  /** Stop the dice's clock (and the inset's), or start it again: for a still at a moment. */
  pause(on: boolean): void;
}
