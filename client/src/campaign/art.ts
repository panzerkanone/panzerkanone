/**
 * The campaign room's art (assets/campaign/v1/, cut from the owner's sheets by tools/campaignart/): the index
 * (campaign.json: each piece's file and place on the stage, and which are stand-ins) and the bundled addresses of
 * its pictures. Nothing is fetched here: a screen sets an address on an element when it is shown.
 */
import indexText from '../../../assets/campaign/v1/campaign.json?raw';

const FILES = import.meta.glob<string>('../../../assets/campaign/v1/*.webp', { query: '?url', import: 'default', eager: true });

export type RoomPieceId = 'room' | 'bar' | 'projector' | 'projector-body' | 'paper' | 'far' | 'clipboard' | 'roster-sheet' | 'plate-wide' | 'plate-mid' | 'plate-small';
const PIECES: readonly RoomPieceId[] = ['room', 'bar', 'projector', 'projector-body', 'paper', 'far', 'clipboard', 'roster-sheet', 'plate-wide', 'plate-mid', 'plate-small'];

export interface RoomPiece {
  readonly file: string;
  /** Its place on the stage: x, y, width, height. */
  readonly place: readonly [number, number, number, number];
  readonly standIn: boolean;
}

function readIndex(): Readonly<Record<RoomPieceId, RoomPiece>> {
  const raw: unknown = JSON.parse(indexText);
  const pieces = typeof raw === 'object' && raw !== null ? (raw as { pieces?: unknown }).pieces : undefined;
  if (typeof pieces !== 'object' || pieces === null) throw new Error('assets/campaign/v1/campaign.json: no pieces');
  const out: Partial<Record<RoomPieceId, RoomPiece>> = {};
  for (const id of PIECES) {
    const p = (pieces as Record<string, unknown>)[id] as { file?: unknown; place?: unknown; standIn?: unknown } | undefined;
    const place = p?.place;
    if (!p || typeof p.file !== 'string' || !Array.isArray(place) || place.length !== 4 || !place.every(n => typeof n === 'number') || typeof p.standIn !== 'boolean') {
      throw new Error(`assets/campaign/v1/campaign.json: the piece '${id}' is missing or malformed`);
    }
    out[id] = { file: p.file, place: place as unknown as readonly [number, number, number, number], standIn: p.standIn };
  }
  return out as Record<RoomPieceId, RoomPiece>;
}

export const ROOM: Readonly<Record<RoomPieceId, RoomPiece>> = readIndex();

const MODELS = import.meta.glob<string>('../../../assets/campaign/v1/*.glb', { query: '?url', import: 'default', eager: true });

/** The bundled address of the projector's moving parts (a binary glTF file, tools/campaignart/build_reels.py). */
export function reelsAddress(): string {
  const address = MODELS['../../../assets/campaign/v1/projector-reels.glb'];
  if (address === undefined) throw new Error("the campaign room's art: the projector's model is not bundled");
  return address;
}

/** The bundled address of a piece's picture. */
export function roomAddress(id: RoomPieceId): string {
  const file = ROOM[id].file;
  const address = FILES[`../../../assets/campaign/v1/${file}`];
  if (address === undefined) throw new Error(`the campaign room's art: no file is bundled for ${file}`);
  return address;
}
