import test from "node:test";
import assert from "node:assert/strict";
import {
  CompanyThreadError,
  MAX_DEPTH,
  PERMISSION_TEMPLATES,
  applyInitialReasoning,
  assertAssignablePermission,
  assertAssignableWorkspace,
  assertCanCreateChild,
  assertCanonicalWorkspace,
  assertDirectChild,
  assertDirectParent,
  assertNeverUserSource,
  assertNoSubagentOrigin,
  assertPeerMessage,
  buildTree,
  collectOrganizationNodes,
  createOpenThreadAction,
  createAgentOptions,
  createDescriptor,
  createSessionMeta,
  enqueueMessage,
  foldDescriptor,
  foldMailbox,
  foldRequestConfig,
  inferPermissionFromEvents,
  inheritModelRoute,
  isLiveXiaokRoot,
  isPathInside,
  isXiaokPreset,
  nextDepth,
  resolveComposedPreset,
  normalizeAbsolutePath,
  organizationRootId,
  organizationTree,
  primaryNodes,
  relaySource,
  renderAssignment,
  shouldApplyInitialReasoning,
  subtreeOf,
} from "./logic.js";

test("permission cannot escalate", () => {
  assert.equal(assertAssignablePermission("full-controlled", "read-only").id, "read-only");
  assert.equal(assertAssignablePermission("workspace-write", "auto").id, "auto");
  assert.throws(() => assertAssignablePermission("read-only", "full-controlled"), (error) => error instanceof CompanyThreadError && error.code === "PERMISSION_ESCALATION");
});

test("full-controlled keeps approval ask", () => {
  assert.equal(PERMISSION_TEMPLATES["full-controlled"].sandbox, "danger-full-access");
  assert.equal(PERMISSION_TEMPLATES["full-controlled"].approval, "ask");
  assert.notEqual(PERMISSION_TEMPLATES["full-controlled"].approval, "never");
});

test("workspace must stay inside parent unless parent is full-controlled", () => {
  const limited = { permission: "workspace-write", cwd: "/Users/yu/project-a" };
  assert.equal(assertAssignableWorkspace(limited, "/Users/yu/project-a/src"), "/Users/yu/project-a/src");
  assert.throws(() => assertAssignableWorkspace(limited, "/Users/yu/project-b"), (error) => error.code === "WORKSPACE_ESCAPE");
  const wide = { permission: "full-controlled", cwd: "/Users/yu/project-a" };
  assert.equal(assertAssignableWorkspace(wide, "/Users/yu/project-b"), "/Users/yu/project-b");
});

test("session meta never writes origin", () => {
  const descriptor = createDescriptor({
    id: "child",
    parentId: "parent",
    label: "审查",
    role: "review",
    permission: "read-only",
    cwd: "/Users/yu/project-a",
    depth: 1,
    provider: "opencodex",
    model: "gpt-5.4",
    reasoningEffort: "high",
  });
  const meta = createSessionMeta(descriptor);
  assert.equal(meta.parentSession, "parent");
  assert.equal(meta.cwd, "/Users/yu/project-a");
  assert.equal(meta.delegationDepth, 1);
  assert.equal(Object.hasOwn(meta, "origin"), false);
  assert.equal(descriptor.provider, "opencodex");
  assert.equal(descriptor.model, "gpt-5.4");
  assert.equal(descriptor.reasoningEffort, "high");
  assert.throws(() => assertNoSubagentOrigin({ origin: "subagent" }), (error) => error.code === "FORBIDDEN_ORIGIN");
});

test("organization is flat at one worker level", () => {
  assert.equal(MAX_DEPTH, 1);
  assert.equal(nextDepth(0), 1);
  assert.throws(() => nextDepth(1), (error) => error.code === "MAX_DEPTH");
  assert.throws(() => assertCanCreateChild({ id: "worker", status: "idle", depth: 1, maxChildren: 0 }, 0), (error) => error.code === "MAX_DEPTH");
  assert.throws(() => assertCanCreateChild({ id: "p", status: "idle", depth: 0, maxChildren: 1 }, 1), (error) => error.code === "MAX_CHILDREN");
});

test("flat workers cannot message peers", () => {
  const root = createDescriptor({ id: "root", label: "小K", permission: "full-controlled", cwd: "/Users/yu", depth: 0 });
  const a = createDescriptor({ id: "a", parentId: "root", label: "项目甲", permission: "workspace-write", cwd: "/Users/yu/a", depth: 1 });
  const b = createDescriptor({ id: "b", parentId: "root", label: "项目乙", permission: "workspace-write", cwd: "/Users/yu/b", depth: 1 });
  assert.throws(() => assertPeerMessage(a, b), (error) => error.code === "NOT_PEER");
  assert.throws(() => assertPeerMessage(root, a), (error) => error.code === "NOT_PEER");
  assert.throws(() => enqueueMessage({ id: "p2", kind: "peer", fromId: "a", toId: "a", parentId: "root", text: "自己" }), (error) => error.code === "SELF_MESSAGE");
});

