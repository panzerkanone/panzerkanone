/**
 * A developer's strip for the effects and the table's answers: /?view=table&fxdemo=1 (no game
 * needed). A row of plain buttons, and a key for each, sets an effect off at the hex under the
 * pointer; one plays a staged exchange on the table's own counters (a tank fires, is answered, and
 * one burns). A second row calls the port's `intent` and `answer` as a game would: each act a
 * click could be (allowed and refused), a badge of each tone, a refusal, and a shot with each of
 * its three ends. Nothing of this is in a game.
 */
import type { IntentAct, PiecesPort, TableAnswer } from '../pieces/port';
import type { FxHook, PlayKind } from './hook';
import { INTENT_ACTS } from './icons';

type Act = PlayKind | 'exchange' | 'clear';
const ACTS: readonly { key: string; label: string; title: string; kind: Act }[] = [
  { key: 'g', label: 'Gun', title: 'A tank or anti-tank gun fires from this hex at the hex six to its right, at armour', kind: 'gun' },
  { key: 'm', label: 'Small arms', title: 'A run of tracers from this hex at the hex six to its right', kind: 'small' },
  { key: 'l', label: 'Mortar', title: 'A round lobbed from this hex at the hex six to its right', kind: 'lob' },
  { key: 'h', label: 'Hit', title: 'A round arrives on armour here', kind: 'hit' },
  { key: 'j', label: 'Dirt', title: 'A round arrives on soft ground here', kind: 'dirt' },
  { key: 'x', label: 'Kill', title: 'An explosion here, and the wreck burns', kind: 'kill' },
  { key: 'v', label: 'Blast', title: 'A blast of high explosive here', kind: 'blast' },
  { key: 'f', label: 'Fire', title: 'A wreck burns here', kind: 'fire' },
  { key: 'k', label: 'Smoke', title: 'A smoke screen on this hex (again: it is taken up)', kind: 'screen' },
  { key: 'i', label: 'Fire mission', title: 'A fire mission arrives on this hex', kind: 'mission' },
  { key: 'u', label: 'Dust', title: 'A vehicle drives four hexes to the right from here', kind: 'dust' },
  { key: 'p', label: 'Wisp', title: 'The wisp over a suppressed unit (again: it stops)', kind: 'wisp' },
  { key: 'e', label: 'Exchange', title: 'A tank fires, is answered, and one burns (R puts the counters back)', kind: 'exchange' },
  { key: 'c', label: 'Clear', title: 'Everything gone at once', kind: 'clear' },
];

/** Words a game might give with each act, for the demonstration. */
const WORDS: Readonly<Record<IntentAct, readonly [string, string]>> = {
  select: ['Select', 'Not yours'],
  order: ['Order group B', 'Already ordered'],
  move: ['Move 4 of 11', 'Too far'],
  fire: ['Fire 58%', 'Out of range'],
  charge: ['Charge 3:1', 'No way in'],
  drive: ['Drive through', 'Blocked'],
  board: ['Board', 'Carrier is full'],
  unload: ['Unload', 'No room here'],
  call: ['Call fire, 2 turns', 'No battery free'],
  screen: ['Lay a screen', 'None left'],
  place: ['Place here', 'Not your zone'],
};
const RESULTS: readonly { result: 'none' | 'suppressed' | 'destroyed'; words: string; tone: 'good' | 'bad' | 'plain' }[] = [
  { result: 'none', words: 'No effect', tone: 'plain' },
  { result: 'suppressed', words: 'Suppressed', tone: 'good' },
  { result: 'destroyed', words: 'Destroyed', tone: 'good' },
];
const BADGES: readonly { words: string; tone: 'good' | 'bad' | 'plain' }[] = [
  { words: 'Activated', tone: 'good' },
  { words: 'Lost a step', tone: 'bad' },
  { words: 'Passed', tone: 'plain' },
];

