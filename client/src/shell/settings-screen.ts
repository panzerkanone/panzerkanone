/**
 * The settings screen: the owner's painted settings (images/ui_sheets/2026-11-13-settings/) over the
 * settings' model (settings.ts), which it does not change.
 *
 * His desk, frame and notebook are pictures; every word on them is live, and every control moves:
 *
 *   - two sliders, music above and sound below, 0 to 10. A knob follows the pointer while it is
 *     held and settles on the nearest step when let go; the change is heard while dragging (the
 *     music's volume, and a click of the effects at each step). Left and Right step by one.
 *   - the opponent's three levels and the three levels of detail: one click chooses; the chosen one
 *     is lit and framed in red. Under the levels, a sentence says what the chosen level does, or
 *     the level the pointer is on.
 *   - Apply keeps what is set and stays; Cancel puts the controls back to what was kept and stays;
 *     Back leaves, dropping what was not applied (and says so once: "Changes not applied.").
 *
 * The volumes act at once (they must be heard to be set), so Cancel and Back put them back; the
 * opponent and the detail are given to the model only by Apply. Opened from a game
 * (`screen=settings&from=game`), Back returns to the game's address with the settings as they are.
 *
 * The right-hand page is a folder with two tabs, both words written here in one face: "Files" (the opponent and
 * the detail) and "Advanced": a list of options made to hold many (option-list.ts), today Show hulks and Show
 * craters, each a row with a checkbox, turned over by a click, Space or Enter and kept by Apply. On that page the six
 * buttons he painted are taken off the paper (clean paper of the same page copied over each, eased at its edges). A
 * click on a tab, or Left and Right on the tabs, turns the page; the change of page eases.
 */
import { aboutPanel } from './about';
import { backToGame } from './address';
import { DETAILS, DETAIL_UNSET, DIFFICULTIES, DIFFICULTY_UNSET, MARKS_UNSET, VOLUME_STEPS } from './settings';
import type { Detail, Difficulty, Settings } from './settings';
import type { Box } from './layout';
import type { Screen, Shell } from './screen';
import { ADVANCED_PLACES as AP, RAIL, SETTINGS_PLACES as P, buttonPicture, frameRound, frameWordX, railOver, sliderValue, sliderX } from './screen-places';
import type { SliderPlace } from './screen-places';
import { optionList } from './option-list';
import type { OptionList } from './option-list';
import { answerIn, el, leaveFor, pictureOf, place, pressable, tagButton, wordsAt } from './ui';
import { versionShown, WORDS } from './words';
import { VERSION } from '../version';

declare global {
  interface Window {
    /** The settings screen, for checks. */
    __settings?: {
      /** What the controls show now, and what was last kept. */
      shown(): { music: number; sound: number; difficulty: Difficulty; detail: Detail; hulks: boolean; craters: boolean };
      kept(): { music: number; sound: number; difficulty: Difficulty | null; detail: Detail | null; hulks: boolean | null; craters: boolean | null };
      /** Which page of the right-hand folder is shown: the opponent's and the detail's ("Files"), or Advanced. */
      page(): 'files' | 'advanced';
      /** Where a slider's value lies in the window (CSS pixels), to drag it there. */
      sliderAt(id: 'music' | 'sound', value: number): [number, number];
      /** The Advanced page's list of options: a row added (the picture script's made-up ones), how far it is scrolled. */
      list: Pick<OptionList, 'add' | 'scroll'>;
      /** The About panel is open. */
      about(): boolean;
    };
  }
}

type Channel = 'music' | 'sound';
type Page = 'files' | 'advanced';
const W = WORDS.settings;

/** The volume a slider shows: its channel's, or 0 while the channel is switched off. */
const shownVolume = (s: Settings, id: Channel): number => (s[id].on ? s[id].volume : 0);

