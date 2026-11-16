/**
 * The pictures of the table's hulks and craters, for the table's scene. Outside the scene, as the unit art, the
 * tray's and the effects' are: the scene fetches and decodes nothing itself, so the page's entry hands the table
 * `loadMarks` and the table calls it when a game is on it with a kind of mark switched on (nothing is fetched
 * otherwise).
 *
 * Everything comes from assets/marks/v1/, which tools/battlemarks/ cuts from the owner's sheet; each file has its
 * entry in the attribution ledger. The bundler turns the pictures into addresses; only `loadMarks()` fetches them.
 */
const FILES = import.meta.glob<string>('../../../assets/marks/v1/*.webp', { query: '?url', import: 'default', eager: true });

/**
 * Every picture of the marks, fetched and decoded, by its file's name (as the list beside them names it). Resolves
 * with null when any of them fails (the table then draws no marks). Never rejects.
 */
export async function loadMarks(): Promise<ReadonlyMap<string, HTMLImageElement> | null> {
  try {
    const out = new Map<string, HTMLImageElement>();
    await Promise.all(
      Object.entries(FILES).map(async ([path, address]) => {
        const image = new Image();
        image.decoding = 'async';
        image.src = address;
        await image.decode();
        out.set(path.slice(path.lastIndexOf('/') + 1), image);
      }),
    );
    return out;
  } catch (err) {
    console.error(err);
    return null;
  }
}
