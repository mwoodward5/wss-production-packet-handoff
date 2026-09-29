"use strict";

// Copilot command endpoint - turns a natural-language operator prompt into
// either an answer (read-only stats) or a structured action the console runs
// through the existing guardrails. Side-effectful actions (live send) are never
// executed here; they are returned as an action for the UI to confirm + run.

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { fallbackReply, parseDeterministic, promptPreview, runLlm, snapshot } = require("../../lib/copilot");
const { recordEvent } = require("../../lib/store");

async function safeRecord(type, payload) {
  try {
    await recordEvent(type, payload);
  } catch (_) {
    // Telemetry should never block the cockpit command path.
  }
}

function enforceMineConfirmation(result, confirmed) {
  if (!result || result.action !== "mine") return result;
  const proposedAction = { action: "mine", params: { ...(result.params || {}) } };
  if (confirmed === true) {
    return {
      ...result,
      needsConfirm: false,
      confirmed: true,
      confirmationRequired: false,
      confirmationAccepted: true,
      proposedAction,
    };
  }
  return {
    ...result,
    action: "none",
    params: {},
    needsConfirm: true,
    confirmed: false,
    confirmationRequired: true,
    confirmationAccepted: false,
    proposedAction,
  };
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    const started = Date.now();
    const body = await readJson(req).catch(() => ({}));
    const prompt = String(body.prompt || "").trim();
    if (!prompt) { sendJson(res, 400, { ok: false, error: "empty_prompt" }); return; }

    await safeRecord("copilot.command_requested", {
      actor: "agent_00_orchestrator",
      prompt: promptPreview(prompt),
    });

    let stats = null;
    let result = parseDeterministic(prompt);
    if (result && result.needsSnapshot) {
      stats = await snapshot();
      result = parseDeterministic(prompt, stats);
    }

    if (!result) {
      stats = stats || await snapshot();
      result = await runLlm(prompt, stats).catch((error) => ({
        ok: false,
        provider: "llm",
        error: error.message || String(error),
      }));
      if (!result.ok) {
        const fallback = fallbackReply();
        result = {
          ...fallback,
          llmError: result.error || result.status || "llm_unavailable",
        };
      }
    }

    const parsedResult = result;
    result = enforceMineConfirmation(parsedResult, body.confirmed === true);

    await safeRecord("copilot.command_result", {
      actor: "agent_00_orchestrator",
      prompt: promptPreview(prompt),
      provider: result.provider || "unknown",
      action: result.action || "none",
      params: result.params || {},
      durationMs: Date.now() - started,
      ok: result.ok !== false,
    });

    const mineRequested = /\b(mine|harvest|find (?:new )?leads?|scrape|prospect)\b/i.test(prompt);
    if (mineRequested) {
      const plan = result.proposedAction || { action: parsedResult.action, params: parsedResult.params || {} };
      const params = plan.params || {};
      const auditType = parsedResult.ok === false ? "mine.run" : (result.confirmationRequired ? "copilot.mine_plan" : "copilot.mine_confirmed");
      await safeRecord(auditType, {
        actor: "agent_00_orchestrator",
        originalCommand: promptPreview(prompt),
        parsedIntent: plan,
        finalQuery: params.industry && params.location ? `${params.industry} in ${params.location}` : null,
        status: parsedResult.ok === false ? "refused" : (result.confirmed ? "confirmed" : "confirmation_required"),
        result: parsedResult.ok === false ? "nothing_run" : (result.confirmed ? "awaiting_miner_result" : "confirmation_required"),
        provider: parsedResult.provider || "unknown",
        durationMs: Date.now() - started,
      });
    }

    sendJson(res, 200, result);
  } catch (error) {
    handleError(res, error);
  }
};

module.exports.enforceMineConfirmation = enforceMineConfirmation;
