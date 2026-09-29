"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const paydirt = require("../lib/prospect-sources/paydirt");
const quota = require("../lib/line-quota");
const { pickProspects } = require("../lib/line-adapters");
const {
  RECOGNIZED_START_TARGETS,
  recognizedStartTarget,
} = require("../api/admin/line");

// A canonical pre-paired PayDirt row: the /api/search normalized shape
// (business mode, licensed-provider email append, public-record identity).
function prepairedLead(overrides = {}) {
  return {
    name: "Marquez Roofing LLC",
    role: "owner",
    phone: "(512) 555-0142",
    email: "office@marquezroofing.com",
    addr: "4812 Mesa Dr, Austin, TX 78731",
    city: "Austin",
    state: "TX",
    postalCode: "78731",
    desc: "ROOFING - RESHINGLE RESIDENCE",
    date: "2026-08-30",
    val: 42000,
    src: "Austin permit SP-2026-8811",
    provider: "socrata",
    officialSource: "https://data.austintexas.gov/resource/3syk-w9eu.json",
    sourceUrl: "https://data.austintexas.gov/resource/3syk-w9eu.json?$limit=1",
    score: 82,
    fit: "DIRECT",
    matchStatus: "DIRECT",
    mode: "property",
    trade: "roofing",
    leadId: "lead_abc123",
    sourceFingerprint: "a".repeat(64),
    sourceRecordId: "SP-2026-8811",
    sourceProvider: "socrata",
    retrievedAt: "2026-09-02T10:00:00.000Z",
    ...overrides,
  };
}

function tempFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paydirt-wss-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content, "utf8");
  return file;
}

// ---------------------------------------------------------------------------
// Mapper — PayDirt lead shape -> WSS prospect row (store shape)
// ---------------------------------------------------------------------------

test("a pre-paired PayDirt lead maps to a bankable prospect row with full provenance", () => {
  const mapped = paydirt.mapPaydirtLead(prepairedLead());
  assert.equal(mapped.ok, true);
  const row = mapped.row;
  assert.ok(row.prospect_id.startsWith("paydirt_"), `prospect_id must be paydirt-prefixed, got ${row.prospect_id}`);
  assert.match(row.prospect_id, /^[A-Za-z0-9][A-Za-z0-9_-]*$/);
  assert.equal(row.business_name, "Marquez Roofing LLC");
  assert.equal(row.phone, "(512) 555-0142");
  assert.equal(row.email, "office@marquezroofing.com");
  assert.equal(row.city, "Austin");
  assert.equal(row.state, "TX");
  assert.equal(row.source, "paydirt");
  assert.equal(row.record.source, "paydirt");
  assert.equal(row.record.truth_packet_source, "paydirt_prepaired");
  assert.equal(row.leadminer_score, 82);
  // PayDirt eligibility/score rides as provenance, not a gate.
  assert.equal(row.record.paydirt.score, 82);
  assert.equal(row.record.paydirt.eligibility, true);
  assert.equal(row.record.paydirt.prepaired, true);
  assert.equal(row.record.paydirt.provider, "socrata");
  assert.equal(row.record.paydirt.sourceRecordId, "SP-2026-8811");
  assert.equal(row.record.paydirt.sourceFingerprint, "a".repeat(64));
  assert.ok(Array.isArray(row.record.identity.keys) && row.record.identity.keys.length > 0,
    "identity keys must be minted for the store's dedupe domain");
  // The packet basics the pick lane's build gates read.
  assert.equal(row.record.truth_packet.mirror_ready.business_name, "Marquez Roofing LLC");
  assert.equal(row.record.truth_packet.mirror_ready.city, "Austin");
  assert.equal(row.record.truth_packet.mirror_ready.state, "TX");
});

test("industry derives from PayDirt's trade token and permit text", () => {
  const mapped = paydirt.mapPaydirtLead(prepairedLead({ trade: "roofing" }));
  assert.equal(mapped.row.industry, "roofing");
  const fromDesc = paydirt.mapPaydirtLead(prepairedLead({ trade: "", desc: "HVAC REPLACEMENT - RESIDENCE" }));
  assert.equal(fromDesc.row.industry, "hvac");
});

test("a lead without email is admitted degraded — delivery hold rides downstream, per bank law", () => {
  const mapped = paydirt.mapPaydirtLead(prepairedLead({ email: null }));
  assert.equal(mapped.ok, true);
  assert.equal(mapped.row.email, null);
  assert.equal(mapped.row.record.paydirt.prepaired, true, "phone still makes it pre-paired");
});

