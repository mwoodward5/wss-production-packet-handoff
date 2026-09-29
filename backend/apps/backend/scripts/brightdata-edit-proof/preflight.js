"use strict";
// scripts/brightdata-edit-proof/preflight.js — can an edit job actually run?
// Checks every precondition runSiteEdit() depends on, WITHOUT deploying.

const { loadEnv, present } = require("./env");
loadEnv();

const { resolveSiteEditTarget } = require("../../lib/site-edit-targets");
const { listAll } = require("../../lib/site-editor");
const { select } = require("../../lib/store");

const SLUG = process.argv[2] || "wss-test-flint-plumbing-s5";

async function main() {
  const out = {};

  console.log("env: " + present([
    "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "VERCEL_TOKEN", "VERCEL_TEAM_ID",
    "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "RESEND_API_KEY", "GHOST_AGENCY_ADMIN_TOKEN",
  ]).join("\n     "));

  // 1. Is the slug a resolvable, ghost-owned deploy target?
  const target = await resolveSiteEditTarget(SLUG);
  out.resolveSiteEditTarget = target;
  console.log("\n1. resolveSiteEditTarget(%j) -> %s", SLUG, JSON.stringify(target));

  // 2. Is there archived source in the wss-site-sources bucket? This is the
  //    first thing runSiteEdit() does, and it throws if the prefix is empty.
  try {
    const rels = await listAll(SLUG);
    out.archivedFiles = rels.length;
    out.archivedSample = rels.slice(0, 15);
    out.hasIndexHtml = rels.includes("index.html");
    console.log("\n2. archived source files: %d", rels.length);
    console.log("   index.html present: %s", out.hasIndexHtml);
    console.log("   sample: %s", JSON.stringify(rels.slice(0, 15), null, 2));
  } catch (e) {
    out.archiveError = String(e.message);
    console.log("\n2. ARCHIVE LIST FAILED: %s", e.message);
  }

  // 3. Does the edit-jobs table exist and what columns does a row carry?
  try {
    const jobs = await select("ghost_agency_edit_jobs", "?select=*&limit=3&order=created_at.desc");
    const rows = Array.isArray(jobs) ? jobs : jobs?.data || [];
    out.editJobsTable = { ok: true, rowsSeen: rows.length, columns: rows[0] ? Object.keys(rows[0]) : [] };
    console.log("\n3. ghost_agency_edit_jobs: %d recent rows; columns=%s",
      rows.length, JSON.stringify(out.editJobsTable.columns));
    for (const r of rows) {
      console.log("   - %s slug=%s status=%s instruction=%j",
        r.job_id, r.site_slug, r.status, String(r.instruction || "").slice(0, 70));
    }
  } catch (e) {
    out.editJobsTable = { ok: false, error: String(e.message) };
    console.log("\n3. edit-jobs table FAILED: %s", e.message);
  }

  console.log("\n--- VERDICT ---");
  const canRun = Boolean(out.resolveSiteEditTarget) && out.archivedFiles > 0;
  console.log(canRun
    ? "PRECONDITIONS MET — runSiteEdit() has a target and source to work from."
    : "BLOCKED — " + (!out.resolveSiteEditTarget ? "no deploy target. " : "") + (!out.archivedFiles ? "no archived source." : ""));
}

main().catch((e) => { console.error("PREFLIGHT FAILED:", e.message); process.exit(1); });
