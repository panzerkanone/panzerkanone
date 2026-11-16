/**
 * A campaign battle on the table: what the game's page (client/src/game/start.ts) asks of the campaign, and the
 * one call that leaves a battle's end for the campaign's room.
 *
 * THE ADDRESS of a campaign battle (battleAddress):
 *   /?view=table&game=1&scenario=<battle>&campaign=<campaign id>&seed=<n>&save=<id>[&sides=second] and the settings
 * `scenario=` names the battle of the game's list, so the table finds its board as for any battle (main.tsx);
 * `campaign=` says the scenario is drawn from the kept campaign's force (force.ts) instead of read from the list;
 * `save=` is the kept game's id (client/src/game/keep.ts, the save builder's, once it lands: until then a reload
 * begins the battle again from its start, which loses nothing, as the force is written only when a battle ends).
 * An address that is not the kept campaign's battle in progress (a battle already settled, another campaign, no
 * campaign kept) goes to the campaign's room instead of playing anything.
 *
 * THE END: the page calls `settleCampaignBattle` once, when the game is over, so the kept campaign holds the
 * battle's losses, points and replacements before anything is shown. Then the one way on is
 * `continueCampaign()`: the end panel's Continue Campaign calls it today, and the rewards screen (another
 * builder's, shown after every battle) will call it when it lands.
 */
import type { ImpulseRuleset } from '../../../engine/rulesets/impulse/rules';
import type { ImpulseView } from '../../../engine/rulesets/impulse/types';
import type { GameModel } from '../game/model';
import { gameAddress } from '../shell/address';
import type { Settings } from '../shell/settings';
import { campaignById, CAMPAIGN_UNITS } from './content';
import type { LoadedCampaign } from './content';
import { costOf, drawBattle, settle } from './force';
import type { BattleEnd, CampaignRecord } from './force';
import type { TextFile } from './format';
import { localCampaignStore, readKept, writeKept } from './keep';
import type { CampaignStore } from './keep';

/** The campaign's room, where every campaign battle's end leads. */
export const ROOM_ADDRESS = '/?screen=campaign';

/** The words a campaign battle's end panel shows in place of the game's own. */
export const BATTLE_WORDS = { onward: 'Continue Campaign' } as const;

/** A new campaign's own seed, drawn once from the browser's crypto (the shell's screens draw nothing themselves). */
export function freshSeed(): number {
  return (globalThis.crypto.getRandomValues(new Uint32Array(1))[0] ?? 1) >>> 0;
}

/** True when the address is a campaign battle's. */
export function isCampaignBattle(params: URLSearchParams): boolean {
  return params.has('campaign');
}

/** The kept game's id for battle `k` of a campaign record (`save=`). */
export function saveIdOf(r: CampaignRecord, k: number): string {
  return `campaign-${r.seed.toString(36)}-${k}`;
}

/** The address that plays battle `k` of a campaign, for a record whose battle in progress it is. */
export function battleAddress(s: Settings, c: LoadedCampaign, r: CampaignRecord, path = '/'): string {
  const now = r.battle;
  const b = now ? c.battles[now.index] : undefined;
  if (!now || !b) throw new Error('campaign: no battle in progress to play');
  const q = new URLSearchParams(gameAddress(s, path, { scenario: b.battle, second: b.mine === 1 }).split('?')[1] ?? '');
  q.set('campaign', c.data.id);
  q.set('seed', String(now.seed));
  q.set('save', now.save);
  return `${path}?${q.toString()}`;
}

/** What a campaign battle's page plays: the scenario drawn from the kept force, or where to go instead. */
export type CampaignPlay = { readonly scenario: TextFile; readonly campaign: LoadedCampaign; readonly record: CampaignRecord } | { readonly away: string };

export function campaignBattle(params: URLSearchParams, store: CampaignStore = localCampaignStore()): CampaignPlay {
  const id = params.get('campaign');
  const c = id === null ? null : campaignById(id);
  if (!c) return { away: ROOM_ADDRESS };
  const { record } = readKept(store, x => campaignById(x)?.data ?? null);
  const now = record?.battle;
  const b = now ? c.battles[now.index] : undefined;
  if (!record || record.campaign !== c.data.id || record.stage !== 'battle' || !now || !b) return { away: ROOM_ADDRESS };
  if (params.get('scenario') !== b.battle || params.get('save') !== now.save) return { away: ROOM_ADDRESS };
  const drawn = drawBattle(b, record.places, CAMPAIGN_UNITS);
  if (!drawn) return { away: ROOM_ADDRESS };
  return { scenario: { file: b.scenario.file, text: drawn.text }, campaign: c, record };
}

/** How a game ended, read from its ruleset and its last view, for the side the campaign plays. */
export function endOfGame(ruleset: ImpulseRuleset, view: ImpulseView, mine: number): BattleEnd | null {
  const result = view.result;
  if (!result) return null;
  const scores: [number, number] = [view.sides[0]?.score ?? 0, view.sides[1]?.score ?? 0];
  const destroyed = ruleset.unitInfo.filter(u => u.side === mine && view.units[u.index]?.destroyed === true).map(u => u.id);
  return { winner: result.winner, reason: result.reason, scores, destroyed };
}

/**
 * The battle in progress settled into the kept campaign, once: losses, points, replacements earned, the verdict if
 * it was the last or the force is broken. True when it settled now; false when there was nothing to settle (it was
 * settled already, or the address is not the kept campaign's battle).
 */
export function settleCampaignBattle(params: URLSearchParams, end: BattleEnd, store: CampaignStore = localCampaignStore()): boolean {
  const id = params.get('campaign');
  const c = id === null ? null : campaignById(id);
  if (!c) return false;
  const { record } = readKept(store, x => campaignById(x)?.data ?? null);
  if (!record || record.campaign !== c.data.id || record.stage !== 'battle' || record.battle?.save !== params.get('save')) return false;
  writeKept(store, settle(c.data, record, c.battles, end, costOf(CAMPAIGN_UNITS)));
  return true;
}

/** The side the campaign plays in the battle the address names (0 or 1), or null when it is no campaign battle. */
export function campaignSide(play: CampaignPlay): number | null {
  if ('away' in play) return null;
  const now = play.record.battle;
  const b = now ? play.campaign.battles[now.index] : undefined;
  return b ? b.mine : null;
}

/** A campaign battle's model as its panel shows it: at the end, Continue Campaign in place of Play again, and no New seed. */
export function dressCampaign(m: GameModel): GameModel {
  if (!m.controls.some(c => c.id === 'again' || c.id === 'reseed')) return m;
  return { ...m, controls: m.controls.filter(c => c.id !== 'reseed').map(c => (c.id === 'again' ? { ...c, label: BATTLE_WORDS.onward } : c)) };
}

/**
 * The one way on from a campaign battle's end: to the campaign's room (between battles, or the campaign's end). The
 * end panel's Continue Campaign calls it; the rewards screen shown after every battle will call it when it lands.
 */
export function continueCampaign(): void {
  // The page's address, named by its shape: this module is also type-checked where the browser's own types are not known
  // (tests/campaign/battle-id.test.ts reads `saveIdOf` from it).
  (globalThis as { location?: { assign(to: string): void } }).location?.assign(ROOM_ADDRESS);
}
