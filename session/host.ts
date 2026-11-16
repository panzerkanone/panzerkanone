/**
 * The match host: one match, headless, rules-agnostic. It talks to the world
 * only through its ports (session/ports.ts) and is driven only by its entry
 * point:
 *
 *   const host = createHost({ match, content, store, random, computers });   a new match
 *   const r = openHost({ content, store, random, computers });              rebuilt from the store
 *   const conn = host.connect(outbox);        a connection opened (the transport's job)
 *   host.receive(conn, text);                 the raw text of one message from that connection
 *   host.disconnect(conn);                    the connection went away
 *   await host.idle();                        computer seats have nothing left to do for now
 *   host.close();                             this host stops; it never touches its ports again
 *
 * THE PIPELINE (ruling 5), for every message, in this order:
 *   1. size        over MAX_MESSAGE_BYTES in UTF-8, counted before parsing    too_large
 *   2. parse       JSON text                                                  not_json
 *   3. validate    a message of the protocol (protocol/validate.ts)           invalid
 *                  (a refusal at 1 to 3 counts against the connection's budget; the eighth closes it)
 *   4. budget      the connection has not spent its invalid-message budget    budget_spent
 *   5. seat        from the connection, never from the message                not_joined, spectator, replaced
 *   6. duplicate   a command id this seat used before gets its first answer again, and nothing else happens
 *   7. due         the match has started, is not over, and this seat must decide   dice_waiting, game_over, not_your_turn
 *   8. stale       the command's sequence number is the host's, while one seat is due   stale
 *   9. submit      Match.submit, on a copy of the match whose dice record every roll   (the ruleset's codes)
 *  10. store       one commit: the snapshot and the log entry                 store_failed
 *  11. announce    an update to every connection, then the answer to the sender
 * An exception after step 3 and before step 10 returns is a typed rejection
 * (internal_error) and a line in `faults`; the state is unchanged, because the
 * host swaps in the new match only once the store call has returned. An
 * exception after it (projecting a view or an event, an outbox) is a line in
 * `faults`, the committed result stands, every other connection is served,
 * and the connection that failed is closed so that it rejoins (ruling 20).
 *
 * Claims, dice steps and concessions go through steps 1 to 5 and, where they
 * change what is stored, one commit before anything is sent.
 *
 * COMPUTER SEATS (ruling 10). After an entry call has returned, the host asks
 * a due computer seat's agent in a microtask (never inside the pipeline), and
 * sends its answer through the pipeline as a command on an internal
 * connection of the seat, with an id and a sequence number like a person's.
 * An answer that arrives once the sequence number has moved, the match is
 * over, or the host is closed is dropped; if the seat is still due its agent
 * is asked again, once, for the new position (ruling 26). An illegal answer is
 * a typed rejection and one line in `faults`; after COMPUTER_TRIES answers at
 * one position the host stops asking until the position moves.
 *
 * ONE HOST PER STORE. A host built on a store object (made or rebuilt) takes
 * it over: an older host on the same store object stops, answers every
 * message with host_closed and drops its agents' late answers, and never
 * calls the store again. `close()` does the same for a host that is simply
 * discarded.
 */
import { hmacSha256Words, sha256Hex, utf8, wordsToBytes } from '../engine/core/sha256';
import { ID_PATTERN as AGENT_ID } from '../engine/kernel/check';
import { ThrowingDice } from '../engine/kernel/dice';
import type { RecordedRoll } from '../engine/kernel/dice';
import { Match } from '../engine/kernel/match';
import type { LoggedAction } from '../engine/kernel/match';
import { rolledRecordOf } from '../engine/kernel/record';
import type { RolledRecord } from '../engine/kernel/record';
import type { Decision, Dice, GameEvent, MatchResult, Seat } from '../engine/kernel/ruleset';
import { bytesToHex, hexToBytes } from '../protocol/check';
import { INVALID_CODES, PASSING_CODES } from '../protocol/codes';
import type { CloseReason, ProtocolRejectionCode } from '../protocol/codes';
import { diffJson } from '../protocol/diff';
import type { Change } from '../protocol/diff';
import {
  CONTRIBUTION_BYTES, INVALID_MESSAGE_BUDGET, MATCH_ID_PATTERN, PROTOCOL_VERSION, REJOIN_EVENT_LIMIT, SECRET_BYTES, TOKEN_BYTES,
  tooLarge,
} from '../protocol/limits';
import type {
  AcceptedMessage, ActionEvents, ClaimMessage, ClientMessage, CommandMessage, ConcedeMessage, ContentPins, DiceRecord, DiceRoll,
  DiceStatus, HostMessage, RejectedMessage, ResumeMessage, UpdateMessage, ViewMessage, WatchMessage, WelcomeMessage,
} from '../protocol/messages';
import { validateClientMessage } from '../protocol/validate';
import { viewHash, viewerLabel } from '../protocol/viewhash';
import { COMPUTER_TRIES, computerStream } from './computer';
import type { SeatAgent } from './computer';
import { gameDiceOf, hostCommitmentOf, seatCommitmentOf } from './dice';
import type { HostContent, Outbox, RandomBytes, Store, StoreWrite } from './ports';
import { LOG_FORMAT, SNAPSHOT_FORMAT, SNAPSHOT_KEY, logKey, logText, readLogEntry, readSnapshot, snapshotText } from './snapshot';
import type { DiceState, Ended, LogEntry, SeatRecord, Snapshot } from './snapshot';

const CLAIM_LABEL = 'session claim key, version 1\n';
const SEAL_LABEL = 'session token seal, version 1\n';

/** The live host of each store object: a host built later on the same store takes it over. */
const liveHosts = new WeakMap<Store, object>();

export interface HostOptions<S, A, E extends GameEvent, V, Q> {
  readonly content: HostContent<S, A, E, V, Q>;
  readonly store: Store;
  readonly random: RandomBytes;
  /** The agent of each computer seat, by seat. Given again, with the same ids, whenever the host is rebuilt. */
  readonly computers?: Readonly<Record<string, SeatAgent<V, A>>>;
}

export interface CreateOptions<S, A, E extends GameEvent, V, Q> extends HostOptions<S, A, E, V, Q> {
  /** The match id: 1 to 128 of A-Z a-z 0-9 . _ : - (chosen by whoever makes the match; not a secret). */
  readonly match: string;
}

export type OpenResult<S, A, E extends GameEvent, V, Q> =
  | { readonly ok: true; readonly host: MatchHost<S, A, E, V, Q> }
  | { readonly ok: false; readonly refusal: string };

interface Conn {
  readonly id: number;
  readonly outbox: Outbox;
  role: 'new' | 'seat' | 'spectator';
  seat: Seat | null;
  invalid: number;
  /** Closed by the host (budget, replaced, a failed update): it gets no more updates. */
  closed: boolean;
  replaced: boolean;
  /** A computer seat's own connection, inside the host. */
  readonly internal: boolean;
}