export function buildSettingsScreen(shell: Shell): Screen {
  const { model, sound, art, stage } = shell;
  const A = art.settings;
  const screen = el('div', 'sh-screen sh-set');
  screen.setAttribute('role', 'region');
  screen.setAttribute('aria-label', W.heading);
  shell.stage.element.append(screen);

  screen.append(pictureOf(A.desk, shell.address, 'sh-desk'));
  const heading = el('h2', 'sh-strip-word', W.heading);
  wordsAt(heading, P.heading);
  screen.append(heading, pictureOf(A.book, shell.address, 'sh-book'));
  // The Advanced page's paper: the book's own, with the buttons painted on the page taken off (drawn when the book's
  // picture has arrived; until then, and if it never does, the page shows as painted).
  const blank = blankPage(A.book, shell.address);
  screen.append(blank);

  const pageHead = (text: string, at: typeof P.volumes): HTMLElement => {
    const h = el('div', 'sh-page-head', text);
    wordsAt(h, at);
    screen.append(h);
    return h;
  };
  pageHead(W.volumes, P.volumes);
  /** The right-hand page's two leaves: what each shows. */
  const leaves: Record<Page, HTMLElement[]> = { files: [], advanced: [blank] };
  leaves.files.push(pageHead(W.difficulty, P.difficulty.heading), pageHead(W.detail, P.detail.heading));
  leaves.advanced.push(pageHead(W.advanced, AP.heading));

  // ---- what was kept, and what the controls show ------------------------------------------------

  let kept = { music: 0, sound: 0, difficulty: null as Difficulty | null, detail: null as Detail | null, hulks: null as boolean | null, craters: null as boolean | null };
  let difficulty: Difficulty = DIFFICULTY_UNSET;
  let detail: Detail = DETAIL_UNSET;
  let hulks: boolean = MARKS_UNSET;
  let craters: boolean = MARKS_UNSET;
  let page: Page = 'files';
  /** The player has touched a slider since the screen was shown (its channel's value is then not read again as kept). */
  const touched = { music: false, sound: false };
  const keep = (): void => {
    const s = model.get();
    kept = { music: shownVolume(s, 'music'), sound: shownVolume(s, 'sound'), difficulty: s.difficulty, detail: s.detail, hulks: s.hulks, craters: s.craters };
  };
  const changed = (): boolean => {
    const s = model.get();
    return shownVolume(s, 'music') !== kept.music || shownVolume(s, 'sound') !== kept.sound || difficulty !== (kept.difficulty ?? DIFFICULTY_UNSET) || detail !== (kept.detail ?? DETAIL_UNSET)
      || hulks !== (kept.hulks ?? MARKS_UNSET) || craters !== (kept.craters ?? MARKS_UNSET);
  };
  const setVolume = (id: Channel, v: number): void => {
    const steps = Math.max(0, Math.min(VOLUME_STEPS, Math.round(v)));
    if (id === 'music') {
      model.setMusicOn(steps > 0);
      if (steps > 0) model.setMusicVolume(steps);
    } else {
      model.setSoundOn(steps > 0);
      if (steps > 0) model.setSoundVolume(steps);
    }
  };

  // ---- the sliders ------------------------------------------------------------------------------

  const answer = answerIn(screen);
  const answerAt = { x: P.answer.right, y: P.answer.y, align: 'right' as const };

  const slider = (id: Channel, name: string, at: SliderPlace): { show(s: Settings): void; focus(): void; step(by: number): void } => {
    const label = el('div', 'sh-slider-label', name);
    label.style.left = `${at.label.right}px`;
    label.style.top = `${at.label.y}px`;
    label.style.fontSize = `${at.label.size}px`;
    // His spare rail over the painted one: the slot is clean steel its whole length.
    const over = railOver(at.rail, { w: A.rail.width, h: A.rail.height });
    const rail = el('div', 'sh-rail');
    place(rail, over.box);
    rail.style.borderWidth = `0 ${over.cap}px`;
    rail.style.borderImage = `url("${shell.address(A.rail.file)}") 0 ${RAIL.cap} fill / 0 ${over.cap}px stretch`;
    rail.setAttribute('aria-hidden', 'true');
    screen.append(rail);
    const knob = pictureOf(A.knob, shell.address, 'sh-knob');
    knob.style.top = `${at.knobTop}px`;
    const hold = el('div', 'sh-slider');
    place(hold, at.hold);
    hold.tabIndex = 0;
    hold.dataset['control'] = `${id}-volume`;
    hold.setAttribute('role', 'slider');
    hold.setAttribute('aria-label', `${name} ${W.volume}`);
    hold.setAttribute('aria-valuemin', '0');
    hold.setAttribute('aria-valuemax', String(VOLUME_STEPS));
    screen.append(label, knob, hold);

    let value = 0;
    let held = false;
    const at01 = (v: number): void => {
      knob.style.left = `${sliderX(at, v) - A.knob.width / 2}px`;
    };
    const usable = (): boolean => model.get()[id].ready;
    const refuse = (): void => {
      answer.say(W.noSound, { x: sliderX(at, 5), y: at.label.y - 4, align: 'middle' }, true);
      sound.ui('refuse');
    };
    /** Sets the value (the model at whole steps); heard at each new step. */
    const set = (v: number): void => {
      const before = Math.round(value);
      value = v;
      at01(v);
      if (Math.round(v) !== before) {
        touched[id] = true;
        setVolume(id, v);
        if (id === 'sound') sound.ui('press');
      }
    };
    const stageX = (e: PointerEvent): number => {
      const fit = stage.fit();
      return (e.clientX - fit.x) / fit.scale;
    };
    hold.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      hold.focus({ preventScroll: true });
      if (!usable()) {
        refuse();
        return;
      }
      held = true;
      screen.classList.add('sh-holding');
      knob.classList.add('sh-held');
      hold.setPointerCapture(e.pointerId);
      set(sliderValue(at, stageX(e)));
    });
    hold.addEventListener('pointermove', e => {
      if (held) set(sliderValue(at, stageX(e)));
    });
    const release = (): void => {
      if (!held) return;
      held = false;
      screen.classList.remove('sh-holding');
      knob.classList.remove('sh-held');
      // Let go: it settles on the nearest step.
      set(Math.round(value));
    };
    hold.addEventListener('pointerup', release);
    hold.addEventListener('pointercancel', release);
    hold.addEventListener('lostpointercapture', release);

    return {
      show(s) {
        const c = s[id];
        hold.classList.toggle('sh-off', !c.ready);
        hold.setAttribute('aria-disabled', String(!c.ready));
        if (held) return;
        value = shownVolume(s, id);
        at01(value);
        hold.setAttribute('aria-valuenow', String(value));
      },
      focus: () => hold.focus({ preventScroll: true }),
      step(by) {
        if (!usable()) {
          refuse();
          return;
        }
        set(Math.max(0, Math.min(VOLUME_STEPS, Math.round(value) + by)));
        hold.setAttribute('aria-valuenow', String(Math.round(value)));
      },
    };
  };
  const sliders = { music: slider('music', W.music, P.sliders.music), sound: slider('sound', W.sound, P.sliders.sound) };

  // ---- the two rows of buttons ------------------------------------------------------------------

  /** A red frame round the chosen button of a row (with a word in its foot, or none). */
  const frame = (word: string | null, foot: number): { element: HTMLElement; to(b: Box): void } => {
    // The frame is a rounded line; a word in its foot sits in a gap of the line (the stylesheet's mask,
    // `--gap` wide at `--at`), under the frame's middle unless that would run it into the emblems.
    const f = el('div', 'sh-frame');
    f.setAttribute('aria-hidden', 'true');
    const line = el('div', 'sh-frame-line');
    f.append(line);
    const text = word === null ? null : el('div', 'sh-frame-word', word);
    const gap = word === null ? 0 : Math.round(word.length * P.frameWord * 0.56 + 24);
    if (text) {
      text.style.fontSize = `${P.frameWord}px`;
      f.append(text);
      line.classList.add('sh-gapped');
    }
    screen.append(f);
    return {
      element: f,
      to(b) {
        const r = frameRound(b, foot);
        place(f, r);
        if (!text) return;
        const at = frameWordX(r, gap / 2) - r.x;
        text.style.left = `${at}px`;
        // The gap in the foot's line: round the word, and on to the emblems when the word has had to move left of the middle.
        const to = at < r.w / 2 ? Math.max(at + gap / 2, P.emblems.left + P.emblems.clear - r.x) : at + gap / 2;
        line.style.setProperty('--from', `${at - gap / 2}px`);
        line.style.setProperty('--to', `${to}px`);
      },
    };
  };

  const note = el('div', 'sh-pick-note');
  place(note, P.difficulty.note);
  note.setAttribute('aria-live', 'polite');
  screen.append(note);
  leaves.files.push(note);

  interface Row<T extends string> {
    group: HTMLElement;
    buttons: HTMLButtonElement[];
    show(chosen: T): void;
  }
  const row = <T extends string>(id: string, name: string, all: readonly T[], words: Readonly<Record<T, string>>, boxes: readonly Box[], lower: boolean, f: ReturnType<typeof frame>, choose: (v: T) => void, pointing: (v: T | null) => void): Row<T> => {
    const group = el('div', 'sh-picks');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', name);
    const plainPiece = lower ? A.buttonLower : A.button;
    const plainIn = lower ? P.buttonIn.buttonLower : P.buttonIn.button;
    const buttons = all.map((v, i) => {
      const b = boxes[i] as Box;
      const btn = el('button', 'sh-pick');
      btn.type = 'button';
      btn.dataset['control'] = `${id}-${v}`;
      btn.setAttribute('role', 'radio');
      place(btn, b);
      // The pictures lie over the button's place with their own paper round it; they are placed on the button's own box.
      const plain = pictureOf(plainPiece, shell.address, 'sh-pick-plain', shift(buttonPicture(b, { w: plainPiece.width, h: plainPiece.height }, plainIn), b));
      const lit = pictureOf(A.buttonLit, shell.address, 'sh-pick-lit', shift(buttonPicture(b, { w: A.buttonLit.width, h: A.buttonLit.height }, P.buttonIn.buttonLit), b));
      const text = el('span', 'sh-pick-text', words[v]);
      text.style.fontSize = `${P.buttonText}px`;
      btn.append(plain, lit, text);
      btn.addEventListener('click', () => {
        choose(v);
        sound.ui('press');
      });
      btn.addEventListener('pointerenter', () => pointing(v));
      btn.addEventListener('pointerleave', () => pointing(null));
      btn.addEventListener('focus', () => pointing(v));
      btn.addEventListener('blur', () => pointing(null));
      pressable(btn);
      group.append(btn);
      return btn;
    });
    screen.append(group);
    // The frame lies over the paper, under nothing: it is put after the buttons so that it is drawn over their paper edges.
    screen.append(f.element);
    return {
      group,
      buttons,
      show(chosen) {
        buttons.forEach((btn, i) => {
          const on = all[i] === chosen;
          btn.classList.toggle('sh-chosen', on);
          btn.setAttribute('aria-checked', String(on));
          btn.tabIndex = on ? 0 : -1;
        });
        f.to(boxes[all.indexOf(chosen)] as Box);
      },
    };
  };

  let pointedLevel: Difficulty | null = null;
  const showNote = (): void => {
    const level = pointedLevel ?? difficulty;
    note.textContent = W.difficultyNotes[level];
    note.classList.toggle('sh-preview', pointedLevel !== null && pointedLevel !== difficulty);
  };
  const difficultyFrame = frame(null, P.difficulty.foot);
  const difficultyRow = row('difficulty', W.difficulty, DIFFICULTIES, W.difficulties, P.difficulty.buttons, false, difficultyFrame, v => {
    difficulty = v;
    refresh();
  }, v => {
    pointedLevel = v;
    showNote();
  });
  const detailFrame = frame(W.chosen, P.detail.foot);
  const detailRow = row('detail', W.detail, DETAILS, W.details, P.detail.buttons, true, detailFrame, v => {
    detail = v;
    refresh();
  }, () => undefined);
  leaves.files.push(difficultyRow.group, difficultyFrame.element, detailRow.group, detailFrame.element);

  // ---- the Advanced page: the list of options ---------------------------------------------------
  /** Rows the screen does not keep (the picture script's made-up ones): turned over, never applied. */
  const others: Record<string, boolean> = {};
  const options = optionList(screen, [
    { id: 'hulks', name: W.hulks, line: W.hulksLine },
    { id: 'craters', name: W.craters, line: W.cratersLine },
    // Last, and not easy to find on purpose (about.ts).
    { id: 'about', name: W.about, line: W.aboutLine, opens: true },
  ], id => {
    if (id === 'about') {
      sound.ui('press');
      about.open();
      return;
    }
    if (id === 'hulks') hulks = !hulks;
    else if (id === 'craters') craters = !craters;
    else others[id] = !others[id];
    sound.ui('press');
    refresh();
  });
  leaves.advanced.push(options.element);

  // ---- the About panel (about.ts) -----------------------------------------------------------------
  /** Opened alone (the game's menu, or `about=1` in the address): putting it away leaves the settings too. */
  let aboutAlone = false;
  const about = aboutPanel({
    root: screen,
    tag: A.tag,
    address: shell.address,
    version: versionShown(VERSION, shell.params.get('version')),
    pressed: () => sound.ui('press'),
    closed: () => {
      if (aboutAlone) {
        aboutAlone = false;
        screen.classList.remove('sh-about-alone');
        back();
        return;
      }
      options.rows.find(r => r.dataset['option'] === 'about')?.focus({ preventScroll: true });
    },
  });

  // ---- the folder's two tabs --------------------------------------------------------------------
  const tab = (id: Page, name: string, at: { hit: Box; word: { x: number; y: number; size: number } }): HTMLButtonElement => {
    const b = el('button', 'sh-tab-hit');
    b.type = 'button';
    b.dataset['control'] = `page-${id}`;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-label', name);
    place(b, at.hit);
    // The tab's word, and the red rule under the open page's; the tab behind is shaded.
    const w = el('span', 'sh-tab-word', name);
    w.style.left = `${at.word.x - at.hit.x}px`;
    w.style.top = `${at.word.y - at.hit.y}px`;
    w.style.fontSize = `${at.word.size}px`;
    b.append(el('span', 'sh-tab-shade'), w);
    b.addEventListener('click', () => {
      sound.ui('press');
      turnTo(id);
    });
    pressable(b);
    screen.append(b);
    return b;
  };
  const tabs = { files: tab('files', W.filesTab, AP.tabs.files), advanced: tab('advanced', W.advancedTab, AP.tabs.advanced) };
  function turnTo(to: Page): void {
    page = to;
    for (const id of ['files', 'advanced'] as const) {
      const on = id === page;
      for (const e of leaves[id]) e.classList.toggle('sh-leaf-away', !on);
      tabs[id].classList.toggle('sh-tab-open', on);
      tabs[id].setAttribute('aria-selected', String(on));
      tabs[id].tabIndex = on ? 0 : -1;
    }
  }
  for (const e of [...leaves.files, ...leaves.advanced]) e.classList.add('sh-leaf');
  turnTo('files');
  // The two emblems pinned at the page's foot lie over the frame: it runs under them.
  screen.append(pictureOf(A.emblems, shell.address, 'sh-emblems'));

  // ---- the tags ---------------------------------------------------------------------------------

  const tag = (i: number, words: string, id: string, press: () => void): HTMLButtonElement => {
    const at = P.tags[i] as readonly [number, number];
    return tagButton({ root: screen, picture: A.tag, address: shell.address, at, words, text: { x: at[0] + P.tagText.x, y: at[1] + P.tagText.y, size: P.tagText.size }, id, press });
  };
  const fromGame = (): boolean => new URLSearchParams(window.location.search).get('from') === 'game';
  const putVolumesBack = (): void => {
    setVolume('music', kept.music);
    setVolume('sound', kept.sound);
    difficulty = kept.difficulty ?? DIFFICULTY_UNSET;
    detail = kept.detail ?? DETAIL_UNSET;
    hulks = kept.hulks ?? MARKS_UNSET;
    craters = kept.craters ?? MARKS_UNSET;
  };
  const apply = (): void => {
    if (!changed()) {
      answer.say(W.nothingToApply, answerAt, true);
      sound.ui('refuse');
      return;
    }
    if (difficulty !== (kept.difficulty ?? DIFFICULTY_UNSET) || kept.difficulty !== null) model.setDifficulty(difficulty);
    if (detail !== (kept.detail ?? DETAIL_UNSET) || kept.detail !== null) model.setDetail(detail);
    if (hulks !== (kept.hulks ?? MARKS_UNSET) || kept.hulks !== null) model.setHulks(hulks);
    if (craters !== (kept.craters ?? MARKS_UNSET) || kept.craters !== null) model.setCraters(craters);
    keep();
    answer.say(W.applied, answerAt);
    sound.ui('press');
    refresh();
  };
  const cancel = (): void => {
    if (!changed()) {
      answer.say(W.nothingToUndo, answerAt, true);
      sound.ui('refuse');
      return;
    }
    putVolumesBack();
    answer.say(W.undone, answerAt);
    sound.ui('press');
    refresh();
  };
  const back = (): void => {
    const dropped = changed();
    if (dropped) putVolumesBack();
    sound.ui('press');
    if (fromGame()) {
      if (dropped) answer.say(W.notApplied, answerAt);
      leaveFor(screen, backToGame(model.get(), document.referrer || null, window.location.origin, window.location.pathname), dropped ? 0.9 : undefined);
      return;
    }
    shell.back(dropped ? W.notApplied : null);
  };
  const tags = [tag(0, W.apply, 'apply', apply), tag(1, W.cancel, 'cancel', cancel), tag(2, W.back, 'back', back)];

  // ---- showing it -------------------------------------------------------------------------------

  function refresh(): void {
    const s = model.get();
    sliders.music.show(s);
    sliders.sound.show(s);
    difficultyRow.show(difficulty);
    detailRow.show(detail);
    options.show({ ...others, hulks, craters });
    showNote();
  }
  model.onChange(() => {
    // A player that arrives after the screen was shown brings its kept value with it.
    const s = model.get();
    for (const id of ['music', 'sound'] as const) if (!touched[id] && s[id].ready) kept[id] = shownVolume(s, id);
    refresh();
  });

  // ---- the keys ---------------------------------------------------------------------------------

  /** The rows Up and Down move between: the two sliders, the folder's tabs, the open page's rows (of buttons, or of the list), the tags. */
  const rows = (): HTMLElement[][] => [
    [screen.querySelector<HTMLElement>('[data-control="music-volume"]') as HTMLElement],
    [screen.querySelector<HTMLElement>('[data-control="sound-volume"]') as HTMLElement],
    [tabs.files, tabs.advanced],
    ...(page === 'files' ? [difficultyRow.buttons, detailRow.buttons] : options.rows.map(o => [o as HTMLElement])),
    tags,
  ];
  /** The rows in which the arrows choose, as in a row of radio buttons (on the tabs they turn the page): the tabs, and the "Files" page's rows. */
  const choosing = (r: number): boolean => r >= 2 && r < rows().length - 1 && (r === 2 || page === 'files');
  const rowOf = (e: Element | null): number => rows().findIndex(r => r.some(x => x === e));
  const focusRow = (i: number): void => {
    const r = rows()[i];
    if (!r) return;
    const target = r.find(x => x.classList.contains('sh-chosen') || x.classList.contains('sh-tab-open')) ?? r[0];
    target?.focus({ preventScroll: true });
  };

  window.__settings = {
    shown: () => {
      const s = model.get();
      return { music: shownVolume(s, 'music'), sound: shownVolume(s, 'sound'), difficulty, detail, hulks, craters };
    },
    kept: () => ({ ...kept }),
    page: () => page,
    list: { add: r => options.add(r), scroll: () => options.scroll() },
    about: () => about.isOpen(),
    sliderAt(id, value) {
      const fit = stage.fit();
      const at = P.sliders[id];
      return [fit.x + sliderX(at, value) * fit.scale, fit.y + (at.knobTop + A.knob.height / 2 - 6) * fit.scale];
    },
  };

  return {
    id: 'settings',
    element: screen,
    show(q) {
      touched.music = touched.sound = false;
      keep();
      difficulty = kept.difficulty ?? DIFFICULTY_UNSET;
      detail = kept.detail ?? DETAIL_UNSET;
      hulks = kept.hulks ?? MARKS_UNSET;
      craters = kept.craters ?? MARKS_UNSET;
      turnTo('files');
      refresh();
      focusRow(0);
      if (q.get('about') === '1') {
        // Alone: the panel over whatever lies under the screen (the game, from its menu), without the settings round it.
        turnTo('advanced');
        aboutAlone = true;
        screen.classList.add('sh-about-alone');
        about.open();
      }
    },
    hide() {
      pointedLevel = null;
    },
    key(e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return false;
      if (about.isOpen()) return about.key(e);
      if (e.key === 'Escape') {
        back();
        return true;
      }
      const focused = document.activeElement;
      const r = rowOf(focused);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const n = rows().length;
        focusRow(r < 0 ? 0 : (r + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
        return true;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
        const by = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'Home' ? -VOLUME_STEPS : VOLUME_STEPS;
        if (r === 0 || r === 1) {
          sliders[r === 0 ? 'music' : 'sound'].step(by);
          return true;
        }
        const list = rows()[r < 0 ? 2 : r] as HTMLElement[];
        const at = list.indexOf(focused as HTMLElement);
        const to = Math.max(0, Math.min(list.length - 1, (at < 0 ? 0 : at) + Math.sign(by)));
        const target = list[to] as HTMLElement;
        target.focus({ preventScroll: true });
        // In a row of levels the arrows choose, as a row of radio buttons does; along the tags they only move.
        if (choosing(r < 0 ? 2 : r)) target.click();
        return true;
      }
      if ((e.key === 'Enter' || e.key === ' ') && (focused === null || focused === document.body)) {
        focusRow(0);
        return true;
      }
      return false;
    },
  };
}