test("a lead with neither phone nor website is refused (bank NAP reach law)", () => {
  const mapped = paydirt.mapPaydirtLead(prepairedLead({ phone: null }));
  assert.equal(mapped.ok, false);
  assert.equal(mapped.reason, "paydirt_lead_reach_missing");
});

test("a website-only lead still satisfies reach and is admitted", () => {
  const mapped = paydirt.mapPaydirtLead(prepairedLead({ phone: null, website: "https://marquezroofing.com" }));
  assert.equal(mapped.ok, true);
  assert.equal(mapped.row.phone, null);
  assert.equal(mapped.row.current_website, "https://marquezroofing.com");
});

test("a lead with no location at all is refused (bank NAP place law)", () => {
  const mapped = paydirt.mapPaydirtLead(prepairedLead({ city: "", state: "", addr: "no city here" }));
  assert.equal(mapped.ok, false);
  assert.equal(mapped.reason, "paydirt_lead_location_missing");
});

test("a nameless lead is refused loudly", () => {
  const mapped = paydirt.mapPaydirtLead(prepairedLead({ name: "", desc: "permit 123" }));
  assert.equal(mapped.ok, false);
  assert.equal(mapped.reason, "paydirt_lead_name_missing");
});

test("city and state derive from the address when the fields are absent", () => {
  const mapped = paydirt.mapPaydirtLead(prepairedLead({ city: "", state: "" }));
  assert.equal(mapped.row.city, "Austin");
  assert.equal(mapped.row.state, "TX");
});

test("a below-eligibility score is admitted with eligibility:false — provenance, not a gate", () => {
  const mapped = paydirt.mapPaydirtLead(prepairedLead({ score: 30 }));
  assert.equal(mapped.ok, true);
  assert.equal(mapped.row.record.paydirt.eligibility, false);
  assert.equal(mapped.row.record.paydirt.band, "LONG");
});

test("prospect ids are deterministic and fingerprint-distinct", () => {
  const first = paydirt.mapPaydirtLead(prepairedLead());
  const second = paydirt.mapPaydirtLead(prepairedLead());
  const other = paydirt.mapPaydirtLead(prepairedLead({ sourceFingerprint: "b".repeat(64) }));
  assert.equal(first.row.prospect_id, second.row.prospect_id);
  assert.notEqual(first.row.prospect_id, other.row.prospect_id);
});

// ---------------------------------------------------------------------------
// Mode selection (env law)
// ---------------------------------------------------------------------------

test("no PayDirt env at all resolves to a loud not_configured", async () => {
  const read = await paydirt.readPaydirtLeads({ environment: {}, count: 5 });
  assert.equal(read.ok, false);
  assert.equal(read.status, "not_configured");
  assert.equal(read.reason, "paydirt_source_not_configured");
});

test("explicit export mode without a file is not_configured", async () => {
  const read = await paydirt.readPaydirtLeads({ environment: { PAYDIRT_SOURCE: "export" }, count: 5 });
  assert.equal(read.ok, false);
  assert.equal(read.status, "not_configured");
  assert.equal(read.reason, "paydirt_export_file_missing");
});

test("an export file implies export mode even without PAYDIRT_SOURCE", () => {
  assert.equal(paydirt.resolvePaydirtMode({ PAYDIRT_EXPORT_FILE: "C:/tmp/paydirt.json" }).mode, "export");
  assert.equal(paydirt.resolvePaydirtMode({ PAYDIRT_SOURCE: "api" }).mode, "api");
  assert.equal(paydirt.resolvePaydirtMode({ PAYDIRT_SOURCE: "export" }).mode, "export");
  assert.equal(paydirt.resolvePaydirtMode({}).mode, "none");
});

// ---------------------------------------------------------------------------
// Export mode — JSON + CSV (the workspace's own export shapes)
// ---------------------------------------------------------------------------

test("export mode reads a JSON leads file", async () => {
  const file = tempFile("leads.json", JSON.stringify({ leads: [prepairedLead(), prepairedLead({ sourceFingerprint: "c".repeat(64), name: "Vega Solar Co" })] }));
  const read = await paydirt.readPaydirtLeads({ environment: { PAYDIRT_EXPORT_FILE: file }, count: 10 });
  assert.equal(read.ok, true);
  assert.equal(read.mode, "export");
  assert.equal(read.leads.length, 2);
});

