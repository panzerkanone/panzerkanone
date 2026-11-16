/**
 * The question the menu's Main menu asks before it ends a battle (the owner, 2026-11-14: "We need to make sure the
 * user agrees to end a game on 'go to main menu' option."): its words and its keys, as plain data and arithmetic. The
 * panel's box that asks it is hud-leave.ts.
 *
 *   End this battle and go to the main menu?        [ End battle ]  [ Keep playing  Esc ]
 *
 * Keep playing is the default: it is lit (the panel's look for the button Enter presses) and Enter presses it. Left
 * and Right, Tab and the other arrows move the light between the two; Enter or Space presses the lit one; Esc, and a
 * click anywhere outside the box, keep playing. While the question is up every key is its own (nothing reaches the
 * game). Online the words say what is true there: the game is the server's, and its link brings the player back.
 */

/** What the question says, and its two buttons: `yes` ends the battle (or leaves the game), `no` keeps playing. */
export interface LeaveWords {
  readonly ask: string;
  readonly yes: string;
  readonly no: string;
}

export const LEAVE_WORDS: { readonly local: LeaveWords; readonly online: LeaveWords } = {
  local: { ask: 'End this battle and go to the main menu?', yes: 'End battle', no: 'Keep playing' },
  online: { ask: 'Leave this game? You can come back to it by its link.', yes: 'Leave game', no: 'Keep playing' },
};

/** The two answers, left to right. */
export type LeaveChoice = 'yes' | 'no';

/** What a key does while the question is up: answer it, or move the light to a button; null: nothing (the key is taken all the same). */
export function leaveKey(key: string, lit: LeaveChoice): { readonly act: LeaveChoice } | { readonly light: LeaveChoice } | null {
  switch (key) {
    case 'Escape':
      return { act: 'no' };
    case 'Enter':
    case ' ':
      return { act: lit };
    case 'ArrowLeft':
      return { light: 'yes' };
    case 'ArrowRight':
      return { light: 'no' };
    case 'Tab':
    case 'ArrowUp':
    case 'ArrowDown':
      return { light: lit === 'yes' ? 'no' : 'yes' };
    default:
      return null;
  }
}
