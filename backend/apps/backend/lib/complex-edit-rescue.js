"use strict";

// lib/complex-edit-rescue.js
//
// Riley's surgical planner is intentionally conservative. That is correct for
// facts, arbitrary scripts and selectors, but it created a bad product failure:
// a request it could not express was written straight to `refused`, even when
// the requested effect was deterministic and safe to implement without an LLM.
//
// This is a SECOND-STAGE rescue lane for those capability refusals. It never
// rescues truth/safety refusals. Every rescue is named, bounded and applied from
// backend-owned code, then the live alias is read back before the job may become
// `done`.

const { randomUUID } = require("node:crypto");
const { select, conditionalUpdate, upsertRow, recordEvent } = require("./store");
const { listAll, download, upload } = require("./site-editor");
const { vercelDeploy } = require("./forge");
const { resolveSiteEditTarget } = require("./site-edit-targets");

const MAX_RESCUES_PER_RUN = 2;
const SHIMMER_REQUEST = /\b(shimmer|shine|sheen|glint|light sweep|shine effect)\b/i;
const ANIMATION_REQUEST = /\b(animate|animated|animation|moving|sweep|going through|go through)\b/i;
const HERO_TEXT_REQUEST = /\b(hero|headline|heading|title|main text|hero text)\b/i;
const SAFETY_REFUSAL = /\b(unsourced|invent|fabricat|licensed|insured|claim|credential|price|review|rating|phone number|outside imagery|third-party|tracking|script|unsafe)\b/i;
const CAPABILITY_REFUSAL = /\b(not achievable|cannot|can't|couldn't|not supported|static style|bigger build|planner|animation|shimmer|shine|structural)\b/i;

function isShimmerRescue(job = {}) {
  const instruction = String(job.instruction || "");
  const result = job.result && typeof job.result === "object" ? job.result : {};
  const reason = `${result.reason || ""} ${result.error || ""} ${result.say || ""}`;
  if (!SHIMMER_REQUEST.test(instruction)) return false;
  if (!HERO_TEXT_REQUEST.test(instruction)) return false;
  if (SAFETY_REFUSAL.test(reason)) return false;
  return !reason || CAPABILITY_REFUSAL.test(reason) || ANIMATION_REQUEST.test(instruction);
}

function safeJobCssId(jobId) {
  return String(jobId || "edit").replace(/[^a-z0-9_-]/gi, "-");
}

function shimmerCss(jobId) {
  const cssId = safeJobCssId(jobId);
  // The sweep uses currentColor instead of guessing a client's brand hex. The
  // letters keep their existing colour; a narrow translucent white highlight
  // travels through them. The selector is intentionally limited to the hero's
  // heading elements and cannot touch links, forms, navigation or body copy.
  return `
<!-- wss-complex-rescue ${jobId} -->
<style data-wss-complex-rescue="${jobId}">
@keyframes wss-riley-shimmer-${cssId} {
  0% { background-position: 180% 50%; }
  100% { background-position: -80% 50%; }
}
section#top h1,
section#top [role="heading"]:first-of-type {
  color: currentColor;
  background-image: linear-gradient(110deg, currentColor 0%, currentColor 38%, rgba(255,255,255,.96) 49%, currentColor 60%, currentColor 100%);
  background-size: 240% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: wss-riley-shimmer-${cssId} 3.2s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  section#top h1,
  section#top [role="heading"]:first-of-type {
    animation: none;
    background: none;
    -webkit-text-fill-color: currentColor;
  }
}
</style>`;
}

function injectBeforeHeadEnd(html, block, jobId) {
  const text = String(html || "");
  if (text.includes(`data-wss-complex-rescue="${jobId}"`)) return text;
  const at = text.lastIndexOf("</head>");
  if (at < 0) throw new Error("complex rescue: index.html has no </head>");
  return `${text.slice(0, at)}\n${block}\n${text.slice(at)}`;
}

