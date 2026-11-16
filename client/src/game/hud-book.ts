/**
 * The two things a player keeps open beside the board: the notebook at the
 * right edge (pages Unit, Odds, Log and Keys on its tabs) and the folder at
 * the lower left (the viewer's units in their groups, as they stand; during a
 * set-up by hand, the units still to place).
 *
 * Neither opens or closes here: hud.ts does that, on the player's word alone.
 * These only draw their contents from the model. A page with nothing to show
 * says so; it never goes away.
 */
import { button, el, keycap, line, setEnabled, setStock, setText, stamp } from './hud-dom';
import { icon } from './hud-icons';
import type { KeySection } from './keys';
import type { CardModel, DiceModel, GameModel, LogLine, OddsModel, OddsRow } from './model';
import type { Figure } from './reading';

/** What a unit card shows of a unit type beyond its numbers: a picture and a few words. Handed in by the page; the layer holds no art. */
export interface UnitPicture {
  /** The address of the picture, or null when the type has none. */
  card: string | null;
  /** One line: what the counter stands for. */
  role: string;
  /** Two or three plain sentences. */
  description: string;
  /** True when the picture shows something else than the type, used until it has one of its own; `shows` says what. */
  standIn: boolean;
  shows: string;
}

export type PageId = 'unit' | 'odds' | 'log' | 'keys';
export const PAGES: readonly { id: PageId; label: string }[] = [
  { id: 'unit', label: 'Unit' },
  { id: 'odds', label: 'Odds' },
  { id: 'log', label: 'Log' },
  { id: 'keys', label: 'Keys' },
];

export interface Notebook {
  /** The book itself, and its tabs (they stand at the screen's edge when the book is shut). */
  readonly root: HTMLElement;
  readonly tabs: HTMLElement;
  /** Show a page, or shut the book (null). */
  show(page: PageId | null): void;
  draw(model: GameModel, keys: readonly KeySection[]): void;
  dispose(): void;
}

function figures(into: HTMLElement, figs: readonly Figure[]): void {
  into.textContent = '';
  for (const f of figs) {
    const item = el('span');
    item.append(el('span', '', f.label), el('b', '', f.value));
    into.append(item);
  }
}

function empty(title: string, words: string): HTMLDivElement {
  const box = el('div', 'wg-empty');
  box.append(el('b', '', title), document.createTextNode(words));
  return box;
}

/** A row with a name, a line under it, a chance and its bar. */
function chanceRow(name: string, under: string, percent: string, share: number, tone: 'alert' | 'plain'): HTMLDivElement {
  const row = el('div', 'wg-shot');
  row.dataset['tone'] = tone;
  const words = el('span', '', name);
  if (under !== '') words.append(el('small', '', under));
  const bar = el('span', 'wg-bar');
  const fill = el('i');
  fill.style.width = `${(Math.max(0, Math.min(1, share)) * 100).toFixed(2)}%`;
  bar.append(fill);
  row.append(words, el('b', '', percent), bar);
  return row;
}

