/**
 * The panel's line icons: the project's own drawings, one stroke weight, as
 * path data on a 24 by 24 field (the wide one on 60 by 28). They are the
 * grey-box's pictures and stay as drawn lines when the panel is dressed.
 *
 * A control's icon is found by the control's id (model.ts ControlId), a map
 * control's by its id as the page names it, a mark's by the mark's id.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';

interface Drawing {
  /** The field: "0 0 24 24" unless said. */
  box?: string;
  /** Path data, and circles as [cx, cy, r], and rectangles as [x, y, w, h, rx]. */
  d: string;
  circles?: readonly (readonly [number, number, number])[];
  rects?: readonly (readonly [number, number, number, number, number])[];
}

const DRAWINGS: Readonly<Record<string, Drawing>> = {
  menu: { d: 'M4 7h16M4 12h16M4 17h16' },
  map: { d: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14' },
  camera: { d: 'M3 8h4l2-3h6l2 3h4v11H3z', circles: [[12, 13, 3.5]] },
  whole: { d: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5' },
  hex: { d: 'M7 4h10l5 8-5 8H7l-5-8z' },
  numbers: { d: 'M9 4L7 20M17 4l-2 16M4 9h17M3 15h17' },
  sight: { d: 'M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z', circles: [[12, 12, 2.5]] },
  detail: { d: 'M15 15l5 5M8 10.5h5M10.5 8v5', circles: [[10.5, 10.5, 6]] },
  check: { d: 'M4 12.5l5 5L20 6.5' },
  flag: { d: 'M6 21V4M6 5h11l-2.5 3.5L17 12H6' },
  pass: { d: 'M5 6l8 6-8 6zM17 6v12' },
  next: { d: 'M4 12h12M11 7l5 5-5 5M20 5v14' },
  back: { d: 'M9 6L4 11l5 5M4 11h10a5 5 0 1 1 0 10h-3' },
  fast: { d: 'M4 6l7 6-7 6zM13 6l7 6-7 6z' },
  again: { d: 'M19 12a7 7 0 1 1-2.5-5.4M19 4v4h-4' },
  // The ways a chosen unit can act besides moving and firing, by control id.
  charge: { d: 'M5 5l14 14M19 5L5 19M5 9V5h4M15 5h4v4' },
  drive: { d: 'M9 5h7l4 7-4 7H9l-4-7zM1 12h15M12.5 8.5L16 12l-3.5 3.5' },
  board: { d: 'M3 18h18M4 18v-6h9v6M13 14h4l3 2.5V18M9 3v5M6.5 6L9 8.5 11.5 6', circles: [[7.5, 19.5, 1.5], [16.5, 19.5, 1.5]] },
  unload: { d: 'M3 18h18M4 18v-6h9v6M13 14h4l3 2.5V18M9 8.5v-5M6.5 6L9 3.5 11.5 6', circles: [[7.5, 19.5, 1.5], [16.5, 19.5, 1.5]] },
  call: { d: 'M12 2v6M12 16v6M2 12h6M16 12h6', circles: [[12, 12, 7]] },
  screen: { d: 'M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.5A4.5 4.5 0 1 1 17 18z' },
  route: { d: 'M5 21v-6c0-4 7-4 7-9V3M19 21v-6c0-4-7-4-7-9M9 6l3-3 3 3' },
  advance: { d: 'M13 5h5l3 7-3 7h-5M2 12h12M10.5 8.5L14 12l-3.5 3.5' },
  setting: { d: 'M5 5l14 14', circles: [[12, 12, 8], [12, 12, 3]] },
  dice: { d: 'M8.5 8.5v.01M15.5 8.5v.01M12 12v.01M8.5 15.5v.01M15.5 15.5v.01', rects: [[4, 4, 16, 16, 3]] },
  folder: { d: 'M3 7h6l2 2h10v10H3z' },
  unit: { d: 'M4 9h16', rects: [[4, 4, 16, 16, 2]] },
  odds: { d: 'M19 5L5 19', circles: [[7, 7, 2.5], [17, 17, 2.5]] },
  log: { d: 'M5 6h14M5 10h14M5 14h10M5 18h7' },
  brief: { d: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h5' },
  rules: { d: 'M12 6c-2-1.5-5-2-8-2v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2zM12 6v14' },
  keys: { d: 'M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10', rects: [[2, 6, 20, 12, 2]] },
  mode: { d: 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17v.01', circles: [[12, 12, 9]] },
  about: { d: 'M12 11v6M12 7.5v.01', circles: [[12, 12, 9]] },
  min: { d: 'M6 12h12' },
  close: { d: 'M6 6l12 12M18 6L6 18' },
  music: { d: 'M9 18V6l10-2v12', circles: [[6.5, 18, 2.5], [16.5, 16, 2.5]] },
  quieter: { d: 'M6 12h12' },
  louder: { d: 'M6 12h12M12 6v12' },
  // A unit card's tiles, by kind.
  fire: { d: 'M12 3l2 6 6-1-4 4 4 5-6-1-2 6-2-6-6 1 4-5-4-4 6 1z' },
  range: { d: 'M3 12h18M17 8l4 4-4 4M3 8v8' },
  defence: { d: 'M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z' },
  move: { d: '', rects: [[2, 8, 20, 8, 4]], circles: [[7, 12, 1.5], [12, 12, 1.5], [17, 12, 1.5]] },
  cost: { d: 'M7 4h10l5 8-5 8H7l-5-8z' },
  // The marks of the sides, by mark id.
  cross: { d: 'M9 3h6l-1 6 6-1v8l-6-1 1 6H9l1-6-6 1V8l6 1z' },
  'hammer-sickle': { d: 'M14 4a7 7 0 1 1-8 11M6 15l-2 3M9 5l8 8M7 7l3-3 2 2-3 3z' },
  // A picture not yet there.
  picture: { box: '0 0 60 28', d: 'M6 20h44a4 4 0 0 0 0-8H8a4 4 0 0 0-2 8zM14 12l2-5h16l3 5M32 8h22M22 7V4h8v3', circles: [[14, 16, 2], [24, 16, 2], [34, 16, 2], [44, 16, 2]] },
};

/** Close combat has the same picture as closing with a target. */
const SAME: Readonly<Record<string, string>> = {
  close_combat: 'charge', confirm: 'check', start: 'check', end: 'flag', takeBack: 'back', deal: 'dice', reseed: 'dice', preset: 'unit', grid: 'hex',
};

/** Whether the set has a drawing by this name. */
export function hasIcon(name: string): boolean {
  return DRAWINGS[name] !== undefined || SAME[name] !== undefined;
}

/** An icon by name, as an SVG element of class `wg-i` (and `wg-s` when small). A name it does not have draws nothing. */
export function icon(name: string, small = false): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', small ? 'wg-i wg-s' : 'wg-i');
  svg.setAttribute('aria-hidden', 'true');
  const drawing = DRAWINGS[name] ?? DRAWINGS[SAME[name] ?? ''];
  svg.setAttribute('viewBox', drawing?.box ?? '0 0 24 24');
  if (!drawing) return svg;
  if (drawing.d !== '') {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', drawing.d);
    svg.appendChild(path);
  }
  for (const [cx, cy, r] of drawing.circles ?? []) {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', String(cx));
    c.setAttribute('cy', String(cy));
    c.setAttribute('r', String(r));
    svg.appendChild(c);
  }
  for (const [x, y, w, h, rx] of drawing.rects ?? []) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(w));
    rect.setAttribute('height', String(h));
    rect.setAttribute('rx', String(rx));
    svg.appendChild(rect);
  }
  return svg;
}
