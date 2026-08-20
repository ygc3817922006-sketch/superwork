import test from "node:test";
import assert from "node:assert/strict";
import { createCompanyThreads } from "./index.js";
import { defaultFs, makeAgent, makeCtx, makeSession } from "./test-harness.js";
import { foldWorkflow, hashReviewReport, createWorkflowService } from "./workflow.js";

function session(id, parentId, role, permission = "auto") {
  const value = makeSession(id, { id, cwd: "/Users/yu/a", parentSession: parentId, createdAt: Date.now() });
  value.append("company-thread/descriptor", { id, parentId, label: id, role, permission, cwd: "/Users/yu/a", depth: parentId ? 1 : 0, agentPreset: "xiaok-creative", status: "idle" });
  return value;
}

function build() {
  const root = session("root", null, "root", "full-controlled");
  const work = session("work", "root", "work");
  const work2 = session("work2", "root", "work");
  const r1 = session("r1", "root", "review", "read-only");
  const r2 = session("r2", "root", "review", "read-only");
  const otherRoot = session("other-root", null, "root", "full-controlled");
  const otherReview = session("other-review", "other-root", "review", "read-only");
  const sessions = { root, work, work2, r1, r2, "other-root": otherRoot, "other-review": otherReview };
  const agents = Object.fromEntries(Object.entries(sessions).map(([id, value]) => [id, makeAgent(value)]));
  const env = makeCtx({ sessions, agents });
  return { api: createCompanyThreads(env.ctx, { fs: defaultFs }), ...env };
}

async function submit(api, suffix = "v1") {
  const existing = await api.contractFor("work", "root");
  if (!existing) await api.issueContract({ issuerId: "root", threadId: "work", objective: "实现", acceptance: ["测试通过"] });
  return api.submitCompletion({ threadId: "work", summary: suffix, evidence: [{ kind: "command", ref: `npm test ${suffix}`, covers: [1] }] });
}

test("review pins the pending completion; all PASS leaves acceptance to the root", async () => {
  const { api, ctx } = build();
  const delivery = await submit(api);
  const started = await api.startReview({ ownerId: "root", subjectId: "work", reviewerIds: ["r1", "r2"] });
  assert.equal(started.phase, "review");
  assert.equal(started.snapshot.completionId, delivery.completion.id);
  assert.equal(started.snapshot.completionDigest, delivery.completion.digest);
  const first = await api.submitReview({ reviewerId: "r1", subjectId: "work", verdict: "PASS", report: "正确性通过" });
  assert.equal(first.phase, "review");
  const second = await api.submitReview({ reviewerId: "r2", subjectId: "work", verdict: "PASS", report: "证据通过" });
  assert.equal(second.phase, "passed");
  assert.equal((await api.getDescriptor("work")).status, "waiting");
  assert.equal(ctx.sessions.get("root").events.filter((event) => event.type === "company-thread/review-mirror").length, 2);
});

test("any FAIL is routed back automatically and the next delivery needs a full new review", async () => {
  const { api, ctx } = build();
  await submit(api, "v1");
  await api.startReview({ ownerId: "root", subjectId: "work", reviewerIds: ["r1", "r2"] });
  await api.submitReview({ reviewerId: "r1", subjectId: "work", verdict: "FAIL", report: "存在污染" });
  await assert.rejects(() => api.startReview({ ownerId: "root", subjectId: "work", reviewerIds: ["r1"] }), (error) => error.code === "REVIEW_ALREADY_ACTIVE");
  const restarted = await api.submitReview({ reviewerId: "r2", subjectId: "work", verdict: "PASS", report: "其它项通过" });
  assert.equal(restarted.phase, "execution");
  assert.equal(restarted.reviewFailed, true);
  assert.equal((await api.getDescriptor("work")).status, "running");
  assert.ok(ctx.sessions.get("work").events.some((event) => event.type === "user/message" && JSON.stringify(event.data).includes("存在污染")));
  const v2 = await submit(api, "v2");
  const review2 = await api.startReview({ ownerId: "root", subjectId: "work", reviewerIds: ["r1", "r2"] });
  assert.equal(review2.cycle, 2);
  assert.equal(review2.snapshot.completionId, v2.completion.id);
  await api.submitReview({ reviewerId: "r1", subjectId: "work", verdict: "PASS", report: "修复通过" });
  const passed = await api.submitReview({ reviewerId: "r2", subjectId: "work", verdict: "PASS", report: "完整重审通过" });
  assert.equal(passed.phase, "passed");
});

