/**
 * The title and main-menu screen: the page at `/`.
 *
 * The owner's painting in layers with our own smoke, fire and cannon shots between them
 * (backdrop.ts), and his menu over it (menu.ts). Play Scenario leads to the scenario list, Multiplayer
 * to the same list for a game played online by a shared link (side-screen.ts makes it), Settings
 * to the settings screen (app.tsx shows one screen at a time). It needs neither the board, the bake
 * nor the game: only its own art, the game's effect pictures and the game's sound (sound.ts, which
 * the shell starts), each fetched after the menu is up.
 *
 * It is a screen on the stage (stage.ts, stage-dom.ts): laid out in the stage's own pixels, which
 * are the painting's, and fitted to the window with the stage as one thing, on a black page. While
 * another screen covers it, its picture's clock stands and nothing is drawn.
 *
 * In the address:
 *   seed=<n>     the seed of everything that moves (the same seed, the same battle)
 *   t=<seconds>  the clock stands at this time and nothing moves: a still, for captures
 *   motion=0     as for a viewer who asks for less motion: still but for a slow drift of smoke
 *   fx=0         without the effect pictures (the painting drifts; flashes, tracers and embers remain)
 *   marks=1      draws every place of places.ts on the picture
 *   version=<v>  the nameplate shows this in place of the build's own version (to see how one fits)
 *   music=0, music=1, sfx=0   as in the game
 *   play=0       without the PLAY GAME medallion: the menu at once (for scripts and captures)
 *
 * A page that opens here and has not yet been touched shows the PLAY GAME medallion in the menu's
 * place (play.ts, waiting.ts); its press starts the music and brings the menu in.
 */
import { gameAddress } from './address';
import { loadPicture } from './art';
import { startBackdrop } from './backdrop';
import type { BackdropOptions, BackdropState } from './backdrop';
import { readBooks } from './books';
import { layoutOf } from './layout';
import { buildMenu } from './menu';
import { buildPlay } from './play';
import type { Play, PlayState } from './play';
import { placeOf } from './places';
import type { PlateId } from './plates';
import type { Screen, Shell } from './screen';
import { seedFrom } from './seeded';
import type { Settings, SettingsModel } from './settings';
import { onWindow } from './stage';
import type { StageFit } from './stage';
import { Timetable } from './timetable';
import type { TitleEvent } from './timetable';
import { playWaits } from './waiting';
import { GAME, versionShown } from './words';
import { VERSION } from '../version';

/** The seed when the address gives none: the same battle on every visit. */
const SEED = 1943;

declare global {
  interface Window {
    /** The title screen, for checks and for the console. */
    __title?: {
      seed: number;
      /** The picture's counts and clock (frames drawn, whether it runs, bright events so far, what a frame costs). */
      picture: BackdropState;
      /** The stage as it is fitted to the window now: its scale, its place, its size. */
      fit(): StageFit;
      settings: SettingsModel;
      /** The game's address with the settings as they are now (the side selector adds the scenario and the side). */
      gameAddress(): string;
      /** The plate in hand. */
      plate(): PlateId;
      /** The timetable: what starts from `from` up to `to` seconds of the screen's clock. */
      events(from: number, to: number): TitleEvent[];
      /** Where an event's place lies in the window now (CSS pixels; the layers' drift apart). */
      where(e: { kind: TitleEvent['kind']; place: number }): [number, number];
      /** With `t=` in the address: stands the clock at another time and draws that moment. */
      seek(t: number): void;
      /** The PLAY GAME medallion: whether it waits for its press, and what it shows (all false and none when there is none). */
      play(): PlayState;
      /** For captures: the live medallion's clock stands at this time and that moment is drawn (null: it runs again). */
      stand(t: number | null): void;
    };
  }
}

