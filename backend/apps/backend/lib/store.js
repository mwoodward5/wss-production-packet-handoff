const { randomUUID, createHash } = require("node:crypto");
const { providerStatus } = require("./registry");

const UPSERT_COMPATIBILITY = Object.freeze({
  ghost_agency_prospects: Object.freeze({
    mirroredColumn: "record",
    optionalColumns: Object.freeze(["preview_expires_at", "reference"]),
  }),
});

// These columns are computed by Postgres and must never be supplied as write
// input. Keep this policy table-specific: several other tables legitimately
// store their own `site_slug` values.
const GENERATED_COLUMN_POLICY = Object.freeze({
  ghost_agency_prospects: Object.freeze(["site_slug"]),
});

function supabaseRestUrl(table) {
  const base = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  return `${base}/rest/v1/${table}`;
}

function supabaseConfigured() {
  return providerStatus().supabase.configured;
}

function safeIdentifier(value, fallback = "unknown") {
  const normalized = String(value || "").trim();
  return /^[a-z_][a-z0-9_]*$/i.test(normalized) ? normalized : fallback;
}

function safeToken(value, fallback = "unknown", maxLength = 120) {
  const normalized = String(value || "").trim().replace(/[^a-zA-Z0-9._:-]/g, "");
  return normalized ? normalized.slice(0, maxLength) : fallback;
}

function providerRequestId(response) {
  const value = response?.headers?.get?.("sb-request-id")
    || response?.headers?.get?.("x-request-id")
    || response?.headers?.get?.("cf-ray");
  return value ? safeToken(value, "", 160) : "";
}

