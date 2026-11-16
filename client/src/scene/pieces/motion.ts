/**
 * How a counter travels when nothing physical is moving it: an ordered move, a
 * settle to a changed place in its stack, the way home, and the way off the
 * table. Each is a curve in time from where the counter is to an exact end
 * pose; nothing here steps a simulation, and nothing snaps. Plain arithmetic,
 * no browser.
 */
import { FEEL } from './dims';
import { clonePose, easeCubic, easeInOut, lerp, quatMul, quatOfAxis, slerp, smoothstep } from './pose';
import type { Pose, Quat, Vec3 } from './pose';

export type TravelKind = 'order' | 'settle' | 'home' | 'destroyed' | 'withdrawn' | 'arrive' | 'tray';

export interface Travel {
  kind: TravelKind;
  from: Pose;
  to: Pose;
  /** The line on the plan it follows: from, any waypoints, to; with the length run at each point. */
  line: [number, number][];
  run: number[];
  lift: number;
  /** Seconds it waits before starting, and takes. */
  delay: number;
  dur: number;
  /** Seconds since it was started (it moves once this passes `delay`). */
  t: number;
  /** For a counter flicked off: the way it flies on the plan. */
  away: [number, number];
  /** For a carry to or from the tray: the height its middle is carried at. */
  over?: number;
}

/**
 * A path's line, its corners rounded and never cut square: straight to the
 * middle of each leg, and round each waypoint on an even curve from the middle
 * of one leg to the middle of the next (so it passes a little inside each
 * corner: an eighth of a hex where a path of hexes turns by one hexside).
 * `per` is how many points are put on the curve round each corner.
 */
