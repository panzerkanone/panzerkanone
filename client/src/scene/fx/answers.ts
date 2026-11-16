/**
 * The table's answers to what a player does (the owner's rule of 2026-11-13: every action is
 * answered, done or refused). The port's two optional members end here:
 *
 *   intent   what a click on the hex under the pointer would do: a small moving picture of the act
 *            and its words, over the counter of that hex (never on its numbers), gliding from hex
 *            to hex; and the mouse's cursor over the table says the same.
 *   answer   a badge that appears at a hex, floats up and fades; a red X that shakes and goes,
 *            with why beside it; a shot leaving a counter, and what came of it where it lands.
 *
 * They are plain page elements laid over the table's canvas (letters stay letters, and face the
 * viewer from every camera), each tied to a place on the board: the page calls `sync` when its
 * camera has moved. Their movement is the style sheet's, so nothing here asks the table for a
 * frame, and the table rests while a mark shows. A shot is the effects' to draw (watch.ts); with
 * the effects off (`fx=0`) a plain stroke stands in for it, because these marks are how the game
 * is played and stay on.
 */
import type { IntentAct, TableAnswer } from '../pieces/port';
import type { AnswersHook, Intent } from './hook';
import { INTENT_ACTS, cursorCss, iconSvg, inkCss } from './icons';
import type { FxTune } from './tune';

export type { AnswersHook, Intent } from './hook';

declare global {
  interface Window {
    /**
     * Parts of the page over the table that a mark should not fall behind, in the window's pixels (a game's panel sets
     * it: its box of words). Absent: none.
     */
    __tableAvoid?: () => readonly { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }[];
  }
}

type P2 = readonly [number, number];
export interface AnswersMount {
  /** What the pieces hand a game's `intent` and `answer` to. */
  port: { intent(i: Intent | null): void; answer(a: TableAnswer): void };
  hook: AnswersHook;
  /** The camera moved (or the window changed): every mark is put where its place on the board now is. */
  sync(): void;
}

/** A mark tied to a place on the board. */
interface Tied {
  kind: 'intent' | 'badge' | 'refused';
  hex: number;
  words: string;
  box: HTMLElement;
  /** Its place: a board point, and pixels from where that point is seen. */
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
}

const STYLE_ID = 'tfb-style';

