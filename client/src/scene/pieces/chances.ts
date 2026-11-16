/**
 * The chance of every target at once (the port's `chances`): the cards' size, where each lies, and the strokes that
 * draw one. Plain arithmetic, no browser: cues.ts keeps the cards and their fades, view.ts uploads the strokes.
 *
 * A card lies on its own counter, over the picture: between the title and the foot, left of how far it moves, so that
 * it covers none of the counter's numbers and leaves its name to be read, and no one can mistake whose it is (beside
 * the counters, in a crowd of them, a card was as near another counter as its own: tried first, and given up). It
 * lies flat, its letters turned to the camera as a tag's are. Where that place will not do (a second target in the
 * same hex, whose face lies under the other's; a counter lying turned, which brings its numbers under the card), it
 * lies beside the counter instead: the first place of a fixed list round it (below it, toward the viewer; to its
 * right; to its left; above it; at its corners; then a ring further out) that covers no counter's numbers and no
 * other card, and lies on no other counter where such a place is. A place is chosen once, when the card first
 * appears, and kept while it stays and is still clear: turning the table moves no card.
 */
import { CHANCE, COUNTER } from './dims';
import { GLYPH_HEIGHT, letter } from './glyphs';
import type { Strokes } from './cues';

type P2 = readonly [number, number];
type Rgb = readonly [number, number, number];

/** What the port gives for one card. */
export interface ChanceSpec {
  unit: string;
  hex: number;
  chance: string;
  kill: string;
  best: boolean;
  /** The key letters of the other ways to attack the target ("C", "V"): printed small after the chance as "+C". Absent: none. */
  also?: string;
}

/** The mark after the chance of the other ways to attack: "+C"; '' for none. */
export function chanceMark(spec: { also?: string }): string {
  return spec.also !== undefined && spec.also !== '' ? `+${spec.also}` : '';
}

/**
 * Every effect the attack can have destroys (a Suppressed target is destroyed by a second suppression): the two chances
 * are one. The card then prints it once, in the destroy's ink, not the same figure twice (the lead, 2026-11-14).
 */
export function allDestroy(spec: { chance: string; kill: string }): boolean {
  return spec.kill !== '' && spec.kill === spec.chance;
}

/** The second line of a card, the chance to destroy: '' when there is none, and when it is the chance itself. */
export function killLine(spec: { chance: string; kill: string }): string {
  return allDestroy(spec) ? '' : spec.kill;
}

/**
 * A counter on the board as the layout sees it: its middle, its turn (radians, its x axis from the board's), and
 * whether it lies on top of its stack (false: another lies on it and hides its face; left out: it does not).
 */
export interface CounterBox {
  id: string;
  x: number;
  y: number;
  yaw: number;
  top?: boolean;
}

/** A card's size on the table (along its letters, across them). */
export function chanceSize(spec: { chance: string; kill: string; also?: string }): [number, number] {
  const wide = (text: string, height: number): number => (text === '' ? 0 : (letter(text).width / GLYPH_HEIGHT) * height);
  const mark = chanceMark(spec);
  const first = wide(spec.chance, CHANCE.letter) + (mark !== '' ? CHANCE.markGap + wide(mark, CHANCE.killLetter) : 0);
  const kill = killLine(spec);
  const w = Math.max(first, wide(kill, CHANCE.killLetter)) + 2 * CHANCE.pad[0];
  const h = CHANCE.letter + (kill !== '' ? CHANCE.lineGap + CHANCE.killLetter : 0) + 2 * CHANCE.pad[1];
  return [w, h];
}

// ---- rectangles ----------------------------------------------------------------------------------

/** A rectangle on the board: its middle, its half sizes, and its turn. */
export interface Box {
  c: P2;
  half: P2;
  yaw: number;
}

