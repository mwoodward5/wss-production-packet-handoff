"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const donorRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-shared-donors-"));
const donorDir = path.join(donorRoot, "mirror-donor");
fs.cpSync(path.join(__dirname, "fixtures", "mirror-donor"), donorDir, { recursive: true });
const donorManifestPath = path.join(donorDir, "BOILERPLATE.json");
const donorManifest = JSON.parse(fs.readFileSync(donorManifestPath, "utf8"));
// This is a truthful WSS-owned fallback fixture.  The client-video rung is
// deliberately absent: a donor fixture video must never be relabelled as
// verified client media merely to make a release test pass.
fs.copyFileSync(
  path.join(donorDir, "media", "hero-loop.mp4"),
  path.join(donorDir, "media", "hero-fallback.mp4"),
);
donorManifest.hero_video = {
  client_video_path: "media/hero-client.mp4",
  wss_fallback_clip_path: "media/hero-fallback.mp4",
};
fs.writeFileSync(donorManifestPath, `${JSON.stringify(donorManifest, null, 2)}\n`);
process.env.MIRROR_DONOR_ROOT = donorRoot;
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-shared-publish-"));

const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");
const { slugPolicy } = require("../lib/mirror-engine/deploy");
const { chooseBrandMark } = require("../lib/mirror-engine/logo-ladder");
const { buildRouteMap } = require("../lib/mirror-engine/routes");

const SLUG = "wss-test-shared-publish-roofing";
const HOST = `${SLUG}.wss-ai.com`;
const SITE_ID = "11111111-1111-4111-8111-111111111111";
const RELEASE_ID = "22222222-2222-4222-8222-222222222222";

function request() {
  const mark = chooseBrandMark({
    logoCandidates: [],
    businessName: "Shared Publish Roofing",
    accent: "#c8102e",
  });
  return {
    slug: SLUG,
    donor: "mirror-donor",
    facts: {
      business_name: "Shared Publish Roofing",
      industry: "roofing",
      city: "Tucson",
      state: "AZ",
      phone: "(520) 555-0142",
    },
    brand: {
      mark,
      site_accent: "#c8102e",
      site_accent_source: "https://shared-publish-roofing.example.com/",
    },
  };
}

function emptyEditLog() {
  return {
    ok: true,
    configured: false,
    fingerprint: "",
    active: [],
    revoked: [],
    legacy: [],
  };
}

function proof(buildHash) {
  const proofIdentity = {
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    build_hash: buildHash,
  };
  return {
    ok: true,
    previewUrl: `https://${HOST}/`,
    proofIdentity,
    releaseEvidence: {
      evidence_schema: "shared-site-release-evidence-v1",
      ...proofIdentity,
      canonical_host: HOST,
      manifest_path: `sites/${SITE_ID}/releases/${RELEASE_ID}/manifest.json`,
      manifest_sha256: "a".repeat(64),
      generation: 1,
      deployment_env: "production",
    },
  };
}

function stagedProof(buildHash, calls) {
  const proofIdentity = {
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    build_hash: buildHash,
  };
  return {
    ok: true,
    state: "staged",
    previewUrl: `https://${HOST}/`,
    proofIdentity,
    async openPreview() {
      const id = calls.filter(([name]) => name === "openPreview").length + 1;
      const fetchImpl = async () => { throw new Error("harness preview fetch should be consumed by injected probes"); };
      const preparePage = async () => {};
      fetchImpl.previewId = id;
      preparePage.previewId = id;
      calls.push(["openPreview", { id, fetchImpl, preparePage }]);
      return { origin: `https://${HOST}/`, fetch: fetchImpl, preparePage };
    },
  };
}

