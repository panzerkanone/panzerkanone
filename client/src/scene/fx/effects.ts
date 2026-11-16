/**
 * The table's effects: what each one is made of, and the clock they all run on.
 *
 * An effect is started by a call here (a gun fires from one place at another; a round arrives; a
 * counter is killed; a screen lies on a hex) and is from then on particles and patches in the
 * pools (pool.ts), each with its whole course set at birth. A short effect (a burst) is spawned
 * entire when it starts, its later parts born later on the clock. A lasting one (a burning wreck, a
 * smoke screen, the wisp over a suppressed unit) is an emitter that feeds the pool while it lasts.
 *
 * Every size, time, count and ink is a dial of tune.ts. Randomness is a hash of the scene's seed
 * and a stable number (the hexes of a shot, the hex of a kill), so a given shot looks the same
 * every time. Nothing here draws or touches the page: view.ts draws the pools. No browser.
 */
import { SCENE_SEED, hash01 } from '../hash';
import type { Manifest } from './flipbook';
import { BOOKS } from './flipbook';
import type { BookName } from './flipbook';
import { MODE_ADD, MODE_EMISSIVE, MODE_OVER, ORIENT_STRETCH, ORIENT_UPRIGHT, Pool, SHAPE_CHIP, SHAPE_GLOW, SHAPE_MUZZLE, SHAPE_STREAK } from './pool';
import type { BookInfo, Spec } from './pool';
import { linearInk } from './tune';
import type { FxTune } from './tune';
import type { FireStyle, KillStyle } from './units';

/** The effects by name, as the page's join and the hook's counts name them. */
export const EFFECT_KINDS = ['gun', 'small', 'lob', 'hit', 'dirt', 'explosion', 'blast', 'fire', 'screen', 'mission', 'dust', 'exhaust', 'wisp'] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

/** What the page is told when an effect starts, so that a sound can be put to it: which, on which hex (-1 off the board), and when (the page's clock, ms). */
export interface EffectEvent {
  kind: EffectKind;
  hex: number;
  at: number;
}

type P2 = readonly [number, number];
type Rgb = readonly [number, number, number];

const TAU = Math.PI * 2;
const EMITTERS = 64;
const NOTES = 128;
const FLASHES = 32;
const ENDS = 256;
const E_FIRE = 1;
const E_SCREEN = 2;
const E_WISP = 3;
/** Seconds in which a lasting effect's strength follows what it should be. */
const STRENGTH_TAU = 0.45;

export class Effects {
  readonly pool = new Pool();
  /** The effects' clock, in seconds. */
  now = 0;
  /** How many of each effect have started. */
  readonly started: Record<EffectKind, number>;
  /** The strength of each lasting effect, by its number, for the view. */
  readonly strength = new Float32Array(EMITTERS);
  /** The flipbooks as the view needs them (empty until the pictures have come). */
  books: BookInfo[] = [];
  /** Told when an effect starts. */
  onEffect: ((e: EffectEvent) => void) | null = null;
  /** Whether a counter stands in a hex now: a fire or a screen there is thinned so that the counter can be read. */
  occupied: (hex: number) => boolean = () => false;
  private readonly tune: FxTune;
  private bookIndex: Partial<Record<BookName, number>> = {};
  private fast = false;
  private reduced = false;
  private flat = false;
  // Lasting effects: one row each.
  private readonly eKind = new Uint8Array(EMITTERS);
  private readonly eHex = new Int32Array(EMITTERS);
  private readonly eKey = new Int32Array(EMITTERS);
  private readonly eX = new Float32Array(EMITTERS);
  private readonly eY = new Float32Array(EMITTERS);
  private readonly eBorn = new Float64Array(EMITTERS);
  private readonly eStop = new Float64Array(EMITTERS);
  private readonly eEnd = new Float64Array(EMITTERS);
  private readonly eNext = new Float64Array(EMITTERS * 3);
  private readonly eCount = new Uint32Array(EMITTERS);
  private readonly eScale = new Float32Array(EMITTERS);
  private readonly eSeed = new Float64Array(EMITTERS);
  private readonly eSaid = new Uint8Array(EMITTERS);
  /** Whether it has laid what it lays once (a fire's light and soot; a screen's first gathering). */
  private readonly eLaid = new Uint8Array(EMITTERS);
  /** Counts the dust and exhaust puffs, so that no two are alike. */
  private serial = 0;
  // What is to be said to the page, when its time comes.
  private readonly nAt = new Float64Array(NOTES);
  private readonly nKind = new Uint8Array(NOTES);
  private readonly nHex = new Int32Array(NOTES);
  private notes = 0;
  // The bright flashes of the last moments, and those to come.
  private readonly flashes = new Float64Array(FLASHES);
  private flashCount = 0;
  // When each short effect alive now ends.
  private readonly ends = new Float64Array(ENDS);
  private endCount = 0;
  private until = 0;

  /** The air over the table, h a second on the plan. */
  private readonly wind: readonly [number, number];

  constructor(tune: FxTune) {
    this.tune = tune;
    this.wind = [tune.all.wind[0] ?? 0, tune.all.wind[1] ?? 0];
    this.started = Object.fromEntries(EFFECT_KINDS.map(k => [k, 0])) as Record<EffectKind, number>;
    this.strength.fill(1);
  }

  /** The pictures have come: flipbooks are drawn from now on. */
  setArt(manifest: Manifest): void {
    this.books = manifest.flipbooks.map(book => {
      const sheet = manifest.atlases[book.atlas] as { width: number; height: number };
      return { book, sheet, cw: book.cell[0] / sheet.width, ch: book.cell[1] / sheet.height };
    });
    this.bookIndex = {};
    for (const name of BOOKS) this.bookIndex[name] = manifest.flipbooks.findIndex(b => b.id === name);
  }

  /** How the effects are cut down: `fast` (the game is played back fast), `reduced` (the viewer asks for less motion), `flat` (the flat tier). */
  setMode(mode: { fast?: boolean; reduced?: boolean; flat?: boolean }): void {
    if (mode.fast !== undefined) this.fast = mode.fast;
    if (mode.reduced !== undefined) this.reduced = mode.reduced;
    if (mode.flat !== undefined) this.flat = mode.flat;
  }

  /** How much faster than the page's clock the effects' clock runs. */
  get speed(): number {
    return this.tune.all.speed * (this.fast ? this.tune.all.fastSpeed : 1);
  }

  /** Seconds (the page's) a killed counter is held under its blast before it leaves. */
  get hold(): number {
    return Math.min(0.4, this.tune.kill.holdS * (this.fast ? this.tune.all.fastHold : 1));
  }

  /** Short effects alive now, and lasting ones. */
  get bursts(): number {
    return this.endCount;
  }

  get lasting(): number {
    let n = 0;
    for (let i = 0; i < EMITTERS; i++) if (this.eKind[i] !== 0) n++;
    return n;
  }

  /** The bright flashes that have been let through, as seconds of the effects' clock (the last few, and those still to come). */
  flashTimes(): number[] {
    return Array.from(this.flashes.subarray(0, this.flashCount)).sort((a, b) => a - b);
  }

  // ---- arithmetic the recipes share ---------------------------------------------------------------

  private rnd(seed: number, k: number): number {
    return hash01(SCENE_SEED, 'fx', seed * 613 + k);
  }

  private many(base: number): number {
    const share = this.tune.all.count * (this.reduced ? this.tune.all.reducedCount : 1) * (this.flat ? this.tune.all.flatCount : 1);
    return Math.max(1, Math.round(base * share));
  }

  private get lastingShare(): number {
    return (this.fast ? this.tune.all.fastLasting : 1) * (this.reduced ? this.tune.all.reducedLasting : 1);
  }

  private grey(v: number): Rgb {
    const warm = this.tune.all.smokeWarm;
    return linearInk([v * (warm[0] ?? 1), v, v * (warm[1] ?? 1)]);
  }

  /**
   * A bright flash at `t` is let through whole only while there are fewer than the limit within a
   * second either side of it; one too many, and every flash for a viewer who asks for less motion,
   * is drawn dim. Returns the share of its light it is drawn with.
   */
  private flash(t: number): number {
    const all = this.tune.all;
    if (this.reduced) return all.reducedFlash * all.bright;
    let near = 0;
    let kept = 0;
    for (let i = 0; i < this.flashCount; i++) {
      const at = this.flashes[i] as number;
      if (at < this.now - 2 && at < t - 2) continue;
      this.flashes[kept++] = at;
      if (Math.abs(at - t) < 1) near++;
    }
    this.flashCount = kept;
    if (near >= all.flashesPerSecond || kept >= FLASHES) return all.dimFlash * all.bright;
    this.flashes[this.flashCount++] = t;
    return all.bright;
  }

  private put(s: Spec): void {
    if (this.pool.add(s) && s.burst) this.until = Math.max(this.until, s.born + s.life);
  }

