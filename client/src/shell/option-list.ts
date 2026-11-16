/**
 * The Advanced page's options, as a list made to hold many: one row an option, its name and a short line under it,
 * and at the row's end a checkbox drawn in the page's own ink (a ruled box; a red tick drawn into it, eased, when the
 * option is on). The row in hand has the red ring of the chosen round it. Past what the page holds, the rows scroll
 * inside it as the scenario list's column does: the browser's own scrolling (the wheel, a trackpad), eased when the
 * keys bring a row into view, no bar, and a soft fade at the top and the foot where there is more. A click, Space or
 * Enter turns a row's option over; the screen's Up and Down move between the rows. A row that `opens` something (the
 * About panel) has no checkbox: its box holds a chevron in the same ink, and a press opens what it names.
 */
import { ADVANCED_PLACES as AP, optionShowing, optionsMost } from './screen-places';
import { el, place, pressable } from './ui';

export interface OptionRow {
  id: string;
  name: string;
  line: string;
  /** It opens something (a panel), and is never on or off. */
  opens?: boolean;
}

export interface OptionList {
  readonly element: HTMLElement;
  /** The rows, top to bottom. */
  readonly rows: HTMLButtonElement[];
  /** Ticks each row whose option is on. */
  show(on: Readonly<Record<string, boolean>>): void;
  /** Adds a row at the foot. */
  add(row: OptionRow): HTMLButtonElement;
  /** How far the list is scrolled, and how far it can be. */
  scroll(): { at: number; most: number };
}

/** The same box with a chevron in it, for a row that opens something. */
function opener(): HTMLElement {
  const holder = el('span', 'sh-check sh-opens');
  holder.setAttribute('aria-hidden', 'true');
  holder.innerHTML = '<svg viewBox="0 0 56 56"><path class="sh-check-box" d="M6.5 7.6 L49.2 6.3 L49.8 49.5 L6.9 50.2 Z"/>'
    + '<path class="sh-open-mark" d="M23 16 L36.5 28.5 L23 41"/></svg>';
  return holder;
}

/** A box ruled by hand (each side a little off the straight) and its tick, in a 56-unit square. */
function checkbox(): HTMLElement {
  const holder = el('span', 'sh-check');
  holder.setAttribute('aria-hidden', 'true');
  holder.innerHTML = '<svg viewBox="0 0 56 56"><path class="sh-check-box" d="M6.5 7.6 L49.2 6.3 L49.8 49.5 L6.9 50.2 Z"/>'
    + '<path class="sh-check-tick" pathLength="1" d="M12.5 29.5 L24 42 L47 9.5"/></svg>';
  return holder;
}

export function optionList(root: HTMLElement, given: readonly OptionRow[], turn: (id: string) => void): OptionList {
  const column = el('div', 'sh-option-list');
  place(column, AP.list);
  column.style.setProperty('--fade', `${AP.fade}px`);
  root.append(column);
  const rows: HTMLButtonElement[] = [];
  /** Where the keys last sent the list, while it eases there (the wheel, a press or its arrival forgets it). */
  let aim: number | null = null;

  function fades(): void {
    const most = optionsMost(rows.length);
    column.classList.toggle('sh-scrolls', most > 0);
    column.classList.toggle('sh-more-above', most > 0 && column.scrollTop > 1);
    column.classList.toggle('sh-more-below', most > 0 && column.scrollTop < most - 1);
  }
  function bring(i: number): void {
    const n = rows.length;
    if (optionsMost(n) === 0) return;
    const from = aim ?? column.scrollTop;
    const to = optionShowing(i, from, n);
    if (Math.abs(to - from) < 0.5) return;
    aim = to;
    // The list's own scroll-behavior eases it (and does not, for a viewer who asks for less motion).
    column.scrollTo({ top: to });
  }
  column.addEventListener('scroll', fades, { passive: true });
  column.addEventListener('scrollend', () => (aim = null));
  for (const taken of ['wheel', 'pointerdown', 'touchstart'] as const) column.addEventListener(taken, () => (aim = null), { passive: true });

  function add(r: OptionRow): HTMLButtonElement {
    const b = el('button', 'sh-option');
    b.type = 'button';
    b.dataset['control'] = `option-${r.id}`;
    b.dataset['option'] = r.id;
    if (r.opens === true) {
      b.dataset['opens'] = '1';
      b.setAttribute('aria-haspopup', 'dialog');
    } else {
      b.setAttribute('role', 'checkbox');
      b.setAttribute('aria-checked', 'false');
    }
    b.setAttribute('aria-label', r.name);
    b.style.height = `${AP.row}px`;
    const name = el('span', 'sh-option-name', r.name);
    name.style.fontSize = `${AP.nameSize}px`;
    const line = el('span', 'sh-option-line', r.line);
    line.style.fontSize = `${AP.lineSize}px`;
    const check = r.opens === true ? opener() : checkbox();
    check.style.width = check.style.height = `${AP.check.side}px`;
    check.style.right = `${AP.check.right}px`;
    const ring = el('span', 'sh-option-ring');
    b.append(ring, name, line, check);
    const i = rows.length;
    b.addEventListener('click', () => turn(r.id));
    b.addEventListener('focus', () => bring(i));
    pressable(b);
    column.append(b);
    rows.push(b);
    fades();
    return b;
  }
  for (const r of given) add(r);

  return {
    element: column,
    rows,
    show(on) {
      for (const b of rows) {
        if (b.dataset['opens'] === '1') continue;
        const v = on[b.dataset['option'] ?? ''] === true;
        b.classList.toggle('sh-on', v);
        b.setAttribute('aria-checked', String(v));
      }
    },
    add,
    scroll: () => ({ at: column.scrollTop, most: optionsMost(rows.length) }),
  };
}
