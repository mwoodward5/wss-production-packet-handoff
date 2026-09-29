"use strict";

const { recordEvent } = require("../lib/store");

const DEFAULT_TYPE = "probe.events_write";
const MAX_PROBES = 5;
const LONG_TOKEN_PATTERN = /[A-Za-z0-9_./+=:-]{32,}/g;

function parseArgs(argv = []) {
  let type = DEFAULT_TYPE;
  let count = 1;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--type") {
      const value = String(argv[index + 1] || "").trim();
      if (!value || value.startsWith("--")) throw new Error("--type requires a non-empty value");
      type = value;
      index += 1;
      continue;
    }
    if (arg === "--n") {
      const raw = String(argv[index + 1] || "").trim();
      const parsed = Number.parseInt(raw, 10);
      if (!/^\d+$/.test(raw) || !Number.isFinite(parsed) || parsed < 1) {
        throw new Error("--n requires a positive integer");
      }
      count = Math.min(parsed, MAX_PROBES);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return { type, count };
}

function redactLongTokenLikeStrings(value) {
  return String(value ?? "").replace(LONG_TOKEN_PATTERN, "[REDACTED]");
}

function redactValue(value) {
  if (typeof value === "string") return redactLongTokenLikeStrings(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item)]));
  }
  return value;
}

function errorBodyExcerpt(error) {
  let raw;
  if (typeof error === "string") raw = error;
  else {
    try {
      raw = JSON.stringify(error ?? null);
    } catch {
      raw = "[unserializable error]";
    }
  }
  return redactLongTokenLikeStrings(raw.slice(0, 300));
}

function classifyResult(result = {}) {
  if (result.mode === "live_write") return { kind: "ok" };

  if (result.mode === "dry_run" && result.configured === false) {
    return {
      kind: "not-configured",
      reason: "SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY not configured",
    };
  }

  const status = Number(result.status) || 0;
  const code = String(result.error?.code || "");
  const category = String(result.error?.category || "");
  if (status === 0 && (code === "network_error" || category === "network_failure")) {
    return {
      kind: "network",
      status: 0,
      error: redactValue(result.error || null),
    };
  }

  if (status > 0) {
    return {
      kind: "http",
      status,
      body_excerpt: errorBodyExcerpt(result.error),
    };
  }

  return {
    kind: "failure",
    status,
    body_excerpt: errorBodyExcerpt(result.error),
  };
}

async function run({ argv = process.argv.slice(2), write = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const { type, count } = parseArgs(argv);
  let allLive = true;

  for (let attempt = 1; attempt <= count; attempt += 1) {
    const result = await recordEvent(type, {
      probe: true,
      at: new Date().toISOString(),
    });
    const output = {
      attempt,
      type,
      result: redactValue(result),
      classification: classifyResult(result),
    };
    write(JSON.stringify(output));
    if (result?.mode !== "live_write") allLive = false;
  }

  return allLive ? 0 : 1;
}

async function main() {
  try {
    process.exitCode = await run();
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      classification: { kind: "usage" },
      error: redactLongTokenLikeStrings(error?.message || String(error)),
    })}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_TYPE,
  MAX_PROBES,
  classifyResult,
  errorBodyExcerpt,
  parseArgs,
  redactLongTokenLikeStrings,
  redactValue,
  run,
};
