/**
 * What the battle leaves on the table, as plain data: the hulks and craters that lie on it, where and how, and
 * which of them show. No browser and no drawing here (view.ts draws them; index.ts joins them to the table).
 *
 * The table of marks (data/marks.table.json) says which pictures a kind of unit leaves and how a mark lies; the
 * pictures' list (assets/marks/v1/marks.json, written by tools/battlemarks/) says each picture's size.
 * Both are read strictly. Nothing here names a unit type: a destroyed unit's kind is looked up in the table.
 *
 * Every choice is seeded (../hash.ts: a hash of the game's seed, a tag and a stable id), so the same game with the
 * same seed lays the same marks in the same places: a hulk's stable id is its unit's id, a crater's the name the
 * game gives the mission (its battery, the turn and the hex). No rule reads a mark.
 */
import { hash01 } from '../hash';

export type MarkKind = 'hulk' | 'crater';
export const MARK_KINDS: readonly MarkKind[] = ['hulk', 'crater'];

/** One picture of the list: its id, its kind and its size in pixels. */
export interface MarkPicture {
  id: string;
  file: string;
  kind: MarkKind;
  width: number;
  height: number;
  shows: string;
}

/**
 * How a kind's drawings are printed into the board (view.ts): its opacity; its shadows opened (a curve that lifts
 * its fills and keeps its black line work black: 0 as drawn, 1 the most); its haze cleared (cover under this share
 * goes, the rest is scaled up: smoke and spray thin out, solid strokes stay); its colour kept (1 as drawn, 0 grey);
 * how far it is then inked (0 not, 1 wholly: its darks in the ink, its lights the paper), in the board's key ink or an
 * ink of its own (sRGB 0..255); its soft edge softened further (0 to 1); a faint light halo round it (0 to 1); and laid
 * on as ink (`multiply`) or over the board (`normal`).
 */
export interface MarkLook {
  opacity: number;
  lift: number;
  crisp: number;
  saturation: number;
  tint: { ink: 'key' | readonly [number, number, number]; amount: number };
  feather: number;
  halo: number;
  blend: 'multiply' | 'normal';
}

export interface MarksTable {
  size: Readonly<Record<MarkKind, number>>;
  place: { across: number; down: readonly [number, number]; jitter: number; turnDeg: number };
  perHex: number;
  /** How each kind is printed into the board. One blend for both (the hulks' is taken). */
  look: Record<MarkKind, MarkLook>;
  ease: { seconds: number; craterAfter: number; switchSeconds: number };
  /** A kind of unit to the pictures it may leave (empty: it leaves none). */
  hulks: ReadonlyMap<string, readonly string[]>;
  craters: readonly string[];
}

const failTable = (why: string): never => {
  throw new Error(`the table of marks (client/src/scene/marks/data/marks.table.json): ${why}`);
};
const failList = (why: string): never => {
  throw new Error(`the list of marks (assets/marks/v1/marks.json): ${why}`);
};
const mapping = (v: unknown, what: string, fail: (w: string) => never): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(`${what} must be a mapping`);
function keys(m: Record<string, unknown>, need: readonly string[], may: readonly string[], what: string, fail: (w: string) => never): void {
  for (const k of Object.keys(m)) if (!need.includes(k) && !may.includes(k)) fail(`${what} has an unknown key "${k}"`);
  for (const k of need) if (!(k in m)) fail(`${what} lacks "${k}"`);
}
function num(v: unknown, what: string, lo: number, hi: number, fail: (w: string) => never): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) fail(`${what} must be a number from ${lo} to ${hi}`);
  return v as number;
}
function words(v: unknown, what: string, fail: (w: string) => never): string[] {
  if (!Array.isArray(v) || v.some(x => typeof x !== 'string' || x === '')) fail(`${what} must be a list of names`);
  return v as string[];
}

