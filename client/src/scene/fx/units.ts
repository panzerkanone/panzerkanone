/**
 * Which effects a counter's unit sets off: a table by the kind its face carries and, before that,
 * by the id of its picture (data/units.fx.json). Read strictly. Nothing in the effects' code
 * branches on a unit's name: it asks this table. Plain data, no browser.
 */

export type FireStyle = 'gun' | 'small' | 'lob' | 'none';
export type DustStyle = 'tracked' | 'wheeled' | 'none';
export type KillStyle = 'burn' | 'blast';

export interface UnitFx {
  fire: FireStyle;
  armour: boolean;
  dust: DustStyle;
  kill: KillStyle;
}

export interface UnitFxTable {
  kinds: Readonly<Record<string, UnitFx>>;
  art: Readonly<Record<string, UnitFx>>;
  other: UnitFx;
}

const FIRE: readonly string[] = ['gun', 'small', 'lob', 'none'];
const DUST: readonly string[] = ['tracked', 'wheeled', 'none'];
const KILL: readonly string[] = ['burn', 'blast'];

const fail = (why: string): never => {
  throw new Error(`effects' unit table: ${why}`);
};

function row(v: unknown, what: string): UnitFx {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(`${what} must be a mapping`);
  const r = v as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!['fire', 'armour', 'dust', 'kill'].includes(k)) fail(`${what} has an unknown key "${k}"`);
  if (typeof r.fire !== 'string' || !FIRE.includes(r.fire)) fail(`${what}.fire must be one of ${FIRE.join(', ')}`);
  if (typeof r.armour !== 'boolean') fail(`${what}.armour must be true or false`);
  if (typeof r.dust !== 'string' || !DUST.includes(r.dust)) fail(`${what}.dust must be one of ${DUST.join(', ')}`);
  if (typeof r.kill !== 'string' || !KILL.includes(r.kill)) fail(`${what}.kill must be one of ${KILL.join(', ')}`);
  return { fire: r.fire as FireStyle, armour: r.armour as boolean, dust: r.dust as DustStyle, kill: r.kill as KillStyle };
}

function rows(v: unknown, what: string): Record<string, UnitFx> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(`${what} must be a mapping`);
  const out: Record<string, UnitFx> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) out[k] = row(raw, `${what}.${k}`);
  return out;
}

export function parseUnitFx(text: string): UnitFxTable {
  const top = JSON.parse(text) as unknown;
  if (typeof top !== 'object' || top === null || Array.isArray(top)) fail('not a mapping');
  const t = top as Record<string, unknown>;
  for (const k of Object.keys(t)) if (!['format', 'note', 'kinds', 'art', 'other'].includes(k)) fail(`unknown key "${k}"`);
  if (t.format !== 'fx-units/1') fail('format must be fx-units/1');
  const kinds = rows(t.kinds, 'kinds');
  if (Object.keys(kinds).length === 0) fail('kinds must name at least one kind');
  return { kinds, art: rows(t.art, 'art'), other: row(t.other, 'other') };
}

/** What a counter with this face sets off: by its picture's id where the table has it, else by its kind, else the table's `other`. */
export function unitFx(table: UnitFxTable, face: { kind: string; art?: string | undefined }): UnitFx {
  return (face.art !== undefined ? table.art[face.art] : undefined) ?? table.kinds[face.kind] ?? table.other;
}
