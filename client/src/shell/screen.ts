/**
 * What a screen of the shell is, and what the shell hands each one (app.tsx makes both).
 *
 * The shell shows one screen at a time on the one stage: the title and main menu, the settings, the
 * scenario list, the side selector. The address names the screen (`screen=`; the title has none),
 * so a reload stays where it was. A screen is an element filling the stage, laid out in stage
 * pixels; it is built the first time it is shown, and hidden (not thrown away) when another is.
 */
import type { ScreenId } from './address';
import type { ShellArt } from './manifest';
import type { SettingsModel } from './settings';
import type { TitleSound } from './sound';
import type { Stage } from './stage-dom';

export interface Screen {
  readonly id: ScreenId;
  readonly element: HTMLElement;
  /** Shown by this address; `note` is a line to say as it comes (the settings' "Changes not applied."). */
  show(q: URLSearchParams, note: string | null): void;
  /** Another screen is shown in its place. */
  hide(): void;
  /** Takes a key while it is shown; true when it was the screen's. */
  key(e: KeyboardEvent): boolean;
}

export interface Shell {
  readonly stage: Stage;
  /** The address the page was opened with (a capture's `t=`, `seed=`, `motion=0`, the sound's switches). */
  readonly params: URLSearchParams;
  readonly model: SettingsModel;
  readonly sound: TitleSound;
  readonly art: ShellArt;
  /** The bundled address of one of the art's files. */
  address(file: string): string;
  /** On to another screen (the browser's Back comes back). */
  go(to: ScreenId, extra?: { scenario?: string | null; from?: string | null; online?: boolean; campaign?: string | null }): void;
  /** Back to the screen this one was reached from (the title from the settings and the list, the list from the side selector). */
  back(note?: string | null): void;
  current(): ScreenId;
}
