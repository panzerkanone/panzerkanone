/**
 * The PLAY GAME medallion's sounds: six of them, made by sums and from no
 * recording (the effects' library has no fire and no struck plate). Plain: no
 * browser and no audio in it (the Node tests work every one out and measure
 * it). The page has them worked out off its own thread (medallion-worker.ts,
 * sounds.ts) and the effects' engine plays them (sfx.ts: its made cues).
 *
 *   fire      the standing burn: a loop of crackle, hiss and the low flutter of
 *             flame, whose level the picture sets
 *   smoulder  a low flame wakes along the rim: a soft, dull crackle
 *   spit      a handful of embers thrown off: a few small dry pops
 *   ignite    the fire catches: a soft thump and a rush of flame
 *   surge     the band of light crosses the lit letters: a faint shimmer of
 *             hot metal, the plate's own high modes
 *   strike    the press: a hammer on thick steel plate, a flare of flame,
 *             embers thrown
 *
 * How each is made:
 *   - a crackle is a burst of noise a few thousandths of a second long through
 *     a resonance; fire is very many of them, most of them small, with a hiss
 *     and a flutter under them (noise in a narrow band about 30 Hz, driven
 *     hard and clipped: the flapping of a flame);
 *   - a rush of flame is noise under a corner that opens and falls back,
 *     fluttering, with the flame's low flapping under it;
 *   - the plate is a steel disc: its modes stand at the ratios of a free
 *     circular plate above its lowest (PLATE), each a decaying sine doubled a
 *     few hertz apart so that it beats, the high ones dying first. The blow
 *     itself is a click, a clank, a knock and the hiss of the crash dying; the
 *     modes and the blow are pressed together through a soft curve, which
 *     makes the first hundredths of a second a crash and leaves what rings on
 *     clean; and the hammer's weight is a short thud under them.
 *
 * Nothing is drawn at random: every number comes from a seeded stream, the
 * same for the same sound and take. Each sound is brought to its own loudness
 * (measured as the recorded cues are: K-weighted, its loudest 0.4 s; the loop
 * by the whole of it) under its own peak ceiling.
 *
 * The shapes here come from how such sounds are known to be built, and were
 * set by measurement, not by ear: lengths, peaks, loudness and pictures of
 * their spectra (tests/audio/medallion.test.ts holds them to the numbers).
 * tools/sounds/made.ts writes each one as a file to listen to.
 */
import { spread } from './cues';

export const MEDALLION_MOMENTS = ['smoulder', 'spit', 'ignite', 'surge', 'strike'] as const;
/** A moment of the medallion that has a sound of its own. */
export type MedallionMoment = (typeof MEDALLION_MOMENTS)[number];
export type MedallionSound = 'fire' | MedallionMoment;

/** How each sound is levelled: its loudness in LUFS (`whole`: of all of it, else of its loudest 0.4 s), under a peak ceiling of full scale; and how many takes it has. */
export const MEDALLION_LEVELS: Readonly<Record<MedallionSound, { readonly lufs: number; readonly ceiling: number; readonly whole: boolean; readonly takes: number }>> = {
  fire: { lufs: -26, ceiling: 0.6, whole: true, takes: 1 },
  smoulder: { lufs: -30, ceiling: 0.4, whole: false, takes: 2 },
  spit: { lufs: -30, ceiling: 0.68, whole: false, takes: 3 },
  ignite: { lufs: -21, ceiling: 0.6, whole: false, takes: 1 },
  surge: { lufs: -27, ceiling: 0.3, whole: false, takes: 1 },
  strike: { lufs: -15, ceiling: 0.68, whole: false, takes: 1 },
};

// ---- numbers in a seeded stream -------------------------------------------------------------------

type Rnd = () => number;

