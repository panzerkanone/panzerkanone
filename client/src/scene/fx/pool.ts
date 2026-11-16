/**
 * The effects' particles and the patches of light and shade they lay on the board: two fixed
 * pools, filled when an effect starts and never grown. A particle's whole course is set at its
 * birth (where it starts, how it is thrown, what it settles to, how it grows, fades and plays), so
 * where it is at any moment is arithmetic on its age: nothing is stepped, and a late frame skips
 * nothing. Each frame the live ones are put in order of distance (the farthest first, so that
 * smoke over fire looks right from every camera) and written into the buffers the view draws.
 *
 * Nothing here allocates after the pools are made. Plain arithmetic, no browser.
 */
import type { Flipbook } from './flipbook';
import { frameCorner } from './flipbook';

/** The most particles alive at once, and the most patches of light and soot. A spawn into a full pool is dropped (and counted). */
export const CAPACITY = 1536;
export const PATCHES = 96;
/** Numbers an instance: a particle's in the view's buffer, a patch's (or a shadow's). */
export const STRIDE = 32;
export const DECAL_STRIDE = 8;
/** The most decals drawn: every patch, and a shadow for each particle that casts one. */
export const DECALS = PATCHES + 640;

/** What a particle is drawn with: a flipbook (its place in the manifest's list, 0 or more) or one of the shapes the shader draws itself. */
export const SHAPE_GLOW = -1;
export const SHAPE_STREAK = -2;
export const SHAPE_CHIP = -3;
export const SHAPE_PUFF = -4;
export const SHAPE_MUZZLE = -5;
/** How it is turned: to face the camera; standing (about the table's upright, its foot on its place); or stretched along the way it flies. */
export const ORIENT_FACE = 0;
export const ORIENT_UPRIGHT = 1;
export const ORIENT_STRETCH = 2;
/** How a flipbook's picture is taken: smoke that takes the table's light; fire and smoke as pictured, the fire made brighter; light only. */
export const MODE_OVER = 0;
export const MODE_EMISSIVE = 1;
export const MODE_ADD = 2;

/** What a particle is born with. One of these is kept by the pool and filled anew for each spawn (`spec()`), so that spawning allocates nothing. */
export class Spec {
  /** The second it appears (the effects' clock) and how long it lives. */
  born = 0;
  life = 1;
  /** Where it starts. */
  x = 0;
  y = 0;
  z = 0;
  /** How it is thrown, and what its speed settles to (the wind, a rise); `drag` is how fast it settles (a share a second), `grav` a pull on its height. */
  vx = 0;
  vy = 0;
  vz = 0;
  tx = 0;
  ty = 0;
  tz = 0;
  drag = 0;
  grav = 0;
  /** It never sinks under this height. */
  floor = 0;
  /** Its width at birth and at its end; `sizePow` over 1 grows it fast at first. Height is width times `aspect`. */
  size0 = 1;
  size1 = 1;
  sizePow = 1;
  aspect = 1;
  /** Its turn at birth (radians) and how fast it turns. */
  rot = 0;
  spin = 0;
  /** Shares of its life over which it eases in and out, and its cover at full. */
  fadeIn = 0.1;
  fadeOut = 0.4;
  alpha = 1;
  /** Its colour at birth and at its end, linear light. */
  r0 = 1;
  g0 = 1;
  b0 = 1;
  r1 = 1;
  g1 = 1;
  b1 = 1;
  /** A flipbook's place in the list, or a shape. */
  kind = SHAPE_GLOW;
  /** The frame it starts on; frames a second (0: the flipbook is played once over the particle's life). */
  frame0 = 0;
  fps = 0;
  /** How much it hides what is behind it (0: light only), how much brighter than pictured, how much it takes the table's light, how warm a fire under it lights it. */
  opacity = 1;
  gain = 1;
  lit = 1;
  warm = 0;
  mode = MODE_OVER;
  orient = ORIENT_FACE;
  /** Stretched: its length, and the way it lies while it has no speed. */
  len = 0;
  ax = 0;
  ay = 0;
  az = 0;
  /** Drawn as if this much nearer (h): a glow over the smoke it lights. */
  layer = 0;
  /** How much shadow it lays on the board, 0 to 1. */
  shadow = 0;
  /** A short effect's (true), or a lasting one's. */
  burst = true;
  /** The lasting effect it belongs to (its cover follows that effect's strength), or -1. */
  emitter = -1;
  seed = 0;
  /** Mirrored left to right (-1) or not (1). */
  flip = 1;

