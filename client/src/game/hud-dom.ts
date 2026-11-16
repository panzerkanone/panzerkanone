/**
 * Small helpers the panel's files share: making elements, changing them only
 * when they differ, and the few parts that recur (a key cap, a rubber stamp,
 * a side's mark, a labelled line).
 */
import { hasIcon, icon } from './hud-icons';
import type { Stock } from './model';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls !== '') e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A button that is not a stop for the Tab key (Tab is the game's) and gives the keyboard back after a click. */
export function button(cls: string, act: () => void): HTMLButtonElement {
  const b = el('button', cls);
  b.type = 'button';
  b.tabIndex = -1;
  b.addEventListener('click', () => {
    act();
    b.blur();
  });
  return b;
}

/**
 * A button whose thing is not possible now is drawn so and says why, and still takes a press: it is never a dead
 * button (the press goes to the game, which answers it). `why` is its tooltip then; `title` when it is possible.
 */
export function setEnabled(b: HTMLButtonElement, enabled: boolean, title: string, why = ''): void {
  if (enabled) b.removeAttribute('aria-disabled');
  else b.setAttribute('aria-disabled', 'true');
  const words = enabled || why === '' ? title : `${title}: ${why}`;
  if (b.title !== words) b.title = words;
}

/** Whether a button is drawn as not possible now. */
export function isOff(b: Element): boolean {
  return b.getAttribute('aria-disabled') === 'true';
}

export function setText(e: Element, text: string): void {
  if (e.textContent !== text) e.textContent = text;
}

export function setStock(e: HTMLElement, stock: Stock | null): void {
  const v = stock ?? '';
  if (e.dataset['stock'] !== v) e.dataset['stock'] = v;
}

export function keycap(text: string): HTMLSpanElement {
  return el('span', 'wg-key', text);
}

/** A rubber stamp: `tone` plain (black ink), alert (red) or faint. */
export function stamp(word: string, tone: 'plain' | 'alert' | 'faint'): HTMLSpanElement {
  return el('span', `wg-stamp ${tone === 'alert' ? 'wg-red' : tone === 'faint' ? 'wg-dim' : 'wg-blk'}`, word);
}

/** A label and its value on one ruled line. */
export function line(label: string, value: string): HTMLDivElement {
  const row = el('div', 'wg-line');
  row.append(el('span', '', label), el('span', '', value));
  return row;
}

/** The address of a mark's picture, when a skin has one. */
export type MarkPicture = (id: string, where: 'plate' | 'header') => string | null;

/**
 * A side's mark: the skin's picture of it when there is one, else the drawn line mark, else (a side with
 * no mark, or one the panel has no drawing for) a small block of the side's stock colour.
 */
export function markOf(id: string | null, stock: Stock | null, picture: MarkPicture | null, where: 'plate' | 'header', small = false): HTMLElement | SVGSVGElement {
  if (id !== null) {
    const address = picture ? picture(id, where) : null;
    if (address !== null) {
      const img = el('img', 'wg-mk');
      img.alt = '';
      img.src = address;
      return img;
    }
    if (hasIcon(id)) return icon(id, small);
  }
  const chip = el('span', 'wg-chip');
  setStock(chip, stock);
  return chip;
}
