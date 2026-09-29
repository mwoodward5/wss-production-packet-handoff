"use strict";

// api/admin/forge-jobs.js — the donor-forge pipeline as an agency stage machine.
//
// Each POST advances ONE stage (serverless time limits), state persisted on the
// prospect row. A cron or the console can pump jobs forward; every transition is
// logged to ghost_agency_events so the SigAlert map shows real motion.
//
// GET  ?prospect_id=X                 -> job state + available boilerplates
// POST {action:"start", prospect_id, business_name, phone, city, state,
//       boilerplate, source_urls[], preview_host, project_name}
// POST {action:"advance", prospect_id} -> run the next stage
//
// Stages: dossier -> hydrate -> media_submit -> media_poll -> deploy -> audit -> done
// Any stage error -> status "failed" with the reason; "advance" retries it.
//
// HARD RULE preserved in code: this pipeline NEVER emails a prospect. The final
// stage notifies the OWNER only. Prospect contact stays behind Mark's explicit
// review, outside this endpoint entirely.

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { select, upsertRow, recordEvent } = require("../../lib/store");
const forge = require("../../lib/forge");
const webBrand = require("../../lib/web-brand");
const ambiance = require("../../lib/veo-ambiance");
const { archiveSiteSource } = require("../../lib/site-source-archive");

async function getProspect(prospectId) {
  const res = await select("ghost_agency_prospects", `prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`);
  return res && res.ok && Array.isArray(res.data) && res.data[0] ? res.data[0] : null;
}

async function upsertProspect(prospect) {
  // never write server-generated columns back
  const { id, created_at, updated_at, ...row } = prospect;
  return upsertRow("ghost_agency_prospects", row, "prospect_id");
}

const STAGES = ["dossier", "hydrate", "media_submit", "media_poll", "deploy", "audit", "done"];
const LEGACY_DRAIN_STAGES = new Set([...STAGES, "blocked"]);
const FRESH_BUILD_DISABLED = "fresh_forge_builds_disabled_mirror_engine_only";

function jobOf(prospect) {
  return (prospect && prospect.record && prospect.record.forge_job) || null;
}

// The route is retained only so jobs persisted before the Mirror Engine
// cutover can be inspected and drained.  The old start action is disabled, so
// an advance is legacy only when it points at a complete, already-stored job
// envelope produced by this route's former start action.
function isLegacyDrainJob(job) {
  if (!job || typeof job !== "object" || Array.isArray(job)) return false;
  if (!LEGACY_DRAIN_STAGES.has(String(job.stage || ""))) return false;
  if (!job.input || typeof job.input !== "object" || Array.isArray(job.input)) return false;
  return Number.isFinite(Date.parse(String(job.startedAt || "")));
}

async function saveJob(prospect, job) {
  const record = { ...(prospect.record || {}), forge_job: job };
  await upsertProspect({ ...prospect, record });
  return job;
}