test("export mode enforces PAYDIRT_WSS_QUOTA and reports the cap", async () => {
  const file = tempFile("leads.json", JSON.stringify([
    prepairedLead({ sourceFingerprint: "1".repeat(64) }),
    prepairedLead({ sourceFingerprint: "2".repeat(64) }),
    prepairedLead({ sourceFingerprint: "3".repeat(64) }),
  ]));
  const read = await paydirt.readPaydirtLeads({
    environment: { PAYDIRT_EXPORT_FILE: file, PAYDIRT_WSS_QUOTA: "2" },
    count: 10,
  });
  assert.equal(read.ok, true);
  assert.equal(read.leads.length, 2);
  assert.equal(read.cappedByQuota, true);
  assert.equal(read.readCount, 3);
});

test("export mode parses the workspace CSV including its compliance comment header", async () => {
  const csv = [
    "# PayDirt export — public government records. Scrub DNC before telemarketing calls to consumers.",
    "rank,source_type,band,score,name,role,phone,email,address,signal,filed,source,provider,source_url,why_scored",
    '1,property,HIGH,82,"Marquez Roofing LLC",owner,(512) 555-0142,,"4812 Mesa Dr, Austin, TX 78731","ROOFING - RESHINGLE",2026-08-30,"Austin permit SP-2026-8811",socrata,https://data.austintexas.gov/,why',
  ].join("\n");
  const rows = paydirt.parsePaydirtCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Marquez Roofing LLC");
  const mapped = paydirt.mapPaydirtLead(rows[0]);
  assert.equal(mapped.ok, true, JSON.stringify(rows[0]));
  assert.equal(mapped.row.city, "Austin");
  assert.equal(mapped.row.state, "TX");
  assert.equal(mapped.row.phone, "(512) 555-0142");
  assert.equal(mapped.row.record.paydirt.score, 82);
});

test("export mode reads a CSV file end to end", async () => {
  const file = tempFile("leads.csv", [
    "# compliance header",
    "rank,source_type,band,score,name,role,phone,email,address,signal,filed,source,provider,source_url,why_scored",
    '1,business,GOOD,55,"Vega Solar Co",business,https://x/,vega@solar.com,"9 Canyon Rd, Denver, CO 80202","NEW BUSINESS: Vega Solar Co",2026-08-01,"Colorado SOS filing 20261234567",socrata,https://data.colorado.gov/,why',
  ].join("\n"));
  const read = await paydirt.readPaydirtLeads({ environment: { PAYDIRT_EXPORT_FILE: file }, count: 5 });
  assert.equal(read.ok, true);
  assert.equal(read.leads.length, 1);
  const mapped = paydirt.mapPaydirtLead(read.leads[0]);
  assert.equal(mapped.ok, true);
  assert.equal(mapped.row.city, "Denver");
  assert.equal(mapped.row.state, "CO");
});

test("an unreadable export file is unavailable, never a throw", async () => {
  const read = await paydirt.readPaydirtLeads({ environment: { PAYDIRT_EXPORT_FILE: "C:/definitely/not/here.json" }, count: 5 });
  assert.equal(read.ok, false);
  assert.equal(read.status, "unavailable");
  assert.equal(read.reason, "paydirt_export_file_unreadable");
});

test("invalid JSON in the export file is unavailable with a named reason", async () => {
  const file = tempFile("broken.json", "{not json");
  const read = await paydirt.readPaydirtLeads({ environment: { PAYDIRT_EXPORT_FILE: file }, count: 5 });
  assert.equal(read.ok, false);
  assert.equal(read.reason, "paydirt_export_json_invalid");
});

// ---------------------------------------------------------------------------
// API mode — auth findings and honest statuses
// ---------------------------------------------------------------------------

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

