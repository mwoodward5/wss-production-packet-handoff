"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const lineState = require("../lib/line-state");
const runner = require("../lib/line-runner");
const { createLineHandler } = require("../api/admin/line");
const { qualifyForBuild } = require("../lib/build-qualification");
const { evaluateRenderGate, FACTS: renderGateFacts } = require("../lib/render-gate");
const { sendSequenceStep } = require("../lib/email");
const { durableProspectForSend } = require("../api/outreach/email-sequence");
const {
  rowToLineRow,
  pickProspects,
  mirrorProspect,
  sourceFactsFor,
  writePreviewUrl,
  queueEmail,
} = require("../lib/line-adapters");

// ---------------------------------------------------------------------------
// state machine
// ---------------------------------------------------------------------------

test("a row cannot skip the render gate to reach queued", () => {
  let row = lineState.newRow({ prospectId: "p1", businessName: "Acme" });
  row = lineState.advanceRow(row, "qualified").row;
  row = lineState.advanceRow(row, "mirrored", { previewUrl: "https://x.wss-ai.com/" }).row;
  // straight to queued, skipping gate_passed
  const jump = lineState.advanceRow(row, "queued", { previewUrl: "https://x.wss-ai.com/" });
  assert.equal(jump.ok, false);
  assert.equal(jump.error, "illegal_transition:mirrored->queued");
});

test("queued is unreachable when the attached gate verdict did not pass", () => {
  let row = lineState.newRow({ prospectId: "p1" });
  row = lineState.advanceRow(row, "qualified").row;
  row = lineState.advanceRow(row, "mirrored", { previewUrl: "https://x.wss-ai.com/" }).row;
  // Forge a row that CLAIMS gate_passed without a passing verdict.
  const forged = lineState.advanceRow(row, "gate_passed", { gate: { pass: false, failed: ["nap_match"] } });
  assert.equal(forged.ok, false);
  assert.equal(forged.error, "render_gate_did_not_pass");
});

test("a gate failure records WHICH fact failed and blocks the queue", () => {
  let row = lineState.newRow({ prospectId: "p1" });
  row = lineState.advanceRow(row, "qualified").row;
  row = lineState.advanceRow(row, "mirrored", { previewUrl: "https://x.wss-ai.com/" }).row;
  const gated = lineState.applyGate(row, {
    pass: false,
    failed: ["logo_own_and_unique", "donor_leak_zero"],
    blockedBy: "logo_own_and_unique: logoImgs=0 — no logo image renders in the DOM",
    checks: [],
  });
  assert.equal(gated.ok, true);
  assert.equal(gated.row.status, "gate_failed");
  assert.deepEqual(gated.row.failedFacts, ["logo_own_and_unique", "donor_leak_zero"]);
  assert.match(gated.row.reason, /logoImgs=0/);
  // and it is terminal
  assert.equal(lineState.advanceRow(gated.row, "queued").ok, false);
});

test("sendableRows returns nothing until the operator approves that exact batch", () => {
  const batch = lineState.newBatch({ batchId: "line_abc" });
  let row = lineState.newRow({ prospectId: "p1" });
  row = lineState.advanceRow(row, "qualified").row;
  row = lineState.advanceRow(row, "mirrored", { previewUrl: "https://x.wss-ai.com/" }).row;
  row = lineState.applyGate(row, { pass: true, failed: [], checks: [] }).row;
  row = lineState.advanceRow(row, "queued", { previewUrl: "https://x.wss-ai.com/" }).row;
  batch.rows = [row];

  assert.deepEqual(lineState.sendableRows(batch), [], "an unapproved batch must have no send targets");
  assert.throws(() => lineState.assertSendAuthorized(batch), /send_blocked/);

  const wrongEcho = lineState.approveBatch(batch, { typedBatchId: "line_xyz" });
  assert.equal(wrongEcho.ok, false);
  assert.equal(wrongEcho.error, "approval_confirmation_mismatch");

  const approved = lineState.approveBatch(batch, { typedBatchId: "line_abc", actor: "owner" });
  assert.equal(approved.ok, true);
  assert.equal(lineState.sendableRows(approved.batch).length, 1);
  assert.equal(lineState.assertSendAuthorized(approved.batch), true);
});

test("a batch where nothing passed the gate cannot be approved at all", () => {
  const batch = lineState.newBatch({ batchId: "line_none" });
  let row = lineState.newRow({ prospectId: "p1" });
  row = lineState.advanceRow(row, "qualified").row;
  row = lineState.advanceRow(row, "mirrored", { previewUrl: "https://x.wss-ai.com/" }).row;
  row = lineState.applyGate(row, { pass: false, failed: ["schema_type"], blockedBy: "schema_type: wrong" }).row;
  batch.rows = [row];
  const approved = lineState.approveBatch(batch, { typedBatchId: "line_none" });
  assert.equal(approved.ok, false);
  assert.equal(approved.error, "nothing_passed_the_render_gate");
});

// ---------------------------------------------------------------------------
// the runner: the flow end to end, with no network
// ---------------------------------------------------------------------------

/** A distinct 64-hex logo hash per prospect — one client, one logo. */
function shaFor(prospectId) {
  return require("node:crypto").createHash("sha256").update(String(prospectId || "")).digest("hex");
}

const LEGACY_HERO_FALLBACK_ENV = Object.freeze({ GHOST_AGENCY_HERO_AUTOLINE: "0" });

function fakeDeps({ gateVerdict, mirrorOk = true, qualifyOk = true } = {}) {
  const calls = { writes: 0, queues: 0, mirrors: 0 };
  return {
    calls,
    deps: {
      env: LEGACY_HERO_FALLBACK_ENV,
      pick: async ({ count }) =>
        Array.from({ length: Math.min(count, 3) }, (_, i) => ({
          prospectId: `p${i + 1}`,
          businessName: `Business ${i + 1}`,
          email: `owner${i + 1}@example.test`,
          hasEmail: true,
          contactReady: true,
          vertical: "plumbing",
        })),
      qualify: async () => ({ ok: qualifyOk, reason: qualifyOk ? "" : "grade A- — already has a modern site" }),
      // Operator-state tests isolate the line state machine from the dedicated
      // default-on owned-hero contract tests.
      prepareHero: async () => ({ ok: true, required: false, ready: true }),
      mirror: async () => {
        calls.mirrors += 1;
        return mirrorOk ? { ok: true, previewUrl: "https://x.wss-ai.com/" } : { ok: false, reason: "donor 500" };
      },
      sourceFacts: async () => ({ business_name: "Business 1", vertical: "plumbing" }),
      // EACH BUSINESS GETS ITS OWN LOGO. Do not collapse this back to one
      // shared sha "for simplicity": three different companies cannot own the
      // same logo bytes, and the runner now REFUSES the second and third row
      // that try to ship one — the check no longer depends on the gate stub
      // remembering to look, because under the worker pool the gate's read of
      // seenLogoShas can be stale. A fixture with a shared sha therefore reads
      // as a genuine collision and blocks two of the three rows.
      gate: async ({ source }) => ({
        ...gateVerdict,
        checks: (gateVerdict.checks || []).map((check) => (
          check.fact === "logo_own_and_unique" && check.evidence && check.evidence.sha256
            ? { ...check, evidence: { ...check.evidence, sha256: shaFor(source.prospect_id) } }
            : check
        )),
      }),
      writePreviewUrl: async () => { calls.writes += 1; return { ok: true }; },
      queueEmail: async () => { calls.queues += 1; return { ok: true }; },
    },
  };
}

