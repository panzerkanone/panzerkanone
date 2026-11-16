/**
 * A flat implementation of PiecesPort for the bench page: counters as plain
 * squares with their face texts at the hex centres, stacks fanned a little,
 * moves eased along their path, tints and lines drawn flat. It is a test bench
 * and a fallback, not the game's look: the game's counters are the cardboard
 * ones on the table (client/src/scene/pieces).
 *
 * Everything sits in one layer the bench places over its map: a `world`
 * element whose own pixels are UNIT to one h (the world unit of
 * engine/core/hex), scaled and shifted by setView to match the map under it.
 * The layer takes no pointer events; the bench hands it the pointer in world
 * coordinates (pointer) and it answers with clicks and hovers.
 *
 * Every hex position and outline comes from engine/core/hex. Every colour is
 * mixed in CSS from the board's ink table (inks.ts).
 */
import type { Grid } from '@engine/core/hex';
import { centreOf, cornersOf, worldToHex } from '@engine/core/hex';
import type { CounterFace, CounterSpec, DiceRoll, IntentAct, PiecesPort, TableAnswer } from './pieces-port';
import { setInks } from './inks';

/** Layer pixels to one h, before the view's scale. */
const UNIT = 100;
/** A counter's side, in h. */
const SIDE = 0.68;
/** How far each counter of a stack sits from the one under it, in h (right and up). */
const FAN = 0.075;
const SVG = 'http://www.w3.org/2000/svg';

type TintKind = 'reach' | 'target' | 'path' | 'objective' | 'zone';
type MarkSet = { selected: boolean; canAct: boolean; spent: boolean; suppressed: boolean; target: boolean };
type ClickHit = { counter: string | null; hex: number; stack: readonly string[] };
type HoverHit = { counter: string | null; hex: number };
type NoteSet = { group?: string; active?: boolean; carriedBy?: string | null; revealed?: boolean; pick?: boolean; moved?: boolean; close?: boolean };
type ThreatLine = { from: number; to: number; label: string; live: boolean };
type MarkerSpec = { hex: number; kind: 'screen' | 'incoming'; label: string; side: string | null };
type Intent = { hex: number; unit: string | null; act: IntentAct; can: boolean; words: string };
type ChanceLabel = { unit: string; hex: number; chance: string; kill: string; best: boolean; also?: string };

/** A mark for each kind of thing a click would do, drawn in a ring about the label's left end: plain strokes in a 16 by 16 box. */
const ACT_MARKS: Readonly<Record<IntentAct, string>> = {
  select: 'M3 3 L3 13 L6 10 L9 14 L11 13 L8 9 L12 9 Z',
  order: 'M3 13 L3 3 L12 6 L3 9',
  move: 'M2 8 L12 8 M8 4 L12 8 L8 12',
  fire: 'M8 1 L8 5 M8 11 L8 15 M1 8 L5 8 M11 8 L15 8 M8 6.5 L8 9.5 M6.5 8 L9.5 8',
  charge: 'M2 13 L13 2 M8 2 L13 2 L13 7 M3 3 L6 6',
  drive: 'M1 8 L15 8 M11 4 L15 8 L11 12 M6 4 L6 12',
  board: 'M2 12 L14 12 M8 2 L8 9 M5 6 L8 9 L11 6',
  unload: 'M2 12 L14 12 M8 9 L8 2 M5 5 L8 2 L11 5',
  call: 'M2 13 Q8 -3 14 13 M11 10 L14 13 L15 9',
  screen: 'M3 11 Q1 7 5 6 Q6 2 10 4 Q14 3 13 8 Q16 11 12 12 Z',
  place: 'M8 2 L8 11 M4 7 L8 11 L12 7 M3 14 L13 14',
};

interface Piece {
  readonly id: string;
  readonly el: HTMLDivElement;
  hex: number;
  /** While true the counter is on its way out and takes no part in stacks or hits. */
  going: boolean;
}

