/**
 * What a host stores, and how it reads it back (rulings 6, 15 and 16).
 *
 * The store holds JSON text under these keys and nothing else:
 *
 *   snapshot        the match as it stands: everything but the log (canonical JSON)
 *   log/00000001    one per accepted action, from 1: the seat, the command's id, the action,
 *   log/00000002    the events (in full, the host's own), the state hash after it and the
 *   ...             rolls it made (canonical JSON)
 *
 * Every state-changing message is one commit: the snapshot, and the action's
 * log entry when it made one. A host rebuilt from these alone holds every
 * counter, command id, seat claim, agent seed and dice step it held before.
 *
 * snapshot (format session-snapshot/1):
 *   match          the match id
 *   content        { ruleset, scenario, map }: each { id, hash, file }, fixed when the match was made
 *   seats          one per seat, in seat order:
 *                    seat, kind ('person' or 'computer'),
 *                    agent, agentSeed      a computer seat's agent id and the seed of its random streams (else null)
 *                    contribution          a computer seat's drawn dice contribution, held until it reveals (else null)
 *                    token                 a claimed person seat: the SHA-256 of its token's 16 bytes, hex (else null)
 *                    claim                 the SHA-256 of the claim label and the claim key's bytes (else null)
 *                    sealed                the token's bytes XOR the first 16 bytes of HMAC-SHA-256(claim key, seal label), hex
 *                                          (else null): so that a repeated claim can be answered again without the
 *                                          store holding the token
 *   dice           stage ('commit', 'reveal', 'play', 'failed'), secret (hex), commitment (hex),
 *                  seats: [{ seat, commitment, contribution }] in seat order (null until sent),
 *                  failed: { seat, reason } or null
 *   initialHash    the state hash before the first action
 *   seq            how many actions have been accepted
 *   rolls          how many dice have been rolled
 *   state          the ruleset's state after action seq
 *   ended          a stated end (a concession): { winner, reason, seat, id, seq }, or null
 *
 * log entry (format session-log/1): seq, seat, id, action, events, hash, rolls ([{ k, faces, face }])
 */
import { canonicalJson } from '../engine/core/canonical';
import { HASH_PATTERN, ID_PATTERN, isRecord } from '../engine/kernel/check';
import type { RecordContent } from '../engine/kernel/record';
import { MessageChecker } from '../protocol/check';
import { DICE_FAILURES } from '../protocol/codes';
import type { DiceFailure } from '../protocol/codes';
import { CONTRIBUTION_BYTES, ID_PATTERN as COMMAND_ID, MATCH_ID_PATTERN, SECRET_BYTES, TOKEN_BYTES } from '../protocol/limits';
import type { DiceRoll, DiceStage } from '../protocol/messages';

export const SNAPSHOT_KEY = 'snapshot';
export const SNAPSHOT_FORMAT = 'session-snapshot/1';
export const LOG_FORMAT = 'session-log/1';

/** The store key of action seq's log entry. */
export function logKey(seq: number): string {
  return `log/${String(seq).padStart(8, '0')}`;
}

export interface SeatRecord {
  readonly seat: string;
  readonly kind: 'person' | 'computer';
  readonly agent: string | null;
  readonly agentSeed: number | null;
  readonly contribution: string | null;
  readonly token: string | null;
  readonly claim: string | null;
  readonly sealed: string | null;
}

export interface DiceSeat {
  readonly seat: string;
  readonly commitment: string | null;
  readonly contribution: string | null;
}

export interface DiceState {
  readonly stage: DiceStage;
  readonly secret: string;
  readonly commitment: string;
  readonly seats: readonly DiceSeat[];
  readonly failed: { readonly seat: string; readonly reason: DiceFailure } | null;
}

export interface Ended {
  readonly winner: string | null;
  readonly reason: string;
  /** The seat that conceded. */
  readonly seat: string;
  /** The id of its concession. */
  readonly id: string;
  /** The sequence number the match ended at. */
  readonly seq: number;
}

