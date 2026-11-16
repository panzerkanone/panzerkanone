/**
 * Placeholder counter faces, drawn in code into one atlas: a band across the
 * top with the title, the unit's silhouette (or a plain block where none has
 * been handed in), and the unit's numbers. One side prints on a light stock
 * and the other on a dark one. They only have to be legible and to show which
 * way up a counter is; the real faces are a later job. Nothing is loaded here
 * and no font is used: the lettering is glyphs.ts, and a silhouette is a
 * picture somebody else loaded (a flat shape on a clear ground, printed here
 * in the face's own ink).
 */
import * as THREE from 'three';
import { GLYPH_HEIGHT, letter } from './glyphs';
import type { CounterFace } from './port';

type Rgb = readonly [number, number, number];

interface Stock {
  paper: Rgb;
  ink: Rgb;
  band: Rgb;
  bandInk: Rgb;
  /** The plain block, and the keyline inside the edge. */
  block: Rgb;
  line: Rgb;
}

/** The two stocks, sRGB 0..255. */
export const STOCKS: Readonly<Record<'first' | 'second', Stock>> = {
  first: { paper: [205, 178, 132], ink: [38, 32, 25], band: [139, 58, 42], bandInk: [243, 232, 208], block: [168, 139, 98], line: [176, 148, 106] },
  second: { paper: [84, 97, 106], ink: [236, 230, 212], band: [201, 162, 78], bandInk: [30, 28, 24], block: [58, 69, 77], line: [104, 117, 126] },
};

/** A cell of the atlas, in pixels, and the share of it on each side that is only stock (so that small sizes never take a neighbour's ink). */
export const FACE_CELL = 384;
export const FACE_INSET = 0.0625;

/**
 * The tab that names a counter's group (the port's `note`): a small box at the right end of the band,
 * a keyline of the band's ink round the group's one or two characters in that ink, as tall as the
 * title's letters. The band is the one place on a face with room for characters that size: under it
 * there is about a tenth of the face between the title's ink and the move number's, and a tab let
 * down there (tried: `cues-2026-11-12-tabs-hanging-beside-in-band.png`) does not read at the play
 * view. So on a counter that carries a group the title keeps to the band's left (`titleRight`), and
 * on one that does not the face is as it was. Shares of the face (its own width, edge to edge): the
 * box's right edge, top and foot (inside the band, 0.07 to 0.30); its width for one character and for
 * two; the clear band between the title's box and it; the keyline's width; the room from the box's
 * edge to the characters' strokes (along, across: the keyline, half the characters' pen and a hair,
 * so that the two never touch); their pen's weight; and how much the tab of a group that is acting
 * grows about its middle (still inside the band and clear of the title). While its group acts the shader prints the box's two inks
 * the other way round, a solid block (`uTab`, `uTabInks` in shaders.ts).
 */
export const TAB = { right: 0.955, top: 0.092, foot: 0.278, wide1: 0.19, wide2: 0.27, gap: 0.045, line: 0.012, pad: [0.0285, 0.0285], weight: 0.19, grow: 0.08 } as const;

/** The left edge of a group's tab as a share of the face; 0 for a counter with no group (no tab). */
export function tabLeft(group: string): number {
  if (group === '') return 0;
  return TAB.right - (group.length > 1 ? TAB.wide2 : TAB.wide1);
}

/** Where the title's box ends, as a share of the face: before the tab on a counter that carries a group, where it always did on one that does not. */
export function titleRight(group: string, plain = 0.93): number {
  return group === '' ? plain : Math.min(plain, tabLeft(group) - TAB.gap);
}

export const css = (c: Rgb): string => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

/** One key for each different face: what it prints, and the group on its tab. */
export function faceKey(f: CounterFace, group = ''): string {
  return [f.stock, f.title, f.kind, f.numbers.attack ?? '', f.numbers.range ?? '', f.numbers.defence ?? '', f.numbers.move ?? '', f.art ?? '', group].join('|');
}

/**
 * How a line of text is set in a box: its scale across and down (glyph units to pixels). As tall as
 * the box allows; when that is too wide, first narrower letters, down to `condense` of their width
 * (a long title keeps its height), and only then smaller ones.
 */
export function fitText(width: number, w: number, h: number, condense = 1): { sx: number; sy: number } {
  const full = h / GLYPH_HEIGHT;
  const across = w / width;
  if (across >= full) return { sx: full, sy: full };
  // Narrower letters at full height, as far as `condense` allows; beyond that, smaller ones too.
  if (across >= full * condense) return { sx: across, sy: full };
  return { sx: across, sy: Math.min(full, across / condense) };
}

