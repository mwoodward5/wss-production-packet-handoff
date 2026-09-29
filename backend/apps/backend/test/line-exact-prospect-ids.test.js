"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { pickProspects, queueEmail } = require("../lib/line-adapters");
const { explicitProspectIds, explicitProspectSelection, pickedRows } = require("../lib/line-continuation");
const {
  BATCH_TABLE,
  createExplicitProspectMarker,
  createLinePersistence,
  readExplicitProspectMarker,
  sanitizeRowPayload,
} = require("../lib/line-persistence");

const GENIE_CERTIFICATION_KEY = "test-only-exact-id-genie-certification-key";
const GENIE_SOURCE = "https://exact-id-plumbing.example/services";
const GENIE_CERTIFIED_AT = "2026-08-24T10:00:00.000Z";

function packetRow(id, name, updatedAt) {
  const record = {
    prospect_id: id,
    business_name: name,
    city: "Tulsa",
    state: "OK",
    industry: "plumbing",
    email: `${id}@example.test`,
    status: "held",
    build_ready: false,
    handoff_state: "held_incomplete",
    truth_packet_source: "leadminer_mirror_ready",
    truth_packet: {
      meta: { source: "leadminer_mirror_ready" },
      services: ["Drain cleaning"],
      mirror_ready: {
        business_name: name,
        city: "Tulsa",
        state: "OK",
        industry: "plumbing",
        services: [{ name: "Drain cleaning" }],
      },
    },
  };
  return {
    prospect_id: id,
    business_name: name,
    city: "Tulsa",
    state: "OK",
    industry: "plumbing",
    email: `${id}@example.test`,
    status: "held",
    record,
    updated_at: updatedAt,
  };
}

function exactDeps(rows, overrides = {}) {
  return {
    async select() { return { ok: true, data: rows }; },
    async mineLeads() { throw new Error("exact selection must never mine"); },
    resolveBuildableDonor() { return { ok: true, donor: "fixture" }; },
    async conditionalUpdate() { return { ok: true, updated: true, rows: [] }; },
    clock: () => Date.parse("2026-08-22T12:00:00.000Z"),
    ...overrides,
  };
}

function exactGenieResult(prospect = {}) {
  const id = String(prospect.prospect_id || "exact-genie");
  const requestId = `ghost:${id}:line-genie-certified-v7`;
  return {
    ok: true,
    packet: {
      ok: true,
      version: "intake-genie-v2",
      status: "complete",
      scope: { supported: true, category: "plumbing" },
      job_id: `genie-job-${id}`,
      request_id: requestId,
      facts: {
        name: prospect.business_name,
        city: prospect.city,
        state: prospect.state,
        category: "plumbing",
        services: ["Drain cleaning"],
      },
      evidence: [{ field: "services", value: "Drain cleaning", source_url: GENIE_SOURCE }],
    },
    request: {
      request_id: requestId,
      sources: { website_url: GENIE_SOURCE },
    },
    idempotencyKey: requestId,
  };
}

function exactGenieRow(id, name) {
  const row = packetRow(id, name, "2026-08-24T09:00:00.000Z");
  row.website = "https://exact-id-plumbing.example";
  row.record.website = row.website;
  return row;
}

function exactGenieDeps(rows, overrides = {}) {
  return exactDeps(rows, {
    env: { VERCEL_ENV: "production" },
    certificationKey: GENIE_CERTIFICATION_KEY,
    now: () => GENIE_CERTIFIED_AT,
    nowMs: Date.parse("2026-08-24T10:05:00.000Z"),
    ...overrides,
  });
}

function strictContractRow(id, businessName, { services = [], siteText = "", categories = [] } = {}) {
  const row = packetRow(id, businessName, "2026-08-22T00:00:01.000Z");
  row.status = "new";
  row.industry = "fencing";
  row.record.status = "new";
  row.record.industry = "fencing";
  delete row.record.truth_packet_source;
  delete row.record.truth_packet;
  row.record.build_ready = {
    proof: { build_hash: "a".repeat(64) },
    qualification: {
      website_axis: { score: 20 },
      composite_signal: { score: 70 },
      categories: {},
    },
    brand_evidence: {},
    mirror_request: {
      facts: {
        business_name: businessName,
        city: "Tulsa",
        state: "OK",
        industry: "fencing",
        categories,
        site_text: siteText,
      },
      content: { services, site_text: siteText, categories },
    },
  };
  return row;
}