/** Dice that keep the rolls they make: one per command, so that a refused command's rolls are never kept. */
class RecordingDice implements Dice {
  readonly rolls: DiceRoll[] = [];
  readonly #inner: Dice;
  constructor(inner: Dice) {
    this.#inner = inner;
  }
  roll(k: number, faces: number): number {
    const face = this.#inner.roll(k, faces);
    this.rolls.push({ k, faces, face });
    return face;
  }
}

/** The outbox of a computer seat's internal connection: it keeps the first message the host sent it since it was cleared (the answer). */
class InternalOutbox implements Outbox {
  last: string | null = null;
  send(text: string): void {
    if (this.last === null) this.last = text;
  }
  close(): void {
    // nothing to close
  }
}

type Commit = { readonly ok: true } | { readonly ok: false; readonly code: 'internal_error' | 'store_failed'; readonly detail: string };

function sealToken(token: Uint8Array, key: Uint8Array): string {
  const pad = wordsToBytes(hmacSha256Words(key, utf8(SEAL_LABEL)));
  const out = new Uint8Array(TOKEN_BYTES);
  for (let i = 0; i < TOKEN_BYTES; i++) out[i] = (token[i] as number) ^ (pad[i] as number);
  return bytesToHex(out);
}

function claimCheckOf(key: Uint8Array): string {
  const label = utf8(CLAIM_LABEL);
  const bytes = new Uint8Array(label.length + key.length);
  bytes.set(label, 0);
  bytes.set(key, label.length);
  return sha256Hex(bytes);
}

function errorText(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.length > 200 ? `${m.slice(0, 197)}...` : m;
}

function isThenable(v: unknown): v is PromiseLike<unknown> {
  return (typeof v === 'object' || typeof v === 'function') && v !== null && typeof (v as { then?: unknown }).then === 'function';
}

/** Draw exactly n bytes from the port, or fail. */
function draw(random: RandomBytes, n: number): Uint8Array {
  const b = random.bytes(n);
  if (!(b instanceof Uint8Array) || b.length !== n) throw new Error(`the random-bytes port gave ${b instanceof Uint8Array ? b.length : 'no'} bytes for ${n}`);
  return new Uint8Array(b);
}

function checkComputers<S, A, E extends GameEvent, V, Q>(opts: HostOptions<S, A, E, V, Q>): string | null {
  const seats = opts.content.ruleset.seats;
  for (const seat of Object.keys(opts.computers ?? {})) {
    if (!seats.includes(seat)) return `computers: '${seat}' is not a seat of this match (seats: ${seats.join(', ')})`;
    const agent = (opts.computers ?? {})[seat];
    if (!agent || typeof agent.decide !== 'function' || typeof agent.id !== 'string' || !AGENT_ID.test(agent.id)) {
      return `computers.${seat}: an agent needs an id (lower-case letters, digits, _ and -) and a decide function`;
    }
  }
  return null;
}

/** Make a new match on an empty store: one store call. Throws for a mistake of the caller's (this is not the pipeline). */
export function createHost<S, A, E extends GameEvent, V, Q>(opts: CreateOptions<S, A, E, V, Q>): MatchHost<S, A, E, V, Q> {
  if (typeof opts.match !== 'string' || !MATCH_ID_PATTERN.test(opts.match)) throw new Error('createHost: a match id is 1 to 128 of A-Z a-z 0-9 . _ : -');
  if (Object.keys(opts.store.load()).length > 0) throw new Error('createHost: the store already holds a match; rebuild it with openHost');
  const bad = checkComputers(opts);
  if (bad !== null) throw new Error(`createHost: ${bad}`);
  const rules = opts.content.ruleset;
  const computers = opts.computers ?? {};
  const secret = draw(opts.random, SECRET_BYTES);
  const seats: SeatRecord[] = [];
  const diceSeats: { seat: string; commitment: string | null; contribution: null }[] = [];
  for (const seat of rules.seats) {
    const agent = computers[seat];
    if (agent) {
      const seedBytes = draw(opts.random, 4);
      const agentSeed = (((seedBytes[0] as number) << 24) | ((seedBytes[1] as number) << 16) | ((seedBytes[2] as number) << 8) | (seedBytes[3] as number)) >>> 0;
      const contribution = draw(opts.random, CONTRIBUTION_BYTES);
      seats.push({ seat, kind: 'computer', agent: agent.id, agentSeed, contribution: bytesToHex(contribution), token: null, claim: null, sealed: null });
      diceSeats.push({ seat, commitment: seatCommitmentOf(opts.match, seat, contribution), contribution: null });
    } else {
      seats.push({ seat, kind: 'person', agent: null, agentSeed: null, contribution: null, token: null, claim: null, sealed: null });
      diceSeats.push({ seat, commitment: null, contribution: null });
    }
  }
  const state = rules.initial();
  const snapshot: Snapshot = {
    format: SNAPSHOT_FORMAT,
    match: opts.match,
    content: { ruleset: opts.content.refs.ruleset, scenario: opts.content.refs.scenario, map: opts.content.refs.map },
    seats,
    dice: {
      stage: diceSeats.every(s => s.commitment !== null) ? 'reveal' : 'commit',
      secret: bytesToHex(secret),
      commitment: hostCommitmentOf(secret),
      seats: diceSeats,
      failed: null,
    },
    initialHash: rules.hash(state),
    seq: 0,
    rolls: 0,
    state,
    ended: null,
  };
  opts.store.commit([{ key: SNAPSHOT_KEY, text: snapshotText(snapshot) }]);
  return new MatchHost(opts, snapshot, []);
}

/** Rebuild a host from what its store holds, and nothing else. Refuses (naming both hashes) when the content handed in is not the match's. */
export function openHost<S, A, E extends GameEvent, V, Q>(opts: HostOptions<S, A, E, V, Q>): OpenResult<S, A, E, V, Q> {
  const refuse = (refusal: string): OpenResult<S, A, E, V, Q> => ({ ok: false, refusal });
  let entries: Readonly<Record<string, string>>;
  try {
    entries = opts.store.load();
  } catch (err) {
    return refuse(`the store could not be read: ${errorText(err)}`);
  }
  const text = Object.prototype.hasOwnProperty.call(entries, SNAPSHOT_KEY) ? entries[SNAPSHOT_KEY] : undefined;
  if (text === undefined) return refuse('the store holds no match');
  const read = readSnapshot(text);
  if (!read.snapshot) return refuse(`the stored snapshot is not readable: ${read.problems.slice(0, 5).join('; ')}`);
  const snap = read.snapshot;
  for (const k of ['ruleset', 'scenario', 'map'] as const) {
    const pinned = snap.content[k];
    const given = opts.content.refs[k];
    if (pinned.id !== given.id || pinned.hash !== given.hash) {
      return refuse(`content_mismatch: ${k} ${pinned.id}: the match is pinned to content hash ${pinned.hash}; the host was handed ${given.id} with content hash ${given.hash}`);
    }
  }
  const rules = opts.content.ruleset;
  if (snap.seats.length !== rules.seats.length || snap.seats.some((s, i) => s.seat !== rules.seats[i])) return refuse('the stored seats are not the ruleset\'s');
  const bad = checkComputers(opts);
  if (bad !== null) return refuse(bad);
  for (const s of snap.seats) {
    const agent = (opts.computers ?? {})[s.seat];
    if (s.kind === 'computer' && (!agent || agent.id !== s.agent)) return refuse(`seat ${s.seat} is played by agent '${s.agent ?? ''}', and no agent with that id was handed in`);
    if (s.kind === 'person' && agent) return refuse(`seat ${s.seat} is a person's seat; it cannot be given an agent now`);
  }
  if (rules.hash(rules.initial()) !== snap.initialHash) return refuse('the ruleset\'s initial state is not the match\'s (initial hash differs)');
  const log: LogEntry[] = [];
  for (let seq = 1; seq <= snap.seq; seq++) {
    const key = logKey(seq);
    const t = Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : undefined;
    if (t === undefined) return refuse(`the store has no ${key}, and the snapshot is at ${snap.seq}`);
    const r = readLogEntry(t, seq);
    if (!r.entry) return refuse(r.problems.slice(0, 5).join('; '));
    log.push(r.entry);
  }
  if (Object.prototype.hasOwnProperty.call(entries, logKey(snap.seq + 1))) return refuse(`the store holds ${logKey(snap.seq + 1)}, past the snapshot`);
  let host: MatchHost<S, A, E, V, Q>;
  try {
    host = new MatchHost(opts, snap, log);
  } catch (err) {
    return refuse(errorText(err));
  }
  return { ok: true, host };
}

