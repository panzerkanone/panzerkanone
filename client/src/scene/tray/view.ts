/**
 * The tray as three.js objects, in the board frame like everything else on the
 * table: the tray itself (the mesh made in Blender, turned and set down where
 * it stands: one draw) and the shadow it lays on the table (one flat piece of
 * the table's plane, multiplied onto it). It is handed its mesh and its
 * picture already fetched and decoded: nothing is downloaded here.
 */
import * as THREE from 'three';
import { trayOpenings, trayToBoard } from './layout';
import type { PlacedTray } from './layout';
import { TRAY_OPENINGS } from './shade';
import { TRAY_FRAGMENT, TRAY_SHADOW_FRAGMENT, TRAY_SHADOW_VERTEX, TRAY_VERTEX } from './shaders';
import { INSET_LAYER } from '../dice/layer';

type Uniform<T> = { value: T };

/** The tray's mesh as its script wrote it: the tray's own frame, in h; Blender's winding; uv (0, 0) at the picture's bottom left. */
export interface TrayMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
}

/** A picture already decoded, with its size (an image element or a bitmap: the scene does not care which). */
export interface TrayPicture {
  image: unknown;
  width: number;
  height: number;
}

/**
 * The tray's art, handed to the table from outside the scene (the scene fetches nothing): the
 * layout its script wrote (assets/table/tray/tray.layout.json, as text or parsed), its mesh, and
 * its base-colour picture.
 */
export interface TrayArt {
  layout: unknown;
  mesh: TrayMesh;
  picture: TrayPicture;
}

/** The look's dials for the tray. */
export const TRAY_LOOK = {
  /** How glossy the wood's finish is, against the table's varnish (1 is the same). */
  gloss: 0.85,
  /** The table's light given back onto a wall, as a share of the light on an upward face. */
  wallFill: 0.2,
  /** How far the finish follows the grain: matte where the wood is worn pale, broken where it is open and dark. */
  grainFinish: 0.3,
  /** The felt's nap: how much lighter the pad is when seen along the cloth than from straight above (a share of its own colour). */
  feltNap: 1.6,
  /** Inside a well: the tangent of the key's angular radius (how soft the walls' shadow is), and how much of the room's light a counter at the bottom of a well loses. */
  wellPenumbra: 0.3,
  wellDark: 0.3,
  /** Its shadow on the table: the penumbra's slope, the width of the dark line where it stands, how much of the shadow is given (1 is all of it), and how far round the tray the shadow's piece of table reaches (h). */
  penumbra: 0.3,
  contactWidth: 0.03,
  shadow: 1,
  shadowReach: 0.8,
};

/** The uniforms that say where the tray is and how its wells are lit: shared by the tray's own materials and by whatever lies in it. With no tray they say so. */
export function trayUniforms(): Record<string, Uniform<unknown>> {
  return {
    uTray: { value: new THREE.Vector4(0, 0, 1, 0) },
    uTrayB: { value: new THREE.Vector4(0, 0, 0, 0) },
    uTrayC: { value: new THREE.Vector4(TRAY_LOOK.wellPenumbra, TRAY_LOOK.wellDark, 1, 0) },
    uTrayWells: { value: Array.from({ length: TRAY_OPENINGS }, () => new THREE.Vector4(0, 0, 0, 0)) },
  };
}

/** Tell those uniforms where a tray stands. */
export function placeTrayUniforms(u: Record<string, Uniform<unknown>>, t: PlacedTray): void {
  const openings = trayOpenings(t.layout);
  if (openings.length > TRAY_OPENINGS) throw new Error(`the tray has ${openings.length} openings; the shaders take ${TRAY_OPENINGS}`);
  (u.uTray as Uniform<THREE.Vector4>).value.set(t.centre[0], t.centre[1], t.cos, t.sin);
  (u.uTrayB as Uniform<THREE.Vector4>).value.set(t.layout.size[0] / 2, t.layout.size[1] / 2, t.rimZ, 1);
  const deepest = Math.max(...openings.map(o => t.layout.rim - o.floor));
  (u.uTrayC as Uniform<THREE.Vector4>).value.set(TRAY_LOOK.wellPenumbra, TRAY_LOOK.wellDark, deepest, t.layout.cornerRadius);
  (u.uTrayWells as Uniform<THREE.Vector4[]>).value.forEach((v, k) => {
    const o = openings[k];
    if (o) v.set(o.rect[0], o.rect[1], o.rect[2], o.rect[3]);
    else v.set(0, 0, 0, 0);
  });
}

export class TrayView {
  readonly group = new THREE.Group();
  /** For each opening, the rows of the pieces' caster table of the counters lying in it (-1: none). Whoever keeps that table fills these. */
  readonly casters: THREE.Vector4[] = Array.from({ length: TRAY_OPENINGS }, () => new THREE.Vector4(-1, -1, -1, -1));
  /** Bytes of its picture on the GPU, with its smaller copies. */
  readonly bytes: number;
  readonly triangles: number;
  private readonly texture: THREE.Texture;