test("exact packet pick preserves caller order and makes zero mining calls", async () => {
  const rows = [
    packetRow("place_two", "Second Plumbing", "2026-08-22T00:00:02.000Z"),
    packetRow("place_one", "First Plumbing", "2026-08-22T00:00:01.000Z"),
  ];
  let mines = 0;
  const picked = await pickProspects({
    count: 2,
    prospectIds: ["place_one", "place_two"],
  }, {
    async select(_table, query) {
      assert.match(query, /prospect_id=in\.\("place_one","place_two"\)/);
      return { ok: true, data: rows };
    },
    resolveBuildableDonor() { return { ok: true, donor: "fixture" }; },
    async mineLeads() { mines += 1; return { ok: false }; },
  });

  assert.deepEqual(picked.map((row) => row.prospectId), ["place_one", "place_two"]);
  assert.ok(picked.every((row) => row.leadminerQualified === true));
  assert.ok(picked.every((row) => row.needs_fill === true));
  assert.equal(mines, 0);
});

test("provisional persisted identity is Practice-only and live exact selection refuses before Intake", async () => {
  const row = strictContractRow(
    "provisional-exact",
    "Provisional Fence",
    { services: ["Fence installation"], siteText: "Fence installation and gate repair in Tulsa." },
  );
  row.record.build_ready.identity_provisional = true;

  const practice = await pickProspects({
    count: 1,
    lane: "sandbox",
    prospectIds: [row.prospect_id],
  }, exactDeps([row], { env: { VERCEL_ENV: "test" } }));
  assert.deepEqual(practice.map((candidate) => candidate.prospectId), [row.prospect_id]);

  let compilerCalls = 0;
  await assert.rejects(
    () => pickProspects({
      count: 1,
      lane: "live",
      prospectIds: [row.prospect_id],
    }, exactDeps([row], {
      env: { VERCEL_ENV: "production" },
      certificationKey: GENIE_CERTIFICATION_KEY,
      async callIntakeGenie() {
        compilerCalls += 1;
        throw new Error("live provisional identity must be refused before Intake");
      },
    })),
    (error) => error?.code === "explicit_prospect_ids_ineligible"
      && error.reasons.includes("provisional_identity_owner_only"),
  );
  assert.equal(compilerCalls, 0);
});

test("first-party identity with advisory Practice admission is refused by live exact selection before Intake", async () => {
  const row = strictContractRow(
    "practice-scope-exact",
    "First Party Fence",
    { services: ["Fence installation"], siteText: "First Party Fence installs residential fences in Tulsa." },
  );
  row.current_website = "https://first-party-fence.example";
  row.record.current_website = row.current_website;
  Object.assign(row.record.build_ready, {
    admission_scope: "owner_only_practice",
    identity_source: "first_party",
    provenance: {
      business_name: {
        class: "self_published",
        source_url: row.current_website,
      },
    },
    trade_corroboration: { ok: true, advisory: true, requested_trade: "fencing" },
  });
  row.record.build_ready.qualification.template_fit = {
    ok: true,
    original_ok: false,
    advisory: true,
  };
  assert.notEqual(row.record.build_ready.identity_provisional, true);

  const practice = await pickProspects({
    count: 1,
    lane: "sandbox",
    prospectIds: [row.prospect_id],
  }, exactDeps([row], { env: { VERCEL_ENV: "test" } }));
  assert.deepEqual(practice.map((candidate) => candidate.prospectId), [row.prospect_id]);

  let compilerCalls = 0;
  await assert.rejects(
    () => pickProspects({
      count: 1,
      lane: "live",
      prospectIds: [row.prospect_id],
    }, exactDeps([row], {
      env: { VERCEL_ENV: "production" },
      certificationKey: GENIE_CERTIFICATION_KEY,
      async callIntakeGenie() {
        compilerCalls += 1;
        throw new Error("owner-only Practice admission reached Intake in live exact selection");
      },
    })),
    (error) => error?.code === "explicit_prospect_ids_ineligible"
      && error.reasons.includes("owner_only_practice_admission"),
  );
  assert.equal(compilerCalls, 0);
});

