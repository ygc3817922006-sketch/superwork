import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCompanyThreads } from "./index.js";
import { defaultFs, makeAgent, makeCtx, makeSession } from "./test-harness.js";
import { budgetBreaches, uncoveredAcceptance, normalizeBudget, renderContract, normalizeCovers } from "./contracts.js";

function session(id, parentId, role, permission = "auto") {
  const value = makeSession(id, { id, cwd: "/Users/yu/a", parentSession: parentId, createdAt: Date.now() });
  value.append("company-thread/descriptor", { id, parentId, label: id, role, permission, cwd: "/Users/yu/a", depth: parentId ? 1 : 0, agentPreset: "xiaok-creative", status: "idle" });
  return value;
}

function build() {
  const root = session("root", null, "root", "full-controlled");
  const work = session("work", "root", "work");
  const work2 = session("work2", "root", "work");
  const review = session("review", "root", "review", "read-only");
  const sessions = { root, work, work2, review };
  const agents = Object.fromEntries(Object.entries(sessions).map(([id, value]) => [id, makeAgent(value)]));
  const env = makeCtx({ sessions, agents });
  return { api: createCompanyThreads(env.ctx, { fs: defaultFs }), ...env };
}

const evidence = (ref = "npm test", covers = [1]) => [{ kind: "command", ref, covers }];

async function passCurrent(api) {
  await api.startReview({ ownerId: "root", subjectId: "work", reviewerIds: ["review"] });
  return api.submitReview({ reviewerId: "review", subjectId: "work", verdict: "PASS", report: "固定交付完整通过" });
}

test("pure contract helpers remain strict", () => {
  const budget = normalizeBudget({ maxReworks: "3", maxMinutes: 0 });
  const contract = { budget, issuedAt: 0, acceptance: ["a", "b", "c"] };
  assert.equal(budget.maxReworks, 3);
  assert.deepEqual(budgetBreaches(contract, { reworks: 4 }).map((item) => item.key), ["maxReworks"]);
  assert.deepEqual(uncoveredAcceptance(contract, [{ covers: [1, 3] }]), [2]);
  assert.deepEqual(normalizeCovers([3, 1, 1], 3), [3, 1]);
  assert.throws(() => normalizeCovers([0], 3), (error) => error.code === "INVALID_COVERS");
  assert.match(renderContract({ id: "x", version: 1, objective: "o", acceptance: ["a"], deliverables: [], constraints: [], budget }), /任务合同 x/);
});

test("root issues and amends a contract for a direct execution agent", async () => {
  const { api, ctx } = build();
  const contract = await api.issueContract({ issuerId: "root", threadId: "work", objective: "实现", acceptance: ["A", "B"], deliverables: ["result"], budget: { maxReworks: 1 } });
  assert.equal(contract.status, "active");
  assert.ok(ctx.sessions.get("work").events.some((event) => event.type === "user/message" && JSON.stringify(event.data).includes("任务合同")));
  await assert.rejects(() => api.issueContract({ issuerId: "root", threadId: "work", objective: "重复", acceptance: ["A"] }), (error) => error.code === "CONTRACT_ACTIVE");
  await assert.rejects(() => api.issueContract({ issuerId: "work2", threadId: "work", objective: "越级", acceptance: ["A"] }), (error) => error.code === "NOT_DIRECT_CHILD");
  const amended = await api.amendContract({ issuerId: "root", threadId: "work", acceptance: ["A", "B", "C"] });
  assert.equal(amended.version, 2);
});

test("amending a contract invalidates an older pending completion", async () => {
  const { api } = build();
  await api.issueContract({ issuerId: "root", threadId: "work", objective: "实现", acceptance: ["A"] });
  await api.submitCompletion({ threadId: "work", summary: "旧版本", evidence: evidence() });
  const amended = await api.amendContract({ issuerId: "root", threadId: "work", acceptance: ["A", "B"] });
  assert.equal(amended.completions.at(-1).verdict, "superseded");
  await assert.rejects(() => api.startReview({ ownerId: "root", subjectId: "work", reviewerIds: ["review"] }), (error) => error.code === "NO_PENDING_COMPLETION");
});

test("completion coverage is mandatory and acceptance is impossible before independent PASS", async () => {
  const { api } = build();
  await api.issueContract({ issuerId: "root", threadId: "work", objective: "实现", acceptance: ["A", "B"] });
  await assert.rejects(() => api.submitCompletion({ threadId: "work", summary: "缺证据", evidence: evidence("/tmp/a", [1]) }), (error) => error.code === "ACCEPTANCE_UNCOVERED");
  await api.submitCompletion({ threadId: "work", summary: "完成", evidence: evidence("/tmp/a", [1, 2]) });
  await assert.rejects(() => api.acceptCompletion({ issuerId: "root", threadId: "work", note: "" }), (error) => error.code === "REVIEW_NOT_PASSED");
  await passCurrent(api);
  const accepted = await api.acceptCompletion({ issuerId: "root", threadId: "work", note: "证据与审查通过" });
  assert.equal(accepted.status, "fulfilled");
  assert.equal((await api.getDescriptor("work")).status, "complete");
});

