/**
 * The full panels: the scenario's briefing, the rule book, and the result of
 * a game. Each lies over the middle of the screen and is put away by its own
 * button or by Escape. The briefing and the rule book are opened by their
 * corner buttons (the briefing is also what a player sees before the first
 * turn); the result comes with the end of the game. hud.ts decides which is
 * open; these draw them from the model.
 */
import { centreOf, cornersOf, worldBounds } from '../../../engine/core/hex';
import type { UnitPicture } from './hud-book';
import { button, el, keycap, line, markOf, setEnabled, setStock, setText } from './hud-dom';
import type { MarkPicture } from './hud-dom';
import { icon } from './hud-icons';
import { PLAN, placeBadges } from './plan-badges';
import type { BriefingModel, GameModel, Stock } from './model';
import type { RuleBook } from './reading';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface FullPanel {
  readonly root: HTMLElement;
  show(open: boolean): void;
  draw(model: GameModel): void;
}

/** The frame every full panel has: a name on its tab, a button that puts it away, a sheet. */
function dossier(part: string, cls: string, onClose: () => void): { root: HTMLDivElement; name: HTMLSpanElement; sheet: HTMLDivElement } {
  const root = el('div', `wg-dossier ${cls}`);
  root.dataset['part'] = part;
  const name = el('span', 'wg-tabname');
  const x = button('wg-x wg-steel', onClose);
  x.dataset['act'] = 'close';
  x.append(document.createTextNode('Close'), keycap('Esc'));
  const sheet = el('div', 'wg-sheet');
  root.append(name, x, sheet);
  return { root, name, sheet };
}

