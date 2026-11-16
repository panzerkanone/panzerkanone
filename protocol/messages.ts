/**
 * The messages of the session protocol, both ways. Every message is a JSON
 * object with a `kind`; it is plain data that survives a round trip through
 * JSON text unchanged (ruling 3). session/README.md states each one, its
 * fields, and when it is sent.
 *
 * Client to host:
 *   claim, resume, watch      join: claim an open seat, take a seat back with its token, or watch
 *   sync                      ask for the whole view (and the events after a sequence number)
 *   command                   one action of the connection's seat, with an id and a sequence number
 *   concede                   end the match, the other seat winning
 *   dice_commit, dice_reveal  the seat's steps of the dice exchange
 *
 * Host to client:
 *   welcome                   the answer to a join: the seat, its token (to a claim only), the dice status
 *   view                      the whole view, its hash, and the events after the sequence number asked
 *   update                    after every accepted action: the events this viewer sees, the change to its view, the new view's hash
 *   accepted, rejected        the answer to a command or concession (rejected answers any message)
 *   dice, dice_ok             the dice exchange's stage, to every connection; a dice step taken
 *   over                      the match is over: the result and the published dice record
 *   closed                    the host is closing this connection, and why
 */
import type { CloseReason, DiceFailure } from './codes';
import type { Change } from './diff';

/** The content a client holds, by content hash: it must be the match's (ruling 11). */
export interface ContentPins {
  readonly ruleset: string;
  readonly scenario: string;
  readonly map: string;
}

// ---------------------------------------------------------------------------
// client to host
// ---------------------------------------------------------------------------

interface Hello {
  readonly protocol: number;
  readonly match: string;
  readonly content: ContentPins;
}

/** Claim an open seat. `key`: 16 random bytes in hex that the client keeps; a repeat of the claim with the same key gets the same welcome. */
export interface ClaimMessage extends Hello {
  readonly kind: 'claim';
  readonly seat: string;
  readonly key: string;
}

/** Take a seat back with its token. `since`: the last sequence number the client applied, or null. */
export interface ResumeMessage extends Hello {
  readonly kind: 'resume';
  readonly token: string;
  readonly since: number | null;
}

/** Watch as a spectator. */
export interface WatchMessage extends Hello {
  readonly kind: 'watch';
  readonly since: number | null;
}

export interface SyncMessage {
  readonly kind: 'sync';
  readonly since: number | null;
}

export interface CommandMessage {
  readonly kind: 'command';
  /** Chosen by the client, unique for its seat. A repeat gets the first answer again. */
  readonly id: string;
  /** The sequence number of the view the action was chosen from. */
  readonly seq: number;
  readonly action: unknown;
}

export interface ConcedeMessage {
  readonly kind: 'concede';
  readonly id: string;
}

/** The seat's commitment to its contribution: 64 lower-case hex digits. */
export interface DiceCommitMessage {
  readonly kind: 'dice_commit';
  readonly commitment: string;
}

/** The seat's contribution: 32 bytes as 64 lower-case hex digits. */
export interface DiceRevealMessage {
  readonly kind: 'dice_reveal';
  readonly contribution: string;
}

export type ClientMessage =
  | ClaimMessage | ResumeMessage | WatchMessage | SyncMessage | CommandMessage | ConcedeMessage
  | DiceCommitMessage | DiceRevealMessage;

export const CLIENT_KINDS = ['claim', 'resume', 'watch', 'sync', 'command', 'concede', 'dice_commit', 'dice_reveal'] as const;

/** The client messages that change what is stored when accepted (one store call each). */
export const STATE_CHANGING_KINDS = ['claim', 'command', 'concede', 'dice_commit', 'dice_reveal'] as const;

// ---------------------------------------------------------------------------
// host to client
// ---------------------------------------------------------------------------

export type DiceStage = 'commit' | 'reveal' | 'play' | 'failed';

/** Where the dice exchange stands. `commitment` and `match` are what a seat keeps to check the dice afterwards (ruling 27). */
export interface DiceStatus {
  readonly match: string;
  /** The host's commitment to its secret. */
  readonly commitment: string;
  readonly stage: DiceStage;
  /** Seats whose commitment is stored. */
  readonly committed: readonly string[];
  /** Seats whose contribution is stored. */
  readonly revealed: readonly string[];
  readonly failed: { readonly seat: string; readonly reason: DiceFailure } | null;
}