test("a failing gate blocks the preview_url write AND the queue for that row", async () => {
  runner.resetBatches();
  const { calls, deps } = fakeDeps({
    gateVerdict: { pass: false, failed: ["nap_match"], blockedBy: "nap_match: rendered DOM is missing postal_city:Buda", checks: [] },
  });
  const result = await runner.startBatch({ count: 3, lane: "sandbox" }, deps);
  assert.equal(result.ok, true);
  assert.equal(calls.mirrors, 3, "all three were mirrored");
  assert.equal(calls.writes, 0, "no preview_url may be written behind a failed gate");
  assert.equal(calls.queues, 0, "no email may be queued behind a failed gate");
  const counts = lineState.batchCounts(result.batch);
  assert.equal(counts.queued, 0);
  assert.equal(counts.failed, 3);
  assert.match(result.batch.rows[0].reason, /postal_city:Buda/);
});

test("a passing gate writes the URL, queues the email, and stops there", async () => {
  runner.resetBatches();
  const { calls, deps } = fakeDeps({
    gateVerdict: { pass: true, failed: [], checks: [{ fact: "logo_own_and_unique", pass: true, evidence: { sha256: "a".repeat(64) } }] },
  });
  const result = await runner.startBatch({ count: 3, lane: "sandbox" }, deps);
  assert.equal(calls.writes, 3);
  assert.equal(calls.queues, 3);
  assert.equal(lineState.batchCounts(result.batch).queued, 3);
  assert.equal(result.batch.status, "awaiting_approval", "a finished build phase awaits the operator, it does not send");
  assert.equal(result.batch.rows.every((r) => r.status === "queued"), true);
});

test("an unqualified row never reaches a mirror — spend is gated before it is spent", async () => {
  runner.resetBatches();
  const { calls, deps } = fakeDeps({ qualifyOk: false, gateVerdict: { pass: true, failed: [], checks: [] } });
  const result = await runner.startBatch({ count: 3, lane: "sandbox" }, deps);
  assert.equal(calls.mirrors, 0);
  assert.equal(result.batch.rows.every((r) => r.status === "rejected"), true);
  assert.match(result.batch.rows[0].reason, /modern site/);
});

function buildReadyDbRow(overrides = {}) {
  const sha = overrides.sha || "a".repeat(64);
  const score = Object.prototype.hasOwnProperty.call(overrides, "score") ? overrides.score : 55;
  const prospectId = overrides.prospectId || "wss-test-acme-fence-tulsa";
  const facts = {
    business_name: overrides.businessName || "Acme Fence",
    industry: "fencing",
    city: "Tulsa",
    state: "OK",
    phone: "(918) 555-0134",
    email: "owner@acmefence.com",
    current_website: "https://acme.test",
    rating: 4.8,
    review_count: 27,
  };
  return {
    prospect_id: prospectId,
    business_name: facts.business_name,
    email: facts.email,
    industry: facts.industry,
    city: facts.city,
    state: facts.state,
    status: overrides.status || "new",
    updated_at: overrides.updatedAt || "2026-08-01T12:00:00.000Z",
    record: {
      ...(overrides.consent ? { preview_build_consent: overrides.consent } : {}),
      build_ready: {
        version: 1,
        slug: prospectId,
        donor: "fencing-donor",
        mirror_request: {
          slug: prospectId,
          donor: "fencing-donor",
          facts,
          brand: { logo: "https://acme.test/logo.png", logo_sha256: sha, accent: "#2457d6" },
        },
        proof: { dry_run_ok: true, build_hash: overrides.buildHash || "build-proof-1" },
        brand_evidence: { logo_sha256: sha, accent: "#2457d6" },
        qualification: {
          website_axis: { score, grade: "D+", measured: ["websitePerformance"], missing: [] },
          composite_signal: { score: 62, grade: "C" },
        },
      },
    },
  };
}

function ownerOnlyPracticeAdmission(row) {
  const scoped = structuredClone(row);
  const buildReady = scoped.record.build_ready;
  buildReady.admission_scope = "owner_only_practice";
  buildReady.identity_source = "first_party";
  buildReady.provenance = {
    business_name: {
      class: "self_published",
      source_url: buildReady.mirror_request.facts.current_website,
    },
  };
  buildReady.qualification.template_fit = {
    ok: true,
    original_ok: false,
    advisory: true,
  };
  buildReady.trade_corroboration = { ok: true, advisory: true, requested_trade: scoped.industry };
  assert.notEqual(buildReady.identity_provisional, true);
  return scoped;
}

test("a qualified row without consent builds, gate-passes, writes and queues, but cannot send", async () => {
  runner.resetBatches();
  const dbRow = buildReadyDbRow();
  const mapped = { ...rowToLineRow(dbRow), hasEmail: true, contactReady: true };
  const sha = dbRow.record.build_ready.brand_evidence.logo_sha256;
  assert.equal(Object.hasOwn(mapped, "__row"), false, "the full durable row must not be retained in line memory");
  assert.equal(mapped.durableUpdatedAt, dbRow.updated_at);
  let qualifiedRow;
  let writes = 0;
  let queues = 0;
  const durablePatches = [];
  let canonicalRow = structuredClone(dbRow);
  const conditionalUpdate = async (_table, _key, _id, _expected, patch) => {
    durablePatches.push(patch);
    canonicalRow = { ...canonicalRow, ...structuredClone(patch) };
    return { ok: true, updated: true, rows: [structuredClone(canonicalRow)] };
  };
  const result = await runner.startBatch({ count: 1, lane: "sandbox" }, {
    env: LEGACY_HERO_FALLBACK_ENV,
    pick: async () => [mapped],
    qualify: async (row) => {
      qualifiedRow = row;
      const verdict = qualifyForBuild(row.qualification);
      return { ok: verdict.ok, reason: verdict.reasons.join("; ") };
    },
    prepareHero: async () => ({ ok: true, required: false, ready: true }),
    mirror: async (row, context) => mirrorProspect(row, {
      ...context,
      select: async () => ({ ok: true, data: [dbRow] }),
      fullRun: {
        mirrorLaneEnabled: () => true,
        dispatchMirrorLane: async () => ({ urls: { preview_url: "https://wss-test-acme-fence-tulsa.wss-ai.com/" } }),
      },
    }),
    sourceFacts: async () => ({
      prospect_id: dbRow.prospect_id,
      business_name: "Acme Fence",
      phone: "(918) 555-0134",
      postal_city: "Tulsa",
      vertical: "fencing",
      logo_sha256: sha,
      donor_strings: ["Legacy Donor Fence Company"],
      rating_value: 4.8,
      rating_count: 27,
      unverified_claims: [],
    }),
    gate: async ({ url, source, seenLogoShas }) => evaluateRenderGate({
      source,
      seenLogoShas,
      dom: {
        ok: true,
        url,
        title: "Acme Fence | Tulsa",
        innerText: "Acme Fence\n(918) 555-0134\nTulsa\nFence and gate installation",
        hrefs: [],
        imgs: [],
        logos: [{ sha256: sha }],
        jsonld: [{ "@type": "HomeAndConstructionBusiness" }],
      },
    }),
    writePreviewUrl: async (row, url) => {
      writes += 1;
      return writePreviewUrl(row, url, { conditionalUpdate });
    },
    queueEmail: async (row) => {
      queues += 1;
      return queueEmail(row, {
        conditionalUpdate,
        select: async () => ({ ok: true, data: [structuredClone(canonicalRow)] }),
      });
    },
  });

  assert.deepEqual(result.batch.rows[0].history.map((entry) => entry.status), ["picked", "qualified", "mirrored", "gate_passed", "queued"]);
  assert.equal(result.batch.rows[0].gate.checks.length, renderGateFacts.length);
  assert.equal(result.batch.rows[0].gate.pass, true);
  assert.equal(writes, 1);
  assert.equal(queues, 1);
  assert.equal(result.batch.status, "awaiting_approval");
  assert.equal(dbRow.record.preview_build_consent, undefined);
  assert.deepEqual(durablePatches.map((patch) => patch.status), ["line_gate_passed", "line_queued"]);
  const dripSource = fs.readFileSync(require.resolve("../api/cron/drip-scheduler"), "utf8");
  const dripStatuses = dripSource.match(/status=in\.\(([^)]+)\)/)[1].split(",").map((value) => value.trim());
  assert.equal(durablePatches.some((patch) => dripStatuses.includes(patch.status)), false);
  let sent = 0;
  await assert.rejects(
    () => runner.sendApprovedBatch(result.batchId, { send: async () => { sent += 1; return { ok: true }; } }),
    /send_blocked/,
  );
  assert.equal(sent, 0);
  assert.doesNotMatch(result.batch.rows[0].reason, /unmeasured/i);
  assert.deepEqual(qualifiedRow.proof, dbRow.record.build_ready.proof);
  assert.deepEqual(qualifiedRow.brand_evidence, dbRow.record.build_ready.brand_evidence);
});

