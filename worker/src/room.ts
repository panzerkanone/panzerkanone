/**
 * One game played by shared links: the session core's host (session/host.ts) on a store of the
 * room's own, with sockets for its connections. No platform here: the Durable Object (index.ts)
 * hands the room its tables, its random bytes, its clock and its sockets, and the tests hand it
 * memory and fakes (tests/net/).
 *
 *   room.create(match, body)   make the game: { scenario, invites: [check, check] } (the check of each seat's link, by seat order)
 *   room.info()                what a page needs before it joins: the scenario, the seats, whether the game is over
 *   room.accept(socket)        a socket was opened: it is a connection of the host
 *   room.message(socket, text) one message from it, as text
 *   room.closed(socket)        it went away
 *
 * The host is built on first need (openHost, from the store alone) and kept while the Durable
 * Object is in memory. When the object has slept (hibernation keeps the sockets open while it is
 * out of memory) the host is built again, and every socket still open joins it again as it first
 * joined, by the join message it sent, which the socket carries in its tag; what the host answers
 * to that is not sent, as the page has had it. So a page notices nothing of the object's sleep.
 *
 * A claim passes only with a key that gives the seat's invitation check (session/invite.ts), so a
 * seat can be taken only by its link. Everything else is the host's, as it stands: the pipeline,
 * the views and events each seat may see, the dice exchange, rejoining by token.
 */
import { bytesToHex } from '../../protocol/check';
import { tooLarge } from '../../protocol/limits';
import { createHost, openHost } from '../../session/host';
import type { MatchHost } from '../../session/host';
import { inviteCheckOf } from '../../session/invite';
import type { Outbox, RandomBytes, Store, StoreWrite } from '../../session/ports';
import type { ImpulseAction, ImpulseEvent, ImpulseState, ImpulseView, OutcomeQuery } from '../../engine/rulesets/impulse/types';
import type { Loaded } from './scenarios';

type Host = MatchHost<ImpulseState, ImpulseAction, ImpulseEvent, ImpulseView, OutcomeQuery>;

/** How long a game nobody has opened is kept: fourteen days. */
export const KEEP_MS = 14 * 24 * 60 * 60 * 1000;

/** The key of the room's own facts in its table. */
export const FACTS_KEY = 'room';
const FACTS_FORMAT = 'room/1';

/** A table of JSON text under keys: the Durable Object's SQLite, or memory. */
export interface Table {
  /** Every key and its text. */
  all(): Readonly<Record<string, string>>;
  get(key: string): string | null;
  /** Writes every key given, all or none. */
  put(writes: readonly StoreWrite[]): void;
}

/** What a socket carries through the object's sleep: its id, when it joined, and the join message the host took from it. */
export interface SocketTag {
  readonly id: string;
  readonly at: number;
  readonly hello: string | null;
}

export interface RoomSocket {
  send(text: string): void;
  close(code: number, reason: string): void;
  tag(): SocketTag | null;
  setTag(tag: SocketTag): void;
}

export interface RoomPorts {
  /** The session core's store: what the host keeps. */
  readonly session: Table;
  /** The room's own facts. */
  readonly room: Table;
  readonly random: RandomBytes;
  now(): number;
  /** Every socket open now, those opened before the object slept among them. */
  sockets(): readonly RoomSocket[];
  /** A scenario's content by its id. */
  content(scenario: string): Loaded;
  /** A line for the operator's log (a fault of the host's). */
  log?(line: string): void;
}

/** What the room keeps of itself. */
interface Facts {
  readonly format: typeof FACTS_FORMAT;
  readonly match: string;
  readonly scenario: string;
  /** The seats, in order of play. */
  readonly seats: readonly string[];
  /** Each seat's invitation check, in the same order. */
  readonly invites: readonly string[];
  readonly made: number;
}

export interface Reply {
  readonly status: number;
  readonly body: unknown;
}

/** The close code of each reason a host closes a connection with; 4000 and up are the application's own. */
const CLOSE_CODES: Readonly<Record<string, number>> = { invalid_budget: 4001, replaced: 4002, update_failed: 4003, host_closed: 4004 };

const JOIN_KINDS = ['claim', 'resume', 'watch'];
const HEX64 = /^[0-9a-f]{64}$/;
const HEX32 = /^[0-9a-f]{32}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readFacts(text: string | null): Facts | null {
  if (text === null) return null;
  try {
    const raw: unknown = JSON.parse(text);
    if (!isRecord(raw) || raw['format'] !== FACTS_FORMAT) return null;
    return raw as unknown as Facts;
  } catch {
    return null;
  }
}

