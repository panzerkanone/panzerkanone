/**
 * What the briefing room says (client/src/shell/campaign-room.ts): the ids of the pieces to say now, in order, for the
 * view the room shows and the kept campaign. The pieces are the campaign's own (`narration`, format.ts); the room hands
 * them to client/src/audio/narration.ts, which says them.
 *
 *   intro     the opening, with the campaign's own briefing
 *   between   the next battle's piece, with its briefing on the clipboard; nothing while a battle is in progress (the
 *             room offers to continue it)
 *   end       the piece of the way the campaign ended
 *
 * Nothing at all for a campaign whose narration is none.
 */
import { nextBattle } from './force';
import type { CampaignRecord } from './force';
import { NONE } from './format';
import type { CampaignData } from './format';

/** The room's three views. */
export type RoomView = 'intro' | 'between' | 'end';

export function piecesFor(c: CampaignData, view: RoomView, record: CampaignRecord | null): readonly string[] {
  const n = c.narration;
  if (n === NONE) return [];
  if (view === 'intro') return [n.opening];
  const r = record && record.campaign === c.id ? record : null;
  if (!r) return [];
  if (view === 'end') return r.stage === 'ended' ? [n.end[r.verdict ?? 'defeat']] : [];
  if (r.stage === 'battle' || r.stage === 'ended') return [];
  const k = nextBattle(c, r);
  const piece = k === null ? undefined : n.battles[k];
  return piece === undefined ? [] : [piece];
}
