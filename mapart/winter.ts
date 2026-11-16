/**
 * What a winter board draws on top of the summer art. The owner, 2026-11-14: "Basically modifying the
 * color balance of our existing art, adding in snow pillows and ice on top." So a winter board is the
 * summer board, shape for shape, printed from the winter ink table (summer's inks with one colour
 * transform: seasonInks.ts), and over it the snow and the ice.
 *
 * A snow pillow is a way of shading a shape, not an object (the owner, the same day, of the lumps the
 * second round drew: "there are blobular objects on hilltops. This was only meant to indicate that there
 * are geometric objects (squares, circles for trees, geometric shapes for empty ground) that have a slight
 * highlight on one side and a suggested thin shadow on the other that represent accumulated snow of around
 * 12-15 inches. They also can represent areas of ice. They can be slightly lighter than the surrounding
 * areas"). So snow lying on a thing is a flat shape, a little lighter than what it lies on, with a slight
 * highlight along its sides toward the light and a thin shadow along the others (`litSides`): about a foot
 * of snow, and no mound.
 *
 * What a winter board draws:
 *
 *   - on trees and roofs, as the second round drew them and the owner kept them: a cap on many tree
 *     crowns, snow on every roof with the half across its ridge in shade;
 *   - on the hills, the speckled, icy snow of his example (his words of its hill: "the speckled icy snow
 *     and reddish brown slopes ... is very good"): snow showing through the haze of the slopes in soft
 *     clouds, and flecks of frost on it, thickest by the crest and thinning outward; on the hilltops,
 *     inside their crests, a faint icy tint mottled with soft darker and whiter clouds, fine streaks and
 *     flecks. All of it flat, seeded, and no lump;
 *   - ice on the water: a lake frozen whole and a sea along its shore (its open water left as summer
 *     draws it), with a rim of snow inside the shore, the ice's edge and fine cracks; a river's water
 *     frozen, with chunks of ice on it: flat stamped shapes a little lighter than the ice round them, and
 *     no highlight or shadow, for they float level with it.
 *
 * And what it can draw, each switched off in the winter set until the owner asks for it:
 *
 *   - the pillow manner on the roofs, a few flat pieces of banked snow on open ground, snow on the stones
 *     of rough ground, faint clouds on the plain's snow (trials of the third round);
 *   - the second round's own snow pillows, mounds in rows of rounded lumps with a thrown shadow, and its
 *     dashes of snow on the rivers' ice: what the third round replaced, kept whole (the last part of this
 *     file), by the owner's standing rule that worthy work is retained.
 *
 * Every colour is a plate of the winter ink table at a tone, and every dial is the winter set's
 * (mapart/data/params-winter.yaml, `winter`): no colour and no tone is a number here.
 *
 * Pure and deterministic: every random choice is a hash of (map seed, tag, stable id), where a stable id
 * is a hex number, a lattice cell or a place on the board (its coordinates in thousandths of h), so
 * nothing depends on the order hexes are visited in or things are listed in.
 */
import { HexId, centreOf, worldBounds } from '../engine/core/hex';
import { nearestHex, regionRing } from './board';
import type { MapContext } from './context';
import { ROAD, RIVER, type CentreLines } from './curves';
import { SegmentIndex, boundsOf, inRings } from './geom';
import type { HillLineSet } from './hills';
import type { FleckScatter, SoftPatches, WinterDraw } from './params';
import { between, cellHasher, signedUnit, unit } from './random';
import type { Building } from './towns';
import type { Box, Canopy } from './woods';

/** A place on the board as a whole number id: its coordinates in thousandths of h. */
const at = (v: number): number => Math.round(v * 1000);

// ---------------------------------------------------------------------------
// Caps on trees (as the second round drew them)
// ---------------------------------------------------------------------------

const CIRCLE = 28;
/** How many crescents are made, one for each direction of the light in a cap's own frame. */
export const LUNES = 16;

/** A cap of snow (or a lump of a mound), 1 across: a circle, stamped with its length and width as the scales. */
export function capShape(): number[] {
  const ring: number[] = [];
  for (let k = 0; k < CIRCLE; k++) {
    const a = (k / CIRCLE) * Math.PI * 2;
    ring.push(0.5 * Math.cos(a), 0.5 * Math.sin(a));
  }
  return ring;
}

/**
 * The shaded lower side of a cap, in the cap's own frame (1 across): the circle less the same circle
 * moved `lune` (a share of its width) toward direction k of LUNES, the light. What is left is a crescent
 * on the side away from the light, `lune` thick at its middle, wholly inside the cap.
 */
export function luneShape(lune: number, k: number): number[] {
  const r = 0.5;
  const phi = (k / LUNES) * Math.PI * 2;
  const ux = Math.cos(phi);
  const uy = Math.sin(phi);
  const vx = -uy;
  const vy = ux;
  // The two circles cross where cos(theta) = lune / (2 r), seen from the first.
  const alpha = Math.acos(lune / (2 * r));
  const ring: number[] = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const t = alpha + ((2 * Math.PI - 2 * alpha) * i) / steps;
    ring.push(r * Math.cos(t) * ux + r * Math.sin(t) * vx, r * Math.cos(t) * uy + r * Math.sin(t) * vy);
  }
  for (let i = 1; i < steps; i++) {
    const t = Math.PI + alpha - (2 * alpha * i) / steps;
    ring.push(lune * ux + r * Math.cos(t) * ux + r * Math.sin(t) * vx, lune * uy + r * Math.cos(t) * uy + r * Math.sin(t) * vy);
  }
  return ring;
}

/** Which crescent a placement takes: the direction of the light in its own frame (turned back, its scales undone). */
export function luneIndex(rot: number, sx: number, sy: number, light: readonly [number, number]): number {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const lx = (light[0] * c + light[1] * s) / sx;
  const ly = (-light[0] * s + light[1] * c) / sy;
  const k = Math.round((Math.atan2(ly, lx) / (Math.PI * 2)) * LUNES);
  return ((k % LUNES) + LUNES) % LUNES;
}

