/**
 * The unit art, for whoever shows a unit: the table's counters (their
 * silhouettes) and a game's unit card (picture, name, role, description).
 * Outside the scene and outside the game: the page's entry hands
 * `loadSilhouettes()` to the table, and a panel calls `unitArt(kind)`.
 *
 * Everything comes from assets/units/v1/, which `npm run unitart` writes:
 * cards.yaml and two pictures a type. The bundler turns each picture into an
 * address; only `loadSilhouettes()` fetches any (the card pictures are left
 * to whoever shows one).
 *
 * A type's silhouette is, in this order: a cell of the owner's own silhouette
 * sheets (`silhouetteFrom: 'drawn'`); else, in the dev server only, the
 * placeholder drawn from a third party's font where one exists
 * (assets/units/v1-placeholder/, git-ignored and absent from a fresh
 * checkout: a working set, at the owner's word of 2026-11-12, until the
 * project has its own); else the one reduced from the painted picture. A
 * build never holds a placeholder: the folder is only looked into when
 * `import.meta.env.DEV` is set.
 * `placeholders=0` in the address shows the build's own silhouettes in the dev
 * server too.
 */
import { parse } from 'yaml';
import cardsText from '../../../assets/units/v1/cards.yaml?raw';

/** What a unit card shows of one unit type. */
export interface UnitArt {
  /** The type's name as the roster gives it. */
  name: string;
  /** The short name its counter prints in the title band (at most ten characters). */
  counter: string;
  /** One line: what the counter stands for. */
  role: string;
  /** Two or three plain sentences from the type's facts file. */
  description: string;
  /** The address of the preview picture (clear ground, longest side 640 px), or null when the type has no picture. */
  card: string | null;
  /** The address of the flat silhouette (one ink on a clear ground, 256 px wide), or null. */
  silhouette: string | null;
  /** True when the preview picture shows something else than the type, used until it has one of its own; `shows` says what is pictured. */
  standIn: boolean;
  shows: string;
  /** Where the roster's silhouette came from: the owner's silhouette sheets, the painted picture, or the project's own making; null when there is none. */
  silhouetteFrom: 'drawn' | 'picture' | 'own' | null;
  /** What the roster's silhouette shows. */
  silhouetteShows: string;
  /** True when `silhouette` is the dev server's placeholder from the font, not the one made from the picture. */
  placeholder: boolean;
}

const pictures = import.meta.glob<string>('../../../assets/units/v1/*.png', { eager: true, query: '?url', import: 'default' });
// The dev server's working set. The condition is a constant the bundler knows: in a build this is an empty table.
const placeholders: Record<string, string> =
  import.meta.env.DEV && new URLSearchParams(window.location.search).get('placeholders') !== '0'
    ? import.meta.glob<string>('../../../assets/units/v1-placeholder/*.silhouette.png', { eager: true, query: '?url', import: 'default' })
    : {};

/** The table of addresses by file name ("pz4h.card.png"). */
function byName(table: Record<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [path, address] of Object.entries(table)) out.set(path.slice(path.lastIndexOf('/') + 1), address);
  return out;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
function text(v: unknown, where: string): string {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`unit cards: ${where} must be text`);
  return v;
}

/** Read cards.yaml strictly: a field that is missing or of the wrong kind is an error, never a default. */
function read(source: string): Map<string, UnitArt> {
  const root = parse(source) as unknown;
  if (!isRec(root) || root.format !== 'unit-cards/1' || !isRec(root.units)) throw new Error('unit cards: format must be unit-cards/1, with units');
  const cards = byName(pictures);
  const working = byName(placeholders);
  const out = new Map<string, UnitArt>();
  for (const [id, v] of Object.entries(root.units)) {
    if (!isRec(v)) throw new Error(`unit cards: ${id} must be a mapping`);
    const base = { name: text(v.name, `${id}.name`), counter: text(v.counter, `${id}.counter`), role: text(v.role, `${id}.role`), description: text(v.description, `${id}.description`) };
    if (v.picture === null) {
      out.set(id, { ...base, card: null, silhouette: null, standIn: false, shows: '', silhouetteFrom: null, silhouetteShows: '', placeholder: false });
      continue;
    }
    if (!isRec(v.picture)) throw new Error(`unit cards: ${id}.picture must be a mapping or null`);
    if (typeof v.picture.standIn !== 'boolean') throw new Error(`unit cards: ${id}.picture.standIn must be true or false`);
    const card = cards.get(text(v.picture.card, `${id}.picture.card`));
    const own = cards.get(text(v.picture.silhouette, `${id}.picture.silhouette`));
    if (card === undefined || own === undefined) throw new Error(`unit cards: a picture of ${id} is not in assets/units/v1/`);
    const from = v.picture.silhouetteFrom;
    if (from !== 'drawn' && from !== 'picture' && from !== 'own') throw new Error(`unit cards: ${id}.picture.silhouetteFrom must be drawn, picture or own`);
    // The placeholder stands in only for a silhouette reduced from a painted picture: one the owner drew as a silhouette comes first.
    const stand = from === 'picture' ? working.get(`${id}.silhouette.png`) : undefined;
    out.set(id, {
      ...base,
      card,
      silhouette: stand ?? own,
      standIn: v.picture.standIn,
      shows: text(v.picture.shows, `${id}.picture.shows`),
      silhouetteFrom: from,
      silhouetteShows: text(v.picture.silhouetteShows, `${id}.picture.silhouetteShows`),
      placeholder: stand !== undefined,
    });
  }
  return out;
}

let table: Map<string, UnitArt> | null = null;
const all = (): Map<string, UnitArt> => (table ??= read(cardsText));

/** The art and the words for one unit type (the roster's id, which a counter's face carries as its kind), or null when there is none. */
export function unitArt(kind: string): UnitArt | null {
  return all().get(kind) ?? null;
}

/** A silhouette fetched and decoded: what the table's counters print (the scene itself downloads nothing). */
export interface LoadedSilhouette {
  image: HTMLImageElement;
  width: number;
  height: number;
}

/**
 * Every unit type's silhouette, fetched and decoded off the page's thread, by unit type. Resolves when
 * all have arrived or failed; a type whose picture fails is left out, and its counters keep their plain
 * block. Never rejects.
 */
export function loadSilhouettes(): Promise<Map<string, LoadedSilhouette>> {
  let wanted: [string, string][];
  try {
    wanted = [...all()].flatMap(([id, art]): [string, string][] => (art.silhouette !== null ? [[id, art.silhouette]] : []));
  } catch (err) {
    console.error(err);
    return Promise.resolve(new Map());
  }
  return Promise.all(
    wanted.map(async ([id, address]): Promise<[string, LoadedSilhouette] | null> => {
      try {
        const image = new Image();
        image.src = address;
        await image.decode();
        return [id, { image, width: image.naturalWidth, height: image.naturalHeight }];
      } catch {
        return null;
      }
    }),
  ).then(loaded => new Map(loaded.filter((e): e is [string, LoadedSilhouette] => e !== null)));
}
