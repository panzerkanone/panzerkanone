/**
 * The PLAY GAME medallion: on a page that opens on the title and has not yet been touched (waiting.ts),
 * it stands in the menu's place, low in the middle over the tanks with its small plate on the leather
 * strip, as the owner's mockup has it, and the menu waits behind it.
 *
 * It is the owner's 2D cut at once. The live medallion (client/src/medallion, fetched after the title's
 * own picture is up, never with it) takes the cut's place when it is ready, in one frame and with
 * nothing to see, for at rest it is that cut pixel for pixel; from then:
 *
 *   - Left alone it asks to be pressed: a band of light sweeps across its metal every few seconds, now
 *     and then a low flame wakes along a part of its rim and spits a few embers, a faint warmth breathes
 *     round it, and after a quarter of a minute untouched it flares almost to the full burn and dies back.
 *   - Under the pointer, or the keyboard's focus, it catches fire where it was touched and burns as the
 *     owner painted it ablaze: a live fire round its outline, his embers and ash flying, the edges of its
 *     letters alight; it turns a few degrees toward the pointer, and the sweep surges the letters' glow
 *     as it passes. Left, it dies down.
 *   - Held down, it goes in a little. A click or a tap, Enter or Space presses it: the press's sound, it
 *     is driven in, a flash, a ring of embers thrown out, the fire tearing away as it goes, and the menu
 *     comes in through it with the hand on Play Scenario. A press anywhere else only makes it flare.
 *
 * Where the live one cannot be drawn (no WebGL 2, or the detail is low) the 2D cut stays: a band of light
 * crosses it at rest, it takes the owner's ablaze cut with a soft halo when hot, and fades on its press.
 * Every change is eased.
 *
 * It is a button (its accessible name in words.ts); a press is taken by its disc and its two plates,
 * not by the empty corners of its box (places.ts: PLAY.hit).
 */
import type { Layout } from './layout';
import type { ShellArt } from './manifest';
import { PLAY } from './places';
import type { StageFit } from './stage';
import { WORDS } from './words';

/** The live medallion's handle, as play.ts uses it (client/src/medallion: Medallion3D). */
interface Model {
  readonly state: { ready: boolean; frames: number; drawMs: number; drawMsMost: number; burn: number; embers: number; glow: number; sweeping: boolean; rested: number; gpuMs: number; detail: number };
  resize(pixels: number): void;
  hot(on: boolean, x: number, y: number): void;
  aim(x: number, y: number): void;
  down(on: boolean): void;
  press(gone: () => void): void;
  pulse(): void;
  reduce(on: boolean): void;
  pause(on: boolean): void;
  stand(t: number | null): void;
  dispose(): void;
}

export interface PlayOptions {
  root: HTMLElement;
  art: ShellArt;
  layout: Layout;
  address(file: string): string;
  /** The screen's clock now (backdrop.ts), and the seed of everything that moves. */
  clock(): number;
  seed: number;
  fit(): StageFit;
  reduced: boolean;
  /** The 3D model may be drawn (the detail is not low). */
  model: boolean;
  /** It was pressed: the sound and the menu are the title's (title.ts). */
  onPress(): void;
}

export interface PlayState {
  /** Waiting for its press. */
  waiting: boolean;
  /** Shown on the screen (it fades away after its press). */
  shown: boolean;
  /** Hot now: under the pointer or the keyboard's focus. */
  hot: boolean;
  /** What is drawn: the 2D cut, or the 3D model; and the model's counts once it is drawn. */
  look: '2d' | '3d';
  model: 'none' | 'loading' | 'ready' | 'failed' | 'gone';
  modelFrames: number;
  modelDrawMs: number;
  /** How much the live medallion burns now (0 to 1), and how many embers it has in the air. */
  burn: number;
  embers: number;
  /** How much fire of any kind the live medallion shows now (the burn, a smoulder, the breath), and whether the sweep is passing. */
  glow: number;
  sweeping: boolean;
  /** The live medallion's frames passed over because nothing had changed; the graphics card's milliseconds a frame (-1: not timed here); the canvas's share of the display's pixels. */
  modelRested: number;
  modelGpuMs: number;
  modelDetail: number;
  pressedAt: number | null;
  pulses: number;
}

