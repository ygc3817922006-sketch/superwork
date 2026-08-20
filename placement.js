// 当前扁平工作流只使用分组、归档和解档；二级归位逻辑保留用于兼容 v2 历史会话。
import { threadTitle, placementUnderParent } from "./naming.js";
import { foldDescriptor } from "./logic.js";

export function createPlacement(ctx, { listDescriptors }) {
  // 「保持可见」名单：正被用户查看的线程。官方运行时会把"当前会话在归档名单里"直接清空选中（回首页），
  // 所以打开线程前必须先解档并登记在这里；清扫器和创建归位都不得归档名单内会话，用户切走后再归档回去。
  const keepVisible = new Set();

  async function unarchiveSession(id) {
    const registry = ctx.get("workspaceRegistry");
    if (!registry) return false;
    try {
      if (!(registry.archivedSessionIds ?? []).includes(id)) return true;
      if (typeof registry.unarchiveSession === "function") { await registry.unarchiveSession(id); return true; }
      // 当前 dsh-workspace 版本只有 archiveSession 没有官方解档接口：
      // 按 archiveSession 的同款事务写法反向过滤（版本耦合；宿主升级后自动优先走上面的官方分支）
      if (typeof registry.enqueueOperation === "function" && typeof registry.setState === "function" && typeof registry.requireState === "function") {
        await registry.enqueueOperation(async () => {
          const state = registry.requireState();
          if (!Array.isArray(state.archivedSessionIds) || !state.archivedSessionIds.includes(id)) return;
          await registry.setState({ ...state, archivedSessionIds: state.archivedSessionIds.filter((x) => x !== id) });
        });
        return true;
      }
      ctx.logger?.warn?.("superwork: 宿主 workspaceRegistry 无解档能力，打开归档线程会被踢回首页");
    } catch (error) {
      ctx.logger?.warn?.(`superwork: 解档失败：${error?.message ?? error}`);
    }
    return false;
  }

  // 线程会话按自己的 cwd 挂进（必要时新建）对应的工作区分组；不挂就会掉进"未分组"，那里的顺序没法控制。
  async function ensureGrouped(descriptor) {
    const registry = ctx.get("workspaceRegistry");
    if (!registry || !descriptor?.cwd) return undefined;
    try {
      let ws = typeof registry.resolveByPath === "function" ? await registry.resolveByPath(descriptor.cwd) : undefined;
      if (!ws && typeof registry.create === "function") ws = await registry.create(descriptor.cwd, descriptor.label);
      if (ws && typeof ws.attachSession === "function") { try { await ws.attachSession(descriptor.id); } catch {} }
      return ws;
    } catch (error) {
      ctx.logger?.warn?.(`superwork: 分组失败：${error?.message ?? error}`);
      return undefined;
    }
  }

  // 已存在/恢复的线程：套上层级标题并归位（幂等）
  async function decorateThread(agent) {
    try {
      const descriptor = foldDescriptorOf(agent);
      if (!descriptor) return;
      const titles = ctx.get("sessionTitles") ?? ctx.get("sessionTitle");
      if (titles && typeof titles.rename === "function") {
        let parentLabel;
        if (descriptor.depth >= 2 && descriptor.parentId) {
          try { parentLabel = (await listDescriptors()).find((item) => item.id === descriptor.parentId)?.label; } catch {}
        }
        try { titles.rename(agent.session, threadTitle(descriptor, parentLabel)); } catch {}
      }
      await ensureGrouped(descriptor);
      if (descriptor.depth >= 2 && descriptor.parentId) {
        const siblings = (await listDescriptors()).filter((item) => item.parentId === descriptor.parentId).map((item) => item.id);
        await placeUnderParent(descriptor, siblings);
      }
    } catch (error) {
      ctx.logger?.warn?.(`superwork: decorate failed: ${error?.message ?? error}`);
    }
  }
  function foldDescriptorOf(agent) {
    try { return foldDescriptor(agent.session.events); } catch { return undefined; }
  }

  async function placeUnderParent(descriptor, knownSiblingIds) {
    const registry = ctx.get("workspaceRegistry");
    if (!registry || typeof registry.list !== "function") return;
    const siblings = new Set([...(knownSiblingIds ?? []), descriptor.id]);
    // 二级线程不进左侧栏：创建/恢复即归档（会话与历史不受影响，从右侧「组织」页进入）。
    // 例外：正被查看（keepVisible）的不归档，否则官方运行时会当场清空选中踢回首页。
    const registry0 = ctx.get("workspaceRegistry");
    if (!keepVisible.has(descriptor.id) && registry0 && typeof registry0.archiveSession === "function") {
      try { await registry0.archiveSession(descriptor.id); return; } catch {}
    }
    if (keepVisible.has(descriptor.id)) return;
    await ensureGrouped(descriptor);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        for (const workspace of registry.list()) {
          const order = Array.isArray(workspace.sessionIds) ? workspace.sessionIds.slice() : [];
          if (!order.includes(descriptor.parentId) || !order.includes(descriptor.id)) continue;
          const plan = placementUnderParent(order, descriptor.parentId, descriptor.id, siblings);
          if (plan.move && typeof workspace.insertSessionBefore === "function") {
            await workspace.insertSessionBefore(descriptor.id, plan.before);
          }
          return;
        }
      } catch (error) {
        ctx.logger?.warn?.(`superwork: 排位失败（第 ${attempt + 1} 次）：${error?.message ?? error}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }

  return { placeUnderParent, decorateThread, ensureGrouped, unarchiveSession, keepVisible };
}
