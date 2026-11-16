/**
 * The sound effects' engine: short recordings played through Web Audio.
 *
 *   - The engine's audio context is made, and asked to run, on the first click
 *     or key; or sooner, when the page says so (`wake`: the title's sound does,
 *     as it is built, as if sound always plays). A browser that allows no
 *     sound before the page is touched leaves the context waiting, and the
 *     first touch wakes it.
 *   - While the context is not running, a sound that is asked for is not heard
 *     and is not kept: nothing piles up to burst out when the context wakes.
 *     One case apart, which is how a first click is heard at all: a touch asks
 *     the context to run, and what is asked for in the second after a touch is
 *     started on the waiting context and sounds as it wakes. A sound that has
 *     waited a second is thrown away, never played late.
 *   - A cue's recordings are fetched and decoded on first need, and with them
 *     the rest of its family (a gun has fired: the battle is on). The small
 *     sounds of the table and the panel are fetched soon after the first touch
 *     (or when the context runs without one). A sound whose recording was not
 *     there when it was asked for is still played if the recording comes
 *     within a quarter of a second; else that one playing is passed over.
 *   - A cue may be made, not recorded (`made`: the title's medallion): whoever
 *     hands it in works its samples out, once. All the made cues are worked out
 *     together when one of them is first asked for, whether or not it can be
 *     heard yet, so that the others are there when their turn comes. One that
 *     is asked for while it is still being worked out is played if it comes
 *     within seven tenths of a second (it can only happen that once).
 *   - A standing sound (`sustain`) is a made cue played round and round at a
 *     level set from outside. It starts when its level first leaves nothing,
 *     follows the level smoothly (its tone opening with it), and is let go when
 *     it has rested at nothing for a while. It is a state, not an event: while
 *     the context waits, the page is hidden or the effects are off, only its
 *     level is kept, and it sounds at that level as soon as it can.
 *   - A cue's takes are played in turn, each playing a little different in pitch
 *     and level (cues.ts: a hash, never a random number). A cue is refused
 *     sooner than its least interval after its last start: a move does not fire
 *     forty puffs of engine. A cue with its most voices sounding is not refused:
 *     its oldest voice gives way, quickly and without a click (a shot that made
 *     no sound would be worse than a tail cut short).
 *   - A spoken piece (`say`: the campaign room's narration) is a recording said
 *     whole, once, from its start: the page asks for pieces to be said one after
 *     another. It is a state too: asking for the same pieces again changes
 *     nothing; other pieces, or none, quiet what is being said within a quarter
 *     of a second. Its recording is fetched when it is asked for and waited for
 *     however long it takes (it is never passed over for coming late). While the
 *     context waits, the page is hidden or the effects are off, nothing is said,
 *     and the piece that was being said is said again from its start when it
 *     can be: a briefing heard in part is heard whole.
 *   - A hidden page plays nothing, and what was sounding stops.
 *   - Its own volume is kept between visits (0.8 at first). On or off is not
 *     kept here: it is the music's switch (joins.ts), and `sfx=0` in the address.
 *   - A recording that cannot be fetched or decoded leaves its cue silent. The
 *     page is told once, as a warning, never once a sound.
 *
 * It holds no data of its own: the cues, the files' addresses and the made
 * cues are handed in (sounds.ts).
 */
import { amplitude, Limiter, spread, takeFor, variation } from './cues';
import type { SoundData, SoundTake } from './cues';

export interface PlayOptions {
  /** A multiplier of the cue's own level; 1 when left out. */
  gain?: number;
  /** Where from left (-1) to right (1); the middle when left out. */
  pan?: number;
  /** Seconds from now to its start; none when left out. */
  delay?: number;
}

export interface SfxState {
  readonly on: boolean;
  /** 0 to 1, as a control shows it. */
  readonly volume: number;
  /** The engine can sound: its context is running, or a touch has just asked it to run. */
  readonly awake: boolean;
  /** The audio context's own state (`running`, `suspended`, ...); `none` before it is made. */
  readonly context: string;
}

/** A cue that is made, not recorded. */
export interface MadeCue {
  readonly id: string;
  /** Where it plays, in words. */
  readonly plays: string;
  /** As a recorded cue's (cues.ts): least time between two starts, most voices at once, and how far one playing differs from the next. */
  readonly leastMs: number;
  readonly voices: number;
  readonly cents: number;
  readonly db: number;
  /** Its takes, played in turn. Each works its samples out when asked, once: one array a channel (one channel or two), at `rate` samples a second. */
  readonly takes: readonly ((rate: number) => Promise<readonly Float32Array[]>)[];
  /** As a standing sound, how its tone opens with its level: its low-pass corner runs from `dark` Hz as it leaves nothing to `open` Hz at its full level. None: its tone is the same at every level. */
  readonly tone?: { readonly dark: number; readonly open: number };
}

