/**
 * What is heard for what happens: the rules that join the sound effects to the
 * table's effects, to the counters' port, to the panel and to the music's
 * switch. Plain: no browser, no audio, no scene and no game in it (the Node
 * tests run every rule here). Which cue each thing plays is data (the joins of
 * sounds.json); this file says when, and where across the board.
 *
 * Nothing here can change what the game sees: a sound that fails is passed
 * over, and every call the game makes reaches the real thing with the same
 * arguments and gives back the real thing's own answer.
 */
import type { CounterEvent, PanelEvent, SoundJoins } from './cues';

/** As the engine plays a cue (sfx.ts). */
export type Play = (cue: string, opts?: { gain?: number; pan?: number; delay?: number }) => void;

/** Never lets a sound's failure reach whoever caused the sound. */
function quietly(act: () => void): void {
  try {
    act();
  } catch {
    // A sound that could not be played is not the game's concern.
  }
}

// ---- the table's effects ---------------------------------------------------------------------------

/**
 * For the table's `onEffect`: an effect kind plays the cue the joins name for it, placed across the
 * board by its hex. A kind the joins do not name (a new effect of the table's) is silent, and
 * `unnamed` is told of it, once a kind.
 */
export function effectSounds(joins: SoundJoins, play: Play, pan: (hex: number) => number, unnamed: (kind: string) => void): (e: { kind: string; hex: number }) => void {
  const told = new Set<string>();
  return e => {
    if (!Object.prototype.hasOwnProperty.call(joins.effects, e.kind)) {
      if (!told.has(e.kind)) {
        told.add(e.kind);
        quietly(() => unnamed(e.kind));
      }
      return;
    }
    const cue = joins.effects[e.kind];
    if (cue === null || cue === undefined) return;
    quietly(() => play(cue, { pan: pan(e.hex) }));
  };
}

// ---- the counters ----------------------------------------------------------------------------------

/** A move whose path holds this many hexes or more is pushed across the board: it slides. */
export const SLIDE_FROM = 3;
/** Seconds after the lift that the slide begins. */
export const SLIDE_AFTER = 0.07;

/** What a counter did, for whoever makes the sound: which event, and on which hex (-1: nowhere on the board). */
export type CounterHeard = (event: CounterEvent, hex: number, opts?: { delay?: number }) => void;

/**
 * The counters' port with sound added: a pass-through that calls the real port and tells `heard`
 * what was done. A lift as `move` is called, a slide after it when the move is of several hexes,
 * and a set-down when the move's promise resolves; the tray's clack when `remove(id, 'destroyed')`
 * resolves; and for `answer`, a refusal or a badge.
 *
 * Every member of the port passes through, those this file has never heard of too, with the real
 * port as its `this`; a member the real port lacks is lacking here as well (so a game that asks
 * whether the table can `answer` gets the true reply); and each call gives back exactly what the
 * real port gave, a rejected promise included.
 */
export function soundingPort<P extends object>(port: P, heard: CounterHeard): P {
  /** Where each counter was last put, to place the sound of its lift. */
  const at = new Map<string, number>();
  const tell: CounterHeard = (event, hex, opts) => quietly(() => heard(event, hex, opts));
  const after = (result: unknown, then: () => void): void => {
    // The game keeps the promise it was given; this is a second reader of it, which never throws.
    void Promise.resolve(result).then(then, () => undefined);
  };
  type Fn = (...args: unknown[]) => unknown;
  const made = new Map<PropertyKey, { from: Fn; to: Fn }>();
  const wrap = (key: PropertyKey, real: Fn): Fn => {
    switch (key) {
      case 'setUp':
        return (...args) => {
          at.clear();
          const counters = args[0];
          if (Array.isArray(counters)) for (const c of counters as { id?: unknown; hex?: unknown }[]) if (typeof c?.id === 'string' && typeof c.hex === 'number') at.set(c.id, c.hex);
          return real.apply(port, args);
        };
      case 'move':
        return (...args) => {
          const [id, hex, opts] = args as [unknown, unknown, { path?: readonly number[] } | undefined];
          const to = typeof hex === 'number' ? hex : -1;
          const from = typeof id === 'string' ? (at.get(id) ?? to) : to;
          const result = real.apply(port, args);
          tell('lift', from);
          if ((opts?.path?.length ?? 0) >= SLIDE_FROM) tell('slide', to, { delay: SLIDE_AFTER });
          after(result, () => {
            if (typeof id === 'string') at.set(id, to);
            tell('place', to);
          });
          return result;
        };
      case 'remove':
        return (...args) => {
          const [id, how] = args;
          const result = real.apply(port, args);
          if (typeof id === 'string') at.delete(id);
          if (how === 'destroyed') after(result, () => tell('lost', -1));
          return result;
        };
      case 'answer':
        return (...args) => {
          const result = real.apply(port, args);
          const a = args[0] as { kind?: unknown; hex?: unknown } | null | undefined;
          if (a && (a.kind === 'refused' || a.kind === 'badge')) tell(a.kind, typeof a.hex === 'number' ? a.hex : -1);
          return result;
        };
      default:
        return (...args) => real.apply(port, args);
    }
  };
  return new Proxy(port, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      // A member that is fixed on the port itself (a frozen object's) must be given as it is: it passes through unheard.
      const own = Reflect.getOwnPropertyDescriptor(target, key);
      if (own && own.configurable === false && own.writable === false) return value;
      // One function a member, for as long as the real one is the same: `port.move === port.move` holds here as there.
      const kept = made.get(key);
      if (kept && kept.from === value) return kept.to;
      const to = wrap(key, value as Fn);
      made.set(key, { from: value as Fn, to });
      return to;
    },
  });
}

