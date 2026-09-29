"use strict";

// api/admin/reclassify-forge-evidence.js — one-pass, idempotent migration that
// ends the renderer impersonation in EXISTING records.
//
// Every dispatch the old full-run "forge_job_mirror" branch produced carries a
// deterministic marker: generation_fingerprint prefixed "forge-job:". Those
// records claim SiteForge's renderer/QC identifiers for builds SiteForge never
// processed (verified divergence audit, 2026-07-29). This route rewrites
// exactly those rows to the honest forge identity — renderer
// ghost-forge-mirror-v1, QC ghost-forge-audit-v1, release evidence
// ghost-forge-release-evidence-v1 built from the job's own persisted audit —
// and touches nothing else. Genuine SiteForge evidence is left byte-identical.
//
// POST {dryRun:true}  (default) -> reports what WOULD change, writes nothing.
// POST {dryRun:false}           -> applies the rewrite.
//
// Idempotent: a reclassified row no longer matches the selector's renderer
// condition, so a second run is a no-op.

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { select, upsertRow } = require("../../lib/store");
const {
  REQUIRED_RENDERER,
  FORGE_MIRROR_RENDERER,
  FORGE_MIRROR_QC_CONTRACT,
} = require("../../lib/siteforge");
const { forgeReleaseEvidence } = require("../../lib/forge");

const FINGERPRINT_PREFIX = "forge-job:";

function isImpersonated(record = {}) {
  const fp = String(record.siteforge_generation_fingerprint || "");
  if (!fp.startsWith(FINGERPRINT_PREFIX)) return false;
  return record.siteforge_renderer === REQUIRED_RENDERER;
}

function reclassifyRecord(record = {}) {
  const job = record.forge_job || {};
  const evidence = job.release || forgeReleaseEvidence({ job, audit: job.audit || {} });
  const next = {
    ...record,
    siteforge_renderer: FORGE_MIRROR_RENDERER,
    siteforge_qc_contract: FORGE_MIRROR_QC_CONTRACT,
  };
  if (record.build_dispatch && typeof record.build_dispatch === "object") {
    next.build_dispatch = {
      ...record.build_dispatch,
      renderer: FORGE_MIRROR_RENDERER,
      required_renderer: FORGE_MIRROR_RENDERER,
      qc_contract: FORGE_MIRROR_QC_CONTRACT,
      required_qc_contract: FORGE_MIRROR_QC_CONTRACT,
      release_evidence: evidence,
      reclassified: {
        from_renderer: REQUIRED_RENDERER,
        reason: "forge_job_mirror_impersonation",
        at: new Date().toISOString(),
      },
    };
  }
  return next;
}

async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    const body = await readJson(req).catch(() => ({}));
    const dryRun = body.dryRun !== false; // fail-safe: writes require an explicit false
    const limit = Math.min(Math.max(Number(body.limit) || 200, 1), 500);

    const result = await select(
      "ghost_agency_prospects",
      `?select=*&record->>siteforge_generation_fingerprint=like.${encodeURIComponent(FINGERPRINT_PREFIX)}*&limit=${limit}`,
    );
    if (!result?.ok) {
      return sendJson(res, 503, { ok: false, error: "prospect_store_unavailable" });
    }

    const rows = Array.isArray(result.data) ? result.data : [];
    const candidates = rows.filter((row) => isImpersonated(row.record || {}));
    const changed = [];
    for (const row of candidates) {
      const nextRecord = reclassifyRecord(row.record || {});
      changed.push({
        prospect_id: row.prospect_id,
        business_name: row.business_name || "",
        from: { renderer: row.record?.siteforge_renderer, qc_contract: row.record?.siteforge_qc_contract },
        to: { renderer: FORGE_MIRROR_RENDERER, qc_contract: FORGE_MIRROR_QC_CONTRACT },
      });
      if (!dryRun) {
        const { id, created_at, updated_at, ...rest } = row;
        await upsertRow("ghost_agency_prospects", { ...rest, record: nextRecord }, "prospect_id");
      }
    }

    return sendJson(res, 200, {
      ok: true,
      dryRun,
      scanned: rows.length,
      impersonated: candidates.length,
      reclassified: dryRun ? 0 : changed.length,
      changes: changed,
    });
  } catch (error) {
    handleError(res, error);
  }
}

module.exports = handler;
module.exports.isImpersonated = isImpersonated;
module.exports.reclassifyRecord = reclassifyRecord;
