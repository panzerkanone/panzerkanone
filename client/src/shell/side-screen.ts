/**
 * The side selector: the owner's painted panel (images/ui_sheets/2026-11-13-side/) with his tanks
 * detached from it, so that rays can turn behind them ("counter rotating halo/ray effects behind the
 * tanks to add animation to the screen").
 *
 * Back to front: his empty panel (the German page with its black cross, the Soviet page with its red
 * star); behind each tank and over its emblem a soft halo and two sets of rays turning opposite
 * ways, bright for the chosen side and dim for the other; the tank; the select buttons and the tags.
 * The rays are CSS (two conic gradients turned by the compositor): slow, seamless, cheap. With
 * `t=<seconds>` in the address they stand at that moment, for captures.
 *
 * The pages name the chosen scenario's two sides, at the level chosen in the list (`level=` in the
 * address; the battle's own level when there is none). A click on a page, its tank or its button
 * chooses that side; one is always chosen, the side that moves first to begin with. Start Battle starts
 * the scenario at that level with that side; Back goes back to the list. The German side's mark is the
 * black cross.
 *
 * Multiplayer (client/src/net). Reached from the title's Multiplayer (`online=1`), the wide tag reads
 * Create Game: it makes the game on the game server with the side chosen, and then shows the
 * invitation, the other side's link, as text with a button that copies it; the tag then reads Open
 * Game and leads to this player's game, which waits for the other. The invitation itself opens this
 * screen (`match=`, `side=`, `key=` in the address): the scenario, the invited side chosen and fixed,
 * and Join Game, which leads to that side's game. Either player comes back to the game by the same
 * link: the invitation, or the game page's own address. A game played online is played at
 * its battle's own level: the game server's list (worker/src/scenarios.ts) has those.
 */
import { gameAddress } from './address';
import { invitationAddress, onlineFrom, serverFrom, withSeat } from '../net/address';
import type { OnlineSeat } from '../net/address';
import type { Screen, Shell } from './screen';
import { SIDE_PLACES as P, fittedSize, pagesOf } from './screen-places';
import { answerIn, el, leaveFor, pictureOf, place, pressable, tagButton, wordsAt } from './ui';
import { WORDS } from './words';

const O = WORDS.online;

declare global {
  interface Window {
    /** The side selector, for checks. */
    __side?: {
      /** The scenario shown and its level, the page chosen (0 the German page, 1 the Soviet page) and the side it is (0 moves first). */
      state(): { scenario: string | null; level: string | null; page: 0 | 1; side: 0 | 1; names: readonly string[] };
      /** Where Start Battle leads now. */
      gameAddress(): string;
      /** Multiplayer: 'local' (Play Scenario), 'create' (from the title's Multiplayer) or 'join' (an invitation); the invitation once the game is made. */
      online(): { mode: 'local' | 'create' | 'join'; invitation: string | null; seat: OnlineSeat | null };
    };
  }
}

/** A scenario as this screen needs it, at one of its levels (client/src/game/scenarios.ts has the list). */
interface Shown {
  id: string;
  title: string;
  level: string;
  sides: readonly [string, string];
}

/** A game's address with the level it is played at. */
function withLevel(address: string, level: string | null): string {
  if (level === null) return address;
  const at = address.indexOf('?');
  const q = new URLSearchParams(at < 0 ? '' : address.slice(at + 1));
  q.set('level', level);
  return `${at < 0 ? address : address.slice(0, at)}?${q.toString()}`;
}

