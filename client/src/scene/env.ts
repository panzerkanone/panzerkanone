/**
 * The room round the table on the GPU (rooms.ts says what a room is). The page hands over a room's panorama, two
 * pictures as the browser decoded them (client/src/tableart/env.ts; the scene fetches nothing itself); here one pass
 * turns them into light in a half-float texture (the formula of rooms.ts's `rgbeToHalf`, which the tests check, done
 * by the graphics card: no pixel is read back), three's PMREM prefilters it once into a cube with a mip level for each roughness
 * (GGX, from a mirror at level 0 to matte at the last), and the shared uniforms tell every shader of the table where
 * the room is, how strong it is, and its light's nine coefficients. After a lost context the cube is made again.
 */
import * as THREE from 'three';
import { LUMA, ROOMS, ROOM_FINISH, roomIrradiance } from './rooms';
import type { RoomFacts, RoomName } from './rooms';

/**
 * A decoded picture as the page hands it over: an ImageBitmap in the browser, named here by its shape, because this
 * module is also type-checked where the browser's own types are not known.
 */
export interface RoomPicture {
  readonly width: number;
  readonly height: number;
  close(): void;
}

/** A room's panorama as the page hands it over: its two pictures (colour, and exponent in the red channel), and its facts. */
export interface RoomArt {
  name: RoomName;
  rgb: RoomPicture;
  e: RoomPicture;
  facts: RoomFacts;
}

/** The largest finite half float: light is kept under it, as `toHalf` keeps it (rooms.ts). */
const MOST = 65504;
const DECODE_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;
/** A texel is (r, g, b) * 2^(e - 136) with r, g, b and e as bytes, black where e is 0: `rgbeToHalf`, on the graphics card. */
const DECODE_FRAGMENT = `
precision highp float;
uniform sampler2D uRgb;
uniform sampler2D uE;
uniform float uMost;
varying vec2 vUv;
void main() {
  // A picture's first row is its top and lies at v = 0 of its texture; the panorama's v runs up from its foot.
  vec2 at = vec2(vUv.x, 1.0 - vUv.y);
  vec3 c = floor(texture2D(uRgb, at).rgb * 255.0 + 0.5);
  float e = floor(texture2D(uE, at).r * 255.0 + 0.5);
  float f = e < 0.5 ? 0.0 : exp2(e - 136.0);
  gl_FragColor = vec4(min(c * f, vec3(uMost)), 1.0);
}`;

/** A picture as a texture of its bytes: no colour space, no filtering, no flip (the decode pass turns it over). */
function byteTexture(image: RoomPicture): THREE.Texture {
  const t = new THREE.Texture(image as never);
  t.colorSpace = THREE.NoColorSpace;
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.flipY = false;
  t.premultiplyAlpha = false;
  t.needsUpdate = true;
  return t;
}

