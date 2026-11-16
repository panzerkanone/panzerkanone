/**
 * The table's keys, as data: which keys slide, zoom and turn the view, and the
 * same as plain lines for whoever prints a list of keys (a game's panel does;
 * the scene knows nothing of it). A test holds this table against the game's
 * and the panel's keys, so that no key does two things
 * (tests/game/keys.test.ts).
 *
 * Two sets. On the table by itself the letters W A S D slide the board beside
 * the arrows, and the digits choose a camera. When a page has taken the
 * table's controls (a game laid over it), the letters and the digits are that
 * page's: none of W A S D slides, no digit turns the camera, and the table
 * leaves alone any key the page has already used. The arrows, the zoom keys,
 * the camera key and the overview key are the table's either way.
 */

/** The characters the key left of 1 types on the common keyboard layouts, with and without Shift. */
export const CAMERA_CHARS = ['`', '~', '§', '±'];

export interface TableKeys {
  left: string[];
  right: string[];
  up: string[];
  down: string[];
  zoomIn: string[];
  zoomOut: string[];
  overview: string[];
}

/** The table by itself. */
export const KEYS: TableKeys = {
  left: ['ArrowLeft', 'a'],
  right: ['ArrowRight', 'd'],
  up: ['ArrowUp', 'w'],
  down: ['ArrowDown', 's'],
  zoomIn: ['=', '+'],
  zoomOut: ['-', '_'],
  overview: ['o'],
};

/** With its controls taken by a page: the arrows only. */
export const KEYS_TAKEN: TableKeys = {
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  zoomIn: ['=', '+'],
  zoomOut: ['-', '_'],
  overview: ['o'],
};

/** One line of a list of keys: the key as printed on a cap, what it does, and the keys it claims as a keyboard event names them (none for a gesture). */
export interface TableKeyLine {
  readonly key: string;
  readonly does: string;
  readonly claims: readonly string[];
}

/**
 * The table's keys as lines. `taken`: a page has taken the controls. `cameras`: how many cameras the
 * digits choose between on the table by itself. `counters`: the table has counters (their keys are then live).
 */
export function tableKeyLines(taken: boolean, cameras: number, counters: boolean): TableKeyLine[] {
  const keys = taken ? KEYS_TAKEN : KEYS;
  const lines: TableKeyLine[] = [
    { key: '~', does: 'next camera', claims: [...CAMERA_CHARS] },
    { key: 'O', does: 'whole board, and back', claims: [...keys.overview] },
    {
      key: taken ? '← ↑ → ↓' : '← ↑ → ↓  W A S D', does: 'slide the board',
      claims: [...keys.left, ...keys.right, ...keys.up, ...keys.down],
    },
    { key: '= −', does: 'zoom in, zoom out', claims: [...keys.zoomIn, ...keys.zoomOut] },
  ];
  if (!taken) lines.push({ key: `1–${cameras}`, does: 'a camera by its number', claims: Array.from({ length: cameras }, (_, i) => String(i + 1)) });
  if (counters) {
    lines.push({ key: 'Space', does: 'loose counters go home', claims: [' '] });
    lines.push({ key: 'B', does: 'bump the table', claims: ['b'] });
  }
  lines.push({ key: 'drag', does: 'slide the board · the wheel zooms', claims: [] });
  if (counters) lines.push({ key: 'Alt', does: 'pick up, push and flick counters', claims: [] });
  return lines;
}