test("new exact ID compiles, persists, verifies, and returns the certification checkpoint", async () => {
  const row = exactGenieRow("exact-genie-new", "Exact Genie Plumbing");
  assert.equal(row.record.genie_content_certification, undefined);
  let compilerCalls = 0;
  let savedPatch = null;

  const picked = await pickProspects({
    target: "owner-selected-packets",
    count: 1,
    lane: "sandbox",
    prospectIds: [row.prospect_id],
  }, exactGenieDeps([row], {
    async callIntakeGenie(prospect) {
      compilerCalls += 1;
      assert.equal(prospect.prospect_id, row.prospect_id);
      return exactGenieResult(prospect);
    },
    async conditionalUpdate(_table, _key, id, guards, patch) {
      assert.equal(id, row.prospect_id);
      assert.deepEqual(guards, {
        updated_at: `eq.${row.updated_at}`,
        status: "eq.held",
      });
      savedPatch = patch;
      return { ok: true, updated: true };
    },
  }));

  assert.equal(compilerCalls, 1);
  assert.ok(savedPatch?.record?.genie_content_certification);
  assert.equal(savedPatch.updated_at, GENIE_CERTIFIED_AT);
  assert.equal(picked.length, 1);
  assert.equal(picked[0].prospectId, row.prospect_id);
  assert.equal(picked[0].genieContentCertified, true);
  assert.equal(picked[0].needs_fill, false);
  assert.equal(picked[0].durableUpdatedAt, GENIE_CERTIFIED_AT);
});

test("exact ID reuses a valid durable Genie receipt with zero compiler or persistence calls", async () => {
  let current = exactGenieRow("exact-genie-reuse", "Exact Genie Reuse Plumbing");
  let compilerCalls = 0;
  let persistenceCalls = 0;
  const deps = exactGenieDeps([], {
    async select() { return { ok: true, data: [current] }; },
    async callIntakeGenie(prospect) {
      compilerCalls += 1;
      return exactGenieResult(prospect);
    },
    async conditionalUpdate(_table, _key, _id, _guards, patch) {
      persistenceCalls += 1;
      current = { ...current, record: patch.record, updated_at: patch.updated_at };
      return { ok: true, updated: true };
    },
  });
  const input = {
    target: "owner-selected-packets",
    count: 1,
    lane: "sandbox",
    prospectIds: [current.prospect_id],
  };

  const first = await pickProspects(input, deps);
  assert.equal(first[0].genieContentCertified, true);
  assert.equal(compilerCalls, 1);
  assert.equal(persistenceCalls, 1);

  compilerCalls = 0;
  persistenceCalls = 0;
  const reused = await pickProspects(input, deps);
  assert.equal(reused[0].prospectId, current.prospect_id);
  assert.equal(reused[0].genieContentCertified, true);
  assert.equal(reused[0].needs_fill, false);
  assert.equal(reused[0].durableUpdatedAt, GENIE_CERTIFIED_AT);
  assert.equal(compilerCalls, 0);
  assert.equal(persistenceCalls, 0);
});

test("exact ID treats compiler 422 as terminal without mining, substitution, or refill", async () => {
  const row = exactGenieRow("exact-genie-422", "Exact Genie Refused Plumbing");
  const problems = [{
    code: "business_name_mismatch",
    field: "name",
    expected: row.business_name,
    actual: "Wrong Plumbing",
    compared: { candidate: row.business_name, compiled: "Wrong Plumbing" },
  }];
  let selects = 0;
  let mines = 0;
  let persistenceCalls = 0;
  await assert.rejects(
    () => pickProspects({
      target: "plumbers in Tulsa OK",
      count: 1,
      lane: "sandbox",
      prospectIds: [row.prospect_id],
    }, exactGenieDeps([row], {
      async select(_table, query) {
        selects += 1;
        assert.match(query, new RegExp(row.prospect_id));
        return { ok: true, data: [row] };
      },
      async mineLeads() { mines += 1; return { ok: true, rows: [] }; },
      async callIntakeGenie() {
        return { ok: false, status: 422, error: "compiler_http_422", problems };
      },
      async conditionalUpdate() { persistenceCalls += 1; return { ok: true, updated: true }; },
    })),
    (error) => {
      assert.equal(error?.code, "intake_genie_compile_terminal");
      assert.equal(error?.retryable, false);
      assert.equal(error?.causeCode, "compiler_http_422");
      assert.deepEqual(error?.problems, problems);
      assert.deepEqual(error?.detail, problems);
      return true;
    },
  );
  assert.equal(selects, 1);
  assert.equal(mines, 0);
  assert.equal(persistenceCalls, 0);
});

