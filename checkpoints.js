import { randomUUID } from "node:crypto";
import { CompanyThreadError, relaySource } from "./logic.js";

export const CHECKPOINT_EVENT = "company-thread/checkpoint";
export const CHECKPOINT_VERSION = 1;

function text(value, name) {
  const result = String(value ?? "").trim();
  if (!result) throw new CompanyThreadError(`${name}不能为空`, "INVALID_CHECKPOINT");
  return result;
}

function textList(value, name, max = 32) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) {
    throw new CompanyThreadError(`${name}必须是最多 ${max} 条的数组`, "INVALID_CHECKPOINT");
  }
  return value.map((item) => text(item, name));
}

export function normalizeCheckpoint(input, now = Date.now()) {
  const progress = input.progress === undefined ? undefined : Number(input.progress);
  if (progress !== undefined && (!Number.isInteger(progress) || progress < 0 || progress > 100)) {
    throw new CompanyThreadError("检查点进度必须是 0 到 100 的整数", "INVALID_CHECKPOINT");
  }
  return {
    version: CHECKPOINT_VERSION,
    id: input.id || randomUUID(),
    threadId: text(input.threadId, "线程 id"),
    summary: text(input.summary, "已完成摘要"),
    nextSteps: textList(input.nextSteps, "下一步"),
    evidence: textList(input.evidence, "证据"),
    ...(progress === undefined ? {} : { progress }),
    createdAt: input.createdAt ?? now,
  };
}

export function foldCheckpoint(events) {
  let latest;
  const restored = new Set();
  for (const event of events ?? []) {
    if (event.type !== CHECKPOINT_EVENT) continue;
    const data = event.data ?? {};
    if (data.op === "save" && data.checkpoint?.id) latest = { ...data.checkpoint };
    if (data.op === "restore" && data.checkpointId) restored.add(data.checkpointId);
  }
  return latest ? { ...latest, restored: restored.has(latest.id) } : undefined;
}

export function renderCheckpointResume(checkpoint) {
  const lines = [
    "检测到线程在中断后恢复。请从最近检查点继续，不要从头重做。",
    `检查点时间：${new Date(checkpoint.createdAt).toISOString()}`,
    `已完成：${checkpoint.summary}`,
  ];
  if (checkpoint.progress !== undefined) lines.push(`进度：${checkpoint.progress}%`);
  if (checkpoint.nextSteps.length) lines.push("下一步：\n- " + checkpoint.nextSteps.join("\n- "));
  if (checkpoint.evidence.length) lines.push("已有证据：\n- " + checkpoint.evidence.join("\n- "));
  return lines.join("\n");
}

export function createCheckpointService(deps) {
  const restoring = new Set();

  async function saveCheckpoint(input) {
    await deps.requireDescriptor(input.threadId);
    const session = await deps.sessionFor(input.threadId);
    const checkpoint = normalizeCheckpoint(input);
    deps.appendEvent(session, CHECKPOINT_EVENT, { op: "save", checkpoint });
    return checkpoint;
  }

  async function latestCheckpoint(threadId) {
    await deps.requireDescriptor(threadId);
    const session = await deps.sessionFor(threadId);
    return foldCheckpoint(session.events);
  }

  async function restoreCheckpoint(threadId) {
    if (deps.canRestore && !deps.canRestore(threadId)) return { restored: false, reason: "blocked" };
    if (restoring.has(threadId)) return { restored: false, reason: "in-flight" };
    restoring.add(threadId);
    try {
      const descriptor = await deps.requireDescriptor(threadId);
      if (descriptor.status === "complete" || descriptor.status === "paused") {
        return { restored: false, reason: "inactive" };
      }
      const session = await deps.sessionFor(threadId);
      const checkpoint = foldCheckpoint(session.events);
      if (!checkpoint || checkpoint.restored) return { restored: false, reason: checkpoint ? "already-restored" : "missing" };
      if (deps.canRestore && !deps.canRestore(threadId)) return { restored: false, reason: "blocked" };
      const result = await deps.deliverTo(
        threadId,
        renderCheckpointResume(checkpoint),
        relaySource("checkpoint", threadId),
      );
      deps.appendEvent(session, CHECKPOINT_EVENT, {
        op: "restore",
        checkpointId: checkpoint.id,
        deliveredMessageId: result.messageId,
        restoredAt: Date.now(),
      });
      return { restored: true, checkpoint, deliveredMessageId: result.messageId };
    } finally {
      restoring.delete(threadId);
    }
  }

  return { saveCheckpoint, latestCheckpoint, restoreCheckpoint };
}
