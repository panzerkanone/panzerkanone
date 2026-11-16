/**
 * When things happen on the title screen: the timetable of the tanks' shots, the shell bursts, the
 * flashes behind the horizon and the runs of tracer, from a seed. Plain arithmetic, no browser.
 *
 * Each kind of event has streams of its own (one for each tank, one for each of the rest). A
 * stream's next event comes a wait after its last, and each wait is drawn by its number from the
 * seed: long, irregular waits, never a loop. The streams are then merged under two rules:
 *
 *   - A bright event (a shot, a burst, a strike, a flash behind the horizon) starts no sooner than
 *     `FLASH_GAP` after the bright event before it. With a gap above half a second no second of
 *     the screen ever holds more than two bright flashes (the order allows three).
 *   - A shot comes no sooner than `SHOT_GAP` after the shot before it: the tanks fire now and
 *     then, not in volleys.
 *
 * An event that would break a rule is moved later, never dropped. Times are seconds of the
 * screen's own clock, which runs only while the page is shown.
 */
import { drawsOf } from './seeded';

export type EventKind = 'shot' | 'burst' | 'strike' | 'glow' | 'tracers';

export interface TitleEvent {
  kind: EventKind;
  /** When it starts, in seconds. */
  at: number;
  /** Which of its kind's places it happens at: a tank, a burst site, a lane (places.ts). */
  place: number;
  /** Its number among all events, from 0: the stable id its own looks are drawn from. */
  n: number;
}

/** Seconds between the starts of two bright events, at least. */
export const FLASH_GAP = 0.62;
/** Seconds between two shots, at least. */
export const SHOT_GAP = 2.4;
/** The kinds that light the screen. */
export const BRIGHT: readonly EventKind[] = ['shot', 'burst', 'strike', 'glow'];

export interface StreamSpec {
  kind: EventKind;
  /** Which place its events happen at; null: one of `places`, drawn for each event. */
  place: number | null;
  /** The first event comes between these, the later waits between those (seconds), and how far the waits lean to the short end (1: evenly; above 1: mostly short, now and then long). */
  first: readonly [number, number];
  wait: readonly [number, number];
  lean: number;
}

/** How many places each kind has to happen at (places.ts lists them; a test holds the two together). */
export const PLACES: Readonly<Record<EventKind, number>> = { shot: 3, burst: 6, strike: 3, glow: 5, tracers: 6 };

/**
 * The streams. A tank's first shot comes early enough that a visitor who reads the menu sees one;
 * the big gun in front fires seldom.
 */
export const STREAMS: readonly StreamSpec[] = [
  { kind: 'shot', place: 0, first: [9, 14], wait: [17, 36], lean: 1.3 },
  { kind: 'shot', place: 1, first: [14, 24], wait: [11, 26], lean: 1.3 },
  { kind: 'shot', place: 2, first: [3.6, 5.2], wait: [10, 24], lean: 1.3 },
  { kind: 'burst', place: null, first: [2.4, 4], wait: [3.2, 9.5], lean: 1.6 },
  { kind: 'glow', place: null, first: [1.6, 3], wait: [2.2, 7.5], lean: 1.8 },
  { kind: 'strike', place: null, first: [18, 28], wait: [19, 40], lean: 1.2 },
  { kind: 'tracers', place: null, first: [1.2, 2.6], wait: [1.6, 6], lean: 1.7 },
];

export class Timetable {
  private readonly events: TitleEvent[] = [];
  /** For each stream: when its next event is due before the rules, and that event's number in the stream. */
  private readonly due: number[];
  private readonly count: number[];
  private readonly waits: ((id: number) => number)[];
  private readonly places: (id: number) => number;
  private lastBright = -Infinity;
  private lastShot = -Infinity;
  /** Every event that starts before this time has been made. */
  private madeTo = 0;

  constructor(seed: number, private readonly streams: readonly StreamSpec[] = STREAMS) {
    this.waits = streams.map((_, i) => drawsOf(seed, `title-wait-${i}`));
    this.places = drawsOf(seed, 'title-place');
    this.count = streams.map(() => 0);
    this.due = streams.map((s, i) => s.first[0] + (s.first[1] - s.first[0]) * (this.waits[i] as (id: number) => number)(0));
  }

  /** The events that start at `from` or later and before `to`, in the order of their starts. */
  between(from: number, to: number): TitleEvent[] {
    this.makeTo(to);
    const out: TitleEvent[] = [];
    // The list is in the order of the starts; the newest are at its end.
    let i = this.events.length - 1;
    while (i >= 0 && (this.events[i] as TitleEvent).at >= from) i--;
    for (let k = i + 1; k < this.events.length; k++) {
      const e = this.events[k] as TitleEvent;
      if (e.at >= to) break;
      out.push(e);
    }
    return out;
  }

  private makeTo(time: number): void {
    // A rule can move an event later by no more than the gaps; events due before `time` plus that are enough.
    while (this.madeTo < time) {
      let next = 0;
      for (let i = 1; i < this.due.length; i++) if ((this.due[i] as number) < (this.due[next] as number)) next = i;
      const spec = this.streams[next] as StreamSpec;
      const dueAt = this.due[next] as number;
      const number = (this.count[next] as number) + 1;
      const draw = this.waits[next] as (id: number) => number;
      let at = dueAt;
      if (BRIGHT.includes(spec.kind)) at = Math.max(at, this.lastBright + FLASH_GAP);
      if (spec.kind === 'shot') at = Math.max(at, this.lastShot + SHOT_GAP);
      const n = this.events.length;
      const place = spec.place ?? Math.min(PLACES[spec.kind] - 1, Math.floor(this.places(n) * PLACES[spec.kind]));
      const event: TitleEvent = { kind: spec.kind, at, place, n };
      // Keep the list in the order of the starts: a moved event may start after one made later.
      let k = this.events.length;
      this.events.push(event);
      while (k > 0 && (this.events[k - 1] as TitleEvent).at > at) {
        this.events[k] = this.events[k - 1] as TitleEvent;
        k--;
      }
      this.events[k] = event;
      if (BRIGHT.includes(spec.kind)) this.lastBright = at;
      if (spec.kind === 'shot') this.lastShot = at;
      this.count[next] = number;
      this.due[next] = dueAt + spec.wait[0] + (spec.wait[1] - spec.wait[0]) * draw(number) ** spec.lean;
      // Every stream's next event is due at or after the least due time, and no rule moves an event earlier.
      this.madeTo = Math.min(...this.due);
    }
  }
}

/** The starts of the bright events among `events`, in order. */
export function flashTimes(events: readonly TitleEvent[]): number[] {
  return events.filter(e => BRIGHT.includes(e.kind)).map(e => e.at).sort((a, b) => a - b);
}

/** The most of `times` (in order) that fall within any one stretch of `span` seconds. */
export function mostWithin(times: readonly number[], span = 1): number {
  let most = 0;
  let from = 0;
  for (let to = 0; to < times.length; to++) {
    while ((times[to] as number) - (times[from] as number) > span) from++;
    most = Math.max(most, to - from + 1);
  }
  return most;
}
