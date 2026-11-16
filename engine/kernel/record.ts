/**
 * Game records, and replay from a record's actions or from its events.
 *
 * A record names its static content by id, content hash and file (relative to
 * the repository root), its dice seed, how each seat chose its actions, and
 * every accepted action with the events it produced and the state hash after
 * it. It is the host's record: events are kept in full, before any redaction.
 *
 * Two formats, which differ only in how they hold the dice:
 *
 *   format: record/1   a game on seeded dice (the simulator's): it holds the seed
 *   format: record/2   a game on any other dice (a session's keyed dice): it holds
 *                      every roll as it was made, and no seed and no key
 *
 *   ruleset, scenario, map:  { id, hash, file }
 *   seed:         record/1 only: the dice seed (a whole number from 0 to 2^32 - 1)
 *   rolls:        record/2 only: [{ k, faces, face }], roll numbers from 0 with no gap
 *   agents:       [{ seat, agent, seed }]   how each seat chose, with the agent's own seed
 *                 (never the dice seed); empty for people
 *   initialHash:  the state hash before the first action
 *   actions:      [{ seq, seat, action, events, hash }]   seq counts from 1
 *   ended:        a result stated by Match.end (a session matter), or null
 *   result:       the result, or null when the game was not finished
 *   finalHash:    the state hash after the last action
 *
 * Replay from actions applies each action again with the record's dice
 * (diceOf) and compares, after every one, the state hash and the events it
 * produced with the record's (so a die face altered in a record is caught
 * even where it would not have changed the result). Replay from events
 * reduces the recorded events onto the initial state; it never rolls a die.
 */
import { canonicalJson } from '../core/canonical';
import { Checker, HASH_PATTERN, ID_PATTERN, isRecord } from './check';
import { RecordedDice, SeededDice } from './dice';
import type { RecordedRoll } from './dice';
import type { Dice, GameEvent, MatchResult, Ruleset, Seat } from './ruleset';
import type { Match } from './match';

/** A game on seeded dice. */
export const RECORD_FORMAT = 'record/1';
/** A game on any other dice: the record holds the rolls. */
export const ROLLED_RECORD_FORMAT = 'record/2';

export interface RecordContent {
  readonly id: string;
  readonly hash: string;
  readonly file: string;
}

export interface RecordAgent {
  readonly seat: Seat;
  readonly agent: string;
  readonly seed: number;
}

export interface RecordAction {
  readonly seq: number;
  readonly seat: Seat;
  readonly action: unknown;
  readonly events: readonly unknown[];
  readonly hash: string;
}

interface RecordBody {
  readonly ruleset: RecordContent;
  readonly scenario: RecordContent;
  readonly map: RecordContent;
  readonly agents: readonly RecordAgent[];
  readonly initialHash: string;
  readonly actions: readonly RecordAction[];
  readonly ended: MatchResult | null;
  readonly result: MatchResult | null;
  readonly finalHash: string;
}

/** The record of a game on seeded dice. */
export interface SeededRecord extends RecordBody {
  readonly format: typeof RECORD_FORMAT;
  readonly seed: number;
}

/** The record of a game on any other dice: it holds every roll, in order. */
export interface RolledRecord extends RecordBody {
  readonly format: typeof ROLLED_RECORD_FORMAT;
  readonly rolls: readonly RecordedRoll[];
}

export type GameRecord = SeededRecord | RolledRecord;

interface HeaderBody {
  readonly ruleset: RecordContent;
  readonly scenario: RecordContent;
  readonly map: RecordContent;
  readonly agents: readonly RecordAgent[];
}

export interface RecordHeader extends HeaderBody {
  readonly seed: number;
}

export interface RolledRecordHeader extends HeaderBody {
  /** Every roll made so far, in the order made. */
  readonly rolls: readonly RecordedRoll[];
}

function bodyOf<S, A, E extends GameEvent, V, Q>(match: Match<S, A, E, V, Q>, header: HeaderBody): RecordBody {
  return {
    ruleset: header.ruleset,
    scenario: header.scenario,
    map: header.map,
    agents: header.agents,
    initialHash: match.initialHash,
    actions: match.log.map(e => ({ seq: e.seq, seat: e.seat, action: e.action, events: e.events, hash: e.hash })),
    ended: match.statedEnd,
    result: match.result(),
    finalHash: match.hash,
  };
}

