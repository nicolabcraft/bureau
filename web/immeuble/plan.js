/* web/immeuble/plan.js: part of the building view, owned by the « donnees » module (see docs/vue-immeuble.md).
   Pure: no DOM, no scene globals. test/plan.test.ts loads this file on its own. */

/* Plan of the building: one floor per project that has a team, each floor cut into zones.
   planImmeuble(office, memo, cap) -> { floors: FloorSpec[], order: string[] }
   - office: an OfficeState (teams, projects); memo: remembered floor order (project ids, '' = no project), or null;
     cap: { zones(floorIndex) -> max zones of that floor, seats -> desks of a zone, lead included }.
   - Floor order: the memo first (kept as it is), then projects that are not in it yet, in projects.list order,
     so a new project lands on top. Only projects with a team get a floor and a place in `order`, the memo to store
     back: a project that has no team any more is forgotten (its floor is demolished) and, if it comes back, is new.
   - A zone: a service (its manager leads, seat 0), another team of the project (its root leads), the lone
     conversations, or « Autres » when there are more zones than the floor holds. Members are oldest first.
     More members than cap.seats - 1 stay in `memberIds`: the extra ones have no desk and stand in the zone. */
const NO_PROJECT = '';
const ZONE_CONV = '#conversations';
const ZONE_DIRECT = '#direct';
const ZONE_OTHERS = '#autres';

function planImmeuble(office, memo, cap){
  const teams = (office && office.teams) || [];
  const projects = (office && office.projects) || [];
  const stored = Array.isArray(memo) ? memo.filter((id, i, all) => typeof id === 'string' && all.indexOf(id) === i) : [];

  // Teams by project, most recent first (ties by id, so the plan never depends on the input order).
  const byProject = new Map();
  for(const t of teams){
    if(!t.agents || !t.agents.length) continue;
    const id = t.projectId == null ? NO_PROJECT : t.projectId;
    if(!byProject.has(id)) byProject.set(id, []);
    byProject.get(id).push(t);
  }
  for(const list of byProject.values()) list.sort((a, b) => (b.lastActivity - a.lastActivity) || (a.id < b.id ? -1 : 1));

  // Order: the memo, then the new projects (no project first, known projects in projects.list order, unknown ones last).
  const rank = (id) => { if(id === NO_PROJECT) return -1; const k = projects.findIndex((p) => p.id === id); return k < 0 ? projects.length : k; };
  const fresh = [...byProject.keys()].filter((id) => !stored.includes(id)).sort((a, b) => (rank(a) - rank(b)) || (a < b ? -1 : 1));
  const order = stored.filter((id) => byProject.has(id)).concat(fresh);

  const nameOf = (id, list) => {
    if(id === NO_PROJECT) return 'Sans projet';
    const p = projects.find((q) => q.id === id);
    return (p && p.name) || (list[0] && list[0].projectName) || 'Projet sans nom';
  };
  const floors = [];
  for(const id of order){
    const list = byProject.get(id);
    if(!list) continue;
    floors.push(floorSpec(id, nameOf(id, list), list, cap, floors.length));
  }
  return {floors, order};
}

const byAge = (a, b) => (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : 1);
const countOf = (agents, state) => agents.filter((a) => a.state === state).length;

function floorSpec(id, name, list, cap, index){
  const all = [];
  for(const t of list) for(const a of t.agents) all.push(a);

  // The chef: the root of the most recently active team that has more than a root. Lone conversations and
  // the other teams hold no glass office.
  const multi = list.filter((t) => t.agents.length > 1);
  const chefTeam = multi.length ? multi[0] : null;
  const zones = new Map();
  const zone = (key, label, service, lead) => { let z = zones.get(key); if(!z) zones.set(key, z = {key, label, service, lead: lead || null, agents: []}); return z; };

  if(chefTeam){
    const byId = new Map(chefTeam.agents.map((a) => [a.id, a]));
    const root = chefTeam.agents[0];
    const mgrZone = new Map();
    for(const a of chefTeam.agents){
      if(a === root || a.role !== 'manager') continue;
      const z = zone(a.service || a.id, a.service || a.title, a.service || null);
      z.agents.push(a); mgrZone.set(a.id, z);
    }
    for(const a of chefTeam.agents){
      if(a === root || a.role === 'manager') continue;
      // Under the nearest manager above it; else by its own service; else in the team's loose zone.
      let z = null, up = a.parentId, hops = 0;
      while(up && hops++ < 20 && !(z = mgrZone.get(up) || null)){ const u = byId.get(up); up = u ? u.parentId : null; }
      if(!z) z = a.service ? zone(a.service, a.service, a.service) : zone(ZONE_DIRECT, 'Équipe', null);
      z.agents.push(a);
    }
  }
  // Another team of the project: its root leads a zone of its own; a lone conversation goes to « Conversations ».
  for(const t of list){
    if(t === chefTeam) continue;
    if(t.agents.length > 1){
      const z = zone(t.id, t.title, t.agents[0].service || null, t.agents[0]);
      for(const a of t.agents) z.agents.push(a);
    } else zone(ZONE_CONV, 'Conversations', null).agents.push(t.agents[0]);
  }

  // A zone is led by its team root or its oldest manager, else by its oldest member; the others follow, oldest first.
  let specs = [...zones.values()].map((z) => {
    z.agents.sort(byAge);
    if(!z.lead) z.lead = z.agents.find((a) => a.role === 'manager') || z.agents[0];
    z.agents.splice(z.agents.indexOf(z.lead), 1); z.agents.unshift(z.lead);
    return z;
  });
  specs.sort((a, b) => byAge(a.lead, b.lead));
  const maxZones = Math.max(1, Math.floor(cap && cap.zones ? cap.zones(index) : 3));
  if(specs.length > maxZones){
    // The biggest zones stay (the older one first on a tie); the others merge into « Autres ».
    const rank = specs.map((z, i) => ({z, i})).sort((a, b) => (b.z.agents.length - a.z.agents.length) || (a.i - b.i));
    const keep = new Set(rank.slice(0, maxZones - 1).map((r) => r.z));
    const merged = [];
    for(const z of specs) if(!keep.has(z)) for(const a of z.agents) merged.push(a);
    specs = specs.filter((z) => keep.has(z));
    merged.sort(byAge);
    specs.push({key: ZONE_OTHERS, label: 'Autres', service: null, lead: merged[0], agents: merged});
  }

  return {
    id, name,
    zones: specs.map((z) => ({key: z.key, label: z.label, service: z.service, leadId: z.lead.id, memberIds: z.agents.slice(1).map((a) => a.id), colorKey: z.service || z.key})),
    chefId: chefTeam ? chefTeam.agents[0].id : null,
    stats: {total: all.length, running: countOf(all, 'running'), waiting: countOf(all, 'waiting'), queued: countOf(all, 'queued'), done: countOf(all, 'done'), error: countOf(all, 'error')},
    missions: list.filter((t) => t.mission).map((t) => ({id: t.mission.id, status: t.mission.status, title: t.mission.title}))
  };
}
