/**
 * Things on the table (the owner, 2026-11-14: "cans of soda, a drink coaster..., some rule cards, random
 * things that people might have on the table when playing the game... could be randomized per game"):
 * which of them a game has and where they lie, from the game's seed. Plain arithmetic, no three: the same
 * seed always sets the same table (hash01 of the seed, a tag and a stable id; nothing else is random).
 *
 * They lie off the boards, clear of the counter tray, and never on the near side in front of the boards,
 * where the low cameras look across the table: to the left of the boards, beyond their far edge, and to
 * the right beyond the tray. Sizes are real ones at 20 mm an h.
 */
import { hash01 } from '../hash';
import type { Rect } from '../layout';

export type PropKind = 'can' | 'mug' | 'coaster' | 'cards' | 'sheet' | 'pencil' | 'notepad';

/** Each kind's reach on the plan (the radius of a circle round it, h) and its height (h). */
export const PROP_SIZE: Readonly<Record<PropKind, { radius: number; height: number }>> = {
  can: { radius: 1.65, height: 6.1 },
  mug: { radius: 2.9, height: 4.75 },
  coaster: { radius: 2.5, height: 0.2 },
  cards: { radius: 2.9, height: 0.12 },
  sheet: { radius: 6.5, height: 0.35 },
  pencil: { radius: 4.5, height: 0.36 },
  notepad: { radius: 4.6, height: 0.42 },
};

/** The dials of where things are put down, in h. */
export const PROPS_PLACE = {
  /** Clear table between a thing and the boards' outline, and between a thing and the tray. */
  boardGap: 2.4,
  trayGap: 1.6,
  /** Clear table between two things that do not stand on one another. */
  apart: 0.7,
  /** The farthest a thing lies from the boards' outline. */
  reach: 13,
  /** Tries for a place before a thing is left off. */
  tries: 60,
  /** A tall thing stands no nearer than this share of the boards' depth from their far edge. */
  tallFar: 0.3,
} as const;

/** A thing on the table: its kind, a stable id (for its own hashes), its place, its turn (radians), a variant (0..1) for its colour, and what it stands on. */
export interface PlacedProp {
  id: string;
  kind: PropKind;
  x: number;
  y: number;
  yaw: number;
  variant: number;
  /** The height it stands at: 0 on the table, a coaster's height on a coaster. */
  z: number;
}

/** What the placing takes: the boards' outline, the table's rectangle, and the tray's footprint on the plan (null without a tray). */
export interface PropsGround {
  outline: Rect;
  table: Rect;
  tray: readonly (readonly [number, number])[] | null;
}

/** The distance from a point to a rectangle (0 inside). */
function rectDistance(x: number, y: number, r: Rect): number {
  const dx = Math.max(r[0] - x, 0, x - r[2]);
  const dy = Math.max(r[1] - y, 0, y - r[3]);
  return Math.hypot(dx, dy);
}

/** The distance from a point to a convex polygon given by its corners in order (0 inside). */
function polygonDistance(x: number, y: number, poly: readonly (readonly [number, number])[]): number {
  let inside = true;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as readonly [number, number];
    const b = poly[(i + 1) % poly.length] as readonly [number, number];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / (ex * ex + ey * ey)));
    best = Math.min(best, Math.hypot(x - a[0] - ex * t, y - a[1] - ey * t));
    if (ex * (y - a[1]) - ey * (x - a[0]) < 0) inside = false;
  }
  // Corners may run either way round: inside is all on one side.
  let other = true;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as readonly [number, number];
    const b = poly[(i + 1) % poly.length] as readonly [number, number];
    if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) > 0) other = false;
  }
  return inside || other ? 0 : best;
}

/** Whether a circle on the plan is clear of the boards, the tray, the near side and the table's edge, and near enough to the boards. */
export function clearSpot(x: number, y: number, radius: number, ground: PropsGround): boolean {
  const o = ground.outline;
  const t = ground.table;
  if (x - radius < t[0] || x + radius > t[2] || y - radius < t[1] || y + radius > t[3]) return false;
  const d = rectDistance(x, y, o);
  if (d < PROPS_PLACE.boardGap + radius || d > PROPS_PLACE.reach) return false;
  // Never in front of the boards: the low cameras look across the near side of the table.
  if (y + radius > o[3] - 1 && x + radius > o[0] - 3 && x - radius < o[2] + 3) return false;
  if (ground.tray && polygonDistance(x, y, ground.tray) < PROPS_PLACE.trayGap + radius) return false;
  return true;
}