/** The record of a match on seeded dice, so far. */
export function recordOf<S, A, E extends GameEvent, V, Q>(match: Match<S, A, E, V, Q>, header: RecordHeader): SeededRecord {
  return { format: RECORD_FORMAT, seed: header.seed, ...bodyOf(match, header) };
}

/** The record of a match on any other dice, so far: the rolls stand in for a seed. */
export function rolledRecordOf<S, A, E extends GameEvent, V, Q>(match: Match<S, A, E, V, Q>, header: RolledRecordHeader): RolledRecord {
  return { format: ROLLED_RECORD_FORMAT, rolls: header.rolls.map(r => ({ k: r.k, faces: r.faces, face: r.face })), ...bodyOf(match, header) };
}

/** The dice a record's actions are replayed with: its seed's, or its own rolls. */
export function diceOf(r: GameRecord): Dice {
  return r.format === RECORD_FORMAT ? new SeededDice(r.seed) : new RecordedDice(r.rolls);
}

/**
 * A record as text: JSON, one action per line, so that two records diff line
 * by line. The text is fixed for a given record.
 */
export function recordToText(r: GameRecord): string {
  const dice = r.format === RECORD_FORMAT ? { seed: r.seed } : { rolls: r.rolls };
  const head = {
    format: r.format, ruleset: r.ruleset, scenario: r.scenario, map: r.map, ...dice, agents: r.agents,
    initialHash: r.initialHash,
  };
  const lines: string[] = [];
  const headText = JSON.stringify(head);
  lines.push(`${headText.slice(0, -1)},`);
  lines.push('"actions":[');
  r.actions.forEach((a, i) => {
    const entry = { seq: a.seq, seat: a.seat, action: a.action, events: a.events, hash: a.hash };
    lines.push(JSON.stringify(entry) + (i < r.actions.length - 1 ? ',' : ''));
  });
  lines.push('],');
  lines.push(`"ended":${JSON.stringify(r.ended)},`);
  lines.push(`"result":${JSON.stringify(r.result)},`);
  lines.push(`"finalHash":${JSON.stringify(r.finalHash)}}`);
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

const COMMON_KEYS = ['format', 'ruleset', 'scenario', 'map', 'agents', 'initialHash', 'actions', 'ended', 'result', 'finalHash'];
const SEEDED_KEYS = [...COMMON_KEYS, 'seed'];
const ROLLED_KEYS = [...COMMON_KEYS, 'rolls'];

export interface RecordLoadResult {
  record: GameRecord | null;
  problems: string[];
}

/**
 * Check a parsed record. `checkEvent`, when given, checks each event against
 * the ruleset's event schema; `seats`, when given, is the closed list of seats.
 */
export function validateRecord(
  raw: unknown, file: string,
  opts: { checkEvent?: (e: unknown) => string[]; seats?: readonly Seat[] } = {},
): RecordLoadResult {
  const c = new Checker(file);
  // The format says which keys a record has: record/1 a seed, record/2 its rolls.
  const format = isRecord(raw) ? raw.format : undefined;
  const rolled = format === ROLLED_RECORD_FORMAT;
  const top = c.record('', raw, rolled ? ROLLED_KEYS : SEEDED_KEYS);
  if (!top) return { record: null, problems: c.problems };
  if (format !== RECORD_FORMAT && format !== ROLLED_RECORD_FORMAT) {
    c.add('format', `must be '${RECORD_FORMAT}' or '${ROLLED_RECORD_FORMAT}', got ${JSON.stringify(format)}`);
  }
  const content = (key: string): void => {
    const v = c.record(key, c.at(top, key), ['id', 'hash', 'file']);
    if (!v) return;
    c.str(`${key}.id`, c.at(v, 'id'), ID_PATTERN, 'lower-case letters, digits, _ and -');
    c.str(`${key}.hash`, c.at(v, 'hash'), HASH_PATTERN, 'a SHA-256 hash (64 lower-case hex digits)');
    c.str(`${key}.file`, c.at(v, 'file'));
  };
  content('ruleset');
  content('scenario');
  content('map');
  if (rolled) {
    const rolls = c.list('rolls', c.at(top, 'rolls'));
    rolls?.forEach((r, i) => {
      const place = `rolls[${i + 1}]`;
      const v = c.record(place, r, ['k', 'faces', 'face']);
      if (!v) return;
      const k = c.at(v, 'k');
      if (k !== i) c.add(`${place}.k`, `must be ${i} (roll numbers run from 0 with no gap), got ${JSON.stringify(k)}`);
      const faces = c.int(`${place}.faces`, c.at(v, 'faces'), 1, 0x100000000);
      c.int(`${place}.face`, c.at(v, 'face'), 1, faces ?? 0x100000000);
    });
  } else {
    c.int('seed', c.at(top, 'seed'), 0, 0xffffffff);
  }
  const seatOk = (place: string, v: unknown): void => {
    if (opts.seats) c.oneOf(place, v, opts.seats, 'seat');
    else c.str(place, v);
  };
  const agents = c.list('agents', c.at(top, 'agents'));
  agents?.forEach((a, i) => {
    const place = `agents[${i + 1}]`;
    const v = c.record(place, a, ['seat', 'agent', 'seed']);
    if (!v) return;
    seatOk(`${place}.seat`, c.at(v, 'seat'));
    c.str(`${place}.agent`, c.at(v, 'agent'), ID_PATTERN, 'an agent id');
    c.int(`${place}.seed`, c.at(v, 'seed'), 0, 0xffffffff);
  });
  c.str('initialHash', c.at(top, 'initialHash'), HASH_PATTERN, 'a SHA-256 hash');
  const actions = c.list('actions', c.at(top, 'actions'));
  actions?.forEach((a, i) => {
    const place = `actions[${i + 1}]`;
    const v = c.record(place, a, ['seq', 'seat', 'action', 'events', 'hash']);
    if (!v) return;
    const seq = c.at(v, 'seq');
    if (seq !== i + 1) c.add(`${place}.seq`, `must be ${i + 1}, got ${JSON.stringify(seq)}`);
    seatOk(`${place}.seat`, c.at(v, 'seat'));
    if (!isRecord(c.at(v, 'action'))) c.add(`${place}.action`, 'must be a mapping (an action object)');
    const events = c.list(`${place}.events`, c.at(v, 'events'), 1);
    events?.forEach((e, k) => {
      if (!isRecord(e) || typeof e.type !== 'string') {
        c.add(`${place}.events[${k + 1}]`, 'must be a mapping with a type');
        return;
      }
      if (opts.checkEvent) for (const p of opts.checkEvent(e)) c.add(`${place}.events[${k + 1}]`, p);
    });
    c.str(`${place}.hash`, c.at(v, 'hash'), HASH_PATTERN, 'a SHA-256 hash');
  });
  const result = (key: string): void => {
    const v = c.at(top, key);
    if (v === null) return;
    const r = c.record(key, v, ['winner', 'reason']);
    if (!r) return;
    const w = c.at(r, 'winner');
    if (w !== null) seatOk(`${key}.winner`, w);
    c.str(`${key}.reason`, c.at(r, 'reason'));
  };
  result('ended');
  result('result');
  c.str('finalHash', c.at(top, 'finalHash'), HASH_PATTERN, 'a SHA-256 hash');
  if (!c.ok) return { record: null, problems: c.problems };
  return { record: raw as GameRecord, problems: [] };
}

// ---------------------------------------------------------------------------
// replay
// ---------------------------------------------------------------------------

export interface ReplayReport<S> {
  /** True when every hash matched, the final one included. */
  readonly ok: boolean;
  readonly from: 'actions' | 'events';
  readonly state: S;
  readonly finalHash: string;
  readonly expectedHash: string;
  /** How many recorded actions were replayed. */
  readonly replayed: number;
  /** The seq of the first action whose hash or events differ (or that was refused), else null. */
  readonly firstDifference: number | null;
  readonly message: string;
}

/** Rebuild a game by applying the recorded actions again with the given dice. */
export function replayFromActions<S, A, E extends GameEvent, V, Q>(
  ruleset: Ruleset<S, A, E, V, Q>, record: GameRecord, dice: Dice,
): ReplayReport<S> {
  let state = ruleset.initial();
  const initial = ruleset.hash(state);
  if (initial !== record.initialHash) {
    return { ok: false, from: 'actions', state, finalHash: initial, expectedHash: record.finalHash, replayed: 0, firstDifference: 0,
      message: `the initial state differs: hash ${initial}, the record has ${record.initialHash}` };
  }
  let firstDifference: number | null = null;
  let message = '';
  for (const entry of record.actions) {
    let res: ReturnType<typeof ruleset.apply>;
    try {
      res = ruleset.apply(state, entry.seat, entry.action, dice);
    } catch (err) {
      // Dice that answer from the record refuse a roll it does not hold, or holds for another die:
      // the record is then not the game that was played, and the replay says where.
      if (!(dice instanceof RecordedDice)) throw err;
      const asked = `action ${entry.seq} (${entry.seat}): ${(err as Error).message}`;
      return { ok: false, from: 'actions', state, finalHash: ruleset.hash(state), expectedHash: record.finalHash,
        replayed: entry.seq - 1, firstDifference: firstDifference ?? entry.seq,
        message: firstDifference === null ? asked : `${message}; then ${asked}` };
    }
    if (!res.ok) {
      // A refusal after an earlier difference is a consequence of it: report the first.
      const refused = `action ${entry.seq} (${entry.seat}) was refused: ${res.rejection.code}: ${res.rejection.detail}`;
      return { ok: false, from: 'actions', state, finalHash: ruleset.hash(state), expectedHash: record.finalHash,
        replayed: entry.seq - 1, firstDifference: firstDifference ?? entry.seq,
        message: firstDifference === null ? refused : `${message}; then ${refused}` };
    }
    state = res.state;
    const h = ruleset.hash(state);
    if (firstDifference === null) {
      if (h !== entry.hash) {
        firstDifference = entry.seq;
        message = `action ${entry.seq} (${entry.seat}): state hash ${h}, the record has ${entry.hash}`;
      } else if (canonicalJson(res.events) !== canonicalJson(entry.events)) {
        firstDifference = entry.seq;
        message = `action ${entry.seq} (${entry.seat}): the events it produces are not the record's`;
      }
    }
  }
  const finalHash = ruleset.hash(state);
  let ok = firstDifference === null && finalHash === record.finalHash;
  if (!ok && message === '') message = `final state hash ${finalHash}, the record has ${record.finalHash}`;
  // A record that holds its own rolls must hold exactly the rolls the game asked for.
  if (ok && dice instanceof RecordedDice) {
    const extra = dice.unused();
    if (extra.length > 0) {
      ok = false;
      message = `the record holds ${extra.length} roll${extra.length === 1 ? '' : 's'} the game never asked for (first: roll ${extra[0]})`;
    }
  }
  return { ok, from: 'actions', state, finalHash, expectedHash: record.finalHash, replayed: record.actions.length, firstDifference, message };
}

/** Rebuild a game from the recorded events alone. No die is rolled. */
export function replayFromEvents<S, A, E extends GameEvent, V, Q>(
  ruleset: Ruleset<S, A, E, V, Q>, record: GameRecord,
): ReplayReport<S> {
  let state = ruleset.initial();
  const initial = ruleset.hash(state);
  if (initial !== record.initialHash) {
    return { ok: false, from: 'events', state, finalHash: initial, expectedHash: record.finalHash, replayed: 0, firstDifference: 0,
      message: `the initial state differs: hash ${initial}, the record has ${record.initialHash}` };
  }
  let firstDifference: number | null = null;
  let message = '';
  for (const entry of record.actions) {
    for (const e of entry.events) {
      const problems = ruleset.checkEvent(e);
      if (problems.length > 0) {
        return { ok: false, from: 'events', state, finalHash: ruleset.hash(state), expectedHash: record.finalHash,
          replayed: entry.seq - 1, firstDifference: entry.seq, message: `action ${entry.seq}: bad event: ${problems.join('; ')}` };
      }
    }
    state = ruleset.reduce(state, entry.events as E[]);
    const h = ruleset.hash(state);
    if (h !== entry.hash && firstDifference === null) {
      firstDifference = entry.seq;
      message = `action ${entry.seq} (${entry.seat}): state hash ${h}, the record has ${entry.hash}`;
    }
  }
  const finalHash = ruleset.hash(state);
  const ok = firstDifference === null && finalHash === record.finalHash;
  if (!ok && message === '') message = `final state hash ${finalHash}, the record has ${record.finalHash}`;
  return { ok, from: 'events', state, finalHash, expectedHash: record.finalHash, replayed: record.actions.length, firstDifference, message };
}
