/**
 * The campaign's briefing room (docs/review/M7/campaign/design.md 5): the owner's painted room (assets/campaign/v1/,
 * tools/campaignart/), with his layers back to front: the room; the screen's picture (a still of the campaign's or the
 * next battle's picture, graded to the room, until the historic film comes); the beam; the projector; the clipboard
 * with live words; the plates with live stencil words. Three views:
 *
 *   intro     the campaign's briefing: its name, months, both sides with the game's marks and stakes (the player's
 *             marked), the story, the replacements each result earns and the points to win. Start Campaign (Continue
 *             when this campaign is kept), Campaign Log, Back. Reached from the list (`campaign=<id>` in the address).
 *   between   the next battle's briefing on the clipboard, the force on a roster sheet over the table (by formation;
 *             losses stamped with where they fell, each with Replace; the points in hand; the last battle's report;
 *             the points so far). Start Battle (Continue Battle while one is in progress), Campaign Log, Main Menu.
 *   end       the campaign's result on the clipboard: the verdict stamped, each battle's line, the total against the
 *             marks, the units that came through. New Campaign, Campaign Log, Main Menu.
 *
 * The room with no `campaign=` in its address (where a battle's end leads: client/src/campaign/battle.ts) shows the kept
 * campaign as it stands, between battles or at its end; with nothing kept it goes to the list. The kept campaign is
 * read and written through client/src/campaign/keep.ts; every step of it is client/src/campaign/force.ts's.
 */
import type { Screen, Shell } from './screen';
import { sheetTransform } from './rewards-fit';
import type { Quad } from './rewards-fit';
import { TYPED_STACK, TYPED_WEIGHT, typedFaceCss } from './typed-face';
import { answerIn, el, leaveFor, place, REDUCED, tagButton } from './ui';
import { WORDS } from './words';

// The campaign's modules, its art and the pictures it shows are fetched when the room is first shown, never with the
// title: here they are named only as types.
type LoadedCampaign = import('../campaign/content').LoadedCampaign;
type CampaignRecord = import('../campaign/force').CampaignRecord;
type Place = import('../campaign/force').Place;
type Result = import('../campaign/format').Result;
type RoomPieceId = import('../campaign/art').RoomPieceId;
type Art = typeof import('../campaign/art');
type RoomFx = import('../campaign/roomfx').RoomFx;
type Live = { fx: typeof import('../campaign/roomfx'); films: typeof import('../campaign/film'); projector: typeof import('../audio/projector'); art: Art };

declare global {
  interface Window {
    /** The campaign room, for checks. */
    __campaignRoom?: { view(): string | null; campaign(): string | null; press(control: string): boolean; record(): unknown; fx(): RoomFx | null };
  }
}

type View = 'intro' | 'between' | 'end';
type Mod = typeof import('../campaign/content') & typeof import('../campaign/force') & typeof import('../campaign/keep') & typeof import('../campaign/battle') & typeof import('../campaign/format') & typeof import('../campaign/narrate');

/** The film's picture on the pull-down screen, the front of the lens, the ceiling lamp, and the clipboard's paper (stage pixels, read off his finished look). */
const SCREEN_PICTURE = { x: 472, y: 482, w: 646, h: 418 } as const;
/** The whole pull-down screen (its paper, with a margin): dimmed a little round the picture while the film runs. */
const SCREEN = { x: 352, y: 418, w: 858, h: 546 } as const;
const LENS = { x: 1614, y: 777 } as const;
const LAMP = { x: 1350, y: 446, strength: 0.78 } as const;
/**
 * The projector's reels where his painting has them (stage pixels; each reel's axis leans away from the viewer to the
 * left), the film each holds, and the film's straight runs: off the front reel down to the lamp house, and up from
 * the body to the rear reel (each run meets its pack as a tangent, in the reel's own plane).
 */
const MECHANISM = {
  front: { at: [1626, 683], radius: 49, yaw: -0.716, film: 0.68, sense: 1, run: [[-0.458, -0.503], [0.65, -1.51]] },
  rear: { at: [1778, 725], radius: 53, yaw: -0.576, film: 0.46, sense: -1, run: [[-0.97, -0.6], [-0.379, 0.26]] },
  speed: 62,
  sprocket: [1652, 753, 5],
} as const;
/** How loud the projector runs, of its recording's own level: a quiet clatter under the room. */
const PROJECTOR_LEVEL = 0.125;
/**
 * The clipboard's top sheet: its four corners as his finished look has them (top left, top right, bottom right,
 * bottom left; tools/campaignart/main.ts cleans the same four), and the flat sheet the room's words are set on,
 * about the paper's own size. One transform carries the flat sheet onto the four corners, so that every line, stamp
 * and figure lies in the paper's own plane, tilting and converging as the board does.
 */
const PAPER_QUAD: Quad = [[2000, 436], [2606, 404], [2614, 1280], [2008, 1246]];
const PAPER = { w: 606, h: 846, top: 50, side: 24, foot: 34 } as const;
/** The typed lines' size on the sheet (his typed lines are this large), and how many letters fill a line. */
const TYPED_PX = 30;
const TYPED_ACROSS = Math.floor((PAPER.w - 2 * PAPER.side) / (TYPED_PX * 0.5));
/**
 * The plates' places, as his finished look has them (wide, middle, small): each plate's left end, its middle line and
 * its width (its height follows its cut's own shape), its words' size and the width they may fill, and how far their
 * middle lies right of the plate's (the tags have a hole at their left end).
 */
const PLATE_AT: readonly { piece: RoomPieceId; x: number; mid: number; w: number; size: number; inner: number; lean: number }[] = [
  { piece: 'plate-wide', x: 1029, mid: 1436, w: 691, size: 76, inner: 580, lean: 0 },
  { piece: 'plate-mid', x: 1763, mid: 1447, w: 511, size: 76, inner: 404, lean: 18 },
  { piece: 'plate-small', x: 2301, mid: 1447, w: 308, size: 76, inner: 226, lean: 18 },
  // Between battles only, at the foot's left: the battle group's sheet, taken up or put away.
  { piece: 'plate-mid', x: 500, mid: 1447, w: 480, size: 76, inner: 376, lean: 18 },
];
/**
 * The battle group's sheet between battles: a second sheet of the clipboard's own paper, held up in front of the
 * screen and the table, facing the viewer (it is read and clicked), a touch off square as a held sheet is. It leaves
 * the projector and the clipboard in sight.
 */
const MUSTER = { x: 104, y: 438, w: 1440, h: 920 } as const;

