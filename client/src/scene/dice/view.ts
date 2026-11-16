/**
 * The dice as three.js objects, in the board frame like everything else on
 * the table: one instanced mesh, a die an instance, drawn by shaders.ts. It
 * reads the dice (dice.ts) and changes nothing in them. Whoever keeps the
 * table's caster table (the pieces' view) hands each die its row there, and
 * the rows of the dice that may shadow it.
 */
import * as THREE from 'three';
import { linearOf } from '../world';
import { STOCKS } from '../pieces/faces';
import type { DieShown } from './dice';
import { INSET_LAYER } from './layer';
import { DIE_FRAGMENT, DIE_VERTEX } from './shaders';
import { DIE } from './throw';

type Uniform<T> = { value: T };

/** The look's dials for the dice. */
export const DIE_LOOK = {
  /**
   * The shape (shaders.ts): a face is flat out to this share of half a side, and curls over from there
   * with this power (higher is squarer). The well-rounded kind (PLAN V6): half of each face is edge.
   */
  flat: 0.46,
  power: 3.6,
  /** The pips: the pitch of their three-by-three grid and their radius, as shares of half a side. */
  pipPitch: 0.5,
  pipRadius: 0.155,
  /** Each stock's bakelite and its pips' ink, sRGB 0..255: the first side's butterscotch with near-black pips, the second's slate with ivory ones (the counters' stocks, as cast). */
  body: { first: [196, 150, 82], second: [70, 84, 94] } as Record<'first' | 'second', [number, number, number]>,
  pip: { first: STOCKS.first.ink, second: STOCKS.second.ink } as Record<'first' | 'second', readonly [number, number, number]>,
  /** Polished: its reflectance facing the eye, the sharpness of the key's highlight and of the window's, the lamp's strength in it. */
  finish: [0.045, 260, 30, 0.6] as [number, number, number, number],
  /** How much of the room the foot of a side loses by the felt; the felt's light back onto a side; how clouded the cast is. */
  foot: 0.45,
  back: 0.12,
  mottle: 0.1,
  /** Cuts of the mesh along each edge of a face. */
  segments: 22,
} as const;

/** The most dice drawn at once: a pair thrown and a pair being taken away, three each. */
export const DICE_DRAWN = 6;

/**
 * A die's surface: g(x) + g(y) + g(z) = 1 with g(t) = (max(|t| - flat, 0) / (1 - flat)) ^ power,
 * half its side 1 (scale it). Grid lines crowd toward the edges, where it curves.
 */
export function dieGeometry(flat: number, power: number, segs: number): { pos: number[]; nor: number[]; idx: number[] } {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const g = (t: number): number => Math.pow(Math.max(Math.abs(t) - flat, 0) / (1 - flat), power);
  const f = (x: number, y: number, z: number): number => g(x) + g(y) + g(z);
  const dg = (t: number): number => Math.sign(t) * Math.pow(Math.max(Math.abs(t) - flat, 0) / (1 - flat), power - 1);
  const clampFlat = (t: number): number => Math.max(-flat, Math.min(flat, t));
  const line = (i: number): number => {
    const t = (i / segs) * 2 - 1;
    return Math.sign(t) * (1 - Math.pow(1 - Math.abs(t), 1.7));
  };
  const faces: [number, number, number, number][] = [
    [0, 1, 2, 1],
    [0, 1, 2, -1],
    [1, 2, 0, 1],
    [1, 2, 0, -1],
    [2, 0, 1, 1],
    [2, 0, 1, -1],
  ];
  for (const [ax, ua, va, sgn] of faces) {
    const base = pos.length / 3;
    for (let j = 0; j <= segs; j++) {
      for (let i = 0; i <= segs; i++) {
        const p = [0, 0, 0];
        p[ax] = sgn;
        p[ua] = line(i);
        p[va] = line(j);
        const c = p.map(clampFlat) as [number, number, number];
        const d: [number, number, number] = [(p[0] as number) - c[0], (p[1] as number) - c[1], (p[2] as number) - c[2]];
        let lo = 0;
        let hi = 1;
        for (let it = 0; it < 40; it++) {
          const mid = (lo + hi) / 2;
          if (f(c[0] + d[0] * mid, c[1] + d[1] * mid, c[2] + d[2] * mid) < 1) lo = mid;
          else hi = mid;
        }
        const s = (lo + hi) / 2;
        const q = [c[0] + d[0] * s, c[1] + d[1] * s, c[2] + d[2] * s] as [number, number, number];
        pos.push(q[0], q[1], q[2]);
        const nx = dg(q[0]);
        const ny = dg(q[1]);
        const nz = dg(q[2]);
        const len = Math.hypot(nx, ny, nz) || 1;
        nor.push(nx / len, ny / len, nz / len);
      }
    }
    for (let j = 0; j < segs; j++) {
      for (let i = 0; i < segs; i++) {
        const a = base + j * (segs + 1) + i;
        const b = a + 1;
        const c = a + segs + 1;
        const d = c + 1;
        // Wound so that the outside is the front in the board frame as the page's camera draws it (its own mirror).
        if (sgn > 0) idx.push(a, d, b, a, c, d);
        else idx.push(a, b, d, a, d, c);
      }
    }
  }
  return { pos, nor, idx };
}

