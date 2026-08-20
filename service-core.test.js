import test from "node:test";
import assert from "node:assert/strict";
import { createCompanyThreads } from "./index.js";
import { defaultFs, makeAgent, makeCtx, makeSession, rootDescriptor } from "./test-harness.js";

test("creates an independent session without subagent origin and with own cwd", async () => {
  const rootSession = makeSession("root", { id: "root", cwd: "/Users/yu", createdAt: 1 });
  rootSession.append("company-thread/descriptor", { ...rootDescriptor(), status: "idle" });
  const { ctx, sessions } = makeCtx({
    sessions: { root: rootSession },
    agents: { root: makeAgent(rootSession, { options: { provider: "inherit-p", model: "inherit-m" } }) },
  });
  const api = createCompanyThreads(ctx, { fs: defaultFs });
  const child = await api.createThread({
    parentId: "root",
    label: "项目甲",
    cwd: "/Users/yu/project-a",
    permission: "workspace-write",
    brief: "实现插件",
    startGoal: true,
    provider: "xai",
    model: "grok-4.6",
    reasoningEffort: "high",
  });
  assert.equal(child.parentId, "root");
  assert.equal(child.cwd, "/Users/yu/project-a");
  assert.equal(child.depth, 1);
  assert.equal(child.provider, "xai");
  assert.equal(child.model, "grok-4.6");
  assert.equal(child.reasoningEffort, "high");
  assert.equal(Object.hasOwn(sessions.get(child.id).header, "origin"), false);
  assert.equal(sessions.get(child.id).header.parentSession, "root");
  assert.equal(ctx.agents.roots().includes(ctx.created[0].agent), true);
  assert.deepEqual(ctx.created[0].agentOptions, { provider: "xai", model: "grok-4.6" });
  assert.equal(ctx.goals[0].objective, "实现插件");
  const events = sessions.get(child.id).events;
  assert.ok(events.some((event) => event.type === "company-thread/descriptor"));
  const messages = events.filter((event) => event.type === "user/message");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].data.source.kind, "coordinator");
  assert.equal(messages[0].data.source.senderSessionId, "root");
  assert.ok(events.some((event) => event.type === "company-thread/mailbox" && event.data.op === "ack"));
  const setupCtx = ctx.created[0].setupCtx;
  const first = await setupCtx.handlers["agent/request"]({}, async () => ({ provider: "xai", model: "grok-4.6" }));
  assert.equal(first.reasoningEffort, "high");
  sessions.get(child.id).append("request/header", { header: { config: first } });
  const later = await setupCtx.handlers["agent/request"]({}, async () => ({ provider: "native", model: "changed" }));
  assert.equal(Object.hasOwn(later, "reasoningEffort"), false);
  const again = await api.drainMailbox(child.id);
  assert.equal(again.length, 0);
});

test("rejects create when the new agent is not a runtime root", async () => {
  const rootSession = makeSession("root", { id: "root", cwd: "/Users/yu", createdAt: 1 });
  rootSession.append("company-thread/descriptor", rootDescriptor());
  const { ctx } = makeCtx({
    sessions: { root: rootSession },
    agents: { root: makeAgent(rootSession) },
    rootOwner: false,
  });
  const api = createCompanyThreads(ctx, { fs: defaultFs });
  await assert.rejects(() => api.createThread({
    parentId: "root",
    label: "假根",
    cwd: "/Users/yu/project-a",
    permission: "workspace-write",
    brief: "必须是 root owner",
  }), (error) => error.code === "NOT_ROOT_OWNER");
  assert.equal(ctx.sessions.list().some((session) => session.id !== "root"), false);
});

test("worker cannot create children or escalate permission", async () => {
  const rootSession = makeSession("root", { id: "root", cwd: "/Users/yu", createdAt: 1 });
  rootSession.append("company-thread/descriptor", { ...rootDescriptor(), permission: "workspace-write" });
  const workerSession = makeSession("worker", { id: "worker", cwd: "/Users/yu/a", parentSession: "root", createdAt: 2 });
  workerSession.append("company-thread/descriptor", {
    id: "worker", parentId: "root", label: "执行", role: "work", permission: "workspace-write", cwd: "/Users/yu/a", depth: 1, agentPreset: "xiaok",
  });
  const { ctx } = makeCtx({
    sessions: { root: rootSession, worker: workerSession },
    agents: { root: makeAgent(rootSession), worker: makeAgent(workerSession) },
  });
  const api = createCompanyThreads(ctx, { fs: defaultFs });
  await assert.rejects(() => api.createThread({ parentId: "worker", role: "work", label: "下级", cwd: "/Users/yu/a", brief: "禁止嵌套" }), (error) => error.code === "ROOT_ONLY_CREATE");
  await assert.rejects(() => api.createThread({
    parentId: "root",
    label: "非法提权",
    cwd: "/Users/yu/b",
    permission: "full-controlled",
    brief: "不行",
  }), (error) => error.code === "PERMISSION_ESCALATION" || error.code === "WORKSPACE_ESCAPE");
});

