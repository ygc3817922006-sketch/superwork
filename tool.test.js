import test from "node:test";
import assert from "node:assert/strict";
import * as tool from "./tool.js";

// 机器门：工具插件必须能完整装载。任何 defineTool 定义期异常（比如 schema 少写 additionalProperties）都会在这里现形。
function fakeCtx() {
  const names = [];
  const sections = [];
  return {
    names, sections,
    superwork: {},
    tools: { register(def) { names.push(def.name); return () => {}; } },
    systemPrompt: { section(s) { sections.push(s); return () => {}; } },
  };
}

test("tool plugin applies without throwing and registers the full tool set", () => {
  const ctx = fakeCtx();
  assert.doesNotThrow(() => tool.apply(ctx));
  const expected = [
    "create_thread", "assign_thread", "report_to_parent", "rename_self",
    "start_review", "submit_review", "cancel_review", "get_review_state", "list_threads",
    "issue_contract", "amend_contract", "close_contract", "get_contract",
    "submit_completion", "accept_completion", "reject_completion", "escalate", "resolve_escalation",
    "save_checkpoint", "get_checkpoint",
  ];
  for (const name of expected) assert.ok(ctx.names.includes(name), "缺工具 " + name);
  assert.equal(new Set(ctx.names).size, ctx.names.length, "工具名重复");
  assert.equal(ctx.sections.length, 1);
});

// 机器门：profile 里不许有核心 dsh 包的重复拷贝。
// 2026-08-18 事故：dsh-better-sidebar 的 peer 依赖让 pnpm 往 profile 装了一份 dsh-tools，
// 与 app 自带那份是两个模块实例，Symbol 对不上 → 所有工具调用报 "reading 'prepare'"。
test("profile node_modules must not shadow core dsh runtime packages", async () => {
  const { existsSync } = await import("node:fs");
  const banned = ["dsh-tools", "dsh-agent-loop", "dsh-session", "dsh-llm", "dsh-subagent", "dsh-agent", "cordis"];
  const offenders = banned.filter((name) => existsSync(new URL("../node_modules/@deepseek-ai/" + name, import.meta.url)));
  const knownLocalResidue = new Set(["dsh-session", "dsh-llm"]);
  const unexpected = offenders.filter((name) => !knownLocalResidue.has(name));
  assert.deepEqual(unexpected, [], "profile 里新增了会与 app 打架的 dsh 核心包拷贝：" + unexpected.join(", "));
});

// 机器门：插件事件类型必须登记进 DSH 会话词汇表，否则重启后所有线程会话历史拒载。
test("company-thread event types are registered in the session vocabulary", async () => {
  const { COMPANY_EVENT_TYPES } = await import("./index.js");
  const { KNOWN_SESSION_EVENT_TYPES } = await import("/Applications/DSH Desktop.app/Contents/Resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-session/lib/index.js");
  const missing = COMPANY_EVENT_TYPES.filter((t) => !KNOWN_SESSION_EVENT_TYPES.has(t));
  assert.deepEqual(missing, [], "未登记的事件类型：" + missing.join(", "));
  assert.ok(COMPANY_EVENT_TYPES.length >= 10);
});

test("installed root and worker presets disable off-ledger workflow and Ralph paths", async (t) => {
  const { existsSync } = await import("node:fs");
  const { readFile } = await import("node:fs/promises");
  let checked = 0;
  for (const preset of ["xiaok", "xiaok-creative"]) {
    const path = `/Users/yu/.dsh/.agent-presets/${preset}/agent.cordis.yml`;
    if (!existsSync(path)) continue;
    checked += 1;
    const yaml = await readFile(path, "utf8");
    for (const id of ["workflow-worker-thread", "tool-workflow", "tool-ralph"]) {
      assert.match(yaml, new RegExp(`- id: ${id}\\n(?:.*\\n){0,2}\\s+disabled: true`), `${preset} 未禁用 ${id}`);
    }
  }
  if (checked === 0) t.skip("personal DSH presets are not part of the public source checkout");
});
