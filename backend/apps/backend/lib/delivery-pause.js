"use strict";

const { recordEvent, select } = require("./store");

const EVENT_TYPE = "outreach.delivery_pause";

function deliveryPauseFromRows(rows = []) {
  const latest = rows.find((row) => row && row.type === EVENT_TYPE);
  if (!latest) return { active: false, known: false, reason: "" };
  const payload = latest.payload && typeof latest.payload === "object" ? latest.payload : {};
  return {
    active: payload.active === true,
    known: true,
    reason: String(payload.reason || ""),
    runId: payload.runId || null,
    at: latest.created_at || payload.at || null,
    stats: payload.stats || null,
  };
}

async function deliveryPauseStatus() {
  const result = await select(
    "ghost_agency_events",
    `?select=type,payload,created_at&type=eq.${encodeURIComponent(EVENT_TYPE)}&order=created_at.desc&limit=1`,
  );
  if (!result.ok) {
    return { active: true, known: false, reason: "delivery_pause_status_unavailable" };
  }
  return deliveryPauseFromRows(result.data || []);
}

async function setDeliveryPause({ active, reason = "", runId = null, stats = null, actor = "system" } = {}) {
  return recordEvent(EVENT_TYPE, {
    active: active === true,
    reason: String(reason || ""),
    runId,
    stats,
    actor,
    at: new Date().toISOString(),
  });
}

module.exports = {
  EVENT_TYPE,
  deliveryPauseFromRows,
  deliveryPauseStatus,
  setDeliveryPause,
};