/** A join message, read just far enough for the room's own checks; null for anything else (the host judges it). */
function joinOf(text: string): { kind: string; seat: string | null; key: string | null; message: Record<string, unknown> } | null {
  if (tooLarge(text)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || typeof raw['kind'] !== 'string' || !JOIN_KINDS.includes(raw['kind'])) return null;
  return {
    kind: raw['kind'],
    seat: typeof raw['seat'] === 'string' ? raw['seat'] : null,
    key: typeof raw['key'] === 'string' ? raw['key'] : null,
    message: raw,
  };
}

/** The join message as a socket keeps it to join again: a rejoin asks for no events (the page has had them). */
function keptHello(join: { kind: string; message: Record<string, unknown> }, text: string): string {
  if (join.kind === 'claim') return text;
  return JSON.stringify({ ...join.message, since: null });
}

interface Conn {
  /** The host's number for the connection. */
  conn: number;
  /** While a socket joins again after the object slept: what the host says to it is not sent. */
  muted: boolean;
}

export class Room {
  readonly #ports: RoomPorts;
  readonly #store: Store;
  #host: Host | null = null;
  readonly #conns = new Map<string, Conn>();
  /** The join message a socket has sent and the host has not yet welcomed. */
  readonly #joining = new Map<string, string>();
  #faultsSeen = 0;

  constructor(ports: RoomPorts) {
    this.#ports = ports;
    this.#store = { load: () => ports.session.all(), commit: writes => ports.session.put(writes) };
  }

  /** The room's facts, or null before the game is made. */
  #facts(): Facts | null {
    return readFacts(this.#ports.room.get(FACTS_KEY));
  }

  /** True once a game has been made here. */
  get made(): boolean {
    return this.#facts() !== null;
  }

  // ---------------------------------------------------------------------------
  // making the game, and what a page asks before it joins
  // ---------------------------------------------------------------------------

