/**
 * What draws the effects: two meshes, each all its instances in one call. The decals (light and
 * shade on the board) after everything that lies on the table; the particles after them. Each
 * frame the pools (pool.ts) write their live instances into the two buffers here.
 *
 * Neither is tested against the depth of what is on the table. A sprite stands over the board and
 * is eased out where it would pass under it (in its shader), so the board never cuts one; and a
 * patch of light lies on whatever is there, a counter as much as the sheet.
 */
import * as THREE from 'three';
import { keyDirection } from '../world';
import type { Effects } from './effects';
import { MAX_ATLASES } from './flipbook';
import { CAPACITY, DECALS, DECAL_STRIDE, STRIDE } from './pool';
import { DECAL_FRAGMENT, DECAL_VERTEX, SPRITE_FRAGMENT, SPRITE_VERTEX } from './shaders';
import { linearInk } from './tune';
import type { FxTune } from './tune';

type Uniform<T> = { value: T };

/** A picture as the scene is handed it: decoded, with its size. */
export interface AtlasImage {
  image: TexImageSource;
  width: number;
  height: number;
}

function quad(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.instanceCount = 0;
  return g;
}

/** Bytes a texture of this size takes on the GPU, four bytes a pixel, its smaller copies counted. */
function bytesOf(width: number, height: number): number {
  let bytes = 0;
  let w = width;
  let h = height;
  for (;;) {
    bytes += w * h * 4;
    if (w === 1 && h === 1) break;
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  return bytes;
}

export class EffectsView {
  readonly group = new THREE.Group();
  /** The textures held here, and their bytes on the GPU. */
  textures = { count: 0, bytes: 0 };
  private readonly effects: Effects;
  private readonly tune: FxTune;
  private readonly sprites: THREE.Mesh;
  private readonly decals: THREE.Mesh;
  private readonly spriteData = new Float32Array(CAPACITY * STRIDE);
  private readonly decalData = new Float32Array(DECALS * DECAL_STRIDE);
  private readonly spriteBuffer: THREE.InstancedInterleavedBuffer;
  private readonly decalBuffer: THREE.InstancedInterleavedBuffer;
  private readonly own: Record<string, Uniform<unknown>>;
  private readonly atlases: THREE.Texture[] = [];
  private readonly blank: THREE.DataTexture;
  private readonly forward: [number, number, number] = [0, 0, -1];
  private readonly shade = { dx: 0, dy: 0, dark: 0, soften: 0 };
  private readonly m = new THREE.Matrix4();

  constructor(effects: Effects, tune: FxTune, shared: Record<string, Uniform<unknown>>) {
    this.effects = effects;
    this.tune = tune;
    // Until the pictures come (and for good when none do) the atlases are one clear pixel.
    this.blank = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.blank.needsUpdate = true;
    this.own = {
      uAtlasA: { value: this.blank },
      uAtlasB: { value: this.blank },
      uTexel: { value: new THREE.Vector4(0, 0, 0, 0) },
      uSmoke: { value: new THREE.Vector4(tune.all.smokeAmbient, tune.all.smokeKey, tune.all.smokeWrap, tune.all.groundSoft) },
      uWarm: { value: new THREE.Vector3(...linearInk(tune.fire.glow)) },
      uCamRight: { value: new THREE.Vector3(1, 0, 0) },
      uCamUp: { value: new THREE.Vector3(0, 1, 0) },
      uCamBack: { value: new THREE.Vector3(0, 0, 1) },
      uCamPos: { value: new THREE.Vector3() },
      uUpright: { value: new THREE.Vector4(0, 0, 1, 1) },
    };
    const uniforms = { ...shared, ...this.own } as Record<string, THREE.IUniform>;

    const dg = quad();
    this.decalBuffer = new THREE.InstancedInterleavedBuffer(this.decalData, DECAL_STRIDE);
    this.decalBuffer.setUsage(THREE.DynamicDrawUsage);
    dg.setAttribute('aSpot', new THREE.InterleavedBufferAttribute(this.decalBuffer, 4, 0));
    dg.setAttribute('aTone', new THREE.InterleavedBufferAttribute(this.decalBuffer, 4, 4));
    this.decals = new THREE.Mesh(
      dg,
      new THREE.ShaderMaterial({
        vertexShader: DECAL_VERTEX,
        fragmentShader: DECAL_FRAGMENT,
        side: THREE.DoubleSide,
        toneMapped: false,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        // What is there, times (1 + light) and times (1 - shade).
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.DstColorFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      }),
    );
    this.decals.renderOrder = 7.5;

    const sg = quad();
    this.spriteBuffer = new THREE.InstancedInterleavedBuffer(this.spriteData, STRIDE);
    this.spriteBuffer.setUsage(THREE.DynamicDrawUsage);
    ['aPlace', 'aAxis', 'aFrames', 'aCell', 'aInk', 'aLook', 'aMore', 'aLast'].forEach((name, k) => sg.setAttribute(name, new THREE.InterleavedBufferAttribute(this.spriteBuffer, 4, k * 4)));
    this.sprites = new THREE.Mesh(
      sg,
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: SPRITE_VERTEX,
        fragmentShader: SPRITE_FRAGMENT,
        side: THREE.DoubleSide,
        toneMapped: false,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        // Colour comes multiplied by cover: smoke covers, fire adds, in one blend.
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      }),
    );
    this.sprites.renderOrder = 8;
    for (const mesh of [this.decals, this.sprites]) {
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.group.add(mesh);
    }
  }

  /** The pictures have come. */
  setAtlases(images: readonly AtlasImage[]): void {
    for (const t of this.atlases) t.dispose();
    this.atlases.length = 0;
    let bytes = 0;
    images.slice(0, MAX_ATLASES).forEach(a => {
      const t = new THREE.Texture(a.image as HTMLImageElement);
      // Colour is multiplied by cover as the picture goes to the GPU (so that smoothing between pixels is right, and
      // nothing is lost to rounding on the way); no curve is applied here (the shader reads the picture's own); the first row is the top.
      t.colorSpace = THREE.NoColorSpace;
      t.premultiplyAlpha = true;
      t.flipY = false;
      t.wrapS = THREE.ClampToEdgeWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true;
      t.needsUpdate = true;
      this.atlases.push(t);
      bytes += bytesOf(a.width, a.height);
    });
    const a = this.atlases[0] ?? this.blank;
    const b = this.atlases[1] ?? a;
    (this.own.uAtlasA as Uniform<THREE.Texture>).value = a;
    (this.own.uAtlasB as Uniform<THREE.Texture>).value = b;
    const ia = images[0];
    const ib = images[1] ?? ia;
    (this.own.uTexel as Uniform<THREE.Vector4>).value.set(ia ? 0.5 / ia.width : 0, ia ? 0.5 / ia.height : 0, ib ? 0.5 / ib.width : 0, ib ? 0.5 / ib.height : 0);
    this.textures = { count: this.atlases.length, bytes };
  }

  /** Send the pictures to the GPU now (when they arrive, at a quiet moment), not in the middle of the first blast. */
  warm(renderer: THREE.WebGLRenderer): void {
    for (const t of this.atlases) renderer.initTexture(t);
  }

  /** After a lost graphics context. */
  restore(): void {
    for (const t of this.atlases) t.needsUpdate = true;
    this.blank.needsUpdate = true;
  }

  /**
   * Before a frame is drawn: put the live particles in order for this camera and write the buffers.
   * `lit` is false on the flat tier, which draws no shadows.
   */
  sync(camera: THREE.Camera, lit: boolean): void {
    const pool = this.effects.pool;
    if (pool.count === 0 && pool.patches === 0) {
      this.sprites.visible = false;
      this.decals.visible = false;
      return;
    }
    const e = this.m.copy(camera.matrixWorld).elements;
    (this.own.uCamRight as Uniform<THREE.Vector3>).value.set(e[0] as number, e[1] as number, e[2] as number).normalize();
    const up = (this.own.uCamUp as Uniform<THREE.Vector3>).value.set(e[4] as number, e[5] as number, e[6] as number).normalize();
    const back = (this.own.uCamBack as Uniform<THREE.Vector3>).value.set(e[8] as number, e[9] as number, e[10] as number).normalize();
    (this.own.uCamPos as Uniform<THREE.Vector3>).value.set(e[12] as number, e[13] as number, e[14] as number);
    this.forward[0] = -back.x;
    this.forward[1] = -back.y;
    this.forward[2] = -back.z;
    // A standing sprite stands upright seen from the side. Seen from above it would be edge-on and gone, so
    // there it leans with the wind, and shorter: a flame blown along the board.
    const all = this.tune.all;
    const tilt = (Math.acos(Math.min(1, Math.max(-1, back.z))) * 180) / Math.PI;
    const t = Math.min(1, tilt / Math.max(1, all.flameFullTiltDeg));
    const stand = all.flameTop + (1 - all.flameTop) * t * t * (3 - 2 * t);
    const wl = Math.hypot(all.wind[0] as number, all.wind[1] as number);
    // With no wind it leans up the screen.
    const lx = wl > 1e-4 ? (all.wind[0] as number) / wl : up.x;
    const ly = wl > 1e-4 ? (all.wind[1] as number) / wl : up.y;
    const ux = lx * (1 - stand);
    const uy = ly * (1 - stand);
    const uz = stand;
    const ul = Math.hypot(ux, uy, uz) || 1;
    (this.own.uUpright as Uniform<THREE.Vector4>).value.set(ux / ul, uy / ul, uz / ul, all.flameTopLength + (1 - all.flameTopLength) * t);
    const key = keyDirection();
    this.shade.dx = -key[0] / key[2];
    this.shade.dy = -key[1] / key[2];
    this.shade.dark = lit ? all.shadow : 0;
    this.shade.soften = all.shadowSoften;
    pool.write(this.effects.now, this.forward, this.effects.books, this.effects.strength, this.shade, this.spriteData, this.decalData);
    const sg = this.sprites.geometry as THREE.InstancedBufferGeometry;
    sg.instanceCount = pool.instances;
    this.sprites.visible = pool.instances > 0;
    if (pool.instances > 0) {
      this.spriteBuffer.clearUpdateRanges();
      this.spriteBuffer.addUpdateRange(0, pool.instances * STRIDE);
      this.spriteBuffer.needsUpdate = true;
    }
    const dg = this.decals.geometry as THREE.InstancedBufferGeometry;
    dg.instanceCount = pool.decals;
    this.decals.visible = pool.decals > 0;
    if (pool.decals > 0) {
      this.decalBuffer.clearUpdateRanges();
      this.decalBuffer.addUpdateRange(0, pool.decals * DECAL_STRIDE);
      this.decalBuffer.needsUpdate = true;
    }
  }
}
