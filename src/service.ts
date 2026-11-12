/*
 * The Bureau service: connects to Boite's core, keeps the threads and the
 * registry in memory, serves the view and its API on 127.0.0.1, and pushes a
 * full `OfficeState` snapshot to every open page on each change.
 */
import { mkdirSync, unlinkSync, watch, writeFileSync, readFileSync, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import type { ProjectRow, ThreadRow } from './core-types';
import { CoreClient, RpcError } from './rpc';
import { buildState } from './state';
import { appendJournal, coreArchiver, readJournal, readSettings, recentNotes, runArchivePass, trimJournal, type Archiver, type JournalEntry, type PassResult } from './archive';
import type { OfficeState } from './model';
import { markValidated, parseRegistry, readRegistryText, REGISTRY_FILE, RegistryError, updateRegistry, validationPrompt, emptyRegistry, type Notice, type Registry } from './registry';

export const DEFAULT_PORT = 47317;
const PORT_TRIES = 100;
/** A notice a chef never became idle for is dropped after this long. */
const NOTICE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;

export interface ServiceOptions {
  dataDir: string;
  /** The view (see src/page.ts), or a function that builds it on each request (the demo, to pick up edits). */
  page: string | (() => string);
  version: string;
  /** Core base URL and plugin token. Without them the service runs with the core "disconnected". */
  coreUrl?: string;
  token?: string;
  /** First port to try; the next free one is taken when it is busy. 0 lets the system choose. */
  port?: number;
  debounceMs?: number;
  pingMs?: number;
  /** Interval of the registry re-read that backs up `fs.watch`. */
  pollMs?: number;
  /** Time between two automatic archiving passes. Default 10 minutes. 0 turns the timer off (`archiveNow` still works). */
  archiveEveryMs?: number;
  /** How a thread is archived. Default: Boite's `threads.archive` while it is open to plugins, otherwise none. */
  archiver?: Archiver | null;
  log?: (message: string) => void;
}

export interface Service {
  port: number;
  url: string;
  snapshot(): OfficeState;
  /** One archiving pass with the current settings. A dry run only lists. Passes never overlap. */
  archiveNow(options?: { dryRun?: boolean; mode?: 'auto' | 'manuel' }): Promise<PassResult>;
  stop(): Promise<void>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};
const PAGE_CSP = "default-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS } });
const fail = (status: number, message: string): Response => json(status, { error: message });

export async function startService(options: ServiceOptions): Promise<Service> {
  const { dataDir } = options;
  const log = options.log ?? ((message: string) => console.error(`[bureau] ${message}`));
  const debounceMs = options.debounceMs ?? 250;
  const pingMs = options.pingMs ?? 20_000;
  const pollMs = options.pollMs ?? 2_000;
  mkdirSync(dataDir, { recursive: true });

  // ---- State held in memory ------------------------------------------------
  const threads = new Map<string, ThreadRow>();
  let projects: ProjectRow[] = [];
  let registry: Registry = emptyRegistry();
  let registryText: string | null = null;
  let coreStatus: OfficeState['core'] = options.coreUrl && options.token ? 'connecting' : 'disconnected';
  let everFailed = false;
  let stopped = false;
  let client: CoreClient | null = null;

  let archiveNotes = recentNotes(readJournal(dataDir, 100), Date.now());
  const snapshot = (): OfficeState =>
    buildState({ threads: threads.values(), projects, registry, core: coreStatus, now: Date.now(), live: true, archives: archiveNotes });

  // ---- Server-sent events ----------------------------------------------------
  const encoder = new TextEncoder();
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const send = (controller: ReadableStreamDefaultController<Uint8Array>, chunk: string) => {
    try {
      controller.enqueue(encoder.encode(chunk));
    } catch {
      clients.delete(controller);
    }
  };
  const stateEvent = () => `event: state\ndata: ${JSON.stringify(snapshot())}\n\n`;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  /** Something changed: tell every page, at most once per debounce window. */
  const changed = () => {
    if (debounce || stopped) return;
    debounce = setTimeout(() => {
      debounce = null;
      if (clients.size === 0) return;
      const chunk = stateEvent();
      for (const client of [...clients]) send(client, chunk);
    }, debounceMs);
  };
  const pinger = setInterval(() => {
    for (const client of [...clients]) send(client, ': ping\n\n');
  }, pingMs);

  // ---- Registry --------------------------------------------------------------
  /** Re-reads the file when its text changed. Returns whether it did. */
  const reloadRegistry = (): boolean => {
    let text: string;
    try {
      text = readRegistryText(dataDir);
    } catch (error) {
      log(`lecture du registre impossible : ${String(error)}`);
      return false;
    }
    if (text === registryText) return false;
    registryText = text;
    try {
      registry = parseRegistry(text);
    } catch (error) {
      // Keep the last good registry; the message says how to repair the file.
      log(error instanceof RegistryError ? error.message : String(error));
      return false;
    }
    changed();
    void flushNotices();
    return true;
  };
  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(dataDir, { persistent: false }, (_event, file) => {
      if (file === null || file === undefined || String(file) === REGISTRY_FILE) reloadRegistry();
    });
    watcher.on('error', () => {});
  } catch (error) {
    log(`surveillance du dossier impossible, relecture toutes les ${pollMs} ms seulement : ${String(error)}`);
  }
  const poller = setInterval(reloadRegistry, pollMs);

  // ---- Notices for a busy chef -----------------------------------------------
  const sentNotices = new Set<string>();
  const noticeKey = (notice: Notice) => `${notice.threadId}|${notice.at}|${notice.prompt}`;
  let flushRun: Promise<void> | null = null;
  let flushAgain = false;
  /** Sends the notices whose chef is idle. A call during a run asks for one more pass and waits for the run. */
  function flushNotices(): Promise<void> {
    if (flushRun) {
      flushAgain = true;
      return flushRun;
    }
    flushRun = (async () => {
      // Let the caller store `flushRun` before anything can finish.
      await Promise.resolve();
      try {
        do {
          flushAgain = false;
          if (stopped || !client || client.state !== 'ready' || coreStatus !== 'connected') break;
          for (const notice of [...registry.pendingNotices]) {
            const key = noticeKey(notice);
            const expired = Date.now() - notice.at > NOTICE_TTL_MS;
            if (!expired && !sentNotices.has(key)) {
              const thread = threads.get(notice.threadId);
              // Wait for the chef to be at rest: turns.start on a busy thread is refused.
              if (!thread || thread.status !== 'idle') continue;
              try {
                await client.call('turns.start', { threadId: notice.threadId, prompt: notice.prompt });
                sentNotices.add(key);
              } catch (error) {
                log(`message au chef ${notice.threadId} refusé, nouvel essai quand il sera au repos : ${error instanceof Error ? error.message : String(error)}`);
                continue;
              }
            }
            try {
              await updateRegistry(dataDir, (reg) => {
                reg.pendingNotices = reg.pendingNotices.filter((entry) => noticeKey(entry) !== key);
              });
            } catch (error) {
              log(`registre : ${error instanceof Error ? error.message : String(error)}`);
            }
            reloadRegistry();
          }
        } while (flushAgain);
      } finally {
        flushRun = null;
      }
    })();
    return flushRun;
  }

  // ---- Core connection -------------------------------------------------------
  let loading = false;
  let buffered: (() => void)[] = [];
  let loadRetry: ReturnType<typeof setTimeout> | null = null;

  const applyEvent = (apply: () => void) => {
    if (loading) buffered.push(apply);
    else apply();
    changed();
  };

  async function loadAll(): Promise<void> {
    if (!client) return;
    loading = true;
    buffered = [];
    try {
      const [rows, projectRows] = await Promise.all([client.call('threads.list', {}), client.call('projects.list', {})]);
      threads.clear();
      for (const row of rows) threads.set(row.id, row);
      projects = projectRows;
      unknownProjects.clear();
      // Events that arrived while the lists were on their way are newer than the lists.
      for (const apply of buffered) apply();
      coreStatus = 'connected';
      log(`connecté à Boite : ${rows.length} fils, ${projectRows.length} projets`);
    } catch (error) {
      log(`lecture des fils impossible : ${error instanceof Error ? error.message : String(error)}`);
      if (client?.state === 'ready' && !stopped) loadRetry = setTimeout(() => void loadAll(), 5_000);
      return;
    } finally {
      loading = false;
      buffered = [];
    }
    changed();
    void flushNotices();
  }

  /** Project ids that projects.list did not know when asked: not asked again for them until the next full load. */
  const unknownProjects = new Set<string>();
  let projectsRun: Promise<void> | null = null;
  /** Boite sends no project event: a thread in a project we do not know asks for projects.list again. */
  function refreshProjectsFor(row: ThreadRow): Promise<void> {
    const id = row.projectId;
    if (id === null || id === undefined || projects.some((project) => project.id === id) || unknownProjects.has(id)) return Promise.resolve();
    if (projectsRun) return projectsRun;
    projectsRun = (async () => {
      try {
        if (!client || client.state !== 'ready') return;
        const rows = await client.call('projects.list', {});
        if (stopped) return;
        projects = rows;
        if (!rows.some((project) => project.id === id)) unknownProjects.add(id);
        changed();
      } catch (error) {
        log(`lecture des projets impossible : ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        projectsRun = null;
      }
    })();
    return projectsRun;
  }

  if (options.coreUrl && options.token) {
    client = new CoreClient({ url: options.coreUrl, token: options.token, version: options.version });
    client.on('thread.created', (row) => {
      applyEvent(() => void threads.set(row.id, row));
      void refreshProjectsFor(row);
    });
    client.on('thread.updated', (row) => {
      applyEvent(() => void threads.set(row.id, row));
      void flushNotices();
      void refreshProjectsFor(row);
    });
    client.on('thread.removed', ({ threadId }) => applyEvent(() => void threads.delete(threadId)));
    client.onState((state) => {
      if (stopped) return;
      if (state === 'ready') {
        void loadAll();
        return;
      }
      if (loadRetry) clearTimeout(loadRetry);
      loadRetry = null;
      if (state === 'closed') everFailed = true;
      const next = state === 'connecting' && !everFailed ? 'connecting' : 'disconnected';
      if (next !== coreStatus) {
        coreStatus = next;
        changed();
      }
    });
    client.start();
  }

  // ---- Archiving -------------------------------------------------------------
  /** Threads Boite refused to archive in this run: not retried until the service restarts. */
  const refused = new Set<string>();
  let archiveRun: Promise<PassResult> | null = null;
  const archiver = (): Archiver | null => (options.archiver !== undefined ? options.archiver : client ? coreArchiver(client) : null);
  const emptyPass = (dryRun: boolean): PassResult => ({ decisions: [], candidates: [], archived: [], failed: [], dryRun, unavailable: false });

  function archiveNow(opts: { dryRun?: boolean; mode?: 'auto' | 'manuel' } = {}): Promise<PassResult> {
    const dryRun = opts.dryRun === true;
    if (archiveRun) return archiveRun.then(() => archiveNow(opts));
    const run = (async (): Promise<PassResult> => {
      if (stopped || coreStatus !== 'connected') return emptyPass(dryRun);
      // The registry decides which threads are in a Bureau team: read it now, not at the next poll.
      reloadRegistry();
      const now = Date.now();
      const result = await runArchivePass({
        threads: threads.values(),
        skip: refused,
        projects,
        registry,
        settings: readSettings(dataDir),
        now,
        mode: opts.mode ?? 'auto',
        dryRun,
        archiver: archiver(),
        record: (entry: JournalEntry) => {
          try {
            appendJournal(dataDir, entry);
          } catch (error) {
            log(`journal d'archivage illisible : ${String(error)}`);
          }
          if (entry.ok) {
            archiveNotes = recentNotes(readJournal(dataDir, 100), now);
          } else {
            refused.add(entry.threadId);
            log(`archivage de ${entry.threadId} refusé par Boite : ${entry.error ?? 'raison inconnue'}`);
          }
        },
      });
      if (!dryRun) {
        try {
          trimJournal(dataDir);
        } catch {
          // A journal that cannot be trimmed is only bigger than wanted.
        }
        if (result.unavailable) log(`archivage : ${result.candidates.length} fil(s) à archiver, mais l'archivage réel est coupé dans Bureau (CORE_ARCHIVE_OPEN).`);
        if (result.archived.length > 0) changed();
      }
      return result;
    })();
    archiveRun = run;
    const clear = () => {
      if (archiveRun === run) archiveRun = null;
    };
    run.then(clear, clear);
    return run;
  }
  const archiveEveryMs = options.archiveEveryMs ?? 10 * 60 * 1000;
  const archiveTimer =
    archiveEveryMs > 0
      ? setInterval(() => {
          if (readSettings(dataDir).auto) void archiveNow({ mode: 'auto' }).catch((error) => log(`passage d'archivage : ${String(error)}`));
        }, archiveEveryMs)
      : null;

  // ---- Actions ---------------------------------------------------------------
  const needCore = (): CoreClient => {
    if (!client || client.state !== 'ready' || coreStatus !== 'connected') {
      throw new HttpError(503, 'Bureau n\'est pas connecté à Boite : relance le service (Réglages > Plugins > Bureau > Redémarrer).');
    }
    return client;
  };
  const threadIdOf = (body: unknown): string => {
    const id = (body as { threadId?: unknown } | null)?.threadId;
    if (typeof id !== 'string' || id === '' || id.length > 200) throw new HttpError(400, 'Le corps doit être { "threadId": "<id du fil>" }.');
    if (!threads.has(id)) throw new HttpError(404, 'Fil inconnu : il a peut-être été supprimé.');
    return id;
  };
  const viaCore = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      if (error instanceof RpcError) throw new HttpError(502, `Boite a refusé : ${error.message}`);
      throw new HttpError(502, error instanceof Error ? error.message : String(error));
    }
  };

  async function act(path: string, body: unknown): Promise<unknown> {
    if (path === '/api/reveal') {
      const threadId = threadIdOf(body);
      const core = needCore();
      const result = await viaCore(() => core.call('ui.reveal', { target: { kind: 'thread', threadId } }));
      return { ok: true, delivered: result.delivered };
    }
    if (path === '/api/stop') {
      const threadId = threadIdOf(body);
      const core = needCore();
      const result = await viaCore(() => core.call('turns.stop', { threadId }));
      return { ok: true, stopped: result.stopped };
    }
    const match = /^\/api\/missions\/([^/]+)\/validate$/.exec(path);
    if (match) {
      let missionId: string;
      try {
        missionId = decodeURIComponent(match[1]!);
      } catch {
        throw new HttpError(400, 'Identifiant de mission illisible.');
      }
      try {
        await updateRegistry(dataDir, (reg) => {
          const mission = reg.missions[missionId];
          if (!mission) throw new HttpError(404, `Mission inconnue : ${missionId}.`);
          if (mission.status === 'done') throw new HttpError(409, 'Cette mission est terminée : rien à valider.');
          if (mission.status === 'validated') return;
          markValidated(mission, 'bureau');
          reg.pendingNotices.push({ threadId: mission.chefId, prompt: validationPrompt(missionId), at: Date.now() });
        });
      } catch (error) {
        if (error instanceof RegistryError) throw new HttpError(503, error.message);
        throw error;
      }
      reloadRegistry();
      await flushNotices();
      const waiting = registry.pendingNotices.some((notice) => notice.prompt === validationPrompt(missionId));
      return { ok: true, notified: !waiting };
    }
    throw new HttpError(404, 'Route inconnue.');
  }

  // ---- HTTP ------------------------------------------------------------------
  let port = 0;
  const origin = () => `http://127.0.0.1:${port}`;

  const handle = async (req: Request, server: ReturnType<typeof Bun.serve>): Promise<Response> => {
    // DNS rebinding guard: a page on another name that resolves to 127.0.0.1 sends another Host.
    if (req.headers.get('host') !== `127.0.0.1:${port}`) return fail(403, 'Hôte refusé : utilise http://127.0.0.1:' + port + '/.');
    const path = new URL(req.url).pathname;
    const isApi = path.startsWith('/api/');

    if (req.method === 'POST') {
      if (req.headers.get('x-bureau') !== '1') return fail(403, 'En-tête X-Bureau: 1 manquant.');
      const from = req.headers.get('origin');
      if (from !== null && from !== origin()) return fail(403, 'Origine refusée.');
      if (!isApi) return fail(404, 'Route inconnue.');
      let body: unknown = null;
      const raw = await req.text();
      if (raw.length > MAX_BODY_BYTES) return fail(413, 'Corps trop grand.');
      if (raw.trim() !== '') {
        try {
          body = JSON.parse(raw);
        } catch {
          return fail(400, 'Corps JSON invalide.');
        }
      }
      try {
        return json(200, await act(path, body));
      } catch (error) {
        if (error instanceof HttpError) return fail(error.status, error.message);
        log(`action ${path} : ${String(error)}`);
        return fail(500, 'Erreur interne de Bureau.');
      }
    }

    if (req.method !== 'GET') return fail(405, 'Méthode non permise.');
    if (path === '/') {
      return new Response(typeof options.page === 'function' ? options.page() : options.page, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PAGE_CSP, ...SECURITY_HEADERS } });
    }
    // No icon: answer empty rather than log a 404 in the browser on every load.
    if (path === '/favicon.ico') return new Response(null, { status: 204, headers: SECURITY_HEADERS });
    if (path === '/api/state') return json(200, snapshot());
    if (path === '/api/events') {
      server.timeout(req, 0);
      let self: ReadableStreamDefaultController<Uint8Array> | null = null;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          self = controller;
          clients.add(controller);
          send(controller, stateEvent());
        },
        cancel() {
          if (self) clients.delete(self);
        },
      });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive', ...SECURITY_HEADERS } });
    }
    if (isApi || path === '/') return fail(404, 'Route inconnue.');
    return fail(404, 'Page introuvable.');
  };

  const wanted = options.port ?? DEFAULT_PORT;
  let server: ReturnType<typeof Bun.serve> | null = null;
  for (let offset = 0; offset < (wanted === 0 ? 1 : PORT_TRIES); offset++) {
    try {
      server = Bun.serve({
        hostname: '127.0.0.1',
        port: wanted === 0 ? 0 : wanted + offset,
        idleTimeout: 60,
        maxRequestBodySize: MAX_BODY_BYTES * 2,
        fetch: (req, srv) => handle(req, srv).catch((error) => {
          log(`requête ${req.method} : ${String(error)}`);
          return fail(500, 'Erreur interne de Bureau.');
        }),
      });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' && !String(error).includes('in use')) throw error;
    }
  }
  if (!server) {
    clearInterval(pinger);
    clearInterval(poller);
    if (archiveTimer) clearInterval(archiveTimer);
    watcher?.close();
    client?.stop();
    throw new Error(`Aucun port libre entre ${wanted} et ${wanted + PORT_TRIES - 1}.`);
  }
  port = server.port ?? 0;
  const portFile = join(dataDir, 'port');
  writeFileSync(portFile, String(port));
  log(`vue sur ${origin()}/`);

  return {
    port,
    url: `${origin()}/`,
    snapshot,
    archiveNow,
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(pinger);
      clearInterval(poller);
      if (archiveTimer) clearInterval(archiveTimer);
      if (debounce) clearTimeout(debounce);
      if (loadRetry) clearTimeout(loadRetry);
      watcher?.close();
      client?.stop();
      for (const controller of [...clients]) {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
      clients.clear();
      await server.stop(true);
      try {
        if (readFileSync(portFile, 'utf8') === String(port)) unlinkSync(portFile);
      } catch {
        // The file is gone or belongs to a newer instance.
      }
    },
  };
}