/** Whether two rectangles overlap (the separating axes of both). */
export function overlap(a: Box, b: Box): boolean {
  const axes: P2[] = [
    [Math.cos(a.yaw), Math.sin(a.yaw)], [-Math.sin(a.yaw), Math.cos(a.yaw)],
    [Math.cos(b.yaw), Math.sin(b.yaw)], [-Math.sin(b.yaw), Math.cos(b.yaw)],
  ];
  const reach = (r: Box, ax: P2): number => {
    const u: P2 = [Math.cos(r.yaw), Math.sin(r.yaw)];
    const v: P2 = [-Math.sin(r.yaw), Math.cos(r.yaw)];
    return r.half[0] * Math.abs(u[0] * ax[0] + u[1] * ax[1]) + r.half[1] * Math.abs(v[0] * ax[0] + v[1] * ax[1]);
  };
  for (const ax of axes) {
    const d = Math.abs((a.c[0] - b.c[0]) * ax[0] + (a.c[1] - b.c[1]) * ax[1]);
    if (d >= reach(a, ax) + reach(b, ax)) return false;
  }
  return true;
}

/**
 * Where a face prints what, as faces.ts prints it (shares of the face): the stock left bare at each edge, the foot with
 * its attack, range and defence, and the picture's box (x, y, width, height). Copied, not imported: faces.ts draws on a
 * canvas and is kept out of the plain checks; tests/scene/chances.test.ts holds the copy to faces.ts's own values.
 */
export const FACE_MEASURES = {
  inset: 0.0625,
  foot: { left: 0.05, right: 0.95, top: 0.725, height: 0.19 },
  picture: [0.07, 0.335, 0.55, 0.36] as readonly [number, number, number, number],
} as const;
const FACE_INSET = FACE_MEASURES.inset;
const FOOT = FACE_MEASURES.foot;
const SILHOUETTE_BOX = FACE_MEASURES.picture;

/** A share of the printed face (x across, y down from its band; faces.ts) as a length from the counter's middle, in h. */
function faceAt(share: number): number {
  const s = COUNTER.side;
  return -s / 2 + s * FACE_INSET + share * s * (1 - 2 * FACE_INSET);
}

/** A point given from a counter's middle in its own frame, on the board. */
function fromCounter(k: CounterBox, lx: number, ly: number): P2 {
  const c = Math.cos(k.yaw);
  const n = Math.sin(k.yaw);
  return [k.x + lx * c - ly * n, k.y + lx * n + ly * c];
}

/** A part of a counter's face (from, to: shares of the printed face) as a rectangle on the board. */
function facePart(k: CounterBox, x0: number, x1: number, y0: number, y1: number): Box {
  const w = faceAt(1) - faceAt(0);
  return { c: fromCounter(k, (faceAt(x0) + faceAt(x1)) / 2, (faceAt(y0) + faceAt(y1)) / 2), half: [((x1 - x0) / 2) * w, ((y1 - y0) / 2) * w], yaw: k.yaw };
}

/** Where a counter's numbers are printed (faces.ts), a little large (the ring round the range): how far it moves, beside the picture, with the line under it; and the foot, its attack, range and defence. */
const MOVE_SHARE = { left: 0.62, right: 0.94, top: 0.37, foot: 0.645 } as const;
const FOOT_SHARE = { left: FOOT.left - 0.02, right: FOOT.right + 0.02, top: FOOT.top - 0.03, foot: FOOT.top + FOOT.height + 0.03 } as const;
/** The foot of the title's letters (the band is 0.07 to 0.30 of the face, its letters the middle three fifths of it). */
const TITLE_FOOT_SHARE = 0.07 + 0.23 * 0.8;

export function numberBoxes(k: CounterBox): Box[] {
  return [
    facePart(k, MOVE_SHARE.left, MOVE_SHARE.right, MOVE_SHARE.top, MOVE_SHARE.foot),
    facePart(k, FOOT_SHARE.left, FOOT_SHARE.right, FOOT_SHARE.top, FOOT_SHARE.foot),
  ];
}

/**
 * The card's place on its own counter: between the title's letters and the foot, over the picture, its right edge
 * short of how far the counter moves; at the picture's middle where it fits so.
 */
