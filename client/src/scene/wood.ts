/**
 * The table top's scanned wood, as the scene takes it: three pictures handed in by the page (the scene
 * fetches nothing; client/src/tableart/wood.ts does), made into textures for the table's shader. The
 * colour is sRGB; the relief (an OpenGL normal map) and the roughness are data. They repeat, with
 * mipmaps, so that the far table is calm.
 */
import * as THREE from 'three';
import type { WoodName } from './woods';

/** A decoded picture as the page hands it over (an image element, a bitmap): the scene only passes it to three. */
export type WoodPicture = object;

/** What the page hands the table for its wood: which (woods.ts), three square pictures of one scan, and the side of the square in millimetres. */
export interface WoodArt {
  name: WoodName;
  colour: WoodPicture;
  normal: WoodPicture;
  rough: WoodPicture;
  sideMm: number;
}

/** The wood's textures, which wood they are, and the side of the scan in h (20 mm a hex, as the table's own wood is laid out). */
export interface WoodTextures {
  name: WoodName;
  colour: THREE.Texture;
  normal: THREE.Texture;
  rough: THREE.Texture;
  sideH: number;
}

/** Millimetres to an h: the board's hex is 20 mm across its flats in the table's scale (world.ts, LOOK.woodBoard). */
export const MM_PER_H = 20;

export function woodTextures(art: WoodArt, maxAnisotropy: number): WoodTextures {
  const make = (image: WoodPicture, colour: boolean): THREE.Texture => {
    const t = new THREE.Texture(image as never);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = maxAnisotropy;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  };
  return { name: art.name, colour: make(art.colour, true), normal: make(art.normal, false), rough: make(art.rough, false), sideH: art.sideMm / MM_PER_H };
}
