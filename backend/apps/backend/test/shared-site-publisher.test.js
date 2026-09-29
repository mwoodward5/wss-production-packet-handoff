"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");

const {
  SHARED_RELEASE_EVIDENCE_SCHEMA,
  createSharedSitePublisher,
  createSharedSiteRegistryAdapter,
  createSupabaseReleaseStorageAdapter,
  createSupabaseRestRpc,
  createSupabaseRestReleaseStorageAdapter,
  createPublicReleaseVerifier,
  deterministicReleaseUuid,
} = require("../lib/shared-site-publisher");
const { ROUTER_PROJECT_ID } = require("../lib/shared-site-host-provisioner");
const { prepareRelease } = require("../lib/shared-site-release");

const SITE_ID = "11111111-1111-4111-8111-111111111111";
const BUILD_HASH = "a".repeat(64);
const SLUG = "acme-plumbing";
const HOST = `${SLUG}.wss-ai.com`;
const OPERATION_KEY = "line:batch-one:prospect-one:build-one";
const PREVIEW_SECRET = "publisher-preview-secret-at-least-32-bytes-long";
const ENV = Object.freeze({
  WSS_SHARED_PUBLISH_ENABLED: "1",
  WSS_SHARED_SITE_ALLOWLIST: SLUG,
  WSS_SHARED_SITE_ENV: "test",
  WSS_SITE_PREVIEW_SECRET: PREVIEW_SECRET,
});

function files() {
  return {
    "index.html": Buffer.from("<!doctype html><link rel=stylesheet href=/assets/app.css>"),
    "assets/app.css": Buffer.from("body{color:#123}"),
  };
}

function publisherInput(overrides = {}) {
  return {
    slug: SLUG,
    host: HOST,
    files: files(),
    routeMap: { "/": "index.html", "/assets/app.css": "assets/app.css" },
    buildHash: BUILD_HASH,
    operationKey: OPERATION_KEY,
    ...overrides,
  };
}

function fakeRegistry({ activationConflict = false, rollbackConflict = false, quarantineConflict = false } = {}) {
  const state = {
    generation: 0,
    active: null,
    previous: null,
    serveMode: "legacy",
    releases: new Map(),
    calls: [],
  };
  return {
    state,
    async ensureSiteIdentity({ slug, host }) {
      state.calls.push(["ensure", slug, host]);
      return { ok: true, site_id: SITE_ID, canonical_slug: slug, canonical_host: host, generation: state.generation };
    },
    async readSiteGeneration({ siteId, slug, host }) {
      state.calls.push(["read-generation", siteId]);
      return {
        ok: true,
        site_id: SITE_ID,
        canonical_slug: slug,
        canonical_host: host,
        generation: state.generation,
        active_release_id: state.active && state.active.releaseId,
        active_build_hash: state.active && state.active.buildHash,
        active_manifest_path: state.active && state.active.manifestPath,
        active_manifest_sha256: state.active && state.active.manifestSha256,
        active_published_generation: state.active && state.active.routeGeneration,
        active_deployment_env: state.active && state.active.environment,
      };
    },
    async insertStagedRelease(row) {
      state.calls.push(["stage", row.releaseId]);
      const existing = state.releases.get(row.releaseId);
      if (existing) {
        const exact = [
          "siteId", "releaseId", "buildHash", "canonicalHost", "routeGeneration",
          "environment", "manifestPath", "manifestSha256",
        ].every((key) => existing[key] === row[key]);
        return exact && ["staged", "verified", "active", "retired"].includes(existing.state)
          ? { ok: true, state: existing.state, replay: true }
          : { ok: false, reason: "release_conflict" };
      }
      state.releases.set(row.releaseId, { ...row, state: "staged" });
      return { ok: true, state: "staged" };
    },
    async markReleaseVerified(row) {
      state.calls.push(["verify", row.releaseId]);
      const existing = state.releases.get(row.releaseId);
      if (!existing) return { ok: false, reason: "release_missing" };
      existing.state = "verified";
      return { ok: true, state: "verified" };
    },
    async activateReleaseCas({ releaseId, expectedGeneration, environment }) {
      state.calls.push(["activate", releaseId, expectedGeneration]);
      if (activationConflict) return { ok: false, reason: "generation_conflict", generation: state.generation + 1 };
      if (state.generation === expectedGeneration + 1
        && state.active && state.active.releaseId === releaseId
        && state.active.environment === environment) {
        return { ok: true, generation: state.generation, idempotent: true };
      }
      if (expectedGeneration !== state.generation) return { ok: false, reason: "generation_conflict", generation: state.generation };
      const release = state.releases.get(releaseId);
      if (!release || release.state !== "verified") return { ok: false, reason: "release_not_verified" };
      if (state.active) {
        const old = state.releases.get(state.active.releaseId);
        if (old) old.state = "retired";
      }
      state.previous = state.active ? { ...state.active } : null;
      state.generation += 1;
      release.state = "active";
      state.active = {
        releaseId,
        buildHash: release.buildHash,
        manifestPath: release.manifestPath,
        manifestSha256: release.manifestSha256,
        routeGeneration: release.routeGeneration,
        environment,
      };
      state.serveMode = "shared";
      return { ok: true, generation: state.generation };
    },
    async rollbackReleaseCas({ releaseId, expectedGeneration, environment }) {
      state.calls.push(["rollback", releaseId, expectedGeneration]);
      if (rollbackConflict) {
        return { ok: false, reason: "generation_conflict", generation: state.generation + 1 };
      }
      if (expectedGeneration !== state.generation) {
        return { ok: false, reason: "generation_conflict", generation: state.generation };
      }
      if (!state.previous || state.previous.releaseId !== releaseId
        || state.previous.environment !== environment) {
        return { ok: false, reason: "release_not_recorded_previous" };
      }
      const target = state.releases.get(releaseId);
      if (!target || !["retired", "verified"].includes(target.state)) {
        return { ok: false, reason: "rollback_release_not_eligible" };
      }
      const current = state.active ? { ...state.active } : null;
      const activeRelease = current && state.releases.get(current.releaseId);
      if (activeRelease) activeRelease.state = "retired";
      target.state = "active";
      state.active = { ...state.previous };
      state.previous = current;
      state.serveMode = "shared";
      state.generation += 1;
      return { ok: true, generation: state.generation, releaseId };
    },
    async quarantineReleaseCas({ releaseId, expectedGeneration, environment }) {
      state.calls.push(["quarantine", releaseId, expectedGeneration]);
      if (quarantineConflict) {
        return { ok: false, reason: "generation_conflict", generation: state.generation + 1 };
      }
      if (state.generation === expectedGeneration + 1
        && state.serveMode === "legacy" && state.active === null
        && state.previous === null) {
        const failed = state.releases.get(releaseId);
        if (failed && failed.state === "revoked" && failed.environment === environment) {
          return { ok: true, generation: state.generation, releaseId, state: "quarantined", idempotent: true };
        }
      }
      if (expectedGeneration !== state.generation) {
        return { ok: false, reason: "generation_conflict", generation: state.generation };
      }
      if (state.serveMode !== "shared" || !state.active || state.active.releaseId !== releaseId
        || state.previous !== null || state.active.environment !== environment) {
        return { ok: false, reason: "failed_release_identity_mismatch" };
      }
      const failed = state.releases.get(releaseId);
      if (!failed || failed.state !== "active" || failed.routeGeneration !== expectedGeneration) {
        return { ok: false, reason: "failed_release_identity_mismatch" };
      }
      failed.state = "revoked";
      state.previous = null;
      state.active = null;
      state.serveMode = "legacy";
      state.generation += 1;
      return { ok: true, generation: state.generation, releaseId, state: "quarantined" };
    },
    async registerPreviewGrant(row) {
      state.calls.push(["register-preview", row.releaseId]);
      return { ok: true };
    },
  };
}

function memoryStorage() {
  const objects = new Map();
  const calls = [];
  return {
    objects,
    calls,
    async readObject({ bucket, key }) {
      calls.push(["read", bucket, key]);
      return objects.has(key)
        ? { ok: true, found: true, body: Buffer.from(objects.get(key)) }
        : { ok: true, found: false };
    },
    async putObjectIfAbsent({ bucket, key, body, insertOnly }) {
      calls.push(["put", bucket, key, insertOnly]);
      assert.equal(insertOnly, true);
      if (objects.has(key)) return { ok: false, exists: true, reason: "object_exists" };
      objects.set(key, Buffer.from(body));
      return { ok: true, inserted: true };
    },
  };
}

const PUBLIC_OK = async () => ({ ok: true, fallback: false, routes: ["/"] });
const ENSURE_HOST_OK = async ({ host }) => Object.freeze({
  ok: true,
  host,
  projectId: ROUTER_PROJECT_ID,
});

