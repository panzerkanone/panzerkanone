/**
 * The in-process transport: connections between clients and one host, as
 * queues of JSON text, with faults drawn from a seed. Nothing is delivered
 * until step() is called, one message per call, so a driver decides exactly
 * when each message arrives.
 *
 *   const net = new Loopback(host, { seed, rates });
 *   const link = net.open(client);       a new connection: the host's outbox and the client's sender
 *   net.step();                          deliver the next message (or lose, repeat, reorder or alter it)
 *   net.drop(link);                      cut one connection: what is in flight on it is lost
 *   net.setHost(rebuilt);                a host rebuilt from the store: every connection is cut
 *
 * Faults, each drawn per message from hash(seed, 'loopback', n):
 *   loseToHost, loseToClient   the message is lost
 *   repeat                     the message is delivered, and a copy of it again later
 *   reorder                    a later message on the same connection and in the same direction
 *                              is delivered before the one at the head of the queue
 *   tamper                     an update to a client is altered so that it no longer leads to its
 *                              hash (a value, a key, the shape of the change, or the hash itself)
 * Closing a connection (the host's outbox close) arrives at the client in
 * order, after what the host sent before it.
 */
import { hashOf } from '../engine/core/random';
import type { CloseReason } from '../protocol/codes';
import type { Outbox } from './ports';

export interface HostEndpoint {
  connect(outbox: Outbox): number;
  receive(conn: number, text: string): void;
  disconnect(conn: number): void;
}

export interface ClientEndpoint {
  connect(send: (text: string) => void): void;
  receive(text: string): void;
  disconnected(): void;
}

export interface FaultRates {
  readonly loseToHost: number;
  readonly loseToClient: number;
  readonly repeat: number;
  readonly reorder: number;
  readonly tamper: number;
}

export const NO_FAULTS: FaultRates = { loseToHost: 0, loseToClient: 0, repeat: 0, reorder: 0, tamper: 0 };

export type FaultKind = keyof FaultRates;

export interface FaultCounts {
  lostToHost: number;
  lostToClient: number;
  repeated: number;
  reordered: number;
  tampered: number;
  dropped: number;
}

export interface LoopbackOptions {
  readonly seed: number;
  readonly rates?: FaultRates;
  /** Called with every message the host sends, as it is sent (before any fault), with the link it is for. */
  readonly onHostSend?: (link: number, text: string) => void;
  /** Called with every message a client sends, as it is sent. */
  readonly onClientSend?: (link: number, text: string) => void;
}

interface Link {
  readonly id: number;
  readonly client: ClientEndpoint;
  conn: number;
  open: boolean;
  hostClosed: boolean;
}

interface InFlight {
  readonly link: Link;
  readonly up: boolean;
  readonly text: string;
  /** A host close, delivered to the client in order. */
  readonly close: boolean;
  /** A copy made by a repeat: not repeated again. */
  readonly copy: boolean;
}

export class Loopback {
  readonly counts: FaultCounts = { lostToHost: 0, lostToClient: 0, repeated: 0, reordered: 0, tampered: 0, dropped: 0 };
  #host: HostEndpoint;
  #rates: FaultRates;
  readonly #seed: number;
  readonly #onHostSend: ((link: number, text: string) => void) | undefined;
  readonly #onClientSend: ((link: number, text: string) => void) | undefined;
  #draws = 0;
  #nextLink = 1;
  readonly #links = new Map<number, Link>();
  #queue: InFlight[] = [];
  /** Faults to make at the next message they fit, whatever the rates say. */
  readonly #forced = new Set<FaultKind>();
  /** While set, everything the host sends is lost (until the next setHost). */
  #blackout = false;

  constructor(host: HostEndpoint, opts: LoopbackOptions) {
    this.#host = host;
    this.#seed = opts.seed;
    this.#rates = opts.rates ?? NO_FAULTS;
    this.#onHostSend = opts.onHostSend;
    this.#onClientSend = opts.onClientSend;
  }

  /** A number in [0, 1) from the seed: the transport's own stream. */
  #rand(): number {
    return hashOf(this.#seed, 'loopback', this.#draws++) / 0x100000000;
  }

  get inFlight(): number {
    return this.#queue.length;
  }

  /** Make this fault at the next message it fits (a reorder needs two messages of one connection in flight one way). */
  force(kind: FaultKind): void {
    this.#forced.add(kind);
  }

  #fault(kind: FaultKind): boolean {
    if (this.#forced.delete(kind)) return true;
    const p = this.#rates[kind];
    return p > 0 && this.#rand() < p;
  }

  /** Change the fault rates (all off: NO_FAULTS). */
  setRates(rates: FaultRates): void {
    this.#rates = rates;
  }

  /** The host's connection number for a link, or null when the link is closed. */
  connOf(link: number): number | null {
    const l = this.#links.get(link);
    return l && l.open ? l.conn : null;
  }

  /** True while a link is open both ways (the host has not closed it). */
  isOpen(link: number): boolean {
    const l = this.#links.get(link);
    return l !== undefined && l.open && !l.hostClosed;
  }

