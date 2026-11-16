/**
 * What the game of orders shows on the table besides the counters themselves
 * (the optional members of the port, port.ts): the fire a move would draw and
 * the fire being drawn, each line with a small printed tag beside it; routes
 * drawn on the sheet in grease pencil; and markers lying on hexes.
 *
 * This file is their state and their geometry: what is shown, how far each
 * thing has eased in or out, where each tag lies, and the strokes that draw
 * the lines, the routes and the tags. It draws nothing and touches no DOM:
 * pieces.ts steps it, view.ts uploads what `strokesOf` gives. Plain arithmetic.
 *
 * Every set is replaced whole. What leaves fades out, what is new fades in,
 * and a thing that is in both the old set and the new stays exactly as it is:
 * nothing snaps. A tag's place is chosen when its line first appears and kept
 * while the line stays; it does not depend on the camera (two tags are laid
 * far enough apart to be clear of each other whichever way they are turned),
 * so turning the table moves no tag.
 */
import { SCENE_SEED, hash01 } from '../hash';
import { chanceSize, chanceStrokes, layChances } from './chances';
import type { ChanceSpec, CounterBox } from './chances';
import { CHANCE_INKS, CUE, CUE_INKS, MARK_INKS } from './dims';
import { GLYPH_HEIGHT, letter } from './glyphs';
import { smoothLine } from './motion';

type P2 = readonly [number, number];
type Rgb = readonly [number, number, number];

/** Fire from one hex at another, with the chance to print beside it. */
export interface Shot {
  from: number;
  to: number;
  label: string;
  live: boolean;
}

/** A thing lying on a hex that both sides see. */
export interface MarkerSpec {
  hex: number;
  kind: 'screen' | 'incoming';
  label: string;
  side: string | null;
}

interface Eased {
  /** What it is, with a number where the set holds the same thing twice. */
  key: string;
  /** Whether the present set holds it: it eases toward this. */
  want: 0 | 1;
  /** How far in it is, 0 to 1, as a ramp in time. */
  show: number;
}

export interface ShownLine extends Eased {
  from: number;
  to: number;
  /** '' for a declared attack: a line with no tag. */
  label: string;
  live: boolean;
  /** Where its tag's middle lies: this far back from the hex fired at, along the line, and this far to its left. Less than 0: not laid yet. */
  back: number;
  side: number;
}

export interface ShownRoute extends Eased {
  hexes: number[];
}

/** A chance card (chances.ts): what it says, and where its middle lies (null: not laid). */
export interface ShownChance extends Eased {
  spec: ChanceSpec;
  at: [number, number] | null;
}

export interface ShownMarker extends Eased {
  hex: number;
  kind: 'screen' | 'incoming';
  label: string;
  side: string | null;
  /** A hair of offset and a little turn, by what it is and where. */
  jitter: [number, number, number];
}

/** How a ramp is drawn: gentle at both ends. */
export function eased(show: number): number {
  const s = Math.min(1, Math.max(0, show));
  return s * s * (3 - 2 * s);
}

/** Bring a list to a new set: what stays is kept as it is, what is new starts unseen, what leaves is kept until it has faded. */
function replace<T extends Eased, W>(old: readonly T[], wanted: readonly W[], keyOf: (w: W) => string, make: (w: W, key: string) => T): T[] {
  const byKey = new Map(old.map(o => [o.key, o]));
  const seen = new Map<string, number>();
  const kept = new Set<string>();
  const out: T[] = [];
  for (const w of wanted) {
    const base = keyOf(w);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const key = `${base}#${n}`;
    const was = byKey.get(key);
    if (was) {
      was.want = 1;
      out.push(was);
    } else out.push(make(w, key));
    kept.add(key);
  }
  for (const o of old) {
    if (kept.has(o.key)) continue;
    o.want = 0;
    if (o.show > 0) out.push(o);
  }
  return out;
}

