import {
  CompanyThreadError,
  DESCRIPTOR_EVENT,
  MAIL_KINDS,
  PERMISSION_TEMPLATES,
  createDescriptor,
  foldDescriptor,
  hasCompanyThreadDescriptor,
} from "./rules.js";

export function organizationRootId(nodes, sessionId) {
  const byId = new Map((nodes ?? []).map((node) => [node.id, node]));
  let current = byId.get(sessionId);
  if (!current) return sessionId;
  const seen = new Set();
  while (current.parentId && byId.has(current.parentId) && !seen.has(current.id)) {
    seen.add(current.id);
    current = byId.get(current.parentId);
  }
  return current.id;
}

export function organizationTree(nodes, sessionId) {
  if (!sessionId) return buildTree(nodes);
  return subtreeOf(nodes, organizationRootId(nodes, sessionId));
}

export function collectOrganizationNodes(records) {
  const byId = new Map();
  const withDescriptor = [];
  for (const record of records ?? []) {
    const header = record.header ?? {};
    const events = record.events ?? [];
    const id = header.id || foldDescriptor(events)?.id;
    if (!id || header.origin === "subagent") continue;
    byId.set(id, record);
    if (hasCompanyThreadDescriptor(events) || foldDescriptor(events)) withDescriptor.push(id);
  }
  const needed = new Set(withDescriptor);
  for (const id of withDescriptor) {
    let parentId = foldDescriptor(byId.get(id)?.events)?.parentId ?? byId.get(id)?.header?.parentSession;
    const seen = new Set();
    while (parentId && byId.has(parentId) && !seen.has(parentId)) {
      needed.add(parentId);
      seen.add(parentId);
      const parent = byId.get(parentId);
      parentId = foldDescriptor(parent?.events)?.parentId ?? parent?.header?.parentSession;
    }
  }
  return [...needed].map((id) => byId.get(id)).filter(Boolean);
}

export function relaySource(kind, fromId) {
  if (kind === "user") {
    throw new CompanyThreadError("插件消息不能冒充真人", "FORBIDDEN_USER_SOURCE");
  }
  return {
    kind: kind === "report" || kind === "completion" || kind === "escalation" ? "subagent-report" : "coordinator",
    form: "relay",
    senderSessionId: fromId,
  };
}

export function assertNeverUserSource(source) {
  if (!source || source.kind === "user") {
    throw new CompanyThreadError("插件消息不能冒充真人", "FORBIDDEN_USER_SOURCE");
  }
  return source;
}

export function primaryNodes(nodes) {
  const list = nodes || [];
  if (list.length === 1 && list[0] && list[0].depth === 0) return list[0].children || [];
  return list.filter((node) => node.depth === 1);
}

export function defaultExpanded(nodes, currentId) {
  const expanded = {};
  const visit = (list, parents) => {
    for (const node of list ?? []) {
      if (node.id === currentId) {
        for (const parentId of parents) expanded[parentId] = true;
      }
      visit(node.children, [...parents, node.id]);
    }
  };
  visit(nodes, []);
  return expanded;
}

export function createOpenThreadAction({ postOpen, openSession }) {
  if (typeof postOpen !== "function" || typeof openSession !== "function") {
    throw new CompanyThreadError("打开线程需要 postOpen 和 openSession", "INVALID_OPEN");
  }
  return async function openThread(id) {
    await postOpen(id);
    openSession(id);
    return id;
  };
}

export function enqueueMessage(input) {
  const kind = input.kind;
  if (!MAIL_KINDS.includes(kind)) {
    throw new CompanyThreadError("信箱只接受派工、汇报或一级横向消息", "INVALID_MAIL");
  }
  if ((kind === "assign" || kind === "brief") && input.fromId !== input.parentId) {
    throw new CompanyThreadError("派工必须来自直接上级", "NOT_DIRECT_PARENT");
  }
  if (kind === "report" && input.toId !== input.parentId) {
    throw new CompanyThreadError("汇报必须交给直接上级", "NOT_DIRECT_PARENT");
  }
  if (kind === "peer") {
    if (input.fromId === input.toId) {
      throw new CompanyThreadError("不能给自己发横向消息", "SELF_MESSAGE");
    }
    if (!input.parentId) {
      throw new CompanyThreadError("横向消息必须带上共同的根父线程", "NOT_SAME_ROOT");
    }
  }
  const text = String(input.text || "").trim();
  if (!text) throw new CompanyThreadError("消息不能为空", "EMPTY_MESSAGE");
  return {
    id: input.id,
    kind,
    fromId: input.fromId,
    toId: input.toId,
    parentId: input.parentId,
    text,
    createdAt: input.createdAt ?? Date.now(),
  };
}