const CSS = `
.fp-layer { position: absolute; inset: 0; overflow: hidden; pointer-events: none;
  --fp-first: color-mix(in srgb, var(--ink-blue) 46%, white);
  --fp-second: color-mix(in srgb, var(--ink-straw) 64%, var(--ink-brown));
  --fp-ink: var(--ink-key);
}
.fp-world { position: absolute; left: 0; top: 0; width: 0; height: 0; transform-origin: 0 0; will-change: transform; }
.fp-world svg { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; }
/* A roll, plainly (dice): a card at the lower right, the faces drawn flat, the sum and the result. */
.fp-dice { position: absolute; right: 14px; bottom: 12px; padding: 10px 14px 9px; border: 2px solid var(--fp-ink); border-radius: 7px; background: color-mix(in srgb, var(--ink-straw) 18%, white);
  color: var(--fp-ink); font: 700 15px/1.1 "Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif; letter-spacing: .06em;
  opacity: 0; transform: translateY(16px); transition: opacity .25s ease, transform .25s ease; }
.fp-dice[data-shown="1"] { opacity: 1; transform: none; }
.fp-dice-row { display: flex; align-items: center; gap: 8px; }
.fp-die { width: 34px; height: 34px; }
.fp-die rect { fill: var(--fp-first); stroke: var(--fp-ink); stroke-width: 1.5; }
.fp-dice[data-stock="second"] .fp-die rect { fill: var(--fp-second); }
.fp-die circle, .fp-die text { fill: var(--fp-ink); font: 700 15px sans-serif; }
.fp-dice-sum { font-size: 20px; }
.fp-dice-result { margin-top: 5px; min-height: 17px; text-transform: uppercase; letter-spacing: .12em; }
.fp-dice-result[data-fate="destroyed"] { color: var(--ink-red); }
.fp-dice-result[data-fate="none"] { opacity: .6; }
.fp-grid { fill: none; stroke: var(--ink-key); stroke-opacity: 0.3; stroke-width: 1px; vector-effect: non-scaling-stroke; }
.fp-tint { transition: opacity 0.2s ease; }
.fp-tint-reach { fill: color-mix(in srgb, var(--ink-straw) 30%, white); fill-opacity: 0.46; stroke: var(--ink-key); stroke-opacity: 0.55; stroke-width: 1.6; stroke-dasharray: 5 4; }
/* The nearer part of a reach, laid over the reach's own tint: the same straw, stronger, so the two are one family a clear step apart. */
.fp-tint-reach-near { fill: color-mix(in srgb, var(--ink-straw) 62%, white); fill-opacity: 0.6; stroke: none; }
.fp-tint-target { fill: var(--ink-red); fill-opacity: 0.4; stroke: var(--ink-red); stroke-width: 3.5; }
.fp-tint-path { fill: var(--ink-blue); fill-opacity: 0.5; stroke: var(--ink-key); stroke-opacity: 0.6; stroke-width: 1.5; }
.fp-tint-zone { fill: var(--ink-blue); fill-opacity: 0.16; stroke: none; }
.fp-tint-objective { fill: none; stroke: var(--ink-key); stroke-width: 4.5; stroke-opacity: 0.85; stroke-dasharray: 13 6; }
.fp-tint-objective-under { fill: color-mix(in srgb, var(--ink-straw) 55%, white); fill-opacity: 0.35; stroke: white; stroke-width: 9; stroke-opacity: 0.7; }
.fp-route { fill: none; stroke: var(--ink-key); stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1 11; }
.fp-fire { stroke: var(--ink-red); stroke-width: 6; stroke-linecap: round; stroke-opacity: 0.92; }
.fp-fire-under { stroke: white; stroke-width: 10; stroke-linecap: round; stroke-opacity: 0.75; }
.fp-fire-head { fill: var(--ink-red); stroke: white; stroke-width: 1.5; }
.fp-threat { stroke: var(--ink-red); stroke-width: 3px; stroke-linecap: round; stroke-dasharray: 2 7; fill: none; vector-effect: non-scaling-stroke; }
.fp-threat-under { stroke: white; stroke-width: 6px; stroke-linecap: round; stroke-opacity: 0.8; fill: none; vector-effect: non-scaling-stroke; }
.fp-threat[data-live="1"] { stroke-dasharray: none; stroke-width: 4px; }
.fp-threat-spot { fill: var(--ink-red); fill-opacity: 0.22; stroke: var(--ink-red); stroke-width: 3px; vector-effect: non-scaling-stroke; }
.fp-threat-tag { fill: var(--ink-red); stroke: white; stroke-width: 1.5; }
.fp-threat-text { fill: white; font: 700 14px "Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif; text-anchor: middle; dominant-baseline: central; letter-spacing: 0.02em; }
.fp-marker-screen { fill: white; fill-opacity: 0.72; stroke: var(--ink-key); stroke-opacity: 0.5; stroke-width: 1.5px; stroke-dasharray: 2 4; vector-effect: non-scaling-stroke; }
.fp-marker-incoming { fill: none; stroke: var(--ink-red); stroke-width: 2.5px; stroke-dasharray: 6 4; vector-effect: non-scaling-stroke; }
.fp-marker-cross { stroke: var(--ink-red); stroke-width: 2px; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.fp-marker-tag { fill: color-mix(in srgb, var(--ink-straw) 26%, white); stroke: var(--ink-key); stroke-width: 1; }
/* The chance of every target at once: a card on each enemy counter, over its title (its numbers stay clear), sized with
   the board as the counter is; the best one white, with a red keyline. */
.fp-chance-tag { fill: color-mix(in srgb, var(--ink-straw) 22%, white); stroke: var(--ink-key); stroke-width: 1.2; }
.fp-chance[data-best="1"] .fp-chance-tag { fill: white; stroke: var(--ink-red); stroke-width: 2.6; }
.fp-chance-text { fill: var(--ink-key); font: 700 16px "Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif; text-anchor: middle; dominant-baseline: central; letter-spacing: 0.02em; }
.fp-chance-mark { font-size: 11px; }
.fp-chance[data-all="1"] .fp-chance-text { fill: var(--ink-red); }
.fp-chance-kill { fill: var(--ink-red); font: 700 11px "Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif; text-anchor: middle; dominant-baseline: central; }
.fp-marker-text { fill: var(--ink-key); font: 700 10.5px "Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif; text-anchor: middle; dominant-baseline: central; letter-spacing: 0.06em; text-transform: uppercase; }
/* What a click where the pointer is would do: a label by the hex with a mark for its kind, crossed out when it would be refused. */
.fp-intent-tag { fill: color-mix(in srgb, var(--ink-straw) 26%, white); stroke: var(--ink-key); stroke-width: 1.5; }
.fp-intent-text { fill: var(--ink-key); font: 700 13px "Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif; text-anchor: start; dominant-baseline: central; letter-spacing: 0.03em; }
.fp-intent-mark { fill: none; stroke: var(--ink-key); stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; animation: fp-beckon 0.9s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
@keyframes fp-beckon { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.22); } }
.fp-intent[data-can="0"] .fp-intent-tag { stroke: var(--ink-red); }
.fp-intent[data-can="0"] .fp-intent-text { fill: var(--ink-red); }
.fp-intent[data-can="0"] .fp-intent-mark { stroke: var(--ink-red); stroke-opacity: 0.55; animation: none; }
.fp-intent-cross { stroke: var(--ink-red); stroke-width: 2.2; stroke-linecap: round; }
/* The answers: a red X that shakes and goes; a label that floats up and fades; a shot; its landing. */
.fp-x-turn { animation: fp-shake 0.7s ease-in-out forwards; transform-box: fill-box; transform-origin: center; }
.fp-x-turn line { stroke: var(--ink-red); stroke-width: 5; stroke-linecap: round; }
.fp-x-turn .fp-x-under { stroke: white; stroke-width: 9; stroke-opacity: 0.85; }
@keyframes fp-shake { 0% { transform: rotate(0deg) scale(0.5); opacity: 0; } 12% { transform: rotate(-16deg) scale(1); opacity: 1; } 26% { transform: rotate(14deg); } 40% { transform: rotate(-12deg); } 54% { transform: rotate(10deg); } 68% { transform: rotate(-6deg); opacity: 1; } 82% { transform: rotate(0deg); opacity: 1; } 100% { transform: rotate(0deg) scale(0.8); opacity: 0; } }
.fp-said { animation: fp-float 1.5s ease-out forwards; }
@keyframes fp-float { 0% { transform: translateY(6px); opacity: 0; } 14% { transform: translateY(0); opacity: 1; } 65% { opacity: 1; } 100% { transform: translateY(-34px); opacity: 0; } }
.fp-refused-tag { fill: white; stroke: var(--ink-red); stroke-width: 1.5; }
.fp-refused-text { fill: var(--ink-red); font: 700 13px "Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif; text-anchor: middle; dominant-baseline: central; letter-spacing: 0.02em; }
.fp-badge-tag { fill: color-mix(in srgb, var(--ink-straw) 26%, white); stroke: var(--ink-key); stroke-width: 1.5; }
.fp-badge-text { fill: var(--ink-key); font: 700 13.5px "Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif; text-anchor: middle; dominant-baseline: central; letter-spacing: 0.05em; text-transform: uppercase; }
[data-tone="good"] > .fp-badge-tag { fill: color-mix(in srgb, var(--ink-green) 30%, white); stroke: var(--ink-green); }
[data-tone="bad"] > .fp-badge-tag { fill: color-mix(in srgb, var(--ink-red) 24%, white); stroke: var(--ink-red); }
.fp-shot { stroke: var(--ink-red); stroke-width: 5px; stroke-linecap: round; fill: none; vector-effect: non-scaling-stroke; animation: fp-shot 0.4s ease-out forwards; }
@keyframes fp-shot { 0% { stroke-dashoffset: 1; opacity: 1; } 70% { stroke-dashoffset: 0; opacity: 1; } 100% { stroke-dashoffset: 0; opacity: 0; } }
.fp-flash { fill: white; stroke: var(--ink-red); stroke-width: 3px; vector-effect: non-scaling-stroke; animation: fp-flash 0.35s ease-out forwards; transform-box: fill-box; transform-origin: center; }
@keyframes fp-flash { 0% { transform: scale(0.3); opacity: 1; } 100% { transform: scale(1.5); opacity: 0; } }
.fp-impact { fill: none; stroke: var(--ink-key); stroke-width: 3px; vector-effect: non-scaling-stroke; animation: fp-impact 0.6s ease-out forwards; transform-box: fill-box; transform-origin: center; }
.fp-impact[data-result="suppressed"] { stroke: var(--ink-red); }
.fp-impact[data-result="destroyed"] { stroke: var(--ink-red); stroke-width: 6px; fill: color-mix(in srgb, var(--ink-red) 35%, transparent); }
@keyframes fp-impact { 0% { transform: scale(0.25); opacity: 1; } 100% { transform: scale(1.35); opacity: 0; } }
[data-zoom="far"] .fp-tab { transform: scale(1.45); }
[data-zoom="far"] .fp-counter[data-active="1"] .fp-tab { transform: scale(1.7); }
[data-zoom="far"] .fp-dot { width: 20px; height: 20px; right: -10px; top: -10px; }
[data-zoom="far"] .fp-seen { transform: scale(1.5); }
.fp-appear { animation: fp-appear 0.25s ease; }
@keyframes fp-appear { from { opacity: 0; } to { opacity: 1; } }
.fp-gone { animation: fp-gone 0.2s ease forwards; }
@keyframes fp-gone { from { opacity: 1; } to { opacity: 0; } }

.fp-counter {
  position: absolute; left: 0; top: 0; width: ${SIDE * UNIT}px; height: ${SIDE * UNIT}px; margin: ${-SIDE * UNIT / 2}px 0 0 ${-SIDE * UNIT / 2}px;
  transition: transform 0.3s cubic-bezier(0.3, 0.1, 0.25, 1);
}
.fp-face {
  position: absolute; inset: 0; border: 2.5px solid var(--fp-ink); border-radius: 5px; background: var(--fp-first); color: var(--fp-ink);
  box-shadow: 2px 3px 0 color-mix(in srgb, var(--ink-key) 45%, transparent);
  overflow: hidden;
  font-family: "Avenir Next Condensed", "DIN Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif; font-stretch: condensed; font-weight: 700;
  transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.3s ease, outline-color 0.2s ease, border-color 0.2s ease;
  outline: 4px solid transparent; outline-offset: 1px;
}
.fp-counter[data-stock="second"] .fp-face { background: var(--fp-second); }
.fp-title { position: absolute; left: 0; right: 0; top: 4px; text-align: center; font-size: 23px; line-height: 1; letter-spacing: 0.04em; transition: transform 0.25s ease; }
.fp-block { position: absolute; left: 20%; right: 20%; top: 29px; height: 4px; background: var(--fp-ink); opacity: 0.8; transition: transform 0.25s ease; }
.fp-nums { position: absolute; left: 0; right: 0; bottom: 2px; font-size: 12px; line-height: 13px; text-align: center; letter-spacing: 0.01em; white-space: nowrap; transition: opacity 0.25s ease; }
.fp-nums i { font-style: normal; font-weight: 400; opacity: 0.75; font-size: 9.5px; margin-right: 1px; }
[data-zoom="far"] .fp-title { transform: translateY(11px) scale(1.6); }
[data-zoom="far"] .fp-block { transform: translateY(19px); }
[data-zoom="far"] .fp-nums { opacity: 0; }
.fp-dot { position: absolute; right: -7px; top: -7px; width: 15px; height: 15px; border-radius: 50%; background: var(--ink-green); border: 2px solid white; opacity: 0; transform: scale(0.4); transition: opacity 0.25s ease, transform 0.25s ease; }
.fp-band { position: absolute; left: -3px; right: -3px; top: 36%; height: 28%; background: var(--ink-red); color: white; font: 700 13px/1 "Avenir Next Condensed", "Arial Narrow", sans-serif; letter-spacing: 0.12em; display: flex; align-items: center; justify-content: center; opacity: 0; transform: rotate(-9deg) scale(0.8); transition: opacity 0.3s ease, transform 0.3s ease; }
.fp-tab { position: absolute; left: -6px; top: -6px; min-width: 17px; height: 17px; padding: 0 3px; border: 2px solid var(--fp-ink); border-radius: 3px; background: color-mix(in srgb, var(--ink-straw) 26%, white); color: var(--fp-ink);
  font: 700 13px/13px "Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif; text-align: center; opacity: 0; transition: opacity 0.25s ease, background-color 0.25s ease, color 0.25s ease, transform 0.25s ease; }
.fp-counter[data-group] .fp-tab { opacity: 1; }
.fp-counter[data-active="1"] .fp-tab { background: var(--fp-ink); color: white; transform: scale(1.15); }
.fp-seen { position: absolute; left: -5px; bottom: -5px; width: 12px; height: 12px; border-radius: 50%; border: 2.5px solid var(--ink-red); background: white; opacity: 0; transform: scale(0.4); transition: opacity 0.25s ease, transform 0.25s ease; }
.fp-counter[data-revealed="1"] .fp-seen { opacity: 1; transform: none; }
/* Moved (it can still do one thing more): a small chevron pointing on, at the counter's lower right. */
.fp-moved { position: absolute; right: -4px; bottom: -4px; width: 13px; height: 13px; opacity: 0; transform: scale(0.4); transition: opacity 0.25s ease, transform 0.25s ease; }
.fp-moved path { fill: none; stroke: var(--fp-ink); stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }
.fp-counter[data-moved="1"] .fp-moved { opacity: 1; transform: none; }
.fp-counter[data-carried="1"] .fp-face { transform: translate(-14px, 23px) scale(0.9); border-style: dashed; box-shadow: none; }
.fp-counter[data-carried="1"] .fp-tab { opacity: 0; }
.fp-counter[data-carried="1"] .fp-title { transform: translateY(42px) scale(0.78); }
.fp-counter[data-carried="1"] .fp-nums, .fp-counter[data-carried="1"] .fp-block { opacity: 0; }
.fp-counter[data-carried="1"][data-selected="1"] .fp-face { transform: translate(-20px, 30px) scale(0.98); outline-color: white; }
/* A counter of the group in hand is lit: a soft band about it (a counter carries no group's number; the tab above is for a table that prints one). */
.fp-counter[data-active="1"] .fp-face { outline-color: color-mix(in srgb, var(--ink-straw) 78%, white); }
.fp-counter[data-pick="1"] .fp-face { outline-color: var(--ink-blue); outline-style: dashed; }
.fp-counter[data-can-act="1"] .fp-dot { opacity: 1; transform: none; }
/* Spent: greyer and darker, its title faded (the table darkens its band). Only a Suppressed counter is turned. */
.fp-counter[data-spent="1"] .fp-face { opacity: 0.85; filter: grayscale(0.9) brightness(0.72); }
.fp-counter[data-spent="1"] .fp-title { opacity: 0.55; }
.fp-counter[data-suppressed="1"] .fp-band { opacity: 0.95; transform: rotate(-9deg); }
/* The chosen counter (2026-11-14): raised further, a bright outline with a dark keyline outside it, and two slow swells of
   the outline when it is chosen; then still. */
.fp-counter[data-selected="1"] .fp-face { transform: translate(-3px, -7px) scale(1.12); box-shadow: 0 0 0 9px color-mix(in srgb, var(--ink-key) 55%, transparent), 7px 11px 0 color-mix(in srgb, var(--ink-key) 40%, transparent); outline: 5px solid color-mix(in srgb, var(--ink-straw) 30%, white); outline-offset: 1px; border-color: var(--fp-ink); animation: fp-chosen 1.5s ease-in-out 1; }
@keyframes fp-chosen { 0%, 50%, 100% { outline-color: color-mix(in srgb, var(--ink-straw) 30%, white); outline-offset: 1px; } 25%, 75% { outline-color: white; outline-offset: 3px; } }
.fp-counter[data-target="1"] .fp-face { outline-color: var(--ink-red); }
/* A click would attack it at close quarters (a charge, a drive through its hex): a clear red glow, eased in. */
.fp-counter[data-close="1"] .fp-face { outline-color: var(--ink-red); box-shadow: 2px 3px 0 color-mix(in srgb, var(--ink-key) 45%, transparent), 0 0 0 5px color-mix(in srgb, var(--ink-red) 55%, transparent), 0 0 22px 9px color-mix(in srgb, var(--ink-red) 70%, transparent); }
`;

