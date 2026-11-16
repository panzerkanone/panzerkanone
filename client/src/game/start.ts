/**
 * What a page calls to put a game on its board: startGame({ pieces, panel,
 * params }). It loads the content (a ruleset, its scenario, a board), makes
 * the local host, the game and the panel, listens to the keys, and starts
 * again on "play again" and "new seed". The bench page (bench.ts) calls it
 * with the flat pieces; the table page will call it with the cardboard ones.
 *
 * The address:
 *   (nothing)    the real rules (Formation Impulse, docs/rules/rules-v1.md, with the whole side
 *                moving: the only way this page plays them) on the scenario the game opens with,
 *                "Holtargard, July 1943": a German and a Soviet force of the roster's units
 *   scenario=<id>   the real rules on that scenario of the game's list (scenarios.ts), on its own
 *                board; an id the list does not have plays the opening scenario
 *   level=<level>   with scenario=: the level it is played at (patrol, skirmish, battle or offensive);
 *                left out, or one the battle does not have: its Battle level, or its only one
 *   scenario=crossroads   the real rules on their own test scenario, with placeholder unit types
 *   rules=reference       the small reference ruleset and its scenario
 *   deploy=free  (the real rules) play begins with a free deployment: each side places its own units
 *   seed=<n>     the game's seed, a whole number from 0 to 4294967295 (default 1)
 *   sides=...    human (or hotseat): two people at the one table; computer (or watch): the
 *                computer plays both; second: the person plays the second side; anything
 *                else: the person plays the first side against the computer
 *   ai=...       the computer's level: easy, normal or hard; normal when left out
 *   gap=<ms>     the pause between the computer's actions (default 330)
 *   fast=1       start with the fast switch on
 *   brief=0      do not lay the scenario's briefing open before the first turn (it stays behind its button)
 *   match=, side=, key= (and server=)   play one seat of a game online, the seat that link holds
 *                (client/src/net/address.ts); `sides=` and `seed=` then say nothing
 *   save=<id>    the battle kept in the browser under this id (keep.ts): written in by the page itself when a
 *                game with a person in it begins here (not online, where the server holds the game), so that a
 *                reload, or the tab opened again, brings the battle back where it was. An address without it (the
 *                side selector's) begins a new battle, under a new id.
 *   campaign=<id>   with scenario= and save=: the kept campaign's battle in progress, its scenario drawn from the
 *                campaign's force (client/src/campaign/battle.ts); any other such address goes to the campaign's room
 *
 * A battle kept (keep.ts) is brought back with its own choices (the computer's level too: the settings may have
 * written another into the address, for the next game), its briefing not laid open again, and the table's view where
 * it was. One that cannot be brought back is dropped, and the box of words says so in its answer line. The menu's
 * Main menu asks before it ends a battle (leave.ts): End battle drops the kept game and goes to the title.
 *
 * The keys. This page hears a key before the board's page does (it listens on the way down, the
 * table on the way up, and the table leaves alone a key that was used). The panel first (keys.ts:
 * I or F1, J, A, W, S, and Escape while something lies over the board), then the game: Tab and
 * Shift+Tab, Enter, Escape, E, N, F, and under the real rules the key printed on each control
 * (C, V, M, U, T, K, X, G, H, Q, Backspace) and the digits 1 to 9, which go to the viewer's groups.
 * Shift, Ctrl or Cmd held while one of the player's own units is clicked adds it to those that will
 * act together (keys.ts, `addHeld`): the table's pieces report a click without its keys, so this
 * file reads the three from the window (the keys, and each press of the pointer) and tells the
 * game. Alt is not one of them: it is the table's own.
 *
 * window.__game publishes what scripts read: the seed, the model, whether
 * input is held, a promise of the next pause, and the same key, control and
 * panel entry points a person has. window.__panel says what the player has open.
 */
