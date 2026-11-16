/**
 * Whether the title waits for its PLAY GAME medallion to be pressed (play.ts): plain arithmetic, no
 * browser. The title and its sound (sound.ts) both ask, with the address the page was opened with.
 *
 * A browser plays no sound before the page has been touched. So a page that opens on the title, not
 * yet touched, shows the painting with the medallion in the menu's place, and the music and the
 * picture's sounds wait for its press (the press is the touch). Not:
 *   - when the page opens on another screen (a reload of the list, say),
 *   - on a still (`t=` in the address), nor with `play=0` (for scripts and captures),
 *   - when the page has already been touched (the browser says so: a page that was played with and
 *     reloaded is a new page, and has not).
 * `play=1` makes it wait whatever the browser says of a touch: for scripts, whose own reading of a page
 * the browser counts as a touch (Playwright reads a page as a user's gesture).
 */
import { screenOf } from './address';

export function playWaits(params: URLSearchParams, touched: boolean): boolean {
  const asked = params.get('play');
  return asked !== '0' && (!touched || asked === '1') && params.get('t') === null && screenOf(params) === 'title';
}
