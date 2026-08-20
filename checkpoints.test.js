import test from "node:test";
import assert from "node:assert/strict";
import { createCompanyThreads, recoverCreatedThread } from "./index.js";
import { CHECKPOINT_EVENT, foldCheckpoint, normalizeCheckpoint } from "./checkpoints.js";
import { defaultFs, descriptorEvent, makeAgent, makeCtx, makeSession, rootDescriptor } from "./test-harness.js";

test("checkpoint normalize is strict and fold keeps latest save", () => {
  const first = normalizeCheckpoint({
    id: "cp-1", threadId: "child", summary: "完成读取", nextSteps: ["实现"], evidence: ["HANDOFF.md"], progress: 25, createdAt: 10,
  });
  const second = normalizeCheckpoint({
    id: "cp-2", threadId: "child", summary: "完成实现", nextSteps: ["测试"], progress: 70, createdAt: 20,
  });
  const events = [
    { type: CHECKPOINT_EVENT, data: { op: "save", checkpoint: first } },
    { type: CHECKPOINT_EVENT, data: { op: "restore", checkpointId: "cp-1" } },
    { type: CHECKPOINT_EVENT, data: { op: "save", checkpoint: second } },
  ];
  assert.deepEqual(foldCheckpoint(events), { ...second, restored: false });
  assert.throws(() => normalizeCheckpoint({ threadId: "child", summary: "x", nextSteps: [], progress: 101 }), (error) => error.code === "INVALID_CHECKPOINT");
  assert.throws(() => normalizeCheckpoint({ threadId: "child", summary: " ", nextSteps: [] }), (error) => error.code === "INVALID_CHECKPOINT");
});

test("save checkpoint persists in the current session and latest reads it", async () => {
  const session = makeSession("root", { id: "root", cwd: "/Users/yu", createdAt: 1 });
  session.append("company-thread/descriptor", rootDescriptor({ status: "running" }));
  const { ctx } = makeCtx({ sessions: { root: session }, agents: { root: makeAgent(session) } });
  const api = createCompanyThreads(ctx, { fs: defaultFs });
  const saved = await api.saveCheckpoint({
    threadId: "root", summary: "机器门通过", nextSteps: ["写代码", "跑测试"], evidence: ["node --test *.test.js"], progress: 20,
  });
  const latest = await api.latestCheckpoint("root");
  assert.equal(latest.id, saved.id);
  assert.equal(latest.summary, "机器门通过");
  assert.equal(latest.restored, false);
  assert.equal(session.events.filter((event) => event.type === CHECKPOINT_EVENT).length, 1);
});

test("opening an offline thread restores its latest checkpoint exactly once", async () => {
  const checkpoint = normalizeCheckpoint({
    id: "cp-resume", threadId: "child", summary: "合同模块已完成", nextSteps: ["实现检查点测试"], evidence: ["contracts.test.js"], progress: 60, createdAt: 100,
  });
  const header = { id: "child", cwd: "/Users/yu/a", parentSession: "root", createdAt: 2, agentPreset: "xiaok" };
  const events = [
    descriptorEvent({ id: "child", parentId: "root", label: "项目", role: "project", permission: "workspace-write", cwd: "/Users/yu/a", depth: 1, status: "running", agentPreset: "xiaok" }),
    { type: CHECKPOINT_EVENT, data: { op: "save", checkpoint } },
  ];
  const { ctx } = makeCtx({ persisted: { child: { header, events } } });
  const api = createCompanyThreads(ctx, { fs: defaultFs });
  await api.open("child");
  const session = ctx.sessions.get("child");
  const messages = session.events.filter((event) => event.type === "user/message");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].data.source.kind, "coordinator");
  assert.match(JSON.stringify(messages[0].data), /合同模块已完成/);
  assert.match(JSON.stringify(messages[0].data), /实现检查点测试/);
  assert.equal(foldCheckpoint(session.events).restored, true);
  await api.open("child");
  assert.equal(session.events.filter((event) => event.type === "user/message").length, 1);
});

