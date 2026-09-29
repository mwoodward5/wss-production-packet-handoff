"use strict";

/**
 * test/line-leadminer-packets.test.js — the "new rifle" seam.
 *
 * target "leadminer" draws held, build-ready LeadMiner truth packets from the
 * store instead of mining; those rows are pre-qualified by the export gate and
 * the packet rides through mirrorProspect's dispatch untouched. Nothing here
 * may re-grade, re-scrape, or fall back to a provider path.
 */
const test = require("node:test");
const assert = require("node:assert");

const { pickProspects, mirrorProspect } = require("../lib/line-adapters");

const PACKET = {
  source: "leadminer_mirror_ready",
  meta: { source: "leadminer_mirror_ready", build_ready: true, missing_build_evidence: [] },
  mirror_ready: {
    business_name: "Cedar Creek Plumbing",
    place_id: "ChIJx",
    logo_url: "https://cedarcreekplumbing.com/logo.png",
    services: ["Drain Cleaning", "Water Heater Repair", "Sewer Line Replacement"],
  },
  services: ["Drain Cleaning", "Water Heater Repair", "Sewer Line Replacement"],
  industry: "plumbing",
};

function setGapFirst(t, value) {
  const prior = process.env.GHOST_AGENCY_QUEUE_GAP_FIRST;
  if (value === undefined) delete process.env.GHOST_AGENCY_QUEUE_GAP_FIRST;
  else process.env.GHOST_AGENCY_QUEUE_GAP_FIRST = value;
  t.after(() => {
    if (prior === undefined) delete process.env.GHOST_AGENCY_QUEUE_GAP_FIRST;
    else process.env.GHOST_AGENCY_QUEUE_GAP_FIRST = prior;
  });
}

function heldRow(id, extra = {}) {
  return {
    prospect_id: id,
    business_name: "Cedar Creek Plumbing",
    city: "Anchorage",
    state: "AK",
    status: "held",
    email: "owner@cedarcreekplumbing.com",
    updated_at: "2026-08-05T08:00:00.000Z",
    record: {
      status: "held",
      handoff_state: "ready_for_build",
      build_ready: true,
      truth_packet: PACKET,
      truth_packet_source: "leadminer_mirror_ready",
      business_name: "Cedar Creek Plumbing",
      industry: "plumbing",
    },
    ...extra,
  };
}

function provisionalHeldRow(id) {
  const row = heldRow(id);
  return {
    ...row,
    record: {
      ...row.record,
      build_ready: { identity_provisional: true },
    },
  };
}

function ownerOnlyPracticeHeldRow(id) {
  const row = heldRow(id);
  return {
    ...row,
    current_website: "https://cedarcreekplumbing.com",
    record: {
      ...row.record,
      current_website: "https://cedarcreekplumbing.com",
      build_ready: {
        admission_scope: "owner_only_practice",
        identity_source: "first_party",
        provenance: {
          business_name: {
            class: "self_published",
            source_url: "https://cedarcreekplumbing.com",
          },
        },
        qualification: {
          template_fit: { ok: true, original_ok: false, advisory: true },
        },
        trade_corroboration: { ok: true, advisory: true, requested_trade: "plumbing" },
      },
    },
  };
}

test('target "leadminer" picks held packet rows: build-ready as-is, incomplete-with-basics as needs_fill', async () => {
  const rows = await pickProspects(
    { target: "leadminer", count: 10 },
    {
      select: async () => ({
        ok: true,
        data: [
          heldRow("place_ready"),
          heldRow("place_previewed", { preview_url: "https://x.wss-ai.com/" }),
          // Incomplete export (build_ready:false) but a real name, place, trade
          // and email — the owner's core unblock: build it anyway, AI-filled.
          { ...heldRow("place_incomplete"), record: { ...heldRow("x").record, build_ready: false } },
          // Incomplete export AND no usable identity — still killed.
          {
            ...heldRow("place_no_identity"),
            business_name: "",
            city: "",
            email: "",
            record: { ...heldRow("x").record, build_ready: false, business_name: "", city: "", industry: "" },
          },
          { ...heldRow("place_wrong_source"), record: { ...heldRow("x").record, truth_packet_source: "genie" } },
          { ...heldRow("place_not_held"), status: "line_queued" },
        ],
      }),
    },
  );
  assert.deepEqual(rows.map((r) => r.prospectId).sort(), ["place_incomplete", "place_ready"]);
  const ready = rows.find((r) => r.prospectId === "place_ready");
  const fill = rows.find((r) => r.prospectId === "place_incomplete");
  assert.equal(ready.leadminerQualified, true, "packet rows must skip the second grader");
  assert.equal(ready.contractIssue, "", "the mined-contract check must not reject a truth packet at intake");
  assert.ok(!ready.needs_fill, "a strictly build-ready packet is not flagged needs_fill");
  assert.equal(fill.needs_fill, true, "an incomplete-but-identified packet is flagged for AI-fill, not killed");
});

