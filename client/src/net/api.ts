/**
 * What a page asks the game server over plain HTTP (worker/src/index.ts): to make a game, and what
 * a game is before joining it. And the invitation a page that made a game keeps, so that its game
 * page can show the link again while it waits.
 */
import { inviteCheckOfLink } from '../../../session/invite';
import { bytesOf, gameUrl, hexOf } from './address';

const HEX32 = /^[0-9a-f]{32}$/;
const WAIT_MS = 12000;

async function ask(url: string, init: RequestInit = {}): Promise<Response> {
  const stop = new AbortController();
  const timer = window.setTimeout(() => stop.abort(), WAIT_MS);
  try {
    return await fetch(url, { ...init, signal: stop.signal, cache: 'no-store' });
  } finally {
    window.clearTimeout(timer);
  }
}

async function errorOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === 'string') return body.error;
  } catch {
    // no words
  }
  return `The game server answered ${res.status}.`;
}

/** A new link key: 16 bytes from the platform's random source, as hex. */
export function newLinkKey(): string {
  return hexOf(crypto.getRandomValues(new Uint8Array(16)));
}

/** A game made on the server, and the link key of each seat (in order of play). Throws, with words a player can read, when it cannot be made. */
export async function makeGame(server: string, scenario: string): Promise<{ match: string; keys: readonly [string, string] }> {
  const keys = [newLinkKey(), newLinkKey()] as const;
  let res: Response;
  try {
    res = await ask(`${server}/games`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario, invites: keys.map(k => inviteCheckOfLink(bytesOf(k))) }),
    });
  } catch {
    throw new Error('The game server could not be reached.');
  }
  if (!res.ok) throw new Error(await errorOf(res));
  const body = (await res.json()) as { match?: unknown };
  if (typeof body.match !== 'string' || !HEX32.test(body.match)) throw new Error('The game server gave no game.');
  return { match: body.match, keys };
}

export type GameInfo =
  | { readonly kind: 'game'; readonly scenario: string; readonly seats: readonly string[]; readonly over: boolean }
  | { readonly kind: 'gone' }
  | { readonly kind: 'unreachable' };

/** What a game is, before joining it: its scenario and seats; gone when the server has no such game. */
export async function gameInfo(server: string, match: string): Promise<GameInfo> {
  let res: Response;
  try {
    res = await ask(gameUrl(server, match));
  } catch {
    return { kind: 'unreachable' };
  }
  if (res.status === 404) return { kind: 'gone' };
  if (!res.ok) return { kind: 'unreachable' };
  try {
    const body = (await res.json()) as { scenario?: unknown; seats?: unknown; over?: unknown };
    if (typeof body.scenario !== 'string' || !Array.isArray(body.seats)) return { kind: 'unreachable' };
    return { kind: 'game', scenario: body.scenario, seats: body.seats.filter((s): s is string => typeof s === 'string'), over: body.over === true };
  } catch {
    return { kind: 'unreachable' };
  }
}

const KEPT = 'panzerkanone.invitation.';

/** Keep the invitation of a game this page made (this browser only). */
export function keepInvitation(match: string, link: string): void {
  try {
    window.localStorage.setItem(KEPT + match, link);
  } catch {
    // storage refused: the link is still on the screen it was made on
  }
}

/** The invitation of a game this browser made, if it kept one. */
export function keptInvitation(match: string): string | null {
  try {
    return window.localStorage.getItem(KEPT + match);
  } catch {
    return null;
  }
}
