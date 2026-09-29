"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { createHash, createHmac } = require("node:crypto");

process.env.MIRROR_DONOR_ROOT = path.join(__dirname, "fixtures");
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-resume-clients-"));
const VISUAL_SECRET = "fixed-mirror-test-secret";
process.env.GHOST_AGENCY_VISUAL_SECRET = VISUAL_SECRET;

const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");
const { slugPolicy, resolveTaggedDeployment } = require("../lib/mirror-engine/deploy");
const { chooseBrandMark } = require("../lib/mirror-engine/logo-ladder");
const { renderCheckOnce, renderAuditOnce } = require("../lib/mirror-engine/verify");
const { buildCheckoutLink, CHECKOUT_SECRET_ENV_NAME } = require("../lib/checkout-links");

function request(overrides = {}) {
  return {
    slug: "wss-test-resume-roofing",
    donor: "mirror-donor",
    facts: {
      business_name: "Resume Roofing",
      industry: "roofing",
      city: "Tucson",
      state: "AZ",
      phone: "(520) 555-0142",
      ...(overrides.facts || {}),
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "facts")),
  };
}

function releaseRequest(overrides = {}) {
  return request({
    ...overrides,
    brand: {
      mark: chooseBrandMark({
        logoCandidates: [],
        businessName: "Resume Roofing",
        accent: "#c8102e",
      }),
      site_accent: "#c8102e",
      site_accent_source: "https://resume-roofing.example.com/",
      ...(overrides.brand || {}),
    },
  });
}

function harness({ resume, tagged, resumeDiffClean = true } = {}) {
  const calls = [];
  let diffCount = 0;
  const deps = {
    slugPolicy,
    withSpaRewrite: (files) => files["vercel.json"]
      ? files
      : { ...files, "vercel.json": Buffer.from("{}") },
    ensureProject: async () => "prj_customer",
    resolveAliasDeployment: async (_input, limits) => {
      calls.push(["resolve", limits]);
      return resume || { found: false, reason: "alias_not_found" };
    },
    uploadFiles: async (files) => {
      calls.push(["upload"]);
      return { manifest: Object.keys(files).map((file) => ({ file })), uploaded: 1, deduped: 0 };
    },
    createDeployment: async (input, limits) => {
      calls.push(["create", input, limits]);
      return { id: "dpl_fresh", url: "fresh.vercel.app", readyState: "QUEUED" };
    },
    waitReady: async (_id, limits) => { calls.push(["wait", limits]); return { readyState: "READY" }; },
    byteDiff: async (_url, _files, limits) => {
      calls.push(["diff", limits]);
      diffCount++;
      return diffCount === 1 && !resumeDiffClean
        ? { clean: false, checked: 8, mismatches: [{ file: "index.html", reason: "bytes_differ" }] }
        : { clean: true, checked: 8, mismatches: [] };
    },
    deepLinkCheck: async (_url, _files, _routes, limits) => {
      calls.push(["deep", limits]);
      return { clean: true, failures: [] };
    },
    attachAlias: async (_input, limits) => { calls.push(["alias", limits]); return { alias: "https://wss-test-resume-roofing.wss-ai.com" }; },
    aliasTargetCheck: async (_input, limits) => { calls.push(["aliasCheck", limits]); return { clean: true, deploymentId: "dpl" }; },
    renderCheck: async (_url, limits) => { calls.push(["render", limits]); return { status: "passed", problems: [] }; },
    renderAudit: async (_url, limits) => {
      calls.push(["audit", limits]);
      return { status: "passed", problems: [], pages: [], collisions: [], missing_hash_targets: [], prose: [] };
    },
  };
  if (tagged !== undefined) {
    deps.resolveTaggedDeployment = async (_input, limits) => {
      calls.push(["resolveTagged", limits]);
      return tagged;
    };
  }
  return { calls, deps };
}

test("exact same-project alias candidate is reused without upload or create", async () => {
  const h = harness({
    resume: {
      found: true,
      projectId: "prj_customer",
      deployment: { id: "dpl_existing", url: "existing.vercel.app", readyState: "READY" },
    },
  });
  const out = await mirror(releaseRequest(), { registry: createRegistry(), deps: h.deps, operationKey: "private:lead:1" });
  assert.equal(out.status, 200);
  assert.equal(out.body.deploy_id, "dpl_existing");
  assert.equal(out.body.deployment_reused, true);
  assert.equal(h.calls.some(([name]) => name === "upload"), false);
  assert.equal(h.calls.some(([name]) => name === "create"), false);
  assert.equal(h.calls.some(([name]) => name === "alias"), true, "final truth reasserts the mutable alias target");
});

