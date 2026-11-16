/**
 * The lettering of the rewards screen, as plain arithmetic (no browser): how wide a line is in each of its two faces,
 * and how a line is fitted to the room it has on its paper. A screen of the shell never measures the page, so a
 * line's width is worked out here from the faces' own advance widths.
 *
 *   the stencil face   Stick No Bills 800, the game's own (headings, names, the plates). Its capitals, figures and
 *                      marks have the advances below (the file's own table, per thousand of the size; it has no
 *                      kerning, so a line is the sum of its letters).
 *   the typed face     Lekton 700 (typed-face.ts): every letter the same advance.
 *
 * The owner's headings are in a face about three quarters as wide as the stencil, so a heading is narrowed (never
 * widened): to `base` always, further when it is too long for its place, down to `least`; a line still too long at
 * `least` is then set smaller.
 */
import { TYPED_FACE } from './typed-face';

/** The stencil face's measures, of its size: a capital's height, and the baseline's depth under a line-height-1 line's top. */
export const STENCIL_FACE = { cap: 0.7, baseline: 0.814 } as const;

/** The stencil's advances, per thousand of the size (assets/shell/v1/stick-no-bills-latin-800-normal.woff2, its hmtx table, read 2026-11-15). */
const STENCIL_ADVANCE: Readonly<Record<string, number>> = {
  ' ': 230, A: 528, B: 488, C: 494, D: 472, E: 444, F: 432, G: 507, H: 525, I: 225, J: 484, K: 488, L: 433, M: 696, N: 529, O: 549, P: 479, Q: 526,
  R: 505, S: 481, T: 463, U: 512, V: 472, W: 792, X: 442, Y: 451, Z: 426,
  '0': 499, '1': 277, '2': 495, '3': 502, '4': 491, '5': 520, '6': 505, '7': 449, '8': 492, '9': 505,
  ':': 250, '.': 210, ',': 265, '-': 416, "'": 212, '’': 187, '&': 658, '+': 405, '%': 629, '/': 401, '(': 223, ')': 223, '!': 244, '?': 460,
};
/** A letter the table does not hold is taken as the widest plain capital (a line is then never wider than reckoned). */
const STENCIL_UNKNOWN = 549;

/** The width of a line in the stencil face, in capitals, at `size`, with `tracking` (of the size) after each letter. */
export function stencilWidth(text: string, size: number, tracking = 0): number {
  let sum = 0;
  for (const ch of text.toUpperCase()) sum += (STENCIL_ADVANCE[ch] ?? STENCIL_UNKNOWN) / 1000 + tracking;
  return sum * size;
}

/** The width of a line in the typed face at `size`, with `tracking` (of the size) after each letter. */
export function typedWidth(text: string, size: number, tracking = 0): number {
  return [...text].length * (TYPED_FACE.advance + tracking) * size;
}

export interface Fitted {
  /** The size the line is set at. */
  readonly size: number;
  /** How far it is narrowed (1: not at all). */
  readonly squeeze: number;
  /** The width it then has. */
  readonly width: number;
}

/**
 * A line of `natural` width at `size` fitted to at most `max`: narrowed to `base`, further if it must be, down to
 * `least`; and set smaller when it is still too long.
 */
export function fitLine(natural: number, size: number, max: number, base = 1, least = base): Fitted {
  if (!(natural > 0) || !(max > 0)) return { size, squeeze: base, width: Math.max(0, natural) * base };
  let squeeze = Math.min(base, max / natural);
  let at = size;
  if (squeeze < least) {
    at = (size * squeeze) / least;
    squeeze = least;
  }
  return { size: at, squeeze, width: natural * (at / size) * squeeze };
}

/** Words broken into lines of at most `chars` letters, taking each line as full as it goes (a word longer than that stands on a line of its own). */
function greedyLines(words: readonly string[], chars: number): string[] {
  const out: string[] = [];
  let now = '';
  for (const w of words) {
    if (now && now.length + 1 + w.length > chars) {
      out.push(now);
      now = w;
    } else now = now ? `${now} ${w}` : w;
  }
  if (now) out.push(now);
  return out;
}

/**
 * Words broken into the fewest lines of at most `chars` letters, and those lines evened out: no line is left with a
 * lone last word when the lines before it could give it company.
 */
export function typedLines(text: string, chars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const full = greedyLines(words, chars);
  if (full.length < 2) return full;
  // The narrowest measure that still takes no more lines.
  let best = full;
  for (let w = chars - 1; w >= 1; w--) {
    const tried = greedyLines(words, w);
    if (tried.length > full.length) break;
    best = tried;
  }
  return best;
}

/**
 * A citation's sentences set on lines of at most `chars` letters: a line ends where a sentence does when that takes
 * no more lines than breaking anywhere would; else the words are broken evenly.
 */
export function citationLines(sentences: readonly string[], chars: number): string[] {
  const all = sentences.map(s => s.trim()).filter(Boolean);
  const even = typedLines(all.join(' '), chars);
  const bySentence: string[] = [];
  let now = '';
  for (const s of all) {
    if (now && now.length + 1 + s.length <= chars) now = `${now} ${s}`;
    else {
      if (now) bySentence.push(...typedLines(now, chars));
      now = s;
    }
  }
  if (now) bySentence.push(...typedLines(now, chars));
  return bySentence.length <= even.length ? bySentence : even;
}
