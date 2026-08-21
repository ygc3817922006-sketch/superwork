import { defineTool } from "@deepseek-ai/dsh-tools";

function requireAgent(exec) {
  if (!exec.agent) throw new Error("检查点工具需要调用方智能体");
  return exec.agent;
}

export const CHECKPOINT_PROMPT = "长任务在阶段边界用 save_checkpoint 把已完成、下一步和证据写进自己的会话事件；重启或崩溃后系统会自动投递最近一份未恢复检查点，继续做而不是从头重来。";

export function registerCheckpointTools(ctx, api) {
  ctx.tools.register(defineTool({
    name: "save_checkpoint",
    description: "把当前线程的长任务检查点写入自己的持久会话事件。应在阶段边界记录已完成内容、下一步和关键证据。",
    parameters: {
      summary: { type: "string", required: true, description: "截至当前已经完成的内容，必须能直接用于恢复。" },
      next_steps: { type: "array", required: true, items: { type: "string" }, description: "恢复后按顺序继续的步骤。" },
      evidence: { type: "array", items: { type: "string" }, description: "已生成的关键文件、命令、日志或结论。" },
      progress: { type: "number", description: "0 到 100 的整数进度。" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          checkpointId: { type: "string", required: true },
          createdAt: { type: "number", required: true },
          progress: { type: "number" },
        },
      },
      render(_args, value) {
        return [{ type: "text", text: `检查点 ${value.checkpointId} 已写入当前会话事件` }];
      },
    },
    async execute(args, exec) {
      const agent = requireAgent(exec);
      const checkpoint = await api.saveCheckpoint({
        threadId: agent.id,
        summary: args.summary,
        nextSteps: args.next_steps,
        evidence: args.evidence,
        progress: args.progress,
      });
      return {
        checkpointId: checkpoint.id,
        createdAt: checkpoint.createdAt,
        ...(checkpoint.progress === undefined ? {} : { progress: checkpoint.progress }),
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: "get_checkpoint",
    description: "读取当前线程最近一份检查点及其是否已经被恢复投递。",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          found: { type: "boolean", required: true },
          checkpoint: { type: "json" },
        },
      },
      render(_args, value) {
        return [{ type: "text", text: value.found ? "已读取最近检查点" : "当前线程还没有检查点" }];
      },
    },
    async execute(_args, exec) {
      const agent = requireAgent(exec);
      const checkpoint = await api.latestCheckpoint(agent.id);
      return checkpoint ? { found: true, checkpoint } : { found: false };
    },
  }));
}
