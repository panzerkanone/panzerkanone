/**
 * A flat sheet laid onto a painted paper: the transform that carries a rectangle (0,0) to (w,h) onto the four corners
 * the paper has in the picture, so that every line, stamp and tick written on the sheet lies on the paper at the paper's
 * own tilt and perspective. Plain arithmetic (no browser).
 *
 * The transform is the plane-to-plane map through four points (a homography), written as the CSS `matrix3d` of an
 * element whose `transform-origin` is its own top left corner and which stands at the stage's top left.
 */

/** A paper's four corners in the picture: top left, top right, bottom right, bottom left (stage pixels). */
export type Quad = readonly [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]];

/** The eight numbers of the map (x, y) -> ((a x + b y + c) / (g x + h y + 1), (d x + e y + f) / (g x + h y + 1)). */
export type PlaneMap = readonly [number, number, number, number, number, number, number, number];

/** Solves the n by n system `m x = v` by elimination with pivoting; throws when it has no one answer. */
function solve(m: number[][], v: number[]): number[] {
  const n = v.length;
  const a = m.map((row, i) => [...row, v[i] as number]);
  for (let col = 0; col < n; col++) {
    let best = col;
    for (let r = col + 1; r < n; r++) if (Math.abs((a[r] as number[])[col] as number) > Math.abs((a[best] as number[])[col] as number)) best = r;
    const pivot = a[best] as number[];
    if (Math.abs(pivot[col] as number) < 1e-12) throw new Error('the four corners do not make a sheet (some of them lie in one line)');
    a[best] = a[col] as number[];
    a[col] = pivot;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const row = a[r] as number[];
      const k = (row[col] as number) / (pivot[col] as number);
      if (k === 0) continue;
      for (let c = col; c <= n; c++) row[c] = (row[c] as number) - k * (pivot[c] as number);
    }
  }
  return a.map((row, i) => (row[n] as number) / (row[i] as number));
}

/** Whether the corners go round a shape with four sides that bulges inward nowhere (no corner in line with its neighbours, or inside the others). */
function isSheet(quad: Quad): boolean {
  let turn = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = quad[i] as readonly [number, number];
    const [bx, by] = quad[(i + 1) % 4] as readonly [number, number];
    const [cx, cy] = quad[(i + 2) % 4] as readonly [number, number];
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (Math.abs(cross) < 1e-9) return false;
    if (turn !== 0 && Math.sign(cross) !== turn) return false;
    turn = Math.sign(cross);
  }
  return true;
}

/** The map that carries the sheet's corners (0,0), (w,0), (w,h), (0,h) onto `quad`'s, in that order. Throws for corners that make no sheet. */
export function planeMap(w: number, h: number, quad: Quad): PlaneMap {
  if (!(w > 0) || !(h > 0) || !isSheet(quad)) throw new Error('the four corners do not make a sheet (they must go round it in order, and none may lie in line with its neighbours or inside the others)');
  const from: readonly (readonly [number, number])[] = [[0, 0], [w, 0], [w, h], [0, h]];
  const m: number[][] = [];
  const v: number[] = [];
  from.forEach(([x, y], i) => {
    const [X, Y] = quad[i] as readonly [number, number];
    m.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
    v.push(X);
    m.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
    v.push(Y);
  });
  return solve(m, v) as unknown as PlaneMap;
}

/** Where the map puts a point of the sheet. */
export function mapPoint(p: PlaneMap, x: number, y: number): [number, number] {
  const [a, b, c, d, e, f, g, h] = p;
  const k = g * x + h * y + 1;
  return [(a * x + b * y + c) / k, (d * x + e * y + f) / k];
}

/** The map as a CSS transform (for an element at the stage's top left, `transform-origin: 0 0`). */
export function sheetTransform(w: number, h: number, quad: Quad): string {
  const [a, b, c, d, e, f, g, hh] = planeMap(w, h, quad);
  const n = (x: number): string => (Math.abs(x) < 1e-12 ? '0' : String(Number(x.toPrecision(10))));
  // Column-major: the columns are the images of x, y, z and the origin.
  return `matrix3d(${n(a)}, ${n(d)}, 0, ${n(g)}, ${n(b)}, ${n(e)}, 0, ${n(hh)}, 0, 0, 1, 0, ${n(c)}, ${n(f)}, 0, 1)`;
}