/**
 * The packet's `industry` label is the one field that has lied: all three real
 * held packets read "plumber", and one of them was an air-conditioning company.
 * The trade is therefore derived from the SERVICES, and a trade with no clean
 * donor is refused HERE — before a build is paid for and the render gate says
 * no. The refusal must name the reason, because an operator reading "mirror
 * produced no host-approved preview URL" learns nothing.
 */
test("a packet whose services name a trade with no donor is refused at pick time", async () => {
  const hvacPacket = {
    ...PACKET,
    mirror_ready: { business_name: "M & M Heating & Cooling", place_id: "ChIJy", logo_url: "https://mmheatingcooling.com/logo.png", services: ["AC Maintenance/Repair Services", "Air Conditioner Installation", "Furnace Repair"] },
    services: ["AC Maintenance/Repair Services", "Air Conditioner Installation", "Furnace Repair"],
  };
  const rows = await pickProspects(
    { target: "leadminer", count: 10 },
    {
      select: async () => ({
        ok: true,
        data: [{
          ...heldRow("place_hvac"),
          business_name: "M & M Heating & Cooling",
          record: {
            ...heldRow("place_hvac").record,
            business_name: "M & M Heating & Cooling",
            truth_packet: hvacPacket,
            industry: "plumber",
          },
        }],
      }),
      // The donor library decides; the test does not hardcode which verticals
      // happen to be installed today.
      resolveBuildableDonor: (vertical) => (vertical === "hvac"
        ? { ok: false, reason: "no_clean_donor_for_vertical" }
        : { ok: true, donor: `${vertical}-donor` }),
    },
  );
  assert.equal(rows.length, 1, "the row is still surfaced — refused, not silently dropped");
  assert.match(rows[0].contractIssue, /hvac/, `reason must name the trade, got: ${rows[0].contractIssue}`);
  assert.match(rows[0].contractIssue, /no clean donor/i);
});

test("a multi-trade packet builds on its LEAD trade — refusal retired 2026-08-20", async () => {
  // The old doctrine held this row with a "multi-trade business" contract
  // issue. Authority pages now render every verified service its own page and
  // the render gate exempts the client's own name/services/reviews, so the
  // LEAD trade (hvac here: furnace + AC + name's heating/cooling outscore the
  // three plumbing lines) picks the donor and the rest rides along.
  const multiPacket = {
    ...PACKET,
    mirror_ready: { business_name: "Sal's Heating, Cooling & Plumbing", place_id: "ChIJz", logo_url: "https://salsheatingcoolingplumbing.com/logo.png", services: ["Drain Cleaning", "Water Heater Install", "Sewer Line Repair", "Furnace Repair", "AC Installation"] },
    services: ["Drain Cleaning", "Water Heater Install", "Sewer Line Repair", "Furnace Repair", "AC Installation"],
  };
  const rows = await pickProspects(
    { target: "leadminer", count: 10 },
    {
      select: async () => ({
        ok: true,
        data: [{
          ...heldRow("place_multi"),
          business_name: "Sal's Heating, Cooling & Plumbing",
          record: {
            ...heldRow("place_multi").record,
            business_name: "Sal's Heating, Cooling & Plumbing",
            truth_packet: multiPacket,
          },
        }],
      }),
      resolveBuildableDonor: (vertical) => ({ ok: true, donor: `${vertical}-donor` }),
    },
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].contractIssue, "", `a two-trade packet must be admitted, got: ${rows[0].contractIssue}`);
  assert.equal(rows[0].vertical, "hvac", "the LEAD trade picks the donor shell");
});

