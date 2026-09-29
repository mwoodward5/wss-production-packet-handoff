"use strict";

// THE PROSPECT BANK (owner doctrine 2026-09-02): nothing mined is ever thrown
// away, and campaigns draw banked-first.
//
// Every mined candidate that passes a durable gate — a qualified surplus a
// campaign could not seat, a cross-vertical discovery, a candidate whose
// campaign halted before its build — is BANKED on its own prospect row and
// stays drawable by any future campaign. A campaign start draws from the bank
// BEFORE source rotation, so a stocked bank starts a 10-site campaign in
// seconds at near-zero marginal Firecrawl cost (a valid signed receipt
// requalifies free; only an expired receipt recompiles).
//
// STORE SHAPE — a `bank_status` dimension on ghost_agency_prospects
// (record.prospect_bank), NOT a separate index table:
//   1. The prospect row already carries everything a draw needs: identity and
//      facts, contact, and the SIGNED COMPILE RECEIPT
//      (record.genie_content_certification + genie_canonical_packet +
//      genie_compile_idempotency_key) that verifiedGenieContentReceipt
//      consumes for the free requalification. A second table would have to
//      mirror the receipt to be useful and could drift from the single
//      source of truth.
//   2. Canonical domain/phone/name dedupe already lives on this table
//      (record.identity.keys, lib/prospect-identity.js); a second table
//      would be a second dedupe domain.
//   3. Atomic draws reuse the store's conditionalUpdate CAS with JSONB-path
//      guards (record->>bank_status=eq.banked) — the same race-guard pattern
//      the codebase already trusts for the promotion guard. No migration, no
//      new write path.
//
// Lifecycle:
//   banked    — qualified, receipt durable on the record, never sent
//   reserved  — drawn by an active campaign (reserved_by_batch + TTL; a dead
//               batch's reservation expires and releases back to banked)
//   exhausted — burned: sent/queued, built (preview exists), suppressed, or a
//               terminal candidate-local refusal observed at draw

const storeDefaults = require("./store");
const adapters = require("./line-adapters");
const { canonicalIdentity } = require("./prospect-identity");

const BANK_TABLE = "ghost_agency_prospects";
const SUPPRESSIONS_TABLE = "ghost_agency_suppressions";
const BANK_DRAW_STAGE = "bank_draw";
const BANK_FUNNEL_ROW_LIMIT = 80;
const DEFAULT_RESERVATION_TTL_MS = 2 * 60 * 60 * 1000;
const DEFAULT_TARGET_PER_VERTICAL = 25;
const DRAW_OVERSAMPLE = 3;
const SWEEP_LIMIT = 200;
const COUNT_READ_LIMIT = 1000;

// The donor registry calls the vertical "salon" while the miner's frozen
// category contract says "hair salon" (lib/line-quota.js). Bank on the donor
// identity and translate in both directions so a banked "hair salon" row is
// drawable by a "salon" campaign and vice versa.
const MINER_CATEGORY_TO_BANK = Object.freeze({ "hair salon": "salon" });
const BANK_TO_MINER_CATEGORY = Object.freeze({ salon: "hair salon" });

// A prospect row that was actually used outside the bank's knowledge: sent,
// queued for send, or already built (a preview URL is the durable build
// marker). These are burned and can never re-enter the bank.
const BURNED_PROSPECT_STATUSES = new Set(["queued", "sent", "retiring", "retired", "archived_legacy"]);

// Batch rows a halted campaign may deposit back: work that never reached a
// build verdict or a send. gate_failed/rejected/error are terminal damage —
// those candidates go exhausted, not back to the bank.
const DEPOSITABLE_ROW_STATUSES = new Set(["picked", "qualified", "mirrored"]);

function recordOf(row = {}) {
  return row.record && typeof row.record === "object" && !Array.isArray(row.record) ? row.record : {};
}

function bankOf(row = {}) {
  const bank = recordOf(row).prospect_bank;
  return bank && typeof bank === "object" && !Array.isArray(bank) ? bank : null;
}

// THE BANK DIMENSION IS FLAT. `record.bank_status` is the one-key PostgREST
// filter surface (record->>bank_status=eq.banked); `record.prospect_bank`
// carries the rich block (vertical, TTL, provenance) behind it. bankPatch
// writes both together, so they can never disagree.
function bankStatusOf(row = {}) {
  const flat = String(recordOf(row).bank_status || "").trim().toLowerCase();
  if (flat) return flat;
  return String(bankOf(row)?.status || "").trim().toLowerCase();
}