  private say(kind: EffectKind, hex: number, at: number): void {
    if (this.notes >= NOTES) return;
    this.nAt[this.notes] = at;
    this.nKind[this.notes] = EFFECT_KINDS.indexOf(kind);
    this.nHex[this.notes] = hex;
    this.notes++;
    this.until = Math.max(this.until, at);
  }

  private begin(): void {
    this.until = this.now;
  }

  private done(): void {
    if (this.endCount < ENDS) this.ends[this.endCount++] = this.until;
  }

  private book(name: BookName): number {
    // With no pictures a flipbook's place is taken by the shader's own puff (the pool sees to it), so whichever number is given here will do.
    return this.bookIndex[name] ?? 0;
  }

  private rate(name: BookName): number {
    const i = this.bookIndex[name];
    return i === undefined ? 12 : (this.books[i] as BookInfo).book.rate;
  }

  private frames(name: BookName): number {
    const i = this.bookIndex[name];
    return i === undefined ? 1 : (this.books[i] as BookInfo).book.frames;
  }

  private aspect(name: BookName): number {
    const i = this.bookIndex[name];
    if (i === undefined) return 1;
    const b = (this.books[i] as BookInfo).book;
    return b.cell[1] / b.cell[0];
  }

  /** A soft round light in the air. */
  private glow(t: number, x: number, y: number, z: number, size: number, life: number, ink: Rgb, alpha: number, burst = true, emitter = -1): void {
    const s = this.pool.spec();
    s.kind = SHAPE_GLOW;
    s.born = t;
    s.life = life;
    s.x = x;
    s.y = y;
    s.z = z;
    s.size0 = size * 0.7;
    s.size1 = size;
    s.sizePow = 3;
    s.fadeIn = 0.12;
    s.fadeOut = 0.75;
    s.alpha = alpha;
    s.ink(ink);
    s.opacity = 0;
    s.lit = 0;
    s.layer = 0.5;
    s.burst = burst;
    s.emitter = emitter;
    this.put(s);
  }

  /** Light thrown on the board for a moment. */
  private light(t: number, x: number, y: number, reach: number, ink: Rgb, strength: number, life: number, height = 0.6): void {
    const p = this.pool.patch();
    p.born = t;
    p.life = life;
    p.x = x;
    p.y = y;
    p.reach = reach * this.tune.all.size;
    p.height = height;
    p.r = ink[0] * strength;
    p.g = ink[1] * strength;
    p.b = ink[2] * strength;
    p.fadeIn = 0.1;
    p.fadeOut = 0.9;
    p.pow = 1.7;
    if (this.pool.addPatch(p)) this.until = Math.max(this.until, t + life);
  }

  /** A puff of smoke or dust from one of the smoke flipbooks, in the table's light. */
  private smokePuff(name: BookName, seed: number, k: number, t: number, x: number, y: number, z: number, size0: number, size1: number, life: number, alpha: number, ink: Rgb): Spec {
    const s = this.pool.spec();
    s.kind = this.book(name);
    s.mode = MODE_OVER;
    s.born = t;
    s.life = life;
    s.x = x;
    s.y = y;
    s.z = z;
    s.size0 = size0;
    s.size1 = size1;
    s.sizePow = 2.2;
    s.fadeIn = 0.1;
    s.fadeOut = 0.62;
    s.alpha = alpha;
    s.ink(ink);
    s.rot = this.rnd(seed, k + 1) * TAU;
    s.spin = (this.rnd(seed, k + 2) - 0.5) * 0.5;
    s.frame0 = this.rnd(seed, k + 3) * this.frames(name);
    s.fps = this.rate(name) * 0.5;
    s.flip = this.rnd(seed, k + 4) < 0.5 ? -1 : 1;
    s.shadow = 0.6;
    s.seed = this.rnd(seed, k + 5);
    return s;
  }

  /** Sparks: short bright streaks thrown out and pulled down. `bx, by` leans them one way on the plan (0, 0 for all round). */
  private sparks(seed: number, t: number, x: number, y: number, z: number, n: number, speed: number, life: number, length: number, width: number, hot: Rgb, cool: Rgb, bx: number, by: number): void {
    for (let i = 0; i < n; i++) {
      const k = 100 + i * 7;
      const turn = bx === 0 && by === 0 ? this.rnd(seed, k) * TAU : Math.atan2(by, bx) + (this.rnd(seed, k) - 0.5) * 2.6;
      const lift = (0.15 + 0.75 * this.rnd(seed, k + 1)) * (Math.PI / 2);
      const v = speed * (0.35 + 0.9 * this.rnd(seed, k + 2));
      const s = this.pool.spec();
      s.kind = SHAPE_STREAK;
      s.orient = ORIENT_STRETCH;
      s.born = t + this.rnd(seed, k + 3) * 0.03;
      s.life = life * (0.5 + 0.8 * this.rnd(seed, k + 4));
      s.x = x;
      s.y = y;
      s.z = z;
      s.vx = Math.cos(turn) * Math.cos(lift) * v;
      s.vy = Math.sin(turn) * Math.cos(lift) * v;
      s.vz = Math.sin(lift) * v;
      s.drag = 1.3;
      s.grav = -12;
      s.floor = 0.03;
      s.len = length * (0.6 + 0.8 * this.rnd(seed, k + 5));
      s.size0 = width;
      s.size1 = width * 0.5;
      s.fadeIn = 0.03;
      s.fadeOut = 0.55;
      s.r0 = hot[0];
      s.g0 = hot[1];
      s.b0 = hot[2];
      s.r1 = cool[0];
      s.g1 = cool[1];
      s.b1 = cool[2];
      s.opacity = 0.75;
      s.lit = 0;
      s.layer = 0.2;
      this.put(s);
    }
  }

  /** Clods and bits of wreck: small dark things thrown up that fall back, each with its shadow. */
  private chips(seed: number, t: number, x: number, y: number, n: number, speed: number, size: number, ink: Rgb): void {
    for (let i = 0; i < n; i++) {
      const k = 300 + i * 7;
      const turn = this.rnd(seed, k) * TAU;
      const lift = (0.45 + 0.45 * this.rnd(seed, k + 1)) * (Math.PI / 2);
      const v = speed * (0.45 + 0.8 * this.rnd(seed, k + 2));
      const vz = Math.sin(lift) * v;
      const grav = -13;
      const s = this.pool.spec();
      s.kind = SHAPE_CHIP;
      s.born = t;
      // Until it is back on the ground, and a moment lying there.
      s.life = (2 * vz) / -grav + 0.12;
      s.x = x;
      s.y = y;
      s.z = 0.08;
      s.vx = Math.cos(turn) * Math.cos(lift) * v;
      s.vy = Math.sin(turn) * Math.cos(lift) * v;
      s.vz = vz;
      s.grav = grav;
      s.floor = 0.03;
      s.size0 = s.size1 = size * (0.6 + 0.9 * this.rnd(seed, k + 3));
      s.rot = this.rnd(seed, k + 4) * TAU;
      s.spin = (this.rnd(seed, k + 5) - 0.5) * 26;
      s.fadeIn = 0.03;
      s.fadeOut = 0.14;
      s.ink(ink);
      s.shadow = 0.7;
      s.seed = this.rnd(seed, k + 6);
      this.put(s);
    }
  }

  // ---- fire ----------------------------------------------------------------------------------------

  /**
   * A unit fires from one place at another, `delay` seconds from now, and (unless `arrival` is
   * false) its fire arrives: a gun's round on armour strikes sparks on the counter's near edge, on
   * soft ground it throws up dirt beside the counter; a lobbed round bursts on its hex; small arms
   * kick up the ground where each round lands. Returns when it arrives (seconds from now) and where.
   */
  fire(style: FireStyle, from: P2, to: P2, fromHex: number, toHex: number, armour: boolean, delay: number, arrival = true): { after: number; at: [number, number] } {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const dist = Math.hypot(dx, dy);
    const ux = dist > 1e-6 ? dx / dist : 1;
    const uy = dist > 1e-6 ? dy / dist : 0;
    const seed = fromHex * 4099 + toHex * 7 + 11;
    const S = this.tune.all.size;
    const side = this.rnd(seed, 1) < 0.5 ? -1 : 1;
    const at: [number, number] = armour
      ? [to[0] - ux * this.tune.hit.edge * S, to[1] - uy * this.tune.hit.edge * S]
      : [to[0] - uy * side * this.tune.dirt.beside * S - ux * 0.12, to[1] + ux * side * this.tune.dirt.beside * S - uy * 0.12];
    if (style === 'none') return { after: delay, at };
    this.begin();
    const t0 = this.now + delay;
    let after = delay;
    this.say(style, fromHex, t0);
    if (style === 'gun') {
      after = delay + this.gun(seed, t0, from, at, ux, uy);
      if (arrival) {
        if (armour) this.hit(seed + 3, this.now + after, at, [ux, uy]);
        else this.dirt(seed + 3, this.now + after, at, 1, true);
        this.say(armour ? 'hit' : 'dirt', toHex, this.now + after);
      }
    } else if (style === 'small') after = delay + this.smallArms(seed, t0, from, at, ux, uy, armour);
    else {
      after = delay + this.lob(seed, t0, from, to, ux, uy, dist);
      if (arrival) {
        this.blastAt(seed + 5, this.now + after, to, 0.8);
        this.say('blast', toHex, this.now + after);
      }
    }
    this.done();
    return { after, at };
  }

