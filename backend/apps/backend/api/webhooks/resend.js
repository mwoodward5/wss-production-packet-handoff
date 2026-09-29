"use strict";

const crypto = require("node:crypto");
const { handleError, methodGuard, sendJson } = require("../../lib/http");
const { insertRow, recordEvent, select, selectRows, upsertRow } = require("../../lib/store");
const { setDeliveryPause } = require("../../lib/delivery-pause");
const { emailIdFromLog } = require("../../lib/tracking-truth");
const { latestReplyText, processInboundReply } = require("./email-inbound");

function webhookSecret() {
  return (
    process.env.GHOST_AGENCY_RESEND_WEBHOOK_SECRET?.trim() ||
    process.env.RESEND_WEBHOOK_SECRET?.trim() ||
    ""
  );
}

function safeEqBuffer(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function svixSecretBytes(secret) {
  const cleaned = String(secret || "").replace(/^whsec_/, "");
  return Buffer.from(cleaned, "base64");
}

function verifySvixSignature(rawBody, headers = {}) {
  const secret = webhookSecret();
  if (!secret) return { ok: false, statusCode: 503, error: "resend_webhook_secret_missing" };
  const id = headers["svix-id"];
  const timestamp = headers["svix-timestamp"];
  const signature = headers["svix-signature"];
  if (!id || !timestamp || !signature) return { ok: false, statusCode: 400, error: "svix_headers_missing" };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, statusCode: 400, error: "svix_timestamp_invalid" };
  if (Math.abs(Date.now() / 1000 - ts) > 5 * 60) {
    return { ok: false, statusCode: 400, error: "svix_timestamp_stale" };
  }

  let expected;
  try {
    expected = crypto
      .createHmac("sha256", svixSecretBytes(secret))
      // Svix signs these exact request bytes. Never stringify parsed JSON here.
      .update(Buffer.concat([Buffer.from(`${id}.${timestamp}.`, "utf8"), rawBody]))
      .digest("base64");
  } catch (error) {
    return { ok: false, statusCode: 503, error: "resend_webhook_secret_invalid", detail: error.message };
  }

  const parts = String(signature)
    .split(" ")
    .flatMap((part) => part.split(","))
    .map((part) => part.trim())
    .filter(Boolean);
  const candidates = [];
  for (let i = 0; i < parts.length; i += 2) {
    if (parts[i] === "v1" && parts[i + 1]) candidates.push(parts[i + 1]);
  }
  if (!candidates.length) candidates.push(...parts.filter((part) => part !== "v1"));
  const ok = candidates.some((candidate) => safeEqBuffer(candidate, expected));
  return ok ? { ok: true } : { ok: false, statusCode: 400, error: "svix_signature_invalid" };
}

