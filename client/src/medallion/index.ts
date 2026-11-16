/**
 * The PLAY GAME medallion, live: one transparent WebGL canvas that lies over the medallion's place on the
 * title screen, larger than the medallion so that nothing of its fire is cut off, and draws, back to front,
 *
 *   1. the fire: flames made every frame round the medallion's own outline (a field of distances from it,
 *      assets/shell/medallion/field.png), in the colours of the owner's painted fire (its colour against
 *      its heat, measured from his ablaze sheet), as hot against the metal and reaching as far round the
 *      outline as his does, sector by sector. None of his painted fire is drawn;
 *   2. his medallion at rest: the 2D cut of his at-rest sheet, flat (its soft shadow and its painted edge);
 *   3. his 3D model, seen straight on, with his paintings laid on it: at rest every pixel of it is the
 *      cut's own pixel, so the model is his at-rest sheet; as it catches fire it takes his ablaze sheet.
 *      Live light only adds: a band of light that sweeps across the metal now and then (a highlight
 *      through the model's relief, tinted by the painted colour), and the model turns a few degrees
 *      toward the pointer;
 *   4. embers: his own embers' shapes, born at the outline, thrown outward and carried up.
 *
 * The title (client/src/shell/play.ts) fetches this module only after its own picture is up; its 2D cut
 * stands in until this is ready and stays if this fails. Everything here is disposed when the medallion
 * has gone. The canvas is premultiplied: light adds to the painting under it without a dark fringe.
 */
import indexText from '../../../assets/shell/medallion/medallion.json?raw';
import ablazeAddress from '../../../assets/shell/medallion/ablaze.webp?url';
import fieldAddress from '../../../assets/shell/medallion/field.png?url';
import modelAddress from '../../../assets/shell/medallion/medallion.glb?url';
import reliefAddress from '../../../assets/shell/medallion/relief.jpg?url';
import sparksAddress from '../../../assets/shell/medallion/sparks.webp?url';
import { readMedallionIndex } from './data';
import { FLAME_FS, FULL_VS, MESH_FS, MESH_VS, QUAD_FS, QUAD_VS, SPARK_FS, SPARK_VS } from './shaders';

