"use strict";

const crypto = require("node:crypto");
const { adminAllowed } = require("../../lib/admin-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { recordEvent, select, selectRows, upsertRow } = require("../../lib/store");
const { validateRequired } = require("../../lib/validation");

function ticketKind(value) {
  const allowed = new Set([
    "content_edit",
    "photo_swap",
    "new_page",
    "hours_change",
    "contact_change",
    "seo_request",
    "bug",
    "domain_dns",
    "billing_question",
    "cancellation_request",
    "other",
  ]);
  return allowed.has(value) ? value : "other";
}

async function orderExists(input = {}) {
  const terms = [];
  if (input.order_id) terms.push(`job_id.eq.${encodeURIComponent(input.order_id)}`);
  if (input.job_id && input.job_id !== input.order_id) terms.push(`job_id.eq.${encodeURIComponent(input.job_id)}`);
  if (input.stripe_session_id) terms.push(`stripe_session_id.eq.${encodeURIComponent(input.stripe_session_id)}`);
  if (input.customer_email) terms.push(`customer_email.eq.${encodeURIComponent(input.customer_email)}`);
  if (!terms.length) return { ok: false, reason: "missing_order_reference" };
  const result = await select("ghost_agency_orders", `?select=job_id,customer_email,status&or=(${terms.join(",")})&limit=1`);
  if (!result.ok) return { ok: false, reason: "order_lookup_failed", detail: result.status || result.mode };
  return { ok: (result.data || []).length > 0, row: result.data?.[0] };
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "POST"])) return;
  try {
    if (req.method === "GET") {
      const auth = adminAllowed(req);
      if (!auth.allowed) {
        sendJson(res, 401, { ok: false, error: "unauthorized" });
        return;
      }
      const tickets = await selectRows("ghost_agency_support_tickets", {
        order: "updated_at.desc",
        limit: 25,
      });
      sendJson(res, 200, { ok: true, tickets });
      return;
    }

    const body = await readJson(req);
    const now = new Date().toISOString();
    const ticket = {
      ticket_id: body.ticket_id || `ticket_${crypto.randomUUID()}`,
      order_id: body.order_id || body.job_id || body.stripe_session_id || "",
      kind: ticketKind(body.kind),
      request_text: String(body.request_text || body.message || body.notes || "").trim(),
      state: "open",
      created_at: now,
    };

    const validation = validateRequired("support-ticket", ticket);
    if (!validation.ok) {
      sendJson(res, 400, { ok: false, error: "invalid_support_ticket", validation });
      return;
    }

    const order = await orderExists({
      ...body,
      order_id: ticket.order_id,
    });
    if (!order.ok) {
      sendJson(res, 403, {
        ok: false,
        error: "paid_order_required",
        message: "Support/edit requests require an existing paid order reference.",
        reason: order.reason,
      });
      return;
    }

    const row = await upsertRow(
      "ghost_agency_support_tickets",
      {
        ticket_id: ticket.ticket_id,
        order_id: ticket.order_id,
        kind: ticket.kind,
        request_text: ticket.request_text,
        state: ticket.state,
        customer_email: body.customer_email || order.row?.customer_email || null,
        payload: {
          ...ticket,
          source: body.source || "support_form",
        },
        updated_at: now,
      },
      "ticket_id",
    );

    await recordEvent("support.ticket_opened", {
      ticketId: ticket.ticket_id,
      orderId: ticket.order_id,
      kind: ticket.kind,
      state: ticket.state,
    });

    sendJson(res, 200, { ok: true, ticket, persistence: row });
  } catch (error) {
    handleError(res, error);
  }
};
