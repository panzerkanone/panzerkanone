/**
 * The seat client (ruling 8): what sits on the far side of a connection, for
 * a seat or a spectator. It keeps its view, applies each update's change,
 * checks the hash, and asks for its whole view when a sequence number is
 * skipped or a hash differs. It predicts nothing: a command changes nothing
 * here until the host's update arrives. On reconnecting it sends again, with
 * the same id and in the same order, every command that was never answered.
 *
 *   const client = new SeatClient({ match, content, seat: 'azure', random });   (seat null: a spectator)
 *   client.connect(text => link.send(text));    a new connection: it sends its hello (claim, resume or watch)
 *   client.receive(text);                       one message from the host; never throws
 *   client.disconnected();                      the connection went away
 *   client.command(action);                     send one action of its seat; returns the command's id
 *   client.concede();
 *
 * What it holds for the dice check (ruling 27): the match id and the host's
 * commitment from the first welcome it got (before it contributed), and its
 * own contribution, drawn from its own random-bytes port when it is made. It
 * takes the dice steps itself unless told not to (autoDice false).
 */
import { applyChange } from '../protocol/diff';
import { bytesToHex, hexToBytes } from '../protocol/check';
import { CLAIM_KEY_BYTES, CONTRIBUTION_BYTES, PROTOCOL_VERSION } from '../protocol/limits';
import type {
  ContentPins, DiceRecord, DiceStatus, HostMessage, RejectedMessage, ResultMessageBody, UpdateMessage, ViewMessage, WelcomeMessage,
} from '../protocol/messages';
import { validateHostMessage } from '../protocol/validate';
import { viewHash } from '../protocol/viewhash';
import { seatCommitmentOf, verifyDice } from './dice';
import type { DiceVerdict, HeldDice } from './dice';
import type { RandomBytes } from './ports';

export interface ClientOptions {
  readonly match: string;
  readonly content: ContentPins;
  /** The seat to claim (and resume afterwards), or null to watch. */
  readonly seat: string | null;
  readonly random: RandomBytes;
  /** Take the dice steps without being asked (default true). */
  readonly autoDice?: boolean;
  /** Called each time the client's view changes, with its sequence number. */
  readonly onView?: (seq: number, view: unknown) => void;
}

export interface ClientStats {
  /** Updates whose change, applied, did not give the hash sent (or could not be applied). */
  hashMismatches: number;
  /** Updates that skipped a sequence number. */
  skipped: number;
  /** Updates already applied, received again. */
  repeats: number;
  /** Requests for the whole view. */
  syncs: number;
  /** Messages that could not be read as host messages. */
  unreadable: number;
  /** Whole views whose hash was wrong. */
  badViews: number;
  /** Times events were left out (more than the limit passed while away). */
  eventGaps: number;
  /** Times the host closed the connection, by reason. */
  closedBy: Record<string, number>;
}

/** The codes with which a host refuses a join. */
const JOIN_REFUSALS = ['protocol_version', 'wrong_match', 'content_mismatch', 'unknown_seat', 'seat_taken', 'computer_seat', 'bad_token'];

/**
 * Codes that say nothing about a command, only about the connection it came on
 * or a passing failure of the host: the command stays unanswered and is sent
 * again, with its id, on the next connection.
 */
const NOT_AN_ANSWER = ['not_joined', 'replaced', 'budget_spent', 'host_closed', 'internal_error', 'store_failed'];

export class SeatClient {
  readonly seat: string | null;
  readonly match: string;
  readonly content: ContentPins;

  /** The view as the client holds it, and its sequence number (-1 before the first). */
  view: unknown = null;
  seq = -1;
  /** The sequence number of the first view the client took: it holds the events of the actions after it. */
  firstSeq = -1;
  hash: string | null = null;
  token: string | null = null;
  /** What the client holds to check the dice, from its first welcome. */
  held: HeldDice | null = null;
  dice: DiceStatus | null = null;
  result: ResultMessageBody | null = null;
  record: DiceRecord | null = null;
  verdict: DiceVerdict | null = null;
  /** Why a join was refused, if it was. */
  refused: RejectedMessage | null = null;
  /** Every event received, in order, with the sequence number of its action. */
  readonly events: { readonly seq: number; readonly event: unknown }[] = [];
  /** Every command and concession id sent, in order. */
  readonly sent: string[] = [];
  /** The answer to each id. */
  readonly answers = new Map<string, { readonly kind: 'accepted'; readonly seq: number } | { readonly kind: 'rejected'; readonly code: string }>();
  /** The highest sequence number an accepted answer named. */
  known = 0;
  /** How many of this client's commands (not concessions) the host accepted: its seat's count of decisions. */
  acceptedCommands = 0;
  readonly stats: ClientStats = { hashMismatches: 0, skipped: 0, repeats: 0, syncs: 0, unreadable: 0, badViews: 0, eventGaps: 0, closedBy: {} };

  connected = false;
  joined = false;

