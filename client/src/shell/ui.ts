/**
 * Small pieces every screen of the shell shares: making an element, placing it in stage pixels, the
 * line that answers a press (it comes, stays a moment and goes), and leaving the page for another
 * address once the screen has gone dark. The only timers of the screens' interface are here.
 */
import type { Box } from './layout';
import type { Piece } from './manifest';
import type { Spot } from './screen-places';
import { EASE } from './style';

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** Places an element on its box, in stage pixels. */
export function place(e: HTMLElement, b: Box): void {
  e.style.left = `${b.x}px`;
  e.style.top = `${b.y}px`;
  e.style.width = `${b.w}px`;
  e.style.height = `${b.h}px`;
}

/** A piece of the art as an element on the stage, where the index puts it (or on `b`). */
export function pictureOf(piece: Piece, address: (file: string) => string, cls: string, b?: Box): HTMLDivElement {
  const e = el('div', `sh-picture ${cls}`.trim());
  e.style.backgroundImage = `url("${address(piece.file)}")`;
  place(e, b ?? { x: piece.at[0], y: piece.at[1], w: piece.width, h: piece.height });
  e.setAttribute('aria-hidden', 'true');
  return e;
}

/** A line of words set by its middle. */
export function wordsAt(e: HTMLElement, s: Spot): void {
  e.style.left = `${s.x}px`;
  e.style.top = `${s.y}px`;
  e.style.fontSize = `${s.size}px`;
}

/** A refusal's shake: a few steps either side, dying away (stage pixels). */
export const SHAKE: Keyframe[] = [{ transform: 'translateX(0)' }, { transform: 'translateX(-14px)' }, { transform: 'translateX(11px)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }];
/** The viewer asks for less motion. */
export const REDUCED = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface Answer {
  /** Says `text` with its right edge (or its middle) at this place; `refused` shakes it. */
  say(text: string, at: { x: number; y: number; align: 'right' | 'middle' }, refused?: boolean): void;
  readonly element: HTMLElement;
}

/** The line that answers a press, in `root`: a tag that comes in, stays a moment, and goes. */
export function answerIn(root: HTMLElement): Answer {
  const tag = el('div', 'sh-answer sh-answer-line');
  tag.setAttribute('role', 'status');
  tag.setAttribute('aria-live', 'polite');
  root.append(tag);
  let timer = 0;
  return {
    element: tag,
    say(text, at, refused = false) {
      tag.textContent = text;
      tag.style.left = `${at.x}px`;
      tag.style.top = `${at.y}px`;
      tag.style.translate = at.align === 'right' ? '-100% -50%' : '-50% -50%';
      tag.classList.toggle('sh-refused', refused);
      tag.classList.add('sh-shown');
      // A refusal shakes the line (sideways, and settles), each time.
      if (refused && !REDUCED()) tag.animate(SHAKE, { duration: 380, easing: 'ease-out' });
      window.clearTimeout(timer);
      timer = window.setTimeout(() => tag.classList.remove('sh-shown'), EASE.answerStay * 1000);
    },
  };
}

/** A button that shows that it is held down (pointer or key), as the menu's plates do. */
export function pressable(b: HTMLElement): void {
  b.addEventListener('pointerdown', () => b.classList.add('sh-down'));
  for (const up of ['pointerup', 'pointerleave', 'pointercancel', 'blur'] as const) b.addEventListener(up, () => b.classList.remove('sh-down'));
  b.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) b.classList.add('sh-down');
  });
  b.addEventListener('keyup', () => b.classList.remove('sh-down'));
}

/** A tag at the foot of a screen: its picture (at its own place or at `at`), its words set by their middle on the stage, and a press. */
export function tagButton(o: { root: HTMLElement; picture: Piece; address: (file: string) => string; at?: readonly [number, number]; words: string; text: Spot; id: string; press(): void }): HTMLButtonElement {
  const t = el('button', 'sh-tag');
  t.type = 'button';
  t.dataset['control'] = o.id;
  const [x, y] = o.at ?? o.picture.at;
  place(t, { x, y, w: o.picture.width, h: o.picture.height });
  t.style.backgroundImage = `url("${o.address(o.picture.file)}")`;
  const text = el('span', 'sh-tag-text', o.words);
  // Inside the tag, the words' middle is measured from the tag's corner.
  text.style.left = `${o.text.x - x}px`;
  text.style.top = `${o.text.y - y}px`;
  text.style.fontSize = `${o.text.size}px`;
  t.append(text);
  t.addEventListener('click', () => o.press());
  pressable(t);
  o.root.append(t);
  return t;
}

/** Seconds a screen takes to go dark before the page leaves for another address. */
export const LEAVE_S = 0.32;

/** The screen goes dark, then the page goes to `to` (nothing snaps). Come back to by the browser's Back, it is lit again. */
export function leaveFor(screen: HTMLElement, to: string, after = LEAVE_S): void {
  screen.style.transition = `opacity ${after}s ease`;
  screen.style.opacity = '0';
  window.setTimeout(() => window.location.assign(to), after * 1000);
  window.addEventListener(
    'pageshow',
    e => {
      if (e.persisted) screen.style.opacity = '1';
    },
    { once: true },
  );
}
