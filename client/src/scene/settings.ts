/**
 * The table page's settings, all in the address (docs/bars/M4a.md, "Page
 * settings"). Plain parsing, no browser.
 */
import { isTierName } from './tiers';
import type { TierName } from './tiers';
import { isLightName } from './lights';
import type { LightName } from './lights';
import { isRoomName } from './rooms';
import type { RoomName } from './rooms';

/**
 * The dials of the mounted boards (ruling 32), for showing settings side by
 * side. Each is also a field of `window.__table.setLook`. None is reachable by
 * ordinary input. Lengths are in h.
 */
export interface MountSettings {
  /** `border=`: how far the sheet is cut short of the board's edge. */
  border?: number;
  /** `gap=`: the space between two boards. */
  gap?: number;
  /** `corner=`: radius of each board's corners. */
  cornerRadius?: number;
  /** `brown=<rrggbb>`: the covering paper, sRGB 0..255. */
  brown?: [number, number, number];
  /** `folds=`: strength of the wrap's folds at the corners, 0 to 2 (1 as built). */
  folds?: number;
  /** `scuff=`: strength of the wrap's wear, 0 to 2 (1 as built). */
  wrapWear?: number;
}

/**
 * Planted faults. Each changes one thing; none is reachable by ordinary input.
 * `oldboard` draws the former construction (one outline, the white margin to
 * the edge, a groove at each seam) in place of the mounted boards; it took the
 * place of `seamgap`, which is retired: a gap between boards is no longer a fault.
 */
export const NUMERIC_FAULTS = ['gridshift', 'gridthin', 'smalltable', 'coarse', 'seamshift', 'warm', 'idle'] as const;
export const JUDGED_FAULTS = ['clean', 'gloss', 'noshadow', 'oldboard', 'gridfaint'] as const;
export type Fault = (typeof NUMERIC_FAULTS)[number] | (typeof JUDGED_FAULTS)[number];

export interface Settings {
  /** Map id under assets/maps, used when the address's fragment holds no map text. */
  map: string;
  /** Nothing over the canvas. */
  bare: boolean;
  /** The player's choice of tier, or null. */
  tier: TierName | null;
  /** The renderer's clear colour as [r, g, b] in 0..1, or null for the page's own. */
  clear: [number, number, number] | null;
  faults: Fault[];
  /** About this many ms of GPU work added to every frame. */
  stressMs: number;
  /** Draw every frame. */
  bench: boolean;
  /** The mounted boards' dials that the address sets; the rest keep the page's own. */
  mount: MountSettings;
  /**
   * The first camera's tilt from straight down, in degrees, in place of the page's own (`tilt=`,
   * 0 to 80). The ~ key steps through the page's cameras; this sets the one it opens with.
   */
  tiltDeg: number | null;
  /**
   * For tuning the feel: how long a drag let go at speed glides on, as the time in seconds in which
   * its speed falls to about a third (`glide=`, 0 to 2; 0 is no glide), in place of the page's own.
   */
  glideS: number | null;
  /**
   * For tuning the look: the lamp's reflection on the sheet and the table as a share of its own
   * strength (`sheen=`, 0 to 4; 0 is none), and the vignette's strength at the frame's corners
   * (`vignette=`, 0 to 0.6), each in place of the page's own.
   */
  lampShare: number | null;
  vignetteStrength: number | null;
  /** The relief of the paper's sheen and of the table's coat (scuffs, scratches, cockle): off unless the address says `gleam=1` (2026-11-14: switched off
   * until the table's second pass; the owner: "Lighting is good, material is poor"). Off, they are smooth, as before. */
  gleam: boolean;
  /** Things on the table (scene/props): off unless the address says `props=1` (until the owner has seen them); where they lie follows the game's `seed=` (1 without one). */
  props: boolean;
  seed: number;
  /** The table's light, by name (`light=`, lights.ts); null: today's. A name it does not know is reported with the settings not understood. */
  light: LightName | null;
  /** The room round the table, by name (`env=`, rooms.ts): its light and its reflections; null: none, the old sky. A name it does not know is reported with the settings not understood. */
  env: RoomName | null;
  /** The counters on the table (Milestone 4b): on unless the address says `pieces=0`. */
  pieces: boolean;
  /** The counter tray beside the boards, where lost counters go: on with the counters unless the address says `tray=0`. */
  tray: boolean;
  /**
   * A game played on the table (`game=1`): the page's entry starts the game layer on the counters'
   * port (the scene imports none of it), and the game lays its panel over the page, so the page is
   * `bare`. The game's own settings (`seed=`, `sides=`, `board=`, `fast=`) are the game's to read.
   * With no `map=`, the table shows the board the game is played on.
   */
  game: boolean;
  /** The effects on the table (fx/): see `FxSettings`. */
  fx: FxSettings;
  /**
   * The dice inset (dice/inset.ts): shown while a roll is thrown unless the address says `dice=0` (the dice still land
   * in the tray). With `fx=0` the dice are laid showing their faces at once, with no tumble.
   */
  dice: boolean;
  /** Settings that were given but not understood, reported on the hook. */
  ignored: string[];
}

