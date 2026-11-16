/**
 * The rewards after every battle, as plain arithmetic (no browser): the medal a battle earns and why, and the service
 * record each side keeps (battles fought, won and lost, medals of each tier, service points, rank and the way to the
 * next). The numbers and the names are data (content/rewards/rewards.yaml, read by rewards-data.ts), checked here:
 * every field is required, and a file that does not check is an error naming every problem.
 *
 * A battle's record is written once: the record keeps the ids of the battles it has counted, and a battle it has
 * counted already leaves it as it is (a reload of the battle's end, an online game told of its end again).
 */

export const REWARDS_FORMAT = 'rewards/1';
/** A battle's outcome for the player, best first. The game always names a winner (rule 15.5), so there is no draw. */
export const OUTCOMES = ['decisive', 'victory', 'defeat', 'heavy'] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const SIDES = ['german', 'soviet'] as const;
export type ServiceSide = (typeof SIDES)[number];
export const LEVELS = ['easy', 'normal', 'hard'] as const;
export type Opponent = (typeof LEVELS)[number];
/** How the game said a battle ended (engine/rulesets/impulse/types.ts EndReason). */
export const END_REASONS = ['break', 'sudden death', 'turn limit'] as const;
export type EndReason = (typeof END_REASONS)[number];
const TESTS = ['own-losses-at-most', 'own-losses-at-least', 'enemy-losses-at-least', 'all-objectives-held'] as const;
type Test = (typeof TESTS)[number];

export interface Deed {
  readonly id: string;
  readonly test: Test;
  readonly share: number;
  readonly add: number;
  /** The outcomes it counts after. */
  readonly after: readonly Outcome[];
  readonly why: string;
}
export interface SideRewards {
  readonly name: string;
  readonly medals: readonly { readonly name: string; readonly art: string }[];
  readonly ranks: readonly { readonly name: string; readonly points: number; readonly art: string }[];
}
export interface RewardsData {
  readonly outcomes: Readonly<Record<Outcome, { readonly words: string; readonly merit: number; readonly why: string }>>;
  /**
   * No medal without a deed: a battle earns a medal only when the player's force destroyed at least `enemyDestroyed`
   * enemy units or took at least `objectivesTaken` objectives; otherwise none, and the citation says `why`.
   */
  readonly needs: { readonly enemyDestroyed: number; readonly objectivesTaken: number; readonly why: string };
  readonly deeds: readonly Deed[];
  readonly opponent: Readonly<Record<Opponent, number>>;
  /** The merit at which each medal tier is earned, lowest tier first. */
  readonly medalLeast: readonly number[];
  readonly promotion: { readonly perMedalTier: number; readonly perVictory: number };
  readonly sides: Readonly<Record<ServiceSide, SideRewards>>;
}

/** The fields each mapping of the data may hold: a field that is not one of them is a problem (a misspelt field is not passed over). */
const FIELDS = {
  root: ['format', 'outcomes', 'needs', 'deeds', 'opponent', 'medalLeast', 'promotion', 'sides'],
  outcome: ['words', 'merit', 'why'],
  needs: ['enemyDestroyed', 'objectivesTaken', 'why'],
  deed: ['id', 'test', 'share', 'add', 'after', 'why'],
  promotion: ['perMedalTier', 'perVictory'],
  side: ['name', 'medals', 'ranks'],
  medal: ['name', 'art'],
  rank: ['name', 'points', 'art'],
} as const;

