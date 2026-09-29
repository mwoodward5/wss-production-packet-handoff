import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildReleaseEvidenceChecks, releaseEvidenceFromQc } from "../lib/engine-adapter.mjs";

const VISUAL_MAP_CHECKS = [
  { name: "visual-satellite-map-evidence", pass: true, detail: "satellite map confirmed by rendered DOM, 8 page screenshots, and a map crop" },
  { name: "visual-address-map-directions", pass: true, detail: "address confirmed; satellite=true, directions=true" },
];

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "siteforge-release-evidence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "screenshots", "desktop"), { recursive: true });
  writeFileSync(path.join(root, "index.html"), `<!doctype html><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [{
      "@type": ["Plumber", "LocalBusiness"],
      name: "North Star Plumbing",
      address: { "@type": "PostalAddress", addressLocality: "Springfield", addressRegion: "IL" },
      areaServed: { "@type": "City", name: "Springfield, IL" },
      sameAs: ["https://www.northstarplumbing.example/services"],
    }],
  })}</script>`);
  writeFileSync(path.join(root, "packet.json"), JSON.stringify({
    business: {
      name: "North Star Plumbing",
      city: "Springfield",
      state: "IL",
      current_website: "https://northstarplumbing.example/",
    },
    hero_family: "service-map-pins",
  }));
  const mapEvidence = {
    pass: true,
    provider: "esri-world-imagery",
    response_ok: true,
    capture_origin: "https://siteforge.invalid",
    geometry_ok: true,
    pixels_ok: true,
    unique_colors: 32,
    variance: 120,
    artifact: "screenshots/desktop/map.png",
    detail: "rendered satellite map verified",
  };
  writeFileSync(path.join(root, "screenshots", "map-evidence.json"), JSON.stringify(mapEvidence));
  writeFileSync(path.join(root, "screenshots", "manifest.json"), JSON.stringify({
    schema: "siteforge-screenshot-manifest-v1",
    index_sha256: "a".repeat(64),
    map_evidence: mapEvidence,
  }));
  writeFileSync(
    path.join(root, "screenshots", "desktop", "map.png"),
    Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(128, 42)]),
  );
  return root;
}

const expectation = {
  business_name: "North Star Plumbing",
  city: "Springfield",
  state: "IL",
  source_website: "https://northstarplumbing.example/",
  template_family: "service-map-pins",
};

test("release evidence is assembled only from concrete passing artifacts", (t) => {
  const root = fixture(t);
  const results = buildReleaseEvidenceChecks(root, expectation, VISUAL_MAP_CHECKS);
  assert.deepEqual(results.map((result) => [result.name, result.pass, result.advisory_failed === true]), [
    ["release-map-evidence", true, false],
    ["release-business-identity-match", true, false],
    ["release-template-family-match", true, false],
  ]);

  const evidence = releaseEvidenceFromQc({ results });
  assert.equal(evidence.schema, "siteforge-release-evidence-v1");
  assert.match(evidence.map.screenshot.sha256, /^[a-f0-9]{64}$/);
  assert.equal(evidence.map.verified, true);
  assert.equal(evidence.map.waived, undefined);
  assert.equal(evidence.identity.actual.business_name, "North Star Plumbing");
  assert.deepEqual(evidence.identity.expected, {
    business_name: "North Star Plumbing",
    city: "Springfield",
    state: "IL",
    source_website: "https://northstarplumbing.example/",
    source: "stage_payload.release_expectation",
  });
  assert.equal(evidence.identity.actual.city, "Springfield");
  assert.equal(evidence.identity.actual.public_packet_city, "Springfield");
  assert.equal(evidence.identity.actual.state, "IL");
  assert.equal(evidence.identity.actual.public_packet_state, "IL");
  assert.equal(evidence.identity.actual.source_website, "https://www.northstarplumbing.example/services");
  assert.equal(evidence.identity.actual.public_packet_source_website, "https://northstarplumbing.example/");
  assert.equal(evidence.template_family.actual.family, "service-map-pins");
  assert.equal(evidence.template_family.actual.known_family, true);
  assert.equal(evidence.template_family.expected.selection, "pinned");
  assert.equal(evidence.template_family.verified, true);
  assert.equal(evidence.template_family.waived, undefined);
});

test("missing map proof remains waived while a valid auto-selected family is verified; identity mismatch still fails closed", (t) => {
  const root = fixture(t);
  unlinkSync(path.join(root, "screenshots", "desktop", "map.png"));
  writeFileSync(path.join(root, "packet.json"), JSON.stringify({
    business: { name: "Different Plumbing" },
    hero_family: "service-map-pins",
  }));

  const results = buildReleaseEvidenceChecks(root, {
    business_name: "North Star Plumbing",
    template_family: "auto",
  }, VISUAL_MAP_CHECKS);
  assert.deepEqual(results.map((result) => [result.name, result.pass, result.advisory_failed === true]), [
    ["release-map-evidence", true, true],
    ["release-business-identity-match", false, false],
    ["release-template-family-match", true, false],
  ]);

  const map = results.find((result) => result.name === "release-map-evidence");
  assert.match(map.detail, /^advisory: map evidence unverified \(waived\)/);
  assert.equal(map.evidence.waived, true);
  assert.equal(map.evidence.screenshot, null); // the real absence — never a fabricated capture
  assert.equal(map.evidence.runtime.unique_colors, 32); // real unverified runtime numbers survive
  const family = results.find((result) => result.name === "release-template-family-match");
  assert.match(family.detail, /^rendered valid auto-selected template family service-map-pins$/);
  assert.equal(family.evidence.waived, undefined);
  assert.equal(family.evidence.expected.selection, "auto");
  assert.equal(family.evidence.actual.known_family, true);

  // Identity is the honesty floor: with the wrong business rendered, no
  // release evidence envelope may be assembled at all.
  assert.equal(releaseEvidenceFromQc({ results }), null);
});

