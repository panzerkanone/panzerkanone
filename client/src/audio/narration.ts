/**
 * The campaign room's narration: the owner's own recordings of the campaign's briefings (assets/narration/v1/, from
 * tools/narration/: each used whole, as he made it). The room asks for the pieces of the view it shows
 * (client/src/campaign/narrate.ts), as if sound always plays: `narrationSays(ids)`, and `narrationSays([])` when its view
 * has nothing to say or the room is left.
 *
 * They are said by the effects' engine (sfx.ts, `say`): so the effects' switch and their volume hold for them, a
 * hidden page holds them (the piece being said is said again from its start when the page shows again), and a browser
 * that allows no sound before the page is touched says them from their start after the first touch. A piece's
 * recording is fetched when a view first asks for it, never with the title. While a piece is said the music gives way
 * under it (music.ts, `giveWay`).
 */
import indexText from '../../../assets/narration/v1/narration.json?raw';
import { readNarration } from './narration-index';
import type { NarrationIndex } from './narration-index';
import type { Sfx, Spoken } from './sfx';

const FILES = import.meta.glob<string>('../../../assets/narration/v1/*.mp3', { query: '?url', import: 'default', eager: true });

export const NARRATION: NarrationIndex = readNarration(JSON.parse(indexText) as unknown);
const byId = new Map(NARRATION.pieces.map(p => [p.id, p]));

/**
 * How loud the voice is said, over its recording evened to the index's loudness. Through the engine (its volume's
 * square, 0.64 at its first volume; the middle of the panner, 0.71 a side; the ceiling passes it as it is below its
 * knee) it comes out at about -21 LUFS: a little above the music at its own first volume (-22) and 11 dB above it while
 * the music gives way (music.ts, `GIVE_WAY`); the projector runs some 25 dB under it. Its loudest peaks stay just under
 * the engine's soft ceiling there (measured in a browser on 2026-11-15).
 */
export const NARRATION_GAIN = 2;
/** Seconds from the view's asking to the first word, and between two pieces said one after the other. */
const AFTER_S = 1;
const GAP_S = 0.8;

/** The engine's pieces for these ids, in order: an id the index does not have is said on the console, once, and left out. */
const told = new Set<string>();
function spoken(ids: readonly string[]): Spoken[] {
  const out: Spoken[] = [];
  for (const id of ids) {
    const p = byId.get(id);
    const address = p ? FILES[`../../../assets/narration/v1/${p.mp3}`] : undefined;
    if (!p || address === undefined) {
      if (!told.has(id)) console.error(`narration: there is no piece "${id}" in assets/narration/v1/ (a campaign names it)`);
      told.add(id);
      continue;
    }
    out.push({ id, addresses: [{ file: p.mp3, address }], gain: NARRATION_GAIN * 10 ** ((NARRATION.targetLufs - p.lufs) / 20) });
  }
  return out;
}

/** The music as the page has it (index.ts puts it on the window), if it can give way. */
const music = (): { giveWay?: (under: boolean) => void } | undefined => (window as unknown as { __music?: { giveWay?: (under: boolean) => void } }).__music;

let wanted: Spoken[] = [];
let listening: Sfx | null = null;
let under = false;
let waiting = 0;
let tries = 0;
/** The effects' engine is fetched after the page is up: pieces asked for before it is there are handed over when it comes, if it comes within this long. */
const WAIT_MS = 400;
const WAIT_TRIES = 25;

function hand(engine: Sfx): void {
  if (typeof engine.say !== 'function') return;
  if (listening !== engine) {
    listening = engine;
    engine.onChange(() => {
      const now = engine.saying() !== null;
      if (now === under) return;
      under = now;
      music()?.giveWay?.(now);
    });
  }
  if (wanted.length > 0) engine.wake();
  engine.say(wanted, { afterS: AFTER_S, gapS: GAP_S });
}

/** Say these pieces now, one after another (none: say nothing, and quiet what is being said). Never throws. */
export function narrationSays(ids: readonly string[]): void {
  wanted = spoken(ids);
  const engine = window.__sfx;
  if (engine) {
    hand(engine);
    return;
  }
  if (wanted.length === 0 || waiting !== 0) return;
  tries = 0;
  waiting = window.setInterval(() => {
    const late = window.__sfx;
    tries++;
    if (late) hand(late);
    if (late || wanted.length === 0 || tries >= WAIT_TRIES) {
      window.clearInterval(waiting);
      waiting = 0;
    }
  }, WAIT_MS);
}