/** A title in two or three letters: the first of each word ("Field gun": FG; "Scout-car troop": SCT). */
function shortTitle(title: string): string {
  const words = title.split(/[\s-]+/).filter(w => w.length > 0);
  // A one-word name ("Grenadiers", "Rifles") gives its first three letters, not one.
  if (words.length === 1) return (words[0] as string).slice(0, 3).toUpperCase();
  return words.map(w => w.charAt(0).toUpperCase()).join('').slice(0, 3);
}

function faceOf(face: CounterFace): HTMLDivElement {
  const f = document.createElement('div');
  f.className = 'fp-face';
  const title = document.createElement('div');
  title.className = 'fp-title';
  title.textContent = shortTitle(face.title);
  const block = document.createElement('div');
  block.className = 'fp-block';
  const nums = document.createElement('div');
  nums.className = 'fp-nums';
  const pair = (label: string, value: string | undefined): HTMLSpanElement => {
    const s = document.createElement('span');
    if (value === undefined) return s;
    const l = document.createElement('i');
    l.textContent = label;
    s.append(l, document.createTextNode(value));
    return s;
  };
  const top = document.createElement('div');
  top.append(pair('A', face.numbers.attack), document.createTextNode(' '), pair('R', face.numbers.range));
  const bottom = document.createElement('div');
  bottom.append(pair('D', face.numbers.defence), document.createTextNode(' '), pair('M', face.numbers.move));
  nums.append(top, bottom);
  f.append(title, block, nums);
  return f;
}

/** Where a die's pips lie on its face, as cells of a three-by-three grid (0 to 8, row by row): the faces 1 to 6. */
const PIPS: Readonly<Record<number, readonly number[]>> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