  create(match: string, body: unknown): Reply {
    if (this.#facts() !== null || Object.keys(this.#ports.session.all()).length > 0) return { status: 409, body: { error: 'This game has been made already.' } };
    if (!isRecord(body) || Object.keys(body).some(k => k !== 'scenario' && k !== 'invites')) return { status: 400, body: { error: 'A game is made from a scenario and an invitation for each side.' } };
    const scenario = body['scenario'];
    const invites = body['invites'];
    if (typeof scenario !== 'string') return { status: 400, body: { error: 'No scenario was named.' } };
    const loaded = this.#ports.content(scenario);
    if (!loaded.ok) return { status: 400, body: { error: `There is no scenario '${scenario.slice(0, 40)}'.` } };
    const seats = loaded.content.ruleset.seats;
    if (!Array.isArray(invites) || invites.length !== seats.length || invites.some(i => typeof i !== 'string' || !HEX64.test(i)) || new Set(invites).size !== invites.length) {
      return { status: 400, body: { error: `A game needs ${seats.length} different invitations, one for each side.` } };
    }
    try {
      this.#host = createHost({ match, content: loaded.content, store: this.#store, random: this.#ports.random });
    } catch (err) {
      this.#log(`create ${match}: ${err instanceof Error ? err.message : String(err)}`);
      return { status: 500, body: { error: 'The game could not be made.' } };
    }
    const facts: Facts = { format: FACTS_FORMAT, match, scenario, seats: [...seats], invites: invites as string[], made: this.#ports.now() };
    this.#ports.room.put([{ key: FACTS_KEY, text: JSON.stringify(facts) }]);
    return { status: 201, body: { match, scenario, seats: facts.seats } };
  }

  info(): Reply {
    const facts = this.#facts();
    if (!facts) return { status: 404, body: { error: 'There is no such game.' } };
    const host = this.#ensure();
    return { status: 200, body: { match: facts.match, scenario: facts.scenario, seats: facts.seats, over: host.ok ? host.host.over : false } };
  }

  // ---------------------------------------------------------------------------
  // sockets
  // ---------------------------------------------------------------------------

  /** A socket was opened: it is tagged, and becomes a connection of the host. */
  accept(socket: RoomSocket): void {
    const id = bytesToHex(this.#ports.random.bytes(8));
    socket.setTag({ id, at: this.#ports.now(), hello: null });
    const host = this.#ensure();
    if (!host.ok) {
      this.#refuse(socket, host.code, host.detail);
      return;
    }
    if (!this.#conns.has(id)) this.#connect(socket, id, false);
  }

  /** One message from a socket. */
  message(socket: RoomSocket, text: string): void {
    const tag = socket.tag();
    if (tag === null) return;
    // A page's keep-alive (the object answers it without waking; this is for when it did not).
    if (text === 'ping') {
      socket.send('pong');
      return;
    }
    const ready = this.#ensure();
    if (!ready.ok) {
      this.#refuse(socket, ready.code, ready.detail);
      return;
    }
    const host = ready.host;
    const c = this.#conns.get(tag.id) ?? this.#connect(socket, tag.id, false);
    if (tag.hello === null) {
      const join = joinOf(text);
      if (join !== null) {
        if (join.kind === 'claim' && !this.#invited(join.seat, join.key)) {
          socket.send(JSON.stringify({ kind: 'rejected', id: null, code: 'seat_taken', detail: 'this link does not hold that seat' }));
          return;
        }
        this.#joining.set(tag.id, keptHello(join, text));
      }
    }
    host.receive(c.conn, text);
    this.#joining.delete(tag.id);
    this.#faults();
  }

  /** A socket went away. */
  closed(socket: RoomSocket): void {
    const tag = socket.tag();
    if (tag === null) return;
    const c = this.#conns.get(tag.id);
    this.#conns.delete(tag.id);
    this.#joining.delete(tag.id);
    if (c && this.#host) this.#host.disconnect(c.conn);
  }

  /** The game is being deleted: the host in memory is let go, and nothing more is said to any socket. */
  forget(): void {
    this.#host?.close();
    this.#host = null;
    this.#conns.clear();
    this.#joining.clear();
  }

  /** True when the claim's key gives the check of that seat's link (a seat the game does not have is the host's to refuse). */
  #invited(seat: string | null, key: string | null): boolean {
    const facts = this.#facts();
    if (!facts || seat === null) return false;
    const i = facts.seats.indexOf(seat);
    if (i < 0) return true;
    if (key === null || !HEX32.test(key)) return true;
    return facts.invites[i] === inviteCheckOf(key);
  }

  #connect(socket: RoomSocket, id: string, muted: boolean): Conn {
    const host = this.#host as Host;
    const entry: Conn = { conn: -1, muted };
    const outbox: Outbox = {
      send: text => {
        // The host's welcome: the socket keeps the join message that earned it, to join again after a sleep.
        if (text.startsWith('{"kind":"welcome"')) {
          const hello = this.#joining.get(id);
          const tag = socket.tag();
          if (hello !== undefined && tag !== null && tag.hello === null) socket.setTag({ ...tag, hello });
        }
        if (!entry.muted) socket.send(text);
      },
      close: reason => {
        this.#conns.delete(id);
        socket.close(CLOSE_CODES[reason] ?? 4000, reason);
      },
    };
    entry.conn = host.connect(outbox);
    this.#conns.set(id, entry);
    return entry;
  }

  /** The host, built from the store when there is none; the sockets still open join it again, quietly. */
  #ensure(): { ok: true; host: Host } | { ok: false; code: string; detail: string } {
    if (this.#host && !this.#host.closed) return { ok: true, host: this.#host };
    const facts = this.#facts();
    if (!facts) return { ok: false, code: 'wrong_match', detail: 'there is no game here' };
    const loaded = this.#ports.content(facts.scenario);
    if (!loaded.ok) return { ok: false, code: 'content_mismatch', detail: `the scenario of this game is no longer served: ${loaded.problem}` };
    const opened = openHost({ content: loaded.content, store: this.#store, random: this.#ports.random });
    if (!opened.ok) {
      this.#log(`open ${facts.match}: ${opened.refusal}`);
      return { ok: false, code: opened.refusal.startsWith('content_mismatch') ? 'content_mismatch' : 'internal_error', detail: opened.refusal };
    }
    this.#host = opened.host;
    this.#faultsSeen = 0;
    this.#conns.clear();
    const open = this.#ports.sockets()
      .map(s => ({ s, tag: s.tag() }))
      .filter((x): x is { s: RoomSocket; tag: SocketTag } => x.tag !== null)
      .sort((a, b) => a.tag.at - b.tag.at);
    for (const { s, tag } of open) {
      const c = this.#connect(s, tag.id, true);
      if (tag.hello !== null) opened.host.receive(c.conn, tag.hello);
      c.muted = false;
    }
    this.#faults();
    return { ok: true, host: opened.host };
  }

  #refuse(socket: RoomSocket, code: string, detail: string): void {
    socket.send(JSON.stringify({ kind: 'rejected', id: null, code, detail: detail.length > 300 ? `${detail.slice(0, 297)}...` : detail }));
    socket.close(1011, code);
  }

  /** The host's new fault lines, to the log. */
  #faults(): void {
    const host = this.#host;
    if (!host) return;
    while (this.#faultsSeen < host.faults.length) this.#log(`fault: ${host.faults[this.#faultsSeen++] as string}`);
  }

  #log(line: string): void {
    this.#ports.log?.(line);
  }
}
