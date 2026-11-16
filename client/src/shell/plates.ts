/**
 * The main menu's lines, top to bottom, as the owner painted them. `built` is false for what the
 * game does not have yet: such a plate is drawn dimmer and answers a press with a line on the
 * screen. Data only.
 */
import { WORDS } from './words';

export type PlateId = 'scenario' | 'campaign' | 'multiplayer' | 'settings';

export const PLATES: readonly { id: PlateId; words: string; built: boolean }[] = [
  { id: 'scenario', words: WORDS.menu.scenario, built: true },
  // A chain of battles for one side, one force carried through them (client/src/campaign, shell/campaign-list.ts).
  { id: 'campaign', words: WORDS.menu.campaign, built: true },
  // A game played online by a shared link (client/src/net), on the published game server (worker/).
  { id: 'multiplayer', words: WORDS.menu.multiplayer, built: true },
  { id: 'settings', words: WORDS.menu.settings, built: true },
];
