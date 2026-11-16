/**
 * The presentation model: plain data a board and a panel draw from, with no
 * knowledge of any rule. The game (game.ts) makes a new one whenever anything
 * shown changes; the panel (hud.ts) draws it, and the game pushes its board
 * part (counters, marks, tints, lines) to the table's pieces.
 *
 * Everything in it comes from the seat's view as last shown, the seat's legal
 * actions, the outcome list of an attack being considered, and the events
 * played so far: it never holds what the seat's view does not.
 */
import { labelOf } from '../../../engine/core/hex';
import type { ChanceLabel } from './chances';
import type { CounterFace, IntentAct } from './pieces-port';
import type { BriefForce, Briefing, Figure, GameInfo, Guide, Position, RuleBook, UnitCard } from './reading';

export interface Marks {
  readonly selected: boolean;
  readonly canAct: boolean;
  readonly spent: boolean;
  readonly suppressed: boolean;
  readonly target: boolean;
}

/** More about a counter than its marks (the pieces' optional `note`): all of it from the reading. */
export interface Notes {
  /** Characters to print on the counter for its group: always '' (a counter carries no group's number: groups change as units move). */
  readonly group: string;
  /** It is of the group in hand: the group the viewer last went to, or whose unit was last chosen. The table lights it. */
  readonly active: boolean;
  /** The counter that carries it, or null. */
  readonly carriedBy: string | null;
  /** It may be fired at though its ground would hide it. */
  readonly revealed: boolean;
  /** A click on it would choose it (one of the viewer's own). */
  readonly pick: boolean;
  /** It has moved this turn and can still do one thing more (fire, or a charge, or a move on): the table marks it. */
  readonly moved: boolean;
  /**
   * A click on it now would attack it at close quarters (a charge, or a drive through its hex), not by fire:
   * the table makes it glow red (the owner, 2026-11-14: "show the unit that can be close attacked as red glow").
   */
  readonly close: boolean;
}

export interface CounterModel {
  readonly id: string;
  /** The seat it belongs to. */
  readonly side: string;
  readonly hex: number;
  /** Its place in its hex's stack, counted from the bottom. */
  readonly place: number;
  readonly face: CounterFace;
  readonly marks: Marks;
  readonly notes: Notes;
}

/** Fire a move would draw, or is drawing: a line from the firer's hex to the hex fired at. */
export interface ThreatModel {
  readonly by: string;
  readonly on: string;
  readonly from: number;
  readonly to: number;
  /** The chance of any effect, "58%": what is printed beside the line. */
  readonly label: string;
  /** The exact chances: the ways (of `of`) of any effect and of destroying. */
  readonly ways: number;
  readonly kill: number;
  readonly of: number;
  /** It is being fired now (the play-back), not only foreseen. */
  readonly live: boolean;
}

export interface MarkerModel {
  readonly hex: number;
  readonly kind: 'screen' | 'incoming';
  readonly label: string;
  readonly side: string | null;
  readonly stock: Stock | null;
}

/**
 * A group of the units shown that stand near one another, for the panel's row of groups and its folder. A group is a
 * way to find units and nothing more: going to one chooses nothing, and any unit is chosen whatever its group.
 */
export interface GroupModel {
  readonly id: string;
  /** "Group 2" */
  readonly name: string;
  /** Its number among its side's groups, from 1. */
  readonly number: number;
  /** The key that goes to it: its number as a digit, or '' for a group past the ninth (it has a button and no key). */
  readonly key: string;
  readonly side: string;
  readonly stock: Stock | null;
  /** How many units it has, and how many of them could act now. */
  readonly units: number;
  readonly able: number;
  /** It is the group in hand: its counters are lit on the board. */
  readonly inHand: boolean;
  /** A press of it does something. */
  readonly enabled: boolean;
  /** Its units, in the scenario's order. */
  readonly members: readonly MemberModel[];
}