async function readResendRawBody(req) {
  // Vercel exposes req.body through a lazy getter. Touching it before the
  // request stream triggers JSON parsing and destroys the exact Svix-signed
  // bytes, so always consume the stream first when it is available.
  if (typeof req.on === "function") {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", (chunk) => {
        // A pre-decoded string means another middleware already changed the
        // byte boundary, so fail closed instead of reconstructing it.
        if (typeof chunk === "string") {
          const error = new Error("resend_webhook_raw_body_required");
          error.code = "resend_webhook_raw_body_required";
          error.statusCode = 400;
          reject(error);
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  // Unit-test and adapter fallback: a Buffer is the only body shape that
  // retains the signed bytes. Parsed objects remain a hard failure.
  if (Buffer.isBuffer(req.body)) return req.body;
  return null;
}

function persistenceFailure(kind, result) {
  const error = new Error(`resend_webhook_${kind}_persistence_failed`);
  error.code = "resend_webhook_persistence_failed";
  // Providers retry 5xx responses. No storage failure is safe to acknowledge.
  error.statusCode = 503;
  error.persistence = { kind, mode: result?.mode || "unknown", status: result?.status || 0 };
  return error;
}

function requireDurableWrite(kind, result) {
  const durable = result?.mode === "live_write" || result?.mode === "live_upsert";
  if (!durable) throw persistenceFailure(kind, result);
  return result;
}

async function hasProcessedSvixId(svixId) {
  const result = await select(
    "ghost_agency_events",
    `?select=id&svix_id=eq.${encodeURIComponent(svixId)}&limit=1`,
  );
  if (!result?.ok) throw persistenceFailure("deduplication_lookup", result);
  return Array.isArray(result.data) && result.data.length > 0;
}

function isSvixDuplicate(result) {
  // The only caller that sends a database-generated id is this event insert;
  // a 23505/409 here can therefore only be the partial svix_id uniqueness
  // guard added by the paired migration.
  return result?.mode === "live_write_failed"
    && (result.status === 409 || result.error?.code === "23505");
}

async function recordResendWebhookEvent(svixId, payload) {
  const result = await insertRow("ghost_agency_events", {
    type: "resend.webhook",
    svix_id: svixId,
    // Keep this copy for existing console/query consumers while new writes use
    // the indexed column as their durable, atomic dedupe key.
    payload: { ...payload, svix_id: svixId },
    created_at: new Date().toISOString(),
  });
  if (isSvixDuplicate(result)) return { duplicate: true, result };
  requireDurableWrite("event", result);
  return { duplicate: false, result };
}

function eventType(body = {}) {
  return String(body.type || body.event || "").trim();
}

function eventData(body = {}) {
  return body.data && typeof body.data === "object" ? body.data : {};
}

function htmlToReplyText(value = "") {
  return String(value || "")
    .replace(/<blockquote\b[\s\S]*$/i, "")
    .replace(/<div\b[^>]*class=["'][^"']*(?:gmail_quote|yahoo_quoted)[^"']*["'][^>]*>[\s\S]*$/i, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/(?:&#39;|&#x27;|&apos;)/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function retrieveReceivedEmail(emailId, fetchImpl = global.fetch) {
  const id = String(emailId || "").trim();
  const key = String(
    process.env.GHOST_AGENCY_RESEND_RECEIVING_API_KEY
    || process.env.RESEND_API_KEY
    || "",
  ).trim();
  if (!id) {
    const error = new Error("resend_received_email_id_missing");
    error.code = "resend_received_email_id_missing";
    error.statusCode = 400;
    throw error;
  }
  if (!key) {
    const error = new Error("resend_api_key_missing");
    error.code = "resend_api_key_missing";
    error.statusCode = 503;
    throw error;
  }

  let response;
  try {
    response = await fetchImpl(`https://api.resend.com/emails/receiving/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${key}`,
        accept: "application/json",
        "user-agent": "ghost-agency/consent-first-replies",
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (cause) {
    const error = new Error("resend_received_email_fetch_failed");
    error.code = "resend_received_email_fetch_failed";
    error.statusCode = 503;
    error.cause = cause;
    throw error;
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("resend_received_email_fetch_failed");
    error.code = "resend_received_email_fetch_failed";
    error.statusCode = 503;
    error.providerStatus = response.status;
    throw error;
  }
  const email = json?.data && typeof json.data === "object" ? json.data : json;
  const text = latestReplyText(email.text || htmlToReplyText(email.html || ""));
  return {
    id,
    from: email.from || "",
    subject: email.subject || "",
    text,
  };
}

function emailsFromData(data = {}) {
  const values = []
    .concat(data.to || [])
    .concat(data.email || [])
    .concat(data.recipient || [])
    .filter(Boolean);
  return values
    .map((value) => String(value).trim().toLowerCase())
    .filter((value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value));
}

function maskedEmail(email = "") {
  return email ? `${email.slice(0, 3)}***` : "";
}

function classify(type) {
  if (type === "email.bounced") return { reason: "hard_bounce", suppress: true, metric: "bounce" };
  if (type === "email.complained") return { reason: "complaint", suppress: true, metric: "complaint" };
  return { reason: "", suppress: false, metric: "" };
}

async function findEmailLogForEmailId(emailId) {
  if (!emailId) return null;
  const logs = await selectRows("ghost_agency_email_log", { order: "sent_at.desc", limit: 1000 });
  for (const row of logs.rows || []) {
    if (emailIdFromLog(row) === emailId) return row;
  }
  return null;
}

async function deliveryStats(runId) {
  if (!runId) return null;
  const [logs, events] = await Promise.all([
    selectRows("ghost_agency_email_log", { order: "sent_at.desc", limit: 1000 }),
    selectRows("ghost_agency_events", { order: "created_at.desc", limit: 1000 }),
  ]);
  const sent = (logs.rows || []).filter((row) => {
    const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
    return row.mode === "sent" && payload.runId === runId;
  }).length;
  const webhooks = (events.rows || []).filter((row) => row.type === "resend.webhook" && row.payload?.runId === runId);
  const bounces = webhooks.filter((row) => row.payload?.metric === "bounce").length;
  const complaints = webhooks.filter((row) => row.payload?.metric === "complaint").length;
  return {
    runId,
    sent,
    bounces,
    complaints,
    bounceRate: sent ? bounces / sent : 0,
    complaintRate: sent ? complaints / sent : 0,
  };
}

async function maybePauseRun(stats) {
  if (!stats || !stats.sent) return null;
  const bounceThreshold = Number(process.env.GHOST_AGENCY_BOUNCE_PAUSE_RATE || "0.05");
  const complaintThreshold = Number(process.env.GHOST_AGENCY_COMPLAINT_PAUSE_RATE || "0.003");
  const reasons = [];
  if (stats.bounceRate > bounceThreshold) reasons.push("hard_bounce_rate");
  if (stats.complaintRate > complaintThreshold) reasons.push("complaint_rate");
  if (!reasons.length) return null;
  requireDurableWrite("pause_event", await recordEvent("system.run", {
    runId: stats.runId,
    stage: "paused",
    status: "paused",
    reason: reasons.join(","),
    sent: stats.sent,
    bounces: stats.bounces,
    complaints: stats.complaints,
    bounceRate: stats.bounceRate,
    complaintRate: stats.complaintRate,
    thresholds: {
      hardBounce: bounceThreshold,
      complaint: complaintThreshold,
    },
  }));
  requireDurableWrite("delivery_pause", await setDeliveryPause({
    active: true,
    reason: reasons.join(","),
    runId: stats.runId,
    stats,
    actor: "resend_webhook",
  }));
  return reasons;
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  try {
    const raw = await readResendRawBody(req);
    if (!raw) {
      sendJson(res, 400, { ok: false, error: "resend_webhook_raw_body_required" });
      return;
    }
    const verified = verifySvixSignature(raw, req.headers || {});
    if (!verified.ok) {
      sendJson(res, verified.statusCode || 400, {
        ok: false,
        error: verified.error,
        detail: verified.detail,
      });
      return;
    }

    let body;
    try {
      body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
    } catch (error) {
      sendJson(res, 400, { ok: false, error: "invalid_json" });
      return;
    }

    const type = eventType(body);
    const svixId = String(req.headers?.["svix-id"] || "");
    if (await hasProcessedSvixId(svixId)) {
      sendJson(res, 200, { ok: true, received: true, duplicate: true, svixId });
      return;
    }
    const data = eventData(body);
    const emailId = data.email_id || data.id || "";

    if (type === "email.received") {
      const received = await retrieveReceivedEmail(emailId);
      if (!received.text) {
        const event = await recordResendWebhookEvent(svixId, {
          type,
          email_id: emailId || null,
          inbound_action: "ignored_empty_body",
          inbound_sender: maskedEmail(received.from),
        });
        sendJson(res, 200, {
          ok: true,
          received: true,
          type,
          duplicate: event.duplicate,
          action: "ignored_empty_body",
        });
        return;
      }

      const inbound = await processInboundReply({
        from: received.from || data.from || "",
        text: received.text,
        subject: received.subject || data.subject || "",
        inboundId: emailId,
      });
      const event = await recordResendWebhookEvent(svixId, {
        type,
        email_id: emailId || null,
        inbound_action: inbound.action,
        inbound_intent: inbound.intent,
        prospectId: inbound.prospectId || null,
        sender: maskedEmail(received.from || data.from || ""),
      });
      sendJson(res, 200, {
        ...inbound,
        received: true,
        type,
        duplicate: event.duplicate,
      });
      return;
    }

    const emailLog = await findEmailLogForEmailId(emailId);
    const logPayload = emailLog?.payload && typeof emailLog.payload === "object" ? emailLog.payload : {};
    const runId = data.run_id || body.run_id || logPayload.runId || null;
    const prospectId = emailLog?.prospect_id || null;
    const verdict = classify(type);
    const emails = emailsFromData(data);
    const suppressions = [];

    if (verdict.suppress) {
      for (const email of emails) {
        const suppression = requireDurableWrite("suppression", await upsertRow(
          "ghost_agency_suppressions",
          {
            suppression_key: email,
            email,
            prospect_id: null,
            reason: verdict.reason,
            source: "resend_webhook",
            payload: {
              type,
              email_id: emailId || null,
              runId: runId || null,
            },
            updated_at: new Date().toISOString(),
          },
          "suppression_key",
        ));
        suppressions.push({ email: maskedEmail(email), mode: suppression.mode || suppression.status });
      }
    }

    const event = await recordResendWebhookEvent(svixId, {
      type,
      metric: verdict.metric || null,
      email_id: emailId || null,
      resendId: emailId || null,
      runId: runId || null,
      prospectId,
      recipients: emails.map(maskedEmail),
      suppressions,
    });
    if (event.duplicate) {
      sendJson(res, 200, { ok: true, received: true, duplicate: true, svixId });
      return;
    }

    const stats = await deliveryStats(runId);
    const paused = await maybePauseRun(stats);

    sendJson(res, 200, {
      ok: true,
      received: true,
      type,
      runId: runId || null,
      suppressions,
      stats,
      paused,
    });
  } catch (error) {
    handleError(res, error);
  }
};

// Required so Vercel leaves the request stream untouched for Svix verification.
module.exports.config = { api: { bodyParser: false } };
module.exports.htmlToReplyText = htmlToReplyText;
module.exports.retrieveReceivedEmail = retrieveReceivedEmail;
