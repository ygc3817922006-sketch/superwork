import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { threadTitle } from "./naming.js";
import { createPlacement } from "./placement.js";
import { realpathSync, statSync } from "node:fs";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import {
  CompanyThreadError,
  DEFAULT_MAX_GOAL_ROUNDS,
  DEFAULT_PRESET,
  DESCRIPTOR_EVENT,
  MAILBOX_EVENT,
  LABEL_EVENT,
  MAX_DIRECT_CHILDREN,
  PERMISSION_TEMPLATES,
  STATUS_EVENT,
  applyInitialReasoning,
  assertAssignablePermission,
  assertCanonicalWorkspace,
  assertCanCreateChild,
  assertDirectChild,
  assertDirectParent,
  assertNeverUserSource,
  assertNoSubagentOrigin,
  createAgentOptions,
  createDescriptor,
  createSessionMeta,
  enqueueMessage,
  foldDescriptor,
  foldMailbox,
  foldRequestConfig,
  inheritModelRoute,
  isPathInside,
  nextDepth,
  organizationTree,
  relaySource,
  renderAssignNotice,
  renderContractNotice,
  renderCompletionNotice,
  renderEscalationNotice,
  renderAssignment,
  renderPeerNotice,
  renderReportNotice,
  renderReviewNotice,
  resolveComposedPreset,
  shouldApplyInitialReasoning,
  templateOf,
} from "./logic.js";
import { describeRecord, descriptorsFromRecords, loadAllRecords } from "./catalog.js";
import { applyRoleDefaults } from "./config.js";
import { createWorkflowService } from "./workflow.js";
import { createContractService } from "./contracts.js";
import { createCheckpointService } from "./checkpoints.js";
import { singleFlight } from "./concurrency.js";
export const FS_IO = { statSync, realpathSync };
export function createCompanyThreads(ctx, options = {}) {
  const handles = new Map();
  const liveFlights = new Map();
  const mailboxFlights = new Map();
  const subjectTransitions = new Map();
  const restoreBlocks = new Set();
  const fsIo = options.fs ?? FS_IO;
  async function resolveEvidence(thread, evidence) {
    if (evidence.kind !== "file" && evidence.kind !== "log") return evidence;
    let real;
    try {
      real = fsIo.realpathSync(evidence.ref);
      const stat = fsIo.statSync(real);
      if (!stat.isFile()) throw new Error("not a file");
    } catch {
      throw new CompanyThreadError(`证据文件不存在或不是普通文件：${evidence.ref}`, "INVALID_EVIDENCE_FILE");
    }
    const root = fsIo.realpathSync(thread.cwd);
    if (!isPathInside(root, real)) throw new CompanyThreadError(`证据文件必须位于线程工作区内：${real}`, "EVIDENCE_WORKSPACE_ESCAPE");
    const sha256 = await new Promise((resolve, reject) => {
      const hash = createHash("sha256");
      const stream = createReadStream(real);
      stream.on("error", reject);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
    });
    if (evidence.sha256 && String(evidence.sha256).toLowerCase() !== sha256) throw new CompanyThreadError(`证据文件 SHA256 不匹配：${real}`, "EVIDENCE_HASH_MISMATCH");
    return { ...evidence, ref: real, sha256 };
  }
  const settingsStore = options.settingsStore;
  async function withSubjectTransition(subjectId, task) {
    const previous = subjectTransitions.get(subjectId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    subjectTransitions.set(subjectId, current);
    try { return await current; }
    finally { if (subjectTransitions.get(subjectId) === current) subjectTransitions.delete(subjectId); }
  }
  async function withMailboxTransition(threadId, task) {
    const previous = mailboxFlights.get(threadId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    mailboxFlights.set(threadId, current);
    try { return await current; }
    finally { if (mailboxFlights.get(threadId) === current) mailboxFlights.delete(threadId); }
  }
  function liveAgent(id) {
    return ctx.agents.get(id);
  }
  function liveSession(id) {
    return ctx.sessions.get(id);
  }
  function query() {
    return ctx.sessionQuery ?? ctx.get("sessionQuery");
  }
  async function catalogHelpers() {
    return {
      liveAgent,
      roots: typeof ctx.agents.roots === "function" ? ctx.agents.roots() : [],
      agentPresets: ctx.get("agentPresets"),
      resolvePreset(record) {
        return resolveComposedPreset({
          header: record.header,
          events: record.events,
          liveAgent: liveAgent(record.header?.id),
          agentPresets: ctx.get("agentPresets"),
        });
      },
    };
  }
  function parentModelSource(parent, inspected) {
    const live = liveAgent(parent.id);
    const events = inspected?.events ?? live?.session?.events ?? [];
    return {
      requestHeaderConfig: foldRequestConfig(events),
      agentOptions: live?.options ?? {},
      provider: parent.provider,
      model: parent.model,
      reasoningEffort: parent.reasoningEffort,
    };
  }
  async function resolveRoute(parent, input, inspected) {
    const route = inheritModelRoute(parentModelSource(parent, inspected), {
      provider: input.provider,
      model: input.model,
      reasoningEffort: input.reasoningEffort ?? input.reasoning_effort,
    });
    const llm = ctx.get("llm");
    if (llm && typeof llm.resolveCallConfig === "function" && route.provider && route.model) {
      const resolved = await llm.resolveCallConfig({
        provider: route.provider,
        model: route.model,
        ...route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {},
      });
      return inheritModelRoute({}, resolved);
    }
    return route;
  }
  function installInitialReasoning(childCtx, reasoningEffort) {
    if (!shouldApplyInitialReasoning(childCtx.agent?.session, reasoningEffort)) return;
    let used = false;
    childCtx.on("agent/request", async (_payload, next) => {
      const resolved = await next();
      if (used) return resolved;
      const session = childCtx.agent?.session;
      if (!shouldApplyInitialReasoning(session, reasoningEffort)) return resolved;
      used = true;
      return applyInitialReasoning(resolved, reasoningEffort, false);
    });
  }
  async function inspectSession(id) {
    const live = liveSession(id);
    if (live) {
      return { header: live.header, events: live.events, live: true, session: live };
    }
    const sessionQuery = query();
    if (sessionQuery && typeof sessionQuery.readSession === "function") {
      try {
        const loaded = await sessionQuery.readSession(id);
        return { header: loaded.session ?? loaded.header ?? loaded.meta, events: loaded.events ?? [], live: false };
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
  const { placeUnderParent, decorateThread, ensureGrouped, unarchiveSession, keepVisible } = createPlacement(ctx, { listDescriptors });
  async function listDescriptors() {
    const records = await loadAllRecords({
      sessions: ctx.sessions,
      inspectSession,
      listSessions: query()?.listSessions?.bind(query()),
    });
    return descriptorsFromRecords(records, await catalogHelpers());
  }
  async function getDescriptor(id) {
    const inspected = await inspectSession(id);
    if (!inspected) return undefined;
    const fromRecord = describeRecord(inspected, await catalogHelpers());
    if (fromRecord) return fromRecord;
    const listed = await listDescriptors();
    return listed.find((item) => item.id === id);
  }
  async function requireDescriptor(id) {
    const descriptor = await getDescriptor(id);
    if (!descriptor) throw new CompanyThreadError(`找不到线程 ${id}`, "THREAD_NOT_FOUND");
    return descriptor;
  }
  function appendEvent(session, type, data) {
    return session.append(type, data);
  }
  function applyPermission(session, permission) {
    const template = templateOf(permission);
    const presets = ctx.get("permissionPresets");
    if (presets && typeof presets.set === "function" && presets.names?.includes(template.id)) {
      presets.set(session, template.id);
      return template;
    }
    if (presets && typeof presets.set === "function" && template.id === "full-controlled" && presets.names?.includes("danger-full-access")) {
      appendEvent(session, "permission/preset", { preset: "full-controlled" });
      session.append("sandbox/mode", { mode: "danger-full-access", source: "thread-template" });
      session.append("approval/policy", { policy: "ask", source: "thread-template" });
      return template;
    }
    appendEvent(session, "permission/preset", { preset: template.id });
    session.append("sandbox/mode", { mode: template.sandbox, source: "thread-template" });
    session.append("approval/policy", { policy: template.approval, source: "thread-template" });
    return template;
  }
  function rememberHandle(handle) {
    handles.set(handle.agent.id, handle);
    return handle;
  }
  function forgetHandle(id) {
    const handle = handles.get(id);
    handles.delete(id);
    return handle;
  }
  function composeSetup(presetId, reasoningEffort) {
    return async (childCtx) => {
      const presets = childCtx.get("agentPresets") ?? ctx.get("agentPresets");
      const requested = presetId || DEFAULT_PRESET;
      if (presets && typeof presets.mount === "function" && requested) {
        await presets.mount(childCtx, requested);
      }
      const composed = resolveComposedPreset({
        header: { agentPreset: requested },
        liveAgent: childCtx.agent,
        agentPresets: presets,
      });
      if (composed && composed !== requested) {
        throw new CompanyThreadError(`线程预设必须是 ${requested}，当前是 ${composed}`, "PRESET_MISMATCH");
      }
      if (shouldApplyInitialReasoning(childCtx.agent?.session, reasoningEffort)) {
        installInitialReasoning(childCtx, reasoningEffort);
      }
    };
  }
  function resumeOptions(id, inspected) {
    const descriptor = foldDescriptor(inspected?.events ?? []);
    const header = inspected?.header ?? {};
    const route = inheritModelRoute({
      requestHeaderConfig: foldRequestConfig(inspected?.events ?? []),
      provider: descriptor?.provider,
      model: descriptor?.model,
      reasoningEffort: descriptor?.reasoningEffort,
    }, {});
    return {
      resumeSessionId: SessionId(id),
      agentOptions: createAgentOptions(route),
      setup: composeSetup(descriptor?.agentPreset || header.agentPreset || DEFAULT_PRESET, descriptor?.reasoningEffort || route.reasoningEffort),
    };
  }
  async function ensureLive(id) {
    const existing = liveAgent(id);
    if (existing) return existing;
    return singleFlight(liveFlights, id, async () => {
      const raced = liveAgent(id);
      if (raced) return raced;
      const inspected = await inspectSession(id);
      const handle = await ctx.agents.resume(resumeOptions(id, inspected));
      rememberHandle(handle);
      if (!restoreBlocks.has(id)) await checkpoints.restoreCheckpoint(id);
      return handle.agent;
    });
  }
  function noticeFor(item, fromLabel) {
    if (item.kind === "report") return renderReportNotice(fromLabel, item.text);
    if (item.kind === "review") return renderReviewNotice(fromLabel, item.text);
    if (item.kind === "peer") return renderPeerNotice(fromLabel, item.text);
    if (item.kind === "brief") return item.text;
    if (item.kind === "contract") return renderContractNotice(fromLabel, item.text);
    if (item.kind === "completion") return renderCompletionNotice(fromLabel, item.text);
    if (item.kind === "escalation") return renderEscalationNotice(fromLabel, item.text);
    return renderAssignNotice(fromLabel, item.text);
  }
  async function deliverTo(id, text, source) {
    const agent = await ensureLive(id);
    const message = createUserMessage({
      content: [{ type: "text", text }],
      source: assertNeverUserSource(source),
    });
    agent.followup(message);
    return { messageId: message.id, delivered: true };
  }
  async function sessionForMailbox(toId) {
    const live = liveSession(toId);
    if (live) return live;
    return (await ensureLive(toId)).session;
  }
  async function enqueuePersistent(toId, message) {
    const session = await sessionForMailbox(toId);
    appendEvent(session, MAILBOX_EVENT, { op: "enqueue", message });
    return session;
  }
  async function deliverMailbox(toId, message, fromLabel) {
    // 先恢复会话，再进入信箱事务；恢复回调可能自行 drain，不能在持锁时等待它。
    await sessionForMailbox(toId);
    return withMailboxTransition(toId, async () => {
      const session = await enqueuePersistent(toId, message);
      const result = await deliverTo(toId, noticeFor(message, fromLabel), relaySource(message.kind, message.fromId));
      appendEvent(session, MAILBOX_EVENT, { op: "ack", messageId: message.id, deliveredMessageId: result.messageId });
      return { message, delivered: true, queued: false, deliveredMessageId: result.messageId };
    });
  }
  async function drainMailbox(id) {
    const session = liveSession(id) ?? (await ensureLive(id)).session;
    return withMailboxTransition(id, async () => {
      const pending = foldMailbox(session.events, id);
      const delivered = [];
      for (const item of pending) {
        const from = await getDescriptor(item.fromId);
        const result = await deliverTo(id, noticeFor(item, from?.label ?? item.fromId), relaySource(item.kind, item.fromId));
        appendEvent(session, MAILBOX_EVENT, { op: "ack", messageId: item.id, deliveredMessageId: result.messageId });
        delivered.push({ ...item, deliveredMessageId: result.messageId });
      }
      return delivered;
    });
  }
  async function createThread(input) {
    const parent = await requireDescriptor(input.parentId);
    const settings = settingsStore ? await settingsStore.read() : undefined;
    if ((parent.depth ?? 0) !== 0 || parent.parentId) throw new CompanyThreadError("只有根线程可以创建直属工作代理", "ROOT_ONLY_CREATE");
    if (input.role && input.role !== "work" && input.role !== "review") throw new CompanyThreadError("工作代理角色只能是 work 或 review", "INVALID_ROLE");
    const depth = nextDepth(parent.depth);
    const parentRecord = await inspectSession(parent.id);
    const inheritedRoute = await resolveRoute(parent, input, parentRecord);
    input = applyRoleDefaults(input, depth, settings, inheritedRoute);
    const siblings = (await listDescriptors()).filter((item) => item.parentId === parent.id);
    assertCanCreateChild(parent, siblings.filter((item) => (item.depth ?? 0) > 0).length);
    const permission = assertAssignablePermission(parent.permission, input.permission || parent.permission);
    const cwd = assertCanonicalWorkspace(parent, input.cwd || parent.cwd, fsIo);
    const route = await resolveRoute(parent, input, parentRecord);
    const childId = SessionId(input.sessionId || randomUUID());
    const descriptor = createDescriptor({
      id: childId,
      parentId: parent.id,
      label: input.label,
      role: input.role || (input.review ? "review" : "work"),
      profileId: input.profileId,
      permission: permission.id,
      cwd,
      depth,
      status: "running",
      objective: input.objective || input.brief || "",
      agentPreset: input.agentPreset || parent.agentPreset || DEFAULT_PRESET,
      maxChildren: input.maxChildren ?? MAX_DIRECT_CHILDREN,
      provider: route.provider,
      model: route.model,
      reasoningEffort: route.reasoningEffort,
    });
    const meta = assertNoSubagentOrigin(createSessionMeta(descriptor));
    const handle = await ctx.agents.create({
      sessionId: childId,
      meta,
      agentOptions: createAgentOptions(route),
      setup: composeSetup(descriptor.agentPreset, route.reasoningEffort),
    });
    if (typeof ctx.agents.roots === "function" && !ctx.agents.roots().includes(handle.agent)) {
      if (typeof handle.dispose === "function") await handle.dispose();
      throw new CompanyThreadError("独立线程必须由主机根作用域持有", "NOT_ROOT_OWNER");
    }
    rememberHandle(handle);
    const session = handle.agent.session;
    appendEvent(session, DESCRIPTOR_EVENT, descriptor);
    applyPermission(session, descriptor.permission);
    const titles = ctx.get("sessionTitles") ?? ctx.get("sessionTitle");
    if (titles && typeof titles.rename === "function") {
      try {
        titles.rename(session, threadTitle(descriptor));
      } catch {}
    }
    // 所有工作代理都是根线程的一层直属会话，只需挂进工作区分组。
    await ensureGrouped(descriptor);
    const workspaceRegistry = ctx.get("workspaceRegistry");
    if (workspaceRegistry && typeof workspaceRegistry.archiveSession === "function") {
      try { await workspaceRegistry.archiveSession(descriptor.id); }
      catch (error) { ctx.logger?.warn?.(`superwork: 新建工作代理即时归档失败 ${descriptor.id}：${error?.message ?? error}`); }
    }
    const taskBrief = [input.roleInstructions, input.brief || input.objective || ""].filter(Boolean).join("\n\n");
    const brief = renderAssignment(descriptor, taskBrief);
    await deliverMailbox(descriptor.id, enqueueMessage({
      id: randomUUID(),
      kind: "brief",
      fromId: parent.id,
      toId: descriptor.id,
      parentId: parent.id,
      text: brief,
    }), parent.label);
    if (input.startGoal && descriptor.objective) {
      const goals = ctx.get("goals");
      if (goals && typeof goals.create === "function") {
        goals.create(handle.agent, {
          objective: descriptor.objective,
          maxGoalRounds: input.maxGoalRounds ?? DEFAULT_MAX_GOAL_ROUNDS,
        });
      }
    }
    return { ...descriptor, live: true, running: true };
  }
  async function assign(input) {
    const parent = await requireDescriptor(input.parentId);
    const child = await requireDescriptor(input.childId);
    assertDirectChild(parent.id, child);
    await workflow.assertAssignmentAllowed(parent, child);
    const message = enqueueMessage({
      id: randomUUID(),
      kind: "assign",
      fromId: parent.id,
      toId: child.id,
      parentId: parent.id,
      text: input.text,
    });
    return deliverMailbox(child.id, message, parent.label);
  }
  async function report(input) {
    const child = await requireDescriptor(input.childId);
    if (!child.parentId) throw new CompanyThreadError("根线程没有上级可汇报", "NO_PARENT");
    assertDirectParent(child, child.parentId);
    const parent = await requireDescriptor(child.parentId);
    const message = enqueueMessage({
      id: randomUUID(),
      kind: "report",
      fromId: child.id,
      toId: parent.id,
      parentId: parent.id,
      text: input.text,
    });
    return deliverMailbox(parent.id, message, child.label);
  }
  async function tree(sessionId) {
    const nodes = await listDescriptors();
    return organizationTree(nodes, sessionId);
  }
  async function open(id) {
    const descriptor = await requireDescriptor(id);
    // 归档中的线程先解档并登记「保持可见」，否则官方运行时选中后会立刻清空选中（回首页）
    keepVisible.add(id);
    await unarchiveSession(id);
    await ensureLive(id);
    await drainMailbox(id);
    return { ...descriptor, live: true };
  }
  // 把线程归档（藏出左栏与组织页；非删除，历史保留）。组织页口径：归档的主线程/一级整棵不显示。
  async function archiveThread(id) {
    await requireDescriptor(id);
    keepVisible.delete(id);
    const registry = ctx.get("workspaceRegistry");
    if (registry && typeof registry.archiveSession === "function") await registry.archiveSession(id);
    return { ok: true };
  }
  // 用户从该线程切走后调用：撤销「保持可见」，工作代理重新归档出左栏
  async function release(id) {
    keepVisible.delete(id);
    const descriptor = await getDescriptor(id);
    if (descriptor && (descriptor.depth ?? 0) >= 1) {
      const registry = ctx.get("workspaceRegistry");
      if (registry && typeof registry.archiveSession === "function") {
        try { await registry.archiveSession(id); } catch {}
      }
    }
    return { ok: true };
  }
  async function setStatus(id, status) {
    let session = liveSession(id);
    const inactive = status === "complete" || status === "paused";
    if (!session && inactive) restoreBlocks.add(id);
    try {
      session ??= (await ensureLive(id)).session;
      appendEvent(session, STATUS_EVENT, { status, updatedAt: Date.now() });
    } finally {
      if (inactive) restoreBlocks.delete(id);
    }
    return getDescriptor(id);
  }
  async function renameSelf(id, label) {
    const descriptor = await requireDescriptor(id);
    if (!descriptor.parentId || descriptor.depth !== 1 || (descriptor.role !== "work" && descriptor.role !== "review")) {
      throw new CompanyThreadError("只有直属执行/审查代理可以给自己更名", "RENAME_NOT_WORKER");
    }
    const nextLabel = String(label || "").trim();
    if (!nextLabel) throw new CompanyThreadError("新名称不能为空", "EMPTY_THREAD_LABEL");
    if (nextLabel.length > 48) throw new CompanyThreadError("新名称不能超过 48 个字符", "THREAD_LABEL_TOO_LONG");
    const session = liveSession(id) ?? (await ensureLive(id)).session;
    appendEvent(session, LABEL_EVENT, { label: nextLabel, updatedAt: Date.now() });
    const next = { ...descriptor, label: nextLabel, updatedAt: Date.now() };
    const titles = ctx.get("sessionTitles") ?? ctx.get("sessionTitle");
    if (titles && typeof titles.rename === "function") titles.rename(session, threadTitle(next));
    return next;
  }
  let contracts;
  const workflow = createWorkflowService({
    withSubjectTransition,
    requireDescriptor,
    sessionFor: sessionForMailbox,
    appendEvent,
    deliverMailbox,
    setStatus,
    async latestPendingCompletion(ownerId, subjectId) {
      const contract = await contracts.contractFor(subjectId, ownerId);
      const completion = contract ? [...contract.completions].reverse().find((item) => item.verdict === "pending") : undefined;
      return { contract, completion };
    },
    rejectCompletion(ownerId, subjectId, note) {
      return contracts.rejectCompletionUnlocked({ issuerId: ownerId, threadId: subjectId, note });
    },
    invalidatePendingCompletion(ownerId, subjectId, reason) {
      return contracts.invalidatePendingCompletionUnlocked({ issuerId: ownerId, threadId: subjectId, reason });
    },
  });
  contracts = createContractService({
    withSubjectTransition,
    requireDescriptor,
    sessionFor: sessionForMailbox,
    appendEvent,
    deliverMailbox,
    setStatus,
    resolveEvidence,
    reviewState: (managerId, subjectId) => workflow.workflowState(managerId, subjectId),
    onNewWork: (issuer, thread) => workflow.assertAssignmentAllowedUnlocked(issuer, thread),
  });
  const checkpoints = createCheckpointService({
    requireDescriptor,
    sessionFor: sessionForMailbox,
    appendEvent,
    deliverTo,
    canRestore: (id) => !restoreBlocks.has(id),
  });
  const { rejectCompletionUnlocked: _rejectCompletionUnlocked, invalidatePendingCompletionUnlocked: _invalidatePendingCompletionUnlocked, ...contractApi } = contracts;
  const { assertAssignmentAllowedUnlocked: _assertAssignmentAllowedUnlocked, ...workflowApi } = workflow;
  return {
    templates: PERMISSION_TEMPLATES,
    settingsStore,
    listDescriptors,
    getDescriptor,
    requireDescriptor,
    createThread,
    assign,
    report,
    tree,
    open,
    release,
    archiveThread,
    keepVisible,
    drainMailbox,
    setStatus,
    renameSelf,
    ensureLive,
    forgetHandle,
    decorateThread,
    ...contractApi,
    ...checkpoints,
    ...workflowApi,
    CompanyThreadError,
  };
}
