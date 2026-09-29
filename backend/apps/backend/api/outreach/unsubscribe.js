"use strict";

const { handleError, methodGuard, publicRequestUrl, readJson, readRawBody, sendJson } = require("../../lib/http");
const { upsertRow, recordEvent } = require("../../lib/store");
const { verifyUnsubscribeToken } = require("../../lib/unsubscribe");

function html(message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title><style>body{margin:0;background:#0b1018;color:#f5f7fb;font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;display:grid;min-height:100vh;place-items:center}.card{width:min(560px,calc(100vw - 32px));border:1px solid rgba(255,255,255,.16);border-radius:24px;background:linear-gradient(145deg,rgba(255,255,255,.11),rgba(255,255,255,.04));padding:32px;box-shadow:0 24px 80px rgba(0,0,0,.42)}h1{margin:0 0 10px;font-size:32px}.muted{color:#aab4c5}</style></head><body><main class="card"><h1>You're unsubscribed.</h1><p>${message}</p><p class="muted">Woodward Software Systems</p></main></body></html>`;
}

function normalize(input = {}) {
  return {
    token: input.t || input.token || "",
    email: String(input.email || "").trim().toLowerCase(),
    prospectId: String(input.prospectId || input.prospect_id || "").trim(),
    oneClick: String(input["List-Unsubscribe"] || "").trim() === "One-Click",
  };
}

function requestHeader(req, name) {
  const target = String(name).toLowerCase();
  const entry = Object.entries(req.headers || {}).find(([key]) => key.toLowerCase() === target);
  return entry ? String(entry[1] || "") : "";
}

async function parsePostBody(req, queryToken = "") {
  const contentType = requestHeader(req, "content-type").toLowerCase();
  const hasBody = req.body !== undefined || Number(requestHeader(req, "content-length")) > 0 || Boolean(requestHeader(req, "transfer-encoding"));
  if (queryToken && !hasBody) return {};
  if (contentType.includes("application/x-www-form-urlencoded")) {
    if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
    const raw = await readRawBody(req);
    return Object.fromEntries(new URLSearchParams(raw).entries());
  }
  return readJson(req);
}

async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "POST"])) return;
  try {
    const url = new URL(publicRequestUrl(req));
    const queryToken = url.searchParams.get("t") || url.searchParams.get("token") || "";
    const body = req.method === "POST" ? await parsePostBody(req, queryToken) : {};
    const input = normalize({
      ...Object.fromEntries(url.searchParams.entries()),
      ...body,
      ...(queryToken ? { t: queryToken } : {}),
    });

    const verified = input.token ? verifyUnsubscribeToken(input.token) : { ok: false };
    const email = verified.ok ? verified.data.email : input.email;
    const prospectId = verified.ok ? verified.data.prospectId : input.prospectId;

    if (!email && !prospectId) {
      sendJson(res, 400, {
        ok: false,
        error: "missing_unsubscribe_identity",
        message: "Use the unsubscribe link from the email, or POST an email/prospectId.",
      });
      return;
    }

    const key = prospectId || email;
    const suppression = await upsertRow(
      "ghost_agency_suppressions",
      {
        suppression_key: key,
        email: email || null,
        prospect_id: prospectId || null,
        reason: "unsubscribe",
        source: verified.ok ? "signed_link" : "direct_request",
        payload: { verified: verified.ok, oneClick: input.oneClick },
        updated_at: new Date().toISOString(),
      },
      "suppression_key",
    );

    await recordEvent("outreach.revoked", {
      email: email ? `${email.slice(0, 3)}***` : null,
      prospectId,
      source: verified.ok ? "signed_link" : "direct_request",
      oneClick: input.oneClick,
      suppressionMode: suppression.mode,
    });

    if (req.method === "POST" && queryToken) {
      res.statusCode = 200;
      res.setHeader("Cache-Control", "no-store");
      res.end("");
      return;
    }

    if (req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(html("We will stop sending outreach emails for this preview/report thread."));
      return;
    }

    sendJson(res, 200, {
      ok: true,
      unsubscribed: true,
      suppression,
    });
  } catch (error) {
    handleError(res, error);
  }
}

module.exports = handler;
module.exports.parsePostBody = parsePostBody;