  /**
   * `uniforms` are the scene's shared ones together with the tray's place (`trayUniforms`) and the
   * pieces' caster table (`uCasters`, `uCounter`).
   */
  constructor(placed: PlacedTray, art: TrayArt, uniforms: Record<string, Uniform<unknown>>, maxAnisotropy: number) {
    const src = art.mesh;
    const n = src.positions.length / 3;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const p = trayToBoard(placed, src.positions[i * 3] as number, src.positions[i * 3 + 1] as number, src.positions[i * 3 + 2] as number);
      pos[i * 3] = p[0];
      pos[i * 3 + 1] = p[1];
      pos[i * 3 + 2] = p[2];
      const nx = src.normals[i * 3] as number;
      const ny = src.normals[i * 3 + 1] as number;
      nor[i * 3] = placed.cos * nx - placed.sin * ny;
      nor[i * 3 + 1] = placed.sin * nx + placed.cos * ny;
      nor[i * 3 + 2] = src.normals[i * 3 + 2] as number;
      // The picture is uploaded as it is stored, its first row at the top.
      uv[i * 2] = src.uvs[i * 2] as number;
      uv[i * 2 + 1] = 1 - (src.uvs[i * 2 + 1] as number);
    }
    // The board frame is left-handed as the page's camera draws it (x right, y toward the player, z
    // up), so Blender's triangles are turned over here: the outside is then the front.
    const idx = new Uint32Array(src.indices.length);
    for (let i = 0; i + 2 < src.indices.length; i += 3) {
      idx[i] = src.indices[i] as number;
      idx[i + 1] = src.indices[i + 2] as number;
      idx[i + 2] = src.indices[i + 1] as number;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    this.triangles = idx.length / 3;

    const texture = new THREE.Texture(art.picture.image as HTMLImageElement);
    texture.flipY = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = maxAnisotropy;
    texture.needsUpdate = true;
    this.texture = texture;
    this.bytes = Math.round((art.picture.width * art.picture.height * 4 * 4) / 3);

    const felt = placed.layout.felt;
    const own: Record<string, Uniform<unknown>> = {
      uTrayTex: { value: texture },
      uTrayCasters: { value: this.casters },
      uTrayFelt: { value: new THREE.Vector4(felt.rect[0], felt.rect[1], felt.rect[2], felt.rect[3]) },
      uTrayLook: { value: new THREE.Vector4(TRAY_LOOK.gloss, TRAY_LOOK.wallFill, placed.z + felt.floor, TRAY_LOOK.grainFinish) },
      uTrayFeltLook: { value: new THREE.Vector4(TRAY_LOOK.feltNap, 0, 0, 0) },
      uTrayShadow: { value: new THREE.Vector4(placed.layout.rim, TRAY_LOOK.penumbra, TRAY_LOOK.contactWidth, TRAY_LOOK.shadow) },
    };
    const all = { ...uniforms, ...own } as Record<string, THREE.IUniform>;
    const tray = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: all, vertexShader: TRAY_VERTEX, fragmentShader: TRAY_FRAGMENT, side: THREE.FrontSide, toneMapped: false }));
    // Before the table top (its render order is 5): the table is then not shaded where the tray stands on it.
    tray.renderOrder = 4.5;
    // The dice inset's camera looks into its felt well (../dice/inset.ts).
    tray.layers.enable(INSET_LAYER);

    // Its shadow: the table's plane round it, as far as the shadow and the darkening by its walls can reach.
    const hx = placed.layout.size[0] / 2 + TRAY_LOOK.shadowReach;
    const hy = placed.layout.size[1] / 2 + TRAY_LOOK.shadowReach;
    const corners = ([[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]] as const).flatMap(([x, y]) => {
      const p = trayToBoard(placed, x, y, 0.0007);
      return [p[0], p[1], p[2]];
    });
    const flat = new THREE.BufferGeometry();
    flat.setAttribute('position', new THREE.Float32BufferAttribute(corners, 3));
    flat.setIndex([0, 1, 2, 0, 2, 3]);
    flat.computeBoundingSphere();
    const shadow = new THREE.Mesh(
      flat,
      new THREE.ShaderMaterial({
        uniforms: all,
        vertexShader: TRAY_SHADOW_VERTEX,
        fragmentShader: TRAY_SHADOW_FRAGMENT,
        side: THREE.DoubleSide,
        toneMapped: false,
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.DstColorFactor,
        blendDst: THREE.ZeroFactor,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -8,
      }),
    );
    shadow.renderOrder = 5.2;
    shadow.layers.enable(INSET_LAYER);
    this.group.add(tray, shadow);
  }

  /** After a lost context the picture is uploaded again. */
  restore(): void {
    this.texture.needsUpdate = true;
  }
}
