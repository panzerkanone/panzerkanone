/**
 * The panel's sounds: listeners on the element the game's panel is mounted in.
 * The panel is not asked for anything and is not changed: this file watches
 * what it already shows (joins.ts names what it leans on).
 *
 *   - A click on a button plays the button's click (the paper tabs excepted:
 *     joins.ts, clickEvent).
 *   - A part that opens or shuts (the notebook, the folder, a full sheet), and
 *     a page that comes up in the notebook or the rule book, are heard from the
 *     panel's own classes as they change, so that a key that opens the notebook
 *     sounds as a click on its tab does.
 *
 * The rules are in joins.ts and are tested without a browser; this is only
 * their hands.
 */
import type { PanelEvent } from './cues';
import { clickEvent, openEvent, pageEvent, PANEL } from './joins';

/** Start listening on the panel's root; `heard` is told each thing the panel did. Returns a function that stops it. */
export function soundPanel(root: HTMLElement, heard: (event: PanelEvent) => void): () => void {
  const onClick = (e: MouseEvent): void => {
    const button = e.target instanceof Element ? e.target.closest('button') : null;
    if (!button || !root.contains(button)) return;
    const event = clickEvent({ open: button.dataset['open'], act: button.dataset['act'], page: button.dataset['page'] });
    if (event !== null) heard(event);
  };
  root.addEventListener('click', onClick, true);

  const has = (classes: string | null, name: string): boolean => (classes ?? '').split(/\s+/).includes(name);
  const observer = new MutationObserver(records => {
    // What changed in one go is heard once: the notebook opening shows a page, and is one page turned, not two.
    const events = new Set<PanelEvent>();
    for (const r of records) {
      const el = r.target;
      if (r.type !== 'attributes' || !(el instanceof HTMLElement)) continue;
      const part = el.dataset['part'];
      if (part !== undefined) {
        const open = el.classList.contains(PANEL.openClass);
        if (open !== has(r.oldValue, PANEL.openClass)) {
          const event = openEvent(part, open);
          if (event !== null) events.add(event);
        }
      } else if (el.dataset['page'] !== undefined && el.classList.contains(PANEL.shownClass) && !has(r.oldValue, PANEL.shownClass)) {
        const within = el.closest<HTMLElement>('[data-part]');
        const event = within ? pageEvent(within.dataset['part'] ?? '', within.classList.contains(PANEL.openClass)) : null;
        if (event !== null) events.add(event);
      }
    }
    for (const event of events) heard(event);
  });
  observer.observe(root, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });

  return () => {
    root.removeEventListener('click', onClick, true);
    observer.disconnect();
  };
}
