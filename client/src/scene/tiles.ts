/**
 * The baked map on the GPU: level 0 of the whole board, always held, and a
 * bounded store of sharper tiles baked on demand by the 3a worker.
 *
 * The level and the tiles a view needs come from levels.ts. Needed tiles are
 * asked of the worker nearest the middle of the view first, one at a time; a
 * tile that arrives is uploaded with its mip levels and laid on the board. The
 * store never holds more than its cap: before a tile goes in, the tiles used
 * longest ago that the view does not need come out. Only tiles of the level the
 * view asks for are drawn, with level 1 under them while level 2 is still
 * coming, and level 0 under everything, so the board is never blank.
 *
 * After a lost context every texture is gone. The display list is still in the
 * worker: level 0 is baked again, then every tile that was held.
 */
import * as THREE from 'three';
import type { BakeClient } from '../bake/client';
import { MAX_SIDE, level0Chunks } from '../bake/protocol';
import type { Rect as PixelRect } from '../bake/protocol';
import type { Rect } from './layout';
import { CAP_MEGAPIXELS, GUTTER, parseTileKey, tilePixelsWithGutter, tileRect } from './levels';
import type { Level, LevelChoice } from './levels';
import { mippedBytes } from './surfaces';
import type { World } from './world';

interface Held {
  key: string;
  level: Level;
  texture: THREE.Texture;
  mesh: THREE.Mesh;
  pixels: number;
  bytes: number;
  used: number;
}

interface Wanted {
  key: string;
  dist: number;
}

