/**
 * Validators for the protocol's messages, written by hand in the engine's
 * manner (protocol/check.ts): every problem named with its place, unknown
 * keys refused, nothing defaulted, no value echoed.
 *
 *   validateClientMessage(v)   what a host runs on a parsed message (step 3 of its pipeline)
 *   validateHostMessage(v)     what a client runs on a parsed message from its host
 *
 * Each returns the message, typed, or the list of problems. The action inside
 * a command is checked here only for its shape as data: a mapping, at most
 * MAX_ACTION_DEPTH deep, with no key named __proto__, constructor or
 * prototype at any depth. Whether it is an action of the ruleset, and a legal
 * one, is the ruleset's question (Match.submit).
 */
import { isRecord } from '../engine/kernel/check';
import { MessageChecker, keyName } from './check';
import { DICE_FAILURES } from './codes';
import { CLOSE_REASONS } from './codes';
import {
  CLAIM_KEY_BYTES, CONTRIBUTION_BYTES, ID_PATTERN, MATCH_ID_PATTERN, MAX_ACTION_DEPTH, MAX_ID_LENGTH, MAX_SEAT_LENGTH,
  SECRET_BYTES, TOKEN_BYTES,
} from './limits';
import type { ClientMessage, DiceRecord, DiceStatus, HostMessage } from './messages';
import { CLIENT_KINDS, HOST_KINDS } from './messages';

export type Validated<T> = { readonly ok: true; readonly message: T } | { readonly ok: false; readonly problems: readonly string[] };

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const SEAT_PATTERN = /^[\x21-\x7e]+$/;
const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

/** Problems with the data of an action: its depth and its keys. Walked with a list, never by recursion. */
function checkActionData(c: MessageChecker, place: string, action: unknown): void {
  if (!isRecord(action)) {
    c.add(place, `must be a mapping (an action), got ${kindOfShort(action)}`);
    return;
  }
  const stack: { v: unknown; depth: number; place: string }[] = [{ v: action, depth: 1, place }];
  let reported = 0;
  while (stack.length > 0) {
    const top = stack.pop() as { v: unknown; depth: number; place: string };
    const { v, depth } = top;
    if (Array.isArray(v) || isRecord(v)) {
      if (depth > MAX_ACTION_DEPTH) {
        c.add(top.place, `nests deeper than ${MAX_ACTION_DEPTH} levels`);
        return;
      }
      if (Array.isArray(v)) {
        for (let i = v.length - 1; i >= 0; i--) stack.push({ v: v[i], depth: depth + 1, place: `${top.place}[${i}]` });
      } else {
        for (const k of Object.keys(v)) {
          if (FORBIDDEN_KEYS.includes(k)) {
            if (reported++ < 4) c.add(top.place, `the key ${keyName(k)} is not allowed in a message`);
            continue;
          }
          stack.push({ v: v[k], depth: depth + 1, place: `${top.place}.${k.length > 8 ? `${k.slice(0, 8)}...` : k}` });
        }
      }
    }
  }
}

function kindOfShort(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'a list';
  return typeof v === 'string' ? 'text' : typeof v;
}

function checkContent(c: MessageChecker, raw: unknown): void {
  const v = c.record('content', raw, ['ruleset', 'scenario', 'map']);
  if (!v) return;
  for (const k of ['ruleset', 'scenario', 'map']) c.hex(`content.${k}`, c.at(v, k), 32);
}

function checkHello(c: MessageChecker, v: Record<string, unknown>): void {
  c.int('protocol', c.at(v, 'protocol'), 0, MAX_SAFE);
  c.text('match', c.at(v, 'match'), MATCH_ID_PATTERN, 'a match id (1 to 128 of A-Z a-z 0-9 . _ : -)', 128);
  checkContent(c, c.at(v, 'content'));
}

function checkId(c: MessageChecker, v: Record<string, unknown>): void {
  c.text('id', c.at(v, 'id'), ID_PATTERN, `an id (1 to ${MAX_ID_LENGTH} of A-Z a-z 0-9 . _ : -)`, MAX_ID_LENGTH);
}

function checkSince(c: MessageChecker, v: Record<string, unknown>): void {
  c.intOrNull('since', c.at(v, 'since'), 0, MAX_SAFE, 'nothing applied yet');
}

