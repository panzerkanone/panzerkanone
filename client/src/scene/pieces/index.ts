/**
 * The pieces, joined to the table page. The page (../table.ts) hands the
 * pointer and the keys here, calls `step` in its own loop and `sync` before a
 * frame, and publishes `hook` on `window.__table`; everything else is in
 * pieces.ts (what the counters are and do), view.ts (how they are drawn) and
 * toy.ts (the default set-up, and what a plain click means until a game says
 * otherwise).
 *
 * The physics engine is a dynamic import, made at the first physical gesture:
 * a page nobody pushes never fetches it.
 */
import type * as THREE from 'three';
import setupText from './data/standard.setup.json?raw';
import type { BoardLayout } from '../layout';
import { onBoards } from '../layout';
import { COUNTER, MARK_LOOK } from './dims';
import type { PiecesHook } from './hook';
import { Pieces } from './pieces';
import type { GridLike, HexLike, PiecesAnswers, PiecesWatch, TintKind } from './pieces';
import type { Rapier } from './physics';
import type { PiecesPort } from './port';
import { Toy, countersOf, parseSetup } from './toy';
import type { Silhouette } from './faces';
import { PiecesView } from './view';
import { parseTrayLayout, placeTray } from '../tray/layout';
import type { TrayArt } from '../tray/view';
import type { Dice } from '../dice/dice';

export type { PiecesPort } from './port';

/** Unit art handed to the pieces from outside the scene (the scene imports none of it and downloads nothing): a silhouette, already decoded, for each unit type that has one, when they have arrived. */
export interface UnitArt {
  silhouettes: Promise<ReadonlyMap<string, Silhouette>>;
}
export type { Silhouette } from './faces';
export type { TrayArt } from '../tray/view';

export interface PiecesMount {
  /** What is drawn: add it to the scene's root. */
  object: THREE.Object3D;
  port: PiecesPort;
  hook: PiecesHook;
  /** A press. True when it began a physical gesture (Alt held): the page then does not pan. */
  pointerDown(e: { clientX: number; clientY: number; altKey: boolean; shiftKey: boolean }): boolean;
  pointerMove(e: { clientX: number; clientY: number; altKey: boolean }): void;
  /** True when it ended a physical gesture. */
  pointerUp(e: { clientX: number; clientY: number }): boolean;
  pointerLeave(): void;
  /** A key. True when the pieces used it. */
  key(e: { code: string; ctrlKey: boolean; metaKey: boolean; repeat: boolean }): boolean;
  /**
   * One pass of the page's loop, with the frame's time stamp in ms. True while anything is moving. `viewGliding`:
   * the page's view is gliding to somewhere (the table's `goTo`): a counter lit meanwhile keeps its pulse until it has arrived.
   */
  step(ts: number, viewGliding?: boolean): boolean;
  /** Before a frame is drawn. */
  sync(): void;
  /** After a lost graphics context. */
  restore(): void;
  /** One line for the page's readout. */
  readout(): string;
  /** How high the stack on a hex stands above the sheet, in h (0 on an empty hex). */
  stackTop(hex: number): number;
  /** The dice in the tray's felt well (the inset draws them). */
  dice: Dice;
  /** Where a counter is on the plan, by its id; null where there is none of that name. */
  placeOf(id: string): [number, number] | null;
}

const GESTURES =
  'Click a counter: select (again: the next one down). Click a hex: send it there. Esc: let go.  |  Alt-drag: push with a fingertip. Alt-click: poke. Alt-Shift-drag: pick up, carry, throw.  |  B: bump the table. Space: everything goes home. R: reset.';