test("targeted mining accepts only created or updated rows with the exact durable build hash", async () => {
  const created = buildReadyDbRow({ prospectId: "created-row", buildHash: "hash-created" });
  const updated = buildReadyDbRow({ prospectId: "updated-row", buildHash: "hash-updated" });
  const ignoredDuplicate = buildReadyDbRow({ prospectId: "duplicate-row", buildHash: "hash-duplicate" });
  let reloadQuery = "";
  const targeted = await pickProspects({ target: "fencing in Tulsa", count: 50 }, {
    mineLeads: async () => ({
      ok: true,
      rows: [
        { prospect_id: created.prospect_id, persistence: "created", build_hash: "hash-created" },
        { prospect_id: updated.prospect_id, persistence: "updated", build_hash: "hash-updated" },
        { prospect_id: ignoredDuplicate.prospect_id, persistence: "duplicate_skipped", build_hash: "hash-duplicate" },
        { prospect_id: "hashless-row", persistence: "created" },
      ],
    }),
    select: async (_table, query) => {
      reloadQuery = query;
      return { ok: true, data: [updated, ignoredDuplicate, created] };
    },
    selectRows: async () => { throw new Error("targeted mining must not use the global freshest-row list"); },
  });
  assert.deepEqual(targeted.map((row) => row.prospectId), [created.prospect_id, updated.prospect_id]);
  assert.match(reloadQuery, /created-row/);
  assert.match(reloadQuery, /updated-row/);
  assert.doesNotMatch(reloadQuery, /duplicate-row|hashless-row/);

  await assert.rejects(
    () => pickProspects({ target: "fencing in Tulsa", count: 50 }, {
      mineLeads: async () => ({
        ok: true,
        rows: [{ prospect_id: created.prospect_id, persistence: "created", build_hash: "different-hash" }],
      }),
      select: async () => ({ ok: true, data: [created] }),
    }),
    /mining_failed: persisted_contract_hash_mismatch/,
    "a reload that cannot prove the exact mined build hash must halt the batch",
  );
});

test("stored selection retains blank contracts with a precise issue and excludes every terminal contact status", async () => {
  const blank = {
    prospect_id: "blank-contract",
    business_name: "Blank Contract Lead",
    email: "hello@blankcontract.com",
    status: "new",
    updated_at: "2026-08-01T12:00:00.000Z",
    record: {},
  };
  const terminalStatuses = ["line_gate_passed", "line_queued", "previewed", "packeted", "sent", "opted_out"];
  const terminalRows = terminalStatuses.map((status) => ({
    ...buildReadyDbRow({ prospectId: `terminal-${status}`, status }),
    status,
  }));

  const stored = await pickProspects({ target: "", count: 50 }, {
    selectRows: async () => ({ rows: [blank, ...terminalRows] }),
  });
  assert.deepEqual(stored.map((row) => row.prospectId), [blank.prospect_id]);
  const blankIssue = "build_ready_contract_incomplete:proof,qualification,brand_evidence,mirror_request";
  assert.equal(stored[0].contractIssue, blankIssue);

  let qualifyCalls = 0;
  let mirrorCalls = 0;
  const result = await runner.startBatch({ count: 1, lane: "sandbox" }, {
    pick: async () => stored,
    qualify: async () => { qualifyCalls += 1; return { ok: true }; },
    mirror: async () => { mirrorCalls += 1; return { ok: true, previewUrl: "https://blank-contract.wss-ai.com/" }; },
  });
  assert.equal(result.batch.rows[0].status, "rejected");
  assert.equal(result.batch.rows[0].reason, blankIssue);
  assert.equal(qualifyCalls, 0);
  assert.equal(mirrorCalls, 0);
});

test("stored provisional identity remains selectable for Practice but is skipped by live selection", async () => {
  const provisional = buildReadyDbRow({ prospectId: "practice-provisional" });
  provisional.record.build_ready.identity_provisional = true;
  const durable = buildReadyDbRow({ prospectId: "live-durable" });
  const selectRows = async () => ({ rows: [provisional, durable] });

  const practice = await pickProspects({ target: "", count: 2, lane: "sandbox" }, { selectRows });
  assert.deepEqual(
    new Set(practice.map((row) => row.prospectId)),
    new Set([provisional.prospect_id, durable.prospect_id]),
  );

  const live = await pickProspects({ target: "", count: 2, lane: "live" }, { selectRows });
  assert.deepEqual(live.map((row) => row.prospectId), [durable.prospect_id]);
});

test("stored owner-only Practice admission is selectable in Practice and skipped by live generic selection", async () => {
  const ownerOnly = ownerOnlyPracticeAdmission(buildReadyDbRow({ prospectId: "practice-scope-stored" }));
  const durable = buildReadyDbRow({ prospectId: "live-scope-stored" });
  const selectRows = async () => ({ rows: [ownerOnly, durable] });

  const practice = await pickProspects({ target: "", count: 2, lane: "sandbox" }, { selectRows });
  assert.deepEqual(
    new Set(practice.map((row) => row.prospectId)),
    new Set([ownerOnly.prospect_id, durable.prospect_id]),
  );

  const live = await pickProspects({ target: "", count: 2, lane: "live" }, { selectRows });
  assert.deepEqual(live.map((row) => row.prospectId), [durable.prospect_id]);
});

