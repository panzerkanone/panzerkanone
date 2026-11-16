/**
 * A season's ink table, derived from summer's by one colour transform (the owner, 2026-11-14:
 * "Desaturate, move towards ice blue ... We should be able to get the existing color set, imagery
 * to look like the winter versions without too much trouble").
 *
 * The file (mapart/data/inks-winter.yaml, format `inks-season/1`) holds no ink of summer's plates.
 * It holds the colours sampled from the owner's example (the ice blue, the snow white and the haze
 * on a slope, each with where it was taken), the transform's three numbers, the plates excepted from
 * it (each with its reason), the plates whose ink is a sample as it shows on the snow (`onSnow`), and
 * the season's own plates (each a shade of the ice blue). Every other plate of the summer table is
 * the summer ink transformed, so a plate added to summer later has its winter ink at once.
 *
 * The transform, in OKLab (lightness L and the colour plane a, b), for each summer ink:
 *   1. keep `saturation` of its colour: a and b multiplied by it;
 *   2. move it `towardIce` of the way toward the ice blue's colour: a and b toward the sample's
 *      (its lightness is kept: the sample is a photograph, and its lightness is the table's light);
 *   3. the ground plate only (`groundPlate`): move it `groundLift` of the way toward the snow white,
 *      all three of L, a and b: how much lighter, and how much colder, the ground goes.
 * An exception gives its own `saturation` and `towardIce` for one plate. The margin is the summer
 * margin transformed as any ink is.
 *
 * A plate of `onSnow` takes no part of summer's ink: a hue the transform cannot reach from summer's
 * (a brown from an olive). Its sample is the element as it shows on the snow in his picture, and a
 * plate prints over the ground, plates multiplying (docs/art/map-art-spec.md, section 2). So its
 * ink is the sample with the snow white divided out of it, channel by channel: the ratio of two
 * colours of the one picture, which its light does not change, and which printed at full tone on
 * the snow gives the sample back.
 *
 * Pure arithmetic: no randomness. The result is rounded to #RRGGBB.
 */
import type { InkPlate, InkTable, LoadResult } from './params';

/** OKLab of an sRGB colour #RRGGBB. */
export function oklabOf(hex: string): [number, number, number] {
  const v = Number.parseInt(hex.slice(1), 16);
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = lin(Math.floor(v / 65536) % 256);
  const g = lin(Math.floor(v / 256) % 256);
  const b = lin(v % 256);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** #RRGGBB of an OKLab colour, each channel clamped into sRGB. */
export function hexOfOklab(lab: readonly [number, number, number]): string {
  const [L, A, B] = lab;
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const enc = (c: number): string => {
    const x = c <= 0 ? 0 : c >= 1 ? 1 : c;
    const e = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, e)) * 255).toString(16).padStart(2, '0').toUpperCase();
  };
  return `#${enc(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)}${enc(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)}${enc(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)}`;
}

/** The colours sampled from the owner's example. */
export const SAMPLES = ['iceBlue', 'snowWhite', 'slopeHaze', 'slopeHazeFaded'] as const;
export type SampleName = (typeof SAMPLES)[number];

