/**
 * The briefing room's live light: the film on the pull-down screen, the projector's beam through the room's smoke,
 * the ceiling lamp's cone, the dust in the beam. One canvas over the owner's painted room (premultiplied: light adds
 * to the painting, smoke veils it), under his projector, bar, clipboard and plates.
 *
 * Everything that moves is a plain function of the room's clock and a seed: the same moment is always the same
 * picture, and any moment can be drawn by itself (`at`, for captures). The clock runs only while the room shows and
 * the page is visible. The lamp's flutter is a sum of sines at the clatter's rate (never random steps), and the
 * beam's strength follows the film's own brightness (the loop's track, client/src/campaign/film.ts) as well.
 *
 * Fetched with the room, never with the title. Nothing here reads a pixel back.
 */
import { lumaAt } from './film';
import { flutter } from './flutter';
import type { FilmLoop } from './film';
import { AIR_FS, AIR_OVER_FS, FILM_FS, FULL_VS, MOTE_FS, MOTE_VS, PART_FS, PART_VS, RECT_VS, SPRITE_FS } from './roomfxshaders';

/** The stage, in its own pixels (the owner's art). */
const STAGE: readonly [number, number] = [2752, 1536];

export interface RoomLook {
  /** The film's picture on the pull-down screen: x, y, width, height (stage pixels). */
  readonly picture: readonly [number, number, number, number];
  /** The whole pull-down screen, its paper and its roller: dimmed a little round the picture while the film runs. */
  readonly screen: readonly [number, number, number, number];
  /** The front of the projector's lens. */
  readonly lens: readonly [number, number];
  /** The ceiling lamp's rim, and how strongly its cone shows in the smoke. */
  readonly lamp: readonly [number, number, number];
}

/** A cut of the owner's painting: its bundled address and its place on the stage (x, y, width, height). */
export interface RoomCut {
  readonly address: string;
  readonly place: readonly [number, number, number, number];
}

/** The layers of his painting the light is laid between (assets/campaign/v1/, tools/campaignart/). */
export interface RoomLayers {
  /** The room's depth: white the back of the room, black the table and what stands on it, grey between. */
  readonly far: string;
  /** The screen's paper where the film falls. */
  readonly paper: RoomCut;
  /** The projector's body, without its reels. */
  readonly body: RoomCut;
  /** The projector's moving parts: a binary glTF file (tools/campaignart/build_reels.py). */
  readonly reels: string;
}

/**
 * A reel as his painting has it: where its middle stands (stage pixels), its rim's radius, how far its axis is
 * turned from the viewer (radians, about the upright), how much film it holds (the pack's radius, of the rim's), and
 * the way it turns (1 counter-clockwise as seen, -1 clockwise).
 */
export interface ReelLook {
  readonly at: readonly [number, number];
  readonly radius: number;
  readonly yaw: number;
  readonly film: number;
  readonly sense: 1 | -1;
  /** The film's straight run to or from this reel, in the reel's own plane (the rim's radius is 1): from, to. */
  readonly run: readonly [readonly [number, number], readonly [number, number]];
}

/** The mechanism as the room shows it. */
export interface MechanismLook {
  /** The front reel stands in front of the projector's body, the rear reel behind its arm. */
  readonly front: ReelLook;
  readonly rear: ReelLook;
  /** The film's speed, stage pixels a second: each reel turns at this over its pack's radius. */
  readonly speed: number;
  /** The feed sprocket on the lamp house: its place and radius. */
  readonly sprocket: readonly [number, number, number];
}

export interface RoomFxOptions {
  readonly canvas: HTMLCanvasElement;
  readonly look: RoomLook;
  readonly layers: RoomLayers;
  readonly mechanism: MechanismLook;
  readonly film: FilmLoop | null;
  /** The viewer asks for less motion: a still on the screen, a steady beam, drawn once. */
  readonly reduced: boolean;
  readonly seed: number;
  /** The projector's clatter, clicks a second: the lamp flutters at this rate, so that sight and sound agree. */
  readonly clatterHz: number;
}