/** A die's face drawn flat: pips on a rounded square for a six-sided die, its number for any other. */
function flatDie(face: number, sides: number): Element {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 30 30');
  svg.setAttribute('class', 'fp-die');
  const body = document.createElementNS(SVG, 'rect');
  body.setAttribute('x', '1.5');
  body.setAttribute('y', '1.5');
  body.setAttribute('width', '27');
  body.setAttribute('height', '27');
  body.setAttribute('rx', '7');
  svg.appendChild(body);
  const pips = sides === 6 ? PIPS[face] : undefined;
  if (pips) {
    for (const cell of pips) {
      const pip = document.createElementNS(SVG, 'circle');
      pip.setAttribute('cx', String(15 + ((cell % 3) - 1) * 7.5));
      pip.setAttribute('cy', String(15 + (Math.floor(cell / 3) - 1) * 7.5));
      pip.setAttribute('r', '2.6');
      svg.appendChild(pip);
    }
  } else {
    const t = document.createElementNS(SVG, 'text');
    t.setAttribute('x', '15');
    t.setAttribute('y', '20.5');
    t.setAttribute('text-anchor', 'middle');
    t.textContent = String(face);
    svg.appendChild(t);
  }
  svg.dataset['face'] = String(face);
  return svg;
}

export class FlatPieces implements PiecesPort {
  private readonly grid: Grid;
  private readonly layer: HTMLDivElement;
  private readonly world: HTMLDivElement;
  private readonly under: SVGSVGElement;
  private readonly over: SVGSVGElement;
  private readonly tintGroups = new Map<TintKind, SVGGElement>();
  /** The nearer part of the reach: its own group, drawn over the reach; the reach as last tinted; and the nearer part as last asked for. */
  private readonly nearGroup: SVGGElement;
  private reachNow: readonly number[] = [];
  private nearAsked: readonly number[] = [];
  private readonly lineGroup: SVGGElement;
  private readonly threatGroup: SVGGElement;
  private readonly routeGroup: SVGGElement;
  private readonly markerGroup: SVGGElement;
  private readonly intentGroup: SVGGElement;
  private readonly answerGroup: SVGGElement;
  /** The chance of every target at once (the port's `chances`). */
  private readonly chanceGroup: SVGGElement;
  private intentNow: Intent | null = null;
  /** How many answers have been shown, of each kind: for a script to read. */
  private readonly answered = { badge: 0, refused: 0, fired: 0, landed: 0 };
  private readonly pieces = new Map<string, Piece>();
  private readonly clickers = new Set<(hit: ClickHit) => void>();
  private readonly hoverers = new Set<(hit: HoverHit) => void>();
  private lastHover: HoverHit = { counter: null, hex: -1 };
  private top = 10;
  /** Layer pixels to one of the world element's own (the view's scale): tags are drawn against it, so that they stay readable. */
  private scale = 1;
  private threatsNow: readonly ThreatLine[] = [];
  /** Multiplies every travel time: the bench sets it under 1 for the fast switch. */
  speed: () => number = () => 1;
  /** The roll's card (`dice`), once there has been one, and the timer that lets it go. */
  private diceCard: HTMLDivElement | null = null;
  private diceTimer: ReturnType<typeof setTimeout> | undefined = undefined;

