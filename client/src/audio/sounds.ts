/**
 * The game's sound effects, for the page: the engine started on the built
 * recordings, and joined to whatever the page hands it.
 *
 * Apart from the music's loader (index.ts) so that neither is fetched for the
 * other, and outside the game layer and the scene, as all sound is: neither of
 * them fetches or plays anything. The page's entry calls `loadSounds`, gives
 * `effect` to the table as its `onEffect`, and passes a game's port, panel and
 * music through `game` on their way to the game.
 *
 * Everything comes from assets/sounds/v1/, which `npm run sounds` writes from
 * tools/sounds/cues.yaml: the cues and the joins (bundled with this file) and,
 * for each take, an Ogg Opus file and an AAC copy for a browser that does not
 * play the first. The bundler turns the files into addresses; a recording is
 * fetched only when its cue is first needed, and none while the engine cannot
 * sound: before the page is touched, in a game; on the title, which asks the
 * engine to sound as it loads, before the browser lets it.
 *
 * The title's PLAY GAME medallion has sounds of its own that are made, not
 * recorded (medallion.ts): a page that asks for them (`medallion`) gets them
 * as cues of the same engine, worked out off the page's own thread
 * (medallion-worker.ts) when the medallion first asks for one.
 */
import { colOf } from '@engine/core/hex';
import manifestText from '../../../assets/sounds/v1/sounds.json?raw';
import { panOf, readSounds } from './cues';
import type { SoundTake } from './cues';
import { counterSounds, effectSounds, oneSwitch, panelSounds, soundingPort, startsOn } from './joins';
import type { MusicLike } from './joins';
import { FIRE_TONE, MEDALLION_CUES, MEDALLION_LEVELS, medallionSound, medallionSounds } from './medallion';
import type { MedallionSound, MedallionSounds } from './medallion';
import type { MadeReply, MadeRequest } from './medallion-worker';
import { soundPanel } from './panel';
import { PROJECTOR_CUE } from './projector';
import { startSfx } from './sfx';
import type { MadeCue, Sfx } from './sfx';

export type { Sfx, SfxState } from './sfx';

declare global {
  interface Window {
    /** The sound effects' engine, for checks and for the console. */
    __sfx?: Sfx;
  }
}

const FILES = import.meta.glob<string>('../../../assets/sounds/v1/*.{opus,m4a}', { query: '?url', import: 'default', eager: true });
const addressOf = (name: string): string | null => FILES[`../../../assets/sounds/v1/${name}`] ?? null;

/** The board's size in hexes, as the page knows it; null while it does not. */
export type GridOf = () => { readonly cols: number; readonly rows: number } | null;

export interface Sounds {
  readonly sfx: Sfx;
  /** For the table's `onEffect`: the effect's cue, placed across the board. */
  effect(e: { kind: string; hex: number }): void;
  /**
   * A game's joins, made as the game is about to start: the counters' port and the music come back
   * as the game is to be handed them (the port with sound added, the music with the effects on its
   * switch), and the panel's root is listened to from now on.
   */
  game<P extends object>(o: { port: P; panel: HTMLElement; music: MusicLike | null }): { port: P; music: MusicLike | null; heard(what: 'dice'): void };
  /** The PLAY GAME medallion's sounds, on a page that asked for them (the title); else null. */
  readonly medallion: MedallionSounds | null;
}

/**
 * The medallion's sounds as cues the engine makes. Their sums are done off the page's own thread, by
 * a worker that is let go when the last take has come; where there is no worker, or it fails, they are
 * done here.
 */
