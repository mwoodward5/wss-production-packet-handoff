import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const auth = require(join(repoRoot, "api", "lib", "provider-route-auth.js"));

const routes = [
  {
    name: "Firecrawl",
    handler: require(join(repoRoot, "api", "firecrawl-intake.js")),
    request: {
      method: "POST",
      url: "/api/firecrawl-intake",
      body: { urls: ["https://example.com/"] },
    },
  },
  {
    name: "Resend packet",
    handler: require(join(repoRoot, "api", "send-intake-packet.js")),
    request: {
      method: "POST",
      url: "/api/send-intake-packet",
      body: { packet: { packetName: "Fixture packet" } },
    },
  },
  {
    name: "Bright Data",
    handler: require(join(repoRoot, "api", "brightdata-serp-audit.js")),
    request: {
      method: "POST",
      url: "/api/brightdata-serp-audit",
      body: {
        packet: {
          business: { businessName: "Fixture Roofing", serviceArea: "Austin, TX" },
          compiled: { searchOptimizationPlan: { primaryKeyword: "roof repair", secondaryKeywords: [] } },
        },
      },
    },
  },
  {
    name: "Google Places",
    handler: require(join(repoRoot, "api", "google-places-intake.js")),
    request: {
      method: "POST",
      url: "/api/google-places-intake",
      body: { query: "Fixture Roofing Austin TX" },
    },
  },
  {
    name: "image proxy",
    handler: require(join(repoRoot, "api", "image-proxy.js")),
    request: {
      method: "GET",
      url: "/api/image-proxy?url=https%3A%2F%2Fexample.com%2Fhero.jpg",
      query: { url: "https://example.com/hero.jpg" },
    },
  },
  {
    name: "packet compiler",
    handler: require(join(repoRoot, "api", "compile-build-packet.js")),
    request: {
      method: "POST",
      url: "/api/compile-build-packet",
      body: { packet: { business: { businessName: "Fixture Business" } } },
    },
  },
];

function captureResponse() {
  let resolve;
  const complete = new Promise(done => { resolve = done; });
  const headers = new Map();
  const response = {
    statusCode: 200,
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    status(code) { this.statusCode = code; return this; },
    json(body) { resolve({ status: this.statusCode, body, headers }); return this; },
    send(body) { resolve({ status: this.statusCode, body, headers }); return this; },
    end(body = "") { resolve({ status: this.statusCode, body, headers }); return this; },
  };
  return { response, complete };
}

async function invoke(route, authorization = "", cookie = "") {
  const { response, complete } = captureResponse();
  await route.handler({
    ...route.request,
    headers: {
      origin: "https://pagehub-intake-lock-form.vercel.app",
      ...(authorization ? { authorization } : {}),
      ...(cookie ? { cookie } : {}),
    },
  }, response);
  return complete;
}

const ENV_KEYS = [
  "INTAKE_GENIE_TOKEN",
  "PAGEHUB_OWNER_TOKEN",
  "FIRECRAWL_API_KEY",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "PAGEHUB_ADMIN_EMAIL",
  "BRIGHTDATA_SERP_API_KEY",
  "GOOGLE_PLACES_API_KEY",
];

async function withProviderEnvironment(run) {
  const previous = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    INTAKE_GENIE_TOKEN: "provider-route-test-token",
    PAGEHUB_OWNER_TOKEN: "pagehub-owner-test-token",
    FIRECRAWL_API_KEY: "firecrawl-provider-key",
    RESEND_API_KEY: "resend-provider-key",
    RESEND_FROM_EMAIL: "proof@example.com",
    PAGEHUB_ADMIN_EMAIL: "owner@example.com",
    BRIGHTDATA_SERP_API_KEY: "brightdata-provider-key",
    GOOGLE_PLACES_API_KEY: "places-provider-key",
  });
  try {
    return await run();
  } finally {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("shared provider auth matches the Intake Genie constant-time token policy", () => {
  assert.equal(auth.authorized("Bearer provider-route-test-token", "provider-route-test-token"), true);
  assert.equal(auth.authorized("provider-route-test-token", "provider-route-test-token"), true);
  assert.equal(auth.authorized("Bearer wrong-token", "provider-route-test-token"), false);
  assert.equal(auth.authorized("", "provider-route-test-token"), false);
});

test("a signed short-lived owner cookie authorizes provider routes without exposing a bearer token", () => {
  const environment = {
    PAGEHUB_OWNER_TOKEN: "pagehub-owner-test-token",
  };
  const cookie = auth.ownerSessionCookie(environment.PAGEHUB_OWNER_TOKEN);
  const cookiePair = cookie.split(";", 1)[0];
  const response = {
    setHeader() { throw new Error("valid owner session must not set a challenge"); },
    status() { throw new Error("valid owner session must not set an error status"); },
  };

  assert.equal(auth.requireProviderRouteAuth({ headers: { cookie: cookiePair } }, response, environment), true);
  assert.doesNotMatch(cookie, /pagehub-owner-test-token/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.equal(auth.validOwnerSessionValue(cookiePair.split("=")[1], environment.PAGEHUB_OWNER_TOKEN), true);
  assert.equal(auth.validOwnerSessionValue(`${cookiePair.split("=")[1]}x`, environment.PAGEHUB_OWNER_TOKEN), false);
});

test("every provider route refuses missing and wrong authorization before provider invocation", async () => {
  await withProviderEnvironment(async () => {
    const originalFetch = globalThis.fetch;
    let providerCalls = 0;
    globalThis.fetch = async () => {
      providerCalls += 1;
      throw new Error("provider must not run before authorization");
    };
    try {
      for (const route of routes) {
        for (const authorization of ["", "Bearer wrong-token"]) {
          const before = providerCalls;
          const result = await invoke(route, authorization);
          assert.equal(result.status, 401, `${route.name} should reject ${authorization ? "wrong" : "missing"} auth`);
          assert.equal(result.body?.ok, false, `${route.name} should return a closed response`);
          assert.equal(result.headers.get("www-authenticate"), "Bearer");
          assert.equal(providerCalls, before, `${route.name} invoked a provider before auth`);
        }
      }
      assert.equal(providerCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("provider routes fail closed when the server auth token is not configured", async () => {
  await withProviderEnvironment(async () => {
    delete process.env.INTAKE_GENIE_TOKEN;
    delete process.env.PAGEHUB_OWNER_TOKEN;
    const originalFetch = globalThis.fetch;
    let providerCalls = 0;
    globalThis.fetch = async () => { providerCalls += 1; throw new Error("provider must not run"); };
    try {
      for (const route of routes) {
        const result = await invoke(route, "Bearer any-token");
        assert.equal(result.status, 503, `${route.name} should fail closed without any server auth configuration`);
        assert.equal(result.body?.ok, false);
      }
      assert.equal(providerCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("existing CORS preflights remain provider-free and do not require bearer auth", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls += 1; throw new Error("provider must not run"); };
  try {
    for (const route of routes.filter(candidate => candidate.request.method === "POST")) {
      const preflight = { ...route, request: { ...route.request, method: "OPTIONS" } };
      const result = await invoke(preflight);
      assert.equal(result.status, 204, `${route.name} preflight contract changed`);
      assert.equal(result.headers.get("access-control-allow-headers"), "Content-Type, Authorization");
    }
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
