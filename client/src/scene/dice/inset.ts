/**
 * The dice inset: while a roll is shown, a small framed picture in the lower
 * right corner of the screen, of a second camera looking down into the tray's
 * felt well, with the sum and the result under it. The main view stays on the
 * action.
 *
 * The picture is drawn into the page's own canvas, after the table, in a
 * scissored corner of it: the second camera sees only the dice, the tray and
 * the table round it (INSET_LAYER), at the size of the corner, and only while
 * the inset shows, so it costs a few small draws (about 0.2 to 0.5 ms of GPU a
 * frame at 1440 by 900, pixel ratio 2: docs/review/M5/dice-handover.md). It has
 * no vignette of its own. The frame round it and the words under it are plain
 * HTML over the canvas, under the panel. It slides up into place when a throw
 * begins and back down a moment after the result is read (dice.ts says when):
 * nothing pops.
 *
 * Sizes are in the panel's design pixels (its stage is 1440 by 900; the panel
 * scales them by one interface scale, as game/hud.ts does), so the inset sits
 * clear of the panel's commands (bottom centre), its folder (bottom left) and
 * its notebook (right, above).
 */
import * as THREE from 'three';
import { multiply, orbitPose, perspective, viewMatrix } from '../camera';
import { easeInOut } from '../pieces/pose';
import type { Dice } from './dice';
import { INSET_LAYER } from './layer';
import { DIE } from './throw';
import type { Well } from './throw';

type Uniform<T> = { value: T };

/** The inset's dials, in the panel's design pixels where they are lengths on the screen. */
export const INSET = {
  /** The picture's width and height, the frame round it, the strip of words under it, and its room from the screen's right and bottom edges. */
  width: 264,
  height: 184,
  frame: 8,
  strip: 42,
  right: 14,
  bottom: 12,
  /** The second camera: its height above the table (degrees; 90 is straight down), its field of view (degrees), and how far round the felt (h) it frames. */
  elevationDeg: 64,
  fovDeg: 28,
  grow: 0.07,
  /** The panel's stage and the interface scale's limits (game/hud.ts). */
  stage: [1440, 900] as [number, number],
  scaleMin: 0.75,
  scaleMax: 2,
} as const;

/**
 * The stencil face of the title's lettering (Stick No Bills), where the page has it, and the panel's own condensed
 * face after it (its stamps and commands). The scene loads no font: a page that wants the stencil face here registers it.
 */
const FACE = `"Stick No Bills", "Avenir Next Condensed", "DIN Condensed", "Arial Narrow", sans-serif`;

const CSS = `
.dc-inset { position: fixed; left: 0; top: 0; z-index: 15; pointer-events: none; box-sizing: border-box; border-radius: 11px; overflow: hidden;
  filter: drop-shadow(0 3px 3px hsl(0 0% 0% / .45)) drop-shadow(0 8px 16px hsl(0 0% 0% / .3)); visibility: hidden; will-change: transform; }
.dc-inset .dc-window { position: absolute; border-radius: 5px; box-shadow: 0 0 0 1.5px hsl(42 64% 56%), 0 0 0 3px hsl(212 12% 12%), 0 0 0 999px hsl(212 10% 21%), inset 0 2px 7px hsl(0 0% 0% / .55); }
.dc-inset .dc-riv { position: absolute; width: 5px; height: 5px; border-radius: 50%; background: radial-gradient(circle at 35% 35%, hsl(212 12% 70%), hsl(212 10% 34%) 70%); box-shadow: 0 1px 0 hsl(0 0% 0% / .5); }
.dc-inset .dc-strip { position: absolute; display: flex; align-items: center; gap: 10px; padding: 0 10px 0 12px; box-sizing: border-box; color: hsl(42 50% 90%); font-family: ${FACE}; font-weight: 800; white-space: nowrap; }
.dc-inset .dc-sum { font-size: 30px; line-height: 1; min-width: 26px; text-align: center; transition: opacity .2s ease; }
.dc-inset .dc-faces { font-size: 15px; letter-spacing: .06em; opacity: .7; transition: opacity .2s ease; }
.dc-inset .dc-result { margin-left: auto; font-size: 17px; letter-spacing: .12em; text-transform: uppercase; padding: 4px 8px 3px; border: 2px solid currentColor; border-radius: 3px; transform: rotate(-3deg); transition: opacity .2s ease, transform .25s ease; }
.dc-inset .dc-result[data-fate="destroyed"] { color: hsl(4 70% 58%); }
.dc-inset .dc-result[data-fate="marked"] { color: hsl(42 64% 62%); }
.dc-inset .dc-result[data-fate="none"] { color: hsl(42 22% 66%); }
.dc-inset .dc-strip > .dc-wait { opacity: 0; }
.dc-inset .dc-strip > .dc-result.dc-wait { transform: rotate(-3deg) scale(1.25); }
`;