  /** Open a connection for a client: the host is told first, then the client (which sends its hello). */
  open(client: ClientEndpoint): number {
    const id = this.#nextLink++;
    const link: Link = { id, client, conn: 0, open: true, hostClosed: false };
    this.#links.set(id, link);
    const outbox: Outbox = {
      send: (text: string): void => {
        if (!link.open || link.hostClosed) return;
        this.#onHostSend?.(id, text);
        if (this.#blackout) return;
        this.#queue.push({ link, up: false, text, close: false, copy: false });
      },
      close: (_reason: CloseReason): void => {
        if (!link.open || link.hostClosed) return;
        link.hostClosed = true;
        this.#queue.push({ link, up: false, text: '', close: true, copy: false });
      },
    };
    link.conn = this.#host.connect(outbox);
    client.connect((text: string): void => {
      if (!link.open) return;
      this.#onClientSend?.(id, text);
      this.#queue.push({ link, up: true, text, close: false, copy: false });
    });
    return id;
  }

  /** Send a message on a link as if its client had, straight to the host now (a driver's probe). */
  inject(link: number, text: string): void {
    const l = this.#links.get(link);
    if (!l || !l.open) return;
    this.#onClientSend?.(link, text);
    this.#host.receive(l.conn, text);
  }

  /** Cut a connection: what is in flight on it is lost; the host and the client are told. */
  drop(link: number): void {
    const l = this.#links.get(link);
    if (!l || !l.open) return;
    this.#cut(l);
    this.counts.dropped += 1;
  }

  #cut(l: Link): void {
    l.open = false;
    this.#queue = this.#queue.filter(m => m.link !== l);
    this.#host.disconnect(l.conn);
    l.client.disconnected();
  }

  /** From now until the next setHost, everything the host sends is lost: a host that stored and then died before announcing. */
  blackout(): void {
    this.#blackout = true;
  }

  /** A new host (rebuilt from the store): every connection is cut, and nothing in flight survives. */
  setHost(host: HostEndpoint): void {
    this.#blackout = false;
    for (const l of this.#links.values()) {
      if (!l.open) continue;
      l.open = false;
      l.client.disconnected();
    }
    this.#queue = [];
    this.#host = host;
  }

  /** Deliver one message. False when nothing is in flight. */
  step(): boolean {
    if (this.#queue.length === 0) return false;
    let index = 0;
    const head = this.#queue[0] as InFlight;
    const j = this.#queue.findIndex((m, k) => k > 0 && m.link === head.link && m.up === head.up && !m.close && !head.close);
    if (j > 0 && this.#fault('reorder')) {
      index = j;
      this.counts.reordered += 1;
    }
    const msg = this.#queue.splice(index, 1)[0] as InFlight;
    const l = msg.link;
    if (!l.open) return true;
    if (msg.close) {
      l.open = false;
      this.#queue = this.#queue.filter(m => m.link !== l);
      this.#host.disconnect(l.conn);
      l.client.disconnected();
      return true;
    }
    if (msg.up) {
      if (this.#fault('loseToHost')) {
        this.counts.lostToHost += 1;
        return true;
      }
      if (!msg.copy && this.#fault('repeat')) {
        this.#queue.push({ ...msg, copy: true });
        this.counts.repeated += 1;
      }
      this.#host.receive(l.conn, msg.text);
      return true;
    }
    if (this.#fault('loseToClient')) {
      this.counts.lostToClient += 1;
      return true;
    }
    let text = msg.text;
    if (text.startsWith('{"kind":"update"') && this.#fault('tamper')) {
      const altered = tamperUpdate(text, this.#rand());
      if (altered !== null) {
        text = altered;
        this.counts.tampered += 1;
      }
    }
    if (!msg.copy && this.#fault('repeat')) {
      this.#queue.push({ ...msg, copy: true });
      this.counts.repeated += 1;
    }
    l.client.receive(text);
    return true;
  }

  /** Deliver everything in flight (with the current rates), at most `limit` messages. */
  flush(limit = 100000): number {
    let n = 0;
    while (n < limit && this.step()) n++;
    return n;
  }
}

/** Alter the first value a change sets, so that the view it leads to differs. */
function alterSet(change: unknown): boolean {
  if (typeof change !== 'object' || change === null) return false;
  const c = change as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(c, 'set')) {
    const v = c.set;
    if (typeof v === 'number') c.set = v + 1;
    else if (typeof v === 'string') c.set = `${v}~`;
    else if (typeof v === 'boolean') c.set = !v;
    else if (v === null) c.set = 0;
    else c.set = null;
    return true;
  }
  const entries = Array.isArray(c.keys) ? c.keys : Array.isArray(c.items) ? c.items : null;
  if (!entries) return false;
  for (const e of entries) if (Array.isArray(e) && alterSet(e[1])) return true;
  return false;
}

/**
 * An update altered so that it no longer leads to its hash, or null when the
 * text is not an update. `r` in [0, 1) picks how: a value, an added key, a
 * change of the wrong shape, or one hex digit of the hash.
 */
export function tamperUpdate(text: string, r: number): string | null {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof m !== 'object' || m === null || m.kind !== 'update') return null;
  const way = Math.floor(r * 4);
  if (way === 0 && m.change !== null && alterSet(m.change)) return JSON.stringify(m);
  if (way <= 1) {
    m.change = { keys: [['~tampered', { set: 1 }]], drop: [] };
    return JSON.stringify(m);
  }
  if (way === 2) {
    m.change = { tampered: [1, 2, 3] };
    return JSON.stringify(m);
  }
  const hash = String(m.hash);
  const d = hash[0] === '0' ? '1' : '0';
  m.hash = `${d}${hash.slice(1)}`;
  return JSON.stringify(m);
}
