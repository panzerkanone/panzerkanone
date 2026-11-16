/**
 * Where everything on the title screen lies on the stage: plain arithmetic, no browser.
 *
 * The screen is laid out in stage pixels (stage.ts: the stage has the size of the owner's
 * painting, 2752 by 1536, and is fitted to the window as one thing). So every piece lies exactly
 * where he painted it, at every size of window: the layout is the index of the art
 * (manifest.ts), read off as boxes.
 */
import type { Piece, ShellArt } from './manifest';
import { PLAY } from './places';

/** The settings panel on the stage: its size in stage pixels (it stands in the stage's middle). */
export const PANEL = { width: 1460, height: 1010 } as const;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  /** The stage's own size. */
  width: number;
  height: number;
  title: Box;
  /** The menu's plates, top to bottom. */
  plates: Box[];
  /** The leather strip: across the whole stage, from its top line to the stage's foot. */
  strip: Box;
  /** The size of one tile of the strip. */
  stripTile: { w: number; h: number };
  nameplate: Box;
  panel: Box;
  /** The PLAY GAME medallion (its 2D cut's box), and where a press takes it, in that box's own pixels: the disc (a round, by its box), the big plate, the small plate. */
  play: Box;
  playHit: { disc: Box; plate: Box; tag: Box };
  /** The live medallion's canvas on the stage: the cut's box with room round it for its fire, down to the stage's foot. */
  playCanvas: Box;
}

const boxOf = (p: Piece): Box => ({ x: p.at[0], y: p.at[1], w: p.width, h: p.height });

/** The layout of the title screen, in stage pixels. */
export function layoutOf(art: ShellArt): Layout {
  const [width, height] = art.frame;
  // The plates are four cuts of one size; each line of the menu lies where the kit has it (the lit plate's place is the first line's).
  const places = [art.plateLit, ...art.platesDark.slice(1)];
  return {
    width,
    height,
    title: boxOf(art.title),
    plates: places.map(boxOf),
    strip: { x: 0, y: art.strip.at[1], w: width, h: height - art.strip.at[1] },
    stripTile: { w: art.strip.width, h: art.strip.height },
    nameplate: boxOf(art.nameplate),
    panel: { x: (width - PANEL.width) / 2, y: (height - PANEL.height) / 2, w: PANEL.width, h: PANEL.height },
    play: boxOf(art.play.rest),
    playCanvas: { x: art.play.rest.at[0] - PLAY.canvas.side, y: art.play.rest.at[1] - PLAY.canvas.above, w: art.play.rest.width + 2 * PLAY.canvas.side, h: height - (art.play.rest.at[1] - PLAY.canvas.above) },
    playHit: {
      disc: { x: PLAY.hit.disc[0] - PLAY.hit.disc[2], y: PLAY.hit.disc[1] - PLAY.hit.disc[2], w: 2 * PLAY.hit.disc[2], h: 2 * PLAY.hit.disc[2] },
      plate: { x: PLAY.hit.plate[0], y: PLAY.hit.plate[1], w: PLAY.hit.plate[2], h: PLAY.hit.plate[3] },
      tag: { x: PLAY.hit.tag[0], y: PLAY.hit.tag[1], w: PLAY.hit.tag[2], h: PLAY.hit.tag[3] },
    },
  };
}

const overlap = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a: Box, l: Layout): boolean => a.x >= 0 && a.y >= 0 && a.x + a.w <= l.width && a.y + a.h <= l.height;

/**
 * What is wrong with a layout, in words; nothing when it is sound: every piece on the stage, the
 * title clear of the menu, the menu clear of the nameplate, the plates one under another. (The
 * last plate lies over the strip, and the nameplate on it, as painted.)
 */
export function problemsOf(l: Layout): string[] {
  const out: string[] = [];
  const named: [string, Box][] = [['the title', l.title], ['the nameplate', l.nameplate], ['the panel', l.panel], ...l.plates.map((p, i): [string, Box] => [`plate ${i + 1}`, p])];
  for (const [name, box] of named) if (!inside(box, l)) out.push(`${name} runs off the stage`);
  for (const [i, p] of l.plates.entries()) {
    if (overlap(p, l.title)) out.push(`plate ${i + 1} lies over the title`);
    if (overlap(p, l.nameplate)) out.push(`plate ${i + 1} lies over the nameplate`);
    const next = l.plates[i + 1];
    // (The cuts take a pixel or two of each other's soft shadow.)
    if (next && p.y + p.h > next.y + 2) out.push(`plate ${i + 1} lies over plate ${i + 2}`);
  }
  if (overlap(l.title, l.nameplate)) out.push('the title lies over the nameplate');
  if (!inside(l.play, l)) out.push('the medallion runs off the stage');
  if (overlap(l.play, l.title)) out.push('the medallion lies over the title');
  // Every part a press takes lies inside the medallion's own box.
  const own: Layout = { ...l, width: l.play.w, height: l.play.h };
  for (const [name, b] of Object.entries(l.playHit)) if (!inside(b, own)) out.push(`the medallion's ${name} runs out of its box`);
  if (l.strip.y + l.strip.h !== l.height || l.strip.x !== 0 || l.strip.w !== l.width) out.push('the strip does not reach the edges');
  return out;
}
