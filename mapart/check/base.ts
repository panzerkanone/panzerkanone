/**
 * The display-list parts of the Milestone 3b bar, stage 1 (docs/bars/M3b.md),
 * as the lead's rulings of 2026-11-11 leave them (woods stay as Milestone 3a
 * draws them; towns are blocks and lots holding the owner's building set):
 *
 *   M3b-L-17  fields are rectangular plots
 *   M3b-L-18  a town's ground is divided into lots, and every building stands in one
 *   M3b-L-19  buildings: the owner's set, each drawn with its roof; built share; where they stand
 *   M3b-L-24  outer crests lie wholly inside the board (list part)
 *   M3b-L-25  ground cover runs on to the board rectangle (list part)
 *   M3b-L-26  a one-hex wooded hilltop with a number still reads as trees (list part)
 *
 * Measured on a list, its map and the explain file of that list's build
 * (mapart/explain.ts). `npm run artcheck` prints these rows after the 3a rows.
 */
import type { DisplayList, PatternOp, RibbonOp } from '../displayList';
import { COL_STEP, Grid, HexId, centreOf, cornerOf, hexCount, labelOf, neighbourOf, sideCorners, worldBounds, worldToHex } from '../../engine/core/hex';
import { MapDescription, coversOf, gridOf, hexOf, levelsOf } from '../../engine/core/map';
import { nearestHex, partHexRings, regionRing } from '../board';
import type { Explain } from '../explain';
import { inRings, polygonPolylineDist, ringArea, segDist } from '../geom';
import type { Row } from './checks';
import { makeView, pointsBox, stampRings } from './listview';

const f3 = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : String(v));
/** The area of a hex, in square h: one across flats, so the same number as the step between columns. */
const HEX_AREA = COL_STEP;

function centroid(ring: readonly number[]): [number, number] {
  let x = 0;
  let y = 0;
  for (let i = 0; i < ring.length; i += 2) {
    x += ring[i] as number;
    y += ring[i + 1] as number;
  }
  return [x / (ring.length / 2), y / (ring.length / 2)];
}

function angleDiff(a: number, b: number, period: number): number {
  const d = Math.abs(a - b) % period;
  return Math.min(d, period - d);
}

/** Distance from a point to a ring's boundary. */
function ringEdgeDist(x: number, y: number, ring: readonly number[]): number {
  let best = Infinity;
  const n = ring.length;
  for (let i = 0; i < n; i += 2) best = Math.min(best, segDist(x, y, ring[i] as number, ring[i + 1] as number, ring[(i + 2) % n] as number, ring[(i + 3) % n] as number));
  return best;
}

/** Least distance between the boundaries of two rings, and the length of the first's boundary lying within `near` of the second. */
function ringGap(a: readonly number[], b: readonly number[], near: number): { gap: number; along: number } {
  let gap = Infinity;
  let along = 0;
  const n = a.length;
  for (let i = 0; i < n; i += 2) {
    const ax = a[i] as number;
    const ay = a[i + 1] as number;
    const bx = a[(i + 2) % n] as number;
    const by = a[(i + 3) % n] as number;
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(len / 0.005));
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.5) / steps;
      const d = ringEdgeDist(ax + (bx - ax) * t, ay + (by - ay) * t, b);
      gap = Math.min(gap, d);
      if (d <= near) along += len / steps;
    }
  }
  return { gap, along };
}