test("fresh persisted owner-only Practice admission is accepted in Practice and refused by live before Intake", async () => {
  const row = ownerOnlyPracticeAdmission(buildReadyDbRow({
    prospectId: "practice-scope-fresh",
    buildHash: "practice-scope-fresh-build",
  }));

  let mineCalls = 0;
  let reloadCalls = 0;
  function depsFor({ intakeCall } = {}) {
    return {
      select: async (_table, query) => {
        if (String(query).includes("truth_packet_source")) return { ok: true, data: [] };
        reloadCalls += 1;
        return { ok: true, data: [row] };
      },
      mineLeads: async () => {
        mineCalls += 1;
        return {
          ok: true,
          rows: [{
            prospect_id: row.prospect_id,
            persistence: "created",
            build_hash: row.record.build_ready.proof.build_hash,
          }],
        };
      },
      certificationKey: "test-certification-key-for-practice-scope-guard",
      ...(typeof intakeCall === "function" ? { callIntakeGenie: intakeCall } : {}),
    };
  }

  const practice = await pickProspects(
    { target: "fencing in Tulsa OK", count: 1, lane: "sandbox" },
    depsFor(),
  );
  assert.deepEqual(practice.map((candidate) => candidate.prospectId), [row.prospect_id]);
  assert.equal(mineCalls, 1, "Practice admits the fresh candidate persisted by the miner");
  assert.equal(reloadCalls, 1, "Practice reloads the exact persisted contract before admission");

  mineCalls = 0;
  reloadCalls = 0;
  let liveIntakeCalls = 0;
  const live = await pickProspects(
    { target: "fencing in Tulsa OK", count: 1, lane: "live" },
    depsFor({
      intakeCall: async () => {
        liveIntakeCalls += 1;
        throw new Error("owner-only Practice admission reached Intake in live fresh selection");
      },
    }),
  );
  assert.equal(live.length, 0);
  assert.equal(mineCalls, 1);
  assert.equal(reloadCalls, 1);
  assert.equal(liveIntakeCalls, 0);
  assert.equal(live.quarantined?.[0]?.reason, "owner_only_practice_admission");
});

test("website axis score is optional telemetry, never an admission gate (owner directive 08-31: weak old sites are the best customers)", () => {
  for (const score of [null, "", 0, undefined]) {
    const row = buildReadyDbRow();
    if (score === undefined) delete row.record.build_ready.qualification.website_axis;
    else row.record.build_ready.qualification.website_axis.score = score;
    assert.equal(rowToLineRow(row).contractIssue, "");
  }
});

test("composite signal score is optional telemetry under the content-and-images directive (08-31)", () => {
  for (const score of [undefined, null, "", 0]) {
    const row = buildReadyDbRow();
    if (score === undefined) delete row.record.build_ready.qualification.composite_signal;
    else row.record.build_ready.qualification.composite_signal.score = score;
    assert.equal(rowToLineRow(row).contractIssue, "");
  }
});

test("legacy category objects cannot hide the measured website axis", () => {
  for (const categories of [{}, { reputation: { score: 72, grade: "B" } }]) {
    const row = buildReadyDbRow();
    row.record.build_ready.qualification.categories = categories;
    const mapped = rowToLineRow(row);
    const verdict = qualifyForBuild(mapped.qualification);
    assert.equal(mapped.qualification.categories.websitePerformance.score, 55);
    assert.doesNotMatch(verdict.reasons.join("; "), /unmeasured/i);
  }
});

test("a measured direct contract stays authoritative and supplies verified prospect facts", () => {
  const row = buildReadyDbRow({ businessName: "Verified Fence", buildHash: "direct-hash" });
  row.business_name = "Stale Top-Level Name";
  row.email = "";
  row.city = "Stale City";
  row.record.last_mine_observation = {
    build_ready: buildReadyDbRow({ businessName: "Observed Fence", buildHash: "observation-hash", score: 12 }).record.build_ready,
  };

  const mapped = rowToLineRow(row);
  assert.equal(mapped.businessName, "Verified Fence");
  assert.equal(mapped.email, "owner@acmefence.com");
  assert.equal(mapped.city, "Tulsa");
  assert.equal(mapped.proof.build_hash, "direct-hash");
  assert.equal(mapped.qualification.categories.websitePerformance.score, 55);
  assert.equal(mapped.contractIssue, "");
});

test("a starved direct contract falls back to the measured mine observation", () => {
  const row = buildReadyDbRow({ businessName: "Observed Recovery Fence" });
  const measuredObservation = structuredClone(row.record.build_ready);
  measuredObservation.proof.build_hash = "observation-hash";
  row.record.build_ready = {
    version: 1,
    qualification: { website_axis: { score: null } },
  };
  row.record.last_mine_observation = { build_ready: measuredObservation };

  const mapped = rowToLineRow(row);
  assert.equal(mapped.businessName, "Observed Recovery Fence");
  assert.equal(mapped.proof.build_hash, "observation-hash");
  assert.equal(mapped.qualification.categories.websitePerformance.score, 55);
  assert.equal(mapped.contractIssue, "");
});

test("sandbox owner proof fresh-reads the contract and uses only the enabled canonical mirror dispatcher", async () => {
  const staleInput = buildReadyDbRow({ businessName: "Stale Input Fence" });
  const durable = buildReadyDbRow({ businessName: "Durable Fence" });
  const mapped = rowToLineRow(staleInput);
  const durableRecordBefore = structuredClone(durable.record);
  let selectCalls = 0;
  let dispatchCalls = 0;
  let directBuildCalls = 0;
  let legacyMirrorCalls = 0;
  const readDurable = async (_table, query) => {
    selectCalls += 1;
    assert.match(query, new RegExp(mapped.prospectId));
    return { ok: true, data: [durable] };
  };
  const fullRun = {
    mirrorLaneEnabled: () => true,
    dispatchMirrorLane: async (prospect) => {
      dispatchCalls += 1;
      assert.equal(prospect.business_name, "Durable Fence", "dispatch must use the fresh durable row, not mapped stale input");
      return { urls: { preview_url: "https://wss-test-acme-fence-tulsa.wss-ai.com/" } };
    },
    buildPreviewForProspect: async () => { directBuildCalls += 1; throw new Error("sandbox must not use the direct preview builder"); },
  };
  const sandbox = await mirrorProspect(mapped, {
    lane: "sandbox",
    select: readDurable,
    fullRun,
    mirror: async () => { legacyMirrorCalls += 1; throw new Error("legacy mirror shortcut must not run"); },
  });
  assert.equal(sandbox.ok, true);
  assert.equal(sandbox.authorization, "owner_funded_spec_build");
  assert.equal(selectCalls, 1);
  assert.equal(dispatchCalls, 1);
  assert.equal(directBuildCalls, 0);
  assert.equal(legacyMirrorCalls, 0);
  assert.deepEqual(durable.record, durableRecordBefore, "sandbox proof must not invent or persist consent");
  assert.equal(durable.record.preview_build_consent, undefined);

  const disabled = await mirrorProspect(mapped, {
    lane: "sandbox",
    select: readDurable,
    fullRun: {
      mirrorLaneEnabled: () => false,
      dispatchMirrorLane: async () => { throw new Error("disabled lane must not dispatch"); },
    },
  });
  assert.equal(disabled.ok, false);
  assert.equal(disabled.reason, "mirror_lane_disabled");
  assert.equal(disabled.terminal, "rejected");

  const notRevealable = await mirrorProspect(mapped, {
    lane: "sandbox",
    select: readDurable,
    fullRun: {
      mirrorLaneEnabled: () => true,
      dispatchMirrorLane: async () => null,
    },
  });
  assert.equal(notRevealable.ok, false);
  assert.equal(notRevealable.reason, "mirror_dispatch_failed_before_build");

  const missingUrl = await mirrorProspect(mapped, {
    lane: "sandbox",
    select: readDurable,
    fullRun: {
      mirrorLaneEnabled: () => true,
      dispatchMirrorLane: async () => ({ urls: {} }),
    },
  });
  assert.equal(missingUrl.ok, false, "only a canonical dispatch with a revealable URL may pass");
  assert.match(missingUrl.reason, /host-approved preview URL/);
});

