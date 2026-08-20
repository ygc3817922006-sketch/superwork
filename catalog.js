import {
  DEFAULT_PRESET,
  collectOrganizationNodes,
  createDescriptor,
  foldDescriptor,
  hasCompanyThreadDescriptor,
  inferPermissionFromEvents,
  isLiveXiaokRoot,
  isXiaokPreset,
  resolveComposedPreset,
} from "./logic.js";

export function decorateDescriptor(descriptor, record, liveAgent) {
  if (!descriptor) return undefined;
  return {
    ...descriptor,
    live: record.live === true,
    running: liveAgent?.(descriptor.id)?.status === "running",
  };
}

export function descriptorFromRecord(record, liveAgent) {
  const events = record.events ?? [];
  const header = record.header ?? {};
  const folded = foldDescriptor(events);
  if (!folded || header.origin === "subagent") return undefined;
  return {
    ...folded,
    live: record.live === true,
    running: liveAgent?.(folded.id)?.status === "running",
  };
}

export function ancestorStub(record, { liveAgent, resolvePreset }) {
  const header = record.header ?? {};
  const folded = foldDescriptor(record.events ?? []);
  if (header.origin === "subagent") return undefined;
  if (folded) return decorateDescriptor(folded, record, liveAgent);
  if (!header.id || !header.cwd) return undefined;
  const preset = resolvePreset(record);
  return createDescriptor({
    id: header.id,
    parentId: header.parentSession ?? null,
    label: isXiaokPreset(preset) ? "小K" : header.id,
    role: header.parentSession ? "project" : "root",
    permission: inferPermissionFromEvents(record.events ?? [], "workspace-write"),
    cwd: header.cwd,
    depth: header.delegationDepth ?? (header.parentSession ? 1 : 0),
    status: record.live ? "running" : "idle",
    agentPreset: preset || DEFAULT_PRESET,
    createdAt: header.createdAt,
  });
}

export function resolveRecordPreset(record, { liveAgent, agentPresets }) {
  return resolveComposedPreset({
    header: record.header,
    events: record.events,
    liveAgent: liveAgent?.(record.header?.id),
    agentPresets,
  });
}

export function liveXiaokRootStub(record, helpers) {
  const header = record.header ?? {};
  if (!header.id || hasCompanyThreadDescriptor(record.events)) return undefined;
  const agent = helpers.liveAgent?.(header.id);
  if (!isLiveXiaokRoot({
    id: header.id,
    header,
    events: record.events,
    liveAgent: agent,
    roots: helpers.roots ?? [],
    agentPresets: helpers.agentPresets,
    rootPresets: helpers.rootPresets,
  })) return undefined;
  return ancestorStub(record, helpers);
}

export function describeRecord(record, helpers) {
  return decorateDescriptor(
    descriptorFromRecord(record, helpers.liveAgent) ?? liveXiaokRootStub(record, helpers),
    record,
    helpers.liveAgent,
  );
}

export function neededAncestorIds(records, helpers) {
  const byId = new Map();
  for (const record of records) {
    const id = record.header?.id;
    if (id) byId.set(id, record);
  }
  const needed = new Set();
  for (const record of collectOrganizationNodes(records)) {
    let parentId = foldDescriptor(record.events)?.parentId ?? record.header?.parentSession;
    const seen = new Set();
    while (parentId && byId.has(parentId) && !seen.has(parentId)) {
      const parent = byId.get(parentId);
      if (!hasCompanyThreadDescriptor(parent.events) && !liveXiaokRootStub(parent, helpers)) needed.add(parentId);
      seen.add(parentId);
      parentId = foldDescriptor(parent.events)?.parentId ?? parent.header?.parentSession;
    }
  }
  return needed;
}

export function descriptorsFromRecords(records, helpers) {
  const ancestorIds = neededAncestorIds(records, helpers);
  return records.map((record) => {
    const id = record.header?.id;
    if (hasCompanyThreadDescriptor(record.events) || liveXiaokRootStub(record, helpers)) {
      return describeRecord(record, helpers);
    }
    if (id && ancestorIds.has(id)) return decorateDescriptor(ancestorStub(record, helpers), record, helpers.liveAgent);
    return undefined;
  }).filter(Boolean);
}

export async function loadAllRecords({ sessions, inspectSession, listSessions }) {
  const byId = new Map();
  const listed = listSessions
    ? await listSessions()
    : sessions.list().map((session) => ({ header: session.header, live: true }));
  for (const item of listed) {
    const header = item.header ?? item.session ?? item;
    const id = header?.id;
    if (!id || header.origin === "subagent") continue;
    const inspected = await inspectSession(id);
    if (!inspected) continue;
    byId.set(id, inspected);
  }
  for (const session of sessions.list()) {
    if (session.header?.origin === "subagent") continue;
    byId.set(session.id, { header: session.header, events: session.events, live: true, session });
  }
  return [...byId.values()];
}