function harness({ stage, activate, diff, render, audit, legacy = false } = {}) {
  const calls = [];
  const deps = {
    slugPolicy,
    siteEditLog: async () => emptyEditLog(),
    sharedPublisher: {
      supportsTwoPhaseQc: true,
      stage: async (input) => {
        calls.push(["sharedStage", input]);
        return stage ? stage(input, calls) : stagedProof(input.buildHash, calls);
      },
      activate: async (receipt, limits) => {
        calls.push(["sharedActivate", { receipt, limits }]);
        return activate ? activate(receipt, limits) : proof(receipt.proofIdentity.build_hash);
      },
    },
    withSpaRewrite: (files) => {
      calls.push(["withSpaRewrite"]);
      if (!legacy) throw new Error("legacy_with_spa_called");
      return files;
    },
    ensureProject: async () => {
      calls.push(["ensureProject"]);
      if (!legacy) throw new Error("legacy_project_called");
      return "prj_legacy";
    },
    uploadFiles: async (files) => {
      calls.push(["uploadFiles"]);
      if (!legacy) throw new Error("legacy_upload_called");
      return { manifest: Object.keys(files).map((file) => ({ file })), uploaded: 1, deduped: 0 };
    },
    createDeployment: async () => {
      calls.push(["createDeployment"]);
      if (!legacy) throw new Error("legacy_deploy_called");
      return { id: "dpl_legacy", url: "legacy.vercel.app" };
    },
    waitReady: async () => { calls.push(["waitReady"]); },
    byteDiff: async (host, files, options) => {
      calls.push(["byteDiff", host, options]);
      return diff || { clean: true, checked: 9, mismatches: [] };
    },
    deepLinkCheck: async (host, files, routes, options) => {
      calls.push(["deepLinkCheck", host, options]);
      return { clean: true, failures: [] };
    },
    attachAlias: async ({ slug }) => {
      calls.push(["attachAlias"]);
      if (!legacy) throw new Error("legacy_alias_called");
      return { alias: `https://${slug}.wss-ai.com` };
    },
    aliasTargetCheck: async () => {
      calls.push(["aliasTargetCheck"]);
      if (!legacy) throw new Error("legacy_alias_check_called");
      return { clean: true };
    },
    renderCheck: async (url, options) => {
      calls.push(["renderCheck", url, options]);
      return render || { status: "passed", problems: [] };
    },
    renderAudit: async (url, options) => {
      calls.push(["renderAudit", url, options]);
      return audit || { status: "passed", problems: [], pages: [], collisions: [], missing_hash_targets: [], prose: [] };
    },
  };
  return { calls, deps };
}

test("route map names assets, clean static pages, directory indexes and known SPA deep routes", () => {
  const files = {
    "index.html": Buffer.from("home"),
    "404.html": Buffer.from("missing"),
    "about.html": Buffer.from("about"),
    "service-area/index.html": Buffer.from("area"),
    "assets/app.js": Buffer.from("app"),
  };
  const routeMap = buildRouteMap({
    files,
    routePlan: {
      exact: ["/services"],
      prefixes: ["/work"],
      linked: ["/", "/about", "/services", "/work/roof-repair"],
    },
  });

  assert.equal(routeMap["/"], "index.html");
  assert.equal(routeMap["/about"], "about.html");
  assert.equal(routeMap["/about.html"], "about.html");
  assert.equal(routeMap["/service-area"], "service-area/index.html");
  assert.equal(routeMap["/service-area/"], "service-area/index.html");
  assert.equal(routeMap["/assets/app.js"], "assets/app.js");
  assert.equal(routeMap["/services"], "index.html");
  assert.equal(routeMap["/work/roof-repair"], "index.html");
  assert.equal(routeMap["/work/not-linked"], undefined, "unknown prefix children stay true 404s");
});

