/**
 * What sets the effects off in a game: the pieces tell this file what a game asks of them (fire is
 * being drawn; a counter is destroyed, is moved, is suppressed; a marker lies on a hex), and it
 * starts the effect that goes with it. The game knows nothing of effects, and the pieces only that
 * someone is watching (pieces.ts: `PiecesWatch`).
 *
 * What the port does not say is made up for as well as can be: which unit of a stack fires (the
 * top one that can), whether a round hit (it always arrives: sparks on armour, dirt beside
 * anything else), and that a fire mission has arrived (its marker has been taken up). A game that
 * answers for its shots (the port's `answer`: `fired`, then `landed` with what came of it) gets the
 * same effects from the counter that really fired, timed by the game; from its first such answer
 * on, fire that is merely being drawn (`threats`) starts nothing here.
 */
import type { MarkerSpec, Shot } from '../pieces/cues';
import type { Piece, Pieces, PiecesWatch } from '../pieces/pieces';
import type { Effects } from './effects';
import type { FxTune } from './tune';
import { unitFx } from './units';
import type { FireStyle, UnitFx, UnitFxTable } from './units';

type P2 = readonly [number, number];

interface Mover {
  piece: Piece;
  lastX: number;
  lastY: number;
  run: number;
  share: number;
}

export class Watch implements PiecesWatch {
  /** The pieces, once they have said anything. */
  pieces: Pieces | null = null;
  /** Hexes with a smoke screen that no marker put there (the demonstration's). */
  readonly extraScreens = new Set<number>();
  private readonly fx: Effects;
  private readonly table: UnitFxTable;
  private readonly tune: FxTune;
  private readonly centre: (hex: number) => P2;
  private live = new Set<string>();
  /** A game answers for its shots itself (the port's `answer`): from its first such answer on, fire being drawn starts no shot here. */
  private answered = false;
  /** The shots of the last moments, by their hexes: when each lands, where, and whether its arrival has been drawn. */
  private readonly flown = new Map<string, { lands: number; at: [number, number]; armour: boolean; style: FireStyle; ux: number; uy: number; arrived: boolean }>();
  private markerScreens: number[] = [];
  private incoming = new Set<number>();
  private readonly due: { hex: number; at: number }[] = [];
  private readonly movers: Mover[] = [];
  private readonly wisps = new Set<Piece>();

  constructor(fx: Effects, table: UnitFxTable, tune: FxTune, centre: (hex: number) => P2) {
    this.fx = fx;
    this.table = table;
    this.tune = tune;
    this.centre = centre;
    fx.occupied = hex => (this.pieces ? this.pieces.stackAt(hex).length > 0 : false);
  }

  private of(p: Piece | undefined): UnitFx {
    return p ? unitFx(this.table, p.face) : this.table.other;
  }

  /** The counter of a hex that fires: the top one that can, one of an acting group before any other. */
  private firer(pieces: Pieces, hex: number): Piece | undefined {
    const stack = pieces.stackAt(hex);
    let found: Piece | undefined;
    for (let i = stack.length - 1; i >= 0; i--) {
      const p = stack[i] as Piece;
      if (this.of(p).fire === 'none') continue;
      if (p.notes.active) return p;
      found ??= p;
    }
    return found;
  }

  private top(pieces: Pieces, hex: number): Piece | undefined {
    const stack = pieces.stackAt(hex);
    return stack[stack.length - 1];
  }

  /** A unit's fire leaves it. With `arrival` its fire also arrives, as best the port lets that be known. */
  private launch(from: number, to: number, firer: Piece | undefined, target: Piece | undefined, delay: number, arrival: boolean): void {
    const style: FireStyle = firer ? this.of(firer).fire : 'gun';
    if (style === 'none') return;
    const at: P2 = firer && !firer.off ? [firer.pose.p[0], firer.pose.p[1]] : this.centre(from);
    const there = this.centre(to);
    const armour = target ? this.of(target).armour : false;
    const shot = this.fx.fire(style, at, there, from, to, armour, delay, arrival);
    const d = Math.hypot(there[0] - at[0], there[1] - at[1]) || 1;
    for (const [key, was] of this.flown) if (this.fx.now - was.lands > 6) this.flown.delete(key);
    this.flown.set(`${from}>${to}`, { lands: this.fx.now + shot.after, at: shot.at, armour, style, ux: (there[0] - at[0]) / d, uy: (there[1] - at[1]) / d, arrived: arrival });
  }

