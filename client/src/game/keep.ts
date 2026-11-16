/**
 * A battle played on this page, kept in the browser as it is played (the owner, 2026-11-14: "Reloading your browser
 * for any reason should re-store your current game state"): a reload, or the tab closed and opened again, brings it
 * back where it was. A game played online is not kept here: the server holds it (client/src/net/online.ts).
 *
 * WHAT IS KEPT. One key of the page's local storage a battle, `panzerkanone.battle.<id>`, where the id is the one the
 * game's address carries (`save=<id>`, start.ts): so a reload, and a tab opened again on the same address, find it,
 * and a battle begun afresh from the side selector (whose address has no `save=`) never finds an old one. The value is
 * JSON (KeptBattle): the address's choices that make the battle what it is (scenario, level, deployment, rules, who
 * plays which side, the computer's level, the seed), the content's hashes, the build's version, and the log of every
 * action accepted so far, each as its seat and the action, nothing else. Beside them, for the scenario list's offer
 * and for the page: the battle's title, the turn it is in, the state hash after the last action, whether the briefing
 * has been put away, and where the table's view was.
 *
 * WHY THE LOG IS ENOUGH. The rules are deterministic. The dice are seeded: roll number k of a game shows the face
 * hash(seed, 'dice', k) (engine/kernel/dice.ts SeededDice, engine/core/random.ts rollFace), and the state keeps the
 * number of the next roll, so the same actions from the same start ask for the same rolls and get the same faces.
 * Replaying the log from the seed (host.ts `restore`) therefore rebuilds the state exactly, which the kept hash of the
 * state after the last action proves (a replay that ends anywhere else is refused). The computer's choices are in the
 * log too: they are replayed, never asked for again. Its next one draws from the stream it would have drawn from had
 * the game never stopped (host.ts), and its agent keeps nothing between decisions, so a computer's turn broken off by
 * a reload goes on from the action it had reached, as it would have.
 *
 * WRITTEN after each accepted action, at once: the log's text is kept here and grows by the one action, so a write is
 * one short JSON head and one string join, never the log serialized again (measured: a whole four-turn battle's log is
 * about 5 KB). Written again as the page is hidden or put away (the view with it), and when the briefing is put away.
 *
 * DROPPED when the battle is over; when the player ends it (the menu's Main menu, then End battle); when it is not
 * brought back (its content's hashes are not this build's, it does not replay, or it cannot be read: the page says so
 * in one line, KEPT_WORDS); when a game is started again from the menu (Play again, New seed: the new game is kept in
 * its place); and every other kept battle when a new one begins, so that the storage holds one battle a tab at most.
 *
 * The page's storage may keep nothing (a private window, a full quota): the game plays the same, unkept.
 *
 * No clock and no random number (the game layer reads neither: tests/game/layer.test.ts): the writes are counted in
 * one more key of the storage, and that count orders the kept battles (the list offers the one written last) and
 * numbers a new battle's id.
 */
import type { ContentRefs, Move, Restore } from './host';

/** The key of a kept battle, without its id. */
export const KEPT_PREFIX = 'panzerkanone.battle.';
/** The key of the count of every write of a kept battle in this browser (not under KEPT_PREFIX). */
export const SERIAL_KEY = 'panzerkanone.battle-serial';
/** The format a kept battle's text has: another format is not read. */
export const KEPT_FORMAT = 'panzerkanone.battle/1';

/** What the page says, in one line, when a kept battle could not be brought back (and was dropped). */
export const KEPT_WORDS = {
  older: 'Your saved battle was from an older version of the game and could not be restored.',
  broken: 'Your saved battle could not be restored.',
} as const;

/** The address's choices that make a battle what it is: start.ts reads each from the address so. */
export interface Choices {
  readonly scenario: string | null;
  readonly level: string | null;
  readonly deploy: string | null;
  readonly rules: string | null;
  readonly sides: string | null;
  /** The computer's level (`ai=`). */
  readonly ai: string | null;
  readonly seed: number;
}

