/**
 * The panel: plain DOM over the board, drawn only from the presentation model
 * (model.ts). It knows no rule and asks nothing of a game but `press(id)` for
 * a control's id, `take` for a group to go to or a unit to place, and `pick`
 * for a click on a unit in a list.
 *
 * Always on screen, and nothing else:
 *   top centre      ONE status plate (whose turn, turn N of M with a tick a turn, the score), and
 *                   ONE box of words hanging under it: where you are in the turn, what a click means now,
 *                   what to do, why; the answer to the last thing done (done, or refused and why); and
 *                   what a click where the pointer is would do
 *   bottom centre   the commands possible now, by the mode of play (model.ts Mode); on the viewer's
 *                   own turn the row begins with a button for each group of its units (its number
 *                   and key, how many of its units can still act of how many; lit when it is the
 *                   active group, the group in hand, which is always exactly one of them): a press
 *                   makes that group the active one, goes to it, and chooses no unit
 *
 * Everything else is opened and closed by the player, and stays as the player left it:
 *   top left        the corner buttons: menu, teaching notes, scenario briefing, rule book, map controls
 *   right edge      the notebook: pages Unit, Odds, Log, Keys on its tabs (hud-book.ts)
 *   bottom left     the folder of the viewer's groups (hud-book.ts): one short line a group, and
 *                   only the active group open, its units listed as plain names
 *   the middle      the full panels: briefing, rule book (hud-full.ts)
 *
 * Nothing shows or hides by itself. What changes by itself is what a part
 * says, and the row of commands, which follows the mode of play. Two things
 * come with the game and not with a click: the briefing lies open before the
 * first turn (it is how a game begins), and the result is laid down when the
 * game ends.
 *
 * Two modes on one key (I, or F1): with the teaching notes on, every command
 * carries its name, the commands that are not possible now are shown dashed,
 * the box of words adds the steps of the turn and the why, numbered notes
 * point at each part and a legend names the board's tints. With them off,
 * the edge parts alone.
 *
 * The look here is the grey-box (hud-css.ts): flat tones mixed from the
 * board's ink table. A page may hand in a skin (PanelSkin): a stylesheet laid
 * over the grey-box, and pictures for the sides' marks and the scenario. The
 * layer holds no art of its own.
 *
 * Every button answers a press. It takes the pressed look while it is held, and for a tenth of a
 * second at least, by the pointer or by its key, whether or not its thing is possible. A control that
 * is not possible now is drawn so, says why in its tooltip, and still passes the press to the game
 * (which answers it with a refusal); the button shakes. No click is swallowed.
 *
 * Its root lets every pointer event through; only its own parts take them.
 */
import { makeFolder, makeNotebook, PAGES } from './hud-book';
import type { PageId, UnitPicture } from './hud-book';
import { HUD_CSS } from './hud-css';
import { button, el, isOff, keycap, markOf, setEnabled, setStock, setText } from './hud-dom';
import { makeBriefing, makeResult, makeRuleBook } from './hud-full';
import { hasIcon, icon } from './hud-icons';
import { FULLSCREEN_KEY, canFullscreen, isFullscreen, onFullscreen, toggleFullscreen } from './fullscreen';
import { setInks } from './inks';
import { setPaused } from './pause';
import { claimsOf, keyName, keySections, panelKey } from './keys';
import type { KeyLine } from './keys';
import { makeLeave } from './hud-leave';
import type { LeaveWords } from './leave';
import type { ControlModel, GameModel, GroupModel, Mode } from './model';

export type { UnitPicture } from './hud-book';

/** The dressed look, handed in by the page. Without one the panel is the grey-box, complete and usable. */
export interface PanelSkin {
  /** A stylesheet laid over the grey-box one: every rule in it is written under `.wg-hud.wg-skin`. */
  readonly css: string;
  /** The address of a mark's picture by the mark's id, for the status plate or for a force's header in the briefing; null: the drawn mark. */
  mark(id: string, where: 'plate' | 'header'): string | null;
  /** The address of a picture by its id (a scenario's picture), or null. */
  picture(id: string): string | null;
}

/** One of the map's own switches or actions: `on` is null for an action, true or false for a switch. */
export interface MapControl {
  readonly id: string;
  readonly label: string;
  /** The key that does the same, as printed on a cap; '' when it has none. */
  readonly key: string;
  readonly on: boolean | null;
}

/** The map's controls, as the page that shows the board hands them to the panel (the table's own; this layer imports nothing of it). */
export interface MapControls {
  list(): readonly MapControl[];
  press(id: string): void;
  /** Calls `fn` whenever a control's state may have changed; returns a function that stops the calls. */
  onChange(fn: () => void): () => void;
  /** The map's keys as lines, for the Keys page. */
  readonly keys: readonly KeyLine[];
  /** The colours the board tints hexes with, by kind (reach, target, path, objective, zone, and `reach-near` for the nearer part of a reach), as CSS colours, for the legend. Absent: no legend. */
  readonly tints?: readonly { readonly kind: string; readonly colour: string }[];
  /** Put the board's view, at once, where these hexes are all in it: asked once as a game starts, so that it opens on its counters. Absent: the board keeps its own view. */
  frame?(hexes: readonly number[]): void;
  /** Take the board's view, eased, to where these hexes are all in it (the board keeps its zoom when they fit, and runs out only as far as they need). Absent: the board stays where it is. */
  goTo?(hexes: readonly number[]): void;
}