/** One unit of a group, for a list of the group's units. */
export interface MemberModel {
  readonly id: string;
  readonly name: string;
  /** What tells it from the others of its kind ("1a"), and its counter's short title. */
  readonly tag: string;
  readonly title: string;
  readonly selected: boolean;
  readonly canAct: boolean;
  readonly spent: boolean;
  /** It has moved this turn and can still do one thing more: neither as it was before it acted, nor spent. */
  readonly moved: boolean;
  readonly suppressed: boolean;
  /** It has left play. */
  readonly lost: boolean;
  /** It is on the board (or carried), so a click on its counter can be made for it. */
  readonly onBoard: boolean;
}

/** A unit waiting to be placed (set-up by hand), for the panel's tray. */
export interface TrayModel {
  readonly id: string;
  readonly name: string;
  readonly stock: Stock;
  readonly face: CounterFace;
  readonly selected: boolean;
}

export type TintKind = 'reach' | 'target' | 'path' | 'objective' | 'zone';
export const TINT_KINDS: readonly TintKind[] = ['reach', 'target', 'path', 'objective', 'zone'];
export type Stock = 'first' | 'second';

export interface Segment {
  readonly from: number;
  readonly to: number;
}

export interface Banner {
  readonly turn: number;
  readonly turns: number;
  /** The phase by its name from the data; "Set-up" before play, "Game over" after. */
  readonly phase: string;
  /** Whose decision it is: the side's name, or '' when it is no one's. */
  readonly side: string;
  readonly stock: Stock | null;
  /** The decision is the viewer's own. */
  readonly yours: boolean;
  /** Who is deciding, in a few words: "Your move", "The computer is playing". */
  readonly who: string;
  /** What the viewer can do now, in one line. */
  readonly prompt: string;
  /** One line about the phase, from the ruleset's reading; '' when there is none. */
  readonly note: string;
  /** What is left to decide with (orders, groups not yet ordered, units that can still act); empty when the reading gives none. */
  readonly status: readonly Figure[];
  /** Whose turn it is, in two or three words, for a small plate: "Your turn", "Red turn", "Set-up", "Game over". */
  readonly turnOf: string;
  /** The mark of the side deciding, by id, or null. */
  readonly mark: string | null;
  /**
   * The heading of what is to be done now ("Your turn"); the phase when the reading gives no more. It always names
   * what a click means: with something chosen, the step and what is chosen ("Your turn: Field gun 1a chosen"); with
   * one of a chosen unit's other ways to act switched on, that way and what to choose.
   */
  readonly title: string;
  /** What to do now, in one line: the prompt, or when there is none what the reading says of this step. Never empty while a game is on. */
  readonly todo: string;
  /** Why, in a line; '' when there is nothing to say. */
  readonly why: string;
  /** The steps of a turn's loop and the present one (-1: none); empty when the reading names none. */
  readonly steps: readonly string[];
  readonly step: number;
}

export type ControlId =
  | 'end' | 'next' | 'back' | 'confirm' | 'deal' | 'start' | 'fast' | 'again' | 'reseed'
  // The fuller game: the ways a chosen unit can act besides moving and firing, their options, and the side's setting.
  | 'charge' | 'drive' | 'board' | 'unload' | 'call' | 'screen' | 'route' | 'advance' | 'setting' | 'preset' | 'takeBack'
  // While Tab chooses units: step through what the chosen unit can do (2026-11-14).
  | 'aim';

export interface ControlModel {
  readonly id: ControlId;
  readonly label: string;
  /** The key that does the same, as printed on the control. */
  readonly key: string;
  readonly enabled: boolean;
  /** The one control that moves the game on. */
  readonly primary: boolean;
  /** For a switch: whether it is on. */
  readonly on: boolean;
  /** 'unit': it belongs to the row of what the chosen unit can do, above the main row. */
  readonly row?: 'unit';
  /** When the control is not enabled: why, in a few words. */
  readonly why?: string;
  /** What its hover line says besides its name and key, in one sentence (what the setting a switch shows does). */
  readonly hint?: string;
}

/** What a click where the pointer is (or where Tab has stepped to) would do, for the table to show there. */
export interface PointModel {
  readonly hex: number;
  readonly unit: string | null;
  readonly act: IntentAct;
  /** False: the click would be refused, and `words` says why. */
  readonly can: boolean;
  /** A few words for a label at the hex: "Fire 58%", "Move 4 of 11". */
  readonly words: string;
}

