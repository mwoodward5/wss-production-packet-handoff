"use strict";

// scripts/intake-gap-audit.js — WHAT WE CAPTURE vs WHAT WE ACTUALLY RENDER.
//
// The question this answers: we pay Google Places and the enrichment lane to
// collect facts about every prospect. How much of that reaches the page?
//
// A field that is captured and never rendered is money spent twice — once to
// fetch it, again on a preview that looks thinner than the data behind it. And
// a field that is MISSING is a hole the preview must render empty rather than
// invent, so coverage has to be visible before any Stage 2 mirror build.
//
// Reads live rows from ghost_agency_prospects, resolves each field the way the
// preview does (top-level column first, then record.*, then truth_packet), and
// reports coverage per field plus a per-prospect present/missing matrix.
//
//   node scripts/intake-gap-audit.js [--limit 40] [--json <path>]

const fs = require("node:fs");
const path = require("node:path");

const ENV = "C:/Users/Main/Documents/New project 2/.fable-proof.env";
if (fs.existsSync(ENV)) {
  for (const line of fs.readFileSync(ENV, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const has = (v) => {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  const s = String(v).trim();
  return Boolean(s) && !/^(null|undefined|n\/a|none|0)$/i.test(s);
};

// FIELD -> how the preview resolves it, and where it surfaces. `renders` names
// the consumer so an unused capture is obvious at a glance.
const FIELDS = [
  { key: "business_name", label: "Business name", renders: "JSON-LD name · NAP · hero",
    get: (r, c) => r.business_name || c.business_name },
  { key: "phone", label: "Phone", renders: "JSON-LD telephone · NAP · call CTA",
    get: (r, c) => r.phone || c.phone },
  { key: "address", label: "Street address", renders: "JSON-LD streetAddress · NAP",
    get: (r, c) => c.address },
  { key: "city", label: "City", renders: "JSON-LD addressLocality · NAP · headline",
    get: (r, c) => r.city || c.city },
  { key: "state", label: "State", renders: "JSON-LD addressRegion · NAP",
    get: (r, c) => r.state || c.state },
  { key: "postal", label: "Postal code", renders: "JSON-LD postalCode · NAP",
    get: (r, c) => c.postal || c.postal_code || c.zip },
  { key: "geo", label: "Geo lat/lng", renders: "JSON-LD geo · map pin",
    get: (r, c) => (has(c.latitude) && has(c.longitude)) ? [c.latitude, c.longitude] : (c.latlng || null) },
  { key: "place_id", label: "Google Place ID", renders: "review CTA · map pin (REQUIRED for review CTA)",
    get: (r, c) => c.place_id },
  { key: "rating", label: "Star rating", renders: "aggregateRating · trust signals",
    get: (r, c) => c.rating },
  { key: "review_count", label: "Review count", renders: "aggregateRating · trust signals",
    get: (r, c) => c.review_count },
  { key: "hours", label: "Opening hours", renders: "JSON-LD openingHours · contact panel",
    get: (r, c, t) => c.hours || c.opening_hours || t.hours },
  { key: "logo", label: "Logo / image", renders: "JSON-LD image · header mark",
    get: (r, c, t) => c.logo_url || c.logo || t.logo_url },
  { key: "photos", label: "Photos", renders: "gallery photo_slots",
    get: (r, c, t) => c.photos || t.photos || t.images },
  { key: "services", label: "Services", renders: "service cards · areaServed copy",
    get: (r, c, t) => r.primary_services || c.primary_services || t.services },
  { key: "email", label: "Email", renders: "contact row · outreach target",
    get: (r, c) => r.email || r.owner_email || c.email },
  { key: "current_website", label: "Current website", renders: "before/after strip",
    get: (r, c) => r.current_website || c.current_website },
  { key: "gbp_url", label: "Google profile URL", renders: "JSON-LD sameAs · review link fallback",
    get: (r, c) => c.gbp_url || c.profile_url },
];

async function main() {
  const limit = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || 40;
  const jsonOut = (process.argv.find((a) => a.startsWith("--json=")) || "").split("=")[1] || "";
  const url = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) { console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not resolved"); process.exit(2); }

  const res = await fetch(
    `${url}/rest/v1/ghost_agency_prospects?select=*&limit=${limit}&order=created_at.desc`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) { console.error(`supabase ${res.status} — database unreachable`); process.exit(3); }
  const rows = await res.json();
  if (!Array.isArray(rows) || !rows.length) { console.error("no prospect rows"); process.exit(4); }

  const perProspect = [];
  const coverage = Object.fromEntries(FIELDS.map((f) => [f.key, 0]));

  for (const r of rows) {
    const c = (r.record && typeof r.record === "object") ? r.record : {};
    const t = (c.truth_packet && typeof c.truth_packet === "object") ? c.truth_packet : {};
    const present = {};
    for (const f of FIELDS) {
      let v = null;
      try { v = f.get(r, c, t); } catch { v = null; }
      const ok = has(v);
      present[f.key] = ok;
      if (ok) coverage[f.key] += 1;
    }
    perProspect.push({
      business_name: r.business_name || "(unnamed)",
      industry: r.industry || c.industry || "",
      city: r.city || c.city || "",
      present,
      missing: FIELDS.filter((f) => !present[f.key]).map((f) => f.key),
    });
  }

  const n = rows.length;
  const report = FIELDS.map((f) => ({
    field: f.key, label: f.label, renders: f.renders,
    present: coverage[f.key], total: n,
    pct: Math.round((coverage[f.key] / n) * 100),
  })).sort((a, b) => a.pct - b.pct);

  console.log(`\nINTAKE COVERAGE — ${n} most recent prospects\n`);
  console.log("  COVERAGE  FIELD                 CAPTURED  RENDERS WHERE");
  console.log("  " + "-".repeat(88));
  for (const f of report) {
    const bar = "█".repeat(Math.round(f.pct / 10)).padEnd(10, "·");
    console.log(`  ${bar} ${String(f.pct).padStart(3)}%  ${f.label.padEnd(20)} ${String(f.present + "/" + f.total).padStart(6)}  ${f.renders}`);
  }

  const dead = report.filter((f) => f.pct === 0);
  const partial = report.filter((f) => f.pct > 0 && f.pct < 60);
  console.log(`\n  NEVER CAPTURED (renders empty by design): ${dead.length ? dead.map((f) => f.label).join(", ") : "none"}`);
  console.log(`  PARTIAL (<60%, preview will vary): ${partial.length ? partial.map((f) => `${f.label} ${f.pct}%`).join(", ") : "none"}`);

  const reviewReady = perProspect.filter((p) => p.present.place_id).length;
  const ratingReady = perProspect.filter((p) => p.present.rating && p.present.review_count).length;
  console.log(`\n  Review CTA renderable (has Place ID): ${reviewReady}/${n}`);
  console.log(`  aggregateRating renderable (rating + count): ${ratingReady}/${n}`);

  console.log(`\n  PER-PROSPECT (first 12) — ✓ present · · missing`);
  const cols = FIELDS.map((f) => f.key);
  console.log("  " + "business".padEnd(30) + cols.map((k) => k.slice(0, 4).padEnd(5)).join(""));
  for (const p of perProspect.slice(0, 12)) {
    console.log("  " + p.business_name.slice(0, 28).padEnd(30) + cols.map((k) => (p.present[k] ? "  ✓  " : "  ·  ")).join(""));
  }

  const payload = { generatedAt: new Date().toISOString(), prospectsAudited: n, coverage: report,
    reviewCtaRenderable: reviewReady, aggregateRatingRenderable: ratingReady, perProspect };
  if (jsonOut) {
    fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
    fs.writeFileSync(jsonOut, JSON.stringify(payload, null, 2) + "\n");
    console.log(`\n  machine-readable → ${jsonOut}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
