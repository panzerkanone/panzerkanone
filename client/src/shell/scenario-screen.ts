/**
 * The scenario list, between the title and the side selector. The owner has painted nothing for it
 * yet, so it is built plainly from pieces he has: his side selector's desk and heading strip with the
 * title lettering, the kit's steel frame laid over the notebook, his menu plates for the list, and
 * live lettering.
 *
 * The list is the game's own (client/src/game/scenarios.ts, fetched when the screen is first shown):
 * one plate a battle. One battle is always in hand: the first, or the one the address names. Pointing
 * at a plate or moving with Up and Down puts it in hand and shows its picture, its levels, and the
 * chosen level's date, turns, units and blurb; a click on it, Enter, or the Choose Side tag goes on to
 * the side selector with it at that level.
 *
 * The column holds five plates at their full size. Past five (the owner, 2026-11-14: "just make the list
 * scrollable") the plates scroll in it, clipped to it, by the browser's own scrolling (the wheel and the
 * trackpad), with a soft fade at the top and the foot where there is more. The battle in hand is always
 * in view: Up, Down, Home, End, PageUp and PageDown bring it in, eased; it rides in the address
 * (`scenario=`), so a reload or the browser's Back shows the list with it in view. A plate that the list
 * carries under a still pointer is not put in hand: only the pointer's own moving does that.
 *
 * The levels (the owner, 2026-11-14): a battle is played at two or three of Patrol, Skirmish, Battle
 * and Offensive, each its own set of units on the battle's board. They stand under the battle's title
 * as a row of small plates, only those it has, the chosen one lit; a click on one, or Left and Right,
 * chooses it. Each battle keeps its own choice while the screen is up, its Battle level (or its
 * smallest) to begin with. The chosen level rides in the address (`level=`), so the side selector, a
 * reload and the browser's Back keep it. Back and Esc go to the title.
 *
 * A battle kept in the browser (game/keep.ts: a game against the computer left without being ended) is
 * offered once each time the page is loaded, as the list first shows: the side selector's band, in
 * the middle of the list dimmed behind it, asks "Continue your battle: The Keliach Bridges, turn 4?"
 * with Continue (lit, the one Enter presses) and New battle. Continue goes to the battle's own address
 * (with the settings as they are now), where the game brings it back; New battle, Esc, and a click
 * outside the band put the offer away and leave the list as it is. Nothing is dropped here: the kept
 * battle goes when a new battle begins (keep.ts).
 */
import { backToGame } from './address';
import type { Screen, Shell } from './screen';
import { SCENARIO_PLACES as P, listHeight, listMost, listNameSize, listPlate, listShowing } from './screen-places';
import { answerIn, el, pictureOf, place, pressable, tagButton, wordsAt } from './ui';
import { WORDS } from './words';

/** What the offer says of the kept battle, and where Continue goes (game/keep.ts `KeptSummary`). */
interface KeptSummary {
  readonly title: string;
  readonly turn: number;
  readonly address: string;
}

/** The offer's veil and band, over the list: the band is the side selector's (`sh-invite`), its buttons that band's red one, the second darker. */
const OFFER_CSS = `
.sh-offer-veil { position: absolute; inset: 0; z-index: 6; background: rgba(6, 5, 4, 0.6); opacity: 0; visibility: hidden; transition: opacity 0.3s ease, visibility 0s linear 0.3s; }
.sh-offer-veil.sh-shown { opacity: 1; visibility: visible; transition: opacity 0.3s ease, visibility 0s; }
.sh-offer-veil .sh-invite { left: 0; right: 0; margin: 0 auto; width: max-content; max-width: ${P.panel.w}px; top: ${P.inside.y + P.inside.h / 2}px; height: 112px; transform: translateY(-50%); }
.sh-offer-veil .sh-invite-note { flex: 0 1 auto; padding-right: 8px; }
.sh-offer-veil .sh-invite-copy.sh-offer-new { background: rgb(64, 60, 56); color: rgb(236, 216, 176); }
@media (prefers-reduced-motion: reduce) { .sh-offer-veil, .sh-offer-veil.sh-shown { transition-duration: 0.01s; } }
`;