export function buildSide(shell: Shell): Screen {
  const { art, model, sound } = shell;
  const A = art.side;
  const W = WORDS.side;
  const screen = el('div', 'sh-screen sh-side');
  screen.setAttribute('role', 'region');
  screen.setAttribute('aria-label', W.heading);
  shell.stage.element.append(screen);

  screen.append(pictureOf(A.panel, shell.address, 'sh-desk'), pictureOf(A.title, shell.address, 'sh-side-title'));
  const heading = el('h2', 'sh-strip-word', W.heading);
  wordsAt(heading, P.heading);
  screen.append(heading);

  // A still for a capture: the rays stand at the address's moment.
  const frozen = Number(shell.params.get('t'));
  const still = shell.params.get('t') !== null && Number.isFinite(frozen) && frozen >= 0;
  if (still) {
    screen.classList.add('sh-still');
    screen.style.setProperty('--at', `${-frozen}s`);
  }

  let shown: Shown | null = null;
  /** Which side (0 moves first) each page shows. */
  let pages: readonly [0 | 1, 0 | 1] = [0, 1];
  let chosenPage: 0 | 1 = 0;

  const parts = P.pages.map((p, i) => {
    const page = i as 0 | 1;
    const hit = el('div', 'sh-side-page');
    place(hit, p.page);
    hit.addEventListener('click', () => choose(page));
    const rays = el('div', 'sh-rays');
    rays.style.left = `${p.rays.x - P.raysReach}px`;
    rays.style.top = `${p.rays.y - P.raysReach}px`;
    rays.style.width = rays.style.height = `${2 * P.raysReach}px`;
    rays.style.setProperty('--halo', `${(P.haloReach / P.raysReach) * 50}%`);
    rays.setAttribute('aria-hidden', 'true');
    rays.append(el('div', 'sh-halo'), el('div', 'sh-ray sh-ray-a'), el('div', 'sh-ray sh-ray-b'));
    const tank = pictureOf(A.tanks[page], shell.address, 'sh-tank');
    tank.addEventListener('click', () => choose(page));
    const name = el('div', 'sh-page-head sh-side-name');
    wordsAt(name, p.heading);
    const select = el('button', 'sh-select');
    select.type = 'button';
    select.dataset['control'] = `select-${page}`;
    const art2 = A.selects[page];
    place(select, { x: art2.plain.at[0], y: art2.plain.at[1], w: art2.plain.width, h: art2.plain.height });
    const plain = pictureOf(art2.plain, shell.address, 'sh-select-plain', { x: 0, y: 0, w: art2.plain.width, h: art2.plain.height });
    const lit = pictureOf(art2.lit, shell.address, 'sh-select-lit', { x: art2.lit.at[0] - art2.plain.at[0], y: art2.lit.at[1] - art2.plain.at[1], w: art2.lit.width, h: art2.lit.height });
    const words = el('span', 'sh-select-text', W.select[page]);
    words.style.left = `${p.button.x - art2.plain.at[0]}px`;
    words.style.top = `${p.button.y - art2.plain.at[1]}px`;
    words.style.fontSize = `${p.button.size}px`;
    select.append(plain, lit, words);
    select.addEventListener('click', () => choose(page));
    pressable(select);
    screen.append(hit, rays, tank, name, select);
    return { page, hit, rays, tank, name, select };
  });

  const answer = answerIn(screen);
  const here = (): URLSearchParams => new URLSearchParams(window.location.search);
  const address = (): string =>
    withLevel(gameAddress(model.get(), window.location.pathname, { scenario: shown?.id ?? here().get('scenario'), second: pages[chosenPage] === 1 }), shown?.level ?? here().get('level'));

  // ---- multiplayer -------------------------------------------------------------------------------
  /** Play Scenario ('local'), a game to make online ('create'), or an invitation to one ('join'). */
  let mode: 'local' | 'create' | 'join' = 'local';
  /** The seat of an invitation; once a game is made here, this player's seat and the invitation to the other. */
  let joining: OnlineSeat | null = null;
  let made: { mine: OnlineSeat; invitation: string } | null = null;
  let making = false;
  // The server's calls and the invitation's card are fetched when a game is made or joined, never with the title
  // (they bring the session's hash with them). The card is in hand before its button can be pressed: a copy must
  // happen inside the press itself.
  let card: typeof import('../net/card') | null = null;
  let gone = false;
  const band = el('div', 'sh-invite');
  place(band, P.invite);
  band.dataset['part'] = 'invitation';
  screen.append(band);
  const sayAt = { x: 1374, y: 470, align: 'middle' } as const;
  /** The game page of an online seat: the game's address with the seat's words. */
  const seatAddress = (seat: OnlineSeat): string => {
    const [path, query] = gameAddress(model.get(), window.location.pathname, { scenario: shown?.id ?? here().get('scenario'), second: seat.side === 1 }).split('?');
    return `${path ?? '/'}?${withSeat(new URLSearchParams(query), seat).toString()}`;
  };
  function showBand(parts: HTMLElement[]): void {
    band.replaceChildren(...parts);
    band.classList.toggle('sh-shown', parts.length > 0);
  }
  function invitationBand(link: string): void {
    const label = el('span', 'sh-invite-label', O.link);
    const text = el('input', 'sh-invite-link');
    text.type = 'text';
    text.readOnly = true;
    text.value = link;
    text.setAttribute('aria-label', O.link);
    text.addEventListener('focus', () => text.select());
    const copy = el('button', 'sh-invite-copy', O.copy);
    copy.type = 'button';
    copy.dataset['control'] = 'copy-link';
    pressable(copy);
    copy.addEventListener('click', () => {
      sound.ui('press');
      if (card) void card.copyText(link, text).then(ok => answer.say(ok ? O.copied : O.notCopied, sayAt, !ok));
    });
    showBand([label, text, copy]);
  }
  function setStartWords(words: string): void {
    const t = tags[0]?.querySelector('.sh-tag-text');
    if (t) t.textContent = words;
  }
  async function create(): Promise<void> {
    if (making || !shown) return;
    making = true;
    setStartWords(O.creating);
    const server = serverFrom(here());
    try {
      const side = pages[chosenPage];
      const [api, theCard] = await Promise.all([import('../net/api'), import('../net/card')]);
      card = theCard;
      const { match, keys } = await api.makeGame(server, shown.id);
      const mine: OnlineSeat = { match, side, key: keys[side], server };
      const other: OnlineSeat = { match, side: side === 0 ? 1 : 0, key: keys[side === 0 ? 1 : 0], server };
      const invitation = invitationAddress(window.location.origin, window.location.pathname, shown.id, other);
      api.keepInvitation(match, invitation);
      made = { mine, invitation };
      invitationBand(invitation);
      setStartWords(O.open);
      answer.say(O.made, sayAt);
    } catch (err) {
      setStartWords(O.create);
      answer.say(err instanceof Error ? err.message : String(err), sayAt, true);
    } finally {
      making = false;
    }
  }

  const start = (): void => {
    sound.ui('press');
    if (mode === 'local') leaveFor(screen, address());
    else if (mode === 'join') {
      if (gone || !joining) answer.say(O.gone, sayAt, true);
      else leaveFor(screen, seatAddress(joining));
    } else if (made) leaveFor(screen, seatAddress(made.mine));
    else void create();
  };
  const tags = [
    tagButton({ root: screen, picture: A.tagWide, address: shell.address, words: W.start, text: P.startText, id: 'start', press: start }),
    tagButton({
      root: screen,
      picture: A.tagNarrow,
      address: shell.address,
      words: W.back,
      text: P.backText,
      id: 'back',
      press() {
        sound.ui('press');
        shell.back();
      },
    }),
  ];

  function choose(page: 0 | 1): void {
    // Online, once the game is made (or on an invitation), the side is settled.
    if ((mode === 'join' || made) && page !== chosenPage) {
      sound.ui('refuse');
      answer.say(O.locked, sayAt, true);
      return;
    }
    if (page !== chosenPage) sound.ui('press');
    chosenPage = page;
    render();
  }

  function render(): void {
    for (const part of parts) {
      const on = part.page === chosenPage;
      part.rays.classList.toggle('sh-bright', on);
      part.select.classList.toggle('sh-chosen', on);
      part.select.setAttribute('aria-pressed', String(on));
      part.tank.classList.toggle('sh-chosen', on);
      const side = pages[part.page];
      const name = shown ? shown.sides[side] : '';
      part.name.textContent = name;
      part.name.style.fontSize = `${fittedSize(name.length, P.pages[part.page].headingWidth, P.pages[part.page].heading.size)}px`;
      part.select.setAttribute('aria-label', name ? `${W.select[part.page]}: ${name}` : W.select[part.page]);
    }
  }

  /** The scenario the address names (the opening one when it names none) at the level it names, from the game's list, fetched when this screen is first shown. */
  let asked: string | null = null;
  function load(id: string | null, level: string | null): void {
    const key = `${id ?? ''}/${level ?? ''}`;
    asked = key;
    void import('../game/scenarios').then(
      m => {
        if (asked !== key) return;
        const entry = m.SCENARIOS.find(s => s.id === id) ?? m.SCENARIOS.find(s => s.id === m.OPENING_SCENARIO) ?? m.SCENARIOS[0];
        const at = entry ? (entry.levels.find(l => l.level === level) ?? entry.levels.find(l => l.level === entry.level)) : undefined;
        shown = entry && at ? { id: entry.id, title: entry.title, level: at.level, sides: at.sides } : null;
        pages = shown ? pagesOf(shown.sides) : [0, 1];
        // The side that moves first, to begin with; on an invitation, the side it is for.
        const wanted = joining ? joining.side : 0;
        chosenPage = pages[0] === wanted ? 0 : 1;
        if (mode === 'join' && joining && shown && !gone) showBand([el('span', 'sh-invite-note', O.invitedTo(shown.title, shown.sides[joining.side].toLowerCase()))]);
        render();
      },
      (err: unknown) => {
        console.error(err);
        answer.say(WORDS.scenarios.failed, { x: 1374, y: 470, align: 'middle' }, true);
      },
    );
  }

  window.__side = {
    state: () => ({ scenario: shown?.id ?? null, level: shown?.level ?? null, page: chosenPage, side: pages[chosenPage], names: shown ? [...shown.sides] : [] }),
    gameAddress: address,
    online: () => ({ mode, invitation: made?.invitation ?? null, seat: mode === 'join' ? joining : made?.mine ?? null }),
  };

  /** The screen's mode from its address; a change of mode or of scenario lets go of a game made before. */
  function modeFrom(q: URLSearchParams): void {
    const seat = onlineFrom(q);
    const next = seat ? 'join' : q.get('online') === '1' ? 'create' : 'local';
    const same = next === mode && (next !== 'join' || (joining !== null && seat !== null && joining.match === seat.match && joining.side === seat.side)) && (!made || shown?.id === q.get('scenario'));
    if (same) return;
    mode = next;
    joining = seat;
    made = null;
    gone = false;
    heading.textContent = mode === 'join' ? O.invited : W.heading;
    setStartWords(mode === 'join' ? O.join : mode === 'create' ? O.create : W.start);
    if (mode === 'join' && seat) {
      showBand([el('span', 'sh-invite-note', shown && shown.id === q.get('scenario') ? O.invitedTo(shown.title, shown.sides[seat.side].toLowerCase()) : O.yourSide)]);
      void import('../net/api').then(api => api.gameInfo(seat.server, seat.match)).then(info => {
        if (joining !== seat) return;
        if (info.kind === 'gone') {
          gone = true;
          showBand([el('span', 'sh-invite-note', O.gone)]);
        } else if (info.kind === 'unreachable') showBand([el('span', 'sh-invite-note', O.unreachable)]);
      });
    } else if (mode === 'create') showBand([el('span', 'sh-invite-note', O.choose)]);
    else showBand([]);
  }

  const focusables = (): HTMLElement[] => [parts[0]?.select, parts[1]?.select, ...tags].filter((x): x is HTMLButtonElement => x !== undefined);

  return {
    id: 'side',
    element: screen,
    show(q) {
      const id = q.get('scenario');
      modeFrom(q);
      // Online, the battle's own level (the server's list); otherwise the level chosen in the list.
      const level = mode === 'local' ? q.get('level') : null;
      if (!shown || shown.id !== id || shown.level !== level || asked !== `${id ?? ''}/${level ?? ''}` || (joining && pages[chosenPage] !== joining.side)) load(id, level);
      render();
      (parts[chosenPage]?.select as HTMLButtonElement).focus({ preventScroll: true });
    },
    hide() {
      return;
    },
    key(e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return false;
      if (e.key === 'Escape') {
        sound.ui('press');
        shell.back();
        return true;
      }
      const all = focusables();
      const at = all.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // Along the pages the arrows choose; along the tags they move.
        if (at <= 1) {
          const page = e.key === 'ArrowLeft' ? 0 : 1;
          choose(page);
          (parts[page]?.select as HTMLButtonElement).focus({ preventScroll: true });
        } else (all[e.key === 'ArrowLeft' ? 2 : 3] as HTMLElement).focus({ preventScroll: true });
        return true;
      }
      if (e.key === 'ArrowDown') {
        (all[2] as HTMLElement).focus({ preventScroll: true });
        return true;
      }
      if (e.key === 'ArrowUp') {
        (parts[chosenPage]?.select as HTMLButtonElement).focus({ preventScroll: true });
        return true;
      }
      if (e.key === 'Enter' && at < 0) {
        start();
        return true;
      }
      return false;
    },
  };
}