test("live and omitted lanes build without prospect consent through the canonical dispatcher", async () => {
  const durable = buildReadyDbRow();
  const mapped = rowToLineRow(durable);
  let buildCalls = 0;
  let dispatchCalls = 0;
  const readDurable = async () => ({ ok: true, data: [durable] });
  const fullRun = {
    mirrorLaneEnabled: () => true,
    dispatchMirrorLane: async () => {
      dispatchCalls += 1;
      return { urls: { preview_url: "https://wss-test-acme-fence-tulsa.wss-ai.com/" } };
    },
    buildPreviewForProspect: async () => { buildCalls += 1; throw new Error("Line must not use the legacy consent-gated builder"); },
  };

  for (const options of [{ lane: "live" }, {}]) {
    const result = await mirrorProspect(mapped, { ...options, select: readDurable, fullRun });
    assert.equal(result.ok, true);
    assert.equal(result.authorization, "owner_funded_spec_build");
  }
  assert.equal(buildCalls, 0);
  assert.equal(dispatchCalls, 2);
  assert.equal(durable.record.preview_build_consent, undefined);
});

test("build-ready source facts preserve NAP, logo, rating, and the real donor fingerprint", async () => {
  const dbRow = buildReadyDbRow();
  const facts = await sourceFactsFor(rowToLineRow(dbRow), {
    select: async () => ({ ok: true, data: [dbRow] }),
    resolveDonor: () => ({
      ok: true,
      manifest: {
        donor_business_name: "Legacy Donor Fence Company",
        donor_phone: "(512) 555-0199",
        donor_city: "Austin",
        donor_domain: "legacy-donor.test",
      },
    }),
  });
  assert.equal(facts.business_name, "Acme Fence");
  assert.equal(facts.phone, "(918) 555-0134");
  assert.equal(facts.postal_city, "Tulsa");
  assert.equal(facts.vertical, "fencing");
  assert.equal(facts.logo_sha256, "a".repeat(64));
  assert.equal(facts.rating_value, 4.8);
  assert.equal(facts.rating_count, 27);
  assert.deepEqual(facts.donor_strings, [
    "Legacy Donor Fence Company",
    "(512) 555-0199",
    "legacy-donor.test",
  ]);
});

test("write and queue require real conditional updates plus durable version, status, and preview guards", async () => {
  let calls = 0;
  const missingVersion = await writePreviewUrl(
    { prospectId: "p1" },
    "https://p1.wss-ai.com/",
    { conditionalUpdate: async () => { calls += 1; return { ok: true, updated: true }; } },
  );
  assert.equal(missingVersion.ok, false);
  assert.equal(missingVersion.reason, "preview_url_write_version_missing");
  assert.equal(calls, 0);

  const updates = [];
  const update = async (table, key, id, expected, patch) => {
    updates.push({ table, key, id, expected, patch });
    return { ok: true, updated: true };
  };
  const row = {
    prospectId: "p1",
    email: "owner@acmefence.com",
    previewUrl: "https://p1.wss-ai.com/",
    durableUpdatedAt: "2026-08-01T12:00:00.000Z",
  };
  assert.equal((await writePreviewUrl(row, row.previewUrl, { conditionalUpdate: update })).ok, true);
  assert.deepEqual(updates[0].expected, { updated_at: "eq.2026-08-01T12:00:00.000Z" });
  assert.equal(updates[0].patch.status, "line_gate_passed");
  assert.equal(updates[0].patch.preview_url, row.previewUrl);

  assert.equal((await queueEmail({ ...row, previewUrl: "javascript:alert(1)" }, { conditionalUpdate: update })).reason, "queue_preview_url_invalid");
  const canonical = {
    prospect_id: row.prospectId,
    email: "Owner@AcmeFence.COM",
    preview_url: row.previewUrl,
    status: "line_gate_passed",
    updated_at: row.durableUpdatedAt,
    record: { status: "line_gate_passed", email: "Owner@AcmeFence.COM" },
  };
  const selectQueries = [];
  const selectCanonical = async (_table, query) => {
    selectQueries.push(query);
    return { ok: true, data: [canonical] };
  };
  assert.equal((await queueEmail(row, { conditionalUpdate: update, select: selectCanonical })).ok, true);
  assert.match(selectQueries[0], /^\?select=prospect_id,email,owner_email,preview_url,status,updated_at,record&/);
  assert.doesNotMatch(
    selectQueries[0],
    /(?:select=|,)suppressed(?:,|&)/,
    "queue reads must not project the nonexistent top-level suppressed column",
  );
  assert.doesNotMatch(selectQueries[0], /select=\*/);
  assert.deepEqual(updates[1].expected, {
    status: "eq.line_gate_passed",
    preview_url: `eq.${row.previewUrl}`,
    email: "eq.Owner@AcmeFence.COM",
    updated_at: `eq.${row.durableUpdatedAt}`,
    "record->>status": "eq.line_gate_passed",
  });
  assert.equal(updates[1].patch.status, "line_queued");

  const sandboxNoContact = {
    ...canonical,
    email: "",
    record: { status: "line_gate_passed", contactReady: false },
  };
  const sandboxUpdates = [];
  const sandboxQueued = await queueEmail(
    { ...row, email: "", hasEmail: false, contactReady: false },
    {
      lane: "sandbox",
      ownerEmail: "owner@example.test",
      select: async () => ({ ok: true, data: [sandboxNoContact] }),
      conditionalUpdate: async (_table, _key, _id, guards, patch) => {
        sandboxUpdates.push({ guards, patch });
        return { ok: true, updated: true, rows: [{ ...sandboxNoContact, ...patch }] };
      },
    },
  );
  assert.equal(sandboxQueued.ok, true);
  assert.equal(sandboxQueued.rowPatch.hasEmail, false);
  assert.equal(sandboxQueued.rowPatch.contactReady, false);
  assert.equal(Object.hasOwn(sandboxUpdates[0].guards, "email"), false);

  const falseSuccess = async () => ({ ok: true, updated: false });
  assert.equal((await writePreviewUrl(row, row.previewUrl, { conditionalUpdate: falseSuccess })).reason, "preview_url_write_conflict");
  assert.equal((await queueEmail(row, { conditionalUpdate: falseSuccess, select: selectCanonical })).reason, "queue_write_conflict");
});

test("sandbox owner queue never bypasses explicit suppression or do-not-contact", async (t) => {
  const previewUrl = "https://p1.wss-ai.com/";
  const base = {
    prospect_id: "p1",
    email: "",
    preview_url: previewUrl,
    status: "line_gate_passed",
    updated_at: "2026-08-01T12:00:00.000Z",
    record: { status: "line_gate_passed", contactReady: false },
  };
  const cases = [
    { name: "record suppressed", durable: { ...base, record: { ...base.record, suppressed: true } } },
    { name: "do_not_contact", durable: { ...base, record: { ...base.record, do_not_contact: true } } },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      let updates = 0;
      const result = await queueEmail(
        {
          prospectId: "p1",
          email: "",
          hasEmail: false,
          contactReady: false,
          previewUrl,
        },
        {
          lane: "sandbox",
          ownerEmail: "owner@example.test",
          select: async () => ({ ok: true, data: [item.durable] }),
          conditionalUpdate: async () => {
            updates += 1;
            return { ok: true, updated: true };
          },
        },
      );

      assert.equal(result.ok, false);
      assert.equal(result.reason, "queue_contact_suppressed");
      assert.equal(updates, 0, "suppressed owner proof cannot mutate the durable queue state");
    });
  }
});