const CHOICE_WORDS = ['scenario', 'level', 'deploy', 'rules', 'sides', 'ai'] as const;

/** The choices of an address, the seed read as start.ts reads it (`seedOf`). */
export function choicesFrom(params: URLSearchParams, seedOf: (text: string | null) => number): Choices {
  return {
    scenario: params.get('scenario'),
    level: params.get('level'),
    deploy: params.get('deploy'),
    rules: params.get('rules'),
    sides: params.get('sides'),
    ai: params.get('ai'),
    seed: seedOf(params.get('seed')),
  };
}

/**
 * The same battle: every choice but the computer's level, which the settings laid over a game may change for the next
 * game (shell/settings-overlay.ts writes it into the address at once); the game in progress keeps its own.
 */
export function sameBattle(a: Choices, b: Choices): boolean {
  return a.scenario === b.scenario && a.level === b.level && a.deploy === b.deploy && a.rules === b.rules && a.sides === b.sides && a.seed === b.seed;
}

/** The content a battle is played on: the rules' id and version, and the content hash of the rules data (with the unit file), the scenario and the board. */
export interface ContentPins {
  readonly rules: string;
  readonly ruleset: string;
  readonly scenario: string;
  readonly map: string;
}

/** The pins of a host's content; null when it was not told its content. */
export function pinsOf(host: { readonly refs: ContentRefs | null; readonly ruleset: { readonly id: string; readonly version: string } }): ContentPins | null {
  const r = host.refs;
  if (r === null) return null;
  return { rules: `${host.ruleset.id}@${host.ruleset.version}`, ruleset: r.ruleset.hash, scenario: r.scenario.hash, map: r.map.hash };
}

function samePins(a: ContentPins, b: ContentPins): boolean {
  return a.rules === b.rules && a.ruleset === b.ruleset && a.scenario === b.scenario && a.map === b.map;
}

/** Where the table's view was: its own reading of it (scene/hook.ts `view`), to be given back as it was. */
export interface KeptView {
  readonly mode: 'play' | 'overview';
  readonly centre: readonly [number, number];
  readonly hexesAcross: number;
}

/** A kept battle, as its key holds it. */
export interface KeptBattle {
  readonly format: typeof KEPT_FORMAT;
  readonly id: string;
  /** The browser's count of writes when it was last written: the scenario list offers the battle with the highest. */
  readonly serial: number;
  /** The page's address, to come back to it by (a path on this site, with its query). */
  readonly address: string;
  readonly title: string;
  readonly turn: number;
  readonly choices: Choices;
  readonly content: ContentPins;
  /** The build that kept it (client/src/version.ts). */
  readonly version: string;
  /** The briefing shown before the first turn has been put away. */
  readonly begun: boolean;
  readonly view: KeptView | null;
  /** The state hash after the last action of the log (before the first, when there is none). */
  readonly hash: string;
  readonly log: readonly Move[];
}

/** What the scenario list says of a kept battle, and where it goes to continue it. */
export interface KeptSummary {
  readonly id: string;
  readonly title: string;
  readonly turn: number;
  readonly address: string;
  readonly serial: number;
  readonly actions: number;
}

/** The few calls of the Web Storage API a kept battle needs (the page's `localStorage`, or a test's own). */
export interface KeptStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

/** The page's local storage, or null where the browser keeps nothing (or will not say). */
export function browserStore(): KeptStore | null {
  try {
    const s = (globalThis as { localStorage?: KeptStore }).localStorage;
    return typeof s?.getItem === 'function' ? s : null;
  } catch {
    return null;
  }
}

/**
 * A kept battle's id: small letters and digits, in groups joined by single hyphens, 6 to 24 characters in all, so that
 * it is safe in an address and in a storage key. The hyphens are a campaign's: its battle is kept under
 * `campaign-<seed>-<battle>` (client/src/campaign/battle.ts, `saveIdOf`), and the battle's end is settled into the
 * campaign only when the game keeps the battle under that very id. (Until 2026-11-15 a hyphen was refused: the game
 * took another id, and no campaign battle was ever settled.)
 */