test("exact ID retries throttle and certification CAS failures without mining, substitution, or refill", async (t) => {
  for (const scenario of ["http_429", "persist_cas"]) {
    await t.test(scenario, async () => {
      const row = exactGenieRow(`exact-genie-${scenario}`, "Exact Genie Retry Plumbing");
      let selects = 0;
      let mines = 0;
      let persistenceCalls = 0;
      await assert.rejects(
        () => pickProspects({
          target: "plumbers in Tulsa OK",
          count: 1,
          lane: "sandbox",
          prospectIds: [row.prospect_id],
        }, exactGenieDeps([row], {
          async select() { selects += 1; return { ok: true, data: [row] }; },
          async mineLeads() { mines += 1; return { ok: true, rows: [] }; },
          async callIntakeGenie(prospect) {
            if (scenario === "http_429") return { ok: false, status: 429, error: "compiler_http_429" };
            return exactGenieResult(prospect);
          },
          async conditionalUpdate() {
            persistenceCalls += 1;
            return { ok: false, updated: false };
          },
        })),
        (error) => {
          assert.equal(error?.code, "intake_genie_compile_retryable");
          assert.equal(error?.retryable, true);
          assert.equal(
            error?.causeCode,
            scenario === "http_429" ? "compiler_http_429" : "intake_genie_certification_persist_failed",
          );
          return true;
        },
      );
      assert.equal(selects, 1);
      assert.equal(mines, 0);
      assert.equal(persistenceCalls, scenario === "http_429" ? 0 : 1);
    });
  }
});

test("exact packet pick fails closed when a requested durable row is missing", async () => {
  await assert.rejects(
    () => pickProspects({ count: 2, prospectIds: ["place_one", "place_two"] }, {
      async select() { return { ok: true, data: [packetRow("place_one", "First Plumbing", "2026-08-22T00:00:01.000Z")] }; },
    }),
    (error) => error && error.code === "explicit_prospect_ids_not_found",
  );
});

test("continuation recovers only a valid explicit packet marker", () => {
  const marker = createExplicitProspectMarker(["place_one", "place_two"]);
  assert.deepEqual(explicitProspectIds({
    target: "owner-selected-packets",
    requested: 2,
    mineFunnel: [marker],
  }), ["place_one", "place_two"]);
  const corrupted = structuredClone(marker);
  corrupted.prospect_keys.reverse();
  const rejected = explicitProspectSelection({
    target: "owner-selected-packets",
    requested: 2,
    mineFunnel: [corrupted],
  });
  assert.equal(rejected.exact, true);
  assert.equal(rejected.valid, false);
  assert.equal(rejected.reason, "explicit_prospect_marker_hash_mismatch");
  assert.deepEqual(explicitProspectIds({ target: "owner-selected-packets", requested: 2, mineFunnel: [] }), []);
});

test("suppressed exact contact never survives as ready or as a raw email", async () => {
  const row = packetRow("place_suppressed", "Suppressed Plumbing", "2026-08-22T00:00:01.000Z");
  row.record.contact_enrichment = {
    outreach: {
      review_hold: true,
      hold_reasons: ["email_suppressed"],
      sendable_email: null,
    },
  };
  row.record.outreach_hold_reasons = ["email_suppressed"];
  row.record.outreach_review_hold = true;
  const picked = await pickProspects({ count: 1, prospectIds: [row.prospect_id] }, exactDeps([row]));
  assert.equal(picked[0].email, "");
  assert.equal(picked[0].hasEmail, false);
  assert.equal(picked[0].contactReady, false);
  assert.doesNotMatch(JSON.stringify(picked), /place_suppressed@example\.test/i);

  const durable = pickedRows(
    [{ ...picked[0], email: "raw-suppressed@example.test" }],
    "2026-08-22T12:00:00.000Z",
    0,
    { requireContactVerdict: true },
  );
  assert.equal(durable[0].contactReady, false);
  assert.equal(durable[0].hasEmail, false);
  assert.equal(durable[0].email, "");
});

