/**
 * The baked map viewer: /?view=mapart&map=<id>[&bare=1].
 *
 * Shows the baked board of assets/maps/<id>.map.yaml. Level 0 is always under
 * everything: the whole board, at 128 px per h when that comes to at most 24
 * megapixels, otherwise at 64, otherwise at 32 (LEVEL0_MAX_PIXELS in
 * ../bake/protocol.ts), so the viewer never holds more of it than that. Sharper
 * tiles (levels 1 and 2, 256 and 512 px per h) are baked on demand by the worker
 * and kept least recently used, at most TILE_CAP of them. The view opens with
 * the whole board in sight; drag pans, the wheel zooms, and zoom stops at 640
 * device pixels to a hex (the lead's ruling 9).
 *
 * A map that is not under assets/maps: put its text, URL-encoded, in the
 * address's fragment, which never goes to the server however long it is:
 *   /?view=mapart&bare=1#mapText=<encodeURIComponent(text of the .map.yaml file)>
 * `npm run bake -- <map file> --viewer-url` prints that address for a file
 * (BASE_URL as for a bake). With a map text in the fragment, `map=` is ignored.
 *
 * The screen mapping, in device pixels: a world point (x, y) in h lands at
 *   ((x - centre.x) * pxPerHex + screenW / 2, (y - centre.y) * pxPerHex + screenH / 2).
 * The level shown is the coarsest with at least 0.8 of its pixels per screen
 * pixel: on a board with level 0 at 128 px per h, 0 up to 160 device px per h,
 * 1 up to 320, 2 above.
 *
 * window.__mapart publishes what the checks read; see the MapArtHook type.
 */
import { BakeClient } from '../bake/client';
import { LEVEL_PX, Level, Rect, TILE, level0Chunks, levelSize, tileCounts, tileRect } from '../bake/protocol';

/** At most this many tiles are kept (48 tiles of 1024 x 1024 x 4 bytes is 192 MiB). */
export const TILE_CAP = 48;
/** Zoom stops here, in device pixels per h. */
export const MAX_PX_PER_HEX = 640;

export interface MapArtHook {
  ready: boolean;
  /** performance.now() at the first frame that showed level 0 of the whole board. */
  visibleMs: number | null;
  /** SHA-256 of the display list, as `npm run mapart` prints it. */
  hash: string | null;
  builds: number;
  bakes: { level0: number; tiles: number };
  /**
   * centre (h) and pxPerHex (device pixels per h) of the view; the level shown and its level pixels
   * per h; level0PxPerHex, the resolution level 0 is baked at on this board (128, 64 or 32).
   */
  readonly view: { centre: [number, number]; pxPerHex: number; level: Level; levelPxPerHex: number; level0PxPerHex: number; screen: [number, number] };
  readonly tiles: { resident: number; pending: number; cap: number };
  setView(x: number, y: number, pxPerHex: number): void;
  /** Device-pixel position on screen of a world point (h). */
  worldToScreen(x: number, y: number): [number, number];
  timings: { buildMs: number | null; level0BakeMs: number | null; hashMs: number | null };
  error: string | null;
}

declare global {
  interface Window {
    __mapart?: MapArtHook;
  }
}

interface Tile {
  key: string;
  level: Level;
  rect: Rect;
  bitmap: ImageBitmap;
  used: number;
}

/** The map text in the address's fragment (#mapText=...), if any. */
function mapTextFromAddress(): string | null {
  const hash = window.location.hash;
  if (!hash.startsWith('#mapText=')) return null;
  return decodeURIComponent(hash.slice('#mapText='.length));
}

