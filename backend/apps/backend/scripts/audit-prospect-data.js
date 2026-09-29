"use strict";

// Read-only audit: what does the REAL prospects table actually hold per lead?
// Prints counts only — never a contact value.

require("./brightdata-edit-proof/env").loadEnv();

const BASE = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function rest(path) {
  const response = await fetch(`${BASE}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: "count=exact" },
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 400) }; }
  return { status: response.status, contentRange: response.headers.get("content-range"), json };
}

function filled(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function get(row, path) {
  return path.split(".").reduce((acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined), row);
}

// Every place a piece of operator-useful truth could live, per field.
const FIELDS = {
  "contact name": ["owner_name", "record.owner_name", "record.ownerName", "record.contact_name", "record.build_ready.contact.owner_name", "record.callprep.owner_name"],
  "phone": ["phone", "record.phone", "record.build_ready.contact.phone", "record.nap.phone", "record.business_truth.phone"],
  "email": ["owner_email", "record.owner_email", "record.ownerEmail", "record.contact_email", "record.build_ready.contact.email"],
  "website (their own)": ["website", "record.website", "record.website_url", "record.build_ready.source_url", "record.source_url"],
  "address": ["record.address", "record.build_ready.contact.address", "record.nap.address", "record.formatted_address"],
  "city": ["city", "record.city"],
  "state": ["state", "record.state"],
  "rating": ["record.rating", "record.google_rating", "record.build_ready.trust.rating", "record.reviews.rating"],
  "review count": ["record.review_count", "record.user_ratings_total", "record.build_ready.trust.review_count", "record.reviews.count"],
  "grade (website)": ["record.website_grade", "record.grades.website", "record.signal.website_grade", "record.getfound.website_grade"],
  "grade (composite)": ["record.signal_grade", "record.grade", "record.grades.composite", "record.signal.grade"],
  "grade reasons / why": ["record.grade_reasons", "record.signal.reasons", "record.weaknesses", "record.site_weakness", "record.build_ready.weaknesses"],
  "report url": ["report_url", "record.report_url", "record.reportUrl"],
  "socials": ["record.socials", "record.social_links", "record.build_ready.socials"],
  "hours": ["record.hours", "record.opening_hours", "record.build_ready.hours"],
  "services": ["record.services", "record.build_ready.services", "record.packet.services"],
  "photos": ["record.photos", "record.build_ready.photos", "record.build_ready.media.photos"],
  "logo": ["logo_url", "record.logo_url", "record.build_ready.brand_evidence.logo_url", "record.build_ready.mirror_request.brand.logo"],
  "accent colour": ["record.accent", "record.build_ready.brand_evidence.accent", "record.build_ready.mirror_request.brand.accent"],
  "callprep findings": ["record.callprep", "record.call_prep", "record.callprep_findings", "record.callPrep"],
  "intake packet": ["record.packet", "record.intake_packet", "record.compiler_packet"],
  "place id": ["record.place_id", "record.placeId", "record.google_place_id"],
  "vertical": ["industry", "record.vertical", "record.industry"],
  "preview url (our mirror)": ["preview_url", "record.preview_url"],
  "build error": ["record.last_build_error", "record.build_error"],
  "last build at": ["record.last_build_at", "record.built_at"],
};

async function main() {
  const ok = (status) => status === 200 || status === 206;
  const head = await rest("ghost_agency_prospects?select=*&limit=1");
  if (!ok(head.status) || !Array.isArray(head.json) || !head.json.length) {
    console.log("HEAD FAILED", head.status, JSON.stringify(head.json).slice(0, 500));
    return;
  }
  console.log("COLUMNS:", Object.keys(head.json[0]).join(", "));
  console.log("TOTAL ROWS (content-range):", head.contentRange);

  const rows = [];
  const PAGE = 500;
  for (let offset = 0; offset < 4000; offset += PAGE) {
    const page = await rest(`ghost_agency_prospects?select=*&order=updated_at.desc&limit=${PAGE}&offset=${offset}`);
    if (!ok(page.status) || !Array.isArray(page.json) || !page.json.length) break;
    rows.push(...page.json);
    if (page.json.length < PAGE) break;
  }
  console.log("ROWS PULLED:", rows.length);

  const statuses = {};
  for (const row of rows) statuses[row.status || "(none)"] = (statuses[row.status || "(none)"] || 0) + 1;
  console.log("\nSTATUS COUNTS:", JSON.stringify(statuses, null, 1));

  const withPreview = rows.filter((row) => filled(row.preview_url) || filled(get(row, "record.preview_url")));
  console.log("ROWS WITH A MIRROR (preview_url):", withPreview.length);

  console.log("\nFIELD COVERAGE  (filled / total, and which path won)");
  console.log("field".padEnd(26), "all rows".padEnd(16), "rows w/ mirror".padEnd(16), "winning paths");
  for (const [label, paths] of Object.entries(FIELDS)) {
    const winners = {};
    let all = 0;
    let mirrored = 0;
    for (const row of rows) {
      const hit = paths.find((path) => filled(get(row, path)));
      if (!hit) continue;
      all += 1;
      winners[hit] = (winners[hit] || 0) + 1;
    }
    for (const row of withPreview) {
      if (paths.some((path) => filled(get(row, path)))) mirrored += 1;
    }
    const top = Object.entries(winners).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([path, count]) => `${path}(${count})`).join(" ") || "— NOTHING ANYWHERE —";
    console.log(
      label.padEnd(26),
      `${all}/${rows.length}`.padEnd(16),
      `${mirrored}/${withPreview.length}`.padEnd(16),
      top,
    );
  }

  // What keys actually exist inside record, ranked.
  const keyCounts = {};
  for (const row of rows) {
    const record = row.record && typeof row.record === "object" ? row.record : {};
    for (const key of Object.keys(record)) keyCounts[key] = (keyCounts[key] || 0) + 1;
  }
  console.log("\nEVERY record.* KEY, BY HOW MANY ROWS HAVE IT:");
  for (const [key, count] of Object.entries(keyCounts).sort((a, b) => b[1] - a[1])) {
    console.log(String(count).padStart(6), key);
  }

  // Deep dive on build_ready, the miner's contract.
  const brKeys = {};
  let brRows = 0;
  for (const row of rows) {
    const br = get(row, "record.build_ready");
    if (!br || typeof br !== "object") continue;
    brRows += 1;
    for (const key of Object.keys(br)) brKeys[key] = (brKeys[key] || 0) + 1;
  }
  console.log(`\nrecord.build_ready present on ${brRows} rows; its keys:`);
  for (const [key, count] of Object.entries(brKeys).sort((a, b) => b[1] - a[1])) {
    console.log(String(count).padStart(6), key);
  }
}

main().catch((error) => { console.error("FAILED", error && error.message); process.exitCode = 1; });