test("root can cancel a stuck review but cannot wash away an existing FAIL", async () => {
  const { api } = build();
  await submit(api);
  await api.startReview({ ownerId: "root", subjectId: "work", reviewerIds: ["r1", "r2"] });
  const cancelled = await api.cancelReview({ ownerId: "root", subjectId: "work", reason: "r2 失联" });
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.phase, "execution");
  const restarted = await api.startReview({ ownerId: "root", subjectId: "work", reviewerIds: ["r1", "r2"] });
  assert.equal(restarted.cycle, 2);
  await api.submitReview({ reviewerId: "r1", subjectId: "work", verdict: "FAIL", report: "仍有缺陷" });
  const failedCancel = await api.cancelReview({ ownerId: "root", subjectId: "work", reason: "其他审查席失联" });
  assert.equal(failedCancel.reviewFailed, true);
  await assert.rejects(() => api.startReview({ ownerId: "root", subjectId: "work", reviewerIds: ["r1"] }), (error) => error.code === "NO_PENDING_COMPLETION");
});

test("frozen delivery rejects assignment and replacement completion", async () => {
  const { api } = build();
  await submit(api);
  await api.startReview({ ownerId: "root", subjectId: "work", reviewerIds: ["r1"] });
  await assert.rejects(() => api.assign({ parentId: "root", childId: "work", text: "继续改" }), (error) => error.code === "REVIEW_FROZEN");
  await assert.rejects(() => api.submitCompletion({ threadId: "work", summary: "偷换", evidence: [{ kind: "file", ref: "/tmp/x", covers: [1] }] }), (error) => error.code === "REVIEW_FROZEN");
});

test("new assignment after PASS invalidates the old pending delivery", async () => {
  const { api } = build();
  await submit(api);
  await api.startReview({ ownerId: "root", subjectId: "work", reviewerIds: ["r1"] });
  await api.submitReview({ reviewerId: "r1", subjectId: "work", verdict: "PASS", report: "旧版通过" });
  await api.assign({ parentId: "root", childId: "work", text: "开始新版工作" });
  const contract = await api.contractFor("work", "root");
  assert.equal(contract.completions.at(-1).verdict, "superseded");
  await assert.rejects(() => api.startReview({ ownerId: "root", subjectId: "work", reviewerIds: ["r1"] }), (error) => error.code === "NO_PENDING_COMPLETION");
});

test("review report is immutable within a cycle", async () => {
  const { api } = build();
  await submit(api);
  await api.startReview({ ownerId: "root", subjectId: "work", reviewerIds: ["r1"] });
  await api.submitReview({ reviewerId: "r1", subjectId: "work", verdict: "PASS", report: "原文" });
  await assert.rejects(() => api.submitReview({ reviewerId: "r1", subjectId: "work", verdict: "FAIL", report: "改口" }), (error) => error.code === "REVIEW_IMMUTABLE" || error.code === "NO_ACTIVE_REVIEW");
});

test("concurrent independent verdicts serialize into one passed cycle", async () => {
  const { api } = build();
  await submit(api);
  await api.startReview({ ownerId: "root", subjectId: "work", reviewerIds: ["r1", "r2"] });
  const results = await Promise.all([
    api.submitReview({ reviewerId: "r1", subjectId: "work", verdict: "PASS", report: "并发一" }),
    api.submitReview({ reviewerId: "r2", subjectId: "work", verdict: "PASS", report: "并发二" }),
  ]);
  assert.equal(results.some((item) => item.phase === "passed"), true);
  assert.equal((await api.workflowState("root", "work")).phase, "passed");
});

test("owner, subject and reviewers must share the same flat root", async () => {
  const { api } = build();
  await submit(api);
  await assert.rejects(() => api.startReview({ ownerId: "work", subjectId: "work2", reviewerIds: ["r1"] }), (error) => error.code === "NOT_WORKFLOW_OWNER");
  await assert.rejects(() => api.startReview({ ownerId: "root", subjectId: "r1", reviewerIds: ["r2"] }), (error) => error.code === "INVALID_REVIEW_SUBJECT");
  await assert.rejects(() => api.startReview({ ownerId: "root", subjectId: "work", reviewerIds: ["other-review"] }), (error) => error.code === "INVALID_REVIEWER");
});

test("foldWorkflow default state and hash are stable", () => {
  assert.equal(foldWorkflow([], "x"), undefined);
  assert.equal(hashReviewReport("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("createWorkflowService exposes the review surface", () => {
  const service = createWorkflowService({});
  assert.equal(typeof service.startReview, "function");
  assert.equal(typeof service.submitReview, "function");
  assert.equal(typeof service.cancelReview, "function");
});