// Hydrated site files can't live in the DB between stages (too big); they are
// rebuilt deterministically from boilerplate+dossier at deploy time instead.
// Only small artifacts (dossier, audit, media buffers as base64 refs) persist.
async function runStage(prospect, job) {
  const stage = job.stage;
  const t0 = Date.now();

  if (stage === "dossier") {
    job.dossier = await forge.buildDossier({
      businessName: job.input.business_name,
      urls: job.input.source_urls || [],
      // The mined Google Business Profile phone is a real-world attestation
      // tied to a place_id, not operator input. Businesses legitimately list
      // a different number on Google than on their own site, and without
      // this the audit blocks the build on a CONTRADICTION that is not one.
      attested: { phone: job.input.phone, source: "google-business-profile" },
    });
    // Their REAL brand, from THEIR OWN site: logo (same-domain only, fail
    // closed on ownership) + accent color measured from their published CSS.
    // This is what makes the mirror read as THEIRS instead of a generic
    // dark-green template with a text wordmark. Best-effort: unreachable site
    // -> measured:false, and hydrate falls back to wordmark + donor theme.
    const sourceSite = (job.input.source_urls || []).find((u) => /^https?:\/\//i.test(String(u || "")));
    job.brand = sourceSite ? await webBrand.brandFromWebsite(sourceSite).catch(() => null) : null;
    job.stage = "hydrate";
  } else if (stage === "hydrate") {
    // dry-run hydrate: prove all required tokens have verified facts NOW so a
    // missing fact fails here, loudly, instead of at deploy.
    forge.hydrateBoilerplate({
      boilerplate: job.input.boilerplate,
      prospect: { ...job.input, preview_host: job.input.preview_host },
      dossier: job.dossier,
      brand: job.brand,
    });
    job.stage = "media_submit";
  } else if (stage === "media_submit") {
    if (job.input.skip_media) {
      job.media = { skipped: true };
      job.stage = "deploy";
    } else {
      // NO generated logo, ever. An AI-invented mark is an identity
      // fabrication — the exact defect the owner flagged on 2026-07-29
      // ("the logo did not transfer"). The mark is the client's REAL logo
      // (job.brand, captured at dossier from their own domain) or the
      // wordmark of their own name. hydrate handles both; media only
      // handles the hero video now.
      job.media = { logoSource: job.brand && job.brand.logo ? "client-site" : "wordmark" };

      // GENERATE ONCE, REUSE FOREVER (owner directive).
      //
      // Ambiance heroes are deliberately generic — no people, no signage,
      // nothing identifying a business — so one clip serves every client in a
      // vertical. This stage used to call Veo for EVERY site, which is both the
      // single largest avoidable cost in the pipeline (~$0.60/render) and the
      // reason jobs sat in media_poll for half an hour.
      //
      // Two cheaper answers come first, and both skip Veo entirely:
      //   1. the donor already ships a hero video -> it is already on disk
      //   2. this vertical's clip was rendered before -> reuse the cached one
      // Only a genuine first-time-for-this-vertical build pays for a render.
      const donorHero = forge.donorHeroVideo(job.input.boilerplate);
      if (donorHero) {
        job.media.donorHero = donorHero;
        job.media.videoSource = "donor";
        job.stage = "deploy";
      } else {
        const vertical = job.input.vertical || job.input.industry || "local service";
        const cached = await ambiance
          .existingAmbianceAsset({ vertical })
          .catch(() => null);
        if (cached && cached.url) {
          job.media.ambianceUrl = cached.url;
          job.media.videoSource = "vertical-cache";
          job.stage = "deploy";
        } else {
          const veoOp = await forge.veoSubmit({
            prompt: ambiance.ambiancePromptFor(vertical),
          });
          job.media.veoOperation = veoOp;
          job.media.videoSource = "veo-first-render";
          job.media.veoStartedAt = Date.now();
          job.stage = "media_poll";
        }
      }
    }
  } else if (stage === "media_poll") {
    const res = await forge.veoPoll(job.media.veoOperation);
    if (!res.done) {
      // stay on this stage; caller re-advances (cron-friendly)
      job.mediaPolls = (job.mediaPolls || 0) + 1;
      // A WALL-CLOCK deadline, not just a poll count. The count alone let a job
      // sit in this stage indefinitely in production (observed frozen at 2
      // across 28 advances), because a counter only bounds the loop if it
      // persists on every path. Elapsed time cannot be lost the same way.
      const startedAt = Number(job.media.veoStartedAt) || 0;
      const elapsedMs = startedAt ? Date.now() - startedAt : 0;
      if (job.mediaPolls > 20 || elapsedMs > 10 * 60 * 1000) {
        job.media.videoFailed = job.mediaPolls > 20
          ? "veo timeout after 20 polls"
          : `veo timeout after ${Math.round(elapsedMs / 1000)}s`;
        job.stage = "deploy";
      }
    } else {
      job.media.videoB64 = res.video.toString("base64");
      job.stage = "deploy";
    }
  } else if (stage === "deploy") {
    const files = forge.hydrateBoilerplate({
      boilerplate: job.input.boilerplate,
      prospect: { ...job.input, preview_host: job.input.preview_host },
      dossier: job.dossier,
      brand: job.brand,
    });
    if (job.media && job.media.videoB64) files["hero-video.mp4"] = Buffer.from(job.media.videoB64, "base64");
    job.deploy = await forge.vercelDeploy({
      files,
      projectName: job.input.project_name,
      aliasHost: job.input.preview_host,
    });
    job.deployedFilesHydratedAt = new Date().toISOString();
    // T15 (voice-site-edit-loop): archive the exact deployed file tree so
    // this site becomes voice-editable via lib/site-editor.js, which reads
    // from wss-site-sources/<project_name>/. Best-effort and strictly
    // additive — archiveSiteSource() never throws, so a Supabase hiccup
    // here can never fail (or even slow down retries of) the deploy stage;
    // it only shows up in job.sourceArchive for admin visibility.
    job.sourceArchive = await archiveSiteSource({ siteSlug: job.input.project_name, files });
    // 503-AMPLIFIER FIX (divergence audit, 2026-07-29): base64 media persisted
    // in record.forge_job made single prospect rows multi-megabyte (measured
    // live: 2.28 MB of videoB64 on one row). console-data reads `record` for
    // 500 rows every 30s poll, so those buffers were a direct driver of the
    // Supabase read timeouts behind console_source_snapshot_unavailable. The
    // buffers exist only to carry bytes BETWEEN stages; the deploy just
    // consumed them, so drop them before the row is written back. A deploy
    // retry re-enters this stage from hydrateBoilerplate + media regeneration,
    // never from these fields.
    if (job.media) {
      delete job.media.videoB64;
      delete job.media.logoB64;
    }
    job.stage = "audit";
  } else if (stage === "audit") {
    const files = forge.hydrateBoilerplate({
      boilerplate: job.input.boilerplate,
      prospect: { ...job.input, preview_host: job.input.preview_host },
      dossier: job.dossier,
      brand: job.brand,
    });
    job.audit = await forge.auditSite({ files, dossier: job.dossier });
    // The renderer's own signed release evidence (ghost-forge-release-evidence-v1).
    // This — not any SiteForge identifier — is what downstream gates verify for
    // forge-lane artifacts. Persisted on the job so full-run copies it verbatim.
    job.release = forge.forgeReleaseEvidence({ job, audit: job.audit });
    // A blocked audit does not un-deploy (owner-review sites are not public
    // to prospects) but it hard-stops the job short of "done" so nothing
    // downstream (owner email templates etc.) treats it as clean.
    job.stage = job.audit.verdict === "BLOCKED" ? "blocked" : "done";
  } else {
    throw new Error(`no runnable stage: ${stage}`);
  }

  job.stageMs = Date.now() - t0;
  job.updatedAt = new Date().toISOString();
  return job;
}

async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "POST"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    if (req.method === "GET") {
      const prospectId = req.query && req.query.prospect_id;
      if (!prospectId) {
        return sendJson(res, 200, {
          ok: true,
          route: "admin/forge-jobs",
          mode: "legacy_drain_read_only",
          fresh_builds_enabled: false,
          replacement_lane: "mirror-engine",
          stages: STAGES,
          boilerplates: forge.listBoilerplates(),
        });
      }
      const prospect = await getProspect(String(prospectId));
      return sendJson(res, 200, {
        ok: true,
        mode: "legacy_drain_read_only",
        fresh_builds_enabled: false,
        job: jobOf(prospect),
      });
    }

    const body = await readJson(req);
    if (body.action === "start") {
      return sendJson(res, 410, {
        ok: false,
        error: FRESH_BUILD_DISABLED,
        replacement_lane: "mirror-engine",
      });
    }

    const prospectId = String(body.prospect_id || "").trim();
    if (!prospectId) return sendJson(res, 400, { ok: false, error: "prospect_id required" });

    if (body.action === "advance") {
      const prospect = await getProspect(prospectId);
      const job = jobOf(prospect);
      if (!job) return sendJson(res, 404, { ok: false, error: "no forge job for prospect" });
      if (!isLegacyDrainJob(job)) {
        return sendJson(res, 409, {
          ok: false,
          error: "forge_job_not_known_legacy_drain",
          replacement_lane: "mirror-engine",
        });
      }
      if (job.stage === "done" || job.stage === "blocked") return sendJson(res, 200, { ok: true, job, note: "terminal" });
      try {
        const before = job.stage;
        const advanced = await runStage(prospect, job);
        delete advanced.failure;
        await saveJob(prospect, advanced);
        await recordEvent("forge.stage_completed", {
          prospect_id: prospectId, from: before, to: advanced.stage, ms: advanced.stageMs,
          ...(advanced.stage === "blocked" ? { blocking: advanced.audit.blocking } : {}),
        }).catch(() => {});
        // trim heavy media buffers from the response (they stay in the DB row)
        const view = { ...advanced, media: advanced.media ? { ...advanced.media, logoB64: undefined, videoB64: advanced.media.videoB64 ? `[${Math.round((advanced.media.videoB64.length * 3) / 4 / 1024)}kb]` : undefined } : undefined };
        return sendJson(res, 200, { ok: true, job: view });
      } catch (e) {
        job.failure = { stage: job.stage, error: String(e && e.message ? e.message : e), at: new Date().toISOString() };
        await saveJob(prospect, job);
        await recordEvent("forge.stage_failed", { prospect_id: prospectId, stage: job.stage, error: job.failure.error }).catch(() => {});
        return sendJson(res, 502, { ok: false, job });
      }
    }

    return sendJson(res, 400, { ok: false, error: "unknown action" });
  } catch (error) {
    handleError(res, error);
  }
}

module.exports = handler;
module.exports.FRESH_BUILD_DISABLED = FRESH_BUILD_DISABLED;
module.exports.isLegacyDrainJob = isLegacyDrainJob;