/** A stream of numbers in [0, 1) for a sound and a take: the same every time. */
function stream(name: string, take: number): Rnd {
  let a = Math.floor(spread(`medallion.${name}`, take, 7) * 4294967296) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** 0 below `a`, 1 above `b`, a soft step between. */
const step = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---- filters ----------------------------------------------------------------------------------------

/** A two-pole filter, one sample at a time. Its corner may be moved while it runs. */
class Filter {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  private set(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): this {
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
    return this;
  }
  /** Lets through what is below `hz`. */
  low(rate: number, hz: number, q = Math.SQRT1_2): this {
    const w = (TAU * Math.min(hz, rate * 0.45)) / rate;
    const c = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    return this.set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + alpha, -2 * c, 1 - alpha);
  }
  /** Lets through what is above `hz`. */
  high(rate: number, hz: number, q = Math.SQRT1_2): this {
    const w = (TAU * Math.min(hz, rate * 0.45)) / rate;
    const c = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    return this.set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + alpha, -2 * c, 1 - alpha);
  }
  /** Lets through a band about `hz` (as it is at `hz`; the higher `q`, the narrower). */
  band(rate: number, hz: number, q: number): this {
    const w = (TAU * Math.min(hz, rate * 0.45)) / rate;
    const alpha = Math.sin(w) / (2 * q);
    return this.set(alpha, 0, -alpha, 1 + alpha, -2 * Math.cos(w), 1 - alpha);
  }
  /** The K weighting's two stages (ITU-R BS.1770), for any rate. */
  shelf(rate: number): this {
    const k = Math.tan((Math.PI * 1681.974450955533) / rate);
    const vh = 10 ** (3.999843853973347 / 20);
    const vb = vh ** 0.4996667741545416;
    const q = 0.7071752369554196;
    return this.set(vh + (vb * k) / q + k * k, 2 * (k * k - vh), vh - (vb * k) / q + k * k, 1 + k / q + k * k, 2 * (k * k - 1), 1 - k / q + k * k);
  }
  rumble(rate: number): this {
    const k = Math.tan((Math.PI * 38.13547087602444) / rate);
    const q = 0.5003270373238773;
    const a0 = 1 + k / q + k * k;
    return this.set(a0, -2 * a0, a0, a0, 2 * (k * k - 1), 1 - k / q + k * k);
  }
  step(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

// ---- loudness ---------------------------------------------------------------------------------------

/**
 * A sound's loudness in LUFS, as the standard measures it (ITU-R BS.1770: the K weighting, then the
 * mean square of all channels): of the whole of it (`window` null), or of its loudest `window` seconds,
 * stepping a quarter of the window at a time (a sound shorter than the window is measured with silence
 * after it, as the recorded cues are).
 */
export function loudness(channels: readonly Float32Array[], rate: number, window: number | null): number {
  const n = channels[0]?.length ?? 0;
  if (n === 0) return Number.NEGATIVE_INFINITY;
  const hop = window === null ? n : Math.max(1, Math.round((window * rate) / 4));
  const blocks = new Float64Array(Math.ceil(n / hop));
  for (const channel of channels) {
    const shelf = new Filter().shelf(rate);
    const rumble = new Filter().rumble(rate);
    for (let i = 0; i < n; i++) {
      const z = rumble.step(shelf.step(channel[i] as number));
      const b = Math.floor(i / hop);
      blocks[b] = (blocks[b] as number) + z * z;
    }
  }
  let most = 0;
  if (window === null) most = (blocks[0] as number) / n;
  else {
    for (let b = 0; b < blocks.length; b++) {
      let sum = 0;
      for (let k = 0; k < 4 && b + k < blocks.length; k++) sum += blocks[b + k] as number;
      most = Math.max(most, sum / (4 * hop));
    }
  }
  return most > 0 ? -0.691 + 10 * Math.log10(most) : Number.NEGATIVE_INFINITY;
}

/** The largest sample, of full scale. */
export function peakOf(channels: readonly Float32Array[]): number {
  let peak = 0;
  for (const channel of channels) for (let i = 0; i < channel.length; i++) peak = Math.max(peak, Math.abs(channel[i] as number));
  return peak;
}


// ---- the parts sounds are built from ----------------------------------------------------------------

/** Two channels of one length. */
interface Two {
  readonly l: Float32Array;
  readonly r: Float32Array;
}
const two = (n: number): Two => ({ l: new Float32Array(n), r: new Float32Array(n) });
const add = (to: Float32Array, i: number, v: number): void => {
  to[i] = (to[i] as number) + v;
};
/** What a sound at `pan` (-1 left to 1 right) is multiplied by on each side: the same power wherever it is. */
const sides = (pan: number): [number, number] => {
  const a = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)];
};
/** The size (root mean square) of noise let through `Filter.band(rate, hz, q)`: the narrower the band, the quieter. */
const bandSize = (rate: number, hz: number, q: number): number => Math.sqrt((Math.PI * Math.min(hz, rate * 0.45)) / (3 * q * rate));
/** A soft curve: what is small passes as it is, what is large is pressed toward 1. */
const soft = (x: number): number => x / Math.sqrt(1 + x * x);

interface Crack {
  /** The middle of its band, Hz, and how narrow the band is. */
  hz: number;
  q: number;
  /** Seconds in which it falls to about a third. */
  decay: number;
  /** About its largest sample. */
  level: number;
  pan: number;
}

