/**
 * The in-memory store: JSON text under keys, and nothing else (ruling 6).
 *
 *   const store = new MemoryStore();
 *   store.text()                    the whole store as one JSON text (keys sorted): what survives
 *   MemoryStore.fromText(text)      a store holding exactly that text
 *
 * `entries` is the one thing the store holds: a mapping with no prototype
 * from each key to its JSON text. A commit checks that every text is a string
 * JSON can read before it writes any, and writes all or none.
 */
import { canonicalJson } from '../engine/core/canonical';
import { isRecord } from '../engine/kernel/check';
import type { Store, StoreWrite } from './ports';

export class MemoryStore implements Store {
  readonly entries: Record<string, string> = Object.create(null) as Record<string, string>;

  load(): Readonly<Record<string, string>> {
    const out = Object.create(null) as Record<string, string>;
    for (const k of Object.keys(this.entries)) out[k] = this.entries[k] as string;
    return out;
  }

  commit(writes: readonly StoreWrite[]): void {
    for (const w of writes) {
      if (typeof w.key !== 'string' || w.key.length === 0) throw new Error('store: a key is non-empty text');
      if (typeof w.text !== 'string') throw new Error(`store: ${w.key}: only JSON text is stored`);
      JSON.parse(w.text);
    }
    for (const w of writes) {
      Object.defineProperty(this.entries, w.key, { value: w.text, enumerable: true, writable: true, configurable: true });
    }
  }

  /** The whole store as JSON text: a mapping of every key to its text, keys sorted. */
  text(): string {
    return canonicalJson(this.load());
  }

  static fromText(text: string): MemoryStore {
    const raw: unknown = JSON.parse(text);
    if (!isRecord(raw)) throw new Error('store text: must be a mapping of keys to JSON text');
    const store = new MemoryStore();
    const writes: StoreWrite[] = [];
    for (const k of Object.keys(raw)) {
      const v = raw[k];
      if (typeof v !== 'string') throw new Error(`store text: ${JSON.stringify(k)} is not text`);
      writes.push({ key: k, text: v });
    }
    store.commit(writes);
    return store;
  }
}