export function smoothLine(points: readonly (readonly [number, number])[], per = 20): [number, number][] {
  if (points.length <= 2) return points.map(p => [p[0], p[1]] as [number, number]);
  const at = (i: number): readonly [number, number] => points[i] as readonly [number, number];
  const mid = (a: readonly [number, number], b: readonly [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const first = at(0);
  const out: [number, number][] = [[first[0], first[1]]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = mid(at(i - 1), at(i));
    const c = at(i);
    const b = mid(at(i), at(i + 1));
    for (let k = 0; k <= per; k++) {
      const u = k / per;
      const w0 = (1 - u) * (1 - u);
      const w1 = 2 * u * (1 - u);
      const w2 = u * u;
      out.push([w0 * a[0] + w1 * c[0] + w2 * b[0], w0 * a[1] + w1 * c[1] + w2 * b[1]]);
    }
  }
  const last = at(points.length - 1);
  out.push([last[0], last[1]]);
  return out;
}

function runOf(line: readonly (readonly [number, number])[]): number[] {
  const run = [0];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1] as readonly [number, number];
    const b = line[i] as readonly [number, number];
    run.push((run[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return run;
}

/** The point a share s of the way along a line. */
function along(line: readonly (readonly [number, number])[], run: readonly number[], s: number): [number, number] {
  const total = run[run.length - 1] as number;
  const first = line[0] as readonly [number, number];
  if (total <= 1e-12 || s <= 0) return [first[0], first[1]];
  const last = line[line.length - 1] as readonly [number, number];
  if (s >= 1) return [last[0], last[1]];
  const want = s * total;
  let i = 1;
  while (i < run.length - 1 && (run[i] as number) < want) i++;
  const a = line[i - 1] as readonly [number, number];
  const b = line[i] as readonly [number, number];
  const span = (run[i] as number) - (run[i - 1] as number);
  const k = span > 1e-12 ? (want - (run[i - 1] as number)) / span : 0;
  return [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
}

/** An ordered move, from where the counter is to its new place; `via` are the waypoints of a path, if any. */
export function orderTravel(from: Pose, to: Pose, via: readonly (readonly [number, number])[], delay = 0): Travel {
  const line = smoothLine([[from.p[0], from.p[1]], ...via, [to.p[0], to.p[1]]]);
  const run = runOf(line);
  const length = run[run.length - 1] as number;
  // Time by the hexes passed: a path of many hexes is walked, not thrown.
  const dur = Math.min(FEEL.orderMaxS, FEEL.orderS + FEEL.orderPerHexS * Math.max(0, via.length > 0 ? length - 1 : 0));
  const lift = Math.min(FEEL.orderLiftMax, FEEL.orderLift + FEEL.orderLiftPerH * length);
  return { kind: 'order', from: clonePose(from), to: clonePose(to), line, run, lift, delay, dur, t: 0, away: [0, 0] };
}

/** A short settle to a changed place (a stack closing up, a counter turned). */
export function settleTravel(from: Pose, to: Pose, delay = 0): Travel {
  const line: [number, number][] = [[from.p[0], from.p[1]], [to.p[0], to.p[1]]];
  return { kind: 'settle', from: clonePose(from), to: clonePose(to), line, run: runOf(line), lift: 0, delay, dur: FEEL.settleS, t: 0, away: [0, 0] };
}

/** The way home of a loose counter: farther takes a little longer and lifts a little higher. */
export function homeTravel(from: Pose, to: Pose, delay = 0): Travel {
  const line: [number, number][] = [[from.p[0], from.p[1]], [to.p[0], to.p[1]]];
  const run = runOf(line);
  const d = Math.hypot(run[1] as number, to.p[2] - from.p[2]);
  const dur = Math.min(FEEL.homeMaxS, FEEL.homeS + FEEL.homePerHS * d);
  // A counter that has hardly moved hardly lifts: it is nudged square, not thrown in the air.
  const lift = Math.min(FEEL.homeLiftMax, FEEL.homeLift + FEEL.homeLiftPerH * d) * smoothstep(0, 0.5, d);
  return { kind: 'home', from: clonePose(from), to: clonePose(to), line, run, lift, delay, dur: d < 0.02 ? Math.min(dur, 0.16) : dur, t: 0, away: [0, 0] };
}

/** A counter put on the table: it comes down from above its place, growing from nothing. */
export function arriveTravel(to: Pose, delay = 0): Travel {
  const from: Pose = { p: [to.p[0], to.p[1], to.p[2] + 0.9], q: [to.q[0], to.q[1], to.q[2], to.q[3]] };
  const line: [number, number][] = [[from.p[0], from.p[1]], [to.p[0], to.p[1]]];
  return { kind: 'arrive', from, to: clonePose(to), line, run: runOf(line), lift: 0, delay, dur: 0.36, t: 0, away: [0, 0] };
}

/**
 * A carry into the tray, or out of it: up, across, down. Unlike an ordered move it does not come
 * down while it is still crossing: a well is hardly wider than a counter, so it is lifted clear of
 * the rim (`clearZ`: the height its underside must pass over) before it sets off, and is over its
 * place before it is let down. Farther takes a little longer.
 */
export function trayTravel(from: Pose, to: Pose, clearZ: number, thickness: number, delay = 0): Travel {
  const line: [number, number][] = [[from.p[0], from.p[1]], [to.p[0], to.p[1]]];
  const run = runOf(line);
  const dur = Math.min(FEEL.trayMaxS, FEEL.trayS + FEEL.trayPerHS * (run[1] as number));
  const over = Math.max(from.p[2], to.p[2], clearZ + thickness / 2) + FEEL.trayLift;
  return { kind: 'tray', from: clonePose(from), to: clonePose(to), line, run, lift: over - Math.max(from.p[2], to.p[2]), delay, dur, t: 0, away: [0, 0], over };
}

/** Off the table. `away` is the way a destroyed counter flies on the plan (a unit vector). */
export function removeTravel(from: Pose, how: 'destroyed' | 'withdrawn', away: readonly [number, number], delay = 0): Travel {
  const line: [number, number][] = [[from.p[0], from.p[1]], [from.p[0], from.p[1]]];
  return {
    kind: how,
    from: clonePose(from),
    to: clonePose(from),
    line,
    run: [0, 0],
    lift: 0,
    delay,
    dur: how === 'destroyed' ? FEEL.destroyedS : FEEL.withdrawnS,
    t: 0,
    away: [away[0], away[1]],
  };
}

export function travelDone(m: Travel): boolean {
  return m.t >= m.delay + m.dur;
}

/** When the travel ends, in seconds from its start. */
export function travelEnd(m: Travel): number {
  return m.delay + m.dur;
}

/**
 * Where a travelling counter is, and how large it is drawn (1, except on its
 * way on or off the table). At its end an order, a settle and a way home give
 * `to` exactly.
 */
export function travelAt(m: Travel): { pose: Pose; scale: number } {
  const u = Math.min(1, Math.max(0, (m.t - m.delay) / m.dur));
  if (m.kind === 'withdrawn') {
    // Plain: it lifts straight up and is gone.
    const up = 1 - (1 - u) * (1 - u);
    return { pose: { p: [m.from.p[0], m.from.p[1], m.from.p[2] + 0.55 * up], q: m.from.q }, scale: 1 - easeInOut(smoothstep(0.2, 1, u)) };
  }
  if (m.kind === 'destroyed') {
    // Flicked: a start at speed that dies away, a low arc, end over end, small and gone at the end.
    const go = 1 - Math.pow(1 - u, 2.2);
    const reach = 3.4;
    const x = m.from.p[0] + m.away[0] * reach * go;
    const y = m.from.p[1] + m.away[1] * reach * go;
    const z = m.from.p[2] + 1.1 * 4 * go * (1 - go) * (1 - 0.35 * go) + 0.25 * go;
    // It tumbles about the axis across its flight, and spins a little flat.
    const tumble: Quat = quatOfAxis([-m.away[1], m.away[0], 0], go * Math.PI * 3.5);
    const spin: Quat = quatOfAxis([0, 0, 1], go * 2.4);
    return { pose: { p: [x, y, z], q: quatMul(tumble, quatMul(spin, m.from.q)) }, scale: 1 - easeInOut(smoothstep(0.55, 1, u)) };
  }
  if (m.kind === 'arrive') {
    const s = easeCubic(u);
    return { pose: { p: [m.to.p[0], m.to.p[1], lerp(m.from.p[2], m.to.p[2], s)], q: m.to.q }, scale: u >= 1 ? 1 : easeInOut(smoothstep(0, 0.7, u)) };
  }
  if (u >= 1) return { pose: clonePose(m.to), scale: 1 };
  if (m.kind === 'tray') {
    // Up, across, down, each eased in and out (no speed at the lift, none at the touch).
    const top = m.over ?? Math.max(m.from.p[2], m.to.p[2]) + m.lift;
    const s = easeInOut((u - FEEL.trayGoFrom) / (FEEL.trayGoTo - FEEL.trayGoFrom));
    const xy = along(m.line, m.run, s);
    const z = u < 0.5 ? lerp(m.from.p[2], top, easeInOut(u / FEEL.trayRise)) : lerp(top, m.to.p[2], easeInOut((u - (1 - FEEL.trayFall)) / FEEL.trayFall));
    return { pose: { p: [xy[0], xy[1], z], q: slerp(m.from.q, m.to.q, s) }, scale: 1 };
  }
  // Eased in and out. The way home leaves a little sooner than it arrives: a counter answers the
  // key at once, and takes its time setting down.
  const s = m.kind === 'home' ? 0.35 * (1 - Math.pow(1 - u, 3)) + 0.65 * easeInOut(u) : easeCubic(u);
  const xy = along(m.line, m.run, s);
  // The lift: up early, carried, set down gently (no speed left at the touch).
  const rise = m.kind === 'home' ? 0.3 : Math.min(0.4, 0.13 / m.dur);
  const fall = m.kind === 'home' ? 0.5 : Math.min(0.55, 0.2 / m.dur);
  const arc = smoothstep(0, rise, u) * (1 - smoothstep(1 - fall, 1, u));
  const p: Vec3 = [xy[0], xy[1], lerp(m.from.p[2], m.to.p[2], s) + m.lift * arc];
  return { pose: { p, q: slerp(m.from.q, m.to.q, s) }, scale: 1 };
}
