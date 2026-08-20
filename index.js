import { foldDescriptor } from "./logic.js";
import { FS_IO, createCompanyThreads } from "./service.js";
import { registerCompanyThreadHttp } from "./web.js";
import { createSettingsStore } from "./settings.js";

export const name = "superwork";

// —— 会话事件词汇登记 ——
// DSH 冷读历史时拒绝不认识的事件类型（SessionFormatUnsupportedError）。官方词汇表是可变集合，
// 这里把本插件的全部事件类型登记进去，重启后旧会话历史即可正常加载，事件一个不丢。
export const COMPANY_EVENT_TYPES = [
  "company-thread/descriptor", "company-thread/mailbox", "company-thread/status",
  "company-thread/workflow", "company-thread/review-report", "company-thread/review-mirror",
    "company-thread/contract", "company-thread/completion", "company-thread/escalation",
    "company-thread/checkpoint", "company-thread/label",
];
try {
  const { KNOWN_SESSION_EVENT_TYPES } = await import("/Applications/DSH Desktop.app/Contents/Resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-session/lib/index.js");
  for (const type of COMPANY_EVENT_TYPES) KNOWN_SESSION_EVENT_TYPES.add(type);
} catch {
  // app 路径不存在（如他人部署）时跳过；届时需在部署侧登记这些事件类型，否则冷读会拒载。
}

export const inject = ["agents", "sessions", "permissionPresets", "sessionQuery", "webServer", "agentPresets", "llm"];
export { FS_IO, createCompanyThreads };

export async function recoverCreatedThread(api, agent) {
  await api.drainMailbox(agent.id);
  return api.restoreCheckpoint(agent.id);
}

export function apply(ctx) {
  const settingsStore = createSettingsStore();
  const api = createCompanyThreads(ctx, { fs: FS_IO, settingsStore });
  ctx.provide("superwork", api);
  ctx.effect(() => () => {
    for (const id of [...ctx.sessions.list().map((session) => session.id)]) {
      api.forgetHandle(id);
    }
  }, "superwork: handles");
  registerCompanyThreadHttp(ctx, api);
  // 直属工作代理持续归档出左栏（幂等，每分钟扫一遍兜漏；从右侧 superwork 页进入）
  const sweepArchive = async () => {
    try {
      const registry = ctx.get("workspaceRegistry");
      if (!registry || typeof registry.archiveSession !== "function") return;
      const archived = new Set(registry.archivedSessionIds ?? []);
      for (const item of await api.listDescriptors()) {
        if ((item.depth ?? 0) < 1 || archived.has(item.id)) continue;
        if (api.keepVisible?.has(item.id)) continue; // 正被查看的不归档，否则会被踢回首页
        try { await registry.archiveSession(item.id); } catch (error) {
          ctx.logger?.warn?.(`superwork: 归档工作代理 ${item.id} 失败：${error?.message ?? error}`);
        }
      }
    } catch (error) {
      ctx.logger?.warn?.(`superwork: 归档扫描失败：${error?.message ?? error}`);
    }
  };
  void sweepArchive();
  ctx.effect(() => { const t = setInterval(sweepArchive, 60000); return () => clearInterval(t); }, "superwork: archive sweep");
  ctx.on("agent/created", ({ agent }) => {
    if (agent.session.header.origin === "subagent") return;
    const descriptor = foldDescriptor(agent.session.events);
    if (!descriptor) return;
    void api.decorateThread(agent);
    recoverCreatedThread(api, agent)
      .catch((error) => {
        ctx.logger?.warn?.(`superwork: recovery failed for ${agent.id}: ${error.message}`);
      });
  });
}