/** Ease every member of a list toward what is wanted of it; drop what has gone. Says whether anything moved. */
function advance<T extends Eased>(list: T[], dt: number, seconds: number): boolean {
  let moved = false;
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i] as T;
    if (e.show === e.want) continue;
    moved = true;
    const step = dt / seconds;
    e.show = e.want === 1 ? Math.min(1, e.show + step) : Math.max(0, e.show - step);
    if (e.want === 0 && e.show <= 0) list.splice(i, 1);
  }
  return moved;
}

// ---- tags ----------------------------------------------------------------------------------------

/** A tag's size on the table for a label: along its letters, across them. */
export function tagSize(label: string): [number, number] {
  const wide = (letter(label).width / GLYPH_HEIGHT) * CUE.tagLetter;
  return [wide + 2 * CUE.tagPad[0], CUE.tagLetter + 2 * CUE.tagPad[1]];
}

export interface TagAsk {
  /** The middles of the hex fired from and the hex fired at. */
  from: P2;
  to: P2;
  size: P2;
  /** Where it already lies, if it does: it is not moved. */
  slot?: { back: number; side: number };
}

/** The middle of a tag for a slot on its line. */
export function tagAt(from: P2, to: P2, back: number, side: number): [number, number] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return [to[0] - ux * back - uy * side, to[1] - uy * back + ux * side];
}

/**
 * Lay a tag beside each line: on the line, a little back from the hex fired at.
 * No two lie on each other however the table is turned: the middles of two
 * tags are at least the diagonal of their two half sizes apart. A tag that
 * would lie on one already laid goes further back along its own line; where
 * the line is too short for that, to one side of it. Tags that already have a
 * place keep it; the rest are laid in the order given.
 */
export function layTags(asks: readonly TagAsk[], covered?: (x: number, y: number, reach: number) => boolean): { back: number; side: number }[] {
  const laid: { c: [number, number]; size: P2 }[] = [];
  const out: ({ back: number; side: number } | null)[] = asks.map(a => (a.slot ? { back: a.slot.back, side: a.slot.side } : null));
  asks.forEach((a, i) => {
    const s = out[i];
    if (s) laid.push({ c: tagAt(a.from, a.to, s.back, s.side), size: a.size });
  });
  const clear = (c: P2, size: P2): boolean =>
    laid.every(l => Math.hypot(c[0] - l.c[0], c[1] - l.c[1]) >= Math.hypot((size[0] + l.size[0]) / 2 + CUE.tagGap, (size[1] + l.size[1]) / 2 + CUE.tagGap));
  asks.forEach((a, i) => {
    if (out[i]) return;
    const len = Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1]);
    // Never further back than the hex fired from (a short line: the tag lies at its middle).
    const first = Math.min(CUE.tagBack, len / 2);
    const last = Math.max(first, len - CUE.lineInset);
    let found: { back: number; side: number } | null = null;
    // Clear of the other tags and of every counter, if the line has such a place; else clear of the other tags.
    const reach = Math.hypot(a.size[0], a.size[1]) / 2 + CUE.tagGap;
    for (let back = first; covered && back <= last + 1e-9 && !found; back += CUE.tagStep) {
      const c = tagAt(a.from, a.to, back, 0);
      if (clear(c, a.size) && !covered(c[0], c[1], reach)) found = { back, side: 0 };
    }
    for (let back = first; back <= last + 1e-9 && !found; back += CUE.tagStep) {
      if (clear(tagAt(a.from, a.to, back, 0), a.size)) found = { back, side: 0 };
    }
    // The line is full: beside it, one side and then the other, further each time.
    for (let k = 1; k <= 24 && !found; k++) {
      const side = Math.ceil(k / 2) * (a.size[1] + CUE.tagGap) * (k - 2 * Math.floor(k / 2) === 1 ? 1 : -1);
      for (let back = first; back <= last + 1e-9 && !found; back += CUE.tagStep * 2) {
        if (clear(tagAt(a.from, a.to, back, side), a.size)) found = { back, side };
      }
    }
    const slot = found ?? { back: first, side: 0 };
    out[i] = slot;
    laid.push({ c: tagAt(a.from, a.to, slot.back, slot.side), size: a.size });
  });
  return out as { back: number; side: number }[];
}

