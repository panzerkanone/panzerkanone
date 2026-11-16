/**
 * The pictures of the table's effects (fire, blast and smoke, as flipbooks), for the table's
 * scene. Outside the scene, as the unit art and the tray's art are: the scene fetches and decodes
 * nothing itself, so the page's entry calls `loadFx()` and hands what comes back to the table.
 *
 * Everything comes from assets/fx/v1/, which `npm run fx` writes (tools/fx/) from third parties'
 * flipbooks under Creative Commons licences; each file has its entry in the attribution ledger.
 * The manifest is bundled with this file; the bundler turns the atlases into addresses, and only
 * `loadFx()` fetches them.
 */
import manifestText from '../../../assets/fx/v1/fx.json?raw';
import atlasA from '../../../assets/fx/v1/fx-a.webp?url';
import atlasB from '../../../assets/fx/v1/fx-b.webp?url';

/** The atlases' addresses by the names the manifest gives them. */
const ADDRESSES: Readonly<Record<string, string>> = { 'fx-a.webp': atlasA, 'fx-b.webp': atlasB };

/** What the table's scene is handed for its effects: the manifest as written (the scene reads it, strictly) and the atlases it names, decoded, in its order. */
export interface LoadedFx {
  manifest: unknown;
  atlases: { image: HTMLImageElement; width: number; height: number }[];
}

/**
 * The effects' pictures, fetched and decoded. Resolves with null when any part of them fails (the
 * table then shows only the effects it draws itself). Never rejects.
 */
export async function loadFx(): Promise<LoadedFx | null> {
  try {
    const manifest = JSON.parse(manifestText) as { atlases?: unknown };
    if (!Array.isArray(manifest.atlases)) throw new Error('effects manifest: no atlases');
    const atlases = await Promise.all(
      (manifest.atlases as { file?: unknown }[]).map(async a => {
        const address = typeof a.file === 'string' ? ADDRESSES[a.file] : undefined;
        if (address === undefined) throw new Error(`effects manifest: no picture is bundled for ${String(a.file)}`);
        const image = new Image();
        image.src = address;
        await image.decode();
        return { image, width: image.naturalWidth, height: image.naturalHeight };
      }),
    );
    return { manifest, atlases };
  } catch (err) {
    console.error(err);
    return null;
  }
}
