"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { prospectBuildInput } = require("../lib/full-run");
const { buildMirrorForProspect } = require("../lib/mirror-lane-build");
const { buildHash } = require("../lib/mirror-engine/build-hash");
const {
  resolveBrandAssets,
  normalizedOriginPhotoUrl,
  originPhotoUrlsHash,
  originVideoUrlHash,
  sourcePacketHash,
  photoBankHash,
} = require("../lib/mirror-engine/brand-assets");
const { sameOwner, ownsLogo } = require("../lib/web-brand");

const HASH_BASE = {
  donor: "fixture-plumbing",
  donorHash: "d".repeat(64),
  facts: { business_name: "Victim Plumbing", industry: "plumbing", city: "Leeds", state: "" },
  phoneDigits: "",
  hero: {},
  content: {},
};

test("multi-label public suffixes cannot make two companies one logo owner", () => {
  for (const suffix of ["co.uk", "co.kr", "com.ar"]) {
    const site = `https://victim.${suffix}/`;
    const competitor = `https://competitor.${suffix}/logo.png`;
    assert.equal(sameOwner(site, competitor), false, suffix);
    assert.equal(ownsLogo(site, competitor, "Victim Plumbing", {}), false, suffix);
    assert.equal(sameOwner(site, `https://cdn.victim.${suffix}/logo.png`), true, `${suffix} child host`);
  }
});

test("a verified subdomain never grants logo ownership to its parent host", () => {
  assert.equal(sameOwner("https://victim.co.uk/", "https://co.uk/logo.png"), false);
  assert.equal(sameOwner("https://jobs.victim.co.uk/", "https://victim.co.uk/logo.png"), false);
  assert.equal(sameOwner("https://victim.co.uk/", "https://cdn.victim.co.uk/logo.png"), true);
});

test("public suffix roots can never become verified logo owners", () => {
  assert.equal(sameOwner("https://co.uk/", "https://victim.co.uk/logo.png"), false);
  assert.equal(sameOwner("https://com/", "https://victim.com/logo.png"), false);
  assert.equal(ownsLogo("https://co.uk/", "https://victim.co.uk/logo.png", "Victim Plumbing", {}), false);
});

test("an exact IP host remains a valid owner without gaining child-host powers", () => {
  assert.equal(sameOwner("https://203.0.113.77/", "https://203.0.113.77/logo.svg"), true);
  assert.equal(sameOwner("https://203.0.113.77/", "https://cdn.203.0.113.77/logo.svg"), false);
  assert.equal(sameOwner("https://203.0.113.77/", "https://victim.example/logo.svg"), false);
});

test("known shared hosting roots never gain ownership of tenant subdomains", () => {
  for (const root of ["blogspot.com", "github.io", "pages.dev", "vercel.app", "netlify.app"]) {
    assert.equal(sameOwner(`https://${root}/`, `https://victim.${root}/logo.svg`), false, root);
  }
});

