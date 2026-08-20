export const DESCRIPTOR_EVENT = "company-thread/descriptor";
export const MAILBOX_EVENT = "company-thread/mailbox";
export const STATUS_EVENT = "company-thread/status";
export const LABEL_EVENT = "company-thread/label";
export const DESCRIPTOR_VERSION = 1;
export const DEFAULT_PRESET = "xiaok";
export const MAX_DEPTH = 1;
export const MAX_DIRECT_CHILDREN = 8;
export const DEFAULT_MAX_GOAL_ROUNDS = 16;

export const PERMISSION_TEMPLATES = {
  "read-only": {
    id: "read-only",
    rank: 0,
    sandbox: "read-only",
    approval: "ask",
    name: "只读",
    description: "只能读指定工作区，改文件必须向上级申请。",
  },
  "workspace-write": {
    id: "workspace-write",
    rank: 1,
    sandbox: "workspace-write",
    approval: "ask",
    name: "限定工作区",
    description: "只能在指定工作目录内读写；越界和高风险操作仍要批准。",
  },
  auto: {
    id: "auto",
    rank: 1,
    sandbox: "workspace-write",
    approval: "ask",
    name: "自动执行",
    description: "工作区内自动执行，越界由现有 Auto 门裁一轮；删除等高风险仍问人。",
  },
  "full-controlled": {
    id: "full-controlled",
    rank: 2,
    sandbox: "danger-full-access",
    approval: "ask",
    name: "全盘访问（需审批）",
    description: "目录更广，但每次高风险动作仍需审批，不使用无审批的完整权限。",
  },
};

export const ROLES = ["root", "main", "project", "work", "review"];
export const STATUSES = ["idle", "running", "waiting", "blocked", "complete", "paused"];
export const MAIL_KINDS = ["assign", "report", "peer", "brief", "review", "contract", "completion", "escalation"];

export class CompanyThreadError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "CompanyThreadError";
    this.code = code;
  }
}

export function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function templateOf(id) {
  const template = PERMISSION_TEMPLATES[id];
  if (!template) {
    throw new CompanyThreadError(`未知权限模板 ${id}`, "UNKNOWN_PERMISSION");
  }
  return template;
}

export function assertAssignablePermission(parentPermission, childPermission) {
  const parent = templateOf(parentPermission);
  const child = templateOf(childPermission);
  if (child.rank > parent.rank) {
    throw new CompanyThreadError(
      `子线程权限不能高于上级：上级是 ${parent.id}，不能分配 ${child.id}`,
      "PERMISSION_ESCALATION",
    );
  }
  return child;
}

export function normalizeAbsolutePath(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CompanyThreadError("工作目录必须是绝对路径", "INVALID_CWD");
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) {
    throw new CompanyThreadError(`工作目录必须是绝对路径，收到 ${trimmed}`, "INVALID_CWD");
  }
  const parts = [];
  for (const part of trimmed.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) {
        throw new CompanyThreadError("工作目录不能越出根目录", "INVALID_CWD");
      }
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `/${parts.join("/")}`;
}

export function isPathInside(parentPath, childPath) {
  const parent = normalizeAbsolutePath(parentPath);
  const child = normalizeAbsolutePath(childPath);
  return child === parent || child.startsWith(`${parent}/`);
}

export function assertAssignableWorkspace(parent, childCwd) {
  const cwd = normalizeAbsolutePath(childCwd);
  const parentTemplate = templateOf(parent.permission);
  if (parentTemplate.rank >= PERMISSION_TEMPLATES["full-controlled"].rank) return cwd;
  if (!parent.cwd) {
    throw new CompanyThreadError("上级没有工作目录，不能分配限定工作区", "INVALID_CWD");
  }
  if (!isPathInside(parent.cwd, cwd)) {
    throw new CompanyThreadError(
      `限定工作区必须落在上级目录内：上级 ${parent.cwd}，请求 ${cwd}`,
      "WORKSPACE_ESCAPE",
    );
  }
  return cwd;
}

export function resolveExistingDirectory(value, io) {
  if (!io || typeof io.statSync !== "function" || typeof io.realpathSync !== "function") {
    throw new CompanyThreadError("缺少真实目录检查", "INVALID_CWD");
  }
  const requested = normalizeAbsolutePath(value);
  let stat;
  try {
    stat = io.statSync(requested);
  } catch {
    throw new CompanyThreadError(`工作目录不存在：${requested}`, "INVALID_CWD");
  }
  if (typeof stat.isDirectory === "function" ? !stat.isDirectory() : !stat.isDirectory) {
    throw new CompanyThreadError(`工作目录必须是目录：${requested}`, "INVALID_CWD");
  }
  let real;
  try {
    real = io.realpathSync(requested);
  } catch {
    throw new CompanyThreadError(`无法解析工作目录：${requested}`, "INVALID_CWD");
  }
  return normalizeAbsolutePath(String(real));
}

