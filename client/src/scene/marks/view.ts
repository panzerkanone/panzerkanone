/**
 * The marks drawn: each mark's drawing laid flat into the board's surface on its hex, as if printed there, under
 * the counters: no card, no edge, no shadow of its own. One mesh of quads, remade when the marks change (they
 * change seldom), drawn just after the board and before everything that stands or lies on it.
 *
 * How a drawing is printed (the table of marks' `look`, for hulks and for craters apart): its shadows lifted, its
 * colour taken down toward grey and toward an ink (the board's own key ink, the grid's and the hex numbers', which
 * is the same in every season; or one the data names), its soft edge softened further, a faint light halo round it,
 * and its opacity. Then it is laid on as ink is (`multiply`: the board's own light, paper and season show through it,
 * and its lines and numbers stay dark over it) or over the board (`normal`). Neither writes depth: the counters'
 * shadows fall on it as on the board, every counter stands over it, and a marker of the game's lies over it.
 *
 * A mark fades in where it is laid; a kind switched off fades out (`show`), and comes back so.
 */
import * as THREE from 'three';
import { COMMON } from '../shaders';
import { CELL_PAD, PRINT_CELL } from './cells';
import type { MarkAtlases } from './art';
import type { Mark, MarkLook, MarksModel } from './model';

type Uniform<T> = { value: T };

const VERTEX = /* glsl */ `
attribute vec4 aMark;    // when it was laid (s), its kind (0 hulk, 1 crater), unused, unused
uniform vec4 uMarkClock; // now (s), the fade's seconds, unused, the height it is drawn at
uniform vec2 uMarkShow;  // how far each kind is shown (hulks, craters): 0 to 1
varying vec2 vUv;
varying float vFade;
flat varying float vKind;
void main() {
  float t = clamp((uMarkClock.x - aMark.x) / uMarkClock.y, 0.0, 1.0);
  float shown = aMark.y < 0.5 ? uMarkShow.x : uMarkShow.y;
  vFade = smoothstep(0.0, 1.0, min(t, shown));
  vUv = uv;
  vKind = aMark.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(position.xy, uMarkClock.w, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying float vFade;
flat varying float vKind;
${COMMON}
uniform sampler2D uMarkPrint;
uniform vec3 uInk;            // the board's key ink (linear)
uniform vec4 uMarkLookA[2];   // a kind's opacity, lift, saturation, how far toward its ink
uniform vec4 uMarkLookB[2];   // its extra feather, its halo, its blend (0 normal, 1 multiply), whether its ink is the board's key ink (1) or its own (0)
uniform vec4 uMarkLookC[2];   // its haze cleared, unused, unused, unused
uniform vec3 uMarkInk[2];     // its own ink (display values), where it names one
uniform float uMarkLod;       // the atlas level a soft copy of the cover is read from (feather, halo)

void main() {
  if (vFade <= 0.003) discard;
  int k = vKind < 0.5 ? 0 : 1;
  vec4 A = uMarkLookA[k];
  vec4 B = uMarkLookB[k];
  vec4 C = uMarkLookC[k];
  vec4 tex = texture2D(uMarkPrint, vUv);
  float soft = textureLod(uMarkPrint, vUv, uMarkLod).a;
  // The drawing in display values: its fills opened (black stays black), greyed, inked.
  vec3 c = pow(max(tex.rgb, vec3(0.0)), vec3(1.0 / 2.2));
  c = pow(c, vec3(1.0 / (1.0 + 2.0 * A.y)));
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(luma), c, A.z);
  vec3 ink = B.w > 0.5 ? pow(max(uInk, vec3(0.0)), vec3(1.0 / 2.2)) : uMarkInk[k];
  c = mix(c, mix(vec3(1.0), ink, 1.0 - luma), A.w);
  // Its cover: its haze cleared, softened at the edge where asked, at its opacity, faded in.
  float own = clamp((tex.a - C.x) / max(1.0 - C.x, 1e-3), 0.0, 1.0);
  float a = own * mix(1.0, smoothstep(0.0, 0.85, soft), B.x) * A.x * vFade;
  float halo = clamp(soft * 1.6 - own, 0.0, 1.0) * B.y * vFade;
  if (B.z > 0.5) {
    // As ink: what is under it times the drawing's colour, by its cover; the halo lifts a little.
    vec3 f = mix(vec3(1.0), c, a) * (1.0 + 0.35 * halo);
    if (max(abs(f.r - 1.0), max(abs(f.g - 1.0), abs(f.b - 1.0))) < 0.002) discard;
    gl_FragColor = vec4(f, 1.0);
  } else {
    vec3 col = mix(vec3(1.0), c, a / max(a + halo * 0.6, 1e-4));
    float cover = clamp(a + halo * 0.6, 0.0, 1.0);
    if (cover <= 0.003) discard;
    vec4 o = finish(pow(col, vec3(2.2)));
    gl_FragColor = vec4(o.rgb, cover);
  }
}
`;

