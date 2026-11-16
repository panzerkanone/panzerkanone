/**
 * Hand-written checks for loaded data, in the manner of engine/core/map.ts:
 * every key is required unless a check says otherwise, an unknown key is
 * refused, and every problem is reported with the file and the place it was
 * found ("content/x.yaml: units[3].range: must be a whole number from 1 to 30,
 * got -2"). Nothing is defaulted.
 *
 * A Checker collects problems; the reading functions return the value when it
 * is good and undefined after reporting it when it is not, so a loader reads
 * on past the first problem and reports them all.
 */

export function isRecord(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** A short, safe rendering of a value for a message. */
export function show(v: unknown): string {
  let s: string;
  if (typeof v === 'string') s = JSON.stringify(v);
  else if (Array.isArray(v)) s = 'a list';
  else if (typeof v === 'object' && v !== null) s = 'a mapping';
  else s = String(v);
  return s.length > 40 ? `${s.slice(0, 37)}...` : s;
}

function own(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export class Checker {
  readonly file: string;
  readonly problems: string[] = [];

  constructor(file: string) {
    this.file = file;
  }

  get ok(): boolean {
    return this.problems.length === 0;
  }

  add(place: string, message: string): void {
    this.problems.push(place === '' ? `${this.file}: ${message}` : `${this.file}: ${place}: ${message}`);
  }

  /**
   * A mapping with exactly the given keys: each key of `required` must be
   * present, each of `optional` may be, any other key is refused.
   */
  record(place: string, v: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> | undefined {
    if (!isRecord(v)) {
      this.add(place, `must be a mapping of keys to values, got ${show(v)}`);
      return undefined;
    }
    for (const key of Object.keys(v)) {
      if (!required.includes(key) && !optional.includes(key)) this.add(place, `unknown key '${key}'`);
    }
    for (const key of required) {
      if (!own(v, key)) this.add(place, `${key} is missing`);
    }
    return v;
  }

  /** A mapping whose keys are exactly `keys` (each required, nothing else), e.g. one entry per mover type. */
  keyed(place: string, v: unknown, keys: readonly string[], what: string): Record<string, unknown> | undefined {
    if (!isRecord(v)) {
      this.add(place, `must be a mapping with one entry per ${what}, got ${show(v)}`);
      return undefined;
    }
    for (const key of Object.keys(v)) if (!keys.includes(key)) this.add(place, `unknown ${what} '${key}' (known: ${keys.join(', ')})`);
    for (const key of keys) if (!own(v, key)) this.add(place, `missing ${what} '${key}'`);
    return v;
  }

  /** The value of `key` in a mapping already checked by record(); undefined if absent. */
  at(obj: Record<string, unknown>, key: string): unknown {
    return own(obj, key) ? obj[key] : undefined;
  }

  int(place: string, v: unknown, lo: number, hi: number): number | undefined {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) {
      this.add(place, `must be a whole number from ${lo} to ${hi}, got ${show(v)}`);
      return undefined;
    }
    return v;
  }

  /** A whole number in range, or null. */
  intOrNull(place: string, v: unknown, lo: number, hi: number, nullMeans: string): number | null | undefined {
    if (v === null) return null;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) {
      this.add(place, `must be a whole number from ${lo} to ${hi}, or null (${nullMeans}), got ${show(v)}`);
      return undefined;
    }
    return v;
  }

  str(place: string, v: unknown, pattern?: RegExp, what?: string): string | undefined {
    if (typeof v !== 'string' || v.trim().length === 0) {
      this.add(place, `must be a non-empty string, got ${show(v)}`);
      return undefined;
    }
    if (pattern && !pattern.test(v)) {
      this.add(place, `must be ${what ?? `text matching ${String(pattern)}`}, got ${show(v)}`);
      return undefined;
    }
    return v;
  }

  bool(place: string, v: unknown): boolean | undefined {
    if (typeof v !== 'boolean') {
      this.add(place, `must be true or false, got ${show(v)}`);
      return undefined;
    }
    return v;
  }

  list(place: string, v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): unknown[] | undefined {
    if (!Array.isArray(v)) {
      this.add(place, `must be a list, got ${show(v)}`);
      return undefined;
    }
    if (v.length < min || v.length > max) {
      this.add(place, max === Number.MAX_SAFE_INTEGER
        ? `must hold at least ${min} entries, has ${v.length}`
        : `must hold ${min} to ${max} entries, has ${v.length}`);
      return undefined;
    }
    return v;
  }

  /** One of a closed set of names. */
  oneOf(place: string, v: unknown, names: readonly string[], what: string): string | undefined {
    if (typeof v !== 'string' || !names.includes(v)) {
      this.add(place, `unknown ${what} ${show(v)} (known: ${names.join(', ')})`);
      return undefined;
    }
    return v;
  }
}

/** Lower-case id: letters, digits, _ and -, starting with a letter or digit. */
export const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
/** A SHA-256 content hash as 64 lower-case hex digits. */
export const HASH_PATTERN = /^[0-9a-f]{64}$/;