  private gun(seed: number, t0: number, from: P2, at: P2, ux: number, uy: number): number {
    const T = this.tune.gun;
    const S = this.tune.all.size;
    const mx = from[0] + ux * T.barrel * S;
    const my = from[1] + uy * T.barrel * S;
    const mz = T.height;
    const shine = this.flash(t0);
    const ink = linearInk(T.flashInk);
    // The flash along the barrel, and the two short ones a muzzle brake throws to the sides.
    const blade = (ax: number, ay: number, length: number, width: number): void => {
      const s = this.pool.spec();
      s.kind = SHAPE_MUZZLE;
      s.orient = ORIENT_STRETCH;
      s.born = t0;
      s.life = T.flashS;
      s.x = mx + ax * length;
      s.y = my + ay * length;
      s.z = mz;
      s.ax = ax;
      s.ay = ay;
      s.len = length;
      s.size0 = width * 0.8;
      s.size1 = width;
      s.fadeIn = 0.1;
      s.fadeOut = 0.6;
      s.alpha = Math.min(1, shine);
      s.ink(ink);
      s.opacity = 0.55;
      s.lit = 0;
      s.layer = 0.3;
      s.seed = this.rnd(seed, 20 + Math.round(ax * 10));
      this.put(s);
    };
    blade(ux, uy, T.flash * S, T.flash * S * 0.46);
    if (T.brake > 0) {
      const c = Math.cos(1.36);
      const sn = Math.sin(1.36);
      blade(ux * c - uy * sn, ux * sn + uy * c, T.flash * S * T.brake, T.flash * S * 0.24);
      blade(ux * c + uy * sn, -ux * sn + uy * c, T.flash * S * T.brake, T.flash * S * 0.24);
    }
    this.glow(t0, mx + ux * 0.12, my + uy * 0.12, mz, T.flash * S, T.flashS * 1.3, ink, 0.75 * shine);
    this.light(t0, mx, my, T.lightReach, linearInk(T.lightInk), T.light * shine, T.lightS);
    // The puff that hangs, thrown forward and then left to the air.
    const wind = this.wind;
    const grey = this.grey(T.puffGrey);
    const n = this.many(T.puffs);
    for (let i = 0; i < n; i++) {
      const k = 40 + i * 9;
      const r = this.rnd(seed, k);
      const s = this.smokePuff('smoke', seed, k, t0 + 0.012 + i * 0.014, mx + ux * (0.08 + 0.2 * r), my + uy * (0.08 + 0.2 * r), mz + 0.04, 0.2 * S, T.puff * S * (0.7 + 0.55 * this.rnd(seed, k + 6)), T.puffS * (0.75 + 0.5 * this.rnd(seed, k + 7)), T.puffAlpha, grey);
      const lateral = (this.rnd(seed, k + 8) - 0.5) * 1.1;
      const go = T.puffThrow * (0.35 + 0.85 * r);
      s.vx = ux * go - uy * lateral;
      s.vy = uy * go + ux * lateral;
      s.vz = 0.25 + 0.3 * this.rnd(seed, k + 9);
      s.drag = 3.4;
      s.tx = wind[0] * (0.6 + 0.5 * r);
      s.ty = wind[1] * (0.6 + 0.5 * r);
      s.tz = 0.1;
      s.fadeIn = 0.05;
      s.warm = 0.5 * shine;
      this.put(s);
    }
    // Dust off the ground under the muzzle.
    if (T.dustAlpha > 0) {
      const s = this.smokePuff('cloud', seed, 90, t0 + 0.02, mx + ux * 0.35, my + uy * 0.35, 0.1, 0.35 * S, T.dust * S, 1.3, T.dustAlpha, linearInk(this.tune.dust.ink));
      s.vx = ux * 1.3;
      s.vy = uy * 1.3;
      s.drag = 3;
      s.tx = wind[0] * 0.4;
      s.ty = wind[1] * 0.4;
      s.floor = 0.08;
      s.shadow = 0.25;
      this.put(s);
    }
    // The shell.
    const tz = 0.16;
    const way = Math.hypot(at[0] - mx, at[1] - my, tz - mz);
    const flight = Math.max(0.02, way / T.shellSpeed);
    const s = this.pool.spec();
    s.kind = SHAPE_STREAK;
    s.orient = ORIENT_STRETCH;
    s.born = t0 + 0.012;
    s.life = flight;
    s.x = mx;
    s.y = my;
    s.z = mz;
    s.vx = (at[0] - mx) / flight;
    s.vy = (at[1] - my) / flight;
    s.vz = (tz - mz) / flight;
    s.len = T.shellLength * S;
    s.size0 = s.size1 = T.shellWidth * S;
    s.fadeIn = 0.02;
    s.fadeOut = 0.04;
    s.ink(linearInk(T.shellInk));
    s.opacity = 0.85;
    s.lit = 0;
    s.layer = 0.4;
    this.put(s);
    return 0.012 + flight;
  }

  private smallArms(seed: number, t0: number, from: P2, at: P2, ux: number, uy: number, armour: boolean): number {
    const T = this.tune.small;
    const S = this.tune.all.size;
    const mx = from[0] + ux * T.barrel * S;
    const my = from[1] + uy * T.barrel * S;
    const mz = T.height;
    const rounds = Math.max(3, this.many(T.rounds));
    const run = rounds * T.gapS;
    const shine = this.flash(t0);
    const ink = linearInk(T.ink);
    // One steady glow at the muzzle for the length of the run: tracers carry the rhythm, never a flicker of light.
    {
      const s = this.pool.spec();
      s.kind = SHAPE_GLOW;
      s.born = t0;
      s.life = run + 0.1;
      s.x = mx;
      s.y = my;
      s.z = mz;
      s.size0 = s.size1 = T.glow * S;
      s.fadeIn = 0.18;
      s.fadeOut = 0.35;
      s.alpha = T.glowAlpha * shine;
      s.ink(ink);
      s.opacity = 0;
      s.lit = 0;
      s.layer = 0.3;
      this.put(s);
    }
    this.light(t0, mx, my, 1.2, ink, 0.3 * shine, run + 0.15);
    const wind = this.wind;
    const dustInk = linearInk(this.tune.dust.ink);
    let middle = 0;
    for (let i = 0; i < rounds; i++) {
      const k = 30 + i * 11;
      const born = t0 + i * T.gapS;
      const a = this.rnd(seed, k) * TAU;
      const r = Math.sqrt(this.rnd(seed, k + 1)) * T.scatter * S;
      const lx = at[0] + Math.cos(a) * r;
      const ly = at[1] + Math.sin(a) * r;
      const jitter = (this.rnd(seed, k + 2) - 0.5) * 0.1;
      const sx = mx - uy * jitter;
      const sy = my + ux * jitter;
      const way = Math.hypot(lx - sx, ly - sy);
      const flight = Math.max(0.02, way / T.speed);
      const s = this.pool.spec();
      s.kind = SHAPE_STREAK;
      s.orient = ORIENT_STRETCH;
      s.born = born;
      s.life = flight;
      s.x = sx;
      s.y = sy;
      s.z = mz;
      s.vx = (lx - sx) / flight;
      s.vy = (ly - sy) / flight;
      s.vz = (0.1 - mz) / flight;
      s.len = T.length * S;
      s.size0 = s.size1 = T.width * S;
      s.fadeIn = 0.03;
      s.fadeOut = 0.06;
      s.ink(ink);
      s.opacity = 0.85;
      s.lit = 0;
      s.layer = 0.3;
      this.put(s);
      if (i === Math.floor(rounds / 2)) middle = i * T.gapS + flight;
      // Where it lands: sparks off armour, a kick of dust off the ground.
      if (armour) this.sparks(seed + i * 17, born + flight, lx, ly, 0.14, 3, 3.2, 0.3, 0.14, 0.02, ink, linearInk(this.tune.hit.sparkCool), -ux, -uy);
      else {
        const p = this.smokePuff('cloud', seed, k + 3, born + flight, lx, ly, 0.08, 0.1 * S, T.kick * S, 0.75, T.kickAlpha, dustInk);
        p.vz = 0.5;
        p.drag = 3;
        p.tx = wind[0] * 0.5;
        p.ty = wind[1] * 0.5;
        p.floor = 0.06;
        p.shadow = 0.2;
        this.put(p);
        this.chips(seed + i * 17, born + flight, lx, ly, 2, 2.2, 0.03, linearInk(this.tune.dirt.clodInk));
      }
    }
    const grey = this.grey(170);
    const puffs = this.many(T.puffs);
    for (let i = 0; i < puffs; i++) {
      const k = 200 + i * 9;
      const s = this.smokePuff('smoke', seed, k, t0 + (i / puffs) * run, mx, my, mz, 0.1 * S, T.puff * S * (0.7 + 0.6 * this.rnd(seed, k + 6)), T.puffS, T.puffAlpha, grey);
      s.vx = ux * 0.9;
      s.vy = uy * 0.9;
      s.vz = 0.25;
      s.drag = 3;
      s.tx = wind[0];
      s.ty = wind[1];
      s.tz = 0.08;
      s.shadow = 0.3;
      this.put(s);
    }
    return middle;
  }