  reset(): this {
    this.born = 0;
    this.life = 1;
    this.x = this.y = this.z = 0;
    this.vx = this.vy = this.vz = 0;
    this.tx = this.ty = this.tz = 0;
    this.drag = 0;
    this.grav = 0;
    this.floor = 0;
    this.size0 = this.size1 = 1;
    this.sizePow = 1;
    this.aspect = 1;
    this.rot = 0;
    this.spin = 0;
    this.fadeIn = 0.1;
    this.fadeOut = 0.4;
    this.alpha = 1;
    this.r0 = this.g0 = this.b0 = 1;
    this.r1 = this.g1 = this.b1 = 1;
    this.kind = SHAPE_GLOW;
    this.frame0 = 0;
    this.fps = 0;
    this.opacity = 1;
    this.gain = 1;
    this.lit = 1;
    this.warm = 0;
    this.mode = MODE_OVER;
    this.orient = ORIENT_FACE;
    this.len = 0;
    this.ax = this.ay = this.az = 0;
    this.layer = 0;
    this.shadow = 0;
    this.burst = true;
    this.emitter = -1;
    this.seed = 0;
    this.flip = 1;
    return this;
  }

  /** One colour for its whole life. */
  ink(c: readonly [number, number, number]): this {
    this.r0 = this.r1 = c[0];
    this.g0 = this.g1 = c[1];
    this.b0 = this.b1 = c[2];
    return this;
  }
}

/** A patch on the board: light (it brightens what is there, by the colour of what is there) and soot or shade (it darkens). */
export class Patch {
  born = 0;
  life = 1;
  x = 0;
  y = 0;
  /** How far it reaches, and how high over the board the light stands (a low light is a tight pool, a high one spreads). */
  reach = 1;
  height = 0.5;
  /** The light, linear, already at its strength. */
  r = 0;
  g = 0;
  b = 0;
  /** Darkness, 0 to 1. */
  dark = 0;
  fadeIn = 0.1;
  fadeOut = 0.9;
  /** How sharply it dies away: 1 evenly, more falls fast and lingers low. */
  pow = 1;
  /** How much it wavers (a fire's light), 0 for none. */
  waver = 0;
  burst = true;
  emitter = -1;
  seed = 0;

  reset(): this {
    this.born = 0;
    this.life = 1;
    this.x = this.y = 0;
    this.reach = 1;
    this.height = 0.5;
    this.r = this.g = this.b = 0;
    this.dark = 0;
    this.fadeIn = 0.1;
    this.fadeOut = 0.9;
    this.pow = 1;
    this.waver = 0;
    this.burst = true;
    this.emitter = -1;
    this.seed = 0;
    return this;
  }
}

// A particle's numbers, in one array: each slot has F of them, at these places.
const BORN = 0, LIFE = 1, X = 2, Y = 3, Z = 4, VX = 5, VY = 6, VZ = 7, TX = 8, TY = 9, TZ = 10, DRAG = 11, GRAV = 12, FLOOR = 13;
const S0 = 14, S1 = 15, SPOW = 16, ASPECT = 17, ROT = 18, SPIN = 19, FIN = 20, FOUT = 21, ALPHA = 22;
const R0 = 23, G0 = 24, B0 = 25, R1 = 26, G1 = 27, B1 = 28, KIND = 29, FRAME0 = 30, FPS = 31, OPACITY = 32, GAIN = 33, LIT = 34, WARM = 35;
const MODE = 36, ORIENT = 37, LEN = 38, AX = 39, AY = 40, AZ = 41, LAYER = 42, SHADOW = 43, EMITTER = 44, SEED = 45, FLIP = 46;
const F = 47;
// A patch's.
const PBORN = 0, PLIFE = 1, PX = 2, PY = 3, PREACH = 4, PHEIGHT = 5, PR = 6, PG = 7, PB = 8, PDARK = 9, PFIN = 10, PFOUT = 11, PPOW = 12, PWAVER = 13, PEMITTER = 14, PSEED = 15;
const PF = 16;

