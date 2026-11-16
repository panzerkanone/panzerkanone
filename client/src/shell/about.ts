/**
 * The About panel: who made the game, what it was made with, and thanks to the makers whose free work it uses (the
 * words are WORDS.about). The kit's steel frame cut in nine, as the scenario list's panel is, laid over the settings
 * screen with a dim over the rest of it, and the owner's blank steel tag hung on its foot for Close.
 *
 * It is not easy to find, on purpose (the owner, 2026-11-15: "I don't want the about panel to be very easy to find"):
 * it opens from the last row of the settings' Advanced page ("Should be from the settings panel - advanced") and from
 * the game's menu ("And from the menu in the main game"), which lays the settings over the game with only this panel
 * open (settings-overlay.ts). Close, Esc or a click outside it puts it away; while it is open it takes every key.
 */
import type { Piece } from './manifest';
import { ABOUT_PLACES as AB } from './screen-places';
import { el, place, tagButton } from './ui';
import { WORDS } from './words';

const W = WORDS.about;

export interface AboutPanel {
  readonly element: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** Takes a key while it is open (all of them: the screen under it waits); Esc puts it away. */
  key(e: KeyboardEvent): boolean;
}

export interface AboutOptions {
  root: HTMLElement;
  /** His blank steel tag, for Close. */
  tag: Piece;
  address(file: string): string;
  /** The build's version, as the title's nameplate shows it. */
  version: string;
  /** A press is heard. */
  pressed(): void;
  /** It has been put away. */
  closed(): void;
}

export function aboutPanel(o: AboutOptions): AboutPanel {
  const layer = el('div', 'sh-about-layer');
  layer.dataset['part'] = 'about';
  const dim = el('div', 'sh-about-dim');
  const panel = el('div', 'sh-about');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', W.title);
  place(panel, AB.panel);

  const words = el('div', 'sh-about-words');
  place(words, AB.inner);
  const column = (head: string, paragraphs: readonly string[], small = false): HTMLElement => {
    const c = el('section', 'sh-about-col');
    c.append(el('h3', 'sh-about-head', head));
    for (const p of paragraphs) c.append(el('p', small ? 'sh-about-text sh-small' : 'sh-about-text', p));
    return c;
  };
  const columns = el('div', 'sh-about-cols');
  columns.append(
    column(W.madeBy, [W.grognard, W.game, W.version(o.version), W.source]),
    column(W.aiHead, [W.ai, W.ultracode]),
    column(W.thanksHead, W.thanks, true),
  );
  words.append(el('h2', 'sh-about-title', W.title), columns);
  panel.append(el('div', 'sh-panel-back'), el('div', 'sh-panel-frame'), words);
  layer.append(dim, panel);
  o.root.append(layer);

  const at = AB.close;
  const closeTag = tagButton({
    root: layer,
    picture: o.tag,
    address: o.address,
    at,
    words: W.close,
    text: { x: at[0] + AB.closeText.x, y: at[1] + AB.closeText.y, size: AB.closeText.size },
    id: 'about-close',
    press: () => {
      o.pressed();
      close();
    },
  });

  let shown = false;
  function open(): void {
    if (shown) return;
    shown = true;
    layer.classList.add('sh-open');
    layer.setAttribute('aria-hidden', 'false');
    closeTag.focus({ preventScroll: true });
  }
  function close(): void {
    if (!shown) return;
    shown = false;
    layer.classList.remove('sh-open');
    layer.setAttribute('aria-hidden', 'true');
    o.closed();
  }
  layer.setAttribute('aria-hidden', 'true');
  dim.addEventListener('click', () => {
    o.pressed();
    close();
  });

  return {
    element: layer,
    open,
    close,
    isOpen: () => shown,
    key(e) {
      if (!shown) return false;
      if (e.key === 'Escape') {
        o.pressed();
        close();
        return true;
      }
      // Close is the one thing on the panel to press: Enter and Space on it press it; Tab (and they, elsewhere) bring the
      // focus back to it. The screen under the panel takes no key while it is open.
      if ((e.key === 'Enter' || e.key === ' ') && document.activeElement === closeTag) return false;
      if (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ') closeTag.focus({ preventScroll: true });
      return true;
    },
  };
}
