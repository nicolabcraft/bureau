/*
 * Conversation events: what happened in the office between two consecutive
 * states. Pure: two states and the recent log in, the new log out, no clock
 * and no I/O, so tests feed it plain data. The rules are in docs/vue-pixel.md 1.5.
 */
import type { Lot, Mission, OfficeAgent, OfficeEvent, OfficeEventKind, OfficeState } from './model';

/** Events older than this are dropped from the log. */
export const EVENT_WINDOW_MS = 2 * 60 * 1000;
/** The log keeps this many events at most, the most recent. */
export const EVENT_MAX = 40;
/** One `blocked` or `waiting` per agent in this window. */
const DEBOUNCE_MS = 30 * 1000;

/** The order events of one pass are listed in. */
const KIND_ORDER: OfficeEventKind[] = ['arrive', 'delegate', 'plan', 'waiting', 'blocked', 'report', 'answered', 'depart'];

/** An event before the service gives it an id and a time. */
type Draft = OfficeEvent extends infer E ? (E extends unknown ? Omit<E, 'id' | 'at'> : never) : never;

interface Seat {
  agent: OfficeAgent;
  teamId: string;
}

const seats = (state: OfficeState): Map<string, Seat> => {
  const map = new Map<string, Seat>();
  for (const team of state.teams) for (const agent of team.agents) if (!map.has(agent.id)) map.set(agent.id, { agent, teamId: team.id });
  return map;
};

const missions = (state: OfficeState): Map<string, { mission: Mission; teamId: string }> => {
  const map = new Map<string, { mission: Mission; teamId: string }>();
  for (const team of state.teams) if (team.mission && !map.has(team.mission.id)) map.set(team.mission.id, { mission: team.mission, teamId: team.id });
  return map;
};

/** The lots of every mission, by `<mission id>/<lot id>`. */
const lotsOf = (state: OfficeState): Map<string, Lot> => {
  const map = new Map<string, Lot>();
  for (const team of state.teams) if (team.mission) for (const lot of team.mission.lots) map.set(`${team.mission.id}/${lot.id}`, lot);
  return map;
};

/** The lot an agent works on, if any: a running one first. */
function lotIdOf(state: OfficeState, agentId: string): string | null {
  let found: Lot | null = null;
  for (const lot of lotsOf(state).values()) {
    if (lot.agentId !== agentId) continue;
    if (found === null || (found.state !== 'running' && lot.state === 'running')) found = lot;
  }
  return found ? found.id : null;
}

/** The events the page needs: the log pruned to the window and the cap. */
export function recentEvents(log: readonly OfficeEvent[], now: number): OfficeEvent[] {
  return log.filter((event) => now - event.at <= EVENT_WINDOW_MS).slice(-EVENT_MAX);
}

/** The new log: `log` pruned, then the events `prev` to `next` produced. A null `prev` produces none. */
export function deriveEvents(prev: OfficeState | null, next: OfficeState, log: readonly OfficeEvent[], now: number): OfficeEvent[] {
  const kept = recentEvents(log, now);
  if (prev === null) return kept;

  const before = seats(prev);
  const after = seats(next);
  const drafts: Draft[] = [];
  /** Has the log, or this pass, an event of this kind for the agent, no older than `windowMs`? */
  const seen = (kind: OfficeEventKind, agentId: string, windowMs: number): boolean =>
    kept.some((event) => event.kind === kind && event.agentId === agentId && now - event.at <= windowMs) ||
    drafts.some((draft) => draft.kind === kind && draft.agentId === agentId);

  const delegate = (id: string, seat: Seat): void => {
    const fromId = seat.agent.parentId;
    if (fromId === null || seen('delegate', id, EVENT_WINDOW_MS)) return;
    drafts.push({ kind: 'delegate', teamId: seat.teamId, agentId: id, title: seat.agent.title, fromId, lotId: lotIdOf(next, id) });
  };

  for (const [id, seat] of after) {
    const old = before.get(id);
    if (!old) {
      drafts.push({ kind: 'arrive', teamId: seat.teamId, agentId: id, title: seat.agent.title, parentId: seat.agent.parentId });
      delegate(id, seat);
    }
  }

  // A lot that starts or gets an agent, for an agent that was already there.
  const oldLots = lotsOf(prev);
  for (const [key, lot] of lotsOf(next)) {
    if (lot.agentId === null) continue;
    const seat = after.get(lot.agentId);
    if (!seat || !before.has(lot.agentId)) continue;
    const old = oldLots.get(key);
    const started = old === undefined || old.agentId !== lot.agentId || (old.state !== 'running' && lot.state === 'running');
    if (started) delegate(lot.agentId, seat);
  }

  // A mission changed phase.
  const oldMissions = missions(prev);
  for (const [missionId, { mission, teamId }] of missions(next)) {
    const was = oldMissions.get(missionId)?.mission.status ?? null;
    let phase: Mission['status'] | null = null;
    if (was === null) phase = mission.status === 'done' ? null : mission.status;
    else if (was !== mission.status) phase = mission.status;
    if (phase === null) continue;
    const played = kept.some((event) => event.kind === 'plan' && event.missionId === missionId && event.phase === phase);
    if (played) continue;
    const chef = after.get(mission.chefId);
    drafts.push({ kind: 'plan', teamId, agentId: mission.chefId, title: chef ? chef.agent.title : mission.title, phase, missionId });
  }

  for (const [id, seat] of after) {
    const old = before.get(id);
    if (!old) continue;
    const { agent } = seat;
    const was = old.agent;
    if (agent.state === 'waiting' && was.state !== 'waiting' && agent.waitingFor !== null && !seen('waiting', id, DEBOUNCE_MS)) {
      drafts.push({ kind: 'waiting', teamId: seat.teamId, agentId: id, title: agent.title, waitingFor: agent.waitingFor });
    }
    if (agent.state === 'error' && was.state !== 'error' && !seen('blocked', id, DEBOUNCE_MS)) {
      drafts.push({ kind: 'blocked', teamId: seat.teamId, agentId: id, title: agent.title, toId: agent.parentId });
    }
    // A report filed (a), or the end of the work with no report filed (b): one per agent and window.
    const filed = agent.report !== null && (was.report === null || agent.report.at > was.report.at);
    const finished = agent.state === 'done' && was.state !== 'done';
    if ((filed || finished) && !seen('report', id, EVENT_WINDOW_MS)) {
      drafts.push({ kind: 'report', teamId: seat.teamId, agentId: id, title: agent.title, toId: agent.parentId, lotId: lotIdOf(next, id), hasReport: filed });
    }
    if (was.state === 'waiting' && agent.state !== 'waiting' && agent.state !== 'error') {
      drafts.push({ kind: 'answered', teamId: seat.teamId, agentId: id, title: agent.title });
    }
  }

  const archived = new Set(next.archives.map((note) => note.threadId));
  for (const [id, seat] of before) {
    if (after.has(id)) continue;
    drafts.push({ kind: 'depart', teamId: seat.teamId, agentId: id, title: seat.agent.title, reason: archived.has(id) ? 'archived' : 'gone' });
  }

  drafts.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  const used = new Set(log.map((event) => event.id));
  let k = 0;
  const made = drafts.map((draft): OfficeEvent => {
    while (used.has(`${now}-${k}`)) k += 1;
    const id = `${now}-${k}`;
    used.add(id);
    k += 1;
    return { ...draft, id, at: now } as OfficeEvent;
  });
  return [...kept, ...made].slice(-EVENT_MAX);
}