export function startViewer(root: HTMLElement, params: URLSearchParams): void {
  const mapText = mapTextFromAddress();
  const mapId = mapText !== null ? 'map from the address' : params.get('map') ?? 'test_standard';
  const bare = params.get('bare') === '1';
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';
  root.textContent = '';

  const canvas = document.createElement('canvas');
  canvas.style.position = 'fixed';
  canvas.style.left = '0';
  canvas.style.top = '0';
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'grab';
  root.appendChild(canvas);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  let hud: HTMLDivElement | null = null;
  if (!bare) {
    hud = document.createElement('div');
    hud.style.cssText = 'position:fixed;left:8px;bottom:8px;font:12px/1.4 system-ui,sans-serif;padding:4px 8px;background:rgba(255,255,255,0.85);border-radius:4px;pointer-events:none';
    root.appendChild(hud);
  }

  const client = new BakeClient();
  let bounds: [number, number, number, number] | null = null;
  /** Level pixels per h of levels 0, 1 and 2 on this board (level 0 comes down on a large board). */
  let lpx: [number, number, number] = [LEVEL_PX[0], LEVEL_PX[1], LEVEL_PX[2]];
  const levelFor = (pxPerHex: number): Level => {
    if (pxPerHex <= lpx[0] / 0.8) return 0;
    if (pxPerHex <= lpx[1] / 0.8) return 1;
    return 2;
  };
  let level0: { rect: Rect; bitmap: ImageBitmap }[] = [];
  let level0Done = false;
  let cx = 0;
  let cy = 0;
  let ppx = 100;
  let minPx = 10;
  let W = 1;
  let H = 1;
  let useCounter = 0;
  const tiles = new Map<string, Tile>();
  const queued: { key: string; level: Level; rect: Rect; dist: number }[] = [];
  const inFlight = new Set<string>();
  let frameRequested = false;

  const hook: MapArtHook = {
    ready: false,
    visibleMs: null,
    hash: null,
    builds: 0,
    bakes: { level0: 0, tiles: 0 },
    get view() {
      const level = levelFor(ppx);
      return { centre: [cx, cy] as [number, number], pxPerHex: ppx, level, levelPxPerHex: lpx[level], level0PxPerHex: lpx[0], screen: [W, H] as [number, number] };
    },
    get tiles() {
      return { resident: tiles.size, pending: queued.length + inFlight.size, cap: TILE_CAP };
    },
    setView(x: number, y: number, pxPerHex: number) {
      cx = x;
      cy = y;
      ppx = Math.min(MAX_PX_PER_HEX, Math.max(minPx, pxPerHex));
      refreshQueue();
      requestFrame();
    },
    worldToScreen(x: number, y: number): [number, number] {
      return [(x - cx) * ppx + W / 2, (y - cy) * ppx + H / 2];
    },
    timings: { buildMs: null, level0BakeMs: null, hashMs: null },
    error: null,
  };
  window.__mapart = hook;

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    W = Math.round(window.innerWidth * dpr);
    H = Math.round(window.innerHeight * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    requestFrame();
  };

  const fitView = () => {
    if (!bounds) return;
    const bw = bounds[2] - bounds[0];
    const bh = bounds[3] - bounds[1];
    cx = (bounds[0] + bounds[2]) / 2;
    cy = (bounds[1] + bounds[3]) / 2;
    ppx = Math.min(W / bw, H / bh) * 0.98;
    minPx = Math.min(ppx * 0.5, 40);
  };

  /** Screen position of a level pixel, snapped to a whole pixel when it is within a hair of one. */
  const screenOf = (level: Level, X: number, Y: number): [number, number] => {
    const b = bounds as [number, number, number, number];
    const k = lpx[level];
    let sx = (b[0] + X / k - cx) * ppx + W / 2;
    let sy = (b[1] + Y / k - cy) * ppx + H / 2;
    if (Math.abs(sx - Math.round(sx)) < 1e-3) sx = Math.round(sx);
    if (Math.abs(sy - Math.round(sy)) < 1e-3) sy = Math.round(sy);
    return [sx, sy];
  };

  const drawImageAt = (bitmap: ImageBitmap, level: Level, rect: Rect) => {
    const [sx, sy] = screenOf(level, rect[0], rect[1]);
    const scale = ppx / lpx[level];
    const w = rect[2] * scale;
    const h = rect[3] * scale;
    if (sx > W || sy > H || sx + w < 0 || sy + h < 0) return;
    ctx.drawImage(bitmap, sx, sy, w, h);
  };

  /** The tiles of the current level that the screen shows, nearest the centre first. */
  const visibleTiles = (level: Level): { key: string; rect: Rect; dist: number }[] => {
    if (!bounds || level === 0) return [];
    const k = lpx[level];
    const [nx, ny] = tileCounts(bounds, level);
    const [lw, lh] = levelSize(bounds, level);
    const X0 = (cx - W / 2 / ppx - bounds[0]) * k;
    const X1 = (cx + W / 2 / ppx - bounds[0]) * k;
    const Y0 = (cy - H / 2 / ppx - bounds[1]) * k;
    const Y1 = (cy + H / 2 / ppx - bounds[1]) * k;
    const out: { key: string; rect: Rect; dist: number }[] = [];
    const i0 = Math.max(0, Math.floor(X0 / TILE));
    const i1 = Math.min(nx - 1, Math.floor(Math.min(X1, lw - 1) / TILE));
    const j0 = Math.max(0, Math.floor(Y0 / TILE));
    const j1 = Math.min(ny - 1, Math.floor(Math.min(Y1, lh - 1) / TILE));
    const mx = (X0 + X1) / 2;
    const my = (Y0 + Y1) / 2;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const rect = tileRect(bounds, level, i, j);
        const dist = Math.hypot(rect[0] + rect[2] / 2 - mx, rect[1] + rect[3] / 2 - my);
        out.push({ key: `${level}:${i}:${j}`, rect, dist });
      }
    }
    return out.sort((a, b) => a.dist - b.dist);
  };

  const evict = (keep: Set<string>) => {
    while (tiles.size > TILE_CAP) {
      let oldest: Tile | null = null;
      for (const t of tiles.values()) if (!keep.has(t.key) && (!oldest || t.used < oldest.used)) oldest = t;
      if (!oldest) break;
      oldest.bitmap.close();
      tiles.delete(oldest.key);
    }
  };

  const pump = () => {
    // One bake at a time keeps the worker answering in order of need.
    if (inFlight.size > 0 || queued.length === 0) return;
    const next = queued.shift() as { key: string; level: Level; rect: Rect };
    inFlight.add(next.key);
    client.bake(next.level, next.rect, 'bitmap').then(r => {
      inFlight.delete(next.key);
      hook.bakes.tiles++;
      if (r.bitmap) {
        tiles.set(next.key, { key: next.key, level: next.level, rect: next.rect, bitmap: r.bitmap, used: ++useCounter });
        const want = new Set(visibleTiles(levelFor(ppx)).map(t => t.key));
        evict(want);
      }
      requestFrame();
      pump();
    }).catch((err: unknown) => {
      inFlight.delete(next.key);
      hook.error = err instanceof Error ? err.message : String(err);
      pump();
    });
  };

  /**
   * Ask the worker for the visible tiles that are missing, nearest the centre first, and
   * forget queued tiles the screen no longer shows. Called whenever the view changes, so
   * `tiles.pending` counts the work for the new view at once.
   */
  function refreshQueue(): void {
    if (!bounds || !level0Done) return;
    const level = levelFor(ppx);
    const visible = visibleTiles(level);
    const visibleKeys = new Set(visible.map(t => t.key));
    for (let i = queued.length - 1; i >= 0; i--) if (!visibleKeys.has((queued[i] as { key: string }).key)) queued.splice(i, 1);
    // Room for a new tile: under the cap, counting tiles that could be evicted (not on screen).
    const evictable = [...tiles.keys()].filter(k => !visibleKeys.has(k)).length;
    for (const t of visible) {
      if (tiles.has(t.key) || inFlight.has(t.key) || queued.some(q => q.key === t.key)) continue;
      if (tiles.size + queued.length + inFlight.size - evictable >= TILE_CAP) continue;
      queued.push({ key: t.key, level, rect: t.rect, dist: t.dist });
    }
    queued.sort((a, b) => a.dist - b.dist);
    pump();
  }

  const draw = () => {
    frameRequested = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!bounds || !level0Done) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    for (const c of level0) drawImageAt(c.bitmap, 0, c.rect);
    const level = levelFor(ppx);
    const visible = visibleTiles(level);
    for (const t of visible) {
      const tile = tiles.get(t.key);
      if (tile) {
        tile.used = ++useCounter;
        drawImageAt(tile.bitmap, level, tile.rect);
      }
    }
    refreshQueue();
    if (hook.visibleMs === null) {
      hook.visibleMs = performance.now();
      hook.ready = true;
    }
    if (hud) {
      hud.textContent = `${mapId}  ${ppx.toFixed(0)} px/h  level ${level} (${lpx[level]} px/h)  tiles ${tiles.size}/${TILE_CAP}${queued.length + inFlight.size > 0 ? ` (+${queued.length + inFlight.size})` : ''}` +
        `  build ${hook.timings.buildMs?.toFixed(0) ?? '-'} ms  bake ${hook.timings.level0BakeMs?.toFixed(0) ?? '-'} ms` +
        `${hook.visibleMs !== null ? `  visible ${hook.visibleMs.toFixed(0)} ms` : ''}${hook.hash ? `  ${hook.hash.slice(0, 12)}` : ''}`;
    }
  };

  function requestFrame(): void {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(draw);
  }

  // ---- input: drag pans, wheel zooms about the cursor ----
  let drag: { x: number; y: number; cx: number; cy: number } | null = null;
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, cx, cy };
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const dpr = window.devicePixelRatio || 1;
    cx = drag.cx - ((e.clientX - drag.x) * dpr) / ppx;
    cy = drag.cy - ((e.clientY - drag.y) * dpr) / ppx;
    refreshQueue();
    requestFrame();
  });
  const endDrag = () => {
    drag = null;
    canvas.style.cursor = 'grab';
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const dpr = window.devicePixelRatio || 1;
    const mx = e.clientX * dpr;
    const my = e.clientY * dpr;
    const wx = (mx - W / 2) / ppx + cx;
    const wy = (my - H / 2) / ppx + cy;
    const next = Math.min(MAX_PX_PER_HEX, Math.max(minPx, ppx * Math.exp(-e.deltaY * 0.0015)));
    cx = wx - (mx - W / 2) / next;
    cy = wy - (my - H / 2) / next;
    ppx = next;
    refreshQueue();
    requestFrame();
  }, { passive: false });
  window.addEventListener('resize', resize);
  resize();

  // ---- start: build the list in the worker, bake level 0, show it, then hash ----
  const start = async () => {
    const built = mapText !== null ? await client.buildText(mapText) : await client.buildMap(mapId);
    hook.builds++;
    hook.timings.buildMs = built.buildMs;
    bounds = built.bounds;
    lpx = built.levelPx;
    fitView();
    const t0 = performance.now();
    const chunks = level0Chunks(bounds);
    const baked = await Promise.all(chunks.map(rect => client.bake(0, rect, 'bitmap')));
    hook.timings.level0BakeMs = performance.now() - t0;
    level0 = baked.map(r => ({ rect: r.rect, bitmap: r.bitmap as ImageBitmap }));
    hook.bakes.level0 += baked.length;
    level0Done = true;
    requestFrame();
    const h = await client.hash();
    hook.hash = h.hash;
    hook.timings.hashMs = h.ms;
    requestFrame();
  };
  start().catch((err: unknown) => {
    hook.error = err instanceof Error ? err.message : String(err);
    root.append(document.createTextNode(`The map could not be shown: ${hook.error}`));
  });
}
