export function makeSession(id, header, events = []) {
  return {
    id,
    header,
    events: [...events],
    append(type, data) {
      const event = { type, data, seq: this.events.length, time: Date.now() };
      this.events.push(event);
      return event;
    },
  };
}

export function makeAgent(session, extras = {}) {
  const inbox = [];
  const agent = {
    id: session.id,
    session,
    status: extras.status ?? "idle",
    options: extras.options ?? {},
    followup(message) {
      inbox.push(message);
      session.append("user/message", message);
    },
    inbox,
    ...extras,
  };
  agent.ctx = extras.ctx ?? { agent };
  return agent;
}

export function descriptorEvent(data) {
  return { type: "company-thread/descriptor", data };
}

export function makeFs(map) {
  return {
    statSync(path) {
      const entry = map[path];
      if (!entry) throw new Error(`missing ${path}`);
      return { isDirectory: () => entry.kind === "dir" };
    },
    realpathSync(path) {
      const entry = map[path];
      if (!entry) throw new Error(`missing ${path}`);
      return entry.real ?? path;
    },
  };
}

export const defaultFs = makeFs({
  "/Users/yu": { kind: "dir" },
  "/Users/yu/project-a": { kind: "dir" },
  "/Users/yu/a": { kind: "dir" },
  "/Users/yu/a/src": { kind: "dir" },
  "/Users/yu/b": { kind: "dir" },
  "/Users/yu/c": { kind: "dir" },
});

export function makeCtx(seed = {}) {
  const sessions = new Map(Object.entries(seed.sessions ?? {}));
  const agents = new Map(Object.entries(seed.agents ?? {}));
  const persisted = { ...(seed.persisted ?? {}) };
  const created = [];
  const resumed = [];
  const resumeSetups = [];
  const goals = [];
  const mounts = [];
  const roots = [];
  const composedPresets = { ...(seed.composedPresets ?? {}) };
  for (const agent of agents.values()) {
    if (!agent.session?.header?.parentSession) roots.push(agent);
  }
  const ctx = {
    logger: { warn() {} },
    sessions: {
      get: (id) => sessions.get(id),
      list: () => [...sessions.values()],
    },
    agents: {
      get: (id) => agents.get(id),
      roots: () => roots.slice(),
      async create({ sessionId, meta, setup, agentOptions }) {
        if (Object.hasOwn(meta, "origin")) throw new Error("must not write origin");
        const session = makeSession(sessionId, {
          id: sessionId,
          cwd: meta.cwd,
          parentSession: meta.parentSession,
          agentPreset: meta.agentPreset,
          delegationDepth: meta.delegationDepth,
          createdAt: Date.now(),
        });
        sessions.set(sessionId, session);
        const agent = makeAgent(session, { options: agentOptions ?? {} });
        agents.set(sessionId, agent);
        if (seed.rootOwner !== false) roots.push(agent);
        created.push({ sessionId, meta, agentOptions: agentOptions ?? {}, agent });
        if (setup) {
          const childCtx = {
            agent,
            get(name) {
              if (name === "agentPresets") {
                return {
                  async mount(_ctx, id) {
                    mounts.push({ phase: "create", id, sessionId });
                  },
                };
              }
              return undefined;
            },
            on(name, handler) {
              childCtx.handlers = childCtx.handlers || {};
              childCtx.handlers[name] = handler;
            },
          };
          await setup(childCtx);
          created.at(-1).setupCtx = childCtx;
        }
        return {
          agent,
          async dispose() {
            agents.delete(sessionId);
            sessions.delete(sessionId);
            const index = roots.indexOf(agent);
            if (index >= 0) roots.splice(index, 1);
          },
        };
      },
      async resume(options) {
        const resumeSessionId = options.resumeSessionId;
        resumed.push({ id: resumeSessionId, options });
        let session = sessions.get(resumeSessionId);
        if (!session) {
          const stored = persisted[resumeSessionId];
          if (!stored) throw new Error(`missing ${resumeSessionId}`);
          session = makeSession(resumeSessionId, stored.header, stored.events);
          sessions.set(resumeSessionId, session);
        }
        const agent = makeAgent(session, { options: options.agentOptions ?? {} });
        agents.set(resumeSessionId, agent);
        if (options.setup) {
          const childCtx = {
            agent,
            get(name) {
              if (name === "agentPresets") {
                return {
                  async mount(_ctx, id) {
                    mounts.push({ phase: "resume", id, sessionId: resumeSessionId });
                  },
                };
              }
              return undefined;
            },
            on(name, handler) {
              childCtx.handlers = childCtx.handlers || {};
              childCtx.handlers[name] = handler;
            },
          };
          await options.setup(childCtx);
          resumeSetups.push(childCtx);
        }
        return { agent };
      },
    },
    get(name) {
      if (name === "sessionQuery") return ctx.sessionQuery;
      if (name === "agentPresets") {
        return {
          composedPreset(agentCtx) {
            const id = agentCtx?.agent?.id;
            if (id && composedPresets[id]) return composedPresets[id];
            return undefined;
          },
          async mount() {},
        };
      }
      if (name === "sessionPersistence") {
        throw new Error("service must not list via persistence.list");
      }
      if (name === "permissionPresets") {
        return {
          names: ["read-only", "workspace-write", "auto", "full-controlled", "danger-full-access"],
          set(session, name) {
            session.append("permission/preset", { preset: name });
            if (name === "read-only") {
              session.append("sandbox/mode", { mode: "read-only" });
              session.append("approval/policy", { policy: "ask" });
            } else if (name === "full-controlled") {
              session.append("sandbox/mode", { mode: "danger-full-access" });
              session.append("approval/policy", { policy: "ask" });
            } else if (name === "danger-full-access") {
              session.append("sandbox/mode", { mode: "danger-full-access" });
              session.append("approval/policy", { policy: "never" });
            } else {
              session.append("sandbox/mode", { mode: "workspace-write" });
              session.append("approval/policy", { policy: "ask" });
            }
          },
        };
      }
      if (name === "goals") {
        return {
          create(agent, request) {
            goals.push({ id: agent.id, ...request });
            return { id: "goal-1", revision: 1, ...request };
          },
        };
      }
      if (name === "llm") {
        return {
          async resolveCallConfig(config) {
            if (!config.provider || !config.model) throw new Error("missing route");
            return { ...config };
          },
        };
      }
      if (name === "sessionTitles" || name === "sessionTitle") {
        return {
          rename(session, title) {
            session.append("session/title", { title, messageSeqs: [], source: { kind: "user" } });
          },
        };
      }
      return undefined;
    },
    sessionQuery: {
      async listSessions() {
        const byId = new Map();
        for (const item of Object.values(persisted)) byId.set(item.header.id, { header: item.header, live: false });
        for (const session of sessions.values()) byId.set(session.id, { header: session.header, live: true });
        return [...byId.values()];
      },
      async readSession(id) {
        const live = sessions.get(id);
        if (live) return { session: live.header, events: live.events };
        const stored = persisted[id];
        if (!stored) throw new Error(`missing ${id}`);
        return { session: stored.header, events: stored.events };
      },
    },
    created,
    resumed,
    resumeSetups,
    goals,
    mounts,
    roots,
  };
  return { ctx, sessions, agents, persisted };
}

export function rootDescriptor(extra = {}) {
  return {
    id: "root",
    parentId: null,
    label: "小K",
    role: "root",
    permission: "full-controlled",
    cwd: "/Users/yu",
    depth: 0,
    agentPreset: "xiaok",
    ...extra,
  };
}
