import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createMemoryBuildContractStore } from "../lib/build-contract-store.mjs";
import { createBuildArtifactPublisher, createMemoryArtifactPublisher, ArtifactPublisherUnavailableError } from "../lib/build-artifact-publisher.mjs";
import { createContractBuildService, ContractBuildError, validateBuildRequest } from "../lib/contract-builds.mjs";
import { enforceBusinessTruth } from "../lib/business-truth.mjs";

const NOW = new Date("2026-07-15T12:00:00.000Z");
const NOW_FN = () => new Date(NOW);

function request(overrides = {}) {
  return {
    schema_version: "siteforge-build-request-v1",
    idempotency_key: "idem_contract_00000001",
    requested_at: NOW.toISOString(),
    caller: { source: "siteforge-app", trace_id: "trace_contract_1" },
    plan_tier: "free-preview",
    mode: "single-page-cinematic",
    truth_packet: {
      business_name: "Contract Roofing",
      city: "Austin",
      state: "TX",
      vertical: "roofing",
      services: ["Roof repair"],
    },
    assets: {},
    ...overrides,
  };
}

function completeResponse(buildId, idempotencyKey, overrides = {}) {
  return {
    schema_version: "siteforge-build-complete-v1",
    build_id: buildId,
    prospect_id: "prosp_contract_00000001",
    idempotency_key: idempotencyKey,
    status: "ready",
    renderer: "siteforge-renderer-v8-snowflake@8.2.0",
    renderer_version: "8.2.0",
    qc_contract: "siteforge-qc-v2-authority-108-plus-contamination",
    visual_qc_passed: true,
    generation_fingerprint: "a".repeat(64),
    authority_profile_version: "authority-108-v1",
    truth_packet_version: "siteforge-truth-packet-v1",
    preview_url: `https://artifacts.example.test/${buildId}/index.html`,
    report_url: `https://artifacts.example.test/${buildId}/optimization-manifest.json`,
    qc_passed: true,
    logo_provenance: {
      source: "owner-uploaded",
      verified: true,
      stages_applied: [],
    },
    media_provenance: {
      photos_verified_count: 1,
      photos_ai_atmosphere_count: 0,
      photos_dropped_low_quality: 0,
      gallery_photo_urls: ["https://artifacts.example.test/photo.webp"],
    },
    optimization_manifest: {
      version: "authority-108-v1",
      checks: Array.from({ length: 108 }, (_, index) => ({
        id: index + 1,
        category: `category-${(index % 9) + 1}`,
        label: `Authority check ${index + 1}`,
        state: "passed",
      })),
    },
    qc_summary: {
      authority_score: 108,
      authority_total: 108,
      hero_layers: 8,
      batch_hamming_min: 7,
    },
    completed_at: NOW.toISOString(),
    ...overrides,
  };
}

function idSequence(prefix = "01K0CONTRACTBUILD") {
  let count = 0;
  return () => `${prefix}${String(++count).padStart(10, "0")}`;
}

test("business-truth rejects a donor web-search logo before a build can use it", () => {
  const truth = enforceBusinessTruth({
    business: { name: "Atlas Roofing", category: "roofing", city: "Austin", state: "TX" },
    services: ["Roof repair"],
    v7_logo: { url: "https://other-roofer.example/logo.png", origin: "web-search" },
  }, {
    sourceFacts: { name: "Atlas Roofing", category: "roofing", city: "Austin", state: "TX" },
    sourceAssets: [{ kind: "logo", source: "web-search", url: "https://other-roofer.example/logo.png" }],
  });
  assert.equal(truth.logo_source, undefined);
  assert.equal(truth.v7_logo, undefined);
});

test("request validation rejects schema, key, mode, plan, stale timestamp, and missing truth before work", () => {
  const bad = request({
    schema_version: "wrong",
    idempotency_key: "short",
    requested_at: "2026-07-15T11:00:00.000Z",
    plan_tier: "invalid",
    mode: "invalid",
    truth_packet: { business_name: "A", city: "", state: "Texas" },
    unexpected: true,
  });
  assert.throws(() => validateBuildRequest(bad, { now: NOW_FN }), (error) => {
    assert.equal(error.code, "INVALID_BUILD_REQUEST");
    assert.match(error.details.join("\n"), /schema_version/);
    assert.match(error.details.join("\n"), /idempotency_key/);
    assert.match(error.details.join("\n"), /requested_at is stale/);
    assert.match(error.details.join("\n"), /truth_packet.vertical/);
    assert.match(error.details.join("\n"), /unexpected is not allowed/);
    return true;
  });
});