/** The rewards data (as read from its file) checked; throws with every problem. */
export function parseRewards(raw: unknown, file = 'content/rewards/rewards.yaml'): RewardsData {
  const problems: string[] = [];
  const obj = (v: unknown, at: string, fields: readonly string[]): Record<string, unknown> => {
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      for (const k of Object.keys(v)) if (!fields.includes(k)) problems.push(`${at}.${k}: not a field of this format`);
      return v as Record<string, unknown>;
    }
    problems.push(`${at}: not a mapping`);
    return {};
  };
  const num = (v: unknown, at: string): number => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    problems.push(`${at}: not a number`);
    return 0;
  };
  const count = (v: unknown, at: string): number => {
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v;
    problems.push(`${at}: not a whole number, 0 or more`);
    return 0;
  };
  const str = (v: unknown, at: string): string => {
    if (typeof v === 'string' && v.trim().length > 0) return v;
    problems.push(`${at}: not a word`);
    return '';
  };
  const list = (v: unknown, at: string): unknown[] => {
    if (Array.isArray(v)) return v;
    problems.push(`${at}: not a list`);
    return [];
  };
  const root = obj(raw, file, FIELDS.root);
  if (root['format'] !== REWARDS_FORMAT) problems.push(`${file}: format must be ${REWARDS_FORMAT}`);
  const oc = obj(root['outcomes'], 'outcomes', OUTCOMES);
  const outcomes = Object.fromEntries(OUTCOMES.map(o => {
    const e = obj(oc[o], `outcomes.${o}`, FIELDS.outcome);
    return [o, { words: str(e['words'], `outcomes.${o}.words`), merit: num(e['merit'], `outcomes.${o}.merit`), why: str(e['why'], `outcomes.${o}.why`) }];
  })) as RewardsData['outcomes'];
  const nd = obj(root['needs'], 'needs', FIELDS.needs);
  const needs = { enemyDestroyed: count(nd['enemyDestroyed'], 'needs.enemyDestroyed'), objectivesTaken: count(nd['objectivesTaken'], 'needs.objectivesTaken'), why: str(nd['why'], 'needs.why') };
  if (needs.enemyDestroyed < 1 || needs.objectivesTaken < 1) problems.push('needs: each of the two must be 1 or more (a need of 0 is met by doing nothing)');
  const deeds = list(root['deeds'], 'deeds').map((d, i) => {
    const e = obj(d, `deeds[${i}]`, FIELDS.deed);
    const test = e['test'];
    if (!(TESTS as readonly unknown[]).includes(test)) problems.push(`deeds[${i}].test: one of ${TESTS.join(', ')}`);
    const share = num(e['share'], `deeds[${i}].share`);
    if (share < 0 || share > 1) problems.push(`deeds[${i}].share: from 0 to 1`);
    const after = list(e['after'], `deeds[${i}].after`);
    if (after.length === 0 || !after.every(o => (OUTCOMES as readonly unknown[]).includes(o))) problems.push(`deeds[${i}].after: one or more of ${OUTCOMES.join(', ')}`);
    return { id: str(e['id'], `deeds[${i}].id`), test: test as Test, share, add: num(e['add'], `deeds[${i}].add`), after: after as Outcome[], why: str(e['why'], `deeds[${i}].why`) };
  });
  const op = obj(root['opponent'], 'opponent', LEVELS);
  const opponent = Object.fromEntries(LEVELS.map(l => [l, num(op[l], `opponent.${l}`)])) as RewardsData['opponent'];
  const medalLeast = list(root['medalLeast'], 'medalLeast').map((v, i) => num(v, `medalLeast[${i}]`));
  if (medalLeast.length !== 5) problems.push('medalLeast: five tiers');
  for (let i = 1; i < medalLeast.length; i++) if ((medalLeast[i] as number) <= (medalLeast[i - 1] as number)) problems.push('medalLeast: each tier above the one before');
  const pr = obj(root['promotion'], 'promotion', FIELDS.promotion);
  const promotion = { perMedalTier: num(pr['perMedalTier'], 'promotion.perMedalTier'), perVictory: num(pr['perVictory'], 'promotion.perVictory') };
  const sd = obj(root['sides'], 'sides', SIDES);
  const sides = Object.fromEntries(SIDES.map(s => {
    const e = obj(sd[s], `sides.${s}`, FIELDS.side);
    const medals = list(e['medals'], `sides.${s}.medals`).map((m, i) => {
      const x = obj(m, `sides.${s}.medals[${i}]`, FIELDS.medal);
      return { name: str(x['name'], `sides.${s}.medals[${i}].name`), art: str(x['art'], `sides.${s}.medals[${i}].art`) };
    });
    const ranks = list(e['ranks'], `sides.${s}.ranks`).map((m, i) => {
      const x = obj(m, `sides.${s}.ranks[${i}]`, FIELDS.rank);
      return { name: str(x['name'], `sides.${s}.ranks[${i}].name`), points: num(x['points'], `sides.${s}.ranks[${i}].points`), art: str(x['art'], `sides.${s}.ranks[${i}].art`) };
    });
    if (medals.length !== 5) problems.push(`sides.${s}.medals: five`);
    if (ranks.length !== 5) problems.push(`sides.${s}.ranks: five`);
    if (ranks[0] && ranks[0].points !== 0) problems.push(`sides.${s}.ranks[0].points: the first rank is held from 0`);
    for (let i = 1; i < ranks.length; i++) if ((ranks[i] as { points: number }).points <= (ranks[i - 1] as { points: number }).points) problems.push(`sides.${s}.ranks[${i}].points: above the rank before`);
    return [s, { name: str(e['name'], `sides.${s}.name`), medals, ranks }];
  })) as unknown as RewardsData['sides'];
  if (problems.length) throw new Error(`${file}:\n${problems.join('\n')}`);
  return { outcomes, needs, deeds, opponent, medalLeast, promotion, sides };
}

