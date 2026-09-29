"use strict";

// lib/packet-ingester.js — MIME/ZIP email → packet dir.
//
// Accepts a raw forwarded email body (text/plain, multipart/mixed, or a
// JSON-inlined forward) containing an intake-genie-v2 canonical packet.
// Writes the packet to a local directory that lib/intake-packet.js and
// lib/mirror-lane-build.js understand, and returns the parsed packet JSON
// alongside the directory path so the caller can bridge it into the lane.
//
// ZERO EXTERNAL DEPS. No npm modules, no network calls. The email parser is
// a purposeful minimal MIME parser for the exact shapes Genie produces: it is
// not a general-purpose MIME library and must stay that way.
//
// WHAT THIS MODULE WRITES
// packetDir/
//   packet.json          — the raw intake-genie-v2 payload (single source)
//   seo.json             — { siteTitle, siteDescription, keywords } from
//                          packet.optimization, if present
//   faqs.json            — array of { q, a } from packet.content.faqs
//   voice-search.json    — { primaryService, city } from packet.facts
//   content/
//     home.md            — about prose from packet.content.about
//     services/<slug>.md — per-service page stubs when content is present
//
// WHAT THIS MODULE NEVER TOUCHES
// consent flags, email sending, any database, any outbound call.

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

// -------------------------------------------------------------------
// Configuration
// -------------------------------------------------------------------

const DEFAULT_BASE_DIR = process.env.GHOST_AGENCY_PACKET_DIR
  || "/tmp/wss-packets";

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function clean(v) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
}

function slugify(s) {
  return clean(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    || "service";
}

// Safely parse JSON; return null on failure.
function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------
// MIME parser (minimal — handles the shapes Genie emails produce)
// -------------------------------------------------------------------

/**
 * Split a multipart body into its parts using `boundary`.
 * Each part is returned as { headers: Map<lc-name, value>, body: string }.
 */
function splitMultipart(raw, boundary) {
  const delimiter = `--${boundary}`;
  const parts = [];
  const lines = raw.split(/\r?\n/);
  let state = "preamble";
  let currentHeaders = null;
  let currentBody = [];

  for (const line of lines) {
    if (line.startsWith(delimiter)) {
      // Save any accumulated part
      if (currentHeaders !== null) {
        parts.push({ headers: currentHeaders, body: currentBody.join("\n") });
      }
      // Check for end boundary
      if (line.startsWith(`${delimiter}--`)) {
        state = "done";
        break;
      }
      state = "headers";
      currentHeaders = new Map();
      currentBody = [];
      continue;
    }
    if (state === "preamble") continue;
    if (state === "headers") {
      if (!line.trim()) {
        state = "body";
        continue;
      }
      const colon = line.indexOf(":");
      if (colon > 0) {
        const name = line.slice(0, colon).toLowerCase().trim();
        const value = line.slice(colon + 1).trim();
        currentHeaders.set(name, value);
      }
      continue;
    }
    if (state === "body") {
      currentBody.push(line);
    }
  }
  // Flush last part if boundary was absent (some forwarders strip it)
  if (state === "body" && currentHeaders !== null && currentBody.length) {
    parts.push({ headers: currentHeaders, body: currentBody.join("\n") });
  }
  return parts;
}

/**
 * Extract the MIME boundary from a Content-Type header value.
 * Returns "" when no boundary is present.
 */
function parseBoundary(contentType) {
  const m = /;\s*boundary="?([^";\s]+)"?/i.exec(String(contentType || ""));
  return m ? m[1] : "";
}

/**
 * Decode a MIME part body given its transfer-encoding header.
 */