// ---- the state -----------------------------------------------------------------------------------

export class Cues {
  /** Declared attacks (the port's `lines`), the fire of `threats`, routes, markers: each with what has not yet faded. */
  fire: ShownLine[] = [];
  threats: ShownLine[] = [];
  routes: ShownRoute[] = [];
  markers: ShownMarker[] = [];
  /** The chance of every target at once (the port's `chances`). */
  chances: ShownChance[] = [];
  /** Counts every change to what is drawn. */
  stamp = 0;
  /** Counts changes to the set of markers (their prints are drawn again when it moves on). */
  markerVersion = 0;
  /** Whether something that a tag should not lie on (a counter) is within a reach of a point; null: nothing is. */
  covered: ((x: number, y: number, reach: number) => boolean) | null = null;
  private readonly centreOf: (hex: number) => P2;
  private readonly hexes: () => number;

  constructor(centreOf: (hex: number) => P2, hexes: () => number) {
    this.centreOf = centreOf;
    this.hexes = hexes;
  }

  private onBoard(hex: number): boolean {
    return Number.isInteger(hex) && hex >= 0 && hex < this.hexes();
  }

  /** The port's `lines('fire')`: replaces the set; an empty list clears it. */
  setFire(segments: readonly { from: number; to: number }[]): void {
    const ok = segments.filter(s => this.onBoard(s.from) && this.onBoard(s.to) && s.from !== s.to);
    this.fire = replace(this.fire, ok, s => `${s.from}>${s.to}`, (s, key) => ({ key, want: 1, show: 0, from: s.from, to: s.to, label: '', live: true, back: -1, side: 0 }));
    this.stamp++;
  }

  /** The port's `threats`: replaces the set; an empty list clears it. */
  setThreats(shots: readonly Shot[]): void {
    const ok = shots.filter(s => this.onBoard(s.from) && this.onBoard(s.to) && s.from !== s.to);
    this.threats = replace(
      this.threats,
      ok,
      s => `${s.from}>${s.to}:${s.live ? 'live' : 'would'}:${s.label}`,
      (s, key) => ({ key, want: 1, show: 0, from: s.from, to: s.to, label: s.label, live: s.live, back: -1, side: 0 }),
    );
    // Tags: those that stay keep their places, the new ones are laid round them. What is leaving is not laid round: it is gone in a moment.
    const staying = this.threats.filter(t => t.want === 1 && t.label !== '');
    const slots = layTags(
      staying.map(t => ({ from: this.centreOf(t.from), to: this.centreOf(t.to), size: tagSize(t.label), ...(t.back >= 0 ? { slot: { back: t.back, side: t.side } } : {}) })),
      this.covered || this.chances.length > 0 ? (x, y, reach) => (this.covered?.(x, y, reach) ?? false) || this.onChance(x, y, reach) : undefined,
    );
    staying.forEach((t, i) => {
      const s = slots[i] as { back: number; side: number };
      t.back = s.back;
      t.side = s.side;
    });
    this.stamp++;
  }

  /** Whether a chance card lies within a reach of a point (a tag of fire is laid clear of the cards where it can be). */
  private onChance(x: number, y: number, reach: number): boolean {
    return this.chances.some(c => {
      if (c.want === 0 || !c.at) return false;
      const [w, h] = chanceSize(c.spec);
      return Math.abs(c.at[0] - x) < w / 2 + reach && Math.abs(c.at[1] - y) < h / 2 + reach;
    });
  }

