/**
 * The stage: the one rectangle every screen of the shell is shown in (the title and main menu,
 * the settings, whatever comes before a game). Plain arithmetic, no browser: stage-dom.ts puts it
 * on the page.
 *
 * The stage has the shape of the owner's art, 2752 by 1536, and is laid out in those pixels: a
 * screen places everything it shows in stage pixels and never asks how large the window is. The
 * stage is fitted to the window as one thing:
 *
 *   - centred, across and down, on a plain black page; nothing of the shell is drawn outside it,
 *     and nothing of the art is ever cropped or stretched;
 *   - as large as fits the window, but never larger than the art's own size in the display's
 *     pixels (2752 of them across: 1376 CSS pixels on a display of density 2, up to 2752 on one of
 *     density 1), with black left round it when the window is larger;
 *   - on a smaller window, smaller, whole, down to a phone held sideways.
 *
 * The game itself (the table) is not on the stage: it fills the window.
 */

/** The stage's size in its own pixels: the size of the owner's art. */
export const STAGE_SIZE: readonly [number, number] = [2752, 1536];

export interface StageFit {
  /** CSS pixels to a stage pixel. */
  scale: number;
  /** Where the stage's top-left corner lies in the window, and its size there, in CSS pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Its size in the display's own pixels: what a canvas that fills it holds. Whole numbers. */
  pixels: readonly [number, number];
}

/**
 * The stage in a window of `windowWidth` by `windowHeight` CSS pixels on a display of
 * `pixelRatio` device pixels to a CSS pixel. The stage is a whole number of device pixels across
 * and its corner lies on a device pixel, so that what is drawn on it is sharp.
 */
export function fitStage(windowWidth: number, windowHeight: number, pixelRatio: number, size: readonly [number, number] = STAGE_SIZE): StageFit {
  if (!(windowWidth > 0) || !(windowHeight > 0)) throw new Error(`a window needs a size, got ${windowWidth} x ${windowHeight}`);
  const ratio = pixelRatio > 0 && Number.isFinite(pixelRatio) ? pixelRatio : 1;
  const [sw, sh] = size;
  // In device pixels: the widest that fits the window both ways, and no wider than the art itself.
  const wide = Math.max(1, Math.floor(Math.min(windowWidth * ratio, (windowHeight * ratio * sw) / sh, sw) + 1e-6));
  const high = Math.max(1, Math.min(Math.round((wide * sh) / sw), Math.floor(windowHeight * ratio + 1e-6)));
  const width = wide / ratio;
  const height = high / ratio;
  return {
    scale: width / sw,
    x: Math.max(0, Math.round((windowWidth * ratio - wide) / 2)) / ratio,
    y: Math.max(0, Math.round((windowHeight * ratio - high) / 2)) / ratio,
    width,
    height,
    pixels: [wide, high],
  };
}

/** A point of the stage (stage pixels), in the window (CSS pixels). */
export function onWindow(fit: StageFit, x: number, y: number): [number, number] {
  return [fit.x + x * fit.scale, fit.y + y * fit.scale];
}
