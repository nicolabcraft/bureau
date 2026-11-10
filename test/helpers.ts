/** Shared helpers for the tests: temp folders, a fake Boite core, raw HTTP and polling. */
import { mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ThreadRow } from '../src/core-types';

export const TOKEN = 'test-token';

const made: string[] = [];
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bureau-test-'));
  made.push(dir);
  return dir;
}
export function cleanTempDirs(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export function thread(id: string, extra: Partial<ThreadRow> = {}): ThreadRow {
  return {
    id,
    projectId: null,
    title: `Fil ${id}`,
    providerId: 'claude',
    model: 'claude-sonnet-5-5',
    status: 'idle',
    archived: false,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...extra,
  };
}

export async function waitFor<T>(check: () => T | undefined | null | false, what: string, timeoutMs = 3_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

type Handler = (params: unknown) => unknown;

export interface FakeCore {
  url: string;
  calls: { method: string; params: unknown }[];
  /** Pushes an event to every connected client. */
  emit(event: string, params: unknown): void;
  /** Replaces or adds a method handler. */
  on(method: string, handler: Handler): void;
  clients(): number;
  stop(): void;
}

/** A local WebSocket server that answers `hello` and the methods in `handlers`, like the core's /rpc. */
export function fakeCore(handlers: Record<string, Handler> = {}): FakeCore {
  const calls: FakeCore['calls'] = [];
  const sockets = new Set<{ send(text: string): void }>();
  const table = new Map(Object.entries(handlers));
  const server = Bun.serve<undefined>({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req, srv) {
      if (new URL(req.url).pathname === '/rpc' && srv.upgrade(req)) return undefined;
      return new Response('not found', { status: 404 });
    },
    websocket: {
      open(ws) {
        sockets.add(ws);
      },
      close(ws) {
        sockets.delete(ws);
      },
      message(ws, message) {
        const frame = JSON.parse(String(message)) as { id: number; method: string; params: Record<string, unknown> };
        if (frame.method === 'hello') {
          if (frame.params.token !== TOKEN || frame.params.protocolVersion !== 2) {
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: -32001, message: 'unauthorized' } }));
            ws.close();
            return;
          }
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { core: { protocolVersion: 2 }, principal: 'plugin' } }));
          return;
        }
        calls.push({ method: frame.method, params: frame.params });
        const handler = table.get(frame.method);
        if (!handler) {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: -32601, message: `no method ${frame.method}` } }));
          return;
        }
        try {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: handler(frame.params) }));
        } catch (error) {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: -32010, message: error instanceof Error ? error.message : String(error) } }));
        }
      },
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    calls,
    emit(event, params) {
      for (const socket of sockets) socket.send(JSON.stringify({ jsonrpc: '2.0', method: event, params }));
    },
    on(method, handler) {
      table.set(method, handler);
    },
    clients: () => sockets.size,
    stop() {
      void server.stop(true);
    },
  };
}

/** One raw HTTP/1.1 exchange, for requests `fetch` will not send (a foreign Host header). */
export function rawHttp(port: number, lines: string[]): Promise<{ status: number; head: string; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => (data += chunk));
    socket.on('error', reject);
    socket.on('close', () => {
      const [head = '', body = ''] = data.split('\r\n\r\n');
      resolve({ status: Number(/^HTTP\/1\.1 (\d{3})/.exec(head)?.[1] ?? 0), head, body });
    });
    socket.write(`${lines.join('\r\n')}\r\n\r\n`);
  });
}

export function capture(): { io: { out(line: string): void; err(line: string): void }; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (line) => out.push(line), err: (line) => err.push(line) }, out, err };
}