/** The numbers its look is tuned by (client/src/shell/places.ts: PLAY.model). */
export interface MedallionLook {
  /** The sweep: seconds from one to the next, seconds it takes to cross, its light's strength, and how high over the metal the light passes (stage pixels). */
  sweepEvery: number;
  sweepS: number;
  sweepLight: number;
  sweepHigh: number;
  /**
   * While it burns the sweep comes sooner (`sweepHotAfter` seconds after it catches, then every `sweepHotEvery`), and
   * surges the glow of the letters it passes over: `surge` is how much of their glow is added again under the band's
   * middle, `surgeWide` how wide the surge is (stage pixels).
   */
  sweepHotAfter: number;
  sweepHotEvery: number;
  surge: number;
  surgeWide: number;
  /** Degrees it turns toward the pointer at most, and how far it goes in when held (a share of its size). */
  turn: number;
  press: number;
  /** The fire is soft: it is drawn at this share of the canvas's pixels each way and laid on (a third once frames run long). */
  fireDetail: number;
  /** Seconds the fire takes to catch all round, and to die down. */
  igniteS: number;
  coolS: number;
  /** Seconds an easing takes to get most of the way, for the turn and for held. */
  easeS: number;
  pressS: number;
  /** The light the pointer carries over the burning metal: its strength and its height (stage pixels). */
  pointerLight: number;
  pointerHigh: number;
  /**
   * Embers and ash: each of the owner's painted ones is a lane, from the outline through the place he painted
   * it; a live one flies each lane, again and again. `emberMore`: the share of lanes flown by a second one
   * (a frame then holds about as many as his picture); seconds an ember lives (a fleck of ash lives `ashLife`
   * times as long); how fast they are carried up as they go (stage pixels a second).
   */
  emberMore: number;
  emberLife: readonly [number, number];
  ashLife: number;
  emberRise: number;
  /**
   * Left alone, it asks to be pressed. A smoulder: about every `smoulderEvery` seconds a low flame wakes along a part
   * of the outline for `smoulderS` seconds, as strong as `smoulderLevel` of the full burn, and spits a few embers.
   * A breath: a faint warmth all round, `breath` of the full burn at its fullest, once every `breathS` seconds. A
   * tease: after `teaseAfter` seconds untouched, and every `teaseEvery` after that, it flares to `teaseLevel` of the
   * full burn for `teaseS` seconds and dies back.
   */
  smoulderEvery: number;
  smoulderS: readonly [number, number];
  smoulderLevel: readonly [number, number];
  breath: number;
  breathS: number;
  teaseAfter: number;
  teaseEvery: number;
  teaseS: number;
  teaseLevel: number;
  /**
   * The press: how many embers are thrown out in a ring, how fast (stage pixels a second) and for how long
   * (seconds); and seconds from the press until the last of it has gone.
   */
  burst: number;
  burstSpeed: readonly [number, number];
  burstLife: readonly [number, number];
  goneS: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MedallionState {
  /** Everything has arrived and a frame has been drawn. */
  ready: boolean;
  frames: number;
  /** Milliseconds of script a frame took: the mean of the last hundred or so, and the most. */
  drawMs: number;
  drawMsMost: number;
  /** How much it burns now (0 to 1), how far it is held in (0 to 1), and whether the sweep is passing. */
  burn: number;
  held: number;
  sweeping: boolean;
  /** Embers in the air in the frame in hand, and how much fire of any kind shows in it (the burn, a smoulder, the breath): 0 for none. */
  embers: number;
  glow: number;
  /** It was pressed, and the last of it has gone. */
  gone: boolean;
  /** Frames that were due but not drawn, because nothing had changed since the last. */
  rested: number;
  /** Milliseconds the graphics card took over a frame (the mean of those timed), where the browser can time it; -1 where it cannot. */
  gpuMs: number;
  /** The canvas's share of the display's pixels each way: 1, or less once frames ran long. */
  detail: number;
  /** The fire's own share of the canvas's pixels each way (it is soft, and is drawn smaller and laid on). */
  fire: number;
}

export interface Medallion3D {
  readonly state: MedallionState;
  /** The display's pixels to a stage pixel: the canvas is given its size. */
  resize(pixels: number): void;
  /** Under the pointer or the keyboard's focus (it burns); where it was touched first, in the cut's own pixels (the fire catches there). */
  hot(on: boolean, x: number, y: number): void;
  /** Where the pointer is over the medallion: -1 to 1 across and down the cut's box. */
  aim(x: number, y: number): void;
  down(on: boolean): void;
  /** It is pressed: driven in, a flash, embers thrown out in a ring, the fire flaring and tearing away as it goes. `gone` is called when the last of it has. */
  press(gone: () => void): void;
  /** A press elsewhere on the screen: it flares for a moment. */
  pulse(): void;
  /** For a viewer who asks for less motion. */
  reduce(on: boolean): void;
  /** The medallion is covered: nothing is drawn until it is shown again. */
  pause(on: boolean): void;
  /** For captures: the clock stands at this time and that moment is drawn (null: it runs again). */
  stand(t: number | null): void;
  dispose(): void;
}

export interface MedallionOptions {
  canvas: HTMLCanvasElement;
  /** The canvas's box and the at-rest cut's box, on the stage (stage pixels). */
  box: Box;
  cut: Box;
  /** The address of the at-rest cut's picture. */
  card: string;
  look: MedallionLook;
  reduced: boolean;
  seed: number;
  /** The screen's clock, seconds. */
  clock(): number;
}

const clamp01 = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 1 : v);
const smooth = (v: number): number => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** A share from 0 up to 1 out of whole numbers: the same numbers, the same share. */
function draw(seed: number, a: number, b: number): number {
  let h = (seed ^ Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

async function pictureOf(address: string, premultiply: boolean): Promise<ImageBitmap> {
  const blob = await (await fetch(address)).blob();
  return createImageBitmap(blob, { premultiplyAlpha: premultiply ? 'premultiply' : 'none', colorSpaceConversion: 'none' });
}

interface Geometry {
  positions: Float32Array<ArrayBuffer>;
  normals: Float32Array<ArrayBuffer>;
  uvs: Float32Array<ArrayBuffer>;
  indices: Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>;
}

/** The model's geometry out of its binary glTF file (one mesh: positions, normals, places on the cut, triangles). */
function geometryOf(bytes: ArrayBuffer): Geometry {
  const view = new DataView(bytes);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('medallion: the model is not a binary glTF file');
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLength))) as {
    meshes: { primitives: { attributes: Record<string, number>; indices: number }[] }[];
    accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number }[];
    bufferViews: { byteOffset?: number; byteLength: number }[];
  };
  const bin = 20 + jsonLength + 8;
  const prim = json.meshes[0]?.primitives[0];
  if (!prim) throw new Error('medallion: the model has no mesh');
  const part = (accessor: number, size: number): ArrayBuffer => {
    const a = json.accessors[accessor];
    const v = a ? json.bufferViews[a.bufferView] : undefined;
    if (!a || !v) throw new Error('medallion: the model lacks a part');
    const from = bin + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    return bytes.slice(from, from + a.count * size);
  };
  const idx = json.accessors[prim.indices];
  if (!idx) throw new Error('medallion: the model has no triangles');
  return {
    positions: new Float32Array(part(prim.attributes['POSITION'] as number, 12)),
    normals: new Float32Array(part(prim.attributes['NORMAL'] as number, 12)),
    uvs: new Float32Array(part(prim.attributes['TEXCOORD_0'] as number, 8)),
    indices: idx.componentType === 5123 ? new Uint16Array(part(prim.indices, 2)) : new Uint32Array(part(prim.indices, 4)),
  };
}