/** Step 3 of the host's pipeline: is this parsed value a message of the protocol? */
export function validateClientMessage(raw: unknown): Validated<ClientMessage> {
  const c = new MessageChecker('message');
  if (!isRecord(raw)) {
    c.add('', `must be a mapping with a kind, got ${kindOfShort(raw)}`);
    return { ok: false, problems: c.problems };
  }
  const kind = Object.prototype.hasOwnProperty.call(raw, 'kind') ? raw.kind : undefined;
  if (typeof kind !== 'string' || !(CLIENT_KINDS as readonly string[]).includes(kind)) {
    c.add('kind', `must be one of ${CLIENT_KINDS.join(', ')}, got ${kindOfShort(kind)}`);
    return { ok: false, problems: c.problems };
  }
  const hello = ['kind', 'protocol', 'match', 'content'];
  switch (kind) {
    case 'claim': {
      const v = c.record('', raw, [...hello, 'seat', 'key']);
      if (!v) break;
      checkHello(c, v);
      c.text('seat', c.at(v, 'seat'), SEAT_PATTERN, `a seat name (1 to ${MAX_SEAT_LENGTH} visible characters)`, MAX_SEAT_LENGTH);
      c.hex('key', c.at(v, 'key'), CLAIM_KEY_BYTES);
      break;
    }
    case 'resume': {
      const v = c.record('', raw, [...hello, 'token', 'since']);
      if (!v) break;
      checkHello(c, v);
      c.hex('token', c.at(v, 'token'), TOKEN_BYTES);
      checkSince(c, v);
      break;
    }
    case 'watch': {
      const v = c.record('', raw, [...hello, 'since']);
      if (!v) break;
      checkHello(c, v);
      checkSince(c, v);
      break;
    }
    case 'sync': {
      const v = c.record('', raw, ['kind', 'since']);
      if (!v) break;
      checkSince(c, v);
      break;
    }
    case 'command': {
      const v = c.record('', raw, ['kind', 'id', 'seq', 'action']);
      if (!v) break;
      checkId(c, v);
      c.int('seq', c.at(v, 'seq'), 0, MAX_SAFE);
      if (Object.prototype.hasOwnProperty.call(v, 'action')) checkActionData(c, 'action', v.action);
      break;
    }
    case 'concede': {
      const v = c.record('', raw, ['kind', 'id']);
      if (!v) break;
      checkId(c, v);
      break;
    }
    case 'dice_commit': {
      const v = c.record('', raw, ['kind', 'commitment']);
      if (!v) break;
      c.hex('commitment', c.at(v, 'commitment'), 32);
      break;
    }
    case 'dice_reveal': {
      const v = c.record('', raw, ['kind', 'contribution']);
      if (!v) break;
      c.hex('contribution', c.at(v, 'contribution'), CONTRIBUTION_BYTES);
      break;
    }
  }
  if (!c.ok) return { ok: false, problems: c.problems };
  return { ok: true, message: raw as unknown as ClientMessage };
}

// ---------------------------------------------------------------------------
// host messages, as a client reads them
// ---------------------------------------------------------------------------

const HASH = 32;
const SEATS_MAX = 64;

function checkSeatList(c: MessageChecker, place: string, v: unknown): void {
  const list = c.list(place, v, SEATS_MAX);
  list?.forEach((s, i) => c.text(`${place}[${i}]`, s, SEAT_PATTERN, 'a seat name', MAX_SEAT_LENGTH));
}

function checkDiceStatus(c: MessageChecker, place: string, raw: unknown): DiceStatus | undefined {
  const v = c.record(place, raw, ['match', 'commitment', 'stage', 'committed', 'revealed', 'failed']);
  if (!v) return undefined;
  c.text(`${place}.match`, c.at(v, 'match'), MATCH_ID_PATTERN, 'a match id', 128);
  c.hex(`${place}.commitment`, c.at(v, 'commitment'), HASH);
  c.oneOf(`${place}.stage`, c.at(v, 'stage'), ['commit', 'reveal', 'play', 'failed'], 'a dice stage');
  checkSeatList(c, `${place}.committed`, c.at(v, 'committed'));
  checkSeatList(c, `${place}.revealed`, c.at(v, 'revealed'));
  const failed = c.at(v, 'failed');
  if (failed !== null) {
    const f = c.record(`${place}.failed`, failed, ['seat', 'reason']);
    if (f) {
      c.text(`${place}.failed.seat`, c.at(f, 'seat'), SEAT_PATTERN, 'a seat name', MAX_SEAT_LENGTH);
      c.oneOf(`${place}.failed.reason`, c.at(f, 'reason'), DICE_FAILURES, 'a reason');
    }
  }
  return v as unknown as DiceStatus;
}

