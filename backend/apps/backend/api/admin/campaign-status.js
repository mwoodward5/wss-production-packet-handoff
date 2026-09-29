"use strict";

// Standalone campaign status page for operators: /campaign-status.
//
// ONE route, two GET flavors (negotiated, so the browser page and its poller
// never need a second endpoint):
//   · browser navigation        -> the public HTML shell (no sensitive data;
//     the admin token is entered in-browser and sent as an x-admin-token
//     header when the page polls — the gallery's gate pattern)
//   · ?format=json or an
//     Accept: application/json   -> the admin-gated JSON snapshot built by
//     lib/campaign-status-data.js (newest non-halted batch, counts, the #628
//     campaign stopwatch strip, the #629 bank draw vs mined split, and
//     per-stage mine_funnel elapsedMs)

const { methodGuard } = require("../../lib/http");
const PAGE = require("../../lib/campaign-status-page");
const { createCampaignStatusDataHandler } = require("../../lib/campaign-status-data");

// A navigating browser sends "text/html,application/xhtml+xml,...,*/*;q=0.8" —
// never the literal application/json token — while fetch() callers state their
// Accept explicitly. The query flag wins either way, so curl and the page's
// own poller (?format=json) are deterministic.
function wantsJson(req) {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.searchParams.get("format") === "json") return true;
  } catch {
    /* fall through to the header check */
  }
  return /application\/json/i.test(String(req.headers && req.headers.accept || ""));
}

function createCampaignStatusRoute(overrides = {}) {
  const dataHandler = createCampaignStatusDataHandler(overrides.data || overrides);
  return async function handler(req, res) {
    if (!methodGuard(req, res, ["GET"])) return;
    if (wantsJson(req)) {
      await dataHandler(req, res);
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.statusCode = 200;
    res.end(PAGE);
  };
}

module.exports = createCampaignStatusRoute();
module.exports.createCampaignStatusRoute = createCampaignStatusRoute;
module.exports.wantsJson = wantsJson;