test("valid build is accepted, replayed, and protected from changed-payload collision", async () => {
  const store = createMemoryBuildContractStore({ now: NOW_FN });
  let starts = 0;
  const service = createContractBuildService({
    store,
    now: NOW_FN,
    idFactory: idSequence(),
    startBuild: async (input, { buildId }) => {
      starts += 1;
      return completeResponse(buildId, input.idempotency_key);
    },
  });

  const first = await service.submit(request(), { ownerId: "user_1" });
  assert.equal(first.statusCode, 202);
  assert.equal(first.response.status, "ready");
  const replay = await service.submit(request(), { ownerId: "user_1" });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.response.build_id, first.response.build_id);
  assert.equal(starts, 1);

  await assert.rejects(
    service.submit(request({ truth_packet: { ...request().truth_packet, business_name: "Different Roofing" } }), { ownerId: "user_1" }),
    (error) => error instanceof ContractBuildError && error.status === 409 && error.code === "IDEMPOTENCY_KEY_COLLISION_DIFFERENT_PAYLOAD",
  );
  assert.equal(starts, 1);
});

test("concurrent same-key calls elect one writer", async () => {
  const store = createMemoryBuildContractStore({ now: NOW_FN });
  let starts = 0;
  let release;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const service = createContractBuildService({
    store,
    now: NOW_FN,
    idFactory: idSequence("01K0CONCURRENTBLD"),
    startBuild: async (input, { buildId }) => {
      starts += 1;
      markStarted();
      await gate;
      return completeResponse(buildId, input.idempotency_key);
    },
  });

  const writer = service.submit(request({ idempotency_key: "idem_concurrent_000001" }), { ownerId: "user_1" });
  await started;
  const follower = await service.submit(request({ idempotency_key: "idem_concurrent_000001" }), { ownerId: "user_1" });
  assert.equal(follower.statusCode, 202);
  assert.equal(follower.response.state, "queued");
  release();
  const completed = await writer;
  assert.equal(completed.response.status, "ready");
  assert.equal(completed.response.build_id, follower.response.build_id);
  assert.equal(starts, 1);
});

test("missing public artifact publishing fails closed and persists a terminal failure", async () => {
  const unavailable = createBuildArtifactPublisher({ env: {} });
  assert.throws(() => unavailable.assertAvailable(), ArtifactPublisherUnavailableError);
  const service = createContractBuildService({
    store: createMemoryBuildContractStore({ now: NOW_FN }),
    now: NOW_FN,
    idFactory: idSequence("01K0NOPUBLISHERBLD"),
    startBuild: async () => unavailable.assertAvailable(),
  });
  const input = request({ idempotency_key: "idem_no_publisher_0001" });
  await assert.rejects(service.submit(input, { ownerId: "user_1" }), (error) => error.status === 503 && error.code === "ARTIFACT_PUBLISHER_UNAVAILABLE");
  const replay = await service.submit(input, { ownerId: "user_1" });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.response.schema_version, "siteforge-build-failure-v1");
  assert.equal(replay.response.error_code, "ARTIFACT_PUBLISHER_UNAVAILABLE");
});

