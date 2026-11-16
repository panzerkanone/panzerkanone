/**
 * The music player: one piece at a time from the playlist, then a quiet
 * stretch of the game with an ambient piece played softly in it, then the next
 * piece.
 *
 *   - Nothing snaps: a piece comes in and goes out on a fade; so does switching
 *     the music off and on. The volume control alone is direct.
 *   - A quiet stretch (playlist.ts) is a few seconds of silence, one ambient
 *     piece for a spell of varied length, and a few seconds of silence again.
 *     The ambient piece fades in and out by its own soft curve, at its own
 *     level under the regular pieces, and is silent before the next piece.
 *     The stretch's clock leads; the ambient piece follows it.
 *   - A browser plays nothing before the page has been touched. Until then the
 *     player waits, and starts on the first click or key.
 *   - While the page is hidden the piece is held and the quiet stretch does not
 *     run down: the stretches are of the game, not of the clock.
 *   - A reload of the page goes on where it was (the piece and the place in it,
 *     or the place in the quiet stretch and its ambient piece). A new visit
 *     starts with the piece after the last one that was played to its end,
 *     unless the page asks for a piece to begin with (the title screen does).
 *   - The player's two choices (on or off, the volume) are kept between visits.
 *   - Under a voice (the campaign room's narration: narration.ts) the music
 *     gives way, `GIVE_WAY` lower, going down quickly and coming back slowly.
 *
 * It holds no art and no data of its own: the playlist and the files'
 * addresses are handed in (index.ts). Its `state`, `setOn`, `setVolume`,
 * `next` and `onChange` are what the game's panel is handed for its menu.
 */
import { after, afterPiece, ambientFade, amplitude, firstPlace, gainOf, inStretch, placeOfPiece, readPlace } from './playlist';
import type { MusicData, MusicFile, MusicTrack, Place, Stretch } from './playlist';

export interface MusicState {
  readonly on: boolean;
  /** 0 to 1, as a control shows it. */
  readonly volume: number;
  /** The piece playing, or the one that comes next; null when there is none to play. */
  readonly title: string | null;
  /** A piece is sounding now. */
  readonly playing: boolean;
  /** The ambient piece sounding softly in a quiet stretch now; null when none is. */
  readonly ambient: string | null;
}

export interface Music {
  state(): MusicState;
  setOn(on: boolean): void;
  setVolume(volume: number): void;
  /** Ends the piece or the quiet stretch and starts the next piece (and switches the music on). */
  next(): void;
  /** Calls `fn` whenever the state changes; returns a function that stops the calls. */
  onChange(fn: () => void): () => void;
  /** Gives way under a voice (true), or comes back (false): eased, never snapping. */
  giveWay(under: boolean): void;
  dispose(): void;
}

export interface MusicOptions {
  readonly data: MusicData;
  /** The address of a piece's file (a regular piece's or an ambient piece's). */
  address(piece: MusicFile): string;
  /** On or off for this page only (the address said so); null: the player's own choice as kept, on when there is none. */
  readonly startOn: boolean | null;
  /**
   * A regular piece (its id) to begin with: it starts after the lead-in, from its first note, whatever this
   * visit left off or played last. An id the playlist does not have is an error.
   */
  readonly begin?: string;
}

/** Seconds: a piece coming in, going out when switched off, going out for the next piece, coming back when the page is shown again. */
const FADE = { in: 2.5, off: 0.7, skip: 0.45, back: 1.2 };
const DEFAULT_VOLUME = 0.8;
/** Under a voice: how far the music gives way, in dB, and the seconds it takes to go down and to come back. */
const GIVE_WAY = { db: -10, down: 0.4, back: 1.5 };
/** How often the waits run down and the place is noted, in milliseconds. */
const TICK_MS = 250;
const NOTE_EVERY_MS = 1000;
const KEPT = { on: 'music.on', volume: 'music.volume', last: 'music.last' };
const PLACE = 'music.place';

function kept(store: 'local' | 'session', key: string): string | null {
  try {
    return (store === 'local' ? window.localStorage : window.sessionStorage).getItem(key);
  } catch {
    return null;
  }
}
function keep(store: 'local' | 'session', key: string, value: string): void {
  try {
    (store === 'local' ? window.localStorage : window.sessionStorage).setItem(key, value);
  } catch {
    // A browser that keeps nothing: the player works, and forgets.
  }
}

/** A visit's seed: the browser's own random source (the platform's plain random function is not used). */
function newSeed(): number {
  try {
    return (crypto.getRandomValues(new Uint32Array(1))[0] as number) >>> 0;
  } catch {
    return Date.now() >>> 0;
  }
}