/** How fast the warmth of a fire's light leaves a puff as it rises, a share a second. */
const WARM_FADE = 1.5;

const ease = (t: number): number => {
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};

/** What the view needs of the flipbooks, worked out once from the manifest. */
export interface BookInfo {
  book: Flipbook;
  sheet: { width: number; height: number };
  /** A cell's size in texture coordinates. */
  cw: number;
  ch: number;
}

export class Pool {
  /** Particles and patches in use now (those not yet born included). */
  count = 0;
  patches = 0;
  /** Those in use that belong to short effects: the table is at rest only when both are 0. */
  bursts = 0;
  burstPatches = 0;
  /** Spawns dropped because a pool was full. */
  dropped = 0;
  /** After `write`: instances and decals in the buffers. */
  instances = 0;
  decals = 0;
  private readonly d = new Float32Array(CAPACITY * F);
  private readonly burst = new Uint8Array(CAPACITY);
  /** The slots in use, kept in the order they were last drawn in (so that putting them in order again is quick). */
  private readonly order = new Uint16Array(CAPACITY);
  private readonly free = new Uint16Array(CAPACITY);
  private freeCount = CAPACITY;
  private readonly key = new Float32Array(CAPACITY);
  private readonly p = new Float32Array(PATCHES * PF);
  private readonly patchUsed = new Uint8Array(PATCHES);
  private readonly patchBurst = new Uint8Array(PATCHES);
  private readonly theSpec = new Spec();
  private readonly thePatch = new Patch();
  private readonly cornerA: [number, number] = [0, 0];
  private readonly cornerB: [number, number] = [0, 0];

  constructor() {
    for (let i = 0; i < CAPACITY; i++) this.free[i] = CAPACITY - 1 - i;
  }

  /** The pool's one spec, reset: fill it and hand it to `add`. */
  spec(): Spec {
    return this.theSpec.reset();
  }

  patch(): Patch {
    return this.thePatch.reset();
  }

  add(s: Spec): boolean {
    if (this.freeCount === 0 || !(s.life > 0)) {
      if (s.life > 0) this.dropped++;
      return false;
    }
    const slot = this.free[--this.freeCount] as number;
    const d = this.d;
    const o = slot * F;
    d[o + BORN] = s.born;
    d[o + LIFE] = s.life;
    d[o + X] = s.x;
    d[o + Y] = s.y;
    d[o + Z] = s.z;
    d[o + VX] = s.vx;
    d[o + VY] = s.vy;
    d[o + VZ] = s.vz;
    d[o + TX] = s.tx;
    d[o + TY] = s.ty;
    d[o + TZ] = s.tz;
    d[o + DRAG] = s.drag;
    d[o + GRAV] = s.grav;
    d[o + FLOOR] = s.floor;
    d[o + S0] = s.size0;
    d[o + S1] = s.size1;
    d[o + SPOW] = s.sizePow;
    d[o + ASPECT] = s.aspect;
    d[o + ROT] = s.rot;
    d[o + SPIN] = s.spin;
    d[o + FIN] = s.fadeIn;
    d[o + FOUT] = s.fadeOut;
    d[o + ALPHA] = s.alpha;
    d[o + R0] = s.r0;
    d[o + G0] = s.g0;
    d[o + B0] = s.b0;
    d[o + R1] = s.r1;
    d[o + G1] = s.g1;
    d[o + B1] = s.b1;
    d[o + KIND] = s.kind;
    d[o + FRAME0] = s.frame0;
    d[o + FPS] = s.fps;
    d[o + OPACITY] = s.opacity;
    d[o + GAIN] = s.gain;
    d[o + LIT] = s.lit;
    d[o + WARM] = s.warm;
    d[o + MODE] = s.mode;
    d[o + ORIENT] = s.orient;
    d[o + LEN] = s.len;
    d[o + AX] = s.ax;
    d[o + AY] = s.ay;
    d[o + AZ] = s.az;
    d[o + LAYER] = s.layer;
    d[o + SHADOW] = s.shadow;
    d[o + EMITTER] = s.emitter;
    d[o + SEED] = s.seed;
    d[o + FLIP] = s.flip;
    this.burst[slot] = s.burst ? 1 : 0;
    this.order[this.count++] = slot;
    if (s.burst) this.bursts++;
    return true;
  }

