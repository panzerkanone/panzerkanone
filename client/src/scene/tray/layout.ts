/**
 * The counter tray: a wooden tray that stands on the table beside the boards,
 * with eight wells for lost counters and one felt-lined well for dice. Its
 * shape is made in Blender (tools/tray/build_tray.py) and its numbers come
 * with it (assets/table/tray/tray.layout.json); this file reads those numbers
 * and works out everything else from them: where the tray stands, where a
 * counter lies in a well, in which order the wells fill, the boxes its floor
 * and walls are to the physics, and where a ray meets it. Plain arithmetic, no
 * browser.
 *
 * The tray's own frame: x along its length, y across it, z up from its
 * underside, the origin at the middle of its footprint. On the table it is
 * turned about the vertical and stands on the table top.
 */

/** x0, y0, x1, y1 in h. */
export type Rect = readonly [x0: number, y0: number, x1: number, y1: number];
type Vec3 = [number, number, number];

export interface TrayWell {
  id: number;
  /** Its place in the grid: columns run along the tray from its -x end, rows across it. */
  column: number;
  row: number;
  /** Its opening, in the tray's frame. */
  rect: Rect;
  /** The height of its floor above the tray's underside. */
  floor: number;
}

export interface TrayLayout {
  /** Length (x), depth (y), height (z). */
  size: readonly [number, number, number];
  cornerRadius: number;
  /** The height of the rim above the underside. */
  rim: number;
  /** The wells for counters, by id. */
  wells: readonly TrayWell[];
  columns: number;
  rows: number;
  /** The felt-lined well at the +x end: its opening, the height of the felt, the pad's thickness. */
  felt: { rect: Rect; floor: number; pad: number };
  /** The counter the wells were sized for, and how many are stacked in one. */
  counter: { side: number; thickness: number; stack: number };
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Read the layout the tray's script wrote. Strict: a number that is missing or not a number is an error, never a default. */
export function parseTrayLayout(source: unknown): TrayLayout {
  const root: unknown = typeof source === 'string' ? JSON.parse(source) : source;
  if (!isRec(root) || root.format !== 'tray-layout/1') throw new Error('tray layout: format must be tray-layout/1');
  const num = (v: unknown, where: string): number => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`tray layout: ${where} must be a number`);
    return v;
  };
  const whole = (v: unknown, where: string): number => {
    const n = num(v, where);
    if (!Number.isInteger(n) || n < 0) throw new Error(`tray layout: ${where} must be a whole number`);
    return n;
  };
  const rect = (v: unknown, where: string): Rect => {
    if (!Array.isArray(v) || v.length !== 4) throw new Error(`tray layout: ${where} must be x0, y0, x1, y1`);
    const r: Rect = [num(v[0], where), num(v[1], where), num(v[2], where), num(v[3], where)];
    if (!(r[2] > r[0] && r[3] > r[1])) throw new Error(`tray layout: ${where} is not a rectangle`);
    return r;
  };
  if (!Array.isArray(root.size) || root.size.length !== 3) throw new Error('tray layout: size must be length, depth, height');
  const size: [number, number, number] = [num(root.size[0], 'size'), num(root.size[1], 'size'), num(root.size[2], 'size')];
  if (!Array.isArray(root.wells) || root.wells.length === 0) throw new Error('tray layout: wells must be a list');
  const wells: TrayWell[] = root.wells.map((w: unknown, k: number) => {
    if (!isRec(w)) throw new Error(`tray layout: well ${k} must be a mapping`);
    return { id: whole(w.id, `well ${k}.id`), column: whole(w.column, `well ${k}.column`), row: whole(w.row, `well ${k}.row`), rect: rect(w.rect, `well ${k}.rect`), floor: num(w.floor, `well ${k}.floor`) };
  });
  wells.forEach((w, k) => {
    if (w.id !== k) throw new Error(`tray layout: well ${k} has the id ${w.id}; the wells must be listed by id`);
  });
  if (!isRec(root.felt)) throw new Error('tray layout: felt must be a mapping');
  if (!isRec(root.counter)) throw new Error('tray layout: counter must be a mapping');
  const layout: TrayLayout = {
    size,
    cornerRadius: num(root.cornerRadius, 'cornerRadius'),
    rim: num(root.rim, 'rim'),
    wells,
    columns: whole(root.columns, 'columns'),
    rows: whole(root.rows, 'rows'),
    felt: { rect: rect(root.felt.rect, 'felt.rect'), floor: num(root.felt.floor, 'felt.floor'), pad: num(root.felt.pad, 'felt.pad') },
    counter: { side: num(root.counter.side, 'counter.side'), thickness: num(root.counter.thickness, 'counter.thickness'), stack: whole(root.counter.stack, 'counter.stack') },
  };
  if (layout.columns * layout.rows !== wells.length) throw new Error('tray layout: columns times rows is not the number of wells');
  return layout;
}

