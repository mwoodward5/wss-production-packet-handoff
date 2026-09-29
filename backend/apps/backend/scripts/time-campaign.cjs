"use strict";

// scripts/time-campaign.cjs — the CAMPAIGN STOPWATCH.
//
// Proof-grade timing for the smoke test (owner bar: 10 sites mined→built→
// emailed in 15-25 minutes). Fires one campaign through the admin Line API,
// polls the durable batch every 15s, and prints a defensible table — every
// number comes from the server's own campaign timing record (stage
// line_campaign_timing_v1 persisted with the batch), never from dashboard
// impressions or 15s-quantized poll times.
//
//   node scripts/time-campaign.cjs --url https://ghost.example.test --count 10 \
//        --target "Austin, TX roofing" --token-file ~/.wss/admin-token \
//        --out artifacts/campaign-timing.json
//
// Token resolution: --token VALUE, --token-file PATH, or env WSS_ADMIN_TOKEN.
// It is sent as x-admin-token (the admin auth contract).
//
// Exit codes: 0 = campaign completed (done), 1 = usage/transport/config error,
// 2 = PHANTOM ACCEPT (server said ok:true with no durable batchId — the
// 2026-09-01 phantom-start defect class), 3 = campaign halted or timed out
// (the table is still printed and the JSON record still written).
//
// Everything testable is an exported pure function; test/time-campaign.test.js
// pins phantom detection, timing extraction, and table formatting with a
// stubbed fetch and no network.

const fs = require("node:fs");

const DEFAULT_POLL_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 40 * 60 * 1000;
const TERMINAL_STATUSES = new Set(["done", "halted"]);
const TIMING_FIELDS = Object.freeze([
  ["startedAt", "fired (server startedAt)"],
  ["firstQualifiedAt", "first qualified"],
  ["firstBuiltAt", "first build done (mirrored)"],
  ["firstGateAt", "first gate passed"],
  ["firstSentAt", "first email sent"],
]);

class PhantomAcceptError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = "PhantomAcceptError";
    this.detail = detail;
  }
}

