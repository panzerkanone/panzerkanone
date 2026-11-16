/**
 * The campaign list (Play Campaign), between the title and the campaign's briefing room. It is built as the scenario
 * list is, from the same pieces of the owner's (the side selector's desk and heading strip, the kit's steel frame, his
 * menu plates) and the same classes: one plate a campaign; the one in hand shows its picture, title, side plates
 * (where the campaign has a file for each side), its months and battles, about how long it takes, and its blurb. A
 * kept campaign is offered on a band above the list. The Briefing tag goes on to the campaign's room with the
 * campaign (and side) chosen; Back and Esc go to the title.
 */
import type { Screen, Shell } from './screen';
import { SCENARIO_PLACES as P } from './screen-places';
import { answerIn, el, pictureOf, place, pressable, tagButton, wordsAt } from './ui';
import { WORDS } from './words';

declare global {
  interface Window {
    /** The campaign list, for checks. */
    __campaigns?: { titles(): string[]; inHand(): string | null; sides(): string[]; side(): string | null; choose(side: string): boolean };
  }
}

/** One campaign as the list shows it: its files by side, in the order the plates show the sides. */
interface Entry {
  title: string;
  dates: string;
  battles: number;
  hours: number;
  picture: string | null;
  /** The campaign file of each side: its id, its side's word ("German"), its blurb. */
  sides: { id: string; word: string; blurb: string }[];
}

const SIDE_PLATE = { w: 200, h: 58, gap: 20, text: 34 } as const;