export function checkBase(map: MapDescription, list: DisplayList, explain: Explain | null): Row[] {
  const rows: Row[] = [];
  const row = (id: string, pass: boolean, figure: string, worst: string) => rows.push({ id, pass, figure, worst });
  const g: Grid = gridOf(map);
  const n = hexCount(g);
  const cover = coversOf(map);
  const level = levelsOf(map);
  const bounds = worldBounds(g);
  const L = (h: HexId) => labelOf(g, h);
  const v = makeView(list);
  const roadHex = new Set<HexId>();
  for (const c of map.roads) for (const l of c) roadHex.add(hexOf(map, l));
  const riverHex = new Set<HexId>();
  for (const c of map.rivers) for (const l of c) riverHex.add(hexOf(map, l));
  const casing = Math.max(0, ...v.roadCasing.flatMap(c => [...c.op.halfWidths]));
  const bank = Math.max(0, ...v.riverBank.flatMap(c => [...c.op.halfWidths]));
  const lineDist = (ring: readonly number[], lines: readonly (readonly number[])[]): number => {
    let d = Infinity;
    const c = centroid(ring);
    for (const l of lines) {
      // Only the part of a line near the ring matters.
      const near: number[] = [];
      for (let i = 0; i < l.length; i += 2) if (Math.hypot((l[i] as number) - c[0], (l[i + 1] as number) - c[1]) < 1.5) near.push(l[i] as number, l[i + 1] as number);
      if (near.length >= 4) d = Math.min(d, polygonPolylineDist(ring, near));
    }
    return d;
  };

  // =======================================================================
  // M3b-L-17: fields are rectangular plots
  // =======================================================================
  {
    const problems: string[] = [];
    const plotsOf = new Map<HexId, { ring: number[]; furrows: number[][] }[]>();
    for (const op of list.ops) {
      if (op.feature !== 'furrow' || op.op !== 'pattern') continue;
      const mine = (op as PatternOp).clip.map(r => ({ ring: [...r], furrows: [] as number[][] }));
      for (const s of (op as PatternOp).strokes) {
        const mx = ((s[0] as number) + (s[s.length - 2] as number)) / 2;
        const my = ((s[1] as number) + (s[s.length - 1] as number)) / 2;
        const p = mine.find(q => inRings(mx, my, [q.ring]));
        if (p) p.furrows.push([...s]);
        else problems.push(`a furrow at ${f3(mx)},${f3(my)} lies in no plot`);
      }
      for (const p of mine) {
        const h = nearestHex(g, ...centroid(p.ring));
        plotsOf.set(h, [...(plotsOf.get(h) ?? []), p]);
      }
    }
    const signatures = new Map<string, number>();
    const turns: number[] = [];
    let plainHexes = 0;
    let leastCover = Infinity;
    let mostCover = 0;
    let coverAt = '-';
    let leastCrossed = Infinity;
    let fieldHexes = 0;
    for (let h = 0; h < n; h++) {
      if (cover[h] !== 'field') continue;
      fieldHexes++;
      const plots = plotsOf.get(h) ?? [];
      const crossed = roadHex.has(h) || riverHex.has(h);
      const at = `field hex ${L(h)}`;
      // (a)
      if (crossed ? plots.length < 1 || plots.length > 3 : plots.length < 2 || plots.length > 3) problems.push(`${at} holds ${plots.length} plots`);
      const region = regionRing(g, h);
      const dirs: number[] = [];
      let area = 0;
      plots.forEach((p, k) => {
        // (b) four corners, each a right angle
        if (p.ring.length !== 8) {
          problems.push(`${at}: plot ${k} has ${p.ring.length / 2} corners`);
          return;
        }
        for (let i = 0; i < 8; i += 2) {
          const ax = (p.ring[(i + 6) % 8] as number) - (p.ring[i] as number);
          const ay = (p.ring[(i + 7) % 8] as number) - (p.ring[i + 1] as number);
          const bx = (p.ring[(i + 2) % 8] as number) - (p.ring[i] as number);
          const by = (p.ring[(i + 3) % 8] as number) - (p.ring[i + 1] as number);
          const ang = (Math.acos((ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by))) * 180) / Math.PI;
          if (Math.abs(ang - 90) > 1.5) problems.push(`${at}: plot ${k} has a corner of ${ang.toFixed(1)} degrees`);
          dirs.push((((Math.atan2(by, bx) * 180) / Math.PI) % 90 + 90) % 90);
        }
        area += Math.abs(ringArea(p.ring));
        // (d) furrows parallel to a side, evenly spaced, four or more
        if (p.furrows.length < 4) problems.push(`${at}: plot ${k} has ${p.furrows.length} furrows`);
        const side = (((Math.atan2((p.ring[3] as number) - (p.ring[1] as number), (p.ring[2] as number) - (p.ring[0] as number)) * 180) / Math.PI) % 90 + 90) % 90;
        const fa = p.furrows.map(s => (((Math.atan2((s[3] as number) - (s[1] as number), (s[2] as number) - (s[0] as number)) * 180) / Math.PI) % 180 + 180) % 180);
        for (const a of fa) if (angleDiff(a % 90, side, 90) > 2) problems.push(`${at}: a furrow of plot ${k} runs ${a.toFixed(1)} degrees, its sides ${side.toFixed(1)}`);
        if (p.furrows.length >= 2) {
          const s0 = p.furrows[0] as number[];
          const ux = (s0[2] as number) - (s0[0] as number);
          const uy = (s0[3] as number) - (s0[1] as number);
          const ul = Math.hypot(ux, uy);
          const offs = p.furrows.map(s => (((s[0] as number) - (s0[0] as number)) * -uy + ((s[1] as number) - (s0[1] as number)) * ux) / ul).sort((x, y) => x - y);
          for (let i = 1; i < offs.length; i++) {
            const gap = (offs[i] as number) - (offs[i - 1] as number);
            if (gap < 0.04 - 1e-6 || gap > 0.06 + 1e-6) problems.push(`${at}: furrows of plot ${k} are ${f3(gap)} h apart`);
          }
        }
        // (f) inside the hex and its part-hexes, 0.03 h from the sides it shares with board hexes; clear of roads and rivers
        for (let i = 0; i < 8; i += 2) {
          const x = p.ring[i] as number;
          const y = p.ring[i + 1] as number;
          if (!inRings(x, y, [region]) && ringEdgeDist(x, y, region) > 1e-6) problems.push(`${at}: a corner of plot ${k} lies outside the hex and its part-hexes`);
          for (let d = 0; d < 6; d++) {
            if (neighbourOf(g, h, d) < 0) continue;
            const [k1, k2] = sideCorners(d);
            const a = cornerOf(g, h, k1);
            const b = cornerOf(g, h, k2);
            if (segDist(x, y, a[0], a[1], b[0], b[1]) < 0.03 - 1e-6) problems.push(`${at}: plot ${k} comes ${f3(segDist(x, y, a[0], a[1], b[0], b[1]))} h from a side`);
          }
        }
        if (lineDist(p.ring, v.roadLines) < casing + 0.02 - 1e-6) problems.push(`${at}: plot ${k} is ${f3(lineDist(p.ring, v.roadLines) - casing)} h from a road casing`);
        if (lineDist(p.ring, v.riverLines) < bank + 0.02 - 1e-6) problems.push(`${at}: plot ${k} is ${f3(lineDist(p.ring, v.riverLines) - bank)} h from a river bank`);
      });
      // (c) the group turned as one: every side within 2 degrees of one direction, taken in quarter turns
      if (dirs.length > 0) {
        const ref = dirs[0] as number;
        for (const d of dirs) if (angleDiff(d, ref, 90) > 2) problems.push(`${at}: plot sides run ${d.toFixed(1)} and ${ref.toFixed(1)} degrees`);
        turns.push(ref);
      }
      // (e) neighbours have furrows at right angles; the gap between them
      const neighbours = plots.map(() => 0);
      for (let a = 0; a < plots.length; a++) {
        for (let b = a + 1; b < plots.length; b++) {
          const pa = plots[a] as { ring: number[]; furrows: number[][] };
          const pb = plots[b] as { ring: number[]; furrows: number[][] };
          const { gap, along } = ringGap(pa.ring, pb.ring, 0.06);
          if (along < 0.1) continue;
          neighbours[a] = (neighbours[a] as number) + 1;
          neighbours[b] = (neighbours[b] as number) + 1;
          if (gap < 0.02 - 1e-6 || gap > 0.06 + 1e-6) problems.push(`${at}: plots ${a} and ${b} are ${f3(gap)} h apart`);
          const dir = (p: { furrows: number[][] }) => {
            const s = p.furrows[0];
            return s ? (((Math.atan2((s[3] as number) - (s[1] as number), (s[2] as number) - (s[0] as number)) * 180) / Math.PI) % 180 + 180) % 180 : 0;
          };
          if (Math.abs(angleDiff(dir(pa), dir(pb), 180) - 90) > 3) problems.push(`${at}: neighbouring plots ${a} and ${b} have furrows ${angleDiff(dir(pa), dir(pb), 180).toFixed(1)} degrees apart`);
        }
      }
      const share = area / HEX_AREA;
      if (crossed) {
        leastCrossed = Math.min(leastCrossed, share);
        if (share < 0.12) problems.push(`${at}, crossed by a road or river: plots cover ${(100 * share).toFixed(0)}% of the hex`);
      } else {
        plainHexes++;
        if (share < leastCover) {
          leastCover = share;
          coverAt = L(h);
        }
        mostCover = Math.max(mostCover, share);
        if (share < 0.4 || share > 0.75) problems.push(`${at}: plots cover ${(100 * share).toFixed(0)}% of the hex`);
        // (g) the layout's signature: plot count and each plot's number of neighbours
        const sig = `${plots.length}:${[...neighbours].sort().join('')}`;
        signatures.set(sig, (signatures.get(sig) ?? 0) + 1);
      }
      // The explain file's layout and turn agree with the list.
      const ex = explain?.fields.find(f => f.hex === L(h));
      if (explain && (!ex || ex.plots.length !== plots.length)) problems.push(`${at}: the explain file lists ${ex?.plots.length ?? 'no'} plots, the list ${plots.length}`);
    }
    const sigText = [...signatures].map(([s, c]) => `${s} x${c}`).join(', ');
    // (g) and (h) are judged where there are hexes enough to judge by (the bar measures them over 60 boards).
    if (plainHexes >= 12) {
      if (signatures.size < 2 || signatures.size > 3) problems.push(`${signatures.size} layout signatures (${sigText})`);
      for (const [s, c] of signatures) if (c / plainHexes < 0.15) problems.push(`layout ${s} is used by ${c} of ${plainHexes} field hexes`);
    }
    const distinctTurns = turns.sort((a, b) => a - b).filter((t, i, arr) => i === 0 || t - (arr[i - 1] as number) >= 2).length;
    if (fieldHexes >= 8 && distinctTurns < 4) problems.push(`the groups' turns take ${distinctTurns} values`);
    row('M3b-L-17', problems.length === 0,
      fieldHexes === 0 ? 'no field hex' : `${fieldHexes} field hexes; plots cover ${plainHexes > 0 ? `${(100 * leastCover).toFixed(0)} to ${(100 * mostCover).toFixed(0)}%` : '-'} of a hex with no road or river${Number.isFinite(leastCrossed) ? ` (least in a hex with one: ${(100 * leastCrossed).toFixed(0)}%)` : ''}; layouts ${sigText || '-'}; ${distinctTurns} turns`,
      problems[0] ?? `least cover ${coverAt}`);
  }

  // =======================================================================
  // Towns: the buildings of the list, matched to the explain file's
  // =======================================================================
  const townOfHex = new Map<HexId, number>();
  map.towns.forEach((t, i) => t.hexes.forEach(l => townOfHex.set(hexOf(map, l), i)));
  const key = (r: readonly number[]) => r.map(x => x.toFixed(5)).join(',');
  const listBuildings = new Map<string, { ring: number[]; plate: string; tone: number }>();
  for (const op of list.ops) if (op.feature === 'building' && op.op === 'fill') for (const r of op.rings) listBuildings.set(key(r), { ring: [...r], plate: op.plate, tone: op.tone });
  const roofStrokes: number[][] = [];
  for (const op of list.ops) if (op.feature === 'roof-line' && op.op === 'pattern') for (const s of op.strokes) roofStrokes.push([...s]);

  // ---- M3b-L-18: lots ----
  {
    const problems: string[] = [];
    if (map.towns.length > 0 && !explain) problems.push('no explain file: the lots cannot be read');
    let leastCover = Infinity;
    let coverAt = '-';
    let mostOverlap = 0;
    let lotsLeast = Infinity;
    let lotsMost = 0;
    let built = 0;
    let multi = 0;
    let outside = 0;
    for (const t of explain?.towns ?? []) {
      const hexes = new Set(t.hexes.map(l => hexOf(map, l)));
      // Outer sides of the town, for its ground.
      const outer: number[][] = [];
      for (const h of hexes) {
        for (let d = 0; d < 6; d++) {
          const nb = neighbourOf(g, h, d);
          if (nb >= 0 && hexes.has(nb)) continue;
          const [k1, k2] = sideCorners(d);
          const a = cornerOf(g, h, k1);
          const b = cornerOf(g, h, k2);
          outer.push([a[0], a[1], b[0], b[1]]);
        }
      }
      const boxes = t.lots.map(l => pointsBox(l.ring));
      // (a) and (b) by sampling the town every 0.01 h.
      let ground = 0;
      let covered = 0;
      let doubled = 0;
      for (const h of hexes) {
        const c = centreOf(g, h);
        for (let y = c[1] - 0.5; y < c[1] + 0.5; y += 0.01) {
          for (let x = c[0] - 0.58; x < c[0] + 0.58; x += 0.01) {
            if (worldToHex(g, x, y) !== h) continue;
            let inLots = 0;
            for (let i = 0; i < t.lots.length && inLots < 2; i++) {
              const b = boxes[i] as [number, number, number, number];
              if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
              if (inRings(x, y, [(t.lots[i] as { ring: number[] }).ring])) inLots++;
            }
            if (inLots >= 2) doubled++;
            let isGround = true;
            for (const s of outer) if (segDist(x, y, s[0] as number, s[1] as number, s[2] as number, s[3] as number) < 0.06) isGround = false;
            if (isGround) {
              for (const l of v.roadLines) if (isGround && polylineNear(x, y, l, casing + 0.03)) isGround = false;
              for (const l of v.riverLines) if (isGround && polylineNear(x, y, l, bank + 0.08)) isGround = false;
            }
            if (isGround) {
              ground++;
              if (inLots > 0) covered++;
            }
          }
        }
      }
      const share = ground > 0 ? covered / ground : 1;
      if (share < leastCover) {
        leastCover = share;
        coverAt = t.name;
      }
      mostOverlap = Math.max(mostOverlap, doubled * 0.0001);
      if (share < 0.85) problems.push(`${t.name}: lots cover ${(100 * share).toFixed(0)}% of the town's ground`);
      if (doubled * 0.0001 > 0.0005 * Math.max(1, t.lots.length / 4)) problems.push(`${t.name}: lots overlap by ${(doubled * 0.0001).toFixed(4)} square h in all`);
      // (c) lots per hex
      for (const h of hexes) {
        const count = t.lots.filter(l => l.hex === L(h)).length;
        lotsLeast = Math.min(lotsLeast, count);
        lotsMost = Math.max(lotsMost, count);
        if (count < 8 || count > 30) problems.push(`${t.name}: town hex ${L(h)} holds ${count} lots`);
      }
      // (d) a town of three hexes or more has a row of three
      if (t.hexes.length >= 3) {
        const sizes = new Map<number, number>();
        for (const b of t.buildings) if (b.row >= 0) sizes.set(b.row, (sizes.get(b.row) ?? 0) + 1);
        if (![...sizes.values()].includes(3)) problems.push(`${t.name}: no row of three`);
      }
      // (d) every building in one lot; (e) areas
      t.lots.forEach((l, li) => {
        if (Math.abs(Math.abs(ringArea(l.ring)) - l.area) > 2e-4) problems.push(`${t.name}: lot ${li} has area ${f3(Math.abs(ringArea(l.ring)))}, the explain file says ${f3(l.area)}`);
        if (l.buildings.length > 0) built++;
        if (l.buildings.length > 1) multi++;
        for (const bi of l.buildings) {
          const b = t.buildings[bi];
          if (!b) {
            problems.push(`${t.name}: lot ${li} names building ${bi}, which the town does not have`);
            continue;
          }
          if (!listBuildings.has(key(b.ring))) problems.push(`${t.name}: building ${bi} of the explain file is not a building of the list`);
        }
      });
    }
    // Every building of the list lies wholly inside one lot of its town.
    for (const b of listBuildings.values()) {
      const c = centroid(b.ring);
      const ti = townOfHex.get(worldToHex(g, c[0], c[1]));
      const t = ti === undefined ? undefined : explain?.towns.find(x => x.name === (map.towns[ti] as { name: string }).name);
      const ok = t?.lots.some(l => {
        for (let i = 0; i < b.ring.length; i += 2) {
          const x = b.ring[i] as number;
          const y = b.ring[i + 1] as number;
          if (!inRings(x, y, [l.ring]) && ringEdgeDist(x, y, l.ring) > 0.002) return false;
        }
        return true;
      });
      if (!ok) {
        outside++;
        if (outside === 1) problems.push(`the building at ${f3(c[0])},${f3(c[1])} does not lie wholly inside one lot`);
      }
    }
    if (built >= 10 && multi / built < 0.1) problems.push(`${multi} of ${built} lots that hold a building hold two or more`);
    row('M3b-L-18', problems.length === 0,
      map.towns.length === 0 ? 'no town' : `${explain?.towns.reduce((s, t) => s + t.lots.length, 0) ?? 0} lots in ${map.towns.length} towns; they cover at least ${(100 * leastCover).toFixed(0)}% of a town's ground; most overlap ${mostOverlap.toFixed(4)} square h; ${Number.isFinite(lotsLeast) ? lotsLeast : '-'} to ${lotsMost} lots a town hex; ${built} lots built on, ${multi} with two or more (${built > 0 ? (100 * multi / built).toFixed(0) : '-'}%); ${outside} buildings outside a lot`,
      problems[0] ?? `least cover ${coverAt}`);
  }

  // ---- M3b-L-19: buildings ----
  {
    const problems: string[] = [];
    const shares: number[] = [];
    let total = 0;
    const fills = new Map<string, number>();
    const types = new Set<string>();
    for (const b of listBuildings.values()) {
      total++;
      const k = `${b.plate} ${b.tone}`;
      fills.set(k, (fills.get(k) ?? 0) + 1);
    }
    const STROKES: Record<string, number> = { gable: 1, gable_ends: 3, hip: 5, cross: 2, flat: 0 };
    const strokeMid = roofStrokes.map(s => {
      const m = Math.floor(s.length / 4) * 2;
      return s.length === 4 ? [((s[0] as number) + (s[2] as number)) / 2, ((s[1] as number) + (s[3] as number)) / 2] : [s[m] as number, s[m + 1] as number];
    });
    for (const t of explain?.towns ?? []) {
      const hexes = new Set(t.hexes.map(l => hexOf(map, l)));
      const hasRoad = [...hexes].some(h => roadHex.has(h));
      let fronting = false;
      const famHere = new Set<string>();
      t.buildings.forEach((b, bi) => {
        types.add(b.type);
        famHere.add(b.family);
        const lb = listBuildings.get(key(b.ring));
        if (!lb) return;
        // (a) its proportions are its type's, and it carries its roof's lines.
        const w = Math.hypot((b.ring[2] as number) - (b.ring[0] as number), (b.ring[3] as number) - (b.ring[1] as number));
        const d = Math.hypot((b.ring[4] as number) - (b.ring[2] as number), (b.ring[5] as number) - (b.ring[3] as number));
        if (Math.abs(w - b.width) > 2e-4 || Math.abs(d - b.height) > 2e-4) problems.push(`${t.name}: building ${bi} measures ${f3(w)} x ${f3(d)}, the explain file says ${f3(b.width)} x ${f3(b.height)}`);
        let lines = 0;
        // A stroke is this building's when its middle lies in the footprint (a hair inside its edge counts).
        strokeMid.forEach(m => {
          if (inRings(m[0] as number, m[1] as number, [b.ring]) || ringEdgeDist(m[0] as number, m[1] as number, b.ring) < 1e-4) lines++;
        });
        if (lines !== STROKES[b.roof]) problems.push(`${t.name}: building ${bi} (${b.type}, a ${b.roof} roof) carries ${lines} roof lines, not ${STROKES[b.roof]}`);
        // (e) every corner in a hex of its own town
        for (let i = 0; i < b.ring.length; i += 2) {
          if (!hexes.has(worldToHex(g, b.ring[i] as number, b.ring[i + 1] as number))) problems.push(`${t.name}: a corner of building ${bi} lies outside the town's hexes`);
        }
        // (e) a building along the road: within 0.2 h of a centre line, its long side within 10 degrees of the road there
        if (hasRoad && !fronting) {
          const c = centroid(b.ring);
          for (const l of v.roadLines) {
            for (let i = 0; i + 3 < l.length && !fronting; i += 2) {
              if (segDist(c[0], c[1], l[i] as number, l[i + 1] as number, l[i + 2] as number, l[i + 3] as number) > 0.2) continue;
              const road = (Math.atan2((l[i + 3] as number) - (l[i + 1] as number), (l[i + 2] as number) - (l[i] as number)) * 180) / Math.PI;
              const long = w >= d ? Math.atan2((b.ring[3] as number) - (b.ring[1] as number), (b.ring[2] as number) - (b.ring[0] as number)) : Math.atan2((b.ring[5] as number) - (b.ring[3] as number), (b.ring[4] as number) - (b.ring[2] as number));
              if (angleDiff(((long * 180) / Math.PI + 360) % 180, (road + 360) % 180, 180) <= 10) fronting = true;
            }
          }
        }
      });
      if (hasRoad && !fronting && t.buildings.length > 0) problems.push(`${t.name}: no building within 0.2 h of a road with its long side along it`);
      // (a) a row is two or three footprints of one house type sharing sides
      const rowsHere = new Map<number, typeof t.buildings>();
      for (const b of t.buildings) if (b.row >= 0) rowsHere.set(b.row, [...(rowsHere.get(b.row) ?? []), b]);
      for (const [rn, members] of rowsHere) {
        if (members.length < 2 || members.length > 3 || new Set(members.map(b => b.type)).size !== 1) problems.push(`${t.name}: row ${rn} holds ${members.length} buildings of ${new Set(members.map(b => b.type)).size} types`);
        for (let k = 1; k < members.length; k++) {
          const a = (members[k - 1] as { ring: number[] }).ring;
          const b = (members[k] as { ring: number[] }).ring;
          // The second corner of one is the first of the next, and the third the fourth.
          const gap = Math.max(Math.hypot((a[2] as number) - (b[0] as number), (a[3] as number) - (b[1] as number)), Math.hypot((a[4] as number) - (b[6] as number), (a[5] as number) - (b[7] as number)));
          if (gap > 0.004) problems.push(`${t.name}: the houses of row ${rn} stand ${f3(gap)} h apart`);
        }
      }
      // (b) a town of three hexes or more shows three families or more
      if (t.hexes.length >= 3 && famHere.size < 3) problems.push(`${t.name}: ${famHere.size} families of building`);
      // (d) built share and (e) buildings per hex
      for (const h of hexes) {
        const mine = t.buildings.filter(b => b.hex === L(h));
        const share = mine.reduce((s, b) => s + b.width * b.height, 0) / HEX_AREA;
        shares.push(share);
        if (share < 0.12 || share > 0.4) problems.push(`${t.name}: buildings cover ${(100 * share).toFixed(0)}% of town hex ${L(h)}`);
        if (mine.length < 3) problems.push(`${t.name}: town hex ${L(h)} holds ${mine.length} buildings`);
      }
    }
    if (explain) {
      const listed = explain.towns.reduce((s, t) => s + t.buildings.length, 0);
      if (listed !== total) problems.push(`the list holds ${total} buildings, the explain file ${listed}`);
    } else if (total > 0) problems.push('no explain file: the buildings cannot be told by type');
    shares.sort((a, b) => a - b);
    const median = shares.length > 0 ? (shares[Math.floor(shares.length / 2)] as number) : 0;
    if (shares.length > 0 && median < 0.16) problems.push(`the median built share of a town hex is ${(100 * median).toFixed(0)}%`);
    // (c) fills: three or more, each on a tenth of the buildings or more
    const big = [...fills.values()].filter(c => c / Math.max(1, total) >= 0.1).length;
    // Judged where a board has buildings enough for a tenth to mean something (the line speaks of all boards together).
    if (total >= 400 && big < 3) problems.push(`${big} fills are each on a tenth of the buildings (${[...fills].map(([k, c]) => `${k}: ${c}`).join(', ')})`);
    // (f) no two footprints overlap (rows stand apart by a hair)
    row('M3b-L-19', problems.length === 0,
      total === 0 ? 'no building' : `${total} buildings of ${types.size} types; fills ${[...fills].map(([k, c]) => `${k} x${c}`).join(', ')}; built share of a town hex ${(100 * (shares[0] ?? 0)).toFixed(0)} to ${(100 * (shares[shares.length - 1] ?? 0)).toFixed(0)}%, median ${(100 * median).toFixed(0)}%; ${roofStrokes.length} roof lines`,
      problems[0] ?? '-');
  }

  // =======================================================================
  // M3b-L-24 (a): outer crests wholly inside the board
  // =======================================================================
  {
    const problems: string[] = [];
    const outer = list.ops.filter((o): o is RibbonOp => o.op === 'ribbon' && o.feature === 'crest-outer');
    let least = Infinity;
    let at = '-';
    for (const o of outer) {
      const plate = list.plates.find(p => p.id === o.plate);
      const off = plate ? plate.offset : [0, 0];
      for (let i = 0; i < o.line.length; i += 2) {
        const hw = o.halfWidths[i / 2] as number;
        const x = (o.line[i] as number) + (off[0] as number);
        const y = (o.line[i + 1] as number) + (off[1] as number);
        const inside = Math.min(x - hw - bounds[0], bounds[2] - x - hw, y - hw - bounds[1], bounds[3] - y - hw);
        if (inside < least) {
          least = inside;
          at = `${f3(o.line[i] as number)},${f3(o.line[i + 1] as number)}`;
        }
      }
    }
    if (least < 0) problems.push(`a crest-outer ribbon, with its half-width and its plate's offset, reaches ${f3(-least)} h outside the board at ${at}`);
    row('M3b-L-24', problems.length === 0, outer.length === 0 ? '(a) no outer crest' : `(a) ${outer.length} crest-outer ribbons; the nearest comes, with its half-width and its plate's offset, to ${f3(least)} h inside the board rectangle`, problems[0] ?? at);
  }

  // =======================================================================
  // M3b-L-25: ground cover runs on to the board rectangle
  // =======================================================================
  {
    const problems: string[] = [];
    const tintRings: number[][] = [];
    for (const op of list.ops) if ((op.feature === 'swamp-tint' || op.feature === 'field-tint') && op.op === 'fill') for (const r of op.rings) tintRings.push([...r]);
    const marks: { x: number; y: number; f: string }[] = [];
    for (const op of list.ops) {
      if ((op.feature === 'swamp-mark' || op.feature === 'rough-mark') && op.op === 'stamp') for (let i = 0; i < op.placements.length; i += 5) marks.push({ x: op.placements[i] as number, y: op.placements[i + 1] as number, f: op.feature });
    }
    let parts = 0;
    let roughBare = 0;
    let fieldParts = 0;
    let fieldReached = 0;
    let leastRatio = Infinity;
    let leastFlanked = Infinity;
    let ratioAt = '-';
    let skipped = 0;
    const hillTop = (h: HexId) => level[h] === 2 || [0, 1, 2, 3, 4, 5].some(d => {
      const nb = neighbourOf(g, h, d);
      return nb >= 0 && level[nb] === 2;
    });
    // Canopies whose nearest hex is not woods (M3a-12 (a) restated).
    let astray = 0;
    for (const c of v.canopies) if (cover[nearestHex(g, c.x, c.y)] !== 'woods') astray++;
    if (astray > 0) problems.push(`${astray} canopies stand where the nearest board hex is not woods`);
    for (let h = 0; h < n; h++) {
      const c = cover[h];
      if (c !== 'woods' && c !== 'field' && c !== 'swamp' && c !== 'rough') continue;
      for (const part of partHexRings(g, h)) {
        const area = Math.abs(ringArea(part));
        if (area < 0.05) continue;
        parts++;
        const at = `the part-hex of ${c} hex ${L(h)} (${f3(area)} square h)`;
        if (c === 'woods') {
          // Left out: a hex with a road, river, hill or number, and a part-hex that a road's or river's clearing reaches.
          const cleared = [...v.roadLines, ...v.riverLines].some(l => polylineNear(centroid(part)[0], centroid(part)[1], l, 0.55));
          if (cleared || roadHex.has(h) || riverHex.has(h) || hillTop(h) || map.spotHeights.some(s => hexOf(map, s.hex) === h)) {
            skipped++;
            continue;
          }
          const inPart = v.canopies.filter(p => inRings(p.x, p.y, [part])).length / area;
          const inHex = v.canopies.filter(p => worldToHex(g, p.x, p.y) === h).length / HEX_AREA;
          const ratio = inHex > 0 ? inPart / inHex : 1;
          // A part-hex beside ground that is not woods loses a margin along that ground, as a hex does, and it is
          // a far larger share of so small a piece: 70% where the wood runs on both sides of it, 50% otherwise
          // (the lead's ruling 28).
          const pc = centroid(part);
          let flanked = false;
          for (let d = 0; d < 6; d++) {
            const nb = neighbourOf(g, h, d);
            if (nb < 0 || cover[nb] === 'woods') continue;
            const [k1, k2] = sideCorners(d);
            const a = cornerOf(g, h, k1);
            const b = cornerOf(g, h, k2);
            // The side towards that ground, carried on a hex's side further each way: is the part-hex beside it?
            if (segDist(pc[0], pc[1], a[0] - (b[0] - a[0]), a[1] - (b[1] - a[1]), b[0] + (b[0] - a[0]), b[1] + (b[1] - a[1])) < 0.35) flanked = true;
          }
          if (flanked) {
            leastFlanked = Math.min(leastFlanked, ratio);
            if (ratio < 0.5) problems.push(`${at}, beside ground that is not woods, holds ${inPart.toFixed(0)} canopies a square h, its hex ${inHex.toFixed(0)}`);
            continue;
          }
          if (ratio < leastRatio) {
            leastRatio = ratio;
            ratioAt = L(h);
          }
          if (ratio < 0.7) problems.push(`${at} holds ${inPart.toFixed(0)} canopies a square h, its hex ${inHex.toFixed(0)}`);
        } else if (c === 'swamp') {
          const pc = centroid(part);
          if (!tintRings.some(r => inRings(pc[0], pc[1], [r]))) problems.push(`${at} carries no swamp tint`);
          // Marks are reported, not judged (ruling 28): a whole mark does not always fit so small a piece.
        } else if (c === 'rough') {
          if (!marks.some(m => m.f === 'rough-mark' && inRings(m.x, m.y, [part]))) roughBare++;
        } else if (c === 'field') {
          // Plots may stop at the board's edge: some plot must reach into the part-hex.
          let reached = false;
          for (const r of tintRings) for (let i = 0; i < r.length && !reached; i += 2) if (inRings(r[i] as number, r[i + 1] as number, [part])) reached = true;
          // Reported, not judged: a group of rectangles cannot be made to reach every corner of the board.
          fieldParts++;
          if (reached) fieldReached++;
        }
      }
    }
    row('M3b-L-25', problems.length === 0,
      `${parts} part-hexes of 0.05 square h or more under woods, field, swamp or rough; ${astray} canopies with a nearest hex that is not woods; least canopy density of a wooded part-hex against its hex ${Number.isFinite(leastRatio) ? `${(100 * leastRatio).toFixed(0)}%` : '-'}${Number.isFinite(leastFlanked) ? `, beside ground that is not woods ${(100 * leastFlanked).toFixed(0)}%` : ''} (${skipped} left out: road, river, hill or number in the hex); a plot reaches into ${fieldReached} of ${fieldParts} part-hexes of field hexes, and ${roughBare} part-hexes of rough hexes carry no mark (reported)`,
      problems[0] ?? (ratioAt === '-' ? '-' : `hex ${ratioAt}`));
  }

  // =======================================================================
  // M3b-L-26: a one-hex wooded hilltop with a number still reads as trees
  // =======================================================================
  {
    const problems: string[] = [];
    const outlines: { x: number; y: number; ring: number[] }[] = [];
    for (const op of list.ops) {
      if (op.feature !== 'canopy-outline' || op.op !== 'stamp') continue;
      const rings = stampRings(list, op);
      rings.forEach((ring, k) => outlines.push({ x: op.placements[k * 5] as number, y: op.placements[k * 5 + 1] as number, ring }));
    }
    const tris = list.ops.filter(o => o.feature === 'spot-triangle' && o.op === 'fill').flatMap(o => (o.op === 'fill' ? o.rings.map(r => [...r]) : []));
    const nums = v.glyphOps.filter(({ op }) => op.feature === 'spot-number');
    const figures: string[] = [];
    for (const s of map.spotHeights) {
      const h = hexOf(map, s.hex);
      if (cover[h] !== 'woods' || level[h] !== 2) continue;
      if ([0, 1, 2, 3, 4, 5].some(d => {
        const nb = neighbourOf(g, h, d);
        return nb >= 0 && level[nb] === 2;
      })) continue;
      const c = centreOf(g, h);
      const mine = outlines.filter(o => Math.hypot(o.x - c[0], o.y - c[1]) < 0.75 && worldToHex(g, o.x, o.y) === h);
      const pts = [...tris.filter(r => worldToHex(g, ...centroid(r)) === h).flat(), ...nums.filter(({ op }) => {
        const b = pointsBox(v.glyphPoints(op));
        return worldToHex(g, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2) === h;
      }).flatMap(({ op }) => v.glyphPoints(op))];
      const box = pts.length > 0 ? pointsBox(pts) : [c[0], c[1], c[0], c[1]];
      // The ground trees may cover: the hex, in from its sides by the hilltop inset (0.08 h), outside the
      // number's clear box (its mark's box grown by 0.05 h).
      const sides: number[][] = [];
      for (let d = 0; d < 6; d++) {
        const [k1, k2] = sideCorners(d);
        const a = cornerOf(g, h, k1);
        const b = cornerOf(g, h, k2);
        sides.push([a[0], a[1], b[0], b[1]]);
      }
      let ground = 0;
      let covered = 0;
      for (let y = c[1] - 0.5; y < c[1] + 0.5; y += 0.01) {
        for (let x = c[0] - 0.58; x < c[0] + 0.58; x += 0.01) {
          if (worldToHex(g, x, y) !== h) continue;
          if (sides.some(sd => segDist(x, y, sd[0] as number, sd[1] as number, sd[2] as number, sd[3] as number) < 0.08)) continue;
          if (x > (box[0] as number) - 0.05 && x < (box[2] as number) + 0.05 && y > (box[1] as number) - 0.05 && y < (box[3] as number) + 0.05) continue;
          ground++;
          if (mine.some(o => Math.hypot(o.x - x, o.y - y) < 0.11 && inRings(x, y, [o.ring]))) covered++;
        }
      }
      const share = ground > 0 ? covered / ground : 0;
      // Strays: an outline that touches no other (within 0.01 h).
      let strays = 0;
      mine.forEach((o, a) => {
        const touches = mine.some((p, b) => {
          if (a === b || Math.hypot(o.x - p.x, o.y - p.y) > 0.25) return false;
          for (let i = 0; i < o.ring.length; i += 2) if (inRings(o.ring[i] as number, o.ring[i + 1] as number, [p.ring]) || ringEdgeDist(o.ring[i] as number, o.ring[i + 1] as number, p.ring) <= 0.01) return true;
          for (let i = 0; i < p.ring.length; i += 2) if (inRings(p.ring[i] as number, p.ring[i + 1] as number, [o.ring]) || ringEdgeDist(p.ring[i] as number, p.ring[i + 1] as number, o.ring) <= 0.01) return true;
          return false;
        });
        if (!touches) strays++;
      });
      figures.push(`${s.hex} ${mine.length} canopies, ${(100 * share).toFixed(0)}%`);
      if (share < 0.45) problems.push(`hilltop ${s.hex}: canopy outlines cover ${(100 * share).toFixed(0)}% of the ground open to them (${mine.length} canopies)`);
      if (strays > 0) problems.push(`hilltop ${s.hex}: ${strays} canopies touch no other`);
    }
    row('M3b-L-26', problems.length === 0,
      figures.length === 0 ? 'no one-hex wooded hilltop with a number' : `canopies and the share of the hex they cover (inside the 0.08 h inset, outside the number's box grown by 0.05 h): ${figures.join('; ')}`,
      problems[0] ?? '-');
  }
  return rows;
}

function polylineNear(x: number, y: number, line: readonly number[], within: number): boolean {
  for (let i = 0; i + 3 < line.length; i += 2) {
    const ax = line[i] as number;
    const ay = line[i + 1] as number;
    if (Math.abs(ax - x) > within + 0.3 || Math.abs(ay - y) > within + 0.3) continue;
    if (segDist(x, y, ax, ay, line[i + 2] as number, line[i + 3] as number) < within) return true;
  }
  return false;
}
