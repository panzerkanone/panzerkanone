/**
 * The page's side of the bake worker: one worker, requests answered by id.
 */
import type { BakedReply, BuiltReply, HashReply, Level, Rect, Reply, Request } from './protocol';

type Pending = { resolve: (r: Reply) => void; reject: (e: Error) => void };
type Body =
  | { kind: 'build-map'; mapId: string }
  | { kind: 'build-text'; mapText: string }
  | { kind: 'list'; listText: string }
  | { kind: 'hash' }
  | { kind: 'bake'; level: Level; rect: Rect; format: 'bitmap' | 'png'; extraBreaks?: boolean };

export class BakeClient {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<Reply>) => {
      const msg = e.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.kind === 'error') p.reject(new Error(msg.message));
      else p.resolve(msg);
    };
    this.worker.onerror = (e: ErrorEvent) => {
      const err = new Error(`bake worker failed: ${e.message}`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
  }

  private send<T extends Reply>(body: Body): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: r => resolve(r as T), reject });
      this.worker.postMessage({ ...body, id } as Request);
    });
  }

  buildMap(mapId: string, o: { sightLines?: boolean } = {}): Promise<BuiltReply> {
    return this.send<BuiltReply>({ kind: 'build-map', mapId, ...(o.sightLines === false ? { sightLines: false } : {}) });
  }

  buildText(mapText: string, o: { sightLines?: boolean } = {}): Promise<BuiltReply> {
    return this.send<BuiltReply>({ kind: 'build-text', mapText, ...(o.sightLines === false ? { sightLines: false } : {}) });
  }

  setList(listText: string): Promise<BuiltReply> {
    return this.send<BuiltReply>({ kind: 'list', listText });
  }

  hash(): Promise<HashReply> {
    return this.send<HashReply>({ kind: 'hash' });
  }

  /** `extraBreaks` is a check, not a setting: it must not change a pixel (raster.ts, `extraBreak`). */
  bake(level: Level, rect: Rect, format: 'bitmap' | 'png', extraBreaks = false): Promise<BakedReply> {
    return this.send<BakedReply>({ kind: 'bake', level, rect, format, extraBreaks });
  }
}