  addPatch(s: Patch): boolean {
    if (!(s.life > 0)) return false;
    let slot = -1;
    for (let i = 0; i < PATCHES; i++) {
      if (this.patchUsed[i] === 0) {
        slot = i;
        break;
      }
    }
    if (slot < 0) {
      this.dropped++;
      return false;
    }
    const p = this.p;
    const o = slot * PF;
    p[o + PBORN] = s.born;
    p[o + PLIFE] = s.life;
    p[o + PX] = s.x;
    p[o + PY] = s.y;
    p[o + PREACH] = s.reach;
    p[o + PHEIGHT] = s.height;
    p[o + PR] = s.r;
    p[o + PG] = s.g;
    p[o + PB] = s.b;
    p[o + PDARK] = s.dark;
    p[o + PFIN] = s.fadeIn;
    p[o + PFOUT] = s.fadeOut;
    p[o + PPOW] = s.pow;
    p[o + PWAVER] = s.waver;
    p[o + PEMITTER] = s.emitter;
    p[o + PSEED] = s.seed;
    this.patchUsed[slot] = 1;
    this.patchBurst[slot] = s.burst ? 1 : 0;
    this.patches++;
    if (s.burst) this.burstPatches++;
    return true;
  }

  /** Let go of everything whose life is over at `now`. */
  retire(now: number): void {
    const d = this.d;
    let kept = 0;
    for (let i = 0; i < this.count; i++) {
      const slot = this.order[i] as number;
      const o = slot * F;
      if (now >= (d[o + BORN] as number) + (d[o + LIFE] as number)) {
        this.free[this.freeCount++] = slot;
        if (this.burst[slot] === 1) this.bursts--;
      } else this.order[kept++] = slot;
    }
    this.count = kept;
    const p = this.p;
    for (let i = 0; i < PATCHES; i++) {
      if (this.patchUsed[i] === 0) continue;
      const o = i * PF;
      if (now >= (p[o + PBORN] as number) + (p[o + PLIFE] as number)) {
        this.patchUsed[i] = 0;
        this.patches--;
        if (this.patchBurst[i] === 1) this.burstPatches--;
      }
    }
  }

  /** Everything gone at once (a new set-up; the demonstration's "clear"). */
  clear(): void {
    this.count = 0;
    this.bursts = 0;
    this.freeCount = CAPACITY;
    for (let i = 0; i < CAPACITY; i++) this.free[i] = CAPACITY - 1 - i;
    this.patchUsed.fill(0);
    this.patches = 0;
    this.burstPatches = 0;
    this.instances = 0;
    this.decals = 0;
  }

