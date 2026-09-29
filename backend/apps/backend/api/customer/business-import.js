"use strict";

const { hashObject } = require("../../lib/http");
const { callIntakeGenie, answerCrewProfileFromCanonical } = require("../../lib/intake-genie-client");
const { listAgents, methodGuard, readJson, sendJson } = require("../../lib/mission-control-customer");

function foundCounts(packet = {}) {
  return {
    services: packet?.facts?.services?.length || 0,
    photos: packet?.assets?.filter((asset) => asset?.kind === "photo").length || 0,
    sources: packet?.evidence?.length || 0,
  };
}

module.exports = async function handler(req, res) {
  const methods = ["POST", "OPTIONS"];
  if (!methodGuard(req, res, methods)) return;
  try {
    const body = await readJson(req);
    const { context } = await listAgents(req);
    const source = String(body.source_url || body.website_url || body.gbp_url || "").trim();
    const notes = String(body.notes || body.description || "").trim().slice(0, 6000);
    if (!source && notes.length < 12) {
      sendJson(req, res, 400, { ok: false, error: "source_required", message: "Paste a website or Google profile, or tell us about the business." }, methods);
      return;
    }
    const isGoogle = /(?:google\.[^/]+\/maps|maps\.app\.goo\.gl|g\.page)\//i.test(source);
    const prospect = {
      prospect_id: `answercrew-${context.account.id}`,
      business_name: body.business_name,
      city: body.city,
      state: body.state,
      industry: body.trade || body.category,
      current_website: isGoogle ? "" : source,
      gbp_url: isGoogle ? source : String(body.gbp_url || "").trim(),
      description: notes,
    };
    const result = await callIntakeGenie(prospect, {
      buildPreview: false,
      dryRun: true,
      idempotencyKey: `answercrew:${context.account.id}:${hashObject(prospect)}`,
    });
    if (result.ok && result.packet?.status === "needs_input") {
      sendJson(req, res, 200, {
        ok: true,
        partial: true,
        profile: answerCrewProfileFromCanonical(result.packet),
        found: foundCounts(result.packet),
        missing: result.packet?.missing_fact ? [result.packet.missing_fact] : [],
        question: result.packet?.question || "Please add the missing business detail below.",
      }, methods);
      return;
    }
    if (!result.ok || ["blocked", "needs_input", "out_of_scope"].includes(result.packet?.status)) {
      const missing = result.packet?.missing_facts || (result.packet?.missing_fact ? [result.packet.missing_fact] : []);
      sendJson(req, res, result.status === "not_configured" ? 503 : 422, {
        ok: false,
        error: "business_import_failed",
        message: result.packet?.question || result.packet?.error || result.packet?.scope?.message || result.error || "We could not organize those business details yet.",
        missing,
        details: {
          status: result.packet?.status || String(result.status || "failed"),
          scope_category: result.packet?.scope?.category || "",
        },
      }, methods);
      return;
    }
    sendJson(req, res, 200, {
      ok: true,
      profile: answerCrewProfileFromCanonical(result.packet),
      found: foundCounts(result.packet),
    }, methods);
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, {
      ok: false,
      error: error.code || "internal_error",
      message: error.message || "Business import failed.",
    }, methods);
  }
};
