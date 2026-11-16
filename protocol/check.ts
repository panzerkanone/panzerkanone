/**
 * Hand-written checks for messages, in the manner of engine/kernel/check.ts:
 * every key is required unless said otherwise, an unknown key is refused, and
 * every problem is reported with its place ("message: content.map: must be 64
 * lower-case hex digits, got text of 12 characters").
 *
 * One difference from the engine's checker: a message is never echoed. A
 * problem says what kind of value was found, never the value itself, because
 * a refused message can carry a token, a contribution or a key, and the answer
 * must not send it anywhere (ruling 7). Unknown key names are shown, cut to
 * eight characters.
 */
import { isRecord } from '../engine/kernel/check';

/** What kind of value this is, without showing it. */
export function kindOf(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'nothing';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 'a number JSON cannot hold';
    if (!Number.isInteger(v)) return 'a fraction';
    if (!Number.isSafeInteger(v)) return 'a whole number too large to be exact';
    return v < 0 ? 'a negative whole number' : 'a whole number';
  }
  if (typeof v === 'string') return `text of ${v.length} characters`;
  if (Array.isArray(v)) return `a list of ${v.length}`;
  if (isRecord(v)) return 'a mapping';
  return `a ${typeof v}`;
}

/**
 * A key name as a problem may show it: JSON-quoted, at most 8 characters of it
 * (too few to carry 8 bytes of a secret in any of the usual encodings).
 */
export function keyName(k: string): string {
  return JSON.stringify(k.length > 8 ? `${k.slice(0, 8)}...` : k);
}

function own(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export class MessageChecker {
  readonly label: string;
  readonly problems: string[] = [];

  constructor(label: string) {
    this.label = label;
  }

  get ok(): boolean {
    return this.problems.length === 0;
  }

  add(place: string, problem: string): void {
    this.problems.push(place === '' ? `${this.label}: ${problem}` : `${this.label}: ${place}: ${problem}`);
  }

  /** A mapping with exactly the given keys (each of `required` present, none other than these and `optional`). */
  record(place: string, v: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> | undefined {
    if (!isRecord(v)) {
      this.add(place, `must be a mapping of keys to values, got ${kindOf(v)}`);
      return undefined;
    }
    let unknown = 0;
    for (const key of Object.keys(v)) {
      if (!required.includes(key) && !optional.includes(key)) {
        // Report the first few: a message with ten thousand keys gets a short answer.
        if (unknown < 4) this.add(place, `unknown key ${keyName(key)}`);
        unknown++;
      }
    }
    if (unknown > 4) this.add(place, `and ${unknown - 4} more unknown keys`);
    for (const key of required) if (!own(v, key)) this.add(place, `${key} is missing`);
    return v;
  }

  /** The value of `key` in a mapping already checked by record(); undefined if absent. */
  at(obj: Record<string, unknown>, key: string): unknown {
    return own(obj, key) ? obj[key] : undefined;
  }

  /** A whole number from lo to hi. */
  int(place: string, v: unknown, lo: number, hi: number): number | undefined {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) {
      this.add(place, `must be a whole number from ${lo} to ${hi}, got ${kindOf(v)}`);
      return undefined;
    }
    return v;
  }

  /** A whole number from lo to hi, or null (meaning `nullMeans`). */
  intOrNull(place: string, v: unknown, lo: number, hi: number, nullMeans: string): number | null | undefined {
    if (v === null) return null;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) {
      this.add(place, `must be a whole number from ${lo} to ${hi}, or null (${nullMeans}), got ${kindOf(v)}`);
      return undefined;
    }
    return v;
  }

  /** Text matching a pattern, of at most `max` characters. */
  text(place: string, v: unknown, pattern: RegExp, what: string, max: number): string | undefined {
    if (typeof v !== 'string' || v.length === 0 || v.length > max || !pattern.test(v)) {
      this.add(place, `must be ${what}, got ${kindOf(v)}`);
      return undefined;
    }
    return v;
  }

  /** Exactly `bytes` bytes written as lower-case hex digits. */
  hex(place: string, v: unknown, bytes: number): string | undefined {
    if (typeof v !== 'string' || v.length !== bytes * 2 || !/^[0-9a-f]*$/.test(v)) {
      this.add(place, `must be ${bytes * 2} lower-case hex digits (${bytes} bytes), got ${kindOf(v)}`);
      return undefined;
    }
    return v;
  }

  /** One of a closed set of names. */
  oneOf<T extends string>(place: string, v: unknown, names: readonly T[], what: string): T | undefined {
    if (typeof v !== 'string' || !(names as readonly string[]).includes(v)) {
      this.add(place, `must be ${what} (one of ${names.join(', ')}), got ${kindOf(v)}`);
      return undefined;
    }
    return v as T;
  }

  bool(place: string, v: unknown): boolean | undefined {
    if (typeof v !== 'boolean') {
      this.add(place, `must be true or false, got ${kindOf(v)}`);
      return undefined;
    }
    return v;
  }

  list(place: string, v: unknown, max: number): unknown[] | undefined {
    if (!Array.isArray(v)) {
      this.add(place, `must be a list, got ${kindOf(v)}`);
      return undefined;
    }
    if (v.length > max) {
      this.add(place, `must hold at most ${max} entries, has ${v.length}`);
      return undefined;
    }
    return v;
  }
}

/** Hex text to bytes. The text must already be checked (even length, lower-case hex digits). */
export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const HEX = '0123456789abcdef';

/** Bytes as lower-case hex digits. */
export function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number;
    s += (HEX[b >> 4] as string) + (HEX[b & 15] as string);
  }
  return s;
}