test("inherits model from parent request header when create_thread omits it", async () => {
  const rootSession = makeSession("root", { id: "root", cwd: "/Users/yu", createdAt: 1 });
  rootSession.append("company-thread/descriptor", rootDescriptor());
  rootSession.append("request/header", { header: { config: { provider: "header-p", model: "header-m", reasoningEffort: "medium" } } });
  const { ctx } = makeCtx({
    sessions: { root: rootSession },
    agents: { root: makeAgent(rootSession, { options: { provider: "opt-p", model: "opt-m" } }) },
  });
  const api = createCompanyThreads(ctx, { fs: defaultFs });
  const child = await api.createThread({
    parentId: "root",
    label: "继承模型",
    cwd: "/Users/yu/project-a",
    permission: "workspace-write",
    brief: "跟我用同一套模型",
  });
  assert.equal(child.provider, "header-p");
  assert.equal(child.model, "header-m");
  assert.equal(child.reasoningEffort, "medium");
  assert.deepEqual(ctx.created[0].agentOptions, { provider: "header-p", model: "header-m" });
});

test("live assign is acked so later drain does not repeat", async () => {
  const rootSession = makeSession("root", { id: "root", cwd: "/Users/yu", createdAt: 1 });
  rootSession.append("company-thread/descriptor", rootDescriptor());
  const childSession = makeSession("child", { id: "child", cwd: "/Users/yu/a", parentSession: "root", createdAt: 2 });
  childSession.append("company-thread/descriptor", {
    id: "child", parentId: "root", label: "执行", role: "work", permission: "workspace-write", cwd: "/Users/yu/a", depth: 1, agentPreset: "xiaok",
  });
  const { ctx } = makeCtx({
    sessions: { root: rootSession, child: childSession },
    agents: { root: makeAgent(rootSession), child: makeAgent(childSession) },
  });
  const api = createCompanyThreads(ctx, { fs: defaultFs });
  const result = await api.assign({ parentId: "root", childId: "child", text: "立刻开工" });
  assert.equal(result.delivered, true);
  const messages = childSession.events.filter((event) => event.type === "user/message");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].data.source.kind, "coordinator");
  const drained = await api.drainMailbox("child");
  assert.equal(drained.length, 0);
  assert.equal(childSession.events.filter((event) => event.type === "user/message").length, 1);
});

test("tree from a worker returns its flat root organization", async () => {
  const rootSession = makeSession("root", { id: "root", cwd: "/Users/yu", createdAt: 1 });
  rootSession.append("company-thread/descriptor", rootDescriptor());
  const workerSession = makeSession("worker", { id: "worker", cwd: "/Users/yu/a", parentSession: "root", createdAt: 2 });
  workerSession.append("company-thread/descriptor", {
    id: "worker", parentId: "root", label: "执行", role: "work", permission: "workspace-write", cwd: "/Users/yu/a", depth: 1, agentPreset: "xiaok",
  });
  const { ctx } = makeCtx({
    sessions: { root: rootSession, worker: workerSession },
    agents: { root: makeAgent(rootSession), worker: makeAgent(workerSession) },
  });
  const api = createCompanyThreads(ctx, { fs: defaultFs });
  const tree = await api.tree("worker");
  assert.equal(tree[0].id, "root");
  assert.deepEqual(tree[0].children.map((item) => item.id), ["worker"]);
});

test("worker can rename itself but cannot set its own status through report", async () => {
  const rootSession = makeSession("root", { id: "root", cwd: "/Users/yu", createdAt: 1 });
  rootSession.append("company-thread/descriptor", rootDescriptor());
  const workerSession = makeSession("worker", { id: "worker", cwd: "/Users/yu/a", parentSession: "root", createdAt: 2 });
  workerSession.append("company-thread/descriptor", { id: "worker", parentId: "root", label: "执行代理", role: "work", permission: "workspace-write", cwd: "/Users/yu/a", depth: 1, status: "running", agentPreset: "xiaok" });
  const { ctx } = makeCtx({ sessions: { root: rootSession, worker: workerSession }, agents: { root: makeAgent(rootSession), worker: makeAgent(workerSession) } });
  const api = createCompanyThreads(ctx, { fs: defaultFs });
  const renamed = await api.renameSelf("worker", "修复登录流程");
  assert.equal(renamed.label, "修复登录流程");
  await api.report({ childId: "worker", text: "阶段汇报", status: "complete" });
  assert.equal((await api.getDescriptor("worker")).status, "running");
  await assert.rejects(() => api.renameSelf("root", "另一个根"), (error) => error.code === "RENAME_NOT_WORKER");
});
