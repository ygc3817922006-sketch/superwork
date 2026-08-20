import { createHash, randomUUID } from "node:crypto";
import { CompanyThreadError, enqueueMessage } from "./logic.js";

export const WORKFLOW_EVENT = "company-thread/workflow";
export const REVIEW_REPORT_EVENT = "company-thread/review-report";
export const REVIEW_MIRROR_EVENT = "company-thread/review-mirror";

function requiredText(value, label) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new CompanyThreadError(label + "不能为空", "EMPTY_REVIEW_FIELD");
  return text;
}

export function hashReviewReport(report) {
  return createHash("sha256").update(report, "utf8").digest("hex");
}

export function foldWorkflow(events, subjectId) {
  const states = new Map();
  for (const event of events ?? []) {
    if (event.type !== WORKFLOW_EVENT) continue;
    const data = event.data ?? {};
    if (!data.subjectId) continue;
    const current = states.get(data.subjectId) ?? { subjectId: data.subjectId, cycle: 0, phase: "execution", frozen: false, reviewerIds: [], verdicts: {} };
    if (data.op === "review-start") {
      states.set(data.subjectId, { subjectId: data.subjectId, cycle: data.cycle, phase: "review", frozen: true, reviewerIds: [...data.reviewerIds], verdicts: {}, snapshot: { ...data.snapshot }, startedAt: data.startedAt });
      continue;
    }
    if (data.op === "review-verdict" && data.cycle === current.cycle) {
      const verdicts = { ...current.verdicts, [data.reviewerId]: { verdict: data.verdict, report: data.report, reportHash: data.reportHash, submittedAt: data.submittedAt } };
      const failed = Object.values(verdicts).some((item) => item.verdict === "FAIL");
      const allSubmitted = current.reviewerIds.length > 0 && current.reviewerIds.every((id) => verdicts[id]);
      const passed = allSubmitted && !failed;
      states.set(data.subjectId, {
        ...current,
        verdicts,
        phase: passed ? "passed" : failed ? "repair-required" : "review",
        frozen: !allSubmitted,
        completedAt: allSubmitted ? data.submittedAt : undefined,
      });
      continue;
    }
    if (data.op === "repair-start" && data.cycle === current.cycle) {
      states.set(data.subjectId, { ...current, phase: "execution", frozen: false, repairStartedAt: data.startedAt });
      continue;
    }
    if (data.op === "review-cancel" && data.cycle === current.cycle) {
      states.set(data.subjectId, { ...current, phase: "execution", frozen: false, cancelledAt: data.cancelledAt, cancelReason: data.reason });
    }
  }
  return subjectId ? states.get(subjectId) : Object.fromEntries(states);
}

function assertOwner(owner) {
  if ((owner.depth ?? 0) !== 0 || owner.parentId) throw new CompanyThreadError("只有根线程可以启动审查和收口", "NOT_WORKFLOW_OWNER");
}

function assertExecution(owner, subject) {
  if (!subject || subject.parentId !== owner.id || subject.depth !== 1 || subject.role !== "work") {
    throw new CompanyThreadError("被审对象必须是根线程直属的执行代理", "INVALID_REVIEW_SUBJECT");
  }
}

function assertReviewers(owner, subject, reviewers) {
  if (reviewers.length === 0) throw new CompanyThreadError("至少需要一个独立审查代理", "NO_REVIEWERS");
  const seen = new Set();
  for (const reviewer of reviewers) {
    if (!reviewer || reviewer.parentId !== owner.id || reviewer.depth !== 1 || reviewer.role !== "review") {
      throw new CompanyThreadError("审查者必须是同一根线程直属的审查代理", "INVALID_REVIEWER");
    }
    if (reviewer.id === subject.id || seen.has(reviewer.id)) throw new CompanyThreadError("执行与审查必须独立且审查席不能重复", "REVIEW_NOT_INDEPENDENT");
    seen.add(reviewer.id);
  }
}

