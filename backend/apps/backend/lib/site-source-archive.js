"use strict";
// lib/site-source-archive.js — T15 (voice-site-edit-loop): writes a site's
// deployed file tree into the Supabase "wss-site-sources" bucket, in the
// exact layout lib/site-editor.js (runSiteEdit) reads back
// (wss-site-sources/<siteSlug>/<relativePath>). Without an archived source
// tree there, runSiteEdit fails immediately with "no archived source for
// site '<slug>'" — today that only exists for one hand-seeded pilot
// (ab-professional-detailing).
//
// SCOPE — read this before wiring in a new caller:
//   In-repo callers: only the donor-forge deploy stage
//   (api/admin/forge-jobs.js -> lib/forge.js `deploy`) calls this today,
//   because that is the one build path where ghost already holds every
//   deployed file in memory as { rel: Buffer } at the exact moment it
//   deploys them (the same `files` object passed to lib/forge.js
//   vercelDeploy()).
//
//   The default, at-scale prospect pipeline (external SiteForge service —
//   see lib/siteforge.js dispatchSiteForgePreview + api/webhooks/siteforge.js)
//   used to not hand ghost its build output at all: ghost only ever
//   received a preview_url/report_url pointing at pages hosted inside
//   SiteForge's own multi-tenant Vercel app. As of the SiteForge repo's
//   app/lib/ghost-source-archive.mjs (wired into
//   app/lib/engine-adapter.mjs runDurableTryStage's terminal "done" stage),
//   SiteForge now best-effort-writes its own build output directly into
//   THIS bucket, at THIS exact path shape, over the Supabase Storage REST
//   API — a real upload-on-build hook, not a preview_url crawl, so it never
//   ships an incomplete file set the way scraping a rendered page would.
//   That is gated on an operator wiring GHOST_AGENCY_SOURCE_ARCHIVE_
//   SUPABASE_URL / _KEY (this project's SUPABASE_URL and a service-role
//   key) into SiteForge's own Vercel env — until then it is a silent no-op
//   there, same as before.
//
//   Archiving the source is still only half of T15: lib/site-edit-targets.js
//   resolveSiteEditTarget() deliberately still returns null for every
//   SiteForge-built prospect, because ghost has no Vercel project it
//   controls to redeploy an edited version of that archive to. See the
//   large spec comment in lib/site-edit-targets.js for the promote-on-
//   first-edit design that would close that remaining gap, and why it is
//   intentionally left unimplemented (spec + TODO, not code) for now.
//
// This module deliberately does not import anything from
// lib/site-editor.js (the proven read/edit path) or share its Supabase
// client, so a bug here can never regress that file.

const BUCKET = "wss-site-sources";

function sb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  return { url, headers: { Authorization: `Bearer ${key}`, apikey: key } };
}

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
  return "application/octet-stream";
}

/**
 * Every object currently archived under this slug, as relative paths.
 *
 * Supabase Storage's list endpoint is one directory deep and reports
 * subdirectories as rows with no `id`, so this walks them. It is only ever
 * used to work out what the archive holds that the deploy no longer does.
 */
async function listArchived(siteSlug, prefix = "", depth = 0) {
  if (depth > 6) return [];
  const { url, headers } = sb();
  const out = [];
  const base = `${siteSlug}${prefix ? `/${prefix}` : ""}`;
  let offset = 0;
  for (;;) {
    const res = await fetch(`${url}/storage/v1/object/list/${BUCKET}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: base, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
    });
    if (!res.ok) throw new Error(`archive list failed ${base}: ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) break;
    for (const row of rows) {
      const name = String(row && row.name || "");
      if (!name) continue;
      const rel = prefix ? `${prefix}/${name}` : name;
      // A row with no id is a folder, not an object.
      if (row.id) out.push(rel);
      else out.push(...await listArchived(siteSlug, rel, depth + 1));
    }
    if (rows.length < 1000) break;
    offset += rows.length;
  }
  return out;
}

async function removeArchived(siteSlug, rels) {
  const { url, headers } = sb();
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: rels.map((rel) => `${siteSlug}/${rel}`) }),
  });
  if (!res.ok) throw new Error(`archive delete failed: ${res.status}`);
  return rels.length;
}

/**
 * Remove only the generated source archive for a retired site.  This is not a
 * best-effort build helper: callers use its explicit result to keep a durable
 * teardown-pending state when storage cannot be proven gone.
 */
async function purgeArchivedSiteSource(siteSlug) {
  const slug = String(siteSlug || "").trim();
  if (!slug) return { ok: false, removed: 0, reason: "missing_site_slug" };
  try {
    const rels = await listArchived(slug);
    if (!rels.length) return { ok: true, removed: 0, alreadyEmpty: true };
    const result = await removeArchived(slug, rels);
    if (!Number.isInteger(result) || result !== rels.length) {
      return { ok: false, removed: 0, reason: "archive_remove_incomplete" };
    }
    return { ok: true, removed: rels.length, alreadyEmpty: false };
  } catch (error) {
    return { ok: false, removed: 0, reason: String(error?.message || error).slice(0, 180) };
  }
}