export function onCounter(k: CounterBox, size: P2): P2 {
  const right = faceAt(MOVE_SHARE.left) - CHANCE.gap / 2;
  const middle = faceAt(SILHOUETTE_BOX[0] + SILHOUETTE_BOX[2] / 2);
  const lx = Math.min(middle, right - size[0] / 2);
  const ly = (faceAt(TITLE_FOOT_SHARE) + faceAt(FOOT_SHARE.top)) / 2;
  return fromCounter(k, lx, ly);
}

function squareOf(k: CounterBox, grow = 0): Box {
  return { c: [k.x, k.y], half: [COUNTER.side / 2 + grow, COUNTER.side / 2 + grow], yaw: k.yaw };
}

// ---- the layout ----------------------------------------------------------------------------------

export interface ChanceAsk {
  /** Its own counter. */
  own: CounterBox;
  size: P2;
  /** Its place from before (the card's middle), kept if it is still clear. */
  prev?: P2 | null;
}

/** The places tried round a counter, in order: offsets of the card's middle from the counter's. */
function places(size: P2): { off: P2; ring: number }[] {
  const s = COUNTER.side / 2 + CHANCE.gap;
  const [w, h] = size;
  const out: { off: P2; ring: number }[] = [];
  for (let ring = 0; ring < 2; ring++) {
    const r = ring * CHANCE.ring;
    const dx = s + w / 2 + r;
    const dy = s + h / 2 + r;
    out.push(
      { off: [0, dy], ring }, { off: [dx, 0], ring }, { off: [-dx, 0], ring }, { off: [0, -dy], ring },
      { off: [dx, dy], ring }, { off: [-dx, dy], ring }, { off: [dx, -dy], ring }, { off: [-dx, -dy], ring },
    );
  }
  return out;
}

/**
 * Lay the cards: the middle of each, in the order asked (the best first, by the caller). A card covers no counter's
 * numbers and no card laid before it: on its own counter where it can (its place from before, else onCounter); else
 * the first place round the counter that lies on no other counter; else the first that only lies on some counter's
 * picture or title. Where none is clear, on its own counter all the same.
 */
export function layChances(asks: readonly ChanceAsk[], counters: readonly CounterBox[]): P2[] {
  // Only a face that shows has numbers to keep clear, and only a face that shows can carry its own card.
  const numbers = counters.filter(k => k.top !== false).flatMap(numberBoxes);
  const squares = counters.map(k => squareOf(k, CHANCE.gap));
  const laid: Box[] = [];
  const card = (c: P2, size: P2, grow = 0): Box => ({ c, half: [size[0] / 2 + grow, size[1] / 2 + grow], yaw: 0 });
  const allowed = (c: P2, size: P2): boolean => {
    const b = card(c, size);
    return !numbers.some(n => overlap(b, n)) && !laid.some(l => overlap(card(c, size, CHANCE.gap / 2), { ...l, half: [l.half[0] + CHANCE.gap / 2, l.half[1] + CHANCE.gap / 2] }));
  };
  const free = (c: P2, size: P2): boolean => !squares.some(q => overlap(card(c, size), q));
  return asks.map(a => {
    let pick: P2 | null = null;
    if (a.prev && allowed(a.prev, a.size)) pick = a.prev;
    const own = onCounter(a.own, a.size);
    if (!pick && a.own.top !== false && allowed(own, a.size)) pick = own;
    const tried = places(a.size).map(p => [a.own.x + p.off[0], a.own.y + p.off[1]] as P2);
    if (!pick) pick = tried.find(c => allowed(c, a.size) && free(c, a.size)) ?? null;
    if (!pick) pick = tried.find(c => allowed(c, a.size)) ?? own;
    laid.push(card(pick, a.size));
    return pick;
  });
}

// ---- strokes -------------------------------------------------------------------------------------

export interface ChanceStrokeEnv {
  /** The way the screen's right lies on the board: letters run along it. */
  right: P2;
  shadow: P2;
  /** The height of what lies under a card put down at a point (its half sizes along its letters and across them). */
  topUnder(x: number, y: number, along: number, across: number): number;
}

