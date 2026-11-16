/**
 * Invariants: structural rules that hold after every action of a legal game.
 * A failure is a bug in the rules code (or a corrupted state), never a game
 * situation. The kernel checks that a state is plain data that can be written
 * down and hashed; the ruleset adds its own rules.
 */
import { canonicalJson } from '../core/canonical';
import type { GameEvent, Ruleset } from './ruleset';

export function checkInvariants<S, A, E extends GameEvent, V, Q>(ruleset: Ruleset<S, A, E, V, Q>, state: S): string[] {
  const out: string[] = [];
  try {
    canonicalJson(state);
  } catch (err) {
    out.push(`the state is not plain data: ${(err as Error).message}`);
    return out;
  }
  try {
    out.push(...ruleset.invariants(state));
  } catch (err) {
    out.push(`the ruleset's invariant check failed: ${(err as Error).message}`);
  }
  return out;
}
