import { PERMISSION_TEMPLATES } from "./logic.js";
import { SUPERWORK_AGENT_PRESETS } from "./config.js";

function asText(value) {
  return typeof value === "string" ? value : "";
}

function fail(error) {
  return {
    ok: false,
    error: error && error.message ? error.message : String(error),
    code: error && error.code ? error.code : "ERROR",
  };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

function headerValue(headers, name) {
  if (!headers) return undefined;
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return typeof value === "string" ? value : undefined;
}

export function isTrustedWriteRequest(request) {
  const remoteAddress = request.socket?.remoteAddress;
  if (remoteAddress && remoteAddress !== "127.0.0.1" && remoteAddress !== "::1" && remoteAddress !== "::ffff:127.0.0.1") return false;
  const host = headerValue(request.headers, "host");
  if (!host) return false;
  let authority;
  try {
    authority = new URL(`http://${host}`);
  } catch {
    return false;
  }
  const hostname = authority.hostname.toLowerCase();
  if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "[::1]") return false;
  if (headerValue(request.headers, "sec-fetch-site") === "cross-site") return false;
  const origin = headerValue(request.headers, "origin");
  if (origin === undefined) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:" && parsed.host === authority.host && parsed.pathname === "/";
  } catch {
    return false;
  }
}

export async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export function registerCompanyThreadHttp(ctx, api) {
  const webServer = ctx.get("webServer");
  if (!webServer || typeof webServer.register !== "function") return;
  const handle = async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const path = url.pathname;
      if (req.method === "GET" && path === "/superwork/tree") {
        const rootId = url.searchParams.get("rootId") || "";
        if (!rootId) {
          sendJson(res, 400, fail(Object.assign(new Error("rootId required"), { code: "ROOT_ID_REQUIRED" })));
          return;
        }
        sendJson(res, 200, { ok: true, tree: await api.tree(rootId), templates: PERMISSION_TEMPLATES });
        return;
      }
      if (req.method === "GET" && path === "/superwork/thread") {
        const id = url.searchParams.get("id") || "";
        sendJson(res, 200, { ok: true, thread: await api.getDescriptor(id) });
        return;
      }
      if (req.method === "GET" && path === "/superwork/settings") {
        const agentPresets = ctx.get("agentPresets");
        const listed = agentPresets && typeof agentPresets.list === "function" ? await agentPresets.list() : [];
        sendJson(res, 200, {
          ok: true,
          settings: await api.settingsStore.read(),
          presets: listed.filter((item) => SUPERWORK_AGENT_PRESETS.includes(item.id)).map((item) => ({ id: item.id, name: item.name, trust: item.trust, broken: item.broken })),
          templates: PERMISSION_TEMPLATES,
        });
        return;
      }
      if (req.method === "GET" && path === "/superwork/models") {
        const llm = ctx.get("llm");
        const providers = [];
        const failures = [];
        if (llm && typeof llm.listProviders === "function") {
          for (const provider of llm.listProviders()) {
            try {
              const models = await llm.listModels(provider.id);
              const entries = [];
              for (const model of models) {
                let reasoning;
                try {
                  const resolved = await llm.resolveModelInfo(provider.id, model.id);
                  if (resolved?.reasoning) reasoning = { efforts: resolved.reasoning.efforts ?? [], defaultEffort: resolved.reasoning.defaultEffort };
                } catch { /* advisory */ }
                entries.push({ id: model.id, name: model.name, reasoning });
              }
              if (entries.length > 0) providers.push({ id: provider.id, name: provider.name, models: entries });
            } catch (error) {
              failures.push({ id: provider.id, name: provider.name, message: error instanceof Error ? error.message : String(error) });
            }
          }
        }
        sendJson(res, 200, { ok: true, providers, failures });
        return;
      }
      // HTTP 只服务本地 UI。身份敏感的创建、派工、汇报和审查动作只能走
      // 绑定 exec.agent.id 的模型工具，绝不接受正文自报 owner/reviewer 身份。
      if (req.method === "POST" && ["/superwork/open", "/superwork/release", "/superwork/archive", "/superwork/settings"].includes(path)) {
        if (!isTrustedWriteRequest(req)) {
          sendJson(res, 403, fail(new Error("forbidden")));
          return;
        }
        const args = await readBody(req);
        if (path === "/superwork/settings") {
          sendJson(res, 200, { ok: true, settings: await api.settingsStore.write(args.settings ?? args) });
          return;
        }
        if (path === "/superwork/release") {
          sendJson(res, 200, { ok: true, ...(await api.release(asText(args.id))) });
          return;
        }
        if (path === "/superwork/archive") {
          sendJson(res, 200, { ok: true, ...(await api.archiveThread(asText(args.id))) });
          return;
        }
        sendJson(res, 200, { ok: true, thread: await api.open(asText(args.id)) });
        return;
      }
      sendJson(res, 404, fail(new Error("not found")));
    } catch (error) {
      sendJson(res, 500, fail(error));
    }
  };
  ctx.effect(() => webServer.register({
    kind: "prefix",
    path: "/superwork",
    handler: handle,
  }), "superwork: http api");
}
