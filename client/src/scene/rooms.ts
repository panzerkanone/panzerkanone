/**
 * The room round the table, from the owner's HDRIs (2026-11-14: "several HDRI's ... some with strong studio light
 * sources, other's natural. we can experiment"). `env=<name>` in the address chooses one; without it the table has
 * no room, as before, and its light is the old sky. The `light=` lights (lights.ts) keep their own key, lamp and
 * window with any room: the room is the rest of the light, what used to be the sky.
 *
 * A room lights everything on the table two ways. Its light on a face, by the face's direction, from nine numbers
 * (its irradiance as spherical harmonics of order 2, upper hemisphere only: below the table's plane is the table);
 * on an upward face it is 1 in luminance, so the printed sheet keeps its calibration and only takes the room's
 * colour (by `colour`). And its reflection, in every finish by that finish's roughness, from a cube the page
 * prefilters on the GPU from the room's panorama (env.ts). Both are the room's share of the light (1 - the key's
 * share) times `strength`; the reflections also by `reflect`.
 *
 * The rooms' panoramas and the numbers here are made by tools/tableart/env.py (assets/scene/env/env.json; the
 * ledger says where each came from). Plain data and arithmetic: no browser and no three, so all of it can be checked
 * anywhere; the GLSL in shaders.ts (COMMON) does the same arithmetic as `roomFrame` and `roomIrradiance` here.
 */

export interface Room {
  /** What the room is, in a few words. */
  readonly label: string;
  /** Poly Haven's name of the HDRI. */
  readonly source: string;
  /**
   * How far the room is turned about the vertical, in degrees (a point of the room at azimuth a in the board's
   * frame, turned 0, stands at a + turnDeg). Chosen so that its brightest light stands near the key's side.
   */
  readonly turnDeg: number;
  /** The room's light, as a share of what the old sky gave (1: as much on an upward face). */
  readonly strength: number;
  /** How much of the room's own colour reaches the light: 0 grey, 1 as photographed. */
  readonly colour: number;
  /** The reflections' gain over the light (1: as the light is; more brightens only what the finishes mirror). */
  readonly reflect: number;
}

export const ROOMS = {
  /** Poly Haven "Wooden Lounge" (Greg Zaal): a warm wood-panelled room with spotlights and windows. */
  lounge: { label: 'a wood-panelled lounge, spots and windows', source: 'wooden_lounge', turnDeg: -101, strength: 1, colour: 0.85, reflect: 1 },
  /** Poly Haven "Wooden Studio 03" (Alexander Scholten): softboxes and a round light, crisp rectangular reflections. */
  studio03: { label: 'a studio with softboxes', source: 'wooden_studio_03', turnDeg: -73, strength: 1, colour: 0.7, reflect: 1 },
  /** Poly Haven "Colorful Studio" (Sergej Majboroda): lively coloured light. */
  colorful: { label: 'a studio with coloured lights', source: 'colorful_studio', turnDeg: -112, strength: 1, colour: 0.5, reflect: 1 },
  /** Poly Haven "Wooden Studio 15" (Alexander Scholten): a big soft skylight. */
  studio15: { label: 'a studio under a big soft skylight', source: 'wooden_studio_15', turnDeg: -50, strength: 1, colour: 0.7, reflect: 1 },
} as const satisfies Record<string, Room>;

export type RoomName = keyof typeof ROOMS;
export const ROOM_NAMES = Object.keys(ROOMS) as RoomName[];

export function isRoomName(name: unknown): name is RoomName {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(ROOMS, name);
}

/**
 * The finishes' roughness in the room's reflections (perceptual roughness, three's: 0 a mirror, 1 matte), and how
 * much the printed sheet may brighten by its reflection at most (the rule that no glare hides a hex number or a
 * unit). The table's coat and the tray take theirs from their own surfaces (shaders.ts, tray/shaders.ts).
 */
export const ROOM_FINISH = {
  /** The printed sheet: satin, a little shiny. */
  sheet: 0.42,
  /** The counters' printed faces. */
  face: 0.45,
  /** The most the sheet's reflection of the room may add, as a share of white. */
  sheetCap: 0.1,
};

