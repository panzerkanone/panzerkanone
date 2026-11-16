/**
 * The bake harness at /?view=bake, used by `npm run bake` (scripts/bake.ts)
 * through a headless browser. It drives the same worker the viewer uses and
 * hands back PNG files, so a bake on the command line is the viewer's bake.
 *
 *   window.__bake.load({ mapText } | { listText }) -> { bounds, levelPx, ops, buildMs }  (levelPx: level
 *                                                       pixels per h of levels 0, 1 and 2 on this board)
 *   window.__bake.bake(level, [x, y, w, h], { extraBreaks }?) -> { png (base64), ms, drawMs }
 *                                                       (extraBreaks: a check that must not change a pixel)
 *   window.__bake.hash()                             -> the list's hash
 *   window.__bake.plan(level)                        -> the rectangles of a whole level: level 0 in
 *                                                       one image (or chunks of at most 4096 px), levels
 *                                                       1 and 2 in 1024 px tiles; level 0 is at 128 px
 *                                                       per h, or 64 or 32 on a board too large for that
 */
import { BakeClient } from './client';
import { Level, Rect, level0Chunks, tileCounts, tileRect } from './protocol';

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

export interface BakeHarness {
  ready: boolean;
  load(input: { mapText?: string; listText?: string }): Promise<{ bounds: number[]; levelPx: number[]; ops: number; buildMs: number }>;
  bake(level: Level, rect: Rect, options?: { extraBreaks?: boolean }): Promise<{ png: string; ms: number; drawMs: number }>;
  hash(): Promise<string>;
  plan(level: Level): Rect[];
}

declare global {
  interface Window {
    __bake?: BakeHarness;
  }
}

export function startHarness(root: HTMLElement): void {
  const client = new BakeClient();
  root.textContent = 'bake harness';
  let bounds: number[] | null = null;
  window.__bake = {
    ready: true,
    async load(input) {
      const r = input.listText !== undefined ? await client.setList(input.listText) : await client.buildText(input.mapText ?? '');
      bounds = r.bounds;
      return { bounds: r.bounds, levelPx: r.levelPx, ops: r.ops, buildMs: r.buildMs };
    },
    async bake(level, rect, options) {
      const r = await client.bake(level, rect, 'png', options?.extraBreaks === true);
      if (!r.png) throw new Error('the worker returned no image');
      return { png: toBase64(r.png), ms: r.ms, drawMs: r.drawMs };
    },
    async hash() {
      return (await client.hash()).hash;
    },
    plan(level) {
      if (!bounds) throw new Error('nothing loaded');
      if (level === 0) return level0Chunks(bounds);
      const [nx, ny] = tileCounts(bounds, level);
      const out: Rect[] = [];
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out.push(tileRect(bounds, level, i, j));
      return out;
    },
  };
}