/** What happened in a battle, for the player's side, as the game's own record tells it (rewards-end.ts makes it). */
export interface BattleReport {
  /** The battle's own id: the same battle's end told twice has the same id. */
  readonly id: string;
  readonly side: ServiceSide;
  /** The battle's title and the level it was played at (patrol, skirmish, battle, offensive, campaign), when it has one. */
  readonly title: string;
  readonly level: string | null;
  readonly won: boolean;
  readonly reason: EndReason;
  /** The game's own end line, as its panel said it (null when the game's page gave none). */
  readonly said: string | null;
  /** The player's score, then the enemy's. */
  readonly scores: readonly [number, number];
  readonly turn: number;
  readonly lastTurn: number;
  /** Units destroyed and the points they cost, of the enemy's and the player's, with each force's whole. */
  readonly enemy: { readonly destroyed: number; readonly units: number; readonly points: number; readonly start: number };
  readonly own: { readonly destroyed: number; readonly units: number; readonly points: number; readonly start: number };
  /** Objectives the player's side held at the end, of all; and how many of those it took (they were not its own at the start). */
  readonly held: number;
  readonly objectives: number;
  readonly taken: number;
  /** The computer's level, or null against a person (online). */
  readonly opponent: Opponent | null;
  readonly online: boolean;
  /** A campaign battle: the campaign's title, the points this battle gave it, and its result's words there. */
  readonly campaign: { readonly id: string; readonly title: string; readonly points: number; readonly result: string } | null;
  /** The battle list's id of the scenario played (`scenario=` of its address), or null. */
  readonly scenario: string | null;
  /** The address that plays the same battle again, fresh (single battles), or null. */
  readonly again: string | null;
}

/** The outcome of a battle for the player: as the game named its winner, and how it ended (at the turn limit, or before it). */
export function outcomeOf(won: boolean, reason: EndReason): Outcome {
  if (won) return reason === 'turn limit' ? 'victory' : 'decisive';
  return reason === 'turn limit' ? 'defeat' : 'heavy';
}

const share = (part: number, whole: number): number => (whole > 0 ? part / whole : 0);

function holds(d: Deed, r: BattleReport): boolean {
  switch (d.test) {
    case 'own-losses-at-most':
      return share(r.own.points, r.own.start) <= d.share;
    case 'own-losses-at-least':
      return share(r.own.points, r.own.start) >= d.share;
    case 'enemy-losses-at-least':
      return share(r.enemy.points, r.enemy.start) >= d.share;
    case 'all-objectives-held':
      return r.objectives > 0 && r.held >= r.objectives;
  }
}

