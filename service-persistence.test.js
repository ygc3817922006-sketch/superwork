import test from "node:test";
import assert from "node:assert/strict";
import { createCompanyThreads, recoverCreatedThread } from "./index.js";
import { defaultFs, descriptorEvent, makeAgent, makeCtx, makeSession, rootDescriptor } from "./test-harness.js";

test("offline report resumes the parent and is delivered once", async () => {
  const parentSession = makeSession("root", { id: "root", cwd: "/Users/yu", createdAt: 1 });
  parentSession.append("company-thread/descriptor", rootDescriptor());
  const childSession = makeSession("child", { id: "child", cwd: "/Users/yu/a", parentSession: "root", createdAt: 2 });
  childSession.append("company-thread/descriptor", {
    id: "child", parentId: "root", label: "项目", role: "project", permission: "workspace-write", cwd: "/Users/yu/a", depth: 1, agentPreset: "xiaok",
  });
  const { ctx } = makeCtx({
    sessions: { child: childSession },
    agents: { child: makeAgent(childSession) },
    persisted: {
      root: { header: parentSession.header, events: parentSession.events },
    },
  });
  const api = createCompanyThreads(ctx, { fs: defaultFs });
  const result = await api.report({ childId: "child", text: "第一阶段完成", status: "waiting" });
  assert.equal(result.delivered, true);
  assert.equal(result.queued, false);
  const opened = await api.open("root");
  assert.equal(opened.id, "root");
  const liveParent = ctx.sessions.get("root");
  const delivered = liveParent.events.filter((event) => event.type === "user/message");
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].data.source.kind, "subagent-report");
  assert.match(JSON.stringify(delivered[0].data), /第一阶段完成/);
  assert.ok(ctx.resumed.some((item) => item.id === "root"));
  assert.ok(ctx.mounts.some((item) => item.phase === "resume" && item.id === "xiaok"));
});

test("sessionQuery without persistence.list still finds offline threads", async () => {
  const rootHeader = { id: "root", cwd: "/Users/yu", createdAt: 1 };
  const childHeader = { id: "child", cwd: "/Users/yu/a", parentSession: "root", createdAt: 2 };
  const strayHeader = { id: "plain", cwd: "/Users/yu/plain", createdAt: 3 };
  const { ctx } = makeCtx({
    persisted: {
      root: {
        header: rootHeader,
        events: [descriptorEvent({ id: "root", parentId: null, label: "小K", role: "root", permission: "full-controlled", cwd: "/Users/yu", depth: 0, agentPreset: "xiaok" })],
      },
      child: {
        header: childHeader,
        events: [descriptorEvent({ id: "child", parentId: "root", label: "项目", role: "project", permission: "workspace-write", cwd: "/Users/yu/a", depth: 1, agentPreset: "xiaok" })],
      },
      plain: { header: strayHeader, events: [] },
    },
  });
  const api = createCompanyThreads(ctx, { fs: defaultFs });
  const listed = await api.listDescriptors();
  assert.deepEqual(listed.map((item) => item.id).sort(), ["child", "root"]);
  const tree = await api.tree("child");
  assert.equal(tree[0].id, "root");
  assert.equal(tree[0].children[0].id, "child");
});

test("resume remounts preset and reapplies unused reasoning", async () => {
  const childHeader = { id: "child", cwd: "/Users/yu/a", parentSession: "root", createdAt: 2, agentPreset: "xiaok" };
  const { ctx } = makeCtx({
    persisted: {
      child: {
        header: childHeader,
        events: [descriptorEvent({
          id: "child", parentId: "root", label: "项目", role: "project", permission: "workspace-write", cwd: "/Users/yu/a", depth: 1, agentPreset: "xiaok", provider: "xai", model: "grok-4.6", reasoningEffort: "high",
        })],
      },
    },
  });
  const api = createCompanyThreads(ctx, { fs: defaultFs });
  const agent = await api.ensureLive("child");
  assert.equal(ctx.mounts.some((item) => item.phase === "resume" && item.id === "xiaok"), true);
  assert.deepEqual(ctx.resumed[0].options.agentOptions, { provider: "xai", model: "grok-4.6" });
  const first = await ctx.resumeSetups[0].handlers["agent/request"]({}, async () => ({ provider: "xai", model: "grok-4.6" }));
  assert.equal(first.reasoningEffort, "high");
  assert.equal(agent.id, "child");
});

