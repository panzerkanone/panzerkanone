/**
 * The stylesheet of the rewards screen and the service record (rewards-screen.ts).
 *
 * Every length is in stage pixels, or in a sheet's own pixels: a sheet is a flat rectangle the size of one of the
 * painted papers, carried onto that paper's four corners by one transform (rewards-fit.ts), so whatever is written on
 * it lies on the paper at the paper's tilt. A sheet of ink is multiplied onto the paper under it (the paper's grain and
 * stains show through the letters); pictures lie on sheets of their own with the same transform.
 *
 * The plates at the foot are the other screens' tags (`sh-tag` and `sh-tag-text`, screens-style.ts): this file gives
 * them the colours those rules read, their pictures (the campaign kit's plates, trimmed to their own outlines) and
 * where their words sit, and nothing of their behaviour.
 */
import { TYPED_STACK, TYPED_WEIGHT, typedFaceCss } from './typed-face';

/** The glint on the medal: it comes round every so many seconds, and its pass takes this share of that time (per cent). */
const GLINT = { every: 5.6, share: 21 } as const;

/** Ink read off the owner's finished look: the stencil red of his headline, the dark of his lettering, a pencil's grey, a stamp's red. */
export const INK = { red: 'rgb(142, 34, 28)', dark: 'rgb(34, 29, 25)', pencil: 'rgb(58, 56, 60)', stamp: 'rgb(168, 36, 28)' } as const;

/**
 * The campaign kit's plates carry scraps of other pictures outside their own outlines (assets/campaign/v1/). Until
 * they are cut again, each is trimmed here to its outline: of the plate's own width and height.
 */
const PLATE_TRIM = {
  wide: 'inset(2% 3.2% 2.2% 1.2% round 9px)',
  mid: 'polygon(2.6% 28%, 7.1% 2.3%, 95.3% 2.3%, 96.8% 7.4%, 97.1% 90.9%, 95.8% 94.9%, 7.4% 86.3%, 2.6% 72.6%)',
  small: 'polygon(4.7% 24%, 12.3% 2.6%, 90% 2.6%, 91.6% 7.1%, 93% 91.6%, 92.1% 94.8%, 14.7% 94.8%, 4.7% 70.8%)',
} as const;