test("artifact publisher uploads the complete bundle with deterministic conditional paths", async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "sf-contract-publisher-"));
  const calls = [];
  try {
    mkdirSync(path.join(outDir, "assets"));
    writeFileSync(path.join(outDir, "index.html"), "<!doctype html><title>Real</title>");
    writeFileSync(path.join(outDir, "optimization-manifest.json"), "{}");
    writeFileSync(path.join(outDir, "assets", "site.css"), "body{}");
    const publisher = createBuildArtifactPublisher({
      blobClient: {
        async put(pathname, body, options) {
          calls.push({ pathname, bytes: body.length, options });
          return { pathname, url: `https://blob.example.test/${pathname}` };
        },
      },
    });
    const result = await publisher.publishBundle({ buildId: "build_contract_1", outDir });
    assert.equal(calls.length, 3);
    assert.ok(calls.every((call) => call.options.addRandomSuffix === false && call.options.allowOverwrite === false));
    assert.deepEqual(calls.map((call) => call.pathname).sort(), [
      "sf/contract-builds/artifacts/build_contract_1/assets/site.css",
      "sf/contract-builds/artifacts/build_contract_1/index.html",
      "sf/contract-builds/artifacts/build_contract_1/optimization-manifest.json",
    ]);
    assert.match(result.preview_url, /\/index\.html$/);
    assert.match(result.report_url, /\/optimization-manifest\.json$/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("Engine.startContractBuild runs the real factory and publishes its bundle", async () => {
  const Engine = await import("../lib/engine-adapter.mjs");
  const { createMemoryStore } = await import("../../factory/lib/vertical-history.mjs");
  const publisher = createMemoryArtifactPublisher();
  const input = request({ idempotency_key: "idem_real_factory_00001", requested_at: undefined });
  const buildId = "01K0REALFACTORYBUILD0000001";
  const result = await Engine.startContractBuild(input, {
    buildId,
    artifactPublisher: publisher,
    verticalHistoryStore: createMemoryStore(),
    capture: false,
    visualQc: () => true,
    now: NOW_FN,
  });
  assert.equal(result.build_id, buildId);
  assert.match(result.preview_url, new RegExp(`/${buildId}/index\\.html$`));
  assert.match(result.report_url, new RegExp(`/${buildId}/optimization-manifest\\.json$`));
  assert.ok(publisher.bundles.get(buildId).hasOwnProperty("index.html"));
  assert.ok(publisher.bundles.get(buildId).hasOwnProperty("optimization-manifest.json"));
  assert.equal(result.qc_passed === true && result.visual_qc_passed !== true, false);
});

test("POST and GET enforce Studio auth/scope while the legacy forge route remains unchanged", async () => {
  process.env.NODE_ENV = "development";
  process.env.SITEFORGE_NO_LISTEN = "1";
  process.env.SITEFORGE_DATA_DIR = mkdtempSync(path.join(tmpdir(), "sf-build-route-"));
  const { server, configureContractBuildServiceForTests } = await import("../server.mjs");
  const DB = await import("../lib/store.mjs");
  const Studio = await import("../lib/studio-api.mjs");
  const routeService = createContractBuildService({
    store: createMemoryBuildContractStore({ now: NOW_FN }),
    now: NOW_FN,
    idFactory: idSequence("01K0ROUTECONTRACTBLD"),
    startBuild: async (input, { buildId }) => completeResponse(buildId, input.idempotency_key),
  });
  configureContractBuildServiceForTests(routeService);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body, token) => fetch(`${base}${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

  try {
    let response = await post("/api/build", request(), null);
    assert.equal(response.status, 401);

    const user = DB.insert("users", { email: "contract-route@example.test", plan: "agency" });
    const created = Studio.createApiKey({ userId: user.id, name: "Contract route" });
    DB.update("api_keys", created.record.id, { scopes: ["jobs:read"] });
    response = await post("/api/build", request(), created.secret);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error_code, "INSUFFICIENT_SCOPE");

    DB.update("api_keys", created.record.id, { scopes: ["forge:write", "jobs:read"] });
    response = await post("/api/build", request(), created.secret);
    assert.equal(response.status, 202);
    const accepted = await response.json();
    assert.equal(accepted.status, "ready");

    response = await fetch(`${base}/api/build/${accepted.build_id}`, { headers: { authorization: `Bearer ${created.secret}` } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).build_id, accepted.build_id);

    response = await post("/api/build", request(), created.secret);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).build_id, accepted.build_id);

    response = await post("/api/build", request({ truth_packet: { ...request().truth_packet, city: "Dallas" } }), created.secret);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error_code, "IDEMPOTENCY_KEY_COLLISION_DIFFERENT_PAYLOAD");

    response = await post("/api/v1/forge", {}, null);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "invalid API key" });
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    rmSync(process.env.SITEFORGE_DATA_DIR, { recursive: true, force: true });
  }
});
