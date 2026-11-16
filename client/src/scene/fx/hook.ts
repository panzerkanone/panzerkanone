/**
 * What the effects add to `window.__table` (the page's hook, ../hook.ts) as `fx`, and the table's
 * answers as `answers`, for checks and for the demonstration. Types only.
 */
import type { IntentAct } from '../pieces/port';
import type { EffectKind } from './effects';
import type { FxTune } from './tune';

/** What `play` sets off. `kill` is what a destroyed counter gets: the explosion and then the burning wreck. */
export type PlayKind = EffectKind | 'kill';

export interface FxHook {
  /** True: the effects are drawn (the address did not say `fx=0`). */
  readonly on: boolean;
  /** The pictures: `none` (none were handed in, or they failed: only the effects the shader draws itself are shown), `loading`, or `ready`. */
  readonly art: 'none' | 'loading' | 'ready';
  /** Short effects alive now (a shot, an arrival, an explosion, dust). The table is at rest only when this is 0. */
  readonly bursts: number;
  /** Lasting effects alive now (a burning wreck, a smoke screen, a wisp). The table still rests with these alive: they are drawn at their own slower pace, and `frames` does not count those frames. */
  readonly lasting: number;
  /** Particles alive (those not yet born included), and patches of light and soot on the board. */
  readonly particles: number;
  readonly patches: number;
  /** Spawns dropped because a pool was full. */
  readonly dropped: number;
  /** How many of each effect have started since the page loaded. */
  readonly started: Readonly<Record<EffectKind, number>>;
  /** Frames drawn only because a lasting effect was alive (not counted in the page's `frames`). */
  readonly ambientFrames: number;
  /** The effects' own textures on the GPU (not counted in the page's `textures`). */
  readonly textures: { count: number; bytes: number };
  /** Draw calls the effects made in the last frame: 0, 1 or 2. */
  readonly drawCalls: number;
  /** The dials as they stand (fx/tune.ts, with the address's `fx.<group>.<dial>=` applied). */
  readonly tune: FxTune;
  /** How the effects are cut down now. */
  readonly mode: { fast: boolean; reduced: boolean; flat: boolean };
  /** The effects' clock in seconds, and the bright flashes let through lately and to come, on that clock. */
  readonly now: number;
  readonly flashes: number[];
  /**
   * Set an effect off at a hex. `to` is the hex fired at (gun, small, lob) or driven toward (dust,
   * exhaust); `armour` whether what is fired at is armoured. `screen` and `wisp` are put on the hex,
   * or taken off it if they are there. Returns false if the hex is not on the board.
   */
  play(kind: PlayKind, hex: number, opts?: { to?: number; armour?: boolean }): boolean;
  /** The staged exchange of the demonstration: a tank fires, is answered, and one burns. Resolves with the two hexes when the last order has been given (the fire burns on after it); null where the table has no two tanks to stage it with. */
  exchange(): Promise<{ a: number; b: number } | null>;
  /** Everything gone at once. */
  clear(): void;
  /** Checks only: stop the effects' clock (the page then rests), and move it on by hand. */
  pause(on: boolean): void;
  advance(seconds: number): void;
}

/** What a click would do, as a game tells it (the port's `intent`). */
export type Intent = { hex: number; unit: string | null; act: IntentAct; can: boolean; words: string };

/** What the answers add to `window.__table` as `answers`, for checks. */
export interface AnswersHook {
  /** What a click would do, as last told and still showing; null when nothing is. */
  readonly intent: Intent | null;
  /** The cursor the intent gives the table: an act's name, `no` where the click would be refused, `plain` with no intent. */
  readonly cursor: string;
  /** Marks on the table now: badges floating, refusals (the X or its words still showing), and the stand-in strokes of shots (with the effects on, a shot is in `fx.bursts`). */
  readonly badges: number;
  readonly refusals: number;
  readonly shots: number;
  /** How many of each have been asked for since the page loaded. */
  readonly started: Readonly<Record<'intent' | 'cleared' | 'badge' | 'refused' | 'fired' | 'landed', number>>;
  /** Where each mark showing now is: the middle of its box in the window, in CSS pixels. */
  marks(): { kind: 'intent' | 'badge' | 'refused'; hex: number; words: string; x: number; y: number; width: number; height: number }[];
}
