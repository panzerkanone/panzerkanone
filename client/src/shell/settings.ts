/**
 * The settings' MODEL: what can be set, where each value is kept, and how it is applied to the
 * music, to the sound effects and to the game's address. No view is here (settings-screen.ts is the
 * owner's painted settings screen, put on this model). No browser is needed: the store and the two
 * audio players are handed in.
 *
 * The settings, in the order of the owner's sheet:
 *
 *   music        on or off, and a volume of 0 to 10. WIRED: they are the music player's own two
 *                choices (client/src/audio/music.ts keeps them between visits); the model reads
 *                and sets them through the player.
 *   sound        on or off, and a volume of 0 to 10. WIRED: the volume is the effects engine's own
 *                (client/src/audio/sfx.ts keeps it). On or off is kept HERE: the engine keeps none
 *                (in play the effects follow the music's one switch), so the title switches its own
 *                effects with it and hands it to the game in the address (address.ts).
 *   difficulty   easy, normal or hard. Kept here and handed to the game in the address as `ai=`,
 *                which the game's computer opponent reads (it takes normal when there is none).
 *   detail       low, med or high. Kept here, and handed to the game in the address under two
 *                names: `detail=` (the agreed name; STORED ONLY, nothing reads it yet) and the
 *                table's own `tier=` (flat, tabletop, tabletop+), which the table reads today, so
 *                the choice is WIRED by that. Until the player chooses, nothing is handed on and
 *                the table uses its own (it starts at its finest and steps down by itself).
 *   hulks        Show hulks, on or off (the Advanced page). Kept here and handed to the game in the address
 *                as `hulks=1` or `hulks=0` once chosen; the table lays a hulk where a vehicle is destroyed
 *                unless it says 0. WIRED. In a game in progress the table takes it at once.
 *   craters      Show craters, the same, as `craters=`: a crater where a fire mission lands. WIRED.
 *                Neither changes a rule: they are only pictures on the table.
 */

export type Difficulty = 'easy' | 'normal' | 'hard';
export type Detail = 'low' | 'med' | 'high';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];
export const DETAILS: readonly Detail[] = ['low', 'med', 'high'];
/** The most a volume goes to, as a control shows it (the owner's sliders run from 0 to 10). */
export const VOLUME_STEPS = 10;
/** What the table uses when the player has not chosen: shown as the choice until one is made. */
export const DETAIL_UNSET: Detail = 'high';
export const DIFFICULTY_UNSET: Difficulty = 'normal';
/** What the table shows of hulks and craters when the player has not chosen: both, as a choice that changes no rule. */
export const MARKS_UNSET = true;

export interface Channel {
  on: boolean;
  /** 0 to `VOLUME_STEPS`. */
  volume: number;
  /** Its player has arrived; until then (and if it never does) the two values are placeholders. */
  ready: boolean;
  /** Its player will not come on this page (the address switched it off, or it could not be loaded). */
  gone: boolean;
}
export interface Settings {
  music: Channel;
  sound: Channel;
  /** Null: the player has not chosen. */
  difficulty: Difficulty | null;
  detail: Detail | null;
  /** Show hulks and Show craters. Null: the player has not chosen (the table shows them). */
  hulks: boolean | null;
  craters: boolean | null;
}

/** Where the model keeps what is its own to keep: the browser's local storage, or a stand-in. */
export interface Store {
  get(key: string): string | null;
  set(key: string, value: string): void;
}
/** A player as the audio module hands it: the music, or the effects' engine. Volume is 0 to 1 there. */
export interface AudioPort {
  state(): { readonly on: boolean; readonly volume: number };
  setOn(on: boolean): void;
  setVolume(volume: number): void;
  onChange(fn: () => void): () => void;
}

export const KEPT = { soundOn: 'shell.sound.on', difficulty: 'shell.difficulty', detail: 'shell.detail', hulks: 'shell.hulks', craters: 'shell.craters' } as const;