export function mountFxDemo(o: {
  root: HTMLElement;
  canvas: HTMLElement;
  /** The effects, or null with `fx=0`. */
  fx: FxHook | null;
  /** The counters' port, once they are on the table. */
  port: () => PiecesPort | null;
  /** The ids of the counters on a hex, from the bottom. */
  ids: (hex: number) => readonly string[];
  /** The hex so many columns to the right of one (itself where there is none). */
  across: (hex: number, columns: number) => number;
  hover: () => number;
  say?: (text: string) => void;
}): void {
  let lastHex = -1;
  o.canvas.addEventListener('pointermove', () => {
    const h = o.hover();
    if (h >= 0) lastHex = h;
  });
  const here = (): number => {
    const now = o.hover();
    const hex = now >= 0 ? now : lastHex;
    if (hex < 0) o.say?.('Point at a hex first');
    return hex;
  };
  const act = (kind: Act): void => {
    if (!o.fx) {
      o.say?.('The effects are off (fx=0)');
      return;
    }
    if (kind === 'clear') {
      o.fx.clear();
      return;
    }
    if (kind === 'exchange') {
      void o.fx.exchange().then(got => {
        if (!got) o.say?.('No two tanks to stage it with');
      });
      return;
    }
    const hex = here();
    if (hex >= 0) o.fx.play(kind, hex);
  };

  // ---- the table's answers, through the port as a game calls them --------------------------------------
  let nextAct = 0;
  let nextBadge = 0;
  let nextResult = 0;
  const top = (hex: number): string | null => {
    const ids = o.ids(hex);
    return ids[ids.length - 1] ?? null;
  };
  const intent = (can: boolean): void => {
    const port = o.port();
    const hex = here();
    if (!port || hex < 0) return;
    const a = INTENT_ACTS[nextAct - Math.floor(nextAct / INTENT_ACTS.length) * INTENT_ACTS.length] as IntentAct;
    nextAct++;
    port.intent?.({ hex, unit: top(hex), act: a, can, words: WORDS[a][can ? 0 : 1] });
  };
  const answer = (make: (hex: number) => TableAnswer | null): void => {
    const port = o.port();
    const hex = here();
    if (!port || hex < 0) return;
    const a = make(hex);
    if (a) port.answer?.(a);
  };
  const shot = (): void => {
    const port = o.port();
    const from = here();
    if (!port || from < 0) return;
    let to = o.across(from, 6);
    if (to === from) to = o.across(from, -6);
    const r = RESULTS[nextResult - Math.floor(nextResult / RESULTS.length) * RESULTS.length] as (typeof RESULTS)[number];
    nextResult++;
    const by = top(from) ?? '';
    const on = top(to);
    port.answer?.({ kind: 'fired', from, to, by, on });
    window.setTimeout(() => {
      port.answer?.({ kind: 'landed', from, to, by, on, result: r.result, words: r.words, tone: r.tone });
      if (r.result === 'destroyed' && on !== null) void port.remove(on, 'destroyed').catch(() => undefined);
    }, 420);
  };
  const ANSWERS: readonly { key: string; label: string; title: string; run: () => void }[] = [
    { key: 'n', label: 'Intent', title: 'What a click here would do: each act in turn, with its moving picture, its words and its cursor', run: () => intent(true) },
    { key: 'q', label: 'Intent refused', title: 'The same, where the click would be refused', run: () => intent(false) },
    { key: '0', label: 'No intent', title: 'Nothing to show: the mark eases out and the cursor is the plain arrow', run: () => o.port()?.intent?.(null) },
    {
      key: 'y', label: 'Badge', title: 'A label that floats up and fades: good, bad and plain in turn', run: () =>
        answer(hex => {
          const b = BADGES[nextBadge - Math.floor(nextBadge / BADGES.length) * BADGES.length] as (typeof BADGES)[number];
          nextBadge++;
          return { kind: 'badge', hex, unit: top(hex), words: b.words, tone: b.tone };
        }),
    },
    { key: 'z', label: 'Refused', title: 'A red X that shakes and goes, with why beside it', run: () => answer(hex => ({ kind: 'refused', hex, unit: top(hex), words: 'Not in sight' })) },
    { key: 't', label: 'Shot', title: 'A counter here fires at the hex six to its right, and its fire lands: no effect, suppressed and destroyed in turn', run: shot },
  ];

  const strip = document.createElement('div');
  strip.style.cssText = 'position:fixed;left:8px;top:8px;z-index:30;display:flex;flex-direction:column;gap:4px;max-width:calc(100vw - 16px);font:12px/1.4 system-ui,sans-serif;padding:4px 8px;background:Canvas;color:CanvasText;opacity:0.92;border-radius:4px';
  const row = (lead: string): HTMLDivElement => {
    const r = document.createElement('div');
    r.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;align-items:center';
    const s = document.createElement('span');
    s.textContent = lead;
    r.appendChild(s);
    strip.appendChild(r);
    return r;
  };
  const button = (into: HTMLElement, label: string, key: string, title: string, run: () => void): void => {
    const b = document.createElement('button');
    b.textContent = `${label} (${key.toUpperCase()})`;
    b.title = title;
    b.style.cssText = 'font:inherit;padding:1px 6px;cursor:pointer';
    b.addEventListener('click', () => {
      run();
      o.canvas.focus();
    });
    into.appendChild(b);
  };
  const effects = row('Effects, at the hex under the pointer:');
  for (const a of ACTS) button(effects, a.label, a.key, a.title, () => act(a.kind));
  const answers = row('Answers, as a game calls them:');
  for (const a of ANSWERS) button(answers, a.label, a.key, a.title, a.run);
  o.root.appendChild(strip);

  window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : '';
    const effect = ACTS.find(a => a.key === key);
    const reply = ANSWERS.find(a => a.key === key);
    if (!effect && !reply) return;
    e.preventDefault();
    if (effect) act(effect.kind);
    else reply?.run();
  });
}