async function liveHasMarker(aliasHost, jobId, fetchImpl = fetch) {
  const host = String(aliasHost || "").replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!host) return false;
  const marker = `data-wss-complex-rescue=\"${jobId}\"`;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const res = await fetchImpl(`https://${host}/?wss_edit=${encodeURIComponent(jobId)}&v=${Date.now()}`, {
      headers: { "cache-control": "no-cache" },
    }).catch(() => null);
    if (res && res.ok) {
      const html = await res.text();
      if (html.includes(marker)) return true;
    }
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return false;
}

async function applyShimmer(job, deps = {}) {
  const list = deps.listAll || listAll;
  const get = deps.download || download;
  const put = deps.upload || upload;
  const deploy = deps.vercelDeploy || vercelDeploy;
  const resolveTarget = deps.resolveSiteEditTarget || resolveSiteEditTarget;
  const verifyMarker = deps.liveHasMarker || liveHasMarker;

  const target = await resolveTarget(job.site_slug);
  if (!target) throw new Error(`complex rescue: no editable deploy target for ${job.site_slug}`);

  const rels = await list(job.site_slug);
  if (!rels.includes("index.html")) throw new Error("complex rescue: site archive has no index.html");
  const files = {};
  for (const rel of rels) files[rel] = await get(job.site_slug, rel);

  const beforeBuf = Buffer.from(files["index.html"]);
  const before = beforeBuf.toString("utf8");
  // Refuse rather than silently ship a selector that cannot possibly match a
  // compiled donor convention. `#top` is the mirror engine's stable hero id;
  // its literal appears in either index.html or the compiled JS bundle.
  const evidence = [before, ...Object.entries(files)
    .filter(([rel]) => /^assets\/.+\.js$/i.test(rel))
    .slice(0, 12)
    .map(([, buf]) => buf.toString("utf8"))]
    .join("\n");
  if (!/(?:id[:=]\s*["']top["']|["']#top["'])/.test(evidence)) {
    throw new Error("complex rescue: this donor does not expose the standard hero target");
  }

  const after = injectBeforeHeadEnd(before, shimmerCss(job.job_id), job.job_id);
  if (after === before) throw new Error("complex rescue: shimmer injection was a no-op");
  const afterBuf = Buffer.from(after, "utf8");
  files["index.html"] = afterBuf;

  let deployed = null;
  try {
    // Deploy the proposed bytes first. The archive becomes the durable source
    // only AFTER the live alias proves it is serving this exact rescue marker.
    // A bad deploy therefore cannot poison the next rebuild's source archive.
    deployed = await deploy({ files, projectName: target.projectName, aliasHost: target.aliasHost });
    const verified = await verifyMarker(target.aliasHost, job.job_id);
    if (!verified) throw new Error("complex rescue deployed but the live alias did not serve the rescue marker");
    await put(job.site_slug, "index.html", afterBuf, "text/html; charset=utf-8");
    return {
      applied: true,
      rescued: true,
      rescue_kind: "hero-text-shimmer",
      changedFiles: ["index.html"],
      deployUrl: deployed.url,
      alias: deployed.alias,
      verified: { ok: true, status: "marker_live", marker: job.job_id },
      say: "Done — the hero text now has a moving light shimmer through it, while keeping the site's existing text colour. It's live now.",
    };
  } catch (error) {
    // If the proposed deployment reached the alias but anything after that
    // failed (edge verification or archive persistence), put the exact original
    // bytes back on the alias. A rescue is never allowed to end ambiguous.
    if (deployed) {
      try {
        files["index.html"] = beforeBuf;
        await deploy({ files, projectName: target.projectName, aliasHost: target.aliasHost });
      } catch (rollbackError) {
        error.rollback_error = String((rollbackError && rollbackError.message) || rollbackError);
      }
    }
    throw error;
  }
}

async function rescueComplexEdits({ max = MAX_RESCUES_PER_RUN, now = Date.now(), deps = {} } = {}) {
  const read = deps.select || select;
  const claim = deps.conditionalUpdate || conditionalUpdate;
  const write = deps.upsertRow || upsertRow;
  const event = deps.recordEvent || recordEvent;
  const cutoff = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const found = await read(
    "ghost_agency_edit_jobs",
    `status=eq.refused&updated_at=gte.${encodeURIComponent(cutoff)}&order=updated_at.asc&limit=20`,
  );
  const rows = found?.ok && Array.isArray(found.data) ? found.data : [];
  const candidates = rows.filter(isShimmerRescue).slice(0, Math.max(1, Math.min(5, max)));
  const results = [];

  for (const job of candidates) {
    const original = job.result && typeof job.result === "object" ? job.result : {};
    if (original.complex_rescue_attempted) continue;
    const claimedAt = new Date().toISOString();
    const claimToken = randomUUID();
    const got = await claim(
      "ghost_agency_edit_jobs",
      "job_id",
      job.job_id,
      { status: "eq.refused" },
      {
        status: "running",
        result: {
          ...original,
          complex_rescue_attempted: true,
          complex_rescue_started_at: claimedAt,
          complex_rescue_claim: claimToken,
        },
        updated_at: claimedAt,
      },
    ).catch(() => ({ ok: false, updated: false }));
    if (!got || got.ok !== true) continue;

    // PostgREST can apply a conditional PATCH and still return [] because the
    // transition itself falsifies `status=eq.refused` for the RETURNING rows.
    // Verify our one-shot token before treating an empty representation as a
    // lost race — the same production behavior handled by edit-job-runner.
    if (got.updated !== true) {
      const check = await read("ghost_agency_edit_jobs", `job_id=eq.${encodeURIComponent(job.job_id)}&limit=1`).catch(() => null);
      const row = check?.ok && Array.isArray(check.data) ? check.data[0] : null;
      const token = row && row.result && typeof row.result === "object" ? row.result.complex_rescue_claim : null;
      if (token !== claimToken) continue;
    }

    try {
      const result = await applyShimmer(job, deps);
      await write("ghost_agency_edit_jobs", {
        job_id: job.job_id,
        site_slug: job.site_slug,
        instruction: job.instruction,
        status: "done",
        result: { ...original, ...result, complex_rescue_attempted: true },
        updated_at: new Date().toISOString(),
      }, "job_id");
      await event("ghost_agency_complex_edit_rescued", {
        jobId: job.job_id,
        siteSlug: job.site_slug,
        rescue_kind: result.rescue_kind,
      }).catch(() => null);
      results.push({ jobId: job.job_id, status: "done", rescue_kind: result.rescue_kind });
    } catch (error) {
      const message = String((error && error.message) || error).slice(0, 500);
      const rollbackError = error && error.rollback_error ? String(error.rollback_error).slice(0, 300) : null;
      // Preserve the original refusal rather than convert a capability miss to
      // a scarier hard failure. `complex_rescue_attempted` prevents loops.
      await write("ghost_agency_edit_jobs", {
        job_id: job.job_id,
        site_slug: job.site_slug,
        instruction: job.instruction,
        status: "refused",
        result: {
          ...original,
          complex_rescue_attempted: true,
          complex_rescue_error: message,
          ...(rollbackError ? { complex_rescue_rollback_error: rollbackError } : {}),
          say: original.say || "I couldn't safely finish that visual effect on this site yet, so I left the live page alone.",
        },
        updated_at: new Date().toISOString(),
      }, "job_id");
      results.push({ jobId: job.job_id, status: "refused", error: message, ...(rollbackError ? { rollbackError } : {}) });
    }
  }

  return { examined: rows.length, candidates: candidates.length, rescued: results.filter((r) => r.status === "done").length, results };
}

module.exports = {
  isShimmerRescue,
  shimmerCss,
  injectBeforeHeadEnd,
  liveHasMarker,
  applyShimmer,
  rescueComplexEdits,
};