function testPublisher(options = {}) {
  return createSharedSitePublisher({
    publicVerifier: PUBLIC_OK,
    ensureSharedSiteHost: ENSURE_HOST_OK,
    ...options,
  });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function publicResponse(url, body, identity, overrides = {}) {
  const headers = {
    "x-wss-site-id": identity.siteId,
    "x-wss-release-id": identity.releaseId,
    "x-wss-build-hash": identity.buildHash,
    "x-wss-route-generation": String(identity.generation),
    ...overrides,
  };
  return {
    ok: true,
    status: 200,
    url,
    headers: { get(name) { return headers[name.toLowerCase()] || null; } },
    async arrayBuffer() { return Buffer.from(body); },
  };
}

function previewExchangeResponse(url, cookie = "preview_payload.preview_signature") {
  return {
    ok: true,
    status: 204,
    url,
    headers: {
      getSetCookie() {
        return [`__Host-wss-site-preview=${cookie}; Max-Age=300; Path=/; HttpOnly; Secure; SameSite=Strict`];
      },
    },
  };
}

test("publisher activates one immutable release and exact retry returns the same durable receipt", async () => {
  const registry = fakeRegistry();
  const storage = memoryStorage();
  const publisher = testPublisher({ registry, storage, env: ENV });

  const first = await publisher.publish(publisherInput());
  const second = await publisher.publish(publisherInput());

  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.fallback, false);
  assert.equal(first.previewUrl, `https://${HOST}/`);
  assert.equal(first.idempotentReplay, false);
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.idempotentReplay, true);
  assert.equal(second.releaseId, first.releaseId);
  assert.deepEqual(second.proofIdentity, first.proofIdentity);
  assert.equal(second.releaseEvidence.manifest_sha256, first.releaseEvidence.manifest_sha256);
  assert.equal(first.releaseEvidence.evidence_schema, SHARED_RELEASE_EVIDENCE_SCHEMA);
  assert.deepEqual(first.proofIdentity, {
    site_id: SITE_ID,
    release_id: first.releaseId,
    build_hash: BUILD_HASH,
  });
  assert.equal(registry.state.calls.filter(([kind]) => kind === "stage").length, 1);
  assert.equal(registry.state.calls.filter(([kind]) => kind === "verify").length, 1);
  assert.equal(registry.state.calls.filter(([kind]) => kind === "activate").length, 1);
  assert.equal(storage.calls.filter(([kind]) => kind === "put").length, 3, "two files plus manifest upload once");
  assert.ok([...storage.objects.keys()].every((key) => key.startsWith(`sites/${SITE_ID}/releases/${first.releaseId}/`)));
});

test("two-phase stage verifies immutable bytes but performs zero activation and zero canonical proof", async () => {
  const registry = fakeRegistry();
  const storage = memoryStorage();
  let publicChecks = 0;
  let exchanges = 0;
  const publisher = createSharedSitePublisher({
    registry,
    storage,
    env: ENV,
    publicVerifier: async () => { publicChecks += 1; return { ok: true }; },
    ensureSharedSiteHost: ENSURE_HOST_OK,
    previewFetch: async () => { exchanges += 1; throw new Error("must_not_exchange_during_stage"); },
  });
  const staged = await publisher.stage(publisherInput());
  assert.equal(staged.ok, true, JSON.stringify(staged));
  assert.equal(staged.state, "staged");
  assert.equal(staged.previewUrl, `https://${HOST}/`);
  assert.equal(staged.currentGeneration, 0);
  assert.equal(staged.predictedGeneration, 1);
  assert.equal(typeof staged.openPreview, "function");
  assert.equal(Object.hasOwn(staged, "releaseEvidence"), false);
  assert.equal(registry.state.calls.filter(([kind]) => kind === "stage").length, 1);
  assert.equal(registry.state.calls.filter(([kind]) => kind === "verify").length, 1);
  assert.equal(registry.state.calls.filter(([kind]) => kind === "activate").length, 0);
  assert.equal(publicChecks, 0);
  assert.equal(exchanges, 0);
  assert.equal(registry.state.generation, 0);
  assert.equal(publisher.supportsTwoPhaseQc, true);
  assert.equal(publisher.supportsDeferredActivation, true);
});