/** The music, as the page hands it to the panel: what is true now, and what a player can change. */
export interface MusicControls {
  /** `title` is the piece playing or about to play; null when there is none. `volume` is 0 to 1. `playing`: a piece sounds now. */
  state(): { readonly on: boolean; readonly volume: number; readonly title: string | null; readonly playing: boolean };
  setOn(on: boolean): void;
  setVolume(volume: number): void;
  next(): void;
  /** Calls `fn` whenever the state changes; returns a function that stops the calls. */
  onChange(fn: () => void): () => void;
}

export interface HudActions {
  press(id: string): void;
  /** The picture and words of a unit type, by the id on its counter's face (`face.art`). Absent, or null for a type: numbers only. */
  art?(type: string): UnitPicture | null;
  /** A click on a unit waiting to be placed, or a press of a group (it is gone to). Absent: they are shown and cannot be clicked. */
  take?(kind: 'unit' | 'group', id: string): void;
  /** A click on one of a group's units in the folder: it is chosen, as by a click on its counter, and gone to. Absent: the units are shown and cannot be clicked. */
  pick?(unit: string): void;
  skin?: PanelSkin;
  map?: MapControls;
  music?: MusicControls;
  /** False: the briefing is not laid open before the first turn (it is still behind its button). */
  briefFirst?: boolean;
  /** Called once: when the briefing shown before the first turn is put away, or at the first model when none is shown. The game may begin. */
  begin?(): void;
  /**
   * The menu's Main menu: `ask` gives the words of the question it asks first (leave.ts), or null when there is nothing
   * to ask (the battle is over); `go` ends the battle and goes to the title. Absent: it goes to the title at once.
   */
  leave?: { ask(): LeaveWords | null; go(): void };
}

/** What the player has open, for scripts and checks. */
export interface PanelState {
  /** The teaching notes are on. */
  overlay: boolean;
  /** The notebook's open page, or null when it is shut. */
  notebook: PageId | null;
  folder: boolean;
  pop: 'menu' | 'map' | null;
  full: 'brief' | 'rules' | 'result' | null;
  /** The interface scale in use. */
  scale: number;
  /** The settings lie over the game (opened from the menu), and it is paused behind them. */
  settings: boolean;
  /** Main menu's question is up (leave.ts), and the game is paused behind it. */
  leave: boolean;
}

declare global {
  interface Window {
    /**
     * Where the page can lay the settings over a game in progress (main.tsx sets it): `open` lays them over the game, and
     * `done` is called when they are put away. Absent: the menu's Settings goes to the settings screen and back.
     */
    __gameSettings?: { open(done: () => void): void; about?(done: () => void): void };
    /** What the table keeps its pointer's label clear of (scene/fx/answers.ts declares it too): this panel's box of words. */
    __tableAvoid?: () => readonly { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }[];
  }
}

export interface Hud {
  draw(model: GameModel): void;
  /**
   * A key, before the game hears it: true when the panel took it (the game must not hear it). Escape
   * closes a full panel, else a pop-out, and with neither open is not taken (the game steps back).
   */
  key(key: string): boolean;
  state(): PanelState;
  dispose(): void;
}

/** The design's stage, and how far the interface scale may go either way. */
const STAGE: readonly [number, number] = [1440, 900];
const SCALE_MIN = 0.75;
const SCALE_MAX = 2;

/** Which commands the main row holds in each mode, in order; a control of the model that is not listed for its mode is left out. */
const MAIN: Readonly<Record<Mode, readonly string[] | null>> = {
  setup: null,
  act: ['confirm', 'next', 'end', 'back'],
  watch: ['fast'],
  over: ['again', 'reseed'],
};

const COACH: readonly string[] = [
  'Whose turn it is, the turn number, and the score.',
  'This box always says what you can do now. Read it when you are unsure.',
  'Everything you can do now, each with its key. A grayed-out command is not possible now.',
  'The notebook: the unit\u2019s page, the odds before you act, the log and the keys. It stays open until you close it.',
  'These buttons open the scenario briefing, the rule book and the map controls.',
];

const TINT_WORDS: Readonly<Record<string, string>> = { reach: 'Can reach', target: 'Can fire at', path: 'Path', objective: 'Objective', zone: 'Your set-up zone' };

function coach(n: number, side: 'left' | 'right' | 'up' | 'down'): HTMLDivElement {
  const note = el('div', `wg-coach wg-paper wg-${side}`);
  note.dataset['note'] = String(n);
  note.append(el('b', '', String(n)), document.createTextNode(COACH[n - 1] ?? ''));
  return note;
}

