/**
 * The table page: /?view=table&map=<id>[&bare=1][&tier=...], the board of a map
 * on the table, with no pieces on it (Milestone 4a).
 *
 * A map that is not under assets/maps comes with its text, URL-encoded, in the
 * address's fragment, exactly as the 3a viewer takes it:
 *   /?view=table&bare=1#mapText=<encodeURIComponent(text of the .map.yaml file)>
 *
 * What is here: the page's state (view, tier, overlay, look), its input, the
 * frame it draws when something changed and only then, recovery from a lost
 * graphics context, and `window.__table` for the checks (hook.ts says what each
 * reading is). The arithmetic is in camera.ts, layout.ts, levels.ts and
 * pick.ts; the objects in world.ts; the baked map's store in tiles.ts.
 *
 * Other settings (docs/bars/M4a.md): clear=<rrggbb>, fault=<name>, stress=<ms>,
 * bench=1. Keys: arrows or W A S D pan, = and - zoom, O switches the overview, ~ steps through the
 * cameras (top, low, lowest, three-quarter from the left and from the right).
 *
 * The mounted boards' dials (ruling 32), for showing settings side by side, in
 * h: border=<n> gap=<n> corner=<n> brown=<rrggbb> folds=<0..2> scuff=<0..2>;
 * the same through `__table.setLook`. `fault=oldboard`, or
 * `setLook({ construction: 'old' })`, draws the former construction.
 */
import * as THREE from 'three';
import * as hex from '@engine/core/hex';
import inksText from '@mapart/data/inks-a2.yaml?raw';
import { BakeClient } from '../bake/client';
import { LEVEL0_MAX_PIXELS as WORKER_LEVEL0_MAX, LEVEL_PX as WORKER_LEVEL_PX, TILE as WORKER_TILE } from '../bake/protocol';
import {
  FOV_Y_DEG, TILT_DEG, boxInFrame, clipRange, distanceOf, glideArrived, glideEntry, glideStep, heldIn, invert, limitView, multiply, ndcOf, orbitPose, perspective, planePoint, playPose,
  standProjection, toScreen, viewHolding, viewMatrix, zoomLimits,
} from './camera';
import type { Hold, Mat4, Pose, Stand, View, ViewEnv, ViewMode, ZoomLimits } from './camera';
import { gridGeometry, labelBox, rulerNumbers } from './grid';
import type { GridGeometry } from './grid';
import { mountAnswers, mountEffects, mountFxDemo, tuneWith } from './fx';
import type { AnswersMount, EffectEvent, EffectsMount, FxArt } from './fx';
import type { FreeCamera, RectTuple, TableHook } from './hook';
import { mountScene } from './host';
import type { SceneHost } from './host';
import { DEFAULT_MOUNT, boardsAcross, clampMount, layoutBoard } from './layout';
import type { BoardLayout, MountDials, Rect } from './layout';
import { CAP_MEGAPIXELS, LEVEL0_MAX_PIXELS, LEVEL_PX, TILE, TILE_MEGAPIXELS, chooseLevel } from './levels';
import type { LevelEnv } from './levels';
import { hitAt, pickHex } from './pick';
import { mountPieces } from './pieces';
import { mountDiceInset } from './dice/inset';
import type { InsetMount } from './dice/inset';
import { COUNTER } from './pieces/dims';
import type { TrayArt, UnitArt } from './pieces';
import type { PiecesMount } from './pieces';
import type { PiecesPort } from './pieces/port';
import { readSettings } from './settings';
import type { Fault } from './settings';
import { bakeSurfaces } from './surfaces';
import type { Surfaces } from './surfaces';
import { FINISH_EVERY, GPU_BUDGET_MS, INTERVAL_BUDGET_MS, StepDown, TIERS, bufferSize, isTierName, pixelRatioOf, tierBelow } from './tiers';
import type { TierName } from './tiers';
import { CAMERA_CHARS, KEYS, KEYS_TAKEN, tableKeyLines } from './keys';
import type { TableKeyLine } from './keys';
import { TileStore } from './tiles';
import { LOOK, SIGHT_LINE_KINDS, TINT_INKS, World, keyDirection } from './world';
import { DEFAULT_LIGHT, applyLight } from './lights';
import { woodTextures } from './wood';
import { mountProps, propsGround } from './props';
import type { PropsMount } from './props';
import type { WoodArt } from './wood';
import { mountRoom } from './env';
import type { RoomArt, RoomMount } from './env';
import type { RoomName } from './rooms';
import { mountMarks } from './marks'; // hulks and craters
import type { MarksMount } from './marks'; // hulks and craters

declare global {
  interface Window {
    __table?: TableHook;
  }
}

/** Where the tier in use and the player's choice are kept between visits. */
const STORAGE_KEY = 'table.tier';
/** The table beyond the lamp: what the renderer clears to before it draws. Never seen while the camera keeps its limits. */
const CLEAR: [number, number, number] = [0.07, 0.045, 0.03];
/** The stress setting: loop turns a pixel for one ms of GPU work on one megapixel (measured on the Apple M2). */
const STRESS_TURNS = 18;

/** A tilt beyond which the camera counts as low: its frame's far edge runs past the table. */
const LOW_CAMERA_FROM_DEG = 25;
const ENDLESS = 1e6;
/** How quickly things ease, as time constants in seconds: the zoom to its goal, the camera to the one chosen, a key's push, and the glide of a drag let go. */
const ZOOM_TAU = 0.09;
const KEY_PUSH_TAU = 0.07;
const GLIDE_TAU = 0.13;
/** The zoom never runs faster than this (in natural-log units a second: about a doubling in an eighth of a second), and takes this long to gather that speed, so that a long zoom (the overview key) starts and ends gently. */
const ZOOM_TOP_RATE = 5.5;
const ZOOM_GATHER_S = 0.14;
/** How long the camera takes to turn to the next one, eased at both ends. */
const CAMERA_TURN_MS = 480;
/** Keys: the zoom doubles and a bit in a second; a pan crosses most of the view in a second. */
const KEY_ZOOM_RATE = 2.4;
const KEY_PAN_RATE = 0.9;
/**
 * A drag glides on only if let go while moving, judged over its last moments. Under the first speed
 * (a share of the view's width a second) it does not glide at all; from the second it carries its
 * whole speed on; between the two the carry grows smoothly, so there is no speed at which the
 * behaviour changes at a step. A drag brought to rest and let go stays exactly where it was put.
 */
const GLIDE_FROM_SHARE = 0.3;
const GLIDE_FULL_SHARE = 0.95;
const GLIDE_WINDOW_MS = 90;
const GLIDE_FRESH_MS = 45;
/** How much of the drag's speed the glide starts with at most, and the speed (as a share of the view's width a second) under which it is still. */
const GLIDE_CARRY = 0.85;
const STILL_SHARE = 0.01;
/** A glide of the view to a set of hexes (`goTo`) never lasts longer than this: whatever stands in its way, the table comes to rest. */
const GO_TO_MAX_S = 2.5;
/** Whether the page runs on a Mac, where Ctrl with the main button is the secondary click (some browsers report it as that button). */
const ON_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** One of the table's own switches or actions, as a page that takes them shows it: `on` is null for an action, true or false for a switch. */
export interface TableControl {
  readonly id: string;
  readonly label: string;
  /** The key that does the same, as printed on a cap; '' when it has none. */
  readonly key: string;
  readonly on: boolean | null;
}

/**
 * The table's controls, offered to the page that started it (`joins.onControls`). A page that takes them
 * shows them itself (a game's panel does, in a pop-out): the table then draws no buttons of its own, gives
 * up the letters and the digits (keys.ts), and leaves alone any key the page has already used.
 */
export interface TableControls {
  /** The controls in order, each as it stands now. */
  list(): readonly TableControl[];
  press(id: string): void;
  /** Calls `fn` whenever a control's state may have changed; returns a function that stops the calls. */
  onChange(fn: () => void): () => void;
  /** The table's keys as lines, for a list of keys. */
  readonly keys: readonly TableKeyLine[];
  /** The colours the board tints a game's hexes with, by the game's kinds (reach, and after it `reach-near`, the nearer part of a reach as it looks laid over the reach; target, path, objective, zone), as CSS colours: for a legend. */
  readonly tints: readonly { readonly kind: string; readonly colour: string }[];
  /**
   * Put the play view, at once, where these hexes are all in it with room to spare, as far as play's zoom
   * goes: for the start of a game, before the board is first looked at (it does not ease, so it is not for
   * use in the middle of play).
   */
  frame(hexes: readonly number[]): void;
  /**
   * Take the play view, eased, to where these hexes are all in it: the centre glides to their middle (set a
   * little below the middle of the frame, as `frame` sets them, clear of the panel), and the zoom runs out only
   * as far as they need; it never runs in. When they are all in view already, with room to spare, nothing moves.
   * Any input of the player's (a drag, the wheel, a pan key, a camera key) takes over at once.
   */
  goTo(hexes: readonly number[]): void;
}

/**
 * Room left round the hexes a view is framed to: column steps at the sides; at the ends a share of the height (the panel's plate and its row of commands lie over the board there) and steps besides; and how far the hexes are set below the middle, as a share of the height shown (by moving the view's centre the other way).
 * `inView` is for `goTo`: hexes that are in the frame already, clear of what the panel covers, with this many column steps round each (a counter and a little more), are in view, and the view is left alone.
 */
const FRAME_ROOM = { sides: 3, endsShare: 1.3, ends: 2, lower: -0.06, inView: 0.6 };
/**
 * The same room as a camera takes it (camera.ts, `Hold`): the shares of the frame's height the panel lies over at
 * the top and at the bottom, and the room round each hex in h. `full`: the room a view is taken to; else the room
 * that hexes in view already must have.
 */
function holdOf(colStep: number, full: boolean): Hold {
  const spare = (1 - 1 / FRAME_ROOM.endsShare) / 2;
  return {
    top: spare - FRAME_ROOM.lower,
    bottom: spare + FRAME_ROOM.lower,
    side: (full ? FRAME_ROOM.sides / 2 : FRAME_ROOM.inView) * colStep,
    end: (full ? FRAME_ROOM.ends / (2 * FRAME_ROOM.endsShare) : FRAME_ROOM.inView) * colStep,
  };
}

/**
 * The colours the board tints a game's hexes with, by the game's kinds, as CSS colours for a legend
 * (`TableControls.tints`). The nearer part of a reach is laid over the reach's own tint: its colour is the two together.
 */
function tintLegend(): { kind: string; colour: string }[] {
  return ([['reach', 'reach'], ['reach-near', 'reachNear'], ['target', 'fire'], ['path', 'path'], ['objective', 'objective'], ['zone', 'zone']] as const).map(([kind, name]) => {
    const ink = TINT_INKS[name] ?? [200, 200, 200];
    const under = kind === 'reach-near' ? (TINT_INKS.reach ?? [255, 255, 255]) : [255, 255, 255];
    const shade = ink.map((v, k) => Math.round((v * (under[k] as number)) / 255));
    return { kind, colour: `rgb(${shade[0]}, ${shade[1]}, ${shade[2]})` };
  });
}

/** The map text in the address's fragment (#mapText=...), if any. */
function mapTextFromAddress(): string | null {
  const fragment = window.location.hash;
  if (!fragment.startsWith('#mapText=')) return null;
  return decodeURIComponent(fragment.slice('#mapText='.length));
}