export interface CardModel {
  readonly id: string;
  readonly name: string;
  readonly side: string;
  readonly stock: Stock;
  readonly face: CounterFace;
  readonly rows: readonly Figure[];
  /** Its main numbers as tiles, how it stands as a stamp, and the rest as lines, when the reading gives them (the rows are still there). */
  readonly tiles?: UnitCard['tiles'];
  readonly stamp?: UnitCard['stamp'];
  readonly lines?: readonly Figure[];
}

export interface OddsRow {
  readonly name: string;
  readonly effect: string;
  /** "17%": by the one rule of percentOf. */
  readonly percent: string;
  /** "6 in 36" */
  readonly ways: string;
  /** 0 to 1, for a bar. */
  readonly share: number;
}

/** One shot of the fire an action would draw, as a line of the odds card. */
export interface ShotRow {
  /** "Field gun 1 (Red force)" */
  readonly who: string;
  /** "on Scout car 2 at 1611" */
  readonly where: string;
  /** The chance of any effect, and of destroying: "58%", "17%". */
  readonly percent: string;
  readonly kill: string;
  readonly share: number;
}

export interface OddsModel {
  /** "Field gun 1 and Scout car 2 on Guard post 3 (Red force)" */
  readonly title: string;
  readonly figures: readonly Figure[];
  /** The first table's rows (all of them, when there is one table). */
  readonly rows: readonly OddsRow[];
  /** A target has been chosen (a click), not only pointed at. */
  readonly pinned: boolean;
  readonly note: string;
  /** Every table of chances, each summing to the whole; the first is `rows`. Absent when there is only `rows`. */
  readonly tables?: readonly { readonly title: string; readonly rows: readonly OddsRow[] }[];
  /** The fire the action would draw on the way, in firing order. */
  readonly shots?: readonly ShotRow[];
  /** For a weak attack: how it could be made stronger. */
  readonly advice?: AdviceModel;
}

/**
 * How an attack that is pointed at, and is weak, could be made stronger: the lines a panel prints, and the facts behind
 * them for a check. Every number in it is from the same forecasts a click would use.
 */
export interface AdviceModel {
  readonly lines: readonly string[];
  /**
   * The units that could be added to those attacking (`with`) for the best chance any listed attack on the target has,
   * and that chance (ways of `of`, and the ways that destroy). Null: no more units can join.
   */
  readonly join: {
    readonly add: readonly string[]; readonly with: readonly string[]; readonly target: string; readonly act: 'fire' | 'charge';
    readonly ways: number; readonly kill: number; readonly of: number;
  } | null;
  /** The target would be easier if fired on first, and these units of the viewer's could fire on it now; empty when not. */
  readonly first: readonly string[];
}

export interface DiceModel {
  /** Goes up by one with every roll shown, so a panel can tell a new roll with the same faces. */
  readonly serial: number;
  /** Empty when the result was certain and no dice were rolled. */
  readonly faces: readonly number[];
  readonly sides: number;
  /** "Field gun 1 on Guard post 3 (Red force)" */
  readonly caption: string;
  readonly figures: readonly Figure[];
  /** The result in words; null while the dice are still being read. */
  readonly result: string | null;
  /** What became of the target, once the result is known. */
  readonly fate: 'destroyed' | 'marked' | 'none' | null;
  /** The stock of the side that attacks. */
  readonly stock: Stock | null;
  /** False while the attack is only being pointed out, before the throw. */
  readonly rolled: boolean;
  /** The kind of attack, for the card's heading, from the reading; absent: "Attack". */
  readonly title?: string;
}

export interface ScoreModel {
  /**
   * `note`: one line in place of the count of losses, when the reading gives one. `short`: the side in a word.
   * `mark`: its mark by id, or null. `hand`: what it has left to act with this turn, when the reading says.
   * `setting`: the side's setting now, in a word or two, when it has one.
   */
  readonly sides: readonly {
    readonly seat: string; readonly name: string; readonly stock: Stock; readonly score: number; readonly losses: number; readonly note?: string;
    readonly short: string; readonly mark: string | null; readonly hand?: string; readonly setting?: string;
  }[];
  readonly objectives: readonly { readonly hex: number; readonly label: string; readonly points: number; readonly holder: string | null; readonly stock: Stock | null }[];
}