/** The season's ink file, as read. */
export interface SeasonInkSpec {
  format: string;
  name: string;
  version: number;
  season: string;
  /** Colours sampled from the owner's example, each with where it was taken. */
  sampled: Record<SampleName, { colour: string; where: string }>;
  /** How much of each ink's colour is kept, how far it moves toward the ice blue, how far the ground moves toward the snow white. */
  transform: { saturation: number; towardIce: number; groundLift: number };
  /** The summer plate the ground lift is for. */
  groundPlate: string;
  /** Plates the transform treats otherwise, each with its own numbers and its reason. */
  exceptions: Record<string, { saturation: number; towardIce: number; reason: string }>;
  /** Plates whose ink is a sample as it shows on the snow (the sample with the snow white divided out), each with its reason. */
  onSnow: Record<string, { sample: SampleName; reason: string }>;
  /** The season's own plates: the ice blue at a lightness (OKLab L) and a share of its colour. */
  plates: { id: string; offset: [number, number]; lightness: number; chroma: number; reason: string }[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const COLOUR = /^#[0-9A-Fa-f]{6}$/;
const PLATE = /^[a-z][a-z0-9-]*$/;

function keysOf(v: Record<string, unknown>, where: string, keys: readonly string[], problems: string[]): void {
  for (const k of Object.keys(v)) if (!keys.includes(k)) problems.push(`${where}${k} is not a known key (unknown keys are refused)`);
  for (const k of keys) if (!(k in v)) problems.push(`${where}${k} is missing`);
}

function share(v: unknown, where: string, problems: string[], lo = 0, hi = 1): void {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) problems.push(`${where} must be a number from ${lo} to ${hi}, got ${JSON.stringify(v)}`);
}

function text(v: unknown, where: string, problems: string[]): void {
  if (typeof v !== 'string' || v.trim().length === 0) problems.push(`${where} must be some words, got ${JSON.stringify(v)}`);
}

/** Check a parsed season ink file (every key required, unknown keys refused). */
export function validateSeasonInks(raw: unknown): LoadResult<SeasonInkSpec> {
  const problems: string[] = [];
  if (!isRecord(raw)) return { value: null, problems: [`a season ink file must be a mapping, got ${JSON.stringify(raw)}`] };
  keysOf(raw, '', ['format', 'name', 'version', 'season', 'sampled', 'transform', 'groundPlate', 'exceptions', 'onSnow', 'plates'], problems);
  if ('format' in raw && raw.format !== 'inks-season/1') problems.push(`format must be 'inks-season/1', got ${JSON.stringify(raw.format)}`);
  if ('name' in raw && (typeof raw.name !== 'string' || raw.name.length === 0)) problems.push(`name must be a non-empty string, got ${JSON.stringify(raw.name)}`);
  if ('version' in raw && (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1)) problems.push(`version must be a whole number from 1, got ${JSON.stringify(raw.version)}`);
  if ('season' in raw && raw.season !== 'winter') problems.push(`season must be 'winter', got ${JSON.stringify(raw.season)}`);
  if ('sampled' in raw) {
    if (!isRecord(raw.sampled)) problems.push('sampled must be a mapping');
    else {
      keysOf(raw.sampled, 'sampled.', SAMPLES, problems);
      for (const k of SAMPLES) {
        const s = raw.sampled[k];
        if (!(k in raw.sampled)) continue;
        if (!isRecord(s)) {
          problems.push(`sampled.${k} must be { colour, where }`);
          continue;
        }
        keysOf(s, `sampled.${k}.`, ['colour', 'where'], problems);
        if ('colour' in s && (typeof s.colour !== 'string' || !COLOUR.test(s.colour))) problems.push(`sampled.${k}.colour must be a colour written #rrggbb, got ${JSON.stringify(s.colour)}`);
        if ('where' in s) text(s.where, `sampled.${k}.where`, problems);
      }
    }
  }
  if ('transform' in raw) {
    if (!isRecord(raw.transform)) problems.push('transform must be a mapping');
    else {
      keysOf(raw.transform, 'transform.', ['saturation', 'towardIce', 'groundLift'], problems);
      for (const k of ['saturation', 'towardIce', 'groundLift']) if (k in raw.transform) share(raw.transform[k], `transform.${k}`, problems);
    }
  }
  if ('groundPlate' in raw && (typeof raw.groundPlate !== 'string' || !PLATE.test(raw.groundPlate))) problems.push(`groundPlate must be a plate name, got ${JSON.stringify(raw.groundPlate)}`);
  if ('exceptions' in raw) {
    if (!isRecord(raw.exceptions)) problems.push('exceptions must be a mapping of plate names');
    else {
      for (const [id, e] of Object.entries(raw.exceptions)) {
        if (!PLATE.test(id)) problems.push(`exceptions.${id}: not a plate name`);
        if (!isRecord(e)) {
          problems.push(`exceptions.${id} must be { saturation, towardIce, reason }`);
          continue;
        }
        keysOf(e, `exceptions.${id}.`, ['saturation', 'towardIce', 'reason'], problems);
        if ('saturation' in e) share(e.saturation, `exceptions.${id}.saturation`, problems);
        if ('towardIce' in e) share(e.towardIce, `exceptions.${id}.towardIce`, problems);
        if ('reason' in e) text(e.reason, `exceptions.${id}.reason`, problems);
      }
    }
  }
  if ('onSnow' in raw) {
    if (!isRecord(raw.onSnow)) problems.push('onSnow must be a mapping of plate names (it may be empty)');
    else {
      for (const [id, e] of Object.entries(raw.onSnow)) {
        if (!PLATE.test(id)) problems.push(`onSnow.${id}: not a plate name`);
        if (!isRecord(e)) {
          problems.push(`onSnow.${id} must be { sample, reason }`);
          continue;
        }
        keysOf(e, `onSnow.${id}.`, ['sample', 'reason'], problems);
        if ('sample' in e && !(SAMPLES as readonly unknown[]).includes(e.sample)) problems.push(`onSnow.${id}.sample must be one of the sampled colours (${SAMPLES.join(', ')}), got ${JSON.stringify(e.sample)}`);
        if ('reason' in e) text(e.reason, `onSnow.${id}.reason`, problems);
      }
    }
  }
  if ('plates' in raw) {
    if (!Array.isArray(raw.plates)) problems.push('plates must be a list (it may be empty)');
    else {
      raw.plates.forEach((p: unknown, i: number) => {
        const where = `plates[${i + 1}]`;
        if (!isRecord(p)) {
          problems.push(`${where} must be { id, offset, lightness, chroma, reason }`);
          return;
        }
        keysOf(p, `${where}.`, ['id', 'offset', 'lightness', 'chroma', 'reason'], problems);
        if ('id' in p && (typeof p.id !== 'string' || !PLATE.test(p.id))) problems.push(`${where}.id must be a plate name, got ${JSON.stringify(p.id)}`);
        if ('offset' in p) {
          const off = p.offset;
          if (!Array.isArray(off) || off.length !== 2 || off.some(v => typeof v !== 'number' || !Number.isFinite(v))) problems.push(`${where}.offset must be two numbers [x, y] in h`);
          else {
            const l = Math.hypot(off[0] as number, off[1] as number);
            if (l !== 0 && (l < 0.005 - 1e-9 || l > 0.011 + 1e-9)) problems.push(`${where}.offset must be 0 or between 0.005 and 0.011 h long (docs/art/map-art-spec.md, section 2), got ${l.toFixed(4)}`);
          }
        }
        if ('lightness' in p) share(p.lightness, `${where}.lightness`, problems);
        if ('chroma' in p) share(p.chroma, `${where}.chroma`, problems, 0, 4);
        if ('reason' in p) text(p.reason, `${where}.reason`, problems);
      });
    }
  }
  return problems.length > 0 ? { value: null, problems } : { value: raw as unknown as SeasonInkSpec, problems };
}

/**
 * A sample as an ink that prints over the snow: the sample with the snow white divided out of it, channel
 * by channel (sRGB values, as the plates multiply), no channel over full.
 */
export function inkOnSnow(sample: string, snowWhite: string): string {
  const channels = (hex: string): number[] => [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16));
  const snow = channels(snowWhite);
  return `#${channels(sample).map((v, i) => Math.min(255, Math.round((255 * v) / Math.max(1, snow[i] as number))).toString(16).padStart(2, '0').toUpperCase()).join('')}`;
}

