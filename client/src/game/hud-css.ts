/**
 * The panel's stylesheet: its structure, its behaviour and its grey-box look.
 *
 * The grey-box draws each part in the line that says what it will be made of
 * (steel: cool grey with rivets; wood: brown, a double line; leather: dark, a
 * stitched line; paper: cream, a thin ink line; brass: ochre accents), in
 * flat tones mixed from the board's ink table (inks.ts). The dressed look is
 * not here: a page hands a skin (hud.ts PanelSkin) whose stylesheet is laid
 * over this one under `.wg-hud.wg-skin`.
 *
 * Sizes are in the design's own pixels (the layout was drawn on a stage of
 * 1440 by 900). The root is zoomed by one interface scale, `--wg-scale`, set
 * from the window (hud.ts); `--stage-h` is the window's height in the same
 * pixels. Every part is anchored to an edge or a corner of the root.
 *
 * The root lets every pointer event through; only its own parts take them.
 */
export const HUD_CSS = `
.wg-hud {
  position: fixed; left: 0; top: 0; right: 0; bottom: 0; pointer-events: none; z-index: 20; overflow: hidden;
  zoom: var(--wg-scale, 1);
  --steel: color-mix(in srgb, var(--ink-blue) 12%, var(--ink-key));
  --steel-hi: color-mix(in srgb, var(--ink-blue) 22%, color-mix(in srgb, var(--ink-key) 82%, white));
  --steel-line: color-mix(in srgb, var(--ink-blue) 30%, color-mix(in srgb, var(--ink-key) 38%, white));
  --wood: color-mix(in srgb, var(--ink-brown) 30%, var(--ink-key));
  --wood-line: color-mix(in srgb, var(--ink-brown) 78%, var(--ink-straw));
  --leather: color-mix(in srgb, var(--ink-brown) 8%, var(--ink-key));
  --leather-line: color-mix(in srgb, var(--ink-brown) 62%, var(--ink-ground));
  --paper: color-mix(in srgb, var(--ink-straw) 28%, white);
  --paper-2: color-mix(in srgb, var(--ink-ground) 78%, white);
  --ink: var(--ink-key);
  --ink-soft: color-mix(in srgb, var(--ink-key) 66%, white);
  --manila: color-mix(in srgb, var(--ink-brown) 42%, var(--ink-straw));
  --brass: color-mix(in srgb, var(--ink-brown) 38%, var(--ink-straw));
  --red: var(--ink-red);
  --green: var(--ink-green);
  --side-first: color-mix(in srgb, var(--ink-blue) 86%, var(--ink-key));
  --side-second: color-mix(in srgb, var(--ink-straw) 30%, var(--ink-brown));
  --score-second: color-mix(in srgb, var(--ink-straw) 62%, var(--ink-brown));
  --wg-go: var(--steel-hi);
  --shadow: 0 2px 0 color-mix(in srgb, black 35%, transparent), 0 6px 14px color-mix(in srgb, black 28%, transparent);
  --cond: "Avenir Next Condensed", "DIN Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif;
  --body: "Avenir Next", "Helvetica Neue", Helvetica, Arial, sans-serif;
  --mast-w: 600px;
  --corners-w: 276px;
  --nb-top: 64px;
  --nb-page-h: 470px;
  --nb-reach: 376px;
  --stage-h: 900px;
  font: 13px/1.3 var(--body); color: var(--ink);
  -webkit-font-smoothing: antialiased; user-select: none; -webkit-user-select: none;
}
.wg-hud[data-stock="first"] { --wg-go: var(--side-first); }
.wg-hud[data-stock="second"] { --wg-go: var(--side-second); }
.wg-hud * { box-sizing: border-box; }
:where(.wg-hud) button { font: inherit; color: inherit; cursor: pointer; pointer-events: auto; appearance: none; margin: 0; }
/* A control that is not possible now is drawn so, and still answers a press: it is never a dead button. */
:where(.wg-hud) button[aria-disabled="true"] { cursor: default; }
/* Every button answers a press: the pressed look while it is held and for a tenth of a second at least; a refusal shakes it. */
.wg-hud button.wg-down { filter: brightness(.82); translate: 0 1px; }
.wg-hud button.wg-shake { animation: wg-shake .28s ease; }
@keyframes wg-shake { 0%, 100% { translate: 0 0; } 20% { translate: -4px 0; } 45% { translate: 4px 0; } 70% { translate: -3px 0; } 88% { translate: 2px 0; } }
.wg-hud svg.wg-i { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; flex: 0 0 auto; }
.wg-hud svg.wg-i.wg-s { width: 16px; height: 16px; }
.wg-hud ::-webkit-scrollbar { width: 6px; height: 6px; }
.wg-hud ::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--ink-key) 34%, transparent); border-radius: 3px; }
.wg-hud ::-webkit-scrollbar-track { background: transparent; }
.wg-hud img.wg-mk { display: block; object-fit: contain; }

/* ---- materials ---- */
.wg-steel { background: var(--steel); color: var(--paper); border: 1.5px solid var(--steel-line); border-radius: 7px; box-shadow: var(--shadow); position: relative; }
.wg-steel.wg-riv::before { content: ""; position: absolute; inset: 4px; pointer-events: none;
  background: radial-gradient(circle 2px at 3px 3px, var(--steel-line) 98%, transparent), radial-gradient(circle 2px at calc(100% - 3px) 3px, var(--steel-line) 98%, transparent),
              radial-gradient(circle 2px at 3px calc(100% - 3px), var(--steel-line) 98%, transparent), radial-gradient(circle 2px at calc(100% - 3px) calc(100% - 3px), var(--steel-line) 98%, transparent); }
.wg-wood { background: var(--wood); color: var(--paper); border: 1.5px solid var(--wood-line); outline: 1.5px solid var(--wood-line); outline-offset: -6px; border-radius: 9px; box-shadow: var(--shadow); }
.wg-leather { background: var(--leather); color: var(--paper); border: 1.5px solid var(--leather-line); outline: 1.5px dashed var(--leather-line); outline-offset: -6px; border-radius: 10px; box-shadow: var(--shadow); }
.wg-paper { background: var(--paper); color: var(--ink); border: 1.2px solid var(--ink-soft); box-shadow: var(--shadow); }
.wg-key { font: 600 10.5px/1 "SF Mono", Menlo, Consolas, monospace; padding: 3px 5px; border: 1.2px solid currentColor; border-radius: 4px; opacity: .85; white-space: nowrap; letter-spacing: 0; text-transform: none; }
.wg-stamp { display: inline-block; padding: 3px 8px 2px; border: 2px solid currentColor; outline: 1px solid currentColor; outline-offset: 2px; border-radius: 3px; font: 800 13px/1 var(--cond); letter-spacing: .14em; text-transform: uppercase; transform: rotate(-4deg); white-space: nowrap; }
.wg-stamp.wg-red { color: var(--red); } .wg-stamp.wg-blk { color: var(--ink); } .wg-stamp.wg-dim { color: var(--ink-soft); opacity: .55; }
.wg-chip { display: inline-block; width: 13px; height: 13px; border: 1.5px solid currentColor; background: var(--paper-2); flex: 0 0 auto; }
.wg-chip[data-stock="first"] { background: var(--side-first); } .wg-chip[data-stock="second"] { background: var(--side-second); }

/* ---- TOP LEFT: the corner buttons, and what pops out of two of them ---- */
.wg-corners { position: absolute; left: 12px; top: 10px; display: flex; gap: 6px; align-items: flex-start; z-index: 6; }
.wg-cornerbox { position: relative; }
.wg-corner { width: 40px; height: 40px; display: grid; place-items: center; padding: 0; }
.wg-corner.wg-lit { background: var(--paper); color: var(--ink); border-color: var(--ink); }
.wg-pop { display: none; position: absolute; left: 0; top: 46px; padding: 6px; flex-direction: column; gap: 2px; z-index: 7; pointer-events: auto; min-width: 196px; }
.wg-cornerbox.wg-open .wg-pop { display: flex; }
.wg-tool { height: 34px; display: flex; align-items: center; gap: 9px; padding: 0 10px 0 7px; border: 0; background: transparent; border-radius: 5px; color: var(--paper); font: 700 11.5px/1 var(--cond); letter-spacing: .1em; text-transform: uppercase; white-space: nowrap; text-align: left; flex: 0 0 auto; }
.wg-tool.wg-on { background: var(--steel-hi); box-shadow: inset 0 0 0 1.2px var(--steel-line); }
.wg-tool .wg-key { margin-left: auto; }
.wg-tool[aria-disabled="true"] { opacity: .4; }
.wg-tool.wg-armed { background: var(--red); color: var(--paper); }
.wg-pophead { font: 700 10px/1 var(--cond); letter-spacing: .14em; text-transform: uppercase; color: var(--steel-line); padding: 7px 8px 3px; }
.wg-poptext { font: 500 11.5px/1.3 var(--body); color: var(--paper); padding: 0 8px 6px 32px; max-width: 230px; white-space: normal; opacity: .9; }
.wg-poptext.wg-quiet { opacity: .55; font-style: italic; }
.wg-vol { cursor: default; }
.wg-vol .wg-pips { margin-left: auto; display: flex; align-items: center; gap: 2px; }
.wg-vol .wg-pips button { width: 7px; height: 16px; padding: 0; border: 1.3px solid var(--brass); border-radius: 2px; background: transparent; }
.wg-vol .wg-pips button.wg-full { background: var(--brass); }
.wg-vol .wg-step { width: 22px; height: 22px; padding: 0; display: grid; place-items: center; border: 1.2px solid var(--steel-line); border-radius: 4px; background: transparent; color: var(--paper); }
.wg-vol .wg-step svg.wg-i { width: 12px; height: 12px; }

/* ---- TOP: one status plate, and one box of words hanging under it ---- */
/* The box of words is as wide as its mode asks (--mast-w), unless that would not fit: beside the corner buttons in a narrow
   window, or, with the notebook open, between its tabs and their mirror on the left (the box gives; nothing else does). */
.wg-mast { --mast-now: min(var(--mast-w), calc(100% - var(--corners-w) - 12px)); position: absolute; top: 8px; left: max(calc(50% - var(--mast-now) / 2), var(--corners-w)); width: var(--mast-now); display: flex; flex-direction: column; align-items: center; z-index: 2; pointer-events: none; }
.wg-overlay .wg-mast { --mast-w: 680px; }
.wg-nb-open:not(.wg-narrow) .wg-mast { --mast-now: min(var(--mast-w), calc(100% - var(--corners-w) - 12px), calc(100% - 2 * var(--nb-reach))); }
.wg-platewrap { position: relative; z-index: 2; max-width: 100%; }
.wg-plate { height: 46px; display: flex; align-items: stretch; overflow: hidden; white-space: nowrap; pointer-events: auto; }
.wg-plate .wg-who { display: flex; align-items: center; gap: 9px; padding: 0 16px 0 10px; background: var(--wg-go); color: var(--paper); border-right: 1.5px solid var(--wood-line); font: 700 17px/1 var(--cond); letter-spacing: .1em; text-transform: uppercase; transition: background-color .35s ease; }
.wg-plate .wg-seat { width: 30px; height: 30px; border-radius: 50%; border: 1.5px solid var(--brass); display: grid; place-items: center; background: color-mix(in srgb, black 25%, transparent); flex: 0 0 auto; }
.wg-plate .wg-seat img.wg-mk { width: 18px; height: 18px; }
.wg-plate .wg-cell { display: flex; align-items: center; gap: 8px; padding: 0 16px; border-right: 1.5px solid var(--wood-line); font: 700 19px/1 var(--cond); letter-spacing: .06em; }
.wg-plate .wg-cell:last-child { border-right: 0; }
.wg-plate small { font: 700 10px/1 var(--cond); letter-spacing: .14em; text-transform: uppercase; opacity: .75; }
.wg-plate .wg-of { opacity: .55; font-size: 14px; }
.wg-plate .wg-b { color: var(--score-second); }
.wg-plate .wg-cell svg.wg-i { width: 20px; height: 20px; }
.wg-plate .wg-cell img.wg-mk { width: 24px; height: 24px; }
.wg-plate .wg-n { min-width: 12px; text-align: center; }
.wg-flash { animation: wg-flash .7s ease; }
@keyframes wg-flash { 0% { opacity: .2; } 100% { opacity: 1; } }
.wg-ticks { display: flex; gap: 3px; align-items: center; }
.wg-ticks i { width: 7px; height: 14px; border: 1.3px solid var(--brass); border-radius: 2px; }
.wg-ticks i.wg-past { background: var(--brass); opacity: .45; }
.wg-ticks i.wg-now { background: var(--brass); height: 20px; }
.wg-ticks i.wg-last { border-color: var(--red); }
.wg-todowrap { position: relative; width: 100%; z-index: 1; margin-top: -1px; }
.wg-todo { width: 100%; padding: 9px 22px 16px; text-align: center; border-top: 0; pointer-events: auto;
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 12px), 97% 100%, 90% calc(100% - 9px), 80% 100%, 68% calc(100% - 8px), 55% 100%, 42% calc(100% - 8px), 30% 100%, 18% calc(100% - 9px), 8% 100%, 3% calc(100% - 9px), 0 100%); }
.wg-todo .wg-steps { display: none; justify-content: center; gap: 6px; align-items: center; flex-wrap: wrap; font: 700 10px/1 var(--cond); letter-spacing: .12em; text-transform: uppercase; margin-bottom: 7px; }
.wg-todo .wg-steps span { padding: 3px 6px; border: 1.2px solid var(--ink-soft); border-radius: 3px; opacity: .5; }
.wg-todo .wg-steps span.wg-now { background: var(--ink); color: var(--paper); border-color: var(--ink); opacity: 1; }
.wg-todo .wg-steps i { font-style: normal; opacity: .5; }
.wg-todo .wg-t { font: 700 15px/1.1 var(--cond); letter-spacing: .1em; text-transform: uppercase; }
.wg-todo .wg-do { font-size: 14px; line-height: 1.3; margin-top: 3px; }
.wg-todo .wg-why { display: none; font-size: 12px; color: var(--ink-soft); margin-top: 3px; }
/* The answer to the last thing done, and what a click where the pointer is would do: each keeps its line whether or not it has words, so nothing jumps. */
.wg-todo .wg-answer { margin-top: 5px; padding-top: 4px; border-top: 1px solid color-mix(in srgb, var(--ink-soft) 40%, transparent); font-size: 12.5px; line-height: 1.3; min-height: 21px; display: flex; justify-content: center; align-items: baseline; gap: 5px; }
.wg-todo .wg-answer svg.wg-i { width: 11px; height: 11px; stroke-width: 2.6; align-self: center; display: none; }
.wg-todo .wg-answer[data-kind="refused"] { color: var(--red); font-weight: 600; }
.wg-todo .wg-answer[data-kind="refused"] svg.wg-i { display: block; }
.wg-todo .wg-answer[data-kind=""] { color: var(--ink-soft); opacity: .55; }
.wg-todo .wg-answer.wg-say span { animation: wg-say .32s ease; }
@keyframes wg-say { 0% { opacity: 0; translate: 0 4px; } 100% { opacity: 1; translate: 0 0; } }
.wg-todo .wg-intent { font-size: 12px; line-height: 1.3; height: calc(2 * 1.3em); color: var(--ink-soft); white-space: normal; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; }
.wg-todo .wg-intent[data-has="0"] { opacity: .55; font-style: italic; }
.wg-overlay .wg-todo .wg-steps { display: flex; }
.wg-overlay .wg-todo .wg-steps:empty { display: none; }
.wg-overlay .wg-todo .wg-why { display: block; }
.wg-problem { display: none; margin-top: 6px; padding: 6px 10px; border-left: 5px solid var(--red); font-size: 12.5px; max-width: 100%; pointer-events: auto; text-align: left; }
.wg-problem.wg-open { display: block; }
.wg-hud.wg-enemy::after { content: ""; position: absolute; inset: 0; pointer-events: none; box-shadow: inset 0 0 0 4px var(--wg-go), inset 0 0 70px color-mix(in srgb, var(--wg-go) 40%, transparent); }

/* ---- BOTTOM CENTRE: the commands possible now ---- */
.wg-actions { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); width: min(700px, calc(100% - 640px)); display: flex; flex-direction: column; align-items: center; gap: 6px; pointer-events: none; }
.wg-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; justify-content: center; }
.wg-row:empty { display: none; }
.wg-btn { height: 46px; min-width: 46px; padding: 0 9px; display: flex; align-items: center; gap: 7px; }
.wg-btn .wg-lab { display: none; font: 700 13px/1 var(--cond); letter-spacing: .1em; text-transform: uppercase; white-space: nowrap; }
.wg-btn.wg-primary { background: var(--paper); color: var(--ink); border-color: var(--ink); }
.wg-btn.wg-lit:not(.wg-primary) { background: var(--steel-hi); box-shadow: var(--shadow), inset 0 0 0 1.5px var(--paper); }
.wg-btn[aria-disabled="true"] { opacity: .32; }
.wg-btn .wg-fno { font: 700 22px/1 var(--cond); width: 20px; text-align: center; }
.wg-btn.wg-pick { box-shadow: var(--shadow), 0 0 0 2.5px color-mix(in srgb, var(--brass) 75%, transparent); }
.wg-btn .wg-cnt { font: 700 12.5px/1 var(--cond); letter-spacing: .04em; white-space: nowrap; opacity: .8; }
.wg-gap { width: 14px; }
.wg-ctx { height: 34px; padding: 0 9px; display: flex; align-items: center; gap: 6px; }
.wg-ctx .wg-lab { font: 700 11.5px/1 var(--cond); letter-spacing: .1em; text-transform: uppercase; white-space: nowrap; }
.wg-ctx.wg-lit { background: var(--steel-hi); box-shadow: var(--shadow), inset 0 0 0 1.5px var(--paper); }
.wg-ctx.wg-off { display: none; }
.wg-overlay .wg-btn .wg-lab { display: block; }
.wg-overlay .wg-btn { padding: 0 12px; }
.wg-overlay .wg-ctx.wg-off { display: flex; opacity: .6; border-style: dashed; background: color-mix(in srgb, var(--steel) 55%, transparent); box-shadow: none; }
.wg-legend { display: none; }
.wg-overlay .wg-legend { display: flex; gap: 12px; padding: 5px 12px; font: 700 10.5px/1 var(--cond); letter-spacing: .1em; text-transform: uppercase; align-items: center; border-radius: 4px; white-space: nowrap; margin-bottom: 2px; }
.wg-overlay .wg-legend:empty { display: none; }
.wg-legend i { display: inline-block; width: 13px; height: 13px; margin-right: 5px; vertical-align: -2px; border: 1px solid var(--ink); }

/* ---- BOTTOM LEFT: the folder: the groups and their units ---- */
.wg-folder { position: absolute; left: 12px; bottom: 10px; width: 286px; pointer-events: none; }
.wg-ftab { width: 150px; height: 28px; margin-left: 10px; padding: 0; border-radius: 9px 12px 0 0; border: 1.2px solid var(--ink-soft); border-bottom: 0; background: var(--manila); display: flex; align-items: center; justify-content: center; gap: 6px; font: 700 12px/1 var(--cond); letter-spacing: .14em; text-transform: uppercase; color: var(--ink); box-shadow: var(--shadow); }
.wg-hud .wg-ftab { font: 700 12px/1 var(--cond); color: var(--ink); }
.wg-fbody { display: none; background: var(--manila); border: 1.2px solid var(--ink-soft); border-radius: 0 8px 6px 6px; padding: 8px; box-shadow: var(--shadow); pointer-events: auto; }
.wg-folder.wg-open .wg-fbody { display: block; }
.wg-folder:not(.wg-open) .wg-ftab { height: 46px; margin: 0; border-bottom: 1.2px solid var(--ink-soft); border-radius: 9px 12px 6px 6px; }
/* The sheet begins with the groups. One short line a group; only the active group is open, its units plain names under its line. */
.wg-fbody .wg-sheet { background: var(--paper); border: 1.2px solid var(--ink-soft); padding: 4px 10px; max-height: calc(var(--stage-h) - 250px); overflow-y: auto; }
.wg-frow { padding: 3px 0; border-bottom: 1px solid var(--paper-2); }
.wg-frow:last-child { border-bottom: 0; }
.wg-hud .wg-fhead { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; align-items: center; gap: 8px; width: 100%; padding: 0; border: 0; background: transparent; text-align: left; font: inherit; color: inherit; }
.wg-frow .wg-no { font: 700 14px/18px var(--cond); text-align: center; border: 1.2px solid var(--ink-soft); border-radius: 3px; }
.wg-frow .wg-nm { font: 700 12.5px/1.1 var(--cond); letter-spacing: .1em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wg-frow .wg-cnt { font: 700 12.5px/1 var(--cond); letter-spacing: .04em; color: var(--ink-soft); white-space: nowrap; }
.wg-fbody .wg-sub { font-size: 11.5px; color: var(--ink-soft); }
.wg-frow[data-open="1"] .wg-no { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.wg-frow[data-open="1"] .wg-cnt { color: var(--ink); }
/* The units of the open group: plain names in two narrow columns, no box about any of them. They never widen the sheet
   (a name too long for its column is cut short), and past eight rows, which is sixteen units, they scroll inside the
   group, so the folder grows no further. */
.wg-units { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 8px; padding: 2px 0 1px 10px; max-height: 118px; overflow-x: hidden; overflow-y: auto; }
.wg-units:empty { display: none; }
.wg-units[data-part="to-place"] { padding-left: 0; max-height: 196px; }
.wg-hud .wg-u { display: block; min-width: 0; font: 500 11px/14px var(--cond); letter-spacing: .04em; padding: 0; border: 0; border-radius: 0; text-transform: uppercase; background: transparent; color: var(--ink); text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wg-hud .wg-u.wg-sel { font-weight: 800; }
.wg-hud .wg-u.wg-dim { opacity: .45; }
.wg-hud .wg-u.wg-hit { color: var(--red); }
.wg-hud .wg-u.wg-lost { opacity: .3; text-decoration: line-through; }

/* ---- RIGHT: the notebook: unit, odds, log, keys ---- */
.wg-nb { position: absolute; right: 12px; top: var(--nb-top); width: 322px; display: none; pointer-events: auto; }
.wg-nb.wg-open { display: block; }
.wg-nbtabs { position: absolute; right: 0; top: calc(var(--nb-top) + 10px); display: flex; flex-direction: column; gap: 3px; z-index: 3; }
.wg-nb-open .wg-nbtabs { right: 334px; }
.wg-hud .wg-itab { width: 34px; height: 64px; border-radius: 7px 0 0 7px; border: 1.2px solid var(--ink-soft); border-right: 0; background: var(--paper-2); color: var(--ink); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; padding: 0; box-shadow: var(--shadow); position: relative; }
.wg-itab b { writing-mode: vertical-rl; transform: rotate(180deg); font: 700 10px/1 var(--cond); letter-spacing: .14em; text-transform: uppercase; }
.wg-hud .wg-itab.wg-on { background: var(--paper); width: 38px; margin-left: -4px; }
.wg-itab .wg-badge { display: none; position: absolute; left: -6px; top: -5px; min-width: 16px; height: 16px; border-radius: 8px; background: var(--red); color: var(--paper); font: 700 10px/16px var(--cond); text-align: center; padding: 0 3px; }
.wg-itab .wg-badge.wg-open { display: block; }
.wg-nbcover { padding: 9px 9px 9px 26px; position: relative; }
.wg-nbcover .wg-rings { position: absolute; left: 5px; top: 44px; bottom: 16px; width: 22px; background: repeating-linear-gradient(to bottom, transparent 0 9px, var(--steel-line) 9px 11px, transparent 11px 13px, var(--steel-line) 13px 15px, transparent 15px 26px); border-radius: 3px; }
.wg-nbhead { display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 4px 6px 2px; }
.wg-nbhead .wg-ttl { font: 700 15px/1 var(--cond); letter-spacing: .14em; text-transform: uppercase; flex: 1; }
.wg-hud .wg-nbhead button { width: 24px; height: 24px; display: grid; place-items: center; background: transparent; border: 1.2px solid var(--leather-line); border-radius: 4px; color: var(--paper); padding: 0; }
.wg-medal { width: 20px; height: 20px; border-radius: 50%; border: 1.5px solid var(--brass); flex: 0 0 auto; }
.wg-page { display: none; padding: 10px 12px 12px; height: min(var(--nb-page-h), calc(var(--stage-h) - var(--nb-top) - 200px)); overflow-y: auto; overflow-x: hidden; }
.wg-page.wg-on { display: block; }
.wg-empty { padding: 56px 18px 0; text-align: center; color: var(--ink-soft); font-size: 12.5px; font-style: italic; }
.wg-empty b { display: block; font: 700 13px/1.2 var(--cond); letter-spacing: .14em; text-transform: uppercase; font-style: normal; margin-bottom: 6px; }
.wg-pic { height: 104px; border: 1.2px dashed var(--ink-soft); display: grid; place-items: center; color: var(--ink-soft); font: 600 10px/1 var(--cond); letter-spacing: .12em; text-transform: uppercase; position: relative; }
.wg-hud .wg-pic svg.wg-i { width: 150px; height: 70px; stroke-width: 1.3; }
.wg-pic img { max-width: 100%; max-height: 100px; object-fit: contain; display: block; }
.wg-pic .wg-cap { position: absolute; right: 6px; bottom: 5px; }
.wg-whoo { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin: 8px 0 2px; }
.wg-whoo b { font: 700 18px/1 var(--cond); letter-spacing: .1em; text-transform: uppercase; }
.wg-whoo .wg-stamp { font-size: 10px; flex: 0 0 auto; }
.wg-role { font-style: italic; color: var(--ink-soft); font-size: 12.5px; min-height: 16px; }
.wg-tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin: 8px 0; }
.wg-tile { border: 1.2px solid var(--paper-2); border-radius: 5px; padding: 5px 6px 4px; display: grid; grid-template-columns: 18px 1fr; column-gap: 5px; align-items: center; }
.wg-tile svg { grid-row: 1 / 3; }
.wg-tile b { font: 700 16px/1 var(--cond); white-space: nowrap; }
.wg-tile span { font: 700 9.5px/1.1 var(--cond); letter-spacing: .1em; text-transform: uppercase; color: var(--ink-soft); }
.wg-line { display: flex; justify-content: space-between; gap: 10px; padding: 4px 0; border-top: 1px solid var(--paper-2); font-size: 12.5px; }
.wg-line span:first-child { font: 700 10.5px/1.5 var(--cond); letter-spacing: .12em; text-transform: uppercase; color: var(--ink-soft); white-space: nowrap; }
.wg-line span:last-child { text-align: right; }
.wg-about { font-size: 12px; color: var(--ink-soft); margin-top: 6px; border-top: 1px solid var(--paper-2); padding-top: 6px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.wg-about:empty { display: none; }
.wg-h { font: 700 12px/1.15 var(--cond); letter-spacing: .12em; text-transform: uppercase; background: var(--ink); color: var(--paper); padding: 5px 7px; margin: 0 0 6px; display: flex; justify-content: space-between; gap: 8px; }
.wg-h span + span { white-space: nowrap; }
.wg-page h6, .wg-dossier h6 { grid-column: 1 / 3; margin: 8px 0 2px; font: 700 10.5px/1 var(--cond); letter-spacing: .14em; text-transform: uppercase; color: var(--ink-soft); }
.wg-figs { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; margin: 0 0 4px; }
.wg-figs span span { font: 700 10px/1 var(--cond); letter-spacing: .12em; text-transform: uppercase; color: var(--ink-soft); margin-right: 5px; }
.wg-figs b { font: 700 15px/1 var(--cond); }
.wg-shot { display: grid; grid-template-columns: 1fr 48px; gap: 2px 8px; align-items: center; padding: 5px 0; border-bottom: 1px solid var(--paper-2); font-size: 12.5px; }
.wg-shot small { display: block; color: var(--ink-soft); font-size: 11px; }
.wg-shot b { font: 700 17px/1 var(--cond); text-align: right; grid-row: 1 / 3; grid-column: 2; }
.wg-bar { grid-column: 1; height: 5px; background: var(--paper-2); border-radius: 3px; overflow: hidden; }
.wg-bar i { display: block; height: 100%; background: var(--red); transition: width .25s ease; }
.wg-shot[data-tone="plain"] .wg-bar i { background: var(--ink-soft); }
.wg-risk { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 8px; font: 700 12px/1.2 var(--cond); letter-spacing: .12em; text-transform: uppercase; }
.wg-oddsnote { margin-top: 8px; font-size: 12px; color: var(--ink-soft); }
.wg-oddsnote[data-pinned="1"] { color: var(--ink); font-weight: 600; }
.wg-roll { margin-top: 12px; }
.wg-dice { display: flex; align-items: center; gap: 8px; margin: 6px 0 2px; min-height: 36px; }
.wg-die { width: 34px; height: 34px; border-radius: 7px; border: 1.5px solid var(--ink); background: var(--paper); display: grid; place-items: center; font: 700 18px/1 var(--cond); color: var(--ink); flex: 0 0 auto; }
.wg-die.wg-first { background: var(--red); color: var(--paper); border-color: var(--red); }
.wg-die.wg-blank { border-style: dashed; background: transparent; }
.wg-dice .wg-sum { font: 700 17px/1 var(--cond); }
.wg-dice .wg-stamp { margin-left: auto; }
.wg-logl { display: grid; grid-template-columns: 10px 1fr; gap: 7px; padding: 4px 0; border-bottom: 1px solid var(--paper-2); font-size: 12.5px; }
.wg-logl i { width: 9px; height: 9px; margin-top: 4px; background: var(--paper-2); border: 1px solid var(--ink); }
.wg-logl[data-stock="first"] i { background: var(--side-first); }
.wg-logl[data-stock="second"] i { background: var(--side-second); }
.wg-logl[data-turn="1"] { font-weight: 700; border-top: 1.5px solid var(--ink); }
.wg-keys { display: grid; grid-template-columns: auto 1fr; gap: 5px 10px; align-items: center; font-size: 12.5px; }
.wg-keys .wg-key { justify-self: start; }

/* ---- the full panels: the briefing, the rule book, the result ---- */
.wg-catch { display: none; position: absolute; inset: 0; pointer-events: auto; z-index: 5; }
.wg-full-open .wg-catch { display: block; }
.wg-dossier { display: none; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(1060px, calc(100% - 60px)); height: min(660px, calc(var(--stage-h) - 150px)); z-index: 20; background: var(--manila); border: 1.5px solid var(--ink-soft); border-radius: 4px 14px 8px 8px; box-shadow: 0 0 0 4000px color-mix(in srgb, black 45%, transparent), var(--shadow); padding: 14px; pointer-events: auto; }
.wg-dossier.wg-open { display: block; }
.wg-dossier .wg-tabname { position: absolute; left: 24px; top: -27px; height: 28px; padding: 0 18px; background: var(--manila); border: 1.5px solid var(--ink-soft); border-bottom: 0; border-radius: 9px 12px 0 0; display: flex; align-items: center; font: 700 12px/1 var(--cond); letter-spacing: .16em; text-transform: uppercase; white-space: nowrap; }
.wg-hud .wg-dossier .wg-x { position: absolute; right: 14px; top: -22px; height: 34px; padding: 0 12px; display: flex; align-items: center; gap: 7px; font: 700 12px/1 var(--cond); letter-spacing: .12em; text-transform: uppercase; color: var(--paper); }
.wg-dossier .wg-sheet { height: 100%; display: grid; grid-template-columns: 330px 1fr 250px; gap: 0; background: var(--paper); border: 1.2px solid var(--ink-soft); }
.wg-dossier .wg-col { padding: 16px 18px; border-right: 1px solid var(--paper-2); overflow: hidden auto; min-width: 0; }
.wg-dossier .wg-col:last-child { border-right: 0; }
.wg-dossier h1 { margin: 10px 0 2px; font: 700 26px/1 var(--cond); letter-spacing: .08em; text-transform: uppercase; }
.wg-dossier .wg-date { font: 700 11px/1.2 var(--cond); letter-spacing: .16em; text-transform: uppercase; color: var(--ink-soft); }
.wg-dossier p { font-size: 13px; line-height: 1.45; margin: 10px 0 0; }
.wg-dossier p.wg-small { color: var(--ink-soft); font-size: 11.5px; }
.wg-photo { height: 190px; border: 1.2px dashed var(--ink-soft); display: grid; place-items: center; position: relative; transform: rotate(-1.2deg); background: var(--paper-2); font: 600 10px/1.4 var(--cond); letter-spacing: .12em; text-transform: uppercase; color: var(--ink-soft); text-align: center; }
.wg-hud .wg-photo svg.wg-i { width: 190px; height: 90px; stroke-width: 1.2; }
.wg-photo img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: none; }
.wg-clip { position: absolute; left: 22px; top: -14px; width: 16px; height: 44px; border: 2px solid var(--steel-line); border-radius: 8px; }
.wg-dossier h2 { margin: 0 0 6px; font: 700 12px/1.1 var(--cond); letter-spacing: .14em; text-transform: uppercase; background: var(--ink); color: var(--paper); padding: 6px 8px; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.wg-dossier h2 > span:first-child { display: flex; align-items: center; gap: 6px; }
.wg-hud .wg-dossier h2 svg.wg-i { width: 16px; height: 16px; }
.wg-dossier h2 img.wg-mk { display: none; }
.wg-forces { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
.wg-forces > div { position: relative; min-width: 0; }
/* A side's long name wraps; who plays it ("You", "Computer") stays whole at the right. A short name keeps the header's height. */
/* (Where a word of the name is too wide to stand beside who plays it, who plays it goes under the name: hud-full.ts.) */
.wg-forces h2.wg-hwrap { flex-wrap: wrap; row-gap: 2px; }
.wg-forces h2 > span:first-child { flex: 1 1 auto; min-width: 0; }
.wg-forces h2 > span:last-child { flex: 0 0 auto; margin-left: auto; white-space: nowrap; }
/* A group of a side's force (as its list prints it) is one block, which a page never breaks. */
.wg-fblock { display: flow-root; }
.wg-fblock[hidden] { display: none; }
/* A force too long even set close is shown a page at a time: the pager at the foot of the column. */
.wg-pager { display: none; }
.wg-dossier .wg-col.wg-paged { display: flex; flex-direction: column; }
.wg-paged .wg-forces { flex: 1 0 auto; align-items: start; }
.wg-paged .wg-pager { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 8px; flex: 0 0 auto; }
.wg-pager .wg-page-btn .wg-lab { display: block; }
.wg-hud .wg-pager .wg-page-btn { height: 28px; padding: 0 12px; display: flex; align-items: center; font: 700 11px/1 var(--cond); letter-spacing: .12em; text-transform: uppercase; color: var(--paper); }
.wg-page-of { font: 700 11px/1 var(--cond); letter-spacing: .14em; text-transform: uppercase; color: var(--ink-soft); }
.wg-aim { font-style: italic; color: var(--ink-soft); font-size: 12px; line-height: 1.3; margin: 0 0 2px; }
.wg-fm { font: 700 10.5px/1 var(--cond); letter-spacing: .14em; text-transform: uppercase; color: var(--ink-soft); margin: 9px 0 3px; }
.wg-ur { display: grid; grid-template-columns: 36px 1fr auto; gap: 7px; align-items: center; padding: 3px 0; border-bottom: 1px solid var(--paper-2); font-size: 12.5px; }
.wg-hud .wg-ur svg.wg-i { width: 34px; height: 16px; stroke-width: 1.4; }
.wg-ur img { width: 36px; height: 20px; object-fit: contain; }
.wg-ur b { font: 700 13px/1 var(--cond); }
.wg-dense .wg-fm { margin: 5px 0 1px; }
.wg-dense .wg-ur { padding: 0; font-size: 11.5px; line-height: 1.15; }
.wg-dense .wg-ur img { height: 16px; }
.wg-tot { display: flex; justify-content: space-between; align-items: baseline; margin: 6px 0 0; padding-bottom: 5px; border-bottom: 1.5px solid var(--ink-soft); font: 700 13px/1 var(--cond); letter-spacing: .12em; text-transform: uppercase; }
.wg-tot b { font-size: 20px; }
.wg-mapthumb { height: 120px; border: 1.2px dashed var(--ink-soft); margin: 8px 0; display: grid; place-items: stretch; overflow: hidden; background: var(--paper-2); }
.wg-mapthumb svg { width: 100%; height: 100%; display: block; }
.wg-objl { display: grid; grid-template-columns: 22px 1fr auto; gap: 8px; align-items: center; padding: 4px 0; border-bottom: 1px solid var(--paper-2); font-size: 12.5px; }
.wg-hud .wg-objl svg.wg-i { width: 20px; height: 20px; stroke: var(--ink); }
.wg-objl[data-stock="first"] svg.wg-i { fill: var(--side-first); }
.wg-objl[data-stock="second"] svg.wg-i { fill: var(--side-second); }
.wg-objl b { font: 700 14px/1 var(--cond); white-space: nowrap; }
.wg-dossier .wg-go { margin-top: 14px; width: 100%; height: 46px; justify-content: center; }
.wg-dossier .wg-go .wg-lab { display: block; }
.wg-rulebook .wg-sheet { grid-template-columns: 250px 1fr; }
.wg-hud .wg-toc button { display: flex; width: 100%; align-items: center; gap: 9px; padding: 8px 8px; border: 0; border-bottom: 1px solid var(--paper-2); background: transparent; text-align: left; font: 700 13px/1.1 var(--cond); letter-spacing: .1em; text-transform: uppercase; color: var(--ink); }
.wg-hud .wg-toc button.wg-on { background: var(--ink); color: var(--paper); }
.wg-toc .wg-n { width: 18px; font-size: 16px; text-align: center; opacity: .7; flex: 0 0 auto; }
.wg-rbody { display: grid; grid-template-columns: 1fr 300px; gap: 22px; }
.wg-rbody h1 { margin-top: 0; }
.wg-rtable { border: 1.2px dashed var(--ink-soft); background: var(--paper-2); padding: 10px 12px 8px; align-self: start; }
.wg-rtable .wg-line:first-of-type { border-top: 0; }
.wg-rtable h6 { margin-top: 0; }
.wg-rulebook ol { margin: 8px 0 0; padding-left: 20px; font-size: 13.5px; line-height: 1.5; }
.wg-rulebook li { margin-bottom: 5px; }
.wg-tip { margin-top: 12px; padding: 8px 10px; border: 1.2px solid var(--ink-soft); border-left: 5px solid var(--red); font-size: 12.5px; }
.wg-result { width: min(620px, calc(100% - 60px)); height: auto; }
.wg-result .wg-sheet { display: block; height: auto; padding: 20px 24px 18px; }
.wg-result h1 { margin: 0 0 10px; font-size: 24px; line-height: 1.1; text-transform: none; letter-spacing: .02em; }
.wg-result .wg-scores { display: grid; grid-template-columns: 26px 1fr auto auto; gap: 0 16px; align-items: center; font-size: 13.5px; }
.wg-result .wg-scores > * { padding: 6px 0; border-bottom: 1px solid var(--paper-2); }
.wg-result .wg-scores .wg-hd { font: 700 10.5px/1 var(--cond); letter-spacing: .14em; text-transform: uppercase; color: var(--ink-soft); text-align: right; }
.wg-result .wg-scores b { font: 700 20px/1 var(--cond); text-align: right; }
.wg-hud .wg-result .wg-scores svg.wg-i { width: 20px; height: 20px; }
.wg-result .wg-scores img.wg-mk { width: 22px; height: 22px; }
.wg-result .wg-seed { margin-top: 8px; font-size: 11.5px; color: var(--ink-soft); }
.wg-result .wg-acts { display: flex; gap: 10px; margin-top: 16px; }
.wg-result .wg-acts .wg-btn { flex: 1 1 0; justify-content: center; }
.wg-result .wg-acts .wg-lab { display: block; }

/* ---- OVERLAY MODE: the interface teaches ---- */
.wg-coach { display: none; }
.wg-overlay .wg-coach { display: block; position: absolute; width: max-content; max-width: 210px; padding: 6px 9px 6px 28px; font: 400 12px/1.3 var(--body); letter-spacing: 0; text-transform: none; text-align: left; white-space: normal; border-radius: 4px; z-index: 5; pointer-events: none; }
.wg-coach b { position: absolute; left: 6px; top: 6px; width: 16px; height: 16px; border-radius: 50%; background: var(--red); color: var(--paper); font: 700 11px/16px var(--cond); text-align: center; }
.wg-coach::after { content: ""; position: absolute; background: var(--red); }
.wg-coach.wg-down::after { left: 14px; top: 100%; width: 1.5px; height: 14px; }
.wg-coach.wg-up::after { left: 14px; bottom: 100%; width: 1.5px; height: 14px; }
.wg-coach.wg-right::after { left: 100%; top: 14px; width: 14px; height: 1.5px; }
.wg-coach.wg-left::after { right: 100%; top: 14px; width: 14px; height: 1.5px; }
.wg-coach[data-note="1"] { left: calc(100% + 16px); top: 4px; }
.wg-coach[data-note="2"] { right: calc(100% + 16px); top: 66px; }
.wg-coach[data-note="3"] { left: calc(100% + 16px); bottom: 30px; }
.wg-coach[data-note="4"] { right: 150px; top: calc(var(--nb-top) + 278px); }
.wg-nb-open .wg-coach[data-note="4"] { right: 392px; }
.wg-coach[data-note="5"] { left: 0; top: 56px; max-width: 230px; }
.wg-cornerbox.wg-open ~ .wg-coach[data-note="5"] { display: none; }

/* ---- a window narrower than the design's stage: the notebook hangs below the box of words ---- */
.wg-narrow { --nb-top: 272px; }
`;
