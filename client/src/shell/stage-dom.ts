/**
 * The stage on the page (stage.ts has the arithmetic and says what the stage is).
 *
 * `mountStage(root)` makes a black page that fills the window and, centred on it, the stage: an
 * element that is always `STAGE_SIZE` pixels by its own measure (2752 by 1536) and is scaled as one
 * thing to its fitted size. A screen is an element put into `stage.element` and laid out in stage
 * pixels (position, size, type size: all of it); it never reads the window. Because the scaling is
 * one transform of the stage,
 *
 *   - a click lands where it looks, and hit areas, focus marks and lettering scale together;
 *   - lettering is real text and is drawn sharp at every scale (it is not a scaled picture);
 *   - a new size of window changes that one transform and nothing else: no screen is laid out again.
 *
 * A canvas that fills the stage should hold `fit().pixels` pixels (its size in the display's own),
 * and be told of a new fit by `onFit`.
 *
 * How a new screen mounts:
 *
 *     const stage = mountStage(root);                 // once for the page (title.ts does it)
 *     const screen = document.createElement('div');   // the screen: fills the stage
 *     screen.style.cssText = 'position:absolute;inset:0';
 *     stage.element.append(screen);                   // children placed in stage pixels
 *     const stop = stage.onFit(fit => resizeMyCanvas(fit.pixels));   // only if it has a canvas
 */
import { STAGE_SIZE, fitStage } from './stage';
import type { StageFit } from './stage';

export interface Stage {
  /** Where screens are put: `STAGE_SIZE` pixels by its own measure, whatever the window. */
  readonly element: HTMLElement;
  /** The stage as it is fitted now. */
  fit(): StageFit;
  /** Calls `fn` now and whenever the stage is fitted again; returns a function that stops the calls. */
  onFit(fn: (fit: StageFit) => void): () => void;
  dispose(): void;
}

const STYLE_ID = 'sh-stage-style';
const CSS = `
.sh-page { position: fixed; inset: 0; overflow: hidden; background: rgb(0, 0, 0); }
.sh-fit { position: absolute; overflow: hidden; }
.sh-stage { position: absolute; left: 0; top: 0; width: ${STAGE_SIZE[0]}px; height: ${STAGE_SIZE[1]}px; transform-origin: 0 0; overflow: hidden; }
`;

export function mountStage(root: HTMLElement): Stage {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  const page = document.createElement('div');
  page.className = 'sh-page';
  const box = document.createElement('div');
  box.className = 'sh-fit';
  const element = document.createElement('div');
  element.className = 'sh-stage';
  box.appendChild(element);
  page.appendChild(box);
  root.appendChild(page);

  const listeners = new Set<(fit: StageFit) => void>();
  const measure = (): StageFit => fitStage(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight), window.devicePixelRatio || 1);
  let fit = measure();
  const place = (): void => {
    fit = measure();
    box.style.left = `${fit.x}px`;
    box.style.top = `${fit.y}px`;
    box.style.width = `${fit.width}px`;
    box.style.height = `${fit.height}px`;
    element.style.transform = `scale(${fit.scale})`;
    for (const fn of [...listeners]) fn(fit);
  };
  // One fitting a frame at most, however many times the window says it has changed.
  let due = 0;
  const resized = (): void => {
    if (due !== 0) return;
    due = requestAnimationFrame(() => {
      due = 0;
      place();
    });
  };
  window.addEventListener('resize', resized);
  place();

  return {
    element,
    fit: () => fit,
    onFit(fn) {
      listeners.add(fn);
      fn(fit);
      return () => listeners.delete(fn);
    },
    dispose() {
      window.removeEventListener('resize', resized);
      if (due !== 0) cancelAnimationFrame(due);
      page.remove();
    },
  };
}