test("auto family fails closed to an honest waiver when the rendered family is not built in", (t) => {
  const root = fixture(t);
  const packetPath = path.join(root, "packet.json");
  const packet = JSON.parse(readFileSync(packetPath, "utf8"));
  packet.hero_family = "unknown-customer-template";
  writeFileSync(packetPath, JSON.stringify(packet));

  const results = buildReleaseEvidenceChecks(root, {
    ...expectation,
    template_family: "auto",
  }, VISUAL_MAP_CHECKS);
  const family = results.find((result) => result.name === "release-template-family-match");

  assert.equal(family.pass, true);
  assert.equal(family.advisory_failed, true);
  assert.match(family.detail, /^advisory: template family unverified \(waived\)/);
  assert.equal(family.evidence.waived, true);
  assert.equal(family.evidence.expected.selection, "auto");
  assert.equal(family.evidence.actual.family, "unknown-customer-template");
  assert.equal(family.evidence.actual.known_family, false);

  const evidence = releaseEvidenceFromQc({ results });
  assert.equal(evidence.template_family.verified, false);
  assert.equal(evidence.template_family.waived, true);
});

test("same-name entity evidence fails closed on rendered city, state, or source host mismatch", (t) => {
  const root = fixture(t);
  const indexPath = path.join(root, "index.html");
  const packetPath = path.join(root, "packet.json");

  writeFileSync(indexPath, readFileSync(indexPath, "utf8").replaceAll("Springfield", "Shelbyville"));
  let results = buildReleaseEvidenceChecks(root, expectation, VISUAL_MAP_CHECKS);
  assert.equal(results.find((result) => result.name === "release-business-identity-match").pass, false);
  assert.equal(releaseEvidenceFromQc({ results }), null);

  writeFileSync(indexPath, readFileSync(indexPath, "utf8")
    .replaceAll("Shelbyville", "Springfield")
    .replace("Springfield, IL", "Springfield, MO")
    .replace("addressRegion\":\"IL", "addressRegion\":\"MO"));
  results = buildReleaseEvidenceChecks(root, expectation, VISUAL_MAP_CHECKS);
  assert.equal(results.find((result) => result.name === "release-business-identity-match").pass, false);
  assert.equal(releaseEvidenceFromQc({ results }), null);

  const html = readFileSync(indexPath, "utf8")
    .replace("Springfield, MO", "Springfield, IL")
    .replace("addressRegion\":\"MO", "addressRegion\":\"IL")
    .replace("northstarplumbing.example/services", "northstarplumbing-missouri.example/services");
  writeFileSync(indexPath, html);
  const packet = JSON.parse(readFileSync(packetPath, "utf8"));
  packet.business.current_website = "https://northstarplumbing-missouri.example/";
  writeFileSync(packetPath, JSON.stringify(packet));
  results = buildReleaseEvidenceChecks(root, expectation, VISUAL_MAP_CHECKS);
  assert.equal(results.find((result) => result.name === "release-business-identity-match").pass, false);
  assert.equal(releaseEvidenceFromQc({ results }), null);
});

test("a map QC result that passed only because no address was required is waived, not verified", (t) => {
  const root = fixture(t);
  const results = buildReleaseEvidenceChecks(root, expectation, [
    { name: "visual-satellite-map-evidence", pass: true, detail: "no confirmed address; satellite map not required" },
    { name: "visual-address-map-directions", pass: true, detail: "no confirmed address; satellite map not required" },
  ]);
  const map = results.find((result) => result.name === "release-map-evidence");
  assert.equal(map.pass, true);
  assert.equal(map.advisory_failed, true);
  assert.equal(map.evidence.waived, true);
  assert.match(map.detail, /^advisory: /);
});

test("waived map evidence keeps real capture data and is marked unverified in the envelope", (t) => {
  const root = fixture(t);
  unlinkSync(path.join(root, "screenshots", "desktop", "map.png"));

  const results = buildReleaseEvidenceChecks(root, expectation, VISUAL_MAP_CHECKS);
  const evidence = releaseEvidenceFromQc({ results });
  assert.equal(evidence.schema, "siteforge-release-evidence-v1");
  assert.equal(evidence.map.verified, false);
  assert.equal(evidence.map.waived, true);
  assert.equal(evidence.map.screenshot, null);
  assert.equal(evidence.map.runtime.unique_colors, 32);
  assert.equal(evidence.identity.verified, true);
  assert.equal(evidence.template_family.verified, true);
  assert.equal(evidence.template_family.waived, undefined);
});