const STYLE_ID = 'campaign-room-style';
function addStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `${typedFaceCss()}
/* The foot's plates are the screens' own tags (screens-style.ts): their lit words take the same colour here. */
.cr-room { --lit-text: rgb(255, 178, 146); color: rgb(236, 216, 176); }
.cr-room { font-family: "Stick No Bills", "Arial Narrow", Impact, sans-serif; font-weight: 800; -webkit-font-smoothing: antialiased; }
.cr-room [hidden] { display: none !important; }
.cr-layer { position: absolute; background-size: 100% 100%; background-repeat: no-repeat; pointer-events: none; }
.cr-fx { position: absolute; left: 0; top: 0; width: 2752px; height: 1536px; pointer-events: none; }
.cr-bar-word { position: absolute; left: 1300px; top: 361px; transform: translate(-50%, -50%); white-space: nowrap; font-size: 66px; color: rgb(192, 71, 58); text-transform: uppercase; letter-spacing: 0.01em; text-shadow: 0 2px 0 rgba(0,0,0,0.45); pointer-events: none; }
.cr-paper { position: absolute; left: 0; top: 0; width: ${PAPER.w}px; height: ${PAPER.h}px; transform-origin: 0 0; box-sizing: border-box; padding: ${PAPER.top}px ${PAPER.side}px ${PAPER.foot}px; display: flex; flex-direction: column; align-items: stretch; color: rgb(34, 28, 23); overflow: hidden; pointer-events: none; }
.cr-paper .cr-title { line-height: 1; text-align: center; text-transform: uppercase; white-space: nowrap; transform: scaleX(0.86); letter-spacing: 0.012em; color: rgba(34, 28, 23, 0.92); }
.cr-paper .cr-h2 { font-size: 42px; line-height: 1; text-align: center; text-transform: uppercase; white-space: nowrap; }
.cr-paper .cr-h3 { font-size: 34px; line-height: 36px; text-align: center; text-transform: uppercase; }
.cr-paper .cr-left { text-align: left; }
.cr-paper .cr-box .cr-h2 { font-size: 38px; }
.cr-paper .cr-type { font-family: ${TYPED_STACK}; font-weight: ${TYPED_WEIGHT}; font-size: ${TYPED_PX}px; line-height: 32px; text-align: left; margin: 2px 0; }
.cr-paper .cr-rule { border-top: 3px solid rgba(34, 28, 23, 0.88); margin: 4px 0; flex: none; }
.cr-paper .cr-cols { display: flex; align-items: stretch; }
.cr-paper .cr-col { position: relative; flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; }
.cr-paper .cr-split { flex: none; width: 3px; background: rgba(34, 28, 23, 0.88); margin: 4px 0; }
.cr-paper .cr-emblems { display: flex; align-items: center; justify-content: center; gap: 8px; height: 66px; margin: 0; }
.cr-paper .cr-mark { width: 64px; height: 64px; object-fit: contain; }
.cr-paper .cr-box { border: 3px dashed rgba(34, 28, 23, 0.9); border-radius: 10px; padding: 6px 12px 2px; margin-top: auto; display: flex; flex-direction: column; flex: none; }
.cr-paper .cr-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-size: 34px; line-height: 34px; text-transform: uppercase; white-space: nowrap; }
.cr-paper .cr-row .cr-typed, .cr-paper .cr-typed { font-family: ${TYPED_STACK}; font-weight: ${TYPED_WEIGHT}; font-size: ${TYPED_PX}px; text-transform: none; }
.cr-paper .cr-rows { display: flex; flex-direction: column; }
.cr-paper .cr-rows .cr-row { font-family: ${TYPED_STACK}; font-weight: ${TYPED_WEIGHT}; font-size: ${TYPED_PX}px; line-height: 33px; text-transform: none; }
.cr-stamp { display: inline-block; align-self: center; border: 4px solid rgb(176, 44, 34); color: rgb(176, 44, 34); padding: 3px 8px 0; transform: rotate(-6deg); font-size: 34px; line-height: 1; text-align: center; text-transform: uppercase; white-space: nowrap; }
.cr-paper .cr-col > .cr-stamp { position: absolute; left: 0; top: 42px; font-size: 24px; line-height: 0.98; border-width: 3px; padding: 4px 6px 1px; transform: rotate(-9deg); opacity: 0.9; white-space: normal; }
.cr-stamp.cr-huge { font-size: 104px; border-width: 8px; padding: 4px 24px 0; margin: 16px 0 22px; transform: rotate(-7deg); }
.cr-muster { position: absolute; background-size: 100% 100%; box-sizing: border-box; padding: 30px 42px 22px; color: rgb(34, 28, 23); display: flex; flex-direction: column; transform: rotate(-0.5deg); transform-origin: 50% 60%; filter: drop-shadow(0 30px 36px rgba(0, 0, 0, 0.62)); transition: transform 0.36s cubic-bezier(0.3, 0.7, 0.3, 1), opacity 0.3s ease, visibility 0s; }
.cr-muster.cr-away { transform: translate(-40px, 560px) rotate(-7deg) scale(0.86); opacity: 0; visibility: hidden; pointer-events: none; transition: transform 0.36s cubic-bezier(0.5, 0, 0.7, 0.4), opacity 0.3s ease, visibility 0s linear 0.36s; }
.cr-quiet .cr-muster, .cr-quiet .cr-muster.cr-away { transition-duration: 0.01s; }
.cr-ms-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 30px; }
.cr-ms-title { font-size: 60px; line-height: 1; text-transform: uppercase; white-space: nowrap; margin-bottom: 2px; }
.cr-ms-facts { display: grid; grid-template-columns: max-content 1fr; column-gap: 30px; }
.cr-ms-facts .cr-ms-type { line-height: 32px; white-space: nowrap; }
.cr-ms-type { font-family: ${TYPED_STACK}; font-weight: ${TYPED_WEIGHT}; font-size: ${TYPED_PX}px; line-height: 33px; }
.cr-ms-told { flex: 1 1 0; min-width: 0; }
.cr-ms-points { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex: none; }
.cr-ms-tally { display: flex; align-items: center; gap: 18px; font-size: 40px; line-height: 1; text-transform: uppercase; white-space: nowrap; }
.cr-ms-tally b { display: inline-block; min-width: 92px; text-align: center; font-size: 74px; line-height: 0.94; font-weight: 800; border: 6px solid rgb(176, 44, 34); color: rgb(176, 44, 34); padding: 6px 12px 0; transform: rotate(-3deg); }
.cr-ms-todo { display: flex; align-items: center; gap: 16px; min-height: 56px; margin-top: 0; font-size: 40px; line-height: 44px; color: rgb(150, 34, 26); text-transform: uppercase; }
.cr-ms-rule { border-top: 4px solid rgba(34, 28, 23, 0.88); margin: 4px 0 8px; flex: none; }
.cr-ms-forms { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); column-gap: 28px; align-items: start; }
.cr-ms-form { min-width: 0; }
.cr-ms-choice { display: flex; align-items: center; gap: 16px; height: 66px; }
.cr-ms-form-name { font-size: 38px; line-height: 38px; text-transform: uppercase; white-space: nowrap; border-bottom: 3px solid rgba(34, 28, 23, 0.7); margin-bottom: 6px; }
.cr-ms-unit { display: flex; flex-direction: column; padding: 2px 4px; margin: 0 -4px; border-radius: 6px; }
.cr-ms-unit .cr-ms-type { white-space: nowrap; }
.cr-ms-unit.cr-chosen { box-shadow: 0 0 0 4px rgb(176, 44, 34); }
.cr-ms-card { display: flex; align-items: center; gap: 12px; min-height: 80px; }
.cr-ms-pic { position: relative; width: 160px; height: 80px; flex: none; }
.cr-ms-form.cr-tight .cr-ms-card { min-height: 64px; }
.cr-ms-form.cr-tight .cr-ms-pic { width: 128px; height: 64px; }
.cr-ms-fell { display: flex; align-items: center; gap: 12px; height: 44px; }
.cr-ms-fell .cr-ms-type { transform-origin: 0 50%; }
.cr-ms-pic img { width: 100%; height: 100%; object-fit: contain; }
.cr-ms-unit.cr-lost .cr-ms-pic img { filter: grayscale(1) contrast(0.7); opacity: 0.42; }
.cr-ms-pic .cr-stamp { position: absolute; left: 26px; top: 18px; font-size: 32px; border-width: 3px; padding: 2px 8px 0; transform: rotate(-8deg); background: rgba(232, 220, 196, 0.5); }
.cr-ms-text { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; }
.cr-ms-name { font-size: 34px; line-height: 36px; text-transform: uppercase; white-space: nowrap; transform-origin: 0 50%; }
.cr-ms-tag.sh-tag { position: relative; flex: none; display: block; }
.cr-ms-tag .sh-tag-text { left: 50%; top: 52%; }
.cr-ms-tag.cr-short .sh-tag-text { opacity: 0.45; }
.cr-dim { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.55); }
.cr-pop { position: absolute; background-size: 100% 100%; box-sizing: border-box; padding: 32px 46px 26px; color: rgb(34, 28, 23); display: flex; flex-direction: column; gap: 4px; transform: rotate(0.4deg); filter: drop-shadow(0 30px 40px rgba(0, 0, 0, 0.7)); }
.cr-pop h3 { margin: 0; font-size: 60px; line-height: 1; font-weight: 800; text-transform: uppercase; white-space: nowrap; }
.cr-pop .cr-note { font-family: ${TYPED_STACK}; font-weight: ${TYPED_WEIGHT}; font-size: ${TYPED_PX}px; line-height: 34px; }
.cr-pop .cr-pop-head { display: flex; justify-content: space-between; align-items: baseline; gap: 30px; border-bottom: 4px solid rgba(34, 28, 23, 0.88); padding-bottom: 6px; margin-bottom: 2px; }
.cr-pop .cr-pop-foot { display: flex; justify-content: flex-end; gap: 20px; margin-top: auto; }
.cr-log-item { display: grid; grid-template-columns: 600px 1fr; column-gap: 26px; padding: 8px 0; border-bottom: 2px solid rgba(34, 28, 23, 0.3); }
.cr-log-item .cr-log-name { font-size: 40px; line-height: 42px; text-transform: uppercase; white-space: nowrap; }
.cr-log-item .cr-log-date, .cr-log-item .cr-log-what { font-family: ${TYPED_STACK}; font-weight: ${TYPED_WEIGHT}; font-size: ${TYPED_PX}px; line-height: 33px; }
.cr-log-item .cr-next { display: inline-block; font-family: inherit; font-weight: 800; font-size: 34px; line-height: 1; text-transform: uppercase; color: rgb(176, 44, 34); border: 4px solid rgb(176, 44, 34); padding: 4px 10px 0; transform: rotate(-4deg); }
`;
  document.head.append(s);
}

