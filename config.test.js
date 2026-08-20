import test from "node:test";
import assert from "node:assert/strict";
import { applyRoleDefaults, canonicalRole, cloneDefaultSettings, pickProfile, sanitizeSettings } from "./config.js";

test("defaults expose only flat execution and review templates", () => {
  const settings = cloneDefaultSettings();
  assert.equal(settings.version, 3);
  assert.deepEqual(settings.profiles.map((profile) => profile.kind), ["work", "review"]);
  assert.equal(settings.profiles.find((profile) => profile.kind === "review").permission, "read-only");
  assert.equal(canonicalRole(0), "root");
  assert.equal(canonicalRole(1, "review"), "review");
});

test("profile selection is role-safe and disabled templates are rejected", () => {
  const settings = cloneDefaultSettings();
  assert.equal(pickProfile(settings, { role: "work" }).kind, "work");
  assert.equal(pickProfile(settings, { role: "review" }).kind, "review");
  assert.throws(() => pickProfile(settings, { role: "review", profile: "执行代理" }), (error) => error.code === "PROFILE_KIND_MISMATCH");
  settings.profiles[1].enabled = false;
  assert.throws(() => pickProfile(settings, { role: "review" }), (error) => error.code === "NO_ENABLED_PROFILE");
});

test("role defaults create only root-direct workers and force review read-only", () => {
  const settings = cloneDefaultSettings();
  const work = applyRoleDefaults({ label: "实现", cwd: "/Users/yu/a", role: "work" }, 1, settings, { provider: "p", model: "m" });
  assert.equal(work.role, "work");
  assert.equal(work.provider, "p");
  assert.equal(work.maxChildren, 0);
  const review = applyRoleDefaults({ label: "复审", cwd: "/Users/yu/a", role: "review", permission: "full-controlled" }, 1, settings);
  assert.equal(review.role, "review");
  assert.equal(review.permission, "read-only");
  assert.throws(() => applyRoleDefaults({ role: "work" }, 2, settings), (error) => error.code === "INVALID_WORKER_DEPTH");
});

test("v2 three-column settings migrate only old execution/review cards", () => {
  const migrated = sanitizeSettings({ version: 2, columns: {
    main: [{ id: "main", name: "小K", kind: "main" }],
    level1: [{ id: "pm", name: "项目经理", kind: "project" }],
    level2: [
      { id: "old-work", name: "旧执行", kind: "work", permission: "auto" },
      { id: "old-review", name: "旧审查", kind: "review", permission: "full-controlled" },
    ],
  } });
  assert.equal(migrated.version, 3);
  assert.deepEqual(migrated.profiles.map((profile) => profile.name), ["旧执行", "旧审查"]);
  assert.equal(migrated.profiles[1].permission, "read-only");
  assert.equal(migrated.profiles.every((profile) => profile.maxChildren === 0), true);
});

test("sanitize dedupes names, clamps budgets, and accepts an intentionally empty template list", () => {
  const settings = sanitizeSettings({ version: 3, profiles: [
    { id: "a", name: "代理", kind: "work", maxGoalRounds: 9999 },
    { id: "b", name: "代理", kind: "review", maxGoalRounds: 0 },
  ] });
  assert.deepEqual(settings.profiles.map((profile) => profile.name), ["代理", "代理 2"]);
  assert.equal(settings.profiles[0].maxGoalRounds, 256);
  assert.equal(settings.profiles[1].maxGoalRounds, 1);
  assert.equal(sanitizeSettings({ version: 3, profiles: [{ id: "x", name: "x", kind: "work", agentPreset: "minimal" }] }).profiles[0].agentPreset, "xiaok-creative");
  assert.deepEqual(sanitizeSettings({ version: 3, profiles: [] }).profiles, []);
});
