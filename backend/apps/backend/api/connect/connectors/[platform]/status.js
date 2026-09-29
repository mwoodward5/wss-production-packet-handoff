"use strict";

const { resolveConnectScope } = require("../../../../lib/connect");
const { calendarCors, resolveScopedSiteSlug, sendJson } = require("../../../../lib/connect-calendar-oauth");
const { readConnector, resolveLegacyConnector, statusPayload } = require("../../../../lib/connect-legacy-connectors");

module.exports = async function handler(req, res) {
  if (calendarCors(req, res, ["GET"])) return;
  if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });

  const resolved = resolveScopedSiteSlug(
    resolveConnectScope(req),
    req,
    { slug: req.query?.slug || req.query?.site },
  );
  if (!resolved.ok) return sendJson(res, resolved.status, { ok: false, error: resolved.error });

  const connector = resolveLegacyConnector(req.query?.platform);
  if (!connector) {
    return sendJson(res, 501, {
      ok: false,
      error: "connector_not_implemented",
      platform: String(req.query?.platform || "").trim().toLowerCase(),
    });
  }

  try {
    const row = await readConnector(resolved.siteSlug, connector);
    return sendJson(res, 200, statusPayload({ connector, siteSlug: resolved.siteSlug, row }));
  } catch (error) {
    return sendJson(res, error.status || 502, { ok: false, error: error.code || "connector_status_failed" });
  }
};
