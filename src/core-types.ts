/**
 * The small part of Boite's core contracts Bureau reads. Copied by hand from
 * `packages/contracts/src` (threads.ts, projects.ts, plugins.ts) because the
 * contracts package is not on npm; only the fields Bureau uses are typed.
 */

export type ThreadStatus = 'idle' | 'queued' | 'running' | 'waiting' | 'error';

/** The fields of Boite's `ThreadSummary` that Bureau reads. */
export interface ThreadRow {
  id: string;
  projectId: string | null;
  title: string;
  providerId: string;
  model: string | null;
  status: ThreadStatus;
  runningSince?: number | null;
  requestSince?: number | null;
  /** Questions the agent asked without stopping that still wait for the user. */
  openQuestions?: number;
  archived: boolean;
  /** Pinned by the user (Boite's threads.pin); absent or false otherwise. */
  pinned?: boolean;
  /** Core-owned delegation relationship: the thread that delegated to this one. */
  parentThreadId?: string | null;
  /** A team's chat: it runs no agent. */
  teamId?: string;
  /** A council's salon: it runs no agent. */
  councilId?: string;
  incognito?: true;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectRow {
  id: string;
  name: string;
  path: string;
}

/** The RPC methods Bureau calls, with the params and results it uses. */
export interface CoreMethods {
  'threads.list': { params: { includeArchived?: boolean }; result: ThreadRow[] };
  'projects.list': { params: Record<string, never>; result: ProjectRow[] };
  /** Open to plugins granted threads.write; archive only (see archive.ts, CORE_ARCHIVE_OPEN). */
  'threads.archive': { params: { threadId: string; archived?: boolean; onlyIfIdle?: boolean }; result: unknown };
  'turns.start': { params: { threadId: string; prompt: string }; result: unknown };
  'turns.stop': { params: { threadId: string }; result: { stopped: boolean } };
  'ui.reveal': { params: { target: { kind: 'thread'; threadId: string } }; result: { delivered: number } };
}

/** The events Bureau listens to (they arrive without a subscription). */
export interface CoreEvents {
  'thread.created': ThreadRow;
  'thread.updated': ThreadRow;
  'thread.removed': { threadId: string };
}