function medallionCues(): MadeCue[] {
  let worker: Worker | null = null;
  let failed = false;
  let next = 1;
  let left = MEDALLION_CUES.reduce((sum, c) => sum + MEDALLION_LEVELS[c.sound].takes, 0);
  const waiting = new Map<number, { answer(channels: readonly Float32Array[]): void; here(): void }>();
  const fail = (): void => {
    failed = true;
    worker?.terminate();
    worker = null;
    const all = [...waiting.values()];
    waiting.clear();
    for (const w of all) w.here();
  };
  const make = (sound: MedallionSound, take: number, rate: number): Promise<readonly Float32Array[]> =>
    new Promise((resolve, reject) => {
      const here = (): void => {
        try {
          resolve(medallionSound(sound, take, rate));
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };
      if (failed || typeof Worker !== 'function') {
        here();
        return;
      }
      try {
        if (!worker) {
          worker = new Worker(new URL('./medallion-worker.ts', import.meta.url), { type: 'module' });
          worker.onmessage = (e: MessageEvent<MadeReply>) => {
            const w = waiting.get(e.data.id);
            if (!w) return;
            waiting.delete(e.data.id);
            if ('channels' in e.data) w.answer(e.data.channels);
            else w.here();
            left--;
            if (left <= 0 && waiting.size === 0) {
              worker?.terminate();
              worker = null;
            }
          };
          worker.onerror = fail;
        }
        const request: MadeRequest = { id: next++, sound, take, rate };
        worker.postMessage(request);
        waiting.set(request.id, { answer: resolve, here });
      } catch {
        fail();
        here();
      }
    });
  return MEDALLION_CUES.map(
    (c): MadeCue => ({
      id: c.id,
      plays: c.plays,
      leastMs: c.leastMs,
      voices: c.voices,
      cents: c.cents,
      db: c.db,
      takes: Array.from({ length: MEDALLION_LEVELS[c.sound].takes }, (_, take) => (rate: number) => make(c.sound, take, rate)),
      ...(c.sound === 'fire' ? { tone: FIRE_TONE } : {}),
    }),
  );
}

/**
 * The effects, started. Null when the address says `sfx=0`, or when the data cannot be read or a
 * take has no file: the page is then as it was without sound effects, and is told once, as a warning.
 * `medallion`: the page has the PLAY GAME medallion (the title), and its sounds are made for it.
 */
export function loadSounds(params: URLSearchParams, grid: GridOf, o: { readonly medallion?: boolean } = {}): Sounds | null {
  if (params.get('sfx') === '0') return null;
  try {
    const data = readSounds(JSON.parse(manifestText) as unknown);
    const opusFirst = new Audio().canPlayType('audio/ogg; codecs="opus"') !== '';
    const addresses = new Map<string, readonly { file: string; address: string }[]>();
    for (const cue of data.cues) {
      for (const take of cue.takes) {
        const opus = addressOf(take.opus);
        const m4a = addressOf(take.m4a);
        if (opus === null || m4a === null) throw new Error(`no file for a take of "${cue.id}"`);
        const both = [{ file: take.opus, address: opus }, { file: take.m4a, address: m4a }];
        addresses.set(take.opus, opusFirst ? both : both.reverse());
      }
    }
    // (The medallion's page is the shell's: its campaign room has the film projector's standing sound, projector.ts.)
    const sfx = startSfx({ data, addresses: (take: SoundTake) => addresses.get(take.opus) ?? [], startOn: true, ...(o.medallion === true ? { made: [...medallionCues(), PROJECTOR_CUE] } : {}) });
    window.__sfx = sfx;

    /** Where a hex lies from left to right, by its column (the hex module's own reading of a hex number). */
    const pan = (hex: number): number => {
      const g = grid();
      if (!g || !Number.isInteger(hex) || hex < 0 || hex >= g.cols * g.rows) return 0;
      return panOf(colOf(g, hex), g.cols);
    };
    let unnamed = false;
    const effect = effectSounds(data.joins, sfx.play, pan, kind => {
      if (unnamed) return;
      unnamed = true;
      console.warn(`sound effects: the table's effect "${kind}" is named in no join (tools/sounds/cues.yaml, joins.effects): it is silent. This is said once.`);
    });

    return {
      sfx,
      effect,
      game(g) {
        sfx.setOn(startsOn({ sfx: params.get('sfx'), music: params.get('music') }, g.music ? g.music.state().on : null));
        soundPanel(g.panel, panelSounds(data.joins, sfx.play));
        const table = counterSounds(data.joins, sfx.play, pan);
        // What the game says it is showing, besides what its counters do: so far a roll of the dice (heard in the middle).
        return { port: soundingPort(g.port, table), music: g.music ? oneSwitch(g.music, sfx) : null, heard: what => table(what, -1) };
      },
      medallion: o.medallion === true ? medallionSounds(sfx) : null,
    };
  } catch (err) {
    console.warn(`sound effects: could not be started (${err instanceof Error ? err.message : String(err)}). The game goes on without them.`);
    return null;
  }
}