/** A small plan of the board: its hexes faintly, and the objectives where they lie, in their holders' colours. */
function plan(m: GameModel): SVGSVGElement {
  const g = m.grid;
  const [x0, y0, x1, y1] = worldBounds(g);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `${x0 - 0.3} ${y0 - 0.3} ${x1 - x0 + 0.6} ${y1 - y0 + 0.6}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const outline = (hex: number, grow: number): string => {
    const c = centreOf(g, hex);
    return `${cornersOf(g, hex).map((p, i) => `${i === 0 ? 'M' : 'L'}${(c[0] + (p[0] - c[0]) * grow).toFixed(3)} ${(c[1] + (p[1] - c[1]) * grow).toFixed(3)}`).join('')}Z`;
  };
  let all = '';
  for (let hex = 0; hex < g.cols * g.rows; hex++) all += outline(hex, 1);
  const mesh = document.createElementNS(SVG_NS, 'path');
  mesh.setAttribute('d', all);
  mesh.setAttribute('fill', 'none');
  mesh.setAttribute('stroke', 'var(--ink-soft)');
  mesh.setAttribute('stroke-width', '0.03');
  mesh.setAttribute('opacity', '0.45');
  svg.appendChild(mesh);
  const fill = (stock: Stock | null): string => (stock === 'first' ? 'var(--side-first)' : stock === 'second' ? 'var(--side-second)' : 'var(--paper)');
  // Each objective's marker lies on its own hex; its number is a badge, on the marker where that is clear of every other
  // badge and marker, else beside it with a short line to it: objectives two hexes apart or less no longer cover one another.
  const objectives = m.score.objectives;
  const centres = objectives.map(o => centreOf(g, o.hex));
  objectives.forEach((o, k) => {
    const mark = document.createElementNS(SVG_NS, 'path');
    mark.setAttribute('d', outline(o.hex, PLAN.mark));
    mark.setAttribute('fill', fill(o.stock));
    mark.setAttribute('stroke', 'var(--ink)');
    mark.setAttribute('stroke-width', '0.14');
    mark.dataset['objective'] = String(k);
    svg.appendChild(mark);
  });
  const badges = placeBadges(centres, [x0, y0, x1, y1]);
  objectives.forEach((o, k) => {
    const at = badges[k] as readonly [number, number];
    const c = centres[k] as readonly [number, number];
    const group = document.createElementNS(SVG_NS, 'g');
    group.dataset['badge'] = String(k);
    if (Math.hypot(at[0] - c[0], at[1] - c[1]) > 1e-6) {
      const leader = document.createElementNS(SVG_NS, 'line');
      leader.setAttribute('x1', c[0].toFixed(3));
      leader.setAttribute('y1', c[1].toFixed(3));
      leader.setAttribute('x2', at[0].toFixed(3));
      leader.setAttribute('y2', at[1].toFixed(3));
      leader.setAttribute('stroke', 'var(--ink)');
      leader.setAttribute('stroke-width', '0.14');
      group.appendChild(leader);
    }
    const disc = document.createElementNS(SVG_NS, 'circle');
    disc.setAttribute('cx', at[0].toFixed(3));
    disc.setAttribute('cy', at[1].toFixed(3));
    disc.setAttribute('r', String(PLAN.badge));
    disc.setAttribute('fill', fill(o.stock));
    disc.setAttribute('stroke', 'var(--ink)');
    disc.setAttribute('stroke-width', '0.14');
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', at[0].toFixed(3));
    text.setAttribute('y', (at[1] + PLAN.text * 0.36).toFixed(3));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', String(PLAN.text));
    text.setAttribute('font-weight', '700');
    text.setAttribute('fill', o.stock === null ? 'var(--ink)' : 'var(--paper)');
    text.textContent = String(o.points);
    group.append(disc, text);
    svg.appendChild(group);
  });
  return svg;
}

export function makeBriefing(deps: {
  art: ((type: string) => UnitPicture | null) | null;
  mark: MarkPicture | null;
  /** The address of a picture by its id, when the page has one. */
  picture: ((id: string) => string | null) | null;
  onClose(): void;
}): FullPanel & { begun(): void; page(by: 1 | -1): boolean } {
  const { root, name, sheet } = dossier('briefing', 'wg-briefing', deps.onClose);
  name.textContent = 'Scenario briefing';
  const left = el('div', 'wg-col');
  const middle = el('div', 'wg-col');
  const right = el('div', 'wg-col');
  sheet.append(left, middle, right);
  const go = button('wg-btn wg-steel wg-primary wg-go', deps.onClose);
  go.dataset['act'] = 'begin';
  const goLabel = el('span', 'wg-lab', 'Begin');
  go.append(icon('check'), goLabel, keycap('Enter'));
  let key = '?';
  let goals: HTMLElement[] = [];
  let thumb: HTMLElement | null = null;
  let holdersKey = '';
  // A force too long for its column even set close is shown a page at a time (the owner, 2026-11-14: "there needs to be
  // a "more..." and "back..." button"): each side's list breaks between its groups (as the briefing lists them), never
  // inside one, and the side's name and strength stand at its head on every page. `blocks`: each side's groups, in
  // order; `pages`: for each page, the groups of each side on it (by their place in `blocks`); `at`: the page shown.
  let blocks: HTMLElement[][] = [];
  let pages: number[][][] = [];
  let at = 0;
  const pager = el('div', 'wg-pager');
  pager.dataset['part'] = 'pager';
  const turnTo = (by: number): void => {
    if (pages.length < 2) return;
    at = Math.max(0, Math.min(pages.length - 1, at + by));
    showPage();
  };
  const backBtn = button('wg-btn wg-steel wg-page-btn', () => turnTo(-1));
  backBtn.dataset['act'] = 'page-back';
  backBtn.append(el('span', 'wg-lab', 'Back…'));
  const pageWords = el('span', 'wg-page-of');
  const moreBtn = button('wg-btn wg-steel wg-page-btn', () => turnTo(1));
  moreBtn.dataset['act'] = 'page-more';
  moreBtn.append(el('span', 'wg-lab', 'More…'));
  pager.append(backBtn, pageWords, moreBtn);

  /** Shows the page `at`: each side's groups on it, the others hidden; the pager says which page of how many. */
  function showPage(): void {
    const paged = pages.length > 1;
    middle.classList.toggle('wg-paged', paged);
    blocks.forEach((side, s) => side.forEach((block, i) => {
      block.hidden = paged && !(pages[at]?.[s] ?? []).includes(i);
    }));
    if (!paged) return;
    setText(pageWords, `Page ${at + 1} of ${pages.length}`);
    setEnabled(backBtn, at > 0, 'Back (←)', 'this is the first page');
    setEnabled(moreBtn, at < pages.length - 1, 'More (→)', 'this is the last page');
  }

  const build = (b: BriefingModel, m: GameModel): void => {
    left.textContent = '';
    middle.textContent = '';
    right.textContent = '';
    // The picture, the title, the story.
    const photo = el('div', 'wg-photo');
    const holder = el('div');
    holder.append(icon('picture'), el('br'), document.createTextNode(b.title));
    const address = deps.picture ? deps.picture(b.picture) : null;
    photo.append(el('span', 'wg-clip'), holder);
    if (address !== null) {
      const img = el('img');
      img.alt = `${b.title}: the scenario's picture`;
      img.src = address;
      img.style.display = 'block';
      photo.append(img);
      photo.dataset['has'] = '1';
    }
    left.append(photo, el('h1', '', b.title), el('div', 'wg-date', b.dateline));
    for (const p of b.paragraphs) left.append(el('p', '', p));
    left.append(el('p', 'wg-small', b.note));

    // Each side's force, as the scenario gives it: each of its groups a block of its own, which a page never breaks.
    const forces = el('div', 'wg-forces');
    blocks = [];
    pages = [];
    at = 0;
    for (const f of b.forces) {
      const mine: HTMLElement[] = [];
      blocks.push(mine);
      const col = el('div');
      col.dataset['seat'] = f.seat;
      setStock(col, f.stock);
      const head = el('h2');
      const who = el('span');
      who.append(markOf(f.mark, f.stock, null, 'header', true), document.createTextNode(f.name));
      head.append(who, el('span', '', f.who));
      const medal = f.mark !== null && deps.mark ? deps.mark(f.mark, 'header') : null;
      if (medal !== null) {
        const img = el('img', 'wg-mk');
        img.alt = '';
        img.src = medal;
        head.append(img);
      }
      // The side's whole strength stands at the head of its list, where it is seen however long the list is.
      const total = el('div', 'wg-tot');
      total.dataset['total'] = String(f.total);
      total.append(el('span', '', f.totalLabel), el('b', '', String(f.total)));
      col.append(head, el('div', 'wg-aim', f.aim), total);
      for (const g of f.groups) {
        const block = el('div', 'wg-fblock');
        mine.push(block);
        col.append(block);
        block.append(el('div', 'wg-fm', g.name));
        for (const u of g.lines) {
          const row = el('div', 'wg-ur');
          const art = deps.art ? deps.art(u.type) : null;
          if (art && art.card !== null) {
            const img = el('img');
            img.alt = '';
            img.src = art.card;
            row.append(img);
          } else {
            row.append(icon('picture'));
          }
          row.append(el('span', '', u.text), el('b', '', String(u.points)));
          block.append(row);
        }
      }
      forces.append(col);
    }
    middle.append(forces, pager);

    // How to win.
    const head = el('h2');
    head.append(el('span', '', b.winTitle));
    thumb = el('div', 'wg-mapthumb');
    thumb.append(plan(m));
    right.append(head, thumb);
    goals = b.goals.map(goal => {
      const row = el('div', 'wg-objl');
      row.append(icon('hex'), el('span', '', goal.name), el('b', '', goal.worth));
      right.append(row);
      return row;
    });
    for (const t of b.terms) right.append(line(t.label, t.value));
    right.append(el('h6', '', b.endTitle));
    for (const e of b.endings) right.append(line(e.label, e.value));
    right.append(go);
  };

  /**
   * The pages, for a force that does not fit its column even set close: each side's groups, in order, as many to a
   * page as fit under its head (its name, aim and strength, which stand on every page) and above the pager; a group
   * taller than a whole page has a page to itself. The sides turn page together.
   */
  const paginate = (): void => {
    middle.classList.add('wg-paged');
    const style = getComputedStyle(middle);
    const room = middle.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - pager.offsetHeight - parseFloat(getComputedStyle(pager).marginTop || '0');
    const perSide = blocks.map(side => {
      const first = side[0];
      if (!first) return [] as number[][];
      // A block's offset is from its side's column (positioned): the head is what stands above the first group.
      const head = first.offsetTop;
      const tall = side.map((block, i) => (i + 1 < side.length ? (side[i + 1] as HTMLElement).offsetTop - block.offsetTop : block.offsetHeight));
      const out: number[][] = [];
      let now: number[] = [];
      let used = head;
      tall.forEach((h, i) => {
        if (now.length > 0 && used + h > room) {
          out.push(now);
          now = [];
          used = head;
        }
        now.push(i);
        used += h;
      });
      if (now.length > 0) out.push(now);
      return out;
    });
    const n = Math.max(1, ...perSide.map(p => p.length));
    pages = Array.from({ length: n }, (_, k) => perSide.map(p => p[k] ?? []));
    at = Math.min(at, n - 1);
  };

  // Measured a frame after the page is shown or redrawn, once it is laid out (closed, it has no height to measure).
  const fitForces = (): void => {
    const measure = (): void => {
      if (!root.classList.contains('wg-open')) return;
      const keep = at;
      // A side's name wraps beside who plays it; where one of its words is too wide even so, who plays it goes under it.
      for (const h of middle.querySelectorAll<HTMLElement>('.wg-forces h2')) {
        h.classList.remove('wg-hwrap');
        const name = h.firstElementChild as HTMLElement | null;
        if (name && name.scrollWidth > name.clientWidth + 1) h.classList.add('wg-hwrap');
      }
      middle.classList.remove('wg-dense', 'wg-paged');
      for (const side of blocks) for (const block of side) block.hidden = false;
      pages = [];
      if (middle.scrollHeight > middle.clientHeight + 1) middle.classList.add('wg-dense');
      if (middle.scrollHeight > middle.clientHeight + 1) {
        at = keep;
        paginate();
      }
      showPage();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(measure);
    else measure();
  };

  return {
    root,
    show(open: boolean): void {
      root.classList.toggle('wg-open', open);
      // A force too long for its page is set closer, so that every unit is seen without scrolling (a scroll bar is
      // hidden until used, and the last units looked cut off). Measured once the page is shown and laid out.
      if (open) fitForces();
    },
    begun(): void {
      setText(goLabel, 'Carry on');
    },
    page(by: 1 | -1): boolean {
      if (pages.length < 2) return false;
      turnTo(by);
      return true;
    },
    draw(m: GameModel): void {
      const b = m.briefing;
      if (!b) return;
      const now = JSON.stringify(b);
      if (now !== key) {
        key = now;
        holdersKey = '';
        build(b, m);
        fitForces();
      }
      // Who holds each objective: the only thing here that changes while a game is played.
      const holders = m.score.objectives.map(o => o.stock ?? '').join('|');
      if (holders !== holdersKey) {
        holdersKey = holders;
        m.score.objectives.forEach((o, k) => {
          const row = goals[k];
          if (row) setStock(row, o.stock);
        });
        if (thumb) {
          thumb.textContent = '';
          thumb.append(plan(m));
        }
      }
    },
  };
}