export function assertCanonicalWorkspace(parent, childCwd, io) {
  const childReal = resolveExistingDirectory(childCwd, io);
  const parentTemplate = templateOf(parent.permission);
  if (parentTemplate.rank >= PERMISSION_TEMPLATES["full-controlled"].rank) return childReal;
  if (!parent.cwd) {
    throw new CompanyThreadError("上级没有工作目录，不能分配限定工作区", "INVALID_CWD");
  }
  const parentReal = resolveExistingDirectory(parent.cwd, io);
  if (!isPathInside(parentReal, childReal)) {
    throw new CompanyThreadError(
      `限定工作区必须落在上级真实目录内：上级 ${parentReal}，请求 ${childReal}`,
      "WORKSPACE_ESCAPE",
    );
  }
  return childReal;
}

export function nextDepth(parentDepth) {
  const depth = (parentDepth ?? 0) + 1;
  if (depth > MAX_DEPTH) {
    throw new CompanyThreadError(`超过最大层级 ${MAX_DEPTH}：工作代理不能再开下级`, "MAX_DEPTH");
  }
  return depth;
}

export function assertCanCreateChild(parent, existingChildCount) {
  if (!parent) throw new CompanyThreadError("找不到上级线程", "PARENT_NOT_FOUND");
  if (parent.status === "complete" || parent.status === "paused") {
    throw new CompanyThreadError("已结束或暂停的线程不能再开下级", "PARENT_INACTIVE");
  }
  if ((parent.depth ?? 0) >= MAX_DEPTH) {
    throw new CompanyThreadError("工作代理不能再开下级", "MAX_DEPTH");
  }
  if (existingChildCount >= (parent.maxChildren ?? MAX_DIRECT_CHILDREN)) {
    throw new CompanyThreadError("直接下级数量已满", "MAX_CHILDREN");
  }
}

export function assertDirectChild(parentId, child) {
  if (!child || child.parentId !== parentId) {
    throw new CompanyThreadError("只能向直接下级派工", "NOT_DIRECT_CHILD");
  }
}

export function assertDirectParent(child, parentId) {
  if (!child || child.parentId !== parentId) {
    throw new CompanyThreadError("只能向直接上级汇报", "NOT_DIRECT_PARENT");
  }
}

export function assertPeerMessage(from, to) {
  if (!from || !to) {
    throw new CompanyThreadError("找不到横向通信的线程", "THREAD_NOT_FOUND");
  }
  if (from.id === to.id) {
    throw new CompanyThreadError("不能给自己发横向消息", "SELF_MESSAGE");
  }
  throw new CompanyThreadError("扁平工作代理不横向通信；执行与审查由根线程和工作流状态机隔离转交", "NOT_PEER");
}

export function foldRequestConfig(events) {
  let config;
  for (const event of events ?? []) {
    if (event.type === "request/header") config = event.data?.header?.config;
  }
  return config && typeof config === "object" ? { ...config } : {};
}

export function inheritModelRoute(parent = {}, explicit = {}) {
  const headerConfig = parent.requestHeaderConfig ?? parent.requestHeader?.config ?? {};
  const options = parent.agentOptions ?? parent.options ?? {};
  const provider = firstText(explicit.provider, headerConfig.provider, options.provider, parent.provider);
  const model = firstText(explicit.model, headerConfig.model, options.model, parent.model);
  const reasoningEffort = firstText(
    explicit.reasoningEffort,
    explicit.reasoning_effort,
    headerConfig.reasoningEffort,
    options.reasoningEffort,
    parent.reasoningEffort,
  );
  return {
    ...provider ? { provider } : {},
    ...model ? { model } : {},
    ...reasoningEffort ? { reasoningEffort } : {},
  };
}

export function createAgentOptions(route = {}) {
  return {
    ...route.provider ? { provider: route.provider } : {},
    ...route.model ? { model: route.model } : {},
  };
}

export function hasRequestHeader(sessionOrEvents) {
  if (sessionOrEvents && typeof sessionOrEvents.requestHeader === "function") {
    if (sessionOrEvents.requestHeader()) return true;
  }
  const events = Array.isArray(sessionOrEvents) ? sessionOrEvents : sessionOrEvents?.events;
  return (events ?? []).some((event) => event.type === "request/header");
}

