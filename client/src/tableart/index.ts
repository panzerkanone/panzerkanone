/**
 * The art of the things that stand on the game table, for the table's scene:
 * so far the counter tray. Outside the scene, as the unit art is: the scene
 * fetches and decodes nothing itself, so the page's entry calls `loadTray()`
 * and hands what comes back to the table.
 *
 * Everything comes from assets/table/tray/, which the tray's script writes
 * (tools/tray/build_tray.py, run in Blender from the numbers in
 * tools/tray/tray.json): the layout (a few numbers, bundled with this file),
 * the mesh (JSON of plain number lists) and the base-colour picture. The
 * bundler turns the last two into addresses; only `loadTray()` fetches them.
 */
import layoutText from '../../../assets/table/tray/tray.layout.json?raw';
import meshUrl from '../../../assets/table/tray/tray.mesh.json?url';
import pictureUrl from '../../../assets/table/tray/tray.basecolor.png?url';

/** The tray's mesh as typed arrays: the tray's own frame, in h. */
export interface LoadedMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
}

/** What the table's scene is handed for the tray. */
export interface LoadedTray {
  /** The layout as its script wrote it (the scene reads it, strictly). */
  layout: unknown;
  mesh: LoadedMesh;
  picture: { image: HTMLImageElement; width: number; height: number };
}

function numbers(v: unknown, per: number, count: number, what: string): number[] {
  if (!Array.isArray(v) || v.length !== per * count || v.some(x => typeof x !== 'number' || !Number.isFinite(x))) throw new Error(`tray mesh: ${what} must be ${per * count} numbers`);
  return v as number[];
}

/** Read the mesh file strictly: a list of the wrong length, or an index past the last vertex, is an error. */
export function readMesh(source: unknown): LoadedMesh {
  if (typeof source !== 'object' || source === null) throw new Error('tray mesh: not a mapping');
  const m = source as Record<string, unknown>;
  if (m.format !== 'tray-mesh/1') throw new Error('tray mesh: format must be tray-mesh/1');
  const vertices = m.vertices;
  const triangles = m.triangles;
  if (typeof vertices !== 'number' || !Number.isInteger(vertices) || vertices <= 0 || typeof triangles !== 'number' || !Number.isInteger(triangles) || triangles <= 0) throw new Error('tray mesh: vertices and triangles must be counts');
  const indices = numbers(m.indices, 3, triangles, 'indices');
  if (indices.some(i => !Number.isInteger(i) || i < 0 || i >= vertices)) throw new Error('tray mesh: an index names no vertex');
  return {
    positions: new Float32Array(numbers(m.positions, 3, vertices, 'positions')),
    normals: new Float32Array(numbers(m.normals, 3, vertices, 'normals')),
    uvs: new Float32Array(numbers(m.uvs, 2, vertices, 'uvs')),
    indices: vertices <= 65535 ? new Uint16Array(indices) : new Uint32Array(indices),
  };
}

/**
 * The counter tray, fetched and decoded. Resolves with null when any part of it fails (the table
 * then has no tray and is as it was without one). Never rejects.
 */
export async function loadTray(): Promise<LoadedTray | null> {
  try {
    const image = new Image();
    image.src = pictureUrl;
    const [mesh] = await Promise.all([fetch(meshUrl).then(r => (r.ok ? (r.json() as Promise<unknown>) : Promise.reject(new Error(`tray mesh: ${r.status}`)))), image.decode()]);
    return { layout: JSON.parse(layoutText) as unknown, mesh: readMesh(mesh), picture: { image, width: image.naturalWidth, height: image.naturalHeight } };
  } catch (err) {
    console.error(err);
    return null;
  }
}