export interface LogLine {
  readonly n: number;
  readonly seat: string | null;
  readonly stock: Stock | null;
  readonly text: string;
}

export interface ResultModel {
  readonly headline: string;
  readonly winner: string | null;
  readonly stock: Stock | null;
}

/** The answer to the last thing the player did (a click, a key, a button), done or refused. */
export interface AnswerModel {
  /** Goes up by one with every answer, so a panel can tell a new answer with the same words. */
  readonly serial: number;
  readonly kind: 'done' | 'refused';
  /** One short line: what happened, or why it could not. */
  readonly text: string;
}

/**
 * Where a side's flag stands on the board: among the units of the group in hand on the viewer's own turn, and on
 * another side's turn among the units of the group whose unit's action is being shown, so that the eye is led there.
 */
export interface FlagModel {
  /** The seat whose flag it is, and its stock. */
  readonly side: string;
  readonly stock: Stock;
  /** The hexes of that group's units. */
  readonly hexes: readonly number[];
}

/** What kind of thing the viewer is doing now: it decides which commands a panel lays out. */
export type Mode = 'setup' | 'act' | 'watch' | 'over';

/** A briefing as a panel shows it: the reading's, with who plays each side. */
export interface BriefingModel extends Omit<Briefing, 'forces'> {
  readonly forces: readonly (BriefForce & { readonly stock: Stock | null; readonly who: string })[];
}

export interface GameModel {
  readonly title: string;
  readonly seed: number;
  readonly banner: Banner;
  readonly counters: readonly CounterModel[];
  readonly tints: Readonly<Record<TintKind, readonly number[]>>;
  /**
   * The nearer part of the reach: those of `tints.reach` that the unit can move to and still do one thing more this
   * turn (a move that `keeps`, reading.ts). A board shows them a shade stronger. Empty when no reach is shown, and
   * when no move of the unit keeps anything.
   */
  readonly reachNear: readonly number[];
  readonly lines: readonly Segment[];
  /** Fire a move pointed at would draw, or that is being drawn. */
  readonly threats: readonly ThreatModel[];
  /** Paths besides the one tinted as 'path', each with its start first. */
  readonly routes: readonly (readonly number[])[];
  readonly markers: readonly MarkerModel[];
  /** The groups of the side shown (the viewer's, or for a watcher the side deciding) as its units stand now; empty when the game has none. */
  readonly groups: readonly GroupModel[];
  /** Units waiting to be placed by hand. */
  readonly tray: readonly TrayModel[];
  readonly controls: readonly ControlModel[];
  /** The unit under the pointer, else the one selected. */
  readonly card: CardModel | null;
  readonly odds: OddsModel | null;
  /** The last roll. */
  readonly dice: DiceModel | null;
  readonly score: ScoreModel;
  readonly log: readonly LogLine[];
  readonly result: ResultModel | null;
  /** Input is held: a step is playing or an action is on its way. */
  readonly held: boolean;
  /** A rejection or a fault, shown until the next accepted action. */
  readonly problem: string | null;
  /** Null before the first answer. */
  readonly answer: AnswerModel | null;
  /** What a click where the pointer is would do, in a few words ("Fire on T-34/76 1a: 58%"); '' when nothing. */
  readonly intent: string;
  /** What the viewer is doing: setting up, acting with units ('act'), watching another side or the computer ('watch'), or looking at the result. */
  readonly mode: Mode;
  /** What a player is told before the first turn, when the scenario has it. */
  readonly briefing: BriefingModel | null;
  /** A player's guide to the rules, when the ruleset has one. */
  readonly rulebook: RuleBook | null;
  /** The ruleset's own words for things a panel names (GameInfo.words); empty when it gives none. */
  readonly words: Readonly<Record<string, string>>;
  /** The board's size in hexes, for a small plan of it. */
  readonly grid: { readonly cols: number; readonly rows: number };
  /** The seat whose view this is; null for a watcher. */
  readonly viewer: string | null;
  /** Where a side's flag stands, or null when none does. */
  readonly flag: FlagModel | null;
  /** While units are chosen to attack: each enemy a click would attack, with the chance of the attack (chances.ts). Empty otherwise. */
  readonly chances: readonly ChanceLabel[];
}