export class MatchHost<S, A, E extends GameEvent, V, Q> {
  readonly matchId: string;
  /** One line for every fault: an exception after validation, a failed store call, a computer seat's bad answer. */
  readonly faults: string[] = [];

  readonly #content: HostContent<S, A, E, V, Q>;
  readonly #store: Store;
  readonly #random: RandomBytes;
  readonly #agents: Readonly<Record<string, SeatAgent<V, A>>>;
  readonly #life = {};
  readonly #pins: Snapshot['content'];
  readonly #initialHash: string;

  #seats: readonly SeatRecord[];
  #dice: DiceState;
  #ended: Ended | null;
  #game: Match<S, A, E, V, Q>;
  /** The dice the match rolls on: keyed once every contribution is in, else dice that refuse. */
  #source: Dice;
  #rolls: DiceRoll[];
  /** Command and concession ids each seat has had accepted, with the text of the first answer. */
  readonly #accepted = new Map<Seat, Map<string, string>>();
  /** Ids rejected in this host's life, with the text of the rejection (ruling 16). */
  readonly #rejected = new Map<Seat, Map<string, string>>();
  /** How many actions each seat has had accepted: a computer seat's count of decisions. */
  readonly #decisions = new Map<Seat, number>();

  readonly #conns = new Map<number, Conn>();
  #nextConn = 1;
  readonly #seatConn = new Map<Seat, number>();
  readonly #internal = new Map<Seat, Conn>();
  /** The last view computed for each viewer, with its sequence number. */
  readonly #views = new Map<string, { seq: number; view: V }>();
  #closed = false;

  // computer seats
  readonly #hasComputers: boolean;
  #scheduled = false;
  #work = 0;
  #waiters: (() => void)[] = [];
  readonly #inflight = new Map<Seat, number>();
  readonly #tries = new Map<Seat, { seq: number; n: number }>();

