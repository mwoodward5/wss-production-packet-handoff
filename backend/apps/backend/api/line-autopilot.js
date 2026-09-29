"use strict";

/**
 * Durable WSS Line rescue loop.
 *
 * The original Command Center advanced the active Line from the browser. The
 * redesigned dashboard still renders the durable rows, but a closed/reloaded
 * tab must never strand qualified prospects before website build. This route
 * reconnects the existing continuation endpoint to persisted active batches.
 *
 * It cannot create campaigns, choose recipients, or send outreach. It only
 * asks the already-existing Line continuation handler to advance rows that are
 * already present in Supabase. Existing claim, identity, QC, idempotency and
 * send gates remain authoritative.
 */

const FINAL_STATUSES = new Set([
  "ready",
  "sent",
  "completed",
  "finished",
  "terminal",
  "cancelled",
  "archived",
  "rejected",
  "failed_permanent",
]);

const ACTIONABLE_STATUSES = new Set([
  "qualified",
  "queued",
  "building",
  "retry",
  "retryable",
  "pending",
  "processing",
  "deployed",
  "qc_pending",
  "inspection",
]);

const CONTINUATION_PATHS = [
  "/api/line/continue",
  "/api/operator-line/continue",
  "/api/line/resume",
  "/api/operator-line/resume",
  "/api/console/line/continue",
  "/api/line/batches/continue",
];

let lastRunAt = 0;
let inFlight = null;

function firstEnv(names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

function supabaseConfig() {
  const url = firstEnv([
    "SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "VITE_SUPABASE_URL",
  ]).replace(/\/$/, "");
  const key = firstEnv([
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SERVICE_KEY",
    "SUPABASE_SECRET_KEY",
  ]);
  return { url, key };
}

function internalSecret() {
  return firstEnv([
    "GHOST_AGENCY_OWNER_TOKEN",
    "WSS_OWNER_TOKEN",
    "OWNER_TOKEN",
    "OPERATOR_TOKEN",
    "INTERNAL_API_TOKEN",
    "CRON_SECRET",
  ]);
}

function requestHeaders() {
  const secret = internalSecret();
  const headers = { "content-type": "application/json" };
  if (secret) {
    headers.authorization = `Bearer ${secret}`;
    headers["x-owner-token"] = secret;
    headers["x-operator-token"] = secret;
    headers["x-internal-token"] = secret;
  }
  return headers;
}

async function activeBatches() {
  const { url, key } = supabaseConfig();
  if (!url || !key) throw new Error("supabase_service_configuration_missing");

  const select = encodeURIComponent(
    "batch_id,status,updated_at,terminal_at,payload",
  );
  const endpoint =
    `${url}/rest/v1/ghost_agency_line_batch_rows` +
    `?select=${select}&terminal_at=is.null&order=updated_at.desc&limit=250`;

  const response = await fetch(endpoint, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  if (!response.ok) {
    throw new Error(`line_rows_lookup_failed:${response.status}`);
  }

  const rows = await response.json();
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const status = String(row.status || "").toLowerCase();
    if (FINAL_STATUSES.has(status)) continue;
    if (status && !ACTIONABLE_STATUSES.has(status)) continue;

    const batchId = String(row.batch_id || "").trim();
    if (!batchId) continue;

    const current = grouped.get(batchId) || {
      batchId,
      rows: 0,
      latest: "",
    };
    current.rows += 1;
    const updated = String(row.updated_at || "");
    if (updated > current.latest) current.latest = updated;
    grouped.set(batchId, current);
  }

  return [...grouped.values()]
    .sort((a, b) => b.latest.localeCompare(a.latest))
    .slice(0, 8);
}

function baseUrl(req) {
  const host = String(
    req.headers["x-forwarded-host"] || req.headers.host || "ghost.wss-ai.com",
  )
    .split(",")[0]
    .trim();
  const proto = String(req.headers["x-forwarded-proto"] || "https")
    .split(",")[0]
    .trim();
  return `${proto}://${host}`;
}

function validationFailure(text) {
  return /(missing|invalid).*(batch|id)|unauthorized|forbidden|method not allowed/i.test(
    String(text || ""),
  );
}

async function attemptContinuation(req, batchId) {
  const payloads = [
    {
      batchId,
      mode: "practice",
      sendEmails: false,
      ownerOnly: true,
      source: "line_autopilot",
    },
    {
      batch_id: batchId,
      mode: "practice",
      send_emails: false,
      owner_only: true,
      source: "line_autopilot",
    },
    {
      id: batchId,
      action: "continue",
      send: false,
      source: "line_autopilot",
    },
  ];

  const attempts = [];
  for (const path of CONTINUATION_PATHS) {
    if (/send|email|outreach|delete|archive|campaign/i.test(path)) continue;

    for (const payload of payloads) {
      const response = await fetch(`${baseUrl(req)}${path}`, {
        method: "POST",
        headers: requestHeaders(),
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      attempts.push({ path, status: response.status, body: text.slice(0, 500) });

      if (response.ok && !validationFailure(text)) {
        return { ok: true, path, status: response.status, attempts };
      }

      if (response.status === 401 || response.status === 403) {
        return { ok: false, path, status: response.status, attempts };
      }
    }
  }

  return { ok: false, status: 404, attempts };
}

async function run(req) {
  const batches = await activeBatches();
  const results = [];
  for (const batch of batches) {
    results.push({
      ...batch,
      continuation: await attemptContinuation(req, batch.batchId),
    });
  }
  return { activeBatches: batches.length, results };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("allow", "GET, POST");
    return json(res, 405, { ok: false, error: "method_not_allowed" });
  }

  const now = Date.now();
  if (inFlight) {
    return json(res, 202, { ok: true, state: "already_running" });
  }
  if (now - lastRunAt < 45_000) {
    return json(res, 202, { ok: true, state: "recently_ran" });
  }

  lastRunAt = now;
  inFlight = run(req);
  try {
    const result = await inFlight;
    return json(res, 200, { ok: true, ...result });
  } catch (error) {
    console.error("line_autopilot_failed", error);
    return json(res, 500, {
      ok: false,
      error: String((error && error.message) || error),
    });
  } finally {
    inFlight = null;
  }
};

module.exports._test = {
  activeBatches,
  attemptContinuation,
  CONTINUATION_PATHS,
};