export async function startMedallion(o: MedallionOptions): Promise<Medallion3D | null> {
  const { canvas, look, box, cut } = o;
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true, depth: true, powerPreference: 'default' });
  if (!gl) {
    console.warn('medallion: no WebGL 2 here; the 2D medallion stays');
    return null;
  }
  const index = readMedallionIndex(JSON.parse(indexText) as unknown);
  const state: MedallionState = { ready: false, frames: 0, drawMs: 0, drawMsMost: 0, burn: 0, held: 0, sweeping: false, embers: 0, glow: 0, gone: false, rested: 0, gpuMs: -1, detail: 1, fire: look.fireDetail };
  let disposed = false;

  const [modelBytes, card, ablaze, relief, field, sparks] = await Promise.all([
    fetch(modelAddress).then(r => r.arrayBuffer()),
    pictureOf(o.card, true),
    pictureOf(ablazeAddress, false),
    pictureOf(reliefAddress, false),
    pictureOf(fieldAddress, false),
    pictureOf(sparksAddress, false),
  ]);
  if (disposed) return null;
  const geometry = geometryOf(modelBytes);

  // ---- the graphics card's things --------------------------------------------------------------------
  const programOf = (vs: string, fs: string): WebGLProgram => {
    const program = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('medallion: no shader');
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`medallion: a shader does not compile: ${gl.getShaderInfoLog(shader) ?? ''}`);
      gl.attachShader(program, shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`medallion: a program does not link: ${gl.getProgramInfoLog(program) ?? ''}`);
    return program;
  };
  const textures: WebGLTexture[] = [];
  const textureOf = (source: ImageBitmap | { width: number; height: number; data: Uint8Array }, mips: boolean, repeat = false): WebGLTexture => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    if ('data' in source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, source.width, source.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    textures.push(t);
    return t;
  };
  /** A row of numbers (0 to 1, up to four a step) as a picture one pixel high. */
  const rowOf = (steps: readonly (readonly number[])[], repeat = false): WebGLTexture => {
    const data = new Uint8Array(steps.length * 4);
    steps.forEach((s, i) => {
      for (let c = 0; c < 4; c++) data[i * 4 + c] = Math.round(255 * clamp01(s[c] ?? 0));
    });
    return textureOf({ width: steps.length, height: 1, data }, false, repeat);
  };

  const meshProgram = programOf(MESH_VS, MESH_FS);
  const quadProgram = programOf(QUAD_VS, QUAD_FS);
  const flameProgram = programOf(FULL_VS, FLAME_FS);
  const sparkProgram = programOf(SPARK_VS, SPARK_FS);
  const cardTexture = textureOf(card, true);
  const ablazeTexture = textureOf(ablaze, true);
  const reliefTexture = textureOf(relief, true);
  const fieldTexture = textureOf(field, false);
  const sparksTexture = textureOf(sparks, false);
  for (const picture of [card, ablaze, relief, field, sparks]) picture.close();
  const reachMost = Math.max(...index.fire.reach);
  const tallMost = Math.max(...index.fire.tall);
  const rampTexture = rowOf(index.fire.ramp);
  const ringTexture = rowOf(index.fire.core.map((c, i) => [c, (index.fire.reach[i] as number) / reachMost, (index.fire.tall[i] as number) / tallMost, index.fire.hot[i] as number]), true);
  const shapeTexture = rowOf(index.fire.shape.map(v => [v]));

  const buffers: WebGLBuffer[] = [];
  const bufferOf = (target: number, data: BufferSource, usage: number = gl.STATIC_DRAW): WebGLBuffer => {
    const b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, usage);
    buffers.push(b);
    return b;
  };
  const attribute = (program: WebGLProgram, name: string, size: number, stride = 0, offset = 0, divisor = 0): void => {
    const at = gl.getAttribLocation(program, name);
    if (at < 0) return;
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, size, gl.FLOAT, false, stride, offset);
    gl.vertexAttribDivisor(at, divisor);
  };
  // The model.
  const meshArray = gl.createVertexArray();
  gl.bindVertexArray(meshArray);
  bufferOf(gl.ARRAY_BUFFER, geometry.positions);
  attribute(meshProgram, 'aPos', 3);
  bufferOf(gl.ARRAY_BUFFER, geometry.normals);
  attribute(meshProgram, 'aNormal', 3);
  bufferOf(gl.ARRAY_BUFFER, geometry.uvs);
  attribute(meshProgram, 'aUv', 2);
  bufferOf(gl.ELEMENT_ARRAY_BUFFER, geometry.indices);
  const indexType = geometry.indices instanceof Uint16Array ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT;
  // A square, for the card, the fire and each ember.
  const squareArray = gl.createVertexArray();
  gl.bindVertexArray(squareArray);
  const square = bufferOf(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]));
  attribute(quadProgram, 'aCorner', 2);
  // The embers: one square each, with its place, size, turn, shape and strength.
  const SPARK = 8;
  const most = Math.ceil((index.sparks.embers.length + index.sparks.ash.length) * (1 + look.emberMore)) + 4 + look.burst;
  const sparkData = new Float32Array(most * SPARK);
  const sparkArray = gl.createVertexArray();
  gl.bindVertexArray(sparkArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, square);
  attribute(sparkProgram, 'aCorner', 2);
  const sparkBuffer = bufferOf(gl.ARRAY_BUFFER, sparkData, gl.DYNAMIC_DRAW);
  attribute(sparkProgram, 'aPlace', 4, SPARK * 4, 0, 1);
  attribute(sparkProgram, 'aLook', 4, SPARK * 4, 16, 1);
  gl.bindVertexArray(null);

  // The fire's own picture: drawn smaller than the canvas, then laid on it.
  const fireTexture = gl.createTexture();
  const fireTarget = gl.createFramebuffer();
  let fireW = 0;
  let fireH = 0;
  const fireSize = (): void => {
    const w = Math.max(1, Math.round(canvas.width * state.fire));
    const h = Math.max(1, Math.round(canvas.height * state.fire));
    if (w === fireW && h === fireH) return;
    fireW = w;
    fireH = h;
    gl.bindTexture(gl.TEXTURE_2D, fireTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fireTarget);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fireTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  // ---- where things lie ------------------------------------------------------------------------------
  /** Stage pixels to a sheet pixel, and the cut's corner in the canvas's own stage pixels. */
  const k = cut.w / index.cut.rect[2];
  const cutX = cut.x - box.x;
  const cutY = cut.y - box.y;
  /** A point of the sheets, in the canvas's stage pixels. */
  const onCanvas = (u: number, v: number): [number, number] => [cutX + (u - index.cut.rect[0]) * k, cutY + (v - index.cut.rect[1]) * (cut.h / index.cut.rect[3])];
  const fieldAt = onCanvas(index.field.box[0], index.field.box[1]);
  const fieldBox = [fieldAt[0], fieldAt[1], index.field.box[2] * k, index.field.box[3] * k] as const;
  const middle = onCanvas(index.fire.middle[0], index.fire.middle[1]);
  const outline = index.fire.outline.map(p => [...onCanvas(p[0] as number, p[1] as number), p[2] as number, p[3] as number] as const);
  const cellW = (index.sparks.cell[0] / index.sparks.scale) * k;
  const cellH = (index.sparks.cell[1] / index.sparks.scale) * k;
  /**
   * The lanes: for each ember and fleck he painted, where it leaves the outline (the outline's point nearest
   * it), where he painted it, the shape nearest its own in length and width, and that shape's size for it.
   */
  interface Lane {
    ash: boolean;
    fromX: number;
    fromY: number;
    x: number;
    y: number;
    shape: number;
    size: number;
  }
  const lanes: Lane[] = [];
  for (const [rows, kind] of [[index.sparks.embers, 'ember'], [index.sparks.ash, 'ash']] as const) {
    const shapes = index.sparks.shapes.map((sh, i) => ({ ...sh, i })).filter(sh => sh.kind === kind);
    if (shapes.length === 0) continue;
    rows.forEach((row, n) => {
      const [x, y] = onCanvas(row[0] as number, row[1] as number);
      let from = outline[0] as (typeof outline)[number];
      for (const q of outline) if (Math.hypot(q[0] - x, q[1] - y) < Math.hypot(from[0] - x, from[1] - y)) from = q;
      let shape = shapes[0] as (typeof shapes)[number];
      const unlike = (sh: (typeof shapes)[number]): number => Math.abs(sh.long - (row[2] as number)) + Math.abs(sh.wide - (row[3] as number));
      for (const sh of shapes) if (unlike(sh) < unlike(shape)) shape = sh;
      const lane: Lane = { ash: kind === 'ash', fromX: from[0], fromY: from[1], x, y, shape: shape.i, size: (row[2] as number) / shape.long };
      lanes.push(lane);
      // A second flier on some lanes, a little to one side.
      if (draw(o.seed, n, kind === 'ash' ? 91 : 90) < look.emberMore) lanes.push({ ...lane, x: x + (draw(o.seed, n, 92) - 0.5) * 30, y: y + (draw(o.seed, n, 93) - 0.5) * 30 });
    });
  }

  /**
   * Where a tongue of flame may stand: the outline's points in the sectors where the owner's fire stands tall (far
   * beyond its reach), on edges that face up or sideways; each with how tall his stands there (stage pixels) and a
   * weight for how often one rises there.
   */
  const feet: { x: number; y: number; high: number; upTo: number }[] = [];
  {
    const K = index.fire.core.length;
    let sum = 0;
    for (const q of outline) {
      const sector = Math.min(K - 1, Math.floor(((Math.atan2(q[1] - middle[1], q[0] - middle[0]) + Math.PI) / (2 * Math.PI)) * K));
      const reach = index.fire.reach[sector] as number;
      const tall = index.fire.tall[sector] as number;
      const stands = clamp01((tall - 1.75 * reach) / reach) * clamp01(0.4 - q[3] * 1.4);
      if (stands <= 0) continue;
      sum += stands * tall;
      feet.push({ x: q[0], y: q[1], high: tall * k, upTo: sum });
    }
  }
  const TONGUES = 6;
  const tongueA = new Float32Array(TONGUES * 4);
  const tongueB = new Float32Array(TONGUES * 4);

  // ---- its state, and the frame ----------------------------------------------------------------------
  let reduced = o.reduced;
  let paused = false;
  let raf = 0;
  let stood: number | null = null;
  let last = o.clock();
  let hot = false;
  const foot: [number, number] = [cutX + cut.w / 2, cutY + cut.h];
  let ignite: [number, number] = foot;
  let pressedAt: number | null = null;
  /** The clock when it last caught fire under the pointer. */
  let hotFrom = 0;
  let pulsedAt: number | null = null;
  let whenGone: (() => void) | null = null;
  /** The clock when it was last let alone (it teases after a while), and how much the tease burns in the frame in hand. */
  let aloneFrom = o.clock();
  const patches = new Float32Array(8);
  const span = Math.hypot(cut.w, cut.h);
  /** How much the fire burns at a place of the outline now: the hover's or the tease's spread from where it caught, and the smoulders. */
  const burnsAt = (x: number, y: number, burn: number): number => {
    let b = smooth(burn * 2.2 - (Math.hypot(x - ignite[0], y - ignite[1]) / span) * 1.2);
    for (let i = 0; i < 2; i++) {
      const level = patches[i * 4 + 3] as number;
      if (level > 0) b = Math.max(b, level * (1 - smooth((Math.hypot(x - (patches[i * 4] as number), y - (patches[i * 4 + 1] as number)) / (patches[i * 4 + 2] as number) - 0.4) / 0.6)));
    }
    return b;
  };
  let heldAim = 0;
  let aimX = 0;
  let aimY = 0;
  let turnX = 0;
  let turnY = 0;
  let pixels = 1;
  /** Each ember's place in the air is its own; whether one flies was settled when it was born. */
  const flies = new Uint8Array(most);
  const bornAt = new Int32Array(most).fill(-1);

  const uniform = (program: WebGLProgram, name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name);
  const bind = (unit: number, texture: WebGLTexture): void => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  };

  /** The graphics card's own time over a frame, where the browser gives it: one frame in forty is timed. */
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  let timing: WebGLQuery | null = null;
  let timed = 0;
  /** Nothing moved in the last frame drawn; and a count of the slow frames passed over. */
  let still = false;
  let passed = 0;
  let embersLast = 0;

  const frame = (t: number, must = false): void => {
    const began = performance.now();
    const dt = Math.min(0.1, Math.max(0, t - last));
    last = t;
    // It catches and dies down at its own paces; the turn and the hold ease.
    const want = hot ? 1 : 0;
    state.burn = want > state.burn ? Math.min(want, state.burn + dt / look.igniteS) : Math.max(want, state.burn - dt / look.coolS);
    // Left alone: the smoulders (each in a spell of the clock of its own, by the seed), the breath, and the tease.
    let burn = state.burn;
    let breath = 0;
    patches.fill(0);
    if (!reduced && !hot && state.burn < 0.02) {
      const spell = Math.floor(t / look.smoulderEvery);
      for (let j = 0; j < 2; j++) {
        const n = spell - j;
        if (n < 0 || draw(o.seed, n, 60) < 0.2 || feet.length === 0) continue;
        const lasts = mix(look.smoulderS[0], look.smoulderS[1], draw(o.seed, n, 61));
        const since = t - (n * look.smoulderEvery + draw(o.seed, n, 62) * look.smoulderEvery * 0.6);
        if (since < 0 || since > lasts) continue;
        const at = outline[Math.floor(draw(o.seed, n, 63) * outline.length * 0.62 + outline.length * 0.02)] as (typeof outline)[number];
        const level = mix(look.smoulderLevel[0], look.smoulderLevel[1], draw(o.seed, n, 64)) * smooth(since / 0.45) * (1 - smooth((since - (lasts - 0.8)) / 0.8));
        patches.set([at[0], at[1], mix(250, 340, draw(o.seed, n, 65)), level], j * 4);
      }
      breath = look.breath * Math.max(0, Math.sin((t * 2 * Math.PI) / look.breathS)) ** 2;
      const alone = t - aloneFrom - look.teaseAfter;
      if (alone >= 0) {
        const n = Math.floor(alone / look.teaseEvery);
        const since = alone - n * look.teaseEvery;
        // (A little more insistent each time, to a point.)
        const level = Math.min(0.95, look.teaseLevel + 0.05 * n);
        if (since < look.teaseS + 1) {
          ignite = foot;
          burn = Math.max(burn, level * smooth(since / 0.5) * (1 - smooth((since - look.teaseS * 0.55) / (look.teaseS * 0.45 + 1))));
        }
      }
    }
    if (hot || state.burn > 0.02) aloneFrom = t;
    // A press elsewhere: it flares for a moment, from its foot.
    if (pulsedAt !== null && pressedAt === null) {
      const since = t - pulsedAt;
      if (since >= 0 && since < 1 && state.burn < 0.5) {
        if (burn < 0.05) ignite = foot;
        burn = Math.max(burn, 0.6 * smooth(since / 0.08) * (1 - smooth((since - 0.15) / 0.8)));
      }
    }
    // The press: the whole of it alight at once, a flash, the fire flaring and then tearing away outward as the medallion goes.
    let flare = 1;
    let torn = 1;
    let shown = 1;
    let flash = 0;
    let blown = 1;
    /** Driven in: a quick push with the light dipping, and the flare comes out of it. */
    let driven = 0;
    if (pressedAt !== null) {
      const since = Math.max(0, t - pressedAt);
      burn = Math.max(burn, smooth(since / 0.1));
      flare = (1 + 1.3 * Math.exp(-since / 0.16)) * (1 - smooth((since - 0.22) / 0.6));
      torn = 1 + 0.9 * smooth(since / 0.5);
      shown = 1 - smooth((since - 0.12) / 0.5);
      driven = smooth(since / 0.07) * (1 - smooth((since - 0.07) / 0.13));
      flash = since < 0.06 ? 0 : Math.exp(-(since - 0.06) / 0.08);
      blown = 1 + 0.06 * smooth(since / 0.6);
      if (since > look.goneS && !state.gone) {
        state.gone = true;
        const told = whenGone;
        whenGone = null;
        told?.();
      }
    }
    const ease = 1 - Math.exp(-dt / look.easeS);
    state.held += (heldAim - state.held) * (1 - Math.exp(-dt / look.pressS));
    turnX += ((reduced ? 0 : aimY * state.burn) - turnX) * ease;
    turnY += ((reduced ? 0 : aimX * state.burn) - turnY) * ease;
    const angle = (look.turn * Math.PI) / 180;
    const ax = turnX * angle;
    const ay = turnY * angle;
    const [cx, sx, cy, sy] = [Math.cos(ax), Math.sin(ax), Math.cos(ay), Math.sin(ay)];
    // The model turned about its own x (toward the top or the foot) and then its y (toward a side): columns of the matrix.
    const turn = new Float32Array([cy, 0, -sy, sy * sx, cx, cy * sx, sy * cx, -sx, cy * cx]);
    // The sweep: across the metal from the upper left to the lower right, then a long rest.
    // (While it burns the sweeps are counted from when it caught.)
    const burning = hot && t >= hotFrom;
    const u = reduced ? -1 : burning ? ((t - hotFrom - look.sweepHotAfter + look.sweepHotEvery * 1000) % look.sweepHotEvery) / look.sweepS : ((t % look.sweepEvery) - (look.sweepEvery - look.sweepS)) / look.sweepS;
    state.sweeping = u >= 0 && u <= 1;
    const span = 0.62 * cut.w + look.sweepHigh * 0.6;
    const sweepAt = -span + 2 * span * clamp01(u);
    const sweepLight = state.sweeping ? look.sweepLight * Math.sin(Math.PI * clamp01(u)) ** 1.5 : 0;

    state.glow = Math.max(burn, breath, patches[3] as number, patches[7] as number);
    // Nothing has changed since the last frame: none is drawn. Only the slow breath moves: every third frame will do.
    const moving = burn > 0.001 || (patches[3] as number) > 0.001 || (patches[7] as number) > 0.001 || state.sweeping || pressedAt !== null || state.held > 0.002 || embersLast > 0 || Math.abs(turnX) + Math.abs(turnY) > 0.002 || (pulsedAt !== null && t - pulsedAt < 1.2);
    if (!moving && !must) {
      if (breath <= 0.001 && still) {
        state.rested++;
        return;
      }
      if (breath > 0.001 && still && ++passed % 3 !== 0) {
        state.rested++;
        return;
      }
      still = true;
    } else {
      still = false;
      // Left alone, what moves is slow (a low flame, a few embers drifting, the band of light): every other frame will do,
      // as the painting behind it has. Under the pointer, at the tease and at the press, every frame is drawn.
      if (!must && !hot && burn < 0.001 && pressedAt === null && ++passed % 2 === 1) {
        state.rested++;
        return;
      }
    }
    let timingNow = false;
    if (timer && timing === null && state.frames % 40 === 7) {
      timing = gl.createQuery();
      if (timing) {
        gl.beginQuery(timer.TIME_ELAPSED_EXT, timing);
        timingNow = true;
      }
    }

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);

    // 1. The fire.
    if (burn > 0.001 || breath > 0.001 || (patches[3] as number) > 0.001 || (patches[7] as number) > 0.001) {
      gl.useProgram(flameProgram);
      gl.bindVertexArray(squareArray);
      bind(0, fieldTexture);
      bind(1, rampTexture);
      bind(2, ringTexture);
      bind(3, shapeTexture);
      gl.uniform1i(uniform(flameProgram, 'uField'), 0);
      gl.uniform1i(uniform(flameProgram, 'uRamp'), 1);
      gl.uniform1i(uniform(flameProgram, 'uRing'), 2);
      gl.uniform1i(uniform(flameProgram, 'uShape'), 3);
      gl.uniform2f(uniform(flameProgram, 'uBox'), box.w, box.h);
      gl.uniform4f(uniform(flameProgram, 'uFieldBox'), ...fieldBox);
      gl.uniform3f(uniform(flameProgram, 'uRange'), index.field.reach * k, index.field.inside * k, reachMost * k);
      gl.uniform2f(uniform(flameProgram, 'uMiddle'), middle[0], middle[1]);
      gl.uniform3f(uniform(flameProgram, 'uIgnite'), ignite[0], ignite[1], Math.hypot(cut.w, cut.h));
      gl.uniform1f(uniform(flameProgram, 'uBurn'), burn);
      gl.uniform4fv(uniform(flameProgram, 'uPatch'), patches);
      gl.uniform1f(uniform(flameProgram, 'uBreath'), breath);
      gl.uniform3f(uniform(flameProgram, 'uFlare'), flare, torn, pressedAt === null ? 0 : 1.7 * smooth((t - pressedAt - 0.08) / 0.45));
      gl.uniform1f(uniform(flameProgram, 'uTime'), reduced ? 0 : t);
      gl.uniform1f(uniform(flameProgram, 'uRampSteps'), index.fire.ramp.length);
      gl.uniform1f(uniform(flameProgram, 'uTall'), tallMost * k);
      // Nothing burns farther off the outline than this (stage pixels): the fire is drawn only that far round the cut.
      const far = Math.max(tallMost * 1.15, reachMost * 3.8 * torn) * k;
      gl.uniform1f(uniform(flameProgram, 'uFar'), far);
      const scale = fireW / box.w;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fireTarget);
      gl.viewport(0, 0, fireW, fireH);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.BLEND);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(Math.floor((cutX - far - 4) * scale), Math.floor(fireH - (cutY + cut.h + far + 4) * scale), Math.ceil((cut.w + 2 * far + 8) * scale), Math.ceil((cut.h + 2 * far + 8) * scale));
      // The tongues: each rises in a round of its own, at a foot drawn anew each round; about half of them at a time.
      for (let i = 0; i < TONGUES; i++) {
        const round = mix(1.3, 2.4, draw(o.seed, i, 40));
        const turnOf = t / round + draw(o.seed, i, 41);
        const n = Math.floor(turnOf);
        const last = feet[feet.length - 1];
        const up = last && !reduced && draw(o.seed, i * 17 + 2, n) < 0.45;
        let stand = feet[0];
        if (last) {
          const pick = draw(o.seed, i * 17 + 1, n) * last.upTo;
          for (const f of feet) {
            stand = f;
            if (f.upTo >= pick) break;
          }
        }
        if (!up || !stand) {
          tongueB[i * 4 + 2] = 0;
          continue;
        }
        const lean = mix(0.12, 0.5, draw(o.seed, i * 17 + 4, n)) * (draw(o.seed, i * 17 + 5, n) < 0.8 ? 1 : -1);
        tongueA.set([stand.x, stand.y, stand.high * mix(0.6, 1.02, draw(o.seed, i * 17 + 3, n)), lean], i * 4);
        tongueB.set([turnOf - n, mix(3.2, 6.0, draw(o.seed, i * 17 + 6, n)), burnsAt(stand.x, stand.y, burn), i * 2.4], i * 4);
      }
      gl.uniform4fv(uniform(flameProgram, 'uTongueA'), tongueA);
      gl.uniform4fv(uniform(flameProgram, 'uTongueB'), tongueB);
      // (Drawn below, once everything it is told is set; then the whole canvas again.)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.SCISSOR_TEST);
      // Laid on the canvas.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.enable(gl.BLEND);
      gl.useProgram(quadProgram);
      bind(0, fireTexture as WebGLTexture);
      gl.uniform1i(uniform(quadProgram, 'uPicture'), 0);
      gl.uniform2f(uniform(quadProgram, 'uBox'), box.w, box.h);
      gl.uniform4f(uniform(quadProgram, 'uRect'), 0, 0, box.w, box.h);
      gl.uniform1f(uniform(quadProgram, 'uShown'), 1);
      gl.uniform1f(uniform(quadProgram, 'uTurned'), 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // 2. His medallion at rest, flat: gone as the model takes the ablaze sheet.
    gl.useProgram(quadProgram);
    gl.bindVertexArray(squareArray);
    bind(0, cardTexture);
    gl.uniform1i(uniform(quadProgram, 'uPicture'), 0);
    gl.uniform2f(uniform(quadProgram, 'uBox'), box.w, box.h);
    gl.uniform4f(uniform(quadProgram, 'uRect'), cutX, cutY, cut.w, cut.h);
    gl.uniform1f(uniform(quadProgram, 'uShown'), 1 - smooth(burn * 2.5));
    gl.uniform1f(uniform(quadProgram, 'uTurned'), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 3. His model, with his paintings laid on it.
    gl.useProgram(meshProgram);
    gl.bindVertexArray(meshArray);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    bind(0, cardTexture);
    bind(1, ablazeTexture);
    bind(2, reliefTexture);
    gl.uniform1i(uniform(meshProgram, 'uCard'), 0);
    gl.uniform1i(uniform(meshProgram, 'uAblaze'), 1);
    gl.uniform1i(uniform(meshProgram, 'uRelief'), 2);
    gl.uniform2f(uniform(meshProgram, 'uBox'), box.w, box.h);
    gl.uniform4f(uniform(meshProgram, 'uCut'), cutX, cutY, cut.w, cut.h);
    gl.uniform1f(uniform(meshProgram, 'uDepth'), index.model.depth * k);
    gl.uniformMatrix3fv(uniform(meshProgram, 'uTurn'), false, turn);
    gl.uniform1f(uniform(meshProgram, 'uScale'), (1 - look.press * 0.4 * state.held - 0.09 * driven) * blown);
    gl.uniform3f(uniform(meshProgram, 'uGoing'), shown, flash, driven);
    gl.uniform1f(uniform(meshProgram, 'uPush'), look.press * cut.w * state.held + 0.05 * cut.w * driven);
    gl.uniform1f(uniform(meshProgram, 'uBurn'), burn);
    gl.uniform3f(uniform(meshProgram, 'uIgnite'), ignite[0], ignite[1], Math.hypot(cut.w, cut.h));
    gl.uniform1f(uniform(meshProgram, 'uTime'), reduced ? 0 : t);
    gl.uniform4f(uniform(meshProgram, 'uSweep'), Math.cos(-0.35), Math.sin(-0.35), sweepAt, sweepLight);
    gl.uniform1f(uniform(meshProgram, 'uSweepHigh'), look.sweepHigh);
    gl.uniform2f(uniform(meshProgram, 'uSurge'), state.sweeping ? look.surge * Math.sin(Math.PI * clamp01(u)) ** 0.7 : 0, look.surgeWide);
    gl.uniform4f(uniform(meshProgram, 'uPointer'), (aimX * cut.w) / 2, (-aimY * cut.h) / 2, look.pointerHigh, reduced ? 0 : look.pointerLight * state.burn);
    if (shown < 1) {
      // Going: only its nearest surfaces are drawn (their heights first, then their colour where the height is theirs), over the fire behind.
      gl.colorMask(false, false, false, false);
      gl.drawElements(gl.TRIANGLES, geometry.indices.length, indexType, 0);
      gl.colorMask(true, true, true, true);
      gl.depthFunc(gl.EQUAL);
      gl.enable(gl.BLEND);
    }
    if (shown > 0.002) gl.drawElements(gl.TRIANGLES, geometry.indices.length, indexType, 0);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);

    // 4. The embers and the ash. Each flies its lane in a round of its own, again and again: out of the outline,
    // fast and then slowing, through the place the owner painted it (at a moment of its flight that is the
    // lane's own), carried up as it goes, and on a little way as it fades. So a frame at full burn holds about
    // his embers, about where he has them, at about his sizes.
    let count = 0;
    if (!reduced) {
      const path = (lane: Lane, part: number, at: number, life: number, i: number, out: [number, number]): void => {
        const gone = (1 - (1 - part) ** 1.7) / (1 - (1 - at) ** 1.7);
        const side = Math.sin(part * 5 + i) - Math.sin(at * 5 + i);
        const lift = look.emberRise * life * (part * part - at * at) * (lane.ash ? 0.4 : 1);
        const dx = lane.x - lane.fromX;
        const dy = lane.y - lane.fromY;
        const far = Math.hypot(dx, dy) || 1;
        out[0] = lane.fromX + dx * gone - (dy / far) * side * 5 + (lane.ash ? 18 * life * (part - at) : 0);
        out[1] = lane.fromY + dy * gone + (dx / far) * side * 5 - lift;
      };
      const here: [number, number] = [0, 0];
      const next: [number, number] = [0, 0];
      for (let i = 0; i < lanes.length && count < most; i++) {
        const lane = lanes[i] as Lane;
        const life = mix(look.emberLife[0], look.emberLife[1], draw(o.seed, i, 1)) * (lane.ash ? look.ashLife : 1);
        const turnOf = t / life + draw(o.seed, i, 2);
        const born = Math.floor(turnOf);
        const part = turnOf - born;
        if (bornAt[i] !== born) {
          bornAt[i] = born;
          flies[i] = pressedAt === null && draw(o.seed, i * 131 + 7, born) < burnsAt(lane.fromX, lane.fromY, burn) ** 2 * (burn > 0.02 ? 1 : 2.2) ? 1 : 0;
        }
        if (!flies[i]) continue;
        const at = mix(0.3, 0.58, draw(o.seed, i, 3));
        path(lane, part, at, life, i, here);
        path(lane, part + 0.02, at, life, i, next);
        const fast = Math.hypot(next[0] - here[0], next[1] - here[1]) || 1;
        const size = lane.size * ((1 - 0.5 * part) / (1 - 0.5 * at));
        const flicker = lane.ash ? 1 : 0.8 + 0.2 * Math.sin(part * life * (9 + 7 * draw(o.seed, i, 5)) + i * 1.7);
        const shown = smooth(part / 0.07) * (1 - smooth((part - 0.62) / 0.38)) * flicker;
        sparkData.set([here[0], here[1], cellW * size, cellH * size, (next[0] - here[0]) / fast, (next[1] - here[1]) / fast, lane.shape, shown], count * SPARK);
        count++;
      }
      // The press's ring: embers thrown out of the whole outline at once, fast, slowing and falling a little, soon gone.
      if (pressedAt !== null) {
        const since = t - pressedAt - 0.03;
        const shapes = index.sparks.shapes.map((sh, i) => ({ ...sh, i })).filter(sh => sh.kind === 'ember');
        for (let j = 0; j < look.burst && since > 0 && count < most && shapes.length > 0; j++) {
          const life = mix(look.burstLife[0], look.burstLife[1], draw(o.seed, j, 71));
          if (since > life) continue;
          const part = since / life;
          const at = outline[Math.floor(draw(o.seed, j, 72) * outline.length)] as (typeof outline)[number];
          const lean = (draw(o.seed, j, 73) - 0.5) * 0.9;
          const ox = at[2] * Math.cos(lean) - at[3] * Math.sin(lean);
          const oy = at[2] * Math.sin(lean) + at[3] * Math.cos(lean);
          const speed = mix(look.burstSpeed[0], look.burstSpeed[1], draw(o.seed, j, 74) ** 1.5);
          // (It slows: the way gone is the speed's sum as it dies away.)
          const way = (speed * (1 - Math.exp(-2.4 * since))) / 2.4;
          const vx = ox * speed * Math.exp(-2.4 * since);
          const vy = oy * speed * Math.exp(-2.4 * since) + 260 * since;
          const fast = Math.hypot(vx, vy) || 1;
          const shape = shapes[Math.floor(draw(o.seed, j, 75) * shapes.length)] as (typeof shapes)[number];
          const size = mix(1.0, 2.3, draw(o.seed, j, 76)) * (1 - 0.5 * part);
          sparkData.set([at[0] + ox * way, at[1] + oy * way + 130 * since * since, cellW * size, cellH * size, vx / fast, vy / fast, shape.i, smooth(part / 0.05) * (1 - smooth((part - 0.4) / 0.6))], count * SPARK);
          count++;
        }
      }
      gl.useProgram(sparkProgram);
      gl.bindVertexArray(sparkArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, sparkBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, sparkData, 0, count * SPARK);
      bind(0, sparksTexture);
      gl.uniform1i(uniform(sparkProgram, 'uShapes'), 0);
      gl.uniform2f(uniform(sparkProgram, 'uBox'), box.w, box.h);
      gl.uniform2f(uniform(sparkProgram, 'uGrid'), index.sparks.columns, index.sparks.rows);
      if (count > 0) gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    }
    state.embers = count;
    embersLast = count;
    gl.bindVertexArray(null);
    if (timer && timingNow) gl.endQuery(timer.TIME_ELAPSED_EXT);
    else if (timer && timing !== null && gl.getQueryParameter(timing, gl.QUERY_RESULT_AVAILABLE)) {
      if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) {
        const ms = (gl.getQueryParameter(timing, gl.QUERY_RESULT) as number) / 1e6;
        timed++;
        state.gpuMs = state.gpuMs < 0 ? ms : state.gpuMs + (ms - state.gpuMs) / Math.min(timed, 20);
      }
      gl.deleteQuery(timing);
      timing = null;
    }

    state.frames++;
    const took = performance.now() - began;
    state.drawMs = state.frames < 3 ? took : state.drawMs + (took - state.drawMs) / Math.min(state.frames, 120);
    if (state.frames > 10) state.drawMsMost = Math.max(state.drawMsMost, took);
  };

  /**
   * When frames run long while it burns (the page's own frames come more than 24 ms apart for a second and more),
   * the canvas is given fewer pixels each way (three quarters, then a half): the fire is soft and the medallion
   * small on a screen that struggles, and it keeps its pace. It is not given them back.
   */
  let lastTick = 0;
  let slow = 0;
  const tick = (now: number): void => {
    raf = 0;
    if (disposed || paused || document.hidden || stood !== null) return;
    const gap = now - lastTick;
    lastTick = now;
    if (state.burn > 0.5 && gap > 24 && gap < 200) slow++;
    else if (gap <= 24) slow = Math.max(0, slow - 2);
    if (slow > 45 && state.detail > 0.5) {
      slow = 0;
      // First the fire is drawn smaller still; then the whole canvas.
      if (state.fire > 0.34) state.fire = 1 / 3;
      else state.detail = state.detail > 0.75 ? 0.75 : 0.5;
      size();
    }
    frame(o.clock());
    raf = requestAnimationFrame(tick);
  };
  const wake = (): void => {
    if (disposed || paused || raf !== 0 || document.hidden || stood !== null) return;
    last = o.clock();
    raf = requestAnimationFrame(tick);
  };
  const visibility = (): void => {
    if (document.hidden && raf !== 0) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else wake();
  };
  document.addEventListener('visibilitychange', visibility);

  const size = (): void => {
    const w = Math.max(1, Math.round(box.w * pixels * state.detail));
    const h = Math.max(1, Math.round(box.h * pixels * state.detail));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    fireSize();
  };
  size();
  frame(o.clock(), true);
  state.ready = true;
  wake();

  return {
    state,
    resize(p) {
      pixels = p > 0 ? p : 1;
      size();
      frame(stood ?? o.clock(), true);
    },
    hot(on, x, y) {
      if (on && !hot && state.burn < 0.05) ignite = [cutX + x, cutY + y];
      if (on && !hot) hotFrom = stood ?? o.clock();
      hot = on;
    },
    aim(x, y) {
      aimX = Math.max(-1, Math.min(1, x));
      aimY = Math.max(-1, Math.min(1, y));
    },
    down(on) {
      heldAim = on ? 1 : 0;
    },
    press(gone) {
      if (pressedAt !== null) return;
      pressedAt = stood ?? o.clock();
      whenGone = gone;
      hot = false;
    },
    pulse() {
      pulsedAt = stood ?? o.clock();
    },
    reduce(on) {
      reduced = on;
    },
    pause(on) {
      paused = on;
      if (on && raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else wake();
    },
    stand(t) {
      stood = t;
      if (t === null) wake();
      else {
        if (raf !== 0) cancelAnimationFrame(raf);
        raf = 0;
        frame(t, true);
      }
    },
    dispose() {
      disposed = true;
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
      document.removeEventListener('visibilitychange', visibility);
      for (const t of textures) gl.deleteTexture(t);
      gl.deleteTexture(fireTexture);
      gl.deleteFramebuffer(fireTarget);
      for (const b of buffers) gl.deleteBuffer(b);
      for (const a of [meshArray, squareArray, sparkArray]) gl.deleteVertexArray(a);
      for (const p of [meshProgram, quadProgram, flameProgram, sparkProgram]) gl.deleteProgram(p);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