  /**
   * The port's `chances`: replaces the set; an empty list clears it. A card is the same card while it is for the same
   * counter (its figures may change): it keeps its place if that is still clear. `counters`: every counter on the
   * board, for the layout; the best card is laid first.
   */
  setChances(specs: readonly ChanceSpec[], counters: readonly CounterBox[]): void {
    const where = new Map(counters.map(k => [k.id, k] as const));
    const ok = specs.filter(s => this.onBoard(s.hex) && where.has(s.unit));
    const byUnit = new Map(ok.map(s => [s.unit, s] as const));
    this.chances = replace(this.chances, ok, s => s.unit, (s, key) => ({ key, want: 1, show: 0, spec: { ...s }, at: null }));
    const staying = this.chances.filter(c => c.want === 1);
    for (const c of staying) {
      const s = byUnit.get(c.spec.unit);
      if (s) c.spec = { ...s };
    }
    const order = staying.map((_, i) => i).sort((a, b) => Number((staying[b] as ShownChance).spec.best) - Number((staying[a] as ShownChance).spec.best) || a - b);
    const asks = order.map(i => {
      const c = staying[i] as ShownChance;
      const k = where.get(c.spec.unit) as CounterBox;
      return { own: k, size: chanceSize(c.spec), prev: c.at };
    });
    const laid = layChances(asks, counters);
    order.forEach((i, j) => {
      const at = laid[j] as readonly [number, number];
      (staying[i] as ShownChance).at = [at[0], at[1]];
    });
    this.stamp++;
  }

  /** The port's `routes`: replaces the set; an empty list clears it. */
  setRoutes(paths: readonly (readonly number[])[]): void {
    const ok = paths.map(p => p.filter(h => this.onBoard(h))).filter(p => p.length >= 2);
    this.routes = replace(this.routes, ok, p => p.join('-'), (p, key) => ({ key, want: 1, show: 0, hexes: [...p] }));
    this.stamp++;
  }

  /** The port's `markers`: replaces the set; an empty list clears it. */
  setMarkers(markers: readonly MarkerSpec[]): void {
    const ok = markers.filter(m => this.onBoard(m.hex) && (m.kind === 'screen' || m.kind === 'incoming'));
    this.markers = replace(
      this.markers,
      ok,
      m => `${m.hex}:${m.kind}:${m.side ?? ''}:${m.label}`,
      (m, key) => ({
        key,
        want: 1,
        show: 0,
        hex: m.hex,
        kind: m.kind,
        label: m.label,
        side: m.side,
        jitter: [
          (hash01(SCENE_SEED, `marker-x:${key}`, 0) - 0.5) * 2 * CUE.markerJitter,
          (hash01(SCENE_SEED, `marker-y:${key}`, 0) - 0.5) * 2 * CUE.markerJitter,
          (hash01(SCENE_SEED, `marker-turn:${key}`, 0) - 0.5) * 2 * CUE.markerTurnDeg * (Math.PI / 180),
        ],
      }),
    );
    this.markerVersion++;
    this.stamp++;
  }

  /** Advance every fade by a frame's worth of time. True while anything is still coming or going. */
  step(dt: number): boolean {
    const a = advance(this.fire, dt, CUE.easeS);
    const b = advance(this.threats, dt, CUE.easeS);
    const c = advance(this.routes, dt, CUE.easeS);
    const d = advance(this.markers, dt, CUE.markerS);
    const e = advance(this.chances, dt, CUE.easeS);
    const moved = a || b || c || d || e;
    if (moved) this.stamp++;
    return moved;
  }

  /** Whether anything at all is shown. */
  get any(): boolean {
    return this.fire.length + this.threats.length + this.routes.length + this.markers.length + this.chances.length > 0;
  }