/** A look read strictly (`what` names it in an error). */
export function parseLook(v: unknown, what: string): MarkLook {
  const l = mapping(v, what, failTable);
  keys(l, ['opacity', 'lift', 'crisp', 'saturation', 'tint', 'feather', 'halo', 'blend'], [], what, failTable);
  const tint = mapping(l.tint, `${what}.tint`, failTable);
  keys(tint, ['ink', 'amount'], [], `${what}.tint`, failTable);
  let ink: MarkLook['tint']['ink'];
  if (tint.ink === 'key') ink = 'key';
  else if (Array.isArray(tint.ink) && tint.ink.length === 3 && tint.ink.every(c => typeof c === 'number' && Number.isInteger(c) && c >= 0 && c <= 255)) ink = [tint.ink[0], tint.ink[1], tint.ink[2]] as [number, number, number];
  else ink = failTable(`${what}.tint.ink must be "key" or three whole numbers from 0 to 255`);
  if (l.blend !== 'multiply' && l.blend !== 'normal') failTable(`${what}.blend must be multiply or normal`);
  return {
    opacity: num(l.opacity, `${what}.opacity`, 0, 1, failTable),
    lift: num(l.lift, `${what}.lift`, 0, 1, failTable),
    crisp: num(l.crisp, `${what}.crisp`, 0, 0.9, failTable),
    saturation: num(l.saturation, `${what}.saturation`, 0, 1, failTable),
    tint: { ink, amount: num(tint.amount, `${what}.tint.amount`, 0, 1, failTable) },
    feather: num(l.feather, `${what}.feather`, 0, 1, failTable),
    halo: num(l.halo, `${what}.halo`, 0, 1, failTable),
    blend: l.blend as MarkLook['blend'],
  };
}

/** The pictures' list, read strictly. */
export function parseMarkList(text: string): MarkPicture[] {
  const top = mapping(JSON.parse(text) as unknown, 'the file', failList);
  keys(top, ['format', 'longest', 'marks'], [], 'the file', failList);
  if (top.format !== 'battle-marks-art/2') failList('format must be battle-marks-art/2');
  if (!Array.isArray(top.marks) || top.marks.length === 0) failList('marks must be a list with a mark in it');
  const seen = new Set<string>();
  return (top.marks as unknown[]).map((raw, i) => {
    const what = `marks[${i}]`;
    const m = mapping(raw, what, failList);
    keys(m, ['id', 'file', 'kind', 'width', 'height', 'shows'], [], what, failList);
    if (typeof m.id !== 'string' || m.id === '' || seen.has(m.id)) failList(`${what}.id must be a name used once`);
    seen.add(m.id as string);
    if (typeof m.file !== 'string' || m.file !== `${String(m.id)}.webp`) failList(`${what}.file must be its id with .webp`);
    if (m.kind !== 'hulk' && m.kind !== 'crater') failList(`${what}.kind must be hulk or crater`);
    const width = num(m.width, `${what}.width`, 8, 4096, failList);
    const height = num(m.height, `${what}.height`, 8, 4096, failList);
    if (typeof m.shows !== 'string' || m.shows === '') failList(`${what}.shows must be words`);
    return { id: m.id as string, file: m.file as string, kind: m.kind as MarkKind, width, height, shows: m.shows as string };
  });
}

