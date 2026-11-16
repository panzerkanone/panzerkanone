/**
 * The general structural difference between two JSON values, and its
 * application (ruling 7). It knows nothing of any ruleset: it compares plain
 * data (null, true and false, finite numbers, text, lists, mappings) and
 * nothing else.
 *
 * A change is one of three shapes, and is itself plain data:
 *
 *   { "set": value }                          the new value, whole
 *   { "keys": [[key, change], ...],           both mappings: each listed key gets its change
 *     "drop": [key, ...] }                     (a new key is always a "set"), and each dropped key goes
 *   { "items": [[index, change], ...],        both lists: each listed index gets its change (an index at
 *     "length": n }                            or past the old length is always a "set"), then the list
 *                                              is cut or grown to length n
 *
 * diffJson(a, b) is null when a and b are equal as JSON, else a change that
 * applyChange turns a into b. Keys are carried as list entries, never as the
 * keys of a mapping, so a key named `__proto__`, `constructor` or `prototype`
 * is data like any other; the values applyChange builds are made with
 * defineProperty, so such a key never touches a prototype.
 *
 * applyChange checks the change as it goes and throws a ChangeError, naming
 * the place, for one of the wrong shape or one that names a place the value
 * does not have (patching a key that is absent, dropping one that is absent,
 * listing an index twice, leaving a hole). It never changes its input.
 */
import { isRecord } from '../engine/kernel/check';

export type Change =
  | { readonly set: unknown }
  | { readonly keys: readonly (readonly [string, Change])[]; readonly drop: readonly string[] }
  | { readonly items: readonly (readonly [number, Change])[]; readonly length: number };

/** A change that cannot be applied: its place and what is wrong. */
export class ChangeError extends Error {
  readonly place: string;
  constructor(place: string, message: string) {
    super(`change at ${place}: ${message}`);
    this.place = place;
  }
}

