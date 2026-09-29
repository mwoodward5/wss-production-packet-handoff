"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

test("resolveSiteEditTarget", async (t) => {
  t.after(() => {
    global.fetch = originalFetch;
    restoreEnv();
  });

  await t.test("empty/blank slug is rejected without a lookup", async () => {
    delete require.cache[require.resolve("../lib/site-edit-targets")];
    const { resolveSiteEditTarget } = require("../lib/site-edit-targets");
    let called = false;
    global.fetch = async () => { called = true; return jsonResponse(200, []); };
    assert.equal(await resolveSiteEditTarget(""), null);
    assert.equal(await resolveSiteEditTarget("   "), null);
    assert.equal(called, false);
  });

  await t.test("the AB Detailing fallback resolves without any DB dependency", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete require.cache[require.resolve("../lib/site-edit-targets")];
    const { resolveSiteEditTarget } = require("../lib/site-edit-targets");
    let called = false;
    global.fetch = async () => { called = true; return jsonResponse(200, []); };
    const target = await resolveSiteEditTarget("ab-professional-detailing");
    assert.deepEqual(target, {
      projectName: "ab-professional-detailing",
      aliasHost: "ab-professional-detailing.wss-ai.com",
    });
    assert.equal(called, false, "fallback entry must not require a DB round trip");
  });

  await t.test("an unknown slug with Supabase unconfigured is rejected (fail closed)", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete require.cache[require.resolve("../lib/site-edit-targets")];
    const { resolveSiteEditTarget } = require("../lib/site-edit-targets");
    assert.equal(await resolveSiteEditTarget("some-random-prospect"), null);
  });

  await t.test("a prospect with a completed donor-forge deploy resolves its real Vercel target", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    delete require.cache[require.resolve("../lib/site-edit-targets")];
    const { resolveSiteEditTarget } = require("../lib/site-edit-targets");
    global.fetch = async (url) => {
      assert.match(String(url), /ghost_agency_prospects/);
      assert.match(String(url), /prospect_id=eq\.acme-plumbing/);
      return jsonResponse(200, [{
        prospect_id: "acme-plumbing",
        record: {
          forge_job: {
            input: { project_name: "acme-plumbing", preview_host: "acme-plumbing.wss-ai.com" },
            deploy: { url: "https://acme-plumbing.vercel.app", alias: "https://acme-plumbing.wss-ai.com" },
          },
        },
      }]);
    };
    const target = await resolveSiteEditTarget("acme-plumbing");
    assert.deepEqual(target, { projectName: "acme-plumbing", aliasHost: "acme-plumbing.wss-ai.com" });
  });

  await t.test("a prospect with no forge_job (e.g. the default SiteForge-only pipeline) is rejected", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    delete require.cache[require.resolve("../lib/site-edit-targets")];
    const { resolveSiteEditTarget } = require("../lib/site-edit-targets");
    global.fetch = async () => jsonResponse(200, [{
      prospect_id: "some-siteforge-prospect",
      record: {
        build_dispatch: { urls: { preview_url: "https://siteforge-app-seven.vercel.app/try/some-siteforge-prospect/" } },
        siteforge_callback: { ready: true },
      },
    }]);
    assert.equal(await resolveSiteEditTarget("some-siteforge-prospect"), null);
  });

  await t.test("no matching prospect row is rejected", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    delete require.cache[require.resolve("../lib/site-edit-targets")];
    const { resolveSiteEditTarget } = require("../lib/site-edit-targets");
    global.fetch = async () => jsonResponse(200, []);
    assert.equal(await resolveSiteEditTarget("nonexistent-prospect"), null);
  });

  await t.test("a failed/erroring lookup is rejected rather than partially trusted", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    delete require.cache[require.resolve("../lib/site-edit-targets")];
    const { resolveSiteEditTarget } = require("../lib/site-edit-targets");
    global.fetch = async () => { throw new Error("network down"); };
    assert.equal(await resolveSiteEditTarget("acme-plumbing"), null);
  });
});

function fakeReq({ method = "POST", headers = {}, body = {} } = {}) {
  return { method, headers, body };
}

function fakeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) { res.headers[name] = value; },
    end(payload) { if (payload !== undefined) res.body = payload; },
  };
  return res;
}

test("api/vapi-tools/site-edit enqueue endpoint", async (t) => {
  t.after(() => {
    global.fetch = originalFetch;
    restoreEnv();
  });

  await t.test("rejects an unregistered siteSlug before enqueuing anything", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.VAPI_WEBHOOK_SECRET = "test-secret";
    let fetchCalled = false;
    global.fetch = async () => { fetchCalled = true; return jsonResponse(200, {}); };
    delete require.cache[require.resolve("../lib/site-edit-targets")];
    delete require.cache[require.resolve("../api/vapi-tools/site-edit")];
    delete require.cache[require.resolve("../lib/site-edit-core")];
    const handler = require("../api/vapi-tools/site-edit");
    const req = fakeReq({ headers: { "x-vapi-secret": "test-secret" }, body: { siteSlug: "totally-unregistered-business", instruction: "change the phone number" } });
    const res = fakeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.ok, false);
    assert.equal(fetchCalled, false, "must reject before ever contacting the worker or persisting a job");
  });

  // POLICY CHANGE (confirm-before-apply): a single call can no longer enqueue.
  // The first call reads the business name and domain back to the caller and
  // returns a signed token; only the second call, carrying that token, writes
  // a job. See test/riley-site-edit-confirm.test.js for the full gate. This
  // test keeps its original job: proving the known-good AB Detailing fallback
  // slug reaches enqueue at all.
  await t.test("enqueues against the known-good AB Detailing fallback slug, after confirmation", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    process.env.VAPI_WEBHOOK_SECRET = "test-secret";
    // The read-back needs to name the business: no CRM row for this pilot, so
    // describeSiteEditTarget() falls through to the archived index.html.
    const archivedHtml = "<html><head><title>AB Professional Detailing | Auto Detailing</title></head><body></body></html>";
    global.fetch = async (url) => {
      const href = String(url);
      if (href.includes("/storage/v1/object/") && !href.includes("/list/")) {
        return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(archivedHtml, "utf8") };
      }
      return jsonResponse(200, []);
    };
    delete require.cache[require.resolve("../lib/site-edit-targets")];
    delete require.cache[require.resolve("../api/vapi-tools/site-edit")];
    delete require.cache[require.resolve("../lib/site-edit-core")];
    const handler = require("../api/vapi-tools/site-edit");
    const body = { siteSlug: "ab-professional-detailing", instruction: "change the phone number" };

    const firstRes = fakeRes();
    await handler(fakeReq({ headers: { "x-vapi-secret": "test-secret" }, body }), firstRes);
    assert.equal(firstRes.statusCode, 200);
    const first = JSON.parse(firstRes.body);
    assert.equal(first.status, "confirm_required");
    assert.equal(first.confirm.business_name, "AB Professional Detailing");
    assert.equal(first.confirm.domain, "ab-professional-detailing.wss-ai.com");
    assert.equal(first.jobId, undefined, "nothing may be enqueued before the caller confirms");

    const secondRes = fakeRes();
    // CONTRACT 2026-09-02 (stateful confirm): the confirming call carries the
    // six-character code; the instruction lives server-side, so nothing else
    // is echoed.
    await handler(fakeReq({ headers: { "x-vapi-secret": "test-secret" }, body: { ...body, confirm_code: first.confirm_code } }), secondRes);
    assert.equal(secondRes.statusCode, 200);
    const parsed = JSON.parse(secondRes.body);
    assert.equal(parsed.ok, true);
    assert.ok(parsed.jobId);
  });

  await t.test("rejects unauthorized requests before evaluating the siteSlug at all", async () => {
    process.env.VAPI_WEBHOOK_SECRET = "test-secret";
    delete require.cache[require.resolve("../api/vapi-tools/site-edit")];
    delete require.cache[require.resolve("../lib/site-edit-core")];
    const handler = require("../api/vapi-tools/site-edit");
    const req = fakeReq({ headers: {}, body: { siteSlug: "ab-professional-detailing", instruction: "x" } });
    const res = fakeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 401);
  });
});
