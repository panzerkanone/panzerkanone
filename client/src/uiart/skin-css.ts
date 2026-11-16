/**
 * The panel's dressed look as a stylesheet: the look the owner approved as
 * docs/review/M5/ui-graybox/mock.html with `art=1` (silk ribbon tabs, quiet
 * key caps), rule for rule, laid over the panel's grey-box (game/hud-css.ts)
 * under `.wg-hud.wg-skin`.
 *
 * Every part that holds live words is a nine-slice (`border-image`), so it
 * takes whatever size its words need. What stretches and what repeats is as
 * docs/review/M5/ui-graybox/NOTES.md says: frames that carry rivets or rings
 * repeat in whole tiles (`round`); paper, the torn strip, the folder and the
 * dossier stretch; corner buttons, the brass ring, the turn ticks, the clip,
 * the marks and the ribbons are fixed pictures. No word is in any picture.
 *
 * The colours here are the mock's own, written as it writes them.
 *
 * `u(name)` gives a sprite's address by its file's name without the ending.
 * `SKIN_SPRITES` is every name the sheet asks for: a test holds it against
 * the folder (nothing missing, nothing shipped that is not used).
 */

/** Every sprite the stylesheet names. */
export const SKIN_SPRITES = [
  'k-wide-normal', 'k-wide-pressed', 'k-wide-disabled', 'k-corner-normal', 'k-corner-pressed', 'k-corner-lit', 'k-ring',
  'k-tick-future', 'k-tick-past', 'k-tick-now', 'k-tick-last',
  'steel-plate', 'torn-strip', 'paper', 'stamp-red', 'stamp-black', 'notebook-tile', 'folder',
  'p2-dossier', 'p2-title-tab', 'p2-photo-border', 'p2-clip', 'p2-header-dark', 'p2-header-red', 'p2-heading-strip', 'p2-wide-ivory',
  'r4-ribbon-cream', 'r4-ribbon-red', 'r4-ribbon-olive', 'r4-ribbon-ochre',
] as const;
export type SkinSprite = (typeof SKIN_SPRITES)[number];

export interface SkinOptions {
  /**
   * The small soft edge the mock gives each floating part (a few pixels of `drop-shadow`). True: as the
   * mock has it. False: none at all.
   */
  readonly edges: boolean;
}