export function makeRuleBook(deps: { onClose(): void }): FullPanel {
  const { root, name, sheet } = dossier('rulebook', 'wg-rulebook', deps.onClose);
  const toc = el('div', 'wg-col wg-toc');
  const page = el('div', 'wg-col');
  sheet.append(toc, page);
  let book: RuleBook | null = null;
  let at = 0;
  let tocButtons: HTMLButtonElement[] = [];

  const showPage = (): void => {
    page.textContent = '';
    const p = book?.pages[at];
    if (!p) return;
    tocButtons.forEach((b, i) => b.classList.toggle('wg-on', i === at));
    const body = el('div', 'wg-rbody');
    body.dataset['page'] = p.id;
    const words = el('div');
    words.append(el('h1', '', /^\d+$/.test(p.mark) ? `${p.mark} · ${p.title}` : p.title), el('div', 'wg-date', p.lead));
    const list = el('ol');
    for (const point of p.points) {
      const item = el('li');
      for (const span of point) item.append(span.strong ? el('b', '', span.text) : document.createTextNode(span.text));
      list.append(item);
    }
    words.append(list);
    if (p.tip !== null) words.append(el('div', 'wg-tip', p.tip));
    body.append(words);
    const side = el('div');
    if (p.table) {
      const table = el('div', 'wg-rtable');
      table.append(el('h6', '', p.table.title));
      for (const row of p.table.rows) table.append(line(row.label, row.value));
      side.append(table);
    }
    body.append(side);
    page.append(body);
    page.scrollTop = 0;
  };

  return {
    root,
    show(open: boolean): void {
      root.classList.toggle('wg-open', open);
    },
    draw(m: GameModel): void {
      if (m.rulebook === book) return;
      book = m.rulebook;
      toc.textContent = '';
      tocButtons = [];
      if (!book) return;
      setText(name, book.title);
      const head = el('h2');
      head.append(el('span', '', 'Contents'));
      toc.append(head);
      book.pages.forEach((p, i) => {
        const b = button('', () => {
          at = i;
          showPage();
        });
        b.dataset['page'] = p.id;
        b.append(el('span', 'wg-n', p.mark), document.createTextNode(p.title));
        toc.append(b);
        tocButtons.push(b);
      });
      at = Math.min(at, book.pages.length - 1);
      showPage();
    },
  };
}