  /**
   * Where each marker lies and how large it is drawn, in the order of the list:
   * on its hex with its own hair of offset and turn; a second marker on a hex
   * lies on the first, a little off it. One that is arriving slides in along
   * the board, growing; one that is leaving goes the same way back.
   */
  markerPoses(): { marker: ShownMarker; x: number; y: number; z: number; yaw: number; scale: number }[] {
    const under = new Map<number, number>();
    return this.markers.map(m => {
      const e = eased(m.show);
      const c = this.centreOf(m.hex);
      const below = under.get(m.hex) ?? 0;
      under.set(m.hex, below + e);
      const slide = CUE.markerSlide * (1 - e) * (1 - e);
      return {
        marker: m,
        x: c[0] + m.jitter[0] + CUE.markerSecond[0] * below,
        y: c[1] + m.jitter[1] + CUE.markerSecond[1] * below + slide,
        z: CUE.markerThickness * (below + 0.5 * e),
        yaw: m.jitter[2],
        scale: e,
      };
    });
  }

  /** The height of the markers' top on a hex (0 where none lies). */
  markerTop(hex: number): number {
    let top = 0;
    for (const m of this.markers) if (m.hex === hex) top += CUE.markerThickness * eased(m.show);
    return top;
  }

  /** What is shown, for checks: every line with where its tag lies, every route, every marker. */
  readings(): CueReadings {
    const line = (l: ShownLine): CueReadings['threats'][number] => {
      const from = this.centreOf(l.from);
      const to = this.centreOf(l.to);
      return { from: l.from, to: l.to, label: l.label, live: l.live, shown: eased(l.show), leaving: l.want === 0, tag: l.label !== '' && l.back >= 0 ? tagAt(from, to, l.back, l.side) : null, tagSize: l.label !== '' ? tagSize(l.label) : null };
    };
    return {
      fire: this.fire.map(line),
      threats: this.threats.map(line),
      routes: this.routes.map(r => ({ hexes: [...r.hexes], shown: eased(r.show), leaving: r.want === 0 })),
      markers: this.markerPoses().map(p => ({ hex: p.marker.hex, kind: p.marker.kind, label: p.marker.label, side: p.marker.side, shown: p.scale, leaving: p.marker.want === 0, position: [p.x, p.y, p.z] as [number, number, number] })),
      chances: this.chances.map(c => ({ ...c.spec, shown: eased(c.show), leaving: c.want === 0, at: c.at ? [c.at[0], c.at[1]] as [number, number] : null, size: chanceSize(c.spec) })),
    };
  }
}

export interface CueReadings {
  fire: { from: number; to: number; label: string; live: boolean; shown: number; leaving: boolean; tag: [number, number] | null; tagSize: [number, number] | null }[];
  threats: CueReadings['fire'];
  routes: { hexes: number[]; shown: number; leaving: boolean }[];
  markers: { hex: number; kind: 'screen' | 'incoming'; label: string; side: string | null; shown: number; leaving: boolean; position: [number, number, number] }[];
  /** The chance cards: what each says, how far in it is, where its middle lies on the board and its size (along its letters, across them). */
  chances: { unit: string; hex: number; chance: string; kill: string; best: boolean; shown: number; leaving: boolean; at: [number, number] | null; size: [number, number] }[];
}

// ---- strokes -------------------------------------------------------------------------------------

/**
 * Everything the cues draw flat is a stroke: a rounded bar from one point to
 * another, lying at a height. A line of fire is one (broken into dashes, or
 * whole with a pointed head); a route is a run of them; a tag is a wide one
 * with small corners, its keyline another, and each of its letters' strokes
 * another. One instanced mesh draws them all, in the order they are added.
 */
export class Strokes {
  count = 0;
  /** From (x, y), to (x, y). */
  seg: Float32Array = new Float32Array(0);
  /** Half its width, its corner radius, the height it lies at, the reach of a soft edge. */
  shape: Float32Array = new Float32Array(0);
  /** Colour (linear), how solid. */
  ink: Float32Array = new Float32Array(0);
  /** Dash on, dash off, length of a pointed head at the far end, how much the sheet's tooth breaks it up. */
  style: Float32Array = new Float32Array(0);
  /** The direction of the stroke before it and of the one after it in a run (0, 0 where it has a free end). */
  join: Float32Array = new Float32Array(0);

