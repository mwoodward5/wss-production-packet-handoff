"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");

const {
  derivedBuildHash,
  createDefaultSharedSiteReleaseLoader,
  injectSharedSiteHero,
  sharedHeroEvidenceFromRow,
  sharedHeroInjectionEnabled,
} = require("../lib/shared-site-hero-injection");

const SITE_ID = "11111111-1111-4111-8111-111111111111";
const RELEASE_ID = "22222222-2222-4222-8222-222222222222";
const NEXT_RELEASE_ID = "33333333-3333-4333-8333-333333333333";
const SLUG = "acme-plumbing";
const HERO_PATH = "assets/hero-fallback.mp4";

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fixture() {
  const oldVideo = Buffer.from("old-stock-video");
  const files = {
    "index.html": Buffer.from('<video src="/assets/hero-client.mp4"><source src="/assets/hero-fallback.mp4"></video>'),
    [HERO_PATH]: oldVideo,
  };
  const buildHash = derivedBuildHash(files);
  const proofIdentity = { site_id: SITE_ID, release_id: RELEASE_ID, build_hash: buildHash };
  const releaseEvidence = {
    evidence_schema: "shared-site-release-evidence-v1",
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    build_hash: buildHash,
    slug: SLUG,
    canonical_host: `${SLUG}.wss-ai.com`,
    manifest_path: `sites/${SITE_ID}/releases/${RELEASE_ID}/manifest.json`,
    manifest_sha256: "a".repeat(64),
    deployment_env: "production",
    generation: 7,
    route_generation: 7,
    state: "active",
    hero_video_path: HERO_PATH,
    hero_video_sha256: hash(oldVideo),
  };
  const clip = Buffer.from("new-approved-client-video");
  const asset = {
    bytes: clip,
    sha256: hash(clip),
    source_sha256: "b".repeat(64),
    url: "https://assets.example.com/approved.mp4",
    verified: true,
    approved: true,
    approved_by: "owner",
    approved_at: "2026-08-24T08:00:00.000Z",
    retention: { class: "approved_durable", expires_at: null },
  };
  return {
    files,
    routes: { "/": "index.html", [`/${HERO_PATH}`]: HERO_PATH },
    row: { slug: SLUG, proofIdentity, sharedReleaseEvidence: releaseEvidence },
    proofIdentity,
    releaseEvidence,
    asset,
  };
}