test("mirrorProspect passes the packet through dispatch and skips the contract gate", async () => {
  let dispatched = null;
  const out = await mirrorProspect(
    { prospectId: "place_ready", businessName: "Roy Briley General Contracting" },
    {
      lane: "sandbox",
      select: async () => ({ ok: true, data: [heldRow("place_ready")] }),
      mirrorLaneEnabled: () => true,
      dispatchMirrorLane: async (prospect) => {
        dispatched = prospect;
        return { mode: "mirror_lane", urls: { preview_url: "https://wss-test-roy-briley.wss-ai.com/" } };
      },
    },
  );
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.ok(dispatched, "dispatch must be called");
  assert.equal(dispatched.truth_packet_source, "leadminer_mirror_ready");
  assert.equal(dispatched.truth_packet.meta.build_ready, true);
});

function packetRow(id, name, industry, services, ordering = {}) {
  const packet = {
    source: "leadminer_mirror_ready",
    meta: { source: "leadminer_mirror_ready", build_ready: true, missing_build_evidence: [] },
    mirror_ready: {
      business_name: name,
      place_id: `ChIJ${id}`,
      logo_url: `https://${id.toLowerCase()}.example.com/logo.png`,
      services,
    },
    services,
    industry,
  };
  return {
    prospect_id: id,
    business_name: name,
    city: "Anchorage",
    state: "AK",
    status: "held",
    email: "owner@cedarcreekplumbing.com",
    ...(ordering.firstSeen ? { firstSeen: ordering.firstSeen } : {}),
    ...(ordering.createdAt ? { created_at: ordering.createdAt } : {}),
    updated_at: "2026-08-05T08:00:00.000Z",
    record: {
      status: "held",
      handoff_state: "ready_for_build",
      build_ready: true,
      truth_packet: packet,
      truth_packet_source: "leadminer_mirror_ready",
      business_name: name,
      industry,
      ...(ordering.websiteScore === undefined && ordering.reputationScore === undefined
        ? {}
        : {
            last_mine_observation: {
              build_ready: {
                qualification: {
                  ...(ordering.websiteScore === undefined
                    ? {}
                    : { website_axis: { score: ordering.websiteScore } }),
                  categories: {
                    ...(ordering.reputationScore === undefined
                      ? {}
                      : { onlineReputation: { score: ordering.reputationScore } }),
                  },
                },
              },
            },
          }),
    },
  };
}

test("a diverse packet shelf builds the deadest sites first across trades before count truncation", async (t) => {
  setGapFirst(t);
  const PLUMB = ["Drain Cleaning", "Water Heater Repair"];
  const HVAC = ["AC Repair", "Furnace Replacement"];
  const ROOF = ["Roof Replacement", "Shingle Repair"];
  const data = [
    packetRow("p1", "Anchor Plumbing", "plumbing", PLUMB),
    packetRow("p2", "Bay Plumbing", "plumbing", PLUMB, { websiteScore: 90, reputationScore: 90 }),
    packetRow("p3", "Cedar Plumbing", "plumbing", PLUMB, { websiteScore: 70, reputationScore: 90 }),
    packetRow("p4", "Delta Plumbing", "plumbing", PLUMB, { websiteScore: 60, reputationScore: 90 }),
    packetRow("h1", "Ember Heating & Cooling", "hvac", HVAC, { websiteScore: 20, reputationScore: 50 }),
    packetRow("h2", "Frost Heating & Cooling", "hvac", HVAC, { websiteScore: 20, reputationScore: 95 }),
    packetRow("r1", "Granite Roofing", "roofing", ROOF, { websiteScore: 5, reputationScore: 80, firstSeen: "2026-08-20T10:00:00.000Z" }),
    packetRow("r2", "Harbor Roofing", "roofing", ROOF, { websiteScore: 5, reputationScore: 80, firstSeen: "2026-08-20T09:00:00.000Z" }),
  ];
  const deps = {
    select: async () => ({ ok: true, data }),
    resolveBuildableDonor: (vertical) => ({ ok: true, donor: `${vertical}-donor` }),
  };
  const rows = await pickProspects(
    { target: "leadminer", count: 6 },
    deps,
  );
  assert.deepEqual(rows.map((row) => row.prospectId), ["r2", "r1", "h2", "h1", "p4", "p3"]);

  const all = await pickProspects({ target: "leadminer", count: data.length }, deps);
  assert.equal(all.length, data.length, "ordering never drops a packet");
  assert.equal(all.at(-1).prospectId, "p1", "a packet with no website score sorts last");
});