import treesMapText from '../../../assets/maps/test_standard_trees.map.yaml?raw';
import rulesetText from '../../../content/rulesets/reference.ruleset.yaml?raw';
import v1RulesText from '../../../content/rulesets/v1.ruleset.yaml?raw';
import treesScenarioText from '../../../content/scenarios/reference_trees.scenario.yaml?raw';
import crossroadsTreesText from '../../../content/scenarios/crossroads_trees.scenario.yaml?raw';
import crossroadsTreesFreeText from '../../../content/scenarios/crossroads_trees_free.scenario.yaml?raw';
import rosterUnitsText from '../../../content/units/v1.units.yaml?raw';
import v1RuleBookText from '../../../content/rulebooks/v1.rulebook.yaml?raw';
import placeholderUnitsText from '../../../content/units/placeholder.units.yaml?raw';
import type { AttackQuery, RefAction, RefEvent, RefView } from '@engine/rulesets/reference/types';
import type { ImpulseAction, ImpulseEvent, ImpulseView, OutcomeQuery } from '@engine/rulesets/impulse/types';
import { Game } from './game';
import type { GameDeps } from './game';
import type { MatchHost } from './host';
import { mountHud } from './hud';
import type { MapControls, MusicControls, PanelSkin, PanelState, UnitPicture } from './hud';
import { Keeper, bringBack, browserStore, choicesFrom, keptIdFor, newKeptId, pinsOf } from './keep';
import type { BroughtBack, Choices, KeptHost, KeptView, RestoreHost } from './keep';
import { addHeld } from './keys';
import { LEAVE_WORDS } from './leave';
import { LocalHost, playersFrom, seedFrom } from './local';
import { ImpulseHost } from './local-impulse';
import type { GameModel } from './model';
import type { PiecesPort } from './pieces-port';
import { DEFAULT_PACE } from './playback';
import type { Clock, Pace } from './playback';
import { scenarioPicture, scenarioTexts } from './scenarios';
import { setBoardSeason } from './inks';
import { parseMap, seasonOf } from '../../../engine/core/map';
import { onlineFrom } from '../net/address';
import { openOnline } from '../net/online';
import type { OnlineGame } from '../net/online';
import { VERSION } from '../version';
import { campaignBattle, campaignSide, continueCampaign, dressCampaign, endOfGame, isCampaignBattle, settleCampaignBattle } from '../campaign/battle';
import type { CampaignPlay } from '../campaign/battle';
import { endOfBattle, rewardsHandOff } from '../rewards/rewards-end';

interface TextFile { file: string; text: string }

/**
 * The board a game is played on, with the scenarios that may be played on it. The rules' own test
 * scenarios are written for the standard board with its woods placed as tree sides (the same board
 * with woods as hexes is still in the repository for the engine's tests, and not reached from here).
 * A scenario of the game's list brings its own board (scenarios.ts).
 */
interface Board {
  map: TextFile;
  /** The reference ruleset's scenario on the standard board. */
  scenario: TextFile;
  /** Formation Impulse's test scenario on the standard board (placeholder unit types): as set up, and with a free deployment. */
  crossroads: TextFile;
  crossroadsFree: TextFile;
  /** The scenario of the game's list that is played, with the roster's units: as set up, and with a free deployment (the same text where it has no such form). */
  listed: TextFile;
  listedFree: TextFile;
}
/** True when the address asks for one of the rules' own test scenarios, which are not in the game's list. */
function testScenario(params: URLSearchParams): boolean {
  return params.get('rules') === 'reference' || params.get('scenario') === 'crossroads';
}
function boardFrom(params: URLSearchParams, drawn: TextFile | null = null): Board {
  // The scenario the address names (`scenario=<id>`), or the one the game opens with; a campaign battle's is drawn from its force.
  const chosen = scenarioTexts(params.get('scenario'), params.get('level'));
  if (drawn) {
    return {
      map: chosen.map,
      scenario: { file: 'content/scenarios/reference_trees.scenario.yaml', text: treesScenarioText },
      crossroads: { file: 'content/scenarios/crossroads_trees.scenario.yaml', text: crossroadsTreesText },
      crossroadsFree: { file: 'content/scenarios/crossroads_trees_free.scenario.yaml', text: crossroadsTreesFreeText },
      listed: drawn,
      listedFree: drawn,
    };
  }
  return {
    // A scenario of the list is played on its own board; a test scenario on the standard board.
    map: testScenario(params) ? { file: 'assets/maps/test_standard_trees.map.yaml', text: treesMapText } : chosen.map,
    scenario: { file: 'content/scenarios/reference_trees.scenario.yaml', text: treesScenarioText },
    crossroads: { file: 'content/scenarios/crossroads_trees.scenario.yaml', text: crossroadsTreesText },
    crossroadsFree: { file: 'content/scenarios/crossroads_trees_free.scenario.yaml', text: crossroadsTreesFreeText },
    listed: chosen.scenario,
    listedFree: chosen.free ?? chosen.scenario,
  };
}