/** The caps of snow on a group of trees: a share of them, each a cap on the lit side of its crown. */
export function capPlacements(seed: number, trees: readonly Canopy[], C: WinterDraw['caps'], light: readonly [number, number]): number[] {
  const out: number[] = [];
  for (const t of trees) {
    if (unit(seed, 'snow-cap', at(t.x), at(t.y)) >= C.share) continue;
    const size = t.size * C.scale * (1 + 0.15 * signedUnit(seed, 'snow-cap-size', at(t.x), at(t.y)));
    out.push(t.x + light[0] * C.shift * t.size, t.y + light[1] * C.shift * t.size, t.rot, size * t.sx, size * t.sy);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Snow on roofs
// ---------------------------------------------------------------------------

/** Snow on a roof, 1 by 1: a rounded square (a superellipse of power 4), stamped with the roof's length and width. */
export function roofSnowShape(): number[] {
  const ring: number[] = [];
  const k = 32;
  for (let i = 0; i < k; i++) {
    const t = (i / k) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    ring.push(0.5 * Math.sign(c) * Math.abs(c) ** 0.5, 0.5 * Math.sign(s) * Math.abs(s) ** 0.5);
  }
  return ring;
}

/** The half of the roof's snow on the +y side of its ridge (which runs along x). */
export function roofSnowHalfShape(): number[] {
  const ring: number[] = [];
  const k = 16;
  for (let i = 0; i <= k; i++) {
    const t = (i / k) * Math.PI;
    const c = Math.cos(t);
    const s = Math.sin(t);
    ring.push(0.5 * Math.sign(c) * Math.abs(c) ** 0.5, 0.5 * s ** 0.5);
  }
  return ring;
}

/** The roof's square, 1 by 1: what the snow lies on in the pillow manner, stamped with the roof's length and width. */
export function roofSquareShape(): number[] {
  return [-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5];
}

/** The snow on a roof, as a placement of the roof's shape: its middle, the turn of its ridge (its longer axis), its length and width less the inset. */
export function roofPlacement(bd: Building, inset: number): number[] {
  const wide = bd.halfLen >= bd.halfDepth;
  const rot = wide ? bd.angle : bd.angle + Math.PI / 2;
  const long = 2 * Math.max(bd.halfLen, bd.halfDepth) - 2 * inset;
  const short = 2 * Math.min(bd.halfLen, bd.halfDepth) - 2 * inset;
  return [bd.cx, bd.cy, rot, Math.max(0.001, long), Math.max(0.001, short)];
}

/** The half of a roof's snow that faces away from the light: the same placement, turned so that its +y half is that one. */
export function roofShadePlacement(bd: Building, inset: number, light: readonly [number, number]): number[] {
  const p = roofPlacement(bd, inset);
  const rot = p[2] as number;
  const ny = Math.cos(rot) * light[1] - Math.sin(rot) * light[0];
  // The +y side of the ridge is (-sin, cos); turned half round when that side faces the light.
  return ny < 0 ? p : [p[0] as number, p[1] as number, rot + Math.PI, p[3] as number, p[4] as number];
}

// ---------------------------------------------------------------------------
// The pillow manner: the sides of a flat shape toward the light and away from it
// ---------------------------------------------------------------------------

/** A stamp shape's outline as it lies on the board: scaled in its own axes, then turned, then moved (as the bake places a stamp). */
export function placedRing(shape: readonly number[], x: number, y: number, rot: number, sx: number, sy: number): number[] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const out: number[] = [];
  for (let i = 0; i + 1 < shape.length; i += 2) {
    const u = (shape[i] as number) * sx;
    const v = (shape[i + 1] as number) * sy;
    out.push(x + c * u - s * v, y + s * u + c * v);
  }
  return out;
}

/**
 * The sides of an outline that face the light and those that face away from it, each run of such sides as
 * one line along the outline. A side faces the light when its outward normal and the light's direction
 * have a dot product over `least` (0 would take every side turned toward the light at all), and away from
 * it when under -`least`: the sides between take neither, so that a highlight and a shadow never meet.
 */
export function litSides(ring: readonly number[], light: readonly [number, number], least: number): { lit: number[][]; shaded: number[][] } {
  const n = ring.length / 2;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = i + 1 < n ? i + 1 : 0;
    area += (ring[2 * i] as number) * (ring[2 * j + 1] as number) - (ring[2 * j] as number) * (ring[2 * i + 1] as number);
  }
  const turn = area >= 0 ? 1 : -1;
  // Each side's facing: 1 toward the light, -1 away from it, 0 neither.
  const facing: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = i + 1 < n ? i + 1 : 0;
    const dx = (ring[2 * j] as number) - (ring[2 * i] as number);
    const dy = (ring[2 * j + 1] as number) - (ring[2 * i + 1] as number);
    const l = Math.hypot(dx, dy);
    const d = l === 0 ? 0 : (turn * (dy * light[0] - dx * light[1])) / l;
    facing.push(d > least ? 1 : d < -least ? -1 : 0);
  }
  const runs = (want: number): number[][] => {
    const out: number[][] = [];
    // Begin after a side that is not wanted, so that no run is cut in two by where the outline begins.
    const start = facing.findIndex(f => f !== want);
    if (start < 0) return out;
    let line: number[] | null = null;
    for (let k = 1; k <= n; k++) {
      const i = start + k < n ? start + k : start + k - n;
      if (facing[i] === want) {
        if (!line) line = [ring[2 * i] as number, ring[2 * i + 1] as number];
        const j = i + 1 < n ? i + 1 : 0;
        line.push(ring[2 * j] as number, ring[2 * j + 1] as number);
      } else if (line) {
        out.push(line);
        line = null;
      }
    }
    return out;
  };
  return { lit: runs(1), shaded: runs(-1) };
}

// ---------------------------------------------------------------------------
// The stamp shapes of a piece of ice or of lying snow
// ---------------------------------------------------------------------------

/** A piece as it is stamped: which shape of the set, and its placement (its middle, its turn, its scale across and down). */
export interface Piece {
  shape: number;
  x: number;
  y: number;
  rot: number;
  sx: number;
  sy: number;
}

/**
 * The set of stamp shapes a chunk of ice or a piece of lying snow is cut from: flat outlines, four angular and
 * two rounded, each drawn about its own middle and sized so that its furthest corner is 0.5 from it (a piece
 * stamped at scale s lies inside a circle s across). They are the art's own, drawn for this set.
 */
export function pieceShapes(): number[][] {
  const drawn: number[][] = [
    // A five-sided floe.
    [-0.42, -0.18, 0.05, -0.46, 0.47, -0.12, 0.3, 0.38, -0.28, 0.36],
    // A slab with four sides, none square to another.
    [-0.45, -0.22, 0.38, -0.32, 0.46, 0.2, -0.36, 0.3],
    // A long shard.
    [-0.49, 0, -0.2, -0.26, 0.28, -0.22, 0.49, 0.06, 0.18, 0.27, -0.26, 0.22],
    // A wedge with its corners broken off.
    [-0.06, -0.45, 0.08, -0.44, 0.45, 0.22, 0.36, 0.33, -0.36, 0.34, -0.44, 0.24],
  ];
  // A worn, rounded piece: twelve points round its middle, no two at the same distance from it.
  const worn = [0.5, 0.47, 0.4, 0.36, 0.4, 0.46, 0.5, 0.46, 0.38, 0.34, 0.39, 0.47];
  drawn.push(worn.flatMap((r, k) => [r * Math.cos((k / worn.length) * Math.PI * 2), r * Math.sin((k / worn.length) * Math.PI * 2)]));
  // A rounded square.
  const square: number[] = [];
  for (let k = 0; k < 16; k++) {
    const t = (k / 16) * Math.PI * 2;
    square.push(Math.sign(Math.cos(t)) * Math.abs(Math.cos(t)) ** 0.5, Math.sign(Math.sin(t)) * Math.abs(Math.sin(t)) ** 0.5);
  }
  drawn.push(square);
  return drawn.map(ring => {
    let reach = 0;
    for (let i = 0; i < ring.length; i += 2) reach = Math.max(reach, Math.hypot(ring[i] as number, ring[i + 1] as number));
    return ring.map(v => (v * 0.5) / reach);
  });
}

/** The name a shape of the set has in a display list. */
export const pieceShapeKey = (shape: number): string => `ice-piece-${shape}`;

/** The shape of the set a fleck of frost is stamped from: the worn, rounded piece (`pieceShapes`' fifth). */
export const FLECK_SHAPE = 4;

/** A piece's outline as it lies on the board. */
export function pieceRing(shapes: readonly (readonly number[])[], p: Piece): number[] {
  return placedRing(shapes[p.shape] as readonly number[], p.x, p.y, p.rot, p.sx, p.sy);
}

// ---------------------------------------------------------------------------
// Chunks of ice on a river
// ---------------------------------------------------------------------------