test("api mode calls the deployed search endpoint with the query and optional bearer", async () => {
  let seenUrl = "";
  let seenAuth = "";
  const read = await paydirt.readPaydirtLeads({
    environment: {
      PAYDIRT_SOURCE: "api",
      PAYDIRT_API_TOKEN: "owner-session-token",
      PAYDIRT_API_CITY: "Austin",
      PAYDIRT_API_STATE: "TX",
      PAYDIRT_API_TRADE: "roofing",
    },
    count: 5,
    fetchImpl: async (url, options = {}) => {
      seenUrl = url;
      seenAuth = String(options.headers && options.headers.Authorization || "");
      return jsonResponse(200, { ok: true, rows: [prepairedLead()] });
    },
  });
  assert.equal(read.ok, true);
  assert.equal(read.mode, "api");
  assert.equal(read.leads.length, 1);
  assert.ok(seenUrl.startsWith("https://paydirt-seven.vercel.app/api/search?"), seenUrl);
  assert.ok(seenUrl.includes("city=Austin") && seenUrl.includes("state=TX") && seenUrl.includes("trade=roofing"), seenUrl);
  assert.equal(seenAuth, "Bearer owner-session-token");
});

test("api mode answers not_configured (loud) when the endpoint demands session auth", async () => {
  const read = await paydirt.readPaydirtLeads({
    environment: { PAYDIRT_SOURCE: "api" },
    count: 5,
    fetchImpl: async () => jsonResponse(401, { ok: false }),
  });
  assert.equal(read.ok, false);
  assert.equal(read.status, "not_configured");
  assert.equal(read.reason, "paydirt_api_auth_not_programmatic");
});

test("api mode timeouts and HTTP errors are unavailable, never a throw", async () => {
  const timeout = await paydirt.readPaydirtLeads({
    environment: { PAYDIRT_SOURCE: "api" },
    count: 5,
    fetchImpl: async () => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      throw error;
    },
  });
  assert.equal(timeout.ok, false);
  assert.equal(timeout.status, "unavailable");
  assert.equal(timeout.reason, "paydirt_api_timeout");

  const httpError = await paydirt.readPaydirtLeads({
    environment: { PAYDIRT_SOURCE: "api" },
    count: 5,
    fetchImpl: async () => jsonResponse(502, { ok: false }),
  });
  assert.equal(httpError.ok, false);
  assert.equal(httpError.status, "unavailable");
  assert.equal(httpError.reason, "paydirt_api_http_error");
});

test("api mode caps rows to the WSS quota", async () => {
  const read = await paydirt.readPaydirtLeads({
    environment: { PAYDIRT_SOURCE: "api", PAYDIRT_WSS_QUOTA: "1" },
    count: 10,
    fetchImpl: async () => jsonResponse(200, {
      ok: true,
      rows: [prepairedLead(), prepairedLead({ sourceFingerprint: "d".repeat(64) })],
    }),
  });
  assert.equal(read.ok, true);
  assert.equal(read.leads.length, 1);
  assert.equal(read.cappedByQuota, true);
});

test("the WSS quota and timeout obey their clamps", () => {
  assert.equal(paydirt.paydirtWssQuota({}), paydirt.DEFAULT_WSS_QUOTA);
  assert.equal(paydirt.paydirtWssQuota({ PAYDIRT_WSS_QUOTA: "5000" }), 100);
  assert.equal(paydirt.paydirtWssQuota({ PAYDIRT_WSS_QUOTA: "0" }), 1);
  assert.equal(paydirt.paydirtTimeoutMs({}), paydirt.DEFAULT_TIMEOUT_MS);
  assert.equal(paydirt.paydirtTimeoutMs({ PAYDIRT_WSS_TIMEOUT_MS: "999" }), 1000);
  assert.equal(paydirt.paydirtTimeoutMs({ PAYDIRT_WSS_TIMEOUT_MS: "60000" }), 30000);
});

// ---------------------------------------------------------------------------
// Campaign wiring — start gate, quota source, pick fallback law
// ---------------------------------------------------------------------------

test("the start-target gate accepts paydirt as a named source", () => {
  assert.deepEqual(recognizedStartTarget("paydirt"), { ok: true, target: "paydirt" });
  assert.deepEqual(recognizedStartTarget("PayDirt"), { ok: true, target: "paydirt" });
  assert.ok(RECOGNIZED_START_TARGETS.includes("paydirt"));
});

test("the quota controller returns a paydirt source for a paydirt campaign", () => {
  const batch = {
    target: "paydirt",
    requested: 10,
    status: "building",
    rows: [],
    mineFunnel: [{ stage: "quota_contract_finished_sites_v1", entered: 10, survived: 0, rejected: {} }],
  };
  const source = quota.nextQuotaSource(batch, { environment: {} });
  assert.equal(source.target, "paydirt");
  assert.equal(source.mode, "paydirt_prepaired_seed");
  assert.ok(source.chunk >= 1 && source.chunk <= quota.DEFAULT_SOURCE_CHUNK);
});