/** The page's skin, with a scenario's picture looked for in the library (scenarios.ts) first and among the skin's own after. */
function withScenarioPictures(skin: PanelSkin): PanelSkin {
  return { css: skin.css, mark: (id, where) => skin.mark(id, where), picture: id => scenarioPicture(id) ?? skin.picture(id) };
}

/** The text of the board the game is played on, for a page that draws it. */
export function boardTextFrom(params: URLSearchParams): string {
  return boardFrom(params).map.text;
}

/** True when the address asks for the real rules: a page then leaves room for their second row of controls and their strip of groups. */
export function fullRules(params: URLSearchParams): boolean {
  return params.get('rules') !== 'reference';
}

/** A game of either ruleset, as a page uses it: none of these members names a ruleset's types. */
export type AnyGame = Pick<Game<unknown, unknown, unknown, unknown>, 'model' | 'held' | 'seat' | 'settled' | 'key' | 'press' | 'take' | 'pick' | 'click' | 'hover' | 'shift' | 'onModel' | 'start' | 'dispose'>;
export type RefGame = Game<RefView, RefAction, RefEvent, AttackQuery>;
/** A local host of either ruleset, as a page uses it. */
export type AnyHost = Pick<MatchHost<unknown, unknown, { type: string }, unknown, unknown>, 'seed' | 'players' | 'problems' | 'advance' | 'computerDue'>;

export interface GameHook {
  readonly seed: number;
  readonly held: boolean;
  model(): GameModel;
  settled(): Promise<void>;
  key(key: string, shift?: boolean): void;
  press(id: string): void;
  /** A click in the panel on a unit waiting in the tray ('unit'), or a press of a group's button ('group': it goes to the group). */
  take(kind: 'unit' | 'group', id: string): void;
  /** A unit picked in a list (a chip of the folder): it is chosen and gone to. */
  pick(unit: string): void;
  /** Everything reported: rejections and faults. Empty when all is well. */
  readonly reports: readonly string[];
  /** The hash of the game's state now (a game played here; null for one played online, whose state the server holds). */
  hash(): string | null;
  /** What came of looking for a kept battle as this game began, and what is kept of it now (null: nothing is kept for it). */
  readonly back: 'new' | 'restored' | 'dropped' | 'online' | 'unkept';
  kept(): { readonly id: string; readonly actions: number; readonly open: boolean } | null;
}

/** A battle's title, for the scenario list's offer to continue it: a listed battle's own; the rules' test scenarios by name. */
function titleOf(params: URLSearchParams): string {
  if (params.get('rules') === 'reference') return 'The reference rules’ test game';
  if (params.get('scenario') === 'crossroads') return 'Crossroads (test scenario)';
  return scenarioTexts(params.get('scenario'), params.get('level')).entry.title;
}

/** The table's own reading of its view and its way of setting one (scene/hook.ts), where the page has the table. */
interface TableView {
  readonly view?: KeptView;
  setView?(v: { centre?: [number, number]; hexesAcross?: number; mode?: 'play' | 'overview' }): unknown;
}
function tableView(): TableView | null {
  return (window as unknown as { __table?: TableView }).__table ?? null;
}
/** Where the table's view is now, as a kept battle holds it; null where there is no table. */
function viewNow(): KeptView | null {
  const v = tableView()?.view;
  if (!v || (v.mode !== 'play' && v.mode !== 'overview')) return null;
  return { mode: v.mode, centre: [v.centre[0], v.centre[1]], hexesAcross: v.hexesAcross };
}

