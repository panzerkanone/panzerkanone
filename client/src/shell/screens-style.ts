/**
 * The stylesheet of the settings screen, the scenario list and the side selector, and of the
 * switching between screens (the title's own is style.ts, and its @font-face serves all of them).
 *
 * Every length is in stage pixels (stage.ts): the stage is scaled to the window as one thing. Places
 * come from screen-places.ts as inline styles. Colours are read off the owner's finished pictures.
 * Nothing snaps: every change of state is eased; a viewer who asks for less motion gets it at once.
 */
import { ABOUT_PLACES, SCENARIO_PLACES } from './screen-places';
import { EASE } from './style';

/** Seconds a screen takes to come in over the one before. */
export const SWITCH_S = 0.28;
/** Seconds a page of the settings' folder takes to come in over the other. */
export const LEAF_S = 0.25;

export function screensCss(): string {
  return `
/* The scenario list's fades, as lengths that ease. */
@property --list-above { syntax: "<length>"; inherits: false; initial-value: 0px; }
@property --list-below { syntax: "<length>"; inherits: false; initial-value: 0px; }

/* One screen at a time: the one shown comes in over the one before. */
.sh-screen { position: absolute; inset: 0; overflow: hidden; opacity: 0; visibility: hidden; transition: opacity ${SWITCH_S}s ease, visibility 0s linear ${SWITCH_S}s; }
.sh-screen.sh-current { opacity: 1; visibility: visible; transition: opacity ${SWITCH_S}s ease, visibility 0s; z-index: 1; }
.sh-set, .sh-side, .sh-list {
  background: rgb(10, 9, 8); color: rgb(236, 216, 176);
  font-family: "Stick No Bills", "Arial Narrow", Impact, sans-serif; font-weight: 800; -webkit-font-smoothing: antialiased;
  user-select: none; -webkit-user-select: none;
  --ink: rgb(46, 38, 32); --red-ink: rgb(158, 40, 30); --strip-red: rgb(198, 66, 50); --glow: rgb(255, 104, 52); --lit-text: rgb(255, 178, 146);
}
.sh-picture { position: absolute; background-size: 100% 100%; background-repeat: no-repeat; pointer-events: none; }

/* The word on a heading strip: red stencil paint on the wood. */
.sh-strip-word {
  position: absolute; margin: 0; transform: translate(-50%, -50%); white-space: nowrap; font: inherit; line-height: 1; letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--strip-red); opacity: 0.86; pointer-events: none;
  text-shadow: 0 -2px 1px rgba(0, 0, 0, 0.35), 0 2px 2px rgba(0, 0, 0, 0.3);
}
/* A heading printed on a notebook page, with its rule under it. */
.sh-page-head {
  position: absolute; transform: translate(-50%, -50%); white-space: nowrap; line-height: 1; letter-spacing: 0.02em; text-transform: uppercase;
  color: var(--ink); opacity: 0.9; mix-blend-mode: multiply; pointer-events: none; padding: 0 10px 18px;
}
.sh-page-head::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 6px; background: var(--ink); opacity: 0.85; border-radius: 1px; }
.sh-page-head:empty { display: none; }

/* The line that answers a press. */
.sh-answer-line { z-index: 5; }
.sh-answer-line.sh-refused { border-color: rgb(170, 60, 44); }

/* ---- the settings ----------------------------------------------------------------------------- */
.sh-slider-label {
  position: absolute; transform: translate(-100%, -50%); white-space: nowrap; line-height: 1; text-transform: uppercase; letter-spacing: 0.03em;
  color: var(--ink); opacity: 0.88; mix-blend-mode: multiply; pointer-events: none; padding-right: 18px;
}
.sh-slider { position: absolute; cursor: pointer; outline: none; touch-action: none; border-radius: 16px; }
.sh-slider:focus-visible { box-shadow: 0 0 0 4px rgba(158, 40, 30, 0.45); }
.sh-slider.sh-off { cursor: not-allowed; }
.sh-knob { width: auto; filter: drop-shadow(0 7px 6px rgba(0, 0, 0, 0.45)); transition: left 0.18s cubic-bezier(0.2, 0.7, 0.2, 1), filter ${EASE.plate}s ease; }
.sh-knob.sh-held { transition: left 0.04s linear, filter ${EASE.plate}s ease; filter: drop-shadow(0 10px 8px rgba(0, 0, 0, 0.5)) brightness(1.06); }
.sh-holding { cursor: grabbing; }

.sh-picks { position: absolute; inset: 0; pointer-events: none; }
.sh-pick { position: absolute; margin: 0; padding: 0; border: 0; background: none; font: inherit; cursor: pointer; outline: none; pointer-events: auto; -webkit-tap-highlight-color: transparent; }
.sh-pick > .sh-picture { transition: opacity ${EASE.plate}s ease, filter ${EASE.plate}s ease, transform ${EASE.press}s ease-out; }
.sh-pick-lit { opacity: 0; }
.sh-pick.sh-chosen .sh-pick-lit { opacity: 1; filter: drop-shadow(0 0 10px rgba(255, 92, 48, 0.75)) drop-shadow(0 0 3px rgba(255, 140, 90, 0.9)); }
.sh-pick-text {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -52%); white-space: nowrap; line-height: 1; text-transform: uppercase; letter-spacing: 0.02em;
  color: rgb(196, 190, 180); text-shadow: 0 -2px 1px rgba(0, 0, 0, 0.75), 0 2px 1px rgba(255, 255, 255, 0.18);
  transition: color ${EASE.plate}s ease, text-shadow ${EASE.plate}s ease, transform ${EASE.press}s ease-out;
}
.sh-pick.sh-chosen .sh-pick-text { color: var(--lit-text); text-shadow: 0 0 10px rgba(255, 96, 50, 0.85), 0 0 2px rgba(255, 210, 190, 0.9), 0 -2px 1px rgba(60, 10, 0, 0.6); }
.sh-pick:hover .sh-pick-plain, .sh-pick:focus-visible .sh-pick-plain { filter: brightness(1.14); }
.sh-pick:hover .sh-pick-text, .sh-pick:focus-visible .sh-pick-text { color: rgb(236, 226, 210); }
.sh-pick.sh-chosen:hover .sh-pick-text, .sh-pick.sh-chosen:focus-visible .sh-pick-text { color: rgb(255, 200, 176); }
.sh-pick.sh-down > .sh-picture { transform: translateY(3px) scale(0.985); filter: brightness(0.84); }
.sh-pick.sh-down .sh-pick-text { transform: translate(-50%, -52%) translateY(3px) scale(0.985); }
.sh-frame { position: absolute; pointer-events: none; mix-blend-mode: multiply; transition: left 0.2s cubic-bezier(0.2, 0.7, 0.2, 1), top 0.2s cubic-bezier(0.2, 0.7, 0.2, 1); }
.sh-frame-line { position: absolute; inset: 0; box-sizing: border-box; border: 7px solid var(--red-ink); border-radius: 22px; opacity: 0.9; }
.sh-frame-line.sh-gapped {
  -webkit-mask: linear-gradient(black, black) top / 100% calc(100% - 24px) no-repeat,
    linear-gradient(to right, black var(--from), transparent var(--from), transparent var(--to), black var(--to)) bottom / 100% 24px no-repeat;
  mask: linear-gradient(black, black) top / 100% calc(100% - 24px) no-repeat,
    linear-gradient(to right, black var(--from), transparent var(--from), transparent var(--to), black var(--to)) bottom / 100% 24px no-repeat;
}
.sh-rail { position: absolute; box-sizing: border-box; border-style: solid; border-color: transparent; pointer-events: none; }
.sh-frame-word { position: absolute; left: 50%; bottom: 0; transform: translate(-50%, 50%); font-family: system-ui, sans-serif; font-weight: 700; line-height: 1; color: var(--red-ink); white-space: nowrap; }
.sh-pick-note {
  position: absolute; font-family: Georgia, "Times New Roman", serif; font-weight: 400; font-size: 25px; line-height: 30px; color: var(--ink);
  mix-blend-mode: multiply; opacity: 0.92; text-align: center; pointer-events: none; transition: opacity ${EASE.plate}s ease;
}
.sh-pick-note.sh-preview { opacity: 0.62; font-style: italic; }

/* The right-hand page's two leaves (its "Files" and its Advanced page): the one shown fades in over the other. */
.sh-leaf { transition: opacity ${LEAF_S}s ease, visibility 0s linear 0s; }
.sh-frame.sh-leaf { transition: left 0.2s cubic-bezier(0.2, 0.7, 0.2, 1), top 0.2s cubic-bezier(0.2, 0.7, 0.2, 1), opacity ${LEAF_S}s ease, visibility 0s linear 0s; }
.sh-leaf.sh-leaf-away { opacity: 0; visibility: hidden; pointer-events: none; transition: opacity ${LEAF_S}s ease, visibility 0s linear ${LEAF_S}s; }
.sh-frame.sh-leaf.sh-leaf-away { transition: left 0.2s, top 0.2s, opacity ${LEAF_S}s ease, visibility 0s linear ${LEAF_S}s; }
.sh-blank-page { position: absolute; pointer-events: none; }
.sh-blank-page:not(.sh-drawn) { display: none; }
/* The Advanced page's list of options: rows ruled like a ledger, each a name, a short line and a checkbox in the page's
   ink. Past what the page holds it scrolls (the browser's own scrolling, eased when the keys move it), with no bar, and
   fades softly at the top and the foot where there is more. */
.sh-option-list { position: absolute; overflow: hidden; pointer-events: auto; }
.sh-option-list.sh-scrolls {
  overflow-y: auto; overscroll-behavior: contain; scroll-behavior: smooth; scrollbar-width: none;
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, black var(--list-above), black calc(100% - var(--list-below)), transparent 100%);
  mask-image: linear-gradient(to bottom, transparent 0, black var(--list-above), black calc(100% - var(--list-below)), transparent 100%);
  transition: --list-above ${EASE.plate}s ease, --list-below ${EASE.plate}s ease;
}
.sh-option-list.sh-scrolls::-webkit-scrollbar { display: none; }
.sh-option-list.sh-more-above { --list-above: var(--fade); }
.sh-option-list.sh-more-below { --list-below: var(--fade); }
.sh-option {
  position: relative; display: block; width: 100%; margin: 0; padding: 0; border: 0; background: none; font: inherit; color: var(--ink); text-align: left;
  cursor: pointer; outline: none; -webkit-tap-highlight-color: transparent;
}
.sh-option + .sh-option::before { content: ""; position: absolute; left: 14px; right: 14px; top: 0; height: 2px; background: var(--ink); opacity: 0.22; border-radius: 1px; }
.sh-option-ring {
  position: absolute; inset: 6px 4px; box-sizing: border-box; border: 5px solid var(--red-ink); border-radius: 18px; opacity: 0;
  transition: opacity ${EASE.plate}s ease; pointer-events: none;
}
.sh-option:focus-visible .sh-option-ring { opacity: 0.85; }
.sh-option:hover .sh-option-ring { opacity: 0.35; }
.sh-option-name {
  position: absolute; left: 22px; top: 14px; white-space: nowrap; line-height: 1; text-transform: uppercase; letter-spacing: 0.03em; opacity: 0.9;
}
.sh-option-line {
  position: absolute; left: 22px; right: 110px; bottom: 16px; font-family: Georgia, "Times New Roman", serif; font-weight: 400; line-height: 1.15;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.88;
}
.sh-check { position: absolute; top: 50%; transform: translateY(-50%); overflow: visible; transition: transform ${EASE.press}s ease-out; }
.sh-check > svg { display: block; width: 100%; height: 100%; overflow: visible; }
.sh-check-box { fill: rgba(255, 250, 235, 0.18); stroke: var(--ink); stroke-width: 3.6; stroke-linejoin: round; opacity: 0.85; }
.sh-check-tick {
  fill: none; stroke: var(--red-ink); stroke-width: 7; stroke-linecap: round; stroke-linejoin: round; opacity: 0.92;
  stroke-dasharray: 1; stroke-dashoffset: 1; transition: stroke-dashoffset ${EASE.plate * 1.5}s ease-out;
}
.sh-option.sh-on .sh-check-tick { stroke-dashoffset: 0; }
/* A row that opens something (the About panel): a chevron in the box, in the same ink. */
.sh-open-mark { fill: none; stroke: var(--red-ink); stroke-width: 4.6; stroke-linecap: round; stroke-linejoin: round; opacity: 0.9; }
.sh-option.sh-down .sh-check { transform: translateY(-50%) translateY(2px) scale(0.96); }
/* The two emblems at the page's foot: laid on with only their own paper close round them, eased out, so that the paper
   made over the painted buttons (the Advanced page) meets them with no edge. */
.sh-emblems {
  -webkit-mask-image: radial-gradient(50px 50px at 55px 52px, black 86%, transparent 100%), radial-gradient(70px 60px at 168px 46px, black 84%, transparent 100%);
  mask-image: radial-gradient(50px 50px at 55px 52px, black 86%, transparent 100%), radial-gradient(70px 60px at 168px 46px, black 84%, transparent 100%);
}
/* A folder tab: the whole tab takes a press. Both words are written here, in the stencil of the page's headings; the tab
   in front (its page open) is in full ink with a red rule under its word, the one behind it is shaded and its word paler. */
.sh-tab-hit { position: absolute; margin: 0; padding: 0; border: 0; background: none; font: inherit; cursor: pointer; outline: none; border-radius: 14px 14px 0 0; -webkit-tap-highlight-color: transparent; }
.sh-tab-hit:focus-visible { box-shadow: 0 0 0 4px rgba(158, 40, 30, 0.45); }
.sh-tab-shade {
  position: absolute; inset: 0; pointer-events: none; mix-blend-mode: multiply; opacity: 1; transition: opacity ${LEAF_S}s ease;
  background: radial-gradient(ellipse 50% 70% at 50% 62%, rgba(96, 70, 44, 0.3), rgba(96, 70, 44, 0.18) 62%, rgba(96, 70, 44, 0) 100%);
}
.sh-tab-hit.sh-tab-open .sh-tab-shade { opacity: 0; }
.sh-tab-word {
  position: absolute; display: block; height: 1em; transform: translate(-50%, -50%); white-space: nowrap; line-height: 1; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--ink); opacity: 0.5; mix-blend-mode: multiply; transition: opacity ${EASE.plate}s ease, transform ${EASE.press}s ease-out;
}
.sh-tab-hit.sh-tab-open .sh-tab-word { opacity: 0.92; }
.sh-tab-word::after { content: ""; position: absolute; left: -6px; right: -6px; bottom: -12px; height: 5px; border-radius: 2px; background: var(--red-ink); opacity: 0; transition: opacity ${LEAF_S}s ease; }
.sh-tab-hit.sh-tab-open .sh-tab-word::after { opacity: 0.85; }
.sh-tab-hit:hover .sh-tab-word, .sh-tab-hit:focus-visible .sh-tab-word { opacity: 1; }
.sh-tab-hit.sh-down .sh-tab-word { transform: translate(-50%, -50%) translateY(2px); }

/* A tag at the foot: lit (an orange glow, the words glowing) under the pointer or the keyboard's focus, as the owner drew it. */
.sh-tag {
  position: absolute; margin: 0; padding: 0; border: 0; font: inherit; cursor: pointer; outline: none; background-color: transparent; background-size: 100% 100%;
  -webkit-tap-highlight-color: transparent; transition: filter ${EASE.plate}s ease, transform ${EASE.press}s ease-out;
}
.sh-tag-text {
  position: absolute; transform: translate(-50%, -50%); white-space: nowrap; line-height: 1; text-transform: uppercase; letter-spacing: 0.03em;
  color: rgb(40, 36, 33); text-shadow: 0 2px 0 rgba(255, 255, 255, 0.22); transition: color ${EASE.plate}s ease, text-shadow ${EASE.plate}s ease;
}
.sh-tag:hover, .sh-tag:focus-visible { filter: drop-shadow(0 0 9px rgba(255, 96, 44, 0.85)) drop-shadow(0 0 2px rgba(255, 150, 90, 0.9)) brightness(0.9); }
.sh-tag:hover .sh-tag-text, .sh-tag:focus-visible .sh-tag-text { color: var(--lit-text); text-shadow: 0 0 10px rgba(255, 90, 40, 0.95), 0 0 2px rgba(255, 220, 200, 0.8); }
.sh-tag.sh-down { transform: translateY(3px) scale(0.99); }

/* ---- the side selector -------------------------------------------------------------------------- */
.sh-side-page { position: absolute; cursor: pointer; }
.sh-tank { pointer-events: auto; cursor: pointer; transition: filter 0.45s ease; filter: drop-shadow(0 6px 10px rgba(30, 20, 10, 0.25)) saturate(0.9) brightness(0.96); }
.sh-tank.sh-chosen { filter: drop-shadow(0 10px 16px rgba(30, 20, 10, 0.35)) saturate(1.05) brightness(1.03); }
.sh-side-name { mix-blend-mode: multiply; }

/* Multiplayer: the invitation link once the game is made, or a line on an invitation; in the band between the pages and the tags. */
.sh-invite {
  position: absolute; display: flex; align-items: center; gap: 22px; box-sizing: border-box; padding: 0 22px;
  background: rgba(22, 21, 20, 0.94); border: 3px solid rgb(92, 88, 82); border-radius: 8px; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
  opacity: 0; visibility: hidden; transition: opacity 0.3s ease, visibility 0s linear 0.3s;
}
.sh-invite.sh-shown { opacity: 1; visibility: visible; transition: opacity 0.3s ease, visibility 0s; }
.sh-invite-label, .sh-invite-note { white-space: nowrap; font-size: 40px; line-height: 1; text-transform: uppercase; letter-spacing: 0.03em; color: rgb(236, 216, 176); }
.sh-invite-note { flex: 1 1 auto; text-align: center; }
.sh-invite-link {
  flex: 1 1 auto; min-width: 0; height: 64px; box-sizing: border-box; padding: 0 16px; border: 2px solid rgb(120, 112, 100); border-radius: 6px;
  background: rgb(240, 232, 214); color: rgb(40, 36, 33); font: 500 28px/1 ui-monospace, Menlo, monospace; user-select: text; -webkit-user-select: text; outline: none;
}
.sh-invite-copy {
  flex: 0 0 auto; height: 64px; padding: 0 28px; border: 0; border-radius: 6px; background: var(--strip-red); color: rgb(255, 236, 220);
  font: inherit; font-size: 40px; line-height: 1; text-transform: uppercase; letter-spacing: 0.03em; cursor: pointer; outline: none;
  transition: filter ${EASE.plate}s ease, box-shadow ${EASE.plate}s ease;
}
.sh-invite-copy:hover, .sh-invite-copy:focus-visible { filter: brightness(1.15); box-shadow: 0 0 0 4px rgba(255, 104, 52, 0.55); }
.sh-invite-copy.sh-down { transform: translateY(3px); }

/* The rays: a soft halo and two sets of rays turning opposite ways, bright behind the chosen side. */
.sh-rays { position: absolute; pointer-events: none; opacity: 0.32; transition: opacity 0.55s ease; --at: 0s; }
.sh-rays.sh-bright { opacity: 1; }
.sh-halo, .sh-ray { position: absolute; inset: 0; border-radius: 50%; }
.sh-halo { background: radial-gradient(circle, rgba(255, 238, 200, 0.95) 0%, rgba(255, 214, 150, 0.6) calc(var(--halo) * 0.55), rgba(255, 196, 120, 0) var(--halo)); mix-blend-mode: screen; }
.sh-ray {
  will-change: transform; mix-blend-mode: multiply;
  -webkit-mask-image: radial-gradient(circle, rgba(0, 0, 0, 0) 9%, rgba(0, 0, 0, 1) 22%, rgba(0, 0, 0, 0.55) 46%, rgba(0, 0, 0, 0) 70%);
  mask-image: radial-gradient(circle, rgba(0, 0, 0, 0) 9%, rgba(0, 0, 0, 1) 22%, rgba(0, 0, 0, 0.55) 46%, rgba(0, 0, 0, 0) 70%);
}
.sh-ray-a { background: repeating-conic-gradient(from 0deg, rgba(176, 72, 34, 0.34) 0deg 5.5deg, rgba(176, 72, 34, 0) 7.5deg 13deg, rgba(176, 72, 34, 0.34) 15deg); animation: sh-turn 120s linear infinite; animation-delay: var(--at); }
.sh-ray-b { background: repeating-conic-gradient(from 4deg, rgba(150, 52, 26, 0.22) 0deg 2.5deg, rgba(150, 52, 26, 0) 4deg 18.5deg, rgba(150, 52, 26, 0.22) 20deg); animation: sh-turn 84s linear infinite reverse; animation-delay: var(--at); }
@keyframes sh-turn { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.sh-still .sh-ray { animation-play-state: paused; }

.sh-select { position: absolute; margin: 0; padding: 0; border: 0; background: none; font: inherit; cursor: pointer; outline: none; -webkit-tap-highlight-color: transparent; }
.sh-select > .sh-picture { transition: opacity 0.3s ease, filter 0.3s ease, transform ${EASE.press}s ease-out; }
.sh-select-lit { opacity: 0; }
.sh-select.sh-chosen .sh-select-lit { opacity: 1; filter: drop-shadow(0 0 14px rgba(255, 96, 44, 0.9)) drop-shadow(0 0 4px rgba(255, 150, 100, 0.9)); }
.sh-select-text {
  position: absolute; transform: translate(-50%, -50%); white-space: nowrap; line-height: 1; text-transform: uppercase; letter-spacing: 0.02em;
  color: rgb(178, 172, 164); text-shadow: 0 -2px 1px rgba(0, 0, 0, 0.8), 0 2px 1px rgba(255, 255, 255, 0.16); transition: color 0.3s ease, text-shadow 0.3s ease;
}
.sh-select.sh-chosen .sh-select-text { color: var(--lit-text); text-shadow: 0 0 12px rgba(255, 96, 50, 0.9), 0 0 2px rgba(255, 210, 190, 0.9); }
.sh-select:hover .sh-select-plain, .sh-select:focus-visible .sh-select-plain { filter: brightness(1.15); }
.sh-select:focus-visible .sh-select-text, .sh-select:hover .sh-select-text { color: rgb(232, 222, 206); }
.sh-select.sh-chosen:hover .sh-select-text, .sh-select.sh-chosen:focus-visible .sh-select-text { color: rgb(255, 204, 182); }
.sh-select.sh-down > .sh-picture, .sh-select.sh-down .sh-select-text { transform: translateY(3px); }
.sh-select.sh-down .sh-select-text { transform: translate(-50%, -50%) translateY(3px); }

/* ---- the scenario list -------------------------------------------------------------------------- */
.sh-list-panel { position: absolute; pointer-events: none; filter: drop-shadow(0 18px 30px rgba(0, 0, 0, 0.6)); }
.sh-list-panel .sh-panel-back { background: linear-gradient(180deg, rgb(36, 34, 33), rgb(20, 19, 19)); }
/* The column of battle plates. Past five it scrolls (the browser's own scrolling; eased when the keys move it), with no bar,
   and fades softly at the top and the foot where there is more above or below. */
.sh-list-plates { position: absolute; overflow: visible; pointer-events: none; }
.sh-list-room { position: absolute; visibility: hidden; pointer-events: none; }
.sh-list-plates.sh-scrolls {
  overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; scroll-behavior: smooth; pointer-events: auto; scrollbar-width: none;
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, black var(--list-above), black calc(100% - var(--list-below)), transparent 100%);
  mask-image: linear-gradient(to bottom, transparent 0, black var(--list-above), black calc(100% - var(--list-below)), transparent 100%);
  transition: --list-above ${EASE.plate}s ease, --list-below ${EASE.plate}s ease;
}
.sh-list-plates.sh-scrolls::-webkit-scrollbar { display: none; }
.sh-list-plates.sh-more-above { --list-above: ${SCENARIO_PLACES.fade}px; }
.sh-list-plates.sh-more-below { --list-below: ${SCENARIO_PLACES.fade}px; }
.sh-list-plate { position: absolute; margin: 0; padding: 0; border: 0; background: none; font: inherit; color: rgb(236, 216, 176); cursor: pointer; pointer-events: auto; outline: none; -webkit-tap-highlight-color: transparent; }
.sh-list-plate > span { position: absolute; inset: 0; background-size: 100% 100%; transition: opacity ${EASE.plate}s ease, filter ${EASE.plate}s ease, transform ${EASE.press}s ease-out; }
.sh-list-plate .sh-plate-lit { opacity: 0; }
.sh-list-plate.sh-on .sh-plate-lit { opacity: 1; }
.sh-list-plate > .sh-plate-text {
  display: flex; align-items: center; justify-content: center; text-transform: uppercase; white-space: nowrap; font-size: 70px; letter-spacing: 0.01em;
  text-shadow: 0 2px 1px rgba(0, 0, 0, 0.55); transition: color ${EASE.plate}s ease, text-shadow ${EASE.plate}s ease, transform ${EASE.press}s ease-out;
}
.sh-list-plate.sh-on > .sh-plate-text { color: rgb(146, 28, 22); text-shadow: 0 1px 0 rgba(255, 255, 255, 0.25); }
.sh-list-plate.sh-down > span { transform: translateY(3px) scale(0.988); filter: brightness(0.82); }
.sh-list-picture { position: absolute; object-fit: cover; border: 10px solid rgb(232, 222, 200); box-shadow: 0 10px 22px rgba(0, 0, 0, 0.6); transform: rotate(-1deg); background: rgb(40, 36, 32); transition: opacity 0.2s ease; }
.sh-list-picture.sh-none { opacity: 0; }
.sh-list-words { position: absolute; display: flex; flex-direction: column; gap: 18px; }
.sh-list-title { font-size: 86px; line-height: 0.95; text-transform: uppercase; color: rgb(236, 216, 176); letter-spacing: 0.01em; }
.sh-list-facts { font-size: 46px; line-height: 1; text-transform: uppercase; color: rgb(214, 120, 90); letter-spacing: 0.03em; }
.sh-list-blurb { font-family: Georgia, "Times New Roman", serif; font-weight: 400; font-size: 34px; line-height: 1.36; color: rgba(236, 222, 196, 0.92); }

/* ---- the About panel (about.ts): the kit's steel frame over a dim, the words on its dark ground ------------------ */
.sh-about-layer { position: absolute; inset: 0; z-index: 40; visibility: hidden; opacity: 0; transition: opacity ${EASE.plate}s ease, visibility 0s linear ${EASE.plate}s; }
.sh-about-layer.sh-open { visibility: visible; opacity: 1; transition: opacity ${EASE.plate}s ease, visibility 0s; }
.sh-about-dim { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.62); }
/* Opened alone (from the game's menu): the settings screen under the panel is not shown, only the panel over the game. */
.sh-about-alone > :not(.sh-about-layer) { visibility: hidden; }
.sh-about-alone .sh-about-dim { background: rgba(0, 0, 0, 0.25); }
.sh-about { position: absolute; filter: drop-shadow(0 18px 30px rgba(0, 0, 0, 0.6)); }
.sh-about .sh-panel-back { background: linear-gradient(180deg, rgb(36, 34, 33), rgb(20, 19, 19)); }
.sh-about-words { position: absolute; display: flex; flex-direction: column; gap: 46px; }
.sh-about-title { margin: 0; font: inherit; font-size: ${ABOUT_PLACES.titleSize}px; line-height: 0.95; text-align: center; text-transform: uppercase; letter-spacing: 0.01em; color: rgb(236, 216, 176); }
.sh-about-cols { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: ${ABOUT_PLACES.gap}px; align-items: start; }
.sh-about-col { display: flex; flex-direction: column; gap: ${ABOUT_PLACES.space}px; }
.sh-about-head {
  margin: 0 0 6px; padding-bottom: 14px; font: inherit; font-size: ${ABOUT_PLACES.headSize}px; line-height: 1; text-transform: uppercase; letter-spacing: 0.03em;
  color: rgb(214, 120, 90); border-bottom: 3px solid rgba(214, 120, 90, 0.4);
}
.sh-about-text { margin: 0; font-family: Georgia, "Times New Roman", serif; font-weight: 400; font-size: ${ABOUT_PLACES.textSize}px; line-height: 1.36; color: rgba(236, 222, 196, 0.92); }
.sh-about-text.sh-small { font-size: ${ABOUT_PLACES.smallSize}px; line-height: 1.32; color: rgba(236, 222, 196, 0.84); }

@media (prefers-reduced-motion: reduce) {
  .sh-about-layer, .sh-about-layer.sh-open { transition-duration: 0.01s; }
  .sh-screen, .sh-screen.sh-current, .sh-knob, .sh-frame, .sh-pick > .sh-picture, .sh-select > .sh-picture, .sh-rays, .sh-tag { transition-duration: 0.01s; }
  .sh-leaf, .sh-leaf.sh-leaf-away, .sh-frame.sh-leaf, .sh-tab-word, .sh-tab-word::after { transition-duration: 0.01s; }
  .sh-ray { animation-play-state: paused; }
  .sh-list-plates.sh-scrolls { scroll-behavior: auto; transition-duration: 0.01s; }
  .sh-option-list.sh-scrolls { scroll-behavior: auto; transition-duration: 0.01s; }
  .sh-option-ring, .sh-check, .sh-check-tick, .sh-tab-shade { transition-duration: 0.01s; }
}
`;
}
