"use strict";

// Max-momentum trigger: a prospect is LOOKING at their report right now.
// Record the view, and queue an agent outreach draft while they're warm.
// Dedupe: at most one hot-view draft per prospect per 24h.

const { recordEvent, select, selectRows } = require("./store");
const { draftReply } = require("./reply-agent");

const DAY = 86400e3;

async function recentHotDraft(prospectId) {
  try {
    const events = await selectRows("ghost_agency_events", {
      select: "type,payload,created_at",
      order: "created_at.desc",
      limit: 120,
    });
    const rows = Array.isArray(events && events.rows) ? events.rows : [];
    return rows.some(
      (r) =>
        ["reply.draft", "reply.sent"].includes(r.type) &&
        r.payload && r.payload.trigger === "report_viewed" &&
        r.payload.prospectId === prospectId &&
        Date.now() - new Date(r.created_at).getTime() < DAY,
    );
  } catch { return false; }
}

async function onReportViewed({ prospectId, source = "api_report" }) {
  await recordEvent("report.viewed", { prospectId, source, at: new Date().toISOString() });
  if (!prospectId || prospectId.startsWith("owner-") || prospectId.startsWith("proof-")) return { ok: true, skipped: "internal" };

  const found = await select(
    "ghost_agency_prospects",
    `?select=*&prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`,
  );
  const row = found.ok && Array.isArray(found.data) && found.data[0] ? found.data[0] : null;
  if (!row) return { ok: true, skipped: "unknown_prospect" };
  if (["do_not_contact", "unsubscribed", "closed_lost"].includes(String(row.status || ""))) {
    return { ok: true, skipped: "suppressed_status" };
  }
  const email = row.email || row.owner_email;
  if (!email) return { ok: true, skipped: "no_email" };
  if (await recentHotDraft(prospectId)) return { ok: true, skipped: "already_drafted_24h" };

  const prospect = { ...(row.record || {}), ...row };
  const inbound =
    "SYSTEM SIGNAL: this prospect just opened their visibility report and is reading it right now. " +
    "Write a short, warm, zero-pressure note: you noticed they're taking a look, offer to walk them " +
    "through anything on it or apply any change to their preview site — one question max.";
  const { draft } = await draftReply({ prospect, inboundText: inbound });
  const subject = `Re: your ${row.business_name || "business"} visibility report`;
  const draftId = `hot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await recordEvent("reply.draft", {
    draftId, prospectId, fromEmail: email, subject,
    intent: "report_viewed", trigger: "report_viewed", mode: draft.mode, body: draft.text,
    // A page view is not consent to receive another email. Keep this as an
    // owner-review artifact even if the retired reply-autopilot env is set.
    approval: "pending",
  });

  return { ok: true, action: "draft_queued", draftId };
}

module.exports = { onReportViewed };
