/**
 * The campaign in progress, kept in the browser's local storage under one key, `panzerkanone.campaign`, as JSON
 * (force.ts's CampaignRecord): it survives a reload and the tab closed and opened again. One campaign is kept at a
 * time; starting another replaces it (the screen asks first).
 *
 * The record keeps ids, never content: the force's places, the battles fought by their scenario ids, the points.
 * So a build that re-levels a battle still continues the campaign (a battle is drawn afresh when it begins). A
 * record whose campaign file no longer has its places, its battles or its kinds is not read: the screen says so in
 * one line (KEPT_WORDS) and drops it. A battle in progress is the kept game's (client/src/game/keep.ts, once it
 * has landed): this record says which battle it is and the kept game's id.
 *
 * Storage that keeps nothing (a private window, a full quota): the campaign plays the same, unkept.
 */
import { forceUnits, kindOf, RESULTS } from './format';
import type { CampaignData } from './format';
import { RECORD_FORMAT } from './force';
import type { CampaignRecord, Purchase } from './force';

export const CAMPAIGN_KEY = 'panzerkanone.campaign';

/** What the page says, in one line, when a kept campaign could not be continued (and was dropped). */
export const KEPT_WORDS = {
  older: 'Your saved campaign was made for an older version of this campaign and could not be continued.',
  broken: 'Your saved campaign could not be read.',
} as const;

/** The browser's storage as this module uses it; a store that keeps nothing still works. */
export interface CampaignStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** The page's local storage, as much of it as this module uses (read through globalThis: the module is also run by tests without a page). */
interface PageStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
const pageStorage = (): PageStorage | undefined => (globalThis as { localStorage?: PageStorage }).localStorage;

export function localCampaignStore(): CampaignStore {
  return {
    get(key) {
      try {
        return pageStorage()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        pageStorage()?.setItem(key, value);
      } catch {
        // Nothing is kept.
      }
    },
    remove(key) {
      try {
        pageStorage()?.removeItem(key);
      } catch {
        // Nothing was kept.
      }
    },
  };
}

const STAGES = ['intro', 'between', 'battle', 'ended'] as const;
const VERDICTS = ['victory', 'draw', 'defeat', 'broken'] as const;
const REASONS = ['break', 'sudden death', 'turn limit'] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const isInt = (v: unknown, lo = 0): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo;
const isStr = (v: unknown): v is string => typeof v === 'string' && v !== '';

/** The campaign a kept text is of, read before anything else (to find its file); null when it names none. */
export function keptCampaignId(text: string | null): string | null {
  if (text === null) return null;
  try {
    const raw: unknown = JSON.parse(text);
    return isRecord(raw) && raw['format'] === RECORD_FORMAT && isStr(raw['campaign']) ? raw['campaign'] : null;
  } catch {
    return null;
  }
}

/**
 * A kept record checked against its campaign: 'broken' when it is not a record of this format at all, 'older' when it
 * is one but does not fit the campaign file as it is now (its places, kinds, battles), else the record.
 */
export function checkRecord(raw: unknown, c: CampaignData): CampaignRecord | 'broken' | 'older' {
  if (!isRecord(raw) || raw['format'] !== RECORD_FORMAT || raw['campaign'] !== c.id) return 'broken';
  const r = raw;
  if (!isStr(r['version']) || !isInt(r['seed']) || !isInt(r['inHand']) || !(STAGES as readonly unknown[]).includes(r['stage'])) return 'broken';
  if (!Array.isArray(r['places']) || !Array.isArray(r['pending']) || !Array.isArray(r['fought'])) return 'broken';
  const force = forceUnits(c).map(x => x.unit);
  const places = r['places'] as unknown[];
  if (places.length !== force.length) return 'older';
  for (let i = 0; i < places.length; i++) {
    const p = places[i];
    const u = force[i];
    if (!isRecord(p) || !u) return 'broken';
    if (p['id'] !== u.id) return 'older';
    if (p['type'] !== null && !(isStr(p['type']) && kindOf(c, u.type).includes(p['type']))) return 'older';
    if (p['lostAt'] !== null && !(isStr(p['lostAt']) && c.battles.includes(p['lostAt']))) return 'older';
    if (!isInt(p['fought'])) return 'broken';
  }
  const purchase = (x: unknown): x is Purchase => isRecord(x) && isStr(x['place']) && isStr(x['type']) && isInt(x['cost']) && typeof x['lostAt'] === 'string';
  if (!(r['pending'] as unknown[]).every(purchase)) return 'broken';
  const fought = r['fought'] as unknown[];
  if (fought.length > c.battles.length) return 'older';
  for (let i = 0; i < fought.length; i++) {
    const f = fought[i];
    if (!isRecord(f)) return 'broken';
    if (f['battle'] !== c.battles[i]) return 'older';
    if (!(RESULTS as readonly unknown[]).includes(f['result']) || !(REASONS as readonly unknown[]).includes(f['reason'])) return 'broken';
    const score = f['score'];
    if (!Array.isArray(score) || score.length !== 2 || !score.every(s => typeof s === 'number')) return 'broken';
    if (!isInt(f['points']) || !isInt(f['earned']) || !isInt(f['seed'])) return 'broken';
    if (!Array.isArray(f['lost']) || !(f['lost'] as unknown[]).every(isStr) || !Array.isArray(f['bought']) || !(f['bought'] as unknown[]).every(purchase)) return 'broken';
  }
  const battle = r['battle'];
  if (battle !== null) {
    if (!isRecord(battle) || !isInt(battle['index']) || !isStr(battle['save']) || !isInt(battle['seed']) || !Array.isArray(battle['units'])) return 'broken';
    if (battle['index'] !== fought.length) return 'broken';
  }
  if ((r['stage'] === 'battle') !== (battle !== null)) return 'broken';
  const verdict = r['verdict'];
  if (verdict !== null && !(VERDICTS as readonly unknown[]).includes(verdict)) return 'broken';
  if ((r['stage'] === 'ended') !== (verdict !== null)) return 'broken';
  return raw as unknown as CampaignRecord;
}

/** The kept campaign, given the campaigns there are: the record, or why it was dropped, or nothing kept. */
export function readKept(store: CampaignStore, campaignOf: (id: string) => CampaignData | null): { record: CampaignRecord | null; dropped: keyof typeof KEPT_WORDS | null } {
  const text = store.get(CAMPAIGN_KEY);
  if (text === null) return { record: null, dropped: null };
  const id = keptCampaignId(text);
  const c = id === null ? null : campaignOf(id);
  let checked: CampaignRecord | 'broken' | 'older' = id === null ? 'broken' : 'older';
  if (c) {
    try {
      checked = checkRecord(JSON.parse(text) as unknown, c);
    } catch {
      checked = 'broken';
    }
  }
  if (checked === 'broken' || checked === 'older') {
    store.remove(CAMPAIGN_KEY);
    return { record: null, dropped: checked };
  }
  return { record: checked, dropped: null };
}

export function writeKept(store: CampaignStore, r: CampaignRecord): void {
  store.set(CAMPAIGN_KEY, JSON.stringify(r));
}

export function dropKept(store: CampaignStore): void {
  store.remove(CAMPAIGN_KEY);
}
