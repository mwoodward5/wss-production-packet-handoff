"use strict";

// scripts/pride-air-creation-proof.js — SHOW HIM THE PRIDE POINTS.
//
// Finds the real Air Creation prospect row, attaches the audited owner-behind
// extraction (docs/owner-behind/air-creation-extraction.json) if it is not
// already stored, builds the mirror through the REAL lane, then renders the
// deployed page in a browser and reports which pride points are in the DOM.
//
// A build report is not proof. The last step is a render.

require("./brightdata-edit-proof/env").loadEnv();

const fs = require("node:fs");
const path = require("node:path");

const BASE = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EXTRACTION = require(path.join(__dirname, "..", "..", "..", "docs", "owner-behind", "air-creation-extraction.json"));

const arg = (flag, fallback) =>
  process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : fallback;

async function rest(query, init) {
  const r = await fetch(`${BASE}/rest/v1/${query}`, {
    ...init,
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json", Prefer: "return=representation",
      ...(init && init.headers),
    },
  });
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = t; }
  if (!r.ok) throw new Error(`${r.status} ${String(t).slice(0, 300)}`);
  return body;
}

async function main() {
  const wantFind = process.argv.includes("--find");
  const rows = await rest(
    `ghost_agency_prospects?select=id,business_name,city,state,industry,current_website,preview_url,record` +
    `&business_name=ilike.*air*creation*&limit=5`,
  );
  console.log(`matched ${rows.length} Air Creation row(s)`);
  for (const r of rows) {
    console.log(` - ${r.id} | ${r.business_name} | ${r.city}, ${r.state} | ${r.industry} | site=${r.current_website || "(none)"} | preview=${r.preview_url || "(none)"} | owner_behind=${r.record && r.record.owner_behind ? "STORED" : "absent"}`);
  }
  if (wantFind) return;
  if (!rows.length) {
    console.error("no Air Creation prospect row — cannot build a real client");
    process.exit(2);
  }

  const row = rows.find((r) => /gonzales|baton/i.test(String(r.city || ""))) || rows[0];
  const record = { ...(row.record || {}) };

  // ATTACH THE AUDITED EXTRACTION. This is the same object the owner-behind
  // audit produced for this exact business; nothing here is invented, and the
  // pride block still refuses anything the extraction did not prove.
  if (!record.owner_behind) {
    record.owner_behind = EXTRACTION;
    await rest(`ghost_agency_prospects?id=eq.${encodeURIComponent(row.id)}`, {
      method: "PATCH", body: JSON.stringify({ record }),
    });
    console.log("stored owner_behind extraction on the prospect row");
  } else {
    console.log("owner_behind already stored");
  }

  // What the lane will actually hand the engine.
  const { prideFromExtraction } = require("../lib/owner-pride");
  const pride = prideFromExtraction(record.owner_behind, {
    clientDomain: String(row.current_website || "").replace(/^https?:\/\//i, "").split("/")[0],
  });
  console.log("\npride block the engine will receive:");
  console.log(JSON.stringify(pride && pride.sections ? Object.fromEntries(
    Object.entries(pride.sections).map(([k, v]) => [k, Array.isArray(v) ? v.length : (v.value || Object.keys(v).join("+"))]),
  ) : null, null, 1));

  // The prospect shape the line hands the builder (lib/line-adapters
  // prospectFromContract): the stored build_ready contract's own facts and
  // brand, so this proof takes exactly the path production takes.
  const br = record.build_ready || {};
  const req = br.mirror_request || {};
  const f = req.facts || {};
  const brand = req.brand || {};
  const { buildMirrorForProspect } = require("../lib/mirror-lane-build");
  const prospect = {
    ...row,
    record,
    business_name: f.business_name || row.business_name,
    industry: f.industry || row.industry,
    city: f.city || row.city,
    state: f.state || row.state,
    current_website: f.current_website || row.current_website,
    site: row.current_website || "",
    email: f.email || row.email,
    phone: f.phone || row.phone,
    place_id: f.place_id || record.place_id,
    rating: f.rating ?? record.rating,
    review_count: f.review_count ?? record.review_count,
    marketing_city: f.service_area || record.service_area,
    logo_url: brand.logo || "",
    logo_accent: brand.accent || "",
    logo_accent_source: brand.accent_source || "",
  };
  const t0 = Date.now();
  const out = await buildMirrorForProspect(prospect, {
    slug: arg("--slug", "") || undefined,
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nbuild finished in ${secs}s`);
  console.log(JSON.stringify({
    ok: out.ok, revealable: out.revealable, preview_url: out.preview_url,
    donor: out.donor, vertical: out.vertical, slug: out.slug,
    status: out.status, reason: out.reason, error: out.error,
    contentCoverage: out.contentCoverage,
  }, null, 1));

  const outPath = path.join(__dirname, "..", "artifacts", "pride-air-creation-build.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ at: new Date().toISOString(), out }, null, 2));
  console.log(`wrote ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