test("offline root without descriptor still receives a report as needed ancestor", async () => {
  const childSession = makeSession("child", { id: "child", cwd: "/Users/yu/a", parentSession: "root", createdAt: 2 });
  childSession.append("company-thread/descriptor", {
    id: "child", parentId: "root", label: "项目", role: "project", permission: "workspace-write", cwd: "/Users/yu/a", depth: 1, agentPreset: "xiaok",
  });
  const { ctx } = makeCtx({
    sessions: { child: childSession },
    agents: { child: makeAgent(childSession) },
    persisted: {
      root: { header: { id: "root", cwd: "/Users/yu", createdAt: 1 }, events: [] },
    },
  });
  const api = createCompanyThreads(ctx, { fs: defaultFs });
  const result = await api.report({ childId: "child", text: "根离线也要收汇报", status: "waiting" });
  assert.equal(result.delivered, true);
  assert.equal(result.queued, false);
  const opened = await api.open("root");
  assert.equal(opened.id, "root");
  const liveParent = ctx.sessions.get("root");
  const delivered = liveParent.events.filter((event) => event.type === "user/message");
  assert.equal(delivered.length, 1);
  assert.match(JSON.stringify(delivered[0].data), /根离线也要收汇报/);
});

test("direct delivery and concurrent mailbox drain cannot deliver the same message twice", async () => {
  const rootSession = makeSession("root", { id: "root", cwd: "/Users/yu", createdAt: 1 });
  rootSession.append("company-thread/descriptor", rootDescriptor());
  const childSession = makeSession("child", { id: "child", cwd: "/Users/yu/a", parentSession: "root", createdAt: 2 });
  childSession.append("company-thread/descriptor", {
    id: "child", parentId: "root", label: "执行", role: "work", permission: "workspace-write", cwd: "/Users/yu/a", depth: 1, agentPreset: "xiaok-creative",
  });
  const rootAgent = makeAgent(rootSession);
  const childAgent = makeAgent(childSession);
  const { ctx } = makeCtx({ sessions: { root: rootSession, child: childSession }, agents: { root: rootAgent, child: childAgent } });
  const api = createCompanyThreads(ctx, { fs: defaultFs });
  const originalAppend = rootSession.append.bind(rootSession);
  let racedDrain;
  rootSession.append = (type, data) => {
    const event = originalAppend(type, data);
    if (type === "company-thread/mailbox" && data.op === "enqueue" && !racedDrain) racedDrain = api.drainMailbox("root");
    return event;
  };
  await api.report({ childId: "child", text: "只应送达一次" });
  await racedDrain;
  assert.equal(rootSession.events.filter((event) => event.type === "user/message" && JSON.stringify(event.data).includes("只应送达一次")).length, 1);
  assert.equal(rootSession.events.filter((event) => event.type === "company-thread/mailbox" && event.data.op === "ack").length, 1);
});

test("concurrent ensureLive resumes one agent instance", async () => {
  const header = { id: "child", cwd: "/Users/yu/a", parentSession: "root", createdAt: 2, agentPreset: "xiaok" };
  const events = [descriptorEvent({ id: "child", parentId: "root", label: "项目", role: "project", permission: "workspace-write", cwd: "/Users/yu/a", depth: 1, status: "running", agentPreset: "xiaok" })];
  const { ctx } = makeCtx({ persisted: { child: { header, events } } });
  const api = createCompanyThreads(ctx, { fs: defaultFs });
  const [a, b] = await Promise.all([api.ensureLive("child"), api.ensureLive("child")]);
  assert.equal(a, b);
  assert.equal(ctx.resumed.length, 1);
});

test("agent-created recovery and open drain one mailbox message once", async () => {
  const root = makeSession("root", { id: "root", cwd: "/Users/yu", createdAt: 1 });
  root.append("company-thread/descriptor", rootDescriptor());
  const child = makeSession("child", { id: "child", cwd: "/Users/yu/a", parentSession: "root", createdAt: 2 });
  child.append("company-thread/descriptor", { id: "child", parentId: "root", label: "项目", role: "project", permission: "workspace-write", cwd: "/Users/yu/a", depth: 1, status: "running", agentPreset: "xiaok" });
  child.append("company-thread/mailbox", { op: "enqueue", message: { id: "m1", kind: "assign", fromId: "root", toId: "child", parentId: "root", text: "只投一次", createdAt: 3 } });
  const childAgent = makeAgent(child);
  const { ctx } = makeCtx({ sessions: { root, child }, agents: { root: makeAgent(root), child: childAgent } });
  const api = createCompanyThreads(ctx, { fs: defaultFs });
  await Promise.all([recoverCreatedThread(api, childAgent), api.open("child")]);
  const messages = child.events.filter((event) => event.type === "user/message");
  assert.equal(messages.length, 1);
  assert.match(JSON.stringify(messages[0].data), /只投一次/);
});