export function rewardsCss(): string {
  return `${typedFaceCss()}
.rw-room {
  background: rgb(10, 9, 8); color: ${INK.dark};
  font-family: "Stick No Bills", "Arial Narrow", Impact, sans-serif; font-weight: 800; -webkit-font-smoothing: antialiased;
  user-select: none; -webkit-user-select: none;
  --ink: ${INK.dark}; --red-ink: rgb(158, 40, 30); --strip-red: rgb(198, 66, 50); --glow: rgb(255, 104, 52); --lit-text: rgb(255, 178, 146);
}
.rw-room [hidden] { display: none !important; }
.rw-desk { position: absolute; left: 0; top: 0; width: 2752px; height: 1536px; background-size: 100% 100%; pointer-events: none; }
.rw-defs { position: absolute; width: 0; height: 0; overflow: hidden; }

/* A sheet: a flat rectangle carried onto a painted paper. Its children are placed in its own pixels. */
.rw-sheet { position: absolute; left: 0; top: 0; transform-origin: 0 0; pointer-events: none; }
.rw-sheet > * { position: absolute; }
.rw-ink { mix-blend-mode: multiply; }

/* Lettering. A line is set by its left end, its middle or its right end; \`--squeeze\` narrows it (rewards-type.ts
   works it out). A narrowed letter's upright strokes are thinner than they were drawn: a stroke of the letter's own
   colour gives them their weight back. */
.rw-line { white-space: nowrap; line-height: 1; text-transform: uppercase; transform-origin: 0 50%; transform: scaleX(var(--squeeze, 1)); letter-spacing: 0.012em; -webkit-text-stroke: 0.018em currentColor; }
.rw-line.rw-mid { transform-origin: 50% 50%; transform: translateX(-50%) scaleX(var(--squeeze, 1)); }
.rw-line.rw-end { transform-origin: 100% 50%; transform: translateX(-100%) scaleX(var(--squeeze, 1)); }
.rw-head { color: ${INK.red}; filter: url(#rw-worn); }
.rw-sub { color: ${INK.dark}; filter: url(#rw-worn); }
.rw-typed { font-family: ${TYPED_STACK}; font-weight: ${TYPED_WEIGHT}; color: ${INK.dark}; letter-spacing: 0; -webkit-text-stroke: 0.03em currentColor; filter: url(#rw-typed); }
.rw-rule { height: 0; border-top: 3px solid ${INK.dark}; opacity: 0.62; border-radius: 2px; filter: url(#rw-typed); }

/* Our own stamps: words in a ruled box or a ring, in a stamp's red, a little turned, worn. */
.rw-stamp { color: ${INK.stamp}; opacity: 0.8; filter: url(#rw-stamped); }
.rw-box-stamp { border: 5px solid ${INK.stamp}; border-radius: 7px; padding: 5px; }
.rw-box-stamp > span { display: block; border: 2px solid ${INK.stamp}; border-radius: 3px; padding: 3px 14px 0; white-space: nowrap; line-height: 1.05; text-transform: uppercase; letter-spacing: 0.05em; }
.rw-ring-stamp svg { display: block; overflow: visible; }
.rw-tick svg { display: block; overflow: visible; }

/* Pictures laid on a paper. */
.rw-pic { background-size: 100% 100%; background-repeat: no-repeat; }
.rw-boards { filter: drop-shadow(0 7px 5px rgba(38, 26, 12, 0.5)) drop-shadow(0 1px 1px rgba(38, 26, 12, 0.55)); }
/* A medal not yet earned is on the page as a faint print of itself (it lies on the ink's sheet, multiplied onto the paper). */
.rw-unearned { filter: grayscale(1) contrast(0.8) brightness(1.3) opacity(0.5); }
.rw-medal { position: absolute; pointer-events: none; filter: drop-shadow(0 22px 20px rgba(0, 0, 0, 0.5)) drop-shadow(0 3px 3px rgba(0, 0, 0, 0.45)); }
.rw-medal-pic, .rw-glint { position: absolute; inset: 0; background-size: 100% 100%; background-repeat: no-repeat; }
.rw-medal-pic { filter: contrast(1.06) brightness(1.03); }
/* The glint: the case's own picture again, cut down to what stands out bright from its surroundings (the metal's edges
   and facets, not the satin's slow folds: the filter rw-spark) and laid over it as light, shown only where a slanted
   band passes across the medal (not the lid). The band crosses in about a second, then rests, and comes again. */
.rw-glint {
  filter: url(#rw-spark); mix-blend-mode: screen;
  -webkit-mask-image: linear-gradient(108deg, transparent 43%, rgba(0, 0, 0, 0.55) 47.5%, black 50%, rgba(0, 0, 0, 0.55) 52.5%, transparent 57%), radial-gradient(ellipse 43% 31% at 50% 66%, black 62%, transparent 100%);
  mask-image: linear-gradient(108deg, transparent 43%, rgba(0, 0, 0, 0.55) 47.5%, black 50%, rgba(0, 0, 0, 0.55) 52.5%, transparent 57%), radial-gradient(ellipse 43% 31% at 50% 66%, black 62%, transparent 100%);
  -webkit-mask-size: 340% 100%, 100% 100%; mask-size: 340% 100%, 100% 100%;
  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
  -webkit-mask-position: 100% 0, 0 0; mask-position: 100% 0, 0 0;
  -webkit-mask-composite: source-in; mask-composite: intersect;
  animation: rw-glint ${GLINT.every}s linear var(--at, 0.5s) infinite both;
}
@keyframes rw-glint {
  from { -webkit-mask-position: 100% 0, 0 0; mask-position: 100% 0, 0 0; }
  ${GLINT.share}% { -webkit-mask-position: 0% 0, 0 0; mask-position: 0% 0, 0 0; }
  to { -webkit-mask-position: 0% 0, 0 0; mask-position: 0% 0, 0 0; }
}
.rw-still .rw-glint { animation: none; opacity: 0; }

/* The page's parts come onto it in turn when the screen opens: each eased, none in a jump, and each ends as it stands
   (a part without these classes is simply there). */
.rw-in { animation-duration: 0.34s; animation-timing-function: cubic-bezier(0.2, 0.7, 0.2, 1); animation-delay: var(--at, 0s); animation-fill-mode: both; }
.rw-k-fade { animation-name: rw-fade; }
.rw-k-write { animation-name: rw-write; animation-timing-function: cubic-bezier(0.3, 0.5, 0.3, 1); }
.rw-k-press { animation-name: rw-press; animation-duration: 0.4s; }
.rw-k-stamp { animation-name: rw-stamp; animation-duration: 0.3s; animation-timing-function: cubic-bezier(0.3, 0, 0.2, 1); }
.rw-k-settle { animation-name: rw-settle; animation-duration: 0.6s; }
@keyframes rw-fade { from { opacity: 0; } }
@keyframes rw-write { from { clip-path: inset(-14px 100% -14px -14px); } to { clip-path: inset(-14px -14px -14px -14px); } }
@keyframes rw-press { from { opacity: 0; scale: 1.07; } }
@keyframes rw-stamp { from { opacity: 0; scale: 1.36; } 62% { opacity: 0.95; scale: 0.975; } }
@keyframes rw-settle { from { opacity: 0; translate: 0 -18px; scale: 1.022; } }
@media (prefers-reduced-motion: reduce) {
  .rw-in { animation: none; }
  .rw-glint { animation: none; opacity: 0; }
}

/* No medal: the place a case would lie, ruled in pencil, and the words across it. */
.rw-none { opacity: 0.55; }
.rw-none svg { display: block; overflow: visible; }
.rw-none-words { opacity: 0.72; }

/* The plates at the foot: the screens' tags. The picture is a layer of its own, trimmed to the plate's outline. */
.rw-plate-face { position: absolute; inset: 0; background-size: 100% 100%; background-repeat: no-repeat; pointer-events: none; }
.rw-plate-wide > .rw-plate-face { clip-path: ${PLATE_TRIM.wide}; }
.rw-plate-mid > .rw-plate-face { clip-path: ${PLATE_TRIM.mid}; }
.rw-plate-small > .rw-plate-face { clip-path: ${PLATE_TRIM.small}; }
.rw-room .sh-tag-text { top: 50%; text-align: center; }
.rw-plate-line { display: block; line-height: 0.98; }
`;
}

