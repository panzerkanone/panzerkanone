/**
 * The browser's local storage as the settings' store (settings.ts): what is kept between visits.
 * A browser that keeps nothing still works, and forgets.
 */
import type { Store } from './settings';

export function localStore(): Store {
  return {
    get(key) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // Nothing is kept.
      }
    },
  };
}
