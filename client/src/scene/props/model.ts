/**
 * The things on the table as one low-polygon mesh (one draw call) and their soft shadows on the table as
 * another: built in code from the placings (place.ts), in the board frame, with no pictures at all. Every
 * surface's look is a few numbers a vertex: its colour, which printed or natural surface it is (the
 * shader draws the pattern), how glossy, how metallic and how sharp its reflections are.
 */
import * as THREE from 'three';
import { hash01 } from '../hash';
import { PROP_SIZE } from './place';
import type { PlacedProp } from './place';

/** The surfaces the shader knows (shaders.ts, `kind`). */
export const SURFACE = { plain: 0, label: 1, metal: 2, card: 3, page: 4, stack: 5, cork: 6, glaze: 7, coffee: 8, sheet: 9 } as const;

type V3 = [number, number, number];
type RGB = [number, number, number];

/** sRGB 0..255 to linear. */
function lin(c: RGB): RGB {
  const f = (v: number): number => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return [f(c[0]), f(c[1]), f(c[2])];
}

/** Colours a thing may have, by kind (sRGB): plain, invented, nothing anyone's trade dress. */
const PAINT = {
  can: [[176, 36, 32], [28, 92, 160], [40, 122, 66], [214, 160, 34], [96, 48, 120], [30, 30, 34]] as RGB[],
  mug: [[226, 218, 200], [44, 70, 58], [36, 52, 92], [150, 54, 40], [232, 228, 222]] as RGB[],
  cardHead: [[120, 40, 34], [44, 66, 96], [70, 84, 50]] as RGB[],
  pencil: [[232, 176, 36], [40, 84, 60], [36, 36, 40]] as RGB[],
};

/** One surface's numbers: its kind, how glossy (0..1), how metallic (0..1), how sharp its reflections (a lobe's power). */
type Surf = [number, number, number, number];
const MATTE: Surf = [SURFACE.plain, 0.15, 0, 8];

class Builder {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly uv: number[] = [];
  readonly alb: number[] = [];
  readonly surf: number[] = [];
  readonly idx: number[] = [];
  /** The thing being built: local points are turned by its yaw and moved to its place. */
  private c = 1;
  private s = 0;
  private at: V3 = [0, 0, 0];

  place(x: number, y: number, z: number, yaw: number): void {
    this.c = Math.cos(yaw);
    this.s = Math.sin(yaw);
    this.at = [x, y, z];
  }

  vertex(p: V3, n: V3, uv: [number, number], albedo: RGB, surf: Surf): number {
    const { c, s, at } = this;
    this.pos.push(at[0] + c * p[0] - s * p[1], at[1] + s * p[0] + c * p[1], at[2] + p[2]);
    this.nor.push(c * n[0] - s * n[1], s * n[0] + c * n[1], n[2]);
    this.uv.push(uv[0], uv[1]);
    this.alb.push(albedo[0], albedo[1], albedo[2]);
    this.surf.push(surf[0], surf[1], surf[2], surf[3]);
    return this.pos.length / 3 - 1;
  }

  /** A surface of revolution about the local z axis through a profile of (radius, height) points, with its own normals by the profile's slope. */
  lathe(profile: readonly [number, number][], segs: number, albedo: RGB, surf: Surf, inward = false): void {
    const rows: number[][] = [];
    for (let i = 0; i < profile.length; i++) {
      const [r, z] = profile[i] as [number, number];
      const prev = profile[Math.max(0, i - 1)] as [number, number];
      const next = profile[Math.min(profile.length - 1, i + 1)] as [number, number];
      // The profile's normal: its slope turned a quarter.
      let nr = next[1] - prev[1];
      let nz = -(next[0] - prev[0]);
      const l = Math.hypot(nr, nz) || 1;
      nr /= l;
      nz /= l;
      if (inward) {
        nr = -nr;
        nz = -nz;
      }
      const row: number[] = [];
      for (let k = 0; k <= segs; k++) {
        const a = (k / segs) * Math.PI * 2;
        row.push(this.vertex([Math.cos(a) * r, Math.sin(a) * r, z], [Math.cos(a) * nr, Math.sin(a) * nr, nz], [k / segs, z], albedo, surf));
      }
      rows.push(row);
    }
    for (let i = 0; i + 1 < rows.length; i++) {
      const a = rows[i] as number[];
      const b = rows[i + 1] as number[];
      for (let k = 0; k < segs; k++) {
        if (inward) this.idx.push(a[k] as number, b[k] as number, a[k + 1] as number, a[k + 1] as number, b[k] as number, b[k + 1] as number);
        else this.idx.push(a[k] as number, a[k + 1] as number, b[k] as number, a[k + 1] as number, b[k + 1] as number, b[k] as number);
      }
    }
  }

