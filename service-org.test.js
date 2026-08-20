import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCompanyThreads } from "./index.js";
import { defaultFs, makeAgent, makeCtx, makeSession, rootDescriptor } from "./test-harness.js";

function described(id, parentId, role, permission = "workspace-write") {
  const session = makeSession(id, { id, cwd: "/Users/yu/a", parentSession: parentId, createdAt: Date.now() });
  session.append("company-thread/descriptor", { id, parentId, label: id, role, permission, cwd: "/Users/yu/a", depth: parentId ? 1 : 0, agentPreset: "xiaok" });
  return session;
}

test("flat workers cannot peer or create nested threads", async () => {
  const root = described("root", null, "root", "full-controlled");
  const work = described("work", "root", "work");
  const review = described("review", "root", "review", "read-only");
  const { ctx } = makeCtx({ sessions: { root, work, review }, agents: { root: makeAgent(root), work: makeAgent(work), review: makeAgent(review) } });
  const api = createCompanyThreads(ctx, { fs: defaultFs });
  assert.equal(api.messagePeer, undefined, "执行与审查不暴露横向通信能力");
  await assert.rejects(() => api.createThread({ parentId: "work", role: "work", label: "嵌套", cwd: "/Users/yu/a", brief: "禁止" }), (error) => error.code === "ROOT_ONLY_CREATE");
});

test("real symlink fixture cannot escape a limited root workspace", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "superwork-"));
  const parentDir = join(rootDir, "parent");
  const insideDir = join(parentDir, "inside");
  const outsideDir = join(rootDir, "outside");
  const escapeLink = join(parentDir, "escape");
  mkdirSync(parentDir);
  mkdirSync(insideDir);
  mkdirSync(outsideDir);
  symlinkSync(outsideDir, escapeLink);
  writeFileSync(join(outsideDir, "secret.txt"), "no");
  try {
    const root = makeSession("root", { id: "root", cwd: parentDir, createdAt: 1 });
    root.append("company-thread/descriptor", { ...rootDescriptor(), cwd: parentDir, permission: "workspace-write" });
    const { ctx } = makeCtx({ sessions: { root }, agents: { root: makeAgent(root) } });
    const api = createCompanyThreads(ctx);
    const child = await api.createThread({ parentId: "root", role: "work", label: "内部", cwd: insideDir, permission: "workspace-write", brief: "合法目录" });
    assert.equal(child.cwd, realpathSync(insideDir));
    await assert.rejects(() => api.createThread({ parentId: "root", role: "work", label: "越界", cwd: escapeLink, permission: "workspace-write", brief: "符号链接逃逸" }), (error) => error.code === "WORKSPACE_ESCAPE");
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("every live ordinary session is its own default root and trees stay isolated", async () => {
  const rootA = makeSession("root-a", { id: "root-a", cwd: "/Users/yu", agentPreset: "xiaok", createdAt: 1 });
  const rootB = makeSession("root-b", { id: "root-b", cwd: "/Users/yu", agentPreset: "code", createdAt: 2 });
  const { ctx } = makeCtx({ sessions: { "root-a": rootA, "root-b": rootB }, agents: { "root-a": makeAgent(rootA), "root-b": makeAgent(rootB) } });
  const api = createCompanyThreads(ctx, { fs: defaultFs });
  assert.equal((await api.getDescriptor("root-a")).depth, 0);
  assert.equal((await api.getDescriptor("root-b")).depth, 0);
  const a = await api.createThread({ parentId: "root-a", role: "work", label: "A执行", cwd: "/Users/yu/project-a", brief: "A" });
  const b = await api.createThread({ parentId: "root-b", role: "review", label: "B审查", cwd: "/Users/yu/project-a", brief: "B" });
  assert.deepEqual((await api.tree("root-a"))[0].children.map((item) => item.id), [a.id]);
  assert.deepEqual((await api.tree("root-b"))[0].children.map((item) => item.id), [b.id]);
});

test("root can create only work/review profiles and review is always read-only", async () => {
  const root = makeSession("root", { id: "root", cwd: "/Users/yu", createdAt: 1 });
  root.append("company-thread/descriptor", rootDescriptor());
  const { ctx } = makeCtx({ sessions: { root }, agents: { root: makeAgent(root) } });
  const api = createCompanyThreads(ctx, { fs: defaultFs });
  await assert.rejects(() => api.createThread({ parentId: "root", role: "main", label: "架构师", cwd: "/Users/yu/project-a", brief: "旧角色" }), (error) => error.code === "INVALID_ROLE");
  await assert.rejects(() => api.createThread({ parentId: "root", role: "project", label: "项目经理", cwd: "/Users/yu/project-a", brief: "旧角色" }), (error) => error.code === "INVALID_ROLE");
  const reviewer = await api.createThread({ parentId: "root", role: "review", label: "审查", cwd: "/Users/yu/project-a", permission: "full-controlled", brief: "只读" });
  assert.equal(reviewer.depth, 1);
  assert.equal(reviewer.role, "review");
  assert.equal(reviewer.permission, "read-only");
});
