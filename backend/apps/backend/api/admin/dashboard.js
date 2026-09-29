"use strict";

const { adminAllowed } = require("../../lib/admin-auth");
const { renderOperatorDashboard, renderTokenGate } = require("../../lib/dashboard-html");
const { methodGuard } = require("../../lib/http");
const { SYSTEMS } = require("../../lib/registry");
const { selectRows } = require("../../lib/store");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET"])) return;
  const auth = adminAllowed(req);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!auth.allowed) {
    res.statusCode = 401;
    res.end(renderTokenGate());
    return;
  }

  const [events, tickets] = await Promise.all([
    selectRows("ghost_agency_events", { order: "created_at.desc", limit: 40 }),
    selectRows("ghost_agency_support_tickets", { order: "updated_at.desc", limit: 12 }),
  ]);
  const eventRows = Array.isArray(events.rows) ? events.rows : [];
  const callRows = eventRows
    .filter((row) => row.type === "outreach.call_completed")
    .map((row) => ({ ...(row.payload && typeof row.payload === "object" ? row.payload : {}), created_at: row.created_at }));
  const products = Object.entries(SYSTEMS).map(([key, value]) => ({ key, ...value }));

  res.statusCode = 200;
  res.end(renderOperatorDashboard({
    events: eventRows,
    calls: callRows,
    tickets: Array.isArray(tickets.rows) ? tickets.rows : [],
    products,
  }));
};
