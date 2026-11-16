/**
 * Where an online game stands, and what the status plate and the box under it say of it. The
 * game's own model is drawn as it is while the game is being played; while it cannot be (the other
 * player has not joined, the connection is lost, the game is open in another window) the plate
 * says so instead, in a few words, and the box says what happens next.
 *
 * Plain modern English, American spelling, short. Nothing here is logic but the choice of words.
 */
import type { GameModel } from '../game/model';

export type NetStatus =
  /** Opening the connection, the first time. */
  | 'connecting'
  /** Joined; the other player has not. */
  | 'waiting'
  /** Both have joined; the dice are being agreed. */
  | 'starting'
  /** Being played. */
  | 'playing'
  /** The connection was lost; it is being opened again. */
  | 'retrying'
  /** The same seat was opened in another window, which now has it. */
  | 'replaced'
  /** The server has no such game. */
  | 'gone'
  /** The game was made by another version of the game (its scenario, board or rules have changed since). */
  | 'version'
  /** The link does not hold its seat, or the server refused the page for another reason. */
  | 'refused'
  /** The two sides could not agree on the dice. */
  | 'failed';

export const NET_WORDS: Readonly<Record<Exclude<NetStatus, 'playing'>, { readonly plate: string; readonly todo: string }>> = {
  connecting: { plate: 'Connecting', todo: 'Joining the game.' },
  waiting: { plate: 'Waiting for your opponent', todo: 'The game starts when your opponent opens the invitation link.' },
  starting: { plate: 'Starting', todo: 'Your opponent has joined. The game is about to start.' },
  retrying: { plate: 'Connection lost: retrying', todo: 'Your moves are kept and sent when the connection is back.' },
  replaced: { plate: 'Open in another window', todo: 'This game is now being played in another window. Reload this page to play here instead.' },
  gone: { plate: 'Game not found', todo: 'This game has ended, or the link is wrong.' },
  version: { plate: 'Cannot join', todo: 'This game was made with an older version of Panzer Kanone and cannot be continued. Start a new game.' },
  refused: { plate: 'Cannot join', todo: 'This link cannot join the game. Ask your opponent for the link again.' },
  failed: { plate: 'Game could not start', todo: 'The two sides could not agree on the dice. Start a new game.' },
};

/** The plate's words while the other player decides. */
export const OPPONENT_TURN = "Opponent's turn";

/** At the end of an online game the result offers the main menu in place of playing again (there is no one here to play again with). */
export const MAIN_MENU = 'Main menu';

/** The game's model with the online game's state in its plate and its box. */
export function dressModel(m: GameModel, s: NetStatus): GameModel {
  // Over: the result offers the main menu, and no new seed.
  const shown = m.result === null ? m : { ...m, controls: m.controls.filter(c => c.id !== 'reseed').map(c => (c.id === 'again' ? { ...c, label: MAIN_MENU } : c)) };
  if (s === 'playing') {
    if (shown.result === null && shown.mode === 'watch') return { ...shown, banner: { ...shown.banner, turnOf: OPPONENT_TURN } };
    return shown;
  }
  const w = NET_WORDS[s];
  return { ...shown, banner: { ...shown.banner, turnOf: w.plate, title: w.plate, todo: w.todo, prompt: w.todo, why: '' } };
}