test("drip source selection cannot include line-owned statuses and line sends still need explicit approval", () => {
  const source = fs.readFileSync(require.resolve("../api/cron/drip-scheduler"), "utf8");
  const match = source.match(/status=in\.\(([^)]+)\)/);
  assert.ok(match, "the drip scheduler must use an explicit prospect status allowlist");
  const statuses = match[1].split(",").map((value) => value.trim());
  assert.deepEqual(statuses, ["reported", "packeted", "previewed"]);
  assert.equal(statuses.includes("line_gate_passed"), false);
  assert.equal(statuses.includes("line_queued"), false);

  const batch = lineState.newBatch({ batchId: "line_persisted_queue" });
  let row = lineState.newRow({ prospectId: "p1" });
  row = lineState.advanceRow(row, "qualified").row;
  row = lineState.advanceRow(row, "mirrored", { previewUrl: "https://p1.wss-ai.com/" }).row;
  row = lineState.applyGate(row, { pass: true, failed: [], checks: [] }).row;
  row = lineState.advanceRow(row, "queued", { previewUrl: row.previewUrl }).row;
  batch.rows = [row];
  assert.deepEqual(lineState.sendableRows(batch), [], "line_queued never substitutes for explicit batch approval");
});

test("the global email seam rejects a Line row unless Step-3 approval authorized the call", async () => {
  for (const status of ["line_gate_passed", "line_queued"]) {
    const result = await sendSequenceStep({
      prospect: {
        prospect_id: `blocked-${status}`,
        business_name: "Blocked Line Prospect",
        email: "qa@wss-ai.com",
        status,
      },
      sequence: 1,
      step: 1,
      dryRun: false,
    });
    assert.equal(result.ok, false);
    assert.equal(result.blocked, "line_batch_approval_required");
  }

  const lineApiSource = fs.readFileSync(require.resolve("../api/admin/line"), "utf8");
  assert.match(lineApiSource, /lineBatchApproved:\s*true/);
});

test("an owner proof of a Line row is not a business contact, so the batch gate does not hold it", async () => {
  // The gate protects the BUSINESS. internalOwnerProof replaces the recipient
  // with the configured owner and empties cc/bcc, so it cannot reach one — and
  // while this gate fired first, /api/admin/send-mirror-proof could not show
  // the owner a single one of his own Line-built mirrors.
  const previousOwner = process.env.GHOST_AGENCY_OWNER_EMAIL;
  process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@wss-ai.com";
  try {
    for (const status of ["line_gate_passed", "line_queued"]) {
      const result = await sendSequenceStep({
        prospect: {
          prospect_id: `owner-proof-${status}`,
          business_name: "Line Prospect",
          // The route sets this to the owner before calling; the recipient
          // assertion inside lib/email.js then confirms it.
          email: "owner@wss-ai.com",
          status,
        },
        sequence: 1,
        step: 1,
        dryRun: true,
        internalOwnerProof: true,
      });
      assert.notEqual(
        result.blocked,
        "line_batch_approval_required",
        `owner proof of a ${status} row must not be refused as an unapproved business contact`,
      );
    }
  } finally {
    if (previousOwner === undefined) delete process.env.GHOST_AGENCY_OWNER_EMAIL;
    else process.env.GHOST_AGENCY_OWNER_EMAIL = previousOwner;
  }
});

test("the direct email API cannot hide or override a durable Line status", async () => {
  for (const suppliedStatus of [undefined, "new"]) {
    const prospect = {
      prospect_id: "durable-line-row",
      business_name: "Durable Line Prospect",
      email: "qa@wss-ai.com",
      ...(suppliedStatus ? { status: suppliedStatus } : {}),
    };
    const result = await durableProspectForSend(prospect, async (_table, query) => {
      assert.match(query, /prospect_id=eq\.durable-line-row/);
      return {
        ok: true,
        data: [{
          prospect_id: "durable-line-row",
          status: "line_queued",
          record: { status: "line_queued" },
        }],
      };
    });
    assert.equal(result.ok, false);
    assert.equal(result.blocked, "line_batch_approval_required");
  }
});

test("the direct email API binds every send identity field to the durable row", async () => {
  const supplied = {
    prospect_id: "durable-non-line-row",
    business_name: "Forged Line Business",
    email: "line-business@example.test",
    preview_url: "https://line-business.wss-ai.com/",
    status: "new",
    record: { status: "new", injected: true },
  };
  const stored = {
    prospect_id: "durable-non-line-row",
    business_name: "Durable Non-Line Business",
    email: "durable-business@example.test",
    preview_url: "https://durable-business.wss-ai.com/",
    status: "new",
    record: { status: "new", durable: true },
  };
  const result = await durableProspectForSend(supplied, async (_table, query) => {
    assert.match(query, /select=\*/);
    return { ok: true, data: [stored] };
  });
  assert.equal(result.ok, true);
  assert.equal(result.prospect.business_name, stored.business_name);
  assert.equal(result.prospect.email, stored.email);
  assert.equal(result.prospect.preview_url, stored.preview_url);
  assert.deepEqual(result.prospect.record, stored.record);

  const mismatch = await durableProspectForSend(supplied, async () => ({
    ok: true,
    data: [{ ...stored, prospect_id: "different-durable-row" }],
  }));
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.blocked, "prospect_identity_mismatch");
});

test("the same logo shipping twice in one batch fails the second row", async () => {
  runner.resetBatches();
  const sha = "a".repeat(64);
  const seenByGate = [];
  const deps = {
    env: LEGACY_HERO_FALLBACK_ENV,
    pick: async () => [
      { prospectId: "p1", businessName: "One", vertical: "plumbing", email: "a@x.test", hasEmail: true, contactReady: true },
      { prospectId: "p2", businessName: "Two", vertical: "plumbing", email: "b@x.test", hasEmail: true, contactReady: true },
    ],
    qualify: async () => ({ ok: true }),
    prepareHero: async () => ({ ok: true, required: false, ready: true }),
    mirror: async () => ({ ok: true, previewUrl: "https://x.wss-ai.com/" }),
    sourceFacts: async () => ({}),
    gate: async ({ seenLogoShas, source }) => {
      seenByGate.push(new Map(seenLogoShas));
      const collision = seenLogoShas.get(sha);
      if (collision && collision !== source.prospect_id) {
        return { pass: false, failed: ["logo_own_and_unique"], blockedBy: `logo_own_and_unique: already shipped for ${collision}`, checks: [] };
      }
      return { pass: true, failed: [], checks: [{ fact: "logo_own_and_unique", pass: true, evidence: { sha256: sha } }] };
    },
    writePreviewUrl: async () => ({ ok: true }),
    queueEmail: async () => ({ ok: true }),
  };
  const result = await runner.startBatch({ count: 2, lane: "sandbox" }, deps);
  assert.equal(result.batch.rows[0].status, "queued");
  assert.equal(result.batch.rows[1].status, "gate_failed");
  assert.match(result.batch.rows[1].reason, /already shipped for p1/);
});