/**
 * The screen's filters, as an SVG it holds once: \`rw-worn\` wears stencil paint thin in patches, \`rw-typed\` roughens a
 * typed line's edges, \`rw-stamped\` is a stamp's uneven ink, \`rw-pencil\` a pencil's grain (their noise is seeded, so
 * the same words wear the same way every time); \`rw-spark\` keeps of a picture what is brighter than its surroundings,
 * as warm light (the medal's glint).
 */
export const REWARDS_DEFS = `
<svg class="rw-defs" aria-hidden="true" focusable="false">
  <defs>
    <filter id="rw-worn" x="-3%" y="-8%" width="106%" height="116%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.016 0.03" numOctaves="4" seed="11" result="patch"/>
      <feComponentTransfer in="patch" result="worn"><feFuncA type="table" tableValues="1 1 1 1 0.97 0.78 0.6 0.55"/></feComponentTransfer>
      <feTurbulence type="fractalNoise" baseFrequency="0.62" numOctaves="2" seed="3" result="grain"/>
      <feComponentTransfer in="grain" result="speck"><feFuncA type="table" tableValues="1 1 1 1 0.93 0.62 0.45 0.45"/></feComponentTransfer>
      <feDisplacementMap in="SourceGraphic" in2="grain" scale="1.8" xChannelSelector="R" yChannelSelector="G" result="rough"/>
      <feComposite in="rough" in2="worn" operator="in" result="a"/>
      <feComposite in="a" in2="speck" operator="in"/>
    </filter>
    <filter id="rw-typed" x="-2%" y="-10%" width="104%" height="120%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="5" result="grain"/>
      <feComponentTransfer in="grain" result="speck"><feFuncA type="table" tableValues="1 1 1 1 0.94 0.66 0.52 0.52"/></feComponentTransfer>
      <feDisplacementMap in="SourceGraphic" in2="grain" scale="1.3" xChannelSelector="R" yChannelSelector="G" result="rough"/>
      <feComposite in="rough" in2="speck" operator="in"/>
    </filter>
    <filter id="rw-stamped" x="-8%" y="-12%" width="116%" height="124%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.03 0.05" numOctaves="3" seed="23" result="patch"/>
      <feComponentTransfer in="patch" result="worn"><feFuncA type="table" tableValues="1 1 1 0.95 0.78 0.42 0.25 0.2"/></feComponentTransfer>
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="9" result="grain"/>
      <feComponentTransfer in="grain" result="speck"><feFuncA type="table" tableValues="1 1 1 1 0.8 0.4 0.25 0.25"/></feComponentTransfer>
      <feDisplacementMap in="SourceGraphic" in2="grain" scale="2.2" xChannelSelector="R" yChannelSelector="G" result="rough"/>
      <feComposite in="rough" in2="worn" operator="in" result="a"/>
      <feComposite in="a" in2="speck" operator="in"/>
    </filter>
    <filter id="rw-spark" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feColorMatrix in="SourceGraphic" type="matrix" values="0.30 0.59 0.11 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="grey"/>
      <feGaussianBlur in="grey" stdDeviation="7" result="soft"/>
      <feColorMatrix in="soft" type="matrix" values="0 0 0 0 0  1 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="around"/>
      <feComposite in="grey" in2="around" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="both"/>
      <feColorMatrix in="both" type="matrix" values="5.6 -5.6 0 0 -0.06  5.4 -5.4 0 0 -0.06  4.6 -4.6 0 0 -0.06  0 0 0 1 0" result="lit"/>
      <feGaussianBlur in="lit" stdDeviation="2.2" result="bloom"/>
      <feComposite in="lit" in2="bloom" operator="arithmetic" k1="0" k2="1" k3="1.4" k4="0" result="glow"/>
      <feComposite in="glow" in2="SourceGraphic" operator="in"/>
    </filter>
    <filter id="rw-pencil" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="17" result="grain"/>
      <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -4.2 2.9" result="speck"/>
      <feDisplacementMap in="SourceGraphic" in2="grain" scale="2" xChannelSelector="R" yChannelSelector="G" result="rough"/>
      <feComposite in="rough" in2="speck" operator="in"/>
    </filter>
  </defs>
</svg>`;
