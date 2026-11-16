/**
 * Where a counter is: the position of its centre in the board frame (x right,
 * y down the board, z up, in h) and its turn as a unit quaternion (x, y, z, w).
 * Plain arithmetic, no browser.
 */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export interface Pose {
  p: Vec3;
  q: Quat;
}

export const IDENTITY: Quat = [0, 0, 0, 1];

export function clonePose(a: Pose): Pose {
  return { p: [a.p[0], a.p[1], a.p[2]], q: [a.q[0], a.q[1], a.q[2], a.q[3]] };
}

/** A turn about the z axis (flat on the table), in radians. */
export function quatOfYaw(yaw: number): Quat {
  return [0, 0, Math.sin(yaw / 2), Math.cos(yaw / 2)];
}

/** A turn about any axis (need not be a unit vector). */
export function quatOfAxis(axis: readonly [number, number, number], angle: number): Quat {
  const n = Math.hypot(axis[0], axis[1], axis[2]);
  if (n < 1e-12) return [0, 0, 0, 1];
  const s = Math.sin(angle / 2) / n;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

/** The product a * b: the turn that applies b first, then a. */
export function quatMul(a: Readonly<Quat>, b: Readonly<Quat>): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function quatConj(a: Readonly<Quat>): Quat {
  return [-a[0], -a[1], -a[2], a[3]];
}

export function quatNormalize(a: Readonly<Quat>): Quat {
  const n = Math.hypot(a[0], a[1], a[2], a[3]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n, a[3] / n];
}

/** A vector turned by a quaternion. */
export function rotate(q: Readonly<Quat>, v: readonly [number, number, number]): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/** The shortest turn from a to b, a share t of the way (0 gives a, 1 gives b exactly). */
export function slerp(a: Readonly<Quat>, b: Readonly<Quat>, t: number): Quat {
  if (t <= 0) return [a[0], a[1], a[2], a[3]];
  if (t >= 1) return [b[0], b[1], b[2], b[3]];
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = d < 0 ? -1 : 1;
  d = Math.abs(d);
  let ka = 1 - t;
  let kb = t;
  if (d < 0.9995) {
    const th = Math.acos(d);
    const sn = Math.sin(th);
    ka = Math.sin((1 - t) * th) / sn;
    kb = Math.sin(t * th) / sn;
  }
  return quatNormalize([a[0] * ka + b[0] * kb * s, a[1] * ka + b[1] * kb * s, a[2] * ka + b[2] * kb * s, a[3] * ka + b[3] * kb * s]);
}

/** The angle between two turns, in radians (0 to pi). */
export function angleBetween(a: Readonly<Quat>, b: Readonly<Quat>): number {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, d));
}

/** The turn about z of a counter's own x axis as seen from above, in radians. */
export function yawOf(q: Readonly<Quat>): number {
  const ex = rotate(q, [1, 0, 0]);
  return Math.atan2(ex[1], ex[0]);
}

/** The z of a counter's face normal: 1 lying face up, -1 face down. */
export function upOf(q: Readonly<Quat>): number {
  return rotate(q, [0, 0, 1])[2];
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Ease in and out: no speed at either end, and none of acceleration either. */
export function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** A gentler ease in and out (cubic): a little speed is kept nearer the ends. */
export function easeCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