/** What the controller adds to a model (controller.ts makes it). */
export interface ControlView {
  readonly selected: readonly string[];
  readonly canAct: readonly string[];
  readonly targets: readonly string[];
  /** Of `targets`, those a click would attack at close quarters (a charge, a drive through its hex): they glow red. Absent: none. */
  readonly close?: readonly string[];
  readonly reach: readonly number[];
  /** Those hexes of `reach` that a move to would leave the unit something it can still do this turn. Absent: none. */
  readonly reachNear?: readonly number[];
  readonly targetHexes: readonly number[];
  readonly path: readonly number[];
  readonly zone: readonly number[];
  /** Lines of an attack being put together, not yet declared. */
  readonly aim: readonly Segment[];
  /** Set-up being proposed: where each of the viewer's units would go. */
  readonly proposal: ReadonlyMap<string, number> | null;
  readonly card: CardModel | null;
  readonly odds: OddsModel | null;
  readonly prompt: string;
  readonly note: string;
  readonly controls: readonly ControlModel[];
  /** Fire the action being pointed at or put together would draw. */
  readonly threats?: readonly ThreatModel[];
  /** Paths besides `path`. */
  readonly routes?: readonly (readonly number[])[];
  /** Each enemy a click would attack, with the chance of the attack (chances.ts). */
  readonly chances?: readonly ChanceLabel[];
  /** The viewer's own counters a click would choose. */
  readonly picks?: readonly string[];
  /** The group in hand, by its id (null: none), and whether a press of a group does something now. */
  readonly hand?: string | null;
  readonly groupsGo?: boolean;
  /** Units waiting to be placed by hand, and the one picked up. */
  readonly tray?: readonly string[];
  /** What a click where the pointer is would do: for the table (`point`) and in a line for the panel (`intent`). */
  readonly point?: PointModel | null;
  readonly intent?: string;
  /** The answer to the last thing the player did. */
  readonly answer?: AnswerModel | null;
  /** Where the viewer is in the turn's loop, when the reading says. */
  readonly guide?: Guide;
}

/** What the play-back adds while a step plays (playback.ts makes it). */
export interface StageView {
  /** While an attack resolves: only its lines and its target are shown. */
  readonly focus: { readonly lines: readonly Segment[]; readonly target: string | null; readonly targetHex: number } | null;
  /** The path of a move being played. */
  readonly path: readonly number[];
  readonly dice: DiceModel | null;
  readonly log: readonly LogLine[];
  /** What is being shown at this moment, in a line ('' before anything has been). */
  readonly now: string;
  /** The side that last scored each objective hex. */
  readonly holders: ReadonlyMap<number, string>;
  /** Fire being drawn now. */
  readonly threats?: readonly ThreatModel[];
  /** The units the action being shown is about (those that act first), or the action last shown; none since the turn passed to another side. */
  readonly acting?: readonly string[];
}

export interface ModelParts {
  readonly info: GameInfo;
  readonly seed: number;
  /** The seat whose view this is; null for a spectator. */
  readonly viewer: string | null;
  /** Seats the computer plays. */
  readonly computer: readonly string[];
  readonly position: Position;
  /** Each counter's place in its stack. */
  readonly places: ReadonlyMap<string, number>;
  readonly control: ControlView;
  readonly stage: StageView;
  readonly held: boolean;
  readonly fast: boolean;
  readonly problem: string | null;
  readonly ending: string;
  /** How many people play at this table (two or more: the table is shared, and "your turn" would not say whose). Absent: one. */
  readonly people?: number;
  /** Where a side's flag stands (the game keeps what it follows from one model to the next). Absent: none. */
  readonly flag?: FlagModel | null;
}

/**
 * What a click chooses while one of a chosen unit's other ways to act is switched on, by the control's id. The way's
 * own name is the ruleset's (the control's label); these words are the layer's.
 */