test("sendApprovedBatch refuses an unapproved batch and never calls the sender", async () => {
  runner.resetBatches();
  const { deps } = fakeDeps({ gateVerdict: { pass: true, failed: [], checks: [] } });
  const started = await runner.startBatch({ count: 2, lane: "sandbox" }, deps);
  let sent = 0;
  await assert.rejects(
    () => runner.sendApprovedBatch(started.batchId, { send: async () => { sent += 1; return { ok: true }; } }),
    /send_blocked:batch_status_awaiting_approval/,
  );
  assert.equal(sent, 0, "the sender must not be reached without approval");
});

test("approval unlocks exactly the rows that passed the gate", async () => {
  runner.resetBatches();
  let n = 0;
  const deps = {
    env: LEGACY_HERO_FALLBACK_ENV,
    pick: async () => [
      { prospectId: "p1", businessName: "One", email: "a@x.test", hasEmail: true, contactReady: true },
      { prospectId: "p2", businessName: "Two", email: "b@x.test", hasEmail: true, contactReady: true },
    ],
    qualify: async () => ({ ok: true }),
    prepareHero: async () => ({ ok: true, required: false, ready: true }),
    mirror: async () => ({ ok: true, previewUrl: "https://x.wss-ai.com/" }),
    sourceFacts: async () => ({}),
    gate: async () => { n += 1; return n === 1 ? { pass: true, failed: [], checks: [] } : { pass: false, failed: ["schema_type"], blockedBy: "schema_type: wrong", checks: [] }; },
    writePreviewUrl: async () => ({ ok: true }),
    queueEmail: async () => ({ ok: true }),
  };
  const started = await runner.startBatch({ count: 2, lane: "sandbox" }, deps);
  const approved = lineState.approveBatch(runner.getBatch(started.batchId), { typedBatchId: started.batchId });
  assert.equal(approved.ok, true);
  runner.putBatch(approved.batch);
  const recipients = [];
  const result = await runner.sendApprovedBatch(started.batchId, {
    send: async (row) => { recipients.push(row.prospectId); return { ok: true }; },
  });
  assert.equal(result.sent, 1);
  assert.deepEqual(recipients, ["p1"], "only the gate-passing row may be sent");
});

// ---------------------------------------------------------------------------
// the HTTP surface
// ---------------------------------------------------------------------------

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    end(payload) { this.body = payload ? JSON.parse(payload) : null; },
  };
}

function req(method, url, body) {
  return { method, url, headers: { "x-admin-token": "test-token" }, body: body ? JSON.stringify(body) : "" };
}

test("the line endpoint is admin-gated", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-token";
  const handler = createLineHandler({});
  const res = fakeRes();
  await handler({ method: "GET", url: "/api/admin/line", headers: {} }, res);
  assert.equal(res.statusCode, 401);
});

test("POST send refuses without approval, through the HTTP surface", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-token";
  process.env.GHOST_AGENCY_OWNER_EMAIL = "woodwardsoftware@gmail.com";
  runner.resetBatches();
  let sent = 0;
  const handler = createLineHandler({
    env: LEGACY_HERO_FALLBACK_ENV,
    pick: async () => [{ prospectId: "p1", businessName: "One", email: "a@x.test", hasEmail: true, contactReady: true }],
    qualify: async () => ({ ok: true }),
    prepareHero: async () => ({ ok: true, required: false, ready: true }),
    mirror: async () => ({ ok: true, previewUrl: "https://x.wss-ai.com/" }),
    sourceFacts: async () => ({}),
    gate: async () => ({ pass: true, failed: [], checks: [] }),
    writePreviewUrl: async () => ({ ok: true }),
    queueEmail: async () => ({ ok: true }),
    send: async () => { sent += 1; return { ok: true }; },
  });

  const startRes = fakeRes();
  await handler(req("POST", "/api/admin/line", { action: "start", count: 1, lane: "sandbox" }), startRes);
  assert.equal(startRes.body.ok, true);
  const batchId = startRes.body.batchId;
  assert.equal(startRes.body.batch.counts.queued, 1);

  const sendRes = fakeRes();
  await handler(req("POST", "/api/admin/line", { action: "send", batchId }), sendRes);
  assert.equal(sent, 0, "an unapproved send must not reach the sender");
  assert.ok(sendRes.statusCode === 403 || sendRes.statusCode === 409, `got ${sendRes.statusCode}`);
});

test("the live lane refuses to start while the server switch is off", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-token";
  delete process.env.GHOST_AGENCY_LINE_LIVE_SENDS;
  runner.resetBatches();
  const handler = createLineHandler({ pick: async () => [] });
  const res = fakeRes();
  await handler(req("POST", "/api/admin/line", { action: "start", count: 50, lane: "live" }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "live_lane_disabled");
});

test("GET reports every gate fact, the launch sizes and the spend counters", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-token";
  const handler = createLineHandler({});
  const res = fakeRes();
  await handler(req("GET", "/api/admin/line"), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.facts.length, renderGateFacts.length);
  assert.deepEqual(res.body.launchSizes, [10, 50, 100, 500]);
  assert.ok(res.body.spend && typeof res.body.spend.gateFailures === "number");
  assert.ok(res.body.readiness && Array.isArray(res.body.readiness.blockers));
});

test("count is clamped to the 500 ceiling and refuses zero", () => {
  assert.equal(runner.clampCount(500), 500);
  assert.equal(runner.clampCount(5000), 500);
  assert.equal(runner.clampCount(0), 0);
  assert.equal(runner.clampCount("abc"), 0);
});

// ---------------------------------------------------------------------------
// THE STAR RATING MUST BE CHECKED AGAINST A REFERENCE OF THE SAME AGE
// ---------------------------------------------------------------------------
// Measured 2026-08-08. Maston's Plumbing & Drain published AggregateRating
// 4.9/679 and was refused against a frozen contract holding 678; Paschal
// published 2128 against 2127. Both published numbers were the FRESHER, truer
// Google reading — and both refusals arrived after a Vercel deploy, a chromium
// render and a live Places call. The error is one-directional (the frozen copy
// is always the older, lower one), so it recurs forever on exactly the
// high-review-velocity businesses worth pitching.

test("a live re-reading of the same place replaces the frozen contract copy", async () => {
  const dbRow = buildReadyDbRow();
  const facts = await sourceFactsFor(rowToLineRow(dbRow), {
    select: async () => ({ ok: true, data: [dbRow] }),
    resolveDonor: () => ({ ok: true, manifest: {} }),
    // What the build actually published, minutes ago, off the same place_id.
    publishedAggregate: { rating: 4.8, review_count: 28, origin: "verified_facts_resolver" },
  });
  assert.equal(facts.rating_count, 28, "the contract's 27 is stale by one review");
  assert.equal(facts.rating_value, 4.8);
  assert.equal(facts.rating_source, "verified_facts_resolver");
});