declare global {
  interface Window {
    __game?: GameHook;
    /**
     * What the player has open in the panel; every press the panel passed on to the game, in order (a control's id,
     * or "group:<id>" / "unit:<id>"), whether or not the control was possible; and, for a script that must show a
     * state no play reaches (a fault's line), `draw`: the panel drawn from a model the script gives, until the game's
     * next model.
     */
    __panel?: { state(): PanelState; readonly presses: readonly string[]; draw(model: GameModel): void };
  }
}

export interface Session {
  readonly pace: Pace;
  game(): AnyGame;
  host(): AnyHost;
  /** Throw the game away and start another with this seed. */
  restart(seed: number): void;
  dispose(): void;
}

const clock: Clock = {
  wait: ms => new Promise<void>(resolve => {
    if (ms <= 0) queueMicrotask(resolve);
    else setTimeout(resolve, ms);
  }),
};

export function startGame(opts: {
  pieces: PiecesPort;
  panel: HTMLElement;
  params: URLSearchParams;
  art?: (type: string) => UnitPicture | null;
  /** The short name a unit type's counter prints in its title band, when the page has one. */
  label?: (type: string) => string | null;
  /** The panel's dressed look, when the page has one; without it the panel is its grey-box. */
  skin?: PanelSkin;
  /** The controls and keys of the page's own board, for the panel's map pop-out and its list of keys. */
  map?: MapControls;
  /** The music, when the page has a player. */
  music?: MusicControls;
  /** Told when the game shows something a page may want to put a sound to: so far a roll of the dice, once for each roll. */
  heard?: (what: 'dice') => void;
}): Session {
  const { pieces, panel, params } = opts;
  const gap = Number(params.get('gap'));
  const pace: Pace = { ...DEFAULT_PACE, fast: params.get('fast') === '1', ...(params.has('gap') && Number.isFinite(gap) && gap >= 0 ? { gapMs: gap } : {}) };
  const reports: string[] = [];
  // A campaign battle plays the scenario drawn from the kept campaign's force; one that is not the kept battle in progress goes to the campaign's room.
  const campaign: CampaignPlay | null = isCampaignBattle(params) ? campaignBattle(params) : null;
  if (campaign && 'away' in campaign) {
    window.location.replace(campaign.away);
    return { pace, game: () => { throw new Error('no game: going to the campaign'); }, host: () => { throw new Error('no game: going to the campaign'); }, restart: () => undefined, dispose: () => undefined };
  }
  const campaignMine = campaign ? campaignSide(campaign) : null;
  /** The campaign battle's end has been settled into the kept campaign. */
  let campaignSettled = false;
  const board = boardFrom(params, campaign && 'scenario' in campaign ? campaign.scenario : null);
  const full = fullRules(params);
  // The panel's inks follow the season the board is printed for (a winter board: winter's, by the bake's own transform).
  const printed = parseMap(board.map.text).map;
  setBoardSeason(printed ? seasonOf(printed) : 'summer');

  let host: AnyHost;
  let game: AnyGame;
  /** A game played online (`match=`, `side=`, `key=` in the address: client/src/net). */
  let remote: OnlineGame | null = null;
  /** The briefing shown before the first turn has been put away (or there was none): the computer's seats may play. */
  let begun = false;
  /** The game in hand has been started. */
  let started = false;
  /** The hash of the state of the game in hand, when it is played here. */
  let stateHash: () => string | null = () => null;

  // ---- keeping the battle (keep.ts) ----
  const store = browserStore();
  /**
   * The id the battle is kept under: the address's, or a new one written into it (so that a reload finds it). None for
   * a game online (the server holds it), for one the computer plays on both sides, and where the browser keeps nothing.
   */
  const saveId = ((): string | null => {
    const id = keptIdFor({
      save: params.get('save'), online: full && onlineFrom(params) !== null, players: playersFrom(params.get('sides'), 2), store,
      newId: () => (store ? newKeptId(store, choicesFrom(params, seedFrom)) : ''),
    });
    if (id === null) return null;
    if (params.get('save') !== id) {
      params.set('save', id);
      const address = new URL(window.location.href);
      address.searchParams.set('save', id);
      window.history.replaceState(window.history.state, '', address);
    }
    return id;
  })();
  let keeper: Keeper | null = null;
  /** What came of looking for a kept battle as the game in hand began. */
  let back: GameHook['back'] = 'unkept';
  /** The kept battle came back, its briefing already put away: it is not laid open again. */
  let backBegun = false;
  /** The table's view as the kept battle had it, to give back when the board is first framed. */
  let backView: KeptView | null = null;

  const presses: string[] = [];
  const hud = mountHud(panel, {
    press: id => {
      presses.push(id);
      game.press(id);
    },
    take: (kind, id) => {
      presses.push(`${kind}:${id}`);
      game.take(kind, id);
    },
    // A unit picked in a list is a click on its counter, and the board goes to it.
    pick: unit => {
      presses.push(`pick:${unit}`);
      game.pick(unit);
    },
    // (Read at the game's first model, once the kept battle has been looked for.)
    get briefFirst() {
      return params.get('brief') !== '0' && !backBegun;
    },
    begin: () => {
      begun = true;
      keeper?.begun();
      if (started && !game.held) host.advance();
    },
    // Main menu asks first (leave.ts); a battle that is over has nothing to ask. End battle drops the kept game.
    leave: {
      ask: () => (game.model.result !== null ? null : remote ? LEAVE_WORDS.online : LEAVE_WORDS.local),
      go: () => {
        keeper?.end();
        window.location.assign(window.location.pathname);
      },
    },
    ...(opts.art ? { art: opts.art } : {}),
    ...(opts.skin ? { skin: withScenarioPictures(opts.skin) } : {}),
    ...(opts.map ? { map: opts.map } : {}),
    ...(opts.music ? { music: opts.music } : {}),
  });
  window.__panel = { state: () => hud.state(), presses, draw: m => hud.draw(m) };
  // A battle's end goes on to its rewards (client/src/rewards/rewards-end.ts); the computer's level it was played at.
  const rewards = rewardsHandOff({ panel, params });
  let playedAt: string | null = null;

  /** What every game is given besides its ruleset's own reading and ports. */
  const shared = (seed: number, mine: AnyHost): Pick<GameDeps<unknown, unknown, unknown, unknown>, 'pieces' | 'clock' | 'pace' | 'seed' | 'caughtUp' | 'restart' | 'report' | 'goTo'> => ({
    pieces,
    clock,
    pace,
    seed,
    // The board's own way of bringing hexes into view, when the page's board has one (a board without it stays where it is).
    goTo: hexes => opts.map?.goTo?.(hexes),
    caughtUp: () => {
      // Nothing is played behind the briefing: the computer's seats wait until it is put away.
      if (host === mine && begun) mine.advance();
    },
    // A campaign battle is not played again: its end's one way on is the campaign (Continue Campaign).
    restart: how => (rewards.go() ? undefined : campaign ? (how === 'again' ? continueCampaign() : undefined) : restart(how === 'again' ? seed : seed >= 0xffffffff ? 0 : seed + 1)),
    report: message => {
      reports.push(message);
      console.error(`[game] ${message}`);
    },
  });

  /**
   * Keep the battle on a host just made (`mine`) as it is played, after looking for it (`found`): a new game drops
   * every other kept battle; one brought back keeps on in its own key.
   */
  const keepOn = (mine: KeptHost & RestoreHost, found: BroughtBack<unknown>, how: 'load' | 'restart', choices: Choices): void => {
    keeper?.detach();
    keeper = null;
    back = found.kind;
    backBegun = found.kind === 'restored' && found.record.begun;
    backView = found.kind === 'restored' ? found.record.view : null;
    if (found.kind === 'dropped') console.warn(`[game] the kept battle was dropped: ${found.why}`);
    const pins = pinsOf(mine);
    if (saveId === null || store === null || pins === null) return;
    keeper = new Keeper({
      store,
      id: saveId,
      // The choices the game is played with: a kept battle's own (the computer's level as it was).
      choices: found.kind === 'restored' ? found.record.choices : choices,
      title: titleOf(params),
      pins,
      version: VERSION,
      address: () => `${window.location.pathname}${window.location.search}`,
      view: viewNow,
      failed: why => console.warn(`[game] the browser keeps no more of this battle: ${why}`),
    }, mine, { fresh: found.kind !== 'restored', begun: how === 'restart' || backBegun });
  };

  const begin = (seed: number, how: 'load' | 'restart'): void => {
    const players = playersFrom(params.get('sides'), 2);
    const texts = {
      // The scenario of the game's list that the address names, or the one the game opens with; `scenario=crossroads` is the ruleset's own test scenario.
      scenario: params.get('scenario') === 'crossroads'
        ? (params.get('deploy') === 'free' ? board.crossroadsFree : board.crossroads)
        : (params.get('deploy') === 'free' ? board.listedFree : board.listed),
      rules: { file: 'content/rulesets/v1.ruleset.yaml', text: v1RulesText },
      units: params.get('scenario') === 'crossroads'
        ? { file: 'content/units/placeholder.units.yaml', text: placeholderUnitsText }
        : { file: 'content/units/v1.units.yaml', text: rosterUnitsText },
      map: board.map,
    };
    const online = full ? onlineFrom(params) : null;
    /** The choices of the battle asked for: the address's, with the seed it begins on. */
    const choices: Choices = { ...choicesFrom(params, seedFrom), seed };
    /** A kept battle for the address, brought back on a host made by `make`; on a restart, or where nothing is kept, a new game. */
    const look = <H extends RestoreHost>(make: (ai: string | null) => H): BroughtBack<H> =>
      saveId !== null && how === 'load' ? bringBack({ store, id: saveId, choices, version: VERSION, make }) : { kind: 'new', host: make(choices.ai) };
    if (online) {
      // Online: the one person here plays the seat the link holds; the other seat is a person somewhere else.
      const net = openOnline({ seat: online, texts, rulebook: { file: 'content/rulebooks/v1.rulebook.yaml', text: v1RuleBookText }, ...(opts.label ? { label: opts.label } : {}) });
      remote = net;
      host = net.host;
      back = 'online';
      stateHash = () => null;
      game = new Game<ImpulseView, ImpulseAction, ImpulseEvent, OutcomeQuery>({
        reading: net.reading, people: [net.port], spectator: net.port, computer: [], ...shared(seed, net.host),
        // An online game is not played again from here: "play again" goes to the title (to the rewards, when it has them).
        restart: () => (rewards.go() ? undefined : window.location.assign(window.location.pathname)),
      });
      net.onChange(() => hud.draw(rewards.dress(net.dress(game.model))));
    } else if (full) {
      const found = look(ai => new ImpulseHost({
        texts,
        seed,
        players,
        // The computer's level: ai=easy, ai=normal or ai=hard in the address (a kept battle's own); normal when it says nothing.
        level: ai,
        rulebook: { file: 'content/rulebooks/v1.rulebook.yaml', text: v1RuleBookText },
        ...(opts.label ? { label: opts.label } : {}),
      }));
      const mine = found.host;
      keepOn(mine, found, how, choices);
      playedAt = found.kind === 'restored' ? found.record.choices.ai : choices.ai;
      const seats = mine.ruleset.seats;
      host = mine;
      stateHash = () => mine.hash;
      game = new Game<ImpulseView, ImpulseAction, ImpulseEvent, OutcomeQuery>({
        reading: mine.reading,
        people: seats.filter((_, i) => mine.players[i] === 'person').map(s => mine.port(s)),
        spectator: mine.port(null),
        computer: seats.filter((_, i) => mine.players[i] === 'computer'),
        ...shared(seed, mine),
        ...(found.kind === 'dropped' ? { notice: found.notice } : {}),
      });
    } else {
      const found = look(() => new LocalHost({
        texts: { scenario: board.scenario, ruleset: { file: 'content/rulesets/reference.ruleset.yaml', text: rulesetText }, map: board.map },
        seed,
        players,
      }));
      const mine = found.host;
      keepOn(mine, found, how, choices);
      const seats = mine.ruleset.seats;
      host = mine;
      stateHash = () => mine.hash;
      game = new Game<RefView, RefAction, RefEvent, AttackQuery>({
        reading: mine.reading,
        people: seats.filter((_, i) => mine.players[i] === 'person').map(s => mine.port(s)),
        spectator: mine.port(null),
        computer: seats.filter((_, i) => mine.players[i] === 'computer'),
        ...shared(seed, mine),
        ...(found.kind === 'dropped' ? { notice: found.notice } : {}),
      });
    }
    const now = game;
    started = false;
    // A roll is told to the page once, when its dice are first shown thrown (a certain result throws none).
    let rollHeard = -1;
    // The board is asked once, as the game's counters first lie on it, to open on them; a battle brought back, where
    // its view was (where the page's board can say).
    let framed = false;
    const view = backView;
    now.onModel(m => {
      // A campaign battle's end is settled into the kept campaign once, before its end is shown.
      if (campaignMine !== null && !campaignSettled && m.mode === 'over' && host instanceof ImpulseHost) {
        const end = endOfGame(host.ruleset, host.port(null).view(), campaignMine);
        if (end) {
          campaignSettled = true;
          settleCampaignBattle(params, end);
        }
      }
      if (m.mode === 'over') rewards.over(() => endOfBattle({ host, remote, params, saveId, seed, hash: stateHash(), level: playedAt, said: m.result?.headline ?? null }));
      hud.draw(rewards.dress(remote ? remote.dress(m) : campaign ? dressCampaign(m) : m));
      if (!framed && m.counters.length > 0) {
        framed = true;
        opts.map?.frame?.(m.counters.map(c => c.hex));
        if (view !== null) tableView()?.setView?.({ mode: view.mode, centre: [view.centre[0], view.centre[1]], hexesAcross: view.hexesAcross });
      }
      const d = m.dice;
      if (opts.heard && d !== null && d.rolled && d.faces.length > 0 && d.serial !== rollHeard) {
        rollHeard = d.serial;
        opts.heard('dice');
      }
    });
    now.start();
    started = true;
    window.__game = {
      seed,
      get held() {
        return now.held;
      },
      model: () => now.model,
      settled: () => now.settled(),
      key: (key, shift) => {
        now.key(key, shift === true);
      },
      press: id => now.press(id),
      take: (kind, id) => now.take(kind, id),
      pick: unit => now.pick(unit),
      reports,
      hash: () => stateHash(),
      back,
      kept: () => keeper?.kept ?? null,
    };
  };

  // "Play again" and "New seed": the battle in hand is thrown away and another begins, kept in its place.
  const restart = (seed: number): void => {
    game.dispose();
    const address = new URL(window.location.href);
    address.searchParams.set('seed', String(seed));
    window.history.replaceState(null, '', address);
    begin(seed, 'restart');
  };

  // The battle is written once more as the page is hidden or put away (a reload, the tab closed): the view with it.
  const onHide = (): void => keeper?.flush();
  const onVisible = (): void => {
    if (document.visibilityState === 'hidden') keeper?.flush();
  };
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onVisible);

  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    // The panel first (its own keys; every key while a full panel covers the board), then the game.
    if (hud.key(e.key) || game.key(e.key, e.shiftKey)) e.preventDefault();
  };
  // On the way down: before the listeners of the page under the panel (the table's), which leave alone a key that was used.
  window.addEventListener('keydown', onKey, true);
  // The adding modifier (Shift, Ctrl or Cmd), as every key and every press of the pointer says it stands: before the table hears of the click (capture).
  const onShift = (e: KeyboardEvent | PointerEvent): void => game.shift(addHeld(e));
  const offShift = (): void => game.shift(false);
  window.addEventListener('keydown', onShift, true);
  window.addEventListener('keyup', onShift, true);
  window.addEventListener('pointerdown', onShift, true);
  window.addEventListener('pointerup', onShift, true);
  window.addEventListener('blur', offShift);

  begin(seedFrom(params.get('seed')), 'load');

  return {
    pace,
    game: () => game,
    host: () => host,
    restart,
    dispose(): void {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisible);
      keeper?.detach();
      rewards.dispose();
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keydown', onShift, true);
      window.removeEventListener('keyup', onShift, true);
      window.removeEventListener('pointerdown', onShift, true);
      window.removeEventListener('pointerup', onShift, true);
      window.removeEventListener('blur', offShift);
      game.dispose();
      remote?.dispose();
      hud.dispose();
      delete window.__game;
      delete window.__panel;
    },
  };
}
