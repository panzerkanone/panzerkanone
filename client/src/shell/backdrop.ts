/**
 * The title screen's picture: one canvas that draws, back to front,
 *
 *   1. the owner's empty battlefield;
 *   2. our own sky: the slow storm, the flashes of guns beyond the horizon, the smoke columns
 *      with fires at their feet, far shell bursts, runs of tracer;
 *   3. his title lettering (so that the big gun passes in front of it, as he painted it);
 *   4. his tanks, cut out of their sheet;
 *   5. our own foreground: a gun's flash, its light on the steel, its smoke, the dust it lifts and
 *      the round's streak when a tank fires; a shell landing on the near ground; drifting dust,
 *      ash and embers;
 *
 * Everything that moves is a plain function of the screen's clock and the seed (seeded.ts): no
 * effect keeps state from one frame to the next, so the same seed and time give the same picture,
 * and any moment can be drawn by itself (`t=` in the address). The clock runs only while the page
 * is shown, and the canvas is drawn about thirty times a second, never while the page is hidden.
 *
 * Smoke, fire and blast are the game's own flipbooks (assets/fx/v1/, handed in when they have
 * arrived: until then the painting drifts without them), tinted to the painting's greys; flashes,
 * light, tracers, embers and ash are drawn here.
 */
import type { Book, Books } from './books';
import { frameAt, frameOf } from './books';
import type { ShellArt } from './manifest';
import type { Rgb } from './places';
import {
  ASH, BURSTS, COLUMNS, DRIFT, DUST, EMBERS, FRAMES_PER_SECOND, GLOWS, GROUND_DUST, GUNS, GUN_SMOKE, HORIZON, LANES, OPENING, REDUCED_RATE, SKY_SHADE,
  SMOKE_DARK, SMOKE_PALE, STORM, STRIKES, WIND, placeOf,
} from './places';
import { drawsOf } from './seeded';
import { BRIGHT, Timetable } from './timetable';
import type { TitleEvent } from './timetable';

export interface BackdropPictures {
  battlefield: HTMLImageElement;
  tanks: HTMLImageElement;
  title: HTMLImageElement;
}
/** The effect pictures: the books, and the atlases they lie in, decoded. */
export interface BackdropFx {
  books: Books;
  atlases: readonly CanvasImageSource[];
}

export interface BackdropOptions {
  canvas: HTMLCanvasElement;
  art: ShellArt;
  seed: number;
  /** The viewer asks for less motion: the screen is still but for a slow drift of smoke. */
  reduced: boolean;
  /** The clock stands at this time (for captures); null: it runs. */
  frozenAt: number | null;
  /** Draw every place of stage.ts on the picture. */
  marks: boolean;
  /** An event has just started: where it is from left (-1) to right (1), and whether that is inside the window. */
  onEvent(e: TitleEvent, pan: number, onScreen: boolean): void;
}

export interface BackdropState {
  /** Frames drawn so far. */
  frames: number;
  /** The clock is running and frames are being drawn. */
  running: boolean;
  /** The screen's clock, seconds. */
  time: number;
  /** The starts of the bright events drawn so far (the last few hundred), on the screen's clock. */
  flashes: number[];
  /** Milliseconds of script a frame took: the mean of the last hundred or so, and the most. */
  drawMs: number;
  drawMsMost: number;
  /** The painting, and the effect pictures, have arrived. */
  painted: boolean;
  effects: boolean;
  /** The canvas's size in its own pixels. */
  pixels: [number, number];
}

export interface Backdrop {
  readonly state: BackdropState;
  /** The stage has a new size: the canvas, which fills it, is to hold this many of the display's pixels. */
  resize(pixels: readonly [number, number]): void;
  setPictures(p: BackdropPictures): void;
  setFx(fx: BackdropFx | null): void;
  /** With the clock standing (`frozenAt`): stands it at another time and draws that moment. */
  seek(t: number): void;
  /** Another screen covers the picture (true): its clock stands and nothing is drawn until it is shown again. */
  pause(paused: boolean): void;
  /** The screen's clock now, seconds. */
  now(): number;
  /** Stops for good. */
  dispose(): void;
}

const TAU = Math.PI * 2;
const clamp01 = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 1 : v);
const smooth = (v: number): number => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const frac = (v: number): number => v - Math.floor(v);
const rgb = (c: Rgb, a = 1): string => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
/** A burst of light: up in `rise` seconds, then dying away by `fall` seconds each time it drops to a third. */
const pulse = (age: number, rise: number, fall: number): number => (age < 0 ? 0 : age < rise ? age / rise : Math.exp(-(age - rise) / fall));

interface Sheet {
  image: CanvasImageSource;
  ox: number;
  oy: number;
  book: Book;
}

const FLASH_HOT: Rgb = [255, 248, 226];
const FLASH_WARM: Rgb = [255, 190, 112];
const FLASH_RED: Rgb = [255, 122, 44];
const FIRE_GLOW: Rgb = [255, 138, 58];
const EMBER: Rgb = [255, 128, 48];
const EMBER_GLOW: Rgb = [226, 70, 22];
const TRACER: Rgb = [255, 234, 186];
const TRACER_RED: Rgb = [255, 96, 70];
const ASH_INK: Rgb = [26, 23, 22];
const STORM_INK: Rgb = [30, 32, 38];
const NIGHT: Rgb = [6, 8, 12];
const DIRT: Rgb = [34, 29, 25];
const EARTH: Rgb = [84, 70, 58];
/** Seconds a gun's smoke lasts. */
const GUN_SMOKE_S = 3.6;
/** Seconds the effect pictures take to come in once they have arrived. */
const FX_IN_S = 1.4;