export function skinCss(u: (name: SkinSprite) => string, opts: SkinOptions): string {
  const url = (name: SkinSprite): string => `url("${u(name)}")`;
  const edge = (x: number, y: number, blur: number, alpha: number): string => (opts.edges ? `drop-shadow(${x}px ${y}px ${blur}px hsl(0 0% 0% / ${alpha}))` : 'drop-shadow(0 0 0 transparent)');
  const S = '.wg-hud.wg-skin';
  return `
${S} {
  --steel: hsl(212 10% 21%); --steel-hi: hsl(212 10% 31%); --steel-line: hsl(212 12% 62%);
  --wood: hsl(20 36% 20%); --wood-line: hsl(28 48% 55%);
  --leather: hsl(14 16% 14%); --leather-line: hsl(24 22% 46%);
  --paper: hsl(42 50% 90%); --paper-2: hsl(40 34% 80%); --ink: hsl(28 28% 15%); --ink-soft: hsl(28 14% 38%);
  --manila: hsl(36 42% 62%);
  --brass: hsl(42 64% 56%); --red: hsl(4 64% 44%); --green: hsl(140 32% 34%);
  --side-first: hsl(205 48% 46%); --side-second: hsl(36 44% 48%); --score-second: hsl(36 60% 62%);
  --shadow: 0 2px 0 hsl(0 0% 0% / .35), 0 6px 14px hsl(0 0% 0% / .28);
  --nb-page-h: 456px;
  --nb-reach: 416px;
}

/* ---- steel: commands, chips, pop-outs. Its edges carry rivets, so they repeat in whole tiles. ---- */
${S} .wg-steel { background: none; border: solid transparent; border-width: 10px 11px; border-image: ${url('k-wide-normal')} 72 74 72 74 fill / 10px 11px round; box-shadow: none; filter: ${edge(0, 3, 3, 0.45)}; }
${S} .wg-steel.wg-riv::before { display: none; }
${S} .wg-btn { padding: 0 3px; }
${S}.wg-overlay .wg-btn { padding: 0 6px; }
${S} .wg-btn[aria-disabled="true"] { border-image-source: ${url('k-wide-disabled')}; opacity: .75; color: hsl(212 10% 30%); }
${S} .wg-btn.wg-primary { background: none; border: solid transparent; border-width: 9px; border-image: ${url('k-corner-lit')} 64 fill / 9px stretch; box-shadow: none; filter: ${edge(0, 3, 3, 0.4)}; color: var(--ink); }
${S} .wg-ctx { padding: 0 3px; height: 36px; border-width: 8px 9px; border-image: ${url('k-wide-normal')} 72 74 72 74 fill / 8px 9px round; }
/* The control of the way that is switched on stays lit: the brass face, as the suggested command has it. */
${S} .wg-btn.wg-lit:not(.wg-primary) { background: none; border-width: 9px; border-image: ${url('k-corner-lit')} 64 fill / 9px stretch; box-shadow: none; color: var(--ink); }
${S} .wg-ctx.wg-lit { background: none; border-width: 8px; border-image: ${url('k-corner-lit')} 64 fill / 8px stretch; box-shadow: none; color: var(--ink); }
${S} .wg-btn.wg-lit .wg-key, ${S} .wg-ctx.wg-lit .wg-key { background: hsl(38 46% 26% / .28); color: var(--ink); border-color: hsl(28 28% 15% / .5); box-shadow: inset 0 1px 1px hsl(28 28% 15% / .35); }
/* Every button answers a press, possible or not: the pressed face while it is held (and a tenth of a second at least). */
${S} .wg-steel.wg-down { filter: ${edge(0, 1, 1, 0.5)}; }
${S} .wg-itab.wg-down { filter: ${edge(-1, 1, 1, 0.4)} brightness(.9); }
${S} .wg-btn.wg-down, ${S} .wg-ctx.wg-down { border-image-source: ${url('k-wide-pressed')}; }
${S} .wg-btn.wg-primary.wg-down, ${S} .wg-btn.wg-lit.wg-down, ${S} .wg-ctx.wg-lit.wg-down { border-image-source: ${url('k-corner-pressed')}; color: hsl(42 64% 62%); }
${S}.wg-overlay .wg-ctx.wg-off { border-style: solid; background: none; opacity: .5; }
${S} .wg-corner { padding: 0; border: 0; border-image: none; background: ${url('k-corner-normal')} center / 100% 100% no-repeat; width: 44px; height: 44px; color: hsl(42 64% 62%); }
${S} .wg-corner.wg-down { background-image: ${url('k-corner-pressed')}; }
${S} .wg-corner.wg-lit { background-image: ${url('k-corner-lit')}; color: var(--ink); }
${S} .wg-pop { top: 50px; border-width: 12px 13px; border-image: ${url('steel-plate')} 45 49 46 49 fill / 12px 13px round; }
${S} .wg-vol .wg-pips button[data-pip] { width: 8px; height: 18px; border: 0; border-radius: 0; background: ${url('k-tick-future')} center / 100% 100% no-repeat; }
${S} .wg-vol .wg-pips button[data-pip].wg-full { background-image: ${url('k-tick-past')}; }
${S} .wg-vol .wg-step { border-color: hsl(0 0% 100% / .4); }

/* ---- key caps, in the tone of the button they sit on ---- */
${S} .wg-key { border: 1px solid hsl(0 0% 0% / .55); border-image: none; background: var(--paper); color: var(--ink); border-radius: 3px; padding: 3px 5px; box-shadow: 0 1px 0 hsl(0 0% 0% / .5); opacity: 1; }
${S} .wg-steel .wg-key { background: hsl(210 8% 12% / .6); color: hsl(42 26% 78%); border-color: hsl(0 0% 100% / .22); box-shadow: inset 0 1px 1px hsl(0 0% 0% / .65); }
${S} .wg-btn.wg-primary .wg-key { background: hsl(38 46% 26% / .28); color: var(--ink); border-color: hsl(28 28% 15% / .5); box-shadow: inset 0 1px 1px hsl(28 28% 15% / .35); }

/* ---- paper: notes, the legend, a fault's slip ---- */
${S} .wg-paper { background: none; border: solid transparent; border-width: 8px; border-image: ${url('paper')} 26 fill / 8px stretch; box-shadow: none; filter: ${edge(0, 3, 3, 0.4)}; }
${S} .wg-coach, ${S} .wg-legend { border-width: 6px; padding-top: 2px; padding-bottom: 2px; }
${S} .wg-problem { box-shadow: inset 5px 0 0 var(--red); padding-left: 14px; }

/* ---- the status plate: a riveted steel frame that repeats, the side's enamel, a brass seat for its mark ---- */
${S} .wg-plate { background: none; outline: 0; border: solid transparent; border-width: 12px 14px 12px 14px; border-image: ${url('steel-plate')} 45 49 46 49 fill / 12px 14px 12px 14px round; box-shadow: none; filter: ${edge(0, 4, 4, 0.5)}; height: 58px; overflow: visible; }
${S} .wg-plate .wg-who { background: linear-gradient(hsl(0 0% 100% / .12), hsl(0 0% 0% / .18)), var(--wg-go); border: 1.5px solid hsl(0 0% 0% / .55); border-radius: 4px; margin: 1px 4px 1px 0; box-shadow: inset 0 1px 0 hsl(0 0% 100% / .25); }
${S} .wg-plate .wg-cell { border-right: 1.5px solid hsl(0 0% 0% / .5); box-shadow: 1px 0 0 hsl(0 0% 100% / .08); }
${S} .wg-plate .wg-cell:last-child { border-right: 0; box-shadow: none; }
${S} .wg-plate .wg-seat { border: 0; background: ${url('k-ring')} center / 100% 100% no-repeat; width: 34px; height: 34px; }
${S} img.wg-mk { filter: drop-shadow(0 1px 1px hsl(0 0% 0% / .6)); }
${S} .wg-ticks { gap: 2px; }
${S} .wg-ticks i { width: 8px; height: 20px; border: 0; border-radius: 0; background: ${url('k-tick-future')} center / 100% 100% no-repeat; opacity: 1; }
${S} .wg-ticks i.wg-past { background-image: ${url('k-tick-past')}; opacity: 1; }
${S} .wg-ticks i.wg-now { background-image: ${url('k-tick-now')}; height: 24px; width: 9px; }
${S} .wg-ticks i.wg-last { background-image: ${url('k-tick-last')}; }

/* ---- the box of words: a paper strip torn along its foot, tucked under the plate ---- */
${S} .wg-todowrap { margin-top: -4px; }
${S} .wg-todo { clip-path: none; border: solid transparent; border-width: 6px 18px 16px 18px; border-image: ${url('torn-strip')} 30 70 46 70 fill / 6px 18px 16px 18px stretch; padding: 6px 10px 2px; filter: ${edge(0, 4, 4, 0.4)}; }
${S} .wg-todo .wg-answer { border-top-color: hsl(28 28% 15% / .22); }

/* ---- stamps: a worn double-ruled frame, the word live ---- */
${S} .wg-stamp { border: solid transparent; border-width: 6px; outline: 0; padding: 0 3px; }
${S} .wg-stamp.wg-red { border-image: ${url('stamp-red')} 18 fill / 6px stretch; }
${S} .wg-stamp.wg-blk { border-image: ${url('stamp-black')} 18 fill / 6px stretch; }
${S} .wg-stamp.wg-dim { border-image: ${url('stamp-black')} 18 fill / 6px stretch; opacity: .4; }

/* ---- the notebook: one nine-slice (cover, rings, page); the rings repeat in whole tiles down its side ---- */
${S} .wg-nb { z-index: 2; }
${S} .wg-nbcover { background: none; outline: 0; border: solid transparent; border-width: 68px 24px 113px 38px; border-image: ${url('notebook-tile')} 110 39 183 61 fill / 68px 24px 113px 38px stretch round; box-shadow: none; padding: 0; filter: ${edge(0, 6, 8, 0.5)}; }
${S} .wg-nbcover .wg-rings, ${S} .wg-nbhead .wg-medal { display: none; }
${S} .wg-nbhead { position: absolute; left: 30px; right: 0; top: -61px; height: 30px; padding: 0; }
${S} .wg-nbhead button { border-color: hsl(0 0% 100% / .4); }
${S} .wg-page { background: none; border: 0; border-image: none; filter: none; padding: 2px 8px 0 6px; margin: -21px 0 -54px; }
/* its tabs are silk ribbons: the straight end under the binding, the open page's drawn out a little */
${S} .wg-nbtabs { z-index: 1; gap: 7px; right: -6px; top: calc(var(--nb-top) + 86px); }
${S}.wg-nb-open .wg-nbtabs { right: 300px; }
${S} .wg-itab { width: 116px; height: 40px; margin: 0; border: 0; border-image: none; border-radius: 0; box-shadow: none; background: center / 100% 100% no-repeat; flex-direction: row; justify-content: flex-start; gap: 5px; padding: 0 44px 0 24px; filter: ${edge(-1, 2, 1.5, 0.4)}; transition: transform .18s ease; }
${S} .wg-itab b { writing-mode: horizontal-tb; transform: none; font-size: 10.5px; letter-spacing: .1em; }
${S} .wg-itab:nth-child(1) { background-image: ${url('r4-ribbon-cream')}; color: var(--ink); }
${S} .wg-itab:nth-child(2) { background-image: ${url('r4-ribbon-red')}; color: var(--paper); }
${S} .wg-itab:nth-child(3) { background-image: ${url('r4-ribbon-olive')}; color: var(--paper); }
${S} .wg-itab:nth-child(4) { background-image: ${url('r4-ribbon-ochre')}; color: var(--ink); }
${S} .wg-itab.wg-on { width: 116px; margin: 0; transform: translateX(-10px); filter: ${edge(-1, 2, 1.5, 0.4)} brightness(1.1); }
${S} .wg-itab .wg-badge { left: 6px; top: -6px; }
${S} .wg-coach[data-note="4"] { right: 130px; }
${S}.wg-nb-open .wg-coach[data-note="4"] { right: 392px; }

/* ---- the folder: one nine-slice whose top slice holds the tab and the label strip; open, it stands on the bottom of the screen ---- */
${S} .wg-folder.wg-open { border: solid transparent; border-width: 83px 16px 8px 17px; border-image: ${url('folder')} 182 36 14 38 fill / 83px 16px 8px 17px stretch; filter: ${edge(0, 6, 8, 0.5)}; bottom: -3px; }
${S} .wg-folder.wg-open .wg-ftab { position: absolute; left: 14px; top: -81px; width: 104px; height: 30px; margin: 0; background: none; border: 0; box-shadow: none; }
${S} .wg-folder.wg-open .wg-fbody { background: none; border: 0; padding: 0; box-shadow: none; }
/* The panel no longer has a line of its own above the groups (the owner, 2026-11-14), but the art's top slice still
   has the plate that line was printed on. So the sheet is pulled up to begin where the plate is, and a piece of the
   art's own paper (the stretch just under the plate, at the scale the folder is drawn at) is laid over the plate,
   behind the lines: the plate is not seen, and the first group's line looks like every other. The sheet behind has
   the top of a second plate showing above the first: that is covered the same way, with that sheet's own paper. */
${S} .wg-folder.wg-open .wg-sheet { position: relative; z-index: 0; margin-top: -33px; background: none; border: 0; padding: 0 4px 2px; overflow: visible; max-height: none; }
${S} .wg-folder.wg-open .wg-sheet::before { content: ''; position: absolute; z-index: -1; left: 2.5px; top: 0.5px; width: 248px; height: 26px; background: ${url('folder')} -19.8px -75.5px / 286.7px auto no-repeat; pointer-events: none; }
${S} .wg-folder.wg-open .wg-sheet::after { content: ''; position: absolute; z-index: -1; left: 3px; top: -11.4px; width: 247px; height: 5.9px; background: ${url('folder')} -20.3px -32.3px / 286.7px auto no-repeat; pointer-events: none; }

/* ---- the full panels: a leather dossier with brass corners over a stack of paper; its sheet reaches out to the paper's own edge ---- */
/* The dossier's box is a few pixels larger than the book drawn in it (the picture's clear margin, between the brass
   corners): the dimming that the box's shadow lays outside it is laid inside it too, under the picture, in the
   same colour, so that no strip of the board shows undimmed along the book's sides. */
${S} .wg-dossier { background: color-mix(in srgb, black 45%, transparent); border: solid transparent; border-width: 76px; border-image: ${url('p2-dossier')} 140 fill / 76px stretch; padding: 0; width: min(1100px, calc(100% - 40px)); height: min(690px, calc(var(--stage-h) - 150px)); filter: none; }
${S} .wg-dossier .wg-sheet { margin: -30px -26px; height: calc(100% + 60px); background: none; border: 0; }
${S} .wg-dossier .wg-col { border-right: 1px solid hsl(28 28% 15% / .25); }
${S} .wg-dossier .wg-col:last-child { border-right: 0; }
${S} .wg-dossier .wg-tabname { display: flex; left: 50%; top: -128px; transform: translateX(-50%); height: 58px; padding: 0 40px; background: none; border: solid transparent; border-width: 16px 24px; border-image: ${url('p2-title-tab')} 84 110 84 110 fill / 16px 24px round; border-radius: 0; color: hsl(42 60% 64%); font-size: 21px; letter-spacing: .18em; }
${S} .wg-dossier .wg-x { top: -112px; right: -40px; filter: none; }
${S} .wg-photo { border: 0; background: var(--paper-2); height: 210px; margin: 2px 4px 14px; }
${S} .wg-photo[data-has] > div { display: none; }
${S} .wg-photo::after { content: ""; position: absolute; inset: -12px; border: solid transparent; border-width: 26px; border-image: ${url('p2-photo-border')} 96 / 26px stretch; pointer-events: none; }
${S} .wg-clip { border: 0; border-radius: 0; background: ${url('p2-clip')} center / contain no-repeat; width: 24px; height: 66px; left: 16px; top: -30px; z-index: 3; }
${S} .wg-dossier h2 { background: none; border: solid transparent; border-width: 7px 16px; border-image: ${url('p2-heading-strip')} 46 100 46 100 fill / 7px 16px stretch; padding: 1px 2px; margin-bottom: 8px; }
${S} .wg-forces h2 { position: relative; min-height: 46px; border-width: 9px 11px; border-image: ${url('p2-header-dark')} 44 48 44 48 fill / 9px 11px stretch; padding: 2px 2px 2px 46px; align-items: center; }
${S} .wg-forces [data-stock="second"] h2 { border-image-source: ${url('p2-header-red')}; }
${S} .wg-forces h2 svg.wg-i, ${S} .wg-forces h2 .wg-chip { display: none; }
${S} .wg-forces h2 img.wg-mk { display: block; position: absolute; left: -16px; top: 50%; width: 56px; height: 56px; transform: translateY(-50%); filter: none; }
${S} .wg-ur { grid-template-columns: 54px 1fr auto; padding: 2px 0; }
${S} .wg-ur img { width: 52px; height: 27px; object-fit: contain; }
${S} .wg-dense .wg-ur { grid-template-columns: 40px 1fr auto; padding: 0; }
${S} .wg-dense .wg-ur img { width: 38px; height: 19px; }
${S} .wg-mapthumb { border: 0; height: 150px; border-radius: 3px; background: hsl(40 34% 80% / .55); box-shadow: inset 0 0 0 1.5px hsl(28 28% 15% / .6), inset 0 0 22px hsl(28 28% 15% / .4); }
${S} .wg-dossier .wg-go { border-width: 11px 12px; border-image: ${url('p2-wide-ivory')} 80 84 80 84 fill / 11px 12px round; color: var(--ink); }
${S} .wg-rtable { background: none; }
${S} .wg-result { width: min(700px, calc(100% - 40px)); height: auto; }
${S} .wg-result .wg-sheet { height: auto; padding: 8px 14px 6px; }
${S} .wg-result .wg-acts .wg-btn.wg-primary { border-width: 11px 12px; border-image: ${url('p2-wide-ivory')} 80 84 80 84 fill / 11px 12px round; }
`;
}