export class DiceView {
  readonly mesh: THREE.Mesh;
  readonly triangles: number;
  private readonly place: Float32Array;
  private readonly turn: Float32Array;
  private readonly look: Float32Array;
  private readonly feltZ: () => number;
  private readonly room: Uniform<THREE.Vector4>;

  /** `uniforms`: the scene's shared ones with the pieces' own (the caster table, the tray's place). */
  constructor(uniforms: Record<string, Uniform<unknown>>, feltZ: () => number) {
    const src = dieGeometry(DIE_LOOK.flat, DIE_LOOK.power, DIE_LOOK.segments);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(src.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(src.nor, 3));
    g.setIndex(src.idx);
    const attr = (name: string): Float32Array => {
      const a = new Float32Array(DICE_DRAWN * 4);
      const b = new THREE.InstancedBufferAttribute(a, 4);
      b.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, b);
      return a;
    };
    this.place = attr('aPlace');
    this.turn = attr('aTurn');
    this.look = attr('aLook');
    g.instanceCount = 0;
    this.triangles = src.idx.length / 3;
    const own: Record<string, Uniform<unknown>> = {
      uDie: { value: new THREE.Vector4(DIE_LOOK.flat, DIE_LOOK.power, DIE_LOOK.pipPitch, DIE_LOOK.pipRadius) },
      uDieBody: { value: [linearOf(DIE_LOOK.body.first), linearOf(DIE_LOOK.body.second)] },
      uDiePip: { value: [linearOf(DIE_LOOK.pip.first as [number, number, number]), linearOf(DIE_LOOK.pip.second as [number, number, number])] },
      uDieFinish: { value: new THREE.Vector4(...DIE_LOOK.finish) },
      uDieRoom: { value: new THREE.Vector4(0, DIE_LOOK.foot, DIE_LOOK.back, DIE_LOOK.mottle) },
    };
    this.feltZ = feltZ;
    this.room = own.uDieRoom as Uniform<THREE.Vector4>;
    // Its outside is the front (the faces are wound for the board frame as drawn); both sides would shade a die twice.
    const material = new THREE.ShaderMaterial({ uniforms: { ...uniforms, ...own } as Record<string, THREE.IUniform>, vertexShader: DIE_VERTEX, fragmentShader: DIE_FRAGMENT, side: THREE.FrontSide, toneMapped: false });
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
    // The inset's camera sees the dice and the tray, and nothing else.
    this.mesh.layers.enable(INSET_LAYER);
  }

  /**
   * Draw these dice: `row(i)` is die i's row in the caster table, `others(i)` the rows of the dice
   * that may shadow it (two at most).
   */
  sync(shown: readonly DieShown[], others: (i: number) => readonly number[]): void {
    const n = Math.min(DICE_DRAWN, shown.length);
    this.room.value.x = this.feltZ();
    for (let i = 0; i < n; i++) {
      const d = shown[i] as DieShown;
      const k = i * 4;
      this.place[k] = d.pose.p[0];
      this.place[k + 1] = d.pose.p[1];
      this.place[k + 2] = d.pose.p[2];
      this.place[k + 3] = (DIE.side / 2) * d.scale;
      this.turn[k] = d.pose.q[0];
      this.turn[k + 1] = d.pose.q[1];
      this.turn[k + 2] = d.pose.q[2];
      this.turn[k + 3] = d.pose.q[3];
      const o = others(i);
      this.look[k] = d.stock;
      this.look[k + 1] = o[0] ?? -1;
      this.look[k + 2] = o[1] ?? -1;
      this.look[k + 3] = ((i * 0.618034) % 1) + 0.05;
    }
    const g = this.mesh.geometry as THREE.InstancedBufferGeometry;
    g.instanceCount = n;
    this.mesh.visible = n > 0;
    for (const name of ['aPlace', 'aTurn', 'aLook']) (g.getAttribute(name) as THREE.InstancedBufferAttribute).needsUpdate = true;
  }
}
