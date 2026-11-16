/**
 * The panel's and the bench's colours come from the board's own ink table, read here as text, so that no
 * colour is written in this folder. Each plate becomes a CSS custom property on an element: --ink-ground,
 * --ink-relief, --ink-straw, --ink-green, --ink-blue, --ink-red, --ink-brown, --ink-key (and --ink-olive, and
 * on a winter board --ink-shade). Everything else is mixed from those in CSS.
 *
 * The inks follow the board's season, as the board's own print does: a summer board's are ink table A2
 * (mapart/data/inks-a2.yaml); a winter board's are A2 with the winter transform made (mapart/seasonInks.ts,
 * mapart/data/inks-winter.yaml), the very inks the bake prints the winter board in. Whoever loads a board says
 * its season once (`setBoardSeason`); every element given to `setInks`, before or after, then carries that
 * season's inks. Until a season is said, the inks are summer's, as they always were.
 */
import { parse } from 'yaml';
import inksText from '@mapart/data/inks-a2.yaml?raw';
import winterInksText from '@mapart/data/inks-winter.yaml?raw';
import { parseInks } from '@mapart/params';
import { deriveSeasonInks, validateSeasonInks } from '@mapart/seasonInks';

/** The seasons a board is printed for (engine/core/map.ts). */
export type InkSeason = 'summer' | 'winter';

const tables = new Map<InkSeason, { id: string; ink: string }[]>();

/** The plates of a season's ink table: id and ink. */
export function inkPlates(season: InkSeason = 'summer'): { id: string; ink: string }[] {
  const known = tables.get(season);
  if (known) return known;
  const summer = parseInks(inksText);
  if (!summer.value) throw new Error(`the ink table does not load: ${summer.problems.join('; ')}`);
  let table = summer.value;
  if (season === 'winter') {
    const spec = validateSeasonInks(parse(winterInksText));
    const winter = spec.value ? deriveSeasonInks(table, spec.value) : null;
    if (!winter?.value) throw new Error(`the winter ink table does not load: ${[...spec.problems, ...(winter?.problems ?? [])].join('; ')}`);
    table = winter.value;
  }
  const out = [...table.plates, ...table.extraPlates].map(p => ({ id: p.id, ink: p.ink }));
  if (out.length === 0) throw new Error('the ink table has no plates');
  tables.set(season, out);
  return out;
}

let boardSeason: InkSeason = 'summer';
/** The elements that carry the inks, so that a change of season reaches them. */
const inked = new Set<WeakRef<HTMLElement>>();

function paint(el: HTMLElement, season: InkSeason): void {
  for (const p of inkPlates(season)) el.style.setProperty(`--ink-${p.id}`, p.ink);
  // A plate only one season has (winter's shade) is taken off in the other.
  for (const id of ['shade']) if (!inkPlates(season).some(p => p.id === id)) el.style.removeProperty(`--ink-${id}`);
}

/** Put the inks of the board's season on an element as custom properties; it follows the season from now on. */
export function setInks(el: HTMLElement): void {
  inked.add(new WeakRef(el));
  paint(el, boardSeason);
}

/** The board now on the table is printed for this season: every inked element takes its inks. */
export function setBoardSeason(season: InkSeason): void {
  boardSeason = season;
  for (const ref of [...inked]) {
    const el = ref.deref();
    if (el) paint(el, season);
    else inked.delete(ref);
  }
}

/** The season whose inks the elements carry now. */
export function inkSeason(): InkSeason {
  return boardSeason;
}