export interface Medal {
  /** 1 to 5; 0 for none. */
  readonly tier: number;
  readonly merit: number;
  /** The reasons, in order: the outcome's, then each deed that held (the opponent's level is not said); or, with nothing done, why there is none. */
  readonly why: readonly string[];
}

/** Whether the player's force did something in the battle: destroyed enough of the enemy, or took enough objectives. */
export function didSomething(data: RewardsData, r: BattleReport): boolean {
  return r.enemy.destroyed >= data.needs.enemyDestroyed || r.taken >= data.needs.objectivesTaken;
}

/** The medal a battle earns. */
export function medalOf(data: RewardsData, r: BattleReport): Medal {
  const outcome = outcomeOf(r.won, r.reason);
  let merit = data.outcomes[outcome].merit + data.opponent[r.opponent ?? 'normal'];
  const why = [data.outcomes[outcome].why];
  for (const d of data.deeds) {
    if (!d.after.includes(outcome) || !holds(d, r)) continue;
    merit += d.add;
    why.push(d.why);
  }
  let tier = 0;
  data.medalLeast.forEach((least, i) => {
    if (merit >= least) tier = i + 1;
  });
  // No medal without a deed, whatever the merit: the medal the merit would have earned is not given, and that is why.
  if (tier > 0 && !didSomething(data, r)) return { tier: 0, merit, why: [data.outcomes[outcome].why, data.needs.why] };
  return { tier, merit, why };
}

/** One side's service record. */
export interface SideRecord {
  readonly fought: number;
  readonly won: number;
  readonly lost: number;
  /** How many medals of each tier, lowest first. */
  readonly medals: readonly [number, number, number, number, number];
  readonly points: number;
}
/** What one battle gave: shown by the rewards screen, and again on a reload of it. */
export interface Award {
  readonly report: BattleReport;
  readonly outcome: Outcome;
  readonly medal: Medal;
  /** The rank (0 to 4) before and after the battle, and the service points before and after. */
  readonly rankBefore: number;
  readonly rankAfter: number;
  readonly pointsBefore: number;
  readonly pointsAfter: number;
}
/** Everything kept, under one key. */
export interface ServiceFile {
  readonly format: 'service/1';
  readonly sides: Readonly<Record<ServiceSide, SideRecord>>;
  /** The ids of the battles counted, newest last (the last COUNTED_KEPT). */
  readonly counted: readonly string[];
  /** The last battle's award, for the rewards screen. */
  readonly last: Award | null;
}

/** How many counted battles' ids are kept (a battle older than that cannot come back to be counted). */
export const COUNTED_KEPT = 64;

export const emptySide = (): SideRecord => ({ fought: 0, won: 0, lost: 0, medals: [0, 0, 0, 0, 0], points: 0 });
export const emptyService = (): ServiceFile => ({ format: 'service/1', sides: { german: emptySide(), soviet: emptySide() }, counted: [], last: null });

/** The rank (0 to 4) held at these service points. */
export function rankAt(data: RewardsData, side: ServiceSide, points: number): number {
  let rank = 0;
  data.sides[side].ranks.forEach((r, i) => {
    if (points >= r.points) rank = i;
  });
  return rank;
}

/** The way to the next rank: points so far from this rank, and the points this rank spans; null at the highest. */
export function toNext(data: RewardsData, side: ServiceSide, points: number): { readonly done: number; readonly of: number; readonly next: string } | null {
  const ranks = data.sides[side].ranks;
  const k = rankAt(data, side, points);
  const now = ranks[k];
  const next = ranks[k + 1];
  if (!now || !next) return null;
  return { done: points - now.points, of: next.points - now.points, next: next.name };
}

/** The service points a battle adds. */
export function pointsOf(data: RewardsData, outcome: Outcome, medal: Medal): number {
  return medal.tier * data.promotion.perMedalTier + (outcome === 'decisive' || outcome === 'victory' ? data.promotion.perVictory : 0);
}

