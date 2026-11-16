/**
 * The effects, joined to the table page. The page (../table.ts) mounts them beside the pieces,
 * hands the pieces `watch` (so that what a game asks of the counters sets effects off), calls
 * `step` in its own loop and `sync` before a frame, and publishes `hook` on `window.__table.fx`.
 *
 * What is where: tune.ts (every dial), units.ts (which unit sets off what), effects.ts (what each
 * effect is made of, and the clock), pool.ts (the particles), view.ts and shaders.ts (how they are
 * drawn), watch.ts (what sets them off in a game), demo.ts (a developer's strip of buttons).
 *
 * The pictures (fire, blast and smoke as flipbooks) are handed in already fetched and decoded: the
 * scene downloads nothing. Until they come, and for good when none do, the effects are those the
 * shader draws itself.
 */
import type * as THREE from 'three';
import unitsText from './data/units.fx.json?raw';
import type { PiecesWatch } from '../pieces/pieces';
import { Effects } from './effects';
import type { EffectEvent } from './effects';
import { parseManifest } from './flipbook';
import type { FxHook, PlayKind } from './hook';
import type { FxTune } from './tune';
import { parseUnitFx, unitFx } from './units';
import { EffectsView } from './view';
import type { AtlasImage } from './view';
import { Watch } from './watch';

export type { EffectEvent, EffectKind } from './effects';
export type { FxHook, PlayKind } from './hook';
export { mountAnswers } from './answers';
export type { AnswersHook, AnswersMount, Intent } from './answers';
export { tuneWith } from './tune';
export type { FxTune } from './tune';
export { mountFxDemo } from './demo';

/** The effects' pictures, handed to the table from outside the scene: the manifest as its tool wrote it (read here, strictly) and the atlases it names, decoded, in its order. */
export interface FxArt {
  manifest: unknown;
  atlases: AtlasImage[];
}

export interface EffectsMount {
  /** What is drawn: add it to the scene's root. */
  object: THREE.Object3D;
  /** Hand this to the pieces: what a game asks of them sets effects off. */
  watch: PiecesWatch;
  /** A shot a game answers for (the port's `answer`): it leaves its counter; and what came of it arrives. */
  shots: { fired(a: { from: number; to: number; by: string; on: string | null }): void; landed(a: { from: number; to: number; by: string; on: string | null; result: 'none' | 'suppressed' | 'destroyed' }): void };
  hook: FxHook;
  /** One pass of the page's loop, with the frame's time stamp in ms: 2 while any short effect is alive, 1 while only lasting ones are, 0 when nothing is. */
  step(ts: number): 0 | 1 | 2;
  /** Before a frame is drawn. `lit` is false on the flat tier. */
  sync(camera: THREE.Camera, lit: boolean): void;
  /** The tier changed, or the viewer's wish for less motion. */
  setMode(mode: { flat?: boolean; reduced?: boolean }): void;
  /** A frame was drawn only because a lasting effect is alive. */
  countAmbient(): void;
  /** The least time between two such frames, in ms. */
  readonly ambientMs: number;
  /** After a lost graphics context. */
  restore(): void;
}

type P2 = readonly [number, number];