function checkResult(c: MessageChecker, place: string, raw: unknown): void {
  const v = c.record(place, raw, ['winner', 'reason']);
  if (!v) return;
  const w = c.at(v, 'winner');
  if (w !== null) c.text(`${place}.winner`, w, SEAT_PATTERN, 'a seat name or null', MAX_SEAT_LENGTH);
  if (typeof c.at(v, 'reason') !== 'string') c.add(`${place}.reason`, 'must be text');
}

/** A dice record's shape: its fields, their types and lengths. Whether it is honest is session/dice.ts's question. */
export function validateDiceRecord(raw: unknown, label = 'dice record'): Validated<DiceRecord> {
  const c = new MessageChecker(label);
  checkDiceRecord(c, '', raw);
  if (!c.ok) return { ok: false, problems: c.problems };
  return { ok: true, message: raw as DiceRecord };
}

function checkDiceRecord(c: MessageChecker, place: string, raw: unknown): void {
  const at = (k: string): string => (place === '' ? k : `${place}.${k}`);
  const v = c.record(place, raw, ['format', 'match', 'commitment', 'secret', 'seats', 'rolls']);
  if (!v) return;
  if (c.at(v, 'format') !== 'dice-record/1') c.add(at('format'), "must be 'dice-record/1'");
  c.text(at('match'), c.at(v, 'match'), MATCH_ID_PATTERN, 'a match id', 128);
  c.hex(at('commitment'), c.at(v, 'commitment'), HASH);
  c.hex(at('secret'), c.at(v, 'secret'), SECRET_BYTES);
  const seats = c.list(at('seats'), c.at(v, 'seats'), SEATS_MAX);
  const names = new Set<string>();
  seats?.forEach((s, i) => {
    const p = `${at('seats')}[${i}]`;
    const e = c.record(p, s, ['seat', 'commitment', 'contribution']);
    if (!e) return;
    const name = c.text(`${p}.seat`, c.at(e, 'seat'), SEAT_PATTERN, 'a seat name', MAX_SEAT_LENGTH);
    if (name !== undefined) {
      if (names.has(name)) c.add(`${p}.seat`, 'names a seat a second time');
      names.add(name);
    }
    if (c.at(e, 'commitment') !== null) c.hex(`${p}.commitment`, c.at(e, 'commitment'), HASH);
    if (c.at(e, 'contribution') !== null) c.hex(`${p}.contribution`, c.at(e, 'contribution'), CONTRIBUTION_BYTES);
  });
  const rolls = c.list(at('rolls'), c.at(v, 'rolls'), MAX_SAFE);
  rolls?.forEach((r, i) => {
    const p = `${at('rolls')}[${i}]`;
    const e = c.record(p, r, ['k', 'faces', 'face']);
    if (!e) return;
    c.int(`${p}.k`, c.at(e, 'k'), 0, MAX_SAFE);
    const faces = c.int(`${p}.faces`, c.at(e, 'faces'), 1, 0x100000000);
    c.int(`${p}.face`, c.at(e, 'face'), 1, faces ?? 0x100000000);
  });
}