test("openPreview exchanges a fresh grant and returns only opaque same-origin session closures", async () => {
  const registry = fakeRegistry();
  const storage = memoryStorage();
  const exchanges = [];
  const previewRequests = [];
  const cookieValue = "preview_payload.preview_signature";
  const publisher = createSharedSitePublisher({
    registry,
    storage,
    env: ENV,
    publicVerifier: PUBLIC_OK,
    ensureSharedSiteHost: ENSURE_HOST_OK,
    async previewFetch(url, options) {
      if (url.endsWith("/api/preview-session")) {
        exchanges.push({ url, options });
        return previewExchangeResponse(url, cookieValue);
      }
      previewRequests.push({ url, options });
      return { ok: true, status: 200, url, headers: { get() { return null; } } };
    },
  });
  const staged = await publisher.stage(publisherInput());
  const session = await staged.openPreview();
  assert.equal(session.origin, `https://${HOST}`);
  assert.deepEqual(Object.keys(session).sort(), ["fetch", "origin", "preparePage"]);
  assert.equal(exchanges.length, 1);
  assert.equal(exchanges[0].url, `https://${HOST}/api/preview-session`);
  assert.equal(exchanges[0].options.method, "POST");
  assert.equal(exchanges[0].options.redirect, "error");
  const exchangeBody = JSON.parse(exchanges[0].options.body);
  assert.deepEqual(Object.keys(exchangeBody), ["grant"]);
  assert.match(exchangeBody.grant, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const secondSession = await staged.openPreview();
  const secondGrant = JSON.parse(exchanges[1].options.body).grant;
  assert.notEqual(secondGrant, exchangeBody.grant, "every preview opening uses a new one-use grant");
  assert.equal(secondSession.origin, session.origin);
  assert.equal(registry.state.calls.filter(([kind]) => kind === "register-preview").length, 2);

  await session.fetch("/services?preview=1");
  assert.equal(previewRequests[0].url, `https://${HOST}/services?preview=1`);
  assert.equal(previewRequests[0].options.headers.get("cookie"), `__Host-wss-site-preview=${cookieValue}`);
  await assert.rejects(() => session.fetch("https://other.wss-ai.com/"), /shared_preview_cross_origin_refused/);

  let installed;
  const page = {
    context() {
      return { async addCookies(cookies) { installed = cookies; } };
    },
  };
  assert.equal(await session.preparePage(page), page);
  assert.deepEqual(installed, [{
    name: "__Host-wss-site-preview",
    value: cookieValue,
    url: `https://${HOST}/`,
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
  }]);
  assert.equal(JSON.stringify(staged).includes(cookieValue), false);
  assert.equal(JSON.stringify(session).includes(cookieValue), false);
  assert.equal(JSON.stringify(staged).includes(exchangeBody.grant), false);
});

test("exact host is freshly provisioned before every preview and activation", async () => {
  const registry = fakeRegistry();
  const storage = memoryStorage();
  const events = [];
  const originalRegister = registry.registerPreviewGrant.bind(registry);
  const originalActivate = registry.activateReleaseCas.bind(registry);
  registry.registerPreviewGrant = async (row) => {
    events.push("register-preview");
    return originalRegister(row);
  };
  registry.activateReleaseCas = async (row) => {
    events.push("activate");
    return originalActivate(row);
  };
  const publisher = createSharedSitePublisher({
    registry,
    storage,
    env: ENV,
    async ensureSharedSiteHost(input) {
      events.push("ensure-host");
      assert.equal(input.host, HOST);
      return { ok: true, host: input.host, projectId: ROUTER_PROJECT_ID };
    },
    async previewFetch(url) {
      events.push("exchange");
      return previewExchangeResponse(url);
    },
    async publicVerifier() {
      events.push("public-proof");
      return { ok: true };
    },
  });

  const staged = await publisher.stage(publisherInput());
  assert.deepEqual(events, [], "immutable staging does not touch Vercel or public routes");
  await staged.openPreview();
  await staged.openPreview();
  assert.deepEqual(events, [
    "ensure-host",
    "register-preview",
    "exchange",
    "ensure-host",
    "register-preview",
    "exchange",
  ]);

  const active = await publisher.activate(staged);
  assert.equal(active.ok, true);
  assert.deepEqual(events.slice(-3), ["ensure-host", "activate", "public-proof"]);
  assert.equal(events.filter((event) => event === "ensure-host").length, 3);
});

test("activation rechecks a previously previewed host before CAS", async () => {
  const registry = fakeRegistry();
  let provisions = 0;
  let publicChecks = 0;
  const publisher = createSharedSitePublisher({
    registry,
    storage: memoryStorage(),
    env: ENV,
    async ensureSharedSiteHost({ host }) {
      provisions += 1;
      if (provisions === 1) return { ok: true, host, projectId: ROUTER_PROJECT_ID };
      throw new Error("shared_site_host_project_mismatch");
    },
    previewFetch: async (url) => previewExchangeResponse(url),
    async publicVerifier() {
      publicChecks += 1;
      return { ok: true };
    },
  });

  const staged = await publisher.stage(publisherInput());
  await staged.openPreview();
  const active = await publisher.activate(staged);
  assert.equal(active.ok, false);
  assert.equal(active.reason, "shared_release_host_provision_failed");
  assert.equal(active.detail.reason, "shared_site_host_project_mismatch");
  assert.equal(provisions, 2);
  assert.equal(registry.state.calls.filter(([kind]) => kind === "activate").length, 0);
  assert.equal(publicChecks, 0);
});

test("host refusal fails before preview grants, activation, and public proof", async () => {
  const registry = fakeRegistry();
  let publicChecks = 0;
  let exchanges = 0;
  const publisher = createSharedSitePublisher({
    registry,
    storage: memoryStorage(),
    env: ENV,
    async ensureSharedSiteHost() {
      throw new Error("shared_site_host_project_mismatch");
    },
    async previewFetch() {
      exchanges += 1;
      throw new Error("must_not_exchange");
    },
    async publicVerifier() {
      publicChecks += 1;
      return { ok: true };
    },
  });

  const staged = await publisher.stage(publisherInput());
  await assert.rejects(() => staged.openPreview(), /shared_site_host_project_mismatch/);
  const active = await publisher.activate(staged);
  assert.equal(active.ok, false);
  assert.equal(active.reason, "shared_release_host_provision_failed");
  assert.equal(active.detail.reason, "shared_site_host_project_mismatch");
  assert.equal(registry.state.calls.filter(([kind]) => kind === "register-preview").length, 0);
  assert.equal(registry.state.calls.filter(([kind]) => kind === "activate").length, 0);
  assert.equal(exchanges, 0);
  assert.equal(publicChecks, 0);
});

test("activate is the final mutation and only then performs canonical public proof", async () => {
  const registry = fakeRegistry();
  const events = [];
  const realActivate = registry.activateReleaseCas.bind(registry);
  registry.activateReleaseCas = async (row) => {
    events.push("activate");
    return realActivate(row);
  };
  const publisher = createSharedSitePublisher({
    registry,
    storage: memoryStorage(),
    env: ENV,
    ensureSharedSiteHost: async ({ host }) => {
      events.push("ensure-host");
      return { ok: true, host, projectId: ROUTER_PROJECT_ID };
    },
    previewFetch: async () => { throw new Error("unused"); },
    publicVerifier: async () => { events.push("public-proof"); return { ok: true }; },
  });
  const staged = await publisher.stage(publisherInput());
  assert.deepEqual(events, []);
  const active = await publisher.activate(staged);
  assert.equal(active.ok, true, JSON.stringify(active));
  assert.deepEqual(events, ["ensure-host", "activate", "public-proof"]);
  assert.deepEqual(active.proofIdentity, staged.proofIdentity);
  assert.equal(active.releaseEvidence.state, "active");
  assert.equal(active.generation, staged.predictedGeneration);
});

test("deferred CAS conflict fails closed without canonical proof", async () => {
  const registry = fakeRegistry({ activationConflict: true });
  let publicChecks = 0;
  const publisher = createSharedSitePublisher({
    registry,
    storage: memoryStorage(),
    env: ENV,
    ensureSharedSiteHost: ENSURE_HOST_OK,
    previewFetch: async () => { throw new Error("unused"); },
    publicVerifier: async () => { publicChecks += 1; return { ok: true }; },
  });
  const staged = await publisher.stage(publisherInput());
  assert.equal(staged.ok, true);
  const result = await publisher.activate(staged);
  assert.equal(result.reason, "shared_release_activation_refused");
  assert.equal(result.fallback, false);
  assert.equal(publicChecks, 0);
  assert.equal(registry.state.active, null);
  assert.equal(registry.state.calls.filter(([kind]) => kind === "rollback").length, 0);
});

test("active exact replay stages safely without another mutation and re-proves on activate", async () => {
  const registry = fakeRegistry();
  let publicChecks = 0;
  const publisher = createSharedSitePublisher({
    registry,
    storage: memoryStorage(),
    env: ENV,
    ensureSharedSiteHost: ENSURE_HOST_OK,
    previewFetch: async () => { throw new Error("unused"); },
    publicVerifier: async () => { publicChecks += 1; return { ok: true }; },
  });
  const first = await publisher.publish(publisherInput());
  assert.equal(first.ok, true);
  const mutations = registry.state.calls.filter(([kind]) => ["stage", "verify", "activate"].includes(kind)).length;
  const replayStage = await publisher.stage(publisherInput());
  assert.equal(replayStage.state, "active_exact");
  assert.equal(replayStage.predictedGeneration, first.generation);
  assert.equal(
    registry.state.calls.filter(([kind]) => ["stage", "verify", "activate"].includes(kind)).length,
    mutations,
  );
  const replay = await publisher.activate(replayStage);
  assert.equal(replay.ok, true);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(publicChecks, 2);
  assert.equal(registry.state.calls.filter(([kind]) => kind === "activate").length, 1);
});

test("preview grant and cookie never enter receipts, evidence, or refusal errors", async () => {
  const secretCookie = "secret_cookie_value.secret_signature";
  const publisher = createSharedSitePublisher({
    registry: fakeRegistry(),
    storage: memoryStorage(),
    env: ENV,
    publicVerifier: PUBLIC_OK,
    ensureSharedSiteHost: ENSURE_HOST_OK,
    async previewFetch(url) {
      return previewExchangeResponse(url, `${secretCookie}; Domain=evil.example`);
    },
  });
  const staged = await publisher.stage(publisherInput());
  let error;
  try {
    await staged.openPreview();
  } catch (caught) {
    error = caught;
  }
  assert.match(String(error), /shared_preview_cookie_invalid/);
  assert.equal(String(error).includes(secretCookie), false);
  assert.equal(JSON.stringify(staged).includes("preview"), true, "receipt contains only the public preview URL/function name");
  assert.equal(JSON.stringify(staged).includes(secretCookie), false);
  const active = await publisher.activate(staged);
  assert.equal(JSON.stringify(active.releaseEvidence).includes(secretCookie), false);
  assert.equal(JSON.stringify(active).includes(PREVIEW_SECRET), false);
});

test("public verifier proves canonical root and one routed asset with exact identity and bytes", async () => {
  const releaseId = deterministicReleaseUuid({ siteId: SITE_ID, operationKey: OPERATION_KEY, buildHash: BUILD_HASH });
  const prepared = prepareRelease({
    siteId: SITE_ID,
    releaseId,
    buildHash: BUILD_HASH,
    slug: SLUG,
    canonicalHost: HOST,
    expectedGeneration: 0,
    environment: "test",
    env: ENV,
    files: files(),
    routes: publisherInput().routeMap,
  });
  const seen = [];
  const identity = { siteId: SITE_ID, releaseId, buildHash: BUILD_HASH, generation: 1 };
  const verifier = createPublicReleaseVerifier({
    async fetchImpl(url, options) {
      seen.push({ url, options });
      const route = new URL(url).pathname;
      const target = prepared.manifest.routes[route];
      return publicResponse(url, prepared.preparedFiles.get(target).body, identity);
    },
  });
  const result = await verifier({
    previewUrl: `https://${HOST}/`,
    ...identity,
    manifest: prepared.manifest,
    preparedFiles: prepared.preparedFiles,
  });
  assert.deepEqual(result, { ok: true, fallback: false, routes: ["/", "/assets/app.css"] });
  assert.deepEqual(seen.map(({ url }) => new URL(url).pathname), ["/", "/assets/app.css"]);
  assert.ok(seen.every(({ options }) => options.redirect === "error" && options.cache === "no-store"));
});

test("public verifier refuses identity-header and byte mismatches", async () => {
  const releaseId = deterministicReleaseUuid({ siteId: SITE_ID, operationKey: OPERATION_KEY, buildHash: BUILD_HASH });
  const prepared = prepareRelease({
    siteId: SITE_ID,
    releaseId,
    buildHash: BUILD_HASH,
    slug: SLUG,
    canonicalHost: HOST,
    expectedGeneration: 0,
    environment: "test",
    env: ENV,
    files: files(),
    routes: publisherInput().routeMap,
  });
  const identity = { siteId: SITE_ID, releaseId, buildHash: BUILD_HASH, generation: 1 };
  const base = {
    previewUrl: `https://${HOST}/`,
    ...identity,
    manifest: prepared.manifest,
    preparedFiles: prepared.preparedFiles,
  };
  const badHeader = createPublicReleaseVerifier({
    async fetchImpl(url) {
      return publicResponse(url, prepared.preparedFiles.get("index.html").body, identity, {
        "x-wss-release-id": "22222222-2222-4222-8222-222222222222",
      });
    },
  });
  const headerResult = await badHeader(base);
  assert.equal(headerResult.reason, "shared_public_identity_header_mismatch");
  assert.equal(headerResult.detail.header, "x-wss-release-id");

  const badBytes = createPublicReleaseVerifier({
    async fetchImpl(url) { return publicResponse(url, Buffer.from("tampered"), identity); },
  });
  assert.equal((await badBytes(base)).reason, "shared_public_body_mismatch");
});

test("public verifier deadline bounds a response body that never resolves", async () => {
  const releaseId = deterministicReleaseUuid({ siteId: SITE_ID, operationKey: OPERATION_KEY, buildHash: BUILD_HASH });
  const prepared = prepareRelease({
    siteId: SITE_ID,
    releaseId,
    buildHash: BUILD_HASH,
    slug: SLUG,
    canonicalHost: HOST,
    expectedGeneration: 0,
    environment: "test",
    env: ENV,
    files: files(),
    routes: publisherInput().routeMap,
  });
  const identity = { siteId: SITE_ID, releaseId, buildHash: BUILD_HASH, generation: 1 };
  const verifier = createPublicReleaseVerifier({
    async fetchImpl(url) {
      return {
        ...publicResponse(url, Buffer.alloc(0), identity),
        arrayBuffer() { return new Promise(() => {}); },
      };
    },
  });
  const startedAt = Date.now();
  const result = await verifier({
    previewUrl: `https://${HOST}/`,
    ...identity,
    manifest: prepared.manifest,
    preparedFiles: prepared.preparedFiles,
    deadlineAt: startedAt + 100,
  });
  assert.equal(result.reason, "shared_public_body_unreadable");
  assert.equal(result.detail.error, "shared_publish_deadline_exceeded");
  assert.ok(Date.now() - startedAt < 1000, "body deadline must resolve deterministically");
});

test("publisher never returns proof before public verification and re-verifies active retries", async () => {
  const refusedRegistry = fakeRegistry();
  let publicRefused = true;
  const firstPublisher = createSharedSitePublisher({
    registry: refusedRegistry,
    storage: memoryStorage(),
    env: ENV,
    ensureSharedSiteHost: ENSURE_HOST_OK,
    publicVerifier: async () => publicRefused
      ? { ok: false, reason: "router_not_converged" }
      : { ok: true },
  });
  const refused = await firstPublisher.publish(publisherInput());
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "shared_release_public_verification_failed");
  assert.equal(refused.fallback, false);
  assert.equal(Object.hasOwn(refused, "proofIdentity"), false);
  assert.equal(Object.hasOwn(refused, "previewUrl"), false);
  assert.equal(refused.reconciliationRequired, undefined);
  assert.equal(refused.detail.rollback.ok, true);
  assert.equal(refused.detail.rollback.action, "quarantine");
  assert.equal(refused.detail.rollback.generation, 2);
  assert.equal(refusedRegistry.state.generation, 2);
  assert.equal(refusedRegistry.state.active, null);
  assert.equal(refusedRegistry.state.previous, null);
  assert.equal(refusedRegistry.state.serveMode, "legacy");
  assert.equal(refusedRegistry.state.releases.get(refused.detail.rollback.releaseId).state, "revoked");
  assert.equal(refusedRegistry.state.calls.filter(([kind]) => kind === "rollback").length, 0);
  assert.equal(refusedRegistry.state.calls.filter(([kind]) => kind === "quarantine").length, 1);

  const activations = refusedRegistry.state.calls.filter(([kind]) => kind === "activate").length;
  const sameFailedRelease = await firstPublisher.publish(publisherInput());
  assert.equal(sameFailedRelease.ok, false, "a revoked deterministic release cannot be resurrected");
  assert.equal(refusedRegistry.state.calls.filter(([kind]) => kind === "activate").length, activations);
  const secondRefused = await firstPublisher.publish(publisherInput({
    buildHash: "9".repeat(64),
    operationKey: `${OPERATION_KEY}:after-quarantine`,
  }));
  assert.equal(secondRefused.reason, "shared_release_public_verification_failed");
  assert.equal(secondRefused.detail.rollback.action, "quarantine");
  assert.equal(secondRefused.detail.rollback.generation, 4);
  assert.equal(refusedRegistry.state.active, null);
  assert.equal(refusedRegistry.state.generation, 4);
  assert.equal(refusedRegistry.state.releases.get(secondRefused.detail.rollback.releaseId).state, "revoked");

  publicRefused = false;
  const replacement = await firstPublisher.publish(publisherInput({
    buildHash: "8".repeat(64),
    operationKey: `${OPERATION_KEY}:after-second-quarantine`,
  }));
  assert.equal(replacement.ok, true, JSON.stringify(replacement));
  assert.equal(replacement.generation, 5, "restaging advances from quarantine generations without ABA");

  let verifies = 0;
  const publisher = createSharedSitePublisher({
    registry: fakeRegistry(),
    storage: memoryStorage(),
    env: ENV,
    ensureSharedSiteHost: ENSURE_HOST_OK,
    publicVerifier: async () => { verifies += 1; return { ok: true }; },
  });
  assert.equal((await publisher.publish(publisherInput())).ok, true);
  assert.equal((await publisher.publish(publisherInput())).ok, true);
  assert.equal(verifies, 2, "durable DB replay still proves the current public router");
});

