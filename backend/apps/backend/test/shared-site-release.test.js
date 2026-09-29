"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  SHARED_RELEASE_BUCKET,
  MAX_MANIFEST_BYTES,
  MAX_ASSET_BYTES,
  MAX_ROUTE_COUNT,
  canonicalFilePath,
  canonicalRoutePath,
  releaseObjectKey,
  prepareRelease,
  isAllowedAssetSize,
  createReleaseRegistryAdapter,
  publishSharedSiteRelease,
  activateSharedSiteRelease,
  rollbackSharedSiteRelease,
  quarantineSharedSiteRelease,
} = require("../lib/shared-site-release");

const SITE_ID = "11111111-1111-4111-8111-111111111111";
const RELEASE_ID = "22222222-2222-4222-8222-222222222222";
const PREVIOUS_ID = "33333333-3333-4333-8333-333333333333";
const BUILD_HASH = "a".repeat(64);
const SLUG = "acme-plumbing";
const ENABLED_ENV = Object.freeze({
  WSS_SHARED_PUBLISH_ENABLED: "1",
  WSS_SHARED_SITE_ALLOWLIST: SLUG,
  WSS_SHARED_SITE_ENV: "test",
});

function files() {
  return {
    "index.html": Buffer.from("<!doctype html><link rel=stylesheet href=/assets/app.css>"),
    "assets/app.css": Buffer.from("body{color:#123}"),
    ".well-known/security.txt": Buffer.from("Contact: mailto:security@example.test"),
  };
}

function sqlFunctionBlock(sql, schema, name) {
  const marker = `create or replace function ${schema}.${name}(`;
  const start = sql.toLowerCase().indexOf(marker);
  assert.notEqual(start, -1, `${schema}.${name} must exist`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `${schema}.${name} must have a complete body`);
  return sql.slice(start, end + 4);
}

test("release object paths are immutable and reject every traversal spelling", () => {
  assert.equal(canonicalFilePath("assets/app-ABC_1.2.css"), "assets/app-ABC_1.2.css");
  assert.equal(canonicalFilePath(".well-known/security.txt"), ".well-known/security.txt");
  assert.equal(canonicalRoutePath("/about/"), "/about/");
  assert.equal(
    releaseObjectKey(SITE_ID, RELEASE_ID, "assets/app.css"),
    `sites/${SITE_ID}/releases/${RELEASE_ID}/files/assets/app.css`,
  );

  for (const unsafe of [
    "../index.html",
    "assets/../index.html",
    "/index.html",
    "assets\\app.css",
    "assets//app.css",
    "assets/%2e%2e/index.html",
    "assets/app.css?raw=1",
    "C:/index.html",
    "assets/ space.css",
    "assets/é.png",
    "assets/app.css/",
  ]) assert.equal(canonicalFilePath(unsafe), "", unsafe);
});

test("manifest v1 binds host generation, routes, files, and immutable object keys", () => {
  const prepared = prepareRelease({
    siteId: SITE_ID,
    releaseId: RELEASE_ID,
    buildHash: BUILD_HASH,
    slug: SLUG,
    environment: "test",
    expectedGeneration: 0,
    files: files(),
    routes: { "/": "index.html", "/style": "assets/app.css" },
  });
  assert.equal(prepared.manifest.schema, "wss-site-release/v1");
  assert.equal(prepared.manifest.site_id, SITE_ID);
  assert.equal(prepared.manifest.release_id, RELEASE_ID);
  assert.equal(prepared.manifest.build_hash, BUILD_HASH);
  assert.equal(prepared.manifest.canonical_host, `${SLUG}.wss-ai.com`);
  assert.equal(prepared.manifest.route_generation, 1);
  assert.equal(prepared.manifest.routes["/"], "index.html");
  assert.equal(prepared.manifest.routes["/style"], "assets/app.css");
  assert.equal(prepared.manifest.files["assets/app.css"].bytes, 16);
  assert.equal(prepared.manifest.files["assets/app.css"].mime, "text/css; charset=utf-8");
  assert.match(prepared.manifest.files["assets/app.css"].sha256, /^[0-9a-f]{64}$/);
  assert.equal(
    prepared.manifest.files["assets/app.css"].key,
    `sites/${SITE_ID}/releases/${RELEASE_ID}/files/assets/app.css`,
  );
  assert.equal(prepared.manifestKey, `sites/${SITE_ID}/releases/${RELEASE_ID}/manifest.json`);
  assert.match(prepared.manifestSha256, /^[0-9a-f]{64}$/);
});