export function makeNotebook(deps: {
  art: ((type: string) => UnitPicture | null) | null;
  /** A tab was clicked; the little button in the book's head was. */
  onTab(page: PageId): void;
  onClose(): void;
}): Notebook {
  const root = el('div', 'wg-nb');
  root.dataset['part'] = 'notebook';
  const cover = el('div', 'wg-nbcover wg-leather');
  const head = el('div', 'wg-nbhead');
  const title = el('span', 'wg-ttl');
  const hide = button('', () => deps.onClose());
  hide.title = 'Close the notebook (J)';
  hide.dataset['act'] = 'close-notebook';
  hide.append(icon('min', true));
  head.append(el('span', 'wg-medal'), title, hide);
  cover.append(el('div', 'wg-rings'), head);
  const pages = new Map<PageId, HTMLDivElement>();
  for (const p of PAGES) {
    const page = el('div', 'wg-paper wg-page');
    page.dataset['page'] = p.id;
    pages.set(p.id, page);
    cover.append(page);
  }
  root.append(cover);

  const tabs = el('div', 'wg-nbtabs');
  tabs.dataset['part'] = 'notebook-tabs';
  const tabOf = new Map<PageId, HTMLButtonElement>();
  let badge: HTMLSpanElement | null = null;
  for (const p of PAGES) {
    const tab = button('wg-itab', () => deps.onTab(p.id));
    tab.dataset['open'] = p.id;
    tab.title = `${p.label}: open this page of the notebook, or close it`;
    tab.append(icon(p.id, true), el('b', '', p.label));
    if (p.id === 'odds') {
      badge = el('span', 'wg-badge');
      tab.append(badge);
    }
    tabOf.set(p.id, tab);
    tabs.append(tab);
  }

  const unitPage = pages.get('unit') as HTMLDivElement;
  const oddsPage = pages.get('odds') as HTMLDivElement;
  const logPage = pages.get('log') as HTMLDivElement;
  const keysPage = pages.get('keys') as HTMLDivElement;

  // ---- Unit ----
  let cardKey = '?';
  const drawUnit = (c: CardModel | null): void => {
    const key = c === null ? '' : JSON.stringify(c);
    if (key === cardKey) return;
    cardKey = key;
    unitPage.textContent = '';
    if (c === null) {
      unitPage.append(empty('No unit selected', 'Point at a counter, or click one of yours, to see its page here.'));
      return;
    }
    const art = c.face.art !== undefined && deps.art ? deps.art(c.face.art) : null;
    const pic = el('div', 'wg-pic');
    if (art && art.card !== null) {
      const img = el('img');
      img.alt = art.standIn ? `${c.name} (pictured: ${art.shows})` : c.name;
      img.src = art.card;
      pic.append(img);
      pic.dataset['has'] = '1';
    } else {
      pic.append(icon('picture'), el('span', 'wg-cap', 'no picture'));
    }
    const who = el('div', 'wg-whoo');
    who.append(el('b', '', c.name));
    if (c.stamp) who.append(stamp(c.stamp.word, c.stamp.tone));
    unitPage.append(pic, who, el('div', 'wg-role', art ? art.role : c.side));
    if (c.tiles && c.tiles.length > 0) {
      const tiles = el('div', 'wg-tiles');
      for (const t of c.tiles) {
        const tile = el('div', 'wg-tile');
        tile.append(icon(t.kind === 'close' ? 'close_combat' : t.kind, true), el('b', '', t.value), el('span', '', t.label));
        tiles.append(tile);
      }
      unitPage.append(tiles);
    }
    for (const f of c.lines ?? c.rows) unitPage.append(line(f.label, f.value));
    unitPage.append(el('div', 'wg-about', art ? art.description : ''));
  };

  // ---- Odds, and the last roll ----
  let oddsKey = '?';
  const tableRows = (into: HTMLElement, rows: readonly OddsRow[]): void => {
    for (const r of rows) into.append(chanceRow(r.name, r.effect === '' ? r.ways : `${r.ways}: ${r.effect}`, r.percent, r.share, 'plain'));
  };
  const drawOdds = (o: OddsModel | null, d: DiceModel | null): void => {
    const key = JSON.stringify([o, d]);
    if (key === oddsKey) return;
    oddsKey = key;
    oddsPage.textContent = '';
    if (o === null && d === null) {
      oddsPage.append(empty('Nothing to weigh yet', 'Point at a move or an enemy to see its chances here before you act. The last roll stays here too.'));
      return;
    }
    if (o !== null) {
      const head = el('div', 'wg-h');
      head.append(el('span', '', o.title));
      oddsPage.append(head);
      if (o.figures.length > 0) {
        const figs = el('div', 'wg-figs');
        figures(figs, o.figures);
        oddsPage.append(figs);
      }
      if (o.shots && o.shots.length > 0) {
        oddsPage.append(el('h6', '', o.shots.length === 1 ? 'Enemy fire on the way' : `Enemy fire on the way: ${o.shots.length} shots`));
        for (const s of o.shots) oddsPage.append(chanceRow(s.who, `${s.where} · destroys ${s.kill}`, s.percent, s.share, 'alert'));
      }
      const tables = o.tables ?? (o.rows.length > 0 ? [{ title: '', rows: o.rows }] : []);
      for (const t of tables) {
        if (t.title !== '') oddsPage.append(el('h6', '', t.title));
        tableRows(oddsPage, t.rows);
      }
      if (o.note !== '') {
        const note = el('div', 'wg-oddsnote', o.note);
        note.dataset['pinned'] = o.pinned ? '1' : '0';
        oddsPage.append(note);
      }
      // A weak attack: how it could be made stronger.
      if (o.advice && o.advice.lines.length > 0) {
        const advice = el('div', 'wg-oddsnote', o.advice.lines.join(' '));
        advice.dataset['part'] = 'advice';
        oddsPage.append(advice);
      }
    }
    if (d !== null) {
      const roll = el('div', 'wg-roll');
      roll.dataset['part'] = 'last-roll';
      const head = el('div', 'wg-h');
      head.append(el('span', '', d.title ?? (d.result === null ? 'Attack' : 'Last roll')), el('span', '', d.rolled ? 'last roll' : 'being made'));
      roll.append(head, el('div', '', d.caption));
      if (d.figures.length > 0) {
        const figs = el('div', 'wg-figs');
        figs.style.marginTop = '4px';
        figures(figs, d.figures);
        roll.append(figs);
      }
      const dice = el('div', 'wg-dice');
      if (!d.rolled) {
        dice.append(el('span', 'wg-die wg-blank'), el('span', 'wg-die wg-blank'));
      } else if (d.faces.length === 0) {
        dice.append(el('span', 'wg-sum', 'No roll needed'));
      } else {
        d.faces.forEach((f, i) => dice.append(el('span', i === 0 ? 'wg-die wg-first' : 'wg-die', String(f))));
        dice.append(el('span', 'wg-sum', `= ${d.faces.reduce((a, b) => a + b, 0)}`));
      }
      if (d.result !== null) dice.append(stamp(d.result, d.fate === 'none' ? 'faint' : d.fate === 'destroyed' ? 'alert' : 'plain'));
      roll.append(dice);
      oddsPage.append(roll);
    }
  };

  // ---- Log: keeps to its newest line unless the reader has gone back ----
  let logAt = 0;
  let stick = true;
  const logList = el('div');
  const logNone = empty('Nothing has happened yet', 'Every move, shot and score is listed here in order.');
  logPage.append(logNone, logList);
  const toEnd = (): void => {
    if (stick) logPage.scrollTop = logPage.scrollHeight;
  };
  logPage.addEventListener('scroll', () => {
    stick = logPage.scrollHeight - logPage.scrollTop - logPage.clientHeight < 30;
  }, { passive: true });
  const drawLog = (lines: readonly LogLine[]): void => {
    const last = lines[lines.length - 1];
    logNone.style.display = last ? 'none' : '';
    if (!last || last.n < logAt) {
      logList.textContent = '';
      logAt = 0;
      stick = true;
    }
    if (!last || last.n === logAt) return;
    for (const l of lines) {
      if (l.n <= logAt) continue;
      const row = el('div', 'wg-logl');
      setStock(row, l.stock);
      if (/^Turn \d+/.test(l.text)) row.dataset['turn'] = '1';
      row.append(el('i'), el('span', '', l.text));
      logList.append(row);
    }
    logAt = last.n;
    while (logList.childElementCount > 300) logList.firstElementChild?.remove();
    toEnd();
  };

  // ---- Keys ----
  let keysKey = '?';
  const drawKeys = (sections: readonly KeySection[]): void => {
    const key = JSON.stringify(sections);
    if (key === keysKey) return;
    keysKey = key;
    keysPage.textContent = '';
    const grid = el('div', 'wg-keys');
    for (const s of sections) {
      if (s.lines.length === 0) continue;
      const head = el('h6', '', s.title);
      head.dataset['owner'] = s.owner;
      grid.append(head);
      for (const k of s.lines) grid.append(keycap(k.key), el('span', '', k.does));
    }
    keysPage.append(grid);
  };

  let shown: PageId | null = null;
  return {
    root,
    tabs,
    show(page: PageId | null): void {
      shown = page;
      root.classList.toggle('wg-open', page !== null);
      for (const p of PAGES) {
        (pages.get(p.id) as HTMLElement).classList.toggle('wg-on', p.id === page);
        (tabOf.get(p.id) as HTMLElement).classList.toggle('wg-on', p.id === page);
      }
      if (page !== null) setText(title, PAGES.find(p => p.id === page)?.label ?? '');
      if (page === 'log') {
        stick = true;
        toEnd();
      }
    },
    draw(model: GameModel, keys: readonly KeySection[]): void {
      drawUnit(model.card);
      drawOdds(model.odds, model.dice);
      drawLog(model.log);
      drawKeys(keys);
      if (badge) {
        const shots = model.odds?.shots?.length ?? 0;
        badge.classList.toggle('wg-open', model.odds !== null && shown !== 'odds');
        setText(badge, shots > 0 ? String(shots) : '%');
      }
    },
    dispose(): void {
      root.remove();
      tabs.remove();
    },
  };
}