/**
 * A battle counted into the record, once. `fresh` is false when its id was counted already: the file is then as it was,
 * and the award is the one kept for it (or one worked out again without counting, when it is no longer the last).
 */
export function recordBattle(data: RewardsData, file: ServiceFile, r: BattleReport): { file: ServiceFile; award: Award; fresh: boolean } {
  const outcome = outcomeOf(r.won, r.reason);
  const medal = medalOf(data, r);
  if (file.counted.includes(r.id)) {
    if (file.last && file.last.report.id === r.id) return { file, award: file.last, fresh: false };
    const p = file.sides[r.side].points;
    const k = rankAt(data, r.side, p);
    return { file, award: { report: r, outcome, medal, rankBefore: k, rankAfter: k, pointsBefore: p, pointsAfter: p }, fresh: false };
  }
  const was = file.sides[r.side];
  const add = pointsOf(data, outcome, medal);
  const medals = was.medals.map((n, i) => (i === medal.tier - 1 ? n + 1 : n)) as unknown as SideRecord['medals'];
  const won = outcome === 'decisive' || outcome === 'victory';
  const now: SideRecord = { fought: was.fought + 1, won: was.won + (won ? 1 : 0), lost: was.lost + (won ? 0 : 1), medals, points: was.points + add };
  const award: Award = { report: r, outcome, medal, rankBefore: rankAt(data, r.side, was.points), rankAfter: rankAt(data, r.side, now.points), pointsBefore: was.points, pointsAfter: now.points };
  return {
    file: { format: 'service/1', sides: { ...file.sides, [r.side]: now }, counted: [...file.counted, r.id].slice(-COUNTED_KEPT), last: award },
    award,
    fresh: true,
  };
}

// ---- keeping it ----------------------------------------------------------------------------------------------

/** The one key the record is kept under. */
export const SERVICE_KEY = 'shell.service-record';

export interface ServiceStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isMapping = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isWordOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';

function sideFrom(v: unknown): SideRecord | null {
  if (!isMapping(v)) return null;
  const medals = v['medals'];
  if (!isCount(v['fought']) || !isCount(v['won']) || !isCount(v['lost']) || !isCount(v['points'])) return null;
  if (!Array.isArray(medals) || medals.length !== 5 || !medals.every(isCount)) return null;
  return { fought: v['fought'], won: v['won'], lost: v['lost'], points: v['points'], medals: medals as unknown as SideRecord['medals'] };
}

function forceFrom(v: unknown): BattleReport['own'] | null {
  if (!isMapping(v) || !isCount(v['destroyed']) || !isCount(v['units']) || !isCount(v['points']) || !isCount(v['start'])) return null;
  return { destroyed: v['destroyed'], units: v['units'], points: v['points'], start: v['start'] };
}

