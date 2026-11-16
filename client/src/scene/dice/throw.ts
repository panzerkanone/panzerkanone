/**
 * A throw of the dice into the tray's felt well, decided before it is seen.
 *
 * The game rolls the faces; the table only shows them. A throw is simulated
 * once, headless, in a small physics world of its own (the tray's floor, felt
 * and walls, as the counters' world has them, and the dice), from a launch
 * just above the well with a seeded spin and speed, and every fixed step is
 * recorded. The faces it happens to land on are read; then each die is turned
 * within its body by one of the 24 turns of a cube (relabelled), so that the
 * face that carries the rolled number is the one that lands up. The recording
 * is what is shown, so the tumble seen is that simulation by construction, and
 * the result can never be other than the game's. A turn of a cube is a turn
 * of a real die: opposite faces still sum to seven, and its handedness stays.
 *
 * A throw that ends badly (a die cocked against a wall or on the other die,
 * one that left the well, the two touching, or one too slow to settle) is
 * thrown again from the next variant of its seed. If none of them will do, the
 * dice are laid in the well showing their faces, with no tumble: never wrong.
 *
 * Lengths in h (20 mm), as the counters' physics; the board frame (x right,
 * y down the board, z up). The physics engine is handed in. No browser.
 */
import { GRAVITY, PHYS, STEP_S } from '../pieces/dims';
import { hashUnit } from '../pieces/physics';
import type { Rapier } from '../pieces/physics';
import { quatMul, quatNormalize, quatOfYaw, rotate } from '../pieces/pose';
import type { Pose, Quat, Vec3 } from '../pieces/pose';
import { trayBoxes, trayToBoard } from '../tray/layout';
import type { PlacedTray } from '../tray/layout';

/** A die: a well-rounded cube of bakelite, 12 mm a side (PLAN V6: the rounded kind, "they roll better"). */
export const DIE = {
  /** Its side, in h. */
  side: 0.6,
  /** The rounding of its collider's edges and corners (the drawn die is rounder still: view.ts). */
  colliderRound: 0.075,
  /**
   * Bakelite, and the felt and the stained wood as a die meets them (Rapier averages a pair): how it
   * grips, and how much of a bounce it keeps.
   */
  friction: 0.4,
  restitution: 0.55,
  feltFriction: 0.45,
  feltRestitution: 0.3,
  woodFriction: 0.3,
  woodRestitution: 0.55,
  /** Air: a hair of linear loss, a little more for spin. */
  linearDamping: 0.05,
  angularDamping: 0.2,
  density: 1.3,
} as const;

/** The dials of a throw. Every number here was set by throwing. */
export const THROW = {
  /** Solver passes a step: two small bodies, so it can afford more than the counters' world. */
  solverIterations: 8,
  /** The launch: how far in from the end of the well it is thrown from (the middle of a die), and how high above the felt (its middle), with a seeded spread. */
  fromEnd: 0.42,
  height: 1.1,
  heightSpread: 0.4,
  /** The two dice side by side across the well, this far apart (middles), and a seeded wander. */
  lane: 0.62,
  laneSpread: 0.16,
  /** Its speed along the well (h/s), down, and across; how fast it rolls forward, and its spin about each axis besides (rad/s). */
  along: 14,
  alongSpread: 10,
  down: 0,
  downSpread: 3,
  across: 2.4,
  roll: 40,
  rollSpread: 25,
  spin: 18,
  /** At rest: still under these speeds (h/s, rad/s) for this many steps. */
  stillLinear: 0.25,
  stillAngular: 0.5,
  stillSteps: 8,
  /** The longest a throw may run (s), and the longest one that is kept (the game reads the dice about 0.75 s after the throw). */
  maxS: 1.2,
  keepS: 0.56,
  /** At rest a die must lie this squarely (cosine of its tilt), on the felt (within this of its height there), clear of the other by this many sides. */
  flat: 0.9965,
  onFelt: 0.02,
  apart: 1.22,
  /** Variants of a seed tried before the dice are only laid down. */
  variants: 32,
} as const;

// ---- the faces of a die -------------------------------------------------------------------------

/**
 * The face of each number, as the die's own axis it faces along. The board frame is drawn as its own
 * mirror (x right, y toward the player, z up: tray/view.ts), so a die made left-handed here is seen
 * right-handed, as Western dice are: 1, 2 and 3 run counter-clockwise round the corner they share.
 * Opposite faces sum to seven.
 */