test("a release without index.html or with a route to a missing asset is refused", () => {
  assert.throws(() => prepareRelease({
    siteId: SITE_ID,
    releaseId: RELEASE_ID,
    buildHash: BUILD_HASH,
    slug: SLUG,
    environment: "test",
    files: { "index.html": "home" },
  }), /invalid_expected_generation/);
  assert.throws(() => prepareRelease({
    siteId: SITE_ID,
    releaseId: RELEASE_ID,
    buildHash: BUILD_HASH,
    slug: SLUG,
    environment: "test",
    expectedGeneration: 0,
    files: { "about.html": "about" },
  }), /release_index_missing/);
  assert.throws(() => prepareRelease({
    siteId: SITE_ID,
    releaseId: RELEASE_ID,
    buildHash: BUILD_HASH,
    slug: SLUG,
    environment: "test",
    expectedGeneration: 0,
    files: { "index.html": "home" },
    routes: { "/missing": "missing.html" },
  }), /manifest_route_target_missing/);
});

test("publisher preflight matches router byte/count caps before any I/O", () => {
  assert.equal(MAX_ASSET_BYTES, 64 * 1024 * 1024);
  assert.equal(MAX_MANIFEST_BYTES, 2 * 1024 * 1024);
  assert.equal(MAX_ROUTE_COUNT, 10_000);
  assert.equal(isAllowedAssetSize(MAX_ASSET_BYTES), true);
  assert.equal(isAllowedAssetSize(MAX_ASSET_BYTES + 1), false);

  const tooManyRoutes = {};
  for (let index = 0; index < MAX_ROUTE_COUNT; index += 1) tooManyRoutes[`/r${index}`] = "index.html";
  assert.throws(() => prepareRelease({
    siteId: SITE_ID,
    releaseId: RELEASE_ID,
    buildHash: BUILD_HASH,
    slug: SLUG,
    environment: "test",
    expectedGeneration: 0,
    files: { "index.html": "home" },
    routes: tooManyRoutes,
  }), /manifest_route_limit_exceeded/);

  const oversizedManifestRoutes = {};
  const longTail = `${"a".repeat(120)}/${"b".repeat(120)}/${"c".repeat(120)}`;
  for (let index = 0; index < MAX_ROUTE_COUNT - 1; index += 1) {
    oversizedManifestRoutes[`/r${index}/${longTail}`] = "index.html";
  }
  assert.throws(() => prepareRelease({
    siteId: SITE_ID,
    releaseId: RELEASE_ID,
    buildHash: BUILD_HASH,
    slug: SLUG,
    environment: "test",
    expectedGeneration: 0,
    files: { "index.html": "home" },
    routes: oversizedManifestRoutes,
  }), /release_manifest_too_large/);
});

test("v1 canonical host is exactly the one-label slug host", () => {
  assert.throws(() => prepareRelease({
    siteId: SITE_ID,
    releaseId: RELEASE_ID,
    buildHash: BUILD_HASH,
    slug: SLUG,
    environment: "test",
    canonicalHost: "custom.example.com",
    expectedGeneration: 0,
    files: { "index.html": "home" },
  }), /canonical_host_not_slug_host/);
  assert.throws(() => prepareRelease({
    siteId: SITE_ID,
    releaseId: RELEASE_ID,
    buildHash: BUILD_HASH,
    slug: SLUG,
    expectedGeneration: 0,
    files: { "index.html": "home" },
    env: { ...ENABLED_ENV, WSS_SITE_ROUTER_ENV: "production" },
  }), /invalid_release_identity/, "duplicate router env may exist only when it equals the canonical env");
});

