/**
 * One WebSocket to the game server, opened again by itself whenever it is lost, after a wait that
 * grows (half a second, then 1, 2, 4, 8 and at most 15 seconds, each a little shorter or longer at
 * random so that two pages do not knock together), and at once when the browser says it is back
 * online or the tab is looked at again. It knows nothing of the protocol: the seat's transport
 * (online.ts) hands it each message to send and takes each one that comes.
 *
 * A quiet connection is checked every 25 seconds: the page sends `ping` and the server's object
 * answers `pong` without waking (worker/src/index.ts). No answer within 10 seconds, and the socket
 * is taken for lost (a laptop that slept leaves one that looks open and is not).
 */

export type LinkState = 'connecting' | 'open' | 'retrying' | 'stopped';

export interface LinkOptions {
  /** The socket's address (ws:// or wss://). */
  readonly address: string;
  /** The socket is open: `send` sends one message on it. */
  open(send: (text: string) => void): void;
  /** One message from the server. */
  message(text: string): void;
  /** The socket is gone, with the close code the server gave (1006 when there was none). */
  closed(code: number): void;
  /** The link's state changed. */
  state(s: LinkState): void;
}

const WAITS_MS = [500, 1000, 2000, 4000, 8000, 15000];
const PING_MS = 25000;
const PONG_MS = 10000;

/** A factor from 0.8 to 1.2, from the platform's random bytes. */
function jitter(): number {
  const b = new Uint8Array(1);
  crypto.getRandomValues(b);
  return 0.8 + (0.4 * (b[0] as number)) / 255;
}

export class SocketLink {
  readonly #o: LinkOptions;
  #ws: WebSocket | null = null;
  #state: LinkState = 'connecting';
  #tries = 0;
  #retry = 0;
  #ping = 0;
  #pong = 0;
  #stopped = false;
  readonly #now = (): void => {
    if (this.#state === 'retrying') this.#connect();
  };
  readonly #seen = (): void => {
    if (document.visibilityState === 'visible') this.#now();
  };

  constructor(o: LinkOptions) {
    this.#o = o;
    window.addEventListener('online', this.#now);
    document.addEventListener('visibilitychange', this.#seen);
  }

  get state(): LinkState {
    return this.#state;
  }

  start(): void {
    if (this.#stopped || this.#ws) return;
    this.#connect();
  }

  /** Close the socket and open no other. */
  stop(): void {
    this.#stopped = true;
    window.clearTimeout(this.#retry);
    this.#quiet();
    window.removeEventListener('online', this.#now);
    document.removeEventListener('visibilitychange', this.#seen);
    const ws = this.#ws;
    this.#ws = null;
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      ws.onopen = null;
      ws.close(1000, 'left');
    }
    this.#set('stopped');
  }

  #set(s: LinkState): void {
    if (this.#state === s) return;
    this.#state = s;
    this.#o.state(s);
  }

  #connect(): void {
    if (this.#stopped) return;
    window.clearTimeout(this.#retry);
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.#o.address);
    } catch {
      this.#lost(1006);
      return;
    }
    this.#ws = ws;
    ws.onopen = () => {
      if (this.#ws !== ws) return;
      this.#tries = 0;
      this.#set('open');
      this.#beat(ws);
      this.#o.open(text => {
        if (this.#ws === ws && ws.readyState === WebSocket.OPEN) ws.send(text);
      });
    };
    ws.onmessage = e => {
      if (this.#ws !== ws || typeof e.data !== 'string') return;
      this.#heard();
      if (e.data !== 'pong') this.#o.message(e.data);
    };
    ws.onclose = e => {
      if (this.#ws !== ws) return;
      this.#lost(e.code);
    };
  }

  /** The socket is lost: say so, and try again after the next wait. */
  #lost(code: number): void {
    this.#quiet();
    const ws = this.#ws;
    this.#ws = null;
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      ws.onopen = null;
      try {
        ws.close();
      } catch {
        // already closed
      }
    }
    this.#o.closed(code);
    if (this.#stopped) return;
    this.#set('retrying');
    const wait = (WAITS_MS[Math.min(this.#tries, WAITS_MS.length - 1)] as number) * jitter();
    this.#tries += 1;
    this.#retry = window.setTimeout(() => this.#connect(), wait);
  }

  /** Every PING_MS while open: a ping; no word from the server within PONG_MS after it, and the socket is lost. */
  #beat(ws: WebSocket): void {
    this.#quiet();
    this.#ping = window.setInterval(() => {
      if (this.#ws !== ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send('ping');
      if (this.#pong === 0) {
        this.#pong = window.setTimeout(() => {
          this.#pong = 0;
          if (this.#ws === ws) this.#lost(1006);
        }, PONG_MS);
      }
    }, PING_MS);
  }

  /** The server has said something: the connection is alive. */
  #heard(): void {
    window.clearTimeout(this.#pong);
    this.#pong = 0;
  }

  #quiet(): void {
    window.clearInterval(this.#ping);
    this.#ping = 0;
    this.#heard();
  }
}