const ID = /^(?=.{6,24}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A kept battle's id from the address (`save=`), or null when it is not one. */
export function keptIdFrom(text: string | null): string | null {
  return text !== null && ID.test(text) ? text : null;
}

/**
 * The id a battle is kept under: the address's (`save=`), or a new one. Null when it is not kept: a game played online
 * (the server holds it), one the computer plays on both sides (nobody's game to lose), and where the browser keeps
 * nothing.
 */
export function keptIdFor(o: {
  readonly save: string | null;
  readonly online: boolean;
  readonly players: readonly string[];
  readonly store: KeptStore | null;
  newId(): string;
}): string | null {
  if (o.online || o.store === null || !o.players.includes('person')) return null;
  return keptIdFrom(o.save) ?? o.newId();
}

/** The next number of the browser's count of writes (it is kept beside the battles; 1 when there is none yet). */
export function nextSerial(store: KeptStore): number {
  let n = 0;
  try {
    const text = store.getItem(SERIAL_KEY);
    if (text !== null && /^\d{1,15}$/.test(text)) n = Number(text);
  } catch {
    n = 0;
  }
  n += 1;
  try {
    store.setItem(SERIAL_KEY, String(n));
  } catch {
    // The order is then as good as the browser lets it be.
  }
  return n;
}

/** The 32-bit FNV-1a hash of a text (for an id: it need only differ from battle to battle). */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

/**
 * A new id for a battle: the next number of the browser's count, and a hash of the battle's choices with it, in base
 * 36 (a dozen characters or so). Never the id of a battle kept now.
 */
export function newKeptId(store: KeptStore, choices: Choices): string {
  const tag = `battle id|${choices.scenario}|${choices.level}|${choices.deploy}|${choices.rules}|${choices.sides}|${choices.seed}`;
  const first = nextSerial(store);
  for (let n = first; ; n++) {
    const id = `${n.toString(36)}${fnv1a(`${tag}|${n}`).toString(36).padStart(7, '0')}`;
    let taken = false;
    try {
      taken = store.getItem(KEPT_PREFIX + id) !== null;
    } catch {
      taken = false;
    }
    if (!taken || n - first > 1000) {
      if (n > first) {
        try {
          store.setItem(SERIAL_KEY, String(n));
        } catch {
          // As above.
        }
      }
      return id;
    }
  }
}

// ---------------------------------------------------------------------------
// reading
// ---------------------------------------------------------------------------

const TOP_KEYS = ['format', 'id', 'serial', 'address', 'title', 'turn', 'choices', 'content', 'version', 'begun', 'view', 'hash', 'log'];
const HASH = /^[0-9a-f]{64}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function exactKeys(v: Record<string, unknown>, keys: readonly string[], place: string, problems: string[]): void {
  for (const k of Object.keys(v)) if (!keys.includes(k)) problems.push(`${place}: unknown key '${k}'`);
  for (const k of keys) if (!(k in v)) problems.push(`${place}: no '${k}'`);
}

/** A path on this site with its query: never another site's address. */
function isOwnAddress(v: unknown): v is string {
  return typeof v === 'string' && v.length < 4000 && v.startsWith('/') && !v.startsWith('//') && !/[\\\s]/.test(v);
}

/** Every problem with a kept battle's parsed text (none: it is one), checked against its key's id. */
export function keptProblems(raw: unknown, id: string): string[] {
  const p: string[] = [];
  if (!isRecord(raw)) return ['not a mapping'];
  exactKeys(raw, TOP_KEYS, 'the record', p);
  if (raw['format'] !== KEPT_FORMAT) p.push(`format: not '${KEPT_FORMAT}'`);
  if (raw['id'] !== id) p.push(`id: not the key's ('${id}')`);
  const serial = raw['serial'];
  if (typeof serial !== 'number' || !Number.isSafeInteger(serial) || serial < 1) p.push('serial: not a count');
  if (!isOwnAddress(raw['address'])) p.push('address: not a path of this site');
  const title = raw['title'];
  if (typeof title !== 'string' || title === '' || title.length > 200) p.push('title: not a title');
  const turn = raw['turn'];
  if (typeof turn !== 'number' || !Number.isInteger(turn) || turn < 0) p.push('turn: not a whole number');
  const choices = raw['choices'];
  if (!isRecord(choices)) p.push('choices: not a mapping');
  else {
    exactKeys(choices, [...CHOICE_WORDS, 'seed'], 'choices', p);
    for (const k of CHOICE_WORDS) if (k in choices && choices[k] !== null && typeof choices[k] !== 'string') p.push(`choices.${k}: not a word or null`);
    const seed = choices['seed'];
    if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) p.push('choices.seed: not a seed');
  }
  const content = raw['content'];
  if (!isRecord(content)) p.push('content: not a mapping');
  else {
    exactKeys(content, ['rules', 'ruleset', 'scenario', 'map'], 'content', p);
    if (typeof content['rules'] !== 'string') p.push('content.rules: not a word');
    for (const k of ['ruleset', 'scenario', 'map']) if (k in content && (typeof content[k] !== 'string' || !HASH.test(content[k] as string))) p.push(`content.${k}: not a hash`);
  }
  if (typeof raw['version'] !== 'string') p.push('version: not a word');
  if (typeof raw['begun'] !== 'boolean') p.push('begun: not true or false');
  const view = raw['view'];
  if (view !== null) {
    if (!isRecord(view)) p.push('view: not a mapping or null');
    else {
      exactKeys(view, ['mode', 'centre', 'hexesAcross'], 'view', p);
      if (view['mode'] !== 'play' && view['mode'] !== 'overview') p.push('view.mode: not play or overview');
      const c = view['centre'];
      if (!Array.isArray(c) || c.length !== 2 || !c.every(x => typeof x === 'number' && Number.isFinite(x))) p.push('view.centre: not a point');
      const across = view['hexesAcross'];
      if (typeof across !== 'number' || !Number.isFinite(across) || across <= 0) p.push('view.hexesAcross: not a size');
    }
  }
  if (typeof raw['hash'] !== 'string' || !HASH.test(raw['hash'])) p.push('hash: not a hash');
  const log = raw['log'];
  if (!Array.isArray(log)) p.push('log: not a list');
  else {
    log.forEach((m: unknown, i) => {
      if (!Array.isArray(m) || m.length !== 2 || typeof m[0] !== 'string' || !isRecord(m[1])) p.push(`log[${i + 1}]: not a seat and an action`);
    });
  }
  return p;
}