function decodePart(body, encoding) {
  const enc = String(encoding || "").toLowerCase().trim();
  if (enc === "base64") {
    try {
      return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
    } catch {
      return body;
    }
  }
  if (enc === "quoted-printable") {
    return body
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
  return body;
}

/**
 * findGenieJson(rawEmail) → parsed Genie packet object | null
 *
 * Walks the MIME tree looking for:
 *   1. A JSON attachment whose Content-Disposition filename contains "packet"
 *      or whose Content-Type is application/json.
 *   2. A text/plain part that inlines a JSON blob containing `intake-genie-v2`.
 *   3. Inline JSON anywhere in the raw body as a last resort.
 */
function findGenieJson(rawEmail) {
  const raw = String(rawEmail || "");

  // -- Parse outer headers ----------------------------------------------
  // Match both \n\n and \r\n\r\n header/body separators.
  const sepMatch = /\r?\n\r?\n/.exec(raw);
  const headerEnd = sepMatch ? sepMatch.index : -1;
  const rawHeaders = headerEnd > 0 ? raw.slice(0, headerEnd) : "";
  const body = headerEnd > 0 ? raw.slice(headerEnd + sepMatch[0].length) : raw;

  const outerHeaders = new Map();
  for (const line of rawHeaders.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon > 0) {
      outerHeaders.set(
        line.slice(0, colon).toLowerCase().trim(),
        line.slice(colon + 1).trim(),
      );
    }
  }

  const outerCt = outerHeaders.get("content-type") || "";
  const boundary = parseBoundary(outerCt);

  // -- Multipart message -------------------------------------------------
  if (boundary) {
    const parts = splitMultipart(body, boundary);
    // Priority 1: a JSON attachment named like "packet" or genie
    for (const part of parts) {
      const ct = part.headers.get("content-type") || "";
      const cd = part.headers.get("content-disposition") || "";
      const isJson = /application\/json/i.test(ct) || /\.json/i.test(cd);
      const isPacketLike = /packet|genie/i.test(cd) || /application\/json/i.test(ct);
      if (!isJson && !isPacketLike) continue;
      const decoded = decodePart(part.body, part.headers.get("content-transfer-encoding"));
      const parsed = tryJson(decoded);
      if (isGeniePacket(parsed)) return parsed;
    }
    // Priority 2: text/plain or text/html parts containing inlined JSON
    for (const part of parts) {
      const ct = part.headers.get("content-type") || "";
      if (!/text\/(plain|html)/i.test(ct)) continue;
      const decoded = decodePart(part.body, part.headers.get("content-transfer-encoding"));
      const extracted = extractJsonBlock(decoded);
      if (isGeniePacket(extracted)) return extracted;
    }
  }

  // -- Non-multipart: scan body directly ---------------------------------
  const extracted = extractJsonBlock(body);
  if (isGeniePacket(extracted)) return extracted;

  // -- Last resort: the whole raw body IS the packet JSON ---------------
  const wholeParsed = tryJson(raw.trim());
  if (isGeniePacket(wholeParsed)) return wholeParsed;

  return null;
}

/**
 * Extract the first JSON object from a text blob.
 * Looks for the largest `{...}` block that parses successfully.
 */
function extractJsonBlock(text) {
  const s = String(text || "");
  // Quick scan for the first `{`
  const start = s.indexOf("{");
  if (start < 0) return null;
  // Walk forward matching braces
  let depth = 0;
  let end = -1;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) return null;
  return tryJson(s.slice(start, end + 1));
}

/**
 * Return true when `obj` looks like an intake-genie-v2 canonical packet.
 * Deliberately tolerant: the shape may arrive slightly different from
 * the reference version.
 */
function isGeniePacket(obj) {
  if (!obj || typeof obj !== "object") return false;
  // Must have either a version string or at minimum a `facts` object with `name`.
  if (obj.version && String(obj.version).startsWith("intake-genie")) return true;
  // Structural heuristic when the version field was stripped.
  if (
    obj.facts
    && typeof obj.facts === "object"
    && (obj.facts.name || obj.facts.category || obj.facts.city)
  ) return true;
  return false;
}

// -------------------------------------------------------------------
// Disk writer
// -------------------------------------------------------------------

/**
 * writePacketDir(packet, baseDir) → packetDir string
 *
 * Creates a dedicated directory under baseDir named after the business
 * and a short uuid segment, then writes all the files that
 * lib/intake-packet.js and lib/mirror-lane-build.js understand.
 */