/** How wide a line of text is when set at height h, before any condensing. */
function measure(text: string, h: number): number {
  return letter(text).width * (h / GLYPH_HEIGHT);
}

/** Letter a line of text into a box (see fitText). `align` is -1 left, 0 centred, 1 right. */
export function write(g: CanvasRenderingContext2D, textIn: string, x: number, y: number, w: number, h: number, colour: Rgb, align: number, weight = 0.15, condense = 1): void {
  const { strokes, width } = letter(textIn);
  if (width <= 0) return;
  const { sx, sy } = fitText(width, w, h, condense);
  const tall = sy * GLYPH_HEIGHT;
  const wide = sx * width;
  const ox = x + (align < 0 ? 0 : align > 0 ? w - wide : (w - wide) / 2);
  const oy = y + (h - tall) / 2;
  g.strokeStyle = css(colour);
  g.lineWidth = Math.max(1.5, tall * weight);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  for (const s of strokes) {
    s.forEach((p, k) => {
      if (k === 0) g.moveTo(ox + p[0] * sx, oy + p[1] * sy);
      else g.lineTo(ox + p[0] * sx, oy + p[1] * sy);
    });
  }
  g.stroke();
}

/** How far a title may be narrowed before it is made smaller: letters of seven tenths of their width still read. */
export const TITLE_CONDENSE = 0.7;

/**
 * The foot of a face, laid out from what is printed there: the attack on the left, the defence in its
 * box at the right edge, the range in its ring between them. Each is as wide as its own figures (the
 * ring opens into a long ring for two digits), and when the three would not fit they are all set
 * smaller together, so that nothing ever runs into its neighbour. Shares of the face inside its inset.
 */
export interface FootLayout {
  /** The scale all three are set at (1: full size). */
  scale: number;
  attack?: { x: number; w: number };
  ring?: { x: number; w: number };
  box?: { x: number; w: number };
}
export const FOOT = { left: 0.05, right: 0.95, top: 0.725, height: 0.19, gap: 0.045, attackCondense: 0.85, ringText: 0.56, boxText: 0.68, ringMin: 1.2, ringPad: 0.55, boxMin: 0.2, boxPad: 0.5 } as const;

export function footLayout(n: { attack?: string; range?: string; defence?: string }): FootLayout {
  const H = FOOT.height;
  // The attack's figures may be narrowed a little (FOOT.attackCondense) before anything is made smaller.
  const aW = n.attack !== undefined ? measure(n.attack, H) * FOOT.attackCondense : 0;
  const rW = n.range !== undefined ? Math.max(H * FOOT.ringMin, measure(n.range, H * FOOT.ringText) + H * FOOT.ringPad) : 0;
  const bW = n.defence !== undefined ? Math.max(FOOT.boxMin, measure(n.defence, H * FOOT.boxText) + H * FOOT.boxPad) : 0;
  const parts = [aW, rW, bW].filter(v => v > 0);
  const room = FOOT.right - FOOT.left;
  const natural = parts.reduce((a, v) => a + v, 0) + FOOT.gap * Math.max(0, parts.length - 1);
  const scale = natural > room ? room / natural : 1;
  const out: FootLayout = { scale };
  if (n.attack !== undefined) out.attack = { x: FOOT.left, w: aW * scale };
  if (n.defence !== undefined) out.box = { x: FOOT.right - bW * scale, w: bW * scale };
  if (n.range !== undefined) {
    // In the middle of the room the other two leave.
    const from = out.attack ? out.attack.x + out.attack.w + FOOT.gap * scale : FOOT.left;
    const to = out.box ? out.box.x - FOOT.gap * scale : FOOT.right;
    out.ring = { x: (from + to) / 2 - (rW * scale) / 2, w: rW * scale };
  }
  return out;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.arcTo(x + w, y, x + w, y + r, r);
  g.lineTo(x + w, y + h - r);
  g.arcTo(x + w, y + h, x + w - r, y + h, r);
  g.lineTo(x + r, y + h);
  g.arcTo(x, y + h, x, y + h - r, r);
  g.lineTo(x, y + r);
  g.arcTo(x, y, x + r, y, r);
  g.closePath();
}

/** How the plain block is proportioned for a kind: wide and low for a vehicle, squarer for men, long and thin for a gun. */
function blockShape(kind: string): [number, number] {
  if (kind === 'infantry' || kind === 'machine_gun') return [0.36, 0.3];
  if (kind === 'towed_gun' || kind === 'mortar') return [0.46, 0.17];
  if (kind === 'truck' || kind === 'wagon' || kind === 'half_track') return [0.44, 0.22];
  return [0.48, 0.27];
}