/**
 * The lines that bar sight as the board's shader takes them. For each hex, one byte a kind, with one
 * bit for each of its six sides that is set, by the hex module's number of the side; a side is set
 * in both hexes it lies between. And which side lies toward each of the grid's three steps, and
 * away from it: found by asking the hex module where each side's middle is, so that no fact about
 * hexes is written here.
 */
function sideData(g: hex.Grid, steps: readonly (readonly [number, number])[], kinds: readonly (readonly number[])[]): { bits: Uint8Array; dirs: [number, number, number, number, number, number] } {
  const count = hex.hexCount(g);
  const bits = new Uint8Array(count * 4);
  kinds.slice(0, SIGHT_LINE_KINDS).forEach((keys, kind) => {
    for (const key of keys) {
      const [id, d] = hex.sideFromKey(key);
      if (id < 0 || id >= count) continue;
      bits[id * 4 + kind] = (bits[id * 4 + kind] as number) | (1 << d);
      const other = hex.neighbourOf(g, id, d);
      if (other < 0) continue;
      for (let back = 0; back < hex.DIR_NAMES.length; back++) {
        if (hex.neighbourOf(g, other, back) === id) bits[other * 4 + kind] = (bits[other * 4 + kind] as number) | (1 << back);
      }
    }
  });
  const dirs: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  const c = hex.centreOf(g, 0);
  for (let d = 0; d < hex.DIR_NAMES.length; d++) {
    const mid = hex.sideMidpoint(g, 0, d);
    const v: [number, number] = [mid[0] - c[0], mid[1] - c[1]];
    steps.forEach((s, k) => {
      const along = (v[0] * s[0] + v[1] * s[1]) / Math.hypot(s[0], s[1]) / Math.hypot(v[0], v[1]);
      if (along > 0.99) dirs[k] = d;
      if (along < -0.99) dirs[k + steps.length] = d;
    });
  }
  return { bits, dirs };
}