  /** The port's answer `fired`: the shot itself, from the counter that fires. What comes of it is told by `landed`. */
  fired(a: { from: number; to: number; by: string; on: string | null }): void {
    const pieces = this.pieces;
    if (!pieces) return;
    const key = `${a.from}>${a.to}`;
    // The very first answered shot may already have been fired from the line the port drew for it.
    const twice = !this.answered && this.live.has(key) && this.flown.has(key);
    this.answered = true;
    if (twice) return;
    this.launch(a.from, a.to, pieces.has(a.by) ? pieces.get(a.by) : this.firer(pieces, a.from), a.on !== null && pieces.has(a.on) ? pieces.get(a.on) : this.top(pieces, a.to), 0.02, false);
  }

  /** The port's answer `landed`: the fire arrives, when its round does (or now, if that moment has passed). */
  landed(a: { from: number; to: number; by: string; on: string | null; result: 'none' | 'suppressed' | 'destroyed' }): void {
    if (!this.pieces) return;
    const key = `${a.from}>${a.to}`;
    let shot = this.flown.get(key);
    // Nothing was fired for it (the game told only what came of it): it is fired now.
    if (!shot || this.fx.now - shot.lands > 4) {
      this.flown.delete(key);
      this.fired(a);
      shot = this.flown.get(key);
    }
    this.answered = true;
    if (!shot || shot.arrived) return;
    shot.arrived = true;
    const delay = Math.max(0, shot.lands - this.fx.now);
    // A gun's round strikes sparks on armour whatever comes of it (one that does nothing has glanced off), and throws
    // up dirt beside anything else. A lobbed round bursts: on its hex, or wide of it. Small arms have kicked up the
    // ground where each round landed, as they flew.
    if (shot.style === 'gun') this.fx.arrive(shot.armour ? 'hit' : 'dirt', shot.at, [shot.ux, shot.uy], a.to, delay);
    else if (shot.style === 'lob') this.fx.blast(a.result === 'none' ? shot.at : this.centre(a.to), a.to, delay, 0.8);
  }

  // ---- what the pieces tell ------------------------------------------------------------------------

  setUp(pieces: Pieces): void {
    this.pieces = pieces;
    // The counters are new ones: nothing of the old is followed. A fire mission due in this moment was a game being cleared away.
    this.movers.length = 0;
    for (const p of this.wisps) this.fx.wisp(p.n, false, [0, 0], -1);
    this.wisps.clear();
    this.due.length = 0;
    this.live.clear();
  }

  threats(pieces: Pieces, shots: readonly Shot[]): void {
    this.pieces = pieces;
    const now = new Set<string>();
    let nth = 0;
    for (const s of shots) {
      if (!s.live) continue;
      const key = `${s.from}>${s.to}`;
      now.add(key);
      // Fire that was already being drawn has been fired; and a game that answers for its shots (`fired`) fires them itself.
      if (this.live.has(key) || this.answered) continue;
      const firer = this.firer(pieces, s.from);
      const style = firer ? this.of(firer).fire : 'gun';
      const dials = this.tune[style === 'none' ? 'gun' : style];
      this.launch(s.from, s.to, firer, this.top(pieces, s.to), dials.delayS + nth++ * dials.staggerS, true);
    }
    this.live = now;
  }

  destroyed(pieces: Pieces, p: Piece): number {
    this.pieces = pieces;
    this.wisps.delete(p);
    this.fx.wisp(p.n, false, [0, 0], -1);
    this.fx.kill(this.of(p).kill, [p.pose.p[0], p.pose.p[1]], p.home.hex, 0);
    return this.fx.hold;
  }

