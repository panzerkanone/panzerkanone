/**
 * The index of the title screen's art (assets/shell/v1/shell.json, written by `npm run shellart`),
 * read strictly: a key missing, an unknown one, a wrong kind of value or a piece the screen needs
 * and does not find is an error. Plain arithmetic, no browser.
 *
 * Every piece's place (`at`) is given on the `frame`: the size of the owner's painting, on which
 * the whole screen is laid out (layout.ts).
 */

export interface Piece {
  id: string;
  file: string;
  width: number;
  height: number;
  /** Where its top-left corner lies on the frame. */
  at: readonly [number, number];
  shows: string;
}
export interface FramePiece extends Piece {
  /** How far its corners reach in from its edges: top, right, bottom, left. */
  slice: readonly [number, number, number, number];
}
export interface StripPiece extends Piece {
  /** The rivets' own period in pixels, and how many of them the tile holds. */
  period: number;
  periods: number;
}

/** The settings screen's pieces (settings-screen.ts). */
export interface SettingsArt {
  /** The desk, the frame, the title lettering and the blank heading strip: the whole screen under the notebook. */
  desk: Piece;
  /** The open notebook with its two blank sliders and six blank buttons. */
  book: Piece;
  /** The kit's spare slider rail, laid over each painted one. */
  rail: Piece;
  knob: Piece;
  /** A blank button as it lies in the upper row, in the lower row, and lit (chosen). */
  button: Piece;
  buttonLower: Piece;
  buttonLit: Piece;
  /** The two emblems at the right page's foot, with their paper, to lay back over a red frame. */
  emblems: Piece;
  tag: Piece;
}
/** The side selector's pieces (side-screen.ts). */
export interface SideArt {
  /** The desk, the frame, the blank heading strip and the notebook with the two emblems. */
  panel: Piece;
  title: Piece;
  /** The first page's tank and the second's. */
  tanks: readonly [Piece, Piece];
  /** Each page's select button, plain and lit. */
  selects: readonly [{ plain: Piece; lit: Piece }, { plain: Piece; lit: Piece }];
  tagWide: Piece;
  tagNarrow: Piece;
}

/** The pieces the screen is made of, by what they are. */
export interface ShellArt {
  frame: readonly [number, number];
  battlefield: Piece;
  tanks: Piece;
  title: Piece;
  plateLit: Piece;
  /** One dark plate for each line of the menu (the kit has three; the first line takes the third's). */
  platesDark: readonly Piece[];
  nameplate: Piece;
  panelFrame: FramePiece;
  strip: StripPiece;
  settings: SettingsArt;
  side: SideArt;
  /** The PLAY GAME medallion that waits over the title until the page is first pressed (play.ts): at rest and ablaze (its metal and letters as they burn), one size, one place. */
  play: { rest: Piece; ablaze: Piece };
  font: { family: string; weight: number; file: string };
  /** Every file the index names. */
  files: readonly string[];
}

const fail = (why: string): never => {
  throw new Error(`shell.json: ${why}`);
};
const map = (v: unknown, what: string): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(`${what} must be a mapping`));
const text = (v: unknown, what: string): string => (typeof v === 'string' && v !== '' ? v : fail(`${what} must be a non-empty string`));
const positive = (v: unknown, what: string): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fail(`${what} must be a number above 0`));
const whole = (v: unknown, what: string): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : fail(`${what} must be a whole number, 0 or more`));
const wholes = (v: unknown, n: number, what: string): number[] => (Array.isArray(v) && v.length === n ? v.map((x, i) => whole(x, `${what}[${i}]`)) : fail(`${what} must be ${n} whole numbers`));
function only(m: Record<string, unknown>, need: readonly string[], may: readonly string[], what: string): void {
  for (const k of Object.keys(m)) if (!need.includes(k) && !may.includes(k)) fail(`${what} has an unknown key "${k}"`);
  for (const k of need) if (!(k in m)) fail(`${what} lacks "${k}"`);
}