export interface Snapshot {
  readonly format: typeof SNAPSHOT_FORMAT;
  readonly match: string;
  readonly content: { readonly ruleset: RecordContent; readonly scenario: RecordContent; readonly map: RecordContent };
  readonly seats: readonly SeatRecord[];
  readonly dice: DiceState;
  readonly initialHash: string;
  readonly seq: number;
  readonly rolls: number;
  readonly state: unknown;
  readonly ended: Ended | null;
}

export interface LogEntry {
  readonly format: typeof LOG_FORMAT;
  readonly seq: number;
  readonly seat: string;
  readonly id: string;
  readonly action: unknown;
  readonly events: readonly unknown[];
  readonly hash: string;
  readonly rolls: readonly DiceRoll[];
}

export function snapshotText(s: Snapshot): string {
  return canonicalJson(s);
}

export function logText(e: LogEntry): string {
  return canonicalJson(e);
}

const MAX = Number.MAX_SAFE_INTEGER;
const SEAT = /^[\x21-\x7e]{1,64}$/;

function hexOrNull(c: MessageChecker, place: string, v: unknown, bytes: number): void {
  if (v !== null) c.hex(place, v, bytes);
}

function content(c: MessageChecker, place: string, v: unknown): void {
  const r = c.record(place, v, ['id', 'hash', 'file']);
  if (!r) return;
  c.text(`${place}.id`, c.at(r, 'id'), ID_PATTERN, 'an id', 200);
  c.text(`${place}.hash`, c.at(r, 'hash'), HASH_PATTERN, 'a content hash', 64);
  if (typeof c.at(r, 'file') !== 'string') c.add(`${place}.file`, 'must be text');
}

/** Read a stored snapshot: the value, or every problem with it. */
export function readSnapshot(text: string): { snapshot: Snapshot | null; problems: string[] } {
  const c = new MessageChecker('store snapshot');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { snapshot: null, problems: ['store snapshot: not JSON text'] };
  }
  const v = c.record('', raw, ['format', 'match', 'content', 'seats', 'dice', 'initialHash', 'seq', 'rolls', 'state', 'ended']);
  if (!v) return { snapshot: null, problems: c.problems };
  if (c.at(v, 'format') !== SNAPSHOT_FORMAT) c.add('format', `must be '${SNAPSHOT_FORMAT}'`);
  c.text('match', c.at(v, 'match'), MATCH_ID_PATTERN, 'a match id', 128);
  const ct = c.record('content', c.at(v, 'content'), ['ruleset', 'scenario', 'map']);
  if (ct) for (const k of ['ruleset', 'scenario', 'map']) content(c, `content.${k}`, c.at(ct, k));
  const seats = c.list('seats', c.at(v, 'seats'), 64);
  seats?.forEach((s, i) => {
    const p = `seats[${i}]`;
    const r = c.record(p, s, ['seat', 'kind', 'agent', 'agentSeed', 'contribution', 'token', 'claim', 'sealed']);
    if (!r) return;
    c.text(`${p}.seat`, c.at(r, 'seat'), SEAT, 'a seat name', 64);
    const kind = c.oneOf(`${p}.kind`, c.at(r, 'kind'), ['person', 'computer'], 'a seat kind');
    if (kind === 'computer') {
      c.text(`${p}.agent`, c.at(r, 'agent'), ID_PATTERN, 'an agent id', 64);
      c.int(`${p}.agentSeed`, c.at(r, 'agentSeed'), 0, 0xffffffff);
      hexOrNull(c, `${p}.contribution`, c.at(r, 'contribution'), CONTRIBUTION_BYTES);
    } else {
      for (const k of ['agent', 'agentSeed', 'contribution']) if (c.at(r, k) !== null) c.add(`${p}.${k}`, 'must be null for a person seat');
    }
    hexOrNull(c, `${p}.token`, c.at(r, 'token'), 32);
    hexOrNull(c, `${p}.claim`, c.at(r, 'claim'), 32);
    hexOrNull(c, `${p}.sealed`, c.at(r, 'sealed'), TOKEN_BYTES);
  });
  const d = c.record('dice', c.at(v, 'dice'), ['stage', 'secret', 'commitment', 'seats', 'failed']);
  if (d) {
    c.oneOf('dice.stage', c.at(d, 'stage'), ['commit', 'reveal', 'play', 'failed'], 'a dice stage');
    c.hex('dice.secret', c.at(d, 'secret'), SECRET_BYTES);
    c.hex('dice.commitment', c.at(d, 'commitment'), 32);
    const ds = c.list('dice.seats', c.at(d, 'seats'), 64);
    ds?.forEach((s, i) => {
      const p = `dice.seats[${i}]`;
      const r = c.record(p, s, ['seat', 'commitment', 'contribution']);
      if (!r) return;
      c.text(`${p}.seat`, c.at(r, 'seat'), SEAT, 'a seat name', 64);
      hexOrNull(c, `${p}.commitment`, c.at(r, 'commitment'), 32);
      hexOrNull(c, `${p}.contribution`, c.at(r, 'contribution'), CONTRIBUTION_BYTES);
    });
    const f = c.at(d, 'failed');
    if (f !== null) {
      const r = c.record('dice.failed', f, ['seat', 'reason']);
      if (r) {
        c.text('dice.failed.seat', c.at(r, 'seat'), SEAT, 'a seat name', 64);
        c.oneOf('dice.failed.reason', c.at(r, 'reason'), DICE_FAILURES, 'a reason');
      }
    }
  }
  c.text('initialHash', c.at(v, 'initialHash'), HASH_PATTERN, 'a state hash', 64);
  c.int('seq', c.at(v, 'seq'), 0, MAX);
  c.int('rolls', c.at(v, 'rolls'), 0, MAX);
  if (!isRecord(c.at(v, 'state'))) c.add('state', 'must be a mapping (the ruleset state)');
  const e = c.at(v, 'ended');
  if (e !== null) {
    const r = c.record('ended', e, ['winner', 'reason', 'seat', 'id', 'seq']);
    if (r) {
      if (c.at(r, 'winner') !== null) c.text('ended.winner', c.at(r, 'winner'), SEAT, 'a seat name or null', 64);
      if (typeof c.at(r, 'reason') !== 'string') c.add('ended.reason', 'must be text');
      c.text('ended.seat', c.at(r, 'seat'), SEAT, 'a seat name', 64);
      c.text('ended.id', c.at(r, 'id'), COMMAND_ID, 'a command id', 64);
      c.int('ended.seq', c.at(r, 'seq'), 0, MAX);
    }
  }
  if (!c.ok) return { snapshot: null, problems: c.problems };
  return { snapshot: raw as Snapshot, problems: [] };
}

