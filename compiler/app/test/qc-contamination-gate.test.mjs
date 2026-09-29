import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  checkPublicArtifactContamination,
  PERMANENT_DONOR_DENYLIST,
} from "../../qc-audit/qc-contamination.mjs";
import {
  runQualityAudit,
  selectBatchCohortCandidates,
} from "../../qc-audit/qc.mjs";

function createSite(root, name, packet, files = {}) {
  const siteDir = path.join(root, name);
  mkdirSync(siteDir, { recursive: true });
  writeFileSync(path.join(siteDir, "packet.json"), JSON.stringify(packet, null, 2));
  writeFileSync(path.join(siteDir, "index.html"), files["index.html"] ?? "<!doctype html><main>Clean customer site</main>");
  for (const [relativePath, content] of Object.entries(files)) {
    if (relativePath === "index.html") continue;
    const filePath = path.join(siteDir, relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }
  return siteDir;
}

function packet(name, overrides = {}) {
  return {
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    qc_cohort: { kind: "release", id: "release-five", trade: "roofing" },
    business: {
      name,
      phone: "(425) 555-0100",
      address: "100 Customer Way, Kirkland, WA",
      website: `https://${name.toLowerCase().replace(/[^a-z0-9]+/g, "")}.example`,
    },
    ...overrides,
  };
}

test("permanent Tekline donor atoms fail the public artifact gate despite formatting changes", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "sf-contamination-permanent-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const siteDir = createSite(root, "customer", packet("Customer Roofing"), {
    "index.html": `
      <a href="https://www.teklineroofing.com">donor</a>
      <a href="mailto:info@teklineroofing.com">email</a>
      <span>(206) 246-7663</span>
      <address>635 Industry Drive, Tukwila WA 98188</address>
      <address>609 Industry Dr, Tukwila WA 98188</address>
      <h2>TRUST TEKLINE</h2>
      <p>Your Hometown Roofing Services Provider</p>
      <p>Trustindex verifies that the original source of the review is Google.</p>
      <p>evezrytme</p>
      <p>License TEKLIR*850KQ · Fax (253) 277-9135 · YouTube RYnw1_yrrTU · Profiles 239555 and 1110499</p>
      <p>Scott Morrison, Managing Member</p>
      <p>$10.2 Million · 25 Employees</p>
      <p>TAKE A LOOK AT PEOPLE WHO HAVE TRUSTED TEKLINE!</p>
      <p>Top-rated roofing company serving customers in the greater Seattle, Bellevue and surrounding areas with over 25 years of roofing experience.</p>
    `,
  });
  const result = checkPublicArtifactContamination(siteDir);

  assert.equal(result.pass, false);
  assert.deepEqual(
    result.hits.map((hit) => hit.rule).sort(),
    PERMANENT_DONOR_DENYLIST.map((rule) => rule.id).sort(),
  );
  assert.match(result.detail, /forbidden donor\/cross-customer marker/);
});

test("Tekline street matching is boundary-safe for industry-driven copy", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "sf-contamination-boundary-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const cleanDir = createSite(root, "clean", packet("Customer Roofing"), {
    "index.html": "<main>Industry-driven service without donor content.</main>",
  });
  assert.equal(checkPublicArtifactContamination(cleanDir).pass, true);

  const blockedDir = createSite(root, "blocked", packet("Customer Roofing"), {
    "index.html": "<address>635 INDUSTRY-DR., Tukwila, WA</address>",
  });
  const blocked = checkPublicArtifactContamination(blockedDir);
  assert.equal(blocked.pass, false);
  assert.ok(blocked.hits.some((hit) => hit.rule === "tekline-street-635"));

  const unrelatedZipDir = createSite(root, "unrelated-zip", packet("Customer Roofing"), {
    "index.html": "<address>123 Customer Way, Seattle, WA 98188</address>",
  });
  assert.equal(checkPublicArtifactContamination(unrelatedZipDir).pass, true);

  const cleanNumbersDir = createSite(root, "clean-numbers", packet("Customer Roofing"), {
    "index.html": "<p>Model 206 ships in 246 colors across 7663 homes.</p><address>1635 Industry Drive</address>",
  });
  assert.equal(checkPublicArtifactContamination(cleanNumbersDir).pass, true);

  const legitimateTrustindexDir = createSite(root, "clean-trustindex", packet("Customer Roofing"), {
    "index.html": "<p>Trustindex verifies that the original source of the review is Google.</p>",
  });
  assert.equal(checkPublicArtifactContamination(legitimateTrustindexDir).pass, true);
});