function storedBuildRow(id, { websiteScore, reputationScore, firstSeen, createdAt } = {}) {
  const facts = {
    business_name: `${id} Plumbing`,
    industry: "plumbing",
    city: "Reno",
    state: "NV",
    email: `${id}@example.com`,
    current_website: `https://${id}.example.com`,
  };
  return {
    prospect_id: id,
    business_name: facts.business_name,
    industry: facts.industry,
    city: facts.city,
    state: facts.state,
    email: facts.email,
    status: "new",
    ...(firstSeen ? { firstSeen } : {}),
    ...(createdAt ? { created_at: createdAt } : {}),
    updated_at: "2026-08-21T12:00:00.000Z",
    record: {
      build_ready: {
        proof: { build_hash: `hash-${id}` },
        brand_evidence: {},
        mirror_request: { facts },
        qualification: {
          ...(websiteScore === undefined ? {} : { website_axis: { score: websiteScore } }),
          composite_signal: { score: 50 },
          categories: {
            ...(reputationScore === undefined
              ? {}
              : { onlineReputation: { score: reputationScore } }),
          },
        },
      },
    },
  };
}

test("store pickup ranks before count, uses explicit firstSeen for FIFO, and drops nobody", async (t) => {
  setGapFirst(t);
  const data = [
    storedBuildRow("polished", { websiteScore: 90, reputationScore: 99 }),
    storedBuildRow("fifo-later", {
      websiteScore: 10,
      reputationScore: 80,
      firstSeen: "2026-08-20T10:00:00.000Z",
      createdAt: "2026-08-20T01:00:00.000Z",
    }),
    storedBuildRow("missing-score", { reputationScore: 100 }),
    storedBuildRow("fifo-earlier", {
      websiteScore: 10,
      reputationScore: 80,
      firstSeen: "2026-08-20T09:00:00.000Z",
      createdAt: "2026-08-20T12:00:00.000Z",
    }),
    storedBuildRow("strong-reputation", { websiteScore: 10, reputationScore: 95 }),
  ];
  const deps = { selectRows: async () => ({ rows: data }) };

  const firstThree = await pickProspects({ target: "", count: 3 }, deps);
  assert.deepEqual(firstThree.map((row) => row.prospectId), [
    "strong-reputation",
    "fifo-earlier",
    "fifo-later",
  ]);

  const all = await pickProspects({ target: "", count: data.length }, deps);
  assert.equal(all.length, data.length);
  assert.equal(all.at(-1).prospectId, "missing-score");
});

test("numeric-string grades stay unmeasured and sort after a measured website score", async (t) => {
  setGapFirst(t);
  const data = [
    storedBuildRow("numeric-string", { websiteScore: "5", reputationScore: 99 }),
    storedBuildRow("measured-number", { websiteScore: 10, reputationScore: 50 }),
  ];

  const rows = await pickProspects(
    { target: "", count: data.length },
    { selectRows: async () => ({ rows: data }) },
  );

  assert.deepEqual(rows.map((row) => row.prospectId), ["measured-number", "numeric-string"]);
});