test("default shared publish makes zero per-site Vercel calls and keeps all proof gates", async () => {
  const previous = process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
  delete process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
  try {
    const h = harness();
    const result = await mirror(request(), {
      registry: createRegistry(),
      deps: h.deps,
      operationKey: "shared-op-1",
    });

    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.preview_url, `https://${HOST}/`);
    assert.equal(result.body.shared_publish, true);
    assert.deepEqual(result.body.proofIdentity, {
      site_id: SITE_ID,
      release_id: RELEASE_ID,
      build_hash: result.body.build_hash,
    });
    assert.equal(result.body.sharedReleaseEvidence.build_hash, result.body.build_hash);
    assert.equal(result.body.sharedReleaseEvidence.hero_video_path, "media/hero-fallback.mp4");
    assert.match(result.body.sharedReleaseEvidence.hero_video_sha256, /^[0-9a-f]{64}$/);
    assert.equal(result.body.checks.asset_diff.status, "passed");
    assert.equal(result.body.checks.deep_link.status, "passed");
    assert.equal(result.body.checks.alias_target.status, "passed");
    assert.equal(result.body.checks.render.status, "passed");
    assert.equal(result.body.checks.route_render.status, "passed");

    const providerCalls = new Set([
      "withSpaRewrite", "ensureProject", "uploadFiles", "createDeployment",
      "waitReady", "attachAlias", "aliasTargetCheck",
    ]);
    assert.deepEqual(h.calls.filter(([name]) => providerCalls.has(name)), []);
    assert.equal(h.calls.filter(([name]) => name === "sharedStage").length, 1);
    assert.equal(h.calls.filter(([name]) => name === "sharedActivate").length, 1);
    assert.ok(h.calls.some(([name, host]) => name === "byteDiff" && host === `https://${HOST}/`));
    assert.ok(h.calls.some(([name, url]) => name === "renderCheck" && url === `https://${HOST}/`));

    const input = h.calls.find(([name]) => name === "sharedStage")[1];
    assert.equal(input.slug, SLUG);
    assert.equal(input.host, HOST);
    assert.equal(input.operationKey, "shared-op-1");
    assert.equal(input.routeMap["/"], "index.html");
    assert.ok(input.routeMap["/assets/app-abc123.js"] || input.routeMap["/assets/style-def456.css"]);
    assert.equal(input.buildHash, result.body.build_hash);

    const opened = h.calls.filter(([name]) => name === "openPreview").map(([, value]) => value);
    assert.equal(opened.length, 3, "byte/deep, render and audit each mint a fresh preview capability");
    const byte = h.calls.find(([name]) => name === "byteDiff");
    const deep = h.calls.find(([name]) => name === "deepLinkCheck");
    const render = h.calls.find(([name]) => name === "renderCheck");
    const renderAudit = h.calls.find(([name]) => name === "renderAudit");
    assert.equal(byte[2].fetchImpl, opened[0].fetchImpl);
    assert.equal(deep[2].fetchImpl, opened[0].fetchImpl);
    assert.equal(render[2].preparePage, opened[1].preparePage);
    assert.equal(renderAudit[2].preparePage, opened[2].preparePage);
    const sequence = h.calls.map(([name]) => name);
    assert.ok(sequence.indexOf("sharedActivate") > sequence.indexOf("renderAudit"));
    assert.doesNotMatch(JSON.stringify(result.body), /openPreview|preparePage|previewCookie|preview_cookie|grant/i);
  } finally {
    if (previous === undefined) delete process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
    else process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT = previous;
  }
});

test("selected shared stage failure is terminal with no legacy fallback", async () => {
  const previous = process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
  delete process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
  try {
    const h = harness({ stage: async () => ({ ok: false, fallback: false, reason: "release_stage_refused" }) });
    const result = await mirror(request(), { registry: createRegistry(), deps: h.deps });
    assert.equal(result.status, 502);
    assert.equal(result.body.error, "shared_stage_failed");
    assert.deepEqual(result.body.detail, [{ reason: "release_stage_refused" }]);
    assert.equal(h.calls.filter(([name]) => name === "sharedStage").length, 1);
    assert.equal(h.calls.filter(([name]) => name === "sharedActivate").length, 0);
    assert.deepEqual(
      h.calls.filter(([name]) => ["ensureProject", "uploadFiles", "createDeployment", "attachAlias"].includes(name)),
      [],
    );
  } finally {
    if (previous === undefined) delete process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
    else process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT = previous;
  }
});