/** A unit's silhouette as handed in: any flat shape on a clear ground (its colour is not used, only where it is), and its size in its own pixels. */
export interface Silhouette {
  image: CanvasImageSource;
  width: number;
  height: number;
}

/** The silhouette a face carries, from those handed in: that of the unit type its `art` names, and of nothing else. None, and the plain block is drawn. */
export function silhouetteOf(art: ReadonlyMap<string, Silhouette>, face: CounterFace): Silhouette | undefined {
  return face.art === undefined ? undefined : art.get(face.art);
}

/** Where a silhouette goes on a face, as shares of the face inside its inset: left, top, width, height. It is fitted inside, whole, and centred. */
export const SILHOUETTE_BOX: readonly [number, number, number, number] = [0.07, 0.335, 0.55, 0.36];

/**
 * Print a silhouette in the stock's ink. No second canvas: inside a clip of the silhouette's own
 * rectangle, a block of ink is cut down to the shape ('destination-in' keeps ink only where the
 * picture is not clear), and the paper is put back behind it ('destination-over').
 */
function printSilhouette(g: CanvasRenderingContext2D, art: Silhouette, x: number, y: number, w: number, h: number, st: Stock): void {
  // Whole pixels: a clip that covers part of a pixel would leave that pixel part clear, and a faint box round the shape.
  const scale = Math.min(w / art.width, h / art.height);
  const dw = Math.max(1, Math.round(art.width * scale));
  const dh = Math.max(1, Math.round(art.height * scale));
  const dx = Math.round(x + (w - dw) / 2);
  const dy = Math.round(y + (h - dh) / 2);
  g.save();
  g.beginPath();
  g.rect(dx, dy, dw, dh);
  g.clip();
  g.fillStyle = css(st.ink);
  g.fillRect(dx, dy, dw, dh);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(art.image, dx, dy, dw, dh);
  g.globalCompositeOperation = 'destination-over';
  g.fillStyle = css(st.paper);
  g.fillRect(dx, dy, dw, dh);
  g.restore();
}

/**
 * The group's tab (see `TAB`), drawn on a face whose origin is the corner of its inset and whose side
 * is `w`: a keyline of the band's ink just inside the box, and the group's characters in that ink. It
 * lies on the band, which is already printed under it. The shader prints exactly this rectangle the
 * other way round while the group acts.
 */
function drawTab(g: CanvasRenderingContext2D, w: number, st: Stock, group: string): void {
  const left = tabLeft(group);
  if (left <= 0) return;
  const x = w * left;
  const y = w * TAB.top;
  const wide = w * (TAB.right - left);
  const tall = w * (TAB.foot - TAB.top);
  const line = w * TAB.line;
  g.strokeStyle = css(st.bandInk);
  g.lineWidth = line;
  g.strokeRect(x + line / 2, y + line / 2, wide - line, tall - line);
  const [padX, padY] = [w * TAB.pad[0], w * TAB.pad[1]];
  write(g, group, x + padX, y + padY, wide - 2 * padX, tall - 2 * padY, st.bandInk, 0, TAB.weight);
}

/**
 * One face at a cell's corner. With `art` its silhouette is printed; without, the plain block that
 * waits for one. With a `group` its tab is printed at the band's right end (`drawTab`) and the title
 * keeps to the band's left (`titleRight`); nothing else on the face moves for it, and without one the
 * face is exactly as it was before there were tabs.
 */