export interface InsetMount {
  /** Draw the inset's picture into the canvas (after the table), and bring its frame up to date. Does nothing while it is away. */
  draw(renderer: THREE.WebGLRenderer, scene: THREE.Object3D): void;
  /** Where the picture is on the screen (CSS pixels: left, top, width, height), and how far in it is (0 to 1). */
  readonly rect: { x: number; y: number; w: number; h: number; shown: number };
  /** Draws made by the inset's camera in its last frame (0 while it is away). */
  readonly drawCalls: number;
  /** For a check that times frames: while true the picture is not drawn (the frame and its words still are). */
  skip: boolean;
}

/** The camera that looks into the well: the board frame to its clip space, and where it stands. */
export function insetCamera(well: Well, aspect: number): { viewProj: number[]; view: number[]; proj: number[]; position: [number, number, number] } {
  const r = well.rect;
  const g = INSET.grow;
  const corners: [number, number, number][] = [];
  const t = well.tray;
  // The felt, a little grown: the walls round it are cut by the frame, and the dice are as large as the well allows.
  for (const [x, y] of [
    [r[0] - g, r[1] - g],
    [r[2] + g, r[1] - g],
    [r[2] + g, r[3] + g],
    [r[0] - g, r[3] + g],
  ] as const) {
    corners.push([t.centre[0] + t.cos * x - t.sin * y, t.centre[1] + t.sin * x + t.cos * y, well.feltZ]);
  }
  const cx = corners.reduce((s, c) => s + c[0], 0) / corners.length;
  const cy = corners.reduce((s, c) => s + c[1], 0) / corners.length;
  const target: [number, number, number] = [cx, cy, well.feltZ + DIE.side / 2];
  // The nearest distance that keeps every corner in the frame.
  const fits = (d: number): boolean => {
    const pose = orbitPose(0, INSET.elevationDeg, d, target);
    const m = multiply(perspective(INSET.fovDeg, aspect, d * 0.1, d * 10), viewMatrix(pose));
    return corners.every(c => {
      const w = (m[3] as number) * c[0] + (m[7] as number) * c[1] + (m[11] as number) * c[2] + (m[15] as number);
      const x = ((m[0] as number) * c[0] + (m[4] as number) * c[1] + (m[8] as number) * c[2] + (m[12] as number)) / w;
      const y = ((m[1] as number) * c[0] + (m[5] as number) * c[1] + (m[9] as number) * c[2] + (m[13] as number)) / w;
      return w > 0 && Math.abs(x) <= 1 && Math.abs(y) <= 1;
    });
  };
  let lo = 0.5;
  let hi = 80;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  const pose = orbitPose(0, INSET.elevationDeg, hi, target);
  const view = viewMatrix(pose);
  const proj = perspective(INSET.fovDeg, aspect, hi * 0.1, hi * 10);
  return { viewProj: multiply(proj, view), view, proj, position: pose.position };
}

/** The panel's interface scale for a window this size (game/hud.ts `fit`). */
function scaleOf(w: number, h: number): number {
  return Math.min(INSET.scaleMax, Math.max(INSET.scaleMin, Math.min(w / INSET.stage[0], h / INSET.stage[1])));
}