test("selected shared stage exposes a safe provider code only", async () => {
  const previous = process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
  delete process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
  try {
    const h = harness({ stage: async () => ({
      ok: false,
      fallback: false,
      reason: "shared_release_io_failed",
      detail: { error: "shared_storage_upload_failed:403" },
    }) });
    const result = await mirror(request(), { registry: createRegistry(), deps: h.deps });
    assert.equal(result.status, 502);
    assert.deepEqual(result.body.detail, [{ reason: "shared_release_io_failed:shared_storage_upload_failed:403" }]);
  } finally {
    if (previous === undefined) delete process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
    else process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT = previous;
  }
});

test("one-phase shared publisher is refused instead of falling back to a provider deployment", async () => {
  const previous = process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
  delete process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
  try {
    const h = harness();
    h.deps.sharedPublisher = { publish: async () => proof("unused") };
    const result = await mirror(request(), { registry: createRegistry(), deps: h.deps });
    assert.equal(result.status, 503);
    assert.equal(result.body.error, "shared_publish_failed");
    assert.deepEqual(result.body.detail, [{ reason: "shared_publisher_invalid" }]);
    assert.deepEqual(
      h.calls.filter(([name]) => ["ensureProject", "uploadFiles", "createDeployment", "attachAlias"].includes(name)),
      [],
    );
  } finally {
    if (previous === undefined) delete process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
    else process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT = previous;
  }
});

test("missing production shared configuration fails closed before any legacy deployment", async () => {
  const previousDefault = process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publisherPath = require.resolve("../lib/shared-mirror-publisher");
  delete process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete require.cache[publisherPath];
  try {
    const { injectDefaultSharedPublisher } = require(publisherPath);
    const h = harness();
    delete h.deps.sharedPublisher;
    const deps = injectDefaultSharedPublisher(h.deps);
    assert.equal(Object.prototype.hasOwnProperty.call(deps, "sharedPublisher"), true);

    const result = await mirror(request(), { registry: createRegistry(), deps });
    assert.equal(result.status, 503);
    assert.equal(result.body.error, "shared_publish_failed");
    assert.deepEqual(result.body.detail, [{ reason: "shared_publisher_invalid" }]);
    assert.deepEqual(
      h.calls.filter(([name]) => ["ensureProject", "uploadFiles", "createDeployment", "attachAlias"].includes(name)),
      [],
    );
  } finally {
    if (previousDefault === undefined) delete process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
    else process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT = previousDefault;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
    delete require.cache[publisherPath];
  }
});

