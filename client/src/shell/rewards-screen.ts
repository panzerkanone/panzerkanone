/**
 * The results and rewards screen after every battle (`screen=rewards`), and the service record (`screen=service`).
 *
 * The owner's look (images/ui_sheets/2026-11-14-results/, cut by tools/rewardsart/): his empty base under everything
 * (the title lettering, the bar with SCENARIO REWARDS, a blank clipboard, a blank open book), and on it, at his sizes,
 * three things: the battle's points, the medal earned, and the player's rank.
 *
 *   rewards   the clipboard: the outcome as the red headline, the battle's name, the game's own end line, what
 *             happened (enemy destroyed, the player's losses, objectives held: a pencil tick beside each deed that
 *             counted for the medal, a cross beside one that counted against it) and the points (both scores, the
 *             campaign's points in a campaign battle, the service points earned), with our own stamps. The book's left
 *             page: the medal large in its open case, with its name. Its right page: the rank's boards, the rank's
 *             name the largest thing on the page (NEW RANK when this battle promoted the player), the way to the next
 *             rank, and why the medal was given. Plates: Service Record, Continue (a campaign battle: to the campaign's
 *             room; a single battle: to the battle list), Play Again (single battles), Main Menu.
 *   service   one side's record: its battles, its five medals with how many of each, its rank. Plates: Back, the other
 *             side's record, Main Menu.
 *
 * Every line, stamp and tick lies on its paper at the paper's own tilt and perspective: each paper has a flat sheet
 * carried onto its four corners by one transform (rewards-fit.ts). Headings are in the game's stencil face, typed
 * lines in the typewriter face (typed-face.ts); a line's width is arithmetic (rewards-type.ts), the page is never
 * measured. Nothing here is a web control: the plates are the other screens' tags (`sh-tag`), with their colours, glow,
 * press and keys.
 *
 * The battle shown is the last one counted (rewards-rules.ts keeps it with the record), so a reload shows it again
 * and counts nothing.
 */
import type { Screen, Shell } from './screen';
import type { ScreenId } from './address';
import { REDUCED, el, leaveFor, place, pressable } from './ui';
import { sheetTransform } from './rewards-fit';
import type { Quad } from './rewards-fit';
import type { Award, RewardsData, ServiceFile, ServiceSide } from './rewards-rules';
import { INK, REWARDS_DEFS, rewardsCss } from './rewards-style';
import { STENCIL_FACE, citationLines, fitLine, stencilWidth, typedLines, typedWidth } from './rewards-type';
import { TYPED_FACE, TYPED_FAMILY, TYPED_WEIGHT } from './typed-face';
import { WORDS } from './words';

const W = WORDS.rewards;

type Rules = typeof import('./rewards-rules');
type Art = typeof import('./rewards-art');

declare global {
  interface Window {
    /** The rewards screens, for checks. */
    __rewards?: { view(): string | null; award(): Award | null; record(): ServiceFile | null; press(control: string): boolean };
  }
}

/** A painted paper of his base: the size of the flat sheet laid on it, and the corners it is carried to (stage pixels). */
interface Paper {
  readonly w: number;
  readonly h: number;
  readonly quad: Quad;
}
/** Read off his base: the clipboard's top sheet, and the open book's two pages (the fold between them). */
const CLIP: Paper = { w: 1030, h: 736, quad: [[258, 533], [1285, 503], [1305, 1238], [272, 1268]] };
const LEFT: Paper = { w: 568, h: 760, quad: [[1485, 505], [2052, 518], [2040, 1278], [1468, 1262]] };
const RIGHT: Paper = { w: 580, h: 762, quad: [[2052, 518], [2630, 528], [2620, 1293], [2040, 1278]] };

/** Where the medal's case lies (stage pixels): over the left page and up past the book's top edge, as his look has it. */
const CASE = { x: 1745, top: 436, h: 770, turn: -1.6 } as const;

type PlateKind = 'wide' | 'mid' | 'small';
/**
 * The plates at the foot (stage pixels): the small one at the left, then the wide one and two mid ones where his look
 * has them. `room` is the width its words have, `at` where their middle sits across the plate (a tag's hole is at its left).
 */
const PLATE_AT: readonly { kind: PlateKind; x: number; y: number; w: number; h: number; size: number; room: number; at: number }[] = [
  { kind: 'small', x: 652, y: 1381, w: 352, h: 126, size: 44, room: 232, at: 0.57 },
  { kind: 'wide', x: 1029, y: 1362, w: 691, h: 148, size: 86, room: 600, at: 0.5 },
  { kind: 'mid', x: 1763, y: 1389, w: 430, h: 110, size: 64, room: 330, at: 0.545 },
  { kind: 'mid', x: 2217, y: 1389, w: 430, h: 110, size: 64, room: 330, at: 0.545 },
];
/** The clipboard's rows (its sheet's pixels): his pitch, the last row's lowest baseline, and the room the rule between the two groups takes. */
const ROWS = { pitch: 57, last: 664, gap: 54 } as const;
/** The citation at the foot of the right page: the sizes it is tried at, its lines' pitch (of the size), its middle and the room it has (clear of the paperclip at the page's corner). */
const CITATION = { sizes: [41, 37, 33, 30], pitch: 0.95, x: 270, width: 468, height: 118 } as const;
/** How many times faster the page's parts come once the player presses or types while they are still coming. */
const HURRY = 9;
/** The longest the page waits for its faces and pictures before its parts come on (ms): what has not come by then comes when it does. */
const READY_WAIT_MS = 1200;
/** A tag's words are tracked by this much of their size (screens-style.ts, `sh-tag-text`). */
const TAG_TRACKING = 0.03;