declare global {
  interface Window {
    /** The scenario list, for checks. */
    __scenarios?: {
      ids(): string[];
      inHand(): string | null;
      /** The levels of the battle in hand, smallest first, and the one chosen. */
      levels(): string[];
      level(): string | null;
      /** Chooses a level of the battle in hand, as a click on its plate does; false when it has no such level. */
      choose(level: string): boolean;
      /** The column's scroll, and the most it scrolls, in stage pixels (0 and 0 for five battles or fewer). */
      scroll(): { at: number; most: number };
      /** The kept battle on offer while the offer to continue it is up; null when it is not up. */
      offer(): { title: string; turn: number; address: string } | null;
    };
  }
}

/** One level of a battle as the list shows it (the game's `LevelEntry`, with its name). */
interface LevelShown {
  level: string;
  name: string;
  blurb: string;
  date: string;
  turns: number;
  short: readonly [string, string];
  units: readonly [number, number];
}

/** A battle as the list shows it (the game's `ScenarioEntry`). */
interface Entry {
  id: string;
  title: string;
  picture: string | null;
  levels: LevelShown[];
  /** Its level when nothing else is chosen. */
  level: string;
}

/** The row of level plates under the title: each plate's size and the space between two, in stage pixels. */
const LEVEL_PLATE = { w: 200, h: 58, gap: 20, text: 34 } as const;