test("public verification failure restores the exact prior active release with rollback CAS", async () => {
  const registry = fakeRegistry();
  const publicGenerations = [];
  const publisher = createSharedSitePublisher({
    registry,
    storage: memoryStorage(),
    env: ENV,
    ensureSharedSiteHost: ENSURE_HOST_OK,
    publicVerifier: async ({ buildHash, generation }) => {
      publicGenerations.push([buildHash, generation]);
      return buildHash === "b".repeat(64)
        ? { ok: false, reason: "router_not_converged" }
        : { ok: true, routes: ["/"] };
    },
  });
  const first = await publisher.publish(publisherInput());
  assert.equal(first.ok, true, JSON.stringify(first));
  const prior = { ...registry.state.active };

  const refused = await publisher.publish(publisherInput({
    buildHash: "b".repeat(64),
    operationKey: `${OPERATION_KEY}:replacement`,
  }));

  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "shared_release_public_verification_failed");
  assert.equal(refused.reconciliationRequired, undefined);
  assert.deepEqual(refused.detail.rollback, {
    ok: true,
    releaseId: first.releaseId,
    generation: 3,
    routeGeneration: 1,
  });
  assert.deepEqual(registry.state.active, prior);
  assert.equal(registry.state.generation, 3);
  assert.equal(registry.state.active.routeGeneration, 1);
  assert.deepEqual(
    registry.state.calls.filter(([kind]) => kind === "rollback"),
    [["rollback", first.releaseId, 2]],
  );
  assert.equal(Object.hasOwn(refused, "proofIdentity"), false);
  assert.equal(Object.hasOwn(refused, "previewUrl"), false);

  const restored = await publisher.verifyActiveRelease({
    proofIdentity: first.proofIdentity,
    releaseEvidence: first.releaseEvidence,
    previewUrl: first.previewUrl,
  });
  assert.equal(restored.ok, true, JSON.stringify(restored));
  assert.equal(restored.generation, 1, "public proof remains bound to immutable A generation");
  assert.deepEqual(publicGenerations.at(-1), [BUILD_HASH, 1]);

  const activationsBeforeReplay = registry.state.calls.filter(([kind]) => kind === "activate").length;
  const replayStage = await publisher.stage(publisherInput());
  assert.equal(replayStage.currentGeneration, 3, "staging retains the monotonic internal CAS generation");
  assert.equal(replayStage.expectedGeneration, 3);
  assert.equal(replayStage.predictedGeneration, 1, "active replay predicts the immutable route generation");
  const replay = await publisher.activate(replayStage);
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.generation, 1, "exact A replay emits the immutable route generation");
  assert.equal(registry.state.generation, 3, "exact replay never rewinds or increments CAS generation");
  assert.equal(
    registry.state.calls.filter(([kind]) => kind === "activate").length,
    activationsBeforeReplay,
  );

  const fresh = await publisher.publish(publisherInput({
    buildHash: "c".repeat(64),
    operationKey: `${OPERATION_KEY}:fresh-after-rollback`,
  }));
  assert.equal(fresh.ok, true, JSON.stringify(fresh));
  assert.equal(fresh.generation, 4);
  assert.equal(fresh.releaseEvidence.route_generation, 4);
  assert.equal(registry.state.generation, 4, "fresh C advances the internal CAS generation");
  assert.equal(registry.state.active.routeGeneration, 4, "fresh C public route generation matches its immutable manifest");
  assert.deepEqual(publicGenerations.at(-1), ["c".repeat(64), 4]);
});

test("first-release quarantine conflict is an explicit reconciliation failure", async () => {
  const registry = fakeRegistry({ quarantineConflict: true });
  const refused = await createSharedSitePublisher({
    registry,
    storage: memoryStorage(),
    env: ENV,
    ensureSharedSiteHost: ENSURE_HOST_OK,
    publicVerifier: async () => ({ ok: false, reason: "router_not_converged" }),
  }).publish(publisherInput());

  assert.equal(refused.reason, "shared_release_public_verification_failed");
  assert.equal(refused.reconciliationRequired, true);
  assert.equal(refused.detail.rollback.action, "quarantine");
  assert.equal(refused.detail.rollback.reason, "quarantine_release_cas_refused");
  assert.equal(refused.detail.rollback.detail.reason, "generation_conflict");
  assert.equal(registry.state.generation, 1);
  assert.ok(registry.state.active, "failed compensation must report the still-active release");
  assert.equal(registry.state.releases.get(registry.state.active.releaseId).state, "active");
  assert.equal(registry.state.calls.filter(([kind]) => kind === "quarantine").length, 1);
});

test("rollback CAS conflict is an explicit reconciliation failure and cannot overwrite the active tuple", async () => {
  const registry = fakeRegistry({ rollbackConflict: true });
  const publisher = createSharedSitePublisher({
    registry,
    storage: memoryStorage(),
    env: ENV,
    ensureSharedSiteHost: ENSURE_HOST_OK,
    publicVerifier: async ({ buildHash }) => buildHash === BUILD_HASH
      ? { ok: true }
      : { ok: false, reason: "router_not_converged" },
  });
  const first = await publisher.publish(publisherInput());
  assert.equal(first.ok, true, JSON.stringify(first));

  const refused = await publisher.publish(publisherInput({
    buildHash: "c".repeat(64),
    operationKey: `${OPERATION_KEY}:rollback-conflict`,
  }));

  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "shared_release_public_verification_failed");
  assert.equal(refused.reconciliationRequired, true);
  assert.equal(refused.detail.rollback.ok, false);
  assert.equal(refused.detail.rollback.reason, "rollback_release_cas_refused");
  assert.equal(refused.detail.rollback.detail.reason, "generation_conflict");
  assert.notEqual(registry.state.active.releaseId, first.releaseId);
  assert.equal(registry.state.generation, 2);
  assert.equal(registry.state.calls.filter(([kind]) => kind === "rollback").length, 1);
});