test("exact persistence requires its contact verdict while the legacy picker keeps a present email", () => {
  const legacy = pickedRows(
    [{ prospectId: "legacy", email: "legacy@example.test" }],
    "2026-08-22T12:00:00.000Z",
  );
  assert.equal(legacy[0].contactReady, true);
  assert.equal(legacy[0].hasEmail, true);
  assert.equal(legacy[0].email, "legacy@example.test");

  const exact = pickedRows(
    [{ prospectId: "exact", email: "unverified@example.test" }],
    "2026-08-22T12:00:00.000Z",
    0,
    { requireContactVerdict: true },
  );
  assert.equal(exact[0].contactReady, false);
  assert.equal(exact[0].hasEmail, false);
  assert.equal(exact[0].email, "");
});

test("non-LeadMiner exact fencing uses the approved sport disambiguation law", async (t) => {
  await t.test("Alamo-style fence contractor evidence remains buildable", async () => {
    const row = strictContractRow("alamo-fence", "Alamo Fence Company", {
      services: ["Fence installation", "Chain-link fencing", "Gate installation"],
      siteText: "Residential and commercial fence installation.",
      categories: ["Fence contractor"],
    });
    const selected = await pickProspects({ count: 1, prospectIds: [row.prospect_id] }, exactDeps([row]));
    assert.equal(selected.length, 1);
    assert.equal(selected[0].vertical, "fencing");
  });

  await t.test("the ambiguous word fencing alone is refused", async () => {
    const row = strictContractRow("bare-fencing", "ABQ Fencing");
    await assert.rejects(
      () => pickProspects({ count: 1, prospectIds: [row.prospect_id] }, exactDeps([row])),
      (error) => error?.code === "explicit_prospect_ids_ineligible"
        && error.reasons.includes("fencing_contracting_uncorroborated"),
    );
  });

  await t.test("Duke-style sport evidence is held", async () => {
    const row = strictContractRow("duke-city", "Duke City Fencing Club", {
      siteText: "Olympic coaches teach foil, epee and sabre classes for athletes.",
      categories: ["Sports club"],
    });
    let holds = 0;
    await assert.rejects(
      () => pickProspects({ count: 1, prospectIds: [row.prospect_id] }, exactDeps([row], {
        async conditionalUpdate() { holds += 1; return { ok: true, updated: true, rows: [] }; },
      })),
      (error) => error?.code === "explicit_prospect_ids_ineligible"
        && error.reasons.includes("vertical_mismatch_sport_fencing"),
    );
    assert.equal(holds, 1);
  });
});

test("queue boundary rechecks canonical status, suppression, and email before CAS", async (t) => {
  const preview = "https://queue-safe.wss-ai.com/";
  const base = {
    prospect_id: "queue-safe",
    email: "contact@alamo-fence.com",
    preview_url: preview,
    status: "line_gate_passed",
    updated_at: "2026-08-22T12:00:00.000Z",
    record: { status: "line_gate_passed", email: "contact@alamo-fence.com" },
  };
  async function run(canonical) {
    let writes = 0;
    const result = await queueEmail({
      prospectId: canonical.prospect_id,
      email: "stale-row@example.test",
      previewUrl: preview,
    }, {
      async select() { return { ok: true, data: [canonical] }; },
      async conditionalUpdate() {
        writes += 1;
        return { ok: true, updated: true, rows: [{ updated_at: "2026-08-22T12:00:00.000Z" }] };
      },
    });
    return { result, writes };
  }

  await t.test("valid canonical contact queues and ignores stale row email", async () => {
    const { result, writes } = await run(structuredClone(base));
    assert.equal(result.ok, true);
    assert.equal(writes, 1);
    assert.equal(result.rowPatch.recipientFingerprint.length, 64);
  });

  for (const [name, canonical, reason] of [
    ["record held", { ...base, record: { ...base.record, status: "held" } }, "queue_canonical_record_status_not_ready"],
    ["record suppressed", { ...base, record: { ...base.record, status: "suppressed" } }, "queue_canonical_record_status_not_ready"],
    ["suppression flag", { ...base, record: { ...base.record, email_suppressed: true } }, "queue_contact_suppressed"],
    ["invalid top-level email", { ...base, email: "not-an-email" }, "queue_contact_not_ready"],
  ]) {
    await t.test(name, async () => {
      const { result, writes } = await run(canonical);
      assert.equal(result.ok, false);
      assert.equal(result.reason, reason);
      assert.equal(writes, 0);
    });
  }
});

