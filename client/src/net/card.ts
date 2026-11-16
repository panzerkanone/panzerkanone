/**
 * The invitation, on the game page of the player who made the game, while the other player has not
 * joined: the link as text, and a button that copies it. It sits over the board under the status
 * plate's box, and goes when the other player joins.
 */

const CSS = `
.pk-invite { position: fixed; left: 50%; bottom: 112px; transform: translateX(-50%); z-index: 40; width: min(560px, calc(100vw - 32px));
  box-sizing: border-box; padding: 12px 14px 13px; background: rgb(239, 230, 210); color: rgb(43, 36, 25); border: 1.5px solid rgb(107, 90, 62); border-radius: 6px;
  box-shadow: 0 6px 22px rgba(0,0,0,.35); font: 500 14px/1.35 system-ui, sans-serif; pointer-events: auto; }
.pk-invite[hidden] { display: none; }
.pk-invite p { margin: 0 0 8px; font-weight: 600; }
.pk-invite .pk-row { display: flex; gap: 8px; }
.pk-invite input { flex: 1 1 auto; min-width: 0; padding: 7px 8px; border: 1px solid rgb(138, 118, 86); border-radius: 4px; background: rgb(251, 247, 238); color: inherit;
  font: 500 13px/1.2 ui-monospace, monospace; }
.pk-invite button { flex: 0 0 auto; padding: 7px 14px; border: 1px solid rgb(61, 51, 34); border-radius: 4px; background: rgb(61, 51, 34); color: rgb(246, 239, 223); font: 600 14px/1 system-ui, sans-serif; cursor: pointer; }
.pk-invite button:hover { background: rgb(87, 72, 47); }
.pk-invite .pk-said { min-height: 18px; margin-top: 6px; font-size: 13px; color: rgb(77, 107, 46); }
`;

export const INVITE_WORDS = {
  heading: 'Send this link to your opponent:',
  copy: 'Copy link',
  copied: 'Link copied.',
  notCopied: 'Select the link and copy it.',
} as const;

export interface InviteCard {
  show(on: boolean): void;
  dispose(): void;
}

export function mountInvitation(link: string): InviteCard {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const card = document.createElement('div');
  card.className = 'pk-invite';
  card.dataset['part'] = 'invitation';
  card.hidden = true;
  const heading = document.createElement('p');
  heading.textContent = INVITE_WORDS.heading;
  const row = document.createElement('div');
  row.className = 'pk-row';
  const text = document.createElement('input');
  text.type = 'text';
  text.readOnly = true;
  text.value = link;
  text.setAttribute('aria-label', 'Invitation link');
  text.addEventListener('focus', () => text.select());
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = INVITE_WORDS.copy;
  const said = document.createElement('div');
  said.className = 'pk-said';
  said.setAttribute('role', 'status');
  copy.addEventListener('click', () => {
    void copyText(link, text).then(ok => {
      said.textContent = ok ? INVITE_WORDS.copied : INVITE_WORDS.notCopied;
    });
  });
  row.append(text, copy);
  card.append(heading, row, said);
  document.body.append(card);
  return {
    show(on) {
      card.hidden = !on;
    },
    dispose() {
      card.remove();
      style.remove();
    },
  };
}

/** Put text on the clipboard; when the browser will not, select it in `field` so that the player can. True when copied. */
export async function copyText(text: string, field: HTMLInputElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (field) {
      field.focus();
      field.select();
    }
    return false;
  }
}