test("an idempotent concurrent activation is never rolled back by a verifier that did not own it", async () => {
  const registry = fakeRegistry();
  const publisher = createSharedSitePublisher({
    registry,
    storage: memoryStorage(),
    env: ENV,
    ensureSharedSiteHost: ENSURE_HOST_OK,
    publicVerifier: async ({ buildHash }) => buildHash === BUILD_HASH
      ? { ok: true }
      : { ok: false, reason: "router_not_converged" },
  });
  assert.equal((await publisher.publish(publisherInput())).ok, true);
  const staged = await publisher.stage(publisherInput({
    buildHash: "d".repeat(64),
    operationKey: `${OPERATION_KEY}:concurrent`,
  }));
  assert.equal(staged.ok, true, JSON.stringify(staged));
  const concurrent = await registry.activateReleaseCas({
    releaseId: staged.releaseId,
    expectedGeneration: staged.currentGeneration,
    environment: "test",
  });
  assert.equal(concurrent.ok, true);
  const concurrentlyActive = { ...registry.state.active };
  const rollbackCalls = registry.state.calls.filter(([kind]) => kind === "rollback").length;

  const refused = await publisher.activate(staged);

  assert.equal(refused.reason, "shared_release_public_verification_failed");
  assert.equal(refused.reconciliationRequired, true);
  assert.equal(refused.detail.rollback.reason, "shared_release_activation_not_owned");
  assert.deepEqual(registry.state.active, concurrentlyActive);
  assert.equal(registry.state.calls.filter(([kind]) => kind === "rollback").length, rollbackCalls);
});

test("a hanging public body leaves enough deadline budget to restore the prior active release", async () => {
  const registry = fakeRegistry();
  let currentVerification = null;
  let hangBody = false;
  const exactVerifier = createPublicReleaseVerifier({
    async fetchImpl(url) {
      const input = currentVerification;
      const route = new URL(url).pathname;
      const target = input.manifest.routes[route];
      const response = publicResponse(url, input.preparedFiles.get(target).body, {
        siteId: input.siteId,
        releaseId: input.releaseId,
        buildHash: input.buildHash,
        generation: input.generation,
      });
      if (hangBody) response.arrayBuffer = () => new Promise(() => {});
      return response;
    },
  });
  const publisher = createSharedSitePublisher({
    registry,
    storage: memoryStorage(),
    env: ENV,
    ensureSharedSiteHost: ENSURE_HOST_OK,
    async publicVerifier(input) {
      currentVerification = input;
      try {
        return await exactVerifier(input);
      } finally {
        currentVerification = null;
      }
    },
  });
  const first = await publisher.publish(publisherInput());
  assert.equal(first.ok, true, JSON.stringify(first));
  const prior = { ...registry.state.active };
  hangBody = true;
  const startedAt = Date.now();

  const refused = await publisher.publish(publisherInput({
    buildHash: "e".repeat(64),
    operationKey: `${OPERATION_KEY}:hanging-public-body`,
    deadlineAt: startedAt + 400,
  }));

  assert.equal(refused.reason, "shared_release_public_verification_failed");
  assert.equal(refused.detail.reason, "shared_publish_deadline_exceeded");
  assert.equal(refused.detail.rollback.ok, true);
  assert.equal(refused.detail.rollback.releaseId, first.releaseId);
  assert.deepEqual(registry.state.active, prior);
  assert.equal(registry.state.generation, 3);
  assert.ok(Date.now() - startedAt < 1000, "rollback must finish inside the overall route deadline");
});

test("an activation response timeout is explicit reconciliation, never silent success or rollback", async () => {
  const registry = fakeRegistry();
  let publicChecks = 0;
  const publisher = createSharedSitePublisher({
    registry,
    storage: memoryStorage(),
    env: ENV,
    ensureSharedSiteHost: ENSURE_HOST_OK,
    publicVerifier: async () => { publicChecks += 1; return { ok: true }; },
  });
  assert.equal((await publisher.publish(publisherInput())).ok, true);
  const staged = await publisher.stage(publisherInput({
    buildHash: "f".repeat(64),
    operationKey: `${OPERATION_KEY}:activation-timeout`,
  }));
  assert.equal(staged.ok, true, JSON.stringify(staged));
  const realActivate = registry.activateReleaseCas.bind(registry);
  registry.activateReleaseCas = async (args) => {
    const committed = await realActivate(args);
    if (args.releaseId === staged.releaseId && committed.ok) return new Promise(() => {});
    return committed;
  };
  const checksBefore = publicChecks;
  const startedAt = Date.now();

  const refused = await publisher.activate(staged, { deadlineAt: startedAt + 300 });

  assert.equal(refused.reason, "shared_publish_deadline_exceeded");
  assert.equal(refused.reconciliationRequired, true);
  assert.deepEqual(refused.detail.activation, { outcome: "requested_release_active" });
  assert.equal(registry.state.active.releaseId, staged.releaseId);
  assert.equal(registry.state.calls.filter(([kind]) => kind === "rollback").length, 0);
  assert.equal(publicChecks, checksBefore, "public proof must not run after an ambiguous CAS response");
  assert.ok(Date.now() - startedAt < 1000, "ambiguity readback must remain deadline bounded");
});

test("optional hero child release binds the exact parent generation and immutable video", async () => {
  const registry = fakeRegistry();
  const storage = memoryStorage();
  const publisher = testPublisher({ registry, storage, env: ENV });
  assert.equal(publisher.supportsExpectedGenerationCas, true);
  const parent = await publisher.publish(publisherInput());
  assert.equal(parent.ok, true);

  const hero = Buffer.from("verified-hero-video-bytes");
  const heroPath = "assets/hero.mp4";
  const childFiles = { ...files(), [heroPath]: hero };
  const child = await publisher.publish(publisherInput({
    files: childFiles,
    routeMap: { ...publisherInput().routeMap, "/assets/hero.mp4": heroPath },
    buildHash: "b".repeat(64),
    operationKey: `${OPERATION_KEY}:hero`,
    parentReleaseId: parent.releaseId,
    expectedGeneration: parent.generation,
    heroVideoPath: heroPath,
    heroVideoSha256: sha256(hero),
  }));
  assert.equal(child.ok, true, JSON.stringify(child));
  assert.equal(child.generation, 2);
  assert.equal(child.releaseEvidence.hero_video_path, heroPath);
  assert.equal(child.releaseEvidence.hero_video_sha256, sha256(hero));

  const loaded = await publisher.loadActiveRelease({
    proofIdentity: child.proofIdentity,
    releaseEvidence: child.releaseEvidence,
  });
  assert.equal(loaded.ok, true, JSON.stringify(loaded));
  assert.deepEqual(loaded.files[heroPath], hero);

  const stages = registry.state.calls.filter(([kind]) => kind === "stage").length;
  const stale = await publisher.publish(publisherInput({
    files: childFiles,
    routeMap: { ...publisherInput().routeMap, "/assets/hero.mp4": heroPath },
    buildHash: "c".repeat(64),
    operationKey: `${OPERATION_KEY}:stale-hero`,
    parentReleaseId: parent.releaseId,
    expectedGeneration: parent.generation,
    heroVideoPath: heroPath,
    heroVideoSha256: sha256(hero),
  }));
  assert.equal(stale.reason, "shared_release_parent_cas_mismatch");
  assert.equal(registry.state.calls.filter(([kind]) => kind === "stage").length, stages);
});

test("hero binding refuses mismatched bytes before registry I/O", async () => {
  const registry = fakeRegistry();
  const heroPath = "assets/hero.mp4";
  const result = await testPublisher({ registry, storage: memoryStorage(), env: ENV }).publish(publisherInput({
    files: { ...files(), [heroPath]: Buffer.from("actual") },
    heroVideoPath: heroPath,
    heroVideoSha256: sha256(Buffer.from("different")),
  }));
  assert.equal(result.reason, "shared_release_hero_binding_invalid");
  assert.equal(registry.state.calls.length, 0);
});

test("partial retry reuses only byte-identical insert-only objects", async () => {
  const registry = fakeRegistry();
  const storage = memoryStorage();
  let firstActivation = true;
  const realActivate = registry.activateReleaseCas.bind(registry);
  registry.activateReleaseCas = async (row) => {
    if (firstActivation) {
      firstActivation = false;
      registry.state.calls.push(["activate-refused", row.releaseId]);
      return { ok: false, reason: "generation_conflict" };
    }
    return realActivate(row);
  };
  const publisher = testPublisher({ registry, storage, env: ENV });
  const first = await publisher.publish(publisherInput());
  assert.equal(first.ok, false);
  assert.equal(first.reason, "shared_release_activation_refused");
  const putsAfterFirst = storage.calls.filter(([kind]) => kind === "put").length;
  const immutableSnapshot = new Map([...storage.objects].map(([key, body]) => [key, Buffer.from(body)]));

  const second = await publisher.publish(publisherInput());
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(storage.calls.filter(([kind]) => kind === "put").length, putsAfterFirst + 3, "retry repeats insert-only writes");
  assert.deepEqual(storage.objects, immutableSnapshot, "duplicate responses never overwrite immutable bytes");
  assert.equal(registry.state.calls.filter(([kind]) => kind === "stage").length, 2, "stage RPC handles exact replay");
});

