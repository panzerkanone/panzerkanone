/**
 * The sound effects' cues: plain data and plain sums, with no browser in it
 * (the Node tests read it, and so does the tool that writes the data).
 *
 * The data is assets/sounds/v1/sounds.json, which `npm run sounds` writes from
 * tools/sounds/cues.yaml: the cues with their takes as built and measured, how
 * often and how many at once each may sound, how far each is varied, and the
 * joins: which cue each of the table's effects, each thing a counter does and
 * each thing the panel does plays, or `none` where silence is meant.
 *
 * Nothing here is drawn at random: a take is chosen in turn, and its small
 * variation of pitch and level is a hash of the cue's name and how many times
 * it has been played.
 */

/** One recording of a cue, as built. */
export interface SoundTake {
  /** File names beside the data: the Ogg Opus file, and the AAC copy. */
  readonly opus: string;
  readonly m4a: string;
  readonly seconds: number;
  /** Loudness as measured from the built file (the family says which measure), LUFS. */
  readonly lufs: number;
  /** True peak as measured from the built file, dBFS. */
  readonly peakDb: number;
  /** The family's peak ceiling held it under the family's loudness. */
  readonly held: boolean;
}

export interface SoundCue {
  readonly id: string;
  readonly family: string;
  /** Where it plays in the game, in words. */
  readonly plays: string;
  /** Fetched soon after the first touch (a small sound of the table or the panel); otherwise on first need. */
  readonly early: boolean;
  /** Least time between two starts of this cue, in milliseconds. */
  readonly leastMs: number;
  /** Most voices of this cue at once. */
  readonly voices: number;
  /** The variation from one playing to the next: pitch within this many cents either way, level within this many dB either way. */
  readonly cents: number;
  readonly db: number;
  /** A fixed shift of pitch, in cents, before the variation. */
  readonly detune: number;
  readonly takes: readonly SoundTake[];
}

export interface SoundFamily {
  readonly id: string;
  readonly about: string;
  /** Which loudness the family's cues were brought to: the momentary (400 ms) or the short-term (3 s) maximum. */
  readonly measure: 'momentary' | 'short-term';
  readonly targetLufs: number;
  /** No take of the family peaks above this, dBFS. */
  readonly ceilingDb: number;
}

/** What is handled on the table that is heard: what a counter does, and the dice being rolled. */
export const COUNTER_EVENTS = ['lift', 'slide', 'place', 'lost', 'refused', 'badge', 'dice'] as const;
export type CounterEvent = (typeof COUNTER_EVENTS)[number];
/** What the panel does that is heard: `sheet` is a full panel (the briefing, the rule book, the result). */
export const PANEL_EVENTS = ['button', 'page', 'folder-open', 'folder-shut', 'sheet-open', 'sheet-shut'] as const;
export type PanelEvent = (typeof PANEL_EVENTS)[number];

/** A join's value: a cue's id, or null where silence is meant (`none` in the file). */
export type Joined = string | null;

export interface SoundJoins {
  /** By the table's effect kind (client/src/scene/fx/effects.ts). */
  readonly effects: Readonly<Record<string, Joined>>;
  readonly counters: Readonly<Record<CounterEvent, Joined>>;
  readonly panel: Readonly<Record<PanelEvent, Joined>>;
  /** Cues that are built and that nothing plays yet, each with what it waits for. */
  readonly waiting: readonly { readonly cue: string; readonly for: string }[];
}

export interface SoundData {
  /** Most voices at once, all cues together. */
  readonly voices: number;
  readonly families: readonly SoundFamily[];
  readonly cues: readonly SoundCue[];
  readonly joins: SoundJoins;
}

