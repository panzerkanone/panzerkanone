/**
 * A campaign's progress as one record, and every step of it as a pure function (docs/review/M7/campaign/design.md):
 * a new campaign; a battle drawn from what the force has left; a battle settled; replacements bought and taken
 * back; the score and the verdict. Nothing here touches the page: keep.ts keeps the record in the browser, the
 * screens show it, start.ts plays its battles.
 *
 * THE FORCE is a list of places, one for each unit of the campaign's force at full strength, in the force's order.
 * A place holds a unit (its type now: a replacement may be another type of the place's kind) or is empty (its unit
 * lost and not replaced). The force never grows past its places: every battle is set up and levelled for them.
 *
 * DRAWING A BATTLE (drawBattle): the battle's file places the force at full strength; the game is played on a copy
 * of it in which
 *   1. each place takes its unit now, and an empty place is left empty: the battle starts with what is left;
 *   2. a unit whose transport's place is empty starts on foot in the transport's hex;
 *   3. in each formation, transports beyond the units left that can ride sit the battle out (kept), the last
 *      listed that carries nothing first;
 *   4. a formation left with one unit that is not a transport fights as part of the first other formation of its
 *      side with room for it (rule 3.1: two to five; under whole-side turns formations differ only in their fire
 *      discipline), its transports with it; if none has room, it sits the battle out (kept). A formation left with
 *      none takes no part, and its transports sit the battle out;
 *   5. the other side, the objectives, the ending and the board are the file's.
 * The copy is a scenario like any other: the host checks it before play.
 *
 * AFTER A BATTLE (settle): a unit destroyed is gone (its place empty); every other unit carries on, the carried and
 * those that sat out too. Nothing else carries: Suppressed, Spent and Moved belong to a battle, and the rules have
 * no damaged state (rules v1, 16: no step losses).
 */
import { parse as parseText, stringify } from 'yaml';
import { hashOf } from '../../../engine/core/random';
import type { EndReason } from '../../../engine/rulesets/impulse/types';
import type { UnitFile } from '../../../engine/rulesets/impulse/units';
import { forceUnits, kindOf } from './format';
import type { CampaignBattle, CampaignData, Result } from './format';

/** The format a kept campaign's text has: another format is not read. */
export const RECORD_FORMAT = 'panzerkanone.campaign/1';

/** One place of the force. */
export interface Place {
  /** The force unit's id, which is its place. */
  readonly id: string;
  /** The type of the unit there now; null when the place is empty. */
  readonly type: string | null;
  /** The battle (its scenario id) where the place's last unit was lost, while it stays empty; else null. */
  readonly lostAt: string | null;
  /** How many battles the unit there now has fought. */
  readonly fought: number;
}

/** A replacement bought for an empty place, and what the place said before (for taking it back). */
export interface Purchase {
  readonly place: string;
  readonly type: string;
  readonly cost: number;
  readonly lostAt: string;
}

/** A battle fought. */
export interface Fought {
  /** The battle's scenario id. */
  readonly battle: string;
  readonly result: Result;
  readonly reason: EndReason;
  /** The battle's final score: the player's, then the opponent's. */
  readonly score: readonly [number, number];
  /** Campaign points it gave. */
  readonly points: number;
  /** Replacement points it earned. */
  readonly earned: number;
  /** The places whose units were destroyed in it. */
  readonly lost: readonly string[];
  /** The replacements bought after it, once the next battle has begun. */
  readonly bought: readonly Purchase[];
  readonly seed: number;
}

/** Where a campaign stands: before its first battle, between two, in one, or over. */
export type Stage = 'intro' | 'between' | 'battle' | 'ended';
/** How a campaign ended. */
export type Verdict = 'victory' | 'draw' | 'defeat' | 'broken';

/** A battle being fought. */
export interface InBattle {
  /** Its index in the campaign's battles. */
  readonly index: number;
  /** The force's units in it (the others sit it out). */
  readonly units: readonly string[];
  /** The kept game's id (`save=` in the battle's address). */
  readonly save: string;
  readonly seed: number;
}

export interface CampaignRecord {
  readonly format: typeof RECORD_FORMAT;
  /** The campaign file's id. */
  readonly campaign: string;
  /** The build that began it (client/src/version.ts). */
  readonly version: string;
  /** The campaign's own seed: each battle's is drawn from it (battleSeed). */
  readonly seed: number;
  readonly stage: Stage;
  readonly places: readonly Place[];
  /** Replacement points in hand. */
  readonly inHand: number;
  /** Replacements bought since the last battle: taken back freely until the next begins. */
  readonly pending: readonly Purchase[];
  readonly fought: readonly Fought[];
  readonly battle: InBattle | null;
  readonly verdict: Verdict | null;
}

