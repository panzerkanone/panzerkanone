/**
 * The page's one pause: while something the player opened lies over the whole game (the settings, opened from the
 * game's menu), nothing of the game is shown on: the play-back holds before its next wait, so the computer's turn,
 * which goes on only as fast as it is shown, holds too. No timer runs meanwhile. One game a page: so one pause.
 */
let paused = false;
let waiting: (() => void)[] = [];

/** Pause the game's showing, or let it go on. */
export function setPaused(on: boolean): void {
  paused = on;
  if (on) return;
  const go = waiting;
  waiting = [];
  for (const fn of go) fn();
}

export function isPaused(): boolean {
  return paused;
}

/** Resolves at once when the game is not paused; else when it is let go on. */
export function unpaused(): Promise<void> {
  return paused ? new Promise(resolve => waiting.push(resolve)) : Promise.resolve();
}