test("other customers in the selected batch become a per-customer denylist", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "sf-contamination-batch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const currentDir = createSite(root, "current", packet("Roofing Formula LLC"), {
    "index.html": `
      <main>
        <h1>Sunset Roofing LLC</h1>
        <a href="tel:+15095550199">(509) 555-0199</a>
        <address>1714 E Bismark Ave</address>
        <blockquote>— Jamie Rivera</blockquote>
        <script>window.dataLayer = [{ gtm: "GTM-CROSS123" }]</script>
      </main>
    `,
    "assets.json": JSON.stringify({ items: [{ checksum: "f00dcafe1234" }] }),
  });
  const otherPacket = packet("Sunset Roofing LLC", {
    business: {
      name: "Sunset Roofing LLC",
      phone: "(509) 555-0199",
      address: "1714 E Bismark Ave, Spokane, WA",
      website: "https://sunsetroofing.example",
    },
    reviews: [{ author_name: "Jamie Rivera", text: "Great work" }],
    analytics: { gtm_id: "GTM-CROSS123" },
    media: { catalog: [{ url: "https://cdn.example/other.webp", checksum: "f00dcafe1234" }] },
  });
  const otherDir = createSite(root, "other", otherPacket);
  const result = checkPublicArtifactContamination(currentDir, {
    batchCandidates: [
      { siteDir: currentDir, packet: packet("Roofing Formula LLC") },
      { siteDir: otherDir, packet: otherPacket },
    ],
  });

  assert.equal(result.pass, false);
  assert.ok(result.hits.length >= 5, JSON.stringify(result.hits));
  assert.ok(result.hits.every((hit) => hit.source === "batch-customer-1"));
});

