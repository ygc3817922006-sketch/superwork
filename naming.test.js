import test from "node:test";
import assert from "node:assert/strict";
import { threadTitle, isThreadTitle, placementUnderParent } from "./naming.js";

test("titles: every flat worker gets a direct-child mark and supports self-renamed labels", () => {
  assert.equal(threadTitle({ label: "修复登录流程", depth: 1, role: "work" }), "◆ 修复登录流程");
  assert.equal(threadTitle({ label: "安全复审", depth: 1, role: "review" }), "◆ 安全复审");
  assert.equal(threadTitle({ label: "小K", depth: 0, role: "root" }), "◈ 小K");
  assert.equal(threadTitle({ label: "  ", id: "abc", depth: 1 }), "◆ abc");
  assert.ok(isThreadTitle("◆ x")); assert.ok(isThreadTitle("　╰ 执行 · y")); assert.ok(!isThreadTitle("普通会话"));
});

test("legacy placement helper remains deterministic for existing archived v2 sessions", () => {
  // 侧栏自上而下：新建的 c2 被官方前置到最上面；p 在中间，c1 已在 p 下面
  const order = ["c2", "x", "p", "c1", "y"];
  const r = placementUnderParent(order, "p", "c2", ["c1", "c2"]);
  assert.deepEqual(r, { move: true, before: "y" });
});

test("placement: already in block → no move; parent missing → no move; parent last → append", () => {
  assert.deepEqual(placementUnderParent(["p", "c1", "y"], "p", "c1", ["c1"]), { move: false });
  assert.deepEqual(placementUnderParent(["c1", "y"], "p", "c1", ["c1"]), { move: false });
  assert.deepEqual(placementUnderParent(["c1", "x", "p"], "p", "c1", ["c1"]), { move: true, before: undefined });
});
