/**
 * The ten digits of the hex numbers and the rulers, drawn by this file: each is
 * a few strokes (lines and arcs of ellipses), and the atlas holds, for every
 * pixel of a digit's cell, the distance to the nearest stroke. The board's
 * shader turns that distance into ink of a set weight at any zoom. No font is
 * read and nothing is downloaded. Plain arithmetic, no browser.
 */
import { DIGIT_ASPECT } from './grid';

/** One digit's cell in the atlas, in pixels. */
export const DIGIT_CELL: readonly [number, number] = [36, 60];
/** Distances are stored as a byte: 255 is this far from a stroke, in digit heights. */
export const DIGIT_RANGE = 0.3;
/** Half the weight of a stroke, in digit heights. */
export const DIGIT_HALF_STROKE = 0.062;

type P = [number, number];

function arc(cx: number, cy: number, rx: number, ry: number, fromDeg: number, toDeg: number): P[] {
  const n = Math.max(2, Math.ceil(Math.abs(toDeg - fromDeg) / 9));
  const out: P[] = [];
  for (let k = 0; k <= n; k++) {
    const a = ((fromDeg + ((toDeg - fromDeg) * k) / n) * Math.PI) / 180;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}

/** Strokes of each digit in a cell DIGIT_ASPECT wide and 1 high, y up. */
function strokes(digit: number): P[][] {
  switch (digit) {
    case 0:
      return [arc(0.3, 0.5, 0.2, 0.43, 0, 360)];
    case 1:
      return [[[0.15, 0.74], [0.33, 0.93], [0.33, 0.07]]];
    case 2:
      return [[...arc(0.3, 0.7, 0.2, 0.23, 170, -35), [0.09, 0.07], [0.52, 0.07]]];
    case 3:
      return [[...arc(0.28, 0.715, 0.19, 0.215, 155, -90), ...arc(0.28, 0.285, 0.22, 0.215, 90, -155)]];
    case 4:
      return [[[0.42, 0.07], [0.42, 0.93], [0.08, 0.33], [0.53, 0.33]]];
    case 5:
      return [[[0.49, 0.93], [0.14, 0.93], [0.11, 0.53], ...arc(0.27, 0.32, 0.23, 0.25, 120, -150)]];
    case 6:
      return [arc(0.3, 0.3, 0.21, 0.23, 0, 360), [[0.45, 0.91], [0.33, 0.9], [0.21, 0.8], [0.13, 0.62], [0.09, 0.42], [0.09, 0.3]]];
    case 7:
      return [[[0.08, 0.93], [0.52, 0.93], [0.25, 0.07]]];
    case 8:
      return [arc(0.3, 0.715, 0.17, 0.215, 0, 360), arc(0.3, 0.29, 0.21, 0.22, 0, 360)];
    case 9:
      // A six turned half round.
      return strokes(6).map(s => s.map(([x, y]) => [DIGIT_ASPECT - x, 1 - y] as P));
    default:
      throw new Error(`no digit ${digit}`);
  }
}

function segmentDistance(px: number, py: number, a: P, b: P): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const len = vx * vx + vy * vy;
  const t = len > 0 ? Math.min(1, Math.max(0, ((px - a[0]) * vx + (py - a[1]) * vy) / len)) : 0;
  return Math.hypot(px - a[0] - vx * t, py - a[1] - vy * t);
}

/** Distance from a point of a digit's cell (x in 0..DIGIT_ASPECT, y in 0..1, y up) to its nearest stroke. */
export function digitDistance(digit: number, x: number, y: number): number {
  let d = Infinity;
  for (const s of strokes(digit)) {
    for (let k = 0; k + 1 < s.length; k++) d = Math.min(d, segmentDistance(x, y, s[k] as P, s[k + 1] as P));
  }
  return d;
}

/**
 * The atlas: the ten digits side by side, one byte a pixel, row 0 at the top of
 * the digits. A byte is the distance to the nearest stroke over DIGIT_RANGE,
 * capped at 255.
 */
export function digitAtlas(): { width: number; height: number; data: Uint8Array } {
  const [cw, ch] = DIGIT_CELL;
  const width = cw * 10;
  const data = new Uint8Array(width * ch);
  for (let digit = 0; digit < 10; digit++) {
    const segs: [P, P][] = [];
    for (const s of strokes(digit)) for (let k = 0; k + 1 < s.length; k++) segs.push([s[k] as P, s[k + 1] as P]);
    for (let j = 0; j < ch; j++) {
      for (let i = 0; i < cw; i++) {
        const x = ((i + 0.5) / cw) * DIGIT_ASPECT;
        const y = 1 - (j + 0.5) / ch;
        let d = Infinity;
        for (const [a, b] of segs) d = Math.min(d, segmentDistance(x, y, a, b));
        data[j * width + digit * cw + i] = Math.round(Math.min(1, d / DIGIT_RANGE) * 255);
      }
    }
  }
  return { width, height: ch, data };
}
