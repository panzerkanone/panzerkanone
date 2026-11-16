/**
 * The markers' prints, drawn in code into one atlas, as the counters' faces
 * are (faces.ts): nothing is loaded, no font is used, and nothing here is
 * copied from any game's markers. A `screen` is smoke: a pale card printed all
 * over with puffs, so that what shows of it round a stack still reads as
 * smoke. An `incoming` is a fire mission on its way: its side's own stock, a
 * broken border in that stock's band colour, a ring with four ticks, and its
 * label inside the ring. A marker's label is printed as given, in capitals,
 * broken into short lines.
 */
import * as THREE from 'three';
import { SCENE_SEED, hash01 } from '../hash';
import { STOCKS, css, write } from './faces';

type Rgb = readonly [number, number, number];

/** What a marker is printed with: one print for each different triple. */
export interface MarkerPrint {
  kind: 'screen' | 'incoming';
  label: string;
  /** The stock of the side it belongs to; null for one that is nobody's. */
  stock: 'first' | 'second' | null;
}

/** A cell of the atlas, in pixels: the marker's hexagon corner to corner. */
export const MARKER_CELL = 384;

/** The markers' own inks, sRGB 0..255. */
export const MARKER_INKS: Readonly<Record<string, Rgb>> = {
  smokeCard: [118, 120, 122],
  smokeLight: [236, 235, 229],
  smokeShade: [84, 86, 90],
  smokeInk: [52, 52, 54],
  /** A marker that is nobody's: a plain card with the first stock's inks. */
  plainCard: [214, 204, 180],
};

export function printKey(p: MarkerPrint): string {
  return [p.kind, p.stock ?? '', p.label].join('|');
}

