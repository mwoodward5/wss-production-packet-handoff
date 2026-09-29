"use strict";

const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const test = require("node:test");

const {
  PREVIEW_GRANT_AUDIENCE,
  MAX_PREVIEW_GRANT_TTL_SECONDS,
  createPreviewGrantRegistryAdapter,
  buildSignedGrant,
  mintPreviewGrant,
  verifyPreviewGrant,
  authorizePreviewGrant,
} = require("../lib/shared-site-preview");

const SITE_ID = "11111111-1111-4111-8111-111111111111";
const RELEASE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_RELEASE_ID = "33333333-3333-4333-8333-333333333333";
const JTI = "44444444-4444-4444-8444-444444444444";
const BUILD_HASH = "b".repeat(64);
const SLUG = "acme-plumbing";
const NOW = 2_000_000_000;
const SECRET = "preview-secret-that-is-at-least-32-bytes-long";
const ENV = Object.freeze({
  WSS_SITE_PREVIEW_SECRET: SECRET,
  WSS_SHARED_PUBLISH_ENABLED: "1",
  WSS_SHARED_SITE_ENV: "preview",
  WSS_SHARED_SITE_ALLOWLIST: SLUG,
});

function input(overrides = {}) {
  return {
    siteId: SITE_ID,
    releaseId: RELEASE_ID,
    buildHash: BUILD_HASH,
    slug: SLUG,
    jti: JTI,
    now: NOW,
    ttlSeconds: 240,
    environment: "preview",
    env: ENV,
    ...overrides,
  };
}

test("minted preview grant is HMAC-bound to the exact release, environment, jti, and five-minute clock", async () => {
  let registered;
  const minted = await mintPreviewGrant(input({
    io: { async registerPreviewGrant(row) { registered = row; return { ok: true }; } },
  }));
  assert.equal(minted.ok, true, JSON.stringify(minted));
  assert.equal(minted.claims.v, 1);
  assert.equal(minted.claims.aud, PREVIEW_GRANT_AUDIENCE);
  assert.equal(minted.claims.site_id, SITE_ID);
  assert.equal(minted.claims.release_id, RELEASE_ID);
  assert.equal(minted.claims.build_hash, BUILD_HASH);
  assert.equal(minted.claims.slug, SLUG);
  assert.equal(minted.claims.jti, JTI);
  assert.equal(minted.claims.env, "preview");
  assert.equal(minted.claims.iat, NOW);
  assert.equal(minted.claims.exp, NOW + 240);
  assert.match(registered.jtiHash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(registered).includes(JTI), false, "raw jti is never stored");
  assert.equal(registered.siteId, SITE_ID);
  assert.equal(registered.releaseId, RELEASE_ID);
  assert.equal(registered.buildHash, BUILD_HASH);
  assert.equal(registered.environment, "preview");

  const verified = verifyPreviewGrant(minted.token, input({ now: NOW + 30 }));
  assert.equal(verified.ok, true, JSON.stringify(verified));
  assert.deepEqual(verified.claims, minted.claims);
  assert.equal(verified.jtiHash, registered.jtiHash);
});

test("preview grant refuses tampering and every identity/environment mismatch", () => {
  const built = buildSignedGrant(input());
  assert.equal(built.ok, true);
  const [payload, sig] = built.token.split(".");
  const tamperedPayload = `${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}`;
  assert.equal(verifyPreviewGrant(`${tamperedPayload}.${sig}`, input()).reason, "preview_grant_bad_signature");

  const bindings = [
    ["siteId", "99999999-9999-4999-8999-999999999999"],
    ["releaseId", OTHER_RELEASE_ID],
    ["buildHash", "c".repeat(64)],
    ["slug", "other-plumbing"],
    ["jti", "55555555-5555-4555-8555-555555555555"],
  ];
  for (const [field, value] of bindings) {
    const checked = verifyPreviewGrant(built.token, input({ [field]: value }));
    assert.equal(checked.reason, "preview_grant_binding_mismatch", field);
    assert.equal(checked.fallback, false);
  }
  assert.equal(
    verifyPreviewGrant(built.token, input({ environment: "production" })).reason,
    "preview_grant_environment_mismatch",
  );
});