export function readShellArt(source: unknown): ShellArt {
  const top = map(source, 'the file');
  only(top, ['format', 'frame', 'pieces', 'font'], [], 'the file');
  if (top.format !== 'shell-art/1') fail('format must be shell-art/1');
  const frame = wholes(top.frame, 2, 'frame') as [number, number];
  if (frame[0] < 1 || frame[1] < 1) fail('frame must have a size');
  if (!Array.isArray(top.pieces)) fail('pieces must be a list');

  const byId = new Map<string, Record<string, unknown>>();
  const files: string[] = [];
  (top.pieces as unknown[]).forEach((raw, i) => {
    const what = `pieces[${i}]`;
    const p = map(raw, what);
    only(p, ['id', 'file', 'width', 'height', 'at', 'shows'], ['slice', 'period', 'periods'], what);
    const id = text(p.id, `${what}.id`);
    if (byId.has(id)) fail(`${what}.id "${id}" is used twice`);
    byId.set(id, p);
    files.push(text(p.file, `${what}.file`));
  });
  const piece = (id: string): Piece => {
    const p = byId.get(id) ?? fail(`there is no piece "${id}"`);
    const at = wholes(p.at, 2, `${id}.at`) as [number, number];
    const width = positive(p.width, `${id}.width`);
    const height = positive(p.height, `${id}.height`);
    if (at[0] + width > frame[0] || at[1] >= frame[1]) fail(`${id} lies off the frame`);
    return { id, file: text(p.file, `${id}.file`), width, height, at, shows: text(p.shows, `${id}.shows`) };
  };
  const raw = (id: string): Record<string, unknown> => byId.get(id) as Record<string, unknown>;

  const panelFrame: FramePiece = { ...piece('frame'), slice: wholes(raw('frame').slice, 4, 'frame.slice') as [number, number, number, number] };
  if (panelFrame.slice[0] + panelFrame.slice[2] >= panelFrame.height || panelFrame.slice[1] + panelFrame.slice[3] >= panelFrame.width) fail("the frame's slices meet in its middle");
  const strip: StripPiece = { ...piece('strip'), period: positive(raw('strip').period, 'strip.period'), periods: positive(raw('strip').periods, 'strip.periods') };
  if (Math.abs(strip.period * strip.periods - strip.width) > 1) fail("the strip's tile is not a whole number of its periods");
  const battlefield = piece('battlefield');
  const tanks = piece('tanks');
  for (const whole of [battlefield, tanks]) if (whole.width !== frame[0] || whole.height !== frame[1] || whole.at[0] !== 0 || whole.at[1] !== 0) fail(`${whole.id} must be the whole frame`);

  const f = map(top.font, 'font');
  only(f, ['family', 'weight', 'file'], [], 'font');
  const font = { family: text(f.family, 'font.family'), weight: positive(f.weight, 'font.weight'), file: text(f.file, 'font.file') };
  files.push(font.file);

  return {
    frame,
    battlefield,
    tanks,
    title: piece('title'),
    plateLit: piece('plate-lit'),
    platesDark: [piece('plate-dark-3'), piece('plate-dark-1'), piece('plate-dark-2'), piece('plate-dark-3')],
    nameplate: piece('nameplate'),
    panelFrame,
    strip,
    settings: {
      desk: piece('settings-desk'),
      book: piece('settings-book'),
      rail: piece('settings-rail'),
      knob: piece('settings-knob'),
      button: piece('settings-button'),
      buttonLower: piece('settings-button-lower'),
      buttonLit: piece('settings-button-lit'),
      emblems: piece('settings-emblems'),
      tag: piece('settings-tag'),
    },
    side: {
      panel: piece('side-panel'),
      title: piece('side-title'),
      tanks: [piece('side-tank-first'), piece('side-tank-second')],
      selects: [
        { plain: piece('side-select-first'), lit: piece('side-select-first-lit') },
        { plain: piece('side-select-second'), lit: piece('side-select-second-lit') },
      ],
      tagWide: piece('side-tag-wide'),
      tagNarrow: piece('side-tag-narrow'),
    },
    play: playOf(piece('play-rest'), piece('play-ablaze')),
    font,
    files,
  };
}

function playOf(rest: Piece, ablaze: Piece): ShellArt['play'] {
  if (rest.width !== ablaze.width || rest.height !== ablaze.height || rest.at[0] !== ablaze.at[0] || rest.at[1] !== ablaze.at[1]) fail('the medallion at rest and ablaze must be one size in one place');
  return { rest, ablaze };
}