export interface SettingsModel {
  get(): Settings;
  setMusicOn(on: boolean): void;
  setMusicVolume(steps: number): void;
  setSoundOn(on: boolean): void;
  setSoundVolume(steps: number): void;
  setDifficulty(d: Difficulty): void;
  setDetail(d: Detail): void;
  /** Show hulks, Show craters (the Advanced page). */
  setHulks(on: boolean): void;
  setCraters(on: boolean): void;
  /** The music player has arrived; null: there will be none on this page. */
  attachMusic(port: AudioPort | null): void;
  /** The effects' engine has arrived (it is switched to the kept choice at once); null: none. */
  attachSound(port: AudioPort | null): void;
  /** Calls `fn` whenever a value changes; returns a function that stops the calls. */
  onChange(fn: () => void): () => void;
}

const stepsOf = (volume: number): number => Math.max(0, Math.min(VOLUME_STEPS, Math.round(volume * VOLUME_STEPS)));
const volumeOf = (steps: number): number => Math.max(0, Math.min(VOLUME_STEPS, Math.round(steps))) / VOLUME_STEPS;
const oneOf = <T extends string>(all: readonly T[], v: string | null): T | null => (all as readonly string[]).includes(v ?? '') ? (v as T) : null;
/** A kept switch: '1' on, '0' off, anything else not chosen. */
const switchOf = (v: string | null): boolean | null => (v === '1' ? true : v === '0' ? false : null);

export function settingsModel(store: Store): SettingsModel {
  const listeners = new Set<() => void>();
  let music: AudioPort | null = null;
  let sound: AudioPort | null = null;
  let musicGone = false;
  let soundGone = false;
  let soundOn = store.get(KEPT.soundOn) !== '0';
  let difficulty = oneOf(DIFFICULTIES, store.get(KEPT.difficulty));
  let detail = oneOf(DETAILS, store.get(KEPT.detail));
  let hulks = switchOf(store.get(KEPT.hulks));
  let craters = switchOf(store.get(KEPT.craters));
  let shown = '';

  const get = (): Settings => {
    const m = music?.state();
    const s = sound?.state();
    return {
      music: m ? { on: m.on, volume: stepsOf(m.volume), ready: true, gone: false } : { on: true, volume: 8, ready: false, gone: musicGone },
      sound: s ? { on: soundOn, volume: stepsOf(s.volume), ready: true, gone: false } : { on: soundOn, volume: 8, ready: false, gone: soundGone },
      difficulty,
      detail,
      hulks,
      craters,
    };
  };
  /** Tells the listeners, when what they would read has changed. */
  const changed = (): void => {
    const now = JSON.stringify(get());
    if (now === shown) return;
    shown = now;
    for (const fn of [...listeners]) fn();
  };
  shown = JSON.stringify(get());

  return {
    get,
    setMusicOn(on) {
      music?.setOn(on);
      changed();
    },
    setMusicVolume(steps) {
      music?.setVolume(volumeOf(steps));
      changed();
    },
    setSoundOn(on) {
      soundOn = on;
      store.set(KEPT.soundOn, on ? '1' : '0');
      sound?.setOn(on);
      changed();
    },
    setSoundVolume(steps) {
      sound?.setVolume(volumeOf(steps));
      changed();
    },
    setDifficulty(d) {
      difficulty = d;
      store.set(KEPT.difficulty, d);
      changed();
    },
    setDetail(d) {
      detail = d;
      store.set(KEPT.detail, d);
      changed();
    },
    setHulks(on) {
      hulks = on;
      store.set(KEPT.hulks, on ? '1' : '0');
      changed();
    },
    setCraters(on) {
      craters = on;
      store.set(KEPT.craters, on ? '1' : '0');
      changed();
    },
    attachMusic(port) {
      music = port;
      musicGone = port === null;
      port?.onChange(changed);
      changed();
    },
    attachSound(port) {
      sound = port;
      soundGone = port === null;
      port?.setOn(soundOn);
      port?.onChange(changed);
      changed();
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