/** A spoken piece (the campaign room's narration): one recording, said whole from its start. */
export interface Spoken {
  readonly id: string;
  /** Its files and their addresses, in the order to try them. */
  readonly addresses: readonly { readonly file: string; readonly address: string }[];
  /** A multiplier of its recording's level. */
  readonly gain: number;
}

export interface SayOptions {
  /** Seconds from the asking to the first piece's start, at the least; none when left out. */
  readonly afterS?: number;
  /** Seconds from one piece's end to the next one's start; none when left out. */
  readonly gapS?: number;
}

export interface Sfx {
  /** Play a cue by its name. Never throws; does nothing when the effects are off, the page is hidden, the context is not running (and no touch has just asked it to), or the cue comes sooner than its least interval. */
  play(cue: string, opts?: PlayOptions): void;
  /** A standing sound's level now, 0 to 1 (a made cue, by its name): it follows the level, and nothing lets it die away. Cheap: it may be called on every frame. */
  sustain(cue: string, level: number): void;
  /** Pieces to be said one after another, each whole from its start, once (none: nothing is said). Never throws; see the header for what holds them back. */
  say(pieces: readonly Spoken[], o?: SayOptions): void;
  /** The piece being said now, or waiting its moment to be (its id); null when none is, or none can be heard. */
  saying(): string | null;
  /** Asks the engine to sound now, without waiting for a touch: its context is made and asked to run. A browser that allows no sound before the page is touched leaves it waiting, and the first touch wakes it as ever. */
  wake(): void;
  state(): SfxState;
  setOn(on: boolean): void;
  setVolume(volume: number): void;
  /** Calls `fn` whenever the state changes; returns a function that stops the calls. */
  onChange(fn: () => void): () => void;
  /** For checks: how often each cue has been asked for, how many voices of each have started, the files fetched so far, and each standing sound's level as last set. */
  readonly asked: Readonly<Record<string, number>>;
  readonly played: Readonly<Record<string, number>>;
  readonly fetched: readonly string[];
  readonly sustained: Readonly<Record<string, number>>;
  dispose(): void;
}

export interface SfxOptions {
  readonly data: SoundData;
  /** A take's files and their addresses, in the order to try them (the kind this browser plays first). */
  addresses(take: SoundTake): readonly { readonly file: string; readonly address: string }[];
  /** Whether the effects are on as the page starts. */
  readonly startOn: boolean;
  /** Cues that are made, not recorded; none when left out. A name a recorded cue has is an error. */
  readonly made?: readonly MadeCue[];
}

const DEFAULT_VOLUME = 0.8;
const KEPT_VOLUME = 'sfx.volume';
/** A playing whose recording arrives later than this after it was asked for is passed over, milliseconds. */
const LATE_MS = 250;
/** The same for a made cue, which is late only while the made cues are first being worked out: a press whose sound comes half a second late is better than a press with none. */
const MADE_LATE_MS = 700;
/** After a touch has asked a waiting context to run, what is asked for within this is started on it; and a sound that has waited this long for the context is thrown away. Milliseconds. */
const WAKE_MS = 1000;
/** How long after the first touch the small sounds are fetched, milliseconds. */
const EARLY_MS = 300;
/** Seconds in which what is sounding goes quiet when the effects are switched off or the page is hidden. */
const HUSH_S = 0.05;
/** A playing's own gain may not be asked above this. */
const MOST_GAIN = 4;
/** The made cues are a family of their own, whatever the recorded families are called. */
const MADE = '(made)';
/** Made cues are worked out at the context's own rate, held within these (samples a second). */
const MADE_RATE = { least: 22050, most: 48000 };
/** A standing sound follows its level with these time constants, seconds: rising, and falling (it dies away). */
const FOLLOW_S = { up: 0.06, down: 0.2 };
/** A standing sound that has rested at nothing this long is let go, milliseconds; the next level above nothing starts it again. */
const REST_MS = 2500;
/** A standing sound's low-pass has no peak at its corner (in the filter's own unit, dB). */
const TONE_Q_DB = -3;
/** Seconds in which a piece being said goes quiet when it is no longer wanted or can no longer be heard. */
const QUIET_S = 0.25;