/**
 * One summer ink in the season: the transform of this file (with the plate's exception, if it has one); or,
 * for a plate of `onSnow`, its sample as an ink over the snow, whatever summer's ink is.
 */
export function seasonInk(spec: SeasonInkSpec, plate: string, ink: string): string {
  const taken = spec.onSnow[plate];
  if (taken) return inkOnSnow(spec.sampled[taken.sample].colour, spec.sampled.snowWhite.colour);
  const [L, a, b] = oklabOf(ink);
  const ice = oklabOf(spec.sampled.iceBlue.colour);
  const e = spec.exceptions[plate];
  const keep = e ? e.saturation : spec.transform.saturation;
  const toward = e ? e.towardIce : spec.transform.towardIce;
  const a1 = a * keep + (ice[1] - a * keep) * toward;
  const b1 = b * keep + (ice[2] - b * keep) * toward;
  if (plate !== spec.groundPlate) return hexOfOklab([L, a1, b1]);
  const snow = oklabOf(spec.sampled.snowWhite.colour);
  const k = spec.transform.groundLift;
  return hexOfOklab([L + (snow[0] - L) * k, a1 + (snow[1] - a1) * k, b1 + (snow[2] - b1) * k]);
}

/**
 * The season's ink table from summer's: every plate and extra plate of summer's in its order, with
 * its offset and its ink transformed (or, for a plate of `onSnow`, its sample as an ink over the
 * snow); then the season's own plates, the ice blue at their lightness and colour; the margin
 * transformed. Problems: an exception, a plate of `onSnow` or the ground plate naming no plate of
 * summer's; a plate both excepted and on the snow, or the ground itself on the snow; a season plate
 * with a summer plate's name.
 */
export function deriveSeasonInks(summer: InkTable, spec: SeasonInkSpec): LoadResult<InkTable> {
  const problems: string[] = [];
  const ids = new Set([...summer.plates, ...summer.extraPlates].map(p => p.id));
  for (const id of Object.keys(spec.exceptions)) if (!ids.has(id)) problems.push(`exceptions.${id} names no plate of the ink table ${summer.name}`);
  for (const id of Object.keys(spec.onSnow)) {
    if (!ids.has(id)) problems.push(`onSnow.${id} names no plate of the ink table ${summer.name}`);
    if (id in spec.exceptions) problems.push(`onSnow.${id}: the plate is also one of the exceptions (a plate's ink is the transform's or a sample's, not both)`);
    if (id === spec.groundPlate) problems.push(`onSnow.${id}: the ground plate is the snow itself`);
  }
  if (!summer.plates.some(p => p.id === spec.groundPlate)) problems.push(`groundPlate names '${spec.groundPlate}', which is not a plate of the ink table ${summer.name}`);
  const own = new Set<string>();
  for (const p of spec.plates) {
    if (ids.has(p.id) || own.has(p.id)) problems.push(`plates: '${p.id}' is already a plate of the table`);
    own.add(p.id);
  }
  if (problems.length > 0) return { value: null, problems };
  const ice = oklabOf(spec.sampled.iceBlue.colour);
  const map = (p: InkPlate): InkPlate => ({ id: p.id, ink: seasonInk(spec, p.id, p.ink), offset: [p.offset[0], p.offset[1]] });
  const plates = [
    ...summer.plates.map(map),
    ...spec.plates.map((p): InkPlate => ({ id: p.id, ink: hexOfOklab([p.lightness, ice[1] * p.chroma, ice[2] * p.chroma]), offset: [p.offset[0], p.offset[1]] })),
  ];
  return {
    value: { format: 'inks/1', name: spec.name, version: spec.version, plates, extraPlates: summer.extraPlates.map(map), margin: seasonInk(spec, 'margin', summer.margin) },
    problems,
  };
}
