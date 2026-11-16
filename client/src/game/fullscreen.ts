/**
 * The page's own full screen (the browser's Fullscreen API): the tabs, the address bar and the menus go, and the game
 * has the whole screen. It is not the browser's full-screen window (on a Mac, View > Enter Full Screen), which keeps the
 * browser's bars; this takes the page itself to the whole screen. As it begins, the browser says for a moment how to
 * leave it (Chrome: "Press Esc to exit full screen"); no page can hide that. Esc leaves it, as do the game menu's item
 * and Alt+Enter (Option+Enter on a Mac), on every screen.
 */
type Doc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => void;
};
type Root = HTMLElement & { webkitRequestFullscreen?: () => void };

/** Whether this browser lets the page take the whole screen (Safari on an iPhone does not). */
export function canFullscreen(): boolean {
  const d = document as Doc;
  return d.fullscreenEnabled === true || d.webkitFullscreenEnabled === true;
}

/** Whether the page has the whole screen now. */
export function isFullscreen(): boolean {
  const d = document as Doc;
  return (d.fullscreenElement ?? d.webkitFullscreenElement ?? null) !== null;
}

/** Into the page's full screen, or out of it. Browsers allow it only from a key or a click, so it is called from one. */
export function toggleFullscreen(): void {
  const d = document as Doc;
  if (isFullscreen()) {
    if (typeof d.exitFullscreen === 'function') d.exitFullscreen().catch(() => undefined);
    else d.webkitExitFullscreen?.();
    return;
  }
  const root = document.documentElement as Root;
  if (typeof root.requestFullscreen === 'function') root.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
  else root.webkitRequestFullscreen?.();
}

/** Calls `then` whenever the page goes into or out of full screen (Esc included); returns the way to stop. */
export function onFullscreen(then: () => void): () => void {
  document.addEventListener('fullscreenchange', then);
  document.addEventListener('webkitfullscreenchange', then);
  return () => {
    document.removeEventListener('fullscreenchange', then);
    document.removeEventListener('webkitfullscreenchange', then);
  };
}

/** The key, as in many games: Alt+Enter (Option+Enter on a Mac), with no other modifier. */
export const FULLSCREEN_KEY = 'Alt+Enter';
export function isFullscreenKey(e: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean {
  return e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'Enter';
}

/** The key on every screen, listened for once for the whole page (main.tsx), before any screen or the game hears it. */
export function listenForFullscreenKey(): void {
  window.addEventListener('keydown', e => {
    if (!isFullscreenKey(e) || !canFullscreen()) return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) toggleFullscreen();
  }, true);
}