/** The panorama as light: one pass over the two pictures into a half-float texture of the panorama's own size. The caller disposes of it. */
function decodeRoom(renderer: THREE.WebGLRenderer, art: RoomArt): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(art.facts.width, art.facts.height, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.LinearSRGBColorSpace,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  });
  target.texture.mapping = THREE.EquirectangularReflectionMapping;
  const rgb = byteTexture(art.rgb);
  const e = byteTexture(art.e);
  const material = new THREE.ShaderMaterial({
    uniforms: { uRgb: { value: rgb }, uE: { value: e }, uMost: { value: MOST } },
    vertexShader: DECODE_VERTEX,
    fragmentShader: DECODE_FRAGMENT,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const before = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
  renderer.setRenderTarget(before);
  rgb.dispose();
  e.dispose();
  material.dispose();
  quad.geometry.dispose();
  return target;
}

type Uniform<T> = { value: T };

/**
 * The shared uniforms of the room, as World starts them: no room. `uRoom`: on, the radiance's scale (the room's
 * light on an upward face 1, times its strength), the cosine and sine of its turn. `uRoomB`: how much of its colour
 * reaches the light, its reflections' gain, the cube's last mip level, unused. `uRoomC`: the printed sheet's and the
 * counters' faces' roughness in it, the most the sheet's reflection may add, unused. `uRoomSH`: the nine coefficients.
 */
export function roomUniforms(): Record<string, Uniform<unknown>> {
  return {
    uRoomMap: { value: null },
    uRoom: { value: new THREE.Vector4(0, 0, 1, 0) },
    uRoomB: { value: new THREE.Vector4(0, 1, 0, 0) },
    uRoomC: { value: new THREE.Vector4(ROOM_FINISH.sheet, ROOM_FINISH.face, ROOM_FINISH.sheetCap, 0) },
    uRoomSH: { value: Array.from({ length: 9 }, () => new THREE.Vector3()) },
    uRoomUp: { value: new THREE.Vector3(1, 1, 1) },
  };
}

export interface RoomMount {
  readonly name: RoomName;
  /** How long the panorama took to decode and to prefilter, in ms. */
  readonly ms: { decode: number; prefilter: number };
  /** After a lost context: the cube again. */
  restore(): void;
  dispose(): void;
}

/** Put a room on the table: its cube made and the shared uniforms set. `dials` may override the room's own (for tuning). */
export function mountRoom(renderer: THREE.WebGLRenderer, shared: Record<string, Uniform<unknown>>, art: RoomArt, dials?: Partial<{ turnDeg: number; strength: number; colour: number; reflect: number }>): RoomMount {
  const room = { ...ROOMS[art.name], ...dials };
  let cube: THREE.WebGLCubeRenderTarget | null = null;
  const ms = { decode: 0, prefilter: 0 };
  // The cube, from the two pictures (they stay with the page, so that a lost context makes it again).
  const prefilter = (): void => {
    cube?.dispose();
    const t0 = performance.now();
    const source = decodeRoom(renderer, art);
    const t1 = performance.now();
    const pmrem = new THREE.PMREMGenerator(renderer);
    cube = pmrem.fromEquirectangular(source.texture);
    pmrem.dispose();
    // The panorama's own texture is no longer needed once the cube is made.
    source.dispose();
    ms.decode = t1 - t0;
    ms.prefilter = performance.now() - t1;
    (shared.uRoomMap as Uniform<THREE.Texture | null>).value = cube.texture;
    (shared.uRoomB as Uniform<THREE.Vector4>).value.z = Math.max(0, cube.texture.mipmaps.length - 1);
  };
  prefilter();
  const a = (room.turnDeg * Math.PI) / 180;
  (shared.uRoom as Uniform<THREE.Vector4>).value.set(1, art.facts.scale * room.strength, Math.cos(a), Math.sin(a));
  const b = (shared.uRoomB as Uniform<THREE.Vector4>).value;
  b.x = room.colour;
  b.y = room.reflect;
  const sh = (shared.uRoomSH as Uniform<THREE.Vector3[]>).value;
  art.facts.sh.forEach((c, k) => (sh[k] as THREE.Vector3).set(c[0] * room.strength, c[1] * room.strength, c[2] * room.strength));
  // Its colour on an upward face, once (the shaders' roomTint): luminance 1, taken toward grey by `colour` as roomTone does.
  const up = roomIrradiance(art.facts.sh, [0, 0, 1], room.turnDeg);
  const l = Math.max(up[0] * LUMA[0] + up[1] * LUMA[1] + up[2] * LUMA[2], 1e-4);
  (shared.uRoomUp as Uniform<THREE.Vector3>).value.set(...(up.map(c => 1 + (c / l - 1) * room.colour) as [number, number, number]));
  return {
    name: art.name,
    ms,
    restore: prefilter,
    dispose: () => {
      cube?.dispose();
      art.rgb.close();
      art.e.close();
      (shared.uRoomMap as Uniform<THREE.Texture | null>).value = null;
      (shared.uRoom as Uniform<THREE.Vector4>).value.x = 0;
      (shared.uRoomUp as Uniform<THREE.Vector3>).value.set(1, 1, 1);
    },
  };
}