/**
 * The right-hand page as the owner painted it, without its six buttons: a canvas over the book, of the book's own
 * pixels, with paper made from the page itself laid over each row of buttons (ADVANCED_PLACES.heal). Made by drawing
 * alone (no pixel is read back):
 *
 *   - its light: the paper just above the row and just below it, each a strip smoothed along its length (drawn much
 *     smaller and back again), stretched across the row and blended from one to the other down it, so that it meets
 *     the page above and below; what lies by a strip and is not paper (the white pin, the emblems) is first covered
 *     with the strip's own paper from beside it;
 *   - its grain: the clean paper between the rows over its own light (that paper divided by a smoothed copy of
 *     itself, by the 'color-dodge' of its inverse, at half strength, so that plain paper is a mid grey), laid on by
 *     'hard-light', mirrored down the row;
 *   - its edges eased into the page over `feather` pixels (more at the row's two ends).
 *
 * Drawn once the book's picture has arrived; until then the canvas is not shown.
 */
function blankPage(book: { file: string; at: readonly [number, number] }, address: (file: string) => string): HTMLCanvasElement {
  const H = AP.heal;
  const x0 = Math.min(...H.rows.map(b => b.x));
  const y0 = Math.min(...H.rows.map(b => b.y));
  const x1 = Math.max(...H.rows.map(b => b.x + b.w));
  const y1 = Math.max(...H.rows.map(b => b.y + b.h));
  const canvas = el('canvas', 'sh-blank-page');
  canvas.width = x1 - x0;
  canvas.height = y1 - y0;
  place(canvas, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  canvas.setAttribute('aria-hidden', 'true');
  const image = new Image();
  image.decoding = 'async';
  image.src = address(book.file);
  void image.decode().then(
    () => {
      const g = canvas.getContext('2d');
      if (!g) return;
      g.imageSmoothingQuality = 'high';
      // The book where the canvas lies (stage pixels are the book's own).
      g.drawImage(image, x0 - book.at[0], y0 - book.at[1], canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      const grain = paperGrain(image, book.at, H.grain);
      for (const b of H.rows) {
        const made = paperOver(image, book.at, b, H.keepOut, H.smooth, grain);
        if (!made) continue;
        ease(made, H.feather, H.feather * 3);
        g.drawImage(made, b.x - x0, b.y - y0);
      }
      canvas.classList.add('sh-drawn');
    },
    () => undefined,
  );
  return canvas;
}

function canvasOf(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] | null {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const g = c.getContext('2d');
  if (!g) return null;
  g.imageSmoothingQuality = 'high';
  return [c, g];
}

/** A picture made smooth: drawn smaller by halves to about a `by`-th of its size, and back. */
function smoothed(source: HTMLCanvasElement, by: number): HTMLCanvasElement {
  let at = source;
  let w = source.width;
  let h = source.height;
  while (w > 1 && h > 1 && source.width / w < by) {
    const next = canvasOf(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    if (!next) break;
    next[1].drawImage(at, 0, 0, next[0].width, next[0].height);
    at = next[0];
    w = next[0].width;
    h = next[0].height;
  }
  const back = canvasOf(source.width, source.height);
  if (!back) return source;
  back[1].drawImage(at, 0, 0, back[0].width, back[0].height);
  return back[0];
}

/** The book's pixels in a stage box. */
function cut(image: HTMLImageElement, at: readonly [number, number], b: Box): HTMLCanvasElement | null {
  const c = canvasOf(b.w, b.h);
  if (!c) return null;
  c[1].drawImage(image, b.x - at[0], b.y - at[1], b.w, b.h, 0, 0, b.w, b.h);
  return c[0];
}

/** The clean paper's grain over its own light, at half strength: plain paper a mid grey. */
function paperGrain(image: HTMLImageElement, at: readonly [number, number], b: Box): HTMLCanvasElement | null {
  const raw = cut(image, at, b);
  const c = canvasOf(b.w, b.h);
  if (!raw || !c) return null;
  const inverse = smoothed(raw, 24);
  const ig = inverse.getContext('2d');
  if (!ig) return null;
  ig.globalCompositeOperation = 'difference';
  ig.fillStyle = 'white';
  ig.fillRect(0, 0, b.w, b.h);
  const [out, g] = c;
  g.fillStyle = 'black';
  g.fillRect(0, 0, b.w, b.h);
  g.globalAlpha = 0.5;
  g.drawImage(raw, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'color-dodge';
  g.drawImage(inverse, 0, 0);
  return out;
}

/** Paper for a box: its light from the strips above and below it, its grain laid on. */
function paperOver(image: HTMLImageElement, at: readonly [number, number], b: Box, keepOut: readonly Box[], smooth: number, grain: HTMLCanvasElement | null): HTMLCanvasElement | null {
  const depth = 6;
  const strip = (y: number): HTMLCanvasElement | null => {
    const s = cut(image, at, { x: b.x, y, w: b.w, h: depth });
    if (!s) return null;
    const sg = s.getContext('2d');
    // What lies across the strip and is not paper: covered with the strip's paper from just left of it.
    for (const k of keepOut) {
      if (k.y >= y + depth || k.y + k.h <= y || k.x >= b.x + b.w || k.x + k.w <= b.x) continue;
      sg?.drawImage(image, k.x - k.w - at[0], y - at[1], k.w, depth, k.x - b.x, 0, k.w, depth);
    }
    return smoothed(s, Math.max(2, smooth));
  };
  const above = strip(b.y - depth);
  const below = strip(b.y + b.h);
  const c = canvasOf(b.w, b.h);
  if (!above || !below || !c) return null;
  const [out, g] = c;
  // Each strip stretched down the box, faded the other way from the other, and the two added.
  const layer = (s: HTMLCanvasElement, from: number): HTMLCanvasElement | null => {
    const l = canvasOf(b.w, b.h);
    if (!l) return null;
    l[1].drawImage(s, 0, 0, s.width, s.height, 0, 0, b.w, b.h);
    l[1].globalCompositeOperation = 'destination-in';
    const ramp = l[1].createLinearGradient(0, 0, 0, b.h);
    ramp.addColorStop(0, `rgba(0,0,0,${from})`);
    ramp.addColorStop(1, `rgba(0,0,0,${1 - from})`);
    l[1].fillStyle = ramp;
    l[1].fillRect(0, 0, b.w, b.h);
    return l[0];
  };
  const top = layer(above, 1);
  const foot = layer(below, 0);
  if (!top || !foot) return null;
  g.drawImage(top, 0, 0);
  g.globalCompositeOperation = 'lighter';
  g.drawImage(foot, 0, 0);
  // The grain, mirrored down the box.
  if (grain) {
    g.globalCompositeOperation = 'hard-light';
    for (let y = 0, k = 0; y < b.h; y += grain.height, k++) {
      g.save();
      if (k % 2 === 1) {
        g.translate(0, y + grain.height);
        g.scale(1, -1);
        g.drawImage(grain, 0, 0, grain.width, grain.height, 0, 0, b.w, grain.height);
      } else g.drawImage(grain, 0, 0, grain.width, grain.height, 0, y, b.w, grain.height);
      g.restore();
    }
  }
  g.globalCompositeOperation = 'source-over';
  return out;
}

/** A picture's edges eased to clear: over `side` pixels at its top and foot, `ends` at its two ends. */
function ease(c: HTMLCanvasElement, side: number, ends: number): void {
  const g = c.getContext('2d');
  if (!g) return;
  g.globalCompositeOperation = 'destination-in';
  for (const [gx, gy, n, f] of [[c.width, 0, c.width, ends], [0, c.height, c.height, side]] as const) {
    const ramp = g.createLinearGradient(0, 0, gx, gy);
    ramp.addColorStop(0, 'rgba(0,0,0,0)');
    ramp.addColorStop(Math.min(0.5, f / n), 'rgba(0,0,0,1)');
    ramp.addColorStop(Math.max(0.5, 1 - f / n), 'rgba(0,0,0,1)');
    ramp.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = ramp;
    g.fillRect(0, 0, c.width, c.height);
  }
  g.globalCompositeOperation = 'source-over';
}

/** A box on the stage, given relative to another (a picture inside a button is placed in the button's own pixels). */
function shift(b: Box, to: Box): Box {
  return { x: b.x - to.x, y: b.y - to.y, w: b.w, h: b.h };
}