/** What is kept under an id: the battle, or why it cannot be read; null when nothing is. */
export function readKept(store: KeptStore, id: string): { readonly record: KeptBattle } | { readonly problem: string } | null {
  let text: string | null;
  try {
    text = store.getItem(KEPT_PREFIX + id);
  } catch {
    return null;
  }
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return { problem: 'not JSON' };
  }
  const problems = keptProblems(raw, id);
  if (problems.length > 0) return { problem: problems.slice(0, 4).join('; ') };
  return { record: raw as KeptBattle };
}

/** Forget the battle kept under an id. */
export function dropKept(store: KeptStore, id: string): void {
  try {
    store.removeItem(KEPT_PREFIX + id);
  } catch {
    // Nothing more can be done.
  }
}

/** The ids of every battle kept. */
export function keptIds(store: KeptStore): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k !== null && k.startsWith(KEPT_PREFIX)) out.push(k.slice(KEPT_PREFIX.length));
    }
  } catch {
    return out;
  }
  return out;
}

/** The battle kept last that has an action in it (the one the scenario list offers), or null; one that cannot be read is dropped. */
export function latestKept(store: KeptStore | null): KeptSummary | null {
  if (store === null) return null;
  let best: KeptSummary | null = null;
  for (const id of keptIds(store)) {
    const got = readKept(store, id);
    if (got === null) continue;
    if ('problem' in got) {
      dropKept(store, id);
      continue;
    }
    const r = got.record;
    if (r.log.length === 0) continue;
    if (best === null || r.serial > best.serial) best = { id: r.id, title: r.title, turn: r.turn, address: r.address, serial: r.serial, actions: r.log.length };
  }
  return best;
}

