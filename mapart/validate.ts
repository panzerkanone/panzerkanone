/**
 * Structural check of a display list (any list, not only one this generator
 * made): the shape of mapart/displayList.ts, every number finite, every plate
 * and shape named resolvable. The bake worker refuses a list that fails it.
 */
import { DisplayList } from './displayList';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function numbers(v: unknown, min: number, even: boolean): v is number[] {
  return Array.isArray(v) && v.length >= min && (!even || Number.isInteger(v.length / 2)) && v.every(fin);
}

const OP_KEYS: Record<string, string[]> = {
  fill: ['op', 'feature', 'plate', 'mode', 'tone', 'rings', 'feather'],
  ribbon: ['op', 'feature', 'plate', 'mode', 'tone', 'line', 'halfWidths', 'dash'],
  stamp: ['op', 'feature', 'plate', 'mode', 'tone', 'shape', 'placements'],
  pattern: ['op', 'feature', 'plate', 'mode', 'tone', 'clip', 'strokes', 'width'],
  glyphs: ['op', 'feature', 'text', 'plate', 'mode', 'tone', 'shapes', 'transforms'],
};
const OPTIONAL = new Set(['feather', 'dash']);

/** Problems with a parsed display list; empty when it is well formed. At most `limit` are listed. */
export function validateDisplayList(raw: unknown, limit = 40): string[] {
  const problems: string[] = [];
  const add = (p: string) => {
    if (problems.length < limit) problems.push(p);
  };
  if (!isRecord(raw)) return ['a display list must be a mapping'];
  for (const key of Object.keys(raw)) if (!['units', 'bounds', 'plates', 'shapes', 'ops', 'paper'].includes(key)) add(`unknown key '${key}'`);
  if (raw.units !== 'hex') add(`units must be 'hex', got ${JSON.stringify(raw.units)}`);
  const b = raw.bounds;
  if (!numbers(b, 4, true) || b.length !== 4 || (b[0] as number) >= (b[2] as number) || (b[1] as number) >= (b[3] as number)) add('bounds must be four finite numbers minX, minY, maxX, maxY');
  const plateIds = new Set<string>();
  if (!Array.isArray(raw.plates) || raw.plates.length === 0) add('plates must be a list of one or more plates');
  else {
    raw.plates.forEach((p: unknown, i: number) => {
      if (!isRecord(p)) return add(`plates[${i}] must be { id, ink, offset }`);
      for (const k of Object.keys(p)) if (!['id', 'ink', 'offset'].includes(k)) add(`plates[${i}]: unknown key '${k}'`);
      if (typeof p.id !== 'string' || p.id.length === 0) add(`plates[${i}].id must be a name`);
      else if (plateIds.has(p.id)) add(`plates[${i}]: the plate ${p.id} is listed twice`);
      else plateIds.add(p.id);
      if (typeof p.ink !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(p.ink)) add(`plates[${i}].ink must be #rrggbb`);
      if (!numbers(p.offset, 2, true) || p.offset.length !== 2) add(`plates[${i}].offset must be two finite numbers`);
    });
  }
  if ('paper' in raw) {
    const p = raw.paper;
    if (!isRecord(p)) add('paper must be { seed, amplitude, scale, carry }');
    else {
      for (const k of Object.keys(p)) if (!['seed', 'amplitude', 'scale', 'carry'].includes(k)) add(`paper: unknown key '${k}'`);
      if (!fin(p.seed) || !Number.isInteger(p.seed) || p.seed < 0 || p.seed > 4294967295) add('paper.seed must be a whole number from 0 to 4294967295');
      if (!fin(p.amplitude) || p.amplitude < 0 || p.amplitude > 0.1) add('paper.amplitude must be a number from 0 to 0.1');
      if (!fin(p.scale) || p.scale <= 0 || p.scale > 1) add('paper.scale must be a number above 0, at most 1');
      if (!fin(p.carry) || p.carry < 0 || p.carry > 0.95) add('paper.carry must be a number from 0 to 0.95');
    }
  }
  const shapeKeys = new Set<string>();
  if (!isRecord(raw.shapes)) add('shapes must be a mapping of names to rings');
  else {
    for (const [k, rings] of Object.entries(raw.shapes)) {
      shapeKeys.add(k);
      if (!Array.isArray(rings) || rings.some(r => !numbers(r, 6, true))) add(`shapes.${k} must be a list of rings, each six or more finite numbers, an even count`);
    }
  }
  if (!Array.isArray(raw.ops)) {
    add('ops must be a list');
    return problems;
  }
  raw.ops.forEach((op: unknown, i: number) => {
    const at = `ops[${i}]`;
    if (!isRecord(op)) return add(`${at} must be a mapping`);
    const kind = op.op;
    if (typeof kind !== 'string' || !(kind in OP_KEYS)) return add(`${at}.op must be fill, ribbon, stamp, pattern or glyphs`);
    const keys = OP_KEYS[kind] as string[];
    for (const k of Object.keys(op)) if (!keys.includes(k)) add(`${at} (${kind}): unknown key '${k}'`);
    for (const k of keys) if (!OPTIONAL.has(k) && !(k in op)) add(`${at} (${kind}): ${k} is missing`);
    if (typeof op.feature !== 'string' || op.feature.length === 0) add(`${at}.feature must be a name`);
    if (typeof op.plate !== 'string' || !plateIds.has(op.plate)) add(`${at}.plate names no listed plate: ${JSON.stringify(op.plate)}`);
    if (op.mode !== 'draw' && op.mode !== 'erase') add(`${at}.mode must be draw or erase`);
    if (!fin(op.tone) || op.tone < 0 || op.tone > 1) add(`${at}.tone must be a number from 0 to 1`);
    switch (kind) {
      case 'fill':
        if (!Array.isArray(op.rings) || op.rings.some(r => !numbers(r, 6, true))) add(`${at}.rings must be rings of six or more finite numbers, an even count`);
        if ('feather' in op && (!fin(op.feather) || op.feather < 0)) add(`${at}.feather must be a finite number from 0`);
        break;
      case 'ribbon': {
        if (!numbers(op.line, 4, true)) add(`${at}.line must be two or more points`);
        else if (!numbers(op.halfWidths, 1, false) || op.halfWidths.length !== op.line.length / 2 || op.halfWidths.some(v => v < 0)) add(`${at}.halfWidths must hold one finite half-width from 0 per point`);
        if ('dash' in op && (!numbers(op.dash, 2, false) || op.dash.some(v => v <= 0))) add(`${at}.dash must be positive lengths`);
        break;
      }
      case 'stamp':
        if (typeof op.shape !== 'string' || !shapeKeys.has(op.shape)) add(`${at}.shape names no listed shape: ${JSON.stringify(op.shape)}`);
        if (!Array.isArray(op.placements) || op.placements.length % 5 !== 0 || !op.placements.every(fin)) add(`${at}.placements must come in fives of finite numbers`);
        break;
      case 'pattern':
        if (!Array.isArray(op.clip) || op.clip.some(r => !numbers(r, 6, true))) add(`${at}.clip must be rings of six or more finite numbers`);
        if (!Array.isArray(op.strokes) || op.strokes.some(s => !numbers(s, 4, true))) add(`${at}.strokes must be polylines of two or more points`);
        if (!fin(op.width) || op.width <= 0) add(`${at}.width must be a positive number`);
        break;
      case 'glyphs':
        if (typeof op.text !== 'string') add(`${at}.text must be the text the glyphs spell`);
        if (!Array.isArray(op.shapes) || op.shapes.some(s => typeof s !== 'string' || !shapeKeys.has(s))) add(`${at}.shapes must name listed shapes`);
        else if (!Array.isArray(op.transforms) || op.transforms.length !== op.shapes.length * 6 || !op.transforms.every(fin)) add(`${at}.transforms must be six finite numbers per glyph`);
        break;
    }
  });
  return problems;
}

/** Narrow a value that passed validateDisplayList. */
export function asDisplayList(raw: unknown): DisplayList {
  return raw as DisplayList;
}
