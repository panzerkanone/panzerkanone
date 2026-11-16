/**
 * The game server: a Cloudflare Worker that makes games and sends each game's sockets to a Durable
 * Object of its own (GameRoom), which holds the game (room.ts) in its SQLite storage.
 *
 *   POST /games                 make a game: { scenario, invites: [check, check] } -> 201 { match, scenario, seats }
 *   GET  /games/<match>         what a page needs before it joins: { match, scenario, seats, over }
 *   GET  /games/<match>/socket  the game's WebSocket (the session protocol, session/README.md)
 *
 * A game is named by 16 random bytes in hex, drawn here; its object is found by that name. The
 * sockets are hibernating: the object may leave memory between messages, and the sockets stay open.
 * A game nobody has opened for KEEP_MS (fourteen days) is deleted by the object's alarm.
 *
 * Who may use it: pages from the origins in ORIGINS (wrangler.toml), Cloudflare Pages' previews of
 * the site, and with LOCAL=1 (wrangler dev, package.json's `dev`) pages served from this machine. A
 * request with no Origin (not a browser page) is let through: an Origin check could not stop it.
 */
import { DurableObject } from 'cloudflare:workers';
import { bytesToHex } from '../../protocol/check';
import { KEEP_MS, Room } from './room';
import type { RoomSocket, SocketTag, Table } from './room';
import { ScenarioShelf } from './scenarios';
import { TEXTS } from './texts';

export interface Env {
  readonly GAMES: DurableObjectNamespace<GameRoom>;
  /** The origins of the pages that may use the server, separated by commas. */
  readonly ORIGINS?: string;
  /** "1": pages served from this machine (http://127.0.0.1 or http://localhost, any port) may use it too. */
  readonly LOCAL?: string;
}

/** Every scenario's content, loaded once for the whole isolate: a ruleset holds no game state. */
const shelf = new ScenarioShelf(TEXTS);

const MATCH = /^\/games\/([0-9a-f]{32})(\/socket)?$/;
const MAX_BODY = 4096;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

function originAllowed(origin: string | null, env: Env): boolean {
  if (origin === null) return true;
  const listed = (env.ORIGINS ?? '').split(',').map(s => s.trim()).filter(s => s !== '');
  if (listed.includes(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+\.panzerkanone\.pages\.dev$/.test(origin)) return true;
  return env.LOCAL === '1' && /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(origin);
}

/** The response with the headers that let the page read it. */
function withCors(res: Response, origin: string | null): Response {
  const out = new Response(res.body, res);
  if (origin !== null) {
    out.headers.set('access-control-allow-origin', origin);
    out.headers.append('vary', 'Origin');
  }
  return out;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    if (!originAllowed(origin, env)) return json(403, { error: 'This page may not use the game server.' });
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': origin ?? '*',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
          'access-control-max-age': '86400',
          vary: 'Origin',
        },
      });
    }
    if (url.pathname === '/') return withCors(json(200, { server: 'Panzer Kanone games' }), origin);
    if (url.pathname === '/games') {
      if (request.method !== 'POST') return withCors(json(405, { error: 'A game is made by POST.' }), origin);
      const text = await request.text();
      if (text.length > MAX_BODY) return withCors(json(413, { error: 'Too long.' }), origin);
      const match = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
      const room = env.GAMES.get(env.GAMES.idFromName(match));
      const res = await room.fetch(`https://room/create?match=${match}`, { method: 'POST', body: text, headers: { 'content-type': 'application/json' } });
      return withCors(res, origin);
    }
    const found = MATCH.exec(url.pathname);
    if (found) {
      const room = env.GAMES.get(env.GAMES.idFromName(found[1] as string));
      if (found[2]) {
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return withCors(json(426, { error: 'This is a WebSocket.' }), origin);
        return room.fetch(new Request('https://room/socket', request));
      }
      if (request.method !== 'GET') return withCors(json(405, { error: 'Only GET.' }), origin);
      return withCors(await room.fetch('https://room/info'), origin);
    }
    return withCors(json(404, { error: 'Nothing here.' }), origin);
  },
} satisfies ExportedHandler<Env>;