// ---------------------------------------------------------------------------
// bringing a battle back
// ---------------------------------------------------------------------------

/** What `bringBack` asks of a host. */
export interface RestoreHost {
  readonly refs: ContentRefs | null;
  readonly ruleset: { readonly id: string; readonly version: string };
  restore(moves: readonly Move[], hash?: string): Restore;
}

/** What came of looking for a kept battle for the page's address. */
export type BroughtBack<H> =
  /** Nothing is kept for this battle under the address's id: a new game. */
  | { readonly kind: 'new'; readonly host: H }
  /** The kept battle, where it was. */
  | { readonly kind: 'restored'; readonly host: H; readonly record: KeptBattle }
  /** A battle was kept and could not be brought back: it is dropped, the game is new, and `notice` says so. */
  | { readonly kind: 'dropped'; readonly host: H; readonly notice: string; readonly why: string };

/**
 * Look for the battle kept under `id` and bring it back on a host made for it (`make`, at the computer level given:
 * the kept game's own when it is this battle, else the address's). A battle kept under the id that is another battle
 * (the address was changed by hand) is dropped without a word: the address asks for a new game.
 */
export function bringBack<H extends RestoreHost>(o: {
  readonly store: KeptStore | null;
  readonly id: string;
  readonly choices: Choices;
  /** This build's version (client/src/version.ts). */
  readonly version: string;
  make(ai: string | null): H;
}): BroughtBack<H> {
  const fresh = (): H => o.make(o.choices.ai);
  if (o.store === null) return { kind: 'new', host: fresh() };
  const got = readKept(o.store, o.id);
  if (got === null) return { kind: 'new', host: fresh() };
  if ('problem' in got) {
    dropKept(o.store, o.id);
    return { kind: 'dropped', host: fresh(), notice: KEPT_WORDS.broken, why: `the kept battle cannot be read: ${got.problem}` };
  }
  const r = got.record;
  if (!sameBattle(r.choices, o.choices)) {
    dropKept(o.store, o.id);
    return { kind: 'new', host: fresh() };
  }
  const host = o.make(r.choices.ai);
  // A host left as it was by a refused restore is a new game; at the address's level of the computer, when that is another.
  const unkept = (): H => (r.choices.ai === o.choices.ai ? host : fresh());
  const pins = pinsOf(host);
  if (pins === null || !samePins(pins, r.content)) {
    dropKept(o.store, o.id);
    return { kind: 'dropped', host: unkept(), notice: KEPT_WORDS.older, why: 'the content it was played on is not this build\'s' };
  }
  const done = host.restore(r.log, r.hash);
  if (!done.ok) {
    dropKept(o.store, o.id);
    return { kind: 'dropped', host: unkept(), notice: r.version !== o.version ? KEPT_WORDS.older : KEPT_WORDS.broken, why: `action ${done.at} of ${r.log.length} does not replay: ${done.why}` };
  }
  return { kind: 'restored', host, record: r };
}

// ---------------------------------------------------------------------------
// keeping a battle as it is played
// ---------------------------------------------------------------------------

/** What a keeper asks of a host. */
export interface KeptHost {
  readonly hash: string;
  turn(): number;
  over(): boolean;
  moves(): Move[];
  onAccepted(f: (seat: string, action: unknown, seq: number) => void): () => void;
}