/** What tools/tableart/env.py says of one room (env.json). */
export interface RoomFacts {
  width: number;
  height: number;
  /** The two pictures' file names: the mantissas (rgb) and the exponent (e). */
  files: { rgb: string; e: string };
  /** The panorama's radiance times this is the room's light on an upward face of 1 (in luminance). */
  scale: number;
  /** The irradiance's nine coefficients (r, g, b), convolved, scaled, in the room's frame. */
  sh: [number, number, number][];
  bytes: number;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** One room's facts out of env.json, checked: a missing or malformed field is an error, never a default. */
export function readRoomFacts(json: unknown, name: RoomName): RoomFacts {
  const rooms = (json as { rooms?: Record<string, unknown> } | null)?.rooms;
  const r = rooms?.[name] as Record<string, unknown> | undefined;
  if (!r) throw new Error(`env.json has no room ${name}`);
  const files = r.files as { rgb?: unknown; e?: unknown } | undefined;
  const sh = r.sh as unknown[] | undefined;
  if (!finite(r.width) || !finite(r.height) || r.width !== 2 * r.height || !Number.isInteger(r.width)) throw new Error(`env.json: ${name} has no panorama size`);
  if (!files || typeof files.rgb !== 'string' || typeof files.e !== 'string') throw new Error(`env.json: ${name} has no files`);
  if (!finite(r.scale) || r.scale <= 0) throw new Error(`env.json: ${name} has no scale`);
  if (!Array.isArray(sh) || sh.length !== 9 || !sh.every(c => Array.isArray(c) && c.length === 3 && c.every(finite))) throw new Error(`env.json: ${name} has no nine coefficients`);
  if (!finite(r.bytes)) throw new Error(`env.json: ${name} has no size in bytes`);
  return { width: r.width, height: r.height, files: { rgb: files.rgb, e: files.e }, scale: r.scale, sh: sh as [number, number, number][], bytes: r.bytes };
}

/** A direction of the board's frame (x right, y toward the near side, z up) in the room's frame (y up), after its turn. */
export function roomFrame(d: readonly [number, number, number], turnDeg: number): [number, number, number] {
  const a = (turnDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const tx = c * d[0] + s * d[1];
  const ty = -s * d[0] + c * d[1];
  return [tx, d[2], -ty];
}

/** The room's light on a face whose normal is n (board frame): the nine coefficients evaluated (as COMMON's GLSL does), before `colour`. */
export function roomIrradiance(sh: readonly (readonly [number, number, number])[], n: readonly [number, number, number], turnDeg: number): [number, number, number] {
  const [x, y, z] = roomFrame(n, turnDeg);
  const b = [0.282095, 0.488603 * y, 0.488603 * z, 0.488603 * x, 1.092548 * x * y, 1.092548 * y * z, 0.315392 * (3 * z * z - 1), 1.092548 * x * z, 0.546274 * (x * x - y * y)];
  const out = [0, 0, 0];
  for (let k = 0; k < 9; k++) for (let c = 0; c < 3; c++) out[c] = (out[c] as number) + ((sh[k] as readonly number[])[c] as number) * (b[k] as number);
  return [Math.max(0, out[0] as number), Math.max(0, out[1] as number), Math.max(0, out[2] as number)];
}

export const LUMA: readonly [number, number, number] = [0.2126, 0.7152, 0.0722];

/** IEEE half float of a number (round to nearest even), clamped to the largest finite half. */
export function toHalf(v: number): number {
  if (!(v > 0)) return 0;
  if (v >= 65504) return 0x7bff;
  if (v < 5.960464477539063e-8) return 0;
  let e = Math.floor(Math.log2(v));
  if (e < -14) {
    // subnormal: v = m * 2^-24
    return Math.round(v / 5.960464477539063e-8);
  }
  let m = v / Math.pow(2, e) - 1;
  let mi = Math.round(m * 1024);
  if (mi === 1024) {
    mi = 0;
    e += 1;
    if (e > 15) return 0x7bff;
  }
  return ((e + 15) << 10) | mi;
}

/**
 * A room's panorama as half floats (r, g, b, 1), from its two pictures decoded to RGBA bytes (rows from the top, as
 * a picture is): a texel is (r, g, b) * 2^(e - 136), black where e is 0. The rows come out from the bottom, as a
 * texture's v runs, so the texture needs no flip. A table of the 256 exponents keeps it quick.
 */
export function rgbeToHalf(rgb: ArrayLike<number>, e: ArrayLike<number>, width: number, height: number): Uint16Array {
  const out = new Uint16Array(width * height * 4);
  const pow = new Float64Array(256);
  for (let k = 1; k < 256; k++) pow[k] = Math.pow(2, k - 136);
  const half = new Map<number, number>();
  const one = toHalf(1);
  for (let row = 0; row < height; row++) {
    const src = row * width * 4;
    const dst = (height - 1 - row) * width * 4;
    for (let i = 0; i < width; i++) {
      const s = src + i * 4;
      const f = pow[e[s] as number] as number;
      for (let c = 0; c < 3; c++) {
        const v = (rgb[s + c] as number) * f;
        let h = half.get(v);
        if (h === undefined) {
          h = toHalf(v);
          if (half.size < 1 << 16) half.set(v, h);
        }
        out[dst + i * 4 + c] = h;
      }
      out[dst + i * 4 + 3] = one;
    }
  }
  return out;
}