function parseArgs(argv = []) {
  const options = {
    url: "",
    count: 10,
    target: "",
    lane: "sandbox",
    token: "",
    tokenFile: "",
    pollMs: DEFAULT_POLL_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    out: "",
    batchId: "",
    fetchImpl: null,
    sleep: null,
    log: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      if (index + 1 >= argv.length) throw new Error(`missing value for ${arg}`);
      return argv[++index];
    };
    switch (arg) {
      case "--url": options.url = String(next()).replace(/\/+$/, ""); break;
      case "--count": options.count = Math.max(1, Number(next()) || 0); break;
      case "--target": options.target = String(next()); break;
      case "--lane": options.lane = String(next()) === "live" ? "live" : "sandbox"; break;
      case "--token": options.token = String(next()); break;
      case "--token-file": options.tokenFile = String(next()); break;
      case "--poll-ms": options.pollMs = Math.max(1000, Number(next()) || 0); break;
      case "--timeout-ms": options.timeoutMs = Math.max(1000, Number(next()) || 0); break;
      case "--out": options.out = String(next()); break;
      case "--batch-id": options.batchId = String(next()); break;
      case "--help": case "-h": options.help = true; break;
      default: throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function usage() {
  return [
    "usage: node scripts/time-campaign.cjs --url BASE [--count N] [--target T] [--lane sandbox|live]",
    "       [--token T | --token-file F | $WSS_ADMIN_TOKEN] [--poll-ms 15000] [--timeout-ms 2400000]",
    "       [--out record.json] [--batch-id EXISTING]",
  ].join("\n");
}

function resolveToken(options, readFile = fs.readFileSync, environment = process.env) {
  const fromEnv = String(environment.WSS_ADMIN_TOKEN || "").trim();
  if (options.token) return options.token.trim();
  if (options.tokenFile) return String(readFile(options.tokenFile, "utf8") || "").trim();
  if (fromEnv) return fromEnv;
  return "";
}

// ---------------------------------------------------------------------------
// API plumbing
// ---------------------------------------------------------------------------

async function apiCall(fetchImpl, url, path, token, body, method = "POST") {
  const response = await fetchImpl(`${url}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-admin-token": token,
      ...(method === "POST" ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${method} ${path} returned non-JSON (${response.status}): ${text.slice(0, 200)}`);
  }
  return { status: response.status, json };
}

// ---------------------------------------------------------------------------
// Phantom-accept detection — tonight's phantom-start bug class.
// A start that answers ok:true/accepted:true without a durable batch id has
// not durably accepted anything. That is a LOUD ERROR, never a warning.
// ---------------------------------------------------------------------------

function assertStartAccepted(response) {
  const body = response && response.json ? response.json : {};
  const batchId = String(body.batchId || (body.batch && body.batch.batchId) || "").trim();
  if (body.ok !== true || !batchId) {
    throw new PhantomAcceptError(
      `PHANTOM ACCEPT: POST /api/admin/line start answered ok:${String(body.ok)} accepted:${String(body.accepted)} with NO durable batchId`,
      { status: response && response.status, body },
    );
  }
  return batchId;
}

function assertBatchReadable(response, batchId) {
  const body = response && response.json ? response.json : {};
  if (response && response.status === 404) {
    throw new PhantomAcceptError(
      `PHANTOM BATCH: batch ${batchId} was accepted but the server now reports unknown_batch`,
      { status: 404, body },
    );
  }
  if (body.ok !== true || !body.batch) {
    throw new Error(`batch read failed for ${batchId} (status ${response && response.status}): ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body.batch;
}

// ---------------------------------------------------------------------------
// Timing extraction — server-side timing record first; row history as the
// fallback for batches older than the timing fields.
// ---------------------------------------------------------------------------

function timingFromBatch(batch) {
  const direct = batch && batch.campaignTiming && typeof batch.campaignTiming === "object"
    ? batch.campaignTiming
    : null;
  if (direct) {
    return {
      startedAt: direct.startedAt || (batch && batch.startedAt) || "",
      firstQualifiedAt: direct.firstQualifiedAt || "",
      firstBuiltAt: direct.firstBuiltAt || "",
      firstGateAt: direct.firstGateAt || "",
      firstSentAt: direct.firstSentAt || "",
    };
  }
  // Fallback: derive firsts from per-row history the API already exposes
  // (rows[].reached lists statuses in order; rows[].updatedAt is the current
  // wall clock of the last transition). This is approximate (updatedAt moves
  // with the row), so it is only used when the durable timing row is absent.
  const rows = Array.isArray(batch && batch.rows) ? batch.rows : [];
  const firstReached = (status) => {
    let earliest = Number.POSITIVE_INFINITY;
    for (const row of rows) {
      const reached = Array.isArray(row && row.reached) ? row.reached : [];
      if (!reached.includes(status)) continue;
      const at = Date.parse(String(row.updatedAt || ""));
      if (Number.isFinite(at) && at < earliest) earliest = at;
    }
    return Number.isFinite(earliest) ? new Date(earliest).toISOString() : "";
  };
  return {
    startedAt: (batch && batch.startedAt) || "",
    firstQualifiedAt: firstReached("qualified"),
    firstBuiltAt: firstReached("mirrored"),
    firstGateAt: firstReached("gate_passed"),
    firstSentAt: firstReached("sent"),
  };
}

function funnelStages(batch) {
  const funnel = Array.isArray(batch && batch.mineFunnel) ? batch.mineFunnel : [];
  return funnel
    .filter((row) => row && typeof row === "object"
      && String(row.stage || "") !== "line_campaign_timing_v1"
      && String(row.stage || "") !== "line_start_watch_v1")
    .map((row) => ({
      stage: String(row.stage || ""),
      elapsedMs: Number.isFinite(Number(row.elapsedMs)) ? Number(row.elapsedMs) : null,
      entered: Number.isFinite(Number(row.entered)) ? Number(row.entered) : null,
      survived: Number.isFinite(Number(row.survived)) ? Number(row.survived) : null,
    }))
    .filter((row) => row.stage);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((ms % 1000) / 100);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function segmentMs(timing, fromField, toField) {
  const from = Date.parse(String((timing && timing[fromField]) || ""));
  const to = Date.parse(String((timing && timing[toField]) || ""));
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return to - from;
}

function stageRowLabel(index) {
  return `funnel stage ${index + 1}`;
}

function formatTable(record) {
  const timing = record.finalTiming || {};
  const start = Date.parse(String(timing.startedAt || ""));
  const lines = [];
  lines.push(`batch        ${record.batchId}`);
  lines.push(`url          ${record.url}`);
  lines.push(`status       ${record.finalStatus}${record.haltReason ? ` (${record.haltReason})` : ""}`);
  lines.push(`sent         ${record.counts.sent}/${record.counts.total} (queued ${record.counts.queued}, failed ${record.counts.failed})`);
  lines.push("");
  lines.push("stopwatch (server-side timing record)");
  lines.push("------------------------------------------------------------");
  for (const [field, label] of TIMING_FIELDS) {
    const at = Date.parse(String(timing[field] || ""));
    const sinceFire = Number.isFinite(at) && Number.isFinite(start) ? at - start : null;
    lines.push(`${label.padEnd(30)} ${formatDuration(sinceFire)}${Number.isFinite(at) ? "" : "  (not reached)"}`);
  }
  const allSentAt = Date.parse(String(record.lastSentAt || ""));
  if (Number.isFinite(allSentAt) && Number.isFinite(start)) {
    lines.push(`${"all sent".padEnd(30)} ${formatDuration(allSentAt - start)}`);
  }
  const totalMs = Number.isFinite(start)
    ? (Number.isFinite(allSentAt) ? allSentAt : Date.parse(String(record.observedAt || ""))) - start
    : null;
  lines.push(`${"total".padEnd(30)} ${formatDuration(totalMs)}`);
  lines.push("");
  const stages = record.stages || [];
  if (stages.length) {
    lines.push("per-stage funnel timings (elapsedMs since fire, stamped once server-side)");
    lines.push("------------------------------------------------------------");
    stages.forEach((stage, index) => {
      const name = stage.stage.length > 34 ? `${stage.stage.slice(0, 31)}...` : stage.stage;
      lines.push(
        `${stageRowLabel(index).padEnd(16)} ${formatDuration(stage.elapsedMs)}  ${name}  in:${stage.entered == null ? "—" : stage.entered} ok:${stage.survived == null ? "—" : stage.survived}`,
      );
    });
  } else {
    lines.push("per-stage funnel timings: none recorded (batch predates elapsedMs stamping)");
  }
  return lines.join("\n");
}

function liveLine(record, elapsedMs) {
  const counts = record.counts || {};
  const parts = [
    `${formatDuration(elapsedMs)}`,
    `status=${record.finalStatus}`,
    `sent=${counts.sent || 0}/${counts.total || 0}`,
    `queued=${counts.queued || 0}`,
    `failed=${counts.failed || 0}`,
  ];
  const timing = record.finalTiming || {};
  const marks = [];
  if (timing.firstQualifiedAt) marks.push("Q");
  if (timing.firstBuiltAt) marks.push("B");
  if (timing.firstGateAt) marks.push("G");
  if (timing.firstSentAt) marks.push("S");
  parts.push(`firsts=[${marks.join("")}]`);
  return parts.join("  ");
}

// ---------------------------------------------------------------------------
// Campaign runner
// ---------------------------------------------------------------------------

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startCampaign(options, token) {
  const firedAt = new Date().toISOString();
  const response = await apiCall(
    options.fetchImpl,
    options.url,
    "/api/admin/line",
    token,
    {
      action: "start",
      count: options.count,
      ...(options.target ? { target: options.target } : {}),
      lane: options.lane,
    },
  );
  const batchId = assertStartAccepted(response);
  return { batchId, firedAt };
}

function recordFromBatch(batch) {
  const rows = Array.isArray(batch && batch.rows) ? batch.rows : [];
  const counts = { total: rows.length, sent: 0, queued: 0, failed: 0, working: 0 };
  for (const row of rows) {
    if (row.status === "sent") counts.sent += 1;
    else if (row.status === "queued") counts.queued += 1;
    else if (["rejected", "gate_failed", "error"].includes(String(row.status))) counts.failed += 1;
    else counts.working += 1;
  }
  return {
    finalStatus: String(batch.status || ""),
    haltReason: String(batch.haltReason || ""),
    counts,
    finalTiming: timingFromBatch(batch),
    stages: funnelStages(batch),
    lastSentAt: latestSentAt(rows),
    observedAt: new Date().toISOString(),
  };
}

function latestSentAt(rows) {
  let latest = Number.NEGATIVE_INFINITY;
  for (const row of rows || []) {
    if (String(row.status || "") !== "sent") continue;
    const at = Date.parse(String(row.updatedAt || ""));
    if (Number.isFinite(at) && at > latest) latest = at;
  }
  return Number.isFinite(latest) ? new Date(latest).toISOString() : "";
}

function campaignComplete(record) {
  return TERMINAL_STATUSES.has(record.finalStatus);
}

async function runCampaign(options, token) {
  const log = options.log || ((line) => console.log(line));
  const sleep = options.sleep || defaultSleep;
  const fetchImpl = options.fetchImpl;
  let batchId = String(options.batchId || "").trim();
  let firedAt = new Date().toISOString();
  if (!batchId) {
    const started = await startCampaign(options, token);
    batchId = started.batchId;
    firedAt = started.firedAt;
    log(`fired campaign ${batchId} (count=${options.count}, lane=${options.lane}) at ${firedAt}`);
  } else {
    log(`attaching to existing batch ${batchId}`);
  }
  const polls = [];
  const record = {
    url: options.url,
    batchId,
    firedAt,
    polls,
    finalStatus: "",
    haltReason: "",
    counts: { total: 0, sent: 0, queued: 0, failed: 0, working: 0 },
    finalTiming: {},
    stages: [],
    lastSentAt: "",
    observedAt: "",
  };
  const deadline = Date.now() + options.timeoutMs;
  let firstObservations = {};
  for (;;) {
    const response = await apiCall(fetchImpl, options.url, `/api/admin/line?batchId=${encodeURIComponent(batchId)}`, token, undefined, "GET");
    const batch = assertBatchReadable(response, batchId);
    const current = recordFromBatch(batch);
    Object.assign(record, current);
    for (const [field] of TIMING_FIELDS) {
      if (current.finalTiming[field] && !firstObservations[field]) {
        firstObservations[field] = new Date().toISOString();
      }
    }
    record.firstObservations = { ...firstObservations };
    polls.push({
      at: new Date().toISOString(),
      status: current.finalStatus,
      counts: current.counts,
      timing: current.finalTiming,
    });
    const elapsedMs = Date.now() - Date.parse(firedAt);
    log(liveLine(record, elapsedMs));
    if (campaignComplete(current)) break;
    if (Date.now() >= deadline) {
      record.timedOut = true;
      log(`TIMEOUT after ${formatDuration(elapsedMs)} — batch still ${current.finalStatus}`);
      break;
    }
    await sleep(options.pollMs);
  }
  return record;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help || !options.url) {
    console.log(usage());
    return options.help ? 0 : 1;
  }
  let token = "";
  try {
    token = resolveToken(options);
  } catch (error) {
    console.error(`ERROR reading token file: ${error.message}`);
    return 1;
  }
  if (!token) {
    console.error("ERROR: no admin token. Pass --token, --token-file, or set WSS_ADMIN_TOKEN.");
    return 1;
  }
  options.fetchImpl = options.fetchImpl || ((url, init) => fetch(url, init));
  let record;
  try {
    record = await runCampaign(options, token);
  } catch (error) {
    if (error instanceof PhantomAcceptError) {
      console.error("");
      console.error("=".repeat(72));
      console.error(`PHANTOM-START ERROR (exit 2): ${error.message}`);
      console.error("The server accepted the campaign WITHOUT a durable batch id.");
      console.error("Nothing is being timed. Investigate the start endpoint before");
      console.error("trusting any ok:true response from it tonight.");
      console.error(`detail: ${JSON.stringify(error.detail).slice(0, 500)}`);
      console.error("=".repeat(72));
      return 2;
    }
    console.error(`ERROR: ${error.message}`);
    return 1;
  }
  console.log("");
  console.log(formatTable(record));
  if (options.out) {
    const payload = {
      ...record,
      table: formatTable(record),
    };
    fs.writeFileSync(options.out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`\nJSON record written to ${options.out}`);
  }
  if (record.timedOut) return 3;
  if (record.finalStatus === "halted") {
    console.error(`\nCAMPAIGN HALTED: ${record.haltReason || "no reason recorded"} (exit 3)`);
    return 3;
  }
  return 0;
}

module.exports = {
  DEFAULT_POLL_MS,
  DEFAULT_TIMEOUT_MS,
  PhantomAcceptError,
  parseArgs,
  usage,
  resolveToken,
  apiCall,
  assertStartAccepted,
  assertBatchReadable,
  timingFromBatch,
  funnelStages,
  formatDuration,
  formatTable,
  liveLine,
  recordFromBatch,
  campaignComplete,
  runCampaign,
  main,
};

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((error) => {
    console.error(`ERROR: ${error && error.stack ? error.stack : error}`);
    process.exit(1);
  });
}