/** The table of marks, read strictly and checked against the pictures' list (every picture it names is there, and of its kind). */
export function parseMarksTable(text: string, pictures: readonly MarkPicture[]): MarksTable {
  const t = mapping(JSON.parse(text) as unknown, 'the file', failTable);
  keys(t, ['format', 'size', 'place', 'perHex', 'look', 'ease', 'hulks', 'none', 'craters'], ['note'], 'the file', failTable);
  if (t.format !== 'table-marks/1') failTable('format must be table-marks/1');
  const kindOf = new Map(pictures.map(p => [p.id, p.kind]));
  const size = mapping(t.size, 'size', failTable);
  keys(size, ['hulk', 'crater'], [], 'size', failTable);
  const place = mapping(t.place, 'place', failTable);
  keys(place, ['across', 'down', 'jitter', 'turnDeg'], [], 'place', failTable);
  if (!Array.isArray(place.down) || place.down.length !== 2) failTable('place.down must be two numbers');
  const down = (place.down as unknown[]).map((v, k) => num(v, `place.down[${k}]`, -0.5, 0.5, failTable)) as [number, number];
  if (down[0] > down[1]) failTable('place.down must run from the lesser to the greater');
  const look = mapping(t.look, 'look', failTable);
  keys(look, ['hulk', 'crater'], [], 'look', failTable);
  const ease = mapping(t.ease, 'ease', failTable);
  keys(ease, ['seconds', 'craterAfter', 'switchSeconds'], [], 'ease', failTable);
  const perHex = num(t.perHex, 'perHex', 1, 6, failTable);
  if (!Number.isInteger(perHex)) failTable('perHex must be a whole number');

  const hulks = new Map<string, readonly string[]>();
  const name = (k: string, what: string): void => {
    if (hulks.has(k)) failTable(`${what}: the kind "${k}" is named twice`);
  };
  if (!Array.isArray(t.hulks) || t.hulks.length === 0) failTable('hulks must be a list with a row in it');
  (t.hulks as unknown[]).forEach((raw, i) => {
    const what = `hulks[${i}]`;
    const row = mapping(raw, what, failTable);
    keys(row, ['kinds', 'pictures', 'why'], [], what, failTable);
    const kinds = words(row.kinds, `${what}.kinds`, failTable);
    const pics = words(row.pictures, `${what}.pictures`, failTable);
    if (kinds.length === 0 || pics.length === 0) failTable(`${what} must name a kind and a picture`);
    for (const p of pics) if (kindOf.get(p) !== 'hulk') failTable(`${what}: "${p}" is not a hulk of the pictures' list`);
    if (typeof row.why !== 'string' || row.why === '') failTable(`${what}.why must say why`);
    for (const k of kinds) {
      name(k, what);
      hulks.set(k, pics);
    }
  });
  const none = mapping(t.none, 'none', failTable);
  keys(none, ['kinds', 'why'], [], 'none', failTable);
  for (const k of words(none.kinds, 'none.kinds', failTable)) {
    name(k, 'none');
    hulks.set(k, []);
  }
  const craters = words(t.craters, 'craters', failTable);
  if (craters.length === 0) failTable('craters must name a picture');
  for (const c of craters) if (kindOf.get(c) !== 'crater') failTable(`craters: "${c}" is not a crater of the pictures' list`);
  return {
    size: { hulk: num(size.hulk, 'size.hulk', 0.1, 0.7, failTable), crater: num(size.crater, 'size.crater', 0.1, 0.7, failTable) },
    place: { across: num(place.across, 'place.across', 0, 0.3, failTable), down, jitter: num(place.jitter, 'place.jitter', 0, 0.1, failTable), turnDeg: num(place.turnDeg, 'place.turnDeg', 0, 180, failTable) },
    perHex,
    look: { hulk: parseLook(look.hulk, 'look.hulk'), crater: parseLook(look.crater, 'look.crater') },
    ease: { seconds: num(ease.seconds, 'ease.seconds', 0.05, 3, failTable), craterAfter: num(ease.craterAfter, 'ease.craterAfter', 0, 3, failTable), switchSeconds: num(ease.switchSeconds, 'ease.switchSeconds', 0.01, 3, failTable) },
    hulks,
    craters,
  };
}