  /** Use createHost or openHost. */
  constructor(opts: HostOptions<S, A, E, V, Q>, snap: Snapshot, log: readonly LogEntry[]) {
    this.#content = opts.content;
    this.#store = opts.store;
    this.#random = opts.random;
    this.#agents = opts.computers ?? {};
    this.matchId = snap.match;
    this.#pins = snap.content;
    this.#initialHash = snap.initialHash;
    this.#seats = snap.seats;
    this.#dice = snap.dice;
    this.#ended = snap.ended;
    const rules = opts.content.ruleset;
    this.#source = snap.dice.stage === 'play' ? this.#keyedDice(snap.dice) : new ThrowingDice();
    const game = new Match(rules, this.#source, snap.state as S, snap.initialHash);
    for (const e of log) {
      const entry: LoggedAction<E> = { seq: e.seq, seat: e.seat, action: e.action, events: e.events as E[], hash: e.hash };
      game.log.push(entry);
    }
    if (rules.hash(game.state) !== game.hash) throw new Error('the stored state does not match the state hash of the last stored action');
    if (snap.ended) game.end({ winner: snap.ended.winner, reason: snap.ended.reason });
    this.#game = game;
    this.#rolls = log.flatMap(e => e.rolls.map(r => ({ k: r.k, faces: r.faces, face: r.face })));
    if (this.#rolls.length !== snap.rolls || this.#rolls.some((r, i) => r.k !== i)) throw new Error('the stored rolls do not run from 0 without a gap');
    for (const e of log) {
      this.#acceptedOf(e.seat).set(e.id, JSON.stringify(this.#acceptedMsg(e.id, e.seq)));
      this.#decisions.set(e.seat, (this.#decisions.get(e.seat) ?? 0) + 1);
    }
    if (snap.ended) this.#acceptedOf(snap.ended.seat).set(snap.ended.id, JSON.stringify(this.#acceptedMsg(snap.ended.id, snap.ended.seq)));
    this.#hasComputers = snap.seats.some(s => s.kind === 'computer');
    liveHosts.set(this.#store, this.#life);
    this.#schedule();
  }

  // -------------------------------------------------------------------------
  // what a test or a driver may read (the host's own side: never sent to a seat)
  // -------------------------------------------------------------------------

  /** How many actions have been accepted. */
  get seq(): number {
    return this.#game.log.length;
  }

  /** The hash of the host's state (the host's: never sent to a connection). */
  get stateHash(): string {
    return this.#game.hash;
  }

  /** The result, once the match is over. */
  get result(): MatchResult | null {
    return this.#game.result();
  }

  get over(): boolean {
    return this.#game.pending().kind === 'over';
  }

  /** Where the dice exchange stands. */
  get diceStage(): DiceState['stage'] {
    return this.#dice.stage;
  }

  /** A viewer's view now, fresh: for a driver or a test on the host's side (a connection is sent views only by the pipeline). */
  viewOf(viewer: Seat | null): V {
    return this.#content.ruleset.view(this.#game.state, viewer);
  }

  /** True once this host was closed, or another host was built on its store. */
  get closed(): boolean {
    return this.#dead();
  }

  /** The record of the match so far: a kernel record/2, the rolls standing in for a seed (ruling 22). The host's: never sent. */
  record(): RolledRecord {
    return rolledRecordOf(this.#game, {
      ruleset: this.#pins.ruleset, scenario: this.#pins.scenario, map: this.#pins.map,
      agents: this.#seats.filter(s => s.kind === 'computer').map(s => ({ seat: s.seat, agent: s.agent as string, seed: s.agentSeed as number })),
      rolls: this.#rolls as RecordedRoll[],
    });
  }

  /** The published dice record, once the match is over; null before. */
  diceRecord(): DiceRecord | null {
    if (!this.over) return null;
    return {
      format: 'dice-record/1',
      match: this.matchId,
      commitment: this.#dice.commitment,
      secret: this.#dice.secret,
      seats: this.#dice.seats.map(s => ({ seat: s.seat, commitment: s.commitment, contribution: s.contribution })),
      rolls: this.#rolls.map(r => ({ k: r.k, faces: r.faces, face: r.face })),
    };
  }

  /** Resolves when no computer seat has work scheduled or an answer being handled. An agent promise still unsettled keeps it waiting. */
  idle(): Promise<void> {
    if (this.#work === 0) return Promise.resolve();
    return new Promise(resolve => this.#waiters.push(resolve));
  }

  /** Stop: answer every message with host_closed, drop agents' late answers, never call the store again. */
  close(): void {
    this.#closed = true;
    this.#finishWork(true);
  }

  // -------------------------------------------------------------------------
  // the entry points
  // -------------------------------------------------------------------------

  /** A connection opened: its outbox. Returns the connection's number, which receive() and disconnect() take. */
  connect(outbox: Outbox): number {
    const id = this.#nextConn++;
    this.#conns.set(id, { id, outbox, role: 'new', seat: null, invalid: 0, closed: false, replaced: false, internal: false });
    return id;
  }

  /** The connection went away. */
  disconnect(conn: number): void {
    const c = this.#conns.get(conn);
    if (!c) return;
    this.#conns.delete(conn);
    if (c.seat !== null && this.#seatConn.get(c.seat) === conn) this.#seatConn.delete(c.seat);
  }

  /** The raw text of one message from one connection. Never throws. */
  receive(conn: number, text: string): void {
    const c = this.#conns.get(conn);
    if (!c) return;
    try {
      this.#pipeline(c, text);
    } catch (err) {
      // Every step catches its own; this is the last guard.
      this.#fault(`unexpected: ${errorText(err)}`);
    }
    this.#schedule();
  }

  // -------------------------------------------------------------------------
  // the pipeline
  // -------------------------------------------------------------------------

  #pipeline(c: Conn, text: unknown): void {
    if (this.#dead()) {
      this.#reply(c, this.#rejection(null, 'host_closed', 'this host is closed: connect again'));
      return;
    }
    // 1. size, before anything reads the text.
    if (typeof text !== 'string') {
      this.#invalid(c, 'not_json', 'a message is JSON text');
      return;
    }
    if (tooLarge(text)) {
      this.#invalid(c, 'too_large', `a message is at most ${16 * 1024} bytes of UTF-8`);
      return;
    }
    // 2. parse.
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      this.#invalid(c, 'not_json', 'the message is not JSON text');
      return;
    }
    // 3. validate.
    const v = validateClientMessage(raw);
    if (!v.ok) {
      const shown = v.problems.slice(0, 3).join('; ');
      this.#invalid(c, 'invalid', v.problems.length > 3 ? `${shown}; and ${v.problems.length - 3} more` : shown);
      return;
    }
    const m = v.message;
    const id = m.kind === 'command' || m.kind === 'concede' ? m.id : null;
    // 4. the budget.
    if (c.invalid >= INVALID_MESSAGE_BUDGET) {
      this.#reply(c, this.#rejection(id, 'budget_spent', `this connection sent ${c.invalid} messages that could not be read; join again on a new connection`));
      return;
    }
    // From here an exception is a typed rejection, a fault line, and no change.
    try {
      this.#dispatch(c, m);
    } catch (err) {
      this.#fault(`${m.kind} on connection ${c.id}: ${errorText(err)}`);
      this.#reply(c, this.#rejection(id, 'internal_error', 'the host failed while judging this message; nothing changed'));
    }
  }

  #invalid(c: Conn, code: ProtocolRejectionCode, detail: string): void {
    c.invalid += 1;
    this.#reply(c, this.#rejection(null, code, detail));
    if (c.invalid === INVALID_MESSAGE_BUDGET) this.#shut(c, 'invalid_budget');
  }

  #dispatch(c: Conn, m: ClientMessage): void {
    // 5. who is sending.
    if (c.replaced) {
      this.#reply(c, this.#rejection(m.kind === 'command' || m.kind === 'concede' ? m.id : null, 'replaced', 'a newer connection took this seat over'));
      return;
    }
    switch (m.kind) {
      case 'claim': return this.#claim(c, m);
      case 'resume': return this.#resume(c, m);
      case 'watch': return this.#watch(c, m);
      case 'sync':
        if (c.role === 'new') return this.#reply(c, this.#rejection(null, 'not_joined', 'claim, resume or watch first'));
        this.#sendText(c, this.#viewText(c, m.since));
        return;
      default: break;
    }
    const id = m.kind === 'command' || m.kind === 'concede' ? m.id : null;
    if (c.role === 'new') return this.#reply(c, this.#rejection(id, 'not_joined', 'claim or resume a seat first'));
    if (c.role === 'spectator' || c.seat === null) return this.#reply(c, this.#rejection(id, 'spectator', 'a spectator may only ask for its view'));
    const seat = c.seat;
    switch (m.kind) {
      case 'command': return this.#command(c, seat, m);
      case 'concede': return this.#concede(c, seat, m);
      case 'dice_commit': return this.#diceCommit(c, seat, m.commitment);
      case 'dice_reveal': return this.#diceReveal(c, seat, m.contribution);
    }
  }

  // ---- joining ------------------------------------------------------------

  #helloProblem(m: ClaimMessage | ResumeMessage | WatchMessage): RejectedMessage | null {
    if (m.protocol !== PROTOCOL_VERSION) return this.#rejection(null, 'protocol_version', `this host speaks protocol ${PROTOCOL_VERSION}, the client ${m.protocol}`);
    if (m.match !== this.matchId) return this.#rejection(null, 'wrong_match', 'this host serves another match');
    const wrong: string[] = [];
    for (const k of ['ruleset', 'scenario', 'map'] as const) {
      const pin = this.#pins[k];
      const theirs = (m.content as ContentPins)[k];
      if (theirs !== pin.hash) wrong.push(`${k} ${pin.id}: the match is pinned to content hash ${pin.hash}, the client holds content hash ${theirs}`);
    }
    if (wrong.length > 0) return this.#rejection(null, 'content_mismatch', wrong.join('; '));
    return null;
  }

