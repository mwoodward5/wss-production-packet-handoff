"use strict";

const { requireAdmin } = require("../../lib/admin-auth");
const { sendSequenceStep } = require("../../lib/email");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { select } = require("../../lib/store");

async function durableProspectForSend(prospect = {}, read = select) {
  const id = String(prospect.prospect_id || prospect.id || prospect.record?.prospect_id || "").trim();
  if (!id) return { ok: false, blocked: "durable_prospect_id_required" };
  const loaded = await read(
    "ghost_agency_prospects",
    `?select=*&prospect_id=eq.${encodeURIComponent(id)}&limit=1`,
  ).catch(() => null);
  const durable = loaded?.ok === true && Array.isArray(loaded.data) && loaded.data.length === 1
    ? loaded.data[0]
    : null;
  if (!durable) return { ok: false, blocked: "prospect_store_read_failed" };
  const durableId = String(durable.prospect_id || durable.id || "").trim();
  if (!durableId || durableId !== id) return { ok: false, blocked: "prospect_identity_mismatch" };
  const status = String(durable.status || durable.record?.status || "").trim().toLowerCase();
  if (["line_gate_passed", "line_queued"].includes(status)) {
    return { ok: false, blocked: "line_batch_approval_required" };
  }
  return {
    ok: true,
    prospect: {
      ...durable,
      prospect_id: durableId,
      status,
      record: {
        ...(durable.record && typeof durable.record === "object" ? durable.record : {}),
        status,
      },
    },
  };
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    const body = await readJson(req);
    const durable = await durableProspectForSend(body.prospect || body);
    if (!durable.ok) {
      sendJson(res, 409, { ok: false, error: durable.blocked });
      return;
    }
    const result = await sendSequenceStep({
      prospect: durable.prospect,
      sequence: Number(body.sequence || 1),
      step: Number(body.step || 1),
      vars: body.vars || {},
    });
    sendJson(res, result.ok ? 200 : 409, { ok: result.ok, result });
  } catch (error) {
    handleError(res, error);
  }
};

module.exports.durableProspectForSend = durableProspectForSend;
