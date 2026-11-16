/**
 * The table top's woods (the owner, 2026-11-14: "The table material is simply not very good. Getting more realistic
 * wood, more realistic pbr urethane clear coated table surface"): `wood=<name>` in the address chooses one (`wood=1` is
 * the first pass's teak); without it the table draws its own wood. Each is a scanned set (colour, OpenGL normal map,
 * roughness) from Poly Haven (CC0), cut by tools/tableart/wood.py (teak by the first pass), and this says how the
 * table lays it and finishes it. Plain data: no browser and no three.
 *
 * Laying. A scan of planks (`planks: 'scan'`) is laid as it is, its planks the table's boards, along the table's grain;
 * a scan with no joints in it (the teak veneer, `planks: 'strips'`) is cut into the table's own boards (world.ts,
 * LOOK.woodBoard), each a strip from its own place in the scan, with a joint between them.
 *
 * Finishing. `coat: true` lays a clear coat (urethane) over the scan: the scan's colour wetted by it (`wet`: a power on
 * the colour, then a gain), the coat's own roughness (`coatRough`, perceptual, 0 a mirror), and how far the coat
 * follows the scan's relief (`follow`: 0 levelled flat, 1 every pore). `coat: false` is a scan of a finished surface
 * (the lacquered cherry was scanned lacquered): its colour and relief are the finish's, and its roughness map is the
 * finish's roughness, by `roughGain` and `roughBias`. `wear` is the strength of the use the finish shows (scratches
 * along the boards, a dull rub where hands rest): subtle at 1.
 */

export interface Wood {
  readonly label: string;
  /** Poly Haven's name of the set. */
  readonly source: string;
  /** The side of the scan's square, in mm (each set's own dimensions). */
  readonly sideMm: number;
  readonly planks: 'scan' | 'strips';
  /** The gain tools/tableart/wood.py put on the normal map's x and y (the shader divides it out). */
  readonly normalGain: number;
  readonly coat: boolean;
  readonly wet: readonly [number, number];
  readonly coatRough: number;
  readonly follow: number;
  readonly roughGain: number;
  readonly roughBias: number;
  readonly wear: number;
}

export const WOODS = {
  /** The first pass's: Poly Haven "Teak Veneer" (Jenelle van Heerden) under a coat, in the table's own boards. */
  teak: { label: 'teak veneer under a clear coat, in boards', source: 'teak_veneer', sideMm: 1000, planks: 'strips', normalGain: 1, coat: true, wet: [1.45, 0.7], coatRough: 0.1, follow: 0.35, roughGain: 0, roughBias: 0, wear: 1 },
  /** Poly Haven "Lacquered Cherry Wood" (Jenelle van Heerden, Rico Cilliers): dark fine planks, scanned lacquered. */
  cherry: { label: 'lacquered cherry planks', source: 'lacquered_cherry_wood', sideMm: 1000, planks: 'scan', normalGain: 8, coat: false, wet: [1, 1.7], coatRough: 0, follow: 1, roughGain: 0.9, roughBias: -0.06, wear: 1 },
  /** Poly Haven "Wood Table" (Dimitrios Savva): rustic sawn planks, under a urethane coat that follows their saw marks. */
  table: { label: 'rustic sawn planks under a urethane coat', source: 'wood_table', sideMm: 1000, planks: 'scan', normalGain: 1, coat: true, wet: [1.25, 0.85], coatRough: 0.15, follow: 0.3, roughGain: 0, roughBias: 0, wear: 1 },
} as const satisfies Record<string, Wood>;

export type WoodName = keyof typeof WOODS;
export const WOOD_NAMES = Object.keys(WOODS) as WoodName[];

export function isWoodName(name: unknown): name is WoodName {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(WOODS, name);
}

/** The wood the address asks for: `wood=<name>`, or `wood=1` for the first pass's teak; null for the wood the table draws itself. */
export function woodFromAddress(text: string | null): WoodName | null {
  if (text === '1') return 'teak';
  return isWoodName(text) ? text : null;
}