  #claim(c: Conn, m: ClaimMessage): void {
    if (c.role !== 'new') return this.#reply(c, this.#rejection(null, 'already_joined', 'this connection has already joined'));
    const hello = this.#helloProblem(m);
    if (hello) return this.#reply(c, hello);
    const index = this.#seats.findIndex(s => s.seat === m.seat);
    const rec = this.#seats[index];
    if (!rec) return this.#reply(c, this.#rejection(null, 'unknown_seat', `no seat of this match has that name (seats: ${this.#seats.map(s => s.seat).join(', ')})`));
    if (rec.kind === 'computer') return this.#reply(c, this.#rejection(null, 'computer_seat', `${rec.seat} is played by the host's computer`));
    const key = hexToBytes(m.key);
    const check = claimCheckOf(key);
    if (rec.token !== null) {
      if (rec.claim !== check || rec.sealed === null) return this.#reply(c, this.#rejection(null, 'seat_taken', `${rec.seat} is already claimed`));
      // The claimant again (its answer was lost): the same welcome, the same token.
      const token = hexToBytes(sealToken(hexToBytes(rec.sealed), key));
      this.#bind(c, rec.seat);
      this.#joined(c, bytesToHex(token), null);
      return;
    }
    const token = draw(this.#random, TOKEN_BYTES);
    const seats = this.#seats.map((s, i) => (i === index ? { ...s, token: sha256Hex(token), claim: check, sealed: sealToken(token, key) } : s));
    const done = this.#commit({ seats });
    if (!done.ok) return this.#reply(c, this.#rejection(null, done.code, done.detail));
    this.#seats = seats;
    this.#bind(c, rec.seat);
    this.#joined(c, bytesToHex(token), null);
  }