/** The kinds a game has, in the order they are put down: always a drink on a coaster; the rest by the seed. */
function chosen(seed: number): { id: string; kind: PropKind; on?: string; beside?: string }[] {
  const h = (tag: string): number => hash01(seed, `props:${tag}`, 0);
  const list: { id: string; kind: PropKind; on?: string; beside?: string }[] = [];
  list.push({ id: 'coaster-1', kind: 'coaster' });
  list.push({ id: 'drink-1', kind: h('drink-1') < 0.55 ? 'can' : 'mug', on: 'coaster-1' });
  if (h('drink-2') < 0.5) list.push({ id: 'drink-2', kind: 'can' });
  if (h('cards') < 0.8) list.push({ id: 'cards', kind: 'cards' });
  if (h('sheet') < 0.55) list.push({ id: 'sheet', kind: 'sheet' });
  if (h('notepad') < 0.6) {
    list.push({ id: 'notepad', kind: 'notepad' });
    list.push({ id: 'pencil', kind: 'pencil', beside: 'notepad' });
  } else if (h('pencil') < 0.5) list.push({ id: 'pencil', kind: 'pencil' });
  return list;
}

/**
 * The things a game's table has, and where: a function of the seed and the ground alone. A thing that finds
 * no clear place in its tries is left off (a crowded table loses its last things, never puts one on the boards).
 */
export function placeProps(seed: number, ground: PropsGround): PlacedProp[] {
  const o = ground.outline;
  const placed: PlacedProp[] = [];
  const free = (x: number, y: number, r: number): boolean =>
    clearSpot(x, y, r, ground) && placed.every(p => Math.hypot(p.x - x, p.y - y) >= PROP_SIZE[p.kind].radius + r + PROPS_PLACE.apart);
  // Where a thing may go: to the left of the boards, beyond their far edge, to the right beyond the tray.
  const regions: Rect[] = [
    [o[0] - PROPS_PLACE.reach, o[1] - 6, o[0] - 2, o[3] + 2],
    [o[0] - 6, o[1] - PROPS_PLACE.reach, o[2] + 6, o[1] - 2],
    [o[2] + 2, o[1] - 6, o[2] + PROPS_PLACE.reach, o[3] - 4],
  ];
  /** Tall things stand beyond this line, in the far part of the table. */
  const tallLine = o[1] + PROPS_PLACE.tallFar * (o[3] - o[1]);
  const wants = chosen(seed);
  for (const want of wants) {
    const size = PROP_SIZE[want.kind];
    // Tall: a drink, or the coaster a drink will stand on.
    const tall = size.height > 2 || wants.some(w => w.on === want.id);
    const r = (k: number, tag: string): number => hash01(seed, `props:${want.id}:${tag}`, k);
    const variant = r(0, 'variant');
    const yaw = r(0, 'yaw') * Math.PI * 2;
    const base = want.on ? placed.find(p => p.id === want.on) : undefined;
    if (want.on) {
      // A drink stands on its coaster, a little off its middle.
      if (!base) continue;
      const a = r(0, 'off') * Math.PI * 2;
      const off = 0.25 * r(1, 'off');
      placed.push({ id: want.id, kind: want.kind, x: base.x + Math.cos(a) * off, y: base.y + Math.sin(a) * off, yaw, variant, z: PROP_SIZE.coaster.height });
      continue;
    }
    const next = want.beside ? placed.find(p => p.id === want.beside) : undefined;
    for (let k = 0; k < PROPS_PLACE.tries; k++) {
      let x: number;
      let y: number;
      let turn = yaw;
      if (next && k < PROPS_PLACE.tries / 2) {
        // A pencil lies by its notepad, along its long side, a little askew.
        const side = r(k, 'side') < 0.5 ? -1 : 1;
        const across = PROP_SIZE.notepad.radius * 0.62 + 0.6 + r(k, 'gap') * 0.8;
        x = next.x + Math.cos(next.yaw) * across * side;
        y = next.y + Math.sin(next.yaw) * across * side;
        turn = next.yaw + Math.PI / 2 + (r(k, 'skew') - 0.5) * 0.3;
        // The two are one group: the pencil may lie close to its notepad.
        if (clearSpot(x, y, size.radius, ground) && placed.every(p => p === next || Math.hypot(p.x - x, p.y - y) >= PROP_SIZE[p.kind].radius + size.radius + PROPS_PLACE.apart)) {
          placed.push({ id: want.id, kind: want.kind, x, y, yaw: turn, variant, z: 0 });
          break;
        }
        continue;
      }
      const region = regions[Math.floor(r(k, 'region') * regions.length)] as Rect;
      x = region[0] + (region[2] - region[0]) * r(k, 'x');
      y = region[1] + (region[3] - region[1]) * r(k, 'y');
      // A tall thing (a drink) stands toward the far side, behind the boards from every camera, where it hides no hex.
      if (tall && y > tallLine) continue;
      if (free(x, y, size.radius)) {
        placed.push({ id: want.id, kind: want.kind, x, y, yaw: turn, variant, z: 0 });
        break;
      }
    }
  }
  return placed;
}