const WAY_WORDS: Readonly<Record<string, string>> = {
  charge: 'choose a target',
  drive: 'choose a hex to drive through',
  board: 'choose a transport',
  call: 'choose a target hex',
  screen: 'choose a target hex',
};

/** "a", "a and b", "a, b and c". */
function listed(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] as string}`;
}

export function stockOf(info: GameInfo, seat: string | null): Stock | null {
  if (seat === null) return null;
  return info.sides.find(s => s.seat === seat)?.stock ?? null;
}

export function sideNameOf(info: GameInfo, seat: string | null): string {
  if (seat === null) return '';
  return info.sides.find(s => s.seat === seat)?.name ?? seat;
}

/** The one rule for a chance as it is shown: `can`: it can happen at all; `mayFail`: it can fail to. */
function shareWords(share: number, can: boolean, mayFail: boolean): string {
  const p = Math.round(share * 100);
  if (p <= 0) return can ? 'under 1%' : '0%';
  if (p >= 100) return mayFail ? 'over 99%' : '100%';
  return `${p}%`;
}

/**
 * A chance as it is shown, everywhere it is shown (the table's label, the panel's lines, the odds page): `ways` of
 * `of`, to the nearest whole per cent (one roll in 36 is "3%"); never "0%" for what can happen ("under 1%"), never
 * "100%" for what can fail ("over 99%").
 */
export function percentOf(ways: number, of: number): string {
  return shareWords(of > 0 ? ways / of : 0, ways > 0, ways < of);
}

/** The same rule for a chance that is a share from 0 to 1 and no count of ways (a risk made of several chances). */
export function percentOfShare(share: number): string {
  return shareWords(share, share > 0, share < 1);
}

/** The units a board shows: on the board in the position, or where the set-up proposal would put them. */
export function unitsOnBoard(position: Position, proposal: ReadonlyMap<string, number> | null): { id: string; hex: number; carriedBy: string | null }[] {
  const out: { id: string; hex: number; carriedBy: string | null }[] = [];
  for (const u of position.units) {
    if (u.destroyed) continue;
    const hex = u.hex >= 0 ? u.hex : proposal?.get(u.id) ?? -1;
    if (hex >= 0) out.push({ id: u.id, hex, carriedBy: u.carriedBy ?? null });
  }
  return out;
}

export function buildModel(parts: ModelParts): GameModel {
  const { info, position, control, stage, viewer } = parts;
  const selected = new Set(control.selected);
  const canAct = new Set(control.canAct);
  const targets = new Set(stage.focus ? (stage.focus.target === null ? [] : [stage.focus.target]) : control.targets);
  // While an attack resolves only its target is shown: nothing glows for a close attack then.
  const close = new Set(stage.focus ? [] : (control.close ?? []).filter(id => targets.has(id)));
  const picks = new Set(control.picks ?? []);
  // The fuller game shows every side's units as they stand; the older game marks only the side playing.
  const rich = info.rich === true;
  // The group in hand, and its units: their counters are lit.
  const hand = control.hand ?? null;
  const inHand = new Set((position.groups ?? []).find(g => g.id === hand)?.units ?? []);

  const counters: CounterModel[] = [];
  const hexOfUnit = new Map<string, number>(unitsOnBoard(position, control.proposal).map(u => [u.id, u.hex]));
  const facts = new Map(info.units.map(u => [u.id, u]));
  // "Has acted" is shown for the side that is playing: the other side's marks are last turn's.
  const playing = new Set(position.stage === 'play' ? position.deciding : []);
  for (const u of position.units) {
    const hex = hexOfUnit.get(u.id);
    const unit = facts.get(u.id);
    if (hex === undefined || !unit) continue;
    counters.push({
      id: u.id, side: u.seat, hex, place: parts.places.get(u.id) ?? 0, face: unit.face,
      marks: {
        selected: selected.has(u.id), canAct: canAct.has(u.id), spent: u.spent && (rich ? position.stage === 'play' : playing.has(u.seat)),
        suppressed: u.suppressed, target: targets.has(u.id),
      },
      notes: {
        group: '', active: inHand.has(u.id), carriedBy: u.carriedBy ?? null, revealed: u.revealed === true, pick: picks.has(u.id),
        moved: u.moved === true && !u.spent && !u.destroyed && position.stage === 'play',
        close: close.has(u.id),
      },
    });
  }

  // Declared attacks, from the position; while one resolves, only its own lines.
  let lines: Segment[] = [];
  if (stage.focus) {
    lines = stage.focus.lines.slice();
  } else {
    for (const u of position.units) {
      if (u.target === null) continue;
      const from = hexOfUnit.get(u.id);
      const to = hexOfUnit.get(u.target);
      if (from !== undefined && to !== undefined) lines.push({ from, to });
    }
    lines.push(...control.aim);
  }

  const deciding = position.deciding;
  const yours = viewer !== null && deciding.includes(viewer);
  const lead = yours ? viewer : deciding[0] ?? null;
  let who = '';
  if (position.stage === 'over') who = '';
  else if (yours) who = 'Your move';
  else if (lead !== null && parts.computer.includes(lead)) who = 'The computer is playing';
  else if (lead !== null) who = 'Their move';
  const phase = position.stage === 'setup' ? 'Set-up' : position.stage === 'over' ? 'Game over' : position.phase;
  // While steps play there is nothing to do (and a watcher never has): say what is being shown instead.
  const prompt = parts.held && stage.now !== '' && position.stage !== 'over' && (viewer === null || control.prompt === '') ? stage.now : control.prompt;
  const guide = control.guide;
  const leadInfo = info.sides.find(s => s.seat === lead);
  // The heading names what a click means now: the way switched on, else what is chosen, else the step.
  const step = guide && guide.title !== '' ? guide.title : phase;
  const way = control.controls.find(c => c.row === 'unit' && c.on && WAY_WORDS[c.id] !== undefined);
  const chosen = control.selected.map(id => facts.get(id)?.name ?? id);
  const title = position.stage !== 'play' || !yours ? step
    : way ? `${way.label}: ${WAY_WORDS[way.id] as string}`
      : chosen.length > 0 && chosen[0] !== '' ? `${position.phase !== '' ? position.phase : step}: ${listed(chosen)} chosen`
        : step;
  const banner: Banner = {
    turn: position.turn,
    turns: info.turns,
    phase,
    side: sideNameOf(info, lead),
    stock: stockOf(info, lead),
    yours,
    who,
    prompt,
    note: control.note,
    status: position.stage === 'play' ? position.status ?? [] : [],
    turnOf: position.stage === 'over' ? 'Game over'
      : position.stage === 'setup' ? 'Set-up'
        : yours && (parts.people ?? 1) <= 1 ? 'Your turn'
          : leadInfo ? `${leadInfo.short ?? leadInfo.name} turn` : '',
    mark: leadInfo?.mark ?? null,
    title,
    // The result, once there is one; else the prompt; else what the reading says of this step; else who is deciding.
    todo: position.stage === 'over' ? parts.ending : prompt !== '' ? prompt : guide && guide.todo !== '' ? guide.todo : who,
    why: guide ? guide.why : control.note,
    steps: guide ? guide.steps : [],
    step: guide ? guide.step : -1,
  };

  const over = position.stage === 'over';
  const controls: ControlModel[] = [
    ...control.controls,
    { id: 'fast', label: 'Fast', key: 'F', enabled: true, primary: false, on: parts.fast },
  ];
  if (over) {
    controls.push({ id: 'again', label: 'Play again', key: 'Enter', enabled: true, primary: true, on: false });
    controls.push({ id: 'reseed', label: 'New seed', key: 'N', enabled: true, primary: false, on: false });
  }

  const result: ResultModel | null = position.result
    ? { headline: parts.ending, winner: position.result.winner, stock: stockOf(info, position.result.winner) }
    : null;

  // The groups of the side shown: the viewer's own, or for a watcher the side deciding; as its units stand now.
  const shownSeat = viewer ?? lead;
  const unitNow = new Map(position.units.map(u => [u.id, u]));
  const groups: GroupModel[] = position.stage === 'play' ? (position.groups ?? []).filter(g => g.seat === shownSeat).map(g => {
    const members: MemberModel[] = g.units.map(id => {
      const u = unitNow.get(id);
      const fact = facts.get(id);
      return {
        id, name: fact?.name ?? id, tag: fact?.tag ?? '', title: fact?.face.title ?? '',
        selected: selected.has(id), canAct: canAct.has(id), spent: u?.spent === true, moved: u?.moved === true && u.spent !== true, suppressed: u?.suppressed === true,
        lost: u?.destroyed !== false, onBoard: hexOfUnit.has(id),
      };
    });
    return {
      id: g.id, name: g.name, number: g.number, key: g.number >= 1 && g.number <= 9 ? String(g.number) : '', side: g.seat, stock: stockOf(info, g.seat),
      units: g.units.length, able: g.units.filter(id => canAct.has(id)).length, inHand: g.id === hand, enabled: control.groupsGo === true, members,
    };
  }) : [];

  const mode: Mode = over ? 'over' : !yours ? 'watch' : position.stage === 'setup' ? 'setup' : 'act';
  const told = info.briefing;
  const briefing: BriefingModel | null = told ? {
    ...told,
    forces: told.forces.map(f => ({
      ...f,
      stock: stockOf(info, f.seat),
      who: parts.computer.includes(f.seat) ? 'computer' : viewer === f.seat && (parts.people ?? 1) <= 1 ? 'you' : 'player',
    })),
  } : null;

  const trayIds = new Set(control.tray ?? []);
  const tray: TrayModel[] = info.units.filter(u => trayIds.has(u.id)).map(u => ({
    id: u.id, name: u.name, stock: stockOf(info, u.seat) ?? 'first', face: u.face, selected: selected.has(u.id),
  }));

  return {
    title: info.title,
    seed: parts.seed,
    banner,
    counters,
    tints: {
      reach: control.reach,
      target: stage.focus ? (stage.focus.targetHex >= 0 ? [stage.focus.targetHex] : []) : control.targetHexes,
      path: stage.path.length > 0 ? stage.path : control.path,
      objective: info.objectives.map(o => o.hex),
      zone: control.zone,
    },
    // Only hexes of the reach itself: the nearer part is a part of it.
    reachNear: (control.reachNear ?? []).filter(h => control.reach.includes(h)),
    lines,
    threats: stage.threats && stage.threats.length > 0 ? stage.threats : stage.focus ? [] : control.threats ?? [],
    routes: stage.focus || stage.path.length > 0 ? [] : control.routes ?? [],
    markers: (position.markers ?? []).map(m => ({ hex: m.hex, kind: m.kind, label: m.label, side: m.seat, stock: stockOf(info, m.seat) })),
    groups,
    tray,
    controls,
    card: control.card,
    odds: stage.focus ? null : control.odds,
    dice: stage.dice,
    score: {
      sides: info.sides.map(s => {
        const now = position.sides.find(x => x.seat === s.seat);
        return {
          seat: s.seat, name: s.name, stock: s.stock, score: now?.score ?? 0, losses: now?.losses ?? 0,
          ...(now?.note !== undefined && now.note !== '' ? { note: now.note } : {}),
          short: s.short ?? s.name, mark: s.mark ?? null,
          ...(now?.hand !== undefined ? { hand: now.hand } : {}),
          ...(now?.setting !== undefined ? { setting: now.setting } : {}),
        };
      }),
      objectives: info.objectives.map((o, k) => {
        const holder = position.holders ? position.holders[k] ?? null : stage.holders.get(o.hex) ?? null;
        return { hex: o.hex, label: labelOf(info.grid, o.hex), points: o.points, holder, stock: stockOf(info, holder) };
      }),
    },
    log: stage.log,
    result,
    held: parts.held,
    problem: parts.problem,
    answer: control.answer ?? null,
    // While an attack resolves the board shows that alone: nothing is pointed out.
    intent: stage.focus ? '' : control.intent ?? '',
    mode,
    briefing,
    rulebook: info.rulebook ?? null,
    words: info.words ?? {},
    grid: info.grid,
    viewer,
    flag: parts.flag ?? null,
    // While an attack resolves the board shows that alone.
    chances: stage.focus ? [] : control.chances ?? [],
  };
}
