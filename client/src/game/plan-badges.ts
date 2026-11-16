/**
 * Where the briefing's small map (hud-full.ts) puts each objective's number: plain arithmetic, no browser, so that the
 * tests can hold it. Objectives two hexes apart or less no longer cover one another (the owner, 2026-11-14).
 */

/**
 * The small plan's measures, in the board's units (a row is one): an objective's marker (its hex grown), its number's
 * badge (a disc's radius and the number's size), how far beside its own hex a badge is put when the hex is crowded, and
 * the clear space kept round a badge.
 */
import { R } from '../../../engine/core/hex';

export const PLAN = { mark: 1.8, badge: 1.15, text: 1.55, beside: 2.35, clear: 0.15 } as const;

/**
 * Where each objective's badge goes (`centres`: the objectives' hexes, in their order): on its own hex where the badge
 * covers no badge placed before it and no other objective's marker; else the first place round it, `PLAN.beside` away
 * (above it first), that is so and lies on the plan; else, of those places, the one that covers least.
 */
export function placeBadges(centres: readonly (readonly [number, number])[], bounds: readonly [number, number, number, number]): [number, number][] {
  const placed: [number, number][] = [];
  const markR = PLAN.mark * R;
  const badgeGap = 2 * PLAN.badge + PLAN.clear;
  const markGap = PLAN.badge + markR + PLAN.clear;
  const turns = [-90, -30, -150, 30, 150, 90].map(d => (d * Math.PI) / 180);
  centres.forEach((c, k) => {
    const tries: [number, number][] = [[c[0], c[1]], ...turns.map((t): [number, number] => [c[0] + PLAN.beside * Math.cos(t), c[1] + PLAN.beside * Math.sin(t)])];
    const cost = (p: readonly [number, number]): number => {
      let n = 0;
      for (const q of placed) n += Math.max(0, badgeGap - Math.hypot(p[0] - q[0], p[1] - q[1]));
      centres.forEach((o, j) => {
        if (j !== k) n += Math.max(0, markGap - Math.hypot(p[0] - o[0], p[1] - o[1]));
      });
      return n;
    };
    const inside = (p: readonly [number, number]): boolean => p[0] - PLAN.badge >= bounds[0] - 0.3 && p[0] + PLAN.badge <= bounds[2] + 0.3 && p[1] - PLAN.badge >= bounds[1] - 0.3 && p[1] + PLAN.badge <= bounds[3] + 0.3;
    const clear = tries.find(p => inside(p) && cost(p) === 0);
    const least = tries.filter(inside).reduce<[number, number] | null>((b, p) => (b === null || cost(p) < cost(b) ? p : b), null);
    placed.push(clear ?? least ?? (tries[0] as [number, number]));
  });
  return placed;
}