const fail = (why: string): never => {
  throw new Error(`sounds.json: ${why}`);
};
const mapping = (v: unknown, what: string): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(`${what} must be a mapping`));
const list = (v: unknown, what: string): unknown[] => (Array.isArray(v) ? (v as unknown[]) : fail(`${what} must be a list`));
const numberOf = (v: unknown, what: string): number => (typeof v === 'number' && Number.isFinite(v) ? v : fail(`${what} must be a number`));
const textOf = (v: unknown, what: string): string => (typeof v === 'string' && v !== '' ? v : fail(`${what} must be a non-empty string`));
const flagOf = (v: unknown, what: string): boolean => (typeof v === 'boolean' ? v : fail(`${what} must be true or false`));
function exactly(m: Record<string, unknown>, keys: readonly string[], what: string): void {
  for (const k of Object.keys(m)) if (!keys.includes(k)) fail(`${what} has an unknown key "${k}"`);
  for (const k of keys) if (!(k in m)) fail(`${what} lacks "${k}"`);
}
/** A name that goes into a file's name and an address: lower-case words joined by hyphens. */
export const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The data, read strictly: a missing or unknown key, a value of the wrong kind, or a join to a cue that is not there, is an error. */
export function readSounds(source: unknown): SoundData {
  const top = mapping(source, 'the file');
  exactly(top, ['format', 'voices', 'families', 'cues', 'joins'], 'the file');
  if (top.format !== 'sounds/1') fail('format must be sounds/1');
  const voices = numberOf(top.voices, 'voices');
  if (!Number.isInteger(voices) || voices < 1) fail('voices must be a whole number, 1 or more');

  const familyIds = new Set<string>();
  const families = list(top.families, 'families').map((raw, i): SoundFamily => {
    const what = `families[${i}]`;
    const f = mapping(raw, what);
    exactly(f, ['id', 'about', 'measure', 'targetLufs', 'ceilingDb'], what);
    const id = textOf(f.id, `${what}.id`);
    if (familyIds.has(id)) fail(`${what}.id "${id}" is used twice`);
    familyIds.add(id);
    if (f.measure !== 'momentary' && f.measure !== 'short-term') fail(`${what}.measure must be momentary or short-term`);
    const ceilingDb = numberOf(f.ceilingDb, `${what}.ceilingDb`);
    if (ceilingDb > 0) fail(`${what}.ceilingDb must not be above 0`);
    return { id, about: textOf(f.about, `${what}.about`), measure: f.measure as SoundFamily['measure'], targetLufs: numberOf(f.targetLufs, `${what}.targetLufs`), ceilingDb };
  });
  if (families.length === 0) fail('families must name at least one family');

  const cueIds = new Set<string>();
  const files = new Set<string>();
  const cues = list(top.cues, 'cues').map((raw, i): SoundCue => {
    const what = `cues[${i}]`;
    const c = mapping(raw, what);
    exactly(c, ['id', 'family', 'plays', 'early', 'leastMs', 'voices', 'cents', 'db', 'detune', 'takes'], what);
    const id = textOf(c.id, `${what}.id`);
    if (!NAME.test(id)) fail(`${what}.id must be lower-case words joined by hyphens (it names files)`);
    if (id === 'none') fail(`${what}.id must not be "none" (that word means silence in a join)`);
    if (cueIds.has(id)) fail(`${what}.id "${id}" is used twice`);
    cueIds.add(id);
    const family = textOf(c.family, `${what}.family`);
    if (!familyIds.has(family)) fail(`${what}.family "${family}" is not a family`);
    const leastMs = numberOf(c.leastMs, `${what}.leastMs`);
    if (leastMs < 0) fail(`${what}.leastMs must not be negative`);
    const most = numberOf(c.voices, `${what}.voices`);
    if (!Number.isInteger(most) || most < 1) fail(`${what}.voices must be a whole number, 1 or more`);
    const cents = numberOf(c.cents, `${what}.cents`);
    const db = numberOf(c.db, `${what}.db`);
    if (cents < 0 || db < 0) fail(`${what}: cents and db are how far it varies either way, and must not be negative`);
    const takes = list(c.takes, `${what}.takes`).map((rawTake, k): SoundTake => {
      const at = `${what}.takes[${k}]`;
      const t = mapping(rawTake, at);
      exactly(t, ['opus', 'm4a', 'seconds', 'lufs', 'peakDb', 'held'], at);
      const opus = textOf(t.opus, `${at}.opus`);
      const m4a = textOf(t.m4a, `${at}.m4a`);
      if (!opus.endsWith('.opus') || !NAME.test(opus.slice(0, -5))) fail(`${at}.opus must be a plain name ending .opus`);
      if (!m4a.endsWith('.m4a') || !NAME.test(m4a.slice(0, -4))) fail(`${at}.m4a must be a plain name ending .m4a`);
      for (const f of [opus, m4a]) {
        if (files.has(f)) fail(`${at}: the file "${f}" is named twice`);
        files.add(f);
      }
      const seconds = numberOf(t.seconds, `${at}.seconds`);
      if (seconds <= 0) fail(`${at}.seconds must be more than 0`);
      return { opus, m4a, seconds, lufs: numberOf(t.lufs, `${at}.lufs`), peakDb: numberOf(t.peakDb, `${at}.peakDb`), held: flagOf(t.held, `${at}.held`) };
    });
    if (takes.length === 0) fail(`${what}.takes must hold at least one take`);
    return { id, family, plays: textOf(c.plays, `${what}.plays`), early: flagOf(c.early, `${what}.early`), leastMs, voices: most, cents, db, detune: numberOf(c.detune, `${what}.detune`), takes };
  });
  if (cues.length === 0) fail('cues must hold at least one cue');

  const joined = (v: unknown, what: string): Joined => {
    const name = textOf(v, what);
    if (name === 'none') return null;
    if (!cueIds.has(name)) fail(`${what} names "${name}", which is not a cue (say none for silence)`);
    return name;
  };
  const j = mapping(top.joins, 'joins');
  exactly(j, ['effects', 'counters', 'panel', 'waiting'], 'joins');
  const effectsRaw = mapping(j.effects, 'joins.effects');
  if (Object.keys(effectsRaw).length === 0) fail('joins.effects must name the effect kinds');
  const effects: Record<string, Joined> = {};
  for (const [kind, v] of Object.entries(effectsRaw)) effects[kind] = joined(v, `joins.effects.${kind}`);
  const countersRaw = mapping(j.counters, 'joins.counters');
  exactly(countersRaw, COUNTER_EVENTS, 'joins.counters');
  const counters = Object.fromEntries(COUNTER_EVENTS.map(k => [k, joined(countersRaw[k], `joins.counters.${k}`)])) as Record<CounterEvent, Joined>;
  const panelRaw = mapping(j.panel, 'joins.panel');
  exactly(panelRaw, PANEL_EVENTS, 'joins.panel');
  const panel = Object.fromEntries(PANEL_EVENTS.map(k => [k, joined(panelRaw[k], `joins.panel.${k}`)])) as Record<PanelEvent, Joined>;
  const waiting = list(j.waiting, 'joins.waiting').map((raw, i) => {
    const what = `joins.waiting[${i}]`;
    const w = mapping(raw, what);
    exactly(w, ['cue', 'for'], what);
    const cue = textOf(w.cue, `${what}.cue`);
    if (!cueIds.has(cue)) fail(`${what}.cue "${cue}" is not a cue`);
    return { cue, for: textOf(w.for, `${what}.for`) };
  });

  // Every cue is played by something, or waits for something that is named.
  const used = new Set<string>([...Object.values(effects), ...Object.values(counters), ...Object.values(panel), ...waiting.map(w => w.cue)].filter((v): v is string => v !== null));
  for (const c of cues) if (!used.has(c.id)) fail(`the cue "${c.id}" is played by no join and is not listed as waiting`);

  return { voices, families, cues, joins: { effects, counters, panel, waiting } };
}