export function buildCampaignList(shell: Shell): Screen {
  const { art, sound } = shell;
  const W = WORDS.campaign;
  const screen = el('div', 'sh-screen sh-list sh-campaigns');
  screen.setAttribute('role', 'region');
  screen.setAttribute('aria-label', W.heading);
  shell.stage.element.append(screen);
  screen.append(pictureOf(art.side.panel, shell.address, 'sh-desk'), pictureOf(art.side.title, shell.address, 'sh-side-title'));
  const heading = el('h2', 'sh-strip-word', W.heading);
  wordsAt(heading, P.heading);
  screen.append(heading);
  const panel = el('div', 'sh-list-panel');
  place(panel, P.panel);
  panel.append(el('div', 'sh-panel-back'), el('div', 'sh-panel-frame'));
  screen.append(panel);

  const list = el('div', 'sh-list-plates');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', W.listLabel);
  place(list, P.column);
  screen.append(list);
  const picture = el('img', 'sh-list-picture');
  picture.alt = '';
  place(picture, P.picture);
  const words = el('div', 'sh-list-words');
  place(words, P.words);
  const title = el('div', 'sh-list-title');
  const sideRow = el('div', 'sh-list-levels');
  sideRow.setAttribute('role', 'radiogroup');
  sideRow.setAttribute('aria-label', W.sidesLabel);
  sideRow.style.position = 'relative';
  sideRow.style.height = `${SIDE_PLATE.h}px`;
  sideRow.style.flex = 'none';
  const facts = el('div', 'sh-list-facts');
  const hours = el('div', 'sh-list-facts');
  const blurb = el('div', 'sh-list-blurb');
  words.append(title, sideRow, facts, hours, blurb);
  screen.append(picture, words);
  // A kept campaign: a band over the frame's top edge; a press continues it.
  const band = el('button', 'sh-campaign-band');
  band.type = 'button';
  place(band, { x: P.inside.x, y: P.panel.y + 18, w: P.inside.w, h: 70 });
  band.hidden = true;
  screen.append(band);
  const answer = answerIn(screen);

  let entries: Entry[] = [];
  let hand = 0;
  let plates: HTMLButtonElement[] = [];
  let sidePlates: HTMLButtonElement[] = [];
  /** The side chosen for each campaign (by title), once chosen. */
  const chosen = new Map<string, string>();
  let kept: { id: string } | null = null;

  const sideOf = (e: Entry): { id: string; word: string; blurb: string } => e.sides.find(s => s.id === chosen.get(e.title)) ?? (e.sides[0] as Entry['sides'][number]);

  function showSide(): void {
    const e = entries[hand];
    if (!e) return;
    const s = sideOf(e);
    sidePlates.forEach(p => {
      const on = p.dataset['campaign'] === s.id;
      p.classList.toggle('sh-on', on);
      p.setAttribute('aria-checked', String(on));
    });
    blurb.textContent = s.blurb;
  }

  function chooseSide(id: string, heard: boolean): boolean {
    const e = entries[hand];
    if (!e || !e.sides.some(s => s.id === id)) return false;
    if (heard && sideOf(e).id !== id) sound.ui('press');
    chosen.set(e.title, id);
    showSide();
    return true;
  }

  function plateLook(b: HTMLButtonElement, i: number, words: string, size?: number): void {
    const dark = el('span', 'sh-plate-dark');
    dark.style.backgroundImage = `url("${shell.address((art.platesDark[1 + (i % 3)] ?? art.plateLit).file)}")`;
    const lit = el('span', 'sh-plate-lit');
    lit.style.backgroundImage = `url("${shell.address(art.plateLit.file)}")`;
    const text = el('span', 'sh-plate-text', words);
    if (size !== undefined) text.style.fontSize = `${size}px`;
    b.append(dark, lit, text);
    pressable(b);
  }

  function setHand(i: number): void {
    hand = Math.max(0, Math.min(entries.length - 1, i));
    plates.forEach((p, n) => {
      p.classList.toggle('sh-on', n === hand);
      p.setAttribute('aria-selected', String(n === hand));
    });
    const e = entries[hand];
    if (!e) return;
    title.textContent = e.title;
    sideRow.replaceChildren();
    sidePlates = e.sides.length < 2 ? [] : e.sides.map((s, k) => {
      const b = el('button', 'sh-list-plate sh-level-plate');
      b.type = 'button';
      b.dataset['campaign'] = s.id;
      b.setAttribute('role', 'radio');
      b.tabIndex = -1;
      place(b, { x: k * (SIDE_PLATE.w + SIDE_PLATE.gap), y: 0, w: SIDE_PLATE.w, h: SIDE_PLATE.h });
      plateLook(b, k, s.word, SIDE_PLATE.text);
      b.addEventListener('click', () => {
        chooseSide(s.id, true);
        plates[hand]?.focus({ preventScroll: true });
      });
      sideRow.append(b);
      return b;
    });
    sideRow.hidden = sidePlates.length === 0;
    facts.textContent = `${e.dates} · ${e.battles} ${W.battles}`;
    hours.textContent = W.hours(e.hours);
    if (e.picture) picture.src = e.picture;
    picture.classList.toggle('sh-none', !e.picture);
    showSide();
  }

  const onward = (): void => {
    const e = entries[hand];
    if (!e) {
      answer.say(W.loading, { x: P.nextText.x, y: P.nextText.y - 110, align: 'middle' }, true);
      sound.ui('refuse');
      return;
    }
    sound.ui('press');
    shell.go('campaign', { campaign: sideOf(e).id });
  };
  const leave = (): void => {
    sound.ui('press');
    shell.back();
  };
  const tags = [
    tagButton({ root: screen, picture: art.side.tagWide, address: shell.address, words: W.next, text: P.nextText, id: 'next', press: onward }),
    tagButton({ root: screen, picture: art.side.tagNarrow, address: shell.address, words: W.back, text: P.backText, id: 'back', press: leave }),
  ];
  band.addEventListener('click', () => {
    if (!kept) return;
    sound.ui('press');
    shell.go('campaign', { campaign: kept.id });
  });
  pressable(band);

  let loaded: Promise<void> | null = null;
  const load = (): Promise<void> =>
    (loaded ??= Promise.all([import('../campaign/content'), import('../game/scenarios'), import('../campaign/keep')]).then(
      ([content, scenarios, keep]) => {
        const all = content.campaigns();
        const titles = [...new Set(all.map(c => c.data.title))];
        entries = titles.map(t => {
          const files = all.filter(c => c.data.title === t);
          const first = files[0] as (typeof files)[number];
          const turns = first.battles.reduce((s, b) => s + b.turns, 0);
          return {
            title: t,
            dates: first.data.dates,
            battles: first.battles.length,
            hours: Math.max(1, Math.round((turns * 5) / 60)),
            picture: scenarios.scenarioPicture(first.data.picture),
            sides: files.map(c => ({ id: c.data.id, word: c.battles[0]?.data.briefing?.sides[c.battles[0].mine]?.short ?? c.data.side, blurb: c.data.blurb })),
          };
        });
        list.replaceChildren();
        plates = entries.map((entry, i) => {
          const b = el('button', 'sh-list-plate');
          b.type = 'button';
          b.dataset['title'] = entry.title;
          b.setAttribute('role', 'option');
          place(b, { x: P.plate.x - P.column.x, y: P.plate.y - P.column.y + i * P.plateGap, w: P.plate.w, h: P.plate.h });
          plateLook(b, i, entry.title);
          b.addEventListener('pointermove', () => {
            if (document.activeElement !== b) b.focus({ preventScroll: true });
          });
          b.addEventListener('focus', () => setHand(i));
          b.addEventListener('click', () => {
            setHand(i);
            onward();
          });
          list.append(b);
          return b;
        });
        // The kept campaign, offered on the band.
        const { record, dropped } = keep.readKept(keep.localCampaignStore(), id => content.campaignById(id)?.data ?? null);
        const c = record ? content.campaignById(record.campaign) : null;
        kept = record && c ? { id: c.data.id } : null;
        band.hidden = !kept;
        if (record && c) {
          const word = c.battles[0]?.data.briefing?.sides[c.battles[0].mine]?.short ?? c.data.side;
          band.textContent = W.continueBand(c.data.title, word, Math.min(record.fought.length + 1, c.battles.length), c.battles.length);
        }
        if (dropped) answer.say(keep.KEPT_WORDS[dropped], { x: P.inside.x + P.inside.w / 2, y: P.inside.y + P.inside.h + 40, align: 'middle' }, true);
      },
      (err: unknown) => {
        console.error(err);
        answer.say(W.failed, { x: P.inside.x + P.inside.w / 2, y: P.inside.y + 60, align: 'middle' }, true);
      },
    ));

  window.__campaigns = {
    titles: () => entries.map(e => e.title),
    inHand: () => entries[hand]?.title ?? null,
    sides: () => entries[hand]?.sides.map(s => s.id) ?? [],
    side: () => {
      const e = entries[hand];
      return e ? sideOf(e).id : null;
    },
    choose: id => chooseSide(id, false),
  };

  return {
    id: 'campaigns',
    element: screen,
    show(q) {
      void load().then(() => {
        const asked = q.get('campaign');
        const at = Math.max(0, entries.findIndex(e => e.sides.some(s => s.id === asked)));
        const e = entries[at];
        if (e && asked && e.sides.some(s => s.id === asked)) chosen.set(e.title, asked);
        setHand(at);
        plates[hand]?.focus({ preventScroll: true });
      });
    },
    hide() {
      return;
    },
    key(e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return false;
      if (e.key === 'Escape') {
        leave();
        return true;
      }
      const onTags = tags.includes(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (onTags) plates[hand]?.focus({ preventScroll: true });
        else {
          const to = e.key === 'ArrowDown' ? hand + 1 : hand - 1;
          if (to >= plates.length) (tags[0] as HTMLButtonElement).focus({ preventScroll: true });
          else plates[Math.max(0, to)]?.focus({ preventScroll: true });
        }
        return true;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (onTags) {
          (tags[e.key === 'ArrowLeft' ? 0 : 1] as HTMLButtonElement).focus({ preventScroll: true });
          return true;
        }
        const entry = entries[hand];
        if (!entry) return true;
        const i = entry.sides.findIndex(s => s.id === sideOf(entry).id);
        const to = entry.sides[i + (e.key === 'ArrowRight' ? 1 : -1)];
        if (to) chooseSide(to.id, true);
        return true;
      }
      if (e.key === 'Enter' && (document.activeElement === document.body || document.activeElement === null)) {
        onward();
        return true;
      }
      return false;
    },
  };
}