function styleText(t: FxTune['mark']): string {
  const ink = inkCss(t.ink);
  const paper = inkCss(t.paper, 0.95);
  // A badge is its tone, filled, with the paper's colour for its words: an answer is meant to be seen.
  const tone = (name: string, c: readonly number[]): string => `.tfb-${name}{background:${inkCss(c, 0.96)};color:${inkCss(t.paper)};border-color:${inkCss(t.paper, 0.8)}}`;
  return `
.tfb-layer{position:fixed;left:0;top:0;width:0;height:0;z-index:6;pointer-events:none;font:600 13px/1.25 system-ui,sans-serif}
.tfb-tie{position:absolute;left:0;top:0;will-change:transform}
.tfb-pill{position:absolute;white-space:nowrap;background:${paper};color:${ink};border:1px solid ${inkCss(t.ink, 0.28)};border-radius:7px;padding:2px 8px;box-shadow:0 1px 3px ${inkCss(t.ink, 0.28)}}
.tfb-chip{display:flex;align-items:center;gap:5px;padding:2px 8px 2px 4px;transform:translate(-50%,-100%);opacity:0;transition:opacity ${t.fadeS}s ease}
.tfb-chip[data-on="1"]{opacity:1}
.tfb-chip.tfb-below{transform:translate(-50%,0)}
.tfb-chip[data-can="0"]{color:${inkCss(t.bad)};border-color:${inkCss(t.bad, 0.5)}}
.tfb-icon{position:relative;width:24px;height:24px;flex:none}
.tfb-icon svg{position:absolute;left:0;top:0;overflow:visible}
.tfb-chip[data-can="0"] .tfb-act{opacity:0.72}
.tfb-icon svg *{transform-box:fill-box;transform-origin:center}
${tone('good', t.good)}${tone('bad', t.bad)}${tone('plain', t.plain)}
.tfb-badge{font-size:15px;padding:3px 10px;transform:translate(-50%,-100%);animation:tfb-float ${t.badgeS}s cubic-bezier(.2,.7,.3,1) both}
@keyframes tfb-float{0%{opacity:0;transform:translate(-50%,-100%) scale(.86)}9%{opacity:1;transform:translate(-50%,calc(-100% - var(--rise)*.12)) scale(1)}62%{opacity:1}100%{opacity:0;transform:translate(-50%,calc(-100% - var(--rise)))}}
.tfb-x{position:absolute;left:0;top:0;width:var(--x);height:var(--x);margin:calc(var(--x)*-.5) 0 0 calc(var(--x)*-.5);animation:tfb-shake ${t.shakeS}s ease-in-out both}
@keyframes tfb-shake{0%{opacity:0;transform:scale(.55) rotate(0)}10%{opacity:1;transform:scale(1.04) rotate(-17deg)}24%{transform:scale(1) rotate(15deg)}38%{transform:rotate(-12deg)}52%{transform:rotate(9deg)}66%{transform:rotate(-6deg)}80%{opacity:1;transform:rotate(3deg)}100%{opacity:0;transform:scale(1.04) rotate(0)}}
.tfb-why{font-size:14px;left:calc(var(--x)*.5 + 5px);top:0;transform:translateY(-50%);color:${inkCss(t.bad)};border-color:${inkCss(t.bad, 0.5)};animation:tfb-why ${t.whyS}s ease both}
@keyframes tfb-why{0%{opacity:0;transform:translate(-6px,-50%)}9%{opacity:1;transform:translate(0,-50%)}78%{opacity:1}100%{opacity:0;transform:translate(0,-50%)}}
.tfb-shot{position:fixed;left:0;top:0;overflow:visible;pointer-events:none}
.tfb-shot line{stroke-linecap:round;animation:tfb-shot ${t.shotS}s ease-out both}
.tfb-shot circle{animation:tfb-pop ${t.shotS}s ease-out both;transform-box:fill-box;transform-origin:center}
@keyframes tfb-shot{0%{stroke-dashoffset:var(--len);opacity:0}15%{opacity:1}55%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:0;opacity:0}}
@keyframes tfb-pop{0%{opacity:0;transform:scale(.3)}25%{opacity:.95}100%{opacity:0;transform:scale(1.5)}}
.tfb-select .a,.tfb-order .a{animation:tfb-tap 1.5s ease-in-out infinite}
.tfb-order .b{animation:tfb-go 1.5s ease-in-out infinite}
.tfb-move .a{animation:tfb-step 1.2s ease-in-out infinite}
.tfb-move .b{animation:tfb-step 1.2s ease-in-out .2s infinite}
.tfb-fire .a{animation:tfb-close 1.5s ease-in-out infinite}
.tfb-fire .b{animation:tfb-ticks 1.5s ease-in-out infinite}
.tfb-charge .a{animation:tfb-cross-a 1.4s ease-in-out infinite}
.tfb-charge .b{animation:tfb-cross-b 1.4s ease-in-out infinite}
.tfb-drive .a{animation:tfb-through 1.3s ease-in-out infinite}
.tfb-board .a{animation:tfb-up 1.3s ease-in-out infinite}
.tfb-unload .a{animation:tfb-down 1.3s ease-in-out infinite}
.tfb-call .a{animation:tfb-arc 1.1s linear infinite}
.tfb-call .b{animation:tfb-burst 1.1s ease-out infinite}
.tfb-screen .a{animation:tfb-puff 2.2s ease-in-out infinite}
.tfb-screen .b{animation:tfb-puff 2.2s ease-in-out .5s infinite}
.tfb-place .a{animation:tfb-drop 1.4s cubic-bezier(.3,0,.4,1) infinite}
@keyframes tfb-tap{0%,100%{transform:translateY(-1.2px)}45%{transform:translateY(1.2px)}}
@keyframes tfb-go{0%,100%{opacity:.25;transform:translateX(-2px)}50%{opacity:1;transform:translateX(1px)}}
@keyframes tfb-step{0%,100%{opacity:.3}40%{opacity:1}}
@keyframes tfb-close{0%{transform:scale(1.42);opacity:.3}55%,100%{transform:scale(1);opacity:1}}
@keyframes tfb-ticks{0%{transform:scale(1.25);opacity:.3}55%,100%{transform:scale(1);opacity:1}}
@keyframes tfb-cross-a{0%,100%{transform:rotate(-16deg)}50%{transform:rotate(0)}}
@keyframes tfb-cross-b{0%,100%{transform:rotate(16deg)}50%{transform:rotate(0)}}
@keyframes tfb-through{0%{transform:translateX(-5px);opacity:.2}60%,100%{transform:translateX(1px);opacity:1}}
@keyframes tfb-up{0%,100%{transform:translateY(2.5px);opacity:.45}55%{transform:translateY(-1px);opacity:1}}
@keyframes tfb-down{0%,100%{transform:translateY(-2.5px);opacity:.45}55%{transform:translateY(1px);opacity:1}}
@keyframes tfb-arc{0%{stroke-dashoffset:10.8}100%{stroke-dashoffset:0}}
@keyframes tfb-burst{0%,55%{opacity:0;transform:scale(.4)}75%{opacity:1;transform:scale(1.15)}100%{opacity:0;transform:scale(1.3)}}
@keyframes tfb-puff{0%,100%{transform:scale(.9)}50%{transform:scale(1.07)}}
@keyframes tfb-drop{0%{transform:translateY(-6px);opacity:.3}45%,100%{transform:translateY(3.5px);opacity:1}}
@media (prefers-reduced-motion: reduce){
.tfb-icon svg *{animation:none!important}
.tfb-badge{animation-name:tfb-fade}
.tfb-x{animation-name:tfb-fade-x}
@keyframes tfb-fade{0%{opacity:0;transform:translate(-50%,-100%)}12%,70%{opacity:1}100%{opacity:0;transform:translate(-50%,-100%)}}
@keyframes tfb-fade-x{0%{opacity:0}15%,75%{opacity:1}100%{opacity:0}}
}`;
}

