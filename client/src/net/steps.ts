/**
 * The view after each event of an update, from its `steps` (protocol/messages.ts, UpdateMessage):
 * what a remote seat needs to play an action back one event at a time, as the page's own host
 * gives it. Plain data in, plain data out; nothing here knows a ruleset.
 */
import { applyChange } from '../../../protocol/diff';

/**
 * The view after each event: `before` (the view at seq - 1) carried forward by each step in turn.
 * Without steps, or with steps that cannot be applied, every event has the view at the update's
 * end (`after`): right for one event, and never wrong at the end.
 */
export function viewsAfterEvents(before: unknown, events: readonly unknown[], steps: readonly unknown[] | undefined, after: unknown): unknown[] {
  if (!steps || steps.length !== events.length) return events.map(() => after);
  const out: unknown[] = [];
  let view = before;
  try {
    for (const s of steps) {
      if (s !== null) view = applyChange(view, s);
      out.push(view);
    }
  } catch {
    return events.map(() => after);
  }
  return out;
}
