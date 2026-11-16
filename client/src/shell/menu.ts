/**
 * The title screen's interface over the picture: the four menu plates, the leather strip, the
 * nameplate and the tag that answers a press that leads nowhere yet.
 *
 * One plate is always in hand: the one under the pointer or the keyboard's focus last (Play
 * Scenario when the page opens, as on the owner's art). It is the ivory plate; the others are dark.
 * Up and Down move the hand, Enter presses. A plate for something not built yet is drawn dimmer and
 * answers a press with a line on the screen; no plate is dead.
 */
import type { Layout } from './layout';
import type { ShellArt } from './manifest';
import { PLATES } from './plates';
import type { PlateId } from './plates';
import { EASE } from './style';
import { GAME, WORDS, editionLine } from './words';

export interface MenuOptions {
  root: HTMLElement;
  art: ShellArt;
  address(file: string): string;
  /** The build's version, for the nameplate. */
  version: string;
  /** A plate that leads somewhere was pressed. */
  onPress(id: PlateId): void;
  /** A plate that leads nowhere yet was pressed (it has been answered on the screen). */
  onRefused(id: PlateId): void;
}

export interface Menu {
  place(l: Layout): void;
  /** The plate in hand. */
  current(): PlateId;
  /** Takes a key for the menu; true when it was the menu's. */
  key(e: KeyboardEvent): boolean;
  /** Gives the keyboard's focus to a plate (the one in hand when none is named). */
  focus(id?: PlateId): void;
  /** While something lies over the menu it takes no pointer and no focus. */
  setInert(inert: boolean): void;
  /** Says a line beside a plate (as a press that leads nowhere is answered). */
  say(id: PlateId, text: string): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export function buildMenu(o: MenuOptions): Menu {
  const { root, art } = o;
  const image = (file: string): string => `url("${o.address(file)}")`;

  const strip = el('div', 'sh-strip');
  strip.style.backgroundImage = image(art.strip.file);
  strip.setAttribute('aria-hidden', 'true');

  const nameplate = el('div', 'sh-nameplate');
  nameplate.style.backgroundImage = image(art.nameplate.file);
  nameplate.setAttribute('aria-hidden', 'true');
  // The edition and the build's version on one line, between two rules that take what room is left.
  // The version is written as it is given (`dev`, `v0.0.7`), not in capitals as the words are.
  const edition = el('div', 'sh-edition');
  const line = el('span', 'sh-edition-text', editionLine(''));
  line.append(el('span', 'sh-version', o.version));
  edition.append(line);
  nameplate.append(el('div', 'sh-name', GAME.name), edition);

  const nav = el('nav', 'sh-menu');
  nav.setAttribute('aria-label', WORDS.menuLabel);
  const answer = el('div', 'sh-answer');
  answer.setAttribute('role', 'status');
  answer.setAttribute('aria-live', 'polite');

  let hand = 0;
  let layout: Layout | null = null;
  let answerTimer = 0;
  const buttons = PLATES.map((plate, i) => {
    const b = el('button', `sh-plate${plate.built ? '' : ' sh-soon'}`);
    b.type = 'button';
    b.dataset['plate'] = plate.id;
    b.style.setProperty('--wait', `${0.45 + i * 0.09}s`);
    if (!plate.built) {
      b.setAttribute('aria-disabled', 'true');
      b.setAttribute('aria-label', `${plate.words}, ${WORDS.notYetLabel}`);
    }
    const dark = el('span', `sh-plate-dark${i === 0 ? ' sh-plate-flip' : ''}`);
    dark.style.backgroundImage = image((art.platesDark[i] ?? art.plateLit).file);
    const lit = el('span', 'sh-plate-lit');
    lit.style.backgroundImage = image(art.plateLit.file);
    b.append(dark, lit, el('span', 'sh-plate-text', plate.words));

    const take = (): void => setHand(i);
    // The plate under the pointer takes the keyboard's focus too: the plate in hand is always the one Enter presses.
    b.addEventListener('pointerenter', () => b.focus({ preventScroll: true }));
    b.addEventListener('focus', take);
    b.addEventListener('pointerdown', () => {
      take();
      b.classList.add('sh-down');
    });
    for (const up of ['pointerup', 'pointerleave', 'pointercancel', 'blur'] as const) b.addEventListener(up, () => b.classList.remove('sh-down'));
    b.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) b.classList.add('sh-down');
    });
    b.addEventListener('keyup', () => b.classList.remove('sh-down'));
    b.addEventListener('click', () => press(i));
    nav.append(b);
    return b;
  });

  function setHand(i: number): void {
    hand = i;
    buttons.forEach((b, n) => b.classList.toggle('sh-on', n === i));
  }
  setHand(0);

  function say(i: number, text: string): void {
    const box = layout?.plates[i];
    if (!box || !layout) return;
    answer.textContent = text;
    // Beside the plate, level with its middle (the stage always has the room: it is never cropped).
    answer.style.left = `${box.x + box.w + 10}px`;
    answer.style.top = `${box.y + box.h / 2}px`;
    answer.style.translate = '0 -50%';
    answer.classList.add('sh-shown');
    window.clearTimeout(answerTimer);
    answerTimer = window.setTimeout(() => answer.classList.remove('sh-shown'), EASE.answerStay * 1000);
  }

  function press(i: number): void {
    const plate = PLATES[i];
    if (!plate) return;
    setHand(i);
    if (plate.built) {
      o.onPress(plate.id);
    } else {
      say(i, WORDS.notYet);
      o.onRefused(plate.id);
    }
  }

  root.append(strip, nameplate, nav, answer);

  const box = (e: HTMLElement, b: { x: number; y: number; w: number; h: number }): void => {
    e.style.left = `${b.x}px`;
    e.style.top = `${b.y}px`;
    e.style.width = `${b.w}px`;
    e.style.height = `${b.h}px`;
  };

  return {
    place(l) {
      layout = l;
      box(strip, l.strip);
      strip.style.backgroundSize = `${l.stripTile.w}px ${l.stripTile.h}px`;
      box(nameplate, l.nameplate);
      buttons.forEach((b, i) => box(b, l.plates[i] as Layout['plates'][number]));
    },
    current: () => (PLATES[hand] as (typeof PLATES)[number]).id,
    key(e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return false;
      const n = buttons.length;
      const to = e.key === 'ArrowDown' ? (hand + 1) % n : e.key === 'ArrowUp' ? (hand + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
      if (to >= 0) {
        setHand(to);
        (buttons[to] as HTMLButtonElement).focus({ preventScroll: true });
        return true;
      }
      // Enter with the focus on nothing presses the plate in hand (a focused plate takes Enter itself).
      if (e.key === 'Enter' && !e.repeat && (document.activeElement === document.body || document.activeElement === null)) {
        (buttons[hand] as HTMLButtonElement).focus({ preventScroll: true });
        press(hand);
        return true;
      }
      return false;
    },
    focus(id) {
      const i = id === undefined ? hand : PLATES.findIndex(p => p.id === id);
      if (i < 0) return;
      setHand(i);
      (buttons[i] as HTMLButtonElement).focus({ preventScroll: true });
    },
    setInert(inert) {
      nav.inert = inert;
    },
    say(id, text) {
      const i = PLATES.findIndex(p => p.id === id);
      if (i >= 0) say(i, text);
    },
  };
}