export const FACE_AXES: Readonly<Record<number, Vec3>> = {
  1: [0, 0, 1],
  6: [0, 0, -1],
  2: [0, 1, 0],
  5: [0, -1, 0],
  3: [1, 0, 0],
  4: [-1, 0, 0],
};

/** The number on the face whose axis this is (a unit axis of the die's own frame). */
export function faceOnAxis(axis: readonly [number, number, number]): number {
  let best = 1;
  let bestDot = -2;
  for (let f = 1; f <= 6; f++) {
    const a = FACE_AXES[f] as Vec3;
    const d = a[0] * axis[0] + a[1] * axis[1] + a[2] * axis[2];
    if (d > bestDot) {
      bestDot = d;
      best = f;
    }
  }
  return best;
}

/** The face that looks up for a die turned so (its mesh's turn in the board frame), and how squarely (1: flat). */
export function faceUp(q: Readonly<Quat>): { face: number; flat: number } {
  let face = 1;
  let flat = -2;
  for (let f = 1; f <= 6; f++) {
    const z = rotate(q, FACE_AXES[f] as Vec3)[2];
    if (z > flat) {
      flat = z;
      face = f;
    }
  }
  return { face, flat };
}

/** The 24 turns of a cube onto itself, as unit quaternions: every signed permutation of the axes with determinant 1. */
export const CUBE_TURNS: readonly Quat[] = (() => {
  const out: Quat[] = [];
  const perms = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ] as const;
  for (const p of perms) {
    for (let signs = 0; signs < 8; signs++) {
      const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let row = 0; row < 3; row++) m[row * 3 + (p[row] as number)] = (signs >> row) & 1 ? -1 : 1;
      const det = (m[0] as number) * ((m[4] as number) * (m[8] as number) - (m[5] as number) * (m[7] as number)) - (m[1] as number) * ((m[3] as number) * (m[8] as number) - (m[5] as number) * (m[6] as number)) + (m[2] as number) * ((m[3] as number) * (m[7] as number) - (m[4] as number) * (m[6] as number));
      if (det === 1) out.push(quatOfMatrix(m));
    }
  }
  return out;
})();

/** A rotation matrix (row-major 3 x 3) as a unit quaternion. */
function quatOfMatrix(m: readonly number[]): Quat {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m as [number, number, number, number, number, number, number, number, number];
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
  }
  return quatNormalize(q);
}

const near = (a: Vec3, b: Vec3): boolean => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(a[2] - b[2]) < 1e-6;

/**
 * The turn of a die within its body that puts `face` where the body's `up` axis is (an axis of the
 * body's own frame): one of the four such turns of a cube, chosen by `pick`.
 */
export function relabel(up: Vec3, face: number, pick: number): Quat {
  const axis = FACE_AXES[face];
  if (!axis) throw new Error(`a die has no face ${face}`);
  const fits = CUBE_TURNS.filter(t => near(rotate(t, axis), up));
  if (fits.length !== 4) throw new Error(`relabel: ${fits.length} turns put face ${face} up`);
  return fits[((pick % 4) + 4) % 4] as Quat;
}

// ---- the well -----------------------------------------------------------------------------------

/** The felt well as a throw sees it: its rectangle in the tray's frame, the height of its felt and of the rim in the board frame. */
export interface Well {
  tray: PlacedTray;
  rect: readonly [number, number, number, number];
  feltZ: number;
  rimZ: number;
}

export function wellOf(tray: PlacedTray): Well {
  const f = tray.layout.felt;
  return { tray, rect: f.rect, feltZ: tray.z + f.floor, rimZ: tray.rimZ };
}

/** A point of the well's own frame (the tray's) in the board frame. */
function inBoard(w: Well, x: number, y: number, z: number): Vec3 {
  const p = trayToBoard(w.tray, x, y, 0);
  return [p[0], p[1], z];
}

/** The well's middle on the felt, in the board frame. */
export function wellCentre(w: Well): Vec3 {
  return inBoard(w, (w.rect[0] + w.rect[2]) / 2, (w.rect[1] + w.rect[3]) / 2, w.feltZ);
}

// ---- a throw ------------------------------------------------------------------------------------

/** What a throw is made from: the game's seed, the roll's number, which variant of the two, how many dice, and which end of the well they come from (1 or -1 along the tray's depth). */
export interface ThrowKey {
  seed: number;
  serial: number;
  dice: number;
  from: 1 | -1;
}