test("missing or invalid firstSeen sorts after valid FIFO and keeps stable arrival order", async (t) => {
  setGapFirst(t);
  const data = [
    storedBuildRow("missing-first", { websiteScore: 10, reputationScore: 80 }),
    storedBuildRow("known-time", {
      websiteScore: 10,
      reputationScore: 80,
      firstSeen: "2026-08-20T09:00:00.000Z",
    }),
    storedBuildRow("invalid-second", {
      websiteScore: 10,
      reputationScore: 80,
      firstSeen: "not-a-timestamp",
    }),
  ];

  const rows = await pickProspects(
    { target: "", count: data.length },
    { selectRows: async () => ({ rows: data }) },
  );

  assert.deepEqual(rows.map((row) => row.prospectId), [
    "known-time",
    "missing-first",
    "invalid-second",
  ]);
});

test("targeted mined pickup ranks persisted candidates before count truncation", async (t) => {
  setGapFirst(t);
  const data = [
    storedBuildRow("mined-polished", { websiteScore: 88, reputationScore: 90 }),
    storedBuildRow("mined-dead", { websiteScore: 8, reputationScore: 70 }),
    storedBuildRow("mined-middle", { websiteScore: 40, reputationScore: 95 }),
  ];
  const byId = new Map(data.map((row) => [row.prospect_id, row]));
  const rows = await pickProspects(
    { target: "plumbing in Reno NV", count: 2 },
    {
      select: async (_table, query) => {
        if (String(query).includes("truth_packet_source")) return { ok: true, data: [] };
        return { ok: true, data: [...byId.values()] };
      },
      mineLeads: async () => ({
        ok: true,
        rows: data.map((row) => ({
          prospect_id: row.prospect_id,
          persistence: "created",
          build_hash: row.record.build_ready.proof.build_hash,
        })),
      }),
    },
  );

  assert.deepEqual(rows.map((row) => row.prospectId), ["mined-dead", "mined-middle"]);
});

test("vertical shelf pickup ranks all eligible packets before its count cut", async (t) => {
  setGapFirst(t);
  const PLUMB = ["Drain Cleaning", "Water Heater Repair"];
  const data = [
    packetRow("vertical-polished", "Vertical Polished", "plumbing", PLUMB, { websiteScore: 90, reputationScore: 90 }),
    packetRow("vertical-dead", "Vertical Dead", "plumbing", PLUMB, { websiteScore: 5, reputationScore: 80 }),
    packetRow("vertical-middle", "Vertical Middle", "plumbing", PLUMB, { websiteScore: 40, reputationScore: 95 }),
  ];
  const rows = await pickProspects(
    { target: "plumbing in Anchorage AK", count: 2 },
    {
      select: async () => ({ ok: true, data }),
      resolveBuildableDonor: (vertical) => ({ ok: true, donor: `${vertical}-donor` }),
      mineLeads: async () => { throw new Error("a full shelf must not mine"); },
    },
  );

  assert.deepEqual(rows.map((row) => row.prospectId), ["vertical-dead", "vertical-middle"]);
});

test("GHOST_AGENCY_QUEUE_GAP_FIRST=0 restores store arrival order", async (t) => {
  setGapFirst(t, "0");
  const data = [
    storedBuildRow("arrival-first", { websiteScore: 95, reputationScore: 90 }),
    storedBuildRow("arrival-second", { websiteScore: 5, reputationScore: 90 }),
  ];
  const rows = await pickProspects(
    { target: "", count: data.length },
    { selectRows: async () => ({ rows: data }) },
  );

  assert.deepEqual(rows.map((row) => row.prospectId), ["arrival-first", "arrival-second"]);
});