export function mountPieces(o: {
  hex: HexLike & {
    parseLabel(g: GridLike, label: string): number;
    cornersOf(g: GridLike, id: number): readonly (readonly [number, number])[];
    colOf(g: GridLike, id: number): number;
    rowOf(g: GridLike, id: number): number;
  };
  grid: GridLike;
  /** The boards as they lie now (a dial may move them). */
  layout: () => BoardLayout;
  /** The scene's shared uniforms (world.ts). */
  shared: Record<string, { value: unknown }>;
  maxAnisotropy: number;
  camera: () => { viewProj: readonly number[]; css: readonly [number, number] };
  tint: (kind: TintKind, hexes: readonly number[]) => void;
  wake: () => void;
  /** Where to put the line that lists the gestures, or null (the bare page). */
  strip: HTMLElement | null;
  /** The page's canvas: its pointer shows a fingertip while Alt is held. */
  canvas: HTMLElement;
  /** Silhouettes for the counters, or nothing: the faces then keep their plain blocks. */
  art?: UnitArt | undefined;
  /**
   * The counter tray's art (its layout, mesh and picture, fetched and decoded by whoever started the page), or nothing.
   * When it arrives the tray is stood on the table beside the boards and lost counters go to it; until then, and
   * without it, the table is as it was and a destroyed counter is flicked away.
   */
  tray?: Promise<TrayArt | null> | undefined;
  /** Whoever watches what a game asks of the pieces (the table's effects), or nobody. */
  watch?: PiecesWatch | undefined;
  /** Where the port's `intent` and `answer` are shown (the table's marks), or nowhere. */
  answers?: PiecesAnswers | undefined;
  /** The cursor the canvas has when no hand is on the counters (the page's own, or what a game's intent asks); without it, the one the canvas had at the start. */
  restCursor?: (() => string) | undefined;
  /** The dice (../dice): whether a throw tumbles (false: the faces are laid at once), and whether the inset shows. Both when left out. */
  dice?: { tumble: boolean; inset: boolean } | undefined;
}): PiecesMount {
  // Fetched once, whether the counters or the dice ask first.
  let engine: Promise<Rapier> | null = null;
  const loadPhysics = (): Promise<Rapier> =>
    (engine ??= (async () => {
      const R = await import('@dimforge/rapier3d-compat');
      await R.init();
      return R;
    })());
  const pieces = new Pieces({
    hex: o.hex,
    grid: o.grid,
    get layout() {
      return o.layout();
    },
    camera: o.camera,
    loadPhysics,
    tint: o.tint,
    wake: o.wake,
    watch: o.watch,
    answers: o.answers,
    dice: o.dice,
  });
  const view = new PiecesView(pieces, o.shared, {
    maxAnisotropy: o.maxAnisotropy,
    slabs: () => o.layout().slabs,
    tableZ: () => o.layout().table.z,
    centreOf: hex => o.hex.centreOf(o.grid, hex),
    cornersOf: hex => o.hex.cornersOf(o.grid, hex),
    colRowOf: hex => [o.hex.colOf(o.grid, hex), o.hex.rowOf(o.grid, hex)],
  });

  // The silhouettes arrive after the page has started (whoever started it fetched and decoded them: the scene
  // downloads nothing): the counters show plain blocks at once, and their faces are drawn again, once, when the
  // pictures are here. A type whose picture is missing keeps the plain block.
  if (o.art) {
    void o.art.silhouettes.then(
      got => {
        if (got.size === 0) return;
        view.setArt(got);
        o.wake();
      },
      () => undefined,
    );
  }

  // The tray likewise arrives after the page has started, already fetched and decoded. Its numbers say what it
  // is; where it stands is worked out here from the boards as they lie.
  if (o.tray) {
    void o.tray.then(
      art => {
        if (!art) return;
        const placed = placeTray(parseTrayLayout(art.layout), o.layout());
        pieces.setTray(placed);
        view.setTray(placed, art);
        o.wake();
      },
      (err: unknown) => console.error(err),
    );
  }

  // The default user: the toy's set-up, where this board has room for it.
  let toy: Toy | null = null;
  let note = '';
  try {
    const setup = parseSetup(setupText);
    const all = setup.stacks.every(s => o.hex.parseLabel(o.grid, s.hex) >= 0);
    if (all) toy = new Toy(pieces, countersOf(setup, label => o.hex.parseLabel(o.grid, label)));
    else note = `the toy's set-up is for a board of ${setup.board.cols} x ${setup.board.rows}; this board has no room for it, so there are no counters until a game sets some up`;
  } catch (err) {
    note = err instanceof Error ? err.message : String(err);
    console.error(err);
  }

  if (o.strip) {
    const line = document.createElement('div');
    line.textContent = GESTURES;
    line.style.cssText = 'position:fixed;left:8px;bottom:40px;max-width:calc(100vw - 32px);font:11px/1.4 system-ui,sans-serif;padding:3px 8px;background:Canvas;color:CanvasText;opacity:0.86;border-radius:4px;pointer-events:none';
    o.strip.appendChild(line);
  }

  // The pointer says which hand is in play: the page's own (it pans) with no key held, a fingertip
  // with Alt, a hand that picks up with Alt and Shift.
  const keys = { alt: false, shift: false };
  const plainCursor = o.canvas.style.cursor;
  const showHand = (): void => {
    if (keys.alt) o.canvas.style.cursor = keys.shift ? (pieces.handling ? 'grabbing' : 'grab') : 'pointer';
    else if (o.canvas.style.cursor === 'pointer') o.canvas.style.cursor = o.restCursor ? o.restCursor() : plainCursor;
  };
  const readKeys = (e: { altKey: boolean; shiftKey: boolean }): void => {
    if (keys.alt === e.altKey && keys.shift === e.shiftKey) return;
    keys.alt = e.altKey;
    keys.shift = e.shiftKey;
    showHand();
  };
  window.addEventListener('keydown', readKeys);
  window.addEventListener('keyup', readKeys);
  window.addEventListener('blur', () => readKeys({ altKey: false, shiftKey: false }));

  let last = 0;
  /** Rolls thrown by a check (`__table.dice.throw`), numbered apart from a game's. */
  let checkRolls = 100000;
  /** A wake asked for by the dice (the inset going a moment after the result is read, with nothing else moving). */
  let diceTimer = 0;
  const needSim = (): NonNullable<Pieces['sim']> => {
    if (!pieces.sim) throw new Error('the physics is not loaded: await __table.physics.load() first');
    return pieces.sim;
  };
  const surfaceAt = (x: number, y: number): number => (onBoards(o.layout(), x, y) ? 0 : o.layout().table.z);

  const hook: PiecesHook = {
    get pieces() {
      return pieces.readings();
    },
    get selected() {
      return pieces.selectedIds()[0] ?? null;
    },
    order: (id, hex) => {
      const done = pieces.move(id, hex);
      o.wake();
      return done;
    },
    home: () => pieces.goHome(),
    reset: () => {
      if (toy && !pieces.taken) toy.reset();
      else pieces.resetHomes();
    },
    physics: {
      get loaded() {
        return pieces.sim !== null;
      },
      get loads() {
        return pieces.physicsLoads;
      },
      get bodies() {
        return pieces.sim ? pieces.sim.freeCount() : 0;
      },
      get awake() {
        return pieces.sim ? pieces.sim.awake() : 0;
      },
      get steps() {
        return pieces.sim ? pieces.sim.steps : 0;
      },
      get stepMs() {
        return { last: pieces.sim ? pieces.sim.lastStepMs : 0, mean: pieces.sim ? pieces.sim.meanStepMs : 0 };
      },
      get finger() {
        return pieces.sim ? pieces.sim.fingerAt() : null;
      },
      load: () => pieces.loadPhysics(),
      step: n => pieces.stepPhysics(n),
      push: (from, to, seconds, z, held) => {
        needSim().scriptPush(from, to, seconds, z ?? surfaceAt(from[0], from[1]), held ?? z === undefined);
        o.wake();
      },
      poke: (id, at) => {
        needSim();
        const p = pieces.get(id);
        pieces.poke(id, [at ? at[0] : p.pose.p[0], at ? at[1] : p.pose.p[1], p.pose.p[2] + COUNTER.thickness / 2]);
      },
      grab: (id, at) => {
        needSim();
        const p = pieces.get(id);
        pieces.grab(id, at ?? [p.pose.p[0], p.pose.p[1], p.pose.p[2] + COUNTER.thickness / 2]);
      },
      carry: (to, seconds, then) => {
        needSim().scriptCarry(to, seconds, then ?? 'release');
        o.wake();
      },
      release: () => {
        needSim().release();
        o.wake();
      },
      bump: () => pieces.bump(),
    },
    piecesPort: pieces,
    markLook: look => {
      pieces.setMarkLook(look);
      o.wake();
      return { ...MARK_LOOK };
    },
    get clicks() {
      return pieces.clicks;
    },
    get cues() {
      return pieces.cueReadings();
    },
    get piecesInfo() {
      return { counters: pieces.list.filter(p => !p.off).length, textures: { ...view.textures }, note };
    },
    get tray() {
      return pieces.trayReading();
    },
    dice: {
      get reading() {
        return pieces.rolls.readings();
      },
      throw: (faces, opts = {}) => {
        // As a game shows a roll: pointed out, thrown, and read a moment later.
        const serial = ++checkRolls;
        const roll = { serial, seed: opts.seed ?? 1, faces: [] as number[], sides: 6, rolled: false, result: null, fate: null, stock: opts.stock ?? 'first' } as const;
        pieces.dice({ ...roll });
        pieces.dice({ ...roll, faces: [...faces], rolled: true });
        window.setTimeout(() => pieces.dice({ ...roll, faces: [...faces], rolled: true, result: opts.result ?? 'No effect', fate: opts.fate ?? 'none' }), opts.readMs ?? 750);
        o.wake();
        return serial;
      },
      pause: on => {
        pieces.rolls.pause(on, performance.now() / 1000);
        o.wake();
      },
    },
  };

  return {
    object: view.group,
    port: pieces,
    hook,
    pointerDown: e => {
      const taken = pieces.pointerDown(e.clientX, e.clientY, e.altKey, e.shiftKey);
      readKeys(e);
      showHand();
      return taken;
    },
    pointerMove: e => pieces.pointerMove(e.clientX, e.clientY, e.altKey),
    pointerUp: e => {
      const ended = pieces.pointerUp(e.clientX, e.clientY);
      // The page puts its own pointer back when a press ends: say again which hand is in play.
      window.setTimeout(showHand, 0);
      return ended;
    },
    pointerLeave: () => pieces.pointerLeave(),
    key: e => {
      // Never a browser's own shortcut (Cmd-R reloads, as it should).
      if (e.ctrlKey || e.metaKey) return false;
      if (e.repeat) return e.code === 'Space' || e.code === 'KeyB' || e.code === 'KeyR' || e.code === 'Escape';
      return pieces.key(e.code);
    },
    step: (ts, viewGliding = false) => {
      const dt = last > 0 ? Math.min(0.05, Math.max(0, (ts - last) / 1000)) : 1 / 60;
      pieces.viewGliding = viewGliding;
      const moving = pieces.step(dt, ts / 1000);
      last = moving ? ts : 0;
      // The loop stops when nothing moves; the inset still has to go a moment after the result is read.
      const wake = moving ? null : pieces.rolls.wakeIn();
      window.clearTimeout(diceTimer);
      if (wake !== null) diceTimer = window.setTimeout(o.wake, wake * 1000);
      return moving;
    },
    sync: () => view.sync(),
    restore: () => view.restore(),
    stackTop: hex => pieces.stackAt(hex).length * COUNTER.thickness,
    dice: pieces.rolls,
    placeOf: id => {
      if (!pieces.has(id)) return null;
      const p = pieces.get(id);
      return [p.pose.p[0], p.pose.p[1]];
    },
    readout: () => {
      const loose = pieces.list.filter(p => p.state === 'loose').length;
      const sel = pieces.selectedIds()[0];
      const sim = pieces.sim;
      return `${pieces.list.filter(p => !p.off).length} counters${sel ? `, ${sel} selected` : ''}${loose > 0 ? `, ${loose} loose` : ''}${sim ? `, physics ${sim.awake() > 0 || sim.handled ? `awake (${sim.awake()})` : 'asleep'}` : ''}`;
    },
  };
}