test("approved hero bytes publish and CAS-activate one new immutable shared release", async () => {
  const value = fixture();
  const oldFiles = Object.fromEntries(Object.entries(value.files).map(([key, bytes]) => [key, Buffer.from(bytes)]));
  let publishInput;
  const result = await injectSharedSiteHero({
    row: value.row,
    asset: value.asset,
    operationKey: "hero-job-1",
  }, {
    loader: { async load() {
      return { ok: true, proofIdentity: value.proofIdentity, files: value.files, routeMap: value.routes };
    } },
    publisher: { supportsExpectedGenerationCas: true, async publish(input) {
      publishInput = input;
      return {
        ok: true,
        fallback: false,
        previewUrl: `https://${SLUG}.wss-ai.com/`,
        proofIdentity: { site_id: SITE_ID, release_id: NEXT_RELEASE_ID, build_hash: input.buildHash },
        releaseEvidence: {
          evidence_schema: "shared-site-release-evidence-v1",
          site_id: SITE_ID,
          release_id: NEXT_RELEASE_ID,
          build_hash: input.buildHash,
          canonical_host: `${SLUG}.wss-ai.com`,
          state: "active",
          generation: 8,
          hero_video_path: HERO_PATH,
          hero_video_sha256: value.asset.sha256,
        },
      };
    } },
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.proofIdentity.release_id, NEXT_RELEASE_ID);
  assert.equal(result.previousProofIdentity.release_id, RELEASE_ID);
  assert.equal(result.heroVideoSha256, value.asset.sha256);
  assert.equal(publishInput.parentReleaseId, RELEASE_ID);
  assert.equal(publishInput.expectedGeneration, 7);
  assert.equal(publishInput.heroVideoPath, HERO_PATH);
  assert.equal(publishInput.heroVideoSha256, value.asset.sha256);
  assert.deepEqual(publishInput.files[HERO_PATH], value.asset.bytes);
  assert.equal(publishInput.routeMap[`/${HERO_PATH}`], HERO_PATH);
  assert.notEqual(publishInput.buildHash, value.proofIdentity.build_hash);
  assert.deepEqual(value.files, oldFiles, "source release bytes stay immutable");
  assert.equal(value.row.sharedReleaseEvidence.release_id, RELEASE_ID, "source manifest evidence stays immutable");
});

test("partial or forged shared evidence selects the shared path and fails closed", async () => {
  const value = fixture();
  const cases = [
    { slug: SLUG, proofIdentity: value.proofIdentity },
    { ...value.row, sharedReleaseEvidence: { ...value.releaseEvidence, state: "verified" } },
    { ...value.row, sharedReleaseEvidence: { ...value.releaseEvidence, hero_video_sha256: "c".repeat(64) } },
    { ...value.row, sharedReleaseEvidence: { ...value.releaseEvidence, canonical_host: "other.wss-ai.com" } },
  ];
  for (const row of cases) {
    const selected = sharedHeroEvidenceFromRow(row);
    assert.equal(selected.selected, true);
    if (selected.ok === true) {
      let published = 0;
      const out = await injectSharedSiteHero({ row, asset: value.asset }, {
        loader: { async load() { return { ok: true, proofIdentity: value.proofIdentity, files: value.files, routeMap: value.routes }; } },
        publisher: { supportsExpectedGenerationCas: true, async publish() { published += 1; return { ok: true }; } },
      });
      assert.equal(out.ok, false);
      assert.equal(out.reason, "shared_hero_slot_bytes_mismatch");
      assert.equal(published, 0);
    } else {
      assert.equal(selected.ok, false);
    }
  }
});

test("real mirror persistence wrappers resolve one exact shared proof tuple", () => {
  const value = fixture();
  const nativeEvidence = {
    renderer: "mirror-engine@1",
    proofIdentity: value.proofIdentity,
    sharedReleaseEvidence: value.releaseEvidence,
  };
  for (const row of [
    {
      preview_url: `https://${SLUG}.wss-ai.com/`,
      record: { build_dispatch: { release_evidence: nativeEvidence } },
    },
    {
      preview_url: `https://${SLUG}.wss-ai.com/`,
      record: { release_evidence: nativeEvidence },
    },
  ]) {
    const selected = sharedHeroEvidenceFromRow(row);
    assert.equal(selected.ok, true, JSON.stringify(selected));
    assert.deepEqual(selected.identity, value.proofIdentity);
    assert.equal(selected.slug, SLUG, "slug is bound from the canonical shared host when no loose slug field exists");
    assert.equal(selected.generation, 7);
  }
});

test("conflicting duplicate persisted proof wrappers fail closed", () => {
  const value = fixture();
  const selected = sharedHeroEvidenceFromRow({
    record: {
      build_dispatch: {
        release_evidence: {
          proofIdentity: value.proofIdentity,
          sharedReleaseEvidence: value.releaseEvidence,
        },
      },
      release_evidence: {
        proofIdentity: { ...value.proofIdentity, release_id: NEXT_RELEASE_ID },
        sharedReleaseEvidence: { ...value.releaseEvidence, release_id: NEXT_RELEASE_ID },
      },
    },
  });
  assert.equal(selected.selected, true);
  assert.equal(selected.ok, false);
  assert.equal(selected.reason, "shared_hero_evidence_conflict");
});

test("unapproved or provenance-incomplete assets perform zero shared I/O", async () => {
  const value = fixture();
  for (const patch of [
    { approved: false },
    { verified: false },
    { source_sha256: "" },
    { approved_by: "" },
    { sha256: "d".repeat(64) },
    { retention: { class: "temporary", expires_at: null } },
  ]) {
    let io = 0;
    const out = await injectSharedSiteHero({ row: value.row, asset: { ...value.asset, ...patch } }, {
      loader: { async load() { io += 1; return {}; } },
      publisher: { supportsExpectedGenerationCas: true, async publish() { io += 1; return {}; } },
    });
    assert.equal(out.reason, "shared_hero_asset_not_approved");
    assert.equal(io, 0);
  }
});

test("publisher/CAS mismatch never falls back to the legacy rebuild lane", async () => {
  const value = fixture();
  const variants = [
    { ok: false, reason: "cas_conflict", fallback: false },
    {
      ok: true,
      fallback: false,
      previewUrl: `https://${SLUG}.wss-ai.com/`,
      proofIdentity: { site_id: SITE_ID, release_id: NEXT_RELEASE_ID, build_hash: "f".repeat(64) },
      releaseEvidence: { site_id: SITE_ID, release_id: NEXT_RELEASE_ID, build_hash: "f".repeat(64), canonical_host: `${SLUG}.wss-ai.com`, state: "active", generation: 8, hero_video_path: HERO_PATH, hero_video_sha256: value.asset.sha256 },
    },
  ];
  for (const publication of variants) {
    const out = await injectSharedSiteHero({ row: value.row, asset: value.asset }, {
      loader: { async load() { return { ok: true, proofIdentity: value.proofIdentity, files: value.files, routeMap: value.routes }; } },
      publisher: { supportsExpectedGenerationCas: true, async publish() { return publication; } },
    });
    assert.equal(out.ok, false);
    assert.equal(out.selected, true);
    assert.equal(out.fallback, false);
    assert.equal(out.reason, "shared_hero_publish_receipt_mismatch");
  }
});

test("exact kill switch is the only legacy opt-out", () => {
  assert.equal(sharedHeroInjectionEnabled({}), true);
  assert.equal(sharedHeroInjectionEnabled({ GHOST_AGENCY_SHARED_HERO_INJECTION: "0" }), false);
  assert.equal(sharedHeroInjectionEnabled({ GHOST_AGENCY_SHARED_HERO_INJECTION: "false" }), true);
});

test("default loader reads only the exact immutable manifest tree and verifies every byte", async () => {
  const value = fixture();
  const files = value.files;
  const prefix = `sites/${SITE_ID}/releases/${RELEASE_ID}/`;
  const filePrefix = `${prefix}files/`;
  const manifest = {
    schema: "wss-shared-site-release/v1",
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    build_hash: value.proofIdentity.build_hash,
    canonical_host: `${SLUG}.wss-ai.com`,
    route_generation: 7,
    routes: value.routes,
    files: Object.fromEntries(Object.entries(files).map(([rel, body]) => [rel, {
      key: `${filePrefix}${rel}`,
      sha256: hash(body),
      bytes: body.length,
      mime: rel.endsWith(".mp4") ? "video/mp4" : "text/html",
    }])),
  };
  const manifestBody = Buffer.from(JSON.stringify(manifest));
  const evidence = {
    ...value.releaseEvidence,
    manifest_sha256: hash(manifestBody),
  };
  const objects = new Map([
    [`${prefix}manifest.json`, manifestBody],
    ...Object.entries(files).map(([rel, body]) => [`${filePrefix}${rel}`, body]),
  ]);
  const calls = [];
  const loader = createDefaultSharedSiteReleaseLoader({
    env: { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "secret-not-logged" },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const encodedTail = String(url).split("/wss-site-releases/")[1];
      const key = encodedTail.split("/").map(decodeURIComponent).join("/");
      const body = objects.get(key);
      return { ok: Boolean(body), async arrayBuffer() { return body; } };
    },
  });
  const loaded = await loader.load({ proofIdentity: value.proofIdentity, releaseEvidence: evidence });
  assert.equal(loaded.ok, true, JSON.stringify(loaded));
  assert.deepEqual(loaded.files, files);
  assert.deepEqual(loaded.routeMap, value.routes);
  assert.equal(calls.length, 3);
  assert.ok(calls.slice(1).every(({ url }) => String(url).includes("/files/")),
    "release bytes use the immutable <release>/files/<rel> manifest contract");
  assert.ok(calls.every(({ options }) => options.headers.apikey === "secret-not-logged"));

  objects.set(`${filePrefix}${HERO_PATH}`, Buffer.from("tampered"));
  const refused = await loader.load({ proofIdentity: value.proofIdentity, releaseEvidence: evidence });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "shared_hero_release_file_mismatch");
});