  clear(): void {
    this.count = 0;
  }

  private room(): void {
    if ((this.count + 1) * 4 <= this.seg.length) return;
    const cap = Math.max(64, this.count * 2);
    const grow = (a: Float32Array): Float32Array => {
      const b = new Float32Array(cap * 4);
      b.set(a.subarray(0, this.count * 4));
      return b;
    };
    this.seg = grow(this.seg);
    this.shape = grow(this.shape);
    this.ink = grow(this.ink);
    this.style = grow(this.style);
    this.join = grow(this.join);
  }

  add(s: { a: P2; b: P2; z: number; halfWidth: number; radius?: number; soft?: number; ink: Rgb; alpha: number; dash?: P2; head?: number; wax?: number; before?: P2; after?: P2 }): void {
    this.room();
    const k = this.count * 4;
    this.seg[k] = s.a[0];
    this.seg[k + 1] = s.a[1];
    this.seg[k + 2] = s.b[0];
    this.seg[k + 3] = s.b[1];
    this.shape[k] = s.halfWidth;
    this.shape[k + 1] = Math.min(s.halfWidth, s.radius ?? s.halfWidth);
    this.shape[k + 2] = s.z;
    this.shape[k + 3] = s.soft ?? 0;
    this.ink[k] = s.ink[0];
    this.ink[k + 1] = s.ink[1];
    this.ink[k + 2] = s.ink[2];
    this.ink[k + 3] = s.alpha;
    this.style[k] = s.dash ? s.dash[0] : 0;
    this.style[k + 1] = s.dash ? s.dash[1] : 0;
    this.style[k + 2] = s.head ?? 0;
    this.style[k + 3] = s.wax ?? 0;
    this.join[k] = s.before ? s.before[0] : 0;
    this.join[k + 1] = s.before ? s.before[1] : 0;
    this.join[k + 2] = s.after ? s.after[0] : 0;
    this.join[k + 3] = s.after ? s.after[1] : 0;
    this.count++;
  }
}

export interface StrokeEnv {
  centreOf(hex: number): P2;
  /** The way the screen's right lies on the board, as the camera stands: a unit vector. Letters run along it. */
  right: P2;
  /** The way the key light's shadows fall on the plan: a unit vector. */
  shadow: P2;
  /** The height of what lies under a tag put down at a point (its half sizes along its letters and across them): 0 on the bare board, the top of a marker or of a stack. */
  topUnder(x: number, y: number, along: number, across: number): number;
}

function lineStrokes(out: Strokes, l: ShownLine, env: StrokeEnv): void {
  const a = eased(l.show);
  if (a <= 0) return;
  const from = env.centreOf(l.from);
  const to = env.centreOf(l.to);
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (len <= 2 * CUE.lineInset + 1e-6) return;
  const ux = (to[0] - from[0]) / len;
  const uy = (to[1] - from[1]) / len;
  const hw = l.live ? CUE.liveHalfWidth : CUE.wouldHalfWidth;
  out.add({
    a: [from[0] + ux * CUE.lineInset, from[1] + uy * CUE.lineInset],
    b: [to[0] - ux * CUE.lineInset, to[1] - uy * CUE.lineInset],
    z: CUE.strokeZ,
    halfWidth: hw,
    ink: MARK_INKS.fire,
    alpha: (l.live ? CUE.liveAlpha : CUE.wouldAlpha) * a,
    head: CUE.headWidths * hw,
    ...(l.live ? {} : { dash: CUE.wouldDash }),
  });
}