/** What a client runs on a parsed message from its host. The change inside an update is checked when applied. */
export function validateHostMessage(raw: unknown): Validated<HostMessage> {
  const c = new MessageChecker('host message');
  if (!isRecord(raw)) {
    c.add('', `must be a mapping with a kind, got ${kindOfShort(raw)}`);
    return { ok: false, problems: c.problems };
  }
  const kind = Object.prototype.hasOwnProperty.call(raw, 'kind') ? raw.kind : undefined;
  if (typeof kind !== 'string' || !(HOST_KINDS as readonly string[]).includes(kind)) {
    c.add('kind', `must be one of ${HOST_KINDS.join(', ')}`);
    return { ok: false, problems: c.problems };
  }
  switch (kind) {
    case 'welcome': {
      const v = c.record('', raw, ['kind', 'protocol', 'match', 'seat', 'token', 'seats', 'dice', 'result', 'record']);
      if (!v) break;
      c.int('protocol', c.at(v, 'protocol'), 0, MAX_SAFE);
      c.text('match', c.at(v, 'match'), MATCH_ID_PATTERN, 'a match id', 128);
      if (c.at(v, 'seat') !== null) c.text('seat', c.at(v, 'seat'), SEAT_PATTERN, 'a seat name or null', MAX_SEAT_LENGTH);
      if (c.at(v, 'token') !== null) c.hex('token', c.at(v, 'token'), TOKEN_BYTES);
      checkSeatList(c, 'seats', c.at(v, 'seats'));
      checkDiceStatus(c, 'dice', c.at(v, 'dice'));
      if (c.at(v, 'result') !== null) checkResult(c, 'result', c.at(v, 'result'));
      if (c.at(v, 'record') !== null) checkDiceRecord(c, 'record', c.at(v, 'record'));
      break;
    }
    case 'view': {
      const v = c.record('', raw, ['kind', 'seq', 'view', 'hash', 'since', 'actions', 'omitted']);
      if (!v) break;
      c.int('seq', c.at(v, 'seq'), 0, MAX_SAFE);
      c.hex('hash', c.at(v, 'hash'), HASH);
      c.intOrNull('since', c.at(v, 'since'), 0, MAX_SAFE, 'none named');
      const actions = c.at(v, 'actions');
      if (actions !== null) {
        const list = c.list('actions', actions, MAX_SAFE);
        list?.forEach((a, i) => {
          const e = c.record(`actions[${i}]`, a, ['seq', 'events']);
          if (!e) return;
          c.int(`actions[${i}].seq`, c.at(e, 'seq'), 1, MAX_SAFE);
          c.list(`actions[${i}].events`, c.at(e, 'events'), MAX_SAFE);
        });
      }
      c.bool('omitted', c.at(v, 'omitted'));
      break;
    }
    case 'update': {
      const v = c.record('', raw, ['kind', 'seq', 'events', 'change', 'hash'], ['steps']);
      if (!v) break;
      c.int('seq', c.at(v, 'seq'), 1, MAX_SAFE);
      const events = c.list('events', c.at(v, 'events'), MAX_SAFE);
      const ch = c.at(v, 'change');
      if (ch !== null && !isRecord(ch)) c.add('change', 'must be a change (a mapping) or null');
      c.hex('hash', c.at(v, 'hash'), HASH);
      if (Object.prototype.hasOwnProperty.call(v, 'steps')) {
        // One for each event: a change (applied when the event is played back) or null.
        const steps = c.list('steps', c.at(v, 'steps'), MAX_SAFE);
        if (steps && events && steps.length !== events.length) c.add('steps', `must hold one entry for each event (${events.length}), has ${steps.length}`);
        steps?.forEach((s, i) => {
          if (s !== null && !isRecord(s)) c.add(`steps[${i}]`, 'must be a change (a mapping) or null');
        });
      }
      break;
    }
    case 'accepted': {
      const v = c.record('', raw, ['kind', 'id', 'seq']);
      if (!v) break;
      checkId(c, v);
      c.int('seq', c.at(v, 'seq'), 0, MAX_SAFE);
      break;
    }
    case 'rejected': {
      const v = c.record('', raw, ['kind', 'id', 'code', 'detail']);
      if (!v) break;
      if (c.at(v, 'id') !== null) checkId(c, v);
      c.text('code', c.at(v, 'code'), /^[a-z_]+$/, 'a code', 64);
      if (typeof c.at(v, 'detail') !== 'string') c.add('detail', 'must be text');
      break;
    }
    case 'dice': {
      const v = c.record('', raw, ['kind', 'status']);
      if (!v) break;
      checkDiceStatus(c, 'status', c.at(v, 'status'));
      break;
    }
    case 'dice_ok': {
      const v = c.record('', raw, ['kind', 'step']);
      if (!v) break;
      c.oneOf('step', c.at(v, 'step'), ['commit', 'reveal'], 'a dice step');
      break;
    }
    case 'over': {
      const v = c.record('', raw, ['kind', 'result', 'record']);
      if (!v) break;
      checkResult(c, 'result', c.at(v, 'result'));
      checkDiceRecord(c, 'record', c.at(v, 'record'));
      break;
    }
    case 'closed': {
      const v = c.record('', raw, ['kind', 'reason']);
      if (!v) break;
      c.oneOf('reason', c.at(v, 'reason'), CLOSE_REASONS, 'a close reason');
      break;
    }
  }
  if (!c.ok) return { ok: false, problems: c.problems };
  return { ok: true, message: raw as unknown as HostMessage };
}
