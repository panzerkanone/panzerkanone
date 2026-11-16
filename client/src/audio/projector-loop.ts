/**
 * The film projector's loop, made from its recording after decoding (projector.ts fetches and decodes; this file is
 * sums only, and brings nothing with it).
 *
 * The recording is a stretch of a real projector running, a little longer than the loop, in which the claw clicks
 * `PROJECTOR_CLATTER_HZ` times a second. The loop is `PROJECTOR_LOOP_CLICKS` of those clicks, taken from a place
 * inside the stretch (whatever a decoder leaves at a file's two ends is outside it), and it must turn without a
 * seam and without a stumble:
 *
 *   - its length is a whole number of clicks, set to the sample by the clicks themselves: the stretch's going-on
 *     after the loop's end is laid against the loop's start, and the lag is taken at which the two outlines (the
 *     sound's size, smoothed over two thousandths of a second) are most alike;
 *   - the going-on is folded into the loop's first clicks by a crossfade that keeps the sound's power level through
 *     the fold, for two sounds as alike as these two are (wholly unlike, an equal-power fade; wholly alike, a
 *     straight one). Where the loop turns, the last sample is followed by the one the recording itself had next.
 */

/** The claw's clicks a second in the recording as it is cut (assets/LEDGER.yaml says how). The room's beam flickers at this rate, so that sight and sound agree. */
export const PROJECTOR_CLATTER_HZ = 20;
/** The loop's length in clicks: four seconds. */
export const PROJECTOR_LOOP_CLICKS = 80;
/** Where the loop starts in the decoded stretch, seconds. */
const LEAD_S = 0.125;
/** The going-on is folded into this many of the loop's first clicks. */
const FOLD_CLICKS = 2;
/** The loop's end is looked for within this share of a click's period either side of its counted place. */
const SEARCH = 0.12;
/** The outlines are compared over this many clicks. */
const MATCH_CLICKS = 4;
/** The outline: one value every two thousandth of a second, each the sound's size over four of them. */
const OUTLINE_HZ = 2000;
const OUTLINE_WIDE = 4;

/** How alike two runs of numbers are, -1 to 1 (their correlation, each about its own mean). */
function alike(a: Float32Array, b: Float32Array, from: number, n: number): number {
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i] ?? 0;
    mb += b[from + i] ?? 0;
  }
  ma /= n;
  mb /= n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    const x = (a[i] ?? 0) - ma;
    const y = (b[from + i] ?? 0) - mb;
    ab += x * y;
    aa += x * x;
    bb += y * y;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

/** How many samples of a decoded stretch the loop needs, at `rate` samples a second. */
export function projectorStretchNeeds(rate: number): number {
  const period = rate / PROJECTOR_CLATTER_HZ;
  const step = Math.max(1, Math.round(rate / OUTLINE_HZ));
  return Math.round(LEAD_S * rate) + Math.round(PROJECTOR_LOOP_CLICKS * period) + Math.round(SEARCH * period) + step + Math.max(Math.round(MATCH_CLICKS * period) + OUTLINE_WIDE * step, Math.round(FOLD_CLICKS * period));
}

/**
 * The loop, from the decoded stretch: one array a channel in, one array a channel out, at the same rate. Throws when
 * the stretch is too short for it (a file that was cut off).
 */
export function projectorLoop(channels: readonly Float32Array[], rate: number): Float32Array[] {
  const first = channels[0];
  const length = first?.length ?? 0;
  if (!first || channels.length > 2 || channels.some(c => c.length !== length)) throw new Error('the projector\'s recording must have one channel or two, of one length');
  if (!(rate > 0) || length < projectorStretchNeeds(rate)) throw new Error('the projector\'s recording is shorter than its loop');
  const period = rate / PROJECTOR_CLATTER_HZ;
  const start = Math.round(LEAD_S * rate);
  const counted = Math.round(PROJECTOR_LOOP_CLICKS * period);
  const fold = Math.round(FOLD_CLICKS * period);
  const step = Math.max(1, Math.round(rate / OUTLINE_HZ));
  const n = Math.floor(Math.round(MATCH_CLICKS * period) / step);
  const reach = Math.ceil((SEARCH * period) / step);

  const outline = (from: number, count: number): Float32Array => {
    const out = new Float32Array(count);
    for (let k = 0; k < count; k++) {
      const at = from + k * step;
      let sum = 0;
      for (let i = 0; i < step * OUTLINE_WIDE; i++) {
        let all = 0;
        for (const c of channels) all += c[at + i] ?? 0;
        sum += Math.abs(all);
      }
      out[k] = sum;
    }
    return out;
  };
  const head = outline(start, n);
  const tail = outline(start + counted - reach * step, n + 2 * reach);
  let lag = 0;
  let most = -Infinity;
  for (let k = -reach; k <= reach; k++) {
    const score = alike(head, tail, k + reach, n);
    // (Of two as alike, the one nearer the counted length.)
    if (score > most + 1e-9 || (Math.abs(score - most) <= 1e-9 && Math.abs(k) < Math.abs(lag))) {
      most = score;
      lag = k;
    }
  }
  const loop = counted + lag * step;

  // How alike the two sounds themselves are over the fold, sample for sample: it sets the crossfade's law.
  const mixed = (from: number): Float32Array => {
    const out = new Float32Array(fold);
    for (let i = 0; i < fold; i++) for (const c of channels) out[i] = (out[i] ?? 0) + (c[from + i] ?? 0);
    return out;
  };
  const same = Math.min(1, Math.max(0, alike(mixed(start), mixed(start + loop), 0, fold)));

  return channels.map(c => {
    const out = c.slice(start, start + loop);
    for (let i = 0; i < fold; i++) {
      const turn = ((i + 0.5) / fold) * (Math.PI / 2);
      const coming = Math.sin(turn);
      const going = Math.cos(turn);
      out[i] = ((c[start + i] ?? 0) * coming + (c[start + loop + i] ?? 0) * going) / Math.sqrt(1 + 2 * same * coming * going);
    }
    return out;
  });
}
