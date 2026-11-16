/**
 * Things on the table, mounted: the placings of the game's seed (place.ts), built as one mesh and one layer
 * of shadows (model.ts), lit as the rest of the table (shaders.ts). Drawn in the lit tiers only (never in
 * Flat, the low tier), and not at all with `props=0` in the address.
 */
import * as THREE from 'three';
import trayLayoutText from '../../../../assets/table/tray/tray.layout.json?raw';
import type { BoardLayout } from '../layout';
import { parseTrayLayout, placeTray, trayCorners } from '../tray/layout';
import { placeProps } from './place';
import type { PlacedProp, PropsGround } from './place';
import { buildProps } from './model';
import { PROP_FRAGMENT, PROP_SHADOW_FRAGMENT, PROP_SHADOW_VERTEX, PROP_VERTEX } from './shaders';

/** The ground things are put down on: the boards' outline, the table, and where the tray stands (it is put down by the same rule as the tray itself, tray/layout.ts). */
export function propsGround(layout: Pick<BoardLayout, 'outline' | 'table'>, withTray: boolean): PropsGround {
  const tray = withTray ? trayCorners(placeTray(parseTrayLayout(JSON.parse(trayLayoutText)), layout)) : null;
  return { outline: layout.outline, table: layout.table.rect, tray };
}

export interface PropsMount {
  /** What lies on the table, for checks. */
  readonly placed: readonly PlacedProp[];
  /** Shown in the lit tiers, hidden in Flat. */
  setLit(lit: boolean): void;
  dispose(): void;
}

export function mountProps(o: {
  root: THREE.Object3D;
  shared: Record<string, { value: unknown }>;
  seed: number;
  ground: PropsGround;
  /** The table top's height in the board frame: things stand on it. */
  tableZ: number;
  /** Unit vector toward the key light. */
  key: readonly [number, number, number];
}): PropsMount {
  const placed = placeProps(o.seed, o.ground);
  const { body, shadow } = buildProps(placed, o.key);
  const uniforms = { ...o.shared } as Record<string, THREE.IUniform>;
  const things = new THREE.Mesh(body, new THREE.ShaderMaterial({ uniforms, vertexShader: PROP_VERTEX, fragmentShader: PROP_FRAGMENT, side: THREE.DoubleSide, toneMapped: false }));
  things.position.z = o.tableZ;
  things.renderOrder = 6;
  const shadows = new THREE.Mesh(
    shadow,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: PROP_SHADOW_VERTEX,
      fragmentShader: PROP_SHADOW_FRAGMENT,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -8,
      blending: THREE.CustomBlending,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.ZeroFactor,
      blendEquation: THREE.AddEquation,
      toneMapped: false,
    }),
  );
  shadows.position.z = o.tableZ + 0.002;
  shadows.renderOrder = 5.5;
  for (const m of [things, shadows]) {
    m.updateMatrix();
    m.updateMatrixWorld(true);
    m.frustumCulled = true;
    o.root.add(m);
  }
  return {
    placed,
    setLit(lit) {
      things.visible = lit;
      shadows.visible = lit;
    },
    dispose() {
      for (const m of [things, shadows]) {
        o.root.remove(m);
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    },
  };
}