  constructor(parent: HTMLElement, grid: Grid) {
    this.grid = grid;
    if (!document.head.querySelector('style[data-fp]')) {
      const style = document.createElement('style');
      style.dataset['fp'] = '1';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.layer = document.createElement('div');
    this.layer.className = 'fp-layer';
    setInks(this.layer);
    this.world = document.createElement('div');
    this.world.className = 'fp-world';
    this.under = document.createElementNS(SVG, 'svg');
    this.over = document.createElementNS(SVG, 'svg');
    this.over.style.zIndex = '100000';
    // The hex grid: the flat bake carries none. One outline per hex, from the hex module's corners.
    const lattice = document.createElementNS(SVG, 'path');
    let d = '';
    for (let hex = 0; hex < grid.cols * grid.rows; hex++) {
      d += `M${cornersOf(grid, hex).map(([x, y]) => `${(x * UNIT).toFixed(1)} ${(y * UNIT).toFixed(1)}`).join('L')}Z`;
    }
    lattice.setAttribute('d', d);
    lattice.setAttribute('class', 'fp-grid');
    this.under.appendChild(lattice);
    // Drawn from the bottom up: the set-up zone, objectives, reach (and over it its nearer part), the path, targets.
    this.nearGroup = document.createElementNS(SVG, 'g');
    for (const kind of ['zone', 'objective', 'reach', 'path', 'target'] as const) {
      const g = document.createElementNS(SVG, 'g');
      this.under.appendChild(g);
      this.tintGroups.set(kind, g);
      if (kind === 'reach') this.under.appendChild(this.nearGroup);
    }
    this.routeGroup = document.createElementNS(SVG, 'g');
    this.markerGroup = document.createElementNS(SVG, 'g');
    this.under.append(this.routeGroup, this.markerGroup);
    this.lineGroup = document.createElementNS(SVG, 'g');
    this.threatGroup = document.createElementNS(SVG, 'g');
    this.intentGroup = document.createElementNS(SVG, 'g');
    this.answerGroup = document.createElementNS(SVG, 'g');
    this.chanceGroup = document.createElementNS(SVG, 'g');
    this.over.append(this.lineGroup, this.threatGroup, this.chanceGroup, this.answerGroup, this.intentGroup);
    this.world.append(this.under, this.over);
    this.layer.appendChild(this.world);
    parent.appendChild(this.layer);
  }

  dispose(): void {
    this.layer.remove();
    this.clickers.clear();
    this.hoverers.clear();
  }

  /** Match the map under the layer: the world point (cx, cy) in h at the middle of a width x height layer, `px` layer pixels to one h. */
  setView(cx: number, cy: number, px: number, width: number, height: number): void {
    const k = px / UNIT;
    if (k !== this.scale) {
      this.scale = k;
      for (const tag of this.world.querySelectorAll<SVGGElement>('g.fp-tag')) this.placeTag(tag);
      // The tags of shots at one hex are spread along their lines by their size on screen: placed again at the new scale.
      if (this.threatsNow.length > 1) this.threats(this.threatsNow);
      if (this.intentNow) this.intent(this.intentNow);
    }
    this.world.style.transform = `translate(${(width / 2 - cx * px).toFixed(2)}px, ${(height / 2 - cy * px).toFixed(2)}px) scale(${k.toFixed(5)})`;
  }

  // ---------------------------------------------------------------------------
  // where things are
  // ---------------------------------------------------------------------------

  /** The ids of a hex's stack from the bottom, by the order they are drawn in. */
  private stackOf(hex: number): string[] {
    const here: Piece[] = [];
    for (const p of this.pieces.values()) if (p.hex === hex && !p.going) here.push(p);
    return here.sort((a, b) => Number(a.el.dataset['place']) - Number(b.el.dataset['place'])).map(p => p.id);
  }

  /** A counter's centre in h: its hex's centre, moved by its place in the stack. */
  private centre(hex: number, place: number): [number, number] {
    const [x, y] = centreOf(this.grid, hex);
    return [x + place * FAN, y - place * FAN];
  }

  private home(p: Piece, place: number): void {
    const [x, y] = this.centre(p.hex, place);
    p.el.dataset['place'] = String(place);
    p.el.style.zIndex = String(10 + place);
    p.el.style.transform = `translate(${(x * UNIT).toFixed(2)}px, ${(y * UNIT).toFixed(2)}px)`;
  }

  /** Give every counter of a hex its place: the order it holds now, closed up. */
  private settle(hex: number): void {
    this.stackOf(hex).forEach((id, i) => {
      const p = this.pieces.get(id);
      if (p) this.home(p, i);
    });
  }

  private hitAt(x: number, y: number): ClickHit {
    const hex = worldToHex(this.grid, x, y);
    let counter: string | null = null;
    let best = -1;
    for (const p of this.pieces.values()) {
      if (p.going) continue;
      const place = Number(p.el.dataset['place']);
      const [cx, cy] = this.centre(p.hex, place);
      // The top counter under the pointer (counters of different hexes never overlap).
      if (Math.abs(x - cx) <= SIDE / 2 && Math.abs(y - cy) <= SIDE / 2 && place > best) {
        counter = p.id;
        best = place;
      }
    }
    const at = counter !== null ? (this.pieces.get(counter) as Piece).hex : hex;
    return { counter, hex: at, stack: at >= 0 ? this.stackOf(at) : [] };
  }

  /** The pointer, from the bench, in world coordinates (h). `click` is a plain click only. */
  pointer(kind: 'click' | 'move' | 'leave', x: number, y: number): void {
    if (kind === 'leave') {
      if (this.lastHover.counter !== null || this.lastHover.hex !== -1) {
        this.lastHover = { counter: null, hex: -1 };
        for (const h of [...this.hoverers]) h(this.lastHover);
      }
      return;
    }
    const hit = this.hitAt(x, y);
    if (kind === 'click') {
      for (const h of [...this.clickers]) h(hit);
      return;
    }
    if (hit.counter === this.lastHover.counter && hit.hex === this.lastHover.hex) return;
    this.lastHover = { counter: hit.counter, hex: hit.hex };
    for (const h of [...this.hoverers]) h(this.lastHover);
  }

  /**
   * A point of a counter that the pointer can reach, in h (for scripts that click it): its middle,
   * or for a counter with another on top of it the corner the fan leaves bare.
   */
  whereIs(id: string): [number, number] | null {
    const p = this.pieces.get(id);
    if (!p || p.going) return null;
    const place = Number(p.el.dataset['place']);
    const [x, y] = this.centre(p.hex, place);
    const covered = this.stackOf(p.hex).length > place + 1;
    return covered ? [x - SIDE / 2 + FAN / 2, y + SIDE / 2 - FAN / 2] : [x, y];
  }

  /** A point of a hex that no counter covers, in h: just inside its lower edge. */
  bareSpot(hex: number): [number, number] {
    const [x, y] = centreOf(this.grid, hex);
    return [x - SIDE / 4, y + (0.5 + SIDE / 2) / 2];
  }

  // ---------------------------------------------------------------------------
  // PiecesPort
  // ---------------------------------------------------------------------------

  setUp(counters: readonly CounterSpec[]): void {
    const wanted = new Set(counters.map(c => c.id));
    for (const p of [...this.pieces.values()]) {
      if (!wanted.has(p.id)) void this.remove(p.id, 'withdrawn');
    }
    const touched = new Set<number>();
    for (const c of [...counters].sort((a, b) => a.hex - b.hex || a.place - b.place)) {
      let p = this.pieces.get(c.id);
      if (!p) {
        const el = document.createElement('div');
        el.className = 'fp-counter fp-appear';
        el.dataset['stock'] = c.face.stock;
        el.dataset['side'] = c.side;
        el.dataset['id'] = c.id;
        const dot = document.createElement('div');
        dot.className = 'fp-dot';
        const band = document.createElement('div');
        band.className = 'fp-band';
        band.textContent = 'SUP';
        const face = faceOf(c.face);
        face.append(band);
        const tab = document.createElement('div');
        tab.className = 'fp-tab';
        const seen = document.createElement('div');
        seen.className = 'fp-seen';
        const moved = document.createElementNS(SVG, 'svg');
        moved.setAttribute('class', 'fp-moved');
        moved.setAttribute('viewBox', '0 0 13 13');
        const chevron = document.createElementNS(SVG, 'path');
        chevron.setAttribute('d', 'M4 2.5 L9 6.5 L4 10.5');
        moved.append(chevron);
        el.append(face, tab, seen, moved, dot);
        this.world.insertBefore(el, this.over);
        p = { id: c.id, el, hex: c.hex, going: false };
        this.pieces.set(c.id, p);
        // In place at once: a new counter fades in where it stands, it does not slide in from the corner.
        el.style.transition = 'none';
        this.home(p, c.place);
        void el.offsetWidth;
        el.style.transition = '';
      } else {
        touched.add(p.hex);
        p.hex = c.hex;
        p.el.dataset['place'] = String(c.place);
        for (const k of ['selected', 'canAct', 'spent', 'suppressed', 'target', 'active', 'carried', 'revealed', 'pick', 'moved', 'close']) delete p.el.dataset[k];
      }
      touched.add(c.hex);
    }
    for (const hex of touched) this.settle(hex);
  }

  move(id: string, hex: number, opts?: { place?: number; path?: readonly number[] }): Promise<void> {
    const p = this.pieces.get(id);
    if (!p || p.going) return Promise.resolve();
    const from = p.hex;
    const fromPlace = Number(p.el.dataset['place']);
    const start = this.centre(from, fromPlace);
    // Its place where it lands: the top of the stack, or the place asked for.
    const there = this.stackOf(hex).filter(x => x !== id);
    const place = opts?.place !== undefined ? Math.max(0, Math.min(opts.place, there.length)) : there.length;
    // Its own slide is switched off while the travel plays over it; the stacks it leaves and joins close up and open as usual.
    p.el.style.transition = 'none';
    p.hex = hex;
    p.el.dataset['place'] = String(place - 0.5);
    this.settle(from);
    this.settle(hex);
    void p.el.offsetWidth;
    const end = this.centre(hex, Number(p.el.dataset['place']));
    const via = (opts?.path ?? []).slice(0, -1).map(h => centreOf(this.grid, h));
    const points: [number, number][] = [start, ...via.map(([x, y]) => [x, y] as [number, number]), end];
    if (typeof p.el.animate !== 'function' || (points.length === 2 && start[0] === end[0] && start[1] === end[1])) {
      p.el.style.transition = '';
      return Promise.resolve();
    }
    // The underlying position is already the new home (set by settle); the travel is played over it.
    let total = 0;
    const lengths = points.map((pt, i) => {
      if (i > 0) total += Math.hypot(pt[0] - (points[i - 1] as [number, number])[0], pt[1] - (points[i - 1] as [number, number])[1]);
      return total;
    });
    const frames: Keyframe[] = points.map((pt, i) => {
      const t = total > 0 ? (lengths[i] as number) / total : i / (points.length - 1);
      const lift = i === 0 || i === points.length - 1 ? 1 : 1.16;
      return { offset: t, transform: `translate(${(pt[0] * UNIT).toFixed(2)}px, ${(pt[1] * UNIT).toFixed(2)}px) scale(${lift})` };
    });
    const steps = Math.max(1, points.length - 1);
    const duration = Math.max(90, Math.min(1100, 260 + 85 * steps) * this.speed());
    this.top += 1;
    p.el.style.zIndex = String(1000 + this.top);
    const anim = p.el.animate(frames, { duration, easing: 'cubic-bezier(0.45, 0.05, 0.3, 1)' });
    return anim.finished.then(() => undefined, () => undefined).then(() => {
      p.el.style.transition = '';
      if (!p.going) this.settle(p.hex);
    });
  }

  remove(id: string, how: 'destroyed' | 'withdrawn'): Promise<void> {
    const p = this.pieces.get(id);
    if (!p || p.going) return Promise.resolve();
    p.going = true;
    this.pieces.delete(id);
    this.settle(p.hex);
    const done = (): void => {
      p.el.remove();
    };
    const face = p.el.firstElementChild as HTMLElement | null;
    if (!face || typeof face.animate !== 'function') {
      done();
      return Promise.resolve();
    }
    const frames: Keyframe[] = how === 'destroyed'
      ? [{ transform: 'none', opacity: 1 }, { transform: 'scale(1.18) rotate(4deg)', opacity: 1, offset: 0.25 }, { transform: 'scale(0.35) rotate(-16deg)', opacity: 0 }]
      : [{ opacity: 1 }, { opacity: 0 }];
    const duration = Math.max(80, (how === 'destroyed' ? 520 : 260) * this.speed());
    const anim = face.animate(frames, { duration, easing: 'ease-in', fill: 'forwards' });
    return anim.finished.then(() => undefined, () => undefined).then(done);
  }

  mark(id: string, marks: Partial<MarkSet>): void {
    const p = this.pieces.get(id);
    if (!p) return;
    const set = (key: string, v: boolean | undefined): void => {
      if (v === undefined) return;
      if (v) p.el.dataset[key] = '1';
      else delete p.el.dataset[key];
    };
    set('selected', marks.selected);
    set('canAct', marks.canAct);
    set('spent', marks.spent);
    set('suppressed', marks.suppressed);
    set('target', marks.target);
    if (marks.selected !== undefined) p.el.style.zIndex = String((marks.selected ? 500 : 10) + Number(p.el.dataset['place']));
  }

  private polygon(hex: number, inset: number): string {
    const [cx, cy] = centreOf(this.grid, hex);
    return cornersOf(this.grid, hex)
      .map(([x, y]) => `${((cx + (x - cx) * inset) * UNIT).toFixed(1)},${((cy + (y - cy) * inset) * UNIT).toFixed(1)}`)
      .join(' ');
  }

  /** Empty a group so that what it held fades out: its shapes go to a group of their own, which is taken away when it has faded. */
  private fade(g: SVGGElement): void {
    if (g.childElementCount === 0) return;
    const ghost = document.createElementNS(SVG, 'g');
    ghost.setAttribute('class', 'fp-gone');
    while (g.firstChild) ghost.appendChild(g.firstChild);
    g.parentNode?.insertBefore(ghost, g);
    setTimeout(() => ghost.remove(), 230);
  }

  tint(kind: TintKind, hexes: readonly number[]): void {
    const g = this.tintGroups.get(kind);
    if (!g) return;
    this.fade(g);
    for (const hex of hexes) {
      if (hex < 0) continue;
      if (kind === 'objective') {
        const [x, y] = centreOf(this.grid, hex);
        for (const cls of ['fp-tint-objective-under', 'fp-tint-objective']) {
          const ring = document.createElementNS(SVG, 'circle');
          ring.setAttribute('cx', (x * UNIT).toFixed(1));
          ring.setAttribute('cy', (y * UNIT).toFixed(1));
          ring.setAttribute('r', String(0.45 * UNIT));
          ring.setAttribute('class', `fp-tint ${cls}`);
          g.appendChild(ring);
        }
        continue;
      }
      const poly = document.createElementNS(SVG, 'polygon');
      poly.setAttribute('points', this.polygon(hex, kind === 'zone' ? 1 : 0.93));
      poly.setAttribute('class', `fp-tint fp-tint-${kind} fp-appear`);
      g.appendChild(poly);
    }
    if (kind === 'path' && hexes.length > 1) {
      const route = document.createElementNS(SVG, 'polyline');
      route.setAttribute('points', hexes.map(h => centreOf(this.grid, h)).map(([x, y]) => `${(x * UNIT).toFixed(1)},${(y * UNIT).toFixed(1)}`).join(' '));
      route.setAttribute('class', 'fp-route fp-appear');
      g.appendChild(route);
    }
    if (kind === 'reach') {
      // The nearer part is a part of the reach: it is drawn again on the reach as it now is, and goes when the reach does.
      this.reachNow = hexes.filter(h => h >= 0);
      if (this.reachNow.length === 0) this.nearAsked = [];
      this.drawNear();
    }
  }

  /** The nearer part of the reach (the port's optional `reachNear`): a stronger shade over those of its hexes that the reach holds. */
  reachNear(hexes: readonly number[]): void {
    this.nearAsked = hexes.filter(h => h >= 0);
    this.drawNear();
  }

  private drawNear(): void {
    const g = this.nearGroup;
    const reach = new Set(this.reachNow);
    const want = this.nearAsked.filter(h => reach.has(h));
    const key = want.join(',');
    if ((g.dataset['hexes'] ?? '') === key) return;
    g.dataset['hexes'] = key;
    this.fade(g);
    for (const hex of want) {
      const poly = document.createElementNS(SVG, 'polygon');
      poly.setAttribute('points', this.polygon(hex, 0.93));
      poly.setAttribute('class', 'fp-tint fp-tint-reach-near fp-appear');
      poly.dataset['hex'] = String(hex);
      g.appendChild(poly);
    }
  }

  lines(_kind: 'fire', segments: readonly { from: number; to: number }[]): void {
    const g = this.lineGroup;
    this.fade(g);
    for (const s of segments) {
      if (s.from < 0 || s.to < 0) continue;
      const [x1, y1] = centreOf(this.grid, s.from);
      const [x2, y2] = centreOf(this.grid, s.to);
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len === 0) continue;
      const ux = (x2 - x1) / len;
      const uy = (y2 - y1) / len;
      // From the edge of the firing counter to just short of the target's middle.
      const a: [number, number] = [x1 + ux * 0.3, y1 + uy * 0.3];
      const b: [number, number] = [x2 - ux * 0.34, y2 - uy * 0.34];
      for (const cls of ['fp-fire-under', 'fp-fire']) {
        const line = document.createElementNS(SVG, 'line');
        line.setAttribute('x1', (a[0] * UNIT).toFixed(1));
        line.setAttribute('y1', (a[1] * UNIT).toFixed(1));
        line.setAttribute('x2', (b[0] * UNIT).toFixed(1));
        line.setAttribute('y2', (b[1] * UNIT).toFixed(1));
        line.setAttribute('class', `${cls} fp-appear`);
        g.appendChild(line);
      }
      const head = document.createElementNS(SVG, 'polygon');
      const tip: [number, number] = [x2 - ux * 0.2, y2 - uy * 0.2];
      const w = 0.11;
      const pts: [number, number][] = [tip, [b[0] - uy * w, b[1] + ux * w], [b[0] + uy * w, b[1] - ux * w]];
      head.setAttribute('points', pts.map(([x, y]) => `${(x * UNIT).toFixed(1)},${(y * UNIT).toFixed(1)}`).join(' '));
      head.setAttribute('class', 'fp-fire-head fp-appear');
      g.appendChild(head);
    }
  }

