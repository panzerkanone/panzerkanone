/**
 * The index of the medallion's art (assets/shell/medallion/medallion.json, written by
 * tools/medallion/main.ts), read strictly: a key missing or a wrong kind of value is an error.
 * Plain arithmetic, no browser. Lengths are in the pixels of the owner's sheets unless it says otherwise.
 */

export interface MedallionIndex {
  sheet: [number, number];
  /** The at-rest cut: its part of the sheets, and its size on the stage. */
  cut: { rect: [number, number, number, number]; width: number; height: number };
  /** The model: sheet pixels to a unit of its height, and its lowest and highest heights. */
  model: { depth: number; low: number; high: number };
  /** The field of distances from the outline: its part of the sheets (it reaches past them), and its ranges outside and inside. */
  field: { width: number; height: number; box: [number, number, number, number]; reach: number; inside: number };
  fire: {
    /** The fire's colour at heat 0 to 1 in even steps: light (red, green, blue) and cover. */
    ramp: number[][];
    /** The middle the outline's sectors turn about; per sector, the heat against the metal and the reach. */
    middle: [number, number];
    core: number[];
    reach: number[];
    /** Per sector, the farthest off the outline that the fire is still a tenth as hot as it gets (a thin flame stands there). */
    tall: number[];
    /** Per sector, the heat of his hottest clumps against the metal. */
    hot: number[];
    /** The heat at 0, 1/8, ... 4 reaches off the outline, as a share of the heat against the metal. */
    shape: number[];
    ragged: { spread: number; run: number };
    /** The outline as points round the middle: x, y and the way out there. */
    outline: number[][];
  };
  sparks: {
    cell: [number, number];
    scale: number;
    columns: number;
    rows: number;
    shapes: { kind: 'ember' | 'ash'; long: number; wide: number; peak: number }[];
    /** His own embers and flecks: x, y, length, width, turn, peak, cover, distance off the outline, sector, how it lies to the way out. */
    embers: number[][];
    ash: number[][];
  };
}

const fail = (why: string): never => {
  throw new Error(`medallion.json: ${why}`);
};
const map = (v: unknown, what: string): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(`${what} must be a mapping`));
const num = (v: unknown, what: string): number => (typeof v === 'number' && Number.isFinite(v) ? v : fail(`${what} must be a number`));
const nums = (v: unknown, what: string, n?: number): number[] => (Array.isArray(v) && (n === undefined || v.length === n) && v.length > 0 ? v.map((x, i) => num(x, `${what}[${i}]`)) : fail(`${what} must be ${n ?? 'some'} numbers`));
const rows = (v: unknown, what: string, n: number, mayBeEmpty = false): number[][] => (Array.isArray(v) && (mayBeEmpty || v.length > 0) ? v.map((x, i) => nums(x, `${what}[${i}]`, n)) : fail(`${what} must be rows of ${n} numbers`));

export function readMedallionIndex(source: unknown): MedallionIndex {
  const top = map(source, 'the file');
  if (top.format !== 'medallion/1') fail('format must be medallion/1');
  const cut = map(top.cut, 'cut');
  const model = map(top.model, 'model');
  const field = map(top.field, 'field');
  const fire = map(top.fire, 'fire');
  const ragged = map(fire.ragged, 'fire.ragged');
  const sparks = map(top.sparks, 'sparks');
  const core = nums(fire.core, 'fire.core');
  const reach = nums(fire.reach, 'fire.reach', core.length);
  if (!Array.isArray(sparks.shapes) || sparks.shapes.length === 0) fail('sparks.shapes must be a list');
  const shapes = (sparks.shapes as unknown[]).map((raw, i) => {
    const s = map(raw, `sparks.shapes[${i}]`);
    if (s.kind !== 'ember' && s.kind !== 'ash') fail(`sparks.shapes[${i}].kind must be ember or ash`);
    return { kind: s.kind as 'ember' | 'ash', long: num(s.long, 'long'), wide: num(s.wide, 'wide'), peak: num(s.peak, 'peak') };
  });
  const columns = num(sparks.columns, 'sparks.columns');
  const rowCount = num(sparks.rows, 'sparks.rows');
  if (columns * rowCount < shapes.length) fail('sparks: more shapes than cells');
  return {
    sheet: nums(top.sheet, 'sheet', 2) as [number, number],
    cut: { rect: nums(cut.rect, 'cut.rect', 4) as [number, number, number, number], width: num(cut.width, 'cut.width'), height: num(cut.height, 'cut.height') },
    model: { depth: num(model.depth, 'model.depth'), low: num(model.low, 'model.low'), high: num(model.high, 'model.high') },
    field: { width: num(field.width, 'field.width'), height: num(field.height, 'field.height'), box: nums(field.box, 'field.box', 4) as [number, number, number, number], reach: num(field.reach, 'field.reach'), inside: num(field.inside, 'field.inside') },
    fire: {
      ramp: rows(fire.ramp, 'fire.ramp', 4),
      middle: nums(fire.middle, 'fire.middle', 2) as [number, number],
      core,
      reach,
      tall: nums(fire.tall, 'fire.tall', core.length),
      hot: nums(fire.hot, 'fire.hot', core.length),
      shape: nums(fire.shape, 'fire.shape'),
      ragged: { spread: num(ragged.spread, 'fire.ragged.spread'), run: num(ragged.run, 'fire.ragged.run') },
      outline: rows(fire.outline, 'fire.outline', 4),
    },
    sparks: { cell: nums(sparks.cell, 'sparks.cell', 2) as [number, number], scale: num(sparks.scale, 'sparks.scale'), columns, rows: rowCount, shapes, embers: rows(sparks.embers, 'sparks.embers', 10), ash: rows(sparks.ash, 'sparks.ash', 10, true) },
  };
}