  private lob(seed: number, t0: number, from: P2, to: P2, ux: number, uy: number, dist: number): number {
    const T = this.tune.lob;
    const S = this.tune.all.size;
    const shine = this.flash(t0);
    const ink = linearInk(this.tune.gun.flashInk);
    this.glow(t0, from[0], from[1], 0.3, T.flash * S, 0.1, ink, 0.8 * shine);
    this.light(t0, from[0], from[1], 1.4, linearInk(this.tune.gun.lightInk), 0.5 * shine, 0.14);
    // The thump: smoke thrown up out of the tube, and a ring of dust.
    const wind = this.wind;
    const grey = this.grey(176);
    const n = this.many(T.puffs);
    for (let i = 0; i < n; i++) {
      const k = 40 + i * 9;
      const a = this.rnd(seed, k) * TAU;
      const s = this.smokePuff('smoke', seed, k, t0 + 0.01 + i * 0.02, from[0], from[1], 0.2, 0.2 * S, T.puff * S * (0.7 + 0.5 * this.rnd(seed, k + 6)), T.puffS * (0.75 + 0.5 * this.rnd(seed, k + 7)), T.puffAlpha, grey);
      s.vx = Math.cos(a) * 0.5 + ux * 0.4;
      s.vy = Math.sin(a) * 0.5 + uy * 0.4;
      s.vz = 2.4 * (0.4 + 0.7 * this.rnd(seed, k + 8));
      s.drag = 2.6;
      s.tx = wind[0];
      s.ty = wind[1];
      s.tz = 0.16;
      s.fadeIn = 0.06;
      this.put(s);
    }
    {
      const s = this.smokePuff('cloud', seed, 95, t0 + 0.02, from[0], from[1], 0.1, 0.4 * S, 1.3 * S, 1.2, 0.18, linearInk(this.tune.dust.ink));
      s.floor = 0.08;
      s.shadow = 0.2;
      this.put(s);
    }
    // The round: up, over, and down on its target.
    const flight = T.flightS + T.flightPerH * dist;
    const apex = T.apex * S;
    const z0 = 0.3;
    const z1 = 0.12;
    const grav = (-8 * apex) / (flight * flight);
    const s = this.pool.spec();
    s.kind = SHAPE_STREAK;
    s.orient = ORIENT_STRETCH;
    s.born = t0 + 0.03;
    s.life = flight;
    s.x = from[0];
    s.y = from[1];
    s.z = z0;
    s.vx = (to[0] - from[0]) / flight;
    s.vy = (to[1] - from[1]) / flight;
    s.vz = (z1 - z0) / flight - 0.5 * grav * flight;
    s.grav = grav;
    s.len = 0.42 * S;
    s.size0 = s.size1 = T.round * S;
    s.fadeIn = 0.06;
    s.fadeOut = 0.04;
    s.ink(this.grey(46));
    s.opacity = 1;
    s.lit = 0;
    s.shadow = 0.9;
    this.put(s);
    // A thin trail left behind it on the way up.
    if (T.trailAlpha > 0) {
      const trail = this.many(5);
      for (let i = 0; i < trail; i++) {
        const u = 0.04 + (0.32 * i) / trail;
        const tt = u * flight;
        const p = this.smokePuff('wisp', seed, 400 + i * 9, t0 + 0.03 + tt, from[0] + s.vx * tt, from[1] + s.vy * tt, z0 + s.vz * tt + 0.5 * grav * tt * tt, 0.1 * S, 0.45 * S, 1.3, T.trailAlpha, grey);
        p.tx = wind[0];
        p.ty = wind[1];
        p.shadow = 0.25;
        this.put(p);
      }
    }
    return 0.03 + flight;
  }

  // ---- arrival -------------------------------------------------------------------------------------

  /** A round arrives: on armour (a flash and sparks, thrown back the way it came) or on soft ground (dirt and smoke). `toward` is the way the round was flying. */
  arrive(what: 'hit' | 'dirt', at: P2, toward: P2, hex: number, delay: number): void {
    this.begin();
    const t = this.now + delay;
    const seed = hex * 31 + Math.round(at[0] * 53) + Math.round(at[1] * 97) + (what === 'hit' ? 5 : 9);
    if (what === 'hit') this.hit(seed, t, at, toward);
    else this.dirt(seed, t, at, 1, true);
    this.say(what, hex, t);
    this.done();
  }

  private hit(seed: number, t: number, at: P2, toward: P2): void {
    const T = this.tune.hit;
    const S = this.tune.all.size;
    const shine = this.flash(t);
    const z = 0.16;
    this.glow(t, at[0], at[1], z, T.flash * S, T.flashS, linearInk(T.flashInk), shine);
    this.light(t, at[0], at[1], T.lightReach, linearInk(T.flashInk), T.light * shine, T.lightS);
    this.sparks(seed, t, at[0], at[1], z, this.many(T.sparks), T.sparkSpeed * S, T.sparkS, T.sparkLength * S, T.sparkWidth * S, linearInk(T.sparkInk), linearInk(T.sparkCool), -toward[0], -toward[1]);
    const wind = this.wind;
    const grey = this.grey(118);
    for (let i = 0; i < 2; i++) {
      const k = 60 + i * 9;
      const s = this.smokePuff('smoke', seed, k, t + 0.02 + i * 0.03, at[0], at[1], z, 0.16 * S, T.puff * S * (0.75 + 0.5 * this.rnd(seed, k + 6)), T.puffS * (0.8 + 0.4 * i), T.puffAlpha, grey);
      s.vx = -toward[0] * 0.9;
      s.vy = -toward[1] * 0.9;
      s.vz = 0.55;
      s.drag = 2.6;
      s.tx = wind[0] * 0.8;
      s.ty = wind[1] * 0.8;
      s.tz = 0.14;
      s.shadow = 0.4;
      s.warm = 0.4 * shine;
      this.put(s);
    }
  }

  private dirt(seed: number, t: number, at: P2, scale: number, flash: boolean): void {
    const T = this.tune.dirt;
    const S = this.tune.all.size * scale;
    const wind = this.wind;
    const earth = linearInk(T.ink);
    if (flash) {
      const shine = this.flash(t);
      this.glow(t, at[0], at[1], 0.15, T.flash * S, 0.08, linearInk(this.tune.hit.flashInk), 0.6 * shine);
    }
    // The burst itself: earth thrown up, played once.
    {
      const s = this.pool.spec();
      s.kind = this.book('burst');
      s.mode = MODE_OVER;
      s.born = t;
      s.life = T.burstS;
      s.x = at[0];
      s.y = at[1];
      s.z = T.size * S * 0.3;
      s.vz = 0.25;
      s.tx = wind[0] * 0.5;
      s.ty = wind[1] * 0.5;
      s.drag = 1.5;
      s.size0 = T.size * S * 0.8;
      s.size1 = T.size * S;
      s.sizePow = 3;
      s.fadeIn = 0.04;
      s.fadeOut = 0.5;
      s.alpha = T.alpha;
      s.ink(earth);
      s.rot = (this.rnd(seed, 1) - 0.5) * 0.9;
      s.flip = this.rnd(seed, 2) < 0.5 ? -1 : 1;
      s.shadow = 0.7;
      s.seed = this.rnd(seed, 3);
      this.put(s);
    }
    this.chips(seed, t, at[0], at[1], this.many(T.clods), T.clodSpeed * Math.sqrt(scale), T.clod * S, linearInk(T.clodInk));
    for (let i = 0; i < 2; i++) {
      const k = 70 + i * 9;
      const a = this.rnd(seed, k) * TAU;
      const s = this.smokePuff('cloud', seed, k, t + 0.05 + i * 0.05, at[0], at[1], 0.14, 0.45 * S, T.dust * S * (0.8 + 0.4 * this.rnd(seed, k + 6)), T.dustS * (0.8 + 0.4 * this.rnd(seed, k + 7)), T.dustAlpha, earth);
      s.vx = Math.cos(a) * 0.5;
      s.vy = Math.sin(a) * 0.5;
      s.drag = 2;
      s.tx = wind[0] * 0.6;
      s.ty = wind[1] * 0.6;
      s.floor = 0.1;
      s.shadow = 0.3;
      this.put(s);
    }
  }