  readonly #random: RandomBytes;
  readonly #autoDice: boolean;
  readonly #onView: ((seq: number, view: unknown) => void) | undefined;
  readonly #claimKey: string;
  readonly #contribution: string | null;
  /** Commands and concessions sent and not yet answered, by id, in the order sent. */
  readonly #pending = new Map<string, string>();
  readonly #concessions = new Set<string>();
  #send: ((text: string) => void) | null = null;
  #syncAsked = false;
  #nextId = 0;
  #diceSent = { commit: false, reveal: false };
  #committed = false;
  #revealed = false;

  constructor(opts: ClientOptions) {
    this.seat = opts.seat;
    this.match = opts.match;
    this.content = opts.content;
    this.#random = opts.random;
    this.#autoDice = opts.autoDice !== false;
    this.#onView = opts.onView;
    // Drawn once, now, in a fixed order: the same client gives the same bytes however its game goes.
    this.#claimKey = bytesToHex(this.#draw(CLAIM_KEY_BYTES));
    this.#contribution = opts.seat === null ? null : bytesToHex(this.#draw(CONTRIBUTION_BYTES));
  }

  #draw(n: number): Uint8Array {
    const b = this.#random.bytes(n);
    if (!(b instanceof Uint8Array) || b.length !== n) throw new Error(`the random-bytes port gave the wrong number of bytes for ${n}`);
    return new Uint8Array(b);
  }

  /** The client's own contribution to the dice, as hex (a seat's only; never sent before the reveal). */
  get contribution(): string | null {
    return this.#contribution;
  }

  /** Commands and concessions sent and not yet answered, in order. */
  get unanswered(): string[] {
    return [...this.#pending.keys()];
  }

  /** True while the client has asked for its whole view and not yet received it. */
  get syncing(): boolean {
    return this.#syncAsked;
  }

  get over(): boolean {
    return this.result !== null;
  }

  /**
   * True when the client's seat may decide now as far as it can tell: joined,
   * the dice exchange done, holding a view no older than any answer it has
   * had, with nothing unanswered and no whole view awaited.
   */
  get ready(): boolean {
    return this.connected && this.joined && this.view !== null && this.#pending.size === 0 && !this.#syncAsked
      && this.seq >= this.known && this.result === null && this.refused === null && this.dice !== null && this.dice.stage === 'play';
  }

  // -------------------------------------------------------------------------
  // the connection
  // -------------------------------------------------------------------------

  /** A new connection: send the hello, then every unanswered command again, with its own id, in order. */
  connect(send: (text: string) => void): void {
    this.#send = send;
    this.connected = true;
    this.joined = false;
    this.#syncAsked = false;
    this.#diceSent = { commit: false, reveal: false };
    const since = this.seq >= 0 ? this.seq : null;
    const hello = { protocol: PROTOCOL_VERSION, match: this.match, content: this.content };
    if (this.seat === null) this.#out({ kind: 'watch', ...hello, since });
    else if (this.token !== null) this.#out({ kind: 'resume', ...hello, token: this.token, since });
    else this.#out({ kind: 'claim', ...hello, seat: this.seat, key: this.#claimKey });
    for (const text of this.#pending.values()) this.#sendText(text);
  }

  disconnected(): void {
    this.#send = null;
    this.connected = false;
    this.joined = false;
  }

  #sendText(text: string): void {
    if (this.#send) this.#send(text);
  }

  #out(msg: object): void {
    this.#sendText(JSON.stringify(msg));
  }

  // -------------------------------------------------------------------------
  // what a player does
  // -------------------------------------------------------------------------

  /** Send one action of this seat, chosen from the view at this.seq. Returns its id. */
  command(action: unknown): string {
    const id = `n${++this.#nextId}`;
    const text = JSON.stringify({ kind: 'command', id, seq: this.seq >= 0 ? this.seq : 0, action });
    this.#pending.set(id, text);
    this.sent.push(id);
    this.#sendText(text);
    return id;
  }

  concede(): string {
    const id = `n${++this.#nextId}`;
    const text = JSON.stringify({ kind: 'concede', id });
    this.#concessions.add(id);
    this.#pending.set(id, text);
    this.sent.push(id);
    this.#sendText(text);
    return id;
  }

  /** Ask for the whole view (once until it comes). */
  requestView(): void {
    if (this.#syncAsked || !this.#send) return;
    this.#syncAsked = true;
    this.stats.syncs += 1;
    this.#out({ kind: 'sync', since: this.seq >= 0 ? this.seq : null });
  }

  /** The dice steps by hand (autoDice false). */
  commitDice(): void {
    if (this.seat === null || this.#contribution === null) return;
    this.#out({ kind: 'dice_commit', commitment: seatCommitmentOf(this.match, this.seat, hexToBytes(this.#contribution)) });
  }

  revealDice(): void {
    if (this.#contribution === null) return;
    this.#out({ kind: 'dice_reveal', contribution: this.#contribution });
  }

  // -------------------------------------------------------------------------
  // the host's messages
  // -------------------------------------------------------------------------

  /** One message from the host. Never throws. */
  receive(text: string): void {
    try {
      this.#receive(text);
    } catch {
      this.stats.unreadable += 1;
    }
  }

  #receive(text: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      this.stats.unreadable += 1;
      return;
    }
    const v = validateHostMessage(raw);
    if (!v.ok) {
      this.stats.unreadable += 1;
      // An update that cannot be read is an update missed.
      if (typeof raw === 'object' && raw !== null && (raw as { kind?: unknown }).kind === 'update') {
        this.stats.hashMismatches += 1;
        this.requestView();
      }
      return;
    }
    const m: HostMessage = v.message;
    switch (m.kind) {
      case 'welcome': return this.#welcome(m);
      case 'view': return this.#wholeView(m);
      case 'update': return this.#update(m);
      case 'accepted': {
        if (this.#pending.delete(m.id)) {
          this.answers.set(m.id, { kind: 'accepted', seq: m.seq });
          if (!this.#concessions.has(m.id)) this.acceptedCommands += 1;
        }
        if (m.seq > this.known) this.known = m.seq;
        return;
      }
      case 'rejected': {
        if (m.id !== null && this.#pending.has(m.id)) {
          if (NOT_AN_ANSWER.includes(m.code)) return;
          this.#pending.delete(m.id);
          this.answers.set(m.id, { kind: 'rejected', code: m.code });
          // A stale or untimely command means the view is behind: ask for it.
          if (m.code === 'stale' || m.code === 'not_your_turn') this.requestView();
          return;
        }
        if (m.id === null && !this.joined && JOIN_REFUSALS.includes(m.code)) this.refused = m;
        return;
      }
      case 'dice':
        this.dice = m.status;
        return this.#diceStep();
      case 'dice_ok':
        if (m.step === 'commit') this.#committed = true;
        else this.#revealed = true;
        return;
      case 'over':
        return this.#over(m.result, m.record);
      case 'closed':
        this.stats.closedBy[m.reason] = (this.stats.closedBy[m.reason] ?? 0) + 1;
        this.#send = null;
        this.connected = false;
        this.joined = false;
        return;
    }
  }

  #welcome(m: WelcomeMessage): void {
    if (this.seat !== null && m.seat !== this.seat) return;
    this.joined = true;
    if (m.token !== null) this.token = m.token;
    // Kept from the first welcome only: what this seat was sent before it contributed (ruling 27).
    if (this.held === null) {
      this.held = { match: m.match, commitment: m.dice.commitment, seat: this.seat, contribution: this.#contribution };
    }
    this.dice = m.dice;
    if (m.result !== null && m.record !== null) this.#over(m.result, m.record);
    this.#diceStep();
  }

  #diceStep(): void {
    if (!this.#autoDice || this.seat === null || this.held === null || this.result !== null || !this.dice) return;
    const d = this.dice;
    if (d.stage === 'commit' && !d.committed.includes(this.seat) && !this.#committed && !this.#diceSent.commit) {
      this.#diceSent.commit = true;
      this.commitDice();
    }
    if (d.stage === 'reveal' && !d.revealed.includes(this.seat) && !this.#revealed && !this.#diceSent.reveal) {
      this.#diceSent.reveal = true;
      this.revealDice();
    }
  }

  #over(result: ResultMessageBody, record: DiceRecord): void {
    if (this.result !== null) return;
    this.result = result;
    this.record = record;
    const held: HeldDice = this.held ?? { match: this.match, commitment: record.commitment, seat: null, contribution: null };
    this.verdict = verifyDice(record, held);
  }

  #wholeView(m: ViewMessage): void {
    if (m.seq < this.seq) return;
    if (viewHash(this.seat, m.view) !== m.hash) {
      this.stats.badViews += 1;
      return;
    }
    const from = this.seq;
    if (m.seq > from) {
      if (m.actions !== null) {
        if (m.since !== null && m.since > from && from >= 0) this.stats.eventGaps += 1;
        for (const a of m.actions) if (a.seq > from) for (const e of a.events) this.events.push({ seq: a.seq, event: e });
      } else if (from >= 0 || m.omitted) {
        this.stats.eventGaps += 1;
      }
    }
    if (this.firstSeq < 0) this.firstSeq = m.seq;
    this.view = m.view;
    this.seq = m.seq;
    this.hash = m.hash;
    this.#syncAsked = false;
    this.#onView?.(this.seq, this.view);
  }

  #update(m: UpdateMessage): void {
    if (this.view === null || this.seq < 0) {
      this.requestView();
      return;
    }
    if (m.seq <= this.seq) {
      this.stats.repeats += 1;
      return;
    }
    if (m.seq > this.seq + 1) {
      this.stats.skipped += 1;
      this.requestView();
      return;
    }
    let next: unknown;
    try {
      next = m.change === null ? this.view : applyChange(this.view, m.change);
    } catch {
      this.stats.hashMismatches += 1;
      this.requestView();
      return;
    }
    if (viewHash(this.seat, next) !== m.hash) {
      this.stats.hashMismatches += 1;
      this.requestView();
      return;
    }
    this.view = next;
    this.seq = m.seq;
    this.hash = m.hash;
    for (const e of m.events) this.events.push({ seq: m.seq, event: e });
    this.#onView?.(this.seq, this.view);
  }
}