test("resume byte mismatch deploys fresh and sends only hashed operation metadata", async () => {
  const rawKey = "line:person@example.test:+15205550142";
  const h = harness({
    resumeDiffClean: false,
    resume: {
      found: true,
      projectId: "prj_customer",
      deployment: { id: "dpl_stale", url: "stale.vercel.app", readyState: "READY" },
    },
  });
  const out = await mirror(releaseRequest(), { registry: createRegistry(), deps: h.deps, operationKey: rawKey });
  assert.equal(out.status, 200);
  assert.equal(out.body.deploy_id, "dpl_fresh");
  assert.equal(out.body.deployment_reused, false);
  const create = h.calls.find(([name]) => name === "create")[1];
  const plainSha = createHash("sha256").update(rawKey).digest("hex");
  const receipt = createHmac("sha256", VISUAL_SECRET).update(rawKey).digest("hex");
  assert.equal(create.metadata.operation_key_hmac_sha256, receipt);
  assert.equal(create.metadata.build_hash, out.body.build_hash);
  assert.equal(JSON.stringify(create).includes(rawKey), false);
  assert.equal(JSON.stringify(create).includes(plainSha), false);
  assert.equal(h.calls.some(([name]) => name === "alias"), true);
});

test("alias candidate from another project is refused before upload", async () => {
  const h = harness({
    resume: {
      found: true,
      projectId: "prj_someone_else",
      deployment: { id: "dpl_wrong", url: "wrong.vercel.app", readyState: "READY" },
    },
  });
  const out = await mirror(request(), { registry: createRegistry(), deps: h.deps });
  assert.equal(out.status, 502);
  assert.match(out.body.detail[0].reason, /resume_refused:deployment_wrong_project/);
  assert.equal(h.calls.some(([name]) => name === "upload"), false);
  assert.equal(h.calls.some(([name]) => name === "create"), false);
});

test("caller abort stops underlying resume work and records no success", async () => {
  const controller = new AbortController();
  const registry = createRegistry();
  const h = harness();
  h.deps.resolveAliasDeployment = async (_input, { signal }) => new Promise((_resolve, reject) => {
    const stop = () => reject(signal.reason || Object.assign(new Error("aborted"), { name: "AbortError" }));
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  });
  const work = mirror(request(), {
    registry,
    deps: h.deps,
    operationKey: "abort-me",
    signal: controller.signal,
    deadlineAt: Date.now() + 120_000,
  });
  controller.abort(Object.assign(new Error("caller stopped"), { name: "AbortError" }));
  const out = await work;
  assert.equal(out.status, 504);
  assert.equal(registry.recordGet(request().slug), null);
  assert.equal(registry._debug.memo.size, 0);
  assert.equal(registry._debug.identities.size, 0);
});

test("deadline inside the 30 second checkpoint reserve stops before Vercel", async () => {
  const h = harness();
  const registry = createRegistry();
  const out = await mirror(request(), {
    registry,
    deps: h.deps,
    operationKey: "deadline",
    deadlineAt: Date.now() + 29_000,
  });
  assert.equal(out.status, 504);
  assert.equal(h.calls.length, 0);
  assert.equal(registry.recordGet(request().slug), null);
});

