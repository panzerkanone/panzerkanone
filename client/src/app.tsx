// The page at `/` and the shell's other screens (client/src/shell). The page's entry (main.tsx) fetches
// this file for an address that asks for no other view.
//
// It mounts the one stage (shell/stage-dom.ts) and shows one screen on it at a time: the title and main
// menu, the settings, the scenario list, the side selector. The address names the screen (`screen=`; the
// title has none), so a reload stays where it was and the browser's Back goes back. Esc and each screen's
// Back tag go back to the screen it was reached from. A screen is built the first time it is shown.
import { screenAddress, screenOf } from './shell/address';
import type { ScreenId } from './shell/address';
import { ART, addressOf } from './shell/art';
import { buildScenarios } from './shell/scenario-screen';
import { buildCampaignList } from './shell/campaign-list';
import { buildCampaignRoom } from './shell/campaign-room';
import { buildRewards } from './shell/rewards-screen';
import type { Screen, Shell } from './shell/screen';
import { screensCss } from './shell/screens-style';
import { settingsModel } from './shell/settings';
import type { SettingsModel } from './shell/settings';
import { buildSettingsScreen } from './shell/settings-screen';
import { buildSide } from './shell/side-screen';
import { startSound } from './shell/sound';
import { mountStage } from './shell/stage-dom';
import { localStore } from './shell/store';
import { shellCss } from './shell/style';
import { buildTitle } from './shell/title';
import { GAME } from './shell/words';

declare global {
  interface Window {
    /** The shell's screens, for checks and for the console. */
    __shell?: { screen(): ScreenId; go(to: ScreenId): void; back(): void; settings: SettingsModel };
  }
}

/** The screen each one goes back to (the settings opened from a game go back to the game: settings-screen.ts). */
const PARENT: Readonly<Record<ScreenId, ScreenId | null>> = { title: null, settings: 'title', scenarios: 'title', side: 'scenarios', campaigns: 'title', campaign: 'campaigns', rewards: 'title', service: 'title' };

export function startApp(root: HTMLElement, params: URLSearchParams = new URLSearchParams(window.location.search)): void {
  document.title = `${GAME.name}: ${GAME.subtitle}`;
  const style = document.createElement('style');
  style.textContent = shellCss(ART, addressOf) + screensCss();
  document.head.appendChild(style);

  const stage = mountStage(root);
  const model = settingsModel(localStore());
  const sound = startSound(params, model);
  const built = new Map<ScreenId, Screen>();
  let current: ScreenId | null = null;
  /** A line for the screen Back is going to, kept while the browser goes back. */
  let note: string | null = null;
  const here = (): URLSearchParams => new URLSearchParams(window.location.search);

  const shell: Shell = {
    stage,
    params,
    model,
    sound,
    art: ART,
    address: addressOf,
    current: () => current ?? 'title',
    go(to, extra = {}) {
      if (to === current) return;
      window.history.pushState({ shell: to, from: current }, '', screenAddress(here(), to, window.location.pathname, extra));
      show(to, null);
    },
    back(line = null) {
      const from = current ?? 'title';
      const parent = PARENT[from];
      if (parent === null) return;
      const state: unknown = window.history.state;
      // Reached from its parent on this page: the browser goes back (and its own Back stays in step).
      if (typeof state === 'object' && state !== null && (state as { shell?: unknown }).shell === from && (state as { from?: unknown }).from === parent) {
        note = line;
        window.history.back();
        return;
      }
      window.history.replaceState(null, '', screenAddress(here(), parent, window.location.pathname, { scenario: here().get('scenario') }));
      show(parent, line);
    },
  };

  function make(id: ScreenId): Screen {
    if (id === 'settings') return buildSettingsScreen(shell);
    if (id === 'scenarios') return buildScenarios(shell);
    if (id === 'side') return buildSide(shell);
    if (id === 'campaigns') return buildCampaignList(shell);
    if (id === 'campaign') return buildCampaignRoom(shell);
    if (id === 'rewards' || id === 'service') return buildRewards(shell, id);
    return buildTitle(shell);
  }

  /** Shows one screen and hides the one before; the one shown is told while `current` still names the one before. */
  function show(id: ScreenId, line: string | null): void {
    let next = built.get(id);
    if (!next) {
      next = make(id);
      built.set(id, next);
    }
    const was = current === null ? undefined : built.get(current);
    if (was && was !== next) {
      was.hide();
      was.element.classList.remove('sh-current');
      was.element.inert = true;
    }
    // Shown first, then told: a screen gives the keyboard's focus as it comes, and a hidden element takes none.
    next.element.inert = false;
    next.element.classList.add('sh-current');
    next.show(here(), line);
    current = id;
  }

  window.addEventListener('popstate', () => {
    const line = note;
    note = null;
    show(screenOf(here()), line);
  });
  window.addEventListener('keydown', e => {
    const screen = current === null ? undefined : built.get(current);
    if (screen?.key(e)) e.preventDefault();
  });

  window.__shell = { screen: () => current ?? 'title', go: to => shell.go(to), back: () => shell.back(), settings: model };
  show(screenOf(params), null);
}
