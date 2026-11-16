/**
 * The panel's box for Main menu's question (leave.ts has its words and keys): a small box of the panel's paper in the
 * middle of the board, the board dimmed behind it, with two of the panel's steel buttons. The lit one (the panel's
 * primary look: the one Enter presses) is Keep playing when it opens. A click on the veil outside the box keeps
 * playing. The panel (hud.ts) makes one, opens it from the menu, gives it every key while it is open, and pauses the
 * game behind it.
 */
import { button, el, keycap } from './hud-dom';
import { icon } from './hud-icons';
import { leaveKey } from './leave';
import type { LeaveChoice, LeaveWords } from './leave';

const LEAVE_CSS = `
.wg-leave-veil { display: none; position: absolute; inset: 0; z-index: 40; pointer-events: auto; background: color-mix(in srgb, black 42%, transparent); }
.wg-leave-veil.wg-open { display: block; }
.wg-leave { position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%); width: 460px; max-width: calc(100% - 40px); padding: 20px 24px 20px; text-align: center; pointer-events: auto; border-radius: 4px; }
.wg-leave .wg-leave-ask { font: 600 17px/1.35 var(--body); margin: 2px 4px 18px; text-wrap: balance; }
.wg-leave .wg-leave-row { display: flex; gap: 12px; }
.wg-leave .wg-leave-row .wg-btn { flex: 1 1 0; justify-content: center; }
.wg-leave .wg-leave-row .wg-btn .wg-lab { display: block; }
`;

/** The question, as the panel holds it. */
export interface LeaveBox {
  /** The veil over the board, with the box on it: the panel puts it among its parts. */
  readonly root: HTMLDivElement;
  readonly open: boolean;
  /** The button lit now (Enter presses it). */
  readonly lit: LeaveChoice;
  /** Ask, in these words; `answer` is called once, with the player's answer, as the box is put away. */
  ask(words: LeaveWords, answer: (choice: LeaveChoice) => void): void;
  /** A key while the question is up: always taken (true) while it is up; false when it is not. */
  key(key: string): boolean;
}

export function makeLeave(): LeaveBox {
  if (!document.head.querySelector('style[data-wg-leave]')) {
    const style = document.createElement('style');
    style.dataset['wgLeave'] = '1';
    style.textContent = LEAVE_CSS;
    document.head.appendChild(style);
  }
  const root = el('div', 'wg-leave-veil');
  root.dataset['part'] = 'leave';
  const box = el('div', 'wg-leave wg-paper');
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-modal', 'true');
  const ask = el('div', 'wg-leave-ask');
  ask.id = 'wg-leave-ask';
  box.setAttribute('aria-labelledby', ask.id);
  const row = el('div', 'wg-leave-row');
  const yesLabel = el('span', 'wg-lab');
  const noLabel = el('span', 'wg-lab');
  const yes = button('wg-btn wg-steel', () => answer('yes'));
  yes.dataset['leave'] = 'yes';
  yes.append(icon('menu'), yesLabel);
  const no = button('wg-btn wg-steel', () => answer('no'));
  no.dataset['leave'] = 'no';
  no.append(icon('back'), noLabel, keycap('Esc'));
  row.append(yes, no);
  box.append(ask, row);
  root.append(box);
  // A click on the veil, outside the box, keeps playing; one inside the box (not on a button) does nothing.
  root.addEventListener('click', (e: MouseEvent) => {
    if (e.target === root) answer('no');
  });

  let open = false;
  let lit: LeaveChoice = 'no';
  let told: ((choice: LeaveChoice) => void) | null = null;

  function light(c: LeaveChoice): void {
    lit = c;
    yes.classList.toggle('wg-primary', c === 'yes');
    no.classList.toggle('wg-primary', c === 'no');
    (c === 'yes' ? yes : no).focus({ preventScroll: true });
  }

  function answer(c: LeaveChoice): void {
    if (!open) return;
    open = false;
    root.classList.remove('wg-open');
    const f = told;
    told = null;
    f?.(c);
  }

  return {
    root,
    get open() {
      return open;
    },
    get lit() {
      return lit;
    },
    ask(words, then) {
      ask.textContent = words.ask;
      yesLabel.textContent = words.yes;
      noLabel.textContent = words.no;
      yes.title = words.yes;
      no.title = `${words.no} (Esc)`;
      told = then;
      open = true;
      root.classList.add('wg-open');
      light('no');
    },
    key(key) {
      if (!open) return false;
      const k = leaveKey(key, lit);
      if (k === null) return true;
      if ('act' in k) {
        // The button pressed by its key takes the pressed look, as every button does.
        const b = k.act === 'yes' ? yes : no;
        b.classList.add('wg-down');
        window.setTimeout(() => b.classList.remove('wg-down'), 110);
        answer(k.act);
      } else light(k.light);
      return true;
    },
  };
}