  // ---- a kill --------------------------------------------------------------------------------------

  /** A counter is killed at a place: by its kind a fireball and then a burning wreck, or a blast of high explosive. */
  kill(style: KillStyle, at: P2, hex: number, delay: number, scale = 1): void {
    this.begin();
    const t = this.now + delay;
    const seed = hex * 131 + 17;
    if (style === 'burn') {
      this.explosion(seed, t, at, scale);
      this.say('explosion', hex, t);
      this.done();
      this.fireAt(hex, at, delay + this.tune.fire.startS, scale);
    } else {
      this.blastAt(seed, t, at, scale);
      this.say('blast', hex, t);
      this.done();
    }
  }

  /** The fireball of a kill by itself, with no wreck left burning. */
  explode(at: P2, hex: number, delay: number, scale = 1): void {
    this.begin();
    const t = this.now + delay;
    this.explosion(hex * 131 + 17, t, at, scale);
    this.say('explosion', hex, t);
    this.done();
  }

  /** A blast of high explosive at a place (an arriving shell). */
  blast(at: P2, hex: number, delay: number, scale = 1): void {
    this.begin();
    const t = this.now + delay;
    this.blastAt(hex * 211 + Math.round(at[0] * 61) + Math.round(at[1] * 89) + 3, t, at, scale);
    this.say('blast', hex, t);
    this.done();
  }

  private explosion(seed: number, t: number, at: P2, scale: number): void {
    const T = this.tune.kill;
    const S = this.tune.all.size * scale;
    const wind = this.wind;
    const shine = this.flash(t);
    const x = at[0];
    const y = at[1];
    const zc = T.height * S;
    this.glow(t, x, y, zc * 0.8, T.flash * S, T.flashS, linearInk(T.flashInk), shine);
    this.light(t, x, y, T.lightReach * scale, linearInk(T.glow), T.light * shine, T.lightS, 1.0);
    // The fireball: played once, standing on the board, lifting a little as it turns to smoke.
    {
      const s = this.pool.spec();
      s.kind = this.book('explosion');
      s.mode = MODE_EMISSIVE;
      s.born = t;
      s.life = T.ballS;
      s.x = x;
      s.y = y;
      s.z = zc;
      s.vz = 0.35;
      s.drag = 1.2;
      s.tx = wind[0] * 0.7;
      s.ty = wind[1] * 0.7;
      s.tz = 0.2;
      s.size0 = T.size * S * 0.82;
      s.size1 = T.size * S;
      s.sizePow = 2.5;
      s.fadeIn = 0.02;
      s.fadeOut = 0.52;
      s.rot = (this.rnd(seed, 1) - 0.5) * 0.8;
      s.flip = this.rnd(seed, 2) < 0.5 ? -1 : 1;
      s.gain = T.gain;
      s.shadow = 1;
      s.seed = this.rnd(seed, 3);
      this.put(s);
    }
    // Burning pieces thrown out.
    const embers = this.many(T.embers);
    for (let i = 0; i < embers; i++) {
      const k = 20 + i * 9;
      const a = this.rnd(seed, k) * TAU;
      const v = T.emberSpeed * (0.5 + 0.8 * this.rnd(seed, k + 1));
      const s = this.pool.spec();
      s.kind = this.book('fireball');
      s.mode = MODE_ADD;
      s.born = t + 0.02;
      s.life = T.emberS * (0.7 + 0.6 * this.rnd(seed, k + 2));
      s.x = x;
      s.y = y;
      s.z = zc * 0.6;
      s.vx = Math.cos(a) * v;
      s.vy = Math.sin(a) * v;
      s.vz = 1.4 + 1.8 * this.rnd(seed, k + 3);
      s.drag = 2.2;
      s.grav = -6;
      s.floor = 0.12;
      s.size0 = T.ember * S;
      s.size1 = T.ember * S * 0.3;
      s.fadeIn = 0.05;
      s.fadeOut = 0.5;
      s.alpha = 0.95;
      s.ink(linearInk(this.tune.fire.ballInk));
      s.opacity = 0.6;
      s.gain = 1.6;
      s.lit = 0;
      s.rot = this.rnd(seed, k + 4) * TAU;
      s.frame0 = this.rnd(seed, k + 5) * this.frames('fireball');
      s.fps = this.rate('fireball');
      s.layer = 0.2;
      this.put(s);
    }
    this.sparks(seed, t, x, y, zc * 0.5, this.many(T.sparks), T.sparkSpeed * Math.sqrt(scale), T.sparkS, this.tune.hit.sparkLength * S * 1.3, this.tune.hit.sparkWidth * S * 1.2, linearInk(this.tune.hit.sparkInk), linearInk(this.tune.hit.sparkCool), 0, 0);
    this.chips(seed, t + 0.02, x, y, this.many(T.debris), T.debrisSpeed * Math.sqrt(scale), T.chip * S, this.grey(22));
    // Smoke rolling out low, lit from under by the fire.
    const dark = this.grey(this.tune.fire.smokeGrey + 8);
    const roll = this.many(T.roll);
    for (let i = 0; i < roll; i++) {
      const k = 500 + i * 9;
      const a = (i / roll + this.rnd(seed, k) * 0.12) * TAU;
      const s = this.smokePuff('smoke', seed, k, t + 0.1 + i * 0.02, x + Math.cos(a) * 0.25 * S, y + Math.sin(a) * 0.25 * S, 0.34 * S, 0.5 * S, T.rollSize * S * (0.8 + 0.5 * this.rnd(seed, k + 6)), T.rollS * (0.8 + 0.5 * this.rnd(seed, k + 7)), T.rollAlpha, dark);
      const v = 1.7 * (0.6 + 0.8 * this.rnd(seed, k + 8));
      s.vx = Math.cos(a) * v;
      s.vy = Math.sin(a) * v;
      s.vz = 0.3;
      s.drag = 2.3;
      s.tx = wind[0];
      s.ty = wind[1];
      s.tz = 0.24;
      s.fadeIn = 0.14;
      s.warm = 0.9;
      s.shadow = 0.8;
      this.put(s);
    }
    // A ring of dust blown out along the ground.
    for (let i = 0; i < 3; i++) {
      const k = 700 + i * 9;
      const a = (i / 3 + this.rnd(seed, k) * 0.2) * TAU;
      const s = this.smokePuff('cloud', seed, k, t + 0.03, x + Math.cos(a) * 0.3, y + Math.sin(a) * 0.3, 0.12, 0.7 * S, 2.3 * S, 0.95, 0.15, linearInk(this.tune.dust.ink));
      s.sizePow = 3;
      s.vx = Math.cos(a) * 1.4;
      s.vy = Math.sin(a) * 1.4;
      s.drag = 2.5;
      s.floor = 0.1;
      s.shadow = 0.2;
      this.put(s);
    }
  }

  private blastAt(seed: number, t: number, at: P2, scale: number): void {
    const T = this.tune.blast;
    const S = this.tune.all.size * scale;
    const wind = this.wind;
    const shine = this.flash(t);
    const x = at[0];
    const y = at[1];
    const zc = T.height * S;
    this.glow(t, x, y, zc, T.flash * S, T.flashS, linearInk(this.tune.kill.flashInk), shine);
    this.light(t, x, y, T.lightReach * scale, linearInk(this.tune.kill.glow), T.light * shine, T.lightS, 0.8);
    this.dirt(seed + 1, t, at, scale * 1.15, false);
    {
      const s = this.pool.spec();
      s.kind = this.book('blast');
      s.mode = MODE_EMISSIVE;
      s.born = t;
      s.life = T.ballS;
      s.x = x;
      s.y = y;
      s.z = zc;
      s.vz = 0.5;
      s.drag = 1.4;
      s.tx = wind[0] * 0.7;
      s.ty = wind[1] * 0.7;
      s.tz = 0.2;
      s.size0 = T.size * S * 0.8;
      s.size1 = T.size * S * 1.05;
      s.sizePow = 2.5;
      s.fadeIn = 0.02;
      s.fadeOut = 0.36;
      s.rot = (this.rnd(seed, 1) - 0.5) * 0.9;
      s.flip = this.rnd(seed, 2) < 0.5 ? -1 : 1;
      s.gain = T.gain;
      s.shadow = 0.9;
      s.seed = this.rnd(seed, 3);
      this.put(s);
    }
    this.sparks(seed, t, x, y, zc * 0.5, this.many(T.sparks), 5.2 * Math.sqrt(scale), 0.5, this.tune.hit.sparkLength * S, this.tune.hit.sparkWidth * S, linearInk(this.tune.hit.sparkInk), linearInk(this.tune.hit.sparkCool), 0, 0);
    this.chips(seed + 2, t, x, y, this.many(T.clods), 4.6 * Math.sqrt(scale), 0.05 * S, linearInk(this.tune.dirt.clodInk));
    const grey = this.grey(64);
    const n = this.many(T.puffs);
    for (let i = 0; i < n; i++) {
      const k = 500 + i * 9;
      const a = this.rnd(seed, k) * TAU;
      const s = this.smokePuff('smoke', seed, k, t + 0.12 + i * 0.05, x + Math.cos(a) * 0.2 * S, y + Math.sin(a) * 0.2 * S, 0.3 * S, 0.45 * S, T.puff * S * (0.8 + 0.4 * this.rnd(seed, k + 6)), T.puffS * (0.8 + 0.4 * this.rnd(seed, k + 7)), T.puffAlpha, grey);
      s.vx = Math.cos(a) * 0.7;
      s.vy = Math.sin(a) * 0.7;
      s.vz = 0.4;
      s.drag = 2;
      s.tx = wind[0];
      s.ty = wind[1];
      s.tz = 0.2;
      s.warm = 0.5;
      this.put(s);
    }
  }

