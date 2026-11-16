// The new client's one page. It routes on the query string:
//   /?view=mapart&map=<id>[&bare=1]   the baked map viewer (Milestone 3a)
//   /?view=bake                       the bake harness that `npm run bake` drives
//   /?view=table&map=<id>[&bare=1]    the board on the table (Milestone 4a), with the counters (4b)
//   /?view=table&game=1[&seed=<n>][&sides=..]   the game played on the table's counters
//   /?view=game[&seed=<n>][&sides=..] the game on the flat bench (game/bench.ts)
//   a game takes &music=0 (no music on this page) or &music=1
//   the table takes &sfx=0 (no sound effects on this page)
//   anything else                     the placeholder page
// A game's panel is dressed in the interface skin (uiart/) unless the address says skin=0: it is then the
// panel's own grey-box.
// The two map views load no framework: they go straight to the bake worker.
import { listenForFullscreenKey } from './game/fullscreen';
import { VERSION } from './version';
import { woodFromAddress } from './scene/woods';

const root = document.getElementById('root') as HTMLElement;

// The build says what version it is: <html data-version="v0.0.7">, or "dev" where it was not published.
document.documentElement.dataset['version'] = VERSION;

// The page has no icon file; an empty one stops the browser asking for /favicon.ico (a 404 is a console error).
if (!document.querySelector('link[rel="icon"]')) {
  const icon = document.createElement('link');
  icon.rel = 'icon';
  icon.href = 'data:,';
  document.head.appendChild(icon);
}
// Alt+Enter (Option+Enter on a Mac) takes the page to the whole screen and back, on every screen (game/fullscreen.ts).
listenForFullscreenKey();

const params = new URLSearchParams(window.location.search);
const view = params.get('view');

// The units' pictures and words (the painted previews, the silhouettes, a role line and a description by unit
// type). Fetched once, beside whichever view wants them; a failure leaves the view with numbers and plain blocks.
let unitArtModule: Promise<typeof import('./unitart') | null> | null = null;
/** The short name a unit type's counter prints, from the unit art's data. */
const counterLabel = (art: typeof import('./unitart')) => (type: string): string | null => art.unitArt(type)?.counter ?? null;
const unitArtOnce = (): Promise<typeof import('./unitart') | null> =>
  (unitArtModule ??= import('./unitart').then(
    m => m,
    (err: unknown) => {
      console.error(err);
      return null;
    },
  ));

// The interface skin: the panel's dressed look. Fetched beside the game, never before it; `skin=0`, or a failure,
// leaves the panel in its grey-box, which is complete by itself.
const wantsSkin = params.get('skin') !== '0';
const panelSkinOnce = (): Promise<import('./game/hud').PanelSkin | null> =>
  wantsSkin
    ? import('./uiart').then(
        m => m.panelSkin(),
        (err: unknown) => {
          console.error(err);
          return null;
        },
      )
    : Promise.resolve(null);

// The music (the owner's own pieces: client/src/audio), fetched beside a game and handed to the game's panel, which
// shows its controls in the menu and switches it on key S. `music=0` in the address keeps it off for this page. A
// script that checks the menu may put a stand-in on the window before the game starts (`window.__music`): it is
// then the one handed on, and the player is not fetched.
let musicStarted: Promise<import('./game/hud').MusicControls | null> | null = null;
const musicOnce = (): Promise<import('./game/hud').MusicControls | null> =>
  (musicStarted ??= window.__music
    ? Promise.resolve(window.__music)
    : import('./audio').then(
        m => {
          const music = m.loadMusic(params);
          if (music) window.__music = music;
          return music;
        },
        (err: unknown) => {
          console.error(err);
          return null;
        },
      ));

