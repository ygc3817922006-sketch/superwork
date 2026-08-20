import { defineTool } from "/Applications/DSH Desktop.app/Contents/Resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-tools/lib/index.js";
import { PERMISSION_TEMPLATES } from "./logic.js";
import { registerContractTools, CONTRACT_PROMPT } from "./tool-contracts.js";
import { registerCheckpointTools, CHECKPOINT_PROMPT } from "./tool-checkpoints.js";

export const name = "superwork-tools";
export const inject = ["tools", "systemPrompt", "superwork"];

const PERMISSION_IDS = Object.keys(PERMISSION_TEMPLATES);
const textOut = () => ({
  schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true }, summary: { type: "string", required: true } } },
  render: (_args, value) => [{ type: "text", text: value.summary }],
});

function requireAgent(exec) {
  if (!exec.agent) throw new Error("公司线程工具需要调用方智能体");
  return exec.agent;
}

export function apply(ctx) {
  const api = ctx.superwork;

  ctx.systemPrompt.section({
    name: "superwork",
    order: 116,
    text: [
      "你处在 superwork 扁平工作流里。正式协作单位是可见独立线程，不是官方子代理。",
      "没有 superwork 上级描述的普通会话是根线程；收到直属工作代理身份的会话不是新根，必须服从该身份。根线程只能开一层直属执行/审查代理；工作代理不能再开下级，也不能横向通信。",
      "执行/审查代理模板（名字、模型、权限、预算、指令）在设置→工作流里配；create_thread 传 profile=模板名即可，不传则按 role 选默认模板。",
      "根线程用 create_thread 开直属独立会话。每个工作代理可独立选 provider、model、reasoning_effort；未填则继承根线程。",
      "根线程用 assign_thread 派工；工作代理用 report_to_parent 汇报，也可用 rename_self 给自己改显示名。线程状态只由 superwork 状态机设置。",
      "权限只能同级或缩小：read-only、workspace-write、auto、full-controlled。full-controlled 仍要审批，禁止改成无审批完整权限。",
      "执行交付必须由根线程启动直属审查代理独立审查；执行与审查不能直接协商。根线程用 start_review 固定当前交付版本，审查代理用 submit_review 提交不可修改原文。",
      "任一审查 FAIL 后必须返工，并重新启动完整审查；旧批次 PASS 不能复用。长任务给下级线程设 goal。",
      CHECKPOINT_PROMPT,
      CONTRACT_PROMPT,
    ].join("\n"),
  });

  registerContractTools(ctx, api);
  registerCheckpointTools(ctx, api);

  ctx.tools.register(defineTool({
    name: "create_thread",
    description: "根线程创建一个直属可见工作代理。它是普通 Session，有独立工作目录、权限、模型和 goal，不是官方子代理。role 只能是 work 或 review；工作代理不能再开下级。",
    parameters: {
      label: { type: "string", required: true, description: "线程短名。" },
      brief: { type: "string", required: true, description: "完整任务书。" },
      cwd: { type: "string", required: true, description: "下级独立工作目录，必须是绝对路径。" },
      permission: { type: "string", enum: PERMISSION_IDS, description: "权限模板，不能高于自己。" },
      role: { type: "string", required: true, enum: ["work", "review"], description: "work=执行代理；review=独立只读审查代理。" },
      profile: { type: "string", description: "按哪张工作代理模板开（设置→工作流里的名称或 id）。不填按 role 使用第一张启用模板。" },
      provider: { type: "string", description: "下级模型提供方。未填则继承自己当前请求头或 agent.options。" },
      model: { type: "string", description: "下级模型名。未填则继承自己当前选择。" },
      reasoning_effort: { type: "string", description: "下级思考程度。未填则继承；只写入首次 request/header，之后可用原生换模。" },
      start_goal: { type: "boolean", description: "创建后立刻给该线程设置 goal。" },
      max_goal_rounds: { type: "number", description: "goal 最大轮次。" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          threadId: { type: "string", required: true },
          permission: { type: "string", required: true },
          cwd: { type: "string", required: true },
          depth: { type: "number", required: true },
          provider: { type: "string" },
          model: { type: "string" },
          reasoningEffort: { type: "string" },
        },
      },
      render(_args, value) {
        const route = [value.provider, value.model].filter(Boolean).join("/");
        const effort = value.reasoningEffort ? ` · ${value.reasoningEffort}` : "";
        return [{ type: "text", text: `已创建独立线程 ${value.threadId}，层级 ${value.depth}，权限 ${value.permission}，目录 ${value.cwd}${route ? `，模型 ${route}${effort}` : ""}` }];
      },
    },
    async execute(args, exec) {
      const parent = requireAgent(exec);
      const thread = await api.createThread({
        parentId: parent.id,
        label: args.label,
        brief: args.brief,
        objective: args.brief,
        cwd: args.cwd,
        permission: args.permission,
        role: args.role,
        profile: args.profile,
        provider: args.provider,
        model: args.model,
        reasoningEffort: args.reasoning_effort,
        startGoal: args.start_goal,
        maxGoalRounds: args.max_goal_rounds,
      });
      return {
        threadId: thread.id,
        permission: thread.permission,
        cwd: thread.cwd,
        depth: thread.depth,
        ...thread.provider ? { provider: thread.provider } : {},
        ...thread.model ? { model: thread.model } : {},
        ...thread.reasoningEffort ? { reasoningEffort: thread.reasoningEffort } : {},
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: "assign_thread",
    description: "只向自己的直接下级线程派工。下级离线时写入持久信箱，恢复后投递。",
    parameters: {
      thread_id: { type: "string", required: true, description: "直接下级线程 id。" },
      text: { type: "string", required: true, description: "派工内容。" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          delivered: { type: "boolean", required: true },
          queued: { type: "boolean" },
          messageId: { type: "string", required: true },
        },
      },
      render(args, value) {
        return [{ type: "text", text: value.delivered ? `已派给 ${args.thread_id}` : `已写入 ${args.thread_id} 的离线信箱` }];
      },
    },
    async execute(args, exec) {
      const parent = requireAgent(exec);
      const result = await api.assign({ parentId: parent.id, childId: args.thread_id, text: args.text });
      return { delivered: result.delivered === true, queued: result.queued === true, messageId: result.message.id };
    },
  }));

  ctx.tools.register(defineTool({
    name: "report_to_parent",
    description: "工作代理只向根线程汇报。根线程离线时写入持久信箱；汇报不能自行改变线程状态。",
    parameters: {
      text: { type: "string", required: true, description: "可验收的汇报。" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          delivered: { type: "boolean", required: true },
          queued: { type: "boolean" },
          messageId: { type: "string", required: true },
        },
      },
      render(_args, value) {
        return [{ type: "text", text: value.delivered ? "已送达直接上级" : "上级离线，已写入其信箱" }];
      },
    },
    async execute(args, exec) {
      const child = requireAgent(exec);
      const result = await api.report({ childId: child.id, text: args.text });
      return { delivered: result.delivered === true, queued: result.queued === true, messageId: result.message.id };
    },
  }));

  ctx.tools.register(defineTool({
    name: "rename_self",
    description: "执行或审查代理给自己的线程改显示名。只能改名称，不能改变角色、权限或状态。",
    parameters: { name: { type: "string", required: true, description: "新的简短线程名，最多 48 字符。" } },
    output: textOut(),
    async execute(args, exec) {
      const me = requireAgent(exec);
      const renamed = await api.renameSelf(me.id, args.name);
      return { ok: true, summary: `已更名为「${renamed.label}」` };
    },
  }));

  ctx.tools.register(defineTool({
    name: "start_review",
    description: "根线程启动完整独立审查。系统固定直属执行代理当前待验收交付，并把合同、交付摘要和证据发给一个或多个直属审查代理。",
    parameters: {
      subject_thread_id: { type: "string", required: true, description: "直属执行代理 id。" },
      review_thread_ids: { type: "array", required: true, items: { type: "string" }, description: "一个或多个直属审查代理 id。" },
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render(_args, value) {
        return [{ type: "text", text: `已启动第 ${value.cycle} 轮完整审查，被审对象已冻结` }];
      },
    },
    async execute(args, exec) {
      const manager = requireAgent(exec);
      return api.startReview({ ownerId: manager.id, subjectId: args.subject_thread_id, reviewerIds: args.review_thread_ids });
    },
  }));

  ctx.tools.register(defineTool({
    name: "submit_review",
    description: "直属独立审查代理提交本轮不可修改的原文报告。报告带 SHA256 并同步给根线程；任一 FAIL 会由系统退回执行代理返工。",
    parameters: {
      subject_thread_id: { type: "string", required: true, description: "被审直属执行代理 id。" },
      verdict: { type: "string", required: true, enum: ["PASS", "FAIL"], description: "审查结论。" },
      report: { type: "string", required: true, description: "完整审查原文；提交后不能修改。" },
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render(_args, value) {
        return [{ type: "text", text: value.phase === "passed" ? "全部审查通过，等待根线程验收" : value.reviewFailed ? "审查失败，已自动退回执行代理返工" : value.phase === "repair-required" ? "审查失败，必须返工后完整重审" : "本席已提交，等待其他审查席" }];
      },
    },
    async execute(args, exec) {
      const reviewer = requireAgent(exec);
      return api.submitReview({ reviewerId: reviewer.id, subjectId: args.subject_thread_id, verdict: args.verdict, report: args.report });
    },
  }));

  ctx.tools.register(defineTool({
    name: "cancel_review",
    description: "根线程取消卡住的冻结审查批次。若本轮已有任何 FAIL，固定交付仍会被打回并计入返工；不能用取消洗掉 FAIL。",
    parameters: {
      subject_thread_id: { type: "string", required: true, description: "直属执行代理 id。" },
      reason: { type: "string", required: true, description: "取消原因，例如审查代理失联。" },
    },
    output: textOut(),
    async execute(args, exec) {
      const manager = requireAgent(exec);
      const result = await api.cancelReview({ ownerId: manager.id, subjectId: args.subject_thread_id, reason: args.reason });
      return { ok: true, summary: result.reviewFailed ? "审查已取消；已有 FAIL，交付已打回返工" : "审查已取消，可更换审查代理后重新启动" };
    },
  }));

  ctx.tools.register(defineTool({
    name: "get_review_state",
    description: "根线程读取直属执行代理的审查、冻结、返工和重审状态。",
    parameters: {
      subject_thread_id: { type: "string", required: true, description: "直属执行代理 id。" },
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render(_args, value) { return [{ type: "text", text: `当前阶段 ${value.phase || "尚未审查"}` }]; },
    },
    async execute(args, exec) {
      const manager = requireAgent(exec);
      return (await api.workflowState(manager.id, args.subject_thread_id)) ?? { phase: "execution", cycle: 0, frozen: false };
    },
  }));

  ctx.tools.register(defineTool({
    name: "list_threads",
    description: "列出当前根线程及其直属执行/审查代理。",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          threads: { type: "array", required: true, items: { type: "json" } },
        },
      },
      render(_args, value) {
        const count = Array.isArray(value.threads) ? value.threads.length : 0;
        return [{ type: "text", text: `当前组织树 ${count} 个节点` }];
      },
    },
    async execute(_args, exec) {
      const agent = requireAgent(exec);
      return { threads: await api.tree(agent.id) };
    },
  }));
}