export function buildScenarios(shell: Shell): Screen {
  const { art, sound } = shell;
  const W = WORDS.scenarios;
  const screen = el('div', 'sh-screen sh-list');
  screen.setAttribute('role', 'region');
  screen.setAttribute('aria-label', W.heading);
  shell.stage.element.append(screen);

  screen.append(pictureOf(art.side.panel, shell.address, 'sh-desk'), pictureOf(art.side.title, shell.address, 'sh-side-title'));
  const heading = el('h2', 'sh-strip-word', W.heading);
  wordsAt(heading, P.heading);
  screen.append(heading);

  // The kit's steel frame over the notebook, cut in nine so that its corners keep their size.
  const panel = el('div', 'sh-list-panel');
  place(panel, P.panel);
  panel.append(el('div', 'sh-panel-back'), el('div', 'sh-panel-frame'));
  screen.append(panel);

  // The column of battle plates: it scrolls (the browser's own scrolling) when there are more than five.
  const list = el('div', 'sh-list-plates');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', W.listLabel);
  place(list, P.column);
  // As tall as the plates need, with room under the last: the column's scrollable height.
  const room = el('div', 'sh-list-room');
  screen.append(list);

  const picture = el('img', 'sh-list-picture');
  picture.alt = '';
  place(picture, P.picture);
  const words = el('div', 'sh-list-words');
  place(words, P.words);
  const title = el('div', 'sh-list-title');
  // The levels' plates: a row as tall as one plate, under the title.
  const levelRow = el('div', 'sh-list-levels');
  levelRow.setAttribute('role', 'radiogroup');
  levelRow.setAttribute('aria-label', W.levelsLabel);
  levelRow.style.position = 'relative';
  levelRow.style.height = `${LEVEL_PLATE.h}px`;
  levelRow.style.flex = 'none';
  const facts = el('div', 'sh-list-facts');
  const count = el('div', 'sh-list-facts');
  const blurb = el('div', 'sh-list-blurb');
  words.append(title, levelRow, facts, count, blurb);
  screen.append(picture, words);

  let entries: Entry[] = [];
  let hand = 0;
  let plates: HTMLButtonElement[] = [];
  let levelPlates: HTMLButtonElement[] = [];
  /** The level chosen for each battle, by its id, once one has been chosen. */
  const chosen = new Map<string, string>();
  const answer = answerIn(screen);

  // ---- the offer to continue a kept battle ----
  if (!document.head.querySelector('style[data-sh-offer]')) {
    const style = document.createElement('style');
    style.dataset['shOffer'] = '1';
    style.textContent = OFFER_CSS;
    document.head.append(style);
  }
  const veil = el('div', 'sh-offer-veil');
  veil.dataset['part'] = 'offer';
  const band = el('div', 'sh-invite sh-shown');
  band.setAttribute('role', 'dialog');
  const offerLine = el('span', 'sh-invite-note');
  offerLine.id = 'sh-offer-line';
  band.setAttribute('aria-labelledby', offerLine.id);
  const goOn = el('button', 'sh-invite-copy', W.continue);
  goOn.type = 'button';
  goOn.dataset['control'] = 'continue';
  const anew = el('button', 'sh-invite-copy sh-offer-new', W.newBattle);
  anew.type = 'button';
  anew.dataset['control'] = 'new-battle';
  for (const b of [goOn, anew]) pressable(b);
  band.append(offerLine, goOn, anew);
  veil.append(band);
  screen.append(veil);
  /** The kept battle on offer while the offer is up. */
  let offer: KeptSummary | null = null;
  /** The offer has been made on this page (it is made once each time the page loads). */
  let offered = false;
  function openOffer(k: KeptSummary): void {
    offer = k;
    offerLine.textContent = W.continueAsk(k.title, k.turn);
    veil.classList.add('sh-shown');
    goOn.focus({ preventScroll: true });
  }
  function closeOffer(): void {
    offer = null;
    veil.classList.remove('sh-shown');
    plates[hand]?.focus({ preventScroll: true });
  }
  goOn.addEventListener('click', () => {
    const k = offer;
    if (!k) return;
    sound.ui('press');
    // The battle's own address, with the settings as they are now (the computer's level stays the battle's: keep.ts).
    window.location.assign(backToGame(shell.model.get(), new URL(k.address, window.location.origin).href, window.location.origin, window.location.pathname));
  });
  anew.addEventListener('click', () => {
    if (!offer) return;
    sound.ui('press');
    closeOffer();
  });
  // A click on the veil, outside the band, puts the offer away as New battle does.
  veil.addEventListener('click', e => {
    if (e.target === veil && offer) closeOffer();
  });

  /** Where the keys last sent the column, while it eases there (the wheel, a drag or its arrival forgets it). */
  let aim: number | null = null;
  /** The pointer's last place over the column, in the page's pixels: a plate carried under a still pointer is told from one pointed at. */
  let pointer = { x: Number.NaN, y: Number.NaN };

  /** The fades at the top and the foot, where there is more above or below. */
  function fades(): void {
    const most = listMost(entries.length);
    list.classList.toggle('sh-more-above', most > 0 && list.scrollTop > 1);
    list.classList.toggle('sh-more-below', most > 0 && list.scrollTop < most - 1);
  }
  /** Brings battle `i` fully into view: eased, or at once (a reload, Back). */
  function bring(i: number, eased: boolean): void {
    const n = entries.length;
    if (listMost(n) === 0) return;
    const from = aim ?? list.scrollTop;
    const to = listShowing(i, from, n);
    if (Math.abs(to - from) < 0.5) return;
    if (eased) {
      aim = to;
      // The column's own scroll-behavior eases it (and does not, for a viewer who asks for less motion).
      list.scrollTo({ top: to });
    } else {
      aim = null;
      list.scrollTo({ top: to, behavior: 'instant' });
      fades();
    }
  }
  // (After a plate's own listener: it compares with where the pointer was before this move.)
  screen.addEventListener('pointermove', e => (pointer = { x: e.clientX, y: e.clientY }), { passive: true });
  // The battle the pointer leaves in hand goes into the address when it leaves the list (the keys write theirs at once),
  // so that a reload keeps it, and a sweep of the pointer down the list does not rewrite the address at every plate.
  // (Only while the list is the screen shown: never into the address of the screen it went on to.)
  list.addEventListener('pointerleave', () => {
    if (shell.current() === 'scenarios') keepLevel();
  });
  list.addEventListener('scroll', fades, { passive: true });
  list.addEventListener('scrollend', () => (aim = null));
  for (const taken of ['wheel', 'pointerdown', 'touchstart'] as const) list.addEventListener(taken, () => (aim = null), { passive: true });

  const levelOf = (e: Entry): LevelShown => e.levels.find(l => l.level === chosen.get(e.id)) ?? e.levels.find(l => l.level === e.level) ?? (e.levels[0] as LevelShown);

  /** The address of the page now, with the battle in hand and its level in it (a reload, the browser's Back from the side selector, and the side selector itself keep them). */
  function keepLevel(): void {
    const e = entries[hand];
    const u = new URL(window.location.href);
    if (e) {
      u.searchParams.set('scenario', e.id);
      u.searchParams.set('level', levelOf(e).level);
    } else u.searchParams.delete('level');
    if (u.href !== window.location.href) window.history.replaceState(window.history.state, '', u);
  }

  const onward = (): void => {
    const entry = entries[hand];
    if (!entry) {
      answer.say(W.loading, { x: P.nextText.x, y: P.nextText.y - 110, align: 'middle' }, true);
      sound.ui('refuse');
      return;
    }
    sound.ui('press');
    keepLevel();
    shell.go('side', { scenario: entry.id });
  };
  const leave = (): void => {
    sound.ui('press');
    // The level belongs to the list and the side selector: the title's address has none.
    const u = new URL(window.location.href);
    u.searchParams.delete('level');
    window.history.replaceState(window.history.state, '', u);
    shell.back();
  };
  const tags = [
    tagButton({ root: screen, picture: art.side.tagWide, address: shell.address, words: W.next, text: P.nextText, id: 'next', press: onward }),
    tagButton({ root: screen, picture: art.side.tagNarrow, address: shell.address, words: W.back, text: P.backText, id: 'back', press: leave }),
  ];

  /** The chosen level's words, and its plate lit. */
  function showLevel(): void {
    const e = entries[hand];
    if (!e) return;
    const l = levelOf(e);
    levelPlates.forEach(p => {
      const on = p.dataset['level'] === l.level;
      p.classList.toggle('sh-on', on);
      p.setAttribute('aria-checked', String(on));
    });
    facts.textContent = `${l.date} · ${l.turns} ${W.turns}`;
    count.textContent = `${l.units[0]} ${l.short[0]} ${W.and} ${l.units[1]} ${l.short[1]} ${W.units}`;
    blurb.textContent = l.blurb;
  }

  function chooseLevel(level: string, heard: boolean): boolean {
    const e = entries[hand];
    if (!e || !e.levels.some(l => l.level === level)) return false;
    if (heard && levelOf(e).level !== level) sound.ui('press');
    chosen.set(e.id, level);
    showLevel();
    keepLevel();
    return true;
  }

  /** The row of plates for the levels of the battle in hand. */
  function buildLevels(e: Entry): void {
    levelRow.replaceChildren();
    levelPlates = e.levels.map((l, i) => {
      const b = el('button', 'sh-list-plate sh-level-plate');
      b.type = 'button';
      b.dataset['level'] = l.level;
      b.setAttribute('role', 'radio');
      b.tabIndex = -1;
      place(b, { x: i * (LEVEL_PLATE.w + LEVEL_PLATE.gap), y: 0, w: LEVEL_PLATE.w, h: LEVEL_PLATE.h });
      const dark = el('span', 'sh-plate-dark');
      dark.style.backgroundImage = `url("${shell.address((art.platesDark[1 + (i % 3)] ?? art.plateLit).file)}")`;
      const lit = el('span', 'sh-plate-lit');
      lit.style.backgroundImage = `url("${shell.address(art.plateLit.file)}")`;
      const text = el('span', 'sh-plate-text', l.name);
      text.style.fontSize = `${LEVEL_PLATE.text}px`;
      b.append(dark, lit, text);
      b.addEventListener('click', () => {
        chooseLevel(l.level, true);
        // The keyboard stays with the battle in hand: Left and Right go on choosing.
        plates[hand]?.focus({ preventScroll: true });
      });
      pressable(b);
      levelRow.append(b);
      return b;
    });
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
    buildLevels(e);
    showLevel();
    if (e.picture) picture.src = e.picture;
    picture.classList.toggle('sh-none', !e.picture);
  }

  function build(): void {
    const n = entries.length;
    list.replaceChildren(room);
    place(room, { x: 0, y: 0, w: 1, h: listHeight(n) });
    list.classList.toggle('sh-scrolls', listMost(n) > 0);
    plates = entries.map((entry, i) => {
      const b = el('button', 'sh-list-plate');
      b.type = 'button';
      b.dataset['scenario'] = entry.id;
      b.setAttribute('role', 'option');
      place(b, listPlate(i));
      const dark = el('span', 'sh-plate-dark');
      dark.style.backgroundImage = `url("${shell.address((art.platesDark[1 + (i % 3)] ?? art.plateLit).file)}")`;
      const lit = el('span', 'sh-plate-lit');
      lit.style.backgroundImage = `url("${shell.address(art.plateLit.file)}")`;
      const text = el('span', 'sh-plate-text', entry.title);
      // A long name ("The Velost Counterstroke") is set smaller, so that it lies inside its plate.
      text.style.fontSize = `${listNameSize(entry.title.length)}px`;
      b.append(dark, lit, text);
      // Pointing puts a plate in hand: the pointer's own moving, not the list's scrolling under it.
      b.addEventListener('pointermove', e => {
        if ((e.clientX !== pointer.x || e.clientY !== pointer.y) && document.activeElement !== b) b.focus({ preventScroll: true });
      });
      b.addEventListener('focus', () => setHand(i));
      b.addEventListener('click', () => {
        setHand(i);
        onward();
      });
      pressable(b);
      list.append(b);
      return b;
    });
  }

  let loaded: Promise<void> | null = null;
  const load = (): Promise<void> =>
    (loaded ??= import('../game/scenarios').then(
      m => {
        entries = m.SCENARIOS.map(s => ({
          id: s.id,
          title: s.title,
          picture: m.scenarioPicture(s.picture),
          level: s.level,
          levels: s.levels.map(l => ({ level: l.level, name: m.LEVEL_NAMES[l.level], blurb: l.blurb, date: l.date, turns: l.turns, short: l.short, units: l.units })),
        }));
        build();
      },
      (err: unknown) => {
        console.error(err);
        answer.say(W.failed, { x: P.inside.x + P.inside.w / 2, y: P.inside.y + 60, align: 'middle' }, true);
      },
    ));

  window.__scenarios = {
    ids: () => entries.map(e => e.id),
    inHand: () => entries[hand]?.id ?? null,
    levels: () => entries[hand]?.levels.map(l => l.level) ?? [],
    level: () => {
      const e = entries[hand];
      return e ? levelOf(e).level : null;
    },
    choose: level => chooseLevel(level, false),
    scroll: () => ({ at: list.scrollTop, most: listMost(entries.length) }),
    offer: () => (offer ? { title: offer.title, turn: offer.turn, address: offer.address } : null),
  };

  return {
    id: 'scenarios',
    element: screen,
    show(q) {
      void load().then(() => {
        const asked = entries.findIndex(e => e.id === q.get('scenario'));
        const level = q.get('level');
        const at = asked >= 0 ? asked : 0;
        const e = entries[at];
        if (e && level !== null && e.levels.some(l => l.level === level)) chosen.set(e.id, level);
        setHand(at);
        plates[hand]?.focus({ preventScroll: true });
        bring(hand, false);
        fades();
        // A battle kept in the browser is offered once, as the list first shows on this page (what keeps it is fetched
        // then, as the list of scenarios is: never with the title).
        if (!offered) {
          offered = true;
          void import('../game/keep').then(
            k => {
              const kept = k.latestKept(k.browserStore());
              if (kept !== null && shell.current() === 'scenarios') openOffer(kept);
            },
            (err: unknown) => console.error(err),
          );
        }
      });
    },
    hide() {
      if (offer) closeOffer();
    },
    key(e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return false;
      // The offer is up: its two buttons are the keys' (Enter presses the one with the keyboard), Esc puts it away.
      if (offer) {
        if (e.key === 'Escape') {
          sound.ui('press');
          closeOffer();
          return true;
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Tab') {
          const to = e.key === 'ArrowLeft' ? goOn : e.key === 'ArrowRight' ? anew : document.activeElement === goOn ? anew : goOn;
          to.focus({ preventScroll: true });
          return true;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          // The button with the keyboard takes the key itself (the browser's own press); with neither, Continue.
          if (document.activeElement === goOn || document.activeElement === anew) return false;
          goOn.click();
          return true;
        }
        return true;
      }
      if (e.key === 'Escape') {
        leave();
        return true;
      }
      const onTags = tags.includes(document.activeElement as HTMLButtonElement);
      const n = plates.length;
      /** Puts battle `i` in hand from the keys, and brings it into view. */
      const take = (i: number): void => {
        const to = Math.max(0, Math.min(n - 1, i));
        plates[to]?.focus({ preventScroll: true });
        bring(to, true);
        keepLevel();
      };
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (n === 0) return true;
        if (onTags) {
          take(hand);
          return true;
        }
        const to = e.key === 'ArrowDown' ? hand + 1 : hand - 1;
        // Down from the last plate goes to the tags; Up from the first stays.
        if (to >= n) (tags[0] as HTMLButtonElement).focus({ preventScroll: true });
        else take(to);
        return true;
      }
      if (e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown') {
        if (n > 0) take(e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : hand + (e.key === 'PageDown' ? P.page : -P.page));
        return true;
      }
      if (onTags && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        (tags[e.key === 'ArrowLeft' ? 0 : 1] as HTMLButtonElement).focus({ preventScroll: true });
        return true;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // Along the battles' plates, Left and Right choose the level of the one in hand.
        const entry = entries[hand];
        if (!entry) return true;
        const i = entry.levels.findIndex(l => l.level === levelOf(entry).level);
        const to = entry.levels[i + (e.key === 'ArrowRight' ? 1 : -1)];
        if (to) chooseLevel(to.level, true);
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