/** The cost of a type of the unit file. */
export function costOf(units: UnitFile): (type: string) => number {
  const cost = new Map(units.types.map(t => [t.id, t.cost]));
  return type => {
    const c = cost.get(type);
    if (c === undefined) throw new Error(`campaign: no unit type '${type}' in ${units.id}`);
    return c;
  };
}

/** A campaign just begun: the force at full strength, nothing fought, no points. */
export function newRecord(c: CampaignData, seed: number, version: string): CampaignRecord {
  return {
    format: RECORD_FORMAT,
    campaign: c.id,
    version,
    seed: seed >>> 0,
    stage: 'intro',
    places: forceUnits(c).map(({ unit }) => ({ id: unit.id, type: unit.type, lostAt: null, fought: 0 })),
    inHand: 0,
    pending: [],
    fought: [],
    battle: null,
    verdict: null,
  };
}

/** The seed battle `k` is played with. */
export function battleSeed(r: CampaignRecord, k: number): number {
  return hashOf(r.seed, 'campaign-battle', k);
}

/** What the force's units are worth now, and at full strength. */
export function strength(places: readonly Place[], cost: (type: string) => number): number {
  return places.reduce((sum, p) => sum + (p.type === null ? 0 : cost(p.type)), 0);
}
export function fullStrength(c: CampaignData, cost: (type: string) => number): number {
  return forceUnits(c).reduce((sum, { unit }) => sum + cost(unit.type), 0);
}

/** True when the force is broken: what it has left is worth less than the campaign's share of its full strength. */
export function isBroken(c: CampaignData, places: readonly Place[], cost: (type: string) => number): boolean {
  const [p, q] = c.scoring.broken;
  return strength(places, cost) * q < fullStrength(c, cost) * p;
}

/** A battle's result for the player, from its winner and how it ended. */
export function resultOf(won: boolean, reason: EndReason): Result {
  if (won) return reason === 'turn limit' ? 'victory' : 'decisive';
  return reason === 'turn limit' ? 'defeat' : 'heavy';
}

/** The campaign points so far. */
export function totalPoints(r: CampaignRecord): number {
  return r.fought.reduce((sum, f) => sum + f.points, 0);
}

/** The verdict on a campaign whose battles are all fought. */
export function verdictOf(c: CampaignData, total: number): Verdict {
  return total >= c.scoring.victory ? 'victory' : total >= c.scoring.draw ? 'draw' : 'defeat';
}