/**
 * One crackle, `at` seconds in: a burst of noise that dies in a few thousandths of a second, through
 * a resonance. `wrap`: what runs past the end comes round to the start (a loop).
 */
function crack(out: Two, rate: number, at: number, o: Crack, rnd: Rnd, wrap: boolean): void {
  const n = out.l.length;
  const band = new Filter().band(rate, o.hz, o.q);
  const length = Math.max(12, Math.round(o.decay * 7 * rate));
  const fall = Math.exp(-1 / (o.decay * rate));
  const level = o.level / (3 * bandSize(rate, o.hz, o.q));
  const [left, right] = sides(o.pan);
  let env = 1;
  const start = Math.round(at * rate);
  for (let i = 0; i < length; i++) {
    const y = band.step((rnd() * 2 - 1) * env) * level * (i < 3 ? (i + 1) / 4 : 1);
    env *= fall;
    let j = start + i;
    if (j >= n) {
      if (!wrap) break;
      j %= n;
    }
    add(out.l, j, y * left);
    add(out.r, j, y * right);
  }
}

/** An ember thrown off: a dry pop, and the faint fizz of a spark in the air after it. */
function ember(out: Two, rate: number, at: number, size: number, pan: number, rnd: Rnd): void {
  crack(out, rate, at, { hz: 1200 * 2 ** (rnd() * 2), q: 0.9 + rnd() * 1.5, decay: 0.0006 + 0.002 * rnd(), level: size, pan }, rnd, false);
  crack(out, rate, at + 0.0015, { hz: 6200 + 3000 * rnd(), q: 0.7, decay: 0.015 + 0.03 * rnd(), level: size * 0.07, pan }, rnd, false);
}

/**
 * The bed of a flame, `n` samples of it. `lap`: the flapping of the flame, between 0 and 1 (noise in a
 * narrow band about `flap` Hz, driven hard and clipped, its edges rounded). `bed`: that flapping as a
 * low rumble (of about the size `rumble`), and the flame's breath, noise in a wide band about `hz`
 * that swells and thins with the flapping (of about the size `breath`). Worked out at a low rate,
 * which is all its band needs, and drawn out to the full one.
 */
function flame(rate: number, n: number, rnd: Rnd, o: { flap: number; rumble: number; hz: number; breath: number }): { lap: Float32Array; bed: Float32Array } {
  const every = Math.max(1, Math.round(rate / 12000));
  const slow = rate / every;
  const count = Math.ceil(n / every) + 2;
  const narrow = new Filter().band(slow, o.flap, 4);
  const round = new Filter().low(slow, 110);
  // The band's own size falls as the rate rises: the drive keeps it clipping most of the time at any rate.
  const drive = 2.6 / bandSize(slow, o.flap, 4);
  const low = new Filter().low(slow, 480);
  const dc = new Filter().high(slow, 40);
  const wide = new Filter().band(slow, o.hz, 0.6);
  const breath = o.breath / (0.65 * bandSize(slow, o.hz, 0.6));
  const laps = new Float32Array(count);
  const beds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const m = 0.5 + 0.5 * round.step(clamp(narrow.step(rnd() * 2 - 1) * drive, -1, 1));
    laps[i] = m;
    beds[i] = low.step(dc.step(m - 0.5)) * o.rumble * 2.5 + wide.step(rnd() * 2 - 1) * (0.3 + 0.7 * m) * breath;
  }
  const lap = new Float32Array(n);
  const bed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = Math.floor(i / every);
    const f = (i - j * every) / every;
    lap[i] = (laps[j] as number) * (1 - f) + (laps[j + 1] as number) * f;
    bed[i] = (beds[j] as number) * (1 - f) + (beds[j + 1] as number) * f;
  }
  return { lap, bed };
}

interface Mode {
  hz: number;
  /** Seconds in which it falls to about a third. */
  decay: number;
  level: number;
  pan: number;
  /** Seconds over which it comes in; none: it is struck. */
  attack: number;
}

/**
 * One mode of the plate ringing from `at` seconds: a sine that dies away (and is left when it has
 * fallen 70 dB).
 */
function ring(out: Two, rate: number, at: number, o: Mode, phase: number): void {
  const start = Math.round(at * rate);
  const length = Math.min(out.l.length - start, Math.round((o.decay * 8 + o.attack) * rate));
  if (o.hz >= rate * 0.45 || length <= 0) return;
  const w = (TAU * o.hz) / rate;
  const r = Math.exp(-1 / (o.decay * rate));
  const k = 2 * r * Math.cos(w);
  const rr = r * r;
  let was = Math.sin(phase - w) / r;
  let now = Math.sin(phase);
  const [left, right] = sides(o.pan);
  const rise = Math.round(o.attack * rate);
  for (let i = 0; i < length; i++) {
    const y = now * o.level * (i < rise ? 0.5 - 0.5 * Math.cos((Math.PI * i) / rise) : 1);
    add(out.l, start + i, y * left);
    add(out.r, start + i, y * right);
    const next = k * now - rr * was;
    was = now;
    now = next;
  }
}

