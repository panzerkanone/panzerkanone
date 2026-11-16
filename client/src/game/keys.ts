/**
 * The table of keys: every key that does something while a game is on, and
 * who owns it. One table, made from data, printed by the panel's Keys page
 * and held by a test (tests/game/keys.test.ts): no key may do two things.
 *
 * Three owners:
 *   the game       the key printed on each of the present controls (model.ts), and, where the game
 *                  shows the viewer's units in groups, the digits 1 to 9 (each goes to the group of
 *                  that number and lights it; it chooses nothing);
 *   the map        whatever the page that shows the board says its keys are (the table's, handed in
 *                  as plain lines: this layer imports nothing of it);
 *   the interface  the panel's own (PANEL_KEYS below): the teaching notes, the notebook, the
 *                  folder, the map's controls, the sound, and Escape.
 *
 * Escape is the one key that passes on: the panel closes the last thing the
 * player opened, and with nothing open hands it to the game as "back". Enter
 * on the briefing is the one key that belongs to a full panel: while a full
 * panel (the briefing, the rule book) covers the board the game hears no key
 * at all, so nothing else can act then.
 *
 * No DOM here: the Node tests import this file.
 */
import type { GameModel } from './model';

export type KeyOwner = 'game' | 'map' | 'panel';

/** One line of the table. */
export interface KeyLine {
  /** As printed on a key cap: "Tab", "1–4", "~". */
  readonly key: string;
  /** What it does, in a few words. */
  readonly does: string;
  /**
   * The keys it claims, as a keyboard event names them (`KeyboardEvent.key`), a letter in lower case.
   * Empty for a line that is a gesture and no key ("drag").
   */
  readonly claims: readonly string[];
}

export interface KeySection {
  readonly owner: KeyOwner;
  readonly title: string;
  readonly lines: readonly KeyLine[];
}

/** What a panel key does. */
export type PanelAct = 'overlay' | 'notebook' | 'folder' | 'map' | 'sound' | 'close';

export interface PanelKey extends KeyLine {
  readonly act: PanelAct;
  /** What must be there for the key to mean anything: a folder, the map's controls, the music. Absent: always. */
  readonly needs?: 'folder' | 'map' | 'music';
}

/** The panel's own keys. The folder is named in the ruleset's own word for its groups: see keySections. */
export const PANEL_KEYS: readonly PanelKey[] = [
  { key: 'I', does: 'teaching notes on / off', claims: ['i'], act: 'overlay' },
  { key: 'F1', does: 'same as I', claims: ['F1'], act: 'overlay' },
  { key: 'J', does: 'open or close the notebook', claims: ['j'], act: 'notebook' },
  { key: 'A', does: 'open or close the folder', claims: ['a'], act: 'folder', needs: 'folder' },
  { key: 'W', does: 'open or close the map controls', claims: ['w'], act: 'map', needs: 'map' },
  { key: 'S', does: 'sound on / off', claims: ['s'], act: 'sound', needs: 'music' },
  { key: 'Esc', does: 'close what you opened last; with nothing open, go back', claims: ['Escape'], act: 'close' },
];

/** The key that passes on to the game when the panel has nothing to do with it. */
export const PASSES_ON = 'Escape';

/** The one key a full panel takes for itself while it covers the board (the briefing's "Begin"). */
export const FULL_PANEL_KEYS: readonly KeyLine[] = [{ key: 'Enter', does: 'begin the game (on the briefing)', claims: ['Enter'] }];