export function mountDiceInset(o: { root: HTMLElement; dice: Dice; shared: Record<string, Uniform<unknown>> }): InsetMount {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const box = document.createElement('div');
  box.className = 'dc-inset';
  box.setAttribute('aria-hidden', 'true');
  const win = document.createElement('div');
  win.className = 'dc-window';
  const strip = document.createElement('div');
  strip.className = 'dc-strip';
  const sum = document.createElement('span');
  sum.className = 'dc-sum dc-wait';
  const faces = document.createElement('span');
  faces.className = 'dc-faces dc-wait';
  const result = document.createElement('span');
  result.className = 'dc-result dc-wait';
  strip.append(sum, faces, result);
  const rivets = [0, 1, 2, 3].map(() => {
    const r = document.createElement('i');
    r.className = 'dc-riv';
    return r;
  });
  box.append(win, strip, ...rivets);
  o.root.appendChild(box);
  // The camera's matrices are set here, as the table's are, and three.js is told not to work them out again: the board
  // frame is drawn as its own mirror, and its own update would take the mirror out (and draw the tray inside out).
  const camera = new THREE.PerspectiveCamera();
  camera.layers.set(INSET_LAYER);
  camera.matrixAutoUpdate = false;
  camera.matrixWorldAutoUpdate = false;
  const rect = { x: 0, y: 0, w: 0, h: 0, shown: 0 };
  let calls = 0;
  let shownKey = '';
  let wellKey = '';
  let cam: ReturnType<typeof insetCamera> | null = null;
  const size = new THREE.Vector2();

  const layout = (): { s: number; W: number; H: number; F: number; S: number; left: number; top: number; drop: number } => {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const s = scaleOf(w, h);
    const W = Math.round(INSET.width * s);
    const H = Math.round(INSET.height * s);
    const F = Math.round(INSET.frame * s);
    const S = Math.round(INSET.strip * s);
    const left = w - Math.round(INSET.right * s) - W - 2 * F;
    const top = h - Math.round(INSET.bottom * s) - H - 2 * F - S;
    // Away, it lies wholly below the screen's bottom edge.
    const drop = h - top + 12;
    return { s, W, H, F, S, left, top, drop };
  };

  const words = (): void => {
    const c = o.dice.caption();
    const key = c ? `${c.serial}|${c.sum ?? ''}|${c.result ?? ''}|${c.fate ?? ''}` : '';
    if (key === shownKey) return;
    shownKey = key;
    const atRest = c !== null && c.sum !== null;
    sum.textContent = atRest ? String(c.sum) : sum.textContent;
    faces.textContent = atRest && c.faces.length > 1 ? c.faces.join(' + ') : atRest ? '' : faces.textContent;
    sum.classList.toggle('dc-wait', !atRest);
    faces.classList.toggle('dc-wait', !atRest);
    const read = c !== null && c.result !== null;
    if (read) {
      result.textContent = c.result;
      result.dataset['fate'] = c.fate ?? 'none';
    }
    result.classList.toggle('dc-wait', !read);
  };

  return {
    rect,
    get drawCalls() {
      return calls;
    },
    skip: false,
    draw(renderer, scene) {
      const shown = easeInOut(o.dice.inset);
      const well = o.dice.wellNow;
      const L = layout();
      const slide = (1 - shown) * L.drop;
      rect.x = L.left + L.F;
      rect.y = L.top + L.F + slide;
      rect.w = L.W;
      rect.h = L.H;
      rect.shown = shown;
      calls = 0;
      if (shown <= 0.0005 || !well) {
        if (box.style.visibility !== 'hidden') box.style.visibility = 'hidden';
        return;
      }
      // The frame and its words.
      box.style.visibility = 'visible';
      box.style.width = `${L.W + 2 * L.F}px`;
      box.style.height = `${L.H + 2 * L.F + L.S}px`;
      box.style.transform = `translate(${L.left}px, ${L.top + slide}px)`;
      win.style.left = `${L.F}px`;
      win.style.top = `${L.F}px`;
      win.style.width = `${L.W}px`;
      win.style.height = `${L.H}px`;
      // The words are set in the design's pixels and zoomed by the interface scale, as the panel's are.
      strip.style.zoom = String(L.s);
      strip.style.width = `${L.W / L.s}px`;
      strip.style.height = `${L.S / L.s}px`;
      strip.style.left = `${L.F / L.s}px`;
      strip.style.top = `${(L.F + L.H) / L.s}px`;
      const rv = Math.max(2, Math.round(3 * L.s));
      const rw = L.W + 2 * L.F;
      const rh = L.H + 2 * L.F + L.S;
      rivets.forEach((r, i) => {
        r.style.left = `${i % 2 === 0 ? rv : rw - rv - 5}px`;
        r.style.top = `${i < 2 ? rv : rh - rv - 5}px`;
      });
      words();
      // The picture: the second camera, in a scissored corner of the canvas (three.js counts from the bottom, in CSS pixels).
      const key = `${well.tray.centre[0]}|${well.tray.centre[1]}|${L.W}|${L.H}`;
      if (key !== wellKey || !cam) {
        wellKey = key;
        cam = insetCamera(well, L.W / L.H);
      }
      renderer.getSize(size);
      const x = rect.x;
      const yb = size.y - (rect.y + L.H);
      const visibleH = Math.min(L.H, size.y - rect.y);
      if (visibleH <= 0 || this.skip) return;
      camera.projectionMatrix.fromArray(cam.proj);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      camera.matrixWorldInverse.fromArray(cam.view);
      camera.matrixWorld.copy(camera.matrixWorldInverse).invert();
      const screen = (o.shared.uScreen as Uniform<THREE.Vector4>).value;
      const vignette = screen.z;
      // No vignette in the inset: it is a picture of its own, not a corner of the table's frame.
      screen.z = 0;
      renderer.setScissorTest(true);
      renderer.setScissor(x, Math.max(0, yb), L.W, Math.max(0, Math.min(L.H, yb + L.H)));
      renderer.setViewport(x, yb, L.W, L.H);
      const before = renderer.info.render.calls;
      const autoReset = renderer.info.autoReset;
      renderer.info.autoReset = false;
      renderer.render(scene, camera);
      calls = renderer.info.render.calls - before;
      renderer.info.autoReset = autoReset;
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, size.x, size.y);
      screen.z = vignette;
    },
  };
}
