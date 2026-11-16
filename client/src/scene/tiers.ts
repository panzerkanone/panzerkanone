/**
 * Quality tiers (ruling 11; PLAN 7.2) and the rule that steps down from measured
 * frame time. Plain arithmetic, no browser.
 */

export type TierName = 'flat' | 'tabletop' | 'tabletop+';
export const TIER_NAMES: readonly TierName[] = ['flat', 'tabletop', 'tabletop+'];

/** No tilted tier draws more pixels than this (ruling 19): 2048 squared. */
export const PIXEL_CAP = 4_194_304;

export interface TierSpec {
  name: TierName;
  /** The camera tilts. */
  tilt: boolean;
  /** The board takes the light: sheen, unevenness, the lit table. */
  lit: boolean;
  /** The fine surface: scratches and the paper's tooth in the highlight. */
  surfaceDetail: boolean;
  /** The pixel ratio never goes above this. */
  maxPixelRatio: number;
}

export const TIERS: Readonly<Record<TierName, TierSpec>> = {
  flat: { name: 'flat', tilt: false, lit: false, surfaceDetail: false, maxPixelRatio: 1 },
  tabletop: { name: 'tabletop', tilt: true, lit: true, surfaceDetail: false, maxPixelRatio: 1.5 },
  'tabletop+': { name: 'tabletop+', tilt: true, lit: true, surfaceDetail: true, maxPixelRatio: 2 },
};

export function isTierName(v: unknown): v is TierName {
  return v === 'flat' || v === 'tabletop' || v === 'tabletop+';
}

/**
 * The pixel ratio a tier draws at: 1 in Flat; otherwise the device's, up to the
 * tier's own limit, reduced so that the drawing buffer has at most PIXEL_CAP
 * pixels.
 */
export function pixelRatioOf(tier: TierName, devicePixelRatio: number, css: readonly [number, number]): number {
  if (tier === 'flat') return 1;
  let ratio = Math.min(TIERS[tier].maxPixelRatio, devicePixelRatio > 0 ? devicePixelRatio : 1);
  const [w, h] = bufferSize(css, ratio);
  if (w * h > PIXEL_CAP) ratio = Math.sqrt(PIXEL_CAP / (css[0] * css[1]));
  return ratio;
}

/** The drawing buffer for a window at a pixel ratio, as the renderer sizes it. */
export function bufferSize(css: readonly [number, number], pixelRatio: number): [number, number] {
  return [Math.floor(css[0] * pixelRatio), Math.floor(css[1] * pixelRatio)];
}

/** The next tier down, or null at Flat. */
export function tierBelow(tier: TierName): TierName | null {
  return tier === 'tabletop+' ? 'tabletop' : tier === 'tabletop' ? 'flat' : null;
}

/**
 * Decides when to step down. It is fed one cost per drawn frame: GPU time where
 * the browser has a timer query, otherwise the interval between frames drawn
 * back to back. It says "step" when the median of two full windows running is
 * over the budget. After a step, or a pause in drawing, it starts a new window and skips
 * the first frames of it, which pay for new shaders and textures.
 */
export class StepDown {
  private window: number[] = [];
  private skip: number;
  private slow = 0;

  constructor(
    /** Median cost over which the tier steps down, in ms. */
    readonly budgetMs: number,
    /** Frames in a window. */
    readonly size = 12,
    /** Frames skipped at the start of each window. */
    readonly settle = 8,
  ) {
    this.skip = settle;
  }

  /** Start a new window. */
  reset(): void {
    this.slow = 0;
    this.window = [];
    this.skip = this.settle;
  }

  /** Take one frame's cost; true when the tier should step down now. */
  feed(ms: number): boolean {
    if (!Number.isFinite(ms) || ms < 0) return false;
    if (this.skip > 0) {
      this.skip--;
      return false;
    }
    this.window.push(ms);
    if (this.window.length < this.size) return false;
    const sorted = [...this.window].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] as number;
    this.window = [];
    // One slow window may be a passing load; two in a row is the tier.
    if (median > this.budgetMs) {
      this.slow++;
      if (this.slow >= 2) {
        this.slow = 0;
        this.skip = this.settle;
        return true;
      }
    } else this.slow = 0;
    return false;
  }
}

/** GPU time a frame over which the tier steps down, where a timer query measures it. */
export const GPU_BUDGET_MS = 10;
/** Without a timer query: frames drawn back to back that come further apart than this are too slow. */
export const INTERVAL_BUDGET_MS = 24;
/**
 * Without a timer query, every so many frames one is also timed from its first call to the GPU's
 * having finished it, and held to the same budget as GPU time: a load that still fits between two
 * animation frames does not show in their spacing.
 */
export const FINISH_EVERY = 3;