// ---- where it stands ---------------------------------------------------------------------------

/** The dials of where the tray is put down. */
export const TRAY_PLACE = {
  /** Clear table between the boards' right-hand edge and the tray's nearest point. */
  gap: 0.55,
  /** How far its near end stands back from the line of the boards' near edge. */
  nearInset: 0.9,
  /** Its length runs up the table (a quarter turn), a few degrees off square: a thing put down by hand. */
  turnDeg: 93,
} as const;

/** The tray where it stands: the middle of its footprint on the plan, the height of the table under it, its turn. */
export interface PlacedTray {
  layout: TrayLayout;
  centre: readonly [number, number];
  /** The table top: the tray's underside. */
  z: number;
  /** The turn of its own x axis from the board frame's, in radians, and that angle's cosine and sine. */
  yaw: number;
  cos: number;
  sin: number;
  /** The height of its rim in the board frame. */
  rimZ: number;
}

/** A tray put down at a place. */
export function trayAt(layout: TrayLayout, centre: readonly [number, number], z: number, yaw: number): PlacedTray {
  return { layout, centre: [centre[0], centre[1]], z, yaw, cos: Math.cos(yaw), sin: Math.sin(yaw), rimZ: z + layout.rim };
}

/**
 * Where the tray stands by the boards: off their right-hand end, toward the near edge, its felt
 * well nearest the player. `outline` is the rectangle that holds the boards.
 */