/** A throw as it was simulated: every step's poses, and how it ended. */
export interface Recorded {
  variant: number;
  /** Steps recorded after the launch; `frames` holds `steps + 1` poses of each die (the launch first), 7 numbers each (x, y, z, then the turn). */
  steps: number;
  frames: Float32Array;
  dice: number;
  /** Each die's speed at the launch (h/s). */
  launchVelocity: Vec3[];
  /** For each die, the axis of its body's own frame that looks up at rest. */
  up: Vec3[];
  /** Whether it ended well (settled in time, flat on the felt, inside, apart), and if not, why. */
  ok: boolean;
  why: string;
  /** The step at which every die had come to rest (the recording runs a few steps past it). */
  restStep: number;
  /** Simulation time spent, ms (0 where no clock is to hand). */
  ms: number;
}

/** A unit quaternion from three numbers in [0, 1) (Shoemake's method): uniform over every turn. */
function uniformTurn(u1: number, u2: number, u3: number): Quat {
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  return [a * Math.sin(2 * Math.PI * u2), a * Math.cos(2 * Math.PI * u2), b * Math.sin(2 * Math.PI * u3), b * Math.cos(2 * Math.PI * u3)];
}

/** A seeded number in [0, 1) for a throw's variant, a die and a quantity. */
function draw(k: ThrowKey, variant: number, die: number, what: number): number {
  return hashUnit(k.seed, 0x7d1ce + variant * 131 + what, k.serial * 8 + die);
}

/** The launch of each die: where, how turned, how fast, how it spins (board frame). */
export function launchOf(w: Well, k: ThrowKey, variant: number): { pose: Pose; v: Vec3; w: Vec3 }[] {
  const r = w.rect;
  const cx = (r[0] + r[2]) / 2;
  const depth = r[3] - r[1];
  // Thrown from one end of the well along its depth (the tray's y), the dice side by side across it.
  const y0 = (r[1] + r[3]) / 2 - k.from * (depth / 2 - THROW.fromEnd);
  const out: { pose: Pose; v: Vec3; w: Vec3 }[] = [];
  for (let i = 0; i < k.dice; i++) {
    const h = (what: number): number => draw(k, variant, i, what);
    const lane = k.dice === 1 ? 0 : (i - (k.dice - 1) / 2) * THROW.lane;
    const lx = cx + lane + (h(1) - 0.5) * 2 * THROW.laneSpread;
    const ly = y0 + (h(2) - 0.5) * 0.2;
    const z = w.feltZ + THROW.height + h(3) * THROW.heightSpread;
    const along = k.from * (THROW.along + h(4) * THROW.alongSpread);
    const across = (h(5) - 0.5) * 2 * THROW.across - lane * 2;
    const down = -(THROW.down + h(6) * THROW.downSpread);
    // The tray's frame turned into the board's.
    const c = w.tray.cos;
    const s = w.tray.sin;
    const p = inBoard(w, lx, ly, z);
    const v: Vec3 = [c * across - s * along, s * across + c * along, down];
    // A die leaves the hand rolling forward (about the level axis square to its way), and a little every other way.
    const roll = k.from * (THROW.roll + h(13) * THROW.rollSpread);
    // (Rolling along v is a turn about up x v; along the tray's y that axis is minus the tray's x.)
    const spin: Vec3 = [-c * roll + (h(7) - 0.5) * 2 * THROW.spin, -s * roll + (h(8) - 0.5) * 2 * THROW.spin, (h(9) - 0.5) * 2 * THROW.spin];
    out.push({ pose: { p, q: uniformTurn(h(10), h(11), h(12)) }, v, w: spin });
  }
  return out;
}