test("exact selection applies terminal, truth, held, duplicate, retry, vertical, and donor gates atomically", async (t) => {
  async function refuses(row, overrides, expectedReason, requestOverrides = {}) {
    await assert.rejects(
      () => pickProspects({ count: 1, prospectIds: [row.prospect_id], ...requestOverrides }, exactDeps([row], overrides)),
      (error) => error?.code === "explicit_prospect_ids_ineligible"
        && error.reasons.includes(expectedReason),
    );
  }

  await t.test("terminal do-not-contact row", async () => {
    const row = packetRow("terminal", "Terminal Plumbing", "2026-08-22T00:00:01.000Z");
    row.status = "do_not_contact";
    await refuses(row, {}, "standard_eligibility_hold");
  });

  await t.test("LeadMiner source without its truth packet", async () => {
    const row = packetRow("truthless", "Truthless Plumbing", "2026-08-22T00:00:01.000Z");
    delete row.record.truth_packet;
    await refuses(row, {}, "leadminer_truth_packet_missing");
  });

  await t.test("LeadMiner row is not auto-qualified on source label alone", async () => {
    const row = packetRow("thin", "Thin Plumbing", "2026-08-22T00:00:01.000Z");
    row.city = "";
    row.record.city = "";
    row.record.truth_packet.mirror_ready.city = "";
    await refuses(row, {}, "leadminer_truth_identity_incomplete");
  });

  await t.test("LeadMiner packet must still be on the held shelf", async () => {
    const row = packetRow("not-held", "Already Queued Plumbing", "2026-08-22T00:00:01.000Z");
    row.status = "new";
    await refuses(row, {}, "leadminer_packet_not_held");
  });

  await t.test("duplicate row", async () => {
    const row = packetRow("duplicate", "Duplicate Plumbing", "2026-08-22T00:00:01.000Z");
    row.record.duplicate_of = "canonical";
    await refuses(row, {}, "duplicate_business");
  });

  await t.test("recent failed build remains inside the live cost guard", async () => {
    const row = packetRow("retry", "Retry Plumbing", "2026-08-22T00:00:01.000Z");
    row.record.last_build_error = { at: "2026-08-22T11:59:00.000Z" };
    await refuses(row, {}, "build_retry_window_active", { lane: "live" });
  });

  await t.test("owner-named sandbox exact retry bypasses only the recent build cost guard", async () => {
    const row = packetRow("retry-sandbox", "Retry Sandbox Plumbing", "2026-08-22T00:00:01.000Z");
    row.record.last_build_error = { at: "2026-08-22T11:59:00.000Z" };
    const picked = await pickProspects({
      count: 1,
      lane: "sandbox",
      prospectIds: [row.prospect_id],
    }, exactDeps([row]));
    assert.deepEqual(picked.map((candidate) => candidate.prospectId), [row.prospect_id]);
  });

  await t.test("sport fencing truth is quarantined", async () => {
    const row = packetRow("sword-club", "Olympian Fencing Club", "2026-08-22T00:00:01.000Z");
    row.industry = "fencing";
    row.record.industry = "fencing";
    row.record.truth_packet.services = ["Sword classes", "Sabre coaching", "Foil training"];
    row.record.truth_packet.mirror_ready.industry = "fencing";
    row.record.truth_packet.mirror_ready.services = ["Sword classes", "Sabre coaching", "Foil training"];
    row.record.truth_packet.mirror_ready.business_name = "Olympian Fencing Club";
    let holds = 0;
    await refuses(row, {
      async conditionalUpdate() { holds += 1; return { ok: true, updated: true, rows: [] }; },
    }, "vertical_mismatch_sport_fencing");
    assert.equal(holds, 1);
  });

  await t.test("clean donor must resolve", async () => {
    const row = packetRow("no-donor", "No Donor Plumbing", "2026-08-22T00:00:01.000Z");
    await refuses(row, {
      resolveBuildableDonor() { return { ok: false, reason: "unavailable" }; },
    }, "clean_donor_unavailable:plumbing");
  });
});