export function startBackdrop(o: BackdropOptions): Backdrop {
  const { canvas, art } = o;
  const [fw, fh] = art.frame;
  const found = canvas.getContext('2d', { alpha: false });
  if (!found) throw new Error('the title screen needs a 2D canvas');
  const ctx: CanvasRenderingContext2D = found;
  const table = new Timetable(o.seed);
  const puff = drawsOf(o.seed, 'title-puff');
  const look = drawsOf(o.seed, 'title-look');
  const speck = drawsOf(o.seed, 'title-speck');

  const state: BackdropState = { frames: 0, running: false, time: o.frozenAt ?? 0, flashes: [], drawMs: 0, drawMsMost: 0, painted: false, effects: false, pixels: [0, 0] };
  /** The canvas has been given its size. */
  let fitted = false;
  /** Canvas pixels to a pixel of the frame (the stage's own pixels): 1 at the art's own size, less on a smaller stage. */
  let k = 1;
  let pictures: BackdropPictures | null = null;
  let scaled: { back: CanvasImageSource; tanks: CanvasImageSource; title: CanvasImageSource } | null = null;
  let fx: BackdropFx | null = null;
  let sheets: Record<'cloudDark' | 'cloudPale' | 'smokeDark' | 'smokePale' | 'cloudDust' | 'wispDust' | 'gunSmoke' | 'gunWisp' | 'earth' | 'earthWisp' | 'burstDark' | 'flame' | 'blast', Sheet> | null = null;
  let storm: HTMLCanvasElement | null = null;
  let light: HTMLCanvasElement | null = null;
  let disposed = false;
  let paused = false;
  let raf = 0;
  let lastTick = 0;
  /** The clock's time at which the next frame is due. */
  let due = 0;
  /** The clock when the painting arrived, and when the effect pictures did: each comes in from then, however late (a still has both from its start). */
  let openedAt: number | null = null;
  let fxAt: number | null = null;
  /** The share of their cover the effect pictures are drawn with in the frame in hand. */
  let fxCover = 1;
  /** The embers of the frame in hand: for each, its head, its tail, its width and how much of it shows. */
  const sparks = new Float32Array(EMBERS.count * 6);
  /** The clock at the frame before this one: events that start between the two are told. */
  let told = o.frozenAt ?? 0;

  // ---- the pictures at the window's own size ---------------------------------------------------

  const canvasOf = (w: number, h: number): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  };
  const contextOf = (c: HTMLCanvasElement): CanvasRenderingContext2D => {
    const x = c.getContext('2d');
    if (!x) throw new Error('the title screen needs a 2D canvas');
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    return x;
  };

  /**
   * A picture brought once, well, to the size it is drawn at, so that each frame only moves it a
   * part of a pixel and nothing shimmers. A picture that would have to be made larger is kept as it is.
   */
  function sized(image: HTMLImageElement, perFramePixel: number, shade: boolean): CanvasImageSource {
    const s = Math.min(1, perFramePixel);
    if (s >= 1 && !shade) return image;
    const c = canvasOf(image.naturalWidth * s, image.naturalHeight * s);
    const x = contextOf(c);
    x.drawImage(image, 0, 0, c.width, c.height);
    if (shade) {
      // The sky of his finished look is greyer and darker toward its top than the empty battlefield's.
      const high = c.height * SKY_SHADE.to;
      const grey = x.createLinearGradient(0, 0, 0, high);
      grey.addColorStop(0, `rgba(128, 128, 128, ${SKY_SHADE.grey})`);
      grey.addColorStop(1, 'rgba(128, 128, 128, 0)');
      x.globalCompositeOperation = 'saturation';
      x.fillStyle = grey;
      x.fillRect(0, 0, c.width, high);
      x.globalCompositeOperation = 'source-over';
      const dark = x.createLinearGradient(0, 0, 0, high);
      dark.addColorStop(0, rgb(NIGHT, SKY_SHADE.cover));
      dark.addColorStop(1, rgb(NIGHT, 0));
      x.fillStyle = dark;
      x.fillRect(0, 0, c.width, high);
      // His horizon burns warmer than the empty battlefield's: a warm band multiplied over the skyline, then its glow added.
      const top = c.height * (HORIZON.at - HORIZON.reach);
      const tall = c.height * 2 * HORIZON.reach;
      const band = (colour: readonly number[], most: number): CanvasGradient => {
        const g = x.createLinearGradient(0, top, 0, top + tall);
        const [r, gg, b] = colour as [number, number, number];
        g.addColorStop(0, `rgba(${r}, ${gg}, ${b}, 0)`);
        g.addColorStop(0.5, `rgba(${r}, ${gg}, ${b}, ${most})`);
        g.addColorStop(1, `rgba(${r}, ${gg}, ${b}, 0)`);
        return g;
      };
      x.globalCompositeOperation = 'multiply';
      x.fillStyle = band(HORIZON.tint, HORIZON.tinted);
      x.fillRect(0, top, c.width, tall);
      x.globalCompositeOperation = 'screen';
      x.fillStyle = band(HORIZON.glow, HORIZON.glowing);
      x.fillRect(0, top, c.width, tall);
      // Stronger toward the two ends, where the wrecks burn (his fires at the skyline's left and right): a soft
      // round of glow at each end, flattened along the horizon.
      const [r, gg, b] = HORIZON.glow as readonly number[] as [number, number, number];
      for (const end of [0, c.width]) {
        x.save();
        x.translate(end, c.height * HORIZON.at);
        x.scale(1, 0.32);
        const round = x.createRadialGradient(0, 0, 0, 0, 0, c.width * 0.3);
        round.addColorStop(0, `rgba(${r}, ${gg}, ${b}, ${HORIZON.glowing})`);
        round.addColorStop(1, `rgba(${r}, ${gg}, ${b}, 0)`);
        x.fillStyle = round;
        x.fillRect(-c.width * 0.3, -c.width * 0.3, c.width * 0.6, c.width * 0.6);
        x.restore();
      }
      x.globalCompositeOperation = 'source-over';
    }
    return c;
  }

  function rescale(): void {
    if (!fitted || !pictures) return;
    // The two layers are drawn a little over the stage's size (their drift's room); the lettering at its own.
    const per = k * (1 + DRIFT.over + DRIFT.breath);
    scaled = { back: sized(pictures.battlefield, per, true), tanks: sized(pictures.tanks, per, false), title: sized(pictures.title, k, false) };
    state.painted = true;
    if (openedAt === null) openedAt = o.frozenAt !== null ? 0 : state.time;
  }

  // ---- the effect pictures, tinted to the painting -----------------------------------------------

  function plain(book: Book): Sheet {
    return { image: (fx as BackdropFx).atlases[book.atlas] as CanvasImageSource, ox: book.at[0], oy: book.at[1], book };
  }
  /** A book in one colour of the painting: the colour, shaded by the book's own light and dark, under the book's own cover. */
  function tinted(book: Book, tint: Rgb): Sheet {
    const w = book.grid[0] * book.cell[0];
    const h = book.grid[1] * book.cell[1];
    const c = canvasOf(w, h);
    const x = contextOf(c);
    const atlas = (fx as BackdropFx).atlases[book.atlas] as CanvasImageSource;
    x.fillStyle = rgb(tint);
    x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'overlay';
    x.drawImage(atlas, book.at[0], book.at[1], w, h, 0, 0, w, h);
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(atlas, book.at[0], book.at[1], w, h, 0, 0, w, h);
    return { image: c, ox: 0, oy: 0, book };
  }

  /** The storm: dark masses of cloud stamped once on a long band a quarter of the frame's fineness, whose end meets its start; each frame slides it across the sky. */
  const STORM_SPAN = fw * 2;
  const STORM_FINE = 0.25;
  function makeStorm(): void {
    if (!sheets) return;
    const high = STORM.band[1] - STORM.band[0];
    const c = canvasOf(STORM_SPAN * STORM_FINE, high * STORM_FINE);
    const x = contextOf(c);
    const sheet = tinted((fx as BackdropFx).books.cloud, STORM_INK);
    const [cw, ch] = sheet.book.cell;
    const n = Math.round((STORM.count * STORM_SPAN) / fw);
    for (let i = 0; i < n; i++) {
      const size = mix(STORM.size[0], STORM.size[1], look(9000 + i * 4)) * STORM_FINE;
      const cx = look(9001 + i * 4) * c.width;
      const cy = (0.16 + 0.42 * look(9002 + i * 4)) * c.height;
      const [sx, sy] = frameAt(sheet.book, Math.floor(look(9003 + i * 4) * sheet.book.frames));
      x.globalAlpha = mix(STORM.cover[0], STORM.cover[1], look(9100 + i));
      // Once where it lies, and once more a band's length away, so that the band's end meets its start.
      for (const shift of [0, -c.width, c.width]) x.drawImage(sheet.image, sx, sy, cw, ch, cx - size / 2 + shift, cy - size * 0.24, size, size * 0.48);
    }
    // Nothing of it ends at a line: it thins away toward the band's lower edge.
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'destination-in';
    const g = x.createLinearGradient(0, 0, 0, c.height);
    g.addColorStop(0, 'rgba(0, 0, 0, 1)');
    g.addColorStop(0.55, 'rgba(0, 0, 0, 1)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    x.fillStyle = g;
    x.fillRect(0, 0, c.width, c.height);
    storm = c;
  }

  function makeSheets(): void {
    if (!fx) {
      sheets = null;
      storm = null;
      state.effects = false;
      return;
    }
    const b = fx.books;
    sheets = {
      cloudDark: tinted(b.cloud, SMOKE_DARK),
      cloudPale: tinted(b.cloud, SMOKE_PALE),
      smokeDark: tinted(b.smoke, SMOKE_DARK),
      smokePale: tinted(b.smoke, SMOKE_PALE),
      cloudDust: tinted(b.cloud, DUST),
      wispDust: tinted(b.wisp, DUST),
      gunSmoke: tinted(b.cloud, GUN_SMOKE),
      gunWisp: tinted(b.smoke, GUN_SMOKE),
      earth: tinted(b.cloud, EARTH),
      earthWisp: tinted(b.smoke, EARTH),
      burstDark: tinted(b.burst, SMOKE_DARK),
      flame: plain(b.flame),
      blast: plain(b.blast),
    };
    makeStorm();
    state.effects = true;
    if (fxAt === null) fxAt = o.frozenAt !== null ? -FX_IN_S : state.time;
  }

  // ---- drawing -------------------------------------------------------------------------------------

  /** The layer in hand: canvas pixels to a frame pixel, and where the frame's corner lies. */
  let A = 1;
  let BX = 0;
  let BY = 0;
  const straight = (): void => ctx.setTransform(A, 0, 0, A, BX, BY);
  /** Draw about a point of the frame, turned and stretched. */
  const turned = (x: number, y: number, turn: number, sx = 1, sy = 1): void => {
    const c = Math.cos(turn) * A;
    const s = Math.sin(turn) * A;
    ctx.setTransform(c * sx, s * sx, -s * sy, c * sy, A * x + BX, A * y + BY);
  };

  /** A layer's place at time `t`: its slow breathing and wandering, and a shot's kick (frame pixels). */
  function layer(t: number, d: { x: number; y: number; sx: number; sy: number }, depth: number, kickX = 0, kickY = 0): void {
    const still = o.reduced;
    // A little over the stage's size, about the stage's middle, so that the wandering never shows an edge.
    const z = 1 + DRIFT.over + (still ? 0 : (DRIFT.breath * depth * (1 - Math.cos((TAU * t) / DRIFT.breathS))) / 2);
    const ox = still ? 0 : d.x * Math.sin((TAU * t) / d.sx);
    const oy = still ? 0 : d.y * Math.sin((TAU * t) / d.sy + 1.3);
    A = k * z;
    BX = (canvas.width / 2) * (1 - z) + (ox + kickX) * k;
    BY = (canvas.height / 2) * (1 - z) + (oy + kickY) * k;
    straight();
  }

  /** One frame of a book, `w` wide, its own point standing at x, y. */
  function put(sheet: Sheet, frame: number, x: number, y: number, w: number, cover: number, turn = 0, tall = 1): void {
    if (cover <= 0.004) return;
    const book = sheet.book;
    const [sx, sy] = frameAt(book, frame);
    const [cw, ch] = book.cell;
    const h = ((w * ch) / cw) * tall;
    ctx.globalAlpha = (cover > 1 ? 1 : cover) * fxCover;
    if (turn !== 0) {
      turned(x, y, turn);
      ctx.drawImage(sheet.image, sheet.ox + sx, sheet.oy + sy, cw, ch, -w / 2, -h / 2, w, h);
      straight();
    } else {
      ctx.drawImage(sheet.image, sheet.ox + sx, sheet.oy + sy, cw, ch, x - w * book.pivot[0], y - h * book.pivot[1], w, h);
    }
  }

  /** A round light: `inner` at its middle, clear at `reach`. Drawn as light added to what is there. */
  function glow(x: number, y: number, reach: number, hot: Rgb, warm: Rgb, strength: number, wide = 1, tall = 1, turn = 0): void {
    if (strength <= 0.004 || reach <= 0) return;
    turned(x, y, turn, wide, tall);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, reach);
    g.addColorStop(0, rgb(hot, 1));
    g.addColorStop(0.22, rgb(warm, 0.62));
    g.addColorStop(0.55, rgb(warm, 0.16));
    g.addColorStop(1, rgb(warm, 0));
    ctx.globalAlpha = strength > 1 ? 1 : strength;
    ctx.fillStyle = g;
    ctx.fillRect(-reach, -reach, reach * 2, reach * 2);
    straight();
  }

  function drawStorm(t: number): void {
    if (!storm) return;
    const high = STORM.band[1] - STORM.band[0];
    const top = STORM.band[0];
    for (const [speed, lift, cover, flip] of [[STORM.speed[0], 0, 1, 1], [STORM.speed[1], -70, 0.7, -1]] as const) {
      const slide = frac((t * speed * WIND) / STORM_SPAN + (flip < 0 ? 0.37 : 0)) * STORM_SPAN;
      ctx.globalAlpha = cover * fxCover;
      for (const at of [slide - STORM_SPAN, slide]) {
        if (at > fw || at + STORM_SPAN < 0) continue;
        if (flip < 0) {
          // The same band the other way round, so that the two layers never show the same cloud.
          ctx.setTransform(-A, 0, 0, A, A * (at + STORM_SPAN) + BX, A * (top + lift) + BY);
          ctx.drawImage(storm, 0, 0, STORM_SPAN, high);
          straight();
        } else {
          ctx.drawImage(storm, at, top + lift, STORM_SPAN, high);
        }
      }
    }
  }

  function drawColumn(ci: number, ts: number): void {
    const s = sheets;
    if (!s) return;
    const c = COLUMNS[ci] as (typeof COLUMNS)[number];
    if (c.fire > 0) {
      const flicker = o.reduced ? 0.9 : 0.78 + 0.22 * Math.sin(ts * 9.1 + ci * 2.3) * Math.sin(ts * 5.3 + ci);
      ctx.globalCompositeOperation = 'lighter';
      glow(c.x, c.y - c.fire * 0.3, c.fire * 3.2, FIRE_GLOW, FIRE_GLOW, 0.3 * flicker, 1, 0.7);
      put(s.flame, frameOf(s.flame.book, o.reduced ? 0 : ts, 1, ci * 7), c.x, c.y + c.fire * 0.08, c.fire * 0.62, 0.95);
      put(s.flame, frameOf(s.flame.book, o.reduced ? 0 : ts, 0.8, ci * 7 + 13), c.x + c.fire * 0.34, c.y + c.fire * 0.1, c.fire * 0.44, 0.8);
      ctx.globalCompositeOperation = 'source-over';
    }
    const gust = 1 + 0.2 * Math.sin(ts * 0.11 + ci * 1.9) + 0.09 * Math.sin(ts * 0.31 + ci);
    const first = Math.ceil((ts - c.life) / c.every) - 1;
    const last = Math.floor(ts / c.every);
    for (let n = first; n <= last; n++) {
      // A puff's own draws: by its column and its number (which may be below 0: the columns already stand when the page opens).
      const id = (ci * 2_000_000 + n + 1_000_000) * 8;
      const age = ts - (n + 0.7 * puff(id)) * c.every;
      if (age < 0 || age >= c.life) continue;
      const u = age / c.life;
      const up = 1 - (1 - u) ** 1.7;
      const sway = Math.sin(age * (0.35 + 0.5 * puff(id + 1)) + puff(id + 2) * TAU) * c.size * 0.5 * u;
      const x = c.x + WIND * c.lean * gust * u ** 1.45 + (puff(id + 3) - 0.5) * c.size * (0.5 + 2.2 * u) + sway;
      const y = c.y - c.rise * up + (puff(id + 4) - 0.5) * c.size * (0.3 + 1.4 * u);
      const w = c.size * (1 + (c.grow - 1) * u ** 0.75) * (0.8 + 0.5 * puff(id + 5));
      const cover = c.cover * smooth(u / 0.07) * (1 - u) ** 0.9 * (0.7 + 0.6 * puff(id + 6));
      const pale = smooth((u - 0.3) / 0.7);
      const wispy = ((n % 3) + 3) % 3 === 0;
      const dark = wispy ? s.smokeDark : s.cloudDark;
      const paler = wispy ? s.smokePale : s.cloudPale;
      const frame = frameOf(dark.book, age, 0.3, puff(id + 7) * dark.book.frames);
      const turn = puff(id + 2) * TAU + (puff(id + 1) - 0.5) * 0.12 * age;
      const width = wispy ? w * 1.35 : w;
      put(dark, frame, x, y, width, cover * (1 - pale), turn);
      put(paler, frame, x, y, width, cover * pale * 0.8, turn);
    }
  }

  /** A gun flashes beyond the horizon and lights the cloud above it. */
  function drawGlow(e: TitleEvent, age: number): void {
    const site = GLOWS[e.place] as (typeof GLOWS)[number];
    const twice = pulse(age, 0.05, 0.075) + 0.55 * pulse(age - 0.13, 0.04, 0.06);
    ctx.globalCompositeOperation = 'lighter';
    glow(site[0] + (look(e.n * 4) - 0.5) * 160, site[1], site[2] * (0.8 + 0.4 * look(e.n * 4 + 1)), FLASH_HOT, FLASH_WARM, 0.56 * twice, 1, 0.5);
    ctx.globalCompositeOperation = 'source-over';
  }

  /** A shell bursts far off, its foot behind the skyline. */
  function drawBurst(e: TitleEvent, age: number): void {
    const s = sheets;
    if (!s) return;
    const site = BURSTS[e.place] as (typeof BURSTS)[number];
    const x = site[0] + (look(e.n * 4) - 0.5) * 60;
    const y = site[1];
    const w = site[2] * (0.8 + 0.5 * look(e.n * 4 + 1));
    ctx.globalCompositeOperation = 'lighter';
    glow(x, y - w * 0.2, w * 3.4, FLASH_HOT, FLASH_WARM, 0.5 * pulse(age, 0.05, 0.1), 1, 0.6);
    ctx.globalCompositeOperation = 'source-over';
    if (age < 1.4) put(s.blast, frameOf(s.blast.book, age, 0.8), x, y - w * 0.1, w, 1);
    // What is left: a dark puff that the wind takes.
    const u = (age - 0.25) / 4.2;
    if (u > 0 && u < 1) put(s.burstDark, Math.floor(u * 18), x + WIND * 90 * u, y - w * (0.35 + 0.5 * u), w * (1 + 1.6 * u), 0.6 * smooth(u / 0.1) * (1 - u), look(e.n * 4 + 2) * TAU);
  }

  /** A run of tracer along a lane. */
  function drawTracers(e: TitleEvent, age: number): void {
    const lane = LANES[e.place] as (typeof LANES)[number];
    const far = e.place >= 4;
    const dx = lane[2] - lane[0];
    const dy = lane[3] - lane[1];
    const long = Math.hypot(dx, dy);
    const speed = far ? 1500 : 2900;
    const tail = far ? 70 : 170;
    const rounds = 3 + Math.floor(look(e.n * 4) * 5);
    const red = look(e.n * 4 + 1) < 0.3;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let j = 0; j < rounds; j++) {
      const a = age - j * (0.085 + 0.03 * look(e.n * 4 + 2)) - 0.02 * look(e.n * 16 + j);
      const head = a * speed;
      if (head <= 0 || head - tail >= long) continue;
      const h1 = Math.min(long, head) / long;
      const h0 = Math.max(0, head - tail) / long;
      // It bows a little, as a tracer's path does.
      const bow = (far ? 5 : 16) * Math.sin(Math.PI * h1);
      const x1 = lane[0] + dx * h1;
      const y1 = lane[1] + dy * h1 - bow;
      const x0 = lane[0] + dx * h0;
      const y0 = lane[1] + dy * h0 - (far ? 5 : 16) * Math.sin(Math.PI * h0);
      const fade = smooth(head / 120) * (1 - smooth((head - long * 0.82) / (long * 0.18)));
      // A soft glow the whole length, a thinner glow, and the bright heart toward its head: as his painted ones are.
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = rgb(red ? TRACER_RED : FLASH_RED);
      ctx.globalAlpha = 0.14 * fade;
      ctx.lineWidth = far ? 8 : 18;
      ctx.stroke();
      ctx.globalAlpha = 0.3 * fade;
      ctx.lineWidth = far ? 4 : 8;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x0 + (x1 - x0) * 0.35, y0 + (y1 - y0) * 0.35);
      ctx.lineTo(x1, y1);
      ctx.globalAlpha = 0.85 * fade;
      ctx.strokeStyle = rgb(red ? TRACER_RED : TRACER);
      ctx.lineWidth = far ? 1.6 : 3.2;
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /** The light a gun's flash throws on the tanks and the ground: the tanks' own picture, added to itself round the muzzle. */
  function drawLight(x: number, y: number, reach: number, strength: number): void {
    if (!scaled || strength <= 0.01) return;
    // The part of the canvas the light falls on.
    const cx = A * x + BX;
    const cy = A * y + BY;
    const r = A * reach;
    const x0 = Math.max(0, Math.floor(cx - r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const x1 = Math.min(canvas.width, Math.ceil(cx + r));
    const y1 = Math.min(canvas.height, Math.ceil(cy + r));
    if (x1 - x0 < 2 || y1 - y0 < 2) return;
    // Half as fine as the picture: light is soft.
    const fine = 0.5;
    const w = Math.ceil((x1 - x0) * fine);
    const h = Math.ceil((y1 - y0) * fine);
    if (!light || light.width < w || light.height < h) light = canvasOf(Math.max(w, light?.width ?? 0), Math.max(h, light?.height ?? 0));
    const lx = contextOf(light);
    lx.setTransform(1, 0, 0, 1, 0, 0);
    lx.globalCompositeOperation = 'source-over';
    lx.clearRect(0, 0, light.width, light.height);
    const g = lx.createRadialGradient((cx - x0) * fine, (cy - y0) * fine, 0, (cx - x0) * fine, (cy - y0) * fine, r * fine);
    g.addColorStop(0, 'rgba(255, 255, 255, 1)');
    g.addColorStop(0.35, 'rgba(255, 255, 255, 0.5)');
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    lx.fillStyle = g;
    lx.fillRect(0, 0, w, h);
    // The tanks, where the light reaches; then warmed.
    lx.globalCompositeOperation = 'source-in';
    lx.setTransform(A * fine, 0, 0, A * fine, (BX - x0) * fine, (BY - y0) * fine);
    lx.drawImage(scaled.tanks, 0, 0, fw, fh);
    lx.setTransform(1, 0, 0, 1, 0, 0);
    lx.globalCompositeOperation = 'source-atop';
    lx.fillStyle = rgb(FLASH_WARM, 0.14);
    lx.fillRect(0, 0, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = strength > 1 ? 1 : strength;
    ctx.drawImage(light, 0, 0, w, h, x0, y0, x1 - x0, y1 - y0);
    ctx.globalCompositeOperation = 'source-over';
    straight();
  }

  /** A tank fires. */
  function drawShot(e: TitleEvent, age: number): void {
    const gun = GUNS[e.place] as (typeof GUNS)[number];
    const s = sheets;
    const size = gun.size;
    const along = Math.atan2(gun.dy, gun.dx);
    const fire = pulse(age, 0.028, 0.06);
    if (fire > 0.01) {
      drawLight(gun.x, gun.y, size * 2.6, 0.85 * fire);
      ctx.globalCompositeOperation = 'lighter';
      // The halo on the air, the jet along the barrel's line, the two the muzzle brake throws sideways, the white heart.
      glow(gun.x, gun.y, size * 1.5, FLASH_WARM, FLASH_RED, 0.4 * fire);
      glow(gun.x + gun.dx * size * 0.3, gun.y + gun.dy * size * 0.3, size * 0.62, FLASH_HOT, FLASH_WARM, fire, 1.5, 0.5, along);
      glow(gun.x - gun.dx * size * 0.1, gun.y - gun.dy * size * 0.1, size * 0.5, FLASH_HOT, FLASH_WARM, 0.9 * fire, 0.36, 1.25, along);
      glow(gun.x, gun.y, size * 0.3, FLASH_HOT, FLASH_HOT, fire);
      ctx.globalCompositeOperation = 'source-over';
    }
    // The round: a streak that is gone from the picture in a moment.
    const reach = age * 5200;
    if (age < 0.5 && reach > size * 0.2) {
      const tail = Math.max(size * 0.2, reach - 420);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(gun.x + gun.dx * tail, gun.y + gun.dy * tail);
      ctx.lineTo(gun.x + gun.dx * reach, gun.y + gun.dy * reach);
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = rgb(FLASH_RED);
      ctx.lineWidth = size * 0.05;
      ctx.stroke();
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = rgb(FLASH_HOT);
      ctx.lineWidth = size * 0.016;
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    if (!s) return;
    // The smoke: soft puffs thrown forward and out of the brake's two sides, which roll away, thin, and are taken by the wind.
    const u = age / GUN_SMOKE_S;
    if (u < 1) {
      const out = 1 - (1 - u) ** 3.2;
      const windX = WIND * size * 0.42 * u * u;
      for (let j = 0; j < 9; j++) {
        const r = look(e.n * 32 + 8 + j);
        const q = look(e.n * 32 + 20 + j);
        // Three forward, three to each side; each a little off its jet's line.
        const jet = along + (j < 3 ? 0 : j < 6 ? -1.45 : 1.45) + (r - 0.5) * 0.7;
        const far = size * (j < 3 ? 0.5 + 0.55 * q : 0.3 + 0.4 * q);
        const x = gun.x + Math.cos(jet) * far * (0.12 + 0.88 * out) + windX;
        const y = gun.y + Math.sin(jet) * far * (0.12 + 0.88 * out) - size * 0.12 * u * (0.5 + q);
        const sheet = j % 3 === 2 ? s.gunWisp : s.gunSmoke;
        // It shows as the flash dies, not in it.
        const cover = (j < 3 ? 0.4 : 0.32) * smooth((age - 0.05) / 0.22) * (1 - u) ** 1.7 * (0.7 + 0.6 * r);
        put(sheet, frameOf(sheet.book, age, 0.45, r * sheet.book.frames), x, y, size * (0.26 + 0.75 * out) * (0.75 + 0.5 * q), cover, r * TAU + (q - 0.5) * age * 0.4);
      }
    }
    // The ground's dust jumps under the blast.
    const d = (age - 0.04) / 2.4;
    if (d > 0 && d < 1) {
      const [gx, gy, gw] = gun.dust;
      for (let j = 0; j < 5; j++) {
        const r = look(e.n * 32 + j);
        const x = gx + (j / 4 - 0.5) * gw + (r - 0.5) * gw * 0.2;
        const lift = gw * (0.08 + 0.12 * r) * (1 - (1 - d) ** 2);
        put(s.cloudDust, Math.floor(r * 31), x + WIND * 30 * d, gy - lift, gw * (0.3 + 0.45 * d) * (0.8 + 0.5 * r), 0.42 * smooth(d / 0.08) * (1 - d) ** 1.4, r * TAU);
      }
    }
  }

  /** A shell lands on the near ground. */
  function drawStrike(e: TitleEvent, age: number): void {
    const s = sheets;
    const site = STRIKES[e.place] as (typeof STRIKES)[number];
    const x = site[0] + (look(e.n * 4) - 0.5) * 120;
    const y = site[1];
    const w = site[2];
    const fire = pulse(age, 0.035, 0.09);
    if (fire > 0.01) {
      drawLight(x, y - w * 0.2, w * 2.4, 0.6 * fire);
      ctx.globalCompositeOperation = 'lighter';
      glow(x, y - w * 0.25, w * 1.2, FLASH_HOT, FLASH_WARM, 0.7 * fire);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (!s) return;
    // A shell in earth: a moment's fire, then a fountain of earth that stands and falls back, and dust that the wind takes.
    if (age < 0.28) put(s.blast, frameOf(s.blast.book, age, 1), x, y - w * 0.1, w * 0.5, 1 - smooth((age - 0.12) / 0.16));
    const f = age / 1.7;
    if (f < 1) {
      const up = 1 - (1 - f) ** 2.6;
      for (let j = 0; j < 7; j++) {
        const r = look(e.n * 64 + 48 + j);
        const lean = (j / 6 - 0.5) * 1.1 + (r - 0.5) * 0.3;
        // Tall, soft plumes fanned out from the hole.
        const sheet = j % 2 === 0 ? s.earth : s.earthWisp;
        put(sheet, Math.floor(r * 31), x + Math.sin(lean) * w * 0.75 * up, y - Math.cos(lean) * w * (0.4 + 0.55 * r) * up, w * (0.3 + 0.5 * up), 0.62 * smooth((age - 0.02) / 0.08) * (1 - f) ** 1.2, lean, 1.7);
      }
    }
    // Clods thrown up, falling back: short dark streaks the way they fly.
    if (age < 1.8) {
      ctx.strokeStyle = rgb(DIRT);
      ctx.lineCap = 'round';
      for (let j = 0; j < 22; j++) {
        const r = look(e.n * 64 + j);
        const q = look(e.n * 64 + 24 + j);
        const vx = (r - 0.5) * w * 2.6;
        const vy = -w * (1.3 + 2 * q);
        const fall = w * 5.4;
        const px = x + (r - 0.5) * w * 0.22 + vx * age;
        const py = y - w * 0.12 + vy * age + (fall / 2) * age * age;
        if (py > y + w * 0.12) continue;
        const sx = vx * 0.03;
        const sy = (vy + fall * age) * 0.03;
        ctx.globalAlpha = 0.8 * smooth((age - 0.05) / 0.14) * (1 - smooth((age - 1.3) / 0.5));
        ctx.lineWidth = w * (0.008 + 0.016 * q);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - sx, py - sy);
        ctx.stroke();
      }
    }
    const u = (age - 0.15) / 5;
    if (u > 0 && u < 1) {
      put(s.burstDark, 8 + Math.floor(u * 14), x + WIND * w * 0.6 * u, y - w * (0.3 + 0.7 * u), w * (0.8 + 1.5 * u), 0.5 * smooth(u / 0.1) * (1 - u) ** 1.3, look(e.n * 4 + 1) * TAU);
      put(s.cloudDust, Math.floor(look(e.n * 4 + 2) * 31), x + WIND * w * 0.3 * u, y - w * 0.12, w * (0.8 + 1.1 * u), 0.4 * smooth(u / 0.06) * (1 - u) ** 1.5);
    }
  }

  /** Low dust, ash and embers, in front of everything. */
  function drawFront(t: number): void {
    const s = sheets;
    if (s) {
      for (let i = 0; i < GROUND_DUST.count; i++) {
        const size = mix(GROUND_DUST.size[0], GROUND_DUST.size[1], speck(i * 8));
        const cross = mix(GROUND_DUST.crossS[0], GROUND_DUST.crossS[1], speck(i * 8 + 1));
        const p = frac(speck(i * 8 + 2) + (t * WIND) / cross);
        const x = -size / 2 + p * (fw + size);
        const y = mix(GROUND_DUST.y[0], GROUND_DUST.y[1], speck(i * 8 + 3));
        const cover = mix(GROUND_DUST.cover[0], GROUND_DUST.cover[1], speck(i * 8 + 4)) * smooth(p / 0.15) * (1 - smooth((p - 0.85) / 0.15));
        put(s.wispDust, frameOf(s.wispDust.book, t, 0.25, speck(i * 8 + 5) * 32), x, y, size, cover, 0, 0.5);
      }
    }
    // Ash: dark flecks sinking across the picture with the wind.
    ctx.fillStyle = rgb(ASH_INK);
    for (let i = 0; i < ASH.count; i++) {
      const id = 4000 + i * 8;
      const life = mix(ASH.lifeS[0], ASH.lifeS[1], speck(id));
      const turnOf = (t + speck(id + 1) * life) / life;
      const round = Math.floor(turnOf);
      const u = turnOf - round;
      const r = speck(id + 2 + (round % 97) * 1000);
      const q = speck(id + 3 + (round % 89) * 1000);
      const speed = mix(ASH.speed[0], ASH.speed[1], q);
      const x = r * (fw + 300) - 100 + WIND * speed * 0.8 * u * life + Math.sin(u * 9 + q * 6) * 14;
      const y = q * fh * 0.9 - 80 + speed * 0.55 * u * life;
      const size = mix(ASH.size[0], ASH.size[1], speck(id + 4));
      ctx.globalAlpha = 0.55 * smooth(u / 0.12) * (1 - smooth((u - 0.8) / 0.2));
      turned(x, y, u * 5 + r * 6);
      ctx.fillRect(-size / 2, -size * 0.3, size, size * 0.6);
    }
    straight();
    // Embers: sparks rising out of the lower right, where he painted them, and the glow of what burns below the corner.
    ctx.globalCompositeOperation = 'lighter';
    glow(fw - 60, fh - 150, 980, FIRE_GLOW, FLASH_RED, 0.13 + 0.02 * Math.sin(t * 2.3) * Math.sin(t * 0.9), 1.25, 0.8);
    ctx.lineCap = 'round';
    for (let i = 0; i < EMBERS.count; i++) {
      const id = 8000 + i * 8;
      const life = mix(EMBERS.lifeS[0], EMBERS.lifeS[1], speck(id));
      const turnOf = (t + speck(id + 1) * life) / life;
      const round = Math.floor(turnOf);
      const u = turnOf - round;
      const r = speck(id + 2 + (round % 97) * 1000);
      const q = speck(id + 3 + (round % 89) * 1000);
      // Most of them near the corner: the draw is leaned toward the right and the bottom.
      const x0 = EMBERS.from[0] + EMBERS.from[2] * (1 - (1 - r) ** 2.4);
      const y0 = EMBERS.from[1] + EMBERS.from[3] * (1 - (1 - q) ** 2);
      const speed = mix(EMBERS.speed[0], EMBERS.speed[1], speck(id + 4));
      const age = u * life;
      const vx = -speed * (0.6 + 0.8 * q) + Math.sin(age * 1.7 + r * 6) * 26;
      const vy = -speed * (0.35 + 0.5 * r) + Math.cos(age * 1.3 + q * 6) * 18;
      const x = x0 - speed * (0.6 + 0.8 * q) * age - (Math.cos(age * 1.7 + r * 6) - Math.cos(r * 6)) * (26 / 1.7);
      const y = y0 - speed * (0.35 + 0.5 * r) * age + (Math.sin(age * 1.3 + q * 6) - Math.sin(q * 6)) * (18 / 1.3);
      const size = mix(EMBERS.size[0], EMBERS.size[1], speck(id + 5));
      const flicker = 0.6 + 0.4 * Math.sin(age * (7 + 9 * r) + q * 6);
      const shown = flicker * smooth(u / 0.1) * (1 - smooth((u - 0.6) / 0.4));
      // A spark is a short streak the way it flies: its head, its tail, its width and how much of it shows.
      const fast = Math.hypot(vx, vy) || 1;
      const long = size * 2.2 + fast * 0.09;
      sparks.set([x, y, x - (vx / fast) * long, y - (vy / fast) * long, size, shown], i * 6);
    }
    // Its orange is laid over what is there (added as light it would go white on the snow); only
    // its small heart is light. All the glows, then all the sparks, then all the hearts: the canvas
    // changes its way of drawing three times a frame, not three times a spark.
    strokeSparks(sparks, EMBERS.count);
  }

  /** Sparks as streaks (`list`: head, tail, width, how much shows, for `n` of them): all the glows, then all the sparks, then all the hearts. */
  function strokeSparks(list: Float32Array, n: number): void {
    const stroke = (ink: Rgb, cover: number, width: number, part: number): void => {
      ctx.strokeStyle = rgb(ink);
      for (let i = 0; i < n; i++) {
        const shown = list[i * 6 + 5] as number;
        if (shown <= 0.01) continue;
        const x = list[i * 6] as number;
        const y = list[i * 6 + 1] as number;
        ctx.globalAlpha = cover * (shown > 1 ? 1 : shown);
        ctx.lineWidth = (list[i * 6 + 4] as number) * width;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + ((list[i * 6 + 2] as number) - x) * part, y + ((list[i * 6 + 3] as number) - y) * part);
        ctx.stroke();
      }
    };
    ctx.globalCompositeOperation = 'source-over';
    stroke(EMBER_GLOW, 0.3, 2, 1);
    stroke(EMBER, 0.95, 0.8, 1);
    ctx.globalCompositeOperation = 'lighter';
    stroke(FLASH_WARM, 0.7, 0.4, 0.4);
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Every place of stage.ts, for checking them against the painting (`marks=1`): a cross in its
   * kind's colour, with as many pips beside it as its number in its list, from 1. Columns are
   * cyan, bursts yellow, glows orange (a little below their place), strikes magenta, guns green
   * with the way the round leaves, each gun's dust pale green; the tracers' lanes and the embers'
   * field are white. (No lettering: the client's canvases draw no text.)
   */
  function drawMarks(): void {
    ctx.globalAlpha = 1;
    ctx.lineWidth = 3;
    const mark = (x: number, y: number, number: number, ink: string): void => {
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(x - 16, y);
      ctx.lineTo(x + 16, y);
      ctx.moveTo(x, y - 16);
      ctx.lineTo(x, y + 16);
      ctx.stroke();
      for (let pip = 0; pip <= number; pip++) ctx.fillRect(x + 12 + pip * 12, y - 22, 8, 8);
    };
    COLUMNS.forEach((c, i) => mark(c.x, c.y, i, 'rgb(0, 255, 255)'));
    BURSTS.forEach((b, i) => mark(b[0], b[1], i, 'rgb(255, 255, 0)'));
    GLOWS.forEach((g, i) => mark(g[0], g[1] + 30, i, 'rgb(255, 160, 0)'));
    STRIKES.forEach((b, i) => mark(b[0], b[1], i, 'rgb(255, 0, 255)'));
    GUNS.forEach((g, i) => {
      mark(g.x, g.y, i, 'rgb(0, 255, 0)');
      ctx.beginPath();
      ctx.moveTo(g.x, g.y);
      ctx.lineTo(g.x + g.dx * 160, g.y + g.dy * 160);
      ctx.stroke();
      mark(g.dust[0], g.dust[1], i, 'rgb(160, 255, 160)');
    });
    ctx.strokeStyle = 'rgb(255, 255, 255)';
    LANES.forEach(l => {
      ctx.beginPath();
      ctx.moveTo(l[0], l[1]);
      ctx.lineTo(l[2], l[3]);
      ctx.stroke();
    });
    ctx.strokeRect(EMBERS.from[0], EMBERS.from[1], EMBERS.from[2], EMBERS.from[3]);
  }

  function draw(t: number): void {
    if (!fitted) return;
    const began = performance.now();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = rgb(NIGHT);
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (scaled) {
      const moving = !o.reduced;
      const ts = moving ? t : t * REDUCED_RATE;
      // Seconds since the painting arrived; the effect pictures' cover since they did.
      const since = t - (openedAt ?? t);
      fxCover = fxAt === null ? 0 : smooth((t - fxAt) / FX_IN_S);
      const events = moving ? table.between(t - 6, t + 1e-6) : [];

      // The kick of the shots just fired: away from the gun, and settling.
      let kickX = 0;
      let kickY = 0;
      for (const e of events) {
        if (e.kind !== 'shot') continue;
        const gun = GUNS[e.place] as (typeof GUNS)[number];
        const push = DRIFT.kick * (e.place === 0 ? 1 : 0.45) * pulse(t - e.at, 0.03, DRIFT.kickS / 4);
        kickX -= gun.dx * push;
        kickY -= gun.dy * push;
      }

      // 1. The battlefield.
      layer(t, DRIFT.back, 0.7);
      ctx.drawImage(scaled.back, 0, 0, fw, fh);

      // 2. Our sky.
      for (const e of events) if (e.kind === 'glow') drawGlow(e, t - e.at);
      drawStorm(moving ? t : 0);
      for (let i = 0; i < COLUMNS.length; i++) drawColumn(i, ts);
      for (const e of events) {
        if (e.kind === 'burst') drawBurst(e, t - e.at);
        else if (e.kind === 'tracers') drawTracers(e, t - e.at);
      }

      // 3. His lettering, where he painted it on the stage: behind the tanks, so that the big gun passes in front of it.
      const shown = o.reduced ? 1 : smooth((since - OPENING.titleAfter) / OPENING.title);
      if (shown > 0.004) {
        ctx.setTransform(k, 0, 0, k, 0, 0);
        ctx.globalAlpha = shown;
        ctx.drawImage(scaled.title, art.title.at[0], art.title.at[1] + (1 - shown) * OPENING.titleRise, art.title.width, art.title.height);
      }

      // 4. His tanks.
      layer(t, DRIFT.tanks, 1, kickX, kickY);
      ctx.globalAlpha = 1;
      ctx.drawImage(scaled.tanks, 0, 0, fw, fh);

      // 5. Our foreground.
      for (const e of events) {
        if (e.kind === 'shot') drawShot(e, t - e.at);
        else if (e.kind === 'strike') drawStrike(e, t - e.at);
      }
      if (moving) {
        layer(t, DRIFT.front, 1.5);
        drawFront(t);
      }
      if (o.marks) {
        layer(t, DRIFT.tanks, 1);
        drawMarks();
      }
      // The picture comes up out of the dark when the page opens.
      const up = smooth(since / OPENING.picture);
      if (up < 1) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1 - up;
        ctx.fillStyle = rgb(NIGHT);
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // What has started since the last frame is told (for its sound) and, if bright, written down.
      if (moving && t > told && t - told < 1) {
        for (const e of events) {
          if (e.at <= told || e.at > t) continue;
          if (BRIGHT.includes(e.kind)) {
            state.flashes.push(e.at);
            if (state.flashes.length > 400) state.flashes.splice(0, 100);
          }
          // Where it is across the stage, and whether that is on the stage at all (a tracer's lane starts beyond its edge).
          const [sx, sy] = placeOf(e.kind, e.place);
          o.onEvent(e, Math.max(-1, Math.min(1, (sx / fw) * 2 - 1)), sx >= 0 && sx <= fw && sy >= 0 && sy <= fh);
        }
      }
      told = t;
    }

    state.frames++;
    const took = performance.now() - began;
    state.drawMs = state.frames < 3 ? took : state.drawMs + (took - state.drawMs) / Math.min(state.frames, 120);
    if (state.frames > 10) state.drawMsMost = Math.max(state.drawMsMost, took);
  }

  // ---- the clock -----------------------------------------------------------------------------------

  function tick(now: number): void {
    raf = 0;
    if (disposed || paused || document.hidden) {
      state.running = false;
      return;
    }
    // The clock takes up where it stopped: a long gap (the page was hidden, the machine slept) does not count.
    const dt = Math.min(0.1, Math.max(0, (now - lastTick) / 1000));
    lastTick = now;
    state.time += dt;
    // A frame when one is due (a little early rather than a whole display frame late). The frames are
    // due at an even rate whatever the display's own, so a display that is not at 60 a second still
    // gets about thirty; one that has fallen behind starts again from now.
    if (state.time >= due - 0.004) {
      const frameS = 1 / (o.reduced ? FRAMES_PER_SECOND / 2 : FRAMES_PER_SECOND);
      due = due + frameS < state.time ? state.time + frameS : due + frameS;
      draw(state.time);
    }
    raf = requestAnimationFrame(tick);
  }
  function wake(): void {
    if (disposed || paused || raf !== 0 || document.hidden || o.frozenAt !== null || !fitted) return;
    state.running = true;
    lastTick = performance.now();
    raf = requestAnimationFrame(tick);
  }
  function rest(): void {
    if (raf !== 0) cancelAnimationFrame(raf);
    raf = 0;
    state.running = false;
  }
  /** With the clock standing, a change is drawn once. */
  function once(): void {
    if (o.frozenAt !== null && fitted) draw(o.frozenAt);
  }
  const visibility = (): void => {
    if (document.hidden) rest();
    else wake();
  };
  document.addEventListener('visibilitychange', visibility);

  return {
    state,
    resize(pixels) {
      const wide = Math.max(1, Math.round(pixels[0]));
      const high = Math.max(1, Math.round(pixels[1]));
      // The same size again (a window that grew past the art's own size, say): nothing to do.
      if (fitted && canvas.width === wide && canvas.height === high) return;
      fitted = true;
      canvas.width = wide;
      canvas.height = high;
      k = wide / fw;
      state.pixels = [wide, high];
      // The plainest smoothing on the frame's own canvas: the pictures are already at their size (they
      // were brought to it once, well), and smoke is soft. The finer kinds cost the graphics card several
      // times as much for every pixel of every puff.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low';
      rescale();
      // A resized canvas is clear: draw at once, so that no empty frame shows.
      if (o.frozenAt !== null) once();
      else {
        draw(state.time);
        wake();
      }
    },
    setPictures(p) {
      pictures = p;
      rescale();
      once();
    },
    setFx(next) {
      fx = next;
      makeSheets();
      once();
    },
    seek(t) {
      if (o.frozenAt === null || !(t >= 0)) return;
      o.frozenAt = t;
      state.time = t;
      told = t;
      once();
    },
    pause(p) {
      paused = p;
      if (p) rest();
      else wake();
    },
    now: () => state.time,
    dispose() {
      disposed = true;
      rest();
      document.removeEventListener('visibilitychange', visibility);
    },
  };
}