/** A picture's quad, once: its size (longer side 1) and the atlas's corners for it. */
interface Template {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  w: number;
  h: number;
}

/** The look's numbers as the shader takes them. */
function lookUniforms(look: Readonly<Record<'hulk' | 'crater', MarkLook>>): { a: THREE.Vector4[]; b: THREE.Vector4[]; c: THREE.Vector4[]; ink: THREE.Vector3[]; blend: number } {
  const kinds = [look.hulk, look.crater];
  return {
    a: kinds.map(l => new THREE.Vector4(l.opacity, l.lift, l.saturation, l.tint.amount)),
    b: kinds.map(l => new THREE.Vector4(l.feather, l.halo, l.blend === 'multiply' ? 1 : 0, l.tint.ink === 'key' ? 1 : 0)),
    c: kinds.map(l => new THREE.Vector4(l.crisp, 0, 0, 0)),
    ink: kinds.map(l => (l.tint.ink === 'key' ? new THREE.Vector3(0, 0, 0) : new THREE.Vector3(l.tint.ink[0] / 255, l.tint.ink[1] / 255, l.tint.ink[2] / 255))),
    blend: look.hulk.blend === 'multiply' ? 1 : 0,
  };
}

export class MarksView {
  readonly group = new THREE.Group();
  /** The textures this view holds, and their bytes on the GPU. */
  textures = { count: 0, bytes: 0 };
  private readonly model: MarksModel;
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly templates = new Map<string, Template>();
  private readonly own: Record<string, Uniform<unknown>>;
  private built = -1;
  private blend = -1;
  private readonly print: THREE.CanvasTexture;

