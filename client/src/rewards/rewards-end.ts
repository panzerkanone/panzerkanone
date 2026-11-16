/**
 * From a battle's end to the rewards screen: what the game's page (client/src/game/start.ts) calls when a battle is
 * over. The battle's report is read off the game's own record (rewards-report.ts), counted once into the service
 * record (rewards-rules.ts), and the page goes on to the rewards screen (`/?screen=rewards`) after a moment (the
 * battle's last moment shown as it is), or at once on a click on the board or the end panel's Continue (in the place
 * of its Play again, or of a campaign battle's Continue Campaign, while the rewards wait).
 *
 * It lives outside the game's own folder, beside the campaign's glue: it reads the rules' view, the shell's record and
 * the kept campaign, none of which the game layer may reach (tests/game/layer.test.ts).
 *
 * Only a battle with one person playing here has rewards: against the computer, and online for the player's own seat.
 * Two people at one table, or the computer on both sides, keep the game's end as it is.
 */
import type { GameModel } from '../game/model';
import { reportOf } from './rewards-report';
import type { EndOfBattle } from './rewards-report';
import { rewardsData } from '../shell/rewards-data';
import { browserService, readService, recordBattle, writeService } from '../shell/rewards-rules';
import type { BattleReport } from '../shell/rewards-rules';

export { endOfBattle, reportOf } from './rewards-report';
export type { EndOfBattle } from './rewards-report';

/** The rewards screen's address. */
export const REWARDS_ADDRESS = '/?screen=rewards';
/** How long the battle's last moment is shown before the rewards screen comes (ms). */
export const LAST_MOMENT_MS = 6000;

/** The battle counted into the service record (once). The battle's report, or null when the battle has no rewards. */
export function settleRewards(end: EndOfBattle, params: URLSearchParams): BattleReport | null {
  const report = reportOf(end, params, window.location.pathname);
  if (!report) return null;
  const store = browserService();
  const r = recordBattle(rewardsData(), readService(store), report);
  if (r.fresh) writeService(store, r.file);
  else if (r.file.last?.report.id !== report.id) writeService(store, { ...r.file, last: r.award });
  return report;
}

export interface RewardsHandOff {
  /** The battle is over (called with every model while it is): counted once, and the rewards screen comes after a moment. */
  over(end: () => EndOfBattle | null): void;
  /** On to the rewards screen now, when this battle has rewards; false when it has none (the caller does as before). */
  go(): boolean;
  /** The end panel while this battle's rewards wait: its one way on is Continue (to the rewards), and no New seed. */
  dress(m: GameModel): GameModel;
  dispose(): void;
}

/** The end panel's word for the way on to the rewards. */
export const ONWARD = 'Continue';

/**
 * The hand-off of the game's page. `panel` is the panel's element: a press in it is the panel's (the end panel's Close
 * puts it away to look at the board) and lets the moment run on until the player goes on, by the panel's Continue or a
 * click on the board.
 */
export function rewardsHandOff(o: { panel: HTMLElement; params: URLSearchParams; delayMs?: number }): RewardsHandOff {
  let ready = false;
  let asked = false;
  let timer = 0;
  let gone = false;
  const leave = (): void => {
    if (gone) return;
    gone = true;
    window.clearTimeout(timer);
    off();
    window.location.assign(REWARDS_ADDRESS);
  };
  const onPointer = (e: PointerEvent): void => {
    if (!ready) return;
    if (e.target instanceof Node && o.panel.contains(e.target)) {
      window.clearTimeout(timer);
      return;
    }
    leave();
  };
  const off = (): void => window.removeEventListener('pointerdown', onPointer, true);
  return {
    over(end) {
      if (asked) return;
      asked = true;
      const e = end();
      if (!e) return;
      let report: BattleReport | null = null;
      try {
        report = settleRewards(e, o.params);
      } catch (err) {
        console.error('[rewards] the battle could not be counted:', err);
      }
      if (!report) return;
      ready = true;
      window.addEventListener('pointerdown', onPointer, true);
      timer = window.setTimeout(leave, o.delayMs ?? LAST_MOMENT_MS);
    },
    go() {
      if (!ready) return false;
      leave();
      return true;
    },
    dress(m) {
      if (!ready || m.result === null) return m;
      return { ...m, controls: m.controls.filter(c => c.id !== 'reseed').map(c => (c.id === 'again' ? { ...c, label: ONWARD } : c)) };
    },
    dispose() {
      window.clearTimeout(timer);
      off();
    },
  };
}
