import test from "node:test";
import assert from "node:assert/strict";
import { createOpenThreadAction, defaultExpanded, organizationTree, primaryNodes } from "./logic.js";

test("header open action posts then switches session", async () => {
  const calls = [];
  const openThread = createOpenThreadAction({
    postOpen: async (id) => { calls.push(`post:${id}`); },
    openSession: (id) => { calls.push(`open:${id}`); },
  });
  await openThread("leaf");
  assert.deepEqual(calls, ["post:leaf", "open:leaf"]);
});

test("flat worker is the primary node under its root", () => {
  const tree = organizationTree([
    { id: "root", parentId: null, depth: 0, createdAt: 1 },
    { id: "worker", parentId: "root", depth: 1, role: "work", createdAt: 2 },
  ], "worker");
  const primaries = primaryNodes(tree);
  assert.deepEqual(primaries.map((node) => node.id), ["worker"]);
  assert.deepEqual(defaultExpanded(tree, "worker"), { root: true });
});