test("preview TTL is hard-capped at five minutes at mint and verify time", () => {
  assert.equal(
    buildSignedGrant(input({ ttlSeconds: MAX_PREVIEW_GRANT_TTL_SECONDS + 1 })).reason,
    "invalid_preview_ttl",
  );
  const built = buildSignedGrant(input({ ttlSeconds: MAX_PREVIEW_GRANT_TTL_SECONDS }));
  assert.equal(verifyPreviewGrant(built.token, input({ now: NOW + 299 })).ok, true);
  assert.equal(verifyPreviewGrant(built.token, input({ now: NOW + 300 })).reason, "preview_grant_expired");

  // A correctly signed token still fails when the signed lifetime exceeds the
  // law. This prevents a caller with a stale implementation from minting a
  // long-lived preview credential.
  const claims = { ...built.claims, exp: built.claims.iat + 301 };
  const segment = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signature = createHmac("sha256", SECRET).update(segment, "utf8").digest("base64url");
  assert.equal(
    verifyPreviewGrant(`${segment}.${signature}`, input()).reason,
    "preview_grant_ttl_exceeded",
  );
});

test("kill switch and allowlist changes revoke otherwise valid grants without legacy fallback", () => {
  const built = buildSignedGrant(input());
  const disabled = verifyPreviewGrant(built.token, input({
    env: { ...ENV, WSS_SHARED_PUBLISH_ENABLED: "0" },
  }));
  assert.equal(disabled.reason, "shared_publish_disabled");
  assert.equal(disabled.fallback, false);

  const removed = verifyPreviewGrant(built.token, input({
    env: { ...ENV, WSS_SHARED_SITE_ALLOWLIST: "another-site" },
  }));
  assert.equal(removed.reason, "shared_site_not_allowlisted");
  assert.equal(removed.fallback, false);
});

test("mint refuses to return a token unless the hashed exact grant is registered", async () => {
  const refused = await mintPreviewGrant(input({
    io: { async registerPreviewGrant() { return { ok: false, reason: "release_not_verified" }; } },
  }));
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "preview_grant_registration_refused");
  assert.equal(refused.token, undefined);
  assert.equal(refused.fallback, false);
});

test("authorization consumes the exact registered tuple and preserves replay refusal", async () => {
  const built = buildSignedGrant(input());
  let consumed = false;
  let tuple;
  const io = {
    async consumePreviewGrant(row) {
      tuple = row;
      if (consumed) return { ok: false, reason: "replayed" };
      consumed = true;
      return {
        ok: true,
        site_id: SITE_ID,
        release_id: RELEASE_ID,
        build_hash: BUILD_HASH,
        deployment_env: "preview",
        slug: SLUG,
        manifest_path: `sites/${SITE_ID}/releases/${RELEASE_ID}/manifest.json`,
      };
    },
  };
  const first = await authorizePreviewGrant(built.token, input({ io, now: NOW + 1 }));
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.match(tuple.jtiHash, /^[0-9a-f]{64}$/);
  assert.equal(tuple.siteId, SITE_ID);
  assert.equal(tuple.releaseId, RELEASE_ID);
  assert.equal(tuple.buildHash, BUILD_HASH);

  const replay = await authorizePreviewGrant(built.token, input({ io, now: NOW + 2 }));
  assert.equal(replay.ok, false);
  assert.equal(replay.reason, "preview_grant_not_registered");
  assert.equal(replay.detail.reason, "replayed");
});

test("authorization rejects boolean, incomplete, or mismatched registry success", async () => {
  const built = buildSignedGrant(input());
  const exact = {
    ok: true,
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    build_hash: BUILD_HASH,
    deployment_env: "preview",
    slug: SLUG,
    manifest_path: `sites/${SITE_ID}/releases/${RELEASE_ID}/manifest.json`,
  };
  const cases = [
    [true, "preview_grant_not_registered"],
    [{ ok: true }, "preview_grant_registry_mismatch"],
    [{ ...exact, deployment_env: "production" }, "preview_grant_registry_mismatch"],
    [{ ...exact, manifest_path: "sites/not-the-release/manifest.json" }, "preview_grant_registry_mismatch"],
  ];
  for (const [result, reason] of cases) {
    const checked = await authorizePreviewGrant(built.token, input({
      now: NOW + 1,
      io: { async consumePreviewGrant() { return result; } },
    }));
    assert.equal(checked.ok, false);
    assert.equal(checked.reason, reason);
    assert.equal(checked.fallback, false);
  }
});