test("active release loader returns the complete verified tree and route map", async () => {
  const registry = fakeRegistry();
  const storage = memoryStorage();
  const publisher = testPublisher({ registry, storage, env: ENV });
  const published = await publisher.publish(publisherInput());
  assert.equal(published.ok, true, JSON.stringify(published));

  const loaded = await publisher.loadActiveRelease({
    proofIdentity: published.proofIdentity,
    releaseEvidence: published.releaseEvidence,
  });
  assert.equal(loaded.ok, true, JSON.stringify(loaded));
  assert.equal(loaded.fallback, false);
  assert.equal(loaded.slug, SLUG);
  assert.equal(loaded.host, HOST);
  assert.equal(loaded.buildHash, BUILD_HASH);
  assert.deepEqual({ ...loaded.routeMap }, publisherInput().routeMap);
  assert.deepEqual(Object.keys(loaded.files).sort(), ["assets/app.css", "index.html"]);
  assert.equal(loaded.files["index.html"].toString("utf8"), files()["index.html"].toString("utf8"));
  assert.equal(loaded.files["assets/app.css"].toString("utf8"), files()["assets/app.css"].toString("utf8"));
});

test("active loader deadlines bound both manifest and immutable file bodies", async () => {
  const registry = fakeRegistry();
  const stored = memoryStorage();
  let hangingSuffix = "";
  const storage = {
    putObjectIfAbsent: stored.putObjectIfAbsent.bind(stored),
    async readObject(args) {
      const read = await stored.readObject(args);
      if (read.found && hangingSuffix && args.key.endsWith(hangingSuffix)) {
        return {
          ok: true,
          found: true,
          body: { arrayBuffer() { return new Promise(() => {}); } },
        };
      }
      return read;
    },
  };
  const publisher = testPublisher({ registry, storage, env: ENV });
  const published = await publisher.publish(publisherInput());
  assert.equal(published.ok, true, JSON.stringify(published));

  hangingSuffix = "/manifest.json";
  const manifestDeadline = await publisher.loadActiveRelease({
    proofIdentity: published.proofIdentity,
    releaseEvidence: published.releaseEvidence,
    deadlineAt: Date.now() + 100,
  });
  assert.equal(manifestDeadline.reason, "shared_publish_deadline_exceeded");

  hangingSuffix = "/files/assets/app.css";
  const fileDeadline = await publisher.loadActiveRelease({
    proofIdentity: published.proofIdentity,
    releaseEvidence: published.releaseEvidence,
    deadlineAt: Date.now() + 100,
  });
  assert.equal(fileDeadline.reason, "shared_publish_deadline_exceeded");
  assert.equal(registry.state.calls.filter(([kind]) => kind === "activate").length, 1);
  assert.equal(registry.state.calls.filter(([kind]) => kind === "rollback").length, 0);
});

test("active release verifier re-reads the exact release and public router without writes", async () => {
  const registry = fakeRegistry();
  const storage = memoryStorage();
  const publicCalls = [];
  const publisher = testPublisher({
    registry,
    storage,
    env: ENV,
    async publicVerifier(input) {
      publicCalls.push(input);
      return { ok: true, fallback: false, routes: ["/", "/assets/app.css"] };
    },
  });
  const published = await publisher.publish(publisherInput());
  assert.equal(published.ok, true, JSON.stringify(published));
  publicCalls.length = 0;
  const registryWritesBefore = registry.state.calls.filter(([kind]) => kind === "stage" || kind === "activate").length;
  const storageWritesBefore = storage.calls.filter(([kind]) => kind === "put").length;

  const verified = await publisher.verifyActiveRelease({
    proofIdentity: published.proofIdentity,
    releaseEvidence: published.releaseEvidence,
    previewUrl: published.previewUrl,
  });

  assert.deepEqual(verified, {
    ok: true,
    fallback: false,
    previewUrl: `https://${HOST}/`,
    siteId: SITE_ID,
    releaseId: published.releaseId,
    buildHash: BUILD_HASH,
    generation: 1,
    routes: ["/", "/assets/app.css"],
  });
  assert.equal(publicCalls.length, 1);
  assert.equal(publicCalls[0].previewUrl, published.previewUrl);
  assert.equal(publicCalls[0].manifest.site_id, SITE_ID);
  assert.equal(publicCalls[0].manifest.release_id, published.releaseId);
  assert.equal(publicCalls[0].manifest.build_hash, BUILD_HASH);
  assert.equal(publicCalls[0].manifest.route_generation, published.generation);
  assert.equal(publicCalls[0].preparedFiles.get("index.html").sha256, sha256(files()["index.html"]));
  assert.equal(
    registry.state.calls.filter(([kind]) => kind === "stage" || kind === "activate").length,
    registryWritesBefore,
    "fresh verification must not stage or activate",
  );
  assert.equal(
    storage.calls.filter(([kind]) => kind === "put").length,
    storageWritesBefore,
    "fresh verification must not write immutable objects",
  );
});

test("active release verifier refuses stale registry state before any public request", async () => {
  const registry = fakeRegistry();
  const storage = memoryStorage();
  let publicCalls = 0;
  const publisher = testPublisher({
    registry,
    storage,
    env: ENV,
    async publicVerifier() {
      publicCalls += 1;
      return { ok: true, routes: ["/"] };
    },
  });
  const published = await publisher.publish(publisherInput());
  assert.equal(published.ok, true, JSON.stringify(published));
  publicCalls = 0;
  registry.state.generation += 1;
  registry.state.active = {
    ...registry.state.active,
    releaseId: "33333333-3333-4333-8333-333333333333",
  };

  const stale = await publisher.verifyActiveRelease({
    proofIdentity: published.proofIdentity,
    releaseEvidence: published.releaseEvidence,
    previewUrl: published.previewUrl,
  });

  assert.equal(stale.ok, false);
  assert.equal(stale.reason, "shared_active_public_verification_failed");
  assert.equal(stale.detail.stage, "active_release");
  assert.equal(stale.detail.reason, "shared_release_not_current_active");
  assert.equal(publicCalls, 0, "a reassigned active tuple must fail before touching the public host");
});

test("active release verifier refuses a stale or reassigned public host", async () => {
  const registry = fakeRegistry();
  const storage = memoryStorage();
  let publicMode = "current";
  let publicCalls = 0;
  const publisher = testPublisher({
    registry,
    storage,
    env: ENV,
    async publicVerifier() {
      publicCalls += 1;
      return publicMode === "current"
        ? { ok: true, routes: ["/"] }
        : {
            ok: false,
            fallback: false,
            reason: "shared_public_identity_header_mismatch",
            detail: { route: "/", header: "x-wss-release-id" },
          };
    },
  });
  const published = await publisher.publish(publisherInput());
  assert.equal(published.ok, true, JSON.stringify(published));
  publicMode = "reassigned";
  publicCalls = 0;
  const writesBefore = storage.calls.filter(([kind]) => kind === "put").length;

  const reassigned = await publisher.verifyActiveRelease({
    proofIdentity: published.proofIdentity,
    releaseEvidence: published.releaseEvidence,
    previewUrl: published.previewUrl,
  });
  assert.equal(reassigned.ok, false);
  assert.equal(reassigned.reason, "shared_active_public_verification_failed");
  assert.equal(reassigned.detail.stage, "public");
  assert.equal(reassigned.detail.reason, "shared_public_identity_header_mismatch");
  assert.deepEqual(reassigned.detail.publicDetail, {
    route: "/",
    header: "x-wss-release-id",
  });
  assert.equal(publicCalls, 1);
  assert.equal(storage.calls.filter(([kind]) => kind === "put").length, writesBefore);

  publicCalls = 0;
  const wrongHost = await publisher.verifyActiveRelease({
    proofIdentity: published.proofIdentity,
    releaseEvidence: published.releaseEvidence,
    previewUrl: "https://other.wss-ai.com/",
  });
  assert.equal(wrongHost.ok, false);
  assert.equal(wrongHost.detail.stage, "active_release");
  assert.equal(wrongHost.detail.reason, "shared_public_preview_identity_mismatch");
  assert.equal(publicCalls, 0, "an alternate API-supplied host must not be probed");
});

