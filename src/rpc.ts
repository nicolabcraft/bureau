/*
 * A small JSON-RPC 2.0 client for Boite's core, over the WebSocket at
 * `<core>/rpc` (protocol 2). It says `hello` with the plugin's token, then
 * sends calls and hands events to listeners. The service lets it reconnect by
 * itself, waiting longer after each failure (1, 2, 5, then 10 seconds); a
 * command connects once and gives up. Modelled on Boite's plugin SDK
 * (MIT, packages/plugin-sdk), which is not on npm.
 */
import type { CoreEvents, CoreMethods } from './core-types';

export const PROTOCOL_VERSION = 2;
const RETRY_MS = [1_000, 2_000, 5_000, 10_000];
const HELLO_TIMEOUT_MS = 5_000;
const CALL_TIMEOUT_MS = 60_000;
/** A text frame that starts with this is one slice of a chunked answer, only sent to a request that asks for `progress`. */
const CHUNK_MARK = '\u001e';

export type ConnectionState = 'connecting' | 'ready' | 'closed';

/** An error the core answered: its message and its JSON-RPC code. */
export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface CoreClientOptions {
  /** The core's base URL, `http://host:port`. */
  url: string;
  token: string;
  version: string;
  /** Reconnect with a growing wait after a failure. Default true. */
  reconnect?: boolean;
}

/** `http://host:port` to `ws://host:port/rpc`. */
export function rpcUrl(coreUrl: string): string {
  const url = new URL(coreUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/rpc';
  url.search = '';
  return url.toString();
}

export class CoreClient {
  #options: CoreClientOptions;
  #socket: WebSocket | null = null;
  #nextId = 1;
  #pending = new Map<number, Pending>();
  #listeners = new Map<string, Set<(params: unknown) => void>>();
  #stateListeners = new Set<(state: ConnectionState, error?: string) => void>();
  #attempt = 0;
  #stopped = true;
  #retry: ReturnType<typeof setTimeout> | null = null;
  state: ConnectionState = 'closed';
  /** The last failure, for a message that says why the core is out of reach. */
  lastError: string | undefined;

  constructor(options: CoreClientOptions) {
    this.#options = options;
  }

  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#open();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#retry) clearTimeout(this.#retry);
    this.#retry = null;
    const socket = this.#socket;
    this.#socket = null;
    this.#failPending(new Error('La connexion à Boite est fermée.'));
    try {
      socket?.close();
    } catch {
      // Already closed.
    }
    this.#setState('closed');
  }

  onState(listener: (state: ConnectionState, error?: string) => void): () => void {
    this.#stateListeners.add(listener);
    return () => this.#stateListeners.delete(listener);
  }

  on<E extends keyof CoreEvents>(event: E, listener: (payload: CoreEvents[E]) => void): () => void {
    const set = this.#listeners.get(event) ?? new Set();
    const wrapped = (params: unknown) => listener(params as CoreEvents[E]);
    set.add(wrapped);
    this.#listeners.set(event, set);
    return () => set.delete(wrapped);
  }

  /** Resolves once the hello is accepted; rejects when the connection fails or after `timeoutMs`. */
  waitReady(timeoutMs = HELLO_TIMEOUT_MS + 1_000): Promise<void> {
    if (this.state === 'ready') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => done(new Error('Boite ne répond pas.')), timeoutMs);
      const off = this.onState((state, error) => {
        if (state === 'ready') done();
        else if (state === 'closed') done(new Error(error ?? this.lastError ?? 'Boite est injoignable.'));
      });
      const done = (error?: Error) => {
        clearTimeout(timer);
        off();
        if (error) reject(error);
        else resolve();
      };
    });
  }

  call<M extends keyof CoreMethods>(method: M, params: CoreMethods[M]['params']): Promise<CoreMethods[M]['result']> {
    if (this.state !== 'ready') return Promise.reject(new Error('Bureau n\'est pas connecté à Boite.'));
    return this.#send(method, params) as Promise<CoreMethods[M]['result']>;
  }

  #send(method: string, params: unknown, timeoutMs = CALL_TIMEOUT_MS): Promise<unknown> {
    const socket = this.#socket;
    if (!socket) return Promise.reject(new Error('Bureau n\'est pas connecté à Boite.'));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method} a pris plus de ${Math.round(timeoutMs / 1000)} s.`));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  #setState(state: ConnectionState, error?: string): void {
    this.state = state;
    if (error !== undefined) this.lastError = error;
    for (const listener of [...this.#stateListeners]) listener(state, error);
  }

  #failPending(error: Error): void {
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.#pending.delete(id);
    }
  }

  #open(): void {
    this.#setState('connecting');
    let socket: WebSocket;
    try {
      socket = new WebSocket(rpcUrl(this.#options.url));
    } catch (error) {
      this.#failed(error instanceof Error ? error.message : String(error));
      return;
    }
    this.#socket = socket;
    socket.onopen = () => {
      this.#send(
        'hello',
        { token: this.#options.token, protocolVersion: PROTOCOL_VERSION, client: { name: 'plugin', version: this.#options.version } },
        HELLO_TIMEOUT_MS
      ).then(
        () => {
          this.#attempt = 0;
          this.#setState('ready');
        },
        (error: Error) => {
          // The close handler below schedules the retry.
          this.lastError = error.message;
          socket.close();
        }
      );
    };
    socket.onmessage = (event) => this.#receive(String(event.data));
    socket.onerror = () => {
      // The matching `close` event follows and carries the retry.
    };
    socket.onclose = () => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      this.#failPending(new Error('Boite a fermé la connexion.'));
      this.#failed(this.lastError ?? 'Boite est injoignable.');
    };
  }

  #failed(message: string): void {
    if (this.#stopped) return;
    this.#setState('closed', message);
    if (this.#options.reconnect === false) {
      this.#stopped = true;
      return;
    }
    const wait = RETRY_MS[Math.min(this.#attempt, RETRY_MS.length - 1)] ?? 10_000;
    this.#attempt++;
    this.#retry = setTimeout(() => {
      this.#retry = null;
      if (!this.#stopped) this.#open();
    }, wait);
  }

  #receive(text: string): void {
    if (text.startsWith(CHUNK_MARK)) return;
    let frame: { id?: number; method?: string; params?: unknown; result?: unknown; error?: { code?: number; message?: string; data?: unknown } };
    try {
      frame = JSON.parse(text);
    } catch {
      return;
    }
    if (frame === null || typeof frame !== 'object') return;
    if (typeof frame.id === 'number') {
      const pending = this.#pending.get(frame.id);
      if (!pending) return;
      this.#pending.delete(frame.id);
      clearTimeout(pending.timer);
      if (frame.error) pending.reject(new RpcError(frame.error.code ?? 0, frame.error.message ?? 'Erreur de Boite.', frame.error.data));
      else pending.resolve(frame.result);
      return;
    }
    if (typeof frame.method === 'string') {
      for (const listener of this.#listeners.get(frame.method) ?? []) {
        // One listener that throws must not break the others or the socket.
        try {
          listener(frame.params);
        } catch (error) {
          console.error(`bureau: un écouteur de ${frame.method} a échoué :`, error);
        }
      }
    }
  }
}