function writePacketDir(packet, baseDir) {
  const root = String(baseDir || DEFAULT_BASE_DIR);
  const facts = (packet && packet.facts) || {};
  const businessSlug = slugify(facts.name || "unknown");
  const dirName = `${businessSlug}-${randomUUID().slice(0, 8)}`;
  const dir = path.join(root, dirName);

  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "content", "services"), { recursive: true });

  // 1. Raw packet JSON — the canonical single source
  fs.writeFileSync(
    path.join(dir, "packet.json"),
    JSON.stringify(packet, null, 2),
    "utf8",
  );

  // 2. SEO — from optimization block
  const opt = packet.optimization || {};
  const seoOut = {
    siteTitle: clean(facts.name) || "",
    siteDescription: clean(opt.meta_description || opt.seo_description || ""),
    keywords: Array.isArray(opt.target_queries) ? opt.target_queries.map(clean).filter(Boolean) : [],
  };
  fs.writeFileSync(path.join(dir, "seo.json"), JSON.stringify(seoOut, null, 2), "utf8");

  // 3. FAQs — from content or trust block
  const contentBlock = packet.content || {};
  const rawFaqs = Array.isArray(contentBlock.faqs) ? contentBlock.faqs
    : Array.isArray(packet.faqs) ? packet.faqs : [];
  const faqsOut = rawFaqs
    .map((f) => ({
      q: clean(f && (f.q || f.question)),
      a: clean(f && (f.a || f.answer)),
    }))
    .filter((f) => f.q && f.a);
  fs.writeFileSync(path.join(dir, "faqs.json"), JSON.stringify(faqsOut, null, 2), "utf8");

  // 4. Voice search
  const services = packet.facts && Array.isArray(packet.facts.services)
    ? packet.facts.services
    : (Array.isArray(contentBlock.services)
      ? contentBlock.services.map((s) => (typeof s === "string" ? s : (s && s.name)))
      : []);
  const voiceOut = {
    primaryService: clean(services[0] || ""),
    city: clean(facts.city || ""),
  };
  fs.writeFileSync(path.join(dir, "voice-search.json"), JSON.stringify(voiceOut, null, 2), "utf8");

  // 5. Home page prose — about / intro text
  const about = clean(contentBlock.about || contentBlock.intro || "");
  if (about) {
    fs.writeFileSync(path.join(dir, "content", "home.md"), about, "utf8");
  }

  // 6. Service pages
  const serviceList = Array.isArray(contentBlock.services) ? contentBlock.services : [];
  for (const svc of serviceList) {
    if (!svc) continue;
    const name = typeof svc === "string" ? svc : (svc && svc.name);
    const desc = typeof svc === "object" ? (svc.description || svc.text || "") : "";
    if (!name) continue;
    const fname = `${slugify(name)}.md`;
    const prose = desc || name;
    fs.writeFileSync(path.join(dir, "content", "services", fname), prose, "utf8");
  }

  return dir;
}

// -------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------

/**
 * ingestPacketEmail(emailBody, opts) →
 *   { ok: true,  packetDir, packet, businessName, prospectHint }
 * | { ok: false, reason }
 *
 * opts.baseDir  overrides DEFAULT_BASE_DIR (useful in tests).
 * opts.write    set to false to skip writing to disk (parse-only mode).
 */
function ingestPacketEmail(emailBody, opts = {}) {
  const raw = String(emailBody || "").trim();
  if (!raw) return { ok: false, reason: "empty_email_body" };

  const packet = findGenieJson(raw);
  if (!packet) return { ok: false, reason: "no_genie_packet_found" };

  const facts = packet.facts || {};
  const businessName = clean(facts.name || "");

  let packetDir = "";
  if (opts.write !== false) {
    try {
      packetDir = writePacketDir(packet, opts.baseDir);
    } catch (err) {
      return { ok: false, reason: "write_failed", detail: String(err.message || err) };
    }
  }

  return {
    ok: true,
    packetDir,
    packet,
    businessName,
    // A prospectHint groups the main identity fields so the admin action can
    // look up the right row without forcing the caller to supply a prospect_id
    // when the packet is self-describing.
    prospectHint: {
      name: businessName,
      city: clean(facts.city || ""),
      state: clean(facts.state || ""),
      category: clean(facts.category || ""),
    },
  };
}

module.exports = {
  ingestPacketEmail,
  findGenieJson,
  writePacketDir,
  isGeniePacket,
  // exposed for tests
  extractJsonBlock,
  splitMultipart,
};

