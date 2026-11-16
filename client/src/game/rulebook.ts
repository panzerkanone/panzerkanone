/**
 * A player's guide to the rules, read from data (`format: rulebook/1`, the
 * files of content/rulebooks/) and checked: every key required, none unknown,
 * nothing defaulted.
 *
 *   format: rulebook/1
 *   ruleset:  the id of the rules data it is written for
 *   title:    the book's name
 *   assumes:  [{ path, is }]   what must be true of the values for the text to hold: the book is
 *             refused when one is not (a rule that is a choice in the data, written here as prose)
 *   pages:    [{ id, title, lead, points: [text], tip: text | null,
 *                table: { title, rows: [[label, value]] } | null }]
 *   numbered: how many of the pages, from the first, are numbered in the contents; the rest are
 *             marked with a dot
 *
 * The book types no number of its own. Wherever its text needs a value that
 * the game's data holds, it names it between braces, and the value is put in
 * when the book is read:
 *
 *   {rules.stack.limit}              the value at that path of the values given
 *   {rules.some.step|signed}         with a sign: +3, −1
 *   {rules.cover.woods.fire|less}    taken off: −2 (0 stays 0)
 *   {rules.some.floor|percent}       a share as a percentage: 25%
 *   {rules.some.part|share}          a share in words: half, a third, a quarter (else a percentage)
 *   {game.turns|word}                a small whole number as a word: eight
 *   {rules.movement.enter.swamp.tracked|cost}   a cost; null is "closed"
 *
 * A path that leads nowhere, a value of the wrong kind for its filter, or a
 * digit typed in the text outside braces, is a problem and the book is not
 * given. In a point, words between two pairs of stars (**so**) are printed
 * heavier.
 *
 * This file knows no ruleset: whoever reads a book gives the values (a
 * reading does, from the rules data and the scenario it is played with).
 */
import type { Figure, RuleBook, RulePage, Span } from './reading';

export const RULEBOOK_FORMAT = 'rulebook/1';