test("tree and mailbox stay root-worker only for assign/report", () => {
  const nodes = [
    createDescriptor({ id: "root", label: "小K", permission: "full-controlled", cwd: "/Users/yu", depth: 0 }),
    createDescriptor({ id: "w1", parentId: "root", label: "执行", role: "work", permission: "workspace-write", cwd: "/Users/yu/a", depth: 1 }),
    createDescriptor({ id: "r1", parentId: "root", label: "审查", role: "review", permission: "read-only", cwd: "/Users/yu/a", depth: 1 }),
  ];
  const tree = buildTree(nodes);
  assert.deepEqual(tree[0].children.map((node) => node.id), ["w1", "r1"]);
  assert.equal(subtreeOf(nodes, "root")[0].children[1].id, "r1");
  assertDirectChild("root", nodes[2]);
  assertDirectParent(nodes[2], "root");
  const mail = enqueueMessage({ id: "m1", kind: "report", fromId: "r1", toId: "root", parentId: "root", text: "审查通过" });
  assert.equal(mail.kind, "report");
  assert.throws(() => enqueueMessage({ id: "m2", kind: "report", fromId: "r1", toId: "w1", parentId: "root", text: "横向" }), (error) => error.code === "NOT_DIRECT_PARENT");
});

test("fold descriptor last-wins and mailbox ack", () => {
  const events = [
    { type: "company-thread/descriptor", data: { id: "x", permission: "read-only", status: "idle", model: "gpt-5.4" } },
    { type: "company-thread/status", data: { status: "running", updatedAt: 2 } },
    { type: "company-thread/mailbox", data: { op: "enqueue", message: { id: "m1", toId: "x", text: "hi" } } },
    { type: "company-thread/mailbox", data: { op: "ack", messageId: "m1" } },
    { type: "company-thread/mailbox", data: { op: "enqueue", message: { id: "m2", toId: "x", text: "later" } } },
  ];
  assert.equal(foldDescriptor(events).status, "running");
  assert.equal(foldDescriptor(events).model, "gpt-5.4");
  assert.deepEqual(foldMailbox(events, "x").map((item) => item.id), ["m2"]);
});

test("model inherits from request header then agent options; explicit wins", () => {
  const inherited = inheritModelRoute({
    requestHeaderConfig: { provider: "header-p", model: "header-m", reasoningEffort: "medium" },
    agentOptions: { provider: "opt-p", model: "opt-m", reasoningEffort: "low" },
  }, {});
  assert.deepEqual(inherited, { provider: "header-p", model: "header-m", reasoningEffort: "medium" });
  const fromOptions = inheritModelRoute({
    agentOptions: { provider: "opt-p", model: "opt-m" },
  }, {});
  assert.deepEqual(fromOptions, { provider: "opt-p", model: "opt-m" });
  const explicit = inheritModelRoute({
    requestHeaderConfig: { provider: "header-p", model: "header-m", reasoningEffort: "medium" },
  }, { provider: "xai", model: "grok-4.6", reasoning_effort: "high" });
  assert.deepEqual(explicit, { provider: "xai", model: "grok-4.6", reasoningEffort: "high" });
  assert.deepEqual(createAgentOptions(explicit), { provider: "xai", model: "grok-4.6" });
});

test("initial reasoning is applied only before the first request header", () => {
  assert.equal(shouldApplyInitialReasoning([], "high"), true);
  assert.equal(shouldApplyInitialReasoning([{ type: "request/header", data: { header: { config: { model: "a" } } } }], "high"), false);
  assert.equal(shouldApplyInitialReasoning([], ""), false);
  const applied = applyInitialReasoning({ provider: "xai", model: "grok" }, "high", false);
  assert.equal(applied.reasoningEffort, "high");
  const skipped = applyInitialReasoning({ provider: "xai", model: "grok" }, "high", true);
  assert.equal(Object.hasOwn(skipped, "reasoningEffort"), false);
  assert.deepEqual(foldRequestConfig([
    { type: "request/header", data: { header: { config: { provider: "a", model: "m1" } } } },
    { type: "request/header", data: { header: { config: { provider: "b", model: "m2", reasoningEffort: "low" } } } },
  ]), { provider: "b", model: "m2", reasoningEffort: "low" });
});

test("path helpers and permission inference", () => {
  assert.equal(normalizeAbsolutePath("/Users/yu/../yu/a/./b"), "/Users/yu/a/b");
  assert.equal(isPathInside("/Users/yu/a", "/Users/yu/a/b"), true);
  assert.equal(inferPermissionFromEvents([{ type: "sandbox/mode", data: { mode: "danger-full-access" } }, { type: "approval/policy", data: { policy: "ask" } }]), "full-controlled");
  const assignment = renderAssignment({
    label: "审查",
    role: "review",
    permission: "read-only",
    cwd: "/Users/yu/a",
    objective: "独立验收",
    provider: "xai",
    model: "grok-4.6",
    reasoningEffort: "high",
  }, "核权限");
  assert.match(assignment, /不是官方子代理/);
  assert.match(assignment, /独立验收/);
  assert.match(assignment, /xai\/grok-4.6/);
  assert.match(assignment, /不能再开下级/);
});

