"use strict";

const { requireCron } = require("../../lib/cron-auth");
const { methodGuard, sendJson } = require("../../lib/http");
const { packetProspectForConsent } = require("../../lib/full-run");
const { recordedPositivePreviewConsent } = require("../../lib/preview-consent");
const { prospectFromRow } = require("../../lib/prospects");
const { event, select, conditionalUpdate } = require("../../lib/store");

function loadStages() {
  try {
    return require("../../lib/agents/stages");
  } catch (error) {
    return null;
  }
}

async function processNightlyProspect(prospect, {
  stages = null,
  threshold = 80,
  packetProspect = packetProspectForConsent,
  selectProspects = select,
  updateProspect = conditionalUpdate,
} = {}) {
  const score = Number(prospect.leadminer_score || prospect.score || 0);
  const consent = recordedPositivePreviewConsent(prospect);
  const item = {
    prospect_id: prospect.prospect_id || prospect.id || prospect.businessName || prospect.name || "unknown",
    score,
    consent: consent.ok ? "recorded_positive_consent" : "not_recorded",
    siteforge_dispatched: false,
    autosend_created: false,
  };

  const durableHold = prospect.record?.consent_packet_hold;
  if (durableHold?.schema === "wss.consent_packet_hold.v1") {
    item.enrich = "durable_packet_hold_reused";
    item.report = "durable_packet_hold_reused";
    item.packet = false;
    item.status = "held";
    item.blocked = durableHold.reason || "intake_genie_blocked";
    item.persistence = "parked";
  } else if (stages) {
    const ctx = { prospect };
    item.enrich = (await stages.enrich(ctx)).ok;
    item.report = (await stages.report(ctx)).ok;
    const packet = await stages.packetStage(ctx);
    item.packet = packet.ok;
  } else {
    item.enrich = "adapter_missing";
    const packet = await packetProspect(prospect, {
      source: "nightly_pipeline_consent_first",
      requireCanonicalGuard: true,
      parkOnFailure: true,
      select: selectProspects,
      conditionalUpdate: updateProspect,
    });
    item.report = packet.ok ? "packet_ready" : "held_until_intake_genie";
    item.packet = packet.ok ? packet.packets?.site?.id || true : false;
    item.status = packet.status || "held";
    item.blocked = packet.blocked || undefined;
    item.persistence = packet.persistence;
  }

  if (score < threshold) {
    item.prebuild = "below_threshold_or_unscored";
  } else if (!consent.ok) {
    item.prebuild = "blocked_until_recorded_positive_consent";
  } else {
    item.prebuild = "explicit_post_reply_build_required";
  }
  return item;
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "POST"])) return;
  if (!requireCron(req, res)) return;

  const batch = Math.min(parseInt(process.env.GHOST_AGENCY_NIGHTLY_BATCH || "10", 10) || 10, 50);
  const threshold = parseFloat(process.env.GHOST_AGENCY_PREBUILD_SCORE_MIN || "80");
  const stages = loadStages();

  const rowsResult = await select(
    "ghost_agency_prospects",
    `?select=*&status=eq.new&order=updated_at.asc.nullsfirst&limit=${batch}`,
  );

  if (!rowsResult.ok) {
    await event({
      type: "cron.run",
      actor: "agent_00_orchestrator",
      status: "failed",
      payload: {
        job: "nightly-pipeline",
        blocked: "ghost_agency_prospects_unavailable",
        transport: rowsResult.skipped || rowsResult.status || rowsResult.mode,
      },
    });
    sendJson(res, 200, {
      ok: false,
      mode: "schema_blocked",
      job: "nightly-pipeline",
      blocker: "ghost_agency_prospects table/query is not available in the current Supabase schema.",
      transport: rowsResult.skipped || rowsResult.status || rowsResult.mode,
    });
    return;
  }

  const results = [];
  for (const row of rowsResult.data || []) {
    const prospect = prospectFromRow(row);
    if (!prospect) continue;

    try {
      results.push(await processNightlyProspect(prospect, { stages, threshold }));
    } catch (error) {
      results.push({
        prospect_id: prospect.prospect_id || prospect.id || "unknown",
        error: error.message || String(error),
        siteforge_dispatched: false,
        autosend_created: false,
      });
    }
  }

  await event({
    type: "cron.run",
    actor: "agent_00_orchestrator",
    status: "ok",
    payload: {
      job: "nightly-pipeline",
      processed: results.length,
      batch,
      threshold,
      stageRuntimePresent: Boolean(stages),
    },
  });

  sendJson(res, 200, {
    ok: true,
    processed: results.length,
    stageRuntimePresent: Boolean(stages),
    results,
  });
};

module.exports.processNightlyProspect = processNightlyProspect;
