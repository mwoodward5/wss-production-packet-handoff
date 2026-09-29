"use strict";

const { requireCron } = require("../../lib/cron-auth");
const { methodGuard, sendJson } = require("../../lib/http");
const { sendResendEmail } = require("../../lib/email");
const { event, select } = require("../../lib/store");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "POST"])) return;
  if (!requireCron(req, res)) return;

  const orders = await select(
    "ghost_agency_orders",
    "?select=job_id,customer_email,payload,status,updated_at&status=in.(paid_checkout_completed,active,delivered)&limit=100",
  );
  if (!orders.ok) {
    sendJson(res, 200, {
      ok: false,
      mode: "schema_blocked",
      job: "retention-monthly",
      blocker: "ghost_agency_orders table/query is not available.",
      transport: orders.skipped || orders.status || orders.mode,
    });
    return;
  }

  const since = new Date(Date.now() - 31 * 86400e3).toISOString();
  const events = await select(
    "ghost_agency_events",
    `?select=type,payload,created_at&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=500`,
  );
  const eventRows = events.ok && Array.isArray(events.data) ? events.data : [];
  const sent = [];

  for (const order of orders.data || []) {
    if (!order.customer_email) {
      sent.push({ job_id: order.job_id, skipped: "no_customer_email" });
      continue;
    }

    const matchingEvents = eventRows.filter((row) => row.payload?.jobId === order.job_id);
    const edits = matchingEvents.filter((row) => row.type === "support.edit_shipped").length;
    const tickets = matchingEvents.filter((row) => row.type === "support.ticket_opened").length;
    const siteUrl =
      order.payload?.delivery?.site_url ||
      order.payload?.job?.packets?.site?.deepLinks?.woodwardLabs ||
      "your managed website";

    const send = await sendResendEmail({
      to: order.customer_email,
      subject: "Your monthly website summary",
      text:
        "Your monthly website summary\n\n" +
        `Site: ${siteUrl}\n` +
        `Edits shipped this month: ${edits}\n` +
        (tickets ? `Requests handled: ${tickets}\n` : "") +
        "\nNothing needed from you. Want a change? Reply to this email and it opens a request automatically.\n\n" +
        "Woodward Software Systems",
      html:
        `<p>Your monthly website summary</p><p><strong>Site:</strong> ${siteUrl}</p>` +
        `<p><strong>Edits shipped this month:</strong> ${edits}</p>` +
        (tickets ? `<p><strong>Requests handled:</strong> ${tickets}</p>` : "") +
        "<p>Nothing needed from you. Want a change? Reply to this email and it opens a request automatically.</p>",
    });

    await event({
      type: "retention.report_sent",
      actor: "agent_11_retention",
      status: send.mode === "send_failed" ? "failed" : "ok",
      payload: { jobId: order.job_id, edits, tickets, sendMode: send.mode },
    });
    sent.push({ job_id: order.job_id, sent: send.mode === "sent", mode: send.mode });
  }

  await event({
    type: "cron.run",
    actor: "agent_11_retention",
    status: "ok",
    payload: { job: "retention-monthly", orders: sent.length },
  });

  sendJson(res, 200, {
    ok: true,
    orders: sent.length,
    sent,
  });
};
