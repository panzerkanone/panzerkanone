/**
 * The rewards screen's art (assets/rewards/v1/, cut from the owner's sheets by tools/rewardsart/): the index
 * (rewards.json: each piece's file and size, and each medal and rank by side and tier) and the bundled addresses of its
 * pictures. The plates at the screen's foot are the campaign kit's (assets/campaign/v1/, the same plates his finished
 * look shows). Nothing is fetched here: a screen sets an address on an element when it is shown.
 */
import indexText from '../../../assets/rewards/v1/rewards.json?raw';

const FILES = import.meta.glob<string>('../../../assets/rewards/v1/*.webp', { query: '?url', import: 'default', eager: true });
const PLATES = import.meta.glob<string>('../../../assets/campaign/v1/plate-*.webp', { query: '?url', import: 'default', eager: true });

export interface RewardsPiece {
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly side: 'german' | 'soviet' | null;
  readonly tier: number | null;
}

function readIndex(): Readonly<Record<string, RewardsPiece>> {
  const raw: unknown = JSON.parse(indexText);
  const pieces = typeof raw === 'object' && raw !== null ? (raw as { pieces?: unknown }).pieces : undefined;
  if (typeof pieces !== 'object' || pieces === null) throw new Error('assets/rewards/v1/rewards.json: no pieces');
  const out: Record<string, RewardsPiece> = {};
  for (const [id, v] of Object.entries(pieces as Record<string, unknown>)) {
    const p = v as Partial<RewardsPiece> | null;
    if (!p || typeof p.file !== 'string' || typeof p.width !== 'number' || typeof p.height !== 'number') throw new Error(`assets/rewards/v1/rewards.json: the piece '${id}' is malformed`);
    out[id] = { file: p.file, width: p.width, height: p.height, side: p.side ?? null, tier: p.tier ?? null };
  }
  if (!out['desk']) throw new Error('assets/rewards/v1/rewards.json: no desk');
  return out;
}

export const REWARDS_ART: Readonly<Record<string, RewardsPiece>> = readIndex();

/** The bundled address of a piece's picture. */
export function rewardsAddress(id: string): string {
  const piece = REWARDS_ART[id];
  const address = piece ? FILES[`../../../assets/rewards/v1/${piece.file}`] : undefined;
  if (address === undefined) throw new Error(`the rewards screen's art: no file is bundled for ${id}`);
  return address;
}

/** The bundled address of one of the campaign kit's blank plates. */
export function plateAddress(kind: 'wide' | 'mid' | 'small'): string {
  const address = PLATES[`../../../assets/campaign/v1/plate-${kind}.webp`];
  if (address === undefined) throw new Error(`the rewards screen's art: no plate-${kind} is bundled`);
  return address;
}
