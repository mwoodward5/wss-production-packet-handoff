"use strict";

const assert = require("node:assert/strict");
const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const base = (process.env.GHOST_AGENCY_API_URL || "https://ghost-agency-backend.vercel.app").replace(/\/+$/, "");
const proof = process.env.HARDENING_PROOF;
const outputDir = path.resolve(__dirname, "..", "docs", "proof", "pre-scale-2026-07-09");

const INTERNAL_TERMS = [
  "pagehub", "ricardo", "firecrawl", "brightlocal", "brightdata", "leadminer", "ghost agency",
  "truth_packet", "scrape", "crawler", "vapi", "twilio", "wss",
];

function writeJson(name, value) {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(path.join(outputDir, name), `${JSON.stringify(value, null, 2)}\n`);
}

async function request(route, options = {}) {
  const response = await fetch(`${base}${route}`, {
    ...options,
    headers: {
      "x-hardening-proof": proof,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 1000) }; }
  return { status: response.status, ok: response.ok, json };
}

function scanPublic(html) {
  const text = String(html || "");
  const internal = INTERNAL_TERMS.filter((term) => new RegExp(`\\b${term.replace(/\s+/g, "[\\s_-]+")}\\b`, "i").test(text));
  const rawPlaces = ["point_of_interest", "establishment", "general_contractor", "landscaper"]
    .filter((term) => new RegExp(`\\b${term}\\b`, "i").test(text));
  const malformed = [...text.matchAll(/\b[A-Z][A-Za-z .'-]{1,50}\s+[A-Z]{2},\s*[A-Z]{2}\b/g)].map((match) => match[0]);
  return { ok: !internal.length && !rawPlaces.length && !malformed.length, internal, rawPlaces, malformed };
}

const wBrothersTruth = {
  meta: { version: "goldilocks.v1", source: "captured-production-replay", bounded: true },
  identity: {
    name: { value: "W BROTHERS LANDSCAPE, Inc.", confidence: 0.95 },
    city: { value: "Orange CA", confidence: 0.95 },
    state: { value: "TX", confidence: 0.2 },
    category: { value: "landscaping", confidence: 0.95 },
  },
  services: ["landscaper", "point_of_interest", "establishment", "general_contractor"],
  photos: [],
  reviewThemes: { count: 0, themes: [], quotes: [] },
  opportunities: [],
};

const richardTruth = {
  meta: { version: "goldilocks.v1", source: "https://richarddiazlandscaping.com/", bounded: true },
  identity: {
    name: { value: "Richard Diaz Landscape & Masonry", confidence: 0.99 },
    phone: { value: "(714) 673-2643", confidence: 0.99 },
    address: { value: "633 North Heatherstone Drive, Orange, CA 92869", confidence: 0.98 },
    city: { value: "Orange", confidence: 0.99 },
    state: { value: "CA", confidence: 0.99 },
    category: { value: "landscaping", confidence: 0.99 },
  },
  napConsistency: {
    consistent: false,
    checks: [{ field: "phone", match: false, site: "(480) 692-9646", other: "(714) 673-2643" }],
    mismatches: [{ field: "phone", site: "(480) 692-9646", other: "(714) 673-2643" }],
  },
  logo: "https://richarddiazlandscaping.com/wp-content/uploads/2025/04/IMG_3283-Richard-Diaz.png",
  photos: [
    "https://richarddiazlandscaping.com/wp-content/uploads/2025/04/masonry-67f02b2002118-e1771881308671.webp",
    "https://richarddiazlandscaping.com/wp-content/uploads/2025/04/custom-landscape-design-67f02b67e57ac.webp",
    "https://richarddiazlandscaping.com/wp-content/uploads/2025/04/s1.webp",
    "https://richarddiazlandscaping.com/wp-content/uploads/2025/04/s2-67f0258ed6d4d.webp",
    "https://richarddiazlandscaping.com/wp-content/uploads/2025/04/s3-67f0256fedb4a.webp",
    "https://richarddiazlandscaping.com/wp-content/uploads/2025/04/s4-67f0258c58c74.webp",
    "https://richarddiazlandscaping.com/wp-content/uploads/2025/04/s5-67f0258902f73.webp",
    "https://richarddiazlandscaping.com/wp-content/uploads/2025/04/s6.webp"
  ],
  services: ["Landscape design", "Masonry", "Hardscaping", "Concrete", "Retaining and block walls", "Pavers", "Outdoor kitchens and BBQs", "Pergolas"],
  reviewThemes: { count: 33, themes: [], quotes: [] },
  opportunities: [{
    type: "nap_mismatch",
    severity: "high",
    headline: "The website phone does not match the Google business profile",
    detail: "The site header shows (480) 692-9646 while the Google profile and primary contact use (714) 673-2643.",
  }],
  counts: { photos: 8, services: 8, reviews: 33 },
};

async function build(prospect, truthPacket, source) {
  return request("/api/admin/build-preview", {
    method: "POST",
    body: JSON.stringify({ prospect, truth_packet: truthPacket, source }),
  });
}

async function fetchArtifact(url) {
  const response = await fetch(url);
  const text = await response.text();
  return { status: response.status, ok: response.ok, text };
}

async function main() {
  if (!proof) throw new Error("HARDENING_PROOF missing");
  const sendProof = process.argv.includes("--confirm-send");

  const status = await request("/api/proof/hardening-status");
  assert.equal(status.status, 200);
  assert.equal(status.json.reviewHold, true);
  assert.equal(status.json.dripBatch, 0);
  assert.equal(status.json.outreachSender?.domain, "go.wss-ai.com");
  assert.equal(status.json.outreachDns?.ok, true);

  const drip = await request("/api/cron/drip-scheduler", { method: "POST", body: "{}" });
  assert.equal(drip.status, 200);
  assert.equal(drip.json.mode, "review_hold");
  assert.equal(drip.json.sent, 0);

  if (process.argv.includes("--repair-w-brothers-only")) {
    const repair = await build({
      prospect_id: "place-chijp3f5qltf3iar5efsdfbwag8",
      business_name: "W BROTHERS LANDSCAPE, Inc.",
      industry: "landscaping",
      city: "Orange CA",
      state: "TX",
      current_website: "http://wbroslandscape.com/",
      services: ["landscaper", "point_of_interest", "establishment", "general_contractor"],
    }, wBrothersTruth, "public_surface_existing_prospect_repair");
    assert.equal(repair.status, 200);
    assert.equal(repair.json.ok, true, JSON.stringify(repair.json));
    assert.equal(repair.json.renderer, "05-build-v7");
    assert.equal(repair.json.qc_passed, true);
    const html = await fetchArtifact(repair.json.preview_url);
    const report = await fetchArtifact(repair.json.report_url);
    const scan = scanPublic(`${html.text}\n${report.text}`);
    assert.equal(scan.ok, true);
    const result = { build: repair.json, scan };
    writeJson("w-brothers-repaired-preview.json", result);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const replay = await build({
    prospect_id: "public-surface-live-proof-20260709",
    business_name: "W BROTHERS LANDSCAPE, Inc.",
    industry: "landscaping",
    city: "Orange CA",
    state: "TX",
    current_website: "http://wbroslandscape.com/",
    services: ["landscaper", "point_of_interest", "establishment", "general_contractor"],
  }, wBrothersTruth, "public_surface_live_replay");
  assert.equal(replay.status, 200);
  assert.equal(replay.json.ok, true, JSON.stringify(replay.json));
  assert.equal(replay.json.renderer, "05-build-v7");
  assert.equal(replay.json.qc_passed, true);
  const replayHtml = await fetchArtifact(replay.json.preview_url);
  const replayReport = await fetchArtifact(replay.json.report_url);
  const replayScan = scanPublic(`${replayHtml.text}\n${replayReport.text}`);
  assert.equal(replayScan.ok, true);
  assert.match(replayHtml.text, /Orange, CA/);
  writeJson("w-brothers-live-replay.json", { build: replay.json, scan: replayScan });

  const richard = await build({
    prospect_id: "richard-diaz-landscape",
    business_name: "Richard Diaz Landscape & Masonry",
    industry: "landscaping",
    city: "Orange",
    state: "CA",
    email: "richardsanchezdiaz3@gmail.com",
    phone: "(714) 673-2643",
    address: "633 North Heatherstone Drive, Orange, CA 92869",
    current_website: "https://richarddiazlandscaping.com/",
    services: richardTruth.services,
  }, richardTruth, "golden_richard_live_truth");
  assert.equal(richard.status, 200);
  assert.equal(richard.json.ok, true, JSON.stringify(richard.json));
  assert.equal(richard.json.renderer, "05-build-v7");
  assert.equal(richard.json.qc_passed, true);
  const richardHtml = await fetchArtifact(richard.json.preview_url);
  const richardReport = await fetchArtifact(richard.json.report_url);
  const richardScan = scanPublic(`${richardHtml.text}\n${richardReport.text}`);
  assert.equal(richardScan.ok, true);
  writeJson("richard-diaz-truth-packet.json", richardTruth);
  writeJson("richard-diaz-build.json", { build: richard.json, scan: richardScan });
  writeFileSync(path.join(outputDir, "richard-diaz-ghost-report.json"), `${richardReport.text.trim()}\n`);

  let emailProof = { skipped: true };
  if (sendProof) {
    emailProof = await request("/api/proof/outreach-email-smoke", {
      method: "POST",
      body: JSON.stringify({ confirm: "SEND_OUTREACH_PROOF" }),
    });
    assert.equal(emailProof.status, 200);
    assert.equal(emailProof.json.ok, true);
    assert.match(emailProof.json.from, /@go\.wss-ai\.com>?$/i);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    safetyHold: { status: status.json, drip: drip.json },
    publicReplay: { preview_url: replay.json.preview_url, report_url: replay.json.report_url, scan: replayScan },
    richard: { preview_url: richard.json.preview_url, report_url: richard.json.report_url, renderer: richard.json.renderer, qc_passed: richard.json.qc_passed, scan: richardScan },
    outreachEmail: emailProof.json || emailProof,
    liveSends: sendProof ? 1 : 0,
    liveCharges: 0,
  };
  writeJson("verification-summary.json", summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