/** A key as a keyboard event names it, a letter in lower case. */
export function keyName(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

/**
 * The adding modifier: held while one of the viewer's own units is clicked, it adds that unit to those that will act
 * together (again: takes it out). Any of Shift, Ctrl and Cmd is it, read from a key event and from a pointer event
 * alike. Alt is not: it is the table's own (it handles a counter as a thing).
 */
export function addHeld(e: { readonly shiftKey: boolean; readonly ctrlKey: boolean; readonly metaKey: boolean }): boolean {
  return e.shiftKey || e.ctrlKey || e.metaKey;
}

/** That gesture, as a player is told it. */
export const ADD_CLICK = 'Ctrl-, Cmd- or Shift-click';

/** The digits that go to a group, where a game has groups: all of them are the game's, a digit with no group of that number being refused in words. */
export const GROUP_KEYS: readonly string[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** The keys a control's printed key stands for. */
export function claimsOf(printed: string): string[] {
  if (printed === '') return [];
  if (printed === 'Esc') return ['Escape'];
  if (printed === 'Bksp') return ['Backspace', 'Delete'];
  return [keyName(printed)];
}

/** The panel key a keyboard event's key is, if any (and if what it needs is there). */
export function panelKey(key: string, has: { folder: boolean; map: boolean; music: boolean }): PanelKey | null {
  const name = keyName(key);
  const found = PANEL_KEYS.find(k => k.claims.includes(name));
  if (!found) return null;
  if (found.needs !== undefined && !has[found.needs]) return null;
  return found;
}


/**
 * The table as it stands for a model: the game's keys now, the map's as the page gave them, the panel's.
 * `has`: which of the panel's parts are there (a key of a part that is not there is left out).
 */
export function keySections(model: GameModel, mapKeys: readonly KeyLine[], has: { folder: boolean; map: boolean; music: boolean }): KeySection[] {
  const game: KeyLine[] = [];
  // Where the game shows units in groups (it then has a word for what their keys do), every digit from 1 to 9 is the game's.
  const groupKeys = model.words['groupKeys'];
  if (groupKeys !== undefined && model.groups.length > 0) {
    game.push({ key: `${GROUP_KEYS[0] as string}–${GROUP_KEYS[GROUP_KEYS.length - 1] as string}`, does: groupKeys, claims: GROUP_KEYS.slice() });
  }
  for (const c of model.controls) {
    if (c.key === '') continue;
    // (A switch's label carries its setting after a colon: the keys page names the switch alone.)
    game.push({ key: c.key, does: c.label.replace(/:.*$/, '').toLowerCase(), claims: claimsOf(c.key) });
  }
  // Two gestures that are no key's: said in the ruleset's own words, when it has them.
  const add = model.words['addClick'];
  if (add !== undefined) game.push({ key: ADD_CLICK, does: add, claims: [] });
  const pointing = model.words['pointing'];
  if (pointing !== undefined) game.push({ key: 'click', does: pointing, claims: [] });
  // Tab with Shift held is Tab's own key: a line of its own, claiming nothing more.
  const backTab = model.words['shiftTab'];
  if (backTab !== undefined && model.controls.some(c => c.id === 'next')) game.push({ key: 'Shift+Tab', does: backTab, claims: [] });
  const folderWords = model.words['groups'];
  const panel: KeyLine[] = PANEL_KEYS
    .filter(k => k.needs === undefined || has[k.needs])
    .map(k => ({ key: k.key, does: k.act === 'folder' && folderWords !== undefined ? `open or close the ${folderWords.toLowerCase()} folder` : k.does, claims: k.claims }));
  const out: KeySection[] = [{ owner: 'game', title: 'The game', lines: game }];
  if (mapKeys.length > 0) out.push({ owner: 'map', title: 'The map', lines: mapKeys });
  // The page's full screen (fullscreen.ts: FULLSCREEN_KEY), heard on every screen before the panel and the game:
  // a line, claiming no key of theirs.
  panel.push({ key: 'Alt+Enter', does: 'full screen on / off (Option+Enter on a Mac)', claims: [] });
  out.push({ owner: 'panel', title: 'This interface', lines: panel });
  return out;
}

/**
 * Keys that more than one line claims, each with the lines that claim it. The one exception is the key
 * that passes on: the panel's line and one line of the game may both claim it. Empty when all is well.
 */
export function keyClashes(sections: readonly KeySection[]): string[] {
  const claimed = new Map<string, { owner: KeyOwner; line: KeyLine }[]>();
  for (const s of sections) {
    for (const line of s.lines) {
      for (const k of line.claims) {
        const list = claimed.get(k);
        if (list) list.push({ owner: s.owner, line });
        else claimed.set(k, [{ owner: s.owner, line }]);
      }
    }
  }
  const out: string[] = [];
  for (const [k, list] of claimed) {
    if (list.length < 2) continue;
    const passing = k === PASSES_ON && list.length === 2 && list.filter(x => x.owner === 'panel').length === 1 && list.filter(x => x.owner === 'game').length === 1;
    if (!passing) out.push(`${k}: ${list.map(x => `${x.owner} (${x.line.does})`).join(' and ')}`);
  }
  return out;
}