  // ---- lasting effects -----------------------------------------------------------------------------

  private claim(kind: number, hex: number, key: number, at: P2, born: number, scale: number): number {
    for (let i = 0; i < EMITTERS; i++) {
      if (this.eKind[i] !== 0) continue;
      this.eKind[i] = kind;
      this.eHex[i] = hex;
      this.eKey[i] = key;
      this.eX[i] = at[0];
      this.eY[i] = at[1];
      this.eBorn[i] = born;
      this.eStop[i] = Infinity;
      this.eEnd[i] = Infinity;
      this.eNext[i * 3] = born;
      this.eNext[i * 3 + 1] = born;
      this.eNext[i * 3 + 2] = born;
      this.eCount[i] = 0;
      this.eScale[i] = scale;
      this.eSeed[i] = hex * 53 + key * 7 + kind * 1009;
      this.eSaid[i] = 0;
      this.eLaid[i] = 0;
      this.strength[i] = 1;
      return i;
    }
    this.pool.dropped++;
    return -1;
  }

  private find(kind: number, key: number): number {
    for (let i = 0; i < EMITTERS; i++) if (this.eKind[i] === kind && this.eKey[i] === key && this.eStop[i] === Infinity) return i;
    return -1;
  }

  /** A wreck burns at a place from `delay` seconds on: flames that dwindle, and a column of dark smoke that thins and is gone by the fire's last second. */
  fireAt(hex: number, at: P2, delay: number, scale = 1): void {
    const T = this.tune.fire;
    // One fire a hex: a second kill there feeds the fire that burns, it does not stack another on it.
    for (let i = 0; i < EMITTERS; i++) {
      if (this.eKind[i] === E_FIRE && this.eHex[i] === hex && hex >= 0 && this.now + delay < (this.eStop[i] as number)) {
        const whole = T.endS * this.lastingShare;
        this.eBorn[i] = Math.min(this.eBorn[i] as number, this.now + delay);
        this.eStop[i] = this.now + delay + whole - Math.min(T.smokeS, whole * 0.4);
        this.eEnd[i] = this.now + delay + whole;
        this.eLaid[i] = 0;
        return;
      }
    }
    const born = this.now + delay;
    const e = this.claim(E_FIRE, hex, hex, at, born, scale);
    if (e < 0) return;
    const whole = T.endS * this.lastingShare;
    // The last puff is born early enough to be gone by the end.
    this.eStop[e] = born + whole - Math.min(T.smokeS, whole * 0.4);
    this.eEnd[e] = born + whole;
  }

  /** How strongly a fire burns `t` seconds after it took hold: up quickly, full while it burns, then dwindling to its last smoke. */
  private burning(e: number, t: number): number {
    const T = this.tune.fire;
    const burn = T.burnS * this.lastingShare;
    const stop = (this.eStop[e] as number) - (this.eBorn[e] as number);
    if (t <= 0) return 0;
    const up = Math.min(1, t / 0.5);
    const down = t <= burn ? 1 : Math.max(0, 1 - (t - burn) / Math.max(0.1, stop - burn));
    return up * up * (3 - 2 * up) * down;
  }

  private feedFire(e: number): void {
    const T = this.tune.fire;
    const S = this.tune.all.size * (this.eScale[e] as number);
    const wind = this.wind;
    const now = this.now;
    const x = this.eX[e] as number;
    const y = this.eY[e] as number;
    const seed = this.eSeed[e] as number;
    if (this.eSaid[e] === 0) {
      this.eSaid[e] = 1;
      this.say('fire', this.eHex[e] as number, now);
    }
    const stop = this.eStop[e] as number;
    const whole = (this.eEnd[e] as number) - (this.eBorn[e] as number);
    // Its light on the board and the soot under it, laid once and for as long as it burns.
    if (this.eLaid[e] === 0 && now < stop) {
      this.eLaid[e] = 1;
      const glow = linearInk(T.glow);
      const p = this.pool.patch();
      p.born = now;
      p.life = Math.max(0.2, stop - now);
      p.x = x;
      p.y = y;
      p.reach = T.lightReach * S;
      p.height = 0.5;
      p.r = glow[0] * T.light * this.tune.all.bright;
      p.g = glow[1] * T.light * this.tune.all.bright;
      p.b = glow[2] * T.light * this.tune.all.bright;
      p.fadeIn = 0.06;
      p.fadeOut = 0.6;
      p.waver = this.reduced ? 0 : T.waver;
      p.burst = false;
      p.emitter = e;
      p.seed = this.rnd(seed, 1);
      this.pool.addPatch(p);
      const q = this.pool.patch();
      q.born = now;
      q.life = Math.max(0.2, whole * 0.9);
      q.x = x;
      q.y = y;
      q.reach = T.soot * S;
      q.dark = T.sootDark;
      q.fadeIn = 0.04;
      q.fadeOut = 0.35;
      q.burst = false;
      q.emitter = e;
      this.pool.addPatch(q);
    }
    if (now >= stop) return;
    const power = this.burning(e, now - (this.eBorn[e] as number));
    // Flames: each lives a couple of seconds and is followed by the next before it has gone.
    const flames = Math.max(1, Math.round(T.flames * (this.flat ? 0.67 : 1)));
    const period = 1.7 / flames;
    while ((this.eNext[e * 3] as number) <= now) {
      const n = this.eCount[e] as number;
      this.eCount[e] = n + 1;
      const k = 1000 + n * 13;
      const born = this.eNext[e * 3] as number;
      this.eNext[e * 3] = born + period * (0.8 + 0.4 * this.rnd(seed, k));
      if (power <= 0.03) continue;
      const big = (0.55 + 0.45 * power) * (0.75 + 0.5 * this.rnd(seed, k + 1));
      const a = this.rnd(seed, k + 2) * TAU;
      const r = T.spread * S * Math.sqrt(this.rnd(seed, k + 3));
      const s = this.pool.spec();
      s.kind = this.book('flame');
      s.mode = MODE_EMISSIVE;
      s.orient = ORIENT_UPRIGHT;
      s.aspect = this.aspect('flame');
      s.born = born;
      s.life = 1.7 * 1.3;
      s.x = x + Math.cos(a) * r;
      s.y = y + Math.sin(a) * r;
      s.z = 0.06;
      s.size0 = (T.flame * S * big) / s.aspect;
      s.size1 = s.size0 * 0.85;
      s.fadeIn = 0.2;
      s.fadeOut = 0.3;
      s.alpha = Math.min(1, 0.35 + 0.75 * power);
      s.gain = T.gain;
      s.lit = 0;
      s.frame0 = this.rnd(seed, k + 4) * this.frames('flame');
      s.fps = this.rate('flame') * (0.85 + 0.3 * this.rnd(seed, k + 5));
      s.flip = this.rnd(seed, k + 6) < 0.5 ? -1 : 1;
      s.layer = T.through - 0.2;
      s.burst = false;
      s.emitter = e;
      this.put(s);
    }
    // Balls of fire at its foot, which is what is seen of it from above.
    const ballPeriod = 1.0 / Math.max(1, T.balls);
    while ((this.eNext[e * 3 + 1] as number) <= now) {
      const n = this.eCount[e] as number;
      this.eCount[e] = n + 1;
      const k = 2000 + n * 13;
      const born = this.eNext[e * 3 + 1] as number;
      this.eNext[e * 3 + 1] = born + ballPeriod * (0.8 + 0.4 * this.rnd(seed, k));
      if (power <= 0.03 || T.balls <= 0) continue;
      const a = this.rnd(seed, k + 1) * TAU;
      const r = T.spread * S * 0.8 * Math.sqrt(this.rnd(seed, k + 2));
      const s = this.pool.spec();
      s.kind = this.book('fireball');
      s.mode = MODE_ADD;
      s.born = born;
      s.life = 1.0 * 1.25;
      s.x = x + Math.cos(a) * r;
      s.y = y + Math.sin(a) * r;
      s.z = 0.22 * S;
      s.tz = 0.3;
      s.tx = wind[0] * 0.5;
      s.ty = wind[1] * 0.5;
      s.size0 = T.ball * S * (0.5 + 0.5 * power) * (0.8 + 0.4 * this.rnd(seed, k + 3));
      s.size1 = s.size0 * 0.55;
      s.fadeIn = 0.3;
      s.fadeOut = 0.45;
      s.alpha = Math.min(1, 0.4 + 0.6 * power);
      s.ink(linearInk(T.ballInk));
      s.opacity = 0.9;
      s.gain = 1.55;
      s.lit = 0;
      // The fire shines through the smoke that rises over it: seen from straight above, that smoke would hide it.
      s.layer = T.through;
      s.rot = this.rnd(seed, k + 4) * TAU;
      s.frame0 = this.rnd(seed, k + 5) * this.frames('fireball');
      s.fps = this.rate('fireball') * 0.7;
      s.burst = false;
      s.emitter = e;
      const glowSize = s.size0 * T.ballGlow;
      const gx = s.x;
      const gy = s.y;
      const gz = s.z;
      const life = s.life;
      const alpha = s.alpha;
      this.put(s);
      if (T.ballGlowAlpha > 0) {
        const g = this.pool.spec();
        g.kind = SHAPE_GLOW;
        g.born = born;
        g.life = life;
        g.x = gx;
        g.y = gy;
        g.z = gz;
        g.tz = 0.3;
        g.size0 = g.size1 = glowSize;
        g.fadeIn = 0.35;
        g.fadeOut = 0.5;
        g.alpha = T.ballGlowAlpha * alpha * this.tune.all.bright;
        g.ink(linearInk(T.glow));
        g.opacity = 0;
        g.lit = 0;
        g.layer = T.through + 0.1;
        g.burst = false;
        g.emitter = e;
        this.put(g);
      }
    }
    // The column: born warm and dark over the fire, rising, spreading and paling as the wind takes it.
    const smokeLife = Math.min(T.smokeS, whole * 0.4);
    const dark = this.grey(T.smokeGrey);
    const pale = this.grey(T.smokeGrey + 46);
    const rate = T.smokeRate * (0.35 + 0.65 * power) * (this.reduced ? this.tune.all.reducedCount : 1) * (this.flat ? this.tune.all.flatCount : 1) * this.tune.all.count;
    if (rate <= 0) return;
    let next = this.eNext[e * 3 + 2] as number;
    while (next <= now) {
      const n = this.eCount[e] as number;
      this.eCount[e] = n + 1;
      const k = 3000 + n * 13;
      const a = this.rnd(seed, k) * TAU;
      const r = 0.16 * S * Math.sqrt(this.rnd(seed, k + 1));
      const s = this.smokePuff(this.rnd(seed, k + 2) < 0.3 ? 'wisp' : 'smoke', seed, k + 20, next, x + Math.cos(a) * r, y + Math.sin(a) * r, 0.38 * S, T.smoke0 * S, T.smoke1 * S * (0.8 + 0.4 * this.rnd(seed, k + 3)), smokeLife * (0.8 + 0.4 * this.rnd(seed, k + 4)), T.smokeAlpha * (0.6 + 0.4 * power), dark);
      s.r1 = pale[0];
      s.g1 = pale[1];
      s.b1 = pale[2];
      s.vz = T.rise * 2.1;
      s.drag = 0.9;
      s.tx = wind[0] * (0.85 + 0.3 * this.rnd(seed, k + 5));
      s.ty = wind[1] * (0.85 + 0.3 * this.rnd(seed, k + 6));
      s.tz = T.rise * (0.8 + 0.4 * this.rnd(seed, k + 7));
      s.sizePow = 1.5;
      // Young smoke over the fire is thin, so that the fire shows through it from straight above.
      s.fadeIn = 0.22;
      s.fadeOut = 0.55;
      s.warm = power;
      s.shadow = 0.8;
      s.burst = false;
      s.emitter = e;
      this.put(s);
      next += (1 / rate) * (0.75 + 0.5 * this.rnd(seed, k + 8));
    }
    this.eNext[e * 3 + 2] = next;
  }