test("cold missing shared configuration stays fail-closed through API, Line, and mirror-lane", async () => {
  const previousDefault = process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const modulePaths = [
    require.resolve("../lib/shared-mirror-publisher"),
    require.resolve("../api/mirror"),
    require.resolve("../lib/line-mirror-resume"),
    require.resolve("../lib/mirror-lane-build"),
  ];
  const cached = new Map(modulePaths.map((modulePath) => [modulePath, require.cache[modulePath]]));
  const legacyNames = ["ensureProject", "uploadFiles", "createDeployment", "attachAlias"];
  const withoutShared = (deps) => {
    const out = { ...deps };
    delete out.sharedPublisher;
    return out;
  };
  const routeResponse = () => ({
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    end(value = "") { this.body += String(value); },
  });

  delete process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  for (const modulePath of modulePaths) delete require.cache[modulePath];
  try {
    const { createMirrorHandler } = require("../api/mirror");
    const { lineEngineMirror } = require("../lib/line-mirror-resume");
    const { buildMirrorForProspect } = require("../lib/mirror-lane-build");

    const apiHarness = harness();
    const apiResponse = routeResponse();
    const api = createMirrorHandler({
      requireAdmin: () => true,
      registry: createRegistry(),
      deps: withoutShared(apiHarness.deps),
    });
    await api({
      method: "POST",
      url: "/api/mirror",
      headers: {},
      body: { ...request(), slug: "wss-test-shared-config-api" },
    }, apiResponse);
    assert.equal(apiResponse.statusCode, 503);
    assert.equal(JSON.parse(apiResponse.body).error, "shared_publish_failed");
    assert.deepEqual(apiHarness.calls.filter(([name]) => legacyNames.includes(name)), []);

    const lineHarness = harness();
    const lineResult = await lineEngineMirror(
      { ...request(), slug: "wss-test-shared-config-line" },
      { registry: createRegistry(), deps: withoutShared(lineHarness.deps) },
    );
    assert.equal(lineResult.status, 503);
    assert.equal(lineResult.body.error, "shared_publish_failed");
    assert.deepEqual(lineHarness.calls.filter(([name]) => legacyNames.includes(name)), []);

    const laneHarness = harness();
    const laneResult = await buildMirrorForProspect({
      prospect_id: "shared-config-lane",
      business_name: "Shared Config Roofing",
      industry: "roofing",
      site: "https://shared-config-roofing.example/",
      email: "owner@shared-config-roofing.example",
    }, {
      operationKey: "shared-config-lane-op",
      deps: {
        mirrorEngineDeps: withoutShared(laneHarness.deps),
        resolveSocials: async () => ({ socials: [], source: "not_attempted" }),
        resolveBuildableDonor: () => ({ ok: true, donor: "mirror-donor", vertical: "roofing" }),
        resolveVerifiedFacts: async () => ({
          ok: true,
          facts: {
            business_name: "Shared Config Roofing",
            industry: "roofing",
            city: "Tucson",
            state: "AZ",
            phone: "(520) 555-0142",
            current_website: "https://shared-config-roofing.example/",
          },
          content: {
            services: ["Roof repair", "Roof replacement", "Storm inspection"],
            reviews: [],
            hours: [],
          },
          coverage: {},
        }),
        harvestClientPhotos: async () => ({ ok: true, photos: [] }),
        readFleetIdentities: async () => ({ ok: true, identities: [] }),
      },
    });
    assert.equal(laneResult.ok, false);
    assert.equal(laneResult.reason, "shared_publish_failed");
    assert.deepEqual(laneHarness.calls.filter(([name]) => legacyNames.includes(name)), []);
  } finally {
    if (previousDefault === undefined) delete process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
    else process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT = previousDefault;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
    for (const modulePath of modulePaths) {
      delete require.cache[modulePath];
      if (cached.get(modulePath)) require.cache[modulePath] = cached.get(modulePath);
    }
  }
});

test("staged byte mismatch performs zero activation and zero legacy deployment", async () => {
  const previous = process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
  delete process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
  try {
    const h = harness({
      diff: { clean: false, checked: 8, mismatches: [{ file: "index.html", reason: "bytes_differ" }] },
    });
    const result = await mirror(request(), { registry: createRegistry(), deps: h.deps });
    assert.equal(result.status, 500);
    assert.equal(result.body.error, "deployed_verification_failed");
    assert.equal(h.calls.filter(([name]) => name === "sharedStage").length, 1);
    assert.equal(h.calls.filter(([name]) => name === "sharedActivate").length, 0);
    assert.deepEqual(
      h.calls.filter(([name]) => ["ensureProject", "uploadFiles", "createDeployment", "attachAlias"].includes(name)),
      [],
    );
  } finally {
    if (previous === undefined) delete process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
    else process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT = previous;
  }
});

