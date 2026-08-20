// 合同账本：任务合同 · 证据化完成 · 失败升级 · 预算控制。
// 全部事件溯源，事件写在"发合同的那一方"（上级）的会话里，跟审查状态机同一路数：重启不丢、可回放。
// 设计原则：线程干活靠合同驱动，收口靠证据，卡住靠升级，失控靠预算刹车。
import { createHash, randomUUID } from "node:crypto";
import { CompanyThreadError, enqueueMessage } from "./logic.js";

export const CONTRACT_EVENT = "company-thread/contract";       // op: issue | amend | close
export const COMPLETION_EVENT = "company-thread/completion";   // op: submit | accept | reject
export const ESCALATION_EVENT = "company-thread/escalation";   // op: raise | resolve
export const MAIL_KIND_CONTRACT = "contract";
export const MAIL_KIND_COMPLETION = "completion";
export const MAIL_KIND_ESCALATION = "escalation";

export const DEFAULT_BUDGET = Object.freeze({
  maxRounds: 16,        // goal 最大轮次
  maxReworks: 2,        // 审查 FAIL 后允许返工的次数，超了自动升级
  maxConcurrent: 4,     // 同时处于 running 的直属下级数
  maxMinutes: 240,      // 合同时限，超时只标红不硬停
});
export const ESCALATION_NEEDS = ["decision", "permission", "resource", "clarification", "budget"];
export const EVIDENCE_KINDS = ["file", "command", "log", "url", "note"];

function text(value, label, { optional = false } = {}) {
  const t = typeof value === "string" ? value.trim() : "";
  if (!t && !optional) throw new CompanyThreadError(label + "不能为空", "EMPTY_CONTRACT_FIELD");
  return t;
}

function list(value, label, { min = 1 } = {}) {
  const arr = Array.isArray(value) ? value.map((v) => (typeof v === "string" ? v.trim() : v)).filter(Boolean) : [];
  if (arr.length < min) throw new CompanyThreadError(label + "至少 " + min + " 条", "EMPTY_CONTRACT_FIELD");
  return arr;
}

export function normalizeBudget(input = {}) {
  const out = { ...DEFAULT_BUDGET };
  for (const key of Object.keys(DEFAULT_BUDGET)) {
    if (input[key] === undefined || input[key] === null || input[key] === "") continue;
    const n = Number(input[key]);
    if (!Number.isFinite(n) || n < 0) throw new CompanyThreadError("预算 " + key + " 必须是非负数", "INVALID_BUDGET");
    out[key] = Math.floor(n);
  }
  return out;
}