/** The settings of the table's effects (fire, blast, smoke: client/src/scene/fx). */
export interface FxSettings {
  /** They are drawn unless the address says `fx=0`. */
  on: boolean;
  /** `fxdemo=1`: a developer's strip of buttons and keys that set each effect off at the hex under the pointer. Never with a game. */
  demo: boolean;
  /** `fast=1`, the game's own switch for a fast play-back: the effects are cut short with it. */
  fast: boolean;
  /**
   * The dials of fx/tune.ts that the address sets: `fx.<group>.<dial>=<number>` (or several numbers
   * with commas between, for a colour): `fx.kill.size=3.1`, `fx.kill.glow=255,170,90`. The name is kept
   * here without its `fx.`; one that names no dial is reported with the settings not understood.
   */
  dials: Record<string, number[]>;
}

export function readSettings(search: string): Settings {
  const q = new URLSearchParams(search);
  const ignored: string[] = [];
  const tierText = q.get('tier');
  // A plus sign in a query string reads as a space: accept both spellings of tabletop+.
  const tierName = tierText === 'tabletop ' ? 'tabletop+' : tierText;
  if (tierText !== null && !isTierName(tierName)) ignored.push(`tier=${tierText}`);
  const clearText = q.get('clear');
  let clear: [number, number, number] | null = null;
  if (clearText !== null) {
    if (/^[0-9a-fA-F]{6}$/.test(clearText)) {
      clear = [parseInt(clearText.slice(0, 2), 16) / 255, parseInt(clearText.slice(2, 4), 16) / 255, parseInt(clearText.slice(4, 6), 16) / 255];
    } else ignored.push(`clear=${clearText}`);
  }
  const faults: Fault[] = [];
  const known = [...NUMERIC_FAULTS, ...JUDGED_FAULTS] as readonly string[];
  for (const text of q.getAll('fault')) {
    for (const name of text.split(',')) {
      if (known.includes(name)) faults.push(name as Fault);
      else if (name !== '' && name !== 'none') ignored.push(`fault=${name}`);
    }
  }
  const stressText = q.get('stress');
  const stress = stressText === null ? 0 : Number(stressText);
  if (stressText !== null && !(Number.isFinite(stress) && stress >= 0)) ignored.push(`stress=${stressText}`);
  const mount: MountSettings = {};
  const length = (name: string, set: (v: number) => void): void => {
    const text = q.get(name);
    if (text === null) return;
    const v = Number(text);
    if (text.trim() !== '' && Number.isFinite(v) && v >= 0) set(v);
    else ignored.push(`${name}=${text}`);
  };
  length('border', v => (mount.border = v));
  length('gap', v => (mount.gap = v));
  length('corner', v => (mount.cornerRadius = v));
  length('folds', v => (mount.folds = v));
  length('scuff', v => (mount.wrapWear = v));
  let tiltDeg: number | null = null;
  const tiltText = q.get('tilt');
  if (tiltText !== null) {
    const v = Number(tiltText);
    if (tiltText.trim() !== '' && Number.isFinite(v) && v >= 0 && v <= 80) tiltDeg = v;
    else ignored.push(`tilt=${tiltText}`);
  }
  let glideS: number | null = null;
  const glideText = q.get('glide');
  if (glideText !== null) {
    const v = Number(glideText);
    if (glideText.trim() !== '' && Number.isFinite(v) && v >= 0 && v <= 2) glideS = v;
    else ignored.push(`glide=${glideText}`);
  }
  let lampShare: number | null = null;
  const sheenText = q.get('sheen');
  if (sheenText !== null) {
    const v = Number(sheenText);
    if (sheenText.trim() !== '' && Number.isFinite(v) && v >= 0 && v <= 4) lampShare = v;
    else ignored.push(`sheen=${sheenText}`);
  }
  let vignetteStrength: number | null = null;
  const vignetteText = q.get('vignette');
  if (vignetteText !== null) {
    const v = Number(vignetteText);
    if (vignetteText.trim() !== '' && Number.isFinite(v) && v >= 0 && v <= 0.6) vignetteStrength = v;
    else ignored.push(`vignette=${vignetteText}`);
  }
  const lightText = q.get('light');
  if (lightText !== null && !isLightName(lightText)) ignored.push(`light=${lightText}`);
  const envText = q.get('env');
  if (envText !== null && !isRoomName(envText)) ignored.push(`env=${envText}`);
  const brownText = q.get('brown');
  if (brownText !== null) {
    if (/^[0-9a-fA-F]{6}$/.test(brownText)) mount.brown = [parseInt(brownText.slice(0, 2), 16), parseInt(brownText.slice(2, 4), 16), parseInt(brownText.slice(4, 6), 16)];
    else ignored.push(`brown=${brownText}`);
  }
  const dials: Record<string, number[]> = {};
  for (const [name, text] of q) {
    if (!name.startsWith('fx.')) continue;
    const values = text.split(',').map(v => (v.trim() === '' ? NaN : Number(v)));
    if (values.length > 0 && values.every(v => Number.isFinite(v))) dials[name.slice(3)] = values;
    else ignored.push(`${name}=${text}`);
  }
  const game = q.has('game') && q.get('game') !== '0' && q.get('pieces') !== '0';
  return {
    fx: { on: q.get('fx') !== '0', demo: q.get('fxdemo') === '1' && !game, fast: q.get('fast') === '1', dials },
    dice: q.get('dice') !== '0',
    // The board whose woods are tree sides is the table's board (the owner, 2026-11-12); `map=` still shows any other.
    map: q.get('map') ?? 'test_standard_trees',
    // A game lays its own panel and controls over the page: the developer strip would lie under them.
    bare: q.get('bare') === '1' || (q.has('game') && q.get('game') !== '0'),
    tiltDeg,
    glideS,
    lampShare,
    vignetteStrength,
    light: isLightName(lightText) ? lightText : null,
    env: isRoomName(envText) ? envText : null,
    gleam: q.get('gleam') === '1',
    props: q.get('props') === '1',
    seed: /^\d{1,10}$/.test(q.get('seed') ?? '') ? Number(q.get('seed')) : 1,
    pieces: q.get('pieces') !== '0',
    tray: q.get('pieces') !== '0' && q.get('tray') !== '0',
    game,
    tier: isTierName(tierName) ? tierName : null,
    clear,
    faults,
    stressMs: Number.isFinite(stress) && stress > 0 ? stress : 0,
    bench: q.get('bench') === '1',
    mount,
    ignored,
  };
}