// -------------------------------------------------------------------
// Self-test  node lib/packet-ingester.js --test
// -------------------------------------------------------------------
if (require.main === module && process.argv.includes("--test")) {
  const assert = require("node:assert/strict");
  const os = require("node:os");

  const SAMPLE_PACKET = {
    ok: true,
    version: "intake-genie-v2",
    status: "complete",
    scope: { supported: true, category: "plumbing" },
    facts: {
      name: "Anchor Plumbing",
      city: "Tucson",
      state: "AZ",
      category: "plumbing",
      services: ["Drain Cleaning", "Water Heater Repair"],
    },
    evidence: [],
    assets: [],
    trust: {},
    optimization: { target_queries: ["plumbing tucson az"] },
    content: {
      about: "Anchor Plumbing has served Tucson since 1998. We handle drain cleaning, water heaters, and full repipes.",
      services: [{ name: "Drain Cleaning", description: "Expert drain cleaning services." }],
      faqs: [{ q: "Do you offer same-day service?", a: "Yes, we offer same-day service in Tucson." }],
    },
  };

  // 1. isGeniePacket
  assert.equal(isGeniePacket(SAMPLE_PACKET), true, "sample packet recognised");
  assert.equal(isGeniePacket(null), false, "null rejected");
  assert.equal(isGeniePacket({ version: "intake-genie-v2", facts: { name: "X" } }), true, "v2 + facts");

  // 2. extractJsonBlock
  const blob = `some preamble\n${JSON.stringify(SAMPLE_PACKET)}\nmore text`;
  const found = extractJsonBlock(blob);
  assert.equal(found && found.version, "intake-genie-v2", "JSON extracted from prose");

  // 3. findGenieJson — inline plain body
  const plainEmail = `From: genie@example.test\nTo: mark@example.test\nContent-Type: text/plain\n\n${JSON.stringify(SAMPLE_PACKET)}`;
  const pResult = findGenieJson(plainEmail);
  assert.ok(pResult, "plain-body extraction ok");
  assert.equal(pResult.facts.name, "Anchor Plumbing");

  // 4. findGenieJson — multipart/mixed with JSON attachment
  const boundary = "----=_Part_00001";
  const jsonPart = `--${boundary}\r\nContent-Type: application/json\r\nContent-Disposition: attachment; filename="packet.json"\r\n\r\n${JSON.stringify(SAMPLE_PACKET)}\r\n--${boundary}--`;
  const multipartEmail = `From: genie@example.test\nContent-Type: multipart/mixed; boundary="${boundary}"\n\n${jsonPart}`;
  const mResult = findGenieJson(multipartEmail);
  assert.ok(mResult, "multipart JSON attachment extraction ok");
  assert.equal(mResult.facts.city, "Tucson");

  // 5. writePacketDir — actually writes files
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "pi-test-"));
  const dir = writePacketDir(SAMPLE_PACKET, tmpBase);
  assert.ok(fs.existsSync(path.join(dir, "packet.json")), "packet.json written");
  assert.ok(fs.existsSync(path.join(dir, "seo.json")), "seo.json written");
  assert.ok(fs.existsSync(path.join(dir, "faqs.json")), "faqs.json written");
  assert.ok(fs.existsSync(path.join(dir, "content", "home.md")), "home.md written");
  const faqContent = JSON.parse(fs.readFileSync(path.join(dir, "faqs.json"), "utf8"));
  assert.equal(faqContent.length, 1, "one FAQ written");
  fs.rmSync(tmpBase, { recursive: true, force: true });

  // 6. ingestPacketEmail — full round-trip
  const os2 = require("node:os");
  const tmpBase2 = fs.mkdtempSync(path.join(os2.tmpdir(), "pi-ingest-"));
  const result = ingestPacketEmail(plainEmail, { baseDir: tmpBase2 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.businessName, "Anchor Plumbing");
  assert.ok(result.packetDir.startsWith(tmpBase2));
  fs.rmSync(tmpBase2, { recursive: true, force: true });

  // 7. ingestPacketEmail — empty body
  const bad = ingestPacketEmail("");
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, "empty_email_body");

  // 8. ingestPacketEmail — no recognisable packet
  const noPacket = ingestPacketEmail("Hello World — no JSON here.");
  assert.equal(noPacket.ok, false);
  assert.equal(noPacket.reason, "no_genie_packet_found");

  console.log("packet-ingester: all self-tests passed");
}