test("pick: a not-configured PayDirt source falls through to stored leads with the reason on the funnel", async () => {
  const storedRow = {
    prospect_id: "place_stored",
    business_name: "Stored Plumbing Co",
    city: "Austin",
    state: "TX",
    industry: "plumbing",
    email: "hi@storedplumbing.com",
    status: "new",
    record: {
      industry: "plumbing",
      truth_packet: {
        mirror_ready: {
          business_name: "Stored Plumbing Co",
          industry: "plumbing",
          services: ["Drain cleaning"],
        },
      },
    },
  };
  const picked = await pickProspects(
    { target: "paydirt", count: 5 },
    {
      select: async () => ({ ok: true, data: [] }),
      selectRows: async () => ({ ok: true, rows: [storedRow], data: [storedRow] }),
    },
  );
  // The freshest-store lane supplied the row — the campaign did not break.
  assert.equal(picked.length, 1);
  assert.equal(picked[0].prospectId, "place_stored");
  // And the funnel names WHY paydirt was skipped.
  assert.ok(Array.isArray(picked.funnel), "fallback funnel must ride the array");
  assert.equal(picked.funnel[0].stage, "1_paydirt_source");
  assert.ok(Object.keys(picked.funnel[0].rejected)[0].includes("paydirt_source_not_configured"),
    JSON.stringify(picked.funnel[0].rejected));
});

test("pick: an export-mode paydirt campaign persists, compiles, seats, and banks the surplus", async (t) => {
  const file = tempFile("paydirt-pick.json", JSON.stringify({ leads: [
    prepairedLead(),
    prepairedLead({ sourceFingerprint: "e".repeat(64), name: "Nunez Fencing Co", trade: "fencing", desc: "FENCE INSTALL" }),
  ] }));
  const prior = { ...process.env };
  process.env.PAYDIRT_EXPORT_FILE = file;
  t.after(() => {
    for (const key of Object.keys(prior)) process.env[key] = prior[key];
    for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
  });

  const persisted = [];
  const upsertRow = async (table, row) => {
    persisted.push(row);
    return { ok: true, mode: "live_upsert", rows: [row] };
  };
  const readByQuery = async (table, query = "") => {
    if (String(query).includes("truth_packet_source=eq.paydirt_prepaired")) return { ok: true, data: [] };
    if (String(query).includes("prospect_id=in.")) {
      return { ok: true, data: persisted.filter((row) => String(query).includes(row.prospect_id)) };
    }
    return { ok: true, data: [] };
  };
  const surplusDeposits = [];
  const picked = await pickProspects(
    { target: "paydirt", count: 1 },
    {
      select: readByQuery,
      upsertRow,
      bankDepositSurplus: async (rows) => { surplusDeposits.push(rows); return { deposited: rows.map((r) => r.prospect_id), skipped: [] }; },
    },
  );
  assert.equal(picked.length, 1, JSON.stringify(picked.funnel));
  assert.ok(picked[0].prospectId.startsWith("paydirt_"));
  assert.equal(picked[0].vertical, "roofing");
  assert.equal(picked[0].businessName, "Marquez Roofing LLC");
  assert.equal(picked.funnel[0].stage, "1_paydirt_source");
  assert.equal(picked.funnel[0].survived, 2);
  // The surplus compile survivor was handed to the bank deposit seam (the
  // bank itself refuses rows without a durable receipt — that law is its own).
  assert.equal(surplusDeposits.length, 1);
  assert.equal(surplusDeposits[0].length, 1);
  assert.ok(surplusDeposits[0][0].record.source === "paydirt");
});

test("pick: an empty successful paydirt read is an honest zero, not a fall-through", async (t) => {
  const file = tempFile("paydirt-empty.json", JSON.stringify({ leads: [] }));
  const prior = { ...process.env };
  process.env.PAYDIRT_EXPORT_FILE = file;
  t.after(() => {
    for (const key of Object.keys(prior)) process.env[key] = prior[key];
    for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
  });
  const picked = await pickProspects(
    { target: "paydirt", count: 3 },
    { select: async () => ({ ok: true, data: [] }) },
  );
  assert.equal(picked.length, 0);
  assert.equal(picked.funnel[1].stage, "2_requested_3");
  assert.ok(Object.keys(picked.funnel[1].rejected)[0].includes("no admissible leads"));
});