/**
 * What keeps many voices at once from clipping: below `KNEE` of full scale the sum passes as it is
 * (a single cue never peaks above it), above it the sum is rounded off toward full scale, which it
 * reaches at about twice full scale coming in. A table of the curve, for an input of -2 to 2.
 */
const KNEE = 0.7;
function softCeiling(): Float32Array<ArrayBuffer> {
  const n = 4097;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = ((i / (n - 1)) * 2 - 1) * 2;
    const a = Math.abs(u);
    curve[i] = a <= KNEE ? u : Math.sign(u) * (KNEE + (1 - KNEE) * Math.tanh((a - KNEE) / (1 - KNEE)));
  }
  return curve;
}

/**
 * A recording's bytes from its address. A build holds the smallest recordings inside the page's own
 * code, as `data:` addresses: those are read here, not fetched (nothing leaves the page for them).
 */
async function bytesAt(address: string): Promise<ArrayBuffer> {
  const held = /^data:[^,]*;base64,/i.exec(address);
  if (held) {
    const text = atob(address.slice(held[0].length));
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return bytes.buffer;
  }
  const answer = await fetch(address);
  if (!answer.ok) throw new Error(`the server answered ${answer.status}`);
  return answer.arrayBuffer();
}

function keptVolume(): number {
  try {
    const v = Number(window.localStorage.getItem(KEPT_VOLUME) ?? Number.NaN);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

/** One take as the engine plays it: a recording to fetch, or samples to have made. Its buffer is kept under `key`. */
interface Take {
  readonly key: string;
  readonly file: SoundTake | null;
  readonly make: ((rate: number) => Promise<readonly Float32Array[]>) | null;
}

/** A cue as the engine plays it, recorded or made. */
interface Cue {
  readonly id: string;
  readonly family: string;
  readonly early: boolean;
  readonly leastMs: number;
  readonly voices: number;
  readonly cents: number;
  readonly db: number;
  readonly detune: number;
  readonly takes: readonly Take[];
  /** Made, not recorded. */
  readonly made: boolean;
  readonly tone: { readonly dark: number; readonly open: number } | null;
}

interface Voice {
  readonly cue: Cue;
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
  readonly last: AudioNode;
  /** It is one of the voices the limiter counts (until it ends, or gives way to a newer one). */
  counted: boolean;
  over: boolean;
  /** Started on a context that was not running yet: the timer that throws it away if the context does not run in time. 0: it sounds. */
  waiting: number;
}

/** A standing sound: its level as last set, and its voice while it has one. */
interface Standing {
  readonly cue: Cue;
  level: number;
  /** The level its voice was last sent. */
  sent: number;
  voice: { readonly source: AudioBufferSourceNode; readonly tone: BiquadFilterNode | null; readonly gain: GainNode } | null;
  /** The timer that lets it go when it has rested at nothing; 0: none. */
  rest: number;
  /** Its samples have been waited for. */
  awaited: boolean;
}

/** A piece's voice: its source, its gain, and the node that leads out of it. */
interface SaidVoice {
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
  readonly last: AudioNode;
}

/** Pieces being said: as asked, the one being said (`pieces.length`: all are said), its voice, and when on the page's clock the next may begin. */
interface Said {
  readonly pieces: readonly Spoken[];
  readonly key: string;
  readonly gapS: number;
  index: number;
  from: number;
  voice: SaidVoice | null;
}

export function startSfx(opts: SfxOptions): Sfx {
  const { data } = opts;
  const cues: Cue[] = [
    ...data.cues.map(
      (c): Cue => ({ id: c.id, family: c.family, early: c.early, leastMs: c.leastMs, voices: c.voices, cents: c.cents, db: c.db, detune: c.detune, takes: c.takes.map(t => ({ key: t.opus, file: t, make: null })), made: false, tone: null }),
    ),
    ...(opts.made ?? []).map(
      (m): Cue => ({ id: m.id, family: MADE, early: false, leastMs: m.leastMs, voices: m.voices, cents: m.cents, db: m.db, detune: 0, takes: m.takes.map((make, i) => ({ key: `${m.id}#${i + 1}`, file: null, make })), made: true, tone: m.tone ?? null }),
    ),
  ];
  const byId = new Map(cues.map(c => [c.id, c]));
  if (byId.size !== cues.length) throw new Error('a made cue has the name of another cue');
  const limiter = new Limiter(data.voices);
  const listeners = new Set<() => void>();
  const counts = new Map<string, number>();
  const asked: Record<string, number> = {};
  const played: Record<string, number> = {};
  const fetched: string[] = [];
  const sustained: Record<string, number> = {};
  /** A take's buffer by its key; null: it could not be had. */
  const buffers = new Map<string, AudioBuffer | null>();
  const loading = new Map<string, Promise<void>>();
  const voices = new Set<Voice>();
  const standing = new Map<string, Standing>();

  let on = opts.startOn;
  let volume = keptVolume();
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  /** When a touch last asked a context that was not running to run (the page's clock, milliseconds). */
  let touchedAt = Number.NEGATIVE_INFINITY;
  let warned = false;
  let gaveUp = false;
  let disposed = false;
  let earlyTimer = 0;
  let earlyDone = false;
  /** A made cue has been asked for; and the made cues have been set to work. */
  let madeWanted = false;
  let madeAsked = false;
  /** The pieces being said, and the piece said last told to the listeners. */
  let said: Said | null = null;
  let toldSaying: string | null = null;

  /** The one warning a page gets, whatever goes wrong and however often. */
  const warn = (what: string, err?: unknown): void => {
    if (warned) return;
    warned = true;
    console.warn(`sound effects: ${what}${err !== undefined ? ` (${err instanceof Error ? err.message : String(err)})` : ''}. The game goes on without that sound; this is said once.`);
  };
  const changed = (): void => {
    for (const fn of [...listeners]) fn();
  };
  const running = (): boolean => ctx !== null && ctx.state === 'running';
  /** Running, or a touch has just asked it to run: what is asked for now is heard as it wakes. */
  const awake = (): boolean => running() || (ctx !== null && performance.now() - touchedAt <= WAKE_MS);
  const state = (): SfxState => ({ on, volume, awake: awake(), context: ctx ? ctx.state : 'none' });

  /** A voice is no longer one of those counted: its place is free. */
  const retire = (v: Voice): void => {
    if (!v.counted) return;
    v.counted = false;
    voices.delete(v);
    limiter.release(v.cue);
  };
  const end = (v: Voice): void => {
    if (v.over) return;
    v.over = true;
    if (v.waiting !== 0) window.clearTimeout(v.waiting);
    v.waiting = 0;
    retire(v);
    v.source.onended = null;
    v.source.disconnect();
    v.gain.disconnect();
    if (v.last !== v.gain) v.last.disconnect();
  };
  /** A voice is thrown away at once: it is not heard again (one that was still waiting for the context is never heard). */
  const drop = (v: Voice): void => {
    try {
      v.source.stop();
    } catch {
      // It had not started.
    }
    end(v);
  };
  /** A voice gives its place up at once and goes quiet quickly, without a click. */
  const giveWay = (v: Voice): void => {
    retire(v);
    if (!ctx || !running() || v.waiting !== 0) {
      drop(v);
      return;
    }
    const now = ctx.currentTime;
    try {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setTargetAtTime(0, now, HUSH_S / 4);
      v.source.stop(now + HUSH_S);
    } catch {
      end(v);
    }
  };
  /** Everything that is sounding goes quiet. */
  const hush = (): void => {
    for (const v of [...voices]) giveWay(v);
  };

  const loadTake = async (take: Take): Promise<void> => {
    const context = ctx;
    if (!context || buffers.has(take.key)) return;
    if (take.make) {
      try {
        const rate = Math.min(MADE_RATE.most, Math.max(MADE_RATE.least, context.sampleRate));
        const channels = await take.make(rate);
        if (disposed) return;
        const length = channels[0]?.length ?? 0;
        if (length === 0 || channels.length > 2 || channels.some(c => c.length !== length)) throw new Error('it has no samples, or more than two channels');
        const buffer = context.createBuffer(channels.length, length, rate);
        channels.forEach((c, i) => buffer.getChannelData(i).set(c));
        buffers.set(take.key, buffer);
      } catch (err) {
        buffers.set(take.key, null);
        warn(`the sound "${take.key}" could not be made`, err);
      }
      return;
    }
    let last: unknown;
    for (const { file, address } of take.file ? opts.addresses(take.file) : []) {
      try {
        const bytes = await bytesAt(address);
        fetched.push(file);
        buffers.set(take.key, await context.decodeAudioData(bytes));
        return;
      } catch (err) {
        last = err;
      }
    }
    buffers.set(take.key, null);
    warn(`the recording "${take.key}" could not be fetched or decoded`, last);
  };
  /** A cue's takes, fetched and decoded, or made, once. */
  const load = (cue: Cue): Promise<void> => {
    let p = loading.get(cue.id);
    if (!p) {
      p = Promise.all(cue.takes.map(loadTake)).then(() => undefined);
      loading.set(cue.id, p);
    }
    return p;
  };
  const early = (): void => {
    earlyTimer = 0;
    if (disposed || gaveUp || !on || !ctx || earlyDone) return;
    earlyDone = true;
    for (const cue of cues) if (cue.early) void load(cue);
  };
  const soon = (): void => {
    if (earlyDone || earlyTimer !== 0 || !on || !ctx) return;
    earlyTimer = window.setTimeout(early, EARLY_MS);
  };

  /** The made cues are worked out together, once: when one of them is first asked for, or as soon after that as the effects are on and there is a context to hold them. */
  const makeAll = (): void => {
    if (!madeWanted || madeAsked || disposed || gaveUp || !on || !ctx) return;
    madeAsked = true;
    for (const cue of cues) if (cue.made) void load(cue);
  };
  const wantMade = (): void => {
    if (madeWanted) return;
    madeWanted = true;
    makeAll();
  };

  // ---- standing sounds ----

  const cornerOf = (tone: { readonly dark: number; readonly open: number }, level: number): number => tone.dark * (tone.open / tone.dark) ** level;
  /** A standing sound's voice goes quiet quickly and is let go; its level is kept. */
  const letGo = (s: Standing): void => {
    if (s.rest !== 0) window.clearTimeout(s.rest);
    s.rest = 0;
    const v = s.voice;
    if (!v) return;
    s.voice = null;
    s.sent = 0;
    const off = (): void => {
      v.source.onended = null;
      v.source.disconnect();
      v.tone?.disconnect();
      v.gain.disconnect();
    };
    if (ctx && running()) {
      try {
        const now = ctx.currentTime;
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setTargetAtTime(0, now, HUSH_S / 4);
        v.source.onended = off;
        v.source.stop(now + HUSH_S);
        return;
      } catch {
        // Stopped as below.
      }
    }
    try {
      v.source.stop();
    } catch {
      // It had not started.
    }
    off();
  };
  /** A standing sound is brought to its level: started when it is first above nothing and can sound, let go when it cannot. */
  const follow = (s: Standing): void => {
    const context = ctx;
    const out = master;
    if (!context || !out || disposed || gaveUp || !on || document.hidden || context.state !== 'running') {
      letGo(s);
      return;
    }
    if (!s.voice) {
      if (s.level <= 0) return;
      const buffer = buffers.get((s.cue.takes[0] as Take).key);
      if (!buffer) {
        // Not made yet: it starts when it has been.
        if (buffer === undefined && !s.awaited) {
          s.awaited = true;
          void load(s.cue).then(() => follow(s));
        }
        return;
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = context.createGain();
      gain.gain.value = 0;
      let tone: BiquadFilterNode | null = null;
      if (s.cue.tone && typeof context.createBiquadFilter === 'function') {
        tone = context.createBiquadFilter();
        tone.type = 'lowpass';
        tone.Q.value = TONE_Q_DB;
        tone.frequency.value = cornerOf(s.cue.tone, s.level);
        source.connect(tone);
        tone.connect(gain);
      } else {
        source.connect(gain);
      }
      gain.connect(out);
      try {
        // Each time from another place in it (a hash of how often it has started): a sound that comes and goes does not always begin the same.
        const from = spread(s.cue.id, played[s.cue.id] ?? 0, 3) * buffer.duration;
        source.start(0, Number.isFinite(from) ? from : 0);
      } catch (err) {
        source.disconnect();
        tone?.disconnect();
        gain.disconnect();
        warn(`the standing sound "${s.cue.id}" could not be started`, err);
        return;
      }
      s.voice = { source, tone, gain };
      s.sent = 0;
      played[s.cue.id] = (played[s.cue.id] ?? 0) + 1;
    }
    if (s.level !== s.sent) {
      const now = context.currentTime;
      s.voice.gain.gain.setTargetAtTime(s.level, now, s.level > s.sent ? FOLLOW_S.up : FOLLOW_S.down);
      // Dying away, its tone stays as it was.
      if (s.voice.tone && s.cue.tone && s.level > 0) s.voice.tone.frequency.setTargetAtTime(cornerOf(s.cue.tone, s.level), now, FOLLOW_S.up);
      s.sent = s.level;
    }
    if (s.level > 0) {
      if (s.rest !== 0) window.clearTimeout(s.rest);
      s.rest = 0;
    } else if (s.rest === 0) {
      s.rest = window.setTimeout(() => {
        s.rest = 0;
        if (s.level <= 0) letGo(s);
      }, REST_MS);
    }
  };
  const followAll = (): void => {
    for (const s of standing.values()) follow(s);
    followSaid();
  };
  const sustain = (id: string, level: number): void => {
    let s = standing.get(id);
    if (!s) {
      const cue = byId.get(id);
      if (!cue || !cue.made) {
        warn(`there is no standing sound called "${id}"`);
        return;
      }
      s = { cue, level: 0, sent: 0, voice: null, rest: 0, awaited: false };
      standing.set(id, s);
      wantMade();
    }
    s.level = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
    sustained[id] = s.level;
    // Called on every frame: the same level again is nothing to do.
    if (s.voice && s.level === s.sent) return;
    follow(s);
  };

  // ---- spoken pieces ----

  const canSay = (): boolean => ctx !== null && master !== null && !disposed && !gaveUp && on && !document.hidden && ctx.state === 'running';
  const saying = (): string | null => (said && said.index < said.pieces.length && canSay() ? (said.pieces[said.index] as Spoken).id : null);
  /** The listeners are told when the piece being said changes (the music gives way under one). */
  const tellSaying = (): void => {
    const now = saying();
    if (now === toldSaying) return;
    toldSaying = now;
    changed();
  };
  const saidKey = (p: Spoken): string => `said:${p.id}`;
  /** A spoken piece's recording, fetched and decoded on the engine's context, once; waited for however long it takes. */
  const loadSaid = (p: Spoken): Promise<void> => {
    const context = ctx;
    const key = saidKey(p);
    if (!context || buffers.has(key)) return Promise.resolve();
    let pending = loading.get(key);
    if (!pending) {
      pending = (async (): Promise<void> => {
        let last: unknown;
        for (const { file, address } of p.addresses) {
          try {
            const bytes = await bytesAt(address);
            fetched.push(file);
            buffers.set(key, await context.decodeAudioData(bytes));
            return;
          } catch (err) {
            last = err;
          }
        }
        buffers.set(key, null);
        warn(`the spoken piece "${p.id}" could not be fetched or decoded`, last);
      })();
      loading.set(key, pending);
    }
    return pending;
  };
  const unhook = (v: SaidVoice): void => {
    v.source.onended = null;
    v.source.disconnect();
    v.gain.disconnect();
    if (v.last !== v.gain) v.last.disconnect();
  };
  /** A piece's voice goes quiet quickly, without a click, and is let go. */
  const quietSaid = (v: SaidVoice): void => {
    v.source.onended = null;
    if (ctx && running()) {
      try {
        const now = ctx.currentTime;
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setTargetAtTime(0, now, QUIET_S / 4);
        v.source.onended = () => unhook(v);
        v.source.stop(now + QUIET_S);
        return;
      } catch {
        // Stopped as below.
      }
    }
    try {
      v.source.stop();
    } catch {
      // It had not started.
    }
    unhook(v);
  };
  /** The pieces asked for are brought to sound: the next one started when it can be heard, the one being said quieted when it cannot. */
  const followSaid = (): void => {
    const s = said;
    if (!s) return tellSaying();
    const context = ctx;
    const out = master;
    if (!context || !out || !canSay()) {
      if (s.voice) {
        quietSaid(s.voice);
        s.voice = null;
        // Said again from its start, as soon as it can be heard.
        s.from = 0;
      }
      // Its recordings are fetched while it waits, when there is a context to decode them on.
      if (context && !disposed && !gaveUp) for (const p of s.pieces.slice(s.index)) void loadSaid(p);
      return tellSaying();
    }
    if (s.voice || s.index >= s.pieces.length) return tellSaying();
    const piece = s.pieces[s.index] as Spoken;
    const buffer = buffers.get(saidKey(piece));
    if (buffer === undefined) {
      for (const p of s.pieces.slice(s.index + 1)) void loadSaid(p);
      void loadSaid(piece).then(() => {
        if (said === s) followSaid();
      });
      return tellSaying();
    }
    if (buffer === null) {
      // A piece whose recording cannot be had is passed over (the page was told once).
      s.index++;
      return followSaid();
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    let level = Math.min(MOST_GAIN, Math.max(0, Number.isFinite(piece.gain) ? piece.gain : 0));
    source.connect(gain);
    let last: AudioNode = gain;
    if (typeof context.createStereoPanner === 'function') {
      // In the middle, through the panner as a cue is: a recording of one channel sounds as loud as it was measured.
      const panner = context.createStereoPanner();
      panner.pan.value = 0;
      gain.connect(panner);
      last = panner;
    } else if (buffer.numberOfChannels === 1) {
      level *= Math.SQRT1_2;
    }
    gain.gain.value = level;
    last.connect(out);
    const voice: SaidVoice = { source, gain, last };
    source.onended = () => {
      unhook(voice);
      if (said !== s || s.voice !== voice) return;
      s.voice = null;
      s.index++;
      s.from = performance.now() + s.gapS * 1000;
      followSaid();
    };
    try {
      source.start(context.currentTime + Math.max(0, (s.from - performance.now()) / 1000));
    } catch (err) {
      unhook(voice);
      warn(`the spoken piece "${piece.id}" could not be started`, err);
      s.index++;
      return tellSaying();
    }
    s.voice = voice;
    played[saidKey(piece)] = (played[saidKey(piece)] ?? 0) + 1;
    tellSaying();
  };
  const say = (pieces: readonly Spoken[], o: SayOptions = {}): void => {
    const key = pieces.map(p => p.id).join('\n');
    if ((said?.key ?? '') === key) return;
    if (said?.voice) quietSaid(said.voice);
    said = pieces.length === 0 ? null : { pieces: [...pieces], key, gapS: Math.max(0, o.gapS ?? 0), index: 0, from: performance.now() + Math.max(0, o.afterS ?? 0) * 1000, voice: null };
    followSaid();
  };

  // ---- playing ----

  const start = (cue: Cue, buffer: AudioBuffer, how: { rate: number; gain: number }, o: PlayOptions, askedAt: number): void => {
    const context = ctx;
    const out = master;
    if (!context || !out) {
      limiter.release(cue);
      return;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = how.rate;
    const gain = context.createGain();
    let level = how.gain * Math.min(MOST_GAIN, Math.max(0, o.gain ?? 1));
    source.connect(gain);
    let last: AudioNode = gain;
    if (typeof context.createStereoPanner === 'function') {
      // Through the panner even in the middle: a recording of one channel then sounds as loud as it was measured.
      const panner = context.createStereoPanner();
      panner.pan.value = Math.min(1, Math.max(-1, o.pan ?? 0));
      gain.connect(panner);
      last = panner;
    } else if (buffer.numberOfChannels === 1) {
      level *= Math.SQRT1_2;
    }
    gain.gain.value = level;
    last.connect(out);
    const voice: Voice = { cue, source, gain, last, counted: true, over: false, waiting: 0 };
    voices.add(voice);
    source.onended = () => end(voice);
    try {
      source.start(context.currentTime + Math.max(0, o.delay ?? 0));
    } catch (err) {
      end(voice);
      warn(`the cue "${cue.id}" could not be started`, err);
      return;
    }
    if (context.state !== 'running') {
      // A touch has just asked the context to run: this sounds as it wakes. If it has not woken in time it is thrown away.
      voice.waiting = window.setTimeout(
        () => {
          voice.waiting = 0;
          if (!running()) drop(voice);
        },
        Math.max(0, WAKE_MS - (performance.now() - askedAt)),
      );
    }
    played[cue.id] = (played[cue.id] ?? 0) + 1;
  };

  const play = (id: string, o: PlayOptions = {}): void => {
    const cue = byId.get(id);
    if (!cue) {
      warn(`there is no cue called "${id}"`);
      return;
    }
    asked[id] = (asked[id] ?? 0) + 1;
    if (cue.made) wantMade();
    if (disposed || gaveUp || !on || document.hidden || !awake()) return;
    const since = performance.now();
    const verdict = limiter.admit(cue, since);
    if (verdict === 'refuse') return;
    if (verdict !== 'start') {
      // Its most voices are sounding (or every voice there is): the oldest gives way to this one.
      let oldest: Voice | undefined;
      for (const v of voices) {
        if (verdict === 'replace-any' || v.cue === cue) {
          oldest = v;
          break;
        }
      }
      if (!oldest) {
        // Those counted are all still waiting for their recordings: there is nothing to give way.
        limiter.release(cue);
        return;
      }
      giveWay(oldest);
    }
    const n = counts.get(id) ?? 0;
    counts.set(id, n + 1);
    const take = cue.takes[takeFor(cue, n)] as Take;
    const how = variation(cue, n);
    const ready = buffers.get(take.key);
    if (ready) {
      start(cue, ready, how, o, since);
      return;
    }
    if (ready === null) {
      limiter.release(cue);
      return;
    }
    // First need: its recordings, and its family's after them. If they come in time this playing is still heard.
    void load(cue).then(() => {
      const buffer = buffers.get(take.key);
      if (buffer && !disposed && on && !document.hidden && awake() && performance.now() - since <= (cue.made ? MADE_LATE_MS : LATE_MS)) start(cue, buffer, how, o, since);
      else limiter.release(cue);
      for (const other of cues) if (other.family === cue.family) void load(other);
    });
  };

  // ---- waking ----

  /** The context runs (or has answered that it does not): what was started while it waited is sounding, and what stands is brought to its level. */
  const woke = (): void => {
    if (running()) {
      for (const v of voices) {
        if (v.waiting !== 0) window.clearTimeout(v.waiting);
        v.waiting = 0;
      }
      soon();
      followAll();
    }
    changed();
  };
  /** The context is made, and asked to run if it is not running: by a touch (the first, and every one after it), or by the page before any. */
  const open = (touch: boolean): void => {
    if (disposed || gaveUp) return;
    if (!ctx) {
      try {
        const context = new AudioContext({ latencyHint: 'interactive' });
        const gain = context.createGain();
        gain.gain.value = amplitude(volume);
        // The sum is halved into the curve, whose table spans an input of -2 to 2 (softCeiling).
        const half = context.createGain();
        half.gain.value = 0.5;
        const ceiling = context.createWaveShaper();
        ceiling.curve = softCeiling();
        gain.connect(half);
        half.connect(ceiling);
        ceiling.connect(context.destination);
        context.addEventListener('statechange', woke);
        ctx = context;
        master = gain;
      } catch (err) {
        gaveUp = true;
        warn('this browser gave no audio context', err);
        return;
      }
    }
    if (ctx.state !== 'running') {
      if (touch) touchedAt = performance.now();
      // Asked again at every touch: a browser that refused before a touch keeps its first answer waiting.
      try {
        ctx.resume().then(woke, woke);
      } catch {
        // A context that cannot be asked: it runs by itself, or not at all.
      }
    }
    // The small sounds are fetched after a touch, or when the context runs without one (`woke`).
    if (touch || running()) soon();
    makeAll();
    // (A context that was running from the first, and so never said that it had woken.)
    if (running()) followAll();
    changed();
  };
  const touched = (): void => open(true);

  const visibility = (): void => {
    if (document.hidden) hush();
    followAll();
  };

  window.addEventListener('pointerdown', touched, true);
  window.addEventListener('pointerup', touched, true);
  window.addEventListener('keydown', touched, true);
  document.addEventListener('visibilitychange', visibility);

  return {
    play,
    sustain,
    say,
    saying,
    wake: () => open(false),
    state,
    setOn(next: boolean): void {
      if (next === on) return;
      on = next;
      if (on) {
        if (running() || touchedAt > Number.NEGATIVE_INFINITY) soon();
        makeAll();
      } else {
        hush();
      }
      followAll();
      changed();
    },
    setVolume(v: number): void {
      if (!Number.isFinite(v)) return;
      volume = Math.min(1, Math.max(0, v));
      try {
        window.localStorage.setItem(KEPT_VOLUME, String(volume));
      } catch {
        // A browser that keeps nothing: the volume holds for this visit.
      }
      if (ctx && master) master.gain.setTargetAtTime(amplitude(volume), ctx.currentTime, 0.015);
      changed();
    },
    onChange(fn: () => void): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    asked,
    played,
    fetched,
    sustained,
    dispose(): void {
      disposed = true;
      if (earlyTimer !== 0) window.clearTimeout(earlyTimer);
      window.removeEventListener('pointerdown', touched, true);
      window.removeEventListener('pointerup', touched, true);
      window.removeEventListener('keydown', touched, true);
      document.removeEventListener('visibilitychange', visibility);
      for (const v of [...voices]) drop(v);
      for (const s of standing.values()) letGo(s);
      if (said?.voice) quietSaid(said.voice);
      said = null;
      limiter.clear();
      listeners.clear();
      if (ctx) void ctx.close().catch(() => undefined);
      ctx = null;
      master = null;
    },
  };
}
