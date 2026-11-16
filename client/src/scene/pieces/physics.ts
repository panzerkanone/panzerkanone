/**
 * The physics world the pieces borrow (PLAN 7.5): Rapier, at real scale (h is
 * 20 mm, so gravity is 490.5 h/s²), stepped at a fixed 1/120 s. It knows
 * nothing of hexes, homes or the game: it holds the table top, the three
 * mounted boards and one body a counter, and it is told which counters are held
 * where (at home), which are free, and which have left it (travelling).
 *
 * Everything that stands still (table, boards, counters at home, loose
 * counters that have come to rest) is a kinematic body that is never moved, not
 * a fixed one: in Rapier 0.21 a contact with a fixed body keeps the solver's
 * default softness whatever `contact_natural_frequency` is set to, and at this
 * scale that softness lets a counter sink 0.006 h into the board for every
 * counter resting on it.
 *
 * And nothing here calls a body's `sleep()`: a body put to sleep by hand on a
 * kinematic one drops through it when it wakes. Rest is the caller's to give:
 * when every free body has been still for a moment (`settled`), the caller
 * holds each where it lies, and frees it again when something comes near.
 *
 * The module is handed in (`Rapier`), so this file imports no code: the page
 * loads the engine on the first physical gesture and never before.
 * No browser; it runs in Node for the tests.
 */
import { COUNTER, FEEL, GRAVITY, PHYS, STEP_S } from './dims';
import { quatMul, quatOfAxis, quatConj, rotate } from './pose';
import type { Pose, Quat, Vec3 } from './pose';

export type Rapier = typeof import('@dimforge/rapier3d-compat');
type World = InstanceType<Rapier['World']>;
type RigidBody = InstanceType<Rapier['RigidBody']>;
type Collider = InstanceType<Rapier['Collider']>;

/** x0, y0, x1, y1. */
type Rect = readonly [number, number, number, number];

/** What the counters lie on. */
export interface Ground {
  /** The boards, each a rounded slab whose top is z = 0. */
  slabs: readonly Rect[];
  cornerRadius: number;
  thickness: number;
  /** The table top. */
  table: { rect: Rect; z: number };
}

/**
 * A thing that stands on the table and never moves (the counter tray): boxes in its own frame,
 * set down at a place and turned about the vertical. Each box has its middle, half its size along
 * x, y and z, and its friction.
 */
export interface Fixture {
  at: readonly [number, number, number];
  yaw: number;
  boxes: readonly { centre: readonly [number, number, number]; half: readonly [number, number, number]; friction: number }[];
}

