"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ROUTER_PROJECT_ID,
  createVercelSharedSiteHostProvisioner,
  exactSharedHost,
} = require("../lib/shared-site-host-provisioner");
const { RESERVED_SLUGS: ROUTER_RESERVED_SLUGS } = require("../../site-router/lib/constants");

const HOST = "acme-plumbing.wss-ai.com";
const TOKEN = "vercel-test-token-never-send-to-site";
const TEAM_ID = "team_wsstest";
const ENV = Object.freeze({ VERCEL_TOKEN: TOKEN, VERCEL_TEAM_ID: TEAM_ID });
const READY_BODY = Object.freeze({
  ok: true,
  service: "wss-shared-site-router",
  status: "ready",
});

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) || "");
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key] || "") : "";
}

function response(status, body, url, headers = {}) {
  const raw = Buffer.isBuffer(body)
    ? body
    : Buffer.from(typeof body === "string" ? body : JSON.stringify(body === undefined ? {} : body), "utf8");
  const values = {
    "Content-Length": String(raw.length),
    ...headers,
  };
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: {
      get(name) {
        const key = Object.keys(values).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
        return key ? values[key] : null;
      },
    },
    async arrayBuffer() { return raw; },
  };
}

function successfulFetch({ attachStatus = 200, calls = [] } = {}) {
  return async (value, options = {}) => {
    const url = String(value);
    const method = String(options.method || "GET").toUpperCase();
    calls.push({ url, method, options });
    if (url.startsWith("https://api.vercel.com/v10/projects/") && method === "POST") {
      return response(attachStatus, attachStatus === 400
        ? { error: { code: "not_modified", name: HOST } }
        : attachStatus === 409
          ? { error: { code: "domain_already_exists" } }
        : { name: HOST }, url, { "Content-Type": "application/json" });
    }
    if (url.startsWith("https://api.vercel.com/v9/projects/") && method === "GET") {
      return response(200, {
        name: HOST,
        projectId: ROUTER_PROJECT_ID,
        verified: true,
      }, url, { "Content-Type": "application/json" });
    }
    if (url === `https://${HOST}/_wss/health` && method === "GET") {
      return response(200, READY_BODY, url, { "Content-Type": "application/json; charset=utf-8" });
    }
    if (url === `https://${HOST}/api/preview-session` && method === "GET") {
      return response(405, "Method Not Allowed", url, {
        Allow: "POST",
        "Content-Type": "text/plain; charset=utf-8",
      });
    }
    throw new Error(`unexpected_fetch:${method}:${url}`);
  };
}

test("2xx attach proves exact same-project ownership and exact router bytes", async () => {
  const calls = [];
  const ensure = createVercelSharedSiteHostProvisioner({
    env: ENV,
    fetchImpl: successfulFetch({ calls }),
    wait: async () => {},
    pollMs: 1,
    maxWaitMs: 20,
  });

  const result = await ensure({ host: HOST });
  assert.deepEqual(result, { ok: true, host: HOST, projectId: ROUTER_PROJECT_ID });
  assert.equal(Object.isFrozen(result), true);

  const attach = calls.find((call) => call.method === "POST");
  assert.ok(attach);
  const attachUrl = new URL(attach.url);
  assert.equal(attachUrl.pathname, `/v10/projects/${ROUTER_PROJECT_ID}/domains`);
  assert.equal(attachUrl.searchParams.get("teamId"), TEAM_ID);
  assert.deepEqual(JSON.parse(attach.options.body), { name: HOST });
  assert.equal(headerValue(attach.options.headers, "authorization"), `Bearer ${TOKEN}`);

  const ownership = calls.find((call) => call.url.includes("/v9/projects/"));
  assert.ok(ownership);
  assert.match(ownership.url, new RegExp(`/v9/projects/${ROUTER_PROJECT_ID}/domains/${HOST.replaceAll(".", "\\.")}`));
  for (const call of calls.filter((entry) => entry.url.startsWith(`https://${HOST}/`))) {
    assert.equal(headerValue(call.options.headers, "authorization"), "");
    assert.equal(JSON.stringify(call.options).includes(TOKEN), false);
  }
  assert.equal(calls.some((call) => /registrar|deployments|aliases/.test(call.url)), false);
});

test("official 400 not_modified duplicate is idempotent only after exact project proof", async () => {
  const calls = [];
  const ensure = createVercelSharedSiteHostProvisioner({
    env: ENV,
    fetchImpl: successfulFetch({ attachStatus: 400, calls }),
    wait: async () => {},
    pollMs: 1,
    maxWaitMs: 20,
  });

  assert.equal((await ensure({ host: HOST })).ok, true);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(calls.filter((call) => call.url.includes("/v9/projects/")).length, 1);
});

