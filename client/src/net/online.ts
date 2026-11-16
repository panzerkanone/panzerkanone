/**
 * A seat of a game played online: the seat's port (game/port.ts) over the session protocol on a
 * WebSocket to the game server (worker/), behind the same interface the page's own host gives, so
 * that the table, the panel and the rules see no difference between a local game and a remote one.
 *
 *   const net = openOnline({ seat, texts, ... });   the content is loaded here, the connection opened
 *   net.port            the seat's port, for the game (start.ts hands it over as the one person's)
 *   net.reading         the reading of these rules, made from the same ruleset
 *   net.host            what the page asks of a host: there are no computer seats here
 *   net.status          where the game stands (status.ts); net.onChange(f) hears every change
 *   net.dress(model)    the game's model with that in the status plate
 *
 * The seat client (session/client.ts) keeps the view, applies the host's changes and checks their
 * hashes; it is given the seat's link key (session/invite.ts) as its random bytes, so this page
 * claims the seat its link holds and reveals the dice contribution the link gives. Here:
 *
 * - The view before the first answer is the scenario's opening view, worked out from the ruleset
 *   (the server's at action 0 is the same); a page that joins a game in progress is then shown it as
 *   it stands, at once, as one update with no events.
 * - Each update becomes the port's update, with the view after each event from its `steps`.
 * - An action is sent only once both sides have joined and the dice are agreed: until then it waits
 *   here, and the game holds its input as for any action on its way. An action sent and not yet
 *   answered when the connection is lost is sent again, with its id, on the next connection (the
 *   seat client's), so no move a player has made is lost, and none is made twice.
 * - legal() and outcomes() are asked of the ruleset with the seat's view, as a seat far from the
 *   host asks them.
 */
import { parse as parseText } from 'yaml';
import { loadImpulseMatch } from '../../../engine/rulesets/impulse/load';
import type { ImpulseTexts } from '../../../engine/rulesets/impulse/load';
import type { ImpulseRuleset } from '../../../engine/rulesets/impulse/rules';
import type { ImpulseAction, ImpulseEvent, ImpulseView, OutcomeQuery } from '../../../engine/rulesets/impulse/types';
import { copyJson } from '../../../protocol/diff';
import type { ContentPins } from '../../../protocol/messages';
import { SeatClient } from '../../../session/client';
import { LinkBytes } from '../../../session/invite';
import type { GameModel } from '../game/model';
import type { Answer, PortOutcome, SeatPort, Seen, Update } from '../game/port';
import { readImpulse } from '../game/reading-impulse';
import type { ImpulseReading } from '../game/reading-impulse';
import { bytesOf, socketUrl } from './address';
import type { OnlineSeat } from './address';
import { gameInfo, keptInvitation } from './api';
import { mountInvitation } from './card';
import type { InviteCard } from './card';
import { SocketLink } from './socket';
import { dressModel } from './status';
import type { NetStatus } from './status';
import { viewsAfterEvents } from './steps';

type ImpulsePort = SeatPort<ImpulseView, ImpulseAction, ImpulseEvent, OutcomeQuery>;
type ImpulseUpdate = Update<ImpulseView, ImpulseEvent>;

/** What the page asks of a host (start.ts's AnyHost): an online game has no computer seats. */
export interface NoHost {
  readonly seed: number;
  readonly players: readonly ('person' | 'computer')[];
  readonly problems: string[];
  advance(): boolean;
  computerDue(): boolean;
}

export interface OnlineOptions {
  readonly seat: OnlineSeat;
  /** The four texts of the scenario as set up: the same the server plays (worker/src/scenarios.ts). */
  readonly texts: ImpulseTexts;
  readonly rulebook?: { readonly file: string; readonly text: string };
  readonly label?: (type: string) => string | null;
}

/** An action asked for and not yet given to the seat client, with the action number it was chosen at. */
interface Held {
  readonly action: ImpulseAction;
  readonly at: number;
  readonly answer: (a: Answer) => void;
}

/** The codes with which the server refuses a join because the game's content is not this page's. */
const VERSION_CODES = ['content_mismatch', 'protocol_version'];
/** How many updates the port keeps for a late subscriber. */
const KEPT = 64;

export class OnlineGame {
  readonly ruleset: ImpulseRuleset;
  readonly reading: ImpulseReading;
  readonly seat: string;
  readonly port: ImpulsePort;
  readonly host: NoHost = { seed: 0, players: ['person', 'person'], problems: [], advance: () => false, computerDue: () => false };
  readonly client: SeatClient;

