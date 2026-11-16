/**
 * The bench: /?view=game[&rules=v1][&deploy=free][&seed=<n>][&sides=...][&gap=<ms>][&fast=1].
 *
 * A page to play the slice on now: the board's flat bake (level 0
 * of the map art, from the viewer's bake worker) with the flat pieces
 * (flat-pieces.ts) over it and the panel (hud.ts) over both. A test bench and
 * a fallback, not the game's look. The address's settings are start.ts's.
 *
 * The board is fitted to the window, clear of the panel's edge parts (the
 * plate and the box of words, the commands, the notebook's tabs). The wheel
 * zooms about the pointer; a drag pans; a plain click (no drag, no modifier
 * key, the main button) goes to the game. The bench hands the panel one map
 * control of its own, "Whole board", and the colours of its tints.
 *
 * window.__bench publishes what a script needs to click as a person would:
 * where a counter and a bare spot of a hex are on screen, in CSS pixels.
 */
import { BakeClient } from '../bake/client';
import { level0Chunks } from '../bake/protocol';
import type { Rect } from '../bake/protocol';
import { parseMap, gridOf } from '@engine/core/map';
import { centreOf, worldBounds } from '@engine/core/hex';
import { FlatPieces } from './flat-pieces';
import { setInks } from './inks';
import { boardTextFrom, fullRules, startGame } from './start';
import type { MapControls, MusicControls, PanelSkin, UnitPicture } from './hud';

export interface BenchHook {
  /** The board's picture is on screen. */
  ready: boolean;
  error: string | null;
  /** The middle of a counter, in CSS pixels; null when it is not on the board. */
  counterAt(id: string): [number, number] | null;
  /** A point of a hex that no counter covers, in CSS pixels. */
  hexAt(hex: number): [number, number];
  /** The middle of a hex, in CSS pixels. */
  centreAt(hex: number): [number, number];
  /** Show the whole board again. */
  fit(): void;
  /** Centre a hex with `px` CSS pixels to a hex. */
  lookAt(hex: number, px: number): void;
  /** The view: the world point at the middle of the window (h) and CSS pixels to a hex. */
  view(): { centre: [number, number]; px: number; fitted: boolean };
}

declare global {
  interface Window {
    __bench?: BenchHook;
  }
}

/**
 * Room kept clear of the board when it is fitted, in the panel's own design pixels (they grow and shrink with
 * its scale): the plate and the box of words above, the commands below, the notebook's tabs at the right.
 */
const INSET_PLAIN = { top: 186, bottom: 76, left: 16, right: 124 };
/** The real rules' panel has a second row of commands. */
const INSET_FULL = { top: 186, bottom: 116, left: 16, right: 124 };
const MAX_PX = 260;
/** The panel's scale for a window (hud.ts: one scale from the window, between its limits). */
const panelScale = (w: number, h: number): number => Math.min(2, Math.max(0.75, Math.min(w / 1440, h / 900)));