/** A kept award read back whole, or null when any part of it is not as this build writes it (the screen then shows the record). */
function awardFrom(v: unknown): Award | null {
  if (!isMapping(v) || !isMapping(v['report']) || !isMapping(v['medal'])) return null;
  const r = v['report'];
  const m = v['medal'];
  const enemy = forceFrom(r['enemy']);
  const own = forceFrom(r['own']);
  const scores = r['scores'];
  const c = r['campaign'];
  const why = m['why'];
  const one = <T extends string>(x: unknown, of: readonly T[]): x is T => (of as readonly unknown[]).includes(x);
  if (typeof r['id'] !== 'string' || !one(r['side'], SIDES) || typeof r['title'] !== 'string' || !isWordOrNull(r['level'])) return null;
  if (typeof r['won'] !== 'boolean' || !one(r['reason'], END_REASONS) || !isWordOrNull(r['said'])) return null;
  if (!Array.isArray(scores) || scores.length !== 2 || !scores.every(s => typeof s === 'number' && Number.isFinite(s))) return null;
  if (!isCount(r['turn']) || !isCount(r['lastTurn']) || !enemy || !own || !isCount(r['held']) || !isCount(r['objectives']) || !isCount(r['taken'])) return null;
  if (!(r['opponent'] === null || one(r['opponent'], LEVELS)) || typeof r['online'] !== 'boolean' || !isWordOrNull(r['scenario'])) return null;
  // The way to play again is an address on this site, or none.
  if (!(r['again'] === null || (typeof r['again'] === 'string' && r['again'].startsWith('/') && !r['again'].startsWith('//')))) return null;
  if (!(c === null || (isMapping(c) && typeof c['id'] === 'string' && typeof c['title'] === 'string' && typeof c['points'] === 'number' && Number.isFinite(c['points']) && typeof c['result'] === 'string'))) return null;
  if (!one(v['outcome'], OUTCOMES) || !isCount(m['tier']) || m['tier'] > 5 || typeof m['merit'] !== 'number' || !Array.isArray(why) || !why.every(w => typeof w === 'string')) return null;
  if (![v['rankBefore'], v['rankAfter']].every(k => isCount(k) && k <= 4) || !isCount(v['pointsBefore']) || !isCount(v['pointsAfter'])) return null;
  return {
    report: {
      id: r['id'], side: r['side'], title: r['title'], level: r['level'], won: r['won'], reason: r['reason'], said: r['said'], scores: [scores[0] as number, scores[1] as number],
      turn: r['turn'], lastTurn: r['lastTurn'], enemy, own, held: r['held'], objectives: r['objectives'], taken: r['taken'], opponent: r['opponent'] as Opponent | null, online: r['online'],
      campaign: c === null ? null : { id: (c as Record<string, unknown>)['id'] as string, title: (c as Record<string, unknown>)['title'] as string, points: (c as Record<string, unknown>)['points'] as number, result: (c as Record<string, unknown>)['result'] as string },
      scenario: r['scenario'], again: r['again'] as string | null,
    },
    outcome: v['outcome'],
    medal: { tier: m['tier'], merit: m['merit'], why: why as string[] },
    rankBefore: v['rankBefore'] as number,
    rankAfter: v['rankAfter'] as number,
    pointsBefore: v['pointsBefore'],
    pointsAfter: v['pointsAfter'],
  };
}

/**
 * The kept record; an empty one when none is kept, and when what is kept is not a record (said on the console). A
 * record whose last award is not as this build writes it keeps its counts and loses that award (said on the console).
 */
export function readService(store: ServiceStore | null): ServiceFile {
  if (!store) return emptyService();
  let text: string | null = null;
  try {
    text = store.getItem(SERVICE_KEY);
  } catch {
    return emptyService();
  }
  if (text === null) return emptyService();
  try {
    const raw: unknown = JSON.parse(text);
    if (!isMapping(raw)) throw new Error('not a service record');
    const sides = raw['sides'];
    const german = isMapping(sides) ? sideFrom(sides['german']) : null;
    const soviet = isMapping(sides) ? sideFrom(sides['soviet']) : null;
    const counted = raw['counted'];
    if (raw['format'] !== 'service/1' || !german || !soviet || !Array.isArray(counted) || !counted.every(c => typeof c === 'string')) throw new Error('not a service record');
    const last = raw['last'] === null ? null : awardFrom(raw['last']);
    if (raw['last'] !== null && last === null) console.warn('[rewards] the last battle kept with the service record could not be read and is left out');
    return { format: 'service/1', sides: { german, soviet }, counted: (counted as string[]).slice(-COUNTED_KEPT), last };
  } catch (e) {
    console.warn(`[rewards] the kept service record could not be read and is begun again: ${(e as Error).message}`);
    return emptyService();
  }
}

/** Writes the record; false when the browser keeps nothing. */
export function writeService(store: ServiceStore | null, file: ServiceFile): boolean {
  if (!store) return false;
  try {
    store.setItem(SERVICE_KEY, JSON.stringify(file));
    return true;
  } catch {
    return false;
  }
}

/** The browser's own store, or null where there is none or it keeps nothing. */
export function browserService(): ServiceStore | null {
  try {
    return (globalThis as { localStorage?: ServiceStore }).localStorage ?? null;
  } catch {
    return null;
  }
}