export function buildCampaignRoom(shell: Shell): Screen {
  addStyle();
  const W = WORDS.campaign;
  const { sound } = shell;
  const screen = el('div', 'sh-screen cr-room');
  screen.setAttribute('role', 'region');
  screen.setAttribute('aria-label', W.briefing);
  shell.stage.element.append(screen);

  const layer = (id: RoomPieceId): HTMLDivElement => {
    const d = el('div', 'cr-layer');
    d.dataset['piece'] = id;
    d.setAttribute('aria-hidden', 'true');
    return d;
  };
  // Back to front: the room, the screen's picture, the beam, the projector, the bar, the clipboard. Their pictures and
  // places come with the art when the room is first shown (dress).
  const room = layer('room');
  // The live light (client/src/campaign/roomfx.ts): the film, the beam, the smoke. Started when the room first shows.
  const fxCanvas = el('canvas', 'cr-fx');
  fxCanvas.setAttribute('aria-hidden', 'true');
  const projector = layer('projector');
  const bar = layer('bar');
  const barWord = el('div', 'cr-bar-word');
  const clipboard = layer('clipboard');
  const paper = el('div', 'cr-paper');
  paper.style.transform = sheetTransform(PAPER.w, PAPER.h, PAPER_QUAD);
  /** A name across the sheet's head, as large as its length lets it be (the stencil's letters are about 0.46 of its size wide). */
  const titleLine = (text: string): HTMLDivElement => {
    const d = el('div', 'cr-title', text);
    d.style.fontSize = `${Math.max(44, Math.min(76, Math.floor((PAPER.w - 2 * PAPER.side) / (Math.max(1, text.length) * 0.4))))}px`;
    return d;
  };
  /** A stencil line that must stay one line: set a little narrower when its letters would not fit `width` (never under 0.82). */
  const oneLine = (cls: string, text: string, size: number, width: number): HTMLDivElement => {
    const d = el('div', cls, text);
    d.style.whiteSpace = 'nowrap';
    const natural = text.length * 0.47 * size;
    if (natural > width) d.style.transform = `scaleX(${Math.max(0.82, width / natural).toFixed(3)})`;
    return d;
  };
  /** How many typed lines a text takes on the sheet (every typed letter is as wide as the next: plain arithmetic). */
  const typedLines = (text: string): number => {
    let lines = 1;
    let at = 0;
    for (const word of text.split(/\s+/).filter(Boolean)) {
      if (at > 0 && at + 1 + word.length > TYPED_ACROSS) {
        lines += 1;
        at = word.length;
      } else at += (at > 0 ? 1 : 0) + word.length;
    }
    return lines;
  };
  const muster = el('div', 'cr-muster cr-away');
  place(muster, MUSTER);
  muster.setAttribute('role', 'region');
  screen.append(room, fxCanvas, projector, bar, barWord, clipboard, paper, muster);
  /**
   * The plates at the foot: the screens' own tags (ui.ts `tagButton`: the side selector's and the scenario list's
   * control, so their lit, focus and press states are the same by construction), on his kit's three plates. Made when
   * the art has come.
   */
  let plates: HTMLButtonElement[] = [];
  /** The kit's two tags' pictures, for the small tags on the battle group's sheet, and the sheet's own paper. */
  let tagArt: { mid: string; small: string } | null = null;
  let sheetArt: string | null = null;
  /**
   * A small tag on the sheet: the same control as the plates (the tags' own classes, so it lights, focuses and
   * presses as they do), on one of the kit's tags.
   */
  const miniTag = (words: string, o: { w: number; h: number; size: number; wide?: boolean; id: string; press(): void }): HTMLButtonElement => {
    const t = el('button', 'sh-tag cr-ms-tag');
    t.type = 'button';
    t.dataset['control'] = o.id;
    t.style.width = `${o.w}px`;
    t.style.height = `${o.h}px`;
    if (tagArt) t.style.backgroundImage = `url("${o.wide ? tagArt.mid : tagArt.small}")`;
    const text = el('span', 'sh-tag-text', words);
    text.style.fontSize = `${Math.min(o.size, Math.floor((o.w - o.h * 0.9) / (Math.max(1, words.length) * 0.475)))}px`;
    t.append(text);
    t.addEventListener('click', () => o.press());
    t.addEventListener('pointerdown', () => t.classList.add('sh-down'));
    for (const up of ['pointerup', 'pointerleave', 'pointercancel', 'blur'] as const) t.addEventListener(up, () => t.classList.remove('sh-down'));
    return t;
  };
  /** The room's pictures and places, once its art has come. */
  let dressed = false;
  function dress(art: Art): void {
    if (dressed) return;
    dressed = true;
    for (const d of screen.querySelectorAll<HTMLElement>('.cr-layer')) {
      const id = d.dataset['piece'] as RoomPieceId;
      const [x, y, w, h] = art.ROOM[id].place;
      place(d, { x, y, w, h });
      d.style.backgroundImage = `url("${art.roomAddress(id)}")`;
    }
    sheetArt = art.roomAddress('roster-sheet');
    muster.style.backgroundImage = `url("${sheetArt}")`;
    tagArt = { mid: art.roomAddress('plate-mid'), small: art.roomAddress('plate-small') };
    plates = PLATE_AT.map((p, i) => {
      const [, , cw, ch] = art.ROOM[p.piece].place;
      const h = Math.round((p.w * ch) / cw);
      const y = Math.round(p.mid - h / 2);
      const tag = tagButton({
        root: screen,
        picture: { id: p.piece, file: art.ROOM[p.piece].file, width: p.w, height: h, at: [p.x, y], shows: '' },
        address: () => art.roomAddress(p.piece),
        words: '',
        text: { x: p.x + p.w / 2 + p.lean, y: p.mid + 2, size: p.size },
        id: '',
        press: () => {
          const a = actions[i];
          if (!a) return;
          sound.ui('press');
          a.run();
        },
      });
      tag.hidden = true;
      // (Under the pop-outs, which are the screen's last children.)
      screen.insertBefore(tag, pops);
      return tag;
    });
  }
  const pops = el('div', '');
  screen.append(pops);
  const answer = answerIn(screen);
  // The answer line lies just above the roster sheet, never over its controls.
  // The answer line lies across the foot of the battle group's sheet, over the table.
  const say = (text: string, refused = false): void => answer.say(text, { x: MUSTER.x + MUSTER.w / 2, y: MUSTER.y + MUSTER.h + 2, align: 'middle' }, refused);

  let mod: Mod | null = null;
  let campaign: LoadedCampaign | null = null;
  let record: CampaignRecord | null = null;
  let view: View | null = null;
  /** Between battles: whether the battle group's sheet is held up (null: as the moment asks), and the place being replaced. */
  let groupUp: boolean | null = null;
  let choosing: string | null = null;
  /** What each plate does now, by its index. */
  let actions: { words: string; id: string; run(): void }[] = [];

  const store = (): ReturnType<Mod['localCampaignStore']> => (mod as Mod).localCampaignStore();
  const readRecord = (): CampaignRecord | null => (mod as Mod).readKept(store(), id => (mod as Mod).campaignById(id)?.data ?? null).record;
  const cost = (type: string): number => (mod as Mod).costOf((mod as Mod).CAMPAIGN_UNITS)(type);
  const typeName = (type: string): string => (mod as Mod).CAMPAIGN_UNITS.types.find(t => t.id === type)?.name ?? type;
  const battleTitle = (id: string): string => campaign?.battles.find(b => b.id === id)?.title ?? id;
  const sideWord = (c: LoadedCampaign): string => c.battles[0]?.data.briefing?.sides[c.battles[0].mine]?.short ?? c.data.side;
  const mostPoints = (c: LoadedCampaign): number => c.data.scoring.points.decisive * c.battles.length;

  function setPlates(list: { words: string; id: string; run(): void }[]): void {
    actions = list;
    plates.forEach((b, i) => {
      const a = list[i];
      const words = b.querySelector<HTMLElement>('.sh-tag-text');
      const at = PLATE_AT[i];
      if (words && at) {
        words.textContent = a ? a.words : '';
        // His words are as tall on every plate; a long word on a short plate is set smaller, to stay inside its rim.
        words.style.fontSize = `${Math.min(at.size, Math.floor(at.inner / (Math.max(1, a?.words.length ?? 1) * 0.475)))}px`;
      }
      b.hidden = !a;
      b.dataset['control'] = a?.id ?? '';
    });
  }

  function clearPops(): void {
    pops.replaceChildren();
  }
  function pop(build: (box: HTMLDivElement) => void, at: { x: number; y: number; w: number; h: number }): HTMLDivElement {
    clearPops();
    const dim = el('div', 'cr-dim');
    dim.addEventListener('click', clearPops);
    const box = el('div', 'cr-pop');
    place(box, at);
    // (A pop-out is a sheet of the room's own paper, laid over the room.)
    if (sheetArt) box.style.backgroundImage = `url("${sheetArt}")`;
    box.setAttribute('role', 'dialog');
    build(box);
    pops.append(dim, box);
    (box.querySelector('button') as HTMLButtonElement | null)?.focus({ preventScroll: true });
    return box;
  }

  // ---- the views ---------------------------------------------------------------------------------------------

  function intro(): void {
    const c = campaign as LoadedCampaign;
    view = 'intro';
    bar.hidden = true;
    barWord.hidden = true;
    muster.classList.add('cr-away');
    clearPops();
    // The clipboard, as he laid it out: the name, the briefing's heading, the two sides with their marks and stakes,
    // the story typed, and the box of what each result brings.
    paper.replaceChildren();
    const sides = c.data.briefing.sides;
    const cols = el('div', 'cr-cols');
    sides.forEach((s, i) => {
      if (i === 1) cols.append(el('div', 'cr-split'));
      const col = el('div', 'cr-col');
      const across = (PAPER.w - 2 * PAPER.side - 3) / 2 - 18;
      col.append(oneLine('cr-h3', s.name, 34, across));
      const emblems = el('div', 'cr-emblems');
      const mark = el('img', 'cr-mark');
      mark.alt = s.mark === 'cross' ? 'Black cross' : 'Hammer and sickle';
      void import('../uiart').then(u => {
        const a = u.panelSkin().mark(s.mark, 'plate');
        if (a) mark.src = a;
      });
      emblems.append(mark);
      col.append(emblems);
      // The player's side is stamped, in the free paper left of its mark (two short lines, touching no word).
      if (i === 0) {
        const stamp = el('div', 'cr-stamp');
        W.youCommand.split(' ').forEach((word, n) => {
          if (n > 0) stamp.append(document.createElement('br'));
          stamp.append(word);
        });
        col.append(stamp);
      }
      const word = c.battles[0]?.data.briefing?.sides.find(x => x.side === s.side)?.short ?? s.side;
      col.append(oneLine('cr-h3', W.stakes(word), 34, across), oneLine('cr-h3', s.stakes, 34, across));
      cols.append(col);
    });
    const box = el('div', 'cr-box');
    box.append(el('div', 'cr-h2', W.rewards));
    for (const r of ['decisive', 'victory', 'defeat', 'heavy'] as Result[]) {
      const row = el('div', 'cr-row');
      row.append(el('span', '', `${W.results[r]}: +${c.data.replacements.earned[r]}`), el('span', 'cr-typed', W.points(c.data.scoring.points[r])));
      box.append(row);
    }
    box.append(el('div', 'cr-type', W.pointsRule(c.data.scoring.victory, mostPoints(c))));
    paper.append(titleLine(c.data.title), el('div', 'cr-rule'), el('div', 'cr-h2', W.briefing), cols, el('div', 'cr-rule'), el('div', 'cr-type', c.data.briefing.story), box);
    const keptHere = record && record.campaign === c.data.id;
    setPlates([
      { words: keptHere ? W.continue : W.start, id: keptHere ? 'continue' : 'start', run: keptHere ? goOn : start },
      { words: W.log, id: 'log', run: openLog },
      { words: W.plateBack, id: 'back', run: () => shell.back() },
    ]);
    narrate();
  }

  function between(): void {
    const c = campaign as LoadedCampaign;
    const r = record as CampaignRecord;
    const m = mod as Mod;
    view = 'between';
    const k = m.nextBattle(c.data, r) ?? c.battles.length - 1;
    const b = c.battles[k];
    if (!b) return;
    bar.hidden = false;
    barWord.hidden = false;
    barWord.textContent = W.barBattle(c.data.title, k + 1, c.battles.length);
    clearPops();
    // The clipboard: the next battle's briefing, in the same hand: its name, when and how long, the situation typed,
    // the player's aim, and the objectives with what each is worth. What there is no room for is left to the battle's
    // own briefing (lines are counted, never cut).
    paper.replaceChildren();
    const told = b.data.briefing;
    const mine = told?.sides[b.mine];
    const theirs = b.data.sides[1 - b.mine];
    const against = new Map<string, number>();
    for (const f of theirs?.formations ?? []) for (const u of f.units) {
      const t = m.CAMPAIGN_UNITS.types.find(x => x.id === u.type);
      if (t && t.carries === 0) against.set(t.name, (against.get(t.name) ?? 0) + 1);
    }
    const situation = told?.situation ?? '';
    const aim = mine?.aim ?? '';
    const versus = `${W.against} ${[...against].map(([n, x]) => (x > 1 ? `${n} × ${x}` : n)).join(', ')}.`;
    const first = b.data.initiative === b.data.sides[b.mine]?.id ? W.moveFirst : W.moveSecond;
    paper.append(el('div', 'cr-h2', W.nextBattle), titleLine(b.title), el('div', 'cr-rule'), el('div', 'cr-h3', `${b.date} · ${b.turns} ${W.turns}`), el('div', 'cr-type', situation), el('div', 'cr-h3 cr-left', W.aim), el('div', 'cr-type', aim));
    const goals = el('div', 'cr-box');
    goals.append(el('div', 'cr-h2', W.objectives));
    const rows = el('div', 'cr-rows');
    b.data.objectives.forEach((o, i) => {
      const row = el('div', 'cr-row');
      row.append(el('span', '', told?.objectives[i]?.name ?? o.hex), el('span', '', `${o.points} ${W.perTurn}`));
      rows.append(row);
    });
    goals.append(rows);
    // The sheet's height in typed lines' worth: the lines that are always there, then the two that come if they fit.
    let room = PAPER.h - PAPER.top - PAPER.foot - (42 + 72 + 16 + 36 + 36 + 8 * 2) - (typedLines(situation) + typedLines(aim)) * 33 - (16 + 42 + b.data.objectives.length * 33 + 6);
    for (const extra of [first, versus]) {
      const takes = typedLines(extra) * 33 + 8;
      if (takes > room) continue;
      room -= takes;
      paper.append(el('div', 'cr-type', extra));
    }
    paper.append(goals);
    // The battle group's sheet is held up when there is something to do on it: a loss to replace.
    const up = groupUp ?? (r.stage === 'between' && r.places.some(p => p.type === null));
    muster.classList.toggle('cr-away', !up);
    if (up) drawMuster(k);
    else choosing = null;
    setPlates([
      r.stage === 'battle' ? { words: W.continueBattle, id: 'continue-battle', run: toBattle } : { words: W.startBattle, id: 'start-battle', run: startBattle },
      { words: W.log, id: 'log', run: openLog },
      { words: W.mainMenu, id: 'main-menu', run: () => shell.go('title') },
      {
        words: up ? W.putAway : W.battleGroup,
        id: 'battle-group',
        run: () => {
          groupUp = !up;
          choosing = null;
          between();
        },
      },
    ]);
    narrate();
  }

  /**
   * The battle group on its sheet, for battle `k`: what happened and the points so far; the points in hand, always in
   * sight, with Fill for Me beside them; one line of what to do (or, while a place is being replaced, what may take
   * it); and the whole group by formation as unit cards: a lost unit stamped, with where it fell, what it costs and
   * its Replace; a unit bought since the last battle with what was spent and its Undo.
   */
  function drawMuster(k: number): void {
    const c = campaign as LoadedCampaign;
    const r = record as CampaignRecord;
    const m = mod as Mod;
    muster.setAttribute('aria-label', W.battleGroup);
    muster.replaceChildren();
    // (Replacements are bought until the next battle begins: before the first battle there is nothing lost yet.)
    const open = r.stage !== 'battle' && r.stage !== 'ended';
    const lost = r.places.filter(p => p.type === null);
    const units = c.data.force.formations.flatMap(f => f.units);
    const startType = (id: string): string => units.find(u => u.id === id)?.type ?? '';
    const nameOf = (id: string): string => units.find(u => u.id === id)?.name ?? id;
    const canBuy = lost.some(p => m.kindOf(c.data, startType(p.id)).some(type => m.whyNot(c.data, r, p.id, type, cost) === null));
    if (choosing !== null && !(open && lost.some(p => p.id === choosing))) choosing = null;

    // The head: what happened, and the points.
    const head = el('div', 'cr-ms-head');
    const told = el('div', 'cr-ms-told');
    // One fact a line, its figures in one column: the group's strength, what the last battle was and brought, the campaign's points.
    const facts = el('div', 'cr-ms-facts');
    const fact = (label: string, value: string): void => facts.append(el('div', 'cr-ms-type', label), el('div', 'cr-ms-type', value));
    fact(W.strengthLabel, W.strengthValue(m.strength(r.places, cost), m.fullStrength(c.data, cost)));
    const last = r.fought[r.fought.length - 1];
    if (last) {
      fact(W.afterLabel(battleTitle(last.battle)), W.afterValue(W.results[last.result], last.score[0], last.score[1]));
      fact(W.broughtLabel, W.broughtValue(last.points, last.earned));
    }
    fact(W.campaignLabel, W.campaignValue(m.totalPoints(r), c.data.scoring.victory, mostPoints(c)));
    told.append(el('div', 'cr-ms-title', c.data.force.name), facts);
    const points = el('div', 'cr-ms-points');
    const tally = el('div', 'cr-ms-tally');
    tally.append(el('span', '', W.inHand), el('b', '', String(r.inHand)));
    points.append(tally);
    if (open && lost.length > 0) {
      // The owner's automatic choice: buy back the lost units, cheapest first, while the points last.
      points.append(miniTag(W.fill, {
        w: 300, h: 70, size: 44, wide: true, id: 'fill',
        press: () => {
          const was = record as CampaignRecord;
          record = m.fillForMe(c.data, was, cost);
          const n = record.pending.length - was.pending.length;
          if (n > 0) {
            m.writeKept(store(), record);
            sound.ui('press');
            choosing = null;
            between();
            say(W.filled(n, record.inHand));
          } else {
            sound.ui('refuse');
            say(W.nothingToFill, true);
          }
        },
      }), el('span', 'cr-ms-type', W.fillNote));
    }
    head.append(told, points);

    // The one line: what to do here. While a place is being replaced, what may take it, each with its cost.
    const todo = el('div', 'cr-ms-todo');
    const choice = el('div', 'cr-ms-choice');
    if (choosing !== null) {
      const id = choosing;
      todo.append(el('span', '', W.todoChoose(nameOf(id))));
      for (const type of m.kindOf(c.data, startType(id))) {
        const why = m.whyNot(c.data, r, id, type, cost);
        const t = miniTag(W.buyFor(typeName(type), cost(type)), {
          w: 286, h: 62, size: 40, wide: true, id: `buy-${type}`,
          press: () => {
            if (why !== null) {
              sound.ui('refuse');
              say(why === 'not enough points' ? W.cannot : W.nothingToFill, true);
              return;
            }
            record = m.buy(c.data, record as CampaignRecord, id, type, cost);
            m.writeKept(store(), record);
            sound.ui('press');
            choosing = null;
            between();
            say(W.bought(typeName(type), nameOf(id), record.inHand));
          },
        });
        t.dataset['buy'] = type;
        if (why !== null) t.classList.add('cr-short');
        choice.append(t);
      }
      choice.append(miniTag(W.cancel, {
        w: 190, h: 62, size: 40, id: 'cancel',
        press: () => {
          sound.ui('press');
          choosing = null;
          between();
        },
      }));
    } else todo.append(el('span', '', !open ? W.todoBattle : lost.length === 0 ? W.todoFull : canBuy ? W.todoReplace : W.todoNoPoints));

    // The battle group, by formation.
    const takes = new Set(c.battles[k]?.formations ?? []);
    const forms = el('div', 'cr-ms-forms');
    for (const f of c.data.force.formations) {
      const box = el('div', 'cr-ms-form');
      box.append(el('div', 'cr-ms-form-name', f.name));
      // A formation with many losses is set tighter (smaller pictures), so that its cards stay on the sheet.
      const tall = f.units.reduce((sum, u) => sum + (r.places.find(x => x.id === u.id)?.type === null ? 128 : 84), 0);
      if (tall > MUSTER.h - 366 - (choosing !== null ? 66 : 0)) box.classList.add('cr-tight');
      for (const u of f.units) box.append(unitCard(u.id, u.name, r.places.find(x => x.id === u.id) as Place, takes.has(f.id), open));
      forms.append(box);
    }
    muster.append(head, todo);
    if (choosing !== null) muster.append(choice);
    muster.append(el('div', 'cr-ms-rule'), forms);
  }

  /** A unit's card on the sheet: its picture, its name, and its line; lost, where it fell, its cost and Replace; new, what was spent and Undo. */
  function unitCard(id: string, name: string, p: Place, takesPart: boolean, open: boolean): HTMLDivElement {
    const c = campaign as LoadedCampaign;
    const r = record as CampaignRecord;
    const isLost = p.type === null;
    const bought = r.pending.find(x => x.place === id);
    const d = el('div', `cr-ms-unit${isLost ? ' cr-lost' : ''}${choosing === id ? ' cr-chosen' : ''}`);
    d.dataset['place'] = id;
    const type = p.type ?? (c.data.force.formations.flatMap(f => f.units).find(u => u.id === id)?.type ?? '');
    const card = el('div', 'cr-ms-card');
    const pic = el('div', 'cr-ms-pic');
    const img = el('img', '');
    img.alt = '';
    // The type by its short name (the one its counter prints), once the units' pictures have come.
    const typeLine = el('div', 'cr-ms-type', typeName(type));
    void import('../unitart').then(u => {
      const a = u.unitArt(type);
      if (a?.card) img.src = a.card;
      if (a?.counter) typeLine.textContent = a.counter;
    });
    pic.append(img);
    const text = el('div', 'cr-ms-text');
    const label = el('div', 'cr-ms-name', name);
    // (A long name is set a little narrower, to stay on its line.)
    const natural = name.length * 0.47 * 34;
    if (natural > 236) label.style.transform = `scaleX(${Math.max(0.74, 236 / natural).toFixed(3)})`;
    text.append(label);
    if (isLost) {
      pic.append(el('div', 'cr-stamp', W.lost));
      text.append(typeLine);
      card.append(pic, text);
      const fell = el('div', 'cr-ms-fell');
      const where = el('span', 'cr-ms-type', W.lostWhere(battleTitle(p.lostAt ?? '')));
      let room = 424;
      if (open) {
        const b = miniTag(choosing === id ? W.cancel : W.replaceFor(cost(type)), {
          w: 176, h: 44, size: 30, id: 'replace',
          press: () => {
            sound.ui('press');
            choosing = choosing === id ? null : id;
            between();
          },
        });
        b.dataset['replace'] = id;
        fell.append(b);
        room -= 176 + 12;
      }
      // (Where it fell stays on the tag's line: a long name is set a little narrower.)
      const wide = (where.textContent ?? '').length * TYPED_PX * 0.5;
      if (wide > room) where.style.transform = `scaleX(${Math.max(0.7, room / wide).toFixed(3)})`;
      fell.append(where);
      d.append(card, fell);
      return d;
    }
    text.append(typeLine);
    if (bought && open) {
      const line = el('div', 'cr-ms-fell');
      const b = miniTag(W.undo, {
        w: 176, h: 44, size: 30, id: 'undo',
        press: () => {
          record = (mod as Mod).takeBack(record as CampaignRecord, id);
          (mod as Mod).writeKept(store(), record);
          sound.ui('press');
          choosing = null;
          between();
          say(W.takenBack(name, bought.cost));
        },
      });
      b.dataset['undo'] = id;
      line.append(b, el('span', 'cr-ms-type', W.spent(bought.cost)));
      card.append(pic, text);
      d.append(card, line);
      return d;
    }
    if (!takesPart) text.append(el('div', 'cr-ms-type', W.staysBack));
    card.append(pic, text);
    d.append(card);
    return d;
  }

  function end(): void {
    const c = campaign as LoadedCampaign;
    const r = record as CampaignRecord;
    const m = mod as Mod;
    view = 'end';
    bar.hidden = false;
    barWord.hidden = false;
    barWord.textContent = W.barEnd(c.data.title);
    muster.classList.add('cr-away');
    clearPops();
    paper.replaceChildren();
    const verdict = r.verdict ?? 'defeat';
    const total = m.totalPoints(r);
    paper.append(el('div', 'cr-h2', W.result), titleLine(c.data.title), el('div', 'cr-stamp cr-huge', W.verdicts[verdict]));
    if (verdict === 'broken') paper.append(el('div', 'cr-h3', W.broken(c.data.force.name)));
    paper.append(el('div', 'cr-h3', W.endPoints(total, mostPoints(c), c.data.scoring.victory)), el('div', 'cr-rule'));
    const fought = el('div', 'cr-rows');
    for (const f of r.fought) {
      const line = el('div', 'cr-row');
      const b = c.battles.find(x => x.id === f.battle);
      line.append(el('span', '', b?.title ?? f.battle), el('span', '', `${W.results[f.result]} ${f.points}`));
      fought.append(line);
    }
    paper.append(fought, el('div', 'cr-rule'));
    const units = c.data.force.formations.flatMap(f => f.units);
    const through = units.filter(u => {
      const p = r.places.find(x => x.id === u.id);
      return p && p.type !== null && p.fought === r.fought.length;
    });
    paper.append(el('div', 'cr-type', `${W.cameThrough(through.map(u => u.name).join(', ') || W.none)} ${W.cameHome(r.places.filter(p => p.type !== null).length, units.length)}`));
    setPlates([
      { words: W.newCampaign, id: 'new-campaign', run: start },
      { words: W.log, id: 'log', run: openLog },
      { words: W.mainMenu, id: 'main-menu', run: () => shell.go('title') },
    ]);
    narrate();
  }

  function openLog(): void {
    const c = campaign as LoadedCampaign;
    const r = record && record.campaign === c.data.id ? record : null;
    pop(box => {
      const head = el('div', 'cr-pop-head');
      head.append(el('h3', '', W.logHeading(c.data.title)), el('div', 'cr-note', W.soFar(r ? (mod as Mod).totalPoints(r) : 0, c.data.scoring.victory, mostPoints(c))));
      box.append(head);
      c.battles.forEach((b, i) => {
        const item = el('div', 'cr-log-item');
        const left = el('div', '');
        left.append(el('div', 'cr-log-name', `${i + 1}. ${b.title}`), el('div', 'cr-log-date', b.date));
        const right = el('div', '');
        const f = r?.fought[i];
        if (f) {
          right.append(el('div', 'cr-log-what', `${W.results[f.result]}, ${f.score[0]} to ${f.score[1]} · +${f.points}`));
          const names = (ids: readonly string[]): string => ids.map(id => c.data.force.formations.flatMap(x => x.units).find(u => u.id === id)?.name ?? id).join(', ');
          right.append(el('div', 'cr-log-what', W.logLost(f.lost.length ? names(f.lost) : W.none)));
          if (f.bought.length) right.append(el('div', 'cr-log-what', W.logBought(f.bought.map(x => `${names([x.place])} (${typeName(x.type)}, ${x.cost})`).join(', '))));
        } else {
          right.append(r && i === r.fought.length ? el('span', 'cr-next', W.logNext) : el('div', 'cr-log-what', W.logToCome));
        }
        item.append(left, right);
        box.append(item);
      });
      const foot = el('div', 'cr-pop-foot');
      foot.append(miniTag(W.close, {
        w: 250, h: 68, size: 46, id: 'close',
        press: () => {
          sound.ui('press');
          clearPops();
        },
      }));
      box.append(foot);
    }, { x: 300, y: 440, w: 1880, h: 900 });
  }

  // ---- the steps -------------------------------------------------------------------------------------------

  function start(): void {
    const c = campaign as LoadedCampaign;
    const m = mod as Mod;
    const other = readRecord();
    const go = (): void => {
      record = m.newRecord(c.data, m.freshSeed(), 'dev');
      m.writeKept(store(), record);
      leaveAddress();
      between();
    };
    if (other && other.campaign !== c.data.id && other.stage !== 'ended') {
      const oc = m.campaignById(other.campaign);
      pop(box => {
        box.append(el('div', 'cr-note', W.replaceAsk(oc?.data.title ?? other.campaign, oc ? sideWord(oc) : '', Math.min(other.fought.length + 1, oc?.battles.length ?? 1), oc?.battles.length ?? 1)));
        const row = el('div', 'cr-pop-foot');
        row.append(
          miniTag(W.replaceNo, {
            w: 300, h: 68, size: 46, wide: true, id: 'keep',
            press: () => {
              sound.ui('press');
              clearPops();
            },
          }),
          miniTag(W.replaceYes, {
            w: 400, h: 68, size: 46, wide: true, id: 'start-anyway',
            press: () => {
              sound.ui('press');
              go();
            },
          }),
        );
        box.append(row);
      }, { x: 596, y: 600, w: 1560, h: 290 });
      return;
    }
    go();
  }

  /** Continue: the kept campaign of this room, where it stands. */
  function goOn(): void {
    leaveAddress();
    showRecord();
  }

  function showRecord(): void {
    if (!record) return intro();
    if (record.stage === 'ended') end();
    else between();
  }

  function startBattle(): void {
    const c = campaign as LoadedCampaign;
    const m = mod as Mod;
    const r = record as CampaignRecord;
    const k = m.nextBattle(c.data, r);
    if (k === null) return;
    record = m.beginBattle(c.data, r, c.battles, m.CAMPAIGN_UNITS, m.saveIdOf(r, k));
    m.writeKept(store(), record);
    toBattle();
  }

  function toBattle(): void {
    const c = campaign as LoadedCampaign;
    // The narrator falls silent as the room is left for the battle.
    voice?.narrationSays([]);
    leaveFor(screen, (mod as Mod).battleAddress(shell.model.get(), c, record as CampaignRecord, window.location.pathname));
  }

  /** The room's address without the campaign word: a reload shows the kept campaign as it stands. */
  function leaveAddress(): void {
    const u = new URL(window.location.href);
    u.searchParams.delete('campaign');
    window.history.replaceState(window.history.state, '', u);
  }

  let loading: Promise<void> | null = null;
  const load = (): Promise<void> =>
    (loading ??= Promise.all([import('../campaign/content'), import('../campaign/force'), import('../campaign/keep'), import('../campaign/battle'), import('../campaign/format'), import('../campaign/art'), import('../campaign/narrate')]).then(
      ([a, b, c, d, e, art, n]) => {
        mod = { ...a, ...b, ...c, ...d, ...e, ...n } as Mod;
        dress(art);
      },
    ));

  // ---- the live light and the projector's sound ----------------------------------------------------------------
  // The film, the beam and the smoke (client/src/campaign/roomfx.ts) and the projector's clatter
  // (client/src/audio/projector.ts) come after the room's words and never hold them up; without them the room is
  // the painting alone.
  let live: Live | null = null;
  let fx: RoomFx | null = null;
  let showing = false;
  let lighting: Promise<void> | null = null;
  const loadLive = (): Promise<void> =>
    (lighting ??= Promise.all([import('../campaign/roomfx'), import('../campaign/film'), import('../audio/projector'), import('../campaign/art')]).then(
      ([a, b, c, art]) => {
        live = { fx: a, films: b, projector: c, art };
      },
      (err: unknown) => console.warn(err),
    ));
  /** The room's light as the room now is: started for this campaign's film the first time, running while the room shows. */
  function light(): void {
    if (!live || !campaign) return;
    const reduced = REDUCED();
    if (!fx) {
      // The campaign names its film; `none` is a dark screen, and a name the films do not have is said, not guessed at.
      const named = campaign.data.film.briefing;
      const loop = named === 'none' ? null : (live.films.FILMS.get(named) ?? null);
      if (named !== 'none' && !loop) console.error(`the campaign '${campaign.data.id}' names the film '${named}', which assets/film/v1/film.json does not have`);
      const art = live.art;
      fx = live.fx.startRoomFx({
        canvas: fxCanvas,
        look: { picture: [SCREEN_PICTURE.x, SCREEN_PICTURE.y, SCREEN_PICTURE.w, SCREEN_PICTURE.h], screen: [SCREEN.x, SCREEN.y, SCREEN.w, SCREEN.h], lens: [LENS.x, LENS.y], lamp: [LAMP.x, LAMP.y, LAMP.strength] },
        layers: { far: art.roomAddress('far'), paper: { address: art.roomAddress('paper'), place: art.ROOM.paper.place }, body: { address: art.roomAddress('projector-body'), place: art.ROOM['projector-body'].place }, reels: art.reelsAddress() },
        mechanism: MECHANISM,
        film: loop,
        reduced,
        seed: Number(shell.params.get('seed') ?? 1943) || 1943,
        clatterHz: live.projector.PROJECTOR_CLATTER_HZ,
      });
      // The live room draws the projector's body itself, between its light and its reels: the painted stand-in goes.
      projector.hidden = fx !== null;
      if (fx) {
        const made = fx;
        shell.stage.onFit(fit => made.resize(fit.pixels));
        // A capture's moment (`t=` in the address): the room's clock stands there.
        const t = shell.params.get('t');
        if (t !== null && Number.isFinite(Number(t))) void made.at(Number(t));
      }
    }
    fx?.run(showing);
    // The projector clatters while its film runs (as if sound always plays: the engine and the browser decide).
    live.projector.projectorRuns(showing && fx && !reduced ? PROJECTOR_LEVEL : 0);
  }

  // ---- the narration ----------------------------------------------------------------------------------------
  // The pieces the view says (client/src/campaign/narrate.ts), said by the effects' engine
  // (client/src/audio/narration.ts): fetched when the room first has something to say, never with the title, and
  // never holding up the room's words. Asked as if sound always plays.
  let voice: typeof import('../audio/narration') | null = null;
  let voicing: Promise<void> | null = null;
  function narrate(): void {
    const pieces = showing && campaign && view && mod ? mod.piecesFor(campaign.data, view, record) : [];
    if (voice) {
      voice.narrationSays(pieces);
      return;
    }
    if (pieces.length === 0) return;
    voicing ??= import('../audio/narration').then(
      m => {
        voice = m;
        narrate();
      },
      (err: unknown) => console.warn(err),
    );
  }

  window.__campaignRoom = {
    view: () => view,
    campaign: () => campaign?.data.id ?? null,
    press: control => {
      const i = actions.findIndex(a => a.id === control);
      if (i < 0) return false;
      (plates[i] as HTMLButtonElement).click();
      return true;
    },
    record: () => record,
    fx: () => fx,
  };

  return {
    id: 'campaign',
    element: screen,
    show(q) {
      screen.classList.toggle('cr-quiet', REDUCED());
      showing = true;
      void load().then(loadLive).then(light);
      void load().then(() => {
        const m = mod as Mod;
        record = readRecord();
        const asked = q.get('campaign');
        const c = m.campaignById(asked ?? record?.campaign ?? '');
        if (!c) {
          shell.go('campaigns');
          return;
        }
        campaign = c;
        if (asked) intro();
        else showRecord();
      }, (err: unknown) => {
        console.error(err);
        say(W.failed, true);
      });
    },
    hide() {
      clearPops();
      showing = false;
      light();
      narrate();
    },
    key(e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return false;
      // The keys of the other screens' tags: Esc is the way back (heard, as a press is), Left and Right move along the
      // plates, and Enter with nothing in hand is the first plate.
      if (e.key === 'Escape') {
        sound.ui('press');
        if (pops.childElementCount > 0) clearPops();
        else if (view === 'intro') shell.back();
        else shell.go('title');
        return true;
      }
      if (pops.childElementCount > 0) return false;
      const shown = plates.filter(p => !p.hidden);
      const at = shown.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const to = shown[Math.max(0, Math.min(shown.length - 1, at + (e.key === 'ArrowRight' ? 1 : -1)))] ?? shown[0];
        to?.focus({ preventScroll: true });
        return true;
      }
      if (e.key === 'Enter' && at < 0 && !(document.activeElement instanceof HTMLButtonElement)) {
        shown[0]?.click();
        return true;
      }
      return false;
    },
  };
}