/** One table of the object's SQLite: text under keys. */
function tableOf(storage: DurableObjectStorage, name: 'session' | 'room'): Table {
  return {
    all() {
      const out = Object.create(null) as Record<string, string>;
      for (const row of storage.sql.exec<{ key: string; text: string }>(`SELECT key, text FROM ${name}`)) out[row.key] = row.text;
      return out;
    },
    get(key) {
      const rows = storage.sql.exec<{ text: string }>(`SELECT text FROM ${name} WHERE key = ?`, key).toArray();
      return rows[0]?.text ?? null;
    },
    put(writes) {
      storage.transactionSync(() => {
        for (const w of writes) storage.sql.exec(`INSERT INTO ${name} (key, text) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET text = excluded.text`, w.key, w.text);
      });
    },
  };
}

function tagOf(raw: unknown): SocketTag | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const t = raw as Partial<SocketTag>;
  if (typeof t.id !== 'string' || typeof t.at !== 'number' || (t.hello !== null && typeof t.hello !== 'string')) return null;
  return { id: t.id, at: t.at, hello: t.hello ?? null };
}

function socketOf(ws: WebSocket): RoomSocket {
  return {
    send(text) {
      try {
        ws.send(text);
      } catch {
        // Closed already: its close is on its way to webSocketClose.
      }
    },
    close(code, reason) {
      try {
        ws.close(code, reason.slice(0, 120));
      } catch {
        // Closed already.
      }
    },
    tag: () => tagOf(ws.deserializeAttachment()),
    setTag: tag => ws.serializeAttachment(tag),
  };
}

/** One game. */
export class GameRoom extends DurableObject<Env> {
  readonly #room: Room;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS session (key TEXT PRIMARY KEY, text TEXT NOT NULL)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room (key TEXT PRIMARY KEY, text TEXT NOT NULL)');
    // A page's keep-alive is answered without waking the object (socket.ts in the client).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.#room = new Room({
      session: tableOf(ctx.storage, 'session'),
      room: tableOf(ctx.storage, 'room'),
      random: { bytes: n => crypto.getRandomValues(new Uint8Array(n)) },
      now: () => Date.now(),
      sockets: () => ctx.getWebSockets().map(socketOf),
      content: id => shelf.get(id),
      log: line => console.log(`game ${ctx.id.toString().slice(0, 12)}: ${line}`),
    });
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/create' && request.method === 'POST') {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json(400, { error: 'The request is not JSON.' });
      }
      const r = this.#room.create(url.searchParams.get('match') ?? '', body);
      if (r.status === 201) await this.ctx.storage.setAlarm(Date.now() + KEEP_MS);
      return json(r.status, r.body);
    }
    if (url.pathname === '/info') {
      const r = this.#room.info();
      return json(r.status, r.body);
    }
    if (url.pathname === '/socket') {
      if (!this.#room.made) return json(404, { error: 'There is no such game.' });
      const pair = new WebSocketPair();
      const [page, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server);
      this.#room.accept(socketOf(server));
      await this.ctx.storage.setAlarm(Date.now() + KEEP_MS);
      return new Response(null, { status: 101, webSocket: page });
    }
    return json(404, { error: 'Nothing here.' });
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    this.#room.message(socketOf(ws), typeof message === 'string' ? message : new TextDecoder().decode(message));
  }

  override webSocketClose(ws: WebSocket, code: number, reason: string): void {
    this.#room.closed(socketOf(ws));
    // The close handshake's answer (1005 and 1006 are never sent).
    socketOf(ws).close(code === 1005 || code === 1006 ? 1000 : code, reason);
  }

  override webSocketError(ws: WebSocket): void {
    this.#room.closed(socketOf(ws));
  }

  /** Fourteen days after the game was last opened: deleted, unless a page has it open now. */
  override async alarm(): Promise<void> {
    if (this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + KEEP_MS);
      return;
    }
    this.#room.forget();
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
}
