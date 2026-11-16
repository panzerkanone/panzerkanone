/**
 * The bake worker: builds the display list (the same mapart code Node runs)
 * and bakes rectangles of it with Canvas 2D on OffscreenCanvas. Nothing here
 * blocks the page, and nothing is fetched but the code and its data modules:
 * no image file, no font.
 */
import { parseMap, seasonOf } from '@engine/core/map';
import { buildMapArtFull, listHash, loadArtData, seasonArt, sightLinesOf, validateDisplayList } from '@mapart/index';
import type { ArtData } from '@mapart/params';
import type { DisplayList } from '@mapart/displayList';
import paramsText from '@mapart/data/params.yaml?raw';
import inksText from '@mapart/data/inks-a2.yaml?raw';
import glyphsText from '@mapart/data/lettering/board-lettering.json?raw';
import winterParamsText from '@mapart/data/params-winter.yaml?raw';
import winterInksText from '@mapart/data/inks-winter.yaml?raw';
import { BakeCanvases, Prepared, bakeRect, makeCanvases, prepare } from './raster';
import { MAX_SIDE, Reply, Request, Sheet, SightLines, levelPx } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

/** Map descriptions under assets/maps, loaded only when asked for. */
const MAP_FILES = import.meta.glob('../../../assets/maps/*.map.yaml', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;

let art: ArtData | null = null;
let current: { list: DisplayList; prep: Prepared } | null = null;
let hash: string | null = null;
let canvases: BakeCanvases | null = null;

function artData(): ArtData {
  if (art) return art;
  const loaded = loadArtData({ params: paramsText, inks: inksText, glyphs: glyphsText, winter: { params: winterParamsText, inks: winterInksText } });
  if (!loaded.value) throw new Error(`the art data does not load: ${loaded.problems.slice(0, 5).join('; ')}`);
  art = loaded.value;
  return art;
}

function reply(msg: Reply, transfer: Transferable[] = []): void {
  self.postMessage(msg, transfer);
}

/** The lines that bar sight on the map last built. */
let sightLines: SightLines[] = [];
/** What the table prints of the sheet of the map last built, in that map's season; summer's for a list given whole. */
let sheet: Sheet | null = null;

/** #RRGGBB as sRGB 0..255. */
function rgbOf(ink: string): [number, number, number] {
  const v = Number.parseInt(ink.slice(1), 16);
  return [Math.floor(v / 65536) % 256, Math.floor(v / 256) % 256, v % 256];
}

/** The sheet of a season's ink table: its margin, and the key plate's ink (the grid and hex numbers). */
function sheetOf(inks: { margin: string; plates: { id: string; ink: string }[] }): Sheet {
  const key = inks.plates.find(p => p.id === 'key');
  if (!key) throw new Error('the ink table has no key plate');
  return { margin: rgbOf(inks.margin), key: rgbOf(key.ink) };
}

function setList(list: DisplayList): void {
  current = { list, prep: prepare(list) };
  hash = null;
}

function buildFromText(text: string, drawn: boolean | undefined): number {
  const loaded = parseMap(text);
  if (!loaded.map) throw new Error(`the map does not load: ${loaded.problems.slice(0, 5).join('; ')}`);
  const t0 = performance.now();
  const built = buildMapArtFull(loaded.map, artData(), drawn === false ? { treeSideLines: false } : {});
  const ms = performance.now() - t0;
  setList(built.list);
  sightLines = sightLinesOf(built.ctx, artData());
  sheet = sheetOf(seasonArt(artData(), seasonOf(loaded.map)).inks);
  return ms;
}

function builtReply(id: number, buildMs: number): Reply {
  const list = (current as { list: DisplayList }).list;
  return {
    id, kind: 'built', bounds: [list.bounds[0], list.bounds[1], list.bounds[2], list.bounds[3]],
    levelPx: [levelPx(list.bounds, 0), levelPx(list.bounds, 1), levelPx(list.bounds, 2)], ops: list.ops.length, buildMs,
    sightLines: sightLines.map(c => ({ kind: c.kind, ink: [c.ink[0], c.ink[1], c.ink[2]], width: c.width, sides: c.sides.slice() })),
    sheet: sheet ?? sheetOf(artData().inks),
  };
}

async function handle(req: Request): Promise<void> {
  switch (req.kind) {
    case 'build-map': {
      const key = Object.keys(MAP_FILES).find(k => k.endsWith(`/${req.mapId}.map.yaml`));
      if (!key) throw new Error(`no map called ${req.mapId} under assets/maps`);
      const text = await (MAP_FILES[key] as () => Promise<string>)();
      reply(builtReply(req.id, buildFromText(text, req.sightLines)));
      return;
    }
    case 'build-text':
      reply(builtReply(req.id, buildFromText(req.mapText, req.sightLines)));
      return;
    case 'list': {
      const raw: unknown = JSON.parse(req.listText);
      const problems = validateDisplayList(raw);
      if (problems.length > 0) throw new Error(`the display list is not well formed: ${problems.slice(0, 5).join('; ')}`);
      setList(raw as DisplayList);
      sightLines = [];
      sheet = null;
      reply(builtReply(req.id, 0));
      return;
    }
    case 'hash': {
      if (!current) throw new Error('no display list yet');
      const t0 = performance.now();
      if (!hash) hash = listHash(current.list);
      reply({ id: req.id, kind: 'hash', hash, ms: performance.now() - t0 });
      return;
    }
    case 'bake': {
      if (!current) throw new Error('no display list yet');
      const [x, y, w, h] = req.rect;
      if (!(w > 0 && h > 0) || w > MAX_SIDE || h > MAX_SIDE || !Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(w) || !Number.isInteger(h)) {
        throw new Error(`a bake is a whole-pixel rectangle no larger than ${MAX_SIDE} px on a side, got ${w} x ${h} at ${x}, ${y}`);
      }
      if (!canvases) canvases = makeCanvases();
      const t0 = performance.now();
      const image = bakeRect(current.prep, levelPx(current.list.bounds, req.level), { x, y, w, h }, canvases, req.extraBreaks === true);
      const drawMs = performance.now() - t0;
      if (req.format === 'png') {
        const blob = await image.convertToBlob({ type: 'image/png' });
        const png = await blob.arrayBuffer();
        reply({ id: req.id, kind: 'baked', level: req.level, rect: req.rect, ms: performance.now() - t0, drawMs, png }, [png]);
      } else {
        const bitmap = image.transferToImageBitmap();
        reply({ id: req.id, kind: 'baked', level: req.level, rect: req.rect, ms: performance.now() - t0, drawMs, bitmap }, [bitmap]);
      }
      return;
    }
  }
}

self.onmessage = (e: MessageEvent<Request>) => {
  const req = e.data;
  handle(req).catch((err: unknown) => {
    reply({ id: req.id, kind: 'error', message: err instanceof Error ? err.message : String(err) });
  });
};