/** A stable id, as a number for the hash: the text's own FNV-1a hash. */
export function idNumber(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A mark lying on the table. */
export interface Mark {
  /** `hulk:<unit>` or `crater:<the mission's name>`: the same wherever the game is watched. */
  key: string;
  kind: MarkKind;
  picture: string;
  hex: number;
  /** Which of its hex's places it lies in (0 or 1, …). */
  slot: number;
  /** Its middle on the plan (the board frame, in h), its turn about the vertical (radians), its longer side (h). */
  x: number;
  y: number;
  turn: number;
  size: number;
  /** When it was laid (seconds of the table's clock): it eases in from then. */
  born: number;
  /** Laid before every mark with a greater number. */
  order: number;
}

export interface MarkOptions {
  hulks: boolean;
  craters: boolean;
}

/**
 * The marks of one game on the table. `lay` puts one down (or says why not, by returning null); `begin` starts a
 * new game with its seed (every mark goes). Which kinds show is `options`: a kind switched off keeps its marks
 * (they are only not drawn), so that switching it on again brings them back as they lay.
 */
export class MarksModel {
  readonly table: MarksTable;
  private readonly pictures: ReadonlyMap<string, MarkPicture>;
  private readonly centreOf: (hex: number) => readonly [number, number];
  private seed = 0;
  private laid: Mark[] = [];
  private count = 0;
  /** Goes up by one with every change of what lies on the table (not with a change of the options). */
  version = 0;
  options: MarkOptions = { hulks: true, craters: true };

  constructor(table: MarksTable, pictures: readonly MarkPicture[], centreOf: (hex: number) => readonly [number, number]) {
    this.table = table;
    this.pictures = new Map(pictures.map(p => [p.id, p]));
    this.centreOf = centreOf;
  }

  /** A new game on the table, with its seed: nothing of the last one's marks stays. */
  begin(seed: number): void {
    this.seed = seed >>> 0;
    this.laid = [];
    this.count = 0;
    this.version++;
  }

  /** Every mark that lies on the table, in the order laid (whether its kind shows or not). */
  get marks(): readonly Mark[] {
    return this.laid;
  }

  /** The marks that show, by the options. */
  shown(): Mark[] {
    return this.laid.filter(m => this.options[m.kind === 'hulk' ? 'hulks' : 'craters']);
  }

  /** The pictures a unit of this kind may leave: an empty list for none; null for a kind the table does not name. */
  hulksOf(unitKind: string): readonly string[] | null {
    return this.table.hulks.get(unitKind) ?? null;
  }

  /**
   * A hulk where a unit of `unitKind` was destroyed (its id `unit`), or a crater where a mission landed (`name`):
   * laid at `now` on `hex`. Returns the mark, or null when nothing is laid (a kind that leaves none; a unit or a
   * mission that has left its mark already). `picture`, for a check or a picture of the marks: this one, not the
   * seeded choice (it must be one of the list's, of this kind).
   */
  lay(what: ({ kind: 'hulk'; unit: string; unitKind: string } | { kind: 'crater'; name: string }) & { picture?: string }, hex: number, now: number): Mark | null {
    const key = what.kind === 'hulk' ? `hulk:${what.unit}` : `crater:${what.name}`;
    if (this.laid.some(m => m.key === key)) return null;
    const id = idNumber(key);
    let choices: readonly string[];
    if (what.picture !== undefined) choices = [what.picture];
    else if (what.kind === 'hulk') {
      const named = this.hulksOf(what.unitKind);
      if (named === null) {
        console.warn(`[marks] the table of marks names no kind "${what.unitKind}": no hulk is laid`);
        return null;
      }
      choices = named;
    } else choices = this.table.craters;
    if (choices.length === 0) return null;
    const picture = what.picture ?? (choices[Math.min(choices.length - 1, Math.floor(hash01(this.seed, `marks.picture.${what.kind}`, id) * choices.length))] as string);
    if (this.pictures.get(picture)?.kind !== what.kind) return null;

    // Its place in the hex: the first mark's side is seeded, the next takes the other; a full hex gives up the
    // place of its older mark of this kind (else of its oldest).
    const here = this.laid.filter(m => m.hex === hex);
    let slot: number;
    if (here.length >= this.table.perHex) {
      const gone = here.find(m => m.kind === what.kind) ?? (here[0] as Mark);
      this.laid = this.laid.filter(m => m !== gone);
      slot = gone.slot;
    } else {
      const taken = new Set(here.map(m => m.slot));
      const first = Math.floor(hash01(this.seed, 'marks.side', idNumber(`hex:${hex}`)) * 2);
      slot = 0;
      for (let k = 0; k < this.table.perHex; k++) {
        const s = (first + k) % Math.max(2, this.table.perHex);
        if (!taken.has(s)) {
          slot = s;
          break;
        }
      }
    }
    const p = this.table.place;
    const side = slot % 2 === 0 ? -1 : 1;
    const r = (tag: string): number => hash01(this.seed, `marks.${tag}`, id);
    const c = this.centreOf(hex);
    const x = c[0] + side * p.across + (2 * r('x') - 1) * p.jitter;
    const y = c[1] + p.down[0] + r('y') * (p.down[1] - p.down[0]) + (2 * r('y2') - 1) * p.jitter * 0.5;
    const turn = ((2 * r('turn') - 1) * p.turnDeg * Math.PI) / 180;
    const mark: Mark = { key, kind: what.kind, picture, hex, slot, x, y, turn, size: this.table.size[what.kind], born: now, order: this.count++ };
    this.laid.push(mark);
    this.version++;
    return mark;
  }
}