/** The same mode stirred by noise, not struck: a very narrow band of it, which wavers as hot metal does. */
function waver(out: Two, rate: number, at: number, o: Mode, rnd: Rnd): void {
  const start = Math.round(at * rate);
  const length = Math.min(out.l.length - start, Math.round((o.decay * 8 + o.attack) * rate));
  if (o.hz >= rate * 0.45 || length <= 0) return;
  const band = new Filter().band(rate, o.hz, 90);
  const level = o.level / bandSize(rate, o.hz, 90);
  const fall = Math.exp(-1 / (o.decay * rate));
  const [left, right] = sides(o.pan);
  const rise = Math.round(o.attack * rate);
  let env = 1;
  for (let i = 0; i < length; i++) {
    const y = band.step(rnd() * 2 - 1) * level * env * (i < rise ? 0.5 - 0.5 * Math.cos((Math.PI * i) / rise) : 1);
    env *= fall;
    add(out.l, start + i, y * left);
    add(out.r, start + i, y * right);
  }
}

/**
 * The steel disc. Its lowest mode, Hz, and where the others stand above it: the modes of a free
 * circular plate (two nodal diameters, one nodal circle, three diameters, and so on), which are not
 * harmonics of one another, which is why a struck plate clangs and does not sing.
 */
const PLATE = {
  lowest: 196,
  ratios: [1, 1.73, 2.33, 3.91, 4.11, 6.3, 6.71, 7.34, 8.91, 10.07, 11.4, 11.9, 13.2, 14.3, 15.6, 17.3, 18.7, 20.1, 22.4, 24.9, 27.1, 29.8, 33, 36.5, 40.2, 44.1],
} as const;
/** Seconds for a struck mode at `hz` to fall 60 dB: steel rings long, and its high modes die first. */
const ringTime = (hz: number): number => 3 / (1 + (hz / 1700) ** 1.1);

/**
 * A rush of flame into `out` from `at` seconds: noise under a corner that opens (from `from` Hz to `to`)
 * and falls back (to `rest`), fluttering, with a little of the air above it (`air`) and the flame's low
 * flapping under it (`body`).
 */
function rush(out: Two, rate: number, at: number, o: { seconds: number; rise: number; fall: number; from: number; to: number; rest: number; level: number; air: number; body: number }, rnd: Rnd): void {
  const start = Math.round(at * rate);
  const n = Math.min(out.l.length - start, Math.round(o.seconds * rate));
  for (const channel of [out.l, out.r]) {
    const { lap, bed } = flame(rate, n, rnd, { flap: 27, rumble: o.body, hz: 300, breath: 0 });
    const under = new Filter();
    const floor = new Filter().high(rate, 150);
    const air = new Filter().high(rate, 3200);
    let size = 1;
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      // It comes up over `rise` and dies away after it; its corner opens with it and falls back more slowly.
      const up = step(0, o.rise, t);
      const past = Math.max(0, t - o.rise);
      const env = up * Math.exp(-past / o.fall) * (1 - step(o.seconds - 0.2, o.seconds, t));
      if (i % 16 === 0) {
        const hz = o.from + (o.to - o.from) * up * Math.exp(-past / (o.fall * 1.8)) + (o.rest - o.from) * step(o.rise, o.seconds, t);
        under.low(rate, hz, 1.1);
        // Noise under a corner is the quieter the lower the corner: this keeps its size, so that only `env` shapes it.
        size = 1 / Math.sqrt((2 * hz) / (3 * rate));
      }
      const x = rnd() * 2 - 1;
      add(channel, start + i, ((under.step(floor.step(x)) * size + air.step(x) * o.air) * (0.45 + 0.55 * (lap[i] as number)) + (bed[i] as number)) * env * o.level);
    }
  }
}

/** The last `seconds` fade to nothing, and what is below hearing is taken out. */
function finish(s: Two, rate: number, seconds: number): void {
  const n = s.l.length;
  const fade = Math.min(n, Math.round(seconds * rate));
  for (const channel of [s.l, s.r]) {
    const dc = new Filter().high(rate, 28);
    for (let i = 0; i < n; i++) channel[i] = dc.step(channel[i] as number) * (i >= n - fade ? step(0, 1, (n - 1 - i) / fade) : 1);
  }
}