export function placeTray(layout: TrayLayout, boards: { outline: Rect; table: { z: number } }): PlacedTray {
  const yaw = (TRAY_PLACE.turnDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  // Half its reach on the plan as it is turned.
  const ex = (c * layout.size[0] + s * layout.size[1]) / 2;
  const ey = (s * layout.size[0] + c * layout.size[1]) / 2;
  return trayAt(layout, [boards.outline[2] + TRAY_PLACE.gap + ex, boards.outline[3] - TRAY_PLACE.nearInset - ey], boards.table.z, yaw);
}

/** A point of the tray's frame, in the board frame. */
export function trayToBoard(t: PlacedTray, x: number, y: number, z = 0): Vec3 {
  return [t.centre[0] + t.cos * x - t.sin * y, t.centre[1] + t.sin * x + t.cos * y, t.z + z];
}

/** A point of the plan, in the tray's frame. */
export function boardToTray(t: PlacedTray, x: number, y: number): [number, number] {
  const dx = x - t.centre[0];
  const dy = y - t.centre[1];
  return [t.cos * dx + t.sin * dy, t.cos * dy - t.sin * dx];
}

/** The four corners of its footprint on the plan. */
export function trayCorners(t: PlacedTray): [number, number][] {
  const hx = t.layout.size[0] / 2;
  const hy = t.layout.size[1] / 2;
  return ([[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]] as const).map(([x, y]) => {
    const p = trayToBoard(t, x, y);
    return [p[0], p[1]] as [number, number];
  });
}

/** Whether a point of the plan is over the tray's footprint, grown by a margin. */
export function overTray(t: PlacedTray, x: number, y: number, margin = 0): boolean {
  const [lx, ly] = boardToTray(t, x, y);
  return Math.abs(lx) <= t.layout.size[0] / 2 + margin && Math.abs(ly) <= t.layout.size[1] / 2 + margin;
}

/** The wells as the shaders and the shadows count them: the counter wells by id, then the felt well. */
export function trayOpenings(layout: TrayLayout): { rect: Rect; floor: number }[] {
  return [...layout.wells.map(w => ({ rect: w.rect, floor: w.floor })), { rect: layout.felt.rect, floor: layout.felt.floor }];
}

/**
 * The opening a point of the plan is in or nearest to, as `trayOpenings` numbers them (each
 * opening grown by `grow`, so that the walls between two are shared out); -1 off the tray.
 */
export function openingAt(t: PlacedTray, x: number, y: number, grow = 0): number {
  const [lx, ly] = boardToTray(t, x, y);
  const all = trayOpenings(t.layout);
  for (let k = 0; k < all.length; k++) {
    const r = (all[k] as { rect: Rect }).rect;
    if (lx >= r[0] - grow && lx <= r[2] + grow && ly >= r[1] - grow && ly <= r[3] + grow) return k;
  }
  return -1;
}

// ---- a counter's place in a well ---------------------------------------------------------------

/**
 * Where a counter lies in a well: the middle of the well, `level` counters up from its floor,
 * squared to the tray and reading upright from the near side of the table (the nearest quarter
 * turn to the tray's own).
 */
export function slotPose(t: PlacedTray, well: number, level: number): { p: Vec3; yaw: number } {
  const w = t.layout.wells[well];
  if (!w) throw new Error(`the tray has no well ${well}`);
  const p = trayToBoard(t, (w.rect[0] + w.rect[2]) / 2, (w.rect[1] + w.rect[3]) / 2, w.floor + t.layout.counter.thickness * (level + 0.5));
  const quarter = Math.PI / 2;
  return { p, yaw: t.yaw - Math.round(t.yaw / quarter) * quarter };
}

/**
 * The order in which a side's losses take the wells: column by column from one end of the tray
 * (0: the -x end, away from the felt well; 1: the end by the felt well), across each column's rows.
 */
export function fillOrder(layout: TrayLayout, end: 0 | 1): number[] {
  const order = [...layout.wells].sort((a, b) => (end === 0 ? a.column - b.column : b.column - a.column) || a.row - b.row);
  return order.map(w => w.id);
}

/**
 * Which well a lost counter goes to. The first side of a set-up fills from the far end, the second
 * from the end by the felt well (a third from the far end again, and so on). A well belongs to the
 * side that first put a counter in it and takes `counter.stack` of them; a side goes on to the next
 * free well in its order, past the middle if the other side has left it room. When every well is
 * taken and a side's own are full, its losses are piled a layer higher on its own wells (or, if it
 * has none, on the lowest pile there is), in the same order: the tray never refuses a counter.
 */
export class TrayFill {
  private sides: string[] = [];
  private owner: (string | null)[];
  private count: number[];

  constructor(private readonly layout: TrayLayout) {
    this.owner = layout.wells.map(() => null);
    this.count = layout.wells.map(() => 0);
  }

  /** Empty the tray; `sides` are the sides of the set-up, in the order it names them. */
  reset(sides: readonly string[]): void {
    this.sides = [...new Set(sides)];
    this.owner = this.layout.wells.map(() => null);
    this.count = this.layout.wells.map(() => 0);
  }

  /** The end a side fills from. */
  endOf(side: string): 0 | 1 {
    let k = this.sides.indexOf(side);
    if (k < 0) k = this.sides.push(side) - 1;
    return k - 2 * Math.floor(k / 2) === 0 ? 0 : 1;
  }

  /** The place the next lost counter of a side takes: a well, and how many lie under it. */
  take(side: string): { well: number; level: number } {
    const order = fillOrder(this.layout, this.endOf(side));
    const stack = this.layout.counter.stack;
    let well = order.find(w => this.owner[w] === side && (this.count[w] as number) < stack);
    if (well === undefined) well = order.find(w => this.owner[w] === null);
    if (well === undefined) {
      // Full: a layer higher, on its own wells where it has some.
      const own = order.filter(w => this.owner[w] === side);
      const among = own.length > 0 ? own : order;
      const least = Math.min(...among.map(w => this.count[w] as number));
      well = among.find(w => this.count[w] === least) as number;
    }
    if (this.owner[well] === null) this.owner[well] = side;
    const level = this.count[well] as number;
    this.count[well] = level + 1;
    return { well, level };
  }

  /** How many counters each well holds, by id, and whose it is. */
  held(): { count: number; side: string | null }[] {
    return this.count.map((count, w) => ({ count, side: this.owner[w] ?? null }));
  }
}

// ---- what it is to the physics, and to a ray -----------------------------------------------------

/** A box of the tray, in its own frame: its middle and half its size along x, y, z. */
export interface TrayBox {
  centre: Vec3;
  half: Vec3;
  part: 'floor' | 'felt' | 'wall';
}

/**
 * The tray as boxes: its floor, the felt pad, the four outer walls and the dividers between the
 * openings. Built from the openings' rectangles alone: whatever of the footprint is not an opening
 * is wall, from the floor to the rim.
 */
export function trayBoxes(layout: TrayLayout): TrayBox[] {
  const [L, D] = layout.size;
  const floor = Math.min(...layout.wells.map(w => w.floor));
  const boxes: TrayBox[] = [{ centre: [0, 0, floor / 2], half: [L / 2, D / 2, floor / 2], part: 'floor' }];
  const f = layout.felt;
  if (f.floor > floor) boxes.push({ centre: [(f.rect[0] + f.rect[2]) / 2, (f.rect[1] + f.rect[3]) / 2, (floor + f.floor) / 2], half: [(f.rect[2] - f.rect[0]) / 2, (f.rect[3] - f.rect[1]) / 2, (f.floor - floor) / 2], part: 'felt' });
  const cz = (floor + layout.rim) / 2;
  const hz = (layout.rim - floor) / 2;
  const wall = (x0: number, y0: number, x1: number, y1: number): void => {
    if (x1 - x0 > 1e-9 && y1 - y0 > 1e-9) boxes.push({ centre: [(x0 + x1) / 2, (y0 + y1) / 2, cz], half: [(x1 - x0) / 2, (y1 - y0) / 2, hz], part: 'wall' });
  };
  // Cut the footprint by every opening's edges, and keep each cell that lies in no opening; cells
  // in a row that touch are one box.
  const openings = trayOpenings(layout).map(o => o.rect);
  const cuts = (lo: number, hi: number, a: 0 | 1): number[] => {
    const all = [lo, hi, ...openings.flatMap(r => [r[a], r[a + 2] as number])].sort((p, q) => p - q);
    return all.filter((v, k) => k === 0 || v - (all[k - 1] as number) > 1e-9);
  };
  const xs = cuts(-L / 2, L / 2, 0);
  const ys = cuts(-D / 2, D / 2, 1);
  const open = (x: number, y: number): boolean => openings.some(r => x > r[0] && x < r[2] && y > r[1] && y < r[3]);
  for (let j = 0; j + 1 < ys.length; j++) {
    const y0 = ys[j] as number;
    const y1 = ys[j + 1] as number;
    let from: number | null = null;
    for (let i = 0; i + 1 < xs.length; i++) {
      const x0 = xs[i] as number;
      const x1 = xs[i + 1] as number;
      const solid = !open((x0 + x1) / 2, (y0 + y1) / 2);
      if (solid && from === null) from = x0;
      if (!solid && from !== null) {
        wall(from, y0, x0, y1);
        from = null;
      }
      if (solid && i + 2 === xs.length && from !== null) wall(from, y0, x1, y1);
    }
  }
  return boxes;
}

/**
 * Where a ray of the board frame first meets the tray (its boxes): how far along the ray, the
 * point, and the way the face it met looks. Null when it misses.
 */
export function rayTray(t: PlacedTray, origin: readonly [number, number, number], dir: readonly [number, number, number], boxes: readonly TrayBox[] = trayBoxes(t.layout)): { t: number; point: Vec3; normal: Vec3 } | null {
  const [ox, oy] = boardToTray(t, origin[0], origin[1]);
  const o: Vec3 = [ox, oy, origin[2] - t.z];
  const d: Vec3 = [t.cos * dir[0] + t.sin * dir[1], t.cos * dir[1] - t.sin * dir[0], dir[2]];
  let best = Infinity;
  let axis = 0;
  let sign = 1;
  for (const b of boxes) {
    let t0 = -Infinity;
    let t1 = Infinity;
    let ax = 0;
    let sg = 1;
    let miss = false;
    for (let k = 0; k < 3; k++) {
      const ok = (o[k] as number) - (b.centre[k] as number);
      const dk = d[k] as number;
      const h = b.half[k] as number;
      if (Math.abs(dk) < 1e-12) {
        if (Math.abs(ok) > h) miss = true;
        continue;
      }
      let near = (-h - ok) / dk;
      let far = (h - ok) / dk;
      let s = -1;
      if (near > far) {
        [near, far] = [far, near];
        s = 1;
      }
      if (near > t0) {
        t0 = near;
        ax = k;
        sg = s;
      }
      if (far < t1) t1 = far;
    }
    if (miss || t0 > t1 || t0 <= 0 || t0 >= best) continue;
    best = t0;
    axis = ax;
    sign = sg;
  }
  if (!Number.isFinite(best)) return null;
  const n: Vec3 = [0, 0, 0];
  n[axis] = sign;
  return {
    t: best,
    point: [origin[0] + dir[0] * best, origin[1] + dir[1] * best, origin[2] + dir[2] * best],
    normal: [t.cos * n[0] - t.sin * n[1], t.sin * n[0] + t.cos * n[1], n[2]],
  };
}