  // ---- the optional members of the pieces' port ----

  /** A tag keeps its size on screen whatever the zoom: it is drawn about its own point and scaled against the view. */
  private placeTag(tag: SVGGElement): void {
    tag.setAttribute('transform', `translate(${tag.dataset['x'] ?? '0'} ${tag.dataset['y'] ?? '0'}) scale(${(1 / this.scale).toFixed(4)})`);
  }

  /** A small box of text about a point of the world (in the world element's own pixels). `dy`: how far below the point, in screen pixels. */
  private tagAt(x: number, y: number, label: string, kind: 'threat' | 'marker', dy = 0): SVGGElement {
    const g = document.createElementNS(SVG, 'g');
    g.setAttribute('class', 'fp-tag fp-appear');
    g.dataset['x'] = x.toFixed(1);
    g.dataset['y'] = y.toFixed(1);
    const w = kind === 'threat' ? 14 + label.length * 8 : 12 + label.length * 6.2;
    const h = kind === 'threat' ? 20 : 15;
    const box = document.createElementNS(SVG, 'rect');
    box.setAttribute('x', (-w / 2).toFixed(1));
    box.setAttribute('y', (dy - h / 2).toFixed(1));
    box.setAttribute('width', w.toFixed(1));
    box.setAttribute('height', String(h));
    box.setAttribute('rx', '4');
    box.setAttribute('class', `fp-${kind}-tag`);
    const text = document.createElementNS(SVG, 'text');
    text.setAttribute('x', '0');
    text.setAttribute('y', (dy + 0.5).toFixed(1));
    text.setAttribute('class', `fp-${kind}-text`);
    text.textContent = label;
    g.append(box, text);
    this.placeTag(g);
    return g;
  }

  note(id: string, notes: NoteSet): void {
    const p = this.pieces.get(id);
    if (!p) return;
    const set = (key: string, v: boolean | undefined): void => {
      if (v === undefined) return;
      if (v) p.el.dataset[key] = '1';
      else delete p.el.dataset[key];
    };
    if (notes.group !== undefined) {
      const tab = p.el.querySelector('.fp-tab');
      if (tab) tab.textContent = notes.group;
      if (notes.group === '') delete p.el.dataset['group'];
      else p.el.dataset['group'] = notes.group;
    }
    set('active', notes.active);
    set('revealed', notes.revealed);
    set('pick', notes.pick);
    set('moved', notes.moved);
    set('close', notes.close);
    if (notes.carriedBy !== undefined) set('carried', notes.carriedBy !== null);
  }