  readonly #o: OnlineOptions;
  readonly #link: SocketLink;
  readonly #listeners = new Set<() => void>();
  readonly #handlers = new Set<(u: ImpulseUpdate) => void>();
  readonly #history: ImpulseUpdate[] = [];
  /** The view the port shows, and its action number. */
  #view: ImpulseView;
  #at = 0;
  /** Actions asked for and not yet given to the seat client (it is not yet time), each with the action number it was chosen at. */
  readonly #held: Held[] = [];
  /** Actions given to the seat client, by id, waiting for their answer. */
  readonly #sent = new Map<string, (a: Answer) => void>();
  #gone = false;
  #replaced = false;
  #status: NetStatus = 'connecting';
  #card: InviteCard | null = null;
  #disposed = false;

  constructor(o: OnlineOptions) {
    this.#o = o;
    const loaded = loadImpulseMatch(o.texts);
    if (!loaded.content) throw new Error(`the game's content could not be loaded:\n${loaded.problems.join('\n')}`);
    this.ruleset = loaded.content.ruleset;
    const refs = loaded.content.refs;
    const pins: ContentPins = { ruleset: refs.ruleset.hash, scenario: refs.scenario.hash, map: refs.map.hash };
    let book: { raw: unknown; file: string } | undefined;
    if (o.rulebook) book = { raw: parseText(o.rulebook.text) as unknown, file: o.rulebook.file };
    this.reading = readImpulse(this.ruleset, o.label, book);
    const seat = this.ruleset.seats[o.seat.side];
    if (seat === undefined) throw new Error(`this scenario has no side ${o.seat.side}`);
    this.seat = seat;
    this.#view = this.ruleset.view(this.ruleset.initial(), seat);
    this.client = new SeatClient({ match: o.seat.match, content: pins, seat, random: new LinkBytes(bytesOf(o.seat.key)) });
    this.port = this.#makePort();
    this.#link = new SocketLink({
      address: socketUrl(o.seat.server, o.seat.match),
      open: send => {
        this.client.connect(send);
        this.#changed();
      },
      message: text => this.#hear(text),
      closed: code => {
        this.client.disconnected();
        // 4002: the host gave this seat to a newer connection (the same link opened in another window).
        if (code === 4002 || this.client.stats.closedBy['replaced']) {
          this.#replaced = true;
          this.#link.stop();
        }
        this.#changed();
      },
      state: () => this.#changed(),
    });
    const kept = keptInvitation(o.seat.match);
    if (kept !== null) this.#card = mountInvitation(kept);
    void this.#start();
  }

  /** Ask the server whether the game is there; then open the connection (also when the server could not be asked: it is tried again and again). */
  async #start(): Promise<void> {
    const info = await gameInfo(this.#o.seat.server, this.#o.seat.match);
    if (this.#disposed) return;
    if (info.kind === 'gone') {
      this.#gone = true;
      this.#changed();
      return;
    }
    this.#link.start();
  }

  get status(): NetStatus {
    return this.#status;
  }

  #statusNow(): NetStatus {
    const c = this.client;
    if (this.#gone) return 'gone';
    if (this.#replaced) return 'replaced';
    if (c.refused) return VERSION_CODES.includes(c.refused.code) ? 'version' : c.refused.code === 'wrong_match' ? 'gone' : 'refused';
    if (c.dice?.stage === 'failed') return 'failed';
    if (!c.connected || !c.joined || this.#link.state !== 'open') return this.#link.state === 'retrying' || c.view !== null ? 'retrying' : 'connecting';
    if (c.over || c.dice?.stage === 'play') return 'playing';
    if (c.dice?.stage === 'reveal') return 'starting';
    const others = (c.dice?.committed ?? []).filter(s => s !== this.seat);
    return others.length > 0 ? 'starting' : 'waiting';
  }

  /** Call `f` whenever the game's state online changes. */
  onChange(f: () => void): () => void {
    this.#listeners.add(f);
    return () => {
      this.#listeners.delete(f);
    };
  }

  /** The game's model with the state online in its status plate. */
  dress(m: GameModel): GameModel {
    return dressModel(m, this.#status);
  }

  dispose(): void {
    this.#disposed = true;
    this.#link.stop();
    this.#card?.dispose();
    this.#listeners.clear();
    this.#handlers.clear();
  }

  // ---------------------------------------------------------------------------

  #changed(): void {
    if (this.#disposed) return;
    this.#flush();
    const s = this.#statusNow();
    this.#card?.show(s === 'waiting' || s === 'connecting');
    if (s === this.#status) return;
    this.#status = s;
    // A refusal that ends the game here: nothing more is tried.
    if (s === 'gone' || s === 'version' || s === 'refused' || s === 'failed') {
      this.#link.stop();
      for (const h of this.#held.splice(0)) h.answer({ ok: false, code: 'not_joined', detail: 'the game cannot be joined' });
    }
    for (const f of [...this.#listeners]) f();
  }

  /** One message from the server. */
  #hear(text: string): void {
    const c = this.client;
    const before = { seq: c.seq, view: c.view };
    c.receive(text);
    let kind = '';
    let message: Record<string, unknown> | null = null;
    try {
      message = JSON.parse(text) as Record<string, unknown>;
      kind = typeof message['kind'] === 'string' ? message['kind'] : '';
    } catch {
      kind = '';
    }
    if (c.view !== null && c.seq > this.#at) {
      if (kind === 'update' && c.seq === before.seq + 1 && before.view !== null && message) {
        const events = Array.isArray(message['events']) ? (message['events'] as ImpulseEvent[]) : [];
        const steps = Array.isArray(message['steps']) ? (message['steps'] as unknown[]) : undefined;
        const views = viewsAfterEvents(before.view, events, steps, c.view) as ImpulseView[];
        this.#push({ seq: c.seq, events: events.map((event, i): Seen<ImpulseView, ImpulseEvent> => ({ event, view: views[i] as ImpulseView })), view: c.view as ImpulseView });
      } else {
        // A whole view (joining a game in progress, or back after more than one action passed): shown as it stands.
        this.#push({ seq: c.seq, events: [], view: c.view as ImpulseView });
      }
    } else if (c.view !== null && c.seq === this.#at) {
      this.#view = c.view as ImpulseView;
    }
    // Answers to what this page sent.
    for (const [id, answer] of [...this.#sent]) {
      const a = c.answers.get(id);
      if (!a) continue;
      this.#sent.delete(id);
      if (a.kind === 'accepted') answer({ ok: true, seq: a.seq });
      else answer({ ok: false, code: a.code, detail: kind === 'rejected' && message && message['id'] === id && typeof message['detail'] === 'string' ? message['detail'] : a.code });
    }
    this.#changed();
  }

  #push(u: ImpulseUpdate): void {
    this.#at = u.seq;
    this.#view = u.view;
    this.#history.push(u);
    if (this.#history.length > KEPT) this.#history.shift();
    for (const h of [...this.#handlers]) h(u);
  }

  /** Give the seat client what is held, once both sides have joined and the dice are agreed. */
  #flush(): void {
    const c = this.client;
    if (!c.joined || c.dice?.stage !== 'play' || c.over) return;
    while (this.#held.length > 0) {
      const h = this.#held.shift() as Held;
      if (h.at !== this.#at) {
        h.answer({ ok: false, code: 'stale', detail: 'the game moved on before this was sent' });
        continue;
      }
      this.#sent.set(c.command(h.action), h.answer);
    }
  }

  #makePort(): ImpulsePort {
    const outcomes = (q: OutcomeQuery): readonly PortOutcome[] => this.ruleset.outcomes(this.#view, q).map(o => ({ result: o.result, ways: o.ways, of: o.of, p: o.p }));
    return {
      seat: this.seat,
      seq: () => this.#at,
      view: () => copyJson(this.#view) as ImpulseView,
      legal: () => this.ruleset.legalActions(this.#view),
      outcomes,
      submit: action => new Promise<Answer>(answer => {
        if (this.client.over) {
          answer({ ok: false, code: 'game_over', detail: 'the game is over' });
          return;
        }
        this.#held.push({ action, at: this.#at, answer });
        this.#flush();
      }),
      updates: (from, handler) => {
        for (const u of this.#history.slice()) if (u.seq >= from) handler(u);
        this.#handlers.add(handler);
        return () => {
          this.#handlers.delete(handler);
        };
      },
    };
  }
}

export function openOnline(o: OnlineOptions): OnlineGame {
  return new OnlineGame(o);
}