function tagStrokes(out: Strokes, l: ShownLine, env: StrokeEnv): void {
  const a = eased(l.show);
  if (a <= 0 || l.label === '' || l.back < 0) return;
  const c = tagAt(env.centreOf(l.from), env.centreOf(l.to), l.back, l.side);
  const [w, h] = tagSize(l.label);
  const rx = env.right[0];
  const ry = env.right[1];
  // Down the screen, on the board: letters are written from their tops toward the viewer.
  const dx = -ry;
  const dy = rx;
  const z = env.topUnder(c[0], c[1], w / 2, h / 2) + CUE.tagLift;
  const paper: Rgb = l.live ? CUE_INKS.tagInk : CUE_INKS.tagPaper;
  const ink: Rgb = l.live ? CUE_INKS.tagPaper : CUE_INKS.tagInk;
  const r = CUE.tagRadius;
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
  // Its shadow on what it lies on, the keyline, the card, the letters.
  const reach = CUE.tagShadow;
  bar(0, r, CUE_INKS.shadow, CUE.tagShadowAlpha * a, reach, [env.shadow[0] * reach * 0.45, env.shadow[1] * reach * 0.45], -0.0015);
  bar(0, r, ink, a, 0, [0, 0], 0);
  bar(-CUE.tagKeyline, Math.max(0.004, r - CUE.tagKeyline), paper, a, 0, [0, 0], 0.0004);
  const text = letter(l.label);
  const k = CUE.tagLetter / GLYPH_HEIGHT;
  const ox = c[0] - rx * ((text.width * k) / 2) - dx * (CUE.tagLetter / 2);
  const oy = c[1] - ry * ((text.width * k) / 2) - dy * (CUE.tagLetter / 2);
  const at = (p: readonly [number, number]): [number, number] => [ox + rx * p[0] * k + dx * p[1] * k, oy + ry * p[0] * k + dy * p[1] * k];
  const half = (CUE.tagLetter * CUE.tagWeight) / 2;
  for (const s of text.strokes) {
    for (let i = 1; i < s.length; i++) {
      out.add({ a: at(s[i - 1] as [number, number]), b: at(s[i] as [number, number]), z: z + 0.0008, halfWidth: half, ink, alpha: a });
    }
  }
}

function routeStrokes(out: Strokes, r: ShownRoute, env: StrokeEnv): void {
  const a = eased(r.show);
  if (a <= 0) return;
  const line = smoothLine(r.hexes.map(h => env.centreOf(h)), CUE.routeCorner);
  // Points that fall together (a path that names a hex twice) would give a stroke no direction: they are left out.
  const pts: [number, number][] = [];
  for (const p of line) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-4) pts.push(p);
  }
  const dir = (i: number): [number, number] => {
    const p = pts[i] as [number, number];
    const q = pts[i + 1] as [number, number];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    return [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
  };
  for (let i = 0; i + 1 < pts.length; i++) {
    out.add({
      a: pts[i] as [number, number],
      b: pts[i + 1] as [number, number],
      z: CUE.strokeZ,
      halfWidth: CUE.routeHalfWidth,
      ink: CUE_INKS.route,
      alpha: CUE.routeAlpha * a,
      wax: CUE.routeWax,
      ...(i > 0 ? { before: dir(i - 1) } : {}),
      ...(i + 2 < pts.length ? { after: dir(i + 1) } : {}),
    });
  }
}

/** Every stroke of what is shown now, in the order it is drawn: routes, lines, then the tags over them. */
export function strokesOf(cues: Cues, env: StrokeEnv, out: Strokes): Strokes {
  out.clear();
  for (const r of cues.routes) routeStrokes(out, r, env);
  for (const l of cues.fire) lineStrokes(out, l, env);
  for (const l of cues.threats) lineStrokes(out, l, env);
  for (const l of cues.threats) tagStrokes(out, l, env);
  // The chance cards over everything else the cues draw.
  for (const c of cues.chances) if (c.at) chanceStrokes(out, c.spec, c.at, eased(c.show), env, { ...CHANCE_INKS, shadow: CUE_INKS.shadow });
  return out;
}