function own(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function setOwn(obj: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

/** True when two plain-data values are equal as JSON (mappings compared without regard to key order). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i], b[i])) return false;
    return true;
  }
  if (isRecord(a)) {
    if (!isRecord(b)) return false;
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    for (const k of ka) {
      if (!own(b, k)) return false;
      if (!jsonEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}

/** The change that turns a into b, or null when they are equal. */
export function diffJson(a: unknown, b: unknown): Change | null {
  if (Array.isArray(a) && Array.isArray(b)) {
    const items: [number, Change][] = [];
    const common = Math.min(a.length, b.length);
    for (let i = 0; i < common; i++) {
      const c = diffJson(a[i], b[i]);
      if (c !== null) items.push([i, c]);
    }
    for (let i = common; i < b.length; i++) items.push([i, { set: b[i] }]);
    if (items.length === 0 && a.length === b.length) return null;
    return { items, length: b.length };
  }
  if (isRecord(a) && isRecord(b)) {
    const keys: [string, Change][] = [];
    const drop: string[] = [];
    for (const k of Object.keys(b)) {
      if (!own(a, k)) {
        keys.push([k, { set: b[k] }]);
        continue;
      }
      const c = diffJson(a[k], b[k]);
      if (c !== null) keys.push([k, c]);
    }
    for (const k of Object.keys(a)) if (!own(b, k)) drop.push(k);
    if (keys.length === 0 && drop.length === 0) return null;
    return { keys, drop };
  }
  return jsonEqual(a, b) ? null : { set: b };
}

/** A deep copy of a plain-data value, checked: anything JSON cannot hold is an error. */
export function copyJson(v: unknown, place = '$'): unknown {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new ChangeError(place, 'a number JSON cannot hold');
    return v;
  }
  if (Array.isArray(v)) {
    const out: unknown[] = new Array<unknown>(v.length);
    for (let i = 0; i < v.length; i++) {
      if (!(i in v)) throw new ChangeError(`${place}[${i}]`, 'a hole in a list');
      out[i] = copyJson(v[i], `${place}[${i}]`);
    }
    return out;
  }
  if (isRecord(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) setOwn(out, k, copyJson(v[k], `${place}.${k}`));
    return out;
  }
  throw new ChangeError(place, `${typeof v} is not plain data`);
}

function exactKeys(ch: Record<string, unknown>, keys: readonly string[]): boolean {
  const have = Object.keys(ch);
  return have.length === keys.length && keys.every(k => own(ch, k));
}

/** Apply a change to a value, giving a new value; the input is not changed. Throws a ChangeError for a bad change. */
export function applyChange(value: unknown, change: unknown, place = '$'): unknown {
  if (!isRecord(change)) throw new ChangeError(place, 'a change must be a mapping');
  if (exactKeys(change, ['set'])) return copyJson(change.set, place);
  if (exactKeys(change, ['keys', 'drop'])) {
    if (!isRecord(value)) throw new ChangeError(place, 'keys and drop change a mapping, and the value here is not one');
    const entries = change.keys;
    const drop = change.drop;
    if (!Array.isArray(entries) || !Array.isArray(drop)) throw new ChangeError(place, 'keys and drop must be lists');
    const changed = new Map<string, Change>();
    for (let i = 0; i < entries.length; i++) {
      const e: unknown = entries[i];
      if (!Array.isArray(e) || e.length !== 2 || typeof e[0] !== 'string') throw new ChangeError(`${place}.keys[${i}]`, 'must be a [key, change] pair');
      const k = e[0];
      if (changed.has(k)) throw new ChangeError(`${place}.keys[${i}]`, `the key ${JSON.stringify(k)} is listed twice`);
      changed.set(k, e[1] as Change);
    }
    const dropped = new Set<string>();
    for (let i = 0; i < drop.length; i++) {
      const k: unknown = drop[i];
      if (typeof k !== 'string') throw new ChangeError(`${place}.drop[${i}]`, 'must be a key');
      if (!own(value, k)) throw new ChangeError(`${place}.drop[${i}]`, `drops ${JSON.stringify(k)}, which is not there`);
      if (dropped.has(k) || changed.has(k)) throw new ChangeError(`${place}.drop[${i}]`, `the key ${JSON.stringify(k)} is named twice`);
      dropped.add(k);
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value)) {
      if (dropped.has(k)) continue;
      const c = changed.get(k);
      setOwn(out, k, c === undefined ? value[k] : applyChange(value[k], c, `${place}.${k}`));
    }
    for (const [k, c] of changed) {
      if (own(value, k)) continue;
      if (!isRecord(c) || !exactKeys(c, ['set'])) throw new ChangeError(`${place}.${k}`, 'a new key must be given a whole value (set)');
      setOwn(out, k, copyJson((c as { readonly set: unknown }).set, `${place}.${k}`));
    }
    return out;
  }
  if (exactKeys(change, ['items', 'length'])) {
    if (!Array.isArray(value)) throw new ChangeError(place, 'items and length change a list, and the value here is not one');
    const items = change.items;
    const length = change.length;
    if (!Array.isArray(items)) throw new ChangeError(place, 'items must be a list');
    if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || length > value.length + items.length) {
      throw new ChangeError(place, 'length must be a whole number no greater than the old length plus the items given');
    }
    const out: unknown[] = new Array<unknown>(length);
    const given = new Set<number>();
    for (let i = 0; i < items.length; i++) {
      const e: unknown = items[i];
      if (!Array.isArray(e) || e.length !== 2) throw new ChangeError(`${place}.items[${i}]`, 'must be an [index, change] pair');
      const at: unknown = e[0];
      if (typeof at !== 'number' || !Number.isSafeInteger(at) || at < 0 || at >= length) {
        throw new ChangeError(`${place}.items[${i}]`, `the index must be a whole number below the new length ${length}`);
      }
      if (given.has(at)) throw new ChangeError(`${place}.items[${i}]`, `index ${at} is listed twice`);
      given.add(at);
      const c: unknown = e[1];
      if (at >= value.length) {
        if (!isRecord(c) || !exactKeys(c, ['set'])) throw new ChangeError(`${place}[${at}]`, 'a new item must be given a whole value (set)');
        out[at] = copyJson(c.set, `${place}[${at}]`);
      } else {
        out[at] = applyChange(value[at], c, `${place}[${at}]`);
      }
    }
    for (let i = 0; i < length; i++) {
      if (given.has(i)) continue;
      if (i >= value.length) throw new ChangeError(`${place}[${i}]`, 'the list grows, but no value is given here');
      out[i] = value[i];
    }
    return out;
  }
  throw new ChangeError(place, 'a change is {set}, {keys, drop} or {items, length}');
}
