import test from "node:test";
import assert from "node:assert/strict";
import { registerCompanyThreadHttp } from "./web.js";

function harness(api = {}) {
  let handler;
  const webServer = { register(definition) { handler = definition.handler; return () => {}; } };
  const ctx = {
    get(name) { return name === "webServer" ? webServer : undefined; },
    effect(setup) { return setup(); },
  };
  registerCompanyThreadHttp(ctx, api);
  async function request(method, url, body = {}) {
    const req = {
      method,
      url,
      headers: { host: "127.0.0.1:1234" },
      async *[Symbol.asyncIterator]() {
        if (method === "POST") yield Buffer.from(JSON.stringify(body));
      },
    };
    const response = { status: 0, body: "", writeHead(status) { this.status = status; }, end(value) { this.body = value; } };
    await handler(req, response);
    return { status: response.status, body: JSON.parse(response.body) };
  }
  return { request };
}

test("identity-sensitive agent actions are not exposed over HTTP", async () => {
  let called = false;
  const api = new Proxy({}, { get() { return async () => { called = true; }; } });
  const { request } = harness(api);
  for (const path of ["/superwork/create", "/superwork/assign", "/superwork/report", "/superwork/review/start", "/superwork/review/submit"]) {
    const result = await request("POST", path, { ownerId: "forged", reviewerId: "forged" });
    assert.equal(result.status, 404, path);
  }
  assert.equal(called, false);
});

test("tree HTTP reads require an explicit current-session scope", async () => {
  const { request } = harness({ tree: async () => [] });
  const result = await request("GET", "/superwork/tree");
  assert.equal(result.status, 400);
  assert.equal(result.body.code, "ROOT_ID_REQUIRED");
});

test("UI mutations require a browser same-origin request", async () => {
  const { request } = harness({ open: async () => ({ id: "x" }) });
  const result = await request("POST", "/superwork/open", { id: "x" });
  assert.equal(result.status, 403);
});