test("GHOST_AGENCY_QUEUE_GAP_FIRST=0 restores historical multi-trade round-robin", async (t) => {
  setGapFirst(t, "0");
  const PLUMB = ["Drain Cleaning", "Water Heater Repair"];
  const HVAC = ["AC Repair", "Furnace Replacement"];
  const ROOF = ["Roof Replacement", "Shingle Repair"];
  const data = [
    packetRow("p1", "Anchor Plumbing", "plumbing", PLUMB, { websiteScore: 90, reputationScore: 90 }),
    packetRow("p2", "Bay Plumbing", "plumbing", PLUMB, { websiteScore: 80, reputationScore: 90 }),
    packetRow("p3", "Cedar Plumbing", "plumbing", PLUMB, { websiteScore: 70, reputationScore: 90 }),
    packetRow("p4", "Delta Plumbing", "plumbing", PLUMB, { websiteScore: 60, reputationScore: 90 }),
    packetRow("h1", "Ember Heating & Cooling", "hvac", HVAC, { websiteScore: 10, reputationScore: 80 }),
    packetRow("h2", "Frost Heating & Cooling", "hvac", HVAC, { websiteScore: 20, reputationScore: 80 }),
    packetRow("r1", "Granite Roofing", "roofing", ROOF, { websiteScore: 5, reputationScore: 70 }),
    packetRow("r2", "Harbor Roofing", "roofing", ROOF, { websiteScore: 15, reputationScore: 70 }),
  ];

  const rows = await pickProspects(
    { target: "leadminer", count: 6 },
    {
      select: async () => ({ ok: true, data }),
      resolveBuildableDonor: (vertical) => ({ ok: true, donor: `${vertical}-donor` }),
    },
  );

  assert.deepEqual(rows.map((row) => row.prospectId), ["p1", "h1", "r1", "p2", "h2", "r2"]);
});

test("a non-packet row still faces the build-ready contract gate", async () => {
  const out = await mirrorProspect(
    { prospectId: "plain-row", businessName: "Plain Co" },
    {
      lane: "sandbox",
      select: async () => ({ ok: true, data: [{ prospect_id: "plain-row", status: "held", record: {} }] }),
      mirrorLaneEnabled: () => true,
      dispatchMirrorLane: async () => { throw new Error("must not dispatch"); },
    },
  );
  assert.equal(out.ok, false);
  assert.match(String(out.reason || ""), /contract|build_ready/i);
});

// ---------------------------------------------------------------------------
// VERTICAL BALANCE (issue #374)
// When gapFirst ordering is active (the default), a dense vertical would
// otherwise consume all batch slots. The per-vertical cap ensures no single
// trade exceeds ceil(count / numTrades) rows, so less-represented verticals
// always get at least one slot while the total requested count is still filled.
// ---------------------------------------------------------------------------

test("gapFirst pick caps each trade at ceil(count/trades) so skewed shelves are fairly distributed", async (t) => {
  setGapFirst(t, "1");
  const PLUMB = ["Drain Cleaning", "Water Heater Repair"];
  const ELEC  = ["Electrical Wiring", "Panel Upgrades"];
  const HVAC  = ["AC Repair", "Furnace Replacement"];

  // Shelf is heavily plumbing-dominated: 6 rows vs 2 each for electrical and HVAC.
  // Without a vertical cap, gapFirst would fill all 6 requested slots with plumbing.
  // With the cap (ceil(6/3)=2) each trade contributes at most 2 rows.
  const data = [
    packetRow("p1", "Anchor Plumbing",  "plumbing",    PLUMB, { websiteScore: 90, reputationScore: 90 }),
    packetRow("p2", "Bay Plumbing",     "plumbing",    PLUMB, { websiteScore: 85, reputationScore: 90 }),
    packetRow("p3", "Cedar Plumbing",   "plumbing",    PLUMB, { websiteScore: 80, reputationScore: 90 }),
    packetRow("p4", "Delta Plumbing",   "plumbing",    PLUMB, { websiteScore: 75, reputationScore: 90 }),
    packetRow("p5", "Echo Plumbing",    "plumbing",    PLUMB, { websiteScore: 70, reputationScore: 90 }),
    packetRow("p6", "Foxtrot Plumbing", "plumbing",    PLUMB, { websiteScore: 65, reputationScore: 90 }),
    packetRow("e1", "Grid Electric",    "electrical",  ELEC,  { websiteScore: 10, reputationScore: 70 }),
    packetRow("e2", "Hertz Electric",   "electrical",  ELEC,  { websiteScore: 12, reputationScore: 70 }),
    packetRow("h1", "Ice Aire HVAC",    "hvac",        HVAC,  { websiteScore: 5,  reputationScore: 60 }),
    packetRow("h2", "Jetstream HVAC",   "hvac",        HVAC,  { websiteScore: 8,  reputationScore: 60 }),
  ];

  const rows = await pickProspects(
    { target: "leadminer", count: 6 },
    {
      select: async () => ({ ok: true, data }),
      resolveBuildableDonor: (vertical) => ({ ok: true, donor: `${vertical}-donor` }),
    },
  );

  assert.equal(rows.length, 6, "all 6 requested slots are filled");

  const byTrade = {};
  for (const row of rows) {
    byTrade[row.vertical] = (byTrade[row.vertical] || 0) + 1;
  }
  const numTrades = Object.keys(byTrade).length;
  const cap = Math.ceil(6 / numTrades);

  for (const [trade, count] of Object.entries(byTrade)) {
    assert.ok(count <= cap, `${trade}: ${count} rows exceeds per-vertical cap of ${cap}`);
  }

  // Plumbing must not monopolise: fewer than the total should come from plumbing.
  assert.ok((byTrade.plumbing || 0) < 6, "plumbing must not consume all 6 slots");
  assert.ok((byTrade.electrical || 0) >= 1, "electrical must claim at least one slot");
  assert.ok((byTrade.hvac || 0) >= 1, "hvac must claim at least one slot");
});

