/**
 * Works the medallion's sounds out off the page's own thread (medallion.ts does the sums; sounds.ts
 * asks). A request names a sound, a take and a rate; the answer is its two channels, handed over,
 * not copied. Nothing is fetched and nothing is drawn here.
 */
import { medallionSound } from './medallion';
import type { MedallionSound } from './medallion';

declare const self: DedicatedWorkerGlobalScope;

export interface MadeRequest {
  readonly id: number;
  readonly sound: MedallionSound;
  readonly take: number;
  readonly rate: number;
}
export type MadeReply = { readonly id: number; readonly channels: Float32Array[] } | { readonly id: number; readonly error: string };

self.onmessage = (e: MessageEvent<MadeRequest>) => {
  const { id, sound, take, rate } = e.data;
  try {
    const channels = medallionSound(sound, take, rate);
    const reply: MadeReply = { id, channels };
    self.postMessage(
      reply,
      channels.map(c => c.buffer as ArrayBuffer),
    );
  } catch (err) {
    const reply: MadeReply = { id, error: err instanceof Error ? err.message : String(err) };
    self.postMessage(reply);
  }
};