export function shouldApplyInitialReasoning(sessionOrEvents, reasoningEffort) {
  if (!firstText(reasoningEffort)) return false;
  return !hasRequestHeader(sessionOrEvents);
}

export function applyInitialReasoning(resolved, reasoningEffort, alreadyHasHeader) {
  const effort = firstText(reasoningEffort);
  if (!effort || alreadyHasHeader) return resolved;
  return { ...resolved, reasoningEffort: effort };
}

export function createDescriptor(input) {
  const permission = templateOf(input.permission);
  const role = input.role ?? "project";
  if (!ROLES.includes(role)) throw new CompanyThreadError(`未知角色 ${role}`, "INVALID_ROLE");
  const status = input.status ?? "idle";
  if (!STATUSES.includes(status)) throw new CompanyThreadError(`未知状态 ${status}`, "INVALID_STATUS");
  const cwd = normalizeAbsolutePath(input.cwd);
  const route = inheritModelRoute({}, input);
  return {
    version: DESCRIPTOR_VERSION,
    id: input.id,
    parentId: input.parentId ?? null,
    label: String(input.label || "").trim() || input.id,
    role,
    permission: permission.id,
    sandbox: permission.sandbox,
    approval: permission.approval,
    cwd,
    depth: input.depth ?? 0,
    status,
    objective: String(input.objective || "").trim(),
    agentPreset: input.agentPreset || DEFAULT_PRESET,
    maxChildren: input.maxChildren ?? MAX_DIRECT_CHILDREN,
    ...(input.profileId ? { profileId: String(input.profileId) } : {}),
    createdAt: input.createdAt ?? Date.now(),
    ...route.provider ? { provider: route.provider } : {},
    ...route.model ? { model: route.model } : {},
    ...route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {},
  };
}

export function createSessionMeta(descriptor) {
  const meta = {
    cwd: descriptor.cwd,
    agentPreset: descriptor.agentPreset,
    delegationDepth: descriptor.depth,
  };
  if (descriptor.parentId) meta.parentSession = descriptor.parentId;
  return meta;
}

export function assertNoSubagentOrigin(meta) {
  if (meta && Object.prototype.hasOwnProperty.call(meta, "origin")) {
    throw new CompanyThreadError("独立线程不能写 origin", "FORBIDDEN_ORIGIN");
  }
  return meta;
}

export function foldDescriptor(events) {
  let current;
  for (const event of events ?? []) {
    if (event.type === DESCRIPTOR_EVENT) current = { ...event.data };
    else if (event.type === STATUS_EVENT && current) {
      current = { ...current, status: event.data.status, updatedAt: event.data.updatedAt };
    } else if (event.type === LABEL_EVENT && current) {
      current = { ...current, label: event.data.label, updatedAt: event.data.updatedAt };
    }
  }
  return current;
}

export function foldMailbox(events, threadId) {
  const pending = [];
  const acked = new Set();
  for (const event of events ?? []) {
    if (event.type !== MAILBOX_EVENT) continue;
    const data = event.data || {};
    if (data.op === "ack" && data.messageId) {
      acked.add(data.messageId);
      continue;
    }
    if (data.op === "enqueue" && data.message && data.message.id) pending.push(data.message);
  }
  return pending.filter((message) => !acked.has(message.id) && (!threadId || message.toId === threadId));
}

export function hasCompanyThreadDescriptor(events) {
  return (events ?? []).some((event) => event.type === DESCRIPTOR_EVENT);
}

export function isXiaokPreset(value) {
  return firstText(value) === DEFAULT_PRESET;
}

export function resolveComposedPreset({ header, events, liveAgent, agentPresets } = {}) {
  if (agentPresets && liveAgent?.ctx && typeof agentPresets.composedPreset === "function") {
    try {
      const composed = agentPresets.composedPreset(liveAgent.ctx);
      if (firstText(composed)) return firstText(composed);
    } catch {}
  }
  const fromHeader = firstText(header?.agentPreset);
  if (fromHeader) return fromHeader;
  return firstText(foldDescriptor(events)?.agentPreset);
}

export function isLiveXiaokRoot({ id, header, events, liveAgent, roots, agentPresets, rootPresets } = {}) {
  if (!id || !liveAgent) return false;
  if (header?.origin === "subagent" || header?.parentSession) return false;
  if (!Array.isArray(roots) || !roots.includes(liveAgent)) return false;
  // superwork 被装载后，每个普通活跃会话天然是自己组织的根；
  // 不再依赖角色卡或 preset 判根，避免设置页出现多余的“主线程卡”。
  return true;
}