  #resume(c: Conn, m: ResumeMessage): void {
    if (c.role !== 'new') return this.#reply(c, this.#rejection(null, 'already_joined', 'this connection has already joined'));
    const hello = this.#helloProblem(m);
    if (hello) return this.#reply(c, hello);
    const hash = sha256Hex(hexToBytes(m.token));
    const rec = this.#seats.find(s => s.token !== null && s.token === hash);
    if (!rec) return this.#reply(c, this.#rejection(null, 'bad_token', 'no seat of this match has that token'));
    this.#bind(c, rec.seat);
    this.#joined(c, null, m.since);
  }

  #watch(c: Conn, m: WatchMessage): void {
    if (c.role !== 'new') return this.#reply(c, this.#rejection(null, 'already_joined', 'this connection has already joined'));
    const hello = this.#helloProblem(m);
    if (hello) return this.#reply(c, hello);
    c.role = 'spectator';
    this.#joined(c, null, m.since);
  }

  /** Bind a connection to a seat. The seat's older connection, if any, is told it was replaced and closed. */
  #bind(c: Conn, seat: Seat): void {
    const old = this.#seatConn.get(seat);
    if (old !== undefined && old !== c.id) {
      const o = this.#conns.get(old);
      if (o) {
        o.replaced = true;
        this.#shut(o, 'replaced');
      }
    }
    c.role = 'seat';
    c.seat = seat;
    this.#seatConn.set(seat, c.id);
  }

  /**
   * A connection joined: its welcome, then its whole view. A claim has been
   * stored by now, so a failure here is a fault line and the connection is
   * closed, to rejoin (ruling 20).
   */
  #joined(c: Conn, token: string | null, since: number | null): void {
    let welcome: string;
    let view: string;
    try {
      const over = this.over;
      const msg: WelcomeMessage = {
        kind: 'welcome', protocol: PROTOCOL_VERSION, match: this.matchId, seat: c.seat, token,
        seats: this.#seats.map(s => s.seat), dice: this.#diceStatus(),
        result: over ? this.#resultBody() : null, record: over ? this.diceRecord() : null,
      };
      welcome = JSON.stringify(msg);
      view = this.#viewText(c, since);
    } catch (err) {
      this.#fault(`the welcome of connection ${c.id} could not be made: ${errorText(err)}`);
      this.#shut(c, 'update_failed');
      return;
    }
    if (this.#sendText(c, welcome)) this.#sendText(c, view);
  }

  /** The whole view for a connection, with the events of the actions after `since` (ruling 15). Throws when the ruleset does. */
  #viewText(c: Conn, since: number | null): string {
    const viewer = c.role === 'seat' ? c.seat : null;
    const seq = this.seq;
    const view = this.#viewNow(viewer);
    let actions: ActionEvents[] | null = null;
    let omitted = false;
    if (since !== null) {
      if (seq - since > REJOIN_EVENT_LIMIT) omitted = true;
      else {
        actions = [];
        for (let s = since + 1; s <= seq; s++) actions.push({ seq: s, events: this.#eventsFor(this.#game.log[s - 1] as LoggedAction<E>, viewer) });
      }
    }
    const msg: ViewMessage = { kind: 'view', seq, view, hash: viewHash(viewer, view), since, actions, omitted };
    return JSON.stringify(msg);
  }

  // ---- commands -----------------------------------------------------------

  /** Step 6: a repeat of an id gets its first answer. True when it was one. */
  #repeat(c: Conn, seat: Seat, id: string): boolean {
    const first = this.#accepted.get(seat)?.get(id) ?? this.#rejected.get(seat)?.get(id);
    if (first === undefined) return false;
    this.#sendText(c, first);
    return true;
  }

  /** Step 7, for a command: null when the seat is due, else the rejection. */
  #notDue(seat: Seat, id: string): RejectedMessage | null {
    if (this.#ended !== null || this.#game.pending().kind === 'over') return this.#rejection(id, 'game_over', 'the match is over');
    if (this.#dice.stage === 'failed') return this.#rejection(id, 'dice_failed', this.#failedText());
    if (this.#dice.stage !== 'play') return this.#rejection(id, 'dice_waiting', `the match has not started: ${this.#waitingText()}`);
    const pend: Decision = this.#game.pending();
    if (pend.kind !== 'decide' || !pend.seats.includes(seat)) return this.#rejection(id, 'not_your_turn', `${seat} is not due to decide`);
    return null;
  }

  #command(c: Conn, seat: Seat, m: CommandMessage): void {
    if (this.#repeat(c, seat, m.id)) return;
    const due = this.#notDue(seat, m.id);
    if (due) return this.#refuse(c, seat, due);
    const pend = this.#game.pending();
    if (pend.kind === 'decide' && pend.seats.length === 1 && m.seq !== this.seq) {
      return this.#refuse(c, seat, this.#rejection(m.id, 'stale', `the command was chosen at sequence number ${m.seq}; the match is at ${this.seq}`));
    }
    // 9. submit, on a copy whose dice keep their rolls: nothing of a refused command is kept.
    const dice = new RecordingDice(this.#source);
    const trial = this.#game.fork(dice);
    let res: ReturnType<typeof trial.submit>;
    try {
      res = trial.submit(seat, m.action);
    } catch (err) {
      this.#fault(`seq ${this.seq + 1}: ${seat} command ${m.id}: submit threw: ${errorText(err)}`);
      return this.#reply(c, this.#rejection(m.id, 'internal_error', 'the host failed while applying this command; nothing changed; it may be sent again'));
    }
    if (!res.ok) return this.#refuse(c, seat, this.#rejection(m.id, res.rejection.code, res.rejection.detail));
    const entry = trial.log[trial.log.length - 1] as LoggedAction<E>;
    const log: LogEntry = {
      format: LOG_FORMAT, seq: entry.seq, seat, id: m.id, action: entry.action, events: entry.events, hash: entry.hash, rolls: dice.rolls,
    };
    // 10. store.
    const done = this.#commit({ game: trial, rolls: this.#rolls.length + dice.rolls.length }, log);
    if (!done.ok) return this.#reply(c, this.#rejection(m.id, done.code, done.detail));
    const before = this.#game.state;
    this.#game = trial;
    for (const r of dice.rolls) this.#rolls.push(r);
    const answer = JSON.stringify(this.#acceptedMsg(m.id, entry.seq));
    this.#acceptedOf(seat).set(m.id, answer);
    this.#decisions.set(seat, (this.#decisions.get(seat) ?? 0) + 1);
    // 11. announce: every connection's update, then the sender's answer.
    this.#announceAction(before, entry);
    if (!c.closed) this.#sendText(c, answer);
    if (this.over) this.#announceOver();
  }

  #concede(c: Conn, seat: Seat, m: ConcedeMessage): void {
    if (this.#repeat(c, seat, m.id)) return;
    if (this.#ended !== null || this.#game.pending().kind === 'over') return this.#refuse(c, seat, this.#rejection(m.id, 'game_over', 'the match is over'));
    if (this.#dice.stage === 'failed') return this.#refuse(c, seat, this.#rejection(m.id, 'dice_failed', this.#failedText()));
    const others = this.#seats.filter(s => s.seat !== seat).map(s => s.seat);
    const winner = others.length === 1 ? (others[0] as Seat) : null;
    const ended: Ended = { winner, reason: 'concession', seat, id: m.id, seq: this.seq };
    const done = this.#commit({ ended });
    if (!done.ok) return this.#reply(c, this.#rejection(m.id, done.code, done.detail));
    this.#ended = ended;
    this.#game.end({ winner, reason: ended.reason });
    const answer = JSON.stringify(this.#acceptedMsg(m.id, ended.seq));
    this.#acceptedOf(seat).set(m.id, answer);
    this.#sendText(c, answer);
    this.#announceOver();
  }

  // ---- the dice exchange --------------------------------------------------

  #diceGate(): RejectedMessage | null {
    if (this.#ended !== null || this.#game.pending().kind === 'over') return this.#rejection(null, 'game_over', 'the match is over');
    if (this.#dice.stage === 'failed') return this.#rejection(null, 'dice_failed', this.#failedText());
    return null;
  }

  #diceCommit(c: Conn, seat: Seat, commitment: string): void {
    const gate = this.#diceGate();
    if (gate) return this.#reply(c, gate);
    const i = this.#dice.seats.findIndex(s => s.seat === seat);
    const mine = this.#dice.seats[i] as DiceState['seats'][number];
    if (mine.commitment !== null) {
      if (mine.commitment === commitment) return this.#reply(c, { kind: 'dice_ok', step: 'commit' });
      return this.#reply(c, this.#rejection(null, 'already_committed', `${seat} has already committed; the first commitment stands`));
    }
    if (this.#dice.stage !== 'commit') return this.#reply(c, this.#rejection(null, 'dice_wrong_stage', 'the commitments are closed'));
    const seats = this.#dice.seats.map((s, k) => (k === i ? { ...s, commitment } : s));
    const all = seats.every(s => s.commitment !== null);
    const dice: DiceState = { ...this.#dice, seats, stage: all ? 'reveal' : 'commit' };
    const done = this.#commit({ dice });
    if (!done.ok) return this.#reply(c, this.#rejection(null, done.code, done.detail));
    this.#dice = dice;
    this.#reply(c, { kind: 'dice_ok', step: 'commit' });
    if (all) this.#announceDice();
  }

  #diceReveal(c: Conn, seat: Seat, contribution: string): void {
    const gate = this.#diceGate();
    if (gate) return this.#reply(c, gate);
    const i = this.#dice.seats.findIndex(s => s.seat === seat);
    const mine = this.#dice.seats[i] as DiceState['seats'][number];
    if (mine.contribution !== null) {
      if (mine.contribution === contribution) return this.#reply(c, { kind: 'dice_ok', step: 'reveal' });
      return this.#reply(c, this.#rejection(null, 'already_revealed', `${seat} has already revealed`));
    }
    if (this.#dice.stage === 'commit') return this.#reply(c, this.#rejection(null, 'dice_not_ready', `a reveal waits until every commitment is stored: ${this.#waitingText()}`));
    if (this.#dice.stage !== 'reveal') return this.#reply(c, this.#rejection(null, 'dice_wrong_stage', 'the reveals are closed'));
    if (seatCommitmentOf(this.matchId, seat, hexToBytes(contribution)) !== mine.commitment) {
      // A reveal that is not what was committed: the match will not start. Stored, then every connection told.
      const failed: DiceState = { ...this.#dice, stage: 'failed', failed: { seat, reason: 'reveal_mismatch' } };
      const done = this.#commit({ dice: failed });
      if (!done.ok) return this.#reply(c, this.#rejection(null, done.code, done.detail));
      this.#dice = failed;
      this.#announceDice();
      return;
    }
    const seats = this.#dice.seats.map((s, k) => (k === i ? { ...s, contribution } : s));
    const all = seats.every(s => s.contribution !== null);
    const dice: DiceState = { ...this.#dice, seats, stage: all ? 'play' : 'reveal' };
    const source = all ? this.#keyedDice(dice) : null;
    const done = this.#commit({ dice });
    if (!done.ok) return this.#reply(c, this.#rejection(null, done.code, done.detail));
    this.#dice = dice;
    if (source) {
      this.#source = source;
      this.#game = this.#game.fork(source);
    }
    this.#reply(c, { kind: 'dice_ok', step: 'reveal' });
    if (all) this.#announceDice();
  }

  #keyedDice(d: DiceState): Dice {
    return gameDiceOf(this.matchId, hexToBytes(d.secret), d.seats.map(s => [s.seat, s.contribution as string] as const));
  }

  #diceStatus(): DiceStatus {
    const d = this.#dice;
    return {
      match: this.matchId, commitment: d.commitment, stage: d.stage,
      committed: d.seats.filter(s => s.commitment !== null).map(s => s.seat),
      revealed: d.seats.filter(s => s.contribution !== null).map(s => s.seat),
      failed: d.failed,
    };
  }

  #waitingText(): string {
    const d = this.#dice;
    if (d.stage === 'commit') return `waiting for the dice commitment of ${d.seats.filter(s => s.commitment === null).map(s => s.seat).join(', ')}`;
    return `waiting for the dice reveal of ${d.seats.filter(s => s.contribution === null).map(s => s.seat).join(', ')}`;
  }

  #failedText(): string {
    const f = this.#dice.failed;
    return f ? `the match will not start: ${f.seat}'s reveal did not match its commitment` : 'the match will not start';
  }

  // ---- storing --------------------------------------------------------------

  /** One store call: the snapshot as it would be with these changes, and the log entry. Nothing in memory changes here. */
  #commit(next: { seats?: readonly SeatRecord[]; dice?: DiceState; ended?: Ended; game?: Match<S, A, E, V, Q>; rolls?: number }, log?: LogEntry): Commit {
    let writes: StoreWrite[];
    try {
      const game = next.game ?? this.#game;
      const snap: Snapshot = {
        format: SNAPSHOT_FORMAT,
        match: this.matchId,
        content: this.#pins,
        seats: next.seats ?? this.#seats,
        dice: next.dice ?? this.#dice,
        initialHash: this.#initialHash,
        seq: game.log.length,
        rolls: next.rolls ?? this.#rolls.length,
        state: game.state,
        ended: next.ended ?? this.#ended,
      };
      writes = [{ key: SNAPSHOT_KEY, text: snapshotText(snap) }];
      if (log) writes.push({ key: logKey(log.seq), text: logText(log) });
    } catch (err) {
      this.#fault(`seq ${this.seq}: the stored text could not be made: ${errorText(err)}`);
      return { ok: false, code: 'internal_error', detail: 'the host failed while storing this message; nothing changed; it may be sent again' };
    }
    try {
      this.#store.commit(writes);
    } catch (err) {
      this.#fault(`seq ${this.seq}: the store refused a commit: ${errorText(err)}`);
      return { ok: false, code: 'store_failed', detail: 'the store refused to commit; nothing changed; it may be sent again' };
    }
    return { ok: true };
  }

  // ---- announcing -----------------------------------------------------------

  /** The connections that hear about the match: joined, open, and not a computer seat's own. */
  #audience(): Conn[] {
    const out: Conn[] = [];
    for (const c of this.#conns.values()) if (c.role !== 'new' && !c.closed && !c.internal) out.push(c);
    return out;
  }

  #eventsFor(entry: LoggedAction<E>, viewer: Seat | null): unknown[] {
    const out: unknown[] = [];
    for (const e of entry.events) {
      const seen = this.#content.ruleset.eventFor(e, viewer);
      if (seen !== null) out.push(seen);
    }
    return out;
  }

  /** The view now for a viewer, from the cache when it is current. */
  #viewNow(viewer: Seat | null): V {
    const label = viewerLabel(viewer);
    const hit = this.#views.get(label);
    if (hit && hit.seq === this.seq) return hit.view;
    const view = this.#content.ruleset.view(this.#game.state, viewer);
    this.#views.set(label, { seq: this.seq, view });
    return view;
  }

  /**
   * The steps of one viewer's update (UpdateMessage.steps): its view after each event it sees, as a
   * change from the one before; null when they would say nothing (every one of those views is the
   * view at the action's end). `after` gives the state after each event of the action.
   */
  #stepsFor(entry: LoggedAction<E>, viewer: Seat | null, prev: V, next: V, after: () => readonly S[]): (Change | null)[] | null {
    const rules = this.#content.ruleset;
    const shown: number[] = [];
    entry.events.forEach((e, k) => {
      if (rules.eventFor(e, viewer) !== null) shown.push(k);
    });
    // None seen, or one seen and it is the last: the view after it is the view at the end.
    if (shown.length === 0 || (shown.length === 1 && shown[0] === entry.events.length - 1)) return null;
    const states = after();
    const views = shown.map(k => rules.view(states[k] as S, viewer));
    if (views.every(v => diffJson(v, next) === null)) return null;
    const steps: (Change | null)[] = [];
    let last = prev;
    for (const v of views) {
      steps.push(diffJson(last, v));
      last = v;
    }
    return steps;
  }

  /** One update to every connection: its viewer's events, the change to its view, the new view's hash (ruling 7); and the view after each event, when it says something (`steps`). */
  #announceAction(before: S, entry: LoggedAction<E>): void {
    const rules = this.#content.ruleset;
    const made = new Map<string, { text: string } | { error: string }>();
    const fresh = new Map<string, { seq: number; view: V }>();
    // The state after each event of the action, replayed once, the first time a viewer's steps need it.
    let states: S[] | null = null;
    const after = (): readonly S[] => {
      if (states === null) {
        const out: S[] = [];
        let s = before;
        for (const e of entry.events) {
          s = rules.reduce(s, [e]);
          out.push(s);
        }
        states = out;
      }
      return states;
    };
    for (const c of this.#audience()) {
      const viewer = c.role === 'seat' ? c.seat : null;
      const label = viewerLabel(viewer);
      let out = made.get(label);
      if (out === undefined) {
        try {
          const hit = this.#views.get(label);
          const prev = hit && hit.seq === entry.seq - 1 ? hit.view : rules.view(before, viewer);
          const next = rules.view(this.#game.state, viewer);
          const steps = this.#stepsFor(entry, viewer, prev, next, after);
          const msg: UpdateMessage = {
            kind: 'update', seq: entry.seq, events: this.#eventsFor(entry, viewer), change: diffJson(prev, next), hash: viewHash(viewer, next),
            ...(steps !== null ? { steps } : {}),
          };
          out = { text: JSON.stringify(msg) };
          fresh.set(label, { seq: entry.seq, view: next });
        } catch (err) {
          out = { error: errorText(err) };
        }
        made.set(label, out);
      }
      if ('error' in out) {
        this.#fault(`seq ${entry.seq}: the update for connection ${c.id} (${label}) could not be made: ${out.error}`);
        this.#shut(c, 'update_failed');
        continue;
      }
      this.#sendText(c, out.text);
    }
    this.#views.clear();
    for (const [label, v] of fresh) this.#views.set(label, v);
  }

  #announceDice(): void {
    const text = JSON.stringify({ kind: 'dice', status: this.#diceStatus() });
    for (const c of this.#audience()) this.#sendText(c, text);
  }

  #resultBody(): { winner: Seat | null; reason: string } {
    const r = this.#game.result() as MatchResult;
    return { winner: r.winner, reason: r.reason };
  }

  #announceOver(): void {
    let text: string;
    try {
      text = JSON.stringify({ kind: 'over', result: this.#resultBody(), record: this.diceRecord() });
    } catch (err) {
      this.#fault(`the end of the match could not be announced: ${errorText(err)}`);
      return;
    }
    for (const c of this.#audience()) this.#sendText(c, text);
  }

  // ---- answers and connections ---------------------------------------------

  #rejection(id: string | null, code: string, detail: string): RejectedMessage {
    // A ruleset's detail can name keys of the action it refused: kept short.
    return { kind: 'rejected', id, code, detail: detail.length > 300 ? `${detail.slice(0, 297)}...` : detail };
  }

  #acceptedMsg(id: string, seq: number): AcceptedMessage {
    return { kind: 'accepted', id, seq };
  }

  #acceptedOf(seat: Seat): Map<string, string> {
    let m = this.#accepted.get(seat);
    if (!m) {
      m = new Map();
      this.#accepted.set(seat, m);
    }
    return m;
  }

  /** A rejection of a seat's command or concession: remembered for a repeat of its id in this host's life, unless the cause was the host's. */
  #refuse(c: Conn, seat: Seat, r: RejectedMessage): void {
    const text = JSON.stringify(r);
    if (r.id !== null && !(PASSING_CODES as readonly string[]).includes(r.code) && !(INVALID_CODES as readonly string[]).includes(r.code)) {
      let m = this.#rejected.get(seat);
      if (!m) {
        m = new Map();
        this.#rejected.set(seat, m);
      }
      if (m.size >= 4096) m.delete(m.keys().next().value as string);
      m.set(r.id, text);
    }
    this.#sendText(c, text);
  }

  #reply(c: Conn, msg: HostMessage): void {
    let text: string;
    try {
      text = JSON.stringify(msg);
    } catch (err) {
      this.#fault(`a message to connection ${c.id} could not be written: ${errorText(err)}`);
      return;
    }
    this.#sendText(c, text);
  }

  #sendText(c: Conn, text: string): boolean {
    try {
      c.outbox.send(text);
      return true;
    } catch (err) {
      this.#fault(`the outbox of connection ${c.id} failed: ${errorText(err)}`);
      if (!c.closed) this.#shut(c, 'update_failed');
      return false;
    }
  }

  /** Close a connection: tell it why, close its outbox, and free its seat. */
  #shut(c: Conn, reason: CloseReason): void {
    if (c.closed) return;
    c.closed = true;
    if (c.seat !== null && this.#seatConn.get(c.seat) === c.id) this.#seatConn.delete(c.seat);
    try {
      c.outbox.send(JSON.stringify({ kind: 'closed', reason }));
      c.outbox.close(reason);
    } catch (err) {
      this.#fault(`closing connection ${c.id}: ${errorText(err)}`);
    }
  }

  #fault(line: string): void {
    this.faults.push(line);
  }

  #dead(): boolean {
    return this.#closed || liveHosts.get(this.#store) !== this.#life;
  }

  // -------------------------------------------------------------------------
  // computer seats
  // -------------------------------------------------------------------------

  #schedule(): void {
    if (!this.#hasComputers || this.#scheduled || this.#dead()) return;
    this.#scheduled = true;
    this.#work += 1;
    void Promise.resolve().then(() => {
      this.#scheduled = false;
      try {
        this.#drive();
      } catch (err) {
        this.#fault(`computer seats: ${errorText(err)}`);
      }
      this.#endWork();
    });
  }

  #endWork(): void {
    this.#work -= 1;
    if (this.#work <= 0) this.#finishWork(false);
  }

  #finishWork(all: boolean): void {
    if (all) this.#work = 0;
    if (this.#work > 0) return;
    const waiters = this.#waiters;
    this.#waiters = [];
    for (const w of waiters) w();
  }

  /** The internal connection a computer seat's messages enter on; a new one when the old one is closed. */
  #internalConn(seat: Seat): Conn {
    let c = this.#internal.get(seat);
    if (!c || c.closed) {
      const id = this.#nextConn++;
      c = { id, outbox: new InternalOutbox(), role: 'seat', seat, invalid: 0, closed: false, replaced: false, internal: true };
      this.#conns.set(id, c);
      this.#internal.set(seat, c);
    }
    return c;
  }

  /** Send a computer seat's message through the pipeline; the host's answer to it. */
  #asComputer(seat: Seat, text: string): HostMessage | null {
    const c = this.#internalConn(seat);
    const out = c.outbox as InternalOutbox;
    out.last = null;
    this.#pipeline(c, text);
    if (out.last === null) return null;
    return JSON.parse(out.last) as HostMessage;
  }

  #drive(): void {
    if (this.#dead()) return;
    const rules = this.#content.ruleset;
    this.#seats.forEach((rec, index) => {
      if (rec.kind !== 'computer' || this.#dead()) return;
      const seat = rec.seat;
      if (this.#ended !== null || this.over || this.#dice.stage === 'failed') return;
      const mine = this.#dice.seats[index];
      if (this.#dice.stage === 'reveal' && mine && mine.contribution === null && rec.contribution !== null) {
        const reply = this.#asComputer(seat, JSON.stringify({ kind: 'dice_reveal', contribution: rec.contribution }));
        // Once revealed, the seat may be due at the start of play. A refused reveal (a failing store)
        // is tried again only after the next message, so that a broken store cannot spin.
        if (reply && reply.kind === 'dice_ok') this.#schedule();
        else this.#fault(`computer seat ${seat}'s reveal was not taken: ${reply && reply.kind === 'rejected' ? reply.code : 'no answer'}`);
        return;
      }
      if (this.#dice.stage !== 'play' || this.#inflight.has(seat)) return;
      const pend = this.#game.pending();
      if (pend.kind !== 'decide' || !pend.seats.includes(seat)) return;
      const asked = this.seq;
      const tries = this.#tries.get(seat);
      if (tries && tries.seq === asked && tries.n >= COMPUTER_TRIES) return;
      const agent = this.#agents[seat] as SeatAgent<V, A>;
      const decision = this.#decisions.get(seat) ?? 0;
      let answer: unknown;
      try {
        const view = rules.view(this.#game.state, seat);
        const legal = rules.legalActions(rules.view(this.#game.state, seat));
        answer = agent.decide(view, legal, computerStream(rec.agentSeed as number, index, decision));
      } catch (err) {
        this.#fault(`seq ${asked}: computer seat ${seat}'s agent failed: ${errorText(err)}`);
        this.#tried(seat, asked);
        this.#schedule();
        return;
      }
      if (isThenable(answer)) {
        this.#inflight.set(seat, asked);
        this.#work += 1;
        Promise.resolve(answer).then(
          action => this.#answered(seat, asked, decision, action),
          err => {
            this.#inflight.delete(seat);
            if (!this.#dead()) {
              this.#fault(`seq ${asked}: computer seat ${seat}'s agent failed: ${errorText(err)}`);
              this.#tried(seat, asked);
              this.#schedule();
            }
          },
        ).then(() => this.#endWork(), () => this.#endWork());
        return;
      }
      this.#answered(seat, asked, decision, answer);
    });
  }

  #tried(seat: Seat, seq: number): number {
    const t = this.#tries.get(seat);
    const n = t && t.seq === seq ? t.n + 1 : 1;
    this.#tries.set(seat, { seq, n });
    return n;
  }

  #answered(seat: Seat, asked: number, decision: number, action: unknown): void {
    this.#inflight.delete(seat);
    if (this.#dead()) return;
    // Dropped when the position moved on (ruling 26): the seat is asked again, once, if still due.
    const pend = this.#game.pending();
    if (this.seq !== asked || (this.#decisions.get(seat) ?? 0) !== decision || pend.kind !== 'decide' || !pend.seats.includes(seat)) {
      this.#schedule();
      return;
    }
    const t = this.#tries.get(seat);
    const attempt = t && t.seq === asked ? t.n : 0;
    let text: string;
    try {
      text = JSON.stringify({ kind: 'command', id: `cpu.${decision}.${attempt}`, seq: asked, action });
      if (typeof text !== 'string') throw new Error('the answer is not data');
    } catch (err) {
      this.#fault(`seq ${asked}: computer seat ${seat}'s answer cannot be sent: ${errorText(err)}`);
      this.#tried(seat, asked);
      this.#schedule();
      return;
    }
    const reply = this.#asComputer(seat, text);
    if (reply && reply.kind === 'rejected') {
      this.#fault(`seq ${asked}: computer seat ${seat}'s answer was refused: ${reply.code}: ${reply.detail}`);
      this.#tried(seat, asked);
    }
    this.#schedule();
  }
}
