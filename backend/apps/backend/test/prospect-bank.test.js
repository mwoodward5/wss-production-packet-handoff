"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const bank = require("../lib/prospect-bank");
const quota = require("../lib/line-quota");
const { createLineContinuation } = require("../lib/line-continuation");

const START_MS = Date.parse("2026-09-02T12:00:00.000Z");
const NOW = new Date(START_MS).toISOString();
const TTL_MS = bank.DEFAULT_RESERVATION_TTL_MS;

// ---------------------------------------------------------------------------
// In-memory PostgREST-shaped store: enough filter/guard surface for the exact
// queries lib/prospect-bank issues (JSONB ->/->> paths, eq/is.null/in./lt.).
// ---------------------------------------------------------------------------

function jsonPathValue(row, path) {
  let value = row;
  for (const token of String(path).split("->")) {
    if (value == null || typeof value !== "object") return null;
    value = value[token.replace(/^>/, "")];
  }
  return value;
}

function filterMatches(row, key, filter) {
  const raw = String(filter ?? "");
  let actual;
  if (key.includes("->")) actual = jsonPathValue(row, key);
  else actual = row[key];
  const opMatch = raw.match(/^(eq|lt|gt|neq)\.(.*)$/s);
  if (opMatch) {
    const [, op, operand] = opMatch;
    const left = actual == null ? "" : String(actual);
    if (op === "eq") return left === operand;
    if (op === "lt") return left !== "" && left < operand;
    if (op === "gt") return left !== "" && left > operand;
    return left !== operand;
  }
  if (raw === "is.null") return actual == null;
  const inMatch = raw.match(/^in\.\((.*)\)$/s);
  if (inMatch) {
    const items = inMatch[1].split(",").map((item) => item.trim().replace(/^"|"$/g, ""));
    return actual != null && items.includes(String(actual));
  }
  return false;
}

class MemoryStore {
  constructor() {
    this.tables = new Map();
    this.updateCalls = [];
  }

  seed(table, rows) {
    this.tables.set(table, rows.map((row) => structuredClone(row)));
    return this;
  }

  rows(table) {
    return this.tables.get(table) || [];
  }

  async select(table, query = "") {
    // NOT URLSearchParams: it would decode the literal "+" of E.164 phone
    // suppression keys into a space. PostgREST receives these keys
    // percent-encoded via URL.searchParams.set; this parser mirrors that
    // by keeping "+" intact and decoding everything else.
    const params = new Map();
    for (const part of String(query).replace(/^\?/, "").split("&")) {
      const eq = part.indexOf("=");
      if (eq <= 0) continue;
      const decode = (value) => {
        try {
          return decodeURIComponent(value.replace(/%(?![0-9a-fA-F]{2})/g, "%25"));
        } catch {
          return value;
        }
      };
      params.set(decode(part.slice(0, eq)), decode(part.slice(eq + 1)));
    }
    let rows = this.rows(table);
    for (const [key, value] of params.entries()) {
      if (["select", "order", "limit", "offset"].includes(key)) continue;
      rows = rows.filter((row) => filterMatches(row, key, value));
    }
    const order = params.get("order");
    if (order === "updated_at.asc") {
      rows = [...rows].sort((left, right) => String(left.updated_at).localeCompare(String(right.updated_at)));
    }
    const limit = Number(params.get("limit"));
    if (Number.isFinite(limit) && limit > 0) rows = rows.slice(0, limit);
    const select = params.get("select") || "*";
    if (select !== "*") {
      const projections = select.split(",").map((part) => part.trim());
      rows = rows.map((row) => {
        const out = {};
        for (const projection of projections) {
          const alias = projection.split(":");
          if (alias.length === 2) {
            out[alias[0]] = alias[1].includes("->")
              ? jsonPathValue(row, alias[1])
              : row[alias[1]] ?? null;
          } else if (projection !== "*" && row[projection] !== undefined) {
            out[projection] = row[projection];
          }
        }
        return out;
      });
    }
    return { ok: true, mode: "live_select", table, data: structuredClone(rows) };
  }

  async conditionalUpdate(table, idColumn, idValue, guards, patch) {
    this.updateCalls.push(structuredClone({ table, idColumn, idValue, guards, patch }));
    const row = this.rows(table).find((candidate) => String(candidate[idColumn]) === String(idValue));
    if (!row) return { ok: true, mode: "live_update", table, updated: false, rows: [] };
    for (const [key, filter] of Object.entries(guards || {})) {
      if (!filterMatches(row, key, filter)) {
        return { ok: true, mode: "live_update", table, updated: false, rows: [] };
      }
    }
    Object.assign(row, structuredClone(patch));
    return { ok: true, mode: "live_update", table, updated: true, rows: [structuredClone(row)] };
  }
}

function bankedRow(overrides = {}) {
  return {
    prospect_id: overrides.prospect_id || "bank_1",
    status: "held",
    preview_url: null,
    business_name: overrides.business_name || "Banked Plumbing Co",
    industry: overrides.industry || "plumbing",
    vertical: overrides.vertical || "plumbing",
    city: overrides.city || "Austin",
    state: "TX",
    phone: overrides.phone || "+15125550100",
    email: overrides.email || "owner@bankedplumbing.test",
    current_website: overrides.current_website || "https://bankedplumbing.test",
    updated_at: overrides.updated_at || NOW,
    record: {
      ...(overrides.record || {}),
      business_name: overrides.business_name || "Banked Plumbing Co",
      industry: overrides.industry || "plumbing",
      city: overrides.city || "Austin",
      state: "TX",
      genie_content_certification: overrides.receipt === null ? null : {
        status: "certified",
        expires_at: overrides.receiptExpiresAt || new Date(START_MS + 7 * 24 * 60 * 60 * 1000).toISOString(),
        ...(overrides.receipt || {}),
      },
      ...(overrides.record && overrides.record.prospect_bank
        ? { prospect_bank: overrides.record.prospect_bank }
        : {}),
    },
    ...overrides.fields,
  };
}

