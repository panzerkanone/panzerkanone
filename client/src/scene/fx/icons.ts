/**
 * The small pictures of what a click would do: one for each act a game may name (the port's
 * `IntentAct`), and one for "no". Each is a few strokes of SVG drawn here (the project's own work;
 * nothing is downloaded), used twice: beside the words of an intent on the table, where its parts
 * move (the classes `a` and `b` are what the table's style sheet animates), and as the mouse's
 * cursor over the table, still. Plain text, no browser.
 */
import type { IntentAct } from '../pieces/port';

export const INTENT_ACTS: readonly IntentAct[] = ['select', 'order', 'move', 'fire', 'charge', 'drive', 'board', 'unload', 'call', 'screen', 'place'];

/** A picture's strokes in a 24 by 24 box, as SVG without its outer tag. `fill` parts take the paper's colour. */
const HAND = '<path class="a" data-fill="1" d="M9 11.5V4.6a1.5 1.5 0 0 1 3 0V10l4.3.8a2 2 0 0 1 1.6 2.2l-.6 4.9a3 3 0 0 1-3 2.6h-3.5a3 3 0 0 1-2.5-1.3L5 14.6a1.4 1.4 0 0 1 2.2-1.7L9 14.6z"/>';
const STROKES: Readonly<Record<IntentAct | 'no' | 'strike', string>> = {
  // A hand that taps: this one may be chosen.
  select: HAND,
  // The same hand, and the mark of an order going out from under it.
  order: `${HAND}<path class="b" d="M15.5 4.5h5M18.5 2l2.5 2.5L18.5 7"/>`,
  // Chevrons stepping the way of the move.
  move: '<path class="a" d="M4 7l5 5-5 5"/><path class="b" d="M10 7l5 5-5 5"/><path class="a" d="M16 7l5 5-5 5"/>',
  // A gun-sight closing on its mark.
  fire: '<circle class="a" cx="12" cy="12" r="7"/><path class="b" d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5"/><circle data-fill="2" cx="12" cy="12" r="1.3"/>',
  // Crossed bayonets.
  charge: '<path class="a" d="M4.5 19.5l15-15M7 14.5l2.5 2.5"/><path class="b" d="M19.5 19.5l-15-15M17 14.5l-2.5 2.5"/>',
  // An arrow driven through.
  drive: '<circle cx="12" cy="12" r="5" stroke-dasharray="2.6 2.2"/><path class="a" d="M1.5 12h20M17.5 8l4 4-4 4"/>',
  // Up onto a carrier; down off one.
  board: '<path d="M4.5 20.5h15"/><path class="a" d="M12 16V4.5M7.5 9L12 4.5 16.5 9"/>',
  unload: '<path d="M4.5 20.5h15"/><path class="a" d="M12 4v11.5M7.5 11l4.5 4.5 4.5-4.5"/>',
  // A round's arc, and where it comes down.
  call: '<path class="a" d="M3 19Q11-3 19 15" stroke-dasharray="3 2.4"/><path class="b" d="M19 15l2.5-2.5M19 15l3 1M19 15l-.5 3.5M19 15l-3 .8"/>',
  // A puff of smoke.
  screen: '<circle class="a" data-fill="1" cx="8" cy="14.5" r="4.2"/><circle class="b" data-fill="1" cx="16.5" cy="15" r="3.6"/><circle class="a" data-fill="1" cx="12.6" cy="10" r="4.6"/>',
  // A counter set down.
  place: '<path d="M4.5 20.5h15"/><rect class="a" data-fill="1" x="7" y="7" width="10" height="10" rx="1.8"/>',
  // No.
  no: '<circle cx="12" cy="12" r="8.6"/><path d="M6 6l12 12"/>',
  // One stroke through a picture: what it shows would be refused.
  strike: '<path d="M3.5 3.5l17 17"/>',
};

/** The point of each picture that is the cursor's own point (where the click lands), in the 24 by 24 box. */
const POINT: Readonly<Record<IntentAct | 'no', readonly [number, number]>> = {
  select: [10.5, 3.5], order: [10.5, 3.5], move: [12, 12], fire: [12, 12], charge: [12, 12], drive: [12, 12], board: [12, 5], unload: [12, 15], call: [19, 15], screen: [12, 12], place: [12, 18], no: [12, 12],
};

/** The browser's own cursor nearest each, for where a drawn one is not taken. */
const NEAREST: Readonly<Record<IntentAct | 'no', string>> = {
  select: 'pointer', order: 'pointer', move: 'move', fire: 'crosshair', charge: 'crosshair', drive: 'move', board: 'copy', unload: 'copy', call: 'crosshair', screen: 'cell', place: 'copy', no: 'not-allowed',
};

/** An ink (sRGB 0..255) as the page's style sheets take a colour. */
export function inkCss(ink: readonly number[], alpha = 1): string {
  const c = (k: number): number => Math.round(Math.min(255, Math.max(0, ink[k] ?? 0)));
  return alpha >= 1 ? `rgb(${c(0)} ${c(1)} ${c(2)})` : `rgb(${c(0)} ${c(1)} ${c(2)} / ${alpha})`;
}

/**
 * A picture as SVG text, `size` pixels square: drawn in `ink` over a wider line of `paper`, so that
 * it reads on any ground. `classes` keeps the classes the table animates (leave them off for a cursor).
 */
export function iconSvg(act: IntentAct | 'no' | 'strike', size: number, ink: readonly number[], paper: readonly number[], classes: boolean): string {
  const body = classes ? STROKES[act] : STROKES[act].replace(/ class="[ab]"/g, '');
  // Twice: the halo, with no parts filled; then the strokes, with the parts that are filled.
  const halo = body.replace(/ class="[ab]"/g, '').replace(/ data-fill="[12]"/g, '').replace(/ stroke-dasharray="[^"]*"/g, '');
  const top = body.replace(/ data-fill="1"/g, ` fill="${inkCss(paper)}"`).replace(/ data-fill="2"/g, ` fill="${inkCss(ink)}"`);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    `<g stroke="${inkCss(paper)}" stroke-width="4.6" opacity="0.92">${halo}</g><g stroke="${inkCss(ink)}" stroke-width="2">${top}</g></svg>`
  );
}

/** The cursor for an act (or for "no"), as a style sheet's `cursor` value: the picture drawn here, and the browser's nearest after it. */
export function cursorCss(act: IntentAct | 'no', ink: readonly number[], paper: readonly number[]): string {
  const size = 30;
  const p = POINT[act];
  const hot = (v: number): number => Math.round((v * size) / 24);
  return `url("data:image/svg+xml,${encodeURIComponent(iconSvg(act, size, ink, paper, false))}") ${hot(p[0])} ${hot(p[1])}, ${NEAREST[act]}`;
}
