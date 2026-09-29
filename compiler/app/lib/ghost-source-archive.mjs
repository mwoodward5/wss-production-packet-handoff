// app/lib/ghost-source-archive.mjs — best-effort mirror of a finished
// SiteForge build's outDir into ghost's `wss-site-sources` Supabase bucket,
// so the prospect becomes voice-editable through ghost's existing
// apps/backend/lib/site-editor.js runSiteEdit(). Zero ghost-side changes
// needed to READ what this writes — the bucket name, per-file path shape
// (`<siteSlug>/<relativePath>`), and content-type mapping here are copied
// EXACTLY from ghost's apps/backend/lib/site-source-archive.js so the two
// repos agree on the wire format without sharing code.
//
// WHY THIS EXISTS (T15 / voice-site-edit-loop, ghost side): ghost's default
// at-scale prospect pipeline never received build output before this change
// — it only got a preview_url pointing into SiteForge's own multi-tenant
// Vercel app (this app, at /try/<token>/). Without an archived source tree,
// every SiteForge-built prospect hit "no archived source for site '<slug>'"
// the instant a caller asked Riley for a voice edit. This module closes
// that half of the gap. It does NOT solve the other half: ghost's
// VERCEL_TOKEN/VERCEL_TEAM_ID cannot redeploy anything inside this app's
// Vercel project, so an edited archive still needs a ghost-owned redeploy
// target before a voice edit can actually go live — see the ghost repo's
// lib/site-edit-targets.js for that half of the spec.
//
// CONTRACT — read before changing:
//  - NEVER throws. Every call site treats the return value as advisory.
//  - NEVER slows or risks a build: only call this AFTER a job's terminal
//    "done" state is durably persisted, never before or in a path a QC
//    failure could depend on.
//  - A no-op (`{ skipped: true }`) whenever the cross-repo Supabase
//    credentials are not configured on this Vercel project — this is the
//    default until an operator explicitly wires GHOST_AGENCY_SOURCE_ARCHIVE_
//    SUPABASE_URL / _KEY into SiteForge's environment. See the PR
//    description for the exact values (ghost's own SUPABASE_URL and a
//    service-role key scoped to the wss-site-sources bucket).
//  - Time-boxed (default 20s total) so a slow/unreachable Supabase project
//    can never meaningfully extend a durable stage invocation.
//  - Only ever called for prospects that actually came through the
//    ghost-agency dispatcher (job.ghost_context.prospect.prospect_id
//    present) — SiteForge's own public /try users must never have their
//    preview data written into ghost's private bucket.

import { readdirSync, statSync, readFileSync } from "node:fs";
import path from "node:path";

const BUCKET = "wss-site-sources";

// QC/debug artifacts inside outDir that are never part of the deployed
// site (large screenshot PNGs used only for grading) — skipped so the
// mirror stays fast and only carries what lib/site-editor.js could ever
// need to edit or redeploy.
const SKIP_DIRS = new Set(["screenshots"]);

function supabaseConfig(env) {
  const url = String(env.GHOST_AGENCY_SOURCE_ARCHIVE_SUPABASE_URL || "").trim();
  const key = String(env.GHOST_AGENCY_SOURCE_ARCHIVE_SUPABASE_KEY || "").trim();
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

// Matches apps/backend/lib/site-source-archive.js contentTypeFor() exactly.
function contentTypeFor(rel) {
  if (/\.html?$/i.test(rel)) return "text/html";
  if (/\.css$/i.test(rel)) return "text/css";
  if (/\.m?js$/i.test(rel)) return "application/javascript";
  if (/\.json$/i.test(rel)) return "application/json";
  if (/\.svg$/i.test(rel)) return "image/svg+xml";
  if (/\.png$/i.test(rel)) return "image/png";
  if (/\.(jpe?g)$/i.test(rel)) return "image/jpeg";
  if (/\.webp$/i.test(rel)) return "image/webp";
  if (/\.mp4$/i.test(rel)) return "video/mp4";
  if (/\.xml$/i.test(rel)) return "application/xml";
  if (/\.txt$/i.test(rel)) return "text/plain";
  return "application/octet-stream";
}

function listFiles(dir) {
  const out = [];
  const walk = (d, base) => {
    let entries = [];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries) {
      const fp = path.join(d, name);
      const rel = base ? `${base}/${name}` : name;
      let st;
      try {
        st = statSync(fp);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        walk(fp, rel);
      } else {
        out.push({ fp, rel });
      }
    }
  };
  walk(dir, "");
  return out;
}

async function uploadOne(cfg, siteSlug, rel, buf, timeoutMs, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${cfg.url}/storage/v1/object/${BUCKET}/${encodeURIComponent(siteSlug)}/${rel}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        apikey: cfg.key,
        "Content-Type": contentTypeFor(rel),
        "x-upsert": "true",
      },
      body: buf,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Best-effort mirror of a finished build's outDir into
 * wss-site-sources/<siteSlug>/ in ghost's Supabase project, using the exact
 * path/key convention ghost's lib/site-editor.js reads back. NEVER throws.
 *
 * @param {{siteSlug: string, dir: string, overallTimeoutMs?: number, env?: object, fetchImpl?: Function}} input
 * @returns {Promise<{ok: boolean, skipped: boolean, archived?: number, total?: number, errors?: Array, reason?: string}>}
 */
export async function archiveSiteSourceToGhost({
  siteSlug,
  dir,
  overallTimeoutMs = 20000,
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const slug = String(siteSlug || "").trim();
  if (!slug || !dir) return { ok: false, skipped: true, reason: "missing siteSlug or dir" };

  const cfg = supabaseConfig(env);
  if (!cfg) return { ok: false, skipped: true, reason: "ghost source-archive Supabase credentials not configured" };

  const startedAt = Date.now();
  let files;
  try {
    files = listFiles(dir);
  } catch (err) {
    return { ok: false, skipped: false, archived: 0, total: 0, errors: [{ error: String(err?.message || err) }] };
  }
  if (!files.length) return { ok: false, skipped: false, archived: 0, total: 0, errors: [{ error: "no files to archive" }] };

  let archived = 0;
  const errors = [];
  for (const { fp, rel } of files) {
    if (Date.now() - startedAt > overallTimeoutMs) {
      errors.push({ error: `archive time budget (${overallTimeoutMs}ms) exceeded — ${files.length - archived - errors.length} file(s) skipped` });
      break;
    }
    try {
      const buf = readFileSync(fp);
      const remaining = Math.max(1000, overallTimeoutMs - (Date.now() - startedAt));
      await uploadOne(cfg, slug, rel, buf, Math.min(remaining, 10000), fetchImpl);
      archived += 1;
    } catch (err) {
      errors.push({ rel, error: String(err?.message || err) });
    }
  }
  return { ok: errors.length === 0, skipped: false, archived, total: files.length, errors };
}
