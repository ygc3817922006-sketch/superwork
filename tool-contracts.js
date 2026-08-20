// 合同 / 证据 / 升级 五个模型工具。由 tool.js 统一注册。
import { defineTool } from "/Applications/DSH Desktop.app/Contents/Resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-tools/lib/index.js";
import { ESCALATION_NEEDS, EVIDENCE_KINDS, plain } from "./contracts.js";

function requireAgent(exec) {
  if (!exec.agent) throw new Error("公司线程工具需要调用方智能体");
  return exec.agent;
}
const textOut = (fn) => ({ schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true }, summary: { type: "string", required: true } } }, render: (_a, v) => [{ type: "text", text: fn ? fn(v) : v.summary }] });

export const CONTRACT_PROMPT = [
  "合同制：根线程派活先 issue_contract（目标、逐条验收标准、预算），执行代理做完 submit_completion 交证据。每一版执行交付都必须 start_review 固定版本并拿到独立 PASS，根线程才能 accept；冻结审查中不能换交付。",
  "卡住立刻 escalate（决策/权限/资源/澄清/预算），裁决前 blocked，不许硬扛。",
].join("\n");

export function registerContractTools(ctx, api) {
  ctx.tools.register(defineTool({
    name: "issue_contract",
    description: "给直接下级线程签任务合同：目标、逐条验收标准、期望产物、约束与预算。合同原文进下级信箱；同一线程同一时间只能有一份生效合同（改用 amend_contract）。",
    parameters: {
      thread_id: { type: "string", required: true, description: "直接下级线程 id。" },
      objective: { type: "string", required: true, description: "一句话目标。" },
      acceptance: { type: "array", required: true, items: { type: "string" }, description: "逐条验收标准，每条都要能被证据覆盖。" },
      deliverables: { type: "array", items: { type: "string" }, description: "期望产物（路径或说明）。" },
      constraints: { type: "array", items: { type: "string" }, description: "约束（禁区、口径、只读目录等）。" },
      max_rounds: { type: "number", description: "goal 最大轮次，默认 16。" },
      max_reworks: { type: "number", description: "允许返工次数，超了自动升级，默认 2。" },
      max_concurrent: { type: "number", description: "该下级同时可跑的下级数，默认 4。" },
      max_minutes: { type: "number", description: "时限（分钟），0 不限，默认 240。" },
    },
    output: textOut(),
    async execute(args, exec) {
      const me = requireAgent(exec);
      const c = await api.issueContract({ issuerId: me.id, threadId: args.thread_id, objective: args.objective, acceptance: args.acceptance, deliverables: args.deliverables, constraints: args.constraints, budget: { maxRounds: args.max_rounds, maxReworks: args.max_reworks, maxConcurrent: args.max_concurrent, maxMinutes: args.max_minutes } });
      return { ok: true, summary: `已签合同 ${c.id}（v${c.version}）给 ${args.thread_id}：${c.acceptance.length} 条验收标准，预算 返工${c.budget.maxReworks}/并发${c.budget.maxConcurrent}/${c.budget.maxMinutes}分钟`, contractId: c.id };
    },
  }));

  ctx.tools.register(defineTool({
    name: "amend_contract",
    description: "修订直接下级的生效合同（目标/验收/产物/约束/预算任一项），版本号加一，修订原文进下级信箱。",
    parameters: {
      thread_id: { type: "string", required: true },
      objective: { type: "string" }, acceptance: { type: "array", items: { type: "string" } },
      deliverables: { type: "array", items: { type: "string" } }, constraints: { type: "array", items: { type: "string" } },
      max_rounds: { type: "number" }, max_reworks: { type: "number" }, max_concurrent: { type: "number" }, max_minutes: { type: "number" },
    },
    output: textOut(),
    async execute(args, exec) {
      const me = requireAgent(exec);
      const budget = {}; for (const [k, v] of [["maxRounds", args.max_rounds], ["maxReworks", args.max_reworks], ["maxConcurrent", args.max_concurrent], ["maxMinutes", args.max_minutes]]) if (v !== undefined) budget[k] = v;
      const c = await api.amendContract({ issuerId: me.id, threadId: args.thread_id, objective: args.objective, acceptance: args.acceptance, deliverables: args.deliverables, constraints: args.constraints, budget: Object.keys(budget).length ? budget : undefined });
      return { ok: true, summary: `合同已修订为 v${c.version}` };
    },
  }));

  ctx.tools.register(defineTool({
    name: "close_contract",
    description: "作废直接下级的生效合同（不再需要、目标变了、换人）。下级收到通知转 idle；之后可重新 issue_contract。",
    parameters: { thread_id: { type: "string", required: true }, reason: { type: "string", required: true } },
    output: textOut(),
    async execute(args, exec) { const me = requireAgent(exec); const c = await api.closeContract({ issuerId: me.id, threadId: args.thread_id, reason: args.reason }); return { ok: true, summary: `合同 ${c.id} 已作废` }; },
  }));

  ctx.tools.register(defineTool({
    name: "get_contract",
    description: "读取某个线程（自己或直接下级）当前的合同、完成交付、返工次数与升级记录。",
    parameters: { thread_id: { type: "string", description: "线程 id，省略则查自己。" } },
    output: { schema: { type: "object", additionalProperties: true, properties: { found: { type: "boolean", required: true } } }, render: (_a, v) => [{ type: "text", text: v.found ? JSON.stringify(v.contract, null, 2) : "该线程没有合同" }] },
    async execute(args, exec) {
      const me = requireAgent(exec);
      const c = await api.contractFor(args.thread_id || me.id, me.id);
      return c ? { found: true, contract: plain(c) } : { found: false };
    },
  }));

  ctx.tools.register(defineTool({
    name: "submit_completion",
    description: "执行代理向根线程提交完成交付。每条验收标准至少被一条证据覆盖；提交后由根线程启动独立审查。",
    parameters: {
      summary: { type: "string", required: true, description: "完成摘要，说人话。" },
      evidence: { type: "array", required: true, items: { type: "object", additionalProperties: false, properties: {
        kind: { type: "string", enum: EVIDENCE_KINDS }, ref: { type: "string", required: true, description: "文件绝对路径 / 命令 / 日志路径 / URL / 说明" },
        sha256: { type: "string" }, note: { type: "string" },
        covers: { type: "array", required: true, items: { type: "integer" }, description: "该证据覆盖的验收条目序号（从 1 数）" },
      } }, description: "证据清单。" },
    },
    output: textOut((v) => v.summary),
    async execute(args, exec) {
      const me = requireAgent(exec);
      const r = await api.submitCompletion({ threadId: me.id, summary: args.summary, evidence: args.evidence });
      return { ok: true, summary: `已提交固定交付 ${r.completion.id.slice(0, 8)}，${r.completion.evidence.length} 条证据${r.breaches.length ? "；⚠ 预算超支：" + r.breaches.map((b) => b.key).join(",") : ""}，等待根线程启动独立审查` };
    },
  }));

  ctx.tools.register(defineTool({
    name: "accept_completion",
    description: "上级验收通过直接下级最近一次待验收的完成交付：合同结清，线程置为 complete。",
    parameters: { thread_id: { type: "string", required: true }, note: { type: "string", description: "验收说明，可空。" } },
    output: textOut(),
    async execute(args, exec) { const me = requireAgent(exec); const c = await api.acceptCompletion({ issuerId: me.id, threadId: args.thread_id, note: args.note ?? "" }); return { ok: true, summary: `已验收通过，合同 ${c.id} ${c.status}` }; },
  }));

  ctx.tools.register(defineTool({
    name: "reject_completion",
    description: "上级打回直接下级最近一次待验收的完成交付：计一次返工，说明原文进下级信箱；返工超预算自动升级到更上一级。",
    parameters: { thread_id: { type: "string", required: true }, note: { type: "string", required: true, description: "为什么打回、要改什么。" } },
    output: textOut(),
    async execute(args, exec) { const me = requireAgent(exec); const c = await api.rejectCompletion({ issuerId: me.id, threadId: args.thread_id, note: args.note }); return { ok: true, summary: `已打回，累计返工 ${c.reworks}/${c.budget.maxReworks}` }; },
  }));

  ctx.tools.register(defineTool({
    name: "escalate",
    description: "卡住时向直接上级升级：要决策 / 要权限 / 要资源 / 要澄清 / 预算不够。裁决前你处于 blocked，不要硬扛也不要绕过。",
    parameters: {
      need: { type: "string", required: true, enum: ESCALATION_NEEDS },
      reason: { type: "string", required: true, description: "卡在哪、试过什么。" },
      options: { type: "array", items: { type: "string" }, description: "你建议的几个处理方案，便于上级一键裁决。" },
    },
    output: textOut(),
    async execute(args, exec) { const me = requireAgent(exec); const e = await api.raiseEscalation({ threadId: me.id, need: args.need, reason: args.reason, options: args.options }); return { ok: true, summary: `已升级（${e.need}）给上级，等待裁决` }; },
  }));

  ctx.tools.register(defineTool({
    name: "resolve_escalation",
    description: "对下级（含跨级自动升级上来的）待裁决升级给出裁决；裁决原文进该线程信箱，线程恢复 running。",
    parameters: { thread_id: { type: "string", required: true }, resolution: { type: "string", required: true }, escalation_id: { type: "string" } },
    output: textOut(),
    async execute(args, exec) { const me = requireAgent(exec); await api.resolveEscalation({ resolverId: me.id, threadId: args.thread_id, resolution: args.resolution, escalationId: args.escalation_id }); return { ok: true, summary: `已裁决 ${args.thread_id} 的升级` }; },
  }));
}