function missingSchemaColumn(payload = {}) {
  if (String(payload?.code || "").toUpperCase() !== "PGRST204") return "";
  const text = [payload?.message, payload?.details, payload?.hint]
    .filter((value) => typeof value === "string")
    .join(" ");
  const match = text.match(/could not find the ['"]([a-z_][a-z0-9_]*)['"] column/i)
    || text.match(/column ['"]?([a-z_][a-z0-9_]*)['"]?[^.]*schema cache/i);
  return match ? safeIdentifier(match[1], "") : "";
}

// A GENERATED ALWAYS column cannot accept a written value — Postgres 428C9. The
// database computes it, so the fix is to DROP it from the write payload (never
// mirror it: it is derived, not stored input) and retry. Measured on prod
// /api/admin/line: repeated ghost_store_upsert_failed 428C9 on ghost_agency_prospects.
function generatedColumn(payload = {}) {
  if (String(payload?.code || "").toUpperCase() !== "428C9") return "";
  const text = [payload?.message, payload?.details, payload?.hint]
    .filter((value) => typeof value === "string")
    .join(" ");
  const match = text.match(/column ['"]([a-z_][a-z0-9_]*)['"]/i);
  return match ? safeIdentifier(match[1], "") : "";
}

function generatedColumnsFor(table) {
  return GENERATED_COLUMN_POLICY[safeIdentifier(table, "")] || [];
}

function stripGeneratedColumns(table, value) {
  const generatedColumns = generatedColumnsFor(table);
  if (!generatedColumns.length) return { value, omittedColumns: [] };
  const rows = Array.isArray(value) ? value : [value];
  const omitted = new Set();
  const cleaned = rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return row;
    let next = row;
    for (const column of generatedColumns) {
      if (!Object.prototype.hasOwnProperty.call(row, column)) continue;
      if (next === row) next = { ...row };
      delete next[column];
      omitted.add(column);
    }
    return next;
  });
  return {
    value: Array.isArray(value) ? cleaned : cleaned[0],
    omittedColumns: [...omitted],
  };
}

function generatedConflictColumn(table, conflictColumns) {
  const generatedColumns = generatedColumnsFor(table);
  if (!generatedColumns.length) return "";
  const conflicts = String(conflictColumns || "")
    .split(",")
    .map((column) => safeIdentifier(column.trim(), ""))
    .filter(Boolean);
  return conflicts.find((column) => generatedColumns.includes(column)) || "";
}

function generatedConflictError(column) {
  return {
    code: "generated_conflict_column",
    category: "generated_column",
    retryable: false,
    column,
  };
}

function safeWriteError(status, payload = {}) {
  // Preserve the historical provider response contract for other failures,
  // while ensuring 428C9 never echoes provider details that can contain row
  // values or PII.
  if (String(payload?.code || "").toUpperCase() === "428C9") {
    return safeProviderError(status, payload);
  }
  return payload;
}

function safeProviderError(status, payload = {}, networkFailure = false) {
  const code = networkFailure
    ? "network_error"
    : safeToken(payload?.code, status ? `http_${status}` : "provider_error", 40);
  const column = missingSchemaColumn(payload) || generatedColumn(payload);
  let category = "provider_rejected";
  if (networkFailure) category = "network_failure";
  else if (code === "PGRST204" && column) category = "schema_column_missing";
  else if (String(code).toUpperCase() === "428C9") category = "generated_column";
  else if (code === "42501" || status === 401 || status === 403) category = "authorization_failed";
  else if (code === "23505" || status === 409) category = "write_conflict";
  else if (status === 429) category = "rate_limited";
  else if (status >= 500) category = "provider_unavailable";
  return {
    code,
    category,
    retryable: networkFailure || status === 429 || status >= 500,
    ...(column ? { column } : {}),
  };
}

function compatibilityRetry(table, row, payload) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  // Never infer a generated-column policy from a provider error. Only an
  // explicitly allowlisted table/column pair may be omitted and retried.
  const generated = generatedColumn(payload);
  if (generatedColumnsFor(table).includes(generated) && Object.prototype.hasOwnProperty.call(row, generated)) {
    const retryRow = { ...row };
    delete retryRow[generated];
    return { row: retryRow, omittedColumns: [generated], mirroredColumn: null };
  }
  const policy = UPSERT_COMPATIBILITY[table];
  if (!policy) return null;
  const column = missingSchemaColumn(payload);
  if (!column || !policy.optionalColumns.includes(column) || !Object.prototype.hasOwnProperty.call(row, column)) return null;
  const mirrored = row[policy.mirroredColumn];
  if (!mirrored || typeof mirrored !== "object" || Array.isArray(mirrored)) return null;
  if (!Object.prototype.hasOwnProperty.call(mirrored, column) || !Object.is(mirrored[column], row[column])) return null;
  const retryRow = { ...row };
  delete retryRow[column];
  return {
    row: retryRow,
    omittedColumns: [column],
    mirroredColumn: policy.mirroredColumn,
  };
}

function logUpsertDiagnostic(level, event) {
  const line = JSON.stringify({
    event: event.event,
    diagnostic_id: safeToken(event.diagnosticId, "unknown", 160),
    table: safeIdentifier(event.table),
    status: Number(event.status) || 0,
    error_code: safeToken(event.error?.code, "unknown", 40),
    error_category: safeToken(event.error?.category, "unknown", 80),
    error_column: event.error?.column ? safeIdentifier(event.error.column, "") : null,
    retryable: event.error?.retryable === true,
    attempts: Number(event.attempts) || 1,
    omitted_columns: Array.isArray(event.omittedColumns)
      ? event.omittedColumns.map((column) => safeIdentifier(column)).slice(0, 10)
      : [],
    provider_request_id: event.providerRequestId ? safeToken(event.providerRequestId, "", 160) : null,
  });
  if (level === "warn") console.warn(line);
  else console.error(line);
}

function boundedWriteContext(options = {}) {
  const directSignal = options
    && typeof options === "object"
    && typeof options.aborted === "boolean"
    && typeof options.addEventListener === "function";
  const callerSignal = directSignal ? options : options?.signal;
  const deadlineAt = directSignal ? 0 : Number(options?.deadlineAt);
  const deadlineEnabled = Number.isFinite(deadlineAt) && deadlineAt > 0;

  if (callerSignal?.aborted) {
    return { preflight: "aborted", signal: callerSignal, cleanup() {} };
  }
  if (deadlineEnabled && deadlineAt <= Date.now()) {
    return { preflight: "timeout", signal: undefined, cleanup() {} };
  }
  if (!callerSignal && !deadlineEnabled) {
    return { preflight: "", signal: undefined, cleanup() {}, interruption: null };
  }

  const controller = new AbortController();
  let cause = "";
  let resolveInterruption;
  let deadlineTimer;
  let removeCallerListener;
  const interruption = new Promise((resolve) => { resolveInterruption = resolve; });
  const interrupt = (nextCause) => {
    if (cause) return;
    cause = nextCause;
    // Never forward a caller-supplied abort reason. It may contain request or
    // customer data, and the store contract only exposes fixed error codes.
    controller.abort();
    resolveInterruption({ interrupted: true, cause });
  };

  if (callerSignal?.addEventListener) {
    const onAbort = () => interrupt("aborted");
    callerSignal.addEventListener("abort", onAbort, { once: true });
    removeCallerListener = () => callerSignal.removeEventListener("abort", onAbort);
  }
  if (deadlineEnabled) {
    deadlineTimer = setTimeout(
      () => interrupt("timeout"),
      Math.min(2_147_483_647, Math.max(1, Math.ceil(deadlineAt - Date.now()))),
    );
  }

  return {
    preflight: "",
    signal: controller.signal,
    interruption,
    get cause() { return cause; },
    cleanup() {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      if (removeCallerListener) removeCallerListener();
    },
  };
}

function safeWriteInterruption(operation, table, cause, extra = {}) {
  const timedOut = cause === "timeout";
  return {
    mode: `live_${operation}_failed`,
    table,
    status: 0,
    error: {
      code: timedOut ? "write_timeout" : "write_aborted",
      category: timedOut ? "provider_timeout" : "request_aborted",
      retryable: true,
    },
    aborted: true,
    ...(operation === "update" ? { ok: false, updated: false } : {}),
    ...extra,
  };
}

async function boundedWriteJson(url, init, options = {}, fallback = {}) {
  const context = boundedWriteContext(options);
  if (context.preflight) {
    return {
      ok: false,
      interrupted: true,
      cause: context.preflight,
      status: 0,
      json: fallback,
      providerRequestId: "",
    };
  }

  const request = (async () => {
    try {
      const response = await fetch(url, {
        ...init,
        ...(context.signal ? { signal: context.signal } : {}),
      });
      const json = await response.json().catch((error) => {
        if (context.cause || error?.name === "AbortError") throw error;
        return fallback;
      });
      return {
        ok: response.ok,
        status: response.status,
        json,
        providerRequestId: providerRequestId(response),
        networkFailure: false,
      };
    } catch (error) {
      if (context.cause || error?.name === "AbortError") {
        return {
          ok: false,
          interrupted: true,
          cause: context.cause || "aborted",
          status: 0,
          json: fallback,
          providerRequestId: "",
        };
      }
      return {
        ok: false,
        status: 0,
        json: fallback,
        providerRequestId: "",
        networkFailure: true,
      };
    }
  })();

  try {
    // The race is intentional. It keeps the seam bounded even when a test
    // double or non-standard fetch implementation ignores AbortSignal.
    return context.interruption
      ? await Promise.race([request, context.interruption])
      : await request;
  } finally {
    context.cleanup();
  }
}

async function postUpsert(url, row, options = {}) {
  const result = await boundedWriteJson(url, {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(row),
    }, options, {});
  return result;
}

async function insertRow(table, row, options = {}) {
  const prepared = stripGeneratedColumns(table, row);
  if (!supabaseConfigured()) {
    return {
      mode: "dry_run",
      configured: false,
      table,
      rowPreview: prepared.value,
    };
  }

  const result = await boundedWriteJson(supabaseRestUrl(table), {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(prepared.value),
  }, options, {});
  if (result?.interrupted) {
    return safeWriteInterruption("write", table, result.cause || result.interruption);
  }
  if (result.networkFailure) {
    return {
      mode: "live_write_failed",
      table,
      status: 0,
      error: safeProviderError(0, {}, true),
    };
  }
  if (!result.ok) {
    return {
      mode: "live_write_failed",
      table,
      status: result.status,
      error: safeWriteError(result.status, result.json),
    };
  }
  return {
    mode: "live_write",
    table,
    row: result.json,
  };
}

async function upsertRow(table, row, conflictColumns = "", options = {}) {
  const conflictColumn = generatedConflictColumn(table, conflictColumns);
  if (conflictColumn) {
    return {
      mode: "live_upsert_failed",
      table,
      status: 0,
      error: generatedConflictError(conflictColumn),
      attempts: 0,
    };
  }
  const prepared = stripGeneratedColumns(table, row);
  if (!supabaseConfigured()) {
    return {
      mode: "dry_run",
      configured: false,
      table,
      conflictColumns,
      rowPreview: prepared.value,
    };
  }

  const url = new URL(supabaseRestUrl(table));
  if (conflictColumns) {
    url.searchParams.set("on_conflict", conflictColumns);
  }

  const diagnosticId = randomUUID();
  let attempts = 1;
  let result = await postUpsert(url, prepared.value, options);
  if (!result.ok) {
    if (result?.interrupted) {
      const interrupted = safeWriteInterruption("upsert", table, result.cause || result.interruption, { attempts });
      logUpsertDiagnostic("error", {
        event: "ghost_store_upsert_failed",
        diagnosticId,
        table,
        status: 0,
        error: interrupted.error,
        attempts,
        omittedColumns: [],
        providerRequestId: "",
      });
      return { ...interrupted, diagnosticId };
    }
    const retry = compatibilityRetry(table, prepared.value, result.json);
    if (retry) {
      attempts += 1;
      const initialError = safeProviderError(result.status, result.json, result.networkFailure);
      const initialProviderRequestId = result.providerRequestId;
      result = await postUpsert(url, retry.row, options);
      if (result?.interrupted) {
        const interrupted = safeWriteInterruption("upsert", table, result.cause || result.interruption, { attempts });
        logUpsertDiagnostic("error", {
          event: "ghost_store_upsert_failed",
          diagnosticId,
          table,
          status: 0,
          error: interrupted.error,
          attempts,
          omittedColumns: retry.omittedColumns,
          providerRequestId: "",
        });
        return {
          ...interrupted,
          diagnosticId,
          compatibility: {
            mode: "mirrored_optional_column_retry_failed",
            omittedColumns: retry.omittedColumns,
            mirroredColumn: retry.mirroredColumn,
          },
        };
      }
      if (result.ok) {
        logUpsertDiagnostic("warn", {
          event: "ghost_store_upsert_compat",
          diagnosticId,
          table,
          status: result.status,
          error: initialError,
          attempts,
          omittedColumns: retry.omittedColumns,
          providerRequestId: initialProviderRequestId || result.providerRequestId,
        });
        return {
          mode: "live_upsert",
          table,
          row: result.json,
          diagnosticId,
          compatibility: {
            mode: "mirrored_optional_column_omitted",
            omittedColumns: retry.omittedColumns,
            mirroredColumn: retry.mirroredColumn,
            attempts,
          },
        };
      }
      const error = safeProviderError(result.status, result.json, result.networkFailure);
      logUpsertDiagnostic("error", {
        event: "ghost_store_upsert_failed",
        diagnosticId,
        table,
        status: result.status,
        error,
        attempts,
        omittedColumns: retry.omittedColumns,
        providerRequestId: result.providerRequestId,
      });
      return {
        mode: "live_upsert_failed",
        table,
        status: result.status,
        error,
        diagnosticId,
        attempts,
        compatibility: {
          mode: "mirrored_optional_column_retry_failed",
          omittedColumns: retry.omittedColumns,
          mirroredColumn: retry.mirroredColumn,
        },
      };
    }

    const error = safeProviderError(result.status, result.json, result.networkFailure);
    logUpsertDiagnostic("error", {
      event: "ghost_store_upsert_failed",
      diagnosticId,
      table,
      status: result.status,
      error,
      attempts,
      omittedColumns: [],
      providerRequestId: result.providerRequestId,
    });
    return {
      mode: "live_upsert_failed",
      table,
      status: result.status,
      error,
      diagnosticId,
      attempts,
    };
  }
  return {
    mode: "live_upsert",
    table,
    row: result.json,
  };
}

function storeReadTimeoutMs(env = process.env) {
  const parsed = Number.parseInt(env.GHOST_AGENCY_STORE_READ_TIMEOUT_MS || "8000", 10);
  if (!Number.isFinite(parsed)) return 8000;
  return Math.min(Math.max(parsed, 250), 20_000);
}

async function fetchReadJson(url, init = {}, fallback = []) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const error = new Error("supabase_read_timeout");
      error.code = "read_timeout";
      reject(error);
    }, storeReadTimeoutMs());
  });
  try {
    return await Promise.race([
      fetch(url, { ...init, signal: controller.signal }).then(async (response) => ({
        response,
        json: await response.json().catch(() => fallback),
      })),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function selectReadFailure(table, error, shape) {
  const timedOut = error?.code === "read_timeout" || error?.name === "AbortError";
  return {
    ok: false,
    mode: "live_select_failed",
    table,
    status: 0,
    error: {
      code: timedOut ? "read_timeout" : "network_error",
      category: timedOut ? "provider_timeout" : "network_failure",
      retryable: true,
    },
    [shape]: [],
  };
}

async function selectRows(table, options = {}) {
  if (!supabaseConfigured()) {
    return {
      mode: "dry_run",
      configured: false,
      table,
      rows: [],
      reason: "SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY not configured",
    };
  }

  const url = new URL(supabaseRestUrl(table));
  url.searchParams.set("select", options.select || "*");
  if (options.order) {
    url.searchParams.set("order", options.order);
  }
  if (options.limit) {
    url.searchParams.set("limit", String(options.limit));
  }
  // FILTERS WERE SILENTLY DROPPED.
  //
  // Callers have been passing `filter: "type=eq.line.batch"` since the durable
  // batch registry landed, and this function ignored it — so a query meant to
  // read batch snapshots read the newest rows of EVERY event type instead.
  // Measured on production: the console's batch history showed ONE batch while
  // 360 snapshots across dozens of batches sat in the table, which is why two
  // finished sites appeared to vanish instead of waiting for approval.
  // Accepts PostgREST filter syntax, one or more, joined by "&".
  if (options.filter) {
    for (const clause of String(options.filter).split("&")) {
      const eq = clause.indexOf("=");
      if (eq <= 0) continue;
      const key = clause.slice(0, eq).trim();
      const value = clause.slice(eq + 1).trim();
      // Reserved query keys are set above from their own options; a filter must
      // never be able to rewrite the select list, ordering or row cap.
      if (!key || !value || ["select", "order", "limit", "offset"].includes(key)) continue;
      url.searchParams.set(key, decodeURIComponent(value));
    }
  }

  let result;
  try {
    result = await fetchReadJson(url, {
      method: "GET",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    const failure = selectReadFailure(table, error, "rows");
    delete failure.ok;
    return failure;
  }
  const { response, json } = result;
  if (!response.ok) {
    return {
      mode: "live_select_failed",
      table,
      status: response.status,
      error: json,
    };
  }
  return {
    mode: "live_select",
    table,
    rows: json,
  };
}

async function select(table, query = "") {
  if (!supabaseConfigured()) {
    return {
      ok: false,
      mode: "dry_run",
      skipped: "supabase_not_configured",
      table,
      data: [],
    };
  }

  const suffix = query ? (query.startsWith("?") ? query : `?${query}`) : "";
  let result;
  try {
    result = await fetchReadJson(`${supabaseRestUrl(table)}${suffix}`, {
      method: "GET",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    return selectReadFailure(table, error, "data");
  }
  const { response, json } = result;
  if (!response.ok) {
    return {
      ok: false,
      mode: "live_select_failed",
      table,
      status: response.status,
      error: json,
      data: [],
    };
  }
  return {
    ok: true,
    mode: "live_select",
    table,
    data: json,
  };
}

// The events table requires a client-supplied id (every other inserter of
// ghost_agency_events provides one; recordEvent was the sole exception, and
// its id-less inserts never landed — production shows ZERO mirror.identity
// events ever while id-supplying inserters flow, which ended every completed
// mirror build as a mirror_release_unconfirmed hold, 2026-08-31/09-01).
// A deterministic id from (type, payload) also makes retries idempotent: the
// same event re-attempted conflicts on the primary key instead of duplicating.
function deterministicEventId(type, payload) {
  const digest = createHash("sha256")
    .update(`${String(type || "")} ${JSON.stringify(payload == null ? null : payload)}`)
    .digest("hex");
  const hex = digest.replace(/[^0-9a-f]/g, "0").slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${"89ab"[parseInt(hex.slice(16, 17), 16) % 4]}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

async function recordEvent(type, payload) {
  return insertRow("ghost_agency_events", {
    id: deterministicEventId(type, payload),
    type,
    payload,
    created_at: new Date().toISOString(),
  });
}

// Single conditional write: PATCH a row ONLY when every guard filter still
// matches at write time (PostgREST filters are evaluated atomically with the
// update). Used as the promotion race guard — the caller re-reads the row
// state inside `guards` (e.g. `record->>voice_edit_promotion=is.null`) so two
// concurrent first-edit requests cannot both persist a promotion: whichever
// PATCH lands second matches 0 rows and reports updated:false.
async function conditionalUpdate(table, idColumn, idValue, guards, patch, options = {}) {
  const prepared = stripGeneratedColumns(table, patch);
  if (
    prepared.omittedColumns.length > 0
    && prepared.value
    && typeof prepared.value === "object"
    && !Array.isArray(prepared.value)
    && Object.keys(prepared.value).length === 0
  ) {
    return {
      ok: false,
      mode: "live_update_rejected",
      table,
      updated: false,
      error: generatedConflictError(prepared.omittedColumns[0]),
    };
  }
  if (!supabaseConfigured()) {
    return {
      ok: false,
      mode: "dry_run",
      configured: false,
      table,
      updated: false,
    };
  }
  const url = new URL(supabaseRestUrl(table));
  url.searchParams.set(`${safeIdentifier(idColumn)}`, `eq.${idValue}`);
  for (const [column, filter] of Object.entries(guards || {})) {
    // JSONB path operators (->>) must pass through untouched; plain column
    // names are validated as identifiers.
    const key = column.includes("->") ? column : safeIdentifier(column);
    url.searchParams.set(key, filter);
  }
  const result = await boundedWriteJson(url, {
    method: "PATCH",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(prepared.value),
  }, options, []);
  if (result?.interrupted) {
    return safeWriteInterruption("update", table, result.cause || result.interruption);
  }
  if (result.networkFailure) {
    return {
      ok: false,
      mode: "live_update_failed",
      table,
      status: 0,
      error: safeProviderError(0, {}, true),
      updated: false,
    };
  }
  if (!result.ok) {
    return {
      ok: false,
      mode: "live_update_failed",
      table,
      status: result.status,
      error: safeWriteError(result.status, result.json),
      updated: false,
    };
  }
  const rows = Array.isArray(result.json) ? result.json : [];
  return {
    ok: true,
    mode: "live_update",
    table,
    updated: rows.length > 0,
    rows,
  };
}

async function event(input = {}) {
  const type = input.type || "system.event";
  return recordEvent(type, {
    actor: input.actor || "system",
    status: input.status || "ok",
    ...(input.payload || {}),
  });
}

module.exports = {
  conditionalUpdate,
  deterministicEventId,
  event,
  insertRow,
  recordEvent,
  select,
  selectRows,
  upsertRow,
};