test("weak/missing secret and missing durable adapters fail closed", async () => {
  const weak = buildSignedGrant(input({ env: { ...ENV, WSS_SITE_PREVIEW_SECRET: "too-short" } }));
  assert.equal(weak.reason, "preview_secret_not_configured");
  const noRegistry = await mintPreviewGrant(input({ io: {} }));
  assert.equal(noRegistry.reason, "preview_grant_adapter_missing");
  assert.equal(noRegistry.fallback, false);
  const mismatchedDuplicate = buildSignedGrant(input({
    env: { ...ENV, WSS_SITE_ROUTER_ENV: "production" },
  }));
  assert.equal(mismatchedDuplicate.reason, "invalid_preview_environment");
});

test("preview mint and consume require the exact configured canonical environment before I/O", async () => {
  let registered = 0;
  let consumed = 0;
  const baseEnv = {
    WSS_SITE_PREVIEW_SECRET: SECRET,
    WSS_SHARED_PUBLISH_ENABLED: "1",
    WSS_SHARED_SITE_ALLOWLIST: "*",
  };
  for (const env of [
    baseEnv,
    { ...baseEnv, WSS_SHARED_SITE_ENV: " preview" },
    { ...baseEnv, WSS_SHARED_SITE_ENV: "production" },
  ]) {
    const minted = await mintPreviewGrant(input({
      env,
      io: { async registerPreviewGrant() { registered += 1; return { ok: true }; } },
    }));
    assert.equal(minted.reason, "invalid_preview_environment");
  }
  assert.equal(registered, 0, "invalid environment never registers a grant");

  const built = buildSignedGrant(input());
  const missing = await authorizePreviewGrant(built.token, input({
    env: baseEnv,
    io: { async consumePreviewGrant() { consumed += 1; return { ok: true }; } },
  }));
  assert.equal(missing.reason, "preview_grant_environment_not_configured");
  assert.equal(consumed, 0, "invalid environment never consumes a grant");

  assert.equal(
    verifyPreviewGrant(built.token, input({
      env: { ...baseEnv, WSS_SHARED_SITE_ENV: "production" },
      environment: "production",
    })).reason,
    "preview_grant_environment_mismatch",
    "a token signed for another configured environment is rejected",
  );
});

test("preview registry adapter sends only the hashed exact tuple to RPCs", async () => {
  const calls = [];
  const adapter = createPreviewGrantRegistryAdapter({
    async rpc(name, args) {
      calls.push([name, args]);
      return { data: { ok: true }, error: null };
    },
  });
  const row = {
    jtiHash: "e".repeat(64),
    siteId: SITE_ID,
    releaseId: RELEASE_ID,
    buildHash: BUILD_HASH,
    environment: "preview",
    expiresAt: new Date((NOW + 240) * 1000).toISOString(),
  };
  await adapter.registerPreviewGrant(row);
  await adapter.consumePreviewGrant(row);
  assert.deepEqual(calls, [
    ["register_site_preview_grant", {
      p_jti_hash: "e".repeat(64),
      p_site_id: SITE_ID,
      p_release_id: RELEASE_ID,
      p_build_hash: BUILD_HASH,
      p_deployment_env: "preview",
      p_expires_at: row.expiresAt,
    }],
    ["consume_site_preview_grant", {
      p_jti_hash: "e".repeat(64),
      p_site_id: SITE_ID,
      p_release_id: RELEASE_ID,
      p_build_hash: BUILD_HASH,
      p_deployment_env: "preview",
    }],
  ]);
  assert.equal(JSON.stringify(calls).includes(JTI), false);
});
