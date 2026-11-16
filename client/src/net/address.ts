/**
 * The addresses of a game played online: plain arithmetic on addresses, no browser.
 *
 * A seat of an online game is a link. The game page plays it with, besides the scenario's own words:
 *
 *   match=<32 hex digits>   the game, as the server named it
 *   side=0 | 1              the seat, in order of play (0 moves first)
 *   key=<32 hex digits>     the seat's link key (session/invite.ts): whoever holds it plays the seat
 *   server=<origin>         the game server, when it is not the published one: http://127.0.0.1:8790
 *                           for wrangler dev on this machine
 *
 * The invitation is the same seat's words on the side selector (`screen=side`), which shows the
 * scenario and the side and leads to the game page. The link key never goes to the server.
 */

/** The published game server. */
export const DEFAULT_SERVER = 'https://games.panzerkanone.com';

const HEX32 = /^[0-9a-f]{32}$/;

/** The seat an address asks to play online, or null when it asks for none. */
export interface OnlineSeat {
  readonly match: string;
  readonly side: 0 | 1;
  /** The link key, as 32 hex digits. */
  readonly key: string;
  readonly server: string;
}

/** The game server an address names (`server=`, an http or https origin), or the published one. */
export function serverFrom(q: URLSearchParams): string {
  const asked = q.get('server');
  if (asked !== null && /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(asked)) return asked;
  return DEFAULT_SERVER;
}

export function onlineFrom(q: URLSearchParams): OnlineSeat | null {
  const match = q.get('match');
  const side = q.get('side');
  const key = q.get('key');
  if (match === null || key === null || !HEX32.test(match) || !HEX32.test(key) || (side !== '0' && side !== '1')) return null;
  return { match, side: side === '1' ? 1 : 0, key, server: serverFrom(q) };
}

/** The seat's words, written into an address (the server only when it is not the published one). */
export function withSeat(q: URLSearchParams, s: OnlineSeat): URLSearchParams {
  q.set('match', s.match);
  q.set('side', String(s.side));
  q.set('key', s.key);
  if (s.server !== DEFAULT_SERVER) q.set('server', s.server);
  else q.delete('server');
  return q;
}

/** The invitation to a seat: the side selector at `origin` + `path`, showing the scenario and the seat's side. */
export function invitationAddress(origin: string, path: string, scenario: string, s: OnlineSeat): string {
  const q = withSeat(new URLSearchParams({ screen: 'side', scenario }), s);
  return `${origin}${path}?${q.toString()}`;
}

/** The address of the server's game. */
export function gameUrl(server: string, match: string): string {
  return `${server}/games/${match}`;
}

/** The address of the game's socket. */
export function socketUrl(server: string, match: string): string {
  return `${server.replace(/^http/, 'ws')}/games/${match}/socket`;
}

/** Bytes as lower-case hex digits; hex digits as bytes. */
export function hexOf(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function bytesOf(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}