export function hashText(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

/** 合同正文（发给下级信箱的可读版）。 */
export function renderContract(contract) {
  const lines = [
    "任务合同 " + contract.id + "（版本 " + contract.version + "）",
    "目标：" + contract.objective,
    "验收标准：",
    ...contract.acceptance.map((item, i) => "  " + (i + 1) + ". " + item),
  ];
  if (contract.deliverables.length) lines.push("期望产物：", ...contract.deliverables.map((d) => "  - " + d));
  if (contract.constraints.length) lines.push("约束：", ...contract.constraints.map((c) => "  - " + c));
  const b = contract.budget;
  lines.push("预算：最多 " + b.maxRounds + " 轮 goal，最多返工 " + b.maxReworks + " 次，同时最多 " + b.maxConcurrent + " 个下级在跑，时限 " + b.maxMinutes + " 分钟。");
  lines.push("完成时必须调用 submit_completion，每条验收标准至少对应一条可复验证据；卡住就 escalate，不许硬扛。");
  return lines.join("\n");
}

// ---------- 折叠 ----------
export function foldContracts(events, threadId) {
  const contracts = new Map(); // threadId -> 当前这一代合同
  for (const event of events ?? []) {
    const d = event.data ?? {};
    if (!d.threadId) continue;
    const cur = contracts.get(d.threadId);
    if (event.type === CONTRACT_EVENT) {
      if (d.op === "issue") {
        contracts.set(d.threadId, { ...d.contract, status: d.contract.placeholder ? "placeholder" : "active", reworks: 0, completions: [], escalations: (cur?.escalations ?? []).filter((e) => !e.resolved) });
      } else if (!cur) {
        continue;
      } else if (d.op === "amend") {
        contracts.set(d.threadId, { ...cur, ...d.patch, version: cur.version + 1, amendedAt: d.at });
      } else if (d.op === "close") {
        contracts.set(d.threadId, { ...cur, status: d.status || "closed", closedAt: d.at, closeReason: d.reason });
      } else if (d.op === "rework") {
        contracts.set(d.threadId, { ...cur, reworks: (cur.reworks ?? 0) + 1 });
      }
      continue;
    }
    if (!cur) continue;
    // 完成/升级只挂到"同一代"合同上：contractId 不匹配的（上一代的旧事件）忽略
    if (d.contractId && d.contractId !== cur.id) continue;
    if (event.type === COMPLETION_EVENT) {
      if (d.op === "submit") cur.completions = [...cur.completions.map((c) => c.verdict === "pending" ? { ...c, verdict: "superseded" } : c), { ...d.completion, verdict: "pending" }];
      else if (d.op === "invalidate-pending") cur.completions = cur.completions.map((c) => c.verdict === "pending" ? { ...c, verdict: "superseded", verdictNote: d.reason, verdictAt: d.at } : c);
      else if (d.op === "accept" || d.op === "reject") {
        cur.completions = cur.completions.map((c) => c.id === d.completionId ? { ...c, verdict: d.op === "accept" ? "accepted" : "rejected", verdictNote: d.note, verdictAt: d.at } : c);
        if (d.op === "accept") { cur.status = "fulfilled"; cur.closedAt = d.at; }
      }
    } else if (event.type === ESCALATION_EVENT) {
      if (d.op === "raise") cur.escalations = [...cur.escalations, { ...d.escalation, resolved: false }];
      else if (d.op === "resolve") cur.escalations = cur.escalations.map((e) => e.id === d.escalationId ? { ...e, resolved: true, resolution: d.resolution, resolvedAt: d.at, resolvedBy: d.by } : e);
    }
  }
  return threadId ? contracts.get(threadId) : Object.fromEntries(contracts);
}

/** 预算判定：给定合同与当前观测，返回超支项列表（空数组＝没超）。 */
export function budgetBreaches(contract, observed = {}) {
  if (!contract) return [];
  const b = contract.budget || DEFAULT_BUDGET;
  const out = [];
  if (observed.reworks !== undefined && observed.reworks > b.maxReworks) out.push({ key: "maxReworks", limit: b.maxReworks, actual: observed.reworks });
  if (observed.runningChildren !== undefined && observed.runningChildren >= b.maxConcurrent) out.push({ key: "maxConcurrent", limit: b.maxConcurrent, actual: observed.runningChildren });
  if (observed.rounds !== undefined && observed.rounds > b.maxRounds) out.push({ key: "maxRounds", limit: b.maxRounds, actual: observed.rounds });
  if (observed.now !== undefined && contract.issuedAt && b.maxMinutes > 0 && (observed.now - contract.issuedAt) / 60000 > b.maxMinutes) out.push({ key: "maxMinutes", limit: b.maxMinutes, actual: Math.round((observed.now - contract.issuedAt) / 60000) });
  return out;
}

/** 证据是否覆盖全部验收标准。返回缺证据的验收条目下标（从 1 数）。 */
export function uncoveredAcceptance(contract, evidence) {
  const covered = new Set();
  for (const item of evidence ?? []) for (const idx of item.covers ?? []) covered.add(Number(idx));
  const missing = [];
  contract.acceptance.forEach((_, i) => { if (!covered.has(i + 1)) missing.push(i + 1); });
  return missing;
}

/** covers 必须是 1..N 的整数，越界/小数/重复直接报错。 */
export function normalizeCovers(covers, total) {
  const arr = Array.isArray(covers) ? covers : [];
  const out = [];
  for (const raw of arr) {
    const n = typeof raw === "number" ? raw : NaN;
    if (!Number.isInteger(n) || n < 1 || n > total) throw new CompanyThreadError("证据覆盖的验收条目序号必须是 1 到 " + total + " 的整数，收到 " + JSON.stringify(raw), "INVALID_COVERS");
    if (!out.includes(n)) out.push(n);
  }
  if (!out.length) throw new CompanyThreadError("每条证据至少要写它覆盖哪条验收标准（covers）", "INVALID_COVERS");
  return out;
}

/** 去掉 undefined，保证工具输出是无损 JSON。 */
export function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

// ---------- 服务 ----------
export function createContractService(helpers) {
  const { requireDescriptor, sessionFor, appendEvent, deliverMailbox, setStatus, reviewState, onNewWork, resolveEvidence, now = () => Date.now() } = helpers;
  const withSubjectTransition = helpers.withSubjectTransition ?? (async (_subjectId, task) => task());

  // 审查冻结期间，合同侧任何会改变被审对象的动作都不许做（与 assign 同一条不变量）
  async function assertNotFrozen(issuer, thread) {
    if (typeof reviewState !== "function") return undefined;
    const state = await reviewState(issuer.id, thread.id);
    if (state?.frozen) throw new CompanyThreadError("被审对象已冻结，审查结束前不能修订合同或裁决交付", "REVIEW_FROZEN");
    return state;
  }

  async function issuerAndThread(issuerId, threadId) {
    const issuer = await requireDescriptor(issuerId);
    const thread = await requireDescriptor(threadId);
    if (thread.parentId !== issuer.id) throw new CompanyThreadError("只能给直接下级发合同", "NOT_DIRECT_CHILD");
    return { issuer, thread };
  }

  async function contractFor(threadId, viewerId) {
    const thread = await requireDescriptor(threadId);
    if (viewerId && viewerId !== thread.id && viewerId !== thread.parentId) throw new CompanyThreadError("只能查看自己或直接下级的合同", "CONTRACT_FORBIDDEN");
    if (!thread.parentId) return undefined;
    const session = await sessionFor(thread.parentId);
    return foldContracts(session.events, threadId);
  }

  async function issueContractUnlocked(input) {
    const { issuer, thread } = await issuerAndThread(input.issuerId, input.threadId);
    const session = await sessionFor(issuer.id);
    const existing = foldContracts(session.events, thread.id);
    if (existing && existing.status === "active") throw new CompanyThreadError("该线程已有生效合同：改条款用 amend_contract，作废用 close_contract", "CONTRACT_ACTIVE");
    // 并发预算：发合同方自己的合同（若有）限制它"同时生效的下级合同数"
    const issuerContract = issuer.parentId ? foldContracts((await sessionFor(issuer.parentId)).events, issuer.id) : undefined;
    if (issuerContract && issuerContract.status === "active") {
      const all = foldContracts(session.events);
      const activeOthers = Object.values(all).filter((c) => c.status === "active" && c.threadId !== thread.id).length;
      if (activeOthers >= issuerContract.budget.maxConcurrent) throw new CompanyThreadError("同时生效的下级合同已达上限 " + issuerContract.budget.maxConcurrent + "，先收口一单再签", "BUDGET_CONCURRENCY");
    }
    if (typeof onNewWork === "function") await onNewWork(issuer, thread); // 新合同＝新一轮工作：旧审查 PASS 作废（走 repair-start），冻结中则拒
    const contract = {
      id: randomUUID(), threadId: thread.id, issuerId: issuer.id, version: 1,
      objective: text(input.objective, "目标"),
      acceptance: list(input.acceptance, "验收标准"),
      deliverables: Array.isArray(input.deliverables) ? input.deliverables.filter(Boolean) : [],
      constraints: Array.isArray(input.constraints) ? input.constraints.filter(Boolean) : [],
      budget: normalizeBudget(input.budget),
      issuedAt: now(),
    };
    appendEvent(session, CONTRACT_EVENT, { op: "issue", threadId: thread.id, contract });
    await deliverMailbox(thread.id, enqueueMessage({ id: randomUUID(), kind: MAIL_KIND_CONTRACT, fromId: issuer.id, toId: thread.id, parentId: issuer.id, text: renderContract(contract) }), issuer.label);
    await setStatus(thread.id, "running");
    return foldContracts(session.events, thread.id);
  }

  async function issueContract(input) {
    return withSubjectTransition(input.threadId, () => issueContractUnlocked(input));
  }

  async function amendContractUnlocked(input) {
    const { issuer, thread } = await issuerAndThread(input.issuerId, input.threadId);
    const session = await sessionFor(issuer.id);
    const cur = foldContracts(session.events, thread.id);
    if (!cur || cur.status !== "active") throw new CompanyThreadError("没有生效合同可修订", "NO_CONTRACT");
    await assertNotFrozen(issuer, thread);
    const patch = {};
    if (input.objective !== undefined) patch.objective = text(input.objective, "目标");
    if (input.acceptance !== undefined) patch.acceptance = list(input.acceptance, "验收标准");
    if (input.deliverables !== undefined) patch.deliverables = input.deliverables.filter(Boolean);
    if (input.constraints !== undefined) patch.constraints = input.constraints.filter(Boolean);
    if (input.budget !== undefined) patch.budget = normalizeBudget({ ...cur.budget, ...input.budget });
    if (!Object.keys(patch).length) throw new CompanyThreadError("修订内容为空", "EMPTY_CONTRACT_FIELD");
    appendEvent(session, CONTRACT_EVENT, { op: "amend", threadId: thread.id, patch, at: now() });
    appendEvent(session, COMPLETION_EVENT, { op: "invalidate-pending", threadId: thread.id, contractId: cur.id, reason: "contract-amended", at: now() });
    const next = foldContracts(session.events, thread.id);
    await deliverMailbox(thread.id, enqueueMessage({ id: randomUUID(), kind: MAIL_KIND_CONTRACT, fromId: issuer.id, toId: thread.id, parentId: issuer.id, text: "合同已修订：\n" + renderContract(next) }), issuer.label);
    return next;
  }

  async function amendContract(input) {
    return withSubjectTransition(input.threadId, () => amendContractUnlocked(input));
  }

  async function closeContractUnlocked(input) {
    const { issuer, thread } = await issuerAndThread(input.issuerId, input.threadId);
    const session = await sessionFor(issuer.id);
    const cur = foldContracts(session.events, thread.id);
    if (!cur || (cur.status !== "active" && cur.status !== "placeholder")) throw new CompanyThreadError("没有生效合同可作废", "NO_CONTRACT");
    await assertNotFrozen(issuer, thread);
    appendEvent(session, CONTRACT_EVENT, { op: "close", threadId: thread.id, status: "cancelled", reason: text(input.reason, "作废原因"), at: now() });
    await deliverMailbox(thread.id, enqueueMessage({ id: randomUUID(), kind: MAIL_KIND_CONTRACT, fromId: issuer.id, toId: thread.id, parentId: issuer.id, text: "合同 " + cur.id + " 已作废：" + input.reason + "\n停止相关工作，等待新合同或指示。" }), issuer.label);
    await setStatus(thread.id, "idle");
    return foldContracts(session.events, thread.id);
  }

  async function closeContract(input) {
    return withSubjectTransition(input.threadId, () => closeContractUnlocked(input));
  }

  async function submitCompletionUnlocked(input) {
    const thread = await requireDescriptor(input.threadId);
    if (!thread.parentId) throw new CompanyThreadError("根线程没有合同可交付", "NO_PARENT");
    const parent = await requireDescriptor(thread.parentId);
    const session = await sessionFor(parent.id);
    const contract = foldContracts(session.events, thread.id);
    if (!contract || contract.status !== "active") throw new CompanyThreadError("没有生效合同，不能提交完成；先让上级发合同", "NO_CONTRACT");
    const reviewBeforeSubmit = await assertNotFrozen(parent, thread); // 冻结审查期间不许换交付版本
    // PASS 只对固定的上一版交付有效；再次提交必须先使旧审查失效。
    if (reviewBeforeSubmit?.phase === "passed" || reviewBeforeSubmit?.phase === "repair-required") {
      if (typeof onNewWork === "function") await onNewWork(parent, thread);
    }
    const evidence = [];
    for (const e of Array.isArray(input.evidence) ? input.evidence : []) {
      const normalized = {
        kind: EVIDENCE_KINDS.includes(e.kind) ? e.kind : "note",
        ref: text(e.ref, "证据引用"),
        ...(e.sha256 ? { sha256: String(e.sha256) } : {}),
        ...(e.note ? { note: String(e.note) } : {}),
        covers: normalizeCovers(e.covers, contract.acceptance.length),
      };
      evidence.push(typeof resolveEvidence === "function" ? await resolveEvidence(thread, normalized) : normalized);
    }
    if (!evidence.length) throw new CompanyThreadError("必须至少提交一条证据", "NO_EVIDENCE");
    const missing = uncoveredAcceptance(contract, evidence);
    if (missing.length) throw new CompanyThreadError("以下验收标准没有证据覆盖：第 " + missing.join("、") + " 条", "ACCEPTANCE_UNCOVERED");
    const summary = text(input.summary, "完成摘要");
    const completion = { id: randomUUID(), threadId: thread.id, contractId: contract.id, contractVersion: contract.version, summary, evidence, submittedAt: now(), digest: hashText(JSON.stringify({ summary, evidence })) };
    appendEvent(session, COMPLETION_EVENT, { op: "submit", threadId: thread.id, contractId: contract.id, completion });
    const breaches = budgetBreaches(contract, { now: now(), reworks: contract.reworks });
    const lines = ["完成交付（待验收）", "线程：" + thread.label + "（" + thread.id + "）", "合同：" + contract.id + " v" + contract.version, "摘要：" + completion.summary, "证据："];
    for (const e of evidence) lines.push("  - [" + e.kind + "] " + e.ref + (e.sha256 ? " sha256=" + e.sha256.slice(0, 16) : "") + " → 覆盖验收 " + e.covers.join(",") + (e.note ? "（" + e.note + "）" : ""));
    if (breaches.length) lines.push("⚠ 预算超支：" + breaches.map((b) => b.key + " " + b.actual + "/" + b.limit).join("，"));
    lines.push("执行代理交付必须先用 start_review 完成独立审查；PASS 后才能 accept_completion。");
    await deliverMailbox(parent.id, enqueueMessage({ id: randomUUID(), kind: MAIL_KIND_COMPLETION, fromId: thread.id, toId: parent.id, parentId: parent.id, text: lines.join("\n") }), thread.label);
    await setStatus(thread.id, "waiting");
    return { completion, breaches };
  }

  async function submitCompletion(input) {
    return withSubjectTransition(input.threadId, () => submitCompletionUnlocked(input));
  }

  async function judgeCompletion(input, op) {
    const { issuer, thread } = await issuerAndThread(input.issuerId, input.threadId);
    const session = await sessionFor(issuer.id);
    const contract = foldContracts(session.events, thread.id);
    if (!contract) throw new CompanyThreadError("没有合同", "NO_CONTRACT");
    if (contract.status !== "active") throw new CompanyThreadError("合同已结束，不能再验收旧交付", "CONTRACT_INACTIVE");
    const completion = [...contract.completions].reverse().find((c) => c.verdict === "pending");
    if (!completion) throw new CompanyThreadError("没有待验收的完成交付", "NO_PENDING_COMPLETION");
    const review = await assertNotFrozen(issuer, thread);
    if (op === "accept" && thread.role === "work") {
      if (!review || review.cycle < 1 || review.phase !== "passed") {
        throw new CompanyThreadError("执行代理必须完成独立审查并 PASS，不能越过审查验收", "REVIEW_NOT_PASSED");
      }
      const snapshot = review.snapshot ?? {};
      if (snapshot.contractId !== contract.id || snapshot.contractVersion !== contract.version || snapshot.completionId !== completion.id || snapshot.completionDigest !== completion.digest) {
        throw new CompanyThreadError("审查通过的不是当前待验收交付，必须对当前固定版本重新审查", "REVIEW_VERSION_MISMATCH");
      }
      if (typeof resolveEvidence === "function") {
        for (const evidence of completion.evidence) {
          if (evidence.kind === "file" || evidence.kind === "log") await resolveEvidence(thread, evidence);
        }
      }
    }
    appendEvent(session, COMPLETION_EVENT, { op, threadId: thread.id, contractId: contract.id, completionId: completion.id, note: text(input.note, "验收说明", { optional: op === "accept" }), at: now() });
    if (op === "accept") {
      await setStatus(thread.id, "complete");
    } else {
      appendEvent(session, CONTRACT_EVENT, { op: "rework", threadId: thread.id, at: now() });
      await setStatus(thread.id, "running");
      const next = foldContracts(session.events, thread.id);
      const breaches = budgetBreaches(next, { reworks: next.reworks });
      await deliverMailbox(thread.id, enqueueMessage({ id: randomUUID(), kind: MAIL_KIND_COMPLETION, fromId: issuer.id, toId: thread.id, parentId: issuer.id, text: "交付被打回（第 " + next.reworks + " 次返工）：" + input.note + "\n修完重新 submit_completion。" }), issuer.label);
      if (breaches.some((b) => b.key === "maxReworks")) await autoEscalate(issuer, thread, "返工次数已超预算（" + next.reworks + "/" + next.budget.maxReworks + "），请上级裁决是否继续、换人或改合同");
    }
    return foldContracts(session.events, thread.id);
  }

  async function invalidatePendingCompletionUnlocked(input) {
    const { issuer, thread } = await issuerAndThread(input.issuerId, input.threadId);
    const session = await sessionFor(issuer.id);
    const contract = foldContracts(session.events, thread.id);
    if (!contract || contract.status !== "active") return contract;
    if (contract.completions.some((item) => item.verdict === "pending")) {
      appendEvent(session, COMPLETION_EVENT, { op: "invalidate-pending", threadId: thread.id, contractId: contract.id, reason: input.reason || "new-work", at: now() });
    }
    return foldContracts(session.events, thread.id);
  }

  async function raiseEscalation(input) {
    const thread = await requireDescriptor(input.threadId);
    if (!thread.parentId) throw new CompanyThreadError("根线程没有上级可升级", "NO_PARENT");
    const parent = await requireDescriptor(thread.parentId);
    return escalate(parent, thread, { need: input.need, reason: input.reason, options: input.options, raisedBy: thread.id });
  }

  async function autoEscalate(issuer, thread, reason) {
    // 预算类自动升级：升到发合同方的上级（通常是小K）；发合同方就是根时升给根自己
    const target = issuer.parentId ? await requireDescriptor(issuer.parentId) : issuer;
    return escalate(target, thread, { need: "budget", reason, raisedBy: "system", viaId: issuer.id });
  }

  async function escalate(target, thread, { need, reason, options, raisedBy, viaId }) {
    const kind = ESCALATION_NEEDS.includes(need) ? need : "decision";
    const fresh = await requireDescriptor(thread.id);
    const escalation = { id: randomUUID(), threadId: thread.id, targetId: target.id, need: kind, reason: text(reason, "升级原因"), options: Array.isArray(options) ? options.filter(Boolean) : [], raisedBy, viaId: viaId ?? null, prevStatus: fresh.status ?? "running", raisedAt: now() };
    // 事件写在"发合同方"会话（合同账本所在处），没有合同也照记（写在直接上级）
    const ledgerOwner = viaId ? await requireDescriptor(viaId) : target;
    const session = await sessionFor(ledgerOwner.id);
    let ledger = foldContracts(session.events, thread.id);
    if (!ledger || (ledger.status !== "active" && ledger.status !== "placeholder")) {
      // 没有生效合同时补一份"占位"（status=placeholder，不挡正式签约），保证升级有处可挂
      appendEvent(session, CONTRACT_EVENT, { op: "issue", threadId: thread.id, contract: { id: randomUUID(), threadId: thread.id, issuerId: ledgerOwner.id, version: 0, objective: thread.objective || "（未签合同）", acceptance: ["（未签合同）"], deliverables: [], constraints: [], budget: normalizeBudget(), issuedAt: now(), placeholder: true } });
      ledger = foldContracts(session.events, thread.id);
    }
    appendEvent(session, ESCALATION_EVENT, { op: "raise", threadId: thread.id, contractId: ledger.id, escalation });
    const lines = ["⚠ 升级请求（" + kind + "）", "来自：" + thread.label + "（" + thread.id + "）" + (viaId ? "，经 " + ledgerOwner.label : ""), "原因：" + escalation.reason];
    if (escalation.options.length) lines.push("可选处理：", ...escalation.options.map((o, i) => "  " + (i + 1) + ". " + o));
    lines.push("请用 resolve_escalation 给出裁决；裁决前该线程处于 blocked。");
    await deliverMailbox(target.id, enqueueMessage({ id: randomUUID(), kind: MAIL_KIND_ESCALATION, fromId: raisedBy === "system" ? ledgerOwner.id : thread.id, toId: target.id, parentId: target.id, text: lines.join("\n") }), raisedBy === "system" ? "系统" : thread.label);
    // 冻结审查中的线程可以升级（比如审查席问它要东西），但状态由审查状态机管，这里不动
    let frozen = false;
    try { const st = typeof reviewState === "function" && thread.parentId ? await reviewState(thread.parentId, thread.id) : undefined; frozen = !!st?.frozen; } catch {}
    if (!frozen) await setStatus(thread.id, "blocked");
    return escalation;
  }

  async function resolveEscalation(input) {
    const resolver = await requireDescriptor(input.resolverId);
    const thread = await requireDescriptor(input.threadId);
    // 账本可能在直接上级，也可能（自动升级时）在中间那级；两处都找
    const candidates = [thread.parentId, resolver.id].filter(Boolean);
    for (const ownerId of [...new Set(candidates)]) {
      const session = await sessionFor(ownerId);
      const contract = foldContracts(session.events, thread.id);
      const open = contract?.escalations?.filter((e) => !e.resolved && e.targetId === resolver.id) ?? [];
      const target = input.escalationId ? open.find((e) => e.id === input.escalationId) : open[open.length - 1];
      if (!target) continue;
      appendEvent(session, ESCALATION_EVENT, { op: "resolve", threadId: thread.id, contractId: contract.id, escalationId: target.id, resolution: text(input.resolution, "裁决"), by: resolver.id, at: now() });
      await deliverMailbox(thread.id, enqueueMessage({ id: randomUUID(), kind: MAIL_KIND_ESCALATION, fromId: resolver.id, toId: thread.id, parentId: thread.parentId, text: "升级已裁决（" + target.need + "）：" + input.resolution + "\n按裁决继续。" }), resolver.label);
      const back = target.prevStatus && target.prevStatus !== "blocked" ? target.prevStatus : "running";
      await setStatus(thread.id, back);
      return foldContracts(session.events, thread.id);
    }
    throw new CompanyThreadError("没有待你裁决的升级", "NO_OPEN_ESCALATION");
  }

  return {
    contractFor,
    issueContract,
    amendContract,
    closeContract,
    submitCompletion,
    acceptCompletion: (input) => withSubjectTransition(input.threadId, () => judgeCompletion(input, "accept")),
    rejectCompletion: (input) => withSubjectTransition(input.threadId, () => judgeCompletion(input, "reject")),
    rejectCompletionUnlocked: (input) => judgeCompletion(input, "reject"),
    invalidatePendingCompletionUnlocked,
    raiseEscalation,
    resolveEscalation,
    autoEscalate,
  };
}