/** Read a stored log entry for action `seq`. */
export function readLogEntry(text: string, seq: number): { entry: LogEntry | null; problems: string[] } {
  const c = new MessageChecker(`store ${logKey(seq)}`);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { entry: null, problems: [`store ${logKey(seq)}: not JSON text`] };
  }
  const v = c.record('', raw, ['format', 'seq', 'seat', 'id', 'action', 'events', 'hash', 'rolls']);
  if (!v) return { entry: null, problems: c.problems };
  if (c.at(v, 'format') !== LOG_FORMAT) c.add('format', `must be '${LOG_FORMAT}'`);
  if (c.at(v, 'seq') !== seq) c.add('seq', `must be ${seq}`);
  c.text('seat', c.at(v, 'seat'), SEAT, 'a seat name', 64);
  c.text('id', c.at(v, 'id'), COMMAND_ID, 'a command id', 64);
  if (!isRecord(c.at(v, 'action'))) c.add('action', 'must be a mapping (an action)');
  c.list('events', c.at(v, 'events'), MAX);
  c.text('hash', c.at(v, 'hash'), HASH_PATTERN, 'a state hash', 64);
  const rolls = c.list('rolls', c.at(v, 'rolls'), MAX);
  rolls?.forEach((r, i) => {
    const e = c.record(`rolls[${i}]`, r, ['k', 'faces', 'face']);
    if (!e) return;
    c.int(`rolls[${i}].k`, c.at(e, 'k'), 0, MAX);
    const faces = c.int(`rolls[${i}].faces`, c.at(e, 'faces'), 1, 0x100000000);
    c.int(`rolls[${i}].face`, c.at(e, 'face'), 1, faces ?? 0x100000000);
  });
  if (!c.ok) return { entry: null, problems: c.problems };
  return { entry: raw as LogEntry, problems: [] };
}