/** The key plate's ink in the ink table the bake uses, as sRGB 0..255. */
function keyInk(): [number, number, number] {
  const m = /id:\s*key\s*,\s*ink:\s*"#([0-9A-Fa-f]{6})"/.exec(inksText);
  if (!m) throw new Error('the ink table has no key plate');
  const v = m[1] as string;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

function message(root: HTMLElement, text: string): void {
  const box = document.createElement('div');
  box.setAttribute('role', 'alert');
  box.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:2rem;font:18px/1.5 system-ui,sans-serif;color:CanvasText;background:Canvas;text-align:center';
  box.textContent = text;
  root.appendChild(box);
}

export function startTable(
  root: HTMLElement,
  params: URLSearchParams,
  joins?: {
    onPieces?: (port: PiecesPort) => void;
    unitArt?: UnitArt;
    /** The counter tray's art, fetched and decoded by whoever starts the page (the scene downloads nothing); without it there is no tray. `tray=0` in the address leaves it off. */
    tray?: Promise<TrayArt | null>;
    /** The table's scanned wood (scene/wood.ts), fetched and decoded by whoever starts the page; without it the table draws its own wood. `wood=0` in the address leaves it off. */
    wood?: Promise<WoodArt | null>;
    /** The room round the table (scene/env.ts), by name, fetched and decoded by whoever starts the page when the address says `env=<name>`; null when it failed. Without it there is no room. */
    room?: (name: RoomName) => Promise<RoomArt | null>;
    /** The effects' pictures (fire, blast, smoke), fetched and decoded the same way; without them the table shows only the effects it draws itself. `fx=0` in the address leaves all effects off. */
    fx?: Promise<FxArt | null>;
    /** Told when an effect starts: which, on which hex, when (the page's clock, ms). For sound. */
    onEffect?: (e: EffectEvent) => void;
    /** The hulks' and craters' pictures, fetched and decoded by whoever starts the page when the table first asks (the scene downloads nothing): by their files' names; null when they failed. Without it the marks are kept and not drawn. */
    marks?: () => Promise<ReadonlyMap<string, CanvasImageSource> | null>;
    /** Given: the page takes the table's controls and shows them itself (see TableControls). Called once, when the board is on the table. */
    onControls?: (controls: TableControls) => void;
  },
): void {
  const settings = readSettings(params.toString());
  const faults: ReadonlySet<Fault> = new Set(settings.faults);
  const mapText = mapTextFromAddress();
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';
  root.textContent = '';

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;touch-action:none;cursor:grab;display:block;outline:none';
  canvas.tabIndex = 0;
  root.appendChild(canvas);

  // ---- state ---------------------------------------------------------------------------------
  let css: [number, number] = [Math.max(1, window.innerWidth), Math.max(1, window.innerHeight)];
  let device: [number, number] = [css[0], css[1]];
  let layout: BoardLayout | null = null;
  let grid: hex.Grid | null = null;
  let geometry: GridGeometry | null = null;
  let world: World | null = null;
  let host: SceneHost | null = null;
  let store: TileStore | null = null;
  /** The hulks and craters a game leaves (./marks), with a game's counters. */
  let marks: MarksMount | null = null;
  let surfaces: Surfaces | null = null;
  /** Things on the table (scene/props), unless the address says props=0. */
  let props: PropsMount | null = null;
  /** The room round the table (scene/env.ts), when the address names one. */
  let room: RoomMount | null = null;
  /** The counters (Milestone 4b), unless the address says pieces=0. */
  let pieces: PiecesMount | null = null;
  /** The effects (fire, blast, smoke), unless the address says fx=0. */
  let effects: EffectsMount | null = null;
  /** When the last frame was drawn that only a lasting effect asked for. */
  let lastAmbient = 0;
  /** The table's answers to what a player does (what a click would do, badges, refusals), with the counters. */
  let answers: AnswersMount | null = null;
  /** The dice inset (dice/inset.ts), with the counters. */
  let diceInset: InsetMount | null = null;
  /** The cursor a game's intent asks for, or null; and whether a game has told an intent at all (the canvas then rests on the plain arrow, not on the hand that slides the board). */
  let intentCursor: string | null = null;
  let intentSpoken = false;
  const restCursor = (): string => intentCursor ?? (intentSpoken ? 'default' : 'grab');
  let levelEnv: LevelEnv | null = null;
  let view: View = { mode: 'play', centre: [0, 0], hexesAcross: 18 };
  /** The view play goes back to from the overview. */
  let playView: View | null = null;
  // The cameras the ~ key steps through (Shift is not looked at, so ` and ~ both step): how far each tilts from straight down, and where it stands
  // round the board (0 is the near side; negative is toward the left). The camera eases from one to
  // the next; `camTilt` and `camAzimuth` are where it is now.
  const CAMERAS: readonly { name: string; tiltDeg: number; azimuthDeg: number }[] = [
    { name: 'top', tiltDeg: Math.min(76, settings.tiltDeg ?? TILT_DEG), azimuthDeg: 0 },
    // The low ones stand 6 degrees higher than they first did (60, 68, 58, 58; the owner, 2026-11-14: "a bit too low").
    { name: 'low', tiltDeg: 54, azimuthDeg: 0 },
    { name: 'lowest', tiltDeg: 62, azimuthDeg: 0 },
    { name: 'three-quarter from the left', tiltDeg: 52, azimuthDeg: -26 },
    { name: 'three-quarter from the right', tiltDeg: 52, azimuthDeg: 26 },
  ];
  const glideTau = settings.glideS ?? GLIDE_TAU;
  let cameraIndex = 0;
  let camTilt = (CAMERAS[0] as { tiltDeg: number }).tiltDeg;
  let camAzimuth = 0;
  /** A turn to another camera under way: where it began and how far through it is (0 to 1). */
  let cameraTurn: { fromTilt: number; fromAzimuth: number; done: number } | null = null;
  // Motion. Nothing snaps: a zoom is a goal the view eases to; a drag let go at speed glides on and is
  // damped quickly; keys push a velocity. All of it runs in the page's own loop and stops it when still.
  /** The zoom the view is easing to, in hexes across. */
  let zoomGoal = 18;
  /** How fast the zoom is running, in natural-log units a second. */
  let zoomRate = 0;
  /** The play view the overview key left, and goes back to. */
  let returnView: View | null = null;
  /** What the zoom keeps under the pointer while it eases: a board point and the place in the frame. */
  let zoomAnchor: { point: [number, number]; ndc: [number, number] } | null = null;
  /** The centre play had when the zoom ran out past it toward the overview, and comes back in to. */
  let runBase: [number, number] = [0, 0];
  /** The view's own speed, in h a second. */
  let panVel: [number, number] = [0, 0];
  /** Where the view's centre was at the last few moves of a drag, for its speed at release. */
  let dragTrail: { t: number; c: [number, number] }[] = [];
  /** A drag of the view: the board point taken hold of. */
  let drag: { anchor: [number, number] } | null = null;
  /**
   * A glide of the view to a set of hexes (`goTo`): the centre play is drawn to (in the run-out to the whole table: the
   * centre it comes back in to), the zoom it runs out to, the centre's speed in h a second, whether the centre has
   * arrived (the zoom may still be easing), and how long it has run.
   */
  let glide: { goal: [number, number]; across: number; vel: [number, number]; hexes: number[]; arrived: boolean; age: number } | null = null;
  /** What became of each `goTo`, counted for checks (hook.ts says what each count is). */
  const glides = { asked: 0, begun: 0, still: 0, held: 0, arrived: 0, taken: 0 };
  let free: FreeCamera | null = null;
  let lastViewProj: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  let lastPose: Pose = playPose([0, 0], 1, 0);
  let lost = false;
  let restoring = false;
  let frameRequested = false;
  let lastLoopDraw = 0;
  let drawnOnce = -1e9;
  let fence: WebGLSync | null = null;
  const held = new Set<string>();
  /** A page has taken the table's controls: no buttons of the table's own, and the letters and digits are the page's (keys.ts). */
  const taken = joins?.onControls !== undefined;
  const keys = taken ? KEYS_TAKEN : KEYS;
  const controlListeners = new Set<() => void>();
  const controlsChanged = (): void => {
    for (const fn of [...controlListeners]) fn();
  };
  let lastTick = 0;
  let pointer: [number, number] | null = null;
  const overlay = { strength: 1, lines: true, labels: true, sight: true, tints: {} as Record<string, number[]> };
  let sightSides = 0;
  const look = { grade: true, vignette: true, lamp: settings.lampShare ?? 1 };
  // The table's light (lights.ts): set on the look before anything is built from it; `vignette=` still has the last word.
  applyLight(settings.light ?? DEFAULT_LIGHT, LOOK);
  // `gleam=0`: the paper's sheen and the table's coat smooth, as they were.
  if (!settings.gleam) {
    // With a room on the table (env=) the paper keeps its relief, so that the room's gleam on the sheet breaks up as on paper.
    if (!settings.env) LOOK.paper = [0, 0, 0, 0];
    LOOK.coatB = [0, 0, 0, 0];
  }
  if (settings.vignetteStrength !== null) LOOK.vignette = settings.vignetteStrength;
  // The mounted boards' dials (ruling 32): the page's own, then the address's. The planted fault
  // `oldboard` draws the former construction.
  let mount: MountDials = clampMount({
    construction: faults.has('oldboard') ? 'old' : 'mounted',
    border: settings.mount.border ?? DEFAULT_MOUNT.border,
    gap: settings.mount.gap ?? DEFAULT_MOUNT.gap,
    cornerRadius: settings.mount.cornerRadius ?? DEFAULT_MOUNT.cornerRadius,
  });
  const dial = (v: number): number => Math.min(2, Math.max(0, v));
  if (settings.mount.brown) LOOK.wrapBrown = [...settings.mount.brown];
  if (settings.mount.folds !== undefined) LOOK.wrapFolds = dial(settings.mount.folds);
  if (settings.mount.wrapWear !== undefined) LOOK.wrapWear = dial(settings.mount.wrapWear);

  // ---- tier ----------------------------------------------------------------------------------
  const tier: { name: TierName; chosenBy: 'auto' | 'player'; changes: { atMs: number; from: TierName; to: TierName }[] } = { name: 'tabletop+', chosenBy: 'auto', changes: [] };
  // Only a tier the player chose is kept for the next visit (ruling 37). A step down the page took
  // by itself lasts for the visit: a busy minute must not leave the table flat for good.
  const remember = (): void => {
    try {
      if (tier.chosenBy === 'player') window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: tier.name, chosenBy: tier.chosenBy }));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage may be switched off; the tier then lasts for the visit only.
    }
  };
  if (settings.tier) {
    tier.name = settings.tier;
    tier.chosenBy = 'player';
  } else {
    try {
      const kept: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null');
      if (kept && typeof kept === 'object') {
        const k = kept as { name?: unknown; chosenBy?: unknown };
        // A tier kept from a visit in which the page stepped down by itself is not taken up again.
        if (isTierName(k.name) && k.chosenBy === 'player') {
          tier.name = k.name;
          tier.chosenBy = 'player';
        }
      }
    } catch {
      // Nothing kept, or storage switched off.
    }
  }
  let pixelRatio = pixelRatioOf(tier.name, window.devicePixelRatio || 1, css);

  // ---- the hook, published at once so that a failure can be read from it ------------------------
  const none = (): never => {
    throw new Error('the table is not ready');
  };
  const hook: TableHook = {
    ready: false,
    error: null,
    webgl2: false,
    firstFrameMs: null,
    frames: 0,
    drawCalls: 0,
    triangles: 0,
    drawOnce: () => undefined,
    map: { id: settings.map, cols: 0, rows: 0, bounds: [0, 0, 0, 0], hash: null },
    builds: 0,
    bakes: { level0: 0, tiles: 0 },
    slabs: [],
    sheets: [],
    seams: [],
    border: 0,
    gap: 0,
    grooveWidth: 0,
    margin: 0,
    table: { rect: [0, 0, 0, 0], z: 0 },
    get camera() {
      return {
        viewProj: lastViewProj.slice(),
        position: [...lastPose.position] as [number, number, number],
        target: [...lastPose.target] as [number, number, number],
        tiltDeg: (Math.acos(Math.min(1, Math.max(-1, lastPose.back[2]))) * 180) / Math.PI,
        fovYDeg: FOV_Y_DEG,
      };
    },
    get screen() {
      return { css: [css[0], css[1]] as [number, number], device: [device[0], device[1]] as [number, number], pixelRatio };
    },
    get view() {
      return { mode: view.mode, centre: [view.centre[0], view.centre[1]] as [number, number], hexesAcross: view.hexesAcross };
    },
    get limits() {
      return layout ? limits() : { closest: 0, farthest: 0, overview: 0 };
    },
    setView: none,
    setCamera: none,
    get glide() {
      return glide ? { centre: [glide.goal[0], glide.goal[1]] as [number, number], hexesAcross: glide.across, hexes: glide.hexes.slice(), centred: glide.arrived } : null;
    },
    get glides() {
      return { ...glides };
    },
    goTo: none,
    keys,
    corners: none,
    pick: () => -1,
    centreOf: id => {
      if (!grid || !Number.isInteger(id) || id < 0 || id >= hex.hexCount(grid)) return null;
      const c = hex.centreOf(grid, id);
      return [c[0], c[1]];
    },
    hover: -1,
    get tiles() {
      return {
        level0: { pxPerHex: levelEnv ? levelEnv.densities[0] : 0, megapixels: store ? store.level0Pixels / 1e6 : 0 },
        capMegapixels: CAP_MEGAPIXELS,
        tileMegapixels: TILE_MEGAPIXELS,
        residentMegapixels: store ? store.residentMegapixels() : 0,
        resident: store ? store.residentKeys() : [],
        shown: store ? store.shownKeys() : [],
        pending: store ? store.pending() : 1,
        level: store ? store.currentLevel() : 0,
      };
    },
    get textures() {
      return {
        count: (store ? store.textureCount() : 0) + (surfaces && !lost ? surfaces.count : 0) + (world && !lost ? world.dataCount : 0),
        bytes: (store ? store.textureBytes() : 0) + (surfaces && !lost ? surfaces.bytes : 0) + (world && !lost ? world.dataBytes : 0),
      };
    },
    get overlay() {
      return {
        strength: overlay.strength,
        lines: overlay.lines,
        labels: overlay.labels,
        sight: overlay.sight,
        sightSides,
        tints: Object.fromEntries(Object.entries(overlay.tints).map(([k, v]) => [k, v.slice()])),
        ink: overlayInk,
        tintInks: { ...TINT_INKS },
        legend: tintLegend(),
        labelBoxes: () => {
          if (!grid || !geometry) return [];
          const g = grid;
          const geo = geometry;
          return Array.from({ length: hex.hexCount(g) }, (_, id) => ({ hex: id, text: hex.labelOf(g, id), box: labelBox(geo, hex.centreOf(g, id)) }));
        },
        rulers: () => (grid && layout ? rulerNumbers(hex, grid.cols, grid.rows, layout.board, layout.margin, (c, r) => hex.labelOf(grid as hex.Grid, hex.indexOf(grid as hex.Grid, c, r))) : []),
      };
    },
    setOverlay: none,
    get look() {
      const [hx, hy] = LOOK.keyHeading;
      return {
        grade: look.grade,
        vignette: look.vignette,
        gradeGain: [...LOOK.grade] as [number, number, number],
        vignetteStrength: LOOK.vignette,
        keyAzimuthDeg: (Math.atan2(hx, hy) * 180) / Math.PI,
        keyElevationDeg: LOOK.keyElevationDeg,
        construction: layout ? layout.construction : mount.construction,
        border: mount.border,
        gap: mount.gap,
        cornerRadius: mount.cornerRadius,
        brown: [...LOOK.wrapBrown] as [number, number, number],
        folds: LOOK.wrapFolds,
        wrapWear: LOOK.wrapWear,
      };
    },
    setLook: none,
    get tier() {
      const spec = TIERS[tier.name];
      return {
        name: tier.name,
        chosenBy: tier.chosenBy,
        pixelRatio,
        msaaSamples,
        tilt: spec.tilt,
        lit: spec.lit,
        surfaceDetail: spec.surfaceDetail,
        changes: tier.changes.map(c => ({ ...c })),
        measuredBy: timerExt ? ('gpu' as const) : ('interval' as const),
      };
    },
    setTier: none,
    context: { losses: 0, restores: 0, lastRestoredMs: null },
    settings: { faults: [...faults], stressMs: settings.stressMs, bench: settings.bench, ignored: settings.ignored },
    timings: { buildMs: null, level0Ms: null, lastTileMs: null },
  };
  window.__table = hook;
  let msaaSamples = 0;
  let overlayInk: [number, number, number] = [0, 0, 0];

  const fail = (err: unknown): void => {
    hook.error = err instanceof Error ? err.message : String(err);
    console.error(err);
    if (!hook.ready) message(root, `The board could not be shown: ${hook.error}`);
  };

  // ---- WebGL 2, or a plain message (ruling 13) --------------------------------------------------
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  if (!gl) {
    canvas.remove();
    hook.error = 'WebGL 2 is not available';
    message(root, 'The board cannot be shown in this browser: it needs WebGL 2, and this browser does not have it or has it switched off.');
    return;
  }
  hook.webgl2 = true;
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = false;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const clear = settings.clear ?? CLEAR;
  renderer.setClearColor(new THREE.Color().setRGB(clear[0], clear[1], clear[2], THREE.SRGBColorSpace), 1);
  msaaSamples = gl.getParameter(gl.SAMPLES) as number;
  const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  let timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  const camera = new THREE.PerspectiveCamera(FOV_Y_DEG, css[0] / css[1], 1, 1000);
  camera.matrixAutoUpdate = false;
  camera.matrixWorldAutoUpdate = false;

  // ---- nothing over the canvas when bare; otherwise a small strip of controls --------------------
  let hud: HTMLDivElement | null = null;
  let readout: HTMLSpanElement | null = null;
  if (!settings.bare) {
    hud = document.createElement('div');
    hud.style.cssText = 'position:fixed;left:8px;bottom:8px;display:flex;gap:6px;align-items:center;font:12px/1.4 system-ui,sans-serif;padding:4px 8px;background:Canvas;color:CanvasText;opacity:0.92;border-radius:4px';
    const button = (label: string, title: string, act: () => void): void => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      b.style.cssText = 'font:inherit;padding:1px 6px;cursor:pointer';
      b.addEventListener('click', () => {
        act();
        canvas.focus();
      });
      (hud as HTMLDivElement).appendChild(b);
    };
    button('Overview', 'Show the whole map (O)', () => toggleOverview());
    button('Flat', 'Top-down, unlit', () => hook.setTier('flat'));
    button('Tabletop', 'Tilted, lit', () => hook.setTier('tabletop'));
    button('Tabletop+', 'Adds the fine surface', () => hook.setTier('tabletop+'));
    button('Auto', 'Let the page choose', () => hook.setTier(null));
    button('Grid', 'Hex lines on or off', () => hook.setOverlay({ lines: !overlay.lines }));
    button('Numbers', 'Hex numbers on or off', () => hook.setOverlay({ labels: !overlay.labels }));
    button('Sight lines', 'The lines that bar sight, on or off', () => hook.setOverlay({ sight: !overlay.sight }));
    readout = document.createElement('span');
    hud.appendChild(readout);
    root.appendChild(hud);
  } else if (settings.game && !taken) {
    // A game lays its own panel over the page, so the developer strip is not shown; the table's own
    // switches stay in reach in a small column at the left edge, above the game's rows of controls and
    // below its strip of groups. (A page that has taken the controls shows them itself: no column then.)
    const strip = document.createElement('div');
    strip.style.cssText = 'position:fixed;left:8px;bottom:128px;z-index:30;display:flex;flex-direction:column;gap:4px;font:12px/1.3 system-ui,sans-serif;padding:5px;background:Canvas;color:CanvasText;opacity:0.9;border-radius:5px';
    const button = (label: string, title: string, act: () => void): void => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      b.style.cssText = 'font:inherit;padding:2px 7px;cursor:pointer;text-align:left';
      b.addEventListener('click', () => {
        act();
        b.blur();
      });
      strip.appendChild(b);
    };
    button('View ~', 'The next camera (the ~ key, or 1 to 5)', () => cycleCamera());
    button('Whole O', 'The whole table and back (O)', () => toggleOverview());
    button('Grid', 'Hex lines on or off', () => hook.setOverlay({ lines: !overlay.lines }));
    button('Numbers', 'Hex numbers on or off', () => hook.setOverlay({ labels: !overlay.labels }));
    button('Sight', 'The lines that bar sight, on or off', () => hook.setOverlay({ sight: !overlay.sight }));
    button('Finer', 'The finest look: tilted, lit, the fine surface', () => hook.setTier('tabletop+'));
    root.appendChild(strip);
  }

  // ---- views and cameras -----------------------------------------------------------------------
  const envAt = (tiltDeg: number): ViewEnv => {
    const l = layout as BoardLayout;
    // The limits keep the frame on the table at the top camera's tilt. From a low camera the frame's
    // far edge runs past any table, so there the table is taken as endless and the far end may show.
    const table: Rect = tiltDeg > LOW_CAMERA_FROM_DEG ? [-ENDLESS, -ENDLESS, ENDLESS, ENDLESS] : l.table.rect;
    return { board: l.board, outline: l.outline, table, css, device, tiltDeg, fovYDeg: FOV_Y_DEG, colStep: hex.COL_STEP };
  };
  const env = (): ViewEnv => envAt(TIERS[tier.name].tilt ? camTilt : 0);
  const azimuthNow = (): number => (TIERS[tier.name].tilt ? camAzimuth : 0);
  /** The camera as it stands, without where it looks; in the middle of a turn to another camera, that camera. */
  const standNow = (): Stand => {
    const tilted = TIERS[tier.name].tilt;
    const to = cameraTurn ? (CAMERAS[cameraIndex] as { tiltDeg: number; azimuthDeg: number }) : null;
    return { azimuthDeg: tilted ? (to ? to.azimuthDeg : camAzimuth) : 0, tiltDeg: tilted ? (to ? to.tiltDeg : camTilt) : 0, fovYDeg: FOV_Y_DEG, aspect: css[0] / css[1], colStep: hex.COL_STEP };
  };
  let limitsKey = '';
  // A map that fits on one mounted board (a half board, 11 x 10) lies on one board of its own; any other on three.
  const layBoards = (bounds: Rect, g: hex.Grid): BoardLayout => layoutBoard(bounds, g.cols, col => hex.centreAt(col, 0)[0], faults.has('smalltable'), mount, boardsAcross(g));
  let limitsMemo: ZoomLimits = { closest: 0, farthest: 0, overview: 0 };
  const limits = (): ZoomLimits => {
    const key = `${css[0]}x${css[1]}:${device[0]}x${device[1]}:${tier.name}:${camTilt.toFixed(3)}`;
    if (key !== limitsKey) {
      limitsMemo = zoomLimits(env());
      limitsKey = key;
    }
    return limitsMemo;
  };
  const poseNow = (): Pose => {
    if (free) {
      const t = free.target;
      return orbitPose(free.azimuthDeg, free.elevationDeg, free.distance, [t[0], t[1], t[2] ?? 0]);
    }
    const e = env();
    return orbitPose(azimuthNow(), 90 - e.tiltDeg, distanceOf(view.hexesAcross, e), [view.centre[0], view.centre[1], 0]);
  };
  const matricesOf = (pose: Pose): { proj: Mat4; view: Mat4; viewProj: Mat4 } => {
    const [near, far] = clipRange(pose.distance);
    const proj = perspective(FOV_Y_DEG, css[0] / css[1], near, far);
    const v = viewMatrix(pose);
    return { proj, view: v, viewProj: multiply(proj, v) };
  };
  const viewProjNow = (): Mat4 => matricesOf(poseNow()).viewProj;

  /** Tell the store what the view needs, at once, so that `tiles.pending` counts it. */
  const updateNeeds = (): void => {
    if (!store || !levelEnv || lost) return;
    const pose = poseNow();
    store.want(chooseLevel(matricesOf(pose).viewProj, device, levelEnv), [pose.target[0], pose.target[1]]);
  };

  /** Put a view in place as it is. */
  const setViewNow = (v: View): void => {
    view = v;
    if (v.mode === 'play') {
      playView = v;
      runBase = [v.centre[0], v.centre[1]];
    }
    updateNeeds();
  };
  /** A view asked for outright (the hook, a resize, a change of tier): applied at once, and all motion stops there. */
  const applyView = (request: { mode?: ViewMode; centre?: readonly [number, number]; hexesAcross?: number }): void => {
    if (!layout) return;
    endGlide(false);
    setViewNow(limitView(request, env()));
    zoomGoal = view.hexesAcross;
    zoomRate = 0;
    zoomAnchor = null;
    returnView = null;
    panVel = [0, 0];
  };

  /**
   * How far a zoom has run out from the farthest play view toward the whole table: 0 anywhere in
   * play's range, 1 at the whole table, eased between. The zoom simply runs on past play's range,
   * and the centre is drawn in to the whole table's by this share: no step between the two.
   */
  const runOut = (across: number): number => {
    const l = limits();
    if (across <= l.farthest || l.overview <= l.farthest) return 0;
    const t = Math.min(1, (across - l.farthest) / (l.overview - l.farthest));
    return t * t * (3 - 2 * t);
  };

  /**
   * Put the view at a zoom, with its centre as near a wanted one as that zoom allows; with none
   * wanted, the centre stays where it is in play's range and follows the run-out beyond it. In the
   * run-out a wanted centre is met by moving the play centre it is drawn in from, as far as that
   * may go, so that a drag and a zoom about the pointer work all the way out, with less and less
   * room, to the whole table, where there is none.
   */
  const place = (across: number, wanted: readonly [number, number] | null): void => {
    const e = env();
    const l = limits();
    const a = Math.max(l.closest, Math.min(Math.max(l.farthest, l.overview), across));
    const k = runOut(a);
    if (k <= 0) {
      setViewNow(limitView({ mode: 'play', centre: wanted ?? (view.mode === 'play' ? view.centre : runBase), hexesAcross: a }, e));
      return;
    }
    const whole = limitView({ mode: 'overview' }, e);
    const base: readonly [number, number] = wanted && k < 0.999 ? [(wanted[0] - whole.centre[0] * k) / (1 - k), (wanted[1] - whole.centre[1] * k) / (1 - k)] : runBase;
    const from = limitView({ mode: 'play', centre: base, hexesAcross: l.farthest }, e).centre;
    runBase = [from[0], from[1]];
    setViewNow({ mode: 'overview', centre: [from[0] + (whole.centre[0] - from[0]) * k, from[1] + (whole.centre[1] - from[1]) * k], hexesAcross: a });
  };

  /** The centre that keeps a board point under a place in the frame at a zoom, for the camera as it stands (any tilt, any side). */
  const centreFor = (anchor: readonly [number, number], ndc: readonly [number, number], hexesAcross: number): [number, number] | null => {
    const e = env();
    const pose = orbitPose(azimuthNow(), 90 - e.tiltDeg, distanceOf(hexesAcross, e), [0, 0, 0]);
    const offset = planePoint(invert(matricesOf(pose).viewProj), ndc[0], ndc[1], 0);
    return offset ? [anchor[0] - offset[0], anchor[1] - offset[1]] : null;
  };

  /** The centre play has: the view's own in play's range; in the run-out to the whole table, the one it comes back in to. */
  const playCentre = (): [number, number] => (view.mode === 'play' ? [view.centre[0], view.centre[1]] : [runBase[0], runBase[1]]);

  /**
   * A glide of the view (`goTo`) ends here, short of its goal, because the player has put a hand to the view: the zoom
   * it asked for stops where it is. `carry`: the view keeps the glide's speed, no more of it than a pan key gives, and
   * sheds it as it does a thrown drag's (for a key, which then pushes it its own way); else it stops where it is (a
   * hand on the board, the wheel).
   */
  function endGlide(carry: boolean): void {
    if (!glide) return;
    if (carry && !glide.arrived) {
      const top = view.hexesAcross * hex.COL_STEP * KEY_PAN_RATE;
      const speed = Math.hypot(glide.vel[0], glide.vel[1]);
      const k = speed > top ? top / speed : 1;
      panVel = [glide.vel[0] * k, glide.vel[1] * k];
    }
    zoomGoal = view.hexesAcross;
    glide = null;
    glides.taken++;
  }

  /**
   * `goTo`: the play view glides to where these hexes are all in it (TableControls says what is promised). The glide is
   * part of the view's one motion (`stepMotion`): this only sets its goals. It is judged by the camera as it stands (in
   * the middle of a turn to another camera: by that camera, which the turn goes on to undisturbed).
   */
  function goTo(hexes: readonly number[]): void {
    if (!layout || !grid || free) return;
    glides.asked++;
    const g = grid;
    const count = hex.hexCount(g);
    const ids = hexes.filter(h => Number.isInteger(h) && h >= 0 && h < count);
    if (ids.length === 0) return;
    // A view the player is holding is theirs: a hand on the board, a key held that slides or zooms it.
    if (drag || [keys.left, keys.right, keys.up, keys.down, keys.zoomIn, keys.zoomOut].some(names => names.some(k => held.has(k)))) {
      glides.held++;
      return;
    }
    const points = ids.map(h => hex.centreOf(g, h));
    const stand = standNow();
    const e = envAt(stand.tiltDeg);
    const l = cameraTurn ? zoomLimits(e) : limits();
    // Beyond play's range (the whole table, or on the way out to it or back): it returns to play's farthest zoom.
    const out = Math.max(zoomGoal, view.hexesAcross) > l.farthest * 1.0005;
    // Where the view is heading as it is: the zoom's goal, and the centre it will have there (a glide's goal; what a zoom
    // about the pointer will leave it with; else where it is).
    const heading = out ? l.farthest : Math.max(l.closest, Math.min(l.farthest, zoomGoal));
    let centre = playCentre();
    if (glide) centre = [glide.goal[0], glide.goal[1]];
    else if (!out && zoomAnchor) centre = limitView({ mode: 'play', centre: centreFor(zoomAnchor.point, zoomAnchor.ndc, heading) ?? centre, hexesAcross: heading }, e).centre;
    if (!out) {
      const box = boxInFrame(standProjection(stand, centre, heading), stand.azimuthDeg, points, FRAME_ROOM.inView * e.colStep, FRAME_ROOM.inView * e.colStep);
      if (box && heldIn(box, holdOf(e.colStep, false))) {
        glides.still++;
        return;
      }
    }
    const holding = viewHolding(points, stand, holdOf(e.colStep, true), heading, l.farthest);
    if (!holding) return;
    const to = limitView({ mode: 'play', centre: holding.centre, hexesAcross: holding.hexesAcross }, e);
    const at = playCentre();
    const width = view.hexesAcross * e.colStep;
    // As near as the board lets the view come to them is where it already is, or is going: nothing changes.
    if (!out && Math.hypot(to.centre[0] - centre[0], to.centre[1] - centre[1]) <= 0.002 * width && Math.abs(Math.log(to.hexesAcross / zoomGoal)) <= 1e-4) {
      glides.still++;
      return;
    }
    // The view's own speed goes into the glide (a thrown drag still gliding; a glide to somewhere else): nothing snaps.
    const vel = glideEntry(at, glide && !glide.arrived ? glide.vel : panVel, to.centre, width);
    if (glide) glides.taken++;
    glide = { goal: [to.centre[0], to.centre[1]], across: to.hexesAcross, vel, hexes: ids, arrived: false, age: 0 };
    glides.begun++;
    panVel = [0, 0];
    zoomAnchor = null;
    zoomGoal = to.hexesAcross;
    if (out) returnView = null;
    schedule();
    if (out) controlsChanged();
  }

  /** The whole table and back, eased like any other zoom. */
  function toggleOverview(): void {
    if (!layout || free) return;
    // The overview key is the player's: a glide ends where it is.
    endGlide(false);
    const l = limits();
    const whole = Math.max(l.farthest, l.overview);
    zoomAnchor = null;
    panVel = [0, 0];
    if (zoomGoal >= whole * 0.999) {
      const back = returnView ?? playView ?? limitView({}, env());
      runBase = [back.centre[0], back.centre[1]];
      zoomGoal = Math.max(l.closest, Math.min(l.farthest, back.hexesAcross));
      returnView = null;
    } else {
      returnView = view.mode === 'play' ? view : { mode: 'play', centre: [runBase[0], runBase[1]], hexesAcross: l.farthest };
      zoomGoal = whole;
    }
    schedule();
    controlsChanged();
  }

  /** The next camera; the view turns to it about what it is looking at. */
  function cycleCamera(): void {
    chooseCamera((cameraIndex + 1) % CAMERAS.length);
  }

  /**
   * Turn to one of the cameras. Asking for a camera is asking for a tilted table: in Flat, which has
   * none, the tier becomes Tabletop by the player's choice first (ruling 37), so the key never does
   * nothing. A short note says which view it is.
   */
  function chooseCamera(index: number): void {
    if (index < 0 || index >= CAMERAS.length) return;
    // The camera key is the player's: a glide of the view ends where it is, and the turn is about what the view then looks at.
    endGlide(true);
    if (!TIERS[tier.name].tilt) setTier('tabletop', 'player', true);
    cameraIndex = index;
    cameraTurn = { fromTilt: camTilt, fromAzimuth: camAzimuth, done: 0 };
    say(`View ${index + 1} of ${CAMERAS.length}: ${(CAMERAS[index] as { name: string }).name}`);
    schedule();
  }

  /** A short note in the corner of the page that fades by itself. */
  let note: HTMLDivElement | null = null;
  let noteTimer = 0;
  function say(text: string): void {
    if (!note) {
      note = document.createElement('div');
      note.style.cssText = 'position:fixed;left:50%;bottom:118px;transform:translateX(-50%);z-index:40;pointer-events:none;font:600 14px/1.3 system-ui,sans-serif;padding:6px 12px;border-radius:6px;background:CanvasText;color:Canvas;opacity:0;transition:opacity 0.25s ease';
      root.appendChild(note);
    }
    note.textContent = text;
    note.style.opacity = '0.9';
    window.clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => {
      if (note) note.style.opacity = '0';
    }, 1400);
  }

  // ---- size, tier ------------------------------------------------------------------------------
  const resize = (): void => {
    css = [Math.max(1, window.innerWidth), Math.max(1, window.innerHeight)];
    pixelRatio = pixelRatioOf(tier.name, window.devicePixelRatio || 1, css);
    if (host) host.resize(css[0], css[1], pixelRatio);
    else {
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(css[0], css[1], false);
    }
    device = bufferSize(css, pixelRatio);
    if (canvas.width !== device[0] || canvas.height !== device[1]) device = [canvas.width, canvas.height];
    if (layout) applyView(view.mode === 'overview' ? { mode: 'overview' } : view);
  };

  const gpu = new StepDown(GPU_BUDGET_MS);
  const interval = new StepDown(INTERVAL_BUDGET_MS, 24, 12);
  const setTier = (name: TierName, by: 'auto' | 'player', record: boolean): void => {
    const from = tier.name;
    tier.chosenBy = by;
    if (name !== from) {
      tier.name = name;
      if (record) tier.changes.push({ atMs: performance.now(), from, to: name });
      resize();
      effects?.setMode({ flat: !TIERS[name].lit });
    }
    gpu.reset();
    interval.reset();
    remember();
    controlsChanged();
  };
  const stepDown = (): void => {
    if (tier.chosenBy !== 'auto') return;
    const below = tierBelow(tier.name);
    // The page steps down by itself as far as Tabletop and no further (ruling 37): Flat is another
    // game to look at, top-down and unlit with no cameras, and is the player's to choose.
    if (!below || !TIERS[below].tilt) return;
    setTier(below, 'auto', true);
    schedule();
  };

  // ---- measuring a frame's cost, for the step-down ----------------------------------------------
  let queries: WebGLQuery[] = [];
  let untimed = 0;
  let collectTimer = 0;
  const collect = (): void => {
    collectTimer = 0;
    if (!timerExt || lost) {
      queries = [];
      return;
    }
    const keep: WebGLQuery[] = [];
    for (const q of queries) {
      if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
        const disjoint = gl.getParameter(timerExt.GPU_DISJOINT_EXT) as boolean;
        const ms = (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6;
        gl.deleteQuery(q);
        if (!disjoint && gpu.feed(ms)) stepDown();
      } else keep.push(q);
    }
    queries = keep;
    if (queries.length > 0 && collectTimer === 0) collectTimer = window.setTimeout(collect, 40);
  };

  // ---- drawing: only when something changed (ruling 12) ------------------------------------------
  const continuous = settings.bench || faults.has('idle');
  /** `ambient`: the frame is drawn only because a lasting effect is alive (smoke drifting); it is counted apart, so that `frames` stands still at rest. */
  const draw = (measured: boolean, ambient = false): void => {
    if (lost || !world || !host || !store) return;
    const pose = poseNow();
    const m = matricesOf(pose);
    camera.projectionMatrix.fromArray(m.proj);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.matrixWorldInverse.fromArray(m.view);
    camera.matrixWorld.copy(camera.matrixWorldInverse).invert();
    store.touch();
    const spec = TIERS[tier.name];
    props?.setLit(spec.lit);
    world.apply({
      device,
      grade: look.grade || faults.has('warm'),
      vignette: look.vignette,
      lamp: look.lamp,
      lit: spec.lit,
      detail: spec.surfaceDetail,
      overlay: { strength: overlay.strength, lines: overlay.lines, labels: overlay.labels, sight: overlay.sight, tints: Object.values(overlay.tints).some(v => v.length > 0) },
      stressLoops: settings.stressMs > 0 ? Math.min(4000, (STRESS_TURNS * settings.stressMs) / ((device[0] * device[1]) / 1e6)) : 0,
    });
    const auto = measured && tier.chosenBy === 'auto';
    let q: WebGLQuery | null = null;
    if (auto && timerExt) {
      collect();
      q = gl.createQuery();
      if (q) gl.beginQuery(timerExt.TIME_ELAPSED_EXT, q);
    }
    // No timer query (Firefox, WebKit): now and then a frame is timed until the GPU has finished it.
    const timed = auto && !timerExt && hook.ready && ++untimed >= FINISH_EVERY;
    const t0 = timed ? performance.now() : 0;
    pieces?.sync();
    marks?.sync();
    effects?.sync(camera, spec.lit);
    renderer.render(host.scene, camera);
    // The dice inset: a second camera into the tray's felt well, in a corner of the frame, while a roll is shown.
    diceInset?.draw(renderer, host.scene);
    lastViewProj = m.viewProj;
    answers?.sync();
    if (timed) {
      untimed = 0;
      gl.finish();
      if (gpu.feed(performance.now() - t0)) window.setTimeout(stepDown, 0);
    }
    if (q && timerExt) {
      gl.endQuery(timerExt.TIME_ELAPSED_EXT);
      queries.push(q);
      if (collectTimer === 0) collectTimer = window.setTimeout(collect, 40);
    }
    if (ambient && effects) effects.countAmbient();
    else hook.frames++;
    hook.drawCalls = renderer.info.render.calls;
    hook.triangles = renderer.info.render.triangles;
    lastViewProj = m.viewProj;
    lastPose = pose;
    hook.timings.level0Ms = store.level0Ms;
    hook.timings.lastTileMs = store.lastTileMs;
    if (store.level0Ready) {
      const now = performance.now();
      if (!hook.ready) {
        hook.firstFrameMs = now;
        hook.ready = true;
      }
      if (restoring) {
        restoring = false;
        hook.context.lastRestoredMs = now;
      }
    }
    if (readout) {
      readout.textContent = `${hook.map.id}  ${tier.name} (${tier.chosenBy})  ${view.mode} ${view.hexesAcross.toFixed(1)} hexes  level ${store.currentLevel()}  tiles ${store.residentKeys().length}${store.pending() > 0 ? ` (+${store.pending()})` : ''}${pieces ? `  |  ${pieces.readout()}` : ''}`;
    }
  };

  /** One pass of the page's own loop: held keys move the view, then a frame is drawn. */
  const frame = (ts: number): void => {
    frameRequested = false;
    // The pieces join the page's loop: it runs while a counter travels or a body is awake, and stops with them.
    const lively = pieces ? pieces.step(ts, glide !== null) : false;
    const marking = marks ? marks.step() : false; // hulks and craters: one easing in or out, a crater due
    // The effects join it too: a short one (a shot, a blast) keeps the loop running as a moving counter does; a lasting
    // one (smoke drifting, a wreck burning) does not count as movement, and is drawn at its own slower pace.
    const fx = effects ? effects.step(ts) : 0;
    const moving = stepMotion(ts) || lively || fx === 2 || marking;
    if (!moving && !continuous && fx === 1 && effects) {
      if (ts - lastAmbient >= effects.ambientMs - 2) {
        lastAmbient = ts;
        draw(true, true);
      }
      // These frames come further apart by design: they say nothing of what a frame costs.
      lastLoopDraw = 0;
      interval.reset();
      schedule();
      return;
    }
    // Without a timer query the cost of a frame is the time between frames drawn back to back.
    const now = performance.now();
    // A frame with a short effect alive (a blast, a shot) is not what the table costs to draw: left out of the
    // measure, so that a tier the page chose itself does not step down in the middle of an explosion.
    const typical = fx !== 2;
    if (!typical) interval.reset();
    else if (!timerExt && tier.chosenBy === 'auto' && hook.ready) {
      if (lastLoopDraw > 0 && now - lastLoopDraw < 100) {
        if (interval.feed(now - lastLoopDraw)) stepDown();
      } else interval.reset();
    }
    lastLoopDraw = now;
    // With bench=1 a frame is drawn every animation frame, but never two at once on the GPU: where the
    // browser hands out animation frames faster than the GPU draws (its frame-rate limit switched off for
    // timing), the loop waits for its last frame to be finished. And a check that times frames draws them
    // itself with drawOnce(): for two seconds after one of those the loop leaves the GPU to the check,
    // so that neither times the other's work.
    let busy = false;
    if (continuous) {
      if (now - drawnOnce < 2000) busy = true;
      else if (fence) {
        if (lost || gl.getSyncParameter(fence, gl.SYNC_STATUS) === gl.SIGNALED) {
          gl.deleteSync(fence);
          fence = null;
        } else busy = true;
      }
    }
    if (!busy) {
      draw(typical);
      if (continuous && !lost) fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    }
    if (continuous || moving) schedule();
  };
  function schedule(): void {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(frame);
  }
  /** Draw now, outside the loop and unmeasured: for the hook's calls, so that its readings are of the frame on screen. */
  function drawNow(): void {
    draw(false);
  }

  // ---- input -----------------------------------------------------------------------------------
  const ndcAt = (e: { clientX: number; clientY: number }): [number, number] => ndcOf(e.clientX, e.clientY, css);
  const boardUnder = (ndc: readonly [number, number]): [number, number] | null => planePoint(invert(viewProjNow()), ndc[0], ndc[1], 0);

  /** Ask for a zoom by a factor about a place in the frame. The view eases to it; past the farthest play view it runs on to the overview. */
  const zoomAbout = (factor: number, ndc: readonly [number, number]): void => {
    if (!layout || free) return;
    // The wheel is the player's: it goes on from the view as it is, not from where a glide was taking it.
    endGlide(false);
    const l = limits();
    zoomGoal = Math.max(l.closest, Math.min(Math.max(l.farthest, l.overview), zoomGoal * factor));
    const anchor = boardUnder(ndc);
    zoomAnchor = anchor ? { point: anchor, ndc: [ndc[0], ndc[1]] } : null;
    returnView = null;
    panVel = [0, 0];
  };

  /**
   * One step of everything that moves the camera: the change of camera, held keys, the glide of a
   * drag let go, and the zoom easing to its goal. Says whether anything is still moving.
   */
  function stepMotion(ts: number): boolean {
    if (!layout || free) {
      lastTick = 0;
      return false;
    }
    const dt = lastTick > 0 ? Math.min(0.05, (ts - lastTick) / 1000) : 1 / 60;
    let moving = false;
    const toward = (tau: number): number => 1 - Math.exp(-dt / tau);

    // The camera turning to the one chosen: a set time, gentle at both ends.
    if (cameraTurn) {
      const cam = CAMERAS[cameraIndex] as { tiltDeg: number; azimuthDeg: number };
      // Counted in steps of the loop, not by the clock: a frame that comes late does not skip part of the turn.
      cameraTurn.done = Math.min(1, cameraTurn.done + (dt * 1000) / CAMERA_TURN_MS);
      const p = cameraTurn.done;
      const e = p * p * p * (p * (p * 6 - 15) + 10);
      // The zoom keeps its place between the limits while they move with the tilt.
      const before = limits();
      const share = (a: number): number => (a > before.farthest && before.overview > before.farthest ? (a - before.farthest) / (before.overview - before.farthest) : -1);
      const viewShare = share(view.hexesAcross);
      const goalShare = share(zoomGoal);
      camTilt = cameraTurn.fromTilt + (cam.tiltDeg - cameraTurn.fromTilt) * e;
      camAzimuth = cameraTurn.fromAzimuth + (cam.azimuthDeg - cameraTurn.fromAzimuth) * e;
      if (p >= 1) cameraTurn = null;
      const after = limits();
      const kept = (f: number, a: number): number => (f >= 0 && after.overview > after.farthest ? after.farthest + f * (after.overview - after.farthest) : Math.max(after.closest, Math.min(after.farthest, a)));
      zoomGoal = kept(goalShare, zoomGoal);
      // A glide asked for in the middle of the turn was judged by the camera turned to: its zoom is kept for that camera's limits.
      if (glide) zoomGoal = Math.max(after.closest, Math.min(after.farthest, glide.across));
      place(kept(viewShare, view.hexesAcross), null);
      moving = true;
    }

    // Held keys: the zoom keys move the goal; the arrows push the view's speed.
    const has = (names: readonly string[]): boolean => names.some(key => held.has(key));
    const l = limits();
    const z = (has(keys.zoomOut) ? 1 : 0) - (has(keys.zoomIn) ? 1 : 0);
    const dx = (has(keys.right) ? 1 : 0) - (has(keys.left) ? 1 : 0);
    const dy = (has(keys.down) ? 1 : 0) - (has(keys.up) ? 1 : 0);
    // A key that zooms or slides the view is the player's: a glide ends at once, and the key goes on from the view as it is.
    if (z !== 0 || dx !== 0 || dy !== 0) endGlide(true);
    if (z !== 0) {
      zoomGoal = Math.max(l.closest, Math.min(Math.max(l.farthest, l.overview), zoomGoal * Math.pow(KEY_ZOOM_RATE, z * dt)));
      zoomAnchor = null;
      moving = true;
    }
    const width = view.hexesAcross * hex.COL_STEP;
    if (dx !== 0 || dy !== 0) {
      // Screen right and screen down, on the board, for the camera as it stands.
      const a = (azimuthNow() * Math.PI) / 180;
      const speed = width * KEY_PAN_RATE;
      const want: [number, number] = [(Math.cos(a) * dx + Math.sin(a) * dy) * speed, (-Math.sin(a) * dx + Math.cos(a) * dy) * speed];
      const k = toward(KEY_PUSH_TAU);
      panVel = [panVel[0] + (want[0] - panVel[0]) * k, panVel[1] + (want[1] - panVel[1]) * k];
    } else if (!drag) {
      const keep = glideTau > 0 ? Math.exp(-dt / glideTau) : 0;
      panVel = [panVel[0] * keep, panVel[1] * keep];
    }

    // The view carried on by its speed; a side of the board stops it on that axis.
    if (!drag && Math.hypot(panVel[0], panVel[1]) > width * STILL_SHARE) {
      const asked: [number, number] = [view.centre[0] + panVel[0] * dt, view.centre[1] + panVel[1] * dt];
      place(view.hexesAcross, asked);
      if (Math.abs(view.centre[0] - asked[0]) > 1e-9) panVel[0] = 0;
      if (Math.abs(view.centre[1] - asked[1]) > 1e-9) panVel[1] = 0;
      zoomAnchor = null;
      moving = true;
    } else if (!drag && dx === 0 && dy === 0) panVel = [0, 0];

    // The view gliding to a set of hexes (`goTo`): its centre drawn to the goal, critically damped. In the run-out to the
    // whole table it is the centre the view comes back in to that is drawn there, and the zoom's own ease brings the view in.
    if (glide && !glide.arrived) {
      const s = glideStep(playCentre(), glide.vel, glide.goal, dt, width);
      glide.vel = s.vel;
      glide.age += dt;
      let next = s.at;
      if (glideArrived(s.at, s.vel, glide.goal, width) || glide.age >= GO_TO_MAX_S) {
        next = [glide.goal[0], glide.goal[1]];
        glide.vel = [0, 0];
        glide.arrived = true;
      }
      if (view.mode === 'play') place(view.hexesAcross, next);
      else {
        runBase = [next[0], next[1]];
        place(view.hexesAcross, null);
      }
      // A side of the board stops it on that axis (the goal itself lies inside what the zoom it runs to allows).
      const got = playCentre();
      if (Math.abs(got[0] - next[0]) > 1e-9) glide.vel[0] = 0;
      if (Math.abs(got[1] - next[1]) > 1e-9) glide.vel[1] = 0;
      moving = true;
    }

    // The zoom easing to its goal, about the pointer where play's range allows.
    const gap = Math.log(zoomGoal / view.hexesAcross);
    if (Math.abs(gap) <= 1e-4) zoomRate = 0;
    else {
      // The rate the ease asks for, held under the top rate, and gathered rather than taken at once.
      const asked = Math.max(-ZOOM_TOP_RATE, Math.min(ZOOM_TOP_RATE, gap / ZOOM_TAU));
      const gather = (ZOOM_TOP_RATE / ZOOM_GATHER_S) * dt;
      zoomRate = Math.abs(asked) <= Math.abs(zoomRate) && asked * zoomRate > 0 ? asked : zoomRate + Math.max(-gather, Math.min(gather, asked - zoomRate));
      const step = zoomRate * ZOOM_TAU * toward(ZOOM_TAU);
      const across = Math.abs(gap) < 2e-3 || Math.abs(step) >= Math.abs(gap) ? zoomGoal : view.hexesAcross * Math.exp(step);
      place(across, zoomAnchor ? centreFor(zoomAnchor.point, zoomAnchor.ndc, across) : null);
      // A limit the goal lies beyond (the window changed): take what the view could reach.
      if (Math.abs(view.hexesAcross - across) > 1e-6) zoomGoal = view.hexesAcross;
      moving = true;
    }

    // A glide is over when its centre has arrived and the zoom it asked for has too.
    if (glide && glide.arrived && Math.abs(Math.log(zoomGoal / view.hexesAcross)) <= 1e-4) {
      glide = null;
      glides.arrived++;
    }
    if (pointer && moving) hook.hover = hook.pick(pointer[0], pointer[1]);
    lastTick = moving || held.size > 0 ? ts : 0;
    return moving || held.size > 0;
  }

  const known = new Set<string>([...keys.left, ...keys.right, ...keys.up, ...keys.down, ...keys.zoomIn, ...keys.zoomOut]);
  const keyOf = (e: KeyboardEvent): string => (e.key.length === 1 ? e.key.toLowerCase() : e.key);
  window.addEventListener('keydown', e => {
    // A key the page laid over the table has already used (a game hears its keys first) is not the table's too.
    if (e.defaultPrevented) return;
    // The pieces' keys first (Space, B, R, Escape), whether or not Alt is held for a physical gesture.
    if (pieces && pieces.key(e)) {
      e.preventDefault();
      schedule();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = keyOf(e);
    // The camera key, however the keyboard names it: by its place (left of 1; on some keyboards that
    // place is reported as the key beside the left Shift) or by the character it types.
    if (e.code === 'Backquote' || e.code === 'IntlBackslash' || CAMERA_CHARS.includes(e.key)) {
      if (!e.repeat) cycleCamera();
      e.preventDefault();
      return;
    }
    // And each camera by its number, on the table by itself: with its controls taken, the digits are the page's.
    if (!taken && k.length === 1 && k >= '1' && k <= String(CAMERAS.length) && !e.shiftKey) {
      if (!e.repeat) chooseCamera(Number(k) - 1);
      e.preventDefault();
      return;
    }
    if (keys.overview.includes(k)) {
      if (!e.repeat) toggleOverview();
      e.preventDefault();
      return;
    }
    if (!known.has(k)) return;
    e.preventDefault();
    held.add(k);
    schedule();
  });
  window.addEventListener('keyup', e => {
    held.delete(keyOf(e));
  });
  window.addEventListener('blur', () => held.clear());

  // No menu over the table: on a Mac, Ctrl with the main button is the secondary click and would raise the browser's
  // own. That click is a click here like any other; a true secondary click does nothing.
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    // The main button; and the secondary one when it is Ctrl with the main button on a Mac, which some browsers report so.
    const main = e.button === 0 || (e.button === 2 && e.ctrlKey && ON_MAC);
    if (!main || !layout || free) return;
    canvas.setPointerCapture(e.pointerId);
    // With Alt held the press is a physical gesture on the counters, and the view does not pan.
    if (pieces && pieces.pointerDown(e)) return;
    // With Ctrl or Cmd held the press is a click and nothing else (a game adds to what is chosen with it; the counters
    // report it as they report any click): it takes no hold of the board, and stops nothing the view is doing.
    if (e.ctrlKey || e.metaKey) return;
    const anchor = boardUnder(ndcAt(e));
    drag = anchor ? { anchor } : null;
    // Taking hold stops whatever the view was doing.
    endGlide(false);
    panVel = [0, 0];
    zoomGoal = view.hexesAcross;
    zoomRate = 0;
    if (drag) returnView = null;
    dragTrail = [{ t: performance.now(), c: [view.centre[0], view.centre[1]] }];
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', e => {
    pointer = [e.clientX, e.clientY];
    pieces?.pointerMove(e);
    if (drag && layout) {
      // A drag is direct: the board point taken hold of stays under the pointer.
      const centre = centreFor(drag.anchor, ndcAt(e), view.hexesAcross);
      if (centre) {
        place(view.hexesAcross, centre);
        dragTrail.push({ t: performance.now(), c: [view.centre[0], view.centre[1]] });
        if (dragTrail.length > 8) dragTrail.shift();
        schedule();
      }
    }
    hook.hover = hook.pick(e.clientX, e.clientY);
  });
  const endDrag = (): void => {
    if (drag && dragTrail.length > 1) {
      // Let go at speed and the view glides on a little, firmly damped; let go slowly, or after a
      // pause, and it stays exactly where it was put.
      const now = performance.now();
      const last = dragTrail[dragTrail.length - 1] as { t: number; c: [number, number] };
      const first = dragTrail.find(p => now - p.t <= GLIDE_WINDOW_MS) ?? last;
      const span = (last.t - first.t) / 1000;
      if (now - last.t <= GLIDE_FRESH_MS && span > 0.008) {
        const v: [number, number] = [(last.c[0] - first.c[0]) / span, (last.c[1] - first.c[1]) / span];
        const width = view.hexesAcross * hex.COL_STEP;
        const t = Math.max(0, Math.min(1, (Math.hypot(v[0], v[1]) / width - GLIDE_FROM_SHARE) / (GLIDE_FULL_SHARE - GLIDE_FROM_SHARE)));
        const carry = GLIDE_CARRY * t * t * (3 - 2 * t);
        if (carry > 0 && glideTau > 0) {
          panVel = [v[0] * carry, v[1] * carry];
          schedule();
        }
      }
    }
    dragTrail = [];
    drag = null;
    canvas.style.cursor = restCursor();
  };
  const endPress = (e: PointerEvent): void => {
    // A press let go without having moved is a click on the counters; a physical gesture ends here too.
    pieces?.pointerUp(e);
    endDrag();
  };
  canvas.addEventListener('pointerup', endPress);
  canvas.addEventListener('pointercancel', endPress);
  canvas.addEventListener('pointerleave', () => {
    if (!drag) {
      pointer = null;
      hook.hover = -1;
      pieces?.pointerLeave();
    }
  });
  canvas.addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      if (!layout) return;
      zoomAbout(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), ndcAt(e));
      schedule();
    },
    { passive: false },
  );
  window.addEventListener('resize', () => {
    resize();
    schedule();
  });

  // ---- a lost context (ruling 13) --------------------------------------------------------------
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    lost = true;
    restoring = false;
    hook.context.losses++;
    queries = [];
    fence = null;
    store?.contextLost();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false;
    hook.context.restores++;
    try {
      timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2') as typeof timerExt;
      // The old surfaces went with the old context; there is nothing of them left to release.
      surfaces = bakeSurfaces(renderer);
      if (world) {
        world.setSurfaces(surfaces);
        for (const t of world.dataTextures()) t.needsUpdate = true;
      }
      room?.restore();
      pieces?.restore();
      marks?.restore();
      effects?.restore();
      restoring = true;
      if (store) {
        store.contextRestored().then(() => {
          updateNeeds();
          schedule();
        }, fail);
      }
    } catch (err) {
      fail(err);
    }
  });

  // ---- the hook's calls ------------------------------------------------------------------------
  hook.drawOnce = () => {
    drawnOnce = performance.now();
    drawNow();
  };
  hook.setView = v => {
    free = null;
    applyView(v.mode === 'overview' ? { mode: 'overview' } : { centre: v.centre ?? view.centre, hexesAcross: v.hexesAcross ?? (view.mode === 'play' ? view.hexesAcross : (playView ?? view).hexesAcross) });
    drawNow();
    return hook.view;
  };
  hook.goTo = hexes => goTo(hexes);
  hook.setCamera = c => {
    // A camera for checks stops a glide of the view where it is.
    if (c) endGlide(false);
    free = c ? { azimuthDeg: c.azimuthDeg, elevationDeg: c.elevationDeg, distance: c.distance, target: c.target } : null;
    updateNeeds();
    drawNow();
  };
  hook.corners = () => {
    if (!layout) return ['none', 'none', 'none', 'none'];
    const l = layout;
    const inv = invert(viewProjNow());
    const pts: [number, number][] = [[0.5, 0.5], [device[0] - 0.5, 0.5], [device[0] - 0.5, device[1] - 0.5], [0.5, device[1] - 0.5]];
    return pts.map(([x, y]) => {
      const [nx, ny] = ndcOf(x, y, device);
      return hitAt(inv, nx, ny, l);
    });
  };
  hook.pick = (x, y) => {
    if (!grid) return -1;
    const g = grid;
    return pickHex(viewProjNow(), x, y, css, (wx, wy) => hex.worldToHex(g, wx, wy));
  };
  hook.setOverlay = o => {
    if (typeof o.strength === 'number' && Number.isFinite(o.strength)) overlay.strength = Math.min(1, Math.max(0, o.strength));
    if (typeof o.lines === 'boolean') overlay.lines = o.lines;
    if (typeof o.labels === 'boolean') overlay.labels = o.labels;
    if (typeof o.sight === 'boolean') overlay.sight = o.sight;
    if (o.tints) {
      overlay.tints = Object.fromEntries(Object.entries(o.tints).map(([k, v]) => [k, [...v]]));
      world?.setTints(overlay.tints);
    }
    drawNow();
    controlsChanged();
  };
  /** What the page publishes of the layout. */
  const publishLayout = (lay: BoardLayout): void => {
    hook.slabs = lay.slabs.map(rect => ({ rect: [...rect] as RectTuple, cornerRadius: lay.cornerRadius, thickness: lay.thickness, rimWidth: lay.rimWidth }));
    hook.sheets = lay.sheets.map(rect => ({ rect: [...rect] as RectTuple, cornerRadius: lay.sheetCornerRadius }));
    hook.seams = [...lay.seams];
    hook.border = lay.border;
    hook.gap = lay.gap;
    hook.grooveWidth = lay.grooveWidth;
    hook.margin = lay.margin;
    hook.table = { rect: [...lay.table.rect] as RectTuple, z: lay.table.z };
  };
  hook.setLook = l => {
    if (typeof l.grade === 'boolean') look.grade = l.grade;
    if (typeof l.vignette === 'boolean') look.vignette = l.vignette;
    if (typeof l.lamp === 'number' && Number.isFinite(l.lamp) && l.lamp >= 0 && l.lamp <= 4) look.lamp = l.lamp;
    // Checks only: the mounted boards' dials, and the former construction.
    const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
    const next: MountDials = { ...mount };
    if (l.construction === 'old' || l.construction === 'mounted') next.construction = l.construction;
    if (num(l.border)) next.border = l.border;
    if (num(l.gap)) next.gap = l.gap;
    if (num(l.cornerRadius)) next.cornerRadius = l.cornerRadius;
    const kept = clampMount(next);
    const moved = kept.construction !== mount.construction || kept.border !== mount.border || kept.gap !== mount.gap || kept.cornerRadius !== mount.cornerRadius;
    mount = kept;
    if (Array.isArray(l.brown) && l.brown.length === 3 && l.brown.every(v => num(v) && v <= 255)) LOOK.wrapBrown = [l.brown[0], l.brown[1], l.brown[2]];
    if (num(l.folds)) LOOK.wrapFolds = dial(l.folds);
    if (num(l.wrapWear)) LOOK.wrapWear = dial(l.wrapWear);
    world?.applyWrap();
    if (moved && layout && grid && world) {
      const lay = layBoards(layout.board, grid);
      layout = lay;
      world.relayout(lay);
      publishLayout(lay);
      limitsKey = '';
      applyView(view.mode === 'overview' ? { mode: 'overview' } : view);
    }
    drawNow();
  };
  hook.setTier = t => {
    if (t === null) setTier(tier.name, 'auto', false);
    else if (isTierName(t)) setTier(t, 'player', true);
    drawNow();
  };

  // ---- start: the worker builds the list while the page makes its surfaces ------------------------
  const start = async (): Promise<void> => {
    if (WORKER_TILE !== TILE || WORKER_LEVEL0_MAX !== LEVEL0_MAX_PIXELS || WORKER_LEVEL_PX.some((v, k) => v !== LEVEL_PX[k])) {
      throw new Error('levels.ts and the bake worker disagree about tile sizes');
    }
    const client = new BakeClient();
    // The table draws the green sides of tree sides itself, over its grid (ruling 34): the art is baked
    // without them. The hill lines are still printed in the art; the table keeps its grid's line off them.
    const building = mapText !== null ? client.buildText(mapText, { sightLines: false }) : client.buildMap(settings.map, { sightLines: false });
    resize();
    surfaces = bakeSurfaces(renderer);
    overlayInk = keyInk();
    const built = await building;
    overlayInk = built.sheet.key;
    hook.builds++;
    hook.timings.buildMs = built.buildMs;

    // The board's size, read back from its rectangle through the hex module.
    const cols = Math.round((built.bounds[2] - hex.R) / hex.COL_STEP) + 1;
    const rows = Math.round(built.bounds[3] - (cols > 1 ? 0.5 : 0) + 0.5);
    const g: hex.Grid = { cols, rows };
    const bounds = hex.worldBounds(g);
    if (bounds.some((v, k) => Math.abs(v - (built.bounds[k] as number)) > 1e-9)) throw new Error('the map is not a rectangle of hexes');
    grid = g;
    geometry = gridGeometry(hex);
    const lay = layBoards(bounds, g);
    layout = lay;
    const idLine = mapText !== null ? /^id:\s*"?([A-Za-z0-9_-]+)"?\s*$/m.exec(mapText) : null;
    hook.map = { id: idLine ? (idLine[1] as string) : settings.map, cols, rows, bounds: [...bounds] as RectTuple, hash: null };
    publishLayout(lay);

    // The hex module's labels, a digit a byte, for the board's shader.
    if (built.sightLines.length > SIGHT_LINE_KINDS) throw new Error(`the board has ${built.sightLines.length} kinds of line that bar sight; the table draws ${SIGHT_LINE_KINDS}`);
    const sides = sideData(g, geometry.steps, built.sightLines.map(k => k.sides));
    sightSides = built.sightLines.reduce((n, k) => n + k.sides.length, 0);
    const hexDigits = new Uint8Array(cols * rows * 4);
    for (let id = 0; id < cols * rows; id++) {
      const text = hex.labelOf(g, id);
      if (text.length !== 4) throw new Error(`hex label ${text} is not four digits`);
      for (let k = 0; k < 4; k++) hexDigits[id * 4 + k] = text.charCodeAt(k) - 48;
    }
    const rulerWidth = Math.max(cols, rows);
    const rulerDigits = new Uint8Array(rulerWidth * 2 * 4);
    for (let c = 0; c < cols; c++) {
      const text = hex.labelOf(g, hex.indexOf(g, c, 0));
      rulerDigits[c * 4] = text.charCodeAt(0) - 48;
      rulerDigits[c * 4 + 1] = text.charCodeAt(1) - 48;
    }
    for (let r = 0; r < rows; r++) {
      const text = hex.labelOf(g, hex.indexOf(g, 0, r));
      rulerDigits[(rulerWidth + r) * 4] = text.charCodeAt(2) - 48;
      rulerDigits[(rulerWidth + r) * 4 + 1] = text.charCodeAt(3) - 48;
    }
    const w = new World(
      { layout: lay, grid: geometry, cols, rows, lastColumnY: hex.centreAt(cols - 1, 0)[1], hexDigits, rulerDigits, rulerWidth, keyInk: overlayInk, overlayInk, stock: built.sheet.margin, hexSides: sides.bits, sideDirs: sides.dirs, sightInks: built.sightLines.map(k => k.ink), sightWidths: built.sightLines.map(k => k.width), sightModes: built.sightLines.map(k => (k.kind === 'tree' ? 'cover' : 'art')), faults, maxAnisotropy },
      surfaces,
    );
    world = w;
    // The scanned wood, when the page hands it over: until then, and without it, the wood the table draws itself.
    joins?.wood?.then(art => {
      if (art && world === w) {
        w.setWood(woodTextures(art, maxAnisotropy));
        schedule();
      }
    }, () => undefined);
    // The room round the table, when the address names one and the page hands it over: until then, and without it, the old sky.
    if (settings.env && joins?.room) {
      joins.room(settings.env).then(art => {
        if (art && world === w) {
          room = mountRoom(renderer, w.shared, art);
          hook.room = { name: room.name, ms: room.ms };
          schedule();
        }
      }, () => undefined);
    }
    // Things on the table (scene/props): from the game's seed, off the boards and clear of the tray; drawn in the lit tiers.
    if (settings.props) props = mountProps({ root: w.root, shared: w.shared, seed: settings.seed, ground: propsGround(lay, settings.tray), tableZ: lay.table.z, key: keyDirection() });
    if (props) hook.props = props.placed;
    const fxTune = tuneWith(settings.fx.dials);
    settings.ignored.push(...fxTune.ignored);
    /** The hex so many columns to the right of one; itself where the board ends first. */
    const across = (id: number, columns: number): number => {
      const col = hex.colOf(g, id) + columns;
      return col >= 0 && col < g.cols ? hex.indexOf(g, col, hex.rowOf(g, id)) : id;
    };
    if (settings.fx.on) {
      // The effects: fire, blast and smoke over the board, in its frame and by its light. What a game asks of the
      // counters sets them off (the pieces are handed `watch`); the scene knows nothing of games.
      const lessMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
      const fx = mountEffects({
        shared: w.shared,
        renderer,
        hexes: {
          count: hex.hexCount(g),
          centre: id => hex.centreOf(g, id),
          across,
        },
        tune: fxTune.tune,
        fast: settings.fx.fast,
        reduced: lessMotion.matches,
        flat: !TIERS[tier.name].lit,
        art: joins?.fx,
        onEffect: joins?.onEffect,
        wake: schedule,
      });
      lessMotion.addEventListener('change', () => fx.setMode({ reduced: lessMotion.matches }));
      w.root.add(fx.object);
      hook.fx = fx.hook;
      effects = fx;
    }
    if (settings.pieces) {
      // The counters: mounted beside the board, drawn in its frame and by its light. A game's tints go
      // through the board's own overlay (the port's kinds, by the overlay's names).
      const tintName = { reach: 'reach', 'reach-near': 'reachNear', target: 'fire', path: 'path', objective: 'objective', zone: 'zone' } as const;
      /** The nearer part of the reach as a game last gave it (the port's `reachNear`): shown on those of its hexes that the reach holds. */
      let nearAsked: number[] = [];
      const p = mountPieces({
        hex,
        grid: g,
        layout: () => layout as BoardLayout,
        shared: w.shared,
        maxAnisotropy,
        camera: () => ({ viewProj: viewProjNow(), css }),
        tint: (kind, hexes) => {
          const next: Record<string, number[]> = { ...overlay.tints };
          if (kind === 'reach-near') nearAsked = [...hexes];
          else next[tintName[kind]] = [...hexes];
          // The nearer part of a reach is a part of it: a shade laid over hexes the reach tints, and nowhere else.
          // Clearing the reach clears it too.
          if (kind === 'reach' && hexes.length === 0) nearAsked = [];
          if (kind === 'reach' || kind === 'reach-near') {
            const reach = new Set(next.reach ?? []);
            next.reachNear = nearAsked.filter(h => reach.has(h));
          }
          overlay.tints = next;
          w.setTints(overlay.tints);
        },
        wake: schedule,
        strip: settings.bare ? null : root,
        canvas,
        art: joins?.unitArt,
        tray: settings.tray ? joins?.tray : undefined,
        watch: effects?.watch,
        // The port's `intent` and `answer` go to the table's marks, which are mounted just below (they need the counters).
        answers: { intent: i => answers?.port.intent(i), answer: a => answers?.port.answer(a) },
        restCursor,
        // The dice tumble unless the effects are off, the play-back is fast or the player asks for less motion; `dice=0` keeps the inset away.
        dice: { tumble: settings.fx.on && !settings.fx.fast && !window.matchMedia('(prefers-reduced-motion: reduce)').matches, inset: settings.dice },
      });
      diceInset = mountDiceInset({ root, dice: p.dice, shared: w.shared });
      const inset = diceInset;
      hook.diceInset = {
        get rect() {
          return { ...inset.rect };
        },
        get drawCalls() {
          return inset.drawCalls;
        },
        get skip() {
          return inset.skip;
        },
        set skip(v: boolean) {
          inset.skip = v;
        },
        on: settings.dice,
      };
      // The answers to what a player does: on with the counters, whether or not the effects are (`fx=0` leaves them).
      answers = mountAnswers({
        root,
        canvas,
        project: (x, y, z) => toScreen(lastViewProj, css, x, y, z),
        hexes: { count: hex.hexCount(g), centre: id => hex.centreOf(g, id) },
        stackTop: id => p.stackTop(id),
        counterSide: COUNTER.side,
        placeOf: id => p.placeOf(id),
        dials: fxTune.tune.mark,
        shots: effects ? effects.shots : null,
        cursor: (cursor, spoken) => {
          intentCursor = cursor;
          intentSpoken = spoken;
          // A hand on the board or on a counter keeps its own cursor; it is given this one when it lets go.
          if (!drag && canvas.style.cursor !== 'grabbing' && canvas.style.cursor !== 'pointer') canvas.style.cursor = restCursor();
        },
      });
      hook.answers = answers.hook;
      // The developer's strip that sets each effect and each answer off (`fxdemo=1`; never with a game).
      if (settings.fx.demo) {
        mountFxDemo({
          root,
          canvas,
          fx: effects ? effects.hook : null,
          port: () => p.port,
          ids: id => (p.hook.pieces ?? []).filter(c => c.hex === id && c.state !== 'gone').sort((a, b) => a.place - b.place).map(c => c.id),
          across,
          hover: () => hook.hover,
          say,
        });
      }
      w.root.add(p.object);
      Object.defineProperties(hook, Object.getOwnPropertyDescriptors(p.hook));
      pieces = p;
      // ---- hulks and craters: begin (./marks; the advanced options Show hulks and Show craters, `hulks=0`, `craters=0`) ----
      // With a game: what the battle leaves lies on the board under the counters. The marks listen to the counters' port.
      if (settings.game) {
        const m = mountMarks({
          shared: w.shared,
          maxAnisotropy,
          centreOf: id => hex.centreOf(g, id),
          options: { hulks: params.get('hulks') !== '0', craters: params.get('craters') !== '0' },
          art: joins?.marks,
          wake: schedule,
        });
        w.root.add(m.object);
        Object.defineProperty(hook, 'marks', { value: m.hook, enumerable: true });
        marks = m;
      }
      // ---- hulks and craters: end ----
      // Whoever started the page may want the counters' port: a game drives them through it. The
      // scene knows nothing of games (it imports none of that code); the page's entry joins the two.
      joins?.onPieces?.(marks ? marks.port(p.port) : p.port);
    }
    // And the table's own controls, for a page that shows them itself.
    joins?.onControls?.({
      list: () => [
        { id: 'camera', label: 'Camera', key: '~', on: null },
        { id: 'whole', label: 'Whole board', key: 'O', on: zoomGoal >= Math.max(limits().farthest, limits().overview) * 0.999 },
        { id: 'grid', label: 'Hex grid', key: '', on: overlay.lines },
        { id: 'numbers', label: 'Hex numbers', key: '', on: overlay.labels },
        { id: 'sight', label: 'Sight lines', key: '', on: overlay.sight },
        { id: 'detail', label: 'Finer detail', key: '', on: tier.name === 'tabletop+' },
      ],
      press: id => {
        if (id === 'camera') cycleCamera();
        else if (id === 'whole') toggleOverview();
        else if (id === 'grid') hook.setOverlay({ lines: !overlay.lines });
        else if (id === 'numbers') hook.setOverlay({ labels: !overlay.labels });
        else if (id === 'sight') hook.setOverlay({ sight: !overlay.sight });
        else if (id === 'detail') hook.setTier(tier.name === 'tabletop+' ? 'tabletop' : 'tabletop+');
      },
      onChange: fn => {
        controlListeners.add(fn);
        return () => {
          controlListeners.delete(fn);
        };
      },
      keys: tableKeyLines(true, CAMERAS.length, pieces !== null),
      tints: tintLegend(),
      frame: hexes => {
        if (!layout || free) return;
        const count = hex.hexCount(g);
        let x0 = Number.POSITIVE_INFINITY;
        let x1 = Number.NEGATIVE_INFINITY;
        let y0 = Number.POSITIVE_INFINITY;
        let y1 = Number.NEGATIVE_INFINITY;
        for (const h of hexes) {
          if (!Number.isInteger(h) || h < 0 || h >= count) continue;
          const c = hex.centreOf(g, h);
          x0 = Math.min(x0, c[0]);
          x1 = Math.max(x1, c[0]);
          y0 = Math.min(y0, c[1]);
          y1 = Math.max(y1, c[1]);
        }
        if (x0 > x1) return;
        // In column steps: the width wanted, and the height wanted turned into the width that shows it.
        const e = env();
        const wide = (x1 - x0) / e.colStep + FRAME_ROOM.sides;
        const tall = (((y1 - y0) / e.colStep) * FRAME_ROOM.endsShare + FRAME_ROOM.ends) * (e.css[0] / e.css[1]);
        const across = Math.max(wide, tall);
        applyView({ mode: 'play', centre: [(x0 + x1) / 2, (y0 + y1) / 2], hexesAcross: across });
        // The panel's plate and box of words lie over the top of the board, and less lies over the bottom: the
        // hexes are set a little below the middle of what the view, as it came out, shows.
        const shown = (view.hexesAcross * e.colStep * e.css[1]) / e.css[0];
        applyView({ mode: 'play', centre: [view.centre[0], view.centre[1] + FRAME_ROOM.lower * shown], hexesAcross: view.hexesAcross });
        schedule();
        controlsChanged();
      },
      goTo,
    });
    host = mountScene(canvas, renderer, camera, w.root, css[0], css[1], pixelRatio);
    resize();
    levelEnv = { board: lay.board, densities: built.levelPx, capMegapixels: CAP_MEGAPIXELS, tileMegapixels: TILE_MEGAPIXELS, coarse: faults.has('coarse') };
    const s = new TileStore(renderer, client, w, lay.board, built.levelPx, maxAnisotropy, schedule, fail);
    store = s;
    hook.bakes = s.bakes;
    view = limitView({}, env());
    playView = view;
    // A first frame of table and bare slabs: it compiles the shaders while the worker bakes level 0.
    const baking = s.loadLevel0();
    draw(false);
    await baking;
    updateNeeds();
    draw(false);
    if (continuous) schedule();
    const h = await client.hash();
    hook.map.hash = h.hash;
  };
  start().catch(fail);
}