export function buildTitle(shell: Shell): Screen {
  const { stage, params, model, sound, art } = shell;
  const screen = document.createElement('div');
  screen.className = 'sh-root sh-screen';
  const canvas = document.createElement('canvas');
  canvas.className = 'sh-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const heading = document.createElement('h1');
  heading.className = 'sh-sr';
  heading.textContent = `${GAME.name}: ${GAME.subtitle}`;
  screen.append(canvas, heading);
  stage.element.appendChild(screen);

  const less = window.matchMedia('(prefers-reduced-motion: reduce)');
  const frozen = params.get('t');
  const frozenAt = frozen !== null && Number.isFinite(Number(frozen)) && Number(frozen) >= 0 ? Number(frozen) : null;
  const options: BackdropOptions = {
    canvas,
    art,
    seed: seedFrom(params.get('seed'), SEED),
    reduced: params.get('motion') === '0' || less.matches,
    frozenAt,
    marks: params.get('marks') === '1',
    onEvent: (e, pan, onScreen) => sound.event(e, pan, onScreen),
  };
  // A still is at rest: the interface does not come in.
  if (frozenAt !== null) screen.classList.add('sh-still');
  const backdrop = startBackdrop(options);
  less.addEventListener('change', () => {
    options.reduced = params.get('motion') === '0' || less.matches;
    screen.classList.toggle('sh-less', options.reduced);
    play?.setReduced(options.reduced);
  });
  screen.classList.toggle('sh-less', options.reduced);

  // ---- the interface ---------------------------------------------------------------------------

  const menu = buildMenu({
    root: screen,
    art,
    address: shell.address,
    version: versionShown(VERSION, params.get('version')),
    onPress(id) {
      sound.ui('press');
      if (id === 'scenario') shell.go('scenarios', { online: false });
      // Multiplayer: the same list and side selector, which then make a game to play online (side-screen.ts).
      else if (id === 'multiplayer') shell.go('scenarios', { online: true });
      // Play Campaign: the campaign list, then the campaign's briefing room (campaign-list.ts, campaign-room.ts).
      else if (id === 'campaign') shell.go('campaigns', { online: false });
      else if (id === 'settings') shell.go('settings');
    },
    onRefused() {
      sound.ui('refuse');
    },
  });

  // ---- the screen on the stage ------------------------------------------------------------------

  const layout = layoutOf(art);

  // ---- the PLAY GAME medallion, while the page waits for its first press ---------------------------

  const touched = 'userActivation' in navigator && navigator.userActivation.hasBeenActive;
  let play: Play | null = null;
  if (playWaits(params, touched)) {
    screen.classList.add('sh-waiting');
    menu.setInert(true);
    const made = buildPlay({
      root: screen,
      art,
      layout,
      address: shell.address,
      clock: () => backdrop.now(),
      seed: options.seed,
      fit: () => stage.fit(),
      reduced: options.reduced,
      model: (model.get() as Settings).detail !== 'low',
      onPress() {
        sound.ui('press');
        // The menu's own entry, with the hand on Play Scenario.
        comeIn();
        menu.focus('scenario');
      },
    });
    play = made;
    // A press anywhere else on the painting only makes it flare: the music waits for the medallion (sound.ts).
    screen.addEventListener('pointerdown', e => {
      if (made.counts().waiting && !(e.target instanceof Element && e.target.closest('.sh-play'))) made.elsewhere();
    });
  }
  /** The menu comes in (its own entry), and the medallion is no longer waited for. */
  function comeIn(): void {
    screen.classList.remove('sh-waiting');
    menu.setInert(false);
  }

  // Everything is placed once, in stage pixels: a new size of window only fits the stage again, and
  // the canvas, which fills the stage, is given the stage's new size in the display's pixels.
  menu.place(layout);
  stage.onFit(fit => {
    backdrop.resize(fit.pixels);
    play?.resize(fit);
  });

  // ---- what is fetched after the menu is up ------------------------------------------------------

  void Promise.all([loadPicture(art.battlefield.file), loadPicture(art.tanks.file), loadPicture(art.title.file)]).then(
    ([battlefield, tanks, title]) => {
      backdrop.setPictures({ battlefield, tanks, title });
      // The medallion's 3D model is fetched only now: the painting comes first.
      play?.pictureUp();
    },
    (err: unknown) => console.error(err),
  );
  if (params.get('fx') !== '0') {
    void import('../fxart')
      .then(m => m.loadFx())
      .then(loaded => {
        if (!loaded) return;
        const { books } = readBooks(loaded.manifest);
        backdrop.setFx({ books, atlases: loaded.atlases.map(a => a.image) });
      })
      .catch((err: unknown) => console.error(err));
  }

  window.__title = {
    seed: options.seed,
    picture: backdrop.state,
    fit: () => stage.fit(),
    settings: model,
    gameAddress: () => gameAddress(model.get() as Settings, window.location.pathname),
    plate: () => menu.current(),
    events: (from, to) => new Timetable(options.seed).between(from, to),
    where: e => onWindow(stage.fit(), ...placeOf(e.kind, e.place)),
    seek: t => backdrop.seek(t),
    stand: t => play?.stand(t),
    play: () => play?.counts() ?? { waiting: false, shown: false, hot: false, look: '2d', model: 'none', modelFrames: 0, modelDrawMs: 0, burn: 0, embers: 0, glow: 0, sweeping: false, modelRested: 0, modelGpuMs: -1, modelDetail: 1, pressedAt: null, pulses: 0 },
  };

  return {
    id: 'title',
    element: screen,
    show(_q, note) {
      backdrop.pause(false);
      play?.pause(false);
      // While the medallion waits, it alone is there to press.
      if (play?.counts().waiting) return;
      menu.setInert(false);
      // Back from another screen, the hand is on the plate that led there.
      const was = shell.current();
      menu.focus(was === 'settings' ? 'settings' : was === 'scenarios' || was === 'side' ? 'scenario' : undefined);
      if (note) menu.say(was === 'settings' ? 'settings' : menu.current(), note);
    },
    hide() {
      backdrop.pause(true);
      menu.setInert(true);
      play?.pause(true);
      // Left another way while it waited (the browser's Forward): it is not waited for again, and the sound is let go.
      if (play?.counts().waiting) {
        play.drop();
        comeIn();
        menu.setInert(true);
      }
    },
    key: e => (play?.counts().waiting ? play.key(e) : menu.key(e)),
  };
}