export class TileStore {
  readonly bakes = { level0: 0, tiles: 0 };
  level0Ready = false;
  /** Level-0 pixels held. */
  level0Pixels = 0;
  /** Time the last level-0 bake took, and the last tile from asking to showing, in ms. */
  level0Ms: number | null = null;
  lastTileMs: number | null = null;
  private level0: { texture: THREE.Texture; mesh: THREE.Mesh; bytes: number }[] = [];
  private readonly tiles = new Map<string, Held>();
  private queue: Wanted[] = [];
  private inFlight: string | null = null;
  private need = new Set<string>();
  private level: Level = 0;
  private shown: string[] = [];
  private useCounter = 0;
  /** Goes up at every lost context: an answer from the worker for an older one is thrown away. */
  private generation = 0;
  private lost = false;
  /** Tiles held when the context was lost, most recently used first: baked again after the restore. */
  private restoreList: string[] = [];

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly client: BakeClient,
    private readonly world: World,
    private readonly board: Rect,
    private readonly densities: readonly [number, number, number],
    private readonly maxAnisotropy: number,
    /** Called when what is on the board changed and a frame is wanted. */
    private readonly changed: () => void,
    private readonly failed: (message: string) => void,
  ) {}

  private makeTexture(bitmap: ImageBitmap): THREE.Texture {
    const t = new THREE.Texture(bitmap);
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false;
    t.premultiplyAlpha = false;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = this.maxAnisotropy;
    t.needsUpdate = true;
    // Upload now, with its mip levels, so that the frame that first shows it pays nothing.
    this.renderer.initTexture(t);
    return t;
  }

  /** Bake level 0 and lay it on the board. Resolves when it is on the GPU. */
  async loadLevel0(): Promise<void> {
    const generation = this.generation;
    const t0 = performance.now();
    const ppx = this.densities[0];
    const chunks = level0Chunks(this.board);
    const [lw, lh] = chunks.reduce<[number, number]>((acc, c) => [Math.max(acc[0], c[0] + c[2]), Math.max(acc[1], c[1] + c[3])], [0, 0]);
    // Each chunk is baked with a gutter where there is room, as a tile is.
    const rects = chunks.map((c): PixelRect => {
      const x0 = Math.max(0, c[0] - GUTTER);
      const y0 = Math.max(0, c[1] - GUTTER);
      const x1 = Math.min(lw, c[0] + c[2] + GUTTER);
      const y1 = Math.min(lh, c[1] + c[3] + GUTTER);
      return x1 - x0 <= MAX_SIDE && y1 - y0 <= MAX_SIDE ? [x0, y0, x1 - x0, y1 - y0] : c;
    });
    this.bakes.level0 += rects.length;
    const baked = await Promise.all(rects.map(r => this.client.bake(0, r, 'bitmap')));
    if (generation !== this.generation || this.lost) {
      for (const b of baked) b.bitmap?.close();
      return;
    }
    this.dropLevel0();
    let pixels = 0;
    baked.forEach((b, k) => {
      const bitmap = b.bitmap as ImageBitmap;
      const texel = rects[k] as PixelRect;
      const c = chunks[k] as PixelRect;
      const texture = this.makeTexture(bitmap);
      bitmap.close();
      const ground: Rect = [
        this.board[0] + c[0] / ppx,
        this.board[1] + c[1] / ppx,
        Math.min(this.board[2], this.board[0] + (c[0] + c[2]) / ppx),
        Math.min(this.board[3], this.board[1] + (c[1] + c[3]) / ppx),
      ];
      const mesh = this.world.addArt(0, ground, texture, texel, ppx);
      this.level0.push({ texture, mesh, bytes: mippedBytes(texel[2], texel[3], 4) });
      pixels += texel[2] * texel[3];
    });
    this.level0Pixels = pixels;
    this.level0Ready = true;
    this.level0Ms = performance.now() - t0;
    this.changed();
    this.pump();
  }

  private dropLevel0(): void {
    for (const c of this.level0) {
      this.world.removeArt(c.mesh);
      c.texture.dispose();
    }
    this.level0 = [];
    this.level0Ready = false;
    this.level0Pixels = 0;
  }

  /** The megapixels the tiles hold (level 0 is counted apart). */
  residentMegapixels(): number {
    let p = 0;
    for (const t of this.tiles.values()) p += t.pixels;
    return p / 1e6;
  }

  residentKeys(): string[] {
    return [...this.tiles.keys()];
  }

  shownKeys(): string[] {
    return this.shown.slice();
  }

  pending(): number {
    return this.queue.length + (this.inFlight !== null ? 1 : 0) + (this.level0Ready ? 0 : 1);
  }

  currentLevel(): Level {
    return this.level;
  }

  textureCount(): number {
    return this.level0.length + this.tiles.size;
  }

  textureBytes(): number {
    let b = 0;
    for (const c of this.level0) b += c.bytes;
    for (const t of this.tiles.values()) b += t.bytes;
    return b;
  }

  /**
   * Tell the store what the view needs: called whenever the view changes, so that
   * `pending` counts the work for the new view at once. `centre` is the middle of
   * the view on the board.
   */
  want(choice: LevelChoice, centre: readonly [number, number]): void {
    this.level = choice.level;
    this.need = new Set(choice.need);
    const ppx = this.densities[choice.level];
    const wanted: Wanted[] = [];
    for (const key of choice.need) {
      if (this.tiles.has(key) || this.inFlight === key) continue;
      const { i, j } = parseTileKey(key);
      const r = tileRect(this.board, ppx, i, j);
      wanted.push({ key, dist: Math.hypot((r[0] + r[2]) / 2 - centre[0], (r[1] + r[3]) / 2 - centre[1]) });
    }
    wanted.sort((a, b) => a.dist - b.dist);
    // After a restore, the tiles that were held come back too, after what the view needs.
    const extra = this.restoreList.filter(k => !this.need.has(k) && !this.tiles.has(k) && this.inFlight !== k);
    this.queue = [...wanted, ...extra.map(key => ({ key, dist: Infinity }))];
    this.updateVisible();
    this.pump();
  }

  /** Mark what the next frame draws: tiles of the level asked for, and level 1 under level 2 while that is coming. */
  private updateVisible(): void {
    const shown: string[] = [];
    let missing = false;
    for (const key of this.need) if (!this.tiles.has(key)) missing = true;
    for (const t of this.tiles.values()) {
      const on = this.need.has(t.key) || (this.level === 2 && t.level === 1 && missing);
      t.mesh.visible = on;
      if (on) {
        shown.push(t.key);
        t.used = ++this.useCounter;
      }
    }
    this.shown = shown;
  }

  /** Called at each frame: the tiles in view count as used now. */
  touch(): void {
    for (const key of this.shown) {
      const t = this.tiles.get(key);
      if (t) t.used = ++this.useCounter;
    }
  }

  private pump(): void {
    if (this.lost || !this.level0Ready || this.inFlight !== null) return;
    const next = this.queue.shift();
    if (!next) return;
    const { level, i, j } = parseTileKey(next.key);
    const ppx = this.densities[level];
    const texel = tilePixelsWithGutter(this.board, ppx, i, j);
    const generation = this.generation;
    const asked = performance.now();
    this.inFlight = next.key;
    this.bakes.tiles++;
    this.client.bake(level, texel, 'bitmap').then(
      reply => {
        this.inFlight = null;
        const bitmap = reply.bitmap;
        if (!bitmap) return;
        const stillWanted = this.need.has(next.key) || this.restoreList.includes(next.key);
        // Baked once after a restore, whether or not there is room for it now.
        this.restoreList = this.restoreList.filter(k => k !== next.key);
        if (generation !== this.generation || this.lost || !stillWanted || !this.makeRoom(texel[2] * texel[3], next.key)) {
          bitmap.close();
        } else {
          const texture = this.makeTexture(bitmap);
          bitmap.close();
          const mesh = this.world.addArt(level, tileRect(this.board, ppx, i, j), texture, texel, ppx);
          mesh.visible = false;
          this.tiles.set(next.key, { key: next.key, level, texture, mesh, pixels: texel[2] * texel[3], bytes: mippedBytes(texel[2], texel[3], 4), used: this.need.has(next.key) ? ++this.useCounter : 0 });
          this.lastTileMs = performance.now() - asked;
          this.updateVisible();
          this.changed();
        }
        this.pump();
      },
      (err: unknown) => {
        this.inFlight = null;
        this.failed(err instanceof Error ? err.message : String(err));
        this.pump();
      },
    );
  }

  /** Make room for a tile of this many pixels; false when the view's own tiles leave none. */
  private makeRoom(pixels: number, forKey: string): boolean {
    const cap = CAP_MEGAPIXELS * 1e6;
    let held = 0;
    for (const t of this.tiles.values()) held += t.pixels;
    while (held + pixels > cap + 0.5) {
      let oldest: Held | null = null;
      for (const t of this.tiles.values()) {
        if (this.need.has(t.key)) continue;
        if (!oldest || t.used < oldest.used) oldest = t;
      }
      // A tile the view does not need gives way to one it does; a tile baked again after a restore never pushes one out.
      if (!oldest || !this.need.has(forKey)) return false;
      held -= oldest.pixels;
      this.drop(oldest);
    }
    return true;
  }

  private drop(t: Held): void {
    this.world.removeArt(t.mesh);
    t.texture.dispose();
    this.tiles.delete(t.key);
  }

  /** The context is gone: every texture with it. Remember what was held. */
  contextLost(): void {
    this.lost = true;
    this.generation++;
    const held = [...this.tiles.values()].sort((a, b) => b.used - a.used).map(t => t.key);
    this.restoreList = [...held, ...this.restoreList.filter(k => !held.includes(k))];
    for (const t of [...this.tiles.values()]) this.drop(t);
    this.dropLevel0();
    this.queue = [];
    this.shown = [];
  }

  /** The context is back: bake level 0 again; the tiles follow as the view asks. */
  contextRestored(): Promise<void> {
    this.lost = false;
    return this.loadLevel0();
  }
}