// ---- the six sounds ---------------------------------------------------------------------------------

/** A handful of embers thrown off: a few small dry pops close together. */
function spit(rate: number, rnd: Rnd): Two {
  const out = two(Math.round(0.5 * rate));
  const count = 5 + Math.floor(rnd() * 3);
  let at = 0.003;
  for (let i = 0; i < count && at < 0.42; i++) {
    ember(out, rate, at, i === 0 ? 1 : 0.3 + 0.6 * rnd(), (rnd() * 2 - 1) * 0.7, rnd);
    // Most come close together, a straggler now and then.
    at += 0.012 + 0.16 * rnd() ** 3;
  }
  finish(out, rate, 0.03);
  return out;
}

/** A low flame wakes: a few soft, dull crackles, and the flutter of a small flame under them. */
function smoulder(rate: number, rnd: Rnd): Two {
  const seconds = 1.8;
  const n = Math.round(seconds * rate);
  const out = two(n);
  const swell = (t: number): number => step(0, 0.5, t) * (1 - step(0.9, seconds, t));
  for (const channel of [out.l, out.r]) {
    const { bed } = flame(rate, n, rnd, { flap: 19, rumble: 0.012, hz: 420, breath: 0.03 });
    for (let i = 0; i < n; i++) channel[i] = (bed[i] as number) * swell(i / rate);
  }
  for (let at = 0.1; at < seconds - 0.2; at += -Math.log(1 - rnd()) / 16) {
    const here = swell(at);
    if (rnd() > here) continue;
    crack(out, rate, at, { hz: 420 * 2 ** (rnd() * 2.3), q: 1 + rnd(), decay: 0.0015 + 0.006 * rnd(), level: (0.12 + 0.9 * rnd() ** 3) * here, pan: (rnd() * 2 - 1) * 0.6 }, rnd, false);
  }
  // Dull: a low flame has no snap in it.
  for (const channel of [out.l, out.r]) {
    const dull = new Filter().low(rate, 3600);
    for (let i = 0; i < n; i++) channel[i] = dull.step(channel[i] as number);
  }
  finish(out, rate, 0.05);
  return out;
}

/** The fire catches: a soft thump as it takes, and a rush of flame after it. */
function ignite(rate: number, rnd: Rnd): Two {
  const seconds = 1.05;
  const n = Math.round(seconds * rate);
  const out = two(n);
  // The catch: a puff of low noise, and one soft pop in it.
  for (const channel of [out.l, out.r]) {
    const low = new Filter().low(rate, 300);
    const length = Math.round(0.4 * rate);
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      add(channel, i, low.step(rnd() * 2 - 1) * step(0, 0.004, t) * Math.exp(-t / 0.055) * 2.2);
    }
  }
  crack(out, rate, 0.003, { hz: 900, q: 1.2, decay: 0.005, level: 0.35, pan: 0 }, rnd, false);
  rush(out, rate, 0.02, { seconds: seconds - 0.02, rise: 0.2, fall: 0.27, from: 300, to: 1400, rest: 450, level: 0.25, air: 0.14, body: 0.6 }, rnd);
  // The first crackles of the new fire.
  for (let at = 0.1; at < 0.9; at += -Math.log(1 - rnd()) / 13) {
    crack(out, rate, at, { hz: 1000 * 2 ** (rnd() * 2.6), q: 0.8 + 1.4 * rnd(), decay: 0.0004 + 0.0016 * rnd(), level: (0.04 + 0.3 * rnd() ** 3) * (1 - step(0.5, 0.95, at)), pan: (rnd() * 2 - 1) * 0.7 }, rnd, false);
  }
  finish(out, rate, 0.15);
  return out;
}

/** The glow surges: the plate's high modes come up one after another and die away, beating and wavering, with a breath of air over them. */
function surge(rate: number, rnd: Rnd): Two {
  const seconds = 1.25;
  const n = Math.round(seconds * rate);
  const out = two(n);
  const modes = [7.34, 13.2, 15.6, 18.7, 22.4, 27.1, 33, 40.2];
  modes.forEach((ratio, k) => {
    const hz = PLATE.lowest * ratio;
    const at = 0.03 * k;
    // To either side in turn, so that neither side has more of it.
    const mode = { decay: 0.34 - 0.022 * k, level: (k === 0 ? 0.15 : 1) / (1 + 0.22 * k) / 2, pan: (k % 2 === 0 ? -1 : 1) * (0.15 + 0.3 * rnd()), attack: 0.09 };
    // Two of it a few hertz apart, which beat; and the same mode stirred by noise, which wavers.
    const beat = 2 + 5 * rnd();
    ring(out, rate, at, { ...mode, hz: hz - beat / 2, level: mode.level / 2, pan: mode.pan - 0.25 }, rnd() * TAU);
    ring(out, rate, at, { ...mode, hz: hz + beat / 2, level: mode.level / 2, pan: mode.pan + 0.25 }, rnd() * TAU);
    waver(out, rate, at, { ...mode, hz }, rnd);
  });
  for (const channel of [out.l, out.r]) {
    const air = new Filter().high(rate, 7000);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      add(channel, i, air.step(rnd() * 2 - 1) * step(0, 0.2, t) * Math.exp(-Math.max(0, t - 0.2) / 0.3) * 0.12);
    }
  }
  finish(out, rate, 0.12);
  return out;
}