export function mountHud(root: HTMLElement, actions: HudActions): Hud {
  if (!document.head.querySelector('style[data-wg-hud]')) {
    const style = document.createElement('style');
    style.dataset['wgHud'] = '1';
    style.textContent = HUD_CSS;
    document.head.appendChild(style);
  }
  const skin = actions.skin ?? null;
  let skinStyle: HTMLStyleElement | null = null;
  if (skin) {
    skinStyle = document.createElement('style');
    skinStyle.dataset['wgSkin'] = '1';
    skinStyle.textContent = skin.css;
    document.head.appendChild(skinStyle);
  }
  const markPicture = skin ? (id: string, where: 'plate' | 'header'): string | null => skin.mark(id, where) : null;
  const map = actions.map ?? null;
  const music = actions.music ?? null;

  const hud = el('div', skin ? 'wg-hud wg-skin' : 'wg-hud');
  hud.dataset['part'] = 'panel';
  setInks(hud);
  root.appendChild(hud);

  // ---- what the player has open ----
  let overlay = false;
  let page: PageId = 'unit';
  let notebookOpen = false;
  let folderOpen = false;
  let pop: 'menu' | 'map' | null = null;
  /** The settings lie over the game (opened from the menu, where the page can): the game is paused behind them. */
  let settingsOpen = false;
  let full: 'brief' | 'rules' | 'result' | null = null;
  /** The briefing shown before the first turn has been put away (or there was none): the game has begun. */
  let begun = false;
  let hasFolder = false;
  let scale = 1;
  let last: GameModel | null = null;
  let first = true;
  let wasOver = false;

  // ---- the corner buttons ----
  const corners = el('div', 'wg-corners');
  corners.dataset['part'] = 'corners';
  const cornerBox = (id: string, title: string, act: () => void): { box: HTMLDivElement; btn: HTMLButtonElement } => {
    const box = el('div', 'wg-cornerbox');
    const btn = button('wg-corner wg-steel wg-riv', act);
    btn.dataset['corner'] = id;
    btn.title = title;
    btn.append(icon(id));
    box.append(btn);
    corners.append(box);
    return { box, btn };
  };
  const menuBox = cornerBox('menu', 'Menu', () => setPop(pop === 'menu' ? null : 'menu'));
  menuBox.box.dataset['part'] = 'menu';
  const modeBox = cornerBox('mode', 'Teaching notes on / off (I)', () => setOverlay(!overlay));
  const briefBox = cornerBox('brief', 'Scenario briefing', () => setFull(full === 'brief' ? null : 'brief'));
  const rulesBox = cornerBox('rules', 'Rule book', () => setFull(full === 'rules' ? null : 'rules'));
  const mapBox = cornerBox('map', 'Map controls (W)', () => setPop(pop === 'map' ? null : 'map'));
  mapBox.box.dataset['part'] = 'map-controls';
  if (!map) mapBox.box.style.display = 'none';
  const menuPop = el('div', 'wg-pop wg-steel');
  menuBox.box.append(menuPop);
  const mapPop = el('div', 'wg-pop wg-steel');
  mapBox.box.append(mapPop);
  corners.append(coach(5, 'up'));

  // ---- the status plate and the box of words ----
  const mast = el('div', 'wg-mast');
  const plateWrap = el('div', 'wg-platewrap');
  const plate = el('div', 'wg-plate wg-wood');
  plate.dataset['part'] = 'status-plate';
  const who = el('div', 'wg-who');
  const seat = el('span', 'wg-seat');
  const whose = el('span');
  who.append(seat, whose);
  const turnCell = el('div', 'wg-cell');
  const turnNo = el('span');
  const turnOf = el('span', 'wg-of');
  const ticks = el('span', 'wg-ticks');
  turnCell.append(el('small', '', 'Turn'), turnNo, turnOf, ticks);
  const scoreCell = el('div', 'wg-cell');
  scoreCell.dataset['part'] = 'score';
  plate.append(who, turnCell, scoreCell);
  plateWrap.append(plate, coach(1, 'left'));
  const todoWrap = el('div', 'wg-todowrap');
  const todo = el('div', 'wg-todo wg-paper');
  todo.dataset['part'] = 'todo-box';
  // The box lies over the board's top rows: the table puts the label of what a click would do under its counter there,
  // where over it the box would hide it.
  window.__tableAvoid = () => {
    const r = todo.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? [r] : [];
  };
  const steps = el('div', 'wg-steps');
  const todoTitle = el('div', 'wg-t');
  const todoDo = el('div', 'wg-do');
  const todoWhy = el('div', 'wg-why');
  // The answer to the last thing done, and what a click where the pointer is would do: each line keeps its place when it has no words.
  const todoAnswer = el('div', 'wg-answer');
  todoAnswer.dataset['part'] = 'answer';
  todoAnswer.dataset['kind'] = '';
  const answerText = el('span');
  todoAnswer.append(icon('close', true), answerText);
  const todoIntent = el('div', 'wg-intent');
  todoIntent.dataset['part'] = 'intent';
  todo.append(steps, todoTitle, todoDo, todoWhy, todoAnswer, todoIntent);
  todoWrap.append(todo, coach(2, 'right'));
  const problem = el('div', 'wg-problem wg-paper');
  problem.dataset['part'] = 'problem';
  mast.append(plateWrap, todoWrap, problem);

  // ---- the commands ----
  const acts = el('div', 'wg-actions');
  acts.dataset['part'] = 'commands';
  const legend = el('div', 'wg-legend wg-paper');
  const ctxRow = el('div', 'wg-row');
  ctxRow.dataset['row'] = 'unit';
  const mainRow = el('div', 'wg-row');
  mainRow.dataset['row'] = 'main';
  acts.append(legend, ctxRow, mainRow, coach(3, 'left'));

  // ---- the notebook, the folder, the full panels ----
  const notebook = makeNotebook({
    art: actions.art ? type => actions.art?.(type) ?? null : null,
    onTab: p => setNotebook(notebookOpen && page === p ? null : p),
    onClose: () => setNotebook(null),
  });
  const folder = makeFolder({
    onTab: () => setFolder(!folderOpen),
    take: actions.take ? (kind, id) => actions.take?.(kind, id) : null,
    pick: actions.pick ? unit => actions.pick?.(unit) : null,
  });
  const note4 = coach(4, 'right');
  const catcher = el('div', 'wg-catch');
  const briefing = makeBriefing({
    art: actions.art ? type => actions.art?.(type) ?? null : null,
    mark: markPicture,
    picture: skin ? id => skin.picture(id) : null,
    onClose: () => setFull(null),
  });
  const rulebook = makeRuleBook({ onClose: () => setFull(null) });
  const result = makeResult({ press: id => actions.press(id), mark: markPicture, onClose: () => setFull(null) });
  // Main menu's question (leave.ts), over everything else of the panel.
  const leaveBox = makeLeave();

  hud.append(corners, mast, acts, folder.root, notebook.tabs, notebook.root, note4, catcher, briefing.root, rulebook.root, result.root, leaveBox.root);

  // ---- every button answers a press ----
  /** The pressed look: while the pointer holds the button, and a tenth of a second at least. */
  const PRESS_MS = 110;
  const pressed = new Map<Element, { held: boolean; due: boolean }>();
  const letGo = (b: Element): void => {
    const p = pressed.get(b);
    if (!p || p.held || !p.due) return;
    pressed.delete(b);
    b.classList.remove('wg-down');
  };
  const pressLook = (b: Element, held: boolean): void => {
    const was = pressed.get(b);
    if (was) {
      was.held = was.held || held;
      return;
    }
    const p = { held, due: false };
    pressed.set(b, p);
    b.classList.add('wg-down');
    window.setTimeout(() => {
      p.due = true;
      letGo(b);
    }, PRESS_MS);
  };
  /** A refusal: the button shakes. */
  const shake = (b: Element): void => {
    b.classList.remove('wg-shake');
    void (b as HTMLElement).offsetWidth;
    b.classList.add('wg-shake');
  };
  const buttonOf = (target: EventTarget | null): Element | null => (target instanceof Element ? target.closest('.wg-hud button') : null);
  const onDown = (e: PointerEvent): void => {
    const b = buttonOf(e.target);
    if (b) pressLook(b, true);
  };
  const onUp = (): void => {
    for (const [b, p] of [...pressed]) {
      p.held = false;
      letGo(b);
    }
  };
  const onClick = (e: MouseEvent): void => {
    const b = buttonOf(e.target);
    if (b && isOff(b)) shake(b);
  };
  hud.addEventListener('pointerdown', onDown, true);
  hud.addEventListener('click', onClick, true);
  hud.addEventListener('animationend', e => {
    if (e.animationName === 'wg-shake' && e.target instanceof Element) e.target.classList.remove('wg-shake');
  });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  // ---- one interface scale, from the window ----
  const fit = (): void => {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.min(w / STAGE[0], h / STAGE[1])));
    hud.style.setProperty('--wg-scale', scale.toFixed(4));
    hud.style.setProperty('--stage-h', `${(h / scale).toFixed(1)}px`);
    hud.classList.toggle('wg-narrow', w / scale < STAGE[0] - 0.5);
  };
  fit();
  window.addEventListener('resize', fit);

  // ---- opening and closing: the player's word alone ----
  const setOverlay = (on: boolean): void => {
    overlay = on;
    hud.classList.toggle('wg-overlay', on);
    modeBox.btn.classList.toggle('wg-lit', on);
  };
  const setNotebook = (p: PageId | null): void => {
    notebookOpen = p !== null;
    if (p !== null) page = p;
    notebook.show(p);
    hud.classList.toggle('wg-nb-open', notebookOpen);
    if (last) notebook.draw(last, keysOf(last));
  };
  const setFolder = (open: boolean): void => {
    folderOpen = open && hasFolder;
    folder.show(folderOpen);
  };
  const setPop = (which: 'menu' | 'map' | null): void => {
    pop = which === 'map' && !map ? null : which;
    menuBox.box.classList.toggle('wg-open', pop === 'menu');
    mapBox.box.classList.toggle('wg-open', pop === 'map');
    armed = null;
    if (pop === 'map') drawMap();
    if (pop === 'menu') drawMenu();
  };
  const setFull = (which: 'brief' | 'rules' | 'result' | null): void => {
    const was = full;
    full = which;
    briefing.show(full === 'brief');
    rulebook.show(full === 'rules');
    result.show(full === 'result');
    hud.classList.toggle('wg-full-open', full !== null);
    if (full !== null) setPop(null);
    if (was === 'brief' && full !== 'brief' && !begun) {
      begun = true;
      briefing.begun();
      actions.begin?.();
    }
  };

  // ---- the map's controls ----
  const drawMap = (): void => {
    if (!map) return;
    mapPop.textContent = '';
    for (const c of map.list()) {
      const tool = button(c.on === true ? 'wg-tool wg-on' : 'wg-tool', () => map.press(c.id));
      tool.dataset['tool'] = c.id;
      if (c.on !== null) tool.dataset['on'] = c.on ? '1' : '0';
      tool.title = c.key !== '' ? `${c.label} (${c.key})` : c.label;
      tool.append(icon(hasIcon(c.id) ? c.id : 'map', true), document.createTextNode(c.label));
      if (c.key !== '') tool.append(keycap(c.key));
      mapPop.append(tool);
    }
  };
  const stopMap = map ? map.onChange(() => {
    if (pop === 'map') drawMap();
  }) : null;

  // ---- the menu: the game's own switches and restarts, and the music ----
  /** A command of the menu that throws the game away asks to be pressed twice. */
  let armed: string | null = null;
  const VOLUME_STEPS = 10;
  let menuKey = '?';
  const drawMenu = (): void => {
    const m = last;
    // Made again only when what it shows has changed: a button is not taken from under a press.
    const now = JSON.stringify([m ? m.controls.filter(c => c.id === 'fast' || c.id === 'again' || c.id === 'reseed') : [], music ? music.state() : null, armed, isFullscreen()]);
    if (now === menuKey) return;
    menuKey = now;
    menuPop.textContent = '';
    if (m) {
      for (const c of m.controls) {
        if (c.id !== 'fast' && c.id !== 'again' && c.id !== 'reseed') continue;
        const tool = button(`wg-tool${c.on ? ' wg-on' : ''}${armed === c.id ? ' wg-armed' : ''}`, () => {
          if (c.id === 'fast' || armed === c.id) {
            armed = null;
            actions.press(c.id);
          } else {
            armed = c.id;
          }
          drawMenu();
        });
        tool.dataset['tool'] = c.id;
        if (c.id === 'fast') tool.dataset['on'] = c.on ? '1' : '0';
        setEnabled(tool, c.enabled, `${c.label} (${c.key})`, c.why ?? 'not possible now');
        tool.append(icon(c.id, true), document.createTextNode(armed === c.id ? `${c.label}: press again` : c.label), keycap(c.key));
        menuPop.append(tool);
      }
    }
    if (music) {
      const s = music.state();
      menuPop.append(el('div', 'wg-pophead', 'Music'));
      const onOff = button(s.on ? 'wg-tool wg-on' : 'wg-tool', () => music.setOn(!music.state().on));
      onOff.dataset['tool'] = 'music';
      onOff.dataset['on'] = s.on ? '1' : '0';
      onOff.append(icon('music', true), document.createTextNode('Music'), keycap('S'));
      const vol = el('div', 'wg-tool wg-vol');
      vol.dataset['tool'] = 'volume';
      const level = Math.round(Math.max(0, Math.min(1, s.volume)) * VOLUME_STEPS);
      vol.dataset['level'] = String(level);
      const stepTo = (n: number): void => music.setVolume(Math.max(0, Math.min(VOLUME_STEPS, n)) / VOLUME_STEPS);
      const quieter = button('wg-step', () => stepTo(level - 1));
      quieter.dataset['tool'] = 'quieter';
      quieter.title = 'Quieter';
      quieter.append(icon('quieter', true));
      const louder = button('wg-step', () => stepTo(level + 1));
      louder.dataset['tool'] = 'louder';
      louder.title = 'Louder';
      louder.append(icon('louder', true));
      const pips = el('span', 'wg-pips');
      pips.append(quieter);
      for (let i = 1; i <= VOLUME_STEPS; i++) {
        const pip = button(i <= level ? 'wg-full' : '', () => stepTo(i));
        pip.dataset['pip'] = String(i);
        pip.title = `Volume ${i} of ${VOLUME_STEPS}`;
        pips.append(pip);
      }
      pips.append(louder);
      vol.append(el('span', '', 'Volume'), pips);
      const next = button('wg-tool', () => music.next());
      next.dataset['tool'] = 'next-piece';
      next.append(icon('next', true), document.createTextNode('Next piece'));
      const title = s.title ?? '';
      const words = !s.on ? 'Music is off.' : title === '' ? 'No piece.' : s.playing ? title : `quiet · next: ${title}`;
      const piece = el('div', s.on && s.playing ? 'wg-poptext' : 'wg-poptext wg-quiet', words);
      piece.dataset['part'] = 'piece';
      menuPop.append(onOff, vol, next, piece);
    }
    // The page's own full screen (fullscreen.ts): the browser's tabs and bars go, and the game has the whole screen.
    // Alt+Enter does the same on every screen, and Esc leaves it.
    if (canFullscreen()) {
      const full = isFullscreen();
      const tool = button(full ? 'wg-tool wg-on' : 'wg-tool', () => toggleFullscreen());
      tool.dataset['tool'] = 'fullscreen';
      tool.dataset['on'] = full ? '1' : '0';
      tool.title = full ? 'Leave full screen (Esc or Alt+Enter)' : 'Full screen: the game alone on the screen, without the browser\'s bars (Alt+Enter)';
      tool.append(icon('whole', true), document.createTextNode(full ? 'Leave full screen' : 'Full screen'), keycap(FULLSCREEN_KEY));
      menuPop.append(tool);
    }
    // The settings screen (volumes, the computer's level, detail). It comes back to this game's address with the
    // settings written in, so the game starts again from its first turn with them.
    {
      // Where the page can lay the settings over the game (main.tsx: window.__gameSettings), they open here, over the paused
      // game, which goes on as it was when they are put away (the owner, 2026-11-14: "Going to the options panel in-game
      // resets the game"). A page without that goes to the settings screen and back, as before.
      const settings = button('wg-tool', () => {
        const over = window.__gameSettings;
        if (!over) {
          window.location.assign(`${window.location.pathname}?screen=settings&from=game`);
          return;
        }
        if (settingsOpen) return;
        setPop(null);
        settingsOpen = true;
        setPaused(true);
        over.open(() => {
          settingsOpen = false;
          setPaused(false);
        });
      });
      settings.dataset['tool'] = 'settings';
      settings.title = 'Settings: volumes, the computer opponent\'s level and the graphic detail';
      settings.append(icon('preset', true), document.createTextNode('Settings'));
      menuPop.append(settings);
    }
    // About: who made the game and with what (the settings' About panel, laid over the paused game alone). The owner,
    // 2026-11-15: "And from the menu in the main game."
    {
      const about = button('wg-tool', () => {
        const over = window.__gameSettings;
        if (!over?.about) {
          window.location.assign(`${window.location.pathname}?screen=settings&from=game&about=1`);
          return;
        }
        if (settingsOpen) return;
        setPop(null);
        settingsOpen = true;
        setPaused(true);
        over.about(() => {
          settingsOpen = false;
          setPaused(false);
        });
      });
      about.dataset['tool'] = 'about';
      about.title = 'About Panzer Kanone: who made it, and with what';
      about.append(icon('about', true), document.createTextNode('About'));
      menuPop.append(about);
    }
    // The way back to the title screen, last in the menu. A battle in progress is ended only when the player says so
    // (leave.ts): the question is asked first, and the game waits behind it. A battle that is over goes at once.
    {
      const title = button('wg-tool', () => {
        const way = actions.leave;
        if (!way) {
          window.location.assign(window.location.pathname);
          return;
        }
        const words = way.ask();
        if (words === null) {
          way.go();
          return;
        }
        setPop(null);
        setPaused(true);
        leaveBox.ask(words, choice => {
          if (choice === 'yes') way.go();
          else setPaused(false);
        });
      });
      title.dataset['tool'] = 'title';
      title.title = 'Main menu: end this battle and go to the title screen';
      title.append(icon('menu', true), document.createTextNode('Main menu'));
      menuPop.append(title);
    }
  };
  const stopFull = onFullscreen(() => {
    if (pop === 'menu') drawMenu();
  });
  const stopMusic = music ? music.onChange(() => {
    if (pop === 'menu') drawMenu();
  }) : null;

  // ---- drawing, part by part: each only when what it shows has changed ----
  const keysOf = (m: GameModel): ReturnType<typeof keySections> => keySections(m, map ? map.keys : [], { folder: hasFolder, map: map !== null, music: music !== null });

  let plateKey = '';
  let scoreKey = '';
  const drawPlate = (m: GameModel): void => {
    const b = m.banner;
    setStock(hud, b.stock);
    hud.classList.toggle('wg-enemy', m.mode === 'watch' && m.viewer !== null && m.result === null);
    setText(whose, b.turnOf);
    const key = `${b.mark ?? ''}|${b.stock ?? ''}|${b.turn}|${b.turns}`;
    if (key !== plateKey) {
      plateKey = key;
      seat.textContent = '';
      seat.append(markOf(b.mark, b.stock, markPicture, 'plate', true));
      setText(turnNo, String(b.turn));
      setText(turnOf, `of ${b.turns}`);
      ticks.textContent = '';
      for (let t = 1; t <= b.turns; t++) {
        const tick = el('i');
        if (t < b.turn) tick.className = 'wg-past';
        else if (t === b.turn) tick.className = 'wg-now';
        if (t === b.turns) tick.classList.add('wg-last');
        ticks.append(tick);
      }
    }
    const sides = m.score.sides;
    const now = JSON.stringify(sides.map(s => [s.seat, s.mark, s.stock, s.score]));
    if (now !== scoreKey) {
      const flashAll = scoreKey !== '' && sides.length > 0;
      scoreKey = now;
      scoreCell.textContent = '';
      sides.forEach((s, i) => {
        const n = el('span', i === 0 ? 'wg-n' : 'wg-n wg-b', String(s.score));
        n.dataset['seat'] = s.seat;
        n.title = `${s.name}: ${s.score}${s.note !== undefined ? ` (${s.note})` : ''}`;
        if (flashAll) n.classList.add('wg-flash');
        if (i === 0) scoreCell.append(markOf(s.mark, s.stock, markPicture, 'plate'), n);
        else scoreCell.append(el('span', 'wg-of', ':'), n, markOf(s.mark, s.stock, markPicture, 'plate'));
      });
    }
  };

  let stepsKey = '?';
  let answerSerial = -2;
  const drawTodo = (m: GameModel): void => {
    const b = m.banner;
    const key = `${b.steps.join('|')}#${b.step}`;
    if (key !== stepsKey) {
      stepsKey = key;
      steps.textContent = '';
      b.steps.forEach((s, i) => {
        if (i > 0) steps.append(el('i', '', '›'));
        steps.append(el('span', i === b.step ? 'wg-now' : '', s));
      });
    }
    setText(todoTitle, b.title);
    setText(todoDo, b.todo);
    setText(todoWhy, b.why);
    // The answer: eased in whenever it is a new one (its serial), never popped; it stays until the next.
    const a = m.answer;
    const serial = a ? a.serial : -1;
    if (serial !== answerSerial) {
      answerSerial = serial;
      todoAnswer.dataset['kind'] = a ? a.kind : '';
      todoAnswer.dataset['serial'] = String(serial);
      setText(answerText, a ? a.text : 'Every click and key press is answered here.');
      if (a) {
        todoAnswer.classList.remove('wg-say');
        void todoAnswer.offsetWidth;
        todoAnswer.classList.add('wg-say');
      }
    }
    // The intent follows the pointer; with none, the line keeps its place.
    const canAct = m.mode === 'setup' || m.mode === 'act';
    setText(todoIntent, m.intent !== '' ? `Click: ${m.intent}` : canAct ? 'Point at the board to see what a click would do.' : '\u00a0');
    todoIntent.dataset['has'] = m.intent !== '' ? '1' : '0';
    problem.classList.toggle('wg-open', m.problem !== null);
    if (m.problem !== null) setText(problem, m.problem);
  };

  let rowKey = '?';
  const mainButtons = new Map<string, { button: HTMLButtonElement; label: HTMLSpanElement; key: HTMLSpanElement }>();
  const groupButtons = new Map<string, { button: HTMLButtonElement; count: HTMLSpanElement }>();
  const ctxButtons = new Map<string, { button: HTMLButtonElement; label: HTMLSpanElement; key: HTMLSpanElement }>();
  const commandButton = (cls: string, c: ControlModel, small: boolean): { button: HTMLButtonElement; label: HTMLSpanElement; key: HTMLSpanElement } => {
    const b = button(cls, () => actions.press(c.id));
    b.dataset['control'] = c.id;
    const label = el('span', 'wg-lab');
    const key = keycap('');
    // (Stepping through the chosen unit's choices has the picture of stepping on.)
    b.append(icon(c.id === 'aim' ? 'next' : c.id, small), label, key);
    return { button: b, label, key };
  };
  /** The controls of the main row for a mode, in the row's order. */
  const mainOf = (m: GameModel): ControlModel[] => {
    const plain = m.controls.filter(c => c.row !== 'unit');
    const wanted = MAIN[m.mode];
    if (wanted === null) return plain.filter(c => c.id !== 'fast');
    const out: ControlModel[] = [];
    for (const id of wanted) {
      const c = plain.find(x => x.id === id);
      if (c) out.push(c);
    }
    return out;
  };
  const drawCommands = (m: GameModel): void => {
    const main = mainOf(m);
    // On the viewer's own turn the row begins with its groups: a press goes to one.
    const groups: readonly GroupModel[] = m.mode === 'act' ? m.groups : [];
    const ctx = m.mode === 'act' ? m.controls.filter(c => c.row === 'unit') : [];
    const key = `${m.mode}#${groups.map(g => g.id).join(',')}#${main.map(c => c.id).join(',')}#${ctx.map(c => c.id).join(',')}`;
    if (key !== rowKey) {
      rowKey = key;
      mainRow.textContent = '';
      ctxRow.textContent = '';
      mainButtons.clear();
      groupButtons.clear();
      ctxButtons.clear();
      for (const g of groups) {
        const b = button('wg-btn wg-steel', () => actions.take?.('group', g.id));
        b.dataset['control'] = 'group';
        b.dataset['group'] = g.id;
        b.dataset['number'] = String(g.number);
        const count = el('span', 'wg-cnt');
        b.append(el('span', 'wg-fno', String(g.number)), count, el('span', 'wg-lab', g.name));
        // A group past the ninth has a button and no key.
        if (g.key !== '') b.append(keycap(g.key));
        groupButtons.set(g.id, { button: b, count });
        mainRow.append(b);
      }
      if (groups.length > 0 && main.length > 0) mainRow.append(el('span', 'wg-gap'));
      for (const c of main) {
        const made = commandButton('wg-btn wg-steel', c, false);
        mainButtons.set(c.id, made);
        mainRow.append(made.button);
      }
      for (const c of ctx) {
        const made = commandButton('wg-ctx wg-steel', c, true);
        ctxButtons.set(c.id, made);
        ctxRow.append(made.button);
      }
    }
    for (const g of groups) {
      const b = groupButtons.get(g.id);
      if (!b) continue;
      // How many of its units can still act, of how many.
      setText(b.count, `${g.able}/${g.units}`);
      b.button.dataset['able'] = String(g.able);
      b.button.dataset['units'] = String(g.units);
      const units = g.units === 1 ? '1 unit' : `${g.units} units`;
      setEnabled(b.button, g.enabled && actions.take !== undefined,
        g.inHand
          ? `${g.name} is the active group: ${units}, ${g.able} can still act. Its units are highlighted on the board.`
          : `${g.name}: ${units}, ${g.able} can still act. ${g.key !== '' ? `Press ${g.key} or click` : 'Click'} to make it the active group. No unit is chosen.`,
        'not possible now');
      // The group in hand is the lit one.
      b.button.classList.toggle('wg-lit', g.inHand);
      b.button.dataset['hand'] = g.inHand ? '1' : '0';
    }
    const update = (set: typeof mainButtons, list: readonly ControlModel[], off: boolean): void => {
      for (const c of list) {
        const b = set.get(c.id);
        if (!b) continue;
        setText(b.label, c.label);
        setText(b.key, c.key);
        setEnabled(b.button, c.enabled, c.hint !== undefined ? `${c.label} (${c.key}). ${c.hint}` : `${c.label} (${c.key})`, c.why ?? 'not possible now');
        b.button.classList.toggle('wg-primary', c.primary && c.enabled);
        b.button.classList.toggle('wg-lit', c.on);
        if (off) b.button.classList.toggle('wg-off', !c.enabled);
      }
    };
    update(mainButtons, main, false);
    update(ctxButtons, ctx, true);
  };

  let legendKey = '?';
  const drawLegend = (m: GameModel): void => {
    // The nearer part of a reach has a line of its own where the game has words for it (and the board a shade).
    const near = m.words['nearLegend'];
    const kinds = m.mode === 'setup' ? ['zone', 'objective'] : ['reach', ...(near !== undefined ? ['reach-near'] : []), 'target', 'path', 'objective'];
    const key = `${kinds.join(',')}#${near ?? ''}`;
    if (key === legendKey) return;
    legendKey = key;
    legend.textContent = '';
    for (const kind of kinds) {
      const tint = map?.tints?.find(t => t.kind === kind);
      if (!tint) continue;
      const item = el('span');
      item.dataset['tint'] = kind;
      const swatch = el('i');
      swatch.style.background = tint.colour;
      item.append(swatch, document.createTextNode(kind === 'reach-near' ? near ?? kind : TINT_WORDS[kind] ?? kind));
      legend.append(item);
    }
  };

  const hook: Hud = {
    draw(m: GameModel): void {
      if (m === last) return;
      last = m;
      if (first) {
        first = false;
        // What this game has: a folder when it has groups or units to place by hand; a briefing, a rule book.
        hasFolder = m.words['groups'] !== undefined || m.groups.length > 0 || m.tray.length > 0;
        folder.root.style.display = hasFolder ? '' : 'none';
        briefBox.box.style.display = m.briefing ? '' : 'none';
        rulesBox.box.style.display = m.rulebook ? '' : 'none';
        const shown = [menuBox, modeBox, briefBox, rulesBox, mapBox].filter(b => b.box.style.display !== 'none').length;
        hud.style.setProperty('--corners-w', `${12 + shown * 50 + 14}px`);
        // How a game begins: its briefing lies open before the first turn; a set-up by hand begins with the folder of units open.
        setFolder(m.tray.length > 0);
        if (m.briefing && actions.briefFirst !== false) setFull('brief');
        else {
          begun = true;
          briefing.begun();
          actions.begin?.();
        }
      }
      // The result is laid down when the game ends, and taken up again when a new one starts.
      const over = m.result !== null;
      if (over && !wasOver) setFull('result');
      if (!over && wasOver && full === 'result') setFull(null);
      wasOver = over;

      drawPlate(m);
      drawTodo(m);
      drawCommands(m);
      drawLegend(m);
      folder.draw(m);
      notebook.draw(m, keysOf(m));
      briefing.draw(m);
      rulebook.draw(m);
      result.draw(m);
      if (pop === 'menu') drawMenu();
    },
    key(key: string): boolean {
      // Main menu's question is up: every key is its own (Esc and Enter keep playing), none reaches the game.
      if (leaveBox.open) return leaveBox.key(key);
      const name = keyName(key);
      // The settings lie over the whole game: every key is theirs (they listen for themselves), none reaches the game.
      if (settingsOpen) return true;
      // A full panel covers the board: no key reaches the game while the briefing or the rule book is open.
      if (full === 'brief' || full === 'rules') {
        // A force shown a page at a time (hud-full.ts) is paged by the arrows and by Page Up and Page Down.
        if (full === 'brief' && (name === 'ArrowRight' || name === 'PageDown' || name === 'ArrowDown')) briefing.page(1);
        else if (full === 'brief' && (name === 'ArrowLeft' || name === 'PageUp' || name === 'ArrowUp')) briefing.page(-1);
        else if (name === 'Escape' || (name === 'Enter' && full === 'brief')) setFull(null);
        else if (name === 's' && music) music.setOn(!music.state().on);
        return true;
      }
      // A key is a press of its button: the button on screen that carries it takes the pressed look, and shakes when
      // its thing is not possible now. (The key itself goes on to whoever owns it: the panel below, else the game.)
      if (last) {
        for (const set of [mainButtons, ctxButtons]) {
          for (const [id, b] of set) {
            const c = last.controls.find(x => x.id === id);
            if (!c || !claimsOf(c.key).includes(name)) continue;
            pressLook(b.button, false);
            if (!c.enabled) shake(b.button);
          }
        }
        for (const g of last.groups) {
          const b = groupButtons.get(g.id);
          if (!b || g.key === '' || keyName(g.key) !== name) continue;
          pressLook(b.button, false);
          if (isOff(b.button)) shake(b.button);
        }
      }
      const k = panelKey(key, { folder: hasFolder, map: map !== null, music: music !== null });
      if (!k) return false;
      switch (k.act) {
        case 'overlay':
          pressLook(modeBox.btn, false);
          setOverlay(!overlay);
          return true;
        case 'notebook': {
          const tab = notebook.tabs.querySelector(`[data-open="${page}"]`);
          if (tab) pressLook(tab, false);
          setNotebook(notebookOpen ? null : page);
          return true;
        }
        case 'folder': {
          const tab = folder.root.querySelector('[data-act="folder"]');
          if (tab) pressLook(tab, false);
          setFolder(!folderOpen);
          return true;
        }
        case 'map':
          pressLook(mapBox.btn, false);
          setPop(pop === 'map' ? null : 'map');
          return true;
        case 'sound':
          music?.setOn(!music.state().on);
          return true;
        case 'close':
          // The last thing laid over the board: the result, else a pop-out. With neither, the key is the game's.
          if (full !== null) {
            setFull(null);
            return true;
          }
          if (pop !== null) {
            setPop(null);
            return true;
          }
          return false;
        default:
          return false;
      }
    },
    state(): PanelState {
      return { overlay, notebook: notebookOpen ? page : null, folder: folderOpen, pop, full, settings: settingsOpen, leave: leaveBox.open, scale };
    },
    dispose(): void {
      delete window.__tableAvoid;
      window.removeEventListener('resize', fit);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      stopMap?.();
      stopMusic?.();
      stopFull();
      hud.remove();
      skinStyle?.remove();
    },
  };
  // The pages' names are fixed; say so once for whoever reads the DOM.
  hud.dataset['pages'] = PAGES.map(p => p.id).join(',');
  return hook;
}