/** The index of the next battle to fight, or null when all are fought. */
export function nextBattle(c: CampaignData, r: CampaignRecord): number | null {
  return r.fought.length < c.battles.length ? r.fought.length : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Drawing a battle
// ---------------------------------------------------------------------------------------------------------------

interface RawUnit {
  id: string;
  type: string;
  hex?: string;
  carriedBy?: string;
}
interface RawFormation {
  id: string;
  discipline: string;
  units: RawUnit[];
}

/** A battle as the force can fight it now. */
export interface Drawn {
  /** The scenario to play: the battle's file with the player's side drawn from the force. */
  readonly text: string;
  /** The force's units in the battle, in order. */
  readonly units: readonly string[];
  /** The force's units that sit it out (kept): transports with nothing to carry, a lone unit with no formation to join. */
  readonly out: readonly string[];
  /** Lone units that fight in another formation. */
  readonly joined: readonly { readonly unit: string; readonly into: string }[];
}

/** The battle as the force can fight it now; null when the force has nothing left to fight it with. */
export function drawBattle(b: CampaignBattle, places: readonly Place[], units: UnitFile): Drawn | null {
  const raw = parseText(b.scenario.text) as { sides: { formations: RawFormation[] }[]; briefing: { sides: { formations: { id: string }[] }[] } };
  const side = raw.sides[b.mine];
  if (!side) throw new Error(`campaign: ${b.id} has no side ${b.mine}`);
  const place = new Map(places.map(p => [p.id, p]));
  const typeOf = new Map(units.types.map(t => [t.id, t]));
  const transport = (u: RawUnit): boolean => (typeOf.get(u.type)?.carries ?? 0) > 0;
  const rides = (u: RawUnit): boolean => typeOf.get(u.type)?.rides === true;
  const plain = (f: RawFormation): number => f.units.filter(u => !transport(u)).length;
  const out: string[] = [];
  const joined: { unit: string; into: string }[] = [];
  // Where each transport stands in the file (a transport never starts carried).
  const transportHex = new Map<string, string>();
  for (const f of side.formations) for (const u of f.units) if (u.hex !== undefined) transportHex.set(u.id, u.hex);

  // 1. Each place takes its unit now; an empty place is left empty.
  let forms: RawFormation[] = side.formations.map(f => ({
    ...f,
    units: f.units.flatMap(u => {
      const p = place.get(u.id);
      return p && p.type !== null ? [{ ...u, type: p.type }] : [];
    }),
  }));
  // 2. A unit whose transport is gone starts on foot in the transport's hex.
  for (const f of forms) {
    f.units = f.units.map(u => {
      if (u.carriedBy === undefined || f.units.some(x => x.id === u.carriedBy)) return u;
      const hex = transportHex.get(u.carriedBy);
      if (hex === undefined) throw new Error(`campaign: ${b.id}: the transport ${u.carriedBy} of ${u.id} has no hex`);
      return { id: u.id, type: u.type, hex };
    });
  }
  // 3. Transports beyond the units that can ride sit the battle out.
  const fitTransports = (f: RawFormation): void => {
    const riders = f.units.filter(u => !transport(u) && rides(u)).length;
    let spare = f.units.filter(transport).length - riders;
    while (spare > 0) {
      const carrying = new Set(f.units.map(u => u.carriedBy).filter((x): x is string => x !== undefined));
      const idle = [...f.units].reverse().find(u => transport(u) && !carrying.has(u.id));
      if (!idle) break;
      f.units = f.units.filter(u => u !== idle);
      out.push(idle.id);
      spare--;
    }
  };
  forms.forEach(fitTransports);
  // 4. A formation of one joins another with room; a formation of none takes no part.
  for (;;) {
    const lone = forms.find(f => plain(f) === 1);
    if (!lone) break;
    const into = forms.find(f => f !== lone && plain(f) >= 1 && plain(f) < 5);
    if (into) {
      const movers = lone.units.filter(u => !transport(u));
      const carriers = lone.units.filter(transport);
      const firstTransport = into.units.findIndex(transport);
      const at = firstTransport < 0 ? into.units.length : firstTransport;
      into.units = [...into.units.slice(0, at), ...movers, ...into.units.slice(at), ...carriers];
      for (const u of movers) joined.push({ unit: u.id, into: into.id });
      fitTransports(into);
    } else {
      for (const u of lone.units) out.push(u.id);
    }
    forms = forms.filter(f => f !== lone);
  }
  for (const f of forms) if (plain(f) === 0) for (const u of f.units) out.push(u.id);
  forms = forms.filter(f => plain(f) > 0);
  if (forms.length === 0) return null;

  side.formations = forms;
  const told = raw.briefing.sides[b.mine];
  if (told) told.formations = told.formations.filter(t => forms.some(f => f.id === t.id));
  // The force's units that fight, in the force's order.
  const fighting = new Set(forms.flatMap(f => f.units.map(u => u.id)));
  const order = places.map(p => p.id);
  return {
    text: stringify(raw, { lineWidth: 0 }),
    units: order.filter(id => fighting.has(id)),
    out: order.filter(id => out.includes(id)),
    joined,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The steps of a campaign
// ---------------------------------------------------------------------------------------------------------------

/** The next battle begun: the replacements bought since the last are final, and the record says what is fought. */
export function beginBattle(c: CampaignData, r: CampaignRecord, battles: readonly CampaignBattle[], units: UnitFile, save: string): CampaignRecord {
  if (r.stage !== 'intro' && r.stage !== 'between') throw new Error(`campaign: a battle cannot begin at stage ${r.stage}`);
  const k = nextBattle(c, r);
  const b = k === null ? undefined : battles[k];
  if (k === null || !b) throw new Error('campaign: every battle is fought');
  const drawn = drawBattle(b, r.places, units);
  if (!drawn) throw new Error(`campaign: the force has nothing left to fight ${b.id} with`);
  const fought = r.fought.map((f, i) => (i === r.fought.length - 1 ? { ...f, bought: [...f.bought, ...r.pending] } : f));
  return { ...r, stage: 'battle', fought, pending: [], battle: { index: k, units: drawn.units, save, seed: battleSeed(r, k) } };
}

/** How a battle ended, as the game tells it: by the scenario's sides. */
export interface BattleEnd {
  /** The winning side's index among the scenario's sides. */
  readonly winner: number;
  readonly reason: EndReason;
  /** Each side's final score, by the scenario's sides. */
  readonly scores: readonly [number, number];
  /** The ids of the player's side's units destroyed in it. */
  readonly destroyed: readonly string[];
}

/** The battle in hand settled: losses, points, replacements earned, and the verdict when the campaign is over. */
export function settle(c: CampaignData, r: CampaignRecord, battles: readonly CampaignBattle[], end: BattleEnd, cost: (type: string) => number): CampaignRecord {
  const now = r.battle;
  if (r.stage !== 'battle' || !now) throw new Error(`campaign: no battle to settle at stage ${r.stage}`);
  const b = battles[now.index];
  if (!b) throw new Error(`campaign: no battle ${now.index}`);
  const mine = b.mine;
  const result = resultOf(end.winner === mine, end.reason);
  const inBattle = new Set(now.units);
  const lost = r.places.map(p => p.id).filter(id => inBattle.has(id) && end.destroyed.includes(id));
  const places = r.places.map(p => {
    if (lost.includes(p.id)) return { id: p.id, type: null, lostAt: b.id, fought: p.fought + 1 };
    return inBattle.has(p.id) ? { ...p, fought: p.fought + 1 } : p;
  });
  const fought: Fought = {
    battle: b.id,
    result,
    reason: end.reason,
    score: [end.scores[mine] ?? 0, end.scores[1 - mine] ?? 0],
    points: c.scoring.points[result],
    earned: c.replacements.earned[result],
    lost,
    bought: [],
    seed: now.seed,
  };
  const after: CampaignRecord = { ...r, places, fought: [...r.fought, fought], battle: null };
  const left = c.battles.length - after.fought.length;
  if (left === 0) return { ...after, stage: 'ended', verdict: verdictOf(c, totalPoints(after)) };
  if (isBroken(c, places, cost)) return { ...after, stage: 'ended', verdict: 'broken' };
  return { ...after, stage: 'between', inHand: r.inHand + fought.earned };
}

/** Why a replacement cannot be bought, in a few words; null when it can. */
export function whyNot(c: CampaignData, r: CampaignRecord, placeId: string, type: string, cost: (type: string) => number): string | null {
  if (r.stage !== 'between') return 'not between battles';
  const p = r.places.find(x => x.id === placeId);
  const start = forceUnits(c).find(x => x.unit.id === placeId)?.unit.type;
  if (!p || start === undefined) return 'no such place';
  if (p.type !== null) return 'the place is not empty';
  if (!kindOf(c, start).includes(type)) return 'not of its kind';
  if (cost(type) > r.inHand) return 'not enough points';
  return null;
}

/** A replacement bought for an empty place. */
export function buy(c: CampaignData, r: CampaignRecord, placeId: string, type: string, cost: (type: string) => number): CampaignRecord {
  const why = whyNot(c, r, placeId, type, cost);
  if (why !== null) throw new Error(`campaign: cannot buy a ${type} for ${placeId}: ${why}`);
  const p = r.places.find(x => x.id === placeId) as Place;
  const price = cost(type);
  return {
    ...r,
    places: r.places.map(x => (x.id === placeId ? { id: x.id, type, lostAt: null, fought: 0 } : x)),
    inHand: r.inHand - price,
    pending: [...r.pending, { place: placeId, type, cost: price, lostAt: p.lostAt ?? '' }],
  };
}

/**
 * "Fill for me" (the owner, 2026-11-14): the points in hand spent at once for a player who does not want to choose.
 * Each empty place is bought back as its own type (the place's type in the force), cheapest first so that the most
 * places are filled (places of one price in the force's order), while the points last. What it buys is bought as any
 * choice is: pending, shown on the roster, and taken back or changed freely until the next battle begins.
 */
export function fillForMe(c: CampaignData, r: CampaignRecord, cost: (type: string) => number): CampaignRecord {
  const own = new Map(forceUnits(c).map(({ unit }, i) => [unit.id, { type: unit.type, order: i }]));
  const empty = r.places
    .filter(p => p.type === null)
    .map(p => {
      const o = own.get(p.id);
      if (!o) throw new Error(`campaign: no place ${p.id} in the force`);
      return { id: p.id, type: o.type, order: o.order, price: cost(o.type) };
    })
    .sort((a, b) => a.price - b.price || a.order - b.order);
  let out = r;
  for (const e of empty) {
    if (e.price > out.inHand) break;
    out = buy(c, out, e.id, e.type, cost);
  }
  return out;
}

/** A replacement bought since the last battle taken back: the place empty again, the points back in hand. */
export function takeBack(r: CampaignRecord, placeId: string): CampaignRecord {
  const bought = r.pending.find(x => x.place === placeId);
  if (!bought || r.stage !== 'between') throw new Error(`campaign: nothing bought for ${placeId} to take back`);
  return {
    ...r,
    places: r.places.map(x => (x.id === placeId ? { id: x.id, type: null, lostAt: bought.lostAt === '' ? null : bought.lostAt, fought: 0 } : x)),
    inHand: r.inHand + bought.cost,
    pending: r.pending.filter(x => x !== bought),
  };
}