  /** The hexes a smoke screen lies on now, each with its middle: a bank gathers on a new one, and one no longer listed thins away. */
  screens(list: readonly { hex: number; at: P2 }[]): void {
    for (let i = 0; i < EMITTERS; i++) {
      if (this.eKind[i] !== E_SCREEN || this.eStop[i] !== Infinity) continue;
      if (!list.some(s => s.hex === this.eHex[i])) this.stop(i, this.tune.screen.outS);
    }
    for (const s of list) {
      if (this.find(E_SCREEN, s.hex) >= 0) continue;
      this.claim(E_SCREEN, s.hex, s.hex, s.at, this.now, 1);
    }
  }

  private feedScreen(e: number): void {
    const T = this.tune.screen;
    const S = this.tune.all.size;
    const wind = this.wind;
    const now = this.now;
    const seed = this.eSeed[e] as number;
    if (this.eSaid[e] === 0) {
      this.eSaid[e] = 1;
      this.say('screen', this.eHex[e] as number, now);
    }
    if (now >= (this.eStop[e] as number)) return;
    const puffs = Math.max(3, this.many(T.puffs));
    const grey = this.grey(T.grey);
    const one = (born: number, n: number, quick: boolean): void => {
      const k = 1000 + n * 13;
      const a = this.rnd(seed, k) * TAU;
      const r = T.reach * S * Math.sqrt(this.rnd(seed, k + 1));
      const life = T.puffS * (0.8 + 0.4 * this.rnd(seed, k + 2));
      const s = this.smokePuff('cloud', seed, k + 20, born, (this.eX[e] as number) + Math.cos(a) * r, (this.eY[e] as number) + Math.sin(a) * r, T.height * S * (0.6 + 0.8 * this.rnd(seed, k + 3)), T.size * S * (quick ? 0.3 : 0.6), T.size * S * (0.9 + 0.3 * this.rnd(seed, k + 4)), life, T.alpha, grey);
      s.sizePow = quick ? 3 : 2;
      s.fadeIn = quick ? 0.1 : 0.22;
      s.fadeOut = 0.3;
      s.tx = wind[0] * T.drift;
      s.ty = wind[1] * T.drift;
      s.tz = 0.01;
      s.spin = (this.rnd(seed, k + 5) - 0.5) * 0.12;
      s.fps = this.rate('cloud') * 0.4;
      s.shadow = 0.75;
      s.burst = false;
      s.emitter = e;
      this.put(s);
    };
    // It gathers: the whole bank within its first moments, then a puff for each that leaves.
    if (this.eLaid[e] === 0) {
      this.eLaid[e] = 1;
      for (let i = 0; i < puffs; i++) {
        const n = this.eCount[e] as number;
        this.eCount[e] = n + 1;
        one(now + (i / puffs) * T.inS * 0.8, n, true);
      }
      this.eNext[e * 3] = now + T.puffS * 0.55;
    }
    const period = T.puffS / puffs;
    while ((this.eNext[e * 3] as number) <= now) {
      const n = this.eCount[e] as number;
      this.eCount[e] = n + 1;
      one(this.eNext[e * 3] as number, n, false);
      this.eNext[e * 3] = (this.eNext[e * 3] as number) + period * (0.8 + 0.4 * this.rnd(seed, n * 13 + 7));
    }
  }

  /** A thin wisp over a suppressed counter, by the counter's number: on, where it is now; or off. */
  wisp(key: number, on: boolean, at: P2, hex: number): void {
    const e = this.find(E_WISP, key);
    if (!on) {
      if (e >= 0) this.stop(e, 0.8);
      return;
    }
    if (this.tune.wisp.rate <= 0) return;
    if (e >= 0) {
      this.eX[e] = at[0];
      this.eY[e] = at[1];
      this.eHex[e] = hex;
      return;
    }
    this.claim(E_WISP, hex, key, at, this.now, 1);
  }

