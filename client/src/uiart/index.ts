/**
 * The interface skin: the pieces of the look the owner approved (steel
 * buttons and plates, torn paper, the leather notebook with its silk ribbons,
 * the manila folder, the dossier, stamps, the sides' marks, the scenario's
 * key art), kept in assets/ui/v1/ with an entry each in the attribution
 * ledger (assets/LEDGER.yaml). Outside the game: the page's entry makes the
 * skin here and hands it to the game's panel, which holds no art of its own
 * and is complete without it.
 *
 * The bundler turns each picture into an address. Nothing is fetched here:
 * the stylesheet names the addresses and the browser fetches what is shown.
 *
 * `skin=0` in the address is the page's to read (main.tsx): it then hands no
 * skin, and the panel keeps its grey-box. `edges=0` leaves out the few pixels
 * of soft edge the look gives each floating part.
 */
import type { PanelSkin } from '../game/hud';
import { SKIN_SPRITES, skinCss } from './skin-css';
import type { SkinSprite } from './skin-css';

const files = import.meta.glob<string>(['../../../assets/ui/v1/*.png', '../../../assets/ui/v1/*.webp'], { eager: true, query: '?url', import: 'default' });

/** The addresses by file name without its ending ("k-wide-normal"). */
function byName(table: Record<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [path, address] of Object.entries(table)) {
    const file = path.slice(path.lastIndexOf('/') + 1);
    out.set(file.slice(0, file.lastIndexOf('.')), address);
  }
  return out;
}

/**
 * The picture of each mark, by the mark's id (a scenario's briefing names a side's mark): on the status plate,
 * and on a force's header in the briefing. The German mark is the black cross; the Soviet mark is the hammer and
 * sickle, and the red star medal on the briefing's header. No other national symbol is in the set.
 */
export const MARK_PICTURES: Readonly<Record<string, { plate: string; header: string }>> = {
  cross: { plate: 'emblem-cross', header: 'emblem-cross' },
  'hammer-sickle': { plate: 'emblem-hammer-sickle', header: 'p2-star-medal' },
};

/** The pictures a scenario may name (its briefing's `picture`), by id. */
export const SCENARIO_PICTURES: readonly string[] = ['keyart-holtargard'];

/** Every file of assets/ui/v1/ the skin uses, by name without ending: the stylesheet's sprites, the marks, the scenarios' pictures. */
export function skinFiles(): string[] {
  return [...new Set<string>([...SKIN_SPRITES, ...Object.values(MARK_PICTURES).flatMap(m => [m.plate, m.header]), ...SCENARIO_PICTURES])].sort();
}

let made: PanelSkin | null = null;

/** The skin, made once. A sprite the stylesheet names that is not in the folder is an error, never a blank. */
export function panelSkin(): PanelSkin {
  if (made) return made;
  const addresses = byName(files);
  const address = (name: string): string => {
    const a = addresses.get(name);
    if (a === undefined) throw new Error(`interface skin: assets/ui/v1/ has no picture '${name}'`);
    return a;
  };
  for (const name of skinFiles()) address(name);
  const edges = new URLSearchParams(window.location.search).get('edges') !== '0';
  made = {
    css: skinCss((name: SkinSprite) => address(name), { edges }),
    mark(id: string, where: 'plate' | 'header'): string | null {
      const m = MARK_PICTURES[id];
      return m ? address(m[where]) : null;
    },
    picture(id: string): string | null {
      return SCENARIO_PICTURES.includes(id) ? address(id) : null;
    },
  };
  return made;
}