test("file evidence is hashed at submit and rechecked before acceptance", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "superwork-evidence-"));
  try {
    const root = session("root", null, "root", "full-controlled");
    const work = session("work", "root", "work");
    const review = session("review", "root", "review", "read-only");
    for (const value of [root, work, review]) {
      value.header.cwd = cwd;
      const descriptor = value.events.find((event) => event.type === "company-thread/descriptor");
      descriptor.data.cwd = cwd;
    }
    const sessions = { root, work, review };
    const agents = Object.fromEntries(Object.entries(sessions).map(([id, value]) => [id, makeAgent(value)]));
    const env = makeCtx({ sessions, agents });
    const api = createCompanyThreads(env.ctx);
    const artifact = join(cwd, "result.txt");
    await writeFile(artifact, "v1");
    await api.issueContract({ issuerId: "root", threadId: "work", objective: "实现", acceptance: ["A"] });
    const submitted = await api.submitCompletion({ threadId: "work", summary: "完成", evidence: [{ kind: "file", ref: artifact, covers: [1] }] });
    assert.match(submitted.completion.evidence[0].sha256, /^[a-f0-9]{64}$/);
    await passCurrent(api);
    await writeFile(artifact, "tampered");
    await assert.rejects(() => api.acceptCompletion({ issuerId: "root", threadId: "work", note: "" }), (error) => error.code === "EVIDENCE_HASH_MISMATCH");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("PASS is bound to the exact completion and cannot authorize a replacement", async () => {
  const { api } = build();
  await api.issueContract({ issuerId: "root", threadId: "work", objective: "实现", acceptance: ["A"] });
  const first = await api.submitCompletion({ threadId: "work", summary: "v1", evidence: evidence("/tmp/v1") });
  await passCurrent(api);
  const second = await api.submitCompletion({ threadId: "work", summary: "v2", evidence: evidence("/tmp/v2") });
  assert.notEqual(first.completion.id, second.completion.id);
  await assert.rejects(() => api.acceptCompletion({ issuerId: "root", threadId: "work", note: "" }), (error) => error.code === "REVIEW_NOT_PASSED" || error.code === "REVIEW_VERSION_MISMATCH");
  const review2 = await api.startReview({ ownerId: "root", subjectId: "work", reviewerIds: ["review"] });
  assert.equal(review2.snapshot.completionId, second.completion.id);
  await api.submitReview({ reviewerId: "review", subjectId: "work", verdict: "PASS", report: "v2 通过" });
  assert.equal((await api.acceptCompletion({ issuerId: "root", threadId: "work", note: "" })).status, "fulfilled");
});

test("accepting a passed delivery and submitting a replacement cannot both succeed", async () => {
  const { api } = build();
  await api.issueContract({ issuerId: "root", threadId: "work", objective: "实现", acceptance: ["A"] });
  await api.submitCompletion({ threadId: "work", summary: "v1", evidence: evidence("npm test v1") });
  await passCurrent(api);
  const results = await Promise.allSettled([
    api.acceptCompletion({ issuerId: "root", threadId: "work", note: "验收 v1" }),
    api.submitCompletion({ threadId: "work", summary: "v2", evidence: evidence("npm test v2") }),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  const contract = await api.contractFor("work", "root");
  assert.equal(contract.status === "fulfilled" && contract.completions.some((item) => item.verdict === "pending"), false);
});

test("accepting a passed delivery and amending its contract cannot both succeed", async () => {
  const { api } = build();
  await api.issueContract({ issuerId: "root", threadId: "work", objective: "实现", acceptance: ["A"] });
  await api.submitCompletion({ threadId: "work", summary: "v1", evidence: evidence() });
  await passCurrent(api);
  const results = await Promise.allSettled([
    api.acceptCompletion({ issuerId: "root", threadId: "work", note: "验收 v1" }),
    api.amendContract({ issuerId: "root", threadId: "work", acceptance: ["A", "B"] }),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  const contract = await api.contractFor("work", "root");
  assert.equal(contract.status === "fulfilled" && contract.version !== 1, false);
});

test("review freeze blocks contract and completion changes", async () => {
  const { api } = build();
  await api.issueContract({ issuerId: "root", threadId: "work", objective: "实现", acceptance: ["A"] });
  await api.submitCompletion({ threadId: "work", summary: "v1", evidence: evidence() });
  await api.startReview({ ownerId: "root", subjectId: "work", reviewerIds: ["review"] });
  await assert.rejects(() => api.amendContract({ issuerId: "root", threadId: "work", objective: "偷换" }), (error) => error.code === "REVIEW_FROZEN");
  await assert.rejects(() => api.closeContract({ issuerId: "root", threadId: "work", reason: "偷换" }), (error) => error.code === "REVIEW_FROZEN");
  await assert.rejects(() => api.submitCompletion({ threadId: "work", summary: "v2", evidence: evidence("/tmp/v2") }), (error) => error.code === "REVIEW_FROZEN");
});

test("manual escalation is system-statused and root resolution resumes work", async () => {
  const { api } = build();
  const escalation = await api.raiseEscalation({ threadId: "work", need: "decision", reason: "缺口径", options: ["A", "B"] });
  assert.equal((await api.getDescriptor("work")).status, "blocked");
  await api.resolveEscalation({ resolverId: "root", threadId: "work", escalationId: escalation.id, resolution: "用 A" });
  assert.equal((await api.getDescriptor("work")).status, "idle");
});

test("cancelled contract can be replaced by a clean new generation", async () => {
  const { api } = build();
  await api.issueContract({ issuerId: "root", threadId: "work", objective: "旧", acceptance: ["A"] });
  await api.closeContract({ issuerId: "root", threadId: "work", reason: "换目标" });
  const next = await api.issueContract({ issuerId: "root", threadId: "work", objective: "新", acceptance: ["B"] });
  assert.equal(next.objective, "新");
  assert.equal(next.version, 1);
});