/**
 * The chunks of ice on a river (the owner, 2026-11-14: "Some stampable chunks of ice in the cold probably
 * frozen waters", and later: "a slightly highlighted geometric shape indicating a chunk of ice. Since it is
 * floating it would not have highlight/shadow relief"). Walking the river's line from its first point: a
 * chunk, a reach of clear ice, a chunk, and so on. Each chunk is one of the set's shapes, mirrored or not:
 * across the river `sizeMin` to `sizeMax` of the room the water has there (its width less `edge` on each
 * side), along it up to `stretch` longer than that, turned from the river's own direction by up to `turn`
 * degrees either way, made smaller where its turn would take a corner off the water, and set off to one
 * side of the line as far as it then has room: so every corner of it lies on the water. The reaches of
 * clear ice are drawn between `gapMin` and `gapMax`, most of them short, so that chunks gather in places
 * and leave the river bare in others. Where the water is too narrow for a chunk `least` across (near a
 * spring) there is none.
 *
 * `halfWidths` is the half-width of the river's water at each point of `line`. Seeded by the river's first
 * point and the chunk's number along it.
 */
export function riverFloes(seed: number, line: readonly number[], halfWidths: readonly number[], F: WinterDraw['ice']['floes'], shapes: number): Piece[] {
  const m = line.length / 2;
  const along = new Array<number>(m).fill(0);
  for (let k = 1; k < m; k++) {
    along[k] = (along[k - 1] as number) + Math.hypot((line[2 * k] as number) - (line[2 * k - 2] as number), (line[2 * k + 1] as number) - (line[2 * k - 1] as number));
  }
  const total = along[m - 1] as number;
  const id = [at(line[0] as number), at(line[1] as number)];
  const out: Piece[] = [];
  /**
   * Chunk k where the water has `room` either side of the line: its length along its own axis, its width across
   * it, its turn from the river's direction, and how far it then reaches across the river and along it (the
   * reach of the ellipse every shape of the set lies in).
   */
  const chunk = (k: number, room: number): { long: number; wide: number; turn: number; across: number; along: number } => {
    let wide = between(F.sizeMin, F.sizeMax, seed, 'river-floe-size', ...id, k) * 2 * room;
    let long = wide * (1 + F.stretch * unit(seed, 'river-floe-stretch', ...id, k));
    const turn = ((F.turn * Math.PI) / 180) * signedUnit(seed, 'river-floe-turn', ...id, k);
    const reach = (a: number, b: number): number => Math.hypot((long / 2) * a, (wide / 2) * b);
    const over = reach(Math.sin(turn), Math.cos(turn)) / room;
    if (over > 1) {
      wide /= over;
      long /= over;
    }
    return { long, wide, turn, across: reach(Math.sin(turn), Math.cos(turn)), along: reach(Math.cos(turn), Math.sin(turn)) };
  };
  let seg = 0;
  let s = F.gapMax * unit(seed, 'river-floe-start', ...id);
  for (let k = 0; s < total; k++) {
    while (seg + 2 < m && (along[seg + 1] as number) < s) seg++;
    const l = (along[seg + 1] as number) - (along[seg] as number);
    const t = l > 0 ? (s - (along[seg] as number)) / l : 0;
    const dx = (line[2 * seg + 2] as number) - (line[2 * seg] as number);
    const dy = (line[2 * seg + 3] as number) - (line[2 * seg + 1] as number);
    const room = (halfWidths[seg] as number) + ((halfWidths[seg + 1] as number) - (halfWidths[seg] as number)) * t - F.edge;
    if (room <= 0 || l <= 0) {
      s += F.gapMax;
      continue;
    }
    const c = chunk(k, room);
    if (c.wide >= F.least) {
      const off = signedUnit(seed, 'river-floe-side', ...id, k) * (room - c.across);
      out.push({
        shape: Math.min(shapes - 1, Math.floor(unit(seed, 'river-floe-shape', ...id, k) * shapes)),
        x: (line[2 * seg] as number) + dx * t - (dy / l) * off,
        y: (line[2 * seg + 1] as number) + dy * t + (dx / l) * off,
        rot: Math.atan2(dy, dx) + c.turn,
        sx: c.long * (unit(seed, 'river-floe-mirror', ...id, k) < 0.5 ? -1 : 1),
        sy: c.wide,
      });
    }
    // On by this chunk's reach along the river, a reach of clear ice (most are short: the square of a number
    // from 0 to 1), and the next chunk's reach.
    s += c.along + F.gapMin + (F.gapMax - F.gapMin) * unit(seed, 'river-floe-gap', ...id, k) ** 2 + chunk(k + 1, room).along;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Keeping clear: what a freestanding thing on open ground is tested against
// (the second round's work, kept: the hex numbers, the counters' places, and all that is drawn)
// ---------------------------------------------------------------------------

/** What a freestanding thing on open ground keeps clear of, and lies against. */
export interface OpenGround {
  lines: CentreLines;
  hill: HillLineSet;
  /** Every tree drawn, of woods and of tree sides. */
  trees: readonly Canopy[];
  /** The outline of a tree is this many times its size across. */
  outlineScale: number;
  /** The green sides of tree sides, as drawn. */
  treeStrokes: readonly (readonly number[])[];
  sideHalfWidth: number;
  /** The shore of standing water, when the board has any. */
  shore: readonly (readonly number[])[];
  /** Spot heights' clear boxes and town names. */
  boxes: readonly Box[];
  roadCasing: number;
  riverBank: number;
  lineHalfWidth: number;
}

/** A grid of discs (x, y, r) for "does any disc come nearer than d" queries. */
class DiscIndex {
  private readonly cells = new Map<number, number[]>();
  most = 0;
  constructor(private readonly cell: number) {}
  private key(i: number, j: number): number {
    return (i + 32768) * 65536 + (j + 32768);
  }
  add(x: number, y: number, r: number): void {
    const k = this.key(Math.floor(x / this.cell), Math.floor(y / this.cell));
    const list = this.cells.get(k);
    if (list) list.push(x, y, r);
    else this.cells.set(k, [x, y, r]);
    if (r > this.most) this.most = r;
  }
  /** True when some disc's edge comes nearer (x, y) than d (or covers it). */
  near(x: number, y: number, d: number): boolean {
    const reach = d + this.most;
    const c = this.cell;
    for (let i = Math.floor((x - reach) / c); i <= Math.floor((x + reach) / c); i++) {
      for (let j = Math.floor((y - reach) / c); j <= Math.floor((y + reach) / c); j++) {
        const list = this.cells.get(this.key(i, j));
        if (!list) continue;
        for (let k = 0; k < list.length; k += 3) {
          const dd = Math.hypot((list[k] as number) - x, (list[k + 1] as number) - y);
          if (dd < (list[k + 2] as number) + d) return true;
        }
      }
    }
    return false;
  }
}

/** The trees as discs (each tree's outline), to ask whether a place lies under one or near one. */
function treeDiscs(trees: readonly Canopy[], outlineScale: number): DiscIndex {
  const index = new DiscIndex(0.25);
  for (const t of trees) index.add(t.x, t.y, (t.size * Math.max(t.sx, t.sy) * outlineScale) / 2);
  return index;
}

/** The place the table prints a hex's number in: a box under the hex's top side. */
export function numberBox(g: { cols: number; rows: number }, h: HexId, B: WinterDraw['keepClear']['numberBox']): Box {
  const c = centreOf(g, h);
  const top = c[1] - 0.5 + B.top;
  return [c[0] - B.halfWidth - B.pad, top - B.pad, c[0] + B.halfWidth + B.pad, top + B.height + B.pad];
}

/** Points along an outline no further apart than `step`, its corners among them: what a flat piece is tested by. */
export function outlinePoints(ring: readonly number[], step: number): [number, number][] {
  const out: [number, number][] = [];
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = i + 1 < n ? i + 1 : 0;
    const ax = ring[2 * i] as number;
    const ay = ring[2 * i + 1] as number;
    const bx = ring[2 * j] as number;
    const by = ring[2 * j + 1] as number;
    const parts = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 0; k < parts; k++) out.push([ax + ((bx - ax) * k) / parts, ay + ((by - ay) * k) / parts]);
  }
  return out;
}