test("canonical workspace rejects symlink escape", () => {
  const parent = { permission: "workspace-write", cwd: "/tmp/company-parent" };
  const io = {
    statSync(path) {
      if (path === "/tmp/company-parent" || path === "/tmp/company-parent/inside" || path === "/tmp/company-parent/escape") {
        return { isDirectory: () => true };
      }
      throw new Error("missing");
    },
    realpathSync(path) {
      if (path === "/tmp/company-parent") return "/tmp/company-parent";
      if (path === "/tmp/company-parent/inside") return "/tmp/company-parent/inside";
      if (path === "/tmp/company-parent/escape") return "/tmp/outside";
      throw new Error("missing");
    },
  };
  assert.equal(assertCanonicalWorkspace(parent, "/tmp/company-parent/inside", io), "/tmp/company-parent/inside");
  assert.throws(() => assertCanonicalWorkspace(parent, "/tmp/company-parent/escape", io), (error) => error.code === "WORKSPACE_ESCAPE");
  assert.throws(() => assertCanonicalWorkspace(parent, "/tmp/missing", io), (error) => error.code === "INVALID_CWD");
});

test("organization tree from any depth returns the same root", () => {
  const nodes = [
    createDescriptor({ id: "root", label: "小K", permission: "full-controlled", cwd: "/Users/yu", depth: 0 }),
    createDescriptor({ id: "w1", parentId: "root", label: "执行", role: "work", permission: "workspace-write", cwd: "/Users/yu/a", depth: 1 }),
    createDescriptor({ id: "r1", parentId: "root", label: "审查", role: "review", permission: "read-only", cwd: "/Users/yu/a", depth: 1 }),
  ];
  assert.equal(organizationRootId(nodes, "r1"), "root");
  assert.equal(organizationTree(nodes, "r1")[0].id, "root");
  assert.equal(organizationTree(nodes, "w1")[0].children[1].id, "r1");
  assert.deepEqual(primaryNodes(organizationTree(nodes, "r1")).map((node) => node.id), ["w1", "r1"]);
});

test("every live ordinary runtime root stands in for a missing descriptor", () => {
  const agent = { id: "root", ctx: {} };
  agent.ctx.agent = agent;
  assert.equal(isXiaokPreset("xiaok"), true);
  assert.equal(isXiaokPreset("code"), false);
  assert.equal(resolveComposedPreset({
    header: { agentPreset: "code" },
    liveAgent: agent,
    agentPresets: { composedPreset: () => "xiaok" },
  }), "xiaok");
  assert.equal(isLiveXiaokRoot({
    id: "root",
    header: { id: "root", cwd: "/Users/yu", agentPreset: "xiaok" },
    liveAgent: agent,
    roots: [agent],
  }), true);
  assert.equal(isLiveXiaokRoot({
    id: "root",
    header: { id: "root", cwd: "/Users/yu", agentPreset: "code" },
    liveAgent: agent,
    roots: [agent],
  }), true);
  assert.equal(isLiveXiaokRoot({
    id: "root",
    header: { id: "root", cwd: "/Users/yu", agentPreset: "xiaok", parentSession: "other" },
    liveAgent: agent,
    roots: [agent],
  }), false);
  assert.equal(isLiveXiaokRoot({
    id: "root",
    header: { id: "root", cwd: "/Users/yu", agentPreset: "xiaok-creative" },
    liveAgent: agent,
    roots: [agent],
  }), true);
});

test("organization listing keeps only descriptor threads and needed ancestors", () => {
  const records = [
    { header: { id: "plain", cwd: "/Users/yu/plain" }, events: [] },
    { header: { id: "root", cwd: "/Users/yu" }, events: [{ type: "company-thread/descriptor", data: { id: "root", parentId: null } }] },
    { header: { id: "child", parentSession: "root", cwd: "/Users/yu/a" }, events: [{ type: "company-thread/descriptor", data: { id: "child", parentId: "root" } }] },
  ];
  assert.deepEqual(collectOrganizationNodes(records).map((item) => item.header.id).sort(), ["child", "root"]);
});

test("plugin messages cannot impersonate the user", () => {
  assert.equal(relaySource("brief", "root").kind, "coordinator");
  assert.equal(relaySource("report", "child").kind, "subagent-report");
  assert.throws(() => relaySource("user", "root"), (error) => error.code === "FORBIDDEN_USER_SOURCE");
  assert.throws(() => assertNeverUserSource({ kind: "user" }), (error) => error.code === "FORBIDDEN_USER_SOURCE");
  assert.throws(() => assertNeverUserSource(undefined), (error) => error.code === "FORBIDDEN_USER_SOURCE");
});

test("open thread posts then opens the session", async () => {
  const calls = [];
  const openThread = createOpenThreadAction({
    postOpen: async (id) => { calls.push(`post:${id}`); },
    openSession: (id) => { calls.push(`open:${id}`); },
  });
  await openThread("child");
  assert.deepEqual(calls, ["post:child", "open:child"]);
});