test("exact owner retry uses a proven secondary trade when the primary has no clean donor", async () => {
  const row = packetRow("roy", "Roy Briley General Contracting, Fire & Water Damage Restoration", "2026-08-22T00:00:01.000Z");
  row.industry = "plumbing";
  row.record.industry = "plumbing";
  row.record.truth_packet.industry = "plumbing";
  row.record.truth_packet.services = ["Home Repair", "Emergency Repairs", "Roofing replacement and repairs"];
  row.record.truth_packet.mirror_ready.industry = "plumbing";
  row.record.truth_packet.mirror_ready.business_name = row.business_name;
  row.record.truth_packet.mirror_ready.services = row.record.truth_packet.services.map((name) => ({ name }));

  const picked = await pickProspects(
    { count: 1, prospectIds: [row.prospect_id] },
    exactDeps([row], {
      resolveBuildableDonor(vertical) {
        return vertical === "general contractor"
          ? { ok: true, donor: "general-contractor-clean" }
          : { ok: false, reason: "no_clean_donor_for_vertical" };
      },
    }),
  );
  assert.equal(picked.length, 1);
  assert.equal(picked[0].vertical, "general contractor");
});

test("one ineligible requested ID rejects the whole ordered selection", async () => {
  const good = packetRow("good", "Good Plumbing", "2026-08-22T00:00:01.000Z");
  const bad = packetRow("bad", "Bad Plumbing", "2026-08-22T00:00:02.000Z");
  bad.record.duplicate_of = "good";
  await assert.rejects(
    () => pickProspects({ count: 2, prospectIds: ["good", "bad"] }, exactDeps([bad, good])),
    (error) => error?.code === "explicit_prospect_ids_ineligible"
      && error.reasons.includes("duplicate_business"),
  );
});

test("encoded exact marker survives PII scrubbing and binds ordered idempotency identity", async () => {
  const ids = ["15550109999", "place_two"];
  const marker = createExplicitProspectMarker(ids);
  const scrubbed = sanitizeRowPayload([marker]);
  assert.doesNotMatch(JSON.stringify(scrubbed), /15550109999/);
  assert.deepEqual(readExplicitProspectMarker(scrubbed, { requested: 2 }).ids, ids);

  let stored = null;
  const persistence = createLinePersistence({
    now: () => new Date("2026-08-22T12:00:00.000Z"),
    async insertRow(table, row) {
      assert.equal(table, BATCH_TABLE);
      if (stored) return { ok: false, mode: "live_insert_failed", error: { code: "23505" } };
      stored = structuredClone(row);
      return { ok: true, mode: "live_write", data: [structuredClone(row)] };
    },
    async selectRows(table) {
      assert.equal(table, BATCH_TABLE);
      return { ok: true, mode: "live_select", rows: stored ? [structuredClone(stored)] : [] };
    },
  });
  const batch = {
    batchId: "line_req_deadbeefdeadbeefdeadbeefdeadbeef",
    lane: "sandbox",
    target: "owner-selected-packets",
    requested: 2,
    status: "building",
    pickState: "pending",
    mineFunnel: [marker],
  };
  assert.equal((await persistence.createBatch(batch)).created, true);
  assert.equal((await persistence.createBatch(structuredClone(batch))).idempotent, true);

  const reordered = {
    ...batch,
    mineFunnel: [createExplicitProspectMarker([...ids].reverse())],
  };
  const conflict = await persistence.createBatch(reordered);
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.error, "batch_identity_conflict");
});