// ---------------------------------------------------------------------------
// BUILD-READINESS PREFLIGHT (issue #376): qualify at intake, never fail at build
// ---------------------------------------------------------------------------

// Helper: run a pickProspects call over a given set of shelf rows and return
// a compact summary so the assertions above stay readable.
async function runShelfPick(rows, lane = "sandbox") {
  const picked = await pickProspects(
    { target: "leadminer", count: rows.length + 10, lane },
    {
      select: async () => ({ ok: true, data: rows }),
      resolveBuildableDonor: (vertical) => ({ ok: true, donor: `${vertical}-donor` }),
    },
  );
  return { length: picked.length, items: picked, funnel: picked.funnel };
}

test("a logo-less LeadMiner packet enters and defers to the wordmark ladder", async () => {
  const noLogoPacket = {
    ...PACKET,
    mirror_ready: {
      ...PACKET.mirror_ready,
      logo_url: "",   // ← missing logo
    },
  };
  const { funnel, length, items } = await runShelfPick([
    { ...heldRow("no-logo"), record: { ...heldRow("no-logo").record, truth_packet: noLogoPacket } },
    heldRow("has-logo"),   // good packet — should still pass
  ]);
  assert.equal(length, 2, "logo absence never kills a build");
  assert.deepEqual(items.map((item) => item.prospectId).sort(), ["has-logo", "no-logo"]);
  const stage1 = funnel && funnel.find((s) => s.stage === "1_packet_shelf");
  assert.ok(stage1, "funnel stage 1_packet_shelf is reported");
  assert.equal(stage1.rejected.no_verified_logo, undefined, "the retired logo refusal is never logged");
});

test("email-less packet builds in sandbox but remains held from the live lane", async () => {
  const sourceRows = [
    { ...heldRow("no-email"), email: "", record: { ...heldRow("no-email").record } },
    heldRow("has-email"),   // good packet
  ];
  const sandbox = await runShelfPick(sourceRows, "sandbox");
  assert.equal(sandbox.length, 2, "sandbox routes proof to the owner and may build without client email");
  const live = await runShelfPick(sourceRows, "live");
  assert.equal(live.length, 1, "live delivery still requires a verified client email");
  assert.equal(live.items[0].prospectId, "has-email");
});

test("a provisional persisted shelf row is Practice-only on the named-vertical path", async () => {
  const row = provisionalHeldRow("vertical-provisional");
  const baseDeps = {
    select: async () => ({ ok: true, data: [row] }),
    resolveBuildableDonor: (vertical) => ({ ok: true, donor: `${vertical}-donor` }),
  };

  const practice = await pickProspects(
    { target: "plumbing in Anchorage AK", count: 1, lane: "sandbox" },
    {
      ...baseDeps,
      mineLeads: async () => { throw new Error("Practice must use its matching shelf row"); },
    },
  );
  assert.deepEqual(practice.map((item) => item.prospectId), ["vertical-provisional"]);

  let intakeCalls = 0;
  let mineCalls = 0;
  const live = await pickProspects(
    { target: "plumbing in Anchorage AK", count: 1, lane: "live" },
    {
      ...baseDeps,
      mineLeads: async () => { mineCalls += 1; return { ok: true, rows: [] }; },
      callIntakeGenie: async () => { intakeCalls += 1; throw new Error("provisional row reached Intake"); },
      certificationKey: "test-certification-key-for-provisional-guard",
    },
  );
  assert.equal(live.length, 0, "Live must not select the provisional shelf row");
  assert.equal(mineCalls, 1, "Live may source a replacement after skipping provisional inventory");
  assert.equal(intakeCalls, 0, "the provisional shelf row must be skipped before Intake");
});