export function makeResult(deps: { press(id: string): void; mark: MarkPicture | null; onClose(): void }): FullPanel {
  const { root, name, sheet } = dossier('result', 'wg-result', deps.onClose);
  name.textContent = 'Game over';
  let key = '?';
  return {
    root,
    show(open: boolean): void {
      root.classList.toggle('wg-open', open);
    },
    draw(m: GameModel): void {
      const r = m.result;
      const acts = m.controls.filter(c => c.id === 'again' || c.id === 'reseed');
      const now = r === null ? '' : JSON.stringify([r, m.score.sides, m.seed, acts]);
      if (now === key) return;
      key = now;
      sheet.textContent = '';
      if (r === null) return;
      setStock(root, r.stock);
      sheet.append(el('h1', '', r.headline));
      const table = el('div', 'wg-scores');
      table.append(el('span'), el('span'), el('span', 'wg-hd', 'Points'), el('span', 'wg-hd', 'Lost'));
      for (const s of m.score.sides) {
        const mark = el('span');
        mark.append(markOf(s.mark, s.stock, deps.mark, 'plate'));
        const side = el('span', '', s.name);
        if (s.seat === r.winner) side.style.fontWeight = '700';
        table.append(mark, side, el('b', '', String(s.score)), el('b', '', String(s.losses)));
      }
      sheet.append(table, el('div', 'wg-seed', `Seed ${m.seed}`));
      const row = el('div', 'wg-acts');
      for (const c of acts) {
        const b = button(c.primary ? 'wg-btn wg-steel wg-primary' : 'wg-btn wg-steel', () => deps.press(c.id));
        b.dataset['control'] = c.id;
        setEnabled(b, c.enabled, `${c.label} (${c.key})`, c.why ?? 'not possible now');
        b.append(icon(c.id), el('span', 'wg-lab', c.label), keycap(c.key));
        row.append(b);
      }
      sheet.append(row);
    },
  };
}