test("400 not_modified plus target-project 404 is a cross-project conflict", async () => {
  const calls = [];
  const fetchImpl = async (value, options = {}) => {
    const url = String(value);
    const method = String(options.method || "GET").toUpperCase();
    calls.push({ url, method, options });
    if (method === "POST") {
      return response(400, { error: { code: "not_modified", name: HOST } }, url);
    }
    return response(404, { error: { code: "not_found" } }, url);
  };
  const ensure = createVercelSharedSiteHostProvisioner({
    env: ENV,
    fetchImpl,
    wait: async () => {},
    pollMs: 1,
    maxWaitMs: 20,
  });

  await assert.rejects(() => ensure({ host: HOST }), /shared_site_host_project_mismatch/);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(calls.filter((call) => call.method === "GET").length, 1);
});

test("other 400 attach errors are terminal and never reclassified as duplicates", async () => {
  let calls = 0;
  const ensure = createVercelSharedSiteHostProvisioner({
    env: ENV,
    fetchImpl: async (url) => {
      calls += 1;
      return response(400, { error: { code: "forbidden" } }, String(url));
    },
    wait: async () => {},
  });
  await assert.rejects(() => ensure({ host: HOST }), /shared_site_host_attach_failed/);
  assert.equal(calls, 1);
});

test("cross-project conflict fails before any public host request", async () => {
  const calls = [];
  const fetchImpl = async (value, options = {}) => {
    const url = String(value);
    const method = String(options.method || "GET").toUpperCase();
    calls.push({ url, method, options });
    if (method === "POST") return response(409, { error: { code: "domain_conflict" } }, url);
    if (url.includes("/v9/projects/")) {
      return response(200, { name: HOST, projectId: "prj_other", verified: true }, url);
    }
    throw new Error("public_host_must_not_run");
  };
  const ensure = createVercelSharedSiteHostProvisioner({
    env: ENV,
    fetchImpl,
    wait: async () => {},
    pollMs: 1,
    maxWaitMs: 20,
  });

  await assert.rejects(() => ensure({ host: HOST }), /shared_site_host_project_mismatch/);
  assert.equal(calls.some((call) => call.url.startsWith(`https://${HOST}/`)), false);
});

test("accepted attachment polls ownership without repeating POST", async () => {
  const calls = [];
  let ownershipChecks = 0;
  let clock = 1_000;
  const base = successfulFetch({ calls });
  const fetchImpl = async (value, options = {}) => {
    const url = String(value);
    if (url.includes("/v9/projects/")) {
      ownershipChecks += 1;
      if (ownershipChecks < 3) {
        calls.push({ url, method: "GET", options });
        return response(404, { error: { code: "not_found" } }, url);
      }
    }
    return base(value, options);
  };
  const ensure = createVercelSharedSiteHostProvisioner({
    env: ENV,
    fetchImpl,
    now: () => clock,
    wait: async (ms) => { clock += ms; },
    pollMs: 2,
    maxWaitMs: 30,
  });

  assert.equal((await ensure({ host: HOST })).ok, true);
  assert.equal(ownershipChecks, 3);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
});

test("transient attach and TLS states retry within one bounded deadline", async () => {
  const calls = [];
  let clock = 2_000;
  let attachAttempts = 0;
  let healthAttempts = 0;
  const base = successfulFetch({ calls });
  const fetchImpl = async (value, options = {}) => {
    const url = String(value);
    const method = String(options.method || "GET").toUpperCase();
    if (url.includes("/v10/projects/") && method === "POST") {
      attachAttempts += 1;
      if (attachAttempts === 1) {
        calls.push({ url, method, options });
        return response(503, { error: { code: "unavailable" } }, url);
      }
    }
    if (url.includes("/v9/projects/") && attachAttempts === 1) {
      calls.push({ url, method, options });
      return response(404, { error: { code: "not_found" } }, url);
    }
    if (url === `https://${HOST}/_wss/health`) {
      healthAttempts += 1;
      if (healthAttempts === 1) {
        calls.push({ url, method, options });
        throw new TypeError("fetch failed");
      }
      if (healthAttempts === 2) {
        calls.push({ url, method, options });
        return response(404, "Not Found", url, { "Content-Type": "text/plain; charset=utf-8" });
      }
    }
    return base(value, options);
  };
  const ensure = createVercelSharedSiteHostProvisioner({
    env: ENV,
    fetchImpl,
    now: () => clock,
    wait: async (ms) => { clock += ms; },
    pollMs: 2,
    maxWaitMs: 40,
  });

  assert.equal((await ensure({ host: HOST })).ok, true);
  assert.equal(attachAttempts, 2);
  assert.equal(healthAttempts, 3);
});