export function buildTree(nodes) {
  const byId = new Map();
  for (const node of nodes ?? []) {
    byId.set(node.id, { ...node, children: [] });
  }
  const roots = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortNodes = (list) => {
    list.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    for (const item of list) sortNodes(item.children);
  };
  sortNodes(roots);
  return roots;
}

export function subtreeOf(nodes, rootId) {
  const tree = buildTree(nodes);
  const match = (list) => {
    for (const node of list) {
      if (node.id === rootId) return [node];
      const found = match(node.children);
      if (found) return found;
    }
    return null;
  };
  return match(tree) ?? [];
}

export function inferPermissionFromEvents(events, fallback = "workspace-write") {
  const descriptor = foldDescriptor(events);
  if (descriptor?.permission && PERMISSION_TEMPLATES[descriptor.permission]) return descriptor.permission;
  let preset;
  let sandbox;
  let approval;
  for (const event of events ?? []) {
    if (event.type === "permission/preset") preset = event.data?.preset;
    if (event.type === "sandbox/mode") sandbox = event.data?.mode;
    if (event.type === "approval/policy") approval = event.data?.policy;
  }
  if (preset && PERMISSION_TEMPLATES[preset]) return preset;
  if (sandbox === "read-only") return "read-only";
  if (sandbox === "danger-full-access" && approval === "ask") return "full-controlled";
  if (sandbox === "workspace-write") return preset === "auto" ? "auto" : "workspace-write";
  return fallback;
}

export function formatModelLabel(node) {
  if (!node) return "";
  const route = [node.provider, node.model].filter(Boolean).join("/");
  if (route && node.reasoningEffort) return `${route} · ${node.reasoningEffort}`;
  if (route) return route;
  if (node.reasoningEffort) return String(node.reasoningEffort);
  return "";
}

export function renderAssignment(descriptor, brief) {
  const model = formatModelLabel(descriptor);
  const lines = [
    `你是 superwork 根线程直属的独立工作代理「${descriptor.label}」。`,
    `角色：${descriptor.role}。权限：${descriptor.permission}。工作目录：${descriptor.cwd}。`,
    model ? `模型：${model}。` : "模型：继承上级当前选择，之后可用会话原生换模。",
    "组织固定为扁平一级：根线程直接管理执行/审查代理；你不能再开下级。",
    "你是普通独立会话，不是官方子代理。父线程离线时你仍可继续工作。",
    "只能向根线程汇报，不能与执行/审查同级横向通信，不能自行提权或改变状态。",
    "你可以用 rename_self 给自己改一个贴合任务的显示名；角色、权限和状态不随名称变化。",
    descriptor.role === "review" ? "你只审固定交付版本，不修改产物；用 submit_review 提交 PASS/FAIL 原文。" : "你完成后用 submit_completion 提交逐条证据，等待根线程启动独立审查。",
    "长目标用 create_goal；普通进展用 report_to_parent 汇报。",
  ];
  if (descriptor.objective) lines.push(`目标：${descriptor.objective}`);
  if (brief) lines.push("", brief);
  return lines.join("\n");
}

export function renderReportNotice(fromLabel, text) {
  return `下级线程「${fromLabel}」汇报：\n${text}`;
}

export function renderReviewNotice(fromLabel, text) {
  return `独立审查线程「${fromLabel}」同步审查原文：\n${text}`;
}

export function renderAssignNotice(fromLabel, text) {
  return `上级线程「${fromLabel}」派工：\n${text}`;
}

export function renderContractNotice(fromLabel, text) {
  return `上级「${fromLabel}」的合同：\n${text}`;
}

export function renderCompletionNotice(fromLabel, text) {
  return `「${fromLabel}」交付/验收消息：\n${text}`;
}

export function renderEscalationNotice(fromLabel, text) {
  return `「${fromLabel}」升级/裁决：\n${text}`;
}

export function renderPeerNotice(fromLabel, text) {
  return `工作代理「${fromLabel}」来信：\n${text}`;
}

export { createDescriptor, DESCRIPTOR_EVENT };