export interface RoomFxState {
  readonly running: boolean;
  readonly frames: number;
  /** The graphics card's milliseconds for the last frame timed (-1: not timed here). */
  readonly gpuMs: number;
  /** The room's clock, seconds. */
  readonly time: number;
  /** The film: not asked for, waiting for its first frame, playing, or a still. */
  readonly film: 'none' | 'waiting' | 'playing' | 'still';
  /** The film's own clock, seconds into the loop. */
  readonly filmTime: number;
  /** The beam's strength as last drawn (1 is its rest). */
  readonly beam: number;
  readonly pixels: readonly [number, number];
  /** His painting's layers have all come. */
  readonly layers: boolean;
  /** The mechanism's parts that have come, by name. */
  readonly parts: readonly string[];
}

export interface RoomFx {
  /** The stage has a new size in the display's pixels. */
  resize(pixels: readonly [number, number]): void;
  /** The room shows (true) or is covered (false: its clock stands, the film pauses, nothing is drawn). */
  run(on: boolean): void;
  /** For captures: the clock stands at `t` seconds, the film at the same, and that moment is drawn; null lets it run again. */
  at(t: number | null): Promise<void>;
  state(): RoomFxState;
  dispose(): void;
}

/** A whole number from a seed and two tags: the hash every seeded thing here is drawn by. */
function mix32(seed: number, a: number, b: number): number {
  let h = (seed ^ Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

const MOTES = 150;

export function startRoomFx(o: RoomFxOptions): RoomFx | null {
  const { canvas, look, film, reduced } = o;
  const context = canvas.getContext('webgl2', { alpha: true, antialias: false, premultipliedAlpha: true, depth: false, powerPreference: 'default' });
  if (!context) return null;
  const gl: WebGL2RenderingContext = context;

  const compile = (type: number, source: string): WebGLShader => {
    const s = gl.createShader(type) as WebGLShader;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`the room's light: a shader did not compile: ${gl.getShaderInfoLog(s) ?? ''}`);
    return s;
  };
  const program = (vs: string, fs: string): { p: WebGLProgram; u(name: string): WebGLUniformLocation | null } => {
    const p = gl.createProgram() as WebGLProgram;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`the room's light: a program did not link: ${gl.getProgramInfoLog(p) ?? ''}`);
    const found = new Map<string, WebGLUniformLocation | null>();
    return {
      p,
      u(name) {
        if (!found.has(name)) found.set(name, gl.getUniformLocation(p, name));
        return found.get(name) ?? null;
      },
    };
  };

  let air: ReturnType<typeof program>;
  let over: ReturnType<typeof program>;
  let filmP: ReturnType<typeof program>;
  let mote: ReturnType<typeof program>;
  let sprite: ReturnType<typeof program>;
  let part: ReturnType<typeof program>;
  try {
    sprite = program(RECT_VS, SPRITE_FS);
    part = program(PART_VS, PART_FS);
    air = program(FULL_VS, AIR_FS);
    over = program(FULL_VS, AIR_OVER_FS);
    filmP = program(RECT_VS, FILM_FS);
    mote = program(MOTE_VS, MOTE_FS);
  } catch (err) {
    console.warn(err instanceof Error ? err.message : String(err));
    return null;
  }

  // A square, corner by corner.
  const square = gl.createVertexArray();
  gl.bindVertexArray(square);
  const corners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // The motes: four numbers each, drawn from the seed.
  const dust = gl.createVertexArray();
  gl.bindVertexArray(dust);
  const seeds = new Float32Array(MOTES * 4);
  for (let i = 0; i < MOTES; i++) for (let k = 0; k < 4; k++) seeds[i * 4 + k] = mix32(o.seed, i, k + 11) / 4294967296;
  const seedBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, seedBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // The noise picture: four unrelated values a texel, tiling.
  const noise = gl.createTexture();
  {
    const size = 256;
    const bytes = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      const h = mix32(o.seed, i, 3);
      bytes[i * 4] = h & 255;
      bytes[i * 4 + 1] = (h >>> 8) & 255;
      bytes[i * 4 + 2] = (h >>> 16) & 255;
      bytes[i * 4 + 3] = (h >>> 24) & 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, noise);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }

  // The layers of his painting: each is used once it has come (until the depth has, no air is drawn: smoke over the
  // table would be worse than none).
  let disposed = false;
  const layer = (address: string, premultiplied: boolean, fill: readonly [number, number, number, number]): { texture: WebGLTexture | null; ready: boolean } => {
    const held = { texture: gl.createTexture(), ready: false };
    gl.bindTexture(gl.TEXTURE_2D, held.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(fill));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const picture = new Image();
    picture.decoding = 'async';
    picture.onload = () => {
      if (disposed) return;
      gl.bindTexture(gl.TEXTURE_2D, held.texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiplied);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, picture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      held.ready = true;
      if (!running || frozen !== null || reduced) drawNow();
    };
    picture.src = address;
    return held;
  };
  const far = layer(o.layers.far, false, [0, 0, 0, 255]);
  const paper = layer(o.layers.paper.address, false, [150, 146, 134, 255]);
  const body = layer(o.layers.body.address, true, [0, 0, 0, 0]);

  // The mechanism's parts, by name, once the model has come.
  interface Held { vao: WebGLVertexArrayObject | null; count: number; type: number }
  const parts = new Map<string, Held>();
  void fetch(o.layers.reels).then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`the projector's model: ${r.status}`)))).then(
    bytes => {
      if (disposed) return;
      const view = new DataView(bytes);
      if (view.getUint32(0, true) !== 0x46546c67) throw new Error("the projector's model is not a binary glTF file");
      const jsonLength = view.getUint32(12, true);
      const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLength))) as {
        nodes: { name?: string; mesh?: number }[];
        meshes: { primitives: { attributes: Record<string, number>; indices: number }[] }[];
        accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number }[];
        bufferViews: { byteOffset?: number; byteLength: number }[];
      };
      const bin = 20 + jsonLength + 8;
      const piece = (accessor: number | undefined, size: number): ArrayBuffer => {
        const a = accessor === undefined ? undefined : json.accessors[accessor];
        const v = a ? json.bufferViews[a.bufferView] : undefined;
        if (!a || !v) throw new Error("the projector's model lacks a part");
        const from = bin + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
        return bytes.slice(from, from + a.count * size);
      };
      for (const node of json.nodes) {
        const prim = node.mesh === undefined ? undefined : json.meshes[node.mesh]?.primitives[0];
        if (!node.name || !prim) continue;
        const idx = json.accessors[prim.indices];
        if (!idx) continue;
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        [['POSITION', 3], ['NORMAL', 3], ['TEXCOORD_0', 2]].forEach(([name, n], at) => {
          gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(piece(prim.attributes[name as string], (n as number) * 4)), gl.STATIC_DRAW);
          gl.enableVertexAttribArray(at);
          gl.vertexAttribPointer(at, n as number, gl.FLOAT, false, 0, 0);
        });
        const wide = idx.componentType !== 5123;
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, wide ? new Uint32Array(piece(prim.indices, 4)) : new Uint16Array(piece(prim.indices, 2)), gl.STATIC_DRAW);
        gl.bindVertexArray(null);
        parts.set(node.name, { vao, count: idx.count, type: wide ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT });
      }
      if (!running || frozen !== null || reduced) drawNow();
    },
  ).catch((err: unknown) => console.warn(err instanceof Error ? err.message : String(err)));

  // The mechanism is drawn by itself into a small picture with smoothed edges and its own depth (its box on the stage,
  // at the canvas's own scale), and that picture laid on the room: the canvas itself needs neither.
  const MECH_BOX: readonly [number, number, number, number] = [1548, 604, 324, 208];
  const mechTarget = gl.createFramebuffer();
  const mechColour = gl.createRenderbuffer();
  const mechDepth = gl.createRenderbuffer();
  const mechOut = gl.createFramebuffer();
  const mechTex = gl.createTexture();
  let mechSize: [number, number] = [1, 1];
  const sizeMech = (scale: number): void => {
    mechSize = [Math.max(1, Math.ceil(MECH_BOX[2] * scale)), Math.max(1, Math.ceil(MECH_BOX[3] * scale))];
    const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number);
    gl.bindRenderbuffer(gl.RENDERBUFFER, mechColour);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, mechSize[0], mechSize[1]);
    gl.bindRenderbuffer(gl.RENDERBUFFER, mechDepth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT16, mechSize[0], mechSize[1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, mechTarget);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, mechColour);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, mechDepth);
    gl.bindTexture(gl.TEXTURE_2D, mechTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, mechSize[0], mechSize[1], 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, mechOut);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, mechTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  /** Draws a group of parts into the mechanism's picture and lays it on the room (the canvas is left bound, blending). */
  function mechanism(light: readonly [number, number, number], group: () => void): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, mechTarget);
    gl.viewport(0, 0, mechSize[0], mechSize[1]);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(part.p);
    gl.uniform4f(part.u('uRect'), MECH_BOX[0], MECH_BOX[1], MECH_BOX[2], MECH_BOX[3]);
    gl.uniform3f(part.u('uLight'), light[0], light[1], light[2]);
    group();
    gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, mechTarget);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, mechOut);
    gl.blitFramebuffer(0, 0, mechSize[0], mechSize[1], 0, 0, mechSize[0], mechSize[1], gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, pixels[0], pixels[1]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(sprite.p);
    gl.uniform2f(sprite.u('uBox'), STAGE[0], STAGE[1]);
    gl.uniform4f(sprite.u('uRect'), MECH_BOX[0], MECH_BOX[1], MECH_BOX[2], MECH_BOX[3]);
    gl.uniform3f(sprite.u('uTint'), 1, 1, 1);
    gl.uniform1f(sprite.u('uTurned'), 1);
    // (Softened by about a stage pixel either way.)
    gl.uniform2f(sprite.u('uSoft'), 1.1 / MECH_BOX[2], 1.1 / MECH_BOX[3]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, mechTex);
    gl.uniform1i(sprite.u('uPicture'), 0);
    gl.bindVertexArray(square);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** The turn of a wheel: about its own axis by `spin`, then its axis turned from the viewer by `yaw` (column-major). */
  const turnOf = (yaw: number, spin: number): Float32Array => {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cs = Math.cos(spin), ss = Math.sin(spin);
    // Ry(yaw) * Rz(spin)
    return new Float32Array([cy * cs, ss, -sy * cs, -cy * ss, cs, sy * ss, sy, 0, cy]);
  };
  const mech = o.mechanism;
  /** Draws one part: turned, scaled (its own x, y, z) and set at a place of the stage. */
  function drawPart(name: string, turn: Float32Array, at: readonly [number, number, number], scale: readonly [number, number, number], run: readonly [number, number]): void {
    const held = parts.get(name);
    if (!held) return;
    gl.uniformMatrix3fv(part.u('uTurn'), false, turn);
    gl.uniform3f(part.u('uPlace'), at[0], at[1], at[2]);
    gl.uniform3f(part.u('uScale'), scale[0], scale[1], scale[2]);
    gl.uniform2f(part.u('uRun'), run[0], run[1]);
    gl.bindVertexArray(held.vao);
    gl.drawElements(gl.TRIANGLES, held.count, held.type, 0);
  }
  /** A reel with its film and the film's run to it, at the clock's `t`. */
  function drawReel(name: string, reel: ReelLook, t: number): void {
    const spin = reduced ? 0.4 : reel.sense * (mech.speed / (reel.film * reel.radius)) * t;
    const r = reel.radius;
    const middle: [number, number, number] = [reel.at[0], reel.at[1], 0];
    drawPart(name, turnOf(reel.yaw, spin), middle, [r, r, r], [0, 0]);
    drawPart('pack', turnOf(reel.yaw, spin), middle, [r * reel.film, r * reel.film, r], [0, 0]);
    // The run: the strip's own +X laid from `from` to `to` in the reel's plane.
    const [from, to] = reel.run;
    const dx = to[0] - from[0], dy = to[1] - from[1];
    const length = Math.hypot(dx, dy);
    const turn = turnOf(reel.yaw, Math.atan2(dy, dx));
    const cy = Math.cos(reel.yaw), sy = Math.sin(reel.yaw);
    // Where `from` stands: the reel's plane turned by its yaw (across the stage, down it, and toward the viewer).
    const start: [number, number, number] = [reel.at[0] + from[0] * r * cy, reel.at[1] - from[1] * r, -from[0] * r * sy];
    // A perforation every 9 stage pixels, going by at the film's speed.
    drawPart('strip', turn, start, [length * r, r, r], [(length * r) / 9, reduced ? 0 : ((mech.speed / 9) * t) % 1024]);
  }

  // The film's frame: a plain grey until the still or the first frame comes.
  const filmTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, filmTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([70, 66, 60, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  /** The film's own shape, width over height. */
  let filmShape = 640 / 368;
  const filmFrom = (source: TexImageSource, w: number, h: number): void => {
    if (w > 0 && h > 0) filmShape = w / h;
    gl.bindTexture(gl.TEXTURE_2D, filmTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
  };

  let filmState: RoomFxState['film'] = film ? 'waiting' : 'none';
  /** How far the film's picture has come in on the screen, 0 to 1. */
  let shown = 0;
  let video: HTMLVideoElement | null = null;
  let uploadedAt = -1;
  if (film) {
    // The still first: it is on the screen until the loop's first frame (and is all there is with less motion).
    const still = new Image();
    still.decoding = 'async';
    still.onload = () => {
      if (disposed || filmState === 'playing') return;
      filmFrom(still, still.naturalWidth, still.naturalHeight);
      if (reduced) filmState = 'still';
      shown = Math.max(shown, reduced ? 1 : 0.0001);
      if (!running || frozen !== null || reduced) drawNow();
    };
    still.src = film.still;
    if (!reduced) {
      video = document.createElement('video');
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.setAttribute('aria-hidden', 'true');
      video.src = video.canPlayType('video/webm; codecs="vp9"') !== '' ? film.webm : film.mp4;
    }
  }

  // The air is drawn small.
  const airTex = gl.createTexture();
  const airBuffer = gl.createFramebuffer();
  let airSize: [number, number] = [1, 1];
  let pixels: [number, number] = [canvas.width, canvas.height];
  const sizeAir = (): void => {
    airSize = [Math.max(1, Math.ceil(pixels[0] / 2)), Math.max(1, Math.ceil(pixels[1] / 2))];
    gl.bindTexture(gl.TEXTURE_2D, airTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, airSize[0], airSize[1], 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, airBuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, airTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  sizeAir();
  sizeMech(Math.max(0.05, pixels[0] / STAGE[0]));

  // The graphics card's own time for a frame, where the browser lets it be measured (for checks; -1: not timed here).
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  let timing: WebGLQuery | null = null;
  let timed: WebGLQuery | null = null;
  let gpuMs = -1;

  let running = false;
  let frozen: number | null = null;
  let clock = 0;
  let last = 0;
  let raf = 0;
  let frames = 0;
  let beamNow = 1;

  const [px, py, pw, ph] = look.picture;

  function draw(t: number): void {
    if (disposed) return;
    if (timer) {
      if (timed && gl.getQueryParameter(timed, gl.QUERY_RESULT_AVAILABLE)) {
        if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) gpuMs = (gl.getQueryParameter(timed, gl.QUERY_RESULT) as number) / 1e6;
        gl.deleteQuery(timed);
        timed = null;
      }
      if (!timed) {
        timing = gl.createQuery();
        if (timing) gl.beginQuery(timer.TIME_ELAPSED_EXT, timing);
      }
    }
    const filmT = video && filmState === 'playing' ? video.currentTime : film ? t % film.seconds : 0;
    // A new frame of the film, when there is one.
    if (video && video.readyState >= 2 && video.currentTime !== uploadedAt) {
      filmFrom(video, video.videoWidth, video.videoHeight);
      uploadedAt = video.currentTime;
      filmState = 'playing';
    }
    const wave = reduced ? 0 : flutter(t, o.clatterHz);
    const bright = film && filmState !== 'none' ? 0.6 + 0.8 * Math.min(1.15, lumaAt(film, filmT) / 0.42) : 1;
    beamNow = (1 + wave) * bright * (film ? Math.min(1, 0.35 + 0.65 * shown) : 1);
    const frame = film ? Math.floor(filmT * film.fps) : 0;

    // The air, small.
    gl.bindFramebuffer(gl.FRAMEBUFFER, airBuffer);
    gl.viewport(0, 0, airSize[0], airSize[1]);
    gl.disable(gl.BLEND);
    gl.useProgram(air.p);
    gl.uniform2f(air.u('uBox'), STAGE[0], STAGE[1]);
    gl.uniform1f(air.u('uTime'), t);
    gl.uniform4f(air.u('uBeam'), beamNow, wave / 0.3, shown, reduced ? 0 : Math.sin(2 * Math.PI * o.clatterHz * t + 0.9));
    gl.uniform2f(air.u('uLens'), look.lens[0], look.lens[1]);
    gl.uniform4f(air.u('uPic'), px, py, pw, ph);
    gl.uniform3f(air.u('uLamp'), look.lamp[0], look.lamp[1], look.lamp[2]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, noise);
    gl.uniform1i(air.u('uNoise'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, filmTex);
    gl.uniform1i(air.u('uFilm'), 1);
    gl.bindVertexArray(square);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // The room's canvas: the film on the screen, the air over it, the dust.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, pixels[0], pixels[1]);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    if (film && shown > 0 && paper.ready) {
      gl.useProgram(filmP.p);
      gl.uniform2f(filmP.u('uBox'), STAGE[0], STAGE[1]);
      gl.uniform4f(filmP.u('uRect'), look.screen[0] - 4, look.screen[1] - 4, look.screen[2] + 8, look.screen[3] + 8);
      gl.uniform4f(filmP.u('uScreen'), look.screen[0], look.screen[1], look.screen[2], look.screen[3]);
      gl.uniform4f(filmP.u('uPaperRect'), o.layers.paper.place[0], o.layers.paper.place[1], o.layers.paper.place[2], o.layers.paper.place[3]);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, paper.texture);
      gl.uniform1i(filmP.u('uPaper'), 1);
      gl.uniform4f(filmP.u('uPic'), px, py, pw, ph);
      // The gate's weave: a slow wander and a small jump on every frame of the film.
      const jx = reduced ? 0 : 0.55 * Math.sin(t * 6.9) + 0.3 * Math.sin(t * 20.7 + 1) + ((mix32(o.seed, frame, 1) / 4294967296) - 0.5) * 0.9;
      const jy = reduced ? 0 : 1.0 * Math.sin(t * 4.4 + 0.7) + ((mix32(o.seed, frame, 2) / 4294967296) - 0.5) * 1.7;
      gl.uniform4f(filmP.u('uGate'), jx, jy, (1 + wave * 0.75) * (0.86 + 0.14 * shown), frame);
      // A dark shot is printed a little lighter, a bright one a little darker (the loop's own brightness track).
      const exposure = Math.max(0.9, Math.min(2.3, 0.44 / Math.max(0.08, lumaAt(film, filmT))));
      gl.uniform2f(filmP.u('uShow'), Math.min(1, shown), exposure);
      // The film fills the picture's shape and loses what does not fit, evenly from both sides.
      const shape = pw / ph;
      gl.uniform2f(filmP.u('uFit'), Math.min(1, shape / filmShape), Math.min(1, filmShape / shape));
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, filmTex);
      gl.uniform1i(filmP.u('uFilm'), 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    if (far.ready) {
      gl.useProgram(over.p);
      gl.uniform2f(over.u('uBox'), STAGE[0], STAGE[1]);
      gl.uniform1f(over.u('uTime'), t);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, airTex);
      gl.uniform1i(over.u('uAir'), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, far.texture);
      gl.uniform1i(over.u('uFar'), 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // The mechanism: the rear reel behind the projector's body, the front reel and the feed sprocket in front of it.
    const lamp = 0.5 * (1 + wave * 1.6);
    const parted = parts.size > 0 && body.ready;
    if (parted) mechanism([lamp * 0.6, 0.7, 0.7], () => drawReel('reel-rear', mech.rear, t));

    // The projector's body stands in front of the light it throws.
    if (body.ready) {
      gl.useProgram(sprite.p);
      gl.uniform2f(sprite.u('uBox'), STAGE[0], STAGE[1]);
      gl.uniform4f(sprite.u('uRect'), o.layers.body.place[0], o.layers.body.place[1], o.layers.body.place[2], o.layers.body.place[3]);
      const lit = 1 + 0.05 * wave;
      gl.uniform3f(sprite.u('uTint'), lit, lit, lit);
      gl.uniform1f(sprite.u('uTurned'), 0);
      gl.uniform2f(sprite.u('uSoft'), 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, body.texture);
      gl.uniform1i(sprite.u('uPicture'), 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    if (parted) {
      mechanism([lamp, 0.7, 1.1], () => {
        drawReel('reel-front', mech.front, t);
        gl.uniform3f(part.u('uLight'), lamp, 0.7, 0.55);
        const [sx, sy, sr] = mech.sprocket;
        drawPart('sprocket', turnOf(mech.front.yaw, reduced ? 0 : (mech.speed / sr) * t), [sx, sy, 30], [sr, sr, sr], [0, 0]);
      });
    }

    gl.useProgram(mote.p);
    gl.uniform2f(mote.u('uBox'), STAGE[0], STAGE[1]);
    gl.uniform1f(mote.u('uTime'), t);
    gl.uniform4f(mote.u('uBeam'), beamNow, 0, shown, 0);
    gl.uniform2f(mote.u('uLens'), look.lens[0], look.lens[1]);
    gl.uniform4f(mote.u('uPic'), px, py, pw, ph);
    gl.uniform1f(mote.u('uPixel'), pixels[0] / STAGE[0]);
    gl.bindVertexArray(dust);
    gl.drawArrays(gl.POINTS, 0, MOTES);
    gl.bindVertexArray(null);
    if (timer && timing) {
      gl.endQuery(timer.TIME_ELAPSED_EXT);
      timed = timing;
      timing = null;
    }
    frames += 1;
  }

  const drawNow = (): void => draw(frozen ?? clock);

  function tick(now: number): void {
    raf = 0;
    if (!running || frozen !== null || disposed) return;
    // The clock takes up where it stopped: a long gap (the page was hidden) does not count.
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    clock += dt;
    if (filmState !== 'none' && shown > 0 && shown < 1) shown = Math.min(1, shown + dt / 1.2);
    if (video && video.readyState >= 2 && shown === 0) shown = 0.0001;
    draw(clock);
    if (!reduced) raf = requestAnimationFrame(tick);
  }

  const wake = (): void => {
    if (!running || frozen !== null || disposed || raf !== 0 || document.hidden) return;
    last = performance.now();
    if (video) void video.play().catch(() => undefined);
    raf = requestAnimationFrame(tick);
  };
  const rest = (): void => {
    if (raf !== 0) cancelAnimationFrame(raf);
    raf = 0;
    video?.pause();
  };
  const visibility = (): void => {
    if (document.hidden) rest();
    else wake();
  };
  document.addEventListener('visibilitychange', visibility);

  return {
    resize(next) {
      const w = Math.max(1, Math.round(next[0]));
      const h = Math.max(1, Math.round(next[1]));
      if (w === pixels[0] && h === pixels[1] && canvas.width === w) return;
      pixels = [w, h];
      canvas.width = w;
      canvas.height = h;
      sizeAir();
      sizeMech(w / STAGE[0]);
      if (!running || frozen !== null || reduced) drawNow();
    },
    run(on) {
      if (on === running) return;
      running = on;
      if (on) {
        if (reduced) drawNow();
        else wake();
      } else rest();
    },
    async at(t) {
      frozen = t;
      if (t === null) {
        wake();
        return;
      }
      rest();
      if (video && film) {
        const v = video;
        const want = t % film.seconds;
        if (v.readyState < 2 || Math.abs(v.currentTime - want) > 0.001) {
          await new Promise<void>(done => {
            const ok = (): void => {
              v.removeEventListener('seeked', ok);
              v.removeEventListener('error', ok);
              done();
            };
            v.addEventListener('seeked', ok);
            v.addEventListener('error', ok);
            v.currentTime = want;
          });
        }
        shown = 1;
      }
      draw(t);
    },
    state: () => ({ running, frames, gpuMs, time: frozen ?? clock, film: filmState, filmTime: video ? video.currentTime : 0, beam: beamNow, pixels, layers: far.ready && paper.ready && body.ready, parts: [...parts.keys()].sort() }),
    dispose() {
      disposed = true;
      rest();
      document.removeEventListener('visibilitychange', visibility);
      if (video) {
        video.removeAttribute('src');
        video.load();
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