/** A label in short lines: broken at its spaces, no line longer than `most` characters unless one word is. */
export function labelLines(label: string, most = 9): string[] {
  const lines: string[] = [];
  for (const word of label.toUpperCase().split(/\s+/).filter(w => w.length > 0)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && last.length + 1 + word.length <= most) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

function lines(g: CanvasRenderingContext2D, text: readonly string[], cx: number, cy: number, wide: number, tall: number, ink: Rgb, weight: number): void {
  if (text.length === 0) return;
  const each = Math.min(tall / (text.length * 1.38), wide * 0.22);
  const pitch = each * 1.38;
  const top = cy - (pitch * text.length) / 2 + (pitch - each) / 2;
  text.forEach((line, k) => write(g, line, cx - wide / 2, top + k * pitch, wide, each, ink, 0, weight));
}

/**
 * One print at a cell's corner. `outline` is the marker's corners as shares of
 * the cell, in order: the print keeps inside it (the card is cut to it).
 */
export function drawMarker(g: CanvasRenderingContext2D, x0: number, y0: number, print: MarkerPrint, outline: readonly (readonly [number, number])[]): void {
  const c = MARKER_CELL;
  g.save();
  g.translate(x0, y0);
  g.beginPath();
  g.rect(0, 0, c, c);
  g.clip();
  // The hexagon a share of the way in from the outline toward the middle.
  const inset = (k: number): void => {
    g.beginPath();
    outline.forEach((p, i) => {
      const x = (0.5 + (p[0] - 0.5) * k) * c;
      const y = (0.5 + (p[1] - 0.5) * k) * c;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.closePath();
  };
  if (print.kind === 'screen') {
    g.fillStyle = css(MARKER_INKS.smokeCard as Rgb);
    g.fillRect(0, 0, c, c);
    // Puffs: a ring of them along the card's edge, where they show round a stack, and a ring inside;
    // each a pale disc on a dark one a little larger and lower, the later ones over the earlier.
    const rim = 14;
    const inner = 8;
    for (let k = 0; k < rim + inner; k++) {
      const outer = k < rim;
      const a = ((outer ? k / rim : (k - rim) / inner) + 0.02 * hash01(SCENE_SEED, 'puff-a', k)) * Math.PI * 2;
      const d = c * (outer ? 0.385 + 0.03 * hash01(SCENE_SEED, 'puff-d', k) : 0.2);
      const r = c * (outer ? 0.07 + 0.028 * hash01(SCENE_SEED, 'puff-r', k) : 0.105);
      const x = c / 2 + Math.cos(a) * d;
      const y = c / 2 + Math.sin(a) * d;
      g.fillStyle = css(MARKER_INKS.smokeShade as Rgb);
      g.beginPath();
      g.arc(x + r * 0.08, y + r * 0.12, r * 1.12, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = css(MARKER_INKS.smokeLight as Rgb);
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    // Its name on a clear patch at the middle.
    g.fillStyle = css(MARKER_INKS.smokeLight as Rgb);
    g.beginPath();
    g.ellipse(c / 2, c / 2, c * 0.27, c * 0.115, 0, 0, Math.PI * 2);
    g.fill();
    lines(g, labelLines(print.label, 12), c / 2, c / 2, c * 0.44, c * 0.2, MARKER_INKS.smokeInk as Rgb, 0.17);
    g.strokeStyle = css(MARKER_INKS.smokeShade as Rgb);
    g.lineWidth = c * 0.02;
    inset(0.985);
    g.stroke();
  } else {
    const st = print.stock ? STOCKS[print.stock] : null;
    const card: Rgb = st ? st.paper : (MARKER_INKS.plainCard as Rgb);
    const band: Rgb = st ? st.band : STOCKS.first.band;
    const ink: Rgb = st ? st.ink : STOCKS.first.ink;
    g.fillStyle = css(card);
    g.fillRect(0, 0, c, c);
    // A broken border, bold: what shows of the marker round a stack is this.
    g.strokeStyle = css(band);
    g.lineWidth = c * 0.062;
    g.setLineDash([c * 0.085, c * 0.06]);
    inset(0.9);
    g.stroke();
    g.setLineDash([]);
    // The ring and its four ticks; the two that lie toward the marker's corners run out to them.
    g.lineWidth = c * 0.022;
    g.beginPath();
    g.arc(c / 2, c / 2, c * 0.285, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = c * 0.03;
    g.lineCap = 'butt';
    for (const [dx, dy, far] of [[1, 0, 0.47], [-1, 0, 0.47], [0, 1, 0.4], [0, -1, 0.4]] as const) {
      g.beginPath();
      g.moveTo(c / 2 + dx * c * 0.25, c / 2 + dy * c * 0.25);
      g.lineTo(c / 2 + dx * c * far, c / 2 + dy * c * far);
      g.stroke();
    }
    lines(g, labelLines(print.label), c / 2, c / 2, c * 0.4, c * 0.4, ink, 0.17);
  }
  g.restore();
}

export interface MarkerAtlas {
  texture: THREE.CanvasTexture;
  cols: number;
  rows: number;
  /** The cell of each print, by `printKey`. */
  cellOf: Map<string, number>;
  bytes: number;
}

/** Draw every different print once. */
export function makeMarkerAtlas(prints: readonly MarkerPrint[], outline: readonly (readonly [number, number])[], maxAnisotropy: number): MarkerAtlas {
  const cellOf = new Map<string, number>();
  const unique: MarkerPrint[] = [];
  for (const p of prints) {
    const key = printKey(p);
    if (cellOf.has(key)) continue;
    cellOf.set(key, unique.length);
    unique.push(p);
  }
  const cols = Math.max(1, Math.ceil(Math.sqrt(unique.length)));
  const rows = Math.max(1, Math.ceil(unique.length / cols));
  const canvas = document.createElement('canvas');
  canvas.width = cols * MARKER_CELL;
  canvas.height = rows * MARKER_CELL;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('no 2D canvas for the markers');
  g.fillStyle = css(MARKER_INKS.plainCard as Rgb);
  g.fillRect(0, 0, canvas.width, canvas.height);
  unique.forEach((p, k) => drawMarker(g, (k % cols) * MARKER_CELL, Math.floor(k / cols) * MARKER_CELL, p, outline));
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