if (view === 'mapart') {
  void import('./mapart/viewer').then(m => m.startViewer(root, params));
} else if (view === 'bake') {
  void import('./bake/harness').then(m => m.startHarness(root));
} else if (view === 'table') {
  // The table and the game know nothing of each other: this page joins them. With game=1 the game
  // layer is fetched when the counters are on the table, and drives them through their port.
  const game = params.has('game') && params.get('game') !== '0';
  // A black cover from the first moment until the board is drawn (and, for a game, framed with its briefing open),
  // then eased away: what loads is never seen half made (the owner: "shows a close up of a map with no grid, then it
  // flashes ... Verry jarring. We could do black screen overlay - fade in if we're still loading stuff."). An error
  // lifts it at once, so that its message is seen; nothing waits on it for more than 30 s.
  {
    const cover = document.createElement('div');
    cover.style.cssText = 'position:fixed;inset:0;background:#000;z-index:2147483000;opacity:1;transition:opacity .7s ease;pointer-events:none';
    document.body.append(cover);
    const began = performance.now();
    let settledAt = 0;
    const lift = (fast: boolean): void => {
      cover.style.transition = fast ? 'none' : cover.style.transition;
      cover.style.opacity = '0';
      window.setTimeout(() => cover.remove(), fast ? 0 : 800);
    };
    const watch = (): void => {
      const t = window.__table;
      if (t?.error) return lift(true);
      const drawn = !!t?.ready && (!game || !!window.__game);
      if (drawn && settledAt === 0) settledAt = performance.now();
      // A few frames more once all is there, so that the game's first framing of the board has been drawn.
      if (settledAt > 0 && performance.now() - settledAt > 250) return lift(false);
      if (performance.now() - began > 30000) return lift(false);
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  }
  // A game's scenario names its board. When the address names a listed scenario and no board, the table
  // is given that scenario's own (the address is rewritten in place, so a reload and a shared link agree).
  const boardOfScenario: Promise<void> = game && params.has('scenario') && !params.has('map')
    ? import('./game/scenarios').then(m => {
        const listed = m.SCENARIOS.find(s => s.id === params.get('scenario'));
        if (!listed) return;
        params.set('map', listed.map);
        const here = new URL(window.location.href);
        here.searchParams.set('map', listed.map);
        window.history.replaceState(null, '', here);
      }, (err: unknown) => { console.error(err); })
    : Promise.resolve();
  // The counters' silhouettes are fetched beside the table's own code, never before it: the table starts with
  // plain blocks and prints the silhouettes when they have arrived.
  const silhouettes = unitArtOnce().then(art => (art ? art.loadSilhouettes() : new Map<string, never>()));
  // The counter tray (its mesh and its picture) is fetched the same way, where the page will have counters to
  // lose: the table starts without it and stands it beside the boards when it has arrived. A failure leaves
  // the table as it was without a tray.
  const wantsTray = params.get('pieces') !== '0' && params.get('tray') !== '0';
  const tray = wantsTray
    ? import('./tableart').then(
        m => m.loadTray(),
        (err: unknown) => {
          console.error(err);
          return null;
        },
      )
    : Promise.resolve(null);
  // The table's scanned wood (client/src/tableart/wood.ts), fetched the same way when the address says wood=1 (off until
  // the table's second pass, 2026-11-14): the table starts with the wood it draws itself and takes the scanned one when it
  // has arrived.
  const woodName = woodFromAddress(params.get('wood')); // wood=1 the first pass's teak, or wood=cherry|table|teak (scene/woods.ts)
  const wood = woodName ? import('./tableart/wood').then(m => m.loadWood(woodName), (err: unknown) => { console.error(err); return null; }) : Promise.resolve(null);
  // ---- effects: begin (the table's fire, blast and smoke; client/src/scene/fx) ----
  // Their pictures are fetched the same way, unless the address says fx=0: the table starts with the effects it
  // draws itself and takes the pictures when they have arrived. A failure leaves it with those it draws itself.
  const fx =
    params.get('fx') !== '0'
      ? import('./fxart').then(
          m => m.loadFx(),
          (err: unknown) => {
            console.error(err);
            return null;
          },
        )
      : Promise.resolve(null);
  // ---- effects: end ----
  // ---- sound effects: begin (client/src/audio: sfx.ts the engine, joins.ts and panel.ts what it is joined to, sounds.ts the loader) ----
  // Fetched beside the table's own code unless the address says sfx=0. Nothing sounds, and no recording is
  // fetched, before the page is touched. The table's effects reach it through `onEffect`; a game's counters
  // through their port, which the game is handed with sound added; the panel through its root element; and the
  // panel's one switch for the music (key S, the menu's Music row) silences and restores the effects with it.
  // A failure leaves the page as it was without sound effects.
  const sounds: Promise<import('./audio/sounds').Sounds | null> =
    params.get('sfx') !== '0'
      ? import('./audio/sounds').then(
          m => m.loadSounds(params, () => window.__table?.map ?? null),
          (err: unknown) => {
            console.error(err);
            return null;
          },
        )
      : Promise.resolve(null);
  // ---- sound effects: end ----
  void Promise.all([import('./scene/table'), boardOfScenario]).then(([m]) => {
    // With a game, the page takes the table's own controls and hands them to the game's panel, which shows
    // them in its map pop-out: the table then draws no buttons, and its letters and digits are the game's.
    let controls: import('./scene/table').TableControls | null = null;
    m.startTable(root, params, {
      unitArt: { silhouettes },
      tray,
      wood, // the table's scanned wood
      room: name => import('./tableart/env').then(m => m.loadRoom(name), (err: unknown) => { console.error(err); return null; }), // the room round the table (env=)
      fx, // effects
      onEffect: e => void sounds.then(s => s?.effect(e)), // sound effects
      // hulks and craters: their pictures, fetched only when the table asks (a game with a kind of mark switched on)
      marks: () => import('./marksart').then(m => m.loadMarks(), (err: unknown) => { console.error(err); return null; }),
      ...(game
        ? {
            onControls: (c: import('./scene/table').TableControls) => {
              controls = c;
            },
          }
        : {}),
      onPieces: port => {
        if (!game) return;
        void Promise.all([import('./game/start'), import('./game/inks'), unitArtOnce(), panelSkinOnce(), musicOnce(), sounds /* sound effects */]).then(([play, inks, art, skin, music, sfx]) => {
          const panel = document.createElement('div');
          root.appendChild(panel);
          inks.setInks(panel);
          // sound effects: the game is handed the counters' port and the music with sound added, and the panel is listened to
          const heard = sfx ? sfx.game({ port, panel, music }) : { port, music, heard: null };
          // The game's menu lays the settings over the game, which waits behind them (shell/settings-overlay.ts).
          window.__gameSettings = {
            open: done => void import('./shell/settings-overlay').then(o => o.openSettingsOverlay(root, params, { music: heard.music ?? null, sound: sfx?.sfx ?? null, done }), (err: unknown) => { console.error(err); done(); }),
            // The game's menu's About: the settings' About panel alone, over the paused game.
            about: done => void import('./shell/settings-overlay').then(o => o.openSettingsOverlay(root, params, { music: heard.music ?? null, sound: sfx?.sfx ?? null, done, about: true }), (err: unknown) => { console.error(err); done(); }),
          };
          // The game's unit card shows a type's picture and words; the game layer holds no art and is handed the lookup.
          play.startGame({
            pieces: heard.port, // sound effects
            panel,
            params,
            ...(art ? { art: art.unitArt, label: counterLabel(art) } : {}),
            ...(skin ? { skin } : {}),
            ...(controls ? { map: controls } : {}),
            ...(heard.music ? { music: heard.music } : {}), // sound effects
            ...(heard.heard ? { heard: heard.heard } : {}), // sound effects: the dice
          });
        });
      },
    });
  });
} else if (view === 'game') {
  void Promise.all([import('./game/bench'), unitArtOnce(), panelSkinOnce(), musicOnce()]).then(([m, art, skin, music]) => {
    m.startBench(root, params, art ? art.unitArt : undefined, art ? counterLabel(art) : undefined, { ...(skin ? { skin } : {}), ...(music ? { music } : {}) });
  });
} else {
  // ---- title: begin (the title and main-menu screen; client/src/shell) ----
  // The screen at `/`. It takes seed=<n>, t=<seconds> (a still), motion=0, fx=0, marks=1, and music= and sfx= as a game does.
  void import('./app').then(m => m.startApp(root, params));
  // ---- title: end ----
}