test("a compiler-labelled competitor logo is refused by the full build boundary", async () => {
  const competitorLogo = "https://competitor.co.uk/logo.png";
  const prospect = prospectBuildInput({
    prospect_id: "place_victim_1",
    business_name: "Victim Plumbing",
    industry: "plumbing",
    city: "Leeds",
    current_website: "https://victim.co.uk/",
  }, {
    intakeGenie: {
      assets: [{ kind: "logo", url: competitorLogo, source: "website" }],
    },
  });
  assert.equal(prospect.logo_url, competitorLogo, "exercise the new packet-logo path");

  let mirrorCalls = 0;
  const result = await buildMirrorForProspect(prospect, {
    deps: {
      resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-clean", vertical: "plumbing" }),
      mirror: async () => { mirrorCalls += 1; return { status: 200, body: { ok: true } }; },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "logo_provenance_failed");
  assert.equal(mirrorCalls, 0);
});

test("media mode participates in the canonical build identity", async () => {
  const housed = await resolveBrandAssets({ media_mode: "housed" });
  const origin = await resolveBrandAssets({ media_mode: "origin" });
  assert.match(housed.hashes.media_mode_sha, /^[0-9a-f]{64}$/);
  assert.match(origin.hashes.media_mode_sha, /^[0-9a-f]{64}$/);
  assert.notEqual(housed.hashes.media_mode_sha, origin.hashes.media_mode_sha);
  assert.notEqual(
    buildHash({ ...HASH_BASE, brandHashes: housed.hashes }),
    buildHash({ ...HASH_BASE, brandHashes: origin.hashes }),
  );
});

test("normalized verified origin photo URLs participate in build identity", () => {
  const first = [{
    ok: true,
    originUrl: "https://CDN.Example:443/job.jpg?token=one#ignored",
  }];
  const equivalent = [{
    ok: true,
    originUrl: "https://cdn.example/job.jpg?token=one",
  }];
  const changed = [{
    ok: true,
    originUrl: "https://cdn.example/job.jpg?token=two",
  }];
  assert.equal(
    normalizedOriginPhotoUrl(first[0].originUrl),
    normalizedOriginPhotoUrl(equivalent[0].originUrl),
  );
  assert.equal(originPhotoUrlsHash(first), originPhotoUrlsHash(equivalent));
  assert.notEqual(originPhotoUrlsHash(first), originPhotoUrlsHash(changed));

  const common = { media_mode_sha: "m".repeat(64), photos_sha: ["p".repeat(64)] };
  const firstHash = buildHash({
    ...HASH_BASE,
    brandHashes: { ...common, origin_photo_urls_sha: originPhotoUrlsHash(first) },
  });
  const changedHash = buildHash({
    ...HASH_BASE,
    brandHashes: { ...common, origin_photo_urls_sha: originPhotoUrlsHash(changed) },
  });
  assert.notEqual(firstHash, changedHash);
});

test("normalized verified origin video URL participates in build identity", () => {
  const first = "https://VIDEO.Example:443/hero.mp4?token=one#ignored";
  const equivalent = "https://video.example/hero.mp4?token=one";
  const changed = "https://video.example/hero.mp4?token=two";
  assert.equal(originVideoUrlHash(first), originVideoUrlHash(equivalent));
  assert.notEqual(originVideoUrlHash(first), originVideoUrlHash(changed));

  const common = { media_mode_sha: "m".repeat(64), hero_video: "v".repeat(64) };
  assert.notEqual(
    buildHash({
      ...HASH_BASE,
      brandHashes: { ...common, origin_video_url_sha: originVideoUrlHash(first) },
    }),
    buildHash({
      ...HASH_BASE,
      brandHashes: { ...common, origin_video_url_sha: originVideoUrlHash(changed) },
    }),
  );
});

test("Packet2 source snapshot is canonical and hash-driving without exposing its fields", async () => {
  const snapshot = "a".repeat(64);
  const first = {
    contract: "pagehub-build-packet",
    packet_id: `pagehub:${snapshot.slice(0, 24)}`,
    snapshot_sha256: snapshot,
  };
  const equivalent = {
    snapshot_sha256: snapshot.toUpperCase(),
    packet_id: `PAGEHUB:${snapshot.slice(0, 24)}`,
    contract: "pagehub-build-packet",
  };
  const changedSnapshot = `b${snapshot.slice(1)}`;
  const changed = {
    contract: "pagehub-build-packet",
    packet_id: `pagehub:${changedSnapshot.slice(0, 24)}`,
    snapshot_sha256: changedSnapshot,
  };
  assert.equal(sourcePacketHash(first), sourcePacketHash(equivalent));
  assert.notEqual(sourcePacketHash(first), sourcePacketHash(changed));

  const out = await resolveBrandAssets({ source_packet: first });
  assert.match(out.hashes.source_packet_sha, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(out.hashes).includes(snapshot), false);
  assert.notEqual(
    buildHash({ ...HASH_BASE, brandHashes: out.hashes }),
    buildHash({ ...HASH_BASE, brandHashes: { ...out.hashes, source_packet_sha: sourcePacketHash(changed) } }),
  );
});

test("ordered photo-bank hero and identity flags participate in build identity", async () => {
  const hero = {
    url: "https://victim.example/hero.jpg",
    sha256: "1".repeat(64),
    grade: "hero",
    source: "own_site",
    width: 1600,
    height: 900,
    current_hero: true,
  };
  const owner = {
    url: "https://victim.example/owner.jpg",
    sha256: "2".repeat(64),
    grade: "gallery",
    source: "own_site",
    width: 1200,
    height: 900,
    identity_critical: true,
  };
  const first = { photos: [hero, owner] };
  const reordered = { photos: [owner, hero] };
  const reflagged = {
    photos: [
      { ...hero, current_hero: false },
      { ...owner, identity_critical: false, current_hero: true },
    ],
  };
  const irrelevantMetadata = {
    harvested_at: "2099-01-01T00:00:00.000Z",
    photos: [
      { ...hero, caption: "audit only" },
      { ...owner, confidence: 0.97 },
    ],
  };
  assert.equal(photoBankHash(first), photoBankHash(irrelevantMetadata));
  assert.notEqual(photoBankHash(first), photoBankHash(reordered));
  assert.notEqual(photoBankHash(first), photoBankHash(reflagged));

  const firstOut = await resolveBrandAssets({ photo_bank: first });
  const reflaggedOut = await resolveBrandAssets({ photo_bank: reflagged });
  assert.match(firstOut.hashes.photo_bank_sha, /^[0-9a-f]{64}$/);
  assert.notEqual(
    buildHash({ ...HASH_BASE, brandHashes: firstOut.hashes }),
    buildHash({ ...HASH_BASE, brandHashes: reflaggedOut.hashes }),
  );
});