/** Simulate one variant of a throw, headless, and record it. */
export function simulate(R: Rapier, w: Well, k: ThrowKey, variant: number): Recorded {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const world = new R.World({ x: 0, y: 0, z: -GRAVITY });
  world.timestep = STEP_S;
  world.numSolverIterations = THROW.solverIterations;
  world.integrationParameters.contact_natural_frequency = PHYS.contactHz;
  try {
    // The tray, as the counters' world has it (pieces/physics.ts `setFixture`): a kinematic body that never moves.
    const t = w.tray;
    const tray = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(t.centre[0], t.centre[1], t.z).setRotation({ x: 0, y: 0, z: Math.sin(t.yaw / 2), w: Math.cos(t.yaw / 2) }));
    for (const b of trayBoxes(t.layout)) {
      const felt = b.part === 'felt';
      world.createCollider(
        R.ColliderDesc.cuboid(b.half[0], b.half[1], b.half[2])
          .setTranslation(b.centre[0], b.centre[1], b.centre[2])
          .setFriction(felt ? DIE.feltFriction : DIE.woodFriction)
          .setRestitution(felt ? DIE.feltRestitution : DIE.woodRestitution),
        tray,
      );
    }
    const launch = launchOf(w, k, variant);
    const hr = DIE.side / 2 - DIE.colliderRound;
    const bodies = launch.map(l => {
      const b = world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(l.pose.p[0], l.pose.p[1], l.pose.p[2])
          .setRotation({ x: l.pose.q[0], y: l.pose.q[1], z: l.pose.q[2], w: l.pose.q[3] })
          .setLinvel(l.v[0], l.v[1], l.v[2])
          .setAngvel({ x: l.w[0], y: l.w[1], z: l.w[2] })
          .setLinearDamping(DIE.linearDamping)
          .setAngularDamping(DIE.angularDamping)
          .setCcdEnabled(true)
          .setCanSleep(false),
      );
      world.createCollider(R.ColliderDesc.roundCuboid(hr, hr, hr, DIE.colliderRound).setDensity(DIE.density).setFriction(DIE.friction).setRestitution(DIE.restitution), b);
      return b;
    });
    const n = launch.length;
    const max = Math.ceil(THROW.maxS / STEP_S);
    const frames = new Float32Array((max + 1) * n * 7);
    const put = (step: number): void => {
      for (let i = 0; i < n; i++) {
        const b = bodies[i] as (typeof bodies)[number];
        const p = b.translation();
        const q = b.rotation();
        const o = (step * n + i) * 7;
        frames[o] = p.x;
        frames[o + 1] = p.y;
        frames[o + 2] = p.z;
        frames[o + 3] = q.x;
        frames[o + 4] = q.y;
        frames[o + 5] = q.z;
        frames[o + 6] = q.w;
      }
    };
    put(0);
    let still = 0;
    let steps = 0;
    let restStep = -1;
    while (steps < max) {
      world.step();
      steps++;
      put(steps);
      let quiet = true;
      for (const b of bodies) {
        const v = b.linvel();
        const a = b.angvel();
        if (Math.hypot(v.x, v.y, v.z) > THROW.stillLinear || Math.hypot(a.x, a.y, a.z) > THROW.stillAngular) quiet = false;
      }
      still = quiet ? still + 1 : 0;
      if (still === 1) restStep = steps;
      if (still >= THROW.stillSteps) break;
      if (!quiet) restStep = -1;
    }
    const last = (i: number): Pose => {
      const o = (steps * n + i) * 7;
      return { p: [frames[o] as number, frames[o + 1] as number, frames[o + 2] as number], q: [frames[o + 3] as number, frames[o + 4] as number, frames[o + 5] as number, frames[o + 6] as number] };
    };
    const ups: Vec3[] = [];
    let why = '';
    const r = w.rect;
    for (let i = 0; i < n; i++) {
      const pose = last(i);
      // The body's own axis that looks up: the face of an unturned die on it.
      let best: Vec3 = [0, 0, 1];
      let flat = -2;
      for (const a of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as Vec3[]) {
        const z = rotate(pose.q, a)[2];
        if (z > flat) {
          flat = z;
          best = a;
        }
      }
      ups.push(best);
      const local = toLocal(w, pose.p);
      if (!why && flat < THROW.flat) why = `die ${i} is cocked (${flat.toFixed(4)})`;
      if (!why && Math.abs(pose.p[2] - (w.feltZ + DIE.side / 2)) > THROW.onFelt) why = `die ${i} is not on the felt (${(pose.p[2] - w.feltZ).toFixed(3)} above it)`;
      if (!why && (local[0] < r[0] || local[0] > r[2] || local[1] < r[1] || local[1] > r[3])) why = `die ${i} left the well`;
    }
    if (!why && n === 2) {
      const a = last(0).p;
      const b = last(1).p;
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < THROW.apart * DIE.side) why = 'the dice lie too close';
    }
    if (!why && still < THROW.stillSteps) why = 'not at rest in time';
    if (!why && restStep * STEP_S > THROW.keepS) why = `too slow (${(restStep * STEP_S).toFixed(2)} s)`;
    return {
      variant,
      steps,
      frames: frames.slice(0, (steps + 1) * n * 7),
      dice: n,
      launchVelocity: launch.map(l => l.v),
      up: ups,
      ok: why === '',
      why,
      restStep: Math.max(0, restStep),
      ms: typeof performance !== 'undefined' ? performance.now() - t0 : 0,
    };
  } finally {
    world.free();
  }
}