test("wrong router URLs, headers, or bytes fail closed", async () => {
  for (const variant of ["health-body", "health-url", "preview-allow", "preview-body"]) {
    const base = successfulFetch();
    const fetchImpl = async (value, options = {}) => {
      const url = String(value);
      if (url === `https://${HOST}/_wss/health`) {
        if (variant === "health-body") {
          return response(200, { ...READY_BODY, deployment: "wrong" }, url, {
            "Content-Type": "application/json; charset=utf-8",
          });
        }
        if (variant === "health-url") {
          return response(200, READY_BODY, `${url}/redirected`, {
            "Content-Type": "application/json; charset=utf-8",
          });
        }
      }
      if (url === `https://${HOST}/api/preview-session`) {
        return response(405, variant === "preview-body" ? "wrong" : "Method Not Allowed", url, {
          Allow: variant === "preview-allow" ? "GET" : "POST",
          "Content-Type": "text/plain; charset=utf-8",
        });
      }
      return base(value, options);
    };
    const ensure = createVercelSharedSiteHostProvisioner({
      env: ENV,
      fetchImpl,
      wait: async () => {},
      pollMs: 1,
      maxWaitMs: 10,
    });
    await assert.rejects(() => ensure({ host: HOST }), /shared_site_host_router_identity_mismatch/, variant);
  }
});

test("provider bodies are bounded before identity decisions", async () => {
  let calls = 0;
  const ensure = createVercelSharedSiteHostProvisioner({
    env: ENV,
    fetchImpl: async (url) => {
      calls += 1;
      return response(200, {}, String(url), { "Content-Length": String(70 * 1024) });
    },
    wait: async () => {},
  });
  await assert.rejects(() => ensure({ host: HOST }), /shared_site_host_response_too_large/);
  assert.equal(calls, 1);
});

test("provider body reads share the same hard deadline as request headers", async () => {
  const ensure = createVercelSharedSiteHostProvisioner({
    env: ENV,
    fetchImpl: async (url) => ({
      ok: true,
      status: 200,
      url: String(url),
      headers: { get: () => null },
      arrayBuffer: () => new Promise(() => {}),
    }),
    pollMs: 1,
    maxWaitMs: 10,
  });
  await assert.rejects(() => ensure({ host: HOST }), /shared_site_host_deadline_exceeded/);
});

test("timeout never returns ready and abort performs zero provider calls", async () => {
  let calls = 0;
  let clock = 5_000;
  const base = successfulFetch();
  const ensure = createVercelSharedSiteHostProvisioner({
    env: ENV,
    fetchImpl: async (value, options) => {
      calls += 1;
      const url = String(value);
      if (url === `https://${HOST}/_wss/health`) {
        return response(404, "Not Found", url, { "Content-Type": "text/plain; charset=utf-8" });
      }
      return base(value, options);
    },
    now: () => clock,
    wait: async (ms) => { clock += ms; },
    pollMs: 2,
    maxWaitMs: 6,
  });
  await assert.rejects(() => ensure({ host: HOST }), /shared_site_host_deadline_exceeded/);

  const controller = new AbortController();
  controller.abort();
  const before = calls;
  await assert.rejects(() => ensure({ host: HOST, signal: controller.signal }), /shared_site_host_aborted/);
  assert.equal(calls, before);
});

test("production polling budget runs to the absolute deadline without early exit", async () => {
  const startedAt = 10_000;
  let clock = startedAt;
  let healthAttempts = 0;
  const base = successfulFetch();
  const ensure = createVercelSharedSiteHostProvisioner({
    env: ENV,
    fetchImpl: async (value, options) => {
      const url = String(value);
      if (url === `https://${HOST}/_wss/health`) {
        healthAttempts += 1;
        return response(404, "Not Found", url, { "Content-Type": "text/plain; charset=utf-8" });
      }
      return base(value, options);
    },
    now: () => clock,
    wait: async (ms) => { clock += ms; },
    pollMs: 750,
    maxWaitMs: 30_000,
  });

  await assert.rejects(() => ensure({ host: HOST }), /shared_site_host_deadline_exceeded/);
  assert.equal(clock, startedAt + 30_000);
  assert.equal(healthAttempts, 40);
});

test("invalid hosts and missing configuration fail before network I/O", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error("must_not_fetch"); };
  const ensure = createVercelSharedSiteHostProvisioner({ env: ENV, fetchImpl, wait: async () => {} });
  for (const host of [
    "",
    `https://${HOST}`,
    "ACME-PLUMBING.wss-ai.com",
    "acme.plumbing.wss-ai.com",
    "www.wss-ai.com",
    "acme-plumbing.wss-ai.com.evil.example",
  ]) {
    await assert.rejects(() => ensure({ host }), /shared_site_host_invalid/, host);
  }

  for (const env of [{ VERCEL_TEAM_ID: TEAM_ID }, { VERCEL_TOKEN: TOKEN }]) {
    const missing = createVercelSharedSiteHostProvisioner({ env, fetchImpl, wait: async () => {} });
    await assert.rejects(() => missing({ host: HOST }), /shared_site_host_configuration_required/);
  }
  assert.equal(calls, 0);
});

test("host admission rejects every slug reserved by the router", () => {
  for (const slug of ROUTER_RESERVED_SLUGS) {
    assert.equal(exactSharedHost(`${slug}.wss-ai.com`), "", slug);
  }
});
