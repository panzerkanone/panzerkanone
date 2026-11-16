/**
 * Every attack's chance at once (the reach audit's second job, 2026-11-14). The computer weighs every listed attack
 * exactly; a person was shown one at a time, by pointing at each target. So while units are chosen to fire (or, in
 * the mode of closing with the enemy, C, to go in), each enemy a click would attack carries a label on the table: the chance that
 * the attack has any effect, as the odds print it ("62%"), and under it the chance that it destroys, when it can.
 * The best of them stands out a little. Pointing at a target still shows the whole odds, as before.
 *
 * The figures are the reading's own: the forecast of exactly the action a click on that target would send (the same
 * forecast the panel's line and the odds page read), in the one rule for writing a chance (model.ts `percentOf`).
 * Nothing is reckoned here but which label is the best.
 */
import { percentOf } from './model';
import type { Forecast } from './reading';

/** One label: the enemy it is for, where that enemy stands, its two figures, and whether it is the best. */
export interface ChanceLabel {
  /** The enemy unit (its counter's id). */
  readonly unit: string;
  readonly hex: number;
  /** The chance of any effect (to suppress or destroy), as a label prints it: "62%", "<1%", ">99%". */
  readonly chance: string;
  /** The chance to destroy, the same way; '' when the attack cannot destroy. */
  readonly kill: string;
  /** It is the best attack of those labelled (the highest chance of any effect; of equals, the highest to destroy). Never set when all are alike. */
  readonly best: boolean;
  /**
   * The keys of the other ways the target could be attacked besides the click's own ("C": a charge; "V": a drive through
   * its hex), for a small mark on the card. Absent: none.
   */
  readonly also?: string;
}

/** A chance in the odds' own words, made short for a label: "under 1%" is "<1%", "over 99%" is ">99%". */
export function shortChance(words: string): string {
  return words.replace(/^under /, '<').replace(/^over /, '>');
}

/**
 * The labels for these targets. `forecast` is the reading's forecast of the action a click on the target would send
 * (null where there is none: no label). Labels keep the order of the targets.
 */
export function chanceLabels(targets: readonly { readonly unit: string; readonly hex: number; readonly forecast: Forecast | null; readonly also?: string }[]): ChanceLabel[] {
  const rows: { unit: string; hex: number; ways: number; kill: number; of: number; also: string }[] = [];
  for (const t of targets) {
    const c = t.forecast?.chance;
    if (!c || c.of <= 0 || t.hex < 0) continue;
    rows.push({ unit: t.unit, hex: t.hex, ways: c.ways, kill: c.kill, of: c.of, also: t.also ?? '' });
  }
  // The best: the highest share of any effect; of equals, the highest share to destroy. Compared as fractions, exactly.
  const better = (a: typeof rows[number], b: typeof rows[number]): number => a.ways * b.of - b.ways * a.of || a.kill * b.of - b.kill * a.of;
  let top: typeof rows[number] | null = null;
  for (const r of rows) if (top === null || better(r, top) > 0) top = r;
  const alike = top !== null && rows.every(r => better(r, top as typeof rows[number]) === 0);
  return rows.map(r => ({
    unit: r.unit,
    hex: r.hex,
    chance: shortChance(percentOf(r.ways, r.of)),
    kill: r.kill > 0 ? shortChance(percentOf(r.kill, r.of)) : '',
    best: !alike && top !== null && better(r, top) === 0,
    ...(r.also !== '' ? { also: r.also } : {}),
  }));
}
