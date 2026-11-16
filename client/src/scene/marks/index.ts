/**
 * The hulks and craters (the advanced options Show hulks and Show craters), joined to the table. The page
 * (../table.ts) mounts them beside the counters, hands a game the counters' port through `port()` (which passes
 * every call through and listens to a few: listen.ts), calls `step` in its loop and `sync` before a frame, and
 * publishes `hook` on `window.__table.marks`.
 *
 * No rule reads a mark. The marks last to the end of the game. The pictures are handed in, decoded, by whoever
 * started the page (client/src/marksart: the scene loads none), when a kind is on: from the start, or the first time
 * one is switched on. Until they come (and if they never do) the marks are kept but not drawn, and the game plays the
 * same.
 */
import * as THREE from 'three';
import tableText from './data/marks.table.json?raw';
import type { PiecesPort } from '../pieces/port';
import { makeMarkAtlas } from './art';
import { MarksListener } from './listen';
import { MARK_LIST_TEXT } from './load';
import { MarksModel, parseMarkList, parseMarksTable } from './model';
import type { Mark, MarkLook, MarkOptions } from './model';
import { MarksView } from './view';

export type { MarkOptions } from './model';
export type { Scar } from './listen';

/** What a check reads of the marks (`window.__table.marks`). */
export interface MarksHook {
  /** Whether the pictures have arrived (until they do, nothing is drawn; marks laid meanwhile wait for them). */
  readonly ready: boolean;
  /** The options as they stand. */
  readonly options: MarkOptions;
  /** Every mark that lies on the table, shown or not, in the order laid, with how far its kind is shown (0 to 1) and its outline as it lies. */
  readonly marks: readonly (Mark & { shown: number; corners: [number, number][] })[];
  /** The game's seed the marks are laid by. */
  readonly seed: number | null;
  /** Switch a kind on or off (the settings' Show hulks and Show craters): its marks go, or come back, at once. */
  set(options: Partial<MarkOptions>): void;
  /**
   * For checks and pictures only: lay this picture on this hex now, as a game's hulk or crater is laid (seeded by the
   * game's seed and `key`). Returns whether it was laid. A game never calls it.
   */
  place(picture: string, hex: number, key: string): boolean;
  /** How each kind is printed into the board, as it stands (the table of marks' `look`, or what a check set). */
  readonly look: Readonly<Record<'hulk' | 'crater', MarkLook>>;
  /** For checks and pictures only: try another look (each kind's numbers given replace those it had). A game never calls it. */
  setLook(look: { hulk?: Partial<MarkLook>; crater?: Partial<MarkLook> }): void;
}

export interface MarksMount {
  object: THREE.Object3D;
  hook: MarksHook;
  /** The counters' port with the marks listening (every member passes through, those the marks never heard of too). */
  port<P extends PiecesPort>(port: P): P;
  /** One pass of the page's loop. True while a mark is still easing in or out, or a crater is due. */
  step(): boolean;
  sync(): void;
  restore(): void;
}

export function mountMarks(o: {
  shared: Record<string, { value: unknown }>;
  maxAnisotropy: number;
  centreOf: (hex: number) => readonly [number, number];
  /** Fetches the pictures, decoded, by their files' names (null when they failed); called once, when one is first wanted. Left out: the marks are kept and never drawn. */
  art?: (() => Promise<ReadonlyMap<string, CanvasImageSource> | null>) | undefined;
  /** Which kinds show from the start (the address's `hulks=0`, `craters=0`). */
  options: MarkOptions;
  wake: () => void;
}): MarksMount {
  const pictures = parseMarkList(MARK_LIST_TEXT);
  const model = new MarksModel(parseMarksTable(tableText, pictures), pictures, o.centreOf);
  const start = performance.now();
  const listener = new MarksListener(model, pictures, o.options, () => (performance.now() - start) / 1000, o.wake);
  const group = new THREE.Group();
  let view: MarksView | null = null;
  let asked = false;
  const fetchArt = (): void => {
    if (asked || !o.art) return;
    asked = true;
    void o.art().then(
      images => {
        if (!images) return;
        view = new MarksView(model, makeMarkAtlas(pictures, images), o.shared, { maxAnisotropy: o.maxAnisotropy });
        view.setLook(look);
        group.add(view.group);
        o.wake();
      },
      (err: unknown) => console.error(err),
    );
  };
  // The pictures are fetched when a kind is on from the start, or the first time one is switched on.
  if (o.options.hulks || o.options.craters) fetchArt();

  let look: Record<'hulk' | 'crater', MarkLook> = { hulk: { ...model.table.look.hulk }, crater: { ...model.table.look.crater } };
  const hook: MarksHook = {
    get ready() {
      return view !== null;
    },
    get options() {
      return { ...model.options };
    },
    get marks() {
      return model.marks.map(m => ({ ...m, shown: m.kind === 'hulk' ? listener.shown.hulks : listener.shown.craters, corners: view ? view.cornersOf(m) : [] }));
    },
    get seed() {
      return listener.seed;
    },
    set(options) {
      listener.set(options);
      if (model.options.hulks || model.options.craters) fetchArt();
    },
    place: (picture, hex, key) => listener.place(picture, hex, key),
    get look() {
      return { hulk: { ...look.hulk }, crater: { ...look.crater } };
    },
    setLook(next) {
      look = { hulk: { ...look.hulk, ...next.hulk }, crater: { ...look.crater, ...next.crater } };
      view?.setLook(look);
      o.wake();
    },
  };

  return {
    object: group,
    hook,
    port: real => listener.port(real),
    step: () => listener.step(),
    sync: () => view?.sync(listener.now, listener.shown),
    restore: () => view?.restore(),
  };
}
