/**
 * The settings screen laid over a game in progress (the owner, 2026-11-14: "Going to the options panel in-game resets
 * the game"). The same painted screen as the title's (settings-screen.ts, on a stage of its own: stage-dom.ts), in an
 * overlay above the game's panel; nothing navigates, so the game stays where it was. The page that has the game
 * (main.tsx) opens it and hands it the game's own music and sound effects, and is told when it is put away.
 *
 *   - the volumes act at once, as on the title (the sliders drive the game's music and effects);
 *   - Apply keeps what is set. The graphic detail is given to the table at once when it can take it
 *     (`window.__table.setTier`), else from the next game; the computer's level from the next game (the opponent of
 *     a game in progress keeps its level), and the line under "Settings applied." says so. Both are written into the
 *     page's address and its query, so that the next game on this page, and a reload, start with them;
 *   - Back, and Esc, put it away (Back drops what was not applied, as on the title).
 *
 * Nothing here knows the game: it is told only who plays the music and the effects.
 */
import { TIER_OF } from './address';
import { ART, addressOf } from './art';
import type { Screen, Shell } from './screen';
import { SETTINGS_PLACES } from './screen-places';
import { screensCss } from './screens-style';
import { KEPT, settingsModel } from './settings';
import type { AudioPort, Detail, Difficulty, Store } from './settings';
import { buildSettingsScreen } from './settings-screen';
import { mountStage } from './stage-dom';
import { localStore } from './store';
import { shellCss } from './style';
import { answerIn } from './ui';

/** What the page hands the overlay. */
export interface SettingsOverlayDeps {
  /** The game's music, when the page has a player. */
  music: AudioPort | null;
  /** The game's sound effects, when the page has them: their engine, and its way of playing a cue. */
  sound: (AudioPort & { play?(cue: string, opts?: { gain?: number }): void }) | null;
  /** Called once, when the overlay is put away. */
  done(): void;
  /** Only the About panel, over the settings (the game's menu: about.ts); putting it away puts the overlay away. */
  about?: boolean;
}

/** The overlay's own lines: said under the screen's "Settings applied." when a choice waits for the next game. */
export const OVERLAY_WORDS = {
  levelNext: 'The computer’s new level starts with your next game.',
  detailNext: 'The new graphic detail starts with your next game.',
} as const;

const STYLE_ID = 'sh-overlay-style';
/** Above the game's panel and its full panels. */
const Z = 60;
/** The interface sounds' level, as the title's (sound.ts). */
const UI_GAIN = 0.7;

/** Lays the settings over the page; returns a function that puts them away (as Back does, dropping what was not applied). */
export function openSettingsOverlay(root: HTMLElement, params: URLSearchParams, deps: SettingsOverlayDeps): () => void {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = shellCss(ART, addressOf) + screensCss();
    document.head.appendChild(style);
  }
  const stage = mountStage(root);
  // The page under the stage: over the game, which shows dimly round the stage where the window is wider than it.
  const page = stage.element.parentElement?.parentElement ?? null;
  if (page) {
    page.style.zIndex = String(Z);
    page.style.background = 'rgba(0, 0, 0, 0.72)';
    page.dataset['part'] = 'settings-overlay';
  }

  // The kept choices are the title's (local storage); whether the effects are on is the game's own switch, as it stands.
  const kept = localStore();
  const store: Store = {
    get: key => (key === KEPT.soundOn && deps.sound ? (deps.sound.state().on ? '1' : '0') : kept.get(key)),
    set: (key, value) => kept.set(key, value),
  };
  const model = settingsModel(store);
  model.attachMusic(deps.music);
  model.attachSound(deps.sound);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    window.removeEventListener('keydown', onKey, true);
    stopChanges();
    stage.dispose();
    delete window.__settings;
    deps.done();
  };

  const shell: Shell = {
    stage,
    params,
    model,
    sound: {
      event: () => undefined,
      ui: what => deps.sound?.play?.(what === 'press' ? 'button' : 'refuse', { gain: UI_GAIN }),
    },
    art: ART,
    address: addressOf,
    go: () => undefined,
    back: () => close(),
    current: () => 'settings',
  };
  const screen: Screen = buildSettingsScreen(shell);
  screen.element.classList.add('sh-current');
  screen.show(new URLSearchParams(deps.about === true ? 'about=1' : ''), null);

  // What Apply gives that a game in progress cannot take at once: said under "Settings applied.", and written into the
  // address and the page's query, which the next game on this page reads.
  const later = answerIn(screen.element);
  later.element.dataset['part'] = 'settings-later';
  const at = { x: SETTINGS_PLACES.answer.right, y: SETTINGS_PLACES.answer.y + 46, align: 'right' as const };
  let was = model.get();
  const stopChanges = model.onChange(() => {
    const now = model.get();
    const lines: string[] = [];
    const address = new URL(window.location.href);
    if (now.difficulty !== null && now.difficulty !== was.difficulty) {
      setBoth(params, address, 'ai', now.difficulty);
      lines.push(OVERLAY_WORDS.levelNext);
    }
    if (now.detail !== null && now.detail !== was.detail) {
      setBoth(params, address, 'detail', now.detail);
      setBoth(params, address, 'tier', TIER_OF[now.detail]);
      if (!giveDetail(now.detail)) lines.push(OVERLAY_WORDS.detailNext);
    }
    // Show hulks and Show craters: the table takes them at once (its marks go, or come back), and the next game here too.
    for (const kind of ['hulks', 'craters'] as const) {
      const on = now[kind];
      if (on === null || on === was[kind]) continue;
      setBoth(params, address, kind, on ? '1' : '0');
      giveMarks({ [kind]: on });
    }
    if (address.href !== window.location.href) window.history.replaceState(window.history.state, '', address);
    if (lines.length > 0) later.say(lines.join(' '), at);
    was = now;
  });

  const onKey = (e: KeyboardEvent): void => {
    if (closed) return;
    if (screen.key(e)) e.preventDefault();
  };
  window.addEventListener('keydown', onKey, true);
  return close;
}

/** A choice of the game's, in the query a game page holds and in the address. */
function setBoth(params: URLSearchParams, address: URL, key: string, value: Difficulty | Detail | string): void {
  params.set(key, value);
  address.searchParams.set(key, value);
}

/** The table's hulks and craters switched at once, where the table has them (a game on the 3D table). */
function giveMarks(options: { hulks?: boolean; craters?: boolean }): void {
  const table = (window as { __table?: { marks?: { set?: (o: { hulks?: boolean; craters?: boolean }) => void } } }).__table;
  table?.marks?.set?.(options);
}

/** The table takes a new detail at once where it can: true when it did. */
function giveDetail(detail: Detail): boolean {
  const table = (window as { __table?: { setTier?: (name: string | null) => void } }).__table;
  if (typeof table?.setTier !== 'function') return false;
  table.setTier(TIER_OF[detail]);
  return true;
}