test("customer content hashes block cross-customer media without treating locator or ambiance hashes as proof", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "sf-contamination-hashes-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const exact = "a".repeat(64);
  const locator = "b".repeat(64);
  const ambiance = "c".repeat(64);
  const legacy = "f00dcafe1234";
  const otherPacket = packet("Other Customer", {
    business: {
      name: "Other Customer",
      phone: "(509) 555-0199",
      address: "900 Other Way, Spokane, WA",
      website: "https://othercustomer.example",
    },
    logo_source: {
      url: "/assets/logo.webp",
      asset_identity: { sha256: exact, method: "content-sha256" },
    },
    media: {
      hero: {
        selected: {
          url: "/assets/hero.webp",
          asset_identity: { sha256: exact, method: "declared-content-sha256" },
        },
        eligible: [
          {
            url: "https://cdn.example/shared.webp",
            asset_identity: { sha256: locator, method: "normalized-url-sha256" },
          },
          {
            url: "/assets/ambiance.webp",
            source: "ai-ambiance",
            asset_identity: { sha256: ambiance, method: "content-sha256" },
          },
          {
            url: "/assets/malformed.webp",
            asset_identity: { sha256: "d".repeat(63), method: "content-sha256" },
          },
        ],
      },
      catalog: [
        {
          url: "/assets/catalog.webp",
          asset_identity: { sha256: exact, method: "content-sha256" },
        },
        { url: "/assets/legacy.webp", checksum: legacy },
      ],
    },
  });
  const otherDir = createSite(root, "other", otherPacket);

  const blockedDir = createSite(root, "blocked", packet("Current Customer"), {
    "assets.json": JSON.stringify({ logo: exact, hero: exact, catalog: exact }),
  });
  const blocked = checkPublicArtifactContamination(blockedDir, {
    batchCandidates: [
      { siteDir: blockedDir, packet: packet("Current Customer") },
      { siteDir: otherDir, packet: otherPacket },
    ],
  });
  assert.equal(blocked.pass, false);
  assert.ok(blocked.hits.some((hit) => hit.files.includes("assets.json")));

  const cleanDir = createSite(root, "clean", packet("Clean Customer"), {
    "assets.json": JSON.stringify({
      locator,
      ambiance,
      malformed63: "d".repeat(63),
      malformed65: "e".repeat(65),
      nonhex: "z".repeat(64),
    }),
  });
  assert.equal(checkPublicArtifactContamination(cleanDir, {
    batchCandidates: [
      { siteDir: cleanDir, packet: packet("Clean Customer") },
      { siteDir: otherDir, packet: otherPacket },
    ],
  }).pass, true);

  const legacyDir = createSite(root, "legacy", packet("Legacy Customer"), {
    "assets.json": JSON.stringify({ checksum: legacy }),
  });
  assert.equal(checkPublicArtifactContamination(legacyDir, {
    batchCandidates: [
      { siteDir: legacyDir, packet: packet("Legacy Customer") },
      { siteDir: otherDir, packet: otherPacket },
    ],
  }).pass, false);

  const binaryBytes = Buffer.from("same-customer-photo-binary");
  const binaryOtherPacket = packet("Binary Other", {
    media: { catalog: [{ url: "media/photo.webp" }] },
  });
  const binaryCurrentPacket = packet("Binary Current", {
    media: { catalog: [{ url: "media/copied.webp" }] },
  });
  const binaryOther = createSite(root, "binary-other", binaryOtherPacket, {
    "media/photo.webp": binaryBytes,
  });
  const binaryCurrent = createSite(root, "binary-current", binaryCurrentPacket, {
    "media/copied.webp": binaryBytes,
  });
  const binaryResult = checkPublicArtifactContamination(binaryCurrent, {
    batchCandidates: [
      { siteDir: binaryCurrent, packet: binaryCurrentPacket },
      { siteDir: binaryOther, packet: binaryOtherPacket },
    ],
  });
  assert.equal(binaryResult.pass, false);
  assert.ok(binaryResult.hits.some((hit) => hit.files.includes("media/copied.webp")));

  const stockPacketA = packet("Stock A", {
    business: {
      name: "Stock A",
      phone: "(425) 555-0101",
      address: "101 Stock Way, Seattle, WA",
      website: "https://stock-a.example",
    },
    media: { catalog: [{ url: "media/shared.webp", source: "stock-ambiance" }] },
  });
  const stockPacketB = packet("Stock B", {
    business: {
      name: "Stock B",
      phone: "(509) 555-0102",
      address: "202 Stock Way, Spokane, WA",
      website: "https://stock-b.example",
    },
    media: { catalog: [{ url: "media/shared.webp", source: "ai-ambiance" }] },
  });
  const stockA = createSite(root, "stock-a", stockPacketA, { "media/shared.webp": binaryBytes });
  const stockB = createSite(root, "stock-b", stockPacketB, { "media/shared.webp": binaryBytes });
  assert.equal(checkPublicArtifactContamination(stockA, {
    batchCandidates: [
      { siteDir: stockA, packet: stockPacketA },
      { siteDir: stockB, packet: stockPacketB },
    ],
  }).pass, true);
});

