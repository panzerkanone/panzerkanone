/**
 * The typewriter face of the papers: the lines typed on a clipboard's sheet or a book's page (rows of figures, a
 * citation). Lekton, weight 700 (SIL Open Font License 1.1; drawn after the faces of Olivetti typewriters): a narrow
 * monospaced sans with a plain zero, the closest open face to the typed rows the owner painted on his results sheet
 * (six candidates set beside his rows, 2026-11-15). Its file is assets/rewards/v1/lekton-latin-700-normal.woff2, taken
 * unchanged from the pinned package @fontsource/lekton by tools/rewardsart/, with its licence beside it.
 *
 * A screen that types lines adds `typedFaceCss()` to its stylesheet once and sets them in `TYPED_STACK` at
 * `TYPED_WEIGHT`. Nothing is fetched here: the browser fetches the file when the first typed line is drawn.
 */
const FILE = 'lekton-latin-700-normal.woff2';
const FILES = import.meta.glob<string>('../../../assets/rewards/v1/lekton-latin-700-normal.woff2', { query: '?url', import: 'default', eager: true });

export const TYPED_FAMILY = 'Lekton';
export const TYPED_WEIGHT = 700;
/** What a typed line is set in: the face, then a typewriter face every machine has. */
export const TYPED_STACK = `"${TYPED_FAMILY}", "Courier New", Courier, monospace`;

/**
 * The face's measures, of its size (read from the file's own tables): every letter is `advance` wide, a capital is
 * `cap` tall, and with a line-height of 1 the baseline lies `baseline` under the line's top.
 */
export const TYPED_FACE = { advance: 0.5, cap: 0.655, baseline: 0.75 } as const;

/** The bundled address of the face's file. */
export function typedFaceAddress(): string {
  const address = FILES[`../../../assets/rewards/v1/${FILE}`];
  if (address === undefined) throw new Error(`the typewriter face: ${FILE} is not bundled`);
  return address;
}

/** The face's rule for a stylesheet. */
export function typedFaceCss(): string {
  return `@font-face { font-family: "${TYPED_FAMILY}"; font-weight: ${TYPED_WEIGHT}; font-style: normal; font-display: block; src: url("${typedFaceAddress()}") format("woff2"); }\n`;
}