/** The press: a hammer on the plate, a flare of flame off it, embers thrown. */
function strike(rate: number, rnd: Rnd): Two {
  const seconds = 2.4;
  const n = Math.round(seconds * rate);
  const metal = two(n);
  // The plate rings: every mode, twice a few hertz apart so that it beats, the high ones weaker and dying first.
  PLATE.ratios.forEach((ratio, k) => {
    const hz = PLATE.lowest * ratio;
    const level = (0.45 + 0.55 * rnd()) * (hz > 1800 ? 1800 / hz : 1) * (k < 2 ? 0.7 : 1);
    const decay = ringTime(hz) / 6.91;
    const pan = (rnd() * 2 - 1) * 0.55;
    const apart = hz * (0.0015 + 0.004 * rnd());
    const share = 0.35 + 0.3 * rnd();
    ring(metal, rate, 0, { hz: hz - apart / 2, decay, level: level * share, pan, attack: 0 }, rnd() * TAU);
    ring(metal, rate, 0, { hz: hz + apart / 2, decay: decay * (0.8 + 0.3 * rnd()), level: level * (1 - share), pan: -pan * 0.6, attack: 0 }, rnd() * TAU);
  });
  // Above those a real plate has modes past counting, which are heard as its crash: some more of them, where they fall.
  for (let k = 0; k < 16; k++) {
    const hz = 2400 * 2 ** (rnd() * 1.9);
    ring(metal, rate, 0, { hz, decay: (ringTime(hz) * (0.35 + 0.4 * rnd())) / 6.91, level: (0.12 + 0.2 * rnd()) * (2400 / hz) ** 0.5, pan: (rnd() * 2 - 1) * 0.7, attack: 0 }, rnd() * TAU);
  }
  // The blow itself: the click of steel on steel, a rougher clank after it, the hiss of the crash dying, and a knock.
  crack(metal, rate, 0, { hz: 3400, q: 0.5, decay: 0.0014, level: 3.2, pan: 0 }, rnd, false);
  crack(metal, rate, 0.0005, { hz: 1500, q: 0.7, decay: 0.007, level: 1.5, pan: 0 }, rnd, false);
  crack(metal, rate, 0.0008, { hz: 5200, q: 0.4, decay: 0.03, level: 0.8, pan: 0 }, rnd, false);
  crack(metal, rate, 0.001, { hz: 290, q: 0.9, decay: 0.028, level: 1.6, pan: 0 }, rnd, false);
  // Pressed through a soft curve: the first hundredths of a second are a crash, and what rings on after is clean.
  const out = two(n);
  for (let i = 0; i < n; i++) {
    out.l[i] = soft((metal.l[i] as number) * 0.45);
    out.r[i] = soft((metal.r[i] as number) * 0.45);
  }
  // The weight of the hammer: a short thud that falls a little in pitch.
  const thud = Math.round(0.4 * rate);
  let phase = 0;
  for (let i = 0; i < thud; i++) {
    const t = i / rate;
    phase += (TAU * (55 + 40 * Math.exp(-t / 0.04))) / rate;
    const y = Math.sin(phase) * Math.exp(-t / 0.06) * step(0, 0.002, t) * 0.3;
    add(out.l, i, y);
    add(out.r, i, y);
  }
  // The flare: the fire leaps off the struck plate, with a low breath under it.
  rush(out, rate, 0.015, { seconds: 1.4, rise: 0.07, fall: 0.28, from: 450, to: 1900, rest: 400, level: 0.09, air: 0.22, body: 0.6 }, rnd);
  for (const channel of [out.l, out.r]) {
    const low = new Filter().low(rate, 170);
    const length = Math.round(1.1 * rate);
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      add(channel, i, low.step(rnd() * 2 - 1) * step(0, 0.05, t) * Math.exp(-Math.max(0, t - 0.05) / 0.2) * 2.2);
    }
  }
  // Embers thrown: many at first, the last of them a second and more after the blow.
  for (let k = 0; k < 18; k++) {
    const at = 0.035 + 1.35 * rnd() ** 2;
    ember(out, rate, at, (0.1 + 0.3 * rnd()) * (1 - at / 1.7), (rnd() * 2 - 1) * 0.9, rnd);
  }
  finish(out, rate, 0.3);
  return out;
}

