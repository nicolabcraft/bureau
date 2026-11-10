/*
 * Builds the `OfficeState` the view draws. Pure: threads, projects and the
 * registry in, a state out, no clock and no I/O, so tests feed it plain data.
 */
import type { ProjectRow, ThreadRow } from './core-types';
import type { AgentState, ArchiveNote, OfficeAgent, OfficeState, Mission, ProjectInfo, Report, Role, Team } from './model';
import type { Registry } from './registry';

export interface StateInput {
  threads: Iterable<ThreadRow>;
  projects: Iterable<ProjectRow>;
  registry: Registry;
  core: OfficeState['core'];
  now: number;
  /** Keep only live teams (the view); commands see every team. */
  live?: boolean;
  /** Recent archivings, for . */
  archives?: ArchiveNote[];
}

/** A quiet team stays in the office for a day after its last change. */
export const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** At most this many teams, most recent first. */
export const MAX_TEAMS = 30;
/**
 * A manager files its report as its last act, then its turn ends a few seconds later: a thread change
 * up to this long after the report still belongs to it. Later changes mean the manager worked again.
 */
export const REPORT_GRACE_MS = 2 * 60 * 1000;

/**
 * Has an attached manager handed its work back? With a report on file, only while the thread has not
 * moved on since: a manager that reported and then works again (then rests without a new report) is
 * idle, not done. Without a report, the end of its chef's mission is what says it is done.
 */
export function hasReportedBack(thread: ThreadRow, report: Report | undefined, missionDone: boolean): boolean {
  if (report === undefined) return missionDone;
  return thread.updatedAt <= report.at + REPORT_GRACE_MS;
}

/** Archived threads, team chats, council salons and incognito threads are not part of the office. */
export function isOfficeThread(thread: ThreadRow): boolean {
  return !thread.archived && thread.teamId === undefined && thread.councilId === undefined && thread.incognito !== true;
}

/**
 * `reportedBack` is for a manager attached with a chef link: it has no `parentThreadId`, so a rest
 * after its report (or after the mission is over) is what tells "done" from "waiting for its agents"
 * (see `hasReportedBack`).
 */
export function agentState(thread: ThreadRow, reportedBack = false): { state: AgentState; waitingFor: 'permission' | 'question' | null } {
  if ((thread.openQuestions ?? 0) > 0) return { state: 'waiting', waitingFor: 'question' };
  switch (thread.status) {
    case 'waiting':
      return { state: 'waiting', waitingFor: 'permission' };
    case 'running':
      return { state: 'running', waitingFor: null };
    case 'queued':
      return { state: 'queued', waitingFor: null };
    case 'error':
      return { state: 'error', waitingFor: null };
    default:
      // A delegated child at rest handed its work back; a root is just idle.
      return { state: thread.parentThreadId || reportedBack ? 'done' : 'idle', waitingFor: null };
  }
}

const byCreation = (a: ThreadRow, b: ThreadRow) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1);

/** True when `ancestor` is `from` or sits above it in `parents`. Stops on a cycle. */
function isAbove(parents: ReadonlyMap<string, string | null>, ancestor: string, from: string): boolean {
  const seen = new Set<string>();
  for (let id: string | null | undefined = from; id !== null && id !== undefined && !seen.has(id); id = parents.get(id)) {
    if (id === ancestor) return true;
    seen.add(id);
  }
  return false;
}

export interface TeamParents {
  /** The thread above each office thread, null for a root. */
  parents: Map<string, string | null>;
  /** The threads placed under a chef by a chef link rather than by `parentThreadId`. */
  attached: Set<string>;
}

/**
 * Who sits above each thread. `parentThreadId` first (visible parents only); then every chef link a
 * manager declared: that thread moves under its chef, as if the chef had spawned it. A link that
 * would put a chef under one of its own descendants, or that points at nothing visible, is ignored,
 * oldest declaration first, so the tree stays a tree. `ignore` leaves one thread's link out.
 */
export function teamParents(rows: ReadonlyMap<string, ThreadRow>, registry: Registry, ignore?: string): TeamParents {
  const parents = new Map<string, string | null>();
  for (const thread of rows.values()) {
    const parentId = thread.parentThreadId ?? null;
    parents.set(thread.id, parentId !== null && parentId !== thread.id && rows.has(parentId) ? parentId : null);
  }
  const attached = new Set<string>();
  const links = Object.entries(registry.roles)
    .filter(([id, entry]) => id !== ignore && rows.has(id) && typeof entry.chefId === 'string')
    .sort(([idA, a], [idB, b]) => a.at - b.at || (idA < idB ? -1 : 1));
  for (const [id, entry] of links) {
    const chefId = entry.chefId!;
    if (chefId === id || !rows.has(chefId) || isAbove(parents, id, chefId)) continue;
    parents.set(id, chefId);
    attached.add(id);
  }
  return { parents, attached };
}

/** Would attaching `id` under `chefId` close a loop (the chef is `id` or one of its descendants)? */
export function wouldLoop(rows: ReadonlyMap<string, ThreadRow>, registry: Registry, id: string, chefId: string): boolean {
  return isAbove(teamParents(rows, registry, id).parents, id, chefId);
}

/** The office threads of a thread list, by id. */
export function officeRows(threads: Iterable<ThreadRow>): Map<string, ThreadRow> {
  const rows = new Map<string, ThreadRow>();
  for (const thread of threads) if (isOfficeThread(thread)) rows.set(thread.id, thread);
  return rows;
}