async function uploadOne(siteSlug, rel, buf) {
  const { url, headers } = sb();
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${encodeURIComponent(siteSlug)}/${rel}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": contentTypeFor(rel), "x-upsert": "true" },
    body: buf,
  });
  if (!res.ok) throw new Error(`archive upload failed ${rel}: ${res.status}`);
}

/**
 * Archive a deployed site's exact file tree so it becomes voice-editable.
 * NEVER throws — an archive failure must never fail (or even flag as
 * failed) the deploy/build stage it is attached to. Callers should record
 * the returned summary on the job for admin visibility, nothing more.
 *
 * @param {{siteSlug: string, files: Record<string, Buffer>}} input
 * @returns {Promise<{ok: boolean, archived: number, total: number, errors: Array}>}
 */
async function archiveSiteSource({ siteSlug, files, prune = false } = {}) {
  const slug = String(siteSlug || "").trim();
  if (!slug || !files || typeof files !== "object" || !Object.keys(files).length) {
    return { ok: false, archived: 0, total: 0, errors: [{ error: "missing siteSlug or files" }] };
  }
  let archived = 0;
  const errors = [];
  for (const [rel, buf] of Object.entries(files)) {
    try {
      const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
      await uploadOne(slug, rel, buffer);
      archived += 1;
    } catch (err) {
      errors.push({ rel, error: String(err && err.message ? err.message : err) });
    }
  }
  const result = { ok: errors.length === 0, archived, total: Object.keys(files).length, errors };
  if (prune) result.pruned = await pruneToDeployed(slug, files, errors);
  return result;
}

/**
 * ==========================================================================
 * THE ARCHIVE IS "WHAT WE DEPLOYED", NOT "EVERYTHING WE EVER DEPLOYED"
 * ==========================================================================
 * uploadOne() sends x-upsert, so before this the archive was the UNION of
 * every tree ever written to the slug. A rebuild that legitimately drops a
 * page therefore left that page behind in the bucket, and the two disagreed
 * about what the site is.
 *
 * MEASURED, on wss-test-rimrock-plumbing-billings, 2026-08-11:
 *   · /privacy served 200 before the rebuild and 404 after it — correct: the
 *     edit that created it predates op-recording, so the engine listed it in
 *     `legacy_unrecorded` and did not guess.
 *   · privacy.html was STILL in the archive, 13,805 bytes, readable.
 *   · So the customer then asked for a privacy page and the editor refused:
 *     "legal_page: privacy.html already exists". The one page the visitor
 *     cannot reach is the one page the editor will not create.
 *
 * That is the "reports success, nothing changes" class in its purest form,
 * and it is caused entirely by the archive keeping ghosts. The editor reads
 * this bucket to decide what the site contains; if the bucket lies, every
 * decision downstream of it is wrong.
 *
 * OPT-IN, BECAUSE A PARTIAL WRITER MUST NOT BE ABLE TO EMPTY A SITE.
 * Only a caller holding the COMPLETE deployed tree may pass prune:true. The
 * edit lane uploads changed files only and must never reach this.
 *
 * TWO MORE RAILS, because deleting bytes is not undoable:
 *   1. No index.html in the deployed set -> refuse to prune anything and say
 *      so. A tree without a home page is not a site, it is a mistake.
 *   2. Pruning more than half the archive is treated the same way. A rebuild
 *      that drops a page is normal; one that drops most of the site is a bug
 *      somewhere upstream, and the archive is the last copy.
 *   3. An upload error anywhere in this call cancels the prune outright —
 *      the deployed set we would be reconciling against is not trustworthy.
 * Every removed path is named in the return value, never counted.
 */
async function pruneToDeployed(slug, files, uploadErrors) {
  if (uploadErrors.length) {
    return { ok: false, removed: [], skipped: "upload_errors_present" };
  }
  const deployed = new Set(Object.keys(files));
  if (!deployed.has("index.html")) {
    return { ok: false, removed: [], skipped: "no_index_html_in_deployed_set" };
  }
  try {
    const existing = await listArchived(slug);
    const extra = existing.filter((rel) => !deployed.has(rel));
    if (!extra.length) return { ok: true, removed: [], archivedObjects: existing.length };
    if (existing.length && extra.length > existing.length / 2) {
      return {
        ok: false,
        removed: [],
        candidates: extra.length,
        archivedObjects: existing.length,
        skipped: "would_remove_more_than_half_the_archive",
      };
    }
    await removeArchived(slug, extra);
    return { ok: true, removed: extra, archivedObjects: existing.length };
  } catch (err) {
    // Same contract as the rest of this module: an archive problem is
    // reported, never thrown, and never fails the build it is attached to.
    return { ok: false, removed: [], error: String(err && err.message ? err.message : err) };
  }
}

module.exports = { archiveSiteSource, listArchived, purgeArchivedSiteSource, BUCKET };