function withBank(row, status, overrides = {}) {
  return {
    ...row,
    record: {
      ...row.record,
      bank_status: status,
      prospect_bank: {
        status,
        vertical: row.vertical || row.industry,
        deposited_at: NOW,
        deposited_by: "test",
        receipt_expires_at: row.record.genie_content_certification?.expires_at || null,
        ...overrides,
      },
    },
  };
}

function depsFor(store, extra = {}) {
  return {
    select: (table, query) => store.select(table, query),
    conditionalUpdate: (table, idColumn, idValue, guards, patch) =>
      store.conditionalUpdate(table, idColumn, idValue, guards, patch),
    compile: extra.compile || (async (row) => ({ ok: true, row, certified: true, reused: true })),
    readPracticeHistory: extra.readPracticeHistory || (async () => ({ ok: true, keys: new Set() })),
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Deposits
// ---------------------------------------------------------------------------

test("pick surplus deposits only receipt-bearing, unsuppressed, unburned rows", async () => {
  const store = new MemoryStore();
  store.seed("ghost_agency_prospects", [
    bankedRow({
      prospect_id: "good_1",
      email: "good@good.test",
      phone: "+15125550111",
      current_website: "https://good.test",
    }),
    bankedRow({
      prospect_id: "no_receipt",
      receipt: null,
      business_name: "No Receipt Co",
      email: "nr@nr.test",
      phone: "+15125550112",
      current_website: "https://nr.test",
    }),
    bankedRow({
      prospect_id: "burned_1",
      business_name: "Burned Co",
      email: "b@burned.test",
      phone: "+15125550113",
      current_website: "https://burned.test",
      fields: { status: "sent", preview_url: "https://x.test" },
    }),
    bankedRow({
      prospect_id: "supp_1",
      business_name: "Suppressed Co",
      email: "supp@supp.test",
      phone: "+15125550114",
      current_website: "https://supp.test",
    }),
  ]);
  store.seed("ghost_agency_suppressions", [{ suppression_key: "supp@supp.test" }]);

  const summary = await bank.depositProspects({
    rows: store.rows("ghost_agency_prospects"),
    depositedBy: "pick_surplus",
    sourceBatchId: "line_batch_a",
    now: NOW,
    deps: depsFor(store),
  });

  assert.deepEqual(summary.deposited, ["good_1"]);
  const reasons = Object.fromEntries(summary.skipped.map((skip) => [skip.prospectId, skip.reason]));
  assert.equal(reasons.no_receipt, "receipt_missing");
  assert.equal(reasons.burned_1, "already_built_or_sent");
  assert.equal(reasons.supp_1, "suppressed");
});

test("surplus deposit banks a qualified row and records its bank dimension", async () => {
  const store = new MemoryStore();
  store.seed("ghost_agency_prospects", [
    bankedRow({ prospect_id: "s1", email: "a@s1.test", phone: "+15125550001", current_website: "https://s1.test" }),
    bankedRow({
      prospect_id: "s2",
      email: "b@s2.test",
      phone: "+15125550002",
      current_website: "https://s2.test",
      business_name: "Sister Site",
      record: { business_name: "Sister Site", current_website: "https://s2-shared.test" },
    }),
  ]);

  const summary = await bank.depositProspects({
    rows: store.rows("ghost_agency_prospects"),
    depositedBy: "pick_surplus",
    sourceBatchId: "line_batch_a",
    now: NOW,
    deps: depsFor(store),
  });

  assert.deepEqual(summary.deposited, ["s1", "s2"]);
  const first = store.rows("ghost_agency_prospects").find((row) => row.prospect_id === "s1");
  assert.equal(first.record.prospect_bank.status, "banked");
  assert.equal(first.record.prospect_bank.vertical, "plumbing");
  assert.equal(first.record.prospect_bank.deposited_by, "pick_surplus");
  assert.equal(first.record.prospect_bank.source_batch_id, "line_batch_a");
  assert.equal(first.record.prospect_bank.receipt_expires_at, first.record.genie_content_certification.expires_at);
  assert.equal(first.status, "held");
  // second deposit of the same row is refused (first banker wins)
  const again = await bank.depositProspects({
    rows: store.rows("ghost_agency_prospects"),
    depositedBy: "pick_surplus",
    now: NOW,
    deps: depsFor(store),
  });
  assert.equal(again.deposited.length, 0);
  assert.ok(again.skipped.every((skip) => skip.reason === "already_banked"));
});

test("duplicate canonical domain within one deposit banks only the first row", async () => {
  const store = new MemoryStore();
  store.seed("ghost_agency_prospects", [
    bankedRow({ prospect_id: "d1", prospect__id: "d1", current_website: "https://same.test", email: "d1@same.test", phone: "+15125550011" }),
    bankedRow({ prospect_id: "d2", business_name: "Same Domain Two", current_website: "https://same.test", email: "d2@same.test", phone: "+15125550012" }),
  ]);
  const summary = await bank.depositProspects({
    rows: store.rows("ghost_agency_prospects"),
    depositedBy: "pick_surplus",
    now: NOW,
    deps: depsFor(store),
  });
  assert.deepEqual(summary.deposited, ["d1"]);
  assert.equal(summary.skipped.find((skip) => skip.prospectId === "d2").reason, "duplicate_identity_in_deposit");
});

test("halted batch releases its own reservations and banks its fresh mined rows", async () => {
  const store = new MemoryStore();
  const reserved = withBank(bankedRow({ prospect_id: "r1" }), "reserved", {
    reserved_by_batch: "line_halt_me",
    reserved_until: new Date(START_MS + TTL_MS).toISOString(),
  });
  const foreign = withBank(bankedRow({
    prospect_id: "r2",
    business_name: "Foreign Reserve",
    email: "r2@foreign.test",
    phone: "+15125550022",
    current_website: "https://foreign.test",
  }), "reserved", {
    reserved_by_batch: "line_other_campaign",
    reserved_until: new Date(START_MS + TTL_MS).toISOString(),
  });
  const fresh = bankedRow({
    prospect_id: "m1",
    business_name: "Fresh Mined",
    email: "m1@fresh.test",
    phone: "+15125550031",
    current_website: "https://fresh.test",
  });
  store.seed("ghost_agency_prospects", [reserved, foreign, fresh]);

  const summary = await bank.depositHaltedBatch({
    batch: {
      batchId: "line_halt_me",
      rows: [
        { prospectId: "r1", status: "picked" },
        { prospectId: "r2", status: "picked" },
        { prospectId: "m1", status: "qualified" },
        { prospectId: "gone", status: "gate_failed" },
      ],
    },
    now: NOW,
    deps: depsFor(store),
  });

  assert.equal(summary.released, 1);
  assert.equal(summary.deposited, 1);
  const rows = store.rows("ghost_agency_prospects");
  assert.equal(rows.find((row) => row.prospect_id === "r1").record.prospect_bank.status, "banked");
  assert.equal(rows.find((row) => row.prospect_id === "r2").record.prospect_bank.status, "reserved",
    "another campaign's reservation is never stolen");
  assert.equal(rows.find((row) => row.prospect_id === "m1").record.prospect_bank.status, "banked");
});

// ---------------------------------------------------------------------------
// Draws
// ---------------------------------------------------------------------------

test("bank-first draw hits, reserves with TTL, and reuses a valid receipt free", async () => {
  const store = new MemoryStore();
  const row = withBank(bankedRow({ prospect_id: "b1" }), "banked");
  store.seed("ghost_agency_prospects", [
    row,
    withBank(bankedRow({
      prospect_id: "hvac_1",
      business_name: "HVAC Banked",
      industry: "hvac",
      vertical: "hvac",
      email: "h@hvac.test",
      phone: "+15125550041",
      current_website: "https://hvac.test",
    }), "banked"),
  ]);
  const compileCalls = [];
  const draw = await bank.drawForCampaign({
    vertical: "plumbing",
    city: "Austin",
    lane: "live",
    count: 2,
    batchId: "line_draw_1",
    now: NOW,
    deps: depsFor(store, {
      compile: async (compileRow) => {
        compileCalls.push(compileRow.prospect_id);
        return { ok: true, row: compileRow, certified: true, reused: true };
      },
    }),
  });

  assert.equal(draw.drawn.length, 1, "vertical filter admits only the plumbing row");
  assert.equal(draw.drawn[0].prospectId, "b1");
  assert.equal(draw.drawn[0].fromBank, true);
  assert.equal(draw.drawn[0].genieContentCertified, true);
  assert.deepEqual(compileCalls, ["b1"], "valid receipt requalifies through the compile seam");
  const stored = store.rows("ghost_agency_prospects").find((candidate) => candidate.prospect_id === "b1");
  assert.equal(stored.record.prospect_bank.status, "reserved");
  assert.equal(stored.record.prospect_bank.reserved_by_batch, "line_draw_1");
  assert.equal(Date.parse(stored.record.prospect_bank.reserved_until), START_MS + TTL_MS);
});

test("expired reservation is released back to banked by the draw sweep", async () => {
  const store = new MemoryStore();
  store.seed("ghost_agency_prospects", [
    withBank(bankedRow({ prospect_id: "stale_1" }), "reserved", {
      reserved_by_batch: "line_dead_batch",
      reserved_until: new Date(START_MS - 1000).toISOString(),
    }),
  ]);
  const draw = await bank.drawForCampaign({
    vertical: "plumbing",
    lane: "live",
    count: 1,
    batchId: "line_draw_2",
    now: NOW,
    deps: depsFor(store),
  });
  assert.equal(draw.released, 1);
  assert.equal(draw.drawn.length, 1, "the released row is immediately drawable");
  const stored = store.rows("ghost_agency_prospects")[0];
  assert.equal(stored.record.prospect_bank.status, "reserved");
  assert.equal(stored.record.prospect_bank.reserved_by_batch, "line_draw_2");
});

test("double-draw is atomic: the CAS loser does not seat the same candidate", async () => {
  const store = new MemoryStore();
  store.seed("ghost_agency_prospects", [withBank(bankedRow({ prospect_id: "race_1" }), "banked")]);

  // Simulate the real TOCTOU window: both campaigns read the SAME banked
  // snapshot (select frozen), then both attempt the guarded reservation
  // against the live store — the second PATCH must miss the guard.
  const frozenRead = structuredClone(store.rows("ghost_agency_prospects"));
  const frozenSelect = async (table, query = "") => {
    if (table === "ghost_agency_suppressions") return { ok: true, data: [] };
    const params = new Map();
    for (const part of String(query).replace(/^\?/, "").split("&")) {
      const eq = part.indexOf("=");
      if (eq > 0) params.set(part.slice(0, eq), part.slice(eq + 1));
    }
    let rows = structuredClone(frozenRead);
    for (const [key, value] of params.entries()) {
      if (["select", "order", "limit", "offset"].includes(key)) continue;
      rows = rows.filter((row) => filterMatches(row, key, value));
    }
    return { ok: true, data: rows };
  };
  const deps = {
    select: frozenSelect,
    conditionalUpdate: (table, idColumn, idValue, guards, patch) =>
      store.conditionalUpdate(table, idColumn, idValue, guards, patch),
    compile: async (row) => ({ ok: true, row, certified: true, reused: true }),
    readPracticeHistory: async () => ({ ok: true, keys: new Set() }),
  };

  const first = await bank.drawForCampaign({
    vertical: "plumbing", lane: "live", count: 1, batchId: "line_a", now: NOW, deps,
  });
  const second = await bank.drawForCampaign({
    vertical: "plumbing", lane: "live", count: 1, batchId: "line_b", now: NOW, deps,
  });

  assert.equal(first.drawn.length, 1);
  assert.equal(second.drawn.length, 0, "the loser of the reservation race draws nothing");
  assert.ok(second.skipped.some((skip) => skip.reason === "reservation_lost"),
    "the loser is named: the reservation CAS missed");
  const stored = store.rows("ghost_agency_prospects")[0];
  assert.equal(stored.record.prospect_bank.reserved_by_batch, "line_a");
  assert.equal(stored.record.prospect_bank.status, "reserved");
});

test("stale receipt recompiles at draw; valid receipt never pays a compile", async () => {
  const store = new MemoryStore();
  store.seed("ghost_agency_prospects", [
    withBank(bankedRow({
      prospect_id: "fresh_receipt",
      receiptExpiresAt: new Date(START_MS + 86_400_000).toISOString(),
    }), "banked"),
    withBank(bankedRow({
      prospect_id: "stale_receipt",
      business_name: "Stale Receipt Co",
      email: "stale@stale.test",
      phone: "+15125550051",
      current_website: "https://stale.test",
      receiptExpiresAt: new Date(START_MS - 86_400_000).toISOString(),
    }), "banked"),
  ]);
  const compiled = [];
  const draw = await bank.drawForCampaign({
    vertical: "plumbing", lane: "live", count: 2, batchId: "line_draw_3", now: NOW,
    deps: depsFor(store, {
      compile: async (row) => {
        compiled.push(row.prospect_id);
        return { ok: true, row: { ...row, record: { ...row.record, recompiled: true } }, certified: true };
      },
    }),
  });
  assert.equal(draw.drawn.length, 2);
  assert.deepEqual(compiled.sort(), ["fresh_receipt", "stale_receipt"],
    "both ride the compile seam (which verifies the receipt first — the seam is the expiry gate)");
  assert.equal(draw.drawn.find((line) => line.prospectId === "stale_receipt").fromBank, true);
});

test("suppressed and prior-history banked rows are excluded and marked exhausted", async () => {
  const store = new MemoryStore();
  store.seed("ghost_agency_suppressions", [{ suppression_key: "+15125550100" }]);
  store.seed("ghost_agency_prospects", [
    withBank(bankedRow({ prospect_id: "sup_1" }), "banked"),
    withBank(bankedRow({
      prospect_id: "hist_1",
      business_name: "Prior History Co",
      email: "hist@prior.test",
      phone: "+15125550061",
      current_website: "https://prior.test",
    }), "banked"),
    withBank(bankedRow({
      prospect_id: "clean_1",
      business_name: "Clean Co",
      email: "clean@clean.test",
      phone: "+15125550062",
      current_website: "https://clean.test",
    }), "banked"),
  ]);

  const historyKeys = new Set(["prospect:hist_1"]);
  const draw = await bank.drawForCampaign({
    vertical: "plumbing", lane: "sandbox", count: 3, batchId: "line_draw_4", now: NOW,
    deps: depsFor(store, {
      readPracticeHistory: async () => ({ ok: true, keys: historyKeys }),
    }),
  });

  assert.equal(draw.drawn.length, 1);
  assert.equal(draw.drawn[0].prospectId, "clean_1");
  assert.ok(draw.skipped.some((skip) => skip.prospectId === "sup_1" && skip.reason === "suppressed"));
  assert.ok(draw.skipped.some((skip) => skip.prospectId === "hist_1" && skip.reason === "practice_identity_in_prior_history"));
  const rows = store.rows("ghost_agency_prospects");
  assert.equal(rows.find((row) => row.prospect_id === "sup_1").record.prospect_bank.status, "exhausted");
  assert.equal(rows.find((row) => row.prospect_id === "hist_1").record.prospect_bank.status, "exhausted");
});

test("burned (built/sent) banked rows are exhausted by the sweep, never drawn", async () => {
  const store = new MemoryStore();
  store.seed("ghost_agency_prospects", [
    {
      ...withBank(bankedRow({ prospect_id: "built_1" }), "banked"),
      preview_url: "https://preview.test/built_1",
    },
  ]);
  const draw = await bank.drawForCampaign({
    vertical: "plumbing", lane: "live", count: 1, batchId: "line_draw_5", now: NOW,
    deps: depsFor(store),
  });
  assert.equal(draw.drawn.length, 0);
  assert.equal(draw.exhausted, 1);
  assert.equal(store.rows("ghost_agency_prospects")[0].record.prospect_bank.status, "exhausted");
});

// ---------------------------------------------------------------------------
// Cron filler
// ---------------------------------------------------------------------------

test("daily-mining filler banks up to the per-vertical target and no further", async () => {
  const store = new MemoryStore();
  const already = [];
  for (let index = 0; index < 3; index += 1) {
    already.push(withBank(bankedRow({
      prospect_id: `banked_plumb_${index}`,
      email: `bp${index}@bp.test`,
      phone: `+15125550${100 + index}`,
      current_website: `https://bp${index}.test`,
    }), "banked"));
  }
  const fresh = [];
  for (let index = 0; index < 5; index += 1) {
    fresh.push(bankedRow({
      prospect_id: `new_plumb_${index}`,
      business_name: `New Plumbing ${index}`,
      email: `np${index}@np.test`,
      phone: `+15125550${200 + index}`,
      current_website: `https://np${index}.test`,
    }));
  }
  store.seed("ghost_agency_prospects", [...already, ...fresh]);

  const summary = await bank.fillBankFromMining({
    minedResult: { ok: true, rows: fresh.map((row) => ({ prospect_id: row.prospect_id, persistence: "created" })) },
    now: NOW,
    environment: { GHOST_AGENCY_BANK_TARGET_PER_VERTICAL: "5" },
    deps: depsFor(store),
  });

  assert.equal(summary.targetPerVertical, 5);
  assert.equal(summary.deposited, 2, "3 banked + 2 new = target 5; the rest stay unbanked");
  const statuses = store.rows("ghost_agency_prospects")
    .filter((row) => row.prospect_id.startsWith("new_plumb_"))
    .map((row) => row.record.prospect_bank?.status || "unbanked");
  assert.equal(statuses.filter((status) => status === "banked").length, 2);
  assert.equal(statuses.filter((status) => status === "unbanked").length, 3);
});

test("filler compiles receipt-less mined rows before depositing", async () => {
  const store = new MemoryStore();
  const candidate = bankedRow({
    prospect_id: "fill_compile",
    receipt: null,
    email: "fc@fc.test",
    phone: "+15125550301",
    current_website: "https://fc.test",
  });
  store.seed("ghost_agency_prospects", [candidate]);
  const compiledRows = [];
  const summary = await bank.fillBankFromMining({
    minedResult: { ok: true, rows: [{ prospect_id: "fill_compile", persistence: "created" }] },
    now: NOW,
    deps: depsFor(store, {
      compile: async (row) => {
        compiledRows.push(row.prospect_id);
        return {
          ok: true,
          row: {
            ...row,
            record: {
              ...row.record,
              genie_content_certification: {
                status: "certified",
                expires_at: new Date(START_MS + 86_400_000).toISOString(),
              },
            },
          },
          certified: true,
        };
      },
    }),
  });
  assert.deepEqual(compiledRows, ["fill_compile"]);
  assert.equal(summary.compiled, 1);
  assert.equal(summary.deposited, 1);
  assert.equal(store.rows("ghost_agency_prospects")[0].record.prospect_bank.status, "banked");
});

test("bank kill switch disables deposits, draws, and the filler", async () => {
  const store = new MemoryStore();
  store.seed("ghost_agency_prospects", [bankedRow({ prospect_id: "off_1" })]);
  const environment = { GHOST_AGENCY_BANK_DISABLED: "1" };

  const deposit = await bank.depositProspects({
    rows: store.rows("ghost_agency_prospects"), depositedBy: "pick_surplus", now: NOW, environment,
    deps: depsFor(store),
  });
  assert.equal(deposit.disabled, true);
  assert.equal(deposit.deposited.length, 0);

  const draw = await bank.drawForCampaign({
    vertical: "plumbing", lane: "live", count: 1, now: NOW, environment, deps: depsFor(store),
  });
  assert.equal(draw.drawn.length, 0);

  const fill = await bank.fillBankFromMining({
    minedResult: { ok: true, rows: [{ prospect_id: "off_1", persistence: "created" }] },
    now: NOW, environment, deps: depsFor(store),
  });
  assert.equal(fill.disabled, true);
});

// ---------------------------------------------------------------------------
// Funnel stage helpers
// ---------------------------------------------------------------------------

test("bank_draw funnel stage reports drawn vs requested with named skips", () => {
  const stage = bank.bankDrawFunnelStage(
    { drawn: [{}, {}], skipped: [{ prospectId: "x", reason: "suppressed" }], released: 2 },
    { requested: 3 },
  );
  assert.equal(stage.stage, "bank_draw");
  assert.equal(stage.entered, 3);
  assert.equal(stage.survived, 2);
  assert.equal(stage.rejected.suppressed, 1);
  assert.equal(stage.reservations_released, 2);

  const funnel = bank.withBankDrawStage([{ stage: quota.QUOTA_CONTRACT_STAGE }], stage);
  assert.equal(funnel[0].stage, "bank_draw");
  assert.equal(funnel[1].stage, quota.QUOTA_CONTRACT_STAGE);
  const replaced = bank.withBankDrawStage(funnel, { ...stage, survived: 1 });
  assert.equal(replaced.filter((row) => row.stage === "bank_draw").length, 1);
});

test("drawSpecForBatch maps named-market and all-trades campaign targets", () => {
  assert.deepEqual(bank.drawSpecForBatch({ target: "plumbing in Austin, TX" }), { vertical: "plumbing", city: "Austin, TX" });
  assert.deepEqual(bank.drawSpecForBatch({ target: "all trades nationwide" }), { vertical: "", city: "" });
  assert.equal(bank.normalizedVertical("Hair Salon"), "salon");
});

// ---------------------------------------------------------------------------
// Campaign-start integration: draw banked-first, mine only the deficit
// ---------------------------------------------------------------------------

class MemoryPersistence {
  constructor() {
    this.batches = new Map();
    this.rows = new Map();
  }

  seed(batch, rows = []) {
    const saved = {
      batchId: batch.batchId,
      lane: batch.lane || "live",
      target: batch.target || "plumbing in Austin, TX",
      requested: batch.requested == null ? rows.length : batch.requested,
      status: batch.status || "building",
      pickState: batch.pickState || "pending",
      mineFunnel: batch.mineFunnel || [{ stage: quota.QUOTA_CONTRACT_STAGE, entered: batch.requested || 0 }],
      haltReason: "",
      version: batch.version || 0,
      startedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
      settledAt: null,
      approval: null,
    };
    this.batches.set(saved.batchId, saved);
    rows.forEach((input, index) => {
      this.rows.set(`${saved.batchId}:${index}`, {
        ...input,
        rowId: `${saved.batchId}:${index}`,
        batchId: saved.batchId,
        rowIndex: index,
        status: input.status || "picked",
        version: 0,
        updatedAt: NOW,
        leaseToken: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        attemptCount: 0,
      });
    });
    return this.currentBatch(saved.batchId);
  }

  currentBatch(batchId) {
    const batch = this.batches.get(batchId);
    if (!batch) return null;
    const rows = [...this.rows.values()]
      .filter((row) => row.batchId === batchId)
      .sort((left, right) => left.rowIndex - right.rowIndex)
      .map((row) => structuredClone(row));
    return { ...structuredClone(batch), rows };
  }

  async loadBatch(batchId) {
    const batch = this.currentBatch(batchId);
    return batch ? { ok: true, batch } : { ok: false, error: "batch_not_found" };
  }

  async storeBatch({ batchId, expectedVersion, expectedStatus, patch }) {
    const current = this.batches.get(batchId);
    if (!current || current.version !== expectedVersion
      || (expectedStatus && current.status !== expectedStatus)) {
      return { ok: false, conflict: true, error: "batch_version_conflict" };
    }
    const next = { ...current, ...structuredClone(patch), version: current.version + 1, updatedAt: NOW };
    this.batches.set(batchId, next);
    return { ok: true, updated: true, batch: this.currentBatch(batchId) };
  }

  async storeRows({ batchId, rows }) {
    if (!this.batches.has(batchId)) return { ok: false, error: "batch_not_found" };
    let created = 0;
    rows.forEach((input, index) => {
      const rowId = input.rowId || `${batchId}:${input.rowIndex == null ? this.rows.size : input.rowIndex}`;
      if (this.rows.has(rowId)) return;
      this.rows.set(rowId, {
        ...structuredClone(input),
        rowId,
        batchId,
        version: 0,
        status: input.status || "picked",
        updatedAt: NOW,
        leaseToken: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        attemptCount: 0,
      });
      created += 1;
    });
    return { ok: true, created, rows: this.currentBatch(batchId).rows };
  }

  async claimRows({ batchId, limit = 1, statuses }) {
    const wanted = new Set(statuses && statuses.length ? statuses : ["picked", "qualified", "mirrored", "gate_passed"]);
    const eligible = [...this.rows.values()]
      .filter((row) => row.batchId === batchId && wanted.has(row.status))
      .sort((left, right) => left.rowIndex - right.rowIndex)
      .slice(0, limit);
    let serial = 0;
    return {
      ok: true,
      rows: eligible.map((current) => {
        const next = {
          ...current,
          version: current.version + 1,
          leaseToken: `lease-${++serial}`,
          leaseOwner: "worker-bank-test",
          leaseExpiresAt: new Date(START_MS + 240_000).toISOString(),
          attemptCount: current.attemptCount + 1,
          updatedAt: NOW,
        };
        this.rows.set(next.rowId, next);
        return structuredClone(next);
      }),
    };
  }

  async checkpointRow({ rowId, leaseToken, expectedVersion, row }) {
    const current = this.rows.get(rowId);
    if (!current || current.version !== expectedVersion || current.leaseToken !== leaseToken) {
      return { ok: false, conflict: true, error: "row_checkpoint_conflict" };
    }
    const next = {
      ...structuredClone(row),
      rowId: current.rowId,
      batchId: current.batchId,
      rowIndex: current.rowIndex,
      prospectId: current.prospectId,
      version: current.version + 1,
      leaseToken: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      attemptCount: current.attemptCount,
      updatedAt: NOW,
    };
    this.rows.set(rowId, next);
    return { ok: true, updated: true, row: structuredClone(next) };
  }

  async listBatches() {
    return { ok: true, batches: [...this.batches.values()].map((batch) => this.currentBatch(batch.batchId)) };
  }
}

function integrationHarness({ bankStub, pick } = {}) {
  const persistence = new MemoryPersistence();
  const publications = [];
  const phaseCalls = [];
  const processRowPhase = async (row) => {
    phaseCalls.push(row.status);
    let outcome;
    if (row.status === "picked") outcome = { ok: true, row: { ...row, status: "qualified" } };
    else if (row.status === "qualified") outcome = { ok: true, row: { ...row, status: "mirrored" } };
    else if (row.status === "mirrored") {
      outcome = { ok: true, row: { ...row, status: "gate_passed", gate: { pass: true, failed: [] } } };
    } else if (row.status === "gate_passed") {
      outcome = { ok: true, row: { ...row, status: "queued", previewUrl: "https://preview.example.test" } };
    } else {
      return { ok: false, error: `unexpected_phase_${row.status}` };
    }
    return outcome;
  };
  const service = createLineContinuation({
    persistence,
    clock: () => START_MS,
    now: () => NOW,
    workerId: () => "worker-bank-test",
    rowClaim: 1,
    pickTimeoutMs: 1_000,
    pick: pick || (async (input) => {
      integrationHarness.pickCalls.push(input);
      return [];
    }),
    processRowPhase,
    enqueueLineMessage: async (message) => {
      publications.push(message);
      return { accepted: true, messageId: `msg-${publications.length}` };
    },
    bank: bankStub,
    rowFanout: false,
    inlinePickQualification: false,
  });
  integrationHarness.pickCalls = integrationHarness.pickCalls || [];
  return { service, persistence, publications, phaseCalls, pickCalls: integrationHarness.pickCalls };
}

test("campaign start draws banked-first and skips mining when the bank covers the quota", async () => {
  const drawCalls = [];
  const haltCalls = [];
  const bankStub = {
    ...bank,
    bankEnabled: () => true,
    drawSpecForBatch: (batch) => bank.drawSpecForBatch(batch),
    drawForCampaign: async (input) => {
      drawCalls.push(input);
      return {
        drawn: [
          {
            prospectId: "bank_p1",
            businessName: "Banked One",
            city: "Austin",
            state: "TX",
            vertical: "plumbing",
            email: "one@bank.test",
            genieContentCertified: true,
          },
          {
            prospectId: "bank_p2",
            businessName: "Banked Two",
            city: "Austin",
            state: "TX",
            vertical: "plumbing",
            email: "two@bank.test",
            genieContentCertified: true,
          },
        ],
        quarantined: [],
        skipped: [],
        released: 0,
      };
    },
    bankDrawFunnelStage: (draw, options) => bank.bankDrawFunnelStage(draw, options),
    withBankDrawStage: (funnel, stage) => bank.withBankDrawStage(funnel, stage),
    depositHaltedBatch: async (input) => {
      haltCalls.push(input);
      return { deposited: 0, released: 0, skipped: 0 };
    },
  };
  const h = integrationHarness({ bankStub });
  h.persistence.seed({ batchId: "line_bank_full", requested: 2, target: "plumbing in Austin, TX" }, []);

  const result = await h.service.processLineMessage({ batchId: "line_bank_full", phase: "run", sequence: 0 });

  assert.equal(result.ok, true);
  assert.equal(result.selected, 2);
  assert.equal(result.bankDrawn, 2);
  assert.equal(h.pickCalls.length, 0, "no provider mining when the bank covers the quota");
  assert.equal(drawCalls.length, 1);
  assert.equal(drawCalls[0].count, 2);
  assert.equal(drawCalls[0].vertical, "plumbing");
  const stored = h.persistence.currentBatch("line_bank_full");
  assert.deepEqual(stored.rows.map((row) => row.prospectId), ["bank_p1", "bank_p2"]);
  assert.equal(stored.rows.every((row) => row.status === "picked"), true);
  const bankStage = (stored.mineFunnel || []).find((row) => row.stage === "bank_draw");
  assert.equal(bankStage.survived, 2);
  assert.equal(bankStage.entered, 2);
});

test("partial bank draw seats rows first and the miner covers only the deficit", async () => {
  const bankStub = {
    ...bank,
    bankEnabled: () => true,
    drawForCampaign: async () => ({
      drawn: [
        {
          prospectId: "bank_p1",
          businessName: "Banked One",
          city: "Austin",
          state: "TX",
          vertical: "plumbing",
          email: "one@bank.test",
          genieContentCertified: true,
        },
      ],
      quarantined: [],
      skipped: [],
      released: 0,
    }),
    depositHaltedBatch: async () => ({ deposited: 0, released: 0, skipped: 0 }),
  };
  const h = integrationHarness({
    bankStub,
    pick: async (input) => {
      integrationHarness.pickCalls.push(input);
      return [{
        prospectId: "mined_p1",
        businessName: "Mined One",
        city: "Austin",
        state: "TX",
        vertical: "plumbing",
        email: "mined@one.test",
      }];
    },
  });
  h.persistence.seed({ batchId: "line_bank_partial", requested: 2, target: "plumbing in Austin, TX" }, []);

  const result = await h.service.processLineMessage({ batchId: "line_bank_partial", phase: "run", sequence: 0 });

  assert.equal(result.ok, true);
  assert.equal(result.bankDrawn, 1);
  assert.equal(result.selected, 1, "mined exactly the one-site deficit");
  assert.equal(h.pickCalls.length, 1);
  assert.equal(h.pickCalls[0].count, 1, "the mining pick asked for the deficit only");
  assert.ok(h.pickCalls[0].excludeProspectIds.includes("bank_p1"),
    "the drawn row is excluded from the mining pick");
  const stored = h.persistence.currentBatch("line_bank_partial");
  assert.deepEqual(stored.rows.map((row) => row.prospectId).sort(), ["bank_p1", "mined_p1"]);
  const bankStage = (stored.mineFunnel || []).find((row) => row.stage === "bank_draw");
  assert.equal(bankStage.survived, 1);
});

test("a halted campaign deposits its seated rows back through the bank", async () => {
  const haltDeposits = [];
  const bankStub = {
    ...bank,
    bankEnabled: () => true,
    drawForCampaign: async () => ({ drawn: [], quarantined: [], skipped: [], released: 0 }),
    depositHaltedBatch: async (input) => {
      haltDeposits.push(input);
      return { deposited: 0, released: 1, skipped: 0 };
    },
  };
  const h = integrationHarness({
    bankStub,
    pick: async () => {
      const out = [];
      out.sourceExhausted = { exhausted: true, reason: "operator_query_cycle_exhausted" };
      return out;
    },
  });
  // A source-exhausted batch with a seated row: runPick takes the exhausted
  // halt path, and releaseBatch("halted") must hand the row back to the bank.
  h.persistence.seed(
    {
      batchId: "line_bank_exhausted",
      requested: 2,
      target: "plumbing in Austin, TX",
      mineFunnel: [
        { stage: quota.QUOTA_CONTRACT_STAGE, entered: 2 },
      ],
    },
    [{ prospectId: "seat_2", businessName: "Seated Two", status: "picked" }],
  );
  const result = await h.service.processLineMessage({ batchId: "line_bank_exhausted", phase: "run", sequence: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.status, "halted", "source-exhausted quota halt settled the batch");
  assert.equal(haltDeposits.length, 1);
  assert.equal(haltDeposits[0].batch.batchId, "line_bank_exhausted");
  assert.ok(haltDeposits[0].batch.rows.some((row) => row.prospectId === "seat_2"));
});

// ---------------------------------------------------------------------------
// Adapter surplus seam + gallery reporting
// ---------------------------------------------------------------------------

test("pickProspects hands compiled surplus to the bank deposit seam instead of dropping it", async () => {
  const { pickProspects } = require("../lib/line-adapters");
  const buildable = (id, name, withReceipt) => ({
    prospect_id: id,
    business_name: name,
    city: "Austin",
    state: "TX",
    industry: "plumbing",
    status: "new",
    preview_url: "",
    record: {
      ...(withReceipt ? {
        genie_content_certification: {
          status: "certified",
          expires_at: new Date(START_MS + 86_400_000).toISOString(),
        },
      } : {}),
      build_ready: {
        proof: { build_hash: `hash-${id}` },
        qualification: {
          website_axis: { score: 40 },
          composite_signal: { score: 40 },
        },
        brand_evidence: {},
        mirror_request: {
          facts: { business_name: name, industry: "plumbing", city: "Austin", state: "TX" },
        },
      },
    },
  });
  const surplusCalls = [];
  const picked = await pickProspects({ target: "", count: 1 }, {
    selectRows: async () => ({
      rows: [
        buildable("surplus_1", "Surplus One Plumbing", true),
        buildable("surplus_2", "Surplus Two Plumbing", true),
        buildable("surplus_3", "Surplus Three Plumbing", false),
      ],
    }),
    bankDepositSurplus: async (rows) => {
      surplusCalls.push(rows);
    },
  });
  assert.equal(picked.length, 1);
  assert.equal(surplusCalls.length, 1, "the surplus beyond count is handed to the bank exactly once");
  assert.deepEqual(
    surplusCalls[0].map((row) => row.prospect_id).sort(),
    ["surplus_2", "surplus_3"],
    "the seam forwards STORE rows; depositProspects itself refuses the receipt-less one",
  );
});

test("reservation TTL and per-vertical target read their env contracts", () => {
  assert.equal(bank.reservationTtlMs({}), bank.DEFAULT_RESERVATION_TTL_MS);
  assert.equal(bank.reservationTtlMs({ GHOST_AGENCY_BANK_RESERVATION_TTL_MS: "3600000" }), 3_600_000);
  assert.equal(bank.reservationTtlMs({ GHOST_AGENCY_BANK_RESERVATION_TTL_MS: "10" }), bank.DEFAULT_RESERVATION_TTL_MS,
    "a sub-minute TTL is refused — reservations must outlive a worker pass");
  assert.equal(bank.targetPerVertical({}), bank.DEFAULT_TARGET_PER_VERTICAL);
  assert.equal(bank.targetPerVertical({ GHOST_AGENCY_BANK_TARGET_PER_VERTICAL: "40" }), 40);
});

test("gallery data exposes the read-only per-vertical bank census", async (t) => {
  const { createGalleryDataHandler } = require("../api/admin/gallery-data");
  const priorToken = process.env.GHOST_AGENCY_ADMIN_TOKEN;
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "bank-gallery-token";
  t.after(() => {
    if (priorToken === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
    else process.env.GHOST_AGENCY_ADMIN_TOKEN = priorToken;
  });

  const prospects = [{
    prospect_id: "g-1",
    owner_email: "g@private.test",
    status: "built",
    updated_at: "2026-09-01T00:00:00.000Z",
    business_name: "Gallery Plumbing",
    city: "Tulsa",
    state: "OK",
    industry: "plumbing",
    preview_url: "https://gallery-preview.wss-ai.com",
  }];
  const handler = createGalleryDataHandler({
    select: async (table) => {
      if (table === "ghost_agency_prospects") return { ok: true, data: prospects };
      if (table === "ghost_agency_dashboard_access") return { ok: true, data: [] };
      return { ok: true, data: [] };
    },
    signedVisualPath: () => "/api/admin/proof-shot?preview=x",
    bankCountsByVertical: async () => ({
      ok: true,
      byVertical: { plumbing: 7, hvac: 3 },
      total: 10,
    }),
  });

  const res = {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    end(payload = "") { this.body = payload ? JSON.parse(payload) : null; },
  };
  await handler({
    method: "GET",
    url: "/api/admin/gallery-data",
    headers: { "x-admin-token": "bank-gallery-token" },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.bank, { byVertical: { plumbing: 7, hvac: 3 }, total: 10 });
  assert.equal(res.body.sources.bankRead, true);
});
