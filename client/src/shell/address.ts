/**
 * The addresses the title screen leads to and is reached by: plain arithmetic, no browser.
 *
 * The game takes its settings from its address. What the title's settings hand on:
 *
 *   difficulty   `ai=easy | normal | hard`, once the player has chosen one (the game takes normal
 *                when there is none). The name is the one agreed for the computer player's
 *                levels; nothing in the game reads it yet.
 *   detail       `detail=low | med | high`, once chosen: the agreed name, which nothing in the game
 *                reads yet. And with it `tier=flat | tabletop | tabletop+`, the table's own name
 *                for the same three, which the table reads today: so the choice already does
 *                something. When the game reads `detail`, the `tier` line here goes.
 *   sound off    `sfx=0`: the game starts no sound effects.
 *   music off, sound on   `music=0`. In play the effects follow the music's one switch, and with
 *                the music kept off they would start off too; `music=0` in the address is about
 *                the music alone and leaves the effects on.
 *   hulks, craters   `hulks=1 | 0` and `craters=1 | 0`, once chosen (the Advanced page's Show hulks
 *                and Show craters): the table shows a kind unless its word is 0.
 */
import type { Detail, Settings } from './settings';

/** The table's name for each level of detail. */
export const TIER_OF: Readonly<Record<Detail, string>> = { low: 'flat', med: 'tabletop', high: 'tabletop+' };

/** What a game is started with besides the settings: the scenario (by its id) and which side the player takes. */
export interface GameChoice {
  scenario: string | null;
  /** The player takes the side that moves second. */
  second: boolean;
}

/** The settings' part of a game's address, written into `q` (what is not chosen is taken out). */
function withSettings(q: URLSearchParams, s: Settings): void {
  for (const k of ['ai', 'detail', 'tier', 'sfx', 'music', 'hulks', 'craters']) q.delete(k);
  if (s.difficulty) q.set('ai', s.difficulty);
  if (s.detail) {
    q.set('detail', s.detail);
    q.set('tier', TIER_OF[s.detail]);
  }
  if (!s.sound.on) q.set('sfx', '0');
  else if (s.music.ready && !s.music.on) q.set('music', '0');
  if (s.hulks !== null) q.set('hulks', s.hulks ? '1' : '0');
  if (s.craters !== null) q.set('craters', s.craters ? '1' : '0');
}

/**
 * A game on the table: `/?view=table&game=1`, the settings, `scenario=<id>` when one is chosen (it
 * starts on that scenario's own board) and `sides=second` when the player takes the second side.
 */
export function gameAddress(s: Settings, path = '/', choice: GameChoice = { scenario: null, second: false }): string {
  const q = new URLSearchParams({ view: 'table', game: '1' });
  if (choice.scenario) q.set('scenario', choice.scenario);
  if (choice.second) q.set('sides', 'second');
  withSettings(q, s);
  return `${path}?${q.toString()}`;
}

/**
 * Where the settings screen goes back to when the game opened it (`from=game`): the game's own
 * address (the page it came from, when that was a game of this site), with the settings as they are
 * now; else a new game.
 */
export function backToGame(s: Settings, came: string | null, origin: string, path = '/'): string {
  let q: URLSearchParams | null = null;
  if (came) {
    try {
      const u = new URL(came);
      if (u.origin === origin && u.searchParams.get('view') === 'table') {
        q = u.searchParams;
        path = u.pathname;
      }
    } catch {
      q = null;
    }
  }
  if (!q) return gameAddress(s, path);
  withSettings(q, s);
  return `${path}?${q.toString()}`;
}

/** The title screen: the page with nothing asked of it. The game's menu leads back here. */
export function titleAddress(path = '/'): string {
  return path;
}

/**
 * The shell's screens, as the address names them (`screen=`; the title has none). `campaigns` is the campaign list and
 * `campaign` the campaign's briefing room (its intro, between battles, its end), which names its campaign by `campaign=`.
 */
export type ScreenId = 'title' | 'settings' | 'scenarios' | 'side' | 'campaigns' | 'campaign' | 'rewards' | 'service';
const SCREENS: readonly ScreenId[] = ['title', 'settings', 'scenarios', 'side', 'campaigns', 'campaign', 'rewards', 'service'];

/** The screen an address asks for (the title when it asks for none, or for one there is not). */
export function screenOf(q: URLSearchParams): ScreenId {
  const s = q.get('screen');
  return (SCREENS as readonly string[]).includes(s ?? '') ? (s as ScreenId) : 'title';
}

/** The words of a screen's address that belong to a screen (the rest, a capture's `t=` or `seed=`, are kept as they are). */
const OWN = ['screen', 'from', 'scenario', 'campaign'];
/** The words of an invitation to a seat of an online game: the side selector's alone. */
const SEAT = ['match', 'side', 'key'];

/**
 * The address of a screen, from the address of the page now: the screen's own words replace those
 * of the screen before (`from=game` stays with the settings; a scenario with the side selector, and
 * with the list, which then has it in hand). `online=1` (the title's Multiplayer: the list and the
 * side selector then make a game to play online) stays from screen to screen until the title, or
 * until `online` says otherwise; so does `server=`, the game server a page plays online on
 * (client/src/net/address.ts).
 */
export function screenAddress(now: URLSearchParams, to: ScreenId, path: string, extra: { from?: string | null; scenario?: string | null; online?: boolean; campaign?: string | null } = {}): string {
  const q = new URLSearchParams(now);
  for (const k of OWN) q.delete(k);
  if (to === 'title' || extra.online === false) q.delete('online');
  else if (extra.online === true) q.set('online', '1');
  if (to !== 'side') for (const k of SEAT) q.delete(k);
  if (to !== 'title') q.set('screen', to);
  if (to === 'settings' && extra.from) q.set('from', extra.from);
  if ((to === 'side' || to === 'scenarios') && extra.scenario) q.set('scenario', extra.scenario);
  if ((to === 'campaign' || to === 'campaigns') && extra.campaign) q.set('campaign', extra.campaign);
  const text = q.toString();
  return text ? `${path}?${text}` : path;
}