  /** Bring a lasting effect's particles and patches to an end by `until` (they ease out over what is left of their lives, or sooner). */
  end(emitter: number, now: number, within: number): void {
    const d = this.d;
    for (let i = 0; i < this.count; i++) {
      const o = (this.order[i] as number) * F;
      if (d[o + EMITTER] !== emitter) continue;
      const born = d[o + BORN] as number;
      const left = born + (d[o + LIFE] as number) - now;
      if (left <= within) continue;
      // Its life is cut to end `within` from now, and its easing out stretched to cover the cut.
      const life = Math.max(1e-3, now + within - born);
      const age = Math.max(0, now - born);
      d[o + FOUT] = Math.min(1, Math.max(d[o + FOUT] as number, 1 - age / life));
      d[o + LIFE] = life;
    }
    const p = this.p;
    for (let i = 0; i < PATCHES; i++) {
      if (this.patchUsed[i] === 0) continue;
      const o = i * PF;
      if (p[o + PEMITTER] !== emitter) continue;
      const born = p[o + PBORN] as number;
      if (born + (p[o + PLIFE] as number) - now <= within) continue;
      const life = Math.max(1e-3, now + within - born);
      p[o + PFOUT] = Math.min(1, Math.max(p[o + PFOUT] as number, 1 - Math.max(0, now - born) / life));
      p[o + PLIFE] = life;
    }
  }