test("opening an already-live thread does not consume its checkpoint", async () => {
  const session = makeSession("root", { id: "root", cwd: "/Users/yu", createdAt: 1 });
  session.append("company-thread/descriptor", rootDescriptor({ status: "running" }));
  const { ctx } = makeCtx({ sessions: { root: session }, agents: { root: makeAgent(session) } });
  const api = createCompanyThreads(ctx, { fs: defaultFs });
  await api.saveCheckpoint({ threadId: "root", summary: "仍在工作", nextSteps: ["继续"] });
  await api.open("root");
  assert.equal(session.events.filter((event) => event.type === "user/message").length, 0);
  assert.equal(foldCheckpoint(session.events).restored, false);
});

test("ensureLive restores an offline checkpoint without requiring open", async () => {
  const checkpoint = normalizeCheckpoint({ id: "cp-live", threadId: "child", summary: "已完成一半", nextSteps: ["继续后一半"], createdAt: 100 });
  const header = { id: "child", cwd: "/Users/yu/a", parentSession: "root", createdAt: 2, agentPreset: "xiaok" };
  const events = [
    descriptorEvent({ id: "child", parentId: "root", label: "项目", role: "project", permission: "workspace-write", cwd: "/Users/yu/a", depth: 1, status: "running", agentPreset: "xiaok" }),
    { type: CHECKPOINT_EVENT, data: { op: "save", checkpoint } },
  ];
  const { ctx } = makeCtx({ persisted: { child: { header, events } } });
  const api = createCompanyThreads(ctx, { fs: defaultFs });
  await api.ensureLive("child");
  const session = ctx.sessions.get("child");
  assert.equal(session.events.filter((event) => event.type === "user/message").length, 1);
  assert.equal(foldCheckpoint(session.events).restored, true);
  await api.ensureLive("child");
  assert.equal(session.events.filter((event) => event.type === "user/message").length, 1);
});

test("agent-created recovery drains mailbox before restoring checkpoint", async () => {
  const calls = [];
  const result = await recoverCreatedThread({
    async drainMailbox(id) { calls.push(`mail:${id}`); },
    async restoreCheckpoint(id) { calls.push(`checkpoint:${id}`); return { restored: true }; },
  }, { id: "child" });
  assert.deepEqual(calls, ["mail:child", "checkpoint:child"]);
  assert.equal(result.restored, true);
});

test("a newer checkpoint can restore after the previous one was acknowledged", async () => {
  const session = makeSession("root", { id: "root", cwd: "/Users/yu", createdAt: 1 });
  session.append("company-thread/descriptor", rootDescriptor({ status: "running" }));
  const { ctx } = makeCtx({ sessions: { root: session }, agents: { root: makeAgent(session) } });
  const api = createCompanyThreads(ctx, { fs: defaultFs });
  await api.saveCheckpoint({ threadId: "root", id: "cp-1", summary: "第一段", nextSteps: ["第二段"] });
  assert.equal((await api.restoreCheckpoint("root")).restored, true);
  await api.saveCheckpoint({ threadId: "root", id: "cp-2", summary: "第二段", nextSteps: ["第三段"] });
  assert.equal((await api.restoreCheckpoint("root")).restored, true);
  assert.equal(session.events.filter((event) => event.type === "user/message").length, 2);
});

test("completed or paused threads do not auto-resume checkpoints", async () => {
  for (const status of ["complete", "paused"]) {
    const session = makeSession(status, { id: status, cwd: "/Users/yu", createdAt: 1 });
    session.append("company-thread/descriptor", rootDescriptor({ id: status, status: "running" }));
    const { ctx, agents } = makeCtx({ sessions: { [status]: session }, agents: { [status]: makeAgent(session) } });
    const api = createCompanyThreads(ctx, { fs: defaultFs });
    await api.saveCheckpoint({ threadId: status, summary: "不应恢复", nextSteps: ["无"] });
    await api.setStatus(status, status);
    agents.delete(status);
    await api.ensureLive(status);
    assert.equal(session.events.filter((event) => event.type === "user/message").length, 0);
    assert.equal(foldCheckpoint(session.events).restored, false);
  }
});