test("staged sameness failure stays private and never pollutes active proof", async () => {
  const previous = process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
  delete process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
  try {
    const h = harness({
      audit: {
        status: "passed",
        problems: [],
        pages: [{ path: "/", h1: "The Same Donor Headline", title: "", status: 200 }],
        collisions: [],
        missing_hash_targets: [],
        prose: [],
      },
    });
    const result = await mirror(request(), { registry: createRegistry(), deps: h.deps });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.shared_staged, true);
    assert.equal(result.body.shared_publish, undefined);
    assert.equal(result.body.proofIdentity, undefined);
    assert.equal(result.body.sharedReleaseEvidence, undefined);
    assert.equal(result.body.checks.sameness.status, "failed");
    assert.equal(result.body.checks.alias_target.status, "staged");
    assert.equal(result.body.revealable, false);
    assert.equal(h.calls.filter(([name]) => name === "sharedActivate").length, 0);
    assert.doesNotMatch(JSON.stringify(result.body), /openPreview|preparePage|previewCookie|preview_cookie|grant/i);
  } finally {
    if (previous === undefined) delete process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
    else process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT = previous;
  }
});

test("critical render failures stay staged and block activation", async () => {
  const previous = process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
  delete process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
  try {
    const h = harness({
      render: { status: "failed", problems: ["visual_timeout"] },
      audit: {
        status: "failed",
        problems: ["route_visual_timeout"],
        pages: [],
        collisions: [],
        missing_hash_targets: [],
        prose: [],
      },
    });
    const result = await mirror(request(), { registry: createRegistry(), deps: h.deps });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.checks.render.status, "failed");
    assert.equal(result.body.checks.route_render.status, "failed");
    assert.equal(result.body.checks.critical_visual.status, "failed");
    assert.equal(result.body.checks.alias_target.status, "staged");
    assert.equal(result.body.shared_publish, undefined);
    assert.equal(result.body.shared_staged, true);
    assert.equal(result.body.revealable, false, "critical render proof is release-gating by contract");
    assert.equal(h.calls.filter(([name]) => name === "sharedActivate").length, 0);
    const polishNames = result.body.polish_flags.map((flag) => flag.name);
    assert.ok(polishNames.includes("render"));
    assert.ok(polishNames.includes("route_render"));
  } finally {
    if (previous === undefined) delete process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
    else process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT = previous;
  }
});

test("concurrent CAS refusal is terminal after QC with no legacy fallback", async () => {
  const previous = process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
  delete process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
  try {
    const h = harness({ activate: async () => ({ ok: false, fallback: false, reason: "release_cas_conflict" }) });
    const result = await mirror(request(), { registry: createRegistry(), deps: h.deps });
    assert.equal(result.status, 502);
    assert.equal(result.body.error, "shared_activation_failed");
    assert.deepEqual(result.body.detail, [{ reason: "release_cas_conflict" }]);
    assert.equal(h.calls.filter(([name]) => name === "sharedActivate").length, 1);
    assert.deepEqual(
      h.calls.filter(([name]) => ["ensureProject", "uploadFiles", "createDeployment", "attachAlias"].includes(name)),
      [],
    );
  } finally {
    if (previous === undefined) delete process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
    else process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT = previous;
  }
});

test("exact 0 kill switch preserves the legacy per-site deployment path", async () => {
  const previous = process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
  process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT = "0";
  try {
    const h = harness({ legacy: true });
    const result = await mirror(request(), { registry: createRegistry(), deps: h.deps });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(h.calls.filter(([name]) => name === "sharedStage").length, 0);
    assert.equal(h.calls.filter(([name]) => name === "sharedActivate").length, 0);
    for (const expected of ["withSpaRewrite", "ensureProject", "uploadFiles", "createDeployment", "waitReady", "attachAlias", "aliasTargetCheck"]) {
      assert.equal(h.calls.filter(([name]) => name === expected).length, 1, `${expected} was not called exactly once`);
    }
    assert.equal(result.body.shared_publish, undefined);
    assert.equal(result.body.deploy_id, "dpl_legacy");
  } finally {
    if (previous === undefined) delete process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
    else process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT = previous;
  }
});
