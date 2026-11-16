/**
 * The film projector's running sound, for the campaign's briefing room: the motor, the claw's click-click-click and
 * the shutter's flutter of a real projector (a recording of a Bell and Howell 253B, 8 mm; assets/audio/v1/, and the
 * ledger says whose it is and how it was cut).
 *
 * It is a standing sound of the effects' engine (sfx.ts, `sustain`), played round and round at the level the room
 * sets: so the effects' switch and their volume hold for it, a hidden page is silent, and a browser that allows no
 * sound before the page is touched holds it until the first touch. The room asks as if sound always plays:
 * `projectorRuns(level)` when the film starts, `projectorRuns(0)` when it stops or the room is left.
 *
 * The recording is fetched and decoded when the room first asks for the sound, never with the title: the engine
 * works all its made cues out together when the first of them is asked for (the title's medallion), and this one
 * waits there for its own first asking. The loop is made after decoding (projector-loop.ts), so that it turns
 * without a seam whatever the file's coding left at its ends. A recording that cannot be fetched or decoded leaves
 * the projector silent, and the page is told once (the engine's warning).
 */
import m4aAddress from '../../../assets/audio/v1/projector-run.m4a?url';
import opusAddress from '../../../assets/audio/v1/projector-run.opus?url';
import { projectorLoop } from './projector-loop';
import type { MadeCue } from './sfx';

export { PROJECTOR_CLATTER_HZ, PROJECTOR_LOOP_CLICKS } from './projector-loop';

/** The room has asked for the sound at least once: the recording may be fetched. */
let asked: () => void = () => undefined;
const whenAsked = new Promise<void>(resolve => {
  asked = resolve;
});

type OfflineContext = new (channels: number, length: number, rate: number) => OfflineAudioContext;

/** The recording, decoded at the engine's own rate and made into its loop: the kind this browser plays first, then the other. */
async function recording(rate: number): Promise<readonly Float32Array[]> {
  await whenAsked;
  const opusFirst = new Audio().canPlayType('audio/ogg; codecs="opus"') !== '';
  const Offline = (window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: OfflineContext }).webkitOfflineAudioContext) as OfflineContext | undefined;
  if (!Offline) throw new Error('this browser decodes no sound off the page');
  let last: unknown = null;
  for (const address of opusFirst ? [opusAddress, m4aAddress] : [m4aAddress, opusAddress]) {
    try {
      const response = await fetch(address);
      if (!response.ok) throw new Error(`${address}: ${response.status}`);
      // (Decoding gives the sound at the context's own rate: the engine's.)
      const decoded = await new Offline(2, 1, rate).decodeAudioData(await response.arrayBuffer());
      return projectorLoop(
        Array.from({ length: Math.min(2, decoded.numberOfChannels) }, (_, i) => decoded.getChannelData(i)),
        decoded.sampleRate,
      );
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** The projector's cue, for the engine's made cues (sounds.ts hands it in on the shell's page). */
export const PROJECTOR_CUE: MadeCue = {
  id: 'projector-run',
  plays: 'the film projector runs in the campaign room: a standing sound, while the film plays',
  leastMs: 0,
  voices: 1,
  cents: 0,
  db: 0,
  takes: [recording],
};

/** The level the room wants now, and the timer that waits for an engine not yet there (0: none). */
let wanted = 0;
let waiting = 0;
let tries = 0;
/** The effects' engine is fetched after the page is up: a level asked for before it is there is handed over when it comes, if it comes within this long. */
const WAIT_MS = 400;
const WAIT_TRIES = 25;

/**
 * The projector runs at this level (0 to 1, of the recording's own level; the room chooses it), or stops (0). Never throws; a page
 * without the effects' engine (`sfx=0`) is silent.
 */
export function projectorRuns(level: number): void {
  wanted = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  if (wanted > 0) asked();
  const engine = window.__sfx;
  if (engine) {
    engine.sustain(PROJECTOR_CUE.id, wanted);
    return;
  }
  if (wanted <= 0 || waiting !== 0) return;
  tries = 0;
  waiting = window.setInterval(() => {
    const late = window.__sfx;
    tries++;
    if (late && wanted > 0) late.sustain(PROJECTOR_CUE.id, wanted);
    if (late || wanted <= 0 || tries >= WAIT_TRIES) {
      window.clearInterval(waiting);
      waiting = 0;
    }
  }, WAIT_MS);
}