test("only a LIVE observation may answer for the contract", async () => {
  // A value that came off the prospect column or out of the contract itself is
  // not fresher than the contract, and must not be able to redefine what the
  // gate is checking against. This is the line between "same fact, current" and
  // "the page grading its own homework".
  const dbRow = buildReadyDbRow();
  for (const origin of ["prospect_record", "mined_contract", "", undefined, "operator_supplied"]) {
    const facts = await sourceFactsFor(rowToLineRow(dbRow), {
      select: async () => ({ ok: true, data: [dbRow] }),
      resolveDonor: () => ({ ok: true, manifest: {} }),
      publishedAggregate: { rating: 5.0, review_count: 9999, origin },
    });
    assert.equal(facts.rating_count, 27, `origin ${origin} must not override the contract`);
    assert.equal(facts.rating_value, 4.8);
    assert.equal(facts.rating_source, undefined);
  }
});

test("with no live reading at all the gate reads the contract, exactly as before", async () => {
  const dbRow = buildReadyDbRow();
  const facts = await sourceFactsFor(rowToLineRow(dbRow), {
    select: async () => ({ ok: true, data: [dbRow] }),
    resolveDonor: () => ({ ok: true, manifest: {} }),
  });
  assert.equal(facts.rating_value, 4.8);
  assert.equal(facts.rating_count, 27);
});

test("THE RATING GATE STILL BITES: a star claim nobody observed is refused", () => {
  // The protection this must never lose. The reference moved; the equality did
  // not, so a page publishing a number that matches NO observation still fails.
  const { evaluateRenderGate } = require("../lib/render-gate");
  const dom = {
    ok: true,
    url: "https://wss-test-x.wss-ai.com/",
    status: 200,
    title: "Acme Plumbing — Tulsa, OK",
    innerText: "Acme Plumbing\nTulsa, OK\n(918) 555-0134\nDrain cleaning and water heater repair.",
    hrefs: [], imgs: [],
    logos: [{ src: "https://cdn/x.png", sha256: "a".repeat(64), width: 120, height: 40 }],
    jsonld: [{ "@type": "Plumber", aggregateRating: { "@type": "AggregateRating", ratingValue: 5.0, reviewCount: 9999 } }],
  };
  const source = {
    prospect_id: "p1", business_name: "Acme Plumbing", vertical: "plumbing",
    phone: "918-555-0134", postal_city: "Tulsa", logo_sha256: "a".repeat(64),
    donor_strings: ["Donor Co"],
    // Even a live observation — the published pair simply is not it.
    rating_value: 4.9, rating_count: 679, rating_source: "verified_facts_resolver",
  };
  const check = evaluateRenderGate({ dom, source }).checks.find((c) => c.fact === "aggregate_rating_backed");
  assert.equal(check.pass, false);
  assert.match(check.reason, /does not match verified 4\.9\/679/);
});

test("an ARCHIVED row is never picked — the store already knows it is unbuildable", async () => {
  // Run A, 2026-08-08: the line picked, qualified, built, deployed and rendered
  // Plumbing Today HVAC, whose row had been archived two days earlier with an
  // explicit archived_reason ("mined before Google review text was carried onto
  // the record; rebuild by re-mining"). Two of that run's ten builds went to
  // rows the store had already written off. Re-mining is how an archived lead
  // comes back; the line picking it up again is not.
  const live = buildReadyDbRow({ prospectId: "live-row", status: "new" });
  const archived = {
    ...buildReadyDbRow({ prospectId: "wss-test-plumbing-today-hvac-omaha", status: "archived_legacy" }),
    status: "archived_legacy",
  };
  archived.record.archived_reason = "mined before Google review text was carried onto the record";

  const picked = await pickProspects({ target: "", count: 50 }, {
    selectRows: async () => ({ rows: [live, archived] }),
  });
  assert.deepEqual(picked.map((r) => r.prospectId), ["live-row"]);
});

// ---------------------------------------------------------------------------
// mirror dispatch diagnostics (operator-visible, non-secret)
// ---------------------------------------------------------------------------

const { safeRow, mirrorDispatchSummary } = require("../api/admin/line");

test("safeRow exposes a sanitized mirrorDispatch summary for a pre-build failure", () => {
  const row = {
    prospectId: "p-diag",
    businessName: "Diag Fence",
    city: "Manor",
    state: "TX",
    vertical: "fence",
    status: "error",
    reason: "mirror_dispatch_failed_before_build",
    updatedAt: "2026-08-26T18:27:11.166Z",
    mirrorDispatch: {
      attemptId: "mirror_attempt:lease-abc",
      status: "failed_before_build",
      reason: "mirror_dispatch_failed_before_build",
      failure: {
        code: "invalid_request",
        detail: "/brand/logo: must match pattern ^https://",
        beforeBuild: true,
        hasDurableBuildIdentity: false,
      },
      finishedAt: "2026-08-26T18:27:11.166Z",
      leaseToken: "secret-lease-token",
      binding: { rowVersion: 2 },
    },
  };
  const out = safeRow(row);
  assert.equal(out.status, "error");
  assert.equal(out.reason, "mirror_dispatch_failed_before_build");
  assert.ok(out.mirrorDispatch, "a mirrorDispatch summary is surfaced");
  assert.equal(out.mirrorDispatch.status, "failed_before_build");
  assert.equal(out.mirrorDispatch.cause, "invalid_request");
  assert.equal(out.mirrorDispatch.detail, "/brand/logo: must match pattern ^https://");
  assert.equal(out.mirrorDispatch.beforeBuild, true);
  assert.equal(out.mirrorDispatch.hasDurableBuildIdentity, false);
  // No secret or internal fields leak to the operator surface.
  assert.equal(out.mirrorDispatch.leaseToken, undefined, "lease token must never be exposed");
  assert.equal(out.mirrorDispatch.binding, undefined, "internal binding must never be exposed");
  assert.equal(JSON.stringify(out.mirrorDispatch).includes("secret-lease-token"), false, "no lease token value leaks");
});

test("safeRow omits mirrorDispatch when no dispatch was ever recorded", () => {
  const out = safeRow({ prospectId: "p-none", businessName: "None", status: "qualified", reason: "" });
  assert.equal(out.mirrorDispatch, undefined);
});

test("safeRow exposes build identity and prior attempt audit for a retried row", () => {
  const out = safeRow({
    prospectId: "p-retry",
    businessName: "Retry Fence",
    status: "qualified",
    reason: "",
    mirrorDispatch: {
      attemptId: "mirror_attempt:lease-new",
      status: "dispatching",
      priorAttemptId: "mirror_attempt:prior-failed",
      priorFailure: { code: "invalid_request", detail: "bad logo", beforeBuild: true, hasDurableBuildIdentity: false },
      startedAt: "2026-08-26T18:30:00.000Z",
      buildHash: "a".repeat(64),
      hasPreview: true,
      hasReleaseEvidence: true,
      leaseToken: "secret",
    },
  });
  assert.equal(out.mirrorDispatch.status, "dispatching");
  assert.equal(out.mirrorDispatch.priorAttemptId, "mirror_attempt:prior-failed");
  assert.equal(out.mirrorDispatch.hasPreview, true);
  assert.equal(out.mirrorDispatch.hasReleaseEvidence, true);
  assert.equal(out.mirrorDispatch.buildHash, "a".repeat(64));
  assert.equal(out.mirrorDispatch.leaseToken, undefined, "lease token must not leak even on a healthy dispatch");
});

test("mirrorDispatchSummary returns null for non-object dispatch", () => {
  assert.equal(mirrorDispatchSummary({ mirrorDispatch: null }), null);
  assert.equal(mirrorDispatchSummary({ mirrorDispatch: "dispatching" }), null);
  assert.equal(mirrorDispatchSummary({}), null);
});
