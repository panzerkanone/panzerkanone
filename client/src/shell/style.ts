/**
 * The title screen's stylesheet: the menu's plates, the leather strip, the nameplate, the answer
 * tag, and the kit's steel frame as a panel (the scenario list's). The other screens' is
 * screens-style.ts.
 *
 * The screen fills the stage (stage.ts, stage-dom.ts), and every length here is in the stage's own
 * pixels, which are the painting's: the stage is scaled to the window as one thing, so nothing here
 * knows the window's size. Places and sizes of the pieces come from the layout (layout.ts) as
 * inline styles, in the same pixels. Colours are the kit's own, read off the owner's sheets.
 * Nothing snaps: every change of state is eased.
 */
import type { ShellArt } from './manifest';
import { PLAY } from './places';

/** Seconds a plate takes to change its look, and the answer tag to come and go. */
export const EASE = { plate: 0.16, press: 0.07, panel: 0.2, answerIn: 0.14, answerOut: 0.45, answerStay: 1.9 } as const;

/** A length in stage pixels. */
const px = (n: number): string => `${n}px`;

export function shellCss(art: ShellArt, address: (file: string) => string): string {
  const frame = art.panelFrame;
  const font = `"${art.font.family}"`;
  return `
@font-face { font-family: ${font}; font-weight: ${art.font.weight}; font-style: normal; font-display: block; src: url("${address(art.font.file)}") format("woff2"); }

.sh-root {
  position: absolute; inset: 0; overflow: hidden; background: rgb(6, 8, 12); color: rgb(236, 216, 176);
  font-family: ${font}, "Arial Narrow", Impact, sans-serif; font-weight: ${art.font.weight}; -webkit-font-smoothing: antialiased;
  user-select: none; -webkit-user-select: none;
  --ivory: rgb(236, 216, 176); --ivory-dim: rgba(236, 216, 176, 0.5); --red: rgb(146, 28, 22); --ink: rgb(50, 42, 38);
  --steel: rgb(38, 36, 35); --steel-line: rgb(96, 88, 80);
}
.sh-canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; }
.sh-sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* Everything of the interface comes in when the page opens. */
@keyframes sh-in { from { opacity: 0; transform: translateY(var(--from, 0)); } to { opacity: 1; transform: none; } }
.sh-strip, .sh-nameplate, .sh-plate { animation: sh-in 0.9s cubic-bezier(0.2, 0.7, 0.2, 1) both; animation-delay: var(--wait, 0s); }
.sh-still .sh-strip, .sh-still .sh-nameplate, .sh-still .sh-plate { animation: none; }

/* The leather strip: one tile, repeated at its rivets' own period from the middle outward, darker toward its ends as he painted it. */
.sh-strip { position: absolute; background-repeat: repeat-x; background-position: center top; pointer-events: none; --from: ${px(40)}; --wait: 0.15s; }
.sh-strip::before { content: ""; position: absolute; left: 0; right: 0; bottom: 100%; height: ${px(26)}; background: linear-gradient(to top, rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0)); }
.sh-strip::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.08) 30%, rgba(0, 0, 0, 0) 50%, rgba(0, 0, 0, 0.08) 70%, rgba(0, 0, 0, 0.5)); }

.sh-nameplate { position: absolute; background-size: 100% 100%; pointer-events: none; display: flex; flex-direction: column; align-items: center; color: var(--ink); text-transform: uppercase; --from: ${px(40)}; --wait: 0.3s; }
.sh-name { margin-top: ${px(15)}; font-size: ${px(84)}; line-height: ${px(78)}; letter-spacing: 0.012em; white-space: nowrap; text-shadow: 0 ${px(1.5)} 0 rgba(255, 255, 255, 0.22); }
/* The edition and the version: one line inside the plate's rivets, between two rules that take what room the words leave (none, for a long version). */
.sh-edition { margin-top: ${px(11)}; width: ${px(596)}; display: flex; align-items: center; justify-content: center; gap: ${px(18)}; font-size: ${px(36)}; line-height: ${px(34)}; letter-spacing: 0.02em; white-space: nowrap; text-shadow: 0 ${px(1)} 0 rgba(255, 255, 255, 0.2); }
.sh-edition-text { flex: none; white-space: pre; }
.sh-version { text-transform: none; }
.sh-edition::before, .sh-edition::after { content: ""; flex: 1 1 0; min-width: 0; max-width: ${px(92)}; height: ${px(4)}; background: var(--ink); opacity: 0.85; }

/* The menu. A plate is the dark plate with the ivory one laid over it; the ivory one shows on the plate in hand. */
.sh-menu { position: absolute; inset: 0; pointer-events: none; }
.sh-plate {
  position: absolute; margin: 0; padding: 0; border: 0; background: none; font: inherit; color: var(--ivory); cursor: pointer; pointer-events: auto;
  -webkit-tap-highlight-color: transparent; outline: none; --from: ${px(-36)};
}
.sh-plate > span { position: absolute; inset: 0; background-size: 100% 100%; transition: opacity ${EASE.plate}s ease, filter ${EASE.plate}s ease, transform ${EASE.press}s ease-out; }
.sh-plate-lit { opacity: 0; }
.sh-plate-flip { transform: scaleX(-1); }
.sh-plate > .sh-plate-text {
  display: flex; align-items: center; justify-content: center; padding-bottom: ${px(2)}; text-transform: uppercase; white-space: nowrap;
  font-size: ${px(82)}; letter-spacing: 0.006em; text-shadow: 0 ${px(2)} ${px(1)} rgba(0, 0, 0, 0.55);
  transition: color ${EASE.plate}s ease, text-shadow ${EASE.plate}s ease, transform ${EASE.press}s ease-out, filter ${EASE.plate}s ease;
}
.sh-plate.sh-on .sh-plate-lit { opacity: 1; }
.sh-plate.sh-on .sh-plate-text { color: var(--red); text-shadow: 0 ${px(1)} 0 rgba(255, 255, 255, 0.25); }
/* (The ivory plate is itself the mark of the keyboard's focus: the plate in hand always has it.) */
/* Pressed: it goes in. */
.sh-plate.sh-down > span { transform: translateY(${px(3)}) scale(0.988); filter: brightness(0.82); }
.sh-plate.sh-down .sh-plate-flip { transform: translateY(${px(3)}) scale(-0.988, 0.988); }
/* Not built yet: plainly dimmer, in either state. */
.sh-plate.sh-soon .sh-plate-dark { filter: brightness(0.62) saturate(0.6); }
.sh-plate.sh-soon .sh-plate-text { color: var(--ivory-dim); }
.sh-plate.sh-soon.sh-on .sh-plate-lit { opacity: 0.5; }
.sh-plate.sh-soon.sh-on .sh-plate-text { color: rgba(88, 34, 28, 0.9); text-shadow: none; }

/* The answer to a press that leads nowhere yet: a tag beside the plate. */
.sh-answer {
  position: absolute; pointer-events: none; opacity: 0; transform: translateX(${px(-14)}); white-space: nowrap;
  padding: ${px(12)} ${px(26)} ${px(10)}; font-size: ${px(44)}; line-height: 1.1; letter-spacing: 0.02em; text-transform: uppercase;
  color: var(--ivory); background: rgba(24, 22, 21, 0.92); border: ${px(3)} solid var(--steel-line); border-radius: ${px(8)};
  box-shadow: 0 ${px(6)} ${px(18)} rgba(0, 0, 0, 0.5);
  transition: opacity ${EASE.answerOut}s ease, transform ${EASE.answerOut}s ease;
}
.sh-answer.sh-shown { opacity: 1; transform: none; transition-duration: ${EASE.answerIn}s; }

/* The PLAY GAME medallion (play.ts). While it waits, the menu's plates and the nameplate wait behind it, and come in by their own entry when it is pressed. */
.sh-waiting .sh-plate, .sh-waiting .sh-nameplate { animation: none; opacity: 0; visibility: hidden; }
.sh-play {
  position: absolute; margin: 0; padding: 0; border: 0; background: none; outline: none; cursor: pointer; pointer-events: none;
  -webkit-tap-highlight-color: transparent; animation: sh-in 0.9s cubic-bezier(0.2, 0.7, 0.2, 1) both; animation-delay: 0.5s; --from: ${px(24)};
}
.sh-still .sh-play { animation: none; }
/* A press is taken by its disc and its two plates, not by its box's empty corners. */
.sh-play-hit { position: absolute; pointer-events: auto; cursor: pointer; }
.sh-play-hit-disc { border-radius: 50%; }
.sh-play-hit-plate, .sh-play-hit-tag { border-radius: ${px(14)}; }
.sh-play-art {
  position: absolute; inset: 0; transition: transform ${PLAY.ease.down}s ease-out, filter ${PLAY.ease.hot}s ease;
  /* (None at rest, which costs nothing; it eases from none to the halo and back.) */
  filter: none;
}
/* Hot, where the live medallion cannot be drawn: a soft halo that hugs its outline. */
.sh-play.sh-hot .sh-play-art { filter: drop-shadow(0 0 ${px(PLAY.halo.near)} rgba(255, 150, 54, ${PLAY.halo.nearCover})) drop-shadow(0 0 ${px(PLAY.halo.far)} rgba(255, 86, 18, ${PLAY.halo.farCover})); }
.sh-play-art > span, .sh-play-art > canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; background-size: 100% 100%; }
/* Hot (the pointer over it, or the keyboard's focus): the owner's ablaze cut. Held: it goes in a little. */
.sh-play-lit { opacity: 0; transition: opacity ${PLAY.ease.hot}s ease; }
.sh-play.sh-hot .sh-play-lit { opacity: 1; }
.sh-play.sh-down .sh-play-art { transform: translateY(${px(5)}) scale(0.982); }
/* The sweep: a soft band of light that crosses its metal now and then, cut to its shape, and brightest on its bright metal (overlay). */
.sh-play-sheen { overflow: hidden; mask-size: 100% 100%; -webkit-mask-size: 100% 100%; mask-repeat: no-repeat; -webkit-mask-repeat: no-repeat; mix-blend-mode: overlay; transition: opacity ${PLAY.ease.hot}s ease; }
.sh-play-art > .sh-play-sheen > .sh-play-band {
  position: absolute; top: -25%; height: 150%; left: -45%; width: 45%;
  background: linear-gradient(90deg, rgba(255, 238, 210, 0) 0%, rgba(255, 238, 210, ${PLAY.sweep.strength}) 50%, rgba(255, 238, 210, 0) 100%);
  transform: translateX(0) rotate(16deg); animation: sh-sweep ${PLAY.sweep.every}s linear infinite; animation-delay: 2.4s;
}
@keyframes sh-sweep {
  0% { transform: translateX(0) rotate(16deg); }
  ${(PLAY.sweep.share * 100).toFixed(1)}% { transform: translateX(${((145 / 45) * 100).toFixed(1)}%) rotate(16deg); }
  100% { transform: translateX(${((145 / 45) * 100).toFixed(1)}%) rotate(16deg); }
}
.sh-play.sh-hot .sh-play-sheen { opacity: 0; }
/* The live medallion (client/src/medallion) at rest is the 2D cut, pixel for pixel: it takes the cut's place in one frame, with nothing to see. From then the 2D pictures, their halo and their going in are not used. */
.sh-play-3d { visibility: hidden; pointer-events: none; }
.sh-play.sh-3d .sh-play-3d { visibility: visible; }
.sh-play.sh-3d .sh-play-rest, .sh-play.sh-3d .sh-play-sheen, .sh-play.sh-3d .sh-play-lit { visibility: hidden; }
.sh-play.sh-3d .sh-play-art, .sh-play.sh-3d.sh-hot .sh-play-art, .sh-play.sh-3d.sh-down .sh-play-art { filter: none; transform: none; transition: none; }
/* (As particular as the band's own rule, which it overrides.) */
.sh-less .sh-play-art > .sh-play-sheen > .sh-play-band { animation: none; visibility: hidden; }

/* The kit's steel frame as a panel (the scenario list): its dark ground, and the frame over the ground's edge (cut in nine: the corners keep their size). */
.sh-panel-back { position: absolute; inset: ${px(26)}; background: linear-gradient(180deg, rgba(36, 34, 33, 0.97), rgba(20, 19, 19, 0.97)); border-radius: ${px(6)}; }
.sh-panel-frame {
  position: absolute; inset: 0; box-sizing: border-box; pointer-events: none; border-style: solid; border-color: transparent;
  border-width: ${px(frame.slice[0])} ${px(frame.slice[1])} ${px(frame.slice[2])} ${px(frame.slice[3])};
  border-image: url("${address(frame.file)}") ${frame.slice.join(' ')} stretch;
}

@media (prefers-reduced-motion: reduce) {
  .sh-strip, .sh-nameplate, .sh-plate, .sh-play { animation-duration: 0.01s; animation-delay: 0s; }
  .sh-plate > span, .sh-answer { transition-duration: 0.01s; }
  .sh-play-art > .sh-play-sheen > .sh-play-band { animation: none; visibility: hidden; }
}
`;
}