  /**
   * Write what is alive at `now` into the view's buffers: the particles, the farthest from the camera
   * first, and after them the decals (the patches, then a shadow for each particle that casts one).
   * `forward` is the way the camera looks; `strength` the strength of each lasting effect by its
   * number; `shade` says where a thing at height 1 throws its shadow on the plan, how dark a shadow
   * is at most and how fast it softens with height (0 darkness: no shadows are written).
   */
  write(
    now: number,
    forward: readonly [number, number, number],
    books: readonly BookInfo[],
    strength: Float32Array,
    shade: { dx: number; dy: number; dark: number; soften: number },
    out: Float32Array,
    decals: Float32Array,
  ): void {
    const d = this.d;
    const key = this.key;
    const order = this.order;
    const n = this.count;
    // Where each is, along the camera's way; then in order, the farthest first. The order of the last
    // frame is nearly this frame's, so an insertion sort does little work.
    for (let i = 0; i < n; i++) {
      const slot = order[i] as number;
      const o = slot * F;
      const t = now - (d[o + BORN] as number);
      if (t < 0) {
        key[slot] = -1e9;
        continue;
      }
      const k = d[o + DRAG] as number;
      const e = k > 0 ? Math.exp(-k * t) : 1;
      const f = k > 0 ? (1 - e) / k : t;
      const x = (d[o + X] as number) + (d[o + TX] as number) * t + ((d[o + VX] as number) - (d[o + TX] as number)) * f;
      const y = (d[o + Y] as number) + (d[o + TY] as number) * t + ((d[o + VY] as number) - (d[o + TY] as number)) * f;
      let z = (d[o + Z] as number) + (d[o + TZ] as number) * t + ((d[o + VZ] as number) - (d[o + TZ] as number)) * f + 0.5 * (d[o + GRAV] as number) * t * t;
      if (z < (d[o + FLOOR] as number)) z = d[o + FLOOR] as number;
      key[slot] = x * forward[0] + y * forward[1] + z * forward[2] - (d[o + LAYER] as number);
    }
    for (let i = 1; i < n; i++) {
      const slot = order[i] as number;
      const v = key[slot] as number;
      let j = i - 1;
      while (j >= 0 && (key[order[j] as number] as number) < v) {
        order[j + 1] = order[j] as number;
        j--;
      }
      order[j + 1] = slot;
    }

    let w = 0;
    let dn = 0;
    // The patches first among the decals: light and soot under any shadow.
    const p = this.p;
    for (let i = 0; i < PATCHES; i++) {
      if (this.patchUsed[i] === 0) continue;
      const o = i * PF;
      const t = now - (p[o + PBORN] as number);
      if (t < 0) continue;
      const u = Math.min(1, t / (p[o + PLIFE] as number));
      const out1 = 1 - ease((u - (1 - (p[o + PFOUT] as number))) / Math.max(1e-4, p[o + PFOUT] as number));
      let env = ease(u / Math.max(1e-4, p[o + PFIN] as number)) * Math.pow(out1, p[o + PPOW] as number);
      const em = p[o + PEMITTER] as number;
      if (em >= 0) env *= strength[em] as number;
      if (env <= 0.002) continue;
      const waver = p[o + PWAVER] as number;
      const seed = p[o + PSEED] as number;
      const light = waver > 0 ? env * (1 + waver * (0.6 * Math.sin(now * 9.7 + seed * 6.3) + 0.4 * Math.sin(now * 23.1 + seed * 11.9))) : env;
      const q = dn * DECAL_STRIDE;
      decals[q] = p[o + PX] as number;
      decals[q + 1] = p[o + PY] as number;
      decals[q + 2] = p[o + PREACH] as number;
      decals[q + 3] = p[o + PHEIGHT] as number;
      decals[q + 4] = (p[o + PR] as number) * light;
      decals[q + 5] = (p[o + PG] as number) * light;
      decals[q + 6] = (p[o + PB] as number) * light;
      decals[q + 7] = (p[o + PDARK] as number) * env;
      dn++;
    }

    const a = this.cornerA;
    const b = this.cornerB;
    for (let i = 0; i < n; i++) {
      const slot = order[i] as number;
      const o = slot * F;
      const t = now - (d[o + BORN] as number);
      if (t < 0) continue;
      const life = d[o + LIFE] as number;
      const u = Math.min(1, t / life);
      const k = d[o + DRAG] as number;
      const e = k > 0 ? Math.exp(-k * t) : 1;
      const f = k > 0 ? (1 - e) / k : t;
      const x = (d[o + X] as number) + (d[o + TX] as number) * t + ((d[o + VX] as number) - (d[o + TX] as number)) * f;
      const y = (d[o + Y] as number) + (d[o + TY] as number) * t + ((d[o + VY] as number) - (d[o + TY] as number)) * f;
      let z = (d[o + Z] as number) + (d[o + TZ] as number) * t + ((d[o + VZ] as number) - (d[o + TZ] as number)) * f + 0.5 * (d[o + GRAV] as number) * t * t;
      let landed = false;
      if (z < (d[o + FLOOR] as number)) {
        z = d[o + FLOOR] as number;
        landed = true;
      }
      let alpha = (d[o + ALPHA] as number) * ease(u / Math.max(1e-4, d[o + FIN] as number)) * (1 - ease((u - (1 - (d[o + FOUT] as number))) / Math.max(1e-4, d[o + FOUT] as number)));
      const em = d[o + EMITTER] as number;
      if (em >= 0) alpha *= strength[em] as number;
      if (alpha <= 0.002) continue;
      const pw = d[o + SPOW] as number;
      const grown = pw === 1 ? u : 1 - Math.pow(1 - u, pw);
      const size = (d[o + S0] as number) + ((d[o + S1] as number) - (d[o + S0] as number)) * grown;
      const q = w * STRIDE;
      out[q] = x;
      out[q + 1] = y;
      out[q + 2] = z;
      out[q + 3] = size;
      const orient = d[o + ORIENT] as number;
      if (orient === ORIENT_STRETCH) {
        // Along the way it flies now (or the way it was laid, while it has no speed); never longer than it has come.
        let ax = (d[o + TX] as number) + ((d[o + VX] as number) - (d[o + TX] as number)) * e;
        let ay = (d[o + TY] as number) + ((d[o + VY] as number) - (d[o + TY] as number)) * e;
        let az = landed ? 0 : (d[o + TZ] as number) + ((d[o + VZ] as number) - (d[o + TZ] as number)) * e + (d[o + GRAV] as number) * t;
        let speed = Math.hypot(ax, ay, az);
        let len = d[o + LEN] as number;
        if (speed < 1e-3) {
          ax = d[o + AX] as number;
          ay = d[o + AY] as number;
          az = d[o + AZ] as number;
          speed = Math.hypot(ax, ay, az);
        } else len = Math.min(len, Math.hypot(x - (d[o + X] as number), y - (d[o + Y] as number), z - (d[o + Z] as number)) + size);
        const s = speed > 1e-6 ? len / speed : 0;
        out[q + 4] = ax * s;
        out[q + 5] = ay * s;
        out[q + 6] = az * s;
      } else {
        out[q + 4] = 0;
        out[q + 5] = 0;
        out[q + 6] = 0;
      }
      out[q + 7] = (d[o + ROT] as number) + (d[o + SPIN] as number) * t;
      const kind = d[o + KIND] as number;
      const info = kind >= 0 ? books[kind] : undefined;
      if (info) {
        const book = info.book;
        const fps = d[o + FPS] as number;
        let frame = fps > 0 ? (d[o + FRAME0] as number) + fps * t : (d[o + FRAME0] as number) + (book.frames - 1 - (d[o + FRAME0] as number)) * u;
        let first: number;
        let next: number;
        if (book.loop) {
          frame -= Math.floor(frame / book.frames) * book.frames;
          first = Math.floor(frame);
          next = first + 1 >= book.frames ? 0 : first + 1;
        } else {
          frame = Math.min(book.frames - 1, Math.max(0, frame));
          first = Math.floor(frame);
          next = Math.min(book.frames - 1, first + 1);
        }
        frameCorner(book, info.sheet, first, a);
        frameCorner(book, info.sheet, next, b);
        out[q + 8] = a[0];
        out[q + 9] = a[1];
        out[q + 10] = b[0];
        out[q + 11] = b[1];
        out[q + 12] = info.cw;
        out[q + 13] = info.ch;
        out[q + 14] = frame - first;
        out[q + 15] = book.atlas;
        out[q + 28] = book.pivot[0];
        out[q + 29] = book.pivot[1];
      } else {
        out[q + 8] = 0;
        out[q + 9] = 0;
        out[q + 10] = 0;
        out[q + 11] = 0;
        out[q + 12] = 1;
        out[q + 13] = 1;
        out[q + 14] = 0;
        // A flipbook that is not here (the pictures have not come, or never will) is drawn as the shader's own puff.
        out[q + 15] = kind >= 0 ? SHAPE_PUFF : kind;
        out[q + 28] = 0.5;
        out[q + 29] = 0.5;
      }
      out[q + 16] = (d[o + R0] as number) + ((d[o + R1] as number) - (d[o + R0] as number)) * u;
      out[q + 17] = (d[o + G0] as number) + ((d[o + G1] as number) - (d[o + G0] as number)) * u;
      out[q + 18] = (d[o + B0] as number) + ((d[o + B1] as number) - (d[o + B0] as number)) * u;
      out[q + 19] = alpha;
      out[q + 20] = d[o + OPACITY] as number;
      out[q + 21] = d[o + GAIN] as number;
      out[q + 22] = d[o + LIT] as number;
      out[q + 23] = d[o + ASPECT] as number;
      out[q + 24] = orient;
      out[q + 25] = d[o + SEED] as number;
      out[q + 26] = (d[o + WARM] as number) * Math.exp(-WARM_FADE * t);
      out[q + 27] = u;
      out[q + 30] = d[o + MODE] as number;
      out[q + 31] = d[o + FLIP] as number;
      w++;

      const cast = d[o + SHADOW] as number;
      if (cast > 0 && shade.dark > 0 && dn < DECALS) {
        const soft = 1 + shade.soften * z;
        const dark = (cast * alpha * shade.dark) / soft;
        if (dark > 0.004) {
          const dq = dn * DECAL_STRIDE;
          decals[dq] = x + shade.dx * z;
          decals[dq + 1] = y + shade.dy * z;
          decals[dq + 2] = 0.5 * size * soft;
          decals[dq + 3] = 0;
          decals[dq + 4] = 0;
          decals[dq + 5] = 0;
          decals[dq + 6] = 0;
          decals[dq + 7] = dark;
          dn++;
        }
      }
    }
    this.instances = w;
    this.decals = dn;
  }
}