function neighbourIds(g: { cols: number; rows: number }, h: HexId): HexId[] {
  const c = centreOf(g, h);
  const out: HexId[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    const n = nearestHex(g, c[0] + Math.cos(a), c[1] + Math.sin(a));
    if (n !== h && !out.includes(n)) out.push(n);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pieces of banked snow on open ground (a trial; switched off in the winter set: `drifts.share` 0)
// ---------------------------------------------------------------------------

/**
 * The pieces of banked snow on open ground, in the order they were placed: in `share` of the open hexes that
 * are no hilltop, one flat piece of the set's shapes, long the way the wind blows, a little out from the
 * hex's middle. A piece is kept only where its whole outline lies on the board, on open ground off every
 * hilltop, clear of every hex's number and of the middle of every hex (a counter's place), of roads, streams,
 * hill lines, green sides, trees, water, spot heights and names, and of every piece placed before it (the
 * winter set's `keepClear`). With `share` 0 (the set's value until the owner asks for them) there are none.
 */
export function placeDrifts(ctx: MapContext, W: WinterDraw, ground: OpenGround, shapes: readonly (readonly number[])[]): Piece[] {
  const D = W.drifts;
  const K = W.keepClear;
  const out: Piece[] = [];
  if (D.share <= 0) return out;
  const g = ctx.g;
  const [bx0, by0, bx1, by1] = worldBounds(g);
  const placed = new DiscIndex(0.5);
  const trees = treeDiscs(ground.trees, ground.outlineScale);
  const hillIndex = new SegmentIndex(0.5);
  for (const l of [...ground.hill.crest, ...ground.hill.crestOuter, ...ground.hill.ridge, ...ground.hill.separator]) hillIndex.addPolyline(l);
  const sideIndex = new SegmentIndex(0.5);
  for (const l of ground.treeStrokes) sideIndex.addPolyline(l);
  const along = (W.wind * Math.PI) / 180;

  const fits = (p: Piece): boolean => {
    const reach = Math.max(Math.abs(p.sx), Math.abs(p.sy)) / 2;
    if (placed.near(p.x, p.y, reach + K.spacing)) return false;
    const ring = pieceRing(shapes, p);
    for (const [x, y] of [[p.x, p.y] as [number, number], ...outlinePoints(ring, D.step)]) {
      if (x < bx0 + K.edgeClear || x > bx1 - K.edgeClear || y < by0 + K.edgeClear || y > by1 - K.edgeClear) return false;
      const h = nearestHex(g, x, y);
      if (ctx.cover[h] !== 'open' || ctx.level[h] === 2) return false;
      const c = centreOf(g, h);
      if (Math.hypot(x - c[0], y - c[1]) < K.counterClear) return false;
      const b = numberBox(g, h, K.numberBox);
      if (x > b[0] && x < b[2] && y > b[1] && y < b[3]) return false;
      for (const box of ground.boxes) if (x > box[0] && x < box[2] && y > box[1] && y < box[3]) return false;
      if (ground.lines.index.nearestTagged(x, y, ground.roadCasing + K.roadClear, ROAD) < ground.roadCasing + K.roadClear) return false;
      if (ground.lines.index.nearestTagged(x, y, ground.riverBank + K.riverClear, RIVER) < ground.riverBank + K.riverClear) return false;
      if (hillIndex.nearest(x, y, ground.lineHalfWidth + K.lineClear) < ground.lineHalfWidth + K.lineClear) return false;
      if (sideIndex.nearest(x, y, ground.sideHalfWidth + K.lineClear) < ground.sideHalfWidth + K.lineClear) return false;
      if (trees.near(x, y, K.treeClear)) return false;
      if (ground.shore.length > 0 && inRings(x, y, ground.shore)) return false;
    }
    // The number boxes of the hexes round its middle: no corner of one inside the piece.
    const h0 = nearestHex(g, p.x, p.y);
    for (const h of [h0, ...neighbourIds(g, h0)]) {
      const b = numberBox(g, h, K.numberBox);
      for (const [x, y] of [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]] as [number, number][]) if (inRings(x, y, [ring])) return false;
    }
    return true;
  };

  for (let h = 0; h < ctx.n; h++) {
    if (ctx.cover[h] !== 'open' || ctx.level[h] === 2) continue;
    if (unit(ctx.seed, 'snow-piece', h) >= D.share) continue;
    const c = centreOf(g, h);
    for (let k = 0; k < D.tries; k++) {
      const a = unit(ctx.seed, 'snow-piece-angle', h, k) * Math.PI * 2;
      const rho = between(D.reachMin, D.reachMax, ctx.seed, 'snow-piece-reach', h, k);
      const p: Piece = {
        shape: Math.min(shapes.length - 1, Math.floor(unit(ctx.seed, 'snow-piece-shape', h, k) * shapes.length)),
        x: c[0] + Math.cos(a) * rho,
        y: c[1] + Math.sin(a) * rho,
        rot: along + ((D.turn * Math.PI) / 180) * signedUnit(ctx.seed, 'snow-piece-turn', h, k),
        sx: between(D.lengthMin, D.lengthMax, ctx.seed, 'snow-piece-len', h, k) * (unit(ctx.seed, 'snow-piece-mirror', h, k) < 0.5 ? -1 : 1),
        sy: between(D.widthMin, D.widthMax, ctx.seed, 'snow-piece-wid', h, k),
      };
      if (!fits(p)) continue;
      out.push(p);
      placed.add(p.x, p.y, Math.max(Math.abs(p.sx), Math.abs(p.sy)) / 2);
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Frost: the speckled, icy snow of the hills
// ---------------------------------------------------------------------------

/** What the frost of the hills is laid by: the hill lines, and the trees it does not show through. */
export interface FrostGround {
  hill: HillLineSet;
  /** Every tree drawn, of woods and of tree sides. */
  trees: readonly Canopy[];
  /** The outline of a tree is this many times its size across. */
  outlineScale: number;
}

/** A soft patch: its outline (printed with a soft edge), and a seeded number from 0 to 1 that says how strong it is between its two bounds. */
export interface SoftPatch {
  ring: number[];
  u: number;
}

/** The crests and ridges of a board, to measure how far a place on a slope lies from the nearest. */
function crestIndex(hill: HillLineSet): SegmentIndex {
  const crests = new SegmentIndex(0.25);
  for (const l of [...hill.crest, ...hill.crestOuter, ...hill.ridge]) crests.addPolyline(l);
  return crests;
}

/**
 * Flecks over some hexes of the board: tiny flat pieces of the set's shapes, and no dots in rows. A world
 * lattice of `pitch` holds at most one fleck a cell, at a seeded place in it. The chance of one there is
 * `share`, times how thick the flecks lie there (`thick`: 0 none, 1 thickest), times the clump: 1 in the
 * heart of a clump (where a smooth seeded value of `clumpPitch` rises well over `clumpLevel`), easing down to
 * `scatter` outside the clumps. A fleck is `sizeMin` to `sizeMax` across: a seeded number from 0 to 1 raised
 * to `sizePower` says where between (so the higher the power, the more of them are specks), and the larger
 * ones lie in the clumps; each is a little squashed, turned and mirrored by seed. Every fleck is the set's
 * worn, rounded piece (FLECK_SHAPE: at a fleck's size an angular piece reads as a little triangle or a bar,
 * and a hex of them as a pattern), so the flecks of a hex are one stamp; a lattice cell is seen once, by the
 * hex its place lies in.
 */
export function scatterFlecks(ctx: MapContext, tag: string, hexes: readonly HexId[], F: FleckScatter, thick: (x: number, y: number) => number): Piece[] {
  const out: Piece[] = [];
  if (F.share <= 0) return out;
  const shape = FLECK_SHAPE;
  // One hash a cell for each choice (the tag mixed once: these are hash32(seed, tag, i, j), as a number from 0 to 1).
  const cell = (name: string): ((i: number, j: number) => number) => {
    const hash = cellHasher(ctx.seed, name);
    return (i, j) => hash(i, j) / 4294967296;
  };
  const chanceOf = cell(tag);
  const xOf = cell(`${tag}-x`);
  const yOf = cell(`${tag}-y`);
  const clumpOf = cell(`${tag}-clump`);
  const sizeOf = cell(`${tag}-size`);
  const turnOf = cell(`${tag}-turn`);
  const mirrorOf = cell(`${tag}-mirror`);
  const squashOf = cell(`${tag}-squash`);
  /** The clumps' smooth seeded value at a place: woods.ts `valueNoise`, with the tag mixed once. */
  const clumpAt = (x: number, y: number): number => {
    const fx = x / F.clumpPitch;
    const fy = y / F.clumpPitch;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    return (clumpOf(i, j) * (1 - sx) + clumpOf(i + 1, j) * sx) * (1 - sy) + (clumpOf(i, j + 1) * (1 - sx) + clumpOf(i + 1, j + 1) * sx) * sy;
  };
  for (const h of hexes) {
    const region = [regionRing(ctx.g, h)];
    const [x0, y0, x1, y1] = boundsOf(region);
    for (let j = Math.floor(y0 / F.pitch); j <= Math.floor(y1 / F.pitch); j++) {
      for (let i = Math.floor(x0 / F.pitch); i <= Math.floor(x1 / F.pitch); i++) {
        // The cheap tests first: most cells hold no fleck, and are never measured against the hill.
        const chance = chanceOf(i, j);
        if (chance >= F.share) continue;
        const x = (i + xOf(i, j)) * F.pitch;
        const y = (j + yOf(i, j)) * F.pitch;
        const n = clumpAt(x, y);
        const c = n <= F.clumpLevel ? 0 : Math.min(1, (n - F.clumpLevel) / ((1 - F.clumpLevel) * 0.6));
        const clump = F.scatter + (1 - F.scatter) * c * c * (3 - 2 * c);
        if (chance >= F.share * clump) continue;
        if (!inRings(x, y, region)) continue;
        if (chance >= F.share * clump * thick(x, y)) continue;
        const size = F.sizeMin + (F.sizeMax - F.sizeMin) * sizeOf(i, j) ** F.sizePower * (0.35 + 0.65 * c);
        out.push({
          shape, x, y,
          rot: turnOf(i, j) * Math.PI * 2,
          sx: size * (mirrorOf(i, j) < 0.5 ? -1 : 1),
          sy: size * (0.7 + 0.3 * squashOf(i, j)),
        });
      }
    }
  }
  return out;
}

/**
 * Soft patches over a part of the board: on a world lattice of `pitch`, in `share` of the cells whose seeded
 * place is wanted (`wanted`), one flat piece of the set's shapes, `sizeMin` to `sizeMax` across, turned and
 * squashed by seed. Each is printed with a soft edge (the set's `feather`), so it is a cloud and no shape.
 */
export function softPatches(
  ctx: MapContext, tag: string, P: SoftPatches, box: readonly number[], wanted: (x: number, y: number) => boolean, shapes: readonly (readonly number[])[],
): SoftPatch[] {
  const out: SoftPatch[] = [];
  if (P.share <= 0 || shapes.length === 0) return out;
  for (let j = Math.floor((box[1] as number) / P.pitch); j <= Math.floor((box[3] as number) / P.pitch); j++) {
    for (let i = Math.floor((box[0] as number) / P.pitch); i <= Math.floor((box[2] as number) / P.pitch); i++) {
      if (unit(ctx.seed, tag, i, j) >= P.share) continue;
      const x = (i + unit(ctx.seed, `${tag}-x`, i, j)) * P.pitch;
      const y = (j + unit(ctx.seed, `${tag}-y`, i, j)) * P.pitch;
      if (!wanted(x, y)) continue;
      const size = between(P.sizeMin, P.sizeMax, ctx.seed, `${tag}-size`, i, j);
      const shape = shapes[Math.min(shapes.length - 1, Math.floor(unit(ctx.seed, `${tag}-shape`, i, j) * shapes.length))] as readonly number[];
      out.push({
        ring: placedRing(shape, x, y, unit(ctx.seed, `${tag}-turn`, i, j) * Math.PI * 2, size, size * between(0.55, 1, ctx.seed, `${tag}-squash`, i, j)),
        u: unit(ctx.seed, `${tag}-strength`, i, j),
      });
    }
  }
  return out;
}

/**
 * The frost on the slopes (the owner, 2026-11-14, of the hill of his example: "the speckled icy snow and
 * reddish brown slopes ... is very good"): flecks of frost and snow caught on the slope, showing white through
 * its haze. They lie thickest beside a crest or a ridge and thin outward, by the power `power`, to none `reach`
 * from it; never on a hilltop (that has its own), on water or in a town, and never under a tree.
 */
export function slopeFrost(ctx: MapContext, S: WinterDraw['frost']['slopes']['flecks'], ground: FrostGround): Piece[] {
  const crests = crestIndex(ground.hill);
  if (crests.size === 0 || S.share <= 0) return [];
  const trees = treeDiscs(ground.trees, ground.outlineScale);
  const hexes: HexId[] = [];
  for (let h = 0; h < ctx.n; h++) {
    if (ctx.level[h] === 2 || ctx.cover[h] === 'water' || ctx.cover[h] === 'town') continue;
    const c = centreOf(ctx.g, h);
    // A hex reaches about 0.6 from its middle: further than that and the slope's reach from every crest, it holds no fleck.
    if (crests.nearest(c[0], c[1], S.reach + 0.6) !== Infinity) hexes.push(h);
  }
  return scatterFlecks(ctx, 'slope-frost', hexes, S, (x, y) => {
    const d = crests.nearest(x, y, S.reach);
    if (d === Infinity || trees.near(x, y, 0)) return 0;
    return (1 - d / S.reach) ** S.power;
  });
}

/**
 * Snow showing through the haze of the slopes in soft clouds, as in his example: soft patches whose middles
 * lie on a slope, `near` to `reach` from a crest or a ridge, off every hilltop and off the water. Under each
 * the haze is cleared, by between the set's `liftMin` and `liftMax`.
 */
export function slopeClouds(ctx: MapContext, C: WinterDraw['frost']['slopes']['clouds'], ground: FrostGround, shapes: readonly (readonly number[])[]): SoftPatch[] {
  const crests = crestIndex(ground.hill);
  if (crests.size === 0) return [];
  return softPatches(ctx, 'slope-cloud', C, worldBounds(ctx.g), (x, y) => {
    const d = crests.nearest(x, y, C.reach);
    if (d === Infinity || d < C.near) return false;
    const h = nearestHex(ctx.g, x, y);
    return ctx.level[h] !== 2 && ctx.cover[h] !== 'water';
  }, shapes);
}

/**
 * Faint soft clouds on the open snow of the plain (a trial: none while the set's `share` is 0): soft patches whose
 * middles lie on land that is no hilltop, with no water in the hex or beside it (a cloud stays off a shore's rim).
 */
export function plainClouds(ctx: MapContext, P: SoftPatches, shapes: readonly (readonly number[])[]): SoftPatch[] {
  return softPatches(ctx, 'plain-cloud', P, worldBounds(ctx.g), (x, y) => {
    const h = nearestHex(ctx.g, x, y);
    return ctx.level[h] !== 2 && ![h, ...neighbourIds(ctx.g, h)].some(n => ctx.cover[n] === 'water');
  }, shapes);
}

/** The flecks of frost on the hilltops, inside their crests: over every hilltop hex alike, and never under a tree. */
export function hilltopFlecks(ctx: MapContext, F: FleckScatter, ground: FrostGround): Piece[] {
  const trees = treeDiscs(ground.trees, ground.outlineScale);
  const hexes: HexId[] = [];
  for (let h = 0; h < ctx.n; h++) if (ctx.level[h] === 2) hexes.push(h);
  return scatterFlecks(ctx, 'hilltop-frost', hexes, F, (x, y) => (trees.near(x, y, 0) ? 0 : 1));
}

/** Soft patches whose middles lie on a hilltop (inside `tops`, the outlines of the hilltops): its darker clouds, or its whiter ones. */
export function hilltopClouds(ctx: MapContext, tag: string, P: SoftPatches, tops: readonly (readonly number[])[], shapes: readonly (readonly number[])[]): SoftPatch[] {
  if (tops.length === 0) return [];
  return softPatches(ctx, tag, P, boundsOf(tops), (x, y) => inRings(x, y, tops), shapes);
}

/**
 * The fine streaks of a hilltop's ice, as lines: on a world lattice of `pitch`, in `share` of the cells whose
 * seeded place lies on a hilltop (inside `tops`), one streak from that place, `lengthMin` to `lengthMax` long,
 * running the way the wind blows (`wind`, degrees clockwise from east) turned by up to `turn` either way, and
 * bowed to one side by up to `bend`. They are drawn clipped to the hilltops.
 */
export function hilltopStreaks(ctx: MapContext, S: WinterDraw['frost']['hilltops']['streaks'], wind: number, tops: readonly (readonly number[])[]): number[][] {
  const out: number[][] = [];
  if (S.share <= 0 || tops.length === 0) return out;
  const [x0, y0, x1, y1] = boundsOf(tops);
  for (let j = Math.floor(y0 / S.pitch); j <= Math.floor(y1 / S.pitch); j++) {
    for (let i = Math.floor(x0 / S.pitch); i <= Math.floor(x1 / S.pitch); i++) {
      if (unit(ctx.seed, 'hilltop-streak', i, j) >= S.share) continue;
      const x = (i + unit(ctx.seed, 'hilltop-streak-x', i, j)) * S.pitch;
      const y = (j + unit(ctx.seed, 'hilltop-streak-y', i, j)) * S.pitch;
      if (!inRings(x, y, tops)) continue;
      const a = ((wind + S.turn * signedUnit(ctx.seed, 'hilltop-streak-turn', i, j)) * Math.PI) / 180;
      const half = between(S.lengthMin, S.lengthMax, ctx.seed, 'hilltop-streak-len', i, j) / 2;
      const bow = S.bend * signedUnit(ctx.seed, 'hilltop-streak-bend', i, j);
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      // Five points along it: its ends on the line, its middle bowed out.
      const line: number[] = [];
      for (const t of [-1, -0.5, 0, 0.5, 1]) line.push(x + ux * half * t - uy * bow * (1 - t * t), y + uy * half * t + ux * bow * (1 - t * t));
      out.push(line);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ice
// ---------------------------------------------------------------------------

/**
 * Fine cracks in the ice: from a seeded share of the water hexes, a crack wanders out in short
 * steps, now and then putting out a branch. Each is a polyline; they are drawn clipped to the ice.
 * Seeded by the hex's own number, so the cracks do not depend on the order hexes are visited in.
 */
export function iceCracks(ctx: MapContext, I: WinterDraw['ice'], centre: (h: number) => [number, number]): number[][] {
  const out: number[][] = [];
  const turn = (I.crackTurn * Math.PI) / 180;
  const walk = (seed: string, h: number, x: number, y: number, heading: number, steps: number, branches: boolean): void => {
    const line = [x, y];
    let px = x;
    let py = y;
    let a = heading;
    for (let s = 0; s < steps; s++) {
      a += turn * signedUnit(ctx.seed, `${seed}-turn`, h, s);
      const len = I.crackStep * between(0.6, 1.4, ctx.seed, `${seed}-step`, h, s);
      px += Math.cos(a) * len;
      py += Math.sin(a) * len;
      line.push(px, py);
      if (branches && unit(ctx.seed, `${seed}-branch`, h, s) < I.crackBranch) {
        const side = unit(ctx.seed, `${seed}-side`, h, s) < 0.5 ? -1 : 1;
        walk(`${seed}-b${s}`, h, px, py, a + side * (0.6 + 0.5 * unit(ctx.seed, `${seed}-fork`, h, s)), Math.max(1, Math.floor(steps / 2)), false);
      }
    }
    out.push(line);
  };
  for (let h = 0; h < ctx.n; h++) {
    if (ctx.cover[h] !== 'water') continue;
    if (unit(ctx.seed, 'ice-crack', h) >= I.crackShare) continue;
    const c = centre(h);
    const x = c[0] + 0.3 * signedUnit(ctx.seed, 'ice-crack-x', h);
    const y = c[1] + 0.3 * signedUnit(ctx.seed, 'ice-crack-y', h);
    const steps = I.crackStepsMin + Math.floor(unit(ctx.seed, 'ice-crack-steps', h) * (I.crackStepsMax - I.crackStepsMin + 1));
    const heading = unit(ctx.seed, 'ice-crack-heading', h) * Math.PI * 2;
    // Two arms from the starting point, as a crack runs both ways from where it began.
    walk('ice-crack-a', h, x, y, heading, steps, true);
    walk('ice-crack-c', h, x, y, heading + Math.PI, Math.max(1, Math.floor(steps / 2)), true);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Kept from the second round, switched off in the winter set: its snow pillows (mounds of snow in rows of
// rounded lumps, `mounds.on`), and its dashes of snow on a river's ice (`ice.river: dashes`).
//
// The owner, 2026-11-14, of the mounds: "the agent took it literally and there are blobular objects on
// hilltops"; and of the dashes: "it looks like we have repeating light colored dashes". Neither is drawn.
// They are kept as that round made them, placement and seeding and all (the owner's standing rule: "Please
// retain any excellent or worthy work even if it was produced by mistake"): switched on, a board draws them
// again exactly as it did.
// ---------------------------------------------------------------------------

/** Where a mound lies, and why. */
export type MoundKind = 'lee' | 'crest' | 'bank' | 'drift';

/** A freestanding mound of snow (the second round's "snow pillow"): its middle, the direction of its length (radians), its length and width (h). */
export interface Mound {
  x: number;
  y: number;
  rot: number;
  len: number;
  wid: number;
  kind: MoundKind;
}

/** Whether a mound is drawn before the trees, so that they stand over it: a mound on the lee side of a wood. */
export function underTrees(p: { kind: MoundKind }): boolean {
  return p.kind === 'lee';
}

/**
 * How far across its line a mound's lumps may reach, as a share of its width (lumpPlacements keeps them inside
 * it): what a mound is placed and tested by, so that no lump of it goes where the mound may not.
 */
export const LUMP_REACH = 0.7;

/** The outline every lump of a mound lies inside: the mound grown to LUMP_REACH of its width across it, and as much at each end. */
export function reachOf<T extends { x: number; y: number; rot: number; len: number; wid: number }>(p: T): T {
  return { ...p, len: p.len + (2 * LUMP_REACH - 1) * p.wid, wid: 2 * LUMP_REACH * p.wid };
}

/** Points round the edge of a mound (and its middle), to test where it lies. */
export function moundPoints(p: { x: number; y: number; rot: number; len: number; wid: number }, n = 16): [number, number][] {
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  const out: [number, number][] = [[p.x, p.y]];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const u = (p.len / 2) * Math.cos(a);
    const v = (p.wid / 2) * Math.sin(a);
    out.push([p.x + c * u - s * v, p.y + s * u + c * v]);
  }
  return out;
}

/**
 * The freestanding mounds of a board, in the order they were placed: along the uphill side of crests,
 * against the banks of streams, on the lee side of woods' edges and of the green sides, then a few low
 * drifts on open ground. A mound is kept only where it lies wholly on the board, clear of every hex's
 * number and of the middle of every hex (a counter's place), of towns, water, roads, streams, hill lines,
 * green sides, trees, spot heights and names, and of every mound placed before it.
 */
export function placeMounds(ctx: MapContext, D: WinterDraw, ground: OpenGround): Mound[] {
  const P = D.keepClear;
  const M = D.mounds;
  const g = ctx.g;
  const [bx0, by0, bx1, by1] = worldBounds(g);
  const out: Mound[] = [];
  const placed = new DiscIndex(0.5);
  const trees = treeDiscs(ground.trees, ground.outlineScale);
  const hillIndex = new SegmentIndex(0.5);
  for (const l of [...ground.hill.crest, ...ground.hill.crestOuter, ...ground.hill.ridge, ...ground.hill.separator]) hillIndex.addPolyline(l);
  const sideIndex = new SegmentIndex(0.5);
  for (const l of ground.treeStrokes) sideIndex.addPolyline(l);
  const wind: [number, number] = [Math.cos((D.wind * Math.PI) / 180), Math.sin((D.wind * Math.PI) / 180)];

  const fits = (p: Mound): boolean => {
    const r = reachOf(p).len / 2;
    if (placed.near(p.x, p.y, r + P.spacing)) return false;
    // A mound on the lee side of a wood is drawn under the trees (`underTrees`): it may tuck under their
    // crowns and the green sides, so long as its middle lies clear of every crown.
    const under = underTrees(p);
    if (under && trees.near(p.x, p.y, P.treeClear)) return false;
    for (const [x, y] of moundPoints(reachOf(p))) {
      if (x < bx0 + P.edgeClear || x > bx1 - P.edgeClear || y < by0 + P.edgeClear || y > by1 - P.edgeClear) return false;
      const h = nearestHex(g, x, y);
      const cover = ctx.cover[h];
      if (cover === 'town' || cover === 'water') return false;
      const c = centreOf(g, h);
      if (Math.hypot(x - c[0], y - c[1]) < P.counterClear) return false;
      const b = numberBox(g, h, P.numberBox);
      if (x > b[0] && x < b[2] && y > b[1] && y < b[3]) return false;
      for (const box of ground.boxes) if (x > box[0] && x < box[2] && y > box[1] && y < box[3]) return false;
      if (ground.lines.index.nearestTagged(x, y, ground.roadCasing + P.roadClear, ROAD) < ground.roadCasing + P.roadClear) return false;
      if (ground.lines.index.nearestTagged(x, y, ground.riverBank + P.riverClear, RIVER) < ground.riverBank + P.riverClear) return false;
      if (hillIndex.nearest(x, y, ground.lineHalfWidth + P.lineClear) < ground.lineHalfWidth + P.lineClear) return false;
      if (!under && sideIndex.nearest(x, y, ground.sideHalfWidth + P.lineClear) < ground.sideHalfWidth + P.lineClear) return false;
      if (!under && trees.near(x, y, P.treeClear)) return false;
      if (ground.shore.length > 0 && inRings(x, y, ground.shore)) return false;
    }
    // The number boxes of the hexes round its middle, tested by their corners against the mound itself.
    const h0 = nearestHex(g, p.x, p.y);
    const c = Math.cos(p.rot);
    const s = Math.sin(p.rot);
    const inside = (x: number, y: number): boolean => {
      const u = ((x - p.x) * c + (y - p.y) * s) / (p.len / 2 + (LUMP_REACH - 0.5) * p.wid);
      const v = (-(x - p.x) * s + (y - p.y) * c) / (LUMP_REACH * p.wid);
      return u * u + v * v < 1;
    };
    for (const h of [h0, ...neighbourIds(g, h0)]) {
      const b = numberBox(g, h, P.numberBox);
      if (inside(b[0], b[1]) || inside(b[2], b[1]) || inside(b[0], b[3]) || inside(b[2], b[3])) return false;
    }
    return true;
  };
  const tryAdd = (p: Mound): void => {
    if (!fits(p)) return;
    out.push(p);
    placed.add(p.x, p.y, reachOf(p).len / 2);
  };
  /** Walk a polyline at a pitch: each step's point, its unit direction along the line, and its left normal. */
  const walk = (line: readonly number[], pitch: number, each: (x: number, y: number, tx: number, ty: number) => void): void => {
    let carry = pitch / 2;
    for (let i = 0; i + 3 < line.length; i += 2) {
      const ax = line[i] as number;
      const ay = line[i + 1] as number;
      const dx = (line[i + 2] as number) - ax;
      const dy = (line[i + 3] as number) - ay;
      const l = Math.hypot(dx, dy);
      if (l === 0) continue;
      let t = carry;
      while (t < l) {
        each(ax + (dx * t) / l, ay + (dy * t) / l, dx / l, dy / l);
        t += pitch;
      }
      carry = t - l;
    }
  };
  const size = (S: { lengthMin: number; lengthMax: number; widthMin: number; widthMax: number }, tag: string, x: number, y: number): [number, number] => [
    between(S.lengthMin, S.lengthMax, ctx.seed, `${tag}-len`, at(x), at(y)),
    between(S.widthMin, S.widthMax, ctx.seed, `${tag}-wid`, at(x), at(y)),
  ];

  // Along the uphill side of crests: the hilltop's side of each crest line.
  const C = M.crests;
  for (const line of ground.hill.crest) {
    walk(line, C.pitch, (x, y, tx, ty) => {
      if (unit(ctx.seed, 'pillow-crest', at(x), at(y)) >= C.share) return;
      const up = ctx.level[nearestHex(g, x - ty * 0.15, y + tx * 0.15)] === 2 ? 1 : -1;
      const [len, wid] = size(C, 'pillow-crest', x, y);
      const off = ground.lineHalfWidth + C.gap + LUMP_REACH * wid;
      tryAdd({ x: x - ty * off * up, y: y + tx * off * up, rot: Math.atan2(ty, tx), len, wid, kind: 'crest' });
    });
  }
  // Against the banks of streams: either side, along the stream.
  const B = M.banks;
  for (const r of ground.lines.rivers) {
    const bank = ground.riverBank * (r.width ?? 1);
    walk(r.line, B.pitch, (x, y, tx, ty) => {
      for (const side of [1, -1]) {
        if (unit(ctx.seed, 'pillow-bank', at(x), at(y), side) >= B.share) continue;
        const [len, wid] = size(B, 'pillow-bank', x + side, y);
        const off = bank + B.gap + LUMP_REACH * wid;
        tryAdd({ x: x - ty * off * side, y: y + tx * off * side, rot: Math.atan2(ty, tx), len, wid, kind: 'bank' });
      }
    });
  }
  // On the lee side of woods' edges: behind each tree that has no tree just downwind of it, across the wind.
  const L = M.lee;
  const byPlace = [...ground.trees].sort((a, b) => a.x - b.x || a.y - b.y);
  const across = Math.atan2(wind[0], -wind[1]);
  for (const t of byPlace) {
    const r = (t.size * Math.max(t.sx, t.sy) * ground.outlineScale) / 2;
    const qx = t.x + wind[0] * r * 1.6;
    const qy = t.y + wind[1] * r * 1.6;
    if (trees.near(qx, qy, -r * 0.4)) continue;
    if (unit(ctx.seed, 'pillow-lee', at(t.x), at(t.y)) >= L.share) continue;
    const [len, wid] = size(L, 'pillow-lee', t.x, t.y);
    const off = r + L.gap + LUMP_REACH * wid;
    tryAdd({ x: t.x + wind[0] * off, y: t.y + wind[1] * off, rot: across, len, wid, kind: 'lee' });
  }
  // ...and of the green sides: on the side of each that faces down the wind.
  for (const line of ground.treeStrokes) {
    walk(line, L.pitch, (x, y, tx, ty) => {
      if (unit(ctx.seed, 'pillow-side', at(x), at(y)) >= L.share) return;
      const lee = -ty * wind[0] + tx * wind[1] >= 0 ? 1 : -1;
      const [len, wid] = size(L, 'pillow-side', x, y);
      const off = ground.sideHalfWidth + L.gap + LUMP_REACH * wid;
      tryAdd({ x: x - ty * off * lee, y: y + tx * off * lee, rot: Math.atan2(ty, tx), len, wid, kind: 'lee' });
    });
  }
  // A few low drifts on open ground, along the wind.
  const R = M.open;
  for (let h = 0; h < ctx.n; h++) {
    const cover = ctx.cover[h];
    if (cover !== 'open' && cover !== 'field') continue;
    if (unit(ctx.seed, 'pillow-drift', h) >= R.share) continue;
    const c = centreOf(g, h);
    for (let k = 0; k < R.tries; k++) {
      const a = unit(ctx.seed, 'pillow-drift-angle', h, k) * Math.PI * 2;
      const rho = between(R.reachMin, R.reachMax, ctx.seed, 'pillow-drift-reach', h, k);
      const x = c[0] + Math.cos(a) * rho;
      const y = c[1] + Math.sin(a) * rho;
      const len = between(R.lengthMin, R.lengthMax, ctx.seed, 'pillow-drift-len', h, k);
      const wid = between(R.widthMin, R.widthMax, ctx.seed, 'pillow-drift-wid', h, k);
      const before = out.length;
      tryAdd({ x, y, rot: Math.atan2(wind[1], wind[0]), len, wid, kind: 'drift' });
      if (out.length > before) break;
    }
  }
  return out;
}

/**
 * A mound as it is drawn: a row of lumps of snow along its length, so that it reads as a stack of fallen
 * snow and not as one smooth shape. Each lump is a placement of the cap's circle (five numbers): about as
 * wide as the mound, a little longer along it, overlapping the next, the row a little uneven; one lump for a
 * short mound, up to `most` for a long one. They come in the order they are printed: the lump furthest from
 * the light first, so that each nearer lump's lit top covers the shaded side of the one behind it where they
 * overlap, and only the mound's own shaded side shows. Seeded by the mound's place.
 */
export function lumpPlacements(seed: number, p: Mound, most: number, light: readonly [number, number]): number[][] {
  const n = Math.max(1, Math.min(most, Math.round((p.len / p.wid) * 0.8)));
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  const lumps: number[][] = [];
  for (let i = 0; i < n; i++) {
    const id = [at(p.x), at(p.y), i];
    // The middle lump of three is the fullest.
    const full = n === 3 && i === 1 ? 1.08 : 1;
    const v = 0.1 * p.wid * signedUnit(seed, 'pillow-lump-v', ...id);
    // No wider than keeps it inside LUMP_REACH of the mound's width.
    const size = Math.min(2 * (LUMP_REACH * p.wid - Math.abs(v)), p.wid * full * between(0.86, 1.04, seed, 'pillow-lump-size', ...id));
    const long = n === 1 ? p.len : Math.min(p.len, (p.len / n) * between(1.5, 1.8, seed, 'pillow-lump-long', ...id));
    // Along the mound, from one end to the other, the lumps' ends just inside its ends; across it, a little off its line.
    const u = n === 1 ? 0 : -p.len / 2 + long / 2 + ((p.len - long) * i) / (n - 1);
    lumps.push([p.x + c * u - s * v, p.y + s * u + c * v, p.rot + 0.12 * signedUnit(seed, 'pillow-lump-turn', ...id), long, Math.min(size, long)]);
  }
  const towardLight = (l: number[]) => (l[0] as number) * light[0] + (l[1] as number) * light[1];
  return lumps.sort((a, b) => towardLight(a) - towardLight(b));
}

/** A mound's shadow on the snow: the outline its lumps lie in (reachOf), moved `offset` away from the light and grown by `grow`. */
export function moundShadowRing(p: Mound, light: readonly [number, number], offset: number, grow: number): number[] {
  const q = reachOf(p);
  return moundPoints({ x: p.x - light[0] * offset, y: p.y - light[1] * offset, rot: p.rot, len: q.len + 2 * grow, wid: q.wid + 2 * grow }, 24).slice(1).flat();
}

/**
 * Snow lying on a river's ice in dashes (the second round's): a dash pattern along the river (patch, gap,
 * patch, ...), each length varied by `jitter`, enough of them to run the river's whole length. Seeded by the
 * river's first point.
 */
export function riverSnowDashes(seed: number, line: readonly number[], I: WinterDraw['ice']['dashes']): number[] {
  let length = 0;
  for (let i = 0; i + 3 < line.length; i += 2) length += Math.hypot((line[i + 2] as number) - (line[i] as number), (line[i + 3] as number) - (line[i + 1] as number));
  const id = [at(line[0] as number), at(line[1] as number)];
  const out: number[] = [];
  let run = 0;
  for (let k = 0; run < length; k++) {
    const patch = I.patch * (1 + I.jitter * signedUnit(seed, 'river-snow-patch', ...id, k));
    const gap = I.gap * (1 + I.jitter * signedUnit(seed, 'river-snow-gap', ...id, k));
    out.push(patch, gap);
    run += patch + gap;
  }
  return out;
}