/** The strokes of one card at its middle `c`, as far in as `a` (0 to 1). Inks are passed in, so that dims.ts holds them all. */
export function chanceStrokes(out: Strokes, spec: ChanceSpec, c: P2, a: number, env: ChanceStrokeEnv, inks: { paper: Rgb; bestPaper: Rgb; ink: Rgb; kill: Rgb; keyline: Rgb; bestKeyline: Rgb; shadow: Rgb }): void {
  if (a <= 0) return;
  const [w, h] = chanceSize(spec);
  const rx = env.right[0];
  const ry = env.right[1];
  // Down the screen, on the board: letters are written from their tops toward the viewer.
  const dx = -ry;
  const dy = rx;
  const z = env.topUnder(c[0], c[1], w / 2, h / 2) + CHANCE.lift;
  const r = CHANCE.radius;
  const keyline = spec.best ? CHANCE.bestKeyline : CHANCE.keyline;
  const bar = (grow: number, radius: number, colour: Rgb, alpha: number, soft: number, off: P2, lift: number): void => {
    const half = w / 2 + grow - radius;
    out.add({
      a: [c[0] - rx * half + off[0], c[1] - ry * half + off[1]],
      b: [c[0] + rx * half + off[0], c[1] + ry * half + off[1]],
      z: z + lift,
      halfWidth: h / 2 + grow,
      radius,
      soft,
      ink: colour,
      alpha,
    });
  };
  const reach = CHANCE.shadow;
  bar(0, r, inks.shadow, CHANCE.shadowAlpha * a, reach, [env.shadow[0] * reach * 0.45, env.shadow[1] * reach * 0.45], -0.0015);
  bar(0, r, spec.best ? inks.bestKeyline : inks.keyline, a, 0, [0, 0], 0);
  bar(-keyline, Math.max(0.004, r - keyline), spec.best ? inks.bestPaper : inks.paper, a, 0, [0, 0], 0.0004);
  // The lines of letters, each centred along the card: the chance (with the small mark of the other ways after it), then
  // (smaller, in the fire's ink) the chance to destroy. `left`: where the text starts along the card, from its middle.
  const wideOf = (text: string, height: number): number => (letter(text).width * height) / GLYPH_HEIGHT;
  const write = (text: string, height: number, top: number, ink: Rgb, left = -wideOf(text, height) / 2): void => {
    const t = letter(text);
    const k = height / GLYPH_HEIGHT;
    const ox = c[0] + rx * left + dx * top;
    const oy = c[1] + ry * left + dy * top;
    const at = (p: readonly [number, number]): [number, number] => [ox + rx * p[0] * k + dx * p[1] * k, oy + ry * p[0] * k + dy * p[1] * k];
    const half = (height * CHANCE.weight) / 2;
    for (const s of t.strokes) {
      for (let i = 1; i < s.length; i++) out.add({ a: at(s[i - 1] as [number, number]), b: at(s[i] as [number, number]), z: z + 0.0008, halfWidth: half, ink, alpha: a });
    }
  };
  const top = -h / 2 + CHANCE.pad[1];
  const mark = chanceMark(spec);
  // Where every effect destroys, the one figure is printed in the destroy's ink.
  const ink = allDestroy(spec) ? inks.kill : inks.ink;
  if (mark === '') {
    write(spec.chance, CHANCE.letter, top, ink);
  } else {
    const first = wideOf(spec.chance, CHANCE.letter) + CHANCE.markGap + wideOf(mark, CHANCE.killLetter);
    write(spec.chance, CHANCE.letter, top, ink, -first / 2);
    write(mark, CHANCE.killLetter, top + CHANCE.letter - CHANCE.killLetter, inks.ink, -first / 2 + wideOf(spec.chance, CHANCE.letter) + CHANCE.markGap);
  }
  const kill = killLine(spec);
  if (kill !== '') write(kill, CHANCE.killLetter, top + CHANCE.letter + CHANCE.lineGap, inks.kill);
}
