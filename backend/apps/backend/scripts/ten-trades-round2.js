"use strict";
/**
 * scripts/ten-trades-round2.js — second pass over the missing-trade picks that
 * round 1 refused, each cured the honest way:
 *
 *   no_verified_logo  -> harvest the mark from the prospect's OWN site through
 *                        the miner's resolveOwnLogo (same ownership gate, same
 *                        third-party denylist, same header-grade shape check
 *                        the mine step uses), persist it on the record in the
 *                        miner's own brand shape, then build. The engine still
 *                        re-fetches and re-verifies the bytes itself —
 *                        resolveBrandAssets is the enforcement, this is supply.
 *   service_floor     -> try the NEXT candidate in the same trade; the floor is
 *                        a fact about that prospect's site, not about the lane.
 *
 *   node scripts/ten-trades-round2.js
 */
require("./brightdata-edit-proof/env").loadEnv();

const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.join(__dirname, "..");
const BASE = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const { resolveOwnLogo, fetchPageBytes } = require("../lib/lead-miner");
const { buildMirrorForProspect } = require("../lib/mirror-lane-build");

async function rest(q, init) {
  const r = await fetch(`${BASE}/rest/v1/${q}`, {
    ...(init || {}),
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json", Prefer: "return=representation",
      ...((init || {}).headers || {}),
    },
  });
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; }
}

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** Same prospect shape scripts/varied-markets-run.js hands the lane. */
function prospectFromRow(row, logoOverride) {
  const record = row.record || {};
  const req = (record.build_ready && record.build_ready.mirror_request) || {};
  const f = req.facts || {};
  const brand = req.brand || {};
  const recBrand = isObj(record.brand) ? record.brand : {};
  const logo = logoOverride || brand.logo || record.logo_url || record.logo || recBrand.logo || "";
  return {
    ...row, record,
    business_name: f.business_name || row.business_name,
    industry: f.industry || row.industry,
    city: f.city || row.city, state: f.state || row.state,
    current_website: f.current_website || row.current_website,
    site: row.current_website || "",
    email: f.email || row.email, phone: f.phone || row.phone,
    place_id: f.place_id || record.place_id,
    rating: f.rating ?? record.rating,
    review_count: f.review_count ?? record.review_count,
    marketing_city: f.service_area || record.service_area,
    logo_url: logo, logo_accent: brand.accent || recBrand.accent || "",
    logo_accent_source: brand.accent_source || recBrand.accent_source || "",
  };
}

async function harvestLogo(row) {
  const site = row.current_website;
  if (!site) return { ok: false, reason: "no_site" };
  const page = await fetchPageBytes(site, 20000);
  if (!page.ok || !page.html) return { ok: false, reason: `site_fetch:${page.failure || "no_html"}` };
  const got = await resolveOwnLogo({ siteUrl: page.finalUrl || site, html: page.html, businessName: row.business_name || "" });
  if (!got || !got.ok) return { ok: false, reason: (got && got.reason) || "logo_unresolved" };
  // resolveOwnLogo nests the mark under .logo ({url, sha256, ext, accent, ...}).
  return { ok: true, logo: got.logo };
}

/** Persist the harvested mark in the miner's own brand shape, auditable. */
async function persistBrand(row, logo) {
  const record = { ...(row.record || {}) };
  record.brand = {
    logo: logo.url,
    logo_sha256: logo.sha256 || undefined,
    accent: logo.accent || undefined,
    accent_source: logo.url,
    accent_method: logo.accent_method || undefined,
    harvested_at: new Date().toISOString(),
    harvested_by: "ten-trades-round2:resolveOwnLogo",
    verified_by: ["same_owner_registrable_domain", "third_party_mark_denylist", "magic_byte_image_sniff", "header_grade_shape"],
  };
  const res = await rest(`ghost_agency_prospects?id=eq.${encodeURIComponent(row.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ record }),
  });
  return res.status >= 200 && res.status < 300;
}

// [industry, [names to try in order]] — the logo comes from the record when it
// has one, else from a fresh resolveOwnLogo harvest of their own site.
const ROUND2 = [
  // round 3: only the rows the .logo-field bug refused, plus fresh roofing
  // and landscaping candidates whose sites may carry a header-grade mark.
  ["med spa", ["Azure Med Spa"]],
  ["roofing", ["Davis Roofing Solutions"]],
  ["landscaping", ["Landscape Connection"]],
];

(async () => {
  const results = [];
  for (const [industry, names] of ROUND2) {
    let done = false;
    for (const name of names) {
      if (done) break;
      const safe = encodeURIComponent(`%${name.replace(/[%,]/g, " ").trim()}%`);
      const q = await rest(`ghost_agency_prospects?select=*&business_name=ilike.${safe}&limit=3`);
      const rows = Array.isArray(q.body) ? q.body : [];
      const row = rows.find((r) => String(r.industry || "").toLowerCase() === industry) || rows[0];
      if (!row) { console.log(`-- ${industry}: no row for ${name}`); continue; }
      console.log(`\n== ${industry}: ${row.business_name} (${row.city}, ${row.state})`);

      let logoOverride = "";
      const onRecord = prospectFromRow(row).logo_url;
      if (!onRecord) {
        const h = await harvestLogo(row);
        if (!h.ok) {
          console.log(`   logo harvest REFUSED: ${h.reason}`);
          results.push({ industry, name: row.business_name, ok: false, reason: `logo_harvest:${h.reason}` });
          continue;
        }
        logoOverride = h.logo.url;
        console.log(`   logo harvested: ${h.logo.url} accent=${h.logo.accent || "-"} (${h.logo.accent_method || "n/a"})`);
        const saved = await persistBrand(row, h.logo);
        console.log(`   record.brand persisted: ${saved}`);
      } else {
        console.log(`   logo on record: ${String(onRecord).slice(0, 90)}`);
      }

      const prospect = prospectFromRow(row, logoOverride);
      const t0 = Date.now();
      let out;
      try { out = await buildMirrorForProspect(prospect, {}); }
      catch (e) { out = { ok: false, reason: `threw:${String(e.message || e).slice(0, 200)}` }; }
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      const rec = {
        industry, id: row.id, name: row.business_name, city: row.city, state: row.state,
        ok: !!out.ok, revealable: !!out.revealable, reason: out.reason || "",
        detail: out.detail || "", donor: out.donor || "", vertical: out.vertical || "",
        url: out.preview_url || "", secs: Number(secs), contentCoverage: out.contentCoverage || null,
      };
      results.push(rec);
      console.log(`   ${rec.ok ? "BUILT" : "REFUSED"} in ${secs}s revealable=${rec.revealable} ${rec.url}`);
      if (rec.reason) console.log(`   reason: ${rec.reason}${rec.detail ? ` — ${String(rec.detail).slice(0, 200)}` : ""}`);
      if (rec.revealable) done = true;   // one good mirror per trade is the goal
    }
  }
  fs.writeFileSync(path.join(ROOT, "artifacts", "ten-trades-round2.json"), JSON.stringify(results, null, 1));
  console.log(`\nwrote artifacts/ten-trades-round2.json`);
})().catch((e) => { console.error(e); process.exit(1); });