export function mountAnswers(o: {
  root: HTMLElement;
  canvas: HTMLElement;
  /** Where a board point is seen in the window, in CSS pixels; null when it is behind the camera. */
  project(x: number, y: number, z: number): P2 | null;
  hexes: { count: number; centre(hex: number): P2 };
  /** How high the stack on a hex stands, in h; a counter's side, in h. */
  stackTop(hex: number): number;
  counterSide: number;
  /** Where a counter is, by its id; null where the table has none of that name. */
  placeOf(id: string): P2 | null;
  dials: FxTune['mark'];
  /** The effects, when they are on: they draw a shot and what comes of it. Null: a plain stroke is drawn here. */
  shots: { fired(a: Extract<TableAnswer, { kind: 'fired' }>): void; landed(a: Extract<TableAnswer, { kind: 'landed' }>): void } | null;
  /** The cursor the intent asks of the table (a style sheet's value), or null when there is no intent. `spoken`: a game has told an intent at least once. */
  cursor(css: string | null, spoken: boolean): void;
}): AnswersMount {
  const t = o.dials;
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = styleText(t);
    document.head.appendChild(style);
  }
  const layer = document.createElement('div');
  layer.className = 'tfb-layer';
  // What the marks say is said to a reader of the page too.
  layer.setAttribute('aria-live', 'polite');
  o.root.appendChild(layer);

  const started = { intent: 0, cleared: 0, badge: 0, refused: 0, fired: 0, landed: 0 };
  const tied = new Set<Tied>();
  let shots = 0;
  const cursors = new Map<string, string>();
  const cursorOf = (name: IntentAct | 'no'): string => {
    let css = cursors.get(name);
    if (css === undefined) {
      css = cursorCss(name, name === 'no' ? t.bad : t.ink, t.paper);
      cursors.set(name, css);
    }
    return css;
  };

  /** The four corners of the top of the stack on a hex, as seen: the least and the greatest of them. */
  const seen = (hex: number): { cx: number; cy: number; top: number; bottom: number; size: number } | null => {
    const c = o.hexes.centre(hex);
    const z = o.stackTop(hex);
    const mid = o.project(c[0], c[1], z);
    if (!mid) return null;
    const h = o.counterSide / 2;
    let top = mid[1];
    let bottom = mid[1];
    let left = mid[0];
    let right = mid[0];
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const p = o.project(c[0] + sx * h, c[1] + sy * h, z);
      if (!p) continue;
      top = Math.min(top, p[1]);
      bottom = Math.max(bottom, p[1]);
      left = Math.min(left, p[0]);
      right = Math.max(right, p[0]);
    }
    return { cx: mid[0], cy: mid[1], top, bottom, size: Math.max(right - left, bottom - top) };
  };

  const put = (m: Tied, glide: boolean): void => {
    const p = o.project(m.x, m.y, m.z);
    if (!p) {
      m.box.style.visibility = 'hidden';
      return;
    }
    m.box.style.visibility = '';
    m.box.style.transition = glide ? `transform ${t.glideS}s ease-out` : 'none';
    m.box.style.transform = `translate3d(${(p[0] + m.dx).toFixed(1)}px,${(p[1] + m.dy).toFixed(1)}px,0)`;
  };

  const tie = (kind: Tied['kind'], hex: number, words: string, dx: number, dy: number): Tied => {
    const c = o.hexes.centre(hex);
    const box = document.createElement('div');
    box.className = 'tfb-tie';
    layer.appendChild(box);
    const m: Tied = { kind, hex, words, box, x: c[0], y: c[1], z: o.stackTop(hex), dx, dy };
    tied.add(m);
    return m;
  };
  const untie = (m: Tied): void => {
    tied.delete(m);
    m.box.remove();
  };
  const onBoard = (hex: number): boolean => Number.isInteger(hex) && hex >= 0 && hex < o.hexes.count;

  // ---- what a click would do -------------------------------------------------------------------------
  let intent: Intent | null = null;
  let chip: { tie: Tied; pill: HTMLElement; icon: HTMLElement; words: HTMLElement; key: string } | null = null;
  /**
   * Where the chip lies from its counter: over it, its foot a little above the counter's far edge as seen; or, where it
   * would lie there on a part of the page that asks to be kept clear (`window.__tableAvoid`: the game's box of words,
   * over the top rows of the board), under it, its head a little below the counter's near edge.
   */
  const placeChip = (c: NonNullable<typeof chip>, hex: number): void => {
    const at = seen(hex);
    const over = at ? at.top - at.cy - t.gap : -t.gap;
    let below = false;
    const avoid = at ? window.__tableAvoid?.() ?? [] : [];
    const p = avoid.length > 0 ? o.project(c.tie.x, c.tie.y, c.tie.z) : null;
    if (at && p) {
      const w = c.pill.offsetWidth;
      const h = c.pill.offsetHeight;
      const box = { left: p[0] - w / 2, right: p[0] + w / 2, top: p[1] + over - h, bottom: p[1] + over };
      below = avoid.some(a => box.left < a.right && box.right > a.left && box.top < a.bottom && box.bottom > a.top);
    }
    c.tie.dy = below && at ? at.bottom - at.cy + t.gap : over;
    c.pill.classList.toggle('tfb-below', below);
  };
  let leaving = 0;
  const showIntent = (i: Intent | null): void => {
    if (i && !onBoard(i.hex)) i = null;
    if (i) started.intent++;
    else if (intent) started.cleared++;
    intent = i ? { hex: i.hex, unit: i.unit, act: i.act, can: i.can, words: i.words } : null;
    o.cursor(i ? cursorOf(i.can ? i.act : 'no') : null, started.intent > 0);
    if (!i) {
      // It eases out where it is, and is taken away when it has gone.
      if (chip) {
        chip.pill.dataset.on = '0';
        const going = chip;
        window.clearTimeout(leaving);
        leaving = window.setTimeout(() => {
          if (chip === going && !intent) {
            untie(going.tie);
            chip = null;
          }
        }, t.fadeS * 1000 + 40);
      }
      return;
    }
    window.clearTimeout(leaving);
    const fresh = chip === null;
    if (!chip) {
      const made = tie('intent', i.hex, i.words, 0, 0);
      const pill = document.createElement('div');
      pill.className = 'tfb-pill tfb-chip';
      const icon = document.createElement('span');
      icon.className = 'tfb-icon';
      const words = document.createElement('span');
      pill.append(icon, words);
      made.box.appendChild(pill);
      chip = { tie: made, pill, icon, words, key: '' };
    }
    // The picture is drawn anew only when the act changes: from hex to hex the same one glides.
    const key = `${i.act}:${i.can ? 1 : 0}`;
    if (chip.key !== key) {
      chip.key = key;
      const act = INTENT_ACTS.includes(i.act) ? i.act : 'select';
      chip.icon.innerHTML = `<span class="tfb-act tfb-${act}">${iconSvg(act, 24, i.can ? t.ink : t.bad, t.paper, true)}</span>${i.can ? '' : iconSvg('strike', 24, t.bad, t.paper, false)}`;
      chip.pill.dataset.can = i.can ? '1' : '0';
    }
    if (chip.words.textContent !== i.words) chip.words.textContent = i.words;
    const c = o.hexes.centre(i.hex);
    const m = chip.tie;
    m.hex = i.hex;
    m.words = i.words;
    m.x = c[0];
    m.y = c[1];
    m.z = o.stackTop(i.hex);
    // Over the counter of its hex, clear of it: its foot a little above the counter's far edge as seen; under it where
    // over it would fall behind the page's box of words.
    placeChip(chip, i.hex);
    put(m, !fresh && chip.pill.dataset.on === '1');
    // Shown on the next pass, so that a new one eases in from nothing.
    const pill = chip.pill;
    if (pill.dataset.on !== '1') window.requestAnimationFrame(() => {
      if (intent) pill.dataset.on = '1';
    });
  };

  // ---- badges and refusals ----------------------------------------------------------------------------
  const badge = (hex: number, words: string, tone: 'good' | 'bad' | 'plain'): void => {
    if (!onBoard(hex)) return;
    started.badge++;
    const at = seen(hex);
    // Several at one hex stand one over another: a new one starts above those still showing there.
    let above = 0;
    for (const m of tied) if (m.kind === 'badge' && m.hex === hex) above++;
    const m = tie('badge', hex, words, 0, (at ? at.top - at.cy : 0) + 10 - above * t.stack);
    const pill = document.createElement('div');
    pill.className = `tfb-pill tfb-badge tfb-${tone}`;
    pill.textContent = words;
    pill.style.setProperty('--rise', `${Math.round((at ? at.size : 60) * t.rise)}px`);
    pill.addEventListener('animationend', () => untie(m));
    m.box.appendChild(pill);
    put(m, false);
  };

  const refused = (hex: number, words: string): void => {
    if (!onBoard(hex)) return;
    started.refused++;
    const m = tie('refused', hex, words, 0, 0);
    m.box.style.setProperty('--x', `${t.cross}px`);
    const x = document.createElement('div');
    x.className = 'tfb-x';
    x.innerHTML = `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke-linecap="round"><g stroke="${inkCss(t.paper)}" stroke-width="7.5"><path d="M5 5l14 14M19 5L5 19"/></g><g stroke="${inkCss(t.bad)}" stroke-width="4.4"><path d="M5 5l14 14M19 5L5 19"/></g></svg>`;
    m.box.appendChild(x);
    let left = 1;
    const gone = (): void => {
      if (--left <= 0) untie(m);
    };
    x.addEventListener('animationend', () => {
      x.remove();
      gone();
    });
    if (words !== '') {
      left++;
      const why = document.createElement('div');
      why.className = 'tfb-pill tfb-why';
      why.textContent = words;
      why.addEventListener('animationend', gone);
      m.box.appendChild(why);
    }
    put(m, false);
  };

  // ---- a shot, with the effects off: a plain stroke -----------------------------------------------------
  const NS = 'http://www.w3.org/2000/svg';
  const stroke = (from: P2, to: P2, ink: readonly number[], ring: number): void => {
    const a = o.project(from[0], from[1], 0.15);
    const b = o.project(to[0], to[1], 0.15);
    if (!a || !b) return;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'tfb-shot');
    svg.setAttribute('width', '1');
    svg.setAttribute('height', '1');
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > 1) {
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', a[0].toFixed(1));
      line.setAttribute('y1', a[1].toFixed(1));
      line.setAttribute('x2', b[0].toFixed(1));
      line.setAttribute('y2', b[1].toFixed(1));
      line.setAttribute('stroke', inkCss(ink));
      line.setAttribute('stroke-width', '3');
      line.setAttribute('stroke-dasharray', `${len.toFixed(1)}`);
      line.style.setProperty('--len', `${len.toFixed(1)}`);
      svg.appendChild(line);
    }
    const spot = document.createElementNS(NS, 'circle');
    spot.setAttribute('cx', (len > 1 ? a : b)[0].toFixed(1));
    spot.setAttribute('cy', (len > 1 ? a : b)[1].toFixed(1));
    spot.setAttribute('r', `${ring}`);
    spot.setAttribute('fill', inkCss(ink, 0.5));
    spot.setAttribute('stroke', inkCss(ink));
    spot.setAttribute('stroke-width', '2');
    svg.appendChild(spot);
    shots++;
    let left = svg.childNodes.length;
    svg.addEventListener('animationend', () => {
      if (--left > 0) return;
      svg.remove();
      shots--;
    });
    layer.appendChild(svg);
  };

  const answer = (a: TableAnswer): void => {
    if (a.kind === 'badge') badge(a.hex, a.words, a.tone);
    else if (a.kind === 'refused') refused(a.hex, a.words);
    else if (a.kind === 'fired') {
      if (!onBoard(a.from) || !onBoard(a.to)) return;
      started.fired++;
      if (o.shots) o.shots.fired(a);
      else stroke(o.placeOf(a.by) ?? o.hexes.centre(a.from), o.hexes.centre(a.to), t.shot, 7);
    } else {
      if (!onBoard(a.from) || !onBoard(a.to)) return;
      started.landed++;
      if (o.shots) o.shots.landed(a);
      else {
        const c = o.hexes.centre(a.to);
        stroke(c, c, a.result === 'none' ? t.plain : t.shot, a.result === 'destroyed' ? 20 : a.result === 'suppressed' ? 13 : 9);
      }
      if (a.words !== '') badge(a.to, a.words, a.tone);
    }
  };

  return {
    port: { intent: showIntent, answer },
    hook: {
      get intent() {
        return intent ? { ...intent } : null;
      },
      get cursor() {
        return intent ? (intent.can ? intent.act : 'no') : 'plain';
      },
      get badges() {
        let n = 0;
        for (const m of tied) if (m.kind === 'badge') n++;
        return n;
      },
      get refusals() {
        let n = 0;
        for (const m of tied) if (m.kind === 'refused') n++;
        return n;
      },
      get shots() {
        return shots;
      },
      get started() {
        return { ...started };
      },
      marks: () =>
        [...tied].map(m => {
          const r = (m.box.firstElementChild ?? m.box).getBoundingClientRect();
          return { kind: m.kind, hex: m.hex, words: m.words, x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height };
        }),
    },
    sync: () => {
      // What a click would do keeps its place over its counter (or under it, clear of the box of words) as the view changes.
      if (chip && intent) placeChip(chip, intent.hex);
      for (const m of tied) put(m, false);
    },
  };
}