test('a provisional persisted shelf row is Practice-only for target "leadminer"', async () => {
  const row = provisionalHeldRow("leadminer-provisional");
  const baseDeps = {
    select: async () => ({ ok: true, data: [row] }),
    resolveBuildableDonor: (vertical) => ({ ok: true, donor: `${vertical}-donor` }),
  };

  const practice = await pickProspects(
    { target: "leadminer", count: 1, lane: "sandbox" },
    baseDeps,
  );
  assert.deepEqual(practice.map((item) => item.prospectId), ["leadminer-provisional"]);

  let intakeCalls = 0;
  const live = await pickProspects(
    { target: "leadminer", count: 1, lane: "live" },
    {
      ...baseDeps,
      callIntakeGenie: async () => { intakeCalls += 1; throw new Error("provisional row reached Intake"); },
      certificationKey: "test-certification-key-for-provisional-guard",
    },
  );
  assert.equal(live.length, 0, "Live must not select the provisional shelf row");
  assert.equal(intakeCalls, 0, "the provisional shelf row must be skipped before Intake");
  assert.equal(live.funnel[0].rejected.provisional_identity_owner_only, 1);
});

test('a first-party advisory admission on the packet shelf is Practice-only for target "leadminer"', async () => {
  const row = ownerOnlyPracticeHeldRow("leadminer-practice-scope");
  assert.notEqual(row.record.build_ready.identity_provisional, true);
  const baseDeps = {
    select: async () => ({ ok: true, data: [row] }),
    resolveBuildableDonor: (vertical) => ({ ok: true, donor: `${vertical}-donor` }),
  };

  const practice = await pickProspects(
    { target: "leadminer", count: 1, lane: "sandbox" },
    baseDeps,
  );
  assert.deepEqual(practice.map((item) => item.prospectId), [row.prospect_id]);

  let intakeCalls = 0;
  const live = await pickProspects(
    { target: "leadminer", count: 1, lane: "live" },
    {
      ...baseDeps,
      callIntakeGenie: async () => {
        intakeCalls += 1;
        throw new Error("owner-only Practice shelf admission reached Intake in Live");
      },
      certificationKey: "test-certification-key-for-practice-scope-guard",
    },
  );
  assert.equal(live.length, 0);
  assert.equal(intakeCalls, 0);
  assert.equal(live.funnel[0].rejected.owner_only_practice_admission, 1);
});

test("a services-less LeadMiner packet never enters a batch (preflight kills it)", async () => {
  const noSvcsPacket = {
    ...PACKET,
    mirror_ready: { ...PACKET.mirror_ready, services: [] },
    services: [],
  };
  const { length } = await runShelfPick([
    { ...heldRow("no-svcs"), record: { ...heldRow("no-svcs").record, truth_packet: noSvcsPacket } },
    heldRow("has-svcs"),
  ]);
  assert.equal(length, 1, "only the packet with services must enter the batch");
});

test("a bare Genie boolean cannot skip missing service evidence", async () => {
  const genieCertifiedRow = {
    ...heldRow("genie-ok"),
    record: {
      ...heldRow("genie-ok").record,
      genie_build_certified: true,
      intake_packet_dir: "/tmp/wss-packets/genie-ok",
      truth_packet: {
        ...PACKET,
        mirror_ready: {
          ...PACKET.mirror_ready,
          services: [],
        },
        services: [],
      },
    },
  };
  const { length, items } = await runShelfPick([genieCertifiedRow]);
  assert.equal(length, 0, "an unsigned compatibility flag grants no content fast-pass");
  assert.equal(items.length, 0);
});
