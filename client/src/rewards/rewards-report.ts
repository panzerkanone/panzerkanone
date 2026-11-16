/**
 * A battle's report for the rewards, read off the game's own record (its ruleset and its last view) for the one person
 * playing here: plain reading, with no page in it (rewards-end.ts, which the game's page calls, counts the report into
 * the service record and goes on to the rewards screen).
 *
 * Only a battle with one person playing here has rewards: against the computer, and online for the player's own seat.
 * Two people at one table, or the computer on both sides, keep the game's end as it is.
 */
import type { ImpulseRuleset } from '../../../engine/rulesets/impulse/rules';
import type { ImpulseView } from '../../../engine/rulesets/impulse/types';
import { campaignById } from '../campaign/content';
import { localCampaignStore, readKept } from '../campaign/keep';
import { ImpulseHost } from '../game/local-impulse';
import type { BattleReport, EndReason, Opponent, ServiceSide } from '../shell/rewards-rules';
import { WORDS } from '../shell/words';

/** What the game's page knows at a battle's end. */
export interface EndOfBattle {
  readonly ruleset: ImpulseRuleset;
  readonly view: ImpulseView;
  /** The seat index of the one person playing here. */
  readonly mine: number;
  /** The battle's own id: the same battle's end told twice has the same id. */
  readonly id: string;
  /** The computer's level the battle was played at; null online. */
  readonly level: string | null;
  readonly online: boolean;
  /** The game's own end line, as its panel shows it (the model's result headline). */
  readonly said: string | null;
}

/** A game online, as far as its end is read here (client/src/net/online.ts, OnlineGame): the link's seat, the rules, and the seat's view. */
export interface RemoteEnd {
  readonly seat: string;
  readonly ruleset: ImpulseRuleset;
  readonly port: { view(): ImpulseView };
}

/**
 * The end of the battle in hand, as the page has it: a local game of the real rules with one person in it (the host's
 * own record), or a game online (the seat's view). Null when it has no rewards.
 */
export function endOfBattle(o: { host: unknown; remote: RemoteEnd | null; params: URLSearchParams; saveId: string | null; seed: number; hash: string | null; level: string | null; said: string | null }): EndOfBattle | null {
  if (o.remote) {
    const seat = o.remote.seat;
    const mine = o.remote.ruleset.seats.indexOf(seat);
    if (mine < 0) return null;
    return { ruleset: o.remote.ruleset, view: o.remote.port.view(), mine, id: `online-${o.params.get('match') ?? 'match'}-${seat}`, level: null, online: true, said: o.said };
  }
  if (!(o.host instanceof ImpulseHost)) return null;
  const people = o.host.players.flatMap((p, i) => (p === 'person' ? [i] : []));
  if (people.length !== 1) return null;
  return { ruleset: o.host.ruleset, view: o.host.port(null).view(), mine: people[0] as number, id: `local-${o.saveId ?? 'unkept'}-${o.seed}-${o.hash ?? 'nohash'}`, level: o.level, online: false, said: o.said };
}

/** The side a scenario's seat fights for, by the mark its briefing gives it, else by its id. */
function sideOf(ruleset: ImpulseRuleset, seat: number): ServiceSide | null {
  const mark = ruleset.scenario.briefing?.sides[seat]?.mark;
  if (mark === 'cross') return 'german';
  if (mark === 'hammer-sickle') return 'soviet';
  const id = ruleset.scenario.sides[seat]?.id ?? '';
  return id.includes('german') ? 'german' : id.includes('soviet') ? 'soviet' : null;
}

const LEVELS: readonly string[] = ['easy', 'normal', 'hard'];

/** A campaign battle's part of the report, from the kept campaign as its end settled it. */
function campaignPart(params: URLSearchParams): BattleReport['campaign'] {
  const id = params.get('campaign');
  if (!id) return null;
  const c = campaignById(id);
  const { record } = readKept(localCampaignStore(), x => campaignById(x)?.data ?? null);
  const last = record && record.campaign === id ? record.fought[record.fought.length - 1] : undefined;
  if (!c || !last) return null;
  return { id, title: c.data.title, points: last.points, result: WORDS.campaign.results[last.result] };
}

/** The address that plays the same battle again, fresh: the game's address (at `path`) without its kept game (single battles only). */
function againOf(params: URLSearchParams, online: boolean, path: string): string | null {
  if (online || params.has('campaign')) return null;
  const q = new URLSearchParams(params);
  q.delete('save');
  return `${path}?${q.toString()}`;
}

/**
 * The battle's report, read off its ruleset and its last view; `path` is the game's page's own (for the address that
 * plays the battle again). Null when the battle is not over or its side is unknown.
 */
export function reportOf(end: EndOfBattle, params: URLSearchParams, path: string): BattleReport | null {
  const { ruleset, view, mine } = end;
  const result = view.result;
  const side = sideOf(ruleset, mine);
  if (!result || !side) return null;
  const other = 1 - mine;
  const of = (s: number): BattleReport['own'] => {
    const units = ruleset.unitInfo.filter(u => u.side === s);
    const st = view.sides[s];
    return { destroyed: units.filter(u => view.units[u.index]?.destroyed === true).length, units: units.length, points: st?.lost ?? 0, start: st?.startCost ?? 0 };
  };
  const level = end.level !== null && LEVELS.includes(end.level) ? (end.level as Opponent) : 'normal';
  return {
    id: end.id,
    side,
    title: ruleset.scenario.briefing?.title ?? ruleset.scenario.name,
    level: ruleset.scenario.level ?? null,
    won: result.winner === mine,
    reason: result.reason as EndReason,
    said: end.said,
    scores: [view.sides[mine]?.score ?? 0, view.sides[other]?.score ?? 0],
    turn: view.turn,
    lastTurn: ruleset.lastTurn,
    enemy: of(other),
    own: of(mine),
    held: view.holders.filter(h => h === mine).length,
    objectives: view.holders.length,
    // Taken: held at the end, and not this side's own at the start (the scenario says who held each at the start).
    taken: view.holders.filter((h, k) => h === mine && ruleset.scenario.objectives[k]?.holder !== ruleset.seats[mine]).length,
    opponent: end.online ? null : level,
    online: end.online,
    campaign: campaignPart(params),
    scenario: params.get('scenario'),
    again: againOf(params, end.online, path),
  };
}