test("active release loader refuses stale identity and tampered immutable bytes", async () => {
  const registry = fakeRegistry();
  const storage = memoryStorage();
  const publisher = testPublisher({ registry, storage, env: ENV });
  const published = await publisher.publish(publisherInput());
  const stale = await publisher.loadActiveRelease({
    proofIdentity: published.proofIdentity,
    releaseEvidence: { ...published.releaseEvidence, generation: 2, route_generation: 2 },
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, "shared_release_not_current_active");

  const cssKey = [...storage.objects.keys()].find((key) => key.endsWith("/files/assets/app.css"));
  storage.objects.set(cssKey, Buffer.from("tampered"));
  const tampered = await publisher.loadActiveRelease({
    proofIdentity: published.proofIdentity,
    releaseEvidence: published.releaseEvidence,
  });
  assert.equal(tampered.ok, false);
  assert.equal(tampered.reason, "shared_release_file_readback_mismatch");
  assert.equal(tampered.detail.rel, "assets/app.css");
  assert.equal(tampered.fallback, false);
});

test("tampered readback never verifies or activates the staged release", async () => {
  const registry = fakeRegistry();
  const stored = memoryStorage();
  let inserted = false;
  const storage = {
    async putObjectIfAbsent(args) {
      inserted = true;
      return stored.putObjectIfAbsent(args);
    },
    async readObject(args) {
      const result = await stored.readObject(args);
      if (inserted && args.key.endsWith("/files/assets/app.css") && result.found) {
        return { ok: true, found: true, body: Buffer.from("tampered") };
      }
      return result;
    },
  };
  const result = await testPublisher({ registry, storage, env: ENV }).publish(publisherInput());
  assert.equal(result.ok, false);
  assert.equal(result.reason, "release_object_readback_mismatch");
  assert.equal(result.fallback, false);
  assert.equal(registry.state.calls.filter(([kind]) => kind === "verify").length, 0);
  assert.equal(registry.state.calls.filter(([kind]) => kind === "activate").length, 0);
  assert.equal(registry.state.generation, 0);
});

test("CAS conflict with a different active state fails closed", async () => {
  const registry = fakeRegistry({ activationConflict: true });
  const result = await testPublisher({ registry, storage: memoryStorage(), env: ENV })
    .publish(publisherInput());
  assert.equal(result.ok, false);
  assert.equal(result.reason, "shared_release_activation_refused");
  assert.equal(result.detail.reason, "generation_conflict");
  assert.equal(result.fallback, false);
  assert.equal(registry.state.active, null);
});

test("object insert refusal leaves no partially active public route", async () => {
  const registry = fakeRegistry();
  let puts = 0;
  let active = 0;
  let settled = 0;
  const storage = {
    async readObject() { return { ok: true, found: false }; },
    async putObjectIfAbsent() {
      puts += 1;
      active += 1;
      await new Promise(resolve => setTimeout(resolve, 8));
      active -= 1;
      settled += 1;
      return { ok: false, reason: "provider_refused" };
    },
  };
  const result = await testPublisher({ registry, storage, env: ENV }).publish(publisherInput());
  assert.equal(result.ok, false);
  assert.equal(result.reason, "release_object_insert_refused");
  assert.equal(puts, Math.min(4, Object.keys(publisherInput().files).length), "only the bounded initial wave starts");
  assert.equal(active, 0, "all in-flight inserts settle before failure returns");
  assert.equal(settled, puts);
  assert.equal(registry.state.calls.filter(([kind]) => kind === "verify").length, 0);
  assert.equal(registry.state.calls.filter(([kind]) => kind === "activate").length, 0);
  assert.equal(registry.state.generation, 0);
});

test("publisher refuses invalid inputs and disabled lane before registry or storage I/O", async () => {
  let calls = 0;
  const registry = new Proxy({}, { get() { return async () => { calls += 1; return { ok: true }; }; } });
  const storage = new Proxy({}, { get() { return async () => { calls += 1; return { ok: true }; }; } });
  const enabled = testPublisher({ registry, storage, env: ENV });
  assert.equal((await enabled.publish(publisherInput({ host: "other.wss-ai.com" }))).reason, "shared_site_host_mismatch");
  assert.equal((await enabled.publish(publisherInput({ operationKey: "" }))).reason, "invalid_operation_key");
  const disabled = testPublisher({
    registry,
    storage,
    env: { ...ENV, WSS_SHARED_PUBLISH_ENABLED: "0" },
  });
  assert.equal((await disabled.publish(publisherInput())).reason, "shared_publish_disabled");
  assert.equal(calls, 0);
});

test("abort and deadline stop the lane before activation", async () => {
  const registry = fakeRegistry();
  const storage = memoryStorage();
  const publisher = testPublisher({ registry, storage, env: ENV, now: () => 1000 });
  const preAborted = new AbortController();
  preAborted.abort();
  assert.equal(
    (await publisher.publish(publisherInput({ signal: preAborted.signal }))).reason,
    "shared_publish_aborted",
  );
  assert.equal(
    (await publisher.publish(publisherInput({ deadlineAt: 999 }))).reason,
    "shared_publish_deadline_exceeded",
  );
  assert.equal(registry.state.calls.length, 0);

  const duringUpload = new AbortController();
  const abortingStorage = memoryStorage();
  const put = abortingStorage.putObjectIfAbsent.bind(abortingStorage);
  abortingStorage.putObjectIfAbsent = async (args) => {
    const result = await put(args);
    duringUpload.abort();
    return result;
  };
  const midflightRegistry = fakeRegistry();
  const stopped = await testPublisher({ registry: midflightRegistry, storage: abortingStorage, env: ENV })
    .publish(publisherInput({ signal: duringUpload.signal }));
  assert.equal(stopped.reason, "shared_publish_aborted");
  assert.equal(midflightRegistry.state.calls.filter(([kind]) => kind === "verify").length, 0);
  assert.equal(midflightRegistry.state.calls.filter(([kind]) => kind === "activate").length, 0);
});

test("private readback deadline bounds a storage body that never resolves", async () => {
  const registry = fakeRegistry();
  const stored = memoryStorage();
  const storage = {
    putObjectIfAbsent: stored.putObjectIfAbsent.bind(stored),
    async readObject(args) {
      const read = await stored.readObject(args);
      if (!read.found) return read;
      return {
        ok: true,
        found: true,
        body: { arrayBuffer() { return new Promise(() => {}); } },
      };
    },
  };
  const startedAt = Date.now();
  const result = await testPublisher({ registry, storage, env: ENV }).publish(publisherInput({
    deadlineAt: startedAt + 100,
  }));
  assert.equal(result.reason, "shared_publish_deadline_exceeded");
  assert.ok(Date.now() - startedAt < 1000, "private body deadline must resolve deterministically");
  assert.equal(registry.state.calls.filter(([kind]) => kind === "verify").length, 0);
  assert.equal(registry.state.calls.filter(([kind]) => kind === "activate").length, 0);
  assert.equal(registry.state.calls.filter(([kind]) => kind === "rollback").length, 0);
});

test("release UUID is deterministic, operation-bound, and a valid RFC UUIDv8", () => {
  const one = deterministicReleaseUuid({ siteId: SITE_ID, operationKey: OPERATION_KEY, buildHash: BUILD_HASH });
  const repeat = deterministicReleaseUuid({ siteId: SITE_ID, operationKey: OPERATION_KEY, buildHash: BUILD_HASH });
  const other = deterministicReleaseUuid({ siteId: SITE_ID, operationKey: `${OPERATION_KEY}:2`, buildHash: BUILD_HASH });
  assert.equal(one, repeat);
  assert.notEqual(one, other);
  assert.match(one, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("registry adapter maps identity, generation, and release transitions to exact RPC arguments", async () => {
  const calls = [];
  const adapter = createSharedSiteRegistryAdapter({
    async rpc(name, args) {
      calls.push([name, args]);
      return { data: { ok: true, generation: 0 }, error: null };
    },
  });
  await adapter.ensureSiteIdentity({ slug: SLUG, host: HOST });
  await adapter.readSiteGeneration({ siteId: SITE_ID, slug: SLUG, host: HOST });
  await adapter.activateReleaseCas({
    siteId: SITE_ID,
    releaseId: "22222222-2222-4222-8222-222222222222",
    expectedGeneration: 0,
    environment: "test",
  });
  await adapter.quarantineReleaseCas({
    siteId: SITE_ID,
    releaseId: "22222222-2222-4222-8222-222222222222",
    expectedGeneration: 1,
    environment: "test",
  });
  const expiresAt = "2033-05-18T03:37:20.000Z";
  await adapter.registerPreviewGrant({
    jtiHash: "e".repeat(64),
    siteId: SITE_ID,
    releaseId: "22222222-2222-4222-8222-222222222222",
    buildHash: BUILD_HASH,
    environment: "test",
    expiresAt,
  });
  assert.deepEqual(calls[0], ["ensure_shared_site_identity", {
    p_canonical_slug: SLUG,
    p_normalized_host: HOST,
  }]);
  assert.deepEqual(calls[1], ["read_shared_site_generation", {
    p_site_id: SITE_ID,
    p_canonical_slug: SLUG,
    p_normalized_host: HOST,
  }]);
  assert.equal(calls[2][0], "activate_site_release");
  assert.deepEqual(calls[3], ["quarantine_site_release", {
    p_site_id: SITE_ID,
    p_expected_generation: 1,
    p_failed_release_id: "22222222-2222-4222-8222-222222222222",
    p_deployment_env: "test",
  }]);
  assert.deepEqual(calls[4], ["register_site_preview_grant", {
    p_jti_hash: "e".repeat(64),
    p_site_id: SITE_ID,
    p_release_id: "22222222-2222-4222-8222-222222222222",
    p_build_hash: BUILD_HASH,
    p_deployment_env: "test",
    p_expires_at: expiresAt,
  }]);
});

test("Supabase storage adapter uses private download and upload with upsert false", async () => {
  const objects = new Map();
  const calls = [];
  const supabase = {
    storage: {
      from(bucket) {
        assert.equal(bucket, "wss-site-releases");
        return {
          async exists(key) {
            calls.push(["exists", key]);
            return { data: objects.has(key), error: null };
          },
          async download(key) {
            calls.push(["download", key]);
            return { data: new Blob([objects.get(key)]), error: null };
          },
          async upload(key, body, options) {
            calls.push(["upload", key, options]);
            assert.equal(options.upsert, false);
            objects.set(key, Buffer.from(body));
            return { data: { path: key }, error: null };
          },
        };
      },
    },
  };
  const storage = createSupabaseReleaseStorageAdapter({ supabase });
  const key = "sites/site/releases/release/files/index.html";
  assert.deepEqual(await storage.readObject({ bucket: "wss-site-releases", key }), { ok: true, found: false });
  await storage.putObjectIfAbsent({
    bucket: "wss-site-releases",
    key,
    body: Buffer.from("hello"),
    contentType: "text/html; charset=utf-8",
    insertOnly: true,
  });
  const read = await storage.readObject({ bucket: "wss-site-releases", key });
  assert.equal(read.found, true);
  assert.equal(read.body.toString("utf8"), "hello");
  assert.deepEqual(calls.map(([kind]) => kind), ["exists", "upload", "exists", "download"]);
});

test("dependency-free production adapters call only exact private Supabase REST endpoints", async () => {
  const calls = [];
  const restEnv = {
    SUPABASE_URL: "https://project-ref.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "legacy-service-role-key-for-test",
  };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes("/rest/v1/rpc/")) {
      return { ok: true, status: 200, async json() { return { ok: true, generation: 0 }; } };
    }
    if (options.method === "GET") {
      return { ok: true, status: 200, async arrayBuffer() { return Buffer.from("stored"); } };
    }
    return { ok: true, status: 200 };
  };
  const rpc = createSupabaseRestRpc({ env: restEnv, fetchImpl });
  const rpcResult = await rpc("read_shared_site_generation", { p_site_id: SITE_ID });
  assert.deepEqual(rpcResult, { data: { ok: true, generation: 0 }, error: null });
  const storage = createSupabaseRestReleaseStorageAdapter({ env: restEnv, fetchImpl });
  const key = `sites/${SITE_ID}/releases/release/files/index.html`;
  await storage.putObjectIfAbsent({
    bucket: "wss-site-releases",
    key,
    body: Buffer.from("stored"),
    contentType: "text/html; charset=utf-8",
    insertOnly: true,
  });
  const read = await storage.readObject({ bucket: "wss-site-releases", key });
  assert.equal(read.body.toString("utf8"), "stored");
  assert.equal(calls[0].url, "https://project-ref.supabase.co/rest/v1/rpc/read_shared_site_generation");
  assert.equal(calls[1].options.headers["x-upsert"], "false");
  assert.match(calls[1].url, /\/storage\/v1\/object\/wss-site-releases\/sites\//);
  assert.equal(calls[2].options.method, "GET");
  assert.ok(calls.every((call) => call.options.headers.apikey === restEnv.SUPABASE_SERVICE_ROLE_KEY));
  assert.ok(calls.every((call) => call.options.headers.Authorization === `Bearer ${restEnv.SUPABASE_SERVICE_ROLE_KEY}`));
  assert.ok(calls.every((call) => !call.url.includes(restEnv.SUPABASE_SERVICE_ROLE_KEY)));
});

test("new sb_secret credentials are never copied into Authorization", async () => {
  const seen = [];
  const secret = "sb_secret_test-value-long-enough";
  const rpc = createSupabaseRestRpc({
    env: { SUPABASE_URL: "https://project-ref.supabase.co", SUPABASE_SERVICE_ROLE_KEY: secret },
    async fetchImpl(_url, options) {
      seen.push(options.headers);
      return { ok: true, status: 200, async json() { return { ok: true }; } };
    },
  });
  await rpc("ensure_shared_site_identity", {});
  assert.equal(seen[0].apikey, secret);
  assert.equal(Object.hasOwn(seen[0], "Authorization"), false);
});

// ROOT-CAUSE REGRESSION (zcode/active-release-rootcause, 2026-09-01): the
// Mirror Engine stamps every activated release's shared evidence with the
// hero pair (nulls when the donor declares no ladder) and, since 7a22d00,
// a hero_provenance annotation. loadActiveRelease's exact key-set refused
// those shapes, so every immutable-packet drain refused with
// owner_proof_public_release_unavailable even while the site served 200.
test("active release verifier accepts the engine's hero-annotated evidence (no hero ladder)", async () => {
  const registry = fakeRegistry();
  const storage = memoryStorage();
  const publisher = testPublisher({ registry, storage, env: ENV });
  const published = await publisher.publish(publisherInput());
  assert.equal(published.ok, true, JSON.stringify(published));

  const engineEvidence = {
    ...published.releaseEvidence,
    hero_video_path: null,
    hero_video_sha256: null,
    hero_provenance: null,
  };
  const verified = await publisher.verifyActiveRelease({
    proofIdentity: published.proofIdentity,
    releaseEvidence: engineEvidence,
    previewUrl: published.previewUrl,
  });
  assert.equal(verified.ok, true, JSON.stringify(verified));
  assert.equal(verified.releaseId, published.releaseId);
});

test("active release verifier accepts the engine's hero-annotated evidence (real hero binding)", async () => {
  const registry = fakeRegistry();
  const storage = memoryStorage();
  const publisher = testPublisher({ registry, storage, env: ENV });
  const hero = Buffer.from("verified-hero-video-bytes");
  const heroPath = "assets/hero.mp4";
  const published = await publisher.publish(publisherInput({
    files: { ...files(), [heroPath]: hero },
    routeMap: { ...publisherInput().routeMap, "/assets/hero.mp4": heroPath },
    operationKey: `${OPERATION_KEY}:hero-annotated`,
    heroVideoPath: heroPath,
    heroVideoSha256: sha256(hero),
  }));
  assert.equal(published.ok, true, JSON.stringify(published));

  const engineEvidence = {
    ...published.releaseEvidence,
    hero_provenance: "client_video",
  };
  const verified = await publisher.verifyActiveRelease({
    proofIdentity: published.proofIdentity,
    releaseEvidence: engineEvidence,
    previewUrl: published.previewUrl,
  });
  assert.equal(verified.ok, true, JSON.stringify(verified));
  assert.equal(verified.releaseId, published.releaseId);
});

test("engine hero annotation keeps refusing tampered or half-state bindings", async () => {
  const registry = fakeRegistry();
  const storage = memoryStorage();
  const publisher = testPublisher({ registry, storage, env: ENV });
  const hero = Buffer.from("verified-hero-video-bytes");
  const heroPath = "assets/hero.mp4";
  const published = await publisher.publish(publisherInput({
    files: { ...files(), [heroPath]: hero },
    routeMap: { ...publisherInput().routeMap, "/assets/hero.mp4": heroPath },
    operationKey: `${OPERATION_KEY}:hero-tamper`,
    heroVideoPath: heroPath,
    heroVideoSha256: sha256(hero),
  }));
  assert.equal(published.ok, true, JSON.stringify(published));

  // A mutated hero sha is not the release that was published.
  const tamperedSha = await publisher.verifyActiveRelease({
    proofIdentity: published.proofIdentity,
    releaseEvidence: {
      ...published.releaseEvidence,
      hero_provenance: "client_video",
      hero_video_sha256: sha256(Buffer.from("other-bytes")),
    },
    previewUrl: published.previewUrl,
  });
  assert.equal(tamperedSha.ok, false);
  assert.equal(tamperedSha.reason, "shared_active_public_verification_failed");
  assert.equal(tamperedSha.detail.reason, "shared_release_hero_binding_mismatch");

  // A real path with a null sha is a half-state, not a binding.
  const halfState = await publisher.verifyActiveRelease({
    proofIdentity: published.proofIdentity,
    releaseEvidence: { ...published.releaseEvidence, hero_video_sha256: null },
    previewUrl: published.previewUrl,
  });
  assert.equal(halfState.ok, false);
  assert.equal(halfState.detail.reason, "shared_release_hero_binding_mismatch");

  // A provenance that is not a bounded string annotation is refused.
  const badProvenance = await publisher.verifyActiveRelease({
    proofIdentity: published.proofIdentity,
    releaseEvidence: { ...published.releaseEvidence, hero_provenance: 42 },
    previewUrl: published.previewUrl,
  });
  assert.equal(badProvenance.ok, false);
  assert.equal(badProvenance.detail.reason, "shared_release_hero_binding_mismatch");

  // A lone hero_provenance without the pair is not a shape any writer produces.
  const loneProvenance = { ...published.releaseEvidence, hero_provenance: "client_video" };
  delete loneProvenance.hero_video_path;
  delete loneProvenance.hero_video_sha256;
  const lone = await publisher.verifyActiveRelease({
    proofIdentity: published.proofIdentity,
    releaseEvidence: loneProvenance,
    previewUrl: published.previewUrl,
  });
  assert.equal(lone.ok, false);
  assert.equal(lone.detail.reason, "shared_release_load_identity_mismatch");
  assert.deepEqual(lone.detail.activeDetail.mismatches, ["evidence_keys"]);
});