test("unaliased deployment with exact operation metadata is reused with zero creates", async () => {
  const h = harness({
    resume: { found: false, reason: "alias_not_found" },
    tagged: {
      found: true,
      source: "operation_metadata",
      projectId: "prj_customer",
      deployment: { id: "dpl_unaliased", url: "unaliased.vercel.app", readyState: "READY" },
    },
  });
  const out = await mirror(releaseRequest(), {
    registry: createRegistry(),
    deps: h.deps,
    operationKey: "line:durable-resume:1",
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.deploy_id, "dpl_unaliased");
  assert.equal(out.body.upload_stats.reused, out.body.file_count);
  assert.equal(h.calls.filter(([name]) => name === "create").length, 0);
  assert.equal(h.calls.filter(([name]) => name === "upload").length, 0);
  assert.equal(h.calls.filter(([name]) => name === "alias").length, 1, "unaliased resume attaches only after byte/deep proof");
});

test("same-week checkout bytes let a fresh registry reuse the exact alias with zero creates", async () => {
  const oldCheckoutSecret = process.env[CHECKOUT_SECRET_ENV_NAME];
  const oldApiUrl = process.env.GHOST_AGENCY_API_URL;
  try {
    process.env[CHECKOUT_SECRET_ENV_NAME] = "same-week-checkout-secret";
    process.env.GHOST_AGENCY_API_URL = "https://ghost.wss-ai.com";
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const bucketStart = Math.floor(Date.now() / weekMs) * weekMs;
    const checkoutInput = {
      prospect: { prospect_id: "resume-roofing", business_name: "Resume Roofing", city: "Tucson", state: "AZ" },
      job: { id: "mirror-resume-roofing" },
    };
    const firstCheckout = buildCheckoutLink({ ...checkoutInput, now: bucketStart + 1 });
    const lastCheckout = buildCheckoutLink({ ...checkoutInput, now: bucketStart + weekMs - 1 });
    assert.equal(lastCheckout, firstCheckout);
    const firstRequest = request({
      content: { services: ["Roof repair"] },
      signup: { clientId: "resume-roofing", checkoutUrl: firstCheckout },
    });
    const firstHarness = harness({ resume: { found: false, reason: "alias_not_found" } });
    const first = await mirror(firstRequest, {
      registry: createRegistry(), deps: firstHarness.deps, operationKey: "same-week-operation-one",
    });
    assert.equal(first.status, 200);
    assert.equal(firstHarness.calls.filter(([name]) => name === "create").length, 1);

    const secondHarness = harness({
      resume: {
        found: true,
        projectId: "prj_customer",
        deployment: { id: "dpl_same_week", url: "same-week.vercel.app", readyState: "READY" },
      },
    });
    const second = await mirror(request({
      content: { services: ["Roof repair"] },
      signup: { clientId: "resume-roofing", checkoutUrl: lastCheckout },
    }), {
      registry: createRegistry(), deps: secondHarness.deps, operationKey: "same-week-operation-two",
    });
    assert.equal(second.status, 200);
    assert.equal(second.body.build_hash, first.body.build_hash);
    assert.equal(second.body.deploy_id, "dpl_same_week");
    assert.equal(second.body.deployment_reused, true);
    assert.equal(secondHarness.calls.filter(([name]) => name === "create").length, 0);
    assert.equal(secondHarness.calls.filter(([name]) => name === "upload").length, 0);
  } finally {
    if (oldCheckoutSecret === undefined) delete process.env[CHECKOUT_SECRET_ENV_NAME];
    else process.env[CHECKOUT_SECRET_ENV_NAME] = oldCheckoutSecret;
    if (oldApiUrl === undefined) delete process.env.GHOST_AGENCY_API_URL;
    else process.env.GHOST_AGENCY_API_URL = oldApiUrl;
  }
});

test("resume registry outage is retryable and creates nothing", async () => {
  const h = harness({
    resume: { found: false, refused: true, retryable: true, reason: "alias_lookup_http_503" },
  });
  const out = await mirror(request(), { registry: createRegistry(), deps: h.deps, operationKey: "retry-later" });
  assert.equal(out.status, 502);
  assert.match(out.body.detail[0].reason, /resume_refused:alias_lookup_http_503/);
  assert.equal(h.calls.some(([name]) => name === "create"), false);
  assert.equal(h.calls.some(([name]) => name === "upload"), false);
});

test("explicit alias-not-found permits exactly one fresh create", async () => {
  const h = harness({ resume: { found: false, reason: "alias_not_found" } });
  const out = await mirror(request(), { registry: createRegistry(), deps: h.deps });
  assert.equal(out.status, 200);
  assert.equal(out.body.deployment_reused, false);
  assert.equal(h.calls.filter(([name]) => name === "create").length, 1);
});

test("mismatched operation metadata is not reused and deploys once", async () => {
  const h = harness({
    resume: { found: false, reason: "alias_not_found" },
    // A successful list with no exact two-hash match is represented as the
    // explicit no-candidate result. It is safe to create, never to reuse.
    tagged: { found: false, reason: "alias_not_found" },
  });
  const out = await mirror(request(), {
    registry: createRegistry(), deps: h.deps, operationKey: "new-operation",
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.deployment_reused, false);
  assert.equal(h.calls.filter(([name]) => name === "resolveTagged").length, 1);
  assert.equal(h.calls.filter(([name]) => name === "create").length, 1);
});

test("deployment-list outage after alias-not-found creates nothing", async () => {
  const h = harness({
    resume: { found: false, reason: "alias_not_found" },
    tagged: { found: false, refused: true, retryable: true, reason: "deployment_list_http_503" },
  });
  const out = await mirror(request(), {
    registry: createRegistry(), deps: h.deps, operationKey: "durable-operation",
  });
  assert.equal(out.status, 502);
  assert.match(out.body.detail[0].reason, /deployment_list_http_503/);
  assert.equal(h.calls.some(([name]) => name === "create"), false);
});

test("tagged discovery reads both hashes, normalizes v6 uid, and keeps id compatibility", async () => {
  const originalFetch = global.fetch;
  const oldToken = process.env.VERCEL_TOKEN;
  const oldTeam = process.env.VERCEL_TEAM_ID;
  process.env.VERCEL_TOKEN = "test-token";
  process.env.VERCEL_TEAM_ID = "team_test";
  const exact = {
    uid: "dpl_tagged_uid",
    url: "tagged-resume.vercel.app",
    readyState: "READY",
    projectId: "prj_customer",
    name: "wss-test-resume-roofing",
    meta: { operation_key_hmac_sha256: "op-hmac", build_hash: "build-hash" },
  };
  try {
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ deployments: [exact] }) });
    const hit = await resolveTaggedDeployment({
      projectId: "prj_customer", buildHash: "build-hash", operationKeyHmacSha256: "op-hmac",
    });
    assert.equal(hit.found, true);
    assert.equal(hit.deployment.id, "dpl_tagged_uid");

    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ deployments: [{ ...exact, uid: undefined, id: "dpl_tagged_id" }] }),
    });
    const compatible = await resolveTaggedDeployment({
      projectId: "prj_customer", buildHash: "build-hash", operationKeyHmacSha256: "op-hmac",
    });
    assert.equal(compatible.found, true);
    assert.equal(compatible.deployment.id, "dpl_tagged_id");

    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ deployments: [{ ...exact, id: "dpl_tagged_uid" }] }),
    });
    const equalBoth = await resolveTaggedDeployment({
      projectId: "prj_customer", buildHash: "build-hash", operationKeyHmacSha256: "op-hmac",
    });
    assert.equal(equalBoth.found, true);
    assert.equal(equalBoth.deployment.id, "dpl_tagged_uid");

    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ deployments: [{ ...exact, id: "dpl_different" }] }),
    });
    const conflict = await resolveTaggedDeployment({
      projectId: "prj_customer", buildHash: "build-hash", operationKeyHmacSha256: "op-hmac",
    });
    assert.deepEqual(conflict, { found: false, refused: true, reason: "deployment_invalid_identity" });

    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ deployments: [{ ...exact, uid: undefined }] }),
    });
    const missing = await resolveTaggedDeployment({
      projectId: "prj_customer", buildHash: "build-hash", operationKeyHmacSha256: "op-hmac",
    });
    assert.deepEqual(missing, { found: false, refused: true, reason: "deployment_invalid_identity" });

    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ deployments: [{ ...exact, meta: { ...exact.meta, build_hash: "other-build" } }] }),
    });
    const miss = await resolveTaggedDeployment({
      projectId: "prj_customer", buildHash: "build-hash", operationKeyHmacSha256: "op-hmac",
    });
    assert.deepEqual(miss, { found: false, reason: "alias_not_found" });
  } finally {
    global.fetch = originalFetch;
    if (oldToken === undefined) delete process.env.VERCEL_TOKEN; else process.env.VERCEL_TOKEN = oldToken;
    if (oldTeam === undefined) delete process.env.VERCEL_TEAM_ID; else process.env.VERCEL_TEAM_ID = oldTeam;
  }
});