export function startBench(
  root: HTMLElement,
  params: URLSearchParams,
  art?: (type: string) => UnitPicture | null,
  label?: (type: string) => string | null,
  more?: { skin?: PanelSkin; music?: MusicControls },
): void {
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';
  root.textContent = '';
  const page = document.createElement('div');
  page.style.cssText = 'position:fixed;inset:0;overflow:hidden;background:color-mix(in srgb, var(--ink-ground) 42%, var(--ink-key));';
  setInks(page);
  root.appendChild(page);

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;touch-action:none;cursor:default;';
  page.appendChild(canvas);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  const INSET = fullRules(params) ? INSET_FULL : INSET_PLAIN;
  const loaded = parseMap(boardTextFrom(params));
  if (!loaded.map) {
    page.append(document.createTextNode(`The board could not be read: ${loaded.problems.slice(0, 3).join('; ')}`));
    return;
  }
  const grid = gridOf(loaded.map);
  const pieces = new FlatPieces(page, grid);
  const panel = document.createElement('div');
  page.appendChild(panel);

  const waiting = document.createElement('div');
  waiting.textContent = 'Printing the board…';
  waiting.style.cssText = 'position:absolute;left:24px;top:96px;font-family:system-ui,sans-serif;font-size:15px;color:white;opacity:0.85;transition:opacity 0.4s ease;pointer-events:none;';
  page.appendChild(waiting);

  // The view: the world point (cx, cy) in h at the middle of the window, `px` CSS pixels to one h.
  // The room the board is fitted in is the hexes' own rectangle and a margin, known before the picture is;
  // the picture brings its own rectangle (`bounds`) and is drawn where that says.
  const hexes = worldBounds(grid);
  const room: [number, number, number, number] = [hexes[0] - 0.45, hexes[1] - 0.45, hexes[2] + 0.45, hexes[3] + 0.45];
  let bounds: readonly number[] = room;
  let cx = 0;
  let cy = 0;
  let px = 40;
  let minPx = 10;
  let fitted = true;
  let level0: { rect: Rect; bitmap: ImageBitmap }[] = [];
  let levelPx = 128;
  let frame = false;

  const size = (): [number, number] => [window.innerWidth, window.innerHeight];
  const listeners = new Set<() => void>();
  const changed = (): void => {
    for (const fn of [...listeners]) fn();
  };

  const fit = (): void => {
    const [w, h] = size();
    const k = panelScale(w, h);
    const bw = room[2] - room[0];
    const bh = room[3] - room[1];
    const aw = Math.max(200, w - (INSET.left + INSET.right) * k);
    const ah = Math.max(200, h - (INSET.top + INSET.bottom) * k);
    px = Math.min(aw / bw, ah / bh);
    minPx = px * 0.6;
    // The board's middle goes to the middle of the room left for it.
    cx = (room[0] + room[2]) / 2 - ((INSET.left * k + aw / 2) - w / 2) / px;
    cy = (room[1] + room[3]) / 2 - ((INSET.top * k + ah / 2) - h / 2) / px;
    fitted = true;
    changed();
  };

  const toScreen = (x: number, y: number): [number, number] => {
    const [w, h] = size();
    return [(x - cx) * px + w / 2, (y - cy) * px + h / 2];
  };
  const toWorld = (sx: number, sy: number): [number, number] => {
    const [w, h] = size();
    return [(sx - w / 2) / px + cx, (sy - h / 2) / px + cy];
  };

  const draw = (): void => {
    frame = false;
    const dpr = window.devicePixelRatio || 1;
    const [w, h] = size();
    const W = Math.round(w * dpr);
    const H = Math.round(h * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const k = (px * dpr) / levelPx;
    for (const c of level0) {
      const sx = ((bounds[0] as number) + c.rect[0] / levelPx - cx) * px * dpr + W / 2;
      const sy = ((bounds[1] as number) + c.rect[1] / levelPx - cy) * px * dpr + H / 2;
      ctx.drawImage(c.bitmap, sx, sy, c.rect[2] * k, c.rect[3] * k);
    }
    pieces.setView(cx, cy, px, w, h);
    page.dataset['zoom'] = px < 58 ? 'far' : 'near';
  };
  const requestFrame = (): void => {
    if (frame) return;
    frame = true;
    requestAnimationFrame(draw);
  };

  // ---- the pointer: a drag pans, the wheel zooms, a plain click is the game's ----
  let down: { x: number; y: number; cx: number; cy: number; id: number; panned: boolean } | null = null;
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    down = { x: e.clientX, y: e.clientY, cx, cy, id: e.pointerId, panned: false };
  });
  canvas.addEventListener('pointermove', e => {
    if (down && down.id === e.pointerId) {
      if (!down.panned && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) return;
      down.panned = true;
      canvas.style.cursor = 'grabbing';
      cx = down.cx - (e.clientX - down.x) / px;
      cy = down.cy - (e.clientY - down.y) / px;
      if (fitted) {
        fitted = false;
        changed();
      }
      requestFrame();
      return;
    }
    const [x, y] = toWorld(e.clientX, e.clientY);
    pieces.pointer('move', x, y);
  });
  const up = (e: PointerEvent, cancelled: boolean): void => {
    if (!down || down.id !== e.pointerId) return;
    const was = down;
    down = null;
    canvas.style.cursor = 'default';
    // A click with Shift, Ctrl or Cmd held is a click all the same: the game reads the three as its adding modifier (keys.ts). Alt is not the game's.
    if (cancelled || was.panned || e.altKey) return;
    const [x, y] = toWorld(e.clientX, e.clientY);
    pieces.pointer('click', x, y);
  };
  // A Ctrl-click on a Mac also raises the browser's menu: not over the board.
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerup', e => up(e, false));
  canvas.addEventListener('pointercancel', e => up(e, true));
  canvas.addEventListener('pointerleave', () => {
    if (!down) pieces.pointer('leave', 0, 0);
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const [w, h] = size();
    const [x, y] = toWorld(e.clientX, e.clientY);
    const next = Math.min(MAX_PX, Math.max(minPx, px * Math.exp(-e.deltaY * 0.0015)));
    cx = x - (e.clientX - w / 2) / next;
    cy = y - (e.clientY - h / 2) / next;
    px = next;
    if (fitted) {
      fitted = false;
      changed();
    }
    requestFrame();
  }, { passive: false });
  window.addEventListener('resize', () => {
    if (fitted) fit();
    requestFrame();
  });

  const hook: BenchHook = {
    ready: false,
    error: null,
    counterAt(id: string): [number, number] | null {
      const at = pieces.whereIs(id);
      return at ? toScreen(at[0], at[1]) : null;
    },
    hexAt(hex: number): [number, number] {
      const at = pieces.bareSpot(hex);
      return toScreen(at[0], at[1]);
    },
    centreAt(hex: number): [number, number] {
      const at = centreOf(grid, hex);
      return toScreen(at[0], at[1]);
    },
    fit(): void {
      fit();
      requestFrame();
    },
    view(): { centre: [number, number]; px: number; fitted: boolean } {
      return { centre: [cx, cy], px, fitted };
    },
    lookAt(hex: number, toPx: number): void {
      const at = centreOf(grid, hex);
      cx = at[0];
      cy = at[1];
      px = Math.min(MAX_PX, Math.max(minPx, toPx));
      fitted = false;
      changed();
      requestFrame();
    },
  };
  window.__bench = hook;

  // The bench's own board has one control, and its tints their own colours (flat-pieces.ts draws them from the same inks).
  const map: MapControls = {
    list: () => [{ id: 'whole', label: 'Whole board', key: '', on: fitted }],
    press: id => {
      if (id !== 'whole') return;
      fit();
      requestFrame();
    },
    onChange: fn => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    keys: [{ key: 'drag', does: 'slide the board \u00b7 the wheel zooms', claims: [] }],
    tints: [
      { kind: 'reach', colour: 'color-mix(in srgb, var(--ink-straw) 30%, white)' },
      { kind: 'reach-near', colour: 'color-mix(in srgb, var(--ink-straw) 62%, white)' },
      { kind: 'target', colour: 'color-mix(in srgb, var(--ink-red) 55%, white)' },
      { kind: 'path', colour: 'color-mix(in srgb, var(--ink-blue) 60%, white)' },
      { kind: 'objective', colour: 'color-mix(in srgb, var(--ink-straw) 55%, white)' },
      { kind: 'zone', colour: 'color-mix(in srgb, var(--ink-blue) 24%, white)' },
    ],
  };

  fit();
  draw();
  const session = startGame({
    pieces, panel, params, map,
    ...(art ? { art } : {}), ...(label ? { label } : {}), ...(more?.skin ? { skin: more.skin } : {}), ...(more?.music ? { music: more.music } : {}),
  });
  pieces.speed = () => (session.pace.fast ? 0.3 : 1);

  // The board's picture: built and baked by the map art worker, level 0 only.
  const client = new BakeClient();
  const bake = async (): Promise<void> => {
    const built = await client.buildText(boardTextFrom(params));
    bounds = built.bounds;
    levelPx = built.levelPx[0];
    const baked = await Promise.all(level0Chunks(bounds).map(rect => client.bake(0, rect, 'bitmap')));
    level0 = baked.map(r => ({ rect: r.rect, bitmap: r.bitmap as ImageBitmap }));
    waiting.style.opacity = '0';
    requestFrame();
    requestAnimationFrame(() => {
      hook.ready = true;
    });
  };
  bake().catch((err: unknown) => {
    hook.error = err instanceof Error ? err.message : String(err);
    waiting.textContent = `The board could not be printed: ${hook.error}`;
  });
}
