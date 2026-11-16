/**
 * The table's light, as named alternatives (the owner, 2026-11-14: "different experiments with direct
 * light or point light and showing specular on the playfield and counters ... just alternatives,
 * checking"). `light=<name>` in the address chooses one; without it the table has today's.
 *
 * A light is a set of the look's own dials (world.ts, LOOK: where the key stands and its share, the
 * window, the lamp and its reflections, the grade) and four of its own, which the shaders read as
 * `uRig`: how strongly the lamp's pool falls off from under it across everything on the table (0: not
 * at all, as today; 1: as a bare lamp at that height would light it, cos^3 of the angle from straight
 * under it), how strongly the table's own pool falls off at its far edges, how much of the lamp's
 * reflection the counters' printed faces show (0 today: they show the key and the window only), and
 * how much more gloss the counters' faces have than today.
 *
 * Plain data and arithmetic: no browser and no three, so the names can be checked anywhere.
 */

/** The dials of LOOK (world.ts) that a light may set. */
export interface LookDials {
  keyElevationDeg: number;
  keyHeading: [number, number];
  keyShare: number;
  penumbra: number;
  grade: [number, number, number];
  vignette: number;
  lampOffset: [number, number];
  lampHeight: number;
  lampSheen: number;
  lampLobe: number;
  lampTable: number;
  lampTableLobe: number;
  lampGraze: number;
  sheen: [number, number, number, number];
  sheenB: [number, number, number, number];
  windowDir: [number, number, number];
  tableSheen: [number, number, number, number];
  /** The four dials of `uRig` (see above): the lamp's pool, the table's pool, the lamp on the counters, the counters' extra gloss. */
  rig: [number, number, number, number];
}

export interface Light {
  /** What the light is, in a few words, for the review page and the note the table shows. */
  readonly label: string;
  /** The look's dials it sets; any it leaves out stay as today's. */
  readonly look: Partial<Omit<LookDials, 'rig'>>;
  /** Its `uRig`. */
  readonly rig: readonly [number, number, number, number];
}

/** Today's `uRig`: no pool from the lamp, the table's pool as it was (0.52 of the light gone at its far edge), no lamp on the counters. */
export const TODAY_RIG: readonly [number, number, number, number] = [0, 0.52, 0, 0];

export const LIGHTS = {
  /** The table as it was lit before the alternatives: a soft key from the upper left, the room, a lamp seen only in the sheet's sheen. */
  today: { label: "today's light", look: {}, rig: TODAY_RIG },
  /**
   * A warm lamp hanging over the table, a little toward the far left: the key comes from it, high and
   * close, so shadows are short; its pool lights the middle of the boards and falls off toward their
   * edges and across the table; its reflection is a broad soft patch on the sheet and on the counters.
   */
  lamp: {
    label: 'a warm lamp over the table',
    look: {
      keyElevationDeg: 66,
      keyHeading: [-0.5, -0.62],
      keyShare: 0.82,
      penumbra: 0.24,
      grade: [1.0, 0.92, 0.78],
      vignette: 0.34,
      lampOffset: [-3, -4],
      lampHeight: 30,
      lampSheen: 0.3,
      lampLobe: 30,
      lampTable: 0.1,
      lampTableLobe: 18,
      lampGraze: 3.0,
      sheen: [2.0, 0.25, 0.016, 3.0],
    },
    rig: [0.9, 0.3, 1.0, 0.3],
  },
  /**
   * Daylight from a window at the far left, low: long soft shadows run toward the near right, the
   * counters' cut edges on the window's side catch it, and from a low camera the sheet shines with the
   * window where it faces it. No lamp.
   */
  window: {
    label: 'a low window light from the far left',
    look: {
      keyElevationDeg: 26,
      keyHeading: [-0.45, -0.89],
      keyShare: 0.7,
      penumbra: 0.42,
      grade: [0.97, 0.985, 1.0],
      lampSheen: 0,
      lampTable: 0,
      sheen: [2.0, 3.0, 0.016, 3.0],
      sheenB: [30, 6.0, 0.6, 1.0],
      windowDir: [-0.405, -0.8, 0.438],
      tableSheen: [1.4, 2.0, 0.035, 26],
    },
    rig: [0, 0.3, 0, 0.3],
  },
  /**
   * A softer room: the key high and gentle, more of the light from the room all round, and broad, bright
   * reflections of the room (the window, the ceiling's light) in the sheet, the counters and the varnish.
   */
  room: {
    label: 'a soft room with broad reflections',
    look: {
      keyElevationDeg: 58,
      keyShare: 0.5,
      penumbra: 0.6,
      grade: [1.0, 0.985, 0.95],
      lampHeight: 60,
      lampSheen: 0.08,
      lampLobe: 10,
      lampTable: 0.04,
      lampTableLobe: 10,
      lampGraze: 3.0,
      sheen: [2.0, 1.4, 0.02, 2.6],
      sheenB: [20, 4.0, 0.75, 1.0],
      tableSheen: [0.9, 1.8, 0.04, 18],
    },
    rig: [0.1, 0.3, 0.8, 0.3],
  },
  /**
   * The lamp and the window together, an evening: the warm lamp's pool and its reflection from above,
   * and the last of the daylight from a window at the far side, which the sheet and the counters
   * mirror from the low cameras, where the lamp's reflection cannot be seen.
   */
  evening: {
    label: 'the lamp, with a window at the far side',
    look: {
      keyElevationDeg: 66,
      keyHeading: [-0.5, -0.62],
      keyShare: 0.8,
      penumbra: 0.26,
      grade: [1.0, 0.94, 0.83],
      vignette: 0.32,
      lampOffset: [-3, -4],
      lampHeight: 32,
      lampSheen: 0.24,
      lampLobe: 34,
      lampTable: 0.09,
      lampTableLobe: 18,
      lampGraze: 3.0,
      sheen: [2.0, 2.2, 0.016, 3.0],
      sheenB: [30, 6.0, 0.6, 1.0],
      windowDir: [-0.12, -0.9, 0.42],
    },
    rig: [0.7, 0.3, 1.0, 0.3],
  },
} as const satisfies Record<string, Light>;

export type LightName = keyof typeof LIGHTS;
export const LIGHT_NAMES = Object.keys(LIGHTS) as LightName[];
/** The light the table has when the address names none. */
export const DEFAULT_LIGHT: LightName = 'today';

export function isLightName(name: unknown): name is LightName {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(LIGHTS, name);
}

/**
 * Set a light's dials on the look (world.ts, LOOK), before anything is built from it, its `uRig` with
 * them. Arrays are copied, so the lights' own data is never shared with the look.
 */
export function applyLight(name: LightName, look: LookDials): void {
  const light: Light = LIGHTS[name];
  const into = look as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(light.look)) into[k] = Array.isArray(v) ? [...(v as number[])] : v;
  look.rig = [...light.rig] as [number, number, number, number];
}
