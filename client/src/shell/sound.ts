/**
 * The title screen's sound: the game's music and, softly, the game's own effect sounds when a tank
 * fires or a shell bursts on the screen; and the sounds of the PLAY GAME medallion.
 *
 * Both players are the game's (client/src/audio), fetched after the screen is up and handed to the
 * settings' model, which switches them. Everything here is asked for as if sound always plays: the
 * music begins by itself after its lead-in, and the effects' engine is asked to sound as soon as it is
 * built. A browser that allows no sound before the page has been touched holds both until the first
 * touch (each player sees to that itself), and what the picture asked for meanwhile is not heard, nor
 * played late. Nothing sounds on a hidden page; the music keeps the player's own choice of on or off,
 * and the effects go through their engine, so that its switch and its volume hold. The music always
 * begins here with the game's theme (TITLE_THEME), from its first note; the game's page then goes on
 * from where the title's music left off.
 *
 * With `sfx=0` in the address there are no effects: nothing of theirs is fetched or played, and no
 * audio context is made.
 */
import type { SettingsModel } from './settings';
import { GUNS } from './places';
import type { TitleEvent } from './timetable';

/** A moment of the PLAY GAME medallion that has a sound of its own (client/src/audio/medallion.ts makes them). */
export type MedallionMoment = 'smoulder' | 'spit' | 'ignite' | 'surge' | 'strike';

export interface TitleSound {
  /** An event of the picture has started. */
  event(e: TitleEvent, pan: number, onScreen: boolean): void;
  /** The interface did something a sound goes with. */
  ui(what: 'press' | 'refuse' | 'stamp'): void;
  /** The PLAY GAME medallion's sounds: each is asked for as if it always plays. */
  medallion?: {
    /** How strongly its fire burns now, 0 to 1: the standing crackle follows it (called on frames while it changes; 0 lets it die away). */
    fire(level: number): void;
    /** One of its moments: how strong (0 to 1) and where from left (-1) to right (1). */
    moment(kind: MedallionMoment, strength: number, pan: number): void;
  };
}

/**
 * The piece the title screen always begins with, from its first note after the music's lead-in (by its id in
 * tools/music/tracks.yaml). The owner, 2026-11-14: "Starting the game at the main menu screen should always start
 * the main martial theme song." Asked which: "First one." That is Measured March.
 */
const TITLE_THEME = 'measured-march';

/** How loud the picture's sounds are, of the cue's own level: the battle is behind the menu. */
const LEVEL = { burst: 0.16, strike: 0.42, press: 0.7, refuse: 0.7, stamp: 0.9 } as const;
/** A far burst is heard this many seconds after it is seen. */
const FAR_S = 0.55;

export function startSound(params: URLSearchParams, model: SettingsModel): TitleSound {
  let play: ((cue: string, opts?: { gain?: number; pan?: number; delay?: number }) => void) | null = null;
  let medallion: NonNullable<TitleSound['medallion']> | null = null;
  /** How strongly the medallion burns, as last told (null: never told): a state, taken up when the effects arrive. */
  let burning: number | null = null;

  if (params.get('music') === '0') model.attachMusic(null);
  else {
    void import('../audio').then(
      m => {
        const music = window.__music ?? m.loadMusic(params, { begin: TITLE_THEME });
        if (music) window.__music = music;
        model.attachMusic(music);
      },
      (err: unknown) => {
        console.error(err);
        model.attachMusic(null);
      },
    );
  }
  if (params.get('sfx') === '0') model.attachSound(null);
  else {
    void import('../audio/sounds').then(
      m => {
        // The title has no board: every sound is placed by where its event is on the screen.
        const sounds = m.loadSounds(params, () => null, { medallion: true });
        if (sounds) {
          play = sounds.sfx.play;
          medallion = sounds.medallion;
        }
        model.attachSound(sounds ? sounds.sfx : null);
        // As if sound always plays: the engine is asked to sound now, not at the first touch. A browser that
        // allows none yet leaves it waiting for that touch.
        sounds?.sfx.wake();
        // The medallion is on the page (it has said how it burns): its sounds are made ready now, ahead of its press.
        if (burning !== null) sounds?.medallion?.fire(burning);
      },
      (err: unknown) => {
        console.error(err);
        model.attachSound(null);
      },
    );
  }

  return {
    event(e, pan, onScreen) {
      if (!play || !onScreen) return;
      if (e.kind === 'shot') play('gun', { gain: (GUNS[e.place] as (typeof GUNS)[number]).loud, pan });
      else if (e.kind === 'burst') play('blast', { gain: LEVEL.burst, pan, delay: FAR_S });
      else if (e.kind === 'strike') play('blast', { gain: LEVEL.strike, pan });
    },
    ui(what) {
      if (!play) return;
      play(what === 'press' ? 'button' : what, { gain: LEVEL[what] });
    },
    medallion: {
      fire(level) {
        burning = level;
        medallion?.fire(level);
      },
      moment(kind, strength, pan) {
        medallion?.moment(kind, strength, pan);
      },
    },
  };
}