/** A point of the board frame in the well's (the tray's) own frame. */
function toLocal(w: Well, p: Vec3): [number, number] {
  const dx = p[0] - w.tray.centre[0];
  const dy = p[1] - w.tray.centre[1];
  return [w.tray.cos * dx + w.tray.sin * dy, w.tray.cos * dy - w.tray.sin * dx];
}

/** The first variant of a throw that ends well, or null when none of them does. `tried` counts the variants simulated. */
export function planThrow(R: Rapier, w: Well, k: ThrowKey): { rec: Recorded | null; tried: number; ms: number } {
  let ms = 0;
  for (let v = 0; v < THROW.variants; v++) {
    const rec = simulate(R, w, k, v);
    ms += rec.ms;
    if (rec.ok) return { rec, tried: v + 1, ms };
  }
  return { rec: null, tried: THROW.variants, ms };
}

/** A die's body pose at a step of a recording (between two steps at a fractional step). */
export function bodyAt(rec: Recorded, die: number, step: number, into: Pose): Pose {
  const s = Math.max(0, Math.min(rec.steps, step));
  const i0 = Math.floor(s);
  const i1 = Math.min(rec.steps, i0 + 1);
  const a = s - i0;
  const f = rec.frames;
  const o0 = (i0 * rec.dice + die) * 7;
  const o1 = (i1 * rec.dice + die) * 7;
  for (let k = 0; k < 3; k++) into.p[k] = (f[o0 + k] as number) + ((f[o1 + k] as number) - (f[o0 + k] as number)) * a;
  // A turn between two steps 1/120 s apart: a normalised blend is as good as a slerp.
  let d = 0;
  for (let k = 0; k < 4; k++) d += (f[o0 + 3 + k] as number) * (f[o1 + 3 + k] as number);
  const sg = d < 0 ? -1 : 1;
  let n = 0;
  for (let k = 0; k < 4; k++) {
    const v = (f[o0 + 3 + k] as number) * (1 - a) + (f[o1 + 3 + k] as number) * a * sg;
    into.q[k] = v;
    n += v * v;
  }
  n = Math.sqrt(n) || 1;
  for (let k = 0; k < 4; k++) into.q[k] = (into.q[k] as number) / n;
  return into;
}

/**
 * The turn of each die within its body for these faces (each die shows `faces[i]` at rest): one of
 * the four that do, chosen by the throw's seed.
 */
export function turnsFor(rec: Recorded, k: ThrowKey, faces: readonly number[]): Quat[] {
  return rec.up.map((up, i) => relabel(up, faces[i] as number, Math.floor(hashUnit(k.seed, 0x7e1ab, k.serial * 8 + i) * 4)));
}

/**
 * Dice laid in the well with no throw (no tumble, or a throw that would not end well): side by side
 * along the middle of the well, flat, each showing its face, turned a little about the vertical by
 * the seed. Each die's mesh pose in the board frame.
 */
export function laid(w: Well, k: ThrowKey, faces: readonly number[]): Pose[] {
  const r = w.rect;
  const cx = (r[0] + r[2]) / 2;
  const cy = (r[1] + r[3]) / 2;
  return faces.map((face, i) => {
    const h = (what: number): number => hashUnit(k.seed, 0x1a1d + what, k.serial * 8 + i);
    const lane = faces.length === 1 ? 0 : (i - (faces.length - 1) / 2) * DIE.side * 1.7;
    // Along the well's depth (the tray's y), its long way: the dice lie side by side as a hand would set them down.
    const p = inBoard(w, cx + (h(1) - 0.5) * 0.3, cy + lane + (h(2) - 0.5) * 0.12, w.feltZ + DIE.side / 2);
    const axis = FACE_AXES[face];
    if (!axis) throw new Error(`a die has no face ${face}`);
    const up = CUBE_TURNS.filter(t => near(rotate(t, axis), [0, 0, 1]));
    const base = up[Math.floor(h(3) * up.length)] as Quat;
    return { p, q: quatMul(quatOfYaw(w.tray.yaw + (h(4) - 0.5) * 0.9), base) };
  });
}