export interface Folder {
  readonly root: HTMLElement;
  show(open: boolean): void;
  draw(model: GameModel): void;
}

export function makeFolder(deps: {
  onTab(): void;
  /** A group's line (it is gone to, and is then the one open), a unit waiting to be placed, a unit of the open group (it is chosen and gone to). Null: shown, and cannot be clicked. */
  take: ((kind: 'unit' | 'group', id: string) => void) | null;
  pick: ((unit: string) => void) | null;
}): Folder {
  const root = el('div', 'wg-folder');
  root.dataset['part'] = 'folder';
  const tab = button('wg-ftab', () => deps.onTab());
  tab.dataset['act'] = 'folder';
  const tabLabel = el('span', '', 'Groups');
  tab.append(icon('folder', true), tabLabel);
  const body = el('div', 'wg-fbody');
  const sheet = el('div', 'wg-sheet');
  // The sheet begins with the groups: it has no heading line of its own.
  const rows = el('div');
  sheet.append(rows);
  body.append(sheet);
  root.append(tab, body);

  let key = '?';
  return {
    root,
    show(open: boolean): void {
      root.classList.toggle('wg-open', open);
    },
    draw(m: GameModel): void {
      setText(tabLabel, m.words['groups'] ?? 'Groups');
      tab.title = `${m.words['groups'] ?? 'Groups'}: open or close the folder (A)`;
      const now = JSON.stringify([m.groups, m.tray, m.mode, m.words['moved'] ?? '']);
      if (now === key) return;
      key = now;
      rows.textContent = '';
      if (m.tray.length > 0) {
        // A set-up by hand: the units still to place, each a name to pick up.
        const list = el('div', 'wg-units');
        list.dataset['part'] = 'to-place';
        for (const t of m.tray) {
          const item = button(t.selected ? 'wg-u wg-sel' : 'wg-u', () => deps.take?.('unit', t.id));
          item.dataset['unit'] = t.id;
          setEnabled(item, deps.take !== null, `${t.name}: pick it up to place it`);
          item.append(document.createTextNode(t.name));
          list.append(item);
        }
        rows.append(list);
        return;
      }
      if (m.groups.length === 0) {
        rows.append(el('div', 'wg-sub', m.mode === 'setup' ? 'Every unit is placed.' : m.mode === 'over' ? 'The game is over.' : 'Nothing to list yet.'));
        return;
      }
      // One line a group: its number (which is its key), its name, and how many of its units can still act of how many.
      // Only the active group (the group in hand) is open: its units are listed under its line, as plain names. A click
      // on another group's line goes to that group, which makes it the active one, and so the one open.
      const acting = m.mode === 'act';
      // What a unit that has moved and can still do one thing more is said to be, in the game's own words.
      const movedWord = m.words['moved'] ?? 'has moved';
      for (const g of m.groups) {
        const row = el('div', 'wg-frow');
        row.dataset['group'] = g.id;
        row.dataset['number'] = String(g.number);
        row.dataset['selected'] = g.inHand ? '1' : '0';
        row.dataset['open'] = g.inHand ? '1' : '0';
        const headBtn = button('wg-fhead', () => deps.take?.('group', g.id));
        const count = g.units === 1 ? '1 unit' : `${g.units} units`;
        const can = !acting ? '' : g.able === 0 ? ', none can act now' : g.able === g.units ? (g.units === 1 ? ', which can still act' : ', all can still act') : `, ${g.able} can still act`;
        setEnabled(headBtn, g.enabled && deps.take !== null,
          g.inHand
            ? `${g.name} is the active group: ${count}${can}. Its units are highlighted on the board and listed here.`
            : `${g.name}: ${count}${can}. Click to make it the active group. No unit is chosen.`,
          'not possible now');
        headBtn.append(el('span', 'wg-no', String(g.number)), el('span', 'wg-nm', g.name), el('span', 'wg-cnt', acting ? `${g.able}/${g.units}` : String(g.units)));
        row.append(headBtn);
        if (g.inHand) {
          const list = el('div', 'wg-units');
          list.dataset['part'] = 'units';
          for (const u of g.members) {
            // A unit's short name: what tells it from the others of its kind, and its counter's title ("1a PZ IV H").
            const title = u.title !== '' ? u.title : u.name;
            const words = u.tag === '' ? title : `${u.tag} ${title}`;
            // Plain text: bold when chosen, dimmed when it cannot act any more (on the viewer's own turn: when it cannot act now).
            const cls = ['wg-u'];
            if (u.lost) cls.push('wg-lost');
            if (u.selected && !u.lost) cls.push('wg-sel');
            if (!u.lost && (u.spent || (acting && !u.canAct))) cls.push('wg-dim');
            if (u.suppressed && !u.lost) cls.push('wg-hit');
            const item = button(cls.join(' '), () => deps.pick?.(u.id));
            item.dataset['unit'] = u.id;
            item.dataset['state'] = u.lost ? 'lost' : u.spent ? 'spent' : u.moved ? 'moved' : 'ready';
            setEnabled(item, deps.pick !== null && !u.lost && u.onBoard, u.moved && !u.spent && !u.lost ? `${u.name} (${movedWord})` : u.name, u.lost ? 'lost' : 'not on the board');
            item.append(document.createTextNode(words));
            list.append(item);
          }
          row.append(list);
        }
        rows.append(row);
      }
    },
  };
}
