/**
 * The surfaces made in code (ruling 3): the table's wood, the paper's tooth,
 * fibre and scratches, the boards' covering paper, and a small smooth noise. Each is drawn once by a
 * fragment shader into a mip-mapped render target, at start-up and again after
 * a lost context; no frame of the scene binds a render target. The digit atlas
 * is computed in digits.ts and uploaded here. Nothing is downloaded.
 */
import * as THREE from 'three';
import { DIGIT_CELL, digitAtlas } from './digits';
import { SCENE_SEED, hash01 } from './hash';
import { BAKE_NOISE_TILE, BAKE_SURFACE, BAKE_VERTEX, BAKE_WOOD, BAKE_WRAP } from './shaders';

export interface Surfaces {
  /** Wood, one board wide and 512 mm long. r: tone; g: how open the grain is. */
  wood: THREE.Texture;
  /** The paper's surface. r tooth, g fibre, b fine scratches, a long scratches. */
  surface: THREE.Texture;
  /** A small smooth noise, four channels. */
  noise: THREE.Texture;
  /** The boards' covering paper. r height, g mottle, b pale flecks, a dark specks. */
  wrap: THREE.Texture;
  /** The ten digits: distance to the nearest stroke. */
  digits: THREE.Texture;
  targets: THREE.WebGLRenderTarget[];
  /** Bytes these hold on the GPU, mip levels counted. */
  bytes: number;
  count: number;
}

/** Bytes of a texture with a full chain of mip levels. */
export function mippedBytes(width: number, height: number, bytesPerPixel: number, mipped = true): number {
  let total = 0;
  let w = width;
  let h = height;
  for (;;) {
    total += w * h * bytesPerPixel;
    if (!mipped || (w === 1 && h === 1)) break;
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  return total;
}

function bake(renderer: THREE.WebGLRenderer, fragment: string, width: number, height: number, format: THREE.PixelFormat, tag: string): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: false,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    colorSpace: THREE.NoColorSpace,
    type: THREE.UnsignedByteType,
    format,
  });
  target.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const material = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    uniforms: { uSeed: { value: Math.floor(hash01(SCENE_SEED, tag, 0) * 4096) } },
    vertexShader: BAKE_VERTEX,
    fragmentShader: fragment,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  renderer.setRenderTarget(target);
  renderer.render(scene, new THREE.Camera());
  renderer.setRenderTarget(null);
  material.dispose();
  quad.geometry.dispose();
  return target;
}

export function bakeSurfaces(renderer: THREE.WebGLRenderer): Surfaces {
  const wood = bake(renderer, BAKE_WOOD, 1024, 512, THREE.RGFormat, 'wood');
  const surface = bake(renderer, BAKE_SURFACE, 512, 512, THREE.RGBAFormat, 'surface');
  const noise = bake(renderer, BAKE_NOISE_TILE, 64, 64, THREE.RGBAFormat, 'noise');
  const wrap = bake(renderer, BAKE_WRAP, 512, 512, THREE.RGBAFormat, 'wrap');
  const atlas = digitAtlas();
  const digits = new THREE.DataTexture(atlas.data, atlas.width, atlas.height, THREE.RedFormat, THREE.UnsignedByteType);
  digits.minFilter = THREE.LinearFilter;
  digits.magFilter = THREE.LinearFilter;
  digits.generateMipmaps = false;
  digits.unpackAlignment = 1;
  digits.needsUpdate = true;
  renderer.initTexture(digits);
  return {
    wood: wood.texture,
    surface: surface.texture,
    noise: noise.texture,
    wrap: wrap.texture,
    digits,
    targets: [wood, surface, noise, wrap],
    bytes: mippedBytes(1024, 512, 2) + mippedBytes(512, 512, 4) * 2 + mippedBytes(64, 64, 4) + mippedBytes(DIGIT_CELL[0] * 10, DIGIT_CELL[1], 1, false),
    count: 5,
  };
}