export function createWorkflowService(helpers) {
  const transitionLocks = new Map();
  async function localTransitionLock(subjectId, task) {
    const previous = transitionLocks.get(subjectId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    transitionLocks.set(subjectId, current);
    try { return await current; }
    finally { if (transitionLocks.get(subjectId) === current) transitionLocks.delete(subjectId); }
  }
  const withTransitionLock = helpers.withSubjectTransition ?? localTransitionLock;
  async function stateFor(ownerId, subjectId) {
    const session = await helpers.sessionFor(ownerId);
    return foldWorkflow(session.events, subjectId);
  }

  async function startReviewUnlocked(input) {
    const owner = await helpers.requireDescriptor(input.managerId ?? input.ownerId);
    assertOwner(owner);
    const subject = await helpers.requireDescriptor(input.subjectId);
    assertExecution(owner, subject);
    const ids = [...new Set(input.reviewerIds ?? [])];
    const reviewers = await Promise.all(ids.map((id) => helpers.requireDescriptor(id)));
    assertReviewers(owner, subject, reviewers);
    const ownerSession = await helpers.sessionFor(owner.id);
    const previous = foldWorkflow(ownerSession.events, subject.id);
    if (previous?.frozen || previous?.phase === "review" || previous?.phase === "repair-required") throw new CompanyThreadError("上一审查批次尚未结算或尚未返工，不能重复启动", "REVIEW_ALREADY_ACTIVE");
    if (previous?.phase === "passed") throw new CompanyThreadError("已通过对象如有变更，必须先进入新一轮执行", "REVIEW_ALREADY_PASSED");
    const pending = await helpers.latestPendingCompletion(owner.id, subject.id);
    if (!pending?.completion || !pending?.contract) throw new CompanyThreadError("执行代理必须先提交待验收交付，才能启动审查", "NO_PENDING_COMPLETION");
    if (pending.completion.contractVersion !== pending.contract.version) throw new CompanyThreadError("待验收交付不属于当前合同版本，必须重新提交", "COMPLETION_CONTRACT_MISMATCH");
    const cycle = (previous?.cycle ?? 0) + 1;
    const snapshot = {
      objective: pending.contract.objective,
      acceptance: [...pending.contract.acceptance],
      constraints: [...pending.contract.constraints],
      deliverables: [...pending.contract.deliverables],
      contractId: pending.contract.id,
      contractVersion: pending.contract.version,
      completionId: pending.completion.id,
      completionDigest: pending.completion.digest,
      evidence: pending.completion.evidence.map((item) => ({ ...item })),
      summary: pending.completion.summary,
      subjectStatus: subject.status,
    };
    helpers.appendEvent(ownerSession, WORKFLOW_EVENT, { op: "review-start", subjectId: subject.id, cycle, reviewerIds: ids, snapshot, startedAt: Date.now() });
    await helpers.setStatus(subject.id, "waiting");
    for (const reviewer of reviewers) {
      await helpers.setStatus(reviewer.id, "running");
      const text = [
        "审查批次：" + cycle,
        "被审线程：" + subject.label + "（" + subject.id + "）",
        "交付 ID：" + snapshot.completionId,
        "交付摘要：" + snapshot.summary,
        "交付摘要哈希：" + snapshot.completionDigest,
        "审查期间只审固定交付版本；只审不改，不得与执行代理横向协商。",
        "目标：" + snapshot.objective,
        "验收标准：\n- " + snapshot.acceptance.join("\n- "),
        "约束：\n- " + (snapshot.constraints.length ? snapshot.constraints.join("\n- ") : "（无）"),
        "期望产物：\n- " + (snapshot.deliverables.length ? snapshot.deliverables.join("\n- ") : "（无）"),
        "完成证据：\n" + JSON.stringify(snapshot.evidence, null, 2),
        "完成后必须调用 submit_review；报告原文和哈希同步给根线程。",
      ].join("\n");
      await helpers.deliverMailbox(reviewer.id, enqueueMessage({ id: randomUUID(), kind: "assign", fromId: owner.id, toId: reviewer.id, parentId: owner.id, text }), owner.label);
    }
    return foldWorkflow(ownerSession.events, subject.id);
  }

  async function startReview(input) {
    return withTransitionLock(input.subjectId, () => startReviewUnlocked(input));
  }

  async function submitReviewUnlocked(input) {
    const reviewer = await helpers.requireDescriptor(input.reviewerId);
    if (reviewer.role !== "review" || reviewer.depth !== 1 || !reviewer.parentId) throw new CompanyThreadError("只有直属独立审查代理可以提交审查", "NOT_REVIEWER");
    const owner = await helpers.requireDescriptor(reviewer.parentId);
    assertOwner(owner);
    const subject = await helpers.requireDescriptor(input.subjectId);
    assertExecution(owner, subject);
    const ownerSession = await helpers.sessionFor(owner.id);
    const current = foldWorkflow(ownerSession.events, subject.id);
    if (!current?.reviewerIds) throw new CompanyThreadError("当前没有有效的冻结审查批次", "NO_ACTIVE_REVIEW");
    if (!current.reviewerIds.includes(reviewer.id)) throw new CompanyThreadError("该线程不在本轮审查席中", "NOT_ASSIGNED_REVIEWER");
    if (current.verdicts[reviewer.id]) throw new CompanyThreadError("本轮审查原文已提交，不能修改或重复提交", "REVIEW_IMMUTABLE");
    if (!current.frozen) throw new CompanyThreadError("本轮审查已结算，不能再提交", "NO_ACTIVE_REVIEW");
    const verdict = String(input.verdict || "").toUpperCase();
    if (verdict !== "PASS" && verdict !== "FAIL") throw new CompanyThreadError("审查结论只能是 PASS 或 FAIL", "INVALID_VERDICT");
    const report = requiredText(input.report, "审查原文");
    const submittedAt = Date.now();
    const reportHash = hashReviewReport(report);
    const immutable = { subjectId: subject.id, ownerId: owner.id, reviewerId: reviewer.id, cycle: current.cycle, completionId: current.snapshot.completionId, completionDigest: current.snapshot.completionDigest, verdict, report, reportHash, submittedAt };
    const reviewerSession = await helpers.sessionFor(reviewer.id);
    helpers.appendEvent(reviewerSession, REVIEW_REPORT_EVENT, immutable);
    helpers.appendEvent(ownerSession, WORKFLOW_EVENT, { op: "review-verdict", subjectId: subject.id, cycle: current.cycle, reviewerId: reviewer.id, verdict, report, reportHash, submittedAt });
    helpers.appendEvent(ownerSession, REVIEW_MIRROR_EVENT, immutable);
    const mirrorText = "审查原文（不可修改）\n被审：" + subject.label + "\n交付：" + current.snapshot.completionId + "\n批次：" + current.cycle + "\n结论：" + verdict + "\nSHA256：" + reportHash + "\n\n" + report;
    await helpers.deliverMailbox(owner.id, enqueueMessage({ id: randomUUID(), kind: "review", fromId: reviewer.id, toId: owner.id, parentId: owner.id, text: mirrorText }), reviewer.label);
    await helpers.setStatus(reviewer.id, "complete");
    const next = foldWorkflow(ownerSession.events, subject.id);
    if (next.phase === "passed") {
      await helpers.setStatus(subject.id, "waiting");
      return next;
    }
    if (next.phase === "repair-required" && next.frozen === false) {
      const failures = Object.entries(next.verdicts)
        .filter(([, item]) => item.verdict === "FAIL")
        .map(([id, item]) => `审查代理 ${id}\n${item.report}`);
      const text = [
        `第 ${next.cycle} 轮审查 FAIL。固定交付 ${next.snapshot.completionId} 作废，按以下问题完整返工：`,
        ...failures,
        "修复后重新 submit_completion；旧 PASS/FAIL 不得复用。",
      ].join("\n\n");
      await helpers.rejectCompletion(owner.id, subject.id, text);
      helpers.appendEvent(ownerSession, WORKFLOW_EVENT, { op: "repair-start", subjectId: subject.id, cycle: next.cycle, startedAt: Date.now() });
      return { ...foldWorkflow(ownerSession.events, subject.id), reviewFailed: true };
    }
    await helpers.setStatus(subject.id, "waiting");
    return next;
  }

  async function submitReview(input) {
    return withTransitionLock(input.subjectId, () => submitReviewUnlocked(input));
  }

  async function cancelReviewUnlocked(input) {
    const owner = await helpers.requireDescriptor(input.ownerId);
    assertOwner(owner);
    const subject = await helpers.requireDescriptor(input.subjectId);
    assertExecution(owner, subject);
    const reason = requiredText(input.reason, "取消原因");
    const ownerSession = await helpers.sessionFor(owner.id);
    const current = foldWorkflow(ownerSession.events, subject.id);
    if (!current?.frozen || !current.reviewerIds?.length) throw new CompanyThreadError("当前没有可取消的冻结审查批次", "NO_ACTIVE_REVIEW");
    const failed = Object.values(current.verdicts ?? {}).some((item) => item.verdict === "FAIL");
    helpers.appendEvent(ownerSession, WORKFLOW_EVENT, { op: "review-cancel", subjectId: subject.id, cycle: current.cycle, reason, cancelledAt: Date.now() });
    for (const reviewerId of current.reviewerIds) {
      if (!current.verdicts?.[reviewerId]) {
        await helpers.deliverMailbox(reviewerId, enqueueMessage({ id: randomUUID(), kind: "review", fromId: owner.id, toId: reviewerId, parentId: owner.id, text: `第 ${current.cycle} 轮审查已由根线程取消：${reason}\n停止本轮审查，等待新任务。` }), owner.label);
      }
      await helpers.setStatus(reviewerId, "complete");
    }
    if (failed) {
      const failures = Object.entries(current.verdicts)
        .filter(([, item]) => item.verdict === "FAIL")
        .map(([id, item]) => `审查代理 ${id}\n${item.report}`);
      const note = [`第 ${current.cycle} 轮审查已有 FAIL，取消未完成席位后仍必须返工。`, ...failures, `取消原因：${reason}`].join("\n\n");
      await helpers.rejectCompletion(owner.id, subject.id, note);
      helpers.appendEvent(ownerSession, WORKFLOW_EVENT, { op: "repair-start", subjectId: subject.id, cycle: current.cycle, startedAt: Date.now() });
      return { ...foldWorkflow(ownerSession.events, subject.id), reviewFailed: true, cancelled: true };
    }
    await helpers.setStatus(subject.id, "waiting");
    return { ...foldWorkflow(ownerSession.events, subject.id), cancelled: true };
  }

  async function cancelReview(input) {
    return withTransitionLock(input.subjectId, () => cancelReviewUnlocked(input));
  }

  async function assertAssignmentAllowedUnlocked(parent, child) {
    if ((parent.depth ?? 0) !== 0 || child.role !== "work") return;
    const session = await helpers.sessionFor(parent.id);
    const current = foldWorkflow(session.events, child.id);
    if (current?.frozen) throw new CompanyThreadError("被审对象已冻结，审查结束前不能派发修改", "REVIEW_FROZEN");
    if (current?.phase === "repair-required" || current?.phase === "passed") {
      if (typeof helpers.invalidatePendingCompletion === "function") await helpers.invalidatePendingCompletion(parent.id, child.id, "new-work-assigned");
      helpers.appendEvent(session, WORKFLOW_EVENT, { op: "repair-start", subjectId: child.id, cycle: current.cycle, startedAt: Date.now() });
    }
    await helpers.setStatus(child.id, "running");
  }

  async function assertAssignmentAllowed(parent, child) {
    return withTransitionLock(child.id, () => assertAssignmentAllowedUnlocked(parent, child));
  }

  return { workflowState: stateFor, startReview, submitReview, cancelReview, assertAssignmentAllowed, assertAssignmentAllowedUnlocked };
}
