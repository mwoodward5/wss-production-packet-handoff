"use strict";
// Two honest counts:
//  1. How many stored prospects can produce a pride block at all (an
//     owner-behind extraction is the only source, and nothing in the pipeline
//     writes one yet — so this number is the real ceiling on the feature).
//  2. For the mirrors that render no reviewer faces: does the stored review
//     carry a Google-served avatar (render gap) or not (data gap)?

require("./brightdata-edit-proof/env").loadEnv();
const { prideFromExtraction } = require("../lib/owner-pride");
const { isGoogleReviewerFace } = require("../lib/verified-trust-lookup");

const BASE = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function rest(q) {
  const r = await fetch(`${BASE}/rest/v1/${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return []; }
}

function allReviews(obj, out = [], depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 6) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (k === "reviews" && Array.isArray(v)) out.push(...v);
    else if (v && typeof v === "object") allReviews(v, out, depth + 1);
  }
  return out;
}

async function main() {
  const rows = await rest(`ghost_agency_prospects?select=id,business_name,preview_url,record&limit=2000`);
  const withOB = await rest(
    `ghost_agency_prospects?select=id,business_name,preview_url&record->owner_behind=not.is.null`,
  );
  console.log(`rows carrying owner_behind (server-side filter): ${Array.isArray(withOB) ? withOB.length : "?"}`);
  for (const r of Array.isArray(withOB) ? withOB : []) console.log(`  - ${r.business_name} | ${r.preview_url || "(no preview)"}`);
  let withExtraction = 0, withPride = 0, live = 0;
  const prideRows = [];
  for (const r of rows) {
    if (r.preview_url) live++;
    const ex = r.record && r.record.owner_behind;
    if (!ex) continue;
    withExtraction++;
    const p = prideFromExtraction(ex, { clientDomain: "" });
    if (p) { withPride++; prideRows.push(r.business_name); }
  }
  console.log(`prospect rows read      : ${rows.length}`);
  console.log(`with a preview_url      : ${live}`);
  console.log(`with owner_behind stored: ${withExtraction}`);
  console.log(`yielding a pride block  : ${withPride}  ${prideRows.join(", ")}`);

  console.log(`\n-- reviewer faces, by source --`);
  const liveRows = rows.filter((r) => r.preview_url).slice(0, 20);
  for (const r of liveRows) {
    const revs = allReviews(r.record || {});
    if (!revs.length) continue;
    const withUrl = revs.filter((x) => x && (x.avatarUrl || x.avatar_url || x.profile_photo_url));
    const passing = withUrl.filter((x) => isGoogleReviewerFace(x.avatarUrl || x.avatar_url || x.profile_photo_url));
    console.log(`${String(r.business_name).slice(0, 36).padEnd(36)} reviews:${String(revs.length).padEnd(3)} avatar_field:${String(withUrl.length).padEnd(3)} real_google_face:${passing.length}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