export interface KeeperOptions {
  readonly store: KeptStore;
  readonly id: string;
  readonly choices: Choices;
  readonly title: string;
  readonly pins: ContentPins;
  readonly version: string;
  /** The page's address as it stands (a path with its query). */
  address(): string;
  /** Where the table's view is now; null when the page cannot say. */
  view?(): KeptView | null;
  /** Told once, when the browser will keep no more (its storage is full or refuses). */
  failed?(why: string): void;
}

/** Keeps one battle as it is played: one key, written after each accepted action. */
export class Keeper {
  private readonly o: KeeperOptions;
  private readonly host: KeptHost;
  private readonly stop: () => void;
  /** The log's JSON text so far, without its brackets. */
  private logText = '';
  private count = 0;
  private begunNow: boolean;
  private closed = false;

  /**
   * Keep the battle on `host`, as it stands (a game brought back holds its log already). `fresh`: a new game, and every
   * other kept battle is dropped. `begun`: the briefing has been put away already.
   */
  constructor(o: KeeperOptions, host: KeptHost, how: { readonly fresh: boolean; readonly begun: boolean }) {
    this.o = o;
    this.host = host;
    this.begunNow = how.begun;
    for (const m of host.moves()) this.add(m[0], m[1]);
    if (how.fresh) for (const id of keptIds(o.store)) if (id !== o.id) dropKept(o.store, id);
    this.stop = host.onAccepted((seat, action) => {
      if (this.closed) return;
      this.add(seat, action);
      if (this.host.over()) {
        // The battle is over: nothing of it is kept.
        this.end();
        return;
      }
      this.write();
    });
    if (host.over()) this.end();
    else this.write();
  }

  private add(seat: string, action: unknown): void {
    this.logText += (this.count > 0 ? ',' : '') + JSON.stringify([seat, action]);
    this.count += 1;
  }

  /** How many actions are kept, and whether this keeper still writes: for checks. */
  get kept(): { readonly id: string; readonly actions: number; readonly open: boolean } {
    return { id: this.o.id, actions: this.count, open: !this.closed };
  }

  /** The briefing has been put away: a reload does not lay it open again. */
  begun(): void {
    if (this.begunNow) return;
    this.begunNow = true;
    this.write();
  }

  /** Write now, with the view as it stands: the page is being hidden or put away. */
  flush(): void {
    this.write();
  }

  /** The battle is ended here (the player ended it, or it is over): it is dropped, and nothing more is written. */
  end(): void {
    if (this.closed) return;
    this.closed = true;
    this.stop();
    dropKept(this.o.store, this.o.id);
  }

  /** This game is done with on this page (another takes its place): nothing more is written; what is kept stays. */
  detach(): void {
    if (this.closed) return;
    this.closed = true;
    this.stop();
  }

  private text(): string {
    const o = this.o;
    let view: KeptView | null = null;
    try {
      view = o.view?.() ?? null;
    } catch {
      view = null;
    }
    const head = {
      format: KEPT_FORMAT,
      id: o.id,
      serial: nextSerial(o.store),
      address: o.address(),
      title: o.title,
      turn: this.host.turn(),
      choices: o.choices,
      content: o.pins,
      version: o.version,
      begun: this.begunNow,
      view: view === null ? null : { mode: view.mode, centre: [view.centre[0], view.centre[1]], hexesAcross: view.hexesAcross },
      hash: this.host.hash,
    };
    return `${JSON.stringify(head).slice(0, -1)},"log":[${this.logText}]}`;
  }

  private write(): void {
    if (this.closed) return;
    const key = KEPT_PREFIX + this.o.id;
    const text = this.text();
    try {
      this.o.store.setItem(key, text);
      return;
    } catch {
      // Full, most likely: make room by dropping every other kept battle, and try once more.
    }
    for (const id of keptIds(this.o.store)) if (id !== this.o.id) dropKept(this.o.store, id);
    try {
      this.o.store.setItem(key, text);
    } catch (err) {
      // The browser keeps no more: the game goes on unkept.
      this.closed = true;
      this.stop();
      this.o.failed?.(err instanceof Error ? err.message : String(err));
    }
  }
}