export interface RuleBookResult {
  book: RuleBook | null;
  problems: string[];
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (o: Rec, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const SHARES: readonly (readonly [number, string])[] = [[1 / 2, 'half'], [1 / 3, 'a third'], [1 / 4, 'a quarter'], [2 / 3, 'two thirds'], [3 / 4, 'three quarters']];

/** The value at a dotted path ("rules.support.steps.0"); undefined when the path leads nowhere. */
export function valueAt(values: unknown, path: string): unknown {
  let at: unknown = values;
  for (const key of path.split('.')) {
    if (Array.isArray(at)) {
      if (!/^\d+$/.test(key)) return undefined;
      at = at[Number(key)];
    } else if (isRec(at)) {
      if (!own(at, key)) return undefined;
      at = at[key];
    } else {
      return undefined;
    }
    if (at === undefined) return undefined;
  }
  return at;
}

/** One named value as its text, or a problem. */
function shown(value: unknown, filter: string): { text: string } | { problem: string } {
  const num = (): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  switch (filter) {
    case '': {
      if (typeof value === 'number' && Number.isFinite(value)) return { text: String(value) };
      if (typeof value === 'string' && value !== '') return { text: value };
      return { problem: 'is not a number or a word' };
    }
    case 'signed': {
      const n = num();
      return n === null ? { problem: 'is not a number' } : { text: n >= 0 ? `+${n}` : `−${-n}` };
    }
    case 'less': {
      const n = num();
      if (n === null || n < 0) return { problem: 'is not a number of 0 or more' };
      return { text: n === 0 ? '0' : `−${n}` };
    }
    case 'percent': {
      const n = num();
      if (n === null || n < 0 || n > 1) return { problem: 'is not a share from 0 to 1' };
      return { text: `${Math.round(n * 1000) / 10}%` };
    }
    case 'share': {
      const n = num();
      if (n === null || n <= 0 || n > 1) return { problem: 'is not a share above 0 up to 1' };
      const named = SHARES.find(([v]) => Math.abs(v - n) < 1e-9);
      return { text: named ? named[1] : `${Math.round(n * 1000) / 10}%` };
    }
    case 'word': {
      const n = num();
      if (n === null || !Number.isInteger(n) || n < 0) return { problem: 'is not a whole number of 0 or more' };
      return { text: WORDS[n] ?? String(n) };
    }
    case 'cost': {
      if (value === null) return { text: 'closed' };
      const n = num();
      return n === null ? { problem: 'is not a number or null' } : { text: String(n) };
    }
    default:
      return { problem: `asks for the unknown filter '${filter}'` };
  }
}

/** Read a parsed rule book against the values its text names. `file` is said in every problem. */
export function readRuleBook(raw: unknown, file: string, values: unknown, rulesetId: string): RuleBookResult {
  const problems: string[] = [];
  const add = (place: string, message: string): void => {
    problems.push(place === '' ? `${file}: ${message}` : `${file}: ${place}: ${message}`);
  };
  const record = (place: string, v: unknown, keys: readonly string[]): Rec | null => {
    if (!isRec(v)) {
      add(place, 'must be a mapping of keys to values');
      return null;
    }
    for (const k of Object.keys(v)) if (!keys.includes(k)) add(place, `unknown key '${k}'`);
    for (const k of keys) if (!own(v, k)) add(place, `${k} is missing`);
    return v;
  };
  const text = (place: string, v: unknown): string | null => {
    if (typeof v !== 'string' || v.trim() === '') {
      add(place, 'must be a non-empty string');
      return null;
    }
    return v;
  };
  /** Put the named values into a text; the text must type no digit of its own. */
  const fill = (place: string, source: string): string => {
    const bare = source.replace(/\{[^{}]*\}/g, '');
    if (/[{}]/.test(bare)) add(place, 'has a brace that does not close a name');
    if (/[0-9]/.test(bare)) add(place, `types a number of its own ("${(/\S*[0-9]\S*/.exec(bare) ?? [''])[0]}"): name the value between braces, or write it as a word`);
    return source.replace(/\{([^{}]*)\}/g, (_, inner: string) => {
      const [path, filter, ...more] = inner.split('|').map(x => x.trim());
      if (path === undefined || path === '' || more.length > 0) {
        add(place, `{${inner}} is not a name, or a name and one filter`);
        return '';
      }
      const value = valueAt(values, path);
      if (value === undefined) {
        add(place, `{${inner}}: nothing is at ${path}`);
        return '';
      }
      const made = shown(value, filter ?? '');
      if ('problem' in made) {
        add(place, `{${inner}}: the value at ${path} ${made.problem}`);
        return '';
      }
      return made.text;
    });
  };
  const filled = (place: string, v: unknown): string | null => {
    const t = text(place, v);
    return t === null ? null : fill(place, t);
  };
  /** A point's words, the ones between pairs of stars marked strong. */
  const spans = (place: string, source: string): Span[] => {
    const parts = source.split('**');
    if (parts.length % 2 === 0) add(place, 'has a pair of stars that is not closed');
    return parts.map((part, i) => ({ text: part, strong: i % 2 === 1 })).filter(s => s.text !== '');
  };

  const top = record('', raw, ['format', 'ruleset', 'title', 'assumes', 'numbered', 'pages']);
  if (!top) return { book: null, problems };
  if (top['format'] !== RULEBOOK_FORMAT) add('format', `must be '${RULEBOOK_FORMAT}'`);
  if (top['ruleset'] !== rulesetId) add('ruleset', `names the rules data '${String(top['ruleset'])}', but is being read with '${rulesetId}'`);
  const title = text('title', top['title']);

  if (!Array.isArray(top['assumes'])) add('assumes', 'must be a list');
  else {
    top['assumes'].forEach((a: unknown, i: number) => {
      const place = `assumes[${i + 1}]`;
      const v = record(place, a, ['path', 'is']);
      if (!v) return;
      const path = text(`${place}.path`, v['path']);
      if (path === null) return;
      const value = valueAt(values, path);
      if (value === undefined) add(place, `nothing is at ${path}`);
      else if (value !== v['is']) add(place, `the text is written for ${path} being ${JSON.stringify(v['is'])}, and it is ${JSON.stringify(value)}`);
    });
  }

  const pages: RulePage[] = [];
  const list = top['pages'];
  const numbered = top['numbered'];
  if (!Array.isArray(list) || list.length === 0) {
    add('pages', 'must be a list of at least one page');
    return { book: null, problems };
  }
  if (typeof numbered !== 'number' || !Number.isInteger(numbered) || numbered < 0 || numbered > list.length) add('numbered', `must be a whole number from 0 to the number of pages (${list.length})`);
  const seen = new Set<string>();
  list.forEach((p: unknown, i: number) => {
    const at = `pages[${i + 1}]`;
    const v = record(at, p, ['id', 'title', 'lead', 'points', 'tip', 'table']);
    if (!v) return;
    const id = text(`${at}.id`, v['id']);
    if (id !== null) {
      if (!/^[a-z][a-z0-9-]*$/.test(id)) add(`${at}.id`, 'must be lower-case letters, digits and -');
      if (seen.has(id)) add(`${at}.id`, `'${id}' is used twice`);
      seen.add(id);
    }
    const pageTitle = filled(`${at}.title`, v['title']);
    const lead = filled(`${at}.lead`, v['lead']);
    const points: Span[][] = [];
    if (!Array.isArray(v['points']) || v['points'].length === 0) add(`${at}.points`, 'must be a list of at least one point');
    else {
      v['points'].forEach((pt: unknown, k: number) => {
        const done = filled(`${at}.points[${k + 1}]`, pt);
        if (done !== null) points.push(spans(`${at}.points[${k + 1}]`, done));
      });
    }
    const tip = v['tip'] === null ? null : filled(`${at}.tip`, v['tip']);
    let table: RulePage['table'] = null;
    if (v['table'] !== null) {
      const t = record(`${at}.table`, v['table'], ['title', 'rows']);
      if (t) {
        const tableTitle = filled(`${at}.table.title`, t['title']);
        const rows: Figure[] = [];
        if (!Array.isArray(t['rows']) || t['rows'].length === 0) add(`${at}.table.rows`, 'must be a list of at least one row');
        else {
          t['rows'].forEach((r: unknown, k: number) => {
            const place = `${at}.table.rows[${k + 1}]`;
            if (!Array.isArray(r) || r.length !== 2) {
              add(place, 'must be a label and a value');
              return;
            }
            const label = filled(`${place}[1]`, r[0]);
            const value = filled(`${place}[2]`, r[1]);
            if (label !== null && value !== null) rows.push({ label, value });
          });
        }
        if (tableTitle !== null) table = { title: tableTitle, rows };
      }
    }
    if (id !== null && pageTitle !== null && lead !== null) {
      pages.push({ id, mark: typeof numbered === 'number' && i < numbered ? String(i + 1) : '·', title: pageTitle, lead, points, tip, table });
    }
  });

  if (problems.length > 0 || title === null) return { book: null, problems };
  return { book: { title, pages }, problems: [] };
}