  /**
   * The chance of every target at once: a card on each counter named, over its title, the chance and, smaller in red,
   * the chance to destroy. It is drawn in the board's own units (it grows and shrinks with the counter), so that cards
   * of counters side by side never lie on one another.
   */
  chances(labels: readonly ChanceLabel[]): void {
    this.chanceGroup.replaceChildren();
    for (const l of labels) {
      const p = this.pieces.get(l.unit);
      if (!p || p.going) continue;
      const [x, y] = this.centre(p.hex, Number(p.el.dataset['place'] ?? '0'));
      const g = document.createElementNS(SVG, 'g');
      g.setAttribute('class', 'fp-chance fp-appear');
      // The middle of the counter's top half: its title (its numbers are at its foot).
      g.setAttribute('transform', `translate(${(x * UNIT).toFixed(1)} ${((y - SIDE / 4) * UNIT).toFixed(1)})`);
      g.dataset['unit'] = l.unit;
      if (l.best) g.dataset['best'] = '1';
      // The mark of the other ways to attack it ("+C"), small after the chance.
      const mark = l.also !== undefined && l.also !== '' ? `+${l.also}` : '';
      if (mark !== '') g.dataset['also'] = l.also;
      // Where every effect destroys, the two chances are one: printed once, in the destroy's red (the lead, 2026-11-14).
      const all = l.kill !== '' && l.kill === l.chance;
      const killText = all ? '' : l.kill;
      if (all) g.dataset['all'] = '1';
      const w = 10 + Math.max(l.chance.length * 9 + (mark !== '' ? 4 + mark.length * 6.5 : 0), killText.length * 6.5);
      const h = killText !== '' ? 30 : 20;
      const box = document.createElementNS(SVG, 'rect');
      box.setAttribute('x', (-w / 2).toFixed(1));
      box.setAttribute('y', (-h / 2).toFixed(1));
      box.setAttribute('width', w.toFixed(1));
      box.setAttribute('height', String(h));
      box.setAttribute('rx', '3');
      box.setAttribute('class', 'fp-chance-tag');
      const text = document.createElementNS(SVG, 'text');
      text.setAttribute('x', '0');
      text.setAttribute('y', killText !== '' ? '-5' : '0.5');
      text.setAttribute('class', 'fp-chance-text');
      text.textContent = l.chance;
      if (mark !== '') {
        const small = document.createElementNS(SVG, 'tspan');
        small.setAttribute('class', 'fp-chance-mark');
        small.textContent = ` ${mark}`;
        text.append(small);
      }
      g.append(box, text);
      if (killText !== '') {
        const kill = document.createElementNS(SVG, 'text');
        kill.setAttribute('x', '0');
        kill.setAttribute('y', '8.5');
        kill.setAttribute('class', 'fp-chance-kill');
        kill.textContent = killText;
        g.append(kill);
      }
      this.chanceGroup.appendChild(g);
    }
  }

