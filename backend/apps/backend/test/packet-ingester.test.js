"use strict";

/**
 * test/packet-ingester.test.js
 *
 * lib/packet-ingester.js — MIME/ZIP email → packet dir.
 * Modelled on the reference A-grade implementation described in issue #316.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  ingestPacketEmail,
  findGenieJson,
  isGeniePacket,
  extractJsonBlock,
  splitMultipart,
  writePacketDir,
} = require("../lib/packet-ingester");

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

function anchorPacket(overrides = {}) {
  return {
    ok: true,
    version: "intake-genie-v2",
    status: "complete",
    scope: { supported: true, category: "plumbing" },
    facts: {
      name: "Anchor Plumbing",
      city: "Tucson",
      state: "AZ",
      category: "plumbing",
      phone: "(520) 900-1442",
      email: "owner@anchorplumbing.com",
      website: "https://anchorplumbing.com",
      services: ["Drain Cleaning", "Water Heater Repair"],
    },
    evidence: [{ field: "name", value: "Anchor Plumbing", source_type: "website", confidence: 0.95 }],
    assets: [
      { kind: "logo", url: "https://anchorplumbing.com/logo.png", approved: true },
    ],
    trust: { rating: 4.9, review_count: 312 },
    optimization: {
      target_queries: ["plumbing tucson az", "drain cleaning tucson"],
      meta_description: "Tucson plumbing by Anchor Plumbing — drain cleaning, water heater repair, repiping.",
    },
    content: {
      about: "Anchor Plumbing has served Tucson homeowners since 1998. We handle drain cleaning, water heater repair, and full repiping projects.",
      services: [
        { name: "Drain Cleaning", description: "Expert drain cleaning for Tucson homes and businesses." },
        { name: "Water Heater Repair" },
      ],
      faqs: [
        { q: "Do you offer same-day service?", a: "Yes, we offer same-day service in Tucson." },
        { q: "Are you licensed?", a: "Yes, fully licensed and insured in Arizona." },
      ],
    },
    ...overrides,
  };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pi-t-"));
}

// ---------------------------------------------------------------------------
// isGeniePacket
// ---------------------------------------------------------------------------

test("isGeniePacket recognises a canonical v2 packet", () => {
  assert.equal(isGeniePacket(anchorPacket()), true);
});

test("isGeniePacket recognises a structural packet without a version field", () => {
  const noVersion = { facts: { name: "X", city: "Y", category: "plumbing" } };
  assert.equal(isGeniePacket(noVersion), true);
});

test("isGeniePacket refuses null, arrays and random objects", () => {
  assert.equal(isGeniePacket(null), false);
  assert.equal(isGeniePacket([]), false);
  assert.equal(isGeniePacket({ status: "complete" }), false, "no facts and no version");
});

// ---------------------------------------------------------------------------
// extractJsonBlock
// ---------------------------------------------------------------------------

test("extractJsonBlock finds the first JSON object in prose", () => {
  const text = `Forwarded message below:\n${JSON.stringify(anchorPacket())}\n-- end --`;
  const result = extractJsonBlock(text);
  assert.equal(result && result.facts && result.facts.name, "Anchor Plumbing");
});

test("extractJsonBlock returns null when no JSON brace is present", () => {
  assert.equal(extractJsonBlock("no braces here"), null);
});

test("extractJsonBlock returns null when braces are unbalanced", () => {
  assert.equal(extractJsonBlock("{unclosed"), null);
});

// ---------------------------------------------------------------------------
// splitMultipart
// ---------------------------------------------------------------------------

test("splitMultipart yields one part for a single-part envelope", () => {
  const boundary = "TEST_BOUNDARY";
  const raw = `--${boundary}\r\nContent-Type: application/json\r\n\r\n{"hello":"world"}\r\n--${boundary}--`;
  const parts = splitMultipart(raw, boundary);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].headers.get("content-type"), "application/json");
  assert.match(parts[0].body, /"hello"/);
});

test("splitMultipart yields multiple parts", () => {
  const boundary = "MBOUNDARY";
  const raw = [
    `--${boundary}`,
    "Content-Type: text/plain",
    "",
    "Text body",
    `--${boundary}`,
    "Content-Type: application/json",
    "",
    '{"version":"intake-genie-v2"}',
    `--${boundary}--`,
  ].join("\n");
  const parts = splitMultipart(raw, boundary);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].headers.get("content-type"), "text/plain");
  assert.equal(parts[1].headers.get("content-type"), "application/json");
});

// ---------------------------------------------------------------------------
// findGenieJson — extraction from various email shapes
// ---------------------------------------------------------------------------

test("findGenieJson extracts from a plain-text body with inlined JSON", () => {
  const email = `From: genie@example.test\nTo: mark@example.test\nContent-Type: text/plain\n\n${JSON.stringify(anchorPacket())}`;
  const result = findGenieJson(email);
  assert.ok(result, "should find packet");
  assert.equal(result.facts.name, "Anchor Plumbing");
});

test("findGenieJson extracts from a multipart/mixed message with a JSON attachment", () => {
  const boundary = "----Part00001";
  const packet = anchorPacket();
  const body = [
    `--${boundary}`,
    "Content-Type: text/plain",
    "",
    "Please find the packet attached.",
    `--${boundary}`,
    `Content-Type: application/json`,
    `Content-Disposition: attachment; filename="packet.json"`,
    "",
    JSON.stringify(packet),
    `--${boundary}--`,
  ].join("\r\n");
  const email = `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n${body}`;
  const result = findGenieJson(email);
  assert.ok(result, "should extract from attachment");
  assert.equal(result.facts.city, "Tucson");
});

test("findGenieJson extracts a base64-encoded JSON attachment", () => {
  const boundary = "----B64Part";
  const packet = anchorPacket();
  const b64 = Buffer.from(JSON.stringify(packet)).toString("base64");
  const body = [
    `--${boundary}`,
    "Content-Type: application/json",
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="genie-packet.json"`,
    "",
    b64,
    `--${boundary}--`,
  ].join("\r\n");
  const email = `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n${body}`;
  const result = findGenieJson(email);
  assert.ok(result, "should decode base64 and find packet");
  assert.equal(result.facts.state, "AZ");
});

test("findGenieJson returns null when no recognisable packet is present", () => {
  assert.equal(findGenieJson("Hello World — no JSON here."), null);
  assert.equal(findGenieJson('{"just": "some object", "no_facts": true}'), null);
});

// ---------------------------------------------------------------------------
// writePacketDir
// ---------------------------------------------------------------------------

test("writePacketDir writes all expected files", () => {
  const base = tmpDir();
  const dir = writePacketDir(anchorPacket(), base);

  assert.ok(fs.existsSync(path.join(dir, "packet.json")), "packet.json");
  assert.ok(fs.existsSync(path.join(dir, "seo.json")), "seo.json");
  assert.ok(fs.existsSync(path.join(dir, "faqs.json")), "faqs.json");
  assert.ok(fs.existsSync(path.join(dir, "voice-search.json")), "voice-search.json");
  assert.ok(fs.existsSync(path.join(dir, "content", "home.md")), "home.md");

  const seo = JSON.parse(fs.readFileSync(path.join(dir, "seo.json"), "utf8"));
  assert.equal(seo.siteTitle, "Anchor Plumbing");
  assert.ok(seo.keywords.includes("plumbing tucson az"), "keyword from optimization");

  const faqs = JSON.parse(fs.readFileSync(path.join(dir, "faqs.json"), "utf8"));
  assert.equal(faqs.length, 2, "two FAQs written");
  assert.equal(faqs[0].q, "Do you offer same-day service?");

  const voice = JSON.parse(fs.readFileSync(path.join(dir, "voice-search.json"), "utf8"));
  assert.equal(voice.city, "Tucson");
  assert.equal(voice.primaryService, "Drain Cleaning");

  const home = fs.readFileSync(path.join(dir, "content", "home.md"), "utf8");
  assert.match(home, /Anchor Plumbing/);

  // Service page for drain-cleaning
  assert.ok(fs.existsSync(path.join(dir, "content", "services", "drain-cleaning.md")));

  fs.rmSync(base, { recursive: true, force: true });
});

test("writePacketDir names the directory after the business slug", () => {
  const base = tmpDir();
  const dir = writePacketDir(anchorPacket(), base);
  assert.match(path.basename(dir), /^anchor-plumbing-/);
  fs.rmSync(base, { recursive: true, force: true });
});

test("writePacketDir works for a packet with no content block", () => {
  const base = tmpDir();
  const p = anchorPacket();
  delete p.content;
  const dir = writePacketDir(p, base);
  assert.ok(fs.existsSync(path.join(dir, "packet.json")));
  // home.md and services/ should be absent/empty without a content block
  assert.equal(fs.existsSync(path.join(dir, "content", "home.md")), false);
  fs.rmSync(base, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// ingestPacketEmail — full round-trip
// ---------------------------------------------------------------------------

test("ingestPacketEmail round-trip with plain-text email", () => {
  const base = tmpDir();
  const email = `From: genie@example.test\nContent-Type: text/plain\n\n${JSON.stringify(anchorPacket())}`;
  const result = ingestPacketEmail(email, { baseDir: base });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.businessName, "Anchor Plumbing");
  assert.ok(result.packetDir.startsWith(base));
  assert.equal(result.prospectHint.city, "Tucson");
  assert.equal(result.prospectHint.state, "AZ");
  assert.equal(result.prospectHint.category, "plumbing");
  assert.ok(fs.existsSync(path.join(result.packetDir, "packet.json")));

  fs.rmSync(base, { recursive: true, force: true });
});

test("ingestPacketEmail parse-only mode (write:false) skips disk writes", () => {
  const email = `From: x\nContent-Type: text/plain\n\n${JSON.stringify(anchorPacket())}`;
  const result = ingestPacketEmail(email, { write: false });

  assert.equal(result.ok, true);
  assert.equal(result.packetDir, "");
  assert.equal(result.businessName, "Anchor Plumbing");
});

test("ingestPacketEmail returns ok:false for empty body", () => {
  const r = ingestPacketEmail("");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "empty_email_body");
});

test("ingestPacketEmail returns ok:false when no packet is found", () => {
  const r = ingestPacketEmail("Hello, no packet here.");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_genie_packet_found");
});

test("ingestPacketEmail accepts a raw JSON string (no MIME envelope)", () => {
  const base = tmpDir();
  const result = ingestPacketEmail(JSON.stringify(anchorPacket()), { baseDir: base });
  assert.equal(result.ok, true);
  assert.equal(result.businessName, "Anchor Plumbing");
  fs.rmSync(base, { recursive: true, force: true });
});
