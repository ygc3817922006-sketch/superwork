// 工作代理模板：所有使用 superwork 的普通会话都是独立根线程；
// 根线程只能创建一层直属工作代理，代理分为执行（work）和审查（review）。
export const SETTINGS_VERSION = 3;
export const MAX_PROFILES = 48;
export const PROFILE_KINDS = ["work", "review"];
export const SUPERWORK_AGENT_PRESETS = ["xiaok-creative"];
export const PERMISSIONS = ["read-only", "workspace-write", "auto", "full-controlled"];

const BASE = {
  agentPreset: "xiaok-creative",
  provider: "",
  model: "",
  reasoningEffort: "",
  permission: "auto",
  startGoal: true,
  maxGoalRounds: 16,
  maxChildren: 0,
  instructions: "",
};

export const DEFAULT_PROFILES = [
  { id: "work-1", name: "执行代理", enabled: true, kind: "work", ...BASE },
  { id: "review-1", name: "审查代理", enabled: true, kind: "review", ...BASE, permission: "read-only" },
];

const clone = (value) => JSON.parse(JSON.stringify(value));
const text = (value, fallback = "") => typeof value === "string" ? value.trim() : fallback;

function integer(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

export function cloneDefaultSettings() {
  return { version: SETTINGS_VERSION, profiles: clone(DEFAULT_PROFILES) };
}

export function blankProfile(kind = "work", index = 0) {
  const safeKind = PROFILE_KINDS.includes(kind) ? kind : "work";
  return {
    id: `${safeKind}-${Date.now().toString(36)}-${index}`,
    name: safeKind === "review" ? `审查代理 ${index + 1}` : `执行代理 ${index + 1}`,
    enabled: true,
    kind: safeKind,
    ...BASE,
    permission: safeKind === "review" ? "read-only" : "auto",
  };
}

function sanitizeProfile(source, fallback) {
  const kind = PROFILE_KINDS.includes(source?.kind) ? source.kind : fallback.kind;
  const permission = text(source?.permission, fallback.permission);
  return {
    id: text(source?.id, fallback.id) || fallback.id,
    name: text(source?.name, fallback.name) || fallback.name,
    enabled: source?.enabled === undefined ? fallback.enabled : source.enabled === true,
    kind,
    agentPreset: SUPERWORK_AGENT_PRESETS.includes(text(source?.agentPreset)) ? text(source?.agentPreset) : fallback.agentPreset,
    provider: text(source?.provider),
    model: text(source?.model),
    reasoningEffort: text(source?.reasoningEffort, fallback.reasoningEffort),
    // 审查代理的只读边界是系统不变量，不能通过设置页放宽。
    permission: kind === "review" ? "read-only" : PERMISSIONS.includes(permission) ? permission : fallback.permission,
    startGoal: source?.startGoal === undefined ? fallback.startGoal : source.startGoal === true,
    maxGoalRounds: integer(source?.maxGoalRounds, fallback.maxGoalRounds, 1, 256),
    maxChildren: 0,
    instructions: text(source?.instructions, fallback.instructions),
  };
}

function migrateLegacy(input) {
  if (Array.isArray(input?.profiles)) return input.profiles;
  if (input?.columns) {
    // v2 三列模型只保留原二级执行/审查卡；主线程和项目经理卡退休。
    return Array.isArray(input.columns.level2) ? input.columns.level2 : [];
  }
  if (input?.roles) {
    return [
      input.roles.execution && { ...input.roles.execution, id: input.roles.execution.id || "work-1", name: input.roles.execution.name || input.roles.execution.label || "执行代理", kind: "work" },
      input.roles.review && { ...input.roles.review, id: input.roles.review.id || "review-1", name: input.roles.review.name || input.roles.review.label || "审查代理", kind: "review" },
    ].filter(Boolean);
  }
  return undefined;
}

export function sanitizeSettings(input = {}) {
  const migrated = migrateLegacy(input);
  const source = migrated === undefined ? DEFAULT_PROFILES : migrated.slice(0, MAX_PROFILES);
  const profiles = source.map((item, index) => {
    const kind = PROFILE_KINDS.includes(item?.kind) ? item.kind : index === 1 ? "review" : "work";
    const fallback = DEFAULT_PROFILES.find((profile) => profile.kind === kind) ?? blankProfile(kind, index);
    return sanitizeProfile(item, { ...fallback, id: item?.id || `${kind}-${index + 1}` });
  });
  const used = new Set();
  for (const profile of profiles) {
    let name = profile.name;
    let suffix = 2;
    while (used.has(name)) name = `${profile.name} ${suffix++}`;
    profile.name = name;
    used.add(name);
  }
  return { version: SETTINGS_VERSION, profiles };
}

export function profileKind(settings, profile) {
  if (!profile) return undefined;
  const key = String(profile).trim();
  return sanitizeSettings(settings).profiles.find((item) => item.id === key || item.name === key)?.kind;
}

// 兼容旧调用点；扁平版只有 workers 一列。
export function columnOfProfile(settings, profile) {
  return profileKind(settings, profile) ? "workers" : undefined;
}

export function columnForDepth(depth) {
  return depth === 0 ? "root" : depth === 1 ? "workers" : undefined;
}

export function canonicalRole(depth, requestedRole) {
  if (depth === 0) return "root";
  return requestedRole === "review" ? "review" : "work";
}

export function pickProfile(settings, _depthOrOptions, maybeOptions) {
  const options = maybeOptions ?? _depthOrOptions ?? {};
  const profiles = sanitizeSettings(settings).profiles;
  const requestedKind = options.role === "review" ? "review" : "work";
  if (options.profile) {
    const key = String(options.profile).trim();
    const hit = profiles.find((item) => item.id === key || item.name === key);
    if (!hit) throw Object.assign(new Error(`没有叫「${key}」的工作代理模板`), { code: "PROFILE_NOT_FOUND" });
    if (!hit.enabled) throw Object.assign(new Error(`工作代理模板「${hit.name}」已停用`), { code: "PROFILE_DISABLED" });
    if (options.role && hit.kind !== requestedKind) throw Object.assign(new Error(`模板「${hit.name}」不是${requestedKind === "review" ? "审查" : "执行"}代理`), { code: "PROFILE_KIND_MISMATCH" });
    return hit;
  }
  const hit = profiles.find((item) => item.enabled && item.kind === requestedKind);
  if (!hit) throw Object.assign(new Error(`没有启用的${requestedKind === "review" ? "审查" : "执行"}代理模板`), { code: "NO_ENABLED_PROFILE" });
  return hit;
}

export function applyRoleDefaults(input, depth, settings, inherited = {}) {
  if (depth !== 1) throw Object.assign(new Error("superwork 工作代理只能是根线程的直属一级线程"), { code: "INVALID_WORKER_DEPTH" });
  const role = canonicalRole(depth, input.role ?? (input.review ? "review" : "work"));
  const card = pickProfile(settings, { profile: input.profile, role });
  const explicit = (value) => typeof value === "string" && value.trim() ? value.trim() : undefined;
  return {
    ...input,
    role,
    label: explicit(input.label) ?? card.name,
    profileId: card.id,
    profileName: card.name,
    permission: role === "review" ? "read-only" : explicit(input.permission) ?? card.permission,
    agentPreset: SUPERWORK_AGENT_PRESETS.includes(explicit(input.agentPreset)) ? explicit(input.agentPreset) : card.agentPreset,
    provider: explicit(input.provider) ?? (card.provider || undefined) ?? explicit(inherited.provider),
    model: explicit(input.model) ?? (card.model || undefined) ?? explicit(inherited.model),
    reasoningEffort: explicit(input.reasoningEffort ?? input.reasoning_effort) ?? (card.reasoningEffort || undefined) ?? explicit(inherited.reasoningEffort),
    startGoal: input.startGoal ?? input.start_goal ?? card.startGoal,
    maxGoalRounds: input.maxGoalRounds ?? input.max_goal_rounds ?? card.maxGoalRounds,
    maxChildren: 0,
    roleInstructions: card.instructions,
  };
}

export function roleKeyFor(_depth, role) {
  return role === "review" ? "review" : "execution";
}