/** The loop's length, seconds, and how much of its bed's end is folded over its start so that it has no seam. */
const LOOP = { seconds: 6.4, fold: 0.5 };

/**
 * The standing burn, a loop: very many crackles, most of them small (they wrap round the loop's end),
 * over a bed of the flame's flutter and breath, and a hiss that comes and goes. The bed is made a
 * little longer than the loop and its end folded over its start, so that the loop has no seam; the
 * crackles' flurries and the hiss's swells are whole numbers of waves to the loop.
 */
function fire(rate: number, rnd: Rnd): Two {
  const n = Math.round(LOOP.seconds * rate);
  const fold = Math.round(LOOP.fold * rate);
  const out = two(n);
  /** A slow wandering between 0 and 1 that comes round with the loop. */
  const wander = (waves: readonly number[]): ((t: number) => number) => {
    const turns = waves.map(k => ({ k, phase: rnd() * TAU, size: 0.6 + 0.4 * rnd() }));
    const most = turns.reduce((sum, w) => sum + w.size, 0);
    return t => 0.5 + (0.5 * turns.reduce((sum, w) => sum + w.size * Math.sin((TAU * w.k * t) / LOOP.seconds + w.phase), 0)) / most;
  };
  for (const channel of [out.l, out.r]) {
    const { bed } = flame(rate, n + fold, rnd, { flap: 26, rumble: 0.02, hz: 650, breath: 0.022 });
    // The end folded over the start: the two are not alike, so each keeps its share of the power.
    for (let i = 0; i < n; i++) {
      if (i >= fold) channel[i] = bed[i] as number;
      else {
        const a = ((i / fold) * Math.PI) / 2;
        channel[i] = (bed[i] as number) * Math.sin(a) + (bed[n + i] as number) * Math.cos(a);
      }
    }
    // The hiss: the top of the noise, swelling now and then.
    const swell = wander([2, 3, 5, 8]);
    // (Its swell is worked out now and then, and drawn straight between.)
    const every = 256;
    let from = swell(0) ** 4;
    let to = from;
    let was = 0;
    for (let i = 0; i < n; i++) {
      if (i % every === 0) {
        from = to;
        to = swell((i + every) / rate) ** 4;
      }
      const x = rnd() * 2 - 1;
      add(channel, i, (x - was) * (0.004 + 0.03 * (from + ((to - from) * (i % every)) / every)));
      was = x;
    }
  }
  // The crackles: they come in flurries, thick and thin.
  const flurry = wander([1, 3, 4, 7]);
  for (let at = 0; at < LOOP.seconds; at += -Math.log(1 - rnd()) / 62) {
    if (rnd() > 0.25 + 0.75 * flurry(at)) continue;
    const kind = rnd();
    const pan = (rnd() * 2 - 1) * 0.8;
    if (kind < 0.72) {
      // A snap.
      crack(out, rate, at, { hz: 1100 * 2 ** (rnd() * 2.6), q: 0.8 + 1.4 * rnd(), decay: 0.0003 + 0.0015 * rnd(), level: 0.07 + 0.55 * rnd() ** 3.2, pan }, rnd, true);
    } else if (kind < 0.92) {
      // A duller tick.
      crack(out, rate, at, { hz: 350 * 2 ** (rnd() * 1.8), q: 1 + 1.5 * rnd(), decay: 0.002 + 0.005 * rnd(), level: 0.1 + 0.4 * rnd() ** 3, pan }, rnd, true);
    } else {
      // A pop, low and round, with a snap on it.
      const level = 0.2 + 0.3 * rnd() ** 2;
      crack(out, rate, at, { hz: 180 * 2 ** (rnd() * 1.4), q: 1.2 + 0.8 * rnd(), decay: 0.008 + 0.012 * rnd(), level, pan }, rnd, true);
      crack(out, rate, at, { hz: 2200 * 2 ** rnd(), q: 1, decay: 0.0008, level: level * 0.7, pan }, rnd, true);
    }
  }
  return out;
}

const MAKERS: Readonly<Record<MedallionSound, (rate: number, rnd: Rnd) => Two>> = { fire, smoulder, spit, ignite, surge, strike };