const missionDoneUnder = (registry: Registry, chefId: string | undefined): boolean =>
  chefId !== undefined && Object.values(registry.missions).some((mission) => mission.chefId === chefId && mission.status === 'done');

export function buildState(input: StateInput): OfficeState {
  const { registry } = input;
  const rows = officeRows(input.threads);
  // Never the path: the page only needs the id and the name.
  const projects: ProjectInfo[] = [];
  const projectNames = new Map<string, string>();
  for (const project of input.projects) {
    projects.push({ id: project.id, name: project.name });
    projectNames.set(project.id, project.name);
  }

  // The tree follows visible parents only: a child whose parent is archived or gone becomes a root.
  // A manager started with `boite thread new` hangs under the chef it declared, like a spawned child.
  const { parents, attached } = teamParents(rows, registry);
  const childrenOf = new Map<string, ThreadRow[]>();
  const roots: ThreadRow[] = [];
  for (const thread of rows.values()) {
    const parentId = parents.get(thread.id) ?? null;
    if (parentId !== null) {
      const siblings = childrenOf.get(parentId) ?? [];
      siblings.push(thread);
      childrenOf.set(parentId, siblings);
    } else {
      roots.push(thread);
    }
  }
  for (const siblings of childrenOf.values()) siblings.sort(byCreation);
  roots.sort(byCreation);

  const claimed = new Set<string>();
  const teams: Team[] = [];
  const buildTeam = (root: ThreadRow): Team => {
    const agents: OfficeAgent[] = [];
    const serviceOf = new Map<string, string | null>();
    const roleOf = new Map<string, Role>();
    // Breadth-first, root first; `claimed` also stops a delegation cycle.
    const queue: { thread: ThreadRow; depth: number; parent: ThreadRow | null }[] = [{ thread: root, depth: 0, parent: null }];
    for (let head = 0; head < queue.length; head++) {
      const { thread, depth, parent } = queue[head]!;
      if (claimed.has(thread.id)) continue;
      claimed.add(thread.id);
      const children = childrenOf.get(thread.id) ?? [];
      const declared = registry.roles[thread.id];
      let role: Role;
      if (attached.has(thread.id)) role = 'manager';
      else if (declared) role = declared.role;
      else if (depth === 0) role = 'chef';
      else if (depth === 1) role = children.length > 0 ? 'manager' : 'agent';
      else role = 'agent';
      // The service: declared, else the one of the manager above.
      const parentService = parent && roleOf.get(parent.id) === 'manager' ? (serviceOf.get(parent.id) ?? null) : null;
      const service = declared?.service ?? parentService;
      roleOf.set(thread.id, role);
      serviceOf.set(thread.id, service);

      // An attached manager is done once it reported (and did not work again since), or once its chef closed a mission.
      const reportedBack = attached.has(thread.id) && hasReportedBack(thread, registry.reports[thread.id], missionDoneUnder(registry, declared?.chefId));
      const { state, waitingFor } = agentState(thread, reportedBack);
      const atRest = state === 'idle' || state === 'done' || state === 'error';
      agents.push({
        id: thread.id,
        title: thread.title,
        role,
        roleSource: declared ? 'declared' : 'guessed',
        service,
        parentId: parent ? parent.id : null,
        model: thread.model,
        provider: thread.providerId,
        state,
        waitingFor,
        since: atRest ? null : (thread.requestSince ?? thread.runningSince ?? null),
        updatedAt: thread.updatedAt,
        createdAt: thread.createdAt,
        report: registry.reports[thread.id] ?? null,
        files: declared?.files ?? [],
      });
      for (const child of children) queue.push({ thread: child, depth: depth + 1, parent: thread });
    }

    // The newest mission whose chef sits in this tree.
    const ids = new Set(agents.map((agent) => agent.id));
    let mission: Mission | null = null;
    for (const candidate of Object.values(registry.missions)) {
      if (!ids.has(candidate.chefId)) continue;
      if (mission === null || candidate.createdAt > mission.createdAt) mission = candidate;
    }

    return {
      id: root.id,
      title: root.title,
      projectId: root.projectId ?? null,
      projectName: root.projectId ? (projectNames.get(root.projectId) ?? null) : null,
      agents,
      mission,
      lastActivity: agents.reduce((latest, agent) => Math.max(latest, agent.updatedAt), 0),
    };
  };

  for (const root of roots) teams.push(buildTeam(root));
  // A pure cycle has no root: its threads would vanish, so each one left over starts a team.
  for (const thread of [...rows.values()].sort(byCreation)) if (!claimed.has(thread.id)) teams.push(buildTeam(thread));

  teams.sort((a, b) => b.lastActivity - a.lastActivity || (a.id < b.id ? -1 : 1));
  // The view shows what is alive: a team with someone at work, a mission still open,
  // or a change in the last day. Older quiet conversations stay out, and the list is capped.
  const isLive = (team: Team) =>
    team.agents.some((agent) => agent.state === 'running' || agent.state === 'queued' || agent.state === 'waiting') ||
    (team.mission !== null && team.mission.status !== 'done') ||
    input.now - team.lastActivity < ACTIVE_WINDOW_MS;
  if (input.live === true) teams.splice(0, teams.length, ...teams.filter(isLive).slice(0, MAX_TEAMS));
  const waitingCount = teams.reduce((sum, team) => sum + team.agents.filter((agent) => agent.state === 'waiting').length, 0);
  return { teams, projects, waitingCount, core: input.core, generatedAt: input.now, archives: input.archives ?? [] };
}