function normalizedVertical(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  return MINER_CATEGORY_TO_BANK[raw] || raw;
}

function verticalOfProspect(row = {}) {
  const rec = recordOf(row);
  const banked = normalizedVertical(bankOf(row)?.vertical);
  if (banked) return banked;
  return normalizedVertical(
    row.vertical || row.industry || rec.vertical || rec.industry || rec.category || "",
  );
}

function prospectIdOf(row = {}) {
  return String(row.prospect_id || row.prospectId || recordOf(row).prospect_id || "").trim();
}

function receiptOf(row = {}) {
  const receipt = recordOf(row).genie_content_certification;
  return receipt && typeof receipt === "object" && !Array.isArray(receipt) ? receipt : null;
}

function receiptExpiresAtMs(row = {}) {
  const parsed = Date.parse(String(receiptOf(row)?.expires_at || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function burnedForBank(row = {}) {
  if (String(row.preview_url || recordOf(row).preview_url || "").trim()) return true;
  return BURNED_PROSPECT_STATUSES.has(String(row.status || "").trim().toLowerCase());
}

// NAP CHEAP-LIVENESS: the row must still describe a real business — a name,
// a place, and a way to reach or find it. No network spend; the full identity,
// vertical, render and delivery gates all still run downstream on the drawn
// candidate exactly as they would on a freshly mined one.
function napLivenessOk(row = {}) {
  const rec = recordOf(row);
  const name = String(row.business_name || rec.business_name || row.businessName || "").trim();
  const place = String(row.city || rec.city || "").trim() || String(row.state || rec.state || "").trim();
  const reach = String(row.phone || rec.phone || "").trim()
    || String(row.current_website || rec.current_website || "").trim()
    || String(row.place_id || rec.place_id || "").trim();
  return Boolean(name && place && reach);
}

function bankEnabled(environment = process.env) {
  return !/^(1|true|on|yes)$/i.test(String(environment?.GHOST_AGENCY_BANK_DISABLED ?? "").trim());
}

function reservationTtlMs(environment = process.env) {
  const parsed = Number.parseInt(environment?.GHOST_AGENCY_BANK_RESERVATION_TTL_MS || "", 10);
  if (!Number.isFinite(parsed) || parsed < 60_000) return DEFAULT_RESERVATION_TTL_MS;
  return Math.min(parsed, 24 * 60 * 60 * 1000);
}

function targetPerVertical(environment = process.env) {
  const parsed = Number.parseInt(environment?.GHOST_AGENCY_BANK_TARGET_PER_VERTICAL || "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_TARGET_PER_VERTICAL;
  return Math.min(parsed, 500);
}

function nowIso(now = Date.now()) {
  return new Date(Number.isFinite(Number(now)) ? now : Date.now()).toISOString();
}

function defaultDeps(deps = {}) {
  return {
    select: deps.select || storeDefaults.select,
    conditionalUpdate: deps.conditionalUpdate || storeDefaults.conditionalUpdate,
    compile: deps.compile || ((row, options = {}) => adapters.compileGenieContent(row, options)),
    parseTarget: deps.parseTarget || adapters.parseTarget,
    readPracticeHistory: deps.readPracticeHistory
      ? () => deps.readPracticeHistory()
      : (options) => adapters.readAllPracticeHistory(deps.select || storeDefaults.select, options),
  };
}

function suppressionKeyCandidates(row = {}) {
  const rec = recordOf(row);
  const identity = canonicalIdentity({ ...row, ...rec });
  const keys = new Set();
  for (const key of identity.keys || []) {
    const value = key.slice(key.indexOf(":") + 1);
    if (value) keys.add(value);
  }
  for (const value of [row.email, rec.email, row.owner_email, rec.owner_email]) {
    const email = String(value || "").trim().toLowerCase();
    if (email) keys.add(email);
  }
  const id = prospectIdOf(row);
  if (id) keys.add(id);
  return [...keys].map((key) => key.replace(/[",()\\]/g, "")).filter(Boolean).slice(0, 12);
}

async function selectSuppressed(select, rows, requestOptions = {}) {
  const keys = [...new Set(rows.flatMap(suppressionKeyCandidates))].slice(0, 60);
  if (!keys.length) return new Set();
  const list = keys.map((key) => `"${key.replace(/"/g, "\\\"")}"`).join(",");
  const result = await select(
    SUPPRESSIONS_TABLE,
    `?select=suppression_key&suppression_key=in.(${list})&limit=100`,
    requestOptions,
  ).catch(() => null);
  if (!result || result.ok !== true || !Array.isArray(result.data)) return null;
  return new Set(result.data.map((entry) => String(entry?.suppression_key || "")));
}

// ONE WRITE, ONE GUARD. The patch replaces `record` wholesale (PostgREST PATCH
// has no JSONB merge here), so callers hand the CURRENT record plus the new
// prospect_bank block, and the guard makes the write conditional on the bank
// state it read. PostgREST evaluates filters atomically with the update, so a
// lost race reports updated:false instead of clobbering the winner.
function bankPatch(row, patch, now) {
  const rec = recordOf(row);
  const current = bankOf(row) || {};
  return {
    record: {
      ...rec,
      bank_status: patch.status,
      prospect_bank: {
        ...current,
        status: patch.status,
        vertical: normalizedVertical(patch.vertical || current.vertical || verticalOfProspect(row)),
        ...(patch.city != null ? { city: String(patch.city || "").slice(0, 120) } : {}),
        ...(patch.state != null ? { state: String(patch.state || "").slice(0, 60) } : {}),
        deposited_at: patch.deposited_at || current.deposited_at || now,
        deposited_by: patch.deposited_by || current.deposited_by || "",
        source_batch_id: patch.source_batch_id ?? current.source_batch_id ?? "",
        receipt_expires_at: patch.receipt_expires_at ?? current.receipt_expires_at ?? (
          receiptExpiresAtMs(row) ? new Date(receiptExpiresAtMs(row)).toISOString() : null
        ),
        ...(patch.reserved_by_batch != null ? { reserved_by_batch: patch.reserved_by_batch } : {}),
        ...(patch.reserved_until != null ? { reserved_until: patch.reserved_until } : {}),
        ...(patch.reason != null ? { reason: String(patch.reason || "").slice(0, 160) } : {}),
        updated_at: now,
      },
    },
    updated_at: now,
  };
}

async function patchBankRow(row, guards, patch, deps, now, requestOptions = {}) {
  const id = prospectIdOf(row);
  if (!id) return { ok: false, reason: "prospect_id_missing" };
  try {
    const result = await deps.conditionalUpdate(
      BANK_TABLE,
      "prospect_id",
      id,
      guards,
      bankPatch(row, patch, now),
      requestOptions,
    );
    if (result?.ok === true && result.updated === true) return { ok: true };
    return { ok: false, reason: result?.ok === true ? "bank_guard_missed" : "bank_write_failed" };
  } catch {
    return { ok: false, reason: "bank_write_failed" };
  }
}

/** Bank qualified prospect rows (store shape: prospect_id + record carrying a
 * signed compile receipt). First banker wins — a row already carrying any bank
 * state is skipped, so concurrent deposits and active reservations are never
 * clobbered. Suppressed and burned rows are refused; duplicates by canonical
 * domain/phone within one deposit bank only the first. Never throws. */
async function depositProspects({
  rows,
  depositedBy,
  sourceBatchId = "",
  now = nowIso(),
  environment = process.env,
  deps = {},
  requestOptions = {},
} = {}) {
  const input = Array.isArray(rows) ? rows : [];
  const summary = { deposited: [], skipped: [], disabled: !bankEnabled(environment) };
  if (!bankEnabled(environment) || !input.length) return summary;

  const bankDeps = defaultDeps(deps);
  const suppressed = await selectSuppressed(bankDeps.select, input, requestOptions);
  if (suppressed === null) summary.suppressionReadFailed = true;

  const seenIdentityKeys = new Set();
  for (const row of input) {
    const id = prospectIdOf(row);
    if (!id) { summary.skipped.push({ prospectId: "", reason: "prospect_id_missing" }); continue; }
    if (bankStatusOf(row)) {
      summary.skipped.push({ prospectId: id, reason: "already_banked" });
      continue;
    }
    // BANKED MEANS QUALIFIED WITH A RECEIPT. The compile persisted the signed
    // certification durably on the record; the draw re-verifies the signature
    // and expiry (and recompiles when stale) — deposit only proves presence.
    if (!receiptOf(row)) {
      summary.skipped.push({ prospectId: id, reason: "receipt_missing" });
      continue;
    }
    if (burnedForBank(row)) {
      summary.skipped.push({ prospectId: id, reason: "already_built_or_sent" });
      continue;
    }
    const identity = canonicalIdentity({ ...row, ...recordOf(row) });
    const duplicateKey = (identity.keys || []).find((key) => seenIdentityKeys.has(key));
    if (duplicateKey) {
      summary.skipped.push({ prospectId: id, reason: "duplicate_identity_in_deposit" });
      continue;
    }
    for (const key of identity.keys || []) seenIdentityKeys.add(key);
    if (suppressed !== null && suppressionKeyCandidates(row).some((key) => suppressed.has(key))) {
      summary.skipped.push({ prospectId: id, reason: "suppressed" });
      continue;
    }
    const outcome = await patchBankRow(row, { "record->>bank_status": "is.null" }, {
      status: "banked",
      deposited_by: String(depositedBy || "").slice(0, 60) || "unknown",
      source_batch_id: sourceBatchId,
      reserved_by_batch: null,
      reserved_until: null,
      city: String(row.city || recordOf(row).city || "").slice(0, 120),
      state: String(row.state || recordOf(row).state || "").slice(0, 60),
    }, bankDeps, now, requestOptions);
    if (outcome.ok) summary.deposited.push(id);
    else summary.skipped.push({ prospectId: id, reason: outcome.reason });
  }
  return summary;
}

/** Release reservations whose TTL expired (a dead batch's draw) back to
 * banked, and mark observed-burned rows exhausted. Best-effort, never throws. */
async function releaseExpiredReservations({
  now = nowIso(),
  environment = process.env,
  deps = {},
  requestOptions = {},
} = {}) {
  const summary = { released: 0, exhausted: 0 };
  if (!bankEnabled(environment)) return summary;
  const bankDeps = defaultDeps(deps);
  const read = await bankDeps.select(
    BANK_TABLE,
    `?select=*&record->>bank_status=eq.reserved&order=updated_at.asc&limit=${SWEEP_LIMIT}`,
    requestOptions,
  ).catch(() => null);
  if (!read || read.ok !== true || !Array.isArray(read.data)) return summary;
  const nowMs = Date.parse(now);
  for (const row of read.data) {
    const bank = bankOf(row) || {};
    const reservedUntil = Date.parse(String(bank.reserved_until || ""));
    if (Number.isFinite(reservedUntil) && reservedUntil > nowMs) continue;
    if (burnedForBank(row)) {
      const outcome = await patchBankRow(row, {
        "record->>bank_status": "in.(banked,reserved)",
      }, { status: "exhausted", reason: "observed_burned" }, bankDeps, now, requestOptions);
      if (outcome.ok) summary.exhausted += 1;
      continue;
    }
    const outcome = await patchBankRow(row, {
      "record->>bank_status": "eq.reserved",
    }, { status: "banked", reserved_by_batch: null, reserved_until: null }, bankDeps, now, requestOptions);
    if (outcome.ok) summary.released += 1;
  }
  return summary;
}

/** Release ONLY this batch's own reservations back to the bank (a halted
 * campaign depositing its seated candidates back). Guards on
 * reserved_by_batch so one campaign can never release another's draw. */
async function releaseReservationsForBatch({
  batchId,
  rows,
  now = nowIso(),
  environment = process.env,
  deps = {},
  requestOptions = {},
} = {}) {
  const summary = { released: 0, skipped: 0 };
  if (!bankEnabled(environment)) return summary;
  const bankDeps = defaultDeps(deps);
  for (const row of Array.isArray(rows) ? rows : []) {
    const outcome = await patchBankRow(row, {
      "record->>bank_status": "eq.reserved",
      "record->prospect_bank->>reserved_by_batch": `eq.${String(batchId || "")}`,
    }, {
      status: "banked",
      reserved_by_batch: null,
      reserved_until: null,
      reason: "",
    }, bankDeps, now, requestOptions);
    if (outcome.ok) summary.released += 1;
    else summary.skipped += 1;
  }
  return summary;
}

function drawGuards() {
  // Only a still-banked row may be reserved. Expired reservations were just
  // released by the sweep; if one expired inside the race window the CAS
  // reports updated:false and the candidate waits for the next draw.
  return { "record->>bank_status": "eq.banked" };
}

/** The campaign-facing draw. Matches the batch's vertical (+ optional city
 * preference), validates cheaply (receipt, NAP liveness, suppression,
 * prior-history wall for Practice), reserves atomically against concurrent
 * campaigns, and requalifies each receipt (a valid signed receipt is FREE; an
 * expired one recompiles exactly once through the same compile seam the pick
 * lanes use). Never throws — a failed draw degrades to mining. */
async function drawForCampaign({
  vertical = "",
  city = "",
  lane = "live",
  count = 0,
  excludeProspectIds = [],
  batchId = "",
  now = nowIso(),
  environment = process.env,
  deps = {},
  requestOptions = {},
} = {}) {
  const wanted = Math.max(0, Number(count) || 0);
  const summary = {
    drawn: [],
    quarantined: [],
    skipped: [],
    released: 0,
    exhausted: 0,
    vertical: normalizedVertical(vertical),
    city: String(city || "").slice(0, 120),
    requested: wanted,
  };
  if (!bankEnabled(environment) || wanted < 1) return summary;

  const bankDeps = defaultDeps(deps);
  const excluded = new Set((Array.isArray(excludeProspectIds) ? excludeProspectIds : []).map(String));
  summary.released = (await releaseExpiredReservations({ now, environment, deps, requestOptions })).released;

  const filters = [
    "select=*",
    "record->>bank_status=eq.banked",
    ...(summary.vertical ? [`record->prospect_bank->>vertical=eq.${encodeURIComponent(summary.vertical)}`] : []),
    `limit=${Math.min(wanted * DRAW_OVERSAMPLE, 60)}`,
  ];
  const read = await bankDeps.select(BANK_TABLE, `?${filters.join("&")}`, requestOptions)
    .catch(() => null);
  if (!read || read.ok !== true || !Array.isArray(read.data)) {
    summary.degraded = "bank_read_failed";
    return summary;
  }

  // City preference is a preference, never a filter: same-market rows first,
  // then any market — the quota controller rotates markets anyway.
  const cityKey = String(summary.city || "").toLowerCase();
  const candidates = read.data
    .filter((row) => !excluded.has(prospectIdOf(row)))
    .sort((left, right) => Number(cityKey && String(left.city || "").toLowerCase() === cityKey ? 0 : 1)
      - Number(cityKey && String(right.city || "").toLowerCase() === cityKey ? 0 : 1));

  const suppressionRows = candidates.slice(0, Math.min(candidates.length, wanted * DRAW_OVERSAMPLE));
  const suppressed = await selectSuppressed(bankDeps.select, suppressionRows, requestOptions);
  if (suppressed === null) summary.suppressionReadFailed = true;

  let practiceKeys = null;
  if (lane === "sandbox") {
    const history = await bankDeps.readPracticeHistory(requestOptions).catch(() => null);
    if (history?.ok === true) practiceKeys = history.keys instanceof Set ? history.keys : new Set(history.keys || []);
    // DEGRADE HONESTLY: the bank draw already proceeds without history keys
    // when the read fails; record it on the summary so the skip is visible
    // (same law as suppressionReadFailed) instead of silently narrowing dedupe.
    if (history?.ok === true && history?.degraded === true) summary.practiceHistoryDegraded = true;
  }

  const nowMs = Date.parse(now);
  const reservedUntil = nowIso(nowMs + reservationTtlMs(environment));
  for (const row of candidates) {
    if (summary.drawn.length >= wanted) break;
    const id = prospectIdOf(row);
    if (!id) continue;
    if (burnedForBank(row)) {
      const outcome = await patchBankRow(row, {
        "record->>bank_status": "in.(banked,reserved)",
      }, { status: "exhausted", reason: "already_built_or_sent" }, bankDeps, now, requestOptions);
      if (outcome.ok) summary.exhausted += 1;
      summary.skipped.push({ prospectId: id, reason: "already_built_or_sent" });
      continue;
    }
    if (!napLivenessOk(row)) {
      summary.skipped.push({ prospectId: id, reason: "nap_liveness_failed" });
      continue;
    }
    if (suppressed !== null && suppressionKeyCandidates(row).some((key) => suppressed.has(key))) {
      const outcome = await patchBankRow(row, {
        "record->>bank_status": "in.(banked,reserved)",
      }, { status: "exhausted", reason: "suppressed" }, bankDeps, now, requestOptions);
      if (outcome.ok) summary.exhausted += 1;
      summary.skipped.push({ prospectId: id, reason: "suppressed" });
      continue;
    }
    // PRIOR-HISTORY WALL (Practice lane): a banked prospect already emailed or
    // sent by ANY earlier batch must never be re-drawn for a new campaign.
    if (practiceKeys) {
      const identity = adapters.practiceIdentity({ ...row, ...recordOf(row) });
      if (identity.keys.some((key) => practiceKeys.has(key))) {
        const outcome = await patchBankRow(row, {
          "record->>bank_status": "in.(banked,reserved)",
        }, { status: "exhausted", reason: "practice_identity_in_prior_history" }, bankDeps, now, requestOptions);
        if (outcome.ok) summary.exhausted += 1;
        summary.skipped.push({ prospectId: id, reason: "practice_identity_in_prior_history" });
        continue;
      }
    }
    // REQUALIFY BEFORE RESERVING. The compile seam checks the durable signed
    // receipt FIRST, so a valid receipt is a free in-memory reuse and only a
    // stale one pays a compile — whose own persist step CAS-guards on
    // updated_at. Reserving first would bump updated_at and break that guard
    // (and its record write could clobber the bank block), so the order is
    // fixed: verify/recompile on the untouched row, then reserve the row the
    // compile persisted.
    const compiled = await bankDeps.compile(row, { env: environment, ...requestOptions })
      .catch(() => null);
    if (!compiled || compiled.ok !== true) {
      // Never burn the candidate on infrastructure. A deterministic
      // candidate-local refusal (proven 422/needs_input) is terminal for THIS
      // candidate only; anything else stops the draw and degrades to mining.
      if (compiled?.retryable === false && compiled.candidateLocal === true) {
        await patchBankRow(row, {
          "record->>bank_status": "in.(banked,reserved)",
        }, { status: "exhausted", reason: String(compiled.reason || "intake_genie_candidate_refused").slice(0, 160) }, bankDeps, now, requestOptions);
        summary.exhausted += 1;
        summary.quarantined.push({
          prospectId: id,
          businessName: String(row.business_name || recordOf(row).business_name || ""),
          vertical: verticalOfProspect(row),
          reason: `intake_genie_candidate_refused: ${String(compiled.reason || "intake_genie_compile_failed")}`.slice(0, 240),
        });
        continue;
      }
      summary.skipped.push({ prospectId: id, reason: "requalify_unavailable" });
      if (summary.drawn.length === 0) summary.degraded = "requalify_unavailable";
      break;
    }
    const certifiedRow = compiled.row && prospectIdOf(compiled.row) === id ? compiled.row : row;
    // ATOMIC RESERVATION: PostgREST evaluates the bank_status=banked guard
    // atomically with the update, so of two concurrent campaigns drawing the
    // same candidate exactly one PATCH lands (updated:true); the loser reads
    // updated:false and moves on.
    const reserve = await patchBankRow(certifiedRow, drawGuards(), {
      status: "reserved",
      reserved_by_batch: String(batchId || "").slice(0, 160),
      reserved_until: reservedUntil,
    }, bankDeps, now, requestOptions);
    if (!reserve.ok) {
      summary.skipped.push({ prospectId: id, reason: "reservation_lost" });
      continue;
    }
    const line = {
      ...adapters.rowToLineRow(certifiedRow),
      ...(compiled.certified === true ? { genieContentCertified: true, needs_fill: false } : {}),
      fromBank: true,
    };
    if (line.prospectId && line.businessName) summary.drawn.push(line);
    else {
      summary.skipped.push({ prospectId: id, reason: "line_projection_incomplete" });
    }
  }
  return summary;
}

/** Derive the bank draw parameters from a durable batch: the vertical a
 * named-market campaign wants, or every banked vertical for All Trades. */
function drawSpecForBatch(batch = {}) {
  const target = String(batch.target || "").trim();
  const parsed = adapters.parseTarget(target);
  if (parsed) return { vertical: normalizedVertical(parsed.industry), city: parsed.location };
  return { vertical: "", city: "" };
}

/** The mineFunnel row the batches panel renders: drawn vs mined arithmetic,
 * named skips, and how many dead reservations the sweep reclaimed. */
function bankDrawFunnelStage(draw = {}, { requested = 0 } = {}) {
  const rejected = {};
  for (const skip of Array.isArray(draw.skipped) ? draw.skipped : []) {
    const reason = String(skip?.reason || "bank_skip");
    rejected[reason] = (rejected[reason] || 0) + 1;
  }
  return {
    stage: BANK_DRAW_STAGE,
    entered: Math.max(0, Number(requested) || 0),
    survived: Array.isArray(draw.drawn) ? draw.drawn.length : 0,
    rejected,
    ...(Number(draw.released) > 0 ? { reservations_released: Number(draw.released) } : {}),
    ...(Number(draw.exhausted) > 0 ? { exhausted: Number(draw.exhausted) } : {}),
    ...(draw.degraded ? { degraded: String(draw.degraded) } : {}),
  };
}

function withBankDrawStage(mineFunnel, stage) {
  if (!stage) return mineFunnel;
  const rows = Array.isArray(mineFunnel)
    ? mineFunnel.filter((row) => row && typeof row === "object")
    : mineFunnel && typeof mineFunnel === "object" ? [mineFunnel] : [];
  return [stage, ...rows.filter((row) => String(row.stage || "") !== BANK_DRAW_STAGE)]
    .slice(0, BANK_FUNNEL_ROW_LIMIT);
}

/** Halt/failure deposit: a batch parked with seated-but-unburned candidates
 * gives them back. Rows this batch drew release their own reservations; rows
 * it mined fresh get a first-time bank entry. Burned and terminal-damage rows
 * are never re-banked. Best-effort, never throws. */
async function depositHaltedBatch({
  batch,
  now = nowIso(),
  environment = process.env,
  deps = {},
  requestOptions = {},
} = {}) {
  const summary = { deposited: 0, released: 0, skipped: 0, disabled: false };
  if (!bankEnabled(environment)) { summary.disabled = true; return summary; }
  const seated = (Array.isArray(batch?.rows) ? batch.rows : [])
    .filter((row) => DEPOSITABLE_ROW_STATUSES.has(String(row?.status || "")))
    .map((row) => String(row?.prospectId || row?.prospect_id || "").trim())
    .filter(Boolean);
  if (!seated.length) return summary;

  const bankDeps = defaultDeps(deps);
  const ids = [...new Set(seated)];
  const rows = [];
  for (let start = 0; start < ids.length; start += 50) {
    const chunk = ids.slice(start, start + 50)
      .map((id) => `"${id.replace(/"/g, "\\\"")}"`).join(",");
    const read = await bankDeps.select(
      BANK_TABLE,
      `?select=*&prospect_id=in.(${chunk})&limit=${chunk.split(",").length}`,
      requestOptions,
    ).catch(() => null);
    if (!read || read.ok !== true || !Array.isArray(read.data)) continue;
    rows.push(...read.data);
  }

  const reservedHere = [];
  const freshRows = [];
  for (const row of rows) {
    if (burnedForBank(row)) { summary.skipped += 1; continue; }
    const bank = bankOf(row);
    if (bank?.status === "reserved" && String(bank.reserved_by_batch || "") === String(batch?.batchId || "")) {
      reservedHere.push(row);
    } else if (!bankStatusOf(row)) {
      freshRows.push(row);
    } else {
      summary.skipped += 1;
    }
  }
  const release = await releaseReservationsForBatch({
    batchId: batch?.batchId,
    rows: reservedHere,
    now,
    environment,
    deps,
    requestOptions,
  });
  summary.released = release.released;
  const deposit = await depositProspects({
    rows: freshRows,
    depositedBy: "batch_halt",
    sourceBatchId: String(batch?.batchId || ""),
    now,
    environment,
    deps,
    requestOptions,
  });
  summary.deposited = deposit.deposited.length;
  summary.skipped += deposit.skipped.length;
  return summary;
}

/** Read-only per-vertical bank census for the admin gallery. */
async function bankCountsByVertical({ deps = {}, requestOptions = {} } = {}) {
  const bankDeps = defaultDeps(deps);
  const read = await bankDeps.select(
    BANK_TABLE,
    `?select=prospect_id,vertical:record->prospect_bank->>vertical&record->>bank_status=eq.banked&limit=${COUNT_READ_LIMIT}`,
    requestOptions,
  ).catch(() => null);
  if (!read || read.ok !== true || !Array.isArray(read.data)) {
    return { ok: false, byVertical: {}, total: 0 };
  }
  const byVertical = {};
  for (const row of read.data) {
    const vertical = normalizedVertical(row?.vertical) || "unknown";
    byVertical[vertical] = (byVertical[vertical] || 0) + 1;
  }
  return { ok: true, byVertical, total: read.data.length };
}

/** Daily-mining filler: compile (receipt-first) and bank freshly mined rows
 * across trades until each vertical reaches its target. Capped, best-effort,
 * never throws — the cron lane keeps its existing contract. */
async function fillBankFromMining({
  minedResult,
  now = nowIso(),
  environment = process.env,
  deps = {},
  requestOptions = {},
} = {}) {
  const summary = {
    ok: true,
    disabled: !bankEnabled(environment),
    targetPerVertical: targetPerVertical(environment),
    byVertical: {},
    considered: 0,
    compiled: 0,
    deposited: 0,
    skipped: 0,
  };
  if (!bankEnabled(environment)) return summary;
  const bankDeps = defaultDeps(deps);

  const counts = await bankCountsByVertical({ deps, requestOptions });
  summary.bankRead = counts.ok;
  if (!counts.ok) return { ...summary, ok: false, degraded: "bank_read_failed" };

  const createdIds = [...new Set((Array.isArray(minedResult?.rows) ? minedResult.rows : [])
    .filter((row) => row?.persistence === "created")
    .map((row) => String(row?.prospect_id || "").trim())
    .filter(Boolean))];
  if (!createdIds.length) return summary;

  const rows = [];
  for (let start = 0; start < createdIds.length; start += 50) {
    const chunk = createdIds.slice(start, start + 50)
      .map((id) => `"${id.replace(/"/g, "\\\"")}"`).join(",");
    const read = await bankDeps.select(
      BANK_TABLE,
      `?select=*&prospect_id=in.(${chunk})&limit=${chunk.split(",").length}`,
      requestOptions,
    ).catch(() => null);
    if (!read || read.ok !== true || !Array.isArray(read.data)) continue;
    rows.push(...read.data);
  }

  const deficits = { ...counts.byVertical };
  const eligible = [];
  for (const row of rows) {
    summary.considered += 1;
    const vertical = verticalOfProspect(row);
    if (bankStatusOf(row)) { summary.skipped += 1; continue; }
    if (burnedForBank(row) || !napLivenessOk(row)) { summary.skipped += 1; continue; }
    if ((deficits[vertical] || 0) >= summary.targetPerVertical) {
      summary.skipped += 1;
      continue;
    }
    deficits[vertical] = (deficits[vertical] || 0) + 1;
    eligible.push(row);
  }

  const ready = [];
  for (const row of eligible) {
    if (receiptOf(row) && receiptExpiresAtMs(row) > Date.parse(now)) {
      ready.push(row);
      continue;
    }
    const compiled = await bankDeps.compile(row, { env: environment, ...requestOptions }).catch(() => null);
    if (!compiled || compiled.ok !== true) {
      summary.skipped += 1;
      continue;
    }
    summary.compiled += 1;
    ready.push(compiled.row && prospectIdOf(compiled.row) ? compiled.row : row);
  }

  const deposit = await depositProspects({
    rows: ready,
    depositedBy: "daily_mining",
    now,
    environment,
    deps,
    requestOptions,
  });
  summary.deposited = deposit.deposited.length;
  summary.skipped += deposit.skipped.length;
  summary.byVertical = deficits;
  return summary;
}

module.exports = {
  BANK_DRAW_STAGE,
  BANK_TABLE,
  DEFAULT_RESERVATION_TTL_MS,
  DEFAULT_TARGET_PER_VERTICAL,
  DEPOSITABLE_ROW_STATUSES,
  bankCountsByVertical,
  bankDrawFunnelStage,
  bankEnabled,
  bankStatusOf,
  depositHaltedBatch,
  depositProspects,
  drawForCampaign,
  drawSpecForBatch,
  fillBankFromMining,
  napLivenessOk,
  normalizedVertical,
  receiptOf,
  releaseExpiredReservations,
  releaseReservationsForBatch,
  reservationTtlMs,
  targetPerVertical,
  verticalOfProspect,
  withBankDrawStage,
};
