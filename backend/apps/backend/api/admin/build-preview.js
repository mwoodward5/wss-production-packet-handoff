"use strict";

const { requireAdminOrHardeningProof } = require("../../lib/proof-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { buildPreviewForProspect, progress } = require("../../lib/full-run");
const { prospectFromRow } = require("../../lib/prospects");
const { select } = require("../../lib/store");

async function resolveProspect(body = {}, lookup = select) {
  const supplied = body.prospect && typeof body.prospect === "object"
    ? body.prospect
    : body.lead && typeof body.lead === "object"
      ? body.lead
      : null;
  const requestedId = String(body.prospectId || body.prospect_id || "").trim();

  if (!requestedId) {
    return supplied && Object.keys(supplied).length ? supplied : null;
  }

  const result = await lookup(
    "ghost_agency_prospects",
    `select=*&prospect_id=eq.${encodeURIComponent(requestedId)}&limit=1`,
  );
  const stored = result?.ok && Array.isArray(result.data) ? prospectFromRow(result.data[0]) : null;
  if (!stored) return null;

  return {
    ...stored,
    ...(supplied || {}),
    prospect_id: requestedId,
  };
}

async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  if (!requireAdminOrHardeningProof(req, res)) return;
  try {
    const body = await readJson(req).catch(() => ({}));
    const prospect = await resolveProspect(body);
    if (!prospect) {
      const requestedId = String(body.prospectId || body.prospect_id || "").trim();
      sendJson(res, requestedId ? 404 : 400, {
        ok: false,
        error: requestedId ? "prospect_not_found" : "missing_prospect",
      });
      return;
    }
    if (body.truth_packet && typeof body.truth_packet === "object") {
      prospect.truth_packet = body.truth_packet;
    }
    const runId = body.runId || `build_${prospect.prospect_id || prospect.id || Date.now()}`;
    await progress(runId, "built", {
      status: "started",
      prospectId: prospect.prospect_id || prospect.id || null,
      source: body.source || "admin_build_preview",
    });
    const result = await buildPreviewForProspect(prospect, {
      runId,
      source: body.source || "admin_build_preview",
      // Opt-out of the paid Veo hero for this build (free Ken-Burns photo hero).
      skipAmbiance: body.skipAmbiance === true || body.heroMode === "ken-burns",
      // Discard the persisted build_dispatch and dispatch a genuinely new build.
      //
      // Without this there is NO way for an operator to force a rebuild. A
      // prospect whose stored dispatch is a COMPLETED job resumes it, so
      // SiteForge hands back the existing artifacts and the route answers
      // {ok:true, pending:false, status:"previewed"} in milliseconds — which
      // reads exactly like a successful rebuild while nothing was rebuilt.
      //
      // That is not hypothetical: after fixing donor identity leaks in the
      // roofing template, five prospects were "rebuilt" twice and the live pages
      // never changed. buildPreviewForProspect already honours freshDispatch;
      // this route simply never forwarded it.
      freshDispatch: body.freshDispatch === true || body.forceFreshDispatch === true,
    });
    await progress(runId, "built", {
      status: result.ok ? "ok" : "blocked",
      prospectId: result.prospect_id,
      businessName: result.business_name,
      ready: result.ok,
      renderer: result.renderer,
      qcPassed: result.qc_passed,
      blocked: result.blocked,
    });
    sendJson(res, 200, result);
  } catch (error) {
    handleError(res, error);
  }
}

handler.resolveProspect = resolveProspect;
module.exports = handler;