test("stale alias mismatch reuses newer exact tagged deployment before create", async () => {
  const h = harness({
    resumeDiffClean: false,
    resume: {
      found: true,
      source: "alias",
      projectId: "prj_customer",
      deployment: { id: "dpl_old_alias", url: "old-alias.vercel.app", readyState: "READY" },
    },
    tagged: {
      found: true,
      source: "operation_metadata",
      projectId: "prj_customer",
      deployment: { id: "dpl_new_unaliased", url: "new-unaliased.vercel.app", readyState: "READY" },
    },
  });
  const out = await mirror(releaseRequest(), {
    registry: createRegistry(), deps: h.deps, operationKey: "resume-newer-operation",
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.deploy_id, "dpl_new_unaliased");
  assert.equal(h.calls.filter(([name]) => name === "create").length, 0);
  assert.equal(h.calls.filter(([name]) => name === "upload").length, 0);
  assert.equal(h.calls.filter(([name]) => name === "resolveTagged").length, 1);
  assert.equal(h.calls.filter(([name]) => name === "alias").length, 1);
});

test("transient resume probe failure is retryable and never creates fresh", async () => {
  const h = harness({
    resume: {
      found: true,
      source: "alias",
      projectId: "prj_customer",
      deployment: { id: "dpl_rate_limited", url: "rate-limited.vercel.app", readyState: "READY" },
    },
  });
  h.deps.byteDiff = async () => ({
    clean: false, checked: 0, mismatches: [{ file: "index.html", reason: "http_429" }],
  });
  const out = await mirror(request(), {
    registry: createRegistry(), deps: h.deps, operationKey: "do-not-duplicate",
  });
  assert.equal(out.status, 502);
  assert.match(out.body.detail[0].reason, /resume_probe_retryable:http_429/);
  assert.equal(h.calls.some(([name]) => name === "create"), false);
  assert.equal(h.calls.some(([name]) => name === "upload"), false);
});

test("transient deep-link resume probe also creates nothing", async () => {
  const h = harness({
    resume: {
      found: true,
      source: "alias",
      projectId: "prj_customer",
      deployment: { id: "dpl_deep_503", url: "deep-503.vercel.app", readyState: "READY" },
    },
  });
  h.deps.deepLinkCheck = async () => ({
    clean: false, failures: [{ probe: "asset_route", reason: "http_503" }],
  });
  const out = await mirror(request(), {
    registry: createRegistry(), deps: h.deps, operationKey: "do-not-duplicate-deep",
  });
  assert.equal(out.status, 502);
  assert.match(out.body.detail[0].reason, /resume_probe_retryable:http_503/);
  assert.equal(h.calls.some(([name]) => name === "create"), false);
  assert.equal(h.calls.some(([name]) => name === "upload"), false);
});

test("missing visual secret omits operation receipt and skips tagged discovery", async () => {
  const previous = process.env.GHOST_AGENCY_VISUAL_SECRET;
  delete process.env.GHOST_AGENCY_VISUAL_SECRET;
  const rawKey = "person@example.test:+15205550142";
  try {
    const h = harness({
      resume: { found: false, reason: "alias_not_found" },
      tagged: {
        found: true,
        source: "operation_metadata",
        projectId: "prj_customer",
        deployment: { id: "must_not_reuse", url: "must-not-reuse.vercel.app", readyState: "READY" },
      },
    });
    const out = await mirror(request(), { registry: createRegistry(), deps: h.deps, operationKey: rawKey });
    assert.equal(out.status, 200);
    assert.equal(h.calls.some(([name]) => name === "resolveTagged"), false);
    const create = h.calls.find(([name]) => name === "create")[1];
    assert.deepEqual(Object.keys(create.metadata), ["build_hash"]);
    assert.equal(JSON.stringify(create).includes(rawKey), false);
    assert.equal(JSON.stringify(create).includes(createHash("sha256").update(rawKey).digest("hex")), false);
  } finally {
    process.env.GHOST_AGENCY_VISUAL_SECRET = previous;
  }
});

for (const [name, run] of [
  ["renderCheck", renderCheckOnce],
  ["renderAudit", renderAuditOnce],
]) {
  test(`${name} aborts a hung launch and closes a browser that resolves late`, async () => {
    const controller = new AbortController();
    let resolveLaunch;
    let closes = 0;
    const launch = () => new Promise((resolve) => { resolveLaunch = resolve; });
    const work = run("https://example.test", { signal: controller.signal, launch });
    controller.abort(Object.assign(new Error("caller deadline"), { name: "AbortError" }));
    await assert.rejects(work, /caller deadline/);
    resolveLaunch({ close: async () => { closes++; } });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(closes, 1);
  });
}