  /** A flat disc facing up (or down), uv across it in its own radius. */
  disc(r: number, z: number, segs: number, albedo: RGB, surf: Surf, down = false): void {
    const mid = this.vertex([0, 0, z], [0, 0, down ? -1 : 1], [0.5, 0.5], albedo, surf);
    const ring: number[] = [];
    for (let k = 0; k <= segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      ring.push(this.vertex([Math.cos(a) * r, Math.sin(a) * r, z], [0, 0, down ? -1 : 1], [0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)], albedo, surf));
    }
    for (let k = 0; k < segs; k++) this.idx.push(...(down ? [mid, ring[k + 1] as number, ring[k] as number] : [mid, ring[k] as number, ring[k + 1] as number]));
  }

  /** A box from a corner to a corner (local), each face its own surface: top, sides, bottom. uv of the top runs 0..1 over it. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, albedo: RGB, top: Surf, side: Surf): void {
    const face = (p: V3[], n: V3, surf: Surf, uvs: [number, number][]): void => {
      const i = p.map((q, k) => this.vertex(q, n, uvs[k] as [number, number], albedo, surf));
      this.idx.push(i[0] as number, i[1] as number, i[2] as number, i[0] as number, i[2] as number, i[3] as number);
    };
    const sq: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], top, sq);
    face([[x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]], [0, 0, -1], side, sq);
    face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], side, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    face([[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]], [0, 1, 0], side, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    face([[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]], [-1, 0, 0], side, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    face([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [1, 0, 0], side, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
}

const pick = <T>(list: readonly T[], v: number): T => list[Math.min(list.length - 1, Math.floor(v * list.length))] as T;

function can(b: Builder, p: PlacedProp): void {
  const paint = lin(pick(PAINT.can, p.variant));
  const metal = lin([196, 198, 202]);
  // A drink can's shape: the domed foot, the straight body, the neck and the lid's rim. Real size: 66 mm by 122 mm.
  b.lathe([[1.45, 0.0], [1.6, 0.12], [1.65, 0.35]], 20, metal, [SURFACE.metal, 0.8, 1, 60]);
  b.lathe([[1.65, 0.35], [1.65, 5.55]], 24, paint, [SURFACE.label, 0.9, 0.7, 70]);
  b.lathe([[1.65, 5.55], [1.52, 5.85], [1.36, 6.02], [1.38, 6.1], [1.3, 6.08]], 20, metal, [SURFACE.metal, 0.85, 1, 80]);
  b.disc(1.3, 6.0, 20, metal, [SURFACE.metal, 0.75, 1, 50]);
  b.disc(1.45, 0.005, 12, metal, [SURFACE.metal, 0.4, 1, 20], true);
  // The ring pull: a small flat tab on the lid.
  b.box(0.15, -0.28, 6.01, 0.95, 0.28, 6.05, metal, [SURFACE.metal, 0.8, 1, 70], [SURFACE.metal, 0.8, 1, 70]);
}

function mug(b: Builder, p: PlacedProp): void {
  const glaze = lin(pick(PAINT.mug, p.variant));
  const g: Surf = [SURFACE.glaze, 0.9, 0, 140];
  // 82 mm across, 95 mm tall, a 4 mm wall, coffee 15 mm under the rim.
  b.lathe([[1.85, 0.0], [2.0, 0.1], [2.05, 0.4], [2.05, 4.65], [2.0, 4.75]], 24, glaze, g);
  b.lathe([[1.85, 4.75], [1.85, 0.4]], 24, glaze, g, false);
  b.lathe([[2.0, 4.75], [1.85, 4.75]], 24, glaze, g);
  b.disc(1.85, 4.0, 24, lin([46, 26, 14]), [SURFACE.coffee, 0.95, 0, 300]);
  b.disc(1.85, 0.005, 16, glaze, MATTE, true);
  // The handle: a bent tube on the side, as a ring of short cylinders.
  const segs = 10;
  const tube = 0.3;
  for (let k = 0; k < segs; k++) {
    const a0 = -Math.PI / 2 + (k / segs) * Math.PI;
    const a1 = -Math.PI / 2 + ((k + 1) / segs) * Math.PI;
    const p0: V3 = [2.0 + Math.cos(a0) * 1.0, 0, 2.4 + Math.sin(a0) * 1.25];
    const p1: V3 = [2.0 + Math.cos(a1) * 1.0, 0, 2.4 + Math.sin(a1) * 1.25];
    const rows: number[][] = [];
    for (const [q, a] of [[p0, a0], [p1, a1]] as [V3, number][]) {
      const row: number[] = [];
      const out: V3 = [Math.cos(a), 0, Math.sin(a)];
      for (let j = 0; j <= 6; j++) {
        const t = (j / 6) * Math.PI * 2;
        const n: V3 = [out[0] * Math.cos(t), Math.sin(t), out[2] * Math.cos(t)];
        row.push(b.vertex([q[0] + n[0] * tube, q[1] + n[1] * tube, q[2] + n[2] * tube], n, [j / 6, k / segs], glaze, g));
      }
      rows.push(row);
    }
    const [r0, r1] = rows as [number[], number[]];
    for (let j = 0; j < 6; j++) b.idx.push(r0[j] as number, r1[j] as number, r0[j + 1] as number, r0[j + 1] as number, r1[j] as number, r1[j + 1] as number);
  }
}

function coaster(b: Builder): void {
  const cork = lin([168, 124, 82]);
  b.lathe([[2.5, 0.0], [2.5, 0.2]], 28, cork, [SURFACE.cork, 0.05, 0, 6]);
  b.disc(2.5, 0.2, 28, cork, [SURFACE.cork, 0.05, 0, 6]);
}

function cards(b: Builder, p: PlacedProp): void {
  // A small pile of rule cards, 63 by 88 mm, none square on the one under it.
  const n = 3 + Math.floor(hash01(Math.floor(p.variant * 1e6), 'props:cards', 0) * 3);
  const head = lin(pick(PAINT.cardHead, p.variant));
  for (let k = 0; k < n; k++) {
    const turn = (hash01(Math.floor(p.variant * 1e6), 'props:cards:turn', k) - 0.5) * 0.5;
    const dx = (hash01(Math.floor(p.variant * 1e6), 'props:cards:dx', k) - 0.5) * 0.6;
    const dy = (hash01(Math.floor(p.variant * 1e6), 'props:cards:dy', k) - 0.5) * 0.6;
    b.place(p.x + Math.cos(p.yaw) * dx - Math.sin(p.yaw) * dy, p.y + Math.sin(p.yaw) * dx + Math.cos(p.yaw) * dy, p.z + k * 0.022, p.yaw + turn);
    b.box(-1.575, -2.2, 0, 1.575, 2.2, 0.02, head, [SURFACE.card, 0.35, 0, 30], [SURFACE.stack, 0.1, 0, 8]);
  }
}

function sheet(b: Builder): void {
  // A rule sheet, A4 folded once (210 by 148 mm), its top leaf lifted a little at its open side.
  const paper = lin([236, 230, 214]);
  b.box(-5.25, -3.7, 0, 5.25, 3.7, 0.012, paper, [SURFACE.sheet, 0.3, 0, 24], [SURFACE.stack, 0.1, 0, 8]);
  const lift = 0.05;
  const i = [
    b.vertex([-5.25, -3.7, 0.03], [0, -Math.sin(lift), Math.cos(lift)], [0, 0], paper, [SURFACE.sheet, 0.3, 0, 24]),
    b.vertex([5.25, -3.7, 0.03], [0, -Math.sin(lift), Math.cos(lift)], [1, 0], paper, [SURFACE.sheet, 0.3, 0, 24]),
    b.vertex([5.25, 3.7, 0.03 + 7.4 * Math.sin(lift)], [0, -Math.sin(lift), Math.cos(lift)], [1, 1], paper, [SURFACE.sheet, 0.3, 0, 24]),
    b.vertex([-5.25, 3.7, 0.03 + 7.4 * Math.sin(lift)], [0, -Math.sin(lift), Math.cos(lift)], [0, 1], paper, [SURFACE.sheet, 0.3, 0, 24]),
  ];
  b.idx.push(i[0] as number, i[1] as number, i[2] as number, i[0] as number, i[2] as number, i[3] as number);
}

function notepad(b: Builder): void {
  // 100 by 150 mm, 8 mm thick, glued at its head under a dark strip.
  const page = lin([240, 236, 222]);
  b.box(-2.5, -3.75, 0, 2.5, 3.75, 0.4, page, [SURFACE.page, 0.2, 0, 16], [SURFACE.stack, 0.1, 0, 8]);
  b.box(-2.52, -3.77, 0.0, 2.52, -3.15, 0.44, lin([40, 40, 46]), [SURFACE.plain, 0.3, 0, 20], [SURFACE.plain, 0.3, 0, 20]);
}

function pencil(b: Builder, p: PlacedProp): void {
  // A hexagonal pencil, 7 mm across its flats and 175 mm long, sharpened.
  const paint = lin(pick(PAINT.pencil, p.variant));
  const r = 0.2;
  const z = r * Math.cos(Math.PI / 6);
  // The body: six flat sides along local x, lying on one of them.
  const seg = 6;
  const body: number[][] = [];
  for (const x of [-3.8, 3.4]) {
    const row: number[] = [];
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2 + Math.PI / 6;
      const n: V3 = [0, Math.cos(a), Math.sin(a)];
      row.push(b.vertex([x, Math.cos(a) * r, z + Math.sin(a) * r], n, [k / seg, x], paint, [SURFACE.glaze, 0.7, 0, 60]));
    }
    body.push(row);
  }
  const [b0, b1] = body as [number[], number[]];
  for (let k = 0; k < seg; k++) b.idx.push(b0[k] as number, b0[k + 1] as number, b1[k] as number, b0[k + 1] as number, b1[k + 1] as number, b1[k] as number);
  // The sharpened wood and the lead, toward +x; the ferrule and the eraser at -x.
  const wood = lin([214, 170, 120]);
  const tip = (x0: number, x1: number, r0: number, r1: number, albedo: RGB, surf: Surf): void => {
    const rows: number[][] = [];
    for (const [x, rr] of [[x0, r0], [x1, r1]] as [number, number][]) {
      const row: number[] = [];
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI * 2 + Math.PI / 6;
        const slope = (r0 - r1) / Math.max(x1 - x0, 1e-6);
        const n: V3 = [slope, Math.cos(a), Math.sin(a)];
        const l = Math.hypot(n[0], n[1], n[2]);
        row.push(b.vertex([x, Math.cos(a) * rr, z + Math.sin(a) * rr], [n[0] / l, n[1] / l, n[2] / l], [k / seg, x], albedo, surf));
      }
      rows.push(row);
    }
    const [a0, a1] = rows as [number[], number[]];
    for (let k = 0; k < seg; k++) b.idx.push(a0[k] as number, a0[k + 1] as number, a1[k] as number, a0[k + 1] as number, a1[k + 1] as number, a1[k] as number);
  };
  tip(3.4, 4.2, r, 0.06, wood, MATTE);
  tip(4.2, 4.45, 0.06, 0.0, lin([50, 50, 54]), [SURFACE.metal, 0.4, 0.6, 30]);
  tip(-4.3, -3.8, r * 1.02, r * 1.02, lin([186, 180, 166]), [SURFACE.metal, 0.8, 1, 60]);
  tip(-4.65, -4.3, r * 0.98, r * 0.98, lin([214, 128, 122]), MATTE);
  b.disc(r * 0.98, 0, 6, lin([214, 128, 122]), MATTE);
}

/** The mesh of every thing on the table, and their shadows' quads. */
export function buildProps(props: readonly PlacedProp[], key: readonly [number, number, number]): { body: THREE.BufferGeometry; shadow: THREE.BufferGeometry } {
  const b = new Builder();
  for (const p of props) {
    b.place(p.x, p.y, p.z, p.yaw);
    if (p.kind === 'can') can(b, p);
    else if (p.kind === 'mug') mug(b, p);
    else if (p.kind === 'coaster') coaster(b);
    else if (p.kind === 'cards') cards(b, p);
    else if (p.kind === 'sheet') sheet(b);
    else if (p.kind === 'notepad') notepad(b);
    else if (p.kind === 'pencil') pencil(b, p);
  }
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  body.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
  body.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  body.setAttribute('aAlbedo', new THREE.Float32BufferAttribute(b.alb, 3));
  body.setAttribute('aSurf', new THREE.Float32BufferAttribute(b.surf, 4));
  body.setIndex(b.idx);
  body.computeBoundingSphere();

  // Shadows: a quad on the table under each thing that stands on it, reaching away from the key as far as its
  // top's shadow; the shader makes it a soft capsule (round things) or a soft box (flat ones).
  const sPos: number[] = [];
  const sLocal: number[] = [];
  const sShape: number[] = [];
  const sIdx: number[] = [];
  const lx = -key[0] / key[2];
  const ly = -key[1] / key[2];
  for (const p of props) {
    if (p.z > 0) continue;
    const size = PROP_SIZE[p.kind];
    const round = p.kind === 'can' || p.kind === 'mug' || p.kind === 'coaster';
    // A coaster's shadow is its drink's too.
    const stands = props.filter(q => q.z > 0 && Math.hypot(q.x - p.x, q.y - p.y) < 0.5);
    const tall = Math.max(size.height, ...stands.map(q => q.z + PROP_SIZE[q.kind].height));
    const half: [number, number] = round
      ? [p.kind === 'mug' ? 2.05 : p.kind === 'can' ? 1.65 : 2.5, 0]
      : p.kind === 'cards' ? [1.7, 2.3] : p.kind === 'sheet' ? [5.25, 3.7] : p.kind === 'notepad' ? [2.5, 3.75] : [4.4, 0.2];
    // The shadow's reach on the plan, in the thing's own frame.
    const c = Math.cos(-p.yaw);
    const s = Math.sin(-p.yaw);
    const ox = (c * lx - s * ly) * tall;
    const oy = (s * lx + c * ly) * tall;
    const ext = (round ? half[0] : Math.hypot(half[0], half[1])) + 0.8;
    const xs = [Math.min(0, ox) - ext, Math.max(0, ox) + ext];
    const ys = [Math.min(0, oy) - ext, Math.max(0, oy) + ext];
    const start = sPos.length / 3;
    for (const [ax, ay] of [[xs[0], ys[0]], [xs[1], ys[0]], [xs[1], ys[1]], [xs[0], ys[1]]] as [number, number][]) {
      const cy = Math.cos(p.yaw);
      const sy = Math.sin(p.yaw);
      sPos.push(p.x + cy * ax - sy * ay, p.y + sy * ax + cy * ay, 0);
      sLocal.push(ax, ay, ox, oy);
      sShape.push(half[0], half[1], round ? 0 : 1, round ? 0.55 : p.kind === 'pencil' ? 0.45 : 0.4);
    }
    sIdx.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  const shadow = new THREE.BufferGeometry();
  shadow.setAttribute('position', new THREE.Float32BufferAttribute(sPos, 3));
  shadow.setAttribute('aLocal', new THREE.Float32BufferAttribute(sLocal, 4));
  shadow.setAttribute('aShape', new THREE.Float32BufferAttribute(sShape, 4));
  shadow.setIndex(sIdx);
  shadow.computeBoundingSphere();
  return { body, shadow };
}