export interface Play {
  /** Its state now, the model's counts included (`window.__title.play()`). */
  counts(): PlayState;
  /** For captures: the live medallion's clock stands at this time and that moment is drawn (null: it runs again). */
  stand(t: number | null): void;
  /** The title's own picture is up: the 3D model may be fetched now. */
  pictureUp(): void;
  /** A press on the screen that was not the medallion's. */
  elsewhere(): void;
  /** Enter or Space with the focus on nothing: presses it. True when it was the medallion's. */
  key(e: KeyboardEvent): boolean;
  /** The stage has a new size: the model's canvas is given its pixels. */
  resize(fit: StageFit): void;
  /** Another screen covers the title (true): the model draws nothing until it is shown again. */
  pause(paused: boolean): void;
  setReduced(reduced: boolean): void;
  /** Taken away at once without its press (the title left by another way): no sound, no burst. */
  drop(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
};

export function buildPlay(o: PlayOptions): Play {
  const { layout: l } = o;
  const image = (file: string): string => `url("${o.address(file)}")`;
  const box = (e: HTMLElement, b: { x: number; y: number; w: number; h: number }): void => {
    e.style.left = `${b.x}px`;
    e.style.top = `${b.y}px`;
    e.style.width = `${b.w}px`;
    e.style.height = `${b.h}px`;
  };

  const button = el('button', 'sh-play');
  button.type = 'button';
  button.setAttribute('aria-label', WORDS.playLabel);
  box(button, l.play);
  const art = el('span', 'sh-play-art');
  const rest = el('span', 'sh-play-rest');
  rest.style.backgroundImage = image(o.art.play.rest.file);
  const lit = el('span', 'sh-play-lit');
  lit.style.backgroundImage = image(o.art.play.ablaze.file);
  // The 2D sweep: a band of light that crosses the medallion's metal, cut to its shape.
  const sheen = el('span', 'sh-play-sheen');
  sheen.style.maskImage = image(o.art.play.rest.file);
  sheen.style.webkitMaskImage = image(o.art.play.rest.file);
  sheen.append(el('span', 'sh-play-band'));
  // The live medallion's canvas: larger than the cut's box, for its fire and its embers.
  const canvas = el('canvas', 'sh-play-3d');
  canvas.setAttribute('aria-hidden', 'true');
  box(canvas, { x: l.playCanvas.x - l.play.x, y: l.playCanvas.y - l.play.y, w: l.playCanvas.w, h: l.playCanvas.h });
  art.append(rest, lit, sheen, canvas);
  button.append(art);
  // Where a press takes it: its disc and its two plates.
  const hits = (['disc', 'plate', 'tag'] as const).map(part => {
    const h = el('span', `sh-play-hit sh-play-hit-${part}`);
    box(h, l.playHit[part]);
    return h;
  });
  button.append(...hits);
  o.root.append(button);

  const state: PlayState = { waiting: true, shown: true, hot: false, look: '2d', model: 'none', modelFrames: 0, modelDrawMs: 0, burn: 0, embers: 0, glow: 0, sweeping: false, modelRested: 0, modelGpuMs: -1, modelDetail: 1, pressedAt: null, pulses: 0 };
  let reduced = o.reduced;
  let model: Model | null = null;
  let modelPaused = false;
  let over = 0;
  let focused = false;
  /** Where it was touched last, in the cut's own pixels (the fire catches there); the keyboard's focus touches its foot. */
  let touched: [number, number] = [l.play.w / 2, l.play.h];
  const setHot = (): void => {
    const hot = state.waiting && (over > 0 || focused);
    if (hot === state.hot) return;
    state.hot = hot;
    button.classList.toggle('sh-hot', hot);
    if (over === 0) touched = [l.play.w / 2, l.play.h];
    model?.hot(hot, touched[0], touched[1]);
  };
  const where = (e: PointerEvent): [number, number] => {
    // The pointer's place in the cut's own pixels (the stage's own arithmetic).
    const f = o.fit();
    return [(e.clientX - f.x) / f.scale - l.play.x, (e.clientY - f.y) / f.scale - l.play.y];
  };
  const setDown = (down: boolean): void => {
    button.classList.toggle('sh-down', down && state.waiting);
    model?.down(down && state.waiting);
  };

  for (const h of hits) {
    h.addEventListener('pointerenter', e => {
      over++;
      touched = where(e);
      setHot();
    });
    h.addEventListener('pointerleave', () => {
      over = Math.max(0, over - 1);
      setHot();
      if (over === 0) setDown(false);
    });
    h.addEventListener('pointermove', e => {
      // Where the pointer is over the medallion, -1 to 1 across and down its box.
      const [x, y] = where(e);
      model?.aim((2 * x) / l.play.w - 1, (2 * y) / l.play.h - 1);
    });
    h.addEventListener('pointerdown', () => setDown(true));
  }
  for (const up of ['pointerup', 'pointercancel'] as const) button.addEventListener(up, () => setDown(false));
  button.addEventListener('focus', () => {
    // The keyboard's focus lights it as the pointer does (a click's focus is the pointer's own).
    focused = button.matches(':focus-visible');
    setHot();
  });
  button.addEventListener('blur', () => {
    focused = false;
    setHot();
    setDown(false);
  });
  button.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) setDown(true);
  });
  button.addEventListener('keyup', () => setDown(false));
  button.addEventListener('click', () => press());

  function end(): void {
    state.shown = false;
    button.hidden = true;
    if (model) {
      state.modelFrames = model.state.frames;
      state.modelDrawMs = model.state.drawMs;
      state.modelRested = model.state.rested;
      state.modelGpuMs = model.state.gpuMs;
      state.modelDetail = model.state.detail;
      model.dispose();
      model = null;
      state.model = 'gone';
    }
  }

  function press(): void {
    if (!state.waiting) return;
    state.waiting = false;
    state.pressedAt = o.clock();
    over = 0;
    focused = false;
    setHot();
    button.classList.remove('sh-down');
    button.inert = true;
    o.onPress();
    // The live medallion's press is its own (driven in, a flash, embers thrown, the fire tearing away): the button stays, taking nothing, until the last of it has gone.
    if (model) {
      model.press(end);
      return;
    }
    // The 2D one fades away, a little larger, as if blown off.
    const fade = button.animate(
      [
        { opacity: 1, transform: 'scale(1)' },
        { opacity: 0, transform: `scale(${reduced ? 1 : 1.05})` },
      ],
      { duration: reduced ? 10 : PLAY.ease.gone * 1000, easing: 'cubic-bezier(0.4, 0, 0.6, 1)', fill: 'forwards' },
    );
    fade.finished.then(end, end);
  }

  return {
    counts: () => ({ ...state, modelFrames: model?.state.frames ?? state.modelFrames, modelDrawMs: model?.state.drawMs ?? state.modelDrawMs, burn: model?.state.burn ?? 0, embers: model?.state.embers ?? 0, glow: model?.state.glow ?? 0, sweeping: model?.state.sweeping ?? false, modelRested: model?.state.rested ?? state.modelRested, modelGpuMs: model?.state.gpuMs ?? state.modelGpuMs, modelDetail: model?.state.detail ?? state.modelDetail }),
    stand(t) {
      model?.stand(t);
    },
    pictureUp() {
      if (!state.waiting || !o.model || model !== null || state.model !== 'none') return;
      state.model = 'loading';
      void import('../medallion')
        .then(m => m.startMedallion({ canvas, box: l.playCanvas, cut: l.play, card: o.address(o.art.play.rest.file), look: PLAY.model, reduced, seed: o.seed, clock: o.clock }))
        .then(
          made => {
            if (!made) {
              state.model = 'failed';
              return;
            }
            if (!state.shown) {
              made.dispose();
              state.model = 'gone';
              return;
            }
            model = made;
            state.model = 'ready';
            state.look = '3d';
            made.resize(o.fit().pixels[0] / l.width);
            made.hot(state.hot, touched[0], touched[1]);
            made.pause(modelPaused);
            // The live medallion at rest is the 2D cut, pixel for pixel: it takes the cut's place in the same frame (style.ts).
            button.classList.add('sh-3d');
          },
          (err: unknown) => {
            console.warn('medallion: the 3D model could not be fetched; the 2D medallion stays', err);
            state.model = 'failed';
          },
        );
    },
    elsewhere() {
      if (!state.waiting) return;
      state.pulses++;
      if (model) {
        model.pulse();
        return;
      }
      if (!reduced) {
        button.animate(
          [
            { transform: 'scale(1)', filter: 'brightness(1)' },
            { transform: 'scale(1.025)', filter: 'brightness(1.18)', offset: 0.3 },
            { transform: 'scale(1)', filter: 'brightness(1)' },
          ],
          { duration: PLAY.ease.pulse * 1000, easing: 'ease-out' },
        );
      }
    },
    key(e) {
      if (!state.waiting || e.altKey || e.ctrlKey || e.metaKey || e.repeat) return false;
      if (e.key !== 'Enter' && e.key !== ' ') return false;
      // A focused medallion takes its own keys (as a button does); with the focus on nothing, the key is its press.
      if (document.activeElement === button) return false;
      press();
      return true;
    },
    resize(f) {
      model?.resize(f.pixels[0] / l.width);
    },
    pause(p) {
      modelPaused = p;
      model?.pause(p);
    },
    setReduced(r) {
      reduced = r;
      model?.reduce(r);
    },
    drop() {
      if (!state.waiting) return;
      state.waiting = false;
      setHot();
      button.inert = true;
      end();
    },
  };
}