export function mountEffects(o: {
  /** The scene's shared uniforms (world.ts). */
  shared: Record<string, { value: unknown }>;
  renderer: THREE.WebGLRenderer;
  /** The board's hexes: how many, the middle of one, and the hex so many columns to the right of one (itself where there is none). */
  hexes: { count: number; centre(hex: number): P2; across(hex: number, columns: number): number };
  /** The dials (tune.ts, with the address's applied), and whether the game is played back fast. */
  tune: FxTune;
  fast: boolean;
  reduced: boolean;
  flat: boolean;
  /** The pictures, when they have been fetched and decoded; null or nothing: there are none. */
  art?: Promise<FxArt | null> | undefined;
  /** Told when an effect starts (for sound). */
  onEffect?: ((e: EffectEvent) => void) | undefined;
  /** Something changed: the page should run its loop. */
  wake: () => void;
}): EffectsMount {
  const tune = o.tune;
  const table = parseUnitFx(unitsText);
  const fx = new Effects(tune);
  const mode = { fast: o.fast, reduced: o.reduced, flat: o.flat };
  fx.setMode(mode);
  fx.onEffect = o.onEffect ?? null;
  const view = new EffectsView(fx, tune, o.shared);
  const watch = new Watch(fx, table, tune, o.hexes.centre);
  let art: 'none' | 'loading' | 'ready' = o.art ? 'loading' : 'none';
  let ambientFrames = 0;
  let last = 0;
  let paused = false;
  let drawn = 0;

  if (o.art) {
    void o.art.then(
      got => {
        if (!got) {
          art = 'none';
          return;
        }
        try {
          const manifest = parseManifest(got.manifest);
          if (got.atlases.length !== manifest.atlases.length) throw new Error('effects: the manifest names one count of atlases and another was handed in');
          manifest.atlases.forEach((a, k) => {
            const image = got.atlases[k] as AtlasImage;
            if (image.width !== a.width || image.height !== a.height) throw new Error(`effects: atlas ${a.file} is ${image.width} x ${image.height}, and its manifest says ${a.width} x ${a.height}`);
          });
          view.setAtlases(got.atlases);
          view.warm(o.renderer);
          fx.setArt(manifest);
          art = 'ready';
          o.wake();
        } catch (err) {
          art = 'none';
          console.error(err);
        }
      },
      (err: unknown) => {
        art = 'none';
        console.error(err);
      },
    );
  }

  const onBoard = (hex: number): boolean => Number.isInteger(hex) && hex >= 0 && hex < o.hexes.count;
  const wisps = new Set<number>();
  const play = (kind: PlayKind, hex: number, opts?: { to?: number; armour?: boolean }): boolean => {
    if (!onBoard(hex)) return false;
    const at = o.hexes.centre(hex);
    let to = opts?.to !== undefined && onBoard(opts.to) ? opts.to : o.hexes.across(hex, 6);
    if (to === hex) to = o.hexes.across(hex, -6);
    const there = o.hexes.centre(to);
    const d = Math.hypot(there[0] - at[0], there[1] - at[1]) || 1;
    const way: P2 = [(there[0] - at[0]) / d, (there[1] - at[1]) / d];
    if (kind === 'gun' || kind === 'small' || kind === 'lob') fx.fire(kind, at, there, hex, to, opts?.armour ?? kind === 'gun', 0.02);
    else if (kind === 'hit') fx.arrive('hit', [at[0] + way[0] * tune.hit.edge, at[1] + way[1] * tune.hit.edge], [-way[0], -way[1]], hex, 0);
    else if (kind === 'dirt') fx.arrive('dirt', at, [-way[0], -way[1]], hex, 0);
    else if (kind === 'explosion') fx.explode(at, hex, 0);
    else if (kind === 'kill') fx.kill('burn', at, hex, 0);
    else if (kind === 'blast') fx.blast(at, hex, 0);
    else if (kind === 'fire') fx.fireAt(hex, at, 0);
    else if (kind === 'mission') fx.mission(hex, at, 0);
    else if (kind === 'screen') {
      if (!watch.extraScreens.delete(hex)) watch.extraScreens.add(hex);
      watch.refreshScreens();
    } else if (kind === 'wisp') {
      const on = !wisps.delete(hex);
      if (on) wisps.add(hex);
      fx.wisp(100000 + hex, on, at, hex);
    } else if (kind === 'exhaust') fx.exhaust(at, way, hex, 0);
    else {
      // A vehicle's way: its exhaust where it starts, then a puff for every so much of four hexes.
      fx.exhaust(at, way, hex, 0);
      const puffs = Math.max(2, Math.round(4 / tune.dust.every));
      for (let i = 1; i <= puffs; i++) fx.dust([at[0] + way[0] * i * tune.dust.every, at[1] + way[1] * i * tune.dust.every], way, hex, 1, i * 0.1);
    }
    o.wake();
    return true;
  };

  const wait = (ms: number): Promise<void> => new Promise(resolve => window.setTimeout(resolve, ms));
  const exchange = async (): Promise<{ a: number; b: number } | null> => {
    const pieces = watch.pieces;
    if (!pieces) return null;
    // Two tanks of two sides, each the top of its stack, the nearest such pair that is a few hexes apart.
    const tanks = pieces.list.filter(p => {
      const u = unitFx(table, p.face);
      const stack = pieces.stackAt(p.home.hex);
      return !p.off && p.state === 'home' && u.fire === 'gun' && u.armour && stack[stack.length - 1] === p;
    });
    let best: { a: (typeof tanks)[number]; b: (typeof tanks)[number]; d: number } | null = null;
    for (const a of tanks) {
      for (const b of tanks) {
        if (a.side === b.side) continue;
        const d = Math.hypot(a.pose.p[0] - b.pose.p[0], a.pose.p[1] - b.pose.p[1]);
        if (d >= 3 && (!best || d < best.d)) best = { a, b, d };
      }
    }
    if (!best) return null;
    const { a, b } = best;
    const ha = a.home.hex;
    const hb = b.home.hex;
    const pace = 1 / fx.speed;
    pieces.threats([{ from: ha, to: hb, label: '62%', live: true }]);
    await wait(1500 * pace);
    pieces.threats([]);
    await wait(260 * pace);
    pieces.threats([{ from: hb, to: ha, label: '48%', live: true }]);
    await wait(1350 * pace);
    void pieces.remove(a.id, 'destroyed').catch(() => undefined);
    await wait(800 * pace);
    pieces.threats([]);
    return { a: ha, b: hb };
  };

  const hook: FxHook = {
    on: true,
    get art() {
      return art;
    },
    get bursts() {
      return fx.bursts;
    },
    get lasting() {
      return fx.lasting;
    },
    get particles() {
      return fx.pool.count;
    },
    get patches() {
      return fx.pool.patches;
    },
    get dropped() {
      return fx.pool.dropped;
    },
    get started() {
      return { ...fx.started };
    },
    get ambientFrames() {
      return ambientFrames;
    },
    get textures() {
      return { ...view.textures };
    },
    get drawCalls() {
      return drawn;
    },
    tune,
    get mode() {
      return { ...mode };
    },
    get now() {
      return fx.now;
    },
    get flashes() {
      return fx.flashTimes();
    },
    play,
    exchange,
    clear: () => {
      fx.clear();
      watch.extraScreens.clear();
      wisps.clear();
      o.wake();
    },
    pause: on => {
      paused = on;
      last = 0;
      o.wake();
    },
    advance: seconds => {
      // In small steps, as the page's loop would take them.
      let left = Math.max(0, seconds);
      while (left > 1e-9) {
        const dt = Math.min(1 / 60, left);
        watch.step();
        fx.step(dt / fx.speed, performance.now());
        left -= dt;
      }
    },
  };

  return {
    object: view.group,
    watch,
    shots: {
      fired: a => {
        watch.fired(a);
        o.wake();
      },
      landed: a => {
        watch.landed(a);
        o.wake();
      },
    },
    hook,
    step: ts => {
      if (paused) return 0;
      const dt = last > 0 ? Math.min(0.05, Math.max(0, (ts - last) / 1000)) : 1 / 60;
      watch.step();
      const alive = fx.step(dt, ts);
      const state = watch.busy ? 2 : alive;
      last = state === 0 ? 0 : ts;
      return state;
    },
    sync: (camera, lit) => {
      view.sync(camera, lit);
      drawn = (fx.pool.instances > 0 ? 1 : 0) + (fx.pool.decals > 0 ? 1 : 0);
    },
    setMode: m => {
      if (m.flat !== undefined) mode.flat = m.flat;
      if (m.reduced !== undefined) mode.reduced = m.reduced;
      fx.setMode(mode);
    },
    countAmbient: () => {
      ambientFrames++;
    },
    get ambientMs() {
      return 1000 / Math.max(1, tune.all.ambientFps);
    },
    restore: () => view.restore(),
  };
}
