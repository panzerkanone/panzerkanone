/**
 * Canonical JSON: one text for one value, whatever order its keys were made
 * in. Object keys are sorted (by UTF-16 code unit, as Array.prototype.sort
 * does), arrays keep their order, there is no white space. It is what content
 * hashes and state hashes are taken over.
 *
 * Only plain data is accepted: null, booleans, finite numbers, strings,
 * arrays and plain objects. Anything else (undefined, a function, NaN, an
 * infinity, a typed array, a class instance) is an error, never skipped:
 * a value that cannot be written down cannot be hashed.
 */
import { sha256Text } from './sha256';

function write(v: unknown, path: string, out: string[]): void {
  if (v === null) {
    out.push('null');
    return;
  }
  switch (typeof v) {
    case 'boolean':
      out.push(v ? 'true' : 'false');
      return;
    case 'number':
      if (!Number.isFinite(v)) throw new Error(`canonical JSON: ${path} is ${String(v)}, which JSON cannot hold`);
      out.push(JSON.stringify(v));
      return;
    case 'string':
      out.push(JSON.stringify(v));
      return;
    case 'object':
      break;
    default:
      throw new Error(`canonical JSON: ${path} is a ${typeof v}, which JSON cannot hold`);
  }
  if (Array.isArray(v)) {
    out.push('[');
    for (let i = 0; i < v.length; i++) {
      if (i > 0) out.push(',');
      write(v[i], `${path}[${i}]`, out);
    }
    out.push(']');
    return;
  }
  const proto: unknown = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(`canonical JSON: ${path} is not a plain object or list`);
  }
  const rec = v as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  out.push('{');
  let first = true;
  for (const k of keys) {
    const item = rec[k];
    if (item === undefined) throw new Error(`canonical JSON: ${path}.${k} is undefined`);
    if (!first) out.push(',');
    first = false;
    out.push(JSON.stringify(k), ':');
    write(item, `${path}.${k}`, out);
  }
  out.push('}');
}

/** The canonical JSON text of a plain-data value. */
export function canonicalJson(value: unknown): string {
  const out: string[] = [];
  write(value, '$', out);
  return out.join('');
}

/** SHA-256 of the canonical JSON of a value: the content hash used everywhere in the engine. */
export function contentHash(value: unknown): string {
  return sha256Text(canonicalJson(value));
}