/** The cue of a name, or null. */
export function cueOf(data: SoundData, id: string): SoundCue | null {
  return data.cues.find(c => c.id === id) ?? null;
}

// ---- takes in turn, and their small variation -----------------------------------------------------

/** A number in [0, 1) from a name, a count and a tag, the same every time: a mix of their bits. */
export function spread(name: string, n: number, tag: number): number {
  let h = 0x811c9dc5 ^ Math.imul((tag + 1) | 0, 0x9e3779b1);
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= Math.imul((n + 1) | 0, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Which take the n-th playing of a cue uses (n from 0): each in turn, and round again. */
export function takeFor(cue: { readonly takes: readonly unknown[] }, n: number): number {
  const count = cue.takes.length;
  return ((Math.floor(n) % count) + count) % count;
}

/** How the n-th playing of a cue differs from the recording: what the speed and the level are multiplied by. */
export function variation(cue: Pick<SoundCue, 'id' | 'detune' | 'cents' | 'db'>, n: number): { rate: number; gain: number } {
  const cents = cue.detune + (spread(cue.id, n, 1) * 2 - 1) * cue.cents;
  const db = (spread(cue.id, n, 2) * 2 - 1) * cue.db;
  return { rate: 2 ** (cents / 1200), gain: 10 ** (db / 20) };
}

/** The effects' volume (0 to 1, as a control shows it) as a multiplier of the sound: the square law the music uses. */
export function amplitude(volume: number): number {
  const v = Math.min(1, Math.max(0, volume));
  return v * v;
}

// ---- how many at once, and how often ------------------------------------------------------------

/**
 * What is to be done about one more voice of a cue: `start` it; `refuse` it; or start it in the
 * place of an older voice, which gives way: the oldest of the cue's own (`replace-own`) or the
 * oldest of all (`replace-any`).
 */
export type Admission = 'start' | 'refuse' | 'replace-own' | 'replace-any';

/**
 * How many voices at once, and how often. A cue is refused sooner after its last start than its
 * least interval: that is what keeps a move from being forty puffs of engine. A cue that has its
 * most voices sounding, or that comes when every voice there is is in use, is not refused (a shot
 * that makes no sound is worse than a tail cut short): an older voice gives way to it.
 */
export class Limiter {
  private readonly last = new Map<string, number>();
  private readonly sounding = new Map<string, number>();
  private all = 0;
  private readonly most: number;

  constructor(most: number) {
    this.most = most;
  }

  /** How many voices sound now: of one cue, or of all. */
  count(cue?: string): number {
    return cue === undefined ? this.all : (this.sounding.get(cue) ?? 0);
  }

  /**
   * What to do about one more voice of the cue at `now` (milliseconds on any steady clock). Unless
   * it is refused the new voice is counted and the time noted; where an older voice is to give way,
   * whoever plays must `release` that one.
   */
  admit(cue: Pick<SoundCue, 'id' | 'leastMs' | 'voices'>, now: number): Admission {
    const last = this.last.get(cue.id);
    if (last !== undefined && now - last < cue.leastMs) return 'refuse';
    const verdict: Admission = this.count(cue.id) >= cue.voices ? 'replace-own' : this.all >= this.most ? 'replace-any' : 'start';
    this.last.set(cue.id, now);
    this.sounding.set(cue.id, this.count(cue.id) + 1);
    this.all++;
    return verdict;
  }

  /** A voice that was admitted has ended (or never started). */
  release(cue: Pick<SoundCue, 'id'>): void {
    const n = this.count(cue.id);
    if (n <= 0) return;
    this.sounding.set(cue.id, n - 1);
    this.all--;
  }

  /** Every voice has been stopped. The times of the last starts are kept. */
  clear(): void {
    this.sounding.clear();
    this.all = 0;
  }
}

// ---- where across the board ---------------------------------------------------------------------

/** How far to either side a sound at the board's edge is placed (1 would be all the way). */
export const PAN_WIDTH = 0.35;

/** Where a sound in column `col` of `cols` is placed from left (-PAN_WIDTH) to right (+PAN_WIDTH); 0 where the column is not on the board. */
export function panOf(col: number, cols: number): number {
  if (!Number.isFinite(col) || !Number.isFinite(cols) || cols < 2 || col < 0 || col > cols - 1) return 0;
  return ((col / (cols - 1)) * 2 - 1) * PAN_WIDTH;
}