/** A heading is narrowed to the owner's proportions: to `base` always, to `least` when it is long (rewards-type.ts). */
const NARROW = { base: 0.88, least: 0.72 } as const;
/** A typed line is narrowed a little, to the width of his typed rows; a long one further. */
const TYPED_NARROW = { base: 0.88, least: 0.74 } as const;

const STYLE_ID = 'rewards-style';
function addStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = rewardsCss();
  document.head.append(s);
}

/** The namespace of the page's drawings, taken from the screen's own (its filters' element, which the page's parser made). */
let drawing: string | null = null;
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Readonly<Record<string, string | number>>, text?: string): SVGElementTagNameMap[K] {
  if (drawing === null) throw new Error('the rewards screen: a drawing was asked for before the screen was built');
  const e = document.createElementNS(drawing, tag) as SVGElementTagNameMap[K];
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A sheet on a paper. */
function sheetOn(p: Paper, cls: string): HTMLDivElement {
  const s = el('div', `rw-sheet ${cls}`.trim());
  s.style.width = `${p.w}px`;
  s.style.height = `${p.h}px`;
  s.style.transform = sheetTransform(p.w, p.h, p.quad);
  return s;
}

interface LineAt {
  /** The line's left end, middle or right end, and its baseline (the sheet's pixels). */
  readonly x: number;
  readonly base: number;
  readonly size: number;
  readonly align?: 'left' | 'mid' | 'end';
  /** The widest the line may be; a longer one is narrowed, then set smaller. */
  readonly max: number;
}

/** A line of lettering on a sheet: a heading in the stencil face, or a typed line. */
function lineOn(sheet: HTMLElement, face: 'stencil' | 'typed', cls: string, text: string, at: LineAt): HTMLDivElement {
  const align = at.align ?? 'left';
  const e = el('div', `rw-line ${face === 'typed' ? 'rw-typed' : ''} ${cls}${align === 'mid' ? ' rw-mid' : align === 'end' ? ' rw-end' : ''}`.replace(/\s+/g, ' ').trim(), text);
  const fit =
    face === 'typed'
      ? fitLine(typedWidth(text, at.size), at.size, at.max, TYPED_NARROW.base, TYPED_NARROW.least)
      : fitLine(stencilWidth(text, at.size, 0.012), at.size, at.max, NARROW.base, NARROW.least);
  const baseline = face === 'typed' ? TYPED_FACE.baseline : STENCIL_FACE.baseline;
  e.style.left = `${at.x}px`;
  e.style.fontSize = `${fit.size.toFixed(1)}px`;
  e.style.top = `${(at.base - baseline * fit.size).toFixed(1)}px`;
  e.style.setProperty('--squeeze', fit.squeeze.toFixed(4));
  sheet.append(e);
  return e;
}

function ruleOn(sheet: HTMLElement, x0: number, x1: number, y: number): HTMLDivElement {
  const r = el('div', 'rw-rule');
  r.style.left = `${x0}px`;
  r.style.width = `${x1 - x0}px`;
  r.style.top = `${y}px`;
  sheet.append(r);
  return r;
}

/** Where a stamp is put: its middle and its turn. The stamp itself is this element's child, so it can come down onto the paper about its own middle. */
function stampAt(sheet: HTMLElement, x: number, y: number, turn: number): HTMLDivElement {
  const at = el('div', 'rw-at');
  at.style.left = `${x}px`;
  at.style.top = `${y}px`;
  at.style.transform = `translate(-50%, -50%) rotate(${turn}deg)`;
  sheet.append(at);
  return at;
}

/** Our own stamp: words in a ruled box, turned. Set by its middle. */
function boxStamp(sheet: HTMLElement, words: string, at: { x: number; y: number; size: number; turn: number }): HTMLDivElement {
  const s = el('div', 'rw-stamp rw-box-stamp');
  s.dataset['stamp'] = words;
  s.append(el('span', '', words));
  s.style.fontSize = `${at.size}px`;
  stampAt(sheet, at.x, at.y, at.turn).append(s);
  return s;
}

/** Our own stamp: words round a ring and a word or two across its middle, turned. Set by its middle. */
function ringStamp(sheet: HTMLElement, o: { x: number; y: number; d: number; turn: number; over: string; under: string; middle: readonly string[]; id: string }): HTMLDivElement {
  const s = el('div', 'rw-stamp rw-ring-stamp');
  s.dataset['stamp'] = o.middle.join(' ');
  const g = svg('svg', { width: o.d, height: o.d, viewBox: '-100 -100 200 200', 'aria-hidden': 'true' });
  const ink = INK.stamp;
  g.append(
    svg('circle', { r: 95, fill: 'none', stroke: ink, 'stroke-width': 6 }),
    svg('circle', { r: 86, fill: 'none', stroke: ink, 'stroke-width': 2 }),
    svg('circle', { r: 56, fill: 'none', stroke: ink, 'stroke-width': 2.5 }),
  );
  const defs = svg('defs', {});
  // The words run clockwise over the top, and left to right under the foot.
  defs.append(svg('path', { id: `${o.id}-over`, d: 'M -71 0 A 71 71 0 0 1 71 0' }), svg('path', { id: `${o.id}-under`, d: 'M -80.5 0 A 80.5 80.5 0 0 0 80.5 0' }));
  g.append(defs);
  const around = (words: string, path: string): SVGTextElement => {
    const t = svg('text', { fill: ink, 'font-size': 21, 'letter-spacing': 2.2, 'text-anchor': 'middle' });
    t.append(svg('textPath', { href: `#${path}`, startOffset: '50%' }, words.toUpperCase()));
    return t;
  };
  g.append(around(o.over, `${o.id}-over`), around(o.under, `${o.id}-under`));
  // A dot between the two runs of words, either side.
  g.append(svg('circle', { cx: -75.5, cy: 5, r: 3.4, fill: ink }), svg('circle', { cx: 75.5, cy: 5, r: 3.4, fill: ink }));
  const lines = o.middle.map(m => m.toUpperCase());
  const longest = Math.max(...lines.map(l => l.length));
  const size = Math.min(lines.length > 1 ? 34 : 44, 208 / Math.max(4, longest));
  lines.forEach((m, i) => {
    const y = (i - (lines.length - 1) / 2) * size * 0.96 + size * 0.35;
    g.append(svg('text', { fill: ink, 'font-size': size.toFixed(1), 'text-anchor': 'middle', y: y.toFixed(1), 'letter-spacing': 0.6 }, m));
  });
  s.append(g);
  stampAt(sheet, o.x, o.y, o.turn).append(s);
  return s;
}

/** A pencil's tick (or its cross) on a sheet, set by its top left; `seed` varies the hand a little. */
function tickOn(sheet: HTMLElement, at: { x: number; y: number; size: number; seed: number; cross?: boolean }): HTMLDivElement {
  const t = el('div', 'rw-tick');
  t.dataset['mark'] = at.cross ? 'cross' : 'tick';
  t.style.left = `${at.x}px`;
  t.style.top = `${at.y}px`;
  const lean = ((at.seed * 37) % 9) - 4;
  const g = svg('svg', { width: at.size, height: at.size, viewBox: '0 0 100 100', 'aria-hidden': 'true', filter: 'url(#rw-pencil)' });
  g.style.transform = `rotate(${lean}deg)`;
  const stroke = { fill: 'none', stroke: INK.pencil, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const;
  if (at.cross) {
    g.append(svg('path', { ...stroke, d: 'M 18 20 C 36 38, 60 62, 82 84', 'stroke-width': 8, opacity: 0.85 }), svg('path', { ...stroke, d: 'M 80 16 C 60 40, 38 62, 16 86', 'stroke-width': 7, opacity: 0.8 }));
  } else {
    // Down into the foot, then the long stroke up and away; a lighter second pass beside it, as a pencil leaves.
    g.append(
      svg('path', { ...stroke, d: 'M 6 52 C 14 58, 24 72, 31 90 C 44 58, 66 28, 96 4', 'stroke-width': 8, opacity: 0.86 }),
      svg('path', { ...stroke, d: 'M 9 50 C 17 57, 25 69, 32 84 C 47 54, 68 27, 93 7', 'stroke-width': 3, opacity: 0.45 }),
    );
  }
  t.append(g);
  sheet.append(t);
  return t;
}

/** The place a medal's case would lie, ruled in pencil (no medal was given). */
function frameOn(sheet: HTMLElement, at: { x: number; y: number; w: number; h: number }): HTMLDivElement {
  const f = el('div', 'rw-none');
  f.style.left = `${at.x}px`;
  f.style.top = `${at.y}px`;
  const g = svg('svg', { width: at.w, height: at.h, viewBox: `0 0 ${at.w} ${at.h}`, 'aria-hidden': 'true', filter: 'url(#rw-pencil)' });
  g.append(svg('rect', { x: 5, y: 5, width: at.w - 10, height: at.h - 10, rx: 24, fill: 'none', stroke: INK.pencil, 'stroke-width': 5, 'stroke-dasharray': '30 17', 'stroke-linecap': 'round' }));
  f.append(g);
  sheet.append(f);
  return f;
}

/**
 * How a part comes onto the page when the screen opens: `fade` in; `write` across from its left end, as a line is typed
 * or ruled; `press` on a little large, as stencil paint is laid; `stamp` down from above the paper; `settle` down into
 * its place, as a thing laid on the page. Each is a CSS animation (rewards-style.ts) that ends at the part as it stands.
 */
type Coming = 'fade' | 'write' | 'press' | 'stamp' | 'settle';

interface PlateAction {
  /** The plate's words: one line, or two stacked. */
  readonly words: string | readonly [string, string];
  readonly id: string;
  run(): void;
}

export function buildRewards(shell: Shell, id: 'rewards' | 'service'): Screen {
  addStyle();
  const { sound } = shell;
  const screen = el('div', 'sh-screen rw-room');
  screen.setAttribute('role', 'region');
  screen.setAttribute('aria-label', id === 'rewards' ? W.label : W.recordLabel);
  shell.stage.element.append(screen);
  const desk = el('div', 'rw-desk');
  desk.setAttribute('aria-hidden', 'true');
  screen.append(desk);
  screen.insertAdjacentHTML('beforeend', REWARDS_DEFS);
  drawing = screen.querySelector('.rw-defs')?.namespaceURI ?? null;

  // The papers' sheets: ink (multiplied onto the paper), then what lies on the paper.
  const clipInk = sheetOn(CLIP, 'rw-ink');
  const leftInk = sheetOn(LEFT, 'rw-ink');
  const rightInk = sheetOn(RIGHT, 'rw-ink');
  const leftOn = sheetOn(LEFT, '');
  const rightOn = sheetOn(RIGHT, '');
  // The medal's case: its picture, and over it the glint (the same picture's brightest metal, lit where a band of light passes).
  const medal = el('div', 'rw-medal');
  medal.setAttribute('aria-hidden', 'true');
  medal.hidden = true;
  const medalPic = el('div', 'rw-medal-pic');
  const glint = el('div', 'rw-glint');
  medal.append(medalPic, glint);
  // A viewer who asks for less motion gets the finished page at once, and a still medal.
  const still = shell.params.get('motion') === '0' || REDUCED();
  screen.classList.toggle('rw-still', still);
  /** The battle whose rewards have been shown since the page was opened: its appearance is played once. */
  let played: string | null = null;
  /** A press or a key while the page's parts are still coming: they come at once (quickly, not in a jump). */
  const hurry = (): void => {
    for (const a of screen.getAnimations({ subtree: true })) {
      const end = a.effect?.getComputedTiming().endTime;
      if (typeof end === 'number' && Number.isFinite(end) && a.playState === 'running') a.playbackRate = HURRY;
    }
  };
  screen.addEventListener('pointerdown', hurry, true);
  screen.append(clipInk, leftInk, rightInk, leftOn, rightOn, medal);

  const plates = PLATE_AT.map((p, i) => {
    const b = el('button', `sh-tag rw-plate rw-plate-${p.kind}`);
    b.type = 'button';
    place(b, p);
    b.dataset['plate'] = String(i);
    const face = el('span', 'rw-plate-face');
    face.setAttribute('aria-hidden', 'true');
    const text = el('span', 'sh-tag-text');
    text.style.left = `${(p.at * 100).toFixed(1)}%`;
    b.append(face, text);
    pressable(b);
    screen.append(b);
    return b;
  });

  let rules: Rules | null = null;
  let art: Art | null = null;
  let data: RewardsData | null = null;
  let file: ServiceFile | null = null;
  let view: string | null = null;
  /** The side the record view shows. */
  let side: ServiceSide = 'german';

  /** The plates, left to right: the small one, the wide one, the two mid ones (null: none there). */
  function setPlates(list: readonly (PlateAction | null)[]): void {
    plates.forEach((b, i) => {
      const a = list[i] ?? null;
      const p = PLATE_AT[i] as (typeof PLATE_AT)[number];
      const text = b.lastElementChild as HTMLElement;
      const lines = a ? (typeof a.words === 'string' ? [a.words] : [...a.words]) : [];
      // The words at the plate's size, smaller when they are too long for it.
      const widest = Math.max(0, ...lines.map(l => stencilWidth(l, p.size, TAG_TRACKING)));
      const size = widest > p.room ? (p.size * p.room) / widest : p.size;
      text.style.fontSize = `${size.toFixed(1)}px`;
      text.replaceChildren(...lines.map(l => el('span', 'rw-plate-line', l)));
      b.hidden = !a;
      b.dataset['control'] = a?.id ?? '';
      b.setAttribute('aria-label', lines.join(' '));
      b.onclick = a
        ? () => {
            sound.ui('press');
            a.run();
          }
        : null;
    });
  }

  const address = (piece: string): string => (art as Art).rewardsAddress(piece);
  const sizeOf = (piece: string): { w: number; h: number } => {
    const p = (art as Art).REWARDS_ART[piece];
    if (!p) throw new Error(`the rewards screen's art: no piece ${piece}`);
    return { w: p.width, h: p.height };
  };

  /** A picture on a sheet, `h` tall, its middle at `x` and its top at `y`. */
  function picOn(sheet: HTMLElement, cls: string, piece: string, at: { x: number; y: number; h: number }): HTMLDivElement {
    const s = sizeOf(piece);
    const w = (at.h * s.w) / s.h;
    const d = el('div', `rw-pic ${cls}`.trim());
    d.style.left = `${at.x - w / 2}px`;
    d.style.top = `${at.y}px`;
    d.style.width = `${w}px`;
    d.style.height = `${at.h}px`;
    d.style.backgroundImage = `url("${address(piece)}")`;
    d.setAttribute('aria-hidden', 'true');
    return sheet.appendChild(d);
  }

  function clear(): void {
    for (const s of [clipInk, leftInk, rightInk, leftOn, rightOn]) s.replaceChildren();
    medal.hidden = true;
    medal.classList.remove('rw-in', 'rw-k-settle');
  }

  /** The medal's case, large over the left page. */
  function showCase(piece: string): void {
    const s = sizeOf(piece);
    const w = (CASE.h * s.w) / s.h;
    place(medal, { x: CASE.x - w / 2, y: CASE.top, w, h: CASE.h });
    medal.style.transform = `rotate(${CASE.turn}deg)`;
    medalPic.style.backgroundImage = `url("${address(piece)}")`;
    glint.style.backgroundImage = `url("${address(piece)}")`;
    medal.dataset['medal'] = piece;
    medal.hidden = false;
  }

  /** The rank on the right page: the heading, the boards, the rank's name, a typed line under it, and the citation at the foot. Returns its parts. */
  function showRank(o: { head: string; label: string; rank: { name: string; art: string }; under: string; citation: readonly string[] }): { head: HTMLElement; rule: HTMLElement; boards: HTMLElement; label: HTMLElement; name: HTMLElement; under: HTMLElement; foot: HTMLElement; citation: HTMLElement[] } {
    const x = 281;
    const head = lineOn(rightInk, 'stencil', 'rw-sub', o.head, { x, base: 98, size: 88, align: 'mid', max: 536 });
    const rule = ruleOn(rightInk, 30, 532, 114);
    const boards = picOn(rightOn, 'rw-boards', o.rank.art, { x, y: 130, h: 284 });
    boards.dataset['rank'] = o.rank.art;
    const label = lineOn(rightInk, 'stencil', 'rw-sub', o.label, { x, base: 460, size: 54, align: 'mid', max: 500 });
    const name = lineOn(rightInk, 'stencil', 'rw-sub rw-rank-name', o.rank.name, { x, base: 553, size: 124, align: 'mid', max: 510 });
    const under = lineOn(rightInk, 'typed', '', o.under, { x, base: 594, size: 39, align: 'mid', max: 510 });
    const foot = ruleOn(rightInk, 60, 502, 612);
    // The citation: at his size on up to three lines; a longer one is typed smaller, on up to four.
    let citation: HTMLElement[] = [];
    for (const size of CITATION.sizes) {
      const lines = citationLines(o.citation, Math.floor(CITATION.width / (size * TYPED_FACE.advance * TYPED_NARROW.base)));
      if (lines.length * size * CITATION.pitch > CITATION.height && size !== CITATION.sizes[CITATION.sizes.length - 1]) continue;
      citation = lines.map((l, i) => lineOn(rightInk, 'typed', 'rw-citation', l, { x: CITATION.x, base: 652 + i * size * CITATION.pitch, size, align: 'mid', max: CITATION.width }));
      break;
    }
    return { head, rule, boards, label, name, under, foot, citation };
  }

  /** The rows of a clipboard: a typed label at the left, its figure at the right. Returns each row's baseline and its two lines. */
  function rowsOn(rows: readonly { label: string; value: string }[], from: number, pitch: number): { base: number; label: HTMLElement; value: HTMLElement }[] {
    return rows.map((row, i) => {
      const base = from + i * pitch;
      return {
        base,
        label: lineOn(clipInk, 'typed', 'rw-row', `${row.label}:`, { x: 112, base, size: 56, max: 600 }),
        value: lineOn(clipInk, 'typed', 'rw-row', row.value, { x: 926, base, size: 56, align: 'end', max: 300 }),
      };
    });
  }

  // ---- the rewards of the last battle -------------------------------------------------------------------------

  function showAward(a: Award, play: boolean): void {
    const d = data as RewardsData;
    view = 'rewards';
    clear();
    const r = a.report;
    const sideData = d.sides[r.side];
    const outcome = d.outcomes[a.outcome];
    /** The part comes onto the page `t` seconds after the screen opens (when the appearance is played; else it is simply there). */
    const come = <E extends HTMLElement>(e: E, how: Coming, t: number): E => {
      if (play) {
        e.classList.add('rw-in', `rw-k-${how}`);
        e.style.setProperty('--at', `${t.toFixed(2)}s`);
      }
      return e;
    };

    // The clipboard: the outcome, the battle, the game's own end line; what happened; the points.
    come(lineOn(clipInk, 'stencil', 'rw-head', W.outcomeLine(outcome.words, outcome.words.length > 8), { x: 518, base: 109, size: 112, align: 'mid', max: 912 }), 'press', 0.15);
    come(ruleOn(clipInk, 64, 978, 126), 'write', 0.3);
    come(lineOn(clipInk, 'stencil', 'rw-sub', r.level ? W.battleLine(r.title, W.levels[r.level] ?? r.level) : r.title, { x: 500, base: 200, size: 74, align: 'mid', max: 700 }), 'fade', 0.42);
    // The game's own end line, typed under the battle's name: on one line, or on two when it is long.
    const said = r.said ? typedLines(r.said, 44).slice(0, 2) : [];
    said.forEach((l, i) => come(lineOn(clipInk, 'typed', 'rw-said', l, { x: 492, base: 243 + i * 35, size: 35, align: 'mid', max: 690 }), 'fade', 0.52 + i * 0.06));

    const held = new Set(d.deeds.filter(x => a.medal.why.includes(x.why)).map(x => x.test));
    const marks: (null | 'tick' | 'cross')[] = [
      held.has('enemy-losses-at-least') ? 'tick' : null,
      held.has('own-losses-at-most') ? 'tick' : held.has('own-losses-at-least') ? 'cross' : null,
      held.has('all-objectives-held') ? 'tick' : null,
    ];
    const earned = a.pointsAfter - a.pointsBefore;
    const totals: { label: string; value: string }[] = [{ label: W.score, value: W.scoreLine(r.scores[0], r.scores[1]) }];
    if (r.campaign) totals.push({ label: W.campaignPoints, value: W.gained(r.campaign.points) });
    totals.push({ label: W.servicePoints, value: W.gained(earned) });
    // The rows go down the sheet from under the end line at his pitch (closer, were there ever too many for the sheet).
    const from = 304 + Math.max(0, said.length - 1) * 33;
    const pitch = Math.min(ROWS.pitch, (ROWS.last - from - ROWS.gap) / (2 + totals.length));
    const rows = rowsOn(
      [
        { label: W.enemyDestroyed, value: W.ofAll(r.enemy.destroyed, r.enemy.units) },
        { label: W.yourLosses, value: W.ofAll(r.own.destroyed, r.own.units) },
        { label: W.objectives, value: W.ofAll(r.held, r.objectives) },
      ],
      from,
      pitch,
    );
    rows.forEach((row, i) => {
      come(row.label, 'write', 0.72 + i * 0.1);
      come(row.value, 'fade', 0.82 + i * 0.1);
      const mark = marks[i];
      if (mark) come(tickOn(clipInk, { x: 50, y: row.base - 52, size: 58, seed: i + 1, cross: mark === 'cross' }), 'write', 1.0 + i * 0.1);
    });
    // The rule between what happened and the points, in a gap wide enough for the stamp at its right end.
    const lastRow = (rows[rows.length - 1] as { base: number }).base;
    const rule = lastRow + ROWS.gap * 0.5 + 12;
    come(ruleOn(clipInk, 112, 926, rule), 'write', 1.04);
    const sums = rowsOn(totals, lastRow + pitch + ROWS.gap, pitch);
    sums.forEach((row, i) => {
      come(row.label, 'write', 1.12 + i * 0.1);
      come(row.value, 'fade', 1.22 + i * 0.1);
    });
    // A tick by the service points, when the battle earned any.
    if (earned > 0) come(tickOn(clipInk, { x: 944, y: (sums[sums.length - 1] as { base: number }).base - 62, size: 68, seed: 7 }), 'write', 1.3 + sums.length * 0.1);
    // Our own stamps: the outcome in a ring where the sheet's corner is clear (its thud is the screen's one sound),
    // Confirmed at the rule, Recorded at the foot.
    const ring = come(ringStamp(clipInk, { x: 950, y: 198, d: 152, turn: 9, over: W.stampOver, under: W.stampUnder, middle: outcome.words.split(' '), id: 'rw-ring' }), 'stamp', 1.6);
    if (play) ring.addEventListener('animationstart', () => sound.ui('stamp'), { once: true });
    come(boxStamp(clipInk, W.confirmed, { x: 934, y: rule + 2, size: 26, turn: -7 }), 'stamp', 1.8);
    come(boxStamp(clipInk, W.recorded, { x: 150, y: 694, size: 30, turn: 7 }), 'stamp', 1.95);

    // The left page: the medal, large in its open case, and its name.
    if (a.medal.tier > 0) {
      const m = sideData.medals[a.medal.tier - 1] as { name: string; art: string };
      showCase(m.art);
      come(medal, 'settle', 0.45);
      // The glint's first pass, once the case has settled; then it comes round again, as light does on a thing left lying.
      glint.style.setProperty('--at', play ? '1.15s' : '0.5s');
      come(lineOn(leftInk, 'stencil', 'rw-sub rw-medal-name', m.name, { x: 276, base: 744, size: 56, align: 'mid', max: 510 }), 'fade', 1.0);
    } else {
      come(frameOn(leftInk, { x: 98, y: 146, w: 372, h: 458 }), 'fade', 0.6);
      come(lineOn(leftInk, 'stencil', 'rw-sub rw-none-words', W.noMedal, { x: 284, base: 396, size: 84, align: 'mid', max: 300 }), 'fade', 0.8);
    }

    // The right page: the rank, and why the medal was given (or was not). A new rank's name comes last, by itself.
    const ranks = sideData.ranks;
    const now = ranks[a.rankAfter] as { name: string; art: string };
    const promoted = a.rankAfter > a.rankBefore;
    const next = (rules as Rules).toNext(d, r.side, a.pointsAfter);
    const page = showRank({
      head: promoted ? W.promotionHead : W.rankHonors,
      label: promoted ? W.newRank : W.rankLabel,
      rank: now,
      under: promoted ? W.promotedFrom((ranks[a.rankBefore] as { name: string }).name) : next ? W.toNext(next.of - next.done, next.next) : W.highest,
      citation: a.medal.tier > 0 ? a.medal.why : [...a.medal.why, W.noMedalWhy],
    });
    come(page.head, 'fade', 0.5);
    come(page.rule, 'write', 0.6);
    come(page.boards, 'settle', 0.72);
    come(page.label, 'fade', 0.98);
    come(page.name, 'press', promoted ? 2.2 : 1.12);
    come(page.under, 'fade', promoted ? 2.45 : 1.3);
    come(page.foot, 'write', 1.38);
    page.citation.forEach((l, i) => come(l, 'fade', 1.48 + i * 0.07));

    // The plates.
    const onward: PlateAction = r.campaign
      ? { words: W.continue, id: 'continue', run: () => void import('../campaign/battle').then(m => m.continueCampaign()) }
      : { words: W.continue, id: 'continue', run: () => shell.go('scenarios', { scenario: r.scenario, online: r.online }) };
    const again = r.again;
    // Play Again stands between the way on and the main menu in a single battle; without it the main menu takes its place.
    const menu: PlateAction = { words: W.mainMenu, id: 'main-menu', run: () => shell.go('title') };
    setPlates([{ words: W.recordPlate, id: 'service', run: () => shell.go('service') }, onward, ...(again ? [{ words: W.again, id: 'again', run: () => leaveFor(screen, again) }, menu] : [menu])]);
  }

  // ---- the service record -------------------------------------------------------------------------------------

  function showRecord(): void {
    const d = data as RewardsData;
    const f = file as ServiceFile;
    view = 'service';
    clear();
    const rec = f.sides[side];
    const sd = d.sides[side];
    const k = (rules as Rules).rankAt(d, side, rec.points);
    const medals = rec.medals.reduce((x, y) => x + y, 0);
    lineOn(clipInk, 'stencil', 'rw-head', W.serviceRecord, { x: 518, base: 109, size: 112, align: 'mid', max: 912 });
    ruleOn(clipInk, 64, 978, 126);
    lineOn(clipInk, 'stencil', 'rw-sub', W.recordSide(sd.name), { x: 505, base: 200, size: 74, align: 'mid', max: 720 });
    const bases = rowsOn(
      [
        { label: W.fought, value: String(rec.fought) },
        { label: W.won, value: String(rec.won) },
        { label: W.lost, value: String(rec.lost) },
      ],
      298,
      57,
    ).map(row => row.base);
    const rule = (bases[bases.length - 1] as number) + 30;
    ruleOn(clipInk, 112, 926, rule);
    rowsOn(
      [
        { label: W.medals, value: String(medals) },
        { label: W.servicePoints, value: String(rec.points) },
      ],
      rule + 63,
      57,
    );

    // The left page: the side's five medals, lowest first, with how many of each.
    lineOn(leftInk, 'stencil', 'rw-sub', W.medals, { x: 280, base: 98, size: 88, align: 'mid', max: 500 });
    ruleOn(leftInk, 40, 520, 114);
    const cells: readonly (readonly [number, number])[] = [[104, 132], [280, 132], [456, 132], [192, 436], [368, 436]];
    sd.medals.forEach((m, i) => {
      const n = rec.medals[i] ?? 0;
      const [x, y] = cells[i] as readonly [number, number];
      const pic = n === 0 ? picOn(leftInk, 'rw-unearned', m.art, { x, y, h: 252 }) : picOn(leftOn, 'rw-boards', m.art, { x, y, h: 252 });
      pic.dataset['medal'] = m.art;
      lineOn(leftInk, 'typed', '', W.times(n), { x, base: y + 290, size: 40, align: 'mid', max: 160 });
    });

    // The right page: the rank and the way on.
    const next = (rules as Rules).toNext(d, side, rec.points);
    showRank({ head: W.rankHead, label: W.rankLabel, rank: sd.ranks[k] as { name: string; art: string }, under: next ? W.toNext(next.of - next.done, next.next) : W.highest, citation: [W.recordNote(rec.won, medals)] });

    const other: ServiceSide = side === 'german' ? 'soviet' : 'german';
    setPlates([
      null,
      { words: W.back, id: 'back', run: back },
      { words: W.showSide(d.sides[other].name), id: 'side', run: () => { side = other; showRecord(); } },
      { words: W.mainMenu, id: 'main-menu', run: () => shell.go('title') },
    ]);
  }

  function back(): void {
    const state: unknown = window.history.state;
    if (typeof state === 'object' && state !== null && (state as { from?: unknown }).from === 'rewards') window.history.back();
    else shell.go('title');
  }

  let loading: Promise<void> | null = null;
  const load = (): Promise<void> =>
    (loading ??= Promise.all([import('./rewards-rules'), import('./rewards-art'), import('./rewards-data')]).then(([r, a, e]) => {
      rules = r;
      art = a;
      data = e.rewardsData();
      desk.style.backgroundImage = `url("${a.rewardsAddress('desk')}")`;
      plates.forEach((b, i) => {
        const p = PLATE_AT[i];
        if (p) (b.firstElementChild as HTMLElement).style.backgroundImage = `url("${a.plateAddress(p.kind)}")`;
      });
    }));

  /**
   * The page's two faces and these pictures, fetched and ready to draw before its parts come on (a line pressed on in
   * a face that has not come yet would come on unseen, and a case would settle before it could be seen). The wait is
   * bounded by the page's own animation clock, not by a timer: what has not come in a moment is not waited for.
   */
  function ready(pictures: readonly string[]): Promise<void> {
    const faces = [`800 100px "Stick No Bills"`, `${TYPED_WEIGHT} 100px "${TYPED_FAMILY}"`].map(f => document.fonts.load(f));
    const drawn = pictures.map(p => {
      const img = new Image();
      img.src = address(p);
      return img.decode();
    });
    const all = Promise.all([...faces, ...drawn]).then(() => undefined, () => undefined);
    const longest = desk.animate([], { duration: READY_WAIT_MS }).finished.then(() => undefined, () => undefined);
    return Promise.race([all, longest]);
  }

  const shown = (): HTMLButtonElement[] => plates.filter(p => !p.hidden);
  /** The plate that goes on: Continue, or the record's Back. */
  const wayOn = (): HTMLButtonElement | undefined => shown().find(p => p.dataset['control'] === 'continue' || p.dataset['control'] === 'back') ?? shown()[0];

  /** For checks: the screen shown answers (the rewards and the record are two screens of this one module). */
  const checks: NonNullable<Window['__rewards']> = {
    view: () => view,
    award: () => file?.last ?? null,
    record: () => file,
    press: control => {
      const b = shown().find(x => x.dataset['control'] === control);
      if (!b) return false;
      b.click();
      return true;
    },
  };

  return {
    id: id as ScreenId,
    element: screen,
    show() {
      window.__rewards = checks;
      view = null;
      void load().then(() => {
        const r = rules as Rules;
        file = r.readService(r.browserService());
        const last = file.last;
        // The record opens on the side of the last battle fought.
        if (last) side = last.report.side;
        if (id === 'rewards' && last) {
          // Its appearance is played the first time it is shown; come back to (from the record), it is simply there.
          const play = !still && played !== last.report.id;
          played = last.report.id;
          if (!play) {
            showAward(last, false);
            return;
          }
          // Played once what it shows is ready to be seen: the faces, the desk, the medal's case and the rank's boards.
          const d = data as RewardsData;
          const sd = d.sides[last.report.side];
          const medalArt = last.medal.tier > 0 ? [(sd.medals[last.medal.tier - 1] as { art: string }).art] : [];
          return ready(['desk', ...medalArt, (sd.ranks[last.rankAfter] as { art: string }).art]).then(() => {
            // (Another screen may have been shown meanwhile: the award is then simply there when this one is come back to.)
            showAward(last, screen.classList.contains('sh-current'));
          });
        }
        showRecord();
        return undefined;
      }).catch((err: unknown) => {
        console.error(err);
      });
    },
    hide() {
      /* nothing is open over it */
    },
    key(e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return false;
      hurry();
      if (e.key === 'Escape') {
        sound.ui('press');
        if (view === 'service') back();
        else shell.go('title');
        return true;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const list = shown();
        const at = list.indexOf(document.activeElement as HTMLButtonElement);
        // With the keyboard on none of them, the arrows begin at the way on.
        const to = at < 0 ? wayOn() : list[Math.max(0, Math.min(list.length - 1, at + (e.key === 'ArrowRight' ? 1 : -1)))];
        to?.focus({ preventScroll: true });
        return true;
      }
      // Enter with the keyboard on nothing presses the way on, as on the other screens.
      if (e.key === 'Enter' && (document.activeElement === document.body || document.activeElement === null)) {
        wayOn()?.click();
        return true;
      }
      return false;
    },
  };
}