  moved(pieces: Pieces, p: Piece, from: number): void {
    this.pieces = pieces;
    const dust = this.of(p).dust;
    if (dust === 'none' || !p.travel) return;
    const a = this.centre(from);
    const b = this.centre(p.home.hex);
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.6) return;
    const line = p.travel.line;
    const first = line[0] as [number, number];
    const second = (line[1] ?? first) as [number, number];
    const d = Math.hypot(second[0] - first[0], second[1] - first[1]);
    if (d > 1e-6) this.fx.exhaust([p.pose.p[0], p.pose.p[1]], [(second[0] - first[0]) / d, (second[1] - first[1]) / d], from, 0);
    for (const m of this.movers) {
      if (m.piece !== p) continue;
      m.run = 0;
      return;
    }
    this.movers.push({ piece: p, lastX: p.pose.p[0], lastY: p.pose.p[1], run: 0, share: dust === 'tracked' ? 1 : this.tune.dust.wheeled });
  }

  suppressed(pieces: Pieces, p: Piece): void {
    this.pieces = pieces;
    if (p.marks.suppressed && !p.off) this.wisps.add(p);
    else if (this.wisps.delete(p)) this.fx.wisp(p.n, false, [0, 0], -1);
  }

  markers(pieces: Pieces, markers: readonly MarkerSpec[]): void {
    this.pieces = pieces;
    this.markerScreens = markers.filter(m => m.kind === 'screen').map(m => m.hex);
    this.refreshScreens();
    // A fire mission whose marker has been taken up has arrived, unless smoke lies there now (its rounds were smoke).
    const incoming = new Set(markers.filter(m => m.kind === 'incoming').map(m => m.hex));
    for (const hex of this.incoming) {
      if (incoming.has(hex) || this.markerScreens.includes(hex)) continue;
      this.due.push({ hex, at: this.fx.now + this.tune.mission.delayS });
    }
    this.incoming = incoming;
  }

  /** Tell the effects which hexes smoke lies on: the markers' and the demonstration's. */
  refreshScreens(): void {
    const hexes = [...new Set([...this.markerScreens, ...this.extraScreens])];
    this.fx.screens(hexes.map(hex => ({ hex, at: this.centre(hex) })));
  }

  /** Each pass of the page's loop, before the effects' clock moves: what follows a counter is brought to it. */
  step(): void {
    const fx = this.fx;
    for (let i = this.due.length - 1; i >= 0; i--) {
      const d = this.due[i] as { hex: number; at: number };
      if (d.at > fx.now) continue;
      this.due.splice(i, 1);
      fx.mission(d.hex, this.centre(d.hex), 0);
    }
    // Dust behind a vehicle on its way: a puff for every so much of the way it has come.
    const every = this.tune.dust.every;
    for (let i = this.movers.length - 1; i >= 0; i--) {
      const m = this.movers[i] as Mover;
      const p = m.piece;
      if (p.state !== 'moving' || !p.travel || p.travel.kind !== 'order' || p.off) {
        this.movers.splice(i, 1);
        continue;
      }
      const x = p.pose.p[0];
      const y = p.pose.p[1];
      const d = Math.hypot(x - m.lastX, y - m.lastY);
      if (d < 1e-4) continue;
      m.run += d;
      if (m.run >= every) {
        m.run = 0;
        const ux = (x - m.lastX) / d;
        const uy = (y - m.lastY) / d;
        fx.dust([x - ux * 0.3, y - uy * 0.3], [ux, uy], p.home.hex, m.share, 0);
      }
      m.lastX = x;
      m.lastY = y;
    }
    for (const p of this.wisps) {
      if (p.off || !p.marks.suppressed) {
        this.wisps.delete(p);
        fx.wisp(p.n, false, [0, 0], -1);
      } else fx.wisp(p.n, true, [p.pose.p[0], p.pose.p[1]], p.home.hex);
    }
  }

  /** Whether anything here still needs the page's loop (a counter being followed; a mission due). */
  get busy(): boolean {
    return this.due.length > 0 || this.movers.length > 0;
  }
}