/** A seeded number in [0, 1): the same hash as the scene's (hash.ts), kept here so this file stands alone. */
export function hashUnit(seed: number, tag: number, id: number): number {
  let h = 2166136261 ^ seed;
  h = Math.imul(h ^ tag, 16777619);
  h ^= id + 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

interface Script {
  from: Vec3;
  to: Vec3;
  steps: number;
  done: number;
  /** What happens when it has run: the finger lifts, or the hand lets go. */
  then: 'up' | 'release' | 'hold';
}

interface Carried {
  i: number;
  /** Where its centre is kept, from the hand. */
  off: Vec3;
  /** How it lay when taken. */
  q0: Quat;
}

export class Sim {
  readonly world: World;
  /** Fixed steps taken since the world was made. */
  steps = 0;
  /** Milliseconds the last step took, and the mean of the last 120. */
  lastStepMs = 0;
  meanStepMs = 0;
  private readonly R: Rapier;
  private bodies: RigidBody[] = [];
  private colliders: Collider[] = [];
  /** 0 held (kinematic, at rest), 1 free (dynamic), 2 out (disabled). */
  private kind: Uint8Array = new Uint8Array(0);
  private readonly fingerBody: RigidBody;
  /** The thing standing on the table (the tray), if there is one. */
  private fixture: RigidBody | null = null;
  private fingerOn = false;
  /** The height the fingertip is held at (its middle), or null when it rests on whatever is under it. */
  private fingerHeld: number | null = null;
  private fingerTarget: [number, number] = [0, 0];
  private fingerScript: Script | null = null;
  private carried: Carried[] = [];
  private hand: Vec3 = [0, 0, 0];
  private handScript: Script | null = null;
  private stillFor = 0;
  private bumps = 0;
  private pokes = 0;
  private readonly counterMass: number;

  constructor(R: Rapier, ground: Ground) {
    this.R = R;
    const world = new R.World({ x: 0, y: 0, z: -GRAVITY });
    world.timestep = STEP_S;
    world.numSolverIterations = PHYS.solverIterations;
    world.integrationParameters.contact_natural_frequency = PHYS.contactHz;
    this.world = world;

    // The table top: a thick slab whose top face is the table.
    const t = ground.table.rect;
    const depth = 2;
    const table = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation((t[0] + t[2]) / 2, (t[1] + t[3]) / 2, ground.table.z - depth));
    world.createCollider(R.ColliderDesc.cuboid((t[2] - t[0]) / 2, (t[3] - t[1]) / 2, depth).setFriction(PHYS.frictionTable).setRestitution(PHYS.restitution), table);

    // Each board, a rounded slab whose top is z = 0: two boxes that cross and a cylinder at each
    // corner, which together are exactly its rounded rectangle carried down by its thickness. (One
    // convex hull would be simpler, but in this build of the engine a counter falls straight through one.)
    const upright = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
    for (const s of ground.slabs) {
      const cx = (s[0] + s[2]) / 2;
      const cy = (s[1] + s[3]) / 2;
      const hx = (s[2] - s[0]) / 2;
      const hy = (s[3] - s[1]) / 2;
      const r = Math.min(ground.cornerRadius, hx, hy);
      const hz = ground.thickness / 2;
      const board = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(cx, cy, -hz));
      const lay = (desc: InstanceType<Rapier['ColliderDesc']>): void => {
        world.createCollider(desc.setFriction(PHYS.frictionBoard).setRestitution(PHYS.restitution), board);
      };
      lay(R.ColliderDesc.cuboid(hx, hy - r, hz));
      lay(R.ColliderDesc.cuboid(hx - r, hy, hz));
      for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const) lay(R.ColliderDesc.cylinder(hz, r).setRotation(upright).setTranslation(sx * (hx - r), sy * (hy - r), 0));
    }

    this.counterMass = COUNTER.side * COUNTER.side * COUNTER.thickness;
    // The finger: a flat pad that does not turn, kept out of the world until it is wanted.
    const finger = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0, 0, 50).setGravityScale(FEEL.fingerPress).lockRotations().setCcdEnabled(true).setCanSleep(false));
    const fr = FEEL.fingerRound;
    world.createCollider(
      R.ColliderDesc.roundCylinder(FEEL.fingerHalfHeight - fr, FEEL.fingerRadius - fr, fr)
        .setRotation(upright)
        .setMass(FEEL.fingerMass * this.counterMass)
        .setFriction(FEEL.fingerFriction)
        .setFrictionCombineRule(R.CoefficientCombineRule.Max)
        .setRestitution(0),
      finger,
    );
    finger.setEnabled(false);
    this.fingerBody = finger;
  }

  /**
   * Stand a thing on the table, or take it away (null): static boxes that counters lie in and
   * against. Like the table and the boards it is a kinematic body that is never moved (see the head
   * of this file: a fixed one is soft).
   */
  setFixture(f: Fixture | null): void {
    const R = this.R;
    if (this.fixture) this.world.removeRigidBody(this.fixture);
    this.fixture = null;
    if (!f) return;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(f.at[0], f.at[1], f.at[2])
        .setRotation({ x: 0, y: 0, z: Math.sin(f.yaw / 2), w: Math.cos(f.yaw / 2) }),
    );
    for (const b of f.boxes) {
      this.world.createCollider(R.ColliderDesc.cuboid(b.half[0], b.half[1], b.half[2]).setTranslation(b.centre[0], b.centre[1], b.centre[2]).setFriction(b.friction).setRestitution(PHYS.restitution), body);
    }
    this.fixture = body;
    this.wakeAll();
  }

  /** How many boxes the thing standing on the table is made of (0: nothing stands there). */
  get fixtureBoxes(): number {
    return this.fixture ? this.fixture.numColliders() : 0;
  }

  // ---- the counters ----------------------------------------------------------------------------

  /** Replace every counter: each is held at its pose, or out of the world. */
  setCounters(poses: readonly Pose[], out: readonly boolean[]): void {
    const R = this.R;
    for (const b of this.bodies) this.world.removeRigidBody(b);
    this.bodies = [];
    this.colliders = [];
    this.kind = new Uint8Array(poses.length);
    this.carried = [];
    this.handScript = null;
    const br = PHYS.colliderRound;
    poses.forEach((pose, i) => {
      const body = this.world.createRigidBody(
        R.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(pose.p[0], pose.p[1], pose.p[2])
          .setRotation({ x: pose.q[0], y: pose.q[1], z: pose.q[2], w: pose.q[3] })
          .setLinearDamping(PHYS.linearDamping)
          .setAngularDamping(PHYS.angularDamping)
          .setCcdEnabled(true),
      );
      const collider = this.world.createCollider(
        R.ColliderDesc.roundCuboid(COUNTER.side / 2 - br, COUNTER.side / 2 - br, COUNTER.thickness / 2 - br, br).setDensity(1).setFriction(PHYS.frictionCounter).setRestitution(PHYS.restitution),
        body,
      );
      this.bodies.push(body);
      this.colliders.push(collider);
      if (out[i]) {
        body.setEnabled(false);
        this.kind[i] = 2;
      }
    });
  }

  get count(): number {
    return this.bodies.length;
  }

  private body(i: number): RigidBody {
    const b = this.bodies[i];
    if (!b) throw new Error(`no body ${i}`);
    return b;
  }

  /** Hold a counter at a pose: it stands still whatever meets it. */
  hold(i: number, pose: Pose): void {
    const b = this.body(i);
    if (this.kind[i] === 1) {
      b.setLinvel({ x: 0, y: 0, z: 0 }, false);
      b.setAngvel({ x: 0, y: 0, z: 0 }, false);
      b.setGravityScale(1, false);
    }
    this.dropFromHand(i);
    if (!b.isEnabled()) b.setEnabled(true);
    if (this.kind[i] !== 0) b.setBodyType(this.R.RigidBodyType.KinematicPositionBased, false);
    b.setTranslation({ x: pose.p[0], y: pose.p[1], z: pose.p[2] }, false);
    b.setRotation({ x: pose.q[0], y: pose.q[1], z: pose.q[2], w: pose.q[3] }, false);
    this.kind[i] = 0;
  }

  /** Let a held counter go: from here on it is a free body. */
  free(i: number): void {
    if (this.kind[i] === 1) return;
    const b = this.body(i);
    if (!b.isEnabled()) b.setEnabled(true);
    b.setBodyType(this.R.RigidBodyType.Dynamic, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.kind[i] = 1;
    this.stillFor = 0;
  }

  /** Take a counter out of the world (it is travelling, or gone). */
  takeOut(i: number): void {
    if (this.kind[i] === 2) return;
    this.dropFromHand(i);
    const b = this.body(i);
    if (this.kind[i] === 1) {
      b.setLinvel({ x: 0, y: 0, z: 0 }, false);
      b.setAngvel({ x: 0, y: 0, z: 0 }, false);
      b.setGravityScale(1, false);
    }
    b.setEnabled(false);
    this.kind[i] = 2;
  }

  isFree(i: number): boolean {
    return this.kind[i] === 1;
  }

  isAsleep(i: number): boolean {
    return this.kind[i] !== 1 || this.body(i).isSleeping();
  }

  /** Where a counter is. */
  read(i: number, into: Pose): void {
    const b = this.body(i);
    const t = b.translation();
    const r = b.rotation();
    into.p[0] = t.x;
    into.p[1] = t.y;
    into.p[2] = t.z;
    into.q[0] = r.x;
    into.q[1] = r.y;
    into.q[2] = r.z;
    into.q[3] = r.w;
  }

  /** How fast a counter is moving, h/s. */
  speed(i: number): number {
    if (this.kind[i] !== 1) return 0;
    const v = this.body(i).linvel();
    return Math.hypot(v.x, v.y, v.z);
  }

  /** Free bodies that are awake. */
  awake(): number {
    let n = 0;
    for (let i = 0; i < this.bodies.length; i++) if (this.kind[i] === 1 && !(this.bodies[i] as RigidBody).isSleeping()) n++;
    return n;
  }

  /** Free bodies, awake or not. */
  freeCount(): number {
    let n = 0;
    for (let i = 0; i < this.kind.length; i++) if (this.kind[i] === 1) n++;
    return n;
  }

  /** Wake every free body (something they may rest on has moved). */
  wakeAll(): void {
    for (let i = 0; i < this.bodies.length; i++) if (this.kind[i] === 1) (this.bodies[i] as RigidBody).wakeUp();
    this.stillFor = 0;
  }

  /** Whether anything is being done to the world by a hand. */
  get handled(): boolean {
    return this.fingerOn || this.carried.length > 0;
  }

  /** Whether the world needs stepping: a hand at work, or a free body in it. */
  get busy(): boolean {
    return this.handled || this.freeCount() > 0;
  }

  /** No hand is at work and every free body has been still for a moment (or is asleep): the caller may hold them where they lie. */
  get settled(): boolean {
    return !this.handled && this.freeCount() > 0 && (this.stillFor >= PHYS.sleepAfterS || this.awake() === 0);
  }

  // ---- the finger (push) -------------------------------------------------------------------------

  /**
   * Put the fingertip down over (x, y), its underside at `surfaceZ`. It then
   * rests on whatever is under it, pressed down; or, `held`, it keeps that
   * height whatever is under it (a fingertip set against a counter's side).
   */
  fingerDown(x: number, y: number, surfaceZ: number, held = false): void {
    const f = this.fingerBody;
    const z = surfaceZ + FEEL.fingerHalfHeight + 0.003;
    f.setEnabled(true);
    f.setTranslation({ x, y, z }, true);
    f.setLinvel({ x: 0, y: 0, z: 0 }, true);
    f.setGravityScale(held ? 0 : FEEL.fingerPress, true);
    this.fingerHeld = held ? z : null;
    this.fingerOn = true;
    this.fingerTarget = [x, y];
    this.fingerScript = null;
    this.stillFor = 0;
  }

  /** Where the fingertip is to go on the plan. */
  fingerTo(x: number, y: number): void {
    this.fingerTarget = [x, y];
  }

  fingerUp(): void {
    if (!this.fingerOn) return;
    this.fingerOn = false;
    this.fingerScript = null;
    this.fingerBody.setEnabled(false);
  }

  /** Where the fingertip is, or null when it is up. */
  fingerAt(): Vec3 | null {
    if (!this.fingerOn) return null;
    const t = this.fingerBody.translation();
    return [t.x, t.y, t.z];
  }

  /** A scripted push: the fingertip goes down at `from`, travels to `to` in `seconds` of the world's own time, and lifts. */
  scriptPush(from: readonly [number, number], to: readonly [number, number], seconds: number, surfaceZ: number, held = false): void {
    this.fingerDown(from[0], from[1], surfaceZ, held);
    this.fingerScript = { from: [from[0], from[1], 0], to: [to[0], to[1], 0], steps: Math.max(1, Math.round(seconds / STEP_S)), done: 0, then: 'up' };
  }

  private stepFinger(): void {
    if (!this.fingerOn) return;
    const s = this.fingerScript;
    if (s) {
      s.done++;
      const k = Math.min(1, s.done / s.steps);
      this.fingerTarget = [s.from[0] + (s.to[0] - s.from[0]) * k, s.from[1] + (s.to[1] - s.from[1]) * k];
    }
    const f = this.fingerBody;
    const p = f.translation();
    const v = f.linvel();
    let wx = (this.fingerTarget[0] - p.x) / FEEL.fingerTau;
    let wy = (this.fingerTarget[1] - p.y) / FEEL.fingerTau;
    const w = Math.hypot(wx, wy);
    if (w > FEEL.fingerMaxSpeed) {
      wx *= FEEL.fingerMaxSpeed / w;
      wy *= FEEL.fingerMaxSpeed / w;
    }
    // Along the board it goes where it is sent, as firmly as its weight allows. Up and down it is
    // left to gravity and to what it lies on, and never thrown upward; or it keeps the height it is held at.
    const vz = this.fingerHeld === null ? Math.min(v.z, 4) : Math.max(-20, Math.min(20, (this.fingerHeld - p.z) / FEEL.fingerTau));
    f.setLinvel({ x: v.x + (wx - v.x) * 0.7, y: v.y + (wy - v.y) * 0.7, z: vz }, true);
  }

  // ---- the poke, the bump --------------------------------------------------------------------------

  /**
   * Poke a free counter at a point of it: it hops, and skids away from that
   * side of it; a poke at its middle is all hop. Returns the direction it was sent.
   */
  poke(i: number, at: readonly [number, number, number]): [number, number] {
    const b = this.body(i);
    const c = b.translation();
    let dx = c.x - at[0];
    let dy = c.y - at[1];
    const off = Math.min(1, Math.hypot(dx, dy) / (COUNTER.side / 2));
    const n = Math.hypot(dx, dy);
    if (n > 1e-6) {
      dx /= n;
      dy /= n;
    } else {
      dx = 0;
      dy = 0;
    }
    const speed = FEEL.pokeSpeedCentre + (FEEL.pokeSpeedRim - FEEL.pokeSpeedCentre) * off * off;
    const turn = hashUnit(77, this.pokes++, i) < 0.5 ? -1 : 1;
    const v = b.linvel();
    const w = b.angvel();
    b.setLinvel({ x: v.x + dx * speed * (n > 1e-6 ? 1 : 0), y: v.y + dy * speed * (n > 1e-6 ? 1 : 0), z: v.z + FEEL.pokeHop * (1.15 - 0.4 * off) }, true);
    // A touch of spin, and the struck side dips: the far edge comes up a hair as it leaves.
    b.setAngvel({ x: w.x + dy * 2.5 * off, y: w.y - dx * 2.5 * off, z: w.z + turn * FEEL.pokeSpin * (0.3 + 0.7 * off) }, true);
    this.stillFor = 0;
    return [dx, dy];
  }

  /** The table is bumped: every free counter jumps a hair, each a little differently. */
  bump(): void {
    const n = this.bumps++;
    for (let i = 0; i < this.bodies.length; i++) {
      if (this.kind[i] !== 1) continue;
      const b = this.bodies[i] as RigidBody;
      const h = (k: number): number => hashUnit(1009 + n, k, i);
      const v = b.linvel();
      const w = b.angvel();
      b.setLinvel(
        { x: v.x + (h(1) - 0.5) * 2 * FEEL.bumpDrift, y: v.y + (h(2) - 0.5) * 2 * FEEL.bumpDrift, z: v.z + FEEL.bumpSpeed * (1 + (h(3) - 0.5) * 2 * FEEL.bumpSpread) },
        true,
      );
      b.setAngvel({ x: w.x + (h(4) - 0.5) * 2 * FEEL.bumpSpin, y: w.y + (h(5) - 0.5) * 2 * FEEL.bumpSpin, z: w.z + (h(6) - 0.5) * 2 * FEEL.bumpSpin }, true);
    }
    this.stillFor = 0;
  }

  // ---- pick up and carry ---------------------------------------------------------------------------

  /** Take free counters in hand at a point: each keeps its place from the hand and its lie. */
  grab(indices: readonly number[], at: readonly [number, number, number]): void {
    this.release();
    this.hand = [at[0], at[1], at[2]];
    this.handScript = null;
    for (const i of indices) {
      const b = this.body(i);
      const t = b.translation();
      const r = b.rotation();
      b.setGravityScale(0, true);
      this.carried.push({ i, off: [t.x - at[0], t.y - at[1], t.z - at[2]], q0: [r.x, r.y, r.z, r.w] });
    }
    this.stillFor = 0;
  }

  /** Where the hand is to go. */
  handTo(x: number, y: number, z: number): void {
    this.hand = [x, y, z];
  }

  /** A scripted carry: the hand goes from where it is to `to` in `seconds` of the world's time; then it lets go, or holds. */
  scriptCarry(to: readonly [number, number, number], seconds: number, then: 'release' | 'hold'): void {
    if (this.carried.length === 0) return;
    this.handScript = { from: [this.hand[0], this.hand[1], this.hand[2]], to: [to[0], to[1], to[2]], steps: Math.max(1, Math.round(seconds / STEP_S)), done: 0, then };
  }

  /** Let go: what was carried keeps the speed it had. */
  release(): void {
    for (const c of this.carried) (this.bodies[c.i] as RigidBody).setGravityScale(1, true);
    this.carried = [];
    this.handScript = null;
  }

  get carrying(): readonly number[] {
    return this.carried.map(c => c.i);
  }

  private dropFromHand(i: number): void {
    const k = this.carried.findIndex(c => c.i === i);
    if (k >= 0) this.carried.splice(k, 1);
  }

  private stepHand(): void {
    if (this.carried.length === 0) return;
    const s = this.handScript;
    if (s) {
      s.done++;
      const k = Math.min(1, s.done / s.steps);
      // Eased in a script as a hand would: no start or stop at a step.
      const e = k * k * (3 - 2 * k);
      this.hand = [s.from[0] + (s.to[0] - s.from[0]) * e, s.from[1] + (s.to[1] - s.from[1]) * e, s.from[2] + (s.to[2] - s.from[2]) * e];
      if (s.done >= s.steps) {
        this.handScript = null;
        if (s.then === 'release') {
          this.release();
          return;
        }
      }
    }
    const om = FEEL.carryOmega;
    const zeta = FEEL.carryDamping;
    for (const c of this.carried) {
      const b = this.bodies[c.i] as RigidBody;
      const p = b.translation();
      const v = b.linvel();
      const ex = this.hand[0] + c.off[0] - p.x;
      const ey = this.hand[1] + c.off[1] - p.y;
      const ez = this.hand[2] + c.off[2] - p.z;
      // A spring to the hand, damped a little short of critical: it has weight and overshoots a hair.
      let vx = v.x + (om * om * ex - 2 * zeta * om * v.x) * STEP_S;
      let vy = v.y + (om * om * ey - 2 * zeta * om * v.y) * STEP_S;
      let vz = v.z + (om * om * ez - 2 * zeta * om * v.z) * STEP_S;
      const sp = Math.hypot(vx, vy, vz);
      if (sp > FEEL.carryMaxSpeed) {
        vx *= FEEL.carryMaxSpeed / sp;
        vy *= FEEL.carryMaxSpeed / sp;
        vz *= FEEL.carryMaxSpeed / sp;
      }
      b.setLinvel({ x: vx, y: vy, z: vz }, true);
      // It hangs from the hand: pulled along, it leans, its leading edge down, and swings back level.
      const pull = Math.hypot(ex, ey);
      const lean = Math.min(FEEL.carryLeanMax, FEEL.carryLeanPerH * pull);
      const want: Quat = pull > 1e-5 ? quatMul(quatOfAxis([-ey, ex, 0], lean), c.q0) : c.q0;
      const r = b.rotation();
      let d = quatMul(want, quatConj([r.x, r.y, r.z, r.w]));
      if (d[3] < 0) d = [-d[0], -d[1], -d[2], -d[3]];
      const sn = Math.hypot(d[0], d[1], d[2]);
      const ang = 2 * Math.atan2(sn, d[3]);
      const ax: Vec3 = sn > 1e-9 ? [(d[0] / sn) * ang, (d[1] / sn) * ang, (d[2] / sn) * ang] : [0, 0, 0];
      const w = b.angvel();
      const oa = om * 0.9;
      b.setAngvel(
        { x: w.x + (oa * oa * ax[0] - 2 * oa * w.x) * STEP_S, y: w.y + (oa * oa * ax[1] - 2 * oa * w.y) * STEP_S, z: w.z + (oa * oa * ax[2] - 2 * oa * w.z) * STEP_S },
        true,
      );
    }
  }

  /** Where the hand is, or null when it holds nothing. */
  handAt(): Vec3 | null {
    return this.carried.length > 0 ? [this.hand[0], this.hand[1], this.hand[2]] : null;
  }

  // ---- stepping ------------------------------------------------------------------------------------

  /** One fixed step. */
  step(): void {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    this.stepFinger();
    this.stepHand();
    this.world.step();
    this.steps++;
    if (this.fingerScript && this.fingerScript.done >= this.fingerScript.steps) this.fingerUp();
    // How long every waking body has been still: a heap that creeps a hair for ever never sleeps by
    // the engine's own rule, and the caller gives it rest by this one (`settled`).
    let still = true;
    for (let i = 0; i < this.bodies.length && still; i++) {
      if (this.kind[i] !== 1) continue;
      const b = this.bodies[i] as RigidBody;
      if (b.isSleeping()) continue;
      const v = b.linvel();
      const w = b.angvel();
      if (Math.hypot(v.x, v.y, v.z) > PHYS.stillLinear || Math.hypot(w.x, w.y, w.z) > PHYS.stillAngular) still = false;
    }
    this.stillFor = this.handled || !still ? 0 : this.stillFor + STEP_S;
    if (typeof performance !== 'undefined') {
      this.lastStepMs = performance.now() - t0;
      this.meanStepMs += (this.lastStepMs - this.meanStepMs) / Math.min(120, this.steps);
    }
  }

  /** The up direction of a counter's face: 1 lying face up. */
  faceUp(i: number): number {
    const r = this.body(i).rotation();
    return rotate([r.x, r.y, r.z, r.w], [0, 0, 1])[2];
  }
}