test("contamination compares every customer sharing a release even across trades", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "sf-contamination-cross-trade-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const currentDir = createSite(root, "roofing", packet("Roofing Formula LLC"), {
    "index.html": "<main>Roofing Formula LLC copied Practical Plumbing LLC</main>",
  });
  const plumbingPacket = packet("Practical Plumbing LLC", {
    qc_cohort: { kind: "release", id: "release-five", trade: "plumbing" },
    business: {
      name: "Practical Plumbing LLC",
      phone: "(425) 555-0199",
      address: "200 Plumber Way, Kirkland, WA",
      website: "https://practicalplumbing.example",
    },
  });
  createSite(root, "plumbing", plumbingPacket);

  const tradeCohort = selectBatchCohortCandidates(root, currentDir).candidates;
  assert.equal(tradeCohort.length, 1);

  const releaseCohort = selectBatchCohortCandidates(
    root,
    currentDir,
    { matchTrade: false },
  ).candidates;
  assert.equal(releaseCohort.length, 2);

  const result = checkPublicArtifactContamination(currentDir, {
    batchCandidates: releaseCohort,
  });
  assert.equal(result.pass, false);
  assert.ok(result.hits.some((hit) => hit.source === "batch-customer-1"));
});

test("current customer identity is allowed and explicit customer denylist atoms are blocking", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "sf-contamination-explicit-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const cleanDir = createSite(root, "clean", packet("Roofing Formula LLC"), {
    "index.html": "<h1>Roofing Formula LLC</h1><a href='tel:4255550100'>(425) 555-0100</a>",
  });
  assert.equal(checkPublicArtifactContamination(cleanDir).pass, true);

  const blockedDir = createSite(root, "blocked", {
    ...packet("Roofing Formula LLC"),
    qc: {
      contamination_denylist: [
        { kind: "name", value: "Foreign Roofing Company" },
        { kind: "phone", value: "(303) 555-0198" },
      ],
    },
  }, {
    "assets/app.js": "const donor = 'Foreign Roofing Company'; const phone = '303.555.0198';",
  });
  const blocked = checkPublicArtifactContamination(blockedDir);
  assert.equal(blocked.pass, false);
  assert.equal(blocked.hits.length, 2);
  assert.ok(blocked.hits.every((hit) => hit.files.includes("assets/app.js")));
  assert.ok(blocked.hits.every((hit) => !hit.files.includes("packet.json")));

  const configuredButCleanDir = createSite(root, "configured-clean", {
    ...packet("Roofing Formula LLC"),
    contamination_denylist: ["Foreign Roofing Company"],
  });
  assert.equal(checkPublicArtifactContamination(configuredButCleanDir).pass, true);
});

test("QC report files are excluded so a recorded failure cannot self-trigger forever", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "sf-contamination-report-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const siteDir = createSite(root, "clean", packet("Clean Roofing"), {
    "qc-report.json": JSON.stringify({ old_detail: "206-246-7663 at Industry Dr 98188" }),
    "qc-report.html": "<p>teklineroofing</p>",
  });
  assert.equal(checkPublicArtifactContamination(siteDir).pass, true);
});

test("master QC includes contamination in the blocking failed results", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "sf-contamination-master-qc-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const siteDir = createSite(root, "blocked", packet("Customer Roofing"), {
    "index.html": `
      <!doctype html>
      <style>
        .hero { min-height: 720px; }
        .hero-grid { display: grid; grid-template-columns: 1fr 1fr; }
      </style>
      <section class="hero">
        <div class="hero-grid">
          <div data-hero-layer="media"></div>
          <div data-hero-layer="veil"></div>
          <div data-hero-layer="motif"></div>
          <div data-hero-layer="copy">Customer Roofing</div>
          <div data-hero-layer="proof">Call 206-246-7663</div>
          <div data-hero-layer="lead-widget"><button>Request service</button></div>
        </div>
      </section>
    `,
  });
  const quality = await runQualityAudit(siteDir, null, {
    visualResults: [],
    v7Results: [],
  });
  const gate = quality.results.find((result) => result.name === "public-artifact-contamination");

  assert.equal(gate?.pass, false);
  assert.ok(quality.failed.some((result) => result.name === "public-artifact-contamination"));
});