export function drawFace(g: CanvasRenderingContext2D, x0: number, y0: number, face: CounterFace, art?: Silhouette, group = ''): void {
  const st = STOCKS[face.stock];
  g.save();
  g.translate(x0, y0);
  g.fillStyle = css(st.paper);
  g.fillRect(0, 0, FACE_CELL, FACE_CELL);
  const p = FACE_CELL * FACE_INSET;
  const w = FACE_CELL - 2 * p;
  g.translate(p, p);

  // The band: it runs to the counter's edge, and so shows which way up the counter is.
  const bandTop = w * 0.07;
  const bandH = w * 0.23;
  g.fillStyle = css(st.band);
  g.fillRect(-p, bandTop, FACE_CELL, bandH);
  write(g, face.title, w * 0.06, bandTop + bandH * 0.2, w * (titleRight(group, 0.94) - 0.06), bandH * 0.6, st.bandInk, -1, 0.17, TITLE_CONDENSE);
  drawTab(g, w, st, group);

  if (art && art.width > 0 && art.height > 0) {
    // The unit's silhouette, in the face's own ink.
    printSilhouette(g, art, w * SILHOUETTE_BOX[0], w * SILHOUETTE_BOX[1], w * SILHOUETTE_BOX[2], w * SILHOUETTE_BOX[3], st);
  } else {
    // The plain block where a silhouette will go.
    const [bw, bh] = blockShape(face.kind);
    const bx = w * 0.08;
    const by = w * 0.5 - (w * bh) / 2;
    g.fillStyle = css(st.block);
    roundRect(g, bx, by, w * bw, w * bh, w * 0.03);
    g.fill();
  }

  // The numbers: how far it moves beside the block; along the foot its attack, its range in a ring, its defence in a box.
  const n = face.numbers;
  if (n.move !== undefined) {
    write(g, n.move, w * 0.64, w * 0.385, w * 0.28, w * 0.19, st.ink, 1);
    g.strokeStyle = css(st.ink);
    g.lineWidth = w * 0.02;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(w * 0.66, w * 0.625);
    g.lineTo(w * 0.92, w * 0.625);
    g.stroke();
  }
  const foot = footLayout(n);
  const k = foot.scale;
  const footH = w * FOOT.height * k;
  const mid = w * (FOOT.top + FOOT.height / 2);
  if (n.attack !== undefined && foot.attack) write(g, n.attack, w * foot.attack.x, mid - footH / 2, w * foot.attack.w, footH, st.ink, -1, 0.15, FOOT.attackCondense);
  if (n.range !== undefined && foot.ring) {
    // A ring for one figure; for two it opens into a long ring, as round at its ends.
    const rh = w * FOOT.height * FOOT.ringMin * k;
    g.strokeStyle = css(st.ink);
    g.lineWidth = w * 0.016;
    roundRect(g, w * foot.ring.x, mid - rh / 2, w * foot.ring.w, rh, rh / 2);
    g.stroke();
    const th = footH * FOOT.ringText;
    write(g, n.range, w * foot.ring.x, mid - th / 2, w * foot.ring.w, th, st.ink, 0, 0.17);
  }
  if (n.defence !== undefined && foot.box) {
    const bh = footH * 1.16;
    g.strokeStyle = css(st.ink);
    g.lineWidth = w * 0.016;
    roundRect(g, w * foot.box.x, mid - bh / 2, w * foot.box.w, bh, w * 0.02);
    g.stroke();
    const th = footH * FOOT.boxText;
    write(g, n.defence, w * foot.box.x, mid - th / 2, w * foot.box.w, th, st.ink, 0, 0.16);
  }

  // A hairline inside the edge.
  g.strokeStyle = css(st.line);
  g.lineWidth = w * 0.007;
  g.strokeRect(w * 0.022, w * 0.022, w * 0.956, w * 0.956);
  g.restore();
}

export interface FaceAtlas {
  texture: THREE.CanvasTexture;
  cols: number;
  rows: number;
  /** The cell of each face, by `faceKey` (of the face and its group). */
  cellOf: Map<string, number>;
  bytes: number;
}

/**
 * Draw every different face once. `art`, when given, is the silhouettes that have arrived, by unit
 * type: a face whose `art` names one of them has it printed. `groups`, when given, is each face's
 * group, in the order of `faces` ('' for none): a face is drawn once for each group it is seen with.
 */
export function makeFaceAtlas(faces: readonly CounterFace[], maxAnisotropy: number, art?: ReadonlyMap<string, Silhouette>, groups?: readonly string[]): FaceAtlas {
  const cellOf = new Map<string, number>();
  const unique: { face: CounterFace; group: string }[] = [];
  faces.forEach((f, i) => {
    const group = groups?.[i] ?? '';
    const key = faceKey(f, group);
    if (cellOf.has(key)) return;
    cellOf.set(key, unique.length);
    unique.push({ face: f, group });
  });
  const cols = Math.max(1, Math.ceil(Math.sqrt(unique.length)));
  const rows = Math.max(1, Math.ceil(unique.length / cols));
  const canvas = document.createElement('canvas');
  canvas.width = cols * FACE_CELL;
  canvas.height = rows * FACE_CELL;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('no 2D canvas for the counter faces');
  g.fillStyle = css(STOCKS.first.paper);
  g.fillRect(0, 0, canvas.width, canvas.height);
  unique.forEach((u, k) => drawFace(g, (k % cols) * FACE_CELL, Math.floor(k / cols) * FACE_CELL, u.face, art ? silhouetteOf(art, u.face) : undefined, u.group));
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return { texture, cols, rows, cellOf, bytes: Math.round(canvas.width * canvas.height * 4 * 1.34) };
}
