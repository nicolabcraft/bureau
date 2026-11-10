/**
 * The data contract between Bureau's service and its web view.
 * The service builds an `OfficeState` from Boite's threads and from Bureau's
 * own registry (roles, missions, reports), and the view only draws it.
 */

/** What a character is doing, derived from a Boite thread. */
export type AgentState =
  /** A turn runs. */
  | 'running'
  /** A turn waits for a scheduler slot. */
  | 'queued'
  /** The agent waits for the user: a permission request or an open question. */
  | 'waiting'
  /** A root conversation at rest. */
  | 'idle'
  /** A delegated child at rest, or an attached manager at rest after its report: it handed its work back. */
  | 'done'
  | 'error';

export type Role = 'chef' | 'manager' | 'agent';

export interface Report {
  text: string;
  /** Epoch milliseconds. */
  at: number;
}

export interface OfficeAgent {
  /** The Boite thread id. */
  id: string;
  title: string;
  role: Role;
  /** `declared`: the agent ran `boite bureau-role`; `guessed`: from its depth in the delegation tree. A manager attached with `--chef` is `declared`. */
  roleSource: 'declared' | 'guessed';
  /** The service a manager leads or an agent belongs to, e.g. "Développement". Null when unknown. */
  service: string | null;
  /**
   * The thread above this one in the team: the one that delegated to it (`parentThreadId`), or the chef a
   * manager started with `boite thread new` declared with `--chef`. Null for the root.
   */
  parentId: string | null;
  /** Model id as Boite reports it, e.g. "claude-sonnet-5-5". */
  model: string | null;
  /** Boite provider id, e.g. "claude", "codex", "opencode". */
  provider: string;
  state: AgentState;
  /** Why it waits, when `state` is `waiting`. */
  waitingFor: 'permission' | 'question' | null;
  /** Epoch ms the current request started (`requestSince ?? runningSince`), null at rest. */
  since: number | null;
  /** Epoch ms of the thread's last change. */
  updatedAt: number;
  /** Epoch ms the thread was created: the view seats the oldest first, so a newcomer never moves anyone. */
  createdAt: number;
  /** The last report the agent filed with `boite bureau-rapport`. */
  report: Report | null;
  /** Files the manager assigned, as declared with `boite bureau-role --files`. */
  files: string[];
}

export type LotState = 'todo' | 'running' | 'done';

export interface Lot {
  id: string;
  title: string;
  service: string;
  /** The model the chef plans for this lot, e.g. "claude/claude-haiku-5-5". */
  model: string;
  /** The thread doing it once launched. */
  agentId: string | null;
  state: LotState;
}

export interface Mission {
  id: string;
  /** The chef's thread. */
  chefId: string;
  title: string;
  /** A few lines: the goal as the chef understood it. */
  summary: string;
  /** Agent count and model limits the user approves with the plan. */
  budget: { maxAgents: number | null; models: string[] };
  lots: Lot[];
  /** `proposed`: waits for the user; `validated`: lots may start; `done`: the chef handed in the result. */
  status: 'proposed' | 'validated' | 'done';
  createdAt: number;
  validatedAt: number | null;
  /** Where the user validated: the Bureau button, or in the chef's chat. */
  validatedVia: 'bureau' | 'chat' | null;
}

/** One delegation tree: a root conversation and every thread under it. */
export interface Team {
  /** The root thread's id. */
  id: string;
  title: string;
  /** The root thread's project, null when it has none. */
  projectId: string | null;
  projectName: string | null;
  /** Root first, then breadth-first. */
  agents: OfficeAgent[];
  mission: Mission | null;
  /** Epoch ms of the latest change in the tree. */
  lastActivity: number;
}

/** A conversation Bureau archived (see archivage.jsonl). */
export interface ArchiveNote {
  threadId: string;
  title: string;
  /** Why, in French: "au repos depuis 7 h (délai 6 h)". */
  reason: string;
  /** Epoch ms. */
  at: number;
}

/** A Boite project, as projects.list gives it, without its path (the page never sees a path). */
export interface ProjectInfo {
  id: string;
  name: string;
}

export interface OfficeState {
  /** Most recent activity first. Archived threads are left out. */
  teams: Team[];
  /** Every project Boite knows, in projects.list order. The view keeps those that have a team. */
  projects: ProjectInfo[];
  /** Agents in `waiting` across every team. */
  waitingCount: number;
  core: 'connected' | 'connecting' | 'disconnected';
  generatedAt: number;
  /** Conversations archived in the last day, newest first. An archived agent is gone from teams: the view walks it out by the front door. */
  archives: ArchiveNote[];
}

/**
 * HTTP API served on 127.0.0.1 by the service.
 * - GET  /                       the view (web/index.html)
 * - GET  /api/state              OfficeState
 * - GET  /api/events             text/event-stream; `event: state`, data: OfficeState, on every change
 * - POST /api/reveal             { threadId }  shows that conversation in Boite (ui.reveal)
 * - POST /api/stop               { threadId }  stops its turn (turns.stop)
 * - POST /api/missions/:id/validate          marks the plan validated and tells the chef (turns.start)
 * Every POST needs the header `X-Bureau: 1` and, when present, an Origin equal to the page's own;
 * the Host header must be the bound 127.0.0.1:<port>.
 */
export type ApiAction =
  | { kind: 'reveal'; threadId: string }
  | { kind: 'stop'; threadId: string }
  | { kind: 'validate'; missionId: string };