  threats(shots: readonly ThreatLine[]): void {
    const g = this.threatGroup;
    this.threatsNow = shots.map(s => ({ ...s }));
    this.fade(g);
    const atHex = new Map<number, number>();
    for (const s of shots) {
      if (s.from < 0 || s.to < 0) continue;
      const [x1, y1] = centreOf(this.grid, s.from);
      const [x2, y2] = centreOf(this.grid, s.to);
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len === 0) continue;
      const ux = (x2 - x1) / len;
      const uy = (y2 - y1) / len;
      const a: [number, number] = [x1 + ux * 0.36, y1 + uy * 0.36];
      const b: [number, number] = [x2 - ux * 0.3, y2 - uy * 0.3];
      for (const cls of ['fp-threat-under', 'fp-threat']) {
        const line = document.createElementNS(SVG, 'line');
        line.setAttribute('x1', (a[0] * UNIT).toFixed(1));
        line.setAttribute('y1', (a[1] * UNIT).toFixed(1));
        line.setAttribute('x2', (b[0] * UNIT).toFixed(1));
        line.setAttribute('y2', (b[1] * UNIT).toFixed(1));
        line.setAttribute('class', `${cls} fp-appear`);
        if (s.live) line.dataset['live'] = '1';
        g.appendChild(line);
      }
      // Where the shot falls: a ring on the hex; the chance on a tag a little way back along the line.
      const ring = document.createElementNS(SVG, 'circle');
      ring.setAttribute('cx', (x2 * UNIT).toFixed(1));
      ring.setAttribute('cy', (y2 * UNIT).toFixed(1));
      ring.setAttribute('r', String(0.3 * UNIT));
      ring.setAttribute('class', 'fp-threat-spot fp-appear');
      g.appendChild(ring);
      // The chance, on a tag a little way back along the line; a second shot at the same hex has its tag further back.
      const nth = atHex.get(s.to) ?? 0;
      atHex.set(s.to, nth + 1);
      const back = Math.min(Math.max(0.45, len - 0.45), 0.8 + nth * (30 / (this.scale * UNIT)));
      g.append(this.tagAt((x2 - ux * back) * UNIT, (y2 - uy * back) * UNIT, s.label, 'threat'));
    }
  }

  routes(paths: readonly (readonly number[])[]): void {
    const g = this.routeGroup;
    this.fade(g);
    for (const path of paths) {
      for (const hex of path.slice(1)) {
        const poly = document.createElementNS(SVG, 'polygon');
        poly.setAttribute('points', this.polygon(hex, 0.93));
        poly.setAttribute('class', 'fp-tint fp-tint-path fp-appear');
        g.appendChild(poly);
      }
      if (path.length < 2) continue;
      const route = document.createElementNS(SVG, 'polyline');
      route.setAttribute('points', path.map(h => centreOf(this.grid, h)).map(([x, y]) => `${(x * UNIT).toFixed(1)},${(y * UNIT).toFixed(1)}`).join(' '));
      route.setAttribute('class', 'fp-route fp-appear');
      g.appendChild(route);
    }
  }

  markers(markers: readonly MarkerSpec[]): void {
    const g = this.markerGroup;
    this.fade(g);
    for (const m of markers) {
      if (m.hex < 0) continue;
      const [x, y] = centreOf(this.grid, m.hex);
      const cx = x * UNIT;
      const cy = y * UNIT;
      if (m.kind === 'screen') {
        // Three overlapping puffs over the hex.
        for (const [dx, dy, r] of [[-0.16, 0.06, 0.26], [0.14, 0.08, 0.24], [0, -0.12, 0.27]] as const) {
          const puff = document.createElementNS(SVG, 'circle');
          puff.setAttribute('cx', (cx + dx * UNIT).toFixed(1));
          puff.setAttribute('cy', (cy + dy * UNIT).toFixed(1));
          puff.setAttribute('r', String(r * UNIT));
          puff.setAttribute('class', 'fp-marker-screen fp-appear');
          g.appendChild(puff);
        }
      } else {
        const ring = document.createElementNS(SVG, 'circle');
        ring.setAttribute('cx', cx.toFixed(1));
        ring.setAttribute('cy', cy.toFixed(1));
        ring.setAttribute('r', String(0.4 * UNIT));
        ring.setAttribute('class', 'fp-marker-incoming fp-appear');
        g.appendChild(ring);
        for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
          const cross = document.createElementNS(SVG, 'line');
          cross.setAttribute('x1', (cx - dx * 0.48 * UNIT).toFixed(1));
          cross.setAttribute('y1', (cy - dy * 0.48 * UNIT).toFixed(1));
          cross.setAttribute('x2', (cx + dx * 0.48 * UNIT).toFixed(1));
          cross.setAttribute('y2', (cy + dy * 0.48 * UNIT).toFixed(1));
          cross.setAttribute('class', 'fp-marker-cross fp-appear');
          g.appendChild(cross);
        }
      }
      g.append(this.tagAt(cx, cy + 0.4 * UNIT, m.label, 'marker', 2));
    }
  }

  // ---- what a click would do, and the answers to what was done (the owner's rule of 2026-11-13) ----

  /** A group about a point of the world that keeps its size on screen; `dy`: how far above the point, in screen pixels. */
  private stickerAt(hex: number, dy: number): SVGGElement {
    const [x, y] = centreOf(this.grid, hex);
    const g = document.createElementNS(SVG, 'g');
    g.setAttribute('class', 'fp-tag');
    g.dataset['x'] = (x * UNIT).toFixed(1);
    g.dataset['y'] = (y * UNIT - dy / this.scale).toFixed(1);
    this.placeTag(g);
    return g;
  }

  private boxed(label: string, kind: 'intent' | 'refused' | 'badge', left: number): { box: SVGRectElement; text: SVGTextElement; width: number } {
    const width = left + 16 + label.length * 7.1;
    const box = document.createElementNS(SVG, 'rect');
    box.setAttribute('x', (-width / 2).toFixed(1));
    box.setAttribute('y', '-11');
    box.setAttribute('width', width.toFixed(1));
    box.setAttribute('height', '22');
    box.setAttribute('rx', '5');
    box.setAttribute('class', `fp-${kind}-tag`);
    const text = document.createElementNS(SVG, 'text');
    text.setAttribute('x', kind === 'intent' ? (-width / 2 + left + 8).toFixed(1) : '0');
    text.setAttribute('y', '0.5');
    text.setAttribute('class', `fp-${kind}-text`);
    text.textContent = label;
    return { box, text, width };
  }

  intent(i: Intent | null): void {
    const g = this.intentGroup;
    this.intentNow = i === null ? null : { ...i };
    this.layer.dataset['intent'] = i === null ? '' : `${i.act}|${i.can ? 1 : 0}|${i.hex}|${i.words}`;
    this.fade(g);
    if (i === null || i.hex < 0) return;
    const tag = this.stickerAt(i.hex, 0.62 * UNIT * this.scale + 4);
    tag.classList.add('fp-intent', 'fp-appear');
    tag.dataset['act'] = i.act;
    tag.dataset['can'] = i.can ? '1' : '0';
    const { box, text, width } = this.boxed(i.words, 'intent', 20);
    const mark = document.createElementNS(SVG, 'path');
    mark.setAttribute('d', ACT_MARKS[i.act]);
    mark.setAttribute('class', 'fp-intent-mark');
    mark.setAttribute('transform', `translate(${(-width / 2 + 6).toFixed(1)} -8)`);
    tag.append(box, mark, text);
    if (!i.can) {
      // Crossed out: the click would be refused, and the words say why.
      const cross = document.createElementNS(SVG, 'line');
      cross.setAttribute('x1', (-width / 2 + 4).toFixed(1));
      cross.setAttribute('y1', '8');
      cross.setAttribute('x2', (-width / 2 + 24).toFixed(1));
      cross.setAttribute('y2', '-8');
      cross.setAttribute('class', 'fp-intent-cross');
      tag.append(cross);
    }
    g.append(tag);
  }

  /** A label at a hex that floats up and fades away. */
  private floated(hex: number, words: string, kind: 'refused' | 'badge', tone: 'good' | 'bad' | 'plain', dy: number): void {
    const tag = this.stickerAt(hex, dy);
    const inner = document.createElementNS(SVG, 'g');
    inner.setAttribute('class', `fp-said fp-${kind}`);
    inner.dataset['tone'] = tone;
    inner.dataset['hex'] = String(hex);
    inner.dataset['words'] = words;
    const { box, text } = this.boxed(words, kind, 0);
    inner.append(box, text);
    tag.append(inner);
    this.answerGroup.append(tag);
    setTimeout(() => tag.remove(), 1600);
  }

  answer(a: TableAnswer): void {
    this.answered[a.kind] += 1;
    this.layer.dataset['answers'] = JSON.stringify(this.answered);
    this.layer.dataset['answer'] = JSON.stringify(a);
    const at = (hex: number): [number, number] => {
      const [x, y] = centreOf(this.grid, hex);
      return [x * UNIT, y * UNIT];
    };
    if (a.kind === 'refused') {
      if (a.hex < 0) return;
      // A red X over the hex that turns quickly one way and the other, and goes; why, beside it. It keeps its size on
      // screen whatever the zoom, so that it is seen with the whole board in view.
      const mark = this.stickerAt(a.hex, 0);
      const turn = document.createElementNS(SVG, 'g');
      turn.setAttribute('class', 'fp-x-turn fp-refused-x');
      turn.dataset['hex'] = String(a.hex);
      const r = 13;
      for (const cls of ['fp-x-under', '']) {
        for (const [dx, dy] of [[1, 1], [1, -1]] as const) {
          const stroke = document.createElementNS(SVG, 'line');
          stroke.setAttribute('x1', String(-dx * r));
          stroke.setAttribute('y1', String(-dy * r));
          stroke.setAttribute('x2', String(dx * r));
          stroke.setAttribute('y2', String(dy * r));
          if (cls !== '') stroke.setAttribute('class', cls);
          turn.append(stroke);
        }
      }
      mark.append(turn);
      this.answerGroup.append(mark);
      setTimeout(() => mark.remove(), 760);
      this.floated(a.hex, a.words.length > 64 ? `${a.words.slice(0, 62)}\u2026` : a.words, 'refused', 'bad', -30);
      return;
    }
    if (a.kind === 'badge') {
      if (a.hex >= 0) this.floated(a.hex, a.words, 'badge', a.tone, 0.5 * UNIT * this.scale + 2);
      return;
    }
    if (a.from < 0 || a.to < 0) return;
    const [x1, y1] = at(a.from);
    const [x2, y2] = at(a.to);
    if (a.kind === 'fired') {
      // The shot: a flash where it leaves, and a stroke that runs out to where it is going.
      const flash = document.createElementNS(SVG, 'circle');
      flash.setAttribute('cx', x1.toFixed(1));
      flash.setAttribute('cy', y1.toFixed(1));
      flash.setAttribute('r', String(0.2 * UNIT));
      flash.setAttribute('class', 'fp-flash');
      this.answerGroup.append(flash);
      setTimeout(() => flash.remove(), 420);
      if (a.from !== a.to) {
        const shot = document.createElementNS(SVG, 'line');
        shot.setAttribute('x1', x1.toFixed(1));
        shot.setAttribute('y1', y1.toFixed(1));
        shot.setAttribute('x2', x2.toFixed(1));
        shot.setAttribute('y2', y2.toFixed(1));
        shot.setAttribute('pathLength', '1');
        shot.setAttribute('stroke-dasharray', '1');
        shot.setAttribute('class', 'fp-shot');
        this.answerGroup.append(shot);
        setTimeout(() => shot.remove(), 460);
      }
      return;
    }
    // The landing: a ring by its result, and what came of it as a label.
    const ring = document.createElementNS(SVG, 'circle');
    ring.setAttribute('cx', x2.toFixed(1));
    ring.setAttribute('cy', y2.toFixed(1));
    ring.setAttribute('r', String(0.36 * UNIT));
    ring.setAttribute('class', 'fp-impact');
    ring.dataset['result'] = a.result;
    this.answerGroup.append(ring);
    setTimeout(() => ring.remove(), 680);
    this.floated(a.to, a.words, 'badge', a.tone, 0.5 * UNIT * this.scale + 2);
  }

  /**
   * A roll, plainly: while it is shown, a card at the layer's lower right with each die's face drawn flat (pips on a
   * square), the sum and the result. No physics and no tumble: the faces are there at once, the card fades in with
   * the throw and out a moment and a half after the result.
   */
  dice(roll: DiceRoll | null): void {
    clearTimeout(this.diceTimer);
    if (roll === null || !roll.rolled || roll.faces.length === 0) {
      if (this.diceCard) this.diceCard.dataset['shown'] = '0';
      return;
    }
    let card = this.diceCard;
    if (!card) {
      card = document.createElement('div');
      card.className = 'fp-dice';
      this.layer.appendChild(card);
      this.diceCard = card;
    }
    const sides = roll.sides;
    const key = `${roll.serial}|${roll.faces.join(',')}`;
    if (card.dataset['roll'] !== key) {
      card.dataset['roll'] = key;
      card.textContent = '';
      const row = document.createElement('div');
      row.className = 'fp-dice-row';
      for (const f of roll.faces) row.appendChild(flatDie(f, sides));
      const sum = document.createElement('b');
      sum.className = 'fp-dice-sum';
      sum.textContent = `= ${roll.faces.reduce((a, b) => a + b, 0)}`;
      row.appendChild(sum);
      const result = document.createElement('div');
      result.className = 'fp-dice-result';
      card.append(row, result);
    }
    card.dataset['stock'] = roll.stock ?? '';
    const result = card.querySelector<HTMLDivElement>('.fp-dice-result');
    if (result) {
      result.textContent = roll.result ?? '';
      result.dataset['fate'] = roll.fate ?? '';
    }
    card.dataset['shown'] = '1';
    if (roll.result !== null) {
      const shown = card;
      this.diceTimer = setTimeout(() => {
        shown.dataset['shown'] = '0';
      }, 1500);
    }
  }

  onClick(handler: (hit: ClickHit) => void): () => void {
    this.clickers.add(handler);
    return () => {
      this.clickers.delete(handler);
    };
  }

  onHover(handler: (hit: HoverHit) => void): () => void {
    this.hoverers.add(handler);
    return () => {
      this.hoverers.delete(handler);
    };
  }
}