test("publish stages once, inserts immutable objects, hash-reads every byte, then verifies", async () => {
  const events = [];
  const objects = new Map();
  const result = await publishSharedSiteRelease({
    siteId: SITE_ID,
    releaseId: RELEASE_ID,
    buildHash: BUILD_HASH,
    slug: SLUG,
    environment: "test",
    expectedGeneration: 0,
    files: files(),
    env: ENABLED_ENV,
    io: {
      async insertStagedRelease(row) {
        events.push(["stage", row.state, row.manifestPath]);
        return { ok: true };
      },
      async putObjectIfAbsent(object) {
        events.push(["put", object.key, object.insertOnly]);
        assert.equal(object.bucket, SHARED_RELEASE_BUCKET);
        assert.equal(objects.has(object.key), false, "the adapter is never asked to overwrite");
        objects.set(object.key, Buffer.from(object.body));
        return { ok: true };
      },
      async readObject({ key }) {
        events.push(["read", key]);
        return { ok: true, body: objects.get(key) };
      },
      async markReleaseVerified(row) {
        events.push(["verify", row.expectedState, row.state]);
        return { ok: true };
      },
    },
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.state, "verified");
  assert.equal(result.fallback, false);
  assert.equal(result.fileCount, 3);
  assert.equal(events[0][0], "stage");
  assert.equal(events.at(-1)[0], "verify");
  assert.equal(events.filter(([kind]) => kind === "put").length, 4, "3 assets plus manifest");
  assert.equal(events.filter(([kind]) => kind === "read").length, 4, "all bytes are read back");
  assert.ok([...objects.keys()].every((key) => key.startsWith(`sites/${SITE_ID}/releases/${RELEASE_ID}/`)));
  assert.ok([...objects.keys()].every((key) => !key.includes("wss-site-sources")));
});

test("a readback mismatch leaves the release staged and never marks it verified", async () => {
  let verified = 0;
  const objects = new Map();
  const result = await publishSharedSiteRelease({
    siteId: SITE_ID,
    releaseId: RELEASE_ID,
    buildHash: BUILD_HASH,
    slug: SLUG,
    environment: "test",
    expectedGeneration: 0,
    files: files(),
    env: ENABLED_ENV,
    io: {
      async insertStagedRelease() { return { ok: true }; },
      async putObjectIfAbsent({ key, body }) { objects.set(key, Buffer.from(body)); return { ok: true }; },
      async readObject({ key }) {
        if (key.endsWith("/files/assets/app.css")) return { body: Buffer.from("tampered") };
        return { body: objects.get(key) };
      },
      async markReleaseVerified() { verified += 1; return { ok: true }; },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "release_object_readback_mismatch");
  assert.equal(result.detail.rel, "assets/app.css");
  assert.equal(result.fallback, false);
  assert.equal(verified, 0);
});

test("an existing immutable object is a collision, never an upsert", async () => {
  let reads = 0;
  let verified = 0;
  const result = await publishSharedSiteRelease({
    siteId: SITE_ID,
    releaseId: RELEASE_ID,
    buildHash: BUILD_HASH,
    slug: SLUG,
    environment: "test",
    expectedGeneration: 0,
    files: files(),
    env: ENABLED_ENV,
    io: {
      async insertStagedRelease() { return { ok: true }; },
      async putObjectIfAbsent({ insertOnly }) { assert.equal(insertOnly, true); return { ok: false, reason: "exists" }; },
      async readObject() { reads += 1; return { body: Buffer.alloc(0) }; },
      async markReleaseVerified() { verified += 1; return { ok: true }; },
    },
  });
  assert.equal(result.reason, "release_object_insert_refused");
  assert.equal(result.fallback, false);
  assert.equal(reads, 0);
  assert.equal(verified, 0);
});

test("kill switch and allowlist refusals perform zero I/O and never request legacy fallback", async () => {
  let calls = 0;
  const io = new Proxy({}, { get() { calls += 1; return async () => ({ ok: true }); } });
  const missing = await publishSharedSiteRelease({
    siteId: SITE_ID,
    releaseId: RELEASE_ID,
    buildHash: BUILD_HASH,
    slug: SLUG,
    environment: "test",
    files: files(),
    env: { WSS_SHARED_SITE_ALLOWLIST: "*" },
    io,
  });
  assert.deepEqual(missing, {
    ok: false,
    refused: true,
    reason: "shared_publish_disabled",
    fallback: false,
  });
  const disabled = await publishSharedSiteRelease({
    siteId: SITE_ID,
    releaseId: RELEASE_ID,
    buildHash: BUILD_HASH,
    slug: SLUG,
    environment: "test",
    files: files(),
    env: { WSS_SHARED_PUBLISH_ENABLED: "0", WSS_SHARED_SITE_ALLOWLIST: "*" },
    io,
  });
  assert.deepEqual(disabled, {
    ok: false,
    refused: true,
    reason: "shared_publish_disabled",
    fallback: false,
  });
  const notAllowed = await publishSharedSiteRelease({
    siteId: SITE_ID,
    releaseId: RELEASE_ID,
    buildHash: BUILD_HASH,
    slug: SLUG,
    files: files(),
    env: { WSS_SHARED_PUBLISH_ENABLED: "1", WSS_SHARED_SITE_ALLOWLIST: "another-site" },
    io,
  });
  assert.equal(notAllowed.reason, "shared_site_not_allowlisted");
  assert.equal(notAllowed.fallback, false);
  assert.equal(calls, 0);

  let activationCalls = 0;
  const disabledActivation = await activateSharedSiteRelease({
    siteId: SITE_ID,
    releaseId: RELEASE_ID,
    slug: SLUG,
    expectedGeneration: 2,
    environment: "test",
    env: { WSS_SHARED_PUBLISH_ENABLED: "0", WSS_SHARED_SITE_ALLOWLIST: "*", WSS_SHARED_SITE_ENV: "test" },
    io: { async activateReleaseCas() { activationCalls += 1; return { ok: true, generation: 3 }; } },
  });
  assert.equal(disabledActivation.reason, "shared_publish_disabled");
  assert.equal(activationCalls, 0, "disabled new activation performs no CAS I/O");

  let rollbackArgs;
  const emergencyRollback = await rollbackSharedSiteRelease({
    siteId: SITE_ID,
    releaseId: PREVIOUS_ID,
    slug: SLUG,
    expectedGeneration: 2,
    environment: "test",
    env: {
      WSS_SHARED_PUBLISH_ENABLED: "0",
      WSS_SHARED_SITE_ALLOWLIST: SLUG,
      WSS_SHARED_SITE_ENV: "test",
    },
    io: {
      async rollbackReleaseCas(args) {
        rollbackArgs = args;
        return { ok: true, generation: 3 };
      },
    },
  });
  assert.equal(emergencyRollback.ok, true, JSON.stringify(emergencyRollback));
  assert.deepEqual(rollbackArgs, {
    siteId: SITE_ID,
    releaseId: PREVIOUS_ID,
    expectedGeneration: 2,
    environment: "test",
  });

  let quarantineArgs;
  const emergencyQuarantine = await quarantineSharedSiteRelease({
    siteId: SITE_ID,
    releaseId: RELEASE_ID,
    slug: SLUG,
    expectedGeneration: 1,
    environment: "test",
    env: {
      WSS_SHARED_PUBLISH_ENABLED: "0",
      WSS_SHARED_SITE_ALLOWLIST: SLUG,
      WSS_SHARED_SITE_ENV: "test",
    },
    io: {
      async quarantineReleaseCas(args) {
        quarantineArgs = args;
        return { ok: true, generation: 2 };
      },
    },
  });
  assert.equal(emergencyQuarantine.ok, true, JSON.stringify(emergencyQuarantine));
  assert.deepEqual(quarantineArgs, {
    siteId: SITE_ID,
    releaseId: RELEASE_ID,
    expectedGeneration: 1,
    environment: "test",
  });

  let deniedRollbackCalls = 0;
  const deniedRollback = await rollbackSharedSiteRelease({
    siteId: SITE_ID,
    releaseId: PREVIOUS_ID,
    slug: SLUG,
    expectedGeneration: 2,
    environment: "test",
    env: {
      WSS_SHARED_PUBLISH_ENABLED: "0",
      WSS_SHARED_SITE_ALLOWLIST: "another-site",
      WSS_SHARED_SITE_ENV: "test",
    },
    io: {
      async rollbackReleaseCas() {
        deniedRollbackCalls += 1;
        return { ok: true, generation: 3 };
      },
    },
  });
  assert.equal(deniedRollback.reason, "shared_site_not_allowlisted");
  assert.equal(deniedRollback.fallback, false);
  assert.equal(deniedRollbackCalls, 0, "non-allowlisted rollback performs no CAS I/O");

  let deniedQuarantineCalls = 0;
  const deniedQuarantine = await quarantineSharedSiteRelease({
    siteId: SITE_ID,
    releaseId: RELEASE_ID,
    slug: SLUG,
    expectedGeneration: 1,
    environment: "test",
    env: {
      WSS_SHARED_PUBLISH_ENABLED: "0",
      WSS_SHARED_SITE_ALLOWLIST: "another-site",
      WSS_SHARED_SITE_ENV: "test",
    },
    io: {
      async quarantineReleaseCas() {
        deniedQuarantineCalls += 1;
        return { ok: true, generation: 2 };
      },
    },
  });
  assert.equal(deniedQuarantine.reason, "shared_site_not_allowlisted");
  assert.equal(deniedQuarantineCalls, 0);
});

test("publish, activate, rollback, and quarantine require the configured canonical environment before I/O", async () => {
  let calls = 0;
  const io = {
    async insertStagedRelease() { calls += 1; return { ok: true }; },
    async putObjectIfAbsent() { calls += 1; return { ok: true }; },
    async readObject() { calls += 1; return { body: Buffer.alloc(0) }; },
    async markReleaseVerified() { calls += 1; return { ok: true }; },
    async activateReleaseCas() { calls += 1; return { ok: true, generation: 1 }; },
    async rollbackReleaseCas() { calls += 1; return { ok: true, generation: 1 }; },
  };
  const baseEnv = {
    WSS_SHARED_PUBLISH_ENABLED: "1",
    WSS_SHARED_SITE_ALLOWLIST: "*",
  };
  const publishBase = {
    siteId: SITE_ID,
    releaseId: RELEASE_ID,
    buildHash: BUILD_HASH,
    slug: SLUG,
    environment: "test",
    expectedGeneration: 0,
    files: files(),
    io,
  };

  for (const env of [
    baseEnv,
    { ...baseEnv, WSS_SHARED_SITE_ENV: " test" },
    { ...baseEnv, WSS_SHARED_SITE_ENV: "production" },
  ]) {
    const result = await publishSharedSiteRelease({ ...publishBase, env });
    assert.equal(result.reason, "invalid_release_environment");
  }

  const casBase = {
    siteId: SITE_ID,
    releaseId: RELEASE_ID,
    slug: SLUG,
    environment: "test",
    expectedGeneration: 0,
    env: baseEnv,
    io,
  };
  assert.equal((await activateSharedSiteRelease(casBase)).reason, "invalid_release_environment");
  assert.equal((await rollbackSharedSiteRelease(casBase)).reason, "invalid_release_environment");
  assert.equal((await quarantineSharedSiteRelease(casBase)).reason, "invalid_release_environment");
  assert.equal(calls, 0, "missing, invalid, or mismatched canonical env performs no adapter I/O");
});

test("activation, rollback, and quarantine pass exact CAS tuples and surface conflicts without fallback", async () => {
  const calls = [];
  const base = { siteId: SITE_ID, slug: SLUG, env: ENABLED_ENV, expectedGeneration: 7 };
  const activated = await activateSharedSiteRelease({
    ...base,
    releaseId: RELEASE_ID,
    io: { async activateReleaseCas(args) { calls.push(["activate", args]); return { ok: true, generation: 8 }; } },
  });
  assert.deepEqual(activated, {
    ok: true,
    fallback: false,
    siteId: SITE_ID,
    releaseId: RELEASE_ID,
    generation: 8,
    state: "active",
  });
  const rolledBack = await rollbackSharedSiteRelease({
    ...base,
    expectedGeneration: 8,
    releaseId: PREVIOUS_ID,
    io: { async rollbackReleaseCas(args) { calls.push(["rollback", args]); return { ok: true, generation: 9 }; } },
  });
  assert.equal(rolledBack.generation, 9);
  const quarantined = await quarantineSharedSiteRelease({
    ...base,
    expectedGeneration: 9,
    releaseId: RELEASE_ID,
    io: { async quarantineReleaseCas(args) { calls.push(["quarantine", args]); return { ok: true, generation: 10 }; } },
  });
  assert.deepEqual(quarantined, {
    ok: true,
    fallback: false,
    siteId: SITE_ID,
    releaseId: RELEASE_ID,
    generation: 10,
    state: "quarantined",
  });
  assert.deepEqual(calls, [
    ["activate", { siteId: SITE_ID, releaseId: RELEASE_ID, expectedGeneration: 7, environment: "test" }],
    ["rollback", { siteId: SITE_ID, releaseId: PREVIOUS_ID, expectedGeneration: 8, environment: "test" }],
    ["quarantine", { siteId: SITE_ID, releaseId: RELEASE_ID, expectedGeneration: 9, environment: "test" }],
  ]);

  const conflict = await activateSharedSiteRelease({
    ...base,
    releaseId: RELEASE_ID,
    io: { async activateReleaseCas() { return { ok: false, reason: "generation_conflict" }; } },
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.reason, "activate_release_cas_refused");
  assert.equal(conflict.detail.reason, "generation_conflict");
  assert.equal(conflict.fallback, false);
  const quarantineConflict = await quarantineSharedSiteRelease({
    ...base,
    releaseId: RELEASE_ID,
    expectedGeneration: 8,
    io: { async quarantineReleaseCas() { return { ok: false, reason: "generation_conflict" }; } },
  });
  assert.equal(quarantineConflict.reason, "quarantine_release_cas_refused");
  assert.equal(quarantineConflict.detail.reason, "generation_conflict");
});

test("registry adapter maps stage, verify, activate, rollback, and quarantine to exact RPC arguments", async () => {
  const calls = [];
  const adapter = createReleaseRegistryAdapter({
    async rpc(name, args) {
      calls.push([name, args]);
      return { data: { ok: true, generation: 4 }, error: null };
    },
  });
  const row = {
    siteId: SITE_ID,
    releaseId: RELEASE_ID,
    buildHash: BUILD_HASH,
    manifestPath: `sites/${SITE_ID}/releases/${RELEASE_ID}/manifest.json`,
    manifestSha256: "d".repeat(64),
    canonicalHost: `${SLUG}.wss-ai.com`,
    routeGeneration: 4,
    environment: "preview",
    expectedGeneration: 3,
  };
  await adapter.insertStagedRelease(row);
  await adapter.markReleaseVerified(row);
  await adapter.activateReleaseCas(row);
  await adapter.rollbackReleaseCas(row);
  await adapter.quarantineReleaseCas(row);
  assert.deepEqual(calls.map(([name]) => name), [
    "stage_site_release",
    "verify_site_release",
    "activate_site_release",
    "rollback_site_release",
    "quarantine_site_release",
  ]);
  assert.deepEqual(calls[2][1], {
    p_site_id: SITE_ID,
    p_expected_generation: 3,
    p_release_id: RELEASE_ID,
    p_deployment_env: "preview",
  });
  assert.equal(calls[3][1].p_deployment_env, "preview");
  assert.deepEqual(calls[4][1], {
    p_site_id: SITE_ID,
    p_expected_generation: 3,
    p_failed_release_id: RELEASE_ID,
    p_deployment_env: "preview",
  });
  assert.equal(calls[0][1].p_manifest_sha256, "d".repeat(64));
  assert.equal(calls[0][1].p_canonical_host, `${SLUG}.wss-ai.com`);
  assert.equal(calls[0][1].p_published_generation, 4);
  assert.equal(calls[0][1].p_deployment_env, "preview");
});

test("activation A to B then rollback to immutable A keeps internal CAS generation increasing", async () => {
  let generation = 0;
  let active = null;
  let previous = null;
  const eligible = new Set([RELEASE_ID, PREVIOUS_ID]);
  const io = {
    async activateReleaseCas({ releaseId, expectedGeneration }) {
      if (expectedGeneration !== generation || !eligible.has(releaseId)) return { ok: false, reason: "generation_conflict" };
      previous = active;
      active = releaseId;
      generation += 1;
      return { ok: true, generation };
    },
    async rollbackReleaseCas({ releaseId, expectedGeneration }) {
      if (expectedGeneration !== generation || releaseId !== previous) return { ok: false, reason: "rollback_conflict" };
      const oldActive = active;
      active = releaseId;
      previous = oldActive;
      generation += 1;
      return { ok: true, generation };
    },
  };
  const common = { siteId: SITE_ID, slug: SLUG, env: ENABLED_ENV, io };
  assert.equal((await activateSharedSiteRelease({ ...common, releaseId: RELEASE_ID, expectedGeneration: 0 })).generation, 1);
  assert.equal((await activateSharedSiteRelease({ ...common, releaseId: PREVIOUS_ID, expectedGeneration: 1 })).generation, 2);
  const rolledBack = await rollbackSharedSiteRelease({ ...common, releaseId: RELEASE_ID, expectedGeneration: 2 });
  assert.equal(rolledBack.ok, true);
  assert.equal(rolledBack.generation, 3);
  assert.equal(active, RELEASE_ID);
  assert.equal(previous, PREVIOUS_ID);
});

test("migration pins RLS, tombstones, exact release ownership, and CAS RPCs", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../supabase/shared-site-releases.sql"), "utf8");
  for (const table of [
    "ghost_agency_sites",
    "ghost_agency_site_hosts",
    "ghost_agency_site_releases",
    "ghost_agency_site_preview_grants",
  ]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated, service_role`, "i"));
  }
  assert.match(sql, /site_host_delete_refused_permanent_tombstone/i);
  assert.match(sql, /site_host_tombstone_is_permanent/i);
  assert.match(sql, /p_normalized_host = canonical_slug \|\| '\.wss-ai\.com'/i);
  assert.match(sql, /p_canonical_host = canonical_slug \|\| '\.wss-ai\.com'/i);
  assert.match(sql, /manifest_path = 'sites\/' \|\| site_id::text \|\| '\/releases\/' \|\| release_id::text \|\| '\/manifest\.json'/i);
  assert.match(sql, /create or replace function public\.activate_site_release/i);
  assert.match(sql, /create or replace function public\.rollback_site_release/i);
  assert.match(sql, /drop function if exists public\.activate_site_release\(uuid, bigint, uuid\)/i);
  assert.match(sql, /drop function if exists public\.rollback_site_release\(uuid, bigint, uuid\)/i);
  assert.match(sql, /where site_id = p_site_id and release_id = p_release_id/i);
  assert.match(sql, /v_site\.previous_release_id is distinct from p_release_id/i);
  assert.doesNotMatch(sql, /ghost_site_router|grant\s+[^;]+\s+to authenticator/i);
  assert.match(sql, /grant execute on function public\.resolve_shared_site\(text, text, text\) to service_role/i);
  assert.match(sql, /create or replace function public\.resolve_shared_site\([\s\S]*p_deployment_env text default null/i);
  assert.match(sql, /r\.deployment_env = p_deployment_env/i);
  const activeResolver = sqlFunctionBlock(sql, "ghost_agency_private", "resolve_shared_site");
  assert.match(activeResolver, /join public\.ghost_agency_site_hosts h[\s\S]*h\.normalized_host = r\.canonical_host[\s\S]*h\.status = 'active'/i);
  assert.match(activeResolver, /r\.deployment_env, r\.published_generation/i, "public route generation stays bound to immutable release bytes");
  assert.doesNotMatch(activeResolver, /r\.deployment_env, s\.generation/i);
  assert.doesNotMatch(activeResolver, /left join public\.ghost_agency_site_hosts/i);
  const activateBody = sqlFunctionBlock(sql, "ghost_agency_private", "activate_site_release");
  const rollbackBody = sqlFunctionBlock(sql, "ghost_agency_private", "rollback_site_release");
  assert.match(activateBody, /deployment_env = p_deployment_env/i);
  assert.match(rollbackBody, /deployment_env = p_deployment_env/i);
  assert.match(sql, /grant execute on function public\.activate_site_release\(uuid, bigint, uuid, text\) to service_role/i);
  assert.match(sql, /grant execute on function public\.rollback_site_release\(uuid, bigint, uuid, text\) to service_role/i);
  assert.match(sql, /s\.generation >= 1/i, "public resolver cannot expose generation 0");
  assert.match(sql, /revoke all on function public\.resolve_shared_site_preview\(uuid, uuid, text, text, text\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.resolve_shared_site_preview\(uuid, uuid, text, text, text\) to service_role/i);
  assert.match(sql, /revoke all on function public\.register_site_preview_grant\(text, uuid, uuid, text, text, timestamptz\) from public, anon, authenticated/i);
  assert.match(sql, /revoke all on function public\.consume_site_preview_grant\(text, uuid, uuid, text, text\) from public, anon, authenticated/i);
  assert.match(sql, /r\.state in \('verified', 'active'\)/i);
  assert.match(sql, /r\.deployment_env, s\.generation/i, "preactivation preview returns generation 0 unchanged");
  assert.doesNotMatch(sql, /greatest\(s\.generation/i);
  assert.doesNotMatch(sql, /create policy[^;]+on storage\.objects/i);
});

test("first-release quarantine is service-only, monotonic, idempotent, and retry-safe", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../supabase/shared-site-releases.sql"), "utf8");
  const quarantine = sqlFunctionBlock(sql, "ghost_agency_private", "quarantine_site_release");
  const reader = sqlFunctionBlock(sql, "ghost_agency_private", "read_shared_site_generation");
  const stager = sqlFunctionBlock(sql, "ghost_agency_private", "stage_site_release");
  const resolver = sqlFunctionBlock(sql, "ghost_agency_private", "resolve_shared_site");

  assert.match(quarantine, /for update/i);
  assert.match(quarantine, /v_site\.generation = p_expected_generation \+ 1[\s\S]*active_release_id is null[\s\S]*previous_release_id is null/i);
  assert.match(quarantine, /deployment_env = p_deployment_env[\s\S]*published_generation = p_expected_generation[\s\S]*state = 'revoked'/i);
  assert.match(quarantine, /v_site\.generation <> p_expected_generation/i);
  assert.match(quarantine, /active_release_id is distinct from p_failed_release_id/i);
  assert.match(quarantine, /previous_release_id is not null[\s\S]*previous_release_available_use_rollback/i);
  assert.match(quarantine, /set state = 'revoked'[\s\S]*revoked_at = clock_timestamp\(\)/i);
  assert.match(quarantine, /set status = 'pending', is_primary = false/i);
  assert.match(quarantine, /update public\.ghost_agency_site_preview_grants[\s\S]*set revoked_at = clock_timestamp\(\)/i);
  assert.match(quarantine, /set previous_release_id = null,[\s\S]*active_release_id = null,[\s\S]*generation = generation \+ 1,[\s\S]*serve_mode = 'legacy'/i);
  assert.match(quarantine, /'state', 'quarantined'[\s\S]*'idempotent', true/i);
  assert.ok(
    quarantine.indexOf("'idempotent', true") < quarantine.indexOf("v_site.generation <> p_expected_generation"),
    "exact replay must be accepted before generation conflict",
  );

  assert.match(reader, /v_site\.generation - 1[\s\S]*state = 'revoked'/i);
  assert.match(reader, /status = 'pending'[\s\S]*not inactive_host\.is_primary/i);
  assert.match(stager, /v_existing\.state in \('staged', 'verified', 'active', 'retired'\)/i);
  assert.doesNotMatch(stager, /v_existing\.state in \([^)]*'revoked'/i);
  assert.match(resolver, /s\.serve_mode = 'shared'/i);
  assert.match(resolver, /r\.release_id = s\.active_release_id/i);

  assert.match(sql, /create or replace function public\.quarantine_site_release/i);
  assert.match(sql, /revoke all on function public\.quarantine_site_release\(uuid, bigint, uuid, text\) from public, anon, authenticated, service_role/i);
  assert.match(sql, /grant execute on function public\.quarantine_site_release\(uuid, bigint, uuid, text\) to service_role/i);
  assert.doesNotMatch(sql, /grant execute on function public\.quarantine_site_release\([^;]+to (?:public|anon|authenticated)/i);
});

test("migration keeps every privileged body private behind exact invoker wrappers", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../supabase/shared-site-releases.sql"), "utf8");
  const privileged = [
    "register_shared_site",
    "register_site_host",
    "retire_site_host",
    "stage_site_release",
    "verify_site_release",
    "activate_site_release",
    "rollback_site_release",
    "quarantine_site_release",
    "resolve_shared_site",
    "resolve_shared_site_preview",
    "register_site_preview_grant",
    "consume_site_preview_grant",
  ];

  assert.match(sql, /create schema if not exists ghost_agency_private/i);
  assert.match(
    sql,
    /revoke all on schema ghost_agency_private\s+from public, anon, authenticated, service_role/i,
  );
  for (const name of privileged) {
    const privateBody = sqlFunctionBlock(sql, "ghost_agency_private", name);
    const publicWrapper = sqlFunctionBlock(sql, "public", name);
    assert.match(privateBody, /security definer/i, `${name} private body must own the narrow privilege`);
    assert.match(privateBody, /set search_path = ''/i, `${name} private body must have an empty search path`);
    assert.match(publicWrapper, /security invoker/i, `${name} public RPC must retain caller privilege`);
    assert.doesNotMatch(publicWrapper, /security definer/i, `${name} cannot expose owner privilege`);
    assert.match(
      sql,
      new RegExp(`revoke all on function ghost_agency_private\\.${name}\\([^;]+from public, anon, authenticated`, "i"),
      `${name} private execute starts closed`,
    );
  }

  for (const name of [
    "guard_ghost_agency_site_host_tombstone",
    "guard_ghost_agency_site_release_immutability",
  ]) {
    const triggerBody = sqlFunctionBlock(sql, "public", name);
    assert.match(triggerBody, /security invoker/i);
    assert.doesNotMatch(triggerBody, /security definer/i);
  }
  assert.match(sql, /grant usage on schema ghost_agency_private to service_role/i);
  assert.doesNotMatch(sql, /ghost_site_router/i);
});

test("migration keeps the bounded release bucket private for the backend proxy", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../supabase/shared-site-releases.sql"), "utf8");
  assert.match(
    sql,
    /insert into storage\.buckets\(id, name, public, file_size_limit\)[\s\S]*'wss-site-releases', 'wss-site-releases', false, 67108864/i,
  );
  assert.match(sql, /on conflict \(id\) do update[\s\S]*set public = false/i);
  assert.doesNotMatch(sql, /create policy[^;]+on storage\.objects/i);
  assert.doesNotMatch(sql, /grant (select|insert|update|delete|all) on table storage\.objects/i);
  assert.doesNotMatch(sql, /ghost_site_router|grant\s+[^;]+\s+to authenticator/i);
});

function pooledReleaseInput(io) {
  return {
    siteId: SITE_ID, releaseId: RELEASE_ID, buildHash: BUILD_HASH, slug: SLUG,
    environment: "test", expectedGeneration: 0, env: ENABLED_ENV,
    files: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i ? `assets/file${i}.css` : "index.html", `body${i}`])),
    io,
  };
}
const storageDelay = () => new Promise(resolve => setTimeout(resolve, 8));

test("storage pool is bounded at four and preserves complete phase barriers", async () => {
  const objects = new Map();
  let active = 0, peak = 0, uploads = 0, reads = 0, manifestPut = false, manifestRead = false;
  const input = pooledReleaseInput({
    async insertStagedRelease() { return { ok: true }; },
    async putObjectIfAbsent({ key, body }) {
      const manifest = !key.includes("/files/");
      if (manifest) { assert.equal(uploads, 12); assert.equal(active, 0); manifestPut = true; }
      active++; peak = Math.max(peak, active);
      await storageDelay();
      objects.set(key, Buffer.from(body)); active--;
      if (!manifest) uploads++;
      return { ok: true };
    },
    async readObject({ key }) {
      assert.equal(manifestPut, true); assert.equal(uploads, 12);
      const manifest = !key.includes("/files/");
      if (manifest) { assert.equal(reads, 12); assert.equal(active, 0); manifestRead = true; }
      active++; peak = Math.max(peak, active);
      await storageDelay(); active--;
      if (!manifest) reads++;
      return { body: objects.get(key) };
    },
    async markReleaseVerified() {
      assert.equal(active, 0); assert.equal(reads, 12); assert.equal(manifestRead, true);
      return { ok: true };
    },
  });
  const result = await publishSharedSiteRelease(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(peak, 4);
  assert.deepEqual(result.manifest, prepareRelease(input).manifest, "concurrency cannot change manifest identity");
});

for (const phase of ["upload", "readback"]) {
  for (const throws of [false, true]) {
    test(`${phase} ${throws ? "exception" : "refusal"} settles active operations and blocks later phases`, async () => {
      let active = 0, claimed = 0, settled = 0, verified = 0, manifestReads = 0;
      const objects = new Map();
      async function failingOperation() {
        const index = claimed++;
        active++;
        try {
          if (index === 0) {
            if (throws) throw new Error("storage_test_failure");
            return false;
          }
          await storageDelay();
          return true;
        } finally { active--; settled++; }
      }
      const result = await publishSharedSiteRelease(pooledReleaseInput({
        async insertStagedRelease() { return { ok: true }; },
        async putObjectIfAbsent({ key, body }) {
          if (phase === "upload" && !(await failingOperation())) return { ok: false };
          objects.set(key, Buffer.from(body)); return { ok: true };
        },
        async readObject({ key }) {
          assert.equal(phase, "readback", "failed uploads cannot begin reads");
          if (!key.includes("/files/")) manifestReads++;
          if (!(await failingOperation())) return { body: Buffer.from("corrupt") };
          return { body: objects.get(key) };
        },
        async markReleaseVerified() { verified++; return { ok: true }; },
      }));
      assert.equal(result.ok, false);
      assert.equal(result.reason, throws ? "shared_release_io_failed" : phase === "upload" ? "release_object_insert_refused" : "release_object_readback_mismatch");
      assert.equal(active, 0, "return only after active work settles");
      assert.equal(settled, claimed);
      assert.equal(claimed, 4, "failure stops claiming remaining files");
      assert.equal(verified, 0);
      assert.equal(manifestReads, 0);
    });
  }
}