  constructor(model: MarksModel, art: MarkAtlases, shared: Record<string, Uniform<unknown>>, opts: { maxAnisotropy: number }) {
    this.model = model;
    this.print = new THREE.CanvasTexture(art.print.canvas);
    this.print.colorSpace = THREE.SRGBColorSpace;
    this.print.flipY = false;
    this.print.generateMipmaps = true;
    this.print.minFilter = THREE.LinearMipmapLinearFilter;
    this.print.anisotropy = opts.maxAnisotropy;
    this.textures = { count: 1, bytes: Math.round(art.print.canvas.width * art.print.canvas.height * 4 * 1.34) };
    // The soft copy of a cover for the feather and the halo: the level whose texels are about 2% of a picture across.
    const lod = Math.log2(Math.max(1, 0.02 * PRINT_CELL * (1 - 2 * CELL_PAD)));
    const l = lookUniforms(model.table.look);
    this.own = {
      uMarkPrint: { value: this.print },
      uMarkLod: { value: lod },
      uMarkLookA: { value: l.a },
      uMarkLookB: { value: l.b },
      uMarkLookC: { value: l.c },
      uMarkInk: { value: l.ink },
      uMarkClock: { value: new THREE.Vector4(0, model.table.ease.seconds, 0, 0.0006) },
      uMarkShow: { value: new THREE.Vector2(1, 1) },
    };
    for (const p of art.pictures) {
      const c = art.print.layout.cells.get(p.id);
      if (!c) continue;
      const long = Math.max(p.width, p.height);
      this.templates.set(p.id, { u0: c.u0, v0: c.v0, u1: c.u1, v1: c.v1, w: p.width / long, h: p.height / long });
    }
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...shared, ...this.own } as Record<string, THREE.IUniform>,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: THREE.DoubleSide,
      toneMapped: false,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
    this.setBlend(l.blend);
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.renderOrder = 5.5;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.group.add(this.mesh);
  }

  /** As ink (what is under it times its colour) or over the board. */
  private setBlend(multiply: number): void {
    if (multiply === this.blend) return;
    this.blend = multiply;
    const m = this.material;
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    if (multiply) {
      m.blendSrc = THREE.DstColorFactor;
      m.blendDst = THREE.ZeroFactor;
    } else {
      m.blendSrc = THREE.SrcAlphaFactor;
      m.blendDst = THREE.OneMinusSrcAlphaFactor;
    }
    m.needsUpdate = true;
  }

  /** The look changed (a check trying another): its numbers to the shader. */
  setLook(look: Readonly<Record<'hulk' | 'crater', MarkLook>>): void {
    const l = lookUniforms(look);
    (this.own.uMarkLookA as Uniform<THREE.Vector4[]>).value = l.a;
    (this.own.uMarkLookB as Uniform<THREE.Vector4[]>).value = l.b;
    (this.own.uMarkLookC as Uniform<THREE.Vector4[]>).value = l.c;
    (this.own.uMarkInk as Uniform<THREE.Vector3[]>).value = l.ink;
    this.setBlend(l.blend);
  }

  /** Before a frame: the mesh made again if the marks changed; the clock and how far each kind is shown. */
  sync(now: number, show: { hulks: number; craters: number }): void {
    (this.own.uMarkClock as Uniform<THREE.Vector4>).value.x = now;
    (this.own.uMarkShow as Uniform<THREE.Vector2>).value.set(show.hulks, show.craters);
    if (this.built !== this.model.version) this.build();
    this.mesh.visible = this.model.marks.length > 0 && (show.hulks > 0 || show.craters > 0);
  }

  /** The mesh made again from the marks that lie on the table, in the order laid (a newer one over an older). */
  private build(): void {
    this.built = this.model.version;
    const pos: number[] = [];
    const uv: number[] = [];
    const mark: number[] = [];
    const idx: number[] = [];
    const list = [...this.model.marks].sort((a, b) => a.order - b.order);
    for (const m of list) {
      const t = this.templates.get(m.picture);
      if (!t) continue;
      const base = pos.length / 3;
      for (const [q, u, v] of this.corners(m, t)) {
        pos.push(q[0], q[1], 0);
        uv.push(u, v);
        mark.push(m.born, m.kind === 'hulk' ? 0 : 1, 0, 0);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aMark', new THREE.Float32BufferAttribute(mark, 4));
    g.setIndex(idx);
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
  }

  /** A mark's quad: its four corners on the plan, each with the atlas's place for it. */
  private corners(m: Mark, t: Template): [[number, number], number, number][] {
    const c = Math.cos(m.turn);
    const s = Math.sin(m.turn);
    const hx = (t.w * m.size) / 2;
    const hy = (t.h * m.size) / 2;
    return ([[-1, -1, t.u0, t.v0], [1, -1, t.u1, t.v0], [1, 1, t.u1, t.v1], [-1, 1, t.u0, t.v1]] as const).map(([sx, sy, u, v]) => {
      const x = sx * hx;
      const y = sy * hy;
      return [[m.x + c * x - s * y, m.y + s * x + c * y], u, v];
    });
  }

  /** A mark's corners as it lies (for checks). */
  cornersOf(m: Mark): [number, number][] {
    const t = this.templates.get(m.picture);
    return t ? this.corners(m, t).map(([q]) => q) : [];
  }

  /** After a lost graphics context: the texture is sent again. */
  restore(): void {
    this.print.needsUpdate = true;
    this.built = -1;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.print.dispose();
  }
}