/**
 * One of the medallion's sounds, worked out: its two channels at `rate` samples a second, at its own
 * loudness under its own ceiling (MEDALLION_LEVELS). `take` (from 0): which of its takes; every take
 * of a sound is the same sound drawn from another stream.
 */
export function medallionSound(sound: MedallionSound, take: number, rate: number): [Float32Array, Float32Array] {
  const how = MEDALLION_LEVELS[sound];
  const made = MAKERS[sound](rate, stream(sound, take));
  const channels: [Float32Array, Float32Array] = [made.l, made.r];
  const peak = peakOf(channels);
  const gain = peak > 0 ? Math.min(10 ** ((how.lufs - loudness(channels, rate, how.whole ? null : 0.4)) / 20), how.ceiling / peak) : 0;
  for (const channel of channels) for (let i = 0; i < channel.length; i++) channel[i] = (channel[i] as number) * gain;
  return channels;
}

// ---- as the engine plays them -----------------------------------------------------------------------

/**
 * The cue each sound is played as (a made cue of the engine's, sfx.ts) and how it may be played:
 * least time between two starts, most voices at once, how far one playing differs from the next
 * (the press is the plate itself, and is the same every time). In the order they are worked out:
 * the press first.
 */
export const MEDALLION_CUES: readonly { readonly sound: MedallionSound; readonly id: string; readonly plays: string; readonly leastMs: number; readonly voices: number; readonly cents: number; readonly db: number }[] = [
  { sound: 'strike', id: 'medallion-strike', plays: 'the PLAY GAME medallion is pressed', leastMs: 200, voices: 2, cents: 0, db: 0 },
  { sound: 'ignite', id: 'medallion-ignite', plays: 'the medallion catches fire under the pointer', leastMs: 250, voices: 2, cents: 50, db: 1 },
  { sound: 'fire', id: 'medallion-fire', plays: 'the medallion burns: a standing sound, at the level of its flames', leastMs: 0, voices: 1, cents: 0, db: 0 },
  { sound: 'spit', id: 'medallion-spit', plays: 'the medallion throws off a handful of embers', leastMs: 70, voices: 3, cents: 120, db: 1.5 },
  { sound: 'surge', id: 'medallion-surge', plays: 'the band of light crosses the lit letters of the medallion', leastMs: 300, voices: 2, cents: 15, db: 1 },
  { sound: 'smoulder', id: 'medallion-smoulder', plays: 'a low flame wakes along the rim of the medallion', leastMs: 400, voices: 2, cents: 80, db: 1.5 },
];
/** The standing burn's tone: dull while it is low, open at its full level (the corner of its low-pass, Hz). */
export const FIRE_TONE = { dark: 500, open: 16000 } as const;
/**
 * How the burn's level is heard: the engine is given the level to this power. A low fire is quieter
 * than a high one, but not by all of its level: at a level of 0.15 it sounds at about a third of its
 * full size, soft and dull, where a plain share would leave nothing to hear.
 */
export const FIRE_LAW = 0.6;

/** The medallion's sounds, as the title's picture asks for them. */
export interface MedallionSounds {
  /** How strongly its fire burns now, 0 to 1: the standing crackle follows it. */
  fire(level: number): void;
  /** One of its moments: how strong (0 to 1) and where from left (-1) to right (1). */
  moment(kind: MedallionMoment, strength: number, pan: number): void;
}

/**
 * The medallion's sounds through the effects' engine, and so under its switch and its volume: the
 * fire as a standing sound at the level given (by FIRE_LAW), a moment as its cue at `strength` of its
 * own level.
 * A moment of no strength, or of a kind there is not, is nothing.
 */
export function medallionSounds(engine: { play(cue: string, opts?: { gain?: number; pan?: number }): void; sustain(cue: string, level: number): void }): MedallionSounds {
  const cueOf = (sound: string): string | null => MEDALLION_CUES.find(c => c.sound === sound)?.id ?? null;
  const fire = cueOf('fire') as string;
  return {
    fire(level) {
      engine.sustain(fire, Number.isFinite(level) ? clamp(level, 0, 1) ** FIRE_LAW : 0);
    },
    moment(kind, strength, pan) {
      const cue = (MEDALLION_MOMENTS as readonly string[]).includes(kind) ? cueOf(kind) : null;
      const gain = Number.isFinite(strength) ? clamp(strength, 0, 1) : 0;
      if (cue === null || gain <= 0) return;
      engine.play(cue, { gain, pan: Number.isFinite(pan) ? clamp(pan, -1, 1) : 0 });
    },
  };
}
