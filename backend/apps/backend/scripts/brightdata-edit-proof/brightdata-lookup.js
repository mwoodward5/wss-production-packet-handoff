"use strict";
// scripts/brightdata-edit-proof/brightdata-lookup.js
//
// Performs a REAL BrightData SERP search-term lookup for the Flint client and
// records hard evidence that the call left this machine and real data came
// back: HTTP status, byte count, response sha256, elapsed ms, and the parsed
// Google knowledge-panel fields.
//
// Nothing here is fabricated. If BrightData is unreachable the script exits
// non-zero and records the transport error verbatim.
//
//   node scripts/brightdata-edit-proof/brightdata-lookup.js "Flint Plumbing LLC Buda TX"

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { loadEnv, present } = require("./env");
const { fetchTrust } = require("../../lib/mirror-engine/trust-brightdata");

const OUT_DIR = path.join(__dirname, "..", "..", "artifacts", "brightdata-edit-proof");

/**
 * Instrumented single SERP call. Mirrors lib/mirror-engine/trust-brightdata.js
 * serp() exactly (same endpoint, zone, brd_json=1 URL shape) but records the
 * transport evidence that a pure boolean return would throw away.
 */
async function rawSerp(query) {
  const key = String(process.env.BRIGHTDATA_API_KEY || "").trim();
  const zone = String(process.env.BRIGHTDATA_SERP_ZONE || "serp").trim();
  const endpoint = String(process.env.BRIGHTDATA_SERP_ENDPOINT || "https://api.brightdata.com/request").trim();
  if (!key) throw new Error("BRIGHTDATA_API_KEY not configured");

  const target = `https://www.google.com/search?q=${encodeURIComponent(query)}&brd_json=1`;
  const started = Date.now();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ zone, url: target, format: "raw" }),
    signal: AbortSignal.timeout(70000),
  });
  const text = await res.text();
  const elapsed_ms = Date.now() - started;

  return {
    endpoint,              // host only — no credential
    zone,
    query,
    target_url: target,
    http_status: res.status,
    http_ok: res.ok,
    elapsed_ms,
    response_bytes: Buffer.byteLength(text, "utf8"),
    response_sha256: crypto.createHash("sha256").update(text).digest("hex"),
    raw: text,
  };
}

async function main() {
  const loaded = loadEnv();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`env: loaded ${loaded.length} keys`);
  console.log("env: " + present(["BRIGHTDATA_API_KEY", "BRIGHTDATA_SERP_ZONE", "BRIGHTDATA_SERP_ENDPOINT"]).join("  "));

  const query = process.argv[2] || "Flint Plumbing LLC Buda TX";
  console.log(`\n--- REAL BrightData SERP call: ${JSON.stringify(query)} ---`);

  let call;
  try {
    call = await rawSerp(query);
  } catch (err) {
    const blocked = { status: "BLOCKED", query, error: String(err.message || err), at: new Date().toISOString() };
    fs.writeFileSync(path.join(OUT_DIR, "brightdata-call.json"), JSON.stringify(blocked, null, 2));
    console.error("BLOCKED — transport error: " + blocked.error);
    process.exit(2);
  }

  const { raw, ...evidence } = call;
  console.log(JSON.stringify(evidence, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "brightdata-raw.json"), raw);

  let parsed = null;
  let parseError = null;
  try { parsed = JSON.parse(raw); } catch (e) { parseError = String(e.message); }

  const panel = parsed ? (parsed.knowledge || parsed.knowledge_panel || null) : null;
  const summary = {
    ...evidence,
    parsed_ok: Boolean(parsed),
    parse_error: parseError,
    top_level_keys: parsed ? Object.keys(parsed).slice(0, 25) : [],
    organic_result_count: parsed && Array.isArray(parsed.organic) ? parsed.organic.length : null,
    first_organic_titles: parsed && Array.isArray(parsed.organic)
      ? parsed.organic.slice(0, 3).map((o) => ({ title: o.title, link: o.link })) : [],
    knowledge_panel: panel ? {
      name: panel.name,
      address: panel.address || panel.located_in || null,
      phone: panel.phone || null,
      rating: panel.rating ?? null,
      reviews: panel.reviews_cnt ?? panel.reviews_count ?? panel.reviews ?? null,
    } : null,
    captured_at: new Date().toISOString(),
  };

  console.log("\n--- PARSED RESULT ---");
  console.log(JSON.stringify({ ...summary, response_sha256: summary.response_sha256.slice(0, 16) + "..." }, null, 2));

  // Now the production attestation path, unmodified, on the real facts.
  const facts = require("../../artifacts/clients/wss-test-flint-plumbing-s5/verified-facts.json").facts;
  console.log("\n--- production fetchTrust() attestation (lib/mirror-engine/trust-brightdata.js) ---");
  const trust = await fetchTrust({
    business_name: facts.business_name,
    city: facts.city,
    state: facts.state,
    phone: facts.phone,
    address: facts.address,
  }, { attempts: 2, waitMs: 20000 });
  console.log(JSON.stringify(trust, null, 2));

  fs.writeFileSync(path.join(OUT_DIR, "brightdata-call.json"), JSON.stringify({ summary, trust }, null, 2));
  console.log(`\nwrote ${path.join(OUT_DIR, "brightdata-call.json")}`);
  console.log(`wrote ${path.join(OUT_DIR, "brightdata-raw.json")} (${evidence.response_bytes} bytes)`);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