export function startMusic(opts: MusicOptions): Music {
  const { data } = opts;
  const listeners = new Set<() => void>();
  let on = opts.startOn ?? kept('local', KEPT.on) !== '0';
  const keptVolume = Number(kept('local', KEPT.volume) ?? Number.NaN);
  let volume = Number.isFinite(keptVolume) ? Math.min(1, Math.max(0, keptVolume)) : DEFAULT_VOLUME;

  // The piece the page asked for; else where a reload left off, if this visit has such a place; else the start of a visit.
  const place: Place =
    opts.begin !== undefined
      ? placeOfPiece(data, opts.begin, newSeed())
      : (readPlace(data, kept('session', PLACE)) ?? firstPlace(data, kept('local', KEPT.last), newSeed()));

  /** The sound in hand: a regular piece (in its 'play' phase) or the ambient piece of a quiet stretch. */
  let el: HTMLAudioElement | null = null;
  let ambient: MusicFile | null = null;
  /** The stretch (by `place.stretch`) whose ambient piece has been started: it is not started twice. */
  let ambientOf = -1;
  /** Bumped whenever the sound in hand changes: what an old sound's events and fades check before they act. */
  let turn = 0;
  /** The fade: `level` goes to `aim` at `rate` a second; `then` runs when it arrives. */
  let level = 0;
  let aim = 0;
  let rate = 0;
  let then: (() => void) | null = null;
  let frame = 0;
  let fadeAt = 0;
  /** The frames that follow the ambient piece's own fade in and out. */
  let glideFrame = 0;
  /** Giving way under a voice: where it is, in dB (0: not at all), where it is going, and its frames. */
  let underDb = 0;
  let underAim = 0;
  let underFrame = 0;
  let underAt = 0;
  /** The browser refused to play before a touch. */
  let blocked = false;
  let failures = 0;
  let gaveUp = false;
  let disposed = false;
  let tickAt = performance.now();
  let notedAt = 0;
  let shown = '';

  const track = (): MusicTrack | null => data.tracks[place.index] ?? null;
  const heard = (): boolean => on && el !== null && !el.paused && !blocked;
  const sounding = (): boolean => heard() && ambient === null && place.phase === 'play';
  const state = (): MusicState => ({
    on,
    volume,
    title: gaveUp ? null : (track()?.title ?? null),
    playing: sounding(),
    ambient: ambient !== null && heard() ? ambient.title : null,
  });

  /** Tells the listeners, when what they would read has changed. */
  const changed = (): void => {
    const s = state();
    const now = `${s.on}|${s.volume}|${s.title}|${s.playing}|${s.ambient}`;
    if (now === shown) return;
    shown = now;
    for (const fn of [...listeners]) fn();
  };

  /** The quiet stretch now and how far into its spell, between the ticks too (its clock runs while the music is on and the page shown). */
  const stretchNow = (): { stretch: Stretch; into: number } | null => {
    const s = inStretch(data, place);
    if (!s) return null;
    const running = on && !document.hidden && !disposed && !gaveUp;
    return running ? { stretch: s.stretch, into: s.into + Math.min(1, Math.max(0, (performance.now() - tickAt) / 1000)) } : s;
  };

  const apply = (): void => {
    if (!el) return;
    let v = 0;
    if (ambient) {
      const s = stretchNow();
      v = s ? amplitude(volume) * gainOf(ambient, data.targetLufs) * data.ambient.level * ambientFade(data, s.stretch, s.into) * level : 0;
    } else {
      const t = track();
      v = t ? amplitude(volume) * gainOf(t, data.targetLufs) * level : 0;
    }
    el.volume = Math.min(1, Math.max(0, v * 10 ** (underDb / 20)));
  };

  const underStep = (now: number): void => {
    underFrame = 0;
    const dt = Math.min(0.1, Math.max(0, (now - underAt) / 1000));
    underAt = now;
    const d = (-GIVE_WAY.db / (underAim < underDb ? GIVE_WAY.down : GIVE_WAY.back)) * dt;
    underDb = Math.abs(underAim - underDb) <= d ? underAim : underDb + Math.sign(underAim - underDb) * d;
    apply();
    if (underDb !== underAim) underFrame = requestAnimationFrame(underStep);
  };

  const step = (now: number): void => {
    frame = 0;
    const dt = Math.min(0.1, Math.max(0, (now - fadeAt) / 1000));
    fadeAt = now;
    const d = rate * dt;
    level = Math.abs(aim - level) <= d ? aim : level + Math.sign(aim - level) * d;
    apply();
    if (level !== aim) {
      frame = requestAnimationFrame(step);
      return;
    }
    const done = then;
    then = null;
    if (done) done();
  };

  /** Take the level to `to` over `seconds` (from wherever it is), then run `after`. A hidden page has no frames: it arrives at once. */
  const fadeTo = (to: number, seconds: number, afterwards: (() => void) | null = null): void => {
    aim = to;
    rate = seconds > 0 ? 1 / seconds : Number.POSITIVE_INFINITY;
    then = afterwards;
    if (document.hidden || seconds <= 0) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      level = aim;
      apply();
      then = null;
      if (afterwards) afterwards();
      return;
    }
    if (!frame) {
      fadeAt = performance.now();
      frame = requestAnimationFrame(step);
    }
  };

  /** The ambient piece's own fade, followed frame by frame while it is coming in or going out. */
  const inRamp = (): boolean => {
    const s = stretchNow();
    return s !== null && (s.into < data.ambient.fadeIn || s.into > s.stretch.spell - data.ambient.fadeOut);
  };
  const glide = (): void => {
    glideFrame = 0;
    apply();
    if (ambient && el && !el.paused && !document.hidden && inRamp()) glideFrame = requestAnimationFrame(glide);
  };
  const glideOn = (): void => {
    if (!glideFrame && ambient && el && !el.paused && !document.hidden && inRamp()) glideFrame = requestAnimationFrame(glide);
  };

  const note = (): void => {
    keep('session', PLACE, JSON.stringify({ ...place, at: el && !ambient && place.phase === 'play' ? el.currentTime : place.at }));
  };

  const drop = (): void => {
    turn++;
    if (frame) cancelAnimationFrame(frame);
    if (glideFrame) cancelAnimationFrame(glideFrame);
    frame = 0;
    glideFrame = 0;
    then = null;
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
      el = null;
    }
    ambient = null;
    level = 0;
    aim = 0;
  };

  /** The piece is over (or could not be played): a quiet stretch, then the next. */
  const rest = (): void => {
    drop();
    Object.assign(place, afterPiece(data, place));
    note();
    changed();
  };

  const tryPlay = (): void => {
    const mine = turn;
    const audio = el;
    if (!audio || !on || document.hidden) return;
    audio.play().then(
      () => {
        if (mine !== turn) return;
        blocked = false;
        changed();
      },
      (err: unknown) => {
        if (mine !== turn) return;
        // Refused until the page is touched: wait for that. Anything else is the file's fault and comes as its 'error'.
        if (err instanceof DOMException && err.name === 'NotAllowedError') blocked = true;
        changed();
      },
    );
  };

  const begin = (): void => {
    const t = track();
    if (!t || gaveUp) return;
    drop();
    const mine = turn;
    const audio = new Audio();
    el = audio;
    place.phase = 'play';
    place.left = 0;
    const from = place.at;
    audio.preload = 'auto';
    audio.addEventListener('loadedmetadata', () => {
      if (mine === turn && from > 0 && from < audio.duration - 1) audio.currentTime = from;
    });
    audio.addEventListener('ended', () => {
      if (mine !== turn) return;
      failures = 0;
      keep('local', KEPT.last, t.id);
      rest();
    });
    audio.addEventListener('error', () => {
      if (mine !== turn) return;
      failures++;
      if (failures >= data.tracks.length) {
        // Not one piece can be played: say so once and stay silent.
        console.warn('music: no piece could be played');
        gaveUp = true;
        drop();
        changed();
        return;
      }
      rest();
    });
    audio.addEventListener('playing', changed);
    audio.addEventListener('pause', changed);
    audio.src = opts.address(t);
    level = 0;
    apply();
    if (on) {
      fadeTo(1, FADE.in);
      tryPlay();
    }
    note();
    changed();
  };

  /** A quiet stretch's ambient piece, from `into` seconds into its spell (where the stretch's clock is). */
  const beginAmbient = (piece: MusicFile, into: number): void => {
    drop();
    const mine = turn;
    const audio = new Audio();
    el = audio;
    ambient = piece;
    ambientOf = place.stretch;
    audio.preload = 'auto';
    audio.addEventListener('loadedmetadata', () => {
      if (mine !== turn) return;
      // The file has taken a moment to come: it starts where the clock is by now.
      const s = stretchNow();
      if (s && s.into > 0.5 && s.into < audio.duration - 1) audio.currentTime = s.into;
    });
    const end = (): void => {
      if (mine !== turn) return;
      drop();
      changed();
    };
    audio.addEventListener('ended', end);
    audio.addEventListener('error', () => {
      if (mine !== turn) return;
      // The stretch goes on without it; the regular pieces are not held up.
      console.warn(`music: the ambient piece "${piece.id}" could not be played`);
      end();
    });
    audio.addEventListener('playing', () => {
      changed();
      glideOn();
    });
    audio.addEventListener('pause', changed);
    audio.src = opts.address(piece);
    level = 0;
    apply();
    if (on) {
      // From its first note the piece's own fade brings it in; taken up in the middle (a reload), it comes in as a piece does.
      fadeTo(1, into > 1 ? FADE.in : 0);
      tryPlay();
    }
    changed();
  };

  /** In a quiet stretch: the ambient piece starts when its spell does, follows its fade, and is let go when its spell is over. */
  const hearStretch = (): void => {
    const s = inStretch(data, place);
    if (!s) return;
    const { stretch, into } = s;
    if (ambient && el) {
      if (into >= stretch.spell) {
        // Its fade has brought it to silence by now.
        drop();
        changed();
        return;
      }
      apply();
      glideOn();
      return;
    }
    const piece = data.ambient.pieces[stretch.ambient];
    if (piece && ambientOf !== place.stretch && into >= 0 && into < stretch.spell - 1) beginAmbient(piece, into);
  };

  const tick = (): void => {
    const now = performance.now();
    const dt = Math.min(1, Math.max(0, (now - tickAt) / 1000));
    tickAt = now;
    if (disposed || gaveUp || !on || document.hidden) return;
    if (place.phase === 'wait') {
      place.left -= dt;
      if (place.left <= 0) begin();
      else hearStretch();
    }
    if (now - notedAt >= NOTE_EVERY_MS) {
      notedAt = now;
      note();
    }
  };

  const touched = (): void => {
    if (!blocked || !on || !el) return;
    if (ambient) {
      // The stretch's clock has run on while the browser held the piece: it starts where the clock is.
      const s = stretchNow();
      if (!s || s.into >= s.stretch.spell - 1) {
        drop();
        changed();
        return;
      }
      if (s.into > 0.5 && el.readyState >= 1 && s.into < el.duration - 1) el.currentTime = s.into;
    }
    // The sound has been waiting for this: it comes in from nothing, as it would have.
    level = 0;
    apply();
    fadeTo(1, FADE.in);
    tryPlay();
  };

  const visibility = (): void => {
    if (!el) return;
    if (document.hidden) {
      note();
      el.pause();
      level = 0;
      aim = 0;
      apply();
    } else if (on) {
      tickAt = performance.now();
      fadeTo(1, FADE.back);
      tryPlay();
    }
  };

  const timer = window.setInterval(tick, TICK_MS);
  window.addEventListener('pointerdown', touched, true);
  window.addEventListener('pointerup', touched, true);
  window.addEventListener('keydown', touched, true);
  window.addEventListener('pagehide', note);
  document.addEventListener('visibilitychange', visibility);

  // A reload in the middle of a piece: take it up again where it was (switched off, nothing is fetched until it is
  // switched on). In the middle of a quiet stretch, the first tick takes up its ambient piece.
  if (place.phase === 'play' && on) begin();
  note();
  shown = '';
  changed();

  return {
    state,
    setOn(next: boolean): void {
      if (next === on) return;
      on = next;
      keep('local', KEPT.on, on ? '1' : '0');
      if (el) {
        if (on) {
          fadeTo(1, FADE.in);
          tryPlay();
        } else {
          const audio = el;
          fadeTo(0, FADE.off, () => {
            note();
            audio.pause();
          });
        }
      } else if (on && place.phase === 'play') {
        begin();
      }
      tickAt = performance.now();
      changed();
    },
    setVolume(v: number): void {
      if (!Number.isFinite(v)) return;
      volume = Math.min(1, Math.max(0, v));
      keep('local', KEPT.volume, String(volume));
      apply();
      changed();
    },
    next(): void {
      if (gaveUp) return;
      if (!on) {
        on = true;
        keep('local', KEPT.on, '1');
      }
      if (el) {
        // Out quickly, then the next piece: after the piece playing, or the one the quiet stretch was waiting for.
        const mine = turn;
        const playing = !ambient && place.phase === 'play';
        fadeTo(0, FADE.skip, () => {
          if (mine !== turn) return;
          if (playing) place.index = after(data, place.index);
          place.at = 0;
          begin();
        });
      } else {
        place.at = 0;
        begin();
      }
      changed();
    },
    onChange(fn: () => void): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    giveWay(under: boolean): void {
      underAim = under ? GIVE_WAY.db : 0;
      // A hidden page has no frames: it arrives at once.
      if (document.hidden) {
        if (underFrame) cancelAnimationFrame(underFrame);
        underFrame = 0;
        underDb = underAim;
        apply();
        return;
      }
      if (!underFrame && underDb !== underAim) {
        underAt = performance.now();
        underFrame = requestAnimationFrame(underStep);
      }
    },
    dispose(): void {
      disposed = true;
      if (underFrame) cancelAnimationFrame(underFrame);
      note();
      window.clearInterval(timer);
      window.removeEventListener('pointerdown', touched, true);
      window.removeEventListener('pointerup', touched, true);
      window.removeEventListener('keydown', touched, true);
      window.removeEventListener('pagehide', note);
      document.removeEventListener('visibilitychange', visibility);
      drop();
      listeners.clear();
    },
  };
}