export interface ResultMessageBody {
  readonly winner: string | null;
  readonly reason: string;
}

/** One roll as the host recorded it. */
export interface DiceRoll {
  readonly k: number;
  readonly faces: number;
  readonly face: number;
}

/** The dice record the host publishes once the match is over (ruling 12). */
export interface DiceRecord {
  readonly format: 'dice-record/1';
  readonly match: string;
  /** The host's commitment, as sent before any seat contributed. */
  readonly commitment: string;
  /** The host's secret: 32 bytes in hex. */
  readonly secret: string;
  /** Every seat in seat order: its commitment and contribution (null when never sent). */
  readonly seats: readonly { readonly seat: string; readonly commitment: string | null; readonly contribution: string | null }[];
  /** Every roll the host made, in order from roll number 0. */
  readonly rolls: readonly DiceRoll[];
}

export interface WelcomeMessage {
  readonly kind: 'welcome';
  readonly protocol: number;
  readonly match: string;
  /** The connection's seat, or null for a spectator. */
  readonly seat: string | null;
  /** The seat token, in the answer to a claim only; null otherwise. */
  readonly token: string | null;
  readonly seats: readonly string[];
  readonly dice: DiceStatus;
  /** The result, once the match is over. */
  readonly result: ResultMessageBody | null;
  /** The published dice record, once the match is over. */
  readonly record: DiceRecord | null;
}

/** The events of one action, as one viewer sees them. */
export interface ActionEvents {
  readonly seq: number;
  readonly events: readonly unknown[];
}

export interface ViewMessage {
  readonly kind: 'view';
  readonly seq: number;
  readonly view: unknown;
  readonly hash: string;
  /** The sequence number the client named, or null. */
  readonly since: number | null;
  /** The events of every action after `since`, or null (none asked, or more than REJOIN_EVENT_LIMIT passed). */
  readonly actions: readonly ActionEvents[] | null;
  /** True when events were asked for and left out because more than REJOIN_EVENT_LIMIT actions passed. */
  readonly omitted: boolean;
}

export interface UpdateMessage {
  readonly kind: 'update';
  readonly seq: number;
  readonly events: readonly unknown[];
  /** The change from the view at seq - 1 to the view at seq; null when the view did not change. */
  readonly change: Change | null;
  readonly hash: string;
  /**
   * The viewer's view just after each of `events`, so that a seat far from the host can play an
   * action back one event at a time: one entry for each event, the change from the view after the
   * event before it (the view at seq - 1 for the first), null when that event changed nothing the
   * viewer sees. Events hidden from the viewer are folded into the next one it sees. Left out when
   * it would say nothing: when the view after every event is the view at seq (one event, say).
   */
  readonly steps?: readonly (Change | null)[];
}

export interface AcceptedMessage {
  readonly kind: 'accepted';
  readonly id: string;
  /** For a command, the sequence number of the action it became; for a concession, the sequence number it ended the match at. */
  readonly seq: number;
}

export interface RejectedMessage {
  readonly kind: 'rejected';
  /** The id of the command or concession refused; null for any other message, or when the message could not be read. */
  readonly id: string | null;
  readonly code: string;
  readonly detail: string;
}

export interface DiceMessage {
  readonly kind: 'dice';
  readonly status: DiceStatus;
}

export interface DiceOkMessage {
  readonly kind: 'dice_ok';
  readonly step: 'commit' | 'reveal';
}

export interface OverMessage {
  readonly kind: 'over';
  readonly result: ResultMessageBody;
  readonly record: DiceRecord;
}

export interface ClosedMessage {
  readonly kind: 'closed';
  readonly reason: CloseReason;
}

export type HostMessage =
  | WelcomeMessage | ViewMessage | UpdateMessage | AcceptedMessage | RejectedMessage | DiceMessage | DiceOkMessage
  | OverMessage | ClosedMessage;

export const HOST_KINDS = ['welcome', 'view', 'update', 'accepted', 'rejected', 'dice', 'dice_ok', 'over', 'closed'] as const;