  private feedWisp(e: number): void {
    const T = this.tune.wisp;
    const S = this.tune.all.size;
    const wind = this.wind;
    const now = this.now;
    const seed = this.eSeed[e] as number;
    if (this.eSaid[e] === 0) {
      this.eSaid[e] = 1;
      this.say('wisp', this.eHex[e] as number, now);
    }
    if (now >= (this.eStop[e] as number)) return;
    const grey = this.grey(T.grey);
    const rate = T.rate * (this.reduced ? this.tune.all.reducedCount : 1);
    while ((this.eNext[e * 3] as number) <= now) {
      const n = this.eCount[e] as number;
      this.eCount[e] = n + 1;
      const k = 1000 + n * 13;
      const a = this.rnd(seed, k) * TAU;
      const r = 0.24 * Math.sqrt(this.rnd(seed, k + 1));
      const s = this.smokePuff('wisp', seed, k + 20, this.eNext[e * 3] as number, (this.eX[e] as number) + Math.cos(a) * r, (this.eY[e] as number) + Math.sin(a) * r, 0.16, 0.12 * S, T.size * S * (0.8 + 0.4 * this.rnd(seed, k + 2)), T.wispS * (0.8 + 0.4 * this.rnd(seed, k + 3)), T.alpha, grey);
      s.tx = wind[0] * 0.8;
      s.ty = wind[1] * 0.8;
      s.tz = T.rise;
      s.fadeIn = 0.25;
      s.fadeOut = 0.6;
      s.shadow = 0.2;
      s.burst = false;
      s.emitter = e;
      this.put(s);
      this.eNext[e * 3] = (this.eNext[e * 3] as number) + (1 / rate) * (0.7 + 0.6 * this.rnd(seed, k + 4));
    }
  }

  /** A lasting effect stops feeding and what it has made eases away within `within` seconds. */
  private stop(e: number, within: number): void {
    this.eStop[e] = this.now;
    this.eEnd[e] = this.now + within;
    this.pool.end(e, this.now, within);
  }

  // ---- incoming fire, movement ---------------------------------------------------------------------

  /** A fire mission arrives on a hex: several rounds, each seen coming down and bursting, over a second or so. */
  mission(hex: number, at: P2, delay: number): void {
    const T = this.tune.mission;
    const S = this.tune.all.size;
    const n = Math.max(2, this.many(T.bursts));
    const seed = hex * 97 + 29;
    this.begin();
    this.say('mission', hex, this.now + delay);
    for (let i = 0; i < n; i++) {
      const k = i * 11;
      const t = this.now + delay + (i / n) * T.overS + this.rnd(seed, k) * 0.08;
      const a = this.rnd(seed, k + 1) * TAU;
      const r = T.spread * S * Math.sqrt(this.rnd(seed, k + 2));
      const x = at[0] + Math.cos(a) * r;
      const y = at[1] + Math.sin(a) * r;
      // The round, seen for a moment on its way down.
      const lean = 0.22;
      const s = this.pool.spec();
      s.kind = SHAPE_STREAK;
      s.orient = ORIENT_STRETCH;
      s.born = t - T.fallS;
      s.life = T.fallS;
      s.x = x - lean * T.fromHeight;
      s.y = y - lean * 0.6 * T.fromHeight;
      s.z = T.fromHeight;
      s.vx = (lean * T.fromHeight) / T.fallS;
      s.vy = (lean * 0.6 * T.fromHeight) / T.fallS;
      s.vz = (0.1 - T.fromHeight) / T.fallS;
      s.len = 1.1 * S;
      s.size0 = s.size1 = 0.09 * S;
      s.fadeIn = 0.25;
      s.fadeOut = 0.05;
      s.ink(this.grey(52));
      s.opacity = 1;
      s.lit = 0;
      s.shadow = 0.8;
      this.put(s);
      this.blastAt(seed + i * 37, t, [x, y], T.size);
      this.say('blast', hex, t);
    }
    this.done();
  }

  /** Dust behind a vehicle, at a place on its way; `share` is how much of a tracked vehicle's it raises. */
  dust(at: P2, way: P2, hex: number, share: number, delay = 0): void {
    const T = this.tune.dust;
    const S = this.tune.all.size;
    const wind = this.wind;
    const seed = hex * 19 + this.serial++ * 3 + 1;
    this.begin();
    const s = this.smokePuff(this.rnd(seed, 1) < 0.5 ? 'smoke' : 'cloud', seed, 10, this.now + delay, at[0] + (this.rnd(seed, 2) - 0.5) * 0.2, at[1] + (this.rnd(seed, 3) - 0.5) * 0.2, 0.1, 0.22 * S, T.size * S * (0.8 + 0.4 * this.rnd(seed, 4)), T.puffS * (0.8 + 0.4 * this.rnd(seed, 5)), T.alpha * share, linearInk(T.ink));
    s.vx = -way[0] * 0.5;
    s.vy = -way[1] * 0.5;
    s.vz = 0.3;
    s.drag = 2.4;
    s.tx = wind[0] * 0.6;
    s.ty = wind[1] * 0.6;
    s.tz = 0.05;
    s.floor = 0.08;
    s.fadeIn = 0.2;
    s.shadow = 0.3;
    this.put(s);
    this.say('dust', hex, this.now + delay);
    this.done();
  }

  /** A puff of exhaust as a vehicle starts, behind it. */
  exhaust(at: P2, way: P2, hex: number, delay = 0): void {
    const T = this.tune.dust;
    const S = this.tune.all.size;
    const wind = this.wind;
    const seed = hex * 23 + this.serial++ * 5 + 2;
    this.begin();
    const grey = this.grey(T.exhaustGrey);
    const n = this.many(T.exhaust);
    for (let i = 0; i < n; i++) {
      const k = i * 9;
      const s = this.smokePuff('smoke', seed, k, this.now + delay + i * 0.07, at[0] - way[0] * 0.36, at[1] - way[1] * 0.36, 0.16, 0.12 * S, T.exhaustSize * S * (0.8 + 0.5 * this.rnd(seed, k + 6)), T.exhaustS * (0.8 + 0.4 * this.rnd(seed, k + 7)), T.exhaustAlpha, grey);
      s.vx = -way[0] * 1.3 + (this.rnd(seed, k + 8) - 0.5) * 0.5;
      s.vy = -way[1] * 1.3 + (this.rnd(seed, k + 9) - 0.5) * 0.5;
      s.vz = 0.7;
      s.drag = 3;
      s.tx = wind[0];
      s.ty = wind[1];
      s.tz = 0.2;
      s.fadeIn = 0.12;
      s.shadow = 0.3;
      this.put(s);
    }
    this.say('exhaust', hex, this.now + delay);
    this.done();
  }

  // ---- the clock -----------------------------------------------------------------------------------

  /** Everything gone at once. */
  clear(): void {
    this.pool.clear();
    this.eKind.fill(0);
    this.strength.fill(1);
    this.notes = 0;
    this.endCount = 0;
    this.flashCount = 0;
  }

  /**
   * Advance the clock by `dt` seconds of the page's time (`at` is the page's clock in ms, for what
   * the page is told). Says what is alive after it: 2 while any short effect is, 1 while only
   * lasting ones are, 0 when nothing is.
   */
  step(dt: number, at: number): 0 | 1 | 2 {
    this.now += dt * this.speed;
    const now = this.now;
    // Lasting effects feed the pool, and are let go when the last of what they made has gone.
    for (let e = 0; e < EMITTERS; e++) {
      const kind = this.eKind[e] as number;
      if (kind === 0) continue;
      if (now >= (this.eEnd[e] as number)) {
        this.eKind[e] = 0;
        this.strength[e] = 1;
        continue;
      }
      if (now < (this.eBorn[e] as number)) continue;
      const stopped = now >= (this.eStop[e] as number);
      // A fire or a screen is thinned while a counter stands in its hex, so that the counter can be read.
      let want = 1;
      if (kind === E_FIRE && this.occupied(this.eHex[e] as number)) want = this.tune.fire.occupied;
      else if (kind === E_SCREEN && this.occupied(this.eHex[e] as number)) want = this.tune.screen.occupiedAlpha / Math.max(0.01, this.tune.screen.alpha);
      if (!stopped || kind === E_FIRE) {
        const k = 1 - Math.exp((-dt * this.speed) / STRENGTH_TAU);
        this.strength[e] = (this.strength[e] as number) + (want - (this.strength[e] as number)) * k;
      }
      if (kind === E_FIRE) this.feedFire(e);
      else if (kind === E_SCREEN) this.feedScreen(e);
      else this.feedWisp(e);
    }
    this.pool.retire(now);
    // What is due to be said to the page.
    let kept = 0;
    for (let i = 0; i < this.notes; i++) {
      if ((this.nAt[i] as number) <= now) {
        const kind = EFFECT_KINDS[this.nKind[i] as number] as EffectKind;
        this.started[kind]++;
        if (this.onEffect) this.onEffect({ kind, hex: this.nHex[i] as number, at });
      } else {
        this.nAt[kept] = this.nAt[i] as number;
        this.nKind[kept] = this.nKind[i] as number;
        this.nHex[kept] = this.nHex[i] as number;
        kept++;
      }
    }
    this.notes = kept;
    kept = 0;
    for (let i = 0; i < this.endCount; i++) if ((this.ends[i] as number) > now) this.ends[kept++] = this.ends[i] as number;
    this.endCount = kept;
    if (this.endCount > 0 || this.pool.bursts > 0 || this.pool.burstPatches > 0) return 2;
    return this.lasting > 0 || this.pool.count > 0 || this.pool.patches > 0 ? 1 : 0;
  }
}

/** For the type of a place on the plan where a caller builds one. */
export type { P2 };