/** For `soundingPort`: each event plays the cue the joins name for it, placed across the board by its hex. */
export function counterSounds(joins: SoundJoins, play: Play, pan: (hex: number) => number): CounterHeard {
  return (event, hex, opts) => {
    const cue = joins.counters[event];
    if (cue === null) return;
    play(cue, { pan: pan(hex), ...(opts?.delay !== undefined ? { delay: opts.delay } : {}) });
  };
}

// ---- the panel -------------------------------------------------------------------------------------

/**
 * The panel's own names that the sounds lean on (client/src/game/hud.ts, hud-book.ts, hud-full.ts):
 * its parts by their `data-part`, the class a part has while it is open, the class a page has while
 * it is the one shown, and the attributes of the buttons that are tabs of paper or card.
 */
export const PANEL = {
  notebook: 'notebook',
  folder: 'folder',
  /** The full sheets. */
  sheets: ['briefing', 'rulebook', 'result'],
  /** Parts whose pages turn: an element with `data-page` inside one, when it becomes the page shown. */
  paged: ['notebook', 'rulebook'],
  openClass: 'wg-open',
  shownClass: 'wg-on',
} as const;

/**
 * What a click on a button of the panel plays. A button is steel and clicks; the tabs of the
 * notebook and the folder, the notebook's own little button and an entry in the rule book's list of
 * contents are paper and card, and what they open or turn makes their sound.
 */
export function clickEvent(button: { open: string | undefined; act: string | undefined; page: string | undefined }): PanelEvent | null {
  if (button.open !== undefined || button.page !== undefined) return null;
  if (button.act === 'folder' || button.act === 'close-notebook') return null;
  return 'button';
}

/** What a part of the panel plays as it opens or shuts; null for a part that makes no sound of its own (a pop-out's button has clicked). */
export function openEvent(part: string, open: boolean): PanelEvent | null {
  if (part === PANEL.notebook) return 'page';
  if (part === PANEL.folder) return open ? 'folder-open' : 'folder-shut';
  if ((PANEL.sheets as readonly string[]).includes(part)) return open ? 'sheet-open' : 'sheet-shut';
  return null;
}

/** What a page coming up plays, in a part that is open: a page turned in the notebook or the rule book. */
export function pageEvent(part: string, partOpen: boolean): PanelEvent | null {
  return partOpen && (PANEL.paged as readonly string[]).includes(part) ? 'page' : null;
}

/** For the panel's listeners: each event plays the cue the joins name for it. */
export function panelSounds(joins: SoundJoins, play: Play): (event: PanelEvent) => void {
  return event => {
    const cue = joins.panel[event];
    if (cue !== null) quietly(() => play(cue));
  };
}

// ---- the one switch --------------------------------------------------------------------------------

/** The music's controls, as the panel is handed them (client/src/game/hud.ts, MusicControls). */
export interface MusicLike {
  state(): { readonly on: boolean; readonly volume: number; readonly title: string | null; readonly playing: boolean };
  setOn(on: boolean): void;
  setVolume(volume: number): void;
  next(): void;
  onChange(fn: () => void): () => void;
}

/**
 * The music's controls for the panel, with the effects on the same switch: whatever switches the
 * music on or off (key S, the menu's Music row, "next piece", which switches it on) does the same to
 * the effects. The music's own state stays the truth of `on`, and the volume is the music's alone.
 */
export function oneSwitch(music: MusicLike, effects: { setOn(on: boolean): void }): MusicLike {
  const follow = (): void => quietly(() => effects.setOn(music.state().on));
  return {
    state: () => music.state(),
    setOn(on: boolean): void {
      music.setOn(on);
      follow();
    },
    setVolume: volume => music.setVolume(volume),
    next(): void {
      music.next();
      follow();
    },
    onChange: fn => music.onChange(fn),
  };
}

/**
 * Whether the effects are on as a game starts. `sfx=0` in the address: off for the page. Otherwise
 * they are as the music is, which carries the player's kept choice of the one switch; but `music=0`
 * in the address is about the music alone, and a page with no music has no switch: on.
 */
export function startsOn(address: { sfx: string | null; music: string | null }, musicOn: boolean | null): boolean {
  if (address.sfx === '0') return false;
  if (address.music === '0' || musicOn === null) return true;
  return musicOn;
}
